// Where tapping a notification in the header goes (the CEO, 16 Oct 2026: it should open the person's sessions, not leave
// them to dig through Manage Account). Almost every notification is about a session or a payment, so the default is the
// "Sessions & history" page. The two that tell a tutor a learner is waiting for THEM belong on the Teach screen, where the
// request list is, and so does "You have an upcoming session" (a tutor's session was booked: 17 Oct 2026), because the Teach
// screen lists the tutor's upcoming sessions with "Start video call". The notice that the Terms and Privacy Policy were updated (CEO, 17 Oct 2026: tell people, do not stop them)
// opens the Terms in a new tab, so nobody loses their place. A tutor's level notices (a level given by an admin or earned, a
// level change, a rate freeze: written by the database when the level really changes, types `tier_promotion`, `tier_demotion`
// and `tier_freeze`) open the Teach screen, where the level is shown (CEO, 19 Oct 2026: tell a tutor when an admin gives them a level).
// So do the notices that Tutorlage approved or did not approve one of a tutor's subjects (`subject_approved`, `subject_rejected`:
// written by admin_review_tutor_subject, 19 Oct 2026); the Teach screen is where the tutor's subjects are.
export type NotificationTarget = 'sessions' | 'teach' | 'terms';

const TEACH_TYPES = new Set([
  'request_for_you',
  'request_for_you_reminder',
  'session_booked',
  'tier_promotion',
  'tier_demotion',
  'tier_freeze',
  'subject_approved',
  'subject_rejected',
]);
const TERMS_TYPES = new Set(['terms_updated']);

export function notificationTarget(type: string): NotificationTarget {
  if (TERMS_TYPES.has(type)) return 'terms';
  return TEACH_TYPES.has(type) ? 'teach' : 'sessions';
}
