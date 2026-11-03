-- WALLET EDGES, phase 6 of the wallet + manual bank transfer system (CEO's design, 2 Nov 2026; plan Drake/programmer/wallet-manual-eft-plan-2026-11-02.md).
-- Apply AFTER 20261103090000_wallet_edges_audit_actions.sql has committed on its own, and after phases 1 and 2 (20261102200100, 20261102210000).
-- Database only. The wallet switch stays OFF; nothing here changes how a request, a session or a card payment works.
--   1. A REFUND AFTER THE TUTOR WAS CREDITED OR PAID: admin_refund_to_wallet() puts money back in the learner's wallet; the tutor is reduced by the same
--      share only if their wallet still covers it, never below zero (otherwise the finance admin settles with the tutor by hand). Two new ledger kinds:
--      refund_reversal (the tutor side) and withdrawal (money returned by hand).
--   2. A LEARNER (OR ANYONE) TAKING MONEY OUT: no button for them; admin_return_wallet_money() records the finance admin's hand transfer as a ledger line
--      with a reason. admin_add_topup_by_hand() credits a transfer that came with no proof or the wrong reference.
--   3. CLOSING AN ACCOUNT: the closing screen shows the wallet (available, on hold, open payout, bank transfers not yet confirmed); closing cancels
--      top-ups still waiting for proof, tells the finance admins when money is left, and NEVER deletes a balance or an open payout request. The tutor's
--      bank details and the person's proof files are kept only while money is owed, then deleted (the full account number on settled payout requests is scrubbed).
--   4. RETENTION: wallet_paid / wallet_refunded join the settled list; a new category wallet_records deletes settled payout requests and top-ups 7 years after
--      the end of the financial year, and a wallet TOGETHER WITH ITS WHOLE LEDGER only at a zero balance (the daily balance check assumes every chain starts at
--      zero); a person's tombstone is kept while any wallet record or proof file is.
--   5. PROOF FILES: a daily job queues the deletion of a proof file 90 days after a successful transfer and 30 days after an unsuccessful one (days from System
--      Settings). The Worker removes the file (it must know the bucket: server/closeAccount.ts). The top-up record stays 7 years. What was queued is journalled.
-- Patches to existing functions follow the free-sessions method: each anchor must occur EXACTLY ONCE or the migration stops and changes nothing; a marker
-- makes a re-run a no-op. Nothing is dropped. Two existing constraints are rebuilt with the same lists plus the new values.

-- 0. words in System Settings ---------------------------------------------------------------------------------------------------------------
update public.system_settings set description = 'Days a proof-of-payment file is kept after a successful transfer. The daily job wallet-delete-proofs queues the deletion of older files; the top-up record is kept 7 years.'
  where setting_key = 'wallet_proof_keep_days_successful';
update public.system_settings set description = 'Days a proof-of-payment file is kept after an unsuccessful transfer (or a cancelled top-up). The daily job wallet-delete-proofs queues the deletion of older files; the top-up record is kept 7 years.'
  where setting_key = 'wallet_proof_keep_days_unsuccessful';

-- 1. two new ledger kinds, and two new journal categories -----------------------------------------------------------------------------------------
alter table public.wallet_ledger drop constraint if exists wallet_ledger_kind_check;
alter table public.wallet_ledger add constraint wallet_ledger_kind_check
  check (kind in ('topup', 'hold', 'release', 'charge', 'refund', 'session_credit', 'payout_hold', 'payout_paid', 'payout_release', 'adjustment', 'refund_reversal', 'withdrawal'));
alter table public.wallet_ledger drop constraint if exists wallet_ledger_shape;
alter table public.wallet_ledger add constraint wallet_ledger_shape check (
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
    when 'refund_reversal' then available_delta < 0 and held_delta = 0
    when 'withdrawal' then available_delta < 0 and held_delta = 0
    else false end);

alter table public.retention_deletion_records drop constraint if exists retention_deletion_records_category_check;
alter table public.retention_deletion_records add constraint retention_deletion_records_category_check
  check (category in ('tutor_documents', 'consent_records', 'problem_reports', 'money_records', 'tombstones', 'admin_notice', 'worker_wake', 'wallet_records', 'payment_proofs'));

-- 2. small internal helpers (nobody through the API) ----------------------------------------------------------------------------------------------
-- What a closing person's wallet looks like; null when there is nothing in it at all.
create or replace function public.closure_wallet_summary(p_profile uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when s.a + s.h + s.pay + s.n_top = 0 then null
              else jsonb_build_object('available_rand', s.a, 'held_rand', s.h, 'open_payout_rand', s.pay, 'open_topups', s.n_top, 'unconfirmed_rand', s.unconf) end
  from (select coalesce((select w.available_rand from public.wallets w where w.profile_id = p_profile), 0) as a,
               coalesce((select w.held_rand from public.wallets w where w.profile_id = p_profile), 0) as h,
               coalesce((select sum(r.amount_rand) from public.payout_requests r where r.tutor_id = p_profile and r.status = 'requested'), 0)::integer as pay,
               (select count(*) from public.wallet_topups t where t.profile_id = p_profile and t.status in ('awaiting_proof', 'proof_sent'))::integer as n_top,
               coalesce((select sum(t.amount_rand) from public.wallet_topups t where t.profile_id = p_profile and t.status = 'proof_sent'), 0)::integer as unconf) s;
$$;
revoke all on function public.closure_wallet_summary(uuid) from public, anon, authenticated, service_role;

-- True while money is owed to the person: a balance (available or on hold, an open payout request is on hold), or a bank transfer with proof not decided yet.
create or replace function public.closure_wallet_owes(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select w.available_rand + w.held_rand from public.wallets w where w.profile_id = p_profile), 0) > 0
      or exists (select 1 from public.payout_requests r where r.tutor_id = p_profile and r.status = 'requested')
      or exists (select 1 from public.wallet_topups t where t.profile_id = p_profile and t.status = 'proof_sent');
$$;
revoke all on function public.closure_wallet_owes(uuid) from public, anon, authenticated, service_role;

-- When nothing is owed any more: the tutor's bank details go, the full account number and holder name on settled payout requests are scrubbed (the last
-- four digits stay), and the person's proof files are queued for the Worker to remove. Safe to run again.
create or replace function public.closure_wallet_cleanup(p_closure uuid, p_profile uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_paths text[];
  v_open text[];
  v_new text[];
begin
  if public.closure_wallet_owes(p_profile) then
    return;
  end if;
  delete from public.tutor_bank_details where tutor_id = p_profile;
  update public.payout_requests set account_number = '000000' || account_last4, account_holder = 'Closed account'
  where tutor_id = p_profile and status <> 'requested' and (account_number <> '000000' || account_last4 or account_holder <> 'Closed account');
  select coalesce(array_agg(o.name), '{}'::text[]) into v_paths from storage.objects o
  where o.bucket_id = 'payment-proofs' and split_part(o.name, '/', 1) = p_profile::text;
  select coalesce(array_agg(distinct p.x), '{}'::text[]) into v_open
  from public.account_closure_tasks k,
       lateral jsonb_array_elements_text(case when jsonb_typeof(k.payload -> 'paths') = 'array' then k.payload -> 'paths' else '[]'::jsonb end) as p(x)
  where k.profile_id = p_profile and k.kind = 'storage_remove' and k.status in ('pending', 'claimed') and k.payload ->> 'bucket' = 'payment-proofs';
  select coalesce(array_agg(u.x), '{}'::text[]) into v_new from unnest(v_paths) u(x) where not (u.x = any (v_open));
  if coalesce(array_length(v_new, 1), 0) > 0 then
    perform public.closure_enqueue_files(p_closure, p_profile, 'payment-proofs', v_new);
    update public.wallet_topups set proof_deleted_at = coalesce(proof_deleted_at, now()) where profile_id = p_profile and proof_path is not null;
  end if;
end;
$$;
revoke all on function public.closure_wallet_cleanup(uuid, uuid) from public, anon, authenticated, service_role;

-- 3. finance admin functions ----------------------------------------------------------------------------------------------------------------------
-- A refund the finance admin decides on, after the session is over (a problem reported later). The learner (the payer) gets p_amount back as wallet credit.
-- With p_take_back the tutor is reduced by the same share of what they were credited (proportional, rounded so the parts never add up to more than the credit),
-- but ONLY if their available balance still covers it; otherwise nothing is taken, the answer says how much the tutor still owes, and the finance admin settles
-- it with them by hand. A one-time key (the screen makes it once per click) makes a double click post once.
create or replace function public.admin_refund_to_wallet(p_session uuid, p_amount integer, p_comment text, p_take_back boolean, p_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_old uuid;
  s public.sessions;
  r public.session_requests;
  v_price integer;
  v_done integer;
  v_credit integer;
  v_reversed integer;
  v_reduce integer := 0;
  v_reduced integer := 0;
  v_short integer := 0;
  v_ledger uuid;
  v_day text;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  if p_key is null then
    raise exception 'The screen must send a one-time key' using errcode = '22023';
  end if;
  select l.id into v_old from public.wallet_ledger l where l.idempotency_key = 'adminrefund:' || p_key;
  if found then
    return jsonb_build_object('ledger_id', v_old, 'already', true);
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000 then
    raise exception 'Give the amount to refund, in whole rands (at least 1)' using errcode = '22023';
  end if;
  if v_comment is null or length(v_comment) < 5 or length(v_comment) > 500 then
    raise exception 'A written reason is needed (5 to 500 characters)' using errcode = '22023';
  end if;
  select * into s from public.sessions where id = p_session for update;
  if not found then
    raise exception 'No such session' using errcode = 'P0002';
  end if;
  select * into r from public.session_requests q where q.resulting_session_id = p_session and q.paid_from_wallet for update;
  if not found or not s.wallet_paid then
    raise exception 'That session was not paid from a wallet' using errcode = '22023';
  end if;
  if s.status <> 'completed' then
    raise exception 'Only a finished session can be refunded here. A booked session is cancelled instead, and then the refund is automatic.' using errcode = '55000';
  end if;
  v_price := r.wallet_hold_rand;
  select coalesce(sum(l.available_delta), 0) into v_done from public.wallet_ledger l
  where l.kind = 'refund' and l.session_id = p_session and l.profile_id = r.requested_by_profile_id;
  if p_amount > v_price - v_done then
    raise exception 'At most R% can still be refunded for this session: it cost R%, and R% already went back.', v_price - v_done, v_price, v_done using errcode = '22023';
  end if;
  select l.available_delta into v_credit from public.wallet_ledger l where l.idempotency_key = 'credit:' || p_session;
  select coalesce(-sum(l.available_delta), 0) into v_reversed from public.wallet_ledger l where l.kind = 'refund_reversal' and l.session_id = p_session;
  if coalesce(p_take_back, false) and v_credit is not null and s.tutor_id is not null then
    v_reduce := greatest(round((v_done + p_amount)::numeric * v_credit / v_price)::integer - v_reversed, 0);
  end if;
  v_ledger := public.wallet_post(r.requested_by_profile_id, 'refund', p_amount, 0, 'adminrefund:' || p_key, auth.uid(), v_comment, r.id, p_session);
  if v_reduce > 0 then
    begin
      perform public.wallet_post(s.tutor_id, 'refund_reversal', -v_reduce, 0, 'adminrefundtutor:' || p_key, auth.uid(), 'The learner was refunded for this session', r.id, p_session);
      v_reduced := v_reduce;
    exception when others then
      if sqlerrm <> 'wallet_too_low' then
        raise;
      end if;
      v_short := v_reduce;
    end;
  end if;
  v_day := to_char(s.scheduled_start at time zone 'Africa/Johannesburg', 'FMDD FMMon');
  perform public.wallet_notify(r.requested_by_profile_id, 'wallet_refunded', 'A refund was added to your wallet',
    format('R%s was added to your wallet as a refund for your session on %s. %s', p_amount, v_day, v_comment));
  if v_reduced > 0 then
    perform public.wallet_notify(s.tutor_id, 'wallet_adjusted', 'Your wallet was updated',
      format('R%s was taken from your wallet because the learner was refunded for your session on %s.', v_reduced, v_day));
  end if;
  perform public.log_admin_event('wallet_refunded_to_learner', 'session', p_session,
    jsonb_build_object('amount_rand', p_amount, 'tutor_reduced_rand', v_reduced, 'tutor_shortfall_rand', v_short, 'reason', v_comment));
  return jsonb_build_object('ledger_id', v_ledger, 'already', false, 'refunded_rand', p_amount, 'refunded_total_rand', v_done + p_amount, 'price_rand', v_price,
    'tutor_credited', v_credit is not null, 'tutor_reduced_rand', v_reduced, 'tutor_shortfall_rand', v_short);
end;
$$;
revoke all on function public.admin_refund_to_wallet(uuid, integer, text, boolean, uuid) from public, anon;
grant execute on function public.admin_refund_to_wallet(uuid, integer, text, boolean, uuid) to authenticated;

-- Money returned to a person BY HAND (a learner who asked support to take their money out, a closed account, a tutor with a balance and no payout request).
-- Only available money can be returned; money on hold belongs to an open payout request, which is marked paid or cannot-pay first.
create or replace function public.admin_return_wallet_money(p_profile uuid, p_amount integer, p_reason text, p_bank_reference text, p_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ref text := nullif(btrim(coalesce(p_bank_reference, '')), '');
  v_old uuid;
  v_avail integer;
  v_held integer;
  v_ledger uuid;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  if p_key is null then
    raise exception 'The screen must send a one-time key' using errcode = '22023';
  end if;
  select l.id into v_old from public.wallet_ledger l where l.idempotency_key = 'return:' || p_key;
  if found then
    return jsonb_build_object('ledger_id', v_old, 'already', true);
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000 then
    raise exception 'Give the amount returned, in whole rands (at least 1)' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) < 5 or length(v_reason) > 400 then
    raise exception 'A written reason is needed (5 to 400 characters), for example who asked and how you checked it was them' using errcode = '22023';
  end if;
  if v_ref is not null and length(v_ref) > 60 then
    raise exception 'The bank reference is too long (60 characters at most)' using errcode = '22023';
  end if;
  select w.available_rand, w.held_rand into v_avail, v_held from public.wallets w where w.profile_id = p_profile;
  if not found then
    raise exception 'That person has no wallet' using errcode = 'P0002';
  end if;
  if p_amount > v_avail then
    raise exception 'The wallet has R% available (and R% on hold). Money on hold belongs to a payout request: mark that request paid or cannot-pay first.', v_avail, v_held using errcode = '22023';
  end if;
  v_ledger := public.wallet_post(p_profile, 'withdrawal', -p_amount, 0, 'return:' || p_key, auth.uid(),
                                 'Returned by hand: ' || v_reason || coalesce(' (bank reference ' || v_ref || ')', ''), null, null, null, null);
  if not exists (select 1 from public.account_closures c where c.profile_id = p_profile and c.status in ('closed', 'db_deleted', 'done')) then
    perform public.wallet_notify(p_profile, 'wallet_money_returned', 'Money was returned to you',
      format('R%s was taken out of your wallet and sent back to your bank account. Note: %s', p_amount, v_reason));
  end if;
  perform public.log_admin_event('wallet_money_returned', 'wallet', p_profile, jsonb_build_object('amount_rand', p_amount, 'reason', v_reason, 'bank_reference', v_ref));
  return jsonb_build_object('ledger_id', v_ledger, 'already', false, 'returned_rand', p_amount, 'available_rand', v_avail - p_amount);
end;
$$;
revoke all on function public.admin_return_wallet_money(uuid, integer, text, text, uuid) from public, anon;
grant execute on function public.admin_return_wallet_money(uuid, integer, text, text, uuid) to authenticated;

-- A transfer that came with no proof, or the wrong reference: the finance admin credits it by hand. It is a real top-up record (successful, with a
-- reference and the written reason) and an ordinary top-up ledger line, so the books look the same as for a normal transfer. The one-time key is
-- the top-up's own id, so a double click creates and credits it once. The balance cap does not apply (the money is already in the bank).
create or replace function public.admin_add_topup_by_hand(p_profile uuid, p_amount integer, p_bank_reference text, p_comment text, p_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_ref_in text := nullif(btrim(coalesce(p_bank_reference, '')), '');
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_ref text;
  v_id uuid;
  r jsonb;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  if p_key is null then
    raise exception 'The screen must send a one-time key' using errcode = '22023';
  end if;
  select t.reference into v_ref from public.wallet_topups t where t.id = p_key;
  if found then
    return jsonb_build_object('topup_id', p_key, 'reference', v_ref, 'already', true);
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000 then
    raise exception 'Give the amount received, in whole rands (at least 1)' using errcode = '22023';
  end if;
  if v_comment is null or length(v_comment) < 5 or length(v_comment) > 380 then
    raise exception 'A written reason is needed (5 to 380 characters), for example why there is no proof' using errcode = '22023';
  end if;
  if v_ref_in is not null and length(v_ref_in) > 60 then
    raise exception 'The bank reference is too long (60 characters at most)' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'No such person' using errcode = 'P0002';
  end if;
  perform public.wallet_ensure(p_profile);
  for i in 1..10 loop
    v_bytes := decode(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), 'hex');
    v_ref := 'TL-' || (select string_agg(substr(v_alpha, (get_byte(v_bytes, g) % 32) + 1, 1), '' order by g) from generate_series(0, 5) g);
    begin
      insert into public.wallet_topups (id, profile_id, reference, amount_rand) values (p_key, p_profile, v_ref, p_amount) returning id into v_id;
      exit;
    exception when unique_violation then
      v_id := null;
    end;
  end loop;
  if v_id is null then
    raise exception 'Could not create a reference. Please try again.' using errcode = '55000';
  end if;
  r := public.wallet_credit_topup(v_id, p_amount, auth.uid(), 'Added by hand: ' || v_comment || coalesce(' (bank reference ' || v_ref_in || ')', ''));
  perform public.log_admin_event('wallet_topup_successful', 'wallet_topup', v_id,
    jsonb_build_object('received_rand', p_amount, 'by_hand', true, 'bank_reference', v_ref_in, 'reason', v_comment));
  return r || jsonb_build_object('reference', v_ref);
end;
$$;
revoke all on function public.admin_add_topup_by_hand(uuid, integer, text, text, uuid) from public, anon;
grant execute on function public.admin_add_topup_by_hand(uuid, integer, text, text, uuid) to authenticated;

-- A tutor's full bank details, for paying money that is not on a payout request (for example a closed tutor). One audit line each time it is opened.
create or replace function public.admin_open_tutor_bank_details(p_tutor uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  b public.tutor_bank_details;
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  select * into b from public.tutor_bank_details d where d.tutor_id = p_tutor;
  if not found then
    raise exception 'No bank details are kept for this person' using errcode = 'P0002';
  end if;
  perform public.log_admin_event('wallet_bank_details_opened', 'wallet', p_tutor, jsonb_build_object('opened', 'tutor_bank_details'));
  return jsonb_build_object('bank_name', b.bank_name, 'account_holder', b.account_holder, 'branch_code', b.branch_code, 'account_number', b.account_number);
end;
$$;
revoke all on function public.admin_open_tutor_bank_details(uuid) from public, anon;
grant execute on function public.admin_open_tutor_bank_details(uuid) to authenticated;

-- The sessions a person's wallet paid for, newest first, with what a refund screen needs.
create or replace function public.admin_wallet_sessions(p_profile uuid)
returns table (session_id uuid, scheduled_start timestamptz, status text, price_rand integer, refunded_rand integer, tutor_id uuid,
               tutor_share_rand integer, tutor_credited boolean, tutor_reduced_rand integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  return query
    select s.id, s.scheduled_start, s.status::text, (-l.held_delta)::integer,
           coalesce((select sum(x.available_delta) from public.wallet_ledger x where x.kind = 'refund' and x.session_id = s.id and x.profile_id = p_profile), 0)::integer,
           s.tutor_id,
           coalesce((select c.available_delta from public.wallet_ledger c where c.idempotency_key = 'credit:' || s.id), 0)::integer,
           exists (select 1 from public.wallet_ledger c where c.idempotency_key = 'credit:' || s.id),
           coalesce((select -sum(x.available_delta) from public.wallet_ledger x where x.kind = 'refund_reversal' and x.session_id = s.id), 0)::integer
    from public.wallet_ledger l join public.sessions s on s.id = l.session_id
    where l.profile_id = p_profile and l.kind = 'charge'
    order by s.scheduled_start desc
    limit 25;
end;
$$;
revoke all on function public.admin_wallet_sessions(uuid) from public, anon;
grant execute on function public.admin_wallet_sessions(uuid) to authenticated;

-- Closed accounts that still have money in a wallet, an open payout request or a bank transfer not decided yet: the list the finance admin works through.
create or replace function public.admin_closed_account_wallets()
returns table (profile_id uuid, role text, display_name text, available_rand integer, held_rand integer, open_payout_rand integer, unconfirmed_rand integer,
               closure_id uuid, closure_status text, closed_at timestamptz, topup_references text[], has_bank_details boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.wallet_is_finance_admin() then
    raise exception 'Finance admins only' using errcode = '42501';
  end if;
  return query
    select c.profile_id, p.role::text, p.full_name::text, coalesce(w.available_rand, 0), coalesce(w.held_rand, 0),
           coalesce((select sum(r.amount_rand) from public.payout_requests r where r.tutor_id = c.profile_id and r.status = 'requested'), 0)::integer,
           coalesce((select sum(t.amount_rand) from public.wallet_topups t where t.profile_id = c.profile_id and t.status = 'proof_sent'), 0)::integer,
           c.id, c.status, c.closed_at,
           (select array_agg(x.reference) from (select t.reference from public.wallet_topups t where t.profile_id = c.profile_id and t.status = 'successful'
                                                  order by t.decided_at desc limit 5) x),
           exists (select 1 from public.tutor_bank_details b where b.tutor_id = c.profile_id)
    from (select distinct on (a.profile_id) a.* from public.account_closures a order by a.profile_id, a.closed_at desc) c
    left join public.profiles p on p.id = c.profile_id
    left join public.wallets w on w.profile_id = c.profile_id
    where c.status in ('closed', 'db_deleted', 'done') and public.closure_wallet_owes(c.profile_id)
    order by c.closed_at;
end;
$$;
revoke all on function public.admin_closed_account_wallets() from public, anon;
grant execute on function public.admin_closed_account_wallets() to authenticated;

-- 4. retention: a new category for the wallet tables ---------------------------------------------------------------------------------------------
create or replace function public.retention_run_wallet_records()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_years integer := public.retention_years('retention_money_years', 7);
  v_cap integer := public.retention_run_cap();
  v_ids uuid[];
  w record;
  n integer;
  n_pay integer := 0;
  n_top integer := 0;
  n_led integer := 0;
  n_wal integer := 0;
  n_prot integer := 0;
  v_capped boolean := false;
begin
  perform public.retention_assert_foreign_keys('public.wallets', '{}'::text[]);
  perform public.retention_assert_foreign_keys('public.wallet_topups', '{}'::text[]);
  perform public.retention_assert_foreign_keys('public.payout_requests', '{}'::text[]);
  perform public.retention_assert_names('public.payout_requests', 'status', array['requested', 'paid', 'could_not_pay']);
  perform public.retention_assert_names('public.wallet_topups', 'status', array['awaiting_proof', 'proof_sent', 'successful', 'unsuccessful', 'cancelled']);

  -- Payout requests that are settled (paid, or could not be paid).
  select count(*) into n from public.payout_requests r
  where r.status in ('paid', 'could_not_pay') and public.retention_money_cutoff(greatest(r.requested_at, r.decided_at)::date) < current_date
    and public.retention_person_blocked(r.tutor_id);
  n_prot := n_prot + n;
  select coalesce(array_agg(x.id), '{}'::uuid[]) into v_ids from (
    select r.id from public.payout_requests r
    where r.status in ('paid', 'could_not_pay') and public.retention_money_cutoff(greatest(r.requested_at, r.decided_at)::date) < current_date
      and not public.retention_person_protected(r.tutor_id)
    limit v_cap) x;
  delete from public.payout_requests where id = any (v_ids);
  get diagnostics n_pay = row_count;
  v_capped := v_capped or n_pay >= v_cap;

  -- Top-ups that are decided or cancelled, once their proof file is gone.
  select count(*) into n from public.wallet_topups t
  where t.status in ('successful', 'unsuccessful', 'cancelled')
    and public.retention_money_cutoff(greatest(t.created_at, t.updated_at, t.decided_at)::date) < current_date
    and public.retention_person_blocked(t.profile_id);
  n_prot := n_prot + n;
  select coalesce(array_agg(x.id), '{}'::uuid[]) into v_ids from (
    select t.id from public.wallet_topups t
    where t.status in ('successful', 'unsuccessful', 'cancelled')
      and public.retention_money_cutoff(greatest(t.created_at, t.updated_at, t.decided_at)::date) < current_date
      and not exists (select 1 from storage.objects o where o.bucket_id = 'payment-proofs' and o.name like t.profile_id::text || '/' || t.id::text || '.%')
      and not public.retention_person_protected(t.profile_id)
    limit v_cap) x;
  delete from public.wallet_topups where id = any (v_ids);
  get diagnostics n_top = row_count;
  v_capped := v_capped or n_top >= v_cap;

  -- A wallet goes TOGETHER WITH ITS WHOLE LEDGER, and only at a zero balance with nothing open and every record of it past its time.
  for w in
    select x.profile_id from public.wallets x
    where x.available_rand = 0 and x.held_rand = 0
      and not exists (select 1 from public.payout_requests r where r.tutor_id = x.profile_id and r.status = 'requested')
      and not exists (select 1 from public.wallet_topups t where t.profile_id = x.profile_id and t.status in ('awaiting_proof', 'proof_sent'))
      and public.retention_money_cutoff(greatest(x.updated_at, x.created_at,
            (select max(l.created_at) from public.wallet_ledger l where l.profile_id = x.profile_id),
            (select max(greatest(t.created_at, t.updated_at)) from public.wallet_topups t where t.profile_id = x.profile_id),
            (select max(greatest(r.requested_at, r.decided_at)) from public.payout_requests r where r.tutor_id = x.profile_id))::date) < current_date
    order by x.profile_id
    limit v_cap
  loop
    if public.retention_person_blocked(w.profile_id) or public.retention_person_protected(w.profile_id) then
      n_prot := n_prot + 1;
      continue;
    end if;
    perform set_config('tutorlage.purging_wallet_ledger', 'on', true);
    delete from public.wallet_ledger where profile_id = w.profile_id;
    get diagnostics n = row_count;
    n_led := n_led + n;
    delete from public.wallets where profile_id = w.profile_id;
    perform set_config('tutorlage.purging_wallet_ledger', 'off', true);
    n_wal := n_wal + 1;
  end loop;
  v_capped := v_capped or (n_wal + n_prot) >= v_cap;

  return jsonb_build_object('years', v_years, 'row_cap', v_cap, 'capped', v_capped, 'protected', n_prot, 'files', 0,
    'deleted', jsonb_build_object('payout_requests', n_pay, 'wallet_topups', n_top, 'wallet_ledger', n_led, 'wallets', n_wal));
end;
$$;
revoke all on function public.retention_run_wallet_records() from public, anon, authenticated, service_role;

-- 5. proof files: the daily deletion --------------------------------------------------------------------------------------------------------------
-- Queues the Worker's removal of a proof file 90 days after a successful transfer and 30 days after an unsuccessful or cancelled one (System Settings), and
-- notes the time on the top-up (proof_deleted_at). A file still in Storage two days after it was queued is queued again, so a failed removal is not forgotten.
-- A person with a safety hold, an open problem report, a prepared hand-over or a deferral is skipped. One journal row per run that did or skipped something.
create or replace function public.wallet_delete_old_proofs()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_run uuid := gen_random_uuid();
  v_ok integer := public.wallet_int_setting('wallet_proof_keep_days_successful', 90);
  v_bad integer := public.wallet_int_setting('wallet_proof_keep_days_unsuccessful', 30);
  v_cap integer := public.retention_run_cap();
  t record;
  n_files integer := 0;
  n_top integer := 0;
  n_prot integer := 0;
  v_err text;
begin
  begin
    for t in
      select tp.profile_id, array_agg(o.name order by o.name) as paths, array_agg(tp.id order by tp.id) as ids
      from public.wallet_topups tp
      join storage.objects o on o.bucket_id = 'payment-proofs' and o.name like tp.profile_id::text || '/' || tp.id::text || '.%'
      where ((tp.status = 'successful' and tp.decided_at < now() - make_interval(days => v_ok))
          or (tp.status = 'unsuccessful' and tp.decided_at < now() - make_interval(days => v_bad))
          or (tp.status = 'cancelled' and tp.updated_at < now() - make_interval(days => v_bad)))
        and (tp.proof_deleted_at is null or tp.proof_deleted_at < now() - interval '2 days')
      group by tp.profile_id
      order by min(tp.created_at)
      limit v_cap
    loop
      if public.retention_person_blocked(t.profile_id) then
        n_prot := n_prot + 1;
        continue;
      end if;
      perform public.closure_enqueue_files(v_run, t.profile_id, 'payment-proofs', t.paths);
      update public.wallet_topups set proof_deleted_at = now() where id = any (t.ids);
      n_files := n_files + array_length(t.paths, 1);
      n_top := n_top + array_length(t.ids, 1);
    end loop;
  exception when others then
    v_err := left(sqlerrm, 300);
  end;
  if n_files > 0 or n_prot > 0 or v_err is not null then
    insert into public.retention_deletion_records (run_id, category, period, deleted, protected_skipped, files_queued, error)
    values (v_run, 'payment_proofs', jsonb_build_object('keep_days_successful', v_ok, 'keep_days_unsuccessful', v_bad, 'row_cap', v_cap),
            jsonb_build_object('proof_files_queued', n_files, 'topups', n_top), n_prot, n_files, v_err);
  end if;
  if v_err is not null then
    perform public.wallet_notify_finance('wallet_proof_cleanup_failed', 'Old payment proofs could not be queued for deletion', 'The daily proof clean-up failed: ' || v_err);
  end if;
  if n_files > 0 then
    begin
      perform public.closure_wake_worker();
    exception when others then
      insert into public.retention_deletion_records (run_id, category, error) values (v_run, 'worker_wake', left(sqlerrm, 300));
    end;
  end if;
  return jsonb_build_object('run_id', v_run, 'files_queued', n_files, 'topups', n_top, 'protected', n_prot, 'error', v_err);
end;
$$;
revoke all on function public.wallet_delete_old_proofs() from public, anon, authenticated, service_role;

-- 6. THE EXISTING FUNCTIONS, PATCHED IN PLACE -----------------------------------------------------------------------------------------------------------
create or replace function pg_temp.edge_patch(p_sig regprocedure, p_marker text, p_anchor text, p_new text)
returns text
language plpgsql
as $patch$
declare
  d text := replace(pg_get_functiondef(p_sig), chr(13), '');
  parts text[];
begin
  if strpos(d, p_marker) > 0 then
    return p_sig::text || ': already patched (' || p_marker || ')';
  end if;
  parts := string_to_array(d, p_anchor);
  if array_length(parts, 1) is distinct from 2 then
    raise exception 'wallet edges patch: the anchor was found % time(s) in %, expected exactly once (%)', coalesce(array_length(parts, 1), 1) - 1, p_sig, p_marker;
  end if;
  execute parts[1] || p_new || parts[2];
  return p_sig::text || ': patched (' || p_marker || ')';
end;
$patch$;

-- preview_account_closure (the closing screen): a tutor's "owed" counts the wallet (available + on hold, which holds an open payout request) and no
-- longer counts wallet-paid sessions twice; every account shows its wallet.
select pg_temp.edge_patch('public.preview_account_closure(uuid)'::regprocedure, 'WALLET EDGES preview 1 (CEO, 3 Nov 2026)',
  $a$s.status = 'completed' and s.completed_at > now() - interval '7 days'), 0)$a$,
  $b$s.status = 'completed' and s.completed_at > now() - interval '7 days' and not s.wallet_paid /* WALLET EDGES preview 1 (CEO, 3 Nov 2026) */), 0)$b$);
select pg_temp.edge_patch('public.preview_account_closure(uuid)'::regprocedure, 'WALLET EDGES preview 2 (CEO, 3 Nov 2026)',
  $a$else 0 end;$a$,
  $b$else 0 end
        + case when v_p.role = 'tutor' then coalesce((select w.available_rand + w.held_rand from public.wallets w where w.profile_id = v_id), 0) else 0 end;  -- WALLET EDGES preview 2 (CEO, 3 Nov 2026)$b$);
select pg_temp.edge_patch('public.preview_account_closure(uuid)'::regprocedure, 'WALLET EDGES preview 3 (CEO, 3 Nov 2026)',
  $a$'payout_owed', case when v_owed > 0 then v_owed else null end));$a$,
  $b$'payout_owed', case when v_owed > 0 then v_owed else null end,
      'wallet', public.closure_wallet_summary(v_id)));  -- WALLET EDGES preview 3 (CEO, 3 Nov 2026)$b$);

-- closure_start: the same count; top-ups still waiting for proof are cancelled; the finance admins are told when money is left. Nothing is deleted or zeroed.
select pg_temp.edge_patch('public.closure_start(uuid, uuid, text, uuid, text, timestamptz, text, text, text)'::regprocedure, 'WALLET EDGES closure 1 (CEO, 3 Nov 2026)',
  $a$s.status = 'completed' and s.completed_at > now() - interval '7 days'), 0);$a$,
  $b$s.status = 'completed' and s.completed_at > now() - interval '7 days' and not s.wallet_paid /* WALLET EDGES closure 1 (CEO, 3 Nov 2026) */), 0)
            + coalesce((select w.available_rand + w.held_rand from public.wallets w where w.profile_id = p_profile), 0);$b$);
select pg_temp.edge_patch('public.closure_start(uuid, uuid, text, uuid, text, timestamptz, text, text, text)'::regprocedure, 'WALLET EDGES closure 2 (CEO, 3 Nov 2026)',
  $a$if v_held then$a$,
  $b$-- WALLET EDGES closure 2 (CEO, 3 Nov 2026): a wallet is never lost by closing. A top-up still waiting for proof is cancelled (nothing was paid); the balance, an open
  -- payout request and a bank transfer already sent stay exactly as they are, and the finance admins are told so the money is returned by hand.
  update public.wallet_topups set status = 'cancelled', updated_at = now() where profile_id = p_profile and status = 'awaiting_proof';
  declare
    v_w jsonb := public.closure_wallet_summary(p_profile);
  begin
    if v_w is not null then
      perform public.wallet_notify_finance('closure_wallet_money', 'A closed account still has money in its wallet',
        format('Closure %s: the wallet holds R%s available and R%s on hold (R%s of it in an open payout request), and R%s in bank transfers is not confirmed yet. Nothing was deleted. Return the money by hand: Payments, Wallets, Closed accounts with money.',
               v_id, v_w ->> 'available_rand', v_w ->> 'held_rand', v_w ->> 'open_payout_rand', v_w ->> 'unconfirmed_rand'));
    end if;
  end;
  if v_held then$b$);

-- closure_delete_money (day 30 and the daily retry): bank details and proof files go only when no money is owed; until then the closure stays open
-- (payout_kept) and the day-90 alert fires as for any closure that cannot finish.
select pg_temp.edge_patch('public.closure_delete_money(uuid)'::regprocedure, 'WALLET EDGES delete money 1 (CEO, 3 Nov 2026)',
  $a$if not exists (select 1 from public.payouts po where po.tutor_id = p and po.status in ('pending', 'processing', 'failed'))$a$,
  $b$perform public.closure_wallet_cleanup(c.id, p);  -- WALLET EDGES delete money 1 (CEO, 3 Nov 2026)
  if not exists (select 1 from public.payouts po where po.tutor_id = p and po.status in ('pending', 'processing', 'failed'))$b$);
select pg_temp.edge_patch('public.closure_delete_money(uuid)'::regprocedure, 'WALLET EDGES delete money 2 (CEO, 3 Nov 2026)',
  $a$payout_kept = exists (select 1 from public.tutor_payout_accounts a where a.tutor_id = p)$a$,
  $b$payout_kept = exists (select 1 from public.tutor_payout_accounts a where a.tutor_id = p) or public.closure_wallet_owes(p) /* WALLET EDGES delete money 2 (CEO, 3 Nov 2026) */$b$);

-- retention: wallet requests are settled money records (allow-list); the tombstone stays while any wallet record or proof file does; the daily job
-- runs the new category.
select pg_temp.edge_patch('public.retention_due_requests()'::regprocedure, 'WALLET EDGES retention requests (CEO, 3 Nov 2026)',
  $a$'failed', 'free'];$a$,
  $b$'failed', 'free', 'wallet_paid', 'wallet_refunded'];  -- WALLET EDGES retention requests (CEO, 3 Nov 2026)$b$);
select pg_temp.edge_patch('public.retention_has_kept_records(uuid)'::regprocedure, 'WALLET EDGES kept records 1 (CEO, 3 Nov 2026)',
  $a$or exists (select 1 from public.payouts po where po.tutor_id = p_profile)$a$,
  $b$or exists (select 1 from public.payouts po where po.tutor_id = p_profile)
      or exists (select 1 from public.wallets w where w.profile_id = p_profile) /* WALLET EDGES kept records 1 (CEO, 3 Nov 2026) */
      or exists (select 1 from public.wallet_ledger l where l.profile_id = p_profile)
      or exists (select 1 from public.wallet_topups wt where wt.profile_id = p_profile)
      or exists (select 1 from public.payout_requests pr where pr.tutor_id = p_profile)
      or exists (select 1 from public.tutor_bank_details tb where tb.tutor_id = p_profile)$b$);
select pg_temp.edge_patch('public.retention_has_kept_records(uuid)'::regprocedure, 'WALLET EDGES kept records 2 (CEO, 3 Nov 2026)',
  $a$f.bucket_id in ('tutor-documents', 'school-results')$a$,
  $b$f.bucket_id in ('tutor-documents', 'school-results', 'payment-proofs') /* WALLET EDGES kept records 2 (CEO, 3 Nov 2026) */$b$);
select pg_temp.edge_patch('public.run_retention_jobs()'::regprocedure, 'WALLET EDGES retention jobs 1 (CEO, 3 Nov 2026)',
  $a$array['tutor_documents', 'consent_records', 'problem_reports', 'money_records', 'tombstones']$a$,
  $b$array['tutor_documents', 'consent_records', 'problem_reports', 'money_records', 'wallet_records', 'tombstones'] /* WALLET EDGES retention jobs 1 (CEO, 3 Nov 2026) */$b$);
select pg_temp.edge_patch('public.run_retention_jobs()'::regprocedure, 'WALLET EDGES retention jobs 2 (CEO, 3 Nov 2026)',
  $a$when 'money_records' then public.retention_run_money_records()$a$,
  $b$when 'money_records' then public.retention_run_money_records()
             when 'wallet_records' then public.retention_run_wallet_records() /* WALLET EDGES retention jobs 2 (CEO, 3 Nov 2026) */$b$);
select pg_temp.edge_patch('public.run_retention_jobs()'::regprocedure, ' of 6 categories failed',
  $a$ of 5 categories failed$a$,
  $b$ of 6 categories failed$b$);

-- 7. the daily proof clean-up job ----------------------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('wallet-delete-proofs') where exists (select 1 from cron.job where jobname = 'wallet-delete-proofs');
    perform cron.schedule('wallet-delete-proofs', '55 3 * * *', 'select public.wallet_delete_old_proofs();');
  end if;
end $$;
