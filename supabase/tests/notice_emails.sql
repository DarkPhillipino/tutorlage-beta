-- Rolled-back test of migration 20261118220000_notice_emails.sql (SHOULD item 11, 18 Nov 2026): email for "top-up approved" and "tutor has not joined", behind switches that are OFF, with a daily cap.
-- It proves: the three settings exist and are OFF; with the switches off nothing is claimed; with one on, ONLY that kind, ONLY a notice of the last 3 hours, ONLY once, with the exact title and body; the
-- cap (and the 95 ceiling) holds and counts what it held back; finishing counts sent and failed once; the tables store no address or name; only the server key may call the functions and read nothing.
-- Made-up people only (example.invalid); the block ends with `raise exception` so nothing is kept.
-- Before the apply, run both in ONE rolled-back statement, migration first:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/notice_emails.sql supabase/migrations/20261118220000_notice_emails.sql
-- After the apply, paste this file alone.
do $$
declare
  r text := '';
  uid text := replace(gen_random_uuid()::text, '-', '');
  ua uuid := gen_random_uuid();
  n1 uuid; n2 uuid; n3 uuid; n4 uuid; n5 uuid; n6 uuid;
  c integer; total integer; k text; t text; b text; nfail int; nlines int;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
               || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
      $f$ $mk$;
    execute $mk$
      create function pg_temp.note(p_profile uuid, p_type text, p_title text, p_body text, p_age interval default '0') returns uuid language sql as $f$
        insert into public.notifications (profile_id, type, title, body, created_at) values (p_profile, p_type, p_title, p_body, now() - p_age) returning id
      $f$ $mk$;
    execute $mk$
      create function pg_temp.claimed() returns integer language sql as $f$ select count(*)::integer from public.notice_email_claim(50) $f$ $mk$;

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ne.' || uid || '@example.invalid',
            jsonb_build_object('role', 'student', 'first_name', 'Zzne', 'surname', 'Test'), '{}');

    -- S1 settings
    r := r || pg_temp.chk('S1', 'the three settings exist, both switches OFF, cap 80',
      (select string_agg(setting_key || '=' || setting_value::text, ',' order by setting_key) from public.system_settings where setting_key in ('notice_email_topup_approved', 'notice_email_tutor_not_joined', 'notice_email_daily_cap')),
      'notice_email_daily_cap=80,notice_email_topup_approved=false,notice_email_tutor_not_joined=false');

    n1 := pg_temp.note(ua, 'wallet_topup_added', 'Money added to your wallet', 'R200 was added to your wallet (reference TL-ZZ1234).');
    n2 := pg_temp.note(ua, 'session_booked', 'Your session is booked', 'Some body.');
    n3 := pg_temp.note(ua, 'wallet_topup_added', 'Money added to your wallet', 'R50 was added to your wallet (reference TL-OLD000).', interval '4 hours');

    -- S2 everything off: nothing is claimed
    r := r || pg_temp.chk('S2', 'with both switches OFF nothing is claimed', pg_temp.claimed()::text, '0');
    r := r || pg_temp.chk('S2b', 'and nothing was recorded', (select count(*)::text from public.notice_emails), '0');

    -- S3 top-up switch ON
    update public.system_settings set setting_value = 'true'::jsonb where setting_key = 'notice_email_topup_approved';
    select x.kind, x.title, x.body into k, t, b from public.notice_email_claim(10) x where x.notification_id = n1;
    r := r || pg_temp.chk('S3', 'the new top-up notice is claimed as topup_approved with its EXACT title and body', coalesce(k, '-') || '|' || coalesce(t, '-') || '|' || coalesce(b, '-'),
      'topup_approved|Money added to your wallet|R200 was added to your wallet (reference TL-ZZ1234).');
    r := r || pg_temp.chk('S3b', 'a second call claims nothing (once only)', pg_temp.claimed()::text, '0');
    r := r || pg_temp.chk('S3c', 'the session notice and the 4-hour-old top-up were never claimed', (select count(*)::text from public.notice_emails e where e.notification_id in (n2, n3)), '0');
    n4 := pg_temp.note(ua, 'wallet_topup_added', 'Money added to your wallet', 'R75 was added to your wallet (reference TL-ZZ4444).');
    r := r || pg_temp.chk('S3e', 'a fresh notice answers with its owner', (select (x.profile_id = ua)::text from public.notice_email_claim(10) x where x.notification_id = n4), 'true');

    -- S4 the other kind: its switch is still OFF; no notice of that type exists in the database, and one made for the test is held until its switch is ON
    n5 := pg_temp.note(ua, 'tutor_not_joined', 'T title', 'T body');
    r := r || pg_temp.chk('S4', 'a tutor_not_joined notice is NOT claimed while its switch is OFF', pg_temp.claimed()::text, '0');
    update public.system_settings set setting_value = 'true'::jsonb where setting_key = 'notice_email_tutor_not_joined';
    select x.kind, x.title, x.body into k, t, b from public.notice_email_claim(10) x where x.notification_id = n5;
    r := r || pg_temp.chk('S4b', 'with its switch ON it is claimed as tutor_not_joined, exact words', coalesce(k, '-') || '|' || coalesce(t, '-') || '|' || coalesce(b, '-'), 'tutor_not_joined|T title|T body');
    update public.system_settings set setting_value = 'false'::jsonb where setting_key = 'notice_email_topup_approved';
    n6 := pg_temp.note(ua, 'wallet_topup_added', 'Money added to your wallet', 'R10 was added (switch off).');
    r := r || pg_temp.chk('S4c', 'turning the top-up switch OFF again stops its mails', pg_temp.claimed()::text, '0');
    update public.system_settings set setting_value = 'true'::jsonb where setting_key = 'notice_email_topup_approved';

    -- S5 finish counts once
    perform public.notice_email_finish(n1, true);
    perform public.notice_email_finish(n1, true);
    perform public.notice_email_finish(n4, false);
    perform public.notice_email_finish(n2, true); -- never claimed: ignored
    r := r || pg_temp.chk('S5', 'sent counted once, failed counted once, an unclaimed notice ignored',
      (select d.sent || '/' || d.failed from public.notice_email_days d where d.day = (now() at time zone 'Africa/Johannesburg')::date), '1/1');
    r := r || pg_temp.chk('S5b', 'statuses', (select string_agg(e.status, ',' order by e.status) from public.notice_emails e where e.notification_id in (n1, n4, n5)), 'claimed,failed,sent');

    -- S6 the cap: 2 a day, 4 waiting
    delete from public.notice_emails;
    delete from public.notice_email_days;
    delete from public.notifications where profile_id = ua;
    update public.system_settings set setting_value = '2'::jsonb where setting_key = 'notice_email_daily_cap';
    perform pg_temp.note(ua, 'wallet_topup_added', 'Money added to your wallet', 'R1 ' || g) from generate_series(1, 4) g;
    r := r || pg_temp.chk('S6', 'with a cap of 2 only 2 of 4 waiting notices are claimed', pg_temp.claimed()::text, '2');
    r := r || pg_temp.chk('S6b', 'at the cap nothing more is claimed', pg_temp.claimed()::text, '0');
    r := r || pg_temp.chk('S6c', 'and what was held back is counted (counts only)', (select d.held_at_cap::text from public.notice_email_days d where d.day = (now() at time zone 'Africa/Johannesburg')::date), '2');
    r := r || pg_temp.chk('S6d', 'the held-back notices are still in the app (nothing deleted)', (select count(*)::text from public.notifications where profile_id = ua), '4');

    -- S7 the ceiling: a typed cap of 500 still stops at 95; a nonsense cap falls back to 80
    delete from public.notice_emails;
    delete from public.notice_email_days;
    delete from public.notifications where profile_id = ua;
    update public.system_settings set setting_value = '500'::jsonb where setting_key = 'notice_email_daily_cap';
    perform pg_temp.note(ua, 'wallet_topup_added', 'Money added to your wallet', 'R2 ' || g) from generate_series(1, 120) g;
    total := 0;
    for c in 1..4 loop total := total + pg_temp.claimed(); end loop;
    r := r || pg_temp.chk('S7', 'a cap typed as 500 still stops at 95', total::text, '95');
    delete from public.notice_emails;
    update public.system_settings set setting_value = '"abc"'::jsonb where setting_key = 'notice_email_daily_cap';
    total := 0;
    for c in 1..4 loop total := total + pg_temp.claimed(); end loop;
    r := r || pg_temp.chk('S7b', 'a nonsense cap falls back to 80', total::text, '80');

    -- S8 what is stored, who may call
    r := r || pg_temp.chk('S8', 'the claim table holds ids, kind, day, status and times only (no address, no name, no text)',
      (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'notice_emails'),
      'notification_id,kind,status,day,claimed_at,finished_at');
    r := r || pg_temp.chk('S8b', 'the counts table holds counts only',
      (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'notice_email_days'), 'day,sent,failed,held_at_cap');
    r := r || pg_temp.chk('S8c', 'only the server key may call the two functions (anon, signed-in, server key)',
      has_function_privilege('anon', 'public.notice_email_claim(integer)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.notice_email_claim(integer)', 'execute')::text || '/'
      || has_function_privilege('service_role', 'public.notice_email_claim(integer)', 'execute')::text || ' ' ||
      has_function_privilege('anon', 'public.notice_email_finish(uuid, boolean)', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.notice_email_finish(uuid, boolean)', 'execute')::text || '/'
      || has_function_privilege('service_role', 'public.notice_email_finish(uuid, boolean)', 'execute')::text, 'false/false/true false/false/true');
    r := r || pg_temp.chk('S8d', 'neither table can be read by the app (anon, signed-in)',
      has_table_privilege('anon', 'public.notice_emails', 'select')::text || '/' || has_table_privilege('authenticated', 'public.notice_emails', 'select')::text || '/'
      || has_table_privilege('anon', 'public.notice_email_days', 'select')::text || '/' || has_table_privilege('authenticated', 'public.notice_email_days', 'select')::text, 'false/false/false/false');
    r := r || pg_temp.chk('S8e', 'row level security is on for both', (select count(*)::text from pg_class where oid in ('public.notice_emails'::regclass, 'public.notice_email_days'::regclass) and relrowsecurity), '2');

    -- S9 deleting a notice removes its claim row (no orphans)
    delete from public.notice_emails;
    n1 := pg_temp.note(ua, 'wallet_topup_added', 'Money added to your wallet', 'R3 once');
    perform pg_temp.claimed();
    delete from public.notifications where id = n1;
    r := r || pg_temp.chk('S9', 'deleting the notice deletes its claim row', (select count(*)::text from public.notice_emails where notification_id = n1), '0');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
