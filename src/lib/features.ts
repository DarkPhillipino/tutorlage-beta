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
} as const;
