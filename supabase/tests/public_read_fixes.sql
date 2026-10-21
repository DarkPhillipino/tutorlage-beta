-- Rolled-back test of the public read fixes (migration 20261020170000_public_read_fixes; review findings M1, M2, m1, m8, m9, m14).
-- Run it TOGETHER with the migration in one statement (scripts/run-rolled-back-test.mjs) before the migration is applied, or on its
-- own after. Every refusal must be the database's own "permission denied" (or the guard's sentence), so a refusal for the wrong
-- reason shows as FAIL. Lines are short on purpose: the Supabase tool cuts a long answer in the middle. See README.md.
do $$
declare
  r text := E'\n';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  v_ta uuid := gen_random_uuid();   -- verified tutor, frozen, with a secret reason
  v_tb uuid := gen_random_uuid();   -- tutor who is not verified
  v_l uuid := gen_random_uuid();    -- learner who reviewed tutor A
  v_m uuid := gen_random_uuid();    -- another learner (reviewed tutor B)
  v_adm uuid := gen_random_uuid();
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_d uuid;
  q text; n int; n2 int; n3 int; t text; t2 text; bl boolean; nfail int; rep text;
  dash text := 'id, headline, hourly_rate, currency_code, is_verified, onboarding_status, avg_rating, total_reviews_count, total_completed_hours, total_sessions_completed, teaching_mode, is_dispatch_active, current_sub_tier_id, repeat_student_rate_pct, avg_grade_uplift_pct, qualified_uplift_students_count, institution_id';
  srch text := 'id, headline, hourly_rate, currency_code, is_verified, avg_rating, total_reviews_count, teaching_mode, is_dispatch_active, total_sessions_completed, current_tier_id, institution_id';
  hidden text[] := array['select tier_frozen from public.tutor_profiles', 'select freeze_reason from public.tutor_profiles',
    'select fast_track_status from public.tutor_profiles', 'select fast_track_proof_url from public.tutor_profiles',
    'select credential_floor_sub_tier_id from public.tutor_profiles', 'select * from public.tutor_profiles'];
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (v_ta, z, 'authenticated', 'authenticated', 'p.ta.' || v_ta || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tia'), '{}'),
    (v_tb, z, 'authenticated', 'authenticated', 'p.tb.' || v_tb || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tob'), '{}'),
    (v_l, z, 'authenticated', 'authenticated', 'p.l.' || v_l || '@example.invalid', jsonb_build_object('first_name', 'Lee', 'date_of_birth', adult), '{}'),
    (v_m, z, 'authenticated', 'authenticated', 'p.m.' || v_m || '@example.invalid', jsonb_build_object('first_name', 'Max', 'date_of_birth', adult), '{}'),
    (v_adm, z, 'authenticated', 'authenticated', 'p.a.' || v_adm || '@example.invalid', '{}'::jsonb, '{}');
  insert into admin_profiles (id, first_name, surname, email, phone_number) values (v_adm, 'T', 'Admin', 'x@example.invalid', '');
  update profiles set date_of_birth = adult::date where id = v_ta;
  update tutor_profiles set is_verified = true, tier_frozen = true, freeze_reason = 'SECRET-REASON', fast_track_proof_url = 'SECRET-PROOF' where id = v_ta;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status)
    values (v_l, v_ta, v_l, now() - interval '3 days', 100, 20, 100, 80, 'completed') returning id into v_s1;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status)
    values (v_m, v_tb, v_m, now() - interval '3 days', 100, 20, 100, 80, 'completed') returning id into v_s2;
  insert into sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status)
    values (v_l, v_ta, v_l, now() - interval '2 days', 100, 20, 100, 80, 'completed') returning id into v_s3;
  insert into reviews (session_id, tutor_id, student_id, rating, comment) values (v_s1, v_ta, v_l, 5, 'Great lessons'), (v_s2, v_tb, v_m, 4, 'Good');
  insert into notifications (profile_id, type, title, body) values (v_l, 'test', 'Title L', 'Body L'), (v_ta, 'test', 'Title A', 'Body A');
  insert into conversations (student_id, tutor_id) values (v_m, v_ta);
  r := r || 'S0 setup: tutor A frozen, 2 reviews, 2 notices, 1 chat' || E'\n';

  -- ============ M2: reviews =============================================================================================
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  n := 0;
  foreach q in array array['select student_id from public.reviews', 'select session_id from public.reviews', 'select * from public.reviews', 'select id, rating from public.reviews'] loop
    begin execute q; exception when others then
      if sqlerrm ilike 'permission denied%' then n := n + 1; else r := r || 'R1 FAIL other error: ' || left(sqlerrm, 50) || E'\n'; end if; end;
  end loop;
  r := r || format('R1 %s signed out: reviews table refused %s of 4', case when n = 4 then 'ok' else 'FAIL' end, n) || E'\n';
  select count(*), min(x.comment), min(x.rating) into n, t, n2 from public.public_tutor_reviews(v_ta) x;
  r := r || format('R2 %s signed out: review list for tutor A rows=%s comment=%s rating=%s', case when n = 1 and t = 'Great lessons' and n2 = 5 then 'ok' else 'FAIL' end, n, t, n2) || E'\n';
  select string_agg(k, ',' order by k) into t from (select to_jsonb(x) j from public.public_tutor_reviews(v_ta) x limit 1) y, jsonb_object_keys(y.j) k;
  r := r || format('R3 %s the list has only %s', case when t = 'comment,created_at,id,rating' then 'ok' else 'FAIL' end, t) || E'\n';
  select count(*) into n from public.public_tutor_reviews(v_tb);
  r := r || format('R4 %s signed out: unverified tutor B list rows=%s (want 0)', case when n = 0 then 'ok' else 'FAIL' end, n) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.public_tutor_reviews(v_ta);
  select count(*) into n2 from public.reviews where tutor_id = v_ta;
  r := r || format('R5 %s other learner: list for A=%s (want 1), table rows about A=%s (want 0)', case when n = 1 and n2 = 0 then 'ok' else 'FAIL' end, n, n2) || E'\n';
  select count(*) into n from public.reviews;
  r := r || format('R6 %s learner reads only own reviews: %s (want 1)', case when n = 1 then 'ok' else 'FAIL' end, n) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.reviews where tutor_id = v_ta;
  begin
    insert into public.reviews (session_id, tutor_id, student_id, rating, comment) values (v_s3, v_ta, v_l, 3, 'Fine');
    get diagnostics n2 = row_count;
  exception when others then n2 := -1; t := sqlerrm; end;
  r := r || format('R7 %s the reviewing learner reads own (%s) and can still submit a review (%s)', case when n = 1 and n2 = 1 then 'ok' else 'FAIL' end, n, n2) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_tb, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.public_tutor_reviews(v_tb);
  select count(*) into n2 from public.reviews;
  r := r || format('R8 %s unverified tutor B sees own reviews: list=%s table=%s (want 1, 1)', case when n = 1 and n2 = 1 then 'ok' else 'FAIL' end, n, n2) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*), round(avg(rating), 2) into n, t from public.reviews;
  r := r || format('R9 %s admin reads every review: %s (want 3), avg %s', case when n = 3 then 'ok' else 'FAIL' end, n, t) || E'\n';
  reset role;

  -- ============ M1: tutor_profiles ======================================================================================
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  n := 0;
  foreach q in array hidden loop
    begin execute q; exception when others then
      if sqlerrm ilike 'permission denied%' then n := n + 1; else r := r || 'P1 FAIL other error: ' || left(sqlerrm, 50) || E'\n'; end if; end;
  end loop;
  r := r || format('P1 %s signed out: 5 internal columns and select * refused %s of 6', case when n = 6 then 'ok' else 'FAIL' end, n) || E'\n';
  execute 'select count(*) from (select ' || srch || ' from public.tutor_profiles where id = $1) x' using v_ta into n;
  execute 'select count(*) from (select ' || srch || ' from public.tutor_profiles where id = $1) x' using v_tb into n2;
  r := r || format('P2 %s signed out: the search columns show verified A=%s (want 1), not B=%s (want 0)', case when n = 1 and n2 = 0 then 'ok' else 'FAIL' end, n, n2) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := 0;
  foreach q in array hidden loop
    begin execute q; exception when others then
      if sqlerrm ilike 'permission denied%' then n := n + 1; else r := r || 'P3 FAIL other error: ' || left(sqlerrm, 50) || E'\n'; end if; end;
  end loop;
  r := r || format('P3 %s learner: the same 6 refused %s of 6', case when n = 6 then 'ok' else 'FAIL' end, n) || E'\n';
  execute 'select count(*) from (select ' || srch || ' from public.tutor_profiles where id = $1) x' using v_ta into n;
  r := r || format('P4 %s learner: the search columns still show tutor A=%s (want 1)', case when n = 1 then 'ok' else 'FAIL' end, n) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_ta, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute 'select count(*) from (select ' || dash || ' from public.tutor_profiles where id = $1) x' using v_ta into n;
  begin
    update public.tutor_profiles set headline = 'Maths for all', is_dispatch_active = true where id = v_ta;
    get diagnostics n2 = row_count;
  exception when others then n2 := -1; end;
  r := r || format('P5 %s tutor A: own dashboard columns read=%s, own headline and online switch saved=%s (want 1, 1)', case when n = 1 and n2 = 1 then 'ok' else 'FAIL' end, n, n2) || E'\n';
  begin
    update public.tutor_profiles set tier_frozen = false where id = v_ta;
    r := r || 'P6 FAIL tutor A unfroze themselves' || E'\n';
  exception when others then
    r := r || format('P6 %s tutor A cannot unfreeze themselves: %s', case when sqlerrm like 'Only Tutorlage can change%' then 'ok' else 'FAIL' end, left(sqlerrm, 40)) || E'\n'; end;
  begin execute 'select freeze_reason from public.tutor_profiles where id = $1' using v_ta;
    r := r || 'P7 FAIL tutor A read own freeze reason' || E'\n';
  exception when others then r := r || format('P7 %s tutor A cannot read own freeze reason (not read by any screen): %s', case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL' end, left(sqlerrm, 30)) || E'\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.tutor_profiles set is_dispatch_active = false, tier_frozen = true, freeze_reason = 'Admin froze B' where id = v_tb returning id into q;
    get diagnostics n = row_count;
  exception when others then n := -1; end;
  begin execute 'select current_sub_tier_id from public.tutor_profiles where id = $1' using v_ta into t; bl := true; exception when others then bl := false; end;
  r := r || format('P8 %s admin: freeze (update returning id) saved=%s (want 1); level column readable=%s', case when n = 1 and bl then 'ok' else 'FAIL' end, n, bl) || E'\n';
  begin execute 'select tier_frozen from public.tutor_profiles where id = $1' using v_ta;
    r := r || 'P9 FAIL admin read the internal column directly' || E'\n';
  exception when others then r := r || format('P9 %s admin direct read of tier_frozen refused (the screen uses the function)', case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL' end) || E'\n'; end;
  select f.tier_frozen, f.freeze_reason, f.fast_track_proof_url into bl, t, t2 from public.admin_tutor_internal_flags(v_ta) f;
  r := r || format('P10 %s admin function gives A''s flags: frozen=%s reason=%s proof=%s', case when bl and t = 'SECRET-REASON' and t2 = 'SECRET-PROOF' then 'ok' else 'FAIL' end, bl, t, t2) || E'\n';
  reset role;

  -- the function refuses everyone but an active admin (learner, tutor, signed out)
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform * from public.admin_tutor_internal_flags(v_ta); n := 0; exception when others then n := case when sqlerrm = 'Admins only' then 1 else 0 end; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ta, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform * from public.admin_tutor_internal_flags(v_ta); n2 := 0; exception when others then n2 := case when sqlerrm = 'Admins only' then 1 else 0 end; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin perform * from public.admin_tutor_internal_flags(v_ta); n3 := 0; exception when others then n3 := case when sqlerrm ilike 'permission denied%' then 1 else 0 end; end;
  reset role;
  r := r || format('P11 %s the function refuses learner=%s tutor=%s signed out=%s (want 1 1 1)', case when n = 1 and n2 = 1 and n3 = 1 then 'ok' else 'FAIL' end, n, n2, n3) || E'\n';

  -- exactly these five columns are hidden from both roles, and nothing else
  select count(*) filter (where has_column_privilege('anon', 'public.tutor_profiles', attname, 'SELECT')),
         count(*) filter (where has_column_privilege('authenticated', 'public.tutor_profiles', attname, 'SELECT')),
         string_agg(attname, ',' order by attname) filter (where not has_column_privilege('anon', 'public.tutor_profiles', attname, 'SELECT')),
         string_agg(attname, ',' order by attname) filter (where not has_column_privilege('authenticated', 'public.tutor_profiles', attname, 'SELECT'))
    into n, n2, t, t2 from pg_attribute where attrelid = 'public.tutor_profiles'::regclass and attnum > 0 and not attisdropped;
  q := 'credential_floor_sub_tier_id,fast_track_proof_url,fast_track_status,freeze_reason,tier_frozen';
  r := r || format('P12 %s readable columns anon=%s signed-in=%s (want 20 20); hidden = %s', case when n = 20 and n2 = 20 and t = q and t2 = q then 'ok' else 'FAIL' end, n, n2, left(coalesce(t, ''), 30)) || E'\n';

  -- ============ m1: messaging tables ====================================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := 0;
  foreach q in array array[
    'insert into public.conversations (student_id, tutor_id) values (''' || v_m || ''', ''' || v_tb || ''')',
    'update public.conversations set session_id = null', 'delete from public.conversations',
    'insert into public.messages (conversation_id, sender_id, body) values (''' || gen_random_uuid() || ''', ''' || v_m || ''', ''hi'')'] loop
    begin execute q; exception when others then
      if sqlerrm ilike 'permission denied%' then n := n + 1; else r := r || 'M1 FAIL other error: ' || left(sqlerrm, 50) || E'\n'; end if; end;
  end loop;
  select count(*) into n2 from public.conversations;
  r := r || format('M1 %s learner: chat insert, update, delete and message insert refused %s of 4; own chat still readable=%s (want 1)', case when n = 4 and n2 = 1 then 'ok' else 'FAIL' end, n, n2) || E'\n';
  reset role;

  -- ============ m9: notifications =======================================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_l, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.notifications set read_at = now() where profile_id = v_l and title = 'Title L';
  get diagnostics n = row_count;
  begin update public.notifications set title = 'Hacked' where profile_id = v_l; t := 'FAIL'; exception when others then t := case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL' end; end;
  begin update public.notifications set body = 'x', read_at = now() where profile_id = v_l; t2 := 'FAIL'; exception when others then t2 := case when sqlerrm ilike 'permission denied%' then 'ok' else 'FAIL' end; end;
  update public.notifications set read_at = now() where profile_id = v_ta;
  get diagnostics n2 = row_count;
  select count(*) into n3 from public.notifications where profile_id = v_l;
  r := r || format('N1 %s owner marks own notice read=%s (want 1), title change %s, body+read_at %s, another''s notice rows=%s (want 0), still reads own=%s',
    case when n = 1 and t = 'ok' and t2 = 'ok' and n2 = 0 and n3 >= 1 then 'ok' else 'FAIL' end, n, t, t2, n2, n3) || E'\n';
  reset role;

  -- ============ m8: document folder =====================================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_ta, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.tutor_verification_documents (tutor_id, document_type, document_url) values (v_ta, 'identity_doc', v_ta || '/id.pdf') returning id, status::text into v_d, t;
  insert into public.tutor_verification_documents (tutor_id, document_type, document_url) values (v_ta, 'proof_of_experience', 'https://www.superprof.co.za/tutor/x');
  r := r || format('D1 %s tutor A adds a file in own folder (status %s) and a web link', case when v_d is not null and t = 'pending' then 'ok' else 'FAIL' end, t) || E'\n';
  n := 0;
  foreach q in array array[v_tb || '/id.pdf', v_ta || '/../' || v_tb || '/id.pdf', 'id.pdf', ''] loop
    begin
      insert into public.tutor_verification_documents (tutor_id, document_type, document_url) values (v_ta, 'identity_doc', q);
    exception when others then
      if sqlerrm = 'A document must be uploaded to your own folder' then n := n + 1; else r := r || 'D2 FAIL other error: ' || left(sqlerrm, 50) || E'\n'; end if; end;
  end loop;
  r := r || format('D2 %s refused: other tutor''s folder, a ".." path, no folder, empty (%s of 4)', case when n = 4 then 'ok' else 'FAIL' end, n) || E'\n';
  begin
    update public.tutor_verification_documents set document_url = v_tb || '/id.pdf' where id = v_d; t := 'FAIL';
  exception when others then t := case when sqlerrm = 'A document must be uploaded to your own folder' then 'ok' else 'FAIL ' || left(sqlerrm, 40) end; end;
  update public.tutor_verification_documents set document_url = v_ta || '/id2.pdf' where id = v_d;
  get diagnostics n = row_count;
  r := r || format('D3 %s changing a file to another folder is refused (%s); to own folder saved=%s', case when t = 'ok' and n = 1 then 'ok' else 'FAIL' end, t, n) || E'\n';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.tutor_verification_documents (tutor_id, document_type, document_url) values (v_ta, 'identity_doc', 'legacy/x.pdf');
  reset role;
  r := r || 'D4 ok admin can still add a document for a tutor (guard skips admins)' || E'\n';

  -- ============ how it is built =========================================================================================
  select count(*) filter (where exists (select 1 from unnest(coalesce(proconfig, '{}'::text[])) c where c like 'search_path=%')),
         count(*) filter (where prosecdef and proname <> 'guard_verification_documents')
    into n, n2 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('public_tutor_reviews', 'admin_tutor_internal_flags', 'guard_verification_documents');
  r := r || format('F1 %s search_path pinned on %s of 3; the two new functions are definer=%s', case when n = 3 and n2 = 2 then 'ok' else 'FAIL' end, n, n2) || E'\n';
  r := r || format('F2 %s execute: review list anon=%s signed-in=%s; admin function anon=%s signed-in=%s (want t t f t)',
    case when has_function_privilege('anon', 'public.public_tutor_reviews(uuid)', 'EXECUTE') and has_function_privilege('authenticated', 'public.public_tutor_reviews(uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.admin_tutor_internal_flags(uuid)', 'EXECUTE') and has_function_privilege('authenticated', 'public.admin_tutor_internal_flags(uuid)', 'EXECUTE') then 'ok' else 'FAIL' end,
    has_function_privilege('anon', 'public.public_tutor_reviews(uuid)', 'EXECUTE'), has_function_privilege('authenticated', 'public.public_tutor_reviews(uuid)', 'EXECUTE'),
    has_function_privilege('anon', 'public.admin_tutor_internal_flags(uuid)', 'EXECUTE'), has_function_privilege('authenticated', 'public.admin_tutor_internal_flags(uuid)', 'EXECUTE')) || E'\n';
  select string_agg(policyname, ',' order by policyname) into t from pg_policies where schemaname = 'public' and tablename = 'reviews';
  r := r || format('F3 %s review policies: %s', case when t = 'Admins view all reviews,Participants view own reviews,Students review their own completed sessions' then 'ok' else 'FAIL' end, left(t, 70)) || E'\n';
  r := r || format('F4 %s rights: chats ins/upd/del=%s/%s/%s msg ins=%s; notices upd table=%s read_at=%s title=%s; anon reviews sel=%s',
    case when not has_table_privilege('authenticated', 'public.conversations', 'INSERT') and not has_table_privilege('authenticated', 'public.conversations', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.conversations', 'DELETE') and not has_table_privilege('authenticated', 'public.messages', 'INSERT')
      and has_table_privilege('authenticated', 'public.conversations', 'SELECT') and has_table_privilege('authenticated', 'public.messages', 'SELECT')
      and not has_table_privilege('authenticated', 'public.notifications', 'UPDATE') and has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE')
      and not has_column_privilege('authenticated', 'public.notifications', 'title', 'UPDATE') and not has_table_privilege('anon', 'public.reviews', 'SELECT') then 'ok' else 'FAIL' end,
    has_table_privilege('authenticated', 'public.conversations', 'INSERT'), has_table_privilege('authenticated', 'public.conversations', 'UPDATE'), has_table_privilege('authenticated', 'public.conversations', 'DELETE'),
    has_table_privilege('authenticated', 'public.messages', 'INSERT'), has_table_privilege('authenticated', 'public.notifications', 'UPDATE'),
    has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE'), has_column_privilege('authenticated', 'public.notifications', 'title', 'UPDATE'),
    has_table_privilege('anon', 'public.reviews', 'SELECT')) || E'\n';

  select count(*) filter (where l like '%FAIL%'), count(*), string_agg(case when l like '%FAIL%' then l else left(l, 70) end, E'\n' order by o)
    into nfail, n, rep from regexp_split_to_table(r, E'\n') with ordinality as x(l, o) where l <> '';
  -- Inside scripts/run-rolled-back-test.mjs the report is handed back through a setting and the runner raises it (the rollback).
  if coalesce(current_setting('test.runner', true), '') = 'on' then
    perform set_config('test.report', format(E'PUBLIC READ FIXES TEST (rolled back): %s FAIL line(s) in %s lines\n%s', nfail, n, rep), true);
  else
    raise exception E'PUBLIC READ FIXES TEST (rolled back): % FAIL line(s) in % lines\n%', nfail, n, rep;
  end if;
end $$;
