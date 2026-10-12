-- 2026-10-09, written for phase 2; NOT applied (CEO, 9 Oct: no database changes until Mon 12 Oct).
-- Apply this file first, on its own: Postgres can't use an enum value in the same transaction that
-- added it, so the functions in 20261012090100 (school results) and 20261012090200 (Tier 1) can only
-- write these audit rows once this has been committed.
alter type public.audit_action add value if not exists 'school_result_checked';
alter type public.audit_action add value if not exists 'tier1_record_checked';
alter type public.audit_action add value if not exists 'tier1_training_signed_off';
