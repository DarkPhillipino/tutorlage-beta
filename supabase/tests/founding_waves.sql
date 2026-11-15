-- Rolled-back test of migration 20261111120000_founding_waves.sql (the dated steps per person, funnel by wave, release suggestions, the trigger panel, the verification
-- pipeline, the form-answer summaries, abandons by last field and the wave number; 11 Nov 2026).
-- Run it ONCE. Before the apply, run it together with the migration in ONE rolled-back statement, migration FIRST:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/founding_waves.sql supabase/migrations/20261111120000_founding_waves.sql
-- (after the apply, paste this file alone). Fixtures are made-up people (example.invalid) inserted as the owner, in waves 71 and up so they sit above any real wave. The block raises an
-- error at the end on purpose, so nothing is kept. The answer is short: how many lines and how many FAIL, every FAIL line in full, then the ids of the lines that passed.
-- Rule used throughout: never read a row in the SAME statement as the call that changes it (one statement cannot see its own function's writes): write, then read in the next statement.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  v_vo uuid := gen_random_uuid();
  v_su uuid := gen_random_uuid();
  v_ld uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid();   -- the full chain, to a second completed lesson
  u2 uuid := gen_random_uuid();   -- an account only
  u3 uuid := gen_random_uuid();   -- declined (police clearance rejected)
  u4 uuid := gen_random_uuid();   -- a complete document set waiting 8 days
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_p5 uuid; v_p6 uuid;
  v_q1 uuid; v_q2 uuid; v_q3 uuid;
  v_a uuid; v_b uuid; v_c uuid;
  v_enr uuid;
  v_vis_a uuid := gen_random_uuid(); v_vis_b uuid := gen_random_uuid(); v_vis_c uuid := gen_random_uuid(); v_vis_t uuid := gen_random_uuid();
  v_h1 timestamptz; v_h2 timestamptz;
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  j jsonb;
  t text; t2 text; t3 text; nfail int; nok int; nlines int;
begin
  begin
  execute $mk$
    create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
      select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
             || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
    $f$ $mk$;
  execute $mk$
    create function pg_temp.pfx(p_got text, p_prefix text) returns text language sql as $f$
      select case when p_got like p_prefix || '%' then p_prefix else p_got end
    $f$ $mk$;
  execute $mk$
    create function pg_temp.run_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
    declare v text;
    begin
      if p_u is null then
        perform set_config('request.jwt.claims', '', true);
        set local role anon;
      else
        perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true);
        set local role authenticated;
      end if;
      begin
        execute p_sql into v;
        reset role;
        return coalesce(v, 'null');
      exception when others then
        reset role;
        return 'ERR: ' || sqlerrm;
      end;
    end $f$ $mk$;
  execute $mk$
    create function pg_temp.do_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
    begin
      if p_u is null then
        perform set_config('request.jwt.claims', '', true);
        set local role anon;
      else
        perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true);
        set local role authenticated;
      end if;
      begin
        execute p_sql;
        reset role;
        return 'done';
      exception when others then
        reset role;
        return 'ERR: ' || sqlerrm;
      end;
    end $f$ $mk$;
  execute $mk$
    create function pg_temp.deny(p_got text) returns text language sql as $f$ select pg_temp.pfx(p_got, 'ERR: permission denied for') $f$ $mk$;
  execute $mk$
    create function pg_temp.adm(p_u uuid, p_call text) returns text language sql as $f$
      select pg_temp.run_as(p_u, 'select (' || p_call || ')::text')
    $f$ $mk$;

  -- ---- people -----------------------------------------------------------------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_vo, z, 'authenticated', 'authenticated', 'fw.vo.' || v_vo || '@example.invalid', jsonb_build_object('first_name', 'Vic', 'surname', 'Officer', 'date_of_birth', adult), '{}'),
    (v_su, z, 'authenticated', 'authenticated', 'fw.su.' || v_su || '@example.invalid', jsonb_build_object('first_name', 'Sam', 'surname', 'Support', 'date_of_birth', adult), '{}'),
    (v_ld, z, 'authenticated', 'authenticated', 'fw.ld.' || v_ld || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Lee', 'surname', 'Learner', 'date_of_birth', adult), '{}'),
    (u1, z, 'authenticated', 'authenticated', 'fw.u1.' || u1 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tia', 'surname', 'One', 'date_of_birth', adult), '{}'),
    (u2, z, 'authenticated', 'authenticated', 'fw.t2.' || u2 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tom', 'surname', 'Two', 'date_of_birth', adult), '{}'),
    (u3, z, 'authenticated', 'authenticated', 'fw.u3.' || u3 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tess', 'surname', 'Three', 'date_of_birth', adult), '{}'),
    (u4, z, 'authenticated', 'authenticated', 'fw.u4.' || u4 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Ted', 'surname', 'Four', 'date_of_birth', adult), '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (v_vo, 'Vic', 'Officer', 'fw.vo.' || v_vo || '@example.invalid', '', 'verification_officer', true),
    (v_su, 'Sam', 'Support', 'fw.su.' || v_su || '@example.invalid', '', 'support_agent', true);

  -- the list: wave 71, released 20 days ago, message sent 19 days ago (P5 lapsed, P3 and P5 have no account)
  insert into founding_tutors_list (source, full_name, code_name, whatsapp, email, email_key, status, wave, released_at, released_messaged_at, delete_after, consent_version) values
    ('form', 'Fw Pa1', 'Pa1', '+27820001001', 'fw.u1.' || u1 || '@example.invalid', 'fw.u1.' || u1 || '@example.invalid', 'released', 71, now() - interval '20 days', now() - interval '19 days', now() + interval '10 days', 'test'),
    ('form', 'Fw Pa2', 'Pa2', '+27820001002', 'fw.t2.' || u2 || '@example.invalid', 'fw.t2.' || u2 || '@example.invalid', 'released', 71, now() - interval '20 days', now() - interval '19 days', now() + interval '10 days', 'test'),
    ('form', 'Fw Pa3', 'Pa3', '+27820001003', 'fw.p3@example.invalid', 'fw.p3@example.invalid', 'released', 71, now() - interval '20 days', now() - interval '19 days', now() + interval '10 days', 'test'),
    ('form', 'Fw Pa4', 'Pa4', '+27820001004', 'fw.u3.' || u3 || '@example.invalid', 'fw.u3.' || u3 || '@example.invalid', 'released', 71, now() - interval '20 days', now() - interval '19 days', now() + interval '10 days', 'test'),
    ('form', 'Fw Pa5', 'Pa5', '+27820001005', 'fw.p5@example.invalid', 'fw.p5@example.invalid', 'joined', 71, now() - interval '20 days', now() - interval '19 days', now() + interval '10 days', 'test'),
    ('form', 'Fw Pa6', 'Pa6', '+27820001006', 'fw.u4.' || u4 || '@example.invalid', 'fw.u4.' || u4 || '@example.invalid', 'released', 71, now() - interval '20 days', now() - interval '19 days', now() + interval '10 days', 'test');
  update founding_tutors_list set lapsed_at = now() - interval '3 days' where email_key = 'fw.p5@example.invalid';
  select id into v_p1 from founding_tutors_list where code_name = 'Pa1' and consent_version = 'test' and email_key like 'fw.u1.%';
  select id into v_p2 from founding_tutors_list where code_name = 'Pa2' and email_key like 'fw.t2.%';
  select id into v_p3 from founding_tutors_list where email_key = 'fw.p3@example.invalid';
  select id into v_p4 from founding_tutors_list where code_name = 'Pa4' and email_key like 'fw.u3.%';
  select id into v_p5 from founding_tutors_list where email_key = 'fw.p5@example.invalid';
  select id into v_p6 from founding_tutors_list where code_name = 'Pa6' and email_key like 'fw.u4.%';

  -- u1: the whole chain, with chosen dates
  update profiles set created_at = now() - interval '18 days' where id = u1;
  update profiles set created_at = now() - interval '15 days' where id = u2;
  update profiles set created_at = now() - interval '12 days' where id = u3;
  update profiles set created_at = now() - interval '13 days' where id = u4;
  insert into tutor_onboarding (tutor_id, track, consented_at, consent_version) values (u1, 'beginner', now() - interval '17 days', 'test');
  insert into tutor_subject_competencies (tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status, created_at)
    values (u1, 'Zz Test Subject', 'caps', 'Grade 8', 'Grade 10', 'verified', now() - interval '17 days');
  insert into tutor_verification_documents (tutor_id, document_type, document_url, uploaded_at) values (u1, 'identity_doc', u1 || '/id.pdf', now() - interval '16 days');
  insert into tutor_verification_documents (tutor_id, document_type, document_url, issued_on, uploaded_at) values (u1, 'police_clearance', u1 || '/pc.pdf', v_today, now() - interval '16 days');
  insert into tutor_verification_documents (tutor_id, document_type, document_url, uploaded_at) values (u1, 'subject_results', u1 || '/res.pdf', now() - interval '16 days');
  select (completed_at is not null)::text into t from tutor_onboarding where tutor_id = u1;
  r := r || pg_temp.chk('FX1', 'fixture: the documents-complete stamp (completed_at) was made by the existing triggers', t, 'true');
  update tutor_onboarding set completed_at = now() - interval '14 days' where tutor_id = u1;
  update tutor_profiles set is_verified = true where id = u1;
  select (verified_at is not null and verified_at > now() - interval '1 minute')::text into t from tutor_profiles where id = u1;
  r := r || pg_temp.chk('TS1', 'STAMPS: turning is_verified on stamps verified_at', t, 'true');
  update tutor_profiles set verified_at = now() - interval '10 days', first_request_seen_at = now() - interval '9 days' where id = u1;
  begin
    insert into sessions (student_id, tutor_id, status, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, scheduled_start, created_at, completed_at) values
      (v_ld, u1, 'completed', 100, 20, 100, 80, now() - interval '7 days', now() - interval '8 days', now() - interval '7 days'),
      (v_ld, u1, 'completed', 100, 20, 100, 80, now() - interval '5 days', now() - interval '6 days', now() - interval '5 days');
  exception when others then
    r := r || 'FX2 FAIL: the two completed sessions were refused: ' || sqlerrm || E'\n';
  end;

  -- t2: an account only. u3: declined. u4: a complete set waiting 8 days.
  insert into tutor_verification_documents (tutor_id, document_type, document_url, issued_on, status) values (u3, 'police_clearance', u3 || '/pc.pdf', v_today - 400, 'rejected');
  update tutor_profiles set onboarding_status = 'rejected' where id = u3;
  insert into tutor_onboarding (tutor_id, track, consented_at, consent_version, completed_at) values (u4, 'beginner', now() - interval '9 days', 'test', now() - interval '8 days');

  -- ---- S: what exists and who may touch it ------------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('S1', 'the two new views and the new table are closed to every API role',
    (select string_agg(has_table_privilege(x.role, x.rel, 'select')::text, '/' order by x.role, x.rel)
       from (select ro.role, re.rel from (values ('anon'), ('authenticated'), ('service_role')) ro(role) cross join (values ('public.founding_person_steps'), ('public.founding_tutor_facts'), ('public.founding_form_fields')) re(rel)) x),
    'false/false/false/false/false/false/false/false/false');
  r := r || pg_temp.chk('S2', 'the admin functions are closed to signed-out callers',
    (select string_agg(has_function_privilege('anon', p.oid, 'execute')::text, '/' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('admin_founding_steps', 'admin_founding_waves', 'admin_founding_pipeline', 'admin_founding_triggers', 'admin_set_founding_stop_rule', 'admin_founding_suggestion',
                        'admin_set_founding_suggest_skip', 'admin_set_founding_wave_cap', 'admin_founding_answers', 'admin_founding_abandons', 'admin_release_founding', 'admin_set_founding_wave', 'admin_mark_founding_contacted')),
    'false/false/false/false/false/false/false/false/false/false/false/false/false');
  r := r || pg_temp.chk('S3', 'the page can log a field name (signed out and signed in); the internal rate function and the stamp functions are closed',
    has_function_privilege('anon', 'public.log_founding_field(text,text,text)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.log_founding_field(text,text,text)', 'execute')::text || '/'
    || has_function_privilege('authenticated', 'public.founding_release_rate()', 'execute')::text || '/' || has_function_privilege('anon', 'public.tutor_funnel_stamps()', 'execute')::text || '/'
    || has_function_privilege('authenticated', 'public.tutor_hours_saved_stamp()', 'execute')::text, 'true/true/false/false/false');
  r := r || pg_temp.chk('S4', 'the seeded settings: wave cap 15, default rate 0.36, no stop rule marked by hand',
    (select string_agg(s.setting_key || '=' || s.setting_value::text, ' ' order by s.setting_key) from system_settings s where s.setting_key in ('founding_wave_cap', 'founding_release_rate_default', 'founding_stop_rules_open')),
    'founding_release_rate_default=0.36 founding_stop_rules_open=[] founding_wave_cap=15');
  select string_agg(tg.tgname || ':' || ((tg.tgtype & 4) = 4)::text || '/' || ((tg.tgtype & 16) = 16)::text, ' ' order by tg.tgname) into t
    from pg_trigger tg where not tg.tgisinternal and tg.tgname in ('tutor_funnel_stamps', 'tutor_hours_saved_stamp');
  r := r || pg_temp.chk('S5', 'the stamp triggers exist (the profile one covers insert and update; the hours one only insert)', t, 'tutor_funnel_stamps:true/true tutor_hours_saved_stamp:true/false');
  r := r || pg_temp.chk('S6', 'every new function pins search_path=public',
    (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('admin_founding_steps', 'admin_founding_waves', 'admin_founding_pipeline', 'admin_founding_triggers', 'admin_set_founding_stop_rule', 'admin_founding_suggestion', 'admin_set_founding_suggest_skip',
                         'admin_set_founding_wave_cap', 'admin_founding_answers', 'admin_founding_abandons', 'log_founding_field', 'admin_release_founding', 'admin_set_founding_wave', 'admin_mark_founding_contacted',
                         'founding_release_rate', 'tutor_funnel_stamps', 'tutor_hours_saved_stamp')
       and (p.proconfig is null or not ('search_path=public' = any (p.proconfig)))), '0');
  r := r || pg_temp.chk('S7', 'a support agent is refused by every new admin function',
    pg_temp.pfx(pg_temp.adm(v_su, 'public.admin_founding_steps()'), 'ERR: Only a verification officer') || '/' || pg_temp.pfx(pg_temp.adm(v_su, 'public.admin_founding_waves()'), 'ERR: Only a verification officer') || '/'
    || pg_temp.pfx(pg_temp.adm(v_su, 'public.admin_founding_pipeline()'), 'ERR: Only a verification officer') || '/' || pg_temp.pfx(pg_temp.adm(v_su, 'public.admin_founding_triggers()'), 'ERR: Only a verification officer') || '/'
    || pg_temp.pfx(pg_temp.adm(v_su, 'public.admin_founding_suggestion()'), 'ERR: Only a verification officer') || '/' || pg_temp.pfx(pg_temp.adm(v_su, 'public.admin_founding_answers()'), 'ERR: Only a verification officer') || '/'
    || pg_temp.pfx(pg_temp.adm(v_su, 'public.admin_founding_abandons()'), 'ERR: Only a verification officer') || '/' || pg_temp.pfx(pg_temp.adm(v_su, 'public.admin_set_founding_wave_cap(10)'), 'ERR: Only a verification officer') || '/'
    || pg_temp.pfx(pg_temp.adm(v_su, format('public.admin_set_founding_wave(array[%L]::uuid[], 5)', v_p1)), 'ERR: Only a verification officer') || '/'
    || pg_temp.pfx(pg_temp.adm(v_su, format('public.admin_set_founding_suggest_skip(%L, true)', v_p1)), 'ERR: Only a verification officer') || '/'
    || pg_temp.pfx(pg_temp.adm(v_su, format('public.admin_mark_founding_contacted(%L)', v_p1)), 'ERR: Only a verification officer') || '/'
    || pg_temp.pfx(pg_temp.adm(v_su, 'public.admin_set_founding_stop_rule(3, true, ''x'')'), 'ERR: Only a verification officer'),
    repeat('ERR: Only a verification officer/', 11) || 'ERR: Only a verification officer');

  -- ---- TS: the stamps -----------------------------------------------------------------------------------------------------------------------------
  t := pg_temp.do_as(u2, format('update public.tutor_profiles set verified_at = now(), declined_at = now(), hours_saved_at = now() where id = %L', u2));
  select coalesce(verified_at::text, 'null') || '|' || coalesce(declined_at::text, 'null') || '|' || coalesce(hours_saved_at::text, 'null') into t2 from tutor_profiles where id = u2;
  r := r || pg_temp.chk('TS2', 'a person cannot write verified_at, declined_at or hours_saved_at on their own profile (quietly undone)', t2, 'null|null|null');
  select (declined_at is not null)::text || '|' || (verified_at is null)::text into t2 from tutor_profiles where id = u3;
  r := r || pg_temp.chk('TS3', 'turning onboarding_status to rejected stamps declined_at', t2, 'true|true');
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) values (u1, 1, '16:00', '18:00');
  select hours_saved_at into v_h1 from tutor_profiles where id = u1;
  r := r || pg_temp.chk('TS4', 'saving hours for the first time stamps hours_saved_at', (v_h1 is not null and v_h1 > now() - interval '1 minute')::text, 'true');
  update tutor_profiles set hours_saved_at = now() - interval '5 days' where id = u1;
  select hours_saved_at into v_h2 from tutor_profiles where id = u1;
  insert into tutor_availability (tutor_id, day_of_week, start_time, end_time) values (u1, 3, '16:00', '17:00');
  select (hours_saved_at = v_h2)::text into t from tutor_profiles where id = u1;
  r := r || pg_temp.chk('TS5', 'a later hours save does not move it (set once)', t, 'true');

  -- ---- R5: the steps ------------------------------------------------------------------------------------------------------------------------------
  t := pg_temp.adm(v_vo, 'public.admin_founding_steps()');
  r := r || pg_temp.chk('R5a', 'the steps answer is a list and holds no backfill row',
    (jsonb_typeof(t::jsonb) = 'array')::text || '|' || (select count(*)::text from jsonb_array_elements(t::jsonb) e where e.value ->> 'source' = 'backfill'), 'true|0');
  select string_agg((e.value ->> 'code_name') || '=' || (e.value ->> 'stage'), ' ' order by e.value ->> 'code_name') into t2
    from jsonb_array_elements(t::jsonb) e where e.value ->> 'code_name' in ('Pa1', 'Pa2', 'Pa3', 'Pa4', 'Pa5', 'Pa6') and e.value ->> 'full_name' like 'Fw Pa%';
  r := r || pg_temp.chk('R5b', 'the furthest step reached, per person: lessons, account, message sent, declined, lapsed, documents complete',
    t2, 'Pa1=second_lesson Pa2=account Pa3=messaged Pa4=declined Pa5=lapsed Pa6=documents_complete');
  select (e.value ->> 'signup_finished_at' is not null)::text || '|' || (e.value ->> 'documents_complete_at' is not null)::text || '|' || (e.value ->> 'approved_at' is not null)::text || '|' || (e.value ->> 'first_request_seen_at' is not null)::text
         || '|' || (e.value ->> 'first_accepted_at' is not null)::text || '|' || (e.value ->> 'first_completed_at' is not null)::text || '|' || (e.value ->> 'second_completed_at' is not null)::text
         || '|' || (e.value ->> 'hours_saved_at' is not null)::text || '|' || (e.value ->> 'has_hours') into t2
    from jsonb_array_elements(t::jsonb) e where e.value ->> 'id' = v_p1::text;
  r := r || pg_temp.chk('R5c', 'the whole chain for one person is dated: sign-up finished, documents, approved, first request, accepted, completed, second, hours', coalesce(t2, '-'), 'true|true|true|true|true|true|true|true|true');
  select (e.value ->> 'decline_reason') || '|' || (e.value ->> 'is_declined') || '|' || (e.value ->> 'wave') || '|' || (e.value ->> 'released_messaged_at' is not null)::text into t2
    from jsonb_array_elements(t::jsonb) e where e.value ->> 'id' = v_p4::text;
  r := r || pg_temp.chk('R5d', 'a declined person carries a reason code (a rejected police clearance reads "clearance"), the wave and the message date', coalesce(t2, '-'), 'clearance|true|71|true');

  -- ---- R6: funnel by wave -------------------------------------------------------------------------------------------------------------------------
  t := pg_temp.adm(v_vo, 'public.admin_founding_waves()');
  select (e.value ->> 'released') || '/' || (e.value ->> 'messaged') || '/' || (e.value ->> 'lapsed') || '/' || (e.value ->> 'declined') into t2 from jsonb_array_elements(t::jsonb) e where (e.value ->> 'wave')::int = 71;
  r := r || pg_temp.chk('R6a', 'wave 71: 6 released, 6 messaged, 1 lapsed, 1 declined', coalesce(t2, '-'), '6/6/1/1');
  select string_agg((s.value ->> 'key') || ':' || (s.value ->> 'n') || ':' || (s.value ->> 'pct') || ':' || coalesce(s.value ->> 'median_days', 'null') || ':' || coalesce(s.value ->> 'oldest_days', 'null'), ' ' order by s.ordinality) into t2
    from jsonb_array_elements(t::jsonb) e cross join lateral jsonb_array_elements(e.value -> 'steps') with ordinality s(value, ordinality) where (e.value ->> 'wave')::int = 71;
  r := r || pg_temp.chk('R6b', 'wave 71 step by step: how many, the percentage of those released, the median days from the step before, the oldest person waiting',
    coalesce(t2, '-'),
    'account:4:67:6.0:20.0 signup_finished:1:17:1.0:15.0 documents_complete:2:33:3.0:null approved:1:17:4.0:8.0 first_request:1:17:1.0:null first_accepted:1:17:1.0:null first_completed:1:17:1.0:null second_completed:1:17:2.0:null');
  select (s.value ->> 'avg_days') into t2 from jsonb_array_elements(t::jsonb) e cross join lateral jsonb_array_elements(e.value -> 'steps') s where (e.value ->> 'wave')::int = 71 and s.value ->> 'key' = 'account';
  r := r || pg_temp.chk('R6c', 'the average days from release to account (2, 5, 7 and 8 days)', coalesce(t2, '-'), '5.5');
  select ((e.value ->> 'released')::int >= 6)::text || '|' || (e.value ->> 'wave') into t2 from jsonb_array_elements(t::jsonb) e where (e.value ->> 'wave')::int = 0;
  r := r || pg_temp.chk('R6d', 'the last block is all waves together (wave 0) and holds at least these six', coalesce(t2, '-'), 'true|0');

  -- ---- R10: the verification pipeline ---------------------------------------------------------------------------------------------------------------
  t := pg_temp.adm(v_vo, 'public.admin_founding_pipeline()');
  j := t::jsonb;
  r := r || pg_temp.chk('R10a', 'a complete set waiting 8 days shows: waiting at least 1, the oldest at least 8 days, over 5 and over 7 days at least 1',
    ((j ->> 'waiting')::int >= 1)::text || '|' || ((j ->> 'oldest_days')::numeric >= 8)::text || '|' || ((j ->> 'over_5_days')::int >= 1)::text || '|' || ((j ->> 'over_7_days')::int >= 1)::text, 'true|true|true|true');
  r := r || pg_temp.chk('R10b', 'declines by reason counts the rejected police clearance, and the 12 weeks are listed newest first',
    ((j -> 'declines_by_reason' ->> 'clearance')::int >= 1)::text || '|' || jsonb_array_length(j -> 'by_week')::text || '|' || ((j -> 'by_week' -> 0 ->> 'week_start')::date >= v_today - 6)::text, 'true|12|true');
  select string_agg((w.value ->> 'approved') || '/' || (w.value ->> 'completed'), ' ') into t2
    from jsonb_array_elements(j -> 'by_week') w where (w.value ->> 'week_start')::date <= v_today - 10 and (w.value ->> 'week_start')::date > v_today - 17;
  r := r || pg_temp.chk('R10c', 'the approval 10 days ago and the complete set 14 days ago land in their own weeks (counts at least 1 between them)',
    (coalesce((select sum((w.value ->> 'approved')::int) from jsonb_array_elements(j -> 'by_week') w where (w.value ->> 'week_start')::date <= v_today - 10 and (w.value ->> 'week_start')::date > v_today - 17), 0) >= 1)::text, 'true');
  r := r || pg_temp.chk('R10d', 'the average days from complete set to approval is worked out (4 days for the made-up tutor)',
    ((j ->> 'avg_days_to_approval') is not null)::text, 'true');

  -- ---- demand fixtures (for R9 and R8): one unserved request for a made-up subject, and three people waiting ----------------------------------------
  begin
    insert into student_subject_enrollments (student_id, subject_name, grade_level) values (v_ld, 'Zz Demand Subject', 'Grade 5') returning id into v_enr;
    insert into session_requests (student_id, requested_by_profile_id, requested_start, enrollment_id, status, created_at) values (v_ld, v_ld, now() + interval '2 days', v_enr, 'pending', now() - interval '30 hours');
  exception when others then
    r := r || 'FX3 FAIL: the demand fixture was refused: ' || sqlerrm || E'\n';
  end;
  insert into founding_tutors_list (source, full_name, code_name, whatsapp, email, email_key, status, subjects, src, created_at, practicum, police_clearance, parent_reach, parent_reach_willing, availability, heard_from,
                                    consent_marketing_at, has_device, has_connection, has_bank, delete_after, consent_version) values
    ('form', 'Fw Q1', 'Qz1', '+27820002001', 'fw.q1@example.invalid', 'fw.q1@example.invalid', 'joined', '[{"subject": "Zz Demand Subject", "min_grade": "Grade 4", "max_grade": "Grade 6"}]'::jsonb, 'zzw', now() - interval '2 days',
     'two', 'have', '10_to_30', true, array['evenings', 'weekends'], 'message', now(), true, true, false, now() + interval '5 months', 'test'),
    ('form', 'Fw Q2', 'Qz2', '+27820002002', 'fw.q2@example.invalid', 'fw.q2@example.invalid', 'joined', '[{"subject": "Zz Demand Subject", "min_grade": "Grade 4", "max_grade": "Grade 6"}]'::jsonb, 'zzw', now() - interval '1 day',
     'none', 'applied', 'up_to_10', false, array['evenings'], 'friend', null, true, false, false, now() + interval '5 months', 'test'),
    ('form', 'Fw Q3', 'Qz3', '+27820002003', 'fw.q3@example.invalid', 'fw.q3@example.invalid', 'joined', '[{"subject": "Zz Other Subject", "min_grade": "Grade 8", "max_grade": "Grade 10"}]'::jsonb, 'zzw', now() - interval '30 days',
     'one', 'not_yet', 'over_30', true, array['holidays'], null, null, false, false, false, now() + interval '5 months', 'test');
  select id into v_q1 from founding_tutors_list where email_key = 'fw.q1@example.invalid';
  select id into v_q2 from founding_tutors_list where email_key = 'fw.q2@example.invalid';
  select id into v_q3 from founding_tutors_list where email_key = 'fw.q3@example.invalid';

  -- ---- R9: the trigger panel (the current wave is 71) -----------------------------------------------------------------------------------------------
  t := pg_temp.adm(v_vo, 'public.admin_founding_triggers()');
  j := t::jsonb;
  r := r || pg_temp.chk('R9a', 'the current wave is 71, B1 demand is met (the unserved request is listed), B2 is met (1 of 1 approved is getting work, 100 percent, the line is 60)',
    (j ->> 'current_wave') || '|' || (j -> 'b1' ->> 'state') || '|' || ((j -> 'b1' ->> 'demand_rows')::int >= 1)::text || '|' || (j -> 'b2' ->> 'state') || '|' || (j -> 'b2' ->> 'approved') || '/' || (j -> 'b2' ->> 'working') || '|' || (j -> 'b2' ->> 'share_pct') || '|' || (j -> 'b2' ->> 'line_pct'),
    '71|met|true|met|1/1|100|60');
  r := r || pg_temp.chk('R9b', 'B3 the queue is NOT clear (the made-up complete set has waited 8 days), and B5 is not met because stop rule 4 (verification overdue) is open',
    (j -> 'b3' ->> 'state') || '|' || (j -> 'b3' ->> 'waiting') || '|' || (j -> 'b3' ->> 'oldest_days') || '|' || (j -> 'b5' ->> 'state') || '|' || (j ->> 'all_clear'), 'not_met|1|8.0|not_met|false');
  select string_agg((e.value ->> 'rule') || '=' || case when (e.value ->> 'rule')::int in (5, 6) then 'x' else (e.value ->> 'open') end || '/' || (e.value ->> 'kind'), ' ' order by (e.value ->> 'rule')::int) into t2 from jsonb_array_elements(j -> 'stop_rules') e;
  r := r || pg_temp.chk('R9c', 'all eight stop rules are listed; 4 is open (worked out), the hand-marked ones are closed, 5 and 6 are worked out (their open state is not asserted: it follows live data)',
    t2, '1=false/manual 2=false/manual 3=false/manual 4=true/auto 5=x/auto 6=x/auto 7=false/manual 8=false/manual');
  t := pg_temp.adm(v_vo, 'public.admin_set_founding_stop_rule(3, true, ''the form failed for two hours'')->>''ok''');
  t2 := pg_temp.adm(v_vo, 'public.admin_founding_triggers()');
  select (e.value ->> 'open') || '|' || coalesce(e.value ->> 'note', '-') || '|' || ((e.value ->> 'since') is not null)::text into t3 from jsonb_array_elements(t2::jsonb -> 'stop_rules') e where (e.value ->> 'rule')::int = 3;
  r := r || pg_temp.chk('R9d', 'marking rule 3 open by hand shows it open with the note and the date', t || '|' || coalesce(t3, '-'), 'true|true|the form failed for two hours|true');
  r := r || pg_temp.chk('R9e', 'rules 4, 5 and 6 cannot be marked by hand; a wrong value is refused',
    pg_temp.pfx(pg_temp.adm(v_vo, 'public.admin_set_founding_stop_rule(4, true, null)'), 'ERR: Rules 4, 5 and 6 are worked out') || '/' || pg_temp.pfx(pg_temp.adm(v_vo, 'public.admin_set_founding_stop_rule(3, null, null)'), 'ERR: Choose open or closed'),
    'ERR: Rules 4, 5 and 6 are worked out/ERR: Choose open or closed');
  t := pg_temp.adm(v_vo, 'public.admin_set_founding_stop_rule(3, false, null)->>''ok''');
  t2 := pg_temp.adm(v_vo, 'public.admin_founding_triggers()');
  select (e.value ->> 'open') into t3 from jsonb_array_elements(t2::jsonb -> 'stop_rules') e where (e.value ->> 'rule')::int = 3;
  r := r || pg_temp.chk('R9f', 'closing it again clears it', t || '|' || coalesce(t3, '-'), 'true|false');

  -- ---- R8: the suggested release list ---------------------------------------------------------------------------------------------------------------
  t := pg_temp.adm(v_vo, 'public.admin_founding_suggestion()');
  j := t::jsonb;
  r := r || pg_temp.chk('R8a', 'the cap is 15, the next wave is 72, the measured rate uses wave 71 (6 released, 1 approved), the gap is at least 3 and the size is at least 1 and at most the cap',
    (j ->> 'cap') || '|' || (j ->> 'next_wave') || '|' || (j ->> 'rate_measured') || '|' || ((j -> 'rate_waves') @> '[71]')::text || '|' || ((j ->> 'gap')::int >= 3)::text || '|' || ((j ->> 'suggested_n')::int between 1 and 15)::text,
    '15|72|true|true|true|true');
  select string_agg((e.value ->> 'code_name') || ':' || (e.value ->> 'covers_n') || ':' || (e.value ->> 'suggested'), ' ' order by e.ordinality) into t2
    from jsonb_array_elements(j -> 'people') with ordinality e(value, ordinality) where e.value ->> 'code_name' like 'Qz%';
  r := r || pg_temp.chk('R8b', 'the order rule: the two who cover the demand first, then the one who does not, though she joined 30 days before them',
    coalesce(t2, '-'), 'Qz1:1:true Qz2:1:true Qz3:0:true');
  select (e.value ->> 'subject') || '|' || (e.value ->> 'phase') || '|' || (e.value ->> 'shortfall') || '|' || (e.value ->> 'unserved') || '|' || (e.value ->> 'people_waiting') into t2
    from jsonb_array_elements(j -> 'demand') e where e.value ->> 'subject' = 'Zz Demand Subject';
  r := r || pg_temp.chk('R8c', 'the demand row: subject, band, shortfall 3, 1 unserved request, 2 people waiting who could cover it', coalesce(t2, '-'), 'Zz Demand Subject|Intermediate (4-6)|3|1|2');
  t := pg_temp.adm(v_vo, 'public.admin_set_founding_wave_cap(2)->>''cap''');
  t2 := pg_temp.adm(v_vo, 'public.admin_founding_suggestion()');
  select (t2::jsonb ->> 'cap') || '|' || (t2::jsonb ->> 'suggested_n') || '|' || (select string_agg((e.value ->> 'code_name') || ':' || (e.value ->> 'suggested'), ' ' order by e.ordinality)
         from jsonb_array_elements(t2::jsonb -> 'people') with ordinality e(value, ordinality) where e.value ->> 'code_name' like 'Qz%') into t2;
  r := r || pg_temp.chk('R8d', 'a cap of 2 limits the suggestion to the first two', t || '|' || t2, '2|2|2|Qz1:true Qz2:true Qz3:false');
  r := r || pg_temp.chk('R8e', 'the cap is a number from 1 to 200',
    pg_temp.pfx(pg_temp.adm(v_vo, 'public.admin_set_founding_wave_cap(0)'), 'ERR: The wave cap is a number from 1 to 200') || '/' || pg_temp.pfx(pg_temp.adm(v_vo, 'public.admin_set_founding_wave_cap(201)'), 'ERR: The wave cap is a number from 1 to 200'),
    'ERR: The wave cap is a number from 1 to 200/ERR: The wave cap is a number from 1 to 200');
  t := pg_temp.adm(v_vo, 'public.admin_set_founding_wave_cap(15)->>''cap''');
  t2 := pg_temp.adm(v_vo, format('public.admin_set_founding_suggest_skip(%L, true)->>''ok''', v_q1));
  j := pg_temp.adm(v_vo, 'public.admin_founding_suggestion()')::jsonb;
  select string_agg((e.value ->> 'code_name') || ':' || (e.value ->> 'skipped') || ':' || (e.value ->> 'suggested'), ' ' order by e.ordinality) into t from jsonb_array_elements(j -> 'people') with ordinality e(value, ordinality) where e.value ->> 'code_name' like 'Qz%';
  r := r || pg_temp.chk('R8f', 'taken off by hand: Qz1 is marked skipped and not suggested, and goes to the end of the list', t2 || '|' || t, 'true|Qz2:false:true Qz3:false:true Qz1:true:false');
  t2 := pg_temp.adm(v_vo, format('public.admin_set_founding_suggest_skip(%L, false)->>''ok''', v_q1));
  r := r || pg_temp.chk('R8g', 'put back; an unknown entry is refused', t2 || '|' || pg_temp.pfx(pg_temp.adm(v_vo, format('public.admin_set_founding_suggest_skip(%L, true)', gen_random_uuid())), 'ERR: No such entry'), 'true|ERR: No such entry');

  -- ---- R11: form-answer summaries (the three made-up people, tag zzw) -----------------------------------------------------------------------------
  t := pg_temp.adm(v_vo, 'public.admin_founding_answers(null, null, ''zzw'')');
  j := t::jsonb;
  r := r || pg_temp.chk('R11a', 'tag zzw: 3 people; police clearance have 1, applied 1, not yet 1; reach none 0, up to 10 1, 10 to 30 1, more than 30 1',
    (j ->> 'total') || '|' || (j -> 'police' ->> 'have') || (j -> 'police' ->> 'applied') || (j -> 'police' ->> 'not_yet') || '|' || (j -> 'parent_reach' ->> 'up_to_10') || (j -> 'parent_reach' ->> '10_to_30') || (j -> 'parent_reach' ->> 'over_30'), '3|111|111');
  r := r || pg_temp.chk('R11b', 'willing yes 2 and no 1; hours: evenings 2, weekends 1, holidays 1; news and offers yes 1 and no 2',
    (j -> 'willing' ->> 'yes') || (j -> 'willing' ->> 'no') || '|' || (j -> 'availability' ->> 'evenings') || (j -> 'availability' ->> 'weekends') || (j -> 'availability' ->> 'holidays') || '|' || (j -> 'consent_news' ->> 'yes') || (j -> 'consent_news' ->> 'no'), '21|211|12');
  r := r || pg_temp.chk('R11c', 'grade bands: Intermediate 2, Senior 1, FET 1; the top subject is the made-up one with 2 people',
    (j -> 'bands' ->> 'Intermediate (4-6)') || (j -> 'bands' ->> 'Senior (7-9)') || (j -> 'bands' ->> 'FET (10-12)') || '|' || (j -> 'top_subjects' -> 0 ->> 'subject') || ':' || (j -> 'top_subjects' -> 0 ->> 'n'), '211|Zz Demand Subject:2');
  r := r || pg_temp.chk('R11d', 'how they heard: a message 1 (none of them with a registered tag), a friend 1, not said 1; the have-ticks: device 2, connection 1, bank 0',
    (j -> 'heard' -> 'message' ->> 'n') || (j -> 'heard' -> 'friend' ->> 'n') || (j -> 'heard' -> '(not said)' ->> 'n') || '|' || (j -> 'heard' -> 'message' ->> 'with_registered_tag') || '|' || (j -> 'have' ->> 'device') || (j -> 'have' ->> 'connection') || (j -> 'have' ->> 'bank'), '111|0|210');
  t := pg_temp.adm(v_vo, format('public.admin_founding_answers(%L, null, ''zzw'')', v_today - 5));
  t2 := pg_temp.adm(v_vo, format('public.admin_founding_answers(%L, null, ''zzw'')', v_today + 1));
  r := r || pg_temp.chk('R11e', 'a date range leaves out the person who joined 30 days ago (2 since 5 days ago) and everyone after tomorrow (0)', (t::jsonb ->> 'total') || '|' || (t2::jsonb ->> 'total'), '2|0');
  r := r || pg_temp.chk('R11f', 'the answers hold counts only: no name, email or number appears in the answer',
    (not (pg_temp.adm(v_vo, 'public.admin_founding_answers(null, null, ''zzw'')') ~* '(fw\.q[0-9]@|Fw Q|\+2782000)'))::text, 'true');

  -- ---- R4: abandons by the last field touched -----------------------------------------------------------------------------------------------------
  insert into founding_page_events (visitor_id, event, src, first_src) values
    (v_vis_a, 'form_start', 'zzab', 'zzab'), (v_vis_b, 'form_start', 'zzab', 'zzab'), (v_vis_c, 'form_start', 'zzab', 'zzab'), (v_vis_b, 'join', 'zzab', 'zzab'), (v_vis_t, 'form_start', 'test-ab', 'test-ab');
  perform public.log_founding_field(v_vis_a::text, 'email', 'zzab');
  perform public.log_founding_field(v_vis_a::text, 'police_clearance', 'zzab');
  perform public.log_founding_field(v_vis_b::text, 'whatsapp', 'zzab');
  perform public.log_founding_field(v_vis_a::text, 'password', 'zzab');
  perform public.log_founding_field('not-a-uuid', 'email', 'zzab');
  t2 := pg_temp.do_as(null, format('select public.log_founding_field(%L, ''consent_contact'', ''zzab'')', v_vis_t::text));
  select (select count(*)::text from founding_form_fields where visitor_id in (v_vis_a, v_vis_b, v_vis_c, v_vis_t)) || '|' || (select last_field from founding_form_fields where visitor_id = v_vis_a) || '|' || t2 into t
    from (select 1) x;
  r := r || pg_temp.chk('R4a', 'a field name is kept per visitor (the last one wins); a name that is not on the form, and a bad visitor id, are ignored; a signed-out call works', t, '3|police_clearance|done');
  j := pg_temp.adm(v_vo, 'public.admin_founding_abandons(null, null, ''zzab'')')::jsonb;
  select string_agg((e.value ->> 'field') || ':' || (e.value ->> 'n'), ' ' order by e.ordinality) into t from jsonb_array_elements(j -> 'by_field') with ordinality e(value, ordinality);
  r := r || pg_temp.chk('R4b', 'tag zzab: 3 started, 1 joined, 2 left; by last field: one left at the police clearance, one had no field recorded',
    (j ->> 'started') || '|' || (j ->> 'joined') || '|' || (j ->> 'abandoned') || '|' || t, '3|1|2|(not recorded):1 police_clearance:1');
  r := r || pg_temp.chk('R4c', 'a test tag is never counted; the by-tag list repeats the same two rows; the answer holds no visitor id',
    (select count(*)::text from jsonb_array_elements(pg_temp.adm(v_vo, 'public.admin_founding_abandons(null, null, ''test-ab'')')::jsonb -> 'by_field')) || '|' || jsonb_array_length(j -> 'by_src')::text || '|'
    || (not (j::text ~* '[0-9a-f]{8}-[0-9a-f]{4}-')::boolean)::text, '0|2|true');
  insert into founding_form_fields (visitor_id, last_field, updated_at) values (gen_random_uuid(), 'email', now() - interval '100 days');
  j := public.founding_daily_job();
  select (j ? 'fields_deleted')::text || '|' || ((j ->> 'fields_deleted')::int >= 1)::text into t;
  r := r || pg_temp.chk('R4d', 'the daily job also deletes last-field rows older than 90 days, and still reports the lapse and delete counts', t || '|' || (j ? 'lapsed')::text || '|' || (j ? 'entries_deleted')::text, 'true|true|true|true');

  -- ---- W: the wave number (these change the highest wave, so they come last) ---------------------------------------------------------------------
  t := pg_temp.adm(v_vo, 'public.admin_add_founding_entry(''Warm One'', ''Warm'', ''082 555 0201'', ''fw.warm1@example.invalid'', ''released'')->>''ok''');
  t2 := pg_temp.adm(v_vo, 'public.admin_add_founding_entry(''Warm Two'', ''Warm'', ''082 555 0202'', ''fw.warm2@example.invalid'', ''joined'')->>''ok''');
  select coalesce(wave::text, 'null') || '/' || status into t from founding_tutors_list where email_key = 'fw.warm1@example.invalid';
  select coalesce(wave::text, 'null') || '/' || status into t2 from founding_tutors_list where email_key = 'fw.warm2@example.invalid';
  r := r || pg_temp.chk('W1', 'a warm tutor added as Released is wave 1; one added as On the list has no wave', t || ' ' || t2, '1/released null/joined');
  select id into v_a from founding_tutors_list where email_key = 'fw.q1@example.invalid';
  select id into v_b from founding_tutors_list where email_key = 'fw.q2@example.invalid';
  select id into v_c from founding_tutors_list where email_key = 'fw.q3@example.invalid';
  t := pg_temp.adm(v_vo, format('(public.admin_release_founding(array[%L, %L]::uuid[])->>''released'') || ''/'' || (public.admin_release_founding(array[%L]::uuid[])->>''released'')', v_a, v_b, v_a));
  select string_agg(l.code_name || '=' || coalesce(l.wave::text, 'null'), ' ' order by l.code_name) into t2 from founding_tutors_list l where l.id in (v_a, v_b);
  r := r || pg_temp.chk('W2', 'a release with no wave number starts the next wave after the highest (71, so 72); one who was already released is skipped', t || '|' || t2, '2/0|Qz1=72 Qz2=72');
  t := pg_temp.adm(v_vo, format('public.admin_release_founding(array[%L]::uuid[])->>''wave''', v_c));
  select l.wave::text into t2 from founding_tutors_list l where l.id = v_c;
  r := r || pg_temp.chk('W3', 'a second release within 3 days joins the same wave (one round of releasing)', t || '|' || coalesce(t2, 'null'), '72|72');
  r := r || pg_temp.chk('W4', 'a wave number is 1 to 99, and nothing chosen is refused as before',
    pg_temp.pfx(pg_temp.adm(v_vo, format('public.admin_release_founding(array[%L]::uuid[], 0)', v_p3)), 'ERR: A wave number is from 1 to 99') || '/'
    || pg_temp.pfx(pg_temp.adm(v_vo, format('public.admin_release_founding(array[%L]::uuid[], 100)', v_p3)), 'ERR: A wave number is from 1 to 99') || '/'
    || pg_temp.pfx(pg_temp.adm(v_vo, 'public.admin_release_founding(array[]::uuid[])'), 'ERR: Choose between 1 and 500'),
    'ERR: A wave number is from 1 to 99/ERR: A wave number is from 1 to 99/ERR: Choose between 1 and 500');
  t := pg_temp.adm(v_vo, format('public.admin_set_founding_wave(array[%L, %L, %L]::uuid[], 73)', v_a, v_b, v_p1));
  select string_agg(l.code_name || '=' || coalesce(l.wave::text, 'null'), ' ' order by l.code_name) into t2 from founding_tutors_list l where l.id in (v_a, v_b);
  r := r || pg_temp.chk('W5', 'correcting the wave number of released people (3 asked, all released): changed 3, none skipped', (t::jsonb ->> 'changed') || '/' || (t::jsonb ->> 'skipped') || '|' || t2, '3/0|Qz1=73 Qz2=73');
  t := pg_temp.adm(v_vo, format('public.admin_set_founding_status(%L, ''joined'')->>''status''', v_a));
  select coalesce(l.wave::text, 'null') into t2 from founding_tutors_list l where l.id = v_a;
  r := r || pg_temp.chk('W6', 'a correction back to On the list clears the wave number', t || '|' || t2, 'joined|null');
  t := pg_temp.adm(v_vo, format('public.admin_set_founding_status(%L, ''verified'')->>''status''', v_b));
  select coalesce(l.wave::text, 'null') into t2 from founding_tutors_list l where l.id = v_b;
  r := r || pg_temp.chk('W7', 'a correction to verified keeps it', t || '|' || t2, 'verified|73');
  t := pg_temp.adm(v_vo, format('public.admin_mark_founding_messaged(%L, ''released'')->>''ok''', v_p3));
  select (last_contacted_at is not null and last_contacted_at > now() - interval '1 minute')::text into t2 from founding_tutors_list where id = v_p3;
  r := r || pg_temp.chk('W8', 'marking a message as sent also stamps "last contacted"', t || '|' || t2, 'true|true');
  update founding_tutors_list set last_contacted_at = null where id = v_p2;
  t := pg_temp.adm(v_vo, format('public.admin_mark_founding_contacted(%L)->>''ok''', v_p2));
  select (last_contacted_at is not null)::text into t2 from founding_tutors_list where id = v_p2;
  r := r || pg_temp.chk('W9', 'a plain "contacted" mark works; an unknown entry is refused', t || '|' || t2 || '|' || pg_temp.pfx(pg_temp.adm(v_vo, format('public.admin_mark_founding_contacted(%L)', gen_random_uuid())), 'ERR: No such entry'), 'true|true|ERR: No such entry');

  exception when others then
    r := r || 'UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%'), count(*) filter (where l like '% ok'), count(*) into nfail, nok, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  select coalesce(string_agg(l, E'\n') filter (where l like '%FAIL%'), '(none)') into t from unnest(string_to_array(r, E'\n')) l;
  select string_agg(split_part(l, ' ', 1), ' ') filter (where l like '% ok') into t2 from unnest(string_to_array(r, E'\n')) l;
  raise exception E'FOUNDING WAVES TEST (rolled back): % OK, % FAIL, % lines in all\nFAIL LINES: %\nOK: %', nok, nfail, nlines, t, t2;
end $$;
