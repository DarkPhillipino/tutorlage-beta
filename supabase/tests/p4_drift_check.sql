-- Rolled-back test of migration 20261123120000_p4_drift_check.sql (P4-6, 23 Nov 2026): the nightly "no longer ready" check. Run it TOGETHER with the migration (one statement: the last line raises, so
-- everything is undone) or alone after the apply. Made-up people only; nothing is kept. Real tutors are also scanned, so every count below is of the made-up ones.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  td date := (now() at time zone 'Africa/Johannesburg')::date;
  adult text := (current_date - interval '30 years')::date::text;
  uid text := replace(gen_random_uuid()::text, '-', '');
  v_off uuid := gen_random_uuid(); v_sup uuid := gen_random_uuid();
  t_ok uuid := gen_random_uuid(); t_nr uuid := gen_random_uuid(); t_fl uuid := gen_random_uuid(); t_lv uuid := gen_random_uuid(); t_sj uuid := gen_random_uuid();
  ids uuid[]; t text; first1 timestamptz; first2 timestamptz;
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
      create function pg_temp.kinds(p_tutor uuid) returns text language sql as $f$
        select coalesce(string_agg(kind, ',' order by kind), 'none') from public.tutor_drift_findings where tutor_id = p_tutor and resolved_at is null $f$ $mk$;

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_off, z, 'authenticated', 'authenticated', 'dr.off.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Vic', 'surname', 'Officer', 'date_of_birth', adult), '{}'),
      (v_sup, z, 'authenticated', 'authenticated', 'dr.sup.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Sam', 'surname', 'Support', 'date_of_birth', adult), '{}'),
      (t_ok, z, 'authenticated', 'authenticated', 'dr.ok.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Ok', 'date_of_birth', adult), '{}'),
      (t_nr, z, 'authenticated', 'authenticated', 'dr.nr.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'NotReady', 'date_of_birth', adult), '{}'),
      (t_fl, z, 'authenticated', 'authenticated', 'dr.fl.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Floor', 'date_of_birth', adult), '{}'),
      (t_lv, z, 'authenticated', 'authenticated', 'dr.lv.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Level', 'date_of_birth', adult), '{}'),
      (t_sj, z, 'authenticated', 'authenticated', 'dr.sj.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Subject', 'date_of_birth', adult), '{}');
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
      (v_off, 'Vic', 'Officer', 'dr.off.' || uid || '@example.invalid', '', 'verification_officer', true),
      (v_sup, 'Sam', 'Support', 'dr.sup.' || uid || '@example.invalid', '', 'support_agent', true);
    ids := array[t_ok, t_nr, t_fl, t_lv, t_sj];
    -- t_ok: everything in place. The others are verified by the owner (as the old tutors were) and drifted in one way each.
    insert into tutor_onboarding (tutor_id, track, consented_at) select x, 'experienced', now() from unnest(ids) x;
    perform pg_temp.doc(t_ok, 'identity_doc', 'verified', null); perform pg_temp.doc(t_ok, 'police_clearance', 'verified', td); perform pg_temp.doc(t_ok, 'proof_of_experience', 'verified', null);
    perform pg_temp.doc(t_fl, 'identity_doc', 'verified', null); perform pg_temp.doc(t_fl, 'police_clearance', 'verified', td); perform pg_temp.doc(t_fl, 'proof_of_experience', 'verified', null);
    perform pg_temp.doc(t_lv, 'identity_doc', 'verified', null); perform pg_temp.doc(t_lv, 'police_clearance', 'verified', td); perform pg_temp.doc(t_lv, 'proof_of_experience', 'verified', null);
    perform pg_temp.doc(t_sj, 'identity_doc', 'verified', null); perform pg_temp.doc(t_sj, 'police_clearance', 'verified', td); perform pg_temp.doc(t_sj, 'proof_of_experience', 'verified', null);
    update tutor_profiles set is_verified = true, onboarding_status = 'verified' where id = any (ids);
    update tutor_profiles set credential_floor_sub_tier_id = '2C' where id = t_fl;
    update tutor_profiles set current_sub_tier_id = '3A', current_tier_id = 3 where id = t_lv;
    insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
      select t_sj, s.name, k.curriculum, 'Grade 8', 'Grade 12', 'verified' from (select name from public.subjects order by name limit 1) s, (select curriculum from public.curriculum_criteria where active order by curriculum limit 1) k;

    -- A. the scan finds each kind and leaves the good tutor alone
    perform public.tutor_drift_scan();
    r := r || pg_temp.chk('A1', 'a tutor with everything in place has no finding', pg_temp.kinds(t_ok), 'none');
    r := r || pg_temp.chk('A2', 'a verified tutor with no documents: not_ready', pg_temp.kinds(t_nr), 'not_ready');
    select detail::text into t from public.tutor_drift_findings where tutor_id = t_nr and kind = 'not_ready' and resolved_at is null;
    r := r || pg_temp.chk('A2b', '...with the reason codes and nothing else', t, '{"reasons": ["identity_missing", "police_missing", "third_doc_missing"]}');
    r := r || pg_temp.chk('A3', 'a credential floor with no credential behind it', pg_temp.kinds(t_fl), 'floor_without_credential');
    r := r || pg_temp.chk('A4', 'a level above what the criteria earn, with no floor', pg_temp.kinds(t_lv), 'level_unexplained');
    r := r || pg_temp.chk('A5', 'an approved subject while Module 7 is not done', pg_temp.kinds(t_sj), 'subject_rule_not_met');
    select (select count(*) from public.tutor_profiles where id = any (ids) and is_verified)::text into t;
    r := r || pg_temp.chk('A6', 'NOTHING was suspended: all five are still verified', t, '5');
    select count(*)::text into t from public.admin_audit_logs a where a.target_entity_id = any (ids) and a.action::text in ('tutor_rejected', 'tutor_suspended');
    r := r || pg_temp.chk('A7', 'and no rejection or suspension was logged', t, '0');

    -- B. a second scan changes nothing; a fixed tutor is closed, not deleted
    select first_seen into first1 from public.tutor_drift_findings where tutor_id = t_nr and kind = 'not_ready' and resolved_at is null;
    perform public.tutor_drift_scan();
    select first_seen into first2 from public.tutor_drift_findings where tutor_id = t_nr and kind = 'not_ready' and resolved_at is null;
    select count(*)::text into t from public.tutor_drift_findings where tutor_id = any (ids) and resolved_at is null;
    r := r || pg_temp.chk('B1', 'a second scan opens no second row and keeps the first-seen time', t || '/' || (first1 = first2)::text, '4/true');
    perform pg_temp.doc(t_nr, 'identity_doc', 'verified', null); perform pg_temp.doc(t_nr, 'police_clearance', 'verified', td); perform pg_temp.doc(t_nr, 'proof_of_experience', 'verified', null);
    perform public.tutor_drift_scan();
    r := r || pg_temp.chk('B2', 'once the documents are in, the finding is no longer open', pg_temp.kinds(t_nr), 'none');
    select count(*)::text into t from public.tutor_drift_findings where tutor_id = t_nr and resolved_at is not null;
    r := r || pg_temp.chk('B3', '...and the history row stays (closed, not deleted)', t, '1');

    -- C. who may read, who may scan
    r := r || pg_temp.chk('C1', 'the officer sees the open findings of the made-up tutors, each with a ref', pg_temp.run_as(v_off, format('select count(*)::text from public.admin_tutor_drift() d where d.tutor_id = any (%L::uuid[]) and d.ref like %L', ids::text, 'drift:%')), '3');
    r := r || pg_temp.chk('C2', 'a support agent is refused', pg_temp.run_as(v_sup, 'select count(*)::text from public.admin_tutor_drift()'), 'ERR: Only a verification officer or a super admin can see this');
    r := r || pg_temp.chk('C3', 'a tutor is refused', pg_temp.run_as(t_ok, 'select count(*)::text from public.admin_tutor_drift()'), 'ERR: Admins only');
    r := r || pg_temp.chk('C4', 'a signed-out caller is refused', pg_temp.run_as(null, 'select count(*)::text from public.admin_tutor_drift()'), 'ERR: permission denied for function admin_tutor_drift');
    r := r || pg_temp.chk('C5', 'the table itself is closed to the app', pg_temp.run_as(v_off, 'select count(*)::text from public.tutor_drift_findings'), 'ERR: permission denied for table tutor_drift_findings');
    r := r || pg_temp.chk('C6', 'the scan cannot be run by the app (anon, signed-in, server key)', (select has_function_privilege('anon', 'public.tutor_drift_scan()', 'execute')::int::text || has_function_privilege('authenticated', 'public.tutor_drift_scan()', 'execute')::int::text || has_function_privilege('service_role', 'public.tutor_drift_scan()', 'execute')::int::text), '000');
    r := r || pg_temp.chk('C7', 'the read: anon no, signed-in yes, server key no', (select has_function_privilege('anon', 'public.admin_tutor_drift()', 'execute')::int::text || has_function_privilege('authenticated', 'public.admin_tutor_drift()', 'execute')::int::text || has_function_privilege('service_role', 'public.admin_tutor_drift()', 'execute')::int::text), '010');

    -- D. the nightly job
    select schedule || '/' || active::text into t from cron.job where jobname = 'tutor-drift-scan';
    r := r || pg_temp.chk('D1', 'the job is scheduled for 22:10 UTC (00:10 SAST) and active', t, '10 22 * * */true');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
