// Checks for the booking-time gap (JOB FIT, 25 Nov 2026). Run: npx tsx scripts/dev/booking-fit-test.ts
// The database side is tested by supabase/tests/addressed_fit_linked.sql (rolled back); the screen by tests/browser/booking-fit.spec.ts. This file checks that the
// screen recognises the database's own sentences and that none of them uses the retired word.
import fs from 'node:fs';
import { isAddressedRefusal, KEEP_OR_SWAP_COPY } from '../../src/lib/keepOrSwap';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`ok   ${name}`);
  else {
    failures++;
    console.log(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

const read = (p: string) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20261125120000_addressed_fit_linked_family.sql');
const prices = read('src/components/PricesPage.tsx');
const sentences = [...migration.matchAll(/'((?:This|That) tutor(?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));

check('the new database sentences are found', sentences.length >= 6, String(sentences.length));
check('every one of them offers the two choices', sentences.every((m) => isAddressedRefusal(m)));
check('none of them uses the retired word', sentences.every((m) => !/\bfree\b/i.test(m)));
check('the older refusals about the tutor offer them too', ['You can only ask for a tutor you have had a session with.', 'You already have 3 requests waiting for this tutor.', "This tutor doesn't teach that subject."].every((m) => isAddressedRefusal(m)));
check('a money or network message does not', ['Your credit has R10. This session is R100. Add R90 or more.', 'Failed to fetch', 'Wallet payments are not open.'].every((m) => !isAddressedRefusal(m)));
const copy = [KEEP_OR_SWAP_COPY.bannerHours('Tessa', 'Every day, 10:00 to 12:00'), KEEP_OR_SWAP_COPY.refusedNothingHeld, KEEP_OR_SWAP_COPY.refusedChangeTime, KEEP_OR_SWAP_COPY.refusedSendToAnyone, KEEP_OR_SWAP_COPY.refusedNobodyElse, KEEP_OR_SWAP_COPY.refusedSeeOthers].join(' ');
check('the new screen words keep the wording rules', !/\b(free|instant|wallet|vetted|certified|background)/i.test(copy));
check('the send to any available tutor drops the address', /requestedTutorId: toAnyone \? null : \(bookAgain\?\.tutorId \?\? null\)/.test(prices));
check('it is offered only when another tutor is counted for that level', /othersCanTake \? \(/.test(prices) && /available\?\.get\(selectedLevel\.id\) \?\? 0\) > 0/.test(prices));
check('every sending function asks again before holding or sending', (migration.match(/-- JOB FIT (send|card) \(25 Nov 2026\)/g) ?? []).length === 3);
check('the wallet check comes before the code is used and the credit held', /'  -- PROMO CODES send 2 \(CEO, 5 Nov 2026\):',\s*\$new\$  -- JOB FIT send/.test(migration));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
