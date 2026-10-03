-- Rolled-back test of refund status tracking (migration 20260930238000, master backlog 7z).
-- Paystack's replies are faked by inserting rows into net._http_response inside this transaction; the
-- ids used are far above anything pg_net has issued. poll_queued_refunds() enqueues a real GET, but
-- the queue row is rolled back with everything else, so pg_net never sends it. See README.md.
do $$
declare
  r text := E'\n';
  v_mum uuid := gen_random_uuid();
  v_kid uuid := gen_random_uuid();
  v_adult uuid := gen_random_uuid();
  v_tutor uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_sess uuid;
  q1 uuid; q2 uuid; q3 uuid; q3b uuid; q4 uuid; q5 uuid; q6 uuid; q7 uuid; q8 uuid;
  n int; s text; x text; t timestamptz; b bigint;
  adult text := (current_date - interval '30 years')::date::text;
  z uuid := '00000000-0000-0000-0000-000000000000';
  base bigint := 9100000000000;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_mum, z,'authenticated','authenticated','t.m.'||v_mum||'@example.invalid', jsonb_build_object('role','parent','first_name','Mum','date_of_birth',adult), '{}'),
    (v_adult, z,'authenticated','authenticated','t.a.'||v_adult||'@example.invalid', jsonb_build_object('first_name','Adult','date_of_birth',adult), '{}'),
    (v_tutor, z,'authenticated','authenticated','t.t.'||v_tutor||'@example.invalid', jsonb_build_object('role','tutor','first_name','Tutor'), '{}'),
    (v_admin, z,'authenticated','authenticated','t.ad.'||v_admin||'@example.invalid', jsonb_build_object('first_name','Admin','date_of_birth',adult), '{}');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_kid, z,'authenticated','authenticated','t.k.'||v_kid||'@example.invalid',
     jsonb_build_object('first_name','Kid','date_of_birth',(current_date - interval '14 years')::date::text), jsonb_build_object('created_by_guardian', v_mum));
  insert into admin_profiles (id, first_name, surname, email) values (v_admin, 'Test', 'Admin', 't.ad.'||v_admin||'@example.invalid');

  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status)
  values (v_kid, v_tutor, v_mum, now() + interval '3 days', 100, 20, 100, 80, 'cancelled_by_student') returning id into v_sess;

  -- Requests in each starting state (inserted as owner: the insert guard only checks client roles).
  insert into session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, status, payment_status, refund_request_id, refund_requested_at, resulting_session_id)
  values (v_kid, v_mum, now() + interval '3 days', 'tz_1', 100, 'cancelled', 'refund_pending', base + 1, now(), v_sess) returning id into q1;
  insert into session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, status, payment_status, refund_request_id, refund_requested_at)
  values (v_adult, v_adult, now() - interval '1 day', 'tz_2', 100, 'expired', 'refund_pending', base + 2, now()) returning id into q2;
  insert into session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, status, payment_status, refund_request_id, refund_requested_at, created_at)
  values (v_adult, v_adult, now() - interval '1 day', 'tz_3', 100, 'expired', 'refund_pending', base + 3, now() - interval '3 hours', now() - interval '4 days') returning id into q3;
  insert into session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, status, payment_status, refund_request_id, refund_requested_at, created_at)
  values (v_adult, v_adult, now() - interval '1 day', 'tz_3b', 100, 'cancelled', 'refund_pending', base + 33, now() - interval '10 minutes', now() - interval '4 days') returning id into q3b;
  insert into session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, status, payment_status, paystack_refund_id, refund_poll_request_id, refund_checked_at, resulting_session_id)
  values (v_kid, v_mum, now() + interval '3 days', 'tz_4', 100, 'cancelled', 'refund_queued', 701, base + 4, now(), v_sess) returning id into q4;
  insert into session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, status, payment_status, paystack_refund_id, refund_poll_request_id, refund_checked_at)
  values (v_adult, v_adult, now(), 'tz_5', 100, 'expired', 'refund_queued', 702, base + 5, now()) returning id into q5;
  insert into session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, status, payment_status, paystack_refund_id, refund_poll_request_id, refund_checked_at)
  values (v_adult, v_adult, now(), 'tz_6', 100, 'expired', 'refund_queued', 703, base + 6, now()) returning id into q6;
  insert into session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, status, payment_status, paystack_refund_id, refund_poll_request_id, refund_checked_at)
  values (v_adult, v_adult, now(), 'tz_7', 100, 'expired', 'refund_queued', 704, base + 7, now()) returning id into q7;
  insert into session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, status, payment_status, paystack_refund_id)
  values (v_adult, v_adult, now(), 'tz_8', 100, 'expired', 'refund_queued', 705) returning id into q8;

  -- Paystack's replies.
  insert into net._http_response (id, status_code, content) values
    (base + 1, 200, '{"status":true,"message":"Refund has been queued for processing","data":{"id":601,"status":"pending"}}'),
    (base + 2, 400, '{"status":false,"message":"Transaction has been fully reversed"}'),
    (base + 4, 200, '{"status":true,"data":{"id":701,"status":"processed","refunded_at":"2026-09-30T10:00:00.000Z"}}'),
    (base + 5, 200, '{"status":true,"data":{"id":702,"status":"needs-attention"}}'),
    (base + 6, 200, '{"status":true,"data":{"id":703,"status":"failed"}}'),
    (base + 7, 200, '{"status":true,"data":{"id":704,"status":"processing"}}');

  perform public.reconcile_pending_refunds();

  select payment_status, paystack_refund_id into s, b from session_requests where id = q1;
  r := r || format('Z1 queued reply -> %s, refund id %s (want refund_queued, 601 — NOT refunded)', s, b) || E'\n';
  select payment_status, refund_last_status into s, x from session_requests where id = q2;
  r := r || format('Z2 refused reply -> %s / "%s" (want refund_failed / Paystack''s message)', s, x) || E'\n';
  select payment_status, refund_last_status into s, x from session_requests where id = q3;
  r := r || format('Z3 no reply after 3 hours -> %s / "%s" (want refund_needs_attention)', s, x) || E'\n';
  select payment_status into s from session_requests where id = q3b;
  r := r || format('Z3b no reply yet, requested 10 min ago on a 4-day-old booking -> %s (want refund_pending)', s) || E'\n';
  select payment_status, refunded_at, refund_poll_request_id::text into s, t, x from session_requests where id = q4;
  r := r || format('Z4 processed -> %s, refunded_at %s, poll cleared=%s (want refunded, 2026-09-30 10:00 UTC, true)', s, t, x is null) || E'\n';
  select count(*) into n from notifications where type = 'refund_processed' and profile_id in (v_kid, v_mum);
  r := r || format('Z4b learner and guardian notified: %s (want 2)', n) || E'\n';
  select payment_status into s from session_requests where id = q5;
  r := r || format('Z5 needs-attention -> %s (want refund_needs_attention)', s) || E'\n';
  select payment_status into s from session_requests where id = q6;
  r := r || format('Z6 failed -> %s (want refund_failed)', s) || E'\n';
  select payment_status, refund_last_status, refund_poll_request_id::text into s, x, b from session_requests where id = q7;
  r := r || format('Z7 processing -> %s / %s, poll cleared=%s (want refund_queued / processing / true)', s, x, b is null) || E'\n';
  select count(*) into n from notifications where profile_id = v_admin;
  r := r || format('Z8 test admin notifications: %s (want 4: Z2 refused, Z3 no reply, Z5 needs attention, Z6 failed)', n) || E'\n';

  -- A second run changes nothing already settled and doesn't re-notify.
  perform public.reconcile_pending_refunds();
  select count(*) into n from notifications where profile_id = v_admin;
  r := r || format('Z9 second run, admin notifications still %s (want 4)', n) || E'\n';

  -- Polling asks Paystack about queued refunds without a check in flight (q1: just queued; q8: never checked).
  perform public.poll_queued_refunds();
  select count(*) into n from session_requests where id in (q1, q8) and refund_poll_request_id is not null;
  r := r || format('Z10 status checks enqueued for %s of 2 queued refunds (want 2)', n) || E'\n';
  select count(*) into n from net.http_request_queue q join session_requests sr on sr.refund_poll_request_id = q.id
  where sr.id = q8 and q.url = 'https://api.paystack.co/refund/705' and q.method = 'GET';
  r := r || format('Z10b the check is GET /refund/705: %s (want 1)', n) || E'\n';

  -- The learner can read their own request's refund progress; they can't run the jobs.
  perform set_config('request.jwt.claims', json_build_object('sub', v_adult, 'role','authenticated')::text, true);
  set local role authenticated;
  select refund_last_status into x from session_requests where id = q2;
  r := r || format('Z11 learner reads own refund status: "%s" (want Paystack''s message)', x) || E'\n';
  begin
    perform public.reconcile_pending_refunds();
    r := r || 'Z12 FAIL learner ran reconcile_pending_refunds' || E'\n';
  exception when others then r := r || 'Z12 ok learner refused: ' || sqlerrm || E'\n'; end;
  begin
    perform public.poll_queued_refunds();
    r := r || 'Z13 FAIL learner ran poll_queued_refunds' || E'\n';
  exception when others then r := r || 'Z13 ok learner refused: ' || sqlerrm || E'\n'; end;
  reset role;

  raise exception 'REFUND STATUS TEST (rolled back): %', r;
end $$;
