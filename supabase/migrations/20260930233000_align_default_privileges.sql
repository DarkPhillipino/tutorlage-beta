-- 2026-09-30 (third session). Found by comparing production's grants with dev's after the five
-- 30 Sep migrations were applied to production. The rolled-back test suites could not be run on
-- production without the CEO's approval, so the two databases were compared read-only instead:
-- every function, policy, trigger and profiles column grant from the 30 Sep work is identical on
-- both. The one real difference is below.
--
-- Production's default privileges for objects `postgres` creates in `public` are Supabase's stock
-- ones: every new table gets SELECT/INSERT/UPDATE/DELETE for anon and authenticated, every new
-- function gets EXECUTE for anon and authenticated, and every new sequence gets USAGE/SELECT/UPDATE.
-- Dev's were tightened earlier: new tables, functions and sequences get nothing for anon or
-- authenticated until a migration grants it. So a migration that forgets a revoke is closed on dev,
-- where the tests run, and open on production.
--
-- That already happened once. 20260930150000 grants anon only SELECT on credential_definitions and
-- nothing on tutor_credentials, but production gave anon full read/write on both. Row-level security
-- still blocked it (every write policy on both tables requires is_active_admin(), and
-- tutor_credentials' read policy requires auth.uid() = tutor_id), so nothing was exposed. But RLS was
-- the only barrier.
--
-- On dev this migration changes nothing, because dev already has exactly this state. service_role
-- keeps production's defaults: the server needs them and the secret key never reaches a browser.

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select, update on sequences from anon, authenticated;

revoke insert, update, delete on public.credential_definitions from anon;
revoke select, insert, update, delete on public.tutor_credentials from anon;
