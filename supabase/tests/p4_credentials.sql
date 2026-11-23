-- Rolled-back test of migration 20261123180000_p4_credentials_need_documents.sql (P4-4, 23 Nov 2026). Run it TOGETHER with the migration (one statement; the last line raises so everything is undone) or alone
-- after the apply. Made-up people only; nothing is kept.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  td date := (now() at time zone 'Africa/Johannesburg')::date;
  adult text := (current_date - interval '30 years')::date::text;
  uid text := replace(gen_random_uuid()::text, '-', '');
  v_off uuid := gen_random_uuid(); v_sup uuid := gen_random_uuid(); t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid();
  d_sace uuid; d_id uuid; d_pend uuid; d_other uuid; d_mark uuid; d_exp uuid;
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
      create function pg_temp.doc(p_tutor uuid, p_type text, p_status text) returns uuid language plpgsql as $f$
      declare i uuid;
      begin
        insert into public.tutor_verification_documents (tutor_id, document_type, document_url, status)
        values (p_tutor, p_type::public.doc_type, 'fixture/' || gen_random_uuid(), p_status::public.verification_status) returning id into i;
        return i;
      end $f$ $mk$;
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_off, z, 'authenticated', 'authenticated', 'cr.off.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Vic', 'surname', 'Officer', 'date_of_birth', adult), '{}'),
      (v_sup, z, 'authenticated', 'authenticated', 'cr.sup.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Sam', 'surname', 'Support', 'date_of_birth', adult), '{}'),
      (t1, z, 'authenticated', 'authenticated', 'cr.t1.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'One', 'date_of_birth', adult), '{}'),
      (t2, z, 'authenticated', 'authenticated', 'cr.t2.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Two', 'date_of_birth', adult), '{}');
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
      (v_off, 'Vic', 'Officer', 'cr.off.' || uid || '@example.invalid', '', 'verification_officer', true),
      (v_sup, 'Sam', 'Support', 'cr.sup.' || uid || '@example.invalid', '', 'support_agent', true);
    d_sace := pg_temp.doc(t1, 'sace_certificate', 'verified');
    d_id := pg_temp.doc(t1, 'identity_doc', 'verified');
    d_pend := pg_temp.doc(t1, 'sace_certificate', 'pending');
    d_other := pg_temp.doc(t2, 'sace_certificate', 'verified');
    d_mark := pg_temp.doc(t1, 'marking_appointment_letter', 'verified');

    -- A. what is refused
    r := r || pg_temp.chk('A1', 'no document at all', pg_temp.run_as(v_off, format($q$select public.admin_record_credential(%L, 'sace_registered_teacher', null, null, null)::text$q$, t1)), 'ERR: credential_needs_document: choose the verified document that proves this credential');
    r := r || pg_temp.chk('A2', 'another tutor''s document', pg_temp.run_as(v_off, format($q$select public.admin_record_credential(%L, 'sace_registered_teacher', null, %L, null)::text$q$, t1, d_other)), 'ERR: That document does not belong to this tutor');
    r := r || pg_temp.chk('A3', 'a document nobody has checked', pg_temp.run_as(v_off, format($q$select public.admin_record_credential(%L, 'sace_registered_teacher', null, %L, null)::text$q$, t1, d_pend)), 'ERR: credential_document_not_verified: verify the document first, then record the credential');
    r := r || pg_temp.chk('A4', 'a verified document of the wrong kind (an ID for a SACE credential)', pg_temp.run_as(v_off, format($q$select public.admin_record_credential(%L, 'sace_registered_teacher', null, %L, null)::text$q$, t1, d_id)), 'ERR: credential_wrong_document: this kind of document does not prove this credential');
    r := r || pg_temp.chk('A5', 'a credential that expires needs the date it was obtained', pg_temp.run_as(v_off, format($q$select public.admin_record_credential(%L, 'exam_marker', null, %L, null)::text$q$, t1, d_mark)), 'ERR: credential_needs_date: enter the date this was obtained (it counts for 5 years)');
    r := r || pg_temp.chk('A6', 'a date in the future', pg_temp.run_as(v_off, format($q$select public.admin_record_credential(%L, 'exam_marker', %L::date, %L, null)::text$q$, t1, td + 1, d_mark)), 'ERR: The date obtained cannot be in the future');
    r := r || pg_temp.chk('A7', '"Level assigned by Tutorlage" still cannot be recorded here', pg_temp.run_as(v_off, format($q$select public.admin_record_credential(%L, 'admin_assigned', null, %L, null)::text$q$, t1, d_sace)), 'ERR: To set a level for this tutor use "Assign a level"');
    r := r || pg_temp.chk('A8', 'a support agent is refused', pg_temp.run_as(v_sup, format($q$select public.admin_record_credential(%L, 'sace_registered_teacher', null, %L, null)::text$q$, t1, d_sace)), 'ERR: Only a verification officer or a super admin can change a tutor''s level');
    select count(*)::text into t from public.tutor_credentials where tutor_id = t1;
    r := r || pg_temp.chk('A9', 'nothing was recorded by any refusal', t, '0');

    -- B. suggestions (before any new credential is added below)
    r := r || pg_temp.chk('B1', 'a verified SACE certificate suggests the two SACE credentials', pg_temp.run_as(v_off, format($q$select string_agg(code, ',' order by entry_sub_tier_id, code) from public.admin_credential_suggestions(%L)$q$, d_sace)), 'sace_registered_teacher,sace_fet_subject_teacher');
    r := r || pg_temp.chk('B2', 'an unchecked document suggests nothing', pg_temp.run_as(v_off, format($q$select count(*)::text from public.admin_credential_suggestions(%L)$q$, d_pend)), '0');
    r := r || pg_temp.chk('B3', 'an ID suggests nothing', pg_temp.run_as(v_off, format($q$select count(*)::text from public.admin_credential_suggestions(%L)$q$, d_id)), '0');
    r := r || pg_temp.chk('B4', 'a support agent and a signed-out caller are refused', pg_temp.run_as(v_sup, format($q$select count(*)::text from public.admin_credential_suggestions(%L)$q$, d_sace)) || '|' || pg_temp.run_as(null, format($q$select count(*)::text from public.admin_credential_suggestions(%L)$q$, d_sace)),
      'ERR: Only a verification officer or a super admin can see this|ERR: permission denied for function admin_credential_suggestions');

    -- C. what is accepted
    r := r || pg_temp.chk('C1', 'a verified SACE certificate records the SACE credential', (pg_temp.run_as(v_off, format($q$select (public.admin_record_credential(%L, 'sace_registered_teacher', null, %L, 'checked the number')) is not null$q$, t1, d_sace))), 'true');
    select tc.status || '/' || (tc.document_id = d_sace)::text into t from public.tutor_credentials tc where tc.tutor_id = t1 and tc.credential_code = 'sace_registered_teacher';
    r := r || pg_temp.chk('C2', 'the row is verified and linked to that document', t, 'verified/true');
    select credential_floor_sub_tier_id into t from public.tutor_profiles where id = t1;
    r := r || pg_temp.chk('C3', 'the level floor follows (2D)', t, '2D');
    select count(*)::text into n from public.admin_audit_logs a where a.target_entity_id = t1 and a.metadata ->> 'action' = 'record_credential' and (a.metadata ->> 'document')::uuid = d_sace;
    r := r || pg_temp.chk('C4', 'one audit line that names the document', n::text, '1');
    r := r || pg_temp.chk('C5', 'an expiring credential with a date and a marking letter is accepted', pg_temp.run_as(v_off, format($q$select (public.admin_record_credential(%L, 'exam_marker', %L::date, %L, null)) is not null$q$, t1, td - 30, d_mark)), 'true');
    insert into public.credential_definitions (code, label, entry_sub_tier_id, recency_years, proves_subject_competence) values ('zz_new_credential', 'A credential an admin adds later', '1B', null, false);
    d_exp := pg_temp.doc(t1, 'proof_of_experience', 'verified');
    r := r || pg_temp.chk('C6', 'a new credential with no list refuses an ID but accepts a proof of experience',
      pg_temp.run_as(v_off, format($q$select public.admin_record_credential(%L, 'zz_new_credential', null, %L, null)::text$q$, t1, d_id)) || '|' || pg_temp.run_as(v_off, format($q$select (public.admin_record_credential(%L, 'zz_new_credential', null, %L, null)) is not null$q$, t1, d_exp)),
      'ERR: credential_wrong_document: this kind of document does not prove a credential|true');
    r := r || pg_temp.chk('C7', 'every real credential has its list of accepted documents', (select count(*)::text from public.credential_definitions where accepted_document_types is null and code not in ('admin_assigned', 'zz_new_credential')), '0');
    r := r || pg_temp.chk('C8', 'rights: not anon, yes signed-in (record and suggestions)', (select string_agg(p.proname || '=' || has_function_privilege('anon', p.oid, 'execute')::int || has_function_privilege('authenticated', p.oid, 'execute')::int, ' ' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_record_credential', 'admin_credential_suggestions')), 'admin_credential_suggestions=01 admin_record_credential=01');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
