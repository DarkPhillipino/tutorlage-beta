// THE FOUNDING TUTORS LIST (CEO's order of 10 Nov 2026; plan Drake/project-manager/tutor-waitlist-page-action-plan-2026-11-10.md sections 8, 9 and 11; the words
// are Drake/marketing-gtm/founding-tutors-drafts-2026-11-10.md sections 2 to 6; database: supabase/migrations/20261110200000_founding_tutors_list.sql).
// This file holds the words, the checks, the counters' client side and the Teach gate's reading, and takes the database client as an argument so a test can hand
// in a fake (scripts/dev/founding-list-test.ts). The page itself is src/pages/FoundingTutors.tsx (route /teach, not indexed, not linked from anywhere public).
//
// Everything that reads the database here is TOLERANT: a database without the migration answers "the list is not open yet" on the page and "no gate" in the app,
// never a broken screen. The database checks every field again; these checks only save a person a round trip.
//
// RULES FOR THE WORDS (CEO, 10 Nov 2026): never name or describe the school, campus or faculty, or where tutors come from; the phrase "free sessions" is retired
// (the test reads every word below for both). The top rate is "R590" (CEO, 10 Nov night: 4B, the highest level families can book today; 4C and 4D stay held back,
// so R1,044 is NOT used; if they are ever opened the figure changes then). The personal-link line is held until the code system is live: SHOW_PERSONAL_LINK_LINE.

export const FOUNDING_CONSENT_VERSION = '2026-11-10';
export const FOUNDING_MAX_SUBJECTS = 12;
export const FOUNDING_VISITOR_KEY = 'tutorlage.founding.visitor';
// The database also refuses a form that was open for less than this (a bot that posts straight to it); a person cannot fill 14 fields in 4 seconds.
export const FOUNDING_MIN_FILL_MS = 4000;
// Held until the code system is live (the drafts, section 2): flip to true then.
export const SHOW_PERSONAL_LINK_LINE = false;

// 'code_open' is the family page's counter for a ?code= link (src/lib/foundingCount.ts; the Codes page reads it): the code, lower-cased, travels in src.
export type FoundingEvent = 'open' | 'see_more' | 'form_start' | 'code_open';
export const FOUNDING_FIRST_TAG_KEY = 'tutorlage.founding.firsttag';
export const FOUNDING_SKIP_KEY = 'tutorlage.founding.skip';

// ---- the words --------------------------------------------------------------------------------------------------------------------------------------
export const FOUNDING_COPY = {
  pageTitle: 'Founding tutors list',
  intro: 'Paid, freelance tutoring on your own hours. Join the list and we will message you when your place opens.',
  join: 'Join the list',
  seeMore: 'See more',
  seeLess: 'See less',
  more: {
    whatTitle: 'What this is.',
    what: 'Tutorlage connects learners with tutors, online. You choose your subjects and your hours. A family sends a request, you accept it, and you teach in our video room. Freelance: your time, your hours.',
    earnTitle: 'What you can earn.',
    earn:
      'Rates start from R35 an hour and go up to R590 an hour at our highest level. The rate you earn depends on your level. Levels are earned through your qualifications and experience, the hours you teach on Tutorlage, and your ratings from learners. Most people begin near the start of the range and move up as they teach. Like any advert, the range shows what the platform pays across levels; where you land depends on you. Payment for a lesson is held until the lesson is complete and then released to you.',
    howTitle: 'How the list works.',
    how: 'We bring tutors in groups, in the subjects where families are asking. When your place opens we message you on WhatsApp. We cannot say when; we will not guess a date.',
    openTitle: 'When your place opens.',
    open: 'You create your account, upload your documents, and a person checks them. This can take up to a week. When you are verified you can accept requests.',
    docsTitle: 'Start preparing your documents now.',
    docsIntro: 'We will ask for these when your place opens, not before:',
    docs: ['your ID or passport', 'a police clearance certificate issued in the last 6 months', 'your school results or proof of your teaching experience', 'a bank account in your own name'],
    docsWarning: 'Never send documents on WhatsApp. You upload them in the app.',
    linkTitle: 'Your own link (once you are verified).',
    link: 'Verified tutors get a personal link to share with families they know.',
    whoTitle: 'Who can join.',
    who: 'You must be 18 or older.',
  },
  formTitle: 'Join the list',
  formIntro: 'About 2 minutes. Fields marked * are needed.',
  labels: {
    fullName: 'Full name *',
    codeName: 'The name you want on your personal link (first name or nickname) *',
    whatsapp: 'WhatsApp number (+27) *',
    whatsappHint: 'For example 082 123 4567',
    email: 'The email you will use to sign up *',
    isAdult: 'I am 18 or older *',
    subjects: 'Subjects you would teach, and the grades *',
    subjectsHint: 'Pick from the list. Add a row for each subject.',
    subject: 'Subject',
    fromGrade: 'From grade',
    toGrade: 'To grade',
    chooseSubject: 'Choose a subject',
    addSubject: 'Add another subject',
    removeSubject: 'Remove',
    availability: 'When you could teach',
    unavailableWeeks: 'Weeks you are unavailable (for example, away on placement)',
    practicum: 'School-based teaching practice you have passed *',
    police: 'Police clearance *',
    reach: 'Roughly how many parents of school-age children could you tell about Tutorlage? *',
    reachWilling: 'Would you tell them? *',
    prior: 'Have you tutored before? Where, and roughly how many hours (do not name clients)',
    heard: 'How did you hear about this?',
    haveTitle: 'I have:',
  },
  availabilityOptions: [
    { value: 'evenings', label: 'Evenings' },
    { value: 'weekends', label: 'Weekends' },
    { value: 'holidays', label: 'School holidays and December' },
  ],
  practicumOptions: [
    { value: 'none', label: 'None yet' },
    { value: 'one', label: 'One block passed' },
    { value: 'two', label: 'Two blocks passed' },
    { value: 'three_plus', label: 'Three or more blocks passed' },
  ],
  policeOptions: [
    { value: 'have', label: 'I have one issued in the last 6 months' },
    { value: 'applied', label: 'I have applied' },
    { value: 'not_yet', label: 'Not yet' },
  ],
  reachOptions: [
    { value: 'none', label: 'None' },
    { value: 'up_to_10', label: 'Up to 10' },
    { value: '10_to_30', label: '10 to 30' },
    { value: 'over_30', label: 'More than 30' },
  ],
  yesNo: [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ],
  // The visible words never name where tutors come from: the drafts' "a lecturer or class group" became a plain "a message or group chat".
  heardOptions: [
    { value: 'message', label: 'A message or group chat' },
    { value: 'friend', label: 'A friend' },
    { value: 'other', label: 'Other' },
  ],
  have: {
    device: 'A laptop or phone with a camera',
    connection: 'A connection I can rely on',
    bank: 'A bank account in my own name',
  },
  consentContact:
    'Required: I agree that Tutorlage may use the details I give here to contact me about my place on the list and to ask me for my documents when my place opens.',
  consentMarketing:
    'Optional: I also agree that Tutorlage may send me news, offers and invitations about Tutorlage by WhatsApp and email, including about sharing my link with families.',
  noticeTitle: 'How we use your details.',
  noticeBody:
    'We use what you enter here to run the list: to decide when your place opens, to contact you, and to ask for your documents when it does. If you tick the second box we may also send you news and offers. We keep your details for 30 days after your place opens, or 6 months after you join if it has not opened, unless you become a tutor, in which case our Privacy Policy applies. To count visitors, this page keeps a random number in your browser; it holds no personal details. You can ask us to stop messaging you or to delete your details at any time: reply STOP to any message, or write to {email}. Joining the list does not guarantee a place. When you create an account you accept our Terms and Privacy Policy as everyone does.',
  privacyLink: 'Privacy Policy',
  submit: 'Join the list',
  sending: 'Joining…',
  doneTitle: 'You are on the list.',
  done: 'You are on the list. We will message you on WhatsApp when your place opens. Start getting your documents ready.',
  notOpen: 'The list is not open yet. Please try again later.',
  failed: 'We could not send your details. Check your connection and try again. What you typed is still here.',
  fixErrors: 'Please fix the items marked in red above.',
  // The Teach button while the gate is on (drafts, section 6).
  gateNotListed: 'Tutoring places open in groups. Join the founding tutors list and we will message you when your place opens.',
  gateWaiting: 'Your place has not opened yet. We will message you on WhatsApp when it does. Until then this page is not available. You can get your documents ready now.',
  gateRoom: 'You can open video rooms once you are verified.',
  gateLoading: 'Loading…',
} as const;

// ---- the form's shape and checks --------------------------------------------------------------------------------------------------------------------
export interface SubjectPick {
  subject: string;
  minGrade: string;
  maxGrade: string;
}

export interface FoundingForm {
  fullName: string;
  codeName: string;
  whatsapp: string;
  email: string;
  isAdult: boolean;
  subjects: SubjectPick[];
  availability: string[];
  unavailableWeeks: string;
  practicum: string;
  policeClearance: string;
  parentReach: string;
  parentReachWilling: '' | 'yes' | 'no';
  priorTutoring: string;
  heardFrom: string;
  hasDevice: boolean;
  hasConnection: boolean;
  hasBank: boolean;
  consentContact: boolean;
  consentMarketing: boolean;
}

export const EMPTY_FOUNDING_FORM: FoundingForm = {
  fullName: '', codeName: '', whatsapp: '', email: '', isAdult: false, subjects: [{ subject: '', minGrade: '', maxGrade: '' }], availability: [], unavailableWeeks: '',
  practicum: '', policeClearance: '', parentReach: '', parentReachWilling: '', priorTutoring: '', heardFrom: '', hasDevice: false, hasConnection: false, hasBank: false,
  consentContact: false, consentMarketing: false,
};

// A South African mobile number as +27XXXXXXXXX, or null: the same rule as the database's tidy_za_mobile (06x, 07x, 08x only: it is a WhatsApp number).
export function tidyZaMobile(raw: string): string | null {
  let d = (raw ?? '').replace(/[^0-9]/g, '');
  if (d.startsWith('0027')) d = d.slice(2);
  if (d.startsWith('270') && d.length === 12) d = `27${d.slice(3)}`;
  if (d.startsWith('0') && d.length === 10) d = `27${d.slice(1)}`;
  if (d.length === 9 && /^[6-8]/.test(d)) d = `27${d}`;
  return /^27[6-8][0-9]{8}$/.test(d) ? `+${d}` : null;
}

export const isPlausibleEmail = (v: string): boolean => v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const hasMarkup = (v: string): boolean => /[<>\u0000-\u001f]/.test(v);

// "?src=f1" in an address's query string: lower case, 1 to 32 of a-z 0-9 _ -, else nothing.
export function cleanSrc(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(t) ? t : null;
}
export function srcFromSearch(search: string): string | null {
  try {
    return cleanSrc(new URLSearchParams(search).get('src'));
  } catch {
    return null;
  }
}

export type FormErrors = Partial<Record<'fullName' | 'codeName' | 'whatsapp' | 'email' | 'isAdult' | 'subjects' | 'practicum' | 'policeClearance' | 'parentReach' | 'parentReachWilling' | 'priorTutoring' | 'consentContact', string>>;

export interface FoundingLists {
  subjects: string[];
  grades: string[];
}

// Plain-words checks before anything is sent. `lists` are the app's own subject and grade lists (the same ones the database checks against).
export function validateFoundingForm(form: FoundingForm, lists: FoundingLists): FormErrors {
  const e: FormErrors = {};
  const name = form.fullName.trim();
  if (name.length < 2 || name.length > 100 || hasMarkup(name)) e.fullName = 'Please enter your full name.';
  const code = form.codeName.trim();
  if (code.length < 1 || code.length > 30 || hasMarkup(code)) e.codeName = 'Please enter the name you want on your personal link.';
  if (!tidyZaMobile(form.whatsapp)) e.whatsapp = 'Please enter a South African WhatsApp number, for example 082 123 4567.';
  if (!isPlausibleEmail(form.email.trim())) e.email = 'Please enter the email you will use to sign up.';
  if (!form.isAdult) e.isAdult = 'You must be 18 or older to join the list.';
  const order = (g: string) => lists.grades.findIndex((x) => x.toLowerCase() === g.toLowerCase());
  const picks = form.subjects.filter((s) => s.subject || s.minGrade || s.maxGrade);
  if (picks.length === 0) e.subjects = 'Please pick at least one subject and its grades.';
  else if (picks.length > FOUNDING_MAX_SUBJECTS) e.subjects = `Please pick up to ${FOUNDING_MAX_SUBJECTS} subjects.`;
  else if (
    picks.some(
      (s) =>
        !lists.subjects.some((x) => x.toLowerCase() === s.subject.toLowerCase()) || order(s.minGrade) < 0 || order(s.maxGrade) < 0 || order(s.minGrade) > order(s.maxGrade),
    )
  ) {
    e.subjects = 'Please pick each subject and its grades from the lists (the first grade cannot be higher than the second).';
  }
  if (!form.practicum) e.practicum = 'Please say how much school-based teaching practice you have passed.';
  if (!form.policeClearance) e.policeClearance = 'Please say where you are with your police clearance.';
  if (!form.parentReach) e.parentReach = 'Please choose one.';
  if (!form.parentReachWilling) e.parentReachWilling = 'Please say yes or no.';
  if (Array.from(form.priorTutoring.trim()).length > 300 || hasMarkup(form.priorTutoring)) e.priorTutoring = 'Please keep this to 300 characters, with no < or > signs.';
  if (!form.consentContact) e.consentContact = 'Please tick this box so that we can contact you about your place.';
  return e;
}

export interface JoinContext {
  elapsedMs: number;
  // The hidden "website" field: always empty for a person.
  website: string;
  src: string | null;
  visitor: string | null;
}

// What goes to join_founding_list: names exactly as the lists spell them are checked again by the database.
export function buildJoinPayload(form: FoundingForm, ctx: JoinContext): Record<string, unknown> {
  return {
    website: ctx.website,
    elapsed_ms: Math.max(0, Math.round(ctx.elapsedMs)),
    full_name: form.fullName.trim(),
    code_name: form.codeName.trim(),
    whatsapp: form.whatsapp.trim(),
    email: form.email.trim(),
    is_adult: form.isAdult,
    subjects: form.subjects
      .filter((s) => s.subject && s.minGrade && s.maxGrade)
      .map((s) => ({ subject: s.subject, min_grade: s.minGrade, max_grade: s.maxGrade })),
    availability: form.availability,
    unavailable_weeks: form.unavailableWeeks.trim(),
    practicum: form.practicum,
    police_clearance: form.policeClearance,
    parent_reach: form.parentReach,
    parent_reach_willing: form.parentReachWilling === 'yes',
    prior_tutoring: form.priorTutoring.trim(),
    heard_from: form.heardFrom,
    has_device: form.hasDevice,
    has_connection: form.hasConnection,
    has_bank: form.hasBank,
    consent_contact: form.consentContact,
    consent_marketing: form.consentMarketing,
    consent_version: FOUNDING_CONSENT_VERSION,
    src: ctx.src ?? '',
    visitor: ctx.visitor ?? '',
  };
}

// ---- the database calls (the client is an argument) ------------------------------------------------------------------------------------------------------
interface DbError { code?: string; message?: string }
interface DbResult { data: unknown; error: DbError | null }
export interface FoundingClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
}

export const isMissingFoundingFunction = (err: DbError | null | undefined): boolean => {
  if (!err) return false;
  if (err.code === 'PGRST202' || err.code === '42883' || err.code === 'PGRST205') return true;
  return /(join_founding_list|log_founding_event|my_founding_gate)/i.test(err.message ?? '') && /(does not exist|schema cache|could not find)/i.test(err.message ?? '');
};

// What a person is told for each way the database can answer. The database's own sentences about a field (code 22023) and about the hourly cap (54000)
// are plain words already and are shown as they are.
export function describeJoinError(err: DbError | null | undefined): string {
  if (isMissingFoundingFunction(err)) return FOUNDING_COPY.notOpen;
  const code = err?.code ?? '';
  const message = err?.message ?? '';
  if ((code === '22023' || code === '54000') && /^(Please|You must|Many people|Something went wrong)/.test(message)) return message;
  return FOUNDING_COPY.failed;
}

export type JoinResult = { ok: true } | { ok: false; message: string };

// Never throws.
export async function joinFoundingList(db: FoundingClient, payload: Record<string, unknown>): Promise<JoinResult> {
  try {
    const { data, error } = await db.rpc('join_founding_list', { p: payload });
    if (error) return { ok: false, message: describeJoinError(error) };
    if (!data || (data as { ok?: boolean }).ok !== true) return { ok: false, message: FOUNDING_COPY.failed };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describeJoinError(err as DbError) };
  }
}

// One count of the page. `src` is the tag the link carried, `first` the visitor's FIRST tag ever (the admin files See more, form starts and joins under it).
// Fire and forget: a failure is never shown and never retried.
export async function logFoundingEvent(db: FoundingClient, visitor: string | null, event: FoundingEvent, src: string | null, first: string | null = null): Promise<void> {
  if (!visitor) return;
  try {
    await db.rpc('log_founding_event', { p_visitor: visitor, p_event: event, p_src: src, p_first: first });
  } catch {
    // Counting must never disturb the page.
  }
}

// The family page's counter for a ?code= link (the Codes page counts it): one event, the code (lower case) in src.
export async function logCodeOpen(db: FoundingClient, visitor: string | null, code: string | null): Promise<void> {
  const c = cleanSrc(code);
  if (!c) return;
  await logFoundingEvent(db, visitor, 'code_open', c, null);
}

// The visitor's first tag ever (Marketing's rule: the first one seen stays; a later tag does not overwrite it). A first visit with no tag is remembered as "none",
// so a later tagged visit is still filed under "none". Returns null for "none".
export function getFirstTag(store: VisitorStore | null, linkTag: string | null): string | null {
  try {
    const kept = store?.getItem(FOUNDING_FIRST_TAG_KEY) ?? null;
    if (kept !== null) return kept === '-' ? null : cleanSrc(kept);
  } catch {
    return linkTag;
  }
  try {
    store?.setItem(FOUNDING_FIRST_TAG_KEY, linkTag ?? '-');
  } catch {
    // Not kept: this page load files under the tag it carried.
  }
  return linkTag;
}

// "Do not count this browser" (for the CEO and PM): open the page once with ?nocount=1; ?nocount=0 puts counting back. Kept in this browser only.
export function countingSwitchedOff(search: string, store: (VisitorStore & { removeItem?(key: string): void }) | null): boolean {
  try {
    const v = new URLSearchParams(search).get('nocount');
    if (v === '1') store?.setItem(FOUNDING_SKIP_KEY, '1');
    else if (v === '0') store?.removeItem?.(FOUNDING_SKIP_KEY);
    return (v === '1') || (v !== '0' && store?.getItem(FOUNDING_SKIP_KEY) === '1');
  } catch {
    return false;
  }
}

// Obvious robots and link-preview fetchers do not count (a preview never runs the page's script, so it never reaches here; this catches scripted browsers).
export function looksLikeBot(nav: { webdriver?: boolean; userAgent?: string } | null | undefined): boolean {
  if (!nav) return false;
  return nav.webdriver === true || /bot|crawl|spider|slurp|headless|preview|facebookexternalhit|whatsapp|lighthouse|pingdom/i.test(nav.userAgent ?? '');
}

// ---- the anonymous visitor id ------------------------------------------------------------------------------------------------------------------------
// A random id kept in the browser so that "unique visitors" can be counted. It holds no personal data and is not linked to anything else.
export interface VisitorStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// The stored id, or a new one (stored when the browser lets us; if storage is blocked the id lasts for this page load only).
export function getVisitorId(store: VisitorStore | null): string {
  try {
    const kept = store?.getItem(FOUNDING_VISITOR_KEY) ?? null;
    if (isUuid(kept)) return kept;
  } catch {
    // Storage blocked: fall through to a fresh id.
  }
  const fresh = randomId();
  try {
    store?.setItem(FOUNDING_VISITOR_KEY, fresh);
  } catch {
    // Not kept: counted as a new visitor next time. That is the honest limit of a blocked store.
  }
  return fresh;
}

// ---- the Teach gate (what the app asks) --------------------------------------------------------------------------------------------------------------
export type FoundingGateState = 'open' | 'not_listed' | 'waiting' | 'released' | 'verified';
export const FOUNDING_GATE_STATES: FoundingGateState[] = ['open', 'not_listed', 'waiting', 'released', 'verified'];

export interface FoundingGate {
  gateOn: boolean;
  state: FoundingGateState;
}
export const GATE_OPEN: FoundingGate = { gateOn: false, state: 'open' };

export function parseFoundingGate(data: unknown): FoundingGate {
  const d = (Array.isArray(data) ? data[0] : data) as { gate_on?: unknown; state?: unknown } | null;
  const state = d && typeof d.state === 'string' && (FOUNDING_GATE_STATES as string[]).includes(d.state) ? (d.state as FoundingGateState) : 'open';
  return { gateOn: !!d && d.gate_on === true, state };
}

// Any doubt (no migration yet, an error, no answer) is "open": the screens behave exactly as they did before the gate existed. The database enforces the
// gate itself, so a wrong "open" here can only ever show a screen, never let anything through.
export async function fetchMyFoundingGate(db: FoundingClient): Promise<FoundingGate> {
  try {
    const { data, error } = await db.rpc('my_founding_gate');
    if (error) return GATE_OPEN;
    return parseFoundingGate(data);
  } catch {
    return GATE_OPEN;
  }
}

// The two states that may not reach the tutor side, the onboarding pages or the document upload.
export const gateBlocksTutorSide = (state: FoundingGateState): boolean => state === 'not_listed' || state === 'waiting';

export function gateMessage(state: FoundingGateState): string | null {
  if (state === 'not_listed') return FOUNDING_COPY.gateNotListed;
  if (state === 'waiting') return FOUNDING_COPY.gateWaiting;
  return null;
}

// The consent notice with the contact address filled in.
export const noticeBody = (email: string): string => FOUNDING_COPY.noticeBody.replace('{email}', email);

// Every sentence a visitor can read on the page or in the gate messages, for the test that looks for banned words.
export function allFoundingWords(): string {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(FOUNDING_COPY);
  return out.join('\n');
}
