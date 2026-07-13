-- Read-only verification queries. Every query should return either the stated
-- value or rows that an administrator has deliberately reviewed.

-- 1) Exactly one space and exactly two mapped members/profiles are expected.
select s.id, s.name, count(sm.user_id) as member_count
from public.spaces s
left join public.space_members sm on sm.space_id = s.id
group by s.id, s.name;

select username, user_id, space_id, avatar_path
from public.profiles
order by username;

-- 2) These counts must all be zero before finalizing constraints.
select 'profiles' as relation, count(*) as unmapped
from public.profiles where user_id is null or space_id is null
union all select 'moments', count(*) from public.moments where user_id is null or space_id is null
union all select 'comments', count(*) from public.comments where user_id is null or space_id is null
union all select 'moods', count(*) from public.moods where user_id is null or space_id is null
union all select 'moment_likes', count(*) from public.moment_likes where user_id is null or space_id is null
union all select 'comment_likes', count(*) from public.comment_likes where user_id is null or space_id is null
union all select 'moment_stars', count(*) from public.moment_stars where user_id is null or space_id is null
union all select 'notifications', count(*) from public.notifications
  where actor_id is null or recipient_id is null or space_id is null
union all select 'ai_content', count(*) from public.ai_content where space_id is null;

-- 3) Anon must have no table privileges on private application data.
select table_schema, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon'
  and table_schema = 'public'
  and table_name in (
    'spaces', 'space_members', 'profiles', 'moments', 'comments', 'moods',
    'notifications', 'notification_receipts', 'ai_content', 'ai_chat_rate_limits', 'moment_likes',
    'comment_likes', 'moment_stars'
  )
order by table_name, privilege_type;

-- Expected: false for each public RPC.
select
  has_function_privilege('anon', 'public.send_miss_you()', 'execute') as anon_send_miss,
  has_function_privilege('anon', 'public.recall_and_delete_moment(bigint)', 'execute') as anon_recall_moment,
  has_function_privilege('anon', 'public.recall_and_delete_comment(bigint)', 'execute') as anon_recall_comment,
  has_function_privilege('anon', 'public.mark_notification_read(uuid)', 'execute') as anon_mark_one,
  has_function_privilege('anon', 'public.mark_all_notifications_read()', 'execute') as anon_mark_all,
  has_function_privilege('anon', 'public.claim_ai_chat_quota()', 'execute') as anon_ai_quota;

-- Expected: all false. Moments/comments are immutable after INSERT; authored
-- removal is available only through the transaction-safe recall RPCs.
select
  has_table_privilege('authenticated', 'public.moments', 'update') as moments_direct_update,
  has_table_privilege('authenticated', 'public.moments', 'delete') as moments_direct_delete,
  has_table_privilege('authenticated', 'public.comments', 'update') as comments_direct_update,
  has_table_privilege('authenticated', 'public.comments', 'delete') as comments_direct_delete,
  has_table_privilege('authenticated', 'public.notifications', 'insert') as notifications_direct_insert;

-- Expected: delete_action = CASCADE for all four parent/child constraints.
select
  conrelid::regclass as child_table,
  conname,
  case confdeltype
    when 'c' then 'CASCADE'
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
  end as delete_action,
  convalidated
from pg_constraint
where conname in (
  'comments_moment_space_fkey',
  'moment_likes_moment_space_fkey',
  'moment_stars_moment_space_fkey',
  'comment_likes_comment_space_fkey'
)
order by conname;

-- Expected: exactly these three AFTER INSERT rows. Review any additional
-- user-defined trigger on these tables before release to prevent duplicates.
select
  c.relname as source_table,
  t.tgname as trigger_name,
  pg_get_triggerdef(t.oid) as trigger_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('moments', 'comments', 'comment_likes')
  and not t.tgisinternal
  and t.tgname = 'create_interaction_notification_after_insert'
order by c.relname;

-- 4) Review the complete policy surface; there must be no USING(true) policy.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where (schemaname = 'public' and tablename in (
    'spaces', 'space_members', 'profiles', 'moments', 'comments', 'moods',
    'notifications', 'notification_receipts', 'ai_content', 'ai_chat_rate_limits', 'moment_likes',
    'comment_likes', 'moment_stars'
  ))
   or (schemaname = 'storage' and tablename = 'objects')
   or (schemaname = 'realtime' and tablename = 'messages')
order by schemaname, tablename, policyname;

-- 5) The bucket may remain true only during the documented compatibility
-- window. Production privacy cutover is complete only when this is false.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'photos';

-- Every new object must have valid UUIDs in path segments 1 and 2.
select count(*) as legacy_object_paths
from storage.objects
where bucket_id = 'photos'
  and (
    private.storage_path_uuid(name, 1) is null
    or private.storage_path_uuid(name, 2) is null
  );

-- Existing objects are not deleted by the new upload limits; review exceptions
-- before deciding whether they need transcoding or archival.
select
  count(*) filter (
    where private.storage_metadata_size(metadata) > 20971520
  ) as existing_over_20mb,
  count(*) filter (
    where metadata ->> 'mimetype' is null
       or not (split_part(lower(metadata ->> 'mimetype'), ';', 1) = any (array[
         'image/jpeg', 'image/png', 'image/webp', 'image/gif',
         'video/mp4', 'video/webm', 'video/quicktime',
         'audio/webm', 'audio/ogg', 'audio/mp4'
       ]::text[]))
  ) as existing_disallowed_mime
from storage.objects
where bucket_id = 'photos';
