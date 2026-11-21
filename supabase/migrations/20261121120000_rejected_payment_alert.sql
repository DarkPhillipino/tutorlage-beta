-- 21 Nov 2026, JOB L (OWASP review finding 5, PM line of 21 Nov about 16:00): ONE finance alert kind, "5 or more rejected payment notifications in an hour". ADDITIVE: one new read-only
-- function and one new setting. No table, column, policy, job or existing function changes; the Worker is not touched.
-- Today a rejected message to the online payment address is stored (wallet_provider_events, outcome 'rejected', at most 20 recorded an hour) and finance gets a bell notice at most once an
-- hour, but a RUN of them (bad signatures, old timestamps, unreadable bodies) raises nothing of its own. This is the number the admin app's new watcher asks for.
--
-- admin_rejected_payment_alert(): finance managers and super admins only. Counts the rejected WEBHOOK messages of the last hour (status checks are our own questions, not notifications;
-- the "(missing_header)" probes that carry no signature at all are the quiet noise the 16 Nov migration already limits to one an hour, so they are left out) and returns ONE row when the
-- count has reached the threshold, none otherwise. The row holds the count, the threshold, the window and the first/last time, and a ref ('rejected:<UTC hour>') that changes once an hour,
-- so a burst that goes on is announced once an hour at most. It names nobody and quotes no message text.
-- The threshold is the setting rejected_payment_alert_count (5; edit it in the admin app's settings, whole number 1 or more; a bad value falls back to 5).
-- Rollback: Drake/programmer/rollbacks/20261121120000_rejected_payment_alert_ROLLBACK.sql

insert into public.system_settings (setting_key, setting_value, description) values
  ('rejected_payment_alert_count', '5'::jsonb,
   'The finance alert "rejected payment notifications": how many rejected messages to the online payment address, in one hour, make the admin app tell finance. Whole number, 1 or more (a bad value counts as 5). Messages with no signature header at all (probes) are not counted.')
on conflict (setting_key) do nothing;

create or replace function public.admin_rejected_payment_alert()
returns table (
  rejected_count bigint,
  threshold integer,
  window_minutes integer,
  first_at timestamptz,
  last_at timestamptz,
  ref text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_thr integer := greatest(coalesce(public.wallet_int_setting('rejected_payment_alert_count', 5), 5), 1);
  v_n bigint;
  v_first timestamptz;
  v_last timestamptz;
begin
  if not public.is_active_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not public.wallet_is_finance_admin() then
    raise exception 'Only finance can see this' using errcode = '42501';
  end if;
  select count(*), min(e.created_at), max(e.created_at) into v_n, v_first, v_last
    from public.wallet_provider_events e
   where e.outcome = 'rejected'
     and e.source = 'webhook'
     and position('(missing_header)' in coalesce(e.detail, '')) = 0
     and e.created_at > now() - interval '1 hour';
  if v_n >= v_thr then
    return query select v_n, v_thr, 60, v_first, v_last, 'rejected:' || to_char(date_trunc('hour', now() at time zone 'UTC'), 'YYYYMMDDHH24');
  end if;
end;
$$;
revoke all on function public.admin_rejected_payment_alert() from public, anon, service_role;
grant execute on function public.admin_rejected_payment_alert() to authenticated;
