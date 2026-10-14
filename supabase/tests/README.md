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

**Not yet done:** applying it. **The order matters because the live site uses the dev database:** publish the app code first (it reads
waiting requests through the new function when it exists and through the old policy when it does not), then apply the migration,
then run `keep_or_swap.sql` on its own on the applied database. App-side checks: `npx tsx scripts/dev/keep-or-swap-test.ts` (95 checks;
27 deliberate breakages of the helpers and of the source files, all caught).

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

## 7bm: video rooms on our own WebRTC (9 Oct 2026, tested rolled back; not applied)

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
