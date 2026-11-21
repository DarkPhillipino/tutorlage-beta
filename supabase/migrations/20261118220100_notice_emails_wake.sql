-- 18 Nov 2026 (SHOULD item 11): the wake-up for the notice emails (migration 20261118220000). Purely ADDITIVE: one setting (the Worker's address, empty), one function and one pg_cron job, the same pattern as the closing-accounts job
-- (run_account_closures, migration 20261021140000). Nothing that exists is changed. It does NOTHING while both notice-email switches are OFF, while the Worker address or the Vault secret notice_email_job_secret is not set, or while
-- no notice is waiting: then it only writes a line to the log. When all of that is true it asks the Worker (POST /api/internal/notice-emails/run, shared secret in the x-job-secret header), which claims, sends and reports back.
-- The CEO's steps (after the Worker deploy): set the Worker secret NOTICE_EMAIL_JOB_SECRET and the Vault secret notice_email_job_secret to the SAME long random value, set notice_email_worker_url, then switch a kind on.
-- Rollback: Drake/programmer/rollbacks/20261118220100_notice_emails_wake_ROLLBACK.sql
insert into public.system_settings (setting_key, setting_value, description) values
  ('notice_email_worker_url', '""'::jsonb, 'Address of the Worker (no trailing path) that the notice-email job wakes with pg_net; empty = it is not woken.')
on conflict (setting_key) do nothing;

create or replace function public.run_notice_emails()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
  v_topup boolean := coalesce((select s.setting_value = 'true'::jsonb from public.system_settings s where s.setting_key = 'notice_email_topup_approved'), false);
  v_notjoined boolean := coalesce((select s.setting_value = 'true'::jsonb from public.system_settings s where s.setting_key = 'notice_email_tutor_not_joined'), false);
begin
  if not (v_topup or v_notjoined) then
    return;
  end if;
  if not exists (
    select 1 from public.notifications n
    where n.created_at > now() - interval '3 hours'
      and ((n.type = 'wallet_topup_added' and v_topup) or (n.type = 'tutor_not_joined' and v_notjoined))
      and not exists (select 1 from public.notice_emails e where e.notification_id = n.id)
  ) then
    return;
  end if;
  select s.setting_value #>> '{}' into v_url from public.system_settings s where s.setting_key = 'notice_email_worker_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notice_email_job_secret';
  if coalesce(v_url, '') = '' or v_secret is null then
    raise notice 'notice_email_worker_url or the notice_email_job_secret vault secret is not set; the Worker is not woken';
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/internal/notice-emails/run',
    headers := jsonb_build_object('x-job-secret', v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
end;
$$;
revoke all on function public.run_notice_emails() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('run-notice-emails') where exists (select 1 from cron.job where jobname = 'run-notice-emails');
    perform cron.schedule('run-notice-emails', '*/5 * * * *', 'select public.run_notice_emails();');
  end if;
end $$;
