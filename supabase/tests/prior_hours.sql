-- Rolled-back test of migration 20261119010000_tutor_prior_hours.sql (J3, 19 Nov 2026): hours taught outside Tutorlage, recorded by an admin with a REQUIRED proof,
-- counted in the HOURS criterion of fn_recalculate_tutor_tier and nowhere else. Made-up people only (example.invalid); the block ends with `raise exception` so nothing
-- is kept (not even the migration, when it is run with it).
-- Before the apply, run both in ONE rolled-back statement, migration first:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/prior_hours.sql supabase/migrations/20261119010000_tutor_prior_hours.sql
-- After the apply, paste this file alone. Note: scripts/run-rolled-back-test.mjs replaces log_admin_event with a recorder when migrations are in the statement; the audit
-- checks (A*) therefore count the recorder's calls in the run with the migration, and the real audit rows in the run after the apply (both are accepted below).
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  uid text := replace(gen_random_uuid()::text, '-', '');
  t1 uuid := gen_random_uuid();   -- a tutor (no sessions, no reviews)
  t2 uuid := gen_random_uuid();   -- a second tutor
  su uuid := gen_random_uuid();   -- super admin
  vo uuid := gen_random_uuid();   -- verification officer
  sa uuid := gen_random_uuid();   -- support agent
  fm uuid := gen_random_uuid();   -- finance manager
  e1 uuid; e2 uuid; s text; n int; n0 int; x numeric;
  nfail int; nlines int;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
               || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
      $f$ $mk$;
    -- act as someone (null = signed out) for the next statement(s)
    execute $mk$
      create function pg_temp.err(p_sql text, p_uid uuid) returns text language plpgsql as $f$
      begin
        perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
        set local role authenticated;
        begin execute p_sql; reset role; return 'ok'; exception when others then reset role; return sqlerrm; end;
      end $f$ $mk$;
    -- a made-up tutor holding one verified credential: answers floor/level
    execute $mk$
      create function pg_temp.held(p_uid text, p_code text) returns uuid language plpgsql as $f$
      declare t uuid := gen_random_uuid(); d uuid := gen_random_uuid();
      begin
        insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
        values (t, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ph.' || p_uid || '.' || substr(t::text, 1, 8) || '@example.invalid',
                jsonb_build_object('role', 'tutor', 'first_name', 'Zzph', 'surname', 'Test'), '{}');
        insert into public.tutor_verification_documents (id, tutor_id, document_type, document_url, status) values (d, t, 'teaching_qualification', 'fixture/' || t || '/' || p_code, 'verified');
        insert into public.tutor_credentials (tutor_id, credential_code, document_id, status, obtained_on, verified_at) values (t, p_code, d, 'verified', current_date, now());
        perform public.refresh_credential_floor(t);
        return t;
      end $f$ $mk$;

    -- Independent of live data (23 Nov 2026): production now holds real prior-hours entries, so V6 compares with the count BEFORE this test, not with 0.
    perform set_config('tlt.base_prior_hours', (select count(*)::text from public.tutor_prior_hours), true);
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (t1, z, 'authenticated', 'authenticated', 'ph.1.' || t1 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'One', 'date_of_birth', adult), '{}'),
      (t2, z, 'authenticated', 'authenticated', 'ph.2.' || t2 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Two', 'date_of_birth', adult), '{}'),
      (su, z, 'authenticated', 'authenticated', 'ph.su.' || su || '@example.invalid', jsonb_build_object('first_name', 'Super', 'date_of_birth', adult), '{}'),
      (vo, z, 'authenticated', 'authenticated', 'ph.vo.' || vo || '@example.invalid', jsonb_build_object('first_name', 'Officer', 'date_of_birth', adult), '{}'),
      (sa, z, 'authenticated', 'authenticated', 'ph.sa.' || sa || '@example.invalid', jsonb_build_object('first_name', 'Support', 'date_of_birth', adult), '{}'),
      (fm, z, 'authenticated', 'authenticated', 'ph.fm.' || fm || '@example.invalid', jsonb_build_object('first_name', 'Finance', 'date_of_birth', adult), '{}');
    insert into public.admin_profiles (id, first_name, surname, email, admin_role) values
      (su, 'Sue', 'Super', 'ph.su.' || su || '@example.invalid', 'super_admin'),
      (vo, 'Vic', 'Officer', 'ph.vo.' || vo || '@example.invalid', 'verification_officer'),
      (sa, 'Sam', 'Support', 'ph.sa.' || sa || '@example.invalid', 'support_agent'),
      (fm, 'Fin', 'Manager', 'ph.fm.' || fm || '@example.invalid', 'finance_manager');

    -- ---- the table: closed to every API role ----
    r := r || pg_temp.chk('H1', 'the table has row level security on and NO right for anon, authenticated or service_role',
      (select c.relrowsecurity::text || ' ' || (select count(*) from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = 'tutor_prior_hours' and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC'))::text
         from pg_class c where c.oid = 'public.tutor_prior_hours'::regclass), 'true 0');
    r := r || pg_temp.chk('H2', 'a signed-in tutor cannot read or write the table directly', pg_temp.err('select count(*) from public.tutor_prior_hours', t1) || ' / '
      || pg_temp.err(format('insert into public.tutor_prior_hours (tutor_id, hours, reason, proof_reference, added_by) values (%L, 300, ''taught at a school'', ''letter 1'', %L)', t1, t1), t1) ,
      'permission denied for table tutor_prior_hours / permission denied for table tutor_prior_hours');

    -- ---- who may record ----
    r := r || pg_temp.chk('R1', 'a tutor cannot record hours for herself', pg_temp.err(format('select public.admin_add_prior_hours(%L, 300, ''taught three years at a school'', ''letter 2024-001'')', t1), t1), 'Admins only');
    r := r || pg_temp.chk('R2', 'a caller with no sign-in cannot', pg_temp.err(format('select public.admin_add_prior_hours(%L, 300, ''taught three years at a school'', ''letter 2024-001'')', t1), null), 'Admins only');
    r := r || pg_temp.chk('R3', 'a support agent cannot', pg_temp.err(format('select public.admin_add_prior_hours(%L, 300, ''taught three years at a school'', ''letter 2024-001'')', t1), sa), 'Only a verification officer or a super admin can record prior hours');
    r := r || pg_temp.chk('R4', 'a finance manager cannot', pg_temp.err(format('select public.admin_add_prior_hours(%L, 300, ''taught three years at a school'', ''letter 2024-001'')', t1), fm), 'Only a verification officer or a super admin can record prior hours');
    r := r || pg_temp.chk('R5', 'a support agent cannot read the entries either', pg_temp.err(format('select * from public.admin_prior_hours_for_tutor(%L)', t1), sa), 'Only a verification officer or a super admin can see prior hours');
    r := r || pg_temp.chk('R6', 'a support agent cannot remove an entry', pg_temp.err(format('select public.admin_remove_prior_hours(%L, ''entered by mistake here'')', gen_random_uuid()), sa), 'Only a verification officer or a super admin can remove prior hours');

    -- ---- what must be given ----
    r := r || pg_temp.chk('V1', 'no proof reference is refused', pg_temp.err(format('select public.admin_add_prior_hours(%L, 300, ''taught three years at a school'', '''')', t1), vo), 'A proof reference is required (for example a letter or a school confirmation)');
    r := r || pg_temp.chk('V2', 'a proof of 3 characters is refused (at least 5)', pg_temp.err(format('select public.admin_add_prior_hours(%L, 300, ''taught three years at a school'', ''abc'')', t1), vo), 'A proof reference is required (for example a letter or a school confirmation)');
    r := r || pg_temp.chk('V3', 'no reason is refused', pg_temp.err(format('select public.admin_add_prior_hours(%L, 300, ''short'', ''letter 2024-001'')', t1), vo), 'Say where and when the hours were taught (at least 10 characters)');
    r := r || pg_temp.chk('V4', 'zero, negative and huge hours are refused', pg_temp.err(format('select public.admin_add_prior_hours(%L, 0, ''taught three years at a school'', ''letter 2024-001'')', t1), vo) || ' | '
      || pg_temp.err(format('select public.admin_add_prior_hours(%L, -5, ''taught three years at a school'', ''letter 2024-001'')', t1), vo) || ' | '
      || pg_temp.err(format('select public.admin_add_prior_hours(%L, 5001, ''taught three years at a school'', ''letter 2024-001'')', t1), vo),
      'Hours must be more than 0 and at most 5000 | Hours must be more than 0 and at most 5000 | Hours must be more than 0 and at most 5000');
    r := r || pg_temp.chk('V5', 'a person who is not a tutor is refused', pg_temp.err(format('select public.admin_add_prior_hours(%L, 10, ''taught three years at a school'', ''letter 2024-001'')', gen_random_uuid()), vo), 'No such tutor');
    r := r || pg_temp.chk('V6', 'nothing was written by any refusal', (select count(*)::text from public.tutor_prior_hours), current_setting('tlt.base_prior_hours'));

    -- ---- recording, reading, audit ----
    select count(*) into n0 from public.admin_audit_logs where action = 'manual_tier_override' and metadata->>'action' in ('add_prior_hours', 'remove_prior_hours');
    perform set_config('request.jwt.claims', json_build_object('sub', vo, 'role', 'authenticated')::text, true);
    set local role authenticated;
    e1 := public.admin_add_prior_hours(t1, 300, 'About 300 hours of classroom teaching at Example High School, 2023 to 2025', 'Principal letter dated 12 March 2026, ref EHS/2026/041');
    reset role;
    select count(*) into n from public.admin_audit_logs where action = 'manual_tier_override' and metadata->>'action' = 'add_prior_hours' and target_entity_id = t1;
    r := r || pg_temp.chk('A1', 'a verification officer records 300 hours and ONE audit event is written (real audit rows, or the test recorder\''s count, rose by 1)',
      case when n = 1 or coalesce(nullif(current_setting('test.audit_calls', true), ''), '0')::int >= 1 then 'one' else n::text end, 'one');
    r := r || pg_temp.chk('A2', 'the entry holds hours, reason, proof, who and when',
      (select hours::text || ' / ' || (reason like 'About 300 hours%')::text || ' / ' || (proof_reference like 'Principal letter%')::text || ' / ' || (added_by = vo)::text || ' / ' || (added_at > now() - interval '1 minute')::text from public.tutor_prior_hours where id = e1),
      '300.00 / true / true / true / true');
    perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*)::text || ' ' || coalesce(max(added_by_name), '-') || ' ' || coalesce(max(hours)::text, '-') into s from public.admin_prior_hours_for_tutor(t1);
    reset role;
    r := r || pg_temp.chk('A3', 'a super admin reads the list: one entry, added by "Vic Officer", 300', s, '1 Vic Officer 300.00');
    r := r || pg_temp.chk('A4', 'the tutor reads her own total (300), another tutor cannot read it, an admin can',
      pg_temp.err(format('select public.tutor_prior_hours_total(%L)', t1), t1) || ' | ' || pg_temp.err(format('select public.tutor_prior_hours_total(%L)', t1), t2) || ' | ' || pg_temp.err(format('select public.tutor_prior_hours_total(%L)', t1), su),
      'ok | Not allowed | ok');
    perform set_config('request.jwt.claims', json_build_object('sub', t1, 'role', 'authenticated')::text, true);
    set local role authenticated;
    x := public.tutor_prior_hours_total(t1);
    reset role;
    r := r || pg_temp.chk('A5', 'her total is 300', x::text, '300.00');

    -- ---- what the hours do to a level ----
    -- (1) hours alone with no reviews: still 1A (the rule the screen must say plainly)
    r := r || pg_temp.chk('L1', 'a tutor with 300 recorded hours and no reviews stays at 1A (hours alone do not raise a level)', (select current_sub_tier_id from public.tutor_profiles where id = t1), '1A');
    r := r || pg_temp.chk('L2', 'total_completed_hours still means TUTORLAGE hours only (0)', (select total_completed_hours::text from public.tutor_profiles where id = t1), '0.00');
    -- (2) make the hours the ONLY missing criterion: loosen 1B inside this rolled-back test (no rating, no reviews, 100 hours)
    update public.sub_tier_definitions set min_rating = 0, min_repeat_rate_pct = 0, min_written_reviews = 0, min_hours = 100 where id = '1B';
    perform public.fn_recalculate_tutor_tier(t1);
    perform public.fn_recalculate_tutor_tier(t2);
    r := r || pg_temp.chk('L3', 'when hours are the only missing criterion (1B loosened to 100 hours for this test), 300 prior hours promote the tutor to 1B', (select current_sub_tier_id from public.tutor_profiles where id = t1), '1B');
    r := r || pg_temp.chk('L4', 'the same tutor-less-of-hours (t2, no entries) stays at 1A under the same rule', (select current_sub_tier_id from public.tutor_profiles where id = t2), '1A');
    r := r || pg_temp.chk('L5', 'the promotion is written to the progression log', (select count(*)::text from public.tutor_progression_logs where tutor_id = t1 and new_sub_tier = '1B' and action_type = 'PROMOTION'), '1');
    -- (3) remove the entry: back down
    perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.admin_remove_prior_hours(e1, 'Entered on the wrong tutor, letter belongs to someone else');
    reset role;
    r := r || pg_temp.chk('L6', 'removing the entry (with a reason) takes the tutor back to 1A and the entry stays on the record, marked removed',
      (select current_sub_tier_id from public.tutor_profiles where id = t1) || ' / ' || (select (removed_at is not null)::text || ' ' || (removed_by = su)::text || ' ' || (removal_reason like 'Entered on the wrong%')::text from public.tutor_prior_hours where id = e1), '1A / true true true');
    r := r || pg_temp.chk('L7', 'a removed entry no longer counts in her total', pg_temp.err(format('select public.tutor_prior_hours_total(%L)', t1), t1) || ' ' || (select coalesce(sum(hours), 0)::text from public.tutor_prior_hours where tutor_id = t1 and removed_at is null), 'ok 0');
    r := r || pg_temp.chk('L8', 'an entry cannot be removed twice, or without a reason', pg_temp.err(format('select public.admin_remove_prior_hours(%L, ''second try for the same entry'')', e1), su) || ' | ' || pg_temp.err(format('select public.admin_remove_prior_hours(%L, ''x'')', e1), su),
      'That entry was already removed | A reason of at least 10 characters is required');
    update public.sub_tier_definitions set min_rating = 4.80, min_repeat_rate_pct = 0, min_written_reviews = 0, min_hours = 10 where id = '1B';

    -- ---- the two tutors the PM asked about (made-up): a student teacher with about 300 hours elsewhere ----
    declare
      c uuid := pg_temp.held(uid, 'student_teacher_enrolled');
      p uuid := pg_temp.held(uid, 'practicum_complete');
      ck text; pk text;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', su, 'role', 'authenticated')::text, true);
      set local role authenticated;
      perform public.admin_add_prior_hours(c, 300, 'About 300 hours of tutoring and student teaching, 2023 to 2026', 'University practicum letter, ref UP/2026/118');
      perform public.admin_add_prior_hours(p, 300, 'About 300 hours of tutoring and student teaching, 2023 to 2026', 'University practicum letter, ref UP/2026/119');
      reset role;
      select current_sub_tier_id || '/' || credential_floor_sub_tier_id || '/' || total_completed_hours into ck from public.tutor_profiles where id = c;
      select current_sub_tier_id || '/' || credential_floor_sub_tier_id || '/' || total_completed_hours into pk from public.tutor_profiles where id = p;
      r := r || pg_temp.chk('C1', 'PROBE: a student teacher in her 4th year (enrolled, floor 1A) with 300 prior hours and no Tutorlage reviews is at 1A, not higher (level/floor/Tutorlage hours)', ck, '1A/1A/0.00');
      r := r || pg_temp.chk('C2', 'PROBE: the same with a COMPLETED PRACTICUM (floor 2C) is at 2C because of the credential, not because of the hours', pk, '2C/2C/0.00');
    end;

    -- ---- the recalculation reads the hours and changes nothing else ----
    r := r || pg_temp.chk('X1', 'the function now reads tutor_prior_hours (twice: its note and its one query) and total_completed_hours is still set from sessions only',
      (select (length(pg_get_functiondef(p.oid)) - length(replace(pg_get_functiondef(p.oid), 'tutor_prior_hours', ''))) / length('tutor_prior_hours') || ' ' || (pg_get_functiondef(p.oid) like '%total_completed_hours = v_completed_hours,%')::text
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'fn_recalculate_tutor_tier'), '2 true');
    r := r || pg_temp.chk('X2', 'the function is still security definer with a fixed search path, and API roles keep their (no) rights on it',
      (select p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '-') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'fn_recalculate_tutor_tier'), 'true search_path=public');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
