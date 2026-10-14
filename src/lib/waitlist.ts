// "Tell me when a tutor is available" (master item 7cz; the CEO agreed on 14 Oct 2026).
// Pure helpers for the waiting-list prompt, so the matching and the wording can be checked exactly
// (scripts/dev/waitlist-test.ts). The database side is migration 20261014090000 (join_tutor_waitlist,
// leave_tutor_waitlist, the notifier); the calls are in queries.ts.

export interface WaitlistEntry {
  id: string;
  studentId: string;
  subject: string;
  gradeLevel: string | null;
  institutionId: string | null;
  createdAt: string;
}

export interface WaitlistSearch {
  studentId: string;
  subject: string;
  gradeLevel: string | null;
  institutionId: string | null;
}

// Case and surrounding spaces never matter (the database ignores them too).
export const normalise = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase();

// The open entry (if any) that is waiting for exactly this search, so the page can say "you're on the list".
export function findOpenEntry(entries: WaitlistEntry[], search: WaitlistSearch): WaitlistEntry | null {
  return (
    entries.find(
      (e) =>
        e.studentId === search.studentId &&
        normalise(e.subject) === normalise(search.subject) &&
        normalise(e.gradeLevel) === normalise(search.gradeLevel) &&
        (e.institutionId ?? null) === (search.institutionId ?? null),
    ) ?? null
  );
}

// Friendly wording for what the database can refuse (SQLSTATE codes from join_tutor_waitlist).
export function describeWaitlistError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case '55000':
      return 'A tutor has just become available. Go back and search again.';
    case '54000':
      return 'You already have 10 requests waiting. Remove one before adding another.';
    case '42501':
      return 'You can only ask for yourself or for a learner you look after.';
    case '22023':
      return 'Choose a subject first.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

// What the page tells people, in one place so the promise stays honest: the only way we tell them is the bell.
export const WAITLIST_COPY = {
  button: 'Tell me when a tutor is available',
  joining: 'Adding you…',
  joinedTitle: "You're on the list",
  joinedBody:
    "We'll tell you here, in the bell at the top of the page, as soon as an approved tutor teaches this subject and grade. We don't contact you anywhere else.",
  keptFor: 'We keep your request for up to 60 days.',
  leave: 'Stop telling me',
  intro: "Nobody teaches this yet. Want us to tell you when somebody does?",
} as const;
