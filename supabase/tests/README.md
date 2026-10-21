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
| `7a_no_self_match.sql` | 4 | A tutor account can insert a request for itself (API, no enrolment), but the server's claim refuses that tutor ("You can't accept your own request.") and still lets another tutor accept (`20261005200000`) |
| `tutor_onboarding.sql` | 31 | Tutor onboarding (master 7cx, `20261013180000` + `20261013180100`): a tutor picks beginner or experienced and records agreement only through two functions (the table can't be written directly; learners and signed-out callers refused; the consent time is the database's clock); tutors that existed before are grandfathered; a tutor can remove or replace an unverified document but **not** change, swap or delete a **verified** one (table and stored file), and adds a renewal alongside it; others can't touch or read them; admins read everything and can still review. Run **together with the migration in one rolled-back transaction** (as the file header says); the new enum value is checked separately after applying (last lines of the file). Storage deletes need `set_config('storage.allow_delete_query','true',true)` inside the test (Supabase refuses plain-SQL deletes otherwise) |

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
  **Done 20 Oct 2026** (key in the Vault, the CEO's yes): `7z_refund_status.sql` 16 of 16 and `7a_split_payments.sql` 38 checks (39 report
  lines, A5b is the extra), 0 FAIL, once each on production, rolled back; A25/A29/A33 and Z10/Z10b now pass. 7a was run with only its last
  statement printing each line without the "(want ...)" tail (the tool cuts a report longer than about 5 KB), the wants compared by hand.

- **Dev, 2026-10-05/06 (eighth session)**: `20261005200000_no_self_matching` applied with the CEO's go-ahead
  ("Fix and publish"); `7a_no_self_match.sql` 4/4. **Production: not yet** (at the cutover, with the CEO's
  go-ahead; then run this suite there and `compare_dev_prod.sql` on both).

## Comparing dev and production

`compare_dev_prod.sql` is read-only: it fingerprints functions, execute rights, policies, grants,
triggers and default privileges. Run it on both projects and compare. Where the hashes match, a test
that passed on dev proves the same thing on production. It needs no approval. Known, accepted
differences are listed at the top of the file.

## Phase 2 suites, tested before their migrations are applied (9 Oct 2026)

The CEO said on 9 Oct: no database changes until Mon 12 Oct. So the phase 2 migrations were tested by running
them **and** their test inside one `do` statement that always fails, so nothing is kept
(`scripts/run-rolled-back-test.mjs` builds that statement; paste it into `execute_sql`). Dev was checked
unchanged after each run (the new tables don't exist there).

| File | Checks | Covers | Result (dev, rolled back with its migration) |
|---|---|---|---|
| `school_results.sql` | 38 | Consent first; guardians and adult learners only; booked subjects only; file paths in the learner's folder; storage upload rights; pending and rejected results never count; admin-only checks with a reason for rejections; uplift per tutor after 3 sessions (50% → 65% = +15); tutors see the change, never the marks; delete and withdrawal remove results and progress; the 3rd-session prompt; the legacy assessments table closed (`20261012090100`) | 38/38 ok, 9 Oct |
| `tier1_pipeline.sql` | 41 | Tutors only; items and scenario answers unreadable; the three gates in order; Module 7's check needs 4/4; trainer sign-offs by admins only, "not yet" needs the missing items; the test resumes, hides option orders, grades on the server, verifies the subject on a pass; one retake after 14 days; abandoned and late tests count as attempts; the 7as guard on and off; item analysis admin-only (`20261012090200` with the Mathematics rows of `20261012090300`) | 41/41 ok, 9 Oct (P19's "no keys in the reply" line wasn't printed: a format string had one placeholder too few, fixed since; re-run after applying) |

The audit rows (`school_result_checked`, `tier1_record_checked`, `tier1_training_signed_off`) can't be tested
before `20261012090000` is committed, because Postgres can't use an enum value in the transaction that added it.
The runner swaps `log_admin_event` for a counter; both suites counted the right number of calls. After applying,
run both files on their own and expect the "written" count instead.

**Apply order on or after 12 Oct (with the CEO's yes), dev first, then production at the cutover**:
`20261012090000` (alone) → `20261012090100` → `20261012090200` → `20261012090300`. Then run `school_results.sql`
and `tier1_pipeline.sql` on their own.

**APPLIED TO DEV, Mon 12 Oct 2026 (CEO's yes), in that order; both suites then run on their own, rolled back, on the applied
database: `school_results.sql` all of R0 to R37 as expected (the real audit rows were written: "3 written"), and
`tier1_pipeline.sql` all of P0 to P40 as expected (P19's "keys in the reply" line prints `f`; P40 "4 written"; P36 shows a tutor's
own subject still stored `verified` while `require_subject_verification` is `false`, so phase 1 is unchanged).** The seed's
content was proved identical to the file by a hash computed in the database and from the file (96 items, 7 modules, 4 scenarios).
Production is untouched; apply there at the cutover.

## Tutor onboarding (7cx): APPLIED TO DEV, Wed 14 Oct 2026 (CEO's yes)

`20261013180000` then `20261013180100` were applied to dev. `tutor_onboarding.sql` was then run on its own against the applied
database, rolled back: O0 to A3 all as wanted (O0b, "every tutor that existed before is grandfathered", reads 0 not grandfathered; it
only means something straight after applying), and the separate enum check (rows=1). Afterwards dev had 17 users, no test users, 6
onboarding rows (all grandfathered), 0 documents and 0 stored files. Production: not applied (at the cutover, with the CEO's yes).

## "Tell me when a tutor is available" (7cz, 14 Oct 2026; **APPLIED TO DEV Wed 14 Oct, about 20:20 SAST, with the CEO's yes; not on production**)

Migration `20261014090000_tutor_waitlist.sql` (a table closed to direct writes, join and leave functions, a notifier that
runs when a tutor is approved or a subject is verified, and a daily purge). **Applied to dev as version `20261014181422`, name `tutor_waitlist`
(the tool names the version by the time of applying); the stored text hashes to the file's (`8bcc047955c2d9713802197252ac31be`), the
code-only hash matches too (`47a6f9c95d0f7aa8d0c6646e59da857f`); the suite below was then run on its own on the applied database, rolled
back: all 31 results as wanted; dev afterwards: 18 users, 0 test users, 0 waiting-list rows, 6 cron jobs (the new `purge-old-tutor-waitlist` is
the sixth).** Earlier it was run **with the migration in one rolled-back
statement** (`node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/tutor_waitlist.sql supabase/migrations/20261014090000_tutor_waitlist.sql`), or on its own after it is applied.

| File | Checks | Covers | Result (dev, rolled back with the migration, 14 Oct) |
|---|---|---|---|
| `tutor_waitlist.sql` | 31 results (W0 to W28) | A learner joins for themselves and a parent for their child; joining again returns the same entry; a blank subject, joining for someone else or a stranger's child, signed out, and direct inserts, updates and deletes are all refused; others see none of your entries; at most 10 open entries; an admin sees all; an approved tutor for a different subject tells nobody; adding the subject tells the learner and the parent once each, never twice; joining is refused once a tutor is available; a subject verified for a not-yet-approved tutor tells nobody until the tutor is approved; leaving works only for your own entry; an entry older than 60 days is not told and is replaced when the person joins again; the purge removes entries 90 days after they were told or made and keeps recent ones; clients cannot call the purge or the notifier; the daily job is scheduled | **all as wanted** (dev afterwards: no table, 17 users, no test users, 5 cron jobs, latest migration unchanged) |

## Keep or swap (7aa + 7da + 7db, 14 Oct 2026, tested rolled back; NOT applied)

Migration `20261014200000_keep_or_swap.sql`: the learner (or the parent) keeps a tutor and books them again, or tries someone else; a
tutor may end a pairing privately; a request addressed to a tutor ends after at most 48 hours; one tap sends it to any available tutor;
and tutors read waiting requests only through a function (the privacy gap, 7db). **Replaces** `guard_session_request_insert()`,
`claim_session_request(uuid, uuid)`, `expire_stale_paid_requests()` and drops the policy "Tutors view unclaimed pending requests".
Run **with the migration in one rolled-back statement** (`node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/keep_or_swap.sql supabase/migrations/20261014200000_keep_or_swap.sql`).

| File | Checks | Covers | Result (dev, rolled back with the migration, Wed 14 Oct) |
|---|---|---|---|
| `keep_or_swap.sql` | 70 results (K0 to K58, with the b/c variants) | Who may choose (an adult learner; a parent for their child; not a stranger, not a learner under 18 with their own sign-in); a tutor can never read what learners chose and a learner can never read that a tutor ended; an addressed request is accepted only for a tutor the learner has had, who is approved, teaches the subject and the price level, with the pairing not parted and fewer than 3 already waiting; forged end times and resend fields are reset; the end is the earlier of 48 hours and 30 minutes after the start; the tutor is told when the card check passes and reminded once after 24 hours; a tutor sees only requests addressed to them or ordinary ones they could accept, never another tutor's, never from a learner who parted with them either way; nobody but the owner, the accepting tutor, an admin or the requester reads the table (7db); claiming refuses addressed-to-another, expired and parted requests with one sentence; "try someone else" withdraws what was waiting and is undone by clearing; a tutor declines (only their own addressed request); ending a pairing tells the learner once, neutrally; one tap sends a request on (waiting: becomes ordinary; expired or declined: a new ordinary request with the same checked card, once, not for a nearly gone time, not by a stranger); My tutors; permissions (signed-out, the internal rule, the notifier) | **all as wanted**, in three runs because the tool shows only part of a long answer (K0 to K38b; K38b to K58; then the whole file again against the final migration with lines shortened: no FAIL, the values that matter checked) |
| `7a_split_payments.sql` | 38 results | **Check A11 changed**: a tutor now sees the card-checked requests through `available_requests_for_tutor()` (3) and none straight from the table (A11b, 0). Everything else is as before | **all as wanted** with the final migration; A11 = 3, A11b = 0 |
| `7a_no_self_match.sql` | 4 results | unchanged | **all as wanted** with the final migration |
| `7k_guardian_phone.sql` | 8 results | unchanged (a guardian's booking still needs a phone; the insert guard is replaced) | **all as wanted** with the migration (before its last change to the tutor list only) |

**APPLIED TO DEV on Fri 16 Oct 2026 at 13:40 SAST** (the CEO's yes "after today's request is settled"; version `20261016114013`, name `keep_or_swap`; the stored text's md5 `530c6d5b5bb6c00f5cc775e117d4126a` and 40,250 bytes equal the file's). `keep_or_swap.sql` was run on its own on the applied database, rolled back: **70 results, 0 FAIL, every "want" met** except K20, whose label says "no request in the table (want 0)" but prints 1: that row is the stranger's own request, which the test itself creates for that stranger two checks earlier (K19c), so a learner reading their own request is correct and the label is what is wrong (fix the wording when the test is next edited). Afterwards: 18 users, 0 test users, 7 requests, 1 session, latest migration `20261016114013`, the old policy gone. The payment suites `7a_split_payments.sql` (38) and `7a_no_self_match.sql` (4) were **not** re-run on the applied database (not asked, and a real charge and split had just worked); do it before the next payment change.
(The previous text, kept for the record:) the app code was published on 14 Oct 2026 at 23:31, `main` = `11477bf`, so step one was done. **The order matters because the live site uses the dev database:** publish the app code first (it reads
waiting requests through the new function when it exists and through the old policy when it does not), then apply the migration,
then run `keep_or_swap.sql` on its own on the applied database. App-side checks: `npx tsx scripts/dev/keep-or-swap-test.ts` (95 checks;
27 deliberate breakages of the helpers and of the source files, all caught).

## A parent is told when the tutor adds the meeting link (16 Oct 2026; APPLIED TO DEV at 15:33 SAST as version `20261016133151`, stored text equal to the file, md5 `36c070f2cff7dacc656a69419a40fc4f`; the test was re-run on the applied database: 9 of 9)
Migration `20261016140000_session_link_notifies_booker.sql` replaces one function, `set_session_meeting_link(uuid, text)`: the same checks and update, and the notice "Your session link is ready" now reaches the learner AND the person who booked the session, once each (it used to reach only the learner's own account, so a parent who booked for a child was never told). Test `session_link_notifies_booker.sql` (9 results, L1 to L9: the child told once, the parent told once, nobody else, the link saved, an adult who booked for themselves told once not twice, another tutor refused, an http link refused, the parent cannot set it): run with the migration in one rolled-back statement on dev, **9 of 9 as wanted**; afterwards the live function unchanged, 18 users, 0 test users, latest migration `20261016114013`. Waits for the CEO's yes (decision row 45).

## A parent changes a learner's grade (16 Oct 2026; APPLIED TO DEV at 15:33 SAST as version `20261016133201`, stored text equal to the file, md5 `4890b536acc6ff3fe1cfc4ae5e64b358`; the test was re-run on the applied database: 11 of 11; a real save as the parent also worked in the app)
Migration `20261016150000_parent_sets_learner_grade.sql` adds one function, `set_learner_grade(p_learner uuid, p_grade text)`: only a signed-in adult with an active guardian consent for that learner (`can_act_for_learner`) may call it; the grade must be a name in `grade_levels` (any capitals; stored in the table's spelling); it changes that learner's `student_profiles.grade_level` and nothing else. (Before this a parent could only read a linked learner's profile, so a grade chosen when adding the learner could never be corrected.) Test `parent_sets_learner_grade.sql` (G0 to G8, 11 results): run with the migration in one rolled-back statement on dev, **11 of 11 as wanted**: the parent changes it; a learner with no grade gets one; a made-up or an empty grade is refused and the stored grade does not move; another parent, the child's own sign-in and a signed-out caller are refused; after consent is withdrawn the parent loses the right at once. Afterwards the function absent, 18 users, 0 test users, latest migration `20261016114013`. Waits for the CEO's yes (decision row 46). The screen is live and says "isn't switched on yet" until it is applied.

## 7br: a parent adding a learner (9 Oct 2026, tested rolled back; not applied)

`7k_signup_trigger.sql` passed because it inserts `auth.users` rows with the guardian already in
`raw_app_meta_data`. Supabase Auth's admin `createUser` doesn't: it inserts the row with only `{provider, providers}`
and writes the caller's app_metadata in a later UPDATE (supabase/auth `internal/api/admin.go`, `adminUserCreate`). So
every real "add a learner" was refused by the AFTER INSERT trigger. A rolled-back probe on dev showed it: Auth's
order refused ("Learners under 18 are added by a parent or guardian…"), the 7k order accepted.

| File | Checks | Covers | Result (dev, rolled back with `20261009133000`) |
|---|---|---|---|
| `7br_guardian_intents.sql` | 13 | Auth's order with the server's record (written as `service_role`): linked, consent and acceptances by the guardian, record deleted; a minor's self-signup still refused; expired record, another id, a parent without a date of birth, a tutor as guardian, a record creating a tutor: all refused; the guardian in app_metadata still works; an adult self-signup unchanged; Auth's insert-then-UPDATE gives one link; only `service_role` can read or write the table | 11/11 on the first run except G10 (the service role had no rights: dev grants it nothing by default; grant added), then G1, G10, G12, G13 re-run: all ok, 9 Oct |
| `7k_signup_trigger.sql` | 12 | Re-run against the new function | 12/12 ok, 9 Oct |

**Apply on Mon 12 Oct with the CEO's yes, before the parents sign up, and before or apart from the phase 2
migrations** (it doesn't depend on them): `20261009133000`, then deploy the Worker (`server/index.ts` now records the
guardian and passes the learner's id to `createUser`), then run `7br_guardian_intents.sql` on its own. Production
needs the same migration and Worker at the cutover (its trigger is the same).

## 7bm: video rooms on our own WebRTC (9 Oct 2026, tested rolled back; **APPLIED TO DEV on 16 Oct 2026 at about 19:53 SAST as version `20261016175352`**, the stored text equal to the file: md5 `d9320c2be9f0153bb2978dd1d25b72d4`, 28,428 bytes; the two Realtime policies exist on `realtime.messages`, the purge job is scheduled, 18 users, 7 requests and 1 session unchanged; the whole suite was then run on its own on the applied database, rolled back: **127 ok, 0 FAIL**. The CEO had turned Realtime's "Allow public access" OFF before it was applied.)

Migration `20261009200000_video_rooms.sql` (two tables closed to clients, server-only rules, and the policies that
let only admitted people use a room's Realtime channel). Design: `Drake/programmer/video-rooms-design-v2.md`.

| File | Checks | Covers | Result (dev, rolled back with `20261009200000`) |
|---|---|---|---|
| `7bm_video_rooms.sql` | 22 groups, 127 lines | A tutor opens a room (a student can't; bad and duplicate codes refused); the lobby (adult student and parent wait, a learner under 18 is refused, the code is case-insensitive); only admitted people can signal; what each person may see; room size (2, 3 and 4: the host plus up to 3 guests; the host's own place is always kept); removing (can't return, host stays); leaving and returning; a session's room (tutor, learner and the learner's guardians admitted without a lobby, unrelated parent or student refused, a code alone never admits; too early, too late, unconfirmed, completed and cancelled sessions have no room); ending a room; clients can't touch the tables or call the rules (privileges, and a real attempt as the signed-in and signed-out roles that must end in the database's own "permission denied"); the Realtime policies (member sends, lobby person, stranger, unknown room, other topic, other extension and a silent member refused; reading); **heartbeat** (answers `admitted` / `waiting` / `removed` / `left` / `superseded`, stamps the database clock, refused for someone never in the room, an unknown, ended or expired room); **silence** (after 90 seconds a guest stops counting toward the room size, the host's list and the signalling channel; the seat can go to someone else; the guest comes back only if there is room); **visits** (rejoin after a crash, two tabs of one person, a late leave from an old tab changes nothing); ended and expired rooms refuse everything; the tutor's open-room list and the limit of 5; the row lock and the database-clock-only rule (read from the function text); **V22: a booked session's room cannot be ended, and nobody in it removed, by its tutor (the learner and guardians have a right to be there), and the daily purge job is scheduled**; clean-up | **127 ok, 0 FAIL, 12 Oct** (121 were the builder's; 6 were added in the PM's review of 12 Oct, and the whole file was run again after the review's changes; dev, rolled back with the migration, run once; afterwards a read-only query showed no `video_*` tables, functions or Realtime policies and no leftover test users). Every refusal is matched on the function's own error token (or the row-level-security / permission-denied message), so a different error cannot pass as a refusal. |

**What one transaction cannot test: two people taking the last seat at the same moment.** The functions that take or free seats lock the room's row first (`select ... for update`), so the second caller waits and then counts the first caller's seat; group V20 only checks that all five of them do so, from the function text. A real two-session race needs committed rows, which dev may not receive before the CEO's yes. Test it once the migration is applied (two scripts joining the same room at once).

**What the Realtime part really covers.** `realtime.messages` has no daily partition on dev yet (Realtime has never been
used there) and belongs to another role, so a direct insert fails with "no partition of relation messages found" before
any policy is tried. The test therefore copies the **deployed** policy text from `pg_policies` onto a stand-in table with
the same two columns and tries sends and reads as the `authenticated` role; every refusal must be the row-level-security
error itself. It does **not** prove the policies work on the real `realtime.messages` table. Check that once the
migration is applied and Realtime has been used (open a room with two accounts).

**Call logic, not database**: `scripts/dev/room-loopback.html` (run `npx vite --port=3002`, open
`/scripts/dev/room-loopback.html`). Three fake participants in one page with an in-memory channel, in a real browser's
WebRTC engine: all pairs connect when two arrive at once, decoded video arrives, low-data mode, leaving, rejoining, and
relay-only with no relay must not connect directly. **9 of 9 ok, 9 Oct** (Chromium in the Claude desktop app's browser
pane). It does not test real networks, phones or mobile data.

**Heartbeat and room page (12 Oct)**: the same file now also runs the heartbeat, leave and visit-id code of
`src/lib/videoRooms.ts` with a fake sender (T9 to T18), and then the real `src/pages/RoomPage.tsx` in React's StrictMode,
behind `RequireAuth`, against a pretend rooms API, a pretend sign-in and channel (the real Supabase client object with those
methods replaced, so nothing goes to a real server) and fake cameras (T19 to T30): one join only, every beat carrying the
visit id, a closing tab's keepalive leave, leaving the page, a woken page beating at once, the answers `left` (joins again),
`superseded`, `removed`, a 410, hiccups, the Leave button with a dead connection, and the lobby. **32 of 32 ok, 12 Oct.** After the PM's review of 12 Oct, **T31 to T34b** test the roster: A told the room lists only C closes its connection to B and keeps C; B's new hello is held, not obeyed, and A asks for a fresh roster; when the roster lists B again the held hello is handled; a sender the roster never listed (D) is held the same way, then connects once listed. **38 of 38 ok.** Mutation checks: with the roster gate removed T32 and T34 fail; with the closing of unlisted connections removed T31 and T32 fail.
Mutation check: with the page's deferred start removed T19 fails (two joins in StrictMode); with the Leave button waiting for
its request again T28 fails. Not covered: that a browser really lets a keepalive request out while a tab closes, and the
"back on screen" wake-up (the browser pane was hidden, so `document.hidden` was true; the "back online" wake-up was checked).

**Apply only with the CEO's yes** (and after the tester notice is updated). Then set the server switches
(`VIDEO_ROOMS_ENABLED=1`; see `server/CONTEXT.md`), flip `FEATURES.videoRooms`, and test with two real accounts.

## A changed Terms or Privacy version tells everyone in the bell and blocks nobody (17 Oct 2026; APPLIED TO DEV as version `20261017005628`, stored text equal to the file: md5 `b8437d9034317a9c7248786b8e98f608`, 2,371 bytes)
Migration `20261017090000_policy_update_notification.sql` adds one trigger function, `notify_policy_version_changed()` (security definer, not callable by browsers), and one trigger on `system_settings` (after update of `setting_value`, per row): when `current_terms_version` or `current_privacy_version` changes, every profile gets one `terms_updated` notice, and both keys changing in one statement or transaction gives one notice, not two (the check is `created_at = now()`). It replaces nothing (`my_pending_acceptances` and `accept_current_policies` are untouched; the app now stops at the gate only a person who has NEVER accepted a document). Test `policy_update_notification.sql` (N0 to N8, 10 results): run with the migration in one rolled-back statement on dev, **10 of 10 as wanted** (21 profiles incl. the 3 throwaway ones: 21 notices for 21 accounts, none doubled; the same value again, or another setting, adds nothing; a later change adds one more; a learner reads only their own; a browser cannot call the function or change the version); nothing kept.

## Tier roles and levels defined in the admin app (17 Oct 2026; APPLIED TO DEV as version `20261017115352`, stored text equal to the file: md5 `1111e41d0ef1c796560e0814f38fe25f`)

Migration `20261017120000_tier_roles_and_admin_levels.sql` (CEO: "admins should be able to assign tier roles from the admin app and the tiers should be defined in the admin app as well"). Adds `tutor_credentials.assigned_sub_tier_id` and `note`, lets `credential_definitions.entry_sub_tier_id` be empty, replaces ONE function (`refresh_credential_floor`, to read a level chosen for one tutor: `coalesce(c.assigned_sub_tier_id, d.entry_sub_tier_id)`), seeds six credential definitions (`teaching_degree` 2C, `teaching_degree_2y` 2D, `teaching_degree_3y` 3A, `teaching_degree_4y` 3B, `higher_certificate_education` 2A, `admin_assigned` with no level) and creates nine admin-only functions, each checking `is_active_admin()` and writing its audit row: `admin_assign_tier`, `admin_clear_assigned_tier`, `admin_record_credential`, `admin_remove_credential`, `admin_save_tier`, `admin_save_sub_tier`, `admin_save_credential_definition`, `admin_delete_credential_definition`, `admin_recalculate_all_tiers`. Nothing is dropped. A tutor's level is still the higher of what they have earned and their credential floor; a rating freeze still stops all movement (so a level assigned to a frozen tutor applies when the freeze lifts).

Test `tier_roles_admin.sql` (T0 to T13, 14 results): **14 of 14 ok** run on the applied database (and an earlier run of the migration and test together before it was applied hit one error in the TEST, a text level read into a number at T5, fixed and then passed). Proved: the seeded definitions; a tutor cannot assign a level, save a level or edit the table; assign, re-assign (one at a time) and clear; refusals (no reason, unknown level, unknown tutor, another tutor's document, a credential with no level, an unknown credential); a degree puts a tutor at 2C and an assigned 2D beats it, and clearing the assignment leaves 2C; removing a credential removes the floor; editing a level keeps before and after in the audit row, adds a new level 5A, and seven bad saves are refused with 1B unchanged; a tier edit and two refused ones; a new credential moves its holders when its level changes, cannot be deleted while held, can once free, and the built-in one is protected; recalculating everyone counts every tutor; and exactly 15 audit rows for the 15 changes (refusals leave none). Rolled back; afterwards the real data was checked unchanged (1B still R80, 16 levels, 12 credential definitions, no credentials held, no new audit rows).

The admin app's calls are checked against the migration by `scripts/dev/levels-admin-test.ts` (function names and every parameter name equal what the migration defines). Gap, on purpose: every active admin can call these (the same rule as every other admin table); only the super admin sees the Levels menu entry. The only admin today is the CEO. When a second admin is added, tighten the five definition-editing functions to super admin.

## The tutor is told when a session is booked (17 Oct 2026, night; APPLIED TO DEV as version `20261017205442`, stored text equal to the file: md5 `314cb9d817ce0e9d22708d14f172ce77`)
Migration `20261017224500_tutor_session_booked_notice.sql` (CEO: "after a tutor accepts a session they dont recieve the upcoming sessions notification"): one security-definer trigger function, `notify_tutor_session_booked()` (not callable by browsers), and one trigger on `sessions` (after insert, per row) that writes ONE notification for the session's tutor: type `session_booked`, "You have an upcoming session", body "Session with <learner first name> (<subject>), <day time, South African time>. Open Sessions to start the video call when it is time.", tied to the session. It fires for every way a session is made, so it cannot drift from `create_session_from_request`; it replaces nothing, and the learner's and parent's `request_accepted` notice is untouched. Test `tutor_session_booked_notice.sql` (B0 to B7, 8 results): run with the migration in one rolled-back statement BEFORE it was applied, **8 of 8 ok** (one notice for the tutor tied to the session; the words including the subject and the time; nobody else gets one from it; a parent-booked child's session names the child; no subject gives no empty brackets; a tutor reads only their own notices and an outsider none; a browser cannot call the function; an update adds none); nothing kept. Afterwards the table held 0 `session_booked` rows (the session tested by hand was booked before the trigger existed).

## Best fit first, widened after 5 minutes (19 Oct 2026, migration `20261019120000`, on top of `20261019090000`)

`best_fit_first_matching.sql` (B0 to B34, 43 report lines, each ending `ok` or `FAIL (want ...)`): run with the migration in one rolled-back statement (`node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/best_fit_first_matching.sql supabase/migrations/20261019120000_best_fit_first_matching.sql`) before it is applied, or on its own after. Covers: inside the first 5 minutes only a tutor who fits ALL of a request (school, approved subject, grade, curriculum, free) sees it and can accept it, with both accept paths (`claim_session_request`, `accept_session_request`); after 5 minutes (made by moving `created_at` back 6 minutes) a tutor of the right level who is approved for the subject and grade and free also sees it and can accept, but never a tutor who is not free, wrong grade, unapproved, or below the level; a book-again request (sent to one tutor) is not widened; a resend (`resent_from`) is open from the start; an expired request and a tutor's own request stay refused; the 5 is one setting (`request_widen_after_minutes`: default, 10, 3, a non-number falls back to 5); the two new helpers are not callable from the app; the price counts ignore school and curriculum but keep subject, grade and free time. Since this migration `curriculum_availability_matching.sql` has updated wants for M22 to M28, M44 and M62 to M64 (the counts and the waiting list no longer narrow by school or curriculum).

## Curriculum approval and calendar matching (19 Oct 2026, migration `20261019090000`, applied to dev)

`curriculum_availability_matching.sql` (M0 to M68 with the b/c/d/e/f variants, 101 report lines): run **with the migration in one rolled-back statement** (`node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/curriculum_availability_matching.sql supabase/migrations/20261019090000_curriculum_and_availability_matching.sql`). The test ends by handing its report back through the setting `test.report` (it checks `test.runner` is `on`, which the runner sets; run on its own it raises the report itself), each line shortened to its id and value so the whole report fits the tool's visible limit; the runner prints the md5 of each file it ran, so a hand-pasted copy can be compared with `md5sum`. Covers: the tutor rule (approved subject, grade range, curriculum), the free rule (weekly hours in South African time, other sessions, an accept in progress), the price counts, the tutor's inbox and both accept paths, request length / curriculum / "book again" guards, the admin approving and rejecting against the checklist (and writing no notice to the tutor: M57, M60b want 0), the admin's note and ticks living in the private table `tutor_subject_reviews` (a signed-out caller, another tutor and a learner cannot read the review of an approved subject; the owning tutor and an admin can; a tutor cannot write it), the waiting list, and the checklist editor. **Result (dev, rolled back, 19 Oct): 0 FAIL in 101 lines, every value as wanted; migration md5 `f8d17440570ec720570e5cecbd2d59c3`, test md5 `ebc00f899def09f595fd1f8ec02e4165`.** The first full run stopped at M56a and found a real fault (the policy "Admins read all tutor competencies" made every signed-out read of the subject table fail: now `to authenticated`). **APPLIED TO DEV as version `20261019083339` (19 Oct 2026; stored text equal to the file, md5 `0405fbad265e852e4cfae511c89fa215`); the test re-run on the applied database: 0 FAIL in 101 lines.** Older suites patched for the new rules and re-run on the applied database, all 0 FAIL: `7a_no_self_match.sql`, `7a_split_payments.sql` (a fixture error of mine, a variable `x` clashing with an alias, was fixed first), `keep_or_swap.sql`, `tier1_pipeline.sql`, and `anon_public_reads.sql`; `tutor_waitlist.sql` not re-run (its functions are unchanged; M62 to M64 cover the waiting list).

## Error tracking (20 Oct 2026, migration `20261020160000_client_errors.sql`; **APPLIED TO DEV 21 Oct 2026 as version `20261020221210`** (stored text md5 = the file's) and the suite re-run on the applied database: 35 lines, 0 FAIL; NOT on production)

`client_errors.sql` (C0 to C30 with the b/c variants, 35 report lines): run with the migration in one rolled-back statement (`node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/client_errors.sql supabase/migrations/20261020160000_client_errors.sql`). Covers: a signed-out and a signed-in caller can log an error only through `log_client_error` (a repeat is counted, not added; signed in or out is read from the sign-in); every direct insert, update and delete is refused to signed-out, signed-in and even admin callers ("permission denied"); a signed-out caller cannot read, a learner, a tutor and an admin whose access is off see 0 rows, an active admin sees them all; oversize fields are cut to 300 / 120 / 1500 / 80; an email, sign-in token, id, phone number, long key and the query part of a web address are removed from the message, details and screen (and an ordinary message is left alone); the `/room/` code and ids are masked in the screen; 70 made-up errors in an hour add at most 60 rows and the rest are only counted in one overflow row; an error already stored is still counted during a flood; an hour later new kinds are stored again; at 2,000 rows nothing new is stored; the purge removes rows not seen for 30 days and keeps 29-day-old ones; browsers (even an admin) cannot run the purge or the scrubber; the table's columns hold nothing about a person; row security is on and no policy allows a write; all four functions pin `search_path`; the daily job is scheduled. **Result (dev, rolled back with the migration, 20 Oct, run once): every line `ok`, 0 FAIL; flood: 4 -> 60 new kinds, 14 counted in the overflow row (wanted 14).** Afterwards dev was checked unchanged (no table, no functions, no job, no test users, latest migration `20261020211323`). Migration md5 `204ff25c6f6680ffe2225ffcc04df296`, test md5 `b2f2eea62c93bcfc4d86e87e4fee5c53`. The app half: `npx tsx scripts/dev/error-log-test.ts` (38 checks; deliberate breakages of the de-duplication, the email cleaning and the switch-off after a refusal are caught). After applying, run `client_errors.sql` on its own on that database, once.

## Public read fixes (21 Oct 2026, migration `20261020170000_public_read_fixes.sql`; **NOT applied**)

`public_read_fixes.sql` (S0, R1 to R9, P1 to P12, M1, N1, D1 to D4, F1 to F4: 32 report lines): run with the migration in one rolled-back statement (`node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/public_read_fixes.sql supabase/migrations/20261020170000_public_read_fixes.sql`) before it is applied, or on its own after. Covers the Production review's M1, M2, m1, m8, m9 and the anon-role probes (m14): a signed-out visitor and a learner are refused the reviews table and the five internal `tutor_profiles` columns (and `select *`); the review list gives only id, rating, comment and date, hides an unverified tutor, and a tutor sees their own; the admin function refuses learner, tutor and visitor; exactly 20 columns readable; chat writes and notice edits refused; documents must sit in the tutor's own folder (links allowed). **Result (dev, rolled back with the migration, 20/21 Oct, run once): 0 FAIL in 32 lines; migration md5 `8ccff23bfdc2983e6633522cc9292aaa`, test md5 `2311e9445aec76e37baa9fdf75c9fe5f`.** `anon_public_reads.sql` was edited (tutor_profiles by named columns, reviews through the function when it exists) and not yet re-run; run it, `tutor_onboarding.sql`, `7o_profile_privacy.sql` and `keep_or_swap.sql` on the applied database. A NEW `tutor_profiles` column is unreadable by the app until granted; P12 fails until its expected list is updated on purpose.

## Police clearance and ID checks (21 Oct 2026, migration `20261020180000_police_clearance_checks.sql`; **NOT applied anywhere**)

`police_clearance_checks.sql` (C0 to C35: 39 report lines): run with the migration in one rolled-back statement (`node scripts/run-rolled-back-test.mjs <out.sql> supabase/tests/police_clearance_checks.sql supabase/migrations/20261020180000_police_clearance_checks.sql`) before it is applied, or on its own after it (C20 to C21c then check the stored text against the file). Covers: approval refused unless an ID document (not rejected) and a police certificate (not rejected, issued within 6 months, South African date, not in the future) are on file, naming what is missing; a tutor with no onboarding record is held to it; a grandfathered tutor is not; the owner typing SQL is not (so the old suites' fixtures still work); re-saving an already approved tutor is not blocked; claim_session_request and accept_session_request refuse a missing or out-of-date certificate with the tokens `police_clearance_missing` / `police_clearance_expired`, for grandfathered tutors too, and take a tutor whose certificate was issued exactly 6 months ago; a certificate rejected later stops accepting; the tutor's own status function; the helper is closed to signed-in users; execute rights of the two replaced functions kept. **Result (dev, rolled back with the migration, 21 Oct, the clean run): 0 FAIL in 39 lines; migration md5 `4a5a4ec765ee3d499488daa245ad88c0`, test md5 `4c90023f76f5ce242d0f494bebb8c0d4`.** The first run found one real bug (an array append with a bare literal), fixed before the clean run.

Fixtures edited so tutors who accept have a current police certificate (the accept functions now need one): `7a_no_self_match`, `7a_split_payments`, `best_fit_first_matching`, `curriculum_availability_matching`, `keep_or_swap`. **Proved with the migration, rolled back, dev, 21 Oct:** `best_fit_first_matching` 0 FAIL in 43 lines; `keep_or_swap` every refusal and every "(want ...)" value as wanted (K20, K55 and the end of K51 were cut off by the report shortening; none touches accepting). **Not re-run:** `curriculum_availability_matching`, `7a_no_self_match`, `7a_split_payments` (the last needs the Vault secret): re-run all three on the applied database at the production move. The app half: `npx --no-install tsx scripts/dev/clearance-test.ts` (36 checks).