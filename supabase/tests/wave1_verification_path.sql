-- Rolled-back test, item 10 of the road to P5 (17 Nov 2026): the WHOLE path one wave-1 tutor walks, on the real database, with a made-up person.
--   join the waiting list -> released by a verification officer -> signs up (the list row follows) -> picks a kind and gives the documents consent ->
--   uploads the ID copy -> the officer cannot approve without a police clearance -> uploads it -> the officer verifies both documents, approves the
--   subject on the checklist, approves the tutor -> the tutor is now findable by a signed-out visitor (as the app's search reads it) and can open the request inbox.
-- No login is created (the person exists only inside this statement, no password, no email is sent) and nothing is kept: the block ends with `raise exception`,
-- so the error text IS the report and the whole run is undone. Paste this file alone. Every line ends "ok" or "FAIL (want ...)".
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  uid text := replace(gen_random_uuid()::text, '-', '');
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  adult text := (v_today - interval '30 years')::date::text;
  v_off uuid := gen_random_uuid();
  v_t uuid := gen_random_uuid();
  v_em text := 'w1.' || uid || '@example.invalid';
  v_row uuid;
  v_subj text;
  v_cur text;
  v_comp uuid;
  v_crit uuid[];
  v_vis uuid := gen_random_uuid();
  t text;
  nfail int; nlines int;
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

    select s.name into v_subj from public.subjects s where s.name ilike 'mathematics%' order by s.name limit 1;
    if v_subj is null then select s.name into v_subj from public.subjects s order by s.name limit 1; end if;
    select k.curriculum::text into v_cur from public.curriculum_criteria k where k.active order by k.curriculum limit 1;
    select coalesce(array_agg(k.id), '{}') into v_crit from public.curriculum_criteria k where k.curriculum::text = v_cur and k.active;
    r := r || format('S0 setup: subject "%s", curriculum "%s" with %s active checklist items; gate switch on: %s', v_subj, v_cur, coalesce(array_length(v_crit, 1), 0), public.founding_gate_on()) || E'\n';

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_off, z, 'authenticated', 'authenticated', 'w1.off.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Vic', 'surname', 'Officer', 'date_of_birth', adult), '{}');
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active)
      values (v_off, 'Vic', 'Officer', 'w1.off.' || uid || '@example.invalid', '', 'verification_officer', true);
    delete from founding_signup_lookups;

    -- 1. joins the waiting list, signed out, with the form's payload
    t := pg_temp.run_as(null, format('select public.join_founding_list(%L::jsonb)::text', jsonb_build_object(
      'website', '', 'elapsed_ms', 9000, 'first_name', 'Wave', 'surname', 'Zzone', 'code_name', '', 'whatsapp', '082 123 4567', 'email', v_em, 'date_of_birth', adult,
      'subjects', jsonb_build_array(jsonb_build_object('subject', lower(v_subj), 'min_grade', 'grade 8', 'max_grade', 'Grade 12')),
      'availability', jsonb_build_array('weekends'), 'practicum', 'two', 'police_clearance', 'applied', 'parent_reach', '10_to_30', 'parent_reach_willing', true,
      'has_device', true, 'has_connection', true, 'has_bank', false, 'consent_contact', true, 'consent_marketing', false, 'src', 'zztest', 'visitor', v_vis,
      'consent_version', '2026-11-17')::text));
    select f.id, f.status into v_row, t from public.founding_tutors_list f where f.email_key = lower(v_em);
    r := r || pg_temp.chk('W1', 'the list row exists and is "joined"', t, 'joined');

    -- 2. a verification officer releases the place (wave 1)
    t := pg_temp.run_as(v_off, format('select (public.admin_release_founding(array[%L]::uuid[], 1)->>%L)', v_row, 'released'));
    r := r || pg_temp.chk('W2', 'the officer releases 1 place', t, '1');

    -- 3. the person signs up with the same email (the app's sign-up call; the database trigger builds the profile)
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
      values (v_t, z, 'authenticated', 'authenticated', v_em, jsonb_build_object('role', 'tutor', 'first_name', 'Wave', 'surname', 'Zzone', 'date_of_birth', adult, 'phone_number', '0821234567'), '{}');
    select count(*)::text into t from public.tutor_profiles where id = v_t;
    r := r || pg_temp.chk('W3', 'sign-up made the tutor profile', t, '1');
    t := pg_temp.run_as(v_off, format('select (select e->>%L from jsonb_array_elements(public.admin_founding_entries()) e where e->>%L = %L)', 'effective_status', 'id', v_row));
    r := r || pg_temp.chk('W3b', 'the officer''s list shows the person as "signed_up"', t, 'signed_up');
    t := pg_temp.run_as(v_t, 'select (public.my_founding_gate()->>' || quote_literal('state') || ')');
    r := r || pg_temp.chk('W3c', 'the tutor''s own gate state lets documents in', t, case when public.founding_gate_on() then 'released' else 'open' end);

    -- 4. picks a kind and gives the documents consent
    t := pg_temp.run_as(v_t, 'select public.set_my_tutor_track(' || quote_literal('experienced') || ')::text');
    r := r || pg_temp.chk('W4', 'the tutor picks "experienced"', t, '');
    t := pg_temp.run_as(v_t, 'select public.record_my_documents_consent(' || quote_literal('2026-10-17') || ')::text');
    r := r || pg_temp.chk('W4b', 'documents consent recorded', t, '');

    -- 5. uploads the ID copy (the row the app writes after the file is stored); adds a subject
    t := pg_temp.run_as(v_t, format($q$with x as (insert into public.tutor_verification_documents (tutor_id, document_type, document_url) values (%L, 'identity_doc', %L) returning id) select count(*)::text from x$q$, v_t, v_t || '/zz-id.pdf'));
    r := r || pg_temp.chk('W5', 'the tutor uploads the ID copy', t, '1');
    t := pg_temp.run_as(v_t, format($q$with x as (insert into public.tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status) values (%L, %L, %L::curriculum_type, 'Grade 8', 'Grade 12', 'verified') returning id) select id::text from x$q$, v_t, v_subj, v_cur));
    if t like 'ERR:%' then
      r := r || 'W6 FAIL the subject was refused: ' || t || E'\n';
    else
      v_comp := t::uuid;
      select tc.verification_status::text into t from public.tutor_subject_competencies tc where tc.id = v_comp;
      r := r || pg_temp.chk('W6', 'a tutor-added subject is stored "pending" whatever was sent', t, 'pending');
    end if;

    -- 6. before approval: invisible to a signed-out visitor; the tutor cannot approve themself; the officer cannot approve without a police clearance
    t := pg_temp.run_as(null, format('select count(*)::text from public.tutor_profiles where id = %L', v_t));
    r := r || pg_temp.chk('W7', 'a signed-out visitor cannot see the unapproved tutor', t, '0');
    t := pg_temp.run_as(v_off, format($q$with x as (update public.tutor_profiles set is_verified = true, onboarding_status = 'verified' where id = %L returning id) select count(*)::text from x$q$, v_t));
    r := r || pg_temp.chk('W9', 'the officer cannot approve with an ID copy but no police clearance', t, 'ERR: approval_needs_documents:police_clearance_missing');

    -- 7. the police clearance (issued today), then the officer checks both documents, ticks the subject's checklist and approves the tutor
    t := pg_temp.run_as(v_t, format($q$with x as (insert into public.tutor_verification_documents (tutor_id, document_type, document_url, issued_on) values (%L, 'police_clearance', %L, %L::date) returning id) select count(*)::text from x$q$, v_t, v_t || '/zz-police.pdf', v_today));
    r := r || pg_temp.chk('W10', 'the tutor uploads the police clearance', t, '1');
    t := pg_temp.run_as(v_off, format($q$with x as (update public.tutor_verification_documents set status = 'verified', reviewed_at = now() where tutor_id = %L returning id) select count(*)::text from x$q$, v_t));
    r := r || pg_temp.chk('W11', 'the officer marks both documents verified', t, '2');
    -- Module 7 (safeguarding) and the code of conduct: from migration 20261118110000 an admin cannot approve a subject without them. The tutor does this in the app (tier1_submit_module_check);
    -- the row it writes is put in here directly, and tests/module7_subject_approval.sql proves the refusal without it.
    insert into public.tier1_training (tutor_id, module, result, method, conduct_accepted_at) values (v_t, 7, 'complete', 'scenario_check', now());
    t := pg_temp.run_as(v_off, format('select public.admin_review_tutor_subject(%L::uuid, %L, %L, %L::uuid[])::text', v_comp, 'approve', 'zz checked', v_crit::text));
    r := r || pg_temp.chk('W12', 'the officer approves the subject on the checklist', t, '');
    t := pg_temp.run_as(v_t, format($q$with x as (update public.tutor_profiles set is_verified = true, onboarding_status = 'verified' where id = %L returning id) select count(*)::text from x$q$, v_t));
    r := r || pg_temp.chk('W8', 'the tutor, with all documents in, still cannot approve themself', t, 'ERR: Only Tutorlage can change verification, tier, rating or freeze details');
    t := pg_temp.run_as(v_off, format($q$with x as (update public.tutor_profiles set is_verified = true, onboarding_status = 'verified' where id = %L returning id) select count(*)::text from x$q$, v_t));
    r := r || pg_temp.chk('W13', 'the officer approves the tutor', t, '1');

    -- 8. what the world now sees
    select tp.is_verified::text || '/' || (tp.verified_at is not null)::text into t from public.tutor_profiles tp where tp.id = v_t;
    r := r || pg_temp.chk('W14', 'verified, and the verified time is stamped', t, 'true/true');
    t := pg_temp.run_as(v_off, format('select (select e->>%L from jsonb_array_elements(public.admin_founding_entries()) e where e->>%L = %L)', 'effective_status', 'id', v_row));
    r := r || pg_temp.chk('W15', 'the officer''s list now shows the person as "verified"', t, 'verified');
    t := pg_temp.run_as(null, format('select count(*)::text from public.tutor_profiles tp join public.tutor_subject_competencies c on c.tutor_id = tp.id where tp.id = %L and c.verification_status = %L', v_t, 'verified'));
    r := r || pg_temp.chk('W16', 'a signed-out visitor now finds the tutor with the approved subject (the app''s search)', t, '1');
    t := pg_temp.run_as(v_t, 'select (public.my_founding_gate()->>' || quote_literal('state') || ')');
    r := r || pg_temp.chk('W17', 'the tutor''s gate state', t, case when public.founding_gate_on() then 'verified' else 'open' end);
    t := pg_temp.run_as(v_t, 'select case when count(*) >= 0 then ' || quote_literal('opens') || ' end from public.available_requests_for_tutor()');
    r := r || pg_temp.chk('W18', 'the tutor can open the request inbox', t, 'opens');
    select count(*)::text into t from public.admin_audit_logs a where a.target_entity_id in (v_t, v_comp) or a.admin_id = v_off;
    r := r || 'W19 admin audit rows written by this run (info): ' || t || E'\n';
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
