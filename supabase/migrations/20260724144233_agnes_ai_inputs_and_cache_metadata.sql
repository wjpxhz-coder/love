-- Focused Agnes 2.0 cache metadata and private temporary-image storage.
--
-- This migration intentionally does not replay the July Auth/RLS migration or
-- change the legacy photos bucket's public flag. It only narrows the two known
-- broad legacy policies to photos and gives ai-inputs its own strict policies.

begin;

do $preflight$
declare
  missing_dependencies text;
begin
  select string_agg(dependency, ', ' order by dependency)
    into missing_dependencies
  from (
    values
      ('public.ai_content', to_regclass('public.ai_content') is not null),
      ('storage.buckets', to_regclass('storage.buckets') is not null),
      ('storage.objects', to_regclass('storage.objects') is not null),
      (
        'private.current_profile_space_id()',
        to_regprocedure('private.current_profile_space_id()') is not null
      ),
      (
        'private.is_space_member(uuid,uuid)',
        to_regprocedure('private.is_space_member(uuid,uuid)') is not null
      ),
      (
        'private.storage_metadata_size(jsonb)',
        to_regprocedure('private.storage_metadata_size(jsonb)') is not null
      ),
      (
        'private.storage_path_uuid(text,integer)',
        to_regprocedure('private.storage_path_uuid(text,integer)') is not null
      )
  ) required(dependency, present)
  where not present;

  if missing_dependencies is not null then
    raise exception
      'Agnes migration prerequisites are missing: %',
      missing_dependencies;
  end if;

  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'storage.buckets'::regclass
      and attname = 'file_size_limit'
      and not attisdropped
  ) or not exists (
    select 1
    from pg_attribute
    where attrelid = 'storage.buckets'::regclass
      and attname = 'allowed_mime_types'
      and not attisdropped
  ) then
    raise exception
      'Storage schema is incompatible: bucket upload-limit columns are missing';
  end if;
end
$preflight$;

-- Existing rows predate provider/model versioning and therefore belong to the
-- old DeepSeek cache namespace. New Agnes writes must provide all three fields.
alter table public.ai_content
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists prompt_version integer;

update public.ai_content
set provider = coalesce(nullif(btrim(provider), ''), 'deepseek'),
    model = coalesce(nullif(btrim(model), ''), 'deepseek-v4-flash'),
    prompt_version = coalesce(prompt_version, 1)
where provider is null
   or btrim(provider) = ''
   or model is null
   or btrim(model) = ''
   or prompt_version is null;

do $ai_content_metadata_constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ai_content'::regclass
      and conname = 'ai_content_model_metadata_valid'
  ) then
    alter table public.ai_content
      add constraint ai_content_model_metadata_valid check (
        provider = btrim(provider)
        and length(provider) between 1 and 32
        and model = btrim(model)
        and length(model) between 1 and 80
        and prompt_version > 0
      ) not valid;
  end if;
end
$ai_content_metadata_constraint$;

alter table public.ai_content
  validate constraint ai_content_model_metadata_valid;

alter table public.ai_content
  alter column provider set default 'deepseek',
  alter column model set default 'deepseek-v4-flash',
  alter column prompt_version set default 1,
  alter column provider set not null,
  alter column model set not null,
  alter column prompt_version set not null;

create index if not exists ai_content_cache_lookup_v2_idx
  on public.ai_content (
    space_id,
    type,
    provider,
    model,
    prompt_version,
    created_at desc
  );

-- Private, short-lived uploads for Agnes image analysis. Bucket-level limits
-- are authoritative and mirror the object metadata checks below.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'ai-inputs',
  'ai-inputs',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- These production policies historically allowed anonymous access to every
-- bucket. Preserve that compatibility only for photos so they cannot open the
-- new private bucket.
drop policy if exists allow_read on storage.objects;
create policy allow_read
on storage.objects for select
to anon, authenticated
using (bucket_id = 'photos');

drop policy if exists allow_upload on storage.objects;
create policy allow_upload
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'photos');

revoke all on function private.current_profile_space_id() from public, anon;
revoke all on function private.is_space_member(uuid, uuid) from public, anon;
revoke all on function private.storage_metadata_size(jsonb) from public, anon;
revoke all on function private.storage_path_uuid(text, integer) from public, anon;
grant execute on function private.current_profile_space_id() to authenticated;
grant execute on function private.is_space_member(uuid, uuid) to authenticated;
grant execute on function private.storage_metadata_size(jsonb) to authenticated;
grant execute on function private.storage_path_uuid(text, integer) to authenticated;

drop policy if exists ai_inputs_select_own on storage.objects;
create policy ai_inputs_select_own
on storage.objects for select
to authenticated
using (
  bucket_id = 'ai-inputs'
  and split_part(name, '/', 1) <> ''
  and split_part(name, '/', 2) <> ''
  and split_part(name, '/', 3) <> ''
  and name !~ '(^/|/$|//)'
  and private.storage_path_uuid(name, 1) =
    private.current_profile_space_id()
  and private.storage_path_uuid(name, 2) = (select auth.uid())
  and private.is_space_member(
    private.storage_path_uuid(name, 1),
    (select auth.uid())
  )
  and private.storage_metadata_size(metadata) between 1 and 10485760
  and btrim(split_part(lower(metadata ->> 'mimetype'), ';', 1)) = any (
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  )
);

drop policy if exists ai_inputs_insert_own on storage.objects;
create policy ai_inputs_insert_own
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'ai-inputs'
  and split_part(name, '/', 1) <> ''
  and split_part(name, '/', 2) <> ''
  and split_part(name, '/', 3) <> ''
  and name !~ '(^/|/$|//)'
  and private.storage_path_uuid(name, 1) =
    private.current_profile_space_id()
  and private.storage_path_uuid(name, 2) = (select auth.uid())
  and private.is_space_member(
    private.storage_path_uuid(name, 1),
    (select auth.uid())
  )
  and private.storage_metadata_size(metadata) between 1 and 10485760
  and btrim(split_part(lower(metadata ->> 'mimetype'), ';', 1)) = any (
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  )
);

drop policy if exists ai_inputs_delete_own on storage.objects;
create policy ai_inputs_delete_own
on storage.objects for delete
to authenticated
using (
  bucket_id = 'ai-inputs'
  and split_part(name, '/', 1) <> ''
  and split_part(name, '/', 2) <> ''
  and split_part(name, '/', 3) <> ''
  and name !~ '(^/|/$|//)'
  and private.storage_path_uuid(name, 1) =
    private.current_profile_space_id()
  and private.storage_path_uuid(name, 2) = (select auth.uid())
  and private.is_space_member(
    private.storage_path_uuid(name, 1),
    (select auth.uid())
  )
);

-- Deliberately no UPDATE policy: temporary objects are immutable.

commit;
