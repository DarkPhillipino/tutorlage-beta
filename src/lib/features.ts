// Switches for features that were built ahead of their launch. ONE PRODUCT (CEO, 16 Oct 2026): the testers test the
// real product, so every built feature whose database part is applied is ON. All seven were switched on on 16 Oct
// 2026 after the CEO's "all seven, video rooms first"; each is still a switch so that a feature that proves faulty can be
// hidden again with a one-word change and a publish, without removing its code.
export const FEATURES = {
  // Learners' school results (report cards and assessment marks): migration 20261012090100 (applied to dev 12 Oct).
  schoolResults: true,
  // The Tier 1 route for tutors without a teaching qualification: migration 20261012090200 (applied to dev 12 Oct).
  tier1Pipeline: true,
  // Tutors' document uploads on the Teaching page (master 7bq, 7bl): the upload-and-verify step for SACE and police
  // clearances, with a 6-month expiry. Needs the tutor_onboarding migrations (applied to dev 13 Oct).
  verificationDocuments: true,
  // Video rooms on our own WebRTC (master 7bm, design v2): the /room routes. Migration 20261009200000 applied to dev on
  // 16 Oct 2026; the Worker runs with VIDEO_ROOMS_ENABLED=1 and VIDEO_RELAY_ONLY=1 (wrangler.jsonc) and the two relay secrets.
  videoRooms: true,
  // "Continue with Google" / "Sign up with Google" on the sign-in and sign-up pages, with the "or" line and the
  // note under them. Changing this to false hides every Google button (GoogleSignInButton also checks it). The
  // /auth/callback route stays, so a half-finished Google sign-in still lands somewhere.
  googleSignIn: true,
  // The tutor's second and third sign-up pages (master 7cx): "beginner or experienced tutor", then ID or passport,
  // police clearance, results or proof of experience. Migrations 20261013180000 and 20261013180100 (applied to dev 13
  // Oct). Tutors that existed when the migration ran are never asked.
  tutorOnboarding: true,
  // "Tell me when a tutor is available" on the "No tutor can take this request yet" screen (master 7cz). Migration
  // 20261014090000 (applied to dev 14 Oct).
  tutorWaitlist: true,
  // Keep or swap (master 7aa + 7da; the CEO's principle and answers of 14 Oct 2026): after a session the learner (or the parent)
  // can keep the tutor and book them again, or try someone else; a tutor can say they cannot carry on. "My tutors" on the
  // Sessions tab, the choice on a completed session, "Book again" on the request page, "Sent to you" and "Can't take this one"
  // in the tutor's list, "Learners you have taught" on the Teaching tab. Migration 20261014200000 (applied to dev 16 Oct).
  // The tutor's list reads waiting requests through the new database function when it exists (the privacy fix, 7db) and
  // falls back to the old read when it does not.
  keepOrSwap: true,
} as const;
