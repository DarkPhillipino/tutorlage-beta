-- PROMO CODES, database suite, chunk 2 of 3: the money: the maths at 1A, 1D and 2C, lessons 1 to 3 then full price, the use coming back, the card path, the flags, the Codes page agrees with the tables (P37 to P74, P76, P77; 40 checks). Read supabase/tests/README.md first.
-- RUN IT AFTER the three migrations are applied (20261105200000, 20261105200100, 20261105200200): paste this one file whole into the Supabase execute_sql tool.
-- It is ONE statement that makes made-up people (example.invalid), a made-up school, the subject "Zorology" and codes starting ZZ, acts as them, and ends with an error
-- on purpose, which rolls back EVERYTHING it made (nothing is kept, nothing is sent: the Paystack calls the expiry job would queue are rolled back with it).
-- The verdict is the END of the error text: "RESULT chunk 2 of 3: N of 40 checks ran, M FAIL" and then "FAILING: <names>" (or none). Every check line ends " ok" or " FAIL (want ...)".
-- The three chunks do not depend on each other. A check that FAILS is either a real bug in the migration or a mistake in the check: read the line before deciding.
-- Real data cannot change a count (fixtures are new rows; counts are of those rows or relative to a baseline taken first). Time is not faked: requests are for days two to three
-- weeks ahead; "a session that has ended" is made by moving its start back. The audit log is the real one (rows are counted before and after, then rolled back).
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  minor text := (current_date - interval '10 years')::date::text;
  a_fin uuid := gen_random_uuid();  -- finance_manager
  a_sup uuid := gen_random_uuid();  -- super_admin
  a_spt uuid := gen_random_uuid();  -- support_agent
  v_t uuid := gen_random_uuid();    -- a verified tutor at level 2C (can take 1A, 1D and 2C requests), police clearance, approved for Zorology, free every day
  v_t2 uuid := gen_random_uuid();   -- a second tutor (signs up with a code: nothing must be stored)
  v_t3 uuid := gen_random_uuid();   -- a third tutor, just as able as v_t (competes for the referring tutor's requests)
  p14 uuid := gen_random_uuid();    -- a family that came with a code that NAMES the referring tutor (v_t)
  c14 uuid := gen_random_uuid(); e14 uuid; k_tutor uuid; qf0 uuid; qf1 uuid; qf2 uuid; qf3 uuid; qf4 uuid; p15 uuid;
  p1 uuid := gen_random_uuid();     -- signs up with "zzmain" (lower case): the main family
  p2 uuid := gen_random_uuid();     -- no code: the control family
  p3 uuid := gen_random_uuid();     -- an unknown code typed at sign-up
  p4 uuid := gen_random_uuid();     -- " ZZMAIN " with spaces: the family for returns, pause and the family cap
  p5 uuid := gen_random_uuid();     -- the first (and only) family of the capped code
  p6 uuid := gen_random_uuid();     -- turned away by the cap
  p7 uuid := gen_random_uuid();     -- paused code at sign-up
  p8 uuid := gen_random_uuid();     -- expired code at sign-up
  p9 uuid := gen_random_uuid();     -- signs up without a code, claims it right after (the Google way)
  p10 uuid := gen_random_uuid();    -- an account older than a day
  p11 uuid := gen_random_uuid();    -- the statistics family (own code)
  p12 uuid := gen_random_uuid();    -- a small wallet
  p13 uuid := gen_random_uuid();    -- the rounding family (own code) and the card request
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c4 uuid := gen_random_uuid(); c11 uuid := gen_random_uuid(); c12 uuid := gen_random_uuid(); c13 uuid := gen_random_uuid();
  k_main uuid; k_pause uuid; k_exp uuid; k_cap uuid; k_stat uuid; k_round uuid; k_small uuid;
  c_caps uuid; s1 uuid;
  e1 uuid; e2 uuid; e4 uuid; e11 uuid; e12 uuid; e13 uuid;
  qa uuid; qd uuid; qc uuid; q4 uuid; q5 uuid; q6 uuid; q7 uuid; q8 uuid; qx uuid; qy uuid; qz uuid; qr uuid;
  s_a uuid; s_d uuid; s_c uuid; s_4 uuid;
  t text; t2 text; j jsonb; n int; n2 int; nfail int; nlines int; rep text; i int; t3 text; a0 int; okids text; failnames text;
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
  -- a request in the state a new one starts in ('initiated'); at a level and price; optionally addressed to a tutor
  execute $mk$
    create function pg_temp.mkreq(p_by uuid, p_stu uuid, p_enr uuid, p_price numeric, p_level text default '1A', p_tier int default 1, p_addr uuid default null) returns uuid language plpgsql as $f$
    declare v uuid;
    begin
      insert into public.session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference,
             min_sub_tier_id, tier_id, charged_amount, institution_id, requested_tutor_id, expires_at, currency_code)
      values (p_stu, p_enr, p_by, pg_temp.slot(pg_temp.nxt()), 1, 'pending', 'initiated', 'pc_' || gen_random_uuid(), p_level, p_tier, p_price,
              (select id from public.schools_institutions where name = 'ZZ Promo test school'), p_addr,
              case when p_addr is null then null else now() + interval '48 hours' end, 'ZAR')
      returning id into v;
      return v;
    end $f$ $mk$;
  -- held / discount / available, as the booking screen's send reports them
  execute $mk$
    create function pg_temp.send(p_u uuid, p_q uuid) returns text language sql as $f$
      select pg_temp.run_as(p_u, format('select concat_ws(''/'', x->>''held_rand'', x->>''discount_rand'', x->>''available_rand'') from (select public.send_request_wallet(%L) as x) s', p_q)) $f$ $mk$;
  -- applies / pay / discount / lesson / of, as the booking screen's quote reports them
  execute $mk$
    create function pg_temp.quote(p_u uuid, p_list int) returns text language sql as $f$
      select pg_temp.run_as(p_u, format('select concat_ws(''/'', q->>''applies'', q->>''pay_rand'', q->>''discount_rand'', q->>''lesson_number'', q->>''lessons'') from (select public.my_promo_quote(%s) as q) s', p_list)) $f$ $mk$;
  execute $mk$ create function pg_temp.wb(p uuid) returns text language sql as $f$
      select coalesce((select available_rand || '/' || held_rand from public.wallets where profile_id = p), '0/0') $f$ $mk$;
  execute $mk$ create function pg_temp.nl(p_key text) returns int language sql as $f$
      select count(*)::int from public.wallet_ledger where idempotency_key = p_key $f$ $mk$;
  execute $mk$ create function pg_temp.nn(p_profile uuid, p_type text, p_like text) returns int language sql as $f$
      select count(*)::int from public.notifications where profile_id = p_profile and type = p_type and body like p_like $f$ $mk$;
  -- does this tutor see this request in their requests? (1 or 0)
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
  execute $mk$ create function pg_temp.top(p_profile uuid, p_amount int) returns void language sql as $f$
      select public.wallet_post(p_profile, 'topup', p_amount, 0, 'pc-top:' || gen_random_uuid(), null, 'test top-up') $f$ $mk$;
  -- the session of a request, and what it stored: gross / tutor pay / Tutorlage's share / the discount / the commission on the request
  execute $mk$ create function pg_temp.sess(p_q uuid) returns uuid language sql as $f$
      select resulting_session_id from public.session_requests where id = p_q $f$ $mk$;
  execute $mk$ create function pg_temp.money(p_q uuid) returns text language sql as $f$
      select s.gross_amount::int || '/' || s.tutor_payout_amount::int || '/' || (s.gross_amount - s.tutor_payout_amount)::int || '/' || s.promo_discount_rand || '/' || q.commission_amount::int
        from public.sessions s join public.session_requests q on q.resulting_session_id = s.id where q.id = p_q $f$ $mk$;
  -- the use row of a request: lesson / rand off / returned / tied to a session
  execute $mk$ create function pg_temp.use(p_q uuid) returns text language sql as $f$
      select coalesce((select lesson_number || '/' || amount_off || '/' || (returned_at is not null) || '/' || (session_id is not null) from public.promo_code_uses where request_id = p_q), 'none') $f$ $mk$;
  execute $mk$ create function pg_temp.done(p_s uuid) returns void language plpgsql as $f$
      begin update public.sessions set scheduled_start = now() - interval '3 hours' where id = p_s; update public.sessions set status = 'completed' where id = p_s; update public.tutor_profiles set current_tier_id = 2, current_sub_tier_id = '2C' where id = (select tutor_id from public.sessions where id = p_s); end $f$ $mk$;
  execute $mk$ create function pg_temp.audits() returns int language sql as $f$
      select count(*)::int from public.admin_audit_logs where action::text in ('promo_code_created', 'promo_code_changed', 'promo_code_attached') $f$ $mk$;
  execute $mk$ create function pg_temp.mkcode(p_by uuid, p_code text, p_label text, p_from text default 'null', p_until text default 'null', p_max text default 'null', p_tutor text default 'null') returns uuid language plpgsql as $f$
    declare v text;
    begin
      v := pg_temp.run_as(p_by, format('select public.admin_create_promo_code(%L, %L, 10, 3, (%s)::timestamptz, (%s)::timestamptz, (%s)::int, (%s)::uuid)::text', p_code, p_label, p_from, p_until, p_max, p_tutor));
      return v::uuid;
    end $f$ $mk$;

  -- ---- people: three admins, two able tutors, a school and the subject; three codes; six families and their children ----------------------------------------------------
  select id into c_caps from curricula where code = 'CAPS';
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (a_fin, z, 'authenticated', 'authenticated', 'pc.a1.' || a_fin || '@example.invalid', '{}'::jsonb, '{}'),
    (a_sup, z, 'authenticated', 'authenticated', 'pc.a2.' || a_sup || '@example.invalid', '{}'::jsonb, '{}'),
    (a_spt, z, 'authenticated', 'authenticated', 'pc.a3.' || a_spt || '@example.invalid', '{}'::jsonb, '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (a_fin, 'Fin', 'Manager', 'pc.a1.' || a_fin || '@example.invalid', '', 'finance_manager', true),
    (a_sup, 'Sup', 'Admin', 'pc.a2.' || a_sup || '@example.invalid', '', 'super_admin', true),
    (a_spt, 'Spt', 'Agent', 'pc.a3.' || a_spt || '@example.invalid', '', 'support_agent', true);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_t, z, 'authenticated', 'authenticated', 'pc.t.' || v_t || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tess', 'date_of_birth', adult), '{}');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_t3, z, 'authenticated', 'authenticated', 'pc.t3.' || v_t3 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tom', 'date_of_birth', adult), '{}');
  update profiles set date_of_birth = adult::date where id in (v_t, v_t3);
  update tutor_profiles set current_tier_id = 2, current_sub_tier_id = '2C', institution_id = null, is_verified = true where id in (v_t, v_t3);
  insert into tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
    select tt, 'police_clearance'::public.doc_type, 'fixture/police-' || tt, 'verified'::public.verification_status, (now() at time zone 'Africa/Johannesburg')::date from unnest(array[v_t, v_t3]) tt;
  insert into schools_institutions (name, curriculum, curriculum_id) values ('ZZ Promo test school', 'caps', c_caps) returning id into s1;
  insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
    select tt, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified' from unnest(array[v_t, v_t3]) tt;
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) select tt, d, '00:00', '24:00' from unnest(array[v_t, v_t3]) tt, generate_series(0, 6) d;
  update system_settings set setting_value = 'false'::jsonb where setting_key = 'free_sessions_enabled';
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'wallet_payments_enabled';
  a0 := pg_temp.audits();
  r := r || 'S0 setup: 3 admins, two tutors at level 2C, a made-up school and subject' || E'\n';
  k_main := pg_temp.mkcode(a_fin, 'zzmain', 'faculty test');
  k_round := pg_temp.mkcode(a_fin, 'ZZROUND', 'rounding');
  k_small := pg_temp.mkcode(a_fin, 'ZZSMALL', 'small wallet');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (p1, z, 'authenticated', 'authenticated', 'pc.p1.' || p1 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pia', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', 'zzmain'), '{}'),
    (p2, z, 'authenticated', 'authenticated', 'pc.p2.' || p2 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pam', 'date_of_birth', adult, 'phone_number', '081 234 5678'), '{}'),
    (p4, z, 'authenticated', 'authenticated', 'pc.p4.' || p4 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pip', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', ' ZZMAIN '), '{}'),
    (p9, z, 'authenticated', 'authenticated', 'pc.p9.' || p9 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pax', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', 'zzmain'), '{}'),
    (p12, z, 'authenticated', 'authenticated', 'pc.p12.' || p12 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pia', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', 'ZZSMALL'), '{}'),
    (p13, z, 'authenticated', 'authenticated', 'pc.p13.' || p13 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pru', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', 'ZZROUND'), '{}');
  update profiles set date_of_birth = adult::date where id in (p1, p2, p4, p9, p12, p13);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (c1, z, 'authenticated', 'authenticated', 'pc.c1.' || c1 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Cai', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', p1, 'relationship', 'mother')),
    (c2, z, 'authenticated', 'authenticated', 'pc.c2.' || c2 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Cam', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', p2, 'relationship', 'mother')),
    (c4, z, 'authenticated', 'authenticated', 'pc.c4.' || c4 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Cal', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', p4, 'relationship', 'mother')),
    (c12, z, 'authenticated', 'authenticated', 'pc.c12.' || c12 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Cyd', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', p12, 'relationship', 'mother')),
    (c13, z, 'authenticated', 'authenticated', 'pc.c13.' || c13 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Cas', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', p13, 'relationship', 'mother'));
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (c1, 'Zorology', 'Grade 10') returning id into e1;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (c2, 'Zorology', 'Grade 10') returning id into e2;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (c4, 'Zorology', 'Grade 10') returning id into e4;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (c12, 'Zorology', 'Grade 10') returning id into e12;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (c13, 'Zorology', 'Grade 10') returning id into e13;
  perform pg_temp.top(p1, 1000);
  perform pg_temp.top(p2, 1000);
  perform pg_temp.top(p4, 1000);
  perform pg_temp.top(p13, 1000);

  -- ---- the money: three lessons at a discount, then full price; the tutor's pay never changes ---------------------------------------------------------------------------
  qa := pg_temp.mkreq(p1, c1, e1, 50, '1A', 1);
  qd := pg_temp.mkreq(p1, c1, e1, 150, '1D', 1);
  qc := pg_temp.mkreq(p1, c1, e1, 280, '2C', 2);
  r := r || pg_temp.chk('P37', '1A: sent at R45 (R5 off), R955 left', pg_temp.send(p1, qa), '45/5/955');
  select payment_status || ' ' || paid_from_wallet || ' ' || wallet_hold_rand || ' ' || promo_discount_rand || ' ' || charged_amount::int into t from session_requests where id = qa;
  r := r || pg_temp.chk('P38', 'the request is verified and wallet-held at R45, carries the R5, and still names the level price R50', t || ' / ' || pg_temp.wb(p1) || ' / ' || pg_temp.use(qa), 'card_verified true 45 5 50 / 955/45 / 1/5/false/false');
  r := r || pg_temp.chk('P39', 'the tutor sees the request at the level price, R50, not R45',
    pg_temp.run_as(v_t, format('select charged_amount::int::text from public.available_requests_for_tutor() where id = %L', qa)), '50');
  r := r || pg_temp.chk('P40', 'a second send changes nothing and takes no second use', pg_temp.send(p1, qa) || ' / ' || pg_temp.wb(p1) || ' / ' || (select count(*) from promo_code_uses where profile_id = p1), '45/5 / 955/45 / 1');
  r := r || pg_temp.chk('P41', 'the tutor accepts', pg_temp.try_claim(qa, v_t), 'accepted (already_paid)');
  r := r || pg_temp.chk('P42', '1A booked: the parent paid R45, the tutor will get R35 (as without a code), Tutorlage keeps R10; the commission is still R15 on R50; the session carries the R5',
    pg_temp.money(qa), '45/35/10/5/15');
  r := r || pg_temp.chk('P43', 'the use is tied to the session; the charge line took the R45 from the hold', pg_temp.use(qa) || ' / ' || pg_temp.wb(p1) || ' / ' || (select kind || ' ' || held_delta from wallet_ledger where idempotency_key = 'charge:' || qa), '1/5/false/true / 955/0 / charge -45');
  s_a := pg_temp.sess(qa);
  perform pg_temp.done(s_a);
  r := r || pg_temp.chk('P44', '1A completed: the tutor is credited R35 once', (select available_delta::text from wallet_ledger where idempotency_key = 'credit:' || s_a) || ' / ' || pg_temp.wb(v_t), '35 / 35/0');
  r := r || pg_temp.chk('P45', '1D: sent at R135 (R15 off), lesson 2', pg_temp.send(p1, qd) || ' / ' || pg_temp.use(qd), '135/15/820 / 2/15/false/false');
  perform pg_temp.try_claim(qd, v_t);
  r := r || pg_temp.chk('P46', '1D booked: parent R135, tutor R105, Tutorlage R30, commission R45 on R150', pg_temp.money(qd), '135/105/30/15/45');
  s_d := pg_temp.sess(qd);
  perform pg_temp.done(s_d);
  r := r || pg_temp.chk('P47', '1D completed: the tutor''s wallet is R140 (35 + 105)', pg_temp.wb(v_t), '140/0');
  r := r || pg_temp.chk('P48', '2C: sent at R252 (R28 off), lesson 3', pg_temp.send(p1, qc) || ' / ' || pg_temp.use(qc), '252/28/568 / 3/28/false/false');
  perform pg_temp.try_claim(qc, v_t);
  r := r || pg_temp.chk('P49', '2C booked: parent R252, tutor R207 (the 26% commission R72.80 rounds to R73, as for everyone), Tutorlage R45', pg_temp.money(qc), '252/207/45/28/73');
  s_c := pg_temp.sess(qc);
  perform pg_temp.done(s_c);
  r := r || pg_temp.chk('P50', '2C completed: the tutor''s wallet is R347 (140 + 207)', pg_temp.wb(v_t), '347/0');
  r := r || pg_temp.chk('P51', 'the 4th lesson: no discount offered', pg_temp.quote(p1, 50), 'false');
  q4 := pg_temp.mkreq(p1, c1, e1, 50, '1A', 1);
  r := r || pg_temp.chk('P52', 'the 4th lesson is sent at the full R50', pg_temp.send(p1, q4) || ' / ' || pg_temp.use(q4), '50/0/518 / none');
  perform pg_temp.try_claim(q4, v_t);
  r := r || pg_temp.chk('P53', 'the 4th lesson at full price: parent R50, tutor R35, Tutorlage R15, no discount, no use (the same tutor pay as with a code)', pg_temp.money(q4), '50/35/15/0/15');
  -- the control: a family with no code, same 1A and 2C lessons: the tutor's pay is the same figures as above
  qx := pg_temp.mkreq(p2, c2, e2, 50, '1A', 1);
  qy := pg_temp.mkreq(p2, c2, e2, 280, '2C', 2);
  perform pg_temp.send(p2, qx);
  perform pg_temp.send(p2, qy);
  perform pg_temp.try_claim(qx, v_t);
  perform pg_temp.try_claim(qy, v_t);
  r := r || pg_temp.chk('P54', 'a family with no code: 1A and 2C at full price, the tutor gets the same R35 and R207', pg_temp.money(qx) || ' ' || pg_temp.money(qy), '50/35/15/0/15 280/207/73/0/73');
  r := r || pg_temp.chk('P55', 'the code family''s three lessons are all counted (live); nothing was returned', (select count(*) from promo_code_uses where profile_id = p1 and returned_at is null)::text || ' / ' || (select count(*) from promo_code_uses where profile_id = p1 and returned_at is not null), '3 / 0');

  -- ---- a use comes back when the lesson does not happen ---------------------------------------------------------------------------------------------------------------
  q5 := pg_temp.mkreq(p4, c4, e4, 50, '1A', 1);
  perform pg_temp.send(p4, q5);
  r := r || pg_temp.chk('P56', 'a request that is sent takes the use', pg_temp.use(q5) || ' / ' || pg_temp.quote(p4, 50), '1/5/false/false / true/45/5/2/3');
  update session_requests set requested_start = now() - interval '2 hours' where id = q5;
  perform public.expire_stale_paid_requests();
  r := r || pg_temp.chk('P57', 'it expires with nobody: the use is returned, the R45 is back, the notice says R45 (what was held, not R50)',
    pg_temp.use(q5) || ' / ' || pg_temp.wb(p4) || ' / ' || pg_temp.nn(p4, 'request_expired', '%R45 is back in your wallet%') || ' / ' || pg_temp.quote(p4, 50), '1/5/true/false / 1000/0 / 1 / true/45/5/1/3');
  q6 := pg_temp.mkreq(p4, c4, e4, 50, '1A', 1, v_t);
  perform pg_temp.send(p4, q6);
  r := r || pg_temp.chk('P58', 'a request addressed to a tutor takes a use too', pg_temp.use(q6), '1/5/false/false');
  perform pg_temp.run_as(v_t, format('select (select 1 from (select public.decline_session_request(%L)) x)::text', q6));
  r := r || pg_temp.chk('P59', 'the tutor declines: the use is returned, the notice says R45', pg_temp.use(q6) || ' / ' || pg_temp.wb(p4) || ' / ' || pg_temp.nn(p4, 'request_declined', '%R45 is back in your wallet%'), '1/5/true/false / 1000/0 / 1');
  perform pg_temp.run_as(p4, format('select public.resend_request_to_anyone(%L)::text', q6));
  r := r || pg_temp.chk('P60', '"send to anyone" after the decline: a new request, held at R45 again, with its own use (lesson 1)',
    (select count(*) from session_requests where resent_from = q6)::text || ' / ' || (select wallet_hold_rand || ' ' || promo_discount_rand from session_requests where resent_from = q6) || ' / '
    || (select lesson_number || ' ' || amount_off || ' ' || (returned_at is null) from promo_code_uses where request_id = (select id from session_requests where resent_from = q6)) || ' / ' || pg_temp.wb(p4), '1 / 45 5 / 1 5 true / 955/45');
  -- (the resend is a plain wallet request now: cancel it, the use goes back again, and the wallet)
  update session_requests set status = 'cancelled' where resent_from = q6;
  r := r || pg_temp.chk('P61', 'that one cancelled while waiting: use and money back', (select count(*) from promo_code_uses where profile_id = p4 and returned_at is null)::text || ' / ' || pg_temp.wb(p4), '0 / 1000/0');
  q7 := pg_temp.mkreq(p4, c4, e4, 50, '1A', 1);
  perform pg_temp.send(p4, q7);
  t3 := pg_temp.try_claim(q7, v_t);
  s_4 := pg_temp.sess(q7);
  t := pg_temp.run_as(p4, format('select (select 1 from (select public.cancel_session(%L, ''plans changed'')) x)::text', s_4));
  r := r || pg_temp.chk('P62', 'a booked lesson is cancelled by the parent before it starts: refunded what was paid (R45), the use returned, the request wallet_refunded',
    t3 || ' / ' || t || ' / ' || pg_temp.wb(p4) || ' / ' || coalesce((select available_delta::text from wallet_ledger where idempotency_key = 'refund:' || s_4), 'no refund row')
    || ' / ' || pg_temp.use(q7) || ' / ' || (select payment_status from session_requests where id = q7) || ' / ' || pg_temp.quote(p4, 50), 'accepted (already_paid) / 1 / 1000/0 / 45 / 1/5/true/true / wallet_refunded / true/45/5/1/3');
  q8 := pg_temp.mkreq(p4, c4, e4, 50, '1A', 1);
  perform pg_temp.send(p4, q8);
  perform pg_temp.try_claim(q8, v_t);
  perform pg_temp.done(pg_temp.sess(q8));
  r := r || pg_temp.chk('P63', 'a lesson that was delivered keeps its use: lesson 1 of 3 is counted for good', pg_temp.use(q8) || ' / ' || pg_temp.quote(p4, 50), '1/5/false/true / true/45/5/2/3');
  -- four requests sent in a row: three get the discount, the fourth does not; one cancelled gives its place back
  qx := pg_temp.mkreq(p4, c4, e4, 50, '1A', 1);
  qy := pg_temp.mkreq(p4, c4, e4, 50, '1A', 1);
  qz := pg_temp.mkreq(p4, c4, e4, 50, '1A', 1);
  qr := pg_temp.mkreq(p4, c4, e4, 50, '1A', 1);
  r := r || pg_temp.chk('P64', 'four requests sent one after the other: R45, R45, R50, R50 (3 lessons in all counting the delivered one)',
    pg_temp.send(p4, qx) || ' ' || pg_temp.send(p4, qy) || ' ' || pg_temp.send(p4, qz) || ' ' || pg_temp.send(p4, qr), '45/5/910 45/5/865 50/0/815 50/0/765');
  update session_requests set status = 'cancelled' where id = qx;
  r := r || pg_temp.chk('P65', 'one of the discounted ones is cancelled: its place goes back, so the next request is discounted again', pg_temp.use(qx) || ' / ' || pg_temp.quote(p4, 50), '2/5/true/false / true/45/5/3/3');
  -- pause stops everything at once; the end date only stops new families
  perform pg_temp.run_as(a_fin, format('select public.admin_set_promo_code_active(%L, false)::text', k_main));
  r := r || pg_temp.chk('P66', 'a paused code: no discount for anyone, not even a family that has lessons left', pg_temp.quote(p4, 50) || ' ' || pg_temp.quote(p9, 50) || ' / ' || pg_temp.run_as(null, $q$select public.check_promo_code('ZZMAIN')::text$q$), 'false false / {"valid": false}');
  perform pg_temp.run_as(a_fin, format('select public.admin_set_promo_code_active(%L, true)::text', k_main));
  update promo_codes set valid_from = now() - interval '2 days', valid_until = now() - interval '1 hour' where id = k_main;
  r := r || pg_temp.chk('P67', 'a code whose end date has passed: new families are refused, a family already attached keeps its lessons',
    pg_temp.run_as(null, $q$select public.check_promo_code('ZZMAIN')::text$q$) || ' / ' || pg_temp.quote(p4, 50), '{"valid": false} / true/45/5/3/3');
  update promo_codes set valid_until = null where id = k_main;
  -- a wallet that is too small is refused with the shortfall of the DISCOUNTED price, and no use is left behind
  perform pg_temp.top(p12, 20);
  qz := pg_temp.mkreq(p12, c12, e12, 50, '1A', 1);
  r := r || pg_temp.chk('P68', 'R20 in the wallet, R45 to hold: refused in words with the discounted price, and no use is left behind',
    pg_temp.send(p12, qz) || ' / ' || (select count(*) from promo_code_uses where profile_id = p12) || ' / ' || pg_temp.wb(p12) || ' / ' || pg_temp.quote(p12, 50),
    'ERR: Your wallet has R20. This session is R45. Add R25 or more. / 0 / 20/0 / true/45/5/1/3');
  -- the rounding: a half-hour at R25 is R22.50 off the price, which rounds to R23; the tutor's pay is on R25 with the commission rounded as always
  qr := pg_temp.mkreq(p13, c13, e13, 25, '1A', 1);
  r := r || pg_temp.chk('P69', 'R25 (a half hour at 1A): the quote and the hold are R23, R2 off', pg_temp.quote(p13, 25) || ' / ' || pg_temp.send(p13, qr), 'true/23/2/1/3 / 23/2/977');
  perform pg_temp.try_claim(qr, v_t);
  r := r || pg_temp.chk('P70', 'the half hour: parent R23, tutor R17 (30% of R25 is R7.50, rounded to R8), Tutorlage R6', pg_temp.money(qr), '23/17/6/2/8');

  -- ---- a card request is untouched; the flags cannot be set from outside ------------------------------------------------------------------------------------------------
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (c1, e1, p1, pg_temp.slot(pg_temp.nxt()), 1, 'pending', 'card_verified', 'pc_card1', '1A', 1, 50, s1) returning id into qx;
  r := r || pg_temp.chk('P71', 'a card-checked request still goes down the card path, and no use is taken', (position('Add your bank details in your tutor account' in pg_temp.try_claim(qx, v_t)) > 0)::text || ' / ' || pg_temp.use(qx), 'true / none');
  begin
    update session_requests set promo_discount_rand = 5 where id = qx;
    t := 'accepted';
  exception when others then
    t := sqlerrm;
  end;
  r := r || pg_temp.chk('P72', 'a card request can never carry a discount', (position('session_requests_promo_shape' in t) > 0)::text, 'true');
  qy := pg_temp.mkreq(p2, c2, e2, 50, '1A', 1);
  t := pg_temp.run_as(p2, format('with u as (update public.session_requests set promo_discount_rand = 40 where id = %L returning 1) select count(*)::text from u', qy));
  perform pg_temp.run_as(a_fin, format('with u as (update public.session_requests set promo_discount_rand = 40 where id = %L returning 1) select count(*)::text from u', qy));   -- (an admin may or may not reach the row, depending on 20261104210100; either way the guard keeps it at 0)
  r := r || pg_temp.chk('P73', 'a signed-in user cannot give a request a discount: the parent finds no row to change, and after an admin''s attempt too the discount is still 0', t || ' / ' || (select promo_discount_rand from session_requests where id = qy), '0 / 0');
  r := r || pg_temp.chk('P74', 'a parent reads only their own use rows; a finance admin reads all',
    pg_temp.run_as(p1, 'select count(*)::text from public.promo_code_uses') || ' ' || pg_temp.run_as(p2, 'select count(*)::text from public.promo_code_uses') || ' ' || pg_temp.run_as(a_spt, 'select count(*)::text from public.promo_code_uses') || ' '
    || (pg_temp.run_as(a_fin, 'select count(*)::text from public.promo_code_uses')::int = (select count(*) from promo_code_uses))::text, '3 0 0 true');

  -- the Codes page agrees with the tables (the main code: three families, their live lessons and the rand booked)
  j := pg_temp.run_as(a_fin, $q$select public.admin_list_promo_codes()::text$q$)::jsonb;
  select e into t2 from jsonb_array_elements(j) e where e ->> 'code' = 'ZZMAIN';
  r := r || pg_temp.chk('P76', 'and for the main code it agrees with the tables itself',
    concat_ws(' ', (t2::jsonb ->> 'signups'), (t2::jsonb ->> 'lessons_booked'), (t2::jsonb ->> 'rand_booked')),
    concat_ws(' ', (select count(*) from profiles where promo_code_id = k_main), (select count(*) from promo_code_uses where code_id = k_main and returned_at is null), (select sum(amount_off) from promo_code_uses where code_id = k_main and returned_at is null)));
  r := r || pg_temp.chk('P77', 'the page''s numbers are for finance admins only', pg_temp.run_as(a_spt, 'select public.admin_list_promo_codes()::text') || ' / ' || pg_temp.run_as(p1, 'select public.admin_list_promo_codes()::text'), 'ERR: Finance admins only / ERR: Finance admins only');

  exception when others then
    r := r || format('STOPPED EARLY by an unexpected error: %s', sqlerrm) || E'\n';
  end;

  -- The Supabase tool shows only the START and the END of a long error. So: the passing ids are one short line, a failing check is printed in full, and the verdict and
  -- the NAMES of the failing checks come LAST. "N of 40 checks ran" is less than 40 when the chunk stopped early (the stop is then also named).
  select count(*) filter (where l ~ '^P[0-9]+ '),
         count(*) filter (where l ~ '^P[0-9]+ ' and l like '% FAIL (want %'),
         string_agg(split_part(l, ' ', 1), ' ') filter (where l ~ '^P[0-9]+ ' and l not like '% FAIL (want %'),
         string_agg(l, E'\n') filter (where l like '% FAIL (want %' or l like 'STOPPED%'),
         string_agg(case when l like 'STOPPED%' then 'STOPPED-EARLY' else split_part(l, ' ', 1) end, ', ') filter (where l like '% FAIL (want %' or l like 'STOPPED%')
    into nlines, nfail, okids, rep, failnames
    from regexp_split_to_table(r, E'\n') as l;
  raise exception E'PROMO CHUNK 2 of 3 (rolled back, nothing kept)\nPASSED: %\n%\nRESULT chunk 2 of 3: % of 40 checks ran, % FAIL\nFAILING: %',
    coalesce(okids, 'none'), coalesce(rep, '(no failing line)'), nlines, nfail, coalesce(failnames, 'none');
end $$;
