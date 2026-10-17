// Master 7cx. The tutor's second and third sign-up pages: "what kind of tutor are you?" (beginner or experienced)
// and then the documents Tutorlage asks for. This file holds the rules and the wording; the screens only show them.
// It has no browser or Supabase code so scripts/dev/tutor-onboarding-test.ts can run it directly.
// THE ADMIN APP USES A VERBATIM COPY (admin/src/lib/tutorOnboarding.ts), so the reviewer's checklist can never
// disagree with what the tutor was asked for. Edit THIS file, then copy it over the admin one; the test fails if they differ.
//
// The CEO's rules (13 Oct 2026):
//   Beginner tutor:     photo of ID or passport; proof of results (such as a report card); police clearance
//                       issued in the last 6 months.
//   Experienced tutor / teacher: photo of ID or passport; police clearance issued in the last 6 months; proof of
//                       experience (a link, a photo or a document); a SACE certificate is OPTIONAL.
// The ID or passport copy is kept linked to the tutor's profile so that, if a crime is reported to have been
// committed through Tutorlage, the police can be given the profile and ID details with the evidence.
//
// The CEO's addition (17 Oct 2026): every document that proves qualification or experience is asked for here too (all of
// them optional, because only some tutors have them), and the same documents can be added at any time afterwards from the
// Teaching tab (VerificationDocumentsPanel), for example experience on another tutoring platform that was forgotten at
// sign-up. What the review team sees decides the level a tutor starts at (admin app: a credential, or a level assigned).
//
// The wording below is a DRAFT for legal's review (Drake/legal/drafts/tutor-documents-page-copy-DRAFT.md): it
// has to agree with the privacy policy's section 7 and 8 before this is switched on (FEATURES.tutorOnboarding).

export type TutorTrack = 'beginner' | 'experienced';

// The values of the database's doc_type enum that this flow uses.
export type OnboardingDocumentType =
  | 'identity_doc'
  | 'subject_results'
  | 'police_clearance'
  | 'proof_of_experience'
  | 'sace_certificate'
  | 'teaching_qualification'
  | 'practicum_letter'
  | 'marking_appointment_letter';

export type RequirementKey = 'identity' | 'results' | 'police' | 'experience' | 'sace' | 'qualification' | 'practicum' | 'marking';

export interface Requirement {
  key: RequirementKey;
  documentType: OnboardingDocumentType;
  title: string;
  help: string;
  required: boolean;
  // 'file': a photo, scan or PDF. 'file-or-link': the same, or a web link (proof of experience).
  accepts: 'file' | 'file-or-link';
  // The police certificate must say when it was issued.
  needsIssueDate: boolean;
}

export const POLICE_MAX_AGE_MONTHS = 6;
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // the 'tutor-documents' bucket's own limit
export const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export const TRACK_COPY: Record<TutorTrack, { title: string; blurb: string; needs: string }> = {
  beginner: {
    title: 'Beginner tutor',
    blurb: "I'm a student or recent graduate, or I haven't tutored or taught before. I'll show my results.",
    needs:
      'ID or passport, proof of your results, and a police clearance certificate. A teaching qualification or practicum letter is optional, ' +
      'but it can start you at a higher level.',
  },
  experienced: {
    title: 'Experienced tutor or teacher',
    blurb: "I've tutored or taught before, at a school, a university, a tutoring company or privately.",
    needs:
      'ID or passport, a police clearance certificate, and proof of your experience. A teaching qualification, a SACE certificate and an ' +
      'exam marking letter are optional, but they can start you at a higher level.',
  },
};

const IDENTITY: Requirement = {
  key: 'identity',
  documentType: 'identity_doc',
  title: 'ID or passport',
  help: 'A clear photo or scan of your South African ID (both sides, if it is a card) or the photo page of your passport. Every detail must be readable.',
  required: true,
  accepts: 'file',
  needsIssueDate: false,
};

const POLICE: Requirement = {
  key: 'police',
  documentType: 'police_clearance',
  title: 'Police clearance certificate',
  help:
    'The Police Clearance Certificate from the South African Police Service. It must have been issued in the last 6 months. ' +
    'You can apply at any police station, where they take your fingerprints. It can take a few weeks, so apply early.',
  required: true,
  accepts: 'file',
  needsIssueDate: true,
};

const RESULTS: Requirement = {
  key: 'results',
  documentType: 'subject_results',
  title: 'Proof of your results',
  help: 'A report card, matric certificate or university results that show the subjects you want to teach. A photo or PDF is fine.',
  required: true,
  accepts: 'file',
  needsIssueDate: false,
};

const EXPERIENCE: Requirement = {
  key: 'experience',
  documentType: 'proof_of_experience',
  title: 'Proof of your experience',
  help:
    'Show us you have taught or tutored before. Add a web link (for example a school, company or tutoring profile page, including ' +
    'your profile on another tutoring platform), or a photo or document such as a reference letter, an employment letter or a ' +
    'screenshot of your hours and ratings elsewhere. A letter that says how many years you have taught helps us place you at the ' +
    'right level. You can add more than one.',
  required: true,
  accepts: 'file-or-link',
  needsIssueDate: false,
};

const SACE: Requirement = {
  key: 'sace',
  documentType: 'sace_certificate',
  title: 'SACE certificate (optional)',
  help: 'If you are registered with the South African Council for Educators (SACE), add your SACE certificate. You do not have to.',
  required: false,
  accepts: 'file',
  needsIssueDate: false,
};

const QUALIFICATION: Requirement = {
  key: 'qualification',
  documentType: 'teaching_qualification',
  title: 'Teaching qualification (optional)',
  help:
    'A teaching degree (for example a B.Ed), a PGCE or a Higher Certificate in Education: a photo or scan of the certificate or of your ' +
    'official academic record. Qualified teachers start at a higher level.',
  required: false,
  accepts: 'file',
  needsIssueDate: false,
};

const PRACTICUM: Requirement = {
  key: 'practicum',
  documentType: 'practicum_letter',
  title: 'Teaching practicum letter (optional)',
  help: 'If you are a student teacher who has completed your classroom practicum, add the letter from your university or school that confirms it.',
  required: false,
  accepts: 'file',
  needsIssueDate: false,
};

const MARKING: Requirement = {
  key: 'marking',
  documentType: 'marking_appointment_letter',
  title: 'Exam marking or moderation letter (optional)',
  help: 'If you mark or moderate NSC, IEB or Cambridge exam papers, add your appointment letter.',
  required: false,
  accepts: 'file',
  needsIssueDate: false,
};

export function requirementsFor(track: TutorTrack): Requirement[] {
  return track === 'beginner'
    ? [IDENTITY, RESULTS, POLICE, QUALIFICATION, PRACTICUM]
    : [IDENTITY, POLICE, EXPERIENCE, QUALIFICATION, SACE, MARKING];
}

export function isTutorTrack(value: unknown): value is TutorTrack {
  return value === 'beginner' || value === 'experienced';
}

// ---- the 6-month police clearance rule --------------------------------------------------------------------

function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

function toIso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Calendar-month arithmetic that keeps the day where it exists and otherwise uses the month's last day
// (31 August + 6 months = 28 February, not 3 March).
export function addMonthsIso(iso: string, months: number): string | null {
  const p = parseIsoDate(iso);
  if (!p) return null;
  const index = p.y * 12 + (p.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return toIso(y, m, Math.min(p.d, lastDay));
}

// Today as yyyy-mm-dd in South African time (UTC+2, no daylight saving), so the rule does not flip at the wrong
// hour for someone signing in around midnight.
export function todayIsoSAST(now = new Date()): string {
  const sast = new Date(now.getTime() + 2 * 3600_000);
  return toIso(sast.getUTCFullYear(), sast.getUTCMonth() + 1, sast.getUTCDate());
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// 2026-04-13 -> "13 April 2026" (for sentences shown to people).
export function formatIsoLong(iso: string): string {
  const p = parseIsoDate(iso);
  return p ? `${p.d} ${MONTH_NAMES[p.m - 1]} ${p.y}` : iso;
}

// null when the certificate's issue date is acceptable; otherwise the sentence to show the tutor.
export function policeCertificateProblem(issuedOn: string, today = todayIsoSAST()): string | null {
  if (!issuedOn) return 'Enter the date your police clearance certificate was issued.';
  if (!parseIsoDate(issuedOn)) return 'Enter the issue date as a real date.';
  if (issuedOn > today) return 'The issue date cannot be in the future.';
  const oldestAllowed = addMonthsIso(today, -POLICE_MAX_AGE_MONTHS)!;
  if (issuedOn < oldestAllowed) {
    return `This certificate is more than ${POLICE_MAX_AGE_MONTHS} months old. Please upload one issued on or after ${formatIsoLong(oldestAllowed)}.`;
  }
  return null;
}

// The last day a certificate issued on this date counts (issue date plus 6 months).
export function policeExpiresOn(issuedOn: string): string | null {
  return addMonthsIso(issuedOn, POLICE_MAX_AGE_MONTHS);
}

// ---- checking what the tutor gives us ---------------------------------------------------------------------

// null when the file can be uploaded as it is. (Photos are shrunk and converted in the browser first; see imageShrink.ts.)
export function fileProblem(file: { type: string; size: number }): string | null {
  if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) return 'Upload a PDF, JPG or PNG file.';
  if (file.size > MAX_FILE_BYTES) return 'That file is over 5 MB. Try a smaller scan or photo.';
  if (file.size === 0) return 'That file is empty. Choose it again.';
  return null;
}

// What the tutor typed for a link: "www.school.co.za/staff" becomes "https://www.school.co.za/staff".
export function normaliseLink(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// null when the link is acceptable. Only https links to a real-looking address; never other schemes (a link is
// opened in the review team's browser, so "javascript:" and the like must never get in).
export function linkProblem(text: string): string | null {
  const value = normaliseLink(text);
  if (!value) return 'Paste the link first.';
  if (value.length > 500) return 'That link is too long.';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'That does not look like a web link.';
  }
  if (url.protocol !== 'https:') return 'The link must start with https://';
  if (url.username || url.password) return 'The link cannot contain a name or password.';
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || /^[0-9.]+$/.test(host) || host.endsWith('.local')) {
    return 'That does not look like a public web address.';
  }
  return null;
}

// ---- what is still missing --------------------------------------------------------------------------------

export interface UploadedDocumentSummary {
  documentType: string;
  issuedOn: string | null;
  // The review team's verdict ('pending', 'under_review', 'verified' or 'rejected'). A rejected document never counts.
  status?: string | null;
}

export interface RequirementStatus {
  requirement: Requirement;
  done: boolean;
  // Set when something was uploaded but it does not count (an expired police certificate, a document that was not accepted).
  problem: string | null;
}

export const REJECTED_PROBLEM = 'The document you added was not accepted. Please add a new one.';

export function requirementStatuses(track: TutorTrack, docs: UploadedDocumentSummary[], today = todayIsoSAST()): RequirementStatus[] {
  return requirementsFor(track).map((requirement) => {
    const ofType = docs.filter((d) => d.documentType === requirement.documentType);
    const mine = ofType.filter((d) => d.status !== 'rejected');
    // Something was added but every copy was turned down.
    const onlyRejected = ofType.length > 0 && mine.length === 0;
    if (requirement.needsIssueDate) {
      const counting = mine.filter((d) => d.issuedOn && policeCertificateProblem(d.issuedOn, today) === null);
      if (counting.length > 0) return { requirement, done: true, problem: null };
      if (mine.length > 0) {
        const newest = mine.map((d) => d.issuedOn ?? '').sort().pop() ?? '';
        return { requirement, done: false, problem: policeCertificateProblem(newest, today) };
      }
      return { requirement, done: false, problem: onlyRejected ? REJECTED_PROBLEM : null };
    }
    if (mine.length > 0) return { requirement, done: true, problem: null };
    return { requirement, done: false, problem: onlyRejected ? REJECTED_PROBLEM : null };
  });
}

export function missingRequirements(track: TutorTrack, docs: UploadedDocumentSummary[], today = todayIsoSAST()): Requirement[] {
  return requirementStatuses(track, docs, today)
    .filter((s) => s.requirement.required && !s.done)
    .map((s) => s.requirement);
}

export function isOnboardingComplete(track: TutorTrack, docs: UploadedDocumentSummary[], consented: boolean, today = todayIsoSAST()): boolean {
  return consented && missingRequirements(track, docs, today).length === 0;
}

// ---- the explanation and the consent (DRAFT for legal) ----------------------------------------------------

export const ONBOARDING_COPY = {
  trackTitle: 'What kind of tutor are you?',
  trackIntro: 'This tells us which documents to ask for. Pick the one that fits you best.',
  documentsTitle: 'Your documents',
  whyIdTitle: 'Why we ask for your ID or passport',
  whyId:
    'Parents and learners trust Tutorlage because every tutor is a real person we can identify. We keep a copy of your ID or passport ' +
    'linked to your tutor profile. If a crime is reported to have been committed through Tutorlage and we have reason to believe it, ' +
    'we may give the police your tutor profile and ID details together with the evidence. Only you and the Tutorlage team that checks ' +
    'documents can see your documents.',
  levelNote:
    'What you show us here also decides the level you start at, and so the hourly price you can charge. A teaching qualification, years ' +
    'of teaching and your record on other tutoring platforms can start you above the first level. If you forget something, you can add it ' +
    'at any time under Teaching in your account.',
  consent:
    'I agree that Tutorlage may keep these documents, including my police clearance certificate, and use them to check who I am, to ' +
    'decide whether I can tutor and what level I start at, and, if a crime is reported to have been committed through Tutorlage, to give ' +
    'the police my tutor profile and ID details together with the evidence.',
  consentNeeded: 'Tick the box to agree before you upload your documents.',
  notApprovedYet: 'You cannot be approved or accept requests until every required document is uploaded.',
  submitted: 'Thank you. We will check your documents and let you know when you are approved.',
} as const;

// The version recorded with the tutor's consent: change it whenever ONBOARDING_COPY.consent or whyId changes.
export const ONBOARDING_CONSENT_VERSION = '2026-10-17';
