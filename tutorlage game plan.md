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
- [ ] **Day 2 — Anonymous request/accept matching (the big one).** The architecture change
      already scoped in this doc's "The big one" section: a student sends a request without
      picking a named tutor, any matching tutor can see and accept it, only the accepting tutor
      is revealed to the student (and vice versa). Needs the schema change decided on Day 1,
      a tutor-facing browse/accept queue (replacing today's direct "Book Session" on a named
      card), removing the named-tutor-picking UI from `PricesPage.tsx`, and a real match-reveal
      notification. This changes the core booking UX, so build it deliberately and re-verify
      the whole booking loop against it afterward, the same way Day 5 of phase 1 did.
- [ ] **Day 3 — Real payments.** Integrate whatever was decided on Day 1. At minimum: a real
      charge at the point a session is confirmed (whatever "confirmed" means under the new Day-2
      matching flow), and the existing `hourly_rate_charged`/`gross_amount`/
      `platform_commission_pct`/`tutor_payout_amount` fields on `sessions` become real numbers
      tied to an actual transaction, not just bookkeeping copied from the tutor's profile.
- [ ] **Day 4 — Admin panel goes live + institution-based matching.** `admin/` is fully built
      but has never been deployed anywhere — set up the private network access (Tailscale/VPN
      mesh, per the earlier architecture decision) so tutor verification and dispute handling
      can actually happen for real bookings. Alongside that: add the institution link
      `tutor_profiles` is missing (schema change) and wire it into the search query, so "hyper-
      local matching" becomes real instead of collected-but-unused.
- [ ] **Day 5 — Social login + self-expanding subject taxonomy.** Enable Google (and any other
      relevant provider) in Supabase Auth and wire up `signInWithOAuth()` on the login/signup
      pages. Separately: let a tutor type a subject not on the official list during signup and
      have it logged as a candidate addition instead of being blocked, per the idea already
      discussed earlier in this document.
- [ ] **Day 6 — Internationalization foundation.** Wire the already-seeded `currencies`/
      `curricula` tables into the actual UI (replace the hardcoded `R` prefix and the old
      `curriculum` enum usage), per the phased plan in the "Internationalization plan" section
      above. Explicitly **not** in scope: fabricating a second country's schools/subjects/grade-
      level data — that still waits on a real decision about which market comes next, which
      isn't something to guess at just to fill out this schedule.
- [ ] **Day 7 — Full QA + marketing identity + ship.** End-to-end QA across the now much larger
      feature set (matching, payments, admin, i18n foundation, social login) — this is a real
      final pass, not a formality, given how much changed since phase 1's own Day 5 test. Add
      the marketing-facing identity to `CLAUDE.md` per the "Future" section below, now that
      there's something real to market. Ship.

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

