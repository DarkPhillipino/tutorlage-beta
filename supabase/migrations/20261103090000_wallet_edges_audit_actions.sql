-- Wallet edge cases (phase 6 of the wallet + manual bank transfer work, CEO's design of 2 Nov 2026): two new audit labels.
-- Apply this file FIRST, on its own, and let it commit: Postgres cannot use an enum value in the same transaction that added it, so the
-- functions in 20261103100000_wallet_edges.sql can only write these audit rows once this has been committed (same reason as 20261102200000).
-- Additive only: two new values, nothing else changes.
alter type public.audit_action add value if not exists 'wallet_refunded_to_learner';
alter type public.audit_action add value if not exists 'wallet_money_returned';
