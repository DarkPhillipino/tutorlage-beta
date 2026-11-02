// Checks on looking at a stored document INSIDE the admin app (CEO, 2 Nov 2026, "why can't an admin just view them in the app?").
// Run: npx tsx scripts/dev/document-viewer-test.ts
// Proves, with a fake database client and a fake file fetch: the opening is recorded before the link is made and the link before the file is
// read; nothing is read when the opening cannot be recorded; the file's type comes from its first bytes (a page of HTML called a PDF is
// refused); a web address is never fetched; the list of a tutor's documents counts every row and tells two of one kind apart.
// It does NOT draw anything: the drawing of a PDF and a photo was checked separately inside the real Electron window (see the 2 Nov
// programmer report). Rendering here is the loading state only.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DocumentClient } from '../../admin/src/lib/documentAccess';
import {
  FetchedFile, FileFetcher, MAX_VIEW_BYTES, documentCountSentence, fileKindLabel, positionInKind, sniffDocumentKind, sortDocumentsOldestFirst, viewStoredDocument,
} from '../../admin/src/lib/documentViewing';
import { DocumentViewer } from '../../admin/src/components/DocumentViewer';
import { TutorDocumentList } from '../../admin/src/components/TutorDocumentList';
import type { VerificationDocument } from '../../admin/src/types';

const adminRequire = createRequire(new URL('../../admin/package.json', import.meta.url));
const React = adminRequire('react') as typeof import('react');
const { renderToStaticMarkup } = adminRequire('react-dom/server') as typeof import('react-dom/server');

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TUTOR = '3f2b8a54-1111-4222-8333-444455556666';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>');
const asBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

type Err = { code?: string; message?: string } | null;
function fakeWorld(options: { logError?: Err; signError?: Err; body?: Uint8Array; status?: number; declared?: string | null; throws?: boolean } = {}) {
  const calls: string[] = [];
  const client: DocumentClient = {
    rpc: async (fn) => { calls.push(`rpc:${fn}`); return { data: options.logError ? null : 'row-id', error: options.logError ?? null }; },
    storage: { from: (bucket) => ({ createSignedUrl: async (path, seconds) => {
      calls.push(`sign:${bucket}:${path}:${seconds}`);
      return options.signError ? { data: null, error: options.signError } : { data: { signedUrl: `https://files.example.invalid/${path}?token=abc` }, error: null };
    } }) },
  };
  let init: unknown = null;
  const fetchFile: FileFetcher = async (url, i) => {
    calls.push(`fetch:${url}`);
    init = i;
    if (options.throws) throw new TypeError('Failed to fetch');
    const body = options.body ?? PDF;
    const response: FetchedFile = {
      ok: (options.status ?? 200) < 400,
      status: options.status ?? 200,
      headers: { get: (name) => (name.toLowerCase() === 'content-length' ? (options.declared === undefined ? String(body.byteLength) : options.declared) : null) },
      arrayBuffer: async () => asBuffer(body),
    };
    return response;
  };
  return { client, fetchFile, calls, init: () => init };
}
async function view(world: ReturnType<typeof fakeWorld>, path: string, subject?: string, bucket: 'tutor-documents' | 'school-results' = 'tutor-documents') {
  try { return { ok: await viewStoredDocument(world.client, bucket, path, { subject }, world.fetchFile), error: null as string | null }; }
  catch (e) { return { ok: null, error: (e as Error).message }; }
}

async function main() {
  // ---- what kind of file it is: the first bytes decide ----
  check('a PDF, a JPG and a PNG are recognised by their first bytes', sniffDocumentKind(PDF)?.mime === 'application/pdf' && sniffDocumentKind(JPEG)?.mime === 'image/jpeg' && sniffDocumentKind(PNG)?.mime === 'image/png');
  check('a page of HTML, an empty file and a too-short file are not recognised', sniffDocumentKind(HTML) === null && sniffDocumentKind(new Uint8Array()) === null && sniffDocumentKind(new Uint8Array([0xff, 0xd8])) === null);
  check('a PDF and an image are told apart as "pdf" and "image"', sniffDocumentKind(PDF)?.kind === 'pdf' && sniffDocumentKind(JPEG)?.kind === 'image' && sniffDocumentKind(PNG)?.kind === 'image');
  check('the stored path names the kind: PDF, JPG photo, PNG image, Link, File', fileKindLabel(`${TUTOR}/a.pdf`) === 'PDF' && fileKindLabel(`${TUTOR}/a.JPG`) === 'JPG photo' && fileKindLabel(`${TUTOR}/a.jpeg`) === 'JPG photo' && fileKindLabel(`${TUTOR}/a.png`) === 'PNG image' && fileKindLabel('https://x.example/y') === 'Link' && fileKindLabel(`${TUTOR}/a`) === 'File');

  // ---- the normal path: record, link, read ----
  const w = fakeWorld({ body: PDF });
  const r = await view(w, `${TUTOR}/police.pdf`);
  check('the opening is recorded first, then the five-minute link is made, then the file is read, in that order',
    w.calls.length === 3 && w.calls[0] === 'rpc:log_document_access' && w.calls[1] === `sign:tutor-documents:${TUTOR}/police.pdf:300` && w.calls[2].startsWith('fetch:https://files.example.invalid/'), w.calls.join(' > '));
  check('the link is read without cookies or a referrer and never from the cache', JSON.stringify(w.init()) === JSON.stringify({ cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }));
  check('a recorded PDF comes back as a "pdf" with its own bytes, typed application/pdf, and logged = true',
    r.ok?.kind === 'pdf' && r.ok.logged === true && 'blob' in r.ok && r.ok.blob.type === 'application/pdf' && r.ok.blob.size === PDF.byteLength);
  const rj = await view(fakeWorld({ body: JPEG }), `${TUTOR}/id.jpg`);
  const rp = await view(fakeWorld({ body: PNG }), `${TUTOR}/id.png`);
  check('a JPG and a PNG come back as images with the right type', rj.ok?.kind === 'image' && 'blob' in rj.ok && rj.ok.blob.type === 'image/jpeg' && rp.ok?.kind === 'image' && 'blob' in rp.ok && rp.ok.blob.type === 'image/png');
  const rs = await view(fakeWorld({ body: PDF }), `${TUTOR}/report.pdf`, undefined, 'school-results');
  check('school results use their own store', rs.ok?.kind === 'pdf');

  // ---- the opening cannot be recorded: nothing is read ----
  for (const [label, err] of [['an admin who is switched off', { code: '42501', message: 'Admins only' }], ['a dropped connection', { message: 'TypeError: Failed to fetch' }], ['a timeout', { code: '57014', message: 'canceling statement due to statement timeout' }]] as const) {
    const x = fakeWorld({ logError: err });
    const rx = await view(x, `${TUTOR}/police.pdf`);
    check(`${label}: no link is made, no file is read, and the admin is told`, rx.ok === null && /could not be recorded/.test(rx.error ?? '') && x.calls.length === 1, `${rx.error} | ${x.calls.join(',')}`);
  }
  const missing = fakeWorld({ logError: { code: 'PGRST202', message: 'Could not find the function public.log_document_access in the schema cache' } });
  const rm = await view(missing, `${TUTOR}/police.pdf`);
  check('on a database with no access log yet the file is still shown, and logged = false so the page says it was not recorded', rm.ok?.kind === 'pdf' && rm.ok.logged === false && missing.calls.length === 3);

  // ---- the file cannot be read, or is not what it says ----
  const noLink = await view(fakeWorld({ signError: { message: 'Object not found' } }), `${TUTOR}/police.pdf`);
  check('if Storage will not make the link the admin sees the old "could not open" message and nothing is read', noLink.error === 'Could not open this document — check your admin access.');
  const gone = fakeWorld({ status: 400 });
  const rg = await view(gone, `${TUTOR}/police.pdf`);
  check('an expired or refused link says so in plain words', /Could not read this document/.test(rg.error ?? '') && /five minutes/.test(rg.error ?? ''), rg.error ?? '');
  const offline = await view(fakeWorld({ throws: true }), `${TUTOR}/police.pdf`);
  check('a dropped connection while reading says to check the internet connection', /internet connection/.test(offline.error ?? ''), offline.error ?? '');
  const disguised = await view(fakeWorld({ body: HTML }), `${TUTOR}/police.pdf`);
  check('a web page saved under a .pdf name is refused, not drawn', disguised.ok === null && /not a PDF, JPG or PNG/.test(disguised.error ?? ''), disguised.error ?? '');
  const empty = await view(fakeWorld({ body: new Uint8Array(), declared: '0' }), `${TUTOR}/police.pdf`);
  check('an empty file is refused', empty.ok === null && /empty/.test(empty.error ?? ''), empty.error ?? '');
  const bigDeclared = await view(fakeWorld({ declared: String(MAX_VIEW_BYTES + 1) }), `${TUTOR}/police.pdf`);
  check('a file declared over the size limit is refused before it is read', bigDeclared.ok === null && /too large/.test(bigDeclared.error ?? ''));
  const big = new Uint8Array(MAX_VIEW_BYTES + 10);
  big.set(PDF);
  const bigActual = await view(fakeWorld({ body: big, declared: null }), `${TUTOR}/police.pdf`);
  check('a file over the size limit is refused even when the server did not say how big it was', bigActual.ok === null && /too large/.test(bigActual.error ?? ''));

  // ---- a web address kept as a document ----
  const l0 = fakeWorld();
  const rl0 = await view(l0, 'https://www.superprof.co.za/tutor/x');
  check('a web address without saying whose it is is refused before anything is recorded, made or read', rl0.error !== null && l0.calls.length === 0);
  const l1 = fakeWorld();
  const rl1 = await view(l1, 'https://www.superprof.co.za/tutor/x', TUTOR);
  check('a web address is recorded with the tutor named, comes back as a "link", and is never fetched or signed', rl1.ok?.kind === 'link' && l1.calls.length === 1 && l1.calls[0] === 'rpc:log_document_access');

  // ---- listing a tutor's documents ----
  const docs = [
    { id: 'b', documentType: 'identity_doc', uploadedAt: '2026-11-01T10:05:00Z' },
    { id: 'a', documentType: 'identity_doc', uploadedAt: '2026-11-01T10:01:00Z' },
    { id: 'c', documentType: 'police_clearance', uploadedAt: '2026-11-01T10:03:00Z' },
    { id: 'd', documentType: 'proof_of_experience', uploadedAt: null },
  ];
  const sorted = sortDocumentsOldestFirst(docs);
  check('documents are listed in the order they were sent (a missing time first), and the original list is not changed', sorted.map((d) => d.id).join('') === 'dacb' && docs.map((d) => d.id).join('') === 'bacd');
  check('two documents of one kind read "(1 of 2)" and "(2 of 2)"; a single one reads nothing',
    positionInKind(sorted, docs[1]) === ' (1 of 2)' && positionInKind(sorted, docs[0]) === ' (2 of 2)' && positionInKind(sorted, docs[2]) === '' && positionInKind(sorted, docs[3]) === '');
  check('the count counts every row: "2 documents on file (2 stored files)" would be wrong without links, so links are named',
    documentCountSentence(1, 1) === '1 document on file' && documentCountSentence(2, 2) === '2 documents on file' && documentCountSentence(3, 2) === '3 documents on file (2 stored files, 1 link)' && documentCountSentence(1, 0) === '1 document on file (0 stored files, 1 link)');

  // ---- the list on a tutor's page: how many, and which ----
  const row = (id: string, documentType: VerificationDocument['documentType'], documentUrl: string, uploadedAt: string, status: VerificationDocument['status'], issuedOn: string | null = null): VerificationDocument =>
    ({ id, tutorId: TUTOR, documentType, documentUrl, status, adminNotes: null, uploadedAt, reviewedAt: null, issuedOn });
  const rowsSent = [
    row('r2', 'identity_doc', `${TUTOR}/back.png`, '2026-11-01T19:15:00Z', 'pending'),
    row('r1', 'identity_doc', `${TUTOR}/front.jpg`, '2026-11-01T19:14:00Z', 'verified'),
    row('r3', 'police_clearance', `${TUTOR}/police.pdf`, '2026-11-01T19:20:00Z', 'pending', '2026-10-20'),
    row('r5', 'proof_of_experience', 'https://www.superprof.co.za/tutor/example', '2026-11-01T19:25:00Z', 'pending'),
  ];
  const render = (documents: VerificationDocument[]) => renderToStaticMarkup(React.createElement(TutorDocumentList, { documents, busyDocId: null, onView: () => undefined, onOpenLink: () => undefined, onReview: () => undefined }));
  const listHtml = render(rowsSent);
  check('the list says how many documents are on file and how they split: "4 documents on file (3 stored files, 1 link)"', /4 documents on file \(3 stored files, 1 link\)/.test(listHtml));
  check('two documents of one kind are numbered "1 of 2" and "2 of 2", the earlier upload first, even though they were handed in the other way round', listHtml.indexOf('Identity Document (1 of 2)') !== -1 && listHtml.indexOf('Identity Document (1 of 2)') < listHtml.indexOf('Identity Document (2 of 2)'));
  check('each line names the kind of file (JPG photo, PNG image, PDF, Link) and when it was uploaded, and keeps its status', /JPG photo\s*(<!-- -->)?\s*· uploaded|JPG photo.{0,30}uploaded/.test(listHtml) && /PNG image.{0,30}uploaded/.test(listHtml) && /PDF.{0,30}uploaded/.test(listHtml) && /Link.{0,30}uploaded/.test(listHtml) && /Verified/i.test(listHtml) && /Pending/i.test(listHtml));
  check('a kind with only one document is not numbered', !/Police Clearance \(\d of/.test(listHtml) && /Police Clearance/.test(listHtml));
  check('a web address says whose page it is and that it opens in the browser', /Link to superprof\.co\.za/.test(listHtml) && /opens in your browser/.test(listHtml));
  check('one document reads "1 document on file" with no "of"', /1 document on file\./.test(render([rowsSent[1]])) && !/ of \d\)/.test(render([rowsSent[1]])));
  check('no documents reads "No documents uploaded yet."', /No documents uploaded yet\./.test(render([])));

  // ---- the window ----
  const html = renderToStaticMarkup(React.createElement(DocumentViewer, { documents: [
    { key: 'a', title: 'Identity Document', subtitle: 'JPG photo · uploaded 01/11/2026', open: async () => { throw new Error('not run in a static render'); } },
    { key: 'b', title: 'Identity Document', open: async () => { throw new Error('not run in a static render'); } },
  ], onClose: () => undefined }));
  check('the window is a labelled dialog with the title, the line under it, "Document 1 of 2", a close button and the loading note', /role="dialog"/.test(html) && /aria-modal="true"/.test(html) && /Identity Document/.test(html) && /JPG photo · uploaded 01\/11\/2026/.test(html) && /Document 1 of 2/.test(html) && /aria-label="Close the document"/.test(html) && /Opening and recording the opening/.test(html));
  check('before the file arrives nothing is drawn: no picture, no embedded page', !/<img/.test(html) && !/<iframe/.test(html));
  const single = renderToStaticMarkup(React.createElement(DocumentViewer, { documents: [{ key: 'a', title: 'Marks record', open: async () => { throw new Error('x'); } }], onClose: () => undefined }));
  check('with one document there are no Previous/Next buttons', !/Previous document/.test(single) && !/Next document/.test(single));

  // ---- what the window and the pages must not do ----
  const viewer = code('admin/src/components/DocumentViewer.tsx');
  check('the window frees the file when it closes or moves on (revokeObjectURL), and never saves it (no localStorage, sessionStorage, download link or print)', /URL\.revokeObjectURL\(/.test(viewer) && !/localStorage|sessionStorage|indexedDB|download=|\bdownload\b|window\.print/.test(viewer));
  check('the window does not make a link or call the database itself (it only asks the page for the file)', !/createSignedUrl|supabase|\.rpc\(/.test(viewer));
  check('the PDF is drawn from the in-memory address, in a frame, and only after the page said it was a PDF', /<iframe src=\{shown\.url\}/.test(viewer));
  const logic = code('admin/src/lib/documentViewing.ts');
  check('documentViewing.ts goes through openStoredDocument and makes no link of its own', /openStoredDocument\(/.test(logic) && !/createSignedUrl/.test(logic));
  for (const page of ['admin/src/pages/TutorVerificationDetail.tsx', 'admin/src/pages/Tier1.tsx', 'admin/src/pages/SchoolResults.tsx']) {
    const src = code(page);
    check(`${page.split('/').pop()} shows a stored file in the window and no longer sends it to the normal browser`, /<DocumentViewer/.test(src) && (page.endsWith('TutorVerificationDetail.tsx') ? (src.match(/window\.open\(/g) ?? []).length === 1 && /window\.open\(opened\.url/.test(src) : !/window\.open\(/.test(src)));
  }
  const detail = code('admin/src/pages/TutorVerificationDetail.tsx');
  const list = code('admin/src/components/TutorDocumentList.tsx');
  check('on a tutor\'s page only a web address still goes to the browser; a stored file opens the window', /link \? onOpenLink\(doc\.documentUrl\) : onView\(doc\.id\)/.test(list) && /onOpenLink=\{handleOpenDocument\}/.test(detail) && /onView=\{\(id\) => setViewerKey\(id\)\}/.test(detail));
  check('the tutor\'s page hands the list EVERY row of tutor.documents, not a filtered copy; the list sorts them and states the count', /<TutorDocumentList\s+documents=\{tutor\.documents\}/.test(detail) && /sortDocumentsOldestFirst\(documents\)/.test(list) && /documentCountSentence\(/.test(list) && /sortedDocs\.map\(\(doc\)/.test(list));
  const main = read('admin/desktop/main.cjs');
  check('the desktop shell still sends only outside web addresses to the browser (unchanged)', /setWindowOpenHandler/.test(main) && /shell\.openExternal/.test(main));

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
