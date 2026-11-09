-- ADMINS CAN READ SESSIONS AND SESSION REQUESTS, BUT NO LONGER WRITE THEM DIRECTLY (P2 security, 4 Nov 2026).
-- The hole: two policies written on 30 Sep 2026 (20260930100000_security_trust_boundaries.sql, scoped to signed-in users by 20260930235000)
--     "Admins manage session requests"  on public.session_requests   FOR ALL TO authenticated USING / WITH CHECK (public.is_active_admin())
--     "Admins manage sessions"          on public.sessions            FOR ALL TO authenticated USING / WITH CHECK (public.is_active_admin())
-- let EVERY active admin (a support agent too) insert, change and delete ANY row of both tables through the API, ANY column included:
-- charged_amount, gross_amount, tutor_payout_amount, platform_commission_pct, payment_status, status, the wallet and free flags, the Paystack
-- references. Row-level security cannot limit columns, and no audit row was written for such an edit.
--
-- What the admin app really does with these two tables (read from admin/src on 4 Nov 2026): it only READS them (the payments-needing-attention
-- list, the Phase 1 numbers, the dashboard counts, the alert counters, the wallet screens). It has no insert, update or delete on either table.
-- Money moves only through the audited SECURITY DEFINER admin functions (admin_refund_to_wallet, admin_adjust_wallet, admin_close_account ...),
-- which run as the database owner and so do not need the admin's own row rights. The one write the Disputes page does is to platform_disputes
-- (a different table, untouched here). So no new admin function is needed: the direct write right is simply removed.
--
-- WHAT THIS MIGRATION REPLACES (both policies are dropped and re-created as read-only, with new names):
--   DROP    policy "Admins manage session requests"  on public.session_requests   (was FOR ALL)
--   CREATE  policy "Admins read session requests"    on public.session_requests   FOR SELECT TO authenticated USING (public.is_active_admin())
--   DROP    policy "Admins manage sessions"          on public.sessions           (was FOR ALL)
--   CREATE  policy "Admins read sessions"            on public.sessions           FOR SELECT TO authenticated USING (public.is_active_admin())
-- Untouched: every other policy on both tables (learners', parents' and tutors' read rules, "Students create own session requests"), every
-- trigger, every function, every table right, the server's service key. Nothing is dropped except the two policies above.
-- Admin app: reads keep working before and after; only the comment naming the policy changed (admin/src/lib/queries.ts).

drop policy if exists "Admins manage session requests" on public.session_requests;
drop policy if exists "Admins read session requests" on public.session_requests;
create policy "Admins read session requests" on public.session_requests
  for select to authenticated
  using (public.is_active_admin());

drop policy if exists "Admins manage sessions" on public.sessions;
drop policy if exists "Admins read sessions" on public.sessions;
create policy "Admins read sessions" on public.sessions
  for select to authenticated
  using (public.is_active_admin());
