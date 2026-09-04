# Identity

You are helping Pakiso with developing a webapp.

## Rules

- Write in plain, clear language
- Ask clarifying questions before making assumptions
- When you are unsure, say so

# Tutorlage

Web interface for the Tutorlage tutoring platform (React + Vite + Tailwind, with a planned Express/Gemini backend and a Supabase database — Supabase is now connected from the frontend; a service-role backend connection is planned for when `server/` gets built).

## Folder structure

- `src/` — frontend workspace (built, in active use). Includes `src/lib/supabaseClient.ts`, the Supabase client (publishable key, RLS-enforced); `src/lib/AuthContext.tsx`, real Supabase Auth session state; `src/pages/` (`Login.tsx`, `SignIn.tsx`, `CreateAccount.tsx`), the auth flow.
- `server/` — backend/AI integration workspace (planned, not yet built). Will hold the service-role Supabase connection for privileged operations.
- `admin/` — Tutorlage Admin (built, 2026-09-03). A deliberately **separate** app (own `package.json`, own Vite dev server on port 3100), not a route inside the main app — so admin code/dependencies never ship in the public bundle. Same Supabase project as `src/`, same publishable key — admin access is enforced entirely by RLS (`admin_profiles.is_active`), not a different key. Intended to be reachable only over a private network (e.g. Tailscale), never the public internet — that network-level setup is outside what gets configured here. See `admin/CONTEXT.md`.

**Beta status (2026-08-31): real auth is live and the whole app is gated behind it.** `src/main.tsx` wraps everything in `react-router-dom` + `AuthProvider`; `/login`, `/signin/:role`, `/signup/:role` are public, everything else is wrapped in `RequireAuth` (redirects to `/login` if no session). Signing up calls `supabase.auth.signUp()` with `first_name`/`surname`/`phone_number`/`role` in `options.data` — a DB trigger (`on_auth_user_created` → `handle_new_user_role_expansion()`) reads that metadata and creates the matching `profiles` + `tutor_profiles`/`student_profiles` rows automatically; the client never inserts those rows itself. `App.tsx`'s `TeachGoScreen`/`ManageAccountModal` now use the real signed-in user's id (`useAuth().user.id`), not the old "first tutor in the DB" placeholder.

**Bug found + fixed while testing this:** `handle_new_user_role_expansion()` cast to a bare `user_role` enum, which fails with `type "user_role" does not exist` (42704) because triggers on `auth.users` don't run with `public` on their search path. Fixed via migration: schema-qualified the casts (`public.user_role`) and pinned `SET search_path = public` on the function itself. If any other `SECURITY DEFINER` trigger function gets added later, give it the same `search_path` treatment up front.

**Known beta-launch blocker (not code, can't fix from here):** this project's Supabase Auth is still on the default sandbox mailer, which has a very low send-rate limit — real signups will hit `email rate limit exceeded` past the first couple of confirmation emails. Before inviting real users, configure a custom SMTP provider in Supabase Dashboard → Authentication → Email, or the beta will effectively lock out most new signups.

**Major bug found + fixed building the admin app (2026-09-03): the entire admin RLS subsystem was non-functional.** Every "Admins manage X" policy checked admin status via `EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid() AND is_active)` inline — that subquery re-triggers `admin_profiles`'s own identical policy, which does the same subquery again, causing infinite recursion (Postgres `42P17`) on *every* admin-gated table, not just `admin_profiles`. This means no admin action could have ever worked, on any table, before this fix — it was never actually tested end-to-end. Fixed with the standard pattern: a `SECURITY DEFINER` function `public.is_active_admin()` that checks admin status with elevated privilege (bypassing RLS for that one internal lookup), used in every admin policy instead of the inline subquery. Also found and fixed: `admin_audit_logs` had a read policy but no insert policy at all — no admin action could log itself either. **If you add a new admin-gated table/policy, use `public.is_active_admin()` in the `USING`/`WITH CHECK` clause — never a raw subquery on `admin_profiles`.**

## Routing table

| Task                                                       | Go to     | Read                |
| ------------------------------------------------------------ | --------- | ------------------- |
| UI, components, modals, styling, layout                      | `src/`    | `src/CONTEXT.md`    |
| Supabase reads/writes under RLS (profiles, tutors, institutions, etc.) | `src/`    | `src/CONTEXT.md`    |
| Admin screens (verification, disputes, payouts, settings, audit log) | `admin/`  | `admin/CONTEXT.md`  |
| Gemini API calls, server endpoints, env/secrets, service-role Supabase access | `server/` | `server/CONTEXT.md` |

## Naming conventions

- Component files: `PascalCase.tsx` in `src/components/`
- Shared types: `src/types.ts`
- Data-access functions (Supabase queries): `src/lib/queries.ts`
- Client libraries (e.g. Supabase client init): `src/lib/`
- Backend files: `server/`

There's no mock data in this project anymore — `src/data/mockData.ts` was deleted once the UI moved to live Supabase reads. Don't reintroduce a mock-data file; if a table is empty, build against the real empty state (loading/empty UI), not fake rows.

## Supabase database routing table

> **Note! Only look at this section when a task actually requires database/schema knowledge** — writing a query, adding a table, debugging RLS/access. Skip it otherwise; it's a reference index to save re-querying the live schema, not background for every task.

Project: `wfpjoxetbprmllqqarwp` (`DarkPhillipino's Project`, eu-west-1). Every table has RLS enabled — but RLS alone doesn't grant access, Postgres also needs a base `GRANT` (see the gotcha in `src/CONTEXT.md`). Access legend below reflects the **actual current state of both**, not just RLS intent:

- 🌐 **Public** — anon/authenticated have the GRANT *and* a public (`qual: true`) RLS policy. Safe to query directly from `src/` today (all 8 of these are already used in `src/lib/queries.ts`).
- 🔒 **Owner-only** — RLS restricts rows to `auth.uid()` (the record's own user). Unreadable/unwritable by the anon client until real tutor/student auth exists — don't try to "fix" this with a public GRANT, it would defeat the policy's intent.
- 🔐 **Admin-only** — no self-service policy at all; only a service-role/admin path can touch it (not yet built, see `server/CONTEXT.md`).
- ⚠️ **Misconfigured** — has a public RLS policy but is missing the GRANT, so it currently 401s despite looking public. Fix with the same `GRANT SELECT ... TO anon, authenticated` pattern before using.

Row counts are as of 2026-08-31 (near-empty dev DB) and will drift — treat them as "which tables have real seed data right now," not a permanent fact.

**Identity & Roles**

| Table | Purpose | Access | Key relations | Rows |
|---|---|---|---|---|
| `profiles` | Central user record — `id` = `auth.users.id`, `role` enum (student/parent/tutor/admin), name/email/avatar | 🌐 | root of `tutor_profiles`/`student_profiles`/`parent_profiles`/`admin_profiles` (1:1 via shared `id`) | 1 |
| `tutor_profiles` | A tutor's business profile: rate, tier, dispatch status, stats (hours/rating/reviews/repeat-rate/grade-uplift), onboarding status | 🌐 (verified tutors + self) | → `profiles(id)`, → `tier_definitions(current_tier_id)`, → `sub_tier_definitions(current_sub_tier_id)` | 1 |
| `student_profiles` | Student-specific fields | 🔒 | → `profiles(id)`, `school_id` → `schools_institutions` | 1 |
| `parent_profiles` | Parent-specific fields | 🔒 | → `profiles(id)` | 0 |
| `parent_student_links` | Which parent can book for which student | 🔒 | → `parent_profiles`, → `student_profiles` | 0 |
| `admin_profiles` | Platform admin accounts | 🔒 | → `profiles(id)` | 1 |

**Institutions**

| Table | Purpose | Access | Key relations | Rows |
|---|---|---|---|---|
| `schools_institutions` | Schools/campuses — name, curriculum, institution type, plus `emis_number`/`province`/`town_city`/`latitude`/`longitude` (added 2026-09-02 for the K-12 import, nullable — not set for universities/TVET). Fully seeded: 26 public universities + 50 public TVET colleges + all 25,490 "Open" K-12 schools from the DBE EMIS Master List of Schools 2023 Q3 (real government data, imported via the Supabase REST API with the service-role key — not via chat-relayed SQL, to avoid burning context on ~12MB of data). `institution_type` ∈ `university`/`tvet_college`/`public_school`/`independent_school`; `curriculum` for K-12 rows is `primary_caps` (pre-primary/primary/intermediate phase) or `caps` (everything else) — the source data has no IEB/Cambridge signal, so nothing was guessed there | 🌐 | referenced by `student_profiles.school_id`, `student_subject_enrollments.school_id` | 25,566 |
| `subjects` | Reference list of subject names (autocomplete/validation) — free-standing, not yet FK'd from `tutor_subject_competencies`/`student_subject_enrollments` (those still store free-text `subject_name`). Seeded 2026-09-02 with the official CAPS/NSC subject list (all 11 official languages × Home/First-Additional, common foreign languages, and all non-language subjects) | 🌐 | none yet — see note above | 59 |

**Tutor Profile & Pricing**

| Table | Purpose | Access | Key relations | Rows |
|---|---|---|---|---|
| `tutor_subject_competencies` | Subjects + grade-level range a tutor teaches | 🌐 (verified only) | → `tutor_profiles` | 0 |
| `tutor_availability` | A tutor's recurring weekly time slots | 🌐 | → `tutor_profiles` | 0 |
| `tutor_languages` | Which language(s) a tutor teaches *in* (not a subject — see `subjects` for language-as-subject) | 🌐 read, owner write | → `tutor_profiles`, → `languages` | 0 |
| `tutor_certifications` | Pass/fail cert exam records | 🔒 | → `tutor_profiles` | 0 |
| `tier_definitions` | The 4 student-facing pricing tiers (name, quote, rate range, commission %) — see `TierSelectionPage.tsx`. Now has `currency_code` (defaults `ZAR` for all existing rows) — still one global set of bands, not per-currency yet | 🌐 | referenced by `tutor_profiles.current_tier_id`, → `currencies` | 4 |
| `sub_tier_definitions` | Progression thresholds (A-D) a tutor climbs within a tier — see `TeachGoScreen.tsx`'s progress bar | 🌐 | → `tier_definitions` | 16 |

**Internationalization (2026-09-03)** — new reference tables, not yet consumed by the frontend (UI is still ZAR/South-Africa-only; these exist so the schema is ready when that build happens)

| Table | Purpose | Access | Key relations | Rows |
|---|---|---|---|---|
| `countries` | ISO 3166-1 alpha-2 code, name, calling code, default currency. Starter set of 17 countries, not the full ISO list — deliberately, to avoid bulk-seeding ~195 rows from memory unverified (see the TVET-college lesson above) | 🌐 | → `currencies` (`default_currency_code`) | 17 |
| `currencies` | ISO 4217 code, name, symbol, decimal digits. Starter set of 15 | 🌐 | referenced by `countries`, `tutor_profiles`, `sessions`, `tier_definitions`, `payouts`, `platform_disputes` | 15 |
| `languages` | ISO 639-1 code + name — the 11 SA official languages plus common international ones | 🌐 | referenced by `tutor_languages.language_code` | 19 |
| `curricula` | Replaces the old `schools_institutions.curriculum` enum (which was SA-only: `caps`/`ieb`/etc.) with a real, extensible table. The enum column is still there for backward compatibility — `curriculum_id` is the new parallel column, backfilled for all 25,566 existing rows | 🌐 | optionally → `countries` (null = international, e.g. IB/Cambridge) | 10 |

**Reviews & Reputation**

| Table | Purpose | Access | Key relations | Rows |
|---|---|---|---|---|
| `reviews` | Student rating/comment for a completed session | 🌐 read, write=student only | → `sessions`, → `tutor_profiles`, → `profiles` (student) | 0 |
| `tutor_progression_logs` | Audit trail of tier/sub-tier changes | 🔒 | → `tutor_profiles` | 0 |

**Verification & Payouts** (sensitive — all owner/admin-only, no public path). "Admin" access below now means `public.is_active_admin()` in the policy, not a raw subquery — see the RLS-recursion bug note above.

| Table | Purpose | Access | Key relations | Rows |
|---|---|---|---|---|
| `tutor_verification_documents` | Uploaded ID/qualification docs + review status. Now has an admin policy (added 2026-09-03, was missing) — reviewed from `admin/`'s Tutor Verification screen | 🔒 owner + admin | → `tutor_profiles` | 0 |
| `tutor_verification_audits` | Admin decisions on verification docs | 🔐 admin | → `tutor_verification_documents`, → `admin_profiles` | 0 |
| `tutor_payout_accounts` | Bank details (account number stored hashed) | 🔒 | → `tutor_profiles` | 0 |
| `payouts` | A payout run for one tutor over a period. Now has an admin policy (added 2026-09-03, was missing) — viewed read-only from `admin/`'s Payouts screen; no real payment processor wired up to actually run a batch yet | 🔒 owner + admin | → `tutor_profiles`, → `tutor_payout_accounts` | 0 |
| `payout_batches` | Admin-run batch payout jobs | 🔐 admin | → `admin_profiles` | 0 |
| `payout_sessions` | Join table: which sessions are covered by which payout | 🔒 | → `payouts`, → `sessions` | 0 |

**Bookings & Sessions**

| Table | Purpose | Access | Key relations | Rows |
|---|---|---|---|---|
| `session_requests` | A requested session before it's confirmed | 🔒 | → `profiles` (student), → `tutor_profiles`, → `student_subject_enrollments` | 0 |
| `sessions` | A confirmed/completed session — rate charged, commission, payout amount | 🔒 | → `profiles` (student), → `tutor_profiles`, → `student_subject_enrollments` | 0 |
| `student_subject_enrollments` | A student's enrollment in one subject at one school | 🔒 | → `student_profiles`, → `schools_institutions` | 0 |
| `student_subject_goals` | Target marks for an enrollment | 🔒 | → `student_subject_enrollments` | 0 |
| `student_academic_records` | Baseline/current scores and uplift tracking for a subject | 🔒 | → `profiles` (student), → `tutor_profiles`, → `student_subject_enrollments` | 0 |
| `academic_assessments_and_reports` | Individual assessment results tied to an enrollment | 🔒 | → `student_subject_enrollments` | 0 |
| `student_availability` | A student's weekly availability | 🔒 | → `student_profiles` | 0 |

**Messaging & Notifications**

| Table | Purpose | Access | Key relations | Rows |
|---|---|---|---|---|
| `conversations` | A student↔tutor thread, optionally tied to a session | 🔒 | → `profiles` (student), → `tutor_profiles`, → `sessions` | 0 |
| `messages` | Messages within a conversation | 🔒 | → `conversations`, → `profiles` (sender) | 0 |
| `notifications` | Per-profile notification feed | 🔒 | → `profiles`, → `sessions` | 0 |

**Admin & Platform Ops**

| Table | Purpose | Access | Key relations | Rows |
|---|---|---|---|---|
| `admin_audit_logs` | Audit trail of admin actions — every `admin/` mutation writes here via `logAdminAction()` | 🔐 admin read+insert (append-only: no update/delete policy) | → `admin_profiles` | 2 |
| `platform_disputes` | A dispute raised on a session, resolved from `admin/`'s Disputes screen | 🔒 owner (raise/view own) + 🔐 admin (full) | → `sessions`, → `profiles` (raised by), → `admin_profiles` (assigned), → `currencies` | 0 |
| `system_settings` | Key/value platform config (jsonb), managed from `admin/`'s System Settings screen | 🔐 admin (full) · public-read policy exists but `anon` still has no GRANT, so it 401s for anon specifically — only fix this if something actually needs anonymous access, `authenticated` admin access already works | → `admin_profiles` (`last_updated_by`) | 0 |

These files are living documents — update them as the project changes, don't let them go stale.
