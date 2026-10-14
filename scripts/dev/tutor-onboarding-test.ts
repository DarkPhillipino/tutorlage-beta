// Master 7cx: the tutor's second and third sign-up pages (beginner or experienced; then the documents).
// Part A: the rules and wording in src/lib/tutorOnboarding.ts, on their own.
// Part B: src/lib/tutorOnboardingData.ts, driven through the real supabase-js against a pretend database and file
//         store on localhost (no keys, no network beyond localhost).
// Part C: source guards on the wiring and the safety rules (the switch is off by default, the admin copy of the rules
//         is identical, the admin still works before the migration, the migration's promises).
// Run: npx tsx scripts/dev/tutor-onboarding-test.ts   (exits 1 if any check fails)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  addLinkDocument,
  chooseTrack,
  fetchDocuments,
  fetchOnboarding,
  recordConsent,
  removeDocument,
  uploadDocument,
} from '../../src/lib/tutorOnboardingData';
import {
  ONBOARDING_CONSENT_VERSION,
  ACCEPTED_MIME_TYPES,
  MAX_FILE_BYTES,
  ONBOARDING_COPY,
  TRACK_COPY,
  addMonthsIso,
  fileProblem,
  formatIsoLong,
  isOnboardingComplete,
  isTutorTrack,
  linkProblem,
  missingRequirements,
  normaliseLink,
  policeCertificateProblem,
  policeExpiresOn,
  requirementStatuses,
  requirementsFor,
  todayIsoSAST,
} from '../../src/lib/tutorOnboarding';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
};

async function main() {
  // ---- Part A: what each kind of tutor must give ----------------------------------------------------------------
  const beginner = requirementsFor('beginner');
  const experienced = requirementsFor('experienced');
  check('beginner: ID, results, police clearance, in that order', beginner.map((r) => r.key).join() === 'identity,results,police');
  check('beginner: all three are required', beginner.every((r) => r.required));
  check('experienced: ID, police clearance, experience, SACE', experienced.map((r) => r.key).join() === 'identity,police,experience,sace');
  check('experienced: only the SACE certificate is optional', experienced.filter((r) => !r.required).map((r) => r.key).join() === 'sace');
  check('experienced: proof of experience accepts a link as well as a file', experienced.find((r) => r.key === 'experience')?.accepts === 'file-or-link');
  check('nothing else accepts a link', [...beginner, ...experienced].filter((r) => r.accepts === 'file-or-link').length === 1);
  check('only the police clearance asks for an issue date', [...beginner, ...experienced].filter((r) => r.needsIssueDate).every((r) => r.key === 'police'));
  check('both kinds are asked for ID and police clearance', ['identity', 'police'].every((k) => beginner.some((r) => r.key === k) && experienced.some((r) => r.key === k)));
  check('a beginner is not asked for experience, an experienced tutor is not asked for results', !beginner.some((r) => r.key === 'experience') && !experienced.some((r) => r.key === 'results'));
  check('the documents map to the database types', requirementsFor('beginner').map((r) => r.documentType).join() === 'identity_doc,subject_results,police_clearance' && experienced.map((r) => r.documentType).join() === 'identity_doc,police_clearance,proof_of_experience,sace_certificate');
  check('isTutorTrack accepts the two kinds only', isTutorTrack('beginner') && isTutorTrack('experienced') && !isTutorTrack('expert') && !isTutorTrack(null) && !isTutorTrack(undefined));

  // ---- the 6-month rule ------------------------------------------------------------------------------------------
  check('addMonths: 13 Oct minus 6 months is 13 Apr', addMonthsIso('2026-10-13', -6) === '2026-04-13');
  check('addMonths: 31 Aug plus 6 months is 28 Feb', addMonthsIso('2026-08-31', 6) === '2027-02-28');
  check('addMonths: 29 Aug plus 6 months in a leap year is 29 Feb', addMonthsIso('2027-08-29', 6) === '2028-02-29');
  check('addMonths: 31 Mar minus 1 month is 28 Feb', addMonthsIso('2026-03-31', -1) === '2026-02-28');
  check('addMonths: crosses a year boundary', addMonthsIso('2026-02-15', -6) === '2025-08-15');
  check('addMonths: a made-up date is refused', addMonthsIso('2026-02-30', 1) === null && addMonthsIso('nope', 1) === null);
  check('SAST today: 21:59 UTC is still the same day', todayIsoSAST(new Date('2026-10-13T21:59:00Z')) === '2026-10-13');
  check('SAST today: 22:00 UTC is already the next day in South Africa', todayIsoSAST(new Date('2026-10-13T22:00:00Z')) === '2026-10-14');

  const today = '2026-10-13';
  check('police: issued today is fine', policeCertificateProblem('2026-10-13', today) === null);
  check('police: exactly 6 months old is fine', policeCertificateProblem('2026-04-13', today) === null);
  const old = policeCertificateProblem('2026-04-12', today);
  check('police: one day over 6 months is refused, and says the earliest date in words', !!old && old.includes('13 April 2026') && /6 months/.test(old), old ?? '');
  check('formatIsoLong writes a date in words', formatIsoLong('2026-04-13') === '13 April 2026' && formatIsoLong('2027-01-05') === '5 January 2027' && formatIsoLong('nope') === 'nope');
  check('police: a future date is refused', /future/.test(policeCertificateProblem('2026-10-14', today) ?? ''));
  check('police: an empty date is refused', /Enter the date/.test(policeCertificateProblem('', today) ?? ''));
  check('police: a made-up date is refused', /real date/.test(policeCertificateProblem('2026-02-30', today) ?? ''));
  check('police: expires 6 months after issue', policeExpiresOn('2026-04-13') === '2026-10-13' && policeExpiresOn('2026-08-31') === '2027-02-28');

  // ---- files and links -------------------------------------------------------------------------------------------
  check('file: PDF, JPG and PNG are accepted', ACCEPTED_MIME_TYPES.every((t) => fileProblem({ type: t, size: 1000 }) === null));
  check('file: exactly 5 MB is accepted, one byte more is not', fileProblem({ type: 'image/png', size: MAX_FILE_BYTES }) === null && /5 MB/.test(fileProblem({ type: 'image/png', size: MAX_FILE_BYTES + 1 }) ?? ''));
  check('file: a Word document or an iPhone HEIC photo is refused with the accepted types named', /PDF, JPG or PNG/.test(fileProblem({ type: 'application/msword', size: 10 }) ?? '') && fileProblem({ type: 'image/heic', size: 10 }) !== null);
  check('file: an empty file is refused', /empty/.test(fileProblem({ type: 'application/pdf', size: 0 }) ?? ''));

  check('link: "www.school.co.za/staff" is completed to https', normaliseLink(' www.school.co.za/staff ') === 'https://www.school.co.za/staff');
  check('link: a normal https link is accepted', linkProblem('https://www.linkedin.com/in/someone') === null && linkProblem('school.co.za') === null);
  const unsafe: [string, string][] = [
    ['http://school.co.za', 'plain http'],
    ['javascript:alert(1)', 'javascript:'],
    ['data:text/html,<b>x</b>', 'data:'],
    ['ftp://school.co.za/file', 'ftp:'],
    ['file:///C:/secret.txt', 'file:'],
    ['https://user:pass@school.co.za', 'a name and password in the link'],
    ['https://localhost/admin', 'localhost'],
    ['https://192.168.0.1/x', 'an IP address'],
    ['https://intranet/page', 'a name with no dot'],
    ['https://printer.local/x', 'a .local name'],
    ['not a link at all', 'words'],
    ['', 'empty'],
    [`https://school.co.za/${'a'.repeat(500)}`, 'over 500 characters'],
  ];
  for (const [text, why] of unsafe) check(`link: ${why} is refused`, linkProblem(text) !== null);

  // ---- what is still missing -------------------------------------------------------------------------------------
  const fresh = '2026-09-01';
  const stale = '2026-01-01';
  const allBeginner = [
    { documentType: 'identity_doc', issuedOn: null },
    { documentType: 'subject_results', issuedOn: null },
    { documentType: 'police_clearance', issuedOn: fresh },
  ];
  check('beginner with all three (fresh police date) and consent is complete', isOnboardingComplete('beginner', allBeginner, true, today));
  check('beginner with all three but no consent is not complete', !isOnboardingComplete('beginner', allBeginner, false, today));
  check('beginner without the results is missing exactly those', missingRequirements('beginner', allBeginner.filter((d) => d.documentType !== 'subject_results'), today).map((r) => r.key).join() === 'results');
  check('a police certificate over 6 months old does not count', missingRequirements('beginner', [allBeginner[0], allBeginner[1], { documentType: 'police_clearance', issuedOn: stale }], today).map((r) => r.key).join() === 'police');
  const staleStatus = requirementStatuses('beginner', [{ documentType: 'police_clearance', issuedOn: stale }], today).find((s) => s.requirement.key === 'police');
  check('...and the tutor is told why', !!staleStatus && !staleStatus.done && /more than 6 months old/.test(staleStatus.problem ?? ''), staleStatus?.problem ?? '');
  check('a police certificate with no recorded date does not count', missingRequirements('beginner', [allBeginner[0], allBeginner[1], { documentType: 'police_clearance', issuedOn: null }], today).some((r) => r.key === 'police'));
  check('one fresh certificate counts even if an old one is also on file', missingRequirements('beginner', [...allBeginner, { documentType: 'police_clearance', issuedOn: stale }], today).length === 0);
  const allExperienced = [
    { documentType: 'identity_doc', issuedOn: null },
    { documentType: 'police_clearance', issuedOn: fresh },
    { documentType: 'proof_of_experience', issuedOn: null },
  ];
  check('experienced is complete without the optional SACE certificate', isOnboardingComplete('experienced', allExperienced, true, today));
  check('experienced without proof of experience is not complete', missingRequirements('experienced', allExperienced.filter((d) => d.documentType !== 'proof_of_experience'), today).map((r) => r.key).join() === 'experience');
  check('the optional SACE certificate never shows as missing', !missingRequirements('experienced', [], today).some((r) => r.key === 'sace'));
  check('a beginner\'s documents do not complete an experienced tutor', !isOnboardingComplete('experienced', allBeginner, true, today));
  check('with nothing uploaded everything required is missing (beginner 3, experienced 3)', missingRequirements('beginner', [], today).length === 3 && missingRequirements('experienced', [], today).length === 3);

  // ---- a document the review team turned down does not count -------------------------------------------------------------
  const rejectedId = allBeginner.map((d) => (d.documentType === 'identity_doc' ? { ...d, status: 'rejected' } : { ...d, status: 'pending' }));
  check('a rejected ID does not count: it is missing again', missingRequirements('beginner', rejectedId, today).map((r) => r.key).join() === 'identity' && !isOnboardingComplete('beginner', rejectedId, true, today));
  const rejectedStatus = requirementStatuses('beginner', rejectedId, today).find((s) => s.requirement.key === 'identity');
  check('...and the tutor is told it was not accepted', !!rejectedStatus && !rejectedStatus.done && /not accepted/.test(rejectedStatus.problem ?? ''));
  const rejectedPolice = allBeginner.map((d) => (d.documentType === 'police_clearance' ? { ...d, status: 'rejected' } : d));
  check('a rejected police certificate does not count even with a fresh date', missingRequirements('beginner', rejectedPolice, today).map((r) => r.key).join() === 'police');
  check('a new document added after a rejection counts', missingRequirements('beginner', [...rejectedId, { documentType: 'identity_doc', issuedOn: null, status: 'pending' }], today).length === 0);
  check('a verified document counts', missingRequirements('beginner', allBeginner.map((d) => ({ ...d, status: 'verified' })), today).length === 0);
  check('a document with no status recorded still counts (the app always has one; older callers may not)', missingRequirements('beginner', allBeginner, today).length === 0);

  // ---- the wording -----------------------------------------------------------------------------------------------
  check('the explanation says why the ID is kept and that the police may be given it', /ID or passport/.test(ONBOARDING_COPY.whyId) && /police/.test(ONBOARDING_COPY.whyId) && /evidence/.test(ONBOARDING_COPY.whyId));
  check('the consent names the police clearance and the police disclosure', /police clearance certificate/.test(ONBOARDING_COPY.consent) && /give the police/.test(ONBOARDING_COPY.consent));
  check('the explanation says who can see the documents', /Only you and/.test(ONBOARDING_COPY.whyId));
  check('the police help says "issued in the last 6 months" (never "no less than")', /issued in the last 6 months/.test(requirementsFor('beginner')[2].help) && ![...beginner, ...experienced, ...Object.values(TRACK_COPY).map((t) => ({ help: t.blurb }))].some((r) => /no less than/i.test(r.help)));
  check('the SACE certificate is labelled optional', experienced.find((r) => r.key === 'sace')?.title.includes('optional') === true);
  check('both kinds of tutor have a title, a description and a list of what they need', Object.values(TRACK_COPY).every((t) => t.title && t.blurb && t.needs));
  check('what each kind needs matches the requirements (names every required document)', /police/.test(TRACK_COPY.beginner.needs) && /results/.test(TRACK_COPY.beginner.needs) && /experience/.test(TRACK_COPY.experienced.needs) && /optional/.test(TRACK_COPY.experienced.needs));

  // ---- Part B: the data layer, real supabase-js against a pretend database and file store -----------------------------
  const log: { method: string; path: string; query: string; body: string; headers: Record<string, string | string[] | undefined> }[] = [];
  const onboardingRows = new Map<string, { track: string | null; grandfathered: boolean; consented_at: string | null; consent_version: string | null }>();
  type FakeDoc = { id: string; tutor_id: string; document_type: string; document_url: string; status: string; admin_notes: string | null; issued_on: string | null; uploaded_at: string };
  let docs: FakeDoc[] = [];
  const files = new Set<string>();
  let docCounter = 0;
  const T1 = 'tutor-one';
  const T_RLS = 'tutor-rls'; // inserts into the documents table are refused for this one (as the row-level rules would)
  const T_DOWN = 'tutor-down'; // the database answers 500 for this one

  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      log.push({ method: req.method ?? '', path: url.pathname, query: url.search, body: raw, headers: req.headers });
      const send = (status: number, json?: unknown) => {
        res.statusCode = status;
        if (json !== undefined) {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(json));
        } else res.end();
      };
      const wantsRows = /return=representation/.test(String(req.headers['prefer'] ?? ''));
      const eq = (name: string) => decodeURIComponent(url.search.match(new RegExp(`[?&]${name}=eq\\.([^&]+)`))?.[1] ?? '');
      const p = url.pathname;

      if (req.method === 'GET' && p === '/rest/v1/tutor_onboarding') {
        if (eq('tutor_id') === T_DOWN) return send(500, { message: 'database fell over', code: 'XX000' });
        const row = onboardingRows.get(eq('tutor_id'));
        return send(200, row ? [row] : []);
      }
      if (req.method === 'POST' && p === '/rest/v1/rpc/set_my_tutor_track') {
        const body = JSON.parse(raw);
        if (!['beginner', 'experienced'].includes(body.p_track)) return send(400, { message: 'Choose beginner or experienced', code: '22023' });
        onboardingRows.set(T1, { ...(onboardingRows.get(T1) ?? { grandfathered: false, consented_at: null, consent_version: null }), track: body.p_track });
        return send(204);
      }
      if (req.method === 'POST' && p === '/rest/v1/rpc/record_my_documents_consent') {
        const body = JSON.parse(raw);
        const row = onboardingRows.get(T1);
        if (!row?.track) return send(400, { message: 'Choose your tutor type first', code: '55000' });
        onboardingRows.set(T1, { ...row, consented_at: '2026-10-13T16:00:00Z', consent_version: body.p_version });
        return send(204);
      }
      if (p === '/rest/v1/tutor_verification_documents') {
        if (req.method === 'GET') return send(200, docs.filter((d) => d.tutor_id === eq('tutor_id')));
        if (req.method === 'POST') {
          const body = JSON.parse(raw);
          if (body.tutor_id === T_RLS) return send(403, { message: 'new row violates row-level security policy for table "tutor_verification_documents"', code: '42501' });
          docCounter += 1;
          const doc: FakeDoc = { id: `doc-${docCounter}`, status: 'pending', admin_notes: null, uploaded_at: `2026-10-13T16:0${docCounter}:00Z`, issued_on: null, ...body };
          docs.push(doc);
          return send(201, wantsRows ? [{ id: doc.id }] : undefined);
        }
        if (req.method === 'DELETE') {
          const id = eq('id');
          const doc = docs.find((d) => d.id === id && d.tutor_id === eq('tutor_id'));
          // Like the row-level rule: a verified document is not deleted, and nothing is reported.
          if (!doc || doc.status === 'verified') return send(200, []);
          docs = docs.filter((d) => d.id !== id);
          return send(200, wantsRows ? [{ id }] : undefined);
        }
      }
      if (req.method === 'POST' && p.startsWith('/storage/v1/object/tutor-documents/')) {
        const path = decodeURIComponent(p.replace('/storage/v1/object/tutor-documents/', ''));
        if (path.startsWith(`${T_RLS}/`) || path.startsWith(`${T1}/`)) {
          files.add(path);
          return send(200, { Key: `tutor-documents/${path}`, Id: 'x' });
        }
        return send(400, { message: 'bucket policy refused', statusCode: '403' });
      }
      if (req.method === 'DELETE' && p === '/storage/v1/object/tutor-documents') {
        for (const path of JSON.parse(raw).prefixes ?? []) files.delete(path);
        return send(200, []);
      }
      return send(404, { message: `unexpected ${req.method} ${p}` });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const db = createClient(`http://127.0.0.1:${port}`, 'fake-key', { auth: { persistSession: false, autoRefreshToken: false } });
  const calls = (match: (e: (typeof log)[number]) => boolean) => log.filter(match).length;
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  const pdf = new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' });
  let idCounter = 0;
  const newId = () => `file${++idCounter}`;

  check('B1 no onboarding row: fetchOnboarding says null', (await fetchOnboarding(db, T1)) === null);
  await chooseTrack(db, 'beginner');
  const rpcTrack = log.find((e) => e.path === '/rest/v1/rpc/set_my_tutor_track');
  check('B2 choosing a kind calls set_my_tutor_track with the kind', !!rpcTrack && JSON.parse(rpcTrack.body).p_track === 'beginner');
  const afterTrack = await fetchOnboarding(db, T1);
  check('B2b the row now says beginner, not grandfathered, no consent yet', afterTrack?.track === 'beginner' && afterTrack.grandfathered === false && afterTrack.consentedAt === null);
  let refused = '';
  try {
    await chooseTrack(db, 'expert' as never);
  } catch (e) {
    refused = (e as { message?: string }).message ?? '';
  }
  check('B2c an unknown kind is refused by the database and its message comes through', /Choose beginner or experienced/.test(refused), refused);
  await recordConsent(db, ONBOARDING_CONSENT_VERSION);
  const rpcConsent = log.find((e) => e.path === '/rest/v1/rpc/record_my_documents_consent');
  check('B3 consent calls record_my_documents_consent with the version', !!rpcConsent && JSON.parse(rpcConsent.body).p_version === ONBOARDING_CONSENT_VERSION);
  const afterConsent = await fetchOnboarding(db, T1);
  check('B3b consent time and version are read back', !!afterConsent?.consentedAt && afterConsent.consentVersion === ONBOARDING_CONSENT_VERSION);
  let down = '';
  try {
    await fetchOnboarding(db, T_DOWN);
  } catch (e) {
    down = (e as { message?: string }).message ?? '';
  }
  check('B4 a database error is passed on, not swallowed', /database fell over/.test(down), down);

  await uploadDocument(db, T1, 'identity_doc', png, null, newId);
  check('B5 the file goes to the private bucket under the tutor\'s own folder', calls((e) => e.method === 'POST' && e.path === `/storage/v1/object/tutor-documents/${T1}/file1.png`) === 1 && files.has(`${T1}/file1.png`));
  const insertIdentity = log.filter((e) => e.method === 'POST' && e.path === '/rest/v1/tutor_verification_documents').pop();
  check('B5b the record points at that path with the right type and no issue date', !!insertIdentity && JSON.stringify(JSON.parse(insertIdentity.body)) === JSON.stringify({ tutor_id: T1, document_type: 'identity_doc', document_url: `${T1}/file1.png`, issued_on: null }), insertIdentity?.body);
  check('B5c the record asks for the changed row back', /return=representation/.test(String(insertIdentity?.headers['prefer'] ?? '')));
  await uploadDocument(db, T1, 'police_clearance', pdf, '2026-09-01', newId);
  const listed = await fetchDocuments(db, T1);
  const police = listed.find((d) => d.documentType === 'police_clearance');
  check('B6 the police certificate keeps its issue date and is a file', police?.issuedOn === '2026-09-01' && police.isLink === false && police.documentUrl.endsWith('.pdf'));
  check('B6b documents are read back newest first, with their status', listed.length === 2 && listed[0].status === 'pending');

  const before = log.length;
  let badType = '';
  try {
    await uploadDocument(db, T1, 'identity_doc', new Blob(['x'], { type: 'application/msword' }), null, newId);
  } catch (e) {
    badType = (e as Error).message;
  }
  check('B7 an unsupported file type is refused before anything is sent', /PDF, JPG or PNG/.test(badType) && log.length === before, badType);

  let rlsMessage = '';
  try {
    await uploadDocument(db, T_RLS, 'identity_doc', png, null, newId);
  } catch (e) {
    rlsMessage = (e as { message?: string }).message ?? '';
  }
  check('B8 when saving the record is refused, the error comes through', /row-level security/.test(rlsMessage), rlsMessage);
  check('B8b ...and the file just uploaded is removed again (no orphan)', files.size === 2 && calls((e) => e.method === 'DELETE' && e.path === '/storage/v1/object/tutor-documents' && e.body.includes(`${T_RLS}/`)) === 1, [...files].join());

  let storageRefused = '';
  try {
    await uploadDocument(db, 'someone-else', 'identity_doc', png, null, newId);
  } catch (e) {
    storageRefused = (e as { message?: string }).message ?? '';
  }
  check('B9 a refused upload is reported and nothing is recorded', /bucket policy refused/.test(storageRefused) && docs.every((d) => d.tutor_id !== 'someone-else'), storageRefused);

  await addLinkDocument(db, T1, 'https://www.school.co.za/staff/ms-nkosi');
  const insertLink = log.filter((e) => e.method === 'POST' && e.path === '/rest/v1/tutor_verification_documents').pop();
  check('B10 a link is stored as proof_of_experience with the link as its address', JSON.stringify(JSON.parse(insertLink!.body)) === JSON.stringify({ tutor_id: T1, document_type: 'proof_of_experience', document_url: 'https://www.school.co.za/staff/ms-nkosi' }), insertLink?.body);
  const withLink = (await fetchDocuments(db, T1)).find((d) => d.documentType === 'proof_of_experience');
  check('B10b it reads back as a link', withLink?.isLink === true);

  const storageDeletesBefore = calls((e) => e.method === 'DELETE' && e.path === '/storage/v1/object/tutor-documents');
  await removeDocument(db, T1, withLink!);
  check('B11 removing a link removes the record and touches no file', docs.every((d) => d.id !== withLink!.id) && calls((e) => e.method === 'DELETE' && e.path === '/storage/v1/object/tutor-documents') === storageDeletesBefore);
  const identityDoc = (await fetchDocuments(db, T1)).find((d) => d.documentType === 'identity_doc')!;
  await removeDocument(db, T1, identityDoc);
  check('B12 removing a pending file removes the record and the file', docs.every((d) => d.id !== identityDoc.id) && !files.has(identityDoc.documentUrl));

  docs.find((d) => d.document_type === 'police_clearance')!.status = 'verified';
  const verifiedDoc = (await fetchDocuments(db, T1)).find((d) => d.documentType === 'police_clearance')!;
  const filesBefore = files.size;
  let lockedMessage = '';
  try {
    await removeDocument(db, T1, verifiedDoc);
  } catch (e) {
    lockedMessage = (e as Error).message;
  }
  check('B13 a verified document cannot be removed, and the tutor is told why in plain words', /already been checked/.test(lockedMessage), lockedMessage);
  check('B13b ...and its file is left alone', files.size === filesBefore && files.has(verifiedDoc.documentUrl));
  server.close();

  // ---- Part C: the wiring and the safety rules (source guards, because the pages need a browser) ---------------------------
  const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

  check('C1 the admin app\'s copy of the rules is identical to the tutor app\'s', source('src/lib/tutorOnboarding.ts') === source('admin/src/lib/tutorOnboarding.ts'));
  const { FEATURES } = await import('../../src/lib/features');
  check('C2 the switch is OFF unless VITE_TUTOR_ONBOARDING=1 is set (nothing changes on the live site)', FEATURES.tutorOnboarding === false);
  check('C2b the switch reads only that variable, so a published build can only turn it on by an edit', /tutorOnboarding: import\.meta\.env\?\.VITE_TUTOR_ONBOARDING === '1'/.test(source('src/lib/features.ts')));

  const mainTsx = source('src/main.tsx');
  check('C3 the app sits inside the onboarding gate, which sits inside the account gate', /<AccountGate>[\s\S]{0,200}<TutorOnboardingGate>\s*<App \/>\s*<\/TutorOnboardingGate>/.test(mainTsx));
  check('C3b the /tutor-documents route exists only behind the switch', /FEATURES\.tutorOnboarding && \(\s*<Route\s+path="\/tutor-documents"/.test(mainTsx));
  const gate = source('src/components/TutorOnboardingGate.tsx');
  check('C4 the gate does nothing unless the switch is on and the person is a tutor', /!FEATURES\.tutorOnboarding \|\| !user \|\| profile\?\.role !== 'tutor'/.test(gate));
  check('C4b a tutor from before the feature (not-needed) or a finished one is never shown the pages', /stage !== 'not-needed' && stage !== 'complete'/.test(gate));
  check('C4c the reminder only shows when the switch is on', /const enabled = FEATURES\.tutorOnboarding;/.test(gate));
  check('C4d the two pages (and the photo shrinker) are loaded only when a tutor reaches them, not shipped to everyone', /lazy\(\(\) => import\('\.\/TutorTypePage'\)/.test(gate) && /lazy\(\(\) => import\('\.\/TutorDocumentsPage'\)/.test(gate) && !/^import .* from '\.\/TutorDocumentsPage'/m.test(gate) && !/^import .* from '\.\/TutorTypePage'/m.test(gate));
  check('C5 the Teach screen shows the reminder', /<TutorDocumentsReminder tutorId=\{tutorId\} \/>/.test(source('src/components/TeachGoScreen.tsx')));
  const createAccount = source('src/pages/CreateAccount.tsx');
  check('C6 the sign-up page only mentions the document steps when the switch is on', /FEATURES\.tutorOnboarding\s*\?\s*"Next, you'll tell us/.test(createAccount) && /role === 'tutor' && FEATURES\.tutorOnboarding && \(/.test(createAccount));

  // The admin app is in use while the migration is not yet applied: its main queries must not name the new table or column.
  const adminQueries = source('admin/src/lib/queries.ts');
  const mainSelects = [...adminQueries.matchAll(/\.from\('tutor_profiles'\)\s*\.select\(`([^`]*)`\)/g)].map((m) => m[1]);
  check('C7 the admin\'s queue and detail queries still select exactly what they did before (they work before the migration)', mainSelects.length >= 2 && mainSelects.every((s) => !/tutor_onboarding|issued_on/.test(s)));
  check('C7b the new data is read in separate queries that fail quietly', /async function fetchTutorTypes[\s\S]*catch \{[\s\S]*async function fetchOnboardingInfo[\s\S]*catch \{[\s\S]*async function fetchIssueDates[\s\S]*catch \{/.test(adminQueries));
  const adminPage = source('admin/src/pages/TutorVerificationDetail.tsx');
  check('C8 Approve is disabled while a new-flow tutor is not ready', /disabled=\{isFinalizing \|\| !canApprove \|\| blockApprove\}/.test(adminPage));
  check('C8b rejecting a document needs a reason the tutor will see', /decision === 'rejected' && !docReason\.trim\(\)/.test(adminPage));

  // The documents the tutor is asked for are real values of the database's doc_type enum (the first twelve exist today;
  // 'proof_of_experience' is added by 20261013180000).
  const knownDocTypes = ['identity_doc', 'matric_certificate', 'university_transcript', 'police_clearance', 'proof_of_address', 'nrso_clearance', 'child_protection_register_clearance', 'teaching_qualification', 'sace_certificate', 'practicum_letter', 'marking_appointment_letter', 'subject_results', 'proof_of_experience'];
  check('C9 every document type the pages use exists in the database enum', [...requirementsFor('beginner'), ...requirementsFor('experienced')].every((r) => knownDocTypes.includes(r.documentType)));
  const enumMigration = source('supabase/migrations/20261013180000_doc_type_proof_of_experience.sql');
  check('C9b the enum value is added by its own tiny migration', /add value if not exists 'proof_of_experience'/.test(enumMigration) && !/create table|drop |delete /i.test(enumMigration));

  const migration = source('supabase/migrations/20261013180100_tutor_onboarding.sql');
  check('C10 tutors that exist when the migration runs are grandfathered (not asked for documents)', /insert into public\.tutor_onboarding \(tutor_id, grandfathered\)\s*select id, true from public\.tutor_profiles/.test(migration));
  check('C10b the onboarding table is readable by signed-in people only and written only through the two functions', /revoke all on public\.tutor_onboarding from anon, authenticated;\s*grant select on public\.tutor_onboarding to authenticated;/.test(migration) && /revoke all on function public\.set_my_tutor_track\(text\) from public, anon;/.test(migration));
  check('C10c a tutor cannot change or delete a verified document (table and file)', (migration.match(/status is distinct from 'verified'/g) ?? []).length >= 2 && /d\.status = 'verified'/.test(migration));
  check('C10d the migration replaces no function and no trigger (it only creates the two new functions)', (migration.match(/create or replace function/g) ?? []).length === 2 && !/create trigger|drop trigger|drop function/i.test(migration));
  check('C10e the consent time is the database\'s clock (the function sets it with now())', /consented_at = now\(\)/.test(migration));

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
