-- Run after 01_provision_and_backfill.sql and after reviewing 03_verify.sql.
-- The transaction rolls back completely if any legacy row is still unmapped.

begin;

do $assert_complete$
declare
  incomplete text;
begin
  select string_agg(label, ', ' order by label)
    into incomplete
  from (
    select 'profiles' label where exists (
      select 1 from public.profiles where user_id is null or space_id is null
    )
    union all select 'moments' where exists (
      select 1 from public.moments where user_id is null or space_id is null
    )
    union all select 'comments' where exists (
      select 1 from public.comments where user_id is null or space_id is null
    )
    union all select 'moods' where exists (
      select 1 from public.moods where user_id is null or space_id is null
    )
    union all select 'moment_likes' where exists (
      select 1 from public.moment_likes where user_id is null or space_id is null
    )
    union all select 'comment_likes' where exists (
      select 1 from public.comment_likes where user_id is null or space_id is null
    )
    union all select 'moment_stars' where exists (
      select 1 from public.moment_stars where user_id is null or space_id is null
    )
    union all select 'notifications' where exists (
      select 1 from public.notifications
      where actor_id is null or recipient_id is null or space_id is null
    )
    union all select 'ai_content' where exists (
      select 1 from public.ai_content where space_id is null
    )
  ) failures;

  if incomplete is not null then
    raise exception 'Cannot finalize; unmapped rows remain in: %', incomplete;
  end if;
end
$assert_complete$;

alter table public.profiles validate constraint profiles_user_id_fkey;
alter table public.profiles validate constraint profiles_space_id_fkey;
alter table public.profiles validate constraint profiles_space_member_fkey;
alter table public.profiles validate constraint profiles_identity_required;
alter table public.profiles validate constraint profiles_content_limits;

alter table public.moments validate constraint moments_user_id_fkey;
alter table public.moments validate constraint moments_space_id_fkey;
alter table public.moments validate constraint moments_space_member_fkey;
alter table public.moments validate constraint moments_identity_required;
alter table public.moments validate constraint moments_payload_limits;

alter table public.comments validate constraint comments_user_id_fkey;
alter table public.comments validate constraint comments_space_id_fkey;
alter table public.comments validate constraint comments_space_member_fkey;
alter table public.comments validate constraint comments_moment_space_fkey;
alter table public.comments validate constraint comments_identity_required;
alter table public.comments validate constraint comments_payload_limits;

alter table public.moods validate constraint moods_user_id_fkey;
alter table public.moods validate constraint moods_space_id_fkey;
alter table public.moods validate constraint moods_space_member_fkey;
alter table public.moods validate constraint moods_identity_required;
alter table public.moods validate constraint moods_payload_limits;

alter table public.moment_likes validate constraint moment_likes_user_id_fkey;
alter table public.moment_likes validate constraint moment_likes_space_id_fkey;
alter table public.moment_likes validate constraint moment_likes_space_member_fkey;
alter table public.moment_likes validate constraint moment_likes_moment_space_fkey;
alter table public.moment_likes validate constraint moment_likes_identity_required;

alter table public.comment_likes validate constraint comment_likes_user_id_fkey;
alter table public.comment_likes validate constraint comment_likes_space_id_fkey;
alter table public.comment_likes validate constraint comment_likes_space_member_fkey;
alter table public.comment_likes validate constraint comment_likes_comment_space_fkey;
alter table public.comment_likes validate constraint comment_likes_identity_required;

alter table public.moment_stars validate constraint moment_stars_user_id_fkey;
alter table public.moment_stars validate constraint moment_stars_space_id_fkey;
alter table public.moment_stars validate constraint moment_stars_space_member_fkey;
alter table public.moment_stars validate constraint moment_stars_moment_space_fkey;
alter table public.moment_stars validate constraint moment_stars_identity_required;

alter table public.notifications validate constraint notifications_actor_id_fkey;
alter table public.notifications validate constraint notifications_recipient_id_fkey;
alter table public.notifications validate constraint notifications_space_id_fkey;
alter table public.notifications validate constraint notifications_actor_member_fkey;
alter table public.notifications validate constraint notifications_recipient_member_fkey;
alter table public.notifications validate constraint notifications_identity_required;
alter table public.notifications validate constraint notifications_payload_limits;

alter table public.ai_content validate constraint ai_content_created_by_fkey;
alter table public.ai_content validate constraint ai_content_space_id_fkey;
alter table public.ai_content validate constraint ai_content_creator_member_fkey;
alter table public.ai_content validate constraint ai_content_space_required;
alter table public.ai_content validate constraint ai_content_payload_limits;

alter table public.profiles
  alter column user_id set not null,
  alter column space_id set not null;
alter table public.moments
  alter column user_id set not null,
  alter column space_id set not null;
alter table public.comments
  alter column user_id set not null,
  alter column space_id set not null;
alter table public.moods
  alter column user_id set not null,
  alter column space_id set not null;
alter table public.moment_likes
  alter column user_id set not null,
  alter column space_id set not null;
alter table public.comment_likes
  alter column user_id set not null,
  alter column space_id set not null;
alter table public.moment_stars
  alter column user_id set not null,
  alter column space_id set not null;
alter table public.notifications
  alter column actor_id set not null,
  alter column recipient_id set not null,
  alter column space_id set not null;
alter table public.ai_content
  alter column space_id set not null;

-- Replace the transitional partial indexes with full unique indexes once the
-- identity columns are NOT NULL. PostgREST can then resolve ordinary
-- onConflict targets such as moods(user_id,date) reliably.
drop index if exists public.moods_user_date_uq;
create unique index moods_user_date_uq
  on public.moods (user_id, date);

drop index if exists public.moment_likes_moment_user_uq;
create unique index moment_likes_moment_user_uq
  on public.moment_likes (moment_id, user_id);

drop index if exists public.comment_likes_comment_user_uq;
create unique index comment_likes_comment_user_uq
  on public.comment_likes (comment_id, user_id);

drop index if exists public.moment_stars_moment_user_uq;
create unique index moment_stars_moment_user_uq
  on public.moment_stars (moment_id, user_id);

commit;
