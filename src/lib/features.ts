// Switches for phase 2 features that are built but not yet switched on (CEO, 9 Oct 2026: nothing new reaches
// the site until the 12th, and phase 2 features wait for their database migrations). Turning one on is a
// publish, so it needs the CEO's go-ahead like any other.
export const FEATURES = {
  // Learners' school results (report cards and assessment marks): migration 20261012090100.
  schoolResults: false,
  // The Tier 1 route for tutors without a teaching qualification: migration 20261012090200.
  tier1Pipeline: false,
  // Tutors' document uploads on the Teaching page (master 7bq). Off during test phase 1: approval doesn't look at
  // them, so the panel's "Tutorlage checks these" line wasn't true, and testers mustn't upload real ID copies. In
  // phase 2 it becomes the upload-and-verify step for SACE and police clearances (7bl), with a 6-month expiry.
  verificationDocuments: false,
  // Video rooms on our own WebRTC (master 7bm, design v2): the /room routes. Needs migration 20261009200000, the
  // server switch VIDEO_ROOMS_ENABLED=1, a new tester-notice version (the notice names Cloudflare as carrying the
  // video room; it must name whoever carries the calls now), and the CEO's yes.
  videoRooms: false,
  // "Continue with Google" / "Sign up with Google" on the sign-in and sign-up pages, with the "or" line and the
  // note under them. ON today (nothing changes). Test phase 1 is email sign-in only, so if the CEO says "hide Google
  // for phase 1", change this to false and publish: that one word hides every Google button (GoogleSignInButton
  // also checks it). The /auth/callback route stays, so a half-finished Google sign-in still lands somewhere.
  googleSignIn: true,
  // The tutor's second and third sign-up pages (master 7cx): "beginner or experienced tutor", then ID or passport,
  // police clearance, results or proof of experience. OFF: test phase 1 must not collect real ID copies (see
  // verificationDocuments above), and the privacy policy's tutor-screening section has to be updated by legal first
  // (Drake/legal/drafts/tutor-documents-page-copy-DRAFT.md). Needs migrations 20261013180000 and 20261013180100 on the
  // database. To try it locally, put VITE_TUTOR_ONBOARDING=1 in .env; to switch it on for everyone, replace the
  // expression with `true` and publish (the CEO's go-ahead). Tutors that existed when the migration ran are never asked.
  tutorOnboarding: import.meta.env?.VITE_TUTOR_ONBOARDING === '1',
  // "Tell me when a tutor is available" on the "No tutor can take this request yet" screen (master 7cz; the CEO
  // agreed on 14 Oct 2026). OFF until migration 20261014090000 is on the database, because the button calls its
  // functions. To try it locally: apply the migration to dev (needs the CEO's yes), then put VITE_TUTOR_WAITLIST=1
  // in .env. To switch it on for everyone, replace the expression with `true` and publish (the CEO's go-ahead).
  tutorWaitlist: import.meta.env?.VITE_TUTOR_WAITLIST === '1',
  // Keep or swap (master 7aa + 7da; the CEO's principle and answers of 14 Oct 2026): after a session the learner (or the parent)
  // can keep the tutor and book them again, or try someone else; a tutor can say they cannot carry on. "My tutors" on the
  // Sessions tab, the choice on a completed session, "Book again" on the request page, "Sent to you" and "Can't take this one"
  // in the tutor's list, "Learners you have taught" on the Teaching tab. OFF until migration 20261014200000 is on the database
  // (the buttons call its functions). To try it locally: apply the migration to dev (needs the CEO's yes), then put
  // VITE_KEEP_OR_SWAP=1 in .env. To switch it on for everyone, replace the expression with `true` and publish (the CEO's go-ahead).
  // NOT behind this switch: the tutor's list reads waiting requests through the new database function when it exists
  // (the privacy fix, 7db) and falls back to the old read when it does not, so that part is safe before and after.
  keepOrSwap: import.meta.env?.VITE_KEEP_OR_SWAP === '1',
} as const;
