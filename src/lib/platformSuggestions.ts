// THE SUGGESTIONS BOX (CEO's request, 5 Nov 2026; plan Drake/project-manager/tutor-recruitment-plan-2026-11-04.md section 8.5; database:
// supabase/migrations/20261105120000_platform_suggestions.sql). A signed-in person writes up to 1,000 characters on the learn dashboard; an admin reads
// them in the admin app. This file holds the words, the checks and the one write, and takes the database client as an argument so a test can hand in a
// fake (scripts/dev/platform-suggestions-test.ts). Named "platform" so it is never confused with SuggestionsGrid (the session-format cards) or with
// the subject suggestions in queries.ts.
//
// The database decides the rest: who wrote it (the person's own id), their role (read from their profile), the status ('new'), the trimmed text, and the
// limit of 5 in any 24 hours. The browser sends two columns only (user_id, body); the table refuses any other column. Nothing is read back: a person
// cannot read the table (the admin's internal note is on the same row). The text is only ever shown as plain text, never as HTML.

export const SUGGESTION_MAX_CHARS = 1000;
export const SUGGESTIONS_PER_DAY = 5;

export const SUGGESTION_COPY = {
  heading: 'Suggestions',
  intro: 'Something you would like Tutorlage to do, or do better? Tell us here.',
  label: 'Your suggestion',
  placeholder: 'Write your suggestion here',
  privacy: "Please don't include other people's personal details.",
  button: 'Send suggestion',
  sending: 'Sending…',
  thanks: 'Thank you. Your suggestion has been sent to the Tutorlage team.',
  another: 'Send another suggestion',
  empty: 'Please write your suggestion first.',
  tooLong: 'Please keep your suggestion to 1,000 characters or fewer.',
  limit: 'You can send up to 5 suggestions a day. Please try again tomorrow.',
  notOpen: 'Suggestions are not open yet. Please try again later.',
  failed: 'Could not send your suggestion. Check your connection and try again. What you wrote is still in the box.',
} as const;

// Characters as the database counts them (code points), not UTF-16 units, so an emoji is one character here too.
export function suggestionLength(text: string): number {
  return Array.from(text).length;
}

export function checkSuggestion(text: string): { ok: true; body: string } | { ok: false; message: string } {
  const body = text.trim();
  if (body.length === 0) return { ok: false, message: SUGGESTION_COPY.empty };
  if (suggestionLength(body) > SUGGESTION_MAX_CHARS) return { ok: false, message: SUGGESTION_COPY.tooLong };
  return { ok: true, body };
}

// The few things of the Supabase client used here, so a test can hand in a fake.
interface DbError { code?: string; message?: string }
export interface SuggestionClient {
  from(table: string): { insert(row: Record<string, unknown>): PromiseLike<{ error: DbError | null }> };
}

// What the person is told for each way the database can answer. The database's own two sentences about the text (code 22023) are already plain
// words and are used as they are; every other refusal gets the general sentence.
export function describeSuggestionError(err: DbError | null | undefined): string {
  const code = err?.code ?? '';
  const message = err?.message ?? '';
  if (code === '54000' || /up to 5 suggestions/i.test(message)) return SUGGESTION_COPY.limit;
  if (code === 'PGRST205' || code === '42P01' || (/platform_suggestions/i.test(message) && /(does not exist|schema cache|could not find)/i.test(message))) {
    return SUGGESTION_COPY.notOpen;
  }
  if (code === '22023' && /^Please /.test(message)) return message;
  return SUGGESTION_COPY.failed;
}

export type SendSuggestionResult = { ok: true } | { ok: false; message: string };

// Sends one suggestion as the signed-in person (`userId` is their own id: the database refuses any other). Never throws.
export async function sendSuggestion(db: SuggestionClient, userId: string, text: string): Promise<SendSuggestionResult> {
  const checked = checkSuggestion(text);
  if (!checked.ok) return checked;
  try {
    const { error } = await db.from('platform_suggestions').insert({ user_id: userId, body: checked.body });
    if (error) return { ok: false, message: describeSuggestionError(error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describeSuggestionError(err as DbError) };
  }
}
