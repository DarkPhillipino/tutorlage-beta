-- Rolled-back test of a session that ends early (migration 20261115140000). See README.md.
-- Run it together with the migration in one rolled-back transaction (the migration text first, then this block), or on its own after the
-- migration is applied. Every line should read "ok"; the error message at the end is the report.
do $$
declare
  r text := E'\n';
  v_learner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_tutor uuid := gen_random_uuid();
  s_live uuid; s_late uuid; s_alone uuid; s_plain uuid; s_ack uuid; s_auto uuid;
  rm uuid; rm_late uuid; rm_alone uuid; rm_ack uuid; rm_auto uuid;
  e timestamptz; a timestamptz; st text; c int; n int; msg text;
  adult text := (current_date - interval '30 years')::date::text;
  z uuid := '00000000-0000-0000-0000-000000000000';
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_learner, z,'authenticated','authenticated','t.l.'||v_learner||'@example.invalid', jsonb_build_object('first_name','Learner','date_of_birth',adult), '{}'),
    (v_other, z,'authenticated','authenticated','t.o.'||v_other||'@example.invalid', jsonb_build_object('first_name','Other','date_of_birth',adult), '{}'),
    (v_tutor, z,'authenticated','authenticated','t.t.'||v_tutor||'@example.invalid', jsonb_build_object('role','tutor','first_name','Tutor'), '{}');
  update profiles set date_of_birth = adult::date where id = v_tutor;
  update tutor_profiles set is_verified = true where id = v_tutor;   -- 24 Nov 2026: only a verified tutor can open a video room (20261116190500)

  -- s_live: started 20 minutes ago, one hour long: still under way. Tutor and learner were both admitted.
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_learner, v_tutor, v_learner, now() - interval '20 minutes', 50, 30, 50, 35) returning id into s_live;
  insert into video_rooms (code, host_id, session_id, expires_at) values ('BBBBBBB2', v_tutor, s_live, now() + interval '1 day') returning id into rm;
  insert into video_room_members (room_id, profile_id, status, admitted_at) values (rm, v_tutor, 'admitted', now() - interval '19 minutes'), (rm, v_learner, 'admitted', now() - interval '19 minutes');

  -- s_late: started 2 hours ago (over): the tutor leaving now is the normal end.
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_learner, v_tutor, v_learner, now() - interval '2 hours', 50, 30, 50, 35) returning id into s_late;
  insert into video_rooms (code, host_id, session_id, expires_at) values ('BBBBBBB3', v_tutor, s_late, now() + interval '1 day') returning id into rm_late;
  insert into video_room_members (room_id, profile_id, status, admitted_at) values (rm_late, v_tutor, 'admitted', now() - interval '110 minutes'), (rm_late, v_learner, 'admitted', now() - interval '110 minutes');

  -- s_alone: under way, only the tutor was ever admitted (the learner is just waiting).
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_learner, v_tutor, v_learner, now() - interval '20 minutes', 50, 30, 50, 35) returning id into s_alone;
  insert into video_rooms (code, host_id, session_id, expires_at) values ('BBBBBBB4', v_tutor, s_alone, now() + interval '1 day') returning id into rm_alone;
  insert into video_room_members (room_id, profile_id, status, admitted_at) values (rm_alone, v_tutor, 'admitted', now() - interval '19 minutes'), (rm_alone, v_learner, 'waiting', null);

  -- s_plain: under way, no room, never marked early.
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_learner, v_tutor, v_learner, now() - interval '20 minutes', 50, 30, 50, 35) returning id into s_plain;

  -- Leaving that is NOT an early end.
  update video_room_members set status = 'left' where room_id = rm_late and profile_id = v_tutor;
  select ended_early_at into e from sessions where id = s_late;
  r := r || format('E1 tutor leaves after the scheduled end -> ended_early_at %s (want null)', coalesce(e::text,'null')) || E'\n';
  update video_room_members set status = 'left' where room_id = rm_alone and profile_id = v_tutor;
  select ended_early_at into e from sessions where id = s_alone;
  r := r || format('E2 tutor leaves a room nobody else was admitted to -> ended_early_at %s (want null)', coalesce(e::text,'null')) || E'\n';
  update video_room_members set status = 'left' where room_id = rm and profile_id = v_learner;
  select ended_early_at into e from sessions where id = s_live;
  r := r || format('E3 the LEARNER leaves, the tutor stays -> ended_early_at %s (want null)', coalesce(e::text,'null')) || E'\n';

  -- The tutor leaves early.
  update video_room_members set status = 'left' where room_id = rm and profile_id = v_tutor;
  select ended_early_at into e from sessions where id = s_live;
  r := r || format('E4 tutor leaves 40 minutes before the end -> ended_early_at %s (want set)', case when e is not null then 'set' else 'null' end) || E'\n';

  -- A reload: the tutor comes straight back.
  update video_room_members set status = 'admitted' where room_id = rm and profile_id = v_tutor;
  select ended_early_at into e from sessions where id = s_live;
  r := r || format('E5 tutor comes back -> ended_early_at %s (want null)', coalesce(e::text,'null')) || E'\n';

  -- Leaves again; the bell job waits two minutes.
  update video_room_members set status = 'left' where room_id = rm and profile_id = v_tutor;
  select public.notify_early_end_checkins() into n;
  r := r || format('E6 bell job right after the tutor left: %s told (want 0: waits 2 minutes)', n) || E'\n';
  update sessions set ended_early_at = now() - interval '3 minutes' where id = s_live;
  select public.notify_early_end_checkins() into n;
  select count(*) into c from notifications where related_session_id = s_live and type = 'session_check_in' and profile_id = v_learner and title = 'Is everything alright?';
  r := r || format('E7 bell job 3 minutes later: %s session notified, %s message to the learner (want 1 and 1)', n, c) || E'\n';
  select public.notify_early_end_checkins() into n;
  select count(*) into c from notifications where related_session_id = s_live and type = 'session_check_in';
  r := r || format('E8 the job again: %s more, %s messages in all (want 0 and 1: told once)', n, c) || E'\n';

  -- The tutor's lock, in the database.
  perform set_config('request.jwt.claims', json_build_object('sub', v_tutor, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.complete_session(s_live);
    r := r || 'E9 FAIL the tutor completed an early-ended session before its end' || E'\n';
  exception when others then
    msg := sqlerrm;
    r := r || format('E9 %s tutor marks the early-ended session complete before its end -> refused: %s', case when msg like 'You ended the session early. You can mark it complete from % (South African time).' then 'ok' else 'FAIL' end, msg) || E'\n';
  end;
  begin
    perform public.complete_session(s_plain);
    r := r || 'E10 FAIL the tutor completed a session before its end' || E'\n';
  exception when others then
    msg := sqlerrm;
    r := r || format('E10 %s a session not ended early is refused with the ordinary message: %s', case when msg = 'You can mark a session complete once its scheduled time has ended' then 'ok' else 'FAIL' end, msg) || E'\n';
  end;
  reset role;
  select status::text into st from sessions where id = s_live;
  r := r || format('E11 the early-ended session is still %s (want scheduled)', st) || E'\n';

  -- Answers: a stranger is refused, the learner may answer, a signed-out caller is refused.
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.acknowledge_early_end(s_live);
    r := r || 'E12 FAIL a stranger answered' || E'\n';
  exception when others then r := r || 'E12 ok a stranger can''t answer: ' || sqlerrm || E'\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_learner, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.acknowledge_early_end(s_live);
  reset role;
  select early_end_ack_at into a from sessions where id = s_live;
  r := r || format('E13 the learner answers "Yes, all fine" -> early_end_ack_at %s (want set)', case when a is not null then 'set' else 'null' end) || E'\n';
  set local role anon;
  begin
    perform public.acknowledge_early_end(s_live);
    r := r || 'E14 FAIL a signed-out caller answered' || E'\n';
  exception when others then r := r || 'E14 ok a signed-out caller can''t answer: ' || sqlerrm || E'\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_learner, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.notify_early_end_checkins();
    r := r || 'E15 FAIL a learner ran the bell job' || E'\n';
  exception when others then r := r || 'E15 ok a learner can''t run the bell job: ' || sqlerrm || E'\n'; end;
  reset role;

  -- An answered early end is not announced by the bell.
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_learner, v_tutor, v_learner, now() - interval '20 minutes', 50, 30, 50, 35) returning id into s_ack;
  update sessions set ended_early_at = now() - interval '5 minutes', early_end_ack_at = now() where id = s_ack;
  select public.notify_early_end_checkins() into n;
  r := r || format('E16 an early end the learner already answered: %s told (want 0)', n) || E'\n';

  -- After the scheduled end the tutor can mark it complete (the lock lifts by itself), and the credit trigger is the same one as always.
  update sessions set scheduled_start = now() - interval '2 hours' where id = s_live;
  perform set_config('request.jwt.claims', json_build_object('sub', v_tutor, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.complete_session(s_live);
  reset role;
  select status::text into st from sessions where id = s_live;
  r := r || format('E17 after the scheduled end the tutor marks the early-ended session complete -> %s (want completed)', st) || E'\n';

  -- Auto-complete is untouched: an early-ended session whose room was used by both completes 2 hours after its end, as before.
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
  values (v_learner, v_tutor, v_learner, now() - interval '4 hours', 50, 30, 50, 35) returning id into s_auto;
  insert into video_rooms (code, host_id, session_id, expires_at) values ('BBBBBBB5', v_tutor, s_auto, now() + interval '1 day') returning id into rm_auto;
  insert into video_room_members (room_id, profile_id, status, admitted_at) values (rm_auto, v_tutor, 'left', now() - interval '3 hours'), (rm_auto, v_learner, 'left', now() - interval '3 hours');
  update sessions set ended_early_at = now() - interval '200 minutes' where id = s_auto;
  perform public.auto_complete_sessions();
  select status::text into st from sessions where id = s_auto;
  r := r || format('E18 early-ended, ended 3h ago, room used by both -> auto-complete gives %s (want completed: unchanged)', st) || E'\n';
  select status::text into st from sessions where id = s_plain;
  r := r || format('E19 a session still under way is not auto-completed: %s (want scheduled)', st) || E'\n';

  raise exception 'SESSION EARLY END TEST (rolled back): %', r;
end $$;
