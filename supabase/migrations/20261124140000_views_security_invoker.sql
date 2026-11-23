-- 2026-11-24, JOB U1 (PM line 56): SUP-VIEW-01. The two founding views founding_tutor_facts and founding_person_steps (schema public) were created without security_invoker. Nothing was exposed:
-- they are owned by postgres and no API role (anon, authenticated, service_role) has any right on them. Every reader of them is a SECURITY DEFINER function owned by postgres
-- (founding_release_rate, admin_founding_triggers, admin_founding_steps, admin_founding_waves, admin_founding_pipeline, admin_founding_suggestion), so with the option on they read the underlying
-- tables as the owner exactly as before. ADDITIVE and tiny; rights unchanged. Rollback: Drake/programmer/rollbacks/20261124140000_views_security_invoker_ROLLBACK.sql. Test: supabase/tests/views_security_invoker.sql.
alter view public.founding_tutor_facts set (security_invoker = true);
alter view public.founding_person_steps set (security_invoker = true);
