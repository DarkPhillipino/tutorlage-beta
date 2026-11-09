// THE PILOT NOTICE ON THE BANK-TRANSFER TOP-UP (plan Drake/project-manager/tutor-recruitment-plan-2026-11-04.md section 8.4; CEO's answers of 5 Nov 2026)
// and the status line on a top-up that is waiting for a person to check it. The notice says why a transfer is not instant and how long a check usually
// takes. Its words and its times live in ONE system_settings row ('topup_pilot_notice', super admin edits it in the admin app's System Settings, no
// publish needed) and are read through the database function topup_pilot_notice() (one question with a fixed shape; a signed-in person can also read
// the row directly under an existing policy, but the app does not depend on that).
//
// TOLERANT on purpose: a database without the function or the row, any error, or an odd value all mean "use the built-in words below", so the
// notice never disappears by accident and the Add-money screen never breaks. The only way to hide it is the row saying "enabled": false.
// No browser or Supabase imports (the client is an argument), so scripts/dev/pilot-notice-test.ts runs it under Node.
import { describeSaWhen } from './saTime';
import type { WalletClient } from './wallet';

// The built-in words (plan 8.4's wording; the times are the CEO's choice of 9 Nov 2026, 6 hours, and he can change them without a publish). They equal
// the starting row in supabase/migrations/20261105120000_platform_suggestions.sql (pilot-notice-test.ts checks that).
export const DEFAULT_PILOT_TIMES = '6 hours (08:00 to 20:00; a transfer sent later is checked by 10:00 the next morning)';
export const DEFAULT_PILOT_TEXT =
  'Tutorlage is in its pilot, so every bank transfer is checked by a person: usually within {times}. We are building instant payments. A tutor is only paid after your session is complete.';

const MAX_TEXT = 600;
const MAX_TIMES = 200;

export interface PilotNotice {
  enabled: boolean;
  // The finished sentence(s) to show, with {times} already filled in.
  text: string;
}

const fill = (text: string, times: string) => text.split('{times}').join(times);

export const DEFAULT_PILOT_NOTICE: PilotNotice = { enabled: true, text: fill(DEFAULT_PILOT_TEXT, DEFAULT_PILOT_TIMES) };

const cleanText = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
};

// What the database row (any JSON) means. An object: { enabled?: boolean, times?: string, text?: string }; {times} inside "text" is replaced by "times".
// A plain text value is taken as the whole notice. Anything else, or a field that is missing, empty or too long, falls back to the built-in words.
export function resolvePilotNotice(value: unknown): PilotNotice {
  if (typeof value === 'string') {
    const text = cleanText(value, MAX_TEXT);
    return text ? { enabled: true, text: fill(text, DEFAULT_PILOT_TIMES) } : DEFAULT_PILOT_NOTICE;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (o.enabled === false) return { enabled: false, text: '' };
    const times = cleanText(o.times, MAX_TIMES) ?? DEFAULT_PILOT_TIMES;
    const text = cleanText(o.text, MAX_TEXT) ?? DEFAULT_PILOT_TEXT;
    return { enabled: true, text: fill(text, times) };
  }
  return DEFAULT_PILOT_NOTICE;
}

// Asks the database. Never throws; every doubt gives the built-in notice.
export async function fetchPilotNotice(db: Pick<WalletClient, 'rpc'>): Promise<PilotNotice> {
  try {
    const { data, error } = await db.rpc('topup_pilot_notice');
    if (error) return DEFAULT_PILOT_NOTICE;
    return resolvePilotNotice(data);
  } catch {
    return DEFAULT_PILOT_NOTICE;
  }
}

// The line on a top-up that has its proof and waits for a person: "Sent 14:05 SAST, waiting for a person to check it". Times are South African time and
// say so (release gate SA-LOCALE-01); an earlier day names the day ("Sent Wed 4 Nov, 14:05 SAST, ..."). With no time to show, the time is left out.
export function waitingLine(sentAt: string | null | undefined, now: number = Date.now()): string {
  const when = describeSaWhen(sentAt, now);
  if (!when) return 'Sent, waiting for a person to check it';
  const shown = when.startsWith('Today, ') ? when.slice('Today, '.length) : when;
  return `Sent ${shown}, waiting for a person to check it`;
}
