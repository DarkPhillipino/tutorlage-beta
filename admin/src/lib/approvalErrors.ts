// Approving a tutor needs an ID document and a police clearance certificate on file (CEO, 21 Oct 2026; migration 20261020180000, not applied
// yet). The database refuses the approval with a short token naming what is missing:
//   approval_needs_documents:identity_missing,police_clearance_missing   (or police_clearance_expired)
// This turns it into a plain sentence for the admin, and checks the same rule on the screen first so the button can say so before it is
// pressed. The screen check works with or without the migration; the database refusal only exists once it is applied.
import { getErrorMessage } from './errors';
import { policeCertificateProblem, todayIsoSAST } from './tutorOnboarding';

const PHRASES: Record<string, string> = {
  identity_missing: 'an ID document or passport that has not been rejected',
  police_clearance_missing: 'a police clearance certificate that has not been rejected, issued in the last 6 months',
  police_clearance_expired: 'a police clearance certificate issued in the last 6 months (the one on file is older, has no issue date, or the date is not valid)',
};

function sentence(codes: string[]): string {
  const list = codes.map((code) => PHRASES[code] ?? code);
  const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
  return `Not approved. This tutor still needs ${joined} on file. Ask them to add it, then try again.`;
}

// The codes from the database's refusal, or null when the message is something else.
export function approvalCodesFromMessage(message: string | null | undefined): string[] | null {
  const match = /approval_needs_documents:([a-z_,]+)/.exec(message ?? '');
  if (!match) return null;
  const codes = match[1].split(',').filter(Boolean);
  return codes.length > 0 ? codes : null;
}

export function describeApprovalError(e: unknown, fallback: string): string {
  const message = getErrorMessage(e, '');
  const codes = approvalCodesFromMessage(message);
  return codes ? sentence(codes) : message || fallback;
}

export interface DocumentForApproval {
  documentType: string;
  status?: string | null;
  issuedOn?: string | null;
}

// What the database will want that is not on file, in the same codes. [] when the tutor is ready on documents.
export function approvalDocumentGaps(docs: DocumentForApproval[], today = todayIsoSAST()): string[] {
  const live = docs.filter((d) => d.status !== 'rejected');
  const gaps: string[] = [];
  if (!live.some((d) => d.documentType === 'identity_doc')) gaps.push('identity_missing');
  const police = live.filter((d) => d.documentType === 'police_clearance');
  if (police.length === 0) gaps.push('police_clearance_missing');
  else if (!police.some((d) => d.issuedOn && policeCertificateProblem(d.issuedOn, today) === null)) gaps.push('police_clearance_expired');
  return gaps;
}

export function approvalGapsSentence(docs: DocumentForApproval[], today = todayIsoSAST()): string | null {
  const gaps = approvalDocumentGaps(docs, today);
  return gaps.length > 0 ? sentence(gaps) : null;
}
