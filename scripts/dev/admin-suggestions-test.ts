// Checks on the ADMIN SUGGESTIONS PAGE (CEO's request, 5 Nov 2026; plan section 8.5). Run: npx tsx scripts/dev/admin-suggestions-test.ts
// Proves, with a fake database client, rendered markup and by reading the source and the migration text: the list is read with named columns, newest first,
// with the person's name and role and the admin's name; the page opens cleanly BEFORE the migration is applied (a missing table is "no suggestions yet",
// a missing function a plain sentence, the menu count 0); filters and counts by status; the one write is the function admin_handle_suggestion with the
// argument names the migration defines, the note is trimmed and capped before any call; what people wrote is printed as plain text (never HTML); the menu
// has the page, and the unread count; no new text says "free".
// It does NOT prove the database behaviour (supabase/tests/platform_suggestions.sql, rolled back) or the page in a real browser.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  COUNT_EVERY_MS, LIST_LIMIT, NOTE_MAX_CHARS, SUGGESTIONS_NOT_ON_YET, SUGGESTION_STATUSES,
  countNewSuggestions, countsByStatus, describeAgo, fetchSuggestions, filterSuggestions, handleSuggestion, isMissingSuggestions, mapSuggestion,
  type SuggestionRow, type SuggestionsClient, type SuggestionsResult,
} from '../../admin/src/lib/suggestions';
import { SuggestionsBody } from '../../admin/src/components/SuggestionsBody';

const adminRequire = createRequire(new URL('../../admin/package.json', import.meta.url));
const React = adminRequire('react') as typeof import('react');
const render = (adminRequire('react-dom/server') as typeof import('react-dom/server')).renderToStaticMarkup;

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const MIGRATION = read('supabase/migrations/20261105120000_platform_suggestions.sql');

type Err = { code?: string; message?: string };
interface Calls { selects: string[]; orders: unknown[]; limits: number[]; eqs: unknown[][]; rpcs: { fn: string; args: Record<string, unknown> | undefined }[]; tables: string[] }
function fake(opts: { data?: unknown; error?: Err | null; count?: number | null; rpcError?: Err | null; throws?: boolean } = {}): { db: SuggestionsClient; calls: Calls } {
  const calls: Calls = { selects: [], orders: [], limits: [], eqs: [], rpcs: [], tables: [] };
  const db: SuggestionsClient = {
    from: (table: string) => {
      calls.tables.push(table);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      b.select = (cols: string, o?: unknown) => { calls.selects.push(`${cols}${o ? ' ' + JSON.stringify(o) : ''}`); return b; };
      b.order = (...a: unknown[]) => { calls.orders.push(a); return b; };
      b.limit = (n: number) => { calls.limits.push(n); return b; };
      b.eq = (...a: unknown[]) => { calls.eqs.push(a); return b; };
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        (opts.throws ? Promise.reject(new Error('Failed to fetch')) : Promise.resolve({ data: opts.data ?? [], error: opts.error ?? null, count: opts.count ?? null })).then(res, rej);
      return b;
    },
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.rpcs.push({ fn, args });
      if (opts.throws) throw new Error('Failed to fetch');
      return { data: { ok: true }, error: opts.rpcError ?? null };
    },
  };
  return { db, calls };
}

const raw = (over: Record<string, unknown> = {}) => ({
  id: 'a', user_id: 'u1', role: 'student', body: 'More Afrikaans', status: 'new', admin_note: null,
  created_at: '2026-11-05T10:00:00Z', handled_at: null, handled_by: null,
  profiles: { full_name: 'Lee Learner' }, admin_profiles: null, ...over,
});
const row = (over: Partial<SuggestionRow> = {}): SuggestionRow => ({
  id: 'a', userId: 'u1', name: 'Lee Learner', role: 'student', body: 'More Afrikaans', status: 'new', note: '', createdAt: '2026-11-05T10:00:00Z', handledAt: null, handledBy: null, ...over,
});

async function main() {
  // ---- reading the list ----
  const list = fake({
    data: [
      raw({ id: 'old', created_at: '2026-11-04T08:00:00Z', role: 'parent', profiles: [{ full_name: 'Pat Parent' }], body: 'Older one' }),
      raw({ id: 'new', created_at: '2026-11-05T10:00:00Z', status: 'planned', admin_note: 'after exams', handled_at: '2026-11-05T11:00:00Z', handled_by: 'adm', admin_profiles: { first_name: 'Sam', surname: 'Support' } }),
      raw({ id: 'odd', created_at: '2026-11-05T09:00:00Z', status: 'banana', profiles: null, role: 'tutor' }),
    ],
  });
  const res = await fetchSuggestions(list.db);
  const rows = res.state === 'ok' ? res.rows : [];
  check('the list is read from platform_suggestions with named columns (never select *), the person\'s name and the admin\'s name through the two named foreign keys, newest first, 300 at most',
    list.calls.tables[0] === 'platform_suggestions' && !/select \*|^\*/.test(list.calls.selects[0]) && /profiles!platform_suggestions_user_id_fkey \( full_name \)/.test(list.calls.selects[0])
    && /admin_profiles!platform_suggestions_handled_by_fkey \( first_name, surname \)/.test(list.calls.selects[0]) && JSON.stringify(list.calls.orders[0]) === JSON.stringify(['created_at', { ascending: false }]) && list.calls.limits[0] === LIST_LIMIT && LIST_LIMIT === 300);
  check('the two foreign key names it asks for exist in the migration', /constraint platform_suggestions_user_id_fkey foreign key \(user_id\) references public\.profiles/.test(MIGRATION) && /constraint platform_suggestions_handled_by_fkey foreign key \(handled_by\) references public\.admin_profiles/.test(MIGRATION));
  check('every column it selects is a column of the table', ['id', 'user_id', 'role', 'body', 'status', 'admin_note', 'created_at', 'handled_at', 'handled_by'].every((c) => new RegExp(`^  ${c} `, 'm').test(MIGRATION.slice(MIGRATION.indexOf('create table if not exists public.platform_suggestions')))));
  check('rows come back newest first whatever order they arrived in', rows.map((r) => r.id).join() === 'new,odd,old');
  check('the person\'s name reads from an object or a one-item list; no profile reads "Someone"; an odd status counts as new', rows.find((r) => r.id === 'old')?.name === 'Pat Parent' && rows.find((r) => r.id === 'new')?.name === 'Lee Learner' && rows.find((r) => r.id === 'odd')?.name === 'Someone' && rows.find((r) => r.id === 'odd')?.status === 'new');
  const handled = rows.find((r) => r.id === 'new');
  check('the note, who handled it and when are carried over', handled?.note === 'after exams' && handled?.handledBy === 'Sam Support' && handled?.handledAt === '2026-11-05T11:00:00Z' && rows.find((r) => r.id === 'old')?.handledBy === null);
  check('mapSuggestion survives a row of nonsense', mapSuggestion({}).name === 'Someone' && mapSuggestion({}).status === 'new' && mapSuggestion({}).body === '');

  // ---- before the migration is applied ----
  const missingTable = await fetchSuggestions(fake({ error: { code: 'PGRST205', message: "Could not find the table 'public.platform_suggestions' in the schema cache" } }).db);
  check('a database without the table: "not set up", not an error', missingTable.state === 'not_set_up');
  check('a missing table is recognised by Postgres\'s code, by PostgREST\'s code, and by words alone', isMissingSuggestions({ code: '42P01' }) && isMissingSuggestions({ code: 'PGRST205' }) && isMissingSuggestions({ code: 'PGRST202' }) && isMissingSuggestions({ code: '42883' })
    && isMissingSuggestions({ message: 'relation "public.platform_suggestions" does not exist' }) && isMissingSuggestions({ message: 'Could not find the function public.admin_handle_suggestion(p_id) in the schema cache' }) && !isMissingSuggestions({ code: '42501', message: 'permission denied' }) && !isMissingSuggestions(null));
  const failedRead = await fetchSuggestions(fake({ error: { code: '42501', message: 'permission denied for table platform_suggestions' } }).db);
  check('any other error is "failed" with the reason, so it is not mistaken for an empty list', failedRead.state === 'failed' && /permission denied/.test(failedRead.message));
  const thrownRead = await fetchSuggestions(fake({ throws: true }).db);
  check('a thrown error (the network) is "failed", never a crash', thrownRead.state === 'failed');
  check('an empty table is an empty list', JSON.stringify(await fetchSuggestions(fake({ data: [] }).db)) === JSON.stringify({ state: 'ok', rows: [] }));

  // ---- the number on the menu ----
  const cnt = fake({ count: 4 });
  check('the menu count asks for suggestions whose status is new, without reading any rows (head count)', await countNewSuggestions(cnt.db) === 4 && cnt.calls.tables[0] === 'platform_suggestions' && /"head":true/.test(cnt.calls.selects[0]) && /"count":"exact"/.test(cnt.calls.selects[0]) && JSON.stringify(cnt.calls.eqs[0]) === JSON.stringify(['status', 'new']));
  check('before the migration, on any error, on a throw, or on an odd count, the menu count is 0',
    await countNewSuggestions(fake({ error: { code: 'PGRST205' } }).db) === 0 && await countNewSuggestions(fake({ error: { code: '42501' } }).db) === 0 && await countNewSuggestions(fake({ throws: true }).db) === 0
    && await countNewSuggestions(fake({ count: null }).db) === 0 && await countNewSuggestions(fake({ count: -3 }).db) === 0);

  // ---- counts and filters ----
  const mixed = [row({ id: '1', status: 'new' }), row({ id: '2', status: 'new' }), row({ id: '3', status: 'planned' }), row({ id: '4', status: 'done' }), row({ id: '5', status: 'dismissed' })];
  check('counts by status, and "all"', JSON.stringify(countsByStatus(mixed)) === JSON.stringify({ all: 5, new: 2, read: 0, planned: 1, done: 1, dismissed: 1 }));
  check('the filter keeps the order and shows only that status; "all" shows everything', filterSuggestions(mixed, 'new').map((r) => r.id).join() === '1,2' && filterSuggestions(mixed, 'read').length === 0 && filterSuggestions(mixed, 'all').length === 5);
  check('the five statuses are the migration\'s five', SUGGESTION_STATUSES.join() === 'new,read,planned,done,dismissed' && /status in \('new', 'read', 'planned', 'done', 'dismissed'\)/.test(MIGRATION));

  // ---- the one write ----
  const w = fake();
  const saved = await handleSuggestion(w.db, 'abc', 'planned', '  Do after exams  ');
  check('saving calls admin_handle_suggestion with the status and the trimmed note, and nothing else; null means saved',
    saved === null && w.calls.rpcs.length === 1 && w.calls.rpcs[0].fn === 'admin_handle_suggestion' && JSON.stringify(w.calls.rpcs[0].args) === JSON.stringify({ p_id: 'abc', p_status: 'planned', p_note: 'Do after exams' }) && w.calls.tables.length === 0);
  const fnParams = /create or replace function public\.admin_handle_suggestion\(([^)]*)\)/.exec(MIGRATION)?.[1].split(',').map((s) => s.trim().split(/\s+/)[0]).join();
  check('the argument names are the ones the migration defines', fnParams === 'p_id,p_status,p_note', String(fnParams));
  check('the page writes through that function only: no update, insert or delete on the table from the admin app', !/\.(update|insert|delete|upsert)\(/.test(code('admin/src/lib/suggestions.ts') + code('admin/src/pages/Suggestions.tsx') + code('admin/src/components/SuggestionsBody.tsx') + code('admin/src/components/SuggestionsNavBadge.tsx')));
  const longNote = fake();
  check('a note over 1,000 characters is refused before any call, in words', await handleSuggestion(longNote.db, 'abc', 'read', 'n'.repeat(NOTE_MAX_CHARS + 1)) === 'The note can be 1,000 characters at most.' && longNote.calls.rpcs.length === 0);
  check('exactly 1,000 characters go through', await handleSuggestion(fake().db, 'abc', 'read', 'n'.repeat(NOTE_MAX_CHARS)) === null);
  check('before the migration the save says so in plain words', await handleSuggestion(fake({ rpcError: { code: 'PGRST202', message: 'Could not find the function public.admin_handle_suggestion in the schema cache' } }).db, 'abc', 'read', '') === SUGGESTIONS_NOT_ON_YET);
  check('the database\'s own refusal is shown (for example a switched-off admin)', await handleSuggestion(fake({ rpcError: { code: '42501', message: 'Only an active admin can handle suggestions' } }).db, 'abc', 'read', '') === 'Only an active admin can handle suggestions');
  check('a thrown error (the network) comes back as a sentence, not a crash', typeof await handleSuggestion(fake({ throws: true }).db, 'abc', 'read', '') === 'string');

  // ---- the page, drawn ----
  const noop = () => undefined;
  const body = (result: SuggestionsResult | null, over: Partial<Parameters<typeof SuggestionsBody>[0]> = {}) =>
    render(React.createElement(SuggestionsBody, { result, filter: 'all', onFilter: noop, busyId: null, error: null, onHandle: noop, onRetry: noop, ...over }));
  check('loading', /Loading suggestions/.test(body(null)));
  const notYet = body({ state: 'not_set_up' });
  check('before the migration: a calm "No suggestions yet" with the reason, no alert, no error', /data-suggestions-not-set-up/.test(notYet) && notYet.includes('No suggestions yet') && notYet.includes(SUGGESTIONS_NOT_ON_YET) && !/role="alert"/.test(notYet));
  const failedView = body({ state: 'failed', message: 'permission denied' });
  check('a failed read shows the reason and a Try again button', /role="alert"/.test(failedView) && failedView.includes('permission denied') && failedView.includes('Try again'));
  const emptyView = body({ state: 'ok', rows: [] });
  check('an empty list says where suggestions come from', emptyView.includes('No suggestions yet') && emptyView.includes('Suggestions box on the learn page'));
  const people: SuggestionRow[] = [
    row({ id: '1', name: 'Lee Learner', role: 'student', body: 'More Afrikaans', status: 'new' }),
    row({ id: '2', name: 'Pat Parent', role: 'parent', body: 'A 2027 booster', status: 'planned', note: 'after exams', handledAt: '2026-11-05T11:00:00Z', handledBy: 'Sam Support' }),
    row({ id: '3', name: 'Tess Tutor', role: 'tutor', body: 'Message my learners', status: 'done' }),
  ];
  const listView = body({ state: 'ok', rows: people });
  check('each suggestion shows who (name and role), when, the text and its status', ['Lee Learner', 'Pat Parent', 'Tess Tutor', 'Learner', 'Parent', 'Tutor', 'More Afrikaans', 'A 2027 booster', 'Message my learners'].every((s) => listView.includes(s)) && (listView.match(/data-suggestion=/g) ?? []).length === 3 && /ago\)/.test(listView));
  check('the status filter is a row of tabs with a count each: All (3), New (1), Read (0), Planned (1), Done (1), Dismissed (0)',
    ['All (3)', 'New (1)', 'Read (0)', 'Planned (1)', 'Done (1)', 'Dismissed (0)'].every((s) => listView.replace(/<!-- -->/g, '').includes(s)) && /role="tablist"/.test(listView));
  check('the chosen filter shows only those', (body({ state: 'ok', rows: people }, { filter: 'planned' }).match(/data-suggestion=/g) ?? []).length === 1 && (body({ state: 'ok', rows: people }, { filter: 'read' }).match(/data-suggestion=/g) ?? []).length === 0 && /No read suggestions/.test(body({ state: 'ok', rows: people }, { filter: 'read' })));
  check('a handled one shows the internal note, who handled it and when', listView.includes('after exams') && listView.includes('by Sam Support') && listView.includes('Internal note (the person never sees it)'));
  const newCard = body({ state: 'ok', rows: [people[0]] });
  check('a new suggestion offers Mark read, Planned, Done and Dismiss (not "Back to new" and not "Save note" until the note changes)',
    ['Mark read', 'Planned', 'Done', 'Dismiss'].every((s) => newCard.includes(`>${s}<`)) && !newCard.includes('Back to new') && !newCard.includes('Save note'));
  check('a handled suggestion offers Back to new', body({ state: 'ok', rows: [people[2]] }).includes('Back to new'));
  check('a save in progress shows on that card only (its buttons wait)', /disabled=""[^>]*>Mark read/.test(body({ state: 'ok', rows: [people[0]] }, { busyId: '1' })) && !/disabled=""[^>]*>Mark read/.test(body({ state: 'ok', rows: [people[0]] }, { busyId: 'zzz' })));
  check('the last save\'s refusal shows above the list', /role="alert"[^>]*>Only an active admin/.test(body({ state: 'ok', rows: people }, { error: 'Only an active admin can handle suggestions' })));
  const hostile = body({ state: 'ok', rows: [row({ body: '<script>alert(1)</script><img src=x onerror=alert(2)>', name: '<b>Eve</b>', note: '<i>hidden</i>' })] });
  check('what people wrote, their names and the notes are printed as plain text: tags are escaped', !/<script>alert/.test(hostile) && !/<img src=x/.test(hostile) && !/<b>Eve/.test(hostile) && !/<i>hidden/.test(hostile) && hostile.includes('&lt;script&gt;'));
  check('none of the new admin files uses dangerouslySetInnerHTML or innerHTML', !/dangerouslySetInnerHTML|innerHTML/.test(['admin/src/lib/suggestions.ts', 'admin/src/pages/Suggestions.tsx', 'admin/src/components/SuggestionsBody.tsx', 'admin/src/components/SuggestionsNavBadge.tsx'].map(code).join('\n')));
  check('"3 min ago", "5 h ago", "4 days ago"', describeAgo('2026-11-05T11:57:00Z', new Date('2026-11-05T12:00:00Z')) === '3 min ago' && describeAgo('2026-11-05T07:00:00Z', new Date('2026-11-05T12:00:00Z')) === '5 h ago' && describeAgo('2026-11-01T12:00:00Z', new Date('2026-11-05T12:00:00Z')) === '4 days ago');

  // ---- the menu and the route ----
  const layout = code('admin/src/components/AdminLayout.tsx');
  const router = code('admin/src/App.tsx');
  check('the menu has a Suggestions item for support agents and super admins, with the unread count beside it', /\{ to: '\/suggestions', label: 'Suggestions', icon: \w+, roles: \['support_agent', 'super_admin'\][^}]*\}/.test(layout) && /SuggestionsNavBadge/.test(layout));
  check('the router has the /suggestions page', /import \{ Suggestions \} from '\.\/pages\/Suggestions';/.test(router) && /<Route path="suggestions" element=\{<Suggestions \/>\} \/>/.test(router));
  const badge = code('admin/src/components/SuggestionsNavBadge.tsx');
  check('the menu count reads again every minute, on coming back to the window, and when a suggestion is handled; it draws nothing for 0', COUNT_EVERY_MS === 60_000 && /setInterval\(read, COUNT_EVERY_MS\)/.test(badge) && /addEventListener\('focus', read\)/.test(badge) && /SUGGESTIONS_CHANGED_EVENT, read/.test(badge) && /if \(count <= 0\) return null;/.test(badge) && /dispatchEvent\(new Event\(SUGGESTIONS_CHANGED_EVENT\)\)/.test(code('admin/src/pages/Suggestions.tsx')));

  // ---- new text ----
  check('nothing new offers "free" lessons or sessions', !/\bfree\b/i.test(['admin/src/lib/suggestions.ts', 'admin/src/pages/Suggestions.tsx', 'admin/src/components/SuggestionsBody.tsx', 'admin/src/components/SuggestionsNavBadge.tsx'].map(code).join('\n')));

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
