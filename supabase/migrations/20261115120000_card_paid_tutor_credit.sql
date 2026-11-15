-- CARD-PAID TUTOR CREDIT (CEO, 15 Nov 2026): when a session paid by CARD (Paystack) is completed, the tutor's share goes into their wallet at once,
-- exactly like a wallet-paid session: one 'session_credit' line, key 'credit:<session>', the same "Money added to your wallet" notification.
--
-- What was wrong: wallet_credit_tutor() only handled wallet-paid sessions, AND its trigger fired only `when new.wallet_paid`, so a card-paid completion
-- never reached it at all (no credit and not even a finance alert). The demo tutor stayed at R20 after a card-paid R35 session.
--
-- What changes (database only; old code keeps working: no table, column or function signature the app reads is touched):
--   1. wallet_credit_card_session(session) (new, no one may call it but the trigger and this migration): credits the tutor's share when the CARD payment is proven:
--        the request that made the session is not a wallet payment, payment_status 'paid', has a Paystack/charge reference, no refund requested or made,
--        charged_amount > 0 and equal to the session's gross_amount, and tutor_payout_amount = charged_amount - commission_amount
--        (minus the Paystack fee when the fee is charged to the tutor's subaccount, as finalize_session_charge() worked it out); the share is whole rand
--        (the wallet ledger is whole rand; a share with cents is refused, never rounded). Anything else RAISES; the caller alerts finance and credits nothing.
--   2. wallet_credit_tutor() (replaced in full, wallet path and tutor-bonus block word for word as on production): wallet-paid sessions as before; every other
--        completed session that is not free goes through the card helper; failure alerts finance and never blocks the completion. A free session (no
--        charge, nothing owed) is ignored quietly.
--   3. the trigger no longer requires new.wallet_paid (it still fires only on the change to 'completed').
--   4. one-off backfill: every completed, non-wallet, non-free session with no 'credit:<session>' line is put through the same helper (the demo session
--        b536fa81-49bd-4449-ab9b-b2fb442e9756 is the one that exists today). Unproven ones are skipped and reported as a notice. Safe to run twice.
-- Books: card money never passes through a learner wallet, so there is no 'topup'/'charge' line for it. The ledger shows only the tutor's share as
-- owed (+R on the tutor wallet, so wallet_totals total_rand and tutor_wallets_rand rise by that share); the card receipt and the platform's commission
-- stay on session_requests (charged_amount, commission_amount, paystack_fee). held_for_others/booking totals count wallet_paid sessions only, so they do not move.

create or replace function public.wallet_credit_card_session(p_session uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sessions;
  r public.session_requests;
  v_expected numeric;
  v_share integer;
begin
  select * into s from public.sessions where id = p_session;
  if not found or s.status <> 'completed' or coalesce(s.wallet_paid, false) then
    raise exception 'not a completed card-paid session';
  end if;
  if exists (select 1 from public.wallet_ledger where idempotency_key = 'credit:' || p_session) then
    return 0;   -- already credited
  end if;
  select * into r from public.session_requests
   where resulting_session_id = p_session and not coalesce(paid_from_wallet, false) and payment_status = 'paid';
  if not found then
    raise exception 'no paid card request for this session';
  end if;
  if coalesce(r.paystack_reference, r.charge_reference) is null then
    raise exception 'the request has no Paystack reference';
  end if;
  if r.refunded_at is not null or r.paystack_refund_id is not null or r.refund_requested_at is not null or r.refund_request_id is not null then
    raise exception 'the card payment was refunded or a refund is under way';
  end if;
  if coalesce(r.charged_amount, 0) <= 0 or s.gross_amount is distinct from r.charged_amount then
    raise exception 'the amount charged does not match the session (charged %, session %)', r.charged_amount, s.gross_amount;
  end if;
  v_expected := r.charged_amount - coalesce(r.commission_amount, 0)
                - case when r.fee_bearer = 'subaccount' then coalesce(r.paystack_fee, 0) else 0 end;   -- the same sum as finalize_session_charge()
  if s.tutor_payout_amount is distinct from v_expected or v_expected < 0 then
    raise exception 'the stored split does not add up (payout %, expected %)', s.tutor_payout_amount, v_expected;
  end if;
  if v_expected <> round(v_expected) then
    raise exception 'the tutor share R% has cents; the wallet holds whole rand', v_expected;
  end if;
  v_share := v_expected::integer;
  if v_share > 0 then
    perform public.wallet_post(s.tutor_id, 'session_credit', v_share, 0, 'credit:' || p_session, null, 'Session completed (card payment)', r.id, p_session);
    perform public.wallet_notify(s.tutor_id, 'wallet_session_credit', 'Money added to your wallet',
      format('R%s for a completed session was added to your wallet.', v_share));
  end if;
  return v_share;
end;
$$;
revoke all on function public.wallet_credit_card_session(uuid) from public, anon, authenticated, service_role;

create or replace function public.wallet_credit_tutor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.session_requests;
  v_share integer;
begin
  if exists (select 1 from public.wallet_ledger where idempotency_key = 'credit:' || new.id) then
    return new;
  end if;
  begin
    if not coalesce(new.wallet_paid, false) then
      -- CARD-PAID TUTOR CREDIT (CEO, 15 Nov 2026): a free session owes the tutor nothing here; anything else must prove a card payment
      if not (coalesce(new.free_session, false) or coalesce(new.gross_amount, 0) = 0) then
        perform public.wallet_credit_card_session(new.id);
      end if;
    else
      select * into r from public.session_requests where resulting_session_id = new.id and paid_from_wallet and payment_status = 'wallet_paid';
      if not found
         or not exists (select 1 from public.wallet_ledger where idempotency_key = 'charge:' || r.id)
         or new.tutor_payout_amount is distinct from (r.wallet_hold_rand + coalesce(r.promo_discount_rand, 0) - r.commission_amount /* PROMO CODES credit (CEO, 5 Nov 2026) */) then
        raise exception 'no matching wallet payment for this session';
      end if;
      v_share := new.tutor_payout_amount::integer;
      if v_share > 0 then
        perform public.wallet_post(new.tutor_id, 'session_credit', v_share, 0, 'credit:' || new.id, null, 'Session completed', r.id, new.id);
        perform public.wallet_notify(new.tutor_id, 'wallet_session_credit', 'Money added to your wallet',
          format('R%s for a completed session was added to your wallet.', v_share));
      end if;
    end if;
  exception when others then
    perform public.wallet_notify_finance('wallet_credit_failed', 'A tutor credit did not go through',
      format('Session %s was completed but the tutor could not be credited: %s', new.id, sqlerrm));
  end;
  -- TUTOR BONUS credit (CEO, 10 Nov 2026): the code owner's referral bonus, in a block of its own so a problem here can never touch the tutor's credit above
  begin
    perform public.tutor_bonus_pay(new.id);
  exception when others then
    perform public.wallet_notify_finance('tutor_bonus_failed', 'A tutor bonus did not go through',
      format('Session %s was completed but its referral bonus could not be paid: %s', new.id, sqlerrm));
  end;
  return new;
end;
$$;
revoke all on function public.wallet_credit_tutor() from public, anon, authenticated, service_role;

drop trigger if exists wallet_credit_tutor on public.sessions;
create trigger wallet_credit_tutor after update of status on public.sessions
  for each row when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function public.wallet_credit_tutor();

-- one-off backfill: completed card-paid sessions that were never credited (guarded by the proof and by the idempotency key, so a re-run changes nothing)
do $bf$
declare
  x record;
  v integer;
begin
  for x in
    select s.id from public.sessions s
    where s.status = 'completed' and not coalesce(s.wallet_paid, false) and not coalesce(s.free_session, false) and coalesce(s.gross_amount, 0) > 0
      and not exists (select 1 from public.wallet_ledger l where l.idempotency_key = 'credit:' || s.id)
  loop
    begin
      v := public.wallet_credit_card_session(x.id);
      raise notice 'card credit backfill: session % credited R%', x.id, v;
    exception when others then
      raise notice 'card credit backfill: session % skipped (%)', x.id, sqlerrm;
    end;
  end loop;
end
$bf$;
