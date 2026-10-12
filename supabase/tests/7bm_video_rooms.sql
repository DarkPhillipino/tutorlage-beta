-- Rolled-back test of migration 20261009200000 (master 7bm: video rooms on our own WebRTC). See README.md.
-- Run with scripts/run-rolled-back-test.mjs (migration + this file in one always-failing statement), or after
-- the migration is applied, on its own (it always raises, so nothing is kept).
-- auth.uid() is simulated by setting request.jwt.claims; the Realtime policies are tried as the `authenticated` role.
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  prov jsonb := '{"provider":"email","providers":["email"]}'::jsonb;
  adult_dob text := (current_date - interval '30 years')::date::text;
  minor_dob text := (current_date - interval '15 years')::date::text;
  ver_t text; ver_p text;
  t uuid := gen_random_uuid();    -- the tutor who hosts
  s1 uuid := gen_random_uuid();   -- adult student
  s2 uuid := gen_random_uuid();   -- another adult student
  p uuid := gen_random_uuid();    -- parent of the minor
  p2 uuid := gen_random_uuid();   -- an unrelated parent
  m uuid := gen_random_uuid();    -- learner under 18, linked to p
  room uuid; room2 uuid; room3 uuid; sroom uuid; sroom2 uuid; oldroom uuid;
  ses uuid := gen_random_uuid();
  ses_far uuid := gen_random_uuid();
  ses_done uuid := gen_random_uuid();
  v_txt text; v_txt2 text; v_cnt int; v_cnt2 int; v_bool boolean; v_bool2 boolean;
  rec record;
begin
  select setting_value #>> '{}' into ver_t from system_settings where setting_key = 'current_terms_version';
  select setting_value #>> '{}' into ver_p from system_settings where setting_key = 'current_privacy_version';

  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (t, z, 'authenticated', 'authenticated', 'v.tu.' || t || '@example.invalid',
          jsonb_build_object('role', 'tutor', 'date_of_birth', adult_dob), prov);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (s1, z, 'authenticated', 'authenticated', 'v.s1.' || s1 || '@example.invalid',
          jsonb_build_object('role', 'student', 'date_of_birth', adult_dob, 'accepted_terms_version', ver_t, 'accepted_privacy_version', ver_p), prov);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (s2, z, 'authenticated', 'authenticated', 'v.s2.' || s2 || '@example.invalid',
          jsonb_build_object('role', 'student', 'date_of_birth', adult_dob, 'accepted_terms_version', ver_t, 'accepted_privacy_version', ver_p), prov);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (p, z, 'authenticated', 'authenticated', 'v.pa.' || p || '@example.invalid',
          jsonb_build_object('role', 'parent', 'date_of_birth', adult_dob), prov);
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (p2, z, 'authenticated', 'authenticated', 'v.p2.' || p2 || '@example.invalid',
          jsonb_build_object('role', 'parent', 'date_of_birth', adult_dob), prov);
  -- the learner under 18, added by parent p (the 7k order is enough here; these tests are about rooms, not sign-up)
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (m, z, 'authenticated', 'authenticated', 'kid-v.' || m || '@learners.tutorlage.invalid',
          jsonb_build_object('first_name', 'Kid', 'surname', 'Test', 'role', 'student', 'date_of_birth', minor_dob,
                             'accepted_terms_version', ver_t, 'accepted_privacy_version', ver_p),
          prov || jsonb_build_object('created_by_guardian', p, 'relationship', 'mother'));
  select count(*) into v_cnt from parent_student_links where parent_id = p and student_id = m;
  r := r || format('V0 setup: tutor profile=%s, parent link to the learner=%s (want 1,1)',
         (select count(*) from tutor_profiles where id = t), v_cnt) || E'\n';

  -- V1: a tutor opens a room; the host is admitted at once; others cannot open one; the code's shape and
  -- uniqueness are enforced
  room := public.create_video_room(t, 'K7QAB3XM', 4, false);
  select status into v_txt from video_room_members where room_id = room and profile_id = t;
  r := r || format('V1 tutor opens a room: host status=%s (want admitted)', v_txt) || E'\n';
  begin
    perform public.create_video_room(s1, 'ZZ9HJ2KP', 4, false);
    r := r || 'V1b FAIL: a student opened a room' || E'\n';
  exception when others then r := r || 'V1b ok (student refused): ' || sqlerrm || E'\n'; end;
  begin
    perform public.create_video_room(t, 'ROOM1234', 4, false);
    r := r || 'V1c FAIL: a code with a letter O was accepted' || E'\n';
  exception when others then r := r || 'V1c ok (bad code shape refused): ' || left(sqlerrm, 80) || E'\n'; end;
  begin
    perform public.create_video_room(t, 'K7QAB3XM', 4, false);
    r := r || 'V1d FAIL: a duplicate code was accepted' || E'\n';
  exception when others then r := r || 'V1d ok (duplicate refused): ' || left(sqlerrm, 80) || E'\n'; end;

  -- V2: the lobby: an adult student waits; the host is admitted; a student under 18 is refused; a parent may wait
  select member_status into v_txt from public.join_video_room('k7qab3xm', s1);
  r := r || format('V2 adult student joins a tutor room: %s (want waiting; the code is case-insensitive)', v_txt) || E'\n';
  select member_status, is_host into v_txt, v_bool from public.join_video_room('K7QAB3XM', t);
  r := r || format('V2b host re-joins: %s, is_host=%s (want admitted,t)', v_txt, v_bool) || E'\n';
  begin
    perform public.join_video_room('K7QAB3XM', m);
    r := r || 'V2c FAIL: a learner under 18 entered a tutor room' || E'\n';
  exception when others then r := r || 'V2c ok (under 18 refused): ' || sqlerrm || E'\n'; end;
  select member_status into v_txt from public.join_video_room('K7QAB3XM', p);
  r := r || format('V2d parent joins a tutor room: %s (want waiting)', v_txt) || E'\n';
  begin
    perform public.join_video_room('ZZZZZZZZ', s1);
    r := r || 'V2e FAIL: an unknown code was accepted' || E'\n';
  exception when others then r := r || 'V2e ok (unknown code): ' || sqlerrm || E'\n'; end;

  -- V3: only admitted people can use the room's signalling channel
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s1, 'role', 'authenticated')::text, true);
  v_bool := public.video_room_can_signal(room);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t, 'role', 'authenticated')::text, true);
  v_bool2 := public.video_room_can_signal(room);
  r := r || format('V3 waiting student can signal=%s, host can signal=%s (want f,t)', v_bool, v_bool2) || E'\n';
  perform public.admit_video_room_member(room, t, s1);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s1, 'role', 'authenticated')::text, true);
  v_bool := public.video_room_can_signal(room);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s2, 'role', 'authenticated')::text, true);
  v_bool2 := public.video_room_can_signal(room);
  r := r || format('V3b after admit: student can signal=%s, stranger can signal=%s (want t,f)', v_bool, v_bool2) || E'\n';
  begin
    perform public.admit_video_room_member(room, s1, p);
    r := r || 'V3c FAIL: a non-host admitted someone' || E'\n';
  exception when others then r := r || 'V3c ok (non-host refused): ' || sqlerrm || E'\n'; end;

  -- V4: what each person may see
  select count(*) filter (where status = 'admitted'), count(*) filter (where status = 'waiting')
    into v_cnt, v_cnt2 from public.video_room_state(room, t);
  r := r || format('V4 host sees admitted=%s waiting=%s (want 2,1: host and student; the parent waits)', v_cnt, v_cnt2) || E'\n';
  select count(*) into v_cnt from public.video_room_state(room, s1);
  r := r || format('V4b admitted student sees %s people (want 2: not the lobby)', v_cnt) || E'\n';
  select count(*) into v_cnt from public.video_room_state(room, p);
  r := r || format('V4c waiting parent sees %s row (want 1: only themselves)', v_cnt) || E'\n';
  begin
    perform * from public.video_room_state(room, s2);
    r := r || 'V4d FAIL: a stranger read a room''s state' || E'\n';
  exception when others then r := r || 'V4d ok (stranger refused): ' || sqlerrm || E'\n'; end;

  -- V5: room size: a room of 2 admits the host and one more, then says full
  room2 := public.create_video_room(t, 'TEST2345', 2, false);
  perform public.join_video_room('TEST2345', s1);
  perform public.admit_video_room_member(room2, t, s1);
  perform public.join_video_room('TEST2345', s2);
  begin
    perform public.admit_video_room_member(room2, t, s2);
    r := r || 'V5 FAIL: a third person was admitted to a room of 2' || E'\n';
  exception when others then r := r || 'V5 ok (full): ' || sqlerrm || E'\n'; end;

  -- V6: removing someone: they cannot come back; the host cannot be removed; non-members cannot be removed
  perform public.remove_video_room_member(room2, t, s2);
  begin
    perform public.join_video_room('TEST2345', s2);
    r := r || 'V6 FAIL: a removed person re-joined' || E'\n';
  exception when others then r := r || 'V6 ok (removed person refused): ' || sqlerrm || E'\n'; end;
  begin
    perform public.remove_video_room_member(room2, t, t);
    r := r || 'V6b FAIL: the host was removed' || E'\n';
  exception when others then r := r || 'V6b ok (host stays): ' || sqlerrm || E'\n'; end;
  begin
    perform public.remove_video_room_member(room2, t, p2);
    r := r || 'V6c FAIL: a non-member was removed' || E'\n';
  exception when others then r := r || 'V6c ok (not in the room): ' || sqlerrm || E'\n'; end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s2, 'role', 'authenticated')::text, true);
  v_bool := public.video_room_can_signal(room2);
  r := r || format('V6d removed person can signal=%s (want f)', v_bool) || E'\n';

  -- V7: leaving and coming back: an admitted person who left returns admitted, without the lobby
  perform public.leave_video_room(room2, s1);
  select status into v_txt from video_room_members where room_id = room2 and profile_id = s1;
  select member_status into v_txt2 from public.join_video_room('TEST2345', s1);
  r := r || format('V7 after leaving: %s; on returning: %s (want left, admitted)', v_txt, v_txt2) || E'\n';

  -- V8: a booked session's room: its tutor, learner and the learner's guardian are admitted at once;
  -- others are refused; the same room is used each time
  insert into sessions (id, student_id, tutor_id, status, duration_hours, hourly_rate_charged, platform_commission_pct,
                        gross_amount, tutor_payout_amount, scheduled_start, currency_code)
  values (ses, m, t, 'scheduled', 1, 50, 30, 50, 35, now() + interval '5 minutes', 'ZAR');
  select room_id, member_status, is_host into rec from public.join_video_session_room(ses, t, 'SESS2345', false);
  sroom := rec.room_id;
  r := r || format('V8 session tutor: %s, is_host=%s (want admitted,t)', rec.member_status, rec.is_host) || E'\n';
  select member_status into v_txt from public.join_video_session_room(ses, m, 'ZZ9HJ2KP', false);
  r := r || format('V8b the learner (under 18): %s (want admitted)', v_txt) || E'\n';
  select member_status into v_txt from public.join_video_session_room(ses, p, 'ZZ9HJ2KP', false);
  r := r || format('V8c the learner''s guardian: %s (want admitted)', v_txt) || E'\n';
  select room_id into sroom2 from public.join_video_session_room(ses, p, 'ZZ9HJ2KP', false);
  r := r || format('V8d same room each time: %s (want t)', sroom = sroom2) || E'\n';
  begin
    perform public.join_video_session_room(ses, p2, 'ZZ9HJ2KP', false);
    r := r || 'V8e FAIL: an unrelated parent entered the session room' || E'\n';
  exception when others then r := r || 'V8e ok (unrelated parent refused): ' || sqlerrm || E'\n'; end;
  begin
    perform public.join_video_session_room(ses, s2, 'ZZ9HJ2KP', false);
    r := r || 'V8f FAIL: an unrelated student entered the session room' || E'\n';
  exception when others then r := r || 'V8f ok (unrelated student refused): ' || sqlerrm || E'\n'; end;
  begin
    perform public.join_video_room('SESS2345', s2);
    r := r || 'V8g FAIL: a stranger entered the session room by its code' || E'\n';
  exception when others then r := r || 'V8g ok (code alone does not admit): ' || sqlerrm || E'\n'; end;

  -- V9: time and status: a session days away, or one already completed, has no room
  insert into sessions (id, student_id, tutor_id, status, duration_hours, hourly_rate_charged, platform_commission_pct,
                        gross_amount, tutor_payout_amount, scheduled_start, currency_code)
  values (ses_far, m, t, 'scheduled', 1, 50, 30, 50, 35, now() + interval '3 days', 'ZAR');
  begin
    perform public.join_video_session_room(ses_far, t, 'FARR2345', false);
    r := r || 'V9 FAIL: a room opened for a session 3 days away' || E'\n';
  exception when others then r := r || 'V9 ok (too early): ' || sqlerrm || E'\n'; end;
  insert into sessions (id, student_id, tutor_id, status, duration_hours, hourly_rate_charged, platform_commission_pct,
                        gross_amount, tutor_payout_amount, scheduled_start, currency_code, completed_at)
  values (ses_done, m, t, 'completed', 1, 50, 30, 50, 35, now() - interval '2 hours', 'ZAR', now() - interval '1 hour');
  begin
    perform public.join_video_session_room(ses_done, t, 'DONE2345', false);
    r := r || 'V9b FAIL: a room opened for a completed session' || E'\n';
  exception when others then r := r || 'V9b ok (completed session): ' || sqlerrm || E'\n'; end;

  -- V10: ending a room: only the host; afterwards nobody can enter, signal or read its state
  begin
    perform public.end_video_room(room, s1);
    r := r || 'V10 FAIL: a non-host ended the room' || E'\n';
  exception when others then r := r || 'V10 ok (non-host refused): ' || sqlerrm || E'\n'; end;
  perform public.end_video_room(room, t);
  begin
    perform public.join_video_room('K7QAB3XM', s2);
    r := r || 'V10b FAIL: entered an ended room' || E'\n';
  exception when others then r := r || 'V10b ok (ended): ' || sqlerrm || E'\n'; end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t, 'role', 'authenticated')::text, true);
  v_bool := public.video_room_can_signal(room);
  r := r || format('V10c host can signal an ended room=%s (want f)', v_bool) || E'\n';

  -- V11: nobody but the server can touch the tables or call the rules
  r := r || format('V11 anon select=%s, signed-in select=%s insert=%s, service_role select=%s insert=%s, rls=%s/%s (want f,f,f,t,t,t/t)',
    has_table_privilege('anon', 'public.video_rooms', 'select'),
    has_table_privilege('authenticated', 'public.video_rooms', 'select'),
    has_table_privilege('authenticated', 'public.video_room_members', 'insert'),
    has_table_privilege('service_role', 'public.video_rooms', 'select'),
    has_table_privilege('service_role', 'public.video_room_members', 'insert'),
    (select relrowsecurity from pg_class where oid = 'public.video_rooms'::regclass),
    (select relrowsecurity from pg_class where oid = 'public.video_room_members'::regclass)) || E'\n';
  r := r || format('V11b execute join_video_room: anon=%s signed-in=%s service_role=%s; video_room_can_signal: anon=%s signed-in=%s (want f,f,t; f,t)',
    has_function_privilege('anon', 'public.join_video_room(text,uuid)', 'execute'),
    has_function_privilege('authenticated', 'public.join_video_room(text,uuid)', 'execute'),
    has_function_privilege('service_role', 'public.join_video_room(text,uuid)', 'execute'),
    has_function_privilege('anon', 'public.video_room_can_signal(uuid)', 'execute'),
    has_function_privilege('authenticated', 'public.video_room_can_signal(uuid)', 'execute')) || E'\n';

  -- V12: the Realtime policies. realtime.messages has no daily partition on dev yet (Realtime has never been used
  -- there) and belongs to another role, so a direct insert cannot be tried in a rolled-back run (the first attempt
  -- failed with "no partition of relation messages found"). So: copy the DEPLOYED policy text from pg_policies onto
  -- a stand-in table with the same two columns, and try sends and reads as the signed-in role. Every refusal must
  -- be the row-level-security error itself, so an unrelated error cannot pass as a refusal.
  room3 := public.create_video_room(t, 'RLTM2345', 4, false);
  perform public.join_video_room('RLTM2345', s1);
  perform public.admit_video_room_member(room3, t, s1);
  perform public.join_video_room('RLTM2345', s2);   -- s2 is in the lobby
  r := r || format('V12 policies on realtime.messages: %s (want 2)',
    (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages'
       and policyname in ('video room members can receive', 'video room members can send'))) || E'\n';

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
    r := r || 'V12b ok: an admitted member may send on the room channel' || E'\n';
  exception when others then reset role; r := r || 'V12b FAIL (member send): ' || sqlerrm || E'\n'; end;

  -- someone in the lobby may not
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s2, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.vr_policy_probe (topic, extension) values ('room:' || room3, 'broadcast');
    reset role;
    r := r || 'V12c FAIL: someone in the lobby sent on the room channel' || E'\n';
  exception when others then reset role;
    r := r || case when sqlerrm like '%row-level security%' then 'V12c ok (lobby refused by the policy)' else 'V12c FAIL (wrong error): ' || sqlerrm end || E'\n'; end;

  -- a stranger (not in the room at all) may not
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p2, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    insert into public.vr_policy_probe (topic, extension) values ('room:' || room3, 'broadcast');
    reset role;
    r := r || 'V12c2 FAIL: a stranger sent on the room channel' || E'\n';
  exception when others then reset role;
    r := r || case when sqlerrm like '%row-level security%' then 'V12c2 ok (stranger refused by the policy)' else 'V12c2 FAIL (wrong error): ' || sqlerrm end || E'\n'; end;

  -- an admitted member on a room that does not exist, and on a topic that is not a room, may not
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s1, 'role', 'authenticated')::text, true);
  perform set_config('realtime.topic', 'room:' || gen_random_uuid(), true);
  begin
    set local role authenticated;
    insert into public.vr_policy_probe (topic, extension) values (current_setting('realtime.topic'), 'broadcast');
    reset role;
    r := r || 'V12d FAIL: sent on a room that does not exist' || E'\n';
  exception when others then reset role;
    r := r || case when sqlerrm like '%row-level security%' then 'V12d ok (unknown room refused by the policy)' else 'V12d FAIL (wrong error): ' || sqlerrm end || E'\n'; end;
  perform set_config('realtime.topic', 'lobby:anything', true);
  begin
    set local role authenticated;
    insert into public.vr_policy_probe (topic, extension) values ('lobby:anything', 'broadcast');
    reset role;
    r := r || 'V12e FAIL: sent on a topic that is not a room' || E'\n';
  exception when others then reset role;
    r := r || case when sqlerrm like '%row-level security%' then 'V12e ok (other topic refused by the policy)' else 'V12e FAIL (wrong error): ' || sqlerrm end || E'\n'; end;

  -- only the broadcast and presence extensions pass, even for an admitted member
  perform set_config('realtime.topic', 'room:' || room3, true);
  begin
    set local role authenticated;
    insert into public.vr_policy_probe (topic, extension) values ('room:' || room3, 'postgres_changes');
    reset role;
    r := r || 'V12f FAIL: another extension was accepted' || E'\n';
  exception when others then reset role;
    r := r || case when sqlerrm like '%row-level security%' then 'V12f ok (other extension refused)' else 'V12f FAIL (wrong error): ' || sqlerrm end || E'\n'; end;

  -- reading: an admitted member sees the room's message; someone in the lobby sees nothing
  insert into public.vr_policy_probe (topic, extension) values ('room:' || room3, 'broadcast');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from public.vr_policy_probe;
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', s2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt2 from public.vr_policy_probe;
  reset role;
  r := r || format('V12g reading: admitted member sees %s message(s), lobby person sees %s (want 2,0: the member''s own send in V12b and the one added here)', v_cnt, v_cnt2) || E'\n';

  -- V13: clean-up removes rooms ended or expired more than 30 days ago, and only those
  insert into video_rooms (code, host_id, created_at, expires_at, ended_at)
  values ('ELDD2345', t, now() - interval '40 days', now() - interval '39 days', now() - interval '35 days')
  returning id into oldroom;
  v_cnt := public.purge_old_video_rooms();
  r := r || format('V13 purge removed %s old room(s); the old room remains=%s; the recent rooms remain=%s (want 1, 0, 3)',
    v_cnt, (select count(*) from video_rooms where id = oldroom),
    (select count(*) from video_rooms where id in (room, room2, room3))) || E'\n';

  raise exception 'TEST RESULT (rolled back):%', r;
end $$;
