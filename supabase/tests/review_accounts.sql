-- Rolled-back test of the temporary review logins (migration 20261103120100_review_accounts.sql). See README.md.
-- Run the migration and this file in ONE rolled-back statement (the audit-label file 20261103120000 only adds enum values and is left out):
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/review_accounts.sql supabase/migrations/20261103120100_review_accounts.sql
-- Before the labels are committed the audit helper is replaced by a recorder (A-lines); its real insert is proved with an existing label (A1).
-- On a database that already has both migrations, paste this file alone (it raises its own report). Fixtures are made-up people; nothing is kept.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  minor text := (current_date - interval '16 years')::date::text;
  pa uuid; la uuid; ta uuid;                       -- the clean batch: parent, learner under 18, tutor, all expired
  pn uuid; px uuid; ty uuid; xs uuid;             -- a parent not yet expired, a real (unregistered) parent, tutor and learner
  b1 uuid; b2 uuid; b3 uuid; b4 uuid; b5 uuid; b6 uuid; b7 uuid;  -- one kept account per reason
  b8p uuid; b8l uuid;                              -- a kept parent and its learner
  e1 uuid;                                         -- an account whose deletion fails
  a_fin uuid := gen_random_uuid(); a_sup uuid := gen_random_uuid(); a_spt uuid := gen_random_uuid(); a_off uuid := gen_random_uuid();
  c uuid; j jsonb; t text; n0 int; n1 int; nl int; nf int; xled int;
begin
  begin
  execute $mk$ create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
      select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
             || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n' $f$ $mk$;
  execute $mk$ create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
    begin execute p_sql; return 'ok'; exception when others then return 'ERR: ' || sqlerrm; end $f$ $mk$;
  execute $mk$ create function pg_temp.run_as(p_role text, p_sql text) returns text language plpgsql as $f$
    declare v text;
    begin
      execute 'set local role ' || p_role;
      begin execute p_sql into v; reset role; return coalesce(v, 'null');
      exception when others then reset role; return 'ERR: ' || sqlerrm; end;
    end $f$ $mk$;
  execute $mk$ create function pg_temp.has(p_res text, p_part text) returns text language sql as $f$
      select case when position(p_part in coalesce(p_res, '')) > 0 then 'yes' else coalesce(p_res, 'null') end $f$ $mk$;
  execute $mk$ create function pg_temp.mk(p_role text) returns uuid language plpgsql as $f$
    declare v uuid := gen_random_uuid();
    begin
      insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
      values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rv.' || v || '@example.invalid',
              jsonb_build_object('role', p_role, 'first_name', 'Rev', 'date_of_birth', (current_date - interval '30 years')::date::text, 'phone_number', '081 234 5678'), '{}');
      update public.profiles set date_of_birth = (current_date - interval '30 years')::date where id = v;
      return v;
    end $f$ $mk$;
  execute $mk$ create function pg_temp.mk_minor(p_guardian uuid) returns uuid language plpgsql as $f$
    declare v uuid := gen_random_uuid();
    begin
      insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
      values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rv.' || v || '@example.invalid',
              jsonb_build_object('role', 'student', 'first_name', 'Kid', 'date_of_birth', (current_date - interval '16 years')::date::text),
              jsonb_build_object('created_by_guardian', p_guardian, 'relationship', 'guardian'));
      return v;
    end $f$ $mk$;
  execute $mk$ create function pg_temp.reg(p_id uuid, p_purpose text) returns void language sql as $f$
      insert into public.review_accounts (user_id, purpose, expires_at) values (p_id, p_purpose, now() - interval '1 hour') $f$ $mk$;
  -- how many rows of the listed tables still name this person
  execute $mk$ create function pg_temp.left_over(p_id uuid) returns int language plpgsql as $f$
    declare x text; n int := 0; k int;
    begin
      foreach x in array array['auth.users.id', 'public.profiles.id', 'public.parent_profiles.id', 'public.student_profiles.id', 'public.tutor_profiles.id',
          'public.parent_student_links.parent_id', 'public.parent_student_links.student_id', 'public.guardian_consents.learner_profile_id',
          'public.policy_acceptances.profile_id', 'public.notifications.profile_id', 'public.messages.sender_id', 'public.conversations.student_id',
          'public.conversations.tutor_id', 'public.learner_tutor_choices.learner_id', 'public.learner_tutor_choices.chosen_by',
          'public.tutor_availability.tutor_id', 'public.wallets.profile_id'] loop
        execute format('select count(*) from %s.%s where %I = $1', split_part(x, '.', 1), split_part(x, '.', 2), split_part(x, '.', 3)) into k using p_id;
        n := n + k;
      end loop;
      return n;
    end $f$ $mk$;

  -- ---- people ---------------------------------------------------------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
    (a_fin, z, 'authenticated', 'authenticated', 'rv.a1.' || a_fin || '@example.invalid', '{}'::jsonb, '{}'),
    (a_sup, z, 'authenticated', 'authenticated', 'rv.a2.' || a_sup || '@example.invalid', '{}'::jsonb, '{}'),
    (a_spt, z, 'authenticated', 'authenticated', 'rv.a3.' || a_spt || '@example.invalid', '{}'::jsonb, '{}'),
    (a_off, z, 'authenticated', 'authenticated', 'rv.a4.' || a_off || '@example.invalid', '{}'::jsonb, '{}');
  insert into public.admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
    (a_fin, 'Fin', 'Manager', 'rv.a1.' || a_fin || '@example.invalid', '', 'finance_manager', true),
    (a_sup, 'Sup', 'Admin', 'rv.a2.' || a_sup || '@example.invalid', '', 'super_admin', true),
    (a_spt, 'Spt', 'Agent', 'rv.a3.' || a_spt || '@example.invalid', '', 'support_agent', true),
    (a_off, 'Off', 'Manager', 'rv.a4.' || a_off || '@example.invalid', '', 'finance_manager', false);
  pa := pg_temp.mk('parent'); la := pg_temp.mk_minor(pa); ta := pg_temp.mk('tutor');
  pn := pg_temp.mk('parent'); px := pg_temp.mk('parent'); ty := pg_temp.mk('tutor'); xs := pg_temp.mk('student');
  b1 := pg_temp.mk('parent'); b2 := pg_temp.mk('parent'); b3 := pg_temp.mk('tutor'); b4 := pg_temp.mk('tutor');
  b5 := pg_temp.mk('parent'); b6 := pg_temp.mk('tutor'); b7 := pg_temp.mk('parent');
  b8p := pg_temp.mk('parent'); b8l := pg_temp.mk_minor(b8p); e1 := pg_temp.mk('tutor');

  -- rows that hang off the clean batch (the foreign keys cascade; messages and choices and the empty wallet are removed by hand)
  perform public.wallet_ensure(pa);
  insert into public.conversations (student_id, tutor_id) values (pa, ta) returning id into c;
  insert into public.messages (conversation_id, sender_id, body) values (c, pa, 'hello'), (c, ta, 'hi');
  insert into public.learner_tutor_choices (learner_id, tutor_id, choice, chosen_by) values (la, ta, 'keep', pa);
  insert into public.tutor_availability (tutor_id, day_of_week, start_time, end_time) values (ta, 1, '09:00', '10:00');
  perform public.wallet_notify(pa, 'rv_test', 'x', 'y');
  -- a real parent and tutor that are NOT review accounts, with a conversation, a wallet and a ledger line: must come through untouched
  insert into public.conversations (student_id, tutor_id) values (px, ty) returning id into c;
  insert into public.messages (conversation_id, sender_id, body) values (c, px, 'real');
  perform public.wallet_post(px, 'topup', 100, 0, 'rv-real-' || px, null, 'real money');

  -- one kept account per reason
  perform public.wallet_post(b1, 'topup', 100, 0, 'rv-b1-' || b1, null, 'x');
  insert into public.wallet_topups (profile_id, reference, amount_rand) values (b2, 'TL-ABCDEF', 100);
  insert into public.payout_requests (tutor_id, amount_rand, bank_name, account_holder, branch_code, account_number) values (b3, 100, 'Bank', 'Holder', '123456', '12345678');
  insert into public.sessions (student_id, tutor_id, scheduled_start, hourly_rate_charged, platform_commission_pct, gross_amount, tutor_payout_amount) values (xs, b4, now() + interval '1 day', 100, 30, 100, 70);
  insert into public.session_requests (student_id, requested_by_profile_id, requested_start) values (b5, b5, now() + interval '2 days');
  insert into public.tutor_verification_documents (tutor_id, document_type, document_url) values (b6, (enum_range(null::public.doc_type))[1], 'x/y.pdf');
  insert into storage.objects (bucket_id, name) values ('tutor-documents', b7::text || '/a.pdf');
  perform public.wallet_post(b8p, 'topup', 50, 0, 'rv-b8-' || b8p, null, 'x');

  perform pg_temp.reg(pa, 'parent'); perform pg_temp.reg(la, 'learner'); perform pg_temp.reg(ta, 'tutor');
  perform pg_temp.reg(b1, 'parent'); perform pg_temp.reg(b2, 'parent'); perform pg_temp.reg(b3, 'tutor'); perform pg_temp.reg(b4, 'tutor');
  perform pg_temp.reg(b5, 'parent'); perform pg_temp.reg(b6, 'tutor'); perform pg_temp.reg(b7, 'parent'); perform pg_temp.reg(b8p, 'parent');
  perform pg_temp.reg(b8l, 'learner'); perform pg_temp.reg(e1, 'tutor');
  insert into public.review_accounts (user_id, purpose, expires_at) values (pn, 'parent', now() + interval '5 days');
  r := r || 'S0 setup: clean batch of 3, 7 accounts kept for 7 reasons, a kept parent + learner, a failing one, one not yet expired, a real parent and tutor, 4 admins' || E'\n';

  -- ---- the table and the rights ------------------------------------------------------------------------------------------------------------
  r := r || pg_temp.chk('T1', 'an expiry given by the caller is kept (5 days)', (select round(extract(epoch from expires_at - created_at) / 86400)::text from public.review_accounts where user_id = pn) , '5');
  insert into public.review_accounts (user_id, purpose) values (gen_random_uuid(), 'tutor') returning user_id into c;
  r := r || pg_temp.chk('T2', 'the default expiry is 14 days', (select round(extract(epoch from expires_at - created_at) / 86400)::text from public.review_accounts where user_id = c), '14');
  delete from public.review_accounts where user_id = c;
  r := r || pg_temp.chk('T3', 'a browser (signed out) cannot read the table', pg_temp.has(pg_temp.run_as('anon', 'select count(*)::text from public.review_accounts'), 'permission denied'), 'yes');
  r := r || pg_temp.chk('T4', 'a signed-in user cannot read the table', pg_temp.has(pg_temp.run_as('authenticated', 'select count(*)::text from public.review_accounts'), 'permission denied'), 'yes');
  r := r || pg_temp.chk('T5', 'a signed-in user cannot add a row', pg_temp.has(pg_temp.run_as('authenticated', $q$insert into public.review_accounts (user_id, purpose) values (gen_random_uuid(), 'tutor')$q$), 'permission denied'), 'yes');
  r := r || pg_temp.chk('T6', 'the server key can read the table', pg_temp.run_as('service_role', 'select (count(*) > 0)::text from public.review_accounts'), 'true');
  c := gen_random_uuid();
  -- one statement at a time: a count in the same statement as the function that inserts would not see the new row
  t := pg_temp.run_as('service_role', format($q$insert into public.review_accounts (user_id, purpose) values (%L, 'tutor') returning 'added'$q$, c));
  select count(*) into nl from public.review_accounts where user_id = c;
  t := t || '/' || nl || '/' || pg_temp.run_as('service_role', format($q$with d as (delete from public.review_accounts where user_id = %L returning 1) select count(*)::text from d$q$, c));
  select count(*) into nl from public.review_accounts where user_id = c;
  r := r || pg_temp.chk('T7', 'the server key can add a row and remove it again', t || '/' || nl, 'added/1/1/0');
  r := r || pg_temp.chk('T8', 'a purpose outside parent / learner / tutor is refused', pg_temp.has(pg_temp.try($q$insert into public.review_accounts (user_id, purpose) values (gen_random_uuid(), 'admin')$q$), 'check constraint'), 'yes');
  r := r || pg_temp.chk('T9', 'no browser or server role can run the nightly job', pg_temp.has(pg_temp.run_as('anon', 'select public.delete_expired_review_accounts()::text'), 'permission denied') || '/'
    || pg_temp.has(pg_temp.run_as('authenticated', 'select public.delete_expired_review_accounts()::text'), 'permission denied') || '/'
    || pg_temp.has(pg_temp.run_as('service_role', 'select public.delete_expired_review_accounts()::text'), 'permission denied'), 'yes/yes/yes');
  r := r || pg_temp.chk('T10', 'the other helpers are closed too', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
     where p.proname in ('review_accounts_audit', 'review_account_keep_reason', 'review_account_raise_alert', 'review_accounts_schedule_job')
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), '0');
  r := r || pg_temp.chk('T11', 'all five functions pin search_path', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
     where p.proname in ('review_accounts_audit', 'review_account_keep_reason', 'review_account_raise_alert', 'delete_expired_review_accounts', 'review_accounts_schedule_job')
       and exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%')), '5');
  r := r || pg_temp.chk('J1', 'the nightly job is scheduled at 02:40', (select schedule from cron.job where jobname = 'delete-expired-review-accounts'), '40 2 * * *');
  r := r || pg_temp.chk('J2', 'scheduling again does not duplicate it', (public.review_accounts_schedule_job())::text || (select count(*)::text from cron.job where jobname = 'delete-expired-review-accounts'), '1');
  r := r || pg_temp.chk('J3', 'without pg_cron the schedule step fails loudly', pg_temp.has(pg_temp.try($q$select public.review_accounts_schedule_job('no_such_extension')$q$), 'pg_cron is not installed'), 'yes');

  -- ---- the audit helper ---------------------------------------------------------------------------------------------------------------------
  c := gen_random_uuid();
  perform public.review_accounts_audit('system_setting_updated', c, '{"probe": true}'::jsonb);
  r := r || pg_temp.chk('A1', 'the helper writes an audit line with no admin (proved with an existing label)', (select (admin_id is null)::text || '/' || target_entity_type from public.admin_audit_logs where target_entity_id = c), 'true/review_account');
  -- the new labels may not be committed yet: from here a recorder stands in for the helper
  execute $mk$ create or replace function public.review_accounts_audit(p_action text, p_user uuid, p_meta jsonb) returns void language plpgsql security definer set search_path = public as $f$
    begin perform set_config('test.audit', coalesce(current_setting('test.audit', true), '') || p_action || ':' || p_user || ';', true); end $f$ $mk$;

  -- ---- the first nightly run ----------------------------------------------------------------------------------------------------------------
  select count(*) into n0 from public.profiles;
  select count(*) into xled from public.wallet_ledger where profile_id = px;
  -- one account fails to delete: a trigger refuses the profile delete for it
  execute $mk$ create function public.rv_test_refuse() returns trigger language plpgsql as $f$ begin if old.id = current_setting('test.refuse', true)::uuid then raise exception 'refused for the test'; end if; return old; end $f$ $mk$;
  execute 'create trigger rv_test_refuse before delete on public.profiles for each row execute function public.rv_test_refuse()';
  perform set_config('test.refuse', e1::text, true);
  j := public.delete_expired_review_accounts();
  select count(*) into n1 from public.profiles;
  r := r || pg_temp.chk('N1', 'deleted / kept / errors / alerts', (j ->> 'deleted') || '/' || (j ->> 'kept') || '/' || (j ->> 'errors') || '/' || (j ->> 'alerts'), '3/9/1/9');
  r := r || pg_temp.chk('N2', 'exactly the three clean accounts left the profiles table', (n0 - n1)::text, '3');
  r := r || pg_temp.chk('N3', 'nothing of the three remains anywhere listed (sign-in, profile, links, messages, choices, wallet...)', (pg_temp.left_over(pa) + pg_temp.left_over(la) + pg_temp.left_over(ta))::text, '0');
  r := r || pg_temp.chk('N4', 'their rows are marked deleted, with no reason', (select count(*)::text from public.review_accounts where user_id in (pa, la, ta) and deleted_at is not null and kept_reason is null), '3');
  r := r || pg_temp.chk('N5', 'the real parent and tutor, their conversation and their money are untouched',
    (select count(*)::text from public.profiles where id in (px, ty)) || '/' || (select count(*)::text from public.messages where sender_id = px) || '/'
    || (select available_rand::text from public.wallets where profile_id = px) || '/' || (select count(*)::text from public.wallet_ledger where profile_id = px), '2/1/100/' || xled);
  r := r || pg_temp.chk('N6', 'the account not yet expired is untouched', (select count(*)::text from public.profiles where id = pn) || '/' || (select (deleted_at is null)::text from public.review_accounts where user_id = pn), '1/true');
  t := '';
  for c in select unnest(array[b1, b2, b3, b4, b5, b6, b7, b8p]) loop
    t := t || (select count(*)::text from auth.users where id = c) || (select count(*)::text from public.profiles where id = c);
  end loop;
  r := r || pg_temp.chk('N7', 'the eight kept accounts still have their sign-in and profile', t, '1111111111111111');
  r := r || pg_temp.chk('N8', 'a kept account says why: ledger, top-up, payout, session, request, document, file, ledger',
    (select string_agg(kept_reason, ' | ' order by case user_id when b1 then 1 when b2 then 2 when b3 then 3 when b4 then 4 when b5 then 5 when b6 then 6 when b7 then 7 else 8 end)
     from public.review_accounts where user_id in (b1, b2, b3, b4, b5, b6, b7, b8p)),
    'a wallet ledger line | a wallet top-up | a payout request | a session | a session request | a verification document | a stored file | a wallet ledger line');
  r := r || pg_temp.chk('N9', 'the kept learner waits for its guardian, quietly', (select kept_reason || '/' || (last_alert_at is null)::text from public.review_accounts where user_id = b8l) || '/' || (select count(*)::text from public.profiles where id = b8l),
    'its guardian account is still here/true/1');
  r := r || pg_temp.chk('N10', 'the failing account is undone: sign-in and profile still there, the reason says so',
    (select count(*)::text from auth.users where id = e1) || (select count(*)::text from public.profiles where id = e1) || '/' || pg_temp.has((select kept_reason from public.review_accounts where user_id = e1), 'an error while deleting it (refused for the test)'), '11/yes');
  -- alerts
  select count(*) into nf from public.notifications where profile_id = a_fin and type = 'review_account_kept';
  r := r || pg_temp.chk('N11', 'the finance manager has 9 notices (8 kept + 1 failed), the super admin too',
    nf::text || '/' || (select count(*)::text from public.notifications where profile_id = a_sup and type = 'review_account_kept'), '9/9');
  r := r || pg_temp.chk('N12', 'a support agent and a switched-off finance manager are not told', (select count(*)::text from public.notifications where profile_id in (a_spt, a_off) and type = 'review_account_kept'), '0');
  r := r || pg_temp.chk('N13', 'a notice names the id and the reason but no person', (select (body like '%' || b1::text || '%' and body like '%a wallet ledger line%' and title = 'A temporary review login was not deleted')::text from public.notifications where profile_id = a_fin and body like '%' || b1::text || '%' limit 1), 'true');
  r := r || pg_temp.chk('N14', 'audit lines: 3 deleted (the clean ones), 9 kept', (length(current_setting('test.audit', true)) - length(replace(current_setting('test.audit', true), 'review_account_deleted:', ''))) / length('review_account_deleted:') || '/'
    || (length(current_setting('test.audit', true)) - length(replace(current_setting('test.audit', true), 'review_account_kept:', ''))) / length('review_account_kept:'), '3/9');
  r := r || pg_temp.chk('N15', 'each deletion line names the right account', (position('review_account_deleted:' || pa in current_setting('test.audit', true)) > 0
    and position('review_account_deleted:' || la in current_setting('test.audit', true)) > 0 and position('review_account_deleted:' || ta in current_setting('test.audit', true)) > 0
    and position('review_account_deleted:' || b1 in current_setting('test.audit', true)) = 0)::text, 'true');

  -- ---- running again ------------------------------------------------------------------------------------------------------------------------
  j := public.delete_expired_review_accounts();
  r := r || pg_temp.chk('R1', 'a second run deletes nothing and adds no notice (weekly reminder; the failing one fails again)', (j ->> 'deleted') || '/' || (j ->> 'errors') || '/' || (j ->> 'alerts') || '/' || (select count(*)::text from public.notifications where profile_id = a_fin and type = 'review_account_kept'), '0/1/0/9');
  update public.review_accounts set last_alert_at = now() - interval '8 days' where user_id = b1;
  j := public.delete_expired_review_accounts();
  r := r || pg_temp.chk('R2', 'a reminder older than a week is sent again, for that account only', (j ->> 'alerts') || '/' || (select count(*)::text from public.notifications where profile_id = a_fin and type = 'review_account_kept'), '1/10');
  -- once the money is gone from the ledger side (the owner removes the line by hand) the account is deleted on the next run
  perform set_config('tutorlage.purging_wallet_ledger', 'on', true);
  delete from public.wallet_ledger where profile_id = b8p;
  delete from public.wallets where profile_id = b8p;
  perform set_config('tutorlage.purging_wallet_ledger', 'off', true);
  execute 'drop trigger rv_test_refuse on public.profiles';
  j := public.delete_expired_review_accounts();
  r := r || pg_temp.chk('R3', 'once nothing is kept (and the cause of the failure is gone), the parent goes, its learner in the same run, and the failed one', (j ->> 'deleted') || '/' || (select count(*)::text from public.profiles where id in (b8p, b8l, e1)), '3/0');
  update public.review_accounts set expires_at = now() + interval '1 hour' where user_id = b2;
  j := public.delete_expired_review_accounts();
  r := r || pg_temp.chk('R4', 'an account moved to the future is left alone', (select count(*)::text from public.profiles where id = b2), '1');
  r := r || pg_temp.chk('R5', 'a wallet with money is never emptied by the job', (select available_rand::text from public.wallets where profile_id = b1), '100');

  nl := length(r) - length(replace(r, E'\n', ''));
  nf := (length(r) - length(replace(r, ' FAIL', ''))) / 5;
  raise exception E'REVIEW-ACCOUNTS TEST (rolled back): % FAIL line(s) in % lines\n%', nf, nl, r;
  exception when others then
    if sqlerrm like 'REVIEW-ACCOUNTS TEST%' then raise; end if;
    raise exception E'REVIEW-ACCOUNTS TEST stopped by an error: %\nlines so far:\n%', sqlerrm, r;
  end;
end $$;
