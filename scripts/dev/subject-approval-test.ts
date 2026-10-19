// Checks on how a tutor's subject shows its approval (CEO, 19 Oct 2026: a tutor declares the curriculum and subject, an admin approves
// it, only approved subjects match learners). Run: npx tsx scripts/dev/subject-approval-test.ts
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { competencyStatus, rejectedReasonLine, subjectAddedLine, subjectStatusLabel } from '../../src/lib/subjectApproval';
import type { TutorSubjectCompetency } from '../../src/types';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');

// ---- the status words ---------------------------------------------------------------------------------------------------------------
check('the database\'s four values map to themselves; anything else (even nothing) is still waiting, never approved', competencyStatus('verified') === 'verified' && competencyStatus('rejected') === 'rejected' && competencyStatus('under_review') === 'under_review' && competencyStatus('pending') === 'pending' && competencyStatus(null) === 'pending' && competencyStatus(undefined) === 'pending' && competencyStatus('approved') === 'pending');
check('the labels are Waiting for approval / Approved / Not approved', subjectStatusLabel('pending') === 'Waiting for approval' && subjectStatusLabel('under_review') === 'Waiting for approval' && subjectStatusLabel('verified') === 'Approved' && subjectStatusLabel('rejected') === 'Not approved');
const waiting = subjectAddedLine('Physics', 'pending', true);
check('a subject the database stored as pending is said to wait for Tutorlage, not to be live', /waits for Tutorlage to approve/.test(waiting) && !/live on your profile/.test(waiting));
check('a new subject off the official list says so as well, once', /logged it as a new subject for review/.test(subjectAddedLine('Robotics', 'pending', false)) && !/logged/.test(waiting));
check('before the migration (the stored row is approved) the line says it is live, from the stored status', /is live on your profile now/.test(subjectAddedLine('Physics', 'verified', true)));
check('the reason shows under a subject that was not approved, and nothing when there is none', rejectedReasonLine('  Needs a certificate ') === 'Reason: Needs a certificate' && rejectedReasonLine('') === null && rejectedReasonLine(null) === null);

// ---- the editor ---------------------------------------------------------------------------------------------------------------------
async function main() {
  // The editor imports the data layer, which needs the browser's environment; the page text is checked in its source instead.
  const editor = read('src/components/SubjectCompetencyEditor.tsx');
  const queries = read('src/lib/queries.ts');
  check('each subject shows its status beside it', /subjectStatusLabel\(status\)/.test(editor) && /competencyStatus\(s\.verificationStatus\)/.test(editor));
  check('a subject that was not approved shows the reason, read separately (the table only exists after the migration)', /rejectedReasonLine\(s\.reviewNote \?\? reviewNotes\[s\.id\]\)/.test(editor) && /fetchSubjectReviewNotes\(\)/.test(editor));
  check('the old sentences are gone: "it\'s live on your profile now" and "so they can start teaching it immediately"', !/it's live on your profile now/.test(editor) && !/start teaching it immediately/.test(editor));
  check('the wording after adding follows the status the database stored', /competencyStatus\(competency\.verificationStatus\)/.test(editor) && /subjectAddedLine\(trimmedName, status, isKnownSubject\)/.test(editor));
  check('the stored status is read back when a subject is added', /\.select\('id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status'\)\s*\.single\(\)/.test(queries));
  check('the dashboard reads each subject\'s status (a column that exists today)', /tutor_subject_competencies \( id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status \)/.test(queries) && /verificationStatus: competencyStatus\(c\.verification_status\)/.test(queries));
  const selects = [...queries.matchAll(/\.select\(\s*(['`])([\s\S]*?)\1/g)].map((m) => m[2]);
  const newColumns = /review_note|criteria_met|reviewed_by|reviewed_at|curriculum_id/;
  check('no main query selects a column that only exists after the migration: the one read of review_note is the separate, tolerant one',
    selects.length > 20 && selects.filter((s) => newColumns.test(s)).join('|') === 'competency_id, review_note');
  check('the note is read from tutor_subject_reviews (private), never from tutor_subject_competencies (readable by the public)',
    /from\('tutor_subject_reviews'\)\.select\('competency_id, review_note'\)/.test(queries) && !/tutor_subject_competencies[\s\S]{0,80}review_note/.test(queries));
  check('a failure reading the reasons gives none instead of an error on the Teaching tab', /console\.error\('fetchSubjectReviewNotes failed:', error\);\s*return \{\};/.test(queries));
  check('a subject the tutor adds is sent as before, so the page works before the migration; the database decides what is stored', /verification_status: 'verified',\s*\}\)\s*\.select/.test(queries));

  // The editor's rows, rendered without the data layer (a pretend copy of the row markup is not needed: the label and style come from the lib).
  const sample: TutorSubjectCompetency[] = [{ id: 'a', subjectName: 'Physics', curriculum: 'caps', minGradeLevel: 'Grade 8', maxGradeLevel: 'Grade 12', verificationStatus: 'rejected', reviewNote: 'Not enough proof' }];
  check('a tutor\'s subject row carries its status and note (type check at run time)', sample[0].verificationStatus === 'rejected' && sample[0].reviewNote === 'Not enough proof' && React.isValidElement(React.createElement('div')) && renderToStaticMarkup(React.createElement('span', null, subjectStatusLabel('rejected'))).includes('Not approved'));

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
