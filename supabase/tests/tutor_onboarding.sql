-- Rolled-back test of master 7cx (migrations 20261013180000 and 20261013180100). See README.md.
-- Tutor onboarding: the tutor's kind (beginner / experienced), the consent record, and the rule that a verified
-- document can't be changed or erased by the tutor (the table and the stored files).
-- The new enum value 'proof_of_experience' can't be used in the same transaction that adds it, so it is checked
-- separately after the migration is applied (see the last lines of this file).
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  v_t1 uuid := gen_random_uuid();
  v_t2 uuid := gen_random_uuid();
  v_learner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_cnt int;
  v_txt text;
  v_ts timestamptz;
  v_ident uuid;
  v_pol uuid;
  v_res uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_t1, z, 'authenticated', 'authenticated', 'o.t1.' || v_t1 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'T', 'surname', 'One', 'date_of_birth', (current_date - interval '25 years')::date), '{}'),
    (v_t2, z, 'authenticated', 'authenticated', 'o.t2.' || v_t2 || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'T', 'surname', 'Two', 'date_of_birth', (current_date - interval '26 years')::date), '{}'),
    (v_learner, z, 'authenticated', 'authenticated', 'o.l.' || v_learner || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'L', 'surname', 'Learner', 'date_of_birth', (current_date - interval '21 years')::date), '{}'),
    (v_admin, z, 'authenticated', 'authenticated', 'o.a.' || v_admin || '@example.invalid', '{}'::jsonb, '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number) values (v_admin, 'T', 'Admin', 'x@example.invalid', '');

  -- Migration step 2: tutors that existed before are grandfathered; the two new test tutors are not.
  select count(*) into v_cnt from tutor_onboarding where tutor_id in (v_t1, v_t2);
  r := r || format('O0 new tutors start with no onboarding row: %s (want 0)', v_cnt) || E'\n';
  select count(*) into v_cnt from tutor_profiles p where p.id not in (v_t1, v_t2) and not exists (select 1 from tutor_onboarding o where o.tutor_id = p.id and o.grandfathered);
  -- (O0b only means something when this file runs in the same transaction as the migration, or right after it is
  -- applied and before any real tutor signs up: tutors who sign up later are, correctly, not grandfathered.)
  r := r || format('O0b every tutor that existed before is grandfathered; not grandfathered: %s (want 0)', v_cnt) || E'\n';

  -- ---- tutor 1 chooses a kind -------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_my_tutor_track('beginner');
  select track || '/' || grandfathered::text into v_txt from tutor_onboarding where tutor_id = v_t1;
  r := r || format('O1 tutor picks beginner -> %s (want beginner/false)', v_txt) || E'\n';
  perform public.set_my_tutor_track('experienced');
  select track into v_txt from tutor_onboarding where tutor_id = v_t1;
  r := r || format('O1b the tutor can change their mind -> %s (want experienced)', v_txt) || E'\n';

  begin
    perform public.set_my_tutor_track('expert');
    r := r || 'O2 FAIL: an unknown kind was accepted' || E'\n';
  exception when others then
    r := r || format('O2 unknown kind refused: %s', sqlerrm) || E'\n';
  end;

  begin
    perform public.record_my_documents_consent('2026-10-13-draft');
    select consent_version, consented_at into v_txt, v_ts from tutor_onboarding where tutor_id = v_t1;
    r := r || format('O3 consent recorded: version=%s, time within 5s of the database clock=%s (want 2026-10-13-draft, true)', v_txt, abs(extract(epoch from (now() - v_ts))) < 5) || E'\n';
  end;

  begin
    perform public.record_my_documents_consent('   ');
    r := r || 'O3b FAIL: a blank consent version was accepted' || E'\n';
  exception when others then
    r := r || format('O3b blank consent version refused: %s', sqlerrm) || E'\n';
  end;

  -- Direct writes are not allowed: only the two functions write the table.
  begin
    update tutor_onboarding set consented_at = now() - interval '1 year', grandfathered = true where tutor_id = v_t1;
    r := r || 'O4 FAIL: a tutor updated the onboarding table directly' || E'\n';
  exception when others then
    r := r || format('O4 direct update refused: %s', sqlerrm) || E'\n';
  end;
  begin
    insert into tutor_onboarding (tutor_id, grandfathered) values (v_t2, true);
    r := r || 'O4b FAIL: a tutor inserted into the onboarding table directly' || E'\n';
  exception when others then
    r := r || format('O4b direct insert refused: %s', sqlerrm) || E'\n';
  end;
  begin
    delete from tutor_onboarding where tutor_id = v_t1;
    r := r || 'O4c FAIL: a tutor deleted from the onboarding table directly' || E'\n';
  exception when others then
    r := r || format('O4c direct delete refused: %s', sqlerrm) || E'\n';
  end;

  -- Consent needs a kind first.
  perform set_config('request.jwt.claims', json_build_object('sub', v_t2, 'role', 'authenticated')::text, true);
  begin
    perform public.record_my_documents_consent('2026-10-13-draft');
    r := r || 'O5 FAIL: consent recorded before choosing a kind' || E'\n';
  exception when others then
    r := r || format('O5 consent before choosing a kind refused: %s', sqlerrm) || E'\n';
  end;

  -- Tutor 2 can't see tutor 1's row.
  select count(*) into v_cnt from tutor_onboarding;
  r := r || format('O6 tutor 2 sees only their own rows (none yet): %s (want 0)', v_cnt) || E'\n';

  -- A learner can't use the functions.
  perform set_config('request.jwt.claims', json_build_object('sub', v_learner, 'role', 'authenticated')::text, true);
  begin
    perform public.set_my_tutor_track('beginner');
    r := r || 'O7 FAIL: a learner chose a tutor type' || E'\n';
  exception when others then
    r := r || format('O7 a learner is refused: %s', sqlerrm) || E'\n';
  end;

  -- Signed out can't use them either.
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform public.set_my_tutor_track('beginner');
    r := r || 'O8 FAIL: a signed-out caller chose a tutor type' || E'\n';
  exception when others then
    r := r || format('O8 signed-out refused: %s', sqlerrm) || E'\n';
  end;
  reset role;

  -- ---- documents: tutor 1 adds, then Tutorlage verifies, then the tutor can't touch them ---------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into tutor_verification_documents (tutor_id, document_type, document_url, issued_on)
    values (v_t1, 'identity_doc', v_t1 || '/id.png', null) returning id into v_ident;
  insert into tutor_verification_documents (tutor_id, document_type, document_url, issued_on)
    values (v_t1, 'police_clearance', v_t1 || '/police.pdf', current_date - 20) returning id into v_pol;
  insert into tutor_verification_documents (tutor_id, document_type, document_url)
    values (v_t1, 'subject_results', v_t1 || '/results.jpg') returning id into v_res;
  select count(*) into v_cnt from tutor_verification_documents where tutor_id = v_t1 and status = 'pending';
  r := r || format('D1 three documents added, all pending: %s (want 3)', v_cnt) || E'\n';
  select (issued_on = current_date - 20)::text into v_txt from tutor_verification_documents where id = v_pol;
  r := r || format('D2 the police certificate keeps its issue date: %s (want true)', v_txt) || E'\n';

  -- A tutor can't add a document for someone else.
  begin
    insert into tutor_verification_documents (tutor_id, document_type, document_url) values (v_t2, 'identity_doc', v_t2 || '/id.png');
    r := r || 'D3 FAIL: a tutor added a document to another tutor' || E'\n';
  exception when others then
    r := r || format('D3 adding to another tutor refused: %s', sqlerrm) || E'\n';
  end;

  -- Unreviewed documents can be removed or replaced by their owner.
  delete from tutor_verification_documents where id = v_res;
  get diagnostics v_cnt = row_count;
  r := r || format('D4 the tutor can remove an unreviewed document: rows=%s (want 1)', v_cnt) || E'\n';
  update tutor_verification_documents set document_url = v_t1 || '/id2.png' where id = v_ident;
  get diagnostics v_cnt = row_count;
  r := r || format('D5 the tutor can replace an unreviewed document: rows=%s (want 1)', v_cnt) || E'\n';

  -- Tutorlage verifies the ID and the police certificate.
  reset role;
  update tutor_verification_documents set status = 'verified', reviewed_at = now() where id in (v_ident, v_pol);

  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from tutor_verification_documents where id = v_ident;
  get diagnostics v_cnt = row_count;
  r := r || format('D6 the tutor can NOT delete a verified ID: rows=%s (want 0)', v_cnt) || E'\n';
  update tutor_verification_documents set document_url = v_t1 || '/other-person.png' where id = v_ident;
  get diagnostics v_cnt = row_count;
  r := r || format('D7 the tutor can NOT swap a verified ID for another file: rows=%s (want 0)', v_cnt) || E'\n';
  update tutor_verification_documents set status = 'verified' where id = v_pol;
  get diagnostics v_cnt = row_count;
  r := r || format('D8 the tutor can NOT touch a verified police certificate at all: rows=%s (want 0)', v_cnt) || E'\n';
  select count(*) into v_cnt from tutor_verification_documents where id = v_ident and document_url = v_t1 || '/id2.png' and status = 'verified';
  r := r || format('D9 the verified ID is exactly as Tutorlage verified it: %s (want 1)', v_cnt) || E'\n';
  insert into tutor_verification_documents (tutor_id, document_type, document_url, issued_on)
    values (v_t1, 'police_clearance', v_t1 || '/police-renewed.pdf', current_date);
  select count(*) into v_cnt from tutor_verification_documents where tutor_id = v_t1 and document_type = 'police_clearance';
  r := r || format('D10 a renewed police certificate is added alongside the old one: %s on file (want 2)', v_cnt) || E'\n';

  -- Another tutor can't touch tutor 1's documents (they can't even see them).
  perform set_config('request.jwt.claims', json_build_object('sub', v_t2, 'role', 'authenticated')::text, true);
  delete from tutor_verification_documents where tutor_id = v_t1;
  get diagnostics v_cnt = row_count;
  r := r || format('D11 another tutor deletes tutor 1''s documents: rows=%s (want 0)', v_cnt) || E'\n';
  select count(*) into v_cnt from tutor_verification_documents where tutor_id = v_t1;
  r := r || format('D12 another tutor can''t read them: %s (want 0)', v_cnt) || E'\n';
  reset role;

  -- ---- the stored files ----------------------------------------------------------------------------------------------
  insert into storage.objects (bucket_id, name) values
    ('tutor-documents', v_t1 || '/id2.png'),          -- used by the verified ID
    ('tutor-documents', v_t1 || '/police-renewed.pdf'), -- used by an unreviewed document
    ('tutor-documents', v_t1 || '/orphan.png');       -- used by nothing (a failed upload)
  -- Supabase refuses direct deletes from storage.objects (storage.protect_delete) unless this setting is on, which is
  -- what the Storage service itself sets; the row-level policy we are testing still applies to the signed-in role.
  perform set_config('storage.allow_delete_query', 'true', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from storage.objects where bucket_id = 'tutor-documents' and name = v_t1 || '/id2.png';
  get diagnostics v_cnt = row_count;
  r := r || format('S1 the tutor can NOT delete the file behind a verified ID: rows=%s (want 0)', v_cnt) || E'\n';
  delete from storage.objects where bucket_id = 'tutor-documents' and name = v_t1 || '/police-renewed.pdf';
  get diagnostics v_cnt = row_count;
  r := r || format('S2 the tutor can delete a file that is not verified: rows=%s (want 1)', v_cnt) || E'\n';
  delete from storage.objects where bucket_id = 'tutor-documents' and name = v_t1 || '/orphan.png';
  get diagnostics v_cnt = row_count;
  r := r || format('S3 the tutor can delete an unused file: rows=%s (want 1)', v_cnt) || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', v_t2, 'role', 'authenticated')::text, true);
  delete from storage.objects where bucket_id = 'tutor-documents' and name = v_t1 || '/id2.png';
  get diagnostics v_cnt = row_count;
  r := r || format('S4 another tutor can NOT delete tutor 1''s file: rows=%s (want 0)', v_cnt) || E'\n';
  reset role;

  -- ---- admin sees everything -------------------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from tutor_onboarding where tutor_id in (v_t1, v_t2);
  r := r || format('A1 an admin reads the onboarding rows: %s (want 1: only tutor 1 has one)', v_cnt) || E'\n';
  select count(*) into v_cnt from tutor_verification_documents where tutor_id = v_t1;
  r := r || format('A2 an admin reads the documents: %s (want 3 at this point: id, police, renewed police)', v_cnt) || E'\n';
  update tutor_verification_documents set status = 'rejected', admin_notes = 'blurry' where id = v_pol;
  get diagnostics v_cnt = row_count;
  r := r || format('A3 an admin can still review (reject) a document: rows=%s (want 1)', v_cnt) || E'\n';
  reset role;

  raise exception 'TUTOR ONBOARDING TEST (rolled back): %', r;
end $$;

-- After the migration is applied, check the new enum value in its own rolled-back run:
--   do $$ declare t uuid := gen_random_uuid(); n int; begin
--     insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
--       values (t, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'o.' || t || '@example.invalid', '{"role":"tutor"}', '{}');
--     insert into tutor_verification_documents (tutor_id, document_type, document_url) values (t, 'proof_of_experience', 'https://example.org/profile');
--     select count(*) into n from tutor_verification_documents where tutor_id = t and document_type = 'proof_of_experience';
--     raise exception 'PROOF OF EXPERIENCE (rolled back): rows=% (want 1)', n; end $$;
