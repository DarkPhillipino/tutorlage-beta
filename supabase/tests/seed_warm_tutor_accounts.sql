-- Rolled-back test of migration 20261117140000_seed_warm_tutor_accounts.sql (seeding the warm tutors' accounts; 17 Nov 2026).
-- Run it with the migration in one rolled-back statement:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/seed_warm_tutor_accounts.sql supabase/migrations/20261117140000_seed_warm_tutor_accounts.sql
-- or, once applied, on its own. Fixtures are made-up people (example.invalid); no real list row is read or changed (every call names a made-up tag). The account is made the way
-- Supabase Auth makes one: a row in auth.users with the sign-up's metadata (first name, phone, role; NO surname, date of birth or acceptance), so the on_auth_user_created trigger runs.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  uid text := replace(gen_random_uuid()::text, '-', '');
  tg text := left(replace(gen_random_uuid()::text, '-', ''), 10);   -- a list tag is at most 32 characters
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  adult text := (v_today - interval '30 years')::date::text;
  v_vo uuid := gen_random_uuid();
  v_ld uuid := gen_random_uuid();
  v_tutor2 uuid := gen_random_uuid();
  v_acct uuid := gen_random_uuid();
  v_acct2 uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_subj1 text; v_subj2 text;
  v_row uuid; v_row2 uuid; v_row3 uuid;
  t text; t2 text; n int; nfail int; nok int; nlines int;
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
  -- run a statement as a role: 'anon', 'service', or a signed-in person's id; the text of the answer, or ERR:
  execute $mk$
    create function pg_temp.run_as(p_who text, p_sql text) returns text language plpgsql as $f$
    declare v text;
    begin
      if p_who = 'anon' then
        perform set_config('request.jwt.claims', '', true);
        set local role anon;
      elsif p_who = 'service' then
        perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
        set local role service_role;
      else
        perform set_config('request.jwt.claims', json_build_object('sub', p_who, 'role', 'authenticated')::text, true);
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
    create function pg_temp.mkuser(p_id uuid, p_email text, p_meta jsonb) returns void language sql as $f$
      insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
      values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, p_meta, '{}')
    $f$ $mk$;

  select s.name into v_subj1 from public.subjects s where s.name ilike 'mathematics%' order by s.name limit 1;
  select s.name into v_subj2 from public.subjects s where s.name ilike 'geography%' order by s.name limit 1;
  if v_subj1 is null then select s.name into v_subj1 from public.subjects s order by s.name limit 1; end if;
  if v_subj2 is null then select s.name into v_subj2 from public.subjects s where s.name <> v_subj1 order by s.name limit 1; end if;

  -- an officer (for the funnel read) and a learner (for the surname refusals)
  perform pg_temp.mkuser(v_vo, 'sw.vo.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Vic', 'surname', 'Officer', 'date_of_birth', adult));
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values (v_vo, 'Vic', 'Officer', 'sw.vo.' || uid || '@example.invalid', '', 'verification_officer', true);
  perform pg_temp.mkuser(v_ld, 'sw.ld.' || uid || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Lee', 'surname', 'Learner', 'date_of_birth', adult));
  -- a normal tutor who signed up the usual way (first name and surname)
  perform pg_temp.mkuser(v_tutor2, 'sw.t2.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tee', 'surname', 'Normal', 'date_of_birth', adult));

  -- three made-up list rows through the join function, joined the OLD way (one-word full name, no surname, no date of birth), like Odi and Amree
  perform set_config('test.base', jsonb_build_object('website', '', 'elapsed_ms', 9000, 'code_name', 'Zz', 'whatsapp', '082 000 0010', 'is_adult', true,
    'subjects', jsonb_build_array(jsonb_build_object('subject', v_subj1, 'min_grade', 'Grade 8', 'max_grade', 'Grade 12'), jsonb_build_object('subject', v_subj2, 'min_grade', 'Grade 8', 'max_grade', 'Grade 11'),
                                  jsonb_build_object('subject', v_subj2, 'min_grade', 'Grade 4', 'max_grade', 'Grade 6')),
    'availability', jsonb_build_array('evenings'), 'practicum', 'three_plus', 'police_clearance', 'not_yet', 'parent_reach', 'none', 'parent_reach_willing', false,
    'prior_tutoring', 'Some tutoring', 'consent_contact', true, 'src', 'zzseed-a-' || tg, 'visitor', gen_random_uuid()::text)::text, true);
  perform public.join_founding_list(current_setting('test.base')::jsonb || jsonb_build_object('full_name', 'Zzseed', 'email', 'sw.a.' || uid || '@example.invalid'));
  perform public.join_founding_list(current_setting('test.base')::jsonb || jsonb_build_object('full_name', 'Zzseedtwo', 'email', 'sw.b.' || uid || '@example.invalid', 'src', 'zzseed-b-' || tg));
  perform public.join_founding_list(current_setting('test.base')::jsonb || jsonb_build_object('full_name', 'Zzseedthree', 'email', 'sw.c.' || uid || '@example.invalid', 'src', 'zzseed-a-' || tg));
  select f.id into v_row from founding_tutors_list f where f.email_key = 'sw.a.' || uid || '@example.invalid';
  select f.id into v_row2 from founding_tutors_list f where f.email_key = 'sw.b.' || uid || '@example.invalid';
  select f.id into v_row3 from founding_tutors_list f where f.email_key = 'sw.c.' || uid || '@example.invalid';
  r := r || 'S0 setup: an officer, a learner, a normal tutor and three made-up list rows (two share one tag on purpose)' || E'\n';

  -- ---- S: who may call what -----------------------------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('S1', 'the two seeding functions are for the service key only (anon, signed-in: no; service: yes)',
    has_function_privilege('anon', 'public.founding_seed_row(text)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.founding_seed_row(text)', 'execute')::text || '/' || has_function_privilege('service_role', 'public.founding_seed_row(text)', 'execute')::text
    || '/' || has_function_privilege('anon', 'public.founding_seed_finish(uuid,uuid)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.founding_seed_finish(uuid,uuid)', 'execute')::text || '/' || has_function_privilege('service_role', 'public.founding_seed_finish(uuid,uuid)', 'execute')::text,
    'false/false/true/false/false/true');
  r := r || pg_temp.chk('S2', 'the surname functions are for signed-in people only',
    has_function_privilege('anon', 'public.my_needs_surname()', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.my_needs_surname()', 'execute')::text
    || '/' || has_function_privilege('anon', 'public.set_my_surname(text)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.set_my_surname(text)', 'execute')::text, 'false/true/false/true');
  select (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('founding_seed_row', 'founding_seed_finish', 'my_needs_surname', 'set_my_surname') and p.prosecdef
          and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))::text into t;
  r := r || pg_temp.chk('S3', 'all four are security definer with the search path pinned', t, '4');
  r := r || pg_temp.chk('S4', 'a signed-in person and a signed-out visitor cannot read a list row through the seeding function', pg_temp.pfx(pg_temp.run_as(v_ld::text, 'select public.founding_seed_row(''x'')::text'), 'ERR: permission denied for')
    || ' / ' || pg_temp.pfx(pg_temp.run_as('anon', 'select public.founding_seed_row(''x'')::text'), 'ERR: permission denied for'), 'ERR: permission denied for / ERR: permission denied for');

  -- ---- R: reading the row ------------------------------------------------------------------------------------------------------------------------
  t := pg_temp.run_as('service', format('select public.founding_seed_row(%L)::text', 'zzseed-b-' || tg));
  r := r || pg_temp.chk('R1', 'by tag: what the row holds (first name from the one-word full name, no surname, no date of birth, email, number, 3 subjects, availability, practicum, police, no account yet)',
    concat_ws('|', t::jsonb ->> 'first_name', coalesce(t::jsonb ->> 'surname', 'null'), coalesce(t::jsonb ->> 'date_of_birth', 'null'), t::jsonb ->> 'email', t::jsonb ->> 'whatsapp', jsonb_array_length(t::jsonb -> 'subjects')::text,
              (t::jsonb -> 'availability')::text, t::jsonb ->> 'practicum', t::jsonb ->> 'police_clearance', t::jsonb ->> 'has_account'),
    'Zzseedtwo|null|null|sw.b.' || uid || '@example.invalid|+27820000010|3|["evenings"]|three_plus|not_yet|false');
  r := r || pg_temp.chk('R2', 'by email (capitals ignored) the same row; an unknown tag answers null; two rows with one tag are refused in words',
    (pg_temp.run_as('service', format('select public.founding_seed_row(%L)::text', upper('sw.b.' || uid || '@example.invalid')))::jsonb ->> 'id') || ' / ' || pg_temp.run_as('service', 'select public.founding_seed_row(''no-such-tag-zz'')::text')
    || ' / ' || pg_temp.pfx(pg_temp.run_as('service', format('select public.founding_seed_row(%L)::text', 'zzseed-a-' || tg)), 'ERR: More than one list row matches'),
    v_row2::text || ' / null / ERR: More than one list row matches');
  r := r || pg_temp.chk('R3', 'the answer holds nothing about the list''s admin note, consent or tracking (only the fields above)',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.run_as('service', format('select public.founding_seed_row(%L)::text', 'zzseed-b-' || tg))::jsonb) k),
    'availability,date_of_birth,email,first_name,full_name,has_account,id,police_clearance,practicum,src,status,subjects,surname,whatsapp');

  -- ---- A: the account, made the way Auth makes it (no surname, no date of birth, no acceptance) ---------------------------------------------------------
  perform pg_temp.mkuser(v_acct, 'sw.b.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zzseedtwo', 'phone_number', '0820000010'));
  select concat_ws('|', p.role::text, p.full_name, coalesce(p.date_of_birth::text, 'null'), (select count(*)::text from tutor_profiles tp where tp.id = v_acct), (select count(*)::text from policy_acceptances a where a.profile_id = v_acct),
                   (select count(*)::text from tutor_subject_competencies c where c.tutor_id = v_acct)) into t from profiles p where p.id = v_acct;
  r := r || pg_temp.chk('A1', 'the trigger made a tutor profile with the one-word name, no date of birth, no acceptance record, no subjects yet', t, 'tutor|Zzseedtwo|null|1|0|0');
  select coalesce(f.user_id::text, 'null') into t from founding_tutors_list f where f.id = v_row2;
  r := r || pg_temp.chk('A2', 'the sign-up trigger already linked the list row to the account (by the email)', t, v_acct::text);
  r := r || pg_temp.chk('A3', 'the row now reports an account', pg_temp.run_as('service', format('select (public.founding_seed_row(%L)::jsonb ->> ''has_account'')', 'zzseed-b-' || tg)), 'true');

  -- ---- F: finishing -------------------------------------------------------------------------------------------------------------------------------------
  t := pg_temp.run_as('service', format('select public.founding_seed_finish(%L, %L)::text', v_row2, v_acct));
  r := r || pg_temp.chk('F1', 'finishing files the subjects as claims (a second range for the same subject is skipped and counted)', t, '{"ok": true, "competencies_added": 2, "competencies_skipped": 1}');
  select concat_ws('|', (select count(*)::text from tutor_subject_competencies c where c.tutor_id = v_acct), (select count(*)::text from tutor_subject_competencies c where c.tutor_id = v_acct and c.verification_status::text = 'pending'),
                   (select c.min_grade_level || '-' || c.max_grade_level from tutor_subject_competencies c where c.tutor_id = v_acct and c.subject_name = v_subj1)) into t;
  r := r || pg_temp.chk('F2', 'two competencies, both pending (nothing verified), with the grades the person gave', t, '2|2|Grade 8-Grade 12');
  select concat_ws('|', f.status, (f.released_at is not null)::text, coalesce(f.wave::text, 'null'), coalesce(f.delete_after::text, 'null'), f.user_id::text, f.src) into t from founding_tutors_list f where f.id = v_row2;
  r := r || pg_temp.chk('F3', 'the list row is "signed up", released now, wave 1, no delete date, linked, and keeps its tag', t, 'signed_up|true|1|null|' || v_acct::text || '|zzseed-b-' || tg);
  t := pg_temp.run_as('service', format('select public.founding_seed_finish(%L, %L)::text', v_row2, v_acct));
  r := r || pg_temp.chk('F4', 'running it again changes nothing (0 added, the 3 are skipped)', t || ' / ' || (select count(*)::text from tutor_subject_competencies c where c.tutor_id = v_acct), '{"ok": true, "competencies_added": 0, "competencies_skipped": 3} / 2');
  select concat_ws('|', (select count(*)::text from policy_acceptances a where a.profile_id = v_acct), coalesce((select p.date_of_birth::text from profiles p where p.id = v_acct), 'null'), (select count(*)::text from tutor_verification_documents d where d.tutor_id = v_acct),
                   (select tp.is_verified::text from tutor_profiles tp where tp.id = v_acct), (select count(*)::text from tutor_availability av where av.tutor_id = v_acct)) into t;
  r := r || pg_temp.chk('F5', 'nothing about consent, date of birth, documents, verification or hours was written', t, '0|null|0|false|0');
  select e.value ->> 'stage' into t from jsonb_array_elements(pg_temp.run_as(v_vo::text, 'select public.admin_founding_steps()::text')::jsonb) e where e.value ->> 'id' = v_row2::text;
  r := r || pg_temp.chk('F6', 'the funnel reads this person as "account"', t, 'account');
  -- the refusals
  perform pg_temp.mkuser(v_acct2, 'sw.other.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Other'));
  r := r || pg_temp.chk('F7', 'refused in words: an account with a different email; a learner''s account; a row that is not a form or admin row; a made-up row id',
    pg_temp.pfx(pg_temp.run_as('service', format('select public.founding_seed_finish(%L, %L)::text', v_row, v_acct2)), 'ERR: That account is not the one for this list row')
    || ' / ' || pg_temp.pfx(pg_temp.run_as('service', format('select public.founding_seed_finish(%L, %L)::text', v_row, v_ld)), 'ERR: That account is not the one for this list row')
    || ' / ' || pg_temp.pfx(pg_temp.run_as('service', format('select public.founding_seed_finish(%L, %L)::text', (select id from founding_tutors_list where source = 'backfill' limit 1), v_acct)), 'ERR: There is no such list row')
    || ' / ' || pg_temp.pfx(pg_temp.run_as('service', format('select public.founding_seed_finish(%L, %L)::text', gen_random_uuid(), v_acct)), 'ERR: There is no such list row'),
    'ERR: That account is not the one for this list row / ERR: That account is not the one for this list row / ERR: There is no such list row / ERR: There is no such list row');
  -- a row an admin had already linked to a different account (the admin's "Link this account") cannot be attached to a new one
  update founding_tutors_list set user_id = v_tutor2 where id = v_row;
  perform pg_temp.mkuser(v_other, 'sw.a.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zzseed'));
  r := r || pg_temp.chk('F8', 'a row already linked to a different account is refused in words', pg_temp.pfx(pg_temp.run_as('service', format('select public.founding_seed_finish(%L, %L)::text', v_row, v_other)), 'ERR: This list row is already linked to a different account'), 'ERR: This list row is already linked to a different account');
  r := r || pg_temp.chk('F9', 'the service key alone can call it: a signed-in person and a visitor are refused',
    pg_temp.pfx(pg_temp.run_as(v_acct::text, format('select public.founding_seed_finish(%L, %L)::text', v_row2, v_acct)), 'ERR: permission denied for') || ' / ' || pg_temp.pfx(pg_temp.run_as('anon', format('select public.founding_seed_finish(%L, %L)::text', v_row2, v_acct)), 'ERR: permission denied for'),
    'ERR: permission denied for / ERR: permission denied for');

  -- ---- G: what the person is asked for on first sign-in -----------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('G1', 'as the seeded tutor: the app needs a surname, a date of birth and the Terms and Privacy acceptance',
    pg_temp.run_as(v_acct::text, 'select public.my_needs_surname()::text') || '/' || pg_temp.run_as(v_acct::text, 'select coalesce(public.my_date_of_birth()::text, ''none'')') || '/' || pg_temp.run_as(v_acct::text, 'select count(*)::text from public.my_pending_acceptances()'), 'true/none/2');
  r := r || pg_temp.chk('G2', 'a normal tutor (first name and surname), a learner and a visitor are not asked for a surname',
    pg_temp.run_as(v_tutor2::text, 'select public.my_needs_surname()::text') || '/' || pg_temp.run_as(v_ld::text, 'select public.my_needs_surname()::text') || '/' || pg_temp.pfx(pg_temp.run_as('anon', 'select public.my_needs_surname()::text'), 'ERR: permission denied for'), 'false/false/ERR: permission denied for');
  r := r || pg_temp.chk('G3', 'a surname with markup, empty, or 51 characters is refused in words, and nothing is saved',
    pg_temp.pfx(pg_temp.run_as(v_acct::text, 'select public.set_my_surname(''Zz<b>'')::text'), 'ERR: Enter your surname') || ' / ' || pg_temp.pfx(pg_temp.run_as(v_acct::text, 'select public.set_my_surname('' '')::text'), 'ERR: Enter your surname')
    || ' / ' || pg_temp.pfx(pg_temp.run_as(v_acct::text, format('select public.set_my_surname(%L)::text', repeat('x', 51))), 'ERR: Enter your surname') || ' / ' || (select p.full_name from profiles p where p.id = v_acct),
    'ERR: Enter your surname / ERR: Enter your surname / ERR: Enter your surname / Zzseedtwo');
  t := pg_temp.run_as(v_acct::text, 'select coalesce(nullif(public.set_my_surname(''  Zzfamily '')::text, ''''), ''done'')');
  r := r || pg_temp.chk('G4', 'the person saves their surname: the saved name becomes first name + surname and they are no longer asked', t || ' / ' || (select p.full_name from profiles p where p.id = v_acct) || ' / ' || pg_temp.run_as(v_acct::text, 'select public.my_needs_surname()::text'), 'done / Zzseedtwo Zzfamily / false');
  r := r || pg_temp.chk('G5', 'it cannot be used to rename someone: a second try, a normal tutor and a learner are refused', pg_temp.pfx(pg_temp.run_as(v_acct::text, 'select public.set_my_surname(''Other'')::text'), 'ERR: Your surname is already saved')
    || ' / ' || pg_temp.pfx(pg_temp.run_as(v_tutor2::text, 'select public.set_my_surname(''Other'')::text'), 'ERR: Your surname is already saved') || ' / ' || pg_temp.pfx(pg_temp.run_as(v_ld::text, 'select public.set_my_surname(''Other'')::text'), 'ERR: Your surname is already saved')
    || ' / ' || pg_temp.pfx(pg_temp.run_as('anon', 'select public.set_my_surname(''Other'')::text'), 'ERR: permission denied for'),
    'ERR: Your surname is already saved / ERR: Your surname is already saved / ERR: Your surname is already saved / ERR: permission denied for');
  r := r || pg_temp.chk('G6', 'the date of birth prompt works for this account: under 18 is refused, a real adult date is saved once, a second try is refused',
    pg_temp.pfx(pg_temp.run_as(v_acct::text, format('select public.set_my_date_of_birth(%L::date)::text', (v_today - interval '17 years')::date)), 'ERR: Tutor accounts on Tutorlage need to be 18 or older') || ' / '
    || pg_temp.run_as(v_acct::text, format('select coalesce(nullif(public.set_my_date_of_birth(%L::date)::text, ''''), ''done'')', adult)) || ' / ' || pg_temp.pfx(pg_temp.run_as(v_acct::text, format('select public.set_my_date_of_birth(%L::date)::text', adult)), 'ERR: Contact support to correct your date of birth'),
    'ERR: Tutor accounts on Tutorlage need to be 18 or older / done / ERR: Contact support to correct your date of birth');
  t := pg_temp.run_as(v_acct::text, 'select public.accept_current_policies()::text');
  r := r || pg_temp.chk('G7', 'accepting the Terms and Privacy Policy is the person''s own call: it records exactly two acceptances for them and nothing is pending after',
    (select count(*)::text from policy_acceptances a where a.profile_id = v_acct and a.accepted_by_profile_id = v_acct and a.method = 'reaccept_prompt') || ' / ' || pg_temp.run_as(v_acct::text, 'select count(*)::text from public.my_pending_acceptances()'), '2 / 0');

  exception when others then
    r := r || 'UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%'), count(*) filter (where l like '% ok'), count(*) into nfail, nok, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  select coalesce(string_agg(l, E'\n') filter (where l like '%FAIL%'), '(none)') into t from unnest(string_to_array(r, E'\n')) l;
  select string_agg(split_part(l, ' ', 1), ' ') filter (where l like '% ok') into t2 from unnest(string_to_array(r, E'\n')) l;
  raise exception E'SEED WARM TUTORS TEST (rolled back): % OK, % FAIL, % lines in all\nFAIL LINES: %\nOK: %', nok, nfail, nlines, t, t2;
end $$;
