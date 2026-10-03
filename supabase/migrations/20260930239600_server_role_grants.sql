-- 2026-09-30 (fourth session). What server/index.ts reads with the service-role key, granted explicitly.
--
-- Found while building 7a: on DEV the service role could not read profiles, tutor_profiles or
-- system_settings, or call current_policy_versions() — dev grants nothing by default, and nothing had
-- granted these. So POST /api/guardian/learners (backlog 7k) failed at its first step on dev ("Could
-- not check the current consent wording") and would have failed the CEO's planned walkthrough on the
-- local app. PRODUCTION already allows all of this (service_role keeps Supabase's broader defaults
-- there — see 20260930233000), so this migration changes nothing on production; it makes dev behave
-- like production for the server, and states in one place what the server actually needs.
--
-- Checked 2026-09-30 with has_table_privilege / has_function_privilege: dev false for all five below,
-- production true for all five.

grant execute on function public.current_policy_versions() to service_role;   -- guardian add-learner
grant select (id, role, date_of_birth) on public.profiles to service_role;       -- guardian add-learner
grant select (id, is_verified) on public.tutor_profiles to service_role;         -- 7a: payout account is for tutors only
grant select on public.system_settings to service_role;                          -- 7a: card-check amount
