-- Rolled-back test of migration 20261123100000_p4_verification_functions.sql (P4 slice A, 23 Nov 2026): tutor_readiness, admin_approve_tutor, admin_reject_tutor,
-- admin_review_document, and the three replaced functions (admin_set_date_of_birth, admin_assign_tier, admin_remove_credential).
-- Run it TOGETHER with the migration (cat the migration file, then this file, into one statement: the last line of this block raises, so everything, the
-- migration included, is undone) or on its own after the apply. Made-up people only (no login, no password, no email); nothing is kept.
-- Every line ends "ok" or "FAIL (want ...)". The error text IS the report.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  td date := (now() at time zone 'Africa/Johannesburg')::date;
  adult text := (current_date - interval '30 years')::date::text;
  uid text := replace(gen_random_uuid()::text, '-', '');
  v_off uuid := gen_random_uuid();   -- a verification officer
  v_sup uuid := gen_random_uuid();   -- a support agent (an active admin, not a verification role)
  t1 uuid := gen_random_uuid();      -- the full path (beginner)
  t2 uuid := gen_random_uuid();      -- ready, used for the "audit fails, approval is undone" check
  t3 uuid := gen_random_uuid();      -- no documents at all (the old trigger still holds a direct update)
  t4 uuid := gen_random_uuid();      -- grandfathered
  t5 uuid := gen_random_uuid();      -- under 18 / no date of birth
  t6 uuid := gen_random_uuid();      -- experienced, police certificate 7 months old
  d_id uuid; d_pol uuid; d_res uuid; d_opt uuid; d_pol2 uuid; d_x uuid;
  tier text;
  t text; n int;
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
    -- a document row added as the owner (the guard lets the owner write any status)
    execute $mk$
      create function pg_temp.doc(p_tutor uuid, p_type text, p_status text, p_issued date) returns uuid language plpgsql as $f$
      declare i uuid;
      begin
        insert into public.tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
        values (p_tutor, p_type::public.doc_type, 'fixture/' || gen_random_uuid(), p_status::public.verification_status, p_issued) returning id into i;
        return i;
      end $f$ $mk$;
    -- the readiness reasons as one text, "ready" when none
    execute $mk$
      create function pg_temp.reasons(p_u uuid, p_tutor uuid) returns text language plpgsql as $f$
      declare v text;
      begin
        v := pg_temp.run_as(p_u, format('select case when (public.tutor_readiness(%L)->>%L)::boolean then %L else (select string_agg(x, %L) from jsonb_array_elements_text(public.tutor_readiness(%L)->%L) x) end', p_tutor, 'ready', 'READY', ',', p_tutor, 'reasons'));
        return v;
      end $f$ $mk$;

    -- ---- people ----------------------------------------------------------------------------------------------------------------
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_off, z, 'authenticated', 'authenticated', 'p4.off.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Vic', 'surname', 'Officer', 'date_of_birth', adult), '{}'),
      (v_sup, z, 'authenticated', 'authenticated', 'p4.sup.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Sam', 'surname', 'Support', 'date_of_birth', adult), '{}'),
      (t1, z, 'authenticated', 'authenticated', 'p4.t1.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'T1', 'date_of_birth', adult), '{}'),
      (t2, z, 'authenticated', 'authenticated', 'p4.t2.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'T2', 'date_of_birth', adult), '{}'),
      (t3, z, 'authenticated', 'authenticated', 'p4.t3.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'T3', 'date_of_birth', adult), '{}'),
      (t4, z, 'authenticated', 'authenticated', 'p4.t4.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'T4', 'date_of_birth', adult), '{}'),
      (t5, z, 'authenticated', 'authenticated', 'p4.t5.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'T5', 'date_of_birth', adult), '{}'),
      (t6, z, 'authenticated', 'authenticated', 'p4.t6.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'T6', 'date_of_birth', adult), '{}');
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
      (v_off, 'Vic', 'Officer', 'p4.off.' || uid || '@example.invalid', '', 'verification_officer', true),
      (v_sup, 'Sam', 'Support', 'p4.sup.' || uid || '@example.invalid', '', 'support_agent', true);
    insert into tutor_onboarding (tutor_id, track, consented_at) values (t1, 'beginner', now()), (t2, 'experienced', now()), (t6, 'experienced', now());
    insert into tutor_onboarding (tutor_id, grandfathered) values (t4, true);
    select id into tier from public.sub_tier_definitions order by id limit 1;

    -- ---- A. readiness, the reasons ---------------------------------------------------------------------------------------------
    r := r || pg_temp.chk('A1', 'a tutor with a track and consent and no documents', pg_temp.reasons(v_off, t1), 'identity_missing,police_missing,third_doc_missing');
    r := r || pg_temp.chk('A2', 'no onboarding row at all (t3)', pg_temp.reasons(v_off, t3), 'no_track,identity_missing,police_missing');
    update tutor_onboarding set consented_at = null where tutor_id = t2;
    r := r || pg_temp.chk('A3', 'a track but no consent (t2)', pg_temp.reasons(v_off, t2), 'no_consent,identity_missing,police_missing,third_doc_missing');
    update tutor_onboarding set consented_at = now() where tutor_id = t2;
    r := r || pg_temp.chk('A4', 'a made-up id that does not exist', pg_temp.run_as(v_off, format('select public.tutor_readiness(%L)::text', gen_random_uuid())), 'ERR: No such tutor');
    update public.profiles set date_of_birth = (td - interval '17 years')::date where id = t5;
    r := r || pg_temp.chk('A5', 'a tutor of 17', pg_temp.reasons(v_off, t5), 'under_18,no_track,identity_missing,police_missing');
    update public.profiles set date_of_birth = null where id = t5;
    r := r || pg_temp.chk('A6', 'no date of birth recorded', pg_temp.reasons(v_off, t5), 'dob_missing,no_track,identity_missing,police_missing');
    r := r || pg_temp.chk('A7', 'a grandfathered tutor with an adult date of birth is ready (as the old trigger holds them)', pg_temp.reasons(v_off, t4), 'READY');

    -- ---- B. who may ask -------------------------------------------------------------------------------------------------------
    r := r || pg_temp.chk('B1', 'the tutor may read their own', pg_temp.reasons(t1, t1), 'identity_missing,police_missing,third_doc_missing');
    r := r || pg_temp.chk('B2', 'another tutor may not', pg_temp.reasons(t2, t1), 'ERR: Not allowed');
    r := r || pg_temp.chk('B3', 'a support agent may not', pg_temp.reasons(v_sup, t1), 'ERR: Not allowed');
    r := r || pg_temp.chk('B4', 'a signed-out caller may not', pg_temp.reasons(null, t1), 'ERR: permission denied for function tutor_readiness');

    -- ---- C. documents pending: readiness and the refusal to approve --------------------------------------------------------------
    d_id := pg_temp.doc(t1, 'identity_doc', 'pending', null);
    d_pol := pg_temp.doc(t1, 'police_clearance', 'pending', td);
    d_res := pg_temp.doc(t1, 'subject_results', 'pending', null);
    update public.profiles set date_of_birth = (current_date - interval '30 years')::date where id = t5;
    r := r || pg_temp.chk('C1', 'all three required documents there but pending', pg_temp.reasons(v_off, t1), 'identity_not_verified,police_not_verified,third_doc_not_verified');
    r := r || pg_temp.chk('C2', 'the officer cannot approve while they are pending', pg_temp.run_as(v_off, format('select public.admin_approve_tutor(%L)::text', t1)),
                          'ERR: approval_not_ready:identity_not_verified,police_not_verified,third_doc_not_verified');
    select is_verified::text into t from public.tutor_profiles where id = t1;
    r := r || pg_temp.chk('C3', 'and the tutor is still not verified', t, 'false');
    r := r || pg_temp.chk('C4', 'a support agent cannot approve', pg_temp.run_as(v_sup, format('select public.admin_approve_tutor(%L)::text', t1)), 'ERR: Only a verification officer or a super admin can approve a tutor');
    r := r || pg_temp.chk('C5', 'the tutor cannot approve themself', pg_temp.run_as(t1, format('select public.admin_approve_tutor(%L)::text', t1)), 'ERR: Admins only');
    r := r || pg_temp.chk('C6', 'a signed-out caller cannot', pg_temp.run_as(null, format('select public.admin_approve_tutor(%L)::text', t1)), 'ERR: permission denied for function admin_approve_tutor');

    -- ---- D. document review through the function -------------------------------------------------------------------------------
    r := r || pg_temp.chk('D1', 'a support agent cannot review a document', pg_temp.run_as(v_sup, format('select public.admin_review_document(%L, %L)::text', d_id, 'verified')), 'ERR: Only a verification officer or a super admin can review documents');
    r := r || pg_temp.chk('D2', 'a wrong decision word is refused', pg_temp.run_as(v_off, format('select public.admin_review_document(%L, %L)::text', d_id, 'maybe')), 'ERR: The decision must be verified, rejected or under_review');
    r := r || pg_temp.chk('D3', 'an unknown document is refused', pg_temp.run_as(v_off, format('select public.admin_review_document(%L, %L)::text', gen_random_uuid(), 'verified')), 'ERR: No such document');
    r := r || pg_temp.chk('D4', 'a rejection needs a reason', pg_temp.run_as(v_off, format('select public.admin_review_document(%L, %L)::text', d_res, 'rejected')), 'ERR: Give the reason this document is not accepted');
    r := r || pg_temp.chk('D5', 'a one-letter reason is not a reason', pg_temp.run_as(v_off, format('select public.admin_review_document(%L, %L, %L)::text', d_res, 'rejected', 'x')), 'ERR: Give the reason this document is not accepted');
    r := r || pg_temp.chk('D6', 'verifying the police clearance with a date 7 months old is refused', pg_temp.run_as(v_off, format('select public.admin_review_document(%L, %L, null, %L::date)::text', d_pol, 'verified', (td - interval '7 months')::date)),
                          'ERR: police_clearance_expired: the certificate was issued more than 6 months ago');
    r := r || pg_temp.chk('D7', 'a date in the future is refused', pg_temp.run_as(v_off, format('select public.admin_review_document(%L, %L, null, %L::date)::text', d_pol, 'verified', td + 1)), 'ERR: The issue date cannot be in the future');
    select issued_on::text into t from public.tutor_verification_documents where id = d_pol;
    r := r || pg_temp.chk('D8', 'a refused review changed nothing (the date is still today)', t, td::text);
    select count(*)::text into t from public.tutor_verification_audits where tutor_id = t1;
    r := r || pg_temp.chk('D9', 'and wrote no audit line', t, '0');
    r := r || pg_temp.chk('D10', 'the officer verifies the ID', pg_temp.run_as(v_off, format('select (public.admin_review_document(%L, %L)->>%L)', d_id, 'verified', 'decision')), 'verified');
    r := r || pg_temp.chk('D11', 'the officer verifies the police clearance', pg_temp.run_as(v_off, format('select (public.admin_review_document(%L, %L)->>%L)', d_pol, 'verified', 'decision')), 'verified');
    select count(*)::text into t from public.tutor_verification_audits a where a.tutor_id = t1 and a.reviewer_id = v_off and a.decision::text = 'verified';
    r := r || pg_temp.chk('D12', 'two audit lines, written by the same calls', t, '2');
    select status::text || '/' || (reviewed_at is not null)::text into t from public.tutor_verification_documents where id = d_id;
    r := r || pg_temp.chk('D13', 'the document row says verified and reviewed', t, 'verified/true');
    r := r || pg_temp.chk('D14', 'results still pending', pg_temp.reasons(v_off, t1), 'third_doc_not_verified');

    -- ---- E. an optional document that is still pending blocks; a rejected optional one does not -------------------------------------
    r := r || pg_temp.chk('E0', 'the officer verifies the results', pg_temp.run_as(v_off, format('select (public.admin_review_document(%L, %L)->>%L)', d_res, 'verified', 'decision')), 'verified');
    d_opt := pg_temp.doc(t1, 'teaching_qualification', 'pending', null);
    r := r || pg_temp.chk('E1', 'a pending OPTIONAL document is a reason', pg_temp.reasons(v_off, t1), 'document_pending:teaching_qualification');
    r := r || pg_temp.chk('E2', 'and approval is refused for it', pg_temp.run_as(v_off, format('select public.admin_approve_tutor(%L)::text', t1)), 'ERR: approval_not_ready:document_pending:teaching_qualification');
    r := r || pg_temp.chk('E3', 'rejecting the optional file with a reason is allowed', pg_temp.run_as(v_off, format('select (public.admin_review_document(%L, %L, %L)->>%L)', d_opt, 'rejected', 'Not readable, send a clearer photo', 'tutor_still_ready')), 'true');
    r := r || pg_temp.chk('E4', 'a rejected optional document does not block', pg_temp.reasons(v_off, t1), 'READY');

    -- ---- F. approval: one transaction, one audit line ------------------------------------------------------------------------------
    r := r || pg_temp.chk('F1', 'the officer approves', pg_temp.run_as(v_off, format('select (public.admin_approve_tutor(%L)->>%L)', t1, 'ready')), 'true');
    select tp.is_verified::text || '/' || tp.onboarding_status::text || '/' || (tp.verified_at is not null)::text into t from public.tutor_profiles tp where tp.id = t1;
    r := r || pg_temp.chk('F2', 'verified, status verified, the time stamped', t, 'true/verified/true');
    select count(*)::text into t from public.admin_audit_logs a where a.target_entity_id = t1 and a.action::text = 'tutor_approved' and a.admin_id = v_off and a.metadata ->> 'via' = 'admin_approve_tutor';
    r := r || pg_temp.chk('F3', 'exactly one approval audit line, by the officer, written by the function', t, '1');
    r := r || pg_temp.chk('F4', 'a second approval is refused', pg_temp.run_as(v_off, format('select public.admin_approve_tutor(%L)::text', t1)), 'ERR: This tutor is already approved');
    select count(*)::text into t from public.admin_audit_logs a where a.target_entity_id = t1 and a.action::text = 'tutor_approved';
    r := r || pg_temp.chk('F5', 'and added no second audit line', t, '1');

    -- ---- G. after approval: a rejection of a document is an ALERT, nothing is suspended -----------------------------------------
    t := pg_temp.run_as(v_off, format('select (public.admin_review_document(%L, %L, %L)->>%L) || %L || (public.admin_review_document(%L, %L, %L)->%L)::text', d_pol, 'rejected', 'Certificate not accepted', 'tutor_still_ready', '|', d_pol, 'rejected', 'Certificate not accepted', 'reasons'));
    r := r || pg_temp.chk('G1', 'rejecting the police clearance of a verified tutor says: no longer ready, and why', t, 'false|["police_missing"]');
    select tp.is_verified::text into t from public.tutor_profiles tp where tp.id = t1;
    r := r || pg_temp.chk('G2', 'the tutor is STILL verified (alert only, no automatic hold)', t, 'true');
    select (a.rejection_reason) into t from public.tutor_verification_audits a where a.tutor_id = t1 and a.decision::text = 'rejected' and a.document_id = d_pol order by a.reviewed_at desc limit 1;
    r := r || pg_temp.chk('G3', 'the rejection and its reason are on the audit line', t, 'Certificate not accepted');

    -- ---- H. the audit line cannot be left out: if it fails, the approval is undone -------------------------------------------------
    perform pg_temp.doc(t2, 'identity_doc', 'verified', null);
    perform pg_temp.doc(t2, 'police_clearance', 'verified', td);
    perform pg_temp.doc(t2, 'proof_of_experience', 'verified', null);
    r := r || pg_temp.chk('H1', 'a second tutor is ready', pg_temp.reasons(v_off, t2), 'READY');
    execute 'create function pg_temp.no_audit() returns trigger language plpgsql as $f$ begin if new.action::text = ''tutor_approved'' then raise exception ''audit refused (test)''; end if; return new; end $f$';
    execute 'create trigger zz_no_audit before insert on public.admin_audit_logs for each row execute function pg_temp.no_audit()';
    r := r || pg_temp.chk('H2', 'with the audit insert failing, the approval fails', pg_temp.run_as(v_off, format('select public.admin_approve_tutor(%L)::text', t2)), 'ERR: audit refused (test)');
    select is_verified::text into t from public.tutor_profiles where id = t2;
    r := r || pg_temp.chk('H3', 'and the tutor is NOT left approved without a line', t, 'false');
    execute 'drop trigger zz_no_audit on public.admin_audit_logs';

    -- ---- I. rejection of a tutor -----------------------------------------------------------------------------------------------
    r := r || pg_temp.chk('I1', 'a short reason is refused', pg_temp.run_as(v_off, format('select public.admin_reject_tutor(%L, %L)::text', t2, 'no')), 'ERR: Give the reason (at least 10 characters)');
    r := r || pg_temp.chk('I2', 'a support agent cannot reject', pg_temp.run_as(v_sup, format('select public.admin_reject_tutor(%L, %L)::text', t2, 'not enough documents at all')), 'ERR: Only a verification officer or a super admin can reject a tutor');
    r := r || pg_temp.chk('I3', 'the officer rejects with a reason', pg_temp.run_as(v_off, format('select coalesce(public.admin_reject_tutor(%L, %L)::text, %L)', t2, 'does not meet the standard', 'done')), '');
    select tp.is_verified::text || '/' || tp.onboarding_status::text into t from public.tutor_profiles tp where tp.id = t2;
    r := r || pg_temp.chk('I4', 'status rejected', t, 'false/rejected');
    select count(*)::text into t from public.admin_audit_logs a where a.target_entity_id = t2 and a.action::text = 'tutor_rejected' and a.metadata ->> 'reason' = 'does not meet the standard';
    r := r || pg_temp.chk('I5', 'one rejection audit line with the reason', t, '1');
    r := r || pg_temp.chk('I6', 'rejecting again is refused', pg_temp.run_as(v_off, format('select public.admin_reject_tutor(%L, %L)::text', t2, 'does not meet the standard')), 'ERR: This tutor was already not approved');
    r := r || pg_temp.chk('I7', 'a verified tutor can be taken back with a reason', pg_temp.run_as(v_off, format('select coalesce(public.admin_reject_tutor(%L, %L)::text, %L)', t1, 'documents were found to be altered', 'done')), '');
    select tp.is_verified::text || '/' || tp.onboarding_status::text into t from public.tutor_profiles tp where tp.id = t1;
    r := r || pg_temp.chk('I8', 'and is no longer verified', t, 'false/rejected');
    select (a.metadata ->> 'was_verified') into t from public.admin_audit_logs a where a.target_entity_id = t1 and a.action::text = 'tutor_rejected' limit 1;
    r := r || pg_temp.chk('I9', 'the line records that they had been verified', t, 'true');

    -- ---- J. police clearance 7 months old ----------------------------------------------------------------------------------------
    perform pg_temp.doc(t6, 'identity_doc', 'verified', null);
    perform pg_temp.doc(t6, 'police_clearance', 'verified', (td - interval '7 months')::date);
    perform pg_temp.doc(t6, 'proof_of_experience', 'verified', null);
    r := r || pg_temp.chk('J1', 'a verified but old police certificate is "expired"', pg_temp.reasons(v_off, t6), 'police_expired');

    -- ---- K. what stays as it was (migration B is not here) ----------------------------------------------------------------------
    r := r || pg_temp.chk('K1', 'a direct table update with no documents is still refused by the old trigger',
      pg_temp.run_as(v_off, format($q$with x as (update public.tutor_profiles set is_verified = true, onboarding_status = 'verified' where id = %L returning id) select count(*)::text from x$q$, t3)),
      'ERR: approval_needs_documents:identity_missing,police_clearance_missing');
    select count(*)::text into t from pg_trigger where tgname in ('enforce_tutor_age_on_verify', 'enforce_tutor_documents_on_verify') and not tgisinternal;
    r := r || pg_temp.chk('K2', 'both old triggers on is_verified are still in place', t, '2');

    -- ---- L. the three replaced functions ------------------------------------------------------------------------------------------
    r := r || pg_temp.chk('L1', 'a support agent can no longer record a date of birth', pg_temp.run_as(v_sup, format('select public.admin_set_date_of_birth(%L, %L::date)::text', t5, adult)), 'ERR: Only a verification officer or a super admin can record a date of birth');
    r := r || pg_temp.chk('L2', 'the officer can', pg_temp.run_as(v_off, format('select coalesce(public.admin_set_date_of_birth(%L, %L::date)::text, %L)', t5, adult, 'done')), '');
    select count(*)::text into t from public.admin_audit_logs a where a.target_entity_id = t5 and a.action::text = 'date_of_birth_recorded' and a.metadata::text not like '%' || adult || '%';
    r := r || pg_temp.chk('L3', 'and the audit line does not carry the date', t, '1');
    r := r || pg_temp.chk('L4', 'a level reason of 9 characters is refused', pg_temp.run_as(v_off, format('select public.admin_assign_tier(%L, %L, %L)::text', t6, tier, '123456789')), 'ERR: Give the reason for this level (at least 10 characters)');
    r := r || pg_temp.chk('L5', 'a level reason of 10 characters is accepted', pg_temp.run_as(v_off, format('select coalesce(public.admin_assign_tier(%L, %L, %L)::text, %L)', t6, tier, '1234567890', 'done')), '');
    select tc.id::text into t from public.tutor_credentials tc where tc.tutor_id = t6 and tc.credential_code = 'admin_assigned';
    r := r || pg_temp.chk('L6', 'removing that credential with a short reason is refused', pg_temp.run_as(v_off, format('select public.admin_remove_credential(%L, %L)::text', t::uuid, 'short')), 'ERR: Give the reason (at least 10 characters)');
    r := r || pg_temp.chk('L7', 'and with a proper reason works', pg_temp.run_as(v_off, format('select coalesce(public.admin_remove_credential(%L, %L)::text, %L)', t::uuid, 'entered by mistake, wrong tutor', 'done')), '');

    -- ---- M. execute rights ----------------------------------------------------------------------------------------------------------
    select string_agg(f || '=' || a || s || v, ' ' order by f) into t from (
      select p.proname as f, has_function_privilege('anon', p.oid, 'execute')::int::text as a, has_function_privilege('authenticated', p.oid, 'execute')::int::text as s,
             has_function_privilege('service_role', p.oid, 'execute')::int::text as v
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('tutor_readiness', 'admin_approve_tutor', 'admin_reject_tutor', 'admin_review_document')) q;
    r := r || pg_temp.chk('M1', 'execute rights anon/signed-in/server key (0 no, 1 yes)', t,
      'admin_approve_tutor=010 admin_reject_tutor=010 admin_review_document=010 tutor_readiness=011');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
