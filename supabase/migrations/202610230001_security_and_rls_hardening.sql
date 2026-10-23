-- ============================================================================
-- 全栈安全加固：Storage photos 存储桶细粒度 RLS 与 Moments 作者本人编辑策略
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- [01] 修复 storage.objects (photos 存储桶) RLS 策略
-- 移除过宽的遗留策略，收敛为情侣空间成员及本人目录隔离策略
-- ----------------------------------------------------------------------------
drop policy if exists allow_read on storage.objects;
drop policy if exists allow_upload on storage.objects;
drop policy if exists photos_select_space_member on storage.objects;
drop policy if exists photos_insert_own_folder on storage.objects;
drop policy if exists photos_update_own_folder on storage.objects;
drop policy if exists photos_delete_own_folder on storage.objects;

create policy photos_select_space_member
on storage.objects
for select
to authenticated
using (
  bucket_id = 'photos'
  and (
    (storage.foldername(name))[1] = 'avatars'
    or (
      (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and private.is_space_member(((storage.foldername(name))[1])::uuid)
    )
  )
);

create policy photos_insert_own_folder
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'photos'
  and (
    (
      (storage.foldername(name))[1] = 'avatars'
      and (storage.foldername(name))[2] = auth.uid()::text
    )
    or (
      (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and private.is_space_member(((storage.foldername(name))[1])::uuid)
      and (storage.foldername(name))[2] = auth.uid()::text
    )
  )
);

create policy photos_update_own_folder
on storage.objects
for update
to authenticated
using (
  bucket_id = 'photos'
  and (
    (
      (storage.foldername(name))[1] = 'avatars'
      and (storage.foldername(name))[2] = auth.uid()::text
    )
    or (
      (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and private.is_space_member(((storage.foldername(name))[1])::uuid)
    )
  )
)
with check (
  bucket_id = 'photos'
  and (
    (
      (storage.foldername(name))[1] = 'avatars'
      and (storage.foldername(name))[2] = auth.uid()::text
    )
    or (
      (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and private.is_space_member(((storage.foldername(name))[1])::uuid)
    )
  )
);

create policy photos_delete_own_folder
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'photos'
  and (
    (
      (storage.foldername(name))[1] = 'avatars'
      and (storage.foldername(name))[2] = auth.uid()::text
    )
    or (
      (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and private.is_space_member(((storage.foldername(name))[1])::uuid)
    )
  )
);

-- ----------------------------------------------------------------------------
-- [06] 修复 moments 更新策略与 RPC 函数（仅允许动态作者本人编辑）
-- ----------------------------------------------------------------------------
grant update on public.moments to authenticated;

drop policy if exists moments_update_space_members on public.moments;

create policy moments_update_space_members
on public.moments
for update
to authenticated
using (user_id = auth.uid() and private.is_space_member(space_id))
with check (user_id = auth.uid() and private.is_space_member(space_id));

create or replace function public.update_moment(
  p_moment_id bigint,
  p_content text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  signed_in_user uuid := auth.uid();
  caller_space_id uuid;
  target_space_id uuid;
  target_user_id uuid;
begin
  if signed_in_user is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select p.space_id into caller_space_id
  from public.profiles p
  where p.user_id = signed_in_user;

  if caller_space_id is null or not private.is_space_member(caller_space_id, signed_in_user) then
    raise exception 'Only space members may edit moments' using errcode = '42501';
  end if;

  select m.space_id, m.user_id into target_space_id, target_user_id
  from public.moments m
  where m.id = p_moment_id;

  if target_space_id is null then
    return false;
  end if;

  if target_space_id <> caller_space_id or not private.is_space_member(target_space_id, signed_in_user) then
    raise exception 'Only space members may edit moments' using errcode = '42501';
  end if;

  if target_user_id <> signed_in_user then
    raise exception 'Only the moment author may edit it' using errcode = '42501';
  end if;

  update public.moments m
  set type = 'moment',
      content = p_content
  where m.id = p_moment_id
    and m.space_id = caller_space_id
    and m.user_id = signed_in_user;

  return found;
end;
$function$;

revoke all on function public.update_moment(bigint, text) from public, anon;
grant execute on function public.update_moment(bigint, text) to authenticated;

notify pgrst, 'reload schema';

commit;
