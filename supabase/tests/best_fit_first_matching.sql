-- Rolled-back test of best-fit-first matching with the 5-minute widening (CEO, 19 Oct 2026; migration 20261019120000). See README.md.
-- Run it TOGETHER with the migration in one statement (scripts/run-rolled-back-test.mjs <out> this-file the-migration) before the
-- migration is applied, or on its own after. Every line ends "ok" or "FAIL (want ...)"; the first line gives the count.
-- All fixtures use the subject "Zorology" so the real tutors on dev cannot change a count or an inbox.
-- Time is not faked: a request made "now" is inside its 5 minutes; "after 5 minutes" is made by moving its created_at back 6 minutes.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  v_l uuid := gen_random_uuid();       -- an adult learner
  v_a uuid := gen_random_uuid();       -- A: CAPS, approved, every day all day: the best fit for a CAPS school
  v_b uuid := gen_random_uuid();       -- B: IEB, approved, every day all day: not a curriculum fit, free
  v_c uuid := gen_random_uuid();       -- C: CAPS, approved, Mondays 09:00-12:00 only
  v_d uuid := gen_random_uuid();       -- D: CAPS, NOT approved, every day all day
  v_e uuid := gen_random_uuid();       -- E: CAPS, approved for Grade 8 to 9 only, every day all day
  v_f uuid := gen_random_uuid();       -- F: CAPS, approved, every day all day, but tied to a different school (s2)
  v_g uuid := gen_random_uuid();       -- G: IEB, approved, every day all day, but has a session Monday 10:00-11:00
  v_h uuid := gen_random_uuid();       -- H: IEB, approved, every day all day, level 2A
  tt uuid[];
  c_caps uuid; c_ieb uuid; s1 uuid; s2 uuid; e_l uuid; tier2 integer;
  mon date := (date_trunc('week', now() at time zone 'Africa/Johannesburg') + interval '14 days')::date;   -- a Monday, 1 to 2 weeks ahead
  t10 timestamptz; t13 timestamptz; t14 timestamptz; tue10 timestamptz; tue11 timestamptz; wed10 timestamptz;
  q1 uuid; q2 uuid; q3 uuid; q4 uuid; q5 uuid; q5b uuid; q6 uuid; q7 uuid;
  n int; t text; u uuid;
  nfail int; nlines int; rep text;
begin
  begin   -- everything below; an unexpected error is reported with the lines before it instead of hiding them

  -- ---- small helpers, kept in this transaction only -----------------------------------------------------------------------------
  execute $mk$
    create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
      select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
             || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
    $f$ $mk$;
  -- how many of the tutors, in order, see this request in their inbox
  execute $mk$
    create function pg_temp.inbox(p_q uuid, p_tutors uuid[]) returns text language plpgsql as $f$
    declare x uuid; n int; s text := '';
    begin
      foreach x in array p_tutors loop
        perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
        set local role authenticated;
        select count(*) into n from public.available_requests_for_tutor() where id = p_q;
        reset role;
        s := s || n || ' ';
      end loop;
      return btrim(s);
    end $f$ $mk$;
  -- the live accept (what the Worker calls), then the older accept (called as the owner with the tutor's identity)
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
    create function pg_temp.try_accept(p_q uuid, p_u uuid) returns text language plpgsql as $f$
    declare s uuid;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true);
      begin
        s := public.accept_session_request(p_q);
        return 'accepted';
      exception when others then
        return sqlerrm;
      end;
    end $f$ $mk$;

  t10 := (mon + time '10:00') at time zone 'Africa/Johannesburg';
  t13 := (mon + time '13:00') at time zone 'Africa/Johannesburg';
  t14 := (mon + time '14:00') at time zone 'Africa/Johannesburg';
  tue10 := (mon + 1 + time '10:00') at time zone 'Africa/Johannesburg';
  tue11 := (mon + 1 + time '11:00') at time zone 'Africa/Johannesburg';
  wed10 := (mon + 2 + time '10:00') at time zone 'Africa/Johannesburg';
  select id into c_caps from curricula where code = 'CAPS';
  select id into c_ieb from curricula where code = 'IEB';
  select tier_id into tier2 from sub_tier_definitions where id = '2A';

  -- ---- people, schools, subjects, hours -------------------------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_l, z,'authenticated','authenticated','b.l.'||v_l||'@example.invalid', jsonb_build_object('role','student','first_name','Lee','date_of_birth',adult), '{}'),
    (v_a, z,'authenticated','authenticated','b.a.'||v_a||'@example.invalid', jsonb_build_object('role','tutor','first_name','Alpha','date_of_birth',adult), '{}'),
    (v_b, z,'authenticated','authenticated','b.b.'||v_b||'@example.invalid', jsonb_build_object('role','tutor','first_name','Bravo','date_of_birth',adult), '{}'),
    (v_c, z,'authenticated','authenticated','b.c.'||v_c||'@example.invalid', jsonb_build_object('role','tutor','first_name','Charlie','date_of_birth',adult), '{}'),
    (v_d, z,'authenticated','authenticated','b.d.'||v_d||'@example.invalid', jsonb_build_object('role','tutor','first_name','Delta','date_of_birth',adult), '{}'),
    (v_e, z,'authenticated','authenticated','b.e.'||v_e||'@example.invalid', jsonb_build_object('role','tutor','first_name','Echo','date_of_birth',adult), '{}'),
    (v_f, z,'authenticated','authenticated','b.f.'||v_f||'@example.invalid', jsonb_build_object('role','tutor','first_name','Foxtrot','date_of_birth',adult), '{}'),
    (v_g, z,'authenticated','authenticated','b.g.'||v_g||'@example.invalid', jsonb_build_object('role','tutor','first_name','Golf','date_of_birth',adult), '{}'),
    (v_h, z,'authenticated','authenticated','b.h.'||v_h||'@example.invalid', jsonb_build_object('role','tutor','first_name','Hotel','date_of_birth',adult), '{}');
  tt := array[v_a, v_b, v_c, v_d, v_e, v_f, v_g, v_h];
  update profiles set date_of_birth = adult::date where id = any (tt);
  update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null, is_verified = true where id = any (tt);
  update tutor_profiles set current_tier_id = tier2, current_sub_tier_id = '2A' where id = v_h;

  insert into schools_institutions (name, curriculum, curriculum_id) values ('ZZ Test CAPS school', 'caps', c_caps) returning id into s1;
  insert into schools_institutions (name, curriculum, curriculum_id) values ('ZZ Test other school', 'caps', c_caps) returning id into s2;
  update tutor_profiles set institution_id = s2 where id = v_f;

  insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status) values
    (v_a, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified'),
    (v_b, 'Zorology', 'ieb',  'Grade 8', 'Grade 12', 'verified'),
    (v_c, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified'),
    (v_d, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'pending'),
    (v_e, 'Zorology', 'caps', 'Grade 8', 'Grade 9',  'verified'),
    (v_f, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified'),
    (v_g, 'Zorology', 'ieb',  'Grade 8', 'Grade 12', 'verified'),
    (v_h, 'Zorology', 'ieb',  'Grade 8', 'Grade 12', 'verified');
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time)
    select x, d, '00:00', '24:00' from unnest(array[v_a, v_b, v_d, v_e, v_f, v_g, v_h]) x, generate_series(0, 6) d;
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) values (v_c, 1, '09:00', '12:00');
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_l, 'Zorology', 'Grade 10') returning id into e_l;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, duration_hours, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status, enrollment_id)
    values (v_l, v_g, v_l, t10, 1, 50, 30, 50, 35, 'scheduled', e_l);
  select count(*) into n from tutor_availability where tutor_id = any (tt);
  r := r || pg_temp.chk('B0', 'setup, weekly hour rows', n::text, '50');
  r := r || pg_temp.chk('B0b', 'the 5 minutes is one setting, 5 by default', round(extract(epoch from public.request_widen_interval()) / 60)::int::text, '5');

  -- ---- requests: all made "now" except where said ------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, t10, 1, 'pending', 'paid', 'bf_q1', '1A', 1, 50, s1) returning id into q1;           -- Monday 10:00, CAPS school
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, t13, 1, 'pending', 'paid', 'bf_q2', '1A', 1, 50, s1) returning id into q2;           -- Monday 13:00, CAPS school
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, t10, 1, 'pending', 'paid', 'bf_q3', '2A', tier2, 80, s1) returning id into q3;       -- Monday 10:00 at level 2A
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, tue10, 1, 'pending', 'paid', 'bf_q4', '1A', 1, 50, s1) returning id into q4;         -- Tuesday 10:00 (for the older accept)
  -- "book again" requests, made 6 minutes ago: one to B (IEB, not a curriculum fit), one to A (a fit)
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id, requested_tutor_id, created_at)
    values (v_l, e_l, v_l, t14, 1, 'pending', 'paid', 'bf_q5', '1A', 1, 50, s1, v_b, now() - interval '6 minutes') returning id into q5;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id, requested_tutor_id, created_at)
    values (v_l, e_l, v_l, t14, 1, 'pending', 'paid', 'bf_q5b', '1A', 1, 50, s1, v_a, now() - interval '6 minutes') returning id into q5b;

  -- ---- INSIDE the first 5 minutes: only the tutors who fit it all (A, and C who is also free at 10:00) ----------------------------------
  -- order of tutors in every line: A B C D E F G H
  r := r || pg_temp.chk('B1', 'inside 5 minutes, Monday 10:00 CAPS school, who sees it (A B C D E F G H)', pg_temp.inbox(q1, tt), '1 0 1 0 0 0 0 0');
  r := r || pg_temp.chk('B2', 'inside 5 minutes, Monday 13:00 (C works until 12:00)', pg_temp.inbox(q2, tt), '1 0 0 0 0 0 0 0');
  r := r || pg_temp.chk('B3', 'inside 5 minutes, a 2A request, nobody at 2A fits the curriculum', pg_temp.inbox(q3, tt), '0 0 0 0 0 0 0 0');
  r := r || pg_temp.chk('B4', 'inside 5 minutes, B (IEB) cannot accept a CAPS school''s request', pg_temp.try_claim(q1, v_b), 'This request is for a curriculum you aren''t approved for.');
  r := r || pg_temp.chk('B5', 'inside 5 minutes, F (tied to another school) cannot accept it', pg_temp.try_claim(q1, v_f), 'This request is for a different institution.');
  r := r || pg_temp.chk('B6', 'inside 5 minutes, the older accept path refuses B too', pg_temp.try_accept(q4, v_b), 'This request is for a curriculum you aren''t approved for.');

  -- ---- the price counts: who could take a request once it has widened (school and curriculum do not narrow) --------------------------
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 10', s1);
  r := r || pg_temp.chk('B7', 'counts, old three-value call, no time (A B C F G H; D not approved, E wrong grade)', n::text, '6');
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 10', s1, null, null, c_ieb);
  r := r || pg_temp.chk('B7b', 'counts, a curriculum answer no longer narrows them', n::text, '6');
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 10', null);
  r := r || pg_temp.chk('B7c', 'counts, no school gives the same', n::text, '6');
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 10', s1, t10, 1);
  r := r || pg_temp.chk('B8', 'counts, Monday 10:00 for an hour (G is busy)', n::text, '5');
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 10', s1, t13, 1);
  r := r || pg_temp.chk('B8b', 'counts, Monday 13:00 (C is outside hours, G is free)', n::text, '5');
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 9', s1);
  r := r || pg_temp.chk('B9', 'counts, Grade 9 (E teaches Grade 8 to 9, so E counts)', n::text, '7');
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 4', s1);
  r := r || pg_temp.chk('B9b', 'counts, a grade in the list that nobody teaches', n::text, '0');
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 10', s1, t10, 1) where level_id = '2A';
  r := r || pg_temp.chk('B10', 'counts, the 2A level counts only tutors at 2A or above', n::text, '1');

  -- ---- AFTER 5 minutes: the first four requests are made 6 minutes old ---------------------------------------------------------------
  update session_requests set created_at = now() - interval '6 minutes' where id in (q1, q2, q3, q4);
  r := r || pg_temp.chk('B11', 'after 5 minutes, Monday 10:00, who sees it (A B C D E F G H)', pg_temp.inbox(q1, tt), '1 1 1 0 0 1 0 1');
  r := r || pg_temp.chk('B12', 'after 5 minutes, Monday 13:00 (C outside hours still never; G now free)', pg_temp.inbox(q2, tt), '1 1 0 0 0 1 1 1');
  r := r || pg_temp.chk('B13', 'after 5 minutes, the 2A request: only the 2A tutor (level still enforced)', pg_temp.inbox(q3, tt), '0 0 0 0 0 0 0 1');
  r := r || pg_temp.chk('B14', 'after 5 minutes, D (subject not approved) cannot accept', pg_temp.try_claim(q1, v_d), 'Tutorlage hasn''t approved this subject for you yet.');
  r := r || pg_temp.chk('B15', 'after 5 minutes, E (wrong grade) cannot accept', pg_temp.try_claim(q1, v_e), 'This request is for a grade outside the range you teach.');
  r := r || pg_temp.chk('B16', 'after 5 minutes, G (a session at that time) cannot accept', pg_temp.try_claim(q1, v_g), 'You already have a session at that time.');
  r := r || pg_temp.chk('B17', 'after 5 minutes, C (outside their hours) cannot accept the 13:00 one', pg_temp.try_claim(q2, v_c), 'This session is outside your weekly working hours.');
  r := r || pg_temp.chk('B18', 'after 5 minutes, A (level 1A) still cannot accept a 2A request', pg_temp.try_claim(q3, v_a), 'This request is for a higher level than yours.');
  r := r || pg_temp.chk('B19', 'after 5 minutes, B (IEB, not a fit) can accept the Monday 10:00 request', pg_temp.try_claim(q1, v_b), 'accepted (already_paid)');
  r := r || pg_temp.chk('B20', 'after 5 minutes, F (another school) can accept the 13:00 one', pg_temp.try_claim(q2, v_f), 'accepted (already_paid)');
  r := r || pg_temp.chk('B21', 'after 5 minutes, the older accept path takes the Tuesday one for B', pg_temp.try_accept(q4, v_b), 'accepted');
  r := r || pg_temp.chk('B22', 'once taken, nobody else is shown or can accept it', pg_temp.inbox(q1, tt) || ' / ' || pg_temp.try_claim(q1, v_a),
                        '0 0 0 0 0 0 0 0 / Another tutor already accepted this request, or it is no longer available.');

  -- ---- "book again" requests (sent to one tutor) are exactly as before, even when old -------------------------------------------------
  r := r || pg_temp.chk('B23', 'a request sent to B is not widened (B is not a curriculum fit, so B does not see it, nor does anyone else)', pg_temp.inbox(q5, tt), '0 0 0 0 0 0 0 0');
  r := r || pg_temp.chk('B24', 'B is asked but is not approved for CAPS: still refused after 5 minutes', pg_temp.try_claim(q5, v_b), 'This request is for a curriculum you aren''t approved for.');
  r := r || pg_temp.chk('B25', 'another tutor cannot take a request sent to B', pg_temp.try_claim(q5, v_a), 'Another tutor already accepted this request, or it is no longer available.');
  r := r || pg_temp.chk('B26', 'a request sent to A: only A sees it', pg_temp.inbox(q5b, tt), '1 0 0 0 0 0 0 0');

  -- ---- a resend ("try someone else": resent_from is set) is open to everyone from the start ------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id, resent_from)
    values (v_l, e_l, v_l, tue11, 1, 'pending', 'paid', 'bf_q6', '1A', 1, 50, s1, q5b) returning id into q6;
  r := r || pg_temp.chk('B27', 'a resend, made just now, already shows to B and the other free tutors (A B C D E F G H)', pg_temp.inbox(q6, tt), '1 1 0 0 0 1 1 1');

  -- the rules that stay: an expired request, and a tutor's own request
  update session_requests set expires_at = now() - interval '1 minute' where id = q6;
  r := r || pg_temp.chk('B27b', 'an expired request is shown to nobody and cannot be accepted', pg_temp.inbox(q6, tt) || ' / ' || pg_temp.try_claim(q6, v_a),
                        '0 0 0 0 0 0 0 0 / Another tutor already accepted this request, or it is no longer available.');
  perform set_config('request.jwt.claims', '', true);
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id, created_at)
    values (v_l, e_l, v_a, wed10, 1, 'pending', 'paid', 'bf_q7', '1A', 1, 50, s1, now() - interval '6 minutes') returning id into q7;   -- booked by tutor A
  r := r || pg_temp.chk('B27c', 'a widened request is not shown to the tutor who booked it (A B C D E F G H)', pg_temp.inbox(q7, tt), '0 1 0 0 0 1 1 1');
  r := r || pg_temp.chk('B27d', 'and that tutor cannot accept it', pg_temp.try_claim(q7, v_a), 'You can''t accept your own request.');

  -- ---- the 5 minutes is one setting ----------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('B28', 'exactly 5 minutes old counts as widened, 4 minutes 59 does not',
                        public.request_is_widened(null, now() - interval '5 minutes', null)::text || ' / ' || public.request_is_widened(null, now() - interval '299 seconds', null)::text, 'true / false');
  r := r || pg_temp.chk('B29', 'a request sent to a tutor is never widened', public.request_is_widened(v_a, now() - interval '1 day', null)::text, 'false');
  update system_settings set setting_value = '10'::jsonb where setting_key = 'request_widen_after_minutes';
  r := r || pg_temp.chk('B30', 'the setting at 10 minutes, a request 6 minutes old', public.request_is_widened(null, now() - interval '6 minutes', null)::text, 'false');
  update system_settings set setting_value = '3'::jsonb where setting_key = 'request_widen_after_minutes';
  r := r || pg_temp.chk('B31', 'the setting at 3 minutes, a request 4 minutes old', public.request_is_widened(null, now() - interval '4 minutes', null)::text, 'true');
  update system_settings set setting_value = '"soon"'::jsonb where setting_key = 'request_widen_after_minutes';
  r := r || pg_temp.chk('B32', 'a setting that is not a number falls back to 5', round(extract(epoch from public.request_widen_interval()) / 60)::int::text, '5');
  update system_settings set setting_value = '5'::jsonb where setting_key = 'request_widen_after_minutes';

  -- ---- the helpers cannot be called from the app ---------------------------------------------------------------------------------------
  t := '';
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.request_is_widened(null, now(), null); t := t || 'widened-allowed '; exception when others then t := t || 'widened-refused '; end;
  begin perform public.request_widen_interval(); t := t || 'interval-allowed'; exception when others then t := t || 'interval-refused'; end;
  reset role;
  r := r || pg_temp.chk('B33', 'a signed-in user cannot call the two new helpers', t, 'widened-refused interval-refused');
  set local role anon;
  select coalesce(max(tutors), 0) into n from available_price_levels('Zorology', 'Grade 10', s1);
  reset role;
  r := r || pg_temp.chk('B34', 'a signed-out visitor can still ask for the counts', n::text, '6');

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
    perform set_config('test.report', format(E'BEST-FIT-FIRST TEST (rolled back): %s FAIL line(s) in %s lines\n%s', nfail, nlines, rep), true);
  else
    raise exception E'BEST-FIT-FIRST TEST (rolled back): % FAIL line(s) in % lines\n%', nfail, nlines, rep;
  end if;
end $$;
