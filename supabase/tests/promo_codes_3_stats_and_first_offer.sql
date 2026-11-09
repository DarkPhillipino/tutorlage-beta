-- PROMO CODES, database suite, chunk 3 of 3: the Codes page numbers for one family; editing; no renaming; the referring tutor gets the first offer (shipped switched off) (P75, P78, P79, P80 to P93; 17 checks). Read supabase/tests/README.md first.
-- RUN IT AFTER the three migrations are applied (20261105200000, 20261105200100, 20261105200200): paste this one file whole into the Supabase execute_sql tool.
-- It is ONE statement that makes made-up people (example.invalid), a made-up school, the subject "Zorology" and codes starting ZZ, acts as them, and ends with an error
-- on purpose, which rolls back EVERYTHING it made (nothing is kept, nothing is sent: the Paystack calls the expiry job would queue are rolled back with it).
-- The verdict is the END of the error text: "RESULT chunk 3 of 3: N of 17 checks ran, M FAIL" and then "FAILING: <names>" (or none). Every check line ends " ok" or " FAIL (want ...)".
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

  -- ---- people: three admins, two able tutors, a school and the subject; two codes (one names the referring tutor); two families and their children -------------------------
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
  k_stat := pg_temp.mkcode(a_fin, 'ZZSTAT', 'statistics');
  k_tutor := pg_temp.mkcode(a_fin, 'ZZTUTOR', 'the referring tutor''s own code', 'null', 'null', 'null', quote_literal(v_t::text));
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (p11, z, 'authenticated', 'authenticated', 'pc.p11.' || p11 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pol', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', 'zzstat'), '{}'),
    (p14, z, 'authenticated', 'authenticated', 'pc.p14.' || p14 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pia', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', 'zztutor'), '{}');
  update profiles set date_of_birth = adult::date where id in (p11, p14);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (c11, z, 'authenticated', 'authenticated', 'pc.c11.' || c11 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Cob', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', p11, 'relationship', 'mother')),
    (c14, z, 'authenticated', 'authenticated', 'pc.c14.' || c14 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Cef', 'date_of_birth', minor), jsonb_build_object('created_by_guardian', p14, 'relationship', 'mother'));
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (c14, 'Zorology', 'Grade 10') returning id into e14;
  perform pg_temp.top(p14, 1000);
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (c11, 'Zorology', 'Grade 10') returning id into e11;
  perform pg_temp.top(p11, 1000);

  -- ---- the Codes page numbers: one family, one code, known lessons -------------------------------------------------------------------------------------------------------
  qx := pg_temp.mkreq(p11, c11, e11, 50, '1A', 1);
  qy := pg_temp.mkreq(p11, c11, e11, 150, '1D', 1);
  qz := pg_temp.mkreq(p11, c11, e11, 50, '1A', 1);
  perform pg_temp.send(p11, qx);
  perform pg_temp.send(p11, qy);
  perform pg_temp.send(p11, qz);
  perform pg_temp.try_claim(qx, v_t);
  perform pg_temp.try_claim(qy, v_t);
  perform pg_temp.try_claim(qz, v_t);
  perform pg_temp.done(pg_temp.sess(qx));
  perform pg_temp.run_as(p11, format('select (select 1 from (select public.cancel_session(%L, ''x'')) x)::text', pg_temp.sess(qz)));
  j := pg_temp.run_as(a_fin, $q$select public.admin_list_promo_codes()::text$q$)::jsonb;
  select e into t2 from jsonb_array_elements(j) e where e ->> 'code' = 'ZZSTAT';
  r := r || pg_temp.chk('P75', 'the Codes page, one family: 1 sign-up, 2 lessons booked (1 done, 1 coming), 1 returned, R20 committed, R5 really given',
    concat_ws(' ', (t2::jsonb ->> 'signups'), (t2::jsonb ->> 'lessons_booked'), (t2::jsonb ->> 'lessons_completed'), (t2::jsonb ->> 'lessons_returned'), (t2::jsonb ->> 'rand_booked'), (t2::jsonb ->> 'rand_given')), '1 2 1 1 20 5');
  -- editing: the new numbers count from the next request; the code itself cannot change
  n := pg_temp.audits();
  t := pg_temp.run_as(a_fin, format('select public.admin_update_promo_code(%L, ''statistics'', 15, 5, now() - interval ''1 day'', null, null, null, true)::text', k_stat));   -- (own statements: a lookup in the same expression cannot see what a function in it changed)
  t2 := pg_temp.run_as(a_spt, format('select public.admin_update_promo_code(%L, ''x'', 15, 5, now(), null, null, null, true)::text', k_stat));
  r := r || pg_temp.chk('P78', 'a finance admin changes the percent and the lessons of a code (audited); a support agent cannot',
    t || ' / ' || (select percent_off || ' ' || uses_per_account from promo_codes where id = k_stat) || ' / ' || (pg_temp.audits() - n) || ' / ' || t2, ' / 15 5 / 1 / ERR: Finance admins only');
  begin
    update promo_codes set code = 'ZZRENAMED' where id = k_stat;
    t := 'renamed';
  exception when others then
    t := sqlerrm;
  end;
  r := r || pg_temp.chk('P79', 'a code cannot be renamed, not even by the owner of the table', t, 'A code cannot be renamed. Make a new one and pause this one.');

  -- ---- the referring tutor gets the first offer (20261105200200) ---------------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('P80', 'the family that came with the tutor''s code is attached to it; the main code names no tutor, so its requests are never reserved',
    (select (promo_code_id = k_tutor)::text from profiles where id = p14) || ' / ' || (select count(*) from session_requests where requested_by_profile_id = p11 and first_offer_tutor_id is not null), 'true / 0');
  -- PM decision 5 Nov 2026: the first offer ships SWITCHED OFF. The window is a number of minutes; 0 (the shipped default) means off, and a request then behaves exactly as today.
  r := r || pg_temp.chk('P90', 'shipped switched off: the setting is 0 and the window is 0 minutes', (select setting_value::text from system_settings where setting_key = 'promo_first_offer_minutes') || ' ' || (extract(epoch from public.promo_first_offer_interval()) / 60)::int, '0 0');
  -- (P90 reads the setting as it is now: 0 while the first offer is switched off. Everything below sets the window itself, so it holds whatever the setting is. If the CEO has switched the
  --  first offer on, P90 is EXPECTED to fail with "60 60"; that is the setting, not a bug.)
  update system_settings set setting_value = '0'::jsonb where setting_key = 'promo_first_offer_minutes';
  qf0 := pg_temp.mkreq(p14, c14, e14, 50, '1A', 1);
  perform pg_temp.send(p14, qf0);
  r := r || pg_temp.chk('P91', 'with the window at 0 the family''s first request is NOT reserved (still R45): both equally able tutors see it, and nobody is told it is theirs',
    (select coalesce(first_offer_tutor_id::text, 'none') || ' ' || wallet_hold_rand from session_requests where id = qf0) || ' / ' || pg_temp.inbox(qf0, v_t) || ' ' || pg_temp.inbox(qf0, v_t3) || ' / ' || pg_temp.nn(v_t, 'request_for_you', '%A family who signed up with your code%'),
    'none 45 / 1 1 / 0');
  update session_requests set status = 'cancelled' where id = qf0;
  -- the CEO turns it on with a typed yes (the recommended value is 60)
  update system_settings set setting_value = '60'::jsonb where setting_key = 'promo_first_offer_minutes';
  qf1 := pg_temp.mkreq(p14, c14, e14, 50, '1A', 1);
  perform pg_temp.send(p14, qf1);
  r := r || pg_temp.chk('P81', 'the first request is reserved for the referring tutor (and still discounted: R45); she sees it, the other equally able tutor does not',
    (select (first_offer_tutor_id = v_t)::text || ' ' || wallet_hold_rand from session_requests where id = qf1) || ' / ' || pg_temp.inbox(qf1, v_t) || ' ' || pg_temp.inbox(qf1, v_t3), 'true 45 / 1 0');
  r := r || pg_temp.chk('P82', 'the other tutor is refused with the same plain words as for any request that is taken (nobody learns why)', pg_temp.try_claim(qf1, v_t3), 'Another tutor already accepted this request, or it is no longer available.');
  r := r || pg_temp.chk('P83', 'she is told once that a family who signed up with her code sent a request, and for how long',
    pg_temp.nn(v_t, 'request_for_you', '%A family who signed up with your code%for 60 minutes%') || ' ' || pg_temp.nn(v_t3, 'request_for_you', '%'), '1 0');
  update session_requests set created_at = now() - interval '61 minutes' where id = qf1;
  r := r || pg_temp.chk('P84', 'the window is a setting (60 minutes): after it the other tutor sees the request', pg_temp.inbox(qf1, v_t) || ' ' || pg_temp.inbox(qf1, v_t3), '1 1');
  update session_requests set created_at = now() where id = qf1;
  t := pg_temp.try_claim(qf1, v_t);
  r := r || pg_temp.chk('P85', 'she accepts inside the window: booked, discounted, her pay unchanged (R35)', t || ' / ' || pg_temp.money(qf1), 'accepted (already_paid) / 45/35/10/5/15');
  qf2 := pg_temp.mkreq(p14, c14, e14, 50, '1A', 1);
  perform pg_temp.send(p14, qf2);
  r := r || pg_temp.chk('P86', 'once the account has a booked lesson the next request is not reserved (keep-or-swap as before): both tutors see it', (select coalesce(first_offer_tutor_id::text, 'none') from session_requests where id = qf2) || ' / ' || pg_temp.inbox(qf2, v_t) || ' ' || pg_temp.inbox(qf2, v_t3), 'none / 1 1');
  -- a family with no lesson yet: if the referring tutor could NOT take the request, nothing is reserved (it never becomes invisible)
  p15 := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (p15, z, 'authenticated', 'authenticated', 'pc.p15.' || p15 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pip', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', 'ZZTUTOR'), '{}');
  update profiles set date_of_birth = adult::date where id = p15;
  perform pg_temp.top(p15, 500);
  qf3 := pg_temp.mkreq(p15, c14, e14, 50, '1A', 1);
  update tutor_profiles set is_verified = false where id = v_t;
  perform pg_temp.send(p15, qf3);
  r := r || pg_temp.chk('P87', 'the referring tutor is not available (not verified): the request is open to everyone from the start, and she is not told it is hers',
    pg_temp.inbox(qf3, v_t3) || ' / ' || pg_temp.nn(v_t, 'request_for_you', '%A family who signed up with your code%'), '1 / 1');
  update tutor_profiles set is_verified = true where id = v_t;
  r := r || pg_temp.chk('P88', 'nobody who is signed in can set the first-offer tutor of a request',
    pg_temp.run_as(p15, format('with u as (update public.session_requests set first_offer_tutor_id = %L where id = %L returning 1) select count(*)::text from u', v_t3, qf3)) || ' / ' || (select (first_offer_tutor_id = v_t)::text from session_requests where id = qf3), '0 / true');
  r := r || pg_temp.chk('P89', 'switched on by the CEO the window is the number of minutes in system_settings (60)',
    (select setting_value::text from system_settings where setting_key = 'promo_first_offer_minutes') || ' ' || (extract(epoch from public.promo_first_offer_interval()) / 60)::int, '60 60');
  -- switching it off again opens a reserved request to everyone at once; a setting that is not a number (or is negative) means off, never a surprise window
  qf4 := pg_temp.mkreq(p15, c14, e14, 50, '1A', 1);
  perform pg_temp.send(p15, qf4);
  t := pg_temp.inbox(qf4, v_t) || ' ' || pg_temp.inbox(qf4, v_t3);
  update system_settings set setting_value = '0'::jsonb where setting_key = 'promo_first_offer_minutes';
  t2 := pg_temp.inbox(qf4, v_t) || ' ' || pg_temp.inbox(qf4, v_t3);
  update system_settings set setting_value = '"soon"'::jsonb where setting_key = 'promo_first_offer_minutes';
  t3 := (extract(epoch from public.promo_first_offer_interval()) / 60)::int::text;
  update system_settings set setting_value = '-5'::jsonb where setting_key = 'promo_first_offer_minutes';
  t3 := t3 || ' ' || (extract(epoch from public.promo_first_offer_interval()) / 60)::int;
  r := r || pg_temp.chk('P92', 'a request reserved inside the window is hidden from the other tutor (1 0); at 0 it is open to both (1 1); a word or a negative number means off (0 0)', t || ' / ' || t2 || ' / ' || t3, '1 0 / 1 1 / 0 0');
  update system_settings set setting_value = '60'::jsonb where setting_key = 'promo_first_offer_minutes';
  qf4 := pg_temp.mkreq(p15, c14, e14, 50, '1A', 1);
  perform pg_temp.send(p15, qf4);
  r := r || pg_temp.chk('P93', 'turned on again, a new request of a family with no lesson is reserved for her again', (select (first_offer_tutor_id = v_t)::text from session_requests where id = qf4) || ' ' || pg_temp.inbox(qf4, v_t3), 'true 0');

  exception when others then
    r := r || format('STOPPED EARLY by an unexpected error: %s', sqlerrm) || E'\n';
  end;

  -- The Supabase tool shows only the START and the END of a long error. So: the passing ids are one short line, a failing check is printed in full, and the verdict and
  -- the NAMES of the failing checks come LAST. "N of 17 checks ran" is less than 17 when the chunk stopped early (the stop is then also named).
  select count(*) filter (where l ~ '^P[0-9]+ '),
         count(*) filter (where l ~ '^P[0-9]+ ' and l like '% FAIL (want %'),
         string_agg(split_part(l, ' ', 1), ' ') filter (where l ~ '^P[0-9]+ ' and l not like '% FAIL (want %'),
         string_agg(l, E'\n') filter (where l like '% FAIL (want %' or l like 'STOPPED%'),
         string_agg(case when l like 'STOPPED%' then 'STOPPED-EARLY' else split_part(l, ' ', 1) end, ', ') filter (where l like '% FAIL (want %' or l like 'STOPPED%')
    into nlines, nfail, okids, rep, failnames
    from regexp_split_to_table(r, E'\n') as l;
  raise exception E'PROMO CHUNK 3 of 3 (rolled back, nothing kept)\nPASSED: %\n%\nRESULT chunk 3 of 3: % of 17 checks ran, % FAIL\nFAILING: %',
    coalesce(okids, 'none'), coalesce(rep, '(no failing line)'), nlines, nfail, coalesce(failnames, 'none');
end $$;
