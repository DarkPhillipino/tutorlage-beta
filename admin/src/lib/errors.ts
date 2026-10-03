// Supabase's real errors (Postgrest, Auth, Storage) are plain objects with a
// `message` string property, not Error instances — `e instanceof Error` is
// false for them, which hid the database's actual reason (e.g. "Record the
// tutor's date of birth before verifying them") behind a generic message.
// Same helper as the main app's src/lib/errors.ts.
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
