// The admin side of "a teaching credential approves the claimed subjects" (18 Nov 2026): what the subjects card shows and offers. The database function re-checks everything itself
// (supabase/tests/teaching_credential_approves_subjects.sql); this proves the screen never OFFERS the one-button path unless a verified credential with a verified document exists.
import { readFileSync } from 'node:fs';
import { credentialPath, type CredentialLine, type DocumentLine } from '../../admin/src/lib/teachingCredential';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const cred = (over: Partial<CredentialLine> = {}): CredentialLine => ({
  id: 'c1', code: 'sace_registered_teacher', label: 'SACE-registered qualified teacher', status: 'verified', obtainedOn: '2025-01-10', documentId: 'd1', provesCompetence: true, recencyYears: null, ...over,
});
const doc = (over: Partial<DocumentLine> = {}): DocumentLine => ({ id: 'd1', status: 'verified', type: 'teaching_qualification', ...over });
const TODAY = '2026-11-18';

const ok = credentialPath([cred()], [doc()], TODAY);
check('a verified credential that proves competence with a verified document: the button is offered', ok.kind === 'ready' && ok.credential.id === 'c1' && ok.documentType === 'teaching_qualification');
check('a student teacher on a verified academic record is offered it too', credentialPath([cred({ code: 'student_teacher_enrolled', label: 'Student teacher' })], [doc({ type: 'university_transcript' })], TODAY).kind === 'ready');
check('a credential whose document is only pending: NOT offered, the screen says why', credentialPath([cred()], [doc({ status: 'pending' })], TODAY).kind === 'document_not_verified');
check('a credential with no document at all: NOT offered', credentialPath([cred({ documentId: null })], [doc()], TODAY).kind === 'document_not_verified');
check('a document of the wrong kind (an identity copy) does not count', credentialPath([cred()], [doc({ type: 'identity_doc' })], TODAY).kind === 'document_not_verified');
check('a credential that does not prove competence (an exam marker): the checklist is the way', credentialPath([cred({ provesCompetence: false, code: 'exam_marker' })], [doc()], TODAY).kind === 'none');
check('a credential that is not verified: nothing', credentialPath([cred({ status: 'pending' })], [doc()], TODAY).kind === 'none');
check('no credential at all: nothing', credentialPath([], [doc()], TODAY).kind === 'none');
check('a credential past its recency window is not offered (5 years, obtained 6 years ago)', credentialPath([cred({ recencyYears: 5, obtainedOn: '2020-10-01' })], [doc()], TODAY).kind === 'none');
check('inside the window it is', credentialPath([cred({ recencyYears: 5, obtainedOn: '2022-10-01' })], [doc()], TODAY).kind === 'ready');
check('the first credential with a verified document wins over one whose document is pending', (() => {
  const p = credentialPath([cred({ id: 'a', documentId: 'dx' }), cred({ id: 'b', documentId: 'd1' })], [doc({ id: 'dx', status: 'pending' }), doc()], TODAY);
  return p.kind === 'ready' && p.credential.id === 'b';
})());

const card = read('admin/src/components/TutorSubjectsReviewCard.tsx');
const lib = read('admin/src/lib/teachingCredential.ts');
check('the subjects card offers "Approve all claimed subjects on the strength of this credential" only on the ready path, behind a confirm step', card.includes("cred.path.kind === 'ready'") && card.includes('Approve all claimed subjects on the strength of this credential') && card.includes('Yes, approve') && card.includes('rejected ones are left alone'));
check('the checklist stays below it for every subject (the review form is still rendered)', card.includes('<ReviewForm') && card.includes('Review again'));
check('it shows nothing new when the database update is not applied (the question fails or the column is missing)', lib.includes('available: false') && card.includes('cred && cred.available'));
check('the call is the one database function and nothing is written from the browser', lib.includes("rpc('admin_approve_subjects_on_credential'") && !/\.(insert|update|delete|upsert)\(/.test(lib));
check('the not-ready messages tell the admin the next step (verify the document, record the credential on the Level card, or use the checklist)', card.includes('document is not marked verified yet') && card.includes('record it as a credential on the Level card'));

if (failed > 0) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log('\nall ok');
