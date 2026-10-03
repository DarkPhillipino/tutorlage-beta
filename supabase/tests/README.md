# Database tests (rolled back)

Each `.sql` file here is one `do $$ … $$` block that creates throwaway users, acts as them
(`set local role authenticated` + `request.jwt.claims`), records every result in a text variable, and
ends with `raise exception` — so **nothing it creates is kept**, and the error message *is* the report.
Run a file with the Supabase MCP `execute_sql` tool (or the SQL editor) against dev first, then
production after a migration is applied there. Every line should read `ok`; any `FAIL` is a real bug.

Expected refusals print their `sqlerrm`, so a check that "passes" for the wrong reason (a syntax or
permission error instead of the intended rule) is visible.

**Running a test on production needs the CEO's explicit go-ahead**, even though it's rolled back: the
automatic permission check treats inserting throwaway rows into production as changing a shared
resource. Ask first; don't look for a way around the refusal.

Run them in this order after applying migrations `20260930190000`–`20260930239600`:

| File | Checks | Covers |
|---|---|---|
| `7k_signup_trigger.sql` | 12 | Signup trigger: admin-role metadata, 18+ rules, guardian-created learners, acceptance records |
| `7k_access_rules.sql` | 28 | Who can book for whom, links, date-of-birth privacy, consent withdrawal, tutor verification age check |
| `7k_role_choice.sql` | 8 | Google sign-up role switch; document versions readable before sign-in |
| `7l_admin_date_of_birth.sql` | 3 | Admin records a date of birth (audited), then verification works |
| `7o_profile_privacy.sql` | 10 | Who can see which profiles; email/phone hidden; admin-only search |
| `7p_legacy_function_lockdown.sql` | 3 | Legacy functions refused to clients; signup trigger still fires |
| `7k_google_names.sql` | 6 | Names from Google's `full_name` at sign-up and through the role switch (`20260930236000`) |
| `7k_guardian_phone.sql` | 9 | A linked guardian needs a phone on file to book; the session's tutor (only) sees their name and phone; strangers are still refused by the booking rule (`20260930237000`) |
| `anon_public_reads.sql` | 7 | Signed-out visitors can read every public table (filtered reads, as the app does) and see only verified tutors, and can't call `is_active_admin()`; learners, guardians and admins still see what they should (`20260930234000`, `20260930235000`) |
| `7z_refund_status.sql` | 16 | A refund is `refund_queued` until Paystack says *processed*; failed / needs-attention / no-reply states reach admins; the learner and booking guardian are told when it's processed; the status-check job asks `GET /refund/:id`; learners can read their refund status but can't run the jobs (`20260930238000`, re-run after `239500`) |
| `7u_auto_complete_and_reports.sql` | 20 | Sessions complete 48 hours after their end (a setting) unless a report is open; learner, booking guardian and tutor can report a problem, strangers and signed-out callers can't, and nobody can insert a dispute directly (`20260930239000`) |
| `7a_split_payments.sql` | 38 | The R1 card check saves a card (authorization code unreadable by browsers); tutors can't write their own payout row or accept from the browser; the server's claim → charge → finalize / release path, commission and fee bearer, legacy paid requests, cancellations refunding the charge, unmatched requests expiring uncharged, the recovery job for stuck charges, and the refund webhook (`20260930239500`) |

Paystack's replies are faked inside the transaction for `7z` and `7a` (rows in `net._http_response` with
ids far above anything pg_net has issued); anything those suites enqueue with pg_net is rolled back
with them, so no request is ever sent.

Results:
- The first six (64 checks) passed on dev on 2026-09-30, and on **production** on 2026-09-30 (third
  session, with the CEO's approval). Production still had zero accounts afterwards, and its refund
  cron jobs still succeeded.
- After `20260930234000` and `20260930235000` went onto dev, `anon_public_reads.sql` (7/7) and a re-run
  of `7k_access_rules.sql` (28/28), `7l_admin_date_of_birth.sql` (3/3) and `7o_profile_privacy.sql`
  (10/10) passed on dev. Production: waiting for the CEO's approval to apply those two migrations; then
  run `anon_public_reads.sql` there. **Until then, a signed-out read of `tutor_profiles` fails on
  production** (see the header of `20260930235000`).
- `7k_google_names.sql` (6/6) and `7k_guardian_phone.sql` (9/9) passed on dev on 2026-09-30, with
  `7k_signup_trigger.sql` (12/12) and the updated `7k_access_rules.sql` (28/28 — its guardian now has a
  phone, which `20260930237000` requires) re-run. Production: waiting for the CEO's approval of
  `236000`/`237000`.
- Fourth 30 Sep session, on dev: `7z_refund_status.sql` 16/16 (and again 16/16 after `239500` rewrote
  `reconcile_pending_refunds`), `7u_auto_complete_and_reports.sql` 20/20, `7a_split_payments.sql`
  38/38. 7z was also run live once: a temporary dev request pointed at a real, already-processed
  Paystack **test** refund went `refund_queued` → `refunded` through the real pg_net call, with
  Paystack's own `refunded_at`; the temporary rows were deleted and the table count checked back to 0.
- **Production, as of the end of the fourth session: still at `20260930233000`.** The CEO approved
  applying `234000`–`237000` and running their tests there ("Yes, apply and test"), but the automatic
  permission check refused the first `apply_migration` on production ("Production Deploy") anyway, so
  nothing was applied. Production now needs, in order: `234000`, `235000`, `236000`, `237000`,
  `238000`, `239000`, `239500`, `239600` — then every suite above that isn't yet run there, then
  `compare_dev_prod.sql` on both.

- **Production, 2026-10-01 (fifth session): all eight applied** (`234000`–`239600`, one record each),
  with the CEO's go-ahead. Every suite above ran on production: **155/160 ok**. The five that don't
  pass are the missing Paystack key in production's Vault, not bugs: `7z` Z10/Z10b (the status check
  skips without the key) and `7a` A25/A29/A33 (cancelling refuses with "Refunds aren't set up on this
  server yet", so there's no refund to re-check or match). `7a_split_payments.sql` now catches that
  refusal so the suite still reports. Re-run those two suites on production once the key is in the
  Vault. Production still had 0 accounts afterwards.

## Comparing dev and production

`compare_dev_prod.sql` is read-only: it fingerprints functions, execute rights, policies, grants,
triggers and default privileges. Run it on both projects and compare. Where the hashes match, a test
that passed on dev proves the same thing on production. It needs no approval. Known, accepted
differences are listed at the top of the file.
