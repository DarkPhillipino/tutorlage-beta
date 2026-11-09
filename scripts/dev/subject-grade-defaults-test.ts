// Checks on the Grade R to 9 subjects (Monday queue item 2, 9 Nov 2026): the starting grades a tutor gets for each, that the migration adds
// exactly those six names and nothing else, and that every grade list on the learner and tutor screens still comes from the database's
// grade_levels table (Grade R to Grade 12), never a fixed Grade 10 to 12 list. Run: npx tsx scripts/dev/subject-grade-defaults-test.ts
import fs from 'node:fs';
import { CAPS_BAND_SUBJECTS, capsGradeBand } from '../../src/lib/subjectGradeDefaults';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');
const stripSqlComments = (sql: string) => sql.replace(/--.*$/gm, '');

// The grade list as the database holds it (production, 9 Nov 2026, sort order).
const GRADES = ['Grade R', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12',
  '1st Year Undergraduate', '2nd Year Undergraduate', '3rd Year Undergraduate', '4th Year Undergraduate', 'Honours', "Master's", 'PhD', 'Adult / Professional Development'];

// ---- the starting grades ------------------------------------------------------------------------------------------------------------
const band = (s: string) => capsGradeBand(s, GRADES);
const show = (s: string) => { const b = band(s); return b ? `${b.min} to ${b.max}` : 'none'; };
check('Life Skills starts at Grade R to Grade 6', show('Life Skills') === 'Grade R to Grade 6', show('Life Skills'));
check('Natural Sciences and Technology starts at Grade 4 to Grade 6', show('Natural Sciences and Technology') === 'Grade 4 to Grade 6', show('Natural Sciences and Technology'));
check('Natural Sciences starts at Grade 7 to Grade 9 (a different subject from the Grade 4 to 6 one)', show('Natural Sciences') === 'Grade 7 to Grade 9', show('Natural Sciences'));
check('Technology and Economic and Management Sciences start at Grade 7 to Grade 9', show('Technology') === 'Grade 7 to Grade 9' && show('Economic and Management Sciences') === 'Grade 7 to Grade 9');
check('Social Sciences starts at Grade 4 to Grade 9', show('Social Sciences') === 'Grade 4 to Grade 9', show('Social Sciences'));
check('capitals and extra spaces do not matter', show('  natural   SCIENCES and technology ') === 'Grade 4 to Grade 6' && show('LIFE SKILLS') === 'Grade R to Grade 6');
check('any other subject has no set range (the boxes keep the whole list, as before)',
  show('Mathematics') === 'none' && show('English Home Language') === 'none' && show('Life Orientation') === 'none' && show('Civil Technology') === 'none' && show('') === 'none' && show('Natural') === 'none');
check('a grade list that does not hold both ends gives no range instead of a wrong one', capsGradeBand('Life Skills', ['Grade 10', 'Grade 11', 'Grade 12']) === null && capsGradeBand('Life Skills', []) === null);
check('the spelling of the loaded list is the one used', capsGradeBand('Life Skills', ['grade r', 'grade 6'])?.min === 'grade r' && capsGradeBand('Life Skills', ['grade r', 'grade 6'])?.max === 'grade 6');

// ---- the migration -------------------------------------------------------------------------------------------------------------------
const migrationName = fs.readdirSync(new URL('supabase/migrations/', root)).find((f) => f.endsWith('_primary_phase_subjects.sql'));
check('the migration file exists', !!migrationName, migrationName ?? 'missing');
if (migrationName) {
  const sql = read(`supabase/migrations/${migrationName}`);
  const code = stripSqlComments(sql);
  const values = [...(code.match(/from \(values([\s\S]*?)\) as v\(name\)/i)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  check('it adds exactly six names', values.length === 6, values.join(' | '));
  check('they are the six the tutor screen gives a starting range for (same spelling)',
    [...values].map((v) => v.toLowerCase()).sort().join('|') === [...CAPS_BAND_SUBJECTS].sort().join('|'));
  check('each name is in the exact DBE spelling with capitals', values.every((v) => v === v.trim() && /^[A-Z][A-Za-z ]+$/.test(v)));
  check('it only inserts: no update, delete, drop, alter, truncate or grant anywhere in the code', !/\b(update|delete|drop|alter|truncate|grant|revoke)\b/i.test(code.replace(/raise exception[^;]*;/gi, '')));
  check('it only touches the subjects table', (code.match(/\bpublic\.[a-z_0-9]+/gi) ?? []).every((t) => t.toLowerCase() === 'public.subjects'));
  check('it can run twice: it skips a name that exists in any capitals and has ON CONFLICT DO NOTHING', /where not exists \(select 1 from public\.subjects s where lower\(btrim\(s\.name\)\) = lower\(v\.name\)\)/i.test(code) && /on conflict \(name\) do nothing/i.test(code));
  check('it stops itself if a name is missing afterwards', /if n <> 6 then\s*raise exception/i.test(code));
  check('it does not add the six to the Tier 1 list (that route is Grade 12 results and has no tests for them)', !/tier1/i.test(code));
}
const testSql = read('supabase/tests/primary_phase_subjects.sql');
check('the rolled-back test names all six subjects and ends by raising (so nothing is kept)',
  CAPS_BAND_SUBJECTS.every((s) => testSql.toLowerCase().includes(`'${s}'`)) && /raise exception E'GRADE R TO 9 SUBJECTS TEST \(rolled back\)/.test(testSql));

// ---- the screens --------------------------------------------------------------------------------------------------------------------
const queries = read('src/lib/queries.ts');
check('the grade list is read from the grade_levels table in order (Grade R first)', /fetchGradeLevelSuggestions[\s\S]{0,200}\.from\('grade_levels'\)\s*\.select\('name'\)\s*\.order\('sort_order'\)/.test(queries));
check('the subject list is read from the subjects table', /fetchSubjectSuggestions[\s\S]{0,200}\.from\('subjects'\)\s*\.select\('name'\)\s*\.order\('name'\)/.test(queries));
for (const f of ['src/components/LearnerGradeModal.tsx', 'src/components/LearnersPanel.tsx', 'src/components/ManageAccountModal.tsx', 'src/components/SubjectCompetencyEditor.tsx']) {
  check(`${f.split('/').pop()} takes its grades from the database list`, /fetchGradeLevelSuggestions\(\)/.test(read(f)));
}
check('no screen holds its own list of grade names (a Grade 10 to 12 list would hide Grade R to 9)',
  !/\[\s*'Grade (R|1|8|9|10)'\s*,\s*'Grade/.test(['src/components/LearnerGradeModal.tsx', 'src/components/LearnersPanel.tsx', 'src/components/ManageAccountModal.tsx', 'src/components/SubjectCompetencyEditor.tsx', 'src/components/BookingForm.tsx', 'src/components/PricesPage.tsx'].map(read).join('\n')));
const editor = read('src/components/SubjectCompetencyEditor.tsx');
check('the tutor screen sets the grade boxes from the subject until the tutor moves one herself',
  /capsGradeBand\(value, gradeLevelOptions\)/.test(editor) && /if \(gradesTouched \|\| gradeLevelOptions\.length === 0\) return;/.test(editor)
  && /moveGrade\('min', e\.target\.value\)/.test(editor) && /moveGrade\('max', e\.target\.value\)/.test(editor) && /setGradesTouched\(true\);\s*beforeBand\.current = null;/.test(editor));
check('a subject with no set range leaves the boxes as the tutor had them: they go back after a Grade R to 9 subject, and after adding it (no regression for Grade 10 to 12 tutors)',
  /beforeBand = useRef/.test(editor) && /if \(!beforeBand\.current\) beforeBand\.current = \{ min: minGradeLevel, max: maxGradeLevel \};/.test(editor)
  && /\} else \{\s*restoreGrades\(\);\s*\}/.test(editor) && /setGradesTouched\(false\);\s*restoreGrades\(\);/.test(editor) && !/gradeLevelOptions\[0\]\);\s*setMax/.test(editor));
check('the subject box calls the new handler (not setSubjectName directly)', /onChange=\{\(e\) => handleSubjectChange\(e\.target\.value\)\}/.test(editor));
check('the tutor is told which grades CAPS uses and that she can narrow them', /CAPS teaches this subject in \{appliedBand\.min\} to \{appliedBand\.max\}\. Change the grades if you teach fewer\./.test(editor));
check('a tutor who picks Primary CAPS is told it only matches primary schools (curriculum_covers: CAPS covers both, Primary CAPS only itself)', /Choose CAPS if you teach learners at any school\. Primary CAPS only matches learners at schools listed as primary schools\./.test(editor));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
