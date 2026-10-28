// Checks on Tier 1 by documents (migration 20261021142000; CEO 21 Oct 2026: "documents first, test later"): the migration text, the
// tutor's panel and library, and the admin check screen. Reads the source files; no network, no key.
// Run: npx tsx scripts/dev/tier1-documents-path-test.ts
import fs from 'node:fs';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const read = (f: string) => fs.readFileSync(f, 'utf8');
const strip = (s: string) => s.replace(/--.*$/gm, '');

const mig = read('supabase/migrations/20261021142000_tier1_documents_path.sql');
const code = strip(mig);
const lib = read('src/lib/tier1.ts');
const panel = read('src/components/Tier1Panel.tsx');
const adminPage = read('admin/src/pages/Tier1.tsx');
const adminLib = read('admin/src/lib/tier1.ts');
const features = read('src/lib/features.ts');

// ---- the migration -------------------------------------------------------------------------------------------------
check('the migration sets the documents route as the default, with the three settings and never overwrites one', /'tier1_route', '"documents"'::jsonb/.test(code) && /tier1_documents_wide_mark_pct', '80'/.test(code) && /tier1_documents_narrow_max_grade', '"Grade 10"'/.test(code) && /on conflict \(setting_key\) do nothing/.test(code));
check('it adds one column and one internal function, closed to every API role', /add column if not exists conduct_accepted_at timestamptz/.test(code) && /revoke all on function public\.tier1_grant_documents\(uuid\) from public, anon, authenticated, service_role;/.test(code));
const replaced = [...code.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).sort();
check('it replaces exactly these functions and no others', JSON.stringify(replaced) === JSON.stringify(['admin_check_tier1_record', 'tier1_grant_documents', 'tier1_status', 'tier1_submit_module_check', 'tier1_training_complete']), replaced.join(', '));
check('every function in it is a definer with a pinned search path', (code.match(/security definer\s+set search_path = public/g) ?? []).length === 5);
check('the test and the sign-off functions are not touched (tier1_start_test, tier1_submit_test, admin_record_tier1_signoff, tier1_grant_subject)', !/function public\.(tier1_start_test|tier1_submit_test|admin_record_tier1_signoff|tier1_grant_subject|tier1_academic_ok|tier1_complete_module)\(/.test(code));
check('the full route keeps the old rule: all seven modules, no conduct needed, no grant without the test', /<> 'full' then/.test(code) && /not exists \(\s*select 1 from public\.tier1_modules m/.test(code) && /if v_route = 'full' or not public\.is_tutor/.test(code));
check('the documents route needs Module 7 passed AND the conduct agreement; an admin acceptance needs a written note of 20+ characters (full route excepted)', /t\.module = 7 and t\.result in \('complete', 'pass'\) and t\.conduct_accepted_at is not null/.test(code) && /v_route <> 'full' and length\(btrim\(coalesce\(p_note, ''\)\)\) < 20/.test(code));
check('the grant skips a subject that is already verified, closed subjects, and marks under the minimum', /c\.verification_status = 'verified'\) then\s+continue;/.test(code) && /s\.status <> 'closed'/.test(code) && /a\.mark_pct >= v_min/.test(code));
check('the grade ceiling applies only under the wide-mark setting and caps both ends', /r\.best < v_wide and v_cap is not null/.test(code) && /max_grade_level = case/.test(code) && /min_grade_level = case/.test(code));
check('whichever of the record check and Module 7 comes last triggers the grant', /v_granted := public\.tier1_grant_documents\(v_row\.tutor_id\)/.test(code) && /v_granted := public\.tier1_grant_documents\(auth\.uid\(\)\)/.test(code));
check('the conduct agreement is read from the answers and never removed', /p_answers ->> 'conduct'/.test(code) && /coalesce\(tt\.conduct_accepted_at, excluded\.conduct_accepted_at\)/.test(code));
check('the status reply keeps every old key and adds route, safeguarding_done, conduct_accepted, subject_verified, min_pct', ['subject', 'subject_status', 'rules', 'academic', 'academic_ok', 'training_complete', 'attempts', 'passed', 'can_start', 'reason', 'next_retake_at', 'open_attempt', 'route', 'safeguarding_done', 'conduct_accepted', 'subject_verified', 'min_pct'].every((k) => new RegExp(`'${k}',`).test(code)));
check('no key-shaped text in any new file', ![mig, lib, panel, adminPage, read('supabase/tests/tier1_documents_path.sql')].some((t) => /(sk_live_|pk_live_|whsec_)/.test(t)));

// ---- the tutor's library and panel -----------------------------------------------------------------------------------
check('an older database (no route in the reply) means the old three-gate route', /route: d\.route === 'documents' \? 'documents' : 'full'/.test(lib));
check('the library never reads the new column from the table, so the app also works before the migration is applied', !/conduct_accepted_at/.test(lib) && /select\('module, result, method, trainer_name, missing_items'\)/.test(lib));
check('the conduct agreement travels inside the answers and only when ticked', /agreeConduct \? \{ \.\.\.answers, conduct: true \} : answers/.test(lib));
check('the new status fields are read defensively (=== true), and the minimum falls back to 70', /safeguardingDone: d\.safeguarding_done === true/.test(lib) && /conductAccepted: d\.conduct_accepted === true/.test(lib) && /minPct: Number\(d\.min_pct \?\? 70\)/.test(lib));
const docsBranch = panel.slice(panel.indexOf("status.route === 'documents' && ("), panel.indexOf("status.route !== 'documents' && ("));
const fullBranch = panel.slice(panel.indexOf("status.route !== 'documents' && ("), panel.indexOf('const StepHeading'));
check('the documents route shows the record, Module 7 and the conduct agreement, the result and the optional guide', ['AcademicStep', 'SafeguardingStep', 'VerifiedStep', 'OptionalGuide'].every((c) => docsBranch.includes(`<${c}`)));
check('the documents route never shows the training list or the test', !docsBranch.includes('TrainingStep') && !docsBranch.includes('TestStep') && !docsBranch.includes('startTier1Test'));
check('the full route is the old screen: record, all training, the test', ['AcademicStep', 'TrainingStep', 'TestStep'].every((c) => fullBranch.includes(`<${c}`)));
const panelText = panel.replace(/\/\/.*$/gm, '');
check('nothing the tutor reads in the panel says "trained and tested" or calls the test validated', !/trained and tested/i.test(panelText) && !/\bvalidated\b/i.test(panelText));
check('the intro no longer promises training or a test', !/finished\s+Tutorlage's training/.test(panel) && !/passed the subject's test/.test(panel));
check('the 70% in the step heading and the hint come from the database, not a literal', /Show at least \$\{status\.minPct\}%/.test(panel) && !/Show at least 70%/.test(panel));
check('the results hint asks for the original document and refuses a screenshot of one mark', /Upload your original results/.test(panel) && /A screenshot of one mark is not accepted/.test(panel));
check('the check button needs every answer AND the code-of-conduct tick, and sends the tick', /<input type="checkbox" checked=\{agree\}/.test(panel) && /\|\| !agree/.test(panel) && /submitModuleCheck\(answers, agree\)/.test(panel));
check('the optional guide shows Modules 1 to 6 read-only (no "I have read this" button, no sign-off)', (() => {
  const g = panel.slice(panel.indexOf('const OptionalGuide'), panel.indexOf('const ModuleCheck'));
  return g.includes('x.module !== 7') && !g.includes('completeTier1Module') && /Nothing here is a test/.test(g);
})());
check('the Tier 1 panel is still behind the same feature switch', /tier1Pipeline: true/.test(features) && /FEATURES\.tier1Pipeline && <Tier1Panel/.test(read('src/components/TeachingProfilePanel.tsx')));

// ---- the admin check screen ------------------------------------------------------------------------------------------
check('the admin screen has a four-point written checklist and Accept stays off until all four are ticked', /export const CHECKLIST = \[/.test(adminPage) && (adminPage.match(/^\s+'[^']*(?:\\'[^']*)*',$/gm) ?? []).length >= 4 && /!CHECKLIST\.every\(\(_, i\) => ticks\[r\.id\]\?\.\[i\] === true\)/.test(adminPage));
check('an acceptance sends the written note, built from the checklist (well over 20 characters); a rejection sends only what the admin typed', /verdict === 'verified' \? acceptNote\(notes\[row\.id\] \?\? ''\) : notes\[row\.id\] \?\? ''/.test(adminPage) && (() => {
  const m = adminPage.match(/const base = `([^`]*)`/);
  const base = (m?.[1] ?? '').replace(/\$\{CHECKLIST\.length\}/g, '4');
  return base.length >= 60;
})());
check('the checklist names the educator\'s three traps: an original document, a name matching the ID, a school subject (a university module only if it matches)', /original results statement/.test(adminPage) && /matches the tutor\\\\?'s ID/.test(adminPage) && /CAPS subject/.test(adminPage));
check('the admin intro says the test is kept for later and does not call it validated', /setting tier1_route = full/.test(adminPage) && /don't describe them as a validated test/.test(adminPage));
check('the admin library still calls the same function with the same argument names', /admin_check_tier1_record', \{ p_id: id, p_verdict: verdict, p_note: note \}/.test(adminLib));

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nall checks passed');
