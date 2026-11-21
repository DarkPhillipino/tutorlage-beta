-- Fixture for the EXTENDED concurrent claim race (claim-race-extended.mjs, README.md). DEV DATABASE ONLY (wfpjoxetbprmllqqarwp). Like setup.sql it KEEPS its rows
-- (two or more real connections must see them); made-up people only (example.invalid, names starting Zzrace); cleanup.sql removes them and restores the settings.
-- One learner with R1000 in the wallet and a saved card, THREE verified tutors who may all take every request, one school and subject, and
--   4 wallet requests already SENT (R100 each, held)   : scenario W3, three tutors claim each at the same instant
--   4 card requests whose card check has PASSED (R100)  : scenario C3, the card route (claim mode `charge`; the database makes no Paystack call)
-- plus two scratch tables.
do $$
declare
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  v_l uuid := gen_random_uuid(); v_t1 uuid := gen_random_uuid(); v_t2 uuid := gen_random_uuid(); v_t3 uuid := gen_random_uuid();
  c_caps uuid; s1 uuid; e_l uuid; q uuid; k int; slot timestamptz; sent jsonb; st text;
  auth_ok jsonb := '{"authorization_code":"AUTH_zzrace123","reusable":true,"signature":"SIG_zzrace","last4":"4081","card_type":"visa ","bank":"TEST BANK","exp_month":"12","exp_year":"2030"}';
begin
  if current_database() <> 'postgres' or exists (select 1 from auth.users where email like 'zzrace.%@example.invalid') then
    raise exception 'race fixture already exists: run cleanup.sql first';
  end if;
  create table if not exists public.zzrace_results (scenario text, round int, request_id uuid, tutor_id uuid, started_at timestamptz, finished_at timestamptz, outcome text, detail text);
  create table if not exists public.zzrace_settings (setting_key text primary key, old_value jsonb);
  truncate public.zzrace_results;
  revoke all on public.zzrace_results, public.zzrace_settings from public, anon, authenticated;
  insert into public.zzrace_settings (setting_key, old_value)
    select setting_key, setting_value from public.system_settings where setting_key in ('wallet_payments_enabled', 'free_sessions_enabled') on conflict do nothing;
  update public.system_settings set setting_value = 'true'::jsonb where setting_key = 'wallet_payments_enabled';
  update public.system_settings set setting_value = 'false'::jsonb where setting_key = 'free_sessions_enabled';
  -- the card route needs the fee bearer set (it is 'account' on dev; the function refuses to charge without it)
  if not exists (select 1 from public.system_settings where setting_key = 'paystack_fee_bearer' and setting_value #>> '{}' in ('account', 'subaccount')) then
    raise exception 'paystack_fee_bearer is not set on this database: the card route cannot be tested';
  end if;

  select id into c_caps from public.curricula where code = 'CAPS';
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_l, z, 'authenticated', 'authenticated', 'zzrace.l.' || v_l || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Zzrace', 'surname', 'Learner', 'date_of_birth', adult), '{}'),
    (v_t1, z, 'authenticated', 'authenticated', 'zzrace.t1.' || v_t1 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zzrace', 'surname', 'TutorOne', 'date_of_birth', adult), '{}'),
    (v_t2, z, 'authenticated', 'authenticated', 'zzrace.t2.' || v_t2 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zzrace', 'surname', 'TutorTwo', 'date_of_birth', adult), '{}'),
    (v_t3, z, 'authenticated', 'authenticated', 'zzrace.t3.' || v_t3 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Zzrace', 'surname', 'TutorThree', 'date_of_birth', adult), '{}');
  update public.profiles set date_of_birth = adult::date where id in (v_l, v_t1, v_t2, v_t3);
  update public.tutor_profiles set current_tier_id = 1, current_sub_tier_id = '1A', institution_id = null, is_verified = true where id in (v_t1, v_t2, v_t3);
  insert into public.tutor_verification_documents (tutor_id, document_type, document_url, status, issued_on)
    select x, 'police_clearance'::public.doc_type, 'fixture/zzrace-police-' || x, 'verified'::public.verification_status, (now() at time zone 'Africa/Johannesburg')::date from unnest(array[v_t1, v_t2, v_t3]) x;
  insert into public.schools_institutions (name, curriculum, curriculum_id) values ('ZZ Race test school', 'caps', c_caps) returning id into s1;
  insert into public.tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status)
    select x, 'Zorology', 'caps', 'Grade 8', 'Grade 12', 'verified' from unnest(array[v_t1, v_t2, v_t3]) x;
  insert into public.tutor_availability (tutor_id, day_of_week, start_time, end_time) select x, d, '00:00', '24:00' from unnest(array[v_t1, v_t2, v_t3]) x, generate_series(0, 6) d;
  insert into public.student_subject_enrollments (student_id, subject_name, grade_level) values (v_l, 'Zorology', 'Grade 10') returning id into e_l;
  perform public.wallet_post(v_l, 'topup', 1000, 0, 'zzrace-top:' || v_l, null, 'race test top-up');

  -- scenario W3: four wallet requests, sent (money held), on four different slots two weeks ahead
  for k in 0..3 loop
    slot := ((date_trunc('week', now() at time zone 'Africa/Johannesburg') + interval '14 days')::date + time '08:00' + k * interval '2 hours') at time zone 'Africa/Johannesburg';
    insert into public.session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference,
           min_sub_tier_id, tier_id, charged_amount, institution_id, requested_tutor_id, expires_at, currency_code)
    values (v_l, e_l, v_l, slot, 1, 'pending', 'initiated', 'zzrace_w' || k || '_' || v_l, '1A', 1, 100, s1, null, null, 'ZAR') returning id into q;
    perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role', 'authenticated')::text, true);
    set local role authenticated;
    sent := public.send_request_wallet(q);
    reset role;
  end loop;

  -- scenario C3: four card requests (card check passed, as the Worker records it), on four slots a day later
  for k in 0..3 loop
    slot := ((date_trunc('week', now() at time zone 'Africa/Johannesburg') + interval '15 days')::date + time '08:00' + k * interval '2 hours') at time zone 'Africa/Johannesburg';
    insert into public.session_requests (student_id, enrollment_id, requested_by_profile_id, requested_start, duration_hours, status, payment_status, paystack_reference,
           min_sub_tier_id, tier_id, charged_amount, institution_id, requested_tutor_id, expires_at, currency_code)
    values (v_l, e_l, v_l, slot, 1, 'pending', 'initiated', 'zzrace_c' || k || '_' || v_l, '1A', 1, 100, s1, null, null, 'ZAR');
    set local role service_role;
    select public.record_card_verification('zzrace_c' || k || '_' || v_l, 100, 'ZAR', auth_ok, 'zzrace@example.invalid') into st;
    reset role;
    if st <> 'card_verified' then raise exception 'card request % did not reach card_verified (got %)', k, st; end if;
  end loop;
end $$;
