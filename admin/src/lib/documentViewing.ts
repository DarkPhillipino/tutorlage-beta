import { DocumentBucket, DocumentClient, isWebLink, openStoredDocument } from './documentAccess';

// Looking at a stored document INSIDE the admin app (CEO, 2 Nov 2026: "why can't an admin just view them in the app?"). The rules of
// documentAccess.ts are unchanged: the opening is recorded in the database first, then Storage makes the five-minute signed link. This
// file only does what happens after that: the link is used once, here, to read the file's bytes into memory; the person sees them in
// a window of the admin app, and the link is never shown, never put in the page's address and never handed to the normal browser.
// The file's type is read from its first bytes, never from what the server says, so a file that is not a PDF, JPG or PNG is refused
// instead of being drawn.

export type ViewableKind = 'image' | 'pdf';

export type ViewedDocument =
  // The bytes of a stored file, ready to show. logged is false only when the database has no access log yet (documentAccess.ts).
  | { kind: ViewableKind; blob: Blob; bytes: number; logged: boolean }
  // A web address kept as a document (proof of experience): there is no stored file, and the tutor's own page is not shown inside the
  // admin app. The caller opens it in the normal browser, as before.
  | { kind: 'link'; url: string; logged: boolean };

// The private buckets refuse anything over 5 MB; a little room for the file's own overhead.
export const MAX_VIEW_BYTES = 6 * 1024 * 1024;

// What the private buckets accept: PDF, JPG, PNG. The first bytes of each.
export function sniffDocumentKind(bytes: Uint8Array): { kind: ViewableKind; mime: string } | null {
  const startsWith = (...signature: number[]) => bytes.length >= signature.length && signature.every((b, i) => bytes[i] === b);
  if (startsWith(0x25, 0x50, 0x44, 0x46, 0x2d)) return { kind: 'pdf', mime: 'application/pdf' }; // %PDF-
  if (startsWith(0xff, 0xd8, 0xff)) return { kind: 'image', mime: 'image/jpeg' };
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { kind: 'image', mime: 'image/png' };
  return null;
}

// "PDF", "JPG photo", "PNG image" or "Link", from the stored path alone (no download): so a list can tell two files of the same kind apart.
export function fileKindLabel(path: string): string {
  if (isWebLink(path)) return 'Link';
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (extension === 'pdf') return 'PDF';
  if (extension === 'jpg' || extension === 'jpeg') return 'JPG photo';
  if (extension === 'png') return 'PNG image';
  return 'File';
}

// The few things of fetch used here, so a test can hand in a fake.
export interface FetchedFile {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}
export type FileFetcher = (url: string, init: { cache: 'no-store'; credentials: 'omit'; referrerPolicy: 'no-referrer' }) => Promise<FetchedFile>;

export async function viewStoredDocument(
  client: DocumentClient,
  bucket: DocumentBucket,
  path: string,
  options: { subject?: string } = {},
  fetchFile: FileFetcher = (url, init) => fetch(url, init),
): Promise<ViewedDocument> {
  // Records the opening first; throws (and nothing is read) when it cannot be recorded.
  const opened = await openStoredDocument(client, bucket, path, { action: 'opened', subject: options.subject });
  if (isWebLink(path)) return { kind: 'link', url: opened.url, logged: opened.logged };

  let response: FetchedFile;
  try {
    response = await fetchFile(opened.url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch {
    throw new Error('Could not read this document. Check the internet connection and try again.');
  }
  if (!response.ok) throw new Error('Could not read this document. Close it and open it again (the link only lasts five minutes).');
  const declared = Number(response.headers?.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_VIEW_BYTES) throw new Error('This file is too large to show here.');
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_VIEW_BYTES) throw new Error('This file is too large to show here.');
  if (buffer.byteLength === 0) throw new Error('This file is empty.');

  const sniffed = sniffDocumentKind(new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength)));
  if (!sniffed) throw new Error("This file is not a PDF, JPG or PNG, so it can't be shown here.");
  return { kind: sniffed.kind, blob: new Blob([buffer], { type: sniffed.mime }), bytes: buffer.byteLength, logged: opened.logged };
}

// ---- listing a tutor's documents so two files of one kind can be told apart and counted ----

// Oldest first: the order they were sent, and the order the viewer's Next goes in.
export function sortDocumentsOldestFirst<T extends { id: string; uploadedAt: string | null }>(docs: T[]): T[] {
  return [...docs].sort((a, b) => (a.uploadedAt ?? '').localeCompare(b.uploadedAt ?? '') || a.id.localeCompare(b.id));
}

// " (2 of 2)" when the tutor sent more than one document of this kind, otherwise nothing.
export function positionInKind<T extends { id: string; documentType: string }>(docs: T[], doc: T): string {
  const sameKind = docs.filter((d) => d.documentType === doc.documentType);
  return sameKind.length > 1 ? ` (${sameKind.findIndex((d) => d.id === doc.id) + 1} of ${sameKind.length})` : '';
}

// "2 documents on file (2 stored files)" / "3 documents on file (2 stored files, 1 link)". Every row counts, so a missing one is visible.
export function documentCountSentence(total: number, stored: number): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const links = total - stored;
  const detail = links > 0 ? ` (${plural(stored, 'stored file', 'stored files')}, ${plural(links, 'link', 'links')})` : '';
  return `${plural(total, 'document', 'documents')} on file${detail}`;
}
