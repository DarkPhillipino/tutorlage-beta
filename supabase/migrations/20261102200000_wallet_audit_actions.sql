-- Wallet audit actions (phase 1 of the wallet + manual bank transfer work, CEO's design of 2 Nov 2026).
-- Apply this file FIRST, on its own, and let it commit: Postgres cannot use an enum value in the same transaction that added it, so the
-- functions in 20261102200100_wallet_core.sql can only write these audit rows once this has been committed (the same reason
-- 20261012090000 was its own file). Additive only: six new values, nothing else changes.
alter type public.audit_action add value if not exists 'wallet_topup_successful';
alter type public.audit_action add value if not exists 'wallet_topup_unsuccessful';
alter type public.audit_action add value if not exists 'wallet_payout_paid';
alter type public.audit_action add value if not exists 'wallet_payout_cannot_pay';
alter type public.audit_action add value if not exists 'wallet_bank_details_opened';
alter type public.audit_action add value if not exists 'wallet_adjusted';
