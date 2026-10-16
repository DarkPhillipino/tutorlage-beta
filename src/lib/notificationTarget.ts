// Where tapping a notification in the header goes (the CEO, 16 Oct 2026: it should open the person's sessions, not leave
// them to dig through Manage Account). Almost every notification is about a session or a payment, so the default is the
// "Sessions & history" page. The two that tell a tutor a learner is waiting for THEM belong on the Teach screen, where the
// request list is.
export type NotificationTarget = 'sessions' | 'teach';

const TEACH_TYPES = new Set(['request_for_you', 'request_for_you_reminder']);

export function notificationTarget(type: string): NotificationTarget {
  return TEACH_TYPES.has(type) ? 'teach' : 'sessions';
}
