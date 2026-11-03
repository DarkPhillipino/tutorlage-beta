-- Temporary review logins (for Paystack's reviewers, CEO's request of 3 Nov 2026): two new audit labels.
-- Apply this file FIRST, on its own, and let it commit: Postgres cannot use an enum value in the same transaction that added it, so the
-- function in 20261103120100_review_accounts.sql can only write these audit rows once this has been committed (same reason as 20261102200000).
-- Additive only: two new values, nothing else changes.
alter type public.audit_action add value if not exists 'review_account_deleted';
alter type public.audit_action add value if not exists 'review_account_kept';
