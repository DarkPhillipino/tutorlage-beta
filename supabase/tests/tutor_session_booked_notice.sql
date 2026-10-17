-- Rolled-back test of migration 20261017224500_tutor_session_booked_notice.sql (17 Oct 2026): when a session is booked the
-- session's tutor gets one notification, "You have an upcoming session", with the learner's first name, the subject and the time.
-- Run TOGETHER with the migration in one statement before it is applied (scripts/run-rolled-back-test.mjs), or on its own after.
-- Every line starts with ok or FAIL; the statement raises an error at the end on purpose, so nothing is kept.
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  tu uuid := gen_random_uuid();   -- the tutor
  ad uuid := gen_random_uuid();   -- an adult learner
  mum uuid := gen_random_uuid();  -- a parent
  kid uuid := gen_random_uuid();  -- a learner under 18, booked by the parent
  other uuid := gen_random_uuid();-- someone else
  e1 uuid; e2 uuid; s1 uuid; s2 uuid; s3 uuid;
  n int; n2 int; t text; b text; fname text; rel uuid; d1 timestamptz;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (tu, z,'authenticated','authenticated','sb.t.'||tu||'@example.invalid', jsonb_build_object('role','tutor','first_name','Thandi','surname','Tutor'), '{}'),
    (ad, z,'authenticated','authenticated','sb.a.'||ad||'@example.invalid', jsonb_build_object('first_name','Sipho','surname','Adult','date_of_birth',adult), '{}'),
    (mum, z,'authenticated','authenticated','sb.m.'||mum||'@example.invalid', jsonb_build_object('role','parent','first_name','Mum','surname','Parent','date_of_birth',adult), '{}'),
    (other, z,'authenticated','authenticated','sb.o.'||other||'@example.invalid', jsonb_build_object('first_name','Other','surname','Person','date_of_birth',adult), '{}');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (kid, z,'authenticated','authenticated','sb.k.'||kid||'@example.invalid',
     jsonb_build_object('first_name','Lerato','surname','Kid','date_of_birth',(current_date - interval '14 years')::date::text), jsonb_build_object('created_by_guardian', mum));
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (ad, 'Life Sciences', '11') returning id into e1;
  insert into student_subject_enrollments (student_id, subject_name, grade_level) values (kid, 'Mathematics', '8') returning id into e2;
  select split_part(trim(full_name), ' ', 1) into fname from profiles where id = ad;

  -- B0 a booked session writes ONE notice for the tutor, of the right kind, tied to the session, unread
  d1 := date_trunc('minute', now()) + interval '1 day';
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, enrollment_id)
  values (ad, tu, ad, d1, 50, 30, 50, 35, e1) returning id into s1;
  select count(*), max(title), max(body), max(related_session_id::text)::uuid into n, t, b, rel
    from notifications where profile_id = tu and type = 'session_booked';
  r := r || format('%s B0 one notice for the tutor: %s, "%s", tied to the session=%s (want 1, "You have an upcoming session", true)',
    case when n = 1 and t = 'You have an upcoming session' and rel = s1 then 'ok  ' else 'FAIL' end, n, t, rel = s1) || E'\n';

  -- B1 it says who, which subject and when (South African time), and where to go
  r := r || format('%s B1 the words: %s',
    case when b like format('Session with %s (Life Sciences), %%', fname)
          and b like '%' || to_char(d1 at time zone 'Africa/Johannesburg', 'HH24:MI') || '%'
          and b like '%Open Sessions to start the video call%' then 'ok  ' else 'FAIL' end, b) || E'\n';

  -- B2 nobody else is told by this trigger (the learner and the parent keep the notice create_session_from_request writes)
  select count(*) into n from notifications where type = 'session_booked' and profile_id <> tu and related_session_id = s1;
  r := r || format('%s B2 nobody but the tutor got a session_booked notice for it: %s (want 0)', case when n = 0 then 'ok  ' else 'FAIL' end, n) || E'\n';

  -- B3 a session booked by a parent for a learner under 18 tells the tutor the learner's first name, and a second booking adds a second notice
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, enrollment_id)
  values (kid, tu, mum, now(), 50, 30, 50, 35, e2) returning id into s2;
  select count(*) into n from notifications where profile_id = tu and type = 'session_booked';
  select body into b from notifications where related_session_id = s2 and type = 'session_booked';
  r := r || format('%s B3 the tutor has %s notices; the second says: %s',
    case when n = 2 and b like 'Session with Lerato (Mathematics), %' then 'ok  ' else 'FAIL' end, n, b) || E'\n';

  -- B4 a session with no subject on file still gets a clean notice (no empty brackets)
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (ad, tu, ad, now() + interval '3 days', 50, 30, 50, 35) returning id into s3;
  select body into b from notifications where related_session_id = s3 and type = 'session_booked';
  r := r || format('%s B4 no subject: %s', case when b like format('Session with %s, %%', fname) and b not like '%()%' then 'ok  ' else 'FAIL' end, b) || E'\n';

  -- B5 the tutor sees their own notices and nobody else's; an outsider sees none
  perform set_config('request.jwt.claims', jsonb_build_object('sub', tu, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from notifications where type = 'session_booked';
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n2 from notifications where type = 'session_booked';
  reset role;
  r := r || format('%s B5 the tutor reads %s, an outsider reads %s (want 3, 0)', case when n = 3 and n2 = 0 then 'ok  ' else 'FAIL' end, n, n2) || E'\n';

  -- B6 browsers cannot call the trigger function
  perform set_config('request.jwt.claims', jsonb_build_object('sub', tu, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.notify_tutor_session_booked(); t := 'CALLED'; exception when others then t := 'refused'; end;
  reset role;
  r := r || format('%s B6 a signed-in browser calling the function: %s (want refused)', case when t = 'refused' then 'ok  ' else 'FAIL' end, t) || E'\n';

  -- B7 updating a session (completing it, setting the link) adds no notice: the trigger is insert-only
  update sessions set meeting_url = 'https://meet.example.com/x' where id = s1;
  select count(*) into n from notifications where profile_id = tu and type = 'session_booked';
  r := r || format('%s B7 after an update the tutor still has %s notices (want 3)', case when n = 3 then 'ok  ' else 'FAIL' end, n) || E'\n';

  raise exception 'TUTOR SESSION BOOKED TEST (rolled back): %', r;
end $$;
