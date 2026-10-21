// The admin app's half of error tracking (release gate OPS-ERRORS-01): reads public.client_errors (migration 20261020160000), which
// only an active admin can read. One row is one KIND of error (same kind + message + screen) with a count and the first and last time
// it was seen. The table holds no names, emails, tokens or ids, by design.
//
// Pure on purpose (no Supabase import) so scripts/dev/error-log-test.ts can check it under Node; the read itself is fetchClientErrors in
// queries.ts. Tolerant: the table may not exist on the database yet, so a missing table is a plain "not switched on yet" state, never a
// broken page.

export type ErrorKind = 'render' | 'unhandled' | 'rejection' | 'logged' | 'overflow';

export interface ClientErrorRow {
  id: number;
  kind: ErrorKind;
  message: string;
  screen: string;
  details: string | null;
  browser: string | null;
  occurrences: number;
  signedIn: number;       // how many of the times the person was signed in
  signedOut: number;      // the rest
  firstSeen: string;
  lastSeen: string;
}

export type ClientErrorsResult =
  | { state: 'ok'; rows: ClientErrorRow[] }
  | { state: 'not_set_up' }                 // the table is not on this database yet (migration not applied)
  | { state: 'failed'; message: string };

export const KIND_LABELS: Record<ErrorKind, string> = {
  render: 'A screen crashed',
  unhandled: 'Uncaught error',
  rejection: 'Failed action nobody caught',
  logged: 'Logged by the app',
  overflow: 'Too many new errors',
};

export interface RawClientErrorRow {
  id: number;
  kind: ErrorKind;
  message: string;
  screen: string;
  details: string | null;
  browser: string | null;
  occurrences: number;
  signed_in_occurrences: number;
  first_seen: string;
  last_seen: string;
}

export function mapClientError(r: RawClientErrorRow): ClientErrorRow {
  return {
    id: r.id,
    kind: r.kind,
    message: r.message,
    screen: r.screen,
    details: r.details,
    browser: r.browser,
    occurrences: r.occurrences,
    signedIn: r.signed_in_occurrences,
    signedOut: Math.max(r.occurrences - r.signed_in_occurrences, 0),
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
  };
}

// PostgREST says PGRST205 when the table is not in its schema cache; Postgres says 42P01 when it does not exist.
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /client_errors/i.test(error.message ?? '') && /(does not exist|schema cache|not find)/i.test(error.message ?? '')
  );
}

export interface ClientErrorSummary {
  kinds: number;            // different errors on the list
  occurrences: number;      // times they happened, all together
  lastDay: number;          // kinds seen again in the last 24 hours
  newThisWeek: number;      // kinds first seen in the last 7 days
}

export function summariseClientErrors(rows: ClientErrorRow[], now: Date = new Date()): ClientErrorSummary {
  const day = now.getTime() - 24 * 3600 * 1000;
  const week = now.getTime() - 7 * 24 * 3600 * 1000;
  let occurrences = 0;
  let lastDay = 0;
  let newThisWeek = 0;
  for (const r of rows) {
    occurrences += r.occurrences;
    if (new Date(r.lastSeen).getTime() >= day) lastDay += 1;
    if (new Date(r.firstSeen).getTime() >= week) newThisWeek += 1;
  }
  return { kinds: rows.length, occurrences, lastDay, newThisWeek };
}

// "3 signed in, 1 signed out" in plain words; nothing when there is no split to show.
export function describeWho(row: Pick<ClientErrorRow, 'signedIn' | 'signedOut'>): string {
  const parts: string[] = [];
  if (row.signedIn > 0) parts.push(`${row.signedIn} signed in`);
  if (row.signedOut > 0) parts.push(`${row.signedOut} signed out`);
  return parts.join(', ');
}

export function describeAgo(iso: string, now: Date = new Date()): string {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
