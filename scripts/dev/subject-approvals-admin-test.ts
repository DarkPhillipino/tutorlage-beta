// Checks on the admin app's Subject approvals and Curricula pages (CEO, 19 Oct 2026: a tutor declares a curriculum and subject, an admin
// approves it against editable criteria). Run: npx tsx scripts/dev/subject-approvals-admin-test.ts
// The database half is proved by supabase/tests/curriculum_availability_matching.sql; this checks the words, the rules the forms apply,
// that the pages tolerate an unapplied migration, and that every admin call uses the function and parameter names the migration defines.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { SubjectApprovalsBody, ReviewForm } from '../../admin/src/components/SubjectApprovalsBody';
import { CurriculaBody } from '../../admin/src/components/CurriculaBody';
import {
  approvalProblem,
  auditKindDetail,
  auditKindLabel,
  checklistFor,
  competencyStatus,
  curriculumLabel,
  notSwitchedOn,
  orderApprovals,
  rejectionProblem,
  statusLabel,
  tickedForSending,
} from '../../admin/src/lib/subjectApprovals';
import type { CriterionRow, CurriculumOption, SubjectApprovalRow } from '../../admin/src/types';

// The admin screens load the admin app's own copy of React, so they are rendered with that copy (two copies in one render break hooks).
const adminRequire = createRequire(new URL('../../admin/package.json', import.meta.url));
const React = adminRequire('react') as typeof import('react');
const { renderToStaticMarkup } = adminRequire('react-dom/server') as typeof import('react-dom/server');

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');

const crit = (id: string, curriculum: string, order: number, required: boolean, active = true): CriterionRow => ({ id, curriculum, sortOrder: order, text: `Line ${id}`, required, active });
const CRITERIA: CriterionRow[] = [crit('c3', 'caps', 3, true), crit('c1', 'caps', 1, true), crit('c2', 'caps', 2, false), crit('c4', 'caps', 4, true, false), crit('i1', 'ieb', 1, true)];
const sub = (id: string, status: SubjectApprovalRow['status'], addedAt: string, reviewedAt: string | null = null, extra: Partial<SubjectApprovalRow> = {}): SubjectApprovalRow => ({
  id, tutorId: `t-${id}`, tutorName: `Tutor ${id}`, subjectName: `Subject ${id}`, curriculum: 'caps', minGradeLevel: 'Grade 8', maxGradeLevel: 'Grade 12',
  status, reviewNote: null, reviewedAt, criteriaMet: [], addedAt, ...extra,
});

// ---- the rules ---------------------------------------------------------------------------------------------------------------------
const caps = checklistFor(CRITERIA, 'caps');
check('the checklist for a curriculum is its in-use lines in the set order', caps.map((c) => c.id).join() === 'c1,c2,c3' && checklistFor(CRITERIA, 'cambridge').length === 0);
check('approving needs every required line ticked (the optional one is not needed), and says how many are left', approvalProblem({ checklist: caps, ticked: ['c1'], note: '' }) === 'Tick every required line before approving (1 left).' && approvalProblem({ checklist: caps, ticked: ['c1', 'c3'], note: '' }) === null);
check('with no checklist for the curriculum, approving needs a written note of 3 letters or more', approvalProblem({ checklist: [], ticked: [], note: '' }) !== null && approvalProblem({ checklist: [], ticked: [], note: ' ok ' }) !== null && approvalProblem({ checklist: [], ticked: [], note: 'Saw the certificate' }) === null);
check('not approving needs a reason', rejectionProblem('') !== null && rejectionProblem('no') !== null && rejectionProblem('No proof for this subject') === null);
check('only lines on this curriculum\'s in-use checklist are sent as ticked', JSON.stringify(tickedForSending(caps, ['c1', 'c4', 'i1', 'zzz', 'c3'])) === '["c1","c3"]');
check('the status words are Waiting for approval / Approved / Not approved, and an unknown value is waiting', statusLabel('pending') === 'Waiting for approval' && statusLabel('under_review') === 'Waiting for approval' && statusLabel('verified') === 'Approved' && statusLabel('rejected') === 'Not approved' && competencyStatus('weird') === 'pending');
const ordered = orderApprovals([
  sub('ok-old', 'verified', '2026-10-01', '2026-10-02'), sub('rej', 'rejected', '2026-10-05', '2026-10-06'), sub('wait-new', 'pending', '2026-10-18'),
  sub('ok-new', 'verified', '2026-10-03', '2026-10-17'), sub('wait-old', 'under_review', '2026-10-10'),
]);
check('waiting subjects come first (the longest waiting first), then not approved, then approved (newest decision first)', ordered.map((r) => r.id).join() === 'wait-old,wait-new,rej,ok-new,ok-old');
check('curricula have their plain names', curriculumLabel('caps') === 'CAPS' && curriculumLabel('primary_caps') === 'Primary CAPS' && curriculumLabel('cambridge') === 'Cambridge');

// ---- the audit log ---------------------------------------------------------------------------------------------------------------
check('the audit log tells the new rows apart by their kind', auditKindLabel({ kind: 'subject_approved' }) === 'Subject approved' && auditKindLabel({ kind: 'subject_rejected' }) === 'Subject not approved' && auditKindLabel({ kind: 'curriculum_criterion' }) === 'Approval checklist line saved' && auditKindLabel({ kind: 'curriculum_criterion_deleted' }) === 'Approval checklist line deleted' && auditKindLabel({ kind: 'institution_curricula' }) === "A school's curricula changed");
check('a row with no kind, or one this page does not know, keeps the action name', auditKindLabel(null) === null && auditKindLabel({}) === null && auditKindLabel({ kind: 'something_else' }) === null && auditKindDetail({ kind: 'something_else' }) === null);
check('the detail line says what the action was about', auditKindDetail({ kind: 'subject_approved', subject: 'Physics', curriculum: 'ieb', note: 'Saw the certificate' }) === 'Physics (IEB): Saw the certificate' && auditKindDetail({ kind: 'subject_rejected', subject: 'Physics', curriculum: 'caps', reason: 'No proof' }) === 'Physics (CAPS): No proof' && auditKindDetail({ kind: 'curriculum_criterion', curriculum: 'caps', criterion: 'Line one' }) === 'CAPS: Line one' && auditKindDetail({ kind: 'institution_curricula', curricula: ['a', 'b'] }) === '2 extra curricula');
const auditPage = read('admin/src/pages/AuditLog.tsx');
check('the Audit Log page shows the kind label and detail', /auditKindLabel\(e\.metadata\) \?\? ACTION_LABELS\[e\.action\] \?\? e\.action/.test(auditPage) && /auditKindDetail\(e\.metadata\)/.test(auditPage));

// ---- the screens ----------------------------------------------------------------------------------------------------------------
const actions = { review: async () => undefined };
const rows: SubjectApprovalRow[] = [
  sub('w1', 'pending', '2026-10-18', null, { subjectName: 'Physics', tutorName: 'Thandi Nkosi' }),
  sub('r1', 'rejected', '2026-10-05', '2026-10-06', { reviewNote: 'No proof on file' }),
  sub('a1', 'verified', '2026-10-01', '2026-10-02'),
];
const tutorLink = (id: string, name: string) => React.createElement('a', { href: `/verification/${id}` }, name);
const page = renderToStaticMarkup(React.createElement(SubjectApprovalsBody, { rows, criteria: CRITERIA, actions, onChanged: () => undefined, tutorLink }));
check('the page lists waiting, not approved and approved subjects in three sections with their counts', /Waiting for approval <span[^>]*>\(1\)/.test(page) && /Not approved <span[^>]*>\(1\)/.test(page) && /Approved <span[^>]*>\(1\)/.test(page));
check('each subject shows the tutor\'s name linking to their page (where the documents are), the curriculum and the grades', /href="\/verification\/t-w1"[^>]*>Thandi Nkosi/.test(page) && /Physics/.test(page) && /CAPS · Grade 8 to Grade 12/.test(page));
check('a subject that was not approved shows the reason given; any decision can be reviewed again', /Note: No proof on file/.test(page) && (page.match(/Review again/g) ?? []).length === 2 && (page.match(/>Review</g) ?? []).length === 1);
const form = renderToStaticMarkup(React.createElement(ReviewForm, { row: rows[0], checklist: caps, actions, onChanged: () => undefined }));
check('the review form shows the checklist (the optional line marked), a note box, Approve and Do not approve', caps.every((c) => form.includes(`Line ${c.id}`)) && /\(optional\)/.test(form) && /<textarea/.test(form) && />Approve</.test(form) && />Do not approve</.test(form));
const noList = renderToStaticMarkup(React.createElement(ReviewForm, { row: { ...rows[0], curriculum: 'cambridge' }, checklist: [], actions, onChanged: () => undefined }));
check('a curriculum with no checklist says so and asks for a note', /There is no checklist for Cambridge yet/.test(noList) && !/type="checkbox"/.test(noList));
const notReady = renderToStaticMarkup(React.createElement(SubjectApprovalsBody, { rows, criteria: [], actions, onChanged: () => undefined, tutorLink, notSwitchedOn: true }));
check('before the migration the page says the database update is not applied instead of failing', /has not been applied yet/.test(notReady));

const curricula: CurriculumOption[] = [{ id: 'k1', code: 'CAPS', name: 'CAPS' }, { id: 'k2', code: 'IEB', name: 'IEB' }];
const cActions = { saveCriterion: async () => undefined, deleteCriterion: async () => undefined, searchSchools: async () => [], loadSchool: async () => null, saveSchoolCurricula: async () => undefined };
const curPage = renderToStaticMarkup(React.createElement(CurriculaBody, { criteria: CRITERIA, curricula, actions: cActions, onChanged: () => undefined }));
check('the Curricula page has a tab for each of the six curricula, the CAPS lines (not the IEB line) with Save and Delete, and a box to add a line',
  ['CAPS', 'IEB', 'Cambridge', 'Tertiary', 'Primary CAPS', 'Other'].every((n) => curPage.includes(`>${n}</button>`)) && /Line c1/.test(curPage) && /Line c4/.test(curPage) && !/Line i1/.test(curPage) && (curPage.match(/>Save</g) ?? []).length === 4 && /aria-label="Delete this line"/.test(curPage) && />Add line</.test(curPage));
check('the Curricula page has a school search (3 letters or more)', /aria-label="Search a school"/.test(curPage) && /3 letters or more/.test(curPage));
const curNot = renderToStaticMarkup(React.createElement(CurriculaBody, { criteria: null, curricula, actions: cActions, onChanged: () => undefined }));
check('before the migration the checklist says the database update is not applied', /has not been applied yet/.test(curNot) && !/Add line/.test(curNot));

// ---- tolerance of an unapplied migration -------------------------------------------------------------------------------------------
check('a missing table, column or function counts as "not switched on yet"; a real failure does not',
  notSwitchedOn({ code: '42P01' }) && notSwitchedOn({ code: 'PGRST205' }) && notSwitchedOn({ code: '42703' }) && notSwitchedOn({ code: 'PGRST202' }) && notSwitchedOn({ message: 'column tutor_subject_competencies.review_note does not exist' }) && !notSwitchedOn({ code: '42501', message: 'permission denied' }) && !notSwitchedOn(null));
const q = read('admin/src/lib/curriculumQueries.ts');
check('the subjects are read with no review column; the note and ticks come from their own table, read separately, and a missing table means no notes yet',
  /select\(COMPETENCY_COLUMNS\)/.test(q) && !/review_note|criteria_met/.test((q.match(/const COMPETENCY_COLUMNS = '[^']*'/) ?? [''])[0]) &&
  /from\('tutor_subject_reviews'\)\s*\.select\('competency_id, review_note, reviewed_at, criteria_met'\)/.test(q) && /if \(notSwitchedOn\(error\)\) return new Map\(\);/.test(q));
check('a note and ticks are only attached to a subject that has been decided (a changed subject goes back to waiting without the old decision)', /status === 'verified' \|\| status === 'rejected' \? reviews\.get\(r\.id\) : undefined/.test(q));
check('a missing checklist table or school functions give null (the page says so), not an error', /if \(notSwitchedOn\(error\)\) return null;/.test(q) && /if \(notSwitchedOn\(r\.error\)\) return null;/.test(q));

// ---- every call matches the migration ----------------------------------------------------------------------------------------------
const mig = read('supabase/migrations/20261019090000_curriculum_and_availability_matching.sql');
const fn = (name: string) => mig.match(new RegExp(`function public\\.${name}\\(([\\s\\S]*?)\\)\\s*returns`))?.[1] ?? '';
const callParams = (name: string) => [...(q.match(new RegExp(`rpc\\('${name}', \\{([\\s\\S]*?)\\}\\)`))?.[1] ?? '').matchAll(/(p_\w+):/g)].map((m) => m[1]);
const defParams = (name: string) => [...fn(name).matchAll(/\b(p_\w+)\b/g)].map((m) => m[1]);
for (const name of ['admin_review_tutor_subject', 'admin_save_curriculum_criterion', 'admin_delete_curriculum_criterion', 'admin_set_institution_curricula', 'school_curricula']) {
  const used = callParams(name);
  const defined = defParams(name);
  check(`the call to ${name} uses exactly the parameters the migration defines`, used.length > 0 && used.length === defined.length && used.every((p) => defined.includes(p)), `${used.join(',')} vs ${defined.join(',')}`);
}
check('the migration keeps the review notes private: their own table, readable by signed-in users only (nothing for anon), and no review column on the public subject table',
  /create table if not exists public\.tutor_subject_reviews/.test(mig) && /revoke all on public\.tutor_subject_reviews from anon, authenticated;\s*grant select on public\.tutor_subject_reviews to authenticated;/.test(mig) &&
  !/tutor_subject_competencies\s+add column[^;]*(review_note|reviewed_|criteria_met)/i.test(mig) && !/(new|old)\.(review_note|reviewed_|criteria_met)/.test(mig));
check('the admins-read-all-subjects policy is for signed-in users only (anon cannot run is_active_admin, so a policy for everyone would break every signed-out read of the subject table)',
  /create policy "Admins read all tutor competencies" on public\.tutor_subject_competencies for select to authenticated using \(public\.is_active_admin\(\)\)/.test(mig));
check('the checklist is read from curriculum_criteria and the extras from institution_curricula, both of which the migration creates', /create table if not exists public\.curriculum_criteria/.test(mig) && /create table if not exists public\.institution_curricula/.test(mig) && /from\('curriculum_criteria'\)/.test(q) && /from\('institution_curricula'\)/.test(q));
const layout = read('admin/src/components/AdminLayout.tsx');
const appRoutes = read('admin/src/App.tsx');
check('the menu has Subject Approvals (verification officers and super admins) and Curricula (super admin), and the routes exist',
  /to: '\/subject-approvals', label: 'Subject Approvals'[^}]*roles: \['verification_officer', 'super_admin'\]/.test(layout) && /to: '\/curricula', label: 'Curricula'[^}]*roles: \['super_admin'\]/.test(layout) && /path="subject-approvals"/.test(appRoutes) && /path="curricula"/.test(appRoutes));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
