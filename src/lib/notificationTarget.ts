// Where tapping a notification in the header goes (the CEO, 16 Oct 2026: it should open the person's sessions, not leave
// them to dig through Manage Account). Almost every notification is about a session or a payment, so the default is the
// "Sessions & history" page. The two that tell a tutor a learner is waiting for THEM belong on the Teach screen, where the
// request list is. The notice that the Terms and Privacy Policy were updated (CEO, 17 Oct 2026: tell people, do not stop them)
// opens the Terms in a new tab, so nobody loses their place.
export type NotificationTarget = 'sessions' | 'teach' | 'terms';

const TEACH_TYPES = new Set(['request_for_you', 'request_for_you_reminder']);
const TERMS_TYPES = new Set(['terms_updated']);

export function notificationTarget(type: string): NotificationTarget {
  if (TERMS_TYPES.has(type)) return 'terms';
  return TEACH_TYPES.has(type) ? 'teach' : 'sessions';
}
