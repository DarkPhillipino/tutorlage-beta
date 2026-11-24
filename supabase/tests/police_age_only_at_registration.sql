-- Rolled-back test of migration 20261124200000_police_age_only_at_registration.sql (JOB POL, 24 Nov 2026): the police certificate's age matters only at registration.
-- Run it TOGETHER with the migration through scripts/run-rolled-back-test.mjs (the migration text first, this file second; the last statement raises, so everything is undone), or on its own
-- after the apply (it raises by itself). Made-up people only (no login, no email); the one real read (the ODI page) changes nothing. Every line ends "ok" or "FAIL (want ...)".
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  td date := (now() at time zone 'Africa/Johannesburg')::date;
  old date := ((now() at time zone 'Africa/Johannesburg')::date - interval '8 months')::date;
  adult text := (current_date - interval '30 years')::date::text;
  uid text := replace(gen_random_uuid()::text, '-', '');
  v_off uuid := gen_random_uuid();   -- a verification officer
  t1 uuid := gen_random_uuid();      -- VERIFIED, certificate 8 months old
  t2 uuid := gen_random_uuid();      -- NOT verified, certificate 8 months old (registration)
  t3 uuid := gen_random_uuid();      -- VERIFIED, only a rejected certificate
  t4 uuid := gen_random_uuid();      -- VERIFIED, no certificate at all
  t text; n int; odi_page jsonb;
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
      create function pg_temp.doc(p_tutor uuid, p_type text, p_status text, p_issued date) returns uuid language plpgsql as $f$
      declare i uuid;
      begin
        insert into public.tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
        values (p_tutor, p_type::public.doc_type, 'fixture/' || gen_random_uuid(), p_status::public.verification_status, p_issued) returning id into i;
        return i;
      end $f$ $mk$;
    -- the readiness reasons as one text, "READY" when none
    execute $mk$
      create function pg_temp.reasons(p_u uuid, p_tutor uuid) returns text language plpgsql as $f$
      begin
        return pg_temp.run_as(p_u, format('select case when (public.tutor_readiness(%L)->>%L)::boolean then %L else (select string_agg(x, %L) from jsonb_array_elements_text(public.tutor_readiness(%L)->%L) x) end', p_tutor, 'ready', 'READY', ',', p_tutor, 'reasons'));
      end $f$ $mk$;

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_off, z, 'authenticated', 'authenticated', 'pol.off.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Vic', 'surname', 'Officer', 'date_of_birth', adult), '{}'),
      (t1, z, 'authenticated', 'authenticated', 'pol.t1.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tia', 'date_of_birth', adult), '{}'),
      (t2, z, 'authenticated', 'authenticated', 'pol.t2.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tob', 'date_of_birth', adult), '{}'),
      (t3, z, 'authenticated', 'authenticated', 'pol.t3.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tam', 'date_of_birth', adult), '{}'),
      (t4, z, 'authenticated', 'authenticated', 'pol.t4.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tim', 'date_of_birth', adult), '{}');
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
      (v_off, 'Vic', 'Officer', 'pol.off.' || uid || '@example.invalid', '', 'verification_officer', true);
    insert into tutor_onboarding (tutor_id, track, consented_at) select x, 'experienced', now() from unnest(array[t1, t2, t3, t4]) x;
    -- every tutor has a verified ID and verified proof of experience (which is not one of the "results" documents, so no Results line); only the police certificate differs
    perform pg_temp.doc(x, 'identity_doc', 'verified', null) from unnest(array[t1, t2, t3, t4]) x;
    perform pg_temp.doc(x, 'proof_of_experience', 'verified', null) from unnest(array[t1, t2, t3, t4]) x;
    -- t1 and t3 are approved while the certificate is fresh; then t1's certificate AGES (the real case) and t3's is rejected; t4 has none; t2 is never approved
    perform pg_temp.doc(t1, 'police_clearance', 'verified', td);
    perform pg_temp.doc(t3, 'police_clearance', 'verified', td);
    update public.tutor_profiles set is_verified = true where id in (t1, t3, t4);
    update public.tutor_verification_documents set issued_on = old where tutor_id = t1 and document_type = 'police_clearance';
    update public.tutor_verification_documents set status = 'rejected' where tutor_id = t3 and document_type = 'police_clearance';
    perform pg_temp.doc(t2, 'police_clearance', 'verified', old);

    -- ---- A. readiness -------------------------------------------------------------------------------------------------------------
    r := r || pg_temp.chk('A1', 'a VERIFIED tutor whose certificate is 8 months old is still ready', pg_temp.reasons(v_off, t1), 'READY');
    r := r || pg_temp.chk('A2', 'registration stays strict: a tutor NOT yet verified with a certificate 8 months old is not ready', pg_temp.reasons(v_off, t2), 'police_expired');
    r := r || pg_temp.chk('A3', 'and the approval refuses her for that reason', pg_temp.run_as(v_off, format('select public.admin_approve_tutor(%L)::text', t2)), 'ERR: approval_not_ready:police_expired');
    r := r || pg_temp.chk('A4', 'a verified tutor whose only certificate was rejected is still not ready (missing)', pg_temp.reasons(v_off, t3), 'police_missing');
    r := r || pg_temp.chk('A5', 'a verified tutor with no certificate at all is still not ready (missing)', pg_temp.reasons(v_off, t4), 'police_missing');
    update public.tutor_verification_documents set issued_on = td where tutor_id = t2 and document_type = 'police_clearance';
    r := r || pg_temp.chk('A6', 'a new applicant with a fresh certificate is ready (the strict rule is unchanged)', pg_temp.reasons(v_off, t2), 'READY');
    update public.tutor_verification_documents set issued_on = old where tutor_id = t2 and document_type = 'police_clearance';

    -- ---- B. the request check and the tutor's own screen -------------------------------------------------------------------------------
    r := r || pg_temp.chk('B1', 'police_clearance_problem: verified + aged = none; not verified + aged = expired; rejected only = missing; none = missing',
      coalesce(public.police_clearance_problem(t1), 'none') || ' / ' || coalesce(public.police_clearance_problem(t2), 'none') || ' / ' || coalesce(public.police_clearance_problem(t3), 'none') || ' / ' || coalesce(public.police_clearance_problem(t4), 'none'),
      'none / police_clearance_expired / police_clearance_missing / police_clearance_missing');
    r := r || pg_temp.chk('B2', 'the verified tutor''s own screen: no problem and no "counts until" date',
      pg_temp.run_as(t1, 'select coalesce(problem, ''none'') || '' / '' || coalesce(expires_on::text, ''no date'') from public.my_police_clearance_status()'), 'none / no date');
    r := r || pg_temp.chk('B3', 'a tutor who is not yet verified still sees the date and the problem',
      pg_temp.run_as(t2, 'select coalesce(problem, ''none'') || '' / '' || (expires_on is not null)::text from public.my_police_clearance_status()'), 'police_clearance_expired / true');

    -- ---- C. the checked line --------------------------------------------------------------------------------------------------------------
    t := array_to_string(public.tutor_checked_lines(t1), ' | ');
    r := r || pg_temp.chk('C1', 'the line shows the month the certificate was ISSUED and does not disappear with age', t, 'ID checked | Police clearance checked, ' || to_char(old, 'FMMonth YYYY'));
    r := r || pg_temp.chk('C2', 'the forbidden words are never produced (vetted, certified, background-checked)', (t ~* '(vetted|certified|background)')::text, 'false');
    r := r || pg_temp.chk('C3', 'no verified certificate, no police line', coalesce(array_to_string(public.tutor_checked_lines(t3), ' | '), ''), 'ID checked');

    -- ---- D. the nightly check and the watcher's read -----------------------------------------------------------------------------------
    perform public.tutor_drift_scan();
    select count(*) into n from public.tutor_drift_findings f where f.tutor_id = t1 and f.kind = 'not_ready' and f.resolved_at is null;
    r := r || pg_temp.chk('D1', 'the nightly scan raises nothing for the verified tutor with the aged certificate', n::text, '0');
    select count(*) into n from public.tutor_drift_findings f where f.tutor_id in (t3, t4) and f.kind = 'not_ready' and f.resolved_at is null;
    r := r || pg_temp.chk('D2', 'and still raises the real gaps (a missing or rejected certificate)', n::text, '2');
    r := r || pg_temp.chk('D3', 'the admin watcher''s read (admin_tutor_drift) has no row for her, and has the two real gaps',
      pg_temp.run_as(v_off, format('select (count(*) filter (where tutor_id = %L))::text || ''/'' || (count(*) filter (where tutor_id in (%L, %L) and kind = %L))::text from public.admin_tutor_drift()', t1, t3, t4, 'not_ready')), '0/2');

    -- ---- E. the real page of the tutor with code ODI (only where she exists, is verified and has switched her page on; nothing is written) ----------
    if exists (select 1 from public.tutor_public_profile x join public.promo_codes pc on pc.owner_tutor_id = x.tutor_id and pc.active
                where x.is_public and pc.code = 'ODI') then
      odi_page := public.public_tutor_page('ODI');
      r := r || pg_temp.chk('E1', 'the ODI page answers with her data and no longer lacks the police line (an aged certificate does not hide it)',
        (odi_page is not null)::text || ' / ' || coalesce((odi_page -> 'checked')::text ~ 'Police clearance checked, ', false)::text, 'true / true');
      r := r || pg_temp.chk('E2', 'the ODI page never says vetted, certified or background-checked', (coalesce(odi_page::text, '') ~* '(vetted|certified|background)')::text, 'false');
    else
      r := r || 'E1 SKIP the ODI page is not on in this database' || E'\n';
    end if;
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
