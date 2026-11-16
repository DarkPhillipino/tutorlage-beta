-- Rolled-back test of 20261116200300_verification_documents_and_audits_admin_rights.sql (P2 security round 2, 16 Nov 2026): tutor_verification_documents and tutor_verification_audits
-- Run the migration together with this file in one rolled-back statement (migration first):
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/verification_documents_and_audits_admin_rights.sql supabase/migrations/20261116200300_verification_documents_and_audits_admin_rights.sql
-- or, once the migration is applied, paste this file alone. Fixtures are made-up people (example.invalid) inserted as the owner; every line ends "ok" or
-- "FAIL (want ...)"; the block raises an error at the end on purpose so nothing is kept. Words used in the answers: S = refused "only a super admin",
-- V = refused "only a verification officer or a super admin", A = refused "Admins only", D = permission denied, H = held by a column guard, ran = it ran.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  v_sa uuid := gen_random_uuid();    -- super_admin
  v_fm uuid := gen_random_uuid();    -- finance_manager
  v_su uuid := gen_random_uuid();    -- support_agent
  v_vo uuid := gen_random_uuid();    -- verification_officer
  v_of uuid := gen_random_uuid();    -- a super_admin whose access is switched off
  v_l  uuid := gen_random_uuid();    -- an adult learner
  v_t  uuid := gen_random_uuid();    -- a tutor
  v_o  uuid := gen_random_uuid();    -- a stranger
  d uuid; d2 uuid; a uuid;
  t text; nfail int; nlines int;
begin
  begin

  execute $mk$
    create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
      select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
             || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
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
    create function pg_temp.as_service(p_sql text) returns text language plpgsql as $f$
    declare v text;
    begin
      set local role service_role;
      begin
        execute p_sql into v;
        reset role;
        return coalesce(v, 'null');
      exception when others then
        reset role;
        return 'ERR: ' || sqlerrm;
      end;
    end $f$ $mk$;
  -- "refused": the statement raised a real error (true) or ran (false). A plain INSERT run through EXECUTE ... INTO always ends in the error
  -- "INTO used with a command that cannot return data", so a test that wants an INSERT to SUCCEED must write it as a data-modifying CTE with RETURNING.
  execute $mk$
    create function pg_temp.refused(p_u uuid, p_sql text) returns text language sql as $f$
      select (a.res like 'ERR:%' and a.res not like 'ERR: INTO used%')::text from (select pg_temp.run_as(p_u, p_sql) as res) a $f$ $mk$;
  -- "changed nothing": 0 rows or refused
  execute $mk$
    create function pg_temp.nowrite(p_u uuid, p_sql text) returns text language sql as $f$
      select (a.res = '0' or a.res like 'ERR:%')::text from (select pg_temp.run_as(p_u, p_sql) as res) a $f$ $mk$;
  -- one word per answer: S = "only a super admin", V = "only a verification officer or a super admin", A = "Admins only", D = permission denied,
  -- H = held by a column guard, ran = it ran, E[...] = anything else
  execute $mk$
    create function pg_temp.classify(v text) returns text language sql as $f$
      select case when v like 'ERR: Only a super admin%' then 'S'
                  when v like 'ERR: Only a verification officer%' then 'V'
                  when v like 'ERR: Admins only%' then 'A'
                  when v like 'ERR: permission denied%' then 'D'
                  when v like 'ERR: Level, hours, rating%' or v like 'ERR: A dispute%' or v like 'ERR: Only Tutorlage can change%' then 'H'
                  when v like 'ERR:%' then 'E[' || left(substr(v, 6), 60) || ']'
                  else 'ran' end $f$ $mk$;
  execute $mk$
    create function pg_temp.verdict(p_u uuid, p_sql text) returns text language sql as $f$
      select pg_temp.classify(pg_temp.run_as(p_u, p_sql)) $f$ $mk$;
  -- rows changed, or the one word when it was refused
  execute $mk$
    create function pg_temp.rw(p_u uuid, p_sql text) returns text language sql as $f$
      select case when a.res like 'ERR:%' then pg_temp.classify(a.res) else a.res end from (select pg_temp.run_as(p_u, p_sql) as res) a $f$ $mk$;

  -- ---- people (all made up, example.invalid; inserted as the owner) -------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_sa, z, 'authenticated', 'authenticated', 'r2.sa.' || v_sa || '@example.invalid', jsonb_build_object('first_name', 'Sue', 'surname', 'Super', 'date_of_birth', adult), '{}'),
    (v_fm, z, 'authenticated', 'authenticated', 'r2.fm.' || v_fm || '@example.invalid', jsonb_build_object('first_name', 'Fin', 'surname', 'Manager', 'date_of_birth', adult), '{}'),
    (v_su, z, 'authenticated', 'authenticated', 'r2.su.' || v_su || '@example.invalid', jsonb_build_object('first_name', 'Sam', 'surname', 'Support', 'date_of_birth', adult), '{}'),
    (v_vo, z, 'authenticated', 'authenticated', 'r2.vo.' || v_vo || '@example.invalid', jsonb_build_object('first_name', 'Vera', 'surname', 'Officer', 'date_of_birth', adult), '{}'),
    (v_of, z, 'authenticated', 'authenticated', 'r2.of.' || v_of || '@example.invalid', jsonb_build_object('first_name', 'Olly', 'surname', 'Off', 'date_of_birth', adult), '{}'),
    (v_l,  z, 'authenticated', 'authenticated', 'r2.l.'  || v_l  || '@example.invalid', jsonb_build_object('first_name', 'Lee', 'surname', 'Learner', 'date_of_birth', adult), '{}'),
    (v_t,  z, 'authenticated', 'authenticated', 'r2.t.'  || v_t  || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tess', 'surname', 'Tutor', 'date_of_birth', adult), '{}'),
    (v_o,  z, 'authenticated', 'authenticated', 'r2.o.'  || v_o  || '@example.invalid', jsonb_build_object('first_name', 'Otto', 'surname', 'Other', 'date_of_birth', adult), '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (v_sa, 'Sue', 'Super', 'r2.sa.' || v_sa || '@example.invalid', '', 'super_admin', true),
    (v_fm, 'Fin', 'Manager', 'r2.fm.' || v_fm || '@example.invalid', '', 'finance_manager', true),
    (v_su, 'Sam', 'Support', 'r2.su.' || v_su || '@example.invalid', '', 'support_agent', true),
    (v_vo, 'Vera', 'Officer', 'r2.vo.' || v_vo || '@example.invalid', '', 'verification_officer', true),
    (v_of, 'Olly', 'Off', 'r2.of.' || v_of || '@example.invalid', '', 'super_admin', false);
  r := r || 'S0 setup: super admin, finance manager, support agent, verification officer, a switched-off super admin, a learner, a tutor, a stranger' || E'\n';


  insert into public.tutor_verification_documents (tutor_id, document_type, document_url, status) values (v_t, 'identity_doc', v_t || '/zz-id.pdf', 'pending') returning id into d;
  insert into public.tutor_verification_documents (tutor_id, document_type, document_url, status) values (v_t, 'proof_of_address', v_t || '/zz-address.pdf', 'pending') returning id into d2;
  insert into public.tutor_verification_audits (tutor_id, document_id, reviewer_id, decision) values (v_t, d, v_vo, 'under_review') returning id into a;
  r := r || 'S1 setup: two pending documents for the tutor and one audit row' || E'\n';
  -- documents: read, review (rows), delete (rows), insert refused
  execute $mk$
    create function pg_temp.doc_attack(p_u uuid, p_d uuid, p_t uuid) returns text language plpgsql as $f$
    begin
      return array_to_string(array[
        pg_temp.run_as(p_u, format('select count(*)::text from public.tutor_verification_documents where id = %L', p_d)),
        pg_temp.run_as(p_u, format($q$with u as (update public.tutor_verification_documents set status = 'verified', admin_notes = 'checked', reviewed_at = now() where id = %L returning 1) select count(*)::text from u$q$, p_d)),
        pg_temp.run_as(p_u, format('with d as (delete from public.tutor_verification_documents where id = %L returning 1) select count(*)::text from d', p_d)),
        pg_temp.refused(p_u, format($q$insert into public.tutor_verification_documents (tutor_id, document_type, document_url) values (%L, 'identity_doc', %L)$q$, p_t, p_t || '/zz-new.pdf'))
      ], ' ');
    end $f$ $mk$;
  -- audits: read, update (rows), delete (rows), add one in own name refused?, add one in another person's name refused?
  execute $mk$
    create function pg_temp.audit_attack(p_u uuid, p_a uuid, p_t uuid, p_d uuid, p_other uuid) returns text language plpgsql as $f$
    begin
      return array_to_string(array[
        pg_temp.run_as(p_u, format('select count(*)::text from public.tutor_verification_audits where id = %L', p_a)),
        pg_temp.run_as(p_u, format($q$with u as (update public.tutor_verification_audits set decision = 'verified' where id = %L returning 1) select count(*)::text from u$q$, p_a)),
        pg_temp.run_as(p_u, format('with d as (delete from public.tutor_verification_audits where id = %L returning 1) select count(*)::text from d', p_a)),
        pg_temp.refused(p_u, format($q$with i as (insert into public.tutor_verification_audits (tutor_id, document_id, reviewer_id, decision) values (%L, %L, %L, 'verified') returning 1) select count(*)::text from i$q$, p_t, p_d, p_u)),
        pg_temp.refused(p_u, format($q$with i as (insert into public.tutor_verification_audits (tutor_id, document_id, reviewer_id, decision) values (%L, %L, %L, 'verified') returning 1) select count(*)::text from i$q$, p_t, p_d, p_other))
      ], ' ');
    end $f$ $mk$;
  r := r || pg_temp.chk('A1', 'documents, SUPPORT AGENT: reads 0, reviews 0, deletes 0, insert refused', pg_temp.doc_attack(v_su, d, v_t), '0 0 0 true');
  r := r || pg_temp.chk('A2', 'documents, FINANCE MANAGER: the same', pg_temp.doc_attack(v_fm, d, v_t), '0 0 0 true');
  r := r || pg_temp.chk('A3', 'documents, SWITCHED-OFF super admin: the same', pg_temp.doc_attack(v_of, d, v_t), '0 0 0 true');
  r := r || pg_temp.chk('A4', 'documents, a stranger and a signed-out caller: the same', pg_temp.doc_attack(v_o, d, v_t) || ' / ' || regexp_replace(pg_temp.doc_attack(null, d, v_t), 'ERR: permission denied for table [a-z_]+', '0', 'g'), '0 0 0 true / 0 0 0 true');
  select status::text into t from public.tutor_verification_documents where id = d;
  r := r || pg_temp.chk('A5', 'the document is still pending after all those attempts', t, 'pending');
  r := r || pg_temp.chk('A6', 'documents, VERIFICATION OFFICER: reads 1, reviews 1, deletes 0, insert refused', pg_temp.doc_attack(v_vo, d, v_t), '1 1 0 true');
  select status::text || ' ' || coalesce(admin_notes, '-') into t from public.tutor_verification_documents where id = d;
  r := r || pg_temp.chk('A7', 'and the review is stored (verified, checked)', t, 'verified checked');
  r := r || pg_temp.chk('A8', 'documents, SUPER ADMIN: reads 1, reviews 1 (on the second document), deletes 0, insert refused', pg_temp.doc_attack(v_sa, d2, v_t), '1 1 0 true');
  r := r || pg_temp.chk('A9', 'audits, SUPPORT AGENT: reads 0, changes 0, deletes 0, adds refused, impersonating refused', pg_temp.audit_attack(v_su, a, v_t, d, v_vo), '0 0 0 true true');
  r := r || pg_temp.chk('A10', 'audits, FINANCE MANAGER: the same', pg_temp.audit_attack(v_fm, a, v_t, d, v_vo), '0 0 0 true true');
  r := r || pg_temp.chk('A11', 'audits, SWITCHED-OFF super admin: the same', pg_temp.audit_attack(v_of, a, v_t, d, v_vo), '0 0 0 true true');
  r := r || pg_temp.chk('A12', 'audits, VERIFICATION OFFICER: reads 1, changes 0, deletes 0, adds one in their own name (false = allowed), impersonating refused', pg_temp.audit_attack(v_vo, a, v_t, d, v_sa), '1 0 0 false true');
  r := r || pg_temp.chk('A13', 'audits, SUPER ADMIN: the same', pg_temp.audit_attack(v_sa, a, v_t, d, v_vo), '1 0 0 false true');
  select decision::text into t from public.tutor_verification_audits where id = a;
  r := r || pg_temp.chk('A14', 'the old audit row is unchanged (under_review)', t, 'under_review');
  select count(*)::text into t from public.tutor_verification_audits where tutor_id = v_t;
  r := r || pg_temp.chk('A15', 'audit rows for the tutor: the original and the two own-name additions (3), none in another name', t, '3');

  r := r || pg_temp.chk('B1', 'the tutor still reads their own two documents (2) and a stranger reads none (0)',
    pg_temp.run_as(v_t, format('select count(*)::text from public.tutor_verification_documents where tutor_id = %L', v_t)) || ' ' ||
    pg_temp.run_as(v_o, format('select count(*)::text from public.tutor_verification_documents where tutor_id = %L', v_t)), '2 0');
  update public.tutor_verification_documents set status = 'pending', admin_notes = null, reviewed_at = null where id = d2;
  r := r || pg_temp.chk('B2', 'the tutor cannot review their own document (the column guard says so)',
    pg_temp.verdict(v_t, format($q$with u as (update public.tutor_verification_documents set status = 'verified' where id = %L returning 1) select count(*)::text from u$q$, d2)), 'E[Only Tutorlage can review documents]');
  select status::text into t from public.tutor_verification_documents where id = d2;
  r := r || pg_temp.chk('B3', 'and it is still pending', t, 'pending');
  r := r || pg_temp.chk('B4', 'the tutor can still remove their own UNVERIFIED document (1 row)',
    pg_temp.run_as(v_t, format('with d as (delete from public.tutor_verification_documents where id = %L returning 1) select count(*)::text from d', d2)), '1');

  select coalesce(string_agg(tablename || ':' || policyname || ':' || cmd, ' | ' order by tablename, policyname), '(none)') into t from pg_policies
    where schemaname = 'public' and tablename in ('tutor_verification_documents', 'tutor_verification_audits') and policyname not like 'Tutors%' and policyname not like 'Founding%';
  r := r || pg_temp.chk('P1', 'the admin policies on the two tables (the tutors'' own and the founding gate are not listed)', t,
    'tutor_verification_audits:Verification staff add audits:INSERT | tutor_verification_audits:Verification staff read audits:SELECT | ' ||
    'tutor_verification_documents:Verification staff read documents:SELECT | tutor_verification_documents:Verification staff review documents:UPDATE');
  select coalesce(string_agg(p2.proname, ',' order by p2.proname), '(none)') into t from pg_proc p2
    where p2.pronamespace = 'public'::regnamespace and p2.prokind = 'f' and not p2.prosecdef and p2.prorettype <> 'trigger'::regtype
      and p2.prosrc ~* '(update|insert\s+into|delete\s+from)\s+(public\.)?(tutor_verification_documents|tutor_verification_audits)\y';
  r := r || pg_temp.chk('X1', 'functions that write these tables and are NOT security definer', t, '(none)');

  exception when others then
    r := r || 'UNEXPECTED ERROR FAIL: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'VERIFICATION DOCUMENTS TEST (rolled back): % lines, % FAIL\n%', nlines, nfail, r;
end $$;
