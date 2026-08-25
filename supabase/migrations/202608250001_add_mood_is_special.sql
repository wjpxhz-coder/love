-- ============================================================================
-- 心情日历：添加“标记这一天” (is_special) 字段与索引
-- ============================================================================

alter table public.moods
  add column if not exists is_special boolean not null default false;

create index if not exists moods_space_date_special_idx
  on public.moods (space_id, date, is_special)
  where is_special = true;

-- 确保 authenticated 用户可以正常读写 is_special 字段
grant select, insert, update on public.moods to authenticated;

notify pgrst, 'reload schema';