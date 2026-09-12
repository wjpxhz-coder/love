-- ============================================================================
-- 心情日历：添加多照片支持 (photos) 字段
-- ============================================================================

alter table public.moods
  add column if not exists photos text[] not null default '{}'::text[];

-- 约束：照片最多 9 张
do $constraint_photos_count$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.moods'::regclass
      and conname = 'moods_photos_count_check'
  ) then
    alter table public.moods
      add constraint moods_photos_count_check check (
        cardinality(photos) <= 9
      );
  end if;
end
$constraint_photos_count$;

-- 确保 authenticated 用户可以正常读写 photos 字段
grant select, insert, update on public.moods to authenticated;

notify pgrst, 'reload schema';
