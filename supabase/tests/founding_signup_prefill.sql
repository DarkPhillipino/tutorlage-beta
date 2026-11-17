-- Rolled-back test of migration 20261117090000_founding_signup_prefill.sql (the waiting list is the first stage of sign-up; 17 Nov 2026).
-- Run it ONCE, after the migration is applied, by pasting this file alone. Before the apply, run both together in one rolled-back statement, migration first:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/founding_signup_prefill.sql supabase/migrations/20261117090000_founding_signup_prefill.sql
-- The OLD suite (founding_tutors_list.sql) joins with the old payload (full_name and the 18-or-over tick), so running it against the same migration proves that a page that was
-- open before the change can still join:
--   node scripts/run-rolled-back-test.mjs <out2.sql> supabase/tests/founding_tutors_list.sql supabase/migrations/20261117090000_founding_signup_prefill.sql
-- Fixtures are made-up people (example.invalid), all inserted as the owner; every real list row is left alone and no real person is printed. Every line ends "ok" or
-- "FAIL (want ...)"; the block raises an error at the end on purpose so nothing is kept. The answer is short: how many lines and how many FAIL, every FAIL line in full,
-- then the ids of the lines that passed.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  uid text := replace(gen_random_uuid()::text, '-', '');
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  adult text := (v_today - interval '30 years')::date::text;
  eighteen_today text := (v_today - interval '18 years')::date::text;       -- turns 18 today: allowed
  eighteen_tomorrow text := (v_today - interval '18 years' + interval '1 day')::date::text;   -- turns 18 tomorrow: refused
  v_sa uuid := gen_random_uuid();
  v_vo uuid := gen_random_uuid();
  v_su uuid := gen_random_uuid();
  v_ld uuid := gen_random_uuid();
  v_vis uuid := gen_random_uuid();
  v_acct uuid := gen_random_uuid();
  v_subj text;
  v_base jsonb;
  v_id1 uuid; v_id2 uuid; v_idF uuid; v_idL uuid;
  tok1 text; tok2 text; tokF text; tokL text;
  t text; t2 text; n int; n2 int; nfail int; nok int; nlines int;
  v_res text;
begin
  begin
  execute $mk$
    create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
      select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
             || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
    $f$ $mk$;
  execute $mk$
    create function pg_temp.pfx(p_got text, p_prefix text) returns text language sql as $f$
      select case when p_got like p_prefix || '%' then p_prefix else p_got end
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
    create function pg_temp.pl(p_over jsonb) returns jsonb language sql as $f$ select current_setting('test.base')::jsonb || p_over $f$ $mk$;
  execute $mk$
    create function pg_temp.join_as(p_u uuid, p jsonb) returns text language sql as $f$
      select pg_temp.run_as(p_u, format('select public.join_founding_list(%L::jsonb)::text', p::text))
    $f$ $mk$;
  execute $mk$
    create function pg_temp.prefill(p_u uuid, p_token text) returns text language sql as $f$
      select pg_temp.run_as(p_u, format('select public.founding_signup_prefill(%L)::text', p_token))
    $f$ $mk$;
  execute $mk$
    create function pg_temp.adm(p_u uuid, p_call text) returns text language sql as $f$
      select pg_temp.run_as(p_u, 'select (' || p_call || ')::text')
    $f$ $mk$;
  execute $mk$
    create function pg_temp.keys(p_json text) returns text language sql as $f$
      select string_agg(k, ',' order by k) from jsonb_object_keys(p_json::jsonb) k
    $f$ $mk$;

  select s.name into v_subj from public.subjects s where s.name ilike 'mathematics%' order by s.name limit 1;
  if v_subj is null then select s.name into v_subj from public.subjects s order by s.name limit 1; end if;
  -- the NEW form's payload
  v_base := jsonb_build_object(
    'website', '', 'elapsed_ms', 9000, 'first_name', 'Zed', 'surname', 'Zztestperson', 'code_name', '', 'whatsapp', '082 123 4567',
    'email', '  ZZ.New.' || uid || '@Example.invalid ', 'date_of_birth', adult,
    'subjects', jsonb_build_array(jsonb_build_object('subject', lower(v_subj), 'min_grade', 'grade 8', 'max_grade', 'Grade 12')),
    'availability', jsonb_build_array('weekends'), 'practicum', 'two', 'police_clearance', 'applied', 'parent_reach', '10_to_30', 'parent_reach_willing', true,
    'has_device', true, 'has_connection', true, 'has_bank', false,
    'consent_contact', true, 'consent_marketing', false, 'src', 'zztest', 'visitor', v_vis, 'consent_version', '2026-11-17');
  perform set_config('test.base', v_base::text, true);

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_sa, z, 'authenticated', 'authenticated', 'sp.sa.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Sue', 'surname', 'Super', 'date_of_birth', adult), '{}'),
    (v_vo, z, 'authenticated', 'authenticated', 'sp.vo.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Vic', 'surname', 'Officer', 'date_of_birth', adult), '{}'),
    (v_su, z, 'authenticated', 'authenticated', 'sp.su.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Sam', 'surname', 'Support', 'date_of_birth', adult), '{}'),
    (v_ld, z, 'authenticated', 'authenticated', 'sp.ld.' || uid || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Lee', 'surname', 'Learner', 'date_of_birth', adult), '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (v_sa, 'Sue', 'Super', 'sp.sa.' || uid || '@example.invalid', '', 'super_admin', true),
    (v_vo, 'Vic', 'Officer', 'sp.vo.' || uid || '@example.invalid', '', 'verification_officer', true),
    (v_su, 'Sam', 'Support', 'sp.su.' || uid || '@example.invalid', '', 'support_agent', true);
  delete from founding_signup_lookups;
  r := r || 'S0 setup: a super admin, a verification officer, a support agent and a learner (made up); the lookup memory emptied inside this run' || E'\n';

  -- ---- S: what exists and who may touch it ------------------------------------------------------------------------------------------------------
  select count(*)::text into t from information_schema.columns where table_schema = 'public' and table_name = 'founding_tutors_list' and column_name in ('first_name', 'surname', 'date_of_birth', 'signup_token') and is_nullable = 'YES';
  r := r || pg_temp.chk('S1', 'the four new columns exist and are all nullable', t, '4');
  r := r || pg_temp.chk('S2', 'no API role has any right on the list table or the lookup memory',
    has_table_privilege('anon', 'public.founding_tutors_list', 'select')::text || '/' || has_table_privilege('authenticated', 'public.founding_tutors_list', 'select')::text || '/'
    || has_table_privilege('service_role', 'public.founding_tutors_list', 'select')::text || '/' || has_table_privilege('anon', 'public.founding_signup_lookups', 'select')::text || '/'
    || has_table_privilege('authenticated', 'public.founding_signup_lookups', 'insert')::text || '/' || has_table_privilege('service_role', 'public.founding_signup_lookups', 'select')::text,
    'false/false/false/false/false/false');
  select (c.relrowsecurity)::text into t from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relname = 'founding_signup_lookups';
  r := r || pg_temp.chk('S3', 'the lookup memory has row-level security on', t, 'true');
  r := r || pg_temp.chk('S4', 'who may call: the join and the prefill are open to signed-out and signed-in callers; the admin links function only to signed-in callers',
    has_function_privilege('anon', 'public.join_founding_list(jsonb)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.join_founding_list(jsonb)', 'execute')::text || '/'
    || has_function_privilege('anon', 'public.founding_signup_prefill(text)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.founding_signup_prefill(text)', 'execute')::text || '/'
    || has_function_privilege('anon', 'public.admin_founding_signup_links()', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.admin_founding_signup_links()', 'execute')::text,
    'true/true/true/true/false/true');
  select (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('join_founding_list', 'founding_signup_prefill', 'admin_founding_signup_links') and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))::text into t;
  r := r || pg_temp.chk('S5', 'all three functions are security definer with the search path pinned', t, '3');
  select (count(*) filter (where source in ('form', 'admin') and signup_token is null))::text || '/' || (count(*) filter (where source = 'backfill' and signup_token is not null))::text
    || '/' || (count(signup_token) - count(distinct signup_token))::text into t from founding_tutors_list;
  r := r || pg_temp.chk('S6', 'every existing form or hand-added row has a link token, no existing-tutor row has one, no token is repeated (counts only, nothing about a person)', t, '0/0/0');

  -- ---- J: the new join form -----------------------------------------------------------------------------------------------------------------------
  t := pg_temp.join_as(null, pg_temp.pl('{}'::jsonb));
  r := r || pg_temp.chk('J1', 'a signed-out visitor joins with first name, surname and date of birth: ok', t, '{"ok": true}');
  select f.id, f.signup_token into v_id1, tok1 from founding_tutors_list f where f.email_key = lower('zz.new.' || uid || '@example.invalid');
  select concat_ws('|', f.first_name, f.surname, f.full_name, f.code_name, f.date_of_birth::text, f.is_adult::text, f.email_key, f.whatsapp, f.source, f.status, (f.signup_token ~ '^[0-9a-f]{32}$')::text)
    into t from founding_tutors_list f where f.id = v_id1;
  r := r || pg_temp.chk('J2', 'the row holds first name, surname, the full name made from them, the link name defaulted to the first name, the date of birth, adult, the tidy email and number, and a 32-character token',
    t, 'Zed|Zztestperson|Zed Zztestperson|Zed|' || adult || '|true|zz.new.' || uid || '@example.invalid|+27821234567|form|joined|true');
  r := r || pg_temp.chk('J3', 'one join event was counted for the visit', (select count(*)::text from founding_page_events e where e.visitor_id = v_vis and e.event = 'join'), '1');
  t := pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.legacy.' || uid || '@example.invalid', 'first_name', '', 'surname', '', 'date_of_birth', '', 'full_name', 'Lena Zzlegacy', 'code_name', 'Lena', 'is_adult', true)));
  select f.id, f.signup_token into v_id2, tok2 from founding_tutors_list f where f.email_key = 'zz.legacy.' || uid || '@example.invalid';
  select concat_ws('|', coalesce(f.first_name, 'null'), coalesce(f.surname, 'null'), f.full_name, f.code_name, coalesce(f.date_of_birth::text, 'null'), f.is_adult::text, (f.signup_token ~ '^[0-9a-f]{32}$')::text)
    into t2 from founding_tutors_list f where f.id = v_id2;
  r := r || pg_temp.chk('J4', 'a page that was open before the change (full name + the 18-or-over tick, no date of birth) still joins; the new columns stay empty; a token is made',
    t || ' ' || t2, '{"ok": true} null|null|Lena Zzlegacy|Lena|null|true|true');
  r := r || pg_temp.chk('J5', 'the same email again: the same answer, no second row', pg_temp.join_as(null, pg_temp.pl('{}'::jsonb)) || '/' || (select count(*)::text from founding_tutors_list where email_key = 'zz.new.' || uid || '@example.invalid'), '{"ok": true}/1');
  t := pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.nick.' || uid || '@example.invalid', 'code_name', 'Zedd')));
  select f.code_name into t2 from founding_tutors_list f where f.email_key = 'zz.nick.' || uid || '@example.invalid';
  r := r || pg_temp.chk('J6', 'a link name that was typed is kept', t || '/' || coalesce(t2, 'null'), '{"ok": true}/Zedd');
  r := r || pg_temp.chk('J7', 'turns 18 today: allowed; turns 18 tomorrow: refused in the form''s own plain words',
    pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.t18.' || uid || '@example.invalid', 'date_of_birth', eighteen_today))) || ' / '
    || pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.u18.' || uid || '@example.invalid', 'date_of_birth', eighteen_tomorrow))),
    '{"ok": true} / ERR: You must be 18 or older to join the list.');
  r := r || pg_temp.chk('J8', 'a refused under-18 stores nothing', (select count(*)::text from founding_tutors_list where email_key = 'zz.u18.' || uid || '@example.invalid'), '0');
  r := r || pg_temp.chk('J9', 'not a real date of birth: a made-up day, words, the future, 1850, 130 years ago, a wrong shape',
    pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.d1.' || uid || '@example.invalid', 'date_of_birth', '2001-02-30'))), 'ERR: Please enter your real date of birth.')
    || ' / ' || pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.d2.' || uid || '@example.invalid', 'date_of_birth', 'last Tuesday'))), 'ERR: Please enter your real date of birth.')
    || ' / ' || pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.d3.' || uid || '@example.invalid', 'date_of_birth', (v_today + 1)::text))), 'ERR: Please enter your real date of birth.')
    || ' / ' || pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.d4.' || uid || '@example.invalid', 'date_of_birth', '1850-01-01'))), 'ERR: Please enter your real date of birth.')
    || ' / ' || pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.d5.' || uid || '@example.invalid', 'date_of_birth', (v_today - interval '130 years')::date::text))), 'ERR: Please enter your real date of birth.')
    || ' / ' || pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.d6.' || uid || '@example.invalid', 'date_of_birth', '12/05/1990'))), 'ERR: Please enter your real date of birth.'),
    'ERR: Please enter your real date of birth. / ERR: Please enter your real date of birth. / ERR: Please enter your real date of birth. / ERR: Please enter your real date of birth. / ERR: Please enter your real date of birth. / ERR: Please enter your real date of birth.');
  r := r || pg_temp.chk('J10', 'a first name with no surname; a date of birth with no first name; markup in a name: each refused in plain words',
    pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.s1.' || uid || '@example.invalid', 'surname', ' '))) || ' / '
    || pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.s2.' || uid || '@example.invalid', 'first_name', ''))) || ' / '
    || pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.s3.' || uid || '@example.invalid', 'first_name', 'Z<b>ed'))) || ' / '
    || pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.s4.' || uid || '@example.invalid', 'surname', 'Zz>test'))),
    'ERR: Please enter your surname. / ERR: Please enter your first name. / ERR: Please enter your first name. / ERR: Please enter your surname.');
  r := r || pg_temp.chk('J11', 'the old tick is not needed on the new form (the date of birth decides); the old path still needs the tick',
    pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.notick.' || uid || '@example.invalid', 'is_adult', false))) || ' / '
    || pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.old1.' || uid || '@example.invalid', 'first_name', '', 'date_of_birth', '', 'full_name', 'Old Path', 'code_name', 'Old', 'is_adult', false))),
    '{"ok": true} / ERR: You must be 18 or older to join the list.');
  r := r || pg_temp.chk('J12', 'the other checks are as before: no contact consent, bad email, bad number, no subject, no practicum',
    pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.c1.' || uid || '@example.invalid', 'consent_contact', false))), 'ERR: Please tick the box that lets us contact you')
    || ' / ' || pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'not an email'))), 'ERR: Please enter the email you will use to sign up.')
    || ' / ' || pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.c3.' || uid || '@example.invalid', 'whatsapp', '12345'))), 'ERR: Please enter a South African WhatsApp number')
    || ' / ' || pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.c4.' || uid || '@example.invalid', 'subjects', '[]'::jsonb))), 'ERR: Please pick at least one subject')
    || ' / ' || pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.c5.' || uid || '@example.invalid', 'practicum', 'lots'))), 'ERR: Please say how much school-based teaching practice'),
    'ERR: Please tick the box that lets us contact you / ERR: Please enter the email you will use to sign up. / ERR: Please enter a South African WhatsApp number / ERR: Please pick at least one subject / ERR: Please say how much school-based teaching practice');
  r := r || pg_temp.chk('J13', 'the bot trap is as before: a filled hidden field and a form open for 1 second both answer ok and store nothing',
    pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.bot1.' || uid || '@example.invalid', 'website', 'http://spam'))) || '/' || pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.bot2.' || uid || '@example.invalid', 'elapsed_ms', 1000)))
    || '/' || (select count(*)::text from founding_tutors_list where email_key like 'zz.bot_.' || uid || '@example.invalid'),
    '{"ok": true}/{"ok": true}/0');
  r := r || pg_temp.chk('J14', 'the answer to a join never contains the token or anything about the row', pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.nothing.' || uid || '@example.invalid'))), '{"ok": true}');

  -- ---- T: the sign-up page's lookup ---------------------------------------------------------------------------------------------------------------
  t := pg_temp.prefill(null, tok1);
  r := r || pg_temp.chk('T1', 'a signed-out visitor with a good token gets exactly five fields: date_of_birth, email, first_name, phone, surname', pg_temp.keys(t), 'date_of_birth,email,first_name,phone,surname');
  r := r || pg_temp.chk('T2', 'the values: first name, surname, email (lower case), phone in the national form the sign-up shows, date of birth',
    concat_ws('|', t::jsonb ->> 'first_name', t::jsonb ->> 'surname', t::jsonb ->> 'email', t::jsonb ->> 'phone', t::jsonb ->> 'date_of_birth'),
    'Zed|Zztestperson|zz.new.' || uid || '@example.invalid|0821234567|' || adult);
  t := pg_temp.prefill(null, tok2);
  r := r || pg_temp.chk('T3', 'an older row (full name only): first name is its first word, surname and date of birth are empty, email and phone are filled',
    concat_ws('|', t::jsonb ->> 'first_name', coalesce(t::jsonb ->> 'surname', 'null'), coalesce(t::jsonb ->> 'date_of_birth', 'null'), t::jsonb ->> 'email', t::jsonb ->> 'phone'),
    'Lena|null|null|zz.legacy.' || uid || '@example.invalid|0821234567');
  r := r || pg_temp.chk('T4', 'the same answer for a signed-in caller, and a capital-letter copy of the token works too', (pg_temp.prefill(v_ld, tok1) = pg_temp.prefill(null, tok1))::text || '/' || (pg_temp.prefill(null, upper(tok1)) = pg_temp.prefill(null, tok1))::text, 'true/true');
  r := r || pg_temp.chk('T5', 'bad tokens answer null: unknown, empty, null, too short, too long, not hex, an injection try, an email instead of a token',
    pg_temp.prefill(null, replace(gen_random_uuid()::text, '-', '')) || '/' || pg_temp.prefill(null, '') || '/' || pg_temp.run_as(null, 'select public.founding_signup_prefill(null)::text') || '/' || pg_temp.prefill(null, substr(tok1, 1, 31)) || '/' || pg_temp.prefill(null, tok1 || 'a')
    || '/' || pg_temp.prefill(null, repeat('z', 32)) || '/' || pg_temp.prefill(null, tok1 || ''' or true --') || '/' || pg_temp.prefill(null, 'zz.new.' || uid || '@example.invalid'),
    'null/null/null/null/null/null/null/null');
  r := r || pg_temp.chk('T6', 'no lookup can ask by email or name: the function takes one argument, and nothing else returns a row', (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'founding_signup_prefill'), '1');
  -- an account made with that email ends the link
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (v_acct, z, 'authenticated', 'authenticated', 'zz.new.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zed', 'surname', 'Zztestperson', 'date_of_birth', adult), '{}');
  r := r || pg_temp.chk('T7', 'once an account exists with the row''s email the token stops working (answers null)', pg_temp.prefill(null, tok1), 'null');
  update founding_tutors_list set user_id = v_ld where id = v_id2;
  r := r || pg_temp.chk('T8', 'a row linked to an account (user_id) stops too', pg_temp.prefill(null, tok2), 'null');
  update founding_tutors_list set user_id = null where id = v_id2;
  r := r || pg_temp.chk('T9', 'unlinking brings it back (the check is live, nothing was stored)', (pg_temp.prefill(null, tok2) like '{%"first_name": "Lena"%')::text, 'true');
  -- a row added by an admin has a token and an older first name
  select (pg_temp.adm(v_vo, 'public.admin_add_founding_entry(''Amree Zztest'', ''Amree'', ''0829876543'', ''zz.admin.' || uid || '@example.invalid'', ''released'')')) into t;
  select f.id, f.signup_token into v_idL, tokL from founding_tutors_list f where f.email_key = 'zz.admin.' || uid || '@example.invalid';
  t2 := pg_temp.prefill(null, tokL);
  r := r || pg_temp.chk('T10', 'a person added by hand in the admin app gets a token too; their link opens with the first word of their name and a blank surname',
    (tokL ~ '^[0-9a-f]{32}$')::text || '|' || (t2::jsonb ->> 'first_name') || '|' || coalesce(t2::jsonb ->> 'surname', 'null') || '|' || (t2::jsonb ->> 'phone'), 'true|Amree|null|0829876543');

  -- ---- R: the rate limit ---------------------------------------------------------------------------------------------------------------------------
  delete from founding_signup_lookups;
  select count(*)::int into n from founding_signup_lookups;
  t := pg_temp.prefill(null, 'not-a-token');   -- malformed: must not be recorded
  select count(*)::int into n2 from founding_signup_lookups;
  t2 := pg_temp.prefill(null, tok2);           -- a good token: must not be recorded either
  r := r || pg_temp.chk('R1', 'a malformed token and a good token are not recorded', n::text || '/' || n2::text || '/' || (select count(*)::text from founding_signup_lookups) || '/' || (t2 like '{%')::text, '0/0/0/true');
  perform pg_temp.prefill(null, replace(gen_random_uuid()::text, '-', ''));
  r := r || pg_temp.chk('R1b', 'one lookup that finds nothing is recorded', (select count(*)::text from founding_signup_lookups), '1');
  delete from founding_signup_lookups;
  for n in 1..60 loop
    perform pg_temp.prefill(null, replace(gen_random_uuid()::text, '-', ''));
  end loop;
  select count(*)::text into t from founding_signup_lookups;
  r := r || pg_temp.chk('R2', '60 lookups that found nothing are all recorded', t, '60');
  r := r || pg_temp.chk('R3', 'then the breaker is on: even a good token answers null, and nothing more is recorded', pg_temp.prefill(null, tok2) || '/' || (select count(*)::text from founding_signup_lookups), 'null/60');
  update founding_signup_lookups set created_at = now() - interval '11 minutes';
  r := r || pg_temp.chk('R4', 'eleven minutes later the breaker is off: a good token works again', (pg_temp.prefill(null, tok2) like '{%"first_name": "Lena"%')::text, 'true');
  update founding_signup_lookups set created_at = now() - interval '2 days';
  perform pg_temp.prefill(null, replace(gen_random_uuid()::text, '-', ''));
  r := r || pg_temp.chk('R5', 'rows more than a day old are removed by the next miss (only the new one is left)', (select count(*)::text from founding_signup_lookups), '1');
  delete from founding_signup_lookups;

  -- ---- A: the admin app's tokens ------------------------------------------------------------------------------------------------------------------
  v_res := pg_temp.adm(v_vo, 'public.admin_founding_signup_links()');
  r := r || pg_temp.chk('A1', 'a verification officer gets the id and token of this run''s rows (and of nothing but those two keys)',
    ((v_res::jsonb) @> jsonb_build_array(jsonb_build_object('id', v_id1, 'signup_token', tok1)))::text || '|' || ((v_res::jsonb) @> jsonb_build_array(jsonb_build_object('id', v_idL, 'signup_token', tokL)))::text || '|'
    || (not exists (select 1 from jsonb_array_elements(v_res::jsonb) e, jsonb_object_keys(e.value) k where k not in ('id', 'signup_token')))::text, 'true|true|true');
  r := r || pg_temp.chk('A2', 'a super admin may too; a support agent, a learner and a signed-out visitor are refused',
    (pg_temp.adm(v_sa, 'public.admin_founding_signup_links()') like '[%')::text || ' / ' || pg_temp.pfx(pg_temp.adm(v_su, 'public.admin_founding_signup_links()'), 'ERR: Only a verification officer or a super admin')
    || ' / ' || pg_temp.pfx(pg_temp.adm(v_ld, 'public.admin_founding_signup_links()'), 'ERR: Only a verification officer or a super admin') || ' / ' || pg_temp.pfx(pg_temp.adm(null, 'public.admin_founding_signup_links()'), 'ERR: permission denied for'),
    'true / ERR: Only a verification officer or a super admin / ERR: Only a verification officer or a super admin / ERR: permission denied for');
  r := r || pg_temp.chk('A3', 'existing-tutor rows are never in the list of links', (select count(*)::text from jsonb_array_elements(v_res::jsonb) e join founding_tutors_list f on f.id = (e.value ->> 'id')::uuid where f.source = 'backfill'), '0');

  -- ---- F: the funnel still moves a person who signed up through their link ---------------------------------------------------------------------
  t := pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'zz.funnel.' || uid || '@example.invalid')));
  select f.id, f.signup_token into v_idF, tokF from founding_tutors_list f where f.email_key = 'zz.funnel.' || uid || '@example.invalid';
  t := pg_temp.adm(v_vo, format('public.admin_release_founding(array[%L]::uuid[])', v_idF));
  select e.value ->> 'stage' into t from jsonb_array_elements(pg_temp.adm(v_vo, 'public.admin_founding_steps()')::jsonb) e where e.value ->> 'id' = v_idF::text;
  r := r || pg_temp.chk('F1', 'after the release the funnel says "released"', t, 'released');
  -- the sign-up form opened from the link carries the same email, so the account is found by it
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (gen_random_uuid(), z, 'authenticated', 'authenticated', (pg_temp.prefill(null, tokF)::jsonb ->> 'email'), jsonb_build_object('role', 'tutor', 'first_name', 'Zed', 'surname', 'Zztestperson', 'date_of_birth', adult), '{}');
  select e.value ->> 'stage' into t from jsonb_array_elements(pg_temp.adm(v_vo, 'public.admin_founding_steps()')::jsonb) e where e.value ->> 'id' = v_idF::text;
  r := r || pg_temp.chk('F2', 'an account made with the email the link filled in moves the person to "account" (the funnel step is found by email, as before)', t, 'account');
  r := r || pg_temp.chk('F3', 'and the link is spent', pg_temp.prefill(null, tokF), 'null');

  exception when others then
    r := r || 'UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%'), count(*) filter (where l like '% ok'), count(*) into nfail, nok, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  select coalesce(string_agg(l, E'\n') filter (where l like '%FAIL%'), '(none)') into t from unnest(string_to_array(r, E'\n')) l;
  select string_agg(split_part(l, ' ', 1), ' ') filter (where l like '% ok') into t2 from unnest(string_to_array(r, E'\n')) l;
  raise exception E'FOUNDING SIGNUP PREFILL TEST (rolled back): % OK, % FAIL, % lines in all\nFAIL LINES: %\nOK: %', nok, nfail, nlines, t, t2;
end $$;
