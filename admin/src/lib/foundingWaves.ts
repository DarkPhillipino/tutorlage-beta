// The admin app's half of the FOUNDING TUTORS CAMPAIGN NUMBERS, part 2 (11 Nov 2026; Marketing's measurement document section 9.2 and the PM's queue; database:
// supabase/migrations/20261111120000_founding_waves.sql): R5 a dated step for every person, R6 the funnel by wave, R8 the suggested release list, R9 the trigger
// panel, R10 the verification pipeline, R11 the form-answer summaries and R4 the abandons by last field. Everything is read through the database's admin functions;
// nothing here sends anything (the CEO presses Release himself, and sends each WhatsApp message himself).
//
// TOLERANT on purpose, like founding.ts: opened before the database change is applied, a missing function is a plain "not switched on yet", never a broken page.
// Pure on purpose (the client is an argument, no Supabase import) so scripts/dev/admin-founding-waves-test.ts can check it under Node.
import { FOUNDING_NOT_ON_YET, FOUNDING_NO_ACCESS, isMissingFounding, type FoundingAdminClient } from './founding';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const nullableText = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0);
const nullableNum = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const bool = (v: unknown): boolean => v === true || v === 'true';
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const objects = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);

export type CallResult<T> = { state: 'ok'; data: T } | { state: 'not_set_up' } | { state: 'no_access' } | { state: 'failed'; message: string };

async function rpc<T>(db: FoundingAdminClient, fn: string, args: Record<string, unknown>, map: (raw: unknown) => T): Promise<CallResult<T>> {
  try {
    const { data, error } = await db.rpc(fn, args);
    if (error) {
      if (isMissingFounding(error)) return { state: 'not_set_up' };
      if (error.code === '42501') return { state: 'no_access' };
      return { state: 'failed', message: error.message ?? 'Could not load this.' };
    }
    return { state: 'ok', data: map(data) };
  } catch (e) {
    return { state: 'failed', message: e instanceof Error ? e.message : 'Could not load this.' };
  }
}

// ---- words ----------------------------------------------------------------------------------------------------------------------------------------------------------------
export const STAGE_LABELS: Record<string, string> = {
  joined: 'On the list', lapsed: 'Lapsed', released: 'Released', messaged: 'Message sent', account: 'Account made', signup_finished: 'Sign-up finished',
  documents_started: 'Documents started', documents_complete: 'Documents complete', declined: 'Declined', approved: 'Approved', first_request: 'First request seen',
  first_lesson_booked: 'First lesson accepted', first_lesson_done: 'First lesson done', second_lesson: 'Second lesson done',
};
export const STAGE_ORDER = ['joined', 'lapsed', 'released', 'messaged', 'account', 'signup_finished', 'documents_started', 'documents_complete', 'declined', 'approved', 'first_request', 'first_lesson_booked', 'first_lesson_done', 'second_lesson'];
export const DECLINE_LABELS: Record<string, string> = { clearance: 'Police clearance', document_missing: 'A document missing', other: 'Other' };
export const FIELD_LABELS: Record<string, string> = {
  full_name: 'Full name', code_name: 'Name for the link', whatsapp: 'WhatsApp number', email: 'Email', is_adult: '18 or older', subjects: 'Subjects and grades', availability: 'When they could teach',
  unavailable_weeks: 'Weeks unavailable', practicum: 'Teaching practice', police_clearance: 'Police clearance', parent_reach: 'Parents they could tell', parent_reach_willing: 'Would they tell them',
  prior_tutoring: 'Tutored before', heard_from: 'How they heard', have: 'Laptop, connection, bank', consent_contact: 'Consent box 1', consent_marketing: 'Consent box 2', '(not recorded)': 'No field recorded',
};
export const RULE_HELP = 'Marketing\'s measurement document, section 5.2 (the five conditions) and 5.5 (the stop rules).';

// ---- R5: the steps -------------------------------------------------------------------------------------------------------------------------------------------
export interface StepRow {
  id: string; source: string; status: string; wave: number | null; src: string | null; isTest: boolean; fullName: string; codeName: string; stage: string;
  joinedAt: string | null; releasedAt: string | null; releasedMessagedAt: string | null; lapsedAt: string | null; lastContactedAt: string | null;
  accountAt: string | null; agreedAt: string | null; signupFinishedAt: string | null; firstDocumentAt: string | null; documentsCompleteAt: string | null;
  isVerified: boolean; approvedAt: string | null; isDeclined: boolean; declinedAt: string | null; declineReason: string | null;
  hoursSavedAt: string | null; hasHours: boolean; firstRequestSeenAt: string | null; firstAcceptedAt: string | null; firstCompletedAt: string | null; secondCompletedAt: string | null;
}
export function mapStep(raw: Record<string, unknown>): StepRow {
  return {
    id: text(raw.id), source: text(raw.source), status: text(raw.status), wave: nullableNum(raw.wave), src: nullableText(raw.src), isTest: bool(raw.is_test),
    fullName: text(raw.full_name), codeName: text(raw.code_name), stage: text(raw.stage) || 'joined',
    joinedAt: nullableText(raw.joined_at), releasedAt: nullableText(raw.released_at), releasedMessagedAt: nullableText(raw.released_messaged_at), lapsedAt: nullableText(raw.lapsed_at),
    lastContactedAt: nullableText(raw.last_contacted_at), accountAt: nullableText(raw.account_at), agreedAt: nullableText(raw.agreed_at), signupFinishedAt: nullableText(raw.signup_finished_at),
    firstDocumentAt: nullableText(raw.first_document_at), documentsCompleteAt: nullableText(raw.documents_complete_at), isVerified: bool(raw.is_verified), approvedAt: nullableText(raw.approved_at),
    isDeclined: bool(raw.is_declined), declinedAt: nullableText(raw.declined_at), declineReason: nullableText(raw.decline_reason), hoursSavedAt: nullableText(raw.hours_saved_at),
    hasHours: bool(raw.has_hours), firstRequestSeenAt: nullableText(raw.first_request_seen_at), firstAcceptedAt: nullableText(raw.first_accepted_at),
    firstCompletedAt: nullableText(raw.first_completed_at), secondCompletedAt: nullableText(raw.second_completed_at),
  };
}
export const mapSteps = (raw: unknown): StepRow[] => objects(raw).map(mapStep);

export interface StepFilter { wave: string; stage: string; search: string }
export const NO_STEP_FILTER: StepFilter = { wave: 'all', stage: 'all', search: '' };
export function filterSteps(rows: StepRow[], f: StepFilter): StepRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.wave === 'none' ? r.wave !== null : f.wave !== 'all' && String(r.wave) !== f.wave) return false;
    if (f.stage !== 'all' && r.stage !== f.stage) return false;
    if (q && !(r.fullName.toLowerCase().includes(q) || r.codeName.toLowerCase().includes(q))) return false;
    return true;
  });
}
export const waveOptions = (rows: StepRow[]): number[] => Array.from(new Set(rows.map((r) => r.wave).filter((w): w is number => w !== null))).sort((a, b) => a - b);

// ---- R6: the funnel by wave ---------------------------------------------------------------------------------------------------------------------------------
export interface WaveStepStat { key: string; label: string; n: number; pct: number; avgDays: number | null; medianDays: number | null; oldestDays: number | null }
export interface WaveBlock { wave: number; released: number; messaged: number; lapsed: number; declined: number; steps: WaveStepStat[] }
export function mapWaves(raw: unknown): WaveBlock[] {
  return objects(raw).map((w) => ({
    wave: num(w.wave), released: num(w.released), messaged: num(w.messaged), lapsed: num(w.lapsed), declined: num(w.declined),
    steps: objects(w.steps).map((s) => ({ key: text(s.key), label: text(s.label), n: num(s.n), pct: num(s.pct), avgDays: nullableNum(s.avg_days), medianDays: nullableNum(s.median_days), oldestDays: nullableNum(s.oldest_days) })),
  }));
}
export const waveName = (wave: number): string => (wave === 0 ? 'All waves together' : wave === 1 ? 'Wave 1 (the warm tutors)' : `Wave ${wave}`);
// R14: one row per wave per step, counts and days only (no names, emails or numbers).
export const WAVES_CSV_HEADER = 'wave,released,messaged,lapsed,declined,step,reached,percent_of_released,average_days,median_days,oldest_waiting_days';
export function wavesCsv(waves: WaveBlock[]): string {
  const rows = waves.flatMap((w) => w.steps.map((s) => [w.wave === 0 ? 'all' : String(w.wave), w.released, w.messaged, w.lapsed, w.declined, s.key, s.n, s.pct, s.avgDays ?? '', s.medianDays ?? '', s.oldestDays ?? ''].join(',')));
  return [WAVES_CSV_HEADER, ...rows].join('\r\n') + '\r\n';
}

// ---- R9: the trigger panel -----------------------------------------------------------------------------------------------------------------------------------
export type LightState = 'met' | 'not_met' | 'unknown' | 'default';
const asLight = (v: unknown): LightState => (v === 'met' || v === 'not_met' || v === 'default' ? v : 'unknown');
export interface DemandRow { subject: string; phase: string; requests: number; unserved: number; readyTutors: number; shortfall: number; peopleWaiting: number }
export interface StopRule { rule: number; kind: 'auto' | 'manual'; open: boolean; note: string | null; since: string | null; label: string }
export interface Triggers {
  currentWave: number | null;
  b1: { state: LightState; demandRows: number; rows: DemandRow[] };
  b2: { state: LightState; approved: number; working: number; sharePct: number | null; linePct: number };
  b3: { state: LightState; waiting: number; oldestDays: number | null; notUploaded: number };
  b4: { state: LightState; rate: number; measured: boolean; waves: number[] };
  b5: { state: LightState; open: number };
  allClear: boolean;
  stopRules: StopRule[];
}
const mapDemand = (r: Record<string, unknown>): DemandRow => ({
  subject: text(r.subject), phase: text(r.phase), requests: num(r.requests), unserved: num(r.unserved_requests ?? r.unserved), readyTutors: num(r.ready_tutors), shortfall: num(r.shortfall), peopleWaiting: num(r.people_waiting),
});
export function mapTriggers(raw: unknown): Triggers {
  const t = obj(raw);
  const b1 = obj(t.b1); const b2 = obj(t.b2); const b3 = obj(t.b3); const b4 = obj(t.b4); const b5 = obj(t.b5);
  return {
    currentWave: nullableNum(t.current_wave),
    b1: { state: asLight(b1.state), demandRows: num(b1.demand_rows), rows: objects(b1.rows).map(mapDemand) },
    b2: { state: asLight(b2.state), approved: num(b2.approved), working: num(b2.working), sharePct: nullableNum(b2.share_pct), linePct: num(b2.line_pct) || 60 },
    b3: { state: asLight(b3.state), waiting: num(b3.waiting), oldestDays: nullableNum(b3.oldest_days), notUploaded: num(b3.not_uploaded) },
    b4: { state: asLight(b4.state), rate: num(b4.rate), measured: bool(b4.measured), waves: Array.isArray(b4.waves) ? b4.waves.map(num) : [] },
    b5: { state: asLight(b5.state), open: num(b5.open) },
    allClear: bool(t.all_clear),
    stopRules: objects(t.stop_rules).map((r) => ({ rule: num(r.rule), kind: r.kind === 'auto' ? 'auto' : 'manual', open: bool(r.open), note: nullableText(r.note), since: nullableText(r.since), label: text(r.label) })),
  };
}

// ---- R10: the verification pipeline -----------------------------------------------------------------------------------------------------------------------
export interface PipelineWeek { weekStart: string; completed: number; approved: number; declined: number; avgDays: number | null; longestDays: number | null; declines: Record<string, number> }
export interface Pipeline {
  waiting: number; oldestDays: number | null; over5: number; over7: number; avgDaysToApproval: number | null; longestDecidedDays: number | null;
  declinesByReason: Record<string, number>; byWeek: PipelineWeek[];
}
const counts = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries(obj(v)).map(([k, n]) => [k, num(n)]));
export function mapPipeline(raw: unknown): Pipeline {
  const p = obj(raw);
  return {
    waiting: num(p.waiting), oldestDays: nullableNum(p.oldest_days), over5: num(p.over_5_days), over7: num(p.over_7_days), avgDaysToApproval: nullableNum(p.avg_days_to_approval),
    longestDecidedDays: nullableNum(p.longest_decided_days), declinesByReason: counts(p.declines_by_reason),
    byWeek: objects(p.by_week).map((w) => ({ weekStart: text(w.week_start), completed: num(w.completed), approved: num(w.approved), declined: num(w.declined), avgDays: nullableNum(w.avg_days), longestDays: nullableNum(w.longest_days), declines: counts(w.declines_by_reason) })),
  };
}

// ---- R8: the suggested release list -----------------------------------------------------------------------------------------------------------------------
export interface SuggestedPerson { id: string; fullName: string; codeName: string; joinedAt: string | null; skipped: boolean; lapsed: boolean; coversN: number; covers: { subject: string; phase: string }[]; suggested: boolean }
export interface Suggestion { cap: number; rate: number; rateMeasured: boolean; rateWaves: number[]; gap: number; suggestedN: number; nextWave: number; demand: DemandRow[]; people: SuggestedPerson[] }
export function mapSuggestion(raw: unknown): Suggestion {
  const s = obj(raw);
  return {
    cap: num(s.cap) || 15, rate: num(s.rate), rateMeasured: bool(s.rate_measured), rateWaves: Array.isArray(s.rate_waves) ? s.rate_waves.map(num) : [], gap: num(s.gap), suggestedN: num(s.suggested_n),
    nextWave: num(s.next_wave) || 2, demand: objects(s.demand).map(mapDemand),
    people: objects(s.people).map((p) => ({
      id: text(p.id), fullName: text(p.full_name), codeName: text(p.code_name), joinedAt: nullableText(p.joined_at), skipped: bool(p.skipped), lapsed: bool(p.lapsed), coversN: num(p.covers_n),
      covers: objects(p.covers).map((c) => ({ subject: text(c.subject), phase: text(c.phase) })), suggested: bool(p.suggested),
    })),
  };
}

// ---- R11: the form-answer summaries ---------------------------------------------------------------------------------------------------------------------
export interface Answers {
  total: number; police: Record<string, number>; practicum: Record<string, number>; parentReach: Record<string, number>; willing: { yes: number; no: number };
  availability: Record<string, number>; bands: Record<string, number>; topSubjects: { subject: string; n: number }[];
  heard: Record<string, { n: number; withRegisteredTag: number }>; consentNews: { yes: number; no: number }; have: Record<string, number>; byWeek: { weekStart: string; joins: number }[];
}
export function mapAnswers(raw: unknown): Answers {
  const a = obj(raw);
  const yn = (v: unknown) => ({ yes: num(obj(v).yes), no: num(obj(v).no) });
  return {
    total: num(a.total), police: counts(a.police), practicum: counts(a.practicum), parentReach: counts(a.parent_reach), willing: yn(a.willing), availability: counts(a.availability), bands: counts(a.bands),
    topSubjects: objects(a.top_subjects).map((s) => ({ subject: text(s.subject), n: num(s.n) })),
    heard: Object.fromEntries(Object.entries(obj(a.heard)).map(([k, v]) => [k, { n: num(obj(v).n), withRegisteredTag: num(obj(v).with_registered_tag) }])),
    consentNews: yn(a.consent_news), have: counts(a.have), byWeek: objects(a.by_week).map((w) => ({ weekStart: text(w.week_start), joins: num(w.joins) })),
  };
}

// ---- R4: abandons by last field ---------------------------------------------------------------------------------------------------------------------------
export interface Abandons { started: number; joined: number; abandoned: number; byField: { field: string; n: number }[]; bySrc: { src: string; field: string; n: number }[] }
export function mapAbandons(raw: unknown): Abandons {
  const a = obj(raw);
  return {
    started: num(a.started), joined: num(a.joined), abandoned: num(a.abandoned),
    byField: objects(a.by_field).map((f) => ({ field: text(f.field), n: num(f.n) })), bySrc: objects(a.by_src).map((f) => ({ src: text(f.src), field: text(f.field), n: num(f.n) })),
  };
}

// ---- reads and writes -----------------------------------------------------------------------------------------------------------------------------------------------
export interface WavesData { steps: StepRow[]; waves: WaveBlock[]; triggers: Triggers | null; pipeline: Pipeline | null; suggestion: Suggestion | null }
export type WavesResult = { state: 'ok'; data: WavesData } | { state: 'not_set_up' } | { state: 'no_access' } | { state: 'failed'; message: string };

export async function fetchWaves(db: FoundingAdminClient): Promise<WavesResult> {
  const [steps, waves, triggers, pipeline, suggestion] = await Promise.all([
    rpc(db, 'admin_founding_steps', {}, mapSteps),
    rpc(db, 'admin_founding_waves', {}, mapWaves),
    rpc(db, 'admin_founding_triggers', {}, mapTriggers),
    rpc(db, 'admin_founding_pipeline', {}, mapPipeline),
    rpc(db, 'admin_founding_suggestion', {}, mapSuggestion),
  ]);
  for (const r of [steps, waves]) {
    if (r.state === 'not_set_up') return { state: 'not_set_up' };
    if (r.state === 'no_access') return { state: 'no_access' };
    if (r.state === 'failed') return { state: 'failed', message: r.message };
  }
  if (steps.state !== 'ok' || waves.state !== 'ok') return { state: 'failed', message: 'Could not load the waves.' };
  return {
    state: 'ok',
    data: {
      steps: steps.data, waves: waves.data,
      triggers: triggers.state === 'ok' ? triggers.data : null, pipeline: pipeline.state === 'ok' ? pipeline.data : null, suggestion: suggestion.state === 'ok' ? suggestion.data : null,
    },
  };
}

export interface AnswerRange { from: string | null; to: string | null; src: string }
export const ALL_TIME: AnswerRange = { from: null, to: null, src: '' };
const rangeArgs = (r: AnswerRange): Record<string, unknown> => ({ p_from: r.from, p_to: r.to, p_src: r.src.trim() === '' ? null : r.src.trim() });
export const fetchAnswers = (db: FoundingAdminClient, r: AnswerRange): Promise<CallResult<Answers>> => rpc(db, 'admin_founding_answers', rangeArgs(r), mapAnswers);
export const fetchAbandons = (db: FoundingAdminClient, r: AnswerRange): Promise<CallResult<Abandons>> => rpc(db, 'admin_founding_abandons', rangeArgs(r), mapAbandons);
export const sayState = (r: { state: string; message?: string }): string =>
  r.state === 'not_set_up' ? FOUNDING_NOT_ON_YET : r.state === 'no_access' ? FOUNDING_NO_ACCESS : r.state === 'failed' ? (r.message ?? 'Could not load this.') : '';

async function write(db: FoundingAdminClient, fn: string, args: Record<string, unknown>): Promise<string | null> {
  try {
    const { error } = await db.rpc(fn, args);
    if (!error) return null;
    if (isMissingFounding(error)) return FOUNDING_NOT_ON_YET;
    return error.message ?? 'Could not save that change.';
  } catch (e) {
    return e instanceof Error ? e.message : 'Could not save that change.';
  }
}
export const setSuggestSkip = (db: FoundingAdminClient, id: string, skip: boolean) => write(db, 'admin_set_founding_suggest_skip', { p_id: id, p_skip: skip });
export const setWaveCap = (db: FoundingAdminClient, cap: number) => write(db, 'admin_set_founding_wave_cap', { p_cap: cap });
export const setStopRule = (db: FoundingAdminClient, rule: number, open: boolean, note: string) => write(db, 'admin_set_founding_stop_rule', { p_rule: rule, p_open: open, p_note: note.trim() === '' ? null : note.trim() });
export const setWave = (db: FoundingAdminClient, ids: string[], wave: number) => write(db, 'admin_set_founding_wave', { p_ids: ids, p_wave: wave });
export const markContacted = (db: FoundingAdminClient, id: string) => write(db, 'admin_mark_founding_contacted', { p_id: id });

// ---- small formatting helpers (South African time) --------------------------------------------------------------------------------------------------
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Johannesburg' });
}
export const days = (n: number | null | undefined): string => (n === null || n === undefined ? '–' : `${n} day${n === 1 ? '' : 's'}`);
export const pct = (n: number): string => `${Math.round(n)}%`;
// "This week" starts on Monday (South African time); returns ISO days for a range chip.
export function lastNDays(n: number, now: Date = new Date()): { from: string; to: string } {
  const f = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(d);
  return { from: f(new Date(now.getTime() - (n - 1) * 86_400_000)), to: f(now) };
}
