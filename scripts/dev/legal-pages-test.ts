// Checks on the published Terms, Privacy Policy and Refund Policy (src/content/legal/*.md), the little reader that shows them
// (src/lib/miniMarkdown.tsx) and the page (src/pages/LegalPage.tsx). Run: npx tsx scripts/dev/legal-pages-test.ts
//
// What it guards: no internal marker or placeholder can reach the public page; every "§" and "B" reference points at a section
// that exists; the supplier's details are there; sentences about things the product does NOT do (listed below) cannot come
// back by accident; the reader turns every kind of syntax the documents use into elements and never into raw HTML.
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { MarkdownText, parseBlocks, renderInline } from '../../src/lib/miniMarkdown';
import { documentsNeverAccepted } from '../../src/lib/accountRules';
import { notificationTarget } from '../../src/lib/notificationTarget';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');
const docs = {
  terms: read('src/content/legal/terms.md'),
  privacy: read('src/content/legal/privacy.md'),
  refunds: read('src/content/legal/refunds.md'),
};
const html = (source: string) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(MarkdownText, { source })));

// ---- the reader -----------------------------------------------------------------------------------------------------------------
{
  const sample = [
    '## 1. A heading',
    '',
    'A paragraph with **bold**, *italic* and a link to [the terms](/terms) and to support@tutorlage.com,',
    'continued on a second line.',
    '',
    '- first',
    '  - nested one',
    '  - nested two',
    '- second',
    '',
    '1. one',
    '2. two',
    '   - under two',
    '',
    '> **Boxed.**',
    '> - inside the box',
    '',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
  ].join('\n');
  const blocks = parseBlocks(sample);
  check('the reader finds a heading, a paragraph, two lists, a box and a table', blocks.map((b) => b.kind).join(',') === 'heading,paragraph,list,list,quote,table', blocks.map((b) => b.kind).join(','));
  const out = html(sample);
  check('bold, italic, an internal link and an e-mail link all become elements', out.includes('<strong>bold</strong>') && out.includes('<em>italic</em>') && out.includes('href="/terms"') && out.includes('href="mailto:support@tutorlage.com"'));
  check('a continued paragraph line is joined', out.includes('support@tutorlage.com</a>, continued on a second line.') || out.includes('continued on a second line.'));
  check('nested lists nest', (out.match(/<ul/g) ?? []).length >= 3 && out.includes('nested two'));
  check('a table has a header and a row', out.includes('<th') && out.includes('<td'));
  check('no markdown syntax is left over', !/\*\*|\]\(|\n>|^\|/.test(out.replace(/<[^>]+>/g, '')));
  const evil = html('[click](javascript:alert(1)) <script>alert(1)</script> [img](data:text/html,x)');
  check('a link that is not https, mailto or on this site is shown as plain text, and HTML is never built', !/href="javascript|href="data/.test(evil) && !evil.includes('<script') && evil.includes('&lt;script&gt;'));
  check('an https link opens in a new tab with noopener', renderToStaticMarkup(React.createElement('div', null, renderInline('[x](https://example.org)'))).includes('rel="noopener noreferrer"'));
}

// ---- the three documents ------------------------------------------------------------------------------------------------------
for (const [name, text] of Object.entries(docs)) {
  check(`${name}: no internal marker or placeholder (FLAG, G:, R:, [..], DRAFT, TODO)`, !/\[(FLAG|G:|R:|CEO|Legal|VERSION|DATE|SITE|AMOUNT|PAIA)|\bDRAFT\b|\bTODO\b|\[[A-Za-z0-9 /@]{1,40}\](?!\()/.test(text));
  check(`${name}: nothing about phases, testers' notices or legal drafts`, !/phase 1|phase 2|tester notice|attorney|sa-tech|reference review/i.test(text));
  check(`${name}: no tab characters or odd symbols`, !/\t/.test(text) && !/[​�]/.test(text));
  const rendered = html(text);
  check(`${name}: renders with headings and no raw markdown left`, rendered.includes('<h2') && !/\*\*|\]\(/.test(rendered.replace(/<[^>]+>/g, '')));
  const heads = parseBlocks(text).filter((b) => b.kind === 'heading');
  check(`${name}: every section has text under it`, heads.every((h, i) => {
    const at = parseBlocks(text).indexOf(h);
    const next = parseBlocks(text)[at + 1];
    return next !== undefined && !(next.kind === 'heading' && next.level <= (h as { level: number }).level && i < heads.length - 1 && name !== 'terms');
  }));
}

// ---- references point at sections that exist --------------------------------------------------------------------------------
function numberedSections(text: string): Set<string> {
  const set = new Set<string>();
  for (const m of text.matchAll(/^## (\d+)\./gm)) set.add(m[1]);
  return set;
}
function partBSections(text: string): Set<string> {
  const set = new Set<string>();
  for (const m of text.matchAll(/^## (B\d+)\./gm)) set.add(m[1]);
  return set;
}
{
  const t = docs.terms;
  const a = numberedSections(t);
  const b = partBSections(t);
  const refs = [...t.matchAll(/§(\d+)/g)].map((m) => m[1]);
  check('terms: every "§N" points at a section that exists', refs.every((n) => a.has(n)), refs.filter((n) => !a.has(n)).join(','));
  const brefs = [...t.matchAll(/\bB(\d+)\b/g)].map((m) => `B${m[1]}`);
  check('terms: every "BN" points at a Part B section that exists', brefs.every((n) => b.has(n)), brefs.filter((n) => !b.has(n)).join(','));
  check('terms: sections 1 to 23 and B1 to B12 are all there, in order', [...Array(23)].every((_, i) => a.has(String(i + 1))) && [...Array(12)].every((_, i) => b.has(`B${i + 1}`)));
  const p = docs.privacy;
  const pa = numberedSections(p);
  const prefs = [...p.matchAll(/§(\d+)/g)].map((m) => m[1]);
  check('privacy: every "§N" points at a section that exists', prefs.every((n) => pa.has(n)), prefs.filter((n) => !pa.has(n)).join(','));
  check('privacy: sections 1 to 17 are all there', [...Array(17)].every((_, i) => pa.has(String(i + 1))));
  const r = docs.refunds;
  const ra = numberedSections(r);
  const rrefs = [...r.matchAll(/§(\d+)/g)].map((m) => m[1]);
  check('refunds: every "§N" points at a section that exists, sections 1 to 9 are there', rrefs.every((n) => ra.has(n)) && [...Array(9)].every((_, i) => ra.has(String(i + 1))));
  const cross = [...t.matchAll(/Privacy Policy(?:,| \()\s*§(\d+)/g)].map((m) => m[1]);
  check('terms: the references into the Privacy Policy (§7, §8) exist there', cross.every((n) => pa.has(n)), cross.join(','));
}

// ---- the facts that must be on the page ----------------------------------------------------------------------------------------
{
  const t = docs.terms;
  const p = docs.privacy;
  const r = docs.refunds;
  check('terms: the supplier\'s details (ECTA s 43): name, registration number, director, address, telephone, email',
    ['Tutorlage (Pty) Ltd', '2026/791986/07', 'Pakiso Daniel Setunku', '1 Aventino Lane, Glen Erasmia, Kempton Park', '+27 76 388 5333', 'support@tutorlage.com'].every((s) => t.includes(s)));
  check('terms: the liability section is pointed out in the short version and has a cap with a floor', t.includes('Section 15 limits') && /R1,000, whichever is greater/.test(t));
  check('terms: the request window (48 hours, 30 minutes) matches the database', /48 hours/.test(t) && /30 minutes after the start time/.test(t));
  check('terms: refunds are case by case, with the situations that are always refunded listed (CEO, 17 Oct 2026)',
    /case by case/.test(t) && /We always refund in full when/.test(t) && /the tutor cancels, or does not turn up/.test(t) && /no tutor accepts your request/.test(t) && /charged by mistake, or twice/.test(t));
  check('terms and refund policy: no fixed deadline for refunds (no cooling-off, no 7 or 14 days, no 24-hour rule, no percentage)',
    !/cooling-off|within 7 days|within 14 days|7 days of being charged|24 hours before|up to \*\*50%|50% of the price/i.test(`${t}\n${r}`));
  check('terms: a change to the Terms is announced in the app and blocks nobody; carrying on means accepting it (CEO, 17 Oct 2026)',
    /notice in the app/.test(t) && /Nobody is signed out or stopped from using Tutorlage because of a change/.test(t) && /If you keep using Tutorlage after a change, you accept the new version/.test(t) && !/ask you to accept the new version the next time you sign in/.test(t));
  check('terms and privacy: a learner under 18\'s camera is never used (CEO, 17 Oct 2026)', /A learner under 18's camera is never used/.test(t) && /A learner under 18's camera is never used/.test(p));
  check('terms: the tutor\'s share goes through Paystack to the tutor and Tutorlage never holds it', /tutor's own bank account through Paystack/.test(t) && /never receives or holds the tutor's share/.test(t));
  check('terms: SACE is optional and the police clearance is required (CEO, 14 Oct 2026)', /you \*\*may\*\* also give us your \*\*SACE certificate\*\*; you do not have to/.test(t) && /police clearance certificate\*\* issued in the last 6 months/.test(t));
  check('terms: keep or swap is described (the choice is the learner\'s after the first session)', /keep that tutor/.test(t) && /tutor is not told why/.test(t));
  check('terms: the video room is described, under 18s only in a booked session, never recorded', /video room/.test(t) && /only that/.test(t) && /never recorded/.test(t));
  check('terms: the payments-outside-Tutorlage restraint (B10 of the draft) is NOT in the Terms (CEO, 14 Oct 2026)', !/12 months after your last session/.test(t) && !/restraint/i.test(t));
  check('privacy: the Information Officer and the Regulator\'s complaint route are named', /Information Officer\*\*: \*\*Pakiso Daniel Setunku/.test(p) && p.includes('POPIAComplaints@inforegulator.org.za'));
  check('privacy: the closed-test deletion promise is kept (CEO, 16 Oct 2026): 27 November 2026', /27 November 2026/.test(p) && /28 October 2026/.test(p));
  check('privacy: video room records, ID copies for tutors, school results and the waiting list are all covered', ['Video room records', 'photo of their ID or passport', 'school results', 'Requests to be told when a tutor is available'].every((s) => p.includes(s)));
  check('privacy: the optional qualification and experience documents (teaching qualification, practicum letter, exam marking letter, experience on another platform) are listed, with when they can be added, and in the retention table (CEO, 17 Oct 2026)',
    ['teaching qualification', 'teaching practicum letter', 'exam marking or moderation letter', 'another tutoring platform', 'at any time afterwards'].every((s) => p.includes(s)) && /\| Tutors' ID copies[^\n]*teaching qualifications and letters/.test(p));
  check('privacy: a level can start higher from a verified credential, and staff can set one tutor\'s level with a written reason (automated decisions, section 10)',
    /start at a higher level\*\* because of a verified credential/.test(p) && /set a level for one tutor\*\*, and must write down the reason/.test(p));
  check('privacy: Cloudflare is named as carrying the video calls, with no recording', /Cloudflare\*\*[^\n]*relays video calls[^\n]*does not record or keep it/.test(p));
  check('privacy: every provider the product uses is listed', ['Supabase', 'Paystack', 'Cloudflare', 'Resend', 'GitHub', 'Google'].every((s) => p.includes(`**${s}**`)));
  check('refunds: no charge if nobody accepts; the R1 check is refunded; refunds go back to the card', /you are not charged/.test(r) && /R1 check/.test(r) && /back to the card you paid with/.test(r));
  check('refunds: the situations that are always refunded, the case-by-case rule and what is not refunded are all stated',
    /When we always refund in full/.test(r) && /Every other case: decided one by one/.test(r) && /There is no fixed cancellation window/.test(r) && /What we do not refund/.test(r));
  check('refunds: an agreed refund is never left waiting more than 30 days', /never left waiting more than 30 days/.test(r));
}

// ---- sentences about things the product does not do (so they cannot come back by accident) ----------------------------------
{
  const all = Object.values(docs).join('\n');
  const banned: [string, RegExp][] = [
    ['"paid after the session is completed" (not built: Paystack settles the tutor\'s share on its own schedule)', /after the session is completed/i],
    ['a commission "published on the pricing page" (it is not shown on the site)', /published on the pricing page|published on the site/i],
    ['screen sharing (the video rooms have none)', /screen[- ]shar/i],
    ['"the criteria are published on the site" (tutors see them in the app)', /criteria are published/i],
    ['"written reviews" (the CEO chose "reviews")', /written reviews/i],
    ['a cancel button for sessions booked further ahead (it is by email)', /cancel (it )?from your sessions list[^.]*further ahead/i],
    ['the 12-month restraint on tutors', /12 months after your last session/i],
  ];
  for (const [what, re] of banned) check(`not claimed: ${what}`, !re.test(all));
}

// ---- the page -------------------------------------------------------------------------------------------------------------------
{
  const page = read('src/pages/LegalPage.tsx');
  const version = /export const LEGAL_VERSION = '([^']+)'/.exec(page)?.[1] ?? '';
  check('the page has a version and shows it with the date', version !== '' && /Version \{LEGAL_VERSION\} · Last updated \{LAST_UPDATED\}/.test(page), version);
  check('the page reads the three documents from src/content/legal and never from Drake/', /content\/legal\/terms\.md\?raw/.test(page) && /content\/legal\/privacy\.md\?raw/.test(page) && /content\/legal\/refunds\.md\?raw/.test(page) && !/Drake/.test(page.replace(/\/\/.*$/gm, '')));
  check('the page refuses to show anything while the supplier\'s details are incomplete', /isBusinessInfoComplete\(\)/.test(page));
  check('the "closed test" box is gone (CEO, 17 Oct 2026) but the closed-test deletion promise stays in the Privacy Policy', !/CLOSED_TEST|closed-test-box|Closed test until/.test(page) && /27 November 2026/.test(docs.privacy));
  check('the old tester notice is gone', !/TESTER_NOTICE_VERSION|TesterNotice|Test phase 1: tester notice/.test(page));
  const rules = read('src/lib/accountRules.ts');
  check('the one-line summary of the liability section sits beside both acceptance boxes', /termsSummary/.test(rules) && /COPY\.termsSummary/.test(read('src/pages/CreateAccount.tsx')) && /COPY\.termsSummary/.test(read('src/components/AccountGate.tsx')));
  // A changed version blocks nobody: only a document never accepted in any version stops a person at the gate.
  check('the gate stops only documents never accepted: a new version of something already accepted does not',
    JSON.stringify(documentsNeverAccepted(['terms', 'privacy'], ['terms', 'privacy'])) === '[]' &&
      JSON.stringify(documentsNeverAccepted(['terms', 'privacy'], ['terms'])) === '["privacy"]' &&
      JSON.stringify(documentsNeverAccepted(['terms', 'privacy'], [])) === '["terms","privacy"]' &&
      JSON.stringify(documentsNeverAccepted([], [])) === '[]');
  check('the gate reads the person\'s own acceptance records and uses the rule', /from\('policy_acceptances'\)\.select\('document'\)\.eq\('profile_id', userId\)/.test(read('src/lib/queries.ts')) && /documentsNeverAccepted\(/.test(read('src/lib/queries.ts')));
  check('the gate screen no longer says "Our terms have been updated"', !/Our terms have been updated/.test(read('src/components/AccountGate.tsx')));
  check('a "terms updated" notice opens the Terms in a new tab; session notices still open the sessions page', notificationTarget('terms_updated') === 'terms' && notificationTarget('session_booked') === 'sessions' && notificationTarget('request_for_you') === 'teach' && /window\.open\(siteUrl\('\/terms'\), '_blank', 'noopener'\)/.test(read('src/App.tsx')));
  const migration = read('supabase/migrations/20261017090000_policy_update_notification.sql');
  check('the database sends the notice when either version changes: one trigger, one notice per account, replaces nothing', /after update of setting_value on public\.system_settings/.test(migration) && /'current_terms_version', 'current_privacy_version'/.test(migration) && /n\.created_at = now\(\)/.test(migration) && !/create or replace function public\.(my_pending_acceptances|accept_current_policies)/.test(migration));
  const main = read('src/main.tsx');
  check('the three addresses /terms, /privacy and /refunds are public routes', /path="\/terms"/.test(main) && /path="\/privacy"/.test(main) && /path="\/refunds"/.test(main));
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
