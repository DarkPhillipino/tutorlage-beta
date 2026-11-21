-- Rolled-back test of migration 20261118220100_notice_emails_wake.sql (the wake-up for the notice emails, 18 Nov 2026). It needs the first migration too:
--   node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/notice_emails_wake.sql supabase/migrations/20261118220000_notice_emails.sql supabase/migrations/20261118220100_notice_emails_wake.sql
-- After the apply, paste this file alone. It never calls the Worker (no address and no secret are set in a test), and ends with `raise exception` so nothing is kept.
do $$
declare
  r text := '';
  nfail int; nlines int;
begin
  begin
    execute $mk$
      create function pg_temp.chk(p_id text, p_label text, p_got text, p_want text) returns text language sql as $f$
        select p_id || ' ' || p_label || ': ' || coalesce(p_got, 'null')
               || case when p_got is not distinct from p_want then ' ok' else ' FAIL (want ' || coalesce(p_want, 'null') || ')' end || E'\n'
      $f$ $mk$;
    r := r || pg_temp.chk('W1', 'the Worker address setting exists and is empty', (select setting_value::text from public.system_settings where setting_key = 'notice_email_worker_url'), '""');
    perform public.run_notice_emails();
    r := r || pg_temp.chk('W2', 'with both switches OFF it returns quietly', 'returned', 'returned');
    update public.system_settings set setting_value = 'true'::jsonb where setting_key = 'notice_email_topup_approved';
    perform public.run_notice_emails();
    r := r || pg_temp.chk('W3', 'with a switch ON but no Worker address (or secret, or notice) it still returns quietly and calls nobody', 'returned', 'returned');
    r := r || pg_temp.chk('W4', 'only the server side may call it (anon, signed-in)', has_function_privilege('anon', 'public.run_notice_emails()', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.run_notice_emails()', 'execute')::text, 'false/false');
    r := r || pg_temp.chk('W5', 'the job is scheduled every 5 minutes (when pg_cron is installed)',
      case when exists (select 1 from pg_extension where extname = 'pg_cron')
           then (select string_agg(j.schedule || ' ' || j.command, ',') from cron.job j where j.jobname = 'run-notice-emails') else 'no pg_cron' end,
      case when exists (select 1 from pg_extension where extname = 'pg_cron') then '*/5 * * * * select public.run_notice_emails();' else 'no pg_cron' end);
  exception when others then
    r := r || E'ABORT before the end: ' || sqlerrm || E'\n';
  end;
  select count(*) filter (where l like '%FAIL%' or l like 'ABORT%'), count(*) into nfail, nlines from unnest(string_to_array(r, E'\n')) l where l <> '';
  raise exception E'% lines, % FAIL/ABORT\n%', nlines, nfail, r;
end $$;
