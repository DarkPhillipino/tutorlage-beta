// Email for two in-app notices (SHOULD item 11, 18 Nov 2026): "top-up approved" (to the payer) and "tutor has not joined" (to the learner or parent).
//
// The mail carries the EXACT title (as the subject) and body of the in-app notice, ONE line and a link to open Tutorlage. Nothing else is said: no price, no earnings, no new claim.
// The database decides what may be mailed (supabase/migrations/20261118220000_notice_emails.sql): a switch per kind (OFF by default), notices of the last 3 hours only, each
// notice claimed ONCE, and a daily cap (80, never above 95). This file only: claims, looks up the address, sends, reports back, and logs COUNTS (never an address, a name or the text).
// If the mail path is not set up (RESEND_API_KEY and MAIL_FROM) it claims nothing, so the notices wait (they stay in the app either way).
// Wake-up: the database calls the one route in server/index.ts with a shared secret (migration 20261118220100), like the closing-accounts job.

export type NoticeKind = 'topup_approved' | 'tutor_not_joined';

export interface NoticeClaim {
  notification_id: string;
  profile_id: string;
  kind: NoticeKind;
  title: string;
  body: string | null;
}

export interface NoticeEmailDeps {
  // Is the mail path set up? (If not, nothing is claimed.)
  mailReady: () => boolean;
  // The database's claim function (service key only).
  claim: (limit: number) => Promise<NoticeClaim[]>;
  // Tell the database how it went (counts the day).
  finish: (notificationId: string, sent: boolean) => Promise<void>;
  // The address of the person who owns the notice, from Auth. null when there is none.
  emailOf: (profileId: string) => Promise<string | null>;
  sendMail: (mail: { to: string; subject: string; text: string }) => Promise<{ ok: boolean; waiting?: boolean; detail?: string }>;
  siteUrl: string;
  log: (line: string) => void;
}

export interface NoticeEmailSummary {
  waitingForMailPath: boolean;
  claimed: number;
  sent: number;
  failed: number;
  noAddress: number;
}

// The whole mail. The subject and the first two paragraphs are the notice's own words, unchanged; then one line and the link.
export function buildNoticeMail(notice: Pick<NoticeClaim, 'title' | 'body'>, siteUrl: string): { subject: string; text: string } {
  const body = (notice.body ?? '').trim();
  const text = [notice.title.trim(), ...(body ? [body] : []), `This message is also waiting for you in Tutorlage: ${siteUrl}`].join('\n\n');
  return { subject: notice.title.trim(), text };
}

export async function runNoticeEmails(deps: NoticeEmailDeps, opts: { rounds?: number; limit?: number } = {}): Promise<NoticeEmailSummary> {
  const rounds = opts.rounds ?? 5;
  const limit = opts.limit ?? 10;
  const total: NoticeEmailSummary = { waitingForMailPath: false, claimed: 0, sent: 0, failed: 0, noAddress: 0 };
  if (!deps.mailReady()) {
    total.waitingForMailPath = true;
    deps.log('notice-emails: the mail path is not set up (RESEND_API_KEY, MAIL_FROM); nothing claimed, the notices wait');
    return total;
  }
  for (let round = 0; round < rounds; round += 1) {
    const claimed = await deps.claim(limit);
    if (claimed.length === 0) break;
    total.claimed += claimed.length;
    for (const notice of claimed) {
      let sent = false;
      try {
        const to = await deps.emailOf(notice.profile_id);
        if (!to) {
          total.noAddress += 1;
        } else {
          const mail = buildNoticeMail(notice, deps.siteUrl);
          sent = (await deps.sendMail({ to, subject: mail.subject, text: mail.text })).ok;
        }
      } catch {
        sent = false; // a thrown error is a failed send; what it said is not logged (it could hold an address)
      }
      if (sent) total.sent += 1;
      else total.failed += 1;
      try {
        await deps.finish(notice.notification_id, sent);
      } catch {
        // the claim stays "claimed": it counts against the day and is never sent twice
      }
    }
    if (claimed.length < limit) break;
  }
  // total.failed counts every notice that was claimed and not sent, the ones without an address included
  deps.log(`notice-emails: claimed ${total.claimed}, sent ${total.sent}, not sent ${total.failed} (of which no address ${total.noAddress})`);
  return total;
}
