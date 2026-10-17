-- Rolled-back test of migration 20261017120000_tier_roles_and_admin_levels.sql (17 Oct 2026): an admin assigns a tutor's level,
-- records credentials, and edits the levels, tiers and credential definitions; nobody else can; every change leaves an audit row.
-- Run TOGETHER with the migration in one statement before it is applied (scripts/run-rolled-back-test.mjs), or on its own after.
-- Every line starts with ok or FAIL; the statement raises an error at the end on purpose, so nothing is kept.
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  t1 uuid := gen_random_uuid();   -- a tutor
  t2 uuid := gen_random_uuid();   -- a second tutor
  ad uuid := gen_random_uuid();   -- an admin
  doc uuid; cid uuid;
  n int; n0 int; s text; s2 text; x numeric;
  nok int; nfail int;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (t1, z,'authenticated','authenticated','tr.1.'||t1||'@example.invalid', jsonb_build_object('role','tutor','first_name','One','date_of_birth',adult), '{}'),
    (t2, z,'authenticated','authenticated','tr.2.'||t2||'@example.invalid', jsonb_build_object('role','tutor','first_name','Two','date_of_birth',adult), '{}'),
    (ad, z,'authenticated','authenticated','tr.ad.'||ad||'@example.invalid', jsonb_build_object('first_name','Admin','date_of_birth',adult), '{}');
  insert into admin_profiles (id, first_name, surname, email) values (ad, 'Test', 'Admin', 'tr.ad.'||ad||'@example.invalid');
  select count(*) into n0 from admin_audit_logs;

  -- T0 the definitions the migration seeds
  select count(*) into n from credential_definitions
   where (code, entry_sub_tier_id) in (('teaching_degree','2C'),('teaching_degree_2y','2D'),('teaching_degree_3y','3A'),('teaching_degree_4y','3B'),('higher_certificate_education','2A'));
  select entry_sub_tier_id into s from credential_definitions where code = 'admin_assigned';
  r := r || format('%s T0 seeded: %s of 5 credential kinds at their levels, "level assigned by Tutorlage" has no level of its own (%s) (want 5, empty)',
    case when n = 5 and s is null then 'ok  ' else 'FAIL' end, n, coalesce(s, 'empty')) || E'\n';

  -- T1 nobody but an admin can do any of it (a tutor)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.admin_assign_tier(t1, '4B', 'I want it'); s := 'ASSIGNED';
  exception when others then s := sqlerrm; end;
  begin perform public.admin_save_sub_tier('1A', 1, 1, 0, 0, 0, 0, 0, 0, 30); s2 := 'SAVED';
  exception when others then s2 := sqlerrm; end;
  begin update sub_tier_definitions set max_allowed_rate = 1 where id = '1A'; get diagnostics n = row_count;
  exception when others then n := 0; end;
  reset role;
  select max_allowed_rate into x from sub_tier_definitions where id = '1A';
  r := r || format('%s T1 a tutor cannot assign a level (%s), save a level (%s) or edit the table (rows changed %s; 1A still R%s)',
    case when s = 'Admins only' and s2 = 'Admins only' and n = 0 and x = 50 then 'ok  ' else 'FAIL' end, s, s2, n, x) || E'\n';

  -- T2 an admin assigns a level; the tutor is there at once; the audit row is written
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ad, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_assign_tier(t1, '2D', 'Four years teaching, checked letters');
  reset role;
  select current_sub_tier_id, credential_floor_sub_tier_id into s, s2 from tutor_profiles where id = t1;
  select count(*) into n from admin_audit_logs where action = 'manual_tier_override' and target_entity_id = t1 and metadata->>'action' = 'assign_level' and metadata->>'sub_tier' = '2D';
  r := r || format('%s T2 assigned 2D: the tutor''s level is %s, floor %s, audit rows %s (want 2D, 2D, 1)',
    case when s = '2D' and s2 = '2D' and n = 1 then 'ok  ' else 'FAIL' end, s, s2, n) || E'\n';

  -- T3 a second assignment replaces the first (one at a time), and the level can go down again
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ad, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_assign_tier(t1, '1C', 'Changed my mind');
  reset role;
  select current_sub_tier_id into s from tutor_profiles where id = t1;
  select count(*) into n from tutor_credentials where tutor_id = t1 and credential_code = 'admin_assigned';
  r := r || format('%s T3 re-assigned 1C: level %s, assignments held %s (want 1C, 1)', case when s = '1C' and n = 1 then 'ok  ' else 'FAIL' end, s, n) || E'\n';

  -- T4 refusals: no reason, unknown level, unknown tutor
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ad, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.admin_assign_tier(t1, '2D', ' '); s := 'DONE'; exception when others then s := sqlerrm; end;
  begin perform public.admin_assign_tier(t1, '9Z', 'x reason'); s2 := 'DONE'; exception when others then s2 := sqlerrm; end;
  begin perform public.admin_assign_tier(gen_random_uuid(), '2D', 'x reason'); x := 1; exception when others then x := 0; end;
  reset role;
  r := r || format('%s T4 refused: no reason (%s), unknown level (%s), unknown tutor (%s)',
    case when s = 'Give the reason for this level' and s2 = 'No such level' and x = 0 then 'ok  ' else 'FAIL' end, s, s2, case when x = 0 then 'refused' else 'ACCEPTED' end) || E'\n';

  -- T5 a credential: the degree puts the tutor at 2C; the higher level still wins; removing the assignment leaves 2C
  select id into doc from (select gen_random_uuid() as id) q;
  insert into tutor_verification_documents (id, tutor_id, document_type, document_url) values (doc, t1, 'teaching_qualification', t1 || '/test.pdf');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ad, 'role', 'authenticated')::text, true);
  set local role authenticated;
  cid := public.admin_record_credential(t1, 'teaching_degree', current_date - 400, doc, 'B.Ed, 4 years');
  perform public.admin_assign_tier(t1, '2D', 'Letters seen');
  reset role;
  select current_sub_tier_id into s from tutor_profiles where id = t1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ad, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_clear_assigned_tier(t1, 'Back to the credential');
  reset role;
  select current_sub_tier_id into s2 from tutor_profiles where id = t1;
  r := r || format('%s T5 credential 2C then assignment 2D: level %s; assignment cleared: level %s, floor %s (want 2D, then 2C, 2C)',
    case when s = '2D' and s2 = '2C' and (select credential_floor_sub_tier_id from tutor_profiles where id = t1) = '2C' then 'ok  ' else 'FAIL' end,
    s, s2, (select credential_floor_sub_tier_id from tutor_profiles where id = t1)) || E'\n';

  -- T6 refusals when recording: someone else's document; a credential with no level of its own; an unknown credential
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ad, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.admin_record_credential(t2, 'teaching_degree', current_date, doc, null); s := 'DONE'; exception when others then s := sqlerrm; end;
  begin perform public.admin_record_credential(t2, 'admin_assigned', current_date, null, null); s2 := 'DONE'; exception when others then s2 := sqlerrm; end;
  begin perform public.admin_record_credential(t2, 'nonsense', current_date, null, null); x := 1; exception when others then x := 0; end;
  reset role;
  r := r || format('%s T6 refused: another tutor''s document (%s), a credential without a level (%s), an unknown credential (%s)',
    case when s = 'That document does not belong to this tutor' and s2 like 'To set a level for this tutor%' and x = 0 then 'ok  ' else 'FAIL' end,
    s, s2, case when x = 0 then 'refused' else 'ACCEPTED' end) || E'\n';

  -- T7 removing the credential takes the floor away
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ad, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_remove_credential(cid, 'Recorded in error');
  reset role;
  select credential_floor_sub_tier_id into s from tutor_profiles where id = t1;
  r := r || format('%s T7 credential removed: floor %s (want empty)', case when s is null then 'ok  ' else 'FAIL' end, coalesce(s, 'empty')) || E'\n';

  -- T8 editing a level: price and minimums change; a new level is added; the audit row keeps before and after
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ad, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_save_sub_tier('1B', 1, 85, 12, 4.75, 0, 0, 0, 0, 30);
  perform public.admin_save_sub_tier('5a', 4, 1500, 700, 4.99, 95, 50, 25, 25, 12);
  reset role;
  select max_allowed_rate into x from sub_tier_definitions where id = '1B';
  select min_hours into n from sub_tier_definitions where id = '1B';
  select count(*) into n0 from sub_tier_definitions where id = '5A' and tier_id = 4 and sub_tier_code = 'A' and max_allowed_rate = 1500;
  select count(*) into n from admin_audit_logs where action = 'system_setting_updated' and metadata->>'entity' = 'level' and metadata->>'id' = '1B'
    and (metadata->'before'->>'max_allowed_rate')::numeric = 80 and (metadata->'after'->>'price')::numeric = 85;
  r := r || format('%s T8 level 1B now R%s and 12 hours (hours stored %s), a new level 5A added (%s), audit shows before 80 and after 85 (%s) (want 85, 1, 1)',
    case when x = 85 and n0 = 1 and n = 1 and (select min_hours from sub_tier_definitions where id = '1B') = 12 then 'ok  ' else 'FAIL' end,
    x, (select min_hours from sub_tier_definitions where id = '1B'), n0, n) || E'\n';

  -- T9 bad values are refused
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ad, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := 0;
  begin perform public.admin_save_sub_tier('1B', 1, 0, 0, 0, 0, 0, 0, 0, 30); exception when others then n := n + 1; end;
  begin perform public.admin_save_sub_tier('1B', 1, 85, 0, 6, 0, 0, 0, 0, 30); exception when others then n := n + 1; end;
  begin perform public.admin_save_sub_tier('1B', 1, 85, 0, 4.5, 120, 0, 0, 0, 30); exception when others then n := n + 1; end;
  begin perform public.admin_save_sub_tier('1B', 1, 85, 0, 4.5, 0, 0, 0, 0, 130); exception when others then n := n + 1; end;
  begin perform public.admin_save_sub_tier('1B', 1, 85, -1, 4.5, 0, 0, 0, 0, 30); exception when others then n := n + 1; end;
  begin perform public.admin_save_sub_tier('1B', 99, 85, 0, 4.5, 0, 0, 0, 0, 30); exception when others then n := n + 1; end;
  begin perform public.admin_save_sub_tier('bad', 1, 85, 0, 4.5, 0, 0, 0, 0, 30); exception when others then n := n + 1; end;
  reset role;
  select max_allowed_rate into x from sub_tier_definitions where id = '1B';
  r := r || format('%s T9 seven bad saves refused (%s of 7), 1B unchanged at R%s', case when n = 7 and x = 85 then 'ok  ' else 'FAIL' end, n, x) || E'\n';

  -- T10 editing a tier
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ad, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_save_tier(1, 'Rising Tutors', 'New to Tutorlage, building their record.', 50, 150, 30);
  begin perform public.admin_save_tier(1, 'x', 'q', 50, 150, 30); s := 'DONE'; exception when others then s := sqlerrm; end;
  begin perform public.admin_save_tier(1, 'Name', 'q', 150, 50, 30); s2 := 'DONE'; exception when others then s2 := sqlerrm; end;
  reset role;
  r := r || format('%s T10 a tier''s words changed and logged; a one-letter name (%s) and rates the wrong way round (%s) are refused',
    case when s = 'A tier needs a name' and s2 like 'The rates must be numbers%' and (select count(*) from tier_definitions where id = 1 and positioning_quote = 'New to Tutorlage, building their record.') = 1 then 'ok  ' else 'FAIL' end, s, s2) || E'\n';

  -- T11 credential definitions: a new one is saved; its holders move when its level changes; it cannot be deleted while held; a free one can
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ad, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.admin_save_credential_definition('other_platform_pro', 'Top-rated on another tutoring platform', '1D', null, 'Seen on their profile');
  cid := public.admin_record_credential(t2, 'other_platform_pro', current_date, null, 'Profile seen');
  select current_sub_tier_id into s from tutor_profiles where id = t2;
  perform public.admin_save_credential_definition('other_platform_pro', 'Top-rated on another tutoring platform', '2A', null, 'Seen on their profile');
  reset role;
  select current_sub_tier_id into s2 from tutor_profiles where id = t2;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ad, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.admin_delete_credential_definition('other_platform_pro'); x := 1; exception when others then x := 0; end;
  perform public.admin_remove_credential(cid, 'Test finished');
  begin perform public.admin_delete_credential_definition('other_platform_pro'); n := 1; exception when others then n := 0; end;
  begin perform public.admin_delete_credential_definition('admin_assigned'); n0 := 1; exception when others then n0 := 0; end;
  reset role;
  r := r || format('%s T11 a new credential at 1D put the tutor at %s, moved to 2A they are at %s; delete refused while held (%s), allowed once free (%s), the built-in one protected (%s) (want 1D, 2A, refused, allowed, protected)',
    case when s = '1D' and s2 = '2A' and x = 0 and n = 1 and n0 = 0 then 'ok  ' else 'FAIL' end, s, s2,
    case when x = 0 then 'refused' else 'DELETED' end, case when n = 1 then 'allowed' else 'REFUSED' end, case when n0 = 0 then 'protected' else 'DELETED' end) || E'\n';

  -- T12 recalculating everyone returns how many tutors there are
  perform set_config('request.jwt.claims', jsonb_build_object('sub', ad, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := public.admin_recalculate_all_tiers();
  reset role;
  select count(*) into n0 from tutor_profiles;
  r := r || format('%s T12 recalculate everyone: %s tutors worked out of %s (want equal)', case when n = n0 then 'ok  ' else 'FAIL' end, n, n0) || E'\n';

  -- T13 every change left exactly one audit row: assign x3, clear x1, record x2, remove x2, level saves x2, tier save x1, credential
  -- saves x2, credential delete x1, recalculate x1 = 15 (refused calls leave none). All of it is in this one transaction, so the
  -- rows are the ones with this transaction's time.
  select count(*) into n from admin_audit_logs where created_at = now();
  r := r || format('%s T13 audit rows written by this run: %s (want 15)', case when n = 15 then 'ok  ' else 'FAIL' end, n) || E'\n';

  select (length(r) - length(replace(r, E'\nok  ', ''))) / length(E'\nok  '),
         (length(r) - length(replace(r, E'\nFAIL', ''))) / length(E'\nFAIL')
    into nok, nfail;
  raise exception 'TIER ROLES TEST (rolled back): % ok, % FAIL%', nok, nfail, r;
end $$;
