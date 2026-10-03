-- 2026-09-30 (third session). Follows 20260930234000; found while testing it.
--
-- Every "admins …" policy below was written for roles = public, so Postgres evaluates it for
-- signed-out (anon) callers too, and policy expressions run with the caller's privileges. On
-- production anon can't execute is_active_admin(), so a signed-out read of tutor_profiles or
-- credential_definitions (the two tables here anon may read) fails with "permission denied for
-- function is_active_admin" instead of returning the public rows. Dev only worked because
-- is_active_admin() was executable by PUBLIC there.
--
-- None of these policies can ever match a signed-out caller: each is is_active_admin() or
-- auth.uid() = …, and auth.uid() is null without a session. So each is scoped to authenticated,
-- and is_active_admin() is then callable by signed-in users only, on both databases — which is also
-- what Supabase's security advisor asks for.
--
-- Dev history, for the record: on dev this went in three steps — is_active_admin_signed_in_only
-- (the revoke, applied too early: it broke signed-out tutor_profiles reads), then
-- restore_is_active_admin_anon_execute (put the grant back), then this file. Production gets this
-- file in one step.

alter policy "Admins can read audit logs" on public.admin_audit_logs to authenticated;
alter policy "Admins can write own audit logs" on public.admin_audit_logs to authenticated;
alter policy "Admins can view all admin profiles" on public.admin_profiles to authenticated;
alter policy "Admins manage credential definitions" on public.credential_definitions to authenticated;
alter policy "Guardians and learners view consents" on public.guardian_consents to authenticated;
alter policy "Admins manage student links" on public.parent_student_links to authenticated;
alter policy "Admins manage payout batches" on public.payout_batches to authenticated;
alter policy "Admins manage payouts" on public.payouts to authenticated;
alter policy "Admins full control on disputes" on public.platform_disputes to authenticated;
alter policy "Users view own acceptances" on public.policy_acceptances to authenticated;
alter policy "Admins manage session requests" on public.session_requests to authenticated;
alter policy "Admins manage sessions" on public.sessions to authenticated;
alter policy "Admins update subject candidates" on public.subject_candidates to authenticated;
alter policy "Admins view all subject candidates" on public.subject_candidates to authenticated;
alter policy "Admins manage system settings" on public.system_settings to authenticated;
alter policy "Admins manage tutor credentials" on public.tutor_credentials to authenticated;
alter policy "Admins update tutor profiles" on public.tutor_profiles to authenticated;
alter policy "Admins view all tutor profiles" on public.tutor_profiles to authenticated;
alter policy "Admins manage verification audits" on public.tutor_verification_audits to authenticated;
alter policy "Admins manage verification documents" on public.tutor_verification_documents to authenticated;

revoke execute on function public.is_active_admin() from public, anon;
grant execute on function public.is_active_admin() to authenticated;
