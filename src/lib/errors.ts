// Supabase's real errors (Postgrest, Auth, Storage) are plain objects with a
// `message` string property, not real Error instances — `e instanceof Error`
// is always false for them, so that check silently discards the real reason
// and falls back to a generic message everywhere it was used. Use this
// instead of `e instanceof Error ? e.message : fallback` throughout the app.
export function getErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string'
  ) {
    return (e as { message: string }).message;
  }
  return fallback;
}
