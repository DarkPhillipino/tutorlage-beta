-- 2026-09-30 (second session). Found by Supabase's security advisor after 7o.
--
-- fn_expire_stale_session_requests(p_older_than_hours) was SECURITY DEFINER with no caller check and
-- was executable by anon: anyone holding the publishable key could call it with 0 and mark every
-- pending session request 'expired' — including paid ones, which it left payment_status = 'paid'.
-- The refund job only refunds pending+paid requests, so those students' money would have been stranded.
-- fn_accept_session_request / fn_decline_session_request are the pre-7i versions (accept priced the
-- session from the tutor's own rate, bypassing the stored price). No code calls any of the three;
-- they are revoked rather than dropped so nothing is lost if an old reference turns up.
--
-- The pg_cron jobs (expire_stale_paid_requests, reconcile_pending_refunds) run as the database owner
-- and don't need client EXECUTE. Trigger/event-trigger functions are never called directly; EXECUTE
-- is only checked when a trigger is created, so revoking it from clients changes nothing at run time.

revoke execute on function public.fn_expire_stale_session_requests(integer) from public, anon, authenticated;
revoke execute on function public.fn_accept_session_request(uuid) from public, anon, authenticated;
revoke execute on function public.fn_decline_session_request(uuid, text) from public, anon, authenticated;

revoke execute on function public.expire_stale_paid_requests() from public, anon, authenticated;
revoke execute on function public.reconcile_pending_refunds() from public, anon, authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_new_user_role_expansion() from public, anon, authenticated;
revoke execute on function public.enforce_tutor_age_on_verify() from public, anon, authenticated;
revoke execute on function public.trg_on_review_submitted() from public, anon, authenticated;
revoke execute on function public.trg_on_session_completed() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
