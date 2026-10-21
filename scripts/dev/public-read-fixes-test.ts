// Checks that the app code and the migration 20261020170000_public_read_fixes agree (source-shape checks; nothing is run against a database).
// Run: npx tsx scripts/dev/public-read-fixes-test.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8');
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name === 'dist') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const files = [...walk('src'), ...walk('admin/src'), ...walk('server')];
const migration = read('supabase/migrations/20261020170000_public_read_fixes.sql');
const queries = read('src/lib/queries.ts');
const adminHelper = read('admin/src/lib/tutorInternalFlags.ts');

// ---- reviews (M2) ----
check('the public reader asks public_tutor_reviews first and falls back to the table only when the function is missing',
  /rpc\('public_tutor_reviews'[\s\S]{0,700}if \(!isMissingDatabaseFunction\(viaFunction\.error\)\) throw viaFunction\.error;[\s\S]{0,300}\.from\('reviews'\)/.test(queries));
const reviewReaders = files.filter((f) => /from\('reviews'\)/.test(read(f)));
check('only queries.ts (own reviews, the fallback, the insert) and the admin statistics read or write the reviews table',
  reviewReaders.every((f) => /src[\\/]lib[\\/]queries\.ts$|admin[\\/]src[\\/]lib[\\/]queries\.ts$/.test(f)), reviewReaders.join(', '));
check('the migration drops the open policy, hides the table from visitors and gives admins their own read policy',
  /drop policy if exists "Public can view reviews"/.test(migration) && /revoke select on public\.reviews from anon/.test(migration) && /create policy "Admins view all reviews"[^;]*is_active_admin\(\)/.test(migration));
check('the review function returns exactly id, rating, comment, created_at, pins its search path, and is open to visitors',
  /returns table \(id uuid, rating integer, comment text, created_at timestamptz\)/.test(migration) && /security definer\s+set search_path = public/.test(migration) && /grant execute on function public\.public_tutor_reviews\(uuid\) to anon, authenticated/.test(migration));

// ---- tutor_profiles (M1) ----
const hidden = ['credential_floor_sub_tier_id', 'tier_frozen', 'freeze_reason', 'fast_track_status', 'fast_track_proof_url'];
const grant = (migration.match(/grant select \(([^)]*)\)\s*on public\.tutor_profiles/) ?? [])[1] ?? '';
const granted = grant.split(',').map((s) => s.trim()).filter(Boolean);
check('the column grant lists 20 columns and none of the five hidden ones', granted.length === 20 && hidden.every((h) => !granted.includes(h)), granted.join(','));
check('the table-wide read is revoked first (a column revoke alone would do nothing)', /revoke select on public\.tutor_profiles from anon, authenticated;/.test(migration));
const hiddenReaders = files.filter((f) => hidden.some((h) => new RegExp(`\\b${h}\\b`).test(read(f))));
check('only the admin helper, the admin freeze button (a write) and the admin type name the hidden columns',
  hiddenReaders.every((f) => /tutorInternalFlags\.ts$|admin[\\/]src[\\/]lib[\\/]queries\.ts$/.test(f)), hiddenReaders.join(', '));
check('the admin freeze button only writes them (no select of the hidden columns in admin queries.ts)',
  !/select\([^)]*(tier_frozen|freeze_reason|fast_track)/.test(read('admin/src/lib/queries.ts')));
const wildcard = files.filter((f) => /from\('tutor_profiles'\)\s*\.select\(\s*(\*|['"`]\*['"`])?\s*\)/.test(read(f)));
check('no screen reads tutor_profiles with select * or an empty select (it would be refused now)', wildcard.length === 0, wildcard.join(', '));
check('the admin helper tries the function, then falls back only when it is missing',
  /rpc\('admin_tutor_internal_flags', \{ p_tutor: tutorId \}\)[\s\S]{0,400}if \(!notSwitchedOn\(viaFunction\.error\)\) throw viaFunction\.error;[\s\S]{0,200}\.from\('tutor_profiles'\)/.test(adminHelper));
check('the admin function checks the caller is an active admin and is closed to visitors',
  /create or replace function public\.admin_tutor_internal_flags[\s\S]*?if not public\.is_active_admin\(\)[\s\S]*?revoke all on function public\.admin_tutor_internal_flags\(uuid\) from public, anon, authenticated;\s*grant execute on function public\.admin_tutor_internal_flags\(uuid\) to authenticated;/.test(migration));

// ---- messaging (m1), notifications (m9), documents (m8) ----
const messaging = files.filter((f) => /from\('(conversations|messages)'\)/.test(read(f)));
check('no screen, admin page or server file uses the conversations or messages tables', messaging.length === 0, messaging.join(', '));
const noticeWrites = files.flatMap((f) => [...read(f).matchAll(/from\('notifications'\)\s*\.(update|insert|delete|upsert)\(([^)]*)\)/g)].map((m) => `${f}: ${m[1]}(${m[2]})`));
check('the app only ever updates notifications.read_at', noticeWrites.length > 0 && noticeWrites.every((w) => /update\(\{ read_at:/.test(w)), noticeWrites.join(' | '));
check('both document upload paths start with the tutor\'s own id',
  /const path = `\$\{tutorId\}\/\$\{crypto\.randomUUID\(\)\}\.\$\{extension\}`/.test(read('src/components/VerificationDocumentsPanel.tsx')) && /tier1-\$\{crypto\.randomUUID\(\)\}/.test(read('src/lib/tier1.ts')));
check('the guard keeps links allowed and checks the folder on insert and when the address changes',
  /tg_op = 'INSERT' or new\.document_url is distinct from old\.document_url/.test(migration) && /!~\* '\^https\?:\/\/'/.test(migration) && /split_part\(new\.document_url, '\/', 1\) <> new\.tutor_id::text/.test(migration));
check('messaging writes and notification edits are revoked as planned',
  /revoke insert, update, delete on public\.conversations from authenticated;/.test(migration) && /revoke insert on public\.messages from authenticated;/.test(migration) && /revoke update on public\.notifications from authenticated;\s*grant update \(read_at\) on public\.notifications to authenticated;/.test(migration));

console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
