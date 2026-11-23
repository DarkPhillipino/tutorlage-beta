// "You earn R..." on a request equals what is settled (23 Nov 2026, PM line 44 job H). The inbox shows the tutor's share BEFORE accepting; the database books it on accepting:
//   wallet request: price in whole rands; commission = round(price x pct / 100) in whole rands (halves up); the tutor gets price - commission
//                   (migration 20261102210000, function claim for wallet requests: v_comm := round(v_price * v_pct / 100)::integer);
//   card request:   commission = round(charged x pct / 100, 2); the tutor gets charged - commission (migration 20260930239500).
// The settlement side is written here in exact integer arithmetic, independent of the screen's code, for every commission rate the levels use today.
//   npx --no-install tsx scripts/dev/tutor-share-test.ts
import fs from 'node:fs';
import { walletTutorShare } from '../../src/lib/wallet';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

// The 16 levels' commission rates on production on 23 Nov 2026 (13 distinct values).
const PCTS = [13, 16.5, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 30];
const hundredths = (pct: number) => Math.round(pct * 100);

// Settlement, exact: Postgres round() on a positive numeric is half-up.
const settledWallet = (priceRand: number, pct: number) => priceRand - Math.floor((priceRand * hundredths(pct) + 5000) / 10000);
const settledCardCents = (chargedCents: number, pct: number) => chargedCents - Math.floor((chargedCents * hundredths(pct) + 5000) / 10000);

// The screen's card figure, as queries.ts computes it.
const screenCard = (charged: number, pct: number) => (Math.round(charged * 100) - Math.round(charged * pct)) / 100;

const walletBad: string[] = [];
let walletChecked = 0;
for (const pct of PCTS) {
  for (let price = 1; price <= 3000; price += 1) {
    walletChecked += 1;
    const shown = walletTutorShare(price, screenCard(price, pct), pct);
    if (shown !== settledWallet(price, pct)) walletBad.push(`${pct}% R${price}: shown ${shown}, settled ${settledWallet(price, pct)}`);
  }
}
check(`W1 wallet request: the tutor's figure equals the settled share for every whole-rand price R1 to R3000 at every commission rate (${walletChecked} cases)`, walletBad.length === 0, walletBad.slice(0, 4).join(' | '));

const cardBad: string[] = [];
let cardChecked = 0;
for (const pct of PCTS) {
  for (let cents = 100; cents <= 300000; cents += 50) {   // R1.00 to R3000.00 in 50-cent steps (half-hour prices)
    cardChecked += 1;
    const shown = Math.round(screenCard(cents / 100, pct) * 100);
    if (shown !== settledCardCents(cents, pct)) cardBad.push(`${pct}% R${cents / 100}: shown ${shown / 100}, settled ${settledCardCents(cents, pct) / 100}`);
  }
}
check(`C1 card request: the figure equals charged less the cent-rounded commission for every 50-cent price R1 to R3000 at every rate (${cardChecked} cases)`, cardBad.length === 0, cardBad.slice(0, 4).join(' | '));

check('W2 the known case that differed before the fix: 16.5% of R203 is R33.495, the database books commission R33 and the tutor R170', walletTutorShare(203, screenCard(203, 16.5), 16.5) === 170 && settledWallet(203, 16.5) === 170);
check('W3 without the rate the older working-back is still used (nothing breaks for a row that has none)', walletTutorShare(188, 131.76) === 188 - Math.round(188 - 131.76));

const read = (p: string) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
check('S1 the inbox passes the level\'s rate to the wallet share and keeps its words "You earn"', /walletTutorShare\(r\.chargedAmount, r\.tutorPayout, r\.commissionPct\)/.test(read('src/components/AvailableRequestsQueue.tsx')) && /You earn /.test(read('src/components/AvailableRequestsQueue.tsx')));
check('S2 the settlement formulas written here are the ones in the migrations', /v_comm := round\(v_price \* v_pct \/ 100\)::integer/.test(read('supabase/migrations/20261102210000_wallet_booking.sql')) && /v_commission_amount := round\(v_req\.charged_amount \* v_commission \/ 100, 2\)/.test(read('supabase/migrations/20260930239500_split_payments_charge_on_accept.sql')));

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
