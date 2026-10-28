-- Rolled-back test of Tier 1 by documents (migration 20261021142000), on a database that already has the Tier 1 pipeline (20261012090200 and the
-- seeded Module 7 scenarios) and the Mathematics, Life Sciences subject rows. Run it with scripts/run-rolled-back-test.mjs in ONE statement:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/tier1_documents_path.sql supabase/migrations/20261021142000_tier1_documents_path.sql
-- (it also works after the migration is applied, run on its own: then paste this file only). Every refusal is matched on its own message or on
-- "permission denied". Each part runs in its own block: a mistake in one part shows as an ERROR line and the others still run. Lines are short on
-- purpose (the Supabase tool cuts a long answer). The older suite tier1_pipeline.sql is the regression test of the FULL route: run it after setting
-- tier1_route to 'full' (see README.md).
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '25 years')::date::text;
  ad uuid := gen_random_uuid(); ls uuid := gen_random_uuid();
  ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid(); tc uuid := gen_random_uuid(); td uuid := gen_random_uuid(); te uuid := gen_random_uuid();
  tg uuid := gen_random_uuid(); th uuid := gen_random_uuid(); ti uuid := gen_random_uuid();
  v_good jsonb; v_bad jsonb := '{"1":0,"2":0,"3":0,"4":0}'::jsonb;
  ra uuid; rb uuid; rc uuid; rd uuid; re uuid; rg1 uuid; rg2 uuid; rh uuid; ri uuid;
  j jsonb; j2 jsonb; m text; t text; w2 text; n int; n2 int; n3 int; bl boolean; bl2 boolean; i int;
  ts1 timestamptz; ts2 timestamptz; nfail int; nlines int; rep text; old_report text;
begin
  create function pg_temp.call_as(p_uid uuid, p_sql text, p_role text default 'authenticated') returns text language plpgsql as $f$
  declare v text; e text;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', p_role)::text, true);
    execute format('set local role %I', p_role);
    begin
      execute p_sql into v;
    exception when others then
      e := sqlerrm;
    end;
    execute 'reset role';
    return case when e is null then 'OK:' || coalesce(v, '') else 'ERR:' || e end;
  end $f$;
  create function pg_temp.call_json(p_uid uuid, p_sql text) returns jsonb language plpgsql as $f$
  declare t text;
  begin
    t := pg_temp.call_as(p_uid, p_sql);
    if left(t, 4) = 'ERR:' then raise exception '%', substr(t, 5); end if;
    return nullif(substr(t, 4), '')::jsonb;
  end $f$;
  create function pg_temp.expect_err(p_uid uuid, p_sql text, p_want text, p_role text default 'authenticated') returns text language plpgsql as $f$
  declare t text;
  begin
    t := pg_temp.call_as(p_uid, p_sql, p_role);
    if left(t, 4) = 'ERR:' and starts_with(substr(t, 5), p_want) then return ''; end if;
    return ' [' || left(p_sql, 40) || ' -> ' || left(t, 70) || ']';
  end $f$;
  create function pg_temp.comp(p_tutor uuid, p_subject text) returns text language sql as $f$
    select coalesce((select c.verification_status::text || '|' || c.min_grade_level || '|' || c.max_grade_level
                     from public.tutor_subject_competencies c where c.tutor_id = p_tutor and c.subject_name = p_subject limit 1), 'none')
  $f$;
  create function pg_temp.status(p_uid uuid, p_subject text) returns jsonb language plpgsql as $f$
  begin
    return pg_temp.call_json(p_uid, format('select public.tier1_status(%L)::text', p_subject));
  end $f$;
  create function pg_temp.record(p_uid uuid, p_subject text, p_mark numeric) returns uuid language plpgsql as $f$
  begin
    return (pg_temp.call_json(p_uid, format('select to_jsonb(public.tier1_submit_academic_record(%L, %s, ''matric'', %L))::text', p_subject, p_mark, p_uid || '/' || lower(p_subject) || '.pdf')) #>> '{}')::uuid;
  end $f$;
  create function pg_temp.verify(p_admin uuid, p_record uuid, p_note text) returns text language plpgsql as $f$
  begin
    return pg_temp.call_as(p_admin, format('select public.admin_check_tier1_record(%L, ''verified'', %L)::text', p_record, p_note));
  end $f$;
  create function pg_temp.check7(p_uid uuid, p_answers jsonb) returns jsonb language plpgsql as $f$
  begin
    return pg_temp.call_json(p_uid, format('select public.tier1_submit_module_check(%L::jsonb)::text', p_answers::text));
  end $f$;

  select jsonb_object_agg(id::text, answer) into v_good from public.tier1_scenarios;
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (ad, z, 'authenticated', 'authenticated', 'td.ad.' || ad || '@example.invalid', jsonb_build_object('first_name', 'Ann', 'date_of_birth', adult), '{}'),
    (ls, z, 'authenticated', 'authenticated', 'td.ls.' || ls || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Sam', 'date_of_birth', adult), '{}'),
    (ta, z, 'authenticated', 'authenticated', 'td.ta.' || ta || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Ada', 'date_of_birth', adult), '{}'),
    (tb, z, 'authenticated', 'authenticated', 'td.tb.' || tb || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Bea', 'date_of_birth', adult), '{}'),
    (tc, z, 'authenticated', 'authenticated', 'td.tc.' || tc || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Cai', 'date_of_birth', adult), '{}'),
    (td, z, 'authenticated', 'authenticated', 'td.td.' || td || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Dev', 'date_of_birth', adult), '{}'),
    (te, z, 'authenticated', 'authenticated', 'td.te.' || te || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Eli', 'date_of_birth', adult), '{}'),
    (tg, z, 'authenticated', 'authenticated', 'td.tg.' || tg || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Gus', 'date_of_birth', adult), '{}'),
    (th, z, 'authenticated', 'authenticated', 'td.th.' || th || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Hal', 'date_of_birth', adult), '{}'),
    (ti, z, 'authenticated', 'authenticated', 'td.ti.' || ti || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Ivy', 'date_of_birth', adult), '{}');
  insert into admin_profiles (id, first_name, surname, email) values (ad, 'Test', 'Admin', 'td.ad.' || ad || '@example.invalid');
  insert into storage.objects (bucket_id, name, owner)
    select 'tutor-documents', x.t || '/' || x.s || '.pdf', x.t from (values
      (ta, 'mathematics'), (tb, 'mathematics'), (tc, 'mathematics'), (td, 'mathematics'), (te, 'mathematics'),
      (tg, 'mathematics'), (tg, 'life sciences'), (th, 'mathematics'), (ti, 'mathematics')) x(t, s);
  r := r || 'S0 setup: 1 admin, 1 learner, 8 tutors, 9 results files, the Module 7 answers read as the owner' || E'\n';

  -- ============ A. what the migration put in place ===========================================================================
  begin
    select count(*) filter (where setting_key = 'tier1_route' and setting_value = '"documents"'::jsonb),
           count(*) filter (where setting_key = 'tier1_documents_wide_mark_pct' and setting_value = '80'::jsonb),
           count(*) filter (where setting_key = 'tier1_documents_narrow_max_grade' and setting_value = '"Grade 10"'::jsonb)
      into n, n2, n3 from system_settings;
    select count(*) into i from information_schema.columns where table_schema = 'public' and table_name = 'tier1_training' and column_name = 'conduct_accepted_at';
    r := r || format('A1 %s settings: route=documents (%s), wide mark 80 (%s), ceiling Grade 10 (%s); conduct column (%s)',
      case when n = 1 and n2 = 1 and n3 = 1 and i = 1 then 'ok' else 'FAIL' end, n, n2, n3, i) || E'\n';
    select count(*) filter (where has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')),
           count(*) filter (where p.prosecdef and p.proconfig::text like '%search_path=public%'), count(*)
      into n, n2, n3 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'tier1_grant_documents';
    select count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and p.prosecdef and p.proconfig::text like '%search_path=public%')
      into i from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('admin_check_tier1_record', 'tier1_submit_module_check', 'tier1_status');
    bl := not has_function_privilege('anon', 'public.tier1_training_complete(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.tier1_training_complete(uuid)', 'execute');
    r := r || format('A2 %s the new function: one, open to no API role (%s), definer + pinned (%s); the 3 callable replaced ones keep signed-in only (%s of 3); the helper stays closed=%s',
      case when n3 = 1 and n = 0 and n2 = 1 and i = 3 and bl then 'ok' else 'FAIL' end, n, n2, i, bl) || E'\n';
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace
      and ((p.proname = 'tier1_start_test' and md5(pg_get_functiondef(p.oid)) = 'f665ab3d64de036663309f6a590ee7de')
        or (p.proname = 'tier1_grant_subject' and md5(pg_get_functiondef(p.oid)) = '72ec360d8662fe5720f1a27d29f79336')
        or (p.proname = 'tier1_academic_ok' and md5(pg_get_functiondef(p.oid)) = '69e54d5ef9754ce84750dc448a3fce65')
        or (p.proname = 'tier1_submit_test' and md5(pg_get_functiondef(p.oid)) = '4528026434732a9ac2e7d4e099e78d12')
        or (p.proname = 'tier1_submit_academic_record' and md5(pg_get_functiondef(p.oid)) = 'aac0012351e804b4bb41492b30954f79'));
    r := r || format('A3 %s five Tier 1 functions the migration must not touch are byte-identical to the dev text: %s of 5', case when n = 5 then 'ok' else 'FAIL' end, n) || E'\n';
  exception when others then
    reset role;
    r := r || 'A ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ B. the documents route, start to finish (tutor ta: Mathematics 75%) ======================================
  begin
    j := pg_temp.status(ta, 'Mathematics');
    r := r || format('B1 %s fresh tutor: route=%s, can_start=%s, verified=%s, min=%s, reason "%s"',
      case when j ->> 'route' = 'documents' and j ->> 'can_start' = 'false' and j ->> 'subject_verified' = 'false' and (j ->> 'min_pct')::numeric = 70
                and j ->> 'reason' = 'First, Tutorlage needs to check a record showing at least 70% in Mathematics.' then 'ok' else 'FAIL' end,
      j ->> 'route', j ->> 'can_start', j ->> 'subject_verified', j ->> 'min_pct', left(j ->> 'reason', 40)) || E'\n';
    ra := pg_temp.record(ta, 'Mathematics', 75);
    m := pg_temp.expect_err(ta, format('select public.admin_check_tier1_record(%L, ''verified'', %L)::text', ra, 'A long enough note about the check'), 'Admins only');
    m := m || pg_temp.expect_err(ad, format('select public.admin_check_tier1_record(%L, ''verified'', null)::text', ra), 'Write down what you checked');
    m := m || pg_temp.expect_err(ad, format('select public.admin_check_tier1_record(%L, ''verified'', %L)::text', ra, 'looks fine'), 'Write down what you checked');
    m := m || pg_temp.expect_err(ad, format('select public.admin_check_tier1_record(%L, ''rejected'', '''')::text', ra), 'Say why it isn''t accepted');
    select status into t from tier1_academic_records where id = ra;
    r := r || format('B2 %s a tutor can''t verify; an admin can''t verify with no note or a note under 20 characters; a rejection still needs its reason; record still %s',
      case when m = '' and t = 'pending' then 'ok' else 'FAIL' end, t) || m || E'\n';
    t := pg_temp.verify(ad, ra, 'Checked: original statement; name matches the ID; school subject; mark and year read from it.');
    j := pg_temp.status(ta, 'Mathematics');
    r := r || format('B3 %s record verified with a written note (%s); the subject is NOT verified yet (no Module 7): verified=%s, competency=%s, reason "%s"',
      case when t = 'OK:' and j ->> 'academic_ok' = 'true' and j ->> 'subject_verified' = 'false' and pg_temp.comp(ta, 'Mathematics') = 'none'
                and j ->> 'reason' = 'Next, finish Module 7 (safeguarding) and agree to the code of conduct.' then 'ok' else 'FAIL' end,
      t, j ->> 'subject_verified', pg_temp.comp(ta, 'Mathematics'), left(j ->> 'reason', 30)) || E'\n';
    j := pg_temp.check7(ta, v_bad);
    j2 := pg_temp.check7(ta, v_good);
    r := r || format('B4 %s Module 7: wrong answers pass=%s; all right but no agreement: pass=%s, conduct=%s, subjects verified=%s, competency=%s',
      case when j ->> 'passed' = 'false' and j2 ->> 'passed' = 'true' and j2 ->> 'conduct_accepted' = 'false' and (j2 ->> 'subjects_verified')::int = 0 and pg_temp.comp(ta, 'Mathematics') = 'none' then 'ok' else 'FAIL' end,
      j ->> 'passed', j2 ->> 'passed', j2 ->> 'conduct_accepted', j2 ->> 'subjects_verified', pg_temp.comp(ta, 'Mathematics')) || E'\n';
    j := pg_temp.check7(ta, v_good || '{"conduct": true}'::jsonb);
    select conduct_accepted_at into ts1 from tier1_training where tutor_id = ta and module = 7;
    j2 := pg_temp.status(ta, 'Mathematics');
    r := r || format('B5 %s all right and agreed: conduct=%s, subjects verified=%s, competency=%s (mark 75 < 80: top grade capped to Grade 10); status verified=%s, reason "%s"',
      case when j ->> 'passed' = 'true' and j ->> 'conduct_accepted' = 'true' and (j ->> 'subjects_verified')::int = 1 and pg_temp.comp(ta, 'Mathematics') = 'verified|Grade 8|Grade 10'
                and j2 ->> 'subject_verified' = 'true' and j2 ->> 'safeguarding_done' = 'true' and j2 ->> 'conduct_accepted' = 'true'
                and left(j2 ->> 'reason', 25) = 'Your results are checked ' then 'ok' else 'FAIL' end,
      j ->> 'conduct_accepted', j ->> 'subjects_verified', pg_temp.comp(ta, 'Mathematics'), j2 ->> 'subject_verified', left(j2 ->> 'reason', 25)) || E'\n';
    update tier1_training set conduct_accepted_at = now() - interval '2 days' where tutor_id = ta and module = 7;
    select conduct_accepted_at into ts1 from tier1_training where tutor_id = ta and module = 7;
    j := pg_temp.check7(ta, v_good);
    select conduct_accepted_at into ts2 from tier1_training where tutor_id = ta and module = 7;
    r := r || format('B6 %s a later check without the tick keeps the agreement and its original time (unchanged=%s, still in the past=%s, conduct=%s); the already verified subject is not touched (grants %s)',
      case when ts1 is not null and ts1 = ts2 and ts2 < now() and j ->> 'conduct_accepted' = 'true' and (j ->> 'subjects_verified')::int = 0 then 'ok' else 'FAIL' end,
      ts1 = ts2, ts2 < now(), j ->> 'conduct_accepted', j ->> 'subjects_verified') || E'\n';
    select count(*) into n from admin_audit_logs where target_entity_id = ra and action::text = 'tier1_record_checked' and metadata ->> 'subjects_verified' = '0';
    r := r || format('B7 %s the audit line of the check carries the number of subjects it verified (the verified-but-no-Module-7 check wrote 0: %s line)', case when n = 1 then 'ok' else 'FAIL' end, n) || E'\n';
  exception when others then
    reset role;
    r := r || 'B ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ C. the order does not matter, the mark decides the range, and what is left alone ===========================
  begin
    -- tb: record first (85%), Module 7 after
    rb := pg_temp.record(tb, 'Mathematics', 85);
    t := pg_temp.verify(ad, rb, 'Checked: original statement; name matches the ID; school subject; mark and year read from it.');
    n := (pg_temp.check7(tb, v_good || '{"conduct": true}'::jsonb) ->> 'subjects_verified')::int;
    r := r || format('C1 %s mark 85, record checked BEFORE Module 7: the Module 7 check verifies it (%s subject), full range: %s',
      case when n = 1 and pg_temp.comp(tb, 'Mathematics') = 'verified|Grade 8|Grade 12' then 'ok' else 'FAIL' end, n, pg_temp.comp(tb, 'Mathematics')) || E'\n';
    -- tc: 65% verified, then Module 7: nothing
    rc := pg_temp.record(tc, 'Mathematics', 65);
    t := pg_temp.verify(ad, rc, 'Checked: original statement; name matches the ID; school subject; mark and year read from it.');
    n := (pg_temp.check7(tc, v_good || '{"conduct": true}'::jsonb) ->> 'subjects_verified')::int;
    j := pg_temp.status(tc, 'Mathematics');
    r := r || format('C2 %s mark 65 (under 70) is checked and Module 7 passed: nothing verified (%s), competency=%s, academic_ok=%s',
      case when n = 0 and pg_temp.comp(tc, 'Mathematics') = 'none' and j ->> 'academic_ok' = 'false' then 'ok' else 'FAIL' end, n, pg_temp.comp(tc, 'Mathematics'), j ->> 'academic_ok') || E'\n';
    -- td: already verified (the old self-mark), Grade 11 to 12: left exactly as it is
    insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
      values (td, 'Mathematics', 'caps', 'Grade 11', 'Grade 12', 'verified');
    rd := pg_temp.record(td, 'Mathematics', 75);
    t := pg_temp.verify(ad, rd, 'Checked: original statement; name matches the ID; school subject; mark and year read from it.');
    n := (pg_temp.check7(td, v_good || '{"conduct": true}'::jsonb) ->> 'subjects_verified')::int;
    r := r || format('C3 %s a subject that was already verified (Grade 11 to 12, mark 75) is left exactly as it is: grants %s, competency=%s',
      case when n = 0 and pg_temp.comp(td, 'Mathematics') = 'verified|Grade 11|Grade 12' then 'ok' else 'FAIL' end, n, pg_temp.comp(td, 'Mathematics')) || E'\n';
    -- te: a pending row Grade 11 to 12 and mark 75: verified, both ends capped
    insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
      values (te, 'Mathematics', 'caps', 'Grade 11', 'Grade 12', 'pending');
    re := pg_temp.record(te, 'Mathematics', 75);
    t := pg_temp.verify(ad, re, 'Checked: original statement; name matches the ID; school subject; mark and year read from it.');
    n := (pg_temp.check7(te, v_good || '{"conduct": true}'::jsonb) ->> 'subjects_verified')::int;
    r := r || format('C4 %s a pending row the tutor added themselves (Grade 11 to 12, mark 75) becomes verified and is capped at both ends: %s',
      case when n = 1 and pg_temp.comp(te, 'Mathematics') = 'verified|Grade 10|Grade 10' then 'ok' else 'FAIL' end, pg_temp.comp(te, 'Mathematics')) || E'\n';
    -- tg: two subjects, one of them closed before Module 7
    rg1 := pg_temp.record(tg, 'Mathematics', 90);
    rg2 := pg_temp.record(tg, 'Life Sciences', 90);
    t := pg_temp.verify(ad, rg1, 'Checked: original statement; name matches the ID; school subject; mark and year read from it.');
    t := pg_temp.verify(ad, rg2, 'Checked: original statement; name matches the ID; school subject; mark and year read from it.');
    update tier1_subjects set status = 'closed' where subject_name = 'Life Sciences';
    n := (pg_temp.check7(tg, v_good || '{"conduct": true}'::jsonb) ->> 'subjects_verified')::int;
    update tier1_subjects set status = 'evidence_gathering' where subject_name = 'Life Sciences';
    r := r || format('C5 %s two checked records, one subject closed: only the open one is verified (grants %s): Mathematics=%s, Life Sciences=%s',
      case when n = 1 and pg_temp.comp(tg, 'Mathematics') = 'verified|Grade 8|Grade 12' and pg_temp.comp(tg, 'Life Sciences') = 'none' then 'ok' else 'FAIL' end,
      n, pg_temp.comp(tg, 'Mathematics'), pg_temp.comp(tg, 'Life Sciences')) || E'\n';
    -- ti: the ceiling switched off by the setting
    update system_settings set setting_value = '"Grade 12"'::jsonb where setting_key = 'tier1_documents_narrow_max_grade';
    ri := pg_temp.record(ti, 'Mathematics', 75);
    t := pg_temp.verify(ad, ri, 'Checked: original statement; name matches the ID; school subject; mark and year read from it.');
    n := (pg_temp.check7(ti, v_good || '{"conduct": true}'::jsonb) ->> 'subjects_verified')::int;
    update system_settings set setting_value = '"Grade 10"'::jsonb where setting_key = 'tier1_documents_narrow_max_grade';
    r := r || format('C6 %s the ceiling set to Grade 12 switches the cap off: mark 75 gets %s', case when n = 1 and pg_temp.comp(ti, 'Mathematics') = 'verified|Grade 8|Grade 12' then 'ok' else 'FAIL' end, pg_temp.comp(ti, 'Mathematics')) || E'\n';
  exception when others then
    reset role;
    r := r || 'C ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ D. who may do what =========================================================================================
  begin
    m := pg_temp.expect_err(ls, format('select public.tier1_submit_module_check(%L::jsonb)::text', v_good::text), 'Only tutor accounts');
    m := m || pg_temp.expect_err(ls, 'select public.tier1_status(''Mathematics'')::text', 'Only tutor accounts');
    m := m || pg_temp.expect_err(ta, format('select public.tier1_grant_documents(%L)::text', ta), 'permission denied');
    m := m || pg_temp.expect_err(ad, format('select public.tier1_grant_documents(%L)::text', ta), 'permission denied');
    m := m || pg_temp.expect_err(null, format('select public.tier1_grant_documents(%L)::text', ta), 'permission denied', 'service_role');
    m := m || pg_temp.expect_err(null, 'select public.tier1_status(''Mathematics'')::text', 'permission denied', 'anon');
    m := m || pg_temp.expect_err(null, format('select public.admin_check_tier1_record(%L, ''verified'', %L)::text', ra, 'A long enough note about the check'), 'permission denied', 'anon');
    r := r || 'D1 ' || case when m = '' then 'ok' else 'FAIL' end || ' a learner can''t use the route; nobody (tutor, admin, server key) can call the grant helper; signed-out is refused the status and the admin check' || m || E'\n';
    select count(*) into n from tier1_training where tutor_id = ls;
    r := r || format('D2 %s the refused learner left no training row (%s)', case when n = 0 then 'ok' else 'FAIL' end, n) || E'\n';
  exception when others then
    reset role;
    r := r || 'D ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ E. the full route is still the old route ("test later") ====================================================
  begin
    update system_settings set setting_value = '"full"'::jsonb where setting_key = 'tier1_route';
    rh := pg_temp.record(th, 'Mathematics', 75);
    t := pg_temp.verify(ad, rh, null);
    j := pg_temp.check7(th, v_good || '{"conduct": true}'::jsonb);
    j2 := pg_temp.status(th, 'Mathematics');
    r := r || format('E1 %s full route: an admin may accept with no note (%s); Module 7 + agreement verify nothing (grants %s, competency %s); route=%s, training_complete=%s, reason "%s"',
      case when t = 'OK:' and (j ->> 'subjects_verified')::int = 0 and pg_temp.comp(th, 'Mathematics') = 'none' and j2 ->> 'route' = 'full' and j2 ->> 'training_complete' = 'false'
                and j2 ->> 'reason' = 'First, finish the training: all seven modules.' then 'ok' else 'FAIL' end,
      t, j ->> 'subjects_verified', pg_temp.comp(th, 'Mathematics'), j2 ->> 'route', j2 ->> 'training_complete', left(j2 ->> 'reason', 36)) || E'\n';
    perform pg_temp.call_as(th, 'select public.tier1_complete_module(1::smallint)::text');
    perform pg_temp.call_as(th, 'select public.tier1_complete_module(3::smallint)::text');
    perform pg_temp.call_as(th, 'select public.tier1_complete_module(4::smallint)::text');
    perform pg_temp.call_as(th, 'select public.tier1_complete_module(6::smallint)::text');
    j2 := pg_temp.status(th, 'Mathematics');
    r := r || format('E2 %s full route: the two live modules are still needed (training_complete=%s, can_start=%s)', case when j2 ->> 'training_complete' = 'false' and j2 ->> 'can_start' = 'false' then 'ok' else 'FAIL' end, j2 ->> 'training_complete', j2 ->> 'can_start') || E'\n';
    perform pg_temp.call_as(ad, format('select public.admin_record_tier1_signoff(%L, 2::smallint, ''Trainer One'', ''pass'', null)::text', th));
    perform pg_temp.call_as(ad, format('select public.admin_record_tier1_signoff(%L, 5::smallint, ''Trainer One'', ''pass'', null)::text', th));
    j2 := pg_temp.status(th, 'Mathematics');
    r := r || format('E3 %s full route, all seven modules and the record: training_complete=%s, can_start=%s (the test is offered), competency still %s until the test is passed',
      case when j2 ->> 'training_complete' = 'true' and j2 ->> 'can_start' = 'true' and pg_temp.comp(th, 'Mathematics') = 'none' then 'ok' else 'FAIL' end, j2 ->> 'training_complete', j2 ->> 'can_start', pg_temp.comp(th, 'Mathematics')) || E'\n';
    update system_settings set setting_value = '"documents"'::jsonb where setting_key = 'tier1_route';
    j2 := pg_temp.status(th, 'Mathematics');
    r := r || format('E4 %s the route read back from the setting: documents again gives route=%s', case when j2 ->> 'route' = 'documents' then 'ok' else 'FAIL' end, j2 ->> 'route') || E'\n';
  exception when others then
    reset role;
    r := r || 'E ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ the report: this suite's lines, then any earlier suite's ===================================================
  old_report := coalesce(current_setting('test.report', true), '');
  select count(*) filter (where l ~ 'FAIL' or l ~ 'ERROR'), count(*) into nfail, nlines from regexp_split_to_table(r, E'\n') as x(l) where l <> '';
  select string_agg(case when l ~ 'FAIL' or l ~ 'ERROR' then left(l, 330) else left(l, 90) end, E'\n' order by o) into rep
    from regexp_split_to_table(r, E'\n') with ordinality as x(l, o) where l <> '';
  rep := format(E'TIER 1 BY DOCUMENTS TEST (rolled back): %s FAIL/ERROR line(s) in %s lines\n%s', nfail, nlines, rep);
  if coalesce(current_setting('test.runner', true), '') = 'on' then
    perform set_config('test.report', rep, true);
  else
    raise exception E'%', rep;
  end if;
end $$;
