-- Final Storage privacy cutover. This script never deletes or moves an object.
-- It refuses to proceed while any object still uses a legacy path because those
-- paths would become inaccessible under the strict RLS policies.

begin;

do $storage_preflight$
declare
  legacy_paths bigint;
begin
  select count(*)
    into legacy_paths
  from storage.objects
  where bucket_id = 'photos'
    and (
      private.storage_path_uuid(name, 1) is null
      or private.storage_path_uuid(name, 2) is null
    );

  if legacy_paths > 0 then
    raise exception
      'Storage cutover blocked: % objects still use legacy paths',
      legacy_paths;
  end if;

  if exists (
    select 1
    from public.profiles
    where nullif(avatar_url, '') is not null
      and nullif(avatar_path, '') is null
  ) then
    raise exception
      'Storage cutover blocked: a profile still has avatar_url without avatar_path';
  end if;
end
$storage_preflight$;

update storage.buckets
set public = false
where id = 'photos';

commit;

