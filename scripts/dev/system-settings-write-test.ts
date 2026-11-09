// Checks on the app and file side of the three P2 security fixes of 4 Nov 2026 (system settings guard, admins read-only on sessions and
// session requests, the description that a save used to blank, and the anon function review). Run: npx tsx scripts/dev/system-settings-write-test.ts
// The database half is proved by supabase/tests/system_settings_guard.sql, admins_read_only_sessions.sql and anon_definer_functions.sql
// (rolled back, run by the project manager). This script checks:
//   * the row the System Settings screens send leaves a saved description alone unless told otherwise (admin/src/lib/settingRow.ts);
//   * the facts the migrations rest on STAY true: the admin app never writes sessions or session_requests directly, the System Settings
//     page is for super admins only, and the wallet settings screen writes only wallet_ keys (a finance manager is let through those only);
//   * every new migration has its header, its rolled-back test and its README row.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { settingRow } from '../../admin/src/lib/settingRow';
import { SETTING_KEYS, FREE_KEY } from '../../admin/src/lib/walletAdmin';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const rootPath = fileURLToPath(root);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');

// ---- the row: a description is only sent when the caller gives one -------------------------------------------------------------------
const fixed = new Date('2026-11-04T10:00:00.000Z');
const noDesc = settingRow('current_terms_version', '2026-11', 'admin-1', undefined, fixed);
check('no description given: the row has no description at all (so the upsert keeps the saved one)', !('description' in noDesc), JSON.stringify(Object.keys(noDesc)));
check('the other four columns are always there', noDesc.setting_key === 'current_terms_version' && noDesc.setting_value === '2026-11' && noDesc.last_updated_by === 'admin-1' && noDesc.updated_at === '2026-11-04T10:00:00.000Z');
check('what goes over the wire has no "description" either', !JSON.stringify(noDesc).includes('description'));
const withDesc = settingRow('k', 1, 'a', 'Words for admins', fixed);
check('a description given is sent', withDesc.description === 'Words for admins');
const cleared = settingRow('k', 1, 'a', null, fixed);
check('null on purpose clears it (the caller asked)', 'description' in cleared && cleared.description === null);
check('an empty text is sent as given (not turned into "leave alone")', settingRow('k', 1, 'a', '', fixed).description === '');
check('the value is passed through untouched (false, 0, a list, null)', settingRow('k', false, 'a').setting_value === false && settingRow('k', 0, 'a').setting_value === 0
  && Array.isArray(settingRow('k', [1], 'a').setting_value) && settingRow('k', null, 'a').setting_value === null);
// Mutation check: the old behaviour (description ?? null) must be caught by the very predicate used above.
const oldBehaviour = (description?: string) => ({ setting_key: 'k', setting_value: 1, description: description ?? null, last_updated_by: 'a', updated_at: 'x' });
check('MUTATION: the old row (description ?? null) would be caught', 'description' in oldBehaviour(undefined) && oldBehaviour(undefined).description === null);

// ---- the code uses it ---------------------------------------------------------------------------------------------------------------
const queries = read('admin/src/lib/queries.ts');
const upsertBody = queries.slice(queries.indexOf('export async function upsertSystemSetting'), queries.indexOf('// --- Audit log ---'));
check('queries.ts builds the row with settingRow()', /import \{ settingRow \} from '\.\/settingRow'/.test(queries) && /\.upsert\(settingRow\(key, value, adminId, description\)\)/.test(upsertBody));
check('queries.ts no longer turns a missing description into null', !/description \?\? null/.test(upsertBody) && /description\?: string \| null/.test(upsertBody));
const settingsPage = read('admin/src/pages/SystemSettings.tsx');
check('the "Add / Update Setting" box saves without a description (so it now keeps the saved one)', /upsertSystemSetting\(newKey\.trim\(\), parsedValue, adminProfile\.id\s*\)/.test(settingsPage));

// ---- facts the migrations rest on -----------------------------------------------------------------------------------------------------
const layout = read('admin/src/components/AdminLayout.tsx');
check('the System Settings page is for super admins only (the database now agrees: migration 20261104210000)',
  /\{ to: '\/settings', label: 'System Settings', icon: Settings, roles: \['super_admin'\] \}/.test(layout));
const walletKeys = SETTING_KEYS.filter((k) => k !== FREE_KEY);
check('the wallet settings screen writes only wallet_ keys (a finance manager may change those and nothing else)', walletKeys.length > 0 && walletKeys.every((k) => k.startsWith('wallet_')), walletKeys.join(', '));
check('free_sessions_enabled is only READ there (a finance manager could not switch it: super admin only)', FREE_KEY === 'free_sessions_enabled' && !/saveSettingWrites\([^)]*FREE_KEY/.test(read('admin/src/components/WalletTabs.tsx')));

// The admin app never writes sessions or session_requests directly (migration 20261104210100 removed the admin's write right).
const directWrite = /\.from\(\s*['"](sessions|session_requests)['"]\s*\)[^;]*?\.(insert|update|upsert|delete)\(/;
check('the scan finds a direct write when there is one (self-test)', directWrite.test(`await supabase.from('sessions').update({ a: 1 }).eq('id', x);`)
  && directWrite.test(`await client\n  .from("session_requests")\n  .delete()\n  .eq('id', x);`));
check('the scan ignores plain reads (self-test)', !directWrite.test(`const { data } = await supabase.from('sessions').select('id'); await supabase.from('profiles').update({ a: 1 });`));
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(p)) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
});
const adminSrc = path.join(rootPath, 'admin', 'src');
const offenders = walk(adminSrc).filter((f) => directWrite.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(adminSrc, f));
check('NO file in admin/src writes sessions or session_requests directly', offenders.length === 0, offenders.join(', '));
const rpcNames = walk(adminSrc).flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/rpc\(\s*['"](\w+)['"]/g)].map((m) => m[1]));
check('the admin money actions go through admin database functions (refund to wallet, top-up by hand, close account are among the rpc calls)',
  ['admin_refund_to_wallet', 'admin_add_topup_by_hand', 'admin_close_account'].every((n) => rpcNames.includes(n)));

// ---- files: header, test, README row --------------------------------------------------------------------------------------------------
const readme = read('supabase/tests/README.md');
const pairs: Array<[string, string]> = [
  ['20261104210000_system_settings_super_admin_guard.sql', 'system_settings_guard.sql'],
  ['20261104210100_admins_read_only_sessions.sql', 'admins_read_only_sessions.sql'],
  ['20261104210200_close_anon_on_signed_in_only_functions.sql', 'anon_definer_functions.sql'],
];
for (const [migration, test] of pairs) {
  const sql = read(`supabase/migrations/${migration}`);
  const testSql = read(`supabase/tests/${test}`);
  check(`${migration}: starts with a header comment that says what it replaces or changes`, sql.startsWith('--') && /WHAT THIS MIGRATION/.test(sql));
  check(`${test}: every check line is ok/FAIL style, raises at the end on purpose, and has a README row`,
    /raise exception E'.*TEST \(rolled back\)/.test(testSql) && /like '%FAIL%'/.test(testSql) && readme.includes(`\`${test}\``));
}
check('the migrations come after 20261104200000 and each concern has its own file', pairs.every(([m]) => m.slice(0, 14) > '20261104200000'));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
