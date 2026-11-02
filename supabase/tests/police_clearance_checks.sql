-- Rolled-back test of the police clearance and ID checks (CEO, 21 Oct 2026; migration 20261020180000). See README.md.
-- Run it TOGETHER with the migration in one statement (scripts/run-rolled-back-test.mjs <out> this-file the-migration) before the migration is
-- applied, or on its own after (the two md5 lines C20/C21 then check the stored text against the file). Every line ends "ok" or "FAIL (want ...)".
-- All fixtures use the subject "ZZ Police" so the real tutors cannot change a result. Nothing is kept.
-- 2 Nov 2026 (Legal's flag H2, free-sessions mode): run it with BOTH migrations in one statement (police first, then 20261102100000_free_sessions_mode.sql).
-- C20 then differs on purpose (the free block is inserted into claim_session_request); C20b takes exactly that block out and wants the old md5 back, C20c
-- wants the block after the approval, police and fit checks and before the first money step, and C36 to C42 repeat the certificate rule on FREE requests
-- (a child's request sent through send_request_free). Those checks are skipped when the free migration is not in the database.
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
  v_mum uuid := gen_random_uuid();     -- a guardian (free-sessions part)
  v_kid uuid := gen_random_uuid();     -- her 14-year-old learner
  e_k uuid; qk1 uuid; qk2 uuid; qf1 uuid;
  tw10 timestamptz; tw13 timestamptz; th10 timestamptz;
  v_blk text; v_wblk text; v_free boolean; p_ver int; p_pol int; p_fit int; p_wal int; p_free int; p_pay int; n_blk int; n_wblk int; ord text;
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
  -- C20 differs on purpose once the free-sessions migration is in the database: it inserts ONE block (below, character for character) into
  -- claim_session_request. C20b takes exactly that block out and wants the md5 above back; C20c wants the block once, after the approval check, the
  -- police check and the fit check, and before the first money step (so a tutor refused by any of them never reaches it).
  v_blk := $fb$

  -- FREE SESSIONS (CEO, 2 Nov 2026): a request sent without a card check is booked now, with no charge, no bank account and no
  -- commission. The Worker reads mode 'already_paid' and answers "booked", so the Worker does not change. Every check above still applies.
  if v_req.free_session then
    return jsonb_build_object('mode', 'already_paid', 'session_id', public.create_free_session(p_request_id, p_tutor_id));
  end if;
$fb$;
  -- 2 Nov 2026 (wallet booking, migration 20261102210000): a SECOND block, the wallet one, sits just before the free block (character for character).
  -- C20b takes out whichever of the two blocks are there; C20c wants each block once, in this order.
  v_wblk := $wb$

  -- WALLET BOOKING claim (CEO, 2 Nov 2026): a request paid from a wallet is booked now. The held price becomes the session's money, the tutor's
  -- share is credited only when the session is completed, and no bank account or Paystack call is involved. Every check above still applies.
  if v_req.paid_from_wallet then
    return jsonb_build_object('mode', 'already_paid', 'session_id', public.create_wallet_session(p_request_id, p_tutor_id, v_tutor.current_tier_id));
  end if;
$wb$;
  r := r || pg_temp.chk('C20b', 'stored claim_session_request with the free and wallet blocks taken out equals the migration file (md5 of its text)', (select md5(replace(replace(prosrc, v_wblk, ''), v_blk, '')) from pg_proc where oid = 'public.claim_session_request(uuid,uuid)'::regprocedure), '6d38cd1277ae7640295a09b8b59d94ba');
  select position('if not coalesce(v_tutor.is_verified, false)' in prosrc), position('public.police_clearance_problem(p_tutor_id)' in prosrc),
         position('public.request_fit_code(p_tutor_id, p_request_id)' in prosrc), position('WALLET BOOKING claim (CEO, 2 Nov 2026)' in prosrc),
         position('FREE SESSIONS (CEO, 2 Nov 2026)' in prosrc),
         position('public.create_session_from_request' in prosrc), (length(prosrc) - length(replace(prosrc, v_blk, ''))) / length(v_blk),
         (length(prosrc) - length(replace(prosrc, v_wblk, ''))) / length(v_wblk)
    into p_ver, p_pol, p_fit, p_wal, p_free, p_pay, n_blk, n_wblk
    from pg_proc where oid = 'public.claim_session_request(uuid,uuid)'::regprocedure;
  ord := case when n_blk = 0 and n_wblk = 0 then 'no free block'
              when n_blk = 1 and n_wblk = 0 and 0 < p_ver and p_ver < p_pol and p_pol < p_fit and p_fit < p_free and p_free < p_pay then 'approval < police < fit < free block < first money step'
              when n_blk = 1 and n_wblk = 1 and 0 < p_ver and p_ver < p_pol and p_pol < p_fit and p_fit < p_wal and p_wal < p_free and p_free < p_pay then 'approval < police < fit < wallet block < free block < first money step'
              else format('out of order: %s,%s,%s,%s,%s,%s x%s,%s', p_ver, p_pol, p_fit, p_wal, p_free, p_pay, n_blk, n_wblk) end;
  r := r || pg_temp.chk('C20c', 'where the wallet and free blocks sit in claim_session_request', ord,
    case when to_regprocedure('public.create_wallet_session(uuid,uuid,integer)') is not null then 'approval < police < fit < wallet block < free block < first money step'
         when to_regprocedure('public.create_free_session(uuid,uuid)') is not null then 'approval < police < fit < free block < first money step' else 'no free block' end);
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

  -- ---- FREE SESSIONS (migration 20261102100000, CEO 2 Nov 2026): the same rule for a request sent with no card check -----------------------
  -- Legal's flag H2: a tutor whose police certificate is missing or lapsed must not be able to accept a request from a child. A free request is
  -- 'card_verified' with free_session = true and no card; the child's is sent by the guardian through the real send_request_free(). At this point v1
  -- (only a rejected certificate), v3 (only a rejected one) and v5 (grandfathered, none) have no current certificate; v4 and v6 have one; v2 has one
  -- from today until the update below rejects it, which leaves only its 7-month-old one.
  v_free := to_regprocedure('public.send_request_free(uuid)') is not null;
  if v_free then
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
    tw10 := (mon + 2 + time '10:00') at time zone 'Africa/Johannesburg';
    tw13 := (mon + 2 + time '13:00') at time zone 'Africa/Johannesburg';
    th10 := (mon + 3 + time '10:00') at time zone 'Africa/Johannesburg';
    update system_settings set setting_value = 'true'::jsonb where setting_key = 'free_sessions_enabled';
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_mum, z,'authenticated','authenticated','pc.m.'||v_mum||'@example.invalid', jsonb_build_object('role','parent','first_name','Mpho','surname','Khumalo','date_of_birth',adult), '{}'),
      (v_kid, z,'authenticated','authenticated','pc.k.'||v_kid||'@example.invalid', jsonb_build_object('first_name','Kid','date_of_birth',(current_date - interval '14 years')::date::text), jsonb_build_object('created_by_guardian', v_mum));
    update parent_profiles set phone_number = '081 234 5678' where id = v_mum;
    insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_kid, 'ZZ Police', 'Grade 9') returning id into e_k;
    perform set_config('request.jwt.claims', '', true);
    insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
      values (v_kid, e_k, v_mum, tw10, 1, 'pending', 'initiated', 'pc_qk1', '1A', 1, 50, s1) returning id into qk1;
    insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
      values (v_kid, e_k, v_mum, tw13, 1, 'pending', 'initiated', 'pc_qk2', '1A', 1, 50, s1) returning id into qk2;
    insert into session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference, min_sub_tier_id, tier_id, charged_amount, institution_id)
      values (v_l, e_l, v_l, th10, 1, 'pending', 'initiated', 'pc_qf1', '1A', 1, 50, s1) returning id into qf1;

    r := r || pg_temp.chk('C36', 'the guardian sends the child''s request with no card check (send_request_free)', pg_temp.run_as(v_mum, format('select public.send_request_free(%L)', qk1)), 'free');
    select payment_status || ' ' || free_session || ' ' || coalesce(tutor_id::text, 'no tutor') || ' ' || status into t from session_requests where id = qk1;
    r := r || pg_temp.chk('C36b', 'it is now sent: card_verified, flagged free, no tutor, pending', t, 'card_verified true no tutor pending');
    perform pg_temp.run_as(v_mum, format('select public.send_request_free(%L)', qk2));
    perform pg_temp.run_as(v_l, format('select public.send_request_free(%L)', qf1));

    r := r || pg_temp.chk('C37', 'free request of a child, claim: approved, no certificate', pg_temp.try_claim(qk1, v1), 'police_clearance_missing');
    r := r || pg_temp.chk('C37b', 'free request of a child, claim: only a rejected certificate', pg_temp.try_claim(qk1, v3), 'police_clearance_missing');
    r := r || pg_temp.chk('C37c', 'free request of a child, claim: a grandfathered tutor is not excused', pg_temp.try_claim(qk1, v5), 'police_clearance_missing');
    update tutor_verification_documents set status = 'rejected' where tutor_id = v2 and document_type = 'police_clearance' and issued_on = td;
    r := r || pg_temp.chk('C37d', 'free request of a child, claim: only a certificate 7 months old', pg_temp.try_claim(qk1, v2), 'police_clearance_expired');
    r := r || pg_temp.chk('C37e', 'free request of a child, claim: a tutor who is not approved still hears the approval message first', pg_temp.try_claim(qk1, vu), 'Tutorlage has to verify your tutor profile before you can accept requests');
    select (tutor_id is null and status = 'pending' and payment_status = 'card_verified' and free_session and resulting_session_id is null)::text into t from session_requests where id = qk1;
    select count(*) into n from sessions where student_id = v_kid;
    r := r || pg_temp.chk('C37f', 'nothing was reserved or booked by any refusal (request untouched / sessions of the child)', t || '/' || n, 'true/0');
    r := r || pg_temp.chk('C38', 'free request of an adult learner, claim: approved, no certificate', pg_temp.try_claim(qf1, v1), 'police_clearance_missing');
    r := r || pg_temp.chk('C38b', 'free request of an adult learner, claim: only a certificate 7 months old', pg_temp.try_claim(qf1, v2), 'police_clearance_expired');
    r := r || pg_temp.chk('C39', 'the older accept cannot book a free request, even for a tutor with a current certificate', pg_temp.try_accept(qk1, v4), 'Another tutor already accepted this request, or it is no longer available.');

    r := r || pg_temp.chk('C40', 'free request of a child, claim: a tutor with a current certificate accepts', pg_temp.try_claim(qk1, v4), 'accepted (already_paid)');
    select (s.free_session and s.gross_amount = 0 and s.tutor_payout_amount = 0 and s.tutor_id = v4 and s.student_id = v_kid and q.payment_status = 'free' and q.status = 'accepted')::text
      into t from session_requests q join sessions s on s.id = q.resulting_session_id where q.id = qk1;
    r := r || pg_temp.chk('C40b', 'the session is flagged free with money stored as 0, for that tutor and the child; the request ends as free', t, 'true');

    update tutor_verification_documents set issued_on = (m6 - interval '1 day')::date where tutor_id = v6 and document_type = 'police_clearance';
    r := r || pg_temp.chk('C41', 'free request of a child, claim: a certificate that lapsed (6 months and a day old)', pg_temp.try_claim(qk2, v6), 'police_clearance_expired');
    select (tutor_id is null and status = 'pending' and payment_status = 'card_verified' and resulting_session_id is null)::text into t from session_requests where id = qk2;
    r := r || pg_temp.chk('C41b', 'and nothing was reserved', t, 'true');
    update tutor_verification_documents set issued_on = m6 where tutor_id = v6 and document_type = 'police_clearance';
    r := r || pg_temp.chk('C41c', 'with the last good day restored (exactly 6 months old) the same claim is accepted', pg_temp.try_claim(qk2, v6), 'accepted (already_paid)');
    r := r || pg_temp.chk('C42', 'a signed-in or signed-out caller cannot call the free booking function directly', (has_function_privilege('authenticated', 'public.create_free_session(uuid,uuid)', 'execute'))::text || '/' || (has_function_privilege('anon', 'public.create_free_session(uuid,uuid)', 'execute'))::text, 'false/false');
    update system_settings set setting_value = 'false'::jsonb where setting_key = 'free_sessions_enabled';
  end if;

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
