-- NEEDS THE RUNNER (never run alone on production). Rolled-back test of 20261125120000_addressed_fit_linked_family.sql (JOB FIT, 25 Nov 2026):
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/addressed_fit_linked.sql supabase/migrations/20261125120000_addressed_fit_linked_family.sql
-- The last line raises, so everything is undone. Made-up people and the subject "Zorology". The tutor works 10:00 to 12:00 (South African time) every day.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  minor text := (current_date - interval '10 years')::date::text;
  ta uuid := gen_random_uuid(); ln uuid := gen_random_uuid(); ls uuid := gen_random_uuid(); lr uuid := gen_random_uuid();
  pa uuid := gen_random_uuid(); ch uuid := gen_random_uuid(); ot uuid := gen_random_uuid();
  d0 date := (now() at time zone 'Africa/Johannesburg')::date;
  cid uuid; ccode text; c_caps uuid; c_ieb uuid; s_ieb uuid;
  e_ln uuid; e_low uuid; e_nos uuid; e_ls uuid; e_lr uuid; e_ch uuid;
  q text; q2 text; t text; t2 text; n int; bal int; nfail int; nlines int; rep text;
  m_time constant text := 'ERR: This tutor isn''t available at that time. Choose another time, or send the request to any available tutor.';
  m_subj constant text := 'ERR: This tutor isn''t approved for that subject, grade and curriculum. You can send the request to any available tutor.';
  m_str constant text := 'ERR: You can only ask for a tutor you have had a session with.';
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || case when p_got is not distinct from p_want then 'ok' else 'FAIL got ' || coalesce(p_got, 'null') || ' (want ' || coalesce(p_want, 'null') || ')' end || E'\n' $f$ $mk$;
    execute $mk$
      create function pg_temp.run_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
      declare v text;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true); set local role authenticated;
        begin execute p_sql into v; reset role; return coalesce(v, 'null');
        exception when others then reset role; return 'ERR: ' || sqlerrm; end;
      end $f$ $mk$;
    execute $mk$
      create function pg_temp.run_server(p_sql text) returns text language plpgsql as $f$
      declare v text;
      begin
        perform set_config('request.jwt.claims', '', true); set local role service_role;
        begin execute p_sql into v; reset role; return coalesce(v, 'null');
        exception when others then reset role; return 'ERR: ' || sqlerrm; end;
      end $f$ $mk$;
    -- the app's own insert: payer, learner, tutor asked for (or null), subject row, start, school, curriculum
    execute $mk$
      create function pg_temp.ask(p_payer uuid, p_learner uuid, p_tutor uuid, p_enr uuid, p_start timestamptz, p_school uuid default null, p_cur uuid default null) returns text language plpgsql as $f$
      begin
        return pg_temp.run_as(p_payer, format('insert into public.session_requests (student_id, requested_by_profile_id, requested_tutor_id, enrollment_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, institution_id, curriculum_id) values (%L, %L, %L, %L, %L, 1, %L, ''1A'', %L, %L) returning id::text',
          p_learner, p_payer, p_tutor, p_enr, p_start, 'zzfit_' || replace(gen_random_uuid()::text, '-', ''), p_school, p_cur));
      end $f$ $mk$;
    execute $mk$
      create function pg_temp.at_sa(p_days int, p_time text) returns timestamptz language sql as $f$
        select (((now() at time zone 'Africa/Johannesburg')::date + p_days) + p_time::time) at time zone 'Africa/Johannesburg' $f$ $mk$;

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    select x.id, z, 'authenticated', 'authenticated', 'fit.' || x.id || '@example.invalid', jsonb_build_object('role', x.role, 'first_name', x.first, 'date_of_birth', adult, 'phone_number', '081 234 5678'), '{}'
      from (values (ta, 'tutor', 'Tessa'), (ln, 'student', 'Nia'), (ls, 'student', 'Sam'), (lr, 'student', 'Ria'), (pa, 'parent', 'Pat'), (ot, 'student', 'Otto')) as x(id, role, first);
    update profiles set date_of_birth = adult::date where id in (ta, ln, ls, lr, pa, ot);
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (ch, z, 'authenticated', 'authenticated', 'fit.c.' || ch || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Cy', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', pa, 'relationship', 'mother'));
    update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null, is_verified = true where id = ta;
    insert into tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
      values (ta, 'police_clearance'::public.doc_type, 'fixture/police-' || ta, 'verified'::public.verification_status, d0);
    select id into c_caps from curricula where code = 'CAPS';
    select id into c_ieb from curricula where code = 'IEB';
    insert into schools_institutions (name, curriculum, curriculum_id) values ('ZZ Fit IEB school', 'ieb', c_ieb) returning id into s_ieb;
    insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
      values (ta, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified');
    insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) select ta, d, '10:00', '12:00' from generate_series(0, 6) d;
    insert into student_subject_enrollments (student_id, subject_name, grade_level) values (ln, 'Zorology', 'Grade 10') returning id into e_ln;
    insert into student_subject_enrollments (student_id, subject_name, grade_level) values (ln, 'Zorology', 'Grade 4') returning id into e_low;
    insert into student_subject_enrollments (student_id, subject_name, grade_level) values (ln, 'Yorology', 'Grade 10') returning id into e_nos;
    insert into student_subject_enrollments (student_id, subject_name, grade_level) values (ls, 'Zorology', 'Grade 10') returning id into e_ls;
    insert into student_subject_enrollments (student_id, subject_name, grade_level) values (lr, 'Zorology', 'Grade 10') returning id into e_lr;
    insert into student_subject_enrollments (student_id, subject_name, grade_level) values (ch, 'Zorology', 'Grade 10') returning id into e_ch;
    -- the tutor's own code on the new family and on the parent; the page on
    insert into promo_codes (code, label, percent_off, uses_per_account, active, owner_tutor_id)
      select 'ZZFIT' || substr(replace(ta::text, '-', ''), 1, 8), 'zz test', 10, 3, true, ta where not exists (select 1 from promo_codes c where c.owner_tutor_id = ta);
    select id, code into cid, ccode from promo_codes where owner_tutor_id = ta limit 1;
    update promo_codes set active = true where id = cid;
    update profiles set promo_code_id = cid, promo_code_entered = ccode, promo_attached_at = now() where id in (ln, pa);
    insert into tutor_public_profile (tutor_id, is_public) values (ta, true) on conflict (tutor_id) do update set is_public = true, withdrawn_at = null;
    perform public.wallet_post(x, 'topup', 5000, 0, 'fit-top:' || x, null, 'test top-up') from unnest(array[ln, lr, pa]) x;
    -- the returning family: one completed session, no code
    insert into sessions (student_id, tutor_id, duration_hours, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, scheduled_start, enrollment_id, booked_by_profile_id, currency_code, status)
      values (lr, ta, 1, 100, 10, 100, 90, pg_temp.at_sa(-5, '10:00'), e_lr, lr, 'ZAR', 'completed');
    -- the tutor is busy 4 days ahead at 10:00
    insert into sessions (student_id, tutor_id, duration_hours, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, scheduled_start, enrollment_id, booked_by_profile_id, currency_code, status)
      values (ot, ta, 1, 100, 10, 100, 90, pg_temp.at_sa(4, '10:00'), null, ot, 'ZAR', 'scheduled');

    -- L. the linked new family
    select available_rand into bal from wallets where profile_id = ln;
    r := r || pg_temp.chk('L1', 'linked new family, outside the working hours: refused in plain words', pg_temp.ask(ln, ln, ta, e_ln, pg_temp.at_sa(3, '15:00')), m_time);
    r := r || pg_temp.chk('L2', 'busy at that time: refused', pg_temp.ask(ln, ln, ta, e_ln, pg_temp.at_sa(4, '10:00')), m_time);
    r := r || pg_temp.chk('L3', 'grade outside the approved range: refused', pg_temp.ask(ln, ln, ta, e_low, pg_temp.at_sa(3, '10:00')), m_subj);
    r := r || pg_temp.chk('L4', 'subject not taught: refused', pg_temp.ask(ln, ln, ta, e_nos, pg_temp.at_sa(3, '10:00')), m_subj);
    r := r || pg_temp.chk('L5', 'curriculum not approved: refused', pg_temp.ask(ln, ln, ta, e_ln, pg_temp.at_sa(3, '10:00'), s_ieb, c_ieb), m_subj);
    delete from tutor_availability where tutor_id = ta and day_of_week = extract(dow from d0)::int;
    r := r || pg_temp.chk('L6', 'as soon as possible on a day the tutor does not work: refused', pg_temp.ask(ln, ln, ta, e_ln, now()), m_time);
    insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) values (ta, extract(dow from d0)::int, '10:00', '12:00');
    r := r || pg_temp.chk('L7', 'refused requests leave no row and hold no credit',
      (select count(*)::text from session_requests where requested_by_profile_id = ln) || '/' || (select (available_rand = bal)::text from wallets where profile_id = ln), '0/true');
    q := pg_temp.ask(ln, ln, ta, e_ln, pg_temp.at_sa(3, '10:00'));
    r := r || pg_temp.chk('L8', 'inside the hours: accepted', (q !~ '^ERR')::text, 'true');
    t := pg_temp.run_as(ln, format('select public.send_request_wallet(%L) ->> ''mode''', q));
    r := r || pg_temp.chk('L9', 'sent from credit', t, 'wallet');
    r := r || pg_temp.chk('L10', 'it is in the tutor''s queue, marked as asked for',
      pg_temp.run_as(ta, format('select count(*)::text from public.available_requests_for_tutor() where id = %L and sent_to_you', q)), '1');
    t := pg_temp.run_server(format('select public.claim_session_request(%L, %L) ->> ''mode''', q, ta));
    r := r || pg_temp.chk('L11', 'the tutor can accept it', (t !~ '^ERR')::text, 'true');

    -- G. something changes between making the request and sending it: nothing is held, the tutor is not told
    q := pg_temp.ask(ln, ln, ta, e_ln, pg_temp.at_sa(5, '10:00'));
    insert into sessions (student_id, tutor_id, duration_hours, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, scheduled_start, enrollment_id, booked_by_profile_id, currency_code, status)
      values (ot, ta, 1, 100, 10, 100, 90, pg_temp.at_sa(5, '10:00'), null, ot, 'ZAR', 'scheduled');
    select available_rand into bal from wallets where profile_id = ln;
    select count(*) into n from notifications where profile_id = ta and type = 'request_for_you';
    r := r || pg_temp.chk('G1', 'became busy before sending: refused', pg_temp.run_as(ln, format('select public.send_request_wallet(%L) ->> ''mode''', q)), m_time);
    r := r || pg_temp.chk('G2', 'no credit held, still unsent, no bell for the tutor',
      (select (available_rand = bal)::text from wallets where profile_id = ln) || '/' || (select payment_status || '/' || paid_from_wallet::text from session_requests where id = q::uuid)
      || '/' || ((select count(*) from notifications where profile_id = ta and type = 'request_for_you') = n)::text, 'true/initiated/false/true');
    q := pg_temp.ask(ln, ln, ta, e_ln, pg_temp.at_sa(6, '10:00'));
    update tutor_subject_competencies set verification_status = 'pending' where tutor_id = ta;
    r := r || pg_temp.chk('G3', 'subject approval gone before sending: refused', pg_temp.run_as(ln, format('select public.send_request_wallet(%L) ->> ''mode''', q)), m_subj);
    update tutor_subject_competencies set verification_status = 'verified' where tutor_id = ta;
    update tutor_availability set end_time = '10:30' where tutor_id = ta;
    r := r || pg_temp.chk('G4', 'working hours changed before sending: refused', pg_temp.run_as(ln, format('select public.send_request_wallet(%L) ->> ''mode''', q)), m_time);
    update tutor_availability set end_time = '12:00' where tutor_id = ta;

    -- C. the card path (server only) and the switched-off no-charge path (old waiting drafts cleared first: at most 3 may wait for one tutor)
    update session_requests set status = 'cancelled' where requested_by_profile_id = ln and status = 'pending';
    t := (select coalesce((select setting_value #>> '{}' from system_settings where setting_key = 'card_check_amount_cents'), '100'));
    q := pg_temp.ask(ln, ln, ta, e_ln, pg_temp.at_sa(7, '10:00'));
    q2 := (select paystack_reference from session_requests where id = q::uuid);
    update tutor_availability set end_time = '10:30' where tutor_id = ta;
    t2 := pg_temp.run_server(format('select public.record_card_verification(%L, %s, ''ZAR'', ''{"authorization_code":"AUTH_zzfit","reusable":true,"signature":"zzfit"}'', ''fit@example.invalid'')', q2, t));
    r := r || pg_temp.chk('C1', 'card check on a request that no longer fits: not sent, reason kept, no card saved',
      t2 || '/' || (select status || '/' || payment_status || '/' || charge_failure_reason from session_requests where id = q::uuid) || '/' || (select count(*)::text from payment_cards where profile_id = ln),
      'failed/cancelled/failed/' || substr(m_time, 6) || '/0');
    update tutor_availability set end_time = '12:00' where tutor_id = ta;
    q := pg_temp.ask(ln, ln, ta, e_ln, pg_temp.at_sa(8, '10:00'));
    q2 := (select paystack_reference from session_requests where id = q::uuid);
    r := r || pg_temp.chk('C2', 'card check on a request that fits: sent as before',
      pg_temp.run_server(format('select public.record_card_verification(%L, %s, ''ZAR'', ''{"authorization_code":"AUTH_zzfit","reusable":true,"signature":"zzfit"}'', ''fit@example.invalid'')', q2, t)), 'card_verified');
    update session_requests set status = 'cancelled' where requested_by_profile_id = ln and status = 'pending';
    update system_settings set setting_value = 'true'::jsonb where setting_key = 'free_sessions_enabled';
    q := pg_temp.ask(ln, ln, ta, e_ln, pg_temp.at_sa(9, '10:00'));
    update tutor_availability set end_time = '10:30' where tutor_id = ta;
    r := r || pg_temp.chk('C3', 'no-charge sending path: refused the same way', pg_temp.run_as(ln, format('select public.send_request_free(%L)', q)), m_time);
    update tutor_availability set end_time = '12:00' where tutor_id = ta;
    r := r || pg_temp.chk('C4', 'no-charge sending path: a fitting request still goes', (pg_temp.run_as(ln, format('select public.send_request_free(%L)', q)) !~ '^ERR')::text, 'true');
    update system_settings set setting_value = 'false'::jsonb where setting_key = 'free_sessions_enabled';
    t := pg_temp.run_as(ln, format('select public.resend_request_to_anyone(%L)::text', q));
    select coalesce(requested_tutor_id::text, 'none') into t2 from session_requests where id = q::uuid;  -- read in its own statement, after the call
    r := r || pg_temp.chk('C5', 'one tap to any available tutor: the waiting request is no longer addressed', t || '/' || t2, q || '/none');

    -- P. a parent who carries the code, booking for a child
    r := r || pg_temp.chk('P1', 'parent from the link, outside the hours: refused', pg_temp.ask(pa, ch, ta, e_ch, pg_temp.at_sa(3, '15:00')), m_time);
    q := pg_temp.ask(pa, ch, ta, e_ch, pg_temp.at_sa(10, '10:00'));
    r := r || pg_temp.chk('P2', 'parent from the link, inside the hours: sent and in the queue',
      pg_temp.run_as(pa, format('select public.send_request_wallet(%L) ->> ''mode''', q)) || '/' || pg_temp.run_as(ta, format('select count(*)::text from public.available_requests_for_tutor() where id = %L and sent_to_you', q)), 'wallet/1');

    -- S. since 25 Nov 2026 (JOB LINK) a learner with no code gets the same fit check while the tutor's page is on; with the page off, a stranger learns nothing (S6)
    r := r || pg_temp.chk('S1', 'no code, outside the hours: refused by the fit check', pg_temp.ask(ls, ls, ta, e_ls, pg_temp.at_sa(3, '15:00')), m_time);
    r := r || pg_temp.chk('S2', 'no code, inside the hours: accepted', (pg_temp.ask(ls, ls, ta, e_ls, pg_temp.at_sa(3, '10:00')) !~ '^ERR')::text, 'true');
    r := r || pg_temp.chk('S3', 'no code, calling the check directly: the same answer',
      pg_temp.run_as(ls, format('select public.addressed_fit_problem(%L, %L, %L, %L, null, null, %L, 1)', ls, ls, ta, e_ls, pg_temp.at_sa(3, '15:00'))), substr(m_time, 6));
    r := r || pg_temp.chk('S4', 'nobody can use the check in the name of the linked family',
      pg_temp.run_as(ls, format('select public.addressed_fit_problem(%L, %L, %L, %L, null, null, %L, 1)', ln, ln, ta, e_ln, pg_temp.at_sa(3, '15:00'))), 'null');
    r := r || pg_temp.chk('S5', 'the new send check is closed to the app',
      has_function_privilege('authenticated', 'public.addressed_send_problem(uuid)', 'execute')::text || '/' || has_function_privilege('anon', 'public.addressed_send_problem(uuid)', 'execute')::text, 'false/false');
    update tutor_public_profile set is_public = false where tutor_id = ta;
    r := r || pg_temp.chk('S6', 'page switched off: the linked family is a stranger again', pg_temp.ask(ln, ln, ta, e_ln, pg_temp.at_sa(3, '15:00')), m_str);
    update tutor_public_profile set is_public = true where tutor_id = ta;

    -- R. the returning family and the ordinary request are as before
    r := r || pg_temp.chk('R1', 'returning family, outside the hours: refused', pg_temp.ask(lr, lr, ta, e_lr, pg_temp.at_sa(3, '15:00')), m_time);
    q := pg_temp.ask(lr, lr, ta, e_lr, pg_temp.at_sa(11, '11:00'));
    r := r || pg_temp.chk('R2', 'returning family, inside the hours: sent and in the queue',
      pg_temp.run_as(lr, format('select public.send_request_wallet(%L) ->> ''mode''', q)) || '/' || pg_temp.run_as(ta, format('select count(*)::text from public.available_requests_for_tutor() where id = %L and sent_to_you', q)), 'wallet/1');
    q := pg_temp.ask(ls, ls, null, e_ls, pg_temp.at_sa(3, '15:00'));
    r := r || pg_temp.chk('R3', 'a request to any available tutor outside these hours is still accepted', (q !~ '^ERR')::text, 'true');

    -- H. the working hours beside "Booking with"
    -- the parent: the code is attached and no lesson has been accepted yet (after a first lesson the answer is nothing, as before)
    t := pg_temp.run_as(pa, 'select public.my_linked_tutor()::text');
    r := r || pg_temp.chk('H2', 'after a first accepted lesson there is no linked tutor, as before', pg_temp.run_as(ln, 'select coalesce(public.my_linked_tutor()::text, ''null'')'), 'null');
    r := r || pg_temp.chk('H1', 'the linked tutor answer: id, first name, hours in words, nothing else',
      ((t::jsonb ->> 'first_name') = 'Tessa' and (t::jsonb ->> 'hours') like 'Every day, %' and (t::jsonb ? 'code') and (select count(*) from jsonb_object_keys(t::jsonb)) = 4)::text, 'true');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%: FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  rep := format(E'JOB FIT: %s lines, %s FAIL/ABORT\n%s', nlines, nfail, r);
  perform set_config('test.report', rep, true);
  if current_setting('test.runner', true) is distinct from 'on' then raise exception '%', rep; end if;
end $$;
