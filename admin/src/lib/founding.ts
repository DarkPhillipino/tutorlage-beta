// The admin app's half of the FOUNDING TUTORS LIST (CEO, 10 Nov 2026; plan Drake/project-manager/tutor-waitlist-page-action-plan-2026-11-10.md section 9 P-2 to P-4;
// database: supabase/migrations/20261110200000_founding_tutors_list.sql; the ready-made messages are sections 5c and 5d of
// Drake/marketing-gtm/founding-tutors-drafts-2026-11-10.md). Everything is read and written through the database's admin functions (the table itself has no API
// right at all). The app SENDS NOTHING: a "message ready" button opens a wa.me link with the text filled in, and the CEO presses send in WhatsApp himself.
//
// TOLERANT on purpose: the admin app runs live from the working folder, so it can be opened before the migration is applied. A missing function is a plain
// "not switched on yet" state, never a broken page.
// Pure on purpose (the client is an argument, no Supabase import) so scripts/dev/admin-founding-test.ts can check it under Node.
import { describeAgo } from './suggestions';

export { describeAgo };

export type FoundingStatus = 'joined' | 'released' | 'signed_up' | 'verified';
export const FOUNDING_STATUSES: FoundingStatus[] = ['joined', 'released', 'signed_up', 'verified'];
// What the screen shows: the stored status moved forward by what is true, plus "lapsed" (a released person with no account 14 days after the message, back on the list).
export type EffectiveStatus = FoundingStatus | 'lapsed';
export const EFFECTIVE_STATUSES: EffectiveStatus[] = ['joined', 'lapsed', 'released', 'signed_up', 'verified'];
export const STATUS_LABELS: Record<EffectiveStatus, string> = { joined: 'On the list', lapsed: 'Lapsed', released: 'Released', signed_up: 'Signed up', verified: 'Verified' };

// The same five names as the database's founding_phase_of().
export const PHASES = ['Foundation (R-3)', 'Intermediate (4-6)', 'Senior (7-9)', 'FET (10-12)', 'University and adult'] as const;

export const PRACTICUM_LABELS: Record<string, string> = { none: 'None yet', one: 'One block', two: 'Two blocks', three_plus: 'Three or more' };
export const POLICE_LABELS: Record<string, string> = { have: 'Has one (last 6 months)', applied: 'Applied', not_yet: 'Not yet' };
export const REACH_LABELS: Record<string, string> = { none: 'None', up_to_10: 'Up to 10', '10_to_30': '10 to 30', over_30: 'More than 30' };
export const AVAILABILITY_LABELS: Record<string, string> = { evenings: 'Evenings', weekends: 'Weekends', holidays: 'School holidays and December' };
export const HEARD_LABELS: Record<string, string> = { message: 'A message or group chat', friend: 'A friend', other: 'Other' };

export const FOUNDING_NOT_ON_YET = 'The founding tutors list is not switched on in this database yet. It starts as soon as its database change is applied.';
export const FOUNDING_NO_ACCESS = 'Only a verification officer or a super admin can see the founding tutors list.';
export const SIGNUP_LINK = 'https://tutorlage.com/signup/tutor';
// A released person with no account after this many days goes back to "On the list" (marked lapsed); the database's daily job does it, and the message says so.
export const LAPSE_DAYS = 14;

export interface SubjectRange { subject: string; minGrade: string; maxGrade: string }

export interface FoundingEntry {
  id: string;
  createdAt: string;
  source: string;
  fullName: string;
  codeName: string;
  whatsapp: string | null;
  email: string | null;
  subjects: SubjectRange[];
  phases: string[];
  availability: string[];
  unavailableWeeks: string;
  practicum: string;
  policeClearance: string;
  parentReach: string;
  parentReachWilling: boolean | null;
  priorTutoring: string;
  heardFrom: string;
  hasDevice: boolean;
  hasConnection: boolean;
  hasBank: boolean;
  consentContactAt: string | null;
  consentMarketingAt: string | null;
  consentVersion: string;
  src: string;
  // What is stored, and what is true now (a released entry whose person has an account is "signed_up"; a verified account is "verified").
  status: FoundingStatus;
  effectiveStatus: EffectiveStatus;
  lapsedAt: string | null;
  releasedAt: string | null;
  releasedMessagedAt: string | null;
  verifiedMessagedAt: string | null;
  waitingMessagedAt: string | null;
  deleteAfter: string | null;
  hasAccount: boolean;
  tutorVerified: boolean;
  weeklyHours: number;
  // READY for the verified message: verified AND an approved subject AND hours saved AND a current police clearance (the tests the database uses to let a tutor accept).
  // Otherwise `missing` says what is not there yet in plain words.
  ready: boolean;
  missing: string[];
}

// R7: per subject and grade band. OPEN = 3 or more ready tutors (verified, an approved subject for the band, hours saved), THIN = 1 or 2, EMPTY = none.
export interface CoverageRow {
  subject: string; phase: string; onList: number; released: number; verified: number; readyTutors: number; weeklyHours: number;
  requests: number; accepted: number; unservedRequests: number; expired: number; status: 'OPEN' | 'THIN' | 'EMPTY'; demandNoSupply: boolean;
}
// R1: opens by the tag the link carried; visitors, seeMore and formStart are NEW (first ever) and filed under the visitor's first tag, so days add up; joins are real entries.
export interface FunnelRow { day?: string; hour?: string; src: string; opens: number; visitors: number; seeMore: number; formStart: number; joins: number; registered?: boolean }
export interface Funnel { from: string; to: string; byDay: FunnelRow[]; bySrc: FunnelRow[]; totals: Omit<FunnelRow, 'src' | 'day' | 'hour' | 'registered'>; unregistered: string[] }
export interface GateCheck {
  gateOn: boolean;
  tutorAccounts: number;
  verified: number;
  released: number;
  waiting: number;
  notListed: number;
  notListedAccounts: { id: string; name: string }[];
}

export interface FoundingData { entries: FoundingEntry[]; coverage: CoverageRow[]; funnel: Funnel | null; hourly: FunnelRow[]; tags: string[]; gate: GateCheck | null }
export interface DayRange { from: string; to: string }
export type FoundingResult =
  | { state: 'ok'; data: FoundingData }
  | { state: 'not_set_up' }
  | { state: 'no_access' }
  | { state: 'failed'; message: string };

interface DbError { code?: string; message?: string }
interface DbResult { data: unknown; error: DbError | null }
export interface FoundingAdminClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
}

// PostgREST says PGRST202 when a function is not in its schema cache; Postgres says 42883.
export function isMissingFounding(error: DbError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === 'PGRST205' || error.code === '42883' || error.code === '42P01') return true;
  const message = error.message ?? '';
  return /(founding|admin_release_founding|admin_set_founding)/i.test(message) && /(does not exist|schema cache|could not find)/i.test(message);
}
const isNoAccess = (error: DbError | null | undefined): boolean => error?.code === '42501';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0);
const nullableText = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const asStatus = (v: unknown): FoundingStatus => (FOUNDING_STATUSES.includes(v as FoundingStatus) ? (v as FoundingStatus) : 'joined');
const asEffective = (v: unknown): EffectiveStatus => (EFFECTIVE_STATUSES.includes(v as EffectiveStatus) ? (v as EffectiveStatus) : 'joined');

export function mapEntry(raw: Record<string, unknown>): FoundingEntry {
  const subjects = (Array.isArray(raw.subjects) ? raw.subjects : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({ subject: text(s.subject), minGrade: text(s.min_grade), maxGrade: text(s.max_grade) }));
  return {
    id: text(raw.id),
    createdAt: text(raw.created_at),
    source: text(raw.source),
    fullName: text(raw.full_name),
    codeName: text(raw.code_name),
    whatsapp: nullableText(raw.whatsapp),
    email: nullableText(raw.email),
    subjects,
    phases: strings(raw.phases),
    availability: strings(raw.availability),
    unavailableWeeks: text(raw.unavailable_weeks),
    practicum: text(raw.practicum),
    policeClearance: text(raw.police_clearance),
    parentReach: text(raw.parent_reach),
    parentReachWilling: typeof raw.parent_reach_willing === 'boolean' ? raw.parent_reach_willing : null,
    priorTutoring: text(raw.prior_tutoring),
    heardFrom: text(raw.heard_from),
    hasDevice: raw.has_device === true,
    hasConnection: raw.has_connection === true,
    hasBank: raw.has_bank === true,
    consentContactAt: nullableText(raw.consent_contact_at),
    consentMarketingAt: nullableText(raw.consent_marketing_at),
    consentVersion: text(raw.consent_version),
    src: text(raw.src),
    status: asStatus(raw.status),
    effectiveStatus: asEffective(raw.effective_status ?? raw.status),
    lapsedAt: nullableText(raw.lapsed_at),
    releasedAt: nullableText(raw.released_at),
    releasedMessagedAt: nullableText(raw.released_messaged_at),
    verifiedMessagedAt: nullableText(raw.verified_messaged_at),
    waitingMessagedAt: nullableText(raw.waiting_messaged_at),
    deleteAfter: nullableText(raw.delete_after),
    hasAccount: raw.has_account === true,
    tutorVerified: raw.tutor_verified === true,
    weeklyHours: num(raw.weekly_hours),
    ready: raw.ready === true,
    missing: strings(raw.missing),
  };
}

export function mapCoverage(raw: Record<string, unknown>): CoverageRow {
  const ready = num(raw.ready_tutors);
  const status = raw.status === 'OPEN' || raw.status === 'THIN' || raw.status === 'EMPTY' ? raw.status : ready >= 3 ? 'OPEN' : ready >= 1 ? 'THIN' : 'EMPTY';
  return {
    subject: text(raw.subject), phase: text(raw.phase), onList: num(raw.on_list), released: num(raw.released), verified: num(raw.verified), readyTutors: ready,
    weeklyHours: num(raw.weekly_hours), requests: num(raw.requests), accepted: num(raw.accepted), unservedRequests: num(raw.unserved_requests), expired: num(raw.expired),
    status, demandNoSupply: raw.demand_no_supply === true,
  };
}

const mapFunnelRow = (raw: Record<string, unknown>): FunnelRow => ({
  day: nullableText(raw.day) ?? undefined, hour: nullableText(raw.hour) ?? undefined, src: text(raw.src) || '(none)', opens: num(raw.opens), visitors: num(raw.visitors),
  seeMore: num(raw.see_more), formStart: num(raw.form_start), joins: num(raw.joins), registered: typeof raw.registered === 'boolean' ? raw.registered : undefined,
});
const objects = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);

export function mapFunnel(raw: unknown): Funnel | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const t = mapFunnelRow((r.totals && typeof r.totals === 'object' ? r.totals : {}) as Record<string, unknown>);
  return {
    from: text(r.from), to: text(r.to),
    byDay: objects(r.by_day).map(mapFunnelRow),
    bySrc: objects(r.by_src).map(mapFunnelRow),
    totals: { opens: t.opens, visitors: t.visitors, seeMore: t.seeMore, formStart: t.formStart, joins: t.joins },
    unregistered: strings(r.unregistered),
  };
}

export const mapHourly = (raw: unknown): FunnelRow[] => (raw && typeof raw === 'object' ? objects((raw as Record<string, unknown>).by_hour).map(mapFunnelRow) : []);

// Day ranges are plain dates (South African days). "Last N days" ends today.
export const isoDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function lastDays(n: number, now: Date = new Date()): DayRange {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1));
  return { from: isoDay(from), to: isoDay(now) };
}

// R14: one row per day per tag, the five counters, counts only (no names, emails or numbers). New visitors and first see-more / form starts, so the days add up.
export const CSV_HEADER = 'day,tag,opens,new_visitors,first_see_more,first_form_starts,joins';
export function dailyCsv(funnel: Funnel | null): string {
  const rows = (funnel?.byDay ?? []).slice().sort((a, b) => (a.day ?? '').localeCompare(b.day ?? '') || a.src.localeCompare(b.src));
  const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [CSV_HEADER, ...rows.map((r) => [r.day ?? '', r.src, r.opens, r.visitors, r.seeMore, r.formStart, r.joins].map(cell).join(','))].join('\n') + '\n';
}
// Opened once in the CEO's or PM's own browser, this stops that browser from being counted (it is remembered in that browser only); ?nocount=0 puts counting back.
export const NOCOUNT_LINK = 'https://tutorlage.com/teach?nocount=1';
export const COUNT_AGAIN_LINK = 'https://tutorlage.com/teach?nocount=0';

export function mapGateCheck(raw: unknown): GateCheck | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    gateOn: r.gate_on === true, tutorAccounts: num(r.tutor_accounts), verified: num(r.verified), released: num(r.released), waiting: num(r.waiting), notListed: num(r.not_listed),
    notListedAccounts: objects(r.not_listed_accounts).map((a) => ({ id: text(a.id), name: text(a.name) || 'Unnamed tutor' })),
  };
}

// Everything the page shows, in one go. The list is the one that matters: if it says "not there yet" the whole page says so; the other three may fail alone
// (their parts of the page then show nothing). Never throws.
export async function fetchFounding(db: FoundingAdminClient, range: DayRange = lastDays(30)): Promise<FoundingResult> {
  try {
    const [entries, coverage, funnel, gate, hourly, tags] = await Promise.all([
      db.rpc('admin_founding_entries'),
      db.rpc('admin_founding_coverage'),
      db.rpc('admin_founding_funnel', { p_from: range.from, p_to: range.to }),
      db.rpc('admin_founding_gate_check'),
      db.rpc('admin_founding_hourly'),
      db.rpc('admin_founding_tags'),
    ]);
    if (entries.error) {
      if (isMissingFounding(entries.error)) return { state: 'not_set_up' };
      if (isNoAccess(entries.error)) return { state: 'no_access' };
      return { state: 'failed', message: entries.error.message ?? 'Could not load the list.' };
    }
    const rows = objects(entries.data).map(mapEntry);
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      state: 'ok',
      data: {
        entries: rows,
        coverage: coverage.error ? [] : objects(coverage.data).map(mapCoverage),
        funnel: funnel.error ? null : mapFunnel(funnel.data),
        hourly: hourly.error ? [] : mapHourly(hourly.data),
        tags: tags.error ? [] : strings(tags.data),
        gate: gate.error ? null : mapGateCheck(gate.data),
      },
    };
  } catch (e) {
    return { state: 'failed', message: e instanceof Error ? e.message : 'Could not load the list.' };
  }
}

export async function fetchFunnel(db: FoundingAdminClient, range: DayRange): Promise<Funnel | null> {
  try {
    const { data, error } = await db.rpc('admin_founding_funnel', { p_from: range.from, p_to: range.to });
    return error ? null : mapFunnel(data);
  } catch {
    return null;
  }
}

// By-hour counts for a stretch (default the last 72 hours): send day and the days after.
export async function fetchHourly(db: FoundingAdminClient, from?: string, to?: string): Promise<FunnelRow[] | null> {
  try {
    const { data, error } = await db.rpc('admin_founding_hourly', from && to ? { p_from: from, p_to: to } : undefined);
    return error ? null : mapHourly(data);
  } catch {
    return null;
  }
}

// ---- filters and counts ----------------------------------------------------------------------------------------------------------------------------
export interface EntryFilter { status: EffectiveStatus | 'all'; subject: string; phase: string; search: string }
export const NO_FILTER: EntryFilter = { status: 'all', subject: '', phase: '', search: '' };

export function filterEntries(rows: FoundingEntry[], f: EntryFilter): FoundingEntry[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.status !== 'all' && r.effectiveStatus !== f.status) return false;
    if (f.subject && !r.subjects.some((s) => s.subject === f.subject)) return false;
    if (f.phase && !r.phases.includes(f.phase)) return false;
    if (q && !`${r.fullName} ${r.codeName} ${r.email ?? ''} ${r.whatsapp ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function countsByStatus(rows: FoundingEntry[]): Record<EffectiveStatus | 'all', number> {
  const c: Record<EffectiveStatus | 'all', number> = { all: rows.length, joined: 0, lapsed: 0, released: 0, signed_up: 0, verified: 0 };
  for (const r of rows) c[r.effectiveStatus] += 1;
  return c;
}

export const subjectOptions = (rows: FoundingEntry[]): string[] => Array.from(new Set(rows.flatMap((r) => r.subjects.map((s) => s.subject)))).sort((a, b) => a.localeCompare(b));

// ---- the ready-made WhatsApp messages (the CEO sends them; the app sends nothing) ----------------------------------------------------------------------
export const greetingName = (e: Pick<FoundingEntry, 'codeName' | 'fullName'>): string => e.codeName.trim() || e.fullName.trim().split(/\s+/)[0] || 'there';

// Section 5c of the drafts: "Your place is open".
export function releaseMessage(e: Pick<FoundingEntry, 'codeName' | 'fullName' | 'email'>): string {
  return [
    `Hi ${greetingName(e)}, your place on Tutorlage has opened and stays open for ${LAPSE_DAYS} days. If this is not a good time, reply LATER and we will move you to a later group.`,
    `1. Create your account here: ${SIGNUP_LINK}, using ${e.email ?? 'the email you gave us'}.`,
    '2. Upload your documents in the app: ID or passport, police clearance from the last 6 months, school results or proof of your teaching experience, and your bank details.',
    '3. We check them within up to a week and message you here when you are verified.',
    'Stuck? Reply here.',
  ].join('\n');
}

// Section 5d, variant 1 (until the personal-link code works).
// Section 5b of the drafts: the "Still waiting" update, sent after each release to everyone who is not released. subjects is what the CEO types (the subjects opened this week).
export function waitingMessage(e: Pick<FoundingEntry, 'codeName' | 'fullName'>, subjects: string): string {
  return `Hi ${greetingName(e)}, a quick update from Tutorlage. This week we opened places for ${subjects.trim()}. Yours has not opened yet: we open places where families are asking. We will message you here when it does. Please keep your documents ready. Reply STOP to leave the list.`;
}

export function verifiedMessage(e: Pick<FoundingEntry, 'codeName' | 'fullName'>): string {
  return `Hi ${greetingName(e)}, good news: you are verified on Tutorlage and can now accept requests. Open your Tutor page and check that your subjects and hours are set. You will see requests that match your level and subjects. Questions? Reply here.`;
}

// Section 5d, variant 2 (code live, tutor bonus live): NOT used by any button yet. It is here so the switch is one line when the code system is live.
export function verifiedMessageWithLink(e: Pick<FoundingEntry, 'codeName' | 'fullName'>, code: string): string {
  return [
    `Hi ${greetingName(e)}, good news: you are verified on Tutorlage and can now accept requests. Open your Tutor page and check that your subjects and hours are set. You will see requests that match your level and subjects.`,
    `Your personal link: tutorlage.com/?code=${code}`,
    'Families who join with it get 10% off their first 3 lessons, and you earn 5% more on lessons with those families. Share it with families you know.',
    'Questions? Reply here.',
  ].join('\n');
}

// "+27821234567" -> "27821234567" (wa.me wants digits only), or null when the number cannot be one.
export function waDigits(number: string | null | undefined): string | null {
  const d = (number ?? '').replace(/[^0-9]/g, '');
  return /^27[6-8][0-9]{8}$/.test(d) ? d : null;
}
export function waLink(number: string | null | undefined, message: string): string | null {
  const d = waDigits(number);
  return d ? `https://wa.me/${d}?text=${encodeURIComponent(message)}` : null;
}

// ---- the writes (each returns null when it worked, else the sentence to show) --------------------------------------------------------------------------
async function call(db: FoundingAdminClient, fn: string, args: Record<string, unknown>): Promise<{ error: string | null; data: unknown }> {
  try {
    const { data, error } = await db.rpc(fn, args);
    if (!error) return { error: null, data };
    if (isMissingFounding(error)) return { error: FOUNDING_NOT_ON_YET, data: null };
    return { error: error.message ?? 'Could not save that change.', data: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save that change.', data: null };
  }
}

export async function releaseEntries(db: FoundingAdminClient, ids: string[]): Promise<{ error: string | null; released: number; skipped: number }> {
  const r = await call(db, 'admin_release_founding', { p_ids: ids });
  const d = (r.data ?? {}) as { released?: unknown; skipped?: unknown };
  return { error: r.error, released: num(d.released), skipped: num(d.skipped) };
}
export async function markMessaged(db: FoundingAdminClient, id: string, kind: 'released' | 'verified' | 'waiting'): Promise<string | null> {
  return (await call(db, 'admin_mark_founding_messaged', { p_id: id, p_kind: kind })).error;
}
export async function setEntryStatus(db: FoundingAdminClient, id: string, status: FoundingStatus): Promise<string | null> {
  return (await call(db, 'admin_set_founding_status', { p_id: id, p_status: status })).error;
}
export interface NewEntry { fullName: string; codeName: string; whatsapp: string; email: string; status: 'joined' | 'released' | 'verified' }
export async function addEntry(db: FoundingAdminClient, e: NewEntry): Promise<string | null> {
  return (await call(db, 'admin_add_founding_entry', { p_full_name: e.fullName, p_code_name: e.codeName, p_whatsapp: e.whatsapp, p_email: e.email, p_status: e.status })).error;
}
// "Link this account": an entry whose person signed up with a different email is linked to their tutor account by typing that sign-up email.
export async function linkEntry(db: FoundingAdminClient, id: string, email: string): Promise<string | null> {
  return (await call(db, 'admin_link_founding_entry', { p_id: id, p_email: email })).error;
}
export async function setGate(db: FoundingAdminClient, on: boolean): Promise<string | null> {
  return (await call(db, 'admin_set_founding_gate', { p_on: on })).error;
}
// "Remove and delete": really deletes one entry (our STOP messages promise it). Not for an existing tutor's account line.
export async function deleteEntry(db: FoundingAdminClient, id: string): Promise<string | null> {
  return (await call(db, 'admin_delete_founding_entry', { p_id: id })).error;
}
// The registered tags (a trailing * registers a prefix, for example ref-*): comma, space or line separated.
export const parseTags = (raw: string): string[] => Array.from(new Set(raw.split(/[\s,]+/).map((t) => t.trim().toLowerCase()).filter(Boolean)));
export async function saveTags(db: FoundingAdminClient, tags: string[]): Promise<string | null> {
  return (await call(db, 'admin_set_founding_tags', { p_tags: tags })).error;
}

// "12%" of opens that joined, or "–" when there were none.
export function rate(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';
}
