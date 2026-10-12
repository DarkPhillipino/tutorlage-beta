-- Rolled-back test of migration 20261009200000 (master 7bm: video rooms on our own WebRTC). See README.md.
-- Run with scripts/run-rolled-back-test.mjs (migration + this file in one always-failing statement), or after
-- the migration is applied, on its own (it always raises, so nothing is kept).
-- auth.uid() is simulated by setting request.jwt.claims; the Realtime policies are tried as the `authenticated` role.
--
-- Every line of the report starts with "ok" or "FAIL". A refusal only counts as ok when it is the function's own error
-- token (or the row-level-security error for the policies): a different error is a FAIL ("wrong error"), so a refusal
-- cannot pass for the wrong reason. The last line of the report counts both.
--
-- All times are the database's own clock. Inside one transaction now() does not move, so "silent for a while" is
-- made by setting a member's last_seen_at back by 100 seconds (the timeout is 90).
--
-- Not covered here (one transaction cannot do it): two sessions racing for the last seat. The lock that serialises them
-- (select ... for update on the room's row) is checked in group V20 only by reading the function text.
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  prov jsonb := '{"provider":"email","providers":["email"]}'::jsonb;
  adult_dob text := (current_date - interval '30 years')::date::text;
  minor_dob text := (current_date - interval '15 years')::date::text;
  ver_t text; ver_p text;
  t uuid := gen_random_uuid();    -- the tutor who hosts most rooms
  t2 uuid := gen_random_uuid();   -- a second tutor (visits, seats, the host's place)
  t3 uuid := gen_random_uuid();   -- a third tutor (open-rooms list, the limit of 5)
  s1 uuid := gen_random_uuid();   -- adult students
  s2 uuid := gen_random_uuid();
  s3 uuid := gen_random_uuid();
  s4 uuid := gen_random_uuid();
  p uuid := gen_random_uuid();    -- parent of the minor
  p2 uuid := gen_random_uuid();   -- an unrelated parent
  p3 uuid := gen_random_uuid();   -- a second and third guardian of the minor
  p4 uuid := gen_random_uuid();
  m uuid := gen_random_uuid();    -- learner under 18, linked to p, p3 and p4
  room uuid; room2 uuid; room3 uuid; room4 uuid; room5 uuid; room6 uuid; room7 uuid; room8 uuid; roomx uuid;
  sroom uuid; sroomb uuid; oldroom uuid;
  ses uuid := gen_random_uuid();
  ses2 uuid := gen_random_uuid();
  ses_far uuid := gen_random_uuid();
  ses_done uuid := gen_random_uuid();
  ses_pend uuid := gen_random_uuid();
  ses_late uuid := gen_random_uuid();
  ses_cancel uuid := gen_random_uuid();
  ses_exp uuid := gen_random_uuid();
  ses3 uuid := gen_random_uuid();
  va uuid; vb uuid; vc uuid; vd uuid; ve uuid;       -- page-visit ids
  vt uuid; vp3 uuid;
  v_txt text; v_txt2 text; v_txt3 text; v_cnt int; v_cnt2 int; v_bool boolean; v_bool2 boolean;
  v_ts timestamptz;
  n_ok int; n_fail int;
  rec record;
begin
  create function pg_temp.vr_line(p_name text, p_ok boolean, p_detail text) returns text
    language sql immutable as
    $f$ select (case when coalesce(p_ok, false) then 'ok   ' else 'FAIL ' end) || p_name || ': ' || coalesce(p_detail, '') || E'\n' $f$;

  select setting_value #>> '{}' into ver_t from system_settings where setting_key = 'current_terms_version';
  select setting_value #>> '{}' into ver_p from system_settings where setting_key = 'current_privacy_version';

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  select u.id, z, 'authenticated', 'authenticated', 'v.' || u.tag || '.' || u.id || '@example.invalid',
         jsonb_build_object('role', u.urole, 'date_of_birth', adult_dob)
           || case when u.urole = 'student'
                   then jsonb_build_object('accepted_terms_version', ver_t, 'accepted_privacy_version', ver_p)
                   else '{}'::jsonb end,
         prov
  from (values (t, 'tutor', 'tu1'), (t2, 'tutor', 'tu2'), (t3, 'tutor', 'tu3'),
               (s1, 'student', 's1'), (s2, 'student', 's2'), (s3, 'student', 's3'), (s4, 'student', 's4'),
               (p, 'parent', 'pa1'), (p2, 'parent', 'pa2'), (p3, 'parent', 'pa3'), (p4, 'parent', 'pa4'))
       as u(id, urole, tag);
  -- the learner under 18, added by parent p (the 7k order is enough here; these tests are about rooms, not sign-up)
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (m, z, 'authenticated', 'authenticated', 'kid-v.' || m || '@learners.tutorlage.invalid',
          jsonb_build_object('first_name', 'Kid', 'surname', 'Test', 'role', 'student', 'date_of_birth', minor_dob,
                             'accepted_terms_version', ver_t, 'accepted_privacy_version', ver_p),
          prov || jsonb_build_object('created_by_guardian', p, 'relationship', 'mother'));
  -- two more guardians of the same learner, linked directly (as the test owner)
  insert into parent_student_links (parent_id, student_id) values (p3, m), (p4, m);
  select count(*) into v_cnt from parent_student_links where student_id = m;
  r := r || pg_temp.vr_line('V0 setup',
    (select count(*) from tutor_profiles where id in (t, t2, t3)) = 3 and v_cnt = 3
      and (select count(*) from parent_student_links where parent_id = p and student_id = m) = 1,
    format('3 tutor profiles=%s, guardian links to the learner=%s (want 3,3)',
      (select count(*) from tutor_profiles where id in (t, t2, t3)), v_cnt));

  -- ================================================================================================
  -- V1: a tutor opens a room; the host is admitted at once; others cannot open one; the code's shape and
  -- uniqueness are enforced
  -- ================================================================================================
  room := public.create_video_room(t, 'K7QAB3XM', 4, false);
  select status into v_txt from video_room_members where room_id = room and profile_id = t;
  r := r || pg_temp.vr_line('V1 tutor opens a room', v_txt = 'admitted', format('host status=%s (want admitted)', v_txt));
  begin
    perform public.create_video_room(s1, 'ZZ9HJ2KP', 4, false);
    r := r || pg_temp.vr_line('V1b', false, 'a student opened a room');
  exception when others then
    r := r || pg_temp.vr_line('V1b student refused', sqlerrm = 'only_tutors_create_rooms', sqlerrm);
  end;
  begin
    perform public.create_video_room(t, 'ROOM1234', 4, false);
    r := r || pg_temp.vr_line('V1c', false, 'a code with a letter O was accepted');
  exception when others then
    r := r || pg_temp.vr_line('V1c bad code shape refused', sqlerrm like '%video_rooms_code_shape%', left(sqlerrm, 90));
  end;
  begin
    perform public.create_video_room(t, 'K7QAB3XM', 4, false);
    r := r || pg_temp.vr_line('V1d', false, 'a duplicate code was accepted');
  exception when others then
    r := r || pg_temp.vr_line('V1d duplicate code refused', sqlerrm like '%video_rooms_code_key%', left(sqlerrm, 90));
  end;
  begin
    perform public.create_video_room(t, 'QQQQ2222', 5, false);
    r := r || pg_temp.vr_line('V1e', false, 'a room of 5 was accepted');
  exception when others then
    r := r || pg_temp.vr_line('V1e room of 5 refused', sqlerrm like '%video_rooms_size%', left(sqlerrm, 90));
  end;

  -- ================================================================================================
  -- V2: the lobby: an adult student waits; the host is admitted; a student under 18 is refused; a parent may wait
  -- ================================================================================================
  va := gen_random_uuid();
  select member_status into v_txt from public.join_video_room('k7qab3xm', s1, va);
  r := r || pg_temp.vr_line('V2 adult student joins a tutor room', v_txt = 'waiting',
    format('%s (want waiting; the code is case-insensitive)', v_txt));
  select count(*) into v_cnt from video_room_members where room_id = room and profile_id = s1 and visit_id = va;
  r := r || pg_temp.vr_line('V2a the page visit is stored', v_cnt = 1, format('rows with the visit id=%s (want 1)', v_cnt));
  vt := gen_random_uuid();
  select member_status, is_host into v_txt, v_bool from public.join_video_room('K7QAB3XM', t, vt);
  r := r || pg_temp.vr_line('V2b host re-joins', v_txt = 'admitted' and v_bool, format('%s, is_host=%s (want admitted,t)', v_txt, v_bool));
  begin
    perform public.join_video_room('K7QAB3XM', m, gen_random_uuid());
    r := r || pg_temp.vr_line('V2c', false, 'a learner under 18 entered a tutor room');
  exception when others then
    r := r || pg_temp.vr_line('V2c under 18 refused', sqlerrm = 'adults_only', sqlerrm);
  end;
  select member_status into v_txt from public.join_video_room('K7QAB3XM', p, gen_random_uuid());
  r := r || pg_temp.vr_line('V2d parent joins a tutor room', v_txt = 'waiting', format('%s (want waiting)', v_txt));
  begin
    perform public.join_video_room('ZZZZZZZZ', s1, gen_random_uuid());
    r := r || pg_temp.vr_line('V2e', false, 'an unknown code was accepted');
  exception when others then
    r := r || pg_temp.vr_line('V2e unknown code', sqlerrm = 'room_closed', sqlerrm);
  end;

  -- ================================================================================================
  -- V3: only admitted people can use the room's signalling channel
  -- ================================================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s1, 'role', 'authenticated')::text, true);
  v_bool := public.video_room_can_signal(room);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t, 'role', 'authenticated')::text, true);
  v_bool2 := public.video_room_can_signal(room);
  r := r || pg_temp.vr_line('V3 signalling', v_bool = false and v_bool2 = true,
    format('waiting student can signal=%s, host can signal=%s (want f,t)', v_bool, v_bool2));
  perform public.admit_video_room_member(room, t, s1);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s1, 'role', 'authenticated')::text, true);
  v_bool := public.video_room_can_signal(room);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s2, 'role', 'authenticated')::text, true);
  v_bool2 := public.video_room_can_signal(room);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p, 'role', 'authenticated')::text, true);
  r := r || pg_temp.vr_line('V3b after admit', v_bool = true and v_bool2 = false and public.video_room_can_signal(room) = false,
    format('student can signal=%s, stranger=%s, the parent still waiting=%s (want t,f,f)', v_bool, v_bool2, public.video_room_can_signal(room)));
  begin
    perform public.admit_video_room_member(room, s1, p);
    r := r || pg_temp.vr_line('V3c', false, 'a non-host admitted someone');
  exception when others then
    r := r || pg_temp.vr_line('V3c non-host refused', sqlerrm = 'not_host', sqlerrm);
  end;

  -- ================================================================================================
  -- V4: what each person may see
  -- ================================================================================================
  select count(*) filter (where status = 'admitted'), count(*) filter (where status = 'waiting')
    into v_cnt, v_cnt2 from public.video_room_state(room, t);
  r := r || pg_temp.vr_line('V4 host sees the call and the lobby', v_cnt = 2 and v_cnt2 = 1,
    format('admitted=%s waiting=%s (want 2,1: host and student; the parent waits)', v_cnt, v_cnt2));
  select count(*) into v_cnt from public.video_room_state(room, s1);
  r := r || pg_temp.vr_line('V4b admitted student', v_cnt = 2, format('sees %s people (want 2: not the lobby)', v_cnt));
  select count(*) into v_cnt from public.video_room_state(room, p);
  r := r || pg_temp.vr_line('V4c waiting parent', v_cnt = 1, format('sees %s row (want 1: only themselves)', v_cnt));
  begin
    perform * from public.video_room_state(room, s2);
    r := r || pg_temp.vr_line('V4d', false, 'a stranger read a room''s state');
  exception when others then
    r := r || pg_temp.vr_line('V4d stranger refused', sqlerrm = 'not_allowed', sqlerrm);
  end;

  -- ================================================================================================
  -- V5: room size: a room of 2 holds the host and one guest, then says full
  -- ================================================================================================
  room2 := public.create_video_room(t, 'TEST2345', 2, false);
  perform public.join_video_room('TEST2345', s1, gen_random_uuid());
  perform public.admit_video_room_member(room2, t, s1);
  perform public.join_video_room('TEST2345', s2, gen_random_uuid());
  begin
    perform public.admit_video_room_member(room2, t, s2);
    r := r || pg_temp.vr_line('V5', false, 'a third person was admitted to a room of 2');
  exception when others then
    r := r || pg_temp.vr_line('V5 room of 2 is full', sqlerrm = 'room_full', sqlerrm);
  end;

  -- ================================================================================================
  -- V6: removing someone: they cannot come back; the host cannot be removed; non-members cannot be removed
  -- ================================================================================================
  perform public.remove_video_room_member(room2, t, s2);
  begin
    perform public.join_video_room('TEST2345', s2, gen_random_uuid());
    r := r || pg_temp.vr_line('V6', false, 'a removed person re-joined');
  exception when others then
    r := r || pg_temp.vr_line('V6 removed person refused', sqlerrm = 'removed', sqlerrm);
  end;
  begin
    perform public.remove_video_room_member(room2, t, t);
    r := r || pg_temp.vr_line('V6b', false, 'the host was removed');
  exception when others then
    r := r || pg_temp.vr_line('V6b host stays', sqlerrm = 'not_allowed', sqlerrm);
  end;
  begin
    perform public.remove_video_room_member(room2, t, p2);
    r := r || pg_temp.vr_line('V6c', false, 'a non-member was removed');
  exception when others then
    r := r || pg_temp.vr_line('V6c not in the room', sqlerrm = 'not_waiting', sqlerrm);
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s2, 'role', 'authenticated')::text, true);
  v_bool := public.video_room_can_signal(room2);
  r := r || pg_temp.vr_line('V6d removed person cannot signal', v_bool = false, format('can signal=%s (want f)', v_bool));

  -- ================================================================================================
  -- V7: leaving and coming back: an admitted person who left returns admitted, without the lobby
  -- ================================================================================================
  perform public.leave_video_room(room2, s1);
  select status into v_txt from video_room_members where room_id = room2 and profile_id = s1;
  select member_status into v_txt2 from public.join_video_room('TEST2345', s1, gen_random_uuid());
  r := r || pg_temp.vr_line('V7 leaving and returning', v_txt = 'left' and v_txt2 = 'admitted',
    format('after leaving: %s; on returning: %s (want left, admitted)', v_txt, v_txt2));

  -- ================================================================================================
  -- V8: a booked session's room: opened by its tutor, learner or guardian; entering admits those three at once
  -- (no lobby); others are refused; the same room is used each time; up to 4 at once (tutor + 3)
  -- ================================================================================================
  insert into sessions (id, student_id, tutor_id, status, duration_hours, hourly_rate_charged, platform_commission_pct,
                        gross_amount, tutor_payout_amount, scheduled_start, currency_code)
  values (ses, m, t, 'scheduled', 1, 50, 30, 50, 35, now() + interval '5 minutes', 'ZAR');
  select o.room_id, o.code into rec from public.open_video_session_room(ses, t, 'SESS2345', false) o;
  sroom := rec.room_id;
  select count(*) into v_cnt from video_room_members where room_id = sroom;
  r := r || pg_temp.vr_line('V8 session tutor opens the room', rec.code = 'SESS2345' and v_cnt = 0,
    format('code=%s, people entered by the opening=%s (want SESS2345, 0: nobody is entered until their page joins)', rec.code, v_cnt));
  select o.room_id, o.code into rec from public.open_video_session_room(ses, m, 'ZZ9HJ2KP', false) o;
  r := r || pg_temp.vr_line('V8a the learner (under 18) gets the same room', rec.room_id = sroom and rec.code = 'SESS2345',
    format('same room=%s, code=%s (want t, SESS2345)', rec.room_id = sroom, rec.code));
  select o.room_id into rec from public.open_video_session_room(ses, p, 'ZZ9HJ2KP', false) o;
  r := r || pg_temp.vr_line('V8b the learner''s guardian gets the same room', rec.room_id = sroom, format('same room=%s (want t)', rec.room_id = sroom));
  begin
    perform public.open_video_session_room(ses, p2, 'ZZ9HJ2KP', false);
    r := r || pg_temp.vr_line('V8c', false, 'an unrelated parent opened the session room');
  exception when others then
    r := r || pg_temp.vr_line('V8c unrelated parent refused', sqlerrm = 'not_allowed', sqlerrm);
  end;
  begin
    perform public.open_video_session_room(ses, s2, 'ZZ9HJ2KP', false);
    r := r || pg_temp.vr_line('V8d', false, 'an unrelated student opened the session room');
  exception when others then
    r := r || pg_temp.vr_line('V8d unrelated student refused', sqlerrm = 'not_allowed', sqlerrm);
  end;
  vt := gen_random_uuid();
  select member_status, is_host into v_txt, v_bool from public.join_video_room('SESS2345', t, vt);
  r := r || pg_temp.vr_line('V8e the tutor joins', v_txt = 'admitted' and v_bool, format('%s, is_host=%s (want admitted,t)', v_txt, v_bool));
  select member_status, is_host into v_txt, v_bool from public.join_video_room('SESS2345', m, gen_random_uuid());
  r := r || pg_temp.vr_line('V8f the learner under 18 joins', v_txt = 'admitted' and not v_bool, format('%s, is_host=%s (want admitted,f: no lobby)', v_txt, v_bool));
  select member_status into v_txt from public.join_video_room('SESS2345', p, gen_random_uuid());
  r := r || pg_temp.vr_line('V8g the guardian joins', v_txt = 'admitted', format('%s (want admitted)', v_txt));
  begin
    perform public.join_video_room('SESS2345', s2, gen_random_uuid());
    r := r || pg_temp.vr_line('V8h', false, 'a stranger entered the session room by its code');
  exception when others then
    r := r || pg_temp.vr_line('V8h code alone does not admit (student)', sqlerrm = 'not_allowed', sqlerrm);
  end;
  begin
    perform public.join_video_room('SESS2345', p2, gen_random_uuid());
    r := r || pg_temp.vr_line('V8i', false, 'an unrelated parent entered the session room by its code');
  exception when others then
    r := r || pg_temp.vr_line('V8i code alone does not admit (parent)', sqlerrm = 'not_allowed', sqlerrm);
  end;
  vp3 := gen_random_uuid();
  select member_status into v_txt from public.join_video_room('SESS2345', p3, vp3);
  r := r || pg_temp.vr_line('V8j second guardian joins (4th person)', v_txt = 'admitted', format('%s (want admitted)', v_txt));
  begin
    perform public.join_video_room('SESS2345', p4, gen_random_uuid());
    r := r || pg_temp.vr_line('V8k', false, 'a 5th person entered a room of 4');
  exception when others then
    r := r || pg_temp.vr_line('V8k fifth person refused', sqlerrm = 'room_full', sqlerrm);
  end;
  -- a seat freed by silence: p3 goes quiet, p4 takes the seat, p3's heartbeat then finds the seat gone
  update video_room_members set last_seen_at = now() - interval '100 seconds' where room_id = sroom and profile_id = p3;
  select member_status into v_txt from public.join_video_room('SESS2345', p4, gen_random_uuid());
  r := r || pg_temp.vr_line('V8l a silent guest''s seat is free', v_txt = 'admitted', format('p4 joins: %s (want admitted)', v_txt));
  select public.heartbeat_video_room(sroom, p3, vp3) into v_txt;
  select status into v_txt2 from video_room_members where room_id = sroom and profile_id = p3;
  r := r || pg_temp.vr_line('V8m the silent guest finds the seat gone', v_txt = 'left' and v_txt2 = 'left', format('heartbeat says %s, stored %s (want left,left)', v_txt, v_txt2));
  begin
    perform public.join_video_room('SESS2345', p3, gen_random_uuid());
    r := r || pg_temp.vr_line('V8n', false, 'the silent guest took a 5th seat');
  exception when others then
    r := r || pg_temp.vr_line('V8n and cannot come back while it is full', sqlerrm = 'room_full', sqlerrm);
  end;
  -- the tutor's place is kept when the tutor has not arrived: 3 guests fill the others, a 4th guest is refused,
  -- and the tutor can still walk in
  insert into sessions (id, student_id, tutor_id, status, duration_hours, hourly_rate_charged, platform_commission_pct,
                        gross_amount, tutor_payout_amount, scheduled_start, currency_code)
  values (ses2, m, t, 'scheduled', 1, 50, 30, 50, 35, now() + interval '5 minutes', 'ZAR');
  select o.room_id into sroomb from public.open_video_session_room(ses2, p, 'SESB2345', false) o;
  perform public.join_video_room('SESB2345', m, gen_random_uuid());
  perform public.join_video_room('SESB2345', p, gen_random_uuid());
  perform public.join_video_room('SESB2345', p3, gen_random_uuid());
  begin
    perform public.join_video_room('SESB2345', p4, gen_random_uuid());
    r := r || pg_temp.vr_line('V8o', false, 'a 4th guest took the tutor''s place before the tutor arrived');
  exception when others then
    r := r || pg_temp.vr_line('V8o tutor''s place kept while the tutor is not there', sqlerrm = 'room_full', sqlerrm);
  end;
  select member_status, is_host into v_txt, v_bool from public.join_video_room('SESB2345', t, gen_random_uuid());
  select count(*) into v_cnt from video_room_members where room_id = sroomb and status = 'admitted';
  r := r || pg_temp.vr_line('V8p the tutor can still enter', v_txt = 'admitted' and v_bool and v_cnt = 4,
    format('%s, is_host=%s, people admitted=%s (want admitted,t,4)', v_txt, v_bool, v_cnt));

  -- ================================================================================================
  -- V9: time and status: a session days away, one already over, one not confirmed, a completed one, and a cancelled
  -- one (even if its room was already made) have no room
  -- ================================================================================================
  insert into sessions (id, student_id, tutor_id, status, duration_hours, hourly_rate_charged, platform_commission_pct,
                        gross_amount, tutor_payout_amount, scheduled_start, currency_code)
  values (ses_far, m, t, 'scheduled', 1, 50, 30, 50, 35, now() + interval '3 days', 'ZAR');
  begin
    perform public.open_video_session_room(ses_far, t, 'FARR2345', false);
    r := r || pg_temp.vr_line('V9', false, 'a room opened for a session 3 days away');
  exception when others then
    r := r || pg_temp.vr_line('V9 too early', sqlerrm = 'room_closed', sqlerrm);
  end;
  insert into sessions (id, student_id, tutor_id, status, duration_hours, hourly_rate_charged, platform_commission_pct,
                        gross_amount, tutor_payout_amount, scheduled_start, currency_code, completed_at)
  values (ses_done, m, t, 'completed', 1, 50, 30, 50, 35, now() - interval '2 hours', 'ZAR', now() - interval '1 hour');
  begin
    perform public.open_video_session_room(ses_done, t, 'DNNE2345', false);
    r := r || pg_temp.vr_line('V9b', false, 'a room opened for a completed session');
  exception when others then
    r := r || pg_temp.vr_line('V9b completed session', sqlerrm = 'room_closed', sqlerrm);
  end;
  insert into sessions (id, student_id, tutor_id, status, duration_hours, hourly_rate_charged, platform_commission_pct,
                        gross_amount, tutor_payout_amount, scheduled_start, currency_code)
  values (ses_pend, m, t, 'pending_confirmation', 1, 50, 30, 50, 35, now() + interval '5 minutes', 'ZAR');
  begin
    perform public.open_video_session_room(ses_pend, t, 'PEND2345', false);
    r := r || pg_temp.vr_line('V9c', false, 'a room opened for a session that is not confirmed');
  exception when others then
    r := r || pg_temp.vr_line('V9c unconfirmed session', sqlerrm = 'room_closed', sqlerrm);
  end;
  insert into sessions (id, student_id, tutor_id, status, duration_hours, hourly_rate_charged, platform_commission_pct,
                        gross_amount, tutor_payout_amount, scheduled_start, currency_code)
  values (ses_late, m, t, 'scheduled', 1, 50, 30, 50, 35, now() - interval '3 hours', 'ZAR');
  begin
    perform public.open_video_session_room(ses_late, t, 'LATE2345', false);
    r := r || pg_temp.vr_line('V9d', false, 'a room opened more than an hour after the session should have ended');
  exception when others then
    r := r || pg_temp.vr_line('V9d too late', sqlerrm = 'room_closed', sqlerrm);
  end;
  insert into sessions (id, student_id, tutor_id, status, duration_hours, hourly_rate_charged, platform_commission_pct,
                        gross_amount, tutor_payout_amount, scheduled_start, currency_code)
  values (ses_cancel, m, t, 'scheduled', 1, 50, 30, 50, 35, now() + interval '5 minutes', 'ZAR');
  perform public.open_video_session_room(ses_cancel, t, 'CNCL2345', false);
  update sessions set status = 'cancelled_by_student' where id = ses_cancel;
  begin
    perform public.open_video_session_room(ses_cancel, t, 'CNCL3456', false);
    r := r || pg_temp.vr_line('V9e', false, 'a cancelled session''s room was opened again');
  exception when others then
    r := r || pg_temp.vr_line('V9e cancelled session, opening', sqlerrm = 'room_closed', sqlerrm);
  end;
  begin
    perform public.join_video_room('CNCL2345', t, gen_random_uuid());
    r := r || pg_temp.vr_line('V9f', false, 'the tutor entered a cancelled session''s room');
  exception when others then
    r := r || pg_temp.vr_line('V9f cancelled session, tutor joining', sqlerrm = 'room_closed', sqlerrm);
  end;
  begin
    perform public.join_video_room('CNCL2345', m, gen_random_uuid());
    r := r || pg_temp.vr_line('V9g', false, 'the learner entered a cancelled session''s room');
  exception when others then
    r := r || pg_temp.vr_line('V9g cancelled session, learner joining', sqlerrm = 'room_closed', sqlerrm);
  end;

  -- ================================================================================================
  -- V10: ending a room: only the host; afterwards nobody can enter, signal or read its state
  -- ================================================================================================
  begin
    perform public.end_video_room(room, s1);
    r := r || pg_temp.vr_line('V10', false, 'a non-host ended the room');
  exception when others then
    r := r || pg_temp.vr_line('V10 non-host refused', sqlerrm = 'not_host', sqlerrm);
  end;
  perform public.end_video_room(room, t);
  begin
    perform public.join_video_room('K7QAB3XM', s2, gen_random_uuid());
    r := r || pg_temp.vr_line('V10b', false, 'entered an ended room');
  exception when others then
    r := r || pg_temp.vr_line('V10b ended room refuses entry', sqlerrm = 'room_closed', sqlerrm);
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t, 'role', 'authenticated')::text, true);
  v_bool := public.video_room_can_signal(room);
  r := r || pg_temp.vr_line('V10c', v_bool = false, format('host can signal an ended room=%s (want f)', v_bool));

  -- ================================================================================================
  -- V11: nobody but the server can touch the tables or call the rules
  -- ================================================================================================
  r := r || pg_temp.vr_line('V11 tables',
    has_table_privilege('anon', 'public.video_rooms', 'select') = false
      and has_table_privilege('authenticated', 'public.video_rooms', 'select') = false
      and has_table_privilege('authenticated', 'public.video_room_members', 'insert') = false
      and has_table_privilege('service_role', 'public.video_rooms', 'select')
      and has_table_privilege('service_role', 'public.video_room_members', 'insert')
      and (select relrowsecurity from pg_class where oid = 'public.video_rooms'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.video_room_members'::regclass),
    format('anon select=%s, signed-in select=%s insert=%s, service_role select=%s insert=%s, rls=%s/%s (want f,f,f,t,t,t/t)',
      has_table_privilege('anon', 'public.video_rooms', 'select'),
      has_table_privilege('authenticated', 'public.video_rooms', 'select'),
      has_table_privilege('authenticated', 'public.video_room_members', 'insert'),
      has_table_privilege('service_role', 'public.video_rooms', 'select'),
      has_table_privilege('service_role', 'public.video_room_members', 'insert'),
      (select relrowsecurity from pg_class where oid = 'public.video_rooms'::regclass),
      (select relrowsecurity from pg_class where oid = 'public.video_room_members'::regclass)));
  select count(*) filter (where has_function_privilege('anon', f, 'execute')) as a,
         count(*) filter (where has_function_privilege('authenticated', f, 'execute')) as b,
         count(*) filter (where has_function_privilege('service_role', f, 'execute')) as c,
         count(*) as n
    into rec
  from unnest(array[
    'public.video_room_seat_timeout()'::regprocedure,
    'public.video_room_guests_seated(uuid,uuid)'::regprocedure,
    'public.create_video_room(uuid,text,integer,boolean)'::regprocedure,
    'public.video_room_enter(uuid,uuid,uuid)'::regprocedure,
    'public.join_video_room(text,uuid,uuid)'::regprocedure,
    'public.open_video_session_room(uuid,uuid,text,boolean)'::regprocedure,
    'public.admit_video_room_member(uuid,uuid,uuid)'::regprocedure,
    'public.remove_video_room_member(uuid,uuid,uuid)'::regprocedure,
    'public.leave_video_room(uuid,uuid,uuid)'::regprocedure,
    'public.heartbeat_video_room(uuid,uuid,uuid)'::regprocedure,
    'public.end_video_room(uuid,uuid)'::regprocedure,
    'public.video_room_state(uuid,uuid)'::regprocedure,
    'public.list_my_video_rooms(uuid)'::regprocedure,
    'public.purge_old_video_rooms()'::regprocedure
  ]) as f;
  r := r || pg_temp.vr_line('V11b the rules (14 functions)', rec.a = 0 and rec.b = 0 and rec.c = 14 and rec.n = 14,
    format('executable by anon=%s, signed-in=%s, service_role=%s of %s (want 0,0,14 of 14)', rec.a, rec.b, rec.c, rec.n));
  r := r || pg_temp.vr_line('V11c video_room_can_signal',
    has_function_privilege('anon', 'public.video_room_can_signal(uuid)', 'execute') = false
      and has_function_privilege('authenticated', 'public.video_room_can_signal(uuid)', 'execute'),
    format('anon=%s signed-in=%s (want f,t)',
      has_function_privilege('anon', 'public.video_room_can_signal(uuid)', 'execute'),
      has_function_privilege('authenticated', 'public.video_room_can_signal(uuid)', 'execute')));

  -- ================================================================================================
  -- V12: the Realtime policies. realtime.messages has no daily partition on dev yet (Realtime has never been used
  -- there) and belongs to another role, so a direct insert cannot be tried in a rolled-back run (the first attempt
  -- failed with "no partition of relation messages found"). So: copy the DEPLOYED policy text from pg_policies onto
  -- a stand-in table with the same two columns, and try sends and reads as the signed-in role. Every refusal must
  -- be the row-level-security error itself, so an unrelated error cannot pass as a refusal.
  -- ================================================================================================
  room3 := public.create_video_room(t, 'RLTM2345', 4, false);
  va := gen_random_uuid();
  perform public.join_video_room('RLTM2345', s1, va);
  perform public.admit_video_room_member(room3, t, s1);
  perform public.join_video_room('RLTM2345', s2, gen_random_uuid());   -- s2 is in the lobby
  select count(*) into v_cnt from pg_policies where schemaname = 'realtime' and tablename = 'messages'
    and policyname in ('video room members can receive', 'video room members can send');
  r := r || pg_temp.vr_line('V12 policies on realtime.messages', v_cnt = 2, format('%s (want 2)', v_cnt));

  create table public.vr_policy_probe (topic text, extension text);
  alter table public.vr_policy_probe enable row level security;
  grant select, insert on public.vr_policy_probe to authenticated;
  execute format('create policy vr_send on public.vr_policy_probe for insert to authenticated with check (%s)',
    replace((select with_check from pg_policies where schemaname = 'realtime' and tablename = 'messages'
               and policyname = 'video room members can send'), 'messages.extension', 'vr_policy_probe.extension'));
  execute format('create policy vr_receive on public.vr_policy_probe for select to authenticated using (%s)',
    replace((select qual from pg_policies where schemaname = 'realtime' and tablename = 'messages'
               and policyname = 'video room members can receive'), 'messages.extension', 'vr_policy_probe.extension'));

  -- an admitted member may send on the room's channel
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s1, 'role', 'authenticated')::text, true);
  perform set_config('realtime.topic', 'room:' || room3, true);
  begin
    set local role authenticated;
    insert into public.vr_policy_probe (topic, extension) values ('room:' || room3, 'broadcast');
    reset role;
    r := r || pg_temp.vr_line('V12b an admitted member may send on the room channel', true, 'sent');
  exception when others then
    reset role;
    r := r || pg_temp.vr_line('V12b member send', false, sqlerrm);
  end;

  -- someone in the lobby may not
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s2, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.vr_policy_probe (topic, extension) values ('room:' || room3, 'broadcast');
    reset role;
    r := r || pg_temp.vr_line('V12c', false, 'someone in the lobby sent on the room channel');
  exception when others then
    reset role;
    r := r || pg_temp.vr_line('V12c lobby refused by the policy', sqlerrm like '%row-level security%', left(sqlerrm, 90));
  end;

  -- a stranger (not in the room at all) may not
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p2, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.vr_policy_probe (topic, extension) values ('room:' || room3, 'broadcast');
    reset role;
    r := r || pg_temp.vr_line('V12c2', false, 'a stranger sent on the room channel');
  exception when others then
    reset role;
    r := r || pg_temp.vr_line('V12c2 stranger refused by the policy', sqlerrm like '%row-level security%', left(sqlerrm, 90));
  end;

  -- an admitted member on a room that does not exist, and on a topic that is not a room, may not
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s1, 'role', 'authenticated')::text, true);
  perform set_config('realtime.topic', 'room:' || gen_random_uuid(), true);
  begin
    set local role authenticated;
    insert into public.vr_policy_probe (topic, extension) values (current_setting('realtime.topic'), 'broadcast');
    reset role;
    r := r || pg_temp.vr_line('V12d', false, 'sent on a room that does not exist');
  exception when others then
    reset role;
    r := r || pg_temp.vr_line('V12d unknown room refused by the policy', sqlerrm like '%row-level security%', left(sqlerrm, 90));
  end;
  perform set_config('realtime.topic', 'lobby:anything', true);
  begin
    set local role authenticated;
    insert into public.vr_policy_probe (topic, extension) values ('lobby:anything', 'broadcast');
    reset role;
    r := r || pg_temp.vr_line('V12e', false, 'sent on a topic that is not a room');
  exception when others then
    reset role;
    r := r || pg_temp.vr_line('V12e other topic refused by the policy', sqlerrm like '%row-level security%', left(sqlerrm, 90));
  end;

  -- only the broadcast and presence extensions pass, even for an admitted member
  perform set_config('realtime.topic', 'room:' || room3, true);
  begin
    set local role authenticated;
    insert into public.vr_policy_probe (topic, extension) values ('room:' || room3, 'postgres_changes');
    reset role;
    r := r || pg_temp.vr_line('V12f', false, 'another extension was accepted');
  exception when others then
    reset role;
    r := r || pg_temp.vr_line('V12f other extension refused by the policy', sqlerrm like '%row-level security%', left(sqlerrm, 90));
  end;

  -- reading: an admitted member sees the room's messages; someone in the lobby sees nothing
  insert into public.vr_policy_probe (topic, extension) values ('room:' || room3, 'broadcast');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.vr_policy_probe;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt2 from public.vr_policy_probe;
  reset role;
  r := r || pg_temp.vr_line('V12g reading', v_cnt = 2 and v_cnt2 = 0,
    format('admitted member sees %s message(s), lobby person sees %s (want 2,0: the member''s own send in V12b and the one added here)', v_cnt, v_cnt2));

  -- a member who has gone silent past the timeout is no longer let onto the channel, until their page beats again
  update video_room_members set last_seen_at = now() - interval '100 seconds' where room_id = room3 and profile_id = s1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s1, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.vr_policy_probe (topic, extension) values ('room:' || room3, 'broadcast');
    reset role;
    r := r || pg_temp.vr_line('V12h', false, 'a silent member sent on the room channel');
  exception when others then
    reset role;
    r := r || pg_temp.vr_line('V12h silent member refused by the policy', sqlerrm like '%row-level security%', left(sqlerrm, 90));
  end;
  set local role authenticated;
  select count(*) into v_cnt from public.vr_policy_probe;
  reset role;
  r := r || pg_temp.vr_line('V12i a silent member reads nothing', v_cnt = 0, format('sees %s message(s) (want 0)', v_cnt));
  select public.heartbeat_video_room(room3, s1, va) into v_txt;
  begin
    set local role authenticated;
    insert into public.vr_policy_probe (topic, extension) values ('room:' || room3, 'broadcast');
    select count(*) into v_cnt from public.vr_policy_probe;
    reset role;
    r := r || pg_temp.vr_line('V12j after the heartbeat the member sends and reads again', v_txt = 'admitted' and v_cnt = 3,
      format('heartbeat says %s; sees %s message(s) (want admitted, 3)', v_txt, v_cnt));
  exception when others then
    reset role;
    r := r || pg_temp.vr_line('V12j', false, sqlerrm);
  end;

  -- ================================================================================================
  -- V14: the heartbeat: answers with the person's place and stamps the database's clock; refuses someone who was never
  -- in the room; the answers for removed, left and unknown rooms
  -- ================================================================================================
  room4 := public.create_video_room(t, 'HBEAT234', 3, false);
  vt := gen_random_uuid(); va := gen_random_uuid(); vb := gen_random_uuid();
  perform public.join_video_room('HBEAT234', t, vt);
  perform public.join_video_room('HBEAT234', s1, va);
  perform public.join_video_room('HBEAT234', s2, vb);
  perform public.admit_video_room_member(room4, t, s1);
  select public.heartbeat_video_room(room4, t, vt) into v_txt;
  r := r || pg_temp.vr_line('V14 host beats', v_txt = 'admitted', format('%s (want admitted)', v_txt));
  select public.heartbeat_video_room(room4, s2, vb) into v_txt;
  r := r || pg_temp.vr_line('V14b someone in the lobby beats', v_txt = 'waiting', format('%s (want waiting)', v_txt));
  update video_room_members set last_seen_at = now() - interval '100 seconds' where room_id = room4 and profile_id = s1;
  select public.heartbeat_video_room(room4, s1, va) into v_txt;
  select last_seen_at into v_ts from video_room_members where room_id = room4 and profile_id = s1;
  r := r || pg_temp.vr_line('V14c a beat stamps the database clock', v_txt = 'admitted' and v_ts = now(),
    format('answer=%s, last_seen_at is now()=%s (want admitted,t)', v_txt, v_ts = now()));
  select public.heartbeat_video_room(room4, s1, null) into v_txt;
  r := r || pg_temp.vr_line('V14d a beat without a visit id still works', v_txt = 'admitted', format('%s (want admitted)', v_txt));
  begin
    perform public.heartbeat_video_room(room4, p2, gen_random_uuid());
    r := r || pg_temp.vr_line('V14e', false, 'someone who was never in the room was answered');
  exception when others then
    r := r || pg_temp.vr_line('V14e non-participant refused', sqlerrm = 'not_allowed', sqlerrm);
  end;
  begin
    perform public.heartbeat_video_room(gen_random_uuid(), s1, va);
    r := r || pg_temp.vr_line('V14f', false, 'a room that does not exist was answered');
  exception when others then
    r := r || pg_temp.vr_line('V14f unknown room refused', sqlerrm = 'room_closed', sqlerrm);
  end;
  perform public.remove_video_room_member(room4, t, s2);
  select public.heartbeat_video_room(room4, s2, vb) into v_txt;
  r := r || pg_temp.vr_line('V14g a removed person beats', v_txt = 'removed', format('%s (want removed)', v_txt));
  perform public.leave_video_room(room4, s1, va);
  select public.heartbeat_video_room(room4, s1, va) into v_txt;
  select last_seen_at into v_ts from video_room_members where room_id = room4 and profile_id = s1;
  r := r || pg_temp.vr_line('V14h a person who left beats', v_txt = 'left', format('%s (want left)', v_txt));

  -- ================================================================================================
  -- V15: silence: a guest silent for more than 90 seconds stops counting toward the room's size and the lobby; their
  -- seat can go to someone else; they come back only if there is room
  -- ================================================================================================
  room5 := public.create_video_room(t, 'SLNT2345', 3, false);   -- the host and 2 guests
  va := gen_random_uuid(); vb := gen_random_uuid(); vc := gen_random_uuid(); vd := gen_random_uuid(); ve := gen_random_uuid();
  perform public.join_video_room('SLNT2345', s1, va);
  perform public.join_video_room('SLNT2345', s2, vb);
  perform public.join_video_room('SLNT2345', s3, vc);
  perform public.admit_video_room_member(room5, t, s1);
  perform public.admit_video_room_member(room5, t, s2);
  begin
    perform public.admit_video_room_member(room5, t, s3);
    r := r || pg_temp.vr_line('V15', false, 'a third guest was admitted to a room of 3');
  exception when others then
    r := r || pg_temp.vr_line('V15 room of 3 is full', sqlerrm = 'room_full', sqlerrm);
  end;
  update video_room_members set last_seen_at = now() - interval '100 seconds' where room_id = room5 and profile_id = s1;
  select count(*) into v_cnt from public.video_room_state(room5, t) where status = 'admitted';
  select count(*) into v_cnt2 from public.video_room_state(room5, t) where profile_id = s1;
  r := r || pg_temp.vr_line('V15b the host does not see a silent guest', v_cnt = 2 and v_cnt2 = 0,
    format('admitted listed=%s (want 2: host and s2), silent guest listed=%s (want 0)', v_cnt, v_cnt2));
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s1, 'role', 'authenticated')::text, true);
  v_bool := public.video_room_can_signal(room5);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s2, 'role', 'authenticated')::text, true);
  v_bool2 := public.video_room_can_signal(room5);
  r := r || pg_temp.vr_line('V15c a silent guest cannot signal', v_bool = false and v_bool2 = true,
    format('silent guest=%s, guest who beat=%s (want f,t)', v_bool, v_bool2));
  perform public.admit_video_room_member(room5, t, s3);   -- the silent guest's seat is free now
  select public.heartbeat_video_room(room5, s1, va) into v_txt;
  select status into v_txt2 from video_room_members where room_id = room5 and profile_id = s1;
  r := r || pg_temp.vr_line('V15d the silent guest finds the seat gone', v_txt = 'left' and v_txt2 = 'left',
    format('heartbeat says %s, stored %s (want left,left)', v_txt, v_txt2));
  begin
    perform public.join_video_room('SLNT2345', s1, vd);
    r := r || pg_temp.vr_line('V15e', false, 'the silent guest took a seat that is not free');
  exception when others then
    r := r || pg_temp.vr_line('V15e and cannot come back while the room is full', sqlerrm = 'room_full', sqlerrm);
  end;
  perform public.leave_video_room(room5, s2);
  select member_status into v_txt from public.join_video_room('SLNT2345', s1, vd);
  r := r || pg_temp.vr_line('V15f once a seat is free they come back', v_txt = 'admitted', format('%s (want admitted)', v_txt));
  -- silent, but nobody needed the seat: the beat simply takes it back
  update video_room_members set last_seen_at = now() - interval '100 seconds' where room_id = room5 and profile_id = s3;
  select count(*) into v_cnt from public.video_room_state(room5, t) where profile_id = s3;
  select public.heartbeat_video_room(room5, s3, vc) into v_txt;
  select count(*) into v_cnt2 from public.video_room_state(room5, t) where profile_id = s3;
  r := r || pg_temp.vr_line('V15g silent but the seat was not needed', v_cnt = 0 and v_txt = 'admitted' and v_cnt2 = 1,
    format('listed while silent=%s, beat says %s, listed after=%s (want 0,admitted,1)', v_cnt, v_txt, v_cnt2));
  -- the lobby: a silent person in the lobby cannot be let in; one beat makes them visible again
  perform public.join_video_room('SLNT2345', s4, ve);
  update video_room_members set last_seen_at = now() - interval '100 seconds' where room_id = room5 and profile_id = s4;
  select count(*) into v_cnt from public.video_room_state(room5, t) where profile_id = s4;
  begin
    perform public.admit_video_room_member(room5, t, s4);
    r := r || pg_temp.vr_line('V15h', false, 'a silent person in the lobby was let in');
  exception when others then
    r := r || pg_temp.vr_line('V15h silent lobby person cannot be let in (and is not listed)', sqlerrm = 'not_waiting' and v_cnt = 0,
      format('%s; listed to the host=%s (want not_waiting, 0)', sqlerrm, v_cnt));
  end;
  select public.heartbeat_video_room(room5, s4, ve) into v_txt;
  select count(*) into v_cnt from public.video_room_state(room5, t) where profile_id = s4 and status = 'waiting';
  r := r || pg_temp.vr_line('V15i one beat puts them back in the lobby list', v_txt = 'waiting' and v_cnt = 1,
    format('%s; listed waiting=%s (want waiting,1)', v_txt, v_cnt));
  begin
    perform public.admit_video_room_member(room5, t, s4);
    r := r || pg_temp.vr_line('V15j', false, 'a guest was admitted into a full room');
  exception when others then
    r := r || pg_temp.vr_line('V15j admitting into the full room', sqlerrm = 'room_full', sqlerrm);
  end;

  -- ================================================================================================
  -- V16: visits: rejoining after a crash, two tabs of one person
  -- ================================================================================================
  room6 := public.create_video_room(t2, 'VSTA2345', 4, false);
  va := gen_random_uuid(); vb := gen_random_uuid(); vc := gen_random_uuid(); vd := gen_random_uuid();
  perform public.join_video_room('VSTA2345', s1, va);
  perform public.admit_video_room_member(room6, t2, s1);
  -- the page crashed and was opened again (a new visit): straight back in, one place, not counted twice
  select member_status into v_txt from public.join_video_room('VSTA2345', s1, vb);
  select count(*) into v_cnt from video_room_members where room_id = room6 and profile_id = s1;
  select public.video_room_guests_seated(room6) into v_cnt2;
  r := r || pg_temp.vr_line('V16 rejoin after a crash', v_txt = 'admitted' and v_cnt = 1 and v_cnt2 = 1,
    format('%s, rows=%s, guests seated=%s (want admitted,1,1)', v_txt, v_cnt, v_cnt2));
  select public.heartbeat_video_room(room6, s1, va) into v_txt;
  select public.heartbeat_video_room(room6, s1, vb) into v_txt2;
  r := r || pg_temp.vr_line('V16b two tabs: the older visit is told it was replaced', v_txt = 'superseded' and v_txt2 = 'admitted',
    format('old visit=%s, new visit=%s (want superseded,admitted)', v_txt, v_txt2));
  perform public.leave_video_room(room6, s1, va);   -- a late "leave" from the old tab
  select status into v_txt from video_room_members where room_id = room6 and profile_id = s1;
  r := r || pg_temp.vr_line('V16c a late leave from the old tab changes nothing', v_txt = 'admitted', format('status=%s (want admitted)', v_txt));
  perform public.leave_video_room(room6, s1, vb);   -- the current tab leaves
  select status into v_txt from video_room_members where room_id = room6 and profile_id = s1;
  select public.heartbeat_video_room(room6, s1, vb) into v_txt2;
  select public.heartbeat_video_room(room6, s1, va) into v_txt3;
  r := r || pg_temp.vr_line('V16d the current tab leaves', v_txt = 'left' and v_txt2 = 'left' and v_txt3 = 'superseded',
    format('status=%s, its next beat says %s, the old tab''s beat says %s (want left,left,superseded)', v_txt, v_txt2, v_txt3));
  select member_status into v_txt from public.join_video_room('VSTA2345', s1, vc);
  perform public.leave_video_room(room6, s1);   -- without a visit id a leave always applies
  select status into v_txt2 from video_room_members where room_id = room6 and profile_id = s1;
  r := r || pg_temp.vr_line('V16e come back, then leave without a visit id', v_txt = 'admitted' and v_txt2 = 'left',
    format('back=%s, after leave=%s (want admitted,left)', v_txt, v_txt2));
  select member_status into v_txt from public.join_video_room('VSTA2345', s1, null);
  select public.heartbeat_video_room(room6, s1, vd) into v_txt2;
  r := r || pg_temp.vr_line('V16f a join without a visit id leaves the place open to any beat', v_txt = 'admitted' and v_txt2 = 'admitted',
    format('join=%s, beat from any visit=%s (want admitted,admitted)', v_txt, v_txt2));

  -- ================================================================================================
  -- V17: the seat limit and the host's place: a returning guest cannot jump the queue; a host who was silent can always
  -- come back
  -- ================================================================================================
  room7 := public.create_video_room(t2, 'RESV2345', 3, false);   -- the host and 2 guests
  vt := gen_random_uuid();
  perform public.join_video_room('RESV2345', t2, vt);
  perform public.join_video_room('RESV2345', s1, gen_random_uuid());
  perform public.admit_video_room_member(room7, t2, s1);
  perform public.join_video_room('RESV2345', s2, gen_random_uuid());
  perform public.admit_video_room_member(room7, t2, s2);
  perform public.leave_video_room(room7, s2);                       -- s2 leaves for a moment
  perform public.join_video_room('RESV2345', s3, gen_random_uuid());
  perform public.admit_video_room_member(room7, t2, s3);            -- s3 takes the seat
  begin
    perform public.join_video_room('RESV2345', s2, gen_random_uuid());
    r := r || pg_temp.vr_line('V17', false, 'a returning guest took a seat that someone else had been given');
  exception when others then
    r := r || pg_temp.vr_line('V17 a returning guest meets a full room', sqlerrm = 'room_full', sqlerrm);
  end;
  update video_room_members set last_seen_at = now() - interval '100 seconds' where room_id = room7 and profile_id = t2;   -- the host goes quiet
  perform public.leave_video_room(room7, s1);
  select member_status into v_txt from public.join_video_room('RESV2345', s2, gen_random_uuid());
  r := r || pg_temp.vr_line('V17b a free seat is taken', v_txt = 'admitted', format('%s (want admitted)', v_txt));
  begin
    perform public.join_video_room('RESV2345', s1, gen_random_uuid());
    r := r || pg_temp.vr_line('V17c', false, 'a guest took the place of a host who was only silent');
  exception when others then
    r := r || pg_temp.vr_line('V17c the silent host''s place is kept', sqlerrm = 'room_full', sqlerrm);
  end;
  select member_status, is_host into v_txt, v_bool from public.join_video_room('RESV2345', t2, gen_random_uuid());
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t2, 'role', 'authenticated')::text, true);
  v_bool2 := public.video_room_can_signal(room7);
  r := r || pg_temp.vr_line('V17d the host comes back', v_txt = 'admitted' and v_bool and v_bool2,
    format('%s, is_host=%s, can signal=%s (want admitted,t,t)', v_txt, v_bool, v_bool2));

  -- ================================================================================================
  -- V18: ended and expired rooms: nothing works in them
  -- ================================================================================================
  begin
    perform public.heartbeat_video_room(room, t, null);
    r := r || pg_temp.vr_line('V18', false, 'a beat in an ended room was answered');
  exception when others then
    r := r || pg_temp.vr_line('V18 beat in an ended room', sqlerrm = 'room_closed', sqlerrm);
  end;
  begin
    perform * from public.video_room_state(room, t);
    r := r || pg_temp.vr_line('V18b', false, 'the state of an ended room was read');
  exception when others then
    r := r || pg_temp.vr_line('V18b state of an ended room', sqlerrm = 'room_closed', sqlerrm);
  end;
  begin
    perform public.end_video_room(room, t);
    r := r || pg_temp.vr_line('V18c', false, 'an ended room was ended again');
  exception when others then
    r := r || pg_temp.vr_line('V18c ending an ended room', sqlerrm = 'room_closed', sqlerrm);
  end;
  begin
    perform public.admit_video_room_member(room, t, p);
    r := r || pg_temp.vr_line('V18d', false, 'someone was let into an ended room');
  exception when others then
    r := r || pg_temp.vr_line('V18d admitting into an ended room', sqlerrm = 'room_closed', sqlerrm);
  end;
  begin
    perform public.leave_video_room(room, s1, null);
    r := r || pg_temp.vr_line('V18e leaving an ended room is harmless', true, 'no error');
  exception when others then
    r := r || pg_temp.vr_line('V18e leaving an ended room is harmless', false, sqlerrm);
  end;
  -- expired: the clock passes the room's end
  room8 := public.create_video_room(t3, 'EXPR2345', 4, false);
  update video_rooms set created_at = now() - interval '5 hours', expires_at = now() - interval '1 hour' where id = room8;
  begin
    perform public.heartbeat_video_room(room8, t3, null);
    r := r || pg_temp.vr_line('V18f', false, 'a beat in an expired room was answered');
  exception when others then
    r := r || pg_temp.vr_line('V18f beat in an expired room', sqlerrm = 'room_closed', sqlerrm);
  end;
  begin
    perform public.join_video_room('EXPR2345', t3, gen_random_uuid());
    r := r || pg_temp.vr_line('V18g', false, 'the host entered an expired room');
  exception when others then
    r := r || pg_temp.vr_line('V18g joining an expired room', sqlerrm = 'room_closed', sqlerrm);
  end;
  begin
    perform * from public.video_room_state(room8, t3);
    r := r || pg_temp.vr_line('V18h', false, 'the state of an expired room was read');
  exception when others then
    r := r || pg_temp.vr_line('V18h state of an expired room', sqlerrm = 'room_closed', sqlerrm);
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t3, 'role', 'authenticated')::text, true);
  v_bool := public.video_room_can_signal(room8);
  r := r || pg_temp.vr_line('V18i an expired room has no signalling', v_bool = false, format('host can signal=%s (want f)', v_bool));
  begin
    perform public.admit_video_room_member(room8, t3, s1);
    r := r || pg_temp.vr_line('V18j', false, 'someone was let into an expired room');
  exception when others then
    r := r || pg_temp.vr_line('V18j admitting into an expired room', sqlerrm = 'room_closed', sqlerrm);
  end;
  -- an expired session room cannot be opened again or entered
  insert into sessions (id, student_id, tutor_id, status, duration_hours, hourly_rate_charged, platform_commission_pct,
                        gross_amount, tutor_payout_amount, scheduled_start, currency_code)
  values (ses_exp, m, t, 'scheduled', 1, 50, 30, 50, 35, now() + interval '5 minutes', 'ZAR');
  select o.room_id into roomx from public.open_video_session_room(ses_exp, t, 'SESD2345', false) o;
  update video_rooms set created_at = now() - interval '5 hours', expires_at = now() - interval '1 hour' where id = roomx;
  begin
    perform public.open_video_session_room(ses_exp, t, 'SESE2345', false);
    r := r || pg_temp.vr_line('V18k', false, 'an expired session room was opened again');
  exception when others then
    r := r || pg_temp.vr_line('V18k expired session room, opening', sqlerrm = 'room_closed', sqlerrm);
  end;
  begin
    perform public.join_video_room('SESD2345', t, gen_random_uuid());
    r := r || pg_temp.vr_line('V18l', false, 'an expired session room was entered');
  exception when others then
    r := r || pg_temp.vr_line('V18l expired session room, joining', sqlerrm = 'room_closed', sqlerrm);
  end;

  -- ================================================================================================
  -- V19: a tutor's open rooms: only their own tutor rooms (not session rooms), not ended or expired ones, newest
  -- first, with who is really in; at most 5 open at once
  -- ================================================================================================
  select count(*) into v_cnt from public.list_my_video_rooms(t3);
  r := r || pg_temp.vr_line('V19 an expired room is not listed', v_cnt = 0, format('t3 lists %s room(s) (want 0)', v_cnt));
  perform public.create_video_room(t3, 'AAAA2222', 4, false);
  perform public.create_video_room(t3, 'BBBB3333', 4, false);
  perform public.create_video_room(t3, 'CCCC4444', 4, false);
  perform public.create_video_room(t3, 'DDDD5555', 4, false);
  insert into sessions (id, student_id, tutor_id, status, duration_hours, hourly_rate_charged, platform_commission_pct,
                        gross_amount, tutor_payout_amount, scheduled_start, currency_code)
  values (ses3, s1, t3, 'scheduled', 1, 50, 30, 50, 35, now() + interval '5 minutes', 'ZAR');
  perform public.open_video_session_room(ses3, t3, 'SESG2345', false);
  begin
    perform public.create_video_room(t3, 'EEEE6666', 4, false);   -- the 5th tutor room: allowed, a session room does not count
    r := r || pg_temp.vr_line('V19a a session room does not count toward the limit of 5', true, '5th tutor room opened');
  exception when others then
    r := r || pg_temp.vr_line('V19a a session room does not count toward the limit of 5', false, sqlerrm);
  end;
  begin
    perform public.create_video_room(t3, 'FFFF7777', 4, false);
    r := r || pg_temp.vr_line('V19b', false, 'a 6th open room was accepted');
  exception when others then
    r := r || pg_temp.vr_line('V19b the 6th open room is refused', sqlerrm = 'too_many_open_rooms', sqlerrm);
  end;
  update video_rooms set created_at = now() - interval '50 minutes' where code = 'AAAA2222';
  update video_rooms set created_at = now() - interval '40 minutes' where code = 'BBBB3333';
  update video_rooms set created_at = now() - interval '30 minutes' where code = 'CCCC4444';
  update video_rooms set created_at = now() - interval '20 minutes' where code = 'DDDD5555';
  update video_rooms set created_at = now() - interval '10 minutes' where code = 'EEEE6666';
  select count(*) into v_cnt from public.list_my_video_rooms(t3);
  select (array_agg(l.code order by l.created_at desc))[1], (array_agg(l.code order by l.created_at asc))[1]
    into v_txt, v_txt2 from public.list_my_video_rooms(t3) l;
  r := r || pg_temp.vr_line('V19c the list holds the 5 tutor rooms, newest first, no session room', v_cnt = 5 and v_txt = 'EEEE6666' and v_txt2 = 'AAAA2222',
    format('rooms=%s, newest=%s, oldest=%s (want 5, EEEE6666, AAAA2222)', v_cnt, v_txt, v_txt2));
  -- who is really in: the host, one admitted guest, one guest in the lobby; then the guest goes silent
  perform public.join_video_room('EEEE6666', t3, gen_random_uuid());
  perform public.join_video_room('EEEE6666', s1, gen_random_uuid());
  perform public.join_video_room('EEEE6666', s2, gen_random_uuid());
  select id into roomx from video_rooms where code = 'EEEE6666';
  perform public.admit_video_room_member(roomx, t3, s1);
  select in_room into v_cnt from public.list_my_video_rooms(t3) where code = 'EEEE6666';
  select in_room into v_cnt2 from public.list_my_video_rooms(t3) where code = 'AAAA2222';
  r := r || pg_temp.vr_line('V19d people in the room', v_cnt = 2 and v_cnt2 = 1,
    format('EEEE6666 holds %s (want 2: host and admitted guest, not the lobby), AAAA2222 holds %s (want 1: the host)', v_cnt, v_cnt2));
  update video_room_members set last_seen_at = now() - interval '100 seconds' where room_id = roomx and profile_id = s1;
  select in_room into v_cnt from public.list_my_video_rooms(t3) where code = 'EEEE6666';
  r := r || pg_temp.vr_line('V19e a silent guest is not counted', v_cnt = 1, format('EEEE6666 holds %s (want 1)', v_cnt));
  -- other people's rooms are never listed
  select count(*) into v_cnt from public.list_my_video_rooms(t3) where code in (select code from video_rooms where host_id in (t, t2));
  select count(*) into v_cnt2 from public.list_my_video_rooms(s1);
  r := r || pg_temp.vr_line('V19f only your own rooms', v_cnt = 0 and v_cnt2 = 0,
    format('t3 sees %s of other tutors'' rooms (want 0); a student lists %s (want 0)', v_cnt, v_cnt2));
  -- ending one makes room for another
  select id into roomx from video_rooms where code = 'AAAA2222';
  perform public.end_video_room(roomx, t3);
  select count(*) into v_cnt from public.list_my_video_rooms(t3);
  perform public.create_video_room(t3, 'FFFF7777', 4, false);
  select count(*) into v_cnt2 from public.list_my_video_rooms(t3);
  r := r || pg_temp.vr_line('V19g an ended room leaves the list and frees a place', v_cnt = 4 and v_cnt2 = 5,
    format('after ending: %s; after opening another: %s (want 4,5)', v_cnt, v_cnt2));

  -- ================================================================================================
  -- V20: what one transaction can check about atomicity and the clock: the functions that take seats lock the room's row
  -- first, and none of them takes a time from the caller or reads a clock other than the transaction's now()
  -- ================================================================================================
  select count(*) into v_cnt from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
  where n.nspname = 'public'
    and pr.proname in ('video_room_enter', 'admit_video_room_member', 'heartbeat_video_room', 'remove_video_room_member', 'end_video_room')
    and pg_get_functiondef(pr.oid) ilike '%from public.video_rooms where id = p_room for update%';
  select count(*) into v_cnt2 from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
  where n.nspname = 'public' and pr.proname like '%video%'
    and ('timestamp with time zone'::regtype::oid = any (pr.proargtypes::oid[])
         or 'timestamp without time zone'::regtype::oid = any (pr.proargtypes::oid[])
         or pg_get_functiondef(pr.oid) ilike '%clock_timestamp%'
         or pg_get_functiondef(pr.oid) ilike '%statement_timestamp%'
         or pg_get_functiondef(pr.oid) ilike '%timeofday%');
  r := r || pg_temp.vr_line('V20 row lock and the database clock', v_cnt = 5 and v_cnt2 = 0 and public.video_room_seat_timeout() = interval '90 seconds',
    format('functions that lock the room first=%s (want 5), functions with a caller-supplied time or another clock=%s (want 0), timeout=%s (want 00:01:30). A real race of two sessions is NOT tested here.',
      v_cnt, v_cnt2, public.video_room_seat_timeout()));

  -- ================================================================================================
  -- V21: a tutor's room of 4 holds the host and 3 guests; and a signed-in or signed-out browser cannot call the rules or
  -- read the tables itself. Those refusals must be the database's own "permission denied" for the named object, so a
  -- different error cannot pass for a refusal. (The positive controls are the same calls made above as the owner.)
  -- ================================================================================================
  roomx := public.create_video_room(t2, 'FULL2345', 4, false);
  perform public.join_video_room('FULL2345', s1, gen_random_uuid());
  perform public.join_video_room('FULL2345', s2, gen_random_uuid());
  perform public.join_video_room('FULL2345', s3, gen_random_uuid());
  perform public.join_video_room('FULL2345', s4, gen_random_uuid());
  perform public.admit_video_room_member(roomx, t2, s1);
  perform public.admit_video_room_member(roomx, t2, s2);
  perform public.admit_video_room_member(roomx, t2, s3);
  select public.video_room_guests_seated(roomx) into v_cnt;
  begin
    perform public.admit_video_room_member(roomx, t2, s4);
    r := r || pg_temp.vr_line('V21', false, 'a 4th guest was admitted to a room of 4');
  exception when others then
    r := r || pg_temp.vr_line('V21 a room of 4 holds the host and 3 guests', sqlerrm = 'room_full' and v_cnt = 3,
      format('guests seated=%s (want 3); the 4th guest: %s (want room_full)', v_cnt, sqlerrm));
  end;
  begin
    set local role authenticated;
    perform public.heartbeat_video_room(roomx, s1, null);
    reset role;
    r := r || pg_temp.vr_line('V21b', false, 'a signed-in browser called the heartbeat function itself');
  exception when others then
    reset role;
    r := r || pg_temp.vr_line('V21b a signed-in browser cannot call the heartbeat itself', sqlerrm like 'permission denied for function heartbeat_video_room%', left(sqlerrm, 90));
  end;
  begin
    set local role anon;
    perform public.join_video_room('FULL2345', s1, null);
    reset role;
    r := r || pg_temp.vr_line('V21c', false, 'a signed-out browser called join_video_room itself');
  exception when others then
    reset role;
    r := r || pg_temp.vr_line('V21c a signed-out browser cannot call the join rule itself', sqlerrm like 'permission denied for function join_video_room%', left(sqlerrm, 90));
  end;
  begin
    set local role authenticated;
    perform count(*) from public.video_room_members;
    reset role;
    r := r || pg_temp.vr_line('V21d', false, 'a signed-in browser read the members table');
  exception when others then
    reset role;
    r := r || pg_temp.vr_line('V21d a signed-in browser cannot read the members table', sqlerrm like 'permission denied for table video_room_members%', left(sqlerrm, 90));
  end;
  begin
    set local role anon;
    perform count(*) from public.video_rooms;
    reset role;
    r := r || pg_temp.vr_line('V21e', false, 'a signed-out browser read the rooms table');
  exception when others then
    reset role;
    r := r || pg_temp.vr_line('V21e a signed-out browser cannot read the rooms table', sqlerrm like 'permission denied for table video_rooms%', left(sqlerrm, 90));
  end;

  -- ================================================================================================
  -- V22 (review of 12 Oct 2026): a booked session's room cannot be turned against the people it is for. Its tutor is its
  -- host, but can neither send the learner or a guardian away nor end the room (the lesson was paid for). A tutor's own
  -- room is unchanged (V6, V10). Also: the daily clean-up of old rooms is scheduled by the migration itself.
  -- ================================================================================================
  select count(*) into v_cnt from video_room_members where room_id = sroom and status = 'admitted' and profile_id in (m, p);
  begin
    perform public.remove_video_room_member(sroom, t, m);
    r := r || pg_temp.vr_line('V22', false, 'the tutor removed the learner from the session room');
  exception when others then
    r := r || pg_temp.vr_line('V22 the tutor cannot remove the learner from a session room', sqlerrm = 'session_room', sqlerrm);
  end;
  begin
    perform public.remove_video_room_member(sroom, t, p);
    r := r || pg_temp.vr_line('V22b', false, 'the tutor removed the guardian from the session room');
  exception when others then
    r := r || pg_temp.vr_line('V22b the tutor cannot remove a guardian from a session room', sqlerrm = 'session_room', sqlerrm);
  end;
  begin
    perform public.end_video_room(sroom, t);
    r := r || pg_temp.vr_line('V22c', false, 'the tutor ended the session room');
  exception when others then
    r := r || pg_temp.vr_line('V22c the tutor cannot end a session room', sqlerrm = 'session_room', sqlerrm);
  end;
  select count(*) into v_cnt2 from video_room_members where room_id = sroom and status = 'admitted' and profile_id in (m, p);
  select (ended_at is null) into v_bool from video_rooms where id = sroom;
  r := r || pg_temp.vr_line('V22d nothing changed', v_bool and v_cnt2 = v_cnt,
    format('room still open=%s; learner and guardian admitted before and after=%s and %s (want t, equal)', v_bool, v_cnt, v_cnt2));
  begin
    perform public.remove_video_room_member(sroom, m, p);
    r := r || pg_temp.vr_line('V22e', false, 'the learner removed the guardian from the session room');
  exception when others then
    r := r || pg_temp.vr_line('V22e someone who is not the host is still told so first', sqlerrm = 'not_host', sqlerrm);
  end;
  select count(*) into v_cnt from cron.job
  where jobname = 'purge-old-video-rooms' and schedule = '17 3 * * *' and command = 'select public.purge_old_video_rooms();';
  r := r || pg_temp.vr_line('V22f the daily clean-up is scheduled', v_cnt = 1, format('jobs named purge-old-video-rooms with this schedule and command=%s (want 1)', v_cnt));

  -- ================================================================================================
  -- V13: clean-up removes rooms ended or expired more than 30 days ago, and only those
  -- ================================================================================================
  insert into video_rooms (code, host_id, created_at, expires_at, ended_at)
  values ('ELDD2345', t, now() - interval '40 days', now() - interval '39 days', now() - interval '35 days')
  returning id into oldroom;
  v_cnt := public.purge_old_video_rooms();
  r := r || pg_temp.vr_line('V13 purge', v_cnt = 1
      and (select count(*) from video_rooms where id = oldroom) = 0
      and (select count(*) from video_rooms where id in (room, room2, room3, room8)) = 4,
    format('removed %s old room(s); the old room remains=%s; the recent rooms (one ended, one expired) remain=%s (want 1, 0, 4)',
      v_cnt, (select count(*) from video_rooms where id = oldroom),
      (select count(*) from video_rooms where id in (room, room2, room3, room8))));

  select (length(r) - length(replace(r, E'\nok   ', ''))) / length(E'\nok   '),
         (length(r) - length(replace(r, E'\nFAIL ', ''))) / length(E'\nFAIL ')
    into n_ok, n_fail;
  raise exception 'TEST RESULT (rolled back): % ok, % FAIL%', n_ok, n_fail, r;
end $$;
