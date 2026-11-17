-- Rolled-back test of migration 20261117200000_closing_removes_founding_list_row.sql (PM item 6b, 17 Nov 2026: closing an account deletes the person's waiting-list row).
-- Run it with the migration TWICE in one rolled-back statement (the second run proves the patch is a no-op the second time):
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/closing_removes_founding_row.sql supabase/migrations/20261117200000_closing_removes_founding_list_row.sql supabase/migrations/20261117200000_closing_removes_founding_list_row.sql
-- or, once applied, on its own. Fixtures are made-up people (example.invalid), built inside the run: three accounts (two tutors, one learner), three list rows (two of the people, one other person).
-- The closing cleanup is driven for real (closure_delete_data on an account_closures row), not simulated.
do $$
declare
  r text := '';
  uid text := replace(gen_random_uuid()::text, '-', '');
  tg text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  adult text := ((now() at time zone 'Africa/Johannesburg')::date - interval '30 years')::date::text;
  v_t1 uuid := gen_random_uuid(); v_t2 uuid := gen_random_uuid(); v_l1 uuid := gen_random_uuid();
  v_ra uuid; v_rb uuid; v_rc uuid;
  v_c1 uuid; v_c2 uuid; v_c3 uuid;
  t text; t2 text; n int; nfail int; nok int; nlines int; v_def text;
begin
  begin
  execute $mk$
    create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
      select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
             || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
    $f$ $mk$;
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

  -- three made-up list rows through the join function (two for the people who will close, one for somebody else who stays)
  perform set_config('test.base', jsonb_build_object('website', '', 'elapsed_ms', 9000, 'code_name', 'Zz', 'whatsapp', '082 000 0020', 'is_adult', true,
    'subjects', jsonb_build_array(jsonb_build_object('subject', 'Mathematics', 'min_grade', 'Grade 8', 'max_grade', 'Grade 12')),
    'availability', jsonb_build_array('evenings'), 'practicum', 'three_plus', 'police_clearance', 'not_yet', 'parent_reach', 'none', 'parent_reach_willing', false,
    'prior_tutoring', 'Some tutoring', 'consent_contact', true, 'src', 'zzcl-' || tg, 'visitor', gen_random_uuid()::text)::text, true);
  perform public.join_founding_list(current_setting('test.base')::jsonb || jsonb_build_object('full_name', 'Zzclosea', 'email', 'cl.a.' || uid || '@example.invalid', 'src', 'zzcl-a-' || tg));
  perform public.join_founding_list(current_setting('test.base')::jsonb || jsonb_build_object('full_name', 'Zzcloseb', 'email', 'cl.b.' || uid || '@example.invalid', 'src', 'zzcl-b-' || tg));
  perform public.join_founding_list(current_setting('test.base')::jsonb || jsonb_build_object('full_name', 'Zzclosec', 'email', 'cl.c.' || uid || '@example.invalid', 'src', 'zzcl-c-' || tg));
  select f.id into v_ra from founding_tutors_list f where f.email_key = 'cl.a.' || uid || '@example.invalid';
  select f.id into v_rb from founding_tutors_list f where f.email_key = 'cl.b.' || uid || '@example.invalid';
  select f.id into v_rc from founding_tutors_list f where f.email_key = 'cl.c.' || uid || '@example.invalid';
  -- the accounts: tutor 1 (its list row gets linked by the sign-up), tutor 2 (its row is then UNLINKED on purpose), a learner with no list row at all
  perform pg_temp.mkuser(v_t1, 'cl.a.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zzclosea', 'surname', 'Tutor', 'date_of_birth', adult));
  perform pg_temp.mkuser(v_t2, 'cl.b.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zzcloseb', 'surname', 'Tutor', 'date_of_birth', adult));
  perform pg_temp.mkuser(v_l1, 'cl.l.' || uid || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Zzlearner', 'surname', 'Learner', 'date_of_birth', adult));
  update founding_tutors_list set user_id = null where id = v_rb;
  r := r || pg_temp.chk('C0', 'setup: tutor 1 is linked to its list row, tutor 2 is not, the other person''s row is untouched, the learner has none',
    (select (f.user_id = v_t1)::text from founding_tutors_list f where f.id = v_ra) || ' / ' || (select (f.user_id is null)::text from founding_tutors_list f where f.id = v_rb) || ' / ' || (select (f.user_id is null)::text from founding_tutors_list f where f.id = v_rc)
    || ' / ' || (select count(*)::text from founding_tutors_list f where f.email_key = 'cl.l.' || uid || '@example.invalid'), 'true / true / true / 0');

  -- who may call the new function: nobody from the API
  r := r || pg_temp.chk('C1', 'the new function is internal: anon, signed-in and the service key are all refused',
    pg_temp.run_as('anon', format('select public.closure_delete_founding_row(%L)::text', v_t1)) || ' / ' || pg_temp.run_as(v_t1::text, format('select public.closure_delete_founding_row(%L)::text', v_t1)) || ' / ' || pg_temp.run_as('service', format('select public.closure_delete_founding_row(%L)::text', v_t1)),
    'ERR: permission denied for function closure_delete_founding_row / ERR: permission denied for function closure_delete_founding_row / ERR: permission denied for function closure_delete_founding_row');
  select pg_get_functiondef('public.closure_delete_data(uuid)'::regprocedure) into v_def;
  r := r || pg_temp.chk('C2', 'the patch is in the stored text exactly once (also after a second run of the migration), and sits AFTER the safety-hold return and BEFORE the profile rows are blanked',
    ((length(v_def) - length(replace(v_def, 'CLOSING DELETES THE LIST ROW', ''))) / length('CLOSING DELETES THE LIST ROW'))::text || ' / ' || (position('profile_is_on_safety_hold' in v_def) < position('CLOSING DELETES THE LIST ROW' in v_def))::text
    || ' / ' || (position('CLOSING DELETES THE LIST ROW' in v_def) < position('update public.profiles' in v_def))::text, '1 / true / true');
  r := r || pg_temp.chk('C3', 'closure_delete_data is still security definer with its search path pinned and still not callable from the API',
    (select (p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))::text from pg_proc p where p.oid = 'public.closure_delete_data(uuid)'::regprocedure) || ' / '
    || has_function_privilege('anon', 'public.closure_delete_data(uuid)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.closure_delete_data(uuid)', 'execute')::text, 'true / false/false');

  -- three closures that have reached "closed" (the state the cleanup runs from)
  insert into account_closures (profile_id, role, status, started_by, started_how, was_adult, due_at, outer_limit_at, undo_until, contact_email)
  values (v_t1, 'tutor', 'closed', v_t1, 'self', true, now(), now() + interval '60 days', now() - interval '1 day', null) returning id into v_c1;
  insert into account_closures (profile_id, role, status, started_by, started_how, was_adult, due_at, outer_limit_at, undo_until, contact_email)
  values (v_t2, 'tutor', 'closed', v_t2, 'self', true, now(), now() + interval '60 days', now() - interval '1 day', null) returning id into v_c2;
  insert into account_closures (profile_id, role, status, started_by, started_how, was_adult, due_at, outer_limit_at, undo_until, contact_email)
  values (v_l1, 'student', 'closed', v_l1, 'self', true, now(), now() + interval '60 days', now() - interval '1 day', null) returning id into v_c3;

  perform public.closure_delete_data(v_c1);
  r := r || pg_temp.chk('C4', 'tutor 1 closes: the list row linked to the account is GONE, the deletion record says one list row was deleted, the account is blanked as before',
    (select count(*)::text from founding_tutors_list f where f.id = v_ra) || ' / ' || (select d.deleted ->> 'founding_list_rows' from account_deletion_records d where d.closure_id = v_c1)
    || ' / ' || (select p.full_name from profiles p where p.id = v_t1) || ' / ' || (select c.status from account_closures c where c.id = v_c1), '0 / 1 / Former tutor / db_deleted');
  perform public.closure_delete_data(v_c2);
  r := r || pg_temp.chk('C5', 'tutor 2 closes with a list row that was never linked: it is found by the account''s own email and deleted too',
    (select count(*)::text from founding_tutors_list f where f.id = v_rb) || ' / ' || (select d.deleted ->> 'founding_list_rows' from account_deletion_records d where d.closure_id = v_c2), '0 / 1');
  perform public.closure_delete_data(v_c3);
  r := r || pg_temp.chk('C6', 'a learner with no list row closes: nothing is deleted, the record says 0, no error',
    (select d.deleted ->> 'founding_list_rows' from account_deletion_records d where d.closure_id = v_c3) || ' / ' || (select c.status from account_closures c where c.id = v_c3), '0 / db_deleted');
  r := r || pg_temp.chk('C7', 'the OTHER person''s list row is untouched by all three closures (same row, same name, same email)',
    (select count(*)::text from founding_tutors_list f where f.id = v_rc and f.full_name = 'Zzclosec' and f.email_key = 'cl.c.' || uid || '@example.invalid'), '1');
  perform public.closure_delete_data(v_c1);
  r := r || pg_temp.chk('C8', 'running the cleanup again for a closed-out account changes nothing and deletes nothing more (status is already db_deleted)',
    (select d.deleted ->> 'founding_list_rows' from account_deletion_records d where d.closure_id = v_c1) || ' / ' || (select count(*)::text from account_deletion_records d where d.closure_id = v_c1) || ' / ' || (select count(*)::text from founding_tutors_list f where f.id = v_rc), '1 / 1 / 1');
  -- the email match never reaches a blanked account: a "closed.<id>@closed.invalid" address matches no list row
  perform public.join_founding_list(current_setting('test.base')::jsonb || jsonb_build_object('full_name', 'Zzdecoy', 'email', 'cl.d.' || uid || '@example.invalid', 'src', 'zzcl-d-' || tg));
  update founding_tutors_list set email_key = 'closed.' || v_t1::text || '@closed.invalid' where email_key = 'cl.d.' || uid || '@example.invalid';
  r := r || pg_temp.chk('C9', 'a blanked account (email closed.<id>@closed.invalid) never matches a list row by email, even one that carries exactly that address',
    public.closure_delete_founding_row(v_t1)::text || ' / ' || (select count(*)::text from founding_tutors_list f where f.email_key = 'closed.' || v_t1::text || '@closed.invalid'), '0 / 1');

  exception when others then
    r := r || 'UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%'), count(*) filter (where l like '% ok'), count(*) into nfail, nok, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  select coalesce(string_agg(l, E'\n') filter (where l like '%FAIL%'), '(none)') into t from unnest(string_to_array(r, E'\n')) l;
  select string_agg(split_part(l, ' ', 1), ' ') filter (where l like '% ok') into t2 from unnest(string_to_array(r, E'\n')) l;
  raise exception E'CLOSING REMOVES THE LIST ROW TEST (rolled back): % OK, % FAIL, % lines in all\nFAIL LINES: %\nOK: %', nok, nfail, nlines, t, t2;
end $$;
