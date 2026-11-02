import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentViewer, type ViewerDocument } from '../components/DocumentViewer';
import { TutorDocumentList } from '../components/TutorDocumentList';
import type { VerificationDocument } from '../types';
import type { DocumentClient } from '../lib/documentAccess';
import { viewStoredDocument } from '../lib/documentViewing';
import '../index.css';

// A practice copy of the document viewer: three pretend files (a photo of an ID, a PNG, a one-page PDF) are made in this page and handed
// to the REAL viewing code through a fake database client and a fake file fetch, so the order (record, link, read), the sniffing of the
// first bytes and the window are exactly the real ones. Nothing is sent anywhere, no sign-in needed. Open
// http://localhost:3100/dev-document-viewer.html while the admin app is running. The real page is pages/TutorVerificationDetail.tsx.

const TUTOR = '3f2b8a54-1111-4222-8333-444455556666';
export const steps: string[] = [];

// A tutor who sent two photos of the ID, a police certificate, a results PDF and a link: the list says how many and which.
const row = (id: string, documentType: VerificationDocument['documentType'], documentUrl: string, uploadedAt: string, status: VerificationDocument['status'], issuedOn: string | null = null): VerificationDocument =>
  ({ id, tutorId: TUTOR, documentType, documentUrl, status, adminNotes: null, uploadedAt, reviewedAt: null, issuedOn });
const SAMPLE_ROWS: VerificationDocument[] = [
  row('r2', 'identity_doc', `${TUTOR}/id-back.png`, '2026-11-01T19:15:00Z', 'pending'),
  row('r1', 'identity_doc', `${TUTOR}/id-front.jpg`, '2026-11-01T19:14:00Z', 'verified'),
  row('r3', 'police_clearance', `${TUTOR}/police.pdf`, '2026-11-01T19:20:00Z', 'pending', '2026-10-20'),
  row('r4', 'subject_results', `${TUTOR}/results.pdf`, '2026-11-01T19:22:00Z', 'rejected'),
  row('r5', 'proof_of_experience', 'https://www.superprof.co.za/tutor/example', '2026-11-01T19:25:00Z', 'pending'),
];

function pictureBytes(type: 'image/jpeg' | 'image/png', label: string, colour: string): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 400;
  const context = canvas.getContext('2d')!;
  context.fillStyle = colour;
  context.fillRect(0, 0, 640, 400);
  context.fillStyle = '#ffffff';
  context.font = 'bold 40px sans-serif';
  context.fillText(label, 40, 200);
  context.fillText('(a pretend photo, wider than tall)', 40, 260);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b))) : reject(new Error('no picture'))), type, 0.9),
  );
}

function pdfBytes(text: string): Uint8Array {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${`BT /F1 24 Tf 40 100 Td (${text}) Tj ET`.length}>>\nstream\nBT /F1 24 Tf 40 100 Td (${text}) Tj ET\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<</Root 1 0 R/Size ${objects.length + 1}>>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

function Preview() {
  const [docs, setDocs] = useState<ViewerDocument[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const files: Record<string, Uint8Array> = {
        [`${TUTOR}/id-front.jpg`]: await pictureBytes('image/jpeg', 'ID front', '#0F766E'),
        [`${TUTOR}/id-back.png`]: await pictureBytes('image/png', 'ID back', '#7C2D12'),
        [`${TUTOR}/police.pdf`]: pdfBytes('Police clearance (pretend)'),
      };
      const client: DocumentClient = {
        rpc: async (fn, args) => { steps.push(`record:${fn}:${String(args.p_path).split('/').pop()}`); return { data: 'row', error: null }; },
        storage: { from: () => ({ createSignedUrl: async (path, seconds) => { steps.push(`link:${path.split('/').pop()}:${seconds}`); return { data: { signedUrl: `memory://${path}` }, error: null }; } }) },
      };
      const fetchFile = async (url: string) => {
        const path = url.replace('memory://', '');
        steps.push(`read:${path.split('/').pop()}`);
        const bytes = files[path];
        return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
      };
      const make = (path: string, title: string, subtitle: string): ViewerDocument => ({
        key: path,
        title,
        subtitle,
        open: () => viewStoredDocument(client, 'tutor-documents', path, { subject: TUTOR }, fetchFile),
      });
      setDocs([
        make(`${TUTOR}/id-front.jpg`, 'Identity Document (1 of 2)', 'JPG photo · uploaded 01/11/2026, 21:14 · pending'),
        make(`${TUTOR}/id-back.png`, 'Identity Document (2 of 2)', 'PNG image · uploaded 01/11/2026, 21:15 · pending'),
        make(`${TUTOR}/police.pdf`, 'Police Clearance', 'PDF · uploaded 01/11/2026, 21:20 · pending'),
      ]);
    })();
  }, []);

  (window as unknown as { __steps: string[] }).__steps = steps;
  return (
    <div className="p-6">
      <h1 className="text-xl font-extrabold text-[#0F172A] mb-2">Document viewer: practice copy</h1>
      <button id="reopen" onClick={() => setOpen(true)} className="bg-[#0F172A] text-white text-xs font-bold px-4 py-2 rounded-lg mb-4">Open the documents</button>
      <div id="list" className="bg-white rounded-2xl p-6 border border-slate-200 max-w-2xl">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Documents</h2>
        <TutorDocumentList documents={SAMPLE_ROWS} busyDocId={null} onView={() => setOpen(true)} onOpenLink={() => undefined} onReview={() => undefined} />
      </div>
      {docs && open && <DocumentViewer documents={docs} onClose={() => setOpen(false)} />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
