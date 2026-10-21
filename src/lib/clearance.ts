// A tutor's police clearance certificate at accepting (CEO, 21 Oct 2026; migration 20261020180000, not applied yet).
// The database refuses to let a tutor accept a request unless they have a police clearance certificate on file that was not rejected and
// was issued in the last 6 months. It answers with one of two short tokens; this file turns them into plain sentences, and into the line
// the request list shows ("add a current certificate") before the tutor tries.
// Everything here works before and after the migration (see clearanceData.ts for the read of the tutor's status). No database import here, so
// the checks in scripts/dev/clearance-test.ts can run it under Node.
import { getErrorMessage } from './errors';
import { formatIsoLong, todayIsoSAST } from './tutorOnboarding';

export type ClearanceProblem = 'police_clearance_missing' | 'police_clearance_expired';

export interface ClearanceStatus {
  problem: ClearanceProblem | null;
  // yyyy-mm-dd: the newest certificate that was not rejected, and the last day it counts.
  latestIssuedOn: string | null;
  expiresOn: string | null;
}

const WHERE = 'Open the menu, choose the Teaching tab and add it under "Verification Documents".';

export const CLEARANCE_COPY: Record<ClearanceProblem, string> = {
  police_clearance_missing: `You need a police clearance certificate on file to accept requests. Add one that was issued in the last 6 months. ${WHERE}`,
  police_clearance_expired: `Your police clearance certificate is not current (it must have been issued in the last 6 months), so you cannot accept requests. Add a new one. ${WHERE}`,
};

// The token anywhere in a message (the Worker passes the database's text through as it is).
export function clearanceProblemFromMessage(message: string | null | undefined): ClearanceProblem | null {
  const match = /\bpolice_clearance_(missing|expired)\b/.exec(message ?? '');
  return match ? (`police_clearance_${match[1]}` as ClearanceProblem) : null;
}

// What to show a tutor whose attempt to accept failed: the plain sentence for a clearance token, otherwise the message as before.
export function describeAcceptError(e: unknown, fallback: string): string {
  const message = getErrorMessage(e, '');
  const problem = clearanceProblemFromMessage(message);
  return problem ? CLEARANCE_COPY[problem] : message || fallback;
}

// A row from my_police_clearance_status() as a status. Anything else (no row: not a tutor) is null.
export function toClearanceStatus(row: unknown): ClearanceStatus | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as { problem?: unknown; latest_issued_on?: unknown; expires_on?: unknown };
  const problem = r.problem === 'police_clearance_missing' || r.problem === 'police_clearance_expired' ? r.problem : null;
  return {
    problem,
    latestIssuedOn: typeof r.latest_issued_on === 'string' ? r.latest_issued_on : null,
    expiresOn: typeof r.expires_on === 'string' ? r.expires_on : null,
  };
}

// The sentence for the top of the request list, or null when there is nothing to say. A certificate that is fine but runs out within
// two weeks gets a gentle reminder, so the tutor does not find out when a request is refused.
export function clearanceBanner(status: ClearanceStatus | null, today = todayIsoSAST()): { tone: 'stop' | 'soon'; text: string } | null {
  if (!status) return null;
  if (status.problem) return { tone: 'stop', text: CLEARANCE_COPY[status.problem] };
  if (status.expiresOn && status.expiresOn >= today && status.expiresOn <= addDaysIso(today, 14)) {
    return {
      tone: 'soon',
      text: `Your police clearance certificate counts until ${formatIsoLong(status.expiresOn)}. Add a new one before then so you can keep accepting requests. ${WHERE}`,
    };
  }
  return null;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
