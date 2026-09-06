# Tutorlage Game Plan

Living document — update it as the product and its plans change, same convention as
`CLAUDE.md` and the `CONTEXT.md` files. This is the "what is this app, and where is it going"
reference; it doesn't track day-to-day bugs (see any `*errors*.md` file for that).

## What Tutorlage is

Tutorlage is an on-demand academic tutoring platform connecting students (and their parents)
with tutors — primarily recent high-achieving matriculants and current students — for both
in-person and online sessions. It's explicitly modeled on Uber's interaction pattern: fast,
structured, trust-verified matching rather than a static tutor directory. The pitch is a
circular academic economy: recent graduates monetize their own academic success, while families
get affordable, relatable peer mentoring instead of expensive traditional tutoring centers.

Four pillars (from the app's own About page):
1. **Hyper-local matching** — geospatial matching between students and tutors near their own
   institution, for online or in-person sessions.
2. **Structured scheduling** — book now or schedule ahead, at a subject/grade/pricing tier that
   fits.
3. **Strict verification** — every tutor is document-verified before they can accept sessions.
4. **A circular academic economy** — recent grads and top students earn from their own academic
   success.

South Africa is the initial market (CAPS/NSC curriculum, DBE-verified school data, Rand
pricing), but the platform is **not** meant to be South-Africa-only long-term — it's meant to
expand internationally.

## Current architecture

- **`src/`** — the public-facing student/tutor web app. React 19 + Vite 6 + TypeScript +
  Tailwind CSS 4, `react-router-dom` v7, `@supabase/supabase-js` v2. Deployed publicly via
  GitHub Pages (`https://darkphillipino.github.io/tutorlage-beta/`), auto-deploying on every
  push to `main` via GitHub Actions.
- **`admin/`** — a separate, deliberately isolated admin web app (own `package.json`, own dev
  server on port 3100). By design it is **never** deployed to the public internet — it's meant
  to be reachable only over a private network (Tailscale/VPN mesh), even though it shares the
  same Supabase database as `src/`. Kept out of the public git repo entirely for now.
- **`server/`** — planned, not yet built. Will hold a service-role Supabase connection for
  privileged operations, plus Gemini AI integration, once there's an actual need for
  server-side logic the RLS-gated frontend/admin clients can't do themselves.
- **Database**: Supabase (Postgres + Auth + Row Level Security). Real auth is live (email/
  password via Supabase Auth, real SMTP through Resend, no more manual confirmation
  workarounds). RLS gates almost everything; a recurring gotcha throughout this project has
  been RLS policies existing without the matching base `GRANT`, silently 401'ing reads that
  looked correctly policied.

## What's actually live today

- Real signup/login (student, tutor, and a fixed admin account), with the on-signup DB trigger
  auto-creating `profiles` + role-specific rows.
- Real data: 25,490+ South African schools/institutions (DBE EMIS import), 26 universities, 50
  TVET colleges, the official CAPS/NSC subject list, and grade levels Grade R through PhD — all
  real, none fabricated.
- The Learn flow (booking search → tutor list → pricing tiers) — currently being hardened; see
  the open `*errors*.md` file for the specific bugs being worked through.
- A tutor-side dashboard (`TeachGoScreen`) with a real availability calendar, tier-progression
  tracking computed from actual stats (not fabricated), and reviews.
- A fully built (but not yet deployed anywhere reachable) admin panel: tutor verification queue,
  disputes, user management, payouts, system settings, audit log — all RLS-gated, all wired to
  real data.
- i18n groundwork: 4 languages (English, Afrikaans, Zulu, Xhosa), a working language switcher in
  the header, persisted to `localStorage`.

## Known gaps / explicitly deferred (not bugs — just not built yet)

- **Payments and payouts**: no real money moves through the platform yet — decided (2026-09-05):
  integrate Paystack rather than build in-house, scheduled as Day 3 of the phase-2 production
  plan below.
- **Multi-country/multi-currency**: see the dedicated "Internationalization plan" section below
  — this is one piece of a bigger rigidity problem, not an isolated gap.
- **Self-expanding subject taxonomy**: the idea that a tutor who wants to teach a subject not in
  the `subjects` list could type it in during signup and have it logged as a candidate addition,
  rather than being blocked — discussed, not built.
- **`TeachGoScreen`'s GO button** is still a local-only online/offline toggle — it doesn't
  actually write to `tutor_profiles.is_dispatch_active` yet, even though real tutor auth now
  makes that write legal.
- **Institution-based tutor filtering**: `tutor_profiles` has no institution column in the
  schema at all right now, so "hyper-local matching" isn't actually enforced in a search query
  yet — it's collected but not used to filter.
- **Social login (Google and others)**: only email/password auth exists right now. Enable
  Google (and any other relevant provider) in Supabase Dashboard → Authentication → Sign In /
  Providers, plus wire up the corresponding `supabase.auth.signInWithOAuth()` buttons in
  `src/pages/Login.tsx`/`SignIn.tsx`. Reminder to come back to this — not needed for the pilot
  itself, but worth doing before a wider public launch since it lowers signup friction a lot.

## Internationalization plan

The platform is currently far more rigid than it should be for something meant to expand
beyond South Africa. This isn't just "prices show R instead of $" — the rigidity runs through
several layers:

- **Hardcoded currency display**: `PricesPage.tsx`/`TierSelectionPage.tsx` prefix every rate
  with a literal `R`, even though `currencies`/`countries` tables already exist and are seeded
  (see `CLAUDE.md`'s database routing table). Nothing reads them yet.
- **South-Africa-specific curriculum enum**: `tutor_subject_competencies.curriculum` and
  `schools_institutions.curriculum` are a fixed Postgres enum (`caps`, `ieb`, `cambridge`,
  `tertiary`, `primary_caps`, `other`) — CAPS and IEB don't mean anything outside South Africa.
  A `curricula` table exists (per the internationalization migration already applied) but
  `schools_institutions.curriculum` still reads the old enum column, not `curriculum_id`.
- **Grade-level naming is one country's system**: `grade_levels` is named "Grade R" through
  "Grade 12," then "1st Year Undergraduate" through "PhD" — this is the South African/
  Commonwealth-ish schooling ladder. It doesn't map cleanly onto, say, the US grade system, UK
  Key Stages, or other countries' structures without real thought, not just a find-and-replace.
- **The subject list is the official CAPS/NSC list** (59 South African subjects) — a student or
  tutor in another country's system wouldn't find their actual subjects on it.
  (Self-expanding taxonomy, noted above, is one path to loosen this — but only in combination
  with a real i18n plan, not as a substitute for one.)
- **`schools_institutions` is 100% South African data** (DBE EMIS import) — there's no
  path yet for institutions in a second country to even exist in the same shape.
- **The 4 supported UI languages** (English, Afrikaans, Zulu, Xhosa) are all South African —
  reasonable for the pilot market, but the `i18n.ts` language list is itself hardcoded, not
  driven by the `languages` table.

None of this needs solving before the pilot ships — the pilot is explicitly South-Africa-only.
But before any real expansion into a second country, this needs a proper design pass, roughly:
1. Decide the actual expansion target(s) first — designing for "international" in the abstract
   produces the wrong abstractions; designing for e.g. "South Africa + Kenya" or "South Africa +
   UK" produces the right ones.
2. Wire `currencies`/`countries` into the UI so rates render in the right currency/symbol per
   country, not a hardcoded `R`.
3. Replace the hardcoded `curriculum` enum usage with the real `curricula` table end-to-end
   (schema half of this is already done; `src/` still needs to catch up).
4. Work out how `grade_levels` and `subjects` generalize per-country — likely a per-country (or
   per-curriculum) variant of each rather than one global list, given how different schooling
   ladders and subject names actually are.
5. Make the `i18n.ts` language list data-driven from the `languages` table instead of a
   hardcoded array.

Not scoped or built — logged here as the plan to work from once real expansion is on the table.

## The big one: anonymous request/accept matching

The current Learn flow lets a student browse named tutor cards directly and click "Book
Session" on whichever one they like. **That's not the intended design.** The real model, Uber-
style: a student sends out a tutoring request without picking a specific tutor. A tutor accepts
(or doesn't) on their end. Only once matched do both sides learn who they're paired with,
surfaced as a notification along the lines of *"Your class with **{name}** has been scheduled
for **{date}**."* The student never chooses a tutor by name up front.

This is a genuinely different architecture from what's built today, not a small tweak:

- The current `session_requests` table already exists (`student_id`, `tutor_id`,
  `enrollment_id`, `requested_by_profile_id`, `requested_start`, `duration_hours`, `status`,
  `resulting_session_id`) — but `tutor_id` is fixed on the request itself, which encodes
  "request *this specific* tutor," not "broadcast anonymously, whoever accepts is matched."
  Supporting true anonymous matching likely needs a schema change (e.g. a nullable `tutor_id`
  until acceptance, or a separate broadcast/matching table tutors can browse and claim from).
- The tutor-facing side needs a real "incoming requests" queue/accept-or-decline UI — nothing
  like that exists yet.
- The student-facing side needs to stop showing individual tutor cards for direct picking, and
  instead show request status ("Looking for a tutor...", then the reveal once matched).
- A notification/messaging surface is needed for the match-reveal moment itself.

This needs a real design pass (schema, RLS policies for a request a tutor hasn't been assigned
to yet, the accept flow, the reveal notification) before any code gets written — it isn't
something to assume details on and just build. **Deferred past the phase-1 pilot** (below) so
that pilot could ship with the simpler direct-booking model first — now scheduled as Day 2 of
the phase-2 production plan, with the schema direction decided: `session_requests.tutor_id`
becomes nullable until a tutor accepts, rather than a separate broadcast table.

**What the Day 3 booking implementation actually does today, to be explicit about it:**
`createSessionRequest()` targets exactly one `tutor_id` — the specific tutor whose card the
student clicked "Book Session" on. It is **not** broadcast to every tutor who matches the
search, and there is no "first tutor to accept wins" race, because there's only ever one
recipient per request. When this section's anonymous-matching model does get built, that's a
real design question to answer deliberately, not an incidental side effect: broadcasting one
request to multiple tutors means the accept flow needs explicit handling for "another tutor
already claimed this" (e.g. checking the request is still `pending` before accepting it,
inside whatever guards against two tutors accepting the same request at once) — it doesn't
just fall out of "first save wins" by default.

## 7-day pilot plan (started 2026-09-05)

Goal: ship a pilot with real core functionality — genuine accounts, genuine tutor profiles,
genuine bookings — in 7 days or fewer. Two things are deliberately deferred past the pilot to
make that realistic:
- **Anonymous request/accept matching** (item 13 above) — the pilot keeps the current
  direct-booking model (student picks a listed tutor and books them), just made real instead of
  a toast.
- **Real payment processing** — pilot bookings settle outside the app (cash/EFT direct to the
  tutor), consistent with the "zero platform markup" framing already in the UI.

**Process rule**: at the end of each day's work below, stop and ask whether to continue
straight into the next day's work now, or leave it for another session — don't just plow ahead
into the next day unprompted, and don't wait for a fixed calendar day to pass either. If a day's
items are already done from earlier work, say so and move to asking about the next day rather
than redoing them.

- [x] **Day 1 — Finish hardening the existing Learn flow.** Done. All 12 fixable items in the
      Learn-section errors file were fixed and verified live; the file was deleted once only
      the deferred architecture item (anonymous matching, tracked above) remained.
- [x] **Day 2 — Tutor profile setup (the missing piece).** Done. Added `updateTutorProfile()`,
      `addTutorSubjectCompetency()`, `deleteTutorSubjectCompetency()` to `queries.ts`; built
      inline headline/hourly-rate editing and a new `SubjectCompetencyEditor.tsx` (mirrors
      `AvailabilityEditor.tsx`'s pattern) into `TeachingProfilePanel.tsx`. Also fixed a missing
      grant along the way — `tutor_subject_competencies` had the right RLS policy but no
      INSERT/UPDATE/DELETE grant for `authenticated`, the same recurring pattern this project
      keeps hitting. `teaching_mode` editing was deliberately skipped — that enum currently has
      only one value (`online`), nothing to choose between yet. Verified live end-to-end: edited
      headline/rate (persisted to DB), added a real "Mathematics, Grade 8-12" competency, then
      confirmed a student search for "Mathematics" actually found the tutor with the updated
      headline/rate/subject — the exact loop that was impossible before today — then deleted
      the competency and confirmed it cleared from the DB too.
- [x] **Day 3 — Make booking real.** Done. Added `createSessionRequest()`, a private
      `findOrCreateStudentEnrollment()`, `fetchIncomingSessionRequests()`,
      `acceptSessionRequest()`, `declineSessionRequest()` to `queries.ts`. "Book Session" on
      `PricesPage.tsx` now creates a real `session_requests` row (with a real
      `student_subject_enrollments` link, created/reused as needed) instead of just a toast; a
      new `IncomingSessionRequests.tsx` on `TeachGoScreen` is the tutor's real accept/decline
      queue — accepting creates a real `sessions` row (rate/commission/payout computed from the
      tutor's *current* profile at accept-time) and links it back via `resulting_session_id`.
      Also had to fix upstream: `formState.scheduledDate` was a display label ("Monday, Sep 7")
      from the Day-1 ScheduleModal fix, not a real date — a real booking needs an actual
      timestamp, so it's now a real ISO date (`toIsoDate`/`describeDate` added to `format.ts`),
      with the label only ever derived for display, never stored.
      Same recurring gotcha found yet again: `session_requests`, `sessions`, and
      `student_subject_enrollments` all had RLS but no INSERT/UPDATE/DELETE grants for
      `authenticated` — fixed via migration.
      One real bug caught and fixed during testing: `acceptSessionRequest` tried to set
      `session_requests.status` to `'confirmed'`, but the actual check constraint only allows
      `pending`/`accepted`/`declined`/`expired` — fixed to `'accepted'`.
      Also discovered (not yet fixed, logged for later): `e instanceof Error` — used in every
      error-catch block across this app, including the pre-existing `AvailabilityEditor.tsx`
      pattern this session's new components mirrored — is always `false` for Supabase's actual
      errors (plain objects, not real `Error` instances), so every "something went wrong"
      message in the app has been silently showing a generic fallback instead of the real
      reason. This is exactly what made the status-constraint bug above hard to diagnose.
      Verified live end-to-end via self-booking (the only real account available is both the
      tutor and, mechanically, a valid student for RLS purposes): booked a real "Mathematics,
      Grade 10" session with a real scheduled time, saw it appear correctly on the tutor's
      requests queue, accepted it and confirmed a real `sessions` row was created with correct
      math (R85/hr × 1h = R85 gross, 30% commission → R59.50 payout), then declined a second
      test request and confirmed no session was created for it. All test rows cleaned up
      afterward.
- [x] **Day 4 — Booking confirmation surfaces.** Done. Added `StudentSession` (types.ts) and
      `fetchUpcomingStudentSessions()` (queries.ts) — the student-side mirror of the tutor's
      `TutorSession`/`fetchUpcomingTutorSessions`, going through a two-hop embed
      (`sessions.tutor_id` → `tutor_profiles` → `profiles`) since there's no direct FK from
      sessions to the tutor's profile row. Wired into two real surfaces that were previously
      permanent placeholders regardless of reality: `SubHeaderBanner.tsx` now shows "You have N
      upcoming session(s)" instead of a hardcoded "no upcoming sessions," and
      `ManageAccountModal.tsx`'s "Sessions & History" tab (new `UpcomingSessionsPanel.tsx`) now
      lists real sessions instead of a permanent "No Active Sessions Pending" message. Chose the
      persistent-banner approach over a one-off toast for the "notification" — there's no
      `seen`/`notified` column in the schema, so a real one-time confirmation toast would need a
      schema change; the always-accurate persistent count needs none and satisfies the same
      goal (the student sees their real upcoming sessions on next load). Verified live: created
      a real future session, confirmed the count/list updated correctly in both places, deleted
      it, confirmed both reverted to their real empty states.
- [x] **Day 5 — End-to-end real-account testing.** Done — and it earned its place on the plan:
      testing with two genuinely independent accounts (rather than the Days 3-4 self-booking
      stand-in, where `student_id` and `tutor_id` happened to be the same user) surfaced three
      real bugs self-booking could never have caught, since it accidentally satisfied the
      conditions each bug violates:
      1. **Tutor-added subjects were invisible to search.** `verification_status` on
         `tutor_subject_competencies` defaults to `'pending'`, and the public RLS policy only
         shows `'verified'` ones — with no per-subject admin review queue built. Decided (with
         the user) to auto-verify on add for the pilot; `addTutorSubjectCompetency()` now sets
         `verification_status: 'verified'` explicitly, with the tutor's own document
         verification (`is_verified`) treated as the real trust gate.
      2. **Tutors couldn't see the subject/grade of their own incoming requests.** No RLS policy
         let a tutor read a student's `student_subject_enrollments` row at all — so the request
         queue silently showed "Any subject" instead of the real subject/grade. Fixed with a
         scoped SELECT policy: a tutor can see an enrollment only when it's tied to a
         `session_requests` row addressed to them.
      3. **Accepting a request failed outright.** The only INSERT policy on `sessions` required
         `auth.uid() = student_id` — but accepting is the *tutor's* action, so `auth.uid()` is
         the tutor, not the student. This is exactly the "current implementation" caveat flagged
         earlier in this doc's anonymous-matching section, now confirmed as a real, blocking bug
         once tested for real. Fixed with a scoped INSERT policy: a tutor can create a session
         only as themselves (`auth.uid() = tutor_id`) and only when a matching `pending` request
         from that exact student to that exact tutor exists — not a blanket "any tutor can
         insert any session" grant.
      Verified the complete loop for real: signed up a genuine tutor and a genuine student
      (via a temporary "Confirm email" toggle-off the user enabled and then re-enabled), built
      a real tutor profile and subject from scratch through the actual UI, searched as the
      student, booked, switched accounts and accepted as the tutor (correct commission math:
      R120/hr × 1h → R84 payout at 30%), and confirmed both sides reflect reality. All test
      accounts and data fully deleted afterward — verified counts back to baseline.
Days 1-5 above finished in a single real session, not five calendar days — so rather than
spend two more days on buffer/polish alone, the plan below replaces the old Day 6/7 placeholder
with a full second phase: take everything else already logged in this document (the anonymous-
matching architecture, payments, admin deployment, i18n foundation, and the smaller deferred
items) and actually build it, moving from "pilot" to "real production." Same "day" caveat as
above: a day here means a focused work session, not a guaranteed calendar day — some items
(payments especially) also depend on things outside pure coding time (provider sign-up/
approval), which is called out below where relevant.

## 7-day production plan (phase 2)

Same process rule as phase 1: stop at the end of each day and ask before continuing into the
next one, rather than assuming.

- [x] **Day 1 — Polish + the decisions everything else depends on.** Done. Two things bundled
      together because both need to happen before Day 2 can start cleanly:
      1. The original "Day 6 buffer" work — **done**: mobile spot-check across Learn home,
         Suggestions, the Teach screen (GO button, tier progress, requests, tips), and
         `ManageAccountModal` (Account Details, Teaching tab including the subject-add row) all
         held up cleanly at 375px, nothing broke. Deployed GitHub Pages build confirmed matching
         the latest commit and loading/signing-in cleanly (the one thing that looked like a
         mismatch — the GO button showing stale state — turned out to be because that day's
         fix hadn't been pushed yet, not a real bug). Misleading-copy sweep found and fixed
         three real overclaims: the footer's "...group workshops **worldwide**" (this is an
         SA-only pilot), the Help button's fabricated "24/7 Academic Support Center," and two
         fabricated specific numbers — the Activity toast's hardcoded "12 completed tutoring
         sessions" (now reads the real, currently-zero `userAccount.completedSessions`) and
         Schedule Session's fabricated "Typical response time < 3 mins" (removed outright, no
         data backs it).
      2. Two decisions, now made: **payments will use a real third-party processor — Paystack**
         (the user will sign up and hand over API keys, since account creation isn't something
         to do on their behalf); **anonymous-matching schema will make `session_requests.tutor_id`
         nullable until a tutor accepts**, rather than a separate broadcast table.
      Also: wire `TeachGoScreen`'s GO button to actually write
      `tutor_profiles.is_dispatch_active` — small, self-contained, no dependency on the bigger
      items below, so it's a good same-day win. **Done** — `updateTutorProfile()` extended to
      accept `isDispatchActive`; the button now reads/writes the real column instead of local
      `useState(false)`. Verified live: toggled Paul's real account off then back on, confirmed
      the DB value flipped both times, restored to its original `true` state afterward.
- [x] **Day 2 — Anonymous request/accept matching (the big one).** Done. Schema: made
      `session_requests.tutor_id` nullable, added `tier_id`, added policies so any qualifying
      tutor can view/claim an unclaimed pending request (RLS `USING`/`WITH CHECK` on an atomic
      conditional `UPDATE` makes "first tutor to claim wins" race-safe without a client-side
      transaction), and revised the `sessions` INSERT policy to check `status = 'accepted'`
      instead of `'pending'` since claiming now happens before the sessions row is created.
      `createSessionRequest()` no longer takes a `tutorId` (optional `tierId` instead); replaced
      `fetchIncomingSessionRequests`/`acceptSessionRequest`/`declineSessionRequest` with
      `fetchAvailableRequests()` + `acceptAvailableRequest()`, which throws if the claim UPDATE
      affects zero rows (someone else already took it). Deleted `IncomingSessionRequests.tsx`,
      added `AvailableRequestsQueue.tsx` (anonymous browse/accept/dismiss list, no student
      identity shown — `AvailableSessionRequest` in `types.ts` deliberately has no `studentName`
      field) and wired it into `TeachGoScreen`. Rewrote `PricesPage.tsx`: removed the individual
      named-tutor cards and per-card "Book Session" buttons entirely, replaced with an aggregate
      tutor-count + rate-range summary and a single "Send Request" button; the success state now
      reads "Request sent — searching for a tutor..." instead of naming one. Verified live,
      self-booking style (Paul@god.com as both student and tutor, the only real account
      available): sent an anonymous request as student, confirmed the `session_requests` row
      had `tutor_id = null`, saw it appear in the tutor's `AvailableRequestsQueue` with no
      student-identifying info, accepted it, confirmed the request flipped to
      `status = 'accepted'` with `tutor_id` filled and a real `sessions` row was created with
      correct rate/commission math — then deleted both test rows to restore baseline. One gap
      knowingly deferred: the atomic-claim race condition is trusted based on Postgres RLS
      semantics (`USING` evaluated against the OLD row), not yet empirically tested with two
      concurrent tutor sessions racing for the same request — worth a real two-account test
      before this matters for real money (Day 3+).
- [x] **Day 3 — Real payments.** Done. Two decisions made first: Paystack test keys ready to use
      immediately (not blocked on account setup), and the charge fires **on request send**
      (upfront), not on tutor accept — the user's explicit choice over the safer-but-simpler
      "charge on accept" option, accepting the tradeoff that an unclaimed/expired paid request
      has no refund path yet (see gap below).
      Built the `server/` workspace for the first time (previously just a placeholder):
      `server/index.ts`, a small Express app with two endpoints —
      `POST /api/payments/initialize` and `GET /api/payments/verify/:reference` — that hold the
      `PAYSTACK_SECRET_KEY` and proxy to Paystack's real API; `vite.config.ts` proxies `/api/*`
      to it (port 8787) so the browser never talks to Paystack or holds any key, same-origin, no
      CORS needed. Run it alongside `npm run dev` with `npm run server`.
      Schema: `session_requests` gained `payment_status` (unpaid/initiated/paid/failed/refunded),
      `paystack_reference`, `charged_amount`, `currency_code`. The two tutor-facing RLS policies
      ("view unclaimed pending requests" / "claim unclaimed pending requests") now also require
      `payment_status = 'paid'` — a request is invisible to every tutor until Paystack actually
      confirms the charge, so nobody can accept (and get a real `sessions` row created for) a
      request nobody paid for.
      Flow: student must pick a pricing tier before "Send Request" is enabled (PricesPage.tsx) —
      the tier's floor rate (`minRate`) is the only firm number available before a specific tutor
      is known, and payment needs a firm number. `createSessionRequest()` now takes a
      `paystackReference`/`chargedAmount` and inserts with `payment_status: 'initiated'`; the
      frontend then calls `/api/payments/initialize` and does a full-page redirect to Paystack's
      hosted checkout (not Inline.js — simpler, and the secret key never needs to leave the
      server this way). Paystack redirects back to the new `/payment/callback` route
      (`PaymentCallback.tsx`), which calls `/api/payments/verify/:reference` — re-checking the
      real status against Paystack's own API, never trusting the redirect's query params alone —
      then flips `payment_status` to `paid` or `failed` via the new
      `confirmSessionRequestPayment()`.
      Money-correctness decision: `acceptAvailableRequest()` now sets the resulting
      `sessions.gross_amount` from the request's own `charged_amount` (what was actually
      collected from the student), not the accepting tutor's individual `hourly_rate` — the two
      can legitimately differ slightly, since `charged_amount` is fixed to the tier's floor rate
      at send-time before any specific tutor is known. `gross_amount` must always match real
      money that moved. Only `platform_commission_pct` still comes from the accepting tutor's
      tier.
      Verified live end-to-end with real Paystack test-mode transactions (not mocked): sent a
      request as student (charged R50 via Paystack's own hosted checkout, using its "Success"
      test-card simulator), confirmed `payment_status` flipped from `initiated` to `paid` only
      after `/payment/callback` verified it, confirmed the request was invisible to the tutor
      queue before that and visible after, accepted it as tutor, and confirmed the resulting
      `sessions` row had `gross_amount = R50.00`, `tutor_payout_amount = R35.00` (30% commission)
      — exactly matching the real charge. Deleted the test rows afterward.
      Known gaps, explicitly deferred at the time: (1) **no refund path** — if a paid request is
      never accepted (expires) or the student wants to cancel, the money is already collected via
      Paystack and there's no automated refund or expiry job yet, just a permanently-pending
      request; this is the direct cost of the "charge upfront" choice.
      **Resolved 2026-09-05** (during Day 7's checklist walkthrough): built as two `pg_cron`
      jobs — see the "pg_cron jobs" note in `CLAUDE.md`'s database routing table for the full
      mechanism (expiry after 30 minutes past `requested_start`, async Paystack refund via
      `pg_net`, never marking `refunded` until Paystack's own response confirms it). Verified
      live with real Paystack test-mode calls: both a failing refund (bogus reference →
      `refund_failed`) and a real successful one (real transaction → `refunded`, confirmed via
      Paystack's "Refund has been queued for processing" response) reconciled correctly.
      (2) A failed/abandoned payment leaves a
      harmless orphaned `session_requests` row stuck at `payment_status: 'initiated'` or
      `'failed'` forever — invisible to tutors, but nothing currently cleans these up. (3) The
      atomic-claim race condition (flagged on Day 2) still hasn't been tested with two concurrent
      tutor sessions — now more important than before since real money is involved.
- [x] **Day 4 — Admin panel goes live + institution-based matching.** Institution matching:
      done and verified. Admin deployment: the code-only half done and verified; the actual
      private-network deployment (Tailscale/VPN mesh) is **explicitly not something an AI coding
      agent can do** — it needs a real account, installing real networking software, and system
      network config, all of which are outside what gets done autonomously here. See the note
      below for what's actually left.
      Institution matching: added `institution_id` (nullable FK to `schools_institutions`) to
      both `tutor_profiles` and `session_requests`. Null on either side is a wildcard ("not
      institution-restricted"), not "matches nobody" — a tutor who hasn't set one still matches
      every student, and vice versa; only when *both* sides have set one does it actually
      restrict. Tutors set theirs via a new field in `TeachingProfilePanel.tsx`'s edit form
      (reusing the existing `InstitutionModal`); students already had one via `BookingForm`/
      `InstitutionModal` — that flow now also captures the real `institution_id`, not just the
      display name (`InstitutionModal`'s callback signature changed to pass the whole
      `Institution`, not just its name). Wired into both `fetchTutors` (the aggregate
      count/rate-range on `PricesPage.tsx`) and `fetchAvailableRequests` (the tutor's real accept
      queue) — both had to change, not just one, or the displayed "N tutors available" estimate
      would lie about who the request actually reaches. Verified live: set the one real tutor's
      institution, confirmed the student-side count stayed at 1 when searching under the same
      institution and dropped to 0 under a different one; reset the tutor's institution back to
      null afterward to restore baseline.
      **Clarified intent (added after this was built):** the actual point of institution
      matching is to let a student request an **in-person** class and be matched with a tutor
      who is near, or actually attends, that institution — not a general-purpose filter that
      should apply regardless of format. The current implementation applies the institution
      filter uniformly to every request, online or in-person, which is broader than the real
      intent. Worth a real fix later: only apply the institution filter when the request is for
      an in-person session (needs `teachingMode`/session-format to actually be selectable per
      request first — right now `Tutor.teachingMode` exists but a session request doesn't carry
      its own format choice), and probably a real proximity notion ("near the institution") over
      time, not just an exact institution-id match. Logged here rather than silently left as an
      assumption.
      Admin deployment: confirmed the `admin/` app itself is in good shape — typechecks clean,
      already has its own `.env` with real Supabase credentials, starts on port 3100, and a real
      login (the existing `super_admin` row for Paul@god.com) loads real data (Tutor
      Verification, Users, etc. against the live database, not stubs). What's still missing is
      making it reachable from anywhere other than this dev machine's `localhost:3100` — that
      needs Tailscale (or similar) installed and configured, which means creating an account and
      changing this machine's networking, both squarely outside what should happen without the
      user directly doing it. **Next step is on the user**: install Tailscale (or preferred
      alternative), add this dev machine (and later, wherever `admin/` actually runs) to the same
      tailnet, then just run `npm run dev` inside `admin/` as usual — reachable at the machine's
      Tailscale IP instead of only `localhost` once that's done. Nothing in the codebase blocks
      this; it's pure infrastructure setup.
      **Verified 2026-09-06** (Day 7 checklist item 3): the user installed and connected
      Tailscale (`desktop-700gl5r`, `100.67.67.59`). Confirmed live: `admin/`'s dev server
      (already binding `--host=0.0.0.0`, no code change needed) is reachable at
      `http://100.67.67.59:3100` and renders the real login screen — not just a raw HTTP 200,
      the actual React app. This only holds while the dev server process itself is running and
      this machine stays on the tailnet — for a pilot with one admin on one machine that's fine;
      worth a persistent/background process (not a manually-run `npm run dev`) once more than
      one admin needs reliable access, and any other device that needs in must be added to the
      same tailnet separately (Tailscale's own admin console), not just this one.
- [x] **Day 5 — Social login + self-expanding subject taxonomy.** Self-expanding taxonomy: done
      and verified. Social login: the code side is fully done; actually enabling Google is
      blocked on the same class of thing as Day 4's Tailscale step — an external account/config
      change only the user can do. See below.
      Self-expanding taxonomy: `SubjectCompetencyEditor.tsx`'s subject field changed from a
      `<select>` locked to the official `subjects` list to a free-text input with a `<datalist>`
      for autocomplete — a tutor can now type anything. Typing a recognized subject behaves
      exactly as before. Typing an unrecognized one no longer blocks: `addTutorSubjectCompetency`
      still adds it to the tutor's profile immediately (so they can start teaching it right
      away), and a new `subject_candidates` table (RLS: tutor inserts/views own rows, admin reads
      via `is_active_admin()` for when a review screen exists) logs it for review via the new
      `logSubjectCandidate()`. Verified live: typed "Competitive Robotics" (unrecognized) — got
      added to the profile *and* logged as a candidate; typed "Mathematics" (recognized) — added
      normally, no candidate row created. Both test rows deleted afterward.
      **Found and fixed a real pre-existing bug while testing this**, unrelated to the taxonomy
      change itself: `tutor_subject_competencies.min_grade_level`/`max_grade_level` were
      `varchar(30)`, but `grade_levels.name` has entries longer than that (e.g. "Adult /
      Professional Development" is 33 chars) — picking that as a grade bound threw a raw
      Postgres "value too long" error on insert, for *any* subject, not just a new one. Widened
      both columns to `varchar(60)`.
      Social login: added `signInWithOAuth()` wiring — a shared `signInWithGoogle()` helper
      (`src/lib/oauth.ts`), a `GoogleSignInButton` on both `SignIn.tsx` and `CreateAccount.tsx`
      for both roles, and a new `/auth/callback` route (`AuthCallback.tsx`, deliberately outside
      `RequireAuth` since no session exists yet when it first loads). Handled a real wrinkle:
      Google's identity data has no room for our custom `role` field the way email/password
      `signUp()`'s `options.data` does, so the `on_auth_user_created` trigger would always
      default an OAuth signup to `student`. Fixed with a role-fixup round-trip: the chosen role
      is stashed in `localStorage` before redirecting to Google, and if it was `tutor`,
      `AuthCallback.tsx` calls a new `convertProfileToTutor()` (idempotent) that flips
      `profiles.role`, inserts a `tutor_profiles` row (needed a new self-insert RLS policy — only
      `UPDATE` existed before, since normal signup relies on the trigger — plus the matching
      `GRANT INSERT`, the recurring RLS-without-GRANT trap again), and removes the
      trigger-created `student_profiles` row.
      **Not verified end-to-end — cannot be, without real Google OAuth credentials**: enabling
      Google in Supabase Auth needs a Google Cloud Console OAuth client (id + secret), which
      means creating/using a Google Cloud project — an external account action outside what
      should happen without the user directly doing it, same as Day 4's Tailscale step. What I
      could verify: `tsc` is clean, `signInWithOAuth()` correctly returns Supabase's real
      authorize URL (confirmed via direct console call), and hitting that URL right now
      correctly 400s with Supabase's own `validation_failed` error — i.e. the code is wired
      correctly and is simply inert until Google is actually enabled. **Next step is on the
      user**: Supabase Dashboard → Authentication → Sign In / Providers → Google, plus a Google
      Cloud OAuth client with `https://wfpjoxetbprmllqqarwp.supabase.co/auth/v1/callback` as an
      authorized redirect URI. Once that's done, the existing button/route wiring should work
      without any further code changes — but it hasn't been exercised for real, so treat the
      first real attempt as the actual test.
      **Verified 2026-09-06** (Day 7 checklist item 2): the user set up the Google Cloud OAuth
      client and enabled Google in Supabase. Confirmed live: Supabase's `/auth/v1/authorize`
      endpoint now returns a real `302` to Google (previously 400'd with `validation_failed`),
      and following that redirect lands on a genuine Google "Sign in to continue to
      wfpjoxetbprmllqqarwp.supabase.co" screen — no `invalid_client`/`redirect_uri_mismatch`
      error, confirming the client id and redirect URI are both correctly configured. Stopped
      there deliberately (actually completing a Google sign-in needs the user's own account).
      **Open item: the Google OAuth consent screen is still in "Testing" publishing status** —
      only Google accounts explicitly added as Test users (Cloud Console → APIs & Services →
      OAuth consent screen → Test users, capped at 100) can complete sign-in; anyone else is
      blocked outright, not just warned. Fine for now while the pilot is a small hand-picked
      group — just make sure every real tester's Google email is added as a test user. Before
      opening Google sign-in to the general public, this needs to be **published to
      Production** in the same Cloud Console screen; expect an "unverified app" warning
      interstitial for users until domain verification + a privacy policy link are also done
      (shouldn't need Google's manual security review itself, since only basic `email`/`profile`
      scopes are requested — no sensitive scopes). Not yet done — a real go-live step, not code.
- [x] **Day 6 — Internationalization foundation.** Done — steps 2 and 3 of the phased plan above
      (currency + curriculum), deliberately not steps 1/4/5 (market decision, grade_levels/
      subjects generalization, `languages`-table-driven UI language list) — those still need the
      real expansion-target decision the plan itself says has to come first.
      Currency: new `src/lib/currencies.ts` holds a tiny in-memory symbol cache (seeded with
      `{ZAR: 'R'}` so nothing renders wrong before the real fetch resolves), populated once at
      startup from the real `currencies` table via `loadCurrencySymbols()` (called from
      `main.tsx`). `getCurrencySymbol(code)` replaces every literal `"R"` this session could
      find (`PricesPage.tsx`, `TeachingProfilePanel.tsx`, `TierSelectionPage.tsx`,
      `format.ts`'s `formatRateRange`) — `TierDefinition`, `Tutor`, and `TutorDashboardData` all
      gained a real `currencyCode` field (`tier_definitions`/`tutor_profiles.currency_code`,
      already-existing columns nothing previously read), and the Paystack payment flow
      (`payments.ts` → `server/index.ts`) now threads the tier's real `currencyCode` through
      instead of hardcoding `'ZAR'` in the charge itself. **Known limitation**: the symbol cache
      isn't reactive — a component reads the module-level cache directly at render time, so if
      `loadCurrencySymbols()` resolved after a component's last render, it won't pick up a
      changed symbol without some other re-render triggering first. Harmless today (every real
      row is `'ZAR'`, matching the synchronous fallback exactly), but worth a proper
      context/hook if a second currency ever actually ships.
      Curriculum: `fetchInstitutions()` now joins `schools_institutions.curriculum_id` →
      `curricula.name` (already fully backfilled — every one of the 25,566 seeded institution
      rows already had a `curriculum_id`, confirmed live) instead of reading the old
      `curriculum` enum column — `InstitutionModal.tsx` now shows real names like "CAPS
      (Curriculum and Assessment Policy Statement)" instead of the raw enum value `"caps"`.
      **Not migrated**: `tutor_subject_competencies.curriculum` — it never got a `curriculum_id`
      column in the first place (only `schools_institutions` did), so extending this would mean
      designing and backfilling a new migration, which is real scope beyond "wire up what's
      already seeded." Left on the old enum, flagged here rather than silently skipped.
      Verified live: `fetchInstitutions()` returns real curricula names (confirmed directly);
      `InstitutionModal` renders them; `PricesPage`'s aggregate rate, the tier-selection list,
      and the Paystack charge line all render `R` via the real symbol lookup, not a literal.
      `tsc` clean throughout.
- [x] **Day 7 — Full QA + marketing identity + ship.** Done, with "ship" meaning "the codebase
      is ready and every remaining step is a real external/account action for the user" — not a
      literal deploy, since GitHub push/deploy is still on hold per the standing instruction, and
      several of the remaining steps (payment provider going live, Google OAuth, private-network
      admin access) are things only the user can do, same pattern as Days 4-5.
      Full QA: re-ran the entire core money loop end-to-end after all of Days 4-6's changes
      (institution matching, subject taxonomy, social login code, currency/curriculum) to make
      sure nothing regressed — picked an institution, picked a real pricing tier (confirmed the
      Day 6 currency wiring: "Pay R50.00 & Send Request", and Paystack's own checkout correctly
      showed "Pay ZAR 50" using the real `currency_code`, not a hardcoded literal), paid via
      Paystack's real test-mode "Success" simulator, confirmed `/payment/callback` flipped
      `payment_status` to `paid`, confirmed the request appeared in the tutor's accept queue,
      accepted it, and confirmed the resulting `sessions` row had the correct real money math
      (`gross_amount: R50`, `tutor_payout_amount: R35` at 30% commission) — then deleted the test
      rows. `tsc --noEmit` clean across `src/`, `server/`, and `admin/`.
      Marketing identity: added to `CLAUDE.md`'s Identity section, alongside the existing
      head-developer and educator personas — a marketing/go-to-market perspective (positioning,
      messaging to each of student/parent/teen-tutor, launch sequencing), scoped explicitly to
      copy/onboarding-framing/launch decisions, not feature scoping or architecture.
      **What "ship" actually requires from here is a checklist of the user's own next steps** —
      external accounts, going live with real payments, admin deployment, and a few product
      decisions logged as gaps across Days 3-7. Nothing in the codebase blocks any of them. See
      the running "Day 7 go-live checklist" section right below — being worked through one item
      at a time as its own conversation, each one updated here as it's resolved or verified.

## Day 7 go-live checklist

Tracks the 5 items the user is working through after Day 7, one at a time — updated here as
each is resolved, not left to live only in chat.

1. **Payments — real money.** Live Paystack keys: pending, on the user (Paystack live-mode
   activation + settlement account). Refund policy: **resolved 2026-09-05** — see the Day 3
   retrospective above and the "pg_cron jobs" note in `CLAUDE.md`.
2. **Google sign-in.** **Verified 2026-09-06** — see the Day 5 retrospective above. Open
   sub-item: the OAuth consent screen is still in Testing publishing status (fine for a small
   hand-picked pilot group with test users added; needs to move to Production, with the
   "unverified app" tradeoff that comes with it, before the general public can use it).
3. **Admin panel — private network access.** **Verified 2026-09-06** — see the Day 4
   retrospective above. Tailscale connected, `admin/` confirmed reachable at
   `http://100.67.67.59:3100`, real login screen loads.
4. **Email.** Checked 2026-09-06: "Confirm email" is **correctly ON** — no action needed there.
   Sender is still Resend's shared `onboarding@resend.dev` test address — **pending**: verify a
   real domain in Resend (SPF/DKIM DNS records), then update the sender email in Supabase's SMTP
   settings to use it. Worth doing before real-volume signups; the shared test sender has its
   own rate limits and won't look legitimate to real users' inboxes.
5. **GitHub — nothing pushed since the "hold off" instruction.** Not started yet.

## Issue: charging the tier's floor while displaying a range is misleading

Flagged by the user (2026-09-05), after Day 7: the tiering system itself isn't the problem —
bands like "Peer-to-Peer Tutors: R50-R150/hr" are a reasonable way to segment quality/price
levels. The problem is specifically **how a student is charged against that range**. Today
(see Day 3's `acceptAvailableRequest`/`PricesPage.tsx`): the UI shows the *whole range*
("R50.00 - R150.00 / hr") right up until the moment of payment, then silently charges the
**floor** of that range (`selectedTier.minRate`) by default — a student sees a range implying
"could be anywhere in here," but always actually pays the cheapest end, regardless of which
tutor ends up accepting or what they'd normally charge. That's an inconsistent, arguably
misleading pattern: either show and charge a real single price, or don't show a range at all
once money is about to move.

Direction agreed: **be direct about the price, don't present a range at the point of charging.**
The exact mechanism (flat per-tier price instead of a min/max band? the tier's true midpoint?
something else?) isn't decided yet — logged here as a real, agreed-on UX/pricing-presentation
fix to make, not a "some day" idea. Worth resolving together with the "availability-driven
starting price" idea directly below, since both are about the same underlying question — what
number does a student actually see and pay — and solving them separately risks two
half-consistent answers.

Not yet scoped or built.

## Idea: availability-driven starting price

Currently a tier's displayed price range (e.g. "R50.00 - R150.00" for Peer-to-Peer Tutors) is
the static band from `tier_definitions` — it doesn't reflect who's actually available right now.
The idea: if, say, every currently-available tutor in that tier happens to charge R100/hr, the
"starting price" shown to a student searching right now should reflect that real R100 floor,
not the tier's theoretical R50 floor that no one available can actually deliver at.

This is a real-time pricing display idea, similar in spirit to how Uber shows a price band that
shifts with actual driver supply, not a fixed advertised rate. Worth thinking through before
building:
- What counts as "available right now" — `is_dispatch_active`, a real-time online status, or
  just any tutor in that tier regardless of dispatch state?
- Does this replace the static tier range entirely, or show both ("R50-R150 typical, R100+
  available now")?
- This would need a live query (min/max `hourly_rate` among available tutors filtered by
  tier + subject + grade level), computed at search time, not a static number from
  `tier_definitions`.

Not scoped or built — logged here as a product idea to think through later, not part of the
7-day pilot above.

## Future: add a marketing identity to CLAUDE.md

Once the app is actually complete (past the pilot, with the core loop real end-to-end), add a
marketing-facing identity/persona to `CLAUDE.md` — someone who thinks about positioning,
messaging, and go-to-market, the way the current identity additions cover product/engineering
and the educator-domain perspective. Not needed yet while the product itself is still being
built; revisit once there's something real to market.

## Future: the app's original purpose — onboarding high-schoolers as part-time tutors

This is outside the current 7-day production schedule entirely — a standing product vision to
come back to, not a day to schedule. Tutorlage's original intent isn't just to be a marketplace
that any qualifying adult tutor joins — it's specifically meant to **onboard high-performing high
schoolers** (e.g. the top ten students in each grade, Grades 10-12) into the tutoring program, so
they can earn money tutoring part-time alongside their own studies.

Eligibility to teach a subject **without prior tutoring experience**, under this route:
1. A minimum of **70% overall** in the subject they want to teach.
2. Must **pass a test derived from the platform** itself (content/competency to be defined) —
   this is required regardless of route.
3. Specifically for the student route (no prior experience): must go through **formal training
   offered by Tutorlage** before taking that test — the test isn't the first thing they attempt,
   the training is.

Not scoped or built yet — no schema, no onboarding flow, no training content, no test mechanism
exist for any of this today. `tutor_profiles.onboarding_status` and the admin Tutor Verification
queue are the closest existing pieces (document review + approve/reject), but they assume an
already-qualified adult tutor, not a structured minimum-grade-average → training → test pipeline
for teenagers. Logged here so this real product intent doesn't get lost while the 7-day plan
above is focused on getting the core marketplace loop working end-to-end first.

