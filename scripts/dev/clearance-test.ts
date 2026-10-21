// Checks on the police clearance messages (CEO, 21 Oct 2026; migration 20261020180000, not applied): the two accept tokens become plain
// sentences for the tutor, the approval token becomes a plain sentence for the admin, the tutor's list says "add a current certificate",
// and the app keeps working when the migration is not applied. Run:
//   npx --no-install tsx scripts/dev/clearance-test.ts
import fs from 'node:fs';
import { CLEARANCE_COPY, clearanceBanner, clearanceProblemFromMessage, describeAcceptError, toClearanceStatus } from '../../src/lib/clearance';
import { approvalCodesFromMessage, approvalDocumentGaps, approvalGapsSentence, describeApprovalError } from '../../admin/src/lib/approvalErrors';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');
const TODAY = '2026-10-21';

// ---- the tutor's side ------------------------------------------------------------------------------------------------------------
check('A1 the missing token becomes a sentence with no token in it', describeAcceptError(new Error('police_clearance_missing'), 'x') === CLEARANCE_COPY.police_clearance_missing && !/police_clearance_/.test(CLEARANCE_COPY.police_clearance_missing));
check('A2 the expired token becomes its own sentence', describeAcceptError(new Error('police_clearance_expired'), 'x') === CLEARANCE_COPY.police_clearance_expired);
check('A3 a Supabase-style error object (not an Error) works too', describeAcceptError({ message: 'police_clearance_expired', code: '42501' }, 'x') === CLEARANCE_COPY.police_clearance_expired);
check('A4 the token inside a longer message is still found', clearanceProblemFromMessage('Error: police_clearance_missing (42501)') === 'police_clearance_missing');
check('A5 any other message is shown as it was (the database sentences are already plain)', describeAcceptError(new Error('Another tutor already accepted this request, or it is no longer available.'), 'x') === 'Another tutor already accepted this request, or it is no longer available.');
check('A6 an empty failure falls back to the given sentence', describeAcceptError({}, 'Could not accept that request.') === 'Could not accept that request.');
check('A7 the sentences say what to do and where, and the 6 months', /Teaching tab/.test(CLEARANCE_COPY.police_clearance_missing) && /6 months/.test(CLEARANCE_COPY.police_clearance_expired));

check('B1 a status row with a problem becomes a stop banner', clearanceBanner(toClearanceStatus({ problem: 'police_clearance_missing', latest_issued_on: null, expires_on: null }), TODAY)?.tone === 'stop');
check('B2 a fine certificate that runs out in 3 days gets a gentle reminder with the date', (() => {
  const b = clearanceBanner(toClearanceStatus({ problem: null, latest_issued_on: '2026-04-24', expires_on: '2026-10-24' }), TODAY);
  return b?.tone === 'soon' && /24 October 2026/.test(b.text);
})());
check('B3 a fine certificate with months left shows nothing', clearanceBanner(toClearanceStatus({ problem: null, latest_issued_on: '2026-09-21', expires_on: '2027-03-21' }), TODAY) === null);
check('B4 exactly 14 days left still reminds, 15 does not', clearanceBanner({ problem: null, latestIssuedOn: null, expiresOn: '2026-11-04' }, TODAY)?.tone === 'soon' && clearanceBanner({ problem: null, latestIssuedOn: null, expiresOn: '2026-11-05' }, TODAY) === null);
check('B5 no status (the migration is not applied, or not a tutor) shows nothing at all', clearanceBanner(null, TODAY) === null && toClearanceStatus(undefined) === null && toClearanceStatus(null) === null);
check('B6 an unknown problem value is not shown as a stop', toClearanceStatus({ problem: 'something_else' })?.problem === null);

// ---- the admin's side ------------------------------------------------------------------------------------------------------------
check('C1 the approval token names what is missing', /ID document or passport/.test(describeApprovalError(new Error('approval_needs_documents:identity_missing,police_clearance_missing'), 'x')) && /police clearance certificate/.test(describeApprovalError(new Error('approval_needs_documents:identity_missing,police_clearance_missing'), 'x')));
check('C2 only the ID missing says only the ID', (() => { const s = describeApprovalError({ message: 'approval_needs_documents:identity_missing' }, 'x'); return /ID document/.test(s) && !/police/.test(s); })());
check('C3 an old certificate is described as too old, not as missing', /older, has no issue date/.test(describeApprovalError(new Error('approval_needs_documents:police_clearance_expired'), 'x')));
check('C4 no token appears in the sentence', !/approval_needs_documents|_missing|_expired/.test(describeApprovalError(new Error('approval_needs_documents:identity_missing,police_clearance_expired'), 'x')));
check('C5 other database messages are untouched (the age rule)', describeApprovalError(new Error('Tutors must be 18 or older'), 'x') === 'Tutors must be 18 or older');
check('C6 the codes are read out of the message', JSON.stringify(approvalCodesFromMessage('x approval_needs_documents:identity_missing,police_clearance_missing y')) === JSON.stringify(['identity_missing', 'police_clearance_missing']) && approvalCodesFromMessage('nothing') === null);

const doc = (documentType: string, status: string | null, issuedOn: string | null = null) => ({ documentType, status, issuedOn });
check('D1 no documents: both missing', JSON.stringify(approvalDocumentGaps([], TODAY)) === JSON.stringify(['identity_missing', 'police_clearance_missing']));
check('D2 an ID and a certificate issued exactly 6 months ago: ready', approvalDocumentGaps([doc('identity_doc', 'pending'), doc('police_clearance', 'pending', '2026-04-21')], TODAY).length === 0);
check('D3 a certificate one day older: expired', JSON.stringify(approvalDocumentGaps([doc('identity_doc', 'verified'), doc('police_clearance', 'verified', '2026-04-20')], TODAY)) === JSON.stringify(['police_clearance_expired']));
check('D4 a rejected ID does not count', JSON.stringify(approvalDocumentGaps([doc('identity_doc', 'rejected'), doc('police_clearance', 'pending', TODAY)], TODAY)) === JSON.stringify(['identity_missing']));
check('D5 a rejected certificate counts as missing', JSON.stringify(approvalDocumentGaps([doc('identity_doc', 'pending'), doc('police_clearance', 'rejected', TODAY)], TODAY)) === JSON.stringify(['police_clearance_missing']));
check('D6 a certificate with no date, or dated tomorrow, is expired', JSON.stringify(approvalDocumentGaps([doc('identity_doc', 'pending'), doc('police_clearance', 'pending', null)], TODAY)) === JSON.stringify(['police_clearance_expired']) && JSON.stringify(approvalDocumentGaps([doc('identity_doc', 'pending'), doc('police_clearance', 'pending', '2026-10-22')], TODAY)) === JSON.stringify(['police_clearance_expired']));
check('D7 an old certificate next to a current one: ready (the newest counts)', approvalDocumentGaps([doc('identity_doc', 'pending'), doc('police_clearance', 'verified', '2026-01-01'), doc('police_clearance', 'pending', '2026-09-01')], TODAY).length === 0);
check('D8 ready means no sentence', approvalGapsSentence([doc('identity_doc', 'pending'), doc('police_clearance', 'pending', TODAY)], TODAY) === null);

// ---- the app and the migration agree --------------------------------------------------------------------------------------------
const migration = read('supabase/migrations/20261020180000_police_clearance_checks.sql');
const queue = read('src/components/AvailableRequestsQueue.tsx');
const data = read('src/lib/clearanceData.ts');
const detail = read('admin/src/pages/TutorVerificationDetail.tsx');
const panel = read('src/components/VerificationDocumentsPanel.tsx');
check('E1 the tokens the app knows are exactly the ones the migration raises', Object.keys(CLEARANCE_COPY).every((t) => migration.includes(`'${t}'`)) && /return 'police_clearance_expired'/.test(migration) && /return 'police_clearance_missing'/.test(migration));
check('E2 the approval token the admin reads is the one the migration raises', /raise exception 'approval_needs_documents:%'/.test(migration) && /'identity_missing'/.test(migration));
check('E3 both accept functions call the shared check and raise its token', (migration.match(/v_problem := public\.police_clearance_problem\(/g) ?? []).length === 2 && (migration.match(/raise exception '%', v_problem using errcode = '42501'/g) ?? []).length === 2);
check('E4 the accept functions are the only functions the migration replaces', ['claim_session_request', 'accept_session_request'].every((f) => new RegExp(`create or replace function public\\.${f}\\(`).test(migration)) && (migration.match(/create or replace function public\.(?!police_clearance_problem|enforce_tutor_documents_on_verify|my_police_clearance_status|claim_session_request|accept_session_request)/g) ?? []).length === 0);
check('E5 the request list maps the refusal and shows the banner', /describeAcceptError\(e, 'Could not accept that request\.'\)/.test(queue) && /clearanceBanner\(clearance\)/.test(queue) && /data-clearance-banner/.test(queue));
check('E6 reading the status ignores a missing function and any failure (works before the migration)', /isMissingDatabaseFunction\(error\)/.test(data) && /return null;/.test(data) && /supabase\.rpc\('my_police_clearance_status'\)/.test(data));
check('E7 the admin screen maps the approval refusal', /describeApprovalError\(e, 'Could not approve this tutor\.'\)/.test(detail));
check('E8 a tutor with no onboarding record is held to the two documents on the admin screen too', /if \(!onboarding\) \{[\s\S]{0,260}approvalGapsSentence/.test(detail));
check('E9 the tutor can give the date of a police certificate where grandfathered tutors can reach it (the Teaching tab)', /policeCertificateProblem\(issuedOn\)/.test(panel) && /issued_on: issuedOn/.test(panel) && /isPolice \? \{ issued_on/.test(panel));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
