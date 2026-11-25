-- Rolled-back test of migration 20261125170000_police_age_one_rule.sql (PM line 81 B). On production run it ONLY as: begin; <migration if not yet
-- applied> <this file> rollback;  The block ends by raising, so nothing is kept. Made-up people only. Every line ends "ok" or "FAIL".
do $$
declare
  r text := ''; z uuid := '00000000-0000-0000-0000-000000000000';
  td date := (now() at time zone 'Africa/Johannesburg')::date;
  old date := ((now() at time zone 'Africa/Johannesburg')::date - interval '8 months')::date;
  adult text := (current_date - interval '30 years')::date::text;
  uid text := replace(gen_random_uuid()::text, '-', '');
  v_off uuid := gen_random_uuid(); t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); d1 uuid; d2 uuid;
begin
  create function pg_temp.chk(p_label text, p_got text, p_want text) returns text language sql as $f$
    select p_label || ': ' || coalesce(p_got, 'null') || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n' $f$;
  create function pg_temp.run_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
    declare v text;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin execute p_sql into v; reset role; return coalesce(v, 'null');
      exception when others then reset role; return 'ERR: ' || sqlerrm; end;
    end $f$;
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_off, z, 'authenticated', 'authenticated', 'one.off.' || uid || '@example.invalid', jsonb_build_object('first_name', 'Vic', 'surname', 'Officer', 'date_of_birth', adult), '{}'),
    (t1, z, 'authenticated', 'authenticated', 'one.t1.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tia', 'date_of_birth', adult), '{}'),
    (t2, z, 'authenticated', 'authenticated', 'one.t2.' || uid || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tob', 'date_of_birth', adult), '{}');
  insert into public.admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (v_off, 'Vic', 'Officer', 'one.off.' || uid || '@example.invalid', '', 'verification_officer', true);
  insert into public.tutor_onboarding (tutor_id, track, consented_at) select x, 'experienced', now() from unnest(array[t1, t2]) x;
  insert into public.tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
    select x, y.t::public.doc_type, 'fixture/' || gen_random_uuid(), 'verified'::public.verification_status, case when y.t = 'police_clearance' then td end
    from unnest(array[t1, t2]) x, (values ('identity_doc'), ('proof_of_experience'), ('police_clearance')) y(t);
  update public.tutor_profiles set is_verified = true where id = t1;
  update public.tutor_verification_documents set issued_on = old where tutor_id in (t1, t2) and document_type = 'police_clearance';

  r := r || pg_temp.chk('1 the age rule applies: verified', public.police_certificate_age_applies(t1)::text, 'false');
  r := r || pg_temp.chk('2 the age rule applies: not verified', public.police_certificate_age_applies(t2)::text, 'true');
  r := r || pg_temp.chk('3 accept check, verified with an 8-month certificate', public.police_clearance_problem(t1), null);
  r := r || pg_temp.chk('4 accept check, unverified with an 8-month certificate', public.police_clearance_problem(t2), 'police_clearance_expired');
  r := r || pg_temp.chk('5 sign-up pages finished, verified', public.tutor_onboarding_finished(t1)::text, 'true');
  r := r || pg_temp.chk('6 sign-up pages finished, unverified', public.tutor_onboarding_finished(t2)::text, 'false');
  r := r || pg_temp.chk('7 own status, verified', pg_temp.run_as(t1, 'select coalesce(problem, ''none'') || ''/'' || coalesce(expires_on::text, ''none'') from public.my_police_clearance_status()'), 'none/none');
  r := r || pg_temp.chk('8 own status, unverified still gets a date', pg_temp.run_as(t2, 'select problem || ''/'' || (expires_on is not null)::text from public.my_police_clearance_status()'), 'police_clearance_expired/true');
  r := r || pg_temp.chk('9 checklist counts_until, verified', pg_temp.run_as(t1, 'select coalesce(public.my_verification_checklist() -> ''police'' ->> ''counts_until'', ''none'')'), 'none');
  r := r || pg_temp.chk('10 checklist counts_until, unverified', pg_temp.run_as(t2, 'select (public.my_verification_checklist() -> ''police'' ->> ''counts_until'' is not null)::text'), 'true');
  r := r || pg_temp.chk('11 readiness police reason, verified', (select (public.tutor_readiness(t1) -> 'reasons')::text like '%police%')::text, 'false');
  r := r || pg_temp.chk('12 readiness police reason, unverified', (select (public.tutor_readiness(t2) -> 'reasons')::text like '%police_expired%')::text, 'true');
  insert into public.tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
    values (t1, 'police_clearance', 'fixture/' || gen_random_uuid(), 'pending', old) returning id into d1;
  insert into public.tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
    values (t2, 'police_clearance', 'fixture/' || gen_random_uuid(), 'pending', old) returning id into d2;
  perform pg_temp.run_as(v_off, format('select public.admin_review_document(%L, %L, null, null)::text', d1, 'verified'));
  r := r || pg_temp.chk('13 officer may verify an old certificate of a verified tutor', (select status::text from public.tutor_verification_documents where id = d1), 'verified');
  r := r || pg_temp.chk('14 and may not for a tutor registering', (pg_temp.run_as(v_off, format('select public.admin_review_document(%L, %L, null, null)::text', d2, 'verified')) like '%police_clearance_expired%')::text, 'true');
  r := r || pg_temp.chk('15 the rule is not callable from the app', (pg_temp.run_as(t1, format('select public.police_certificate_age_applies(%L)::text', t2)) like 'ERR: permission denied%')::text, 'true');
  raise exception E'REPORT police_age_one_rule\n%', r;
end $$;
