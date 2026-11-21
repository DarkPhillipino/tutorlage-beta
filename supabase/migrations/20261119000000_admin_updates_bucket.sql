-- 2026-11-19, J2 (self-updating admin app, PM start brief 2): the PRIVATE feed the installed Tutorlage Admin reads its new pages from.
-- A new, private Storage bucket "admin-updates" (never public). Only an ACTIVE ADMIN can read objects in it (public.is_active_admin(), which is what the admin app's
-- sign-in is); nobody signed out, and no signed-in learner, parent or tutor, can read or list it. No API role can write, update or delete in it: releases are
-- uploaded with the linked Supabase CLI (the project's own service access), by `npm run publish-admin-update` in admin/desktop.
-- What is in it is only the built admin pages plus a manifest SIGNED with a private key that is kept off every repository: the installed program runs nothing
-- whose signature it does not verify, so reading the bucket gives nobody the power to push code. ADDITIVE: one new bucket and one new policy; no existing
-- table, function, policy or grant is touched. Rollback: see the file's last lines.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('admin-updates', 'admin-updates', false, 83886080, array['application/json', 'application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Active admins read admin updates" on storage.objects;
create policy "Active admins read admin updates" on storage.objects for select to authenticated
  using (bucket_id = 'admin-updates' and public.is_active_admin());

-- ROLLBACK (only if ever needed; remove the objects first in the dashboard or with `supabase storage rm`, Postgres refuses a direct delete from storage.objects):
--   drop policy if exists "Active admins read admin updates" on storage.objects;
--   delete from storage.buckets where id = 'admin-updates';
