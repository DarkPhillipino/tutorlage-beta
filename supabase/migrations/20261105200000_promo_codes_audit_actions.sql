-- Promo code audit actions (CEO's decision of 5 Nov 2026: 10 percent off the first 3 lessons, by code; plan Drake/project-manager/tutor-recruitment-plan-2026-11-04.md 8.2).
-- Apply this file FIRST, on its own, and let it commit: Postgres cannot use an enum value in the same transaction that added it, so the admin functions in
-- 20261105200100_promo_codes.sql can only write these audit rows once this has been committed (the same reason 20261102200000 was its own file).
-- Additive only: three new values, nothing else changes.
alter type public.audit_action add value if not exists 'promo_code_created';
alter type public.audit_action add value if not exists 'promo_code_changed';
alter type public.audit_action add value if not exists 'promo_code_attached';
