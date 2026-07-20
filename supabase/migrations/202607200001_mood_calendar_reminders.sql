-- Expand mood check-ins from one row per user/day to an append-only-by-default
-- history, and add private per-user in-app reminder preferences.

alter table public.moods
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.moods
set created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, created_at, now())
where created_at is null or updated_at is null;

alter table public.moods
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

-- The authenticated frontend previously used upsert(user_id,date). Remove both
-- the versioned index and common dashboard-created constraint names so a member
-- can keep more than one check-in on the same date. Existing rows are untouched.
alter table public.moods drop constraint if exists moods_user_id_date_key;
alter table public.moods drop constraint if exists moods_author_date_key;
alter table public.moods drop constraint if exists moods_user_date_uq;
alter table public.moods drop constraint if exists moods_author_date_uq;
drop index if exists public.moods_user_date_uq;
drop index if exists public.moods_author_date_uq;

-- Remove equivalent uniquely named constraints/indexes created outside the
-- versioned migration. Never touch the primary key or unrelated uniqueness.
do $drop_legacy_daily_uniqueness$
declare
  item record;
begin
  for item in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.moods'::regclass
      and c.contype = 'u'
      and (
        (select array_agg(a.attname::text order by key_column.position)
         from unnest(c.conkey) with ordinality as key_column(attnum, position)
         join pg_attribute a
           on a.attrelid = c.conrelid and a.attnum = key_column.attnum)
        in (array['user_id', 'date']::text[], array['date', 'user_id']::text[],
            array['author', 'date']::text[], array['date', 'author']::text[])
      )
  loop
    execute format('alter table public.moods drop constraint %I', item.conname);
  end loop;

  for item in
    select index_class.relname as index_name
    from pg_index i
    join pg_class index_class on index_class.oid = i.indexrelid
    where i.indrelid = 'public.moods'::regclass
      and i.indisunique
      and not i.indisprimary
      and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)
      and (
        (select array_agg(a.attname::text order by key_column.position)
         from unnest(i.indkey::smallint[]) with ordinality as key_column(attnum, position)
         join pg_attribute a
           on a.attrelid = i.indrelid and a.attnum = key_column.attnum
         where key_column.position <= i.indnkeyatts)
        in (array['user_id', 'date']::text[], array['date', 'user_id']::text[],
            array['author', 'date']::text[], array['date', 'author']::text[])
      )
  loop
    execute format('drop index public.%I', item.index_name);
  end loop;
end
$drop_legacy_daily_uniqueness$;

create index if not exists moods_space_date_created_idx
  on public.moods (space_id, date, created_at, id);
create index if not exists moods_user_date_idx
  on public.moods (user_id, date);

create or replace function private.set_mood_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.id := old.id;
  new.date := old.date;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end
$function$;

revoke all on function private.set_mood_updated_at() from public, anon, authenticated;

drop trigger if exists set_mood_updated_at on public.moods;
create trigger set_mood_updated_at
before update on public.moods
for each row execute function private.set_mood_updated_at();

create table if not exists public.mood_reminder_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  space_id uuid not null,
  enabled boolean not null default true,
  reminder_time time without time zone not null default time '21:00',
  last_acknowledged_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mood_reminder_settings_space_member_fkey
    foreign key (space_id, user_id)
    references public.space_members(space_id, user_id)
    on delete cascade,
  constraint mood_reminder_settings_time_precision check (
    extract(second from reminder_time) = 0
  )
);

create or replace function private.assign_mood_reminder_identity()
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

  if profile_space_id is null
     or not private.is_space_member(profile_space_id, signed_in_user) then
    raise exception 'Authenticated user has no mapped profile/space'
      using errcode = '42501';
  end if;

  new.user_id := signed_in_user;
  new.space_id := profile_space_id;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end
$function$;

revoke all on function private.assign_mood_reminder_identity() from public, anon, authenticated;

drop trigger if exists assign_mood_reminder_identity on public.mood_reminder_settings;
create trigger assign_mood_reminder_identity
before insert or update on public.mood_reminder_settings
for each row execute function private.assign_mood_reminder_identity();

alter table public.mood_reminder_settings enable row level security;
alter table public.mood_reminder_settings force row level security;

drop policy if exists mood_reminder_settings_select_self on public.mood_reminder_settings;
create policy mood_reminder_settings_select_self
on public.mood_reminder_settings for select to authenticated
using (user_id = auth.uid() and private.is_space_member(space_id));

drop policy if exists mood_reminder_settings_insert_self on public.mood_reminder_settings;
create policy mood_reminder_settings_insert_self
on public.mood_reminder_settings for insert to authenticated
with check (
  user_id = auth.uid()
  and space_id = private.current_profile_space_id()
  and private.is_space_member(space_id)
);

drop policy if exists mood_reminder_settings_update_self on public.mood_reminder_settings;
create policy mood_reminder_settings_update_self
on public.mood_reminder_settings for update to authenticated
using (user_id = auth.uid() and private.is_space_member(space_id))
with check (
  user_id = auth.uid()
  and space_id = private.current_profile_space_id()
  and private.is_space_member(space_id)
);

revoke all privileges on table public.mood_reminder_settings from public, anon, authenticated;
grant select, insert, update on table public.mood_reminder_settings to authenticated;

comment on table public.mood_reminder_settings is
  'Private per-user in-app mood check-in reminder preferences (Asia/Shanghai).';
