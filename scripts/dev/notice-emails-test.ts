// SHOULD item 11 (18 Nov 2026): the Worker side of the emails for "top-up approved" and "tutor has not joined" (server/noticeEmails.ts, run with fake clients: no network, no key), how
// server/index.ts wires its one route, and that both migrations agree with the Worker and stay purely additive.
// Run: npx tsx scripts/dev/notice-emails-test.ts
import fs from 'node:fs';
import { buildNoticeMail, runNoticeEmails } from '../../server/noticeEmails';
import type { NoticeClaim, NoticeEmailDeps } from '../../server/noticeEmails';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
// Line endings do not matter: a Windows checkout of the public tree has CRLF, Linux CI has LF, and the patterns below were written for LF.
const read = (f: string) => fs.readFileSync(f, 'utf8').replaceAll(String.fromCharCode(13), '');

const SITE = 'https://tutorlage.com';
const note = (n: number, over: Partial<NoticeClaim> = {}): NoticeClaim => ({
  notification_id: `n${n}`,
  profile_id: `p${n}`,
  kind: 'topup_approved',
  title: 'Money added to your wallet',
  body: `R${n}00 was added to your wallet (reference TL-ZZ${n}).`,
  ...over,
});

interface Opts {
  rounds?: NoticeClaim[][];
  mailReady?: boolean;
  noAddress?: string[];
  sendFails?: string[]; // addresses whose send answers not ok
  sendThrows?: string[];
}
function world(opts: Opts = {}) {
  const sent: { to: string; subject: string; text: string }[] = [];
  const finished: [string, boolean][] = [];
  const logs: string[] = [];
  let claimCalls = 0;
  const rounds = [...(opts.rounds ?? [])];
  const deps: NoticeEmailDeps = {
    mailReady: () => opts.mailReady ?? true,
    claim: async () => {
      claimCalls += 1;
      return rounds.shift() ?? [];
    },
    finish: async (id, ok) => {
      finished.push([id, ok]);
    },
    emailOf: async (profileId) => (opts.noAddress?.includes(profileId) ? null : `${profileId}@example.invalid`),
    sendMail: async (m) => {
      if (opts.sendThrows?.includes(m.to)) throw new Error(`boom for ${m.to}`);
      if (opts.sendFails?.includes(m.to)) return { ok: false, detail: `Resend 422: bad address ${m.to}` };
      sent.push(m);
      return { ok: true };
    },
    siteUrl: SITE,
    log: (l) => logs.push(l),
  };
  return { deps, sent, finished, logs, claimCalls: () => claimCalls };
}

(async () => {
  // 1. the words: exactly the notice, one line, a link
  {
    const n = note(1);
    const m = buildNoticeMail(n, SITE);
    check('the subject is the notice title, unchanged', m.subject === n.title);
    check('the text is title, body, then ONE line with the link, nothing else', m.text === `${n.title}\n\n${n.body}\n\nThis message is also waiting for you in Tutorlage: ${SITE}`, JSON.stringify(m.text));
    const noBody = buildNoticeMail({ title: 'Only a title', body: null }, SITE);
    check('a notice without a body is title and the one line only', noBody.text === `Only a title\n\nThis message is also waiting for you in Tutorlage: ${SITE}`);
    check('the mail says nothing about price, earnings or fees that the notice did not say', !/earn|price|fee|commission|payout|discount/i.test(buildNoticeMail({ title: 'T', body: 'B' }, SITE).text));
  }

  // 2. no mail path: nothing is claimed, so the notices wait
  {
    const w = world({ mailReady: false, rounds: [[note(1)]] });
    const s = await runNoticeEmails(w.deps);
    check('without RESEND_API_KEY and MAIL_FROM nothing is claimed and nothing is sent', s.waitingForMailPath && w.claimCalls() === 0 && w.sent.length === 0 && w.finished.length === 0);
  }

  // 3. the normal run: each notice goes to its own owner, each is reported once
  {
    const w = world({ rounds: [[note(1), note(2, { kind: 'tutor_not_joined', title: 'Your tutor has not joined', body: null }), note(3)]] });
    const s = await runNoticeEmails(w.deps);
    check('three notices, three mails, each to its owner', w.sent.length === 3 && w.sent.map((m) => m.to).join() === 'p1@example.invalid,p2@example.invalid,p3@example.invalid');
    check('each is reported back as sent, once', JSON.stringify(w.finished) === JSON.stringify([['n1', true], ['n2', true], ['n3', true]]));
    check('the summary says 3 claimed, 3 sent', s.claimed === 3 && s.sent === 3 && s.failed === 0 && s.noAddress === 0);
    check('a tutor-not-joined notice is mailed with its own words too', w.sent[1].subject === 'Your tutor has not joined' && w.sent[1].text.startsWith('Your tutor has not joined\n\nThis message'));
  }

  // 4. things that go wrong never stop the run and never send twice
  {
    const w = world({ rounds: [[note(1), note(2), note(3), note(4)]], sendFails: ['p2@example.invalid'], sendThrows: ['p3@example.invalid'], noAddress: ['p4'] });
    const s = await runNoticeEmails(w.deps);
    check('a refused send, a thrown error and a missing address are each reported as not sent, and the rest still goes', JSON.stringify(w.finished) === JSON.stringify([['n1', true], ['n2', false], ['n3', false], ['n4', false]]) && w.sent.length === 1);
    check('the summary counts them', s.claimed === 4 && s.sent === 1 && s.failed === 3 && s.noAddress === 1);
  }

  // 5. rounds: a full batch asks again, a short batch stops, an empty claim stops at once
  {
    const w = world({ rounds: [[note(1), note(2)], [note(3), note(4)], [note(5)]] });
    const s = await runNoticeEmails(w.deps, { rounds: 5, limit: 2 });
    check('full batches are followed by another claim, a short one ends the run', s.claimed === 5 && w.claimCalls() === 3);
    const e = world({ rounds: [] });
    await runNoticeEmails(e.deps);
    check('an empty claim sends nothing and asks once', e.claimCalls() === 1 && e.sent.length === 0);
    const cap = world({ rounds: [[note(1)], [note(2)], [note(3)]] });
    await runNoticeEmails(cap.deps, { rounds: 2, limit: 1 });
    check('the number of rounds is limited', cap.claimCalls() === 2 && cap.sent.length === 2);
  }

  // 6. the log holds counts only
  {
    const w = world({ rounds: [[note(1, { body: 'SECRETBODY Zzfamily', title: 'SECRETTITLE' })]], sendThrows: [] });
    await runNoticeEmails(w.deps);
    const all = w.logs.join('\n');
    check('the log names no address, no name and none of the text', !/example\.invalid|SECRETBODY|SECRETTITLE|Zzfamily|@/.test(all) && /claimed 1, sent 1/.test(all), all);
    const t = world({ rounds: [[note(1)]], sendThrows: ['p1@example.invalid'] });
    await runNoticeEmails(t.deps);
    check('a thrown error is not written to the log either', !/boom|example\.invalid/.test(t.logs.join('\n')));
  }

  // 7. the route in server/index.ts
  {
    const idx = read('server/index.ts');
    const i = idx.indexOf("app.post('/api/internal/notice-emails/run'");
    const route = i >= 0 ? idx.slice(i, i + 900) : '';
    check('one route exists, behind the job secret (503 when unset, 401 when wrong), counts only in the answer',
      /if \(!NOTICE_EMAIL_JOB_SECRET\)[\s\S]*503[\s\S]*jobSecretMatches\(req\.headers\['x-job-secret'\], NOTICE_EMAIL_JOB_SECRET\)[\s\S]*401[\s\S]*runNoticeEmails/.test(route));
    check('the secret comes from the environment only', /const NOTICE_EMAIL_JOB_SECRET = process\.env\.NOTICE_EMAIL_JOB_SECRET;/.test(idx));
    check('it uses the two database functions, with the service key client, and the same mail sender as the closing job', /db\.rpc\('notice_email_claim', \{ p_limit: limit \}\)/.test(idx) && /db\.rpc\('notice_email_finish', \{ p_notification_id: notificationId, p_sent: sent \}\)/.test(idx) && /sendMail: mailerFromEnv\(process\.env, \(url, init\) => fetch\(url, init\)\),\n  siteUrl/.test(idx));
    check('the address comes from Auth at send time and is not stored by this route', /getUserById\(profileId\)/.test(idx) && !/insert\(|\.from\('notice_emails'\)/.test(idx.slice(i, i + 2500)));
  }

  // 8. the migrations: what the Worker calls exists, and both stay purely additive
  {
    const m1 = read('supabase/migrations/20261118220000_notice_emails.sql');
    const m2 = fs.existsSync('supabase/migrations/20261118220100_notice_emails_wake.sql') ? read('supabase/migrations/20261118220100_notice_emails_wake.sql') : '';
    const code = (s: string) => s.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
    const c1 = code(m1);
    const c2 = code(m2);
    check('the database has the two functions the Worker calls, with the arguments it passes', /function public\.notice_email_claim\(p_limit integer/.test(c1) && /function public\.notice_email_finish\(p_notification_id uuid, p_sent boolean\)/.test(c1));
    check('every switch is OFF and the cap is 80 and never above 95', /'notice_email_topup_approved', 'false'::jsonb/.test(c1) && /'notice_email_tutor_not_joined', 'false'::jsonb/.test(c1) && /'notice_email_daily_cap', '80'::jsonb/.test(c1) && /, 95\)/.test(c1));
    check('server key only: every function is revoked from public, anon and authenticated, and granted to service_role only',
      /revoke all on function public\.notice_email_claim\(integer\) from public, anon, authenticated;\ngrant execute on function public\.notice_email_claim\(integer\) to service_role;/.test(c1) &&
      /revoke all on function public\.notice_email_finish\(uuid, boolean\) from public, anon, authenticated;\ngrant execute on function public\.notice_email_finish\(uuid, boolean\) to service_role;/.test(c1));
    check('both tables have row level security on and no policy, and nobody but the server can read them', /alter table public\.notice_emails enable row level security;/.test(c1) && /alter table public\.notice_email_days enable row level security;/.test(c1) && !/create policy|alter policy|drop policy/i.test(c1 + c2));
    check('purely additive: nothing is dropped or altered, no trigger, nothing granted to anon or signed-in people, no wallet function touched',
      !/\bdrop\b|\balter table public\.(?!notice_email)|create trigger|grant [^;]* to (anon|authenticated|public)|wallet_(credit|post|notify|hold|release)/i.test(c1 + c2));
    check('the mail kinds are exactly the two notices: the existing top-up type, and tutor_not_joined (which no migration writes yet: nothing is invented)', /'wallet_topup_added'/.test(c1) && /'tutor_not_joined'/.test(c1));
    check('the claim table keeps no address, name or text', !/^\s*(email|address|\w*name|body|title|message|text)\s/im.test(c1.slice(c1.indexOf('create table if not exists public.notice_emails'), c1.indexOf('create index'))));
    if (m2) {
      check('the wake-up migration: one function and one job, server key only, off when no worker address or secret is set', /function public\.run_notice_emails\(\)/.test(c2) && /cron\.schedule\('run-notice-emails'/.test(c2) && /revoke all on function public\.run_notice_emails\(\) from public, anon, authenticated;/.test(c2) && /vault\.decrypted_secrets where name = 'notice_email_job_secret'/.test(c2) && /\/api\/internal\/notice-emails\/run/.test(c2));
    }
  }

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
