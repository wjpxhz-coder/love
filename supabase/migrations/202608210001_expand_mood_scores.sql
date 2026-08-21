-- ============================================================================
-- 扩展心情打卡表情分值上限 (1 .. 30)
-- ============================================================================

alter table public.moods drop constraint if exists moods_payload_limits;

alter table public.moods
  add constraint moods_payload_limits check (
    score is not null
    and score between 1 and 30
    and (note is null or length(note) <= 300)
  );
