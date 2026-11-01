// What a person is told when a read from the database gets no answer (see readTimeout.ts). The same sentence everywhere.
export const STALLED_READ_MESSAGE = 'This is taking too long. Check your connection, then try again.';

// Supabase's real errors (Postgrest, Auth, Storage) are plain objects with a
// `message` string property, not real Error instances — `e instanceof Error`
// is always false for them, so that check silently discards the real reason
// and falls back to a generic message everywhere it was used. Use this
// instead of `e instanceof Error ? e.message : fallback` throughout the app.
export function getErrorMessage(e: unknown, fallback: string): string {
  let message: string | null = null;
  if (e instanceof Error) message = e.message;
  else if (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string'
  ) {
    message = (e as { message: string }).message;
  }
  if (message === null) return fallback;
  // The database client words a call we gave up on as "AbortError: <sentence>": show the sentence alone.
  if (message.includes(STALLED_READ_MESSAGE)) return STALLED_READ_MESSAGE;
  return message;
}
