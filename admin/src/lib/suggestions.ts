// The admin app's half of the Suggestions box (CEO's request, 5 Nov 2026; database: supabase/migrations/20261105120000_platform_suggestions.sql).
// Reads public.platform_suggestions (an active admin can read every row; nobody else can read the table at all) and changes a row only through the
// database function admin_handle_suggestion(), which can set the status and the internal note and nothing else.
//
// TOLERANT on purpose: the admin app runs live from the working folder, so it can be opened before that migration is applied. A missing table or
// function is a plain "not switched on yet" state (and a count of 0 on the menu), never a broken page.
// Pure on purpose (the client is an argument, no Supabase import) so scripts/dev/admin-suggestions-test.ts can check it under Node.

export type SuggestionStatus = 'new' | 'read' | 'planned' | 'done' | 'dismissed';
export const SUGGESTION_STATUSES: SuggestionStatus[] = ['new', 'read', 'planned', 'done', 'dismissed'];

export const STATUS_LABELS: Record<SuggestionStatus, string> = {
  new: 'New',
  read: 'Read',
  planned: 'Planned',
  done: 'Done',
  dismissed: 'Dismissed',
};

export const ROLE_LABELS: Record<string, string> = { student: 'Learner', parent: 'Parent', tutor: 'Tutor' };

export const NOTE_MAX_CHARS = 1000;
export const LIST_LIMIT = 300;
// The menu item refreshes this often, and when a suggestion is handled on the page (SUGGESTIONS_CHANGED_EVENT).
export const COUNT_EVERY_MS = 60_000;
export const SUGGESTIONS_CHANGED_EVENT = 'tutorlage-suggestions-changed';

export const SUGGESTIONS_NOT_ON_YET = 'Suggestions are not switched on in this database yet. They start as soon as their database change is applied.';

export interface SuggestionRow {
  id: string;
  userId: string;
  // The person's name now ('Someone' when it cannot be read) and their role ('student', 'parent', 'tutor').
  name: string;
  role: string;
  body: string;
  status: SuggestionStatus;
  note: string;
  createdAt: string;
  handledAt: string | null;
  handledBy: string | null;     // the admin's name, when known
}

export type SuggestionsResult =
  | { state: 'ok'; rows: SuggestionRow[] }
  | { state: 'not_set_up' }
  | { state: 'failed'; message: string };

interface DbError { code?: string; message?: string }
interface DbResult { data: unknown; error: DbError | null; count?: number | null }
export interface SuggestionsClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
}

// PostgREST says PGRST205 (table) or PGRST202 (function) when it is not in its schema cache; Postgres says 42P01 (table) or 42883 (function).
export function isMissingSuggestions(error: DbError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === 'PGRST202' || error.code === '42P01' || error.code === '42883') return true;
  const message = error.message ?? '';
  return /(platform_suggestions|admin_handle_suggestion)/i.test(message) && /(does not exist|schema cache|could not find)/i.test(message);
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const one = (v: unknown): Record<string, unknown> | null => {
  const x = Array.isArray(v) ? v[0] : v;
  return x && typeof x === 'object' ? (x as Record<string, unknown>) : null;
};
const asStatus = (v: unknown): SuggestionStatus => (SUGGESTION_STATUSES.includes(v as SuggestionStatus) ? (v as SuggestionStatus) : 'new');

// One row of the read, tolerant of any shape (an odd status counts as new; a missing name reads "Someone").
export function mapSuggestion(raw: Record<string, unknown>): SuggestionRow {
  const person = one(raw.profiles);
  const admin = one(raw.admin_profiles);
  const adminName = admin ? `${text(admin.first_name)} ${text(admin.surname)}`.trim() : '';
  return {
    id: text(raw.id),
    userId: text(raw.user_id),
    name: (person && text(person.full_name).trim()) || 'Someone',
    role: text(raw.role),
    body: text(raw.body),
    status: asStatus(raw.status),
    note: text(raw.admin_note),
    createdAt: text(raw.created_at),
    handledAt: raw.handled_at == null ? null : text(raw.handled_at),
    handledBy: adminName || null,
  };
}

// Newest first (the database sorts too; this keeps the order right whatever came back). The status filter is applied on the screen from this one read.
export async function fetchSuggestions(db: SuggestionsClient): Promise<SuggestionsResult> {
  try {
    const { data, error } = await db
      .from('platform_suggestions')
      .select('id, user_id, role, body, status, admin_note, created_at, handled_at, handled_by, profiles!platform_suggestions_user_id_fkey ( full_name ), admin_profiles!platform_suggestions_handled_by_fkey ( first_name, surname )')
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT);
    if (error) return isMissingSuggestions(error) ? { state: 'not_set_up' } : { state: 'failed', message: error.message ?? 'Could not load the suggestions.' };
    const rows = (Array.isArray(data) ? (data as Record<string, unknown>[]) : []).map(mapSuggestion);
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { state: 'ok', rows };
  } catch (e) {
    return { state: 'failed', message: e instanceof Error ? e.message : 'Could not load the suggestions.' };
  }
}

// The number on the menu item: suggestions nobody has opened yet. Any doubt (no table yet, an error) is 0.
export async function countNewSuggestions(db: SuggestionsClient): Promise<number> {
  try {
    const { count, error } = await db.from('platform_suggestions').select('id', { count: 'exact', head: true }).eq('status', 'new');
    if (error || typeof count !== 'number' || !Number.isFinite(count) || count < 0) return 0;
    return count;
  } catch {
    return 0;
  }
}

export function countsByStatus(rows: SuggestionRow[]): Record<SuggestionStatus | 'all', number> {
  const counts: Record<SuggestionStatus | 'all', number> = { all: rows.length, new: 0, read: 0, planned: 0, done: 0, dismissed: 0 };
  for (const r of rows) counts[r.status] += 1;
  return counts;
}

export function filterSuggestions(rows: SuggestionRow[], filter: SuggestionStatus | 'all'): SuggestionRow[] {
  return filter === 'all' ? rows : rows.filter((r) => r.status === filter);
}

export function noteProblem(note: string): string | null {
  return Array.from(note.trim()).length > NOTE_MAX_CHARS ? `The note can be ${NOTE_MAX_CHARS.toLocaleString('en-US')} characters at most.` : null;
}

// The one write: status and internal note (a blank note clears it). Returns null when saved, else the sentence to show.
export async function handleSuggestion(db: SuggestionsClient, id: string, status: SuggestionStatus, note: string): Promise<string | null> {
  const problem = noteProblem(note);
  if (problem) return problem;
  try {
    const { error } = await db.rpc('admin_handle_suggestion', { p_id: id, p_status: status, p_note: note.trim() });
    if (!error) return null;
    if (isMissingSuggestions(error)) return SUGGESTIONS_NOT_ON_YET;
    return error.message ?? 'Could not save that change.';
  } catch (e) {
    return e instanceof Error ? e.message : 'Could not save that change.';
  }
}

// "3 min ago", "5 h ago", "4 days ago".
export function describeAgo(iso: string, now: Date = new Date()): string {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
