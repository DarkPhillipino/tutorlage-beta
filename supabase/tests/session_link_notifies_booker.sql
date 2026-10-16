-- Rolled-back test of migration 20261016140000_session_link_notifies_booker.sql (16 Oct 2026).
-- Run it on its own after the migration, or TOGETHER with the migration in one statement before it is applied. Every check prints its
-- result; "FAIL" marks a real problem. The last statement raises an error on purpose so that nothing is kept.
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  minor text := (current_date - interval '15 years')::date::text;
  v_p uuid := gen_random_uuid();   -- a parent
  v_c uuid := gen_random_uuid();   -- the parent's child (own sign-in)
  v_l uuid := gen_random_uuid();   -- an adult learner who books for themselves
  v_a uuid := gen_random_uuid();   -- the tutor
  v_b uuid := gen_random_uuid();   -- another tutor (not this session's)
  s1 uuid; s2 uuid;
  n int; t text;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_p, z,'authenticated','authenticated','sl.p.'||v_p||'@example.invalid', jsonb_build_object('role','parent','first_name','Pat','date_of_birth',adult,'phone_number','081 234 5678'), '{}'),
    (v_l, z,'authenticated','authenticated','sl.l.'||v_l||'@example.invalid', jsonb_build_object('role','student','first_name','Lee','date_of_birth',adult), '{}'),
    (v_a, z,'authenticated','authenticated','sl.a.'||v_a||'@example.invalid', jsonb_build_object('role','tutor','first_name','Alpha','date_of_birth',adult), '{}'),
    (v_b, z,'authenticated','authenticated','sl.b.'||v_b||'@example.invalid', jsonb_build_object('role','tutor','first_name','Bravo','date_of_birth',adult), '{}');
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_c, z,'authenticated','authenticated','sl.c.'||v_c||'@example.invalid', jsonb_build_object('role','student','first_name','Chi','date_of_birth',minor),
       jsonb_build_object('created_by_guardian', v_p, 'relationship','mother'));

  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status)
    values (v_c, v_a, v_p, now() + interval '2 days', 50, 30, 50, 35, 'scheduled') returning id into s1;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status)
    values (v_l, v_a, v_l, now() + interval '2 days', 50, 30, 50, 35, 'scheduled') returning id into s2;

  -- the tutor saves the link for the child's session booked by the parent
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.set_session_meeting_link(s1, 'https://meet.google.com/abc-defg-hij');
  reset role;
  select count(*) into n from notifications where type = 'session_link' and related_session_id = s1 and profile_id = v_c;
  r := r || format('L1 the child is told the link is ready: notes=%s (want 1)', n) || E'\n';
  select count(*) into n from notifications where type = 'session_link' and related_session_id = s1 and profile_id = v_p;
  r := r || format('L2 the parent who booked it is told too: notes=%s (want 1)', n) || E'\n';
  select count(*) into n from notifications where type = 'session_link' and related_session_id = s1;
  r := r || format('L3 nobody else is told: total notes=%s (want 2)', n) || E'\n';
  select meeting_url into t from sessions where id = s1;
  r := r || format('L4 the link is saved: %s (want https://meet.google.com/abc-defg-hij)', t) || E'\n';

  -- an adult learner who booked for themselves is told once, not twice
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.set_session_meeting_link(s2, 'https://meet.google.com/xyz-uvwx-yza');
  reset role;
  select count(*) into n from notifications where type = 'session_link' and related_session_id = s2 and profile_id = v_l;
  r := r || format('L5 a learner who booked for themselves is told once: notes=%s (want 1)', n) || E'\n';
  select count(*) into n from notifications where type = 'session_link' and related_session_id = s2;
  r := r || format('L6 and nobody else: total notes=%s (want 1)', n) || E'\n';

  -- the old checks still hold
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_session_meeting_link(s1, 'https://evil.example/room');
    r := r || 'L7 FAIL: another tutor set the link' || E'\n';
  exception when others then r := r || format('L7 another tutor cannot set it: %s', sqlerrm) || E'\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_session_meeting_link(s1, 'http://not-secure.example/room');
    r := r || 'L8 FAIL: a non-https link was accepted' || E'\n';
  exception when others then r := r || format('L8 a link that is not https is refused: %s', sqlerrm) || E'\n'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_session_meeting_link(s1, 'https://meet.google.com/abc-defg-hij');
    r := r || 'L9 FAIL: the parent set the link' || E'\n';
  exception when others then r := r || format('L9 the parent cannot set it: %s', sqlerrm) || E'\n'; end;
  reset role;

  raise exception 'SESSION LINK TEST (rolled back): %', r;
end $$;
