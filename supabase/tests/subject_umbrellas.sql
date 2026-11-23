-- Rolled-back test of migration 20261124100000_subject_umbrellas.sql (job Q-FIX, 24 Nov 2026). Run it TOGETHER with the migration (one statement; the last line raises so everything is undone)
-- or alone after the apply. Made-up tutors only; the matching functions read only the rows of the tutor they are asked about, so real tutors cannot change a line.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  uid text := replace(gen_random_uuid()::text, '-', '');
  v_sup uuid := gen_random_uuid(); v_off uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); t3 uuid := gen_random_uuid(); t4 uuid := gen_random_uuid(); t5 uuid := gen_random_uuid();
  t text; n int;
  nfail int; nlines int;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null') || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n' $f$ $mk$;
    execute $mk$
      create function pg_temp.run_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
      declare v text;
      begin
        if p_u is null then perform set_config('request.jwt.claims', '', true); set local role anon;
        else perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true); set local role authenticated; end if;
        begin execute p_sql into v; reset role; return coalesce(v, 'null');
        exception when others then reset role; return 'ERR: ' || sqlerrm; end;
      end $f$ $mk$;
    execute $mk$
      create function pg_temp.q(p_t uuid, p_subject text, p_grade text) returns text language sql as $f$
        select coalesce(public.tutor_qualify_problem(p_t, p_subject, p_grade, null, null), 'ok') $f$ $mk$;

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_sup, z, 'authenticated', 'authenticated', 'um.sup.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Sue', 'surname', 'Super', 'date_of_birth', adult), '{}'),
      (v_off, z, 'authenticated', 'authenticated', 'um.off.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Vic', 'surname', 'Officer', 'date_of_birth', adult), '{}');
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
      (v_sup, 'Sue', 'Super', 'um.sup.' || uid || '@example.invalid', '', 'super_admin', true),
      (v_off, 'Vic', 'Officer', 'um.off.' || uid || '@example.invalid', '', 'verification_officer', true);
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    select x, z, 'authenticated', 'authenticated', 'um.t.' || x || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tt', 'date_of_birth', adult), '{}' from unnest(array[t1, t2, t3, t4, t5]) x;
    update tutor_profiles set is_verified = true where id = any (array[t1, t2, t3, t4, t5]);
    insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status) values
      (t1, 'Social Sciences', 'caps', 'Grade 4', 'Grade 9', 'verified'),
      (t2, 'Natural Sciences and Technology', 'caps', 'Grade 4', 'Grade 9', 'verified'),
      (t3, 'History', 'caps', 'Grade 4', 'Grade 9', 'verified'),
      (t4, 'Social Sciences', 'caps', 'Grade 4', 'Grade 9', 'pending'),
      (t5, 'Zz Umbrella', 'caps', 'Grade 4', 'Grade 9', 'verified');
    insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) values (t5, 1, '09:00', '12:00');

    -- A. the starting rows (the CEO's)
    r := r || pg_temp.chk('A1', 'six starting rows, every one up to Grade 7', (select count(*)::text || '/' || count(*) filter (where last_grade = 'Grade 7') from public.subject_umbrellas where umbrella in ('Social Sciences', 'Natural Sciences and Technology')), '6/6');

    -- B. a tutor approved for an umbrella now reaches the parts, up to Grade 7
    r := r || pg_temp.chk('B1', 'History Gr 5 reaches a Social Sciences tutor', pg_temp.q(t1, 'History', 'Grade 5'), 'ok');
    r := r || pg_temp.chk('B2', '...Geography Gr 7 (the last grade) too', pg_temp.q(t1, 'Geography', 'Grade 7'), 'ok');
    r := r || pg_temp.chk('B3', '...but History Gr 8 does not (she must be approved for the part)', pg_temp.q(t1, 'History', 'Grade 8'), 'no_subject');
    r := r || pg_temp.chk('B4', '...nor Geography Gr 9', pg_temp.q(t1, 'Geography', 'Grade 9'), 'no_subject');
    r := r || pg_temp.chk('B5', 'Physical Sciences Gr 6 reaches a Natural Sciences and Technology tutor', pg_temp.q(t2, 'Physical Sciences', 'Grade 6'), 'ok');
    r := r || pg_temp.chk('B6', '...Life Sciences Gr 7 too', pg_temp.q(t2, 'Life Sciences', 'Grade 7'), 'ok');
    r := r || pg_temp.chk('B7', '...but Physical Sciences Gr 8 does not', pg_temp.q(t2, 'Physical Sciences', 'Grade 8'), 'no_subject');
    r := r || pg_temp.chk('B8', 'a request whose grade is not asked is not limited by the last grade, her own range still applies', pg_temp.q(t1, 'History', null), 'ok');
    r := r || pg_temp.chk('B9', 'her own approved grades still count: History Gr 3 is outside Grade 4 to 9', pg_temp.q(t1, 'History', 'Grade 3'), 'wrong_grade');

    -- C. nothing that matched before stops matching (the substring rule is untouched)
    r := r || pg_temp.chk('C1', 'Social Sciences itself still matches its tutor', pg_temp.q(t1, 'Social Sciences', 'Grade 8'), 'ok');
    r := r || pg_temp.chk('C2', 'Natural Sciences Gr 8 still matches the Natural Sciences and Technology tutor (contained in her name, as before)', pg_temp.q(t2, 'Natural Sciences', 'Grade 8'), 'ok');
    r := r || pg_temp.chk('C3', 'Technology Gr 9 still matches her too (as before)', pg_temp.q(t2, 'Technology', 'Grade 9'), 'ok');
    r := r || pg_temp.chk('C4', 'a tutor approved for History itself is unchanged', pg_temp.q(t3, 'History', 'Grade 8'), 'ok');
    r := r || pg_temp.chk('C5', 'the other way is still closed: a History tutor does not cover Social Sciences', pg_temp.q(t3, 'Social Sciences', 'Grade 5'), 'no_subject');
    r := r || pg_temp.chk('C6', 'an umbrella does not cover an unrelated subject', pg_temp.q(t1, 'Mathematics', 'Grade 5') || '/' || pg_temp.q(t1, 'Technology', 'Grade 5'), 'no_subject/no_subject');
    r := r || pg_temp.chk('C7', 'a PENDING umbrella approval does not match a part (not_approved, as for any pending subject)', pg_temp.q(t4, 'History', 'Grade 5'), 'not_approved');
    r := r || pg_temp.chk('C8', 'tutor_qualifies agrees', (public.tutor_qualifies(t1, 'History', 'Grade 5', null, null))::text || '/' || (public.tutor_qualifies(t1, 'History', 'Grade 8', null, null))::text, 'true/false');
    r := r || pg_temp.chk('C9', 'the picker''s no_tutor_reason: with the made-up tutors out of the count the answer for a part follows the same rule (a real tutor may exist, so only the code path is run)', ((public.no_tutor_reason('History', 'Grade 5', null, null, null) ->> 'case') is not null)::text, 'true');

    -- D. rights and the admin edit
    r := r || pg_temp.chk('D1', 'the helper cannot be called by the app', has_function_privilege('authenticated', 'public.subject_covers(text,text,text)', 'execute')::text || '/' || has_function_privilege('anon', 'public.subject_covers(text,text,text)', 'execute')::text, 'false/false');
    r := r || pg_temp.chk('D2', 'the table itself is closed to the app', has_table_privilege('authenticated', 'public.subject_umbrellas', 'select')::text || '/' || has_table_privilege('anon', 'public.subject_umbrellas', 'select')::text, 'false/false');
    r := r || pg_temp.chk('D3', 'a verification officer cannot read or change it', left(pg_temp.run_as(v_off, 'select count(*)::text from public.admin_list_subject_umbrellas()'), 40) || '|' || left(pg_temp.run_as(v_off, $q$select public.admin_set_subject_umbrella('Zz Umbrella', 'Zz Part', 'Grade 7')::text$q$), 40),
      'ERR: Only a super admin can see the subj|ERR: Only a super admin can change the s');
    r := r || pg_temp.chk('D4', 'a signed-out visitor cannot', left(pg_temp.run_as(null, 'select count(*)::text from public.admin_list_subject_umbrellas()'), 30), 'ERR: permission denied for fun');
    r := r || pg_temp.chk('D5', 'a super admin sees the six rows', pg_temp.run_as(v_sup, $q$select count(*)::text from public.admin_list_subject_umbrellas() where umbrella in ('Social Sciences', 'Natural Sciences and Technology')$q$), '6');
    t := pg_temp.run_as(v_sup, $q$select public.admin_set_subject_umbrella('Zz Umbrella', 'Zz Part', 'Grade 7')::text$q$);
    r := r || pg_temp.chk('D5b', 'a super admin can add a row (the call returns nothing)', t, '');
    r := r || pg_temp.chk('D6', 'a new row works at once for a made-up umbrella', pg_temp.q(t5, 'Zz Part', 'Grade 6') || '/' || pg_temp.q(t5, 'Zz Part', 'Grade 8'), 'ok/no_subject');
    perform pg_temp.run_as(v_sup, $q$select public.admin_set_subject_umbrella('Zz Umbrella', 'Zz Part', 'Grade 9')::text$q$);
    r := r || pg_temp.chk('D7', 'raising the last grade to 9 widens it', pg_temp.q(t5, 'Zz Part', 'Grade 8'), 'ok');
    r := r || pg_temp.chk('D8', 'a last grade that is not in the list is refused', left(pg_temp.run_as(v_sup, $q$select public.admin_set_subject_umbrella('Zz Umbrella', 'Zz Part', 'Grade 99')::text$q$), 45), 'ERR: That last grade is not in the grade list');
    r := r || pg_temp.chk('D9', 'a part the same as its umbrella is refused', left(pg_temp.run_as(v_sup, $q$select public.admin_set_subject_umbrella('Zz Umbrella', ' zz umbrella ', 'Grade 7')::text$q$), 22), 'ERR: Give the umbrella');
    r := r || pg_temp.chk('D10', 'two audit lines so far, carrying the names and the grade only', (select count(*)::text from public.admin_audit_logs a where a.admin_id = v_sup and a.metadata ->> 'kind' = 'subject_umbrella_set' and a.metadata ->> 'umbrella' = 'Zz Umbrella'), '2');

    -- E. the coverage view counts umbrella supply under the part
    r := r || pg_temp.chk('E1', 'the coverage view: the umbrella tutor with hours is supply for Zz Part in the phases up to her last grade (9: Intermediate and Senior)',
      pg_temp.run_as(v_off, $q$select string_agg(x ->> 'phase', ',' order by x ->> 'phase') from jsonb_array_elements(public.admin_founding_coverage()) x where x ->> 'subject' = 'Zz Part' and (x ->> 'ready_tutors')::int = 1$q$),
      'Intermediate (4-6),Senior (7-9)');
    perform pg_temp.run_as(v_sup, $q$select public.admin_set_subject_umbrella('Zz Umbrella', 'Zz Part', 'Grade 6')::text$q$);
    r := r || pg_temp.chk('E2', '...cut at Grade 6 it is supply for Intermediate only', pg_temp.run_as(v_off, $q$select string_agg(x ->> 'phase', ',' order by x ->> 'phase') from jsonb_array_elements(public.admin_founding_coverage()) x where x ->> 'subject' = 'Zz Part' and (x ->> 'ready_tutors')::int = 1$q$), 'Intermediate (4-6)');
    r := r || pg_temp.chk('E3', 'her own umbrella row is still counted as before', pg_temp.run_as(v_off, $q$select count(*)::text from jsonb_array_elements(public.admin_founding_coverage()) x where x ->> 'subject' = 'Zz Umbrella' and (x ->> 'ready_tutors')::int = 1$q$), '2');
    perform pg_temp.run_as(v_sup, $q$select public.admin_remove_subject_umbrella('Zz Umbrella', 'Zz Part')::text$q$);
    r := r || pg_temp.chk('E4', 'removing the row takes the match away', pg_temp.q(t5, 'Zz Part', 'Grade 5'), 'no_subject');
    r := r || pg_temp.chk('E5', 'the removal is audited', (select count(*)::text from public.admin_audit_logs a where a.admin_id = v_sup and a.metadata ->> 'kind' = 'subject_umbrella_removed'), '1');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
