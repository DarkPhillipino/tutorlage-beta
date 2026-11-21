-- Rolled-back test of public.no_tutor_reason (P5-b, CEO 21 Nov 2026; migration 20261121200000). See README.md.
-- Run it TOGETHER with the migration in one statement (scripts/run-rolled-back-test.mjs) before the migration is applied, or on its own after.
-- Every line ends "ok" or "FAIL". All fixtures use made-up subjects (Quillology, Fennology, Hollowology, Pendingology, Gadology) so no real
-- tutor can change an answer.
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  tz constant text := 'Africa/Johannesburg';
  adult text := (current_date - interval '30 years')::date::text;
  v_l uuid := gen_random_uuid();       -- an adult learner
  v_a uuid := gen_random_uuid();       -- tutor A: Quillology, approved, Mondays 09:00-12:00 and 12:00-15:00 (two touching blocks)
  v_b uuid := gen_random_uuid();       -- tutor B: Fennology, approved, Mondays 09:00-10:00 only, booked on three Mondays
  v_n uuid := gen_random_uuid();       -- tutor N: Hollowology, approved, no working hours at all
  v_d uuid := gen_random_uuid();       -- tutor D: Pendingology, NOT approved
  v_g uuid := gen_random_uuid();       -- tutor G: Gadology, approved, level 1A, every day all day
  m1 date := (date_trunc('week', now() at time zone 'Africa/Johannesburg') + interval '7 days')::date;   -- the next Monday (1 to 7 days ahead)
  e_l uuid;
  hi_sub text;
  j jsonb; j2 jsonb; w jsonb; got text; want text; n int; n2 int; k int; st timestamptz; ok boolean;
  args text[]; a text;
  nfail int; nlines int; rep text;

  -- one report line: id, what it shows, then ok or FAIL with both values
  _ text;
begin
  begin
  -- ---- people, hours, approved subjects -----------------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_l, z,'authenticated','authenticated','m.l.'||v_l||'@example.invalid', jsonb_build_object('role','student','first_name','Lee','date_of_birth',adult), '{}'),
    (v_a, z,'authenticated','authenticated','m.a.'||v_a||'@example.invalid', jsonb_build_object('role','tutor','first_name','Alpha','date_of_birth',adult), '{}'),
    (v_b, z,'authenticated','authenticated','m.b.'||v_b||'@example.invalid', jsonb_build_object('role','tutor','first_name','Bravo','date_of_birth',adult), '{}'),
    (v_n, z,'authenticated','authenticated','m.n.'||v_n||'@example.invalid', jsonb_build_object('role','tutor','first_name','November','date_of_birth',adult), '{}'),
    (v_d, z,'authenticated','authenticated','m.d.'||v_d||'@example.invalid', jsonb_build_object('role','tutor','first_name','Delta','date_of_birth',adult), '{}'),
    (v_g, z,'authenticated','authenticated','m.g.'||v_g||'@example.invalid', jsonb_build_object('role','tutor','first_name','Golf','date_of_birth',adult), '{}');
  update profiles set date_of_birth = adult::date where id in (v_a, v_b, v_n, v_d, v_g);
  update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null where id in (v_a, v_b, v_n, v_d, v_g);
  update tutor_profiles set is_verified = true where id in (v_a, v_b, v_n, v_d, v_g);
  insert into tier1_training (tutor_id, module, result, method, conduct_accepted_at)
    select x, 7, 'complete', 'scenario_check', now() from unnest(array[v_a, v_b, v_n, v_d, v_g]) x;
  insert into tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
    select x, 'police_clearance'::public.doc_type, 'fixture/police-' || x, 'verified'::public.verification_status, (now() at time zone tz)::date
    from unnest(array[v_a, v_b, v_n, v_d, v_g]) x;
  insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status) values
    (v_a, 'Quillology', 'caps', 'Grade 8', 'Grade 12', 'verified'),
    (v_b, 'Fennology', 'caps', 'Grade 8', 'Grade 12', 'verified'),
    (v_n, 'Hollowology', 'caps', 'Grade 8', 'Grade 12', 'verified'),
    (v_d, 'Pendingology', 'caps', 'Grade 8', 'Grade 12', 'pending'),
    (v_g, 'Gadology', 'caps', 'Grade 8', 'Grade 12', 'verified');
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) values
    (v_a, 1, '09:00', '12:00'), (v_a, 1, '12:00', '15:00'), (v_b, 1, '09:00', '10:00');
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time)
    select v_g, d, '00:00', '24:00' from generate_series(0, 6) d;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_l, 'Quillology', 'Grade 10') returning id into e_l;
  -- bookings: A has 11:00-12:00 on the next Monday (it touches both of its other windows); B is booked 09:00-10:00 on three Mondays.
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, duration_hours, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status, enrollment_id)
    select v_l, v_a, v_l, ((m1 + time '11:00') at time zone tz), 1, 50, 30, 50, 35, 'scheduled', e_l;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, duration_hours, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status, enrollment_id)
    select v_l, v_b, v_l, (((m1 + x * 7) + time '09:00') at time zone tz), 1, 50, 30, 50, 35, 'scheduled', e_l from generate_series(0, 2) x;
  select id into hi_sub from sub_tier_definitions where id not in ('4C','4D') order by max_allowed_rate desc limit 1;
  r := r || format('N0 setup: next Monday is %s (dow %s); highest level used as a floor: %s', m1, extract(dow from m1), hi_sub) || E'\n';

  -- ---- the learner calls it -----------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;

  -- case 1: nobody teaches it
  j := public.no_tutor_reason('Zzyzology', 'Grade 10', (m1 + time '10:00') at time zone tz, 1);
  got := j->>'case'; want := 'no_subject';
  r := r || format('N1 a subject nobody teaches: %s', case when got = want then 'ok' else 'FAIL got ' || got || ' want ' || want end) || E'\n';
  j := public.no_tutor_reason('Pendingology', 'Grade 10', (m1 + time '10:00') at time zone tz, 1);
  got := j->>'case';
  r := r || format('N2 a tutor teaches it but is not approved for it yet: %s', case when got = want then 'ok' else 'FAIL got ' || got || ' want ' || want end) || E'\n';
  j := public.no_tutor_reason('Quillology', 'Grade 3', (m1 + time '10:00') at time zone tz, 1);
  got := j->>'case';
  r := r || format('N2b a grade the only tutor is not approved for: %s', case when got = want then 'ok' else 'FAIL got ' || got || ' want ' || want end) || E'\n';

  -- a tutor is free as chosen: nothing to say
  j := public.no_tutor_reason('Quillology', 'Grade 10', (m1 + time '10:00') at time zone tz, 1);
  got := j->>'case'; want := 'ok';
  r := r || format('N3 free at 10:00 for 1 hour: %s', case when got = want then 'ok' else 'FAIL got ' || got || ' want ' || want end) || E'\n';
  -- the edges touch the booked session 11:00-12:00 and are free
  j := public.no_tutor_reason('Quillology', 'Grade 10', (m1 + time '12:00') at time zone tz, 1);
  got := j->>'case';
  r := r || format('N4 a lesson starting exactly when the booked one ends (12:00): %s', case when got = want then 'ok' else 'FAIL got ' || got || ' want ' || want end) || E'\n';
  j := public.no_tutor_reason('Quillology', 'Grade 10', (m1 + time '10:00') at time zone tz, 1);
  r := r || format('N4b a lesson ending exactly when the booked one starts (10:00 to 11:00): %s', case when j->>'case' = want then 'ok' else 'FAIL got ' || (j->>'case') || ' want ' || want end) || E'\n';

  -- case 3: booked at the chosen time, open at others
  j := public.no_tutor_reason('Quillology', 'Grade 10', (m1 + time '10:30') at time zone tz, 1);
  got := j->>'case'; want := 'other_time';
  r := r || format('N5 10:30 for 1 hour overlaps the booked 11:00: %s', case when got = want then 'ok' else 'FAIL got ' || got || ' want ' || want end) || E'\n';
  j := public.no_tutor_reason('Quillology', 'Grade 10', (m1 + time '11:00') at time zone tz, 1);
  got := j->>'case';
  r := r || format('N5b the booked time itself: %s', case when got = want then 'ok' else 'FAIL got ' || got || ' want ' || want end) || E'\n';
  w := j->'windows'->0;
  r := r || format('N6 first window is the one touching the booking from before: %s %s to %s (want %s 09:00 to 11:00)', w->>'date', w->>'from', w->>'to', m1) || E'\n';
  r := r || format('N6b %s', case when w->>'date' = m1::text and w->>'from' = '09:00' and w->>'to' = '11:00' then 'ok' else 'FAIL' end) || E'\n';
  w := j->'windows'->1;
  r := r || format('N7 second window is the one touching the booking from after: %s', case when w->>'date' = m1::text and w->>'from' = '12:00' and w->>'to' = '15:00' then 'ok' else 'FAIL ' || coalesce(w::text, 'none') end) || E'\n';
  select count(*) into n from jsonb_array_elements(j->'windows') x
   where x->>'date' = m1::text and (x->>'from') < '12:00' and (x->>'to') > '11:00';
  r := r || format('N8 no window overlaps the booked 11:00-12:00: %s', case when n = 0 then 'ok' else 'FAIL ' || n || ' overlap' end) || E'\n';
  n := jsonb_array_length(j->'windows');
  r := r || format('N9 at most 5 windows: %s', case when n between 1 and 5 then 'ok (' || n || ')' else 'FAIL ' || n end) || E'\n';
  select count(*) into n from jsonb_array_elements(j->'windows') x
   where (x->>'date')::date < (now() at time zone tz)::date or (x->>'date')::date > (now() at time zone tz)::date + 14 or x->>'place' <> 'online';
  r := r || format('N10 every window is within 14 days and online: %s', case when n = 0 then 'ok' else 'FAIL ' || n end) || E'\n';
  -- a 3 hour lesson does not fit 09:00-11:00: the first window that does is 12:00-15:00
  j2 := public.no_tutor_reason('Quillology', 'Grade 10', (m1 + time '09:00') at time zone tz, 3);
  w := j2->'windows'->0;
  r := r || format('N11 a 3 hour lesson: the first window is 12:00 to 15:00 (the 2 hour gap is too short): %s',
         case when j2->>'case' = 'other_time' and w->>'date' = m1::text and w->>'from' = '12:00' and w->>'to' = '15:00' then 'ok' else 'FAIL ' || coalesce(w::text, j2->>'case') end) || E'\n';

  -- case 2: fully booked / nothing open
  j := public.no_tutor_reason('Fennology', 'Grade 10', (m1 + time '09:00') at time zone tz, 1);
  r := r || format('N12 every window of the only tutor is booked: %s', case when j->>'case' = 'fully_booked' and jsonb_array_length(j->'windows') = 0 then 'ok' else 'FAIL ' || j::text end) || E'\n';
  j := public.no_tutor_reason('Hollowology', 'Grade 10', (m1 + time '10:00') at time zone tz, 1);
  r := r || format('N13 a tutor with no working hours at all: %s', case when j->>'case' = 'fully_booked' then 'ok' else 'FAIL ' || j::text end) || E'\n';

  -- the level floor
  j := public.no_tutor_reason('Gadology', 'Grade 10', (m1 + time '10:00') at time zone tz, 1);
  r := r || format('N14 no floor: %s', case when j->>'case' = 'ok' then 'ok' else 'FAIL ' || j::text end) || E'\n';
  j := public.no_tutor_reason('Gadology', 'Grade 10', (m1 + time '10:00') at time zone tz, 1, '1A');
  r := r || format('N15 floor 1A (the tutor is 1A): %s', case when j->>'case' = 'ok' then 'ok' else 'FAIL ' || j::text end) || E'\n';
  j := public.no_tutor_reason('Gadology', 'Grade 10', (m1 + time '10:00') at time zone tz, 1, hi_sub);
  r := r || format('N16 floor %s (above the only tutor): %s', hi_sub, case when j->>'case' = 'no_subject' then 'ok' else 'FAIL ' || j::text end) || E'\n';

  -- no time chosen
  j := public.no_tutor_reason('Quillology', 'Grade 10', null, null);
  r := r || format('N17 no time chosen and a tutor teaches it: %s', case when j->>'case' = 'ok' then 'ok' else 'FAIL ' || j::text end) || E'\n';
  j := public.no_tutor_reason('Zzyzology', 'Grade 10', null, null);
  r := r || format('N17b no time chosen and nobody teaches it: %s', case when j->>'case' = 'no_subject' then 'ok' else 'FAIL ' || j::text end) || E'\n';

  -- a request being charged for blocks the tutor too (as tutor_free_problem does): A is being charged for 13:00-14:00
  reset role;
  begin
    insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, tutor_id)
      values (v_l, e_l, v_l, ((m1 + time '13:00') at time zone tz), 1, 'pending', 'charging', 'nt_q1', '1A', 1, 50, v_a);
    perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
    set local role authenticated;
    j := public.no_tutor_reason('Quillology', 'Grade 10', (m1 + time '13:00') at time zone tz, 1);
    w := j->'windows'->1;
    r := r || format('N18 a request being charged: 13:00 is not free, and the windows are 09-11, 12-13, 14-15: %s',
           case when j->>'case' = 'other_time' and (j->'windows'->0)->>'to' = '11:00' and w->>'from' = '12:00' and w->>'to' = '13:00' and (j->'windows'->2)->>'from' = '14:00' and (j->'windows'->2)->>'to' = '15:00' then 'ok' else 'FAIL ' || j::text end) || E'\n';
    reset role;
  exception when others then
    reset role;
    r := r || format('N18 FAIL the charging fixture or call failed: %s', sqlerrm) || E'\n';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;

  -- the SAME rules as matching: for a spread of questions, "ok" holds exactly when available_price_levels (the price screen's count) finds a tutor
  n2 := 0; k := 0;
  foreach a in array array['Quillology|Grade 10|10:00|1','Quillology|Grade 10|10:30|1','Quillology|Grade 10|11:00|1','Quillology|Grade 10|12:00|1','Quillology|Grade 10|09:00|3',
                           'Quillology|Grade 3|10:00|1','Fennology|Grade 10|09:00|1','Hollowology|Grade 10|10:00|1','Pendingology|Grade 10|10:00|1','Gadology|Grade 10|10:00|1',
                           'Gadology|Grade 10|03:00|2','Zzyzology|Grade 10|10:00|1'] loop
    st := ((m1 + split_part(a, '|', 3)::time) at time zone tz);
    j := public.no_tutor_reason(split_part(a, '|', 1), split_part(a, '|', 2), st, split_part(a, '|', 4)::numeric);
    select count(*) into n from public.available_price_levels(split_part(a, '|', 1), split_part(a, '|', 2), null, st, split_part(a, '|', 4)::numeric, null);
    k := k + 1;
    if (j->>'case' = 'ok') <> (n > 0) then
      n2 := n2 + 1;
      r := r || format('N19 FAIL %s: reason says %s but the price count is %s', a, j->>'case', n) || E'\n';
    end if;
  end loop;
  r := r || format('N19 parity with available_price_levels on %s questions: %s', k, case when n2 = 0 then 'ok' else 'FAIL ' || n2 || ' differ' end) || E'\n';

  -- never promise what matching refuses: every window start is accepted by the price count
  n2 := 0; k := 0;
  foreach a in array array['Quillology|11:00|1','Quillology|09:00|3','Quillology|11:00|2'] loop
    j := public.no_tutor_reason(split_part(a, '|', 1), 'Grade 10', ((m1 + split_part(a, '|', 2)::time) at time zone tz), split_part(a, '|', 3)::numeric);
    for w in select x from jsonb_array_elements(j->'windows') x loop
      st := ((w->>'date')::date + (w->>'from')::time) at time zone tz;
      select count(*) into n from public.available_price_levels(split_part(a, '|', 1), 'Grade 10', null, st, split_part(a, '|', 3)::numeric, null);
      k := k + 1;
      if n = 0 then n2 := n2 + 1; r := r || format('N20 FAIL window %s %s is refused by matching', w->>'date', w->>'from') || E'\n'; end if;
    end loop;
  end loop;
  r := r || format('N20 every one of %s windows is accepted by matching: %s', k, case when n2 = 0 and k > 0 then 'ok' else 'FAIL ' || n2 end) || E'\n';

  -- only time frames come out: no name, no id, no count
  j := public.no_tutor_reason('Quillology', 'Grade 10', (m1 + time '11:00') at time zone tz, 1);
  select string_agg(k2, ',' order by k2) into got from jsonb_object_keys(j) k2;
  r := r || format('N21 the answer has only these keys: %s', case when got = 'case,windows' then 'ok' else 'FAIL ' || got end) || E'\n';
  select string_agg(distinct k2, ',' order by k2) into got from jsonb_array_elements(j->'windows') x, jsonb_object_keys(x) k2;
  r := r || format('N21b a window has only these keys: %s', case when got = 'date,end_date,from,place,to' then 'ok' else 'FAIL ' || got end) || E'\n';
  r := r || format('N21c no tutor name or id appears in the answer: %s', case when position('Alpha' in j::text) = 0 and position(v_a::text in j::text) = 0 and position('Quillology' in j::text) = 0 then 'ok' else 'FAIL' end) || E'\n';

  -- who may call it
  reset role;
  set local role anon;
  begin
    perform public.no_tutor_reason('Quillology', 'Grade 10', null, null);
    r := r || 'N22 FAIL a signed-out caller ran it' || E'\n';
  exception when others then r := r || format('N22 a signed-out caller is refused: %s', sqlerrm) || E'\n'; end;
  reset role;
  select (p.provolatile = 's' and p.prosecdef and p.proconfig::text like '%search_path=public%')::text into got
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = 'no_tutor_reason';
  r := r || format('N23 the function is read-only (stable), security definer and pins its search path: %s', case when got = 'true' then 'ok' else 'FAIL ' || coalesce(got, 'missing') end) || E'\n';
  select count(*) into n from information_schema.routine_privileges where specific_schema = 'public' and routine_name = 'no_tutor_reason' and grantee in ('anon', 'PUBLIC');
  r := r || format('N24 no execute right for anon or public: %s', case when n = 0 then 'ok' else 'FAIL ' || n end) || E'\n';
  exception when others then
    reset role;
    r := r || format('STOPPED EARLY by an unexpected error: %s', sqlerrm) || E'\n';
  end;

  -- The Supabase tool cuts the middle of a long error, so each report line is shortened to its id and its value (the part after the
  -- first ": "; a FAIL or STOPPED line stays whole) and the whole report fits in one error. The FAIL count counts whole lines.
  select count(*) filter (where l like '%FAIL%' or l like 'STOPPED%'), count(*) filter (where l <> '')
    into nfail, nlines from regexp_split_to_table(r, E'\n') as l;
  select string_agg(case when l like '%FAIL%' or l like 'STOPPED%' then l else regexp_replace(l, '^(\S+) [^:]*: ', E'\\1 ') end, E'\n' order by o)
    into rep from regexp_split_to_table(r, E'\n') with ordinality as x(l, o) where l <> '';
  if coalesce(current_setting('test.runner', true), '') = 'on' then
    perform set_config('test.report', format(E'NO TUTOR REASON TEST (rolled back): %s FAIL line(s) in %s lines\n%s', nfail, nlines, rep), true);
  else
    raise exception E'NO TUTOR REASON TEST (rolled back): % FAIL line(s) in % lines\n%', nfail, nlines, rep;
  end if;
end $$;
