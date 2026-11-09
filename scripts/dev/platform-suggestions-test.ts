// Checks on the SUGGESTIONS BOX of the learn page (CEO's request, 5 Nov 2026; plan section 8.5). Run: npx tsx scripts/dev/platform-suggestions-test.ts
// Proves, with a fake database client, rendered markup and by reading the source and the migration text: the words are the CEO's (one box, up to 1,000
// characters, "Send suggestion", a thank-you, "Please don't include other people's personal details."); the checks run before any call; the browser
// sends exactly two columns (user_id, body) to platform_suggestions and nothing else; every answer of the database becomes a plain sentence; what a
// person types is never rendered as HTML; the box sits just above the footer on the learn page, for a signed-in person only; the old grid's heading is
// now "Ways to learn" and nothing tests the old one; the client's constants and sentences equal the migration's; no new text says "free".
// It does NOT prove the database behaviour (supabase/tests/platform_suggestions.sql, rolled back) or the box in a real browser.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  SUGGESTIONS_PER_DAY, SUGGESTION_COPY, SUGGESTION_MAX_CHARS, checkSuggestion, describeSuggestionError, sendSuggestion, suggestionLength, type SuggestionClient,
} from '../../src/lib/platformSuggestions';
import { PlatformSuggestionBox } from '../../src/components/PlatformSuggestionBox';

const rootRequire = createRequire(new URL('../../package.json', import.meta.url));
const React = rootRequire('react') as typeof import('react');
const render = (rootRequire('react-dom/server') as typeof import('react-dom/server')).renderToStaticMarkup;

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MIGRATION = read('supabase/migrations/20261105120000_platform_suggestions.sql');

type Answer = { error: { code?: string; message?: string } | null };
// A fake client: records every insert and answers as scripted.
function fake(answer: () => Answer | Promise<Answer> = () => ({ error: null })) {
  const calls: { table: string; row: Record<string, unknown> }[] = [];
  const db: SuggestionClient = {
    from: (table: string) => ({ insert: async (row: Record<string, unknown>) => { calls.push({ table, row }); return answer(); } }),
  };
  return { db, calls };
}

async function main() {
  // ---- the words (the CEO's) ----
  check('the box is called Suggestions, has a "Send suggestion" button and the CEO\'s personal-details line',
    SUGGESTION_COPY.heading === 'Suggestions' && SUGGESTION_COPY.button === 'Send suggestion' && SUGGESTION_COPY.privacy === "Please don't include other people's personal details.");
  check('the limits are 1,000 characters and 5 a day', SUGGESTION_MAX_CHARS === 1000 && SUGGESTIONS_PER_DAY === 5);
  check('no sentence of the box says "free"', !/\bfree\b/i.test(Object.values(SUGGESTION_COPY).join(' ')));

  // ---- the checks run before any call ----
  check('an empty or blank text is refused in plain words', JSON.stringify(checkSuggestion('')) === JSON.stringify({ ok: false, message: SUGGESTION_COPY.empty }) && !checkSuggestion('  \n \t ').ok);
  check('a text is trimmed', JSON.stringify(checkSuggestion('  more tutors  ')) === JSON.stringify({ ok: true, body: 'more tutors' }));
  check('exactly 1,000 characters pass; 1,001 are refused in plain words', checkSuggestion('a'.repeat(1000)).ok && JSON.stringify(checkSuggestion('a'.repeat(1001))) === JSON.stringify({ ok: false, message: SUGGESTION_COPY.tooLong }));
  check('characters are counted as the database counts them: an emoji is one', suggestionLength('a😀b') === 3 && checkSuggestion('😀'.repeat(1000)).ok && !checkSuggestion('😀'.repeat(1001)).ok);

  // ---- the one write ----
  const a = fake();
  const sent = await sendSuggestion(a.db, 'user-1', '  Please add Afrikaans  ');
  check('a send inserts one row into platform_suggestions with exactly user_id and body (trimmed), nothing else',
    sent.ok && a.calls.length === 1 && a.calls[0].table === 'platform_suggestions' && JSON.stringify(Object.keys(a.calls[0].row).sort()) === JSON.stringify(['body', 'user_id'])
    && a.calls[0].row.user_id === 'user-1' && a.calls[0].row.body === 'Please add Afrikaans');
  const b = fake();
  const refused = await sendSuggestion(b.db, 'user-1', '   ');
  check('a blank text never reaches the database', !refused.ok && b.calls.length === 0);
  const c = fake();
  await sendSuggestion(c.db, 'user-1', 'x'.repeat(1001));
  check('a too-long text never reaches the database', c.calls.length === 0);

  // ---- every answer of the database becomes a plain sentence ----
  const answer = async (err: { code?: string; message?: string }) => (await sendSuggestion(fake(() => ({ error: err })).db, 'u', 'hello')) as { ok: false; message: string };
  check('the 5-a-day refusal (code 54000) says so in plain words', (await answer({ code: '54000', message: 'You can send up to 5 suggestions a day. Please try again tomorrow.' })).message === SUGGESTION_COPY.limit);
  check('the same refusal is recognised by its words when the code is lost', describeSuggestionError({ message: 'You can send up to 5 suggestions a day. Please try again tomorrow.' }) === SUGGESTION_COPY.limit);
  check('a database without the table says suggestions are not open yet (PGRST205, 42P01, or the words)',
    describeSuggestionError({ code: 'PGRST205' }) === SUGGESTION_COPY.notOpen && describeSuggestionError({ code: '42P01' }) === SUGGESTION_COPY.notOpen
    && describeSuggestionError({ message: "Could not find the table 'public.platform_suggestions' in the schema cache" }) === SUGGESTION_COPY.notOpen);
  check('the database\'s own two plain sentences about the text are shown as they are',
    describeSuggestionError({ code: '22023', message: 'Please write your suggestion first.' }) === 'Please write your suggestion first.'
    && describeSuggestionError({ code: '22023', message: 'Please keep your suggestion to 1,000 characters or fewer.' }) === 'Please keep your suggestion to 1,000 characters or fewer.');
  check('any other refusal shows the general sentence, never raw database words',
    (await answer({ code: '42501', message: 'new row violates row-level security policy for table "platform_suggestions" secret_detail' })).message === SUGGESTION_COPY.failed
    && describeSuggestionError({ code: '22023', message: 'internal detail' }) === SUGGESTION_COPY.failed && describeSuggestionError(null) === SUGGESTION_COPY.failed);
  const thrown = await sendSuggestion({ from: () => ({ insert: () => { throw new Error('Failed to fetch'); } }) }, 'u', 'hello');
  check('a network failure (a throw) is the general sentence, "what you wrote is still in the box"', 'message' in thrown && thrown.message === SUGGESTION_COPY.failed && /still in the box/.test(SUGGESTION_COPY.failed));

  // ---- the box, drawn ----
  const noop = fake().db;
  const draw = (props: Partial<{ initialText: string; initialStatus: 'writing' | 'sent'; initialError: string | null }> = {}) =>
    render(React.createElement(PlatformSuggestionBox, { userId: 'u1', client: noop, ...props }));
  const empty = draw();
  check('the empty box: heading, one text box limited to 1,000, the personal-details line, a counter, and a Send button that waits for a text',
    /<h2[^>]*>Suggestions<\/h2>/.test(empty) && (empty.match(/<textarea/g) ?? []).length === 1 && /maxLength="1000"|maxlength="1000"/i.test(empty)
    && empty.includes("Please don&#x27;t include other people&#x27;s personal details.") && />0 \/ 1000</.test(empty.replace(/<!-- -->/g, '')) && /<button[^>]*disabled=""[^>]*>Send suggestion<\/button>/.test(empty));
  check('a box with a text has a Send button that is ready', /<button(?![^>]*disabled="")[^>]*>Send suggestion<\/button>/.test(draw({ initialText: 'More subjects please' })));
  const thanks = draw({ initialStatus: 'sent' });
  check('after a send: the thank-you, no text box, a way to send another', /role="status"/.test(thanks) && thanks.includes('Thank you. Your suggestion has been sent to the Tutorlage team.') && !/<textarea/.test(thanks) && thanks.includes('Send another suggestion'));
  const withError = draw({ initialText: 'My long idea', initialError: SUGGESTION_COPY.limit });
  check('a refusal shows in an alert and the text stays in the box', /role="alert"/.test(withError) && withError.includes('You can send up to 5 suggestions a day.') && withError.includes('My long idea'));
  const nasty = draw({ initialText: '<script>alert(1)</script><img src=x onerror=alert(2)>' });
  check('what a person types is never rendered as HTML: tags are escaped', !/<script>alert/.test(nasty) && !/<img src=x/.test(nasty) && nasty.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  const boxSource = code('src/components/PlatformSuggestionBox.tsx');
  check('the box never uses dangerouslySetInnerHTML or innerHTML', !/dangerouslySetInnerHTML|innerHTML/.test(boxSource + code('src/lib/platformSuggestions.ts')));
  check('the box keeps the text when a send fails and clears it only on success', /if \('message' in result\) \{\s*setError\(result\.message\);\s*setStatus\('writing'\);\s*\} else \{\s*setText\(''\);/.test(boxSource));
  check('a second tap while a send is running is ignored (one send at a time)', /if \(sendingRef\.current\) return;/.test(boxSource));
  check('the box does not import the database client itself (so it loads under Node); the app binds it in lib/suggestionDb.ts',
    !/supabaseClient/.test(boxSource) && /supabase as unknown as SuggestionClient/.test(code('src/lib/suggestionDb.ts')));

  // ---- where it sits ----
  const app = code('src/App.tsx');
  const footerAt = app.indexOf('<Footer />');
  const boxAt = app.indexOf('<PlatformSuggestionBox');
  check('the page imports the box and draws it just above the footer', /import \{ PlatformSuggestionBox \} from '\.\/components\/PlatformSuggestionBox';/.test(app) && boxAt > 0 && footerAt > boxAt && app.slice(boxAt, footerAt).replace(/\s+/g, ' ').length < 700);
  check('only for a signed-in person, and only on the learn page (the home view) and the Teach page (the teach view; both sides since 9 Nov), not on the wallet, sessions, prices, tiers or about screens',
    /\{\(view === 'home' \|\| view === 'teach'\) && user && \(/.test(app.slice(Math.max(0, boxAt - 600), boxAt + 100)) && /userId=\{user\.id\}/.test(app.slice(boxAt, boxAt + 200)) && /client=\{suggestionDb\}/.test(app.slice(boxAt, boxAt + 200)));
  const grid = code('src/components/SuggestionsGrid.tsx');
  check('the old five-card grid is now headed "Ways to learn", and its old "Suggestions" heading is gone', />\s*Ways to learn\s*</.test(grid) && !/<h2[^>]*>\s*Suggestions\s*<\/h2>/.test(grid));
  const specs = ['a11y', 'free-sessions', 'perf', 'sa-time', 'signed-in', 'smoke', 'states', 'wallet'].map((n) => read(`tests/browser/${n}.spec.ts`)).join('\n');
  check('no browser test looks for the old "Suggestions" heading', !/Suggestions/.test(specs));

  // ---- the client and the migration agree ----
  const grant = /grant insert \(([^)]*)\) on public\.platform_suggestions to authenticated/.exec(MIGRATION);
  check('the columns the browser sends are exactly the columns the migration lets a person insert', !!grant && grant[1].split(',').map((s) => s.trim()).sort().join() === 'body,user_id');
  check('the migration\'s limit is the client\'s: 5 in any 24 hours, 1,000 characters', /c_limit constant integer := 5;/.test(MIGRATION) && /interval '24 hours'/.test(MIGRATION) && /char_length\(body\) between 1 and 1000/.test(MIGRATION));
  const sentences = [SUGGESTION_COPY.empty, SUGGESTION_COPY.tooLong, SUGGESTION_COPY.limit];
  check('the three sentences the database raises are word for word the ones the box shows', sentences.every((s) => MIGRATION.includes(`'${s}'`)), sentences.filter((s) => !MIGRATION.includes(`'${s}'`)).join(' | '));
  check('the table is named platform_suggestions and the send never asks for a row back (a person cannot read the table)', /from\('platform_suggestions'\)\.insert\(\{ user_id: userId, body: checked\.body \}\)/.test(code('src/lib/platformSuggestions.ts')) && !/\.select\(/.test(code('src/lib/platformSuggestions.ts')));

  // ---- new text ----
  const newText = [boxSource, code('src/lib/platformSuggestions.ts'), grid].join('\n');
  check('nothing new offers "free" lessons or sessions', !/\bfree\b/i.test(newText));

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
