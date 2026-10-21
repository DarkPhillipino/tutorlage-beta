-- Rolled-back test of curriculum approval and calendar matching (CEO, 19 Oct 2026; migration 20261019090000). See README.md.
-- Run it TOGETHER with the migration in one statement (scripts/run-rolled-back-test.mjs) before the migration is applied,
-- or on its own after. Every check prints its result; "FAIL" marks a real problem.
-- All fixtures use the subject "Zorology" so the real tutors on dev cannot change a count.
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  auth_ok jsonb := '{"authorization_code":"AUTH_cam123","reusable":true,"signature":"SIG_cam","last4":"4081","card_type":"visa ","bank":"TEST BANK","exp_month":"12","exp_year":"2030"}';
  v_l uuid := gen_random_uuid();       -- an adult learner
  v_a uuid := gen_random_uuid();       -- tutor A: CAPS, approved, Mondays 09:00-12:00 and 12:00-15:00 (two touching blocks)
  v_b uuid := gen_random_uuid();       -- tutor B: IEB, approved, every day all day
  v_d uuid := gen_random_uuid();       -- tutor D: CAPS, NOT yet approved
  v_n uuid := gen_random_uuid();       -- tutor N: CAPS, approved, no working hours at all
  v_e uuid := gen_random_uuid();       -- tutor E: CAPS, approved for Grade 8 to 9 only, every day all day
  v_t uuid := gen_random_uuid();       -- tutor T: tertiary, pending (for the waiting list)
  v_admin uuid := gen_random_uuid();
  c_caps uuid; c_ieb uuid; c_pcaps uuid; c_tert uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; s5 uuid;     -- CAPS, IEB, primary CAPS, CAPS+IEB, tertiary
  e_l uuid;
  mon date := (date_trunc('week', now() at time zone 'Africa/Johannesburg') + interval '14 days')::date;   -- a Monday, 1 to 2 weeks ahead
  t10 timestamptz; t1030 timestamptz; t11 timestamptz; t13 timestamptz; t14 timestamptz; t1430 timestamptz;
  q1 uuid; q2 uuid; q3 uuid; q4 uuid; q5 uuid; q6 uuid; q7 uuid; qa uuid; qb uuid; qp uuid;
  comp_d uuid; comp_x uuid; comp_t uuid; crit uuid;
  ids uuid[];
  v_cnt int; n int; t text; j jsonb; b boolean; u uuid; w uuid;
  nfail int; nlines int; rep text;
begin
  begin   -- everything below; an unexpected error is reported with the lines before it instead of hiding them
  t10 := (mon + time '10:00') at time zone 'Africa/Johannesburg';
  t1030 := (mon + time '10:30') at time zone 'Africa/Johannesburg';
  t11 := (mon + time '11:00') at time zone 'Africa/Johannesburg';
  t13 := (mon + time '13:00') at time zone 'Africa/Johannesburg';
  t14 := (mon + time '14:00') at time zone 'Africa/Johannesburg';
  t1430 := (mon + time '14:30') at time zone 'Africa/Johannesburg';
  select id into c_caps from curricula where code = 'CAPS';
  select id into c_ieb from curricula where code = 'IEB';
  select id into c_pcaps from curricula where code = 'PRIMARY_CAPS';
  select id into c_tert from curricula where code = 'TERTIARY';

  -- ---- people, schools, hours ----------------------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_l, z,'authenticated','authenticated','m.l.'||v_l||'@example.invalid', jsonb_build_object('role','student','first_name','Lee','date_of_birth',adult), '{}'),
    (v_a, z,'authenticated','authenticated','m.a.'||v_a||'@example.invalid', jsonb_build_object('role','tutor','first_name','Alpha','date_of_birth',adult), '{}'),
    (v_b, z,'authenticated','authenticated','m.b.'||v_b||'@example.invalid', jsonb_build_object('role','tutor','first_name','Bravo','date_of_birth',adult), '{}'),
    (v_d, z,'authenticated','authenticated','m.d.'||v_d||'@example.invalid', jsonb_build_object('role','tutor','first_name','Delta','date_of_birth',adult), '{}'),
    (v_n, z,'authenticated','authenticated','m.n.'||v_n||'@example.invalid', jsonb_build_object('role','tutor','first_name','November','date_of_birth',adult), '{}'),
    (v_e, z,'authenticated','authenticated','m.e.'||v_e||'@example.invalid', jsonb_build_object('role','tutor','first_name','Echo','date_of_birth',adult), '{}'),
    (v_t, z,'authenticated','authenticated','m.t.'||v_t||'@example.invalid', jsonb_build_object('role','tutor','first_name','Tango','date_of_birth',adult), '{}'),
    (v_admin, z,'authenticated','authenticated','m.ad.'||v_admin||'@example.invalid', '{}'::jsonb, '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number) values (v_admin, 'M', 'Admin', 'x@example.invalid', '');
  update profiles set date_of_birth = adult::date where id in (v_a, v_b, v_d, v_n, v_e, v_t);
  update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null where id in (v_a, v_b, v_d, v_n, v_e, v_t);
  update tutor_profiles set is_verified = true where id in (v_a, v_b, v_d, v_n, v_e, v_t);
  -- A current police clearance certificate is needed to accept (migration 20261020180000): every tutor here has one.
  insert into tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
    select x, 'police_clearance'::public.doc_type, 'fixture/police-' || x, 'verified'::public.verification_status, (now() at time zone 'Africa/Johannesburg')::date
    from unnest(array[v_a, v_b, v_d, v_n, v_e, v_t]) x;

  insert into schools_institutions (name, curriculum, curriculum_id) values ('ZZ Test CAPS school', 'caps', c_caps) returning id into s1;
  insert into schools_institutions (name, curriculum, curriculum_id) values ('ZZ Test IEB school', 'ieb', c_ieb) returning id into s2;
  insert into schools_institutions (name, curriculum, curriculum_id) values ('ZZ Test primary school', 'primary_caps', c_pcaps) returning id into s3;
  insert into schools_institutions (name, curriculum, curriculum_id) values ('ZZ Test mixed school', 'caps', c_caps) returning id into s4;
  insert into schools_institutions (name, curriculum, curriculum_id) values ('ZZ Test university', 'tertiary', c_tert) returning id into s5;

  -- A, D, N and T are made with the table's own rules off (postgres writes), E and B approved too.
  insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status) values
    (v_a, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified'),
    (v_b, 'Zorology', 'ieb', 'Grade 8', 'Grade 12', 'verified'),
    (v_d, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'pending'),
    (v_n, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified'),
    (v_e, 'Zorology', 'caps', 'Grade 8', 'Grade 9', 'verified'),
    (v_t, 'Zorology', 'tertiary', 'Grade 8', 'Grade 12', 'pending');
  select id into comp_d from tutor_subject_competencies where tutor_id = v_d;
  select id into comp_t from tutor_subject_competencies where tutor_id = v_t;
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) values
    (v_a, 1, '09:00', '12:00'), (v_a, 1, '12:00', '15:00');
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time)
    select x, d, '00:00', '24:00' from unnest(array[v_b, v_e]) x, generate_series(0, 6) d;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_l, 'Zorology', 'Grade 10') returning id into e_l;
  select count(*) into n from tutor_availability where tutor_id in (v_a, v_b, v_e);
  r := r || format('M0 setup: Monday is %s (dow %s); availability rows=%s (want 16)', mon, extract(dow from mon), n) || E'\n';

  -- ---- a school and its curricula -----------------------------------------------------------------------------------------
  select string_agg(code, ',' order by code) into t from school_curricula(s1);
  r := r || format('M1 a school with one curriculum: %s (want CAPS)', t) || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_set_institution_curricula(s4, array[c_ieb]);
    r := r || 'M2 FAIL: a learner changed a school''s curricula' || E'\n';
  exception when others then r := r || format('M2 only an admin can change a school''s curricula: %s', sqlerrm) || E'\n'; end;
  begin
    insert into institution_curricula (institution_id, curriculum_id) values (s4, c_ieb);
    r := r || 'M2b FAIL: a direct insert worked' || E'\n';
  exception when others then r := r || format('M2b a direct insert is refused: %s', sqlerrm) || E'\n'; end;
  select string_agg(code, ',' order by code) into t from school_curricula(s4);
  r := r || format('M2c anyone can ask which curricula a school follows: %s (want CAPS)', t) || E'\n';
  begin
    perform public.tutor_qualify_problem(v_a, 'Zorology', 'Grade 10', s1, null);
    r := r || 'M2d FAIL: a signed-in user ran the tutor rule' || E'\n';
  exception when others then r := r || format('M2d the tutor rule is not callable from the app: %s', sqlerrm) || E'\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_institution_curricula(s4, array[c_ieb, c_caps]);
  reset role;
  select string_agg(code, ',' order by code) into t from school_curricula(s4);
  select count(*) into n from institution_curricula where institution_id = s4;
  r := r || format('M3 an admin adds IEB to the mixed school: %s (want CAPS,IEB); extras stored=%s (want 1: its own CAPS is never stored)', t, n) || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_institution_curricula(s4, array[]::uuid[]);
  reset role;
  select string_agg(code, ',' order by code) into t from school_curricula(s4);
  r := r || format('M3b emptying the list keeps the school''s own curriculum: %s (want CAPS)', t) || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.admin_set_institution_curricula(s4, array[c_ieb]);
  reset role;

  -- ---- a tutor can no longer approve their own subject ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_d, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
    values (v_d, 'Zorology2', 'caps', 'Grade 8', 'Grade 12', 'verified') returning id into comp_x;
  select verification_status::text into t from tutor_subject_competencies where id = comp_x;
  r := r || format('M4 a tutor adds a subject as "verified": stored as %s (want pending)', t) || E'\n';
  begin
    update tutor_subject_competencies set verification_status = 'verified' where id = comp_d;
    r := r || 'M5 FAIL: a tutor verified their own subject' || E'\n';
  exception when others then r := r || format('M5 a tutor cannot change the approval: %s', sqlerrm) || E'\n'; end;
  t := '';
  begin insert into tutor_subject_reviews (competency_id, review_note) values (comp_d, 'forged'); t := t || 'insert-allowed '; exception when others then t := t || 'insert-refused '; end;
  begin update tutor_subject_reviews set review_note = 'forged'; t := t || 'update-allowed '; exception when others then t := t || 'update-refused '; end;
  begin delete from tutor_subject_reviews; t := t || 'delete-allowed'; exception when others then t := t || 'delete-refused'; end;
  r := r || format('M5b a tutor cannot write the review table directly: %s (want insert-refused update-refused delete-refused)', t) || E'\n';
  reset role;
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'tutor_subject_competencies'
     and column_name in ('review_note', 'reviewed_by', 'reviewed_at', 'criteria_met');
  r := r || format('M5c the public subject table carries no review columns: %s (want 0)', n) || E'\n';

  -- the same tutor changing the grades of an approved subject sends it back for approval
  update tutor_subject_competencies set verification_status = 'verified' where id = comp_x;
  perform set_config('request.jwt.claims', json_build_object('sub', v_d, 'role','authenticated')::text, true);
  set local role authenticated;
  update tutor_subject_competencies set max_grade_level = 'Grade 7' where id = comp_x;
  select verification_status::text into t from tutor_subject_competencies where id = comp_x;
  r := r || format('M6 changing the grades of an approved subject sends it back: %s (want pending)', t) || E'\n';
  update tutor_subject_competencies set verification_status = 'pending' where id = comp_x;   -- unchanged value: allowed
  reset role;

  -- ---- rule 1: what a tutor teaches ------------------------------------------------------------------------------------------
  t := coalesce(public.tutor_qualify_problem(v_a, 'Zorology', 'Grade 10', s1, null), 'ok');
  r := r || format('M7 CAPS tutor, CAPS school, Grade 10: %s (want ok)', t) || E'\n';
  t := coalesce(public.tutor_qualify_problem(v_a, 'zor', 'grade 10', s1, null), 'ok');
  r := r || format('M7b typed text inside the subject name, other case: %s (want ok)', t) || E'\n';
  t := coalesce(public.tutor_qualify_problem(v_d, 'Zorology', 'Grade 10', s1, null), 'ok');
  r := r || format('M8 a tutor whose subject is not approved yet: %s (want not_approved)', t) || E'\n';
  t := coalesce(public.tutor_qualify_problem(v_a, 'Astrology', 'Grade 10', s1, null), 'ok');
  r := r || format('M8b a subject the tutor does not teach: %s (want no_subject)', t) || E'\n';
  t := coalesce(public.tutor_qualify_problem(v_e, 'Zorology', 'Grade 10', s1, null), 'ok');
  r := r || format('M9 a tutor approved for Grade 8 to 9 asked for Grade 10: %s (want wrong_grade)', t) || E'\n';
  t := coalesce(public.tutor_qualify_problem(v_e, 'Zorology', 'Grade 99', s1, null), 'ok');
  r := r || format('M9b a grade that is not in the list is not checked: %s (want ok)', t) || E'\n';
  t := coalesce(public.tutor_qualify_problem(v_a, 'Zorology', 'Grade 10', s2, null), 'ok');
  r := r || format('M10 CAPS tutor, IEB school: %s (want wrong_curriculum)', t) || E'\n';
  t := coalesce(public.tutor_qualify_problem(v_b, 'Zorology', 'Grade 10', s2, null), 'ok');
  r := r || format('M10b IEB tutor, IEB school: %s (want ok)', t) || E'\n';
  t := coalesce(public.tutor_qualify_problem(v_a, 'Zorology', 'Grade 6', s3, null), 'ok');
  r := r || format('M11 a CAPS tutor also covers a primary CAPS school (grade range allowing): %s (want wrong_grade, because the tutor starts at Grade 8)', t) || E'\n';
  update tutor_subject_competencies set min_grade_level = 'Grade 4' where tutor_id = v_a;
  t := coalesce(public.tutor_qualify_problem(v_a, 'Zorology', 'Grade 6', s3, null), 'ok');
  r := r || format('M11b ... once their range starts at Grade 4: %s (want ok)', t) || E'\n';
  update tutor_subject_competencies set min_grade_level = 'Grade 8' where tutor_id = v_a;
  t := coalesce(public.tutor_qualify_problem(v_b, 'Zorology', 'Grade 10', s1, null), 'ok');
  r := r || format('M11c an IEB tutor does not cover a CAPS school: %s (want wrong_curriculum)', t) || E'\n';
  t := coalesce(public.tutor_qualify_problem(v_a, 'Zorology', 'Grade 10', s4, null), 'ok') || ' / ' ||
       coalesce(public.tutor_qualify_problem(v_b, 'Zorology', 'Grade 10', s4, null), 'ok');
  r := r || format('M12 a school with two curricula and no answer yet: CAPS tutor / IEB tutor = %s (want ok / ok)', t) || E'\n';
  t := coalesce(public.tutor_qualify_problem(v_a, 'Zorology', 'Grade 10', s4, c_caps), 'ok') || ' / ' ||
       coalesce(public.tutor_qualify_problem(v_b, 'Zorology', 'Grade 10', s4, c_caps), 'ok');
  r := r || format('M12b the learner answered CAPS: %s (want ok / wrong_curriculum)', t) || E'\n';
  t := coalesce(public.tutor_qualify_problem(v_a, 'Zorology', 'Grade 10', s4, c_ieb), 'ok') || ' / ' ||
       coalesce(public.tutor_qualify_problem(v_b, 'Zorology', 'Grade 10', s4, c_ieb), 'ok');
  r := r || format('M12c the learner answered IEB: %s (want wrong_curriculum / ok)', t) || E'\n';
  t := coalesce(public.tutor_qualify_problem(v_d, '', 'Grade 10', s1, null), 'ok') || ' / ' || coalesce(public.tutor_qualify_problem(v_d, null, null, null, null), 'ok');
  r := r || format('M13 no subject asked for: nothing is checked: %s (want ok / ok)', t) || E'\n';

  -- ---- rule 2: whether a tutor is free ------------------------------------------------------------------------------------
  t := coalesce(public.tutor_free_problem(v_n, t10, 1), 'free');
  r := r || format('M14 a tutor with no working hours at all: %s (want no_hours)', t) || E'\n';
  t := coalesce(public.tutor_free_problem(v_a, t10, 1), 'free');
  r := r || format('M15 Monday 10:00 for 1 hour: %s (want free)', t) || E'\n';
  t := coalesce(public.tutor_free_problem(v_a, t11, 3), 'free');
  r := r || format('M16 11:00 to 14:00 crosses the end of the 09-12 block into the 12-15 block: %s (want free)', t) || E'\n';
  t := coalesce(public.tutor_free_problem(v_a, t14, 2), 'free');
  r := r || format('M17 14:00 to 16:00 runs past their last hour: %s (want outside_hours)', t) || E'\n';
  t := coalesce(public.tutor_free_problem(v_a, t1430, 0.5), 'free');
  r := r || format('M17b 14:30 to 15:00 ends exactly when their hours end: %s (want free)', t) || E'\n';
  t := coalesce(public.tutor_free_problem(v_a, ((mon + 1) + time '10:00') at time zone 'Africa/Johannesburg', 1), 'free');
  r := r || format('M18 Tuesday 10:00 (they only work Mondays): %s (want outside_hours)', t) || E'\n';
  t := coalesce(public.tutor_free_problem(v_a, ((mon + time '07:00') at time zone 'UTC'), 1), 'free') || ' / ' ||
       coalesce(public.tutor_free_problem(v_a, ((mon + time '06:59') at time zone 'UTC'), 1), 'free');
  r := r || format('M19 hours are South African time: 07:00 UTC (= 09:00) / 06:59 UTC (= 08:59) = %s (want free / outside_hours)', t) || E'\n';
  t := coalesce(public.tutor_free_problem(v_b, ((mon + time '23:00') at time zone 'Africa/Johannesburg'), 1.5), 'free') || ' / ' ||
       coalesce(public.tutor_free_problem(v_a, ((mon + time '14:00') at time zone 'Africa/Johannesburg'), 1.5), 'free');
  r := r || format('M20 a window across midnight: an all-day tutor / a Monday-only tutor starting 14:00 for 1.5h = %s (want free / outside_hours)', t) || E'\n';
  t := coalesce(public.tutor_free_problem(v_a, (mon + time '23:00') at time zone 'Africa/Johannesburg', 1.5), 'free');
  r := r || format('M20b a Monday-only tutor from 23:00 to 00:30: %s (want outside_hours)', t) || E'\n';

  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, duration_hours, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status, enrollment_id)
    values (v_l, v_a, v_l, t10, 1, 50, 30, 50, 35, 'scheduled', e_l);
  t := coalesce(public.tutor_free_problem(v_a, t1030, 1), 'free') || ' / ' || coalesce(public.tutor_free_problem(v_a, t11, 1), 'free') ||
       ' / ' || coalesce(public.tutor_free_problem(v_a, (mon + time '09:00') at time zone 'Africa/Johannesburg', 1), 'free');
  r := r || format('M21 with a session 10:00-11:00: 10:30 / 11:00 / 09:00-10:00 = %s (want busy / free / free)', t) || E'\n';
  delete from sessions where tutor_id = v_a and scheduled_start = t10;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, duration_hours, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status, enrollment_id)
    values (v_l, v_a, v_l, t10, 1, 50, 30, 50, 35, 'cancelled_by_student', e_l);
  t := coalesce(public.tutor_free_problem(v_a, t10, 1), 'free');
  r := r || format('M21b a cancelled session does not block: %s (want free)', t) || E'\n';
  delete from sessions where tutor_id = v_a and scheduled_start = t10;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, duration_hours, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status, enrollment_id)
    values (v_l, v_a, v_l, t10, 1, 50, 30, 50, 35, 'completed', e_l);
  t := coalesce(public.tutor_free_problem(v_a, t10, 1), 'free');
  r := r || format('M21c nor does a completed one: %s (want free)', t) || E'\n';
  delete from sessions where tutor_id = v_a and scheduled_start = t10;

  -- ---- the price counts --------------------------------------------------------------------------------------------------------
  -- (Since the best-fit-first migration 20261019120000 the counts are of tutors who could take the request once it has widened after 5
  -- minutes: the school and the curriculum no longer narrow them; the subject, grade and free time still do. The wants below say so.)
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 10', s1);
  r := r || format('M22 counts for the CAPS school, no time (old three-value call): %s (want 3: A, B, N)', n) || E'\n';
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 10', s1, t10, 1);
  r := r || format('M23 ... for Monday 10:00, 1 hour: %s (want 2: A, B; N has no hours)', n) || E'\n';
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 10', s1, (mon + 6 + time '10:00') at time zone 'Africa/Johannesburg', 1);
  r := r || format('M24 ... for a Sunday: %s (want 1: B, who works every day)', n) || E'\n';
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 10', s4, null, null, null);
  select coalesce(max(tutors), 0) into v_cnt from available_price_levels('Zorology', 'Grade 10', s4, null, null, c_ieb);
  r := r || format('M25 the mixed school: no answer=%s (want 3: A, N, B), answered IEB=%s (want 3: the answer no longer narrows the counts)', n, v_cnt) || E'\n';
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 10', s4, null, null, c_caps);
  r := r || format('M25b the mixed school, answered CAPS: %s (want 3: A, B, N)', n) || E'\n';
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 99', s1);
  r := r || format('M26 a grade that is not in the list: %s (want 4: A, B, N, E)', n) || E'\n';
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 10', s2, (mon + time '23:00') at time zone 'Africa/Johannesburg', 1.5);
  r := r || format('M27 the IEB school at 23:00 for 1.5 hours (across midnight): %s (want 1: B)', n) || E'\n';
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 10', null);
  r := r || format('M28 no school: no curriculum is asked for, so any approved tutor for the grade counts: %s (want 3: A, B, N)', n) || E'\n';

  -- ---- the tutor's inbox, then accepting ------------------------------------------------------------------------------------
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, t10, 1, 'pending', 'paid', 'cam_q1', '1A', 1, 50, s1) returning id into q1;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, t1030, 1, 'pending', 'paid', 'cam_q2', '1A', 1, 50, s1) returning id into q2;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, t11, 1, 'pending', 'paid', 'cam_q3', '1A', 1, 50, s1) returning id into q3;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from available_requests_for_tutor() where id in (q1, q2, q3);
  r := r || format('M29 tutor A sees the three requests that fit them: %s (want 3)', n) || E'\n';
  reset role;
  t := '';
  for u in select x from unnest(array[v_b, v_d, v_n, v_e]) x loop
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role','authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from available_requests_for_tutor() where id in (q1, q2, q3);
    t := t || n || ' ';
    reset role;
  end loop;
  r := r || format('M30 what the IEB tutor / unapproved tutor / tutor without hours / Grade 8-9 tutor see: %s(want 0 0 0 0)', t) || E'\n';

  set local role service_role;
  begin select public.claim_session_request(q1, v_n) into j; r := r || 'M31 FAIL: a tutor without hours accepted' || E'\n';
  exception when others then r := r || format('M31 no hours: %s', sqlerrm) || E'\n'; end;
  begin select public.claim_session_request(q1, v_d) into j; r := r || 'M32 FAIL: an unapproved tutor accepted' || E'\n';
  exception when others then r := r || format('M32 subject not approved: %s', sqlerrm) || E'\n'; end;
  begin select public.claim_session_request(q1, v_b) into j; r := r || 'M33 FAIL: an IEB tutor accepted a CAPS school''s request' || E'\n';
  exception when others then r := r || format('M33 wrong curriculum: %s', sqlerrm) || E'\n'; end;
  begin select public.claim_session_request(q1, v_e) into j; r := r || 'M34 FAIL: a Grade 8-9 tutor accepted a Grade 10 request' || E'\n';
  exception when others then r := r || format('M34 wrong grade: %s', sqlerrm) || E'\n'; end;
  select public.claim_session_request(q1, v_a) into j;
  r := r || format('M35 tutor A accepts the 10:00 request: mode %s (want already_paid)', j->>'mode') || E'\n';
  begin select public.claim_session_request(q2, v_a) into j; r := r || 'M36 FAIL: accepted a request that overlaps their 10:00 session' || E'\n';
  exception when others then r := r || format('M36 overlapping 10:30 request: %s', sqlerrm) || E'\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from available_requests_for_tutor() where id in (q2);
  select count(*) into v_cnt from available_requests_for_tutor() where id in (q3);
  r := r || format('M37 once booked 10:00-11:00 the overlapping request leaves their inbox and the 11:00 one stays: overlapping=%s later=%s (want overlapping=0 later=1)', n, v_cnt) || E'\n';
  reset role;
  -- the older accept (a request paid up front; it is not open to the app, so it is called as the owner with the tutor's identity)
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  u := public.accept_session_request(q3);
  r := r || format('M38 the older accept path takes the 11:00 request, next to the first session: session made=%s (want true)', u is not null) || E'\n';
  begin
    perform public.accept_session_request(q2);
    r := r || 'M39 FAIL: the older accept path took an overlapping request' || E'\n';
  exception when others then r := r || format('M39 the older accept path refuses an overlap: %s', sqlerrm) || E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_d, 'role','authenticated')::text, true);
  begin
    perform public.accept_session_request(q2);
    r := r || 'M40 FAIL: an unapproved tutor used the older accept path' || E'\n';
  exception when others then r := r || format('M40 the older accept path refuses an unapproved subject: %s', sqlerrm) || E'\n'; end;

  -- two overlapping accepts by one tutor, through the real charge path: the first is "being charged", the second is refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, institution_id)
    values (v_l, e_l, v_l, t13, 1.5, 'cam_q4', '1A', s1) returning id into q4;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, institution_id)
    values (v_l, e_l, v_l, t14, 1, 'cam_q5', '1A', s1) returning id into q5;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, institution_id)
    values (v_l, e_l, v_l, t1430, 1, 'cam_q6', '1A', s1) returning id into q6;
  reset role;
  set local role service_role;
  perform public.save_tutor_payout_account(v_a, '632005', 'Absa Bank Limited, South Africa', 'Alpha Tutor', '6789', 'ACCT_camA', 'recorded_test_mode', '{}');
  select public.record_card_verification('cam_q4', 100, 'ZAR', auth_ok, 'm@example.invalid') into t;
  select public.record_card_verification('cam_q5', 100, 'ZAR', auth_ok, 'm@example.invalid') into t;
  select public.record_card_verification('cam_q6', 100, 'ZAR', auth_ok, 'm@example.invalid') into t;
  select public.claim_session_request(q4, v_a) into j;
  r := r || format('M41 tutor A accepts 13:00-14:30: mode %s (want charge)', j->>'mode') || E'\n';
  begin select public.claim_session_request(q5, v_a) into j; r := r || 'M42 FAIL: a second accept overlapping the one being charged' || E'\n';
  exception when others then r := r || format('M42 a second accept overlapping the one being charged: %s', sqlerrm) || E'\n'; end;
  begin select public.claim_session_request(q6, v_a) into j; r := r || 'M43 FAIL: accepted a session that ends after their hours' || E'\n';
  exception when others then r := r || format('M43 14:30 for 1 hour ends after 15:00: %s', sqlerrm) || E'\n'; end;
  reset role;
  t := coalesce(public.request_fit_code(v_a, q4), 'ok');
  r := r || format('M43b the accept already in progress does not block itself when asked again: %s (want ok)', t) || E'\n';
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 10', s1, t13, 1);
  r := r || format('M44 the price counts see the accept in progress: tutors for 13:00 = %s (want 1: B; A is being charged for 13:00-14:30)', n) || E'\n';

  -- a request that "starts now" is judged from now: E works every day all day
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_l, 'Zorology', 'Grade 8') returning id into w;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, w, v_l, now() - interval '20 minutes', 1, 'pending', 'paid', 'cam_q7', '1A', 1, 50, s1) returning id into q7;
  set local role service_role;
  select public.claim_session_request(q7, v_e) into j;
  r := r || format('M45 an "as soon as possible" request that was sent 20 minutes ago is judged from now: mode %s (want already_paid)', j->>'mode') || E'\n';
  reset role;

  -- ---- a new request: length, curriculum, "book again" -----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  t := '';
  for n in 1..7 loop
    begin
      insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, institution_id)
        values (v_l, e_l, v_l, t10, (array[0.5, 1.25, 3.5, 1, 1.5, 2.5, 3])[n], 'cam_len' || n, '1A', s1);
      t := t || (array[0.5, 1.25, 3.5, 1, 1.5, 2.5, 3])[n] || '=ok ';
    exception when others then t := t || (array[0.5, 1.25, 3.5, 1, 1.5, 2.5, 3])[n] || '=refused '; end;
  end loop;
  r := r || format('M46 session lengths: %s(want 0.5, 1.25 and 3.5 refused; 1, 1.5, 2.5 and 3 ok)', t) || E'\n';
  begin
    insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, institution_id, curriculum_id)
      values (v_l, e_l, v_l, t10, 1, 'cam_c1', '1A', s1, c_ieb);
    r := r || 'M47 FAIL: an IEB answer for a school that only follows CAPS' || E'\n';
  exception when others then r := r || format('M47 a curriculum the school does not follow is refused: %s', sqlerrm) || E'\n'; end;
  begin
    insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, institution_id, curriculum_id)
      values (v_l, e_l, v_l, t10, 1, 'cam_c2', '1A', s4, c_ieb) returning id into qa;
    select curriculum_id = c_ieb into b from session_requests where id = qa;
    r := r || format('M48 the mixed school accepts an IEB answer and keeps it: %s (want true)', b) || E'\n';
  exception when others then r := r || format('M48 FAIL: %s', sqlerrm) || E'\n'; end;
  reset role;

  -- "book again": needs a completed session with the tutor
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, duration_hours, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status, enrollment_id)
    values (v_l, v_a, v_l, now() - interval '10 days', 1, 50, 30, 50, 35, 'completed', e_l);
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, institution_id, requested_tutor_id)
      values (v_l, e_l, v_l, (mon + 1 + time '10:00') at time zone 'Africa/Johannesburg', 1, 'cam_ba1', '1A', s1, v_a);
    r := r || 'M49 FAIL: asked a tutor for a time outside their hours' || E'\n';
  exception when others then r := r || format('M49 "book again" at a time the tutor is not free: %s', sqlerrm) || E'\n'; end;
  begin
    insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, institution_id, requested_tutor_id)
      values (v_l, e_l, v_l, t10, 1, 'cam_ba2', '1A', s2, v_a);
    r := r || 'M50 FAIL: asked a CAPS tutor on behalf of an IEB school' || E'\n';
  exception when others then r := r || format('M50 "book again" for a curriculum the tutor is not approved for: %s', sqlerrm) || E'\n'; end;
  begin
    insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, paystack_reference, min_sub_tier_id, institution_id, requested_tutor_id)
      values (v_l, e_l, v_l, (mon + time '09:00') at time zone 'Africa/Johannesburg', 1, 'cam_ba3', '1A', s1, v_a) returning id into qb;
    r := r || format('M51 "book again" at 09:00 Monday, when the tutor is free: accepted=%s (want true)', qb is not null) || E'\n';
  exception when others then r := r || format('M51 FAIL: %s', sqlerrm) || E'\n'; end;
  reset role;

  -- ---- the admin: approving a subject against the checklist ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_d, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_review_tutor_subject(comp_d, 'approve', '', '{}');
    r := r || 'M52 FAIL: a tutor approved their own subject through the admin function' || E'\n';
  exception when others then r := r || format('M52 only an admin can approve: %s', sqlerrm) || E'\n'; end;
  select count(*) into n from curriculum_criteria;
  r := r || format('M52b a tutor cannot read the checklist: rows seen=%s (want 0)', n) || E'\n';
  select count(*) into n from tutor_subject_competencies where tutor_id = v_t;
  r := r || format('M52c a tutor does not see another tutor''s unapproved subject: %s (want 0)', n) || E'\n';
  reset role;
  select array_agg(id) into ids from curriculum_criteria where curriculum = 'caps' and active and required;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from tutor_subject_competencies where verification_status = 'pending' and tutor_id in (v_d, v_t);
  r := r || format('M53 an admin sees pending subjects: %s (want 3: D''s two and T''s)', n) || E'\n';
  select count(*) into n from curriculum_criteria where curriculum = 'caps' and active;
  r := r || format('M53b the CAPS checklist the admin sees: %s items (want 4)', n) || E'\n';
  begin
    perform public.admin_review_tutor_subject(comp_d, 'approve', '', '{}');
    r := r || 'M54 FAIL: approved without ticking the required criteria' || E'\n';
  exception when others then r := r || format('M54 approving without the required ticks is refused: %s', sqlerrm) || E'\n'; end;
  begin
    perform public.admin_review_tutor_subject(comp_d, 'reject', ' ', '{}');
    r := r || 'M55 FAIL: rejected without a reason' || E'\n';
  exception when others then r := r || format('M55 rejecting without a reason is refused: %s', sqlerrm) || E'\n'; end;
  begin
    perform public.admin_review_tutor_subject(comp_d, 'approve', '', ids || array[gen_random_uuid()]);
    r := r || 'M55b FAIL: approved with a criterion from nowhere' || E'\n';
  exception when others then r := r || format('M55b a tick that is not on this checklist is refused: %s', sqlerrm) || E'\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.admin_review_tutor_subject(comp_d, 'approve', 'Matric certificate seen', ids);
  reset role;
  select c.verification_status::text || ' by admin=' || (v.reviewed_by = v_admin) || ' at set=' || (v.reviewed_at is not null) || ' ticks=' || cardinality(v.criteria_met)
    into t from tutor_subject_competencies c join tutor_subject_reviews v on v.competency_id = c.id where c.id = comp_d;
  r := r || format('M56 approved with the three required ticks: %s (want verified by admin=true at set=true ticks=3)', t) || E'\n';
  -- the exposure itself: the subject is APPROVED, so everyone can read it; nobody but its tutor and the admins may read the review
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  select count(*) into n from tutor_subject_competencies where id = comp_d;
  r := r || format('M56a a signed-out caller can read the approved subject itself: %s row (want 1)', n) || E'\n';
  begin
    select count(*) into n from tutor_subject_reviews where competency_id = comp_d;
    t := 'rows=' || n;
  exception when others then t := sqlerrm; end;
  r := r || format('M56b a signed-out caller reads the review of an approved subject: %s (want permission denied)', t) || E'\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from tutor_subject_competencies where id = comp_d;
  select count(*) into v_cnt from tutor_subject_reviews;
  r := r || format('M56c another tutor reads the approved subject and the reviews: subject rows=%s reviews seen=%s (want subject rows=1 reviews seen=0)', n, v_cnt) || E'\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from tutor_subject_competencies where id = comp_d;
  select count(*) into v_cnt from tutor_subject_reviews;
  r := r || format('M56d a learner reads the approved subject and the reviews: subject rows=%s reviews seen=%s (want subject rows=1 reviews seen=0)', n, v_cnt) || E'\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_d, 'role','authenticated')::text, true);
  set local role authenticated;
  select review_note || ' / ticks=' || cardinality(criteria_met) into t from tutor_subject_reviews where competency_id = comp_d;
  r := r || format('M56e the owning tutor reads their review: %s (want Matric certificate seen / ticks=3)', coalesce(t, 'nothing')) || E'\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  select review_note || ' / ticks=' || cardinality(criteria_met) into t from tutor_subject_reviews where competency_id = comp_d;
  r := r || format('M56f an admin reads the review: %s (want Matric certificate seen / ticks=3)', coalesce(t, 'nothing')) || E'\n';
  reset role;
  select count(*) into n from notifications where profile_id = v_d and type in ('subject_approved', 'subject_rejected');
  r := r || format('M57 approving writes no notice to the tutor (CEO, 19 Oct 2026): %s notices (want 0)', n) || E'\n';
  select count(*) into n from admin_audit_logs where admin_id = v_admin and target_entity_id = comp_d;
  r := r || format('M58 the approval is in the audit log: %s row (want 1)', n) || E'\n';
  t := coalesce(public.tutor_qualify_problem(v_d, 'Zorology', 'Grade 10', s1, null), 'ok');
  r := r || format('M59 the tutor now qualifies: %s (want ok)', t) || E'\n';

  -- rejecting, and the tutor reading why
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.admin_review_tutor_subject(comp_x, 'reject', 'Proof does not cover this subject', '{}');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_d, 'role','authenticated')::text, true);
  set local role authenticated;
  select c.verification_status::text || ' / ' || coalesce(v.review_note, 'none') || ' / ticks=' || coalesce(cardinality(v.criteria_met)::text, 'none')
    into t from tutor_subject_competencies c left join tutor_subject_reviews v on v.competency_id = c.id where c.id = comp_x;
  r := r || format('M60 a rejected subject: the tutor reads the reason: %s (want rejected / Proof does not cover this subject / ticks=0)', t) || E'\n';
  select count(*) into n from notifications where profile_id = v_d and type in ('subject_approved', 'subject_rejected');
  r := r || format('M60b ... and rejecting writes none either: %s notices (want 0)', n) || E'\n';
  reset role;
  t := coalesce(public.tutor_qualify_problem(v_d, 'Zorology2', 'Grade 10', s1, null), 'ok');
  r := r || format('M60c a rejected subject does not qualify: %s (want not_approved)', t) || E'\n';

  -- a curriculum with no checklist yet needs a note
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_review_tutor_subject(comp_t, 'approve', '', '{}');
    r := r || 'M61 FAIL: approved a curriculum with no checklist and no note' || E'\n';
  exception when others then r := r || format('M61 no checklist and no note: %s', sqlerrm) || E'\n'; end;
  reset role;

  -- the waiting list asks the same counts. Since 20261019120000 they ignore the school and the curriculum, so a learner can only join when
  -- nobody at all is approved for Zorology Grade 10: the approved ones are put back to pending for this part (the owner may), then T is approved.
  update tutor_subject_competencies set verification_status = 'pending' where subject_name = 'Zorology' and verification_status = 'verified';
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  w := public.join_tutor_waitlist(v_l, 'Zorology', 'Grade 10', s5);
  r := r || format('M62 a learner at the university joins the waiting list (nobody is approved for the subject): joined=%s (want true)', w is not null) || E'\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.admin_review_tutor_subject(comp_t, 'approve', 'Transcript seen', '{}');
  reset role;
  select count(*) into n from notifications where profile_id = v_l and type = 'tutor_available';
  r := r || format('M64 approving that tutor''s subject tells the learner who was waiting: %s notice (want 1)', n) || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.join_tutor_waitlist(v_l, 'Zorology', 'Grade 10', s1);
    r := r || 'M63 FAIL: joined although a tutor is available for any school now that a tutor is approved' || E'\n';
  exception when others then r := r || format('M63 joining is refused where a tutor is available: %s', sqlerrm) || E'\n'; end;
  reset role;

  -- ---- the checklist is editable data -------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  crit := public.admin_save_curriculum_criterion(null, 'tertiary', 'Holds a degree in the subject', true, true, 1);
  perform public.admin_save_curriculum_criterion(crit, 'tertiary', 'Holds a degree or honours in the subject', true, true, 1);
  select criterion into t from curriculum_criteria where id = crit;
  r := r || format('M65 an admin adds and edits a criterion: %s', t) || E'\n';
  perform public.admin_delete_curriculum_criterion(crit);
  select count(*) into n from curriculum_criteria where id = crit;
  r := r || format('M66 and deletes it: rows left=%s (want 0)', n) || E'\n';
  begin
    perform public.admin_save_curriculum_criterion(null, 'caps', 'ab', true, true, 1);
    r := r || 'M67 FAIL: a two-letter criterion was saved' || E'\n';
  exception when others then r := r || format('M67 a too-short criterion is refused: %s', sqlerrm) || E'\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_save_curriculum_criterion(null, 'caps', 'A learner writes a criterion', true, true, 1);
    r := r || 'M68 FAIL: a learner saved a criterion' || E'\n';
  exception when others then r := r || format('M68 only an admin can edit the checklist: %s', sqlerrm) || E'\n'; end;
  reset role;
  exception when others then
    r := r || format('STOPPED EARLY by an unexpected error: %s', sqlerrm) || E'\n';
  end;

  -- The Supabase tool cuts the middle of a long error, so each report line is shortened to its id and its value (the part after the
  -- first ": "; a FAIL or STOPPED line stays whole) and the whole report fits in one error. The FAIL count counts whole lines.
  select count(*) filter (where l like '%FAIL%' or l like 'STOPPED%'), count(*) filter (where l <> '')
    into nfail, nlines from regexp_split_to_table(r, E'\n') as l;
  select string_agg(case when l like '%FAIL%' or l like 'STOPPED%' then l else regexp_replace(l, '^(\S+) [^:]*: ', E'\\1 ') end, E'\n' order by o)
    into rep from regexp_split_to_table(r, E'\n') with ordinality as x(l, o) where l <> '';
  -- Inside scripts/run-rolled-back-test.mjs the report is handed back through a setting and the runner raises it (the rollback). Run on
  -- its own, the test raises it itself, so it never leaves its fixtures behind.
  if coalesce(current_setting('test.runner', true), '') = 'on' then
    perform set_config('test.report', format(E'CURRICULUM AND AVAILABILITY TEST (rolled back): %s FAIL line(s) in %s lines\n%s', nfail, nlines, rep), true);
  else
    raise exception E'CURRICULUM AND AVAILABILITY TEST (rolled back): % FAIL line(s) in % lines\n%', nfail, nlines, rep;
  end if;
end $$;
