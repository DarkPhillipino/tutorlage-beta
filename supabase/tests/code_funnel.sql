-- THE CODES FUNNEL (R12) AND THE TUTOR ACTIVATION LIST (R13), database suite (28 checks, F01 to F17 and G01 to G11). Read supabase/tests/README.md first.
-- RUN IT AFTER 20261111130000_code_funnel_and_tutor_activation.sql is applied (and the promo, wallet, tutor-bonus and founding-list migrations before it): paste this one file whole
-- into the Supabase execute_sql tool.
-- ONE statement. It makes made-up people (example.invalid, first names starting Zz), a made-up school, the subject "Zorology" and codes starting ZZ, acts as them, and ends with an
-- error on purpose, which rolls EVERYTHING back (nothing is kept, nothing is sent). The verdict is the END of the error text: "RESULT code funnel: N of 28 checks ran, M FAIL" then
-- "FAILING: <names>".
-- It also empties the page counter's code_open events INSIDE the transaction (to prove the "not counted yet" state); the rollback puts them back.
-- Real data cannot change a result: every check reads the made-up codes, tutors and families by their own ids, except two on purpose: the baseline (it compares the numbers before and
-- after the made-up families, so it only reads the change) and the totals row (it must equal the sum of the code rows, whatever they are).
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  tz constant text := 'Africa/Johannesburg';
  today date := (now() at time zone 'Africa/Johannesburg')::date;
  adult text := (current_date - interval '30 years')::date::text;
  minor text := (current_date - interval '10 years')::date::text;
  a_fin uuid := gen_random_uuid(); a_spt uuid := gen_random_uuid();
  v_o uuid := gen_random_uuid();    -- a tutor with a personal code, approved 20 days ago, no subjects and no hours yet
  v_t uuid := gen_random_uuid();    -- the teacher: subject and hours, approved 2 days ago
  v_n uuid := gen_random_uuid();    -- approved with no approval record (an older approval): the date is unknown
  v_h uuid := gen_random_uuid();    -- approved 9 days ago, subject and hours saved, never takes a request
  fa1 uuid := gen_random_uuid(); fa2 uuid := gen_random_uuid(); fa3 uuid := gen_random_uuid(); fb1 uuid := gen_random_uuid(); fo1 uuid := gen_random_uuid(); fn1 uuid := gen_random_uuid();
  ca1 uuid := gen_random_uuid(); cb1 uuid := gen_random_uuid(); co1 uuid := gen_random_uuid();
  ea1 uuid; eb1 uuid; eo1 uuid;
  k_a uuid; k_b uuid; k_o uuid; c_caps uuid; s1 uuid;
  qa1 uuid; qa2 uuid; qa3 uuid; qa4 uuid; qb1 uuid; qo1 uuid; qx uuid;
  v1 uuid := gen_random_uuid(); v2 uuid := gen_random_uuid(); v3 uuid := gen_random_uuid(); v4 uuid := gen_random_uuid(); v5 uuid := gen_random_uuid();
  j jsonb; jt jsonb; jo jsonb; jw jsonb; j5 jsonb; jb0 jsonb; g jsonb; g0 jsonb;
  t text; t2 text; nfail int; nlines int; rep text; okids text; failnames text;
begin
  begin   -- everything below; an unexpected error is reported with the lines before it instead of hiding them

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
        return 'accepted (' || (j->>'mode') || ')';
      exception when others then
        reset role;
        return sqlerrm;
      end;
    end $f$ $mk$;
  execute $mk$ create function pg_temp.nxt() returns int language sql as $f$
      select set_config('test.sl', (coalesce(nullif(current_setting('test.sl', true), ''), '0')::int + 1)::text, true)::int $f$ $mk$;
  execute $mk$
    create function pg_temp.slot(n int) returns timestamptz language sql as $f$
      select ((date_trunc('week', now() at time zone 'Africa/Johannesburg') + interval '14 days')::date + (n / 6) + time '08:00' + (n % 6) * interval '2 hours') at time zone 'Africa/Johannesburg' $f$ $mk$;
  execute $mk$
    create function pg_temp.mkreq(p_by uuid, p_stu uuid, p_enr uuid, p_price numeric, p_level text, p_tier int) returns uuid language plpgsql as $f$
    declare v uuid;
    begin
      insert into public.session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference,
             min_sub_tier_id, tier_id, charged_amount, institution_id, requested_tutor_id, expires_at, currency_code)
      values (p_stu, p_enr, p_by, pg_temp.slot(pg_temp.nxt()), 1, 'pending', 'initiated', 'cf_' || gen_random_uuid(), p_level, p_tier, p_price,
              (select id from public.schools_institutions where name = 'ZZ Funnel test school'), null, null, 'ZAR')
      returning id into v;
      return v;
    end $f$ $mk$;
  execute $mk$
    create function pg_temp.send(p_u uuid, p_q uuid) returns text language sql as $f$
      select pg_temp.run_as(p_u, format('select concat_ws(''/'', x->>''held_rand'', x->>''discount_rand'', x->>''available_rand'') from (select public.send_request_wallet(%L) as x) s', p_q)) $f$ $mk$;
  execute $mk$ create function pg_temp.top(p_profile uuid, p_amount int) returns void language sql as $f$
      select public.wallet_post(p_profile, 'topup', p_amount, 0, 'cf-top:' || gen_random_uuid(), null, 'test top-up') $f$ $mk$;
  execute $mk$ create function pg_temp.sess(p_q uuid) returns uuid language sql as $f$
      select resulting_session_id from public.session_requests where id = p_q $f$ $mk$;
  execute $mk$ create function pg_temp.pin(p_t uuid, p_level text) returns void language sql as $f$
      update public.tutor_profiles set current_tier_id = (select tier_id from public.sub_tier_definitions where id = p_level), current_sub_tier_id = p_level where id = p_t $f$ $mk$;
  -- completing a lesson re-levels a made-up tutor, so the level is pinned again before each claim
  execute $mk$ create function pg_temp.done(p_s uuid) returns void language plpgsql as $f$
      begin update public.sessions set scheduled_start = now() - interval '3 hours' where id = p_s; update public.sessions set status = 'completed', completed_at = now() where id = p_s; end $f$ $mk$;
  -- one lesson, booked and accepted: the request is made, sent from the payer's wallet, the teacher is pinned at 4D and takes it
  execute $mk$ create function pg_temp.lesson(p_payer uuid, p_stu uuid, p_enr uuid, p_price numeric, p_level text, p_tier int, p_teacher uuid) returns uuid language plpgsql as $f$
    declare v uuid; x text;
    begin
      v := pg_temp.mkreq(p_payer, p_stu, p_enr, p_price, p_level, p_tier);
      x := pg_temp.send(p_payer, v);
      perform pg_temp.pin(p_teacher, '4D');
      x := x || ' ' || pg_temp.try_claim(v, p_teacher);
      perform set_config('test.last', x, true);
      return v;
    end $f$ $mk$;
  execute $mk$ create function pg_temp.setting(p_key text, p_val text) returns void language sql as $f$
      update public.system_settings set setting_value = p_val::jsonb where setting_key = p_key $f$ $mk$;
  -- the funnel and the activation list, as a finance admin, as JSON (an error is raised with its text so the report shows it)
  execute $mk$ create function pg_temp.fun(p_as uuid, p_f date, p_t date) returns jsonb language plpgsql as $f$
    declare v text;
    begin
      v := pg_temp.run_as(p_as, format('select public.admin_code_funnel(%L, %L)::text', p_f, p_t));
      if v like 'ERR:%' then raise exception '%', v; end if;
      return v::jsonb;
    end $f$ $mk$;
  execute $mk$ create function pg_temp.act(p_as uuid, p_days int) returns jsonb language plpgsql as $f$
    declare v text;
    begin
      v := pg_temp.run_as(p_as, format('select public.admin_tutor_activation(%L)::text', p_days));
      if v like 'ERR:%' then raise exception '%', v; end if;
      return v::jsonb;
    end $f$ $mk$;
  -- one count of one code in a funnel answer ('0' when the code has none of that kind), one top-level field of a code row, and one tutor row of the activation list
  execute $mk$ create function pg_temp.kv(j jsonb, p_code text, p_kind text) returns text language sql as $f$
      select coalesce((select x -> 'k' ->> p_kind from jsonb_array_elements(j -> 'codes') x where x ->> 'code' = p_code), '0') $f$ $mk$;
  execute $mk$ create function pg_temp.cf(j jsonb, p_code text, p_field text) returns text language sql as $f$
      select coalesce((select x ->> p_field from jsonb_array_elements(j -> 'codes') x where x ->> 'code' = p_code), 'NO SUCH CODE') $f$ $mk$;
  execute $mk$ create function pg_temp.trow(j jsonb, p_id uuid) returns jsonb language sql as $f$
      select x from jsonb_array_elements(j -> 'tutors') x where x ->> 'tutor_id' = p_id::text $f$ $mk$;

  -- ---- people: two admins, four tutors, a school and the subject ----------------------------------------------------------------------------------------------------------------------
  select id into c_caps from curricula where code = 'CAPS';
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (a_fin, z, 'authenticated', 'authenticated', 'cf.a1.' || a_fin || '@example.invalid', '{}'::jsonb, '{}'),
    (a_spt, z, 'authenticated', 'authenticated', 'cf.a2.' || a_spt || '@example.invalid', '{}'::jsonb, '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (a_fin, 'Fin', 'Manager', 'cf.a1.' || a_fin || '@example.invalid', '', 'finance_manager', true),
    (a_spt, 'Spt', 'Agent', 'cf.a2.' || a_spt || '@example.invalid', '', 'support_agent', true);
  update system_settings set setting_value = 'false'::jsonb where setting_key = 'free_sessions_enabled';
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'wallet_payments_enabled';
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_o, z, 'authenticated', 'authenticated', 'cf.o.' || v_o || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zzquo', 'date_of_birth', adult, 'phone_number', '082 777 8888'), '{}'),
    (v_t, z, 'authenticated', 'authenticated', 'cf.t.' || v_t || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zzteach', 'date_of_birth', adult), '{}'),
    (v_n, z, 'authenticated', 'authenticated', 'cf.n.' || v_n || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zznone', 'date_of_birth', adult), '{}'),
    (v_h, z, 'authenticated', 'authenticated', 'cf.h.' || v_h || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zzhalf', 'date_of_birth', adult), '{}');
  update profiles set date_of_birth = adult::date where id in (v_o, v_t, v_n, v_h);
  update tutor_profiles set current_tier_id = 2, current_sub_tier_id = '2C', institution_id = null, is_verified = true where id in (v_o, v_n, v_h);
  update tutor_profiles set current_tier_id = 4, current_sub_tier_id = '4D', institution_id = null, is_verified = true where id = v_t;
  insert into tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
    select tt, 'police_clearance'::public.doc_type, 'fixture/police-' || tt, 'verified'::public.verification_status, (now() at time zone tz)::date from unnest(array[v_t, v_h]) tt;
  insert into schools_institutions (name, curriculum, curriculum_id) values ('ZZ Funnel test school', 'caps', c_caps) returning id into s1;
  insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
    select tt, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified' from unnest(array[v_t, v_h]) tt;
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) select tt, d, '00:00', '24:00' from unnest(array[v_t, v_h]) tt, generate_series(0, 6) d;
  -- the approval records (v_n has none: an older approval, date unknown). Approving a tutor stamps tutor_profiles.verified_at (the founding waves work), which is a second place
  -- the date can come from, so for v_n that stamp is cleared too (when the column exists; before that migration there is nothing to clear).
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tutor_profiles' and column_name = 'verified_at') then
    execute format('update public.tutor_profiles set verified_at = null where id = %L', v_n);
  end if;
  insert into admin_audit_logs (admin_id, action, target_entity_type, target_entity_id, created_at) values
    (a_fin, 'tutor_approved', 'tutor', v_o, now() - interval '20 days'),
    (a_fin, 'tutor_approved', 'tutor', v_t, now() - interval '2 days'),
    (a_fin, 'tutor_approved', 'tutor', v_h, now() - interval '9 days');
  r := r || 'S0 setup: 2 admins, 4 verified tutors, a made-up school and subject' || E'\n';

  -- ---- codes and families -----------------------------------------------------------------------------------------------------------------------------------------------------------------
  k_a := pg_temp.run_as(a_fin, $q$select public.admin_create_promo_code('ZZFUNA', 'funnel code A', 10, 3, null, null, null, null)::text$q$)::uuid;
  k_b := pg_temp.run_as(a_fin, $q$select public.admin_create_promo_code('ZZFUNB', 'funnel code B', 10, 3, null, null, null, null)::text$q$)::uuid;
  select id into k_o from promo_codes where owner_tutor_id = v_o;
  jb0 := pg_temp.fun(a_fin, today - 45, today);   -- the baseline BEFORE the made-up families
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (fa1, z, 'authenticated', 'authenticated', 'cf.fa1.' || fa1 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Zzpia', 'date_of_birth', adult, 'phone_number', '083 333 4441', 'signup_code', 'zzfuna'), '{}'),
    (fa2, z, 'authenticated', 'authenticated', 'cf.fa2.' || fa2 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Zzpam', 'date_of_birth', adult, 'phone_number', '083 333 4442', 'signup_code', 'ZZFUNA'), '{}'),
    (fa3, z, 'authenticated', 'authenticated', 'cf.fa3.' || fa3 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Zzpat', 'date_of_birth', adult, 'phone_number', '083 333 4443'), '{}'),
    (fb1, z, 'authenticated', 'authenticated', 'cf.fb1.' || fb1 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Zzpip', 'date_of_birth', adult, 'phone_number', '083 333 4444', 'signup_code', 'ZZFUNB'), '{}'),
    (fo1, z, 'authenticated', 'authenticated', 'cf.fo1.' || fo1 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Zzpru', 'date_of_birth', adult, 'phone_number', '083 333 4445', 'signup_code', 'zzquo'), '{}'),
    (fn1, z, 'authenticated', 'authenticated', 'cf.fn1.' || fn1 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Zzpol', 'date_of_birth', adult, 'phone_number', '083 333 4446'), '{}');
  update profiles set date_of_birth = adult::date where id in (fa1, fa2, fa3, fb1, fo1, fn1);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (ca1, z, 'authenticated', 'authenticated', 'cf.ca1.' || ca1 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Zzcai', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', fa1, 'relationship', 'mother')),
    (cb1, z, 'authenticated', 'authenticated', 'cf.cb1.' || cb1 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Zzcam', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', fb1, 'relationship', 'mother')),
    (co1, z, 'authenticated', 'authenticated', 'cf.co1.' || co1 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Zzcat', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', fo1, 'relationship', 'mother'));
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (ca1, 'Zorology', 'Grade 10') returning id into ea1;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (cb1, 'Zorology', 'Grade 10') returning id into eb1;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (co1, 'Zorology', 'Grade 10') returning id into eo1;
  perform pg_temp.top(fa1, 4000);
  perform pg_temp.top(fb1, 1000);
  perform pg_temp.top(fo1, 1000);
  -- fa3 came without a code; an admin attaches code A later (counted as a sign-up AND as an admin-attached one); fa2's code was attached 40 days ago
  t := pg_temp.run_as(a_fin, format('select public.admin_attach_promo_code(%L, %L, %L)::text', 'cf.fa3.' || fa3 || '@example.invalid', 'ZZFUNA', 'funnel test attach'));
  update profiles set promo_attached_at = now() - interval '40 days' where id = fa2;
  -- top-ups: fa1 two successful ones (the FIRST, 3 days ago, is the one that counts), fa2 one still waiting for its proof, fb1 one successful today
  insert into wallet_topups (profile_id, method, reference, amount_rand, status, received_rand, ledger_id, decided_at, created_at) values
    (fa1, 'eft', 'TL-ZZFA22', 500, 'successful', 500, gen_random_uuid(), now() - interval '3 days', now() - interval '3 days'),
    (fa1, 'eft', 'TL-ZZFA33', 500, 'successful', 500, gen_random_uuid(), now(), now()),
    (fb1, 'eft', 'TL-ZZFB22', 500, 'successful', 500, gen_random_uuid(), now(), now());
  insert into wallet_topups (profile_id, method, reference, amount_rand, status) values (fa2, 'eft', 'TL-ZZFA44', 500, 'awaiting_proof');
  r := r || 'S1 setup: codes A and B, the owner''s code, 6 families, 3 learners, top-ups' || E'\n';

  -- ---- the page counter: first empty (not counted yet), then made-up opens --------------------------------------------------------------------------------------------------------------
  delete from founding_page_events where event = 'code_open';   -- inside the transaction only; the rollback puts the real ones back
  j := pg_temp.fun(a_fin, today, today);
  r := r || pg_temp.chk('F01', 'before any link open is recorded the counter says it is not live, and no code shows an open', j ->> 'opens_counter' || ' / ' || pg_temp.cf(j, 'ZZFUNA', 'opens_ever') || ' ' || pg_temp.kv(j, 'ZZFUNA', 'open'), 'not_live / 0 0');
  insert into founding_page_events (visitor_id, event, src, first_src, created_at) values
    (v1, 'code_open', 'zzfuna', null, now() - interval '3 minutes'),
    (v1, 'code_open', 'zzfuna', null, now() - interval '2 minutes'),
    (v2, 'code_open', 'zzfuna', null, now() - interval '5 minutes'),
    (v2, 'code_open', 'zzfunb', null, now() - interval '1 minute'),
    (v3, 'code_open', 'zzfunb', null, now()),
    (v4, 'code_open', 'zzfuna', null, now() - interval '40 days'),
    (v5, 'code_open', 'zzquo', null, now()),
    (v5, 'open', 'zzfuna', null, now()),
    (gen_random_uuid(), 'code_open', 'zzunknownzz', null, now());
  j := pg_temp.fun(a_fin, today, today);
  r := r || pg_temp.chk('F02', 'code A today: 3 opens by 2 visitors (a visitor who opened it twice counts once; a page "open" event and an unknown code are not counted); 4 opens ever (one 40 days ago)',
    j ->> 'opens_counter' || ' / ' || pg_temp.kv(j, 'ZZFUNA', 'open') || ' ' || pg_temp.kv(j, 'ZZFUNA', 'visitor') || ' ' || pg_temp.cf(j, 'ZZFUNA', 'opens_ever'), 'live / 3 2 4');
  r := r || pg_temp.chk('F03', 'code B today: 2 opens, 1 visitor (the visitor who opened A first and then B counts for A only)', pg_temp.kv(j, 'ZZFUNB', 'open') || ' ' || pg_temp.kv(j, 'ZZFUNB', 'visitor') || ' ' || pg_temp.cf(j, 'ZZFUNB', 'opens_ever'), '2 1 2');

  -- ---- R13 before any lesson: how far each tutor has got -----------------------------------------------------------------------------------------------------------------------------
  g0 := pg_temp.act(a_fin, 7);
  jo := pg_temp.trow(g0, v_o);
  r := r || pg_temp.chk('G01', 'tutor with a code, approved 20 days ago, no subject and no hours: their code, 1 family, 1 open by 1 visitor; next step "subjects"; quiet; approval date known',
    concat_ws(' ', jo ->> 'code', jo ->> 'signups', jo ->> 'opens', jo ->> 'visitors', jo ->> 'next_step', jo ->> 'quiet', jo ->> 'approval_known'), 'ZZQUO 1 1 1 subjects true true');
  r := r || pg_temp.chk('G02', 'the teacher (approved 2 days ago, subject and hours, no request seen yet): next step "request_seen", NOT quiet (too new)',
    concat_ws(' ', pg_temp.trow(g0, v_t) ->> 'next_step', pg_temp.trow(g0, v_t) ->> 'quiet'), 'request_seen false');
  update tutor_profiles set first_request_seen_at = now() where id = v_t;
  r := r || pg_temp.chk('G03', 'once the teacher''s list has shown a request (first_request_seen_at), the next step is "accept"', pg_temp.trow(pg_temp.act(a_fin, 7), v_t) ->> 'next_step', 'accept');
  r := r || pg_temp.chk('G04', 'a tutor approved 9 days ago with hours who has taken no request: quiet, next step "request_seen"',
    concat_ws(' ', pg_temp.trow(g0, v_h) ->> 'quiet', pg_temp.trow(g0, v_h) ->> 'next_step', pg_temp.trow(g0, v_h) ->> 'has_hours'), 'true request_seen true');
  r := r || pg_temp.chk('G05', 'a tutor approved with no approval record: the date is unknown (not guessed) and they are listed as quiet',
    concat_ws(' ', pg_temp.trow(g0, v_n) ->> 'approval_known', pg_temp.trow(g0, v_n) ->> 'quiet', pg_temp.trow(g0, v_n) ->> 'next_step'), 'false true subjects');
  select concat_ws(' ', (min(o) filter (where x ->> 'tutor_id' = v_t::text) > max(o) filter (where x ->> 'tutor_id' in (v_o::text, v_h::text, v_n::text)))::text,
                        ((g0 -> 'totals' ->> 'verified') = jsonb_array_length(g0 -> 'tutors')::text)::text,
                        ((g0 -> 'totals' ->> 'quiet')::int = (select count(*) from jsonb_array_elements(g0 -> 'tutors') y where (y ->> 'quiet')::boolean))::text)
    into t from jsonb_array_elements(g0 -> 'tutors') with ordinality as e(x, o);
  r := r || pg_temp.chk('G06', 'the quiet tutors come first; the totals row adds up to the list (verified, quiet)', t, 'true true true');

  -- ---- lessons: family A (code A, switch OFF): 4 lessons, the first two completed; B: one lesson whose discount is then returned; an expired request ---------------------------------
  perform pg_temp.setting('tutor_bonus_enabled', 'false');
  qa1 := pg_temp.lesson(fa1, ca1, ea1, 280, '2C', 2, v_t);  perform pg_temp.done(pg_temp.sess(qa1));
  qa2 := pg_temp.lesson(fa1, ca1, ea1, 280, '2C', 2, v_t);  perform pg_temp.done(pg_temp.sess(qa2));
  qa3 := pg_temp.lesson(fa1, ca1, ea1, 280, '2C', 2, v_t);
  qa4 := pg_temp.lesson(fa1, ca1, ea1, 280, '2C', 2, v_t);
  qb1 := pg_temp.lesson(fb1, cb1, eb1, 280, '2C', 2, v_t);
  update promo_code_uses set returned_at = now(), returned_reason = 'funnel test' where request_id = qb1;
  qx := pg_temp.mkreq(fa1, ca1, ea1, 280, '2C', 2);
  update session_requests set status = 'expired', expires_at = now() where id = qx;
  -- the bonus switch ON: the owner's family takes one lesson and it is completed
  perform pg_temp.setting('tutor_bonus_enabled', 'true');
  qo1 := pg_temp.lesson(fo1, co1, eo1, 280, '2C', 2, v_t);  perform pg_temp.done(pg_temp.sess(qo1));

  j := pg_temp.fun(a_fin, today, today);
  jw := pg_temp.fun(a_fin, today - 45, today);
  jt := pg_temp.fun(a_fin, today - 45, today - 35);
  j5 := pg_temp.fun(a_fin, today - 5, today);
  r := r || pg_temp.chk('F04', 'code A today: sign-ups 2 (the family that came with it and the one an admin attached; the one attached 40 days ago is not in today), 1 of them attached by an admin',
    pg_temp.kv(j, 'ZZFUNA', 'signup') || ' ' || pg_temp.kv(j, 'ZZFUNA', 'signup_admin'), '2 1');
  r := r || pg_temp.chk('F05', 'code A over 45 days: 3 sign-ups (the date filter moves the numbers); the old window (45 to 35 days ago) shows the one sign-up and the one old open, and none of today''s bookings',
    pg_temp.kv(jw, 'ZZFUNA', 'signup') || ' / ' || pg_temp.kv(jt, 'ZZFUNA', 'signup') || ' ' || pg_temp.kv(jt, 'ZZFUNA', 'open') || ' ' || pg_temp.kv(jt, 'ZZFUNA', 'visitor') || ' ' || pg_temp.kv(jt, 'ZZFUNA', 'book_1'), '3 / 1 1 1 0');
  r := r || pg_temp.chk('F06', 'wallet funded counts a family''s FIRST successful top-up once, on its own day: code A 0 today, 1 in the last 5 days (the waiting top-up is not counted); code B 1 today',
    pg_temp.kv(j, 'ZZFUNA', 'funded') || ' ' || pg_temp.kv(j5, 'ZZFUNA', 'funded') || ' ' || pg_temp.kv(j, 'ZZFUNB', 'funded'), '0 1 1');
  r := r || pg_temp.chk('F07', 'code A bookings today: 1st, 2nd, 3rd booking, the 4th booking (full price), 3 lessons discounted, R84 booked',
    concat_ws(' ', pg_temp.kv(j, 'ZZFUNA', 'book_1'), pg_temp.kv(j, 'ZZFUNA', 'book_2'), pg_temp.kv(j, 'ZZFUNA', 'book_3'), pg_temp.kv(j, 'ZZFUNA', 'book_4'), pg_temp.kv(j, 'ZZFUNA', 'discounted'), pg_temp.kv(j, 'ZZFUNA', 'rand_booked')),
    '1 1 1 1 3 84');
  r := r || pg_temp.chk('F08', 'code A: the first lesson completed (once, though two were) and R56 given away (the two completed lessons)', pg_temp.kv(j, 'ZZFUNA', 'first_done') || ' ' || pg_temp.kv(j, 'ZZFUNA', 'rand_given'), '1 56');
  r := r || pg_temp.chk('F09', 'code B: the lesson whose discount was returned is not a booking (0 booked, 0 discounted, R0 booked) and shows once as returned (R28)',
    concat_ws(' ', pg_temp.kv(j, 'ZZFUNB', 'book_1'), pg_temp.kv(j, 'ZZFUNB', 'discounted'), pg_temp.kv(j, 'ZZFUNB', 'rand_booked'), pg_temp.kv(j, 'ZZFUNB', 'returned'), pg_temp.kv(j, 'ZZFUNB', 'rand_returned')), '0 0 0 1 28');
  r := r || pg_temp.chk('F10', 'code A: one request expired with no lesson', pg_temp.kv(j, 'ZZFUNA', 'expired'), '1');
  r := r || pg_temp.chk('F11', 'the owner''s code with the bonus on: 1 family, 1 booking, the bonus R14 paid, none held back; the answer says the bonus is on',
    concat_ws(' ', pg_temp.kv(j, 'ZZQUO', 'signup'), pg_temp.kv(j, 'ZZQUO', 'book_1'), pg_temp.kv(j, 'ZZQUO', 'bonus_paid'), pg_temp.kv(j, 'ZZQUO', 'bonus_held'), j ->> 'bonus_on'), '1 1 14 0 true');
  select count(*) || ' ' || coalesce(min((x -> 'k' ->> 'signup')::int), 0) into t from jsonb_array_elements(jw -> 'days') x where x ->> 'code' = 'ZZFUNA';
  r := r || pg_temp.chk('F12', 'per day: code A has 3 day rows over 45 days (the old sign-up and open, the first top-up 3 days ago, today)', split_part(t, ' ', 1), '3');
  select (jw -> 'totals' ->> 'signup')::bigint = (select sum((x -> 'k' ->> 'signup')::bigint) from jsonb_array_elements(jw -> 'codes') x)
         and (jw -> 'totals' ->> 'rand_booked')::bigint = (select sum((x -> 'k' ->> 'rand_booked')::bigint) from jsonb_array_elements(jw -> 'codes') x)
         and (jw -> 'totals' ->> 'open')::bigint = (select sum((x -> 'k' ->> 'open')::bigint) from jsonb_array_elements(jw -> 'codes') x) into t2;
  r := r || pg_temp.chk('F13', 'the totals row equals the sum of the code rows (sign-ups, rand booked, opens)', t2, 'true');
  r := r || pg_temp.chk('F14', 'the baseline: the made-up families add 5 with a code and 1 without (a learner a parent added is not counted at all)',
    ((jw -> 'baseline' ->> 'with_code')::int - (jb0 -> 'baseline' ->> 'with_code')::int) || ' ' || ((jw -> 'baseline' ->> 'without_code')::int - (jb0 -> 'baseline' ->> 'without_code')::int), '5 1');
  t := jw::text;
  r := r || pg_temp.chk('F15', 'no personal data in the answer: no email address, no made-up family name, no family id',
    (position('example.invalid' in t) = 0)::text || ' ' || (position('zzpia' in lower(t)) = 0 and position('zzpam' in lower(t)) = 0 and position('zzpru' in lower(t)) = 0)::text || ' '
    || (position(fa1::text in t) = 0 and position(fo1::text in t) = 0 and position(fn1::text in t) = 0)::text, 'true true true');
  r := r || pg_temp.chk('F16', 'only a finance admin can read it: a support agent, a tutor and a signed-out visitor are refused',
    pg_temp.run_as(a_spt, 'select public.admin_code_funnel(null, null)::text') || ' / ' || pg_temp.run_as(v_o, 'select public.admin_code_funnel(null, null)::text') || ' / '
    || (position('permission denied' in pg_temp.run_as(null, 'select public.admin_code_funnel(null, null)::text')) > 0)::text,
    'ERR: Finance admins only / ERR: Finance admins only / true');
  r := r || pg_temp.chk('F17', 'a start date after the end date, or a range over a year, is refused in plain words; no dates means the last 30 days',
    pg_temp.run_as(a_fin, format('select public.admin_code_funnel(%L, %L)::text', today, today - 1)) || ' / ' || pg_temp.run_as(a_fin, format('select public.admin_code_funnel(%L, %L)::text', today - 400, today)) || ' / '
    || ((pg_temp.fun(a_fin, null, null) ->> 'to')::date - (pg_temp.fun(a_fin, null, null) ->> 'from')::date)::text,
    'ERR: The start date is after the end date. / ERR: Pick a range of one year or less. / 29');

  -- ---- R13 after the lessons ------------------------------------------------------------------------------------------------------------------------------------------------------------
  g := pg_temp.act(a_fin, 7);
  jt := pg_temp.trow(g, v_t);
  r := r || pg_temp.chk('G07', 'the teacher took 6 lessons and 3 were completed: no next step left, not quiet', concat_ws(' ', jt ->> 'accepted', jt ->> 'completed', coalesce(jt ->> 'next_step', 'none'), jt ->> 'quiet'), '6 3 none false');
  jo := pg_temp.trow(g, v_o);
  r := r || pg_temp.chk('G08', 'the code owner''s page row: bonus R14 paid, 1 lesson booked by their family', concat_ws(' ', jo ->> 'bonus_rand', jo ->> 'family_lessons'), '14 1');
  t := g::text;
  r := r || pg_temp.chk('G09', 'no personal data in the activation list: no email address, no phone number, no family id',
    (position('example.invalid' in t) = 0)::text || ' ' || (position('082 777 8888' in t) = 0 and position('083 333' in t) = 0)::text || ' ' || (position(fo1::text in t) = 0 and position(fa1::text in t) = 0)::text, 'true true true');
  r := r || pg_temp.chk('G10', 'the "quiet" days are clamped: 0 becomes 1, 500 becomes 90, none means 7',
    (pg_temp.act(a_fin, 0) ->> 'quiet_days') || ' ' || (pg_temp.act(a_fin, 500) ->> 'quiet_days') || ' ' || (pg_temp.act(a_fin, null) ->> 'quiet_days'), '1 90 7');
  r := r || pg_temp.chk('G11', 'only a finance admin can read it: a support agent, a tutor and a signed-out visitor are refused',
    pg_temp.run_as(a_spt, 'select public.admin_tutor_activation(7)::text') || ' / ' || pg_temp.run_as(v_o, 'select public.admin_tutor_activation(7)::text') || ' / '
    || (position('permission denied' in pg_temp.run_as(null, 'select public.admin_tutor_activation(7)::text')) > 0)::text,
    'ERR: Finance admins only / ERR: Finance admins only / true');

  exception when others then
    r := r || format('STOPPED EARLY by an unexpected error: %s', sqlerrm) || E'\n';
  end;

  -- The Supabase tool shows only the START and the END of a long error. So: the passing ids are one short line, a failing check is printed in full, and the verdict and
  -- the NAMES of the failing checks come LAST. "N of 28 checks ran" is less than 28 when the suite stopped early (the stop is then also named).
  select count(*) filter (where l ~ '^[FG][0-9]+ '),
         count(*) filter (where l ~ '^[FG][0-9]+ ' and l like '% FAIL (want %'),
         string_agg(split_part(l, ' ', 1), ' ') filter (where l ~ '^[FG][0-9]+ ' and l not like '% FAIL (want %'),
         string_agg(l, E'\n') filter (where l like '% FAIL (want %' or l like 'STOPPED%'),
         string_agg(case when l like 'STOPPED%' then 'STOPPED-EARLY' else split_part(l, ' ', 1) end, ', ') filter (where l like '% FAIL (want %' or l like 'STOPPED%')
    into nlines, nfail, okids, rep, failnames
    from regexp_split_to_table(r, E'\n') as l;
  raise exception E'CODE FUNNEL AND TUTOR ACTIVATION (rolled back, nothing kept)\nPASSED: %\n%\nRESULT code funnel: % of 28 checks ran, % FAIL\nFAILING: %',
    coalesce(okids, 'none'), coalesce(rep, '(no failing line)'), nlines, nfail, coalesce(failnames, 'none');
end $$;
