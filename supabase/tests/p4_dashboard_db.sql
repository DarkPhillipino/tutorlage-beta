-- Rolled-back test of migration 20261123140000_dashboard_step1.sql (dashboard step 1, the database only; 23 Nov 2026). Run it TOGETHER with the migration (one statement; the last line raises, so
-- everything is undone; needs 20261123100000 and, for one count, 20261123120000 already applied) or alone after the apply. Made-up people only; nothing is kept.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  td date := (now() at time zone 'Africa/Johannesburg')::date;
  adult text := (current_date - interval '30 years')::date::text;
  uid text := replace(gen_random_uuid()::text, '-', '');
  v_off uuid := gen_random_uuid(); v_fin uuid := gen_random_uuid(); v_sup uuid := gen_random_uuid(); v_adm uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); t3 uuid := gen_random_uuid(); t4 uuid := gen_random_uuid(); lrn uuid := gen_random_uuid();
  t text; j jsonb; n int;
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
      create function pg_temp.doc(p_tutor uuid, p_type text, p_status text, p_issued date) returns void language sql as $f$
        insert into public.tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
        values (p_tutor, p_type::public.doc_type, 'fixture/' || gen_random_uuid(), p_status::public.verification_status, p_issued) $f$ $mk$;
    execute $mk$
      create function pg_temp.keys(p_j jsonb) returns text language sql as $f$ select coalesce(string_agg(k, ',' order by k), 'none') from jsonb_object_keys(p_j) k $f$ $mk$;

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_off, z, 'authenticated', 'authenticated', 'db.off.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Vic', 'surname', 'Officer', 'date_of_birth', adult), '{}'),
      (v_fin, z, 'authenticated', 'authenticated', 'db.fin.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Fin', 'surname', 'Manager', 'date_of_birth', adult), '{}'),
      (v_sup, z, 'authenticated', 'authenticated', 'db.sup.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Sam', 'surname', 'Support', 'date_of_birth', adult), '{}'),
      (t1, z, 'authenticated', 'authenticated', 'db.t1.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'One', 'date_of_birth', adult), '{}'),
      (t2, z, 'authenticated', 'authenticated', 'db.t2.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Two', 'date_of_birth', adult), '{}'),
      (t3, z, 'authenticated', 'authenticated', 'db.t3.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Three', 'date_of_birth', adult), '{}'),
      (t4, z, 'authenticated', 'authenticated', 'db.t4.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Four', 'date_of_birth', adult), '{}'),
      (lrn, z, 'authenticated', 'authenticated', 'db.lrn.' || uid || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Lee', 'date_of_birth', adult), '{}');
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
      (v_off, 'Vic', 'Officer', 'db.off.' || uid || '@example.invalid', '', 'verification_officer', true),
      (v_fin, 'Fin', 'Manager', 'db.fin.' || uid || '@example.invalid', '', 'finance_manager', true),
      (v_sup, 'Sam', 'Support', 'db.sup.' || uid || '@example.invalid', '', 'support_agent', true);

    -- A. who gets which dashboard
    r := r || pg_temp.chk('A1', 'a tutor''s widgets, in order', pg_temp.run_as(t1, $q$select (select string_agg(w->>'key', ',' order by o) from jsonb_array_elements(public.my_dashboard('tutor')->'widgets') with ordinality x(w, o))$q$), 'level_battery,verification_checklist,upcoming_sessions');
    r := r || pg_temp.chk('A2', 'a verification officer''s admin widgets', pg_temp.run_as(v_off, $q$select (select string_agg(w->>'key', ',' order by o) from jsonb_array_elements(public.my_dashboard('admin')->'widgets') with ordinality x(w, o))$q$), 'verification_board,verified_battery,numbers');
    r := r || pg_temp.chk('A3', 'a finance manager gets only the numbers', pg_temp.run_as(v_fin, $q$select (select string_agg(w->>'key', ',') from jsonb_array_elements(public.my_dashboard('admin')->'widgets') w)$q$), 'numbers');
    r := r || pg_temp.chk('A4', 'a tutor cannot open the admin board', pg_temp.run_as(t1, $q$select public.my_dashboard('admin')::text$q$), 'ERR: Not allowed');
    r := r || pg_temp.chk('A5', 'an admin who is not a tutor cannot open the tutor board', pg_temp.run_as(v_off, $q$select public.my_dashboard('tutor')::text$q$), 'ERR: Not allowed');
    r := r || pg_temp.chk('A6', 'a learner gets neither', pg_temp.run_as(lrn, $q$select public.my_dashboard('tutor')::text$q$), 'ERR: Not allowed');
    r := r || pg_temp.chk('A7', 'a signed-out caller is refused', pg_temp.run_as(null, $q$select public.my_dashboard('tutor')::text$q$), 'ERR: permission denied for function my_dashboard');
    r := r || pg_temp.chk('A8', 'an unknown board', pg_temp.run_as(t1, $q$select public.my_dashboard('x')::text$q$), 'ERR: No such dashboard');
    r := r || pg_temp.chk('B1', 'the whole tutor board in one call: each widget answers ok, the sessions widget is the screen''s own', pg_temp.run_as(t1, $q$select (d->'level_battery'->>'ok') || (d->'verification_checklist'->>'ok') || (d->'upcoming_sessions'->>'client_only') from (select public.dashboard_data('tutor') d) x$q$), 'truetruetrue');
    r := r || pg_temp.chk('B2', 'a finance manager''s call carries only the widgets that role may use', pg_temp.run_as(v_fin, $q$select pg_temp.keys(public.dashboard_data('admin'))$q$), 'numbers');
    r := r || pg_temp.chk('B3', 'a requested widget the caller may not use is simply absent', pg_temp.run_as(t1, $q$select pg_temp.keys(public.dashboard_data('tutor', array['level_battery', 'verification_board']))$q$), 'level_battery');

    -- C. the level battery (self only; no tutor id is accepted)
    update tutor_profiles set current_sub_tier_id = '1D', current_tier_id = 1 where id = t1;
    update tutor_profiles set current_sub_tier_id = '2D', current_tier_id = 2 where id = t2;
    update tutor_profiles set current_sub_tier_id = '3D', current_tier_id = 3, tier_frozen = true, freeze_reason = 'Average rating dropped below 4.70 threshold.' where id = t3;
    update tutor_profiles set current_sub_tier_id = '2B', current_tier_id = 2, credential_floor_sub_tier_id = '2B', total_completed_hours = 10 where id = t4;
    insert into tutor_prior_hours (tutor_id, hours, reason, proof_reference, added_by) values (t4, 25, 'taught three years at a school', 'letter 2024-001', v_off);
    r := r || pg_temp.chk('C1', 'from 1D the next step is 2A, across the tier', pg_temp.run_as(t1, $q$select (public.my_level_progress()->'next'->>'id') || '/' || (public.my_level_progress()->'next'->>'crosses_tier')$q$), '2A/true');
    r := r || pg_temp.chk('C2', 'from 2D the next step is 3A', pg_temp.run_as(t2, $q$select public.my_level_progress()->'next'->>'id'$q$), '3A');
    select exists (select 1 from tutor_profiles x where x.current_tier_id = 4 and x.is_verified)::text into t;
    r := r || pg_temp.chk('C3', 'from 3D there is NO next step while no verified tutor is in tier 4 (the ladder hides it)', pg_temp.run_as(t3, $q$select (public.my_level_progress()->>'top') || '/' || coalesce(public.my_level_progress()->'next'->>'id', 'none')$q$), case when t = 'true' then 'false/4A' else 'true/none' end);
    r := r || pg_temp.chk('C4', 'frozen is said, with the reason', pg_temp.run_as(t3, $q$select (public.my_level_progress()->>'frozen') || '/' || (public.my_level_progress()->>'frozen_reason')$q$), 'true/Average rating dropped below 4.70 threshold.');
    r := r || pg_temp.chk('C5', 'a level that comes from a credential is flagged', pg_temp.run_as(t4, $q$select public.my_level_progress()->>'from_credential'$q$), 'true');
    r := r || pg_temp.chk('C6', 'hours include the hours taught elsewhere (10 + 25)', pg_temp.run_as(t4, $q$select public.my_level_progress()->'hours'->>'have'$q$), '35.00');
    r := r || pg_temp.chk('C7', 'repeat rate and grade uplift are met / not met only: no number for them', pg_temp.run_as(t1, $q$select pg_temp.keys(public.my_level_progress())$q$),
      'current,from_credential,frozen,frozen_reason,hours,next,rating,repeat_rate_met,reviews,top,uplift_met');
    r := r || pg_temp.chk('C8', 'hours, rating and reviews carry have, need and met', pg_temp.run_as(t1, $q$select pg_temp.keys(public.my_level_progress()->'hours') || '|' || pg_temp.keys(public.my_level_progress()->'rating') || '|' || pg_temp.keys(public.my_level_progress()->'reviews')$q$), 'have,met,need|have,met,need|have,met,need');
    r := r || pg_temp.chk('C9', 'it takes no tutor id (the argument list is empty)', (select pg_get_function_identity_arguments('public.my_level_progress()'::regprocedure)), '');
    r := r || pg_temp.chk('C10', 'an admin or a learner gets nothing', pg_temp.run_as(v_off, $q$select public.my_level_progress()::text$q$) || '|' || pg_temp.run_as(lrn, $q$select public.my_level_progress()::text$q$), 'ERR: Not allowed|ERR: Not allowed');

    -- D. the verification checklist
    perform pg_temp.doc(t1, 'identity_doc', 'pending', null); perform pg_temp.doc(t1, 'police_clearance', 'verified', td - 30);
    r := r || pg_temp.chk('D1', 'reasons in codes, the police dates, ready false', pg_temp.run_as(t1, $q$select (public.my_verification_checklist()->>'ready') || '|' || (public.my_verification_checklist()->'police'->>'issued_on') || '|' || (public.my_verification_checklist()->'police'->>'counts_until')$q$),
      'false|' || (td - 30)::text || '|' || ((td - 30) + interval '6 months')::date::text);
    r := r || pg_temp.chk('D2', 'another tutor never sees it (it reads the caller only)', pg_temp.run_as(t2, $q$select coalesce(public.my_verification_checklist()->'police'->>'issued_on', 'none')$q$), 'none');

    -- E. the verified-tutors battery
    r := r || pg_temp.chk('E1', 'the officer reads count, target and percent', pg_temp.run_as(v_off, $q$select pg_temp.keys(public.admin_verified_battery())$q$), 'percent,target,verified');
    r := r || pg_temp.chk('E2', 'the target is the setting (10 unless changed)', pg_temp.run_as(v_off, $q$select public.admin_verified_battery()->>'target'$q$), (select case when (setting_value #>> '{}') ~ '^[0-9]+$' and (setting_value #>> '{}')::int >= 1 then (setting_value #>> '{}') else '10' end from system_settings where setting_key = 'verified_tutor_target'));
    update system_settings set setting_value = '"abc"'::jsonb where setting_key = 'verified_tutor_target';
    r := r || pg_temp.chk('E3', 'a bad setting counts as 10', pg_temp.run_as(v_off, $q$select public.admin_verified_battery()->>'target'$q$), '10');
    r := r || pg_temp.chk('E4', 'a support agent is refused', pg_temp.run_as(v_sup, $q$select public.admin_verified_battery()::text$q$), 'ERR: Only a verification officer or a super admin can see this');

    -- F. the verification board
    select count(*) into n from tutor_profiles;
    r := r || pg_temp.chk('F1', 'every tutor is in exactly one column', pg_temp.run_as(v_off, $q$select (select sum(v::int) from jsonb_each_text(public.admin_verification_board()->'counts') c(k, v))::text$q$), least(n, 300)::text);
    r := r || pg_temp.chk('F2', 'a tutor with no documents is in "nothing yet" with its reasons on the card', pg_temp.run_as(v_off, format($q$select (select (c->'reasons')::text from jsonb_array_elements(public.admin_verification_board()->'cards'->'nothing_yet') c where c->>'tutor_id' = %L)$q$, t2)), '["no_track", "identity_missing", "police_missing"]');
    r := r || pg_temp.chk('F3', 'no column shows more than 8 cards', pg_temp.run_as(v_off, $q$select (select (max(jsonb_array_length(v)) <= 8)::text from jsonb_each(public.admin_verification_board()->'cards') c(k, v))$q$), 'true');
    r := r || pg_temp.chk('F4', 'a finance manager is refused', pg_temp.run_as(v_fin, $q$select public.admin_verification_board()::text$q$), 'ERR: Only a verification officer or a super admin can see this');

    -- G. the numbers, by role, no personal data
    r := r || pg_temp.chk('G1', 'the officer sees the tutor stages and the verified count, not the money', pg_temp.run_as(v_off, $q$select (public.admin_dashboard_numbers() ? 'tutors_by_stage')::text || (public.admin_dashboard_numbers() ? 'topups_to_confirm')::text$q$), 'truefalse');
    r := r || pg_temp.chk('G2', 'finance sees the money, not the tutor stages', pg_temp.run_as(v_fin, $q$select (public.admin_dashboard_numbers() ? 'tutors_by_stage')::text || (public.admin_dashboard_numbers() ? 'topups_to_confirm')::text || (public.admin_dashboard_numbers() ? 'payouts_due')::text$q$), 'falsetruetrue');
    r := r || pg_temp.chk('G3', 'support sees neither, but the common figures', pg_temp.run_as(v_sup, $q$select (public.admin_dashboard_numbers() ? 'tutors_by_stage')::text || (public.admin_dashboard_numbers() ? 'topups_to_confirm')::text || (public.admin_dashboard_numbers() ? 'accounts_by_role')::text$q$), 'falsefalsetrue');
    r := r || pg_temp.chk('G4', 'accounts by role, learners linked, founding rows, eight weeks of sign-ups, requests and sessions', pg_temp.run_as(v_off, $q$select pg_temp.keys(public.admin_dashboard_numbers()->'accounts_by_role') || '|' || jsonb_array_length(public.admin_dashboard_numbers()->'signups_per_week') || jsonb_array_length(public.admin_dashboard_numbers()->'requests_per_week') || jsonb_array_length(public.admin_dashboard_numbers()->'sessions_per_week')$q$), 'admin,learner,parent,tutor|888');
    r := r || pg_temp.chk('G5', 'tutors by stage has the six stages', pg_temp.run_as(v_off, $q$select pg_temp.keys(public.admin_dashboard_numbers()->'tutors_by_stage')$q$), 'documents_in,on_the_list,refused,signed_up,under_review,verified');
    r := r || pg_temp.chk('G6', 'the tutor count by role matches the table', pg_temp.run_as(v_off, $q$select public.admin_dashboard_numbers()->'accounts_by_role'->>'tutor'$q$), (select count(*)::text from profiles where role::text = 'tutor'));
    select public.admin_dashboard_numbers() into j;
    r := r || pg_temp.chk('G7', 'no email address, name or id appears anywhere in the answer', (position('@' in j::text) = 0 and position(t1::text in j::text) = 0)::text, 'true');
    r := r || pg_temp.chk('G8', 'a tutor is refused', pg_temp.run_as(t1, $q$select public.admin_dashboard_numbers()::text$q$), 'ERR: Admins only');

    -- H. rights and closed tables
    select string_agg(p.proname || '=' || has_function_privilege('anon', p.oid, 'execute')::int || has_function_privilege('authenticated', p.oid, 'execute')::int || has_function_privilege('service_role', p.oid, 'execute')::int, ' ' order by p.proname) into t
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('my_dashboard', 'dashboard_data', 'my_level_progress', 'my_verification_checklist', 'admin_verified_battery', 'admin_verification_board', 'admin_dashboard_numbers', 'dashboard_role');
    r := r || pg_temp.chk('H1', 'execute rights anon/signed-in/server key', t, 'admin_dashboard_numbers=010 admin_verification_board=010 admin_verified_battery=010 dashboard_data=010 dashboard_role=000 my_dashboard=010 my_level_progress=010 my_verification_checklist=010');
    r := r || pg_temp.chk('H2', 'the two config tables are closed to the app', pg_temp.run_as(t1, 'select count(*)::text from public.dashboard_widgets') || '|' || pg_temp.run_as(t1, 'select count(*)::text from public.dashboard_defaults'),
      'ERR: permission denied for table dashboard_widgets|ERR: permission denied for table dashboard_defaults');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
