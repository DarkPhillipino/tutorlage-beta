-- Rolled-back test of 20261116190500_video_rooms_verified_only.sql. Run the migration text first and this block second, in ONE statement (the last line raises on purpose;
-- the message is the report, FAIL lines first). Made-up people only (example.invalid); counts nothing real. Run as the owner; room calls run as service_role (as the Worker does).
do $t$
declare
  r text := ''; f text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  u_unapp uuid := gen_random_uuid(); u_rel uuid := gen_random_uuid(); u_ver uuid := gen_random_uuid(); u_learn uuid := gen_random_uuid();
  s_ok uuid; s_bad uuid; t text; gate text;
  procedure_note text;
begin
  gate := (select setting_value::text from system_settings where setting_key = 'founding_tutors_gate');
  r := r || 'switch founding_tutors_gate as it is: ' || gate || E'\n';
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (u_unapp, z,'authenticated','authenticated','zz.u.'||u_unapp||'@example.invalid', jsonb_build_object('role','tutor','first_name','Zz','surname','Unapproved','date_of_birth',adult), '{}'),
    (u_rel, z,'authenticated','authenticated','zz.r.'||u_rel||'@example.invalid', jsonb_build_object('role','tutor','first_name','Zz','surname','Released','date_of_birth',adult), '{}'),
    (u_ver, z,'authenticated','authenticated','zz.v.'||u_ver||'@example.invalid', jsonb_build_object('role','tutor','first_name','Zz','surname','Verified','date_of_birth',adult), '{}'),
    (u_learn, z,'authenticated','authenticated','zz.l.'||u_learn||'@example.invalid', jsonb_build_object('first_name','Zz','surname','Learner','date_of_birth',adult), '{}');
  -- V0: sign-up is still open with the switch as it is (the three made-up tutors above were created by the sign-up trigger)
  if (select count(*) from tutor_profiles where id in (u_unapp, u_rel, u_ver)) <> 3 then f := f || 'FAIL V0 tutor sign-up no longer works' || E'\n'; end if;
  update tutor_profiles set is_verified = true where id = u_ver;
  insert into founding_tutors_list (source, status, user_id, consent_version) values ('backfill', 'released', u_rel, 'test');
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
    values (u_learn, u_ver, u_learn, now() - interval '5 minutes', 50, 30, 50, 35) returning id into s_ok;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount)
    values (u_learn, u_unapp, u_learn, now() - interval '5 minutes', 50, 30, 50, 35) returning id into s_bad;

  set local role service_role;
  -- V1 to V3: create_video_room, switch as it is
  begin perform public.create_video_room(u_unapp, 'CCCCCCC2', 4, false); t := 'room opened'; exception when others then t := 'refused: ' || sqlerrm; end;
  if t not like 'refused: You can open video rooms once you are verified.%' then f := f || 'FAIL V1 unapproved tutor: ' || t || E'\n'; end if;
  r := r || 'V1 unapproved (not listed) create_video_room -> ' || t || E'\n';
  begin perform public.create_video_room(u_rel, 'CCCCCCC3', 4, false); t := 'room opened'; exception when others then t := 'refused: ' || sqlerrm; end;
  if t not like 'refused: You can open video rooms once you are verified.%' then f := f || 'FAIL V2 released-but-unverified tutor: ' || t || E'\n'; end if;
  r := r || 'V2 released, not verified create_video_room -> ' || t || E'\n';
  begin perform public.create_video_room(u_ver, 'CCCCCCC4', 4, false); t := 'room opened'; exception when others then t := 'refused: ' || sqlerrm; end;
  if t <> 'room opened' then f := f || 'FAIL V3 verified tutor: ' || t || E'\n'; end if;
  r := r || 'V3 verified create_video_room -> ' || t || E'\n';
  -- V4, V5: open_video_session_room (the booked-session path). Called by the learner, as the page does; the room's host is the session's tutor.
  begin perform public.open_video_session_room(s_ok, u_learn, 'CCCCCCC5', false); t := 'room opened'; exception when others then t := 'refused: ' || sqlerrm; end;
  if t <> 'room opened' then f := f || 'FAIL V4 session room, verified tutor with a booking: ' || t || E'\n'; end if;
  r := r || 'V4 session room, verified tutor, booked session -> ' || t || E'\n';
  begin perform public.open_video_session_room(s_ok, u_ver, 'CCCCCCC6', false); t := 'room opened (the same room is returned)'; exception when others then t := 'refused: ' || sqlerrm; end;
  if t not like 'room opened%' then f := f || 'FAIL V4b the tutor re-enters the existing session room: ' || t || E'\n'; end if;
  r := r || 'V4b the tutor opens the same session room again -> ' || t || E'\n';
  begin perform public.open_video_session_room(s_bad, u_learn, 'CCCCCCC7', false); t := 'room opened'; exception when others then t := 'refused: ' || sqlerrm; end;
  if t not like 'refused: You can open video rooms once you are verified.%' then f := f || 'FAIL V5 session room with an unverified tutor: ' || t || E'\n'; end if;
  r := r || 'V5 session room whose tutor is not verified -> ' || t || E'\n';
  reset role;

  -- V6 to V8: the switch ON gives the same answers (and sign-up of an unlisted tutor is refused again, exactly as before)
  update system_settings set setting_value = '{"on": true}'::jsonb where setting_key = 'founding_tutors_gate';
  set local role service_role;
  begin perform public.create_video_room(u_unapp, 'CCCCCCC8', 4, false); t := 'room opened'; exception when others then t := 'refused: ' || sqlerrm; end;
  if t not like 'refused: You can open video rooms once you are verified.%' then f := f || 'FAIL V6 switch on, unapproved: ' || t || E'\n'; end if;
  begin perform public.create_video_room(u_ver, 'CCCCCCC9', 4, false); t := 'room opened'; exception when others then t := 'refused: ' || sqlerrm; end;
  if t <> 'room opened' then f := f || 'FAIL V7 switch on, verified: ' || t || E'\n'; end if;
  reset role;
  perform set_config('founding.test_enforce', 'on', true);
  begin
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (gen_random_uuid(), z,'authenticated','authenticated','zz.n.'||gen_random_uuid()||'@example.invalid', jsonb_build_object('role','tutor','first_name','Zz','surname','New','date_of_birth',adult), '{}');
    t := 'sign-up allowed';
  exception when others then t := 'refused: ' || sqlerrm; end;
  if t not like 'refused: Tutoring places open in groups.%' then f := f || 'FAIL V8 switch-gated sign-up guard changed: ' || t || E'\n'; end if;
  r := r || 'V6-V8 switch ON: unapproved refused, verified allowed, sign-up guard still refuses an unlisted tutor: ' || t || E'\n';
  raise exception E'VIDEO ROOMS VERIFIED-ONLY TEST (rolled back)\n%\n%', case when f = '' then 'NO FAILURES' else f end, r;
end $t$;
