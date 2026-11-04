-- Rolled-back test of migrations 20261104100000_parent_sets_learner_institution.sql and 20261104100100_cancel_any_time_before_start.sql (4 Nov 2026).
-- Needs the wallet booking migrations already on the database. Run the two migrations together with this file in one rolled-back statement (migrations first):
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/cancel_any_time.sql supabase/migrations/20261104100000_parent_sets_learner_institution.sql supabase/migrations/20261104100100_cancel_any_time_before_start.sql
-- Fixtures are made-up people (example.invalid), a made-up school and the subject "Zorology". Every line ends "ok" or "FAIL (want ...)".
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  minor text := (current_date - interval '10 years')::date::text;
  v_p uuid := gen_random_uuid();   -- a parent
  v_m uuid := gen_random_uuid();   -- the parent's child, under 18
  v_o uuid := gen_random_uuid();   -- a stranger
  v_t uuid := gen_random_uuid();   -- a verified tutor, level 1A, approved for Zorology, free every day
  c_caps uuid; s1 uuid; e_m uuid; qa uuid; qb uuid; qc uuid; qd uuid; s_b uuid; s_d uuid;
  t text; t2 text; nfail int; nlines int;
begin
  begin
  execute $mk$
    create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
      select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
             || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
    $f$ $mk$;
  execute $mk$
    create function pg_temp.run_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
    declare v text;
    begin
      if p_u is null then
        perform set_config('request.jwt.claims', '', true);
        set local role anon;
      else
        perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true);
        set local role authenticated;
      end if;
      begin
        execute p_sql into v;
        reset role;
        return coalesce(v, 'null');
      exception when others then
        reset role;
        return 'ERR: ' || sqlerrm;
      end;
    end $f$ $mk$;
  execute $mk$
    create function pg_temp.try_claim(p_q uuid, p_u uuid) returns text language plpgsql as $f$
    declare j jsonb;
    begin
      set local role service_role;
      begin
        select public.claim_session_request(p_q, p_u) into j;
        reset role;
        return 'accepted';
      exception when others then
        reset role;
        return sqlerrm;
      end;
    end $f$ $mk$;
  execute $mk$
    create function pg_temp.slot(n int) returns timestamptz language sql as $f$
      select ((date_trunc('week', now() at time zone 'Africa/Johannesburg') + interval '14 days')::date + (n / 6) + time '08:00' + (n % 6) * interval '2 hours') at time zone 'Africa/Johannesburg' $f$ $mk$;
  execute $mk$
    create function pg_temp.mkreq(p_by uuid, p_stu uuid, p_enr uuid, p_slot int, p_price numeric, p_addr uuid default null) returns uuid language plpgsql as $f$
    declare v uuid;
    begin
      insert into public.session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference,
             min_sub_tier_id, tier_id, charged_amount, institution_id, requested_tutor_id, expires_at, currency_code)
      values (p_stu, p_enr, p_by, pg_temp.slot(p_slot), 1, 'pending', 'initiated', 'ca_' || gen_random_uuid(), '1A', 1, p_price,
              (select id from public.schools_institutions where name = 'ZZ Cancel test school'), p_addr,
              case when p_addr is null then null else now() + interval '48 hours' end, 'ZAR')
      returning id into v;
      return v;
    end $f$ $mk$;
  execute $mk$
    create function pg_temp.send(p_u uuid, p_q uuid) returns text language sql as $f$
      select pg_temp.run_as(p_u, format('select concat_ws(''/'', x->>''held_rand'', x->>''available_rand'', x->>''already'') from (select public.send_request_wallet(%L) as x) s', p_q)) $f$ $mk$;
  execute $mk$ create function pg_temp.wb(p uuid) returns text language sql as $f$
      select coalesce((select available_rand || '/' || held_rand from public.wallets where profile_id = p), '0/0') $f$ $mk$;
  execute $mk$ create function pg_temp.nl(p_key text) returns int language sql as $f$
      select count(*)::int from public.wallet_ledger where idempotency_key = p_key $f$ $mk$;
  execute $mk$ create function pg_temp.nn(p_profile uuid, p_type text, p_like text) returns int language sql as $f$
      select count(*)::int from public.notifications where profile_id = p_profile and type = p_type and body like p_like $f$ $mk$;
  execute $mk$ create function pg_temp.cancel_req(p_u uuid, p_q uuid) returns text language sql as $f$
      select pg_temp.run_as(p_u, format('select (select 1 from (select public.cancel_waiting_request(%L)) x)::text', p_q)) $f$ $mk$;
  execute $mk$ create function pg_temp.cancel_ses(p_u uuid, p_s uuid) returns text language sql as $f$
      select pg_temp.run_as(p_u, format('select (select 1 from (select public.cancel_session(%L, null)) x)::text', p_s)) $f$ $mk$;

  -- ---- people, school, subject, hours -------------------------------------------------------------------------------------------------------
  select id into c_caps from curricula where code = 'CAPS';
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_p, z, 'authenticated', 'authenticated', 'c.p.' || v_p || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pat', 'date_of_birth', adult, 'phone_number', '081 234 5678'), '{}'),
    (v_o, z, 'authenticated', 'authenticated', 'c.o.' || v_o || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Otto', 'date_of_birth', adult), '{}'),
    (v_t, z, 'authenticated', 'authenticated', 'c.t.' || v_t || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tess', 'date_of_birth', adult), '{}');
  update profiles set date_of_birth = adult::date where id in (v_p, v_o, v_t);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_m, z, 'authenticated', 'authenticated', 'c.m.' || v_m || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Mia', 'date_of_birth', minor),
     jsonb_build_object('created_by_guardian', v_p, 'relationship', 'mother'));
  update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null, is_verified = true where id = v_t;
  insert into tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
    values (v_t, 'police_clearance'::public.doc_type, 'fixture/police-' || v_t, 'verified'::public.verification_status, (now() at time zone 'Africa/Johannesburg')::date);
  insert into schools_institutions (name, curriculum, curriculum_id) values ('ZZ Cancel test school', 'caps', c_caps) returning id into s1;
  insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
    values (v_t, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified');
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) select v_t, d, '00:00', '24:00' from generate_series(0, 6) d;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_m, 'Zorology', 'Grade 10') returning id into e_m;
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'wallet_payments_enabled';
  update system_settings set setting_value = 'false'::jsonb where setting_key = 'free_sessions_enabled';
  r := r || 'S0 setup: a parent and her child, a stranger, a verified tutor, a made-up school and subject' || E'\n';

  -- ---- the parent saves the child's institution ---------------------------------------------------------------------------------------------
  select school_id::text into t from student_profiles where id = v_m;
  r := r || pg_temp.chk('I0', 'the child starts with no institution', t, null);
  t := pg_temp.run_as(v_p, format('select public.set_learner_institution(%L, %L)::text', v_m, s1));
  select school_id::text into t2 from student_profiles where id = v_m;
  r := r || pg_temp.chk('I1', 'the parent saves it: returned and stored', (t = s1::text)::text || ' ' || (t2 = s1::text)::text, 'true true');
  r := r || pg_temp.chk('I2', 'a stranger cannot', (pg_temp.run_as(v_o, format('select public.set_learner_institution(%L, %L)::text', v_m, s1)) like 'ERR: Only the person who looks after this learner%')::text, 'true');
  r := r || pg_temp.chk('I3', 'an unknown institution is refused', pg_temp.run_as(v_p, format('select public.set_learner_institution(%L, %L)::text', v_m, gen_random_uuid())), 'ERR: Choose an institution from the list');
  r := r || pg_temp.chk('I4', 'signed out is refused', (pg_temp.run_as(null, format('select public.set_learner_institution(%L, %L)::text', v_m, s1)) like 'ERR: permission denied for function%')::text, 'true');
  select school_id::text into t2 from student_profiles where id = v_m;
  r := r || pg_temp.chk('I5', 'and the stored institution did not move', (t2 = s1::text)::text, 'true');

  -- ---- cancelling a request that is still waiting for a tutor -------------------------------------------------------------------------------
  perform public.wallet_post(v_p, 'topup', 500, 0, 'ca-top:' || gen_random_uuid(), null, 'test top-up');
  qa := pg_temp.mkreq(v_p, v_m, e_m, 0, 180);
  r := r || pg_temp.chk('W1', 'R180 request sent from a R500 wallet: held', pg_temp.send(v_p, qa), '180/320/false');
  r := r || pg_temp.chk('W2', 'a stranger cannot cancel it', (pg_temp.cancel_req(v_o, qa) like 'ERR: Only the person who made this request%')::text, 'true');
  r := r || pg_temp.chk('W3', 'signed out cannot', (pg_temp.cancel_req(null, qa) like 'ERR: permission denied for function%')::text, 'true');
  r := r || pg_temp.chk('W4', 'the parent cancels it', pg_temp.cancel_req(v_p, qa), '1');
  select status || ' ' || payment_status into t from session_requests where id = qa;
  r := r || pg_temp.chk('W5', 'it is cancelled, and the held price is back in the wallet at once (one release line)', t || ' / ' || pg_temp.wb(v_p) || ' / ' || pg_temp.nl('release:' || qa), 'cancelled card_verified / 500/0 / 1');
  r := r || pg_temp.chk('W6', 'cancelling again is refused and moves no money', (pg_temp.cancel_req(v_p, qa) like 'ERR: This request can no longer be cancelled here.%')::text || ' / ' || pg_temp.wb(v_p), 'true / 500/0');
  qb := pg_temp.mkreq(v_p, v_m, e_m, 1, 150);
  perform pg_temp.send(v_p, qb);
  r := r || pg_temp.chk('W7', 'a tutor accepts it', pg_temp.try_claim(qb, v_t), 'accepted');
  r := r || pg_temp.chk('W8', 'a request a tutor has taken cannot be cancelled as a request', (pg_temp.cancel_req(v_p, qb) like 'ERR: This request can no longer be cancelled here.%')::text, 'true');
  qc := pg_temp.mkreq(v_p, v_m, e_m, 2, 100, v_t);
  perform pg_temp.send(v_p, qc);
  r := r || pg_temp.chk('W9', 'a request addressed to a tutor: cancelled, the held R100 is back, the tutor is told',
    pg_temp.cancel_req(v_p, qc) || ' / ' || pg_temp.wb(v_p) || ' / ' || pg_temp.nn(v_t, 'session_cancelled', '%withdrew a request%'), '1 / 350/0 / 1');

  -- ---- cancelling a session any time before it starts -----------------------------------------------------------------------------------------
  select resulting_session_id into s_b from session_requests where id = qb;
  update session_requests set charged_at = now() - interval '30 days' where id = qb;
  r := r || pg_temp.chk('C1', 'a stranger cannot cancel the session', (pg_temp.cancel_ses(v_o, s_b) like 'ERR: Only the learner, the person who booked, or the tutor can cancel this session')::text, 'true');
  r := r || pg_temp.chk('C2', 'the parent cancels 30 days after paying, before the session starts (no window)', pg_temp.cancel_ses(v_p, s_b), '1');
  select s.status::text || ' ' || q.status || ' ' || q.payment_status into t from sessions s join session_requests q on q.resulting_session_id = s.id where s.id = s_b;
  r := r || pg_temp.chk('C3', 'cancelled by the learner side, request refunded to the wallet: one refund line, the full R150 back as credit',
    t || ' / ' || pg_temp.nl('refund:' || s_b) || ' / ' || pg_temp.wb(v_p), 'cancelled_by_student cancelled wallet_refunded / 1 / 500/0');
  r := r || pg_temp.chk('C4', 'the tutor is told', pg_temp.nn(v_t, 'session_cancelled', 'The learner cancelled%')::text, '1');
  qd := pg_temp.mkreq(v_p, v_m, e_m, 3, 120);
  perform pg_temp.send(v_p, qd);
  perform pg_temp.try_claim(qd, v_t);
  select resulting_session_id into s_d from session_requests where id = qd;
  update sessions set scheduled_start = now() - interval '5 minutes' where id = s_d;
  r := r || pg_temp.chk('C5', 'once the start time has passed the cancel is refused and moves no money', (pg_temp.cancel_ses(v_p, s_d) like 'ERR: This session has already started%')::text || ' / ' || pg_temp.nl('refund:' || s_d),
    'true / 0');

  exception when others then
    r := r || 'UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'CANCEL ANY TIME TEST (rolled back): % lines, % FAIL\n%', nlines, nfail, r;
end $$;
