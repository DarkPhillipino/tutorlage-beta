-- 2026-09-30 (fourth session). Master backlog 7z: "refunded" was recorded when Paystack had only
-- QUEUED a refund.
--
-- reconcile_pending_refunds() read the reply to POST /refund and marked the request 'refunded' when it
-- said status: true — which Paystack sends as "Refund has been queued for processing". A refund then
-- goes pending → processing → processed, or to needs-attention (Paystack needs the customer's bank
-- details and waits for a Retry) or failed (the money goes back to Tutorlage's balance). Nothing heard
-- about those later states, so a stalled or failed refund still showed as refunded. ECTA s 44(3) also
-- requires a cooling-off refund within 30 days, so a silent stall is a legal exposure, not just a
-- records problem.
--
-- Now:
--   refund_pending          the refund request is on its way to Paystack (unchanged)
--   refund_queued           Paystack accepted it; not money back yet
--   refund_needs_attention  Paystack needs something (customer bank details), or no reply was ever
--                           recorded — an admin has to look
--   refunded                Paystack reports the refund as processed
--   refund_failed           Paystack refused or failed it
-- A new job asks Paystack for each queued refund's status (GET /refund/:id) every 10 minutes, because
-- Paystack's webhook can't reach this project until server/ is deployed (master backlog item 1). The
-- webhook, once deployed, only makes the same updates sooner. Admins are notified of anything that
-- needs a person; the learner (and the guardian who booked) is told when the refund is processed, with
-- Paystack's own caveat that it can take up to 10 business days to reach their account.

-- payment_status was varchar(20); 'refund_needs_attention' is 22 characters, and writing it would
-- abort the whole reconcile job, stopping every refund's processing. (Found by 7z_refund_status.sql.
-- Dev history: applied as refund_status_tracking, then widen_payment_status; production gets this
-- file in one step.)
-- The one policy that reads payment_status has to be dropped and recreated around the type change
-- (now scoped to signed-in users, like the rest after 20260930234000).
drop policy "Tutors view unclaimed pending requests" on public.session_requests;
alter table public.session_requests alter column payment_status type varchar(32);
create policy "Tutors view unclaimed pending requests" on public.session_requests
  for select to authenticated
  using (tutor_id is null and status = 'pending' and payment_status = 'paid');

alter table public.session_requests drop constraint if exists session_requests_payment_status_check;
alter table public.session_requests add constraint session_requests_payment_status_check
  check (payment_status in ('unpaid', 'initiated', 'paid', 'refund_pending', 'refund_queued',
                            'refund_needs_attention', 'refunded', 'refund_failed', 'failed'));

alter table public.session_requests
  add column if not exists refund_requested_at timestamptz,
  add column if not exists paystack_refund_id bigint,
  add column if not exists refund_poll_request_id bigint,
  add column if not exists refund_checked_at timestamptz,
  add column if not exists refund_last_status text,
  add column if not exists refunded_at timestamptz;

comment on column public.session_requests.paystack_refund_id is 'Paystack''s id for the refund (from the POST /refund reply).';
comment on column public.session_requests.refund_poll_request_id is 'pg_net id of the latest GET /refund/:id status check still waiting to be read.';
comment on column public.session_requests.refund_last_status is 'Paystack''s latest refund status (pending, processing, needs-attention, failed, processed), or why none was recorded.';

-- Browsers never write these; learners may read their own request's refund progress.
grant select (refund_requested_at, paystack_refund_id, refund_checked_at, refund_last_status, refunded_at)
  on public.session_requests to authenticated;
grant select, update on public.session_requests to service_role;

-- Parses a pg_net response body without failing on an empty or non-JSON one.
create or replace function public.try_jsonb(p_text text)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
begin
  return p_text::jsonb;
exception when others then
  return null;
end;
$$;
revoke all on function public.try_jsonb(text) from public, anon, authenticated;

-- One notification per active admin.
create or replace function public.notify_active_admins(p_type text, p_title text, p_body text, p_session_id uuid default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (profile_id, type, title, body, related_session_id)
  select a.id, p_type, p_title, p_body, p_session_id
  from public.admin_profiles a
  where a.is_active;
$$;
revoke all on function public.notify_active_admins(text, text, text, uuid) from public, anon, authenticated;

create or replace function public.reconcile_pending_refunds()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  resp record;
  body jsonb;
  v_status text;
  v_label text;
begin
  -- 1. Replies to POST /refund.
  for req in
    select id, refund_request_id, resulting_session_id, created_at, refund_requested_at
    from public.session_requests
    where payment_status = 'refund_pending' and refund_request_id is not null
  loop
    select * into resp from net._http_response where id = req.refund_request_id;
    if resp.id is null then
      -- pg_net keeps replies for a few hours. No reply 2 hours after the refund was requested (and
      -- nothing still queued) means one was never recorded, or was cleaned up before this job read
      -- it: the refund may or may not exist at Paystack, so a person checks.
      if coalesce(req.refund_requested_at, req.created_at) < now() - interval '2 hours' and not exists (
        select 1 from net.http_request_queue q where q.id = req.refund_request_id
      ) then
        update public.session_requests
        set payment_status = 'refund_needs_attention', refund_last_status = 'no reply recorded from Paystack'
        where id = req.id and payment_status = 'refund_pending';
        perform public.notify_active_admins('refund_needs_attention', 'A refund needs checking',
          'No reply from Paystack was recorded for a refund request (session request ' || req.id
          || '). Check the transaction in the Paystack dashboard.', req.resulting_session_id);
      end if;
      continue;
    end if;

    body := public.try_jsonb(resp.content);
    if resp.status_code between 200 and 299 and coalesce((body->>'status')::boolean, false) then
      update public.session_requests
      set payment_status = 'refund_queued',
          paystack_refund_id = nullif(body #>> '{data,id}', '')::bigint,
          refund_last_status = coalesce(body #>> '{data,status}', 'pending')
      where id = req.id;
    else
      update public.session_requests
      set payment_status = 'refund_failed',
          refund_last_status = left(coalesce(body->>'message', resp.error_msg, 'HTTP ' || resp.status_code), 200)
      where id = req.id;
      perform public.notify_active_admins('refund_failed', 'A refund was refused',
        'Paystack refused a refund (session request ' || req.id || '): '
        || left(coalesce(body->>'message', resp.error_msg, 'HTTP ' || resp.status_code), 200),
        req.resulting_session_id);
    end if;
  end loop;

  -- 2. Replies to GET /refund/:id status checks (poll_queued_refunds below).
  for req in
    select id, student_id, requested_by_profile_id, resulting_session_id, payment_status,
           refund_poll_request_id, refund_checked_at
    from public.session_requests
    where payment_status in ('refund_queued', 'refund_needs_attention') and refund_poll_request_id is not null
  loop
    select * into resp from net._http_response where id = req.refund_poll_request_id;
    if resp.id is null then
      -- Lost check: forget it so the next poll asks again.
      if req.refund_checked_at < now() - interval '2 hours' then
        update public.session_requests set refund_poll_request_id = null where id = req.id;
      end if;
      continue;
    end if;

    body := public.try_jsonb(resp.content);
    v_status := case when resp.status_code between 200 and 299 then lower(body #>> '{data,status}') end;
    v_label := replace(coalesce(v_status, ''), '_', '-');

    update public.session_requests
    set refund_poll_request_id = null,
        refund_checked_at = now(),
        refund_last_status = coalesce(nullif(v_label, ''), refund_last_status)
    where id = req.id;

    if v_label = 'processed' then
      update public.session_requests
      set payment_status = 'refunded',
          refunded_at = coalesce(nullif(body #>> '{data,refunded_at}', '')::timestamptz, now())
      where id = req.id;
      insert into public.notifications (profile_id, type, title, body, related_session_id)
      select distinct p, 'refund_processed', 'Your refund has been processed',
             'Paystack has processed your refund. It can take up to 10 business days to reach your account, depending on your bank.',
             req.resulting_session_id
      from unnest(array[req.student_id, req.requested_by_profile_id]) as p
      where p is not null;
    elsif v_label = 'failed' then
      update public.session_requests set payment_status = 'refund_failed' where id = req.id;
      perform public.notify_active_admins('refund_failed', 'A refund failed',
        'Paystack reports a refund as failed (session request ' || req.id
        || '). The money is back in Tutorlage''s Paystack balance; the learner still needs refunding.',
        req.resulting_session_id);
    elsif v_label = 'needs-attention' and req.payment_status <> 'refund_needs_attention' then
      update public.session_requests set payment_status = 'refund_needs_attention' where id = req.id;
      perform public.notify_active_admins('refund_needs_attention', 'A refund needs attention',
        'Paystack needs the customer''s bank details to finish a refund (session request ' || req.id
        || '). Use Retry Refund in the Paystack dashboard.', req.resulting_session_id);
    end if;
    -- pending / processing: nothing to do yet.
  end loop;
end;
$$;
revoke all on function public.reconcile_pending_refunds() from public, anon, authenticated;

create or replace function public.poll_queued_refunds()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  v_secret text;
  v_poll bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'paystack_secret_key';
  if v_secret is null then
    raise notice 'paystack_secret_key not found in vault; skipping refund status checks';
    return;
  end if;

  for req in
    select id, paystack_refund_id
    from public.session_requests
    where payment_status in ('refund_queued', 'refund_needs_attention')
      and paystack_refund_id is not null
      and refund_poll_request_id is null
      and (refund_checked_at is null or refund_checked_at < now() - interval '30 minutes')
    order by refund_checked_at nulls first
    limit 50
  loop
    select net.http_get(
      url := 'https://api.paystack.co/refund/' || req.paystack_refund_id,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret)
    ) into v_poll;
    update public.session_requests
    set refund_poll_request_id = v_poll, refund_checked_at = now()
    where id = req.id;
  end loop;
end;
$$;
revoke all on function public.poll_queued_refunds() from public, anon, authenticated;

-- The two places a refund starts now record when (refund_requested_at). Otherwise unchanged from
-- 20260908 (expire_stale_paid_requests) and 20260930170000 (cancel_session).
create or replace function public.expire_stale_paid_requests()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  secret text;
  req_id bigint;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'paystack_secret_key';
  if secret is null then
    raise notice 'paystack_secret_key not found in vault; skipping refund sweep';
    return;
  end if;

  for req in
    select id, paystack_reference
    from session_requests
    where status = 'pending'
      and payment_status = 'paid'
      and requested_start < now() - interval '30 minutes'
  loop
    select net.http_post(
      url := 'https://api.paystack.co/refund',
      headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
      body := jsonb_build_object('transaction', req.paystack_reference)
    ) into req_id;

    update session_requests
      set status = 'expired', payment_status = 'refund_pending', refund_request_id = req_id,
          refund_requested_at = now()
      where id = req.id;
  end loop;
end;
$$;
revoke all on function public.expire_stale_paid_requests() from public, anon, authenticated;

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
  set status = 'cancelled', payment_status = 'refund_pending', refund_request_id = v_refund_id,
      refund_requested_at = now()
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

select cron.unschedule('poll-queued-refunds') where exists (select 1 from cron.job where jobname = 'poll-queued-refunds');
select cron.schedule('poll-queued-refunds', '*/10 * * * *', 'select public.poll_queued_refunds();');
