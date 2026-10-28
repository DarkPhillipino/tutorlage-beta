import { notSwitchedOn } from './subjectApprovals';
import { DocumentClient, isWebLink, openStoredDocument } from './documentAccess';
import { HoldClient, describeDocument, formatWhen } from './safetyHold';

// The hand-over bundle (migration 20261021130000; rules: Drake/legal/handover-and-closing-rules-2026-10-21.md, part A).
// When a tutor is reported for dangerous or illegal activity, the police, a court or the Information Regulator may be given what Tutorlage
// holds about them. The bundle is built in the admin's own browser from their own rights (no service key anywhere), in this order:
//   1. record_hand_over() writes the hand-over record FIRST and says what the bundle is to contain (the database refuses a bundle that does
//      not match the kind of authority, and places a safety hold if there is none);
//   2. each document file is opened through openStoredDocument() with action 'downloaded', so every file is a line in the access log;
//   3. the access log lines and the hold lines are read LAST, so the bundle shows its own downloads;
//   4. a cover report (HTML), a manifest (JSON) and each file are saved one by one, each file with its SHA-256.
// No zip: a zip needs a library or an archive writer of our own; the report names every file and its hash instead.

export const HAND_OVER_NOT_ACTIVE = 'Hand-over bundles are not active on this database yet.';

export type HandOverAuthority = 's54_report' | 'warrant' | 'court_order' | 'regulator_notice' | 'request_with_consent';
export type HandOverPart = 'profile' | 'identity' | 'other_documents' | 'access_log' | 'hold_events';
// always: the kind of authority includes it. never: it may not be included. named / relevant: the admin ticks it only if the paper names it
// (a warrant, an order, a Regulator notice) or the report depends on it (our own s 54 report).
export type PartRule = 'always' | 'never' | 'named' | 'relevant';

export const PARTS: { value: HandOverPart; label: string }[] = [
  { value: 'profile', label: "The tutor's profile (name, contact, tutor id, dates)" },
  { value: 'identity', label: 'ID or passport copy' },
  { value: 'other_documents', label: 'Police clearance and the other verification documents' },
  { value: 'access_log', label: 'Document access log lines for this tutor' },
  { value: 'hold_events', label: 'Safety-hold events (when placed or released, and why)' },
];
const ALL_NAMED: Record<HandOverPart, PartRule> = { profile: 'named', identity: 'named', other_documents: 'named', access_log: 'named', hold_events: 'named' };

// Legal A2, one row per kind of authority. The database holds the same rules and refuses a bundle that breaks them.
export const AUTHORITIES: { value: HandOverAuthority; label: string; rules: Record<HandOverPart, PartRule> }[] = [
  { value: 's54_report', label: "Tutorlage's own report of a suspected sexual offence against a child (s 54 of Act 32 of 2007)",
    rules: { profile: 'always', identity: 'always', other_documents: 'relevant', access_log: 'relevant', hold_events: 'always' } },
  { value: 'warrant', label: 'Search warrant', rules: ALL_NAMED },
  { value: 'court_order', label: 'Subpoena or court order for documents or information', rules: ALL_NAMED },
  { value: 'regulator_notice', label: 'Information Regulator notice',
    rules: { profile: 'named', identity: 'named', other_documents: 'named', access_log: 'always', hold_events: 'named' } },
  { value: 'request_with_consent', label: "Written request from the police or a prosecutor, with the tutor's consent",
    rules: { profile: 'always', identity: 'always', other_documents: 'never', access_log: 'never', hold_events: 'always' } },
];
const authorityOf = (value: string) => AUTHORITIES.find((a) => a.value === value);

export interface HandOverForm {
  authority: HandOverAuthority | '';
  reference: string;
  requesterName: string;
  requesterRole: string;
  requesterOrganisation: string;
  requesterPhone: string;
  requesterEmail: string;
  verifiedHow: string;
  reason: string;
  approvedBy: string;
  tutorTold: string;
  // Only parts whose rule is 'named' or 'relevant' read this.
  ticks: Partial<Record<HandOverPart, boolean>>;
}
export const emptyHandOverForm = (): HandOverForm => ({
  authority: '', reference: '', requesterName: '', requesterRole: '', requesterOrganisation: '', requesterPhone: '', requesterEmail: '',
  verifiedHow: '', reason: '', approvedBy: '', tutorTold: '', ticks: {},
});

// Standard answers for "was the tutor told?" (legal A4: by default not at the time, so as not to warn them or put a child at risk).
export const TUTOR_TOLD_CHOICES = [
  'Not told at this time: telling the tutor could warn them, put a child at risk or destroy evidence.',
  'Not told: the authority has asked us not to disclose.',
  'Told, with the knowledge and agreement of the authority.',
  'Told: the matter is closed.',
];

export function resolveScope(authority: HandOverAuthority | '', ticks: HandOverForm['ticks']): HandOverPart[] {
  const rules = authorityOf(authority)?.rules;
  if (!rules) return [];
  return PARTS.map((p) => p.value).filter((p) => rules[p] === 'always' || ((rules[p] === 'named' || rules[p] === 'relevant') && ticks[p] === true));
}

const MIN_CHARS = 3;
const filled = (v: string) => v.trim().length >= MIN_CHARS;
// What is still missing, in plain words. The bundle button stays off until this is empty (legal A3: refused until every field is filled).
export function formProblems(form: HandOverForm): string[] {
  const out: string[] = [];
  if (!authorityOf(form.authority)) out.push('Say what kind of authority this is');
  const need: [string, string][] = [
    ['requester name', form.requesterName], ['requester role or rank', form.requesterRole],
    ['requester organisation (station or court)', form.requesterOrganisation], ['requester phone', form.requesterPhone],
    ['reference', form.reference], ['how the requester was verified', form.verifiedHow], ['reason', form.reason],
    ['who approved it', form.approvedBy], ['whether the tutor was told, or why not', form.tutorTold],
  ];
  for (const [label, value] of need) if (!filled(value)) out.push(`Fill in: ${label}`);
  if (!/^[^@\s]+@[^@\s]+$/.test(form.requesterEmail.trim())) out.push('Fill in: requester email');
  if (authorityOf(form.authority) && resolveScope(form.authority, form.ticks).length === 0) out.push('Pick what the paper names');
  return out;
}

export interface HandOverTutor { id: string; name: string; email: string; phone: string | null; createdAt: string | null }

export type HandOverClient = HoldClient & DocumentClient;

// What leaves the browser. Saved one by one; `save` is the browser's download in the app and a recorder in the tests.
export interface HandOverDeps {
  fetchFile(url: string): Promise<{ bytes: Uint8Array; contentType: string }>;
  sha256(bytes: Uint8Array): Promise<string>;
  save(name: string, data: Uint8Array | string, mime: string): void;
  now(): Date;
}

export interface ManifestDocument {
  id: string;
  type: string;
  status: string;
  uploadedAt: string;
  reviewedAt: string;
  issuedOn: string;
  isLink: boolean;
  link: string;
  savedAs: string;
  sha256: string;
  size: number;
  problem: string;
  logged: boolean;
}
export interface ManifestLogLine { createdAt: string; adminLabel: string; what: string; action: string }
export interface ManifestHoldLine { createdAt: string; event: string; adminLabel: string; reason: string }
export interface Manifest {
  handOverId: string;
  preparedAt: string;
  preparedBy: string;
  tutor: HandOverTutor;
  authority: { value: string; label: string };
  reference: string;
  requester: { name: string; role: string; organisation: string; phone: string; email: string };
  verifiedHow: string;
  reason: string;
  approvedBy: string;
  tutorTold: string;
  included: { part: HandOverPart; label: string }[];
  notIncluded: { part: HandOverPart; label: string; why: string }[];
  holdPlacedByThisHandOver: boolean;
  documents: ManifestDocument[];
  accessLog: ManifestLogLine[] | null;
  holdEvents: ManifestHoldLine[] | null;
  notes: string[];
  complete: boolean;
}

export interface HandOverResult {
  handOverId: string;
  holdPlaced: boolean;
  savedFiles: string[];
  problems: string[];
  complete: boolean;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const idEight = (id: string) => id.replace(/[^0-9a-f]/gi, '').slice(0, 8).toLowerCase() || 'record';
const extensionOf = (path: string) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(path);
  return m ? m[1].toLowerCase() : 'bin';
};
const safeWord = (v: string) => v.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'document';

async function readAll(client: HandOverClient, table: string, columns: string, column: string, value: string, order: string, notes: string[], label: string) {
  const res = await client.from(table).select(columns).eq(column, value).order(order, { ascending: true }).limit(5000);
  if (res.error) {
    notes.push(notSwitchedOn(res.error) ? `${label} is not active on this database, so none is included.` : `${label} could not be read (${res.error.message ?? 'unknown error'}), so it is NOT in this bundle.`);
    return null;
  }
  return (res.data ?? []) as Record<string, unknown>[];
}

export async function prepareHandOver(client: HandOverClient, deps: HandOverDeps, tutor: HandOverTutor, form: HandOverForm): Promise<HandOverResult> {
  const problems = formProblems(form);
  if (problems.length > 0) throw new Error(problems[0]);
  const authority = authorityOf(form.authority);
  if (!authority) throw new Error('Say what kind of authority this is');
  const scope = resolveScope(form.authority, form.ticks);

  // 1. The record first. If this fails, nothing is built and nothing is opened.
  const recorded = await client.rpc('record_hand_over', {
    p_subject: tutor.id, p_authority: form.authority, p_reference: form.reference.trim(),
    p_requester_name: form.requesterName.trim(), p_requester_role: form.requesterRole.trim(),
    p_requester_organisation: form.requesterOrganisation.trim(), p_requester_phone: form.requesterPhone.trim(),
    p_requester_email: form.requesterEmail.trim(), p_verified_how: form.verifiedHow.trim(), p_reason: form.reason.trim(),
    p_approved_by: form.approvedBy.trim(), p_tutor_told: form.tutorTold.trim(), p_scope: scope,
  });
  if (recorded.error) {
    throw new Error(notSwitchedOn(recorded.error) ? HAND_OVER_NOT_ACTIVE : (recorded.error.message ?? 'The hand-over could not be recorded.'));
  }
  const rec = (recorded.data ?? {}) as Record<string, unknown>;
  const handOverId = str(rec.id);
  if (!handOverId) throw new Error('The hand-over could not be recorded.');
  const prefix = `handover-${idEight(handOverId)}`;
  const notes: string[] = [];
  const saved: string[] = [];

  // 2. Each file, one at a time. A file that cannot be opened is listed with the reason; the rest are still built.
  const docs: ManifestDocument[] = [];
  let n = 0;
  for (const raw of (Array.isArray(rec.documents) ? rec.documents : []) as Record<string, unknown>[]) {
    n += 1;
    const path = str(raw.path);
    const doc: ManifestDocument = {
      id: str(raw.id), type: str(raw.type), status: str(raw.status), uploadedAt: str(raw.uploaded_at), reviewedAt: str(raw.reviewed_at),
      issuedOn: str(raw.issued_on), isLink: isWebLink(path), link: '', savedAs: '', sha256: '', size: 0, problem: '', logged: false,
    };
    try {
      const opened = await openStoredDocument(client, 'tutor-documents', path, { action: 'downloaded', subject: tutor.id });
      doc.logged = opened.logged;
      if (!opened.logged) notes.push(`The opening of document ${n} was NOT recorded in the document access log (it is not active on this database).`);
      if (doc.isLink) {
        doc.link = path;
      } else {
        const file = await deps.fetchFile(opened.url);
        doc.sha256 = await deps.sha256(file.bytes);
        doc.size = file.bytes.length;
        doc.savedAs = `${prefix}-document-${String(n).padStart(2, '0')}-${safeWord(doc.type)}.${extensionOf(path)}`;
        deps.save(doc.savedAs, file.bytes, file.contentType || 'application/octet-stream');
        saved.push(doc.savedAs);
      }
    } catch (e) {
      doc.problem = e instanceof Error ? e.message : 'The file could not be saved.';
      doc.savedAs = '';
      notes.push(`Document ${n} (${doc.type || 'unknown type'}) is NOT in this bundle: ${doc.problem}`);
    }
    docs.push(doc);
  }

  // 3. The log and the hold lines, read last so the downloads above are in them.
  let accessLog: ManifestLogLine[] | null = null;
  if (scope.includes('access_log')) {
    const rows = await readAll(client, 'document_access_log', 'id, created_at, admin_label, bucket, document_path, document_type, action', 'subject_id', tutor.id, 'created_at', notes, 'The document access log');
    if (rows) accessLog = rows.map((r) => ({ createdAt: str(r.created_at), adminLabel: str(r.admin_label), what: describeDocument({ documentType: typeof r.document_type === 'string' ? r.document_type : null, documentPath: str(r.document_path) }), action: str(r.action) }));
  }
  let holdEvents: ManifestHoldLine[] | null = null;
  if (scope.includes('hold_events')) {
    const rows = await readAll(client, 'safety_hold_events', 'seq, event, reason, admin_label, created_at', 'profile_id', tutor.id, 'seq', notes, 'The safety hold record');
    if (rows) holdEvents = rows.map((r) => ({ createdAt: str(r.created_at), event: str(r.event), adminLabel: str(r.admin_label), reason: str(r.reason) }));
  }

  const rules = authority.rules;
  const manifest: Manifest = {
    handOverId, preparedAt: str(rec.created_at) || deps.now().toISOString(), preparedBy: str(rec.prepared_by),
    tutor: scope.includes('profile') ? tutor : { id: tutor.id, name: '', email: '', phone: null, createdAt: null },
    authority: { value: authority.value, label: authority.label }, reference: form.reference.trim(),
    requester: { name: form.requesterName.trim(), role: form.requesterRole.trim(), organisation: form.requesterOrganisation.trim(), phone: form.requesterPhone.trim(), email: form.requesterEmail.trim() },
    verifiedHow: form.verifiedHow.trim(), reason: form.reason.trim(), approvedBy: form.approvedBy.trim(), tutorTold: form.tutorTold.trim(),
    included: PARTS.filter((p) => scope.includes(p.value)).map((p) => ({ part: p.value, label: p.label })),
    notIncluded: PARTS.filter((p) => !scope.includes(p.value)).map((p) => ({ part: p.value, label: p.label,
      why: rules[p.value] === 'never' ? 'This kind of authority may not include it.' : 'The paper does not name it, or it was not chosen.' })),
    holdPlacedByThisHandOver: rec.hold_placed_by_this_hand_over === true,
    documents: docs, accessLog, holdEvents, notes, complete: notes.length === 0,
  };

  // 4. The cover report and the manifest, saved last.
  deps.save(`${prefix}-report.html`, renderReportHtml(manifest), 'text/html;charset=utf-8');
  deps.save(`${prefix}-manifest.json`, JSON.stringify(manifest, null, 2), 'application/json');
  saved.push(`${prefix}-report.html`, `${prefix}-manifest.json`);
  return { handOverId, holdPlaced: manifest.holdPlacedByThisHandOver, savedFiles: saved, problems: notes, complete: manifest.complete };
}

export async function recordDelivery(client: Pick<HandOverClient, 'rpc'>, handOverId: string, method: string, address: string): Promise<void> {
  if (method.trim().length < MIN_CHARS) throw new Error('Fill in: how it was delivered');
  if (address.trim().length < MIN_CHARS) throw new Error('Fill in: the address it was delivered to');
  const { error } = await client.rpc('record_hand_over_delivery', { p_hand_over: handOverId, p_method: method.trim(), p_address: address.trim() });
  if (error) throw new Error(notSwitchedOn(error) ? HAND_OVER_NOT_ACTIVE : (error.message ?? 'The delivery could not be recorded.'));
}

export interface PastHandOver { id: string; event: string; handOverId: string; createdAt: string; adminLabel: string; authority: string; reference: string; deliveredTo: string }
export type PastHandOvers = { state: 'ok'; rows: PastHandOver[] } | { state: 'not_active' };
export async function fetchPastHandOvers(client: Pick<HandOverClient, 'from'>, tutorId: string): Promise<PastHandOvers> {
  const res = await client.from('hand_over_events')
    .select('id, event, hand_over_id, created_at, admin_label, authority, reference, delivery_method, delivery_address')
    .eq('subject_id', tutorId).order('created_at', { ascending: false }).limit(50);
  if (res.error) {
    if (notSwitchedOn(res.error)) return { state: 'not_active' };
    throw new Error(res.error.message ?? 'Could not load earlier hand-overs.');
  }
  return {
    state: 'ok',
    rows: ((res.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: str(r.id), event: str(r.event), handOverId: str(r.hand_over_id), createdAt: str(r.created_at), adminLabel: str(r.admin_label),
      authority: str(r.authority), reference: str(r.reference), deliveredTo: [str(r.delivery_method), str(r.delivery_address)].filter(Boolean).join(' · '),
    })),
  };
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const when = (iso: string) => (iso ? formatWhen(iso) : '');
const dateOnly = (iso: string) => (iso ? iso.slice(0, 10) : '');

// The cover report: one self-contained page (no scripts, no outside links) a person can read without Tutorlage's software.
export function renderReportHtml(m: Manifest): string {
  const row = (cells: string[]) => `<tr>${cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`;
  const head = (cells: string[]) => `<tr>${cells.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
  const dl = (pairs: [string, string][]) => `<dl>${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v) || '&nbsp;'}</dd>`).join('')}</dl>`;
  const profile = m.included.some((i) => i.part === 'profile');
  const parts: string[] = [];
  parts.push(`<h1>Tutorlage hand-over bundle</h1><p class="meta">Record number ${esc(m.handOverId)}. Prepared ${esc(when(m.preparedAt))} (South African time) by ${esc(m.preparedBy) || 'an admin'}.</p>`);
  if (!m.complete) parts.push(`<div class="warn"><strong>This bundle is not complete.</strong><ul>${m.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`);
  parts.push('<h2>For whom</h2>' + dl(profile
    ? [['Tutor', m.tutor.name], ['Email', m.tutor.email], ['Phone', m.tutor.phone ?? ''], ['Tutor id', m.tutor.id], ['Account created', dateOnly(m.tutor.createdAt ?? '')]]
    : [['Tutor id', m.tutor.id], ['Profile details', 'Not included in this bundle.']]));
  parts.push('<h2>Who asked, and on what authority</h2>' + dl([
    ['Kind of authority', m.authority.label], ['Reference', m.reference], ['Requester', m.requester.name], ['Role or rank', m.requester.role],
    ['Organisation (station or court)', m.requester.organisation], ['Phone', m.requester.phone], ['Email', m.requester.email],
    ['How the requester was verified', m.verifiedHow], ['Reason (written by the safeguarding lead)', m.reason], ['Approved by', m.approvedBy],
    ['Was the tutor told, or why not', m.tutorTold],
  ]));
  parts.push('<h2>What is in this bundle</h2><ul>' + m.included.map((i) => `<li>${esc(i.label)}</li>`).join('') + '</ul>');
  if (m.notIncluded.length > 0) parts.push('<h2>What is not in this bundle</h2><ul>' + m.notIncluded.map((i) => `<li>${esc(i.label)}: ${esc(i.why)}</li>`).join('') + '</ul>');
  parts.push('<p class="meta">Never in any bundle: other learners or tutors, card or bank details, passwords, opinions about guilt. Facts and dates only.</p>');
  if (m.holdPlacedByThisHandOver) parts.push('<p class="meta">A safety hold was placed on this tutor when this bundle was prepared, so their data is kept.</p>');

  const showDocs = m.documents.length > 0 || m.included.some((i) => i.part === 'identity' || i.part === 'other_documents');
  if (showDocs) {
    parts.push('<h2>Documents</h2>');
    parts.push(m.documents.length === 0 ? '<p>There is no document of the chosen kinds on file.</p>'
      : '<table>' + head(['#', 'Type', 'Status', 'Uploaded', 'Reviewed', 'Issued', 'File saved as', 'SHA-256 of the file', 'Note']) +
        m.documents.map((d, i) => row([String(i + 1), d.type.replace(/_/g, ' '), d.status, dateOnly(d.uploadedAt), dateOnly(d.reviewedAt), d.issuedOn,
          d.isLink ? `Web link: ${d.link}` : d.savedAs || 'Not saved', d.sha256, d.problem || (d.isLink ? 'A web address, no file' : ''),
        ])).join('') + '</table>');
  }
  if (m.accessLog) {
    parts.push('<h2>Who opened this tutor&#39;s documents</h2>');
    parts.push(m.accessLog.length === 0 ? '<p>No line.</p>' : '<table>' + head(['When', 'Who', 'Document', 'What']) +
      m.accessLog.map((l) => row([when(l.createdAt), l.adminLabel, l.what, l.action])).join('') + '</table>');
  }
  if (m.holdEvents) {
    parts.push('<h2>Safety holds</h2>');
    parts.push(m.holdEvents.length === 0 ? '<p>No line.</p>' : '<table>' + head(['When', 'What', 'By', 'Written reason']) +
      m.holdEvents.map((l) => row([when(l.createdAt), l.event === 'released' ? 'Released' : 'Placed', l.adminLabel, l.reason])).join('') + '</table>');
  }
  parts.push('<p class="meta">The document files are saved next to this report, named above. Check each against its SHA-256 to confirm it arrived unchanged. Every file in this bundle was opened through Tutorlage\'s document access log.</p>');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Hand-over ${esc(m.reference)}</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#0f172a}h1{font-size:22px}h2{font-size:15px;margin-top:24px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}dl{display:grid;grid-template-columns:240px 1fr;gap:4px 12px}dt{color:#64748b}dd{margin:0;word-break:break-word}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #e2e8f0;padding:4px 6px;text-align:left;vertical-align:top;word-break:break-word}th{background:#f1f5f9}.meta{color:#64748b;font-size:12px}.warn{border:1px solid #fecaca;background:#fef2f2;padding:8px 12px;border-radius:8px}</style></head><body>${parts.join('')}</body></html>`;
}
