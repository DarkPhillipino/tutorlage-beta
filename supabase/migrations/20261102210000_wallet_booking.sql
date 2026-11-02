-- WALLET BOOKING, phase 2 of the wallet + manual bank transfer system (CEO's design, 2 Nov 2026; plan in Drake/programmer/wallet-manual-eft-plan-2026-11-02.md).
-- Apply AFTER 20261102200100_wallet_core.sql (phase 1). Database only: no screen. With wallet_payments_enabled off (the default) nothing behaves differently:
-- no request can carry a wallet hold, so every patch below is inert.
--
-- How a wallet request travels (the free-sessions recipe, 20261102100000; no Worker change):
--   1. the payer's request is inserted as always ('initiated'); send_request_wallet() puts its price ON HOLD in the payer's wallet (ledger kind hold,
--      key hold:<request>) and moves it to 'card_verified' with paid_from_wallet = true (exactly what a verified card check does), so tutor visibility,
--      best-fit-first matching, the 48-hour window, expiry, reminders and the "sent to you" notice all work unchanged. A wallet too small for the
--      price refuses the request with the shortfall in words.
--   2. the hold goes back (kind release, key release:<request>) when the request expires, is declined or is cancelled: ONE trigger on session_requests
--      covers every path, today's and any added later.
--   3. a tutor accepts through the Worker as today: claim_session_request() runs every check, then a wallet request is booked through
--      create_wallet_session() and the answer is mode 'already_paid' (the Worker already turns that into "booked"). The hold becomes the session's money
--      (kind charge, key charge:<request>); the request ends as payment_status 'wallet_paid' (new value; the old 'paid' is not reused because every
--      'paid' path calls Paystack).
--   4. a cancelled session is refunded as WALLET CREDIT (kind refund, key refund:<session>); the request ends 'wallet_refunded'.
--   5. the tutor's share is credited to the tutor's wallet ONLY when the session is completed (kind session_credit, key credit:<session>, with the session id).
-- Whole rands: the request price is rounded to the nearest rand when the request is created (R187.50 becomes R188), Tutorlage's commission is rounded to
-- the nearest rand and the tutor gets the remainder, so commission + tutor share = price exactly.
--
-- What this migration does:
--   NEW    session_requests.paid_from_wallet, wallet_hold_rand; sessions.wallet_paid; payment_status values wallet_paid and wallet_refunded
--   NEW    guard_wallet_flags (a signed-in user, an admin in the admin app included, can never set or change the wallet flags)
--   NEW    send_request_wallet(uuid) (the payer only, only while the wallet is open), wallet_hold_for_request, create_wallet_session,
--          resend_request_without_card, wallet_release_hold (trigger), wallet_credit_tutor (trigger), wallet_booking_totals
--   PATCHES (each in place; the anchor must occur exactly once or the migration stops and changes nothing; a marker makes a re-run a no-op)
--          claim_session_request, cancel_session, closure_cancel_session, resend_request_to_anyone, expire_stale_paid_requests, decline_session_request
--          (wording only), guard_session_request_insert (the rounding), wallet_totals (the booked tutor share), retention_due_requests ('free' joins
--          the settled list)
-- Nothing is dropped. No existing row changes.

-- 1. columns, the new payment states and the guard ----------------------------------------------------------------------------------------------
alter table public.session_requests add column if not exists paid_from_wallet boolean not null default false;
alter table public.session_requests add column if not exists wallet_hold_rand integer check (wallet_hold_rand is null or wallet_hold_rand > 0);
alter table public.sessions add column if not exists wallet_paid boolean not null default false;

alter table public.session_requests drop constraint if exists session_requests_payment_status_check;
alter table public.session_requests add constraint session_requests_payment_status_check
  check (payment_status in ('unpaid', 'initiated', 'card_verified', 'charging', 'charge_failed', 'paid',
                            'refund_pending', 'refund_queued', 'refund_needs_attention', 'refunded', 'refund_failed', 'failed', 'free',
                            'wallet_paid', 'wallet_refunded'));
alter table public.session_requests drop constraint if exists session_requests_wallet_shape;
alter table public.session_requests add constraint session_requests_wallet_shape check (paid_from_wallet = (wallet_hold_rand is not null));

-- Only the functions below set these. A signed-in user (an admin working through the admin app included) inserting a row gets the flags cleared, and
-- updating a row cannot change them or move a request into or out of the two wallet payment states. The server and the owner are not held to this.
create or replace function public.guard_wallet_flags()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_table_name = 'sessions' then
    new.wallet_paid := case when tg_op = 'INSERT' then false else old.wallet_paid end;
  elsif tg_op = 'INSERT' then
    new.paid_from_wallet := false;
    new.wallet_hold_rand := null;
  else
    new.paid_from_wallet := old.paid_from_wallet;
    new.wallet_hold_rand := old.wallet_hold_rand;
    if old.payment_status in ('wallet_paid', 'wallet_refunded') or new.payment_status in ('wallet_paid', 'wallet_refunded') then
      new.payment_status := old.payment_status;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_wallet_flags() from public, anon, authenticated, service_role;
drop trigger if exists guard_wallet_flags on public.session_requests;
create trigger guard_wallet_flags before insert or update on public.session_requests
  for each row execute function public.guard_wallet_flags();
drop trigger if exists guard_wallet_flags on public.sessions;
create trigger guard_wallet_flags before insert or update on public.sessions
  for each row execute function public.guard_wallet_flags();

-- 2. putting the price on hold ---------------------------------------------------------------------------------------------------------------------
-- The one place a hold is posted. A wallet too small for the price raises a plain sentence with the shortfall (detail wallet_too_low, hint = the missing rand).
create or replace function public.wallet_hold_for_request(p_request uuid, p_payer uuid, p_amount integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
    raise exception 'Your wallet has R%. This session is R%. Add R% or more.', v_avail, p_amount, p_amount - v_avail
      using errcode = '55000', detail = 'wallet_too_low', hint = (p_amount - v_avail)::text;
  end;
  return v_id;
end;
$$;
revoke all on function public.wallet_hold_for_request(uuid, uuid, integer) from public, anon, authenticated, service_role;

-- The payer sends a request: the price goes on hold, the request becomes a verified request with the wallet flag (the same move a card check makes).
create or replace function public.send_request_wallet(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req record;
  v_amount integer;
  v_avail integer;
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
    return jsonb_build_object('mode', 'wallet', 'held_rand', v_req.wallet_hold_rand, 'already', true);  -- already sent: repeat calls change nothing
  end if;
  if v_req.payment_status <> 'initiated' or v_req.status <> 'pending' then
    raise exception 'This request has already been sent.';
  end if;
  if trim(v_req.currency_code) <> 'ZAR' then
    raise exception 'The wallet can only pay for requests in rand (ZAR).' using errcode = '22023';
  end if;
  v_amount := round(v_req.charged_amount)::integer;
  if v_amount < 1 then
    raise exception 'This request has no price to pay.' using errcode = '22023';
  end if;
  perform public.wallet_hold_for_request(v_req.id, v_uid, v_amount);
  -- The "sent to you" notice fires from this update when the request is addressed to a tutor (trg_notify_tutor_of_addressed_request).
  update public.session_requests set payment_status = 'card_verified', paid_from_wallet = true, wallet_hold_rand = v_amount where id = v_req.id;
  select available_rand into v_avail from public.wallets where profile_id = v_uid;
  return jsonb_build_object('mode', 'wallet', 'held_rand', v_amount, 'available_rand', v_avail, 'already', false);
end;
$$;
revoke all on function public.send_request_wallet(uuid) from public, anon;
grant execute on function public.send_request_wallet(uuid) to authenticated;

-- 3. the hold goes back when the request ends without a tutor -------------------------------------------------------------------------------------
-- Expired, declined or cancelled while still pending and still holding money. Idempotent by key. A failure never blocks the expiry job (it would
-- stop every other request); it tells the finance admins instead.
create or replace function public.wallet_release_hold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.wallet_hold_rand, 0) < 1
     or not exists (select 1 from public.wallet_ledger where idempotency_key = 'hold:' || new.id)
     or exists (select 1 from public.wallet_ledger where idempotency_key = 'charge:' || new.id) then
    return new;
  end if;
  begin
    perform public.wallet_post(new.requested_by_profile_id, 'release', new.wallet_hold_rand, -new.wallet_hold_rand, 'release:' || new.id, null,
                               'Request ' || new.status, new.id);
  exception when others then
    perform public.wallet_notify_finance('wallet_release_failed', 'A wallet hold could not be released',
      format('Request %s ended (%s) but its hold could not be returned: %s', new.id, new.status, sqlerrm));
  end;
  return new;
end;
$$;
revoke all on function public.wallet_release_hold() from public, anon, authenticated, service_role;
drop trigger if exists wallet_release_hold on public.session_requests;
create trigger wallet_release_hold after update of status on public.session_requests
  for each row when (old.status = 'pending' and new.status in ('expired', 'declined', 'cancelled') and new.paid_from_wallet)
  execute function public.wallet_release_hold();

-- 4. booking a wallet session (private: only claim_session_request calls it) ---------------------------------------------------------------------
create or replace function public.create_wallet_session(p_request_id uuid, p_tutor_id uuid, p_tier integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_pct numeric;
  v_price integer;
  v_comm integer;
  v_session uuid;
begin
  select * into v_req from public.session_requests where id = p_request_id for update;
  if not found or not v_req.paid_from_wallet or v_req.payment_status <> 'card_verified' or v_req.status <> 'pending'
     or coalesce(v_req.wallet_hold_rand, 0) < 1
     or not exists (select 1 from public.wallet_ledger where idempotency_key = 'hold:' || p_request_id) then
    raise exception 'This request has no money on hold in a wallet.';
  end if;
  v_pct := public.request_commission_pct(p_request_id, p_tier);
  if v_pct is null then
    raise exception 'No commission rate is set for this level — contact support';
  end if;
  v_price := v_req.wallet_hold_rand;
  v_comm := round(v_price * v_pct / 100)::integer;   -- whole rands; the tutor gets the remainder
  insert into public.sessions (
    student_id, tutor_id, duration_hours, hourly_rate_charged, platform_commission_pct,
    gross_amount, tutor_payout_amount, scheduled_start, enrollment_id, booked_by_profile_id,
    currency_code, status, wallet_paid
  ) values (
    v_req.student_id, p_tutor_id, v_req.duration_hours, round(v_price / v_req.duration_hours, 2), v_pct,
    v_price, v_price - v_comm, v_req.requested_start, v_req.enrollment_id, v_req.requested_by_profile_id,
    v_req.currency_code, 'scheduled', true
  ) returning id into v_session;
  -- The hold becomes the session's money; it leaves the payer's held balance and is not released any more.
  perform public.wallet_post(v_req.requested_by_profile_id, 'charge', 0, -v_price, 'charge:' || p_request_id, p_tutor_id, null, p_request_id, v_session);
  update public.session_requests
  set tutor_id = p_tutor_id, status = 'accepted', responded_at = now(), resulting_session_id = v_session,
      payment_status = 'wallet_paid', commission_amount = v_comm, charged_at = now()
  where id = p_request_id;
  insert into public.notifications (profile_id, type, title, body, related_session_id)
  select distinct p, 'request_accepted', 'A tutor accepted your request',
         'Your session is booked. R' || v_price || ' was taken from your wallet. Open Sessions to see your tutor and, closer to the time, the meeting link.',
         v_session
  from unnest(array[v_req.student_id, v_req.requested_by_profile_id]) as p
  where p is not null;
  return v_session;
end;
$$;
revoke all on function public.create_wallet_session(uuid, uuid, integer) from public, anon, authenticated, service_role;

-- 5. the tutor is credited when the session is completed ----------------------------------------------------------------------------------------
-- Fires however a session completes (the tutor's complete_session, or auto_complete_sessions after 48 hours and never while a problem report is open).
-- It credits only what the ledger proves: the request that made the session was paid from a wallet, the charge line exists and the stored split adds
-- up. Anything else tells the finance admins and credits nothing; it never blocks the completion.
create or replace function public.wallet_credit_tutor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.session_requests;
  v_share integer;
begin
  if exists (select 1 from public.wallet_ledger where idempotency_key = 'credit:' || new.id) then
    return new;
  end if;
  begin
    select * into r from public.session_requests where resulting_session_id = new.id and paid_from_wallet and payment_status = 'wallet_paid';
    if not found
       or not exists (select 1 from public.wallet_ledger where idempotency_key = 'charge:' || r.id)
       or new.tutor_payout_amount is distinct from (r.wallet_hold_rand - r.commission_amount) then
      raise exception 'no matching wallet payment for this session';
    end if;
    v_share := new.tutor_payout_amount::integer;
    if v_share > 0 then
      perform public.wallet_post(new.tutor_id, 'session_credit', v_share, 0, 'credit:' || new.id, null, 'Session completed', r.id, new.id);
      perform public.wallet_notify(new.tutor_id, 'wallet_session_credit', 'Money added to your wallet',
        format('R%s for a completed session was added to your wallet.', v_share));
    end if;
  exception when others then
    perform public.wallet_notify_finance('wallet_credit_failed', 'A tutor credit did not go through',
      format('Session %s was completed but the tutor could not be credited: %s', new.id, sqlerrm));
  end;
  return new;
end;
$$;
revoke all on function public.wallet_credit_tutor() from public, anon, authenticated, service_role;
drop trigger if exists wallet_credit_tutor on public.sessions;
create trigger wallet_credit_tutor after update of status on public.sessions
  for each row when (new.status = 'completed' and old.status is distinct from 'completed' and new.wallet_paid)
  execute function public.wallet_credit_tutor();

-- 6. sending the same request to anyone, for a free or wallet request (no saved card to look for) ----------------------------------------------------
create or replace function public.resend_request_without_card(p_request uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_new uuid;
  v_amount integer;
begin
  select * into v_req from public.session_requests where id = p_request;
  if v_req.free_session then
    if not public.free_sessions_open() then
      raise exception 'Free sessions are not open any more. Send a new request.';
    end if;
  else
    if not public.wallet_open() then
      raise exception 'Wallet payments are not open any more. Send a new request.';
    end if;
    v_amount := round(v_req.charged_amount)::integer;
  end if;
  insert into public.session_requests (
    student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status,
    currency_code, institution_id, min_sub_tier_id, tier_id, charged_amount, paystack_reference, resent_from,
    free_session, paid_from_wallet, wallet_hold_rand
  ) values (
    v_req.student_id, v_req.enrollment_id, v_req.requested_by_profile_id, v_req.requested_start, v_req.duration_hours, 'pending', 'card_verified',
    v_req.currency_code, v_req.institution_id, v_req.min_sub_tier_id, v_req.tier_id, v_req.charged_amount, 'rs_' || replace(gen_random_uuid()::text, '-', ''), v_req.id,
    v_req.free_session, not v_req.free_session, v_amount
  ) returning id into v_new;
  -- The first request's hold went back when it expired or was declined: the new request needs its own, or is refused with the shortfall.
  if not v_req.free_session then
    perform public.wallet_hold_for_request(v_new, v_req.requested_by_profile_id, v_amount);
  end if;
  return v_new;
end;
$$;
revoke all on function public.resend_request_without_card(uuid) from public, anon, authenticated, service_role;

-- 7. totals: what is owed to tutors for booked, unfinished sessions ----------------------------------------------------------------------------------
create or replace function public.wallet_booking_totals(p_base jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'booked_sessions', count(*),
           'booked_tutor_share_rand', coalesce(sum(s.tutor_payout_amount), 0)::integer,
           'held_for_others_rand', coalesce((p_base ->> 'total_rand')::integer, 0) + coalesce(sum(s.tutor_payout_amount), 0)::integer)
  from public.sessions s
  where s.wallet_paid and s.status in ('pending_confirmation', 'scheduled', 'in_progress');
$$;
revoke all on function public.wallet_booking_totals(jsonb) from public, anon, authenticated, service_role;

-- 8. THE REPLACED FUNCTIONS, PATCHED IN PLACE ---------------------------------------------------------------------------------------------------------
-- Same method as 20261102100000_free_sessions_mode.sql: each function is read from the database as it is now (pg_get_functiondef), the anchor is
-- checked to occur EXACTLY once (otherwise this migration stops and changes nothing), the block is inserted after it (or the anchor is replaced), and the
-- function is recreated with the same attributes and rights. A function whose text already holds the patch's marker is left alone, so a re-run is a no-op.
create or replace function pg_temp.wallet_patch(p_sig regprocedure, p_marker text, p_anchor text, p_closing text, p_new_block text, p_replace_anchor boolean default false)
returns text
language plpgsql
as $patch$
declare
  d text;
  parts text[];
  pos int;
  pos2 int;
begin
  d := replace(pg_get_functiondef(p_sig), chr(13), '');
  if strpos(d, p_marker) > 0 then
    return p_sig::text || ': already patched (' || p_marker || ')';
  end if;
  parts := string_to_array(d, p_anchor);
  if array_length(parts, 1) is distinct from 2 then
    raise exception 'wallet booking patch: the anchor was found % time(s) in %, expected exactly once (%)', coalesce(array_length(parts, 1), 1) - 1, p_sig, p_marker;
  end if;
  pos := strpos(d, p_anchor);
  if p_replace_anchor then
    d := substr(d, 1, pos - 1) || p_new_block || substr(d, pos + length(p_anchor));
  else
    pos2 := strpos(substr(d, pos), p_closing);
    if pos2 = 0 then
      raise exception 'wallet booking patch: no closing "%" after the anchor in %', p_closing, p_sig;
    end if;
    pos2 := pos + pos2 - 1 + length(p_closing);
    d := substr(d, 1, pos2 - 1) || p_new_block || substr(d, pos2);
  end if;
  execute d;
  return p_sig::text || ': patched (' || p_marker || ')';
end;
$patch$;

-- claim_session_request: a wallet request is booked after every eligibility check, before any card step (the Worker reads mode 'already_paid')
select pg_temp.wallet_patch(
  'public.claim_session_request(uuid, uuid)'::regprocedure,
  'WALLET BOOKING claim (CEO, 2 Nov 2026)',
  'raise exception ''%'', public.tutor_fit_sentence(v_fit);',
  'end if;',
  $blk$

  -- WALLET BOOKING claim (CEO, 2 Nov 2026): a request paid from a wallet is booked now. The held price becomes the session's money, the tutor's
  -- share is credited only when the session is completed, and no bank account or Paystack call is involved. Every check above still applies.
  if v_req.paid_from_wallet then
    return jsonb_build_object('mode', 'already_paid', 'session_id', public.create_wallet_session(p_request_id, p_tutor_id, v_tutor.current_tier_id));
  end if;
$blk$);

-- cancel_session: a wallet session is refunded as wallet credit (the learner inside the usual cancellation window, the tutor always)
select pg_temp.wallet_patch(
  'public.cancel_session(uuid, text)'::regprocedure,
  'WALLET BOOKING cancel (CEO, 2 Nov 2026)',
  'select * into v_request from public.session_requests where resulting_session_id = p_session_id for update;',
  ';',
  $blk$

  -- WALLET BOOKING cancel (CEO, 2 Nov 2026): a wallet session is refunded in full as credit in the payer's wallet. The learner is bound by the same
  -- cancellation window as for a card payment; the tutor can always cancel. Paystack is not involved.
  if found and v_request.payment_status = 'wallet_paid' then
    if not v_by_tutor then
      select coalesce((select (setting_value #>> '{}')::integer from public.system_settings where setting_key = 'cancellation_window_days'), 7),
             coalesce((select setting_value #>> '{}' from public.system_settings where setting_key = 'cancellation_clock_start'), 'payment')
      into v_days, v_clock;
      if v_clock = 'payment' and now() > coalesce(v_request.charged_at, v_request.created_at) + make_interval(days => v_days) then
        raise exception 'The % day cancellation window for this booking has closed', v_days;
      end if;
    end if;
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
             'Your tutor cancelled the session. R' || v_request.wallet_hold_rand || ' is back in your wallet as credit.'
               || coalesce(' Reason: ' || nullif(trim(p_reason), ''), ''),
             p_session_id
      from unnest(array[v_session.student_id, v_session.booked_by_profile_id]) as p
      where p is not null;
    else
      insert into public.notifications (profile_id, type, title, body, related_session_id)
      values (v_session.tutor_id, 'session_cancelled', 'A session was cancelled',
              'The learner cancelled the session.' || coalesce(' Reason: ' || nullif(trim(p_reason), ''), ''), p_session_id),
             (v_request.requested_by_profile_id, 'session_cancelled', 'Session cancelled',
              'R' || v_request.wallet_hold_rand || ' is back in your wallet as credit.', p_session_id);
    end if;
    return;
  end if;
$blk$);

-- closure_cancel_session: an account closure refunds a wallet session as wallet credit, and the notice does not talk about Paystack
select pg_temp.wallet_patch(
  'public.closure_cancel_session(uuid, boolean)'::regprocedure,
  'WALLET BOOKING closure (CEO, 2 Nov 2026)',
  'elsif found and v_r.payment_status = ''paid'' then',
  null,
  $blk$elsif found and v_r.payment_status = 'wallet_paid' then
    -- WALLET BOOKING closure (CEO, 2 Nov 2026): the full price goes back to the payer's wallet as credit; no card, no Paystack call.
    perform public.wallet_post(v_r.requested_by_profile_id, 'refund', v_r.wallet_hold_rand, 0, 'refund:' || p_session, null,
                               'Session cancelled by an account closure', v_r.id, p_session);
    update public.session_requests set status = 'cancelled', payment_status = 'wallet_refunded' where id = v_r.id;
    v_out := 'refunded';
  elsif found and v_r.payment_status = 'paid' then$blk$,
  true);
select pg_temp.wallet_patch(
  'public.closure_cancel_session(uuid, boolean)'::regprocedure,
  'WALLET BOOKING closure notice (CEO, 2 Nov 2026)',
  'case when v_out = ''refunded''',
  null,
  $blk$case when v_out = 'refunded' and v_r.payment_status = 'wallet_paid' /* WALLET BOOKING closure notice (CEO, 2 Nov 2026) */
             then ' The full price is back in your wallet as credit.'
             when v_out = 'refunded'$blk$,
  true);

-- resend_request_to_anyone: a free or wallet request has no saved card to look for (this also fixes the free-mode refusal "the card ... can't be used again")
select pg_temp.wallet_patch(
  'public.resend_request_to_anyone(uuid)'::regprocedure,
  'WALLET BOOKING resend (CEO, 2 Nov 2026)',
  'select * into v_card from public.payment_cards where id = v_req.payment_card_id;',
  null,
  $blk$-- WALLET BOOKING resend (CEO, 2 Nov 2026): a free or wallet request is sent again without looking for a card (a wallet request takes a new hold).
  if v_req.free_session or v_req.paid_from_wallet then
    return public.resend_request_without_card(v_req.id);
  end if;
  select * into v_card from public.payment_cards where id = v_req.payment_card_id;$blk$,
  true);

-- expire_stale_paid_requests: a wallet request's notice says the money is back in the wallet, not "Your card was not charged"
select pg_temp.wallet_patch(
  'public.expire_stale_paid_requests()'::regprocedure,
  'WALLET BOOKING expiry 1 (CEO, 2 Nov 2026)',
  'select id, student_id, requested_by_profile_id, requested_tutor_id from public.session_requests',
  null,
  $blk$select id, student_id, requested_by_profile_id, requested_tutor_id, paid_from_wallet, charged_amount /* WALLET BOOKING expiry 1 (CEO, 2 Nov 2026) */ from public.session_requests$blk$,
  true);
select pg_temp.wallet_patch(
  'public.expire_stale_paid_requests()'::regprocedure,
  'WALLET BOOKING expiry 2 (CEO, 2 Nov 2026)',
  'so it has expired. Your card was not charged.''',
  null,
  $blk$so it has expired. ' || case when req.paid_from_wallet then 'Your R' || round(req.charged_amount) || ' is back in your wallet.' else 'Your card was not charged.' end /* WALLET BOOKING expiry 2 (CEO, 2 Nov 2026) */$blk$,
  true);
select pg_temp.wallet_patch(
  'public.expire_stale_paid_requests()'::regprocedure,
  'WALLET BOOKING expiry 3 (CEO, 2 Nov 2026)',
  'so the request has expired. Your card was not charged. You can send the same request',
  null,
  $blk$so the request has expired. ' || case when req.paid_from_wallet then 'Your R' || round(req.charged_amount) || ' is back in your wallet.' else 'Your card was not charged.' end /* WALLET BOOKING expiry 3 (CEO, 2 Nov 2026) */ || ' You can send the same request$blk$,
  true);

-- decline_session_request: the same wording change
select pg_temp.wallet_patch(
  'public.decline_session_request(uuid)'::regprocedure,
  'WALLET BOOKING decline (CEO, 2 Nov 2026)',
  'Your card was not charged. You can send the same request',
  null,
  $blk$' || case when v_req.paid_from_wallet then 'Your R' || round(v_req.charged_amount) || ' is back in your wallet.' else 'Your card was not charged.' end /* WALLET BOOKING decline (CEO, 2 Nov 2026) */ || ' You can send the same request$blk$,
  true);

-- guard_session_request_insert: the price is rounded to the nearest whole rand when the request is created (R187.50 becomes R188)
select pg_temp.wallet_patch(
  'public.guard_session_request_insert()'::regprocedure,
  'WALLET BOOKING rounding (CEO, 2 Nov 2026)',
  'new.charged_amount := round(v_price * new.duration_hours, 2);',
  null,
  $blk$new.charged_amount := round(v_price * new.duration_hours);  -- WALLET BOOKING rounding (CEO, 2 Nov 2026): whole rands, nearest rand$blk$,
  true);

-- wallet_totals: adds the tutor share of wallet-paid sessions not yet completed, and the figure to always find in the bank for other people
select pg_temp.wallet_patch(
  'public.wallet_totals()'::regprocedure,
  'WALLET BOOKING totals (CEO, 2 Nov 2026)',
  '''oldest_payout_requested_at'', (select min(requested_at) from public.payout_requests where status = ''requested''));',
  null,
  $blk$'oldest_payout_requested_at', (select min(requested_at) from public.payout_requests where status = 'requested'))
    || public.wallet_booking_totals(v);  -- WALLET BOOKING totals (CEO, 2 Nov 2026)$blk$,
  true);

-- retention_due_requests: free requests are settled money records too (they were missing from the list, so they were never purged)
select pg_temp.wallet_patch(
  'public.retention_due_requests()'::regprocedure,
  'WALLET BOOKING retention (CEO, 2 Nov 2026)',
  'v_settled text[] := array[''unpaid'', ''card_verified'', ''charge_failed'', ''paid'', ''refunded'', ''failed''];',
  null,
  $blk$v_settled text[] := array['unpaid', 'card_verified', 'charge_failed', 'paid', 'refunded', 'failed', 'free'];  -- WALLET BOOKING retention (CEO, 2 Nov 2026)$blk$,
  true);
