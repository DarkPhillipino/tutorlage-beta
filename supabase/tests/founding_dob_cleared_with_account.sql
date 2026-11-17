-- Rolled-back test of migration 20261117210000_founding_dob_cleared_with_account.sql (PM item 6: the list row's date of birth is cleared once the account holds it; 17 Nov 2026).
-- Run it with the migration TWICE in one rolled-back statement (the second run proves the patch is a no-op the second time):
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/founding_dob_cleared_with_account.sql supabase/migrations/20261117210000_founding_dob_cleared_with_account.sql supabase/migrations/20261117210000_founding_dob_cleared_with_account.sql
-- or, once applied, on its own. Made-up people (example.invalid), built inside the run, nothing real read or changed.
do $$
declare
  r text := '';
  uid text := replace(gen_random_uuid()::text, '-', '');
  tg text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  adult text := ((now() at time zone 'Africa/Johannesburg')::date - interval '30 years')::date::text;
  v_t1 uuid := gen_random_uuid(); v_t2 uuid := gen_random_uuid(); v_t3 uuid := gen_random_uuid();
  v_ra uuid; v_rb uuid; v_rc uuid; v_rd uuid;
  t text; t2 text; nfail int; nok int; nlines int; v_def text;
begin
  begin
  execute $mk$
    create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
      select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
             || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
    $f$ $mk$;
  execute $mk$
    create function pg_temp.mkuser(p_id uuid, p_email text, p_meta jsonb) returns void language sql as $f$
      insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
      values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, p_meta, '{}')
    $f$ $mk$;
  -- four made-up list rows, each with a date of birth (the new join path): a = account made WITH a date of birth, b = account made WITHOUT one, c = no account at all, d = another person's row
  perform set_config('test.base', jsonb_build_object('website', '', 'elapsed_ms', 9000, 'first_name', 'Zz', 'surname', 'Dobtest', 'code_name', '', 'whatsapp', '082 000 0030',
    'date_of_birth', adult, 'subjects', jsonb_build_array(jsonb_build_object('subject', 'Mathematics', 'min_grade', 'Grade 8', 'max_grade', 'Grade 12')),
    'availability', jsonb_build_array('evenings'), 'practicum', 'two', 'police_clearance', 'applied', 'parent_reach', '10_to_30', 'parent_reach_willing', false,
    'has_device', true, 'has_connection', true, 'has_bank', false, 'consent_contact', true, 'consent_marketing', false, 'src', 'zzdob-' || tg, 'visitor', gen_random_uuid(), 'consent_version', '2026-11-17')::text, true);
  perform public.join_founding_list(current_setting('test.base')::jsonb || jsonb_build_object('email', 'dob.a.' || uid || '@example.invalid', 'src', 'zzdob-a-' || tg));
  perform public.join_founding_list(current_setting('test.base')::jsonb || jsonb_build_object('email', 'dob.b.' || uid || '@example.invalid', 'src', 'zzdob-b-' || tg));
  perform public.join_founding_list(current_setting('test.base')::jsonb || jsonb_build_object('email', 'dob.c.' || uid || '@example.invalid', 'src', 'zzdob-c-' || tg));
  perform public.join_founding_list(current_setting('test.base')::jsonb || jsonb_build_object('email', 'dob.d.' || uid || '@example.invalid', 'src', 'zzdob-d-' || tg));
  select f.id into v_ra from founding_tutors_list f where f.email_key = 'dob.a.' || uid || '@example.invalid';
  select f.id into v_rb from founding_tutors_list f where f.email_key = 'dob.b.' || uid || '@example.invalid';
  select f.id into v_rc from founding_tutors_list f where f.email_key = 'dob.c.' || uid || '@example.invalid';
  select f.id into v_rd from founding_tutors_list f where f.email_key = 'dob.d.' || uid || '@example.invalid';
  r := r || pg_temp.chk('D0', 'setup: four list rows, each holds the date of birth, none has an account',
    (select count(*)::text from founding_tutors_list f where f.id in (v_ra, v_rb, v_rc, v_rd) and f.date_of_birth = adult::date and f.user_id is null), '4');
  select pg_get_functiondef('public.founding_link_on_tutor_profile()'::regprocedure) into v_def;
  r := r || pg_temp.chk('D1', 'the link trigger holds the clearing exactly once (also after a second run of the migration) and is still security definer with the search path pinned',
    ((length(v_def) - length(replace(v_def, 'DOB CLEARED WITH THE ACCOUNT', ''))) / length('DOB CLEARED WITH THE ACCOUNT'))::text || ' / '
    || (select (p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))::text from pg_proc p where p.oid = 'public.founding_link_on_tutor_profile()'::regprocedure), '1 / true');
  -- a: the account is made the way the sign-up makes it, WITH the date of birth
  perform pg_temp.mkuser(v_t1, 'dob.a.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zz', 'surname', 'Dobtest', 'date_of_birth', adult));
  r := r || pg_temp.chk('D2', 'an account made WITH its date of birth: the row is linked, its date of birth is cleared, everything else stays (name, number, email, subjects)',
    (select concat_ws('|', (f.user_id = v_t1)::text, coalesce(f.date_of_birth::text, 'null'), f.first_name, f.surname, jsonb_array_length(f.subjects)::text) from founding_tutors_list f where f.id = v_ra),
    'true|null|Zz|Dobtest|1');
  r := r || pg_temp.chk('D3', 'and the account itself holds the date of birth', (select p.date_of_birth::text from profiles p where p.id = v_t1), adult);
  -- b: the account is made WITHOUT a date of birth (a seeded or Google sign-up): the row's copy is kept until the account has one
  perform pg_temp.mkuser(v_t2, 'dob.b.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zz'));
  r := r || pg_temp.chk('D4', 'an account made WITHOUT a date of birth: the row is linked but keeps its date of birth (the only copy)',
    (select concat_ws('|', (f.user_id = v_t2)::text, coalesce(f.date_of_birth::text, 'null')) from founding_tutors_list f where f.id = v_rb) || ' / ' || coalesce((select p.date_of_birth::text from profiles p where p.id = v_t2), 'null'), 'true|' || adult || ' / null');
  update profiles set date_of_birth = adult::date where id = v_t2;
  r := r || pg_temp.chk('D5', 'when that account later gets its date of birth (the "One more step" screen), the row''s copy is cleared then',
    (select coalesce(f.date_of_birth::text, 'null') from founding_tutors_list f where f.id = v_rb), 'null');
  r := r || pg_temp.chk('D6', 'a row with no account keeps its date of birth (the prefill needs it), and another person''s row is untouched by the two accounts above',
    (select count(*)::text from founding_tutors_list f where f.id in (v_rc, v_rd) and f.date_of_birth = adult::date and f.user_id is null), '2');
  perform pg_temp.mkuser(v_t3, 'dob.other.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zz', 'surname', 'Other', 'date_of_birth', adult));
  update profiles set date_of_birth = (adult::date + 1) where id = v_t3;
  r := r || pg_temp.chk('D7', 'an account whose email is on no list row, and a profile update that changes its date of birth, change no list row',
    (select count(*)::text from founding_tutors_list f where f.id in (v_rc, v_rd) and f.date_of_birth = adult::date), '2');
  update profiles set full_name = 'Zz Dobtest' where id = v_t1;
  r := r || pg_temp.chk('D8', 'an ordinary profile update (a name change) still works and touches no list row',
    (select p.full_name from profiles p where p.id = v_t1) || ' / ' || (select count(*)::text from founding_tutors_list f where f.id = v_ra and f.date_of_birth is null), 'Zz Dobtest / 1');
  r := r || pg_temp.chk('D9', 'the clearing trigger function cannot be called from the API; the trigger exists once on profiles',
    has_function_privilege('anon', 'public.founding_clear_dob_on_profile()', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.founding_clear_dob_on_profile()', 'execute')::text || ' / '
    || (select count(*)::text from pg_trigger t where t.tgrelid = 'public.profiles'::regclass and t.tgname = 'founding_clear_dob_on_profile' and not t.tgisinternal), 'false/false / 1');
  exception when others then
    r := r || 'UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%'), count(*) filter (where l like '% ok'), count(*) into nfail, nok, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  select coalesce(string_agg(l, E'\n') filter (where l like '%FAIL%'), '(none)') into t from unnest(string_to_array(r, E'\n')) l;
  select string_agg(split_part(l, ' ', 1), ' ') filter (where l like '% ok') into t2 from unnest(string_to_array(r, E'\n')) l;
  raise exception E'FOUNDING DOB CLEARED TEST (rolled back): % OK, % FAIL, % lines in all\nFAIL LINES: %\nOK: %', nok, nfail, nlines, t, t2;
end $$;
