-- PROMO CODES, database suite, chunk 1 of 3: the admin makes codes; the public check and its attempt limit; sign-up; claiming and attaching; who can see what; the quote and the prices (P01 to P36; 36 checks). Read supabase/tests/README.md first.
-- RUN IT AFTER the three migrations are applied (20261105200000, 20261105200100, 20261105200200): paste this one file whole into the Supabase execute_sql tool.
-- It is ONE statement that makes made-up people (example.invalid), a made-up school, the subject "Zorology" and codes starting ZZ, acts as them, and ends with an error
-- on purpose, which rolls back EVERYTHING it made (nothing is kept, nothing is sent: the Paystack calls the expiry job would queue are rolled back with it).
-- The verdict is the END of the error text: "RESULT chunk 1 of 3: N of 36 checks ran, M FAIL" and then "FAILING: <names>" (or none). Every check line ends " ok" or " FAIL (want ...)".
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
      begin update public.sessions set scheduled_start = now() - interval '3 hours' where id = p_s; update public.sessions set status = 'completed' where id = p_s; end $f$ $mk$;
  execute $mk$ create function pg_temp.audits() returns int language sql as $f$
      select count(*)::int from public.admin_audit_logs where action::text in ('promo_code_created', 'promo_code_changed', 'promo_code_attached') $f$ $mk$;
  execute $mk$ create function pg_temp.mkcode(p_by uuid, p_code text, p_label text, p_from text default 'null', p_until text default 'null', p_max text default 'null', p_tutor text default 'null') returns uuid language plpgsql as $f$
    declare v text;
    begin
      v := pg_temp.run_as(p_by, format('select public.admin_create_promo_code(%L, %L, 10, 3, (%s)::timestamptz, (%s)::timestamptz, (%s)::int, (%s)::uuid)::text', p_code, p_label, p_from, p_until, p_max, p_tutor));
      return v::uuid;
    end $f$ $mk$;

  -- ---- people: three admins and a tutor (a code has to exist before the people who sign up with it) --------------------------------------------------------------------
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
  r := r || 'S0 setup: 3 admins (finance, super, support) and a tutor' || E'\n';
  a0 := pg_temp.audits();

  -- ---- the admin makes the codes: who can, what is refused ------------------------------------------------------------------------------------------------------
  k_main := pg_temp.mkcode(a_fin, 'zzmain', 'faculty test');
  r := r || pg_temp.chk('P01', 'a finance admin makes a code (typed in lower case)', (select code || ' ' || percent_off || ' ' || uses_per_account || ' ' || active || ' ' || (created_by = a_fin) from promo_codes where id = k_main), 'ZZMAIN 10 3 true true');
  r := r || pg_temp.chk('P02', 'a support agent cannot make one', pg_temp.run_as(a_spt, $q$select public.admin_create_promo_code('ZZNOPE1', 'x', 10, 3, null, null, null, null)::text$q$), 'ERR: Finance admins only');
  r := r || pg_temp.chk('P03', 'a signed-out visitor cannot even call it', substr(pg_temp.run_as(null, $q$select public.admin_create_promo_code('ZZNOPE1', 'x', 10, 3, null, null, null, null)::text$q$), 1, 36), 'ERR: permission denied for function ');
  r := r || pg_temp.chk('P04', 'the same code in other letters is refused', pg_temp.run_as(a_sup, $q$select public.admin_create_promo_code('ZzMain', 'x', 10, 3, null, null, null, null)::text$q$), 'ERR: That code already exists.');
  r := r || pg_temp.chk('P05', 'a code with a space, or 31 percent, is refused', pg_temp.run_as(a_fin, $q$select public.admin_create_promo_code('ZZ BAD', 'x', 10, 3, null, null, null, null)::text$q$)
    || ' / ' || pg_temp.run_as(a_fin, $q$select public.admin_create_promo_code('ZZBAD31', 'x', 31, 3, null, null, null, null)::text$q$),
    'ERR: A code is 3 to 32 letters, digits, - or _ (no spaces). / ERR: The percent off is between 1 and 30.');
  k_pause := pg_temp.mkcode(a_sup, 'ZZPAUSE', 'paused at once');
  perform pg_temp.run_as(a_fin, format('select public.admin_set_promo_code_active(%L, false)::text', k_pause));
  k_exp := pg_temp.mkcode(a_fin, 'ZZEXPIRE', 'ended yesterday', 'now() - interval ''2 days''', 'now() - interval ''1 day''');
  k_cap := pg_temp.mkcode(a_fin, 'ZZCAP', 'one family only', 'null', 'null', '1');
  k_stat := pg_temp.mkcode(a_fin, 'ZZSTAT', 'statistics');
  k_round := pg_temp.mkcode(a_fin, 'ZZROUND', 'rounding');
  k_small := pg_temp.mkcode(a_fin, 'ZZSMALL', 'small wallet');
  k_tutor := pg_temp.mkcode(a_fin, 'ZZTUTOR', 'the referring tutor''s own code', 'null', 'null', 'null', quote_literal(v_t::text));
  r := r || pg_temp.chk('P06', 'seven more codes: a paused one, one that ended, a capped one, one that names a tutor and three for later', (select count(*) from promo_codes where code like 'ZZ%')::text, '8');
  r := r || pg_temp.chk('P07', 'every create and the pause were audited', (pg_temp.audits() - a0)::text, '9');

  -- ---- the public question: is this code good? -----------------------------------------------------------------------------------------------------------------
  delete from promo_code_attempts where bucket = 'ip:unknown';   -- (rolled back with everything else) the signed-out visitor's count starts at 0 whatever is there
  select count(*) into n2 from promo_code_attempts where bucket = 'ip:unknown';
  r := r || pg_temp.chk('P08', 'a signed-out visitor: valid, 10 percent, 3 lessons (any letters, spaces trimmed)', pg_temp.run_as(null, $q$select concat_ws('/', x->>'valid', x->>'percent', x->>'lessons') from (select public.check_promo_code('  zzMain ') x) s$q$), 'true/10/3');
  r := r || pg_temp.chk('P09', 'an unknown code, a paused code and an ended code all just say "not valid"', pg_temp.run_as(null, $q$select (public.check_promo_code('NOSUCH1'))::text || (public.check_promo_code('ZZPAUSE'))::text || (public.check_promo_code('ZZEXPIRE'))::text$q$),
    '{"valid": false}{"valid": false}{"valid": false}');
  r := r || pg_temp.chk('P10', 'the answer holds nothing else: no label, no id, no tutor', pg_temp.run_as(null, $q$select (select string_agg(k, ',' order by k) from jsonb_object_keys(public.check_promo_code('ZZMAIN')) k)$q$), 'lessons,percent,valid');
  r := r || pg_temp.chk('P11', 'not the shape of a code: refused without being counted', pg_temp.run_as(null, $q$select public.check_promo_code('a')::text$q$) || ' / ' || (select count(*) - n2 from promo_code_attempts where bucket = 'ip:unknown'), '{"valid": false} / 3');
  -- the attempt limit: the 10th failure is allowed, the 11th call gets "try again later", and then even a right code is refused for that person
  for i in 1..10 loop
    perform pg_temp.run_as(p2, format('select public.check_promo_code(%L)::text', 'GUESSNO' || i));
  end loop;
  r := r || pg_temp.chk('P12', 'after 10 wrong guesses a person is told to try later, even for a right code', pg_temp.run_as(p2, $q$select public.check_promo_code('NEXTGUESS')::text$q$) || ' ' || pg_temp.run_as(p2, $q$select public.check_promo_code('ZZMAIN')::text$q$),
    '{"valid": false, "limited": true} {"valid": false, "limited": true}');
  r := r || pg_temp.chk('P13', 'another person is not held up by that', pg_temp.run_as(p3, $q$select (public.check_promo_code('ZZMAIN') ->> 'valid')$q$), 'true');
  -- (p2 and p3 are not accounts yet at this point; the check only needs a signed-in id, so the rows above did not need them)
  insert into promo_code_attempts (bucket) select 'ip:flood' || g from generate_series(1, 200) g;
  r := r || pg_temp.chk('P14', 'a flood of wrong guesses from everywhere shuts the check for everyone for a while', pg_temp.run_as(a_spt, $q$select public.check_promo_code('ZZMAIN')::text$q$), '{"valid": false, "limited": true}');
  delete from promo_code_attempts where bucket like 'ip:flood%';
  delete from promo_code_attempts where bucket = 'u:' || p2;

  -- ---- sign-up: the code travels in the metadata and is attached by the trigger ---------------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (p1, z, 'authenticated', 'authenticated', 'pc.p1.' || p1 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pia', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', 'zzmain'), '{}'),
    (p2, z, 'authenticated', 'authenticated', 'pc.p2.' || p2 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pam', 'date_of_birth', adult, 'phone_number', '081 234 5678'), '{}'),
    (p3, z, 'authenticated', 'authenticated', 'pc.p3.' || p3 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pat', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', 'nope-code'), '{}'),
    (p4, z, 'authenticated', 'authenticated', 'pc.p4.' || p4 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pip', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', ' ZZMAIN '), '{}'),
    (p5, z, 'authenticated', 'authenticated', 'pc.p5.' || p5 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Peg', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', 'ZZCAP'), '{}'),
    (p6, z, 'authenticated', 'authenticated', 'pc.p6.' || p6 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pol', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', 'ZZCAP'), '{}'),
    (p7, z, 'authenticated', 'authenticated', 'pc.p7.' || p7 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pru', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', 'ZZPAUSE'), '{}'),
    (p8, z, 'authenticated', 'authenticated', 'pc.p8.' || p8 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Peb', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', 'ZZEXPIRE'), '{}'),
    (p9, z, 'authenticated', 'authenticated', 'pc.p9.' || p9 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pax', 'date_of_birth', adult, 'phone_number', '081 234 5678'), '{}'),
    (p10, z, 'authenticated', 'authenticated', 'pc.p10.' || p10 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pen', 'date_of_birth', adult, 'phone_number', '081 234 5678'), '{}'),
    (p11, z, 'authenticated', 'authenticated', 'pc.p11.' || p11 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pol', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', 'zzstat'), '{}'),
    (p12, z, 'authenticated', 'authenticated', 'pc.p12.' || p12 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pia', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', 'ZZSMALL'), '{}'),
    (p13, z, 'authenticated', 'authenticated', 'pc.p13.' || p13 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pru', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', 'ZZROUND'), '{}'),
    (v_t2, z, 'authenticated', 'authenticated', 'pc.t2.' || v_t2 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tia', 'date_of_birth', adult, 'signup_code', 'ZZMAIN'), '{}'),
    (p14, z, 'authenticated', 'authenticated', 'pc.p14.' || p14 || '@example.invalid', jsonb_build_object('role', 'parent', 'first_name', 'Pia', 'date_of_birth', adult, 'phone_number', '081 234 5678', 'signup_code', 'zztutor'), '{}');
  update profiles set date_of_birth = adult::date where id in (p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14);
  update profiles set created_at = now() - interval '3 days' where id = p10;
  r := r || pg_temp.chk('P15', 'sign-up with the code typed in lower case, or with spaces round it: attached to the profile, kept in capitals',
    (select count(*) from profiles where id in (p1, p4) and promo_code_id = k_main and promo_code_entered = 'ZZMAIN' and promo_attached_at is not null and promo_attached_by is null)::text, '2');
  r := r || pg_temp.chk('P16', 'no code typed: nothing stored', (select coalesce(promo_code_id::text, 'null') || ' ' || coalesce(promo_code_entered, 'null') from profiles where id = p2), 'null null');
  r := r || pg_temp.chk('P17', 'an unknown code does not stop the sign-up; the typed text is kept for an admin to see', (select coalesce(promo_code_id::text, 'null') || ' ' || promo_code_entered from profiles where id = p3), 'null NOPE-CODE');
  r := r || pg_temp.chk('P18', 'the capped code: the first family is attached, the second is not (typed text kept)',
    (select string_agg(coalesce((promo_code_id = k_cap)::text, 'no') || ' ' || promo_code_entered, ' / ' order by full_name) from profiles where id in (p5, p6)), 'true ZZCAP / no ZZCAP');
  r := r || pg_temp.chk('P19', 'once the cap is reached the check says "not valid" to everyone', pg_temp.run_as(null, $q$select public.check_promo_code('ZZCAP')::text$q$), '{"valid": false}');
  r := r || pg_temp.chk('P20', 'a paused code and an ended code attach nobody at sign-up', (select count(*) from profiles where id in (p7, p8) and promo_code_id is not null)::text, '0');
  r := r || pg_temp.chk('P21', 'a tutor who signs up with a code gets nothing stored', (select coalesce(promo_code_id::text, 'null') || ' ' || coalesce(promo_code_entered, 'null') from profiles where id = v_t2), 'null null');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (gen_random_uuid(), z, 'authenticated', 'authenticated', 'pc.long.' || gen_random_uuid() || '@example.invalid',
            jsonb_build_object('role', 'parent', 'first_name', 'Lon', 'date_of_birth', adult, 'signup_code', repeat('x', 300)), '{}');
  r := r || pg_temp.chk('P22', 'a 300-letter "code" does not block the sign-up and only 40 letters are kept', (select max(length(promo_code_entered))::text from profiles where promo_code_entered like 'XXXX%'), '40');

  -- ---- claiming it right after a Google sign-up, and the admin attaching it ---------------------------------------------------------------------------------------
  r := r || pg_temp.chk('P23', 'a new account without a code claims one right after sign-up', pg_temp.run_as(p9, $q$select public.attach_my_promo_code('zzmain')::text$q$), '{"lessons": 3, "percent": 10, "attached": true}');
  r := r || pg_temp.chk('P24', 'it is attached; asking again changes nothing', (select (promo_code_id = k_main)::text from profiles where id = p9) || ' ' || pg_temp.run_as(p9, $q$select public.attach_my_promo_code('ZZSTAT')::text$q$), 'true {"reason": "already_has_code", "attached": false}');
  r := r || pg_temp.chk('P25', 'an account older than a day cannot claim; an unknown code is refused', pg_temp.run_as(p10, $q$select public.attach_my_promo_code('ZZMAIN')::text$q$) || ' ' || pg_temp.run_as(p3, $q$select public.attach_my_promo_code('ZZNOSUCH')::text$q$),
    '{"reason": "too_late", "attached": false} {"reason": "invalid", "attached": false}');
  n := pg_temp.audits();
  t := pg_temp.run_as(a_fin, format('select public.admin_attach_promo_code(%L, ''zzmain'', ''forgot to type it at sign-up'')::text', (select email from profiles where id = p10)));   -- (its own statement: a table lookup in the same expression would run BEFORE the attach)
  r := r || pg_temp.chk('P26', 'the admin attaches a code to an account found by e-mail ("I forgot to enter it")',
    t
    || ' / ' || (select (promo_code_id = k_main)::text || ' ' || (promo_attached_by = a_fin)::text from profiles where id = p10) || ' / ' || (pg_temp.audits() - n),
    '{"already": false, "attached": true} / true true / 1');
  r := r || pg_temp.chk('P27', 'a support agent cannot; neither a short reason, a paused code, a tutor, nor a stranger''s e-mail',
    pg_temp.run_as(a_spt, format('select public.admin_attach_promo_code(%L, ''ZZMAIN'', ''forgot to type it'')::text', (select email from profiles where id = p2)))
    || ' / ' || pg_temp.run_as(a_fin, format('select public.admin_attach_promo_code(%L, ''ZZMAIN'', ''x'')::text', (select email from profiles where id = p2)))
    || ' / ' || pg_temp.run_as(a_fin, format('select public.admin_attach_promo_code(%L, ''ZZPAUSE'', ''forgot to type it'')::text', (select email from profiles where id = p2)))
    || ' / ' || pg_temp.run_as(a_fin, format('select public.admin_attach_promo_code(%L, ''ZZMAIN'', ''forgot to type it'')::text', (select email from profiles where id = v_t)))
    || ' / ' || pg_temp.run_as(a_fin, $q$select public.admin_attach_promo_code('nobody@example.invalid', 'ZZMAIN', 'forgot to type it')::text$q$),
    'ERR: Finance admins only / ERR: A written reason is needed (5 to 300 characters). / ERR: There is no active code with that name. / ERR: Codes go on parent and learner accounts. / ERR: No account has that e-mail address.');
  r := r || pg_temp.chk('P28', 'no signed-in person can read the new profile columns', substr(pg_temp.run_as(p1, format('select promo_code_id::text from public.profiles where id = %L', p1)), 1, 22), 'ERR: permission denied');

  -- ---- who can see what ---------------------------------------------------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('P29', 'a parent lists no codes; a signed-out visitor is refused; a finance admin and a super admin see them; a support agent sees none',
    pg_temp.run_as(p1, 'select count(*)::text from public.promo_codes') || ' / ' || substr(pg_temp.run_as(null, 'select count(*)::text from public.promo_codes'), 1, 22) || ' / '
    || (pg_temp.run_as(a_fin, 'select count(*)::text from public.promo_codes')::int >= 7)::text || ' ' || (pg_temp.run_as(a_sup, 'select count(*)::text from public.promo_codes')::int >= 7)::text || ' / ' || pg_temp.run_as(a_spt, 'select count(*)::text from public.promo_codes'),
    '0 / ERR: permission denied / true true / 0');
  r := r || pg_temp.chk('P30', 'nobody writes a code through the table, a finance admin included',
    substr(pg_temp.run_as(a_fin, $q$with u as (update public.promo_codes set percent_off = 30 returning 1) select count(*)::text from u$q$), 1, 22) || ' / '
    || substr(pg_temp.run_as(a_fin, $q$with i as (insert into public.promo_codes (code) values ('ZZSNEAK') returning 1) select count(*)::text from i$q$), 1, 22) || ' / '
    || substr(pg_temp.run_as(p1, $q$with d as (delete from public.promo_codes returning 1) select count(*)::text from d$q$), 1, 22),
    'ERR: permission denied / ERR: permission denied / ERR: permission denied');
  r := r || pg_temp.chk('P31', 'a parent can neither write nor read the attempts table', substr(pg_temp.run_as(p1, 'select count(*)::text from public.promo_code_attempts'), 1, 22), 'ERR: permission denied');
  select count(*) into n from unnest(array['public.promo_take_use(uuid,uuid,integer)', 'public.promo_quote_row(uuid,integer)', 'public.promo_attach_at_signup(uuid,text,text)', 'public.promo_find_open_code(text)',
    'public.promo_attempts_blocked(text)', 'public.promo_attempt_key()', 'public.promo_paid_rand(integer,integer)', 'public.promo_normalise(text)', 'public.promo_return_use()', 'public.promo_use_link_session()',
    'public.guard_promo_flags()']) f, unnest(array['anon', 'authenticated', 'service_role']) ro where has_function_privilege(ro, f, 'EXECUTE');
  r := r || pg_temp.chk('P32', 'no browser role and not the server role can run an internal function', n::text, '0');
  r := r || pg_temp.chk('P33', 'check_promo_code is open to signed-out visitors; the signed-in and admin functions are not',
    has_function_privilege('anon', 'public.check_promo_code(text)', 'EXECUTE')::text || ' ' || has_function_privilege('anon', 'public.my_promo_quote(integer)', 'EXECUTE')::text || ' '
    || has_function_privilege('anon', 'public.attach_my_promo_code(text)', 'EXECUTE')::text || ' ' || has_function_privilege('anon', 'public.admin_list_promo_codes()', 'EXECUTE')::text || ' '
    || has_function_privilege('authenticated', 'public.my_promo_quote(integer)', 'EXECUTE')::text, 'true false false false true');

  r := r || pg_temp.chk('P34', 'the quote at 1A, 1D and 2C: the parent pays R45, R135, R252 (lesson 1 of 3)',
    pg_temp.quote(p1, 50) || ' ' || pg_temp.quote(p1, 150) || ' ' || pg_temp.quote(p1, 280), 'true/45/5/1/3 true/135/15/1/3 true/252/28/1/3');
  r := r || pg_temp.chk('P35', 'a family with no code is quoted nothing; a signed-out visitor cannot ask', pg_temp.quote(p2, 50) || ' / ' || substr(pg_temp.quote(null, 50), 1, 36), 'false / ERR: permission denied for function ');
  select count(*) into n from sub_tier_definitions where max_allowed_rate <> trunc(max_allowed_rate) or public.promo_paid_rand(max_allowed_rate::int, 10) <> max_allowed_rate * 0.9;
  r := r || pg_temp.chk('P36', 'all 16 level prices are whole rand and stay whole rand at 10 percent off for a whole hour', (select count(*) from sub_tier_definitions)::text || ' prices, ' || n || ' not whole', '16 prices, 0 not whole');

  exception when others then
    r := r || format('STOPPED EARLY by an unexpected error: %s', sqlerrm) || E'\n';
  end;

  -- The Supabase tool shows only the START and the END of a long error. So: the passing ids are one short line, a failing check is printed in full, and the verdict and
  -- the NAMES of the failing checks come LAST. "N of 36 checks ran" is less than 36 when the chunk stopped early (the stop is then also named).
  select count(*) filter (where l ~ '^P[0-9]+ '),
         count(*) filter (where l ~ '^P[0-9]+ ' and l like '% FAIL (want %'),
         string_agg(split_part(l, ' ', 1), ' ') filter (where l ~ '^P[0-9]+ ' and l not like '% FAIL (want %'),
         string_agg(l, E'\n') filter (where l like '% FAIL (want %' or l like 'STOPPED%'),
         string_agg(case when l like 'STOPPED%' then 'STOPPED-EARLY' else split_part(l, ' ', 1) end, ', ') filter (where l like '% FAIL (want %' or l like 'STOPPED%')
    into nlines, nfail, okids, rep, failnames
    from regexp_split_to_table(r, E'\n') as l;
  raise exception E'PROMO CHUNK 1 of 3 (rolled back, nothing kept)\nPASSED: %\n%\nRESULT chunk 1 of 3: % of 36 checks ran, % FAIL\nFAILING: %',
    coalesce(okids, 'none'), coalesce(rep, '(no failing line)'), nlines, nfail, coalesce(failnames, 'none');
end $$;
