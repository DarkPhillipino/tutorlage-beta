-- 2026-09-30 (fourth session). Master backlog 7a: Paystack Transaction Splits, charged when a tutor
-- accepts (CEO decision 2026-09-30, re-confirmed: "just do the planned split as we always intended").
-- Findings behind every choice here: Drake/programmer/7a-paystack-splits-findings.md.
--
-- Before: the learner paid the full price up front, it settled into Tutorlage's own bank account, and
-- Tutorlage owed the tutor — the fund flow behind legal's Banks Act deposit-taking concern, and a
-- refund for every request nobody accepted.
--
-- Now:
--   1. Sending a request saves the payer's card with a R1 check (Paystack's recommended first charge;
--      refunded straight away by server/index.ts). payment_status 'initiated' -> 'card_verified'.
--      Tutors see card_verified requests exactly as they saw paid ones.
--   2. A tutor accepts through server/index.ts (POST /api/requests/:id/accept), never directly:
--      claim_session_request() re-checks everything accept_session_request() checked, reserves the
--      request for that tutor ('charging') and hands the server what to charge.
--   3. The server charges the saved card with /transaction/charge_authorization, passing the tutor's
--      Paystack subaccount, transaction_charge = Tutorlage's commission for the level paid, and
--      bearer = the paystack_fee_bearer setting — "account" (Tutorlage pays Paystack's fee), the CEO's
--      answer on 2026-09-30, fourth session: "Tutorlage pays (Recommended)". Paystack settles the
--      tutor's share straight to the tutor; Tutorlage never holds it.
--   4. finalize_session_charge() creates the session once Paystack reports success for exactly the
--      priced amount; release_session_charge() cancels the request if the charge fails (the learner is
--      told they weren't charged).
--   5. reconcile_stale_charges() (every 5 minutes) settles any acceptance left in 'charging' — e.g. the
--      server stopped mid-charge — by asking Paystack (GET /transaction/verify/:reference).
--   6. An unmatched request is never charged, so it just expires ("you weren't charged"); no refund.
--   7. Refunds of a charged session target the charge's reference (cancel_session), and the cancellation
--      window counts from the charge (the agreement is concluded when a tutor accepts and the learner
--      is charged).
-- Requests already paid under the old flow keep working: claim_session_request() turns them into a
-- session without charging again, and they refund against their original reference.
--
-- Tutor bank details: server/index.ts validates the account with Paystack (South Africa's
-- POST /bank/validate, which needs the tutor's ID number — passed to Paystack, never stored), creates
-- the subaccount, and records only the bank, the last 4 digits, the validation result and the
-- subaccount code (save_tutor_payout_account). Tutors can no longer write their own payout row: the old
-- "Tutors manage own payout account" policy let a tutor set is_verified on themselves.

-- Settings ----------------------------------------------------------------------------------------
insert into public.system_settings (setting_key, setting_value, description) values
  ('paystack_fee_bearer', '"account"'::jsonb,
   'Who pays Paystack''s fee on a split payment: "account" = Tutorlage, "subaccount" = the tutor. CEO 2026-09-30: Tutorlage pays.'),
  ('card_check_amount_cents', '100'::jsonb,
   'The card check that saves a payer''s card when they send a request, in cents (R1, refunded straight away).')
on conflict (setting_key) do nothing;

-- Saved cards -------------------------------------------------------------------------------------
create table if not exists public.payment_cards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  authorization_code text not null,
  paystack_email text not null,
  signature text,
  last4 varchar(4),
  card_type text,
  bank text,
  exp_month varchar(2),
  exp_year varchar(4),
  reusable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);
comment on table public.payment_cards is 'A payer''s card saved by Paystack (7a). authorization_code is what charges it later — never readable by browsers.';
create index if not exists payment_cards_profile_idx on public.payment_cards (profile_id);
alter table public.payment_cards enable row level security;
revoke all on public.payment_cards from anon, authenticated;
drop policy if exists "Payers view own cards" on public.payment_cards;
create policy "Payers view own cards" on public.payment_cards
  for select to authenticated using (profile_id = auth.uid());
drop policy if exists "Admins view cards" on public.payment_cards;
create policy "Admins view cards" on public.payment_cards
  for select to authenticated using (public.is_active_admin());
grant select (id, profile_id, last4, card_type, bank, exp_month, exp_year, reusable, created_at, revoked_at)
  on public.payment_cards to authenticated;
grant select on public.payment_cards to service_role;

-- Tutor payout accounts ---------------------------------------------------------------------------
alter table public.tutor_payout_accounts
  alter column account_number_hash drop not null,
  alter column branch_code drop not null,
  add column if not exists bank_code text,
  add column if not exists account_number_last4 varchar(4),
  add column if not exists paystack_subaccount_code text,
  add column if not exists validation_status text,
  add column if not exists validation_detail jsonb,
  add column if not exists validated_at timestamptz;
alter table public.tutor_payout_accounts drop constraint if exists tutor_payout_accounts_validation_status_check;
alter table public.tutor_payout_accounts add constraint tutor_payout_accounts_validation_status_check
  check (validation_status is null or validation_status in ('validated', 'refuted', 'bank_not_supported', 'recorded_test_mode'));
create unique index if not exists tutor_payout_accounts_subaccount_key
  on public.tutor_payout_accounts (paystack_subaccount_code) where paystack_subaccount_code is not null;
comment on column public.tutor_payout_accounts.validation_detail is 'Paystack''s account-validation flags (no ID number, no full account number).';

drop policy if exists "Tutors manage own payout account" on public.tutor_payout_accounts;
drop policy if exists "Tutors view own payout account" on public.tutor_payout_accounts;
create policy "Tutors view own payout account" on public.tutor_payout_accounts
  for select to authenticated using (tutor_id = auth.uid());
drop policy if exists "Admins view payout accounts" on public.tutor_payout_accounts;
create policy "Admins view payout accounts" on public.tutor_payout_accounts
  for select to authenticated using (public.is_active_admin());
revoke all on public.tutor_payout_accounts from anon, authenticated;
grant select (id, tutor_id, bank_name, bank_code, account_holder_name, account_number_last4, account_type,
              is_verified, validation_status, validated_at, paystack_subaccount_code, created_at, updated_at)
  on public.tutor_payout_accounts to authenticated;
grant select on public.tutor_payout_accounts to service_role;

-- Session requests --------------------------------------------------------------------------------
alter table public.session_requests
  add column if not exists payment_card_id uuid references public.payment_cards(id) on delete set null,
  add column if not exists charge_reference text,
  add column if not exists claimed_at timestamptz,
  add column if not exists charged_at timestamptz,
  add column if not exists commission_amount numeric(12, 2),
  add column if not exists fee_bearer text,
  add column if not exists paystack_fee numeric(12, 2),
  add column if not exists charge_failure_reason text,
  add column if not exists charge_check_request_id bigint,
  add column if not exists card_check_refund_status text;
create unique index if not exists session_requests_charge_reference_key
  on public.session_requests (charge_reference) where charge_reference is not null;
alter table public.session_requests drop constraint if exists session_requests_fee_bearer_check;
alter table public.session_requests add constraint session_requests_fee_bearer_check
  check (fee_bearer is null or fee_bearer in ('account', 'subaccount'));

drop policy "Tutors view unclaimed pending requests" on public.session_requests;
alter table public.session_requests drop constraint if exists session_requests_payment_status_check;
alter table public.session_requests add constraint session_requests_payment_status_check
  check (payment_status in ('unpaid', 'initiated', 'card_verified', 'charging', 'charge_failed', 'paid',
                            'refund_pending', 'refund_queued', 'refund_needs_attention', 'refunded',
                            'refund_failed', 'failed'));
create policy "Tutors view unclaimed pending requests" on public.session_requests
  for select to authenticated
  using (tutor_id is null and status = 'pending' and payment_status in ('paid', 'card_verified'));

-- The learner sees when they were charged and why a charge failed; the rest is the server's.
grant select (charged_at, charge_failure_reason) on public.session_requests to authenticated;

-- Tutors can no longer accept straight from the browser: the charge needs the server.
revoke execute on function public.accept_session_request(uuid) from authenticated;

-- Commission for a request: the level's rate (12b), else the tier's.
create or replace function public.request_commission_pct(p_request_id uuid, p_tutor_tier integer)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.commission_rate_pct from public.session_requests r
       join public.sub_tier_definitions s on s.id = r.min_sub_tier_id where r.id = p_request_id),
    (select t.commission_rate_pct from public.session_requests r
       join public.tier_definitions t on t.id = coalesce(r.tier_id, p_tutor_tier) where r.id = p_request_id)
  );
$$;
revoke all on function public.request_commission_pct(uuid, integer) from public, anon, authenticated;

-- 1. Card check recorded (server, after verifying the R1 transaction with Paystack).
create or replace function public.record_card_verification(
  p_reference text, p_amount_cents bigint, p_currency text, p_authorization jsonb, p_customer_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_expected bigint;
  v_card uuid;
  v_signature text := nullif(p_authorization->>'signature', '');
begin
  select * into v_req from public.session_requests where paystack_reference = p_reference for update;
  if not found then
    raise exception 'No request matches that reference';
  end if;
  if v_req.payment_status <> 'initiated' then
    return v_req.payment_status;  -- already recorded; repeat calls change nothing
  end if;

  select coalesce((select (setting_value #>> '{}')::bigint from public.system_settings where setting_key = 'card_check_amount_cents'), 100)
  into v_expected;
  if p_amount_cents is distinct from v_expected or trim(coalesce(p_currency, '')) <> trim(v_req.currency_code) then
    update public.session_requests
    set payment_status = 'failed', charge_failure_reason = 'The card check amount didn''t match'
    where id = v_req.id;
    perform public.notify_active_admins('card_check_mismatch', 'A card check amount didn''t match',
      'Paystack reported ' || coalesce(p_amount_cents::text, '?') || ' ' || coalesce(p_currency, '?')
      || ' for card check ' || p_reference || '. Refund it manually and look at how it happened.', null);
    return 'failed';
  end if;
  if not coalesce((p_authorization->>'reusable')::boolean, false)
     or coalesce(p_authorization->>'authorization_code', '') = ''
     or coalesce(p_customer_email, '') = '' then
    update public.session_requests
    set payment_status = 'failed',
        charge_failure_reason = 'This card can''t be saved for a later payment — please try a different card'
    where id = v_req.id;
    return 'failed';
  end if;

  select id into v_card from public.payment_cards
  where profile_id = v_req.requested_by_profile_id and signature = v_signature and revoked_at is null
  limit 1;
  if v_card is not null and v_signature is not null then
    update public.payment_cards
    set authorization_code = p_authorization->>'authorization_code', paystack_email = p_customer_email,
        exp_month = p_authorization->>'exp_month', exp_year = p_authorization->>'exp_year',
        reusable = true, updated_at = now()
    where id = v_card;
  else
    insert into public.payment_cards (profile_id, authorization_code, paystack_email, signature, last4, card_type,
                                      bank, exp_month, exp_year, reusable)
    values (v_req.requested_by_profile_id, p_authorization->>'authorization_code', p_customer_email, v_signature,
            p_authorization->>'last4', nullif(trim(p_authorization->>'card_type'), ''), p_authorization->>'bank',
            p_authorization->>'exp_month', p_authorization->>'exp_year', true)
    returning id into v_card;
  end if;

  update public.session_requests
  set payment_status = 'card_verified', payment_card_id = v_card
  where id = v_req.id;
  return 'card_verified';
end;
$$;
revoke all on function public.record_card_verification(text, bigint, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_card_verification(text, bigint, text, jsonb, text) to service_role;

-- Creates the session row for a request (shared by legacy accepts and finalized charges).
create or replace function public.create_session_from_request(p_request_id uuid, p_tutor_id uuid, p_commission numeric, p_tutor_payout numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_session_id uuid;
begin
  select * into v_req from public.session_requests where id = p_request_id;
  insert into public.sessions (
    student_id, tutor_id, duration_hours, hourly_rate_charged, platform_commission_pct,
    gross_amount, tutor_payout_amount, scheduled_start, enrollment_id, booked_by_profile_id,
    currency_code, status
  ) values (
    v_req.student_id, p_tutor_id, v_req.duration_hours, round(v_req.charged_amount / v_req.duration_hours, 2),
    p_commission, v_req.charged_amount, p_tutor_payout,
    v_req.requested_start, v_req.enrollment_id, v_req.requested_by_profile_id, v_req.currency_code,
    'scheduled'
  ) returning id into v_session_id;

  update public.session_requests
  set tutor_id = p_tutor_id, status = 'accepted', responded_at = now(), resulting_session_id = v_session_id
  where id = p_request_id;

  insert into public.notifications (profile_id, type, title, body, related_session_id)
  select distinct p, 'request_accepted', 'A tutor accepted your request',
         'Your session is booked. Open Sessions to see your tutor and, closer to the time, the meeting link.',
         v_session_id
  from unnest(array[v_req.student_id, v_req.requested_by_profile_id]) as p
  where p is not null;
  return v_session_id;
end;
$$;
revoke all on function public.create_session_from_request(uuid, uuid, numeric, numeric) from public, anon, authenticated;

-- 2. A tutor's acceptance (server, with the tutor id from their verified access token).
create or replace function public.claim_session_request(p_request_id uuid, p_tutor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tutor record;
  v_req record;
  v_subject text;
  v_level_rate numeric;
  v_commission numeric;
  v_commission_amount numeric;
  v_card record;
  v_subaccount text;
  v_bearer text;
  v_reference text;
  v_session uuid;
begin
  if p_tutor_id is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  select tp.id, tp.is_verified, tp.current_tier_id, tp.institution_id, st.max_allowed_rate as tutor_rate
  into v_tutor
  from public.tutor_profiles tp join public.sub_tier_definitions st on st.id = tp.current_sub_tier_id
  where tp.id = p_tutor_id;
  if not found then
    raise exception 'Only tutors can accept requests' using errcode = '42501';
  end if;
  if not coalesce(v_tutor.is_verified, false) then
    raise exception 'Tutorlage has to verify your tutor profile before you can accept requests' using errcode = '42501';
  end if;

  select * into v_req from public.session_requests where id = p_request_id for update;
  if not found or v_req.tutor_id is not null or v_req.status <> 'pending'
     or v_req.payment_status not in ('paid', 'card_verified') then
    raise exception 'Another tutor already accepted this request, or it is no longer available.';
  end if;

  if v_req.min_sub_tier_id is not null then
    select max_allowed_rate into v_level_rate from public.sub_tier_definitions where id = v_req.min_sub_tier_id;
    if v_tutor.tutor_rate < v_level_rate then
      raise exception 'This request is for a higher level than yours.';
    end if;
  elsif v_req.tier_id is not null and v_req.tier_id <> v_tutor.current_tier_id then
    raise exception 'This request is for a different pricing level.';
  end if;
  if v_req.institution_id is not null and v_tutor.institution_id is not null
     and v_req.institution_id <> v_tutor.institution_id then
    raise exception 'This request is for a different institution.';
  end if;
  if v_req.enrollment_id is not null then
    select subject_name into v_subject from public.student_subject_enrollments where id = v_req.enrollment_id;
    if v_subject is not null and not exists (
      select 1 from public.tutor_subject_competencies c
      where c.tutor_id = p_tutor_id and lower(c.subject_name) = lower(v_subject)
    ) then
      raise exception 'You don''t teach this subject yet.';
    end if;
  end if;

  v_commission := public.request_commission_pct(p_request_id, v_tutor.current_tier_id);
  if v_commission is null then
    raise exception 'No commission rate is set for this level — contact support';
  end if;
  v_commission_amount := round(v_req.charged_amount * v_commission / 100, 2);

  -- Paid up front under the old flow: book it without charging again.
  if v_req.payment_status = 'paid' then
    v_session := public.create_session_from_request(p_request_id, p_tutor_id, v_commission,
                                                    v_req.charged_amount - v_commission_amount);
    update public.session_requests set commission_amount = v_commission_amount where id = p_request_id;
    return jsonb_build_object('mode', 'already_paid', 'session_id', v_session);
  end if;

  select paystack_subaccount_code into v_subaccount
  from public.tutor_payout_accounts where tutor_id = p_tutor_id;
  if v_subaccount is null then
    raise exception 'Add your bank details in your tutor account before accepting paid requests — that''s where your share is paid.';
  end if;

  select * into v_card from public.payment_cards where id = v_req.payment_card_id;
  if v_card.id is null or v_card.revoked_at is not null or not v_card.reusable then
    raise exception 'This request''s card can''t be charged any more — it has been withdrawn.';
  end if;

  select setting_value #>> '{}' into v_bearer from public.system_settings where setting_key = 'paystack_fee_bearer';
  if v_bearer is null or v_bearer not in ('account', 'subaccount') then
    raise exception 'Payments aren''t configured yet (paystack_fee_bearer) — contact support';
  end if;

  v_reference := 'chg_' || replace(gen_random_uuid()::text, '-', '');
  update public.session_requests
  set tutor_id = p_tutor_id, payment_status = 'charging', claimed_at = now(), charge_reference = v_reference,
      commission_amount = v_commission_amount, fee_bearer = v_bearer, charge_failure_reason = null,
      charge_check_request_id = null
  where id = p_request_id;

  return jsonb_build_object(
    'mode', 'charge',
    'charge_reference', v_reference,
    'authorization_code', v_card.authorization_code,
    'email', v_card.paystack_email,
    'amount_cents', round(v_req.charged_amount * 100)::bigint,
    'commission_cents', round(v_commission_amount * 100)::bigint,
    'currency', trim(v_req.currency_code),
    'subaccount', v_subaccount,
    'bearer', v_bearer
  );
end;
$$;
revoke all on function public.claim_session_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_session_request(uuid, uuid) to service_role;

-- 3. The charge succeeded (server, the reconcile job, or the webhook). Idempotent.
create or replace function public.finalize_session_charge(
  p_request_id uuid, p_charge_reference text, p_amount_cents bigint, p_currency text, p_fee_cents bigint)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_fee numeric := round(coalesce(p_fee_cents, 0)::numeric / 100, 2);
  v_payout numeric;
  v_session uuid;
begin
  select * into v_req from public.session_requests where id = p_request_id for update;
  if not found or v_req.charge_reference is distinct from p_charge_reference then
    raise exception 'No acceptance matches that charge';
  end if;
  if v_req.payment_status = 'paid' and v_req.resulting_session_id is not null then
    return v_req.resulting_session_id;
  end if;
  if v_req.payment_status <> 'charging' then
    raise exception 'This acceptance is no longer waiting for a charge (%)', v_req.payment_status;
  end if;
  if p_amount_cents is distinct from round(v_req.charged_amount * 100)::bigint
     or trim(coalesce(p_currency, '')) <> trim(v_req.currency_code) then
    perform public.notify_active_admins('charge_mismatch', 'A session charge didn''t match its price',
      'Paystack charged ' || coalesce(p_amount_cents::text, '?') || ' ' || coalesce(p_currency, '?') || ' for '
      || p_charge_reference || ', but the request was priced at ' || v_req.charged_amount || ' '
      || v_req.currency_code || '. Refund it manually.', null);
    raise exception 'The charged amount doesn''t match the price for this request';
  end if;

  v_payout := v_req.charged_amount - v_req.commission_amount
              - case when v_req.fee_bearer = 'subaccount' then v_fee else 0 end;
  update public.session_requests
  set payment_status = 'paid', charged_at = now(), paystack_fee = v_fee
  where id = p_request_id;
  v_session := public.create_session_from_request(p_request_id, v_req.tutor_id,
                 public.request_commission_pct(p_request_id, null), v_payout);
  return v_session;
end;
$$;
revoke all on function public.finalize_session_charge(uuid, text, bigint, text, bigint) from public, anon, authenticated;
grant execute on function public.finalize_session_charge(uuid, text, bigint, text, bigint) to service_role;

-- 4. The charge failed (server or reconcile job). The request is cancelled; nobody was charged.
create or replace function public.release_session_charge(p_request_id uuid, p_charge_reference text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
begin
  select * into v_req from public.session_requests where id = p_request_id for update;
  if not found or v_req.charge_reference is distinct from p_charge_reference then
    raise exception 'No acceptance matches that charge';
  end if;
  if v_req.payment_status <> 'charging' then
    return;
  end if;
  update public.session_requests
  set payment_status = 'charge_failed', status = 'cancelled', tutor_id = null,
      charge_failure_reason = left(coalesce(nullif(trim(p_reason), ''), 'The card charge didn''t go through'), 300),
      responded_at = now()
  where id = p_request_id;

  insert into public.notifications (profile_id, type, title, body)
  select distinct p, 'charge_failed', 'Your card couldn''t be charged',
         'A tutor accepted your request, but the payment didn''t go through, so the request was cancelled and '
         || 'you have not been charged. Send a new request — you may need to use a different card.'
  from unnest(array[v_req.student_id, v_req.requested_by_profile_id]) as p
  where p is not null;
end;
$$;
revoke all on function public.release_session_charge(uuid, text, text) from public, anon, authenticated;
grant execute on function public.release_session_charge(uuid, text, text) to service_role;

-- Tutor bank details (server, after Paystack's validation and subaccount creation).
create or replace function public.save_tutor_payout_account(
  p_tutor_id uuid, p_bank_code text, p_bank_name text, p_account_holder text, p_last4 text,
  p_subaccount_code text, p_validation_status text, p_validation_detail jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.tutor_profiles where id = p_tutor_id) then
    raise exception 'Only tutors have payout accounts' using errcode = '42501';
  end if;
  if coalesce(p_subaccount_code, '') !~ '^ACCT_[A-Za-z0-9]+$' then
    raise exception 'Not a Paystack subaccount code';
  end if;
  if coalesce(p_last4, '') !~ '^[0-9]{4}$' then
    raise exception 'Only the last 4 digits of the account number are stored';
  end if;
  insert into public.tutor_payout_accounts (tutor_id, bank_name, bank_code, account_holder_name, account_number_last4,
                                            paystack_subaccount_code, validation_status, validation_detail,
                                            validated_at, is_verified, updated_at)
  values (p_tutor_id, p_bank_name, p_bank_code, p_account_holder, p_last4, p_subaccount_code, p_validation_status,
          p_validation_detail, case when p_validation_status = 'validated' then now() end,
          p_validation_status = 'validated', now())
  on conflict (tutor_id) do update
  set bank_name = excluded.bank_name, bank_code = excluded.bank_code, account_holder_name = excluded.account_holder_name,
      account_number_last4 = excluded.account_number_last4, paystack_subaccount_code = excluded.paystack_subaccount_code,
      validation_status = excluded.validation_status, validation_detail = excluded.validation_detail,
      validated_at = excluded.validated_at, is_verified = excluded.is_verified, account_number_hash = null,
      updated_at = now();
end;
$$;
revoke all on function public.save_tutor_payout_account(uuid, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_tutor_payout_account(uuid, text, text, text, text, text, text, jsonb) to service_role;

-- 5. Settles acceptances stuck in 'charging' by asking Paystack. charge_check_request_id = -1 means
--    "checked, couldn't be settled automatically (e.g. an amount mismatch), admins told" — it is left
--    for a person and not checked again.
create or replace function public.reconcile_stale_charges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  resp record;
  body jsonb;
  v_status text;
  v_secret text;
  v_check bigint;
begin
  for req in
    select id, charge_reference, charge_check_request_id, claimed_at
    from public.session_requests
    where payment_status = 'charging' and charge_check_request_id > 0
  loop
    select * into resp from net._http_response where id = req.charge_check_request_id;
    if resp.id is null then
      if not exists (select 1 from net.http_request_queue q where q.id = req.charge_check_request_id) then
        update public.session_requests set charge_check_request_id = null where id = req.id;
      end if;
      continue;
    end if;
    body := public.try_jsonb(resp.content);
    v_status := lower(body #>> '{data,status}');
    begin
      if resp.status_code between 200 and 299 and v_status = 'success' then
        perform public.finalize_session_charge(req.id, req.charge_reference, (body #>> '{data,amount}')::bigint,
                                               body #>> '{data,currency}', nullif(body #>> '{data,fees}', '')::bigint);
      elsif (resp.status_code between 200 and 299 and v_status in ('failed', 'abandoned', 'reversed'))
            or (resp.status_code in (400, 404) and coalesce(body->>'message', '') ilike '%not found%') then
        perform public.release_session_charge(req.id, req.charge_reference, 'The card charge didn''t go through');
      else
        update public.session_requests set charge_check_request_id = null where id = req.id;
      end if;
    exception when others then
      -- e.g. an amount mismatch (finalize has told the admins): park it for a person.
      update public.session_requests
      set charge_check_request_id = -1, charge_failure_reason = left(sqlerrm, 300)
      where id = req.id;
      perform public.notify_active_admins('charge_needs_attention', 'An acceptance couldn''t be settled',
        'Session request ' || req.id || ' (charge ' || req.charge_reference || '): ' || left(sqlerrm, 200)
        || '. Check the charge in the Paystack dashboard.', null);
    end;
  end loop;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'paystack_secret_key';
  if v_secret is null then
    return;
  end if;
  for req in
    select id, charge_reference from public.session_requests
    where payment_status = 'charging' and charge_check_request_id is null
      and claimed_at < now() - interval '5 minutes'
    limit 50
  loop
    select net.http_get(
      url := 'https://api.paystack.co/transaction/verify/' || req.charge_reference,
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret)
    ) into v_check;
    update public.session_requests set charge_check_request_id = v_check where id = req.id;
  end loop;
end;
$$;
revoke all on function public.reconcile_stale_charges() from public, anon, authenticated;
select cron.unschedule('reconcile-stale-charges') where exists (select 1 from cron.job where jobname = 'reconcile-stale-charges');
select cron.schedule('reconcile-stale-charges', '*/5 * * * *', 'select public.reconcile_stale_charges();');

-- Refund status: one place for the rules, used by the poll job and by the webhook ----------------
create or replace function public.apply_refund_status(p_request_id uuid, p_label text, p_refunded_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_label text := replace(lower(coalesce(p_label, '')), '_', '-');
begin
  select * into v_req from public.session_requests where id = p_request_id for update;
  if not found or v_req.payment_status not in ('refund_pending', 'refund_queued', 'refund_needs_attention') then
    return;
  end if;
  if v_label <> '' then
    update public.session_requests set refund_last_status = v_label where id = p_request_id;
  end if;

  if v_label = 'processed' then
    update public.session_requests
    set payment_status = 'refunded', refunded_at = coalesce(p_refunded_at, now())
    where id = p_request_id;
    insert into public.notifications (profile_id, type, title, body, related_session_id)
    select distinct p, 'refund_processed', 'Your refund has been processed',
           'Paystack has processed your refund. It can take up to 10 business days to reach your account, depending on your bank.',
           v_req.resulting_session_id
    from unnest(array[v_req.student_id, v_req.requested_by_profile_id]) as p
    where p is not null;
  elsif v_label = 'failed' then
    update public.session_requests set payment_status = 'refund_failed' where id = p_request_id;
    perform public.notify_active_admins('refund_failed', 'A refund failed',
      'Paystack reports a refund as failed (session request ' || p_request_id
      || '). The money is back in Tutorlage''s Paystack balance; the learner still needs refunding.',
      v_req.resulting_session_id);
  elsif v_label = 'needs-attention' and v_req.payment_status <> 'refund_needs_attention' then
    update public.session_requests set payment_status = 'refund_needs_attention' where id = p_request_id;
    perform public.notify_active_admins('refund_needs_attention', 'A refund needs attention',
      'Paystack needs the customer''s bank details to finish a refund (session request ' || p_request_id
      || '). Use Retry Refund in the Paystack dashboard.', v_req.resulting_session_id);
  elsif v_label in ('pending', 'processing') and v_req.payment_status = 'refund_pending' then
    update public.session_requests set payment_status = 'refund_queued' where id = p_request_id;
  end if;
end;
$$;
revoke all on function public.apply_refund_status(uuid, text, timestamptz) from public, anon, authenticated;

-- Paystack's refund.* webhook events (server/index.ts), matched by refund id or transaction reference.
create or replace function public.apply_refund_webhook(p_refund_id bigint, p_transaction_reference text, p_status text, p_refunded_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.session_requests
  where (p_refund_id is not null and paystack_refund_id = p_refund_id)
     or (p_transaction_reference is not null
         and coalesce(charge_reference, paystack_reference) = p_transaction_reference
         and payment_status in ('refund_pending', 'refund_queued', 'refund_needs_attention'))
  order by (paystack_refund_id = p_refund_id) desc nulls last
  limit 1;
  if v_id is null then
    return false;
  end if;
  update public.session_requests set paystack_refund_id = coalesce(paystack_refund_id, p_refund_id) where id = v_id;
  perform public.apply_refund_status(v_id, p_status, p_refunded_at);
  return true;
end;
$$;
revoke all on function public.apply_refund_webhook(bigint, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_refund_webhook(bigint, text, text, timestamptz) to service_role;

-- Same behaviour as 20260930238000, with step 2 now going through apply_refund_status.
create or replace function public.reconcile_pending_refunds()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  resp record;
  body jsonb;
begin
  for req in
    select id, refund_request_id, resulting_session_id, created_at, refund_requested_at
    from public.session_requests
    where payment_status = 'refund_pending' and refund_request_id is not null
  loop
    select * into resp from net._http_response where id = req.refund_request_id;
    if resp.id is null then
      if coalesce(req.refund_requested_at, req.created_at) < now() - interval '2 hours' and not exists (
        select 1 from net.http_request_queue q where q.id = req.refund_request_id
      ) then
        update public.session_requests
        set payment_status = 'refund_needs_attention', refund_last_status = 'no reply recorded from Paystack'
        where id = req.id and payment_status = 'refund_pending';
        perform public.notify_active_admins('refund_needs_attention', 'A refund needs checking',
          'No reply from Paystack was recorded for a refund request (session request ' || req.id
          || '). Check the transaction in the Paystack dashboard.', req.resulting_session_id);
      end if;
      continue;
    end if;

    body := public.try_jsonb(resp.content);
    if resp.status_code between 200 and 299 and coalesce((body->>'status')::boolean, false) then
      update public.session_requests
      set payment_status = 'refund_queued',
          paystack_refund_id = coalesce(paystack_refund_id, nullif(body #>> '{data,id}', '')::bigint),
          refund_last_status = coalesce(body #>> '{data,status}', 'pending')
      where id = req.id and payment_status = 'refund_pending';
    else
      update public.session_requests
      set payment_status = 'refund_failed',
          refund_last_status = left(coalesce(body->>'message', resp.error_msg, 'HTTP ' || resp.status_code), 200)
      where id = req.id;
      perform public.notify_active_admins('refund_failed', 'A refund was refused',
        'Paystack refused a refund (session request ' || req.id || '): '
        || left(coalesce(body->>'message', resp.error_msg, 'HTTP ' || resp.status_code), 200),
        req.resulting_session_id);
    end if;
  end loop;

  for req in
    select id, refund_poll_request_id, refund_checked_at
    from public.session_requests
    where payment_status in ('refund_queued', 'refund_needs_attention') and refund_poll_request_id is not null
  loop
    select * into resp from net._http_response where id = req.refund_poll_request_id;
    if resp.id is null then
      if req.refund_checked_at < now() - interval '2 hours' then
        update public.session_requests set refund_poll_request_id = null where id = req.id;
      end if;
      continue;
    end if;
    body := public.try_jsonb(resp.content);
    update public.session_requests
    set refund_poll_request_id = null, refund_checked_at = now()
    where id = req.id;
    if resp.status_code between 200 and 299 then
      perform public.apply_refund_status(req.id, body #>> '{data,status}',
                                         nullif(body #>> '{data,refunded_at}', '')::timestamptz);
    end if;
  end loop;
end;
$$;
revoke all on function public.reconcile_pending_refunds() from public, anon, authenticated;

-- 6. Unmatched requests: legacy paid ones are refunded (as before); card-checked ones just expire.
create or replace function public.expire_stale_paid_requests()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req record;
  secret text;
  req_id bigint;
begin
  for req in
    select id, student_id, requested_by_profile_id from public.session_requests
    where status = 'pending' and payment_status = 'card_verified'
      and requested_start < now() - interval '30 minutes'
    for update skip locked
  loop
    update public.session_requests set status = 'expired', responded_at = now() where id = req.id;
    insert into public.notifications (profile_id, type, title, body)
    select distinct p, 'request_expired', 'No tutor was free in time',
           'Nobody accepted your request before the session time, so it has expired. Your card was not charged.'
    from unnest(array[req.student_id, req.requested_by_profile_id]) as p
    where p is not null;
  end loop;

  select decrypted_secret into secret from vault.decrypted_secrets where name = 'paystack_secret_key';
  if secret is null then
    raise notice 'paystack_secret_key not found in vault; skipping refund sweep';
    return;
  end if;

  for req in
    select id, paystack_reference
    from public.session_requests
    where status = 'pending'
      and payment_status = 'paid'
      and requested_start < now() - interval '30 minutes'
  loop
    select net.http_post(
      url := 'https://api.paystack.co/refund',
      headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
      body := jsonb_build_object('transaction', req.paystack_reference)
    ) into req_id;

    update public.session_requests
      set status = 'expired', payment_status = 'refund_pending', refund_request_id = req_id,
          refund_requested_at = now()
      where id = req.id;
  end loop;
end;
$$;
revoke all on function public.expire_stale_paid_requests() from public, anon, authenticated;

-- 7. Cancelling refunds the actual charge, and the window counts from it.
create or replace function public.cancel_session(p_session_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session record;
  v_request record;
  v_days integer;
  v_clock text;
  v_by_tutor boolean;
  v_secret text;
  v_refund_id bigint;
begin
  select id, student_id, tutor_id, status, scheduled_start, booked_by_profile_id into v_session
  from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'Session not found' using errcode = '42501';
  end if;

  v_by_tutor := v_session.tutor_id = v_uid;
  if not v_by_tutor and v_uid is distinct from v_session.student_id and v_uid is distinct from v_session.booked_by_profile_id then
    raise exception 'Only the learner, the person who booked, or the tutor can cancel this session' using errcode = '42501';
  end if;
  if v_session.status <> 'scheduled' then
    raise exception 'Only an upcoming session can be cancelled';
  end if;
  if now() >= v_session.scheduled_start then
    raise exception 'This session has already started — contact support if something went wrong';
  end if;

  select * into v_request from public.session_requests where resulting_session_id = p_session_id for update;
  if not found or v_request.payment_status <> 'paid' then
    raise exception 'No payment to refund was found for this session — contact support';
  end if;

  if not v_by_tutor then
    select coalesce((select (setting_value #>> '{}')::integer from public.system_settings where setting_key = 'cancellation_window_days'), 7),
           coalesce((select setting_value #>> '{}' from public.system_settings where setting_key = 'cancellation_clock_start'), 'payment')
    into v_days, v_clock;
    if v_clock = 'payment' and now() > coalesce(v_request.charged_at, v_request.created_at) + make_interval(days => v_days) then
      raise exception 'The % day cancellation window for this booking has closed', v_days;
    end if;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'paystack_secret_key';
  if v_secret is null then
    raise exception 'Refunds aren''t set up on this server yet — contact support';
  end if;

  select net.http_post(
    url := 'https://api.paystack.co/refund',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := jsonb_build_object('transaction', coalesce(v_request.charge_reference, v_request.paystack_reference))
  ) into v_refund_id;

  update public.sessions
  set status = case when v_by_tutor then 'cancelled_by_tutor'::public.session_status
                    else 'cancelled_by_student'::public.session_status end
  where id = p_session_id;

  update public.session_requests
  set status = 'cancelled', payment_status = 'refund_pending', refund_request_id = v_refund_id,
      refund_requested_at = now()
  where id = v_request.id;

  insert into public.notifications (profile_id, type, title, body, related_session_id)
  values (
    case when v_by_tutor then v_session.student_id else v_session.tutor_id end,
    'session_cancelled',
    'A session was cancelled',
    case when v_by_tutor
         then 'Your tutor cancelled the session. Your payment is being refunded in full — once Paystack has processed it, it can take up to 10 business days to reach your account.'
         else 'The learner cancelled the session.' end
      || coalesce(' Reason: ' || nullif(trim(p_reason), ''), ''),
    p_session_id
  );
end;
$$;
revoke all on function public.cancel_session(uuid, text) from public, anon;
grant execute on function public.cancel_session(uuid, text) to authenticated;
