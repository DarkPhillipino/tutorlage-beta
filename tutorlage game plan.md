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

- **Payments and payouts**: no real money moves through the platform yet. Whether to build
  in-house banking/payout handling or lean on a third-party payments processor is still an open
  question.
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
something to assume details on and just build. **Deferred past the 7-day pilot below** — kept
scoped out deliberately so the pilot ships with the simpler direct-booking model instead.

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
- [ ] **Day 6 — Buffer / polish.** Whatever Days 1-5 didn't finish, plus a pass on anything that
      would visibly embarrass a pilot: mobile responsiveness spot-check, any remaining
      misleading copy, a final look at the deployed GitHub Pages build itself (not just local
      dev).
- [ ] **Day 7 — Buffer / ship.** Final QA pass and go live. If Days 1-6 finished early, this day
      simply doesn't get used — the goal is 7 days or fewer, not exactly 7.

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

## Suggested rough order for what's next

1. Finish hardening the existing Learn flow (the open errors file) so what's already built is
   solid before layering the bigger anonymous-matching change on top of it.
2. Design (not yet build) the anonymous request/accept matching flow — schema changes, tutor
   acceptance UI, match-reveal notification.
3. Decide the payments/payouts approach (in-house vs. third-party) — this blocks "real" booking
   regardless of the matching model chosen above.
4. Wire the international tables into the actual UI once a second market is genuinely being
   planned — no need to build this ahead of an actual need.
