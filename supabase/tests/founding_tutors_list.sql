-- Rolled-back test of migration 20261110200000_founding_tutors_list.sql (the founding tutors list, its counters, the admin's reads and writes, and the Teach gate; 10 Nov 2026).
-- Run it ONCE, after the migration is applied, by pasting this file alone. (Before the apply, run both together in one rolled-back statement, migration first:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/founding_tutors_list.sql supabase/migrations/20261110200000_founding_tutors_list.sql )
-- Fixtures are made-up people (example.invalid), all inserted as the owner. Every line ends "ok" or "FAIL (want ...)"; the block raises an error at the end on purpose so
-- nothing is kept. The answer is short: how many lines and how many FAIL, every FAIL line in full, then the ids of the lines that passed (the Supabase tool cuts the
-- middle of a long answer). Counts of real rows are never printed and no real person's row is read: every check names a made-up id, the tag 'zztest' or 'Zz Test Subject'.
-- Not proved here: the unserved-requests branch of the coverage view (it needs a full request fixture; the view is checked for shape and for the supply and list
-- columns), two joins at the very same instant, and the pg_cron schedule (it exists only where pg_cron is installed).
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  v_nl uuid := gen_random_uuid();   -- a tutor account with no list entry
  v_w  uuid := gen_random_uuid();   -- a tutor whose entry is only 'joined' (email match)
  v_r  uuid := gen_random_uuid();   -- a tutor whose entry is 'released' (email match)
  v_v  uuid := gen_random_uuid();   -- a verified tutor with no entry at all
  v_vl uuid := gen_random_uuid();   -- a tutor whose entry says 'verified' but who is not verified yet (linked by account, other email)
  v_ld uuid := gen_random_uuid();   -- a learner
  v_sa uuid := gen_random_uuid();   -- super_admin
  v_vo uuid := gen_random_uuid();   -- verification_officer
  v_su uuid := gen_random_uuid();   -- support_agent
  v_of uuid := gen_random_uuid();   -- a verification officer whose access is switched off
  v_vis uuid := gen_random_uuid();
  v_vis2 uuid := gen_random_uuid();
  v_vis3 uuid := gen_random_uuid();
  v_vis4 uuid := gen_random_uuid();
  v_lk uuid := gen_random_uuid();     -- a tutor whose sign-up email is on the list (account link)
  v_lk2 uuid := gen_random_uuid();    -- a tutor with no entry
  v_subj text;
  v_id1 uuid; v_id2 uuid; v_id3 uuid;
  v_base jsonb;
  t text; t2 text; t3 text; n int; nfail int; nok int; nlines int;
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
    create function pg_temp.do_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
    begin
      if p_u is null then
        perform set_config('request.jwt.claims', '', true);
        set local role anon;
      else
        perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true);
        set local role authenticated;
      end if;
      begin
        execute p_sql;
        reset role;
        return 'done';
      exception when others then
        reset role;
        return 'ERR: ' || sqlerrm;
      end;
    end $f$ $mk$;
  execute $mk$
    create function pg_temp.as_service(p_sql text) returns text language plpgsql as $f$
    declare v text;
    begin
      set local role service_role;
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
    create function pg_temp.deny(p_got text) returns text language sql as $f$ select pg_temp.pfx(p_got, 'ERR: permission denied for') $f$ $mk$;
  -- a join payload: the valid base (set below) with some keys replaced
  execute $mk$
    create function pg_temp.pl(p_over jsonb) returns jsonb language sql as $f$ select current_setting('test.base')::jsonb || p_over $f$ $mk$;
  -- a join as a person (null = signed out): the text of the answer, or ERR:
  execute $mk$
    create function pg_temp.join_as(p_u uuid, p jsonb) returns text language sql as $f$
      select pg_temp.run_as(p_u, format('select public.join_founding_list(%L::jsonb)::text', p::text))
    $f$ $mk$;
  -- the gate answer of the signed-in person's own call
  execute $mk$
    create function pg_temp.gate_of(p_u uuid) returns text language sql as $f$
      select pg_temp.run_as(p_u, 'select public.my_founding_gate()->>''state''')
    $f$ $mk$;
  -- an admin's call that answers a json text
  execute $mk$
    create function pg_temp.adm(p_u uuid, p_call text) returns text language sql as $f$
      select pg_temp.run_as(p_u, 'select (' || p_call || ')::text')
    $f$ $mk$;

  select s.name into v_subj from public.subjects s where s.name ilike 'mathematics%' order by s.name limit 1;
  if v_subj is null then select s.name into v_subj from public.subjects s order by s.name limit 1; end if;
  v_base := jsonb_build_object(
    'website', '', 'elapsed_ms', 9000, 'full_name', 'Thandi Testfounder', 'code_name', 'Thandi', 'whatsapp', '082 123 4567',
    'email', '  Thandi.Test@Example.invalid ', 'is_adult', true,
    'subjects', jsonb_build_array(jsonb_build_object('subject', lower(v_subj), 'min_grade', 'grade 8', 'max_grade', 'Grade 12')),
    'availability', jsonb_build_array('weekends', 'evenings', 'nonsense'), 'unavailable_weeks', 'away on placement in March',
    'practicum', 'two', 'police_clearance', 'applied', 'parent_reach', '10_to_30', 'parent_reach_willing', true,
    'prior_tutoring', 'Two years of Grade 10 maths, about 80 hours', 'heard_from', 'message',
    'has_device', true, 'has_connection', true, 'has_bank', false,
    'consent_contact', true, 'consent_marketing', false, 'src', 'zztest', 'visitor', v_vis, 'consent_version', '2026-11-10');
  perform set_config('test.base', v_base::text, true);

  -- ---- people ---------------------------------------------------------------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_nl, z, 'authenticated', 'authenticated', 'ft.nl.' || v_nl || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Nia', 'surname', 'Notlisted', 'date_of_birth', adult), '{}'),
    (v_w,  z, 'authenticated', 'authenticated', 'ft.w.'  || v_w  || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Wim', 'surname', 'Waiting', 'date_of_birth', adult), '{}'),
    (v_r,  z, 'authenticated', 'authenticated', 'ft.r.'  || v_r  || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Rae', 'surname', 'Released', 'date_of_birth', adult), '{}'),
    (v_v,  z, 'authenticated', 'authenticated', 'ft.v.'  || v_v  || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Vee', 'surname', 'Verified', 'date_of_birth', adult), '{}'),
    (v_vl, z, 'authenticated', 'authenticated', 'ft.vl.' || v_vl || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Val', 'surname', 'Listedverified', 'date_of_birth', adult), '{}'),
    (v_ld, z, 'authenticated', 'authenticated', 'ft.ld.' || v_ld || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Lee', 'surname', 'Learner', 'date_of_birth', adult), '{}'),
    (v_sa, z, 'authenticated', 'authenticated', 'ft.sa.' || v_sa || '@example.invalid', jsonb_build_object('first_name', 'Sue', 'surname', 'Super', 'date_of_birth', adult), '{}'),
    (v_vo, z, 'authenticated', 'authenticated', 'ft.vo.' || v_vo || '@example.invalid', jsonb_build_object('first_name', 'Vic', 'surname', 'Officer', 'date_of_birth', adult), '{}'),
    (v_su, z, 'authenticated', 'authenticated', 'ft.su.' || v_su || '@example.invalid', jsonb_build_object('first_name', 'Sam', 'surname', 'Support', 'date_of_birth', adult), '{}'),
    (v_of, z, 'authenticated', 'authenticated', 'ft.of.' || v_of || '@example.invalid', jsonb_build_object('first_name', 'Olly', 'surname', 'Off', 'date_of_birth', adult), '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (v_sa, 'Sue', 'Super', 'ft.sa.' || v_sa || '@example.invalid', '', 'super_admin', true),
    (v_vo, 'Vic', 'Officer', 'ft.vo.' || v_vo || '@example.invalid', '', 'verification_officer', true),
    (v_su, 'Sam', 'Support', 'ft.su.' || v_su || '@example.invalid', '', 'support_agent', true),
    (v_of, 'Olly', 'Off', 'ft.of.' || v_of || '@example.invalid', '', 'verification_officer', false);
  update tutor_profiles set is_verified = true where id = v_v;
  r := r || 'S0 setup: five tutor accounts, a learner, a super admin, a verification officer, a support agent, a switched-off officer' || E'\n';

  -- ---- S: what exists and who may touch it ----------------------------------------------------------------------------------------------------
  select count(*)::text into t from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relname in ('founding_tutors_list', 'founding_page_events') and c.relrowsecurity;
  r := r || pg_temp.chk('S1', 'both tables exist with row-level security on', t, '2');
  r := r || pg_temp.chk('S2', 'no API role has any right on either table (anon / authenticated / service key, select and insert, both tables)',
    has_table_privilege('anon', 'public.founding_tutors_list', 'select')::text || '/' || has_table_privilege('authenticated', 'public.founding_tutors_list', 'select')::text || '/'
    || has_table_privilege('service_role', 'public.founding_tutors_list', 'select')::text || '/' || has_table_privilege('anon', 'public.founding_tutors_list', 'insert')::text || '/'
    || has_table_privilege('authenticated', 'public.founding_page_events', 'select')::text || '/' || has_table_privilege('anon', 'public.founding_page_events', 'insert')::text,
    'false/false/false/false/false/false');
  r := r || pg_temp.chk('S3', 'the two public functions are open to signed-out and signed-in callers',
    has_function_privilege('anon', 'public.join_founding_list(jsonb)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.join_founding_list(jsonb)', 'execute')::text || '/'
    || has_function_privilege('anon', 'public.log_founding_event(text,text,text,text)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.log_founding_event(text,text,text,text)', 'execute')::text,
    'true/true/true/true');
  r := r || pg_temp.chk('S4', 'the fourteen admin functions and the two signed-in functions are closed to signed-out callers',
    (select string_agg(has_function_privilege('anon', p.oid, 'execute')::text, '/' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('admin_founding_entries', 'admin_founding_coverage', 'admin_founding_funnel', 'admin_release_founding', 'admin_mark_founding_messaged', 'admin_set_founding_status',
                        'admin_add_founding_entry', 'admin_founding_gate_check', 'admin_set_founding_gate', 'my_founding_gate', 'founding_gate_allows_documents', 'admin_founding_hourly', 'admin_set_founding_tags', 'admin_founding_tags', 'admin_delete_founding_entry', 'admin_link_founding_entry')),
    'false/false/false/false/false/false/false/false/false/false/false/false/false/false/false/false');
  r := r || pg_temp.chk('S5', 'the internal helpers cannot be called by a signed-in person, the signed-out, or the server key',
    (select string_agg(has_function_privilege('authenticated', p.oid, 'execute')::text || has_function_privilege('anon', p.oid, 'execute')::text || has_function_privilege('service_role', p.oid, 'execute')::text, '/' order by p.proname)
       from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('founding_gate_state', 'founding_gate_state_raw', 'tidy_za_mobile', 'founding_phase_of', 'founding_phases', 'purge_expired_founding_entries', 'founding_gate_onboarding_guard', 'founding_count_rows', 'founding_tag_registered', 'founding_daily_job', 'lapse_founding_releases', 'founding_link_on_tutor_profile')),
    'falsefalsefalse/falsefalsefalse/falsefalsefalse/falsefalsefalse/falsefalsefalse/falsefalsefalse/falsefalsefalse/falsefalsefalse/falsefalsefalse/falsefalsefalse/falsefalsefalse/falsefalsefalse');
  select count(*)::text into t2 from pg_proc p where p.pronamespace = 'public'::regnamespace
    and (p.proname like '%founding%' or p.proname = 'tidy_za_mobile') and (p.proconfig is null or not ('search_path=public' = any (p.proconfig)));
  r := r || pg_temp.chk('S6', 'every new function pins search_path=public (none without it)', t2, '0');
  select string_agg(policyname || ':' || permissive || ':' || cmd, ' | ' order by tablename) into t from pg_policies
    where policyname in ('Founding gate: documents once a place has opened', 'Founding gate: tutor files once a place has opened');
  r := r || pg_temp.chk('S7', 'the two gate policies exist and are RESTRICTIVE inserts',
    t, 'Founding gate: tutor files once a place has opened:RESTRICTIVE:INSERT | Founding gate: documents once a place has opened:RESTRICTIVE:INSERT');
  select tg.tgname || '@' || c.relname into t from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where not tg.tgisinternal and tg.tgname = 'founding_gate_onboarding_guard';
  r := r || pg_temp.chk('S8', 'the onboarding trigger exists', t, 'founding_gate_onboarding_guard@tutor_onboarding');
  select (setting_value ->> 'on') into t from system_settings where setting_key = 'founding_tutors_gate';
  r := r || pg_temp.chk('S9', 'the switch row exists and ships OFF', t, 'false');
  r := r || pg_temp.chk('S10', 'founding_gate_on() answers false', public.founding_gate_on()::text, 'false');
  -- only meaningful in the run that follows the migration straight away (a tutor who signs up later has no entry until an admin adds one)
  select count(*)::text into t from tutor_profiles tp where not exists (select 1 from founding_tutors_list f where f.user_id = tp.id)
    and tp.id not in (v_nl, v_w, v_r, v_v, v_vl);
  r := r || pg_temp.chk('B1', 'BACKFILL: every tutor profile that existed before this test has a list entry (a tutor who signed up after the apply shows here)', t, '0');
  select count(*)::text into t from founding_tutors_list f where f.source = 'backfill'
    and (f.status not in ('verified', 'released') or f.full_name is not null or f.email is not null or f.whatsapp is not null or f.delete_after is not null or f.user_id is null);
  r := r || pg_temp.chk('B2', 'BACKFILL rows hold only the account link and a verified or released status: no name, email or number copied, no delete date', t, '0');

  -- ---- T: the number tidy ----------------------------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('T1', 'six ways of writing one number all give +27821234567',
    concat_ws(' ', public.tidy_za_mobile('082 123 4567'), public.tidy_za_mobile('0821234567'), public.tidy_za_mobile('+27 82 123 4567'), public.tidy_za_mobile('27821234567'),
              public.tidy_za_mobile('0027 82 123 4567'), public.tidy_za_mobile('082-123-4567')),
    '+27821234567 +27821234567 +27821234567 +27821234567 +27821234567 +27821234567');
  r := r || pg_temp.chk('T2', '"+27 (0) 82 123 4567" and "821234567" are tidied too',
    public.tidy_za_mobile('+27 (0) 82 123 4567') || ' ' || public.tidy_za_mobile('821234567'), '+27821234567 +27821234567');
  r := r || pg_temp.chk('T3', 'a landline, a short number, letters, a foreign number and null are refused (null)',
    concat_ws('|', coalesce(public.tidy_za_mobile('011 123 4567'), 'n'), coalesce(public.tidy_za_mobile('12345'), 'n'), coalesce(public.tidy_za_mobile('abc'), 'n'),
              coalesce(public.tidy_za_mobile('+44 7911 123456'), 'n'), coalesce(public.tidy_za_mobile(null), 'n')), 'n|n|n|n|n');

  -- ---- J: joining -------------------------------------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('J1', 'a signed-out person joins', pg_temp.join_as(null, pg_temp.pl('{}')), '{"ok": true}');
  select f.id into v_id1 from founding_tutors_list f where f.email_key = 'thandi.test@example.invalid';
  select (f.source || '|' || f.status || '|' || f.email || '|' || f.whatsapp || '|' || f.code_name || '|' || array_to_string(f.availability, ',') || '|' || coalesce(f.src, '-') || '|' || f.practicum || '|' || f.parent_reach || '|' || f.parent_reach_willing::text || '|' || f.has_bank::text) into t
    from founding_tutors_list f where f.id = v_id1;
  r := r || pg_temp.chk('J2', 'one row, email tidied and lower case, number as +27, ticks and answers kept, unknown availability word dropped, tag kept', t,
    'form|joined|thandi.test@example.invalid|+27821234567|Thandi|evenings,weekends|zztest|two|10_to_30|true|false');
  select ((f.subjects -> 0 ->> 'subject') = v_subj and (f.subjects -> 0 ->> 'min_grade') = 'Grade 8' and (f.subjects -> 0 ->> 'max_grade') = 'Grade 12')::text into t from founding_tutors_list f where f.id = v_id1;
  r := r || pg_temp.chk('J3', 'the subject and grades are stored as the app''s own lists spell them (typed in lower case)', t, 'true');
  select (f.consent_contact_at is not null and f.consent_contact_at > now() - interval '1 minute' and f.consent_marketing_at is null and f.consent_version = '2026-11-10')::text into t from founding_tutors_list f where f.id = v_id1;
  r := r || pg_temp.chk('J4', 'consent a is stamped by the database clock, consent b is empty because it was not ticked, the wording version is kept', t, 'true');
  select (f.delete_after > now() + interval '5 months 29 days' and f.delete_after < now() + interval '6 months 1 day')::text into t from founding_tutors_list f where f.id = v_id1;
  r := r || pg_temp.chk('J5', 'the delete date is 6 months after joining', t, 'true');
  select count(*)::text into t from founding_page_events e where e.visitor_id = v_vis and e.event = 'join' and e.src = 'zztest';
  r := r || pg_temp.chk('J6', 'the join counted itself once, with the visitor id and tag', t, '1');
  r := r || pg_temp.chk('J7', 'the same email again (other capitals, spaces) gets the same answer', pg_temp.join_as(null, pg_temp.pl('{"email": "THANDI.TEST@example.invalid  ", "full_name": "Someone Else"}')), '{"ok": true}');
  select count(*)::text || '/' || (select count(*)::text from founding_page_events e where e.visitor_id = v_vis and e.event = 'join') into t from founding_tutors_list f where f.email_key = 'thandi.test@example.invalid';
  r := r || pg_temp.chk('J8', 'ONE entry per email: still one row, no second join counted, and the first row was not changed', t, '1/1');
  select f.full_name into t from founding_tutors_list f where f.id = v_id1;
  r := r || pg_temp.chk('J8b', 'the first person''s name is untouched by the second try', t, 'Thandi Testfounder');
  r := r || pg_temp.chk('J9', 'BOT TRAP: the hidden field filled: told ok, nothing stored', pg_temp.join_as(null, pg_temp.pl('{"website": "http://spam.invalid", "email": "bot1@example.invalid"}')), '{"ok": true}');
  r := r || pg_temp.chk('J10', 'BOT TRAP: a form open for 1.5 seconds, or with no time sent: told ok, nothing stored',
    pg_temp.join_as(null, pg_temp.pl('{"elapsed_ms": 1500, "email": "bot2@example.invalid"}')) || ' ' || pg_temp.join_as(null, pg_temp.pl('{"elapsed_ms": null, "email": "bot3@example.invalid"}')), '{"ok": true} {"ok": true}');
  select count(*)::text into t from founding_tutors_list f where f.email_key in ('bot1@example.invalid', 'bot2@example.invalid', 'bot3@example.invalid');
  r := r || pg_temp.chk('J11', 'none of the three bots left a row', t, '0');
  r := r || pg_temp.chk('J12', 'under 18 or not ticked: refused in plain words', pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl('{"is_adult": false, "email": "a1@example.invalid"}')), 'ERR: You must be 18 or older to join the list.'), 'ERR: You must be 18 or older to join the list.');
  r := r || pg_temp.chk('J13', 'consent a not ticked: refused', pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl('{"consent_contact": false, "email": "a2@example.invalid"}')), 'ERR: Please tick the box that lets us contact you'), 'ERR: Please tick the box that lets us contact you');
  r := r || pg_temp.chk('J14', 'a landline is refused; a number with letters is refused',
    pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl('{"whatsapp": "011 123 4567", "email": "a3@example.invalid"}')), 'ERR: Please enter a South African WhatsApp number')
    || ' / ' || pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl('{"whatsapp": "call me", "email": "a4@example.invalid"}')), 'ERR: Please enter a South African WhatsApp number'),
    'ERR: Please enter a South African WhatsApp number / ERR: Please enter a South African WhatsApp number');
  r := r || pg_temp.chk('J15', 'a bad email, and a name with angle brackets, are refused',
    pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl('{"email": "not-an-email"}')), 'ERR: Please enter the email you will use to sign up.')
    || ' / ' || pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl('{"full_name": "<b>Bob</b>", "email": "a5@example.invalid"}')), 'ERR: Please enter your full name.'),
    'ERR: Please enter the email you will use to sign up. / ERR: Please enter your full name.');
  r := r || pg_temp.chk('J16', 'subjects: none, not a list, an unknown subject, and grades the wrong way round are all refused',
    pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl('{"subjects": [], "email": "b1@example.invalid"}')), 'ERR: Please pick at least one subject')
    || ' / ' || pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl('{"subjects": "maths", "email": "b2@example.invalid"}')), 'ERR: Please pick at least one subject')
    || ' / ' || pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl('{"subjects": [{"subject": "Underwater Basket Weaving", "min_grade": "Grade 8", "max_grade": "Grade 9"}], "email": "b3@example.invalid"}')), 'ERR: Please pick each subject')
    || ' / ' || pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('subjects', jsonb_build_array(jsonb_build_object('subject', v_subj, 'min_grade', 'Grade 12', 'max_grade', 'Grade 8')), 'email', 'b4@example.invalid'))), 'ERR: Please pick each subject'),
    'ERR: Please pick at least one subject / ERR: Please pick at least one subject / ERR: Please pick each subject / ERR: Please pick each subject');
  r := r || pg_temp.chk('J17', 'more than 12 subjects is refused',
    pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('email', 'b5@example.invalid', 'subjects',
      (select jsonb_agg(jsonb_build_object('subject', v_subj, 'min_grade', 'Grade 8', 'max_grade', 'Grade ' || (8 + (g % 5)))) from generate_series(1, 13) g)))), 'ERR: Please pick at least one subject'),
    'ERR: Please pick at least one subject');
  r := r || pg_temp.chk('J18', 'a missing or odd answer to practicum, police clearance, or the parents question is refused',
    pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl('{"practicum": "lots", "email": "c1@example.invalid"}')), 'ERR: Please say how much school-based teaching practice')
    || ' / ' || pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl('{"police_clearance": null, "email": "c2@example.invalid"}')), 'ERR: Please say where you are with your police clearance')
    || ' / ' || pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl('{"parent_reach_willing": null, "email": "c3@example.invalid"}')), 'ERR: Please answer the question about parents'),
    'ERR: Please say how much school-based teaching practice / ERR: Please say where you are with your police clearance / ERR: Please answer the question about parents');
  r := r || pg_temp.chk('J19', 'what you tell us about tutoring: 301 characters, or angle brackets, are refused',
    pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl(jsonb_build_object('prior_tutoring', repeat('x', 301), 'email', 'c4@example.invalid'))), 'ERR: Please keep what you tell us about tutoring')
    || ' / ' || pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl('{"prior_tutoring": "<script>", "email": "c5@example.invalid"}')), 'ERR: Please keep what you tell us about tutoring'),
    'ERR: Please keep what you tell us about tutoring / ERR: Please keep what you tell us about tutoring');
  r := r || pg_temp.chk('J20', 'a signed-in learner can join too, and ticking consent b stamps it',
    pg_temp.join_as(v_ld, pg_temp.pl('{"email": "d1@example.invalid", "consent_marketing": true, "src": "FAC", "heard_from": "whatever"}')), '{"ok": true}');
  select (f.consent_marketing_at is not null)::text || '|' || coalesce(f.src, '-') || '|' || coalesce(f.heard_from, '-') into t from founding_tutors_list f where f.email_key = 'd1@example.invalid';
  r := r || pg_temp.chk('J21', 'consent b stamped, the tag lower-cased, an unknown "heard from" dropped', t, 'true|fac|-');
  t := pg_temp.join_as(null, pg_temp.pl('{"email": "d2@example.invalid", "src": "a b<c>"}'));
  select coalesce(f.src, '-') into t2 from founding_tutors_list f where f.email_key = 'd2@example.invalid';
  r := r || pg_temp.chk('J22', 'a tag that is not a plain word is dropped (not stored as typed)', t || ' ' || coalesce(t2, 'no row'), '{"ok": true} -');
  r := r || pg_temp.chk('J23', 'a signed-out caller cannot read the table; nor can a signed-in one or the server key',
    pg_temp.deny(pg_temp.run_as(null, 'select count(*)::text from public.founding_tutors_list')) || ' / ' || pg_temp.deny(pg_temp.run_as(v_ld, 'select count(*)::text from public.founding_tutors_list'))
    || ' / ' || pg_temp.deny(pg_temp.as_service('select count(*)::text from public.founding_tutors_list')),
    'ERR: permission denied for / ERR: permission denied for / ERR: permission denied for');
  -- the hourly cap (made inside a block that is undone, so it does not disturb the checks that follow)
  begin
    insert into founding_tutors_list (source, full_name, code_name, whatsapp, email, email_key, status)
      select 'form', 'Cap ' || g, 'c', '+27820000000', 'cap' || g || '@example.invalid', 'cap' || g || '@example.invalid', 'joined' from generate_series(1, 200) g;
    r := r || pg_temp.chk('J24', 'the cap: after 200 joins in an hour the next one is told to wait', pg_temp.pfx(pg_temp.join_as(null, pg_temp.pl('{"email": "e1@example.invalid"}')), 'ERR: Many people are joining right now.'), 'ERR: Many people are joining right now.');
    raise exception 'undo the cap rows';
  exception when others then
    if sqlerrm <> 'undo the cap rows' then r := r || 'J24 UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n'; end if;
  end;

  -- ---- E: the page counters ---------------------------------------------------------------------------------------------------------------------
  perform public.log_founding_event(v_vis2::text, 'open', 'zztest');
  perform public.log_founding_event(v_vis2::text, 'open', 'zztest');
  perform public.log_founding_event(v_vis2::text, 'open', 'ZZTEST');
  perform public.log_founding_event(v_vis2::text, 'see_more', 'zztest');
  perform public.log_founding_event(v_vis2::text, 'form_start', 'zztest');
  t2 := pg_temp.do_as(null, format('select public.log_founding_event(%L, ''open'', ''zztest'')', v_vis2::text));
  select count(*)::text into t from founding_page_events e where e.visitor_id = v_vis2;
  r := r || pg_temp.chk('E1', 'five counts and then one more from a signed-out call are stored (six; the tag is lower-cased)', t2 || ' ' || t, 'done 6');
  perform public.log_founding_event('not-a-uuid', 'open', 'zztest');
  perform public.log_founding_event(null, 'open', 'zztest');
  perform public.log_founding_event(v_vis2::text, 'join', 'zztest');
  perform public.log_founding_event(v_vis2::text, 'hacked', 'zztest');
  perform public.log_founding_event(v_vis2::text, null, 'zztest');
  select count(*)::text into t from founding_page_events e where e.visitor_id = v_vis2;
  r := r || pg_temp.chk('E2', 'a bad visitor id, a claimed join, an unknown or empty event are ignored with no error (still 6)', t, '6');
  select coalesce(e.src, '-') into t from founding_page_events e where e.visitor_id = v_vis2 and e.event = 'form_start';
  r := r || pg_temp.chk('E3', 'the tag is kept', t, 'zztest');
  perform public.log_founding_event(v_vis2::text, 'open', 'a b<c>');
  select count(*)::text into t from founding_page_events e where e.visitor_id = v_vis2 and e.src is null;
  r := r || pg_temp.chk('E4', 'a tag that is not a plain word is stored as nothing', t, '1');
  for n in 1..40 loop perform public.log_founding_event(v_vis2::text, 'open', 'zztest'); end loop;
  select count(*)::text into t from founding_page_events e where e.visitor_id = v_vis2;
  r := r || pg_temp.chk('E5', 'at most 30 counts an hour per visitor id', t, '30');

  -- ---- G: the gate: four states, off and on ------------------------------------------------------------------------------------------------------
  -- v_w and v_r are on the list by email; v_vl is linked by account (a different email); v_nl and v_v have no entry.
  insert into founding_tutors_list (source, full_name, code_name, whatsapp, email, email_key, status, released_at, delete_after, consent_version)
    values ('form', 'Wim Waiting', 'Wim', '+27820000001', 'ft.w.' || v_w || '@example.invalid', 'ft.w.' || v_w || '@example.invalid', 'joined', null, now() + interval '6 months', 'test'),
           ('form', 'Rae Released', 'Rae', '+27820000002', 'Ft.R.' || v_r || '@Example.invalid', 'ft.r.' || v_r || '@example.invalid', 'released', now(), now() + interval '30 days', 'test');
  insert into founding_tutors_list (source, status, user_id, consent_version) values ('backfill', 'verified', v_vl, 'test');
  r := r || pg_temp.chk('G0', 'with the switch OFF everyone is "open", whatever the list says',
    pg_temp.gate_of(v_nl) || ' ' || pg_temp.gate_of(v_w) || ' ' || pg_temp.gate_of(v_r) || ' ' || pg_temp.gate_of(v_v) || ' ' || pg_temp.gate_of(v_ld), 'open open open open open');
  r := r || pg_temp.chk('G1', 'with the switch OFF a tutor with no entry still uploads a document and chooses a type exactly as before',
    pg_temp.do_as(v_nl, format('insert into public.tutor_verification_documents (tutor_id, document_type, document_url) values (%L, ''identity_doc'', %L)', v_nl, v_nl || '/id.png'))
    || ' ' || pg_temp.do_as(v_nl, 'select public.set_my_tutor_track(''beginner'')'), 'done done');
  r := r || pg_temp.chk('G2', 'my_founding_gate says the switch is off', pg_temp.run_as(v_nl, 'select public.my_founding_gate()->>''gate_on'''), 'false');
  r := r || pg_temp.chk('G3', 'a signed-out caller cannot ask', pg_temp.deny(pg_temp.run_as(null, 'select public.my_founding_gate()::text')), 'ERR: permission denied for');
  delete from tutor_verification_documents where tutor_id = v_nl;
  delete from tutor_onboarding where tutor_id = v_nl;

  update system_settings set setting_value = '{"on": true}'::jsonb where setting_key = 'founding_tutors_gate';
  r := r || pg_temp.chk('G4', 'the switch ON: the four states (no entry / joined / released / verified account) and a learner',
    pg_temp.gate_of(v_nl) || ' ' || pg_temp.gate_of(v_w) || ' ' || pg_temp.gate_of(v_r) || ' ' || pg_temp.gate_of(v_v) || ' ' || pg_temp.gate_of(v_ld),
    'not_listed waiting released verified not_listed');
  r := r || pg_temp.chk('G5', 'a tutor whose entry is linked by account (other email) and says verified is "verified"', pg_temp.gate_of(v_vl), 'verified');
  r := r || pg_temp.chk('G6', 'the email match ignores capitals (the entry was typed Ft.R...@Example.invalid)', pg_temp.gate_of(v_r), 'released');
  r := r || pg_temp.chk('G7', 'a document row: refused for no entry and for joined; allowed for released and for a verified account',
    pg_temp.pfx(pg_temp.do_as(v_nl, format('insert into public.tutor_verification_documents (tutor_id, document_type, document_url) values (%L, ''identity_doc'', %L)', v_nl, v_nl || '/id.png')), 'ERR: new row violates row-level security')
    || ' / ' || pg_temp.pfx(pg_temp.do_as(v_w, format('insert into public.tutor_verification_documents (tutor_id, document_type, document_url) values (%L, ''identity_doc'', %L)', v_w, v_w || '/id.png')), 'ERR: new row violates row-level security')
    || ' / ' || pg_temp.do_as(v_r, format('insert into public.tutor_verification_documents (tutor_id, document_type, document_url) values (%L, ''identity_doc'', %L)', v_r, v_r || '/id.png'))
    || ' / ' || pg_temp.do_as(v_v, format('insert into public.tutor_verification_documents (tutor_id, document_type, document_url) values (%L, ''identity_doc'', %L)', v_v, v_v || '/id.png')),
    'ERR: new row violates row-level security / ERR: new row violates row-level security / done / done');
  r := r || pg_temp.chk('G8', 'the file itself (storage): refused for no entry and for joined; allowed for released',
    pg_temp.pfx(pg_temp.do_as(v_nl, format('insert into storage.objects (bucket_id, name, owner) values (''tutor-documents'', %L, %L)', v_nl || '/id.png', v_nl)), 'ERR: new row violates row-level security')
    || ' / ' || pg_temp.pfx(pg_temp.do_as(v_w, format('insert into storage.objects (bucket_id, name, owner) values (''tutor-documents'', %L, %L)', v_w || '/id.png', v_w)), 'ERR: new row violates row-level security')
    || ' / ' || pg_temp.do_as(v_r, format('insert into storage.objects (bucket_id, name, owner) values (''tutor-documents'', %L, %L)', v_r || '/id.png', v_r)),
    'ERR: new row violates row-level security / ERR: new row violates row-level security / done');
  r := r || pg_temp.chk('G9', 'choosing a tutor type: refused for no entry and for joined (plain words); allowed for released and verified',
    pg_temp.pfx(pg_temp.do_as(v_nl, 'select public.set_my_tutor_track(''beginner'')'), 'ERR: Your place has not opened yet.')
    || ' / ' || pg_temp.pfx(pg_temp.do_as(v_w, 'select public.set_my_tutor_track(''beginner'')'), 'ERR: Your place has not opened yet.')
    || ' / ' || pg_temp.do_as(v_r, 'select public.set_my_tutor_track(''beginner'')') || ' / ' || pg_temp.do_as(v_v, 'select public.set_my_tutor_track(''experienced'')'),
    'ERR: Your place has not opened yet. / ERR: Your place has not opened yet. / done / done');
  r := r || pg_temp.chk('G10', 'agreeing to the documents wording is refused for a waiting tutor too',
    pg_temp.pfx(pg_temp.do_as(v_w, 'select public.record_my_documents_consent(''v1'')'), 'ERR:'), 'ERR:');
  r := r || pg_temp.chk('G11', 'an admin still adds a document for a tutor (the gate is for the tutor''s own call)',
    pg_temp.do_as(v_vo, format('insert into public.tutor_verification_documents (tutor_id, document_type, document_url) values (%L, ''identity_doc'', %L)', v_nl, v_nl || '/by-admin.png')), 'done');
  r := r || pg_temp.chk('G12', 'a waiting tutor cannot accept a request (accepting already needs is_verified, and a waiting tutor is not verified)',
    (select (not tp.is_verified)::text from tutor_profiles tp where tp.id = v_w), 'true');
  update tutor_profiles set is_verified = true where id = v_w;
  r := r || pg_temp.chk('G13', 'the moment a tutor is verified the state is "verified", whatever the list says', pg_temp.gate_of(v_w), 'verified');
  update tutor_profiles set is_verified = false where id = v_w;
  update system_settings set setting_value = '{"on": false}'::jsonb where setting_key = 'founding_tutors_gate';
  r := r || pg_temp.chk('G14', 'switching it OFF again puts everyone back to open at once',
    pg_temp.gate_of(v_nl) || ' ' || pg_temp.gate_of(v_w) || ' ' || pg_temp.do_as(v_w, format('insert into public.tutor_verification_documents (tutor_id, document_type, document_url) values (%L, ''identity_doc'', %L)', v_w, v_w || '/id2.png')), 'open open done');

  -- ---- A: the admin's pages ---------------------------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('A1', 'support agent, switched-off officer, learner and signed-out callers cannot read the list',
    pg_temp.pfx(pg_temp.adm(v_su, 'public.admin_founding_entries()'), 'ERR: Only a verification officer') || ' / ' || pg_temp.pfx(pg_temp.adm(v_of, 'public.admin_founding_entries()'), 'ERR: Only a verification officer')
    || ' / ' || pg_temp.pfx(pg_temp.adm(v_ld, 'public.admin_founding_entries()'), 'ERR: Only a verification officer') || ' / ' || pg_temp.deny(pg_temp.adm(null, 'public.admin_founding_entries()')),
    'ERR: Only a verification officer / ERR: Only a verification officer / ERR: Only a verification officer / ERR: permission denied for');
  r := r || pg_temp.chk('A2', 'the same callers are refused by the coverage view, the page counts, release and the gate check',
    pg_temp.pfx(pg_temp.adm(v_su, 'public.admin_founding_coverage()'), 'ERR: Only a verification officer') || ' / ' || pg_temp.pfx(pg_temp.adm(v_su, 'public.admin_founding_funnel((now() at time zone ''Africa/Johannesburg'')::date - 6, (now() at time zone ''Africa/Johannesburg'')::date)'), 'ERR: Only a verification officer')
    || ' / ' || pg_temp.pfx(pg_temp.adm(v_su, format('public.admin_release_founding(array[%L]::uuid[])', v_id1)), 'ERR: Only a verification officer') || ' / ' || pg_temp.pfx(pg_temp.adm(v_su, 'public.admin_founding_gate_check()'), 'ERR: Only a verification officer'),
    'ERR: Only a verification officer / ERR: Only a verification officer / ERR: Only a verification officer / ERR: Only a verification officer');
  select id into v_id2 from founding_tutors_list where email_key = 'ft.r.' || v_r || '@example.invalid';
  select id into v_id3 from founding_tutors_list where email_key = 'ft.w.' || v_w || '@example.invalid';
  t := pg_temp.adm(v_vo, 'public.admin_founding_entries()');
  select (j ->> 'effective_status') || '|' || (j ->> 'has_account') || '|' || (j -> 'phases')::text || '|' || (j ->> 'src') into t2 from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else t::jsonb end) j where j ->> 'id' = v_id1::text;
  r := r || pg_temp.chk('A3', 'the officer sees the joiner: joined, no account, phases FET and Senior (Grades 8 to 12), tag zztest', coalesce(t2, left(t, 120)), 'joined|false|["FET (10-12)", "Senior (7-9)"]|zztest');
  select (j ->> 'effective_status') || '|' || (j ->> 'has_account') || '|' || (j ->> 'tutor_verified') into t2 from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else t::jsonb end) j where j ->> 'id' = v_id2::text;
  r := r || pg_temp.chk('A4', 'a released entry whose person has an account reads signed_up (account yes, verified no)', coalesce(t2, '-'), 'signed_up|true|false');
  select (j ->> 'effective_status') || '|' || (j ->> 'has_account') into t2 from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else t::jsonb end) j where j ->> 'id' = v_id3::text;
  r := r || pg_temp.chk('A5', 'a joined entry stays joined even though its person has an account (the officer sees the account flag)', coalesce(t2, '-'), 'joined|true');
  select count(*)::text into t2 from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else t::jsonb end) j where j ->> 'source' = 'backfill' and (j ->> 'email') is null;
  r := r || pg_temp.chk('A6', 'backfill rows come through with no email (nothing was copied) and the list answers a real array', (t2::int >= 1)::text, 'true');

  -- coverage: the supply side (a verified tutor, hours they have set), and the list side
  insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
    values (v_v, 'Zz Test Subject', 'caps', 'Grade 8', 'Grade 10', 'verified');
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) values (v_v, 1, '16:00', '18:00'), (v_v, 3, '16:00', '17:00');
  t := pg_temp.adm(v_vo, 'public.admin_founding_coverage()');
  select (j ->> 'ready_tutors') || '|' || ((j ->> 'weekly_hours')::numeric)::text || '|' || (j ->> 'unserved_requests') into t2
    from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else t::jsonb end) j where j ->> 'subject' = 'Zz Test Subject' and j ->> 'phase' = 'Senior (7-9)';
  r := r || pg_temp.chk('C1', 'COVERAGE: Zz Test Subject at Senior band: 1 ready tutor, 3 weekly hours, 0 unserved', coalesce(t2, left(t, 120)), '1|3.0|0');
  select (j ->> 'ready_tutors') into t2 from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else t::jsonb end) j where j ->> 'subject' = 'Zz Test Subject' and j ->> 'phase' = 'FET (10-12)';
  r := r || pg_temp.chk('C2', 'a range that crosses a phase (Grades 8 to 10) counts in both phases, and not in Foundation', coalesce(t2, '-') || '|' || (select count(*)::text from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else t::jsonb end) j where j ->> 'subject' = 'Zz Test Subject' and j ->> 'phase' like 'Foundation%'), '1|0');
  select (j ->> 'on_list') into t2 from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else t::jsonb end) j where j ->> 'subject' = v_subj and j ->> 'phase' = 'Senior (7-9)';
  r := r || pg_temp.chk('C3', 'COVERAGE: the people on the list for that subject at the Senior band includes the joiner (at least 1)', ((coalesce(t2, '0'))::int >= 1)::text, 'true');
  update tutor_subject_competencies set verification_status = 'pending' where tutor_id = v_v and subject_name = 'Zz Test Subject';
  t := pg_temp.adm(v_vo, 'public.admin_founding_coverage()');
  select count(*)::text into t2 from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else t::jsonb end) j where j ->> 'subject' = 'Zz Test Subject' and (j ->> 'ready_tutors')::int > 0;
  r := r || pg_temp.chk('C4', 'a competency that is not verified is not counted as supply', t2, '0');

  -- the page counts
  t := pg_temp.adm(v_vo, 'public.admin_founding_funnel((now() at time zone ''Africa/Johannesburg'')::date - 6, (now() at time zone ''Africa/Johannesburg'')::date)');
  select (j ->> 'opens') || '|' || (j ->> 'visitors') || '|' || (j ->> 'see_more') || '|' || (j ->> 'form_start') || '|' || (j ->> 'joins') into t2
    from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else (t::jsonb -> 'by_src') end) j where j ->> 'src' = 'zztest';
  r := r || pg_temp.chk('F1', 'FUNNEL by tag zztest: 27 opens by 1 visitor, 1 see-more, 1 form start, 1 join', coalesce(t2, left(t, 120)), '27|1|1|1|1');
  select (j ->> 'opens') || '|' || (j ->> 'visitors') || '|' || (j ->> 'joins') into t2
    from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else (t::jsonb -> 'by_day') end) j
    where j ->> 'src' = 'zztest' and (j ->> 'day') = (now() at time zone 'Africa/Johannesburg')::date::text;
  r := r || pg_temp.chk('F2', 'FUNNEL by day (South African time): today''s zztest row carries the same numbers', coalesce(t2, '-'), '27|1|1');
  r := r || pg_temp.chk('F3', 'the totals include them (at least 27 opens, 1 new visitor), and the range is the one asked for (7 days)', ((t::jsonb -> 'totals' ->> 'opens')::int >= 27 and (t::jsonb -> 'totals' ->> 'visitors')::int >= 1)::text || '|' || ((t::jsonb ->> 'to')::date - (t::jsonb ->> 'from')::date)::text, 'true|6');
  t2 := pg_temp.adm(v_vo, 'public.admin_founding_funnel(current_date - 1000, current_date)');
  t3 := pg_temp.adm(v_vo, 'public.admin_founding_funnel(current_date + 5, current_date)');
  r := r || pg_temp.chk('F4', 'the range is kept to 365 days at most, and "from" after "to" is pulled back to one day', ((t2::jsonb ->> 'to')::date - (t2::jsonb ->> 'from')::date)::text || '/' || ((t3::jsonb ->> 'to')::date - (t3::jsonb ->> 'from')::date)::text, '365/0');
  -- R1: NEW visitors and first see-more / form starts only, so the days add up; opens by the link's tag, the rest by the visitor's FIRST tag; test tags never counted
  insert into founding_page_events (created_at, visitor_id, event, src, first_src) values
    (now() - interval '1 day', v_vis3, 'open', 'zzday', 'zzday'), (now(), v_vis3, 'open', 'zzday', 'zzday'),
    (now() - interval '1 day', v_vis3, 'see_more', 'zzday', 'zzday'), (now(), v_vis3, 'see_more', 'zzday', 'zzday'), (now() - interval '1 day', v_vis3, 'form_start', 'zzday', 'zzday'),
    (now(), v_vis4, 'open', 'zzfirst', 'zzfirst'), (now(), v_vis4, 'open', 'zzlater', 'zzfirst'), (now(), v_vis4, 'see_more', 'zzlater', 'zzfirst'),
    (now(), gen_random_uuid(), 'open', 'test-a', 'test-a'), (now(), gen_random_uuid(), 'open', 'zzday', 'test-b'), (now(), gen_random_uuid(), 'join', 'test-c', 'test-c');
  t := pg_temp.adm(v_vo, 'public.admin_founding_funnel((now() at time zone ''Africa/Johannesburg'')::date - 6, (now() at time zone ''Africa/Johannesburg'')::date)');
  select (j ->> 'opens') || '|' || (j ->> 'visitors') || '|' || (j ->> 'see_more') || '|' || (j ->> 'form_start') || '|' || (j ->> 'joins') into t2
    from jsonb_array_elements((t::jsonb -> 'by_src')) j where j ->> 'src' = 'zzday';
  r := r || pg_temp.chk('F5', 'ONE visitor on two days: 2 opens (each load), but 1 new visitor, 1 first see-more and 1 first form start in all (the days add up)', coalesce(t2, '-'), '2|1|1|1|0');
  select string_agg((j ->> 'day') || ':' || (j ->> 'opens') || '/' || (j ->> 'visitors') || '/' || (j ->> 'see_more') || '/' || (j ->> 'form_start'), ' ' order by j ->> 'day') into t2
    from jsonb_array_elements((t::jsonb -> 'by_day')) j where j ->> 'src' = 'zzday';
  r := r || pg_temp.chk('F6', 'by day: yesterday carries the new visitor, the first see-more and the first form start; today carries only its own open',
    coalesce(t2, '-'), ((now() at time zone 'Africa/Johannesburg')::date - 1)::text || ':1/1/1/1 ' || (now() at time zone 'Africa/Johannesburg')::date::text || ':1/0/0/0');
  select string_agg((j ->> 'src') || '=' || (j ->> 'opens') || '/' || (j ->> 'visitors') || '/' || (j ->> 'see_more'), ' ' order by j ->> 'src') into t2
    from jsonb_array_elements((t::jsonb -> 'by_src')) j where j ->> 'src' in ('zzfirst', 'zzlater');
  r := r || pg_temp.chk('F7', 'a visitor whose later link carried another tag: the open is filed under the link''s tag, the new visitor and the see-more under their FIRST tag', coalesce(t2, '-'), 'zzfirst=1/1/1 zzlater=1/0/0');
  select count(*)::text into t2 from jsonb_array_elements((t::jsonb -> 'by_src')) j where j ->> 'src' like 'test%';
  r := r || pg_temp.chk('F8', 'tags that start "test", and a visitor whose FIRST tag is a test tag, are never counted', t2 || '|' || (select (j ->> 'opens') from jsonb_array_elements((t::jsonb -> 'by_src')) j where j ->> 'src' = 'zzday'), '0|2');
  r := r || pg_temp.chk('F9', 'R3: tags not in the registry are listed (zzday yes, a test tag no, "(none)" no)', ((t::jsonb -> 'unregistered') @> '["zzday"]')::text || '|' || ((t::jsonb -> 'unregistered') @> '["test-a"]')::text || '|' || ((t::jsonb -> 'unregistered') @> '["(none)"]')::text, 'true|false|false');
  r := r || pg_temp.chk('F10', 'R3: the registry is edited by an officer (lower-cased, no repeats, no blanks, a * registers a prefix); a bad tag, and a support agent, are refused',
    pg_temp.adm(v_vo, 'public.admin_set_founding_tags(array[''ZZDay'', ''zzday'', '' ref-* '', '''', ''zzfirst''])->>''tags''') || ' / ' || pg_temp.pfx(pg_temp.adm(v_vo, 'public.admin_set_founding_tags(array[''Bad Tag!''])'), 'ERR: A tag is 1 to 32')
    || ' / ' || pg_temp.pfx(pg_temp.adm(v_su, 'public.admin_set_founding_tags(array[''x''])'), 'ERR: Only a verification officer'),
    '["ref-*", "zzday", "zzfirst"] / ERR: A tag is 1 to 32 / ERR: Only a verification officer');
  r := r || pg_temp.chk('F11', 'the saved list reads back; a registered tag and a prefix match; others do not', pg_temp.adm(v_vo, 'public.admin_founding_tags()') || ' ' || public.founding_tag_registered('zzday')::text || ' ' || public.founding_tag_registered('ref-abc')::text || ' ' || public.founding_tag_registered('xref-abc')::text || ' ' || public.founding_tag_registered('zzlater')::text,
    '["ref-*", "zzday", "zzfirst"] true true false false');
  t := pg_temp.adm(v_vo, 'public.admin_founding_funnel((now() at time zone ''Africa/Johannesburg'')::date - 6, (now() at time zone ''Africa/Johannesburg'')::date)');
  select (j ->> 'registered') into t2 from jsonb_array_elements((t::jsonb -> 'by_src')) j where j ->> 'src' = 'zzday';
  r := r || pg_temp.chk('F12', 'after registering it, zzday is shown as registered and leaves the "not in the registry" list', t2 || '|' || ((t::jsonb -> 'unregistered') @> '["zzday"]')::text || '|' || ((t::jsonb -> 'unregistered') @> '["zzlater"]')::text, 'true|false|true');
  -- R2: by hour
  t := pg_temp.adm(v_vo, 'public.admin_founding_hourly(null, now() + interval ''1 hour'')');
  select (sum((j ->> 'opens')::int))::text || '|' || (min(length(j ->> 'hour')))::text into t2 from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else (t::jsonb -> 'by_hour') end) j where j ->> 'src' = 'zztest';
  r := r || pg_temp.chk('F13', 'BY HOUR (last 72 hours, South African time): the same counters per hour and tag; 27 opens under zztest, hours written "YYYY-MM-DD HH:00"', coalesce(t2, left(t, 120)), '27|16');
  r := r || pg_temp.chk('F14', 'by hour is closed to a support agent and to the signed-out', pg_temp.pfx(pg_temp.adm(v_su, 'public.admin_founding_hourly()'), 'ERR: Only a verification officer') || ' / ' || pg_temp.deny(pg_temp.adm(null, 'public.admin_founding_hourly()')), 'ERR: Only a verification officer / ERR: permission denied for');
  -- the family page's code counter: stored, never one of the page's five counters
  perform public.log_founding_event(v_vis4::text, 'code_open', 'ODI-1');
  select count(*)::text into t2 from founding_page_events where event = 'code_open' and src = 'odi-1' and visitor_id = v_vis4;
  t := pg_temp.adm(v_vo, 'public.admin_founding_funnel((now() at time zone ''Africa/Johannesburg'')::date - 6, (now() at time zone ''Africa/Johannesburg'')::date)');
  r := r || pg_temp.chk('F15', 'CODE OPENS: a code_open is stored with the code (lower case) in src, and never appears among the page counters', t2 || '|' || (select count(*)::text from jsonb_array_elements((t::jsonb -> 'by_src')) j where j ->> 'src' = 'odi-1'), '1|0');

  -- release, messaged, status, add
  r := r || pg_temp.chk('R1', 'RELEASE: one joined entry and one already released: 1 released, 1 skipped',
    pg_temp.adm(v_vo, format('(public.admin_release_founding(array[%L, %L]::uuid[])->>''released'') || ''/'' || (public.admin_release_founding(array[%L]::uuid[])->>''skipped'')', v_id1, v_id2, v_id2)), '1/1');
  select (f.status || '|' || (f.released_at is not null)::text || '|' || (f.delete_after > now() + interval '29 days 23 hours' and f.delete_after < now() + interval '30 days 1 hour')::text) into t from founding_tutors_list f where f.id = v_id1;
  r := r || pg_temp.chk('R2', 'the released row: status released, time stamped, delete date 30 days after the place opens', t, 'released|true|true');
  r := r || pg_temp.chk('R3', 'nothing chosen, or more than 500: refused',
    pg_temp.pfx(pg_temp.adm(v_vo, 'public.admin_release_founding(array[]::uuid[])'), 'ERR: Choose between 1 and 500') || ' / ' || pg_temp.pfx(pg_temp.adm(v_vo, 'public.admin_release_founding((select array_agg(gen_random_uuid()) from generate_series(1, 501)))'), 'ERR: Choose between 1 and 500'),
    'ERR: Choose between 1 and 500 / ERR: Choose between 1 and 500');
  r := r || pg_temp.chk('R4', 'a super admin may release too', pg_temp.adm(v_sa, format('public.admin_release_founding(array[%L]::uuid[])->>''skipped''', v_id1)), '1');
  r := r || pg_temp.chk('M1', 'MESSAGED: "released" and then "verified" are recorded on the row',
    pg_temp.adm(v_vo, format('public.admin_mark_founding_messaged(%L, ''released'')->>''ok''', v_id1)) || ' ' || pg_temp.adm(v_vo, format('public.admin_mark_founding_messaged(%L, ''verified'')->>''ok''', v_id1)), 'true true');
  select ((f.released_messaged_at is not null) and (f.verified_messaged_at is not null))::text into t from founding_tutors_list f where f.id = v_id1;
  r := r || pg_temp.chk('M2', 'both times are stamped', t, 'true');
  r := r || pg_temp.chk('M3', 'a wrong kind and an unknown entry are refused',
    pg_temp.pfx(pg_temp.adm(v_vo, format('public.admin_mark_founding_messaged(%L, ''lunch'')', v_id1)), 'ERR: Choose released, verified or waiting') || ' / ' || pg_temp.pfx(pg_temp.adm(v_vo, format('public.admin_mark_founding_messaged(%L, ''released'')', gen_random_uuid())), 'ERR: No such entry'),
    'ERR: Choose released, verified or waiting / ERR: No such entry');
  r := r || pg_temp.chk('M4', 'a support agent cannot mark', pg_temp.pfx(pg_temp.adm(v_su, format('public.admin_mark_founding_messaged(%L, ''released'')', v_id1)), 'ERR: Only a verification officer'), 'ERR: Only a verification officer');
  t := pg_temp.adm(v_vo, format('public.admin_set_founding_status(%L, ''joined'')->>''status''', v_id1));
  select t || '|' || (f.released_at is null)::text || '|' || (f.released_messaged_at is null)::text || '|' || (f.delete_after > f.created_at + interval '5 months 29 days' and f.delete_after < f.created_at + interval '6 months 1 day')::text into t2 from founding_tutors_list f where f.id = v_id1;
  r := r || pg_temp.chk('S11', 'a correction back to joined clears the release date and the released-message mark, and restores the 6-month delete date', t2, 'joined|true|true|true');
  t := pg_temp.adm(v_vo, format('public.admin_set_founding_status(%L, ''verified'')->>''status''', v_id1));
  select t || '|' || coalesce(f.delete_after::text, 'none') into t2 from founding_tutors_list f where f.id = v_id1;
  r := r || pg_temp.chk('S12', 'set to verified: no delete date (the Privacy Policy covers a tutor)', t2, 'verified|none');
  r := r || pg_temp.chk('S13', 'a status that does not exist is refused', pg_temp.pfx(pg_temp.adm(v_vo, format('public.admin_set_founding_status(%L, ''banned'')', v_id1)), 'ERR: Choose joined, released, signed_up or verified'), 'ERR: Choose joined, released, signed_up or verified');
  t := pg_temp.adm(v_vo, 'public.admin_add_founding_entry(''Warm Tutor'', ''Warm'', ''082 555 0101'', ''  Warm.Tutor@Example.invalid'', ''released'')->>''ok''');
  select t || '|' || f.source || '|' || f.consent_version || '|' || f.status || '|' || f.whatsapp || '|' || f.email_key || '|' || (f.delete_after > now() + interval '29 days 23 hours')::text into t2 from founding_tutors_list f where f.email_key = 'warm.tutor@example.invalid';
  r := r || pg_temp.chk('N1', 'ADD A PERSON: a warm tutor is added as released, source admin, no form consent claimed, number and email tidied', t2, 'true|admin|added-by-admin|released|+27825550101|warm.tutor@example.invalid|true');
  r := r || pg_temp.chk('N2', 'the same email twice, a bad number, a bad email and a bad status are refused',
    pg_temp.pfx(pg_temp.adm(v_vo, 'public.admin_add_founding_entry(''Warm Tutor'', ''Warm'', ''082 555 0101'', ''warm.tutor@example.invalid'', ''released'')'), 'ERR: That email is already on the list')
    || ' / ' || pg_temp.pfx(pg_temp.adm(v_vo, 'public.admin_add_founding_entry(''Wanda W'', ''W'', ''011 555 0101'', ''wanda@example.invalid'', ''released'')'), 'ERR: That is not a South African mobile number')
    || ' / ' || pg_temp.pfx(pg_temp.adm(v_vo, 'public.admin_add_founding_entry(''Wanda W'', ''W'', ''082 555 0102'', ''wanda-at-example'', ''released'')'), 'ERR: That is not an email address')
    || ' / ' || pg_temp.pfx(pg_temp.adm(v_vo, 'public.admin_add_founding_entry(''Wanda W'', ''W'', ''082 555 0102'', ''wanda@example.invalid'', ''signed_up'')'), 'ERR: Choose joined, released or verified'),
    'ERR: That email is already on the list / ERR: That is not a South African mobile number / ERR: That is not an email address / ERR: Choose joined, released or verified');

  -- the gate check and the switch
  t := pg_temp.adm(v_vo, 'public.admin_founding_gate_check()');
  r := r || pg_temp.chk('K1', 'THE READ-BACK: the gate check sees the tutor with no entry (not_listed at least 1, listed by name) and the switch is off',
    ((t::jsonb ->> 'not_listed')::int >= 1)::text || '|' || (t::jsonb -> 'not_listed_accounts' @> '[{"name": "Nia Notlisted"}]')::text || '|' || (t::jsonb ->> 'gate_on'), 'true|true|false');
  r := r || pg_temp.chk('K2', 'switching ON: refused for a verification officer (super admin only); refused for a super admin while a tutor has no entry',
    pg_temp.pfx(pg_temp.adm(v_vo, 'public.admin_set_founding_gate(true)'), 'ERR: Only a super admin can switch')
    || ' / ' || (pg_temp.adm(v_sa, 'public.admin_set_founding_gate(true)') like 'ERR: % tutor account(s) are not on the list yet. Add or release them first, then switch the gate on.')::text,
    'ERR: Only a super admin can switch / true');
  select (setting_value ->> 'on') into t from system_settings where setting_key = 'founding_tutors_gate';
  r := r || pg_temp.chk('K3', 'and the refusal left the switch off', t, 'false');
  -- the migration's own backfill statement, run again: every tutor with no row by account gets one; a tutor that already has one is not doubled
  select count(*)::text into t from founding_tutors_list where user_id = v_vl;
  insert into public.founding_tutors_list (source, status, user_id, consent_version, delete_after)
  select 'backfill', case when coalesce(tp.is_verified, false) then 'verified' else 'released' end, tp.id, 'backfill-2026-11-10', null
  from public.tutor_profiles tp
  where not exists (select 1 from public.founding_tutors_list f where f.user_id = tp.id)
  on conflict do nothing;
  select t || '/' || count(*)::text into t from founding_tutors_list where user_id = v_vl;
  r := r || pg_temp.chk('K4', 'the backfill statement run again does not double a tutor that already has a row', t, '1/1');
  select (select status from founding_tutors_list where user_id = v_nl) || '|' || (select status from founding_tutors_list where user_id = v_v) into t2;
  r := r || pg_temp.chk('K5', 'and it covers a tutor with no row (released) and a verified one (verified)', t2, 'released|verified');
  t := pg_temp.adm(v_vo, 'public.admin_founding_gate_check()');
  r := r || pg_temp.chk('K6', 'the read-back is now clean: not_listed 0', (t::jsonb ->> 'not_listed'), '0');
  r := r || pg_temp.chk('K7', 'a super admin switches the gate ON', pg_temp.adm(v_sa, 'public.admin_set_founding_gate(true)->>''gate_on'''), 'true');
  r := r || pg_temp.chk('K8', 'the switch row says on, was stamped by that admin, and founding_gate_on() agrees', (select (setting_value ->> 'on') || '|' || (last_updated_by = v_sa)::text from system_settings where setting_key = 'founding_tutors_gate') || '|' || public.founding_gate_on()::text, 'true|true|true');
  r := r || pg_temp.chk('K9', 'with the gate on, a tutor with no entry before the backfill is now "released" and can carry on', pg_temp.gate_of(v_nl), 'released');
  r := r || pg_temp.chk('K10', 'a verification officer cannot switch it off; a super admin can; and "null" is refused',
    pg_temp.pfx(pg_temp.adm(v_vo, 'public.admin_set_founding_gate(false)'), 'ERR: Only a super admin can switch') || ' / ' || pg_temp.adm(v_sa, 'public.admin_set_founding_gate(false)->>''gate_on''') || ' / ' || pg_temp.pfx(pg_temp.adm(v_sa, 'public.admin_set_founding_gate(null)'), 'ERR: Choose on or off'),
    'ERR: Only a super admin can switch / false / ERR: Choose on or off');
  r := r || pg_temp.chk('K11', 'after it is off, everybody is open again', pg_temp.gate_of(v_w) || ' ' || public.founding_gate_on()::text, 'open false');

  -- ---- P: the delete dates ---------------------------------------------------------------------------------------------------------------------
  insert into founding_tutors_list (source, full_name, code_name, whatsapp, email, email_key, status, delete_after, consent_version) values
    ('form', 'Old One', 'Old', '+27820000010', 'old1@example.invalid', 'old1@example.invalid', 'joined', now() - interval '1 day', 'test'),
    ('form', 'Old Account', 'Old', '+27820000011', 'ft.nl.' || v_nl || '@example.invalid', 'ft.nl.' || v_nl || '@example.invalid', 'released', now() - interval '1 day', 'test'),
    ('admin', 'Old Verified', 'Old', '+27820000012', 'old3@example.invalid', 'old3@example.invalid', 'verified', now() - interval '1 day', 'test'),
    ('form', 'Not Yet', 'New', '+27820000013', 'old4@example.invalid', 'old4@example.invalid', 'joined', now() + interval '1 day', 'test');
  insert into founding_page_events (created_at, visitor_id, event, src) values
    (now() - interval '100 days', gen_random_uuid(), 'open', 'zzold'), (now() - interval '100 days', gen_random_uuid(), 'open', 'zzold'), (now() - interval '95 days', gen_random_uuid(), 'open', 'zzold'),
    (now() - interval '2 days', gen_random_uuid(), 'open', 'zzold');
  r := r || pg_temp.chk('D1', 'DELETE DATES: the purge job cannot be called by a signed-in person', pg_temp.deny(pg_temp.run_as(v_sa, 'select public.purge_expired_founding_entries()::text')), 'ERR: permission denied for');
  t := (public.purge_expired_founding_entries())::text;
  r := r || pg_temp.chk('D2', 'it ran and reported counts (at least 1 entry and 3 counts deleted)',
    ((t::jsonb ->> 'entries_deleted')::int >= 1 and (t::jsonb ->> 'events_deleted')::int >= 3)::text, 'true');
  select (select count(*) from founding_tutors_list where email_key = 'old1@example.invalid')::text || (select count(*) from founding_tutors_list where email_key = 'ft.nl.' || v_nl || '@example.invalid')::text
      || (select count(*) from founding_tutors_list where email_key = 'old3@example.invalid')::text || (select count(*) from founding_tutors_list where email_key = 'old4@example.invalid')::text into t2;
  r := r || pg_temp.chk('D3', 'only the expired entry with no account and no tutor status went (1 gone, then: expired but has an account kept, expired but verified kept, not yet due kept)', t2, '0111');
  select count(*)::text into t from founding_page_events where src = 'zzold';
  r := r || pg_temp.chk('D4', 'counts older than 90 days went; the 2-day-old one stayed', t, '1');

-- ---- L: lapse, delete, and the account link ------------------------------------------------------------------------------------------------------
  insert into founding_tutors_list (source, full_name, code_name, whatsapp, email, email_key, status, released_at, released_messaged_at, delete_after, consent_version) values
    ('form', 'Lapse One', 'L1', '+27820000021', 'lapse1@example.invalid', 'lapse1@example.invalid', 'released', now() - interval '16 days', now() - interval '15 days', now() + interval '14 days', 'test'),
    ('form', 'Lapse Two', 'L2', '+27820000022', 'lapse2@example.invalid', 'lapse2@example.invalid', 'released', now() - interval '6 days', now() - interval '5 days', now() + interval '24 days', 'test'),
    ('form', 'Lapse Three', 'L3', '+27820000023', 'lapse3@example.invalid', 'lapse3@example.invalid', 'released', now() - interval '20 days', null, now() + interval '10 days', 'test');
  update founding_tutors_list set released_messaged_at = now() - interval '20 days', status = 'released' where email_key = 'ft.nl.' || v_nl || '@example.invalid';
  t2 := (public.lapse_founding_releases())::text;
  select string_agg(f.email_key || '=' || f.status || '/' || (f.lapsed_at is not null)::text, ' ' order by f.email_key) into t from founding_tutors_list f
    where f.email_key in ('lapse1@example.invalid', 'lapse2@example.invalid', 'lapse3@example.invalid', 'ft.nl.' || v_nl || '@example.invalid');
  r := r || pg_temp.chk('L1', 'LAPSE: 15 days after the message with no account, a released person goes back to joined and is marked lapsed; 5 days, a release never messaged, and a person who HAS an account are left alone',
    replace(t, v_nl::text, 'NL'), 'ft.nl.NL@example.invalid=released/false lapse1@example.invalid=joined/true lapse2@example.invalid=released/false lapse3@example.invalid=released/false');
  r := r || pg_temp.chk('L2', 'the lapse job reports how many it moved (at least 1) and cannot be called by a signed-in person', ((t2::int) >= 0)::text || '|' || pg_temp.deny(pg_temp.run_as(v_sa, 'select public.lapse_founding_releases()::text')), 'true|ERR: permission denied for');
  select id into v_id3 from founding_tutors_list where email_key = 'lapse1@example.invalid';
  t := pg_temp.adm(v_vo, 'public.admin_founding_entries()');
  select (j ->> 'effective_status') || '|' || (j ->> 'status') || '|' || ((j ->> 'lapsed_at') is not null)::text into t2 from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else t::jsonb end) j where j ->> 'id' = v_id3::text;
  r := r || pg_temp.chk('L3', 'the admin sees a lapsed person as "lapsed" (stored status joined, lapsed_at set)', coalesce(t2, '-'), 'lapsed|joined|true');
  t := pg_temp.adm(v_vo, format('public.admin_release_founding(array[%L]::uuid[])->>''released''', v_id3));
  select (f.status || '/' || (f.lapsed_at is null)::text || '/' || (f.released_messaged_at is null)::text || '/' || (f.delete_after > now() + interval '29 days 23 hours')::text) into t2 from founding_tutors_list f where f.id = v_id3;
  r := r || pg_temp.chk('L4', '"Release again" clears the lapse and the old messaged mark, and starts a new 30-day delete date', t || '|' || t2, '1|released/true/true/true');
  t2 := (public.founding_daily_job())::text;
  r := r || pg_temp.chk('L5', 'the daily job does both (lapse, then delete what is past its date) and reports the counts', ((t2::jsonb ? 'lapsed') and (t2::jsonb ? 'entries_deleted') and (t2::jsonb ? 'events_deleted'))::text || '|' || pg_temp.deny(pg_temp.run_as(v_sa, 'select public.founding_daily_job()::text')), 'true|ERR: permission denied for');
  -- Remove and delete
  select id into v_id2 from founding_tutors_list where email_key = 'lapse2@example.invalid';
  r := r || pg_temp.chk('DEL1', 'REMOVE AND DELETE: a person who joined is really deleted; the same call again, an unknown id, a support agent, and an existing tutor''s account line are refused in plain words',
    pg_temp.adm(v_vo, format('public.admin_delete_founding_entry(%L)->>''ok''', v_id2)) || ' / ' || pg_temp.pfx(pg_temp.adm(v_vo, format('public.admin_delete_founding_entry(%L)', v_id2)), 'ERR: No such entry')
    || ' / ' || pg_temp.pfx(pg_temp.adm(v_su, format('public.admin_delete_founding_entry(%L)', v_id3)), 'ERR: Only a verification officer')
    || ' / ' || pg_temp.pfx(pg_temp.adm(v_sa, format('public.admin_delete_founding_entry(%L)', (select f.id from founding_tutors_list f where f.user_id = v_vl))), 'ERR: This line is an existing tutor account'),
    'true / ERR: No such entry / ERR: Only a verification officer / ERR: This line is an existing tutor account');
  select count(*)::text into t from founding_tutors_list where id = v_id2 or email_key = 'lapse2@example.invalid';
  r := r || pg_temp.chk('DEL2', 'the deleted row is gone, nothing of it is left (by id or by email), and the person can join again with the same email', t || '|' || pg_temp.join_as(null, pg_temp.pl('{"email": "lapse2@example.invalid"}')), '0|{"ok": true}');
  -- the account link at sign-up
  insert into founding_tutors_list (source, full_name, code_name, whatsapp, email, email_key, status, consent_version, delete_after) values
    ('form', 'Link Me', 'Linkie', '+27820000031', 'link.' || v_lk || '@example.invalid', 'link.' || v_lk || '@example.invalid', 'released', 'test', now() + interval '20 days');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_lk, z, 'authenticated', 'authenticated', 'link.' || v_lk || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Link', 'surname', 'Me', 'date_of_birth', adult), '{}'),
    (v_lk2, z, 'authenticated', 'authenticated', 'nolist.' || v_lk2 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'No', 'surname', 'List', 'date_of_birth', adult), '{}');
  select (f.user_id = v_lk)::text into t from founding_tutors_list f where f.email_key = 'link.' || v_lk || '@example.invalid';
  r := r || pg_temp.chk('LINK1', 'THE ACCOUNT LINK: when the tutor profile is made, the list entry with the sign-up email gets user_id (the code system reads it by account)', t, 'true');
  select count(*)::text into t from tutor_profiles where id in (v_lk, v_lk2);
  r := r || pg_temp.chk('LINK2', 'sign-up is never disturbed: both accounts exist with a tutor profile, the one with no entry too, and an account with no entry links nothing', t || '|' || (select count(*)::text from founding_tutors_list where user_id = v_lk2), '2|0');
  r := r || pg_temp.chk('LINK3', 'the trigger exists on tutor_profiles and no API role can call its function', (select string_agg(tg.tgname || '@' || c.relname, '') from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where not tg.tgisinternal and tg.tgname = 'founding_link_on_tutor_profile')
    || '|' || has_function_privilege('authenticated', 'public.founding_link_on_tutor_profile()', 'execute')::text, 'founding_link_on_tutor_profile@tutor_profiles|false');

-- ---- PG / RM / RD / CP / FS: the PM's additions of 11 Nov (after Programmer C's report) -------------------------------------------------------------------
  declare
    v_pg1 uuid := gen_random_uuid(); v_pg2 uuid := gen_random_uuid(); v_pg3 uuid := gen_random_uuid(); v_pg4 uuid := gen_random_uuid(); v_pg5 uuid := gen_random_uuid(); v_pg6 uuid := gen_random_uuid(); v_pg7 uuid := gen_random_uuid();
    v_cp uuid := gen_random_uuid(); v_cp2 uuid := gen_random_uuid(); v_em text; v_stamp timestamptz; v_listid uuid;
  begin
    -- THREE PATHS to a tutor profile, with the switch ON and the rule applied to the owner too (founding.test_enforce)
    update system_settings set setting_value = '{"on": true}'::jsonb where setting_key = 'founding_tutors_gate';
    perform set_config('founding.test_enforce', 'on', true);
    -- (1) the sign-up trigger: a tutor not on the list is refused
    begin
      insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
        values (v_pg1, z, 'authenticated', 'authenticated', 'pg1.' || v_pg1 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Pia', 'surname', 'Notlisted', 'date_of_birth', adult), '{}');
      t := 'created';
    exception when others then
      t := 'ERR: ' || sqlerrm;
    end;
    r := r || pg_temp.chk('PG1', 'SIGN-UP PATH: with the switch on, a tutor sign-up with an email that is not on the list is refused in plain words and no account is left',
      pg_temp.pfx(t, 'ERR: Tutoring places open in groups.') || '|' || (select count(*)::text from auth.users where id = v_pg1), 'ERR: Tutoring places open in groups.|0');
    -- on the list but only waiting: refused; released: allowed
    insert into founding_tutors_list (source, full_name, code_name, whatsapp, email, email_key, status, consent_version, delete_after) values
      ('form', 'Pat Waiting', 'Pat', '+27820000041', 'pg2.' || v_pg2 || '@example.invalid', 'pg2.' || v_pg2 || '@example.invalid', 'joined', 'test', now() + interval '6 months'),
      ('form', 'Pru Released', 'Pru', '+27820000042', 'pg3.' || v_pg3 || '@example.invalid', 'pg3.' || v_pg3 || '@example.invalid', 'released', 'test', now() + interval '20 days');
    begin
      insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
        values (v_pg2, z, 'authenticated', 'authenticated', 'pg2.' || v_pg2 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Pat', 'surname', 'Waiting', 'date_of_birth', adult), '{}');
      t := 'created';
    exception when others then
      t := 'ERR: ' || sqlerrm;
    end;
    begin
      insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
        values (v_pg3, z, 'authenticated', 'authenticated', 'pg3.' || v_pg3 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Pru', 'surname', 'Released', 'date_of_birth', adult), '{}');
      t2 := 'created';
    exception when others then
      t2 := 'ERR: ' || sqlerrm;
    end;
    r := r || pg_temp.chk('PG2', 'SIGN-UP PATH: on the list but only waiting is refused; on the list and released gets the account and its tutor profile',
      pg_temp.pfx(t, 'ERR: Tutoring places open in groups.') || '|' || t2 || '|' || (select count(*)::text from tutor_profiles where id = v_pg3), 'ERR: Tutoring places open in groups.|created|1');
    -- (2) the Google path: a learner account switched to tutor
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
      values (v_pg4, z, 'authenticated', 'authenticated', 'pg4.' || v_pg4 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Gia', 'surname', 'Google', 'date_of_birth', adult), '{}');
    r := r || pg_temp.chk('PG3', 'GOOGLE PATH: convert_new_account_role(''tutor'') for a learner who is not on the list is refused in plain words and the account stays a learner',
      pg_temp.pfx(pg_temp.run_as(v_pg4, 'select public.convert_new_account_role(''tutor'')::text'), 'ERR: Tutoring places open in groups.') || '|' || (select p.role::text from profiles p where p.id = v_pg4) || '|' || (select count(*)::text from tutor_profiles where id = v_pg4),
      'ERR: Tutoring places open in groups.|student|0');
    -- (3) the direct write: a signed-in learner inserts their own tutor profile
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
      values (v_pg5, z, 'authenticated', 'authenticated', 'pg5.' || v_pg5 || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Dee', 'surname', 'Direct', 'date_of_birth', adult), '{}');
    r := r || pg_temp.chk('PG4', 'DIRECT WRITE: a signed-in person inserting their own tutor_profiles row (the "Tutors insert own profile" policy) is refused when not on the list',
      pg_temp.pfx(pg_temp.do_as(v_pg5, format('insert into public.tutor_profiles (id, headline) values (%L, ''x'')', v_pg5)), 'ERR: Tutoring places open in groups.') || '|' || (select count(*)::text from tutor_profiles where id = v_pg5), 'ERR: Tutoring places open in groups.|0');
    -- the owner is exempt without the test hook; and with the switch OFF everything is as before
    perform set_config('founding.test_enforce', 'off', true);
    begin
      insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
        values (v_pg6, z, 'authenticated', 'authenticated', 'pg6.' || v_pg6 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Olly', 'surname', 'Owner', 'date_of_birth', adult), '{}');
      t := 'created';
    exception when others then
      t := 'ERR: ' || sqlerrm;
    end;
    update system_settings set setting_value = '{"on": false}'::jsonb where setting_key = 'founding_tutors_gate';
    perform set_config('founding.test_enforce', 'on', true);
    begin
      insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
        values (v_pg7, z, 'authenticated', 'authenticated', 'pg7.' || v_pg7 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Off', 'surname', 'Switch', 'date_of_birth', adult), '{}');
      t2 := 'created';
    exception when others then
      t2 := 'ERR: ' || sqlerrm;
    end;
    perform set_config('founding.test_enforce', 'off', true);
    r := r || pg_temp.chk('PG5', 'the owner running SQL is not held (switch on, no hook), and with the switch OFF a tutor sign-up is allowed even with the rule applied (nothing changes until the CEO says on)', t || '|' || t2, 'created|created');
    r := r || pg_temp.chk('PG6', 'the trigger exists on tutor_profiles and no API role can call its function',
      (select string_agg(tg.tgname || '@' || c.relname, '') from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where not tg.tgisinternal and tg.tgname = 'founding_gate_profile_guard') || '|' || has_function_privilege('authenticated', 'public.founding_gate_profile_guard()', 'execute')::text,
      'founding_gate_profile_guard@tutor_profiles|false');

    -- VIDEO ROOMS: with the switch on only a verified tutor opens a room
    update system_settings set setting_value = '{"on": true}'::jsonb where setting_key = 'founding_tutors_gate';
    begin
      insert into video_rooms (code, host_id, max_participants, relay_only, expires_at) values ('RMTESTAB', v_r, 4, false, now() + interval '4 hours');
      t := 'created';
    exception when others then
      t := 'ERR: ' || sqlerrm;
    end;
    begin
      insert into video_rooms (code, host_id, max_participants, relay_only, expires_at) values ('RMTESTAC', v_v, 4, false, now() + interval '4 hours');
      t2 := 'created';
    exception when others then
      t2 := 'ERR: ' || sqlerrm;
    end;
    r := r || pg_temp.chk('RM1', 'VIDEO ROOMS: with the switch on, a released (not yet verified) tutor cannot open a room and a verified tutor can', pg_temp.pfx(t, 'ERR: You can open video rooms once you are verified.') || '|' || t2, 'ERR: You can open video rooms once you are verified.|created');
    update system_settings set setting_value = '{"on": false}'::jsonb where setting_key = 'founding_tutors_gate';
    begin
      insert into video_rooms (code, host_id, max_participants, relay_only, expires_at) values ('RMTESTAD', v_r, 4, false, now() + interval '4 hours');
      t := 'created';
    exception when others then
      t := 'ERR: ' || sqlerrm;
    end;
    r := r || pg_temp.chk('RM2', 'with the switch OFF the same tutor opens a room exactly as before', t, 'created');

    -- READINESS for the "Verified: message ready" button (v_v is verified; its competency was set back to pending in C4)
    select f.id into v_listid from founding_tutors_list f where f.user_id = v_v;
    t := pg_temp.adm(v_vo, 'public.admin_founding_entries()');
    select (j ->> 'ready') || '|' || (j -> 'missing')::text into t2 from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else t::jsonb end) j where j ->> 'id' = v_listid::text;
    r := r || pg_temp.chk('RD1', 'READINESS: a verified tutor with no approved subject and no police clearance is NOT ready and the list says what is missing', coalesce(t2, left(t, 120)), 'false|["no approved subject", "no police clearance on file"]');
    update tutor_subject_competencies set verification_status = 'verified' where tutor_id = v_v and subject_name = 'Zz Test Subject';
    insert into tutor_verification_documents (tutor_id, document_type, document_url, issued_on) values (v_v, 'police_clearance', v_v || '/police-now.pdf', (now() at time zone 'Africa/Johannesburg')::date);
    t := pg_temp.adm(v_vo, 'public.admin_founding_entries()');
    select (j ->> 'ready') || '|' || (j -> 'missing')::text into t2 from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else t::jsonb end) j where j ->> 'id' = v_listid::text;
    r := r || pg_temp.chk('RD2', 'with an approved subject, hours saved and a current police clearance the same tutor is ready', coalesce(t2, left(t, 120)), 'true|[]');
    delete from tutor_availability where tutor_id = v_v;
    t := pg_temp.adm(v_vo, 'public.admin_founding_entries()');
    select (j ->> 'ready') || '|' || (j -> 'missing')::text into t2 from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else t::jsonb end) j where j ->> 'id' = v_listid::text;
    r := r || pg_temp.chk('RD3', 'take the hours away and they are not ready again: "no working hours saved"', coalesce(t2, left(t, 120)), 'false|["no working hours saved"]');
    select (j ->> 'ready') || '|' || (j -> 'missing')::text into t2 from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else t::jsonb end) j where j ->> 'id' = (select f.id from founding_tutors_list f where f.email_key = 'ft.w.' || v_w || '@example.invalid')::text;
    r := r || pg_temp.chk('RD4', 'a person whose tutor account is not verified is not ready ("not verified yet" first); a person with no account at all says "no tutor account yet"', coalesce(t2, '-') || '|' || (select (j -> 'missing')::text from jsonb_array_elements(case when t like 'ERR:%' then '[]'::jsonb else t::jsonb end) j where j ->> 'id' = v_id1::text), 'false|["not verified yet", "no approved subject", "no working hours saved", "no police clearance on file"]|["no tutor account yet"]');

    -- COMPLETED_AT: stamped the first time the "finished" rule is met, never moved
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_cp, z, 'authenticated', 'authenticated', 'cp1.' || v_cp || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Cee', 'surname', 'Pee', 'date_of_birth', adult), '{}'),
      (v_cp2, z, 'authenticated', 'authenticated', 'cp2.' || v_cp2 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Cee', 'surname', 'Two', 'date_of_birth', adult), '{}');
    insert into tutor_onboarding (tutor_id, track, consented_at, consent_version) values (v_cp, 'beginner', now(), 'test'), (v_cp2, 'experienced', now(), 'test');
    insert into tutor_verification_documents (tutor_id, document_type, document_url) values (v_cp, 'identity_doc', v_cp || '/id.pdf');
    insert into tutor_verification_documents (tutor_id, document_type, document_url, issued_on) values (v_cp, 'police_clearance', v_cp || '/pc.pdf', (now() at time zone 'Africa/Johannesburg')::date - 10);
    select (completed_at is null)::text into t from tutor_onboarding where tutor_id = v_cp;
    insert into tutor_verification_documents (tutor_id, document_type, document_url) values (v_cp, 'subject_results', v_cp || '/results.pdf');
    select (completed_at is not null)::text into t2 from tutor_onboarding where tutor_id = v_cp;
    r := r || pg_temp.chk('CP1', 'COMPLETED_AT (beginner): not stamped with identity and police clearance only; stamped the moment school results are in', t || '|' || t2, 'true|true');
    update tutor_onboarding set completed_at = now() - interval '3 days' where tutor_id = v_cp;
    select completed_at into v_stamp from tutor_onboarding where tutor_id = v_cp;
    insert into tutor_verification_documents (tutor_id, document_type, document_url) values (v_cp, 'sace_certificate', v_cp || '/sace.pdf');
    r := r || pg_temp.chk('CP2', 'it is stamped the FIRST time only: another document later does not move it', ((select completed_at from tutor_onboarding where tutor_id = v_cp) = v_stamp)::text, 'true');
    insert into tutor_verification_documents (tutor_id, document_type, document_url) values (v_cp2, 'identity_doc', v_cp2 || '/id.pdf');
    insert into tutor_verification_documents (tutor_id, document_type, document_url) values (v_cp2, 'proof_of_experience', v_cp2 || '/exp.pdf');
    insert into tutor_verification_documents (tutor_id, document_type, document_url, issued_on) values (v_cp2, 'police_clearance', v_cp2 || '/old.pdf', (now() at time zone 'Africa/Johannesburg')::date - 240);
    select (completed_at is null)::text into t from tutor_onboarding where tutor_id = v_cp2;
    insert into tutor_verification_documents (tutor_id, document_type, document_url, issued_on) values (v_cp2, 'police_clearance', v_cp2 || '/new.pdf', (now() at time zone 'Africa/Johannesburg')::date - 30);
    select (completed_at is not null)::text into t2 from tutor_onboarding where tutor_id = v_cp2;
    r := r || pg_temp.chk('CP3', 'COMPLETED_AT (experienced): a police clearance older than 6 months does not count (not stamped); a current one does (stamped)', t || '|' || t2, 'true|true');
    r := r || pg_temp.chk('CP4', 'a person cannot write completed_at (tutors can read their own onboarding row, nothing more) and the helper functions are closed',
      pg_temp.deny(pg_temp.do_as(v_cp, format('update public.tutor_onboarding set completed_at = null where tutor_id = %L', v_cp))) || '|' || has_function_privilege('authenticated', 'public.tutor_onboarding_finished(uuid)', 'execute')::text || '|' || has_function_privilege('authenticated', 'public.tutor_onboarding_stamp_completed()', 'execute')::text,
      'ERR: permission denied for|false|false');

    -- FIRST_REQUEST_SEEN_AT: set once by the tutor's own call, never written directly
    t := pg_temp.do_as(v_w, 'select public.note_first_request_seen()');
    select (first_request_seen_at is not null)::text into t2 from tutor_profiles where id = v_w;
    r := r || pg_temp.chk('FS1', 'FIRST REQUEST SEEN: the tutor''s own call sets it', t || '|' || t2, 'done|true');
    update tutor_profiles set first_request_seen_at = now() - interval '5 days' where id = v_w;
    select first_request_seen_at into v_stamp from tutor_profiles where id = v_w;
    perform pg_temp.do_as(v_w, 'select public.note_first_request_seen()');
    r := r || pg_temp.chk('FS2', 'it is set ONCE: a second call changes nothing', ((select first_request_seen_at from tutor_profiles where id = v_w) = v_stamp)::text, 'true');
    perform pg_temp.do_as(v_w, format('update public.tutor_profiles set first_request_seen_at = now() where id = %L', v_w));
    r := r || pg_temp.chk('FS3', 'a tutor cannot write it directly (the change is quietly undone)', ((select first_request_seen_at from tutor_profiles where id = v_w) = v_stamp)::text, 'true');
    r := r || pg_temp.chk('FS4', 'a learner''s call makes no row and no error; signed-out callers cannot call it; an API role has no right to read the column through the table',
      pg_temp.do_as(v_ld, 'select public.note_first_request_seen()') || '|' || pg_temp.deny(pg_temp.do_as(null, 'select public.note_first_request_seen()')) || '|' || has_column_privilege('authenticated', 'public.tutor_profiles', 'first_request_seen_at', 'select')::text,
      'done|ERR: permission denied for|false');

    -- PUB / WT / LK: the PM's second round (11 Nov)
    r := r || pg_temp.chk('PUB1', 'THE PUBLIC SWITCH READER: a signed-out visitor can ask whether the gate is on (false while off) and nothing else about it',
      pg_temp.run_as(null, 'select public.founding_gate_public()::text') || '|' || has_function_privilege('anon', 'public.founding_gate_public()', 'execute')::text, 'false|true');
    update system_settings set setting_value = '{"on": true}'::jsonb where setting_key = 'founding_tutors_gate';
    t := pg_temp.run_as(null, 'select public.founding_gate_public()::text');
    update system_settings set setting_value = '{"on": false}'::jsonb where setting_key = 'founding_tutors_gate';
    r := r || pg_temp.chk('PUB2', 'and it follows the switch when it is on', t, 'true');
    insert into founding_tutors_list (source, full_name, code_name, whatsapp, email, email_key, status, consent_version, delete_after) values
      ('form', 'Wait Update', 'Wu', '+27820000051', 'wu@example.invalid', 'wu@example.invalid', 'joined', 'test', now() + interval '6 months'),
      ('form', 'Link Target', 'Lt', '+27820000052', 'lt.other@example.invalid', 'lt.other@example.invalid', 'joined', 'test', now() + interval '6 months'),
      ('form', 'Link Target Two', 'Lt2', '+27820000053', 'lt2.other@example.invalid', 'lt2.other@example.invalid', 'joined', 'test', now() + interval '6 months');
    select id into v_listid from founding_tutors_list where email_key = 'wu@example.invalid';
    t := pg_temp.adm(v_vo, format('public.admin_mark_founding_messaged(%L, ''waiting'')->>''ok''', v_listid));
    select ((waiting_messaged_at is not null) and released_messaged_at is null and verified_messaged_at is null)::text into t2 from founding_tutors_list where id = v_listid;
    r := r || pg_temp.chk('WT1', 'STILL WAITING: "mark as messaged" with kind waiting stamps waiting_messaged_at and touches nothing else; a wrong kind is refused in plain words',
      t || '|' || t2
      || '|' || pg_temp.pfx(pg_temp.adm(v_vo, format('public.admin_mark_founding_messaged(%L, ''lunch'')', v_listid)), 'ERR: Choose released, verified or waiting'),
      'true|true|ERR: Choose released, verified or waiting');
    select id into v_listid from founding_tutors_list where email_key = 'lt.other@example.invalid';
    t := pg_temp.adm(v_vo, format('public.admin_link_founding_entry(%L, %L)->>''ok''', v_listid, 'nolist.' || v_lk2 || '@example.invalid'));
    select (f.user_id = v_lk2)::text into t2 from founding_tutors_list f where f.id = v_listid;
    r := r || pg_temp.chk('LK1', 'LINK THIS ACCOUNT: an officer links an entry to the tutor account that signed up with another email; the entry then belongs to that account (here still waiting)',
      t || '|' || coalesce(t2, 'null') || '|' || public.founding_gate_state_raw(v_lk2), 'true|true|waiting');
    select id into v_listid from founding_tutors_list where email_key = 'lt2.other@example.invalid';
    r := r || pg_temp.chk('LK2', 'refusals in plain words: an email with no account; an account that is not a tutor; an account already linked to another entry; a support agent; an existing tutor''s line',
      pg_temp.pfx(pg_temp.adm(v_vo, format('public.admin_link_founding_entry(%L, %L)', v_listid, 'nobody.here@example.invalid')), 'ERR: There is no account with that email yet')
      || ' / ' || pg_temp.pfx(pg_temp.adm(v_vo, format('public.admin_link_founding_entry(%L, %L)', v_listid, 'ft.ld.' || v_ld || '@example.invalid')), 'ERR: That account is not a tutor account')
      || ' / ' || pg_temp.pfx(pg_temp.adm(v_vo, format('public.admin_link_founding_entry(%L, %L)', v_listid, 'nolist.' || v_lk2 || '@example.invalid')), 'ERR: That account is already linked to another entry')
      || ' / ' || pg_temp.pfx(pg_temp.adm(v_su, format('public.admin_link_founding_entry(%L, %L)', v_listid, 'x@y.z')), 'ERR: Only a verification officer')
      || ' / ' || pg_temp.pfx(pg_temp.adm(v_vo, format('public.admin_link_founding_entry(%L, %L)', (select f.id from founding_tutors_list f where f.user_id = v_vl), 'nolist.' || v_lk2 || '@example.invalid')), 'ERR: That entry cannot be linked'),
      'ERR: There is no account with that email yet / ERR: That account is not a tutor account / ERR: That account is already linked to another entry / ERR: Only a verification officer / ERR: That entry cannot be linked');
  end;

  exception when others then
    r := r || 'UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n';
  end;
  -- The answer is short on purpose: the Supabase tool cuts the middle of a long error. Every FAIL line is printed in full; the lines that passed are
  -- listed by their ids only (each id is the first word of its line in this file).
  select count(*) filter (where l like '%FAIL%'), count(*) filter (where l like '% ok'), count(*) into nfail, nok, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  select coalesce(string_agg(l, E'\n') filter (where l like '%FAIL%'), '(none)') into t from unnest(string_to_array(r, E'\n')) l;
  select string_agg(split_part(l, ' ', 1), ' ') filter (where l like '% ok') into t2 from unnest(string_to_array(r, E'\n')) l;
  raise exception E'FOUNDING TUTORS LIST TEST (rolled back): % OK, % FAIL, % lines in all\nFAIL LINES: %\nOK: %', nok, nfail, nlines, t, t2;
end $$;
