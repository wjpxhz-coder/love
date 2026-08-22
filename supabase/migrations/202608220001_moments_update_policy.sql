-- ============================================================================
-- 允许空间成员更新动态内容 (编辑动态功能)
-- ============================================================================

grant update on public.moments to authenticated;

drop policy if exists moments_update_space_members on public.moments;

create policy moments_update_space_members
on public.moments
for update
to authenticated
using (private.is_space_member(space_id))
with check (private.is_space_member(space_id));

-- 提供原子化 RPC 更新函数作为补充
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
  target_space_id uuid;
begin
  if signed_in_user is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select m.space_id into target_space_id
  from public.moments m
  where m.id = p_moment_id;

  if target_space_id is null then
    return false;
  end if;

  if not private.is_space_member(target_space_id, signed_in_user) then
    raise exception 'Only space members may edit moments' using errcode = '42501';
  end if;

  update public.moments
  set type = 'moment',
      content = p_content
  where id = p_moment_id;

  return true;
end;
$function$;

revoke all on function public.update_moment(bigint, text) from public, anon;
grant execute on function public.update_moment(bigint, text) to authenticated;
