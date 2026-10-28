import { notSwitchedOn } from './subjectApprovals';

// Privacy §7 promises "we record each time one is opened". Every place the admin app opens a stored document goes through
// openStoredDocument(): it records the opening in the database FIRST (log_document_access, migration 20261021100000) and only then asks
// Storage for the five-minute link, so the app never makes a link it did not record. If the recording fails for any reason other than
// "the function is not on this database yet", nothing is opened. Until the migration is applied the document still opens, and the caller
// shows ACCESS_LOG_NOT_ACTIVE_NOTE: the gap is never silent.

export type DocumentBucket = 'tutor-documents' | 'school-results';

export const ACCESS_LOG_NOT_ACTIVE_NOTE =
  'The document access log is not active on this database, so this opening was NOT recorded.';

// The few things of the Supabase client used here, so a test can hand in a fake.
interface DbError { code?: string; message?: string }
export interface DocumentClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError | null }>;
  storage: {
    from(bucket: string): {
      createSignedUrl(path: string, seconds: number): PromiseLike<{ data: { signedUrl: string } | null; error: DbError | null }>;
    };
  };
}

export interface OpenedDocument {
  url: string;
  // false only when the database has no access log yet (the caller shows ACCESS_LOG_NOT_ACTIVE_NOTE)
  logged: boolean;
}

export const isWebLink = (path: string) => /^https?:\/\//i.test(path);

export async function openStoredDocument(
  client: DocumentClient,
  bucket: DocumentBucket,
  path: string,
  options: { action?: 'opened' | 'downloaded'; subject?: string } = {},
): Promise<OpenedDocument> {
  // A web address kept as a document has no stored file, so the caller must say whose it is.
  if (isWebLink(path) && !options.subject) throw new Error('Say whose document this is before opening it.');

  const logged = await client.rpc('log_document_access', {
    p_bucket: bucket,
    p_path: path,
    p_action: options.action ?? 'opened',
    p_subject: options.subject ?? null,
  });
  let recorded = true;
  if (logged.error) {
    if (!notSwitchedOn(logged.error)) {
      const why = logged.error.message === 'Admins only' ? 'only active admins can open documents' : (logged.error.message ?? 'unknown error');
      throw new Error(`The opening could not be recorded, so the document was not opened (${why}).`);
    }
    recorded = false;
  }

  if (isWebLink(path)) return { url: path, logged: recorded };
  const signed = await client.storage.from(bucket).createSignedUrl(path, 300);
  if (signed.error || !signed.data) throw new Error('Could not open this document — check your admin access.');
  return { url: signed.data.signedUrl, logged: recorded };
}
