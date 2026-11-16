-- THE OLD PAYOUT TABLES: FINANCE MAY READ, NOBODY MAY WRITE THROUGH THE API (P2 security round 2, group 2, 16 Nov 2026).
-- The hole: "Admins manage payouts" (public.payouts) and "Admins manage payout batches" (public.payout_batches) are FOR ALL TO authenticated USING
-- (public.is_active_admin()), so any active admin, a support agent too, could read, insert, change and delete money rows through the API.
-- Both tables are the OLD payout design: both hold 0 rows on production (read 16 Nov); the live payouts are public.payout_requests (wallet). Nothing in
-- src/, server/ or the admin app writes either table; the admin app reads payout_batches only (lib/queries.ts fetchPayoutBatches, a finance screen).
-- The SECURITY DEFINER retention and closure functions that touch payouts run as the owner and do not need the admin's rights.
--
-- WHAT THIS MIGRATION REPLACES
--   DROP    policy "Admins manage payouts"        on public.payouts          (was FOR ALL, any active admin)
--   CREATE  policy "Finance reads payouts"        on public.payouts          FOR SELECT TO authenticated USING (public.wallet_is_finance_admin())
--   DROP    policy "Admins manage payout batches" on public.payout_batches   (was FOR ALL, any active admin)
--   CREATE  policy "Finance reads payout batches" on public.payout_batches   FOR SELECT TO authenticated USING (public.wallet_is_finance_admin())
-- wallet_is_finance_admin() already exists (an active finance_manager or super_admin). Untouched: "Tutors view own payouts" (a tutor reads their own
-- rows), every other policy, every function, every table right, the server's service key.

drop policy if exists "Admins manage payouts" on public.payouts;
drop policy if exists "Finance reads payouts" on public.payouts;
create policy "Finance reads payouts" on public.payouts
  for select to authenticated
  using (public.wallet_is_finance_admin());

drop policy if exists "Admins manage payout batches" on public.payout_batches;
drop policy if exists "Finance reads payout batches" on public.payout_batches;
create policy "Finance reads payout batches" on public.payout_batches
  for select to authenticated
  using (public.wallet_is_finance_admin());
