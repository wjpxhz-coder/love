-- ============================================================================
-- 心情打卡：添加消息通知支持 (type = 'mood')
-- 无论是首次打卡 (INSERT) 还是后续更新 (UPDATE)，均生成站内通知推给对方
-- ============================================================================

-- 1. 更新 notifications 表的 type 检查约束，加入 'mood'
alter table public.notifications
  drop constraint if exists notifications_payload_limits;

alter table public.notifications
  add constraint notifications_payload_limits check (
    type is not null
    and type in ('moment', 'comment', 'like', 'miss', 'recalled', 'mood')
    and (content is null or length(content) <= 5000)
    and (read_by is null or cardinality(read_by) <= 2)
  );

-- 2. 升级 private.create_interaction_notification() 支持 moods 表
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
     or tg_table_name not in ('moments', 'comments', 'comment_likes', 'moods') then
    raise exception 'Unsupported interaction notification trigger context';
  end if;

  if tg_table_name <> 'moods' and tg_op <> 'INSERT' then
    raise exception 'Unsupported interaction notification trigger context';
  end if;

  -- Administrative/import writes do not impersonate a diary member and must
  -- not surprise either partner with an interaction notification.
  if signed_in_user is null then
    return new;
  end if;

  -- 若是 moods 的 UPDATE，仅在核心数据发生实质改变时才触发通知
  if tg_table_name = 'moods' and tg_op = 'UPDATE' then
    if old.score = new.score
       and old.note is not distinct from new.note
       and old.is_special is not distinct from new.is_special
       and old.photos is not distinct from new.photos then
      return new;
    end if;
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

revoke all on function private.create_interaction_notification() from public, anon, authenticated;

-- 3. 在 public.moods 上创建 INSERT 与 UPDATE 触发器
drop trigger if exists create_interaction_notification_after_insert on public.moods;
create trigger create_interaction_notification_after_insert
  after insert on public.moods
  for each row
  execute function private.create_interaction_notification();

drop trigger if exists create_interaction_notification_after_update on public.moods;
create trigger create_interaction_notification_after_update
  after update on public.moods
  for each row
  execute function private.create_interaction_notification();

notify pgrst, 'reload schema';
