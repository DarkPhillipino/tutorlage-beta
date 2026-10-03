-- Rolled-back test of auto-completion after 48 hours and learner problem reports
-- (migration 20260930239000, master backlog 7u). See README.md.
do $$
declare
  r text := E'\n';
  v_mum uuid := gen_random_uuid();
  v_kid uuid := gen_random_uuid();
  v_adult uuid := gen_random_uuid();
  v_tutor uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  s49 uuid; s47 uuid; s60d uuid; s60x uuid; skid uuid; scan uuid;
  n int; s text; t timestamptz; did uuid;
  adult text := (current_date - interval '30 years')::date::text;
  z uuid := '00000000-0000-0000-0000-000000000000';
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_mum, z,'authenticated','authenticated','t.m.'||v_mum||'@example.invalid', jsonb_build_object('role','parent','first_name','Mum','date_of_birth',adult), '{}'),
    (v_adult, z,'authenticated','authenticated','t.a.'||v_adult||'@example.invalid', jsonb_build_object('first_name','Adult','date_of_birth',adult), '{}'),
    (v_tutor, z,'authenticated','authenticated','t.t.'||v_tutor||'@example.invalid', jsonb_build_object('role','tutor','first_name','Tutor'), '{}'),
    (v_stranger, z,'authenticated','authenticated','t.s.'||v_stranger||'@example.invalid', jsonb_build_object('first_name','Stranger','date_of_birth',adult), '{}'),
    (v_admin, z,'authenticated','authenticated','t.ad.'||v_admin||'@example.invalid', jsonb_build_object('first_name','Admin','date_of_birth',adult), '{}');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_kid, z,'authenticated','authenticated','t.k.'||v_kid||'@example.invalid',
     jsonb_build_object('first_name','Kid','date_of_birth',(current_date - interval '14 years')::date::text), jsonb_build_object('created_by_guardian', v_mum));
  insert into admin_profiles (id, first_name, surname, email) values (v_admin, 'Test', 'Admin', 't.ad.'||v_admin||'@example.invalid');

  -- Sessions (owner inserts). "Ended X hours ago" = scheduled_start + 1 hour duration.
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_adult, v_tutor, v_adult, now() - interval '50 hours', 50, 30, 50, 35) returning id into s49;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_adult, v_tutor, v_adult, now() - interval '48 hours', 50, 30, 50, 35) returning id into s47;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_adult, v_tutor, v_adult, now() - interval '61 hours', 50, 30, 50, 35) returning id into s60d;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_adult, v_tutor, v_adult, now() - interval '61 hours', 50, 30, 50, 35) returning id into s60x;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_kid, v_tutor, v_mum, now() - interval '3 hours', 50, 30, 50, 35) returning id into skid;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status)
  values (v_adult, v_tutor, v_adult, now() + interval '2 days', 50, 30, 50, 35, 'cancelled_by_student') returning id into scan;

  -- An open report on s60d (blocks), a dismissed one on s60x (doesn't).
  insert into platform_disputes (session_id, raised_by_id, reason, description, status) values
    (s60d, v_adult, 'no_show', 'The tutor did not join the call', 'open'),
    (s60x, v_adult, 'no_show', 'The tutor did not join the call', 'dismissed');

  select public.auto_complete_sessions() into n;
  r := r || format('U0 job completed %s sessions (want 2: the 49-hour one and the dismissed-report one)', n) || E'\n';
  select status::text, completed_at into s, t from sessions where id = s49;
  r := r || format('U1 ended 49h ago -> %s, completed_at set=%s (want completed, true)', s, t is not null) || E'\n';
  select status::text into s from sessions where id = s47;
  r := r || format('U2 ended 47h ago -> %s (want scheduled)', s) || E'\n';
  select status::text into s from sessions where id = s60d;
  r := r || format('U3 ended 60h ago, open report -> %s (want scheduled)', s) || E'\n';
  select status::text into s from sessions where id = s60x;
  r := r || format('U4 ended 60h ago, dismissed report -> %s (want completed)', s) || E'\n';
  select count(*) into n from notifications where related_session_id = s49 and type = 'session_completed' and profile_id in (v_adult, v_tutor);
  r := r || format('U5 learner and tutor told: %s (want 2)', n) || E'\n';

  -- The delay is a setting.
  update system_settings set setting_value = '1'::jsonb where setting_key = 'session_auto_complete_hours';
  perform public.auto_complete_sessions();
  select status::text into s from sessions where id = skid;
  r := r || format('U6 setting at 1 hour: session ended 2h ago -> %s (want completed)', s) || E'\n';
  update system_settings set setting_value = '48'::jsonb where setting_key = 'session_auto_complete_hours';

  -- Reports, on a session that ended 2 hours ago (created after the 1-hour run above).
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_adult, v_tutor, v_adult, now() - interval '3 hours', 50, 30, 50, 35) returning id into s47;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.report_session_problem(s47, 'no_show', 'Somebody else''s session');
    r := r || 'U7 FAIL stranger reported a problem on someone else''s session' || E'\n';
  exception when others then r := r || 'U7 ok stranger refused: ' || sqlerrm || E'\n'; end;
  begin
    insert into platform_disputes (session_id, raised_by_id, reason, description) values (s47, v_stranger, 'other', 'direct insert attempt');
    r := r || 'U8 FAIL direct insert into platform_disputes allowed' || E'\n';
  exception when others then r := r || 'U8 ok direct insert refused: ' || sqlerrm || E'\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_adult, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.report_session_problem(s47, 'no_show', 'short');
    r := r || 'U9 FAIL a 5-character report was accepted' || E'\n';
  exception when others then r := r || 'U9 ok too-short report refused: ' || sqlerrm || E'\n'; end;
  begin
    select public.report_session_problem(s47, 'no_show', 'The tutor never joined the meeting link.') into did;
    r := r || 'U10 ok learner reported a problem' || E'\n';
  exception when others then r := r || 'U10 FAIL: ' || sqlerrm || E'\n'; end;
  select status::text into s from platform_disputes where id = did;
  r := r || format('U11 learner reads own report: status %s (want open)', s) || E'\n';
  begin
    perform public.report_session_problem(s47, 'late_arrival', 'Another report while the first is open.');
    r := r || 'U12 FAIL a second open report by the same person' || E'\n';
  exception when others then r := r || 'U12 ok second open report refused: ' || sqlerrm || E'\n'; end;
  begin
    perform public.report_session_problem(scan, 'other', 'Reporting on a cancelled session.');
    r := r || 'U13 FAIL report on a cancelled session' || E'\n';
  exception when others then r := r || 'U13 ok cancelled session refused: ' || sqlerrm || E'\n'; end;
  begin
    perform public.auto_complete_sessions();
    r := r || 'U14 FAIL learner ran auto_complete_sessions' || E'\n';
  exception when others then r := r || 'U14 ok learner can''t run the job: ' || sqlerrm || E'\n'; end;
  reset role;

  select count(*) into n from notifications where profile_id = v_admin and type = 'dispute_opened';
  r := r || format('U15 admin notified of the report: %s (want 1)', n) || E'\n';

  -- The reported session (s47) is now held past 48 hours.
  update sessions set scheduled_start = now() - interval '60 hours' where id = s47;
  perform public.auto_complete_sessions();
  select status::text into s from sessions where id = s47;
  r := r || format('U16 reported session at 59h -> %s (want scheduled)', s) || E'\n';

  -- The guardian who booked and the tutor may also report (skid completed in U6; reports are
  -- allowed on completed sessions within 14 days).
  perform set_config('request.jwt.claims', json_build_object('sub', v_mum, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.report_session_problem(skid, 'technical_issue', 'The video kept dropping out for my child.');
    r := r || 'U17 ok the guardian who booked reported' || E'\n';
  exception when others then r := r || 'U17 FAIL: ' || sqlerrm || E'\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_tutor, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.report_session_problem(skid, 'other', 'The learner''s guardian could not be reached.');
    r := r || 'U18 ok the tutor reported' || E'\n';
  exception when others then r := r || 'U18 FAIL: ' || sqlerrm || E'\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  set local role anon;
  begin
    perform public.report_session_problem(s47, 'other', 'Anonymous report attempt here.');
    r := r || 'U19 FAIL anon reported' || E'\n';
  exception when others then r := r || 'U19 ok anon refused: ' || sqlerrm || E'\n'; end;
  reset role;

  raise exception 'AUTO-COMPLETE + REPORTS TEST (rolled back): %', r;
end $$;
