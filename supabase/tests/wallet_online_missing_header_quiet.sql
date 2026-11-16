-- Rolled-back test of 20261116180000_wallet_online_missing_header_quiet.sql. Run the migration text first and this block second, in ONE statement
-- (the last line raises on purpose; the message is the report; FAIL lines come first). Touches no real person's row: it counts before and after.
do $t$
declare
  r text := ''; f text := '';
  d_mh constant text := 'Failed the safety check (missing_header); message without an id';
  d_bs constant text := 'Failed the safety check (bad_signature); message with an id';
  n0 int; n1 int; k0 int; k1 int; a0 int; a1 int; j jsonb; j2 jsonb; old_id bigint;
  procedure_dummy int;
begin
  -- Q1: a missing_header probe is recorded once, then quiet for the hour; no alert.
  select count(*) into n0 from wallet_provider_events where outcome = 'rejected' and detail like '%(missing_header)%' and created_at > now() - interval '1 hour';
  select count(*) into a0 from notifications where type = 'wallet_online_rejected';
  j := public.wallet_online_record_event('ozow', 'webhook', null, 'rejected', d_mh);
  j2 := public.wallet_online_record_event('ozow', 'webhook', null, 'rejected', d_mh);
  select count(*) into n1 from wallet_provider_events where outcome = 'rejected' and detail like '%(missing_header)%' and created_at > now() - interval '1 hour';
  select count(*) into a1 from notifications where type = 'wallet_online_rejected';
  -- on production the last hour already holds rows written by the OLD behaviour, so "no new row" is n1 = n0; on an empty hour exactly one row is written
  if n1 > greatest(n0, 1) then f := f || format('FAIL Q1 more than one missing_header row an hour (before %s, after %s)' || E'\n', n0, n1); end if;
  if (j2 ->> 'recorded') <> 'false' or (j2 ->> 'why') <> 'quiet' then f := f || format('FAIL Q2 second probe not quiet: %s' || E'\n', j2); end if;
  if a1 <> a0 then f := f || format('FAIL Q3 a missing_header probe raised an alert (%s -> %s)' || E'\n', a0, a1); end if;
  r := r || format('Q1-Q3 probe rows in the last hour before %s after %s; first call %s; second call %s; alerts %s -> %s' || E'\n', n0, n1, j, j2, a0, a1);

  -- Q4: a missing_header row older than 7 days is removed by the next probe.
  insert into wallet_provider_events (provider, source, outcome, detail, created_at) values ('ozow', 'webhook', 'rejected', d_mh, now() - interval '8 days') returning id into old_id;
  perform public.wallet_online_record_event('ozow', 'webhook', null, 'rejected', d_mh);
  if exists (select 1 from wallet_provider_events where id = old_id) then f := f || 'FAIL Q4 the 8-day-old missing_header row was kept' || E'\n'; end if;
  r := r || 'Q4 old row removed: ' || (not exists (select 1 from wallet_provider_events where id = old_id))::text || E'\n';

  -- Q5: another rejection reason still records (the 20 an hour allowance is not used up by the probes) and, when no alert went out in the last hour, alerts once.
  delete from notifications where type = 'wallet_online_rejected' and created_at > now() - interval '1 hour';
  select count(*) into k0 from wallet_provider_events where outcome = 'rejected' and detail like '%(bad_signature)%';
  j := public.wallet_online_record_event('ozow', 'webhook', 'zz-test-event-' || gen_random_uuid(), 'rejected', d_bs);
  select count(*) into k1 from wallet_provider_events where outcome = 'rejected' and detail like '%(bad_signature)%';
  select count(*) into a1 from notifications where type = 'wallet_online_rejected' and created_at > now() - interval '1 hour';
  if k1 <> k0 + 1 then f := f || format('FAIL Q5 a bad_signature rejection was not recorded (%s -> %s)' || E'\n', k0, k1); end if;
  if a1 < 1 then f := f || 'FAIL Q6 a bad_signature rejection raised no alert' || E'\n'; end if;
  r := r || format('Q5-Q6 bad_signature rows %s -> %s, alert rows in the last hour %s (want at least 1: finance admins exist)' || E'\n', k0, k1, a1);

  -- Q7: the function is still service-role only.
  if has_function_privilege('authenticated', 'public.wallet_online_record_event(text,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.wallet_online_record_event(text,text,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.wallet_online_record_event(text,text,text,text,text)', 'execute') then
    f := f || 'FAIL Q7 grants changed' || E'\n';
  end if;
  r := r || 'Q7 grants: service_role only' || E'\n';
  raise exception E'WALLET ONLINE MISSING-HEADER QUIET TEST (rolled back)\n%\n%', case when f = '' then 'NO FAILURES' else f end, r;
end $t$;
