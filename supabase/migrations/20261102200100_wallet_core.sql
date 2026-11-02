-- WALLET CORE, phase 1 of the wallet + manual bank transfer system (CEO's design, 2 Nov 2026; plan in Drake/programmer/wallet-manual-eft-plan-2026-11-02.md).
-- Apply AFTER 20261102200000_wallet_audit_actions.sql has been committed on its own (its enum values are used by the admin functions below).
-- Database only: no screen, no booking change. Nothing here changes how a request, a session or a card payment works (that is phase 2).
--   * a wallet per adult (wallets), an append-only money ledger (wallet_ledger), top-up requests (wallet_topups), payout requests
--     (payout_requests) and the tutor's bank details (tutor_bank_details). Whole rands, integers only.
--   * wallet_post(): the one internal way a ledger line is written (idempotent by key). The ledger trigger is the only thing that moves a
--     balance, under a row lock, and refuses a balance below zero. A daily check proves stored balance = sum of lines = last line.
--   * wallet_credit_topup(): the ONE door that credits a top-up (the admin's "Successful transfer" calls it; a later card top-up calls it too).
--   * the private bucket payment-proofs, its rules, and log_document_access() taught about it (finance admins only, logged like any document).
--   * System Settings keys (switch, limits, Tutorlage's bank details) with a guard: only finance_manager and super_admin may change them.
--   * the functions the later screens call: create_wallet_topup, attach_topup_proof, cancel_my_topup, wallet_payment_details, save_my_bank_details,
--     request_my_payout, admin_mark_topup_successful / _unsuccessful, admin_mark_payout_paid / _cannot_pay, admin_open_bank_details,
--     admin_adjust_wallet, wallet_totals, admin_wallet_balance_check, wallet_open.
-- Payouts: the existing payouts / payout_sessions tables were NOT reused (read on dev, 2 Nov): a tutor can read every column of their own
-- payouts row and any admin can update or delete it directly, payouts.period_start/period_end are NOT NULL, and the Paystack server and the
-- tutor earnings panel read that table. A small payout_requests table keeps money state changeable only through the functions below.
-- Additive only: no existing table, policy or function is replaced except the in-place patch of log_document_access() and the bucket check
-- of document_access_log (both stop with an error, changing nothing, if their anchor is not found exactly once).

-- 1. settings -------------------------------------------------------------------------------------------------------------------------------
insert into public.system_settings (setting_key, setting_value, description) values
  ('wallet_payments_enabled', 'false'::jsonb, 'Master switch for wallets and bank-transfer top-ups. While free_sessions_enabled is on, free sessions win and the wallet stays closed.'),
  ('wallet_topup_min_rand', '50'::jsonb, 'Smallest bank transfer a learner or parent can add to a wallet, in whole rands.'),
  ('wallet_topup_max_rand', '5000'::jsonb, 'Largest single bank transfer, in whole rands.'),
  ('wallet_balance_cap_rand', '10000'::jsonb, 'A wallet (plus top-ups still waiting) never goes above this when a top-up is created, in whole rands. The finance admin can still credit above it by hand.'),
  ('wallet_topup_max_waiting', '3'::jsonb, 'Top-ups one person may have waiting for proof of payment at the same time.'),
  ('wallet_topup_max_per_day', '10'::jsonb, 'Top-ups one person may create in 24 hours.'),
  ('wallet_topup_stale_days', '7'::jsonb, 'A top-up still waiting for proof after this many days is cancelled by the daily job.'),
  ('wallet_proof_keep_days_successful', '90'::jsonb, 'Days a proof-of-payment file is kept after a successful transfer (the deleting job comes in a later phase).'),
  ('wallet_proof_keep_days_unsuccessful', '30'::jsonb, 'Days a proof-of-payment file is kept after an unsuccessful transfer.'),
  ('wallet_bank_name', '""'::jsonb, 'Tutorlage''s bank, shown to learners who add money by bank transfer. Entered by the finance admin.'),
  ('wallet_bank_account_holder', '""'::jsonb, 'Account holder name of Tutorlage''s bank account.'),
  ('wallet_bank_account_number', '""'::jsonb, 'Tutorlage''s bank account number.'),
  ('wallet_bank_branch_code', '""'::jsonb, 'Branch code of Tutorlage''s bank account.'),
  ('wallet_bank_account_type', '""'::jsonb, 'Account type of Tutorlage''s bank account (for example Cheque / Current). Optional.')
on conflict (setting_key) do nothing;

-- 2. small helpers --------------------------------------------------------------------------------------------------------------------------
-- Finance admins: the only admins who see or decide anything about wallets (CEO, 2 Nov: finance_manager and super_admin).
create or replace function public.wallet_is_finance_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_profiles a
                 where a.id = auth.uid() and a.is_active and a.admin_role in ('finance_manager', 'super_admin'));
$$;
revoke all on function public.wallet_is_finance_admin() from public, anon;
grant execute on function public.wallet_is_finance_admin() to authenticated;

create or replace function public.wallet_int_setting(p_key text, p_default integer)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v integer;
begin
  select nullif(s.setting_value #>> '{}', '')::integer into v from public.system_settings s where s.setting_key = p_key;
  return coalesce(v, p_default);
exception when others then
  return p_default;
end;
$$;
revoke all on function public.wallet_int_setting(text, integer) from public, anon, authenticated, service_role;

-- Open = the switch is on AND free sessions are off (free wins while it is on).
create or replace function public.wallet_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
           (select lower(coalesce(s.setting_value #>> '{}', '')) = 'true' from public.system_settings s where s.setting_key = 'wallet_payments_enabled'),
           false)
         and not public.free_sessions_open();
$$;
revoke all on function public.wallet_open() from public;
grant execute on function public.wallet_open() to anon, authenticated;

create or replace function public.wallet_notify(p_profile uuid, p_type text, p_title text, p_body text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (profile_id, type, title, body) values (p_profile, p_type, p_title, p_body);
$$;
revoke all on function public.wallet_notify(uuid, text, text, text) from public, anon, authenticated, service_role;

create or replace function public.wallet_notify_finance(p_type text, p_title text, p_body text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (profile_id, type, title, body)
  select a.id, p_type, p_title, p_body from public.admin_profiles a where a.is_active and a.admin_role in ('finance_manager', 'super_admin');
$$;
revoke all on function public.wallet_notify_finance(text, text, text) from public, anon, authenticated, service_role;

-- 3. the settings guard ---------------------------------------------------------------------------------------------------------------------
-- A wallet setting can be changed from the API only by a finance admin, and only to a sensible value (a typo must not make the limits
-- nonsense). Not a security-definer function on purpose: current_user is then the caller ('authenticated' for the admin app).
create or replace function public.wallet_settings_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v text;
  v_min integer;
  v_max integer;
  v_cap integer;
begin
  if tg_op = 'DELETE' then
    if left(old.setting_key, 7) = 'wallet_' and current_user in ('authenticated', 'anon') and not public.wallet_is_finance_admin() then
      raise exception 'Only a finance admin can change wallet settings' using errcode = '42501';
    end if;
    return old;
  end if;
  if left(new.setting_key, 7) <> 'wallet_' then
    return new;
  end if;
  if current_user in ('authenticated', 'anon') and not public.wallet_is_finance_admin() then
    raise exception 'Only a finance admin can change wallet settings' using errcode = '42501';
  end if;
  v := new.setting_value #>> '{}';
  if new.setting_key = 'wallet_payments_enabled' then
    if jsonb_typeof(new.setting_value) <> 'boolean' then
      raise exception 'The wallet switch must be true or false' using errcode = '22023';
    end if;
  elsif new.setting_key like 'wallet\_bank\_%' then
    if jsonb_typeof(new.setting_value) <> 'string' or length(v) > 120 then
      raise exception 'A bank detail must be text of at most 120 characters' using errcode = '22023';
    end if;
  elsif new.setting_key in ('wallet_topup_min_rand', 'wallet_topup_max_rand', 'wallet_balance_cap_rand', 'wallet_topup_max_waiting',
                            'wallet_topup_max_per_day', 'wallet_topup_stale_days', 'wallet_proof_keep_days_successful', 'wallet_proof_keep_days_unsuccessful') then
    if jsonb_typeof(new.setting_value) <> 'number' or v !~ '^[0-9]{1,7}$' or v::integer < 1 then
      raise exception '% must be a whole number of at least 1', new.setting_key using errcode = '22023';
    end if;
    -- read the other limits directly (this function runs as the caller, who cannot run the internal settings helper)
    v_min := case when new.setting_key = 'wallet_topup_min_rand' then v::integer
                  else coalesce((select (s.setting_value #>> '{}')::integer from public.system_settings s where s.setting_key = 'wallet_topup_min_rand'), 50) end;
    v_max := case when new.setting_key = 'wallet_topup_max_rand' then v::integer
                  else coalesce((select (s.setting_value #>> '{}')::integer from public.system_settings s where s.setting_key = 'wallet_topup_max_rand'), 5000) end;
    v_cap := case when new.setting_key = 'wallet_balance_cap_rand' then v::integer
                  else coalesce((select (s.setting_value #>> '{}')::integer from public.system_settings s where s.setting_key = 'wallet_balance_cap_rand'), 10000) end;
    if new.setting_key in ('wallet_topup_min_rand', 'wallet_topup_max_rand', 'wallet_balance_cap_rand') and (v_min > v_max or v_max > v_cap) then
      raise exception 'The limits must satisfy: smallest transfer <= largest transfer <= wallet cap' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.wallet_settings_guard() from public, anon, authenticated, service_role;
drop trigger if exists wallet_settings_guard on public.system_settings;
create trigger wallet_settings_guard before insert or update of setting_value or delete on public.system_settings
  for each row execute function public.wallet_settings_guard();

-- Changing Tutorlage's bank details tells every active admin (a cheap guard against someone quietly redirecting learners' transfers).
create or replace function public.wallet_bank_setting_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_who text;
begin
  select format('%s %s', a.first_name, a.surname) into v_who from public.admin_profiles a where a.id = auth.uid();
  perform public.notify_active_admins('wallet_bank_changed', 'Tutorlage''s bank details were changed',
    'The bank details learners pay into were changed by ' || coalesce(v_who, 'someone with database access') || '. If this was not expected, check them now in System Settings.');
  perform public.log_admin_event('system_setting_updated', 'system_settings', '00000000-0000-0000-0000-000000000000'::uuid,
    jsonb_build_object('setting_key', new.setting_key));
  return new;
end;
$$;
revoke all on function public.wallet_bank_setting_changed() from public, anon, authenticated, service_role;
drop trigger if exists wallet_bank_setting_changed on public.system_settings;
create trigger wallet_bank_setting_changed after update of setting_value on public.system_settings
  for each row when (new.setting_key like 'wallet\_bank\_%' and old.setting_value is distinct from new.setting_value)
  execute function public.wallet_bank_setting_changed();

-- 4. wallets --------------------------------------------------------------------------------------------------------------------------------
-- One row per adult profile, created on first use. No foreign key on purpose: a closed account must not cascade into money records
-- (the account closure returns the balance by hand first). A browser role cannot write it: balances move only inside the ledger trigger.
create table if not exists public.wallets (
  profile_id uuid primary key,
  currency_code text not null default 'ZAR' check (currency_code = 'ZAR'),
  available_rand integer not null default 0 check (available_rand >= 0),
  held_rand integer not null default 0 check (held_rand >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.wallets enable row level security;
drop policy if exists "Owner or finance admin reads wallet" on public.wallets;
create policy "Owner or finance admin reads wallet" on public.wallets for select to authenticated
  using (profile_id = auth.uid() or public.wallet_is_finance_admin());
revoke all on public.wallets from public, anon, authenticated, service_role;
grant select on public.wallets to authenticated;

create or replace function public.wallets_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'Wallets cannot be truncated' using errcode = '42501';
  elsif tg_op = 'INSERT' then
    if new.available_rand <> 0 or new.held_rand <> 0 then
      raise exception 'A wallet starts empty' using errcode = '42501';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if coalesce(current_setting('tutorlage.wallet_writing', true), '') <> 'on' or new.profile_id <> old.profile_id then
      raise exception 'A wallet balance changes only through the ledger' using errcode = '42501';
    end if;
    return new;
  end if;
  if coalesce(current_setting('tutorlage.purging_wallet_ledger', true), '') = 'on' then
    return old;
  end if;
  raise exception 'A wallet cannot be deleted' using errcode = '42501';
end;
$$;
revoke all on function public.wallets_guard() from public, anon, authenticated, service_role;
drop trigger if exists wallets_guard_row on public.wallets;
create trigger wallets_guard_row before insert or update or delete on public.wallets
  for each row execute function public.wallets_guard();
drop trigger if exists wallets_guard_truncate on public.wallets;
create trigger wallets_guard_truncate before truncate on public.wallets
  for each statement execute function public.wallets_guard();

-- A wallet exists only for a real adult-or-unknown-age person; a learner under 18 has none (the parent's wallet pays for their children).
create or replace function public.wallet_ensure(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_profile is null or not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'No such person' using errcode = 'P0002';
  end if;
  if public.is_minor(p_profile) then
    raise exception 'A learner under 18 has no wallet; the parent''s wallet is used' using errcode = '22023';
  end if;
  insert into public.wallets (profile_id) values (p_profile) on conflict (profile_id) do nothing;
end;
$$;
revoke all on function public.wallet_ensure(uuid) from public, anon, authenticated, service_role;

-- 5. the ledger -----------------------------------------------------------------------------------------------------------------------------
-- Append-only: one line per movement, never edited. A mistake is corrected by a NEW line. available_after / held_after are written by the
-- trigger (a snapshot of the balance after the line, so the chain can be checked). idempotency_key is unique: every posting is safe to repeat.
create table if not exists public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  profile_id uuid not null,
  kind text not null check (kind in ('topup', 'hold', 'release', 'charge', 'refund', 'session_credit', 'payout_hold', 'payout_paid', 'payout_release', 'adjustment')),
  available_delta integer not null,
  held_delta integer not null,
  available_after integer not null default 0,
  held_after integer not null default 0,
  request_id uuid,
  session_id uuid,
  topup_id uuid,
  payout_id uuid,
  actor_id uuid,
  note text check (length(note) <= 500),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  created_at timestamptz not null default now(),
  constraint wallet_ledger_key unique (idempotency_key),
  constraint wallet_ledger_seq unique (seq),
  constraint wallet_ledger_shape check (
    case kind
      when 'topup' then available_delta > 0 and held_delta = 0
      when 'hold' then available_delta < 0 and held_delta = -available_delta
      when 'release' then available_delta > 0 and held_delta = -available_delta
      when 'charge' then available_delta = 0 and held_delta < 0
      when 'refund' then available_delta > 0 and held_delta = 0
      when 'session_credit' then available_delta > 0 and held_delta = 0
      when 'payout_hold' then available_delta < 0 and held_delta = -available_delta
      when 'payout_paid' then available_delta = 0 and held_delta < 0
      when 'payout_release' then available_delta > 0 and held_delta = -available_delta
      when 'adjustment' then available_delta <> 0 and held_delta = 0
      else false end)
);
create index if not exists wallet_ledger_profile_idx on public.wallet_ledger (profile_id, seq desc);
create index if not exists wallet_ledger_topup_idx on public.wallet_ledger (topup_id) where topup_id is not null;
create index if not exists wallet_ledger_payout_idx on public.wallet_ledger (payout_id) where payout_id is not null;

alter table public.wallet_ledger enable row level security;
drop policy if exists "Owner or finance admin reads ledger" on public.wallet_ledger;
create policy "Owner or finance admin reads ledger" on public.wallet_ledger for select to authenticated
  using (profile_id = auth.uid() or public.wallet_is_finance_admin());
revoke all on public.wallet_ledger from public, anon, authenticated, service_role;
grant select on public.wallet_ledger to authenticated;

-- The only thing that moves a balance: lock the wallet row, apply the deltas, refuse a negative bucket, write the snapshot.
create or replace function public.wallet_ledger_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.wallets;
  a integer;
  h integer;
begin
  perform public.wallet_ensure(new.profile_id);
  select * into w from public.wallets where profile_id = new.profile_id for update;
  a := w.available_rand + new.available_delta;
  h := w.held_rand + new.held_delta;
  if a < 0 or h < 0 then
    raise exception 'wallet_too_low' using detail = format('available %s, on hold %s, change %s / %s', w.available_rand, w.held_rand, new.available_delta, new.held_delta);
  end if;
  perform set_config('tutorlage.wallet_writing', 'on', true);
  update public.wallets set available_rand = a, held_rand = h, updated_at = now() where profile_id = new.profile_id;
  perform set_config('tutorlage.wallet_writing', 'off', true);
  new.available_after := a;
  new.held_after := h;
  return new;
end;
$$;
revoke all on function public.wallet_ledger_apply() from public, anon, authenticated, service_role;
drop trigger if exists wallet_ledger_apply on public.wallet_ledger;
create trigger wallet_ledger_apply before insert on public.wallet_ledger
  for each row execute function public.wallet_ledger_apply();

-- Same pattern as the document access log: update and truncate are always refused; delete only inside the (later) retention job.
create or replace function public.wallet_ledger_is_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('tutorlage.purging_wallet_ledger', true), '') = 'on' then
    return old;
  end if;
  raise exception 'The wallet ledger can only be added to' using errcode = '42501';
end;
$$;
revoke all on function public.wallet_ledger_is_append_only() from public, anon, authenticated, service_role;
drop trigger if exists wallet_ledger_no_change on public.wallet_ledger;
create trigger wallet_ledger_no_change before update or delete on public.wallet_ledger
  for each row execute function public.wallet_ledger_is_append_only();
drop trigger if exists wallet_ledger_no_truncate on public.wallet_ledger;
create trigger wallet_ledger_no_truncate before truncate on public.wallet_ledger
  for each statement execute function public.wallet_ledger_is_append_only();

-- The one internal way to write a line. Repeating a key returns the first line (a different posting under the same key is an error).
-- (ON CONFLICT DO NOTHING is not used: the BEFORE INSERT trigger would already have moved the balance.)
create or replace function public.wallet_post(
  p_profile uuid, p_kind text, p_available integer, p_held integer, p_key text,
  p_actor uuid default null, p_note text default null,
  p_request uuid default null, p_session uuid default null, p_topup uuid default null, p_payout uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.wallet_ledger;
  v_id uuid;
begin
  if p_key is null or length(btrim(p_key)) = 0 then
    raise exception 'A wallet posting needs an idempotency key' using errcode = '22023';
  end if;
  perform public.wallet_ensure(p_profile);
  perform 1 from public.wallets where profile_id = p_profile for update;
  select * into v_old from public.wallet_ledger where idempotency_key = p_key;
  if found then
    if v_old.profile_id <> p_profile or v_old.kind <> p_kind or v_old.available_delta <> p_available or v_old.held_delta <> p_held then
      raise exception 'That posting key was already used for a different posting' using errcode = '23505';
    end if;
    return v_old.id;
  end if;
  insert into public.wallet_ledger (profile_id, kind, available_delta, held_delta, idempotency_key, actor_id, note, request_id, session_id, topup_id, payout_id)
  values (p_profile, p_kind, p_available, p_held, p_key, p_actor, p_note, p_request, p_session, p_topup, p_payout)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.wallet_post(uuid, text, integer, integer, text, uuid, text, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- 6. top-ups --------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.wallet_topups (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  method text not null default 'eft' check (method in ('eft', 'card')),
  reference text not null check (reference ~ '^TL-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
  amount_rand integer not null check (amount_rand > 0),
  status text not null default 'awaiting_proof' check (status in ('awaiting_proof', 'proof_sent', 'successful', 'unsuccessful', 'cancelled')),
  proof_path text,
  proof_attached_at timestamptz,
  proof_deleted_at timestamptz,
  received_rand integer,
  decided_by uuid,
  decided_at timestamptz,
  decision_comment text check (length(decision_comment) <= 1000),
  ledger_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_topups_reference_key unique (reference),
  constraint wallet_topups_state check (
    case status
      when 'awaiting_proof' then received_rand is null and ledger_id is null and decided_at is null
      when 'proof_sent' then coalesce(proof_path, '') <> '' and received_rand is null and ledger_id is null and decided_at is null
      when 'successful' then coalesce(received_rand, 0) > 0 and ledger_id is not null and decided_at is not null
                             and (received_rand = amount_rand or length(btrim(coalesce(decision_comment, ''))) >= 3)
      when 'unsuccessful' then received_rand is null and ledger_id is null and decided_at is not null and length(btrim(coalesce(decision_comment, ''))) >= 3
      when 'cancelled' then received_rand is null and ledger_id is null
      else false end)
);
create index if not exists wallet_topups_profile_idx on public.wallet_topups (profile_id, created_at desc);
create index if not exists wallet_topups_status_idx on public.wallet_topups (status, created_at);

alter table public.wallet_topups enable row level security;
drop policy if exists "Payer or finance admin reads top-ups" on public.wallet_topups;
create policy "Payer or finance admin reads top-ups" on public.wallet_topups for select to authenticated
  using (profile_id = auth.uid() or public.wallet_is_finance_admin());
revoke all on public.wallet_topups from public, anon, authenticated, service_role;
grant select on public.wallet_topups to authenticated;

-- 7. the tutor's bank details and payout requests --------------------------------------------------------------------------------------------
-- The full account number is never readable through the API (column rights): the tutor sees the last four digits, the admin opens the
-- full number only through admin_open_bank_details(), which writes an audit line each time.
create table if not exists public.tutor_bank_details (
  tutor_id uuid primary key references public.tutor_profiles(id) on delete cascade,
  bank_name text not null check (length(btrim(bank_name)) between 2 and 80),
  account_number text not null check (account_number ~ '^[0-9]{6,16}$'),
  branch_code text not null check (branch_code ~ '^[0-9]{6}$'),
  account_holder text not null check (length(btrim(account_holder)) between 2 and 120),
  account_last4 text generated always as (right(account_number, 4)) stored,
  updated_at timestamptz not null default now()
);
alter table public.tutor_bank_details enable row level security;
drop policy if exists "Tutor or finance admin reads bank details" on public.tutor_bank_details;
create policy "Tutor or finance admin reads bank details" on public.tutor_bank_details for select to authenticated
  using (tutor_id = auth.uid() or public.wallet_is_finance_admin());
revoke all on public.tutor_bank_details from public, anon, authenticated, service_role;
grant select (tutor_id, bank_name, branch_code, account_holder, account_last4, updated_at) on public.tutor_bank_details to authenticated;

-- One payout request = the tutor's whole available balance at that moment. The bank details are COPIED onto the request, so changing them
-- later cannot redirect an open request. No foreign key: a money record outlives the account.
create table if not exists public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null,
  amount_rand integer not null check (amount_rand > 0),
  status text not null default 'requested' check (status in ('requested', 'paid', 'could_not_pay')),
  bank_name text not null,
  account_holder text not null,
  branch_code text not null,
  account_number text not null,
  account_last4 text generated always as (right(account_number, 4)) stored,
  bank_details_changed_at timestamptz,
  session_ids uuid[] not null default '{}',
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  paid_on date,
  bank_reference text check (length(bank_reference) <= 100),
  decision_comment text check (length(decision_comment) <= 1000),
  constraint payout_requests_state check (
    case status
      when 'requested' then decided_at is null
      when 'paid' then decided_at is not null and decided_by is not null
      when 'could_not_pay' then decided_at is not null and length(btrim(coalesce(decision_comment, ''))) >= 3
      else false end)
);
create unique index if not exists payout_requests_one_open on public.payout_requests (tutor_id) where status = 'requested';
create index if not exists payout_requests_status_idx on public.payout_requests (status, requested_at);

alter table public.payout_requests enable row level security;
drop policy if exists "Tutor or finance admin reads payout requests" on public.payout_requests;
create policy "Tutor or finance admin reads payout requests" on public.payout_requests for select to authenticated
  using (tutor_id = auth.uid() or public.wallet_is_finance_admin());
revoke all on public.payout_requests from public, anon, authenticated, service_role;
grant select (id, tutor_id, amount_rand, status, bank_name, account_holder, branch_code, account_last4, bank_details_changed_at, session_ids,
              requested_at, decided_by, decided_at, paid_on, bank_reference, decision_comment) on public.payout_requests to authenticated;

-- 8. proof-of-payment files -----------------------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- A file may be put in (or taken out of) the payer's own folder only while it is for one of their own top-ups still waiting for proof:
-- <payer id>/<top-up id>.<pdf|jpg|jpeg|png>, and only one proof per top-up (once attached, the top-up is no longer awaiting_proof).
create or replace function public.wallet_may_upload_proof(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.wallet_topups t
    where t.profile_id = auth.uid() and t.status = 'awaiting_proof' and t.proof_path is null
      and p_name ~* ('^' || auth.uid()::text || '/' || t.id::text || '\.(pdf|jpe?g|png)$'));
$$;
revoke all on function public.wallet_may_upload_proof(text) from public, anon;
grant execute on function public.wallet_may_upload_proof(text) to authenticated;

drop policy if exists "Payment proofs: payer uploads for an awaiting top-up" on storage.objects;
create policy "Payment proofs: payer uploads for an awaiting top-up" on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and public.wallet_may_upload_proof(name));
drop policy if exists "Payment proofs: payer removes an unattached file" on storage.objects;
create policy "Payment proofs: payer removes an unattached file" on storage.objects for delete to authenticated
  using (bucket_id = 'payment-proofs' and public.wallet_may_upload_proof(name));
drop policy if exists "Payment proofs: payer reads own, finance admin reads logged" on storage.objects;
create policy "Payment proofs: payer reads own, finance admin reads logged" on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs'
         and ((storage.foldername(name))[1] = auth.uid()::text
              or (public.wallet_is_finance_admin() and public.admin_may_read_document(bucket_id, name))));

-- The access log learns the new bucket: the CHECK, then log_document_access() patched in place (anchors must occur exactly once).
alter table public.document_access_log drop constraint if exists document_access_log_bucket_check;
alter table public.document_access_log add constraint document_access_log_bucket_check
  check (bucket in ('tutor-documents', 'school-results', 'payment-proofs'));

create or replace function pg_temp.wallet_replace_once(p_text text, p_old text, p_new text)
returns text
language plpgsql
as $f$
declare
  n int := array_length(string_to_array(p_text, p_old), 1) - 1;
begin
  if n is distinct from 1 then
    raise exception 'wallet patch of log_document_access: the anchor "%" was found % time(s), expected exactly once', p_old, n;
  end if;
  return replace(p_text, p_old, p_new);
end;
$f$;

do $patch$
declare
  d text := replace(pg_get_functiondef('public.log_document_access(text, text, text, uuid)'::regprocedure), chr(13), '');
begin
  if strpos(d, 'WALLET PROOFS (CEO, 2 Nov 2026)') > 0 then
    return;
  end if;
  d := pg_temp.wallet_replace_once(d, $a$p_bucket not in ('tutor-documents', 'school-results')$a$,
                                      $a$p_bucket not in ('tutor-documents', 'school-results', 'payment-proofs')$a$);
  d := pg_temp.wallet_replace_once(d, $a$v_type := 'school_result';$a$,
                                      $a$v_type := case when p_bucket = 'payment-proofs' then 'payment_proof' else 'school_result' end;$a$);
  d := pg_temp.wallet_replace_once(d, $a$if p_action is null or p_action not in ('opened', 'downloaded') then$a$,
$a$-- WALLET PROOFS (CEO, 2 Nov 2026): a payment proof is opened by finance admins only, and the opening is logged like any other document.
  if p_bucket = 'payment-proofs' and not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('opened', 'downloaded') then$a$);
  execute d;
end
$patch$;

-- 9. the door: the ONE place a top-up becomes money -------------------------------------------------------------------------------------------
-- Manual transfer calls it from the admin's click; a later card top-up calls it from the Paystack webhook. Safe to repeat: a top-up that
-- is already successful returns its first result and posts nothing. Internal: service_role and the admin functions below only.
create or replace function public.wallet_credit_topup(p_topup uuid, p_received integer, p_actor uuid, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.wallet_topups;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_ledger uuid;
begin
  select * into t from public.wallet_topups where id = p_topup for update;
  if not found then
    raise exception 'No such top-up' using errcode = 'P0002';
  end if;
  if t.status = 'successful' then
    return jsonb_build_object('topup_id', t.id, 'status', t.status, 'received_rand', t.received_rand, 'ledger_id', t.ledger_id, 'already', true);
  end if;
  if t.status not in ('awaiting_proof', 'proof_sent') then
    raise exception 'This top-up was already decided (%).', t.status using errcode = '55000';
  end if;
  if p_received is null or p_received < 1 or p_received > 100000 then
    raise exception 'Say the amount received, in whole rands (R1 to R100 000)' using errcode = '22023';
  end if;
  if p_received <> t.amount_rand and (v_comment is null or length(v_comment) < 3) then
    raise exception 'A comment is needed when the amount received is not the amount claimed' using errcode = '22023';
  end if;
  v_ledger := public.wallet_post(t.profile_id, 'topup', p_received, 0, 'topup:' || t.id, p_actor, v_comment, null, null, t.id, null);
  update public.wallet_topups
  set status = 'successful', received_rand = p_received, decided_by = p_actor, decided_at = now(), decision_comment = v_comment,
      ledger_id = v_ledger, updated_at = now()
  where id = t.id;
  perform public.wallet_notify(t.profile_id, 'wallet_topup_added', 'Money added to your wallet',
    format('R%s was added to your wallet (reference %s).', p_received, t.reference)
    || case when p_received <> t.amount_rand then format(' You said R%s; we received R%s.', t.amount_rand, p_received) || coalesce(' ' || v_comment, '') else '' end);
  return jsonb_build_object('topup_id', t.id, 'status', 'successful', 'received_rand', p_received, 'ledger_id', v_ledger, 'already', false);
end;
$$;
revoke all on function public.wallet_credit_topup(uuid, integer, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.wallet_credit_topup(uuid, integer, uuid, text) to service_role;

-- 10. learner / parent functions ------------------------------------------------------------------------------------------------------------
-- What the "Add money" page shows: Tutorlage's bank details and the limits. Only while the wallet is open.
create or replace function public.wallet_payment_details()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if auth.uid() is null or not public.wallet_open() then
    return jsonb_build_object('open', false);
  end if;
  select jsonb_build_object('open', true,
           'bank_name', max(s.setting_value #>> '{}') filter (where s.setting_key = 'wallet_bank_name'),
           'account_holder', max(s.setting_value #>> '{}') filter (where s.setting_key = 'wallet_bank_account_holder'),
           'account_number', max(s.setting_value #>> '{}') filter (where s.setting_key = 'wallet_bank_account_number'),
           'branch_code', max(s.setting_value #>> '{}') filter (where s.setting_key = 'wallet_bank_branch_code'),
           'account_type', max(s.setting_value #>> '{}') filter (where s.setting_key = 'wallet_bank_account_type'),
           'min_rand', public.wallet_int_setting('wallet_topup_min_rand', 50),
           'max_rand', public.wallet_int_setting('wallet_topup_max_rand', 5000),
           'cap_rand', public.wallet_int_setting('wallet_balance_cap_rand', 10000))
    into v
  from public.system_settings s where s.setting_key like 'wallet\_bank\_%';
  return v;
end;
$$;
revoke all on function public.wallet_payment_details() from public, anon;
grant execute on function public.wallet_payment_details() to authenticated;

create or replace function public.create_wallet_topup(p_amount integer)
returns jsonb
language plpgsql
volatile
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
  select count(*) into v_n from public.system_settings s
  where s.setting_key in ('wallet_bank_name', 'wallet_bank_account_holder', 'wallet_bank_account_number', 'wallet_bank_branch_code')
    and length(btrim(coalesce(s.setting_value #>> '{}', ''))) > 0;
  if v_n < 4 then
    raise exception 'Our bank details are not set up yet. Please try again later.' using errcode = '55000';
  end if;
  if p_amount is null or p_amount < v_min or p_amount > v_max then
    raise exception 'Add between R% and R% at a time, in whole rands.', v_min, v_max using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wallet_topup:' || uid::text, 0));
  select count(*) into v_n from public.wallet_topups where profile_id = uid and status = 'awaiting_proof';
  if v_n >= public.wallet_int_setting('wallet_topup_max_waiting', 3) then
    raise exception 'You already have % top-ups waiting for proof of payment. Send the proof for one of them, or cancel one, first.', v_n using errcode = '55000';
  end if;
  select count(*) into v_n from public.wallet_topups where profile_id = uid and created_at > now() - interval '24 hours';
  if v_n >= public.wallet_int_setting('wallet_topup_max_per_day', 10) then
    raise exception 'You have made many top-up requests today. Please try again tomorrow.' using errcode = '55000';
  end if;
  select coalesce(available_rand + held_rand, 0) into v_balance from public.wallets where profile_id = uid;
  select coalesce(sum(amount_rand), 0) into v_pending from public.wallet_topups where profile_id = uid and status in ('awaiting_proof', 'proof_sent');
  if coalesce(v_balance, 0) + v_pending + p_amount > v_cap then
    raise exception 'That would take your wallet above R%. You can add up to R% now.', v_cap, greatest(v_cap - coalesce(v_balance, 0) - v_pending, 0) using errcode = '22023';
  end if;
  for i in 1..10 loop
    v_bytes := decode(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), 'hex');
    v_ref := 'TL-' || (select string_agg(substr(v_alpha, (get_byte(v_bytes, g) % 32) + 1, 1), '' order by g) from generate_series(0, 5) g);
    begin
      insert into public.wallet_topups (profile_id, reference, amount_rand) values (uid, v_ref, p_amount) returning id into v_id;
      exit;
    exception when unique_violation then
      v_id := null;
    end;
  end loop;
  if v_id is null then
    raise exception 'Could not create a reference. Please try again.' using errcode = '55000';
  end if;
  return jsonb_build_object('topup_id', v_id, 'reference', v_ref, 'amount_rand', p_amount, 'status', 'awaiting_proof');
end;
$$;
revoke all on function public.create_wallet_topup(integer) from public, anon;
grant execute on function public.create_wallet_topup(integer) to authenticated;

-- After uploading the file to payment-proofs/<own id>/<top-up id>.<ext>, the payer attaches it: the top-up moves to proof_sent and the
-- finance admins are told. The file must really exist in storage.
create or replace function public.attach_topup_proof(p_topup uuid, p_path text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  t public.wallet_topups;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into t from public.wallet_topups where id = p_topup and profile_id = uid for update;
  if not found then
    raise exception 'No such top-up' using errcode = 'P0002';
  end if;
  if t.status <> 'awaiting_proof' or t.proof_path is not null then
    raise exception 'This top-up already has its proof, or was decided.' using errcode = '55000';
  end if;
  if p_path is null or p_path !~* ('^' || uid::text || '/' || t.id::text || '\.(pdf|jpe?g|png)$') then
    raise exception 'The proof must be stored under your own folder and this top-up''s number.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'payment-proofs' and o.name = p_path) then
    raise exception 'The proof file was not found. Upload it again.' using errcode = 'P0002';
  end if;
  update public.wallet_topups set status = 'proof_sent', proof_path = p_path, proof_attached_at = now(), updated_at = now() where id = t.id;
  perform public.wallet_notify_finance('wallet_proof_waiting', 'A payment proof is waiting',
    format('Reference %s, R%s. Open Payments, Top-ups to check it.', t.reference, t.amount_rand));
end;
$$;
revoke all on function public.attach_topup_proof(uuid, text) from public, anon;
grant execute on function public.attach_topup_proof(uuid, text) to authenticated;

create or replace function public.cancel_my_topup(p_topup uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n integer;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  update public.wallet_topups set status = 'cancelled', updated_at = now() where id = p_topup and profile_id = uid and status = 'awaiting_proof';
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Only a top-up still waiting for proof can be cancelled.' using errcode = '55000';
  end if;
end;
$$;
revoke all on function public.cancel_my_topup(uuid) from public, anon;
grant execute on function public.cancel_my_topup(uuid) to authenticated;

-- 11. tutor functions -----------------------------------------------------------------------------------------------------------------------
create or replace function public.save_my_bank_details(p_bank_name text, p_account_number text, p_branch_code text, p_account_holder text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_number text := regexp_replace(coalesce(p_account_number, ''), '[\s-]', '', 'g');
  v_branch text := regexp_replace(coalesce(p_branch_code, ''), '[\s-]', '', 'g');
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tutor_profiles where id = uid) then
    raise exception 'Only a tutor can save bank details' using errcode = '42501';
  end if;
  if exists (select 1 from public.payout_requests where tutor_id = uid and status = 'requested') then
    raise exception 'You have a payout request waiting. You can change your bank details once it is paid.' using errcode = '55000';
  end if;
  if length(btrim(coalesce(p_bank_name, ''))) not between 2 and 80 then
    raise exception 'Choose your bank' using errcode = '22023';
  end if;
  if v_number !~ '^[0-9]{6,16}$' then
    raise exception 'The account number should be 6 to 16 digits, numbers only' using errcode = '22023';
  end if;
  if v_branch !~ '^[0-9]{6}$' then
    raise exception 'The branch code should be 6 digits' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_account_holder, ''))) not between 2 and 120 then
    raise exception 'Enter the account holder''s name' using errcode = '22023';
  end if;
  insert into public.tutor_bank_details (tutor_id, bank_name, account_number, branch_code, account_holder)
  values (uid, btrim(p_bank_name), v_number, v_branch, btrim(p_account_holder))
  on conflict (tutor_id) do update
    set bank_name = excluded.bank_name, account_number = excluded.account_number, branch_code = excluded.branch_code,
        account_holder = excluded.account_holder, updated_at = now();
end;
$$;
revoke all on function public.save_my_bank_details(text, text, text, text) from public, anon;
grant execute on function public.save_my_bank_details(text, text, text, text) to authenticated;

-- "Transact": the tutor asks for the whole available balance. The money moves to on-hold at once; the finance admin pays by hand.
create or replace function public.request_my_payout()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  w public.wallets;
  b public.tutor_bank_details;
  v_id uuid := gen_random_uuid();
  v_sessions uuid[];
  v_name text;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tutor_profiles where id = uid) then
    raise exception 'Only a tutor can ask for a payout' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wallet_payout:' || uid::text, 0));
  if exists (select 1 from public.payout_requests where tutor_id = uid and status = 'requested') then
    raise exception 'You already have a payout request waiting. It must be paid before you ask again.' using errcode = '55000';
  end if;
  select * into b from public.tutor_bank_details where tutor_id = uid;
  if not found then
    raise exception 'Add your bank details first' using errcode = '55000';
  end if;
  select * into w from public.wallets where profile_id = uid for update;
  if not found or w.available_rand <= 0 then
    raise exception 'There is nothing to pay out yet' using errcode = '55000';
  end if;
  select coalesce(array_agg(distinct l.session_id), '{}'::uuid[]) into v_sessions
  from public.wallet_ledger l
  where l.profile_id = uid and l.kind = 'session_credit' and l.session_id is not null
    and not exists (select 1 from public.payout_requests p where p.tutor_id = uid and p.status in ('requested', 'paid') and l.session_id = any (p.session_ids));
  insert into public.payout_requests (id, tutor_id, amount_rand, bank_name, account_holder, branch_code, account_number, bank_details_changed_at, session_ids)
  values (v_id, uid, w.available_rand, b.bank_name, b.account_holder, b.branch_code, b.account_number, b.updated_at, v_sessions);
  perform public.wallet_post(uid, 'payout_hold', -w.available_rand, w.available_rand, 'payhold:' || v_id, uid, null, null, null, null, v_id);
  select full_name into v_name from public.profiles where id = uid;
  perform public.wallet_notify_finance('wallet_payout_requested', 'A payout was requested',
    format('%s asked for R%s. Open Payments, Payout requests to pay it.', coalesce(v_name, 'A tutor'), w.available_rand));
  perform public.wallet_notify(uid, 'wallet_payout_requested', 'Payout requested',
    format('Your request for R%s was sent. You could receive it within the next 24 hours. If you do not, contact support with the Help button at the top of the page.', w.available_rand));
  return jsonb_build_object('payout_id', v_id, 'amount_rand', w.available_rand, 'status', 'requested');
end;
$$;
revoke all on function public.request_my_payout() from public, anon;
grant execute on function public.request_my_payout() to authenticated;

-- 12. finance admin functions ---------------------------------------------------------------------------------------------------------------
create or replace function public.admin_mark_topup_successful(p_topup uuid, p_received integer, p_comment text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_claimed integer;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  r := public.wallet_credit_topup(p_topup, p_received, auth.uid(), p_comment);
  if not coalesce((r ->> 'already')::boolean, false) then
    select amount_rand into v_claimed from public.wallet_topups where id = p_topup;
    perform public.log_admin_event('wallet_topup_successful', 'wallet_topup', p_topup,
      jsonb_build_object('received_rand', p_received, 'claimed_rand', v_claimed));
  end if;
  return r;
end;
$$;
revoke all on function public.admin_mark_topup_successful(uuid, integer, text) from public, anon;
grant execute on function public.admin_mark_topup_successful(uuid, integer, text) to authenticated;

create or replace function public.admin_mark_topup_unsuccessful(p_topup uuid, p_comment text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  t public.wallet_topups;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  select * into t from public.wallet_topups where id = p_topup for update;
  if not found then
    raise exception 'No such top-up' using errcode = 'P0002';
  end if;
  if t.status = 'unsuccessful' then
    return jsonb_build_object('topup_id', t.id, 'status', t.status, 'already', true);
  end if;
  if t.status not in ('awaiting_proof', 'proof_sent') then
    raise exception 'This top-up was already decided (%).', t.status using errcode = '55000';
  end if;
  if v_comment is null or length(v_comment) < 3 then
    raise exception 'Write a comment: the learner will read it' using errcode = '22023';
  end if;
  update public.wallet_topups set status = 'unsuccessful', decided_by = auth.uid(), decided_at = now(), decision_comment = v_comment, updated_at = now()
  where id = t.id;
  perform public.wallet_notify(t.profile_id, 'wallet_topup_not_received', 'Your transfer was not received',
    format('We could not confirm your transfer of R%s (reference %s). %s', t.amount_rand, t.reference, v_comment));
  perform public.log_admin_event('wallet_topup_unsuccessful', 'wallet_topup', t.id, jsonb_build_object('claimed_rand', t.amount_rand));
  return jsonb_build_object('topup_id', t.id, 'status', 'unsuccessful', 'already', false);
end;
$$;
revoke all on function public.admin_mark_topup_unsuccessful(uuid, text) from public, anon;
grant execute on function public.admin_mark_topup_unsuccessful(uuid, text) to authenticated;

create or replace function public.admin_mark_payout_paid(p_payout uuid, p_bank_reference text default null, p_paid_on date default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r public.payout_requests;
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  select * into r from public.payout_requests where id = p_payout for update;
  if not found then
    raise exception 'No such payout request' using errcode = 'P0002';
  end if;
  if r.status = 'paid' then
    return jsonb_build_object('payout_id', r.id, 'status', 'paid', 'already', true);
  end if;
  if r.status <> 'requested' then
    raise exception 'This payout was already returned to the tutor (could not pay).' using errcode = '55000';
  end if;
  if p_paid_on is not null and p_paid_on > v_today + 1 then
    raise exception 'The date paid cannot be in the future' using errcode = '22023';
  end if;
  perform public.wallet_post(r.tutor_id, 'payout_paid', 0, -r.amount_rand, 'paypaid:' || r.id, auth.uid(), null, null, null, null, r.id);
  update public.payout_requests
  set status = 'paid', decided_by = auth.uid(), decided_at = now(), paid_on = coalesce(p_paid_on, v_today), bank_reference = nullif(btrim(coalesce(p_bank_reference, '')), '')
  where id = r.id;
  perform public.wallet_notify(r.tutor_id, 'wallet_payout_paid', 'Your payout was paid', format('R%s was paid to your bank account.', r.amount_rand));
  perform public.log_admin_event('wallet_payout_paid', 'payout_request', r.id, jsonb_build_object('amount_rand', r.amount_rand));
  return jsonb_build_object('payout_id', r.id, 'status', 'paid', 'already', false);
end;
$$;
revoke all on function public.admin_mark_payout_paid(uuid, text, date) from public, anon;
grant execute on function public.admin_mark_payout_paid(uuid, text, date) to authenticated;

create or replace function public.admin_mark_payout_cannot_pay(p_payout uuid, p_comment text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r public.payout_requests;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  select * into r from public.payout_requests where id = p_payout for update;
  if not found then
    raise exception 'No such payout request' using errcode = 'P0002';
  end if;
  if r.status = 'could_not_pay' then
    return jsonb_build_object('payout_id', r.id, 'status', r.status, 'already', true);
  end if;
  if r.status <> 'requested' then
    raise exception 'This payout was already paid.' using errcode = '55000';
  end if;
  if v_comment is null or length(v_comment) < 3 then
    raise exception 'Write a comment: the tutor will read it' using errcode = '22023';
  end if;
  perform public.wallet_post(r.tutor_id, 'payout_release', r.amount_rand, -r.amount_rand, 'payrel:' || r.id, auth.uid(), v_comment, null, null, null, r.id);
  update public.payout_requests set status = 'could_not_pay', decided_by = auth.uid(), decided_at = now(), decision_comment = v_comment where id = r.id;
  perform public.wallet_notify(r.tutor_id, 'wallet_payout_failed', 'Your payout could not be paid',
    format('We could not pay your R%s request. The money is back in your wallet. %s', r.amount_rand, v_comment));
  perform public.log_admin_event('wallet_payout_cannot_pay', 'payout_request', r.id, jsonb_build_object('amount_rand', r.amount_rand));
  return jsonb_build_object('payout_id', r.id, 'status', 'could_not_pay', 'already', false);
end;
$$;
revoke all on function public.admin_mark_payout_cannot_pay(uuid, text) from public, anon;
grant execute on function public.admin_mark_payout_cannot_pay(uuid, text) to authenticated;

-- The full account number: the only way out of the database, one audit line each time it is opened.
create or replace function public.admin_open_bank_details(p_payout uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r public.payout_requests;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  select * into r from public.payout_requests where id = p_payout;
  if not found then
    raise exception 'No such payout request' using errcode = 'P0002';
  end if;
  perform public.log_admin_event('wallet_bank_details_opened', 'payout_request', r.id, jsonb_build_object('tutor_id', r.tutor_id));
  return jsonb_build_object('payout_id', r.id, 'bank_name', r.bank_name, 'account_holder', r.account_holder, 'branch_code', r.branch_code,
                            'account_number', r.account_number, 'amount_rand', r.amount_rand, 'status', r.status);
end;
$$;
revoke all on function public.admin_open_bank_details(uuid) from public, anon;
grant execute on function public.admin_open_bank_details(uuid) to authenticated;

-- A correction by hand (a refund the finance admin decides on, a mistaken credit): a NEW ledger line, super admin only, a reason is
-- required, never below zero. p_key is a token the screen makes once per click, so a double click or a retry posts once.
create or replace function public.admin_adjust_wallet(p_profile uuid, p_amount integer, p_reason text, p_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ledger uuid;
  v_available integer;
begin
  if auth.uid() is null or not exists (select 1 from public.admin_profiles a where a.id = auth.uid() and a.is_active and a.admin_role = 'super_admin') then
    raise exception 'Super admins only' using errcode = '42501';
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000 then
    raise exception 'Give the amount to add or remove, in whole rands (not 0)' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 5 or length(v_reason) > 500 then
    raise exception 'A written reason is needed (5 to 500 characters)' using errcode = '22023';
  end if;
  if p_key is null then
    raise exception 'The screen must send a one-time key' using errcode = '22023';
  end if;
  select id into v_ledger from public.wallet_ledger where idempotency_key = 'adjust:' || p_key;
  if found then
    return jsonb_build_object('ledger_id', v_ledger, 'already', true);
  end if;
  select available_rand into v_available from public.wallets where profile_id = p_profile;
  if p_amount < 0 and coalesce(v_available, 0) < -p_amount then
    raise exception 'The wallet holds R% available; an adjustment never takes it below zero.', coalesce(v_available, 0) using errcode = '22023';
  end if;
  v_ledger := public.wallet_post(p_profile, 'adjustment', p_amount, 0, 'adjust:' || p_key, auth.uid(), v_reason, null, null, null, null);
  perform public.wallet_notify(p_profile, 'wallet_adjusted', 'Your wallet was updated',
    format('Tutorlage %s R%s %s your wallet. Note: %s', case when p_amount > 0 then 'added' else 'removed' end, abs(p_amount),
           case when p_amount > 0 then 'to' else 'from' end, v_reason));
  perform public.log_admin_event('wallet_adjusted', 'wallet', p_profile, jsonb_build_object('amount_rand', p_amount, 'reason', v_reason));
  return jsonb_build_object('ledger_id', v_ledger, 'already', false);
end;
$$;
revoke all on function public.admin_adjust_wallet(uuid, integer, text, uuid) from public, anon;
grant execute on function public.admin_adjust_wallet(uuid, integer, text, uuid) to authenticated;

-- 13. totals and the balance check ----------------------------------------------------------------------------------------------------------
-- "Held for others" as far as the wallets alone know: everything sitting in wallets. Phase 2 adds the tutor share of booked, unfinished sessions.
create or replace function public.wallet_totals()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'wallets', count(*),
           'available_rand', coalesce(sum(w.available_rand), 0),
           'held_rand', coalesce(sum(w.held_rand), 0),
           'total_rand', coalesce(sum(w.available_rand + w.held_rand), 0),
           'tutor_wallets_rand', coalesce(sum(case when exists (select 1 from public.tutor_profiles t where t.id = w.profile_id) then w.available_rand + w.held_rand else 0 end), 0))
    into v from public.wallets w;
  return v || jsonb_build_object(
    'topups_waiting', (select count(*) from public.wallet_topups where status in ('awaiting_proof', 'proof_sent')),
    'topups_proof_sent', (select count(*) from public.wallet_topups where status = 'proof_sent'),
    'topups_waiting_rand', (select coalesce(sum(amount_rand), 0) from public.wallet_topups where status in ('awaiting_proof', 'proof_sent')),
    'payouts_requested', (select count(*) from public.payout_requests where status = 'requested'),
    'payouts_requested_rand', (select coalesce(sum(amount_rand), 0) from public.payout_requests where status = 'requested'),
    'oldest_proof_sent_at', (select min(proof_attached_at) from public.wallet_topups where status = 'proof_sent'),
    'oldest_payout_requested_at', (select min(requested_at) from public.payout_requests where status = 'requested'));
end;
$$;
revoke all on function public.wallet_totals() from public, anon;
grant execute on function public.wallet_totals() to authenticated;

-- For every wallet: stored balance = sum of its ledger lines = the last line's snapshot, and every line follows the one before it.
-- (A later retention job must delete a wallet's lines together with the wallet, at zero balance, never part of them.)
create or replace function public.wallet_check_balances()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with led as (
    select profile_id, available_delta, held_delta, available_after, held_after,
           lag(available_after) over (partition by profile_id order by seq) as prev_a,
           lag(held_after) over (partition by profile_id order by seq) as prev_h
    from public.wallet_ledger),
  chain as (
    select profile_id, sum(available_delta) as sum_a, sum(held_delta) as sum_h,
           count(*) filter (where available_after - available_delta is distinct from coalesce(prev_a, 0)
                              or held_after - held_delta is distinct from coalesce(prev_h, 0)) as broken
    from led group by profile_id),
  lastline as (
    select distinct on (profile_id) profile_id, available_after, held_after from public.wallet_ledger order by profile_id, seq desc),
  j as (
    select coalesce(w.profile_id, c.profile_id) as profile_id,
           coalesce(w.available_rand, -1) as w_a, coalesce(w.held_rand, -1) as w_h,
           coalesce(c.sum_a, 0) as sum_a, coalesce(c.sum_h, 0) as sum_h,
           coalesce(l.available_after, 0) as last_a, coalesce(l.held_after, 0) as last_h, coalesce(c.broken, 0) as broken
    from public.wallets w
    full join chain c on c.profile_id = w.profile_id
    left join lastline l on l.profile_id = coalesce(w.profile_id, c.profile_id)),
  bad as (
    select * from j where w_a <> sum_a or w_h <> sum_h or w_a <> last_a or w_h <> last_h or broken > 0)
  select jsonb_build_object(
    'checked', (select count(*) from j),
    'mismatch_count', (select count(*) from bad),
    'mismatches', coalesce((select jsonb_agg(jsonb_build_object('profile_id', profile_id, 'stored_available', w_a, 'ledger_available', sum_a,
                                                                  'stored_held', w_h, 'ledger_held', sum_h, 'broken_links', broken)) from bad), '[]'::jsonb),
    'checked_at', now());
$$;
revoke all on function public.wallet_check_balances() from public, anon, authenticated, service_role;

create or replace function public.admin_wallet_balance_check()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  return public.wallet_check_balances();
end;
$$;
revoke all on function public.admin_wallet_balance_check() from public, anon;
grant execute on function public.admin_wallet_balance_check() to authenticated;

-- The daily jobs ----------------------------------------------------------------------------------------------------------------------------
create or replace function public.wallet_balance_check_job()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r jsonb := public.wallet_check_balances();
begin
  if (r ->> 'mismatch_count')::integer > 0 then
    perform public.wallet_notify_finance('wallet_mismatch', 'A wallet does not add up',
      format('%s wallet(s) do not match their ledger. Open Payments, Wallets and run the check.', r ->> 'mismatch_count'));
  end if;
  return r;
end;
$$;
revoke all on function public.wallet_balance_check_job() from public, anon, authenticated, service_role;

-- A top-up still waiting for proof after the stale period is cancelled (and its owner told).
create or replace function public.wallet_cancel_stale_topups()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  n integer;
  v_days integer := public.wallet_int_setting('wallet_topup_stale_days', 7);
begin
  with c as (
    update public.wallet_topups set status = 'cancelled', updated_at = now()
    where status = 'awaiting_proof' and created_at < now() - make_interval(days => v_days)
    returning profile_id, reference, amount_rand)
  insert into public.notifications (profile_id, type, title, body)
  select profile_id, 'wallet_topup_cancelled', 'Top-up cancelled',
         format('Your top-up of R%s (reference %s) was cancelled because we did not receive proof of payment within %s days. If you did pay, contact support.', amount_rand, reference, v_days)
  from c;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.wallet_cancel_stale_topups() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('wallet-balance-check') where exists (select 1 from cron.job where jobname = 'wallet-balance-check');
    perform cron.schedule('wallet-balance-check', '20 2 * * *', 'select public.wallet_balance_check_job();');
    perform cron.unschedule('wallet-stale-topups') where exists (select 1 from cron.job where jobname = 'wallet-stale-topups');
    perform cron.schedule('wallet-stale-topups', '25 2 * * *', 'select public.wallet_cancel_stale_topups();');
  end if;
end $$;
