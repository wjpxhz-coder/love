-- Security-first, additive migration for the private two-person diary.
--
-- This migration intentionally does not delete legacy rows. Existing rows are
-- hidden as soon as the permissive policies are replaced, then made visible
-- again after an administrator maps the two legacy usernames to Auth users and
-- runs private.backfill_legacy_space(...). See ../DEPLOY.md.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

do $preflight$
declare
  missing_tables text;
begin
  select string_agg(table_name, ', ' order by table_name)
    into missing_tables
  from (
    values
      ('profiles'),
      ('moments'),
      ('comments'),
      ('moods'),
      ('notifications'),
      ('ai_content'),
      ('moment_likes'),
      ('comment_likes')
  ) required(table_name)
  where to_regclass(format('public.%I', table_name)) is null;

  if missing_tables is not null then
    raise exception
      'Auth/RLS migration aborted. Missing required public tables: %',
      missing_tables;
  end if;
end
$preflight$;

do $id_type_preflight$
declare
  actual_type text;
  item record;
begin
  select format_type(a.atttypid, a.atttypmod)
    into actual_type
  from pg_attribute a
  where a.attrelid = 'public.notifications'::regclass
    and a.attname = 'id'
    and not a.attisdropped;

  if actual_type is distinct from 'uuid' then
    raise exception
      'Expected public.notifications.id to be uuid, found %',
      coalesce(actual_type, '<missing>');
  end if;

  select format_type(a.atttypid, a.atttypmod)
    into actual_type
  from pg_attribute a
  where a.attrelid = 'public.moments'::regclass
    and a.attname = 'id'
    and not a.attisdropped;

  if actual_type is distinct from 'bigint' then
    raise exception
      'Expected public.moments.id to be bigint, found %',
      coalesce(actual_type, '<missing>');
  end if;

  select format_type(a.atttypid, a.atttypmod)
    into actual_type
  from pg_attribute a
  where a.attrelid = 'public.comments'::regclass
    and a.attname = 'id'
    and not a.attisdropped;

  if actual_type is distinct from 'bigint' then
    raise exception
      'Expected public.comments.id to be bigint, found %',
      coalesce(actual_type, '<missing>');
  end if;

  for item in
    select *
    from (values
      ('notifications', 'read_by',   'text[]'),
      ('notifications', 'related_id','text'),
      ('ai_content',    'id',        'uuid'),
      ('comments',      'moment_id', 'bigint'),
      ('moment_likes',  'moment_id', 'bigint'),
      ('comment_likes', 'comment_id','bigint'),
      ('moods',         'date',      'date'),
      ('profiles',      'username',  'text'),
      ('moments',       'author',    'text'),
      ('comments',      'author',    'text'),
      ('moods',         'author',    'text'),
      ('notifications', 'actor',     'text')
    ) as x(table_name, column_name, expected_type)
  loop
    select format_type(a.atttypid, a.atttypmod)
      into actual_type
    from pg_attribute a
    where a.attrelid = format('public.%I', item.table_name)::regclass
      and a.attname = item.column_name
      and not a.attisdropped;

    if actual_type is distinct from item.expected_type then
      raise exception
        'Expected public.%.% to be %, found %',
        item.table_name,
        item.column_name,
        item.expected_type,
        coalesce(actual_type, '<missing>');
    end if;
  end loop;
end
$id_type_preflight$;

-- ---------------------------------------------------------------------------
-- Shared-space model
-- ---------------------------------------------------------------------------

create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  created_by uuid not null references auth.users(id),
  member_limit smallint not null default 2 check (member_limit = 2),
  created_at timestamptz not null default now()
);

create table if not exists public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create unique index if not exists space_members_one_owner_uq
  on public.space_members (space_id)
  where role = 'owner';

create index if not exists space_members_user_space_idx
  on public.space_members (user_id, space_id);

create or replace function private.enforce_space_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  allowed_members smallint;
  current_members integer;
begin
  perform pg_advisory_xact_lock(hashtext(new.space_id::text));

  select s.member_limit
    into allowed_members
  from public.spaces s
  where s.id = new.space_id;

  if allowed_members is null then
    raise exception 'Unknown space: %', new.space_id;
  end if;

  select count(*)
    into current_members
  from public.space_members sm
  where sm.space_id = new.space_id
    and (tg_op <> 'UPDATE' or sm.user_id <> old.user_id);

  if current_members >= allowed_members then
    raise exception 'Space % already has its maximum of % members',
      new.space_id, allowed_members;
  end if;

  return new;
end
$function$;

revoke all on function private.enforce_space_member_limit() from public, anon, authenticated;

drop trigger if exists enforce_space_member_limit on public.space_members;
create trigger enforce_space_member_limit
before insert or update of space_id, user_id on public.space_members
for each row execute function private.enforce_space_member_limit();

-- moment_stars is referenced by the current UI but may not exist in older
-- deployments. Creating the empty table is additive and does not alter moments.
create table if not exists public.moment_stars (
  moment_id bigint not null references public.moments(id) on delete cascade,
  author text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Add Auth/space identity columns. They remain nullable until the explicit
-- legacy mapping step; NOT VALID checks below still protect every new write.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists user_id uuid,
  add column if not exists space_id uuid,
  add column if not exists avatar_path text;

alter table public.moments
  add column if not exists user_id uuid,
  add column if not exists space_id uuid;

alter table public.comments
  add column if not exists user_id uuid,
  add column if not exists space_id uuid;

alter table public.moods
  add column if not exists user_id uuid,
  add column if not exists space_id uuid;

alter table public.moment_likes
  add column if not exists user_id uuid,
  add column if not exists space_id uuid;

alter table public.comment_likes
  add column if not exists user_id uuid,
  add column if not exists space_id uuid;

alter table public.moment_stars
  add column if not exists user_id uuid,
  add column if not exists space_id uuid;

alter table public.notifications
  add column if not exists actor_id uuid,
  add column if not exists recipient_id uuid,
  add column if not exists space_id uuid;

alter table public.ai_content
  add column if not exists created_by uuid,
  add column if not exists space_id uuid;

do $foreign_keys$
declare
  item record;
begin
  for item in
    select *
    from (values
      ('profiles',      'profiles_user_id_fkey',      'user_id',      'auth',   'users',  'id'),
      ('profiles',      'profiles_space_id_fkey',     'space_id',     'public', 'spaces', 'id'),
      ('moments',       'moments_user_id_fkey',       'user_id',      'auth',   'users',  'id'),
      ('moments',       'moments_space_id_fkey',      'space_id',     'public', 'spaces', 'id'),
      ('comments',      'comments_user_id_fkey',      'user_id',      'auth',   'users',  'id'),
      ('comments',      'comments_space_id_fkey',     'space_id',     'public', 'spaces', 'id'),
      ('moods',         'moods_user_id_fkey',         'user_id',      'auth',   'users',  'id'),
      ('moods',         'moods_space_id_fkey',        'space_id',     'public', 'spaces', 'id'),
      ('moment_likes',  'moment_likes_user_id_fkey',  'user_id',      'auth',   'users',  'id'),
      ('moment_likes',  'moment_likes_space_id_fkey', 'space_id',     'public', 'spaces', 'id'),
      ('comment_likes', 'comment_likes_user_id_fkey', 'user_id',      'auth',   'users',  'id'),
      ('comment_likes', 'comment_likes_space_id_fkey','space_id',     'public', 'spaces', 'id'),
      ('moment_stars',  'moment_stars_user_id_fkey',  'user_id',      'auth',   'users',  'id'),
      ('moment_stars',  'moment_stars_space_id_fkey', 'space_id',     'public', 'spaces', 'id'),
      ('notifications', 'notifications_actor_id_fkey','actor_id',     'auth',   'users',  'id'),
      ('notifications', 'notifications_recipient_id_fkey','recipient_id','auth','users', 'id'),
      ('notifications', 'notifications_space_id_fkey','space_id',     'public', 'spaces', 'id'),
      ('ai_content',    'ai_content_created_by_fkey', 'created_by',   'auth',   'users',  'id'),
      ('ai_content',    'ai_content_space_id_fkey',   'space_id',     'public', 'spaces', 'id')
    ) as x(table_name, constraint_name, column_name, target_schema, target_table, target_column)
  loop
    if not exists (
      select 1
      from pg_constraint c
      where c.conrelid = format('public.%I', item.table_name)::regclass
        and c.conname = item.constraint_name
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references %I.%I(%I) not valid',
        item.table_name,
        item.constraint_name,
        item.column_name,
        item.target_schema,
        item.target_table,
        item.target_column
      );
    end if;
  end loop;
end
$foreign_keys$;

-- New/changed rows must carry authenticated identity even before legacy rows
-- have been backfilled. NOT VALID exempts only untouched historical rows.
do $identity_checks$
declare
  item record;
begin
  for item in
    select *
    from (values
      ('profiles',      'profiles_identity_required',      'user_id is not null and space_id is not null'),
      ('moments',       'moments_identity_required',       'user_id is not null and space_id is not null'),
      ('comments',      'comments_identity_required',      'user_id is not null and space_id is not null'),
      ('moods',         'moods_identity_required',         'user_id is not null and space_id is not null'),
      ('moment_likes',  'moment_likes_identity_required',  'user_id is not null and space_id is not null'),
      ('comment_likes', 'comment_likes_identity_required', 'user_id is not null and space_id is not null'),
      ('moment_stars',  'moment_stars_identity_required',  'user_id is not null and space_id is not null'),
      ('notifications', 'notifications_identity_required', 'actor_id is not null and recipient_id is not null and space_id is not null'),
      ('ai_content',    'ai_content_space_required',       'space_id is not null')
    ) as x(table_name, constraint_name, expression)
  loop
    if not exists (
      select 1
      from pg_constraint c
      where c.conrelid = format('public.%I', item.table_name)::regclass
        and c.conname = item.constraint_name
    ) then
      execute format(
        'alter table public.%I add constraint %I check (%s) not valid',
        item.table_name,
        item.constraint_name,
        item.expression
      );
    end if;
  end loop;
end
$identity_checks$;

do $profile_content_checks$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_content_limits'
  ) then
    alter table public.profiles
      add constraint profiles_content_limits check (
        length(username) between 1 and 50
        and (nickname is null or length(nickname) <= 80)
        and (bio is null or length(bio) <= 1000)
        and (avatar_url is null or length(avatar_url) <= 2048)
        and (
          avatar_path is null
          or (
            length(avatar_path) <= 1024
            and avatar_path !~ '(^|/)\.\.(/|$)'
            and avatar_path ~ '^[0-9a-fA-F-]+/[0-9a-fA-F-]+/avatars/[A-Za-z0-9._-]+$'
          )
        )
      ) not valid;
  end if;
end
$profile_content_checks$;

do $payload_checks$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.moments'::regclass
      and conname = 'moments_payload_limits'
  ) then
    alter table public.moments
      add constraint moments_payload_limits check (
        type is not null
        and type in ('moment', 'text', 'photo', 'audio')
        and content is not null
        and length(btrim(content)) between 1 and 100000
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.comments'::regclass
      and conname = 'comments_payload_limits'
  ) then
    alter table public.comments
      add constraint comments_payload_limits check (
        content is not null
        and length(btrim(content)) between 1 and 50000
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.moods'::regclass
      and conname = 'moods_payload_limits'
  ) then
    alter table public.moods
      add constraint moods_payload_limits check (
        score is not null
        and score between 1 and 5
        and (note is null or length(note) <= 300)
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.notifications'::regclass
      and conname = 'notifications_payload_limits'
  ) then
    alter table public.notifications
      add constraint notifications_payload_limits check (
        type is not null
        and type in ('moment', 'comment', 'like', 'miss', 'recalled')
        and (content is null or length(content) <= 5000)
        and (read_by is null or cardinality(read_by) <= 2)
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ai_content'::regclass
      and conname = 'ai_content_payload_limits'
  ) then
    alter table public.ai_content
      add constraint ai_content_payload_limits check (
        type is not null
        and type in ('topic', 'anniversary', 'summary')
        and content is not null
        and length(btrim(content)) between 1 and 10000
      ) not valid;
  end if;
end
$payload_checks$;

-- Partial unique indexes can be installed before legacy identity is populated.
-- The backfill procedure refuses to continue if legacy duplicates would violate
-- them, so duplicate resolution is always an explicit, backed-up admin action.
create unique index if not exists profiles_user_id_uq
  on public.profiles (user_id)
  where user_id is not null;

create unique index if not exists moods_user_date_uq
  on public.moods (user_id, date)
  where user_id is not null;

create unique index if not exists moment_likes_moment_user_uq
  on public.moment_likes (moment_id, user_id)
  where user_id is not null;

create unique index if not exists comment_likes_comment_user_uq
  on public.comment_likes (comment_id, user_id)
  where user_id is not null;

create unique index if not exists moment_stars_moment_user_uq
  on public.moment_stars (moment_id, user_id)
  where user_id is not null;

-- These redundant unique pairs allow composite FKs to prove that a child and
-- its parent belong to the same space. Existing primary keys make the indexes
-- safe to build even while space_id is still null.
create unique index if not exists moments_id_space_uq
  on public.moments (id, space_id);

create unique index if not exists comments_id_space_uq
  on public.comments (id, space_id);

do $membership_and_parent_fks$
declare
  item record;
begin
  for item in
    select *
    from (values
      ('profiles',      'profiles_space_member_fkey',      'space_id, user_id',       'public.space_members', 'space_id, user_id', ''),
      ('moments',       'moments_space_member_fkey',       'space_id, user_id',       'public.space_members', 'space_id, user_id', ''),
      ('comments',      'comments_space_member_fkey',      'space_id, user_id',       'public.space_members', 'space_id, user_id', ''),
      ('moods',         'moods_space_member_fkey',         'space_id, user_id',       'public.space_members', 'space_id, user_id', ''),
      ('moment_likes',  'moment_likes_space_member_fkey',  'space_id, user_id',       'public.space_members', 'space_id, user_id', ''),
      ('comment_likes', 'comment_likes_space_member_fkey', 'space_id, user_id',       'public.space_members', 'space_id, user_id', ''),
      ('moment_stars',  'moment_stars_space_member_fkey',  'space_id, user_id',       'public.space_members', 'space_id, user_id', ''),
      ('notifications', 'notifications_actor_member_fkey', 'space_id, actor_id',      'public.space_members', 'space_id, user_id', ''),
      ('notifications', 'notifications_recipient_member_fkey','space_id, recipient_id','public.space_members','space_id, user_id', ''),
      ('ai_content',    'ai_content_creator_member_fkey',  'space_id, created_by',    'public.space_members', 'space_id, user_id', ''),
      ('comments',      'comments_moment_space_fkey',      'moment_id, space_id',     'public.moments',       'id, space_id', ' on delete cascade'),
      ('moment_likes',  'moment_likes_moment_space_fkey',  'moment_id, space_id',     'public.moments',       'id, space_id', ' on delete cascade'),
      ('moment_stars',  'moment_stars_moment_space_fkey',  'moment_id, space_id',     'public.moments',       'id, space_id', ' on delete cascade'),
      ('comment_likes', 'comment_likes_comment_space_fkey','comment_id, space_id',    'public.comments',      'id, space_id', ' on delete cascade')
    ) as x(
      table_name,
      constraint_name,
      local_columns,
      target_relation,
      target_columns,
      delete_action
    )
  loop
    if not exists (
      select 1
      from pg_constraint c
      where c.conrelid = format('public.%I', item.table_name)::regclass
        and c.conname = item.constraint_name
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (%s) references %s(%s)%s not valid',
        item.table_name,
        item.constraint_name,
        item.local_columns,
        item.target_relation,
        item.target_columns,
        item.delete_action
      );
    end if;
  end loop;
end
$membership_and_parent_fks$;

create table if not exists public.notification_receipts (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists notification_receipts_user_read_idx
  on public.notification_receipts (user_id, read_at desc);

-- Distributed quota state for the paid AI gateway. Clients have no direct
-- table privileges; only claim_ai_chat_quota() can consume a slot.
create table if not exists public.ai_chat_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  space_id uuid not null,
  window_started_at timestamptz not null default now(),
  window_count integer not null default 0 check (window_count between 0 and 8),
  day_started_on date not null default current_date,
  day_count integer not null default 0 check (day_count between 0 and 60),
  updated_at timestamptz not null default now(),
  foreign key (space_id, user_id)
    references public.space_members(space_id, user_id)
);

create table if not exists private.legacy_identity_map (
  space_id uuid not null,
  username text not null,
  user_id uuid not null,
  mapped_at timestamptz not null default now(),
  primary key (space_id, username),
  unique (user_id),
  foreign key (space_id, user_id)
    references public.space_members(space_id, user_id)
);

revoke all on table private.legacy_identity_map from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Trusted helper and trigger functions
-- ---------------------------------------------------------------------------

create or replace function private.is_space_member(
  requested_space_id uuid,
  requested_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select requested_user_id is not null
    and exists (
      select 1
      from public.space_members sm
      where sm.space_id = requested_space_id
        and sm.user_id = requested_user_id
    );
$function$;

create or replace function private.current_profile_space_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select p.space_id
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;
$function$;

create or replace function private.current_username()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select p.username
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1;
$function$;

create or replace function private.can_access_notification(requested_notification_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.notifications n
    where n.id = requested_notification_id
      and private.is_space_member(n.space_id, auth.uid())
      and auth.uid() in (n.actor_id, n.recipient_id)
  );
$function$;

revoke all on function private.is_space_member(uuid, uuid) from public, anon;
revoke all on function private.current_profile_space_id() from public, anon;
revoke all on function private.current_username() from public, anon;
revoke all on function private.can_access_notification(uuid) from public, anon;
grant execute on function private.is_space_member(uuid, uuid) to authenticated;
grant execute on function private.current_profile_space_id() to authenticated;
grant execute on function private.current_username() to authenticated;
grant execute on function private.can_access_notification(uuid) to authenticated;

create or replace function private.assign_author_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  signed_in_user uuid := auth.uid();
  profile_username text;
  profile_space_id uuid;
begin
  -- SQL Editor/service-role maintenance must supply explicit trusted values.
  if signed_in_user is null then
    return new;
  end if;

  select p.username, p.space_id
    into profile_username, profile_space_id
  from public.profiles p
  where p.user_id = signed_in_user;

  if profile_username is null or profile_space_id is null then
    raise exception 'Authenticated user has no mapped profile/space';
  end if;

  new.user_id := signed_in_user;
  new.space_id := profile_space_id;
  new.author := profile_username;
  if tg_table_name in ('moments', 'comments') and tg_op = 'INSERT' then
    new.created_at := now();
  end if;
  return new;
end
$function$;

create or replace function private.assign_notification_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  signed_in_user uuid := auth.uid();
  profile_username text;
  profile_space_id uuid;
  other_user uuid;
begin
  if signed_in_user is null then
    return new;
  end if;

  -- Dedicated SECURITY DEFINER deletion RPCs set this transaction-local flag
  -- after validating parent ownership. It lets them recall dependent notices
  -- regardless of which partner originally acted, while keeping every other
  -- field immutable.
  if tg_op = 'UPDATE'
     and current_setting('diary.internal_notification_recall', true) = 'on' then
    if old.type not in ('moment', 'comment', 'like')
       or new.type <> 'recalled'
       or new.content is distinct from (case old.type
         when 'moment' then '此动态互动已被对方撤回'
         when 'comment' then '此评论互动已被对方撤回'
         when 'like' then '此点赞互动已被对方撤回'
       end)
       or (to_jsonb(new) - array['type', 'content']::text[])
          is distinct from
          (to_jsonb(old) - array['type', 'content']::text[]) then
      raise exception 'Invalid internal notification recall';
    end if;
    return new;
  end if;

  -- A recipient may temporarily use the legacy read_by text[] API while the
  -- frontend rolls over to notification_receipts. It may append its own marker
  -- but cannot mutate any other notification field or remove prior markers.
  if tg_op = 'UPDATE' and signed_in_user = old.recipient_id then
    select p.username
      into profile_username
    from public.profiles p
    where p.user_id = signed_in_user
      and p.space_id = old.space_id;

    if profile_username is null then
      raise exception 'Notification recipient is not a mapped space member';
    end if;

    if (to_jsonb(new) - 'read_by') is distinct from (to_jsonb(old) - 'read_by') then
      raise exception 'A recipient may only update notifications.read_by';
    end if;

    if not (coalesce(new.read_by, array[]::text[]) @> array[profile_username])
       or not (coalesce(old.read_by, array[]::text[]) <@ coalesce(new.read_by, array[]::text[])) then
      raise exception 'read_by may only append the current recipient';
    end if;

    new.actor_id := old.actor_id;
    new.actor := old.actor;
    new.recipient_id := old.recipient_id;
    new.space_id := old.space_id;
    return new;
  end if;

  select p.username, p.space_id
    into profile_username, profile_space_id
  from public.profiles p
  where p.user_id = signed_in_user;

  if profile_username is null or profile_space_id is null then
    raise exception 'Authenticated user has no mapped profile/space';
  end if;

  select sm.user_id
    into other_user
  from public.space_members sm
  where sm.space_id = profile_space_id
    and sm.user_id <> signed_in_user
  order by sm.joined_at
  limit 1;

  if other_user is null then
    raise exception 'The shared space does not have a recipient';
  end if;

  if tg_op = 'UPDATE' then
    -- The actor may only recall one of their own interaction notifications.
    -- Every identity, receipt-compatibility, relation and timestamp field stays
    -- immutable so the sender cannot forge or erase the recipient's read state.
    if old.actor_id <> signed_in_user
       or old.type not in ('moment', 'comment', 'like')
       or new.type <> 'recalled'
       or new.content is distinct from (case old.type
         when 'moment' then '此动态互动已被对方撤回'
         when 'comment' then '此评论互动已被对方撤回'
         when 'like' then '此点赞互动已被对方撤回'
       end)
       or (to_jsonb(new) - array['type', 'content']::text[])
          is distinct from
          (to_jsonb(old) - array['type', 'content']::text[]) then
      raise exception 'An actor may only recall their own interaction notification';
    end if;

    new.actor_id := old.actor_id;
    new.actor := old.actor;
    new.recipient_id := old.recipient_id;
    new.space_id := old.space_id;
    return new;
  end if;

  new.actor_id := signed_in_user;
  new.actor := profile_username;
  new.space_id := profile_space_id;
  new.created_at := now();
  new.read_by := array[]::text[];

  if new.recipient_id is null then
    new.recipient_id := other_user;
  elsif new.recipient_id <> other_user then
    raise exception 'Notification recipient must be the other space member';
  end if;

  return new;
end
$function$;

create or replace function private.assign_ai_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  signed_in_user uuid := auth.uid();
  profile_space_id uuid;
begin
  if signed_in_user is null then
    return new;
  end if;

  select p.space_id
    into profile_space_id
  from public.profiles p
  where p.user_id = signed_in_user;

  if profile_space_id is null then
    raise exception 'Authenticated user has no mapped profile/space';
  end if;

  new.created_by := signed_in_user;
  new.space_id := profile_space_id;
  return new;
end
$function$;

create or replace function private.protect_profile_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  signed_in_user uuid := auth.uid();
begin
  if signed_in_user is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Profiles are provisioned by an administrator';
  end if;

  if old.user_id <> signed_in_user then
    raise exception 'A user may only edit their own profile';
  end if;

  new.user_id := old.user_id;
  new.space_id := old.space_id;
  new.username := old.username;
  new.updated_at := now();

  if new.avatar_path is not null
     and new.avatar_path not like old.space_id::text || '/' || old.user_id::text || '/avatars/%' then
    raise exception 'avatar_path must remain inside the current user avatar folder';
  end if;

  return new;
end
$function$;

create or replace function private.assign_receipt_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
  end if;
  return new;
end
$function$;

-- Version the interaction-notification behavior that the legacy database used
-- to provide through dashboard-only triggers. The authenticated write first
-- passes assign_author_identity(); this AFTER INSERT function then rechecks
-- that derived identity and creates exactly one partner notification.
create or replace function private.create_interaction_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  signed_in_user uuid := auth.uid();
  actor_username text;
  recipient_user_id uuid;
  notification_type text;
  notification_content text;
  notification_related_id text;
begin
  if tg_op <> 'INSERT'
     or tg_table_schema <> 'public'
     or tg_table_name not in ('moments', 'comments', 'comment_likes') then
    raise exception 'Unsupported interaction notification trigger context';
  end if;

  -- Administrative/import writes do not impersonate a diary member and must
  -- not surprise either partner with an interaction notification.
  if signed_in_user is null then
    return new;
  end if;

  select p.username
    into actor_username
  from public.profiles p
  where p.user_id = signed_in_user
    and p.space_id = new.space_id;

  if new.user_id is distinct from signed_in_user
     or new.author is distinct from actor_username
     or actor_username is null
     or not private.is_space_member(new.space_id, signed_in_user) then
    raise exception 'Interaction identity does not match the authenticated member'
      using errcode = '42501';
  end if;

  select sm.user_id
    into recipient_user_id
  from public.space_members sm
  where sm.space_id = new.space_id
    and sm.user_id <> signed_in_user
  order by sm.joined_at
  limit 1;

  if recipient_user_id is null then
    raise exception 'The shared space does not have a notification recipient';
  end if;

  if tg_table_name = 'moments' then
    notification_type := 'moment';
    notification_content := new.content;
    notification_related_id := new.id::text;
  elsif tg_table_name = 'comments' then
    perform 1
    from public.moments m
    where m.id = new.moment_id
      and m.space_id = new.space_id;
    if not found then
      raise exception 'Comment parent does not belong to the authenticated space';
    end if;

    notification_type := 'comment';
    notification_content := new.content;
    notification_related_id := new.id::text;
  else
    select c.content
      into notification_content
    from public.comments c
    where c.id = new.comment_id
      and c.space_id = new.space_id;
    if not found then
      raise exception 'Liked comment does not belong to the authenticated space';
    end if;

    notification_type := 'like';
    notification_related_id := new.comment_id::text;
  end if;

  insert into public.notifications (
    type,
    content,
    actor,
    related_id,
    actor_id,
    recipient_id,
    space_id
  )
  values (
    notification_type,
    left(notification_content, 5000),
    actor_username,
    notification_related_id,
    signed_in_user,
    recipient_user_id,
    new.space_id
  );

  return new;
end
$function$;

revoke all on function private.assign_author_identity() from public, anon, authenticated;
revoke all on function private.assign_notification_identity() from public, anon, authenticated;
revoke all on function private.assign_ai_identity() from public, anon, authenticated;
revoke all on function private.protect_profile_identity() from public, anon, authenticated;
revoke all on function private.assign_receipt_identity() from public, anon, authenticated;
revoke all on function private.create_interaction_notification() from public, anon, authenticated;

do $author_triggers$
declare
  table_name text;
begin
  foreach table_name in array array[
    'moments', 'comments', 'moods', 'moment_likes', 'comment_likes', 'moment_stars'
  ]
  loop
    execute format('drop trigger if exists assign_auth_identity on public.%I', table_name);
    execute format(
      'create trigger assign_auth_identity before %s on public.%I '
      'for each row execute function private.assign_author_identity()',
      case
        when table_name in ('moments', 'comments') then 'insert'
        else 'insert or update'
      end,
      table_name
    );
  end loop;
end
$author_triggers$;

drop trigger if exists assign_notification_identity on public.notifications;
create trigger assign_notification_identity
before insert or update on public.notifications
for each row execute function private.assign_notification_identity();

drop trigger if exists assign_ai_identity on public.ai_content;
create trigger assign_ai_identity
before insert or update on public.ai_content
for each row execute function private.assign_ai_identity();

drop trigger if exists protect_profile_identity on public.profiles;
create trigger protect_profile_identity
before insert or update on public.profiles
for each row execute function private.protect_profile_identity();

drop trigger if exists assign_receipt_identity on public.notification_receipts;
create trigger assign_receipt_identity
before insert or update on public.notification_receipts
for each row execute function private.assign_receipt_identity();

-- Remove dashboard-created/legacy notification triggers before installing the
-- versioned replacement. Function-body detection covers unknown historical
-- names; the name check covers wrapper functions that delegated the INSERT.
do $drop_legacy_interaction_notification_triggers$
declare
  trigger_row record;
begin
  for trigger_row in
    select c.relname as table_name, t.tgname as trigger_name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any (array['moments', 'comments', 'comment_likes'])
      and not t.tgisinternal
      and (
        t.tgname ~* '(notify|notification).*(moment|comment|like)|(moment|comment|like).*(notify|notification)'
        or pg_get_functiondef(t.tgfoid) ~*
          'insert[[:space:]]+into[[:space:]]+(public[.])?notifications'
      )
  loop
    execute format(
      'drop trigger %I on public.%I',
      trigger_row.trigger_name,
      trigger_row.table_name
    );
  end loop;
end
$drop_legacy_interaction_notification_triggers$;

do $interaction_notification_triggers$
declare
  table_name text;
begin
  foreach table_name in array array['moments', 'comments', 'comment_likes']
  loop
    execute format(
      'drop trigger if exists create_interaction_notification_after_insert on public.%I',
      table_name
    );
    execute format(
      'create trigger create_interaction_notification_after_insert '
      'after insert on public.%I for each row '
      'execute function private.create_interaction_notification()',
      table_name
    );
  end loop;
end
$interaction_notification_triggers$;

-- ---------------------------------------------------------------------------
-- Replace every legacy policy on only the application's tables. PostgreSQL
-- policies are permissive (ORed), so leaving one old USING(true) policy would
-- silently defeat every restrictive policy below.
-- ---------------------------------------------------------------------------

do $drop_app_policies$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'spaces', 'space_members', 'profiles', 'moments', 'comments', 'moods',
        'notifications', 'notification_receipts', 'ai_content', 'ai_chat_rate_limits', 'moment_likes',
        'comment_likes', 'moment_stars'
      ])
  loop
    execute format(
      'drop policy %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end
$drop_app_policies$;

do $enable_rls$
declare
  table_name text;
begin
  foreach table_name in array array[
    'spaces', 'space_members', 'profiles', 'moments', 'comments', 'moods',
    'notifications', 'notification_receipts', 'ai_content', 'ai_chat_rate_limits', 'moment_likes',
    'comment_likes', 'moment_stars'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end
$enable_rls$;

revoke all privileges on table
  public.spaces,
  public.space_members,
  public.profiles,
  public.moments,
  public.comments,
  public.moods,
  public.notifications,
  public.notification_receipts,
  public.ai_content,
  public.ai_chat_rate_limits,
  public.moment_likes,
  public.comment_likes,
  public.moment_stars
from anon, authenticated;

grant select on table public.spaces, public.space_members to authenticated;
grant select on table public.profiles to authenticated;
grant update (nickname, bio, avatar_url, avatar_path, updated_at)
  on table public.profiles to authenticated;
grant select, insert on table
  public.moments,
  public.comments
to authenticated;
grant select, insert, update, delete on table
  public.moods,
  public.ai_content
to authenticated;
grant select, update on table public.notifications to authenticated;
grant select, insert, delete on table
  public.moment_likes,
  public.comment_likes,
  public.moment_stars
to authenticated;
grant select, insert, update, delete on table public.notification_receipts to authenticated;

create policy spaces_select_member
on public.spaces for select to authenticated
using (private.is_space_member(id));

create policy space_members_select_member
on public.space_members for select to authenticated
using (private.is_space_member(space_id));

create policy profiles_select_same_space
on public.profiles for select to authenticated
using (private.is_space_member(space_id));

create policy profiles_update_self
on public.profiles for update to authenticated
using (user_id = auth.uid() and private.is_space_member(space_id))
with check (user_id = auth.uid() and private.is_space_member(space_id));

create policy moments_select_member
on public.moments for select to authenticated
using (private.is_space_member(space_id));

create policy moments_insert_self
on public.moments for insert to authenticated
with check (
  user_id = auth.uid()
  and author = private.current_username()
  and space_id = private.current_profile_space_id()
  and private.is_space_member(space_id)
);

create policy comments_select_member
on public.comments for select to authenticated
using (private.is_space_member(space_id));

create policy comments_insert_self
on public.comments for insert to authenticated
with check (
  user_id = auth.uid()
  and author = private.current_username()
  and space_id = private.current_profile_space_id()
  and private.is_space_member(space_id)
);

create policy moods_select_member
on public.moods for select to authenticated
using (private.is_space_member(space_id));

create policy moods_insert_self
on public.moods for insert to authenticated
with check (
  user_id = auth.uid()
  and author = private.current_username()
  and space_id = private.current_profile_space_id()
);

create policy moods_update_self
on public.moods for update to authenticated
using (user_id = auth.uid() and private.is_space_member(space_id))
with check (
  user_id = auth.uid()
  and author = private.current_username()
  and space_id = private.current_profile_space_id()
);

create policy moods_delete_self
on public.moods for delete to authenticated
using (user_id = auth.uid() and private.is_space_member(space_id));

create policy moment_likes_select_member
on public.moment_likes for select to authenticated
using (private.is_space_member(space_id));

create policy moment_likes_insert_self
on public.moment_likes for insert to authenticated
with check (
  user_id = auth.uid()
  and author = private.current_username()
  and space_id = private.current_profile_space_id()
);

create policy moment_likes_delete_self
on public.moment_likes for delete to authenticated
using (user_id = auth.uid() and private.is_space_member(space_id));

create policy comment_likes_select_member
on public.comment_likes for select to authenticated
using (private.is_space_member(space_id));

create policy comment_likes_insert_self
on public.comment_likes for insert to authenticated
with check (
  user_id = auth.uid()
  and author = private.current_username()
  and space_id = private.current_profile_space_id()
);

create policy comment_likes_delete_self
on public.comment_likes for delete to authenticated
using (user_id = auth.uid() and private.is_space_member(space_id));

create policy moment_stars_select_member
on public.moment_stars for select to authenticated
using (private.is_space_member(space_id));

create policy moment_stars_insert_self
on public.moment_stars for insert to authenticated
with check (
  user_id = auth.uid()
  and author = private.current_username()
  and space_id = private.current_profile_space_id()
);

create policy moment_stars_delete_self
on public.moment_stars for delete to authenticated
using (user_id = auth.uid() and private.is_space_member(space_id));

create policy notifications_select_participant
on public.notifications for select to authenticated
using (
  private.is_space_member(space_id)
  and auth.uid() in (actor_id, recipient_id)
);

create policy notifications_update_actor
on public.notifications for update to authenticated
using (actor_id = auth.uid() and private.is_space_member(space_id))
with check (
  actor_id = auth.uid()
  and actor = private.current_username()
  and recipient_id <> auth.uid()
  and private.is_space_member(space_id, recipient_id)
);

create policy notification_receipts_select_self
on public.notification_receipts for select to authenticated
using (user_id = auth.uid() and private.can_access_notification(notification_id));

create policy notification_receipts_insert_self
on public.notification_receipts for insert to authenticated
with check (user_id = auth.uid() and private.can_access_notification(notification_id));

create policy notification_receipts_update_self
on public.notification_receipts for update to authenticated
using (user_id = auth.uid() and private.can_access_notification(notification_id))
with check (user_id = auth.uid() and private.can_access_notification(notification_id));

create policy notification_receipts_delete_self
on public.notification_receipts for delete to authenticated
using (user_id = auth.uid() and private.can_access_notification(notification_id));

create policy ai_content_select_member
on public.ai_content for select to authenticated
using (private.is_space_member(space_id));

create policy ai_content_insert_self
on public.ai_content for insert to authenticated
with check (
  created_by = auth.uid()
  and space_id = private.current_profile_space_id()
  and private.is_space_member(space_id)
);

create policy ai_content_update_creator
on public.ai_content for update to authenticated
using (created_by = auth.uid() and private.is_space_member(space_id))
with check (created_by = auth.uid() and space_id = private.current_profile_space_id());

-- AI content is shared cache data; either member may remove stale entries.
create policy ai_content_delete_member
on public.ai_content for delete to authenticated
using (private.is_space_member(space_id));

create index if not exists profiles_space_user_idx
  on public.profiles (space_id, user_id);
create index if not exists moments_space_created_idx
  on public.moments (space_id, created_at desc, id desc);
create index if not exists comments_space_moment_created_idx
  on public.comments (space_id, moment_id, created_at);
create index if not exists moods_space_date_idx
  on public.moods (space_id, date);
create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_actor_created_idx
  on public.notifications (actor_id, created_at desc);
create index if not exists ai_content_space_type_created_idx
  on public.ai_content (space_id, type, created_at desc);
create index if not exists moment_likes_space_moment_idx
  on public.moment_likes (space_id, moment_id);
create index if not exists comment_likes_space_comment_idx
  on public.comment_likes (space_id, comment_id);
create index if not exists moment_stars_space_moment_idx
  on public.moment_stars (space_id, moment_id);

-- Disable the obsolete password oracle without dropping it during an additive
-- migration. It may be removed in a later cleanup migration after verification.
do $revoke_verify_login$
declare
  function_row record;
begin
  for function_row in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'verify_login'
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      function_row.signature
    );
  end loop;
end
$revoke_verify_login$;

-- Safe replacement for the former client-authored "miss you" notification.
-- It accepts no identity/content arguments, derives both members server-side,
-- and applies a small cooldown to avoid accidental request storms.
create or replace function public.send_miss_you()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  signed_in_user uuid := auth.uid();
  sender_username text;
  sender_space_id uuid;
  receiver_user_id uuid;
  inserted_id uuid;
begin
  if signed_in_user is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select p.username, p.space_id
    into sender_username, sender_space_id
  from public.profiles p
  where p.user_id = signed_in_user;

  if sender_username is null
     or sender_space_id is null
     or not private.is_space_member(sender_space_id, signed_in_user) then
    raise exception 'Authenticated user is not a mapped space member'
      using errcode = '42501';
  end if;

  select sm.user_id
    into receiver_user_id
  from public.space_members sm
  where sm.space_id = sender_space_id
    and sm.user_id <> signed_in_user
  order by sm.joined_at
  limit 1;

  if receiver_user_id is null then
    raise exception 'The shared space does not have a recipient';
  end if;

  -- Serialize the cooldown check per sender so concurrent taps cannot both
  -- pass the EXISTS test before either transaction inserts its notification.
  perform pg_advisory_xact_lock(hashtextextended(signed_in_user::text, 0));

  if exists (
    select 1
    from public.notifications n
    where n.space_id = sender_space_id
      and n.actor_id = signed_in_user
      and n.type = 'miss'
      and n.created_at > now() - interval '3 seconds'
  ) then
    raise exception 'Please wait before sending another notification'
      using errcode = 'P0001';
  end if;

  insert into public.notifications (
    type,
    actor,
    content,
    actor_id,
    recipient_id,
    space_id
  )
  values (
    'miss',
    sender_username,
    sender_username || ' 正在疯狂想你 💓',
    signed_in_user,
    receiver_user_id,
    sender_space_id
  )
  returning id into inserted_id;

  return inserted_id;
end
$function$;

revoke all on function public.send_miss_you() from public, anon;
grant execute on function public.send_miss_you() to authenticated;

-- Parent deletion and dependent notification recall must be one transaction.
-- Direct DELETE grants are intentionally absent for moments/comments.
create or replace function public.recall_and_delete_comment(p_comment_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  signed_in_user uuid := auth.uid();
  target_comment public.comments%rowtype;
begin
  if signed_in_user is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select c.*
    into target_comment
  from public.comments c
  where c.id = p_comment_id
  for update;

  if not found then
    return false;
  end if;
  if target_comment.user_id <> signed_in_user
     or not private.is_space_member(target_comment.space_id, signed_in_user) then
    raise exception 'Only the comment author may recall it' using errcode = '42501';
  end if;

  perform set_config('diary.internal_notification_recall', 'on', true);
  update public.notifications n
  set type = 'recalled',
      content = case n.type
        when 'comment' then '此评论互动已被对方撤回'
        when 'like' then '此点赞互动已被对方撤回'
      end
  where n.space_id = target_comment.space_id
    and n.related_id = p_comment_id::text
    and n.type in ('comment', 'like');

  delete from public.comments c where c.id = p_comment_id;
  return true;
end
$function$;

create or replace function public.recall_and_delete_moment(p_moment_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  signed_in_user uuid := auth.uid();
  target_moment public.moments%rowtype;
  comment_ids text[] := array[]::text[];
begin
  if signed_in_user is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select m.*
    into target_moment
  from public.moments m
  where m.id = p_moment_id
  for update;

  if not found then
    return false;
  end if;
  if target_moment.user_id <> signed_in_user
     or not private.is_space_member(target_moment.space_id, signed_in_user) then
    raise exception 'Only the moment author may recall it' using errcode = '42501';
  end if;
  if target_moment.created_at <= now() - interval '24 hours' then
    raise exception 'Moments may only be recalled within 24 hours' using errcode = '42501';
  end if;

  -- Lock every current child before collecting its id. Together with the
  -- parent FOR UPDATE lock, this gives notification recall and cascading
  -- deletion a stable child set for the rest of the transaction.
  perform 1
  from public.comments c
  where c.moment_id = p_moment_id
    and c.space_id = target_moment.space_id
  order by c.id
  for update;

  select coalesce(array_agg(c.id::text), array[]::text[])
    into comment_ids
  from public.comments c
  where c.moment_id = p_moment_id
    and c.space_id = target_moment.space_id;

  perform set_config('diary.internal_notification_recall', 'on', true);
  update public.notifications n
  set type = 'recalled',
      content = case n.type
        when 'moment' then '此动态互动已被对方撤回'
        when 'comment' then '此评论互动已被对方撤回'
        when 'like' then '此点赞互动已被对方撤回'
      end
  where n.space_id = target_moment.space_id
    and (
      (n.type = 'moment' and n.related_id = p_moment_id::text)
      or (n.type in ('comment', 'like') and n.related_id = any(comment_ids))
    );

  delete from public.moments m where m.id = p_moment_id;
  return true;
end
$function$;

revoke all on function public.recall_and_delete_comment(bigint) from public, anon;
revoke all on function public.recall_and_delete_moment(bigint) from public, anon;
grant execute on function public.recall_and_delete_comment(bigint) to authenticated;
grant execute on function public.recall_and_delete_moment(bigint) to authenticated;

-- Atomic notification-read RPCs. They derive the reader from auth.uid(), check
-- that the notification belongs to that user's space, maintain the temporary
-- read_by text[] compatibility field, and write the normalized receipt row.
create or replace function public.mark_notification_read(p_notification_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  signed_in_user uuid := auth.uid();
  reader_username text;
  reader_space_id uuid;
  target_notification public.notifications%rowtype;
begin
  if signed_in_user is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select p.username, p.space_id
    into reader_username, reader_space_id
  from public.profiles p
  where p.user_id = signed_in_user;

  if reader_username is null
     or reader_space_id is null
     or not private.is_space_member(reader_space_id, signed_in_user) then
    raise exception 'Authenticated user is not a mapped space member'
      using errcode = '42501';
  end if;

  select n.*
    into target_notification
  from public.notifications n
  where n.id = p_notification_id
  for update;

  if not found
     or target_notification.space_id <> reader_space_id
     or target_notification.recipient_id <> signed_in_user then
    raise exception 'Notification is not addressed to the current user'
      using errcode = '42501';
  end if;

  if not (coalesce(target_notification.read_by, array[]::text[]) @> array[reader_username]) then
    update public.notifications n
    set read_by = array_append(coalesce(n.read_by, array[]::text[]), reader_username)
    where n.id = p_notification_id;
  end if;

  insert into public.notification_receipts (notification_id, user_id, read_at)
  values (p_notification_id, signed_in_user, now())
  on conflict (notification_id, user_id)
  do update set read_at = excluded.read_at;

  return true;
end
$function$;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  signed_in_user uuid := auth.uid();
  reader_username text;
  reader_space_id uuid;
  updated_count integer := 0;
begin
  if signed_in_user is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select p.username, p.space_id
    into reader_username, reader_space_id
  from public.profiles p
  where p.user_id = signed_in_user;

  if reader_username is null
     or reader_space_id is null
     or not private.is_space_member(reader_space_id, signed_in_user) then
    raise exception 'Authenticated user is not a mapped space member'
      using errcode = '42501';
  end if;

  update public.notifications n
  set read_by = array_append(coalesce(n.read_by, array[]::text[]), reader_username)
  where n.space_id = reader_space_id
    and n.recipient_id = signed_in_user
    and not (coalesce(n.read_by, array[]::text[]) @> array[reader_username]);
  get diagnostics updated_count = row_count;

  insert into public.notification_receipts (notification_id, user_id, read_at)
  select n.id, signed_in_user, now()
  from public.notifications n
  where n.space_id = reader_space_id
    and n.recipient_id = signed_in_user
  on conflict (notification_id, user_id)
  do update set read_at = excluded.read_at;

  return updated_count;
end
$function$;

revoke all on function public.mark_notification_read(uuid) from public, anon;
revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- Atomically consumes one AI request allowance: at most 8 requests per rolling
-- 10-minute window and 60 per UTC database day for each authenticated member.
create or replace function public.claim_ai_chat_quota()
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  signed_in_user uuid := auth.uid();
  caller_space_id uuid;
  quota_row public.ai_chat_rate_limits%rowtype;
  v_now timestamptz := now();
  v_day date := current_date;
begin
  if signed_in_user is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select p.space_id
    into caller_space_id
  from public.profiles p
  where p.user_id = signed_in_user;

  if caller_space_id is null
     or not private.is_space_member(caller_space_id, signed_in_user) then
    raise exception 'Authenticated user is not a mapped space member'
      using errcode = '42501';
  end if;

  insert into public.ai_chat_rate_limits (user_id, space_id)
  values (signed_in_user, caller_space_id)
  on conflict (user_id) do nothing;

  select q.*
    into quota_row
  from public.ai_chat_rate_limits q
  where q.user_id = signed_in_user
  for update;

  if quota_row.space_id <> caller_space_id then
    raise exception 'AI quota identity does not match current membership'
      using errcode = '42501';
  end if;

  if quota_row.day_started_on <> v_day then
    quota_row.day_started_on := v_day;
    quota_row.day_count := 0;
  end if;

  if quota_row.window_started_at <= v_now - interval '10 minutes' then
    quota_row.window_started_at := v_now;
    quota_row.window_count := 0;
  end if;

  if quota_row.window_count >= 8 or quota_row.day_count >= 60 then
    update public.ai_chat_rate_limits q
    set window_started_at = quota_row.window_started_at,
        window_count = quota_row.window_count,
        day_started_on = quota_row.day_started_on,
        day_count = quota_row.day_count,
        updated_at = v_now
    where q.user_id = signed_in_user;
    return false;
  end if;

  update public.ai_chat_rate_limits q
  set window_started_at = quota_row.window_started_at,
      window_count = quota_row.window_count + 1,
      day_started_on = quota_row.day_started_on,
      day_count = quota_row.day_count + 1,
      updated_at = v_now
  where q.user_id = signed_in_user;

  return true;
end
$function$;

revoke all on function public.claim_ai_chat_quota() from public, anon;
grant execute on function public.claim_ai_chat_quota() to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime Authorization for the exact private topic used by presence.js:
--   space:<current profile space UUID>:presence
-- Both Presence and Broadcast extensions use the same private channel.
-- ---------------------------------------------------------------------------

do $realtime_preflight$
begin
  if to_regclass('realtime.messages') is null then
    raise exception 'Realtime Authorization unavailable: realtime.messages is missing';
  end if;
end
$realtime_preflight$;

do $drop_realtime_policies$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
  loop
    execute format('drop policy %I on realtime.messages', policy_row.policyname);
  end loop;
end
$drop_realtime_policies$;

alter table realtime.messages enable row level security;
revoke all privileges on table realtime.messages from anon, authenticated;
grant select, insert on table realtime.messages to authenticated;

create policy diary_space_presence_broadcast_read
on realtime.messages for select to authenticated
using (
  realtime.messages.extension in ('presence', 'broadcast')
  and (select realtime.topic()) =
    'space:' || private.current_profile_space_id()::text || ':presence'
  and private.is_space_member(private.current_profile_space_id())
);

create policy diary_space_presence_broadcast_write
on realtime.messages for insert to authenticated
with check (
  realtime.messages.extension in ('presence', 'broadcast')
  and (select realtime.topic()) =
    'space:' || private.current_profile_space_id()::text || ':presence'
  and private.is_space_member(private.current_profile_space_id())
);

-- ---------------------------------------------------------------------------
-- Private Storage bucket. New object names must be:
--   <space UUID>/<uploader Auth UUID>/<kind>/<random filename>
-- Existing legacy paths remain stored but are deliberately inaccessible until
-- an administrator copies them to the new layout and updates database URLs.
-- ---------------------------------------------------------------------------

do $storage_bucket_columns_preflight$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'storage.buckets'::regclass
      and attname = 'file_size_limit'
      and not attisdropped
  ) or not exists (
    select 1 from pg_attribute
    where attrelid = 'storage.buckets'::regclass
      and attname = 'allowed_mime_types'
      and not attisdropped
  ) then
    raise exception
      'Storage schema is incompatible: bucket upload-limit columns are missing';
  end if;
end
$storage_bucket_columns_preflight$;

-- A newly-created bucket starts private. For an existing legacy bucket, keep
-- the current public flag until paths/URLs have been migrated, but immediately
-- enforce server-side limits for every new upload.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'photos',
  'photos',
  false,
  20971520,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/webm', 'audio/ogg', 'audio/mp4'
  ]::text[]
)
on conflict (id) do update
set file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.storage_path_uuid(object_name text, segment integer)
returns uuid
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if segment < 1 then
    return null;
  end if;
  return split_part(object_name, '/', segment)::uuid;
exception
  when invalid_text_representation then
    return null;
end
$function$;

create or replace function private.storage_metadata_size(object_metadata jsonb)
returns bigint
language plpgsql
immutable
set search_path = ''
as $function$
begin
  return (object_metadata ->> 'size')::bigint;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return null;
end
$function$;

revoke all on function private.storage_path_uuid(text, integer) from public, anon;
revoke all on function private.storage_metadata_size(jsonb) from public, anon;
grant execute on function private.storage_path_uuid(text, integer) to authenticated;
grant execute on function private.storage_metadata_size(jsonb) to authenticated;

-- This Supabase project is dedicated to this application. Clearing all object
-- policies is required because a single old broad policy would be ORed with the
-- private photos policies. If other buckets are later added, give each one an
-- explicit policy in a subsequent audited migration.
/*
do $drop_storage_policies$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
  loop
    execute format('drop policy %I on storage.objects', policy_row.policyname);
  end loop;
end
$drop_storage_policies$;

alter table storage.objects enable row level security;
revoke all privileges on table storage.objects from anon, authenticated;
grant select, insert, update, delete on table storage.objects to authenticated;

create policy photos_select_space_member
on storage.objects for select to authenticated
using (
  bucket_id = 'photos'
  and private.is_space_member(private.storage_path_uuid(name, 1))
);

create policy photos_insert_own_folder
on storage.objects for insert to authenticated
with check (
  bucket_id = 'photos'
  and private.storage_path_uuid(name, 2) = auth.uid()
  and private.storage_path_uuid(name, 1) = private.current_profile_space_id()
  and private.is_space_member(private.storage_path_uuid(name, 1))
  and private.storage_metadata_size(metadata) between 1 and 20971520
  and split_part(lower(metadata ->> 'mimetype'), ';', 1) = any (array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/webm', 'audio/ogg', 'audio/mp4'
  ]::text[])
);

create policy photos_update_own_folder
on storage.objects for update to authenticated
using (
  bucket_id = 'photos'
  and private.storage_path_uuid(name, 2) = auth.uid()
  and private.storage_path_uuid(name, 1) = private.current_profile_space_id()
)
with check (
  bucket_id = 'photos'
  and private.storage_path_uuid(name, 2) = auth.uid()
  and private.storage_path_uuid(name, 1) = private.current_profile_space_id()
  and private.storage_metadata_size(metadata) between 1 and 20971520
  and split_part(lower(metadata ->> 'mimetype'), ';', 1) = any (array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/webm', 'audio/ogg', 'audio/mp4'
  ]::text[])
);

create policy photos_delete_own_folder
on storage.objects for delete to authenticated
using (
  bucket_id = 'photos'
  and private.storage_path_uuid(name, 2) = auth.uid()
  and private.storage_path_uuid(name, 1) = private.current_profile_space_id()
);
*/

-- ---------------------------------------------------------------------------
-- Explicit, administrator-only legacy backfill. It checks both identity
-- coverage and uniqueness before changing a single legacy row.
-- ---------------------------------------------------------------------------

create or replace function private.backfill_legacy_space(target_space_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  member_count integer;
  mapping_count integer;
  missing_authors text;
  profiles_updated integer := 0;
  moments_updated integer := 0;
  comments_updated integer := 0;
  moods_updated integer := 0;
  moment_likes_updated integer := 0;
  comment_likes_updated integer := 0;
  moment_stars_updated integer := 0;
  notifications_updated integer := 0;
  receipts_created integer := 0;
  ai_rows_updated integer := 0;
begin
  if not exists (select 1 from public.spaces s where s.id = target_space_id) then
    raise exception 'Unknown space: %', target_space_id;
  end if;

  select count(*) into member_count
  from public.space_members sm
  where sm.space_id = target_space_id;

  if member_count <> 2 then
    raise exception 'Expected exactly 2 space members, found %', member_count;
  end if;

  select count(*) into mapping_count
  from private.legacy_identity_map m
  where m.space_id = target_space_id;

  if mapping_count <> 2 then
    raise exception 'Expected exactly 2 legacy identity mappings, found %', mapping_count;
  end if;

  if exists (
    select 1
    from private.legacy_identity_map m
    left join public.profiles p on p.username = m.username
    where m.space_id = target_space_id
      and p.username is null
  ) then
    raise exception 'Every mapped username must already exist in public.profiles';
  end if;

  select string_agg(distinct source.author_name, ', ' order by source.author_name)
    into missing_authors
  from (
    select coalesce(author, '<NULL>') as author_name from public.moments where space_id is null
    union all
    select coalesce(author, '<NULL>') from public.comments where space_id is null
    union all
    select coalesce(author, '<NULL>') from public.moods where space_id is null
    union all
    select coalesce(author, '<NULL>') from public.moment_likes where space_id is null
    union all
    select coalesce(author, '<NULL>') from public.comment_likes where space_id is null
    union all
    select coalesce(author, '<NULL>') from public.moment_stars where space_id is null
    union all
    select coalesce(actor, '<NULL>') from public.notifications where space_id is null
  ) source
  left join private.legacy_identity_map m
    on m.space_id = target_space_id
   and m.username = source.author_name
  where m.user_id is null;

  if missing_authors is not null then
    raise exception 'Unmapped legacy author/actor values: %', missing_authors;
  end if;

  if exists (
    select 1
    from public.moods x
    join private.legacy_identity_map m
      on m.space_id = target_space_id and m.username = x.author
    where x.space_id is null
    group by x.date, m.user_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate legacy moods would violate one mood per user/day';
  end if;

  if exists (
    select 1
    from public.moment_likes x
    join private.legacy_identity_map m
      on m.space_id = target_space_id and m.username = x.author
    where x.space_id is null
    group by x.moment_id, m.user_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate legacy moment likes must be resolved manually';
  end if;

  if exists (
    select 1
    from public.comment_likes x
    join private.legacy_identity_map m
      on m.space_id = target_space_id and m.username = x.author
    where x.space_id is null
    group by x.comment_id, m.user_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate legacy comment likes must be resolved manually';
  end if;

  if exists (
    select 1
    from public.moment_stars x
    join private.legacy_identity_map m
      on m.space_id = target_space_id and m.username = x.author
    where x.space_id is null
    group by x.moment_id, m.user_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate legacy moment stars must be resolved manually';
  end if;

  update public.profiles p
  set user_id = m.user_id,
      space_id = target_space_id
  from private.legacy_identity_map m
  where m.space_id = target_space_id
    and p.username = m.username
    and (p.user_id is distinct from m.user_id or p.space_id is distinct from target_space_id);
  get diagnostics profiles_updated = row_count;

  update public.moments x
  set user_id = m.user_id, space_id = target_space_id
  from private.legacy_identity_map m
  where m.space_id = target_space_id and x.author = m.username and x.space_id is null;
  get diagnostics moments_updated = row_count;

  update public.comments x
  set user_id = m.user_id, space_id = target_space_id
  from private.legacy_identity_map m
  where m.space_id = target_space_id and x.author = m.username and x.space_id is null;
  get diagnostics comments_updated = row_count;

  update public.moods x
  set user_id = m.user_id, space_id = target_space_id
  from private.legacy_identity_map m
  where m.space_id = target_space_id and x.author = m.username and x.space_id is null;
  get diagnostics moods_updated = row_count;

  update public.moment_likes x
  set user_id = m.user_id, space_id = target_space_id
  from private.legacy_identity_map m
  where m.space_id = target_space_id and x.author = m.username and x.space_id is null;
  get diagnostics moment_likes_updated = row_count;

  update public.comment_likes x
  set user_id = m.user_id, space_id = target_space_id
  from private.legacy_identity_map m
  where m.space_id = target_space_id and x.author = m.username and x.space_id is null;
  get diagnostics comment_likes_updated = row_count;

  update public.moment_stars x
  set user_id = m.user_id, space_id = target_space_id
  from private.legacy_identity_map m
  where m.space_id = target_space_id and x.author = m.username and x.space_id is null;
  get diagnostics moment_stars_updated = row_count;

  update public.notifications n
  set actor_id = m.user_id,
      recipient_id = (
        select sm.user_id
        from public.space_members sm
        where sm.space_id = target_space_id
          and sm.user_id <> m.user_id
        limit 1
      ),
      space_id = target_space_id
  from private.legacy_identity_map m
  where m.space_id = target_space_id
    and n.actor = m.username
    and n.space_id is null;
  get diagnostics notifications_updated = row_count;

  insert into public.notification_receipts (notification_id, user_id, read_at)
  select n.id, m.user_id, coalesce(n.created_at, now())
  from public.notifications n
  join private.legacy_identity_map m
    on m.space_id = target_space_id
   and m.username = any(n.read_by)
  where n.space_id = target_space_id
  on conflict (notification_id, user_id) do nothing;
  get diagnostics receipts_created = row_count;

  update public.ai_content a
  set space_id = target_space_id
  where a.space_id is null;
  get diagnostics ai_rows_updated = row_count;

  return jsonb_build_object(
    'profiles', profiles_updated,
    'moments', moments_updated,
    'comments', comments_updated,
    'moods', moods_updated,
    'moment_likes', moment_likes_updated,
    'comment_likes', comment_likes_updated,
    'moment_stars', moment_stars_updated,
    'notifications', notifications_updated,
    'notification_receipts', receipts_created,
    'ai_content', ai_rows_updated
  );
end
$function$;

revoke all on function private.backfill_legacy_space(uuid) from public, anon, authenticated;

commit;
