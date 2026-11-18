-- Rolled-back test of migration 20261118140000_module7_before_subject_approval.sql (which needs 20261118130000 first) (road to P5 item 7; 18 Nov 2026).
-- Before the apply, run both in ONE rolled-back statement, migration first:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/module7_subject_approval.sql supabase/migrations/20261118130000_teaching_credential_approves_subjects.sql supabase/migrations/20261118140000_module7_before_subject_approval.sql
-- After the apply, paste this file alone. Fixtures are made-up people (example.invalid); nothing real is touched; the block ends with `raise exception` so nothing is kept.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  uid text := replace(gen_random_uuid()::text, '-', '');
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  adult text := (v_today - interval '30 years')::date::text;
  v_off uuid := gen_random_uuid();
  v_ta uuid := gen_random_uuid();   -- no Module 7 at all
  v_tb uuid := gen_random_uuid();   -- Module 7 done, code of conduct NOT accepted
  v_tc uuid := gen_random_uuid();   -- Module 7 done and code accepted
  v_td uuid := gen_random_uuid();   -- no Module 7, subject to be rejected
  v_tx uuid := gen_random_uuid();   -- exempt through a LIST ROW, linked to the account later
  v_ty uuid := gen_random_uuid();   -- exempt through a direct grant, then the date passes
  v_tz uuid := gen_random_uuid();   -- never exempt
  v_sup uuid := gen_random_uuid();  -- a support agent (not an officer)
  v_ca uuid; v_cb uuid; v_cc uuid; v_cd uuid; v_ce uuid; v_cx uuid; v_cy uuid; v_cz uuid; v_list uuid;
  v_tag text := 'zz-m7-' || replace(gen_random_uuid()::text, '-', '');
  v_cur text;
  v_crit uuid[];
  v_m7 constant text := 'This tutor has not finished Module 7 and accepted the Tutor Code of Conduct yet, so a subject cannot be approved.';
  t text; n int; nfail int; nlines int;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
               || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
      $f$ $mk$;
    execute $mk$
      create function pg_temp.run_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
      declare v text;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true);
        set local role authenticated;
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
      create function pg_temp.mkcomp(p_tutor uuid, p_cur text, p_subject text default 'Mathematics') returns uuid language plpgsql as $f$
      declare v uuid;
      begin
        insert into public.tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level)
        values (p_tutor, p_subject, p_cur::public.curriculum_type, 'Grade 8', 'Grade 12') returning id into v;
        return v;
      end $f$ $mk$;

    select k.curriculum::text into v_cur from public.curriculum_criteria k where k.active order by k.curriculum limit 1;
    select coalesce(array_agg(k.id), '{}') into v_crit from public.curriculum_criteria k where k.curriculum::text = v_cur and k.active;
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_off, z, 'authenticated', 'authenticated', 'm7.o.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Vic', 'surname', 'Officer', 'date_of_birth', adult), '{}'),
      (v_ta, z, 'authenticated', 'authenticated', 'm7.a.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Ana', 'surname', 'A', 'date_of_birth', adult), '{}'),
      (v_tb, z, 'authenticated', 'authenticated', 'm7.b.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Ben', 'surname', 'B', 'date_of_birth', adult), '{}'),
      (v_tc, z, 'authenticated', 'authenticated', 'm7.c.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Cat', 'surname', 'C', 'date_of_birth', adult), '{}'),
      (v_td, z, 'authenticated', 'authenticated', 'm7.d.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Dan', 'surname', 'D', 'date_of_birth', adult), '{}');
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active)
      values (v_off, 'Vic', 'Officer', 'm7.o.' || uid || '@example.invalid', '', 'verification_officer', true);
    insert into public.tier1_training (tutor_id, module, result, method, conduct_accepted_at) values (v_tb, 7, 'complete', 'scenario_check', null), (v_tc, 7, 'complete', 'scenario_check', now());
    v_ca := pg_temp.mkcomp(v_ta, v_cur); v_cb := pg_temp.mkcomp(v_tb, v_cur); v_cc := pg_temp.mkcomp(v_tc, v_cur); v_cd := pg_temp.mkcomp(v_td, v_cur);
    r := r || format('S0 setup: officer + 4 tutors (none / Module 7 without the code / Module 7 and the code / none, to be rejected), curriculum "%s" with %s checklist items; route setting "%s"',
      v_cur, coalesce(array_length(v_crit, 1), 0), (select setting_value #>> '{}' from system_settings where setting_key = 'tier1_route')) || E'\n';

    t := pg_temp.run_as(v_off, format('select public.admin_review_tutor_subject(%L::uuid, %L, %L, %L::uuid[])::text', v_ca, 'approve', 'zz checked', v_crit::text));
    r := r || pg_temp.chk('M1', 'no Module 7: approving a subject is refused', t, 'ERR: ' || v_m7);
    r := r || pg_temp.chk('M1b', 'and the subject stays as it was', (select verification_status::text from tutor_subject_competencies where id = v_ca), 'pending');
    t := pg_temp.run_as(v_off, format('select public.admin_review_tutor_subject(%L::uuid, %L, %L, %L::uuid[])::text', v_cb, 'approve', 'zz checked', v_crit::text));
    r := r || pg_temp.chk('M2', 'Module 7 done but the code of conduct not accepted: refused', t, 'ERR: ' || v_m7);
    t := pg_temp.run_as(v_off, format('select public.admin_review_tutor_subject(%L::uuid, %L, %L, %L::uuid[])::text', v_cc, 'approve', 'zz checked', v_crit::text));
    r := r || pg_temp.chk('M3', 'Module 7 done and the code accepted: approved', t, '');
    r := r || pg_temp.chk('M3b', 'and the subject is verified', (select verification_status::text from tutor_subject_competencies where id = v_cc), 'verified');
    t := pg_temp.run_as(v_off, format('select public.admin_review_tutor_subject(%L::uuid, %L, %L, %L::uuid[])::text', v_cd, 'reject', 'not enough evidence', '{}'));
    r := r || pg_temp.chk('M4', 'a rejection does not need Module 7', t, '');
    r := r || pg_temp.chk('M4b', 'and the subject is rejected', (select verification_status::text from tutor_subject_competencies where id = v_cd), 'rejected');
    t := pg_temp.run_as(v_ta, format('select public.admin_review_tutor_subject(%L::uuid, %L, %L, %L::uuid[])::text', v_ca, 'approve', 'self', v_crit::text));
    r := r || pg_temp.chk('M5', 'a tutor cannot approve their own subject (still "Admins only")', t, 'ERR: Admins only');
    -- the full route (all modules) is still stricter: Module 7 alone is not enough while the setting says so
    update system_settings set setting_value = to_jsonb('full'::text) where setting_key = 'tier1_route';
    v_ce := pg_temp.mkcomp(v_tc, v_cur, 'Physical Sciences');
    t := pg_temp.run_as(v_off, format('select public.admin_review_tutor_subject(%L::uuid, %L, %L, %L::uuid[])::text', v_ce, 'approve', 'zz checked', v_crit::text));
    r := r || pg_temp.chk('M6', 'with the setting tier1_route = full, Module 7 alone is not enough (the function follows the setting)', t, 'ERR: ' || v_m7);
    update system_settings set setting_value = to_jsonb('documents'::text) where setting_key = 'tier1_route';
    t := pg_temp.run_as(v_off, format('select public.admin_review_tutor_subject(%L::uuid, %L, %L, %L::uuid[])::text', v_ce, 'approve', 'zz checked', v_crit::text));
    r := r || pg_temp.chk('M6b', 'back on the documents route the same tutor is approved', t, '');
    select (position('tier1_training_complete' in pg_get_functiondef('public.subject_approval_blocker(uuid)'::regprocedure)) > 0)::text || '/' || ((length(d) - length(replace(d, 'subject_approval_blocker(c.tutor_id)', ''))) / length('subject_approval_blocker(c.tutor_id)'))::text into t from (select pg_get_functiondef('public.admin_review_tutor_subject(uuid, text, text, uuid[])'::regprocedure) d) x;
    r := r || pg_temp.chk('M7', 'the Module 7 rule lives in the one shared blocker, and the checklist route asks it (twice in its text: the test and the message)', t, 'true/2');
    -- the teaching-credential route obeys the same rule (a verified credential and document, but no Module 7: refused; with Module 7 and the code: approved)
    update system_settings set setting_value = to_jsonb('documents'::text) where setting_key = 'tier1_route';
    insert into public.tutor_verification_documents (tutor_id, document_type, document_url, status) values (v_ta, 'teaching_qualification', 'fixture/' || v_ta, 'verified');
    insert into public.tutor_credentials (tutor_id, credential_code, document_id, status, obtained_on, verified_by, verified_at)
      select v_ta, 'sace_registered_teacher', d.id, 'verified', current_date, v_off, now() from public.tutor_verification_documents d where d.tutor_id = v_ta and d.document_type = 'teaching_qualification';
    t := pg_temp.run_as(v_off, format('select public.admin_approve_subjects_on_credential(%L::uuid)::text', v_ta));
    r := r || pg_temp.chk('M9', 'a teacher with a verified credential but no Module 7: the credential route is refused too', t, 'ERR: ' || v_m7);
    insert into public.tier1_training (tutor_id, module, result, method, conduct_accepted_at) values (v_ta, 7, 'complete', 'scenario_check', now());
    t := pg_temp.run_as(v_off, format('select (public.admin_approve_subjects_on_credential(%L::uuid)->>%L)', v_ta, 'approved'));
    r := r || pg_temp.chk('M9b', 'once Module 7 and the code are done, the same press approves the claimed subject', t, '1');
    r := r || pg_temp.chk('M8', 'who may run it did not change (signed-in only; the admin check is inside)',
      has_function_privilege('anon', 'public.admin_review_tutor_subject(uuid, text, text, uuid[])', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.admin_review_tutor_subject(uuid, text, text, uuid[])', 'execute')::text, 'false/true');
    -- ===== THE TEMPORARY EXEMPTION (CEO order 18 Nov: Odi, Amree, Amira while they set up their accounts) =====
    update system_settings set setting_value = to_jsonb('documents'::text) where setting_key = 'tier1_route';
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_sup, z, 'authenticated', 'authenticated', 'm7.s.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Sue', 'surname', 'Support', 'date_of_birth', adult), '{}'),
      (v_tx, z, 'authenticated', 'authenticated', 'm7.x.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Xia', 'surname', 'X', 'date_of_birth', adult), '{}'),
      (v_ty, z, 'authenticated', 'authenticated', 'm7.y.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Yan', 'surname', 'Y', 'date_of_birth', adult), '{}'),
      (v_tz, z, 'authenticated', 'authenticated', 'm7.z.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zed', 'surname', 'Z', 'date_of_birth', adult), '{}');
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active)
      values (v_sup, 'Sue', 'Support', 'm7.s.' || uid || '@example.invalid', '', 'support_agent', true);
    v_cx := pg_temp.mkcomp(v_tx, v_cur); v_cy := pg_temp.mkcomp(v_ty, v_cur); v_cz := pg_temp.mkcomp(v_tz, v_cur);
    -- a list row for a person whose account does not exist yet (like ceo-odi)
    insert into public.founding_tutors_list (source, full_name, code_name, whatsapp, email, email_key, src, status)
      values ('form', 'Xia Xtest', 'Zz', '+27820000000', 'm7.x.' || uid || '@example.invalid', 'm7.x.' || uid || '@example.invalid', v_tag, 'joined') returning id into v_list;
    r := r || pg_temp.chk('E0', 'setup: 3 more tutors, a support agent, and a list row with no account', (select count(*)::text from public.module7_exemptions), '0');

    t := pg_temp.run_as(v_off, format('select (public.admin_grant_module7_exemption(p_list_src => %L))->>%L', v_tag, 'target'));
    r := r || pg_temp.chk('E1', 'an officer grants the exemption by LIST TAG before the account exists (default 30 days)', t, 'list_row');
    r := r || pg_temp.chk('E1b', 'it is stored against the list row, 30 days out, with a default reason',
      (select (e.tutor_id is null)::text || '/' || round(extract(epoch from (e.ends_at - now())) / 86400)::text || '/' || (e.reason like 'Temporary exemption%')::text from public.module7_exemptions e where e.list_row_id = v_list), 'true/30/true');
    r := r || pg_temp.chk('E1c', 'an audit event was written', (select count(*)::text from admin_audit_logs a where a.target_entity_id = v_list and a.metadata ->> 'kind' = 'module7_exemption_granted'), '1');
    t := pg_temp.run_as(v_off, format('select public.admin_review_tutor_subject(%L::uuid, %L, %L, %L::uuid[])::text', v_cx, 'approve', 'zz checked', v_crit::text));
    r := r || pg_temp.chk('E2', 'before the account is linked to the row, the tutor is still blocked', t, 'ERR: ' || v_m7);
    update public.founding_tutors_list set user_id = v_tx where id = v_list;   -- the account is made and linked (what sign-up or the seeding step does)
    t := pg_temp.run_as(v_off, format('select public.admin_review_tutor_subject(%L::uuid, %L, %L, %L::uuid[])::text', v_cx, 'approve', 'zz checked', v_crit::text));
    r := r || pg_temp.chk('E3', 'once linked, the checklist route approves a subject WITHOUT Module 7', t, '');
    r := r || pg_temp.chk('E3b', 'and the subject is verified', (select verification_status::text from tutor_subject_competencies where id = v_cx), 'verified');
    r := r || pg_temp.chk('E4', 'a tutor who is not exempt is still refused (exemption is per person)',
      pg_temp.run_as(v_off, format('select public.admin_review_tutor_subject(%L::uuid, %L, %L, %L::uuid[])::text', v_cz, 'approve', 'zz checked', v_crit::text)), 'ERR: ' || v_m7);

    -- direct grant, 14 days, on the teaching-credential route
    t := pg_temp.run_as(v_off, format('select (public.admin_grant_module7_exemption(p_tutor => %L::uuid, p_days => 14, p_reason => %L))->>%L', v_ty, 'zz set up', 'target'));
    r := r || pg_temp.chk('E5', 'a direct grant to an existing tutor for 14 days', t, 'tutor');
    r := r || pg_temp.chk('E5b', 'the end date is 14 days out and the reason is kept', (select round(extract(epoch from (e.ends_at - now())) / 86400)::text || '/' || e.reason from public.module7_exemptions e where e.tutor_id = v_ty), '14/zz set up');
    insert into public.tutor_verification_documents (tutor_id, document_type, document_url, status) values (v_ty, 'teaching_qualification', 'fixture/' || v_ty, 'verified');
    insert into public.tutor_credentials (tutor_id, credential_code, document_id, status, obtained_on, verified_by, verified_at)
      select v_ty, 'sace_registered_teacher', d.id, 'verified', current_date, v_off, now() from public.tutor_verification_documents d where d.tutor_id = v_ty and d.document_type = 'teaching_qualification';
    t := pg_temp.run_as(v_off, format('select (public.admin_approve_subjects_on_credential(%L::uuid)->>%L)', v_ty, 'approved'));
    r := r || pg_temp.chk('E6', 'the teaching-credential route also approves an exempt tutor without Module 7', t, '1');
    r := r || pg_temp.chk('E7', 'the admin page read: active, with an end date', (select (a ->> 'active') || '/' || ((a ->> 'ends_at') is not null)::text || '/' || (a ->> 'granted_via') from (select pg_temp.run_as(v_sup, format('select public.admin_module7_exemption(%L::uuid)::text', v_ty))::jsonb a) q), 'true/true/admin');
    r := r || pg_temp.chk('E7b', 'the list-row exemption shows on the linked account too', (select (a ->> 'active') from (select pg_temp.run_as(v_sup, format('select public.admin_module7_exemption(%L::uuid)::text', v_tx))::jsonb a) q), 'true');
    r := r || pg_temp.chk('E7c', 'a tutor with none reads null', pg_temp.run_as(v_sup, format('select public.admin_module7_exemption(%L::uuid)::text', v_tz)), 'null');

    -- adjust (grant again replaces the end date), then the date passes
    perform pg_temp.run_as(v_off, format('select public.admin_grant_module7_exemption(p_tutor => %L::uuid, p_days => 3)::text', v_ty));
    r := r || pg_temp.chk('E8', 'granting again adjusts the end date (3 days) and keeps ONE row', (select round(extract(epoch from (e.ends_at - now())) / 86400)::text || '/' || (select count(*) from public.module7_exemptions x where x.tutor_id = v_ty)::text from public.module7_exemptions e where e.tutor_id = v_ty), '3/1');
    update public.module7_exemptions set ends_at = now() - interval '1 second' where tutor_id = v_ty;
    v_cy := pg_temp.mkcomp(v_ty, v_cur, 'Physical Sciences');
    t := pg_temp.run_as(v_off, format('select public.admin_review_tutor_subject(%L::uuid, %L, %L, %L::uuid[])::text', v_cy, 'approve', 'zz checked', v_crit::text));
    r := r || pg_temp.chk('E9', 'after the end date a NEW subject approval is refused again (checklist route)', t, 'ERR: ' || v_m7);
    t := pg_temp.run_as(v_off, format('select (public.admin_approve_subjects_on_credential(%L::uuid)->>%L)', v_ty, 'approved'));
    r := r || pg_temp.chk('E9b', '... and on the teaching-credential route', t, 'ERR: ' || v_m7);
    r := r || pg_temp.chk('E9c', 'the page read now says not active', (select (a ->> 'active') from (select pg_temp.run_as(v_sup, format('select public.admin_module7_exemption(%L::uuid)::text', v_ty))::jsonb a) q), 'false');
    t := pg_temp.run_as(v_off, format('select public.admin_review_tutor_subject(%L::uuid, %L, %L, %L::uuid[])::text', v_cy, 'reject', 'not enough evidence', '{}'));
    r := r || pg_temp.chk('E9d', 'a rejection is never blocked, exemption or not', t, '');

    -- who may set it
    r := r || pg_temp.chk('E10', 'a tutor cannot grant it to themself', pg_temp.run_as(v_tz, format('select public.admin_grant_module7_exemption(p_tutor => %L::uuid)::text', v_tz)), 'ERR: Admins only');
    r := r || pg_temp.chk('E10b', 'a tutor cannot read the table', pg_temp.run_as(v_tz, 'select count(*)::text from public.module7_exemptions'), 'ERR: permission denied for table module7_exemptions');
    r := r || pg_temp.chk('E10c', 'a tutor cannot read the page function either', pg_temp.run_as(v_tz, format('select public.admin_module7_exemption(%L::uuid)::text', v_tz)), 'ERR: Admins only');
    r := r || pg_temp.chk('E10d', 'a support agent cannot grant it', pg_temp.run_as(v_sup, format('select public.admin_grant_module7_exemption(p_tutor => %L::uuid)::text', v_tz)), 'ERR: Only a verification officer or a super admin can set this');
    r := r || pg_temp.chk('E10e', 'a support agent cannot end it', pg_temp.run_as(v_sup, format('select public.admin_end_module7_exemption(p_tutor => %L::uuid)::text', v_tx)), 'ERR: Only a verification officer or a super admin can set this');
    r := r || pg_temp.chk('E10f', 'signed out cannot call it (anon has no right)', has_function_privilege('anon', 'public.admin_grant_module7_exemption(uuid, text, integer, text)', 'execute')::text, 'false');
    r := r || pg_temp.chk('E10j', 'the three admin functions are not callable with the server key either (only signed-in admins)',
      has_function_privilege('service_role', 'public.admin_grant_module7_exemption(uuid, text, integer, text)', 'execute')::text || '/' || has_function_privilege('service_role', 'public.admin_end_module7_exemption(uuid, text)', 'execute')::text || '/' || has_function_privilege('service_role', 'public.admin_module7_exemption(uuid)', 'execute')::text, 'false/false/false');
    r := r || pg_temp.chk('E10g', 'the table has no right for anon, signed-in or the server key',
      has_table_privilege('anon', 'public.module7_exemptions', 'select')::text || '/' || has_table_privilege('authenticated', 'public.module7_exemptions', 'select')::text || '/' || has_table_privilege('service_role', 'public.module7_exemptions', 'select')::text, 'false/false/false');
    r := r || pg_temp.chk('E10h', 'the internal check cannot be called by signed-in users or the server key',
      has_function_privilege('authenticated', 'public.module7_exemption_active(uuid)', 'execute')::text || '/' || has_function_privilege('service_role', 'public.module7_exemption_active(uuid)', 'execute')::text, 'false/false');
    r := r || pg_temp.chk('E10i', 'the seeding function is for the server key only',
      has_function_privilege('anon', 'public.founding_grant_module7_exemption(text, integer)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.founding_grant_module7_exemption(text, integer)', 'execute')::text || '/' || has_function_privilege('service_role', 'public.founding_grant_module7_exemption(text, integer)', 'execute')::text, 'false/false/true');

    -- bad input
    r := r || pg_temp.chk('E11', 'days must be 1 to 90 (0)', pg_temp.run_as(v_off, format('select public.admin_grant_module7_exemption(p_tutor => %L::uuid, p_days => 0)::text', v_tz)), 'ERR: The exemption must be between 1 and 90 days');
    r := r || pg_temp.chk('E11b', 'days must be 1 to 90 (91)', pg_temp.run_as(v_off, format('select public.admin_grant_module7_exemption(p_tutor => %L::uuid, p_days => 91)::text', v_tz)), 'ERR: The exemption must be between 1 and 90 days');
    r := r || pg_temp.chk('E11c', 'name the tutor or the tag, not both', pg_temp.run_as(v_off, format('select public.admin_grant_module7_exemption(p_tutor => %L::uuid, p_list_src => %L)::text', v_tz, v_tag)), 'ERR: Name either the tutor or the list tag, not both and not neither');
    r := r || pg_temp.chk('E11d', 'name the tutor or the tag, not neither', pg_temp.run_as(v_off, 'select public.admin_grant_module7_exemption()::text'), 'ERR: Name either the tutor or the list tag, not both and not neither');
    r := r || pg_temp.chk('E11e', 'an unknown tag is refused', pg_temp.run_as(v_off, format('select public.admin_grant_module7_exemption(p_list_src => %L)::text', 'zz-no-such-tag')), 'ERR: No list row has the tag "zz-no-such-tag"');
    r := r || pg_temp.chk('E11f', 'an unknown tutor is refused', pg_temp.run_as(v_off, format('select public.admin_grant_module7_exemption(p_tutor => %L::uuid)::text', gen_random_uuid())), 'ERR: No such tutor');
    r := r || pg_temp.chk('E11g', 'a non-tutor (an admin) is refused', pg_temp.run_as(v_off, format('select public.admin_grant_module7_exemption(p_tutor => %L::uuid)::text', v_off)), 'ERR: No such tutor');
    r := r || pg_temp.chk('E11h', 'the non-exempt tutor still has no exemption row', (select count(*)::text from public.module7_exemptions e where e.tutor_id = v_tz), '0');

    -- the seeding step (run as the owner here; that only the server key may call it is proven by E10i): by tag for a list row with no account, then by email replaces it
    insert into public.founding_tutors_list (source, full_name, code_name, whatsapp, email, email_key, src, status)
      values ('form', 'Seed Test', 'Zz', '+27820000001', 'm7.seed.' || uid || '@example.invalid', 'm7.seed.' || uid || '@example.invalid', v_tag || '-seed', 'joined');
    r := r || pg_temp.chk('E12', 'the seeding function sets 30 days by tag', (public.founding_grant_module7_exemption(v_tag || '-seed')::jsonb ->> 'days'), '30');
    r := r || pg_temp.chk('E12b', 'and it is marked as set by the seeding step with no admin', (select e.granted_via || '/' || (e.granted_by is null)::text from public.module7_exemptions e join public.founding_tutors_list f on f.id = e.list_row_id where f.src = v_tag || '-seed'), 'seeding/true');
    perform public.founding_grant_module7_exemption('m7.seed.' || uid || '@example.invalid', 45);
    r := r || pg_temp.chk('E12c', 'by email, 45 days, replaces the same row', (select round(extract(epoch from (e.ends_at - now())) / 86400)::text || '/' || (select count(*) from public.module7_exemptions x where x.list_row_id = f.id)::text from public.module7_exemptions e join public.founding_tutors_list f on f.id = e.list_row_id where f.src = v_tag || '-seed'), '45/1');
    begin
      perform public.founding_grant_module7_exemption(v_tag || '-seed', 200);
      r := r || E'E12d seeding: 200 days accepted FAIL\n';
    exception when others then
      r := r || pg_temp.chk('E12d', 'the seeding function also caps at 90 days', sqlerrm, 'The exemption must be between 1 and 90 days');
    end;

    -- ending it by hand
    r := r || pg_temp.chk('E13', 'an officer ends the list-row exemption of the linked account now (1 row)', pg_temp.run_as(v_off, format('select public.admin_end_module7_exemption(p_tutor => %L::uuid)::text', v_tx)), '1');
    t := pg_temp.run_as(v_off, format('select public.admin_review_tutor_subject(%L::uuid, %L, %L, %L::uuid[])::text', pg_temp.mkcomp(v_tx, v_cur, 'Life Sciences'), 'approve', 'zz checked', v_crit::text));
    r := r || pg_temp.chk('E13b', 'after it is ended, a new approval for that tutor is refused', t, 'ERR: ' || v_m7);
    r := r || pg_temp.chk('E13c', 'ending it twice does nothing', pg_temp.run_as(v_off, format('select public.admin_end_module7_exemption(p_tutor => %L::uuid)::text', v_tx)), '0');
    r := r || pg_temp.chk('E14', 'a tutor who did Module 7 is unaffected (the earlier approval stays verified)', (select verification_status::text from tutor_subject_competencies where id = v_cc), 'verified');
    delete from public.founding_tutors_list where src = v_tag || '-seed';
    r := r || pg_temp.chk('E15', 'deleting a list row removes its exemption (no orphan)', (select count(*)::text from public.module7_exemptions e where e.list_row_id is not null and e.list_row_id not in (select id from public.founding_tutors_list)), '0');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
