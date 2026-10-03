-- 2026-09-30, backlog 7h: there was no way for a tutor to upload any document, so "documents
-- reviewed" claims were false and the CEO's screening decision (collect each tester's clearance
-- documents) had nowhere to land. A private bucket: each tutor reads and writes only their own
-- folder (<tutor id>/...); active admins can read everything to review it. Files are never public;
-- the admin app opens them through short-lived signed links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tutor-documents', 'tutor-documents', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Tutors upload own documents" on storage.objects;
create policy "Tutors upload own documents" on storage.objects for insert to authenticated
  with check (bucket_id = 'tutor-documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Tutors read own documents" on storage.objects;
create policy "Tutors read own documents" on storage.objects for select to authenticated
  using (bucket_id = 'tutor-documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Tutors delete own documents" on storage.objects;
create policy "Tutors delete own documents" on storage.objects for delete to authenticated
  using (bucket_id = 'tutor-documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Admins read all tutor documents" on storage.objects;
create policy "Admins read all tutor documents" on storage.objects for select to authenticated
  using (bucket_id = 'tutor-documents' and public.is_active_admin());
