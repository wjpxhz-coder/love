-- Run in the Supabase SQL Editor only after:
--   1. taking database + Storage backups;
--   2. applying 202607130001_auth_spaces_rls.sql;
--   3. creating the two email/password users in Authentication -> Users.
--
-- Replace both sentinel UUIDs with the real auth.users.id values. The guard and
-- foreign keys make an unedited copy fail without changing data.

begin;

do $provision$
declare
  snake_user_id uuid := '4580efe4-cffa-49a4-a9ba-2b70db239e5e';
  xi_user_id uuid := '323ed5d3-cef6-4743-acc8-fa7f6f2bfa4e';
  shared_space_id uuid := gen_random_uuid();
  result jsonb;
begin
  if snake_user_id::text like '00000000-0000-0000-0000-%'
     or xi_user_id::text like '00000000-0000-0000-0000-%' then
    raise exception 'Replace both sentinel UUIDs with real auth.users.id values';
  end if;

  if snake_user_id = xi_user_id then
    raise exception 'The two Auth user UUIDs must be different';
  end if;

  if not exists (select 1 from auth.users where id = snake_user_id)
     or not exists (select 1 from auth.users where id = xi_user_id) then
    raise exception 'One or both UUIDs do not exist in auth.users';
  end if;

  if not exists (select 1 from public.profiles where username = '小蛇')
     or not exists (select 1 from public.profiles where username = '小奚') then
    raise exception 'Expected legacy profiles 小蛇 and 小奚 before backfill';
  end if;

  insert into public.spaces (id, name, created_by)
  values (shared_space_id, '小蛇和小奚', snake_user_id);

  insert into public.space_members (space_id, user_id, role)
  values
    (shared_space_id, snake_user_id, 'owner'),
    (shared_space_id, xi_user_id, 'member');

  insert into private.legacy_identity_map (space_id, username, user_id)
  values
    (shared_space_id, '小蛇', snake_user_id),
    (shared_space_id, '小奚', xi_user_id);

  select private.backfill_legacy_space(shared_space_id) into result;

  raise notice 'Shared space UUID: %', shared_space_id;
  raise notice 'Backfill counts: %', result;
end
$provision$;

commit;
