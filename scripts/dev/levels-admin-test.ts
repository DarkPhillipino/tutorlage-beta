// Checks on the admin app's Levels page and the tutor's Level section (CEO, 17 Oct 2026: tiers defined in the admin app, tier
// roles assigned from the admin app). Run: npx tsx scripts/dev/levels-admin-test.ts
// The database half is proved by supabase/tests/tier_roles_admin.sql; this checks the words, the numbers the forms accept, and that
// every admin call uses exactly the function names and parameter names the migration defines.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { LevelsBody } from '../../admin/src/components/LevelsBody';
import { TutorLevelCardBody } from '../../admin/src/components/TutorLevelCardBody';
import {
  codeFromLabel,
  credentialDraftFrom,
  credentialFromDraft,
  emptyLevelDraft,
  ladderWarnings,
  levelDraftFrom,
  levelFromDraft,
  tierDraftFrom,
  tierFromDraft,
  toNumber,
} from '../../admin/src/lib/levelForms';
import type { CredentialConfig, LevelConfig, TierConfig, TutorLevelInfo, VerificationDocument } from '../../admin/src/types';

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

const base: LevelConfig = { id: '2C', tierId: 2, price: 280, minHours: 110, minRating: 4.9, minRepeatPct: 72, minReviews: 10, minStudents: 0, uplift: 5, sharePct: 25 };

// ---- numbers --------------------------------------------------------------------------------------------------------------
check('toNumber: a comma counts as a decimal point, blanks and words are not numbers', toNumber('4,5') === 4.5 && toNumber(' 12 ') === 12 && toNumber('') === null && toNumber('abc') === null && toNumber('1e999') === null);

// ---- a level --------------------------------------------------------------------------------------------------------------
const ok = levelFromDraft(levelDraftFrom(base));
check('a level as it is in the database passes and comes back unchanged', ok.problem === null && JSON.stringify(ok.level) === JSON.stringify(base));
check('a new level id is upper-cased: "5a" is 5A', levelFromDraft({ ...levelDraftFrom(base), id: '5a' }).level?.id === '5A');
const bad = (patch: Partial<ReturnType<typeof levelDraftFrom>>) => levelFromDraft({ ...levelDraftFrom(base), ...patch });
check('a level id must be a number and a letter', bad({ id: 'bad' }).level === null && bad({ id: '22' }).level === null && bad({ id: '' }).level === null);
check('the price must be more than 0 (and not absurd)', bad({ price: '0' }).level === null && bad({ price: '-5' }).level === null && bad({ price: '' }).level === null && bad({ price: '100001' }).level === null && bad({ price: '99999' }).level !== null);
check('hours, reviews and learners are whole numbers, 0 or more', bad({ minHours: '-1' }).level === null && bad({ minHours: '1.5' }).level === null && bad({ minReviews: 'x' }).level === null && bad({ minStudents: '-2' }).level === null && bad({ minHours: '0' }).level !== null);
check('the rating is 0 to 5', bad({ minRating: '6' }).level === null && bad({ minRating: '-1' }).level === null && bad({ minRating: '5' }).level !== null && bad({ minRating: '4,85' }).level?.minRating === 4.85);
check('percentages are 0 to 100', bad({ minRepeatPct: '101' }).level === null && bad({ uplift: '-1' }).level === null && bad({ sharePct: '130' }).level === null && bad({ sharePct: '' }).level === null && bad({ uplift: '100' }).level !== null);
check('each refusal says what to fix, in words', [bad({ id: 'x' }), bad({ price: '0' }), bad({ minHours: '-1' }), bad({ minRating: '9' }), bad({ uplift: '500' }), bad({ sharePct: '' })].every((r) => !!r.problem && r.problem.length > 15));
check('a blank new level starts with zero minimums and no price', JSON.stringify(emptyLevelDraft(4)) === JSON.stringify({ id: '', tierId: '4', price: '', minHours: '0', minRating: '0', minRepeatPct: '0', minReviews: '0', minStudents: '0', uplift: '0', sharePct: '' }));

// ---- a tier ---------------------------------------------------------------------------------------------------------------
const tier: TierConfig = { id: 1, publicName: 'Rising Tutors', quote: 'New to Tutorlage.', minRate: 50, maxRate: 150, sharePct: 30, currencyCode: 'ZAR' };
const tierOk = tierFromDraft(tierDraftFrom(tier));
check('a tier as it is passes', tierOk.problem === null && tierOk.tier?.publicName === 'Rising Tutors' && tierOk.tier.maxRate === 150 && !('currencyCode' in (tierOk.tier ?? {})));
check('a tier needs a name, and rates the right way round', tierFromDraft({ ...tierDraftFrom(tier), publicName: 'x' }).tier === null && tierFromDraft({ ...tierDraftFrom(tier), minRate: '200' }).tier === null && tierFromDraft({ ...tierDraftFrom(tier), maxRate: 'a' }).tier === null);
check("a tier's share is 0 to 100", tierFromDraft({ ...tierDraftFrom(tier), sharePct: '101' }).tier === null && tierFromDraft({ ...tierDraftFrom(tier), sharePct: '0' }).tier !== null);

// ---- a credential ---------------------------------------------------------------------------------------------------------
const cred: CredentialConfig = { code: 'exam_marker', label: 'NSC, IEB or Cambridge exam marker (last 5 years)', entrySubTier: '4A', recencyYears: 5, description: null, heldBy: 0 };
const credOk = credentialFromDraft(credentialDraftFrom(cred));
check('a credential as it is passes (years kept, empty description is null)', credOk.problem === null && credOk.credential?.recencyYears === 5 && credOk.credential.description === null);
check('a credential needs a level, a name and a sensible code', credentialFromDraft({ ...credentialDraftFrom(cred), entrySubTier: '' }).credential === null && credentialFromDraft({ ...credentialDraftFrom(cred), label: 'ab' }).credential === null && credentialFromDraft({ ...credentialDraftFrom(cred), code: 'Bad Code' }).credential === null && credentialFromDraft({ ...credentialDraftFrom(cred), code: 'ab' }).credential === null);
check('years of validity: empty is for ever, 0 and 51 and 2.5 are refused', credentialFromDraft({ ...credentialDraftFrom(cred), recencyYears: '' }).credential?.recencyYears === null && ['0', '51', '2.5', 'x'].every((y) => credentialFromDraft({ ...credentialDraftFrom(cred), recencyYears: y }).credential === null));
check('the code is made from the name: lower case, underscores, starts with a letter, 41 characters at most', codeFromLabel('Head of department (or equivalent)') === 'head_of_department_or_equivalent' && codeFromLabel('2 years on Superprof!') === 'years_on_superprof' && codeFromLabel('x'.repeat(80)).length === 41 && /^[a-z][a-z0-9_]{2,40}$/.test(codeFromLabel('Top-rated on another tutoring platform')));

// ---- does the ladder still climb? ---------------------------------------------------------------------------------------
const LIVE: [string, number, number][] = [
  ['1A', 50, 0], ['1B', 80, 10], ['1C', 110, 25], ['1D', 150, 45], ['2A', 180, 50], ['2B', 230, 75], ['2C', 280, 110], ['2D', 350, 150],
  ['3A', 400, 160], ['3B', 460, 210], ['3C', 530, 270], ['3D', 600, 350], ['4A', 650, 360], ['4B', 720, 420], ['4C', 800, 500], ['4D', 1200, 600],
];
const live = LIVE.map(([id, price, hours]) => ({ ...base, id, tierId: Number(id[0]), price, minHours: hours }));
check('the live ladder of 17 Oct 2026 has nothing to warn about', ladderWarnings(live).length === 0, ladderWarnings(live).join(' | '));
const typo = live.map((l) => (l.id === '3B' ? { ...l, minHours: 20 } : l));
check('a dearer level that asks for fewer hours is flagged (3B at 20 hours)', ladderWarnings(typo).some((w) => w.includes('3B') && w.includes('fewer hours')));
check('two levels at one price are flagged', ladderWarnings([...live, { ...base, id: '5A', tierId: 4, price: 1200, minHours: 700 }]).some((w) => /same price/.test(w)));
check('the dips in rating between tiers are not flagged (they are on purpose)', ladderWarnings(live.map((l, i) => ({ ...l, minRating: i % 2 ? 4.9 : 4.85 }))).length === 0);

// ---- the admin calls match the migration ---------------------------------------------------------------------------------
const migration = read('supabase/migrations/20261017120000_tier_roles_and_admin_levels.sql');
const queries = read('admin/src/lib/levelQueries.ts');
const defined = new Map<string, string[]>();
for (const m of migration.matchAll(/create or replace function public\.(admin_\w+)\(([^)]*)\)/g)) {
  defined.set(m[1], [...m[2].matchAll(/\b(p_\w+)\b/g)].map((x) => x[1]).sort());
}
check('the migration defines nine admin functions', defined.size === 9, [...defined.keys()].join(', '));
const called = new Map<string, string[]>();
for (const m of queries.matchAll(/\.rpc\('(admin_\w+)'(?:,\s*\{([\s\S]*?)\})?\)/g)) {
  called.set(m[1], [...(m[2] ?? '').matchAll(/\b(p_\w+):/g)].map((x) => x[1]).sort());
}
check('the admin app calls all nine, and no other admin function', called.size === 9 && [...called.keys()].every((k) => defined.has(k)), [...called.keys()].join(', '));
check('every call passes exactly the parameter names the function defines', [...called].every(([name, keys]) => JSON.stringify(keys) === JSON.stringify(defined.get(name))), [...called].filter(([n, k]) => JSON.stringify(k) !== JSON.stringify(defined.get(n))).map(([n]) => n).join(', '));
check('the admin app never writes the level tables directly (only through the functions that audit)', !/\.from\('(tier_definitions|sub_tier_definitions|credential_definitions|tutor_credentials)'\)\s*\.(insert|update|upsert|delete)/.test(queries));
check('every one of those functions refuses anyone who is not an active admin, and writes the audit row', [...defined.keys()].every((name) => {
  const body = migration.slice(migration.indexOf(`function public.${name}(`)).split(/\n\$\$;/)[0];
  return /if not public\.is_active_admin\(\)/.test(body) && /log_admin_event\(/.test(body);
}));
check('and none of them can be run by a visitor who has not signed in', /revoke all on function[\s\S]*from public, anon;/.test(migration) && /grant execute on function[\s\S]*to authenticated;/.test(migration));

// ---- the screens, rendered ------------------------------------------------------------------------------------------------
// (Clicking and typing were tried in a real browser on admin/dev-levels.html; here the words and the shape are checked.)
const noActions = {
  saveTier: async () => undefined,
  saveLevel: async () => undefined,
  saveCredentialDefinition: async () => undefined,
  deleteCredentialDefinition: async () => undefined,
  recalculateAllLevels: async () => 0,
};
const tiers: TierConfig[] = [1, 2, 3, 4].map((id) => ({ ...tier, id, publicName: `Tier ${id}` }));
const creds: CredentialConfig[] = [
  { ...cred, code: 'teaching_degree', label: 'Qualified teacher with a teaching degree or PGCE', entrySubTier: '2C', recencyYears: null, heldBy: 0 },
  { ...cred, code: 'practicum_complete', label: 'Student teacher with a completed supervised practicum', entrySubTier: '2C', recencyYears: null, heldBy: 2 },
  { ...cred, code: 'admin_assigned', label: 'Level assigned by Tutorlage', entrySubTier: null, recencyYears: null, heldBy: 1 },
];
const page = renderToStaticMarkup(React.createElement(LevelsBody, { data: { tiers, levels: live, credentials: creds }, actions: noActions, onSaved: () => undefined }));
check('the Levels page shows 4 tiers, 16 levels and every credential, each with its own editor', (page.match(/data-tier="/g) ?? []).length === 4 && (page.match(/data-level="/g) ?? []).length === 16 && (page.match(/data-credential="/g) ?? []).length === 3);
check('it has the add-a-level and add-a-credential forms and the recalculate button', /Add a level/.test(page) && /Add a credential/.test(page) && /Recalculate everyone/.test(page));
check('it says a minimum moves nobody until a session is completed or the button is pressed', /moves nobody until then/.test(page) && /when they complete a session, or when you press/.test(page));
check('the built-in assigned level reads as built in and has no editor fields', /Built in\. Set from a tutor/.test(page) && !/data-credential="admin_assigned"[^]*?Save credential[^]*?data-credential="/.test(page.replace(/data-credential="(teaching_degree|practicum_complete)"/g, 'x')));
check('the live ladder shows no warning box', !/Warnings about the ladder/.test(page));
check('a credential held by tutors says how many; the free one says nobody holds it', /2 held/.test(page) && /Nobody holds this yet/.test(page));

const info: TutorLevelInfo = {
  currentLevel: '2C',
  floorLevel: '2C',
  frozen: true,
  freezeReason: 'Average rating dropped below 4.70 threshold.',
  credentials: [{ id: 'c1', code: 'teaching_degree', label: 'Qualified teacher with a teaching degree or PGCE', level: '2C', obtainedOn: '2024-11-30', note: 'B.Ed, 4 years', documentId: null, status: 'verified' }],
};
const docs: VerificationDocument[] = [
  { id: 'd1', tutorId: 't', documentType: 'proof_of_experience', documentUrl: 'https://www.superprof.co.za/x', status: 'pending', adminNotes: null, uploadedAt: '2026-10-12T08:00:00Z', reviewedAt: null, issuedOn: null },
];
const cardHtml = renderToStaticMarkup(
  React.createElement(TutorLevelCardBody, {
    tutorId: 't',
    documents: docs,
    info,
    levels: live,
    definitions: creds,
    actions: { assignTutorLevel: async () => undefined, clearTutorAssignedLevel: async () => undefined, recordTutorCredential: async () => undefined, removeTutorCredential: async () => undefined },
    onChanged: () => undefined,
  }),
);
check("the tutor's Level section shows the level, the starting level credentials give, and the recorded credential with its level and note", /Level now: <\/span><span[^>]*>2C · R280\/hr/.test(cardHtml) && /starting level of/.test(cardHtml) && /B\.Ed, 4 years/.test(cardHtml) && /Level 2C · R280\/hr · obtained 2024-11-30/.test(cardHtml));
check('a frozen tutor is told the level applies when the freeze lifts, with the reason', /Their rates are frozen \(Average rating dropped below 4\.70 threshold\.\)/.test(cardHtml) && /applies when the freeze lifts/.test(cardHtml));
check('only credentials that start a tutor at a level can be recorded (not the built-in one), and the tutor\'s own documents can be linked as proof', !/Level assigned by Tutorlage \(level/.test(cardHtml) && /Proof of experience · pending/.test(cardHtml));
check('with no assigned level there is no "remove the assigned level" button', !/Remove the assigned level/.test(cardHtml));
check('Record credential and Assign level start disabled until something is chosen', (cardHtml.match(/disabled=""[^>]*>(Record credential|Assign level)/g) ?? []).length === 2);

// ---- the screens, wired ---------------------------------------------------------------------------------------------------
const app = read('admin/src/App.tsx');
const layout = read('admin/src/components/AdminLayout.tsx');
const detail = read('admin/src/pages/TutorVerificationDetail.tsx');
const levels = read('admin/src/components/LevelsBody.tsx');
const card = read('admin/src/components/TutorLevelCardBody.tsx');
const levelsPage = read('admin/src/pages/Levels.tsx');
const cardLoader = read('admin/src/components/TutorLevelCard.tsx');
check('the Levels page has a route and a menu entry for the super admin', /path="levels" element=\{<Levels \/>\}/.test(app) && /to: '\/levels', label: 'Levels'[^}]*roles: \['super_admin'\]/.test(layout));
check("a tutor's page shows the Level section, with that tutor's documents to link as proof", /<TutorLevelCard tutorId=\{tutor\.id\} documents=\{tutor\.documents\} \/>/.test(detail));
check('the Levels page edits tiers, levels and credentials, and can add a level and a credential', ['saveTier', 'saveLevel', 'saveCredentialDefinition', 'deleteCredentialDefinition', 'recalculateAllLevels'].every((f) => new RegExp(`actions\\.${f}\\(`).test(levels)) && /Add a level/.test(levels) && /Add a credential/.test(levels));
check('recalculating everyone asks first, and says who moves', /window\.confirm\(\s*"Work out every tutor's level again/.test(levels) && /move down/.test(levels));
check('deleting a credential asks first and is blocked while tutors hold it', /window\.confirm\(`Delete/.test(levels) && /disabled=\{busy \|\| credential\.heldBy > 0\}/.test(levels));
check('the built-in "assigned by Tutorlage" credential cannot be edited or deleted on the page', /credential\.code === 'admin_assigned'/.test(levels));
check('removing a credential and assigning a level both need a written reason', /disabled=\{busy \|\| !removeReason\.trim\(\)\}/.test(card) && /assignReason\.trim\(\)\.length < 3/.test(card));
check("a frozen tutor is told the level will apply when the freeze lifts", /applies when the freeze lifts/.test(card));
check('the real pages pass the real database calls to those screens (and the screens import no database code themselves)',
  /ACTIONS = \{ saveTier, saveLevel, saveCredentialDefinition, deleteCredentialDefinition, recalculateAllLevels \}/.test(levelsPage) && /actions=\{ACTIONS\}/.test(levelsPage) &&
    /ACTIONS = \{ assignTutorLevel, clearTutorAssignedLevel, recordTutorCredential, removeTutorCredential \}/.test(cardLoader) && /actions=\{ACTIONS\}/.test(cardLoader) &&
    !/supabase|levelQueries/.test(levels + card));
check('the practice page for these screens uses the same screens, with pretend actions', /LevelsBody/.test(read('admin/src/dev/levelsPreview.tsx')) && /TutorLevelCardBody/.test(read('admin/src/dev/levelsPreview.tsx')) && !/supabase/.test(read('admin/src/dev/levelsPreview.tsx')));
check('the admin app\'s copy of the tutor rules still matches the tutor app\'s', read('src/lib/tutorOnboarding.ts') === read('admin/src/lib/tutorOnboarding.ts'));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
