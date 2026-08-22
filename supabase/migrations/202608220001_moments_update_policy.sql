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
