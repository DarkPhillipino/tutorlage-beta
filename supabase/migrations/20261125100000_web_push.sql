-- 24 Nov 2026 (PM line 68 and line 77, RUN 6): WEB PUSH for a request addressed to ONE tutor. Purely ADDITIVE and OFF: nothing user-visible turns on.
-- The alert says only: "You have a new lesson request on Tutorlage. Open the app to answer." It carries NO payload at all (no learner, subject or family detail): the words live in the service worker.
-- How it works: the existing trigger writes the in-app notice 'request_for_you' when a funded request addressed to a tutor appears (migration 20261014200000). A NEW trigger on notifications copies that
-- one fact into push_outbox (only while setting web_push_enabled is true). Every minute a pg_cron job wakes the Worker (pg_net, shared secret in the Vault) ONLY when an alert is due; the Worker claims
-- the due alerts (push_claim), sends one empty Web Push per device of that tutor, reports back (push_finish) and drops dead devices (push_drop_subscription).
-- Her rules, honoured by the database: her own switch (alerts_on), her quiet hours (default 21:00 to 07:00 South African time: an alert that falls inside is held until the window ends), at most N alerts a
-- day per tutor (setting), nothing older than 12 hours is sent. The in-app bell is unchanged.
-- OFF until the CEO: setting web_push_enabled = false, web_push_worker_url = '' and the Vault secret push_job_secret does not exist. The PUBLIC key below is public by design; the PRIVATE key is NOT in any repository
-- (it is a Worker secret, set by the CEO).
-- ROLLBACK: Drake/programmer/rollbacks/20261125100000_web_push_ROLLBACK.sql (also at the foot of this file as comments).

-- 1. settings ------------------------------------------------------------------------------------------------------------------------------------------------------------
insert into public.system_settings (setting_key, setting_value, description) values
  ('web_push_enabled', 'false'::jsonb, 'Master switch for tutor alerts (web push). OFF: the "Turn on alerts" step is hidden and no alert is queued. Switch on only after the Worker sender is live.'),
  ('web_push_public_key', to_jsonb('BPH_nSrFYxI6WGtvohaSaW0ZaxfBf1_T0Fj0jk46e__19GjpB41AGyccBcWZFhgo0LXWH9JH2_4FCjr_H1KZfpc'::text), 'The PUBLIC web-push (VAPID) key the browser needs. Public by design. The private half is a Worker secret, never in a repository.'),
  ('web_push_worker_url', '""'::jsonb, 'Address of the Worker (no trailing path) that the push job wakes with pg_net; empty = it is not woken.'),
  ('web_push_max_per_tutor_day', '10'::jsonb, 'The most alerts one tutor gets in one South African day (a loop or a flood can never buzz a phone all day).')
on conflict (setting_key) do nothing;

-- 2. tables (nobody reads or writes them directly; every use is a function below) ----------------------------------------------------------------------------------------------
-- A device is only its push address: no payload is ever sent, so no encryption keys are kept.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_profile_idx on public.push_subscriptions (profile_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;

create table if not exists public.push_preferences (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  alerts_on boolean not null default true,
  quiet_on boolean not null default true,
  quiet_start smallint not null default 21 check (quiet_start between 0 and 23),
  quiet_end smallint not null default 7 check (quiet_end between 0 and 23),
  updated_at timestamptz not null default now()
);
alter table public.push_preferences enable row level security;
revoke all on public.push_preferences from public, anon, authenticated;

create table if not exists public.push_outbox (
  notification_id uuid primary key references public.notifications (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  day date not null default ((now() at time zone 'Africa/Johannesburg')::date),
  deliver_after timestamptz not null default now(),
  status text not null default 'waiting' check (status in ('waiting', 'claimed', 'sent', 'failed', 'off', 'stale', 'no_device', 'capped')),
  devices_ok integer not null default 0,
  devices_failed integer not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists push_outbox_due_idx on public.push_outbox (status, deliver_after);
create index if not exists push_outbox_profile_day_idx on public.push_outbox (profile_id, day);
alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from public, anon, authenticated;

-- 3. quiet hours: when does an alert due at p_at go out? (South African time; the window may cross midnight) ----------------------------------------------------------------------
create or replace function public.push_quiet_release(p_at timestamptz, p_quiet_on boolean, p_start smallint, p_end smallint)
returns timestamptz
language plpgsql
immutable
set search_path = public
as $$
declare
  v_local timestamp := p_at at time zone 'Africa/Johannesburg';
  v_hour integer := extract(hour from v_local)::integer;
  v_inside boolean;
  v_release timestamp;
begin
  if not p_quiet_on or p_start = p_end then
    return p_at;
  end if;
  v_inside := case when p_start < p_end then v_hour >= p_start and v_hour < p_end else v_hour >= p_start or v_hour < p_end end;
  if not v_inside then
    return p_at;
  end if;
  v_release := date_trunc('day', v_local) + make_interval(hours => p_end);
  if v_release <= v_local then
    v_release := v_release + interval '1 day';
  end if;
  return v_release at time zone 'Africa/Johannesburg';
end;
$$;
revoke all on function public.push_quiet_release(timestamptz, boolean, smallint, smallint) from public, anon;
grant execute on function public.push_quiet_release(timestamptz, boolean, smallint, smallint) to authenticated, service_role;

-- 4. the browser's calls (signed-in tutors only) -------------------------------------------------------------------------------------------------------------------------------------
-- What the Teach screen needs: is the "Turn on alerts" step shown, and the public key. Shown only while the master switch is on AND the key exists AND the caller is a tutor.
create or replace function public.web_push_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_on boolean := coalesce((select s.setting_value = 'true'::jsonb from public.system_settings s where s.setting_key = 'web_push_enabled'), false);
  v_key text := coalesce((select s.setting_value #>> '{}' from public.system_settings s where s.setting_key = 'web_push_public_key'), '');
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not v_on or v_key = '' or not exists (select 1 from public.tutor_profiles tp where tp.id = auth.uid()) then
    return jsonb_build_object('enabled', false);
  end if;
  return jsonb_build_object('enabled', true, 'public_key', v_key);
end;
$$;
revoke all on function public.web_push_config() from public, anon;
grant execute on function public.web_push_config() to authenticated;

create or replace function public.push_save_subscription(p_endpoint text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.tutor_profiles tp where tp.id = auth.uid()) then raise exception 'Only tutors can turn on alerts' using errcode = '42501'; end if;
  if coalesce((select s.setting_value = 'true'::jsonb from public.system_settings s where s.setting_key = 'web_push_enabled'), false) is not true then
    raise exception 'Alerts are not available yet' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 2000 then raise exception 'That device address is not valid' using errcode = '22023'; end if;
  insert into public.push_subscriptions (profile_id, endpoint) values (auth.uid(), p_endpoint)
  on conflict (endpoint) do update set profile_id = excluded.profile_id, created_at = now();
  -- at most 5 devices per tutor: the oldest go
  delete from public.push_subscriptions d
   where d.profile_id = auth.uid()
     and d.id not in (select s.id from public.push_subscriptions s where s.profile_id = auth.uid() order by s.created_at desc limit 5);
  insert into public.push_preferences (profile_id) values (auth.uid()) on conflict (profile_id) do nothing;
end;
$$;
revoke all on function public.push_save_subscription(text) from public, anon;
grant execute on function public.push_save_subscription(text) to authenticated;

create or replace function public.push_remove_subscription(p_endpoint text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  delete from public.push_subscriptions where profile_id = auth.uid() and endpoint = p_endpoint;
end;
$$;
revoke all on function public.push_remove_subscription(text) from public, anon;
grant execute on function public.push_remove_subscription(text) to authenticated;

create or replace function public.my_push_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.push_preferences;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into r from public.push_preferences where profile_id = auth.uid();
  return jsonb_build_object(
    'alerts_on', coalesce(r.alerts_on, true), 'quiet_on', coalesce(r.quiet_on, true),
    'quiet_start', coalesce(r.quiet_start, 21), 'quiet_end', coalesce(r.quiet_end, 7),
    'devices', (select count(*) from public.push_subscriptions s where s.profile_id = auth.uid()));
end;
$$;
revoke all on function public.my_push_settings() from public, anon;
grant execute on function public.my_push_settings() to authenticated;

create or replace function public.set_my_push_settings(p_alerts_on boolean, p_quiet_on boolean, p_quiet_start integer, p_quiet_end integer)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.tutor_profiles tp where tp.id = auth.uid()) then raise exception 'Only tutors have alerts' using errcode = '42501'; end if;
  if p_alerts_on is null or p_quiet_on is null or p_quiet_start is null or p_quiet_end is null
     or p_quiet_start not between 0 and 23 or p_quiet_end not between 0 and 23 then
    raise exception 'Those settings are not valid' using errcode = '22023';
  end if;
  insert into public.push_preferences (profile_id, alerts_on, quiet_on, quiet_start, quiet_end, updated_at)
  values (auth.uid(), p_alerts_on, p_quiet_on, p_quiet_start::smallint, p_quiet_end::smallint, now())
  on conflict (profile_id) do update
    set alerts_on = excluded.alerts_on, quiet_on = excluded.quiet_on, quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, updated_at = now();
end;
$$;
revoke all on function public.set_my_push_settings(boolean, boolean, integer, integer) from public, anon;
grant execute on function public.set_my_push_settings(boolean, boolean, integer, integer) to authenticated;

-- 5. the trigger: a direct request's in-app notice also queues an alert (only while the master switch is on; NEVER blocks the notice) ----------------------------------------------------------
create or replace function public.queue_push_for_request_notice()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r public.push_preferences;
begin
  begin
    if new.type is distinct from 'request_for_you' then
      return null;
    end if;
    if coalesce((select s.setting_value = 'true'::jsonb from public.system_settings s where s.setting_key = 'web_push_enabled'), false) is not true then
      return null;
    end if;
    select * into r from public.push_preferences where profile_id = new.profile_id;
    if found and r.alerts_on is not true then
      insert into public.push_outbox (notification_id, profile_id, status, finished_at) values (new.id, new.profile_id, 'off', now()) on conflict do nothing;
      return null;
    end if;
    insert into public.push_outbox (notification_id, profile_id, deliver_after)
    values (new.id, new.profile_id,
            public.push_quiet_release(now(), coalesce(r.quiet_on, true), coalesce(r.quiet_start, 21::smallint), coalesce(r.quiet_end, 7::smallint)))
    on conflict do nothing;
  exception when others then
    -- an alert problem must never stop the notice or the request
    raise warning 'queue_push_for_request_notice: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.queue_push_for_request_notice() from public, anon, authenticated;

drop trigger if exists trg_queue_push_for_request_notice on public.notifications;
create trigger trg_queue_push_for_request_notice
  after insert on public.notifications
  for each row when (new.type = 'request_for_you')
  execute function public.queue_push_for_request_notice();

-- 6. the Worker's calls (service key only) -------------------------------------------------------------------------------------------------------------------------------------------
-- claim: the alerts due now, one row per device. Re-checks her switch, her quiet hours and the day's cap at send time. Each alert is claimed ONCE (never re-sent after a crash).
create or replace function public.push_claim(p_limit integer default 20)
returns table (notification_id uuid, subscription_id uuid, endpoint text)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  o record;
  r public.push_preferences;
  v_cap integer;
  v_used integer;
  v_release timestamptz;
  v_devices integer;
begin
  if coalesce((select s.setting_value = 'true'::jsonb from public.system_settings s where s.setting_key = 'web_push_enabled'), false) is not true then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('push_claim'));
  begin
    v_cap := least(greatest(coalesce((select (s.setting_value #>> '{}')::integer from public.system_settings s where s.setting_key = 'web_push_max_per_tutor_day'), 10), 0), 50);
  exception when others then
    v_cap := 10;
  end;
  for o in
    select b.notification_id, b.profile_id, b.created_at from public.push_outbox b
     where b.status = 'waiting' and b.deliver_after <= now()
     order by b.deliver_after, b.notification_id
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
     for update skip locked
  loop
    if o.created_at < now() - interval '12 hours' then
      update public.push_outbox set status = 'stale', finished_at = now() where notification_id = o.notification_id;
      continue;
    end if;
    select * into r from public.push_preferences p where p.profile_id = o.profile_id;
    if found and r.alerts_on is not true then
      update public.push_outbox set status = 'off', finished_at = now() where notification_id = o.notification_id;
      continue;
    end if;
    v_release := public.push_quiet_release(now(), coalesce(r.quiet_on, true), coalesce(r.quiet_start, 21::smallint), coalesce(r.quiet_end, 7::smallint));
    if v_release > now() then
      update public.push_outbox set deliver_after = v_release where notification_id = o.notification_id;
      continue;
    end if;
    select count(*)::integer into v_used from public.push_outbox x
     where x.profile_id = o.profile_id and x.day = (now() at time zone 'Africa/Johannesburg')::date and x.status in ('claimed', 'sent', 'failed');
    if v_used >= v_cap then
      update public.push_outbox set status = 'capped', finished_at = now() where notification_id = o.notification_id;
      continue;
    end if;
    select count(*)::integer into v_devices from public.push_subscriptions s where s.profile_id = o.profile_id;
    if v_devices = 0 then
      update public.push_outbox set status = 'no_device', finished_at = now() where notification_id = o.notification_id;
      continue;
    end if;
    update public.push_outbox set status = 'claimed', day = (now() at time zone 'Africa/Johannesburg')::date where notification_id = o.notification_id;
    return query select o.notification_id, s.id, s.endpoint from public.push_subscriptions s where s.profile_id = o.profile_id;
  end loop;
end;
$$;
revoke all on function public.push_claim(integer) from public, anon, authenticated;
grant execute on function public.push_claim(integer) to service_role;

create or replace function public.push_finish(p_notification_id uuid, p_ok integer, p_failed integer)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update public.push_outbox o
     set status = case when p_ok > 0 then 'sent' else 'failed' end, devices_ok = greatest(p_ok, 0), devices_failed = greatest(p_failed, 0), finished_at = now()
   where o.notification_id = p_notification_id and o.status = 'claimed';
end;
$$;
revoke all on function public.push_finish(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.push_finish(uuid, integer, integer) to service_role;

create or replace function public.push_drop_subscription(p_subscription_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  delete from public.push_subscriptions s where s.id = p_subscription_id;
end;
$$;
revoke all on function public.push_drop_subscription(uuid) from public, anon, authenticated;
grant execute on function public.push_drop_subscription(uuid) to service_role;

-- 7. the wake-up (every minute; does NOTHING unless the switch is on, the Worker address and the Vault secret exist, and an alert is due) -----------------------------------------------
create or replace function public.run_push_alerts()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  if coalesce((select s.setting_value = 'true'::jsonb from public.system_settings s where s.setting_key = 'web_push_enabled'), false) is not true then
    return;
  end if;
  if not exists (select 1 from public.push_outbox b where b.status = 'waiting' and b.deliver_after <= now()) then
    return;
  end if;
  select s.setting_value #>> '{}' into v_url from public.system_settings s where s.setting_key = 'web_push_worker_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_job_secret';
  if coalesce(v_url, '') = '' or v_secret is null then
    raise notice 'web_push_worker_url or the push_job_secret vault secret is not set; the Worker is not woken';
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/internal/push/run',
    headers := jsonb_build_object('x-job-secret', v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
end;
$$;
revoke all on function public.run_push_alerts() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('run-push-alerts') where exists (select 1 from cron.job where jobname = 'run-push-alerts');
    perform cron.schedule('run-push-alerts', '* * * * *', 'select public.run_push_alerts();');
  end if;
end $$;

-- ROLLBACK (comments; the same text is in the rollbacks folder):
--   select cron.unschedule('run-push-alerts');
--   drop trigger if exists trg_queue_push_for_request_notice on public.notifications;
--   drop function if exists public.queue_push_for_request_notice(), public.run_push_alerts(), public.push_claim(integer), public.push_finish(uuid,integer,integer), public.push_drop_subscription(uuid),
--     public.web_push_config(), public.push_save_subscription(text), public.push_remove_subscription(text), public.my_push_settings(), public.set_my_push_settings(boolean,boolean,integer,integer),
--     public.push_quiet_release(timestamptz,boolean,smallint,smallint);
--   drop table if exists public.push_outbox, public.push_preferences, public.push_subscriptions;
--   delete from public.system_settings where setting_key in ('web_push_enabled','web_push_public_key','web_push_worker_url','web_push_max_per_tutor_day');
