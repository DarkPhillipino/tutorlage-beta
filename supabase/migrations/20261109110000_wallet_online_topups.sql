-- WALLET ONLINE TOP-UPS, phase 1 of 3 (database only). Ozow pay-by-bank, behind a provider-neutral door; the manual bank transfer stays exactly as it is.
-- Design: Drake/programmer/reports/2026-11-09-ozow-design.md (part 1.4); approved as a first cut by the CEO on 9 Nov 2026. This file changes the database only: no Worker,
-- no screen, no admin panel (later phases). Nothing here talks to Ozow; the Worker (phase 2) will, through the functions below.
-- Apply AFTER the wallet migrations (20261102200100 wallet_core, 20261102210000 wallet_booking, 20261103100000 wallet_edges) and Programmer B's promo migrations (all on production).
-- The whole file is one transaction. It adds enum values to nothing, so it can also be run inside the rolled-back runner (scripts/run-rolled-back-test.mjs).
--
-- WHAT IS NEW
--   * three tables, all closed to browsers:
--       wallet_online_attempts  one row per online top-up: the provider, its payment id and the link (kept OFF wallet_topups so no browser can read them), the times we need
--       wallet_provider_events  the audit and idempotency record of everything a provider told us or we decided (ids, status words and short reasons only; no bodies, no personal
--                               data; kept 7 years); finance admins may read it
--       wallet_online_staff     the people who see the online option while the mode is 'staff' (the first real payment happens with the site closed to others)
--   * wallet_topups: the method may be 'online' and the status may be 'awaiting_payment' (CHECKs widened; no column added; every old row stays valid)
--   * four settings (wallet_ prefix, so only finance admins can change them): wallet_online_mode off|staff|on (seeded off), wallet_online_provider, wallet_online_expire_minutes,
--     wallet_online_check_after_minutes
--   * browser door: create_online_topup(amount), wallet_online_available()
--   * Worker doors (service_role only): wallet_online_claim, _attach, _create_failed, _apply, _record_event, _check_request, _mark_checked, _due_checks
--   * jobs (pg_cron, postgres only): wallet_online_backstop_job every 5 minutes, wallet_online_daily_job at 02:30; wallet_online_close_expired runs inside the first
--   * ONE in-place patch of a live function: wallet_credit_topup accepts an online top-up that is awaiting payment (one condition; it is applied to the CURRENT stored text,
--     so nothing Programmer B or anyone else changed is undone, and it stops with an error, changing nothing, unless its anchor is found exactly once)
-- NOT touched on purpose: create_wallet_topup, wallet_payment_details, wallet_settings_guard, wallet_totals, closure_wallet_summary, closure_wallet_owes, closure_start,
--   retention_run_wallet_records, wallet_cancel_stale_topups, cancel_my_topup, attach_topup_proof, admin_mark_topup_*, and every function Programmer B patched.

-- 1. settings -------------------------------------------------------------------------------------------------------------------------------
insert into public.system_settings (setting_key, setting_value, description) values
  ('wallet_online_mode', '"off"'::jsonb, 'Paying a top-up online with the bank: off (nobody), staff (only the people listed in wallet_online_staff), on (everyone). Turning it off stops NEW online payments only; money already paid is still credited.'),
  ('wallet_online_provider', '"ozow"'::jsonb, 'Which provider an online top-up is sent to. The wallet, the ledger and the screens do not change when this does.'),
  ('wallet_online_expire_minutes', '60'::jsonb, 'Minutes an online payment link stays valid (10 to 1440).'),
  ('wallet_online_check_after_minutes', '10'::jsonb, 'Minutes after a top-up is created before the 5-minute job asks the provider about it, if no message arrived.')
on conflict (setting_key) do nothing;

-- 2. widen wallet_topups (checks only; no column is added) -----------------------------------------------------------------------------------
alter table public.wallet_topups drop constraint if exists wallet_topups_method_check;
alter table public.wallet_topups add constraint wallet_topups_method_check check (method in ('eft', 'card', 'online'));
alter table public.wallet_topups drop constraint if exists wallet_topups_status_check;
alter table public.wallet_topups add constraint wallet_topups_status_check
  check (status in ('awaiting_proof', 'proof_sent', 'awaiting_payment', 'successful', 'unsuccessful', 'cancelled'));
alter table public.wallet_topups drop constraint if exists wallet_topups_state;
alter table public.wallet_topups add constraint wallet_topups_state check (
  case status
    when 'awaiting_proof' then received_rand is null and ledger_id is null and decided_at is null
    when 'proof_sent' then coalesce(proof_path, '') <> '' and received_rand is null and ledger_id is null and decided_at is null
    when 'awaiting_payment' then method = 'online' and coalesce(proof_path, '') = '' and received_rand is null and ledger_id is null and decided_at is null
    when 'successful' then coalesce(received_rand, 0) > 0 and ledger_id is not null and decided_at is not null
                           and (received_rand = amount_rand or length(btrim(coalesce(decision_comment, ''))) >= 3)
    when 'unsuccessful' then received_rand is null and ledger_id is null and decided_at is not null and length(btrim(coalesce(decision_comment, ''))) >= 3
    when 'cancelled' then received_rand is null and ledger_id is null
    else false end);

-- 3. tables ---------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.wallet_online_attempts (
  topup_id uuid primary key references public.wallet_topups (id) on delete cascade,
  provider text not null check (length(provider) between 1 and 30),
  provider_payment_id text check (length(provider_payment_id) between 1 and 100),
  redirect_url text check (length(redirect_url) <= 2000),
  provider_txn_id text check (length(provider_txn_id) between 1 and 100),
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  checked_at timestamptz,
  check_requested_at timestamptz,
  last_status text check (length(last_status) <= 40),
  last_reason text check (length(last_reason) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists wallet_online_attempts_payment_key on public.wallet_online_attempts (provider, provider_payment_id) where provider_payment_id is not null;
create unique index if not exists wallet_online_attempts_txn_key on public.wallet_online_attempts (provider, provider_txn_id) where provider_txn_id is not null;
alter table public.wallet_online_attempts enable row level security;
revoke all on public.wallet_online_attempts from public, anon, authenticated, service_role;

create table if not exists public.wallet_provider_events (
  id bigint generated always as identity primary key,
  provider text not null check (length(provider) between 1 and 30),
  event_id text check (length(event_id) between 1 and 200),
  source text not null check (source in ('webhook', 'status_check', 'admin', 'system')),
  topup_id uuid references public.wallet_topups (id) on delete set null,
  reference text check (length(reference) <= 20),
  provider_txn_id text check (length(provider_txn_id) <= 100),
  provider_status text check (length(provider_status) <= 40),
  amount_text text check (length(amount_text) <= 20),
  currency text check (length(currency) <= 10),
  outcome text not null check (outcome in ('credited', 'already', 'duplicate', 'ignored', 'attempt_failed', 'needs_review', 'rejected')),
  detail text check (length(detail) <= 400),
  resolved_at timestamptz,
  resolved_note text check (length(resolved_note) <= 400),
  created_at timestamptz not null default now()
);
create unique index if not exists wallet_provider_events_event_key on public.wallet_provider_events (provider, event_id) where event_id is not null;
create index if not exists wallet_provider_events_topup_idx on public.wallet_provider_events (topup_id);
create index if not exists wallet_provider_events_created_idx on public.wallet_provider_events (created_at);
create index if not exists wallet_provider_events_open_review_idx on public.wallet_provider_events (created_at) where outcome = 'needs_review' and resolved_at is null;
alter table public.wallet_provider_events enable row level security;
drop policy if exists "Finance admins read provider events" on public.wallet_provider_events;
create policy "Finance admins read provider events" on public.wallet_provider_events for select to authenticated using (public.wallet_is_finance_admin());
revoke all on public.wallet_provider_events from public, anon, authenticated, service_role;
grant select on public.wallet_provider_events to authenticated;

create table if not exists public.wallet_online_staff (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  note text check (length(note) <= 200),
  added_at timestamptz not null default now()
);
alter table public.wallet_online_staff enable row level security;
revoke all on public.wallet_online_staff from public, anon, authenticated, service_role;

-- 4. internal helpers (nobody but the database's own definer functions can run these) -------------------------------------------------------------
create or replace function public.wallet_online_mode()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case lower(btrim(coalesce((select s.setting_value #>> '{}' from public.system_settings s where s.setting_key = 'wallet_online_mode'), '')))
           when 'on' then 'on' when 'staff' then 'staff' else 'off' end;
$$;
revoke all on function public.wallet_online_mode() from public, anon, authenticated, service_role;

create or replace function public.wallet_online_allowed(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_profile is not null and case public.wallet_online_mode()
           when 'on' then true
           when 'staff' then exists (select 1 from public.wallet_online_staff st where st.profile_id = p_profile)
           else false end;
$$;
revoke all on function public.wallet_online_allowed(uuid) from public, anon, authenticated, service_role;

-- One way to write a time for the Worker: UTC, to the second, ending in Z (kept in one place).
create or replace function public.wallet_online_iso(p_ts timestamptz)
returns text
language sql
immutable
set search_path = public
as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
$$;
revoke all on function public.wallet_online_iso(timestamptz) from public, anon, authenticated, service_role;

create or replace function public.wallet_online_log(p_provider text, p_source text, p_event_id text, p_topup uuid, p_reference text, p_txn text, p_status text,
                                                    p_amount text, p_currency text, p_outcome text, p_detail text, p_dedupe boolean default true)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  -- the same fact told again (the backstop asks every 10 minutes) is not written or alerted twice
  if p_dedupe and p_outcome <> 'credited' and exists (
       select 1 from public.wallet_provider_events e
       where e.provider = left(p_provider, 30) and e.topup_id is not distinct from p_topup and e.reference is not distinct from left(p_reference, 20)
         and e.provider_txn_id is not distinct from left(p_txn, 100) and lower(e.provider_status) is not distinct from lower(left(p_status, 40))
         and e.outcome = p_outcome and e.detail is not distinct from left(p_detail, 400)) then
    return null;
  end if;
  insert into public.wallet_provider_events (provider, event_id, source, topup_id, reference, provider_txn_id, provider_status, amount_text, currency, outcome, detail)
  values (left(p_provider, 30), left(p_event_id, 200), p_source, p_topup, left(p_reference, 20), left(p_txn, 100), left(p_status, 40), left(p_amount, 20), left(p_currency, 10),
          p_outcome, left(p_detail, 400))
  on conflict (provider, event_id) where event_id is not null do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.wallet_online_log(text, text, text, uuid, text, text, text, text, text, text, text, boolean) from public, anon, authenticated, service_role;

-- 5. browser doors --------------------------------------------------------------------------------------------------------------------------
-- Does this signed-in adult see the online option? (The Add-money screen calls it; it never names a provider.)
create or replace function public.wallet_online_available()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and public.wallet_open() and public.is_adult(auth.uid()) and public.wallet_online_allowed(auth.uid());
$$;
revoke all on function public.wallet_online_available() from public, anon, authenticated, service_role;
grant execute on function public.wallet_online_available() to authenticated;

-- Start an online top-up: the same guards as the manual transfer (adult, limits, per-day, waiting, cap) plus the mode. Creates the row only; the Worker starts the payment.
create or replace function public.create_online_topup(p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_min integer := public.wallet_int_setting('wallet_topup_min_rand', 50);
  v_max integer := public.wallet_int_setting('wallet_topup_max_rand', 5000);
  v_cap integer := public.wallet_int_setting('wallet_balance_cap_rand', 10000);
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_balance integer;
  v_pending integer;
  v_n integer;
  v_bytes bytea;
  v_ref text;
  v_id uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not public.wallet_open() then
    raise exception 'Wallet payments are not open.' using errcode = '55000';
  end if;
  if not public.is_adult(uid) then
    raise exception 'Only an adult can add money to a wallet. A parent adds money for their children.' using errcode = '22023';
  end if;
  if not public.wallet_online_allowed(uid) then
    raise exception 'Paying with your bank is not switched on yet.' using errcode = '55000';
  end if;
  if p_amount is null or p_amount < v_min or p_amount > v_max then
    raise exception 'Add between R% and R% at a time, in whole rands.', v_min, v_max using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wallet_topup:' || uid::text, 0));
  select count(*) into v_n from public.wallet_topups where profile_id = uid and status = 'awaiting_payment';
  if v_n >= public.wallet_int_setting('wallet_topup_max_waiting', 3) then
    raise exception 'You already have % online payments waiting. Finish one, or wait about an hour for it to expire, first.', v_n using errcode = '55000';
  end if;
  select count(*) into v_n from public.wallet_topups where profile_id = uid and created_at > now() - interval '24 hours';
  if v_n >= public.wallet_int_setting('wallet_topup_max_per_day', 10) then
    raise exception 'You have made many top-up requests today. Please try again tomorrow.' using errcode = '55000';
  end if;
  select coalesce(available_rand + held_rand, 0) into v_balance from public.wallets where profile_id = uid;
  select coalesce(sum(amount_rand), 0) into v_pending from public.wallet_topups where profile_id = uid and status in ('awaiting_proof', 'proof_sent', 'awaiting_payment');
  if coalesce(v_balance, 0) + v_pending + p_amount > v_cap then
    raise exception 'That would take your wallet above R%. You can add up to R% now.', v_cap, greatest(v_cap - coalesce(v_balance, 0) - v_pending, 0) using errcode = '22023';
  end if;
  for i in 1..10 loop
    v_bytes := decode(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), 'hex');
    v_ref := 'TL-' || (select string_agg(substr(v_alpha, (get_byte(v_bytes, g) % 32) + 1, 1), '' order by g) from generate_series(0, 5) g);
    begin
      insert into public.wallet_topups (profile_id, method, status, reference, amount_rand) values (uid, 'online', 'awaiting_payment', v_ref, p_amount) returning id into v_id;
      exit;
    exception when unique_violation then
      v_id := null;
    end;
  end loop;
  if v_id is null then
    raise exception 'Could not create a reference. Please try again.' using errcode = '55000';
  end if;
  return jsonb_build_object('topup_id', v_id, 'reference', v_ref, 'amount_rand', p_amount, 'status', 'awaiting_payment', 'method', 'online');
end;
$$;
revoke all on function public.create_online_topup(integer) from public, anon, authenticated, service_role;
grant execute on function public.create_online_topup(integer) to authenticated;

-- 6. Worker doors (service_role only; the Worker passes the payer's id read from the signed-in token, the browser sends no amount) ----------------
-- Decide what the Worker does for this top-up: create (first caller only), resume (the stored link), busy (another call is creating it), or closed.
create or replace function public.wallet_online_claim(p_topup uuid, p_payer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.wallet_topups;
  v_a public.wallet_online_attempts;
  v_minutes integer := least(greatest(public.wallet_int_setting('wallet_online_expire_minutes', 60), 10), 1440);
  v_prov text;
  v_exp timestamptz;
begin
  select * into v_t from public.wallet_topups where id = p_topup and profile_id = p_payer and method = 'online' for update;
  if not found then
    raise exception 'No such top-up' using errcode = 'P0002';
  end if;
  if v_t.status <> 'awaiting_payment' then
    return jsonb_build_object('action', 'closed', 'status', v_t.status);
  end if;
  select * into v_a from public.wallet_online_attempts where topup_id = v_t.id for update;
  if found then
    if v_a.provider_payment_id is not null then
      if v_a.redirect_url is not null and v_a.expires_at > now() then
        return jsonb_build_object('action', 'resume', 'redirect_url', v_a.redirect_url, 'expires_at', public.wallet_online_iso(v_a.expires_at));
      end if;
      return jsonb_build_object('action', 'closed', 'status', v_t.status, 'why', 'expired');
    end if;
    if v_a.claimed_at > now() - interval '2 minutes' then
      return jsonb_build_object('action', 'busy');
    end if;
    -- claimed more than 2 minutes ago and no payment id was saved: the create call was lost; nobody holds a link, so close this one and let the payer start again
    update public.wallet_topups set status = 'unsuccessful', decided_at = now(), decision_comment = 'We could not start the online payment', updated_at = now() where id = v_t.id;
    perform public.wallet_online_log(v_a.provider, 'system', null, v_t.id, v_t.reference, null, null, null, null, 'attempt_failed', 'The payment was claimed but never got a payment id', false);
    perform public.wallet_notify(v_t.profile_id, 'wallet_topup_cancelled', 'Online payment could not start',
      format('Your online payment of R%s (reference %s) could not be started, so nothing was taken. You can try again, or pay by bank transfer instead.', v_t.amount_rand, v_t.reference));
    return jsonb_build_object('action', 'closed', 'status', 'unsuccessful');
  end if;
  -- no attempt yet: only a mode that allows this payer may start one (turning the mode off stops NEW payments)
  if not public.wallet_open() or not public.wallet_online_allowed(p_payer) then
    return jsonb_build_object('action', 'closed', 'status', v_t.status, 'why', 'off');
  end if;
  v_prov := lower(coalesce(nullif(btrim(coalesce((select s.setting_value #>> '{}' from public.system_settings s where s.setting_key = 'wallet_online_provider'), '')), ''), 'ozow'));
  v_exp := date_trunc('second', now() + make_interval(mins => v_minutes));
  insert into public.wallet_online_attempts (topup_id, provider, claimed_at, expires_at) values (v_t.id, v_prov, now(), v_exp);
  return jsonb_build_object('action', 'create', 'provider', v_prov, 'reference', v_t.reference, 'amount_rand', v_t.amount_rand,
                            'expires_at', public.wallet_online_iso(v_exp), 'idempotency_key', 'topup-' || v_t.id::text);
end;
$$;
revoke all on function public.wallet_online_claim(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.wallet_online_claim(uuid, uuid) to service_role;

-- Save the provider's payment id and link exactly as returned (the id first, so a second payment can never be made for this top-up).
create or replace function public.wallet_online_attach(p_topup uuid, p_payment_id text, p_redirect_url text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.wallet_topups;
  v_a public.wallet_online_attempts;
  v_id text := btrim(coalesce(p_payment_id, ''));
  v_url text := btrim(coalesce(p_redirect_url, ''));
begin
  if length(v_id) < 1 or length(v_id) > 100 then
    raise exception 'The payment id is missing or too long' using errcode = '22023';
  end if;
  if v_url !~ '^https://[^[:space:]]+$' or length(v_url) < 12 or length(v_url) > 2000 then
    raise exception 'The payment link must be a web address starting with https://' using errcode = '22023';
  end if;
  select * into v_t from public.wallet_topups where id = p_topup and method = 'online' for update;
  if not found then
    raise exception 'No such top-up' using errcode = 'P0002';
  end if;
  select * into v_a from public.wallet_online_attempts where topup_id = v_t.id for update;
  if not found then
    raise exception 'No payment was started for this top-up' using errcode = '55000';
  end if;
  if v_a.provider_payment_id is not null then
    if v_a.provider_payment_id = v_id then
      return jsonb_build_object('attached', true, 'again', true, 'expires_at', public.wallet_online_iso(v_a.expires_at));
    end if;
    raise exception 'A different payment is already saved for this top-up' using errcode = '23505';
  end if;
  update public.wallet_online_attempts set provider_payment_id = v_id, redirect_url = v_url, updated_at = now() where topup_id = v_t.id;
  if v_t.status <> 'awaiting_payment' then
    -- closed while the provider call was in flight: the id is kept for the record, but the link must not be given to the payer
    return jsonb_build_object('attached', false, 'status', v_t.status);
  end if;
  return jsonb_build_object('attached', true, 'again', false, 'expires_at', public.wallet_online_iso(v_a.expires_at));
end;
$$;
revoke all on function public.wallet_online_attach(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.wallet_online_attach(uuid, text, text) to service_role;

-- The provider refused or failed before any payment existed: close the top-up so the payer can start again or use the bank transfer.
create or replace function public.wallet_online_create_failed(p_topup uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.wallet_topups;
  v_a public.wallet_online_attempts;
begin
  select * into v_t from public.wallet_topups where id = p_topup and method = 'online' for update;
  if not found then
    raise exception 'No such top-up' using errcode = 'P0002';
  end if;
  select * into v_a from public.wallet_online_attempts where topup_id = v_t.id for update;
  if v_t.status <> 'awaiting_payment' or (found and v_a.provider_payment_id is not null) then
    return jsonb_build_object('closed', false, 'status', v_t.status);
  end if;
  update public.wallet_topups set status = 'unsuccessful', decided_at = now(), decision_comment = 'We could not start the online payment', updated_at = now() where id = v_t.id;
  perform public.wallet_online_log(coalesce(v_a.provider, 'unknown'), 'system', null, v_t.id, v_t.reference, null, null, null, null, 'attempt_failed',
                                   'Could not start: ' || coalesce(nullif(btrim(p_reason), ''), 'no reason given'), false);
  perform public.wallet_notify(v_t.profile_id, 'wallet_topup_cancelled', 'Online payment could not start',
    format('Your online payment of R%s (reference %s) could not be started, so nothing was taken. You can try again, or pay by bank transfer instead.', v_t.amount_rand, v_t.reference));
  return jsonb_build_object('closed', true, 'status', 'unsuccessful');
end;
$$;
revoke all on function public.wallet_online_create_failed(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.wallet_online_create_failed(uuid, text) to service_role;

-- THE ONE DECISION POINT: a provider message (webhook) or a status check says something about a transaction. Every rule lives here. Anything that does not match is
-- never credited: it is recorded as needs_review and the finance admins are told. Money is credited only through wallet_credit_topup (ledger key topup:<id>).
--   p_site_ok / p_is_test / p_allow_test: the Worker compares SiteCode with its own secret and says whether staging is in use; the secrets never reach the database.
create or replace function public.wallet_online_apply(p_provider text, p_source text, p_event_id text, p_reference text, p_txn_id text, p_status text,
                                                      p_amount_text text, p_currency text, p_site_ok boolean, p_is_test text, p_allow_test boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.wallet_topups;
  v_a public.wallet_online_attempts;
  v_prov text := lower(btrim(coalesce(p_provider, '')));
  v_ref text := upper(btrim(coalesce(p_reference, '')));
  v_txn text := nullif(btrim(coalesce(p_txn_id, '')), '');
  v_st text := lower(btrim(coalesce(p_status, '')));
  v_outcome text;
  v_detail text;
  v_res jsonb;
  v_ev bigint;
  v_now_status text;
begin
  if v_prov = '' then
    raise exception 'Say which provider' using errcode = '22023';
  end if;
  if p_source not in ('webhook', 'status_check') then
    raise exception 'Unknown source' using errcode = '22023';
  end if;
  -- the same delivery again (same event id): nothing to do
  if p_event_id is not null and exists (select 1 from public.wallet_provider_events e where e.provider = v_prov and e.event_id = left(p_event_id, 200)) then
    return jsonb_build_object('outcome', 'duplicate', 'same_event', true);
  end if;
  select tp.* into v_t from public.wallet_topups tp join public.wallet_online_attempts ap on ap.topup_id = tp.id
   where tp.reference = v_ref and tp.method = 'online' and ap.provider = v_prov for update of tp;
  if not found then
    v_outcome := 'needs_review';
    v_detail := 'No online top-up has this reference';
  else
    select * into v_a from public.wallet_online_attempts where topup_id = v_t.id for update;
    if v_t.status = 'awaiting_payment' then
      update public.wallet_online_attempts set last_status = left(btrim(coalesce(p_status, '')), 40), last_reason = left(btrim(coalesce(p_reason, '')), 200), updated_at = now()
       where topup_id = v_t.id;
    end if;
    if v_st = 'successful' then
      if p_site_ok is distinct from true then
        v_detail := 'The site code does not match ours';
      elsif upper(btrim(coalesce(p_currency, ''))) <> 'ZAR' then
        v_detail := 'The currency is not ZAR (' || left(coalesce(nullif(btrim(p_currency), ''), 'none'), 10) || ')';
      elsif btrim(coalesce(p_amount_text, '')) !~ '^[0-9]{1,9}\.[0-9]{2}$' then
        v_detail := 'The amount is not in the expected form';
      elsif btrim(p_amount_text)::numeric <> v_t.amount_rand then
        v_detail := format('Paid R%s but the top-up is R%s', btrim(p_amount_text), v_t.amount_rand);
      elsif lower(btrim(coalesce(p_is_test, ''))) in ('true', '1', 'yes') and not coalesce(p_allow_test, false) then
        v_detail := 'A test payment arrived on the live site';
      elsif v_txn is null then
        v_detail := 'There is no transaction id';
      elsif exists (select 1 from public.wallet_online_attempts x where x.provider = v_prov and x.provider_txn_id = v_txn and x.topup_id <> v_t.id) then
        v_detail := 'This transaction is already on another top-up';
      end if;
      if v_detail is not null then
        v_outcome := 'needs_review';
      elsif v_t.status = 'awaiting_payment' then
        begin
          update public.wallet_online_attempts set provider_txn_id = v_txn, updated_at = now() where topup_id = v_t.id;
          v_res := public.wallet_credit_topup(v_t.id, v_t.amount_rand, null, format('Paid online (%s), transaction %s', v_prov, v_txn));
          v_outcome := case when coalesce((v_res ->> 'already')::boolean, false) then 'already' else 'credited' end;
          v_detail := format('R%s added to the wallet', v_t.amount_rand);
        exception when others then
          v_outcome := 'needs_review';
          v_detail := 'The credit failed: ' || left(sqlerrm, 250);
        end;
      elsif v_t.status = 'successful' then
        if v_a.provider_txn_id is not distinct from v_txn then
          v_outcome := 'already';
          v_detail := 'Already credited';
        else
          v_outcome := 'needs_review';
          v_detail := 'Paid twice: a second successful transaction for a top-up that was already credited. A refund is needed.';
        end if;
      else
        v_outcome := 'needs_review';
        v_detail := format('Late payment: the top-up was already %s. Add it by hand if the money arrived.', v_t.status);
      end if;
    elsif v_st not in ('pending', 'incomplete', 'error', 'voided', 'cancelled', 'abandoned', 'expired') then
      v_outcome := 'needs_review';
      v_detail := 'The provider sent a status we do not know: ' || left(coalesce(nullif(v_st, ''), 'none'), 40);
    elsif v_t.status <> 'awaiting_payment' then
      v_outcome := 'ignored';
      v_detail := format('The top-up is already %s; the provider says %s', v_t.status, v_st);
    elsif v_st in ('pending', 'incomplete') then
      v_outcome := 'ignored';
      v_detail := 'Not finished yet (' || v_st || ')';
    elsif v_st = 'error' then
      v_outcome := 'attempt_failed';
      v_detail := 'This attempt did not go through' || coalesce(': ' || nullif(left(btrim(coalesce(p_reason, '')), 150), ''), '');
    else
      v_outcome := 'ignored';
      v_detail := 'Ended without a payment (' || v_st || ')';
    end if;
  end if;
  v_ev := public.wallet_online_log(v_prov, p_source, p_event_id, v_t.id, coalesce(v_t.reference, v_ref), v_txn, p_status, p_amount_text, p_currency, v_outcome, v_detail);
  if v_outcome = 'needs_review' and v_ev is not null then
    perform public.wallet_notify_finance('wallet_online_review', 'An online payment needs a person',
      format('%s (reference %s). Look at it in the admin app (Payments, Wallets). If the money did arrive, add the top-up by hand.', v_detail, coalesce(nullif(v_ref, ''), 'unknown')));
  end if;
  select tp.status into v_now_status from public.wallet_topups tp where tp.id = v_t.id;
  return jsonb_build_object('outcome', v_outcome, 'topup_id', v_t.id, 'status', v_now_status, 'reference', coalesce(v_t.reference, v_ref), 'detail', v_detail);
end;
$$;
revoke all on function public.wallet_online_apply(text, text, text, text, text, text, text, text, boolean, text, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.wallet_online_apply(text, text, text, text, text, text, text, text, boolean, text, boolean, text) to service_role;

-- A message the Worker could not or would not act on (failed signature, a "thin" message, an unreadable body). Rejected ones: at most 20 recorded an hour, at most one alert an hour.
create or replace function public.wallet_online_record_event(p_provider text, p_source text, p_event_id text, p_outcome text, p_detail text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prov text := lower(btrim(coalesce(p_provider, '')));
  v_id bigint;
begin
  if v_prov = '' then
    raise exception 'Say which provider' using errcode = '22023';
  end if;
  if p_outcome not in ('rejected', 'needs_review', 'ignored') then
    raise exception 'That outcome cannot be recorded here' using errcode = '22023';
  end if;
  if p_source not in ('webhook', 'status_check') then
    raise exception 'Unknown source' using errcode = '22023';
  end if;
  if p_outcome = 'rejected' and (select count(*) from public.wallet_provider_events e where e.outcome = 'rejected' and e.created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('recorded', false, 'why', 'capped');
  end if;
  v_id := public.wallet_online_log(v_prov, p_source, p_event_id, null, null, null, null, null, null, p_outcome, p_detail, false);
  if v_id is not null and p_outcome = 'rejected' and not exists (select 1 from public.notifications n where n.type = 'wallet_online_rejected' and n.created_at > now() - interval '1 hour') then
    perform public.wallet_notify_finance('wallet_online_rejected', 'A message to the online payment address was refused',
      format('It failed the safety check (%s). Nothing was credited. If this keeps happening, tell the programmer.', left(coalesce(nullif(btrim(p_detail), ''), 'no reason'), 100)));
  elsif v_id is not null and p_outcome = 'needs_review' then
    perform public.wallet_notify_finance('wallet_online_review', 'An online payment needs a person',
      format('%s. Look at it in the admin app (Payments, Wallets).', left(coalesce(nullif(btrim(p_detail), ''), 'no reason'), 300)));
  end if;
  return jsonb_build_object('recorded', v_id is not null, 'id', v_id);
end;
$$;
revoke all on function public.wallet_online_record_event(text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.wallet_online_record_event(text, text, text, text, text) to service_role;

-- "Check now" from the payer's own page (the Worker reads the payer from the token): at most one provider check per 15 seconds per top-up.
create or replace function public.wallet_online_check_request(p_topup uuid, p_payer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.wallet_topups;
  v_a public.wallet_online_attempts;
begin
  select * into v_t from public.wallet_topups where id = p_topup and profile_id = p_payer and method = 'online';
  if not found then
    raise exception 'No such top-up' using errcode = 'P0002';
  end if;
  if v_t.status <> 'awaiting_payment' then
    return jsonb_build_object('action', 'closed', 'status', v_t.status);
  end if;
  select * into v_a from public.wallet_online_attempts where topup_id = v_t.id for update;
  if not found or v_a.provider_payment_id is null then
    return jsonb_build_object('action', 'nothing_to_check');
  end if;
  if v_a.check_requested_at is not null and v_a.check_requested_at > now() - interval '15 seconds' then
    return jsonb_build_object('action', 'wait', 'retry_after_seconds', greatest(1, ceil(15 - extract(epoch from (now() - v_a.check_requested_at)))::integer));
  end if;
  update public.wallet_online_attempts set check_requested_at = now() where topup_id = v_t.id;
  return jsonb_build_object('action', 'check', 'topup_id', v_t.id, 'reference', v_t.reference, 'amount_rand', v_t.amount_rand, 'provider', v_a.provider,
                            'provider_payment_id', v_a.provider_payment_id, 'created_at', v_t.created_at, 'expires_at', v_a.expires_at);
end;
$$;
revoke all on function public.wallet_online_check_request(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.wallet_online_check_request(uuid, uuid) to service_role;

-- The Worker says it asked the provider about this top-up and got an answer (a failed call does not count: only a real answer lets an old top-up be closed).
create or replace function public.wallet_online_mark_checked(p_topup uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.wallet_online_attempts set checked_at = now(), updated_at = now() where topup_id = p_topup;
$$;
revoke all on function public.wallet_online_mark_checked(uuid) from public, anon, authenticated, service_role;
grant execute on function public.wallet_online_mark_checked(uuid) to service_role;

-- The top-ups the 5-minute job should ask the provider about: a payment exists, nothing arrived, older than the check-after setting, not asked in the last 10 minutes.
create or replace function public.wallet_online_due_checks(p_limit integer default 20)
returns table (topup_id uuid, reference text, provider text, provider_payment_id text, amount_rand integer, created_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select tp.id, tp.reference, ap.provider, ap.provider_payment_id, tp.amount_rand, tp.created_at, ap.expires_at
  from public.wallet_topups tp join public.wallet_online_attempts ap on ap.topup_id = tp.id
  where tp.method = 'online' and tp.status = 'awaiting_payment' and ap.provider_payment_id is not null
    and tp.created_at < now() - make_interval(mins => least(greatest(public.wallet_int_setting('wallet_online_check_after_minutes', 10), 1), 1440))
    and (ap.checked_at is null or ap.checked_at < now() - interval '10 minutes')
  order by coalesce(ap.checked_at, tp.created_at)
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;
revoke all on function public.wallet_online_due_checks(integer) from public, anon, authenticated, service_role;
grant execute on function public.wallet_online_due_checks(integer) to service_role;

-- 7. the backstop and the daily check (cron runs these as postgres; nobody else can) ---------------------------------------------------------
-- Closes what can safely be closed. A top-up WITH a payment is closed only after a clean provider check made at least 15 minutes after its link expired
-- (so a payment cannot be in flight); otherwise it stays open and the daily job complains.
create or replace function public.wallet_online_close_expired()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
  v_minutes integer := least(greatest(public.wallet_int_setting('wallet_online_expire_minutes', 60), 10), 1440);
begin
  -- (a) claimed, but no payment id was ever saved: nobody has a link
  for r in select tp.id, tp.profile_id, tp.reference, tp.amount_rand, ap.provider
           from public.wallet_topups tp join public.wallet_online_attempts ap on ap.topup_id = tp.id
           where tp.method = 'online' and tp.status = 'awaiting_payment' and ap.provider_payment_id is null and ap.claimed_at < now() - interval '2 minutes'
           for update of tp skip locked
  loop
    update public.wallet_topups set status = 'unsuccessful', decided_at = now(), decision_comment = 'We could not start the online payment', updated_at = now() where id = r.id;
    perform public.wallet_online_log(r.provider, 'system', null, r.id, r.reference, null, null, null, null, 'attempt_failed', 'The payment was claimed but never got a payment id', false);
    perform public.wallet_notify(r.profile_id, 'wallet_topup_cancelled', 'Online payment could not start',
      format('Your online payment of R%s (reference %s) could not be started, so nothing was taken. You can try again, or pay by bank transfer instead.', r.amount_rand, r.reference));
    n := n + 1;
  end loop;
  -- (b) created but never started
  for r in select tp.id, tp.profile_id, tp.reference, tp.amount_rand
           from public.wallet_topups tp
           where tp.method = 'online' and tp.status = 'awaiting_payment' and not exists (select 1 from public.wallet_online_attempts ap where ap.topup_id = tp.id)
             and tp.created_at < now() - make_interval(mins => v_minutes + 15)
           for update of tp skip locked
  loop
    update public.wallet_topups set status = 'cancelled', decision_comment = 'The online payment was never started', updated_at = now() where id = r.id;
    perform public.wallet_online_log('unknown', 'system', null, r.id, r.reference, null, null, null, null, 'ignored', 'Cancelled: the payment was never started', false);
    perform public.wallet_notify(r.profile_id, 'wallet_topup_cancelled', 'Online payment cancelled',
      format('Your online payment of R%s (reference %s) was never started, so it was cancelled. Nothing was taken.', r.amount_rand, r.reference));
    n := n + 1;
  end loop;
  -- (c) a payment exists, its link expired at least 15 minutes before a clean check, and no successful transaction came
  for r in select tp.id, tp.profile_id, tp.reference, tp.amount_rand, ap.provider
           from public.wallet_topups tp join public.wallet_online_attempts ap on ap.topup_id = tp.id
           where tp.method = 'online' and tp.status = 'awaiting_payment' and ap.provider_payment_id is not null
             and ap.checked_at is not null and ap.checked_at >= ap.expires_at + interval '15 minutes'
           for update of tp skip locked
  loop
    update public.wallet_topups set status = 'cancelled', decision_comment = 'The online payment window ended without a successful payment', updated_at = now() where id = r.id;
    perform public.wallet_online_log(r.provider, 'system', null, r.id, r.reference, null, null, null, null, 'ignored', 'Cancelled: the payment window ended without a successful payment', false);
    perform public.wallet_notify(r.profile_id, 'wallet_topup_cancelled', 'Online payment cancelled',
      format('Your online payment of R%s (reference %s) was not completed in time, so it was cancelled. If money left your account, contact support with this reference and we will sort it out.', r.amount_rand, r.reference));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.wallet_online_close_expired() from public, anon, authenticated, service_role;

-- Every 5 minutes: close what can be closed, and wake the Worker only when there is something to ask the provider about (so with the mode off and nothing waiting, nothing is called).
-- The Worker address is the one the account-closure job already uses; the secret is the Vault secret wallet_job_secret (the same value the Worker holds as WALLET_JOB_SECRET).
create or replace function public.wallet_online_backstop_job()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  perform public.wallet_online_close_expired();
  if not exists (select 1 from public.wallet_online_due_checks(1)) then
    return;
  end if;
  select s.setting_value #>> '{}' into v_url from public.system_settings s where s.setting_key = 'account_closure_worker_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'wallet_job_secret';
  if coalesce(v_url, '') = '' or v_secret is null then
    raise notice 'account_closure_worker_url or the wallet_job_secret vault secret is not set; the Worker is not woken';
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/internal/wallet/online-check',
    headers := jsonb_build_object('x-job-secret', v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;
revoke all on function public.wallet_online_backstop_job() from public, anon, authenticated, service_role;

-- Nightly 02:30: tell the finance admins about anything stuck, and (only when the retention switch is on) forget provider events older than the money-records period.
create or replace function public.wallet_online_daily_job()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old integer;
  v_review integer;
  v_noledger integer;
  v_purged integer := 0;
  v_years integer;
begin
  select count(*) into v_old from public.wallet_topups where method = 'online' and status = 'awaiting_payment' and created_at < now() - interval '1 day';
  select count(*) into v_review from public.wallet_provider_events where outcome = 'needs_review' and resolved_at is null;
  select count(*) into v_noledger from public.wallet_provider_events e join public.wallet_topups tp on tp.id = e.topup_id
   where e.outcome = 'credited' and not exists (select 1 from public.wallet_ledger l where l.idempotency_key = 'topup:' || tp.id::text);
  if v_old + v_review + v_noledger > 0 then
    perform public.wallet_notify_finance('wallet_online_daily', 'Online payments need a look',
      format('%s online payment(s) have been waiting more than a day, %s message(s) still need a person, and %s credited payment(s) have no ledger line. Look at Payments, Wallets.', v_old, v_review, v_noledger));
  end if;
  if coalesce((select lower(s.setting_value #>> '{}') = 'true' from public.system_settings s where s.setting_key = 'retention_jobs_enabled'), false) then
    v_years := public.wallet_int_setting('retention_money_years', 7);
    delete from public.wallet_provider_events e
     where e.created_at < now() - make_interval(years => greatest(v_years, 7))
       and (e.outcome <> 'needs_review' or e.resolved_at is not null);
    get diagnostics v_purged = row_count;
  end if;
  return jsonb_build_object('waiting_over_a_day', v_old, 'needs_a_person', v_review, 'credited_without_ledger', v_noledger, 'purged', v_purged);
end;
$$;
revoke all on function public.wallet_online_daily_job() from public, anon, authenticated, service_role;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('wallet-online-backstop') where exists (select 1 from cron.job where jobname = 'wallet-online-backstop');
    perform cron.schedule('wallet-online-backstop', '*/5 * * * *', 'select public.wallet_online_backstop_job();');
    perform cron.unschedule('wallet-online-daily') where exists (select 1 from cron.job where jobname = 'wallet-online-daily');
    perform cron.schedule('wallet-online-daily', '30 2 * * *', 'select public.wallet_online_daily_job();');
  end if;
end $cron$;

-- 8. the one in-place patch: wallet_credit_topup accepts an online top-up that is awaiting payment --------------------------------------------------------
-- Applied to the CURRENT stored text (read with pg_get_functiondef), so nothing changed since the migration was written is undone. Exactly once or not at all.
do $patch$
declare
  v_def text;
  v_old constant text := 'if t.status not in (''awaiting_proof'', ''proof_sent'') then';
  v_new constant text := 'if t.status not in (''awaiting_proof'', ''proof_sent'') and not (t.status = ''awaiting_payment'' and t.method = ''online'') then  -- ONLINE TOP-UP (Ozow phase 1, 9 Nov 2026)';
begin
  v_def := pg_get_functiondef('public.wallet_credit_topup(uuid, integer, uuid, text)'::regprocedure);
  if position('ONLINE TOP-UP (Ozow phase 1' in v_def) > 0 then
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'wallet_credit_topup: the line to change was not found exactly once; nothing was changed';
  end if;
  execute replace(v_def, v_old, v_new);
end $patch$;
