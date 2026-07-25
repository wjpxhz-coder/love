-- Supabase Storage evaluates the authenticated INSERT policy while creating a
-- placeholder object row, before final size/MIME metadata is populated.
--
-- Keep identity and path authorization in RLS. The private bucket's
-- authoritative file_size_limit/allowed_mime_types reject invalid payloads
-- before completion; SELECT and the Edge Function revalidate stored metadata,
-- and the Edge Function also verifies the real image file signature.

begin;

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
);

commit;
