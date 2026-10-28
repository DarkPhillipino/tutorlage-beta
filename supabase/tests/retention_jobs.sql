-- Rolled-back test of the retention jobs (migration 20261021150000), on top of the safety hold (20261021100000, 103000, 110000), the hold
-- protections and hand-over export (120000, 130000) and the close-account tool (140000, 141000).
-- Run it with scripts/run-rolled-back-test.mjs in ONE statement (see README.md). On dev the chain 100000 to 141000 is already applied except
-- 103000, so run just the new migration and this file: node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/retention_jobs.sql
-- supabase/migrations/20261021150000_retention_jobs.sql. (On a database without the earlier migrations, list them first, in order.)
-- Time is made by back-dating: tombstones, documents, reports, sessions and requests are inserted with old dates; nothing waits.
-- Each part runs in its own block: a mistake in one part is reported as an ERROR line and the other parts still run. Lines are short on purpose
-- (the Supabase tool cuts a long answer). Every person, session, payment and file is built inside the run.
do $$
declare
  r text := E'\n';
  m text; t text; n int; n2 int; n3 int; n4 int; nfail int; nlines int;
  bl boolean; bl2 boolean;
  j jsonb; j2 jsonb; j3 jsonb; rep text; old_report text;
  run1 uuid; run2 uuid; run3 uuid; run4 uuid; run5 uuid;
  a1 uuid;
  la uuid; lb uuid; lh uuid; lo uuid; ld uuid; lc uuid; lg uuid; lk uuid; lp uuid; lx uuid; mp uuid; lw uuid;          -- learners
  ta uuid; tb uuid; tc uuid; td uuid; te uuid; tf uuid; tg uuid; th uuid; ti uuid; tz uuid; tp2 uuid; tq uuid; tr uuid; mt uuid;   -- tutors
  sd1 uuid; sd2 uuid; sd3 uuid; sd4 uuid; sd5 uuid; sd7 uuid; sm1 uuid; sm2 uuid; sm3 uuid; sm4 uuid; sm5 uuid; s_te uuid;
  d1 uuid; d2 uuid; d3 uuid; d4 uuid; d5 uuid; d7 uuid; dd uuid;
  rq1 uuid; rq2 uuid; rq4 uuid; rq_u uuid; po1 uuid; po_p uuid; doc1 uuid; hid uuid;
  d9 timestamptz := now() - interval '9 years';
  d2y timestamptz := now() - interval '7 years 9 months';
  fy int := extract(month from now() - interval '7 years 9 months')::int;
  arr text[];
  -- EXP-R review additions
  sw_default boolean; cap_default text;
  run6 uuid; run7 uuid; run8 uuid; run9 uuid; run10 uuid; run11 uuid; run12 uuid;
  cp uuid[]; x1 uuid; x2 uuid; lk0 int; lk1 int; lk2 int;
  sws uuid; hid2 uuid; h5 uuid; y5 uuid;
  ms uuid; mtt uuid; sb uuid[]; rb uuid[]; pb uuid[]; vr1 uuid;
  g5 uuid; l5 uuid; l6 uuid;
  t_age uuid; t_unf uuid; t_und uuid; t_task uuid; t_ok uuid; t_none uuid; t_file uuid; t_open uuid; t_done uuid;
  ghost uuid; tm uuid; tm_doc uuid; tn uuid; resp uuid; rtut uuid; rl uuid; sr uuid; dr uuid;
  m2 text; n5 int; n6 int; bl3 boolean;
begin
  -- ---------- helpers (gone at rollback) ----------
  create function pg_temp.call_as(p_uid uuid, p_sql text, p_role text default 'authenticated') returns text language plpgsql as $f$
  declare v text; e text;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', p_role, 'iat', extract(epoch from now()))::text, true);
    execute format('set local role %I', p_role);
    begin
      execute p_sql into v;
    exception when others then
      e := sqlerrm;
    end;
    execute 'reset role';
    return case when e is null then 'OK:' || coalesce(v, '') else 'ERR:' || e end;
  end $f$;
  create function pg_temp.expect_err(p_uid uuid, p_sql text, p_want text, p_role text default 'authenticated') returns text language plpgsql as $f$
  declare t text;
  begin
    t := pg_temp.call_as(p_uid, p_sql, p_role);
    if left(t, 4) = 'ERR:' and starts_with(substr(t, 5), p_want) then return ''; end if;
    return ' [' || left(p_sql, 40) || ' -> ' || left(t, 70) || ']';
  end $f$;
  create function pg_temp.mk(p_role text) returns uuid language plpgsql as $f$
  declare u uuid := gen_random_uuid(); meta jsonb;
  begin
    meta := jsonb_build_object('first_name', 'Rt', 'surname', p_role, 'date_of_birth', (current_date - interval '30 years')::date::text);
    if p_role = 'tutor' then meta := meta || jsonb_build_object('role', 'tutor'); end if;
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rt.' || u || '@example.invalid', meta, '{}');
    return u;
  end $f$;
  create function pg_temp.tomb(p_profile uuid, p_days int) returns void language plpgsql as $f$
  begin
    insert into public.account_tombstones (profile_id, closure_id, role, display_name, closed_at)
    values (p_profile, gen_random_uuid(), 'student', 'Test Name', now() - make_interval(days => p_days));
  end $f$;
  create function pg_temp.mks(p_student uuid, p_tutor uuid, p_booker uuid, p_start timestamptz, p_status text) returns uuid language plpgsql as $f$
  declare v uuid;
  begin
    insert into public.sessions (student_id, tutor_id, booked_by_profile_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount, status, completed_at, created_at)
    values (p_student, p_tutor, p_booker, p_start, 100, 20, 100, 80, p_status::public.session_status, case when p_status = 'completed' then p_start end, p_start - interval '1 minute')
    returning id into v;
    return v;
  end $f$;
  create function pg_temp.mkr(p_student uuid, p_by uuid, p_tutor uuid, p_session uuid, p_at timestamptz, p_pay text) returns uuid language plpgsql as $f$
  declare v uuid;
  begin
    insert into public.session_requests (student_id, requested_by_profile_id, requested_start, paystack_reference, charged_amount, status, payment_status, resulting_session_id, tutor_id, charge_reference, created_at)
    values (p_student, p_by, p_at, 'rt_' || gen_random_uuid(), 100, case when p_session is null then 'pending' else 'accepted' end, p_pay, p_session, p_tutor, 'rtc_' || gen_random_uuid(), p_at) returning id into v;
    return v;
  end $f$;
  create function pg_temp.mkd(p_session uuid, p_raised uuid, p_status text, p_at timestamptz) returns uuid language plpgsql as $f$
  declare v uuid;
  begin
    insert into public.platform_disputes (session_id, raised_by_id, reason, description, status, resolved_at, created_at)
    values (p_session, p_raised, 'no_show', 'rt', p_status::public.dispute_status, case when p_status in ('resolved_refunded', 'resolved_payout', 'dismissed') then p_at end, p_at) returning id into v;
    return v;
  end $f$;
  create function pg_temp.mkdoc(p_tutor uuid, p_name text, p_up timestamptz) returns uuid language plpgsql as $f$
  declare v uuid;
  begin
    insert into storage.objects (bucket_id, name) values ('tutor-documents', p_tutor || '/' || p_name);
    insert into public.tutor_verification_documents (tutor_id, document_type, document_url, uploaded_at)
    values (p_tutor, 'identity_doc', p_tutor || '/' || p_name, p_up) returning id into v;
    return v;
  end $f$;

  create function pg_temp.owner_err(p_sql text, p_want text) returns text language plpgsql as $f$
  begin
    begin
      execute p_sql;
    exception when others then
      if position(p_want in sqlerrm) > 0 then return ''; end if;
      return ' [' || left(p_sql, 36) || ' -> ' || left(sqlerrm, 80) || ']';
    end;
    return ' [' || left(p_sql, 36) || ' -> allowed]';
  end $f$;
  create function pg_temp.owner_ok(p_sql text) returns text language plpgsql as $f$
  begin
    execute p_sql;
    return '';
  exception when others then
    return ' [' || left(p_sql, 36) || ' -> ' || left(sqlerrm, 80) || ']';
  end $f$;

  -- ---------- the master switch ----------
  -- It ships OFF (checked as R2a below); the suite turns it on for the runs that follow and tests the off state at the end.
  select (s.setting_value = 'false'::jsonb) into sw_default from system_settings s where s.setting_key = 'retention_jobs_enabled';
  select s.setting_value #>> '{}' into cap_default from system_settings s where s.setting_key = 'retention_max_per_run';
  update system_settings set setting_value = 'true'::jsonb where setting_key = 'retention_jobs_enabled';

  -- ---------- people and records ----------
  a1 := pg_temp.mk('student');
  insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values (a1, 'Ann', 'Admin', (select email from auth.users where id = a1), '', 'super_admin', true);
  update profiles set role = 'admin' where id = a1;
  la := pg_temp.mk('student'); lb := pg_temp.mk('student'); lh := pg_temp.mk('student'); lo := pg_temp.mk('student'); ld := pg_temp.mk('student');
  lc := pg_temp.mk('student'); lg := pg_temp.mk('student'); lk := pg_temp.mk('student'); lp := pg_temp.mk('student'); lx := pg_temp.mk('student'); mp := pg_temp.mk('student');
  ta := pg_temp.mk('tutor'); tb := pg_temp.mk('tutor'); tc := pg_temp.mk('tutor'); td := pg_temp.mk('tutor'); te := pg_temp.mk('tutor'); tf := pg_temp.mk('tutor');
  tg := pg_temp.mk('tutor'); th := pg_temp.mk('tutor'); ti := pg_temp.mk('tutor'); tz := pg_temp.mk('tutor'); tp2 := pg_temp.mk('tutor'); tq := pg_temp.mk('tutor');
  tr := pg_temp.mk('tutor'); mt := pg_temp.mk('tutor');
  perform pg_temp.tomb(ta, 1461); perform pg_temp.tomb(tb, 731); perform pg_temp.tomb(tc, 1461); perform pg_temp.tomb(tz, 2192);
  perform pg_temp.tomb(la, 2192); perform pg_temp.tomb(lb, 1096); perform pg_temp.tomb(lh, 2192); perform pg_temp.tomb(lo, 2192);
  perform pg_temp.tomb(ld, 2192); perform pg_temp.tomb(lk, 2192);
  perform pg_temp.tomb(lg, 2192);   -- the guardian on la's consent row: a row naming two people goes only when BOTH have closed (R5)
  insert into account_closures (profile_id, role, status, started_by, started_how, asked_by, how_verified, reference, note, was_adult, due_at, outer_limit_at, undo_until)
    values (la, 'student', 'done', a1, 'admin_request', 'Lee Asked', 'phoned back', 'REF-1', 'a note', true, now(), now(), now());
  insert into account_closures (profile_id, role, status, started_by, started_how, was_adult, due_at, outer_limit_at, undo_until, deferred_until, deferred_reason)
    values (ld, 'student', 'done', a1, 'admin_request', true, now(), now(), now(), now() + interval '10 days', 'bank dispute');   -- a tombstone exists only after the data was deleted, so the closure is finished ('done'); the deferral is what protects ld

  -- consent and acceptance records (ours carry the version 'v-rt'; the sign-up may add its own rows)
  insert into policy_acceptances (profile_id, accepted_by_profile_id, document, version, accepted_at, method)
    select x.p, x.p, x.d, 'v-rt', now() - interval '6 years', 'signup_checkbox' from (values (la, 'terms'), (la, 'privacy'), (lb, 'terms'), (lh, 'terms'), (lo, 'terms'), (ld, 'terms'), (lc, 'terms'), (tz, 'terms')) x(p, d);
  insert into guardian_consents (guardian_profile_id, learner_profile_id, consent_text_version) values (lg, la, 'v-rt'), (lg, lc, 'v-rt');
  insert into school_results_consents (student_id, consented_by, consent_version, consented_at) values (la, la, 'v-rt', now()), (lb, lb, 'v-rt', now());
  insert into tutor_onboarding (tutor_id, track, consent_version, consented_at) values (tz, 'beginner', 'v-rt', now()), (ta, 'beginner', 'v-rt', now()) on conflict do nothing;

  -- tutors' documents
  update tutor_profiles set created_at = now() - interval '4 years', updated_at = now() - interval '4 years' where id in (td, te, tg, th, ti);
  update tutor_profiles set is_dispatch_active = true where id = tf;
  doc1 := pg_temp.mkdoc(ta, 'id.pdf', now() - interval '5 years'); perform pg_temp.mkdoc(ta, 'police.pdf', now() - interval '5 years');
  insert into storage.objects (bucket_id, name) values ('tutor-documents', ta || '/stray.pdf'), ('tutor-documents', ta || '/t1.pdf');
  insert into tutor_verification_audits (tutor_id, document_id, decision) values (ta, doc1, 'verified');
  insert into tier1_academic_records (tutor_id, subject_name, mark_pct, source, document_path, status) values (ta, 'Mathematics', 80, 'matric', ta || '/t1.pdf', 'pending');
  insert into tutor_credentials (tutor_id, credential_code, document_id, status) values (ta, 'practicum_complete', doc1, 'pending');
  perform pg_temp.mkdoc(tb, 'id.pdf', now() - interval '5 years'); perform pg_temp.mkdoc(tc, 'id.pdf', now() - interval '5 years');
  perform pg_temp.mkdoc(td, 'id.pdf', now() - interval '4 years'); perform pg_temp.mkdoc(te, 'id.pdf', now() - interval '4 years');
  perform pg_temp.mkdoc(tf, 'id.pdf', now() - interval '4 years'); perform pg_temp.mkdoc(tg, 'id.pdf', now() - interval '1 year');
  perform pg_temp.mkdoc(th, 'id.pdf', now() - interval '4 years'); perform pg_temp.mkdoc(ti, 'id.pdf', now() - interval '4 years');
  s_te := pg_temp.mks(mp, te, mp, now() + interval '5 days', 'scheduled');

  -- problem reports (each on a session of its own)
  sd1 := pg_temp.mks(lp, tp2, lp, now() - interval '2 days', 'completed'); d1 := pg_temp.mkd(sd1, lp, 'resolved_refunded', now() - interval '2192 days');
  sd2 := pg_temp.mks(lp, tp2, lp, now() - interval '2 days', 'completed'); d2 := pg_temp.mkd(sd2, lp, 'dismissed', now() - interval '1461 days');
  sd3 := pg_temp.mks(lo, tq, lo, now() - interval '2 days', 'completed'); d3 := pg_temp.mkd(sd3, lo, 'open', now() - interval '2192 days');
  sd4 := pg_temp.mks(lp, tr, lp, now() - interval '2 days', 'completed'); d4 := pg_temp.mkd(sd4, lh, 'resolved_payout', now() - interval '2192 days');
  sd5 := pg_temp.mks(lx, tq, lx, now() - interval '2 days', 'completed'); d5 := pg_temp.mkd(sd5, lx, 'dismissed', now() - interval '2192 days');

  -- money records
  sm1 := pg_temp.mks(mp, mt, mp, d9, 'completed'); rq1 := pg_temp.mkr(mp, mp, mt, sm1, d9, 'paid');
  insert into payouts (tutor_id, period_start, period_end, total_amount, status, paid_at, created_at) values (mt, d9::date - 7, d9::date, 80, 'paid', d9, d9) returning id into po1;
  insert into payout_sessions (payout_id, session_id) values (po1, sm1);
  insert into reviews (session_id, tutor_id, student_id, rating, comment) values (sm1, mt, mp, 5, 'rt');
  sm2 := pg_temp.mks(mp, mt, mp, d2y, 'completed'); rq2 := pg_temp.mkr(mp, mp, mt, sm2, d2y, 'paid');
  sm3 := pg_temp.mks(lk, mt, lk, now() - interval '1 year', 'completed');
  sm4 := pg_temp.mks(lh, mt, lh, d9, 'completed'); rq4 := pg_temp.mkr(lh, lh, mt, sm4, d9, 'paid');
  sm5 := pg_temp.mks(mp, mt, mp, d9, 'completed'); dd := pg_temp.mkd(sm5, mp, 'dismissed', now() - interval '1 year');
  rq_u := pg_temp.mkr(mp, mp, mt, null, d9, 'refund_pending');
  insert into payouts (tutor_id, period_start, period_end, total_amount, status, created_at) values (mt, d9::date - 7, d9::date, 80, 'pending', d9) returning id into po_p;

  -- holds and a hand-over in progress
  perform pg_temp.call_as(a1, format($q$select public.place_safety_hold(%L, 'rt hold')$q$, lh));
  perform pg_temp.call_as(a1, format($q$select public.place_safety_hold(%L, 'rt hold')$q$, tc));
  insert into hand_over_events (event, subject_id, admin_id, authority, reference, requester_name, requester_role, requester_organisation, requester_phone, requester_email,
                                verified_how, reason, approved_by, tutor_told, scope, contents)
    values ('prepared', th, a1, 'warrant', 'RT-1', 'Officer', 'Captain', 'SAPS', '0110000000', 'o@example.invalid', 'called back', 'rt', 'lead', 'not told', array['profile'], '{}'::jsonb)
    returning id into hid;
  r := r || 'S0 setup: 13 learners, 14 tutors, 11 tombstones, documents, files, reports, money records, 2 holds, 1 hand-over' || E'\n';
  r := r || format('R2a %s the master switch ships OFF (retention_jobs_enabled is false=%s) and the per-run cap ships at %s (want 100)',
    case when sw_default and cap_default = '100' then 'ok' else 'FAIL' end, sw_default, cap_default) || E'\n';

  -- ============ A. the rules in small ========================================================================================
  begin
    select setting_value = 'false'::jsonb into bl from system_settings where setting_key = 'retention_quiet_tutor_rule';
    r := r || format('A0 %s the quiet-tutor rule ships switched OFF (setting is false=%s): until the CEO turns it on only closing starts the 3-year clock', case when bl then 'ok' else 'FAIL' end, bl) || E'\n';
    update system_settings set setting_value = 'null'::jsonb where setting_key = 'retention_financial_year_end_month';
    n := (public.retention_money_cutoff(date '2019-03-15') = date '2027-03-15')::int;
    update system_settings set setting_value = to_jsonb(2) where setting_key = 'retention_financial_year_end_month';
    n := n + (public.retention_money_cutoff(date '2019-03-15') = date '2027-02-28')::int;
    update system_settings set setting_value = to_jsonb(3) where setting_key = 'retention_financial_year_end_month';
    n := n + (public.retention_money_cutoff(date '2019-03-15') = date '2026-03-31')::int;
    update system_settings set setting_value = to_jsonb(12) where setting_key = 'retention_financial_year_end_month';
    n := n + (public.retention_money_cutoff(date '2019-12-31') = date '2026-12-31')::int;
    update system_settings set setting_value = 'null'::jsonb where setting_key = 'retention_financial_year_end_month';
    r := r || format('A1 %s the money clock: no year-end chosen = date + 8 years; Feb, Mar and Dec year-ends = end of that year-end + 7 years (%s of 4 right)', case when n = 4 then 'ok' else 'FAIL' end, n) || E'\n';
    bl := public.retention_person_protected(lh); bl2 := public.retention_person_protected(th);
    n := (public.retention_person_protected(ld))::int + (public.retention_person_protected(tc))::int;
    r := r || format('A2 %s protected: safety hold=%s, hand-over prepared and not delivered=%s, deferral still running + hold on a tutor=%s of 2; a plain person=%s (want false)',
      case when bl and bl2 and n = 2 and not public.retention_person_protected(mp) then 'ok' else 'FAIL' end, bl, bl2, n, public.retention_person_protected(mp)) || E'\n';
    update system_settings set setting_value = 'false'::jsonb where setting_key = 'retention_quiet_tutor_rule';
    r := r || format('A3 %s with the quiet-tutor rule switched off a quiet tutor has no "stopped" date (%s, want true)',
      case when public.retention_tutor_stopped_at(td) is null then 'ok' else 'FAIL' end, public.retention_tutor_stopped_at(td) is null) || E'\n';
    update system_settings set setting_value = 'true'::jsonb where setting_key = 'retention_quiet_tutor_rule';
    bl := public.retention_tutor_stopped_at(td) is not null and public.retention_tutor_stopped_at(td) < now() - interval '3 years';
    r := r || format('A4 %s rule on: td stopped long ago=%s, te (booked session)=%s (null), tf (accepting)=%s (null), tg (recent upload) is recent=%s',
      case when bl and public.retention_tutor_stopped_at(te) is null and public.retention_tutor_stopped_at(tf) is null and public.retention_tutor_stopped_at(tg) > now() - interval '2 years' then 'ok' else 'FAIL' end,
      bl, public.retention_tutor_stopped_at(te) is null, public.retention_tutor_stopped_at(tf) is null, public.retention_tutor_stopped_at(tg) > now() - interval '2 years') || E'\n';
    update system_settings set setting_value = 'false'::jsonb where setting_key = 'retention_quiet_tutor_rule';
  exception when others then
    reset role;
    r := r || 'A ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ B. first run: quiet-tutor rule off, no year-end chosen =======================================================
  begin
    j := public.run_retention_jobs();
    run1 := (j ->> 'run_id')::uuid;
    r := r || format('B0 %s run 1: errors=%s (want 0), files queued=%s (want 4)', case when (j ->> 'errors') = '0' and (j ->> 'files_queued') = '4' then 'ok' else 'FAIL' end, j ->> 'errors', j ->> 'files_queued') || E'\n';
    select count(*), count(distinct category), count(*) filter (where error is null) into n, n2, n3 from retention_deletion_records where run_id = run1;
    r := r || format('B1 %s the journal: one row per category for the run (%s rows, %s categories, %s without an error; want 5, 5, 5)', case when n = 5 and n2 = 5 and n3 = 5 then 'ok' else 'FAIL' end, n, n2, n3) || E'\n';
    select (deleted ->> 'tutor_verification_documents')::int, (deleted ->> 'tutor_verification_audits')::int, (deleted ->> 'tier1_academic_records')::int, files_queued, protected_skipped
      into n, n2, n3, n4, nlines from retention_deletion_records where run_id = run1 and category = 'tutor_documents';
    r := r || format('B2 %s tutor documents: deleted %s documents, %s audit line, %s Tier 1 record (want 2, 1, 1), files queued=%s (4), held tutor skipped=%s (>=1)',
      case when n = 2 and n2 = 1 and n3 = 1 and n4 = 4 and nlines >= 1 then 'ok' else 'FAIL' end, n, n2, n3, n4, nlines) || E'\n';
    select (select count(*) from tutor_verification_documents where tutor_id = ta) + (select count(*) from tutor_verification_audits where tutor_id = ta) + (select count(*) from tier1_academic_records where tutor_id = ta),
           (select count(*) from tutor_credentials where tutor_id = ta and document_id is null),
           (select count(*) from tutor_verification_documents where tutor_id in (tb, tc, td, te, tf, tg, th, ti))
      into n, n2, n3;
    r := r || format('B3 %s ta (closed 4 years ago): documents, audit line and Tier 1 record gone (left=%s), the credential stays with its link emptied (%s); the 8 other tutors'' documents stay (%s): 2-year-old closing, hold, quiet rule off, active, recent, hand-over',
      case when n = 0 and n2 = 1 and n3 = 8 then 'ok' else 'FAIL' end, n, n2, n3) || E'\n';
    select count(*), count(*) filter (where closure_id = run1 and payload ->> 'bucket' = 'tutor-documents' and jsonb_array_length(payload -> 'paths') = 4 and payload -> 'paths' ? (ta || '/stray.pdf') and payload -> 'paths' ? (ta || '/t1.pdf'))
      into n, n2 from account_closure_tasks where profile_id = ta and kind = 'storage_remove';
    r := r || format('B4 %s ONE file step in the existing queue for ta: all 4 files (id, police, stray, Tier 1) in %s of %s step(s), tagged with the run', case when n = 1 and n2 = 1 then 'ok' else 'FAIL' end, n2, n) || E'\n';
    j2 := public.close_account_claim_tasks(10);
    select count(*) into n from jsonb_array_elements(j2) e where e ->> 'kind' = 'storage_remove' and e -> 'payload' ->> 'bucket' = 'tutor-documents';
    r := r || format('B5 %s the Worker''s own claim call hands out that step (%s file step(s) claimed)', case when n >= 1 then 'ok' else 'FAIL' end, n) || E'\n';
  exception when others then
    reset role;
    r := r || 'B ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  begin
    select count(*) into n from policy_acceptances where version = 'v-rt' and profile_id in (la, tz);
    select count(*) into n2 from policy_acceptances where version = 'v-rt' and profile_id in (lb, lh, lo, ld, lc);
    select count(*) into n3 from guardian_consents where learner_profile_id = la and guardian_profile_id = lg;
    select count(*) into n4 from guardian_consents where learner_profile_id = lc;
    r := r || format('C1 %s acceptance records: closed 6 years ago and free = gone (%s, want 0); closed 3 years, held, open report, deferral, never closed = stay (%s, want 5); guardian consent for la gone (%s), for lc stays (%s)',
      case when n = 0 and n2 = 5 and n3 = 0 and n4 = 1 then 'ok' else 'FAIL' end, n, n2, n3, n4) || E'\n';
    select (select count(*) from school_results_consents where student_id = la), (select count(*) from school_results_consents where student_id = lb),
           (select count(*) from tutor_onboarding where tutor_id = tz), (select count(*) from tutor_onboarding where tutor_id = ta)
      into n, n2, n3, n4;
    r := r || format('C2 %s school-results consent: la gone (%s), lb stays (%s); tutor onboarding: tz (6 years) gone (%s), ta (4 years) stays (%s)',
      case when n = 0 and n2 = 1 and n3 = 0 and n4 = 1 then 'ok' else 'FAIL' end, n, n2, n3, n4) || E'\n';
    select (deleted ->> 'platform_disputes')::int, protected_skipped into n, n2 from retention_deletion_records where run_id = run1 and category = 'problem_reports';
    select count(*) into n3 from platform_disputes where id = d1;
    select count(*) into n4 from platform_disputes where id in (d2, d3, d4, d5);
    r := r || format('D1 %s problem reports: the resolved one with free people is gone (deleted=%s, left=%s); kept: resolved 4 years ago, still open, person on hold, party with another open report (%s of 4); skipped for protection=%s (want 2)',
      case when n = 1 and n3 = 0 and n4 = 4 and n2 = 2 then 'ok' else 'FAIL' end, n, n3, n4, n2) || E'\n';
  exception when others then
    reset role;
    r := r || 'C/D ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  begin
    select (deleted ->> 'payouts')::int, (deleted ->> 'payout_sessions')::int, (deleted ->> 'session_requests')::int, (deleted ->> 'sessions')::int, (deleted ->> 'reviews')::int, protected_skipped
      into n, n2, n3, n4, nlines, nfail from retention_deletion_records where run_id = run1 and category = 'money_records';
    r := r || format('E1 %s money, no year-end chosen: payout %s, its line %s, request %s, session %s, review %s all gone (want 1 each); skipped for protection=%s (>=1)',
      case when n = 1 and n2 = 1 and n3 = 1 and n4 = 1 and nlines = 1 and nfail >= 1 then 'ok' else 'FAIL' end, n, n2, n3, n4, nlines, nfail) || E'\n';
    select (select count(*) from sessions where id in (sm1)), (select count(*) from sessions where id in (sm2, sm3, sm4, sm5)), (select count(*) from session_requests where id in (rq2, rq4, rq_u)),
           (select count(*) from payouts where id = po_p), (select count(*) from platform_disputes where id = dd)
      into n, n2, n3, n4, nlines;
    r := r || format('E2 %s kept: sm1 gone (%s); 7 years 9 months old (needs 8 with no year-end), 1 year old, held learner, session with a report not yet due all stay (%s of 4); requests rq2, rq4, unsettled refund stay (%s of 3); pending payout stays (%s)',
      case when n = 0 and n2 = 4 and n3 = 3 and n4 = 1 and nlines = 1 then 'ok' else 'FAIL' end, n, n2, n3, n4) || E'\n';
    select count(*) into n from account_tombstones where profile_id in (la, tz);
    select count(*) into n2 from account_tombstones where profile_id in (lb, lk, ta, tb, tc, lh, lo, ld);
    select (asked_by is null and how_verified is null and reference is null and note is null) into bl from account_closures where profile_id = la;
    r := r || format('F1 %s tombstones: la and tz (nothing kept any more) destroyed (left=%s), la''s closure names blanked=%s; the 8 with records or holds stay (%s)',
      case when n = 0 and bl and n2 = 8 then 'ok' else 'FAIL' end, n, bl, n2) || E'\n';
  exception when others then
    reset role;
    r := r || 'E/F ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ C. a second run changes nothing and does not queue the files twice ============================================
  begin
    j := public.run_retention_jobs();
    select count(*) into n from account_closure_tasks where profile_id = ta and kind = 'storage_remove';
    select coalesce(sum((select coalesce(sum(value::int), 0) from jsonb_each_text(deleted))), 0) into n2 from retention_deletion_records where run_id = (j ->> 'run_id')::uuid;
    r := r || format('G1 %s run 2 straight after: nothing more deleted (%s), the file step is not queued again (%s step, want 1), files queued=%s (0)',
      case when n = 1 and n2 = 0 and (j ->> 'files_queued') = '0' and (j ->> 'errors') = '0' then 'ok' else 'FAIL' end, n2, n, j ->> 'files_queued') || E'\n';
  exception when others then
    reset role;
    r := r || 'G ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ D. holds released, rule on, year-end chosen: second day ======================================================
  begin
    perform pg_temp.call_as(a1, format($q$select public.release_safety_hold(%L, 'cleared')$q$, lh));
    perform pg_temp.call_as(a1, format($q$select public.release_safety_hold(%L, 'cleared')$q$, tc));
    update account_closures set deferred_until = null where profile_id = ld;
    update system_settings set setting_value = 'true'::jsonb where setting_key = 'retention_quiet_tutor_rule';
    update system_settings set setting_value = to_jsonb(fy) where setting_key = 'retention_financial_year_end_month';
    j := public.run_retention_jobs();
    run2 := (j ->> 'run_id')::uuid;
    select count(*) into n from tutor_verification_documents where tutor_id in (tc, td, ti);
    select count(*) into n2 from tutor_verification_documents where tutor_id in (tb, te, tf, tg, th);
    select count(*) into n3 from account_closure_tasks where profile_id in (tc, td, ti) and kind = 'storage_remove' and closure_id = run2;
    r := r || format('H1 %s released hold (tc) and quiet tutors for 4 years (td, ti) lose their documents (left=%s), the closed-2-years, booked, active, recent-upload and hand-over tutors keep theirs (%s of 5); 3 file steps queued=%s',
      case when n = 0 and n2 = 5 and n3 = 3 and (j ->> 'errors') = '0' then 'ok' else 'FAIL' end, n, n2, n3) || E'\n';
    select count(*) into n from policy_acceptances where version = 'v-rt' and profile_id in (lh, ld);
    select count(*) into n2 from policy_acceptances where version = 'v-rt' and profile_id in (lb, lo, lc);
    r := r || format('H2 %s after release / the deferral ending: lh and ld acceptance records gone (%s); lb, lo (open report) and lc stay (%s of 3)', case when n = 0 and n2 = 3 then 'ok' else 'FAIL' end, n, n2) || E'\n';
    select count(*) into n from platform_disputes where id = d4;
    select count(*) into n2 from platform_disputes where id in (d2, d3, d5);
    r := r || format('H3 %s report d4 goes once its person is released (left=%s); d2, d3, d5 stay (%s of 3)', case when n = 0 and n2 = 3 then 'ok' else 'FAIL' end, n, n2) || E'\n';
    select (select count(*) from sessions where id in (sm2, sm4)), (select count(*) from session_requests where id in (rq2, rq4)), (select count(*) from sessions where id in (sm3, sm5)),
           (select count(*) from session_requests where id = rq_u), (select count(*) from payouts where id = po_p)
      into n, n2, n3, n4, nlines;
    r := r || format('H4 %s with the year-end (month %s) chosen: sm2 (7y9m) and the released learner''s sm4 and their requests go (sessions left=%s, requests left=%s); sm3, sm5 (report), unsettled refund and pending payout stay (%s of 2, %s, %s)',
      case when n = 0 and n2 = 0 and n3 = 2 and n4 = 1 and nlines = 1 then 'ok' else 'FAIL' end, fy, n, n2, n3, n4, nlines) || E'\n';
    select count(*) into n from account_tombstones where profile_id in (lh, ld);
    select count(*) into n2 from account_tombstones where profile_id in (lo, lk, lb, ta);
    r := r || format('H5 %s lh and ld have nothing kept any more, so their tombstones are destroyed (left=%s); lo, lk, lb, ta keep theirs (%s of 4)', case when n = 0 and n2 = 4 then 'ok' else 'FAIL' end, n, n2) || E'\n';
  exception when others then
    reset role;
    r := r || 'H ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ E. a hand-over delivered ends its protection ================================================================
  begin
    insert into hand_over_events (event, hand_over_id, subject_id, admin_id, delivery_method, delivery_address) values ('delivered', hid, th, a1, 'in person', 'station');
    bl := public.retention_person_protected(th);
    j := public.run_retention_jobs();
    select count(*) into n from tutor_verification_documents where tutor_id = th;
    select count(*) into n2 from tutor_verification_documents where tutor_id in (te, tf, tg, tb);
    r := r || format('I1 %s hand-over delivered: no longer protected (%s, want false); th''s documents gone (%s); te, tf, tg, tb keep theirs (%s of 4)', case when not bl and n = 0 and n2 = 4 then 'ok' else 'FAIL' end, bl, n, n2) || E'\n';
  exception when others then
    reset role;
    r := r || 'I ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ F. one category fails: it rolls back alone, is journalled, the others still run =============================
  begin
    lw := pg_temp.mk('student'); perform pg_temp.tomb(lw, 2192);
    insert into policy_acceptances (profile_id, accepted_by_profile_id, document, version, accepted_at, method) values (lw, lw, 'terms', 'v-rt', now() - interval '6 years', 'signup_checkbox');
    sd7 := pg_temp.mks(lp, tp2, lp, now() - interval '2 days', 'completed'); d7 := pg_temp.mkd(sd7, lp, 'dismissed', now() - interval '2192 days');
    create function public.rt_boom() returns trigger language plpgsql as $f$ begin raise exception 'rt boom'; end $f$;
    create trigger rt_boom before delete on public.platform_disputes for each row execute function public.rt_boom();
    j := public.run_retention_jobs();
    run4 := (j ->> 'run_id')::uuid;
    select error into t from retention_deletion_records where run_id = run4 and category = 'problem_reports';
    select count(*) into n from retention_deletion_records where run_id = run4 and error is null;
    select count(*) into n2 from platform_disputes where id = d7;
    select count(*) into n3 from policy_acceptances where profile_id = lw;
    select count(*) into n4 from notifications where profile_id = a1 and type = 'retention_error';
    r := r || format('J1 %s a failing category: reported errors=%s (want 1), its journal row says "%s", the other 4 rows have no error (%s), its report d7 is still there (%s), another category still ran (lw''s acceptance records left=%s), the admins were told (%s)',
      case when (j ->> 'errors') = '1' and t = 'rt boom' and n = 4 and n2 = 1 and n3 = 0 and n4 >= 1 then 'ok' else 'FAIL' end, j ->> 'errors', t, n, n2, n3, n4) || E'\n';
    drop trigger rt_boom on public.platform_disputes;
    j := public.run_retention_jobs();
    run5 := (j ->> 'run_id')::uuid;
    select count(*) into n from platform_disputes where id = d7;
    r := r || format('J2 %s the next day the same category works again: d7 gone (%s), errors=%s (0)', case when n = 0 and (j ->> 'errors') = '0' then 'ok' else 'FAIL' end, n, j ->> 'errors') || E'\n';
  exception when others then
    reset role;
    r := r || 'J ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ G. how it is built ==========================================================================================
  begin
    select count(*), count(distinct run_id) into n, n2 from retention_deletion_records;
    r := r || format('K1 %s the journal holds 5 rows for each of the 6 runs (%s rows, %s runs)', case when n = 30 and n2 = 6 then 'ok' else 'FAIL' end, n, n2) || E'\n';
    m := '';
    begin update retention_deletion_records set error = 'x'; m := m || ' update-allowed'; exception when others then if sqlerrm <> 'Retention records can only be added to' then m := m || ' [' || left(sqlerrm, 50) || ']'; end if; end;
    begin delete from retention_deletion_records; m := m || ' delete-allowed'; exception when others then if sqlerrm <> 'Retention records can only be added to' then m := m || ' [' || left(sqlerrm, 50) || ']'; end if; end;
    begin truncate retention_deletion_records; m := m || ' truncate-allowed'; exception when others then if sqlerrm <> 'Retention records can only be added to' then m := m || ' [' || left(sqlerrm, 50) || ']'; end if; end;
    r := r || 'K2 ' || case when m = '' then 'ok' else 'FAIL' end || ' the journal cannot be updated, deleted from or truncated, even by the owner' || m || E'\n';
    select count(*) filter (where c.relrowsecurity), count(*) into n, n2 from pg_class c where c.oid = 'public.retention_deletion_records'::regclass;
    select count(*) into n3 from pg_trigger where tgrelid = 'public.retention_deletion_records'::regclass and not tgisinternal;
    select count(*) into n4 from unnest(array['anon', 'authenticated', 'service_role']) ro(rn), unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr(pv)
      where has_table_privilege(ro.rn, 'public.retention_deletion_records', pr.pv);
    r := r || format('K3 %s the journal: row security on (%s), 2 triggers (%s), rights for signed-out, signed-in and the server key = %s (want 0)', case when n = 1 and n3 = 2 and n4 = 0 then 'ok' else 'FAIL' end, n, n3, n4) || E'\n';
    arr := array['retention_fy_month', 'retention_money_cutoff', 'retention_closed_before', 'retention_person_protected', 'retention_any_protected', 'retention_tutor_stopped_at', 'retention_tutor_anchor',
                 'retention_has_kept_records', 'retention_run_tutor_documents', 'retention_run_consent_records', 'retention_run_problem_reports', 'retention_run_money_records',
                 'retention_run_tombstones', 'run_retention_jobs', 'retention_records_are_append_only'];
    select count(*) filter (where not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')),
           count(*) filter (where p.proconfig::text like '%search_path=public%'), count(*) filter (where p.prosecdef), count(*)
      into n, n2, n3, n4 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(arr);
    r := r || format('K4 %s the 15 new functions: open to no API role (%s), pinned search path (%s), definers (%s, all but the journal trigger = 14), found=%s',
      case when n = 15 and n2 = 15 and n3 = 14 and n4 = 15 then 'ok' else 'FAIL' end, n, n2, n3, n4) || E'\n';
    m := pg_temp.expect_err(a1, 'select public.run_retention_jobs()::text', 'permission denied') || pg_temp.expect_err(a1, 'select public.run_retention_jobs()::text', 'permission denied', 'service_role')
      || pg_temp.expect_err(a1, 'select public.run_retention_jobs()::text', 'permission denied', 'anon') || pg_temp.expect_err(a1, 'select * from public.retention_deletion_records', 'permission denied');
    r := r || 'K5 ' || case when m = '' then 'ok' else 'FAIL' end || ' an admin, the server key and a signed-out caller cannot run the job; nobody can read the journal through the API' || m || E'\n';
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
      execute 'select count(*) = 1 and bool_and(schedule = ''40 3 * * *'' and command = ''select public.run_retention_jobs();'') from cron.job where jobname = ''run-retention-jobs''' into bl;
    else
      bl := true;
    end if;
    select count(*) into n from system_settings where setting_key in ('retention_documents_years', 'retention_consent_years', 'retention_reports_years', 'retention_money_years', 'retention_financial_year_end_month', 'retention_quiet_tutor_rule');
    r := r || format('K6 %s one daily job at 03:40 (%s) and the 6 setting rows exist (%s)', case when bl and n = 6 then 'ok' else 'FAIL' end, bl, n) || E'\n';
  exception when others then
    reset role;
    r := r || 'K ERROR ' || left(sqlerrm, 160) || E'\n';
  end;

  -- ============ L. EXP-R review: limits, the master switch, the schedule, the guards =======================================
  -- (These blocks run AFTER the old ones on purpose: K1 above counts the journal rows of the first six runs.)
  begin
    update system_settings set setting_value = 'false'::jsonb where setting_key = 'retention_quiet_tutor_rule';
    update system_settings set setting_value = 'null'::jsonb where setting_key = 'retention_financial_year_end_month';
    -- R1: a retention period can only be lengthened; the per-run cap is bounded
    n := 0;
    foreach t in array array['0', '-3', '1', '"abc"', 'null', '2.5', '7'] loop
      update system_settings set setting_value = t::jsonb where setting_key = 'retention_money_years';
      n := n + (public.retention_years('retention_money_years', 7) = 7)::int;
    end loop;
    n2 := 0;
    update system_settings set setting_value = '10'::jsonb where setting_key = 'retention_money_years';
    n2 := n2 + (public.retention_years('retention_money_years', 7) = 10)::int;
    update system_settings set setting_value = '1000'::jsonb where setting_key = 'retention_money_years';
    n2 := n2 + (public.retention_years('retention_money_years', 7) = 100)::int;
    update system_settings set setting_value = '7'::jsonb where setting_key = 'retention_money_years';
    update system_settings set setting_value = '2'::jsonb where setting_key = 'retention_documents_years';
    n2 := n2 + (public.retention_years('retention_documents_years', 3) = 3)::int;
    update system_settings set setting_value = '4'::jsonb where setting_key = 'retention_documents_years';
    n2 := n2 + (public.retention_years('retention_documents_years', 3) = 4)::int;
    update system_settings set setting_value = '3'::jsonb where setting_key = 'retention_documents_years';
    r := r || format('R1a %s the years settings can only lengthen: 0, -3, 1, text, empty, 2.5 and 7 all give 7 (%s of 7); 10 gives 10, 1000 is cut to 100, documents 2 gives 3 and 4 gives 4 (%s of 4)',
      case when n = 7 and n2 = 4 then 'ok' else 'FAIL' end, n, n2) || E'\n';
    n := (public.retention_run_cap() = 100)::int;
    update system_settings set setting_value = '0'::jsonb where setting_key = 'retention_max_per_run';
    n := n + (public.retention_run_cap() = 100)::int;
    update system_settings set setting_value = '7'::jsonb where setting_key = 'retention_max_per_run';
    n := n + (public.retention_run_cap() = 7)::int;
    update system_settings set setting_value = '1000'::jsonb where setting_key = 'retention_max_per_run';
    n := n + (public.retention_run_cap() = 250)::int;
    update system_settings set setting_value = '-5'::jsonb where setting_key = 'retention_max_per_run';
    n := n + (public.retention_run_cap() = 100)::int;
    update system_settings set setting_value = '100'::jsonb where setting_key = 'retention_max_per_run';
    r := r || format('R1b %s the per-run cap: 100 by default, 0 and -5 give 100, 7 gives 7, 1000 is cut to 250 (%s of 5)', case when n = 5 then 'ok' else 'FAIL' end, n) || E'\n';
    update system_settings set setting_value = '1'::jsonb where setting_key = 'retention_consent_years';
    j := public.run_retention_jobs();
    update system_settings set setting_value = '5'::jsonb where setting_key = 'retention_consent_years';
    select count(*) into n from policy_acceptances where version = 'v-rt' and profile_id = lb;
    r := r || format('R1c %s a consent period set to 1 year is ignored (floor 5): lb, closed 3 years ago, keeps the acceptance record (%s, want 1), errors=%s (0)',
      case when n = 1 and (j ->> 'errors') = '0' then 'ok' else 'FAIL' end, n, j ->> 'errors') || E'\n';
    -- R1d + R14: a cap of 1 deletes one row per table per run, says so in the journal, and locks only the people it checks
    cp := array[pg_temp.mk('student'), pg_temp.mk('student'), pg_temp.mk('student'), pg_temp.mk('student')];
    foreach x1 in array cp loop
      perform pg_temp.tomb(x1, 2192);
      delete from policy_acceptances where profile_id = x1;   -- the sign-up's own rows would be due too and could be the one the cap lets through
      insert into policy_acceptances (profile_id, accepted_by_profile_id, document, version, accepted_at, method) values (x1, x1, 'terms', 'v-cap', now() - interval '6 years', 'signup_checkbox');
    end loop;
    update system_settings set setting_value = '1'::jsonb where setting_key = 'retention_max_per_run';
    select count(*) into lk0 from pg_locks where pid = pg_backend_pid() and locktype = 'advisory';
    j := public.run_retention_jobs(); run6 := (j ->> 'run_id')::uuid;
    select count(*) into lk1 from pg_locks where pid = pg_backend_pid() and locktype = 'advisory';
    select count(*) into n from policy_acceptances where version = 'v-cap';
    select (period ->> 'capped')::boolean, (period ->> 'row_cap')::int, (deleted ->> 'policy_acceptances')::int into bl, n2, n3 from retention_deletion_records where run_id = run6 and category = 'consent_records';
    update system_settings set setting_value = '100'::jsonb where setting_key = 'retention_max_per_run';
    j := public.run_retention_jobs(); run7 := (j ->> 'run_id')::uuid;
    select count(*) into lk2 from pg_locks where pid = pg_backend_pid() and locktype = 'advisory';
    select count(*) into n4 from policy_acceptances where version = 'v-cap';
    r := r || format('R1d %s cap 1: one of 4 due learners deleted (left=%s, want 3; deleted=%s), journal says capped=%s with row_cap=%s; locks taken %s (<=2); cap 100 next night: left=%s (0), locks taken %s (>=3)',
      case when n = 3 and n3 = 1 and bl and n2 = 1 and lk1 - lk0 <= 2 and n4 = 0 and lk2 - lk1 >= 3 then 'ok' else 'FAIL' end, n, n3, bl, n2, lk1 - lk0, n4, lk2 - lk1) || E'\n';
    -- R2: the master switch
    sws := pg_temp.mk('student'); perform pg_temp.tomb(sws, 2192);
    insert into policy_acceptances (profile_id, accepted_by_profile_id, document, version, accepted_at, method) values (sws, sws, 'terms', 'v-sw', now() - interval '6 years', 'signup_checkbox');
    update system_settings set setting_value = 'false'::jsonb where setting_key = 'retention_jobs_enabled';
    select count(*) into n from retention_deletion_records;
    j := public.run_retention_jobs();
    bl := (j ->> 'skipped') is not null and (j ->> 'run_id') is null;
    select count(*) into n2 from retention_deletion_records;
    update system_settings set setting_value = '"true"'::jsonb where setting_key = 'retention_jobs_enabled';
    j2 := public.run_retention_jobs();
    update system_settings set setting_value = '1'::jsonb where setting_key = 'retention_jobs_enabled';
    j3 := public.run_retention_jobs();
    n3 := ((j2 ->> 'skipped') is not null)::int + ((j3 ->> 'skipped') is not null)::int;
    select count(*) into n4 from policy_acceptances where version = 'v-sw';
    update system_settings set setting_value = 'true'::jsonb where setting_key = 'retention_jobs_enabled';
    j := public.run_retention_jobs();
    select count(*) into n5 from policy_acceptances where version = 'v-sw';
    r := r || format('R2b %s switch off: the run does nothing and writes no journal row (skipped=%s, rows %s -> %s); the text "true" and the number 1 do not turn it on (%s of 2 skipped); the due record stays (%s, want 1); switched on it goes (%s, want 0)',
      case when bl and n = n2 and n3 = 2 and n4 = 1 and n5 = 0 and (j ->> 'errors') = '0' then 'ok' else 'FAIL' end, bl, n, n2, n3, n4, n5) || E'\n';
    m := pg_temp.owner_err($q$select public.retention_schedule_job('no_such_extension')$q$, 'pg_cron is not installed');
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
      perform public.retention_schedule_job();
      perform public.retention_schedule_job();
      execute 'select count(*) = 1 and bool_and(schedule = ''40 3 * * *'' and command = ''select public.run_retention_jobs();'') from cron.job where jobname = ''run-retention-jobs''' into bl;
    else
      bl := true;
    end if;
    r := r || 'R2c ' || case when m = '' and bl then 'ok' else 'FAIL' end || ' scheduling fails loudly without pg_cron and scheduling twice leaves exactly one job at 03:40 (' || bl || ')' || m || E'\n';
    -- R9: the money cutoff with no year-end chosen is the later of date + 8 years and date + 1 year + the years setting
    update system_settings set setting_value = '10'::jsonb where setting_key = 'retention_money_years';
    n := (public.retention_money_cutoff(date '2019-03-15') = date '2030-03-15')::int;
    update system_settings set setting_value = '7'::jsonb where setting_key = 'retention_money_years';
    n := n + (public.retention_money_cutoff(date '2019-03-15') = date '2027-03-15')::int;
    update system_settings set setting_value = '3'::jsonb where setting_key = 'retention_money_years';
    n := n + (public.retention_money_cutoff(date '2019-03-15') = date '2027-03-15')::int;
    update system_settings set setting_value = '10'::jsonb where setting_key = 'retention_money_years';
    update system_settings set setting_value = '3'::jsonb where setting_key = 'retention_financial_year_end_month';
    n := n + (public.retention_money_cutoff(date '2019-03-15') = date '2029-03-31')::int;
    update system_settings set setting_value = '7'::jsonb where setting_key = 'retention_money_years';
    update system_settings set setting_value = 'null'::jsonb where setting_key = 'retention_financial_year_end_month';
    r := r || format('R9a %s the money cutoff, no year-end: years 10 -> +11, years 7 -> +8, years 3 (below the floor) -> +8; with a March year-end and years 10 -> 31 Mar 2029 (%s of 4)',
      case when n = 4 then 'ok' else 'FAIL' end, n) || E'\n';
    -- R18: the status names and the foreign keys are checked, and a mismatch fails the category
    m := pg_temp.owner_ok($q$select public.retention_assert_names('public.sessions', 'status', array['completed', 'cancelled_by_tutor', 'cancelled_by_student', 'pending_confirmation', 'scheduled', 'in_progress'])$q$)
      || pg_temp.owner_ok($q$select public.retention_assert_names('public.payouts', 'status', array['pending', 'processing', 'paid', 'failed'])$q$)
      || pg_temp.owner_ok($q$select public.retention_assert_names('public.platform_disputes', 'status', array['open', 'under_investigation', 'resolved_refunded', 'resolved_payout', 'dismissed'])$q$)
      || pg_temp.owner_ok($q$select public.retention_assert_names('public.session_requests', 'payment_status', array['paid', 'refunded', 'unpaid'])$q$)
      || pg_temp.owner_err($q$select public.retention_assert_names('public.sessions', 'status', array['completed', 'compleet'])$q$, 'compleet')
      || pg_temp.owner_err($q$select public.retention_assert_names('public.payouts', 'status', array['paid', 'settled'])$q$, 'settled')
      || pg_temp.owner_err($q$select public.retention_assert_names('public.session_requests', 'payment_status', array['aid'])$q$, 'aid')
      || pg_temp.owner_err($q$select public.retention_assert_names('public.sessions', 'no_such_column', array['x'])$q$, 'does not exist');
    r := r || 'R18a ' || case when m = '' then 'ok' else 'FAIL' end || ' status names are checked against the enum or the CHECK list: right names pass; a misspelt, an unlisted and a partial name ("aid" is not "paid") and a missing column are refused' || m || E'\n';
    m := pg_temp.owner_ok($q$select public.retention_assert_foreign_keys('public.sessions', array['conversations.session_id:n', 'notifications.related_session_id:n', 'payout_sessions.session_id:c', 'platform_disputes.session_id:c', 'reviews.session_id:c', 'session_requests.resulting_session_id:n', 'video_rooms.session_id:c'])$q$)
      || pg_temp.owner_ok($q$select public.retention_assert_foreign_keys('public.payouts', array['payout_sessions.payout_id:c'])$q$)
      || pg_temp.owner_ok($q$select public.retention_assert_foreign_keys('public.tutor_verification_documents', array['tutor_credentials.document_id:n', 'tutor_verification_audits.document_id:c'])$q$)
      || pg_temp.owner_err($q$select public.retention_assert_foreign_keys('public.payouts', array['payout_sessions.payout_id:c', 'ghost.x:c'])$q$, 'missing ghost.x:c')
      || pg_temp.owner_err($q$select public.retention_assert_foreign_keys('public.payouts', array['payout_sessions.payout_id:n'])$q$, 'unexpected payout_sessions.payout_id:c');
    create table public.rt_fk_child (session_id uuid references public.sessions (id) on delete cascade);
    m := m || pg_temp.owner_err($q$select public.retention_assert_foreign_keys('public.sessions', array['conversations.session_id:n', 'notifications.related_session_id:n', 'payout_sessions.session_id:c', 'platform_disputes.session_id:c', 'reviews.session_id:c', 'session_requests.resulting_session_id:n', 'video_rooms.session_id:c'])$q$, 'unexpected rt_fk_child.session_id:c');
    j := public.run_retention_jobs(); run8 := (j ->> 'run_id')::uuid;
    select error into t from retention_deletion_records where run_id = run8 and category = 'money_records';
    select count(*) into n from retention_deletion_records where run_id = run8 and error is null;
    drop table public.rt_fk_child;
    r := r || format('R18b %s foreign keys: the real ones on dev match; a missing key, a changed action and a NEW cascading key on sessions are refused, and with the new key the money category fails alone (errors=%s, its journal row says "%s", the other %s rows have no error)',
      case when m = '' and (j ->> 'errors') = '1' and t like 'The foreign keys on sessions are not what the retention job expects: unexpected rt_fk_child.session_id:c%' and n = 4 then 'ok' else 'FAIL' end,
      j ->> 'errors', left(t, 60), n) || m || E'\n';
    insert into hand_over_events (event, subject_id, admin_id, authority, reference, requester_name, requester_role, requester_organisation, requester_phone, requester_email,
                                  verified_how, reason, approved_by, tutor_told, scope, contents)
      values ('prepared', pg_temp.mk('tutor'), a1, 'warrant', 'RT-2', 'Officer', 'Captain', 'SAPS', '0110000000', 'o@example.invalid', 'called back', 'rt', 'lead', 'not told', array['profile'], '{}'::jsonb)
      returning id, subject_id into hid2, h5;
    bl := public.retention_person_protected(h5);
    insert into hand_over_events (event, hand_over_id, subject_id, admin_id, delivery_method, delivery_address) values ('delivered', gen_random_uuid(), h5, a1, 'in person', 'station');
    bl2 := public.retention_person_protected(h5);
    insert into hand_over_events (event, hand_over_id, subject_id, admin_id, delivery_method, delivery_address) values ('delivered', hid2, h5, a1, 'in person', 'station');
    r := r || format('R18c %s hand-over match: prepared = protected (%s); a delivery that names another prepared line does not end it (%s); one that names this line does (%s, want false)',
      case when bl and bl2 and not public.retention_person_protected(h5) then 'ok' else 'FAIL' end, bl, bl2, public.retention_person_protected(h5)) || E'\n';
  exception when others then
    reset role;
    r := r || 'L ERROR ' || left(sqlerrm, 200) || E'\n';
  end;

  -- ============ M. only settled money goes; a request waits for its session, payout lines and reports; reviews and rooms go with sessions ====
  begin
    update system_settings set setting_value = 'null'::jsonb where setting_key = 'retention_financial_year_end_month';
    ms := pg_temp.mk('student'); mtt := pg_temp.mk('tutor');
    sb[1] := pg_temp.mks(ms, mtt, ms, d9, 'completed'); rb[1] := pg_temp.mkr(ms, ms, mtt, sb[1], d9, 'paid');                      -- settled and clean: goes
    sb[2] := pg_temp.mks(ms, mtt, ms, d9, 'completed'); rb[2] := pg_temp.mkr(ms, ms, mtt, sb[2], d9, 'charging');                  -- in flight (not on the old deny-list)
    sb[3] := pg_temp.mks(ms, mtt, ms, d9, 'completed'); rb[3] := pg_temp.mkr(ms, ms, mtt, sb[3], d9, 'initiated');                 -- in flight (not on the old deny-list)
    sb[4] := pg_temp.mks(ms, mtt, ms, d9, 'completed'); rb[4] := pg_temp.mkr(ms, ms, mtt, sb[4], d9, 'paid');
    update session_requests set card_check_refund_status = 'not refunded: rt' where id = rb[4];                                     -- card-check refund failed
    sb[5] := pg_temp.mks(ms, mtt, ms, d9, 'completed'); rb[5] := pg_temp.mkr(ms, ms, mtt, sb[5], d9, 'paid');
    update session_requests set charge_check_request_id = -1 where id = rb[5];                                                      -- charge check alarm
    rb[6] := pg_temp.mkr(ms, ms, mtt, null, d9, 'paid');                                                                            -- paid, still unmatched (status pending)
    sb[7] := pg_temp.mks(ms, mtt, ms, d9, 'scheduled'); rb[7] := pg_temp.mkr(ms, ms, mtt, sb[7], d9, 'paid');                      -- session not finished
    sb[8] := pg_temp.mks(ms, mtt, ms, d9, 'completed'); rb[8] := pg_temp.mkr(ms, ms, mtt, sb[8], d9, 'paid');                      -- a payout line still points at the session
    insert into payouts (tutor_id, period_start, period_end, total_amount, status, created_at) values (mtt, d9::date - 7, d9::date, 80, 'pending', d9) returning id into x1;
    pb[2] := x1;
    insert into payout_sessions (payout_id, session_id) values (pb[2], sb[8]);
    sb[9] := pg_temp.mks(ms, mtt, ms, d9, 'completed'); rb[9] := pg_temp.mkr(ms, ms, mtt, sb[9], d9, 'paid');                      -- a report not yet due points at the session
    dr := pg_temp.mkd(sb[9], ms, 'dismissed', now() - interval '1 year');
    rb[10] := pg_temp.mkr(ms, ms, mtt, null, d9, 'refunded'); update session_requests set status = 'cancelled' where id = rb[10];  -- refunded and cancelled: goes
    sb[11] := pg_temp.mks(ms, mtt, ms, d9, 'completed');
    insert into payouts (tutor_id, period_start, period_end, total_amount, status, paid_at, created_at) values (mtt, d9::date - 7, d9::date, 80, 'paid', d9, d9) returning id into x1;
    pb[1] := x1;
    insert into payout_sessions (payout_id, session_id) values (pb[1], sb[11]);
    insert into payouts (tutor_id, period_start, period_end, total_amount, status, created_at) values (mtt, d9::date - 7, d9::date, 80, 'failed', d9) returning id into x1;
    pb[3] := x1;
    insert into payouts (tutor_id, period_start, period_end, total_amount, status, created_at) values (mtt, d9::date - 7, d9::date, 80, 'processing', d9) returning id into x1;
    pb[4] := x1;
    sb[12] := pg_temp.mks(ms, mtt, ms, d9, 'completed');
    insert into reviews (session_id, tutor_id, student_id, rating, comment) values (sb[12], mtt, ms, 5, 'rt');
    insert into video_rooms (code, host_id, session_id, created_at, expires_at, ended_at) values ('ABCDEFGH', mtt, sb[12], d9, d9 + interval '1 hour', d9 + interval '30 minutes') returning id into vr1;
    insert into video_room_members (room_id, profile_id, status) values (vr1, ms, 'left');
    sb[13] := pg_temp.mks(ms, mtt, ms, d9, 'completed');
    insert into video_rooms (code, host_id, session_id, created_at, expires_at) values ('JKLMNPQR', mtt, sb[13], d9, now() + interval '1 day');
    j := public.run_retention_jobs(); run9 := (j ->> 'run_id')::uuid;
    select count(*) into n from session_requests where id in (rb[2], rb[3], rb[4], rb[5], rb[6]);
    select count(*) into n2 from payouts where id in (pb[3], pb[4]);
    r := r || format('R3a %s unsettled money stays: payment charging, initiated, card-check refund not made, charge-check alarm and an unmatched paid request (%s of 5), failed and processing payouts (%s of 2)',
      case when n = 5 and n2 = 2 then 'ok' else 'FAIL' end, n, n2) || E'\n';
    select (deleted ->> 'payouts')::int, (deleted ->> 'payout_sessions')::int, (deleted ->> 'session_requests')::int, (deleted ->> 'sessions')::int, (deleted ->> 'reviews')::int, (deleted ->> 'video_rooms')::int
      into n, n2, n3, n4, n5, n6 from retention_deletion_records where run_id = run9 and category = 'money_records';
    select (deleted ->> 'video_room_members')::int into nlines from retention_deletion_records where run_id = run9 and category = 'money_records';
    select count(*) into nfail from session_requests where id in (rb[1], rb[10]);
    r := r || format('R3b %s settled money goes: the paid payout %s with its line %s, the paid and the refunded-and-cancelled requests %s (left=%s), their sessions %s (want 3: sb1, the payout line one, the one with a review and room), review %s, room %s, room member %s',
      case when n = 1 and n2 = 1 and n3 = 2 and nfail = 0 and n4 = 3 and n5 = 1 and n6 = 1 and nlines = 1 then 'ok' else 'FAIL' end, n, n2, n3, nfail, n4, n5, n6, nlines) || E'\n';
    select count(*) into n from session_requests where id in (rb[7], rb[8], rb[9]);
    select count(*) into n2 from sessions where id in (sb[7], sb[8], sb[9], sb[2], sb[3], sb[4], sb[5]);
    select count(*) into n3 from sessions where id in (sb[1], sb[11], sb[12]);
    r := r || format('R4a %s a settled request stays while its session is not finished, while a payout line points at the session and while a report not yet due does (%s of 3); their sessions and those of the unsettled requests stay (%s of 7); the 3 free sessions are gone (left=%s)',
      case when n = 3 and n2 = 7 and n3 = 0 then 'ok' else 'FAIL' end, n, n2, n3) || E'\n';
    select count(*) into n from sessions where id = sb[13];
    update video_rooms set ended_at = now() where session_id = sb[13];
    update payouts set status = 'paid', paid_at = d9 where id = pb[2];
    update platform_disputes set resolved_at = now() - interval '6 years', created_at = now() - interval '6 years' where id = dr;
    j := public.run_retention_jobs(); run10 := (j ->> 'run_id')::uuid;
    select count(*) into n2 from session_requests where id in (rb[8], rb[9]);
    select count(*) into n3 from sessions where id in (sb[8], sb[9], sb[13]);
    select count(*) into n4 from session_requests where id = rb[7];
    select count(*) into n5 from sessions where id = sb[7];
    select count(*) into n6 from payouts where id = pb[2];
    r := r || format('R4b %s once the payout is paid (its line goes) and the report is due (it goes), the two requests go (left=%s) with their sessions and the session whose room is now ended (left=%s; before: %s, want 1 while the room was open); the one whose session is unfinished stays (%s, %s)',
      case when n = 1 and n2 = 0 and n3 = 0 and n4 = 1 and n5 = 1 and n6 = 0 and (j ->> 'errors') = '0' then 'ok' else 'FAIL' end, n2, n3, n, n4, n5) || E'\n';
  exception when others then
    reset role;
    r := r || 'M ERROR ' || left(sqlerrm, 200) || E'\n';
  end;

  -- ============ N. a consent row naming two people goes only when both have closed ====================================================
  begin
    g5 := pg_temp.mk('student'); l5 := pg_temp.mk('student');
    perform pg_temp.tomb(l5, 2192);
    insert into guardian_consents (guardian_profile_id, learner_profile_id, consent_text_version) values (g5, l5, 'v-r5');
    insert into policy_acceptances (profile_id, accepted_by_profile_id, document, version, accepted_at, method) values (l5, g5, 'terms', 'v-r5', now() - interval '6 years', 'signup_checkbox');
    insert into policy_acceptances (profile_id, accepted_by_profile_id, document, version, accepted_at, method) values (l5, l5, 'privacy', 'v-r5', now() - interval '6 years', 'signup_checkbox');
    insert into school_results_consents (student_id, consented_by, consent_version, consented_at) values (l5, g5, 'v-r5', now());
    j := public.run_retention_jobs();
    select (select count(*) from guardian_consents where consent_text_version = 'v-r5'), (select count(*) from policy_acceptances where version = 'v-r5' and accepted_by_profile_id = g5),
           (select count(*) from policy_acceptances where version = 'v-r5' and accepted_by_profile_id = l5), (select count(*) from school_results_consents where consent_version = 'v-r5')
      into n, n2, n3, n4;
    perform pg_temp.tomb(g5, 2192);
    j := public.run_retention_jobs();
    select (select count(*) from guardian_consents where consent_text_version = 'v-r5') + (select count(*) from policy_acceptances where version = 'v-r5') + (select count(*) from school_results_consents where consent_version = 'v-r5')
      into n5;
    r := r || format('R5a %s the learner closed 6 years ago but the guardian has not: the guardian consent, the acceptance the guardian made and the school-results consent stay (%s, %s, %s of 1 each); the learner''s own acceptance goes (left=%s); once the guardian has closed too all go (left=%s)',
      case when n = 1 and n2 = 1 and n3 = 0 and n4 = 1 and n5 = 0 then 'ok' else 'FAIL' end, n, n2, n4, n3, n5) || E'\n';
  exception when others then
    reset role;
    r := r || 'N ERROR ' || left(sqlerrm, 200) || E'\n';
  end;

  -- ============ O. the tombstone: minimum age, a finished closure, nothing open, kept files and steps =======================================
  begin
    t_age := pg_temp.mk('student'); perform pg_temp.tomb(t_age, 730);
    delete from policy_acceptances where profile_id = t_age;   -- so the minimum age is the only thing keeping this tombstone
    t_unf := pg_temp.mk('student'); perform pg_temp.tomb(t_unf, 2192);
    insert into account_closures (profile_id, role, status, started_by, started_how, was_adult, due_at, outer_limit_at, undo_until) values (t_unf, 'student', 'db_deleted', a1, 'admin_request', true, now(), now(), now());
    t_und := pg_temp.mk('student'); perform pg_temp.tomb(t_und, 2192);
    insert into account_closures (profile_id, role, status, started_by, started_how, was_adult, due_at, outer_limit_at, undo_until) values (t_und, 'student', 'undone', a1, 'admin_request', true, now(), now(), now());
    t_task := pg_temp.mk('student'); perform pg_temp.tomb(t_task, 2192);
    insert into account_closures (profile_id, role, status, started_by, started_how, was_adult, due_at, outer_limit_at, undo_until) values (t_task, 'student', 'done', a1, 'admin_request', true, now(), now(), now());
    insert into account_closure_tasks (closure_id, profile_id, kind, payload) values (gen_random_uuid(), t_task, 'email', '{}'::jsonb);
    t_ok := pg_temp.mk('student'); perform pg_temp.tomb(t_ok, 2192);
    insert into account_closures (profile_id, role, status, started_by, started_how, asked_by, how_verified, reference, note, was_adult, due_at, outer_limit_at, undo_until, deferred_reason, undone_note)
      values (t_ok, 'student', 'done', a1, 'admin_request', 'Zed Asked', 'phoned back', 'REF-9', 'a note', true, now(), now(), now(), 'keepme', 'Zed Asked / phoned back / a note');
    t_none := pg_temp.mk('student'); perform pg_temp.tomb(t_none, 2192);
    j := public.run_retention_jobs();
    select count(*) into n from account_tombstones where profile_id in (t_age, t_unf, t_und, t_task);
    select count(*) into n2 from account_tombstones where profile_id in (t_ok, t_none);
    select (asked_by is null and how_verified is null and reference is null and note is null and undone_note is null), deferred_reason = 'keepme', closed_at is not null
      into bl, bl2, bl3 from account_closures where profile_id = t_ok;
    r := r || format('R8a %s tombstones stay for: closed only 2 years ago, a closure still at db_deleted, a person whose closure was undone, a person with an email step still open (%s of 4); a finished closure past the minimum age (and a legacy tombstone with no closure row) is destroyed (left=%s); its names are blanked=%s, the deferral reason kept=%s and the closing date kept=%s',
      case when n = 4 and n2 = 0 and bl and bl2 and bl3 then 'ok' else 'FAIL' end, n, n2, bl, bl2, bl3) || E'\n';
    update account_closures set status = 'done' where profile_id = t_unf;
    update account_closure_tasks set status = 'done' where profile_id = t_task;
    update account_tombstones set closed_at = now() - interval '4 years' where profile_id = t_age;
    j := public.run_retention_jobs();
    select count(*) into n from account_tombstones where profile_id in (t_unf, t_task, t_age);
    select count(*) into n2 from account_tombstones where profile_id = t_und;
    r := r || format('R8b %s once the closure is finished, the step done and the minimum age passed they go too (left=%s); the undone one still stays (%s, want 1)',
      case when n = 0 and n2 = 1 then 'ok' else 'FAIL' end, n, n2) || E'\n';
    t_file := gen_random_uuid(); t_open := gen_random_uuid(); t_done := gen_random_uuid(); x1 := gen_random_uuid();
    insert into storage.objects (bucket_id, name) values ('tutor-documents', t_file || '/f.pdf');
    insert into storage.objects (bucket_id, name) values ('school-results', x1 || '/r.pdf');
    insert into account_closure_tasks (closure_id, profile_id, kind, payload) values (gen_random_uuid(), t_open, 'storage_remove', '{}'::jsonb);
    insert into account_closure_tasks (closure_id, profile_id, kind, payload, status) values (gen_random_uuid(), t_done, 'storage_remove', '{}'::jsonb, 'done');
    n := public.retention_has_kept_records(t_file)::int + public.retention_has_kept_records(x1)::int + public.retention_has_kept_records(t_open)::int;
    n2 := public.retention_has_kept_records(t_done)::int + public.retention_has_kept_records(gen_random_uuid())::int;
    bl := position('tutor_verification_audits' in pg_get_functiondef('public.retention_has_kept_records(uuid)'::regprocedure)) > 0;
    r := r || format('R7a %s a tombstone is kept while the person has a stored file in tutor-documents or school-results, or a file-removal step still open (%s of 3); a finished step or nothing at all does not keep it (%s, want 0); the audit lines are in the test (%s; an audit line cannot exist without its document, so it cannot be isolated)',
      case when n = 3 and n2 = 0 and bl then 'ok' else 'FAIL' end, n, n2, bl) || E'\n';
  exception when others then
    reset role;
    r := r || 'O ERROR ' || left(sqlerrm, 200) || E'\n';
  end;

  -- ============ P. files: a tutor with no profile row is still found; a path held only in a row is queued next to an open step ==============
  begin
    ghost := gen_random_uuid(); perform pg_temp.tomb(ghost, 1461);
    insert into storage.objects (bucket_id, name) values ('tutor-documents', ghost || '/g.pdf');
    tm := pg_temp.mk('tutor'); perform pg_temp.tomb(tm, 1461);
    tm_doc := pg_temp.mkdoc(tm, 'both.pdf', now() - interval '5 years');
    insert into tutor_verification_documents (tutor_id, document_type, document_url, uploaded_at) values (tm, 'identity_doc', tm || '/only-url.pdf', now() - interval '5 years');
    insert into tutor_credentials (tutor_id, credential_code, document_id, status) values (tm, 'practicum_complete', tm_doc, 'pending');
    insert into tutor_verification_audits (tutor_id, document_id, decision) values (tm, tm_doc, 'verified');
    perform public.closure_enqueue_files(gen_random_uuid(), tm, 'tutor-documents', array[tm || '/both.pdf']);
    j := public.run_retention_jobs(); run11 := (j ->> 'run_id')::uuid;
    select count(*) into n from account_closure_tasks where profile_id = ghost and kind = 'storage_remove' and payload -> 'paths' ? (ghost || '/g.pdf');
    r := r || format('R11a %s a closed tutor whose profile row is gone (only a stored file is left) is still found: its file is queued for removal (%s step, want 1)', case when n = 1 then 'ok' else 'FAIL' end, n) || E'\n';
    select count(*), count(*) filter (where jsonb_array_length(payload -> 'paths') = 1 and payload -> 'paths' ? (tm || '/only-url.pdf')) into n, n2
      from account_closure_tasks where profile_id = tm and kind = 'storage_remove';
    select count(*) into n3 from tutor_verification_documents where tutor_id = tm;
    r := r || format('R13a %s an earlier file step is still open for tm, yet the path held only in a row (only-url.pdf) is queued in a step of its own: %s steps in all (want 2), %s with exactly that path (1); the rows are gone (%s)',
      case when n = 2 and n2 = 1 and n3 = 0 then 'ok' else 'FAIL' end, n, n2, n3) || E'\n';
    select (deleted ->> 'tutor_verification_documents')::int, (deleted ->> 'tutor_verification_audits')::int, (period ->> 'credential_links_emptied')::int, files_queued
      into n, n2, n3, n4 from retention_deletion_records where run_id = run11 and category = 'tutor_documents';
    select count(*) into n5 from tutor_credentials where tutor_id = tm and document_id is null;
    r := r || format('R12a %s the steps are explicit and counted from what each DELETE reported: documents %s (want 2), audit lines %s (1), credential links emptied %s (1, the credential row stays: %s), files queued %s (2: ghost and tm)',
      case when n = 2 and n2 = 1 and n3 = 1 and n5 = 1 and n4 = 2 then 'ok' else 'FAIL' end, n, n2, n3, n5, n4) || E'\n';
  exception when others then
    reset role;
    r := r || 'P ERROR ' || left(sqlerrm, 200) || E'\n';
  end;

  -- ============ Q. a report is protected by the other people on it ===========================================================================
  begin
    rl := pg_temp.mk('student'); resp := pg_temp.mk('tutor');
    sr := pg_temp.mks(rl, resp, rl, now() - interval '2 days', 'completed'); dr := pg_temp.mkd(sr, rl, 'dismissed', now() - interval '2192 days');
    perform pg_temp.call_as(a1, format($q$select public.place_safety_hold(%L, 'rt hold')$q$, resp));
    j := public.run_retention_jobs();
    select count(*) into n from platform_disputes where id = dr;
    perform pg_temp.call_as(a1, format($q$select public.release_safety_hold(%L, 'cleared')$q$, resp));
    j := public.run_retention_jobs();
    select count(*) into n2 from platform_disputes where id = dr;
    r := r || format('R6a %s a report raised by a free learner stays while the person it is about (the session''s tutor) is on a safety hold (%s, want 1) and goes when the hold is released (%s, want 0)', case when n = 1 and n2 = 0 then 'ok' else 'FAIL' end, n, n2) || E'\n';
  exception when others then
    reset role;
    r := r || 'Q ERROR ' || left(sqlerrm, 200) || E'\n';
  end;

  -- ============ R. how the new parts are built, and the lock key ============================================================================
  begin
    arr := array['retention_jobs_are_on', 'retention_years', 'retention_run_cap', 'retention_assert_names', 'retention_assert_foreign_keys', 'retention_all_closed_before', 'retention_person_blocked',
                 'retention_any_blocked', 'retention_dispute_people', 'retention_closure_finished', 'retention_due_payouts', 'retention_due_requests', 'retention_due_sessions', 'retention_schedule_job'];
    select count(*) filter (where not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')),
           count(*) filter (where p.proconfig::text like '%search_path=public%'), count(*) filter (where p.prosecdef), count(*)
      into n, n2, n3, n4 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(arr);
    select count(*) into n5 from system_settings where setting_key in ('retention_jobs_enabled', 'retention_max_per_run');
    r := r || format('K7 %s the 14 functions added in review: open to no API role (%s), pinned search path (%s), definers (%s), found=%s; the 2 new setting rows exist (%s)',
      case when n = 14 and n2 = 14 and n3 = 14 and n4 = 14 and n5 = 2 then 'ok' else 'FAIL' end, n, n2, n3, n4, n5) || E'\n';
    x1 := pg_temp.mk('student'); y5 := pg_temp.mk('student');
    bl := public.retention_person_protected(x1);
    perform pg_temp.call_as(a1, format($q$select public.place_safety_hold(%L, 'rt hold')$q$, y5));
    select count(*) into n from pg_locks l where l.pid = pg_backend_pid() and l.locktype = 'advisory'
      and l.classid::bigint = ((hashtextextended('safety_hold:' || x1::text, 0) >> 32) & 4294967295) and l.objid::bigint = (hashtextextended('safety_hold:' || x1::text, 0) & 4294967295);
    select count(*) into n2 from pg_locks l where l.pid = pg_backend_pid() and l.locktype = 'advisory'
      and l.classid::bigint = ((hashtextextended('safety_hold:' || y5::text, 0) >> 32) & 4294967295) and l.objid::bigint = (hashtextextended('safety_hold:' || y5::text, 0) & 4294967295);
    r := r || format('R14a %s the lock the retention check takes for a person is the one place_safety_hold takes (hashtextextended of safety_hold:<id>): retention lock held=%s, the hold''s own lock found by the same key=%s (both 1); the person was not protected (%s)',
      case when n = 1 and n2 = 1 and not bl then 'ok' else 'FAIL' end, n, n2, bl) || E'\n';
  exception when others then
    reset role;
    r := r || 'R ERROR ' || left(sqlerrm, 200) || E'\n';
  end;

  -- ============ S. telling the admins or waking the Worker fails: the run still stands and each failure is journalled (last: it replaces two functions) ====
  begin
    create or replace function public.notify_active_admins(p_type text, p_title text, p_body text, p_session_id uuid default null) returns void language plpgsql as $f$ begin raise exception 'rt notice boom'; end $f$;
    create or replace function public.closure_wake_worker() returns void language plpgsql as $f$ begin raise exception 'rt wake boom'; end $f$;
    create or replace function public.rt_boom() returns trigger language plpgsql as $f$ begin raise exception 'rt boom'; end $f$;
    x1 := pg_temp.mk('student'); x2 := pg_temp.mk('tutor');
    sr := pg_temp.mks(x1, x2, x1, now() - interval '2 days', 'completed'); dr := pg_temp.mkd(sr, x1, 'dismissed', now() - interval '2192 days');
    create trigger rt_boom2 before delete on public.platform_disputes for each row execute function public.rt_boom();
    tn := pg_temp.mk('tutor'); perform pg_temp.tomb(tn, 1461); perform pg_temp.mkdoc(tn, 'x.pdf', now() - interval '5 years');
    j := public.run_retention_jobs(); run12 := (j ->> 'run_id')::uuid;
    drop trigger rt_boom2 on public.platform_disputes;
    select count(*), count(*) filter (where error is null), count(*) filter (where category = 'problem_reports' and error = 'rt boom'),
           count(*) filter (where category = 'admin_notice' and error = 'rt notice boom'), count(*) filter (where category = 'worker_wake' and error = 'rt wake boom')
      into n, n2, n3, n4, n5 from retention_deletion_records where run_id = run12;
    select count(*) into n6 from tutor_verification_documents where tutor_id = tn;
    select count(*) into nlines from platform_disputes where id = dr;
    select count(*) into nfail from account_closure_tasks where profile_id = tn and kind = 'storage_remove' and closure_id = run12;
    r := r || format('R10a %s the notice and the wake-up fail: the run completes (errors=%s want 1, notice_errors=%s want 2), 7 journal rows (%s) of which 4 are clean (%s) and the 3 failures are named: category %s, notice %s, wake %s (1 each); the tutor''s documents were still deleted (left=%s) and the file step queued (%s); the failed category left its report alone (%s)',
      case when (j ->> 'errors') = '1' and (j ->> 'notice_errors') = '2' and n = 7 and n2 = 4 and n3 = 1 and n4 = 1 and n5 = 1 and n6 = 0 and nfail = 1 and nlines = 1 then 'ok' else 'FAIL' end,
      j ->> 'errors', j ->> 'notice_errors', n, n2, n3, n4, n5, n6, nfail, nlines) || E'\n';
  exception when others then
    reset role;
    r := r || 'S ERROR ' || left(sqlerrm, 200) || E'\n';
  end;

  -- ============ the report ===================================================================================================
  -- (FAIL and ERROR lines first and in full, then the passing lines shortened to their id: the Supabase tool cuts a long answer in the middle.)
  old_report := coalesce(current_setting('test.report', true), '');
  select count(*) filter (where l ~ 'FAIL' or l ~ 'ERROR'), count(*) into nfail, nlines from regexp_split_to_table(r, E'\n') as x(l) where l <> '';
  select string_agg(case when l ~ 'FAIL' or l ~ 'ERROR' then left(l, 400) else left(l, 36) end, E'\n' order by (case when l ~ 'FAIL' or l ~ 'ERROR' then 0 else 1 end), o) into rep
    from regexp_split_to_table(r, E'\n') with ordinality as x(l, o) where l <> '';
  rep := format(E'RETENTION-JOBS TEST (rolled back): %s FAIL/ERROR line(s) in %s lines\n%s', nfail, nlines, rep);
  if coalesce(current_setting('test.runner', true), '') = 'on' then
    perform set_config('test.report', rep, true);
  else
    raise exception E'%', rep;
  end if;
end $$;
