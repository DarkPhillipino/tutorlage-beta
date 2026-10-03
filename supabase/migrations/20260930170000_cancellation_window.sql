-- 2026-09-30. Cancelling a matched session (legal's ECTA s44 working answer, 2026-09-28): a
-- 7-day window, **configurable, not hardcoded** — both its length and when the clock starts — so
-- the attorney's final answer is a settings change, not a rebuild.
--   cancellation_window_days  — number of days (default 7)
--   cancellation_clock_start  — 'payment' (from when the learner paid; default) or 'session'
--                               (counted back from the session start, i.e. any time before it)
-- The learner (or the guardian who booked) may cancel inside the window and before the session
-- starts; the tutor may cancel any time before it starts. Either way the learner gets a full refund
-- through the same Paystack refund path the expiry job uses, marked 'refunded' only once Paystack
-- confirms (reconcile_pending_refunds).

insert into public.system_settings (setting_key, setting_value, description) values
  ('cancellation_window_days', '7'::jsonb,
   'Days a learner may cancel a matched session for a full refund (ECTA s44 working answer — confirm with the attorney).'),
  ('cancellation_clock_start', '"payment"'::jsonb,
   'When the cancellation window starts: "payment" (from payment) or "session" (up to the session start).')
on conflict (setting_key) do nothing;

alter table public.session_requests drop constraint if exists session_requests_status_check;
alter table public.session_requests add constraint session_requests_status_check
  check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled'));

create or replace function public.cancel_session(p_session_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
  if not v_by_tutor and v_uid is distinct from v_session.student_id and v_uid is distinct from v_session.booked_by_profile_id then
    raise exception 'Only the learner, the person who booked, or the tutor can cancel this session' using errcode = '42501';
  end if;
  if v_session.status <> 'scheduled' then
    raise exception 'Only an upcoming session can be cancelled';
  end if;
  if now() >= v_session.scheduled_start then
    raise exception 'This session has already started — contact support if something went wrong';
  end if;

  select * into v_request from public.session_requests where resulting_session_id = p_session_id for update;
  if not found or v_request.payment_status <> 'paid' then
    raise exception 'No payment to refund was found for this session — contact support';
  end if;

  if not v_by_tutor then
    select coalesce((select (setting_value #>> '{}')::integer from public.system_settings where setting_key = 'cancellation_window_days'), 7),
           coalesce((select setting_value #>> '{}' from public.system_settings where setting_key = 'cancellation_clock_start'), 'payment')
    into v_days, v_clock;
    if v_clock = 'payment' and now() > v_request.created_at + make_interval(days => v_days) then
      raise exception 'The % day cancellation window for this booking has closed', v_days;
    end if;
    -- 'session': the window runs up to the session start, already enforced above.
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'paystack_secret_key';
  if v_secret is null then
    raise exception 'Refunds aren''t set up on this server yet — contact support';
  end if;

  select net.http_post(
    url := 'https://api.paystack.co/refund',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := jsonb_build_object('transaction', v_request.paystack_reference)
  ) into v_refund_id;

  update public.sessions
  set status = case when v_by_tutor then 'cancelled_by_tutor'::public.session_status
                    else 'cancelled_by_student'::public.session_status end
  where id = p_session_id;

  update public.session_requests
  set status = 'cancelled', payment_status = 'refund_pending', refund_request_id = v_refund_id
  where id = v_request.id;

  insert into public.notifications (profile_id, type, title, body, related_session_id)
  values (
    case when v_by_tutor then v_session.student_id else v_session.tutor_id end,
    'session_cancelled',
    'A session was cancelled',
    case when v_by_tutor
         then 'Your tutor cancelled the session. Your payment is being refunded in full.'
         else 'The learner cancelled the session.' end
      || coalesce(' Reason: ' || nullif(trim(p_reason), ''), ''),
    p_session_id
  );
end;
$$;
revoke all on function public.cancel_session(uuid, text) from public, anon;
grant execute on function public.cancel_session(uuid, text) to authenticated;
