-- Rolled-back test of the hold protections (migration 20261021120000) and the hand-over export (migration 20261021130000), on top of the
-- document access log and the safety hold (20261021100000, 103000, 110000).
-- Run it with scripts/run-rolled-back-test.mjs in ONE statement, in this order (see README.md):
--   supabase/tests/helpers/rights_before.sql, 20261021100000_document_access_log.sql, 20261021103000_documents_readable_only_after_logging.sql,
--   20261021110000_revoke_unused_api_rights.sql, 20261021120000_hold_protections.sql, 20261021130000_hand_over_export.sql, then this file LAST.
--   (The earlier suite, supabase/tests/document_access_log.sql, can be put just before this file to run as well; this file then adds its report
--   to its own under one headline. It was not part of the 21 Oct run.)
-- If the earlier suite ran first, this file reads its report from the setting test.report. Every refusal is matched on its
-- own message or on the database's "permission denied", so a refusal for the wrong reason shows as FAIL. Each part runs in its own block: a
-- mistake in one part is reported as an ERROR line and the other parts still run. Lines are short on purpose: the Supabase tool cuts a long
-- answer in the middle.
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  v_adm uuid := gen_random_uuid();
  v_off uuid := gen_random_uuid();   -- an admin who is switched off
  v_t uuid := gen_random_uuid();     -- the tutor who gets the hold
  v_u uuid := gen_random_uuid();     -- a tutor who has no hold (until a hand-over places one)
  v_x uuid := gen_random_uuid();     -- a third tutor, for the retention job
  v_l uuid := gen_random_uuid();     -- a learner
  v_r1 uuid := gen_random_uuid(); v_r2 uuid := gen_random_uuid(); v_r3 uuid := gen_random_uuid(); v_r4 uuid := gen_random_uuid(); v_r5 uuid := gen_random_uuid();
  v_d1 uuid; v_d2 uuid; v_d3 uuid; v_seq bigint;
  v_ho jsonb; v_ho2 jsonb; v_ho3 jsonb; v_id uuid; v_id2 uuid;
  ho public.hand_over_events;
  arr text[]; want text[]; a text[]; a2 text[]; ks int[]; vals text[]; scopes text[]; wants text[]; i int;
  q text; n int; n2 int; n3 int; n4 int; n5 int; n6 int; n7 int; t text; t2 text; t3 text; bl boolean; bl2 boolean; nfail int; nlines int; rep text; old_report text; m text[];
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_adm, z, 'authenticated', 'authenticated', 'hp.a.' || v_adm || '@example.invalid', '{}'::jsonb, '{}'),
    (v_off, z, 'authenticated', 'authenticated', 'hp.o.' || v_off || '@example.invalid', '{}'::jsonb, '{}'),
    (v_t, z, 'authenticated', 'authenticated', 'hp.t.' || v_t || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tia'), '{}'),
    (v_u, z, 'authenticated', 'authenticated', 'hp.u.' || v_u || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Uma'), '{}'),
    (v_x, z, 'authenticated', 'authenticated', 'hp.x.' || v_x || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Xan'), '{}'),
    (v_l, z, 'authenticated', 'authenticated', 'hp.l.' || v_l || '@example.invalid', jsonb_build_object('first_name', 'Lee', 'date_of_birth', adult), '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number) values (v_adm, 'A', 'One', 'hp.a.' || v_adm || '@example.invalid', '');
  insert into admin_profiles (id, first_name, surname, email, phone_number, is_active) values (v_off, 'A', 'Off', 'hp.o.' || v_off || '@example.invalid', '', false);
  update profiles set date_of_birth = adult::date where id in (v_t, v_u, v_x);
  insert into storage.objects (bucket_id, name) values
    ('tutor-documents', v_t || '/id.pdf'), ('tutor-documents', v_t || '/police.pdf'), ('tutor-documents', v_t || '/diploma.pdf'), ('tutor-documents', v_t || '/extra.pdf'),
    ('tutor-documents', v_u || '/id.pdf'), ('tutor-documents', v_u || '/police.pdf'), ('tutor-documents', v_u || '/scan.pdf');
  insert into tutor_verification_documents (tutor_id, document_type, document_url) values
    (v_t, 'identity_doc', v_t || '/id.pdf'), (v_t, 'police_clearance', v_t || '/police.pdf'), (v_t, 'teaching_qualification', v_t || '/diploma.pdf'),
    (v_u, 'identity_doc', v_u || '/id.pdf'), (v_u, 'police_clearance', v_u || '/police.pdf'), (v_u, 'proof_of_address', v_u || '/address.pdf');
  update tutor_verification_documents set status = 'verified' where tutor_id = v_t and document_type = 'teaching_qualification';
  r := r || 'S0 setup: 2 admins (one off), 3 tutors, 1 learner, 7 stored files, 6 documents (one verified)' || E'\n';

  -- ============ (a) video rooms: the clean-up skips a held person's rooms ===============================================
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_seq := public.place_safety_hold(v_t, 'Reported for dangerous activity');
    reset role;
    insert into video_rooms (id, code, host_id, created_at, expires_at, ended_at) values
      (v_r1, 'HLDAAAA2', v_t, now() - interval '45 days', now() - interval '44 days', now() - interval '40 days'),   -- held host, old
      (v_r2, 'HLDBBBB3', v_u, now() - interval '45 days', now() - interval '44 days', null),                          -- held guest, old
      (v_r3, 'FRECCCC4', v_u, now() - interval '45 days', now() - interval '44 days', now() - interval '40 days'),    -- nobody held, old
      (v_r4, 'NEWDDDD5', v_t, now() - interval '1 day', now() + interval '1 day', null),                              -- held host, recent
      (v_r5, 'FREEEEE6', v_u, now() - interval '45 days', now() - interval '44 days', null);                          -- no members, old
    insert into video_room_members (room_id, profile_id, status) values
      (v_r1, v_u, 'left'), (v_r2, v_t, 'left'), (v_r2, v_u, 'admitted'), (v_r3, v_l, 'left'), (v_r3, v_u, 'left'), (v_r4, v_u, 'admitted');
    n := public.purge_old_video_rooms();
    select count(*) filter (where id = v_r1), count(*) filter (where id = v_r2), count(*) filter (where id in (v_r3, v_r5)), count(*) filter (where id = v_r4)
      into n2, n3, n4, n5 from video_rooms where id in (v_r1, v_r2, v_r3, v_r4, v_r5);
    r := r || format('V1 %s on hold: the clean-up deleted %s rooms (2 of them mine); held host''s room kept=%s, room a held guest joined kept=%s, recent room kept=%s, the two others gone=%s',
      case when n >= 2 and n2 = 1 and n3 = 1 and n4 = 0 and n5 = 1 then 'ok' else 'FAIL' end, n, n2 = 1, n3 = 1, n5 = 1, n4 = 0) || E'\n';
    select count(*) into n2 from video_room_members where room_id in (v_r1, v_r2, v_r4);
    select count(*) into n3 from video_room_members where room_id = v_r3;
    r := r || format('V2 %s members: the kept rooms keep their %s member lines (want 4); the deleted room''s lines went with it (%s, want 0)', case when n2 = 4 and n3 = 0 then 'ok' else 'FAIL' end, n2, n3) || E'\n';

    perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_seq := public.release_safety_hold(v_t, 'Investigation closed, no case');
    reset role;
    n := public.purge_old_video_rooms();
    select count(*) filter (where id in (v_r1, v_r2)), count(*) filter (where id = v_r4) into n2, n3 from video_rooms where id in (v_r1, v_r2, v_r4);
    r := r || format('V3 %s after the release: the next clean-up deleted %s rooms (2 of them mine); the two old rooms are gone=%s; the recent room stays=%s', case when n >= 2 and n2 = 0 and n3 = 1 then 'ok' else 'FAIL' end, n, n2 = 0, n3 = 1) || E'\n';

    select count(*) filter (where has_function_privilege('anon', p.oid, 'execute')), count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute')),
           count(*) filter (where has_function_privilege('service_role', p.oid, 'execute')), count(*) filter (where p.prosecdef and p.proconfig::text like '%search_path=public%')
      into n, n2, n3, n4 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'purge_old_video_rooms';
    bl := true;
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
      execute 'select count(*) = 1 and bool_and(command = ''select public.purge_old_video_rooms();'' and schedule = ''17 3 * * *'') from cron.job where jobname = ''purge-old-video-rooms''' into bl;
    end if;
    r := r || format('V4 %s the clean-up function: still one function; signed-out can run it=%s (want 0), signed-in=%s (want 0), server key=%s (want 1); definer with pinned path=%s; its daily job is unchanged=%s',
      case when n = 0 and n2 = 0 and n3 = 1 and n4 = 1 and bl then 'ok' else 'FAIL' end, n, n2, n3, n4, bl) || E'\n';
    select (md5(pg_get_functiondef('public.purge_old_video_rooms()'::regprocedure)) <> current_setting('test.purge_md5_before')) into bl;
    r := r || format('V5 %s the clean-up text really changed from the live text: %s', case when bl then 'ok' else 'FAIL' end, bl) || E'\n';
  exception when others then
    reset role;
    r := r || 'V ERROR ' || left(sqlerrm, 150) || E'\n';
  end;

  -- ============ (b) documents: a held tutor cannot remove or replace their own =========================================
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_seq := public.place_safety_hold(v_t, 'Reported again, second case');
    reset role;
    select id into v_d1 from tutor_verification_documents where tutor_id = v_t and document_type = 'police_clearance';
    select id into v_d2 from tutor_verification_documents where tutor_id = v_t and document_type = 'teaching_qualification';
    perform set_config('storage.allow_delete_query', 'true', true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
    set local role authenticated;
    n := 0;
    arr := array[
      format('delete from public.tutor_verification_documents where id = %L', v_d1),
      format('update public.tutor_verification_documents set document_url = %L where id = %L', v_t || '/new.pdf', v_d1),
      format('update public.tutor_verification_documents set document_type = %L where id = %L', 'proof_of_address', v_d1),
      format('update public.tutor_verification_documents set issued_on = %L where id = %L', current_date::text, v_d1)];
    for i in 1..array_length(arr, 1) loop
      begin
        execute arr[i];
        r := r || format('D1 FAIL change %s was accepted', i) || E'\n';
      exception when others then
        if sqlerrm = 'This document can''t be changed right now. If you need help, email support@tutorlage.com.' then n := n + 1; else r := r || format('D1 FAIL change %s got: %s', i, left(sqlerrm, 45)) || E'\n'; end if;
      end;
    end loop;
    update tutor_verification_documents set document_url = document_url where id = v_d1;
    get diagnostics n2 = row_count;
    insert into tutor_verification_documents (tutor_id, document_type, document_url) values (v_t, 'proof_of_address', v_t || '/address.pdf');
    select count(*) into n3 from tutor_verification_documents where tutor_id = v_t;
    delete from tutor_verification_documents where id = v_d2;
    get diagnostics n4 = row_count;
    r := r || format('D1 %s held tutor, own documents: delete, replace the file, change the type, change the date all refused with the plain message %s of 4; a save that changes nothing=%s row; a new document can still be added (now %s, want 4); the verified one: %s rows deleted (want 0)',
      case when n = 4 and n2 = 1 and n3 = 4 and n4 = 0 then 'ok' else 'FAIL' end, n, n2, n3, n4) || E'\n';
    delete from storage.objects where bucket_id = 'tutor-documents' and name in (v_t || '/extra.pdf', v_t || '/id.pdf', v_t || '/police.pdf');
    get diagnostics n = row_count;
    reset role;
    select count(*) into n2 from tutor_verification_documents where tutor_id = v_t;
    select count(*) into n3 from storage.objects where bucket_id = 'tutor-documents' and name like v_t || '/%';
    r := r || format('D2 %s held tutor, stored files: deleting 3 of their own files removed %s (want 0); files still stored=%s (want 4); documents still on file=%s (want 4)',
      case when n = 0 and n3 = 4 and n2 = 4 then 'ok' else 'FAIL' end, n, n3, n2) || E'\n';

    -- a tutor with no hold works as before
    select id into v_d3 from tutor_verification_documents where tutor_id = v_u and document_type = 'police_clearance';
    perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update tutor_verification_documents set document_url = v_u || '/police2.pdf' where id = v_d3;
    get diagnostics n = row_count;
    select status::text into t from tutor_verification_documents where id = v_d3;
    delete from tutor_verification_documents where tutor_id = v_u and document_type = 'proof_of_address';
    get diagnostics n2 = row_count;
    delete from storage.objects where bucket_id = 'tutor-documents' and name = v_u || '/scan.pdf';
    get diagnostics n3 = row_count;
    delete from storage.objects where bucket_id = 'tutor-documents' and name = v_t || '/extra.pdf';
    get diagnostics n4 = row_count;
    reset role;
    r := r || format('D3 %s tutor with no hold: replaced the file=%s row (status back to %s), removed an unverified document=%s row, deleted their own stray file=%s row; still cannot touch another tutor''s file=%s rows',
      case when n = 1 and t = 'pending' and n2 = 1 and n3 = 1 and n4 = 0 then 'ok' else 'FAIL' end, n, t, n2, n3, n4) || E'\n';

    -- an admin is unaffected by the hold
    perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update tutor_verification_documents set document_url = v_t || '/address2.pdf' where tutor_id = v_t and document_type = 'proof_of_address';
    get diagnostics n = row_count;
    delete from tutor_verification_documents where id = v_d1;
    get diagnostics n2 = row_count;
    reset role;
    r := r || format('D4 %s admin on the held tutor''s documents: replaced the file of one=%s row, deleted one=%s row (as before the change)', case when n = 1 and n2 = 1 then 'ok' else 'FAIL' end, n, n2) || E'\n';

    -- the hold is reversible: after the release the tutor can remove their own unverified document and file again
    perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_seq := public.release_safety_hold(v_t, 'Second case closed');
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
    set local role authenticated;
    delete from tutor_verification_documents where tutor_id = v_t and document_type = 'proof_of_address';
    get diagnostics n = row_count;
    delete from storage.objects where bucket_id = 'tutor-documents' and name = v_t || '/extra.pdf';
    get diagnostics n2 = row_count;
    delete from storage.objects where bucket_id = 'tutor-documents' and name = v_t || '/diploma.pdf';
    get diagnostics n3 = row_count;
    reset role;
    r := r || format('D5 %s after the release: the tutor removed an unverified document=%s row and their stray file=%s row; the file a verified document uses is still refused=%s rows (want 0, the rule from before)',
      case when n = 1 and n2 = 1 and n3 = 0 then 'ok' else 'FAIL' end, n, n2, n3) || E'\n';

    perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_seq := public.place_safety_hold(v_t, 'Held again for the remaining tests');
    reset role;

    -- what the check function says, and who can call what
    perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
    set local role authenticated;
    bl := public.my_documents_are_kept();
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
    set local role authenticated;
    bl2 := public.my_documents_are_kept();
    reset role;
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    begin perform public.my_documents_are_kept(); t := 'FAIL'; exception when others then t := case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL ' || left(sqlerrm, 30) end; end;
    reset role;
    r := r || format('D6 %s my_documents_are_kept: held tutor sees %s (want true), tutor with no hold %s (want false), signed-out refused=%s; it answers only about the caller (no argument)',
      case when bl and not bl2 and t = 'ok' then 'ok' else 'FAIL' end, bl, bl2, t) || E'\n';
    select count(*) filter (where tgname = 'guard_held_documents'), count(*) filter (where tgname = 'guard_verification_documents') into n, n2
      from pg_trigger where tgrelid = 'public.tutor_verification_documents'::regclass and not tgisinternal;
    select md5(pg_get_functiondef('public.guard_verification_documents()'::regprocedure)) = current_setting('test.guard_md5_before') into bl;
    select has_function_privilege('authenticated', 'public.guard_held_documents()', 'execute') or has_function_privilege('anon', 'public.guard_held_documents()', 'execute') into bl2;
    select count(*) filter (where qual like '%my_documents_are_kept%' and qual like '%verified%' and qual like '%tutor-documents%')
      into n3 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Tutors delete own documents';
    r := r || format('D7 %s built: new trigger=%s and the existing guard trigger=%s both on the table; the existing guard function is byte-identical to before=%s; new trigger function open to API roles=%s (want false); storage delete policy has the hold test and the verified-file test=%s (want 1)',
      case when n = 1 and n2 = 1 and bl and not bl2 and n3 = 1 then 'ok' else 'FAIL' end, n, n2, bl, bl2, n3) || E'\n';
  exception when others then
    reset role;
    r := r || 'D ERROR ' || left(sqlerrm, 150) || E'\n';
  end;

  -- ============ (c) the list of holds ===================================================================================
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_seq := public.place_safety_hold(v_l, 'A learner reported by a parent');
    select count(*) filter (where hold_profile_id in (v_t, v_l, v_u)), count(*) filter (where hold_profile_id = v_t and hold_is_tutor and hold_reason = 'Held again for the remaining tests' and hold_email = 'hp.t.' || v_t || '@example.invalid'
        and hold_placed_by = 'A One <hp.a.' || v_adm || '@example.invalid>' and hold_placed_at = now()),
      count(*) filter (where hold_profile_id = v_l and not hold_is_tutor and hold_reason = 'A learner reported by a parent'), count(*) filter (where hold_profile_id = v_u)
      into n, n2, n3, n4 from public.list_safety_holds();
    reset role;
    r := r || format('C1 %s list_safety_holds: %s people on hold (want 2); the tutor row has reason, who, when, email and is a tutor=%s; the learner row says not a tutor=%s; the tutor with no hold is absent=%s',
      case when n = 2 and n2 = 1 and n3 = 1 and n4 = 0 then 'ok' else 'FAIL' end, n, n2 = 1, n3 = 1, n4 = 0) || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_seq := public.release_safety_hold(v_l, 'Parent withdrew the report');
    select count(*) filter (where hold_profile_id in (v_t, v_l, v_u)), count(*) filter (where hold_profile_id = v_t) into n, n2 from public.list_safety_holds();
    reset role;
    r := r || format('C2 %s after the learner''s release the list shows %s person (want 1), the tutor still on it=%s', case when n = 1 and n2 = 1 then 'ok' else 'FAIL' end, n, n2 = 1) || E'\n';
    n := 0;
    foreach q in array array[v_l::text, v_t::text, v_off::text] loop
      perform set_config('request.jwt.claims', json_build_object('sub', q, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin perform * from public.list_safety_holds(); exception when others then if sqlerrm = 'Admins only' then n := n + 1; end if; end;
      reset role;
    end loop;
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    begin perform * from public.list_safety_holds(); t := 'FAIL'; exception when others then t := case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL ' || left(sqlerrm, 30) end; end;
    reset role;
    r := r || format('C3 %s the list: learner, tutor and switched-off admin refused %s of 3; signed-out refused=%s', case when n = 3 and t = 'ok' then 'ok' else 'FAIL' end, n, t) || E'\n';
  exception when others then
    reset role;
    r := r || 'C ERROR ' || left(sqlerrm, 150) || E'\n';
  end;

  -- ============ the hand-over export ====================================================================================
  begin
    a := array[v_u::text, 'warrant', 'CAS 123/10/2026', 'Sgt P Dlamini', 'Detective Sergeant', 'SAPS Sandton', '011 555 0100', 'p.dlamini@saps.example.invalid',
               'Called the station back on its public number', 'Complaint received by the safeguarding lead', 'J Mokoena, deputy safeguarding lead', 'Not told at this time'];
    ks := array[4, 3, 8, 10, 11, 12, 9, 5, 6, 7, 2, 0, 0, 0, 2, 2, 2, 2, 2, 1];
    vals := array['  ', '', 'not-an-email', 'x', '', ' ', '', '', '', '', 'police_said', '', '', '', 'request_with_consent', 'request_with_consent', 's54_report', 'regulator_notice', 'request_with_consent', v_l::text];
    scopes := array['{profile}', '{profile}', '{profile}', '{profile}', '{profile}', '{profile}', '{profile}', '{profile}', '{profile}', '{profile}', '{profile}', '{}', '{profile,x}', '{profile,profile}',
      '{profile,identity,hold_events,other_documents}', '{profile,identity,hold_events,access_log}', '{profile,hold_events}', '{profile}', '{profile,identity}', '{profile}'];
    wants := array['Fill in: requester name', 'Fill in: reference', 'Fill in: requester email', 'Fill in: reason', 'Fill in: who approved it',
      'Fill in: whether the tutor was told, or why not', 'Fill in: how the requester was verified', 'Fill in: requester role', 'Fill in: requester organisation (station or court)',
      'Fill in: requester phone', 'Say what kind of authority this is', 'Pick what the paper names', 'Unknown part of the bundle: x', 'Name each part once',
      'This kind of authority may not include: other_documents', 'This kind of authority may not include: access_log', 'This kind of authority always includes: identity',
      'This kind of authority always includes: access_log', 'This kind of authority always includes: hold_events', 'No such tutor'];
    arr := array[]::text[];
    for i in 1..array_length(ks, 1) loop
      a2 := a;
      if ks[i] > 0 then a2[ks[i]] := vals[i]; end if;
      arr[i] := format('select public.record_hand_over(%L::uuid, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L::text[])',
        a2[1], a2[2], a2[3], a2[4], a2[5], a2[6], a2[7], a2[8], a2[9], a2[10], a2[11], a2[12], scopes[i]);
    end loop;
    perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
    set local role authenticated;
    n := 0;
    for i in 1..array_length(ks, 1) loop
      begin
        execute arr[i];
        r := r || format('H1 FAIL bad request %s was accepted', i) || E'\n';
      exception when others then
        if sqlerrm = wants[i] then n := n + 1; else r := r || format('H1 FAIL request %s got: %s', i, left(sqlerrm, 50)) || E'\n'; end if;
      end;
    end loop;
    reset role;
    select count(*) into n2 from public.hand_over_events;
    bl := public.profile_is_on_safety_hold(v_u);
    r := r || format('H1 %s 20 bad requests each refused for their own reason: %s of 20 (blank name, reference, email, reason, approver, told, verified, role, organisation, phone; unknown authority; empty, unknown and repeated parts; the rules per authority; not a tutor); lines written %s (want 0); no hold slipped onto the tutor=%s',
      case when n = 20 and n2 = 0 and not bl then 'ok' else 'FAIL' end, n, n2, not bl) || E'\n';

    -- a written request with the tutor's consent, on the tutor who is already on hold
    perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_ho := public.record_hand_over(v_t, 'request_with_consent', '  CAS 555/10/2026  ', ' Sgt P Dlamini ', 'Detective Sergeant', 'SAPS Sandton', '011 555 0100', 'p.dlamini@saps.example.invalid',
      'Called the station back on its public number', 'Complaint received by the safeguarding lead', 'J Mokoena, deputy safeguarding lead', 'Not told at this time', array['profile', 'identity', 'hold_events']);
    reset role;
    select * into ho from public.hand_over_events where id = (v_ho ->> 'id')::uuid;
    r := r || format('H2 %s consent request on the held tutor: one prepared line; who=%s, whose=%s, reference trimmed=%s, requester trimmed=%s, kind=%s, parts=%s, time is the database clock=%s; only the ID copy is listed (%s documents, type %s); no reviewer notes in the list=%s; no new hold=%s',
      case when ho.event = 'prepared' and ho.admin_id = v_adm and ho.subject_id = v_t and ho.reference = 'CAS 555/10/2026' and ho.requester_name = 'Sgt P Dlamini' and ho.authority = 'request_with_consent'
        and ho.scope = array['profile', 'identity', 'hold_events'] and ho.created_at = now() and ho.admin_label = 'A One <hp.a.' || v_adm || '@example.invalid>'
        and jsonb_array_length(ho.contents -> 'documents') = 1 and ho.contents -> 'documents' -> 0 ->> 'type' = 'identity_doc' and not (ho.contents -> 'documents' -> 0 ? 'admin_notes')
        and (v_ho ->> 'hold_placed_by_this_hand_over') = 'false' and ho.contents ->> 'hold_lines_at_start' is not null then 'ok' else 'FAIL' end,
      ho.admin_id = v_adm, ho.subject_id = v_t, ho.reference = 'CAS 555/10/2026', ho.requester_name = 'Sgt P Dlamini', ho.authority, ho.scope, ho.created_at = now(),
      jsonb_array_length(ho.contents -> 'documents'), ho.contents -> 'documents' -> 0 ->> 'type', not (ho.contents -> 'documents' -> 0 ? 'admin_notes'),
      (v_ho ->> 'hold_placed_by_this_hand_over') = 'false') || E'\n';
    v_id := ho.id;

    -- our own s 54 report on a tutor with no hold: every part, and a hold is placed
    insert into public.document_access_log (admin_id, subject_id, bucket, document_path, action) values (v_adm, v_u, 'tutor-documents', v_u || '/id.pdf', 'opened');
    perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_ho2 := public.record_hand_over(v_u, 's54_report', 'Tutorlage s 54 report 2026-014', 'Sgt P Dlamini', 'Detective Sergeant', 'SAPS Sandton', '011 555 0100', 'p.dlamini@saps.example.invalid',
      'Called the station back on its public number', 'Suspected offence against a child, reported by a parent', 'J Mokoena, deputy safeguarding lead', 'Not told at this time',
      array['profile', 'identity', 'other_documents', 'access_log', 'hold_events']);
    reset role;
    select * into ho from public.hand_over_events where id = (v_ho2 ->> 'id')::uuid;
    select count(*), (select e.reason from public.safety_hold_events e where e.profile_id = v_u order by e.seq desc limit 1), public.profile_is_on_safety_hold(v_u)
      into n, t, bl from public.safety_hold_events e where e.profile_id = v_u;
    r := r || format('H3 %s our s 54 report on a tutor with no hold: %s documents listed (want 2: ID and police clearance), access-log lines counted %s (want 1); a hold was placed=%s with reason "%s"; their data is now kept=%s',
      case when jsonb_array_length(ho.contents -> 'documents') = 2 and (ho.contents ->> 'access_log_lines_at_start') = '1' and (v_ho2 ->> 'hold_placed_by_this_hand_over') = 'true' and n = 1
        and t = 'Hand-over prepared (Tutorlage s 54 report 2026-014): Suspected offence against a child, reported by a parent' and bl then 'ok' else 'FAIL' end,
      jsonb_array_length(ho.contents -> 'documents'), ho.contents ->> 'access_log_lines_at_start', (v_ho2 ->> 'hold_placed_by_this_hand_over') = 'true', left(t, 40), bl) || E'\n';
    v_id2 := ho.id;

    -- a warrant that names only the access log, and a Regulator notice
    perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
    set local role authenticated;
    v_ho3 := public.record_hand_over(v_u, 'warrant', 'Warrant 77/2026', 'Magistrate court clerk', 'Clerk', 'Johannesburg Magistrate''s Court', '011 555 0199', 'clerk@court.example.invalid',
      'Checked the warrant number with the court registry', 'Warrant names the access log only', 'J Mokoena, deputy safeguarding lead', 'Not told: the warrant forbids disclosure', array['access_log']);
    n := jsonb_array_length(v_ho3 -> 'documents');
    perform public.record_hand_over(v_u, 'regulator_notice', 'Information notice 12', 'Regulator officer', 'Inspector', 'Information Regulator', '010 023 5200', 'inspector@regulator.example.invalid',
      'Notice received by registered post', 'Notice asks for the access log', 'J Mokoena, deputy safeguarding lead', 'Not told at this time', array['access_log', 'hold_events']);
    reset role;
    select count(*) into n2 from public.hand_over_events where event = 'prepared';
    r := r || format('H4 %s a warrant naming only the access log lists %s documents (want 0); a Regulator notice with the access log and hold lines is accepted; prepared lines now %s (want 4)',
      case when n = 0 and n2 = 4 then 'ok' else 'FAIL' end, n, n2) || E'\n';

    -- who can do what
    n := 0; n2 := 0;
    foreach q in array array[v_l::text, v_t::text, v_off::text] loop
      perform set_config('request.jwt.claims', json_build_object('sub', q, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin perform public.record_hand_over(v_u, 'warrant', 'Ref 1', 'Name N', 'Role R', 'Org O', '0115550100', 'n@x.example.invalid', 'Verified', 'Reason', 'Approver', 'Not told', array['profile']);
      exception when others then if sqlerrm = 'Admins only' then n := n + 1; end if; end;
      begin perform public.record_hand_over_delivery(v_id, 'Email', 'station@saps.example.invalid'); exception when others then if sqlerrm = 'Admins only' then n := n + 1; end if; end;
      select count(*) into n3 from public.hand_over_events;
      n2 := n2 + n3;
      reset role;
    end loop;
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    n3 := 0;
    foreach q in array array[format('select public.record_hand_over(%L::uuid, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L::text[])', v_u, 'warrant', 'R', 'N', 'R', 'O', '0115550100', 'n@x.example.invalid', 'V', 'Reason', 'A', 'T', '{profile}'),
      format('select public.record_hand_over_delivery(%L, %L, %L)', v_id, 'Email', 'station@saps.example.invalid'), 'select count(*) from public.hand_over_events'] loop
      begin execute q; exception when others then if sqlerrm ilike 'permission denied%' then n3 := n3 + 1; end if; end;
    end loop;
    reset role;
    r := r || format('H5 %s not an admin: learner, tutor and switched-off admin refused record_hand_over and the delivery call %s of 6, and read %s lines (want 0); signed-out refused %s of 3', case when n = 6 and n2 = 0 and n3 = 3 then 'ok' else 'FAIL' end, n, n2, n3) || E'\n';

    -- the delivery line
    perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
    set local role authenticated;
    arr := array[format('select public.record_hand_over_delivery(%L, %L, %L)', v_id, ' ', 'station@saps.example.invalid'), format('select public.record_hand_over_delivery(%L, %L, %L)', v_id, 'Email', ''),
      format('select public.record_hand_over_delivery(%L, %L, %L)', gen_random_uuid(), 'Email', 'station@saps.example.invalid')];
    want := array['Fill in: how it was delivered', 'Fill in: the address it was delivered to', 'No such hand-over'];
    n := 0;
    for i in 1..3 loop
      begin execute arr[i]; r := r || format('H6 FAIL call %s was accepted', i) || E'\n';
      exception when others then if sqlerrm = want[i] then n := n + 1; else r := r || format('H6 FAIL call %s got: %s', i, left(sqlerrm, 40)) || E'\n'; end if; end;
    end loop;
    select public.record_hand_over_delivery(v_id, ' Email to the station ', ' station@saps.example.invalid ') into v_id2;
    begin perform public.record_hand_over_delivery(v_id2, 'Email', 'station@saps.example.invalid'); t := 'FAIL'; exception when others then t := sqlerrm; end;
    select * into ho from public.hand_over_events where id = v_id2;
    reset role;
    r := r || format('H6 %s delivery: 3 bad calls refused %s of 3 (blank method, blank address, unknown hand-over); the line has the hand-over=%s, whose=%s, method and address trimmed=%s, who=%s; a delivery against a delivery line refused ("%s")',
      case when n = 3 and ho.event = 'delivered' and ho.hand_over_id = v_id and ho.subject_id = v_t and ho.delivery_method = 'Email to the station' and ho.delivery_address = 'station@saps.example.invalid'
        and ho.admin_id = v_adm and t = 'No such hand-over' then 'ok' else 'FAIL' end, n, ho.hand_over_id = v_id, ho.subject_id = v_t, ho.delivery_method = 'Email to the station', ho.admin_id = v_adm, t) || E'\n';

    -- nothing can be changed or removed
    perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n3 from public.hand_over_events;
    n := 0;
    foreach q in array array[
      format('insert into public.hand_over_events (event, hand_over_id, subject_id, admin_id, delivery_method, delivery_address) values (%L, %L, %L, %L, %L, %L)', 'delivered', v_id, v_t, v_adm, 'x', 'y'),
      'update public.hand_over_events set reference = ''x''', 'delete from public.hand_over_events', 'truncate public.hand_over_events'] loop
      begin execute q; r := r || 'H7 FAIL accepted: ' || left(q, 30) || E'\n';
      exception when others then if sqlerrm ilike 'permission denied%' then n := n + 1; else r := r || 'H7 FAIL other error: ' || left(sqlerrm, 40) || E'\n'; end if; end;
    end loop;
    reset role;
    n2 := 0;
    foreach q in array array['update public.hand_over_events set reference = ''x''', 'delete from public.hand_over_events', 'truncate public.hand_over_events'] loop
      begin execute q; r := r || 'H7 FAIL owner accepted: ' || left(q, 30) || E'\n';
      exception when others then if sqlerrm = 'Hand-over lines can only be added to' then n2 := n2 + 1; else r := r || 'H7 FAIL owner other error: ' || left(sqlerrm, 40) || E'\n'; end if; end;
    end loop;
    select count(*) into n4 from public.hand_over_events;
    r := r || format('H7 %s hand-over lines: admin insert, update, delete, truncate refused %s of 4; owner update, delete, truncate stopped by the trigger %s of 3; lines still %s (want %s)',
      case when n = 4 and n2 = 3 and n4 = n3 then 'ok' else 'FAIL' end, n, n2, n4, n3) || E'\n';

    -- the 5-year clean-up skips a held person
    insert into public.hand_over_events (event, subject_id, admin_id, admin_label, authority, reference, requester_name, requester_role, requester_organisation, requester_phone, requester_email,
      verified_how, reason, approved_by, tutor_told, scope, contents, created_at) values
      ('prepared', v_x, v_adm, 'x', 'warrant', 'OLD-FREE', 'n', 'r', 'o', 'p', 'e@x.example.invalid', 'v', 'rs', 'ap', 'told', array['profile'], '{}'::jsonb, now() - interval '6 years'),
      ('prepared', v_t, v_adm, 'x', 'warrant', 'OLD-HELD', 'n', 'r', 'o', 'p', 'e@x.example.invalid', 'v', 'rs', 'ap', 'told', array['profile'], '{}'::jsonb, now() - interval '6 years'),
      ('prepared', v_x, v_adm, 'x', 'warrant', 'RECENT', 'n', 'r', 'o', 'p', 'e@x.example.invalid', 'v', 'rs', 'ap', 'told', array['profile'], '{}'::jsonb, now() - interval '2 years');
    n := public.purge_old_hand_over_events();
    select count(*) filter (where reference = 'OLD-FREE'), count(*) filter (where reference = 'OLD-HELD'), count(*) filter (where reference = 'RECENT'), count(*) into n2, n3, n4, n5 from public.hand_over_events;
    begin delete from public.hand_over_events where reference = 'RECENT'; t := 'FAIL'; exception when others then t := sqlerrm; end;
    bl := true;
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
      execute 'select count(*) = 1 and bool_and(command = ''select public.purge_old_hand_over_events();'') from cron.job where jobname = ''purge-hand-over-events''' into bl;
    end if;
    select s.setting_value #>> '{}' into t2 from system_settings s where s.setting_key = 'hand_over_retention_years';
    perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin perform public.purge_old_hand_over_events(); t3 := 'FAIL'; exception when others then t3 := case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL ' || left(sqlerrm, 30) end; end;
    reset role;
    r := r || format('H8 %s retention: the job deleted %s line (want 1); the 6-year-old line of a person with no hold gone=%s, of the person on hold kept=%s, the 2-year-old kept=%s; a delete outside the job refused ("%s"); scheduled daily=%s; setting=%s; an admin cannot run it=%s',
      case when n = 1 and n2 = 0 and n3 = 1 and n4 = 1 and t = 'Hand-over lines can only be added to' and bl and t2 = '5' and t3 = 'ok' then 'ok' else 'FAIL' end, n, n2 = 0, n3 = 1, n4 = 1, left(t, 20), bl, t2, t3) || E'\n';

    -- how the table and functions are built
    select count(*) filter (where has_table_privilege('anon', c.oid, 'select, insert, update, delete')), count(*) filter (where has_table_privilege('authenticated', c.oid, 'insert, update, delete, truncate')),
           count(*) filter (where has_table_privilege('authenticated', c.oid, 'select')), count(*) filter (where has_table_privilege('service_role', c.oid, 'select, insert, update, delete')), count(*) filter (where c.relrowsecurity)
      into n, n2, n3, n4, n5 from pg_class c where c.oid = 'public.hand_over_events'::regclass;
    select count(*) into n6 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('record_hand_over', 'record_hand_over_delivery', 'purge_old_hand_over_events', 'list_safety_holds', 'my_documents_are_kept')
      and p.prosecdef and p.proconfig::text like '%search_path=public%';
    select count(*) into n7 from pg_trigger where tgrelid = 'public.hand_over_events'::regclass and not tgisinternal;
    bl := has_function_privilege('authenticated', 'public.record_hand_over(uuid, text, text, text, text, text, text, text, text, text, text, text, text[])', 'execute')
      and has_function_privilege('authenticated', 'public.record_hand_over_delivery(uuid, text, text)', 'execute');
    bl2 := has_function_privilege('anon', 'public.record_hand_over(uuid, text, text, text, text, text, text, text, text, text, text, text, text[])', 'execute')
      or has_function_privilege('anon', 'public.record_hand_over_delivery(uuid, text, text)', 'execute')
      or has_function_privilege('anon', 'public.purge_old_hand_over_events()', 'execute') or has_function_privilege('authenticated', 'public.purge_old_hand_over_events()', 'execute');
    r := r || format('H9 %s built: table rights signed-out=%s (want 0), signed-in write=%s (want 0), signed-in read=%s (want 1), server key=%s (want 0), row security=%s; 5 functions definer with a pinned path=%s; triggers=%s (want 2); the two hand-over functions open to signed-in=%s; anything open to signed-out, or the clean-up to signed-in=%s (want false)',
      case when n = 0 and n2 = 0 and n3 = 1 and n4 = 0 and n5 = 1 and n6 = 5 and n7 = 2 and bl and not bl2 then 'ok' else 'FAIL' end, n, n2, n3, n4, n5 = 1, n6, n7, bl, bl2) || E'\n';
  exception when others then
    reset role;
    r := r || 'H ERROR ' || left(sqlerrm, 150) || E'\n';
  end;

  -- ============ nothing else moved: the rights checks of the earlier suite, repeated for the new objects =================
  begin
    if to_regprocedure('pg_temp.rights_count_extra()') is null then
      r := r || 'P0 info: the rights helper was not run before the migrations, so the rights comparison is skipped' || E'\n';
    else
      r := r || format('P1 %s with both new migrations: tables with an extra right (empty, references, trigger, maintain) for signed-out or signed-in = %s (want 0); trigger functions open to them = %s (want 0); select/insert/update/delete on every table unchanged=%s; execute rights on every other function unchanged=%s',
        case when pg_temp.rights_count_extra() = 0 and pg_temp.rights_count_trigger_exec() = 0 and pg_temp.rights_hash_dml() = current_setting('test.dml_before') and pg_temp.rights_hash_exec() = current_setting('test.exec_before') then 'ok' else 'FAIL' end,
        pg_temp.rights_count_extra(), pg_temp.rights_count_trigger_exec(), pg_temp.rights_hash_dml() = current_setting('test.dml_before'), pg_temp.rights_hash_exec() = current_setting('test.exec_before')) || E'\n';
    end if;
  exception when others then
    r := r || 'P ERROR ' || left(sqlerrm, 150) || E'\n';
  end;

  -- ============ the report: this suite's lines, then the earlier suite's, under one headline ===========================
  old_report := coalesce(current_setting('test.report', true), '');
  select count(*) filter (where l ~ 'FAIL' or l ~ 'ERROR'), count(*) into nfail, nlines from regexp_split_to_table(r, E'\n') as x(l) where l <> '';
  select string_agg(case when l ~ 'FAIL' or l ~ 'ERROR' then l else left(l, 90) end, E'\n' order by o) into rep
    from regexp_split_to_table(r, E'\n') with ordinality as x(l, o) where l <> '';
  m := regexp_match(old_report, '(\d+) FAIL line\(s\) in (\d+) lines');
  if m is null then
    -- the earlier document_access_log suite was not run before this one: the headline is this suite's alone
    rep := format(E'HOLDS + HAND-OVER TEST (rolled back): %s FAIL/ERROR line(s) in %s lines\n%s', nfail, nlines, rep);
  else
    rep := format(E'HOLDS + HAND-OVER TEST (rolled back): this suite %s FAIL/ERROR in %s lines; earlier document_access_log suite %s FAIL in %s lines (want 0)\n%s\n--- earlier suite, first 90 characters of each line ---\n%s',
      nfail, nlines, m[1], m[2], rep,
      (select string_agg(left(l, 90), E'\n' order by o) from regexp_split_to_table(old_report, E'\n') with ordinality as x(l, o) where l <> ''));
  end if;
  if coalesce(current_setting('test.runner', true), '') = 'on' then
    perform set_config('test.report', rep, true);
  else
    raise exception E'%', rep;
  end if;
end $$;
