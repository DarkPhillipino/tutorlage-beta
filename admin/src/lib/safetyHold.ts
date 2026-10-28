import { notSwitchedOn } from './subjectApprovals';

// The read-only "who opened this person's documents" view and the safety hold on a person's page (migration 20261021100000).
// Reading the log and the hold lines is plain table reads (admins only, by row security): it does not need the storage tie, and it works
// whether or not any file can be opened. Both parts tolerate the migration being absent: they come back "not available", never an error.

export const ACCESS_LINES_SHOWN = 50;
export const HOLD_NOT_ACTIVE = 'Safety holds are not active on this database yet.';

interface DbError { code?: string; message?: string }
interface Query extends PromiseLike<{ data: unknown[] | null; error: DbError | null }> {
  eq(column: string, value: string): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(count: number): Query;
}
// The few things of the Supabase client used here, so a test can hand in a fake.
export interface HoldClient {
  from(table: string): { select(columns: string): Query };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError | null }>;
}

export interface AccessLine {
  id: string;
  createdAt: string;
  adminLabel: string;
  bucket: string;
  documentPath: string;
  documentType: string | null;
  action: string;
}
export interface HoldEvent {
  seq: number;
  event: 'placed' | 'released';
  reason: string;
  adminLabel: string;
  createdAt: string;
}
export interface DocumentAccessView {
  logAvailable: boolean;
  lines: AccessLine[];
  holdAvailable: boolean;
  events: HoldEvent[];
  onHold: boolean;
  // True when the hold protections (migration 20261021120000) are on this database; the card says what a hold stops accordingly.
  protectionsActive: boolean;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export async function fetchDocumentAccessView(client: HoldClient, profileId: string): Promise<DocumentAccessView> {
  const log = await client
    .from('document_access_log')
    .select('id, created_at, admin_label, bucket, document_path, document_type, action')
    .eq('subject_id', profileId)
    .order('created_at', { ascending: false })
    .limit(ACCESS_LINES_SHOWN);
  let lines: AccessLine[] = [];
  let logAvailable = true;
  if (log.error) {
    if (!notSwitchedOn(log.error)) throw new Error(log.error.message ?? 'Could not load the document access log.');
    logAvailable = false;
  } else {
    lines = ((log.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: str(r.id),
      createdAt: str(r.created_at),
      adminLabel: str(r.admin_label),
      bucket: str(r.bucket),
      documentPath: str(r.document_path),
      documentType: typeof r.document_type === 'string' ? r.document_type : null,
      action: str(r.action),
    }));
  }

  const holds = await client
    .from('safety_hold_events')
    .select('seq, event, reason, admin_label, created_at')
    .eq('profile_id', profileId)
    .order('seq', { ascending: false })
    .limit(100);
  let events: HoldEvent[] = [];
  let holdAvailable = true;
  if (holds.error) {
    if (!notSwitchedOn(holds.error)) throw new Error(holds.error.message ?? 'Could not load the safety hold.');
    holdAvailable = false;
  } else {
    events = ((holds.data ?? []) as Record<string, unknown>[]).map((r) => ({
      seq: Number(r.seq),
      event: r.event === 'released' ? 'released' : 'placed',
      reason: str(r.reason),
      adminLabel: str(r.admin_label),
      createdAt: str(r.created_at),
    }));
  }
  // The hold protections add list_safety_holds(); if it answers, the video-room and document protections are there too (one migration).
  const probe = holdAvailable ? await client.rpc('list_safety_holds', {}) : { error: true };
  // The newest line decides: a person is on hold when it says "placed".
  return { logAvailable, lines, holdAvailable, events, onHold: events[0]?.event === 'placed', protectionsActive: !probe.error };
}

async function holdCall(client: HoldClient, fn: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await client.rpc(fn, args);
  if (!error) return;
  throw new Error(notSwitchedOn(error) ? HOLD_NOT_ACTIVE : (error.message ?? 'The request failed.'));
}

export const placeSafetyHold = (client: HoldClient, profileId: string, reason: string) =>
  holdCall(client, 'place_safety_hold', { p_profile: profileId, p_reason: reason });
export const releaseSafetyHold = (client: HoldClient, profileId: string, note: string) =>
  holdCall(client, 'release_safety_hold', { p_profile: profileId, p_note: note });

export function describeDocument(line: Pick<AccessLine, 'documentType' | 'documentPath'>): string {
  if (line.documentType) {
    const words = line.documentType.replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  if (/^https?:\/\//i.test(line.documentPath)) return 'Web link';
  return line.documentPath.split('/').pop() || line.documentPath;
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
