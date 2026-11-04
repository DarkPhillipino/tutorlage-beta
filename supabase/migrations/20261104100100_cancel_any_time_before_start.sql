-- 4 Nov 2026 (the CEO: "someone should be able to cancel any time before a lesson has actually begun"). Two gaps found:
--   1. A request still WAITING for a tutor could not be cancelled by anyone: there was no function and no button; the held price came back
--      only when the request expired on its own (48 hours, or 30 minutes after the start time asked for).
--   2. After a tutor accepted, a learner (or the parent who booked) could cancel only for 7 days after paying (cancellation_window_days,
--      clock from the payment), even when the lesson was weeks away; the tutor could always cancel.
--
-- WHAT THIS DOES
--   * cancel_waiting_request(p_request_id) is NEW. The person who made the request, the learner it is for, or that learner's guardian
--     (can_act_for_learner) may cancel it while it is pending, unclaimed and waiting (payment_status card_verified, which free and wallet
--     requests also use). The request becomes 'cancelled'; for a wallet request the existing trigger wallet_release_hold returns the held
--     price at once (the same path as an expiry). A request already taken by a tutor, or being charged, is refused with a plain sentence.
--     A request addressed to one tutor tells that tutor it was withdrawn.
--   * cancel_session is REPLACED (same signature, same grants): for a WALLET booking the learner is no longer bound by the cancellation
--     window; they (or whoever booked, or the learner's guardian) can cancel any time while the session is still upcoming, i.e. before its start.
--     Once the start time has passed it is refused as before. The tutor could always cancel. The card branch (Paystack, not used since the
--     wallet) and the free branch are unchanged, so cancellation_window_days still governs a card payment.
-- NOT touched: any table, policy or trigger.

create or replace function public.cancel_waiting_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v record;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select id, student_id, requested_by_profile_id, requested_tutor_id, tutor_id, status, payment_status
    into v from public.session_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found' using errcode = '42501';
  end if;
  if v_uid is distinct from v.requested_by_profile_id and v_uid is distinct from v.student_id
     and not public.can_act_for_learner(v.student_id) then
    raise exception 'Only the person who made this request, or the learner it is for, can cancel it' using errcode = '42501';
  end if;
  if v.status <> 'pending' or v.tutor_id is not null or v.payment_status <> 'card_verified' then
    raise exception 'This request can no longer be cancelled here. If a tutor has accepted it, cancel it from your upcoming sessions.';
  end if;

  update public.session_requests set status = 'cancelled', responded_at = now() where id = v.id;

  if v.requested_tutor_id is not null then
    insert into public.notifications (profile_id, type, title, body)
    values (v.requested_tutor_id, 'session_cancelled', 'A request was withdrawn',
            'The learner withdrew a request that was addressed to you, so there is nothing to accept.');
  end if;
end;
$function$;

revoke all on function public.cancel_waiting_request(uuid) from public, anon;
grant execute on function public.cancel_waiting_request(uuid) to authenticated;

create or replace function public.cancel_session(p_session_id uuid, p_reason text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- WALLET BOOKING cancel: a wallet session is refunded in full as credit in the payer's wallet. Since 4 Nov 2026 (CEO) the learner is no longer bound
  -- by a cancellation window: any time before the session starts. Paystack is not involved.
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


  -- FREE SESSIONS (CEO, 2 Nov 2026): nothing was charged, so there is nothing to refund and no cancellation window to check.
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
