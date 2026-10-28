-- Rolled-back test of the document access log and the safety hold (migrations 20261021100000 and 20261021103000, legal flag H4 and the
-- CEO's safety hold) and of the rights tidy (migration 20261021110000, review m2 and m4).
-- Run it with scripts/run-rolled-back-test.mjs in ONE statement, in this order (see README.md):
--   supabase/tests/helpers/rights_before.sql, 20261021100000_document_access_log.sql, 20261021103000_documents_readable_only_after_logging.sql,
--   20261021110000_revoke_unused_api_rights.sql, this file.
-- The helper notes the rights before the migrations; this file compares them after. Every refusal is matched on its own message or
-- on the database's "permission denied", so a refusal for the wrong reason shows as FAIL. Lines are short on purpose: the Supabase tool
-- cuts a long answer in the middle.
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  v_adm uuid := gen_random_uuid();
  v_adm2 uuid := gen_random_uuid();
  v_off uuid := gen_random_uuid();   -- an admin who is switched off
  v_t uuid := gen_random_uuid();     -- tutor with two documents
  v_t2 uuid := gen_random_uuid();    -- another tutor
  v_l uuid := gen_random_uuid();     -- learner with a school result
  v_id uuid; v_d uuid; v_seq bigint;
  row_ public.document_access_log;
  arr text[]; want text[]; i int;
  q text; n int; n2 int; n3 int; n4 int; n5 int; t text; t2 text; bl boolean; bl2 boolean; bl3 boolean; nfail int; rep text;
  dml_now text; exec_now text;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_adm, z, 'authenticated', 'authenticated', 'dl.a1.' || v_adm || '@example.invalid', '{}'::jsonb, '{}'),
    (v_adm2, z, 'authenticated', 'authenticated', 'dl.a2.' || v_adm2 || '@example.invalid', '{}'::jsonb, '{}'),
    (v_off, z, 'authenticated', 'authenticated', 'dl.a3.' || v_off || '@example.invalid', '{}'::jsonb, '{}'),
    (v_t, z, 'authenticated', 'authenticated', 'dl.t1.' || v_t || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tia'), '{}'),
    (v_t2, z, 'authenticated', 'authenticated', 'dl.t2.' || v_t2 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tob'), '{}'),
    (v_l, z, 'authenticated', 'authenticated', 'dl.l.' || v_l || '@example.invalid', jsonb_build_object('first_name', 'Lee', 'date_of_birth', adult), '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number) values
    (v_adm, 'A', 'One', 'dl.a1.' || v_adm || '@example.invalid', ''), (v_adm2, 'A', 'Two', 'dl.a2.' || v_adm2 || '@example.invalid', '');
  insert into admin_profiles (id, first_name, surname, email, phone_number, is_active)
    values (v_off, 'A', 'Off', 'dl.a3.' || v_off || '@example.invalid', '', false);
  update profiles set date_of_birth = adult::date where id in (v_t, v_t2);
  insert into storage.objects (bucket_id, name) values
    ('tutor-documents', v_t || '/id.pdf'), ('tutor-documents', v_t || '/police.pdf'), ('tutor-documents', v_t || '/other.pdf'),
    ('school-results', v_l || '/report.pdf'),
    ('tutor-documents', 'legacy/old.pdf'), ('tutor-documents', v_t2 || '/scan..final.pdf');
  insert into tutor_verification_documents (tutor_id, document_type, document_url) values
    (v_t, 'identity_doc', v_t || '/id.pdf'), (v_t, 'police_clearance', v_t || '/police.pdf');
  r := r || 'S0 setup: 3 admins (one off), 2 tutors, 1 learner, 6 stored files, 2 documents' || E'\n';

  -- ============ the rights before/after, taken now while the role is still the owner ====================================
  dml_now := pg_temp.rights_hash_dml();
  exec_now := pg_temp.rights_hash_exec();

  -- ============ the log: an active admin opens documents ================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_id := public.log_document_access('tutor-documents', v_t || '/police.pdf');
  select * into row_ from public.document_access_log where id = v_id;
  r := r || format('L1 %s police file: type=%s action=%s; name and email kept=%s; document row id kept=%s', case when row_.admin_id = v_adm and row_.subject_id = v_t and row_.bucket = 'tutor-documents'
    and row_.document_path = v_t || '/police.pdf' and row_.document_type = 'police_clearance' and row_.action = 'opened' and row_.created_at = now()
    and row_.admin_label = 'A One <dl.a1.' || v_adm || '@example.invalid>'
    and row_.document_id = (select d.id from public.tutor_verification_documents d where d.tutor_id = v_t and d.document_url = v_t || '/police.pdf') then 'ok' else 'FAIL' end,
    row_.document_type, row_.action, row_.admin_label like 'A One <dl.a1.%', row_.document_id is not null) || E'\n';
  v_id := public.log_document_access('tutor-documents', v_t || '/id.pdf', 'downloaded', v_t);
  select * into row_ from public.document_access_log where id = v_id;
  r := r || format('L2 %s ID file downloaded: type=%s action=%s', case when row_.admin_id = v_adm and row_.subject_id = v_t and row_.document_type = 'identity_doc' and row_.action = 'downloaded' then 'ok' else 'FAIL' end,
    row_.document_type, row_.action) || E'\n';
  v_id := public.log_document_access('school-results', v_l || '/report.pdf');
  select * into row_ from public.document_access_log where id = v_id;
  r := r || format('L3 %s school result: whose=learner %s type=%s', case when row_.subject_id = v_l and row_.bucket = 'school-results' and row_.document_type = 'school_result' then 'ok' else 'FAIL' end,
    row_.subject_id = v_l, row_.document_type) || E'\n';
  v_id := public.log_document_access('tutor-documents', 'https://www.superprof.co.za/tutor/x', 'opened', v_t);
  select * into row_ from public.document_access_log where id = v_id;
  r := r || format('L4 %s web link kept as a document: whose=tutor %s type=%s', case when row_.subject_id = v_t and row_.document_type is null then 'ok' else 'FAIL' end,
    row_.subject_id = v_t, coalesce(row_.document_type, 'none')) || E'\n';

  arr := array[
    format('select public.log_document_access(%L, %L)', 'avatars', v_t || '/id.pdf'),
    format('select public.log_document_access(%L, %L, %L)', 'tutor-documents', v_t || '/id.pdf', 'deleted'),
    format('select public.log_document_access(%L, %L)', 'tutor-documents', ''),
    format('select public.log_document_access(%L, %L)', 'tutor-documents', v_t || '/../' || v_t2 || '/id.pdf'),
    format('select public.log_document_access(%L, %L)', 'tutor-documents', 'id.pdf'),
    format('select public.log_document_access(%L, %L)', 'tutor-documents', v_t || '/nothing.pdf'),
    format('select public.log_document_access(%L, %L, %L, %L)', 'tutor-documents', v_t || '/id.pdf', 'opened', v_t2),
    format('select public.log_document_access(%L, %L)', 'tutor-documents', 'https://example.invalid/x'),
    format('select public.log_document_access(%L, %L)', 'school-results', v_t || '/id.pdf')];
  want := array['Unknown document store', 'Unknown action', 'Give the stored path of the document', 'Give the stored path of the document',
    'The path does not start with the owner''s folder', 'No such stored document', 'That path belongs to someone else', 'Say whose document this is',
    'No such stored document'];
  n := 0;
  for i in 1..array_length(arr, 1) loop
    begin
      execute arr[i];
      r := r || format('L5 FAIL call %s was accepted', i) || E'\n';
    exception when others then
      if sqlerrm = want[i] then n := n + 1; else r := r || format('L5 FAIL call %s got: %s', i, left(sqlerrm, 45)) || E'\n'; end if;
    end;
  end loop;
  select count(*) into n2 from public.document_access_log;
  r := r || format('L5 %s nine bad calls each refused for its own reason: %s of 9; rows still %s (want 4)', case when n = 9 and n2 = 4 then 'ok' else 'FAIL' end, n, n2) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_adm2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_id := public.log_document_access('tutor-documents', v_t || '/police.pdf');
  select count(*), count(*) filter (where admin_id = v_adm), count(*) filter (where admin_id = v_adm2) into n, n2, n3 from public.document_access_log;
  r := r || format('L6 %s second admin: reads all %s rows (want 5), first admin wrote %s (want 4), second wrote %s (want 1)', case when n = 5 and n2 = 4 and n3 = 1 then 'ok' else 'FAIL' end, n, n2, n3) || E'\n';

  -- an admin cannot write, change or remove a row, not even their own
  n := 0;
  foreach q in array array[
    format('insert into public.document_access_log (admin_id, subject_id, bucket, document_path, action) values (%L, %L, %L, %L, %L)', v_adm2, v_t, 'tutor-documents', 'x/y.pdf', 'opened'),
    'update public.document_access_log set action = ''opened''', 'delete from public.document_access_log', 'truncate public.document_access_log'] loop
    begin execute q; r := r || 'W1 FAIL accepted: ' || left(q, 30) || E'\n';
    exception when others then
      if sqlerrm ilike 'permission denied%' then n := n + 1; else r := r || 'W1 FAIL other error: ' || left(sqlerrm, 45) || E'\n'; end if; end;
  end loop;
  r := r || format('W1 %s admin: insert, update, delete, truncate on the table refused %s of 4', case when n = 4 then 'ok' else 'FAIL' end, n) || E'\n';
  reset role;

  -- even the owner of the table cannot change or remove a row
  n := 0;
  foreach q in array array['update public.document_access_log set action = ''opened''', 'delete from public.document_access_log', 'truncate public.document_access_log'] loop
    begin execute q; r := r || 'W2 FAIL accepted: ' || left(q, 30) || E'\n';
    exception when others then
      if sqlerrm = 'The document access log can only be added to' then n := n + 1; else r := r || 'W2 FAIL other error: ' || left(sqlerrm, 45) || E'\n'; end if; end;
  end loop;
  select count(*) into n2 from public.document_access_log;
  r := r || format('W2 %s owner: update, delete, truncate stopped by the trigger %s of 3; rows still %s (want 5)', case when n = 3 and n2 = 5 then 'ok' else 'FAIL' end, n, n2) || E'\n';

  -- everyone else: refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_off, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.log_document_access('tutor-documents', v_t || '/id.pdf'); t := 'FAIL'; exception when others then t := sqlerrm; end;
  select count(*) into n from public.document_access_log;
  r := r || format('X1 %s admin switched off: function says "%s", reads %s rows (want 0)', case when t = 'Admins only' and n = 0 then 'ok' else 'FAIL' end, t, n) || E'\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.log_document_access('school-results', v_l || '/report.pdf'); t := 'FAIL'; exception when others then t := sqlerrm; end;
  select count(*) into n from public.document_access_log;
  begin insert into public.document_access_log (admin_id, subject_id, bucket, document_path, action) values (v_l, v_l, 'school-results', v_l || '/report.pdf', 'opened'); t2 := 'FAIL';
  exception when others then t2 := case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL ' || left(sqlerrm, 30) end; end;
  r := r || format('X2 %s learner (even for their own file): function says "%s", reads %s rows (want 0), insert %s', case when t = 'Admins only' and n = 0 and t2 = 'ok' then 'ok' else 'FAIL' end, t, n, t2) || E'\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.log_document_access('tutor-documents', v_t || '/id.pdf'); t := 'FAIL'; exception when others then t := sqlerrm; end;
  select count(*) into n from public.document_access_log;
  r := r || format('X3 %s tutor (even for their own file): function says "%s", reads %s rows (want 0)', case when t = 'Admins only' and n = 0 then 'ok' else 'FAIL' end, t, n) || E'\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  n := 0;
  foreach q in array array[format('select public.log_document_access(%L, %L)', 'tutor-documents', v_t || '/id.pdf'), 'select count(*) from public.document_access_log',
    format('insert into public.document_access_log (admin_id, subject_id, bucket, document_path, action) values (%L, %L, %L, %L, %L)', v_t, v_t, 'tutor-documents', 'x/y.pdf', 'opened')] loop
    begin execute q; r := r || 'X4 FAIL accepted: ' || left(q, 30) || E'\n';
    exception when others then
      if sqlerrm ilike 'permission denied%' then n := n + 1; else r := r || 'X4 FAIL other error: ' || left(sqlerrm, 45) || E'\n'; end if; end;
  end loop;
  r := r || format('X4 %s signed out: function, read and insert refused %s of 3', case when n = 3 then 'ok' else 'FAIL' end, n) || E'\n';
  reset role;

  -- ============ a stored file can be reached only after its opening is recorded (migration 20261021103000) ================
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) filter (where name = v_t || '/police.pdf'), count(*) filter (where name = v_t || '/id.pdf'),
         count(*) filter (where name = v_l || '/report.pdf'), count(*) filter (where name = v_t || '/other.pdf')
    into n, n2, n3, n4 from storage.objects where bucket_id in ('tutor-documents', 'school-results');
  r := r || format('R1 %s admin 1 reaches the 3 files they opened (%s %s %s; want 1 1 1) but not an unopened one (%s; want 0)', case when n = 1 and n2 = 1 and n3 = 1 and n4 = 0 then 'ok' else 'FAIL' end, n, n2, n3, n4) || E'\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) filter (where name = v_t || '/police.pdf'), count(*) filter (where name = v_t || '/id.pdf'),
         count(*) filter (where name = v_l || '/report.pdf'), count(*) filter (where name = v_t || '/other.pdf')
    into n, n2, n3, n4 from storage.objects where bucket_id in ('tutor-documents', 'school-results');
  r := r || format('R2 %s admin 2 opened only the police file: reaches it (%s; want 1) and not the others (%s %s %s; want 0 0 0)', case when n = 1 and n2 = 0 and n3 = 0 and n4 = 0 then 'ok' else 'FAIL' end, n, n2, n3, n4) || E'\n';
  reset role;
  -- a line older than 5 minutes does not unlock a file; a fresh one does
  insert into public.document_access_log (admin_id, subject_id, bucket, document_path, action, created_at)
    values (v_adm, v_t, 'tutor-documents', v_t || '/other.pdf', 'opened', now() - interval '10 minutes');
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from storage.objects where bucket_id = 'tutor-documents' and name = v_t || '/other.pdf';
  v_id := public.log_document_access('tutor-documents', v_t || '/other.pdf');
  select count(*) into n2 from storage.objects where bucket_id = 'tutor-documents' and name = v_t || '/other.pdf';
  r := r || format('R3 %s a 10-minute-old line does not unlock the file (%s; want 0); a fresh line does (%s; want 1)', case when n = 0 and n2 = 1 then 'ok' else 'FAIL' end, n, n2) || E'\n';
  reset role;
  -- an admin who is switched off gets nothing even with a line; tutor and learner keep reading their own files
  insert into public.document_access_log (admin_id, subject_id, bucket, document_path, action) values (v_off, v_t, 'tutor-documents', v_t || '/police.pdf', 'opened');
  perform set_config('request.jwt.claims', json_build_object('sub', v_off, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from storage.objects where bucket_id = 'tutor-documents' and name = v_t || '/police.pdf';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n2 from storage.objects where bucket_id = 'tutor-documents' and name like (v_t::text || '/%');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) filter (where name = v_l || '/report.pdf'), count(*) filter (where name like (v_t::text || '/%')) into n3, n4
    from storage.objects where bucket_id in ('tutor-documents', 'school-results');
  reset role;
  r := r || format('R4 %s switched-off admin with a line reaches %s (want 0); tutor reaches own %s files (want 3); learner reaches own result %s (want 1) and the tutor''s files %s (want 0)',
    case when n = 0 and n2 = 3 and n3 = 1 and n4 = 0 then 'ok' else 'FAIL' end, n, n2, n3, n4) || E'\n';
  select count(*) filter (where policyname = 'Admins read all tutor documents'),
         count(*) filter (where policyname = 'Admins read tutor documents they have logged' and qual like '%admin_may_read_document%'),
         count(*) filter (where policyname = 'School results: learner, guardian or admin reads' and qual like '%admin_may_read_document%' and qual like '%can_manage_school_results_folder%')
    into n, n2, n3 from pg_policies where schemaname = 'storage' and tablename = 'objects';
  select count(*) into n4 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'admin_may_read_document' and prosecdef
    and exists (select 1 from unnest(coalesce(proconfig, '{}'::text[])) c where c = 'search_path=public');
  r := r || format('R5 %s storage policies: old admin rule gone=%s (want 0), new tutor-documents rule=%s (want 1), school-results rule keeps the learner part=%s (want 1); helper definer+pinned=%s (want 1); signed-out may run it=%s',
    case when n = 0 and n2 = 1 and n3 = 1 and n4 = 1 and not has_function_privilege('anon', 'public.admin_may_read_document(text,text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.admin_may_read_document(text,text)', 'EXECUTE') then 'ok' else 'FAIL' end, n, n2, n3, n4,
    has_function_privilege('anon', 'public.admin_may_read_document(text,text)', 'EXECUTE')) || E'\n';

  -- a file kept outside an owner folder, and a file name with two dots, are still reachable by an admin through the log
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) filter (where name = 'legacy/old.pdf'), count(*) filter (where name = v_t2 || '/scan..final.pdf') into n, n2
    from storage.objects where bucket_id = 'tutor-documents';
  begin perform public.log_document_access('tutor-documents', 'legacy/old.pdf'); t := 'FAIL'; exception when others then t := sqlerrm; end;
  v_id := public.log_document_access('tutor-documents', 'legacy/old.pdf', 'opened', v_t);
  select subject_id = v_t into bl from public.document_access_log where id = v_id;
  v_id := public.log_document_access('tutor-documents', v_t2 || '/scan..final.pdf');
  select count(*) filter (where name = 'legacy/old.pdf'), count(*) filter (where name = v_t2 || '/scan..final.pdf') into n3, n4
    from storage.objects where bucket_id = 'tutor-documents';
  reset role;
  r := r || format('L7 %s file outside an owner folder + name with two dots: out of reach before logging (%s %s; want 0 0), refused without saying whose ("%s"), logged with the tutor named=%s, reachable after (%s %s; want 1 1)',
    case when n = 0 and n2 = 0 and t = 'The path does not start with the owner''s folder' and bl and n3 = 1 and n4 = 1 then 'ok' else 'FAIL' end, n, n2, left(t, 20), bl, n3, n4) || E'\n';

  -- ============ retention: only the daily job may delete a line, and only an old one ======================================
  select count(*) into n from public.document_access_log;
  insert into public.document_access_log (admin_id, subject_id, bucket, document_path, action, created_at) values
    (v_adm, v_t, 'tutor-documents', v_t || '/old4.pdf', 'opened', now() - interval '4 years'),
    (v_adm, v_t, 'tutor-documents', v_t || '/old2.pdf', 'opened', now() - interval '2 years');
  n2 := public.purge_old_document_access_log();
  select count(*) filter (where document_path = v_t || '/old4.pdf'), count(*) filter (where document_path = v_t || '/old2.pdf'), count(*) into n3, n4, n5 from public.document_access_log;
  r := r || format('P1 %s the job deleted %s line (want 1): the 4-year-old one is gone=%s (want 0); the 2-year-old one stays=%s (want 1); all %s others stay (want %s)',
    case when n2 = 1 and n3 = 0 and n4 = 1 and n5 = n + 1 then 'ok' else 'FAIL' end, n2, n3, n4, n5 - 1, n) || E'\n';
  begin delete from public.document_access_log where document_path = v_t || '/old2.pdf'; t := 'FAIL deleted'; exception when others then t := sqlerrm; end;
  r := r || format('P2 %s after the job has run a delete is refused again: %s', case when t = 'The document access log can only be added to' then 'ok' else 'FAIL' end, left(t, 45)) || E'\n';
  select count(*) into n from cron.job where jobname = 'purge-document-access-log';
  select setting_value::text into t from public.system_settings where setting_key = 'document_access_log_retention_years';
  r := r || format('P3 %s daily job scheduled=%s (want 1); retention setting=%s (want 3); job function open to signed-out=%s signed-in=%s (want f f)',
    case when n = 1 and t = '3' and not has_function_privilege('anon', 'public.purge_old_document_access_log()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.purge_old_document_access_log()', 'EXECUTE') then 'ok' else 'FAIL' end, n, t,
    has_function_privilege('anon', 'public.purge_old_document_access_log()', 'EXECUTE'), has_function_privilege('authenticated', 'public.purge_old_document_access_log()', 'EXECUTE')) || E'\n';

  -- ============ safety hold: the data stays retrievable while a person is reported (CEO, 21 Oct) ===========================
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  arr := array[
    format('select public.place_safety_hold(%L, %L)', v_t, 'ab'),
    format('select public.place_safety_hold(%L, %L)', v_t, '   '),
    format('select public.place_safety_hold(%L, %L)', gen_random_uuid(), 'reported for dangerous activity')];
  want := array['Say why: a short written reason is needed', 'Say why: a short written reason is needed', 'No such person'];
  n := 0;
  for i in 1..3 loop
    begin
      execute arr[i];
      r := r || format('H1 FAIL call %s was accepted', i) || E'\n';
    exception when others then
      if sqlerrm = want[i] then n := n + 1; else r := r || format('H1 FAIL call %s got: %s', i, left(sqlerrm, 40)) || E'\n'; end if;
    end;
  end loop;
  v_seq := public.place_safety_hold(v_t, '  Reported for dangerous activity  ');
  begin perform public.place_safety_hold(v_t, 'a second hold'); t := 'FAIL'; exception when others then t := sqlerrm; end;
  select (e.event = 'placed' and e.reason = 'Reported for dangerous activity' and e.admin_id = v_adm and e.admin_label = 'A One <dl.a1.' || v_adm || '@example.invalid>'
          and e.created_at = now() and e.profile_id = v_t)
    into bl from public.safety_hold_events e where e.seq = v_seq;
  r := r || format('H1 %s admin places a hold on the tutor: 3 bad requests refused %s of 3 (short reason, blank, unknown person); line has reason (trimmed), who, when = %s; a second hold refused ("%s")',
    case when n = 3 and bl and t = 'This person is already on a safety hold' then 'ok' else 'FAIL' end, n, bl, left(t, 22)) || E'\n';
  reset role;

  n := 0;
  foreach q in array array[v_l::text, v_t::text, v_off::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', q, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin perform public.place_safety_hold(v_t2, 'reported to us'); exception when others then if sqlerrm = 'Admins only' then n := n + 1; end if; end;
    begin perform public.release_safety_hold(v_t, 'released again'); exception when others then if sqlerrm = 'Admins only' then n := n + 1; end if; end;
    reset role;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  n2 := 0;
  foreach q in array array[format('select public.place_safety_hold(%L, %L)', v_t2, 'reported to us'), format('select public.release_safety_hold(%L, %L)', v_t, 'released again'),
    'select count(*) from public.safety_hold_events',
    format('insert into public.safety_hold_events (profile_id, event, reason, admin_id) values (%L, %L, %L, %L)', v_t, 'released', 'sneaky note', v_t)] loop
    begin execute q; exception when others then if sqlerrm ilike 'permission denied%' then n2 := n2 + 1; end if; end;
  end loop;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n3 from public.safety_hold_events;
  begin insert into public.safety_hold_events (profile_id, event, reason, admin_id) values (v_t, 'released', 'sneaky note', v_l); t := 'FAIL';
  exception when others then t := case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL ' || left(sqlerrm, 30) end; end;
  reset role;
  select count(*) into n4 from public.safety_hold_events where profile_id = v_t2;
  r := r || format('H2 %s not an admin: learner, tutor and switched-off admin refused place and release %s of 6; signed out refused %s of 4; a learner reads %s lines (want 0), insert %s; no hold slipped onto another tutor=%s',
    case when n = 6 and n2 = 4 and n3 = 0 and t = 'ok' and n4 = 0 then 'ok' else 'FAIL' end, n, n2, n3, t, n4 = 0) || E'\n';

  -- with a hold on the tutor the job keeps that tutor's old line; after the release it deletes it
  insert into public.document_access_log (admin_id, subject_id, bucket, document_path, action, created_at) values
    (v_adm, v_t, 'tutor-documents', v_t || '/held-old.pdf', 'opened', now() - interval '4 years'),
    (v_adm, v_l, 'school-results', v_l || '/free-old.pdf', 'opened', now() - interval '4 years');
  n := public.purge_old_document_access_log();
  select count(*) filter (where document_path = v_t || '/held-old.pdf'), count(*) filter (where document_path = v_l || '/free-old.pdf') into n2, n3 from public.document_access_log;
  r := r || format('H3 %s on hold: the job deleted %s line (want 1); the tutor''s 4-year-old line stays=%s; another person''s 4-year-old line is gone=%s', case when n = 1 and n2 = 1 and n3 = 0 then 'ok' else 'FAIL' end, n, n2 = 1, n3 = 0) || E'\n';

  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  arr := array[format('select public.release_safety_hold(%L, %L)', v_t, ' '), format('select public.release_safety_hold(%L, %L)', v_t2, 'nothing to release here')];
  want := array['Say why: a short written note is needed', 'This person is not on a safety hold'];
  n := 0;
  for i in 1..2 loop
    begin
      execute arr[i];
      r := r || format('H4 FAIL call %s was accepted', i) || E'\n';
    exception when others then
      if sqlerrm = want[i] then n := n + 1; else r := r || format('H4 FAIL call %s got: %s', i, left(sqlerrm, 40)) || E'\n'; end if;
    end;
  end loop;
  v_seq := public.release_safety_hold(v_t, 'Investigation closed, no case');
  begin perform public.release_safety_hold(v_t, 'once more please'); t := 'FAIL'; exception when others then t := sqlerrm; end;
  select count(*) filter (where profile_id = v_t), (select e.event from public.safety_hold_events e where e.profile_id = v_t order by e.seq desc limit 1)
    into n2, t2 from public.safety_hold_events;
  reset role;
  n3 := public.purge_old_document_access_log();
  select count(*) into n4 from public.document_access_log where document_path = v_t || '/held-old.pdf';
  r := r || format('H4 %s release: 2 bad requests refused %s of 2 (blank note, not on hold); released with a note; a second release refused ("%s"); admin reads both lines=%s (want 2), latest=%s; now the job deletes it: %s line, gone=%s',
    case when n = 2 and t = 'This person is not on a safety hold' and n2 = 2 and t2 = 'released' and n3 = 1 and n4 = 0 then 'ok' else 'FAIL' end, n, left(t, 22), n2, t2, n3, n4 = 0) || E'\n';

  -- the hold lines cannot be changed, not even by an admin or the owner of the table
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := 0;
  foreach q in array array[
    format('insert into public.safety_hold_events (profile_id, event, reason, admin_id) values (%L, %L, %L, %L)', v_t, 'placed', 'abc', v_adm),
    'update public.safety_hold_events set reason = ''xyz''', 'delete from public.safety_hold_events', 'truncate public.safety_hold_events'] loop
    begin execute q; r := r || 'H5 FAIL accepted: ' || left(q, 30) || E'\n';
    exception when others then
      if sqlerrm ilike 'permission denied%' then n := n + 1; else r := r || 'H5 FAIL other error: ' || left(sqlerrm, 40) || E'\n'; end if; end;
  end loop;
  reset role;
  n2 := 0;
  foreach q in array array['update public.safety_hold_events set reason = ''xyz''', 'delete from public.safety_hold_events', 'truncate public.safety_hold_events'] loop
    begin execute q; r := r || 'H5 FAIL owner accepted: ' || left(q, 30) || E'\n';
    exception when others then
      if sqlerrm = 'Safety hold lines can only be added to' then n2 := n2 + 1; else r := r || 'H5 FAIL owner other error: ' || left(sqlerrm, 40) || E'\n'; end if; end;
  end loop;
  select count(*) into n3 from public.safety_hold_events;
  r := r || format('H5 %s hold lines: admin insert, update, delete, truncate refused %s of 4; owner update, delete, truncate stopped by the trigger %s of 3; lines still %s (want 2)', case when n = 4 and n2 = 3 and n3 = 2 then 'ok' else 'FAIL' end, n, n2, n3) || E'\n';

  select count(*) filter (where has_table_privilege('anon', 'public.safety_hold_events', p)),
         count(*) filter (where has_table_privilege('authenticated', 'public.safety_hold_events', p)),
         count(*) filter (where has_table_privilege('service_role', 'public.safety_hold_events', p))
    into n, n2, n3 from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p;
  select count(*) filter (where prosecdef and exists (select 1 from unnest(coalesce(proconfig, '{}'::text[])) c where c = 'search_path=public')) into n4
    from pg_proc where pronamespace = 'public'::regnamespace and proname in ('place_safety_hold', 'release_safety_hold', 'profile_is_on_safety_hold');
  select relrowsecurity into bl from pg_class where oid = 'public.safety_hold_events'::regclass;
  select count(*) into n5 from pg_trigger where tgrelid = 'public.safety_hold_events'::regclass and not tgisinternal;
  r := r || format('H6 %s built: table rights signed out=%s signed in=%s (select only: 1) server key=%s; 3 functions definer + pinned=%s; row security=%s; triggers=%s (want 2); place and release open to signed-in=%s, signed-out=%s; the check function open to API roles=%s',
    case when n = 0 and n2 = 1 and n3 = 0 and n4 = 3 and bl and n5 = 2
      and has_function_privilege('authenticated', 'public.place_safety_hold(uuid,text)', 'EXECUTE') and has_function_privilege('authenticated', 'public.release_safety_hold(uuid,text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.place_safety_hold(uuid,text)', 'EXECUTE') and not has_function_privilege('anon', 'public.release_safety_hold(uuid,text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.profile_is_on_safety_hold(uuid)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.profile_is_on_safety_hold(uuid)', 'EXECUTE') then 'ok' else 'FAIL' end,
    n, n2, n3, n4, bl, n5, has_function_privilege('authenticated', 'public.place_safety_hold(uuid,text)', 'EXECUTE'), has_function_privilege('anon', 'public.place_safety_hold(uuid,text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.profile_is_on_safety_hold(uuid)', 'EXECUTE')) || E'\n';

  -- ============ how it is built =========================================================================================
  select count(*) filter (where has_table_privilege('anon', 'public.document_access_log', p)),
         count(*) filter (where has_table_privilege('authenticated', 'public.document_access_log', p)),
         count(*) filter (where has_table_privilege('service_role', 'public.document_access_log', p)),
         bool_or(has_table_privilege('authenticated', 'public.document_access_log', p)) filter (where p = 'SELECT')
    into n, n2, n3, bl from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p;
  r := r || format('B1 %s table rights: signed out=%s (want 0), signed in=%s (select only: want 1), server key=%s (want 0)', case when n = 0 and n2 = 1 and bl and n3 = 0 then 'ok' else 'FAIL' end, n, n2, n3) || E'\n';
  select count(*) filter (where prosecdef and exists (select 1 from unnest(coalesce(proconfig, '{}'::text[])) c where c = 'search_path=public') and proowner::regrole::text = 'postgres'
                          and pronargs = 4 and proargnames = array['p_bucket', 'p_path', 'p_action', 'p_subject']),
         count(*) filter (where not prosecdef and exists (select 1 from unnest(coalesce(proconfig, '{}'::text[])) c where c = 'search_path=public') and proname = 'document_access_log_is_append_only')
    into n, n2 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('log_document_access', 'document_access_log_is_append_only');
  r := r || format('B2 %s function is definer, path pinned, owner postgres, no admin or time argument (%s); trigger function pinned (%s)', case when n = 1 and n2 = 1 then 'ok' else 'FAIL' end, n, n2) || E'\n';
  r := r || format('B3 %s function rights: signed out=%s (want f), signed in=%s (want t)', case when not has_function_privilege('anon', 'public.log_document_access(text,text,text,uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.log_document_access(text,text,text,uuid)', 'EXECUTE') then 'ok' else 'FAIL' end,
    has_function_privilege('anon', 'public.log_document_access(text,text,text,uuid)', 'EXECUTE'), has_function_privilege('authenticated', 'public.log_document_access(text,text,text,uuid)', 'EXECUTE')) || E'\n';
  select count(*) filter (where cmd = 'SELECT'), count(*) into n, n2 from pg_policies where schemaname = 'public' and tablename = 'document_access_log';
  select count(*) into n3 from pg_trigger where tgrelid = 'public.document_access_log'::regclass and not tgisinternal;
  select relrowsecurity into bl from pg_class where oid = 'public.document_access_log'::regclass;
  r := r || format('B4 %s row security on=%s; policies=%s, select policies=%s (want 1, 1); triggers=%s (want 2)', case when bl and n = 1 and n2 = 1 and n3 = 2 then 'ok' else 'FAIL' end, bl, n2, n, n3) || E'\n';

  -- ============ rights tidy (m2, m4) ====================================================================================
  n := pg_temp.rights_count_extra();
  r := r || format('T1 %s truncate, references, trigger, maintain held by signed-out or signed-in users on any table: %s (was %s)', case when n = 0 then 'ok' else 'FAIL' end, n, current_setting('test.extra_before')) || E'\n';
  r := r || format('T2 %s select, insert, update, delete on every table unchanged for all three API roles (and the server key keeps everything)', case when dml_now = current_setting('test.dml_before') then 'ok' else 'FAIL' end) || E'\n';
  n := pg_temp.rights_count_trigger_exec();
  r := r || format('T3 %s trigger functions that signed-out or signed-in users may execute: %s (was %s)', case when n = 0 then 'ok' else 'FAIL' end, n, current_setting('test.trigexec_before')) || E'\n';
  r := r || format('T4 %s execute rights on every other function unchanged', case when exec_now = current_setting('test.exec_before') then 'ok' else 'FAIL' end) || E'\n';
  create table public.zz_default_probe (id int);
  select has_table_privilege('anon', 'public.zz_default_probe', 'TRUNCATE') or has_table_privilege('anon', 'public.zz_default_probe', 'TRIGGER') or has_table_privilege('anon', 'public.zz_default_probe', 'REFERENCES') or has_table_privilege('anon', 'public.zz_default_probe', 'MAINTAIN'),
         has_table_privilege('authenticated', 'public.zz_default_probe', 'TRUNCATE') or has_table_privilege('authenticated', 'public.zz_default_probe', 'TRIGGER') or has_table_privilege('authenticated', 'public.zz_default_probe', 'REFERENCES') or has_table_privilege('authenticated', 'public.zz_default_probe', 'MAINTAIN'),
         has_table_privilege('service_role', 'public.zz_default_probe', 'TRUNCATE')
    into bl, bl2, bl3;
  r := r || format('T5 %s a table created now: signed-out has any of the four=%s, signed-in has any=%s (want f f); server key keeps truncate=%s (want t)', case when not bl and not bl2 and bl3 then 'ok' else 'FAIL' end, bl, bl2, bl3) || E'\n';
  drop table public.zz_default_probe;

  -- the guard triggers still fire although signed-in users may no longer execute them
  perform set_config('request.jwt.claims', json_build_object('sub', v_t, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin insert into public.tutor_verification_documents (tutor_id, document_type, document_url) values (v_t, 'identity_doc', v_t2 || '/id.pdf'); t := 'FAIL'; exception when others then t := sqlerrm; end;
  insert into public.tutor_verification_documents (tutor_id, document_type, document_url) values (v_t, 'proof_of_experience', v_t || '/proof.pdf') returning id, status::text into v_d, t2;
  r := r || format('T6 %s the document guard still fires for a signed-in tutor: other folder refused ("%s"); own folder saved as %s', case when t = 'A document must be uploaded to your own folder' and t2 = 'pending' then 'ok' else 'FAIL' end, left(t, 25), t2) || E'\n';
  reset role;

  -- keep-forever probes (review m2): a normal signed-in user cannot add, change or remove admin or settings rows
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := 0;
  foreach q in array array[
    format('insert into public.admin_profiles (id, first_name, surname, email, phone_number) values (%L, %L, %L, %L, %L)', v_l, 'X', 'Y', 'zz.probe@example.invalid', ''),
    'update public.admin_profiles set first_name = ''Hacked''', 'delete from public.admin_profiles',
    'insert into public.system_settings (setting_key, setting_value, description) values (''zz_probe'', ''"x"''::jsonb, ''probe'')',
    'update public.system_settings set setting_value = ''"hacked"''::jsonb', 'delete from public.system_settings'] loop
    begin
      execute q;
      get diagnostics n2 = row_count;
      if n2 = 0 then n := n + 1; else r := r || 'T7 FAIL changed rows: ' || left(q, 40) || E'\n'; end if;
    exception when others then
      if sqlerrm ilike 'permission denied%' or sqlerrm ilike '%row-level security%' then n := n + 1; else r := r || 'T7 FAIL other error: ' || left(sqlerrm, 40) || E'\n'; end if;
    end;
  end loop;
  reset role;
  select count(*) into n2 from admin_profiles where first_name = 'Hacked';
  select count(*) into n3 from system_settings where setting_value = '"hacked"'::jsonb or setting_key = 'zz_probe';
  r := r || format('T7 %s learner: insert, update, delete on admin_profiles and system_settings each changed nothing (%s of 6); hacked rows=%s (want 0)', case when n = 6 and n2 = 0 and n3 = 0 then 'ok' else 'FAIL' end, n, n2 + n3) || E'\n';

  -- not fixable here (review m3): pg_net's grants were made by supabase_admin. Try it and say what happened (rolled back with everything).
  t := 'no error';
  begin revoke usage on schema net from anon, authenticated; exception when others then t := left(sqlerrm, 40); end;
  r := r || format('T8 info: revoke usage on schema net by this role (%s): signed-out still has usage=%s, signed-in=%s', t, has_schema_privilege('anon', 'net', 'USAGE'), has_schema_privilege('authenticated', 'net', 'USAGE')) || E'\n';
  select count(*), count(*) filter (where prosecdef) into n, n2 from pg_proc where pronamespace = 'public'::regnamespace and prosrc ilike '%net.http%';
  r := r || format('T9 %s %s functions call net.http_*, %s are security definer (a revoke would not touch them)', case when n = n2 then 'ok' else 'FAIL' end, n, n2) || E'\n';

  select count(*) filter (where l like '%FAIL%'), count(*), string_agg(case when l like '%FAIL%' then l else left(l, 90) end, E'\n' order by o)
    into nfail, n, rep from regexp_split_to_table(r, E'\n') with ordinality as x(l, o) where l <> '';
  -- Inside scripts/run-rolled-back-test.mjs the report is handed back through a setting and the runner raises it (the rollback).
  if coalesce(current_setting('test.runner', true), '') = 'on' then
    perform set_config('test.report', format(E'DOCUMENT ACCESS LOG + RIGHTS TIDY TEST (rolled back): %s FAIL line(s) in %s lines\n%s', nfail, n, rep), true);
  else
    raise exception E'DOCUMENT ACCESS LOG + RIGHTS TIDY TEST (rolled back): % FAIL line(s) in % lines\n%', nfail, n, rep;
  end if;
end $$;
