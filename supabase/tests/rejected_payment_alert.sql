-- Rolled-back test of migration 20261121120000_rejected_payment_alert.sql (JOB L, 21 Nov 2026): the finance alert "rejected payment notifications in an hour".
-- Before the apply, run both in ONE rolled-back statement, migration first:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/rejected_payment_alert.sql supabase/migrations/20261121120000_rejected_payment_alert.sql
-- After the apply, run this file alone (npx supabase db query --linked -f supabase/tests/rejected_payment_alert.sql). Fixtures are made-up (provider 'zt-test', example.invalid); every real row is left
-- alone and only counted, and the threshold is moved to (real rejected now + 5) inside the run so real rows cannot change the answer. The block ends with `raise exception`, so nothing is kept.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  uid text := replace(gen_random_uuid()::text, '-', '');
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  adult text := (v_today - interval '30 years')::date::text;
  v_l uuid := gen_random_uuid();
  v_fm uuid := gen_random_uuid();
  v_sup uuid := gen_random_uuid();
  v_sa uuid := gen_random_uuid();
  r0 int;
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
      create function pg_temp.ev(p_source text, p_outcome text, p_detail text, p_age interval) returns void language sql as $f$
        insert into public.wallet_provider_events (provider, source, outcome, detail, created_at) values ('zt-test', p_source, p_outcome, p_detail, now() - p_age)
      $f$ $mk$;

    -- what is really there (read only)
    select count(*) into r0 from public.wallet_provider_events e
     where e.outcome = 'rejected' and e.source = 'webhook' and position('(missing_header)' in coalesce(e.detail, '')) = 0 and e.created_at > now() - interval '1 hour';
    r := r || format('S0 real rejected webhook messages in the last hour, probes left out (info): %s', r0) || E'\n';
    r := r || pg_temp.chk('S1', 'the setting exists and starts at 5', (select setting_value #>> '{}' from public.system_settings where setting_key = 'rejected_payment_alert_count'), '5');

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
      (v_l, z, 'authenticated', 'authenticated', 'rp.l.' || uid || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Lee', 'date_of_birth', adult), '{}'),
      (v_fm, z, 'authenticated', 'authenticated', 'rp.f.' || uid || '@example.invalid', '{}'::jsonb, '{}'),
      (v_sup, z, 'authenticated', 'authenticated', 'rp.s.' || uid || '@example.invalid', '{}'::jsonb, '{}'),
      (v_sa, z, 'authenticated', 'authenticated', 'rp.a.' || uid || '@example.invalid', '{}'::jsonb, '{}');
    insert into admin_profiles (id, first_name, surname, email, phone_number, admin_role, is_active) values
      (v_fm, 'Fina', 'Finance', 'rp.f.' || uid || '@example.invalid', '', 'finance_manager', true),
      (v_sup, 'Sue', 'Support', 'rp.s.' || uid || '@example.invalid', '', 'support_agent', true),
      (v_sa, 'Sam', 'Super', 'rp.a.' || uid || '@example.invalid', '', 'super_admin', true);
    r := r || 'S2 setup: a learner, a finance manager, a support agent and a super admin (made up)' || E'\n';

    -- the threshold moves to real + 5 so real rows cannot change the answer
    update public.system_settings set setting_value = to_jsonb(r0 + 5) where setting_key = 'rejected_payment_alert_count';
    -- made up: 4 counted, and four that must NOT count
    perform pg_temp.ev('webhook', 'rejected', 'It failed the safety check (bad signature)', interval '5 minutes');
    perform pg_temp.ev('webhook', 'rejected', 'It failed the safety check (bad signature)', interval '20 minutes');
    perform pg_temp.ev('webhook', 'rejected', 'It failed the safety check (old timestamp)', interval '40 minutes');
    perform pg_temp.ev('webhook', 'rejected', 'It failed the safety check (unreadable body)', interval '59 minutes');
    perform pg_temp.ev('webhook', 'rejected', 'It failed the safety check (missing_header); message without an id', interval '1 minute');   -- a probe: not counted
    perform pg_temp.ev('status_check', 'rejected', 'our own check', interval '2 minutes');                                                   -- not a notification: not counted
    perform pg_temp.ev('webhook', 'rejected', 'It failed the safety check (bad signature)', interval '2 hours');                             -- too old: not counted
    perform pg_temp.ev('webhook', 'ignored', 'not a payment', interval '3 minutes');                                                          -- another outcome: not counted
    r := r || 'S3 setup: eight made-up messages (4 count; a probe, a status check, an old one and an "ignored" one do not)' || E'\n';

    t := pg_temp.run_as(v_fm, 'select count(*)::text from public.admin_rejected_payment_alert()');
    r := r || pg_temp.chk('F1', 'finance: 4 counted against a threshold of real + 5: no alert', t, '0');
    perform pg_temp.ev('webhook', 'rejected', 'It failed the safety check (bad signature)', interval '1 minute');
    t := pg_temp.run_as(v_fm, 'select count(*)::text from public.admin_rejected_payment_alert()');
    r := r || pg_temp.chk('F2', 'finance: the fifth counted message makes ONE row', t, '1');
    t := pg_temp.run_as(v_fm, 'select a.rejected_count::text || ''/'' || a.threshold::text || ''/'' || a.window_minutes::text from public.admin_rejected_payment_alert() a');
    r := r || pg_temp.chk('F3', 'the row: count, threshold, window (the probe, the status check, the old one and the ignored one are left out)', t, (r0 + 5)::text || '/' || (r0 + 5)::text || '/60');
    t := pg_temp.run_as(v_fm, 'select a.ref from public.admin_rejected_payment_alert() a');
    r := r || pg_temp.chk('F4', 'the ref is rejected:<UTC hour>', (t ~ '^rejected:[0-9]{10}$')::text, 'true');
    t := pg_temp.run_as(v_fm, 'select (a.first_at <= a.last_at and a.last_at <= now())::text from public.admin_rejected_payment_alert() a');
    r := r || pg_temp.chk('F5', 'first time is not after last time', t, 'true');
    t := pg_temp.run_as(v_sa, 'select count(*)::text from public.admin_rejected_payment_alert()');
    r := r || pg_temp.chk('F6', 'a super admin gets it too', t, '1');

    update public.system_settings set setting_value = to_jsonb(r0 + 6) where setting_key = 'rejected_payment_alert_count';
    r := r || pg_temp.chk('T1', 'threshold one higher: no alert', pg_temp.run_as(v_fm, 'select count(*)::text from public.admin_rejected_payment_alert()'), '0');
    update public.system_settings set setting_value = '"abc"'::jsonb where setting_key = 'rejected_payment_alert_count';
    r := r || pg_temp.chk('T2', 'a bad value counts as 5 (the made-up 5 reach it)', pg_temp.run_as(v_fm, 'select a.threshold::text from public.admin_rejected_payment_alert() a'), '5');
    update public.system_settings set setting_value = '0'::jsonb where setting_key = 'rejected_payment_alert_count';
    r := r || pg_temp.chk('T3', 'a threshold of 0 counts as 1', pg_temp.run_as(v_fm, 'select a.threshold::text from public.admin_rejected_payment_alert() a'), '1');

    r := r || pg_temp.chk('P1', 'a support agent is refused', pg_temp.run_as(v_sup, 'select count(*)::text from public.admin_rejected_payment_alert()'), 'ERR: Only finance can see this');
    r := r || pg_temp.chk('P2', 'a learner is refused', pg_temp.run_as(v_l, 'select count(*)::text from public.admin_rejected_payment_alert()'), 'ERR: Admins only');
    r := r || pg_temp.chk('P3', 'a signed-out caller is refused', pg_temp.run_as(null, 'select count(*)::text from public.admin_rejected_payment_alert()'), 'ERR: permission denied for function admin_rejected_payment_alert');
    r := r || pg_temp.chk('P4', 'anon may not run it, signed-in callers may (the admin test is inside)',
      has_function_privilege('anon', 'public.admin_rejected_payment_alert()', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.admin_rejected_payment_alert()', 'execute')::text || '/' || has_function_privilege('service_role', 'public.admin_rejected_payment_alert()', 'execute')::text,
      'false/true/false');
    select string_agg(a.attname, ',' order by a.attnum) into t from pg_proc p, unnest(p.proargnames) with ordinality as a(attname, attnum), unnest(p.proargmodes) with ordinality as m(mode, mnum)
      where p.oid = 'public.admin_rejected_payment_alert()'::regprocedure and a.attnum = m.mnum and m.mode = 't';
    r := r || pg_temp.chk('P5', 'what it returns has no name, message text or id', t, 'rejected_count,threshold,window_minutes,first_at,last_at,ref');
    select provolatile::text into t from pg_proc where oid = 'public.admin_rejected_payment_alert()'::regprocedure;
    r := r || pg_temp.chk('P6', 'declared read-only (stable)', t, 's');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'REJECTED PAYMENT ALERT TEST (rolled back): % lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
