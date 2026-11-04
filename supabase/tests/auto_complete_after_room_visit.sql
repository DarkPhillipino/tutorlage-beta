-- Rolled-back test of the shorter auto-completion after a used video room (migration 20261104120000). See README.md.
-- Run it together with the migration in one rolled-back transaction (the migration text first, then this block), or on its own after the
-- migration is applied. Every line should read "ok"; the error message at the end is the report.
do $$
declare
  r text := E'\n';
  v_learner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_tutor uuid := gen_random_uuid();
  s_both uuid; s_none uuid; s_tutor_only uuid; s_waiting uuid; s_dispute uuid; s_1h uuid; s_old uuid; s_other uuid; s_cap uuid;
  rm uuid;
  n int; st text; c int;
  adult text := (current_date - interval '30 years')::date::text;
  z uuid := '00000000-0000-0000-0000-000000000000';
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_learner, z,'authenticated','authenticated','t.l.'||v_learner||'@example.invalid', jsonb_build_object('first_name','Learner','date_of_birth',adult), '{}'),
    (v_other, z,'authenticated','authenticated','t.o.'||v_other||'@example.invalid', jsonb_build_object('first_name','Other','date_of_birth',adult), '{}'),
    (v_tutor, z,'authenticated','authenticated','t.t.'||v_tutor||'@example.invalid', jsonb_build_object('role','tutor','first_name','Tutor'), '{}');

  -- Every session below ended N hours ago (start = N + 1 hours ago, the default one-hour length).
  -- s_both: ended 3h ago, room used by the tutor and the learner.
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_learner, v_tutor, v_learner, now() - interval '4 hours', 50, 30, 50, 35) returning id into s_both;
  insert into video_rooms (code, host_id, session_id, expires_at) values ('AAAAAAA2', v_tutor, s_both, now() + interval '1 day') returning id into rm;
  insert into video_room_members (room_id, profile_id, status, admitted_at) values (rm, v_tutor, 'left', now() - interval '3 hours'), (rm, v_learner, 'left', now() - interval '3 hours');

  -- s_none: ended 3h ago, no room at all.
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_learner, v_tutor, v_learner, now() - interval '4 hours', 50, 30, 50, 35) returning id into s_none;

  -- s_tutor_only: ended 3h ago, only the tutor was ever in the room (a learner who did not come must not get the tutor paid early).
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_learner, v_tutor, v_learner, now() - interval '4 hours', 50, 30, 50, 35) returning id into s_tutor_only;
  insert into video_rooms (code, host_id, session_id, expires_at) values ('AAAAAAA3', v_tutor, s_tutor_only, now() + interval '1 day') returning id into rm;
  insert into video_room_members (room_id, profile_id, status, admitted_at) values (rm, v_tutor, 'left', now() - interval '3 hours');

  -- s_waiting: ended 3h ago, the tutor was admitted and the other person is only listed as waiting (never admitted).
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_learner, v_tutor, v_learner, now() - interval '4 hours', 50, 30, 50, 35) returning id into s_waiting;
  insert into video_rooms (code, host_id, session_id, expires_at) values ('AAAAAAA4', v_tutor, s_waiting, now() + interval '1 day') returning id into rm;
  insert into video_room_members (room_id, profile_id, status, admitted_at) values (rm, v_tutor, 'left', now() - interval '3 hours'), (rm, v_learner, 'waiting', null);

  -- s_dispute: ended 3h ago, room used by both, but a problem report is open.
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_learner, v_tutor, v_learner, now() - interval '4 hours', 50, 30, 50, 35) returning id into s_dispute;
  insert into video_rooms (code, host_id, session_id, expires_at) values ('AAAAAAA5', v_tutor, s_dispute, now() + interval '1 day') returning id into rm;
  insert into video_room_members (room_id, profile_id, status, admitted_at) values (rm, v_tutor, 'left', now() - interval '3 hours'), (rm, v_learner, 'left', now() - interval '3 hours');
  insert into platform_disputes (session_id, raised_by_id, reason, description, status) values (s_dispute, v_learner, 'no_show', 'The tutor did not join the call', 'open');

  -- s_1h: ended 1h ago, room used by both: the 2 hours are not up yet.
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_learner, v_tutor, v_learner, now() - interval '2 hours', 50, 30, 50, 35) returning id into s_1h;
  insert into video_rooms (code, host_id, session_id, expires_at) values ('AAAAAAA6', v_tutor, s_1h, now() + interval '1 day') returning id into rm;
  insert into video_room_members (room_id, profile_id, status, admitted_at) values (rm, v_tutor, 'left', now() - interval '90 minutes'), (rm, v_learner, 'left', now() - interval '90 minutes');

  -- s_old: ended 49h ago, no room: the old rule still completes it.
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_learner, v_tutor, v_learner, now() - interval '50 hours', 50, 30, 50, 35) returning id into s_old;

  -- s_other: ended 3h ago, the other person is someone who is not the session's learner (a parent or guardian): counts the same.
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_learner, v_tutor, v_learner, now() - interval '4 hours', 50, 30, 50, 35) returning id into s_other;
  insert into video_rooms (code, host_id, session_id, expires_at) values ('AAAAAAA7', v_tutor, s_other, now() + interval '1 day') returning id into rm;
  insert into video_room_members (room_id, profile_id, status, admitted_at) values (rm, v_tutor, 'left', now() - interval '3 hours'), (rm, v_other, 'left', now() - interval '3 hours');

  -- Run 1: the room setting is 5 hours, so nothing that ended 3h ago may complete; only the 49h one (old rule) does.
  update system_settings set setting_value = '5'::jsonb where setting_key = 'session_auto_complete_hours_after_room';
  select public.auto_complete_sessions() into n;
  r := r || format('R1 setting at 5 hours: job completed %s sessions (want 1: only the 49h one with no room)', n) || E'\n';
  select status::text into st from sessions where id = s_old;
  r := r || format('R2 ended 49h ago, no room -> %s (want completed: the old 48-hour rule still works)', st) || E'\n';
  select status::text into st from sessions where id = s_both;
  r := r || format('R3 ended 3h ago, room used by both, setting 5h -> %s (want scheduled: the delay is a setting)', st) || E'\n';

  -- Run 2: back to the default 2 hours.
  update system_settings set setting_value = '2'::jsonb where setting_key = 'session_auto_complete_hours_after_room';
  select public.auto_complete_sessions() into n;
  r := r || format('R4 setting at 2 hours: job completed %s sessions (want 2: the tutor+learner room and the tutor+other room)', n) || E'\n';
  select status::text into st from sessions where id = s_both;
  r := r || format('R5 ended 3h ago, tutor and learner both in the room -> %s (want completed)', st) || E'\n';
  select status::text into st from sessions where id = s_other;
  r := r || format('R6 ended 3h ago, tutor and a parent/guardian both in the room -> %s (want completed)', st) || E'\n';
  select status::text into st from sessions where id = s_none;
  r := r || format('R7 ended 3h ago, no room -> %s (want scheduled)', st) || E'\n';
  select status::text into st from sessions where id = s_tutor_only;
  r := r || format('R8 ended 3h ago, only the tutor was in the room -> %s (want scheduled)', st) || E'\n';
  select status::text into st from sessions where id = s_waiting;
  r := r || format('R9 ended 3h ago, the other person was only waiting, never admitted -> %s (want scheduled)', st) || E'\n';
  select status::text into st from sessions where id = s_dispute;
  r := r || format('R10 ended 3h ago, room used by both, problem report open -> %s (want scheduled)', st) || E'\n';
  select status::text into st from sessions where id = s_1h;
  r := r || format('R11 ended 1h ago, room used by both -> %s (want scheduled: 2 hours not up)', st) || E'\n';

  -- Told, with the delay that applied.
  select count(*) into c from notifications where related_session_id = s_both and type = 'session_completed' and profile_id in (v_learner, v_tutor) and body like '%2 hours after it ended%';
  r := r || format('R12 learner and tutor told "2 hours after it ended": %s (want 2)', c) || E'\n';
  select count(*) into c from notifications where related_session_id = s_old and type = 'session_completed' and profile_id in (v_learner, v_tutor) and body like '%48 hours after it ended%';
  r := r || format('R13 the old-rule session says "48 hours after it ended": %s (want 2)', c) || E'\n';

  -- The short wait is never longer than the 48-hour setting: with the room setting at 100 a session that ended 49h ago with a used room still completes.
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_learner, v_tutor, v_learner, now() - interval '50 hours', 50, 30, 50, 35) returning id into s_cap;
  insert into video_rooms (code, host_id, session_id, expires_at) values ('AAAAAAA8', v_tutor, s_cap, now() + interval '1 day') returning id into rm;
  insert into video_room_members (room_id, profile_id, status, admitted_at) values (rm, v_tutor, 'left', now() - interval '49 hours'), (rm, v_learner, 'left', now() - interval '49 hours');
  update system_settings set setting_value = '100'::jsonb where setting_key = 'session_auto_complete_hours_after_room';
  perform public.auto_complete_sessions();
  select status::text into st from sessions where id = s_cap;
  r := r || format('R14 room setting 100h, used room, ended 49h ago -> %s (want completed: capped at 48)', st) || E'\n';

  -- The job is still closed to clients.
  perform set_config('request.jwt.claims', json_build_object('sub', v_learner, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.auto_complete_sessions();
    r := r || 'R15 FAIL a learner ran the job' || E'\n';
  exception when others then r := r || 'R15 ok a learner can''t run the job: ' || sqlerrm || E'\n'; end;
  reset role;

  raise exception 'AUTO-COMPLETE AFTER ROOM VISIT TEST (rolled back): %', r;
end $$;
