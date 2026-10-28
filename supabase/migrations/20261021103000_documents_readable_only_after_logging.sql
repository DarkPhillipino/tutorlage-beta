-- Make the document access log impossible to skip (legal's option (a) in Drake/legal/doc-open-log-requirements-2026-10-21.md).
-- Until now an active admin could ask the storage service for a link to any tutor document or school result directly, around the admin
-- screens, so a record kept by the screens could be skipped. Apply AFTER 20261021100000_document_access_log.sql (it needs that table).
-- After this, an admin can read a stored file in 'tutor-documents' or 'school-results' only if THEIR OWN fresh line for that exact file
-- exists in public.document_access_log (written in the last 5 minutes by log_document_access()). Storage checks this read right when it
-- makes a signed link, so no line means no link. The people who may read their own files are unchanged: a tutor reads their own folder,
-- and a learner or guardian reads what they manage.
-- REPLACES two storage policies (same table, storage.objects):
--   "Admins read all tutor documents"                     -> dropped, replaced by "Admins read tutor documents they have logged"
--   "School results: learner, guardian or admin reads"    -> same name, same rule for learner and guardian; the admin part now needs a line
-- ORDER: the admin app must already log before it asks for a link (admin/src/lib/documentAccess.ts). An older installed copy of the
-- admin app does not, and would be refused a link after this migration: rebuild and replace the admin desktop copy BEFORE applying it.

create or replace function public.admin_may_read_document(p_bucket text, p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_admin()
     and exists (
       select 1 from public.document_access_log l
       where l.admin_id = auth.uid() and l.bucket = p_bucket and l.document_path = p_path
         and l.created_at > now() - interval '5 minutes');
$$;
revoke all on function public.admin_may_read_document(text, text) from public, anon, authenticated;
grant execute on function public.admin_may_read_document(text, text) to authenticated;

drop policy if exists "Admins read all tutor documents" on storage.objects;
drop policy if exists "Admins read tutor documents they have logged" on storage.objects;
create policy "Admins read tutor documents they have logged" on storage.objects for select to authenticated
  using (bucket_id = 'tutor-documents' and public.admin_may_read_document(bucket_id, name));

drop policy if exists "School results: learner, guardian or admin reads" on storage.objects;
create policy "School results: learner, guardian or admin reads" on storage.objects for select to authenticated
  using (bucket_id = 'school-results'
         and (public.can_manage_school_results_folder((storage.foldername(name))[1]) or public.admin_may_read_document(bucket_id, name)));
