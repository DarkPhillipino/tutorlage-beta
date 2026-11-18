// The admin side of the temporary Module 7 exemption (18 Nov 2026): what the tutor's page shows and sends. The database decides everything
// (supabase/tests/module7_subject_approval.sql); this proves the screen reads and words it correctly and writes only through the two admin functions.
import { readFileSync } from 'node:fs';
import { DEFAULT_EXEMPTION_DAYS, MAX_EXEMPTION_DAYS, daysProblem, describeExemption, parseExemption } from '../../admin/src/lib/module7Exemption';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const now = new Date('2026-11-20T10:00:00Z');
const active = parseExemption({ active: true, ends_at: '2026-12-20T10:00:00Z', reason: 'Temporary exemption while the account is set up', granted_via: 'seeding', granted_at: '2026-11-20T09:00:00Z' });
check('the database answer is read', active !== null && active.active && active.grantedVia === 'seeding' && active.endsAt === '2026-12-20T10:00:00Z');
check('null (no exemption) reads as none', parseExemption(null) === null && parseExemption({}) === null && parseExemption('x') === null);
check('an active exemption says its end date and the days left', describeExemption(active!, now) === 'until 20 Dec 2026 (30 days left)', describeExemption(active!, now));
check('the last day says "1 day left", never 0', describeExemption({ ...active!, endsAt: '2026-11-20T10:30:00Z' }, now).endsWith('(1 day left)'));
check('an ended exemption says it ended', describeExemption({ ...active!, active: false, endsAt: '2026-11-19T10:00:00Z' }, now) === 'ended on 19 Nov 2026');
check('the default is 30 days and the most is 90 (the same limits as the database)', DEFAULT_EXEMPTION_DAYS === 30 && MAX_EXEMPTION_DAYS === 90);
check('days must be a whole number from 1 to 90', daysProblem('0') !== null && daysProblem('91') !== null && daysProblem('') !== null && daysProblem('2.5') !== null && daysProblem('abc') !== null && daysProblem('1') === null && daysProblem('90') === null && daysProblem('30') === null);

const lib = read('admin/src/lib/module7Exemption.ts');
const card = read('admin/src/components/Module7ExemptionCard.tsx');
const page = read('admin/src/pages/TutorVerificationDetail.tsx');
check('it writes only through the two admin functions and never touches the table', lib.includes("rpc('admin_grant_module7_exemption'") && lib.includes("rpc('admin_end_module7_exemption'") && lib.includes("rpc('admin_module7_exemption'") && !/\.(insert|update|delete|upsert)\(/.test(lib) && !lib.includes("from('module7_exemptions')"));
check('it shows nothing when the database update is not applied (the read fails)', lib.includes('available: false') && card.includes('!info.available) return null'));
check('the tutor page mounts the card, and the card shows the end date and the way to change or end it', page.includes('<Module7ExemptionCard tutorId={tutor.id} />') && card.includes('describeExemption(ex)') && card.includes('Change the end date') && card.includes('End it now'));
check('the days box refuses bad input before anything is sent', card.includes('disabled={busy || problem !== null}'));
