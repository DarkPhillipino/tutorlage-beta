-- VERIFICATION DOCUMENTS AND THEIR AUDIT TRAIL: WHAT AN ADMIN MAY DO DIRECTLY (P2 security round 2, group 4, 16 Nov 2026).
-- The hole: two baseline policies are FOR ALL TO authenticated USING (public.is_active_admin()):
--   public.tutor_verification_documents  "Admins manage verification documents"   (ID, police clearance, qualifications; 9 rows)
--   public.tutor_verification_audits     "Admins manage verification audits"      (who decided what on which document; 9 rows)
-- so any active admin (a support agent too) could read every tutor's documents, change a status to "verified", delete a document, and edit or delete the
-- audit trail that proves who decided, all through the API. (The files themselves in storage are already gated: reading one needs a logged request,
-- policy "Admins read tutor documents they have logged".)
-- What the admin app really does (read from admin/src on 16 Nov): the Tutor Verification pages (verification_officer and super_admin only) READ documents
-- and UPDATE status, admin_notes and reviewed_at (queries.ts reviewDocument), then INSERT one audit row (reviewer_id = the signed-in admin). It never
-- inserts or deletes a document and never reads, edits or deletes an audit row.
--
-- WHAT THIS MIGRATION DOES (re-creates admin_role_in(text[]) first, identical to group 1, so the groups can be applied in any order)
--   documents: DROP "Admins manage verification documents"; CREATE "Verification staff read documents" (SELECT) and "Verification staff review documents"
--     (UPDATE, using and with check), both for admin_role_in(verification_officer, super_admin). No admin insert and no admin delete. The restrictive
--     policy "Founding gate: documents once a place has opened" and the tutors' own policies stay as they are.
--   audits: DROP "Admins manage verification audits"; CREATE "Verification staff read audits" (SELECT) and "Verification staff add audits" (INSERT,
--     with check: the role AND reviewer_id = auth.uid(), so an officer cannot write a decision in someone else's name). No update and no delete for anyone
--     through the API: the trail is append-only (retention_run_tutor_documents, SECURITY DEFINER, still removes old rows by the retention rule).
-- Untouched: the triggers guard_verification_documents, guard_held_documents and tutor_onboarding_stamp_on_document, every storage policy, every function.

create or replace function public.admin_role_in(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.admin_profiles a
    where a.id = auth.uid() and a.is_active and a.admin_role::text = any (p_roles)
  );
$$;
revoke all on function public.admin_role_in(text[]) from public, anon;
grant execute on function public.admin_role_in(text[]) to authenticated;

-- ---- documents -----------------------------------------------------------------------------------------------------------------------------------
drop policy if exists "Admins manage verification documents" on public.tutor_verification_documents;
drop policy if exists "Verification staff read documents" on public.tutor_verification_documents;
create policy "Verification staff read documents" on public.tutor_verification_documents
  for select to authenticated
  using (public.admin_role_in(array['verification_officer', 'super_admin']));
drop policy if exists "Verification staff review documents" on public.tutor_verification_documents;
create policy "Verification staff review documents" on public.tutor_verification_documents
  for update to authenticated
  using (public.admin_role_in(array['verification_officer', 'super_admin']))
  with check (public.admin_role_in(array['verification_officer', 'super_admin']));

-- ---- audits --------------------------------------------------------------------------------------------------------------------------------------
drop policy if exists "Admins manage verification audits" on public.tutor_verification_audits;
drop policy if exists "Verification staff read audits" on public.tutor_verification_audits;
create policy "Verification staff read audits" on public.tutor_verification_audits
  for select to authenticated
  using (public.admin_role_in(array['verification_officer', 'super_admin']));
drop policy if exists "Verification staff add audits" on public.tutor_verification_audits;
create policy "Verification staff add audits" on public.tutor_verification_audits
  for insert to authenticated
  with check (public.admin_role_in(array['verification_officer', 'super_admin']) and reviewer_id = auth.uid());
