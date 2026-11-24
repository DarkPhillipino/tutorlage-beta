-- RUN THROUGH THE ROLLED-BACK RUNNER WITH THE MIGRATION (never bare on production; PM line 57):
--   node scripts/run-rolled-back-test.mjs out.sql supabase/tests/web_push.sql supabase/migrations/20261125100000_web_push.sql
-- Rolled-back test of migration 20261125100000_web_push.sql (RUN 6, 24 Nov 2026). The last line raises so everything is undone. Made-up people only.
do $$
declare
  r text := '';
  z uuid := '00000000-0000-0000-0000-000000000000';
  adult text := (current_date - interval '30 years')::date::text;
  ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid(); stu uuid := gen_random_uuid();
  n1 uuid; n2 uuid; n3 uuid; j jsonb; nfail int; nlines int; h int; t text;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null') || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n' $f$ $mk$;
    execute $mk$
      create function pg_temp.run_as(p_u uuid, p_sql text) returns text language plpgsql as $f$
      declare v text;
      begin
        if p_u is null then perform set_config('request.jwt.claims', '', true); set local role anon;
        else perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true); set local role authenticated; end if;
        begin execute p_sql into v; reset role; return coalesce(v, 'null');
        exception when others then reset role; return 'ERR: ' || sqlerrm; end;
      end $f$ $mk$;
    execute $mk$
      create function pg_temp.run_svc(p_sql text) returns text language plpgsql as $f$
      declare v text;
      begin
        perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true); set local role service_role;
        begin execute p_sql into v; reset role; return coalesce(v, 'null');
        exception when others then reset role; return 'ERR: ' || sqlerrm; end;
      end $f$ $mk$;

    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    select x, z, 'authenticated', 'authenticated', 'wp.' || x || '@example.invalid', jsonb_build_object('role', 'tutor', 'first_name', 'Tessa', 'date_of_birth', adult), '{}' from unnest(array[ta, tb]) x;
    insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
    values (stu, z, 'authenticated', 'authenticated', 'wp.s.' || stu || '@example.invalid', jsonb_build_object('role', 'student', 'first_name', 'Lee', 'date_of_birth', adult), '{}');

    -- A. everything is OFF by default
    r := r || pg_temp.chk('A1', 'the master switch is off', (select setting_value::text from system_settings where setting_key = 'web_push_enabled'), 'false');
    r := r || pg_temp.chk('A2', 'a tutor is told alerts are not enabled', pg_temp.run_as(ta, 'select (public.web_push_config() ->> ''enabled'')'), 'false');
    r := r || pg_temp.chk('A3', 'saving a device is refused while off', pg_temp.run_as(ta, 'select public.push_save_subscription(''https://push.example.invalid/a'')'), 'ERR: Alerts are not available yet');
    insert into notifications (profile_id, type, title, body) values (ta, 'request_for_you', 'A learner asked for you again', 'x') returning id into n1;
    r := r || pg_temp.chk('A4', 'a direct-request notice queues nothing while off', (select count(*) from push_outbox)::text, '0');
    r := r || pg_temp.chk('A5', 'no worker address is set', (select setting_value::text from system_settings where setting_key = 'web_push_worker_url'), '""');
    r := r || pg_temp.chk('A6', 'the wake-up is scheduled every minute', coalesce((select schedule from cron.job where jobname = 'run-push-alerts'), 'none'), '* * * * *');

    -- B. switched on: who may do what
    update system_settings set setting_value = 'true'::jsonb where setting_key = 'web_push_enabled';
    j := (pg_temp.run_as(ta, 'select public.web_push_config()::text'))::jsonb;
    r := r || pg_temp.chk('B1', 'a tutor gets enabled and the public key only', ((j ->> 'enabled') = 'true' and length(j ->> 'public_key') = 87 and (select count(*) from jsonb_object_keys(j)) = 2)::text, 'true');
    r := r || pg_temp.chk('B2', 'a learner is told not enabled', pg_temp.run_as(stu, 'select (public.web_push_config() ->> ''enabled'')'), 'false');
    r := r || pg_temp.chk('B3', 'a signed-out visitor is refused', left(pg_temp.run_as(null, 'select public.web_push_config()::text'), 30), 'ERR: permission denied for fun');
    r := r || pg_temp.chk('B4', 'a learner cannot save a device', pg_temp.run_as(stu, 'select public.push_save_subscription(''https://push.example.invalid/s'')'), 'ERR: Only tutors can turn on alerts');
    r := r || pg_temp.chk('B5', 'a non-https address is refused', pg_temp.run_as(ta, 'select public.push_save_subscription(''http://push.example.invalid/a'')'), 'ERR: That device address is not valid');
    perform pg_temp.run_as(ta, 'select public.push_save_subscription(''https://push.example.invalid/a'')');
    r := r || pg_temp.chk('B6', 'a tutor saves a device', (select count(*) from push_subscriptions where profile_id = ta)::text, '1');
    r := r || pg_temp.chk('B7', 'saving makes her default settings row', (select count(*) from push_preferences where profile_id = ta)::text, '1');
    perform pg_temp.run_as(tb, 'select public.push_save_subscription(''https://push.example.invalid/a'')');
    r := r || pg_temp.chk('B8', 'another tutor on the same device takes it over (one owner)', (select (profile_id = tb)::text from push_subscriptions where endpoint = 'https://push.example.invalid/a'), 'true');
    for h in 1..6 loop
      perform pg_temp.run_as(ta, format('select public.push_save_subscription(%L)', 'https://push.example.invalid/d' || h));
      -- now() is fixed inside one test transaction, so the order of devices is set by hand: d1 oldest, d6 newest
      update push_subscriptions set created_at = now() - make_interval(secs => 10 - h) where endpoint = 'https://push.example.invalid/d' || h;
    end loop;
    r := r || pg_temp.chk('B9', 'at most 5 devices per tutor', (select count(*) from push_subscriptions where profile_id = ta)::text, '5');
    perform pg_temp.run_as(tb, 'select public.push_remove_subscription(''https://push.example.invalid/d6'')');
    r := r || pg_temp.chk('B10', 'removing a device is hers alone', (select count(*) from push_subscriptions where profile_id = ta)::text, '5');
    perform pg_temp.run_as(ta, 'select public.push_remove_subscription(''https://push.example.invalid/d6'')');
    r := r || pg_temp.chk('B11', 'she removes her own', (select count(*) from push_subscriptions where profile_id = ta)::text, '4');
    perform pg_temp.run_as(ta, 'select public.push_save_subscription(''https://push.example.invalid/d6'')');

    -- C. quiet hours (South African time, windows may cross midnight)
    r := r || pg_temp.chk('C1', '22:00 SAST waits until 07:00 next morning', to_char(public.push_quiet_release('2026-11-24 20:00:00+00', true, 21::smallint, 7::smallint) at time zone 'Africa/Johannesburg', 'DD HH24:MI'), '25 07:00');
    r := r || pg_temp.chk('C2', '03:00 SAST waits until 07:00 the same day', to_char(public.push_quiet_release('2026-11-25 01:00:00+00', true, 21::smallint, 7::smallint) at time zone 'Africa/Johannesburg', 'DD HH24:MI'), '25 07:00');
    r := r || pg_temp.chk('C3', '12:00 SAST goes at once', to_char(public.push_quiet_release('2026-11-25 10:00:00+00', true, 21::smallint, 7::smallint) at time zone 'Africa/Johannesburg', 'DD HH24:MI'), '25 12:00');
    r := r || pg_temp.chk('C4', '07:00 sharp is outside the window', to_char(public.push_quiet_release('2026-11-25 05:00:00+00', true, 21::smallint, 7::smallint) at time zone 'Africa/Johannesburg', 'DD HH24:MI'), '25 07:00');
    r := r || pg_temp.chk('C5', 'quiet hours off: always at once', to_char(public.push_quiet_release('2026-11-24 20:00:00+00', false, 21::smallint, 7::smallint) at time zone 'Africa/Johannesburg', 'DD HH24:MI'), '24 22:00');
    r := r || pg_temp.chk('C6', 'a same-day window (13 to 15) holds 14:00 until 15:00', to_char(public.push_quiet_release('2026-11-25 12:00:00+00', true, 13::smallint, 15::smallint) at time zone 'Africa/Johannesburg', 'DD HH24:MI'), '25 15:00');
    r := r || pg_temp.chk('C7', 'start equal to end means no window', to_char(public.push_quiet_release('2026-11-24 20:00:00+00', true, 5::smallint, 5::smallint) at time zone 'Africa/Johannesburg', 'DD HH24:MI'), '24 22:00');

    -- D. her switch and quiet-hour settings
    j := (pg_temp.run_as(tb, 'select public.my_push_settings()::text'))::jsonb;
    r := r || pg_temp.chk('D1', 'defaults are on, quiet 21 to 07', (j ->> 'alerts_on') || '/' || (j ->> 'quiet_on') || '/' || (j ->> 'quiet_start') || '/' || (j ->> 'quiet_end'), 'true/true/21/7');
    r := r || pg_temp.chk('D2', 'an hour of 24 is refused', pg_temp.run_as(ta, 'select public.set_my_push_settings(true, true, 24, 7)'), 'ERR: Those settings are not valid');
    r := r || pg_temp.chk('D3', 'a learner cannot set alerts', pg_temp.run_as(stu, 'select public.set_my_push_settings(true, true, 21, 7)'), 'ERR: Only tutors have alerts');
    perform pg_temp.run_as(ta, 'select public.set_my_push_settings(true, false, 21, 7)');
    r := r || pg_temp.chk('D4', 'she can turn quiet hours off', pg_temp.run_as(ta, 'select (public.my_push_settings() ->> ''quiet_on'')'), 'false');
    r := r || pg_temp.chk('D5', 'her device count is shown', pg_temp.run_as(ta, 'select (public.my_push_settings() ->> ''devices'')'), '5');

    -- E. a direct request queues ONE alert; other notices queue nothing
    insert into notifications (profile_id, type, title, body) values (ta, 'session_booked', 'x', 'x');
    r := r || pg_temp.chk('E1', 'another notice type queues nothing', (select count(*) from push_outbox)::text, '0');
    insert into notifications (profile_id, type, title, body) values (ta, 'request_for_you', 'A learner asked for you again', 'x') returning id into n1;
    r := r || pg_temp.chk('E2', 'a direct request queues one alert, due now (quiet hours off)', (select count(*) from push_outbox where notification_id = n1 and status = 'waiting' and deliver_after <= now())::text, '1');
    perform public.run_push_alerts();
    r := r || pg_temp.chk('E3', 'the wake-up with no worker address does nothing and does not fail', (select status from push_outbox where notification_id = n1), 'waiting');

    -- F. claim: the Worker only, once, one row per device, nothing but the address
    r := r || pg_temp.chk('F1', 'a browser cannot claim', left(pg_temp.run_as(ta, 'select count(*) from public.push_claim(10)'), 30), 'ERR: permission denied for fun');
    r := r || pg_temp.chk('F2', 'a signed-out visitor cannot claim', left(pg_temp.run_as(null, 'select count(*) from public.push_claim(10)'), 30), 'ERR: permission denied for fun');
    r := r || pg_temp.chk('F3', 'the server claims one row per device (5)', pg_temp.run_svc('select count(*) from public.push_claim(10)'), '5');
    r := r || pg_temp.chk('F4', 'a second claim finds nothing (claimed once)', pg_temp.run_svc('select count(*) from public.push_claim(10)'), '0');
    r := r || pg_temp.chk('F5', 'the claim carries three columns only, no text', (select count(*)::text from information_schema.parameters where specific_schema = 'public' and specific_name like 'push_claim%' and parameter_mode = 'OUT'), '3');
    t := pg_temp.run_svc(format('select public.push_finish(%L, 4, 1)', n1));
    r := r || pg_temp.chk('F6', 'finishing records the result once', (select status || devices_ok || devices_failed from push_outbox where notification_id = n1) || ' [call: ' || t || ']', 'sent41 [call: ]');
    t := pg_temp.run_svc(format('select public.push_drop_subscription(%L)', (select id from push_subscriptions where endpoint = 'https://push.example.invalid/d6')));
    r := r || pg_temp.chk('F7', 'a dead device is dropped by the server only', (select count(*) from push_subscriptions where profile_id = ta) || '/' || left(pg_temp.run_as(ta, format('select public.push_drop_subscription(%L)', gen_random_uuid())), 30) || ' [call: ' || t || ']', '4/ERR: permission denied for fun [call: ]');

    -- G. her switch off: held; quiet hours at send time move the alert; the day cap; no device; stale
    perform pg_temp.run_as(ta, 'select public.set_my_push_settings(false, false, 21, 7)');
    insert into notifications (profile_id, type, title, body) values (ta, 'request_for_you', 'y', 'x') returning id into n2;
    r := r || pg_temp.chk('G1', 'her switch off: recorded as off, never queued', (select status from push_outbox where notification_id = n2), 'off');
    perform pg_temp.run_as(ta, 'select public.set_my_push_settings(true, false, 21, 7)');
    insert into notifications (profile_id, type, title, body) values (ta, 'request_for_you', 'y', 'x') returning id into n2;
    perform pg_temp.run_as(ta, 'select public.set_my_push_settings(false, false, 21, 7)');
    perform pg_temp.run_svc('select count(*) from public.push_claim(10)');
    r := r || pg_temp.chk('G2', 'she switches off after it was queued: not sent', (select status from push_outbox where notification_id = n2), 'off');
    perform pg_temp.run_as(ta, format('select public.set_my_push_settings(true, true, %s, %s)', extract(hour from (now() at time zone 'Africa/Johannesburg'))::int, ((extract(hour from (now() at time zone 'Africa/Johannesburg'))::int + 1) % 24)));
    update push_outbox set status = 'waiting', deliver_after = now() - interval '1 minute' where notification_id = n2;
    t := pg_temp.run_svc('select count(*) from public.push_claim(10)');
    r := r || pg_temp.chk('G3', 'inside her quiet hours at send time: nothing goes, the alert is moved later', t || '/' || (select (deliver_after > now())::text from push_outbox where notification_id = n2), '0/true');
    perform pg_temp.run_as(ta, 'select public.set_my_push_settings(true, false, 21, 7)');
    update system_settings set setting_value = '1'::jsonb where setting_key = 'web_push_max_per_tutor_day';
    update push_outbox set status = 'waiting', deliver_after = now() - interval '1 minute' where notification_id = n2;
    t := pg_temp.run_svc('select count(*) from public.push_claim(10)');
    r := r || pg_temp.chk('G4', 'the day cap (1 already sent today): capped, not sent', t || '/' || (select status from push_outbox where notification_id = n2), '0/capped');
    update system_settings set setting_value = '10'::jsonb where setting_key = 'web_push_max_per_tutor_day';
    delete from push_subscriptions where profile_id = tb;
    insert into notifications (profile_id, type, title, body) values (tb, 'request_for_you', 'y', 'x') returning id into n3;
    perform pg_temp.run_svc('select count(*) from public.push_claim(10)');
    r := r || pg_temp.chk('G5', 'a tutor with no device: recorded, nothing sent', (select status from push_outbox where notification_id = n3), 'no_device');
    update push_outbox set status = 'waiting', deliver_after = now() - interval '1 minute', created_at = now() - interval '13 hours' where notification_id = n3;
    perform pg_temp.run_svc('select count(*) from public.push_claim(10)');
    r := r || pg_temp.chk('G6', 'older than 12 hours: stale, never sent', (select status from push_outbox where notification_id = n3), 'stale');
    update system_settings set setting_value = 'false'::jsonb where setting_key = 'web_push_enabled';
    update push_outbox set status = 'waiting', deliver_after = now() - interval '1 minute', created_at = now() where notification_id = n3;
    r := r || pg_temp.chk('G7', 'master switch off again: the server claims nothing', pg_temp.run_svc('select count(*) from public.push_claim(10)'), '0');

    -- H. the tables and functions are closed
    r := r || pg_temp.chk('H1', 'no browser role can touch the three tables', (select bool_or(has_table_privilege(ro, tb2, p)) from unnest(array['anon', 'authenticated']) ro, unnest(array['public.push_outbox', 'public.push_subscriptions', 'public.push_preferences']) tb2, unnest(array['select', 'insert', 'update', 'delete']) p)::text, 'false');
    r := r || pg_temp.chk('H2', 'only the server runs claim, finish, drop; nobody runs the wake-up', (has_function_privilege('anon', 'public.push_claim(integer)', 'execute') or has_function_privilege('authenticated', 'public.push_claim(integer)', 'execute') or has_function_privilege('authenticated', 'public.push_finish(uuid,integer,integer)', 'execute') or has_function_privilege('authenticated', 'public.push_drop_subscription(uuid)', 'execute') or has_function_privilege('authenticated', 'public.run_push_alerts()', 'execute') or has_function_privilege('anon', 'public.web_push_config()', 'execute'))::text || '/' || has_function_privilege('service_role', 'public.push_claim(integer)', 'execute')::text, 'false/true');
    r := r || pg_temp.chk('H3', 'a failing alert can never block the notice (the trigger swallows errors)', (select (prosrc like '%exception when others%')::text from pg_proc where proname = 'queue_push_for_request_notice'), 'true');
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
