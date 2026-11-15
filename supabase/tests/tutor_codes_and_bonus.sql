-- TUTOR CODES AND THE TUTOR BONUS, database suite (45 checks, T01 to T47 with gaps). Read supabase/tests/README.md first.
-- RUN IT AFTER 20261110120000_tutor_codes_and_bonus.sql is applied (and the promo and wallet migrations before it): paste this one file whole into the Supabase execute_sql tool.
-- ONE statement. It makes made-up people (example.invalid), a made-up school, the subject "Zorology" and codes starting ZZ, acts as them, and ends with an error on purpose,
-- which rolls EVERYTHING back (nothing is kept, nothing is sent). The verdict is the END of the error text: "RESULT tutor bonus: N of 45 checks ran, M FAIL" then "FAILING: <names>".
-- It reproduces the PM's costing table (10 Nov, plan section 11) in one family's six lessons: 2C, 3A and 4D with the code (lessons 1 to 3), then at full price (lessons 4 to 6):
--   list R280 / R400 / R1,200; the family pays R252 / R360 / R1,080 then the list price; the tutor's pay never changes (R207 / R308 / R1,044); the bonus is 5 percent of LIST
--   (R14 / R20 / R60) trimmed so Tutorlage keeps at least R15 (4D lesson 3: R21, not R60); Tutorlage keeps R31 / R32 / R15, then R59 / R72 / R96 after the bonus.
-- Real data cannot change a result: the people, codes and sessions are new rows. The only reads of real rows are "no verified tutor is left without a code" and the wallet balance
-- check (which looks for fixture ids). T13 reads the shipped settings first: if the CEO has already changed one, T13 says so (that is the setting, not a bug).
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  minor text := (current_date - interval '10 years')::date::text;
  a_fin uuid := gen_random_uuid(); a_sup uuid := gen_random_uuid(); a_spt uuid := gen_random_uuid();
  v_o uuid := gen_random_uuid();    -- the code owner (approved; the code is made from the first name Zzolo)
  v_o2 uuid := gen_random_uuid();   -- a second tutor with the same first name (the numbered code)
  v_t uuid := gen_random_uuid();    -- the teacher
  v_n uuid := gen_random_uuid();    -- approved while the automatic switch is off; made by the catch-up
  v_h uuid := gen_random_uuid();    -- approved while the switch is off; gets a chosen name from the admin button
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid(); p4 uuid := gen_random_uuid(); p6 uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid(); c4 uuid := gen_random_uuid(); c6 uuid := gen_random_uuid();
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; e6 uuid;
  k_o uuid; k_gen uuid; c_caps uuid; s1 uuid;
  q0 uuid; q1 uuid; q2 uuid; q3 uuid; q4 uuid; q5 uuid; q6 uuid; q7 uuid; q8 uuid; q9 uuid; q10 uuid; q11 uuid; qs uuid; qg uuid; qc uuid;
  s_0 uuid; s_1 uuid; s_2 uuid; s_3 uuid; s_4 uuid; s_5 uuid; s_6 uuid; s_7 uuid; s_8 uuid; s_9 uuid; s_10 uuid; s_11 uuid; s_s uuid; s_g uuid; s_c uuid;
  t text; t2 text; j jsonb; nfail int; nlines int; rep text; okids text; failnames text; a0 int;
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
      values (p_stu, p_enr, p_by, pg_temp.slot(pg_temp.nxt()), 1, 'pending', 'initiated', 'tb_' || gen_random_uuid(), p_level, p_tier, p_price,
              (select id from public.schools_institutions where name = 'ZZ Bonus test school'), null, null, 'ZAR')
      returning id into v;
      return v;
    end $f$ $mk$;
  execute $mk$
    create function pg_temp.send(p_u uuid, p_q uuid) returns text language sql as $f$
      select pg_temp.run_as(p_u, format('select concat_ws(''/'', x->>''held_rand'', x->>''discount_rand'', x->>''available_rand'') from (select public.send_request_wallet(%L) as x) s', p_q)) $f$ $mk$;
  execute $mk$ create function pg_temp.wb(p uuid) returns text language sql as $f$
      select coalesce((select available_rand || '/' || held_rand from public.wallets where profile_id = p), '0/0') $f$ $mk$;
  execute $mk$ create function pg_temp.top(p_profile uuid, p_amount int) returns void language sql as $f$
      select public.wallet_post(p_profile, 'topup', p_amount, 0, 'tb-top:' || gen_random_uuid(), null, 'test top-up') $f$ $mk$;
  execute $mk$ create function pg_temp.sess(p_q uuid) returns uuid language sql as $f$
      select resulting_session_id from public.session_requests where id = p_q $f$ $mk$;
  -- gross / tutor pay / Tutorlage's share / the discount / the commission on the request  (or why there is no session)
  execute $mk$ create function pg_temp.money(p_q uuid) returns text language sql as $f$
      select coalesce((select s.gross_amount::int || '/' || s.tutor_payout_amount::int || '/' || (s.gross_amount - s.tutor_payout_amount)::int || '/' || s.promo_discount_rand || '/' || q.commission_amount::int
        from public.sessions s join public.session_requests q on q.resulting_session_id = s.id where q.id = p_q), 'NO SESSION: ' || coalesce(current_setting('test.last', true), '-')) $f$ $mk$;
  -- the bonus row of a session: wanted / paid / trimmed / what Tutorlage kept   (or none)
  execute $mk$ create function pg_temp.bonus(p_s uuid) returns text language sql as $f$
      select coalesce((select wanted_rand || '/' || paid_rand || '/' || trimmed || '/' || platform_keeps_rand from public.tutor_bonuses where session_id = p_s), 'none') $f$ $mk$;
  execute $mk$ create function pg_temp.pin(p_t uuid, p_level text) returns void language sql as $f$
      update public.tutor_profiles set current_tier_id = (select tier_id from public.sub_tier_definitions where id = p_level), current_sub_tier_id = p_level where id = p_t $f$ $mk$;
  -- completing a lesson re-levels a made-up tutor, so the level is pinned again before each claim
  execute $mk$ create function pg_temp.done(p_s uuid) returns void language plpgsql as $f$
      begin update public.sessions set scheduled_start = now() - interval '3 hours' where id = p_s; update public.sessions set status = 'completed' where id = p_s; end $f$ $mk$;
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
  execute $mk$ create function pg_temp.audits() returns int language sql as $f$
      select count(*)::int from public.admin_audit_logs where action::text in ('promo_code_created', 'promo_code_changed', 'promo_code_attached') $f$ $mk$;
  execute $mk$ create function pg_temp.nn(p_profile uuid, p_type text, p_like text) returns int language sql as $f$
      select count(*)::int from public.notifications where profile_id = p_profile and type = p_type and body like p_like $f$ $mk$;
  execute $mk$ create function pg_temp.setting(p_key text, p_val text) returns void language sql as $f$
      update public.system_settings set setting_value = p_val::jsonb where setting_key = p_key $f$ $mk$;

  -- ---- the shipped settings, read before the suite changes any ---------------------------------------------------------------------------------------------------------------------
  select concat_ws(' ', (select setting_value #>> '{}' from system_settings where setting_key = 'tutor_bonus_enabled'),
                        (select setting_value #>> '{}' from system_settings where setting_key = 'tutor_bonus_percent'),
                        (select setting_value #>> '{}' from system_settings where setting_key = 'tutor_bonus_months'),
                        (select setting_value #>> '{}' from system_settings where setting_key = 'tutor_bonus_platform_floor_rand'),
                        (select setting_value #>> '{}' from system_settings where setting_key = 'tutor_bonus_only_when_they_teach'),
                        (select setting_value #>> '{}' from system_settings where setting_key = 'tutor_personal_codes_auto'),
                        (select setting_value #>> '{}' from system_settings where setting_key = 'promo_first_offer_minutes')) into t;
  r := r || pg_temp.chk('T13', 'the shipped settings: switch off, 5 percent, 12 months, floor R15, referral (not teacher-only), automatic codes on, first offer off', t, 'false 5 12 15 false true 0');

  -- ---- people: three admins, tutors, a school and the subject ------------------------------------------------------------------------------------------------------------------------
  select id into c_caps from curricula where code = 'CAPS';
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (a_fin, z, 'authenticated', 'authenticated', 'tb.a1.' || a_fin || '@example.invalid', '{}'::jsonb, '{}'),
    (a_sup, z, 'authenticated', 'authenticated', 'tb.a2.' || a_sup || '@example.invalid', '{}'::jsonb, '{}'),
    (a_spt, z, 'authenticated', 'authenticated', 'tb.a3.' || a_spt || '@example.invalid', '{}'::jsonb, '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (a_fin, 'Fin', 'Manager', 'tb.a1.' || a_fin || '@example.invalid', '', 'finance_manager', true),
    (a_sup, 'Sup', 'Admin', 'tb.a2.' || a_sup || '@example.invalid', '', 'super_admin', true),
    (a_spt, 'Spt', 'Agent', 'tb.a3.' || a_spt || '@example.invalid', '', 'support_agent', true);
  update system_settings set setting_value = 'false'::jsonb where setting_key = 'free_sessions_enabled';
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'wallet_payments_enabled';
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_o, z, 'authenticated', 'authenticated', 'tb.o.' || v_o || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zzolo', 'date_of_birth', adult, 'phone_number', '082 111 2222'), '{}'),
    (v_o2, z, 'authenticated', 'authenticated', 'tb.o2.' || v_o2 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zzolo', 'date_of_birth', adult), '{}'),
    (v_t, z, 'authenticated', 'authenticated', 'tb.t.' || v_t || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tess', 'date_of_birth', adult), '{}');
  update profiles set date_of_birth = adult::date where id in (v_o, v_o2, v_t);
  a0 := pg_temp.audits();
  -- approval makes the personal code (the switch is on as shipped)
  update tutor_profiles set current_tier_id = 2, current_sub_tier_id = '2C', institution_id = null, is_verified = true where id in (v_o, v_o2);
  update tutor_profiles set current_tier_id = 4, current_sub_tier_id = '4D', institution_id = null, is_verified = true where id = v_t;
  insert into tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
    select tt, 'police_clearance'::public.doc_type, 'fixture/police-' || tt, 'verified'::public.verification_status, (now() at time zone 'Africa/Johannesburg')::date from unnest(array[v_o, v_o2, v_t]) tt;
  insert into schools_institutions (name, curriculum, curriculum_id) values ('ZZ Bonus test school', 'caps', c_caps) returning id into s1;
  insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
    values (v_t, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified');
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) select v_t, d, '00:00', '24:00' from generate_series(0, 6) d;
  r := r || 'S0 setup: 3 admins, tutors, a made-up school and subject' || E'\n';

  -- ---- P-5: the personal code -----------------------------------------------------------------------------------------------------------------------------------------------------------
  select id into k_o from promo_codes where owner_tutor_id = v_o;
  r := r || pg_temp.chk('T01', 'approval made one personal code for the tutor from their first name: 10 percent, 3 lessons, active, owned, and NOT a "referring tutor" (the first offer stays off)',
    (select count(*) || ' ' || coalesce(min(code), '-') || ' ' || coalesce(bool_and(active)::text, '-') || ' ' || coalesce(min(percent_off)::text, '-') || ' ' || coalesce(min(uses_per_account)::text, '-') || ' ' || coalesce(min(referring_tutor_id::text), 'none')
       from promo_codes where owner_tutor_id = v_o), '1 ZZOLO true 10 3 none');
  r := r || pg_temp.chk('T02', 'its label names the tutor', (select (label like 'Tutor: %')::text from promo_codes where owner_tutor_id = v_o), 'true');
  r := r || pg_temp.chk('T03', 'a second tutor with the same first name gets the numbered code', (select code from promo_codes where owner_tutor_id = v_o2), 'ZZOLO1');
  begin
    update tutor_profiles set is_verified = false where id = v_o;
    update tutor_profiles set is_verified = true where id = v_o;
    t := 'ok';
  exception when others then
    t := sqlerrm;
  end;
  r := r || pg_temp.chk('T04', 'approving the same tutor again makes no second code', t || ' / ' || (select count(*) from promo_codes where owner_tutor_id = v_o), 'ok / 1');
  -- the switch off: tutors approved now get no code
  perform pg_temp.setting('tutor_personal_codes_auto', 'false');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_n, z, 'authenticated', 'authenticated', 'tb.n.' || v_n || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zzenn', 'date_of_birth', adult), '{}'),
    (v_h, z, 'authenticated', 'authenticated', 'tb.h.' || v_h || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zzhal', 'date_of_birth', adult), '{}');
  update profiles set date_of_birth = adult::date where id in (v_n, v_h);
  update tutor_profiles set is_verified = true where id in (v_n, v_h);
  r := r || pg_temp.chk('T05', 'with the automatic switch off, approval makes no code', (select count(*) from promo_codes where owner_tutor_id in (v_n, v_h))::text, '0');
  t := pg_temp.run_as(a_fin, format('select public.admin_create_tutor_code(%L, %L)::text', v_h, 'Mr. Zed!'));
  j := case when t like 'ERR:%' then '{}'::jsonb else t::jsonb end;
  r := r || pg_temp.chk('T06', 'the admin button makes the code from the chosen name (capitals and digits only) and writes one audit row',
    coalesce(j ->> 'created', t) || ' ' || coalesce(j ->> 'code', '-') || ' ' || (pg_temp.audits() - a0), 'true MRZED 1');
  t := pg_temp.run_as(a_fin, format('select public.admin_create_tutor_code(%L, %L)::text', v_h, 'Another'));
  j := case when t like 'ERR:%' then '{}'::jsonb else t::jsonb end;
  r := r || pg_temp.chk('T07', 'pressing it again changes nothing and returns the same code',
    coalesce(j ->> 'created', t) || ' ' || coalesce(j ->> 'code', '-') || ' / ' || (select count(*) from promo_codes where owner_tutor_id = v_h), 'false MRZED / 1');
  r := r || pg_temp.chk('T08', 'a chosen name that is taken is refused, plainly',
    pg_temp.run_as(a_fin, format('select public.admin_create_tutor_code(%L, %L)::text', v_n, 'zzolo')), 'ERR: The code ZZOLO is taken. Pick another name.');
  r := r || pg_temp.chk('T09', 'only a finance admin can make or list them: a support agent, a tutor and a signed-out visitor are refused',
    pg_temp.run_as(a_spt, format('select public.admin_create_tutor_code(%L, null)::text', v_n)) || ' / ' || pg_temp.run_as(v_o, format('select public.admin_create_tutor_code(%L, null)::text', v_n)) || ' / '
    || pg_temp.run_as(a_spt, 'select public.admin_make_missing_tutor_codes()::text') || ' / ' || (position('permission denied' in pg_temp.run_as(null, 'select public.admin_list_promo_codes()::text')) > 0)::text,
    'ERR: Finance admins only / ERR: Finance admins only / ERR: Finance admins only / true');
  t := pg_temp.run_as(a_fin, 'select public.admin_make_missing_tutor_codes()::text');
  j := case when t like 'ERR:%' then '{}'::jsonb else t::jsonb end;
  r := r || pg_temp.chk('T10', 'the catch-up gives the tutor without a code one (from the first name) and leaves no verified tutor without a code',
    (select count(*) || ' ' || coalesce(min(code), '-') from promo_codes where owner_tutor_id = v_n) || ' / ' || (select count(*) from tutor_profiles tp where tp.is_verified and not exists (select 1 from promo_codes c where c.owner_tutor_id = tp.id))
    || ' / ' || coalesce(j ->> 'failed', t), '1 ZZENN / 0 / 0');
  perform pg_temp.setting('tutor_personal_codes_auto', 'true');

  -- ---- the settings are read tolerantly, and the maths is one function --------------------------------------------------------------------------------------------------------
  perform pg_temp.setting('tutor_bonus_percent', '"abc"');
  t := public.tutor_bonus_num('tutor_bonus_percent', 5, 0, 20)::text;
  perform pg_temp.setting('tutor_bonus_percent', '99');
  t := t || ' ' || public.tutor_bonus_num('tutor_bonus_percent', 5, 0, 20)::text;
  perform pg_temp.setting('tutor_bonus_percent', '5');
  perform pg_temp.setting('tutor_bonus_months', '0');
  t := t || ' ' || public.tutor_bonus_num('tutor_bonus_months', 12, 1, 60)::text;
  perform pg_temp.setting('tutor_bonus_months', '12');
  perform pg_temp.setting('tutor_bonus_enabled', '"maybe"');
  t := t || ' ' || public.tutor_bonus_flag('tutor_bonus_enabled', false)::text;
  perform pg_temp.setting('tutor_bonus_enabled', 'false');
  r := r || pg_temp.chk('T14', 'a silly setting (text, out of range, zero months, a word for a switch) means the default', t, '5 5 12 false');
  select string_agg(a.wanted || '/' || a.paid, ' ' order by v.o) into t
    from (values (1, 280, 45), (2, 400, 52), (3, 1200, 36), (4, 280, 73), (5, 400, 92), (6, 1200, 156), (7, 50, 10), (8, 50, 15), (9, 80, 24), (10, 110, 60)) v(o, l, k),
         lateral public.tutor_bonus_amount(v.l, v.k, 5, 15) a;
  r := r || pg_temp.chk('T15', 'the maths on its own: 2C, 3A, 4D with the code then without (14/14 20/20 60/21 then 14/14 20/20 60/60); 1A gets none (3/0 3/0); R80 level 4/4; half rand rounds up (6)', t,
    '14/14 20/20 60/21 14/14 20/20 60/60 3/0 3/0 4/4 6/6');
  select concat_ws(' ', (select a.wanted || '/' || a.paid from public.tutor_bonus_amount(1200, 36, 5, 0) a),
                        (select a.wanted || '/' || a.paid from public.tutor_bonus_amount(280, 73, 10, 15) a),
                        (select a.wanted || '/' || a.paid from public.tutor_bonus_amount(1200, 36, 0, 15) a)) into t;
  r := r || pg_temp.chk('T16', 'the floor and the percent are the settings'' to move: floor 0 pays R36 of R60 at 4D; 10 percent at 2C pays R28; 0 percent pays nothing', t, '60/36 28/28 0/0');

  -- ---- families: p1 (the main one), p6 (the switch-off test) and p3 (same phone as the owner) arrive with the owner's code; p4 with an ordinary code; p2 with none -------------------
  k_gen := pg_temp.run_as(a_fin, $q$select public.admin_create_promo_code('ZZBONGEN', 'ordinary code', 10, 3, null, null, null, null)::text$q$)::uuid;
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (p1, z, 'authenticated', 'authenticated', 'tb.p1.' || p1 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pia', 'date_of_birth', adult, 'phone_number', '083 333 4444', 'signup_code', 'zzolo'), '{}'),
    (p2, z, 'authenticated', 'authenticated', 'tb.p2.' || p2 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pam', 'date_of_birth', adult, 'phone_number', '084 444 5555'), '{}'),
    (p3, z, 'authenticated', 'authenticated', 'tb.p3.' || p3 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pat', 'date_of_birth', adult, 'phone_number', '0821112222', 'signup_code', 'ZZOLO'), '{}'),
    (p4, z, 'authenticated', 'authenticated', 'tb.p4.' || p4 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pip', 'date_of_birth', adult, 'phone_number', '085 555 6666', 'signup_code', 'ZZBONGEN'), '{}'),
    (p6, z, 'authenticated', 'authenticated', 'tb.p6.' || p6 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pru', 'date_of_birth', adult, 'phone_number', '086 666 7777', 'signup_code', 'ZZOLO'), '{}');
  update profiles set date_of_birth = adult::date where id in (p1, p2, p3, p4, p6);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (c1, z, 'authenticated', 'authenticated', 'tb.c1.' || c1 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Cai', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', p1, 'relationship', 'mother')),
    (c2, z, 'authenticated', 'authenticated', 'tb.c2.' || c2 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Cam', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', p2, 'relationship', 'mother')),
    (c3, z, 'authenticated', 'authenticated', 'tb.c3.' || c3 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Cat', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', p3, 'relationship', 'mother')),
    (c4, z, 'authenticated', 'authenticated', 'tb.c4.' || c4 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Cal', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', p4, 'relationship', 'mother')),
    (c6, z, 'authenticated', 'authenticated', 'tb.c6.' || c6 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Cas', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', p6, 'relationship', 'mother'));
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (c1, 'Zorology', 'Grade 10') returning id into e1;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (c2, 'Zorology', 'Grade 10') returning id into e2;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (c3, 'Zorology', 'Grade 10') returning id into e3;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (c4, 'Zorology', 'Grade 10') returning id into e4;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (c6, 'Zorology', 'Grade 10') returning id into e6;
  perform pg_temp.top(p1, 6000);
  perform pg_temp.top(p2, 1000);
  perform pg_temp.top(p3, 1000);
  perform pg_temp.top(p4, 1000);
  perform pg_temp.top(p6, 1000);
  r := r || pg_temp.chk('T11', 'the family that signed up with the code (lower case, as from the link) is attached to the owner''s personal code, and the public check of the code says 10 percent for 3 lessons',
    (select (promo_code_id = k_o)::text from profiles where id = p1) || ' / ' || pg_temp.run_as(null, $q$select concat_ws('/', x->>'valid', x->>'percent', x->>'lessons') from (select public.check_promo_code('zzolo') as x) s$q$), 'true / true/10/3');
  r := r || pg_temp.chk('T12', 'the tutor sees their own code and the number of families that came with it (three); a parent sees no code',
    pg_temp.run_as(v_o, $q$select concat_ws(' ', x->>'has_code', x->>'code', x->>'families') from (select public.my_tutor_code() as x) s$q$) || ' / '
    || pg_temp.run_as(p2, $q$select (public.my_tutor_code())->>'has_code'$q$), 'true ZZOLO 3 / false');

  -- ---- switch OFF (as shipped): the discount applies, the tutor is paid as usual, and there is no bonus -------------------------------------------------------------------------
  q0 := pg_temp.lesson(p6, c6, e6, 280, '2C', 2, v_t);
  s_0 := pg_temp.sess(q0);
  perform pg_temp.done(s_0);
  r := r || pg_temp.chk('T20', 'switch OFF: a family that came with the code takes a 2C lesson: R252, the tutor R207 as always, NO bonus row and nothing in the owner''s wallet',
    pg_temp.money(q0) || ' / ' || pg_temp.bonus(s_0) || ' / owner ' || pg_temp.wb(v_o) || ' / teacher ' || pg_temp.wb(v_t), '252/207/45/28/73 / none / owner 0/0 / teacher 207/0');

  -- ---- switch ON: the costing table, lesson by lesson (the main family) ---------------------------------------------------------------------------------------------------------------
  perform pg_temp.setting('tutor_bonus_enabled', 'true');
  q1 := pg_temp.lesson(p1, c1, e1, 280, '2C', 2, v_t);  s_1 := pg_temp.sess(q1);  perform pg_temp.done(s_1);
  r := r || pg_temp.chk('T21', '2C lesson 1 (with the code): family R252, tutor R207, Tutorlage keeps R45; the bonus is 5 percent of R280 = R14, so Tutorlage keeps R31',
    pg_temp.money(q1) || ' / ' || pg_temp.bonus(s_1) || ' / owner ' || pg_temp.wb(v_o), '252/207/45/28/73 / 14/14/false/31 / owner 14/0');
  r := r || pg_temp.chk('T27', 'the bonus is one wallet line on the owner (session_credit, "Referral bonus...", no session or family named) and one notification',
    coalesce((select kind || ' ' || available_delta || ' ' || (note like 'Referral bonus%') || ' ' || (session_id is null and request_id is null) from wallet_ledger where idempotency_key = 'bonus:' || s_1), 'no line') || ' / ' || pg_temp.nn(v_o, 'wallet_tutor_bonus', 'R14 was added%'),
    'session_credit 14 true true / 1');
  q2 := pg_temp.lesson(p1, c1, e1, 400, '3A', 3, v_t);  s_2 := pg_temp.sess(q2);  perform pg_temp.done(s_2);
  r := r || pg_temp.chk('T22', '3A lesson 2: family R360, tutor R308, Tutorlage keeps R52; bonus R20, Tutorlage keeps R32',
    pg_temp.money(q2) || ' / ' || pg_temp.bonus(s_2) || ' / owner ' || pg_temp.wb(v_o), '360/308/52/40/92 / 20/20/false/32 / owner 34/0');
  q3 := pg_temp.lesson(p1, c1, e1, 1200, '4D', 4, v_t);  s_3 := pg_temp.sess(q3);  perform pg_temp.done(s_3);
  r := r || pg_temp.chk('T23', '4D lesson 3, THE FLOOR CASE: family R1,080 (the 10 percent is honoured), tutor R1,044, Tutorlage keeps R36; R60 is wanted but only R21 is paid so Tutorlage keeps R15',
    pg_temp.money(q3) || ' / ' || pg_temp.bonus(s_3) || ' / owner ' || pg_temp.wb(v_o), '1080/1044/36/120/156 / 60/21/true/15 / owner 55/0');
  q4 := pg_temp.lesson(p1, c1, e1, 280, '2C', 2, v_t);  s_4 := pg_temp.sess(q4);  perform pg_temp.done(s_4);
  r := r || pg_temp.chk('T24', '2C lesson 4 (the discount is used up): family R280, tutor R207, Tutorlage keeps R73; bonus R14, Tutorlage keeps R59',
    pg_temp.money(q4) || ' / ' || pg_temp.bonus(s_4) || ' / owner ' || pg_temp.wb(v_o), '280/207/73/0/73 / 14/14/false/59 / owner 69/0');
  q5 := pg_temp.lesson(p1, c1, e1, 400, '3A', 3, v_t);  s_5 := pg_temp.sess(q5);  perform pg_temp.done(s_5);
  r := r || pg_temp.chk('T25', '3A lesson 5: family R400, tutor R308, Tutorlage keeps R92; bonus R20, Tutorlage keeps R72',
    pg_temp.money(q5) || ' / ' || pg_temp.bonus(s_5) || ' / owner ' || pg_temp.wb(v_o), '400/308/92/0/92 / 20/20/false/72 / owner 89/0');
  q6 := pg_temp.lesson(p1, c1, e1, 1200, '4D', 4, v_t);  s_6 := pg_temp.sess(q6);  perform pg_temp.done(s_6);
  r := r || pg_temp.chk('T26', '4D lesson 6: family R1,200, tutor R1,044, Tutorlage keeps R156; the full bonus R60 (no trim), Tutorlage keeps R96',
    pg_temp.money(q6) || ' / ' || pg_temp.bonus(s_6) || ' / owner ' || pg_temp.wb(v_o), '1200/1044/156/0/156 / 60/60/false/96 / owner 149/0');
  r := r || pg_temp.chk('T28', 'the teacher was paid exactly as without any code or bonus: R207 + 207+308+1044+207+308+1044', pg_temp.wb(v_t), '3325/0');
  r := r || pg_temp.chk('T29', 'the owner reads their own six bonus lines but not the bonus table (it holds the family); a finance admin reads the table',
    pg_temp.run_as(v_o, $q$select count(*)::text from public.wallet_ledger where note like 'Referral bonus%'$q$) || ' ' || pg_temp.run_as(v_o, 'select count(*)::text from public.tutor_bonuses') || ' '
    || (pg_temp.run_as(a_fin, 'select count(*)::text from public.tutor_bonuses')::int = (select count(*) from tutor_bonuses))::text, '6 0 true');
  t := public.tutor_bonus_pay(s_1)::text;
  r := r || pg_temp.chk('T30', 'paying again for the same lesson pays nothing: one row, one wallet line', t || ' / ' || (select count(*) from tutor_bonuses where session_id = s_1) || ' / ' || (select count(*) from wallet_ledger where idempotency_key = 'bonus:' || s_1), '0 / 1 / 1');

  -- ---- a refund after the lesson, with "take back from the tutor": the bonus shrinks by the same share ----------------------------------------------------------------------------------
  t := pg_temp.run_as(a_fin, format($q$select public.admin_refund_to_wallet(%L, 280, 'test refund', true, %L)::text$q$, s_4, gen_random_uuid()));
  r := r || pg_temp.chk('T31', 'a full refund of lesson 4 with take-back reduces its R14 bonus to nothing', (t not like 'ERR:%')::text || ' ' || (select reversed_rand from tutor_bonuses where session_id = s_4) || ' / owner ' || pg_temp.wb(v_o), 'true 14 / owner 135/0');
  t := pg_temp.run_as(a_fin, format($q$select public.admin_refund_to_wallet(%L, 200, 'test refund', true, %L)::text$q$, s_5, gen_random_uuid()));
  r := r || pg_temp.chk('T32', 'half of lesson 5 refunded with take-back: half of its R20 bonus comes back (R10)', (t not like 'ERR:%')::text || ' ' || (select reversed_rand from tutor_bonuses where session_id = s_5) || ' / owner ' || pg_temp.wb(v_o), 'true 10 / owner 125/0');
  t := pg_temp.run_as(a_fin, format($q$select public.admin_refund_to_wallet(%L, 200, 'test refund', true, %L)::text$q$, s_5, gen_random_uuid()));
  r := r || pg_temp.chk('T33', 'the other half too: the total is the whole R20, never more', (t not like 'ERR:%')::text || ' ' || (select reversed_rand from tutor_bonuses where session_id = s_5) || ' / owner ' || pg_temp.wb(v_o), 'true 20 / owner 115/0');
  t := pg_temp.run_as(a_fin, format($q$select public.admin_refund_to_wallet(%L, 100, 'test refund', false, %L)::text$q$, s_6, gen_random_uuid()));
  r := r || pg_temp.chk('T34', 'a refund WITHOUT take-back leaves the bonus alone', (t not like 'ERR:%')::text || ' ' || (select reversed_rand from tutor_bonuses where session_id = s_6) || ' / owner ' || pg_temp.wb(v_o), 'true 0 / owner 115/0');
  r := r || pg_temp.chk('T35', 'the reversals add up on the row and on the ledger', (select sum(reversed_rand) from tutor_bonuses where tutor_id = v_o) || ' ' || (select -sum(available_delta) from wallet_ledger where profile_id = v_o and kind = 'refund_reversal'), '34 34');

  -- ---- the other rules ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.setting('tutor_bonus_only_when_they_teach', 'true');
  q7 := pg_temp.lesson(p1, c1, e1, 280, '2C', 2, v_t);  s_7 := pg_temp.sess(q7);  perform pg_temp.done(s_7);
  r := r || pg_temp.chk('T36', 'with "only when they teach" on, a lesson taught by someone else pays no bonus', pg_temp.money(q7) || ' / ' || pg_temp.bonus(s_7) || ' / owner ' || pg_temp.wb(v_o), '280/207/73/0/73 / none / owner 115/0');
  perform pg_temp.setting('tutor_bonus_only_when_they_teach', 'false');
  perform pg_temp.run_as(a_fin, format('select public.admin_set_promo_code_active(%L, false)::text', k_o));
  q8 := pg_temp.lesson(p1, c1, e1, 280, '2C', 2, v_t);  s_8 := pg_temp.sess(q8);  perform pg_temp.done(s_8);
  r := r || pg_temp.chk('T37', 'a PAUSED code pays no bonus', pg_temp.money(q8) || ' / ' || pg_temp.bonus(s_8) || ' / owner ' || pg_temp.wb(v_o), '280/207/73/0/73 / none / owner 115/0');
  perform pg_temp.run_as(a_fin, format('select public.admin_set_promo_code_active(%L, true)::text', k_o));
  update sessions set completed_at = now() - interval '13 months' where id = s_1;     -- the family's first completed lesson was 13 months ago
  q9 := pg_temp.lesson(p1, c1, e1, 280, '2C', 2, v_t);  s_9 := pg_temp.sess(q9);  perform pg_temp.done(s_9);
  r := r || pg_temp.chk('T38', 'more than 12 months after the family''s first completed lesson, no bonus', pg_temp.money(q9) || ' / ' || pg_temp.bonus(s_9) || ' / owner ' || pg_temp.wb(v_o), '280/207/73/0/73 / none / owner 115/0');
  perform pg_temp.setting('tutor_bonus_months', '24');
  t := public.tutor_bonus_pay(s_9)::text;
  r := r || pg_temp.chk('T39', 'the period is the setting''s: at 24 months the same lesson pays R14 (Tutorlage keeps R59)', t || ' / ' || pg_temp.bonus(s_9) || ' / owner ' || pg_temp.wb(v_o), '14 / 14/14/false/59 / owner 129/0');
  perform pg_temp.setting('tutor_bonus_months', '12');
  q10 := pg_temp.lesson(p3, c3, e3, 280, '2C', 2, v_t);  s_10 := pg_temp.sess(q10);  perform pg_temp.done(s_10);
  r := r || pg_temp.chk('T40', 'SELF-REFERRAL: a family with the same phone number as the code''s owner pays no bonus; the lesson is recorded with the reason',
    pg_temp.money(q10) || ' / ' || pg_temp.bonus(s_10) || ' / ' || coalesce((select (note like 'self-referral%')::text from tutor_bonuses where session_id = s_10), 'no row') || ' / owner ' || pg_temp.wb(v_o), '252/207/45/28/73 / 14/0/false/45 / true / owner 129/0');
  qc := pg_temp.lesson(p2, c2, e2, 280, '2C', 2, v_t);  s_c := pg_temp.sess(qc);  perform pg_temp.done(s_c);
  qg := pg_temp.lesson(p4, c4, e4, 280, '2C', 2, v_t);  s_g := pg_temp.sess(qg);  perform pg_temp.done(s_g);
  r := r || pg_temp.chk('T41', 'a family with no code, and a family with an ordinary (not tutor) code, pay no bonus to anyone', pg_temp.bonus(s_c) || ' ' || pg_temp.bonus(s_g) || ' / owner ' || pg_temp.wb(v_o) || ' / ' || (select count(*) from tutor_bonuses where payer_id in (p2, p4)), 'none none / owner 129/0 / 0');
  -- a bonus that cannot be paid (the owner turned out to be a minor: no wallet) must not touch the tutor's credit, the completion or the family
  update profiles set date_of_birth = minor::date where id = v_o;
  q11 := pg_temp.lesson(p6, c6, e6, 280, '2C', 2, v_t);  s_11 := pg_temp.sess(q11);  perform pg_temp.done(s_11);
  r := r || pg_temp.chk('T42', 'a bonus that fails (no wallet for the owner) never blocks the lesson or the tutor''s own credit: completed, credited once, no bonus row, finance told',
    (select status::text from sessions where id = s_11) || ' / credit ' || (select count(*) from wallet_ledger where idempotency_key = 'credit:' || s_11) || ' / ' || pg_temp.bonus(s_11) || ' / alerts '
    || (select count(*) from notifications where profile_id = a_fin and type = 'tutor_bonus_failed' and body like '%' || s_11 || '%'), 'completed / credit 1 / none / alerts 1');
  update profiles set date_of_birth = adult::date where id = v_o;
  qs := pg_temp.lesson(p1, c1, e1, 280, '2C', 2, v_t);  s_s := pg_temp.sess(qs);
  t := public.tutor_bonus_pay(s_s)::text;
  r := r || pg_temp.chk('T43', 'a lesson that is booked but not completed (or was cancelled first) has no bonus to pay or give back', t || ' / ' || pg_temp.bonus(s_s) || ' / ' || (select status::text from sessions where id = s_s), '0 / none / scheduled');

  -- ---- the books, the Codes page, the tutor's own page, and who may call what -------------------------------------------------------------------------------------------------------
  j := public.wallet_check_balances();
  r := r || pg_temp.chk('T44', 'every wallet in the suite still adds up to its ledger (the bonus lines and the take-backs included)',
    (select count(*) from jsonb_array_elements(j -> 'mismatches') e where (e ->> 'profile_id')::uuid in (v_o, v_t, p1, p2, p3, p4, p6))::text, '0');
  j := pg_temp.run_as(a_fin, 'select public.admin_list_promo_codes()::text')::jsonb;
  select e into t2 from jsonb_array_elements(j) e where e ->> 'code' = 'ZZOLO';
  r := r || pg_temp.chk('T45', 'the Codes page for the owner''s code: 3 families, the owner named, 7 paid lessons, R129 paid net of take-backs, R53 held back (R39 by the floor + R14 by the self-referral guard)',
    concat_ws(' ', (t2::jsonb ->> 'signups'), ((t2::jsonb ->> 'owner_tutor_name') is not null)::text, (t2::jsonb ->> 'bonus_lessons'), (t2::jsonb ->> 'bonus_rand_paid'), (t2::jsonb ->> 'bonus_rand_held_back')), '3 true 7 129 53');
  r := r || pg_temp.chk('T46', 'a support agent cannot read the Codes page', pg_temp.run_as(a_spt, 'select public.admin_list_promo_codes()::text'), 'ERR: Finance admins only');
  t := pg_temp.run_as(v_o, 'select public.my_tutor_code()::text');
  r := r || pg_temp.chk('T47', 'the tutor''s own page after the switch is on: bonus on, 5 percent, 12 months, 3 families, 7 lessons, R129; and no family is named in it',
    pg_temp.run_as(v_o, $q$select concat_ws(' ', x->>'bonus_on', x->>'bonus_percent', x->>'bonus_months', x->>'families', x->>'bonus_lessons', x->>'bonus_rand') from (select public.my_tutor_code() as x) s$q$)
    || ' / ' || (position(p1::text in t) = 0 and position(p3::text in t) = 0 and position(p6::text in t) = 0)::text, 'true 5 12 3 7 129 / true');
  r := r || pg_temp.chk('T49', 'the internal functions are closed to every signed-in user and visitor',
    (position('permission denied' in pg_temp.run_as(v_o, format('select public.tutor_bonus_pay(%L)::text', s_1))) > 0)::text || ' '
    || (position('permission denied' in pg_temp.run_as(p1, format('select public.create_tutor_personal_code(%L, null, null)::text', v_o))) > 0)::text || ' '
    || (position('permission denied' in pg_temp.run_as(null, format('select public.tutor_bonus_take_back(%L, 1, 1, true, %L)::text', s_1, gen_random_uuid()))) > 0)::text, 'true true true');

  exception when others then
    r := r || format('STOPPED EARLY by an unexpected error: %s', sqlerrm) || E'\n';
  end;

  -- The Supabase tool shows only the START and the END of a long error. So: the passing ids are one short line, a failing check is printed in full, and the verdict and
  -- the NAMES of the failing checks come LAST. "N of 45 checks ran" is less than 45 when the suite stopped early (the stop is then also named).
  select count(*) filter (where l ~ '^T[0-9]+ '),
         count(*) filter (where l ~ '^T[0-9]+ ' and l like '% FAIL (want %'),
         string_agg(split_part(l, ' ', 1), ' ') filter (where l ~ '^T[0-9]+ ' and l not like '% FAIL (want %'),
         string_agg(l, E'\n') filter (where l like '% FAIL (want %' or l like 'STOPPED%'),
         string_agg(case when l like 'STOPPED%' then 'STOPPED-EARLY' else split_part(l, ' ', 1) end, ', ') filter (where l like '% FAIL (want %' or l like 'STOPPED%')
    into nlines, nfail, okids, rep, failnames
    from regexp_split_to_table(r, E'\n') as l;
  raise exception E'TUTOR CODES AND BONUS (rolled back, nothing kept)\nPASSED: %\n%\nRESULT tutor bonus: % of 45 checks ran, % FAIL\nFAILING: %',
    coalesce(okids, 'none'), coalesce(rep, '(no failing line)'), nlines, nfail, coalesce(failnames, 'none');
end $$;
