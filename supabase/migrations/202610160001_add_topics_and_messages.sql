-- ============================================================================
-- 迁移：双人话题手账（恋爱小本本）- 幂等安全版
-- 表结构：public.topics, public.topic_messages
-- 支持状态流转、高光共识总结、富媒体（图片/语音）、站内通知与 Realtime
-- ============================================================================

begin;

-- 1. 创建话题表 public.topics
create table if not exists public.topics (
  id bigint generated always as identity primary key,
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  author text not null,
  title text not null check (length(btrim(title)) between 1 and 100),
  category text not null default 'general' check (category in ('reconciliation', 'study', 'trip', 'promise', 'life', 'general')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  summary text check (summary is null or length(summary) <= 3000),
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists topics_space_updated_idx
  on public.topics (space_id, updated_at desc);

create index if not exists topics_space_status_idx
  on public.topics (space_id, status);

-- 2. 创建话题消息流表 public.topic_messages（分离约束以保证绝对幂等）
create table if not exists public.topic_messages (
  id bigint generated always as identity primary key,
  topic_id bigint not null references public.topics(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  author text not null,
  content text check (content is null or length(content) <= 3000),
  photos text[] default '{}' check (photos is null or cardinality(photos) <= 9),
  audio_url text check (audio_url is null or length(audio_url) <= 1000),
  created_at timestamptz not null default now()
);

-- 安全更新检查约束
alter table public.topic_messages drop constraint if exists topic_messages_content_check;
alter table public.topic_messages add constraint topic_messages_content_check check (
  (content is not null and length(btrim(content)) > 0)
  or (photos is not null and cardinality(photos) > 0)
  or (audio_url is not null and length(btrim(audio_url)) > 0)
);

create index if not exists topic_messages_topic_created_idx
  on public.topic_messages (topic_id, created_at asc);

create index if not exists topic_messages_space_created_idx
  on public.topic_messages (space_id, created_at desc);

-- 3. 授权 authenticated 用户
grant select, insert, update, delete on table public.topics to authenticated;
grant select, insert, delete on table public.topic_messages to authenticated;

-- 4. 开启行级安全策略 (RLS)
alter table public.topics enable row level security;
alter table public.topic_messages enable row level security;

-- Topics 策略
drop policy if exists topics_select_member on public.topics;
create policy topics_select_member
on public.topics for select to authenticated
using (private.is_space_member(space_id));

drop policy if exists topics_insert_self on public.topics;
create policy topics_insert_self
on public.topics for insert to authenticated
with check (
  user_id = auth.uid()
  and author = private.current_username()
  and space_id = private.current_profile_space_id()
  and private.is_space_member(space_id)
);

drop policy if exists topics_update_member on public.topics;
create policy topics_update_member
on public.topics for update to authenticated
using (private.is_space_member(space_id))
with check (private.is_space_member(space_id));

drop policy if exists topics_delete_member on public.topics;
create policy topics_delete_member
on public.topics for delete to authenticated
using (private.is_space_member(space_id));

-- Topic Messages 策略
drop policy if exists topic_messages_select_member on public.topic_messages;
create policy topic_messages_select_member
on public.topic_messages for select to authenticated
using (private.is_space_member(space_id));

drop policy if exists topic_messages_insert_self on public.topic_messages;
create policy topic_messages_insert_self
on public.topic_messages for insert to authenticated
with check (
  user_id = auth.uid()
  and author = private.current_username()
  and space_id = private.current_profile_space_id()
  and private.is_space_member(space_id)
);

drop policy if exists topic_messages_delete_self on public.topic_messages;
create policy topic_messages_delete_self
on public.topic_messages for delete to authenticated
using (user_id = auth.uid() and private.is_space_member(space_id));

-- 5. 扩展通知类型支持 topic 与 topic_message
alter table public.notifications
  drop constraint if exists notifications_payload_limits;

alter table public.notifications
  add constraint notifications_payload_limits check (
    type is not null
    and type in ('moment', 'comment', 'like', 'miss', 'recalled', 'mood', 'topic', 'topic_message')
    and (content is null or length(content) <= 5000)
    and (read_by is null or cardinality(read_by) <= 2)
  );

-- 6. 升级 private.create_interaction_notification() 支持话题与消息
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
  if tg_op not in ('INSERT', 'UPDATE')
     or tg_table_schema <> 'public'
     or tg_table_name not in ('moments', 'comments', 'comment_likes', 'moods', 'topics', 'topic_messages') then
    raise exception 'Unsupported interaction notification trigger context';
  end if;

  if tg_table_name not in ('moods', 'topics') and tg_op <> 'INSERT' then
    raise exception 'Unsupported interaction notification trigger context';
  end if;

  if signed_in_user is null then
    return new;
  end if;

  -- 若是 moods 的 UPDATE，仅在核心数据改变时触发
  if tg_table_name = 'moods' and tg_op = 'UPDATE' then
    if old.score = new.score
       and old.note is not distinct from new.note
       and old.is_special is not distinct from new.is_special
       and old.photos is not distinct from new.photos then
      return new;
    end if;
  end if;

  -- 若是 topics 的 UPDATE，仅当状态改变为 resolved 时才推送“达成共识”通知
  if tg_table_name = 'topics' and tg_op = 'UPDATE' then
    if old.status = 'open' and new.status = 'resolved' then
      null;
    else
      return new;
    end if;
  end if;

  select p.username
    into actor_username
  from public.profiles p
  where p.user_id = signed_in_user
    and p.space_id = new.space_id;

  if (tg_table_name <> 'topics' or tg_op <> 'UPDATE') and (
     new.user_id is distinct from signed_in_user
     or new.author is distinct from actor_username
     or actor_username is null
     or not private.is_space_member(new.space_id, signed_in_user)
  ) then
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
  elsif tg_table_name = 'comment_likes' then
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
  elsif tg_table_name = 'moods' then
    notification_type := 'mood';
    notification_related_id := new.date::text;
    notification_content := json_build_object(
      'type', 'mood',
      'score', new.score,
      'note', new.note,
      'date', new.date,
      'is_special', coalesce(new.is_special, false),
      'has_photos', (new.photos is not null and cardinality(new.photos) > 0)
    )::text;
  elsif tg_table_name = 'topics' then
    notification_type := 'topic';
    notification_related_id := new.id::text;
    if tg_op = 'INSERT' then
      notification_content := json_build_object(
        'action', 'create',
        'title', new.title,
        'category', new.category
      )::text;
    else
      notification_content := json_build_object(
        'action', 'resolved',
        'title', new.title,
        'summary', new.summary
      )::text;
    end if;
  elsif tg_table_name = 'topic_messages' then
    notification_type := 'topic_message';
    notification_related_id := new.topic_id::text;
    notification_content := json_build_object(
      'message_id', new.id,
      'content', coalesce(new.content, ''),
      'has_photos', (new.photos is not null and cardinality(new.photos) > 0),
      'has_audio', (new.audio_url is not null)
    )::text;
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

-- 7. 绑定触发器到 topics 和 topic_messages
drop trigger if exists create_interaction_notification_after_insert on public.topics;
create trigger create_interaction_notification_after_insert
  after insert on public.topics
  for each row
  execute function private.create_interaction_notification();

drop trigger if exists create_interaction_notification_after_update on public.topics;
create trigger create_interaction_notification_after_update
  after update on public.topics
  for each row
  execute function private.create_interaction_notification();

drop trigger if exists create_interaction_notification_after_insert on public.topic_messages;
create trigger create_interaction_notification_after_insert
  after insert on public.topic_messages
  for each row
  execute function private.create_interaction_notification();

-- 8. 自动更新 topics.updated_at 的函数与触发器
create or replace function private.touch_topic_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.topics
  set updated_at = now()
  where id = new.topic_id;
  return new;
end
$function$;

drop trigger if exists touch_topic_updated_at_after_message on public.topic_messages;
create trigger touch_topic_updated_at_after_message
  after insert on public.topic_messages
  for each row
  execute function private.touch_topic_updated_at();

-- 9. 开启 Realtime publication (若 publication 已存在)
do $realtime_publication$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    execute 'alter publication supabase_realtime add table public.topics, public.topic_messages;';
  end if;
exception
  when duplicate_object then
    null;
end
$realtime_publication$;

commit;

notify pgrst, 'reload schema';
