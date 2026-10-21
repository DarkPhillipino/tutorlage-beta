-- Rolled-back test of the police clearance and ID checks (CEO, 21 Oct 2026; migration 20261020180000). See README.md.
-- Run it TOGETHER with the migration in one statement (scripts/run-rolled-back-test.mjs <out> this-file the-migration) before the migration is
-- applied, or on its own after (the two md5 lines C20/C21 then check the stored text against the file). Every line ends "ok" or "FAIL (want ...)".
-- All fixtures use the subject "ZZ Police" so the real tutors cannot change a result. Nothing is kept.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  td date := (now() at time zone 'Africa/Johannesburg')::date;
  mon date := (date_trunc('week', now() at time zone 'Africa/Johannesburg') + interval '14 days')::date;   -- a Monday, 1 to 2 weeks ahead
  v_l uuid := gen_random_uuid();       -- an adult learner
  v_adm uuid := gen_random_uuid();     -- an active admin
  a1 uuid := gen_random_uuid();        -- approval: no onboarding row, no documents
  a2 uuid := gen_random_uuid();        -- approval: grandfathered, no documents
  a3 uuid := gen_random_uuid();        -- approval: onboarding row, not grandfathered, no documents
  a4 uuid := gen_random_uuid();        -- approval: owner-level session
  v1 uuid := gen_random_uuid();        -- accept: approved, no police certificate at all
  v2 uuid := gen_random_uuid();        -- accept: only a certificate issued 7 months ago
  v3 uuid := gen_random_uuid();        -- accept: only a REJECTED certificate issued today
  v4 uuid := gen_random_uuid();        -- accept: an old one plus one issued a month ago (pending)
  v5 uuid := gen_random_uuid();        -- accept: grandfathered, no certificate
  v6 uuid := gen_random_uuid();        -- accept: certificate issued exactly 6 months ago (the last good day)
  vu uuid := gen_random_uuid();        -- not approved
  vs uuid[];
  c_caps uuid; s1 uuid; e_l uuid;
  qa uuid; qb uuid; qc uuid; qd uuid;
  t10 timestamptz; t13 timestamptz; t14 timestamptz; tue10 timestamptz;
  n int; t text;
  m1 date := (td - interval '1 month')::date;
  m6 date := (td - interval '6 months')::date;
  nfail int; nlines int; rep text;
begin
  begin   -- everything below; an unexpected error is reported with the lines before it instead of hiding them

  execute $mk$
    create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
      select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
             || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
    $f$ $mk$;
  -- a document row, added as the owner (the guard lets the owner write any status)
  execute $mk$
    create function pg_temp.doc(p_tutor uuid, p_type text, p_status text, p_issued date) returns void language sql as $f$
      insert into public.tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
      values (p_tutor, p_type::public.doc_type, 'fixture/' || gen_random_uuid(), p_status::public.verification_status, p_issued)
    $f$ $mk$;
  -- someone tries to set is_verified = true: p_role 'authenticated' (the admin app), 'service_role' (the Worker) or 'owner' (the SQL editor)
  execute $mk$
    create function pg_temp.approve(p_who uuid, p_tutor uuid, p_role text) returns text language plpgsql as $f$
    declare n int;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', p_who, 'role', p_role)::text, true);
      if p_role <> 'owner' then execute format('set local role %I', p_role); end if;
      begin
        update public.tutor_profiles set is_verified = true where id = p_tutor;
        get diagnostics n = row_count;
        reset role;
        return 'approved rows=' || n;
      exception when others then
        reset role;
        return sqlerrm;
      end;
    end $f$ $mk$;
  execute $mk$
    create function pg_temp.unapprove(p_tutor uuid) returns void language sql as $f$
      update public.tutor_profiles set is_verified = false where id = p_tutor
    $f$ $mk$;
  -- the live accept (what the Worker calls), then the older accept (called as the owner with the tutor's identity)
  execute $mk$
    create function pg_temp.try_claim(p_q uuid, p_u uuid) returns text language plpgsql as $f$
    declare j jsonb;
    begin
      set local role service_role;
      begin
        select public.claim_session_request(p_q, p_u) into j;
        reset role;
        return 'accepted (' || (j->>'mode') || ')';
      exception when others then
        reset role;
        return sqlerrm;
      end;
    end $f$ $mk$;
  execute $mk$
    create function pg_temp.try_accept(p_q uuid, p_u uuid) returns text language plpgsql as $f$
    declare s uuid;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true);
      begin
        s := public.accept_session_request(p_q);
        return 'accepted';
      exception when others then
        return sqlerrm;
      end;
    end $f$ $mk$;
  -- what a signed-in tutor's own screen reads
  execute $mk$
    create function pg_temp.status_of(p_u uuid) returns text language plpgsql as $f$
    declare s text;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin
        select coalesce(string_agg(coalesce(problem, 'ok') || '/' || coalesce(latest_issued_on::text, '-') || '/' || coalesce(expires_on::text, '-'), ';'), 'no rows')
          into s from public.my_police_clearance_status();
        reset role;
        return s;
      exception when others then
        reset role;
        return sqlerrm;
      end;
    end $f$ $mk$;

  t10 := (mon + time '10:00') at time zone 'Africa/Johannesburg';
  t13 := (mon + time '13:00') at time zone 'Africa/Johannesburg';
  t14 := (mon + time '14:00') at time zone 'Africa/Johannesburg';
  tue10 := (mon + 1 + time '10:00') at time zone 'Africa/Johannesburg';
  select id into c_caps from curricula where code = 'CAPS';

  -- ---- people -----------------------------------------------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_l,   z,'authenticated','authenticated','pc.l.'||v_l||'@example.invalid',   jsonb_build_object('role','student','first_name','Lee','date_of_birth',adult), '{}'),
    (v_adm, z,'authenticated','authenticated','pc.ad.'||v_adm||'@example.invalid','{}'::jsonb, '{}'),
    (a1, z,'authenticated','authenticated','pc.a1.'||a1||'@example.invalid', jsonb_build_object('role','tutor','first_name','A1','date_of_birth',adult), '{}'),
    (a2, z,'authenticated','authenticated','pc.a2.'||a2||'@example.invalid', jsonb_build_object('role','tutor','first_name','A2','date_of_birth',adult), '{}'),
    (a3, z,'authenticated','authenticated','pc.a3.'||a3||'@example.invalid', jsonb_build_object('role','tutor','first_name','A3','date_of_birth',adult), '{}'),
    (a4, z,'authenticated','authenticated','pc.a4.'||a4||'@example.invalid', jsonb_build_object('role','tutor','first_name','A4','date_of_birth',adult), '{}'),
    (v1, z,'authenticated','authenticated','pc.v1.'||v1||'@example.invalid', jsonb_build_object('role','tutor','first_name','V1','date_of_birth',adult), '{}'),
    (v2, z,'authenticated','authenticated','pc.v2.'||v2||'@example.invalid', jsonb_build_object('role','tutor','first_name','V2','date_of_birth',adult), '{}'),
    (v3, z,'authenticated','authenticated','pc.v3.'||v3||'@example.invalid', jsonb_build_object('role','tutor','first_name','V3','date_of_birth',adult), '{}'),
    (v4, z,'authenticated','authenticated','pc.v4.'||v4||'@example.invalid', jsonb_build_object('role','tutor','first_name','V4','date_of_birth',adult), '{}'),
    (v5, z,'authenticated','authenticated','pc.v5.'||v5||'@example.invalid', jsonb_build_object('role','tutor','first_name','V5','date_of_birth',adult), '{}'),
    (v6, z,'authenticated','authenticated','pc.v6.'||v6||'@example.invalid', jsonb_build_object('role','tutor','first_name','V6','date_of_birth',adult), '{}'),
    (vu, z,'authenticated','authenticated','pc.vu.'||vu||'@example.invalid', jsonb_build_object('role','tutor','first_name','VU','date_of_birth',adult), '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number) values (v_adm, 'T', 'Admin', 'x@example.invalid', '');
  vs := array[v1, v2, v3, v4, v5, v6];
  update profiles set date_of_birth = adult::date where id = any (array[a1, a2, a3, a4, vu] || vs);
  insert into tutor_onboarding (tutor_id, grandfathered) values (a2, true), (v5, true);
  insert into tutor_onboarding (tutor_id, track) values (a3, 'beginner');
  select count(*) into n from tutor_onboarding where tutor_id = a1;
  r := r || pg_temp.chk('C0', 'a1 has no onboarding row', n::text, '0');

  -- ---- APPROVAL (an admin, as the admin app does it) --------------------------------------------------------------------------
  r := r || pg_temp.chk('C1', 'no onboarding row, no documents: refused, both named', pg_temp.approve(v_adm, a1, 'authenticated'), 'approval_needs_documents:identity_missing,police_clearance_missing');
  perform pg_temp.doc(a1, 'identity_doc', 'pending', null);
  r := r || pg_temp.chk('C2', 'an ID (not yet checked) but no police certificate', pg_temp.approve(v_adm, a1, 'authenticated'), 'approval_needs_documents:police_clearance_missing');
  perform pg_temp.doc(a1, 'police_clearance', 'rejected', td);
  r := r || pg_temp.chk('C3', 'a rejected police certificate does not count', pg_temp.approve(v_adm, a1, 'authenticated'), 'approval_needs_documents:police_clearance_missing');
  perform pg_temp.doc(a1, 'police_clearance', 'pending', (td - interval '6 months' - interval '1 day')::date);
  r := r || pg_temp.chk('C4', 'a certificate issued 6 months and a day ago', pg_temp.approve(v_adm, a1, 'authenticated'), 'approval_needs_documents:police_clearance_expired');
  perform pg_temp.doc(a1, 'police_clearance', 'pending', null);
  r := r || pg_temp.chk('C5', 'a certificate with no issue date', pg_temp.approve(v_adm, a1, 'authenticated'), 'approval_needs_documents:police_clearance_expired');
  perform pg_temp.doc(a1, 'police_clearance', 'pending', td + 1);
  r := r || pg_temp.chk('C6', 'a certificate dated tomorrow', pg_temp.approve(v_adm, a1, 'authenticated'), 'approval_needs_documents:police_clearance_expired');
  delete from tutor_verification_documents where tutor_id = a1 and document_type = 'identity_doc';
  perform pg_temp.doc(a1, 'identity_doc', 'rejected', null);
  perform pg_temp.doc(a1, 'police_clearance', 'pending', m6);
  r := r || pg_temp.chk('C7', 'a good certificate (exactly 6 months old) but the ID was rejected', pg_temp.approve(v_adm, a1, 'authenticated'), 'approval_needs_documents:identity_missing');
  perform pg_temp.doc(a1, 'identity_doc', 'pending', null);
  r := r || pg_temp.chk('C8', 'ID on file + certificate issued exactly 6 months ago (not yet checked by anyone)', pg_temp.approve(v_adm, a1, 'authenticated'), 'approved rows=1');
  r := r || pg_temp.chk('C9', 'approving someone already approved is not blocked again', pg_temp.approve(v_adm, a1, 'authenticated'), 'approved rows=1');

  r := r || pg_temp.chk('C10', 'a grandfathered tutor with no documents is approved', pg_temp.approve(v_adm, a2, 'authenticated'), 'approved rows=1');
  r := r || pg_temp.chk('C11', 'an onboarding row that is not grandfathered is held to it', pg_temp.approve(v_adm, a3, 'authenticated'), 'approval_needs_documents:identity_missing,police_clearance_missing');
  perform pg_temp.unapprove(a2);
  -- (the Worker's service role has no direct update right on tutor_profiles on dev, so this is refused before the trigger; either way not approved)
  r := r || pg_temp.chk('C12', 'the Worker (service role) cannot approve a tutor with no documents', case when pg_temp.approve(v_adm, a3, 'service_role') like 'approved%' then 'approved' else 'refused' end, 'refused');
  r := r || pg_temp.chk('C13', 'a session with no API role (the owner typing SQL) is not bound', pg_temp.approve(v_adm, a4, 'owner'), 'approved rows=1');
  perform pg_temp.unapprove(a4);

  -- ---- the tutor's own view ---------------------------------------------------------------------------------------------------
  perform pg_temp.doc(v2, 'police_clearance', 'verified', (td - interval '7 months')::date);
  perform pg_temp.doc(v3, 'police_clearance', 'rejected', td);
  perform pg_temp.doc(v4, 'police_clearance', 'verified', (td - interval '8 months')::date);
  perform pg_temp.doc(v4, 'police_clearance', 'pending', m1);
  perform pg_temp.doc(v6, 'police_clearance', 'pending', m6);
  r := r || pg_temp.chk('C14', 'v1 sees: missing', pg_temp.status_of(v1), 'police_clearance_missing/-/-');
  r := r || pg_temp.chk('C15', 'v2 sees: expired, with the date', pg_temp.status_of(v2), 'police_clearance_expired/' || (td - interval '7 months')::date || '/' || ((td - interval '7 months')::date + interval '6 months')::date);
  r := r || pg_temp.chk('C16', 'v3 (rejected only) sees: missing', pg_temp.status_of(v3), 'police_clearance_missing/-/-');
  r := r || pg_temp.chk('C17', 'v4 (old plus a new one) sees: fine, and when it runs out', pg_temp.status_of(v4), 'ok/' || m1 || '/' || (m1 + interval '6 months')::date);
  r := r || pg_temp.chk('C18', 'an admin who is not a tutor gets no rows', pg_temp.status_of(v_adm), 'no rows');

  -- ---- who may call what ------------------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.police_clearance_problem(v1);
    r := r || 'C19 FAIL a signed-in user called the helper' || E'\n';
  exception when others then r := r || 'C19 the helper is closed to signed-in users: ' || sqlerrm || ' ok' || E'\n'; end;
  reset role;
  set local role anon;
  begin
    perform public.my_police_clearance_status();
    r := r || 'C19b FAIL a signed-out visitor called the status function' || E'\n';
  exception when others then r := r || 'C19b the status function is closed to signed-out visitors: ' || sqlerrm || ' ok' || E'\n'; end;
  reset role;
  r := r || pg_temp.chk('C20', 'stored claim_session_request equals the migration file (md5 of its text)', (select md5(prosrc) from pg_proc where oid = 'public.claim_session_request(uuid,uuid)'::regprocedure), '6d38cd1277ae7640295a09b8b59d94ba');
  r := r || pg_temp.chk('C21', 'stored accept_session_request equals the migration file (md5 of its text)', (select md5(prosrc) from pg_proc where oid = 'public.accept_session_request(uuid)'::regprocedure), '6441ca81efdc251fc83a18e672d541f4');
  r := r || pg_temp.chk('C21b', 'the helper, the trigger function and the status function equal the file', (select string_agg(md5(prosrc), ',' order by proname) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('police_clearance_problem', 'enforce_tutor_documents_on_verify', 'my_police_clearance_status')), '7d5be641fdafb06124bd0aae57597893,0d6850560c3014ae4ff528054190da24,e70fdd27b9d50c745cd3c8960c776a1b');
  r := r || pg_temp.chk('C21c', 'execute rights kept: the Worker can claim, a signed-in user cannot', (has_function_privilege('service_role', 'public.claim_session_request(uuid,uuid)', 'execute'))::text || '/' || (has_function_privilege('authenticated', 'public.claim_session_request(uuid,uuid)', 'execute'))::text || '/' || (has_function_privilege('authenticated', 'public.accept_session_request(uuid)', 'execute'))::text, 'true/false/false');

  -- ---- ACCEPTING --------------------------------------------------------------------------------------------------------------
  insert into schools_institutions (name, curriculum, curriculum_id) values ('ZZ Test CAPS school', 'caps', c_caps) returning id into s1;
  update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null, is_verified = true where id = any (vs);
  update tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null where id = vu;   -- not approved
  insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
    select x, 'ZZ Police', 'caps', 'Grade 8', 'Grade 12', 'verified' from unnest(vs) x;
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time)
    select x, d, '00:00', '24:00' from unnest(vs) x, generate_series(0, 6) d;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_l, 'ZZ Police', 'Grade 10') returning id into e_l;
  perform set_config('request.jwt.claims', '', true);
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, t10, 1, 'pending', 'paid', 'pc_qa', '1A', 1, 50, s1) returning id into qa;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, t13, 1, 'pending', 'paid', 'pc_qb', '1A', 1, 50, s1) returning id into qb;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, t14, 1, 'pending', 'paid', 'pc_qc', '1A', 1, 50, s1) returning id into qc;
  insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
    values (v_l, e_l, v_l, tue10, 1, 'pending', 'paid', 'pc_qd', '1A', 1, 50, s1) returning id into qd;

  r := r || pg_temp.chk('C22', 'claim: approved, no certificate', pg_temp.try_claim(qa, v1), 'police_clearance_missing');
  r := r || pg_temp.chk('C23', 'claim: only a certificate 7 months old', pg_temp.try_claim(qa, v2), 'police_clearance_expired');
  r := r || pg_temp.chk('C24', 'claim: only a rejected certificate', pg_temp.try_claim(qa, v3), 'police_clearance_missing');
  r := r || pg_temp.chk('C25', 'claim: a grandfathered tutor is not excused', pg_temp.try_claim(qa, v5), 'police_clearance_missing');
  r := r || pg_temp.chk('C26', 'claim: a tutor who is not approved still hears the approval message first', pg_temp.try_claim(qa, vu), 'Tutorlage has to verify your tutor profile before you can accept requests');
  r := r || pg_temp.chk('C27', 'older accept: no certificate', pg_temp.try_accept(qb, v1), 'police_clearance_missing');
  r := r || pg_temp.chk('C28', 'older accept: certificate 7 months old', pg_temp.try_accept(qb, v2), 'police_clearance_expired');
  r := r || pg_temp.chk('C29', 'older accept: a grandfathered tutor is not excused', pg_temp.try_accept(qb, v5), 'police_clearance_missing');
  select count(*) into n from session_requests where id in (qa, qb) and tutor_id is not null;
  r := r || pg_temp.chk('C30', 'nothing was reserved by any refusal', n::text, '0');
  r := r || pg_temp.chk('C31', 'claim: a newer certificate (issued a month ago, not yet checked) is enough', pg_temp.try_claim(qa, v4), 'accepted (already_paid)');
  r := r || pg_temp.chk('C32', 'older accept: a certificate issued exactly 6 months ago is the last good day', pg_temp.try_accept(qb, v6), 'accepted');
  perform pg_temp.doc(v2, 'police_clearance', 'pending', td);
  r := r || pg_temp.chk('C33', 'after v2 adds a new certificate (issued today) the claim works', pg_temp.try_claim(qc, v2), 'accepted (already_paid)');
  perform pg_temp.doc(v1, 'police_clearance', 'verified', td);
  update tutor_verification_documents set status = 'rejected' where tutor_id = v1;
  r := r || pg_temp.chk('C34', 'a certificate an admin rejects later stops the tutor accepting', pg_temp.try_claim(qd, v1), 'police_clearance_missing');
  r := r || pg_temp.chk('C35', 'v1 still approved, only accepting is stopped', (select is_verified::text from tutor_profiles where id = v1), 'true');

  exception when others then
    r := r || format('STOPPED EARLY by an unexpected error: %s', sqlerrm) || E'\n';
  end;

  -- The Supabase tool cuts the middle of a long error, so each report line is shortened to its id and its value (the part after the
  -- first ": "; a FAIL or STOPPED line stays whole). The FAIL count counts whole lines.
  select count(*) filter (where l like '%FAIL%' or l like 'STOPPED%'), count(*) filter (where l <> '')
    into nfail, nlines from regexp_split_to_table(r, E'\n') as l;
  select string_agg(case when l like '%FAIL%' or l like 'STOPPED%' then l else regexp_replace(l, '^(\S+) [^:]*: ', E'\\1 ') end, E'\n' order by o)
    into rep from regexp_split_to_table(r, E'\n') with ordinality as x(l, o) where l <> '';
  if coalesce(current_setting('test.runner', true), '') = 'on' then
    perform set_config('test.report', format(E'POLICE-CLEARANCE TEST (rolled back): %s FAIL line(s) in %s lines\n%s', nfail, nlines, rep), true);
  else
    raise exception E'POLICE-CLEARANCE TEST (rolled back): % FAIL line(s) in % lines\n%', nfail, nlines, rep;
  end if;
end $$;
