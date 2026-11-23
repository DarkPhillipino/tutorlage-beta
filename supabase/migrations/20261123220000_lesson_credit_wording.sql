-- 2026-11-23, JOB W (PM line 50, CEO order): "lesson credit" wording in the database's user-visible texts. Only the TEXT of in-app notices and refusal messages changes; no logic, no name, no right.
-- Parents and learners read "credit" / "lesson credit"; tutors read "earnings" (their balance screen is "Your earnings"). Each function below is the current production text with ONLY the listed string literals changed
-- (generated from the live definitions, so nothing else in them moves). Existing rights are kept (create or replace). Rollback: the same statements with the old words (Drake/programmer/rollbacks/20261123220000_lesson_credit_wording_ROLLBACK.sql).
--   admin_adjust_wallet: "Your wallet was updated" -> "Your balance was updated" (1x)
--   admin_adjust_wallet: "Tutorlage %s R%s %s your wallet. Note: %s" -> "Tutorlage %s R%s %s your balance. Note: %s" (1x)
--   admin_mark_payout_cannot_pay: "The money is back in your wallet. %s" -> "The money is back in your earnings. %s" (1x)
--   admin_refund_to_wallet: "A refund was added to your wallet" -> "A refund was added to your credit" (1x)
--   admin_refund_to_wallet: "R%s was added to your wallet as a refund for your session on %s. %s" -> "R%s was added to your credit as a refund for your session on %s. %s" (1x)
--   admin_refund_to_wallet: "Your wallet was updated" -> "Your balance was updated" (1x)
--   admin_refund_to_wallet: "R%s was taken from your wallet because the learner was refunded for your session on %s." -> "R%s was taken from your earnings because the learner was refunded for your session on %s." (1x)
--   admin_return_wallet_money: "R%s was taken out of your wallet and sent back to your bank account. Note: %s" -> "R%s was taken out of your credit and sent back to your bank account. Note: %s" (1x)
--   closure_cancel_session: "The full price is back in your wallet as credit." -> "The full price is back in your credit." (1x)
--   create_online_topup: "Only an adult can add money to a wallet. A parent adds money for their children." -> "Only an adult can add lesson credit. A parent adds credit for their children." (1x)
--   create_online_topup: "That would take your wallet above R%. You can add up to R% now." -> "That would take your credit above R%. You can add up to R% now." (1x)
--   create_wallet_topup: "Only an adult can add money to a wallet. A parent adds money for their children." -> "Only an adult can add lesson credit. A parent adds credit for their children." (1x)
--   create_wallet_topup: "That would take your wallet above R%. You can add up to R% now." -> "That would take your credit above R%. You can add up to R% now." (1x)
--   create_wallet_session: "This request has no money on hold in a wallet." -> "This request has no money on hold in your credit." (1x)
--   create_wallet_session: "was taken from your wallet. Open Sessions" -> "was taken from your credit. Open Sessions" (1x)
--   send_request_wallet: "The wallet can only pay for requests in rand (ZAR)." -> "Credit can only pay for requests in rand (ZAR)." (1x)
--   tutor_bonus_pay: "Bonus added to your wallet" -> "Bonus added to your earnings" (1x)
--   tutor_bonus_pay: "R%s was added to your wallet: a family who joined with your code had a lesson." -> "R%s was added to your earnings: a family who joined with your code had a lesson." (1x)
--   tutor_bonus_take_back: "Your wallet was updated" -> "Your balance was updated" (1x)
--   tutor_bonus_take_back: "R%s was taken from your wallet because a family was refunded for a lesson your referral bonus was paid on." -> "R%s was taken from your earnings because a family was refunded for a lesson your referral bonus was paid on." (1x)
--   wallet_credit_card_session: "Money added to your wallet" -> "Money added to your earnings" (1x)
--   wallet_credit_card_session: "R%s for a completed session was added to your wallet." -> "R%s for a completed session was added to your earnings." (1x)
--   wallet_credit_tutor: "Money added to your wallet" -> "Money added to your earnings" (1x)
--   wallet_credit_tutor: "R%s for a completed session was added to your wallet." -> "R%s for a completed session was added to your earnings." (1x)
--   wallet_credit_topup: "Money added to your wallet" -> "Money added to your credit" (1x)
--   wallet_credit_topup: "R%s was added to your wallet (reference %s)." -> "R%s was added to your credit (reference %s)." (1x)
--   wallet_hold_for_request: "Your wallet has R%. This session is R%. Add R% or more." -> "Your credit has R%. This session is R%. Add R% or more." (1x)
--   decline_session_request: "is back in your wallet." -> "is back in your credit." (1x)
--   expire_stale_paid_requests: "is back in your wallet." -> "is back in your credit." (2x)

-- admin_adjust_wallet
CREATE OR REPLACE FUNCTION public.admin_adjust_wallet(p_profile uuid, p_amount integer, p_reason text, p_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ledger uuid;
  v_available integer;
begin
  if auth.uid() is null or not exists (select 1 from public.admin_profiles a where a.id = auth.uid() and a.is_active and a.admin_role = 'super_admin') then
    raise exception 'Super admins only' using errcode = '42501';
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000 then
    raise exception 'Give the amount to add or remove, in whole rands (not 0)' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 5 or length(v_reason) > 500 then
    raise exception 'A written reason is needed (5 to 500 characters)' using errcode = '22023';
  end if;
  if p_key is null then
    raise exception 'The screen must send a one-time key' using errcode = '22023';
  end if;
  select id into v_ledger from public.wallet_ledger where idempotency_key = 'adjust:' || p_key;
  if found then
    return jsonb_build_object('ledger_id', v_ledger, 'already', true);
  end if;
  select available_rand into v_available from public.wallets where profile_id = p_profile;
  if p_amount < 0 and coalesce(v_available, 0) < -p_amount then
    raise exception 'The wallet holds R% available; an adjustment never takes it below zero.', coalesce(v_available, 0) using errcode = '22023';
  end if;
  v_ledger := public.wallet_post(p_profile, 'adjustment', p_amount, 0, 'adjust:' || p_key, auth.uid(), v_reason, null, null, null, null);
  perform public.wallet_notify(p_profile, 'wallet_adjusted', 'Your balance was updated',
    format('Tutorlage %s R%s %s your balance. Note: %s', case when p_amount > 0 then 'added' else 'removed' end, abs(p_amount),
           case when p_amount > 0 then 'to' else 'from' end, v_reason));
  perform public.log_admin_event('wallet_adjusted', 'wallet', p_profile, jsonb_build_object('amount_rand', p_amount, 'reason', v_reason));
  return jsonb_build_object('ledger_id', v_ledger, 'already', false);
end;
$function$;

-- admin_mark_payout_cannot_pay
CREATE OR REPLACE FUNCTION public.admin_mark_payout_cannot_pay(p_payout uuid, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.payout_requests;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  select * into r from public.payout_requests where id = p_payout for update;
  if not found then
    raise exception 'No such payout request' using errcode = 'P0002';
  end if;
  if r.status = 'could_not_pay' then
    return jsonb_build_object('payout_id', r.id, 'status', r.status, 'already', true);
  end if;
  if r.status <> 'requested' then
    raise exception 'This payout was already paid.' using errcode = '55000';
  end if;
  if v_comment is null or length(v_comment) < 3 then
    raise exception 'Write a comment: the tutor will read it' using errcode = '22023';
  end if;
  perform public.wallet_post(r.tutor_id, 'payout_release', r.amount_rand, -r.amount_rand, 'payrel:' || r.id, auth.uid(), v_comment, null, null, null, r.id);
  update public.payout_requests set status = 'could_not_pay', decided_by = auth.uid(), decided_at = now(), decision_comment = v_comment where id = r.id;
  perform public.wallet_notify(r.tutor_id, 'wallet_payout_failed', 'Your payout could not be paid',
    format('We could not pay your R%s request. The money is back in your earnings. %s', r.amount_rand, v_comment));
  perform public.log_admin_event('wallet_payout_cannot_pay', 'payout_request', r.id, jsonb_build_object('amount_rand', r.amount_rand));
  return jsonb_build_object('payout_id', r.id, 'status', 'could_not_pay', 'already', false);
end;
$function$;

-- admin_refund_to_wallet
CREATE OR REPLACE FUNCTION public.admin_refund_to_wallet(p_session uuid, p_amount integer, p_comment text, p_take_back boolean, p_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_old uuid;
  s public.sessions;
  r public.session_requests;
  v_price integer;
  v_done integer;
  v_credit integer;
  v_reversed integer;
  v_reduce integer := 0;
  v_reduced integer := 0;
  v_short integer := 0;
  v_ledger uuid;
  v_day text;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  if p_key is null then
    raise exception 'The screen must send a one-time key' using errcode = '22023';
  end if;
  select l.id into v_old from public.wallet_ledger l where l.idempotency_key = 'adminrefund:' || p_key;
  if found then
    return jsonb_build_object('ledger_id', v_old, 'already', true);
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000 then
    raise exception 'Give the amount to refund, in whole rands (at least 1)' using errcode = '22023';
  end if;
  if v_comment is null or length(v_comment) < 5 or length(v_comment) > 500 then
    raise exception 'A written reason is needed (5 to 500 characters)' using errcode = '22023';
  end if;
  select * into s from public.sessions where id = p_session for update;
  if not found then
    raise exception 'No such session' using errcode = 'P0002';
  end if;
  select * into r from public.session_requests q where q.resulting_session_id = p_session and q.paid_from_wallet for update;
  if not found or not s.wallet_paid then
    raise exception 'That session was not paid from a wallet' using errcode = '22023';
  end if;
  if s.status <> 'completed' then
    raise exception 'Only a finished session can be refunded here. A booked session is cancelled instead, and then the refund is automatic.' using errcode = '55000';
  end if;
  v_price := r.wallet_hold_rand;
  select coalesce(sum(l.available_delta), 0) into v_done from public.wallet_ledger l
  where l.kind = 'refund' and l.session_id = p_session and l.profile_id = r.requested_by_profile_id;
  if p_amount > v_price - v_done then
    raise exception 'At most R% can still be refunded for this session: it cost R%, and R% already went back.', v_price - v_done, v_price, v_done using errcode = '22023';
  end if;
  select l.available_delta into v_credit from public.wallet_ledger l where l.idempotency_key = 'credit:' || p_session;
  select coalesce(-sum(l.available_delta), 0) into v_reversed from public.wallet_ledger l where l.kind = 'refund_reversal' and l.session_id = p_session;
  if coalesce(p_take_back, false) and v_credit is not null and s.tutor_id is not null then
    v_reduce := greatest(round((v_done + p_amount)::numeric * v_credit / v_price)::integer - v_reversed, 0);
  end if;
  v_ledger := public.wallet_post(r.requested_by_profile_id, 'refund', p_amount, 0, 'adminrefund:' || p_key, auth.uid(), v_comment, r.id, p_session);
  if v_reduce > 0 then
    begin
      perform public.wallet_post(s.tutor_id, 'refund_reversal', -v_reduce, 0, 'adminrefundtutor:' || p_key, auth.uid(), 'The learner was refunded for this session', r.id, p_session);
      v_reduced := v_reduce;
    exception when others then
      if sqlerrm <> 'wallet_too_low' then
        raise;
      end if;
      v_short := v_reduce;
    end;
  end if;
  -- TUTOR BONUS refund (CEO, 10 Nov 2026): the referral bonus paid on this lesson is reduced by the same share, only with "take back from the tutor"; never blocks the refund
  begin
    perform public.tutor_bonus_take_back(p_session, v_done + p_amount, v_price, coalesce(p_take_back, false), p_key);
  exception when others then
    perform public.wallet_notify_finance('tutor_bonus_failed', 'A tutor bonus could not be reduced',
      format('Session %s was refunded but its referral bonus could not be reduced: %s', p_session, sqlerrm));
  end;
  v_day := to_char(s.scheduled_start at time zone 'Africa/Johannesburg', 'FMDD FMMon');
  perform public.wallet_notify(r.requested_by_profile_id, 'wallet_refunded', 'A refund was added to your credit',
    format('R%s was added to your credit as a refund for your session on %s. %s', p_amount, v_day, v_comment));
  if v_reduced > 0 then
    perform public.wallet_notify(s.tutor_id, 'wallet_adjusted', 'Your balance was updated',
      format('R%s was taken from your earnings because the learner was refunded for your session on %s.', v_reduced, v_day));
  end if;
  perform public.log_admin_event('wallet_refunded_to_learner', 'session', p_session,
    jsonb_build_object('amount_rand', p_amount, 'tutor_reduced_rand', v_reduced, 'tutor_shortfall_rand', v_short, 'reason', v_comment));
  return jsonb_build_object('ledger_id', v_ledger, 'already', false, 'refunded_rand', p_amount, 'refunded_total_rand', v_done + p_amount, 'price_rand', v_price,
    'tutor_credited', v_credit is not null, 'tutor_reduced_rand', v_reduced, 'tutor_shortfall_rand', v_short);
end;
$function$;

-- admin_return_wallet_money
CREATE OR REPLACE FUNCTION public.admin_return_wallet_money(p_profile uuid, p_amount integer, p_reason text, p_bank_reference text, p_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ref text := nullif(btrim(coalesce(p_bank_reference, '')), '');
  v_old uuid;
  v_avail integer;
  v_held integer;
  v_ledger uuid;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  if p_key is null then
    raise exception 'The screen must send a one-time key' using errcode = '22023';
  end if;
  select l.id into v_old from public.wallet_ledger l where l.idempotency_key = 'return:' || p_key;
  if found then
    return jsonb_build_object('ledger_id', v_old, 'already', true);
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000 then
    raise exception 'Give the amount returned, in whole rands (at least 1)' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 5 or length(v_reason) > 400 then
    raise exception 'A written reason is needed (5 to 400 characters), for example who asked and how you checked it was them' using errcode = '22023';
  end if;
  if v_ref is not null and length(v_ref) > 60 then
    raise exception 'The bank reference is too long (60 characters at most)' using errcode = '22023';
  end if;
  select w.available_rand, w.held_rand into v_avail, v_held from public.wallets w where w.profile_id = p_profile;
  if not found then
    raise exception 'That person has no wallet' using errcode = 'P0002';
  end if;
  if p_amount > v_avail then
    raise exception 'The wallet has R% available (and R% on hold). Money on hold belongs to a payout request: mark that request paid or cannot-pay first.', v_avail, v_held using errcode = '22023';
  end if;
  v_ledger := public.wallet_post(p_profile, 'withdrawal', -p_amount, 0, 'return:' || p_key, auth.uid(),
                                 'Returned by hand: ' || v_reason || coalesce(' (bank reference ' || v_ref || ')', ''), null, null, null, null);
  if not exists (select 1 from public.account_closures c where c.profile_id = p_profile and c.status in ('closed', 'db_deleted', 'done')) then
    perform public.wallet_notify(p_profile, 'wallet_money_returned', 'Money was returned to you',
      format('R%s was taken out of your credit and sent back to your bank account. Note: %s', p_amount, v_reason));
  end if;
  perform public.log_admin_event('wallet_money_returned', 'wallet', p_profile, jsonb_build_object('amount_rand', p_amount, 'reason', v_reason, 'bank_reference', v_ref));
  return jsonb_build_object('ledger_id', v_ledger, 'already', false, 'returned_rand', p_amount, 'available_rand', v_avail - p_amount);
end;
$function$;

-- closure_cancel_session
CREATE OR REPLACE FUNCTION public.closure_cancel_session(p_session uuid, p_by_tutor boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_s record;
  v_r record;
  v_out text;
begin
  select id, student_id, tutor_id, status, scheduled_start, booked_by_profile_id into v_s from public.sessions where id = p_session for update;
  if not found or v_s.status not in ('scheduled', 'pending_confirmation') or now() >= v_s.scheduled_start then
    return 'skipped';
  end if;
  select * into v_r from public.session_requests where resulting_session_id = p_session for update;
  -- FREE SESSIONS (CEO, 2 Nov 2026): nothing was charged, so nothing to refund and nothing for an admin to check.
  if found and v_r.payment_status = 'free' then
    update public.session_requests set status = 'cancelled' where id = v_r.id and status <> 'cancelled';
    v_out := 'cancelled';
  elsif found and v_r.payment_status = 'wallet_paid' then
    -- WALLET BOOKING closure (CEO, 2 Nov 2026): the full price goes back to the payer's wallet as credit; no card, no Paystack call.
    perform public.wallet_post(v_r.requested_by_profile_id, 'refund', v_r.wallet_hold_rand, 0, 'refund:' || p_session, null,
                               'Session cancelled by an account closure', v_r.id, p_session);
    update public.session_requests set status = 'cancelled', payment_status = 'wallet_refunded' where id = v_r.id;
    v_out := 'refunded';
  elsif found and v_r.payment_status = 'paid' then
    perform public.closure_refund(v_r.id, 'cancelled');
    v_out := 'refunded';
  else
    if found then
      update public.session_requests set status = 'cancelled' where id = v_r.id and status <> 'cancelled';
    end if;
    perform public.notify_active_admins('closure_session_unpaid', 'A closed account had a session with nothing to refund',
      'Session ' || p_session || ' was cancelled by an account closure but no paid request was found for it. Please check it.', p_session);
    v_out := 'cancelled';
  end if;
  update public.sessions
  set status = case when p_by_tutor then 'cancelled_by_tutor'::public.session_status else 'cancelled_by_student'::public.session_status end
  where id = p_session;
  if p_by_tutor then
    insert into public.notifications (profile_id, type, title, body, related_session_id)
    select distinct p, 'session_cancelled', 'A session was cancelled',
           'Your tutor cancelled the session.' || case when v_out = 'refunded' and v_r.payment_status = 'wallet_paid' /* WALLET BOOKING closure notice (CEO, 2 Nov 2026) */
             then ' The full price is back in your credit.'
             when v_out = 'refunded'
             then ' Your payment is being refunded in full — once Paystack has processed it, it can take up to 10 business days to reach your account.' else '' end,
           p_session
    from unnest(array[v_s.student_id, v_s.booked_by_profile_id]) as p where p is not null;
  else
    insert into public.notifications (profile_id, type, title, body, related_session_id)
    values (v_s.tutor_id, 'session_cancelled', 'A session was cancelled', 'The learner cancelled the session.', p_session);
  end if;
  return v_out;
end;
$function$;

-- create_online_topup
CREATE OR REPLACE FUNCTION public.create_online_topup(p_amount integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  v_min integer := public.wallet_int_setting('wallet_topup_min_rand', 50);
  v_max integer := public.wallet_int_setting('wallet_topup_max_rand', 5000);
  v_cap integer := public.wallet_int_setting('wallet_balance_cap_rand', 10000);
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_balance integer;
  v_pending integer;
  v_n integer;
  v_bytes bytea;
  v_ref text;
  v_id uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.wallet_open() then
    raise exception 'Wallet payments are not open.' using errcode = '55000';
  end if;
  if not public.is_adult(uid) then
    raise exception 'Only an adult can add lesson credit. A parent adds credit for their children.' using errcode = '22023';
  end if;
  if not public.wallet_online_allowed(uid) then
    raise exception 'Paying with your bank is not switched on yet.' using errcode = '55000';
  end if;
  if p_amount is null or p_amount < v_min or p_amount > v_max then
    raise exception 'Add between R% and R% at a time, in whole rands.', v_min, v_max using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wallet_topup:' || uid::text, 0));
  select count(*) into v_n from public.wallet_topups where profile_id = uid and status = 'awaiting_payment';
  if v_n >= public.wallet_int_setting('wallet_topup_max_waiting', 3) then
    raise exception 'You already have % online payments waiting. Finish one, or wait about an hour for it to expire, first.', v_n using errcode = '55000';
  end if;
  select count(*) into v_n from public.wallet_topups where profile_id = uid and created_at > now() - interval '24 hours';
  if v_n >= public.wallet_int_setting('wallet_topup_max_per_day', 10) then
    raise exception 'You have made many top-up requests today. Please try again tomorrow.' using errcode = '55000';
  end if;
  select coalesce(available_rand + held_rand, 0) into v_balance from public.wallets where profile_id = uid;
  select coalesce(sum(amount_rand), 0) into v_pending from public.wallet_topups where profile_id = uid and status in ('awaiting_proof', 'proof_sent', 'awaiting_payment');
  if coalesce(v_balance, 0) + v_pending + p_amount > v_cap then
    raise exception 'That would take your credit above R%. You can add up to R% now.', v_cap, greatest(v_cap - coalesce(v_balance, 0) - v_pending, 0) using errcode = '22023';
  end if;
  for i in 1..10 loop
    v_bytes := decode(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), 'hex');
    v_ref := 'TL-' || (select string_agg(substr(v_alpha, (get_byte(v_bytes, g) % 32) + 1, 1), '' order by g) from generate_series(0, 5) g);
    begin
      insert into public.wallet_topups (profile_id, method, status, reference, amount_rand) values (uid, 'online', 'awaiting_payment', v_ref, p_amount) returning id into v_id;
      exit;
    exception when unique_violation then
      v_id := null;
    end;
  end loop;
  if v_id is null then
    raise exception 'Could not create a reference. Please try again.' using errcode = '55000';
  end if;
  return jsonb_build_object('topup_id', v_id, 'reference', v_ref, 'amount_rand', p_amount, 'status', 'awaiting_payment', 'method', 'online');
end;
$function$;

-- create_wallet_topup
CREATE OR REPLACE FUNCTION public.create_wallet_topup(p_amount integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  v_min integer := public.wallet_int_setting('wallet_topup_min_rand', 50);
  v_max integer := public.wallet_int_setting('wallet_topup_max_rand', 5000);
  v_cap integer := public.wallet_int_setting('wallet_balance_cap_rand', 10000);
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_balance integer;
  v_pending integer;
  v_n integer;
  v_bytes bytea;
  v_ref text;
  v_id uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.wallet_open() then
    raise exception 'Wallet payments are not open.' using errcode = '55000';
  end if;
  if not public.is_adult(uid) then
    raise exception 'Only an adult can add lesson credit. A parent adds credit for their children.' using errcode = '22023';
  end if;
  select count(*) into v_n from public.system_settings s
  where s.setting_key in ('wallet_bank_name', 'wallet_bank_account_holder', 'wallet_bank_account_number', 'wallet_bank_branch_code')
    and length(btrim(coalesce(s.setting_value #>> '{}', ''))) > 0;
  if v_n < 4 then
    raise exception 'Our bank details are not set up yet. Please try again later.' using errcode = '55000';
  end if;
  if p_amount is null or p_amount < v_min or p_amount > v_max then
    raise exception 'Add between R% and R% at a time, in whole rands.', v_min, v_max using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wallet_topup:' || uid::text, 0));
  select count(*) into v_n from public.wallet_topups where profile_id = uid and status = 'awaiting_proof';
  if v_n >= public.wallet_int_setting('wallet_topup_max_waiting', 3) then
    raise exception 'You already have % top-ups waiting for proof of payment. Send the proof for one of them, or cancel one, first.', v_n using errcode = '55000';
  end if;
  select count(*) into v_n from public.wallet_topups where profile_id = uid and created_at > now() - interval '24 hours';
  if v_n >= public.wallet_int_setting('wallet_topup_max_per_day', 10) then
    raise exception 'You have made many top-up requests today. Please try again tomorrow.' using errcode = '55000';
  end if;
  select coalesce(available_rand + held_rand, 0) into v_balance from public.wallets where profile_id = uid;
  select coalesce(sum(amount_rand), 0) into v_pending from public.wallet_topups where profile_id = uid and status in ('awaiting_proof', 'proof_sent');
  if coalesce(v_balance, 0) + v_pending + p_amount > v_cap then
    raise exception 'That would take your credit above R%. You can add up to R% now.', v_cap, greatest(v_cap - coalesce(v_balance, 0) - v_pending, 0) using errcode = '22023';
  end if;
  for i in 1..10 loop
    v_bytes := decode(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), 'hex');
    v_ref := 'TL-' || (select string_agg(substr(v_alpha, (get_byte(v_bytes, g) % 32) + 1, 1), '' order by g) from generate_series(0, 5) g);
    begin
      insert into public.wallet_topups (profile_id, reference, amount_rand) values (uid, v_ref, p_amount) returning id into v_id;
      exit;
    exception when unique_violation then
      v_id := null;
    end;
  end loop;
  if v_id is null then
    raise exception 'Could not create a reference. Please try again.' using errcode = '55000';
  end if;
  return jsonb_build_object('topup_id', v_id, 'reference', v_ref, 'amount_rand', p_amount, 'status', 'awaiting_proof');
end;
$function$;

-- create_wallet_session
CREATE OR REPLACE FUNCTION public.create_wallet_session(p_request_id uuid, p_tutor_id uuid, p_tier integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req record;
  v_pct numeric;
  v_price integer;
  v_list integer;  /* PROMO CODES session 1 (CEO, 5 Nov 2026) */
  v_comm integer;
  v_session uuid;
begin
  select * into v_req from public.session_requests where id = p_request_id for update;
  if not found or not v_req.paid_from_wallet or v_req.payment_status <> 'card_verified' or v_req.status <> 'pending'
     or coalesce(v_req.wallet_hold_rand, 0) < 1
     or not exists (select 1 from public.wallet_ledger where idempotency_key = 'hold:' || p_request_id) then
    raise exception 'This request has no money on hold in your credit.';
  end if;
  v_pct := public.request_commission_pct(p_request_id, p_tier);
  if v_pct is null then
    raise exception 'No commission rate is set for this level — contact support';
  end if;
  v_price := v_req.wallet_hold_rand;   -- what the payer paid
  v_list := v_price + coalesce(v_req.promo_discount_rand, 0);   -- the level price before any discount; PROMO CODES session 2 (CEO, 5 Nov 2026)
  v_comm := round(v_list * v_pct / 100)::integer;   /* PROMO CODES session 3 (CEO, 5 Nov 2026): commission on the price before the discount */   -- whole rands; the tutor gets the remainder
  insert into public.sessions (
    student_id, tutor_id, duration_hours, hourly_rate_charged, platform_commission_pct,
    gross_amount, tutor_payout_amount, scheduled_start, enrollment_id, booked_by_profile_id,
    currency_code, status, wallet_paid, promo_discount_rand /* PROMO CODES session 5 (CEO, 5 Nov 2026) */
  ) values (
    v_req.student_id, p_tutor_id, v_req.duration_hours, round(v_price / v_req.duration_hours, 2), v_pct,
    v_price, v_list - v_comm /* PROMO CODES session 4 (CEO, 5 Nov 2026): the tutor's pay is unchanged by a code */, v_req.requested_start, v_req.enrollment_id, v_req.requested_by_profile_id,
    v_req.currency_code, 'scheduled', true, coalesce(v_req.promo_discount_rand, 0) /* PROMO CODES session 6 (CEO, 5 Nov 2026) */
  ) returning id into v_session;
  -- The hold becomes the session's money; it leaves the payer's held balance and is not released any more.
  perform public.wallet_post(v_req.requested_by_profile_id, 'charge', 0, -v_price, 'charge:' || p_request_id, p_tutor_id, null, p_request_id, v_session);
  update public.session_requests
  set tutor_id = p_tutor_id, status = 'accepted', responded_at = now(), resulting_session_id = v_session,
      payment_status = 'wallet_paid', commission_amount = v_comm, charged_at = now()
  where id = p_request_id;
  insert into public.notifications (profile_id, type, title, body, related_session_id)
  select distinct p, 'request_accepted', 'A tutor accepted your request',
         'Your session is booked. R' || v_price || ' was taken from your credit. Open Sessions to see your tutor and, closer to the time, the meeting link.',
         v_session
  from unnest(array[v_req.student_id, v_req.requested_by_profile_id]) as p
  where p is not null;
  return v_session;
end;
$function$;

-- send_request_wallet
CREATE OR REPLACE FUNCTION public.send_request_wallet(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_req record;
  v_amount integer;
  v_avail integer;
  v_discount integer := 0;  /* PROMO CODES send 1 (CEO, 5 Nov 2026) */
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.wallet_open() then
    raise exception 'Wallet payments are not open.' using errcode = '55000';
  end if;
  select * into v_req from public.session_requests where id = p_request_id for update;
  if not found or v_req.requested_by_profile_id is distinct from v_uid then
    raise exception 'That request is not yours, or does not exist.' using errcode = '42501';
  end if;
  if v_req.paid_from_wallet and v_req.payment_status = 'card_verified' and v_req.status = 'pending' then
    return jsonb_build_object('mode', 'wallet', 'held_rand', v_req.wallet_hold_rand, 'discount_rand', coalesce(v_req.promo_discount_rand, 0), 'already', true); /* PROMO CODES send 5 (CEO, 5 Nov 2026) */  -- already sent: repeat calls change nothing
  end if;
  if v_req.payment_status <> 'initiated' or v_req.status <> 'pending' then
    raise exception 'This request has already been sent.';
  end if;
  if trim(v_req.currency_code) <> 'ZAR' then
    raise exception 'Credit can only pay for requests in rand (ZAR).' using errcode = '22023';
  end if;
  v_amount := round(v_req.charged_amount)::integer;
  if v_amount < 1 then
    raise exception 'This request has no price to pay.' using errcode = '22023';
  end if;
  -- PROMO CODES send 2 (CEO, 5 Nov 2026): a payer with a code takes one use; the hold is the price less the discount. A wallet too small still refuses with the shortfall
  -- (of the discounted price) and the use is rolled back with it.
  v_discount := public.promo_take_use(v_req.id, v_uid, v_amount);
  perform public.wallet_hold_for_request(v_req.id, v_uid, v_amount - v_discount);
  -- The "sent to you" notice fires from this update when the request is addressed to a tutor (trg_notify_tutor_of_addressed_request).
  update public.session_requests set payment_status = 'card_verified', paid_from_wallet = true, wallet_hold_rand = v_amount - v_discount, promo_discount_rand = v_discount /* PROMO CODES send 3 (CEO, 5 Nov 2026) */, first_offer_tutor_id = public.promo_first_offer_tutor(v_uid, v_req.id) /* PROMO FIRST OFFER send (CEO, 5 Nov 2026) */ where id = v_req.id;
  select available_rand into v_avail from public.wallets where profile_id = v_uid;
  return jsonb_build_object('mode', 'wallet', 'held_rand', v_amount - v_discount, 'discount_rand', v_discount, 'available_rand', v_avail, 'already', false); /* PROMO CODES send 4 (CEO, 5 Nov 2026) */
end;
$function$;

-- tutor_bonus_pay
CREATE OR REPLACE FUNCTION public.tutor_bonus_pay(p_session uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.sessions;
  c public.promo_codes;
  v_payer uuid;
  v_owner uuid;
  v_pct numeric;
  v_months integer;
  v_floor integer;
  v_list integer;
  v_keeps integer;
  v_first timestamptz;
  v_when timestamptz;
  v_wanted integer := 0;
  v_paid integer := 0;
  v_note text;
  v_req uuid;
  v_phone text;
begin
  if not public.tutor_bonus_flag('tutor_bonus_enabled', false) then
    return 0;
  end if;
  select * into s from public.sessions where id = p_session;
  if not found or s.status <> 'completed' or not coalesce(s.wallet_paid, false) or coalesce(s.free_session, false) or s.gross_amount is null then
    return 0;
  end if;
  if exists (select 1 from public.tutor_bonuses b where b.session_id = p_session) then
    return 0;
  end if;
  v_payer := s.booked_by_profile_id;
  if v_payer is null then
    return 0;
  end if;
  -- the payer's code, if it is a tutor's personal code that is still active
  select pc.* into c from public.profiles p join public.promo_codes pc on pc.id = p.promo_code_id
   where p.id = v_payer and pc.owner_tutor_id is not null and pc.active;
  if c.id is null then
    return 0;
  end if;
  v_owner := c.owner_tutor_id;
  if public.tutor_bonus_flag('tutor_bonus_only_when_they_teach', false) and s.tutor_id is distinct from v_owner then
    return 0;
  end if;
  v_pct := public.tutor_bonus_num('tutor_bonus_percent', 5, 0, 20);
  v_months := public.tutor_bonus_num('tutor_bonus_months', 12, 1, 60)::integer;
  v_floor := public.tutor_bonus_num('tutor_bonus_platform_floor_rand', 15, 0, 100000)::integer;
  -- the family's first completed lesson starts the clock; this lesson counts
  v_when := coalesce(s.completed_at, now());
  select min(coalesce(x.completed_at, x.scheduled_start)) into v_first
    from public.sessions x where x.booked_by_profile_id = v_payer and x.status = 'completed' and x.wallet_paid and not coalesce(x.free_session, false);
  v_first := least(coalesce(v_first, v_when), v_when);
  if v_when > v_first + make_interval(months => v_months) then
    return 0;
  end if;
  select q.id into v_req from public.session_requests q where q.resulting_session_id = p_session limit 1;
  v_list := (s.gross_amount + coalesce(s.promo_discount_rand, 0))::integer;
  v_keeps := (s.gross_amount - s.tutor_payout_amount)::integer;
  select a.wanted, a.paid into v_wanted, v_paid from public.tutor_bonus_amount(v_list, v_keeps, v_pct, v_floor) a;
  -- self-referral guard: the owner is the payer or the learner, or shares a phone number with the paying parent or the learner
  v_phone := public.tutor_bonus_phone(v_owner);
  if v_owner in (v_payer, s.student_id)
     or (v_phone is not null and (v_phone = public.tutor_bonus_phone(v_payer) or v_phone = public.tutor_bonus_phone(s.student_id))) then
    v_paid := 0;
    v_note := 'self-referral guard: the code''s owner is, or shares a phone number with, the family';
  end if;
  insert into public.tutor_bonuses (session_id, request_id, tutor_id, code_id, payer_id, list_rand, percent, wanted_rand, paid_rand, trimmed, platform_keeps_rand,
                                    first_lesson_at, note)
  values (p_session, v_req, v_owner, c.id, v_payer, v_list, v_pct, v_wanted, v_paid, (v_paid < v_wanted and v_note is null), v_keeps - v_paid, v_first,
          coalesce(v_note, case when v_paid < v_wanted then 'trimmed by the platform floor' end));
  if v_paid > 0 then
    perform public.wallet_post(v_owner, 'session_credit', v_paid, 0, 'bonus:' || p_session, null,
                               'Referral bonus: a family who joined with your code had a lesson', null, null);
    perform public.wallet_notify(v_owner, 'wallet_tutor_bonus', 'Bonus added to your earnings',
      format('R%s was added to your earnings: a family who joined with your code had a lesson.', v_paid));
  end if;
  return v_paid;
end;
$function$;

-- tutor_bonus_take_back
CREATE OR REPLACE FUNCTION public.tutor_bonus_take_back(p_session uuid, p_refunded_total integer, p_price integer, p_take_back boolean, p_key uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b public.tutor_bonuses;
  v_target integer;
  v_reduce integer;
begin
  if not coalesce(p_take_back, false) or p_price is null or p_price < 1 then
    return 0;
  end if;
  select * into b from public.tutor_bonuses where session_id = p_session for update;
  if not found or b.paid_rand <= 0 then
    return 0;
  end if;
  v_target := round(least(p_refunded_total, p_price)::numeric * b.paid_rand / p_price)::integer;
  v_reduce := greatest(v_target - b.reversed_rand, 0);
  if v_reduce = 0 then
    return 0;
  end if;
  begin
    perform public.wallet_post(b.tutor_id, 'refund_reversal', -v_reduce, 0, 'adminbonusback:' || p_key, null,
                               'The family was refunded for the lesson this referral bonus was paid on', null, null);
    update public.tutor_bonuses set reversed_rand = reversed_rand + v_reduce where id = b.id;
    perform public.wallet_notify(b.tutor_id, 'wallet_adjusted', 'Your balance was updated',
      format('R%s was taken from your earnings because a family was refunded for a lesson your referral bonus was paid on.', v_reduce));
    return v_reduce;
  exception when others then
    if sqlerrm <> 'wallet_too_low' then
      raise;
    end if;
    update public.tutor_bonuses set reversal_short_rand = reversal_short_rand + v_reduce where id = b.id;
    perform public.wallet_notify_finance('tutor_bonus_failed', 'A tutor bonus could not be taken back',
      format('A family was refunded for session %s, but R%s of its referral bonus could not be taken back: the tutor''s wallet is too low. Settle it with them by hand.', p_session, v_reduce));
    return 0;
  end;
end;
$function$;

-- wallet_credit_card_session
CREATE OR REPLACE FUNCTION public.wallet_credit_card_session(p_session uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.sessions;
  r public.session_requests;
  v_expected numeric;
  v_share integer;
begin
  select * into s from public.sessions where id = p_session;
  if not found or s.status <> 'completed' or coalesce(s.wallet_paid, false) then
    raise exception 'not a completed card-paid session';
  end if;
  if exists (select 1 from public.wallet_ledger where idempotency_key = 'credit:' || p_session) then
    return 0;
  end if;
  select * into r from public.session_requests
   where resulting_session_id = p_session and not coalesce(paid_from_wallet, false) and payment_status = 'paid';
  if not found then
    raise exception 'no paid card request for this session';
  end if;
  if coalesce(r.paystack_reference, r.charge_reference) is null then
    raise exception 'the request has no Paystack reference';
  end if;
  if r.refunded_at is not null or r.paystack_refund_id is not null or r.refund_requested_at is not null or r.refund_request_id is not null then
    raise exception 'the card payment was refunded or a refund is under way';
  end if;
  if coalesce(r.charged_amount, 0) <= 0 or s.gross_amount is distinct from r.charged_amount then
    raise exception 'the amount charged does not match the session (charged %, session %)', r.charged_amount, s.gross_amount;
  end if;
  v_expected := r.charged_amount - coalesce(r.commission_amount, 0)
                - case when r.fee_bearer = 'subaccount' then coalesce(r.paystack_fee, 0) else 0 end;
  if s.tutor_payout_amount is distinct from v_expected or v_expected < 0 then
    raise exception 'the stored split does not add up (payout %, expected %)', s.tutor_payout_amount, v_expected;
  end if;
  if v_expected <> round(v_expected) then
    raise exception 'the tutor share R% has cents; the wallet holds whole rand', v_expected;
  end if;
  v_share := v_expected::integer;
  if v_share > 0 then
    perform public.wallet_post(s.tutor_id, 'session_credit', v_share, 0, 'credit:' || p_session, null, 'Session completed (card payment)', r.id, p_session);
    perform public.wallet_notify(s.tutor_id, 'wallet_session_credit', 'Money added to your earnings',
      format('R%s for a completed session was added to your earnings.', v_share));
  end if;
  return v_share;
end;
$function$;

-- wallet_credit_tutor
CREATE OR REPLACE FUNCTION public.wallet_credit_tutor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.session_requests;
  v_share integer;
begin
  if exists (select 1 from public.wallet_ledger where idempotency_key = 'credit:' || new.id) then
    return new;
  end if;
  begin
    if not coalesce(new.wallet_paid, false) then
      if not (coalesce(new.free_session, false) or coalesce(new.gross_amount, 0) = 0) then
        perform public.wallet_credit_card_session(new.id);
      end if;
    else
      select * into r from public.session_requests where resulting_session_id = new.id and paid_from_wallet and payment_status = 'wallet_paid';
      if not found
         or not exists (select 1 from public.wallet_ledger where idempotency_key = 'charge:' || r.id)
         or new.tutor_payout_amount is distinct from (r.wallet_hold_rand + coalesce(r.promo_discount_rand, 0) - r.commission_amount /* PROMO CODES credit (CEO, 5 Nov 2026) */) then
        raise exception 'no matching wallet payment for this session';
      end if;
      v_share := new.tutor_payout_amount::integer;
      if v_share > 0 then
        perform public.wallet_post(new.tutor_id, 'session_credit', v_share, 0, 'credit:' || new.id, null, 'Session completed', r.id, new.id);
        perform public.wallet_notify(new.tutor_id, 'wallet_session_credit', 'Money added to your earnings',
          format('R%s for a completed session was added to your earnings.', v_share));
      end if;
    end if;
  exception when others then
    perform public.wallet_notify_finance('wallet_credit_failed', 'A tutor credit did not go through',
      format('Session %s was completed but the tutor could not be credited: %s', new.id, sqlerrm));
  end;
  begin
    perform public.tutor_bonus_pay(new.id);
  exception when others then
    perform public.wallet_notify_finance('tutor_bonus_failed', 'A tutor bonus did not go through',
      format('Session %s was completed but its referral bonus could not be paid: %s', new.id, sqlerrm));
  end;
  return new;
end;
$function$;

-- wallet_credit_topup
CREATE OR REPLACE FUNCTION public.wallet_credit_topup(p_topup uuid, p_received integer, p_actor uuid, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t public.wallet_topups;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_ledger uuid;
begin
  select * into t from public.wallet_topups where id = p_topup for update;
  if not found then
    raise exception 'No such top-up' using errcode = 'P0002';
  end if;
  if t.status = 'successful' then
    return jsonb_build_object('topup_id', t.id, 'status', t.status, 'received_rand', t.received_rand, 'ledger_id', t.ledger_id, 'already', true);
  end if;
  if t.status not in ('awaiting_proof', 'proof_sent') and not (t.status = 'awaiting_payment' and t.method = 'online') then  -- ONLINE TOP-UP (Ozow phase 1, 9 Nov 2026)
    raise exception 'This top-up was already decided (%).', t.status using errcode = '55000';
  end if;
  if p_received is null or p_received < 1 or p_received > 100000 then
    raise exception 'Say the amount received, in whole rands (R1 to R100 000)' using errcode = '22023';
  end if;
  if p_received <> t.amount_rand and (v_comment is null or length(v_comment) < 3) then
    raise exception 'A comment is needed when the amount received is not the amount claimed' using errcode = '22023';
  end if;
  v_ledger := public.wallet_post(t.profile_id, 'topup', p_received, 0, 'topup:' || t.id, p_actor, v_comment, null, null, t.id, null);
  update public.wallet_topups
  set status = 'successful', received_rand = p_received, decided_by = p_actor, decided_at = now(), decision_comment = v_comment,
      ledger_id = v_ledger, updated_at = now()
  where id = t.id;
  perform public.wallet_notify(t.profile_id, 'wallet_topup_added', 'Money added to your credit',
    format('R%s was added to your credit (reference %s).', p_received, t.reference)
    || case when p_received <> t.amount_rand then format(' You said R%s; we received R%s.', t.amount_rand, p_received) || coalesce(' ' || v_comment, '') else '' end);
  return jsonb_build_object('topup_id', t.id, 'status', 'successful', 'received_rand', p_received, 'ledger_id', v_ledger, 'already', false);
end;
$function$;

-- wallet_hold_for_request
CREATE OR REPLACE FUNCTION public.wallet_hold_for_request(p_request uuid, p_payer uuid, p_amount integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_avail integer;
begin
  begin
    v_id := public.wallet_post(p_payer, 'hold', -p_amount, p_amount, 'hold:' || p_request, p_payer, null, p_request);
  exception when others then
    if sqlerrm <> 'wallet_too_low' then
      raise;
    end if;
    select available_rand into v_avail from public.wallets where profile_id = p_payer;
    v_avail := coalesce(v_avail, 0);
    raise exception 'Your credit has R%. This session is R%. Add R% or more.', v_avail, p_amount, p_amount - v_avail
      using errcode = '55000', detail = 'wallet_too_low', hint = (p_amount - v_avail)::text;
  end;
  return v_id;
end;
$function$;

-- decline_session_request
CREATE OR REPLACE FUNCTION public.decline_session_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req record;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into v_req from public.session_requests where id = p_request_id for update;
  if not found or v_req.requested_tutor_id is distinct from auth.uid() or v_req.status <> 'pending' or v_req.tutor_id is not null then
    raise exception 'That request is no longer available.';
  end if;

  update public.session_requests set status = 'declined', responded_at = now() where id = p_request_id;
  insert into public.notifications (profile_id, type, title, body)
  select distinct p, 'request_declined', 'Your tutor can''t take this one',
         'They aren''t able to take this request. ' || case when v_req.paid_from_wallet then 'Your R' || coalesce(v_req.wallet_hold_rand, round(v_req.charged_amount)) /* PROMO CODES decline (CEO, 5 Nov 2026) */ || ' is back in your credit.' else 'Your card was not charged.' end /* WALLET BOOKING decline (CEO, 2 Nov 2026) */ || ' You can send the same request to any available tutor (My tutors, on the Sessions tab), or choose a new time.'
  from unnest(array[v_req.student_id, v_req.requested_by_profile_id]) as p
  where p is not null;
end;
$function$;

-- expire_stale_paid_requests
CREATE OR REPLACE FUNCTION public.expire_stale_paid_requests()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  req record;
  secret text;
  req_id bigint;
begin
  for req in
    select id, student_id, requested_by_profile_id, requested_tutor_id, paid_from_wallet, wallet_hold_rand, charged_amount /* WALLET BOOKING expiry 1 (CEO, 2 Nov 2026) PROMO CODES expiry 1 (CEO, 5 Nov 2026) */ from public.session_requests
    where status = 'pending' and payment_status = 'card_verified'
      and (requested_start < now() - interval '30 minutes' or (expires_at is not null and expires_at <= now()))
    for update skip locked
  loop
    update public.session_requests set status = 'expired', responded_at = now() where id = req.id;
    insert into public.notifications (profile_id, type, title, body)
    select distinct p, 'request_expired',
           case when req.requested_tutor_id is null then 'No tutor was free in time' else 'Your tutor didn''t reply in time' end,
           case when req.requested_tutor_id is null
                then 'Nobody accepted your request before the session time, so it has expired. ' || case when req.paid_from_wallet then 'Your R' || coalesce(req.wallet_hold_rand, round(req.charged_amount)) /* PROMO CODES expiry 2 (CEO, 5 Nov 2026) */ || ' is back in your credit.' else 'Your card was not charged.' end /* WALLET BOOKING expiry 2 (CEO, 2 Nov 2026) */
                else 'Your tutor didn''t accept in time, so the request has expired. ' || case when req.paid_from_wallet then 'Your R' || coalesce(req.wallet_hold_rand, round(req.charged_amount)) /* PROMO CODES expiry 2 (CEO, 5 Nov 2026) */ || ' is back in your credit.' else 'Your card was not charged.' end /* WALLET BOOKING expiry 3 (CEO, 2 Nov 2026) */ || ' You can send the same request to any available tutor (My tutors, on the Sessions tab), or choose a new time.'
           end
    from unnest(array[req.student_id, req.requested_by_profile_id]) as p
    where p is not null;
  end loop;

  -- A tutor with a request addressed to them is reminded once, after 24 hours, while it is still open.
  for req in
    select id, requested_tutor_id from public.session_requests
    where status = 'pending' and payment_status = 'card_verified' and tutor_id is null
      and requested_tutor_id is not null and reminder_sent_at is null
      and created_at <= now() - interval '24 hours'
      and (expires_at is null or expires_at > now())
    for update skip locked
  loop
    update public.session_requests set reminder_sent_at = now() where id = req.id;
    insert into public.notifications (profile_id, type, title, body)
    values (req.requested_tutor_id, 'request_for_you_reminder', 'A learner is still waiting for you',
            'A request addressed to you is still open. Open Teach to accept it, or say you can''t take it so the learner can ask someone else.');
  end loop;

  select decrypted_secret into secret from vault.decrypted_secrets where name = 'paystack_secret_key';
  if secret is null then
    raise notice 'paystack_secret_key not found in vault; skipping refund sweep';
    return;
  end if;

  for req in
    select id, paystack_reference
    from public.session_requests
    where status = 'pending'
      and payment_status = 'paid'
      and requested_start < now() - interval '30 minutes'
  loop
    select net.http_post(
      url := 'https://api.paystack.co/refund',
      headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
      body := jsonb_build_object('transaction', req.paystack_reference)
    ) into req_id;

    update public.session_requests
      set status = 'expired', payment_status = 'refund_pending', refund_request_id = req_id,
          refund_requested_at = now()
      where id = req.id;
  end loop;
end;
$function$;

-- cancel_session
CREATE OR REPLACE FUNCTION public.cancel_session(p_session_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_session record;
  v_request record;
  v_days integer;
  v_clock text;
  v_by_tutor boolean;
  v_secret text;
  v_refund_id bigint;
begin
  select id, student_id, tutor_id, status, scheduled_start, booked_by_profile_id into v_session
  from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'Session not found' using errcode = '42501';
  end if;

  v_by_tutor := v_session.tutor_id = v_uid;
  if not v_by_tutor and v_uid is distinct from v_session.student_id and v_uid is distinct from v_session.booked_by_profile_id
     and not public.can_act_for_learner(v_session.student_id) then
    raise exception 'Only the learner, the person who booked, or the tutor can cancel this session' using errcode = '42501';
  end if;
  if v_session.status <> 'scheduled' then
    raise exception 'Only an upcoming session can be cancelled';
  end if;
  if now() >= v_session.scheduled_start then
    raise exception 'This session has already started — contact support if something went wrong';
  end if;

  select * into v_request from public.session_requests where resulting_session_id = p_session_id for update;

  if found and v_request.payment_status = 'wallet_paid' then
    perform public.wallet_post(v_request.requested_by_profile_id, 'refund', v_request.wallet_hold_rand, 0, 'refund:' || p_session_id, v_uid,
                               'Session cancelled', v_request.id, p_session_id);
    update public.sessions
    set status = case when v_by_tutor then 'cancelled_by_tutor'::public.session_status
                      else 'cancelled_by_student'::public.session_status end
    where id = p_session_id;
    update public.session_requests set status = 'cancelled', payment_status = 'wallet_refunded' where id = v_request.id;
    if v_by_tutor then
      insert into public.notifications (profile_id, type, title, body, related_session_id)
      select distinct p, 'session_cancelled', 'A session was cancelled',
             'Your tutor cancelled the session. R' || v_request.wallet_hold_rand || ' is back in your credit.'
               || coalesce(' Reason: ' || nullif(trim(p_reason), ''), ''),
             p_session_id
      from unnest(array[v_session.student_id, v_session.booked_by_profile_id]) as p
      where p is not null;
    else
      insert into public.notifications (profile_id, type, title, body, related_session_id)
      values (v_session.tutor_id, 'session_cancelled', 'A session was cancelled',
              'The learner cancelled the session.' || coalesce(' Reason: ' || nullif(trim(p_reason), ''), ''), p_session_id),
             (v_request.requested_by_profile_id, 'session_cancelled', 'Session cancelled',
              'R' || v_request.wallet_hold_rand || ' is back in your credit.', p_session_id);
    end if;
    return;
  end if;

  if found and v_request.payment_status = 'free' then
    update public.sessions
    set status = case when v_by_tutor then 'cancelled_by_tutor'::public.session_status
                      else 'cancelled_by_student'::public.session_status end
    where id = p_session_id;
    update public.session_requests set status = 'cancelled' where id = v_request.id;
    insert into public.notifications (profile_id, type, title, body, related_session_id)
    values (
      case when v_by_tutor then v_session.student_id else v_session.tutor_id end,
      'session_cancelled',
      'A session was cancelled',
      case when v_by_tutor then 'Your tutor cancelled the session. It was a free session, so there is nothing to refund.'
           else 'The learner cancelled the session.' end
        || coalesce(' Reason: ' || nullif(trim(p_reason), ''), ''),
      p_session_id
    );
    return;
  end if;

  if not found or v_request.payment_status <> 'paid' then
    raise exception 'No payment to refund was found for this session — contact support';
  end if;

  if not v_by_tutor then
    select coalesce((select (setting_value #>> '{}')::integer from public.system_settings where setting_key = 'cancellation_window_days'), 7),
           coalesce((select setting_value #>> '{}' from public.system_settings where setting_key = 'cancellation_clock_start'), 'payment')
    into v_days, v_clock;
    if v_clock = 'payment' and now() > coalesce(v_request.charged_at, v_request.created_at) + make_interval(days => v_days) then
      raise exception 'The % day cancellation window for this booking has closed', v_days;
    end if;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'paystack_secret_key';
  if v_secret is null then
    raise exception 'Refunds aren''t set up on this server yet — contact support';
  end if;

  select net.http_post(
    url := 'https://api.paystack.co/refund',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := jsonb_build_object('transaction', coalesce(v_request.charge_reference, v_request.paystack_reference))
  ) into v_refund_id;

  update public.sessions
  set status = case when v_by_tutor then 'cancelled_by_tutor'::public.session_status
                    else 'cancelled_by_student'::public.session_status end
  where id = p_session_id;

  update public.session_requests
  set status = 'cancelled', payment_status = 'refund_pending', refund_request_id = v_refund_id,
      refund_requested_at = now()
  where id = v_request.id;

  insert into public.notifications (profile_id, type, title, body, related_session_id)
  values (
    case when v_by_tutor then v_session.student_id else v_session.tutor_id end,
    'session_cancelled',
    'A session was cancelled',
    case when v_by_tutor
         then 'Your tutor cancelled the session. Your payment is being refunded in full — once Paystack has processed it, it can take up to 10 business days to reach your account.'
         else 'The learner cancelled the session.' end
      || coalesce(' Reason: ' || nullif(trim(p_reason), ''), ''),
    p_session_id
  );
end;
$function$;
