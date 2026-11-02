-- Rolled-back test of FREE SESSIONS mode (CEO, 2 Nov 2026; migration 20261102100000). See README.md.
-- Run it TOGETHER with the migration in one statement (scripts/run-rolled-back-test.mjs <out> this-file the-migration) before the migration is
-- applied, or on its own after. Every line ends "ok" or "FAIL (want ...)"; the first line gives the count.
-- All fixtures use the subject "Zorology" so the real tutors on dev cannot change a count or an inbox.
-- Time is not faked: requests are made for Mondays to Thursdays one to two weeks ahead; "a session that has ended" is made by moving its start back.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  v_l uuid := gen_random_uuid();   -- an adult learner
  v_o uuid := gen_random_uuid();   -- another learner (a stranger to the first)
  v_t uuid := gen_random_uuid();   -- a verified tutor, level 1A, police clearance, approved for Zorology, free every day
  v_u uuid := gen_random_uuid();   -- a tutor who is NOT verified
  c_caps uuid; s1 uuid; e_l uuid;
  mon date := (date_trunc('week', now() at time zone 'Africa/Johannesburg') + interval '14 days')::date;
  t_q1 timestamptz; t_q3 timestamptz; t_q4 timestamptz; t_q5 timestamptz; t_q6 timestamptz; t_q7 timestamptz; t_pd timestamptz; t_q2 timestamptz;
  q1 uuid; q2 uuid; q3 uuid; q4 uuid; q5 uuid; q6 uuid; q7 uuid; qp uuid;
  s_1 uuid; s_3 uuid; s_4 uuid; s_5 uuid; s_p uuid;
  n int; n2 int; hrs numeric; t text; ss record;
  nfail int; nlines int; rep text;
begin
  begin   -- everything below; an unexpected error is reported with the lines before it instead of hiding them

  execute $mk$
    create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
      select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
             || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
    $f$ $mk$;
  -- run one statement (returning one value) as a signed-in user, or as a signed-out visitor when the id is null; an error comes back as its message
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
  -- the live accept (what the Worker calls), as the server's role
  execute $mk$
    create function pg_temp.try_claim(p_q uuid, p_u uuid) returns text language plpgsql as $f$
    declare j jsonb;
    begin
      set local role service_role;
      begin
        select public.claim_session_request(p_q, p_u) into j;
        reset role;
        return 'accepted (' || (j->>'mode') || ')';
      exception when others then
        reset role;
        return sqlerrm;
      end;
    end $f$ $mk$;
  execute $mk$
    create function pg_temp.inbox(p_q uuid, p_tutor uuid) returns int language plpgsql as $f$
    declare n int;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', p_tutor, 'role', 'authenticated')::text, true);
      set local role authenticated;
      select count(*) into n from public.available_requests_for_tutor() where id = p_q;
      reset role;
      return n;
    end $f$ $mk$;

  t_q1 := (mon + time '10:00') at time zone 'Africa/Johannesburg';
  t_q2 := (mon + time '13:00') at time zone 'Africa/Johannesburg';
  t_q3 := (mon + 1 + time '10:00') at time zone 'Africa/Johannesburg';
  t_q4 := (mon + 1 + time '13:00') at time zone 'Africa/Johannesburg';
  t_q5 := (mon + 2 + time '10:00') at time zone 'Africa/Johannesburg';
  t_q6 := (mon + 2 + time '13:00') at time zone 'Africa/Johannesburg';
  t_q7 := (mon + 3 + time '10:00') at time zone 'Africa/Johannesburg';
  t_pd := (mon + 3 + time '13:00') at time zone 'Africa/Johannesburg';
  select id into c_caps from curricula where code = 'CAPS';

  -- ---- people, school, subject, hours -------------------------------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_l, z,'authenticated','authenticated','f.l.'||v_l||'@example.invalid', jsonb_build_object('role','student','first_name','Lee','date_of_birth',adult), '{}'),
    (v_o, z,'authenticated','authenticated','f.o.'||v_o||'@example.invalid', jsonb_build_object('role','student','first_name','Otto','date_of_birth',adult), '{}'),
    (v_t, z,'authenticated','authenticated','f.t.'||v_t||'@example.invalid', jsonb_build_object('role','tutor','first_name','Tess','date_of_birth',adult), '{}'),
    (v_u, z,'authenticated','authenticated','f.u.'||v_u||'@example.invalid', jsonb_build_object('role','tutor','first_name','Uma','date_of_birth',adult), '{}');
  update profiles set date_of_birth = adult::date where id in (v_l, v_o, v_t, v_u);
  update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null, is_verified = true where id in (v_t, v_u);
  update tutor_profiles set is_verified = false where id = v_u;
  insert into tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
    select x, 'police_clearance'::public.doc_type, 'fixture/police-' || x, 'verified'::public.verification_status, (now() at time zone 'Africa/Johannesburg')::date
    from unnest(array[v_t, v_u]) x;
  insert into schools_institutions (name, curriculum, curriculum_id) values ('ZZ Free test school', 'caps', c_caps) returning id into s1;
  insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status) values
    (v_t, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified'),
    (v_u, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified');
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time)
    select x, d, '00:00', '24:00' from unnest(array[v_t, v_u]) x, generate_series(0, 6) d;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_l, 'Zorology', 'Grade 10') returning id into e_l;

  perform set_config('request.jwt.claims', '', true);
  -- eight requests, all made as the owner in the state a new request starts in ('initiated'), except the legacy paid one
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, t_q1, 1, 'pending', 'initiated', 'fs_q1', '1A', 1, 50, s1) returning id into q1;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, t_q2, 1, 'pending', 'initiated', 'fs_q2', '1A', 1, 50, s1) returning id into q2;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, t_q3, 1, 'pending', 'initiated', 'fs_q3', '1A', 1, 50, s1) returning id into q3;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, t_q4, 1, 'pending', 'initiated', 'fs_q4', '1A', 1, 50, s1) returning id into q4;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, t_q5, 1, 'pending', 'initiated', 'fs_q5', '1A', 1, 50, s1) returning id into q5;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, t_q6, 1, 'pending', 'initiated', 'fs_q6', '1A', 1, 50, s1) returning id into q6;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, t_q7, 1, 'pending', 'initiated', 'fs_q7', '1A', 1, 50, s1) returning id into q7;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, t_pd, 1, 'pending', 'paid', 'fs_paid', '1A', 1, 50, s1) returning id into qp;

  -- ---- the switch is OFF by default ----------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('F1', 'the setting exists and is false by default', (select setting_value::text from system_settings where setting_key = 'free_sessions_enabled'), 'false');
  r := r || pg_temp.chk('F2', 'free_sessions_open() is false, for a signed-in learner and for a signed-out visitor',
    pg_temp.run_as(v_l, 'select public.free_sessions_open()::text') || ' / ' || pg_temp.run_as(null, 'select public.free_sessions_open()::text'), 'false / false');
  r := r || pg_temp.chk('F3', 'with the switch off a learner cannot send a request without a card', pg_temp.run_as(v_l, format('select public.send_request_free(%L)', q1)), 'ERR: Free sessions are not open.');
  select payment_status || ' ' || free_session into t from session_requests where id = q1;
  r := r || pg_temp.chk('F4', 'and the request stays exactly as it was', t, 'initiated false');
  r := r || pg_temp.chk('F5', 'the request is invisible to a tutor (not sent)', pg_temp.inbox(q1, v_t)::text, '0');

  -- ---- the switch ON -------------------------------------------------------------------------------------------------------------------
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'free_sessions_enabled';
  r := r || pg_temp.chk('F6', 'true: open for a learner and for a visitor', pg_temp.run_as(v_l, 'select public.free_sessions_open()::text') || ' / ' || pg_temp.run_as(null, 'select public.free_sessions_open()::text'), 'true / true');
  update system_settings set setting_value = '"maybe"'::jsonb where setting_key = 'free_sessions_enabled';
  r := r || pg_temp.chk('F7', 'an odd value ("maybe") counts as off', pg_temp.run_as(v_l, 'select public.free_sessions_open()::text'), 'false');
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'free_sessions_enabled';

  r := r || pg_temp.chk('F8', 'a stranger cannot send someone else''s request', pg_temp.run_as(v_o, format('select public.send_request_free(%L)', q1)), 'ERR: That request is not yours, or does not exist.');
  r := r || pg_temp.chk('F9', 'a signed-out visitor cannot call it at all', substr(pg_temp.run_as(null, format('select public.send_request_free(%L)', q1)), 1, 36), 'ERR: permission denied for function ');
  r := r || pg_temp.chk('F10', 'the tutor still sees nothing before it is sent', pg_temp.inbox(q1, v_t)::text, '0');

  r := r || pg_temp.chk('F11', 'the learner sends it: answer "free"', pg_temp.run_as(v_l, format('select public.send_request_free(%L)', q1)), 'free');
  select payment_status || ' ' || free_session || ' ' || coalesce(payment_card_id::text, 'no card') into t from session_requests where id = q1;
  r := r || pg_temp.chk('F12', 'it is now a verified request with the flag and no card', t, 'card_verified true no card');
  r := r || pg_temp.chk('F13', 'a second send changes nothing and still answers "free"', pg_temp.run_as(v_l, format('select public.send_request_free(%L)', q1)), 'free');
  r := r || pg_temp.chk('F14', 'now the verified tutor sees it in their requests, like any other', pg_temp.inbox(q1, v_t)::text, '1');
  r := r || pg_temp.chk('F15', 'which requests are free: only the one that was sent free', pg_temp.run_as(v_t, format('select count(*)::text from public.free_request_ids(array[%L::uuid, %L::uuid])', q1, q2)), '1');
  r := r || pg_temp.chk('F16', 'a request that was not sent free is not flagged', (select free_session::text from session_requests where id = q2), 'false');

  -- ---- accepting -----------------------------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('F17', 'an unverified tutor still cannot accept it', pg_temp.try_claim(q1, v_u), 'Tutorlage has to verify your tutor profile before you can accept requests');
  r := r || pg_temp.chk('F18', 'the verified tutor accepts: booked with no charge and no bank account', pg_temp.try_claim(q1, v_t), 'accepted (already_paid)');
  select s.id, s.free_session, s.gross_amount, s.tutor_payout_amount, s.platform_commission_pct, s.status, s.tutor_id, s.duration_hours into ss
    from sessions s join session_requests q on q.resulting_session_id = s.id where q.id = q1;
  s_1 := ss.id;
  r := r || pg_temp.chk('F19', 'the session is flagged free, money is stored as 0, it is scheduled for the right tutor', ss.free_session || ' ' || ss.gross_amount || ' ' || ss.tutor_payout_amount || ' ' || ss.platform_commission_pct || ' ' || ss.status || ' ' || (ss.tutor_id = v_t), 'true 0.00 0.00 0.00 scheduled true');
  select payment_status || ' ' || status || ' ' || coalesce(commission_amount::text, 'null') || ' ' || (tutor_id = v_t) into t from session_requests where id = q1;
  r := r || pg_temp.chk('F20', 'the request ends as "free", accepted, no commission', t, 'free accepted 0.00 true');
  select count(*) into n from notifications where profile_id = v_l and type = 'request_accepted' and related_session_id = s_1 and body ilike '%free session%not be charged%';
  r := r || pg_temp.chk('F21', 'the learner is told it is a free session and they will not be charged', n::text, '1');
  r := r || pg_temp.chk('F22', 'which sessions are free: that one', pg_temp.run_as(v_l, format('select count(*)::text from public.free_session_ids(array[%L::uuid])', s_1)), '1');
  r := r || pg_temp.chk('F23', 'a second accept is refused as for any request already taken', pg_temp.try_claim(q1, v_t), 'Another tutor already accepted this request, or it is no longer available.');
  r := r || pg_temp.chk('F24', 'nobody can call the private booking function directly', substr(pg_temp.run_as(v_t, format('select public.create_free_session(%L, %L)::text', q2, v_t)), 1, 36), 'ERR: permission denied for function ');

  -- ---- cancelling: nothing to refund ----------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('F25', 'the learner cancels the free session: no error, no refund text', pg_temp.run_as(v_l, format('select (select 1 from (select public.cancel_session(%L, ''test'')) x)::text', s_1)), '1');
  select s.status::text || ' ' || q.status || ' ' || q.payment_status || ' ' || coalesce(q.refund_request_id::text, 'no refund') into t
    from sessions s join session_requests q on q.resulting_session_id = s.id where s.id = s_1;
  r := r || pg_temp.chk('F26', 'session cancelled by the learner, request cancelled, still "free", no refund started', t, 'cancelled_by_student cancelled free no refund');
  select count(*) into n from notifications where profile_id = v_t and type = 'session_cancelled' and related_session_id = s_1 and body = 'The learner cancelled the session. Reason: test';
  r := r || pg_temp.chk('F27', 'the tutor is told', n::text, '1');

  -- a second free session, cancelled by the tutor
  perform pg_temp.run_as(v_l, format('select public.send_request_free(%L)', q3));
  r := r || pg_temp.chk('F28', 'another free request is accepted', pg_temp.try_claim(q3, v_t), 'accepted (already_paid)');
  select resulting_session_id into s_3 from session_requests where id = q3;
  r := r || pg_temp.chk('F29', 'the tutor cancels it', pg_temp.run_as(v_t, format('select (select 1 from (select public.cancel_session(%L, null)) x)::text', s_3)), '1');
  select count(*) into n from notifications where profile_id = v_l and type = 'session_cancelled' and related_session_id = s_3 and body like '%free session, so there is nothing to refund%';
  r := r || pg_temp.chk('F30', 'the learner is told there is nothing to refund', n::text, '1');

  -- an account closure cancels a free session quietly
  perform pg_temp.run_as(v_l, format('select public.send_request_free(%L)', q4));
  perform pg_temp.try_claim(q4, v_t);
  select resulting_session_id into s_4 from session_requests where id = q4;
  select count(*) into n from notifications where type = 'closure_session_unpaid';
  t := public.closure_cancel_session(s_4, false);
  select count(*) into n2 from notifications where type = 'closure_session_unpaid';
  r := r || pg_temp.chk('F31', 'closure cancels a free session: answer "cancelled" and no admin alert about nothing to refund', t || ' ' || (n2 - n), 'cancelled 0');
  select status || ' ' || payment_status into t from session_requests where id = q4;
  r := r || pg_temp.chk('F32', 'the request is cancelled and stays "free"', t, 'cancelled free');

  -- ---- completing: a free session counts as a session for the tutor's level ---------------------------------------------------------------
  perform pg_temp.run_as(v_l, format('select public.send_request_free(%L)', q5));
  perform pg_temp.try_claim(q5, v_t);
  select resulting_session_id into s_5 from session_requests where id = q5;
  update sessions set scheduled_start = now() - interval '3 hours' where id = s_5;
  r := r || pg_temp.chk('F33', 'the tutor marks the free session complete once it has ended', pg_temp.run_as(v_t, format('select (select 1 from (select public.complete_session(%L)) x)::text', s_5)), '1');
  select count(*), coalesce(sum(duration_hours), 0) into n, hrs from sessions where tutor_id = v_t and status = 'completed';
  r := r || pg_temp.chk('F34', 'it is counted: one completed session, one hour (the level function reads exactly this)', n || ' ' || hrs, '1 1.00');
  r := r || pg_temp.chk('F35', 'the level recalculation runs on it without error', coalesce((select 'ok'::text from (select public.fn_recalculate_tutor_tier(v_t)) x), 'null'), 'ok');
  select coalesce(sum(gross_amount), 0) + coalesce(sum(tutor_payout_amount), 0) into n from sessions where tutor_id = v_t and free_session;
  r := r || pg_temp.chk('F36', 'every free session of this tutor adds up to 0 money in any earnings sum', n::text, '0');

  -- ---- the old paid path is untouched ---------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('F37', 'a request paid up front is still accepted the old way', pg_temp.try_claim(qp, v_t), 'accepted (already_paid)');
  select s.free_session || ' ' || (s.gross_amount > 0) || ' ' || (q.payment_status) into t from sessions s join session_requests q on q.resulting_session_id = s.id where q.id = qp;
  s_p := (select resulting_session_id from session_requests where id = qp);
  r := r || pg_temp.chk('F38', 'it is NOT flagged free, still carries its money, and stays "paid"', t, 'false true paid');

  -- the tutor cancels the PAID session: the old path must get as far as the refund step (it either starts one, or says refunds are not set up here)
  r := r || pg_temp.chk('F45', 'the paid session is cancelled the old way, reaching the refund step', case when pg_temp.run_as(v_t, format('select (select 1 from (select public.cancel_session(%L, null)) x)::text', s_p)) in ('1', 'ERR: Refunds aren''t set up on this server yet — contact support') then 'refund step' else 'other' end, 'refund step');

  -- ---- the flag cannot be set from outside --------------------------------------------------------------------------------------------------
  execute 'create table public.zz_free_probe (free_session boolean not null default false)';
  execute 'alter table public.zz_free_probe disable row level security';
  execute 'grant all on public.zz_free_probe to authenticated, anon';
  execute 'create trigger t_gf before insert on public.zz_free_probe for each row execute function public.guard_free_flag()';
  r := r || pg_temp.chk('F39', 'a signed-in user inserting free_session = true gets false', pg_temp.run_as(v_l, 'with i as (insert into public.zz_free_probe values (true) returning free_session) select free_session::text from i'), 'false');
  insert into public.zz_free_probe values (true);
  r := r || pg_temp.chk('F40', 'the server (owner) can set it', (select count(*)::text from public.zz_free_probe where free_session), '1');
  select count(*) into n from pg_trigger where tgrelid = 'public.session_requests'::regclass and tgname = 'guard_free_flag' and not tgisinternal;
  r := r || pg_temp.chk('F41', 'the real table has that guard', n::text, '1');
  begin
    update session_requests set payment_status = 'bogus' where id = q7;
    t := 'accepted a bogus status';
  exception when check_violation then t := 'refused';
  end;
  update session_requests set payment_status = 'free' where id = q7;          -- the new value is accepted
  update session_requests set payment_status = 'initiated' where id = q7;     -- and the old one is still accepted
  r := r || pg_temp.chk('F42', 'the payment_status list refuses an unknown value, accepts "free" and still accepts the old values', t, 'refused');

  -- ---- turning the switch off does not strand a request that was already sent --------------------------------------------------------------
  perform pg_temp.run_as(v_l, format('select public.send_request_free(%L)', q6));
  update system_settings set setting_value = 'false'::jsonb where setting_key = 'free_sessions_enabled';
  r := r || pg_temp.chk('F43', 'switch off: a new request cannot be sent free any more', pg_temp.run_as(v_l, format('select public.send_request_free(%L)', q7)), 'ERR: Free sessions are not open.');
  r := r || pg_temp.chk('F44', 'switch off: a request already sent free can still be accepted', pg_temp.try_claim(q6, v_t), 'accepted (already_paid)');

  exception when others then
    r := r || format('STOPPED EARLY by an unexpected error: %s', sqlerrm) || E'\n';
  end;

  -- The Supabase tool cuts the middle of a long error, so each report line is shortened to its id and its value (the part after the
  -- first ": "; a FAIL or STOPPED line stays whole). The FAIL count counts whole lines.
  select count(*) filter (where l like '%FAIL%' or l like 'STOPPED%'), count(*) filter (where l <> '')
    into nfail, nlines from regexp_split_to_table(r, E'\n') as l;
  select string_agg(case when l like '%FAIL%' or l like 'STOPPED%' then l else regexp_replace(l, '^(\S+) [^:]*: ', E'\\1 ') end, E'\n' order by o)
    into rep from regexp_split_to_table(r, E'\n') with ordinality as x(l, o) where l <> '';
  if coalesce(current_setting('test.runner', true), '') = 'on' then
    perform set_config('test.report', format(E'FREE-SESSIONS TEST (rolled back): %s FAIL line(s) in %s lines\n%s', nfail, nlines, rep), true);
  else
    raise exception E'FREE-SESSIONS TEST (rolled back): % FAIL line(s) in % lines\n%', nfail, nlines, rep;
  end if;
end $$;
