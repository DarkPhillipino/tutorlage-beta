-- Rolled-back test of the close-account tool (migrations 20261021140000 and 20261021141000), on top of the document access log and safety
-- hold (20261021100000, 103000, 110000), the hold protections and the hand-over export (120000, 130000).
-- Run it with scripts/run-rolled-back-test.mjs in ONE statement, in this order (see README.md):
--   supabase/tests/helpers/rights_before.sql, the migrations 100000, 103000, 110000, 120000, 130000, 140000, 141000, then (optional)
--   supabase/tests/document_access_log.sql and supabase/tests/holds_and_handover.sql (each adds its report to test.report), then this file LAST.
-- Every refusal is matched on its own message or on the database's "permission denied", so a refusal for the wrong reason shows as FAIL.
-- Each part runs in its own block: a mistake in one part is reported as an ERROR line and the other parts still run. The people, sessions,
-- payments, cards, files and the held person are all built inside the run. Lines are short on purpose (the Supabase tool cuts a long answer).
do $$
declare
  r text := E'\n';
  m text; want text; t text; w2 text; w3 text; nm text;
  n int; n2 int; n3 int; n4 int; n5 int; n6 int; nfail int; nlines int; ntot int;
  bl boolean; bl2 boolean; bl3 boolean;
  j jsonb; j2 jsonb; j3 jsonb; arr text[]; arr2 text[];
  rep text; old_report text; base bigint;
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  kid text := (current_date - interval '12 years')::date::text;
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); a3 uuid := gen_random_uuid();      -- super admin, support agent, switched-off admin
  l1 uuid := gen_random_uuid(); l2 uuid := gen_random_uuid(); lh uuid := gen_random_uuid(); lu uuid := gen_random_uuid();
  ld uuid := gen_random_uuid(); lb uuid := gen_random_uuid(); lp uuid := gen_random_uuid(); lo uuid := gen_random_uuid();   -- learners (adults)
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); t3 uuid := gen_random_uuid(); tu uuid := gen_random_uuid();   -- tutors
  g1 uuid := gen_random_uuid(); g2 uuid := gen_random_uuid();                                    -- guardians
  k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); k3 uuid := gen_random_uuid();      -- learners under 18 (k1, k2 of g1; k3 of g2)
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid; sb uuid; sk uuid; sd uuid;
  c_l1 uuid; c_t1 uuid; c_g1 uuid; c_k1 uuid; c_k2 uuid; c_lh uuid; c_ld uuid; c_lu uuid; c_tu uuid; c_lb uuid; c_g2 uuid; c_k3 uuid; c_lo uuid;
  rat numeric; tid bigint; did uuid; i int;
begin
  -- ---------- helpers (gone at rollback) ----------
  create function pg_temp.call_as(p_uid uuid, p_sql text, p_role text default 'authenticated', p_iat numeric default null) returns text language plpgsql as $f$
  declare v text; e text;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', p_role, 'iat', coalesce(p_iat, extract(epoch from now())))::text, true);
    execute format('set local role %I', p_role);
    begin
      execute p_sql into v;
    exception when others then
      e := sqlerrm;
    end;
    execute 'reset role';
    return case when e is null then 'OK:' || coalesce(v, '') else 'ERR:' || e end;
  end $f$;
  create function pg_temp.call_json(p_uid uuid, p_sql text) returns jsonb language plpgsql as $f$
  declare t text;
  begin
    t := pg_temp.call_as(p_uid, p_sql);
    if left(t, 4) = 'ERR:' then raise exception '%', substr(t, 5); end if;
    return nullif(substr(t, 4), '')::jsonb;
  end $f$;
  create function pg_temp.expect_err(p_uid uuid, p_sql text, p_want text, p_role text default 'authenticated', p_iat numeric default null) returns text language plpgsql as $f$
  declare t text;
  begin
    t := pg_temp.call_as(p_uid, p_sql, p_role, p_iat);
    if left(t, 4) = 'ERR:' and starts_with(substr(t, 5), p_want) then return ''; end if;
    return ' [' || left(p_sql, 45) || ' -> ' || left(t, 70) || ']';
  end $f$;

  -- ---------- people ----------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (a1, z, 'authenticated', 'authenticated', 'ca.a1.' || a1 || '@example.invalid', jsonb_build_object('first_name', 'Ann', 'surname', 'Admin', 'date_of_birth', adult), '{}'),
    (a2, z, 'authenticated', 'authenticated', 'ca.a2.' || a2 || '@example.invalid', jsonb_build_object('first_name', 'Abe', 'surname', 'Agent', 'date_of_birth', adult), '{}'),
    (a3, z, 'authenticated', 'authenticated', 'ca.a3.' || a3 || '@example.invalid', jsonb_build_object('first_name', 'Al', 'surname', 'Off', 'date_of_birth', adult), '{}'),
    (l1, z, 'authenticated', 'authenticated', 'ca.l1.' || l1 || '@example.invalid', jsonb_build_object('first_name', 'Lee', 'surname', 'Learner', 'date_of_birth', adult), '{}'),
    (l2, z, 'authenticated', 'authenticated', 'ca.l2.' || l2 || '@example.invalid', jsonb_build_object('first_name', 'Lou', 'surname', 'Control', 'date_of_birth', adult), '{}'),
    (lh, z, 'authenticated', 'authenticated', 'ca.lh.' || lh || '@example.invalid', jsonb_build_object('first_name', 'Hal', 'surname', 'Held', 'date_of_birth', adult), '{}'),
    (lu, z, 'authenticated', 'authenticated', 'ca.lu.' || lu || '@example.invalid', jsonb_build_object('first_name', 'Uli', 'surname', 'Undo', 'date_of_birth', adult), '{}'),
    (ld, z, 'authenticated', 'authenticated', 'ca.ld.' || ld || '@example.invalid', jsonb_build_object('first_name', 'Dee', 'surname', 'Defer', 'date_of_birth', adult), '{}'),
    (lb, z, 'authenticated', 'authenticated', 'ca.lb.' || lb || '@example.invalid', jsonb_build_object('first_name', 'Bo', 'surname', 'Busy', 'date_of_birth', adult), '{}'),
    (lp, z, 'authenticated', 'authenticated', 'ca.lp.' || lp || '@example.invalid', jsonb_build_object('first_name', 'Pat', 'surname', 'Plain', 'date_of_birth', adult), '{}'),
    (lo, z, 'authenticated', 'authenticated', 'ca.lo.' || lo || '@learners.tutorlage.invalid', jsonb_build_object('first_name', 'Ola', 'surname', 'Overdue', 'date_of_birth', adult), '{}'),
    (t1, z, 'authenticated', 'authenticated', 'ca.t1.' || t1 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tia', 'surname', 'Tutor', 'date_of_birth', adult), '{}'),
    (t2, z, 'authenticated', 'authenticated', 'ca.t2.' || t2 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tom', 'surname', 'Other', 'date_of_birth', adult), '{}'),
    (t3, z, 'authenticated', 'authenticated', 'ca.t3.' || t3 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tess', 'surname', 'Room', 'date_of_birth', adult), '{}'),
    (tu, z, 'authenticated', 'authenticated', 'ca.tu.' || tu || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tab', 'surname', 'Undo', 'date_of_birth', adult), '{}'),
    (g1, z, 'authenticated', 'authenticated', 'ca.g1.' || g1 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Gina', 'surname', 'Guard', 'date_of_birth', adult), '{}'),
    (g2, z, 'authenticated', 'authenticated', 'ca.g2.' || g2 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Gus', 'surname', 'Other', 'date_of_birth', adult), '{}');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (k1, z, 'authenticated', 'authenticated', 'ca.k1.' || k1 || '@example.invalid', jsonb_build_object('first_name', 'Kai', 'surname', 'One', 'date_of_birth', kid), jsonb_build_object('created_by_guardian', g1, 'relationship', 'mother')),
    (k2, z, 'authenticated', 'authenticated', 'ca.k2.' || k2 || '@example.invalid', jsonb_build_object('first_name', 'Kim', 'surname', 'Two', 'date_of_birth', kid), jsonb_build_object('created_by_guardian', g1, 'relationship', 'mother')),
    (k3, z, 'authenticated', 'authenticated', 'ca.k3.' || k3 || '@example.invalid', jsonb_build_object('first_name', 'Kit', 'surname', 'Three', 'date_of_birth', kid), jsonb_build_object('created_by_guardian', g2, 'relationship', 'father'));
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (a1, 'Ann', 'Admin', 'ca.a1.' || a1 || '@example.invalid', '', 'super_admin', true),
    (a2, 'Abe', 'Agent', 'ca.a2.' || a2 || '@example.invalid', '', 'support_agent', true),
    (a3, 'Al', 'Off', 'ca.a3.' || a3 || '@example.invalid', '', 'support_agent', false);
  update profiles set role = 'admin' where id in (a1, a2, a3);
  insert into parent_student_links (parent_id, student_id)
    select x.g, x.k from (values (g1, k1), (g1, k2), (g2, k3)) x(g, k)
    where not exists (select 1 from parent_student_links l where l.parent_id = x.g and l.student_id = x.k);
  insert into guardian_consents (guardian_profile_id, learner_profile_id, consent_text_version)
    select x.g, x.k, 'v-test' from (values (g1, k1), (g1, k2), (g2, k3)) x(g, k)
    where not exists (select 1 from guardian_consents c where c.guardian_profile_id = x.g and c.learner_profile_id = x.k);
  update tutor_profiles set is_dispatch_active = true where id in (t1, t2, t3, tu);
  update tutor_profiles set headline = 'Maths for all', avg_rating = 4.8, total_sessions_completed = 7 where id = t1;
  insert into auth.sessions (id, user_id) values (gen_random_uuid(), l1), (gen_random_uuid(), l1), (gen_random_uuid(), k1);

  -- l1: the learner who closes. Two upcoming paid sessions, one older completed session, one unaccepted request, and data of every kind.
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (l1, 'Mathematics', 'Grade 12'), (l2, 'Mathematics', 'Grade 12');
  insert into student_availability (student_id, day_of_week, start_time, end_time) values (l1, 1, '15:00', '17:00'), (l2, 1, '15:00', '17:00');
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
    values (l1, t2, l1, now() + interval '2 days', 100, 20, 100, 80) returning id into s1;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
    values (l1, t2, l1, now() + interval '5 days', 100, 20, 100, 80) returning id into s2;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status, completed_at, meeting_url, enrollment_id)
    values (l1, t2, l1, now() - interval '20 days', 100, 20, 100, 80, 'completed', now() - interval '20 days' + interval '1 hour', 'https://meet.example.invalid/room1',
            (select id from student_subject_enrollments where student_id = l1)) returning id into s3;
  insert into session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, status, payment_status, resulting_session_id, tutor_id, charge_reference) values
    (l1, l1, now() + interval '2 days', 'ca_ref_1', 100, 'accepted', 'paid', s1, t2, 'ca_chg_1'),
    (l1, l1, now() + interval '5 days', 'ca_ref_2', 100, 'accepted', 'paid', s2, t2, 'ca_chg_2'),
    (l1, l1, now() - interval '20 days', 'ca_ref_3', 100, 'accepted', 'paid', s3, t2, 'ca_chg_3');
  insert into session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, status, payment_status)
    values (l1, l1, now() + interval '4 days', 'ca_ref_4', 100, 'pending', 'card_verified');
  insert into notifications (profile_id, type, title, body) select p, 'x', 'n', 'n' from unnest(array[l1, l1, l1, l2, l2]) p;
  insert into payment_cards (profile_id, authorization_code, paystack_email, reusable) values (l1, 'AUTH_ca_1', 'x@example.invalid', true), (l1, 'AUTH_ca_2', 'x@example.invalid', true), (lh, 'AUTH_ca_h', 'x@example.invalid', true);
  insert into school_results_consents (student_id, consented_by, consent_version, consented_at) values (l1, l1, 'v-test', now());
  insert into school_results (student_id, subject_name, kind, title, assessed_on, mark, out_of, entered_by, status, document_path) values
    (l1, 'Mathematics', 'test', 'T1', current_date - 30, 60, 100, l1, 'verified', l1 || '/a.pdf'), (l1, 'Mathematics', 'exam', 'E1', current_date - 20, 70, 100, l1, 'pending', l1 || '/b.pdf');
  insert into storage.objects (bucket_id, name) values ('school-results', l1 || '/a.pdf'), ('school-results', l1 || '/b.pdf'), ('school-results', l2 || '/c.pdf');
  insert into reviews (session_id, tutor_id, student_id, rating, comment) values (s3, t2, l1, 5, 'Great lessons');
  insert into conversations (student_id, tutor_id) values (l1, t2);
  insert into messages (conversation_id, sender_id, body) select id, l1, 'hello' from conversations where student_id = l1;
  insert into tutor_waitlist (student_id, requested_by, subject, grade_level) values (l1, l1, 'Mathematics', 'Grade 12');

  -- t1: the tutor an admin closes. An upcoming paid session with l2, a request addressed to them, a session completed 3 days ago, documents, a stray file, a payout account.
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
    values (l2, t1, l2, now() + interval '3 days', 100, 20, 100, 80) returning id into s4;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status, completed_at)
    values (l2, t1, l2, now() - interval '3 days', 100, 20, 100, 80, 'completed', now() - interval '3 days' + interval '1 hour') returning id into s5;
  insert into session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, status, payment_status, resulting_session_id, tutor_id, charge_reference) values
    (l2, l2, now() + interval '3 days', 'ca_ref_5', 100, 'accepted', 'paid', s4, t1, 'ca_chg_5'),
    (l2, l2, now() - interval '3 days', 'ca_ref_6', 100, 'accepted', 'paid', s5, t1, 'ca_chg_6');
  insert into session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, status, payment_status, requested_tutor_id)
    values (l2, l2, now() + interval '6 days', 'ca_ref_7', 100, 'pending', 'card_verified', t1);
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) values (t1, 2, '09:00', '12:00'), (t1, 3, '09:00', '12:00');
  insert into storage.objects (bucket_id, name) values ('tutor-documents', t1 || '/id.pdf'), ('tutor-documents', t1 || '/police.pdf'), ('tutor-documents', t1 || '/stray.pdf');
  insert into tutor_verification_documents (tutor_id, document_type, document_url) values (t1, 'identity_doc', t1 || '/id.pdf'), (t1, 'police_clearance', t1 || '/police.pdf');
  insert into tutor_payout_accounts (tutor_id, bank_name, account_holder_name, is_verified, paystack_subaccount_code) values (t1, 'X', 'Tia Tutor', true, 'ACCT_ca_t1');
  insert into notifications (profile_id, type, title, body) values (lh, 'x', 'n', 'n'), (lh, 'x', 'n', 'n');

  -- k1: a child whose guardian booked a paid session
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
    values (k1, t2, g1, now() + interval '2 days', 100, 20, 100, 80) returning id into sk;
  insert into session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, status, payment_status, resulting_session_id, tutor_id, charge_reference)
    values (k1, g1, now() + interval '2 days', 'ca_ref_8', 100, 'accepted', 'paid', sk, t2, 'ca_chg_8');
  r := r || 'S0 setup: 3 admins (one off), 8 adult learners, 4 tutors, 2 guardians, 3 children, sessions, paid requests, cards, files, results' || E'\n';
  select full_name into nm from profiles where id = l1;

  -- ============ A. the person closes their own account ====================================================================
  begin
    m := '';
    m := m || pg_temp.expect_err(null, $q$select public.request_account_closure('CLOSE')::text$q$, 'Sign in first');
    m := m || pg_temp.expect_err(l1, $q$select public.request_account_closure('close it')::text$q$, 'Type CLOSE to confirm');
    m := m || pg_temp.expect_err(l1, $q$select public.request_account_closure('CLOSE')::text$q$, 'Please sign in again to confirm this', 'authenticated', extract(epoch from now()) - 3600);
    m := m || pg_temp.expect_err(k1, $q$select public.request_account_closure('CLOSE')::text$q$, 'A learner under 18 can''t close their own account');
    m := m || pg_temp.expect_err(a1, $q$select public.request_account_closure('CLOSE')::text$q$, 'Admin accounts are closed another way');
    want := 'You can only close a learner under 18 who is linked to your account';
    m := m || pg_temp.expect_err(g1, format($q$select public.request_account_closure('CLOSE', %L)::text$q$, l2), want);
    m := m || pg_temp.expect_err(g1, format($q$select public.request_account_closure('CLOSE', %L)::text$q$, k3), want);
    m := m || pg_temp.expect_err(l1, format($q$select public.request_account_closure('CLOSE', %L)::text$q$, k1), want);
    m := m || pg_temp.expect_err(null, $q$select public.request_account_closure('CLOSE')::text$q$, 'permission denied', 'anon');
    r := r || 'A1 ' || case when m = '' then 'ok' else 'FAIL' end || ' 9 refusals, each for its own reason: signed out, wrong word, stale sign-in, child alone, admin, adult/stranger-child/child named by an adult' || m || E'\n';

    insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
      values (lb, t2, lb, now() + interval '10 minutes', 100, 20, 100, 80) returning id into sb;
    insert into video_rooms (id, code, host_id, created_at, expires_at) values (gen_random_uuid(), 'CLSAAAA3', t3, now(), now() + interval '2 hours');
    m := pg_temp.expect_err(lb, $q$select public.request_account_closure('CLOSE')::text$q$, 'Try again after your session');
    m := m || pg_temp.expect_err(a1, format($q$select public.admin_close_account(%L, 'terms_17_2', null, null, null, null, 'Fraud found')::text$q$, t3), 'Try again after your session');
    select count(*) into n from account_closures where profile_id in (lb, t3);
    update video_rooms set ended_at = now() where code = 'CLSAAAA3';
    update sessions set scheduled_start = now() + interval '3 hours' where id = sb;
    bl := not public.closure_busy(t3) and not public.closure_busy(lb);
    r := r || format('A2 %s a session starting in 10 minutes and an open video room each block (n closures made=%s, want 0); once they end/move, not busy=%s',
      case when m = '' and n = 0 and bl then 'ok' else 'FAIL' end, n, bl) || m || E'\n';

    j := pg_temp.call_json(l1, 'select public.preview_account_closure()::text');
    r := r || format('A3 %s preview: %s account, %s sessions to cancel (want 2), blocked=%s, %s kept lines (5), %s deleted lines (7), 30/90 days, the generic line is the same text',
      case when jsonb_array_length(j -> 'accounts') = 1 and jsonb_array_length(j -> 'accounts' -> 0 -> 'sessions_to_cancel') = 2 and (j ->> 'blocked') = 'false'
                and jsonb_array_length(j -> 'kept') = 5 and jsonb_array_length(j -> 'deleted') = 7 and (j ->> 'delete_after_days') = '30' and (j ->> 'delete_by_days') = '90'
                and (j ->> 'note') = 'We must keep some records for longer, because the law or an open matter requires it. Privacy Policy §14 says which.' then 'ok' else 'FAIL' end,
      jsonb_array_length(j -> 'accounts'), jsonb_array_length(j -> 'accounts' -> 0 -> 'sessions_to_cancel'), j ->> 'blocked', jsonb_array_length(j -> 'kept'), jsonb_array_length(j -> 'deleted')) || E'\n';

    select coalesce(max(id), 0) into base from net.http_request_queue;
    j := pg_temp.call_json(l1, $q$select public.request_account_closure('CLOSE')::text$q$);
    select id into c_l1 from account_closures where profile_id = l1;
    select count(*) into n from net.http_request_queue where id > base and url = 'https://api.paystack.co/refund';
    select count(*) filter (where s.status = 'cancelled_by_student'), count(*) filter (where q.payment_status = 'refund_pending' and q.status = 'cancelled' and q.refund_request_id is not null)
      into n2, n3 from sessions s join session_requests q on q.resulting_session_id = s.id where s.id in (s1, s2);
    select count(*) into n4 from session_requests where student_id = l1 and paystack_reference = 'ca_ref_4' and status = 'cancelled';
    select count(*) into n5 from notifications where profile_id = t2 and type = 'session_cancelled' and body = 'The learner cancelled the session.' and related_session_id in (s1, s2);
    select count(*) into n6 from sessions where id = s3 and status = 'completed' and meeting_url is not null;
    r := r || format('A4 %s closed at once: %s account, %s sessions cancelled (want 2), %s refund calls queued (2), cancelled=%s and refund_pending=%s, open request withdrawn=%s, tutor told twice=%s, old session untouched=%s',
      case when (j ->> 'accounts_closed') = '1' and (j ->> 'sessions_cancelled') = '2' and n = 2 and n2 = 2 and n3 = 2 and n4 = 1 and n5 = 2 and n6 = 1 then 'ok' else 'FAIL' end,
      j ->> 'accounts_closed', j ->> 'sessions_cancelled', n, n2, n3, n4, n5, n6) || E'\n';
    select (banned_until > now() + interval '99 years') into bl from auth.users where id = l1;
    select count(*) into n from auth.sessions where user_id = l1;
    select count(*) filter (where kind = 'email' and payload ->> 'to' = (select email from profiles where id = l1) and payload ->> 'template' = 'closed') into n2 from account_closure_tasks where closure_id = c_l1;
    select status = 'closed' and started_how = 'self' and was_adult and due_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour'
           and outer_limit_at between now() + interval '89 days 23 hours' and now() + interval '90 days 1 hour' and undo_until = due_at and sessions_cancelled = 2
      into bl2 from account_closures where id = c_l1;
    select full_name = nm into bl3 from profiles where id = l1;
    r := r || format('A5 %s signed out: banned in Auth=%s, sign-in sessions left=%s (want 0); one confirmation email queued to their address=%s; closure row right (closed, self, day 30/90, undo 30)=%s; name not yet blanked=%s; reply has delete_after/delete_by/undo_until=%s',
      case when bl and n = 0 and n2 = 1 and bl2 and bl3 and (j ->> 'delete_after') is not null and (j ->> 'delete_by') is not null and (j ->> 'undo_until') is not null then 'ok' else 'FAIL' end, bl, n, n2, bl2, bl3,
      (j ->> 'undo_until') is not null) || E'\n';
    r := r || 'A6 ' || case when pg_temp.expect_err(l1, $q$select public.request_account_closure('CLOSE')::text$q$, 'This account is already closed') = '' then 'ok' else 'FAIL' end || ' a second request is refused: "This account is already closed"' || E'\n';

    -- lb: a session 3 hours ahead with no paid request behind it: cancelled with nothing to refund, an admin is told
    j := pg_temp.call_json(lb, $q$select public.request_account_closure('CLOSE')::text$q$);
    select count(*) into n from sessions where id = sb and status = 'cancelled_by_student';
    select count(*) into n2 from notifications where profile_id = a1 and type = 'closure_session_unpaid';
    select count(*) into n3 from notifications where profile_id = t2 and related_session_id = sb and body = 'The learner cancelled the session.';
    select id into c_lb from account_closures where profile_id = lb;
    r := r || format('A7 %s a session with no paid request: cancelled=%s, nothing refunded (sessions_cancelled=%s), the admin was told=%s, the tutor was told=%s',
      case when n = 1 and (j ->> 'sessions_cancelled') = '1' and n2 = 1 and n3 = 1 then 'ok' else 'FAIL' end, n, j ->> 'sessions_cancelled', n2, n3) || E'\n';
  exception when others then
    reset role;
    r := r || 'A ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ B. a guardian closes one child, then the household ==========================================================
  begin
    j := pg_temp.call_json(g1, 'select public.preview_account_closure()::text');
    n := jsonb_array_length(j -> 'accounts');
    j := pg_temp.call_json(g1, format($q$select public.request_account_closure('CLOSE', %L)::text$q$, k1));
    select id into c_k1 from account_closures where profile_id = k1;
    select count(*) into n2 from account_closures where profile_id in (g1, k2);
    select started_how = 'guardian' and sessions_cancelled = 1 into bl from account_closures where id = c_k1;
    select count(*) into n3 from account_closure_tasks where closure_id = c_k1 and kind = 'email' and payload ->> 'to' = (select email from profiles where id = g1);
    select count(*) into n4 from sessions where id = sk and status = 'cancelled_by_student';
    select (banned_until > now() + interval '99 years') into bl2 from auth.users where id = k1;
    r := r || format('B1 %s preview for the guardian lists %s accounts (want 3); closing child k1: %s account, guardian and the other child still open (closures=%s, want 0), started by the guardian=%s, the email goes to the GUARDIAN''s address=%s, child''s booked session cancelled=%s, child banned=%s',
      case when n = 3 and (j ->> 'accounts_closed') = '1' and n2 = 0 and bl and n3 = 1 and n4 = 1 and bl2 then 'ok' else 'FAIL' end, n, j ->> 'accounts_closed', n2, bl, n3, n4, bl2) || E'\n';
    r := r || 'B2 ' || case when pg_temp.expect_err(g1, format($q$select public.request_account_closure('CLOSE', %L)::text$q$, k1), 'This account is already closed') = '' then 'ok' else 'FAIL' end || ' closing the same child twice is refused' || E'\n';

    j := pg_temp.call_json(g1, $q$select public.request_account_closure('CLOSE')::text$q$);
    select id into c_g1 from account_closures where profile_id = g1;
    select id into c_k2 from account_closures where profile_id = k2;
    select household_of = c_g1 and started_how = 'guardian' into bl from account_closures where id = c_k2;
    select started_how = 'self' and household_of is null into bl2 from account_closures where id = c_g1;
    r := r || format('B3 %s the guardian closes their own account: %s accounts closed (g1 + k2; k1 already was; want 2), k2 is linked to the guardian''s closure and started as "guardian"=%s, g1 started as "self"=%s',
      case when (j ->> 'accounts_closed') = '2' and bl and bl2 then 'ok' else 'FAIL' end, j ->> 'accounts_closed', bl, bl2) || E'\n';
  exception when others then
    reset role;
    r := r || 'B ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ C. an admin closes an account on a written request ==========================================================
  begin
    m := '';
    want := 'Admins only';
    m := m || pg_temp.expect_err(l2, format($q$select public.admin_close_account(%L, 'person_request', 'Tia', now(), 'phone call back', 'REF-1')::text$q$, t1), want);
    m := m || pg_temp.expect_err(a3, format($q$select public.admin_close_account(%L, 'person_request', 'Tia', now(), 'phone call back', 'REF-1')::text$q$, t1), want);
    m := m || pg_temp.expect_err(a1, format($q$select public.admin_close_account(%L, 'bogus', 'Tia', now(), 'phone call back', 'REF-1')::text$q$, t1), 'Say why: person_request or terms_17_2');
    m := m || pg_temp.expect_err(a1, format($q$select public.admin_close_account(%L, 'person_request', '', now(), 'phone call back', 'REF-1')::text$q$, t1), 'Write down who asked, how you checked it was them, and the reference of the request');
    m := m || pg_temp.expect_err(a1, format($q$select public.admin_close_account(%L, 'person_request', 'Tia', now() + interval '1 day', 'phone call back', 'REF-1')::text$q$, t1), 'Say when they asked');
    m := m || pg_temp.expect_err(a1, format($q$select public.admin_close_account(%L, 'terms_17_2', null, null, null, null, null)::text$q$, t1), 'Write down why the account is being closed');
    m := m || pg_temp.expect_err(a1, format($q$select public.admin_close_account(%L, 'terms_17_2', null, null, null, null, 'x')::text$q$, a2), 'Write down why the account is being closed');
    m := m || pg_temp.expect_err(a1, format($q$select public.admin_close_account(%L, 'terms_17_2', null, null, null, null, 'Fraud found')::text$q$, a2), 'Admin accounts are closed another way');
    m := m || pg_temp.expect_err(a1, format($q$select public.admin_close_account(%L, 'terms_17_2', null, null, null, null, 'Fraud found')::text$q$, gen_random_uuid()), 'No such account');
    r := r || 'C1 ' || case when m = '' then 'ok' else 'FAIL' end || ' 9 refusals: learner, switched-off admin, bad basis, blank who/how/ref, future date, no reason, admin target, no such account' || m || E'\n';

    select coalesce(avg_rating, 0), total_sessions_completed into rat, n from tutor_profiles where id = t1;
    j := pg_temp.call_json(a1, format($q$select public.admin_close_account(%L, 'person_request', 'Tia Tutor', now() - interval '1 day', 'called back on the number on file', 'REF-77')::text$q$, t1));
    select id into c_t1 from account_closures where profile_id = t1;
    select started_how = 'admin_request' and asked_by = 'Tia Tutor' and how_verified = 'called back on the number on file' and reference = 'REF-77' and asked_on < now() and started_by = a1
      into bl from account_closures where id = c_t1;
    select count(*) into n2 from sessions where id = s4 and status = 'cancelled_by_tutor';
    select count(*) into n3 from session_requests where paystack_reference = 'ca_ref_5' and payment_status = 'refund_pending' and refund_request_id is not null;
    select count(*) into n4 from session_requests where paystack_reference = 'ca_ref_7' and status = 'expired';
    select count(*) into n5 from notifications where profile_id = l2 and type = 'session_cancelled' and related_session_id = s4 and body like 'Your tutor cancelled the session.%refunded in full%';
    select is_dispatch_active into bl2 from tutor_profiles where id = t1;
    select count(*) into n6 from notifications where profile_id = a1 and type = 'closure_payout_owed';
    r := r || format('C2 %s admin closes tutor t1: who/when/how/reference recorded=%s, upcoming session cancelled=%s and refunded=%s, request addressed to them expired=%s, learner told with the refund sentence=%s, off dispatch=%s (want false), admin told a payout may be owed=%s',
      case when (j ->> 'accounts_closed') = '1' and bl and n2 = 1 and n3 = 1 and n4 = 1 and n5 = 1 and not bl2 and n6 = 1 then 'ok' else 'FAIL' end, bl, n2, n3, n4, n5, bl2, n6) || E'\n';

    -- a person on a safety hold
    perform pg_temp.call_json(a1, format($q$select public.place_safety_hold(%L, 'Reported for dangerous activity')::text$q$, lh));
    m := pg_temp.expect_err(a2, format($q$select public.admin_close_account(%L, 'person_request', 'Hal Held', now(), 'checked by phone', 'REF-9')::text$q$, lh), 'This person is on a safety hold');
    j2 := pg_temp.call_json(lh, $q$select public.request_account_closure('CLOSE')::text$q$);
    select id into c_lh from account_closures where profile_id = lh;
    select array_agg(k order by k) into arr from jsonb_object_keys(j) as k;
    select array_agg(k order by k) into arr2 from jsonb_object_keys(j2) as k;
    select count(*) into n from notifications where profile_id = a1 and type = 'closure_of_held_person';
    select count(*) into n2 from notifications where profile_id = lh;
    r := r || format('C3 %s a person on hold: a support agent cannot close them on a request (%s); they can close themselves; the reply has the SAME keys=%s and the same note=%s as anyone''s; the admin was alerted=%s; nothing deleted yet (notifications=%s, want 2)',
      case when m = '' and arr = arr2 and (j ->> 'note') = (j2 ->> 'note') and n = 1 and n2 = 2 then 'ok' else 'FAIL' end, case when m = '' then 'refused' else m end, arr = arr2, (j ->> 'note') = (j2 ->> 'note'), n, n2) || E'\n';
  exception when others then
    reset role;
    r := r || 'C ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ D. undo (admin only, within 30 days, if the person asks) ====================================================
  begin
    j := pg_temp.call_json(lu, $q$select public.request_account_closure('CLOSE')::text$q$);
    select id into c_lu from account_closures where profile_id = lu;
    update tutor_profiles set is_dispatch_active = true where id = tu;
    perform pg_temp.call_json(tu, $q$select public.request_account_closure('CLOSE')::text$q$);
    select id into c_tu from account_closures where profile_id = tu;
    select is_dispatch_active into bl from tutor_profiles where id = tu;
    m := '';
    m := m || pg_temp.expect_err(l2, format($q$select public.undo_account_closure(%L, 'Uli', 'phoned', 'asked back')::text$q$, c_lu), 'Admins only');
    m := m || pg_temp.expect_err(a1, format($q$select public.undo_account_closure(%L, '', 'phoned', 'asked back')::text$q$, c_lu), 'Write down who asked, how you checked it was them, and a short note');
    m := m || pg_temp.expect_err(a1, format($q$select public.undo_account_closure(%L, 'Uli', 'phoned', 'asked back')::text$q$, gen_random_uuid()), 'No such closure');
    j := pg_temp.call_json(a1, format($q$select public.undo_account_closure(%L, 'Uli Undo', 'phoned on the number on file', 'asked back the next day')::text$q$, c_lu));
    select status = 'undone' and undone_by = a1 and contact_email is null into bl2 from account_closures where id = c_lu;
    select banned_until is null into bl3 from auth.users where id = lu;
    select count(*) into n from account_closure_tasks where closure_id = c_lu and kind = 'email' and payload ->> 'template' = 'reopened';
    m := m || pg_temp.expect_err(a1, format($q$select public.undo_account_closure(%L, 'Uli Undo', 'phoned', 'again')::text$q$, c_lu), 'This closure can no longer be undone');
    r := r || format('D1 %s undo: a learner, a blank note and an unknown id are refused; an admin reopens (%s)=%s, status undone and the address cleared=%s, sign-in allowed again=%s, a "reopened" email queued=%s; a second undo is refused',
      case when m = '' and (j ->> 'reopened') = '1' and bl2 and bl3 and n = 1 then 'ok' else 'FAIL' end, j ->> 'reopened', (j ->> 'reopened') = '1', bl2, bl3, n) || m || E'\n';
    perform pg_temp.call_json(a1, format($q$select public.undo_account_closure(%L, 'Tab Undo', 'phoned', 'asked back')::text$q$, c_tu));
    select is_dispatch_active into bl2 from tutor_profiles where id = tu;
    r := r || format('D2 %s a tutor''s dispatch is switched off by closing (%s) and back on by the undo (%s)', case when not bl and bl2 then 'ok' else 'FAIL' end, not bl, bl2) || E'\n';
    update account_closures set undo_until = now() - interval '1 minute' where id = c_lb;
    r := r || 'D3 ' || case when pg_temp.expect_err(a1, format($q$select public.undo_account_closure(%L, 'Bo Busy', 'phoned', 'asked')::text$q$, c_lb), 'This closure can no longer be undone') = '' then 'ok' else 'FAIL' end || ' after the 30 days an undo is refused' || E'\n';

    perform pg_temp.call_json(g2, $q$select public.request_account_closure('CLOSE')::text$q$);
    select id into c_g2 from account_closures where profile_id = g2;
    select id into c_k3 from account_closures where profile_id = k3;
    select (banned_until > now() + interval '99 years') into bl from auth.users where id = k3;
    j := pg_temp.call_json(a1, format($q$select public.undo_account_closure(%L, 'Gus Other', 'phoned', 'asked back')::text$q$, c_g2));
    select count(*) into n from account_closures where id in (c_g2, c_k3) and status = 'undone';
    select banned_until is null into bl2 from auth.users where id = k3;
    r := r || format('D4 %s undoing a guardian''s closure also reopens the children closed with it: reopened=%s (want 2), both undone=%s, child sign-in allowed=%s (child was banned=%s)',
      case when (j ->> 'reopened') = '2' and n = 2 and bl2 and bl then 'ok' else 'FAIL' end, j ->> 'reopened', n, bl2, bl) || E'\n';
  exception when others then
    reset role;
    r := r || 'D ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ E. the day-30 job ==========================================================================================
  begin
    perform pg_temp.call_json(ld, $q$select public.request_account_closure('CLOSE')::text$q$);
    select id into c_ld from account_closures where profile_id = ld;
    m := pg_temp.expect_err(l2, format($q$select public.defer_account_closure(%L, current_date + 1, 'Bank dispute')::text$q$, c_ld), 'Admins only');
    m := m || pg_temp.expect_err(a1, format($q$select public.defer_account_closure(%L, current_date - 1, 'Bank dispute')::text$q$, c_ld), 'Give a date in the future and a short reason');
    m := m || pg_temp.expect_err(a1, format($q$select public.defer_account_closure(%L, current_date + 1, '')::text$q$, c_ld), 'Give a date in the future and a short reason');
    perform pg_temp.call_json(a1, format($q$select public.defer_account_closure(%L, current_date + 1, 'Bank dispute')::text$q$, c_ld));
    r := r || 'E0 ' || case when m = '' then 'ok' else 'FAIL' end || ' a deferral needs an admin, a future date and a reason' || m || E'\n';

    j := public.run_account_closures();
    select full_name = nm into bl from profiles where id = l1;
    r := r || format('E1 %s before day 30 nothing is due: deleted=%s (want 0), name still intact=%s', case when (j ->> 'deleted') = '0' and bl then 'ok' else 'FAIL' end, j ->> 'deleted', bl) || E'\n';

    update account_closures set due_at = now() - interval '1 minute' where profile_id in (l1, t1, g1, k1, k2, lh, ld);
    j := public.run_account_closures();
    r := r || format('E2 %s the job on day 30: deleted=%s (want 5: l1, t1, g1, k1, k2), held back for a safety hold=%s (1), waiting on a deferral=%s (1), errors=%s (0)',
      case when (j ->> 'deleted') = '5' and (j ->> 'held') = '1' and (j ->> 'waiting') = '1' and (j ->> 'errors') = '0' then 'ok' else 'FAIL' end, j ->> 'deleted', j ->> 'held', j ->> 'waiting', j ->> 'errors') || E'\n';
    if (j ->> 'errors') <> '0' then
      r := r || 'E2b FAIL ' || coalesce((select string_agg(left(last_error, 110), ' | ') from account_closures where last_error is not null), '') || E'\n';
    end if;

    -- l1: what was deleted, blanked, kept
    select (full_name = 'Former learner' and email = 'closed.' || l1 || '@closed.invalid' and phone_number is null and avatar_url is null and date_of_birth is null) into bl from profiles where id = l1;
    select (first_name = '' and surname = '' and email = 'closed.' || l1 || '@closed.invalid' and phone_number is null) into bl2 from student_profiles where id = l1;
    select (select count(*) from notifications where profile_id = l1) + (select count(*) from messages where sender_id = l1) + (select count(*) from conversations where student_id = l1)
         + (select count(*) from student_availability where student_id = l1) + (select count(*) from student_subject_enrollments where student_id = l1)
         + (select count(*) from school_results where student_id = l1) + (select count(*) from tutor_waitlist where student_id = l1) into n;
    select (select count(*) from sessions where student_id = l1), (select count(*) from session_requests where student_id = l1),
           (select count(*) from reviews where student_id = l1 and rating = 5 and comment is null), (select count(*) from sessions where id = s3 and meeting_url is null and enrollment_id is null)
      into n2, n3, n4, n5;
    r := r || format('E3 %s learner l1: profile blanked in place ("Former learner", placeholder email, no phone/picture/birth date)=%s, learner row blanked=%s, own data deleted (left=%s, want 0), the rows stay: sessions=%s (3) requests=%s (4), review kept with rating but no comment=%s, old session''s link and enrolment emptied=%s',
      case when bl and bl2 and n = 0 and n2 = 3 and n3 = 4 and n4 = 1 and n5 = 1 then 'ok' else 'FAIL' end, bl, bl2, n, n2, n3, n4, n5) || E'\n';
    select count(*), max(display_name) into n, t from account_tombstones where profile_id = l1;
    select count(*) filter (where kept is not null and jsonb_array_length(kept) = 6 and jsonb_array_length(outside) = 4 and started_by = l1 and started_how = 'self' and (deleted ->> 'notifications')::int = 3 and (deleted ->> 'school_results')::int = 2), count(*)
      into n2, n3 from account_deletion_records where profile_id = l1;
    select (select count(*) from notifications where profile_id = l2), (select count(*) from student_subject_enrollments where student_id = l2), (select full_name from profiles where id = l2)
      into n4, n5, w2;
    r := r || format('E4 %s tombstone holds the adult''s name (%s), one deletion record with 3 notifications and 2 results counted, 6 kept lines, 4 outside lines, who started it=%s/%s; the control learner l2 is untouched (notifications=%s (2 + the tutor-cancelled notice), enrolments=%s, name=%s)',
      case when n = 1 and t = 'Lee Learner' and n2 = 1 and n3 = 1 and n4 = 3 and n5 = 1 and w2 = 'Lou Control' then 'ok' else 'FAIL' end, t, n2, n3, n4, n5, w2) || E'\n';
    select count(*) filter (where kind = 'storage_remove' and payload ->> 'bucket' = 'school-results' and jsonb_array_length(payload -> 'paths') = 2),
           count(*) filter (where kind = 'email' and payload ->> 'template' = 'final' and payload ->> 'to' is not null),
           count(*) filter (where kind = 'auth_delete' and payload ->> 'user_id' = l1::text), count(*) filter (where kind = 'paystack_cards')
      into n, n2, n3, n4 from account_closure_tasks where closure_id = c_l1;
    select status, cards_kept into t, bl from account_closures where id = c_l1;
    select count(*) into n5 from payment_cards where profile_id = l1;
    r := r || format('E5 %s l1''s outside steps queued: 1 file step with the 2 files, 1 final email carrying the address, 1 Auth delete, cards NOT yet (a refund is unconfirmed): card steps=%s, cards still stored=%s (2), status=%s, cards_kept=%s',
      case when n = 1 and n2 = 1 and n3 = 1 and n4 = 0 and n5 = 2 and t = 'db_deleted' and bl then 'ok' else 'FAIL' end, n4, n5, t, bl) || E'\n';

    -- t1: documents and the pseudonymous rows stay; stray file goes; payout details wait while money may be owed
    select count(*) into n from tutor_availability where tutor_id = t1;
    select count(*) into n2 from tutor_verification_documents where tutor_id = t1;
    select (headline is null and coalesce(avg_rating, 0) = rat and total_sessions_completed = 7 and not is_dispatch_active) into bl from tutor_profiles where id = t1;
    select full_name = 'Former tutor' into bl2 from profiles where id = t1;
    select count(*) filter (where payload ->> 'bucket' = 'tutor-documents' and payload -> 'paths' = jsonb_build_array(t1 || '/stray.pdf')), count(*) filter (where kind = 'storage_remove') into n3, n4
      from account_closure_tasks where closure_id = c_t1 and kind = 'storage_remove';
    select count(*) into n5 from tutor_payout_accounts where tutor_id = t1;
    select count(*) into n6 from account_closure_tasks where closure_id = c_t1 and kind = 'paystack_subaccount';
    select payout_kept into bl3 from account_closures where id = c_t1;
    r := r || format('E6 %s tutor t1: availability deleted (%s), 2 documents kept (%s), headline emptied and level numbers kept=%s, "Former tutor"=%s, only the STRAY file queued for removal=%s of %s step(s), payout details kept while a session ended 3 days ago (accounts=%s, subaccount steps=%s, flag=%s)',
      case when n = 0 and n2 = 2 and bl and bl2 and n3 = 1 and n4 = 1 and n5 = 1 and n6 = 0 and bl3 then 'ok' else 'FAIL' end, n, n2, bl, bl2, n3, n4, n5, n6, bl3) || E'\n';

    -- guardian and children: the adult is named in the tombstone, a child never is
    select (select display_name from account_tombstones where profile_id = g1), (select count(*) from account_tombstones where profile_id in (k1, k2) and display_name is null),
           (select count(*) from profiles where id in (k1, k2) and full_name = 'Former learner'), (select full_name from profiles where id = g1),
           (select count(*) from parent_student_links where parent_id = g1), (select count(*) from guardian_consents where guardian_profile_id = g1)
      into t, n, n2, w2, n3, n4;
    r := r || format('E7 %s guardian g1: tombstone names the adult (%s) but neither child (%s of 2 nameless); children "Former learner"=%s of 2; guardian "%s"; links deleted (%s, want 0); consent records kept (%s, want 2)',
      case when t = 'Gina Guard' and n = 2 and n2 = 2 and w2 = 'Former guardian' and n3 = 0 and n4 = 2 then 'ok' else 'FAIL' end, t, n, n2, w2, n3, n4) || E'\n';

    -- the hold wins; the deferral waits
    select (select full_name from profiles where id = lh), (select count(*) from notifications where profile_id = lh), (select count(*) from payment_cards where profile_id = lh),
           (select count(*) from account_closure_tasks where closure_id = c_lh and kind <> 'email'), (select status from account_closures where id = c_lh),
           (select full_name from profiles where id = ld), (select status from account_closures where id = c_ld)
      into t, n, n2, n3, w2, w3, m;
    r := r || format('E8 %s the held person keeps everything (name "%s", notifications=%s (2), card=%s (1), deletion steps=%s (0), still "%s"); the deferred one is untouched (name "%s", still "%s")',
      case when t = 'Hal Held' and n = 2 and n2 = 1 and n3 = 0 and w2 = 'closed' and w3 = 'Dee Defer' and m = 'closed' then 'ok' else 'FAIL' end, t, n, n2, n3, w2, w3, m) || E'\n';

    perform pg_temp.call_json(a1, format($q$select public.release_safety_hold(%L, 'Cleared: no case')::text$q$, lh));
    perform pg_temp.call_json(a1, format($q$select public.defer_account_closure(%L, null, null)::text$q$, c_ld));
    insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status, completed_at)
      values (ld, t2, ld, now() - interval '40 days', 100, 20, 100, 80, 'completed', now() - interval '40 days') returning id into sd;
    insert into platform_disputes (session_id, raised_by_id, reason, description) values (sd, ld, 'other', 'test dispute') returning id into did;
    update account_closures set due_at = now() - interval '1 minute' where id in (c_lh, c_ld);
    j := public.run_account_closures();
    select (select full_name from profiles where id = lh), (select full_name from profiles where id = ld) into t, w2;
    r := r || format('E9 %s after the hold is released the held person is deleted next run (deleted=%s, name now "%s"); an open dispute still holds ld back (waiting=%s, name "%s")',
      case when (j ->> 'deleted') = '1' and t = 'Former learner' and (j ->> 'waiting') = '1' and w2 = 'Dee Defer' then 'ok' else 'FAIL' end, j ->> 'deleted', t, j ->> 'waiting', w2) || E'\n';
    update platform_disputes set status = 'dismissed' where id = did;
    j := public.run_account_closures();
    select full_name into t from profiles where id = ld;
    r := r || format('E10 %s the dispute is closed: the next run deletes ld (deleted=%s, name "%s")', case when (j ->> 'deleted') = '1' and t = 'Former learner' then 'ok' else 'FAIL' end, j ->> 'deleted', t) || E'\n';

    -- money: cards wait for the refund to be confirmed; payout details wait for the money
    update session_requests set payment_status = 'refunded' where student_id = l1 and payment_status = 'refund_pending';
    update sessions set completed_at = now() - interval '10 days' where id = s5;
    j := public.run_account_closures();
    select count(*) into n from payment_cards where profile_id = l1;
    select count(*) filter (where kind = 'paystack_cards' and jsonb_array_length(payload -> 'authorization_codes') = 2) into n2 from account_closure_tasks where closure_id = c_l1;
    select cards_kept into bl from account_closures where id = c_l1;
    select count(*) into n3 from tutor_payout_accounts where tutor_id = t1;
    select count(*) filter (where kind = 'paystack_subaccount' and payload ->> 'subaccount_code' = 'ACCT_ca_t1') into n4 from account_closure_tasks where closure_id = c_t1;
    select payout_kept into bl2 from account_closures where id = c_t1;
    r := r || format('E11 %s once Paystack confirmed the refund the saved cards are deleted (left=%s) and one card step with 2 codes is queued=%s, flag cleared=%s; once nothing is owed the payout details are deleted (left=%s) and the subaccount step is queued=%s, flag cleared=%s',
      case when n = 0 and n2 = 1 and not bl and n3 = 0 and n4 = 1 and not bl2 then 'ok' else 'FAIL' end, n, n2, not bl, n3, n4, not bl2) || E'\n';

    -- day 90: an alert, once
    perform pg_temp.call_json(lo, $q$select public.request_account_closure('CLOSE')::text$q$);
    select id into c_lo from account_closures where profile_id = lo;
    update account_closures set outer_limit_at = now() - interval '1 day' where id = c_lo;
    select count(*) into n from notifications where profile_id = a1 and type = 'closure_overdue';
    j := public.run_account_closures();
    select count(*) into n2 from notifications where profile_id = a1 and type = 'closure_overdue';
    j2 := public.run_account_closures();
    select count(*) into n3 from notifications where profile_id = a1 and type = 'closure_overdue';
    r := r || format('E12 %s a closure past day 90 alerts the admins once: alerts %s -> %s -> %s (want +1 then +0)', case when n2 = n + 1 and n3 = n2 and (j ->> 'overdue_alerts') = '1' then 'ok' else 'FAIL' end, n, n2, n3) || E'\n';
    select count(*), count(*) filter (where kind = 'email') into n, n2 from account_closure_tasks where closure_id = c_lo;
    select contact_email is null into bl from account_closures where id = c_lo;
    r := r || format('E13 %s a learner whose sign-in name is under learners.tutorlage.invalid (it can never receive mail) is closed with no email queued (steps=%s, emails=%s, address kept=%s)',
      case when n2 = 0 and bl then 'ok' else 'FAIL' end, n, n2, not bl) || E'\n';
  exception when others then
    reset role;
    r := r || 'E ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ F. the insert-only record, the locked tables, the admin reads ===============================================
  begin
    begin update account_deletion_records set role = 'x'; t := 'FAIL'; exception when others then t := sqlerrm; end;
    begin delete from account_deletion_records; w2 := 'FAIL'; exception when others then w2 := sqlerrm; end;
    begin truncate account_deletion_records; w3 := 'FAIL'; exception when others then w3 := sqlerrm; end;
    m := '';
    for i in 1 .. 4 loop
      want := (array['account_closures', 'account_tombstones', 'account_deletion_records', 'account_closure_tasks'])[i];
      m := m || pg_temp.expect_err(a1, 'select count(*)::text from public.' || want, 'permission denied', 'authenticated')
             || pg_temp.expect_err(null, 'select count(*)::text from public.' || want, 'permission denied', 'anon')
             || pg_temp.expect_err(null, 'select count(*)::text from public.' || want, 'permission denied', 'service_role');
    end loop;
    r := r || format('F1 %s the deletion record cannot be changed, deleted or truncated even by the owner ("%s" x3); 12 reads of the four tables (admin, signed-out, server key) are all "permission denied"',
      case when t = 'Deletion records can only be added to' and w2 = t and w3 = t and m = '' then 'ok' else 'FAIL' end, left(t, 25)) || m || E'\n';

    m := pg_temp.expect_err(l2, 'select count(*)::text from public.list_account_closures()', 'Admins only');
    j := pg_temp.call_json(a1, format($q$select jsonb_build_object('n', count(*), 'rec', count(*) filter (where closure_id = %L and record is not null and status = 'db_deleted'))::text from public.list_account_closures(true)$q$, c_l1));
    j2 := pg_temp.call_json(a1, $q$select jsonb_build_object('fin', count(*) filter (where status in ('done', 'undone')))::text from public.list_account_closures(false)$q$);
    n2 := (j ->> 'n')::int; n3 := (j ->> 'rec')::int; n4 := (j2 ->> 'fin')::int;
    m := m || pg_temp.expect_err(a2, format($q$select count(*)::text from public.read_account_tombstone(%L)$q$, l1), 'Only a super admin can read this');
    m := m || pg_temp.expect_err(l2, format($q$select count(*)::text from public.read_account_tombstone(%L)$q$, l1), 'Only a super admin can read this');
    t := substr(pg_temp.call_as(a1, format($q$select display_name from public.read_account_tombstone(%L)$q$, l1)), 4);
    r := r || format('F2 %s admin list: refused to a learner; an admin sees %s closures in all, l1''s with its deletion record=%s; the open list has no finished ones (%s); the tombstone is readable only by a super admin (name "%s")',
      case when m = '' and n2 >= 9 and n3 = 1 and n4 = 0 and t = 'Lee Learner' then 'ok' else 'FAIL' end, n2, n3, n4, t) || m || E'\n';
  exception when others then
    reset role;
    r := r || 'F ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ G. the Worker's two calls, and deleting the Auth user =======================================================
  begin
    m := pg_temp.expect_err(a1, 'select close_account_claim_tasks(5)::text', 'permission denied')
      || pg_temp.expect_err(null, 'select close_account_claim_tasks(5)::text', 'permission denied', 'anon')
      || pg_temp.expect_err(a1, 'select close_account_task_result(1, true, null, false)::text', 'permission denied');
    -- claim as the server key
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    j := public.close_account_claim_tasks(100);
    reset role;
    select array_agg(x ->> 'kind' order by ord) into arr from jsonb_array_elements(j) with ordinality as e(x, ord);
    select count(*) filter (where x ->> 'kind' = 'auth_delete'), count(*) into n, n2 from jsonb_array_elements(j) as e(x);
    -- the list comes back in the order the steps are to be done: emails before files; auth deletes only after their siblings are done
    select count(*) into n3 from jsonb_array_elements(j) with ordinality as e(x, ord)
      where x ->> 'kind' = 'email' and ord > (select min(ord2) from jsonb_array_elements(j) with ordinality as f(y, ord2) where y ->> 'kind' = 'storage_remove');
    select count(*) into n4 from account_closure_tasks where status = 'claimed' and attempts = 1;
    r := r || format('G1 %s the Worker claims %s steps as the server key; browsers and signed-out callers are refused=%s; auth deletes handed out while sibling steps are open=%s (want 0); an email after a file step=%s (0); claimed rows marked with 1 try=%s',
      case when m = '' and n = 0 and n2 > 0 and n3 = 0 and n4 = n2 then 'ok' else 'FAIL' end, n2, m = '', n, n3, n4) || m || E'\n';

    -- results: done drops the address; a failure waits 10 minutes; the 5th failure gives up and tells the admins; "waiting" does not count a try
    select (x ->> 'id')::bigint into tid from jsonb_array_elements(j) as e(x) where x ->> 'kind' = 'email' and x -> 'payload' ? 'to' limit 1;
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    perform public.close_account_task_result(tid, true, null, false);
    reset role;
    select status = 'done' and not (payload ? 'to') and not (payload ? 'text') into bl from account_closure_tasks where id = tid;
    select (x ->> 'id')::bigint into tid from jsonb_array_elements(j) as e(x) where x ->> 'kind' = 'storage_remove' limit 1;
    set local role service_role;
    perform public.close_account_task_result(tid, false, 'bucket busy', false);
    j2 := public.close_account_claim_tasks(100);
    reset role;
    select status = 'pending' and attempts = 1 and last_error = 'bucket busy' into bl2 from account_closure_tasks where id = tid;
    select count(*) into n from jsonb_array_elements(j2) as e(x) where (x ->> 'id')::bigint = tid;
    n2 := 0;
    for i in 2 .. 5 loop
      update account_closure_tasks set claimed_at = now() - interval '11 minutes' where id = tid;
      set local role service_role;
      j3 := public.close_account_claim_tasks(100);
      perform public.close_account_task_result(tid, false, 'bucket busy', false);
      reset role;
      select count(*) into n3 from jsonb_array_elements(j3) as e(x) where (x ->> 'id')::bigint = tid;
      n2 := n2 + n3;
    end loop;
    select status = 'gave_up' and attempts = 5 into bl3 from account_closure_tasks where id = tid;
    select count(*) into n3 from notifications where profile_id = a1 and type = 'closure_step_failed';
    r := r || format('G2 %s a done email loses its address=%s; a failed step is pending with its error=%s and NOT handed out again at once (handed out=%s, want 0); after 11 minutes it is handed out again (%s of 4); the 5th failure gives up=%s and tells the admins=%s',
      case when bl and bl2 and n = 0 and n2 = 4 and bl3 and n3 = 1 then 'ok' else 'FAIL' end, bl, bl2, n, n2, bl3, n3) || E'\n';
    select (x ->> 'id')::bigint into tid from jsonb_array_elements(j) as e(x) where x ->> 'kind' = 'paystack_subaccount' limit 1;
    update account_closure_tasks set status = 'claimed', attempts = 1, claimed_at = now() where id = tid;
    set local role service_role;
    perform public.close_account_task_result(tid, false, 'no key yet', true);
    reset role;
    select status = 'pending' and attempts = 0 into bl from account_closure_tasks where id = tid;
    r := r || format('G3 %s a "waiting" result is pending again and the try is not counted (attempts back to 0)=%s', case when bl then 'ok' else 'FAIL' end, bl) || E'\n';
  exception when others then
    reset role;
    r := r || 'G ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  begin
    -- the Auth delete of a closed account keeps the profile; of any other account it works as before
    update account_closure_tasks set status = 'done', done_at = now() where closure_id = c_k2 and kind <> 'auth_delete';
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    j := public.close_account_claim_tasks(100);
    reset role;
    select count(*) into n from jsonb_array_elements(j) as e(x) where x ->> 'kind' = 'auth_delete' and x -> 'payload' ->> 'user_id' = k2::text;
    update account_closure_tasks set status = 'pending', claimed_at = null where closure_id = c_k2 and kind = 'auth_delete';
    -- the gate: without the link migration's trigger (the function is renamed away for a moment) or with a cascading foreign key, it is not safe
    alter function public.keep_closed_profile_after_auth_delete() rename to keep_closed_profile_after_auth_delete_x;
    bl := public.closure_auth_link_is_safe();
    set local role service_role;
    j2 := public.close_account_claim_tasks(100);
    reset role;
    select count(*) into n2 from jsonb_array_elements(j2) as e(x) where x ->> 'kind' = 'auth_delete';
    alter function public.keep_closed_profile_after_auth_delete_x() rename to keep_closed_profile_after_auth_delete;
    bl2 := public.closure_auth_link_is_safe();
    if has_table_privilege('postgres', 'auth.users', 'REFERENCES') then
      alter table public.profiles add constraint profiles_id_fkey foreign key (id) references auth.users (id) on delete cascade not valid;
      bl3 := public.closure_auth_link_is_safe();
      alter table public.profiles drop constraint profiles_id_fkey;
      t := '';
    else
      bl3 := false;
      t := ' (foreign-key half not tried: no REFERENCES right)';
    end if;
    set local role service_role;
    j2 := public.close_account_claim_tasks(100);
    reset role;
    select count(*) into n3 from jsonb_array_elements(j2) as e(x) where x ->> 'kind' = 'auth_delete' and x -> 'payload' ->> 'user_id' = k2::text;
    r := r || format('G4 %s the Auth delete is handed out once its siblings are done (%s of 1); with the trigger function missing it is NOT (safe=%s, handed out=%s, want 0); with a cascading foreign key it is NOT (safe=%s); with both as built it is, safe=%s and handed out=%s',
      case when n = 1 and not bl and n2 = 0 and bl2 and not bl3 and n3 = 1 then 'ok' else 'FAIL' end, n, bl, n2, bl3, bl2, n3) || t || E'\n';

    select count(*) into n from profiles where id = k2;
    select count(*) into n2 from sessions where student_id = l1;
    delete from auth.users where id = l1;
    delete from auth.users where id = k2;
    select (select count(*) from profiles where id in (l1, k2)), (select count(*) from sessions where student_id = l1), (select count(*) from session_requests where student_id = l1),
           (select count(*) from account_tombstones where profile_id in (l1, k2)), (select full_name from profiles where id = k2)
      into n3, n4, n5, n6, t;
    r := r || format('G5 %s deleting the Auth users of two CLOSED accounts keeps their profile rows (%s of 2), their sessions (%s of 3), requests (%s of 4) and tombstones (%s of 2); k2 still reads "%s"',
      case when n3 = 2 and n4 = 3 and n5 = 4 and n6 = 2 and t = 'Former learner' then 'ok' else 'FAIL' end, n3, n4, n5, n6, t) || E'\n';
    delete from auth.users where id = lp;
    select count(*) into n from profiles where id = lp;
    m := '';
    begin
      delete from auth.users where id = l2;
      m := 'deleted';
    exception when others then
      m := case when sqlerrm like '%foreign key%' then '' else sqlerrm end;
    end;
    select count(*) into n2 from profiles where id = l2;
    r := r || format('G6 %s any other account behaves as before: one with no history loses its profile with its sign-in (left=%s, want 0); one with sessions is refused by the same foreign keys (profile left=%s, want 1)',
      case when n = 0 and m = '' and n2 = 1 then 'ok' else 'FAIL' end, n, n2) || coalesce(m, '') || E'\n';

    -- every step of k2 is done: the job marks the closure finished
    update account_closure_tasks set status = 'done', done_at = now() where closure_id = c_k2;
    j := public.run_account_closures();
    select status, done_at is not null into t, bl from account_closures where id = c_k2;
    r := r || format('G7 %s with every step done the job marks k2''s closure "done" (status "%s", finished=%s)', case when t = 'done' and bl then 'ok' else 'FAIL' end, t, (j ->> 'finished')::int >= 1) || E'\n';
  exception when others then
    reset role;
    r := r || 'G ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ H. waking the Worker =======================================================================================
  begin
    select coalesce(max(id), 0) into base from net.http_request_queue;
    perform public.closure_wake_worker();
    select count(*) into n from net.http_request_queue where id > base;
    update system_settings set setting_value = to_jsonb('https://example.invalid/hooks/'::text) where setting_key = 'account_closure_worker_url';
    perform vault.create_secret('test-only-not-a-real-secret', 'account_closure_job_secret');
    update account_closure_tasks set status = 'pending', claimed_at = null where id = (select min(id) from account_closure_tasks);
    perform public.closure_wake_worker();
    select count(*), max(url), bool_or(position('x-job-secret' in headers::text) > 0) into n2, t, bl from net.http_request_queue where id > base;
    r := r || format('H1 %s the job wakes the Worker only when its address and secret are set (calls before=%s, want 0; after=%s, want 1): %s, secret sent in x-job-secret=%s',
      case when n = 0 and n2 = 1 and t = 'https://example.invalid/hooks/api/internal/close-account/run' and bl then 'ok' else 'FAIL' end, n, n2, t, bl) || E'\n';
  exception when others then
    r := r || 'H ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ I. how it is built ==========================================================================================
  begin
    select count(*) filter (where c.relrowsecurity), count(*) into n, n2 from pg_class c
    where c.oid in ('public.account_closures'::regclass, 'public.account_tombstones'::regclass, 'public.account_deletion_records'::regclass, 'public.account_closure_tasks'::regclass);
    select count(*) into n3 from pg_trigger where tgrelid = 'public.account_deletion_records'::regclass and not tgisinternal;
    arr := array['preview_account_closure', 'request_account_closure', 'admin_close_account', 'undo_account_closure', 'defer_account_closure', 'list_account_closures', 'read_account_tombstone'];
    arr2 := array['closure_int_setting', 'closure_is_adult', 'closure_is_super_admin', 'closure_busy', 'closure_has_open_dispute', 'closure_enqueue', 'closure_text', 'closure_household', 'closure_targets',
                  'closure_refund', 'closure_cancel_session', 'closure_start', 'closure_run', 'closure_wake_worker', 'closure_auth_link_is_safe', 'closure_delete_money', 'closure_enqueue_files',
                  'closure_delete_data', 'run_account_closures'];
    select count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute'))
      into n4 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(arr);
    select count(*) filter (where not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute'))
      into n5 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(arr2);
    select count(*) filter (where has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
      into n6 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('close_account_claim_tasks', 'close_account_task_result');
    r := r || format('I1 %s built: row security on %s of 4 tables; 2 triggers on the record; 7 callable functions open only to signed-in users=%s; 19 internal functions open to no API role=%s; the 2 Worker functions open only to the server key=%s',
      case when n = 4 and n2 = 4 and n3 = 2 and n4 = 7 and n5 = 19 and n6 = 2 then 'ok' else 'FAIL' end, n, n4, n5, n6) || E'\n';
    select count(*) filter (where p.prosecdef), count(*) filter (where p.proconfig::text like '%search_path=public%'), count(*) into n, n2, n3 from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = any(arr || arr2 || array['close_account_claim_tasks', 'close_account_task_result', 'account_deletion_records_are_append_only', 'keep_closed_profile_after_auth_delete']);
    r := r || format('I2 %s every new function has a pinned search path (%s of %s) and all but the record trigger and closure_text() are definers (%s)', case when n3 = 30 and n2 = 30 and n = 28 then 'ok' else 'FAIL' end, n2, n3, n) || E'\n';
    select count(*) into n from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'f' and confrelid = 'auth.users'::regclass;
    select count(*) into n2 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'keep_closed_profile_after_auth_delete';
    bl := public.closure_auth_link_is_safe();
    r := r || format('I3 %s the profile no longer cascades from Auth (foreign keys left=%s), the keep-the-profile trigger is on auth.users (%s), and the tool sees it is safe=%s', case when n = 0 and n2 = 1 and bl then 'ok' else 'FAIL' end, n, n2, bl) || E'\n';
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
      execute 'select count(*) = 1 and bool_and(schedule = ''10 3 * * *'' and command = ''select public.run_account_closures();'') from cron.job where jobname = ''run-account-closures''' into bl;
    else
      bl := true;
    end if;
    r := r || format('I4 %s the daily job is scheduled at 03:10 (%s) and the setting rows exist=%s', case when bl and (select count(*) from system_settings where setting_key in ('account_closure_days_to_delete', 'account_closure_days_outer_limit', 'account_closure_worker_url')) = 3 then 'ok' else 'FAIL' end, bl,
      (select count(*) from system_settings where setting_key like 'account_closure_%') >= 3) || E'\n';
    m := pg_temp.expect_err(a1, 'select public.run_account_closures()::text', 'permission denied');
    r := r || 'I5 ' || case when m = '' then 'ok' else 'FAIL' end || ' an admin cannot run the daily job' || m || E'\n';
  exception when others then
    reset role;
    r := r || 'I ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ nothing else moved: the rights checks of the earlier suites ================================================
  begin
    if to_regprocedure('pg_temp.rights_count_extra()') is null then
      r := r || 'P0 info: the rights helper was not run before the migrations, so the rights comparison is skipped' || E'\n';
    else
      r := r || format('P1 %s with all the migrations: tables with an extra right (empty, references, trigger, maintain) for signed-out or signed-in = %s (want 0); trigger functions open to them = %s (want 0); select/insert/update/delete on every other table unchanged=%s; execute rights on every other function unchanged=%s',
        case when pg_temp.rights_count_extra() = 0 and pg_temp.rights_count_trigger_exec() = 0 and pg_temp.rights_hash_dml() = current_setting('test.dml_before') and pg_temp.rights_hash_exec() = current_setting('test.exec_before') then 'ok' else 'FAIL' end,
        pg_temp.rights_count_extra(), pg_temp.rights_count_trigger_exec(), pg_temp.rights_hash_dml() = current_setting('test.dml_before'), pg_temp.rights_hash_exec() = current_setting('test.exec_before')) || E'\n';
    end if;
  exception when others then
    r := r || 'P ERROR ' || left(sqlerrm, 150) || E'\n';
  end;

  -- ============ the report: this suite's lines, then the earlier suites' ====================================================
  old_report := coalesce(current_setting('test.report', true), '');
  select count(*) filter (where l ~ 'FAIL' or l ~ 'ERROR'), count(*) into nfail, nlines from regexp_split_to_table(r, E'\n') as x(l) where l <> '';
  select string_agg(case when l ~ 'FAIL' or l ~ 'ERROR' then left(l, 330) else left(l, 90) end, E'\n' order by o) into rep
    from regexp_split_to_table(r, E'\n') with ordinality as x(l, o) where l <> '';
  if old_report = '' then
    rep := format(E'CLOSE-ACCOUNT TEST (rolled back): %s FAIL/ERROR line(s) in %s lines\n%s', nfail, nlines, rep);
  else
    select count(*) filter (where l ~ '^\S+ (FAIL|ERROR)') into ntot from regexp_split_to_table(old_report, E'\n') as x(l);
    rep := format(E'CLOSE-ACCOUNT TEST (rolled back): this suite %s FAIL/ERROR in %s lines; the earlier suites'' lines flagged FAIL/ERROR = %s (want 0); their headline: %s\n%s\n--- earlier suites, first 60 characters of each line ---\n%s',
      nfail, nlines, ntot, left(split_part(old_report, E'\n', 1), 160), rep,
      (select string_agg(left(l, 60), E'\n' order by o) from regexp_split_to_table(old_report, E'\n') with ordinality as x(l, o) where l <> ''));
  end if;
  if coalesce(current_setting('test.runner', true), '') = 'on' then
    perform set_config('test.report', rep, true);
  else
    raise exception E'%', rep;
  end if;
end $$;
