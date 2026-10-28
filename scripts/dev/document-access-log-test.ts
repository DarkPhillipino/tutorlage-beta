// Checks that the admin app records every document opening before it makes a link (legal flag H4, migration 20261021100000).
// Run: npx tsx scripts/dev/document-access-log-test.ts
// The database half is proved by supabase/tests/document_access_log.sql (rolled back). This checks the admin side with a fake client:
// the order (record, then link), what happens when the log function is missing (opens, says so), refused or broken (opens nothing),
// and that no admin file makes a link any other way.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ACCESS_LOG_NOT_ACTIVE_NOTE, DocumentClient, openStoredDocument } from '../../admin/src/lib/documentAccess';
import { DocumentAccessCardBody } from '../../admin/src/components/DocumentAccessCardBody';
import { HOLD_NOT_ACTIVE, HoldClient, fetchDocumentAccessView, placeSafetyHold, releaseSafetyHold } from '../../admin/src/lib/safetyHold';

// The admin screens load the admin app's own copy of React, so they are rendered with that copy (two copies in one render break hooks).
const adminRequire = createRequire(new URL('../../admin/package.json', import.meta.url));
const React = adminRequire('react') as typeof import('react');
const { renderToStaticMarkup } = adminRequire('react-dom/server') as typeof import('react-dom/server');

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8');

type Err = { code?: string; message?: string } | null;
function fake(logError: Err, signError: Err = null) {
  const calls: string[] = [];
  const rpcArgs: Record<string, unknown>[] = [];
  const client: DocumentClient = {
    rpc: async (fn, args) => { calls.push(`rpc:${fn}`); rpcArgs.push(args); return { data: logError ? null : 'row-id', error: logError }; },
    storage: { from: (bucket) => ({ createSignedUrl: async (path, seconds) => {
      calls.push(`sign:${bucket}:${path}:${seconds}`);
      return signError ? { data: null, error: signError } : { data: { signedUrl: `https://files.example.invalid/${path}?t=1` }, error: null };
    } }) },
  };
  return { client, calls, rpcArgs };
}
async function run(f: ReturnType<typeof fake>, bucket: 'tutor-documents' | 'school-results', path: string, options = {}) {
  try { return { ok: await openStoredDocument(f.client, bucket, path, options), error: null as string | null }; }
  catch (e) { return { ok: null, error: (e as Error).message }; }
}
const TUTOR = '3f2b8a54-1111-4222-8333-444455556666';
const FILE = `${TUTOR}/police.pdf`;

async function main() {
  // ---- the normal path ----
  const a = fake(null);
  const ra = await run(a, 'tutor-documents', FILE);
  check('a document is recorded first and the link is made second, for a five-minute link', JSON.stringify(a.calls) === JSON.stringify(['rpc:log_document_access', `sign:tutor-documents:${FILE}:300`]), a.calls.join(' > '));
  check('the record names the store, the path and the action "opened", and no subject for a stored file',
    a.rpcArgs[0]?.p_bucket === 'tutor-documents' && a.rpcArgs[0]?.p_path === FILE && a.rpcArgs[0]?.p_action === 'opened' && a.rpcArgs[0]?.p_subject === null);
  check('a recorded opening gives the link and logged = true', ra.ok?.logged === true && ra.ok.url.startsWith('https://files.example.invalid/'));

  const a2 = fake(null);
  await run(a2, 'school-results', `${TUTOR}/report.pdf`, { action: 'downloaded' });
  check('the action "downloaded" is passed through, and school results use their own store', a2.rpcArgs[0]?.p_action === 'downloaded' && a2.rpcArgs[0]?.p_bucket === 'school-results' && a2.calls[1]?.startsWith('sign:school-results:'));

  // ---- the log function is not on this database yet (dev before the migration) ----
  for (const err of [{ code: 'PGRST202', message: 'Could not find the function public.log_document_access(...) in the schema cache' }, { code: '42883', message: 'function public.log_document_access does not exist' }]) {
    const m = fake(err);
    const rm = await run(m, 'tutor-documents', FILE);
    check(`when the function is missing (${err.code}) the document still opens, in that order, and logged = false`, rm.ok?.logged === false && !!rm.ok.url && m.calls.length === 2 && m.calls[0] === 'rpc:log_document_access');
  }
  check('the note shown in that case says the access log is not active on this database and that the opening was NOT recorded',
    /access log is not active on this database/.test(ACCESS_LOG_NOT_ACTIVE_NOTE) && /NOT recorded/.test(ACCESS_LOG_NOT_ACTIVE_NOTE));

  // ---- the log function refuses or breaks: nothing is opened ----
  for (const [label, err] of [
    ['an admin who is switched off', { code: '42501', message: 'Admins only' }],
    ['a file that does not exist', { code: 'P0002', message: 'No such stored document' }],
    ['a dropped connection', { code: '', message: 'TypeError: Failed to fetch' }],
    ['a server error', { code: '57014', message: 'canceling statement due to statement timeout' }],
  ] as const) {
    const x = fake(err);
    const rx = await run(x, 'tutor-documents', FILE);
    check(`${label}: no link is made and the admin is told the opening was not recorded`, rx.ok === null && /could not be recorded/.test(rx.error ?? '') && x.calls.length === 1, `${rx.error} | ${x.calls.join(',')}`);
  }
  const adminsOnly = await run(fake({ code: '42501', message: 'Admins only' }), 'tutor-documents', FILE);
  check('a refusal for a non-admin says so in plain words', /only active admins can open documents/.test(adminsOnly.error ?? ''), adminsOnly.error ?? '');

  // ---- the link cannot be made after a recorded opening ----
  const s = fake(null, { message: 'Object not found' });
  const rs = await run(s, 'tutor-documents', FILE);
  check('if Storage refuses after the record, the admin sees the old "could not open" message (the opening stays recorded)', rs.error === 'Could not open this document — check your admin access.' && s.calls.length === 2);

  // ---- a web address kept as a document ----
  const l0 = fake(null);
  const rl0 = await run(l0, 'tutor-documents', 'https://www.superprof.co.za/tutor/x');
  check('a web address without saying whose it is is refused before anything is recorded or opened', rl0.error !== null && l0.calls.length === 0);
  const l1 = fake(null);
  const rl1 = await run(l1, 'tutor-documents', 'https://www.superprof.co.za/tutor/x', { subject: TUTOR });
  check('a web address is recorded with the tutor named, then opened as it is (no Storage link)', rl1.ok?.url === 'https://www.superprof.co.za/tutor/x' && rl1.ok.logged && l1.calls.length === 1 && l1.rpcArgs[0]?.p_subject === TUTOR);
  const l2 = fake({ code: 'PGRST202', message: 'x' });
  const rl2 = await run(l2, 'tutor-documents', 'https://www.superprof.co.za/tutor/x', { subject: TUTOR });
  check('a web address on a database with no log still opens, and says it was not recorded', rl2.ok?.logged === false && rl2.ok.url.startsWith('https://'));

  // ---- no admin file makes a link any other way ----
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (name === 'node_modules' || name === 'dist') continue;
      if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  };
  const adminFiles = walk('admin/src');
  const signers = adminFiles.filter((f) => /createSignedUrls?\(/.test(read(f)));
  check('in the admin app only documentAccess.ts calls createSignedUrl', signers.length === 1 && /documentAccess\.ts$/.test(signers[0]), signers.join(', '));
  const openers = adminFiles.filter((f) => /openStoredDocument\(/.test(read(f)));
  check('the three places that open a stored file go through openStoredDocument (verification detail, Tier 1, school results)',
    ['TutorVerificationDetail.tsx', 'tier1.ts', 'schoolResults.ts'].every((n) => openers.some((f) => f.endsWith(n))), openers.join(', '));
  for (const page of ['admin/src/pages/TutorVerificationDetail.tsx', 'admin/src/pages/Tier1.tsx', 'admin/src/pages/SchoolResults.tsx']) {
    const src = read(page);
    check(`${page.split('/').pop()} shows the "not active" note and does not open a link itself`, /<AccessLogNote show=\{logNotActive\} \/>/.test(src) && /setLogNotActive\(!opened\.logged\)/.test(src) && !/window\.open\((await |path)/.test(src));
  }
  check('nothing in the admin app creates the old per-page signed-URL helpers any more', !adminFiles.some((f) => /signedTutorDocumentUrl|signedSchoolResultUrl/.test(read(f))));

  // ---- the migration says what the app relies on ----
  const mig = read('supabase/migrations/20261021100000_document_access_log.sql');
  check('the migration: definer function with a pinned search path, API rights only for signed-in users, admin check first',
    /security definer\s+set search_path = public/.test(mig) && /revoke all on function public\.log_document_access\(text, text, text, uuid\) from public, anon, authenticated;\s*grant execute on function public\.log_document_access\(text, text, text, uuid\) to authenticated;/.test(mig)
    && /if v_admin is null or not public\.is_active_admin\(\) then\s+raise exception 'Admins only'/.test(mig));
  check('the migration: the table is insert-only (no write rights, admin read policy, a trigger on update, delete and truncate)',
    /revoke all on public\.document_access_log from public, anon, authenticated, service_role;\s*grant select on public\.document_access_log to authenticated;/.test(mig)
    && /create policy "Admins read the document access log"[^;]*is_active_admin\(\)/.test(mig) && /before update or delete on public\.document_access_log/.test(mig) && /before truncate on public\.document_access_log/.test(mig));
  check('the migration: who and when come from the database (no admin or time argument)', !/p_admin|p_time|p_created/.test(mig));
  check('the log keeps who (id, and name and email that day), whose, which file (path, type, row id) and when (the database clock)',
    /admin_id uuid not null/.test(mig) && /admin_label text/.test(mig) && /subject_id uuid not null/.test(mig) && /document_path text not null/.test(mig)
    && /document_id uuid/.test(mig) && /document_type text/.test(mig) && /created_at timestamptz not null default now\(\)/.test(mig));
  check('only the retention job can delete a line: its flag is set inside a definer function, the trigger honours it for DELETE only, and the job is scheduled daily',
    /tg_op = 'DELETE' and coalesce\(current_setting\('tutorlage\.purging_document_log', true\), ''\) = 'on'/.test(mig)
    && /set_config\('tutorlage\.purging_document_log', 'on', true\)/.test(mig) && /cron\.schedule\('purge-document-access-log'/.test(mig)
    && /revoke all on function public\.purge_old_document_access_log\(\) from public, anon, authenticated;/.test(mig));
  const tie = read('supabase/migrations/20261021103000_documents_readable_only_after_logging.sql');
  check('the storage migration: an admin reads a stored file only with their own line for that exact file from the last 5 minutes, in both stores',
    /l\.admin_id = auth\.uid\(\) and l\.bucket = p_bucket and l\.document_path = p_path/.test(tie) && /interval '5 minutes'/.test(tie)
    && /drop policy if exists "Admins read all tutor documents"/.test(tie) && /bucket_id = 'tutor-documents' and public\.admin_may_read_document\(bucket_id, name\)/.test(tie)
    && /bucket_id = 'school-results'[\s\S]*can_manage_school_results_folder[\s\S]*admin_may_read_document\(bucket_id, name\)/.test(tie));
  check('only the admin app records openings: nothing under src/ (the tutor, learner and guardian side) calls log_document_access', !walk('src').some((f) => /log_document_access/.test(read(f))));

  // ---- the access view and the safety hold on a person's page (CEO, 21 Oct: the data must stay retrievable when a profile is reported) ----
  type Table = { data?: Record<string, unknown>[]; error?: Err };
  function holdFake(tables: Record<string, Table>, rpcError: Err = null) {
    const seen: string[] = [];
    const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
    const client: HoldClient = {
      from: (table) => ({
        select: (cols) => {
          seen.push(`select:${table}`);
          const t = tables[table] ?? { data: [] };
          const q = {
            eq: (c: string, v: string) => { seen.push(`eq:${c}=${v}`); return q; },
            order: (c: string, o: { ascending: boolean }) => { seen.push(`order:${c}:${o.ascending ? 'asc' : 'desc'}`); return q; },
            limit: (n: number) => { seen.push(`limit:${n}`); return q; },
            then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
              Promise.resolve({ data: t.error ? null : (t.data ?? []), error: t.error ?? null }).then(res, rej),
          };
          void cols;
          return q as unknown as ReturnType<ReturnType<HoldClient['from']>['select']>;
        },
      }),
      rpc: async (fn, args) => { rpcCalls.push({ fn, args }); return { data: null, error: rpcError }; },
    };
    return { client, seen, rpcCalls };
  }
  const line = (id: string, type: string | null, path: string, who = 'A One <a1@example.invalid>', action = 'opened') =>
    ({ id, created_at: '2026-10-21T08:00:00Z', admin_label: who, bucket: 'tutor-documents', document_path: path, document_type: type, action });
  const ev = (seq: number, event: string, reason: string) => ({ seq, event, reason, admin_label: 'A One <a1@example.invalid>', created_at: '2026-10-21T09:00:00Z' });
  const missingTable = { code: '42P01', message: 'relation "public.document_access_log" does not exist' };
  const missingHold = { code: 'PGRST205', message: "Could not find the table 'public.safety_hold_events' in the schema cache" };

  const hv = holdFake({ document_access_log: { data: [line('l1', 'police_clearance', `${TUTOR}/police.pdf`), line('l2', null, 'https://www.superprof.co.za/tutor/x')] },
    safety_hold_events: { data: [ev(2, 'placed', 'Reported for dangerous activity'), ev(1, 'released', 'Earlier case closed')] } });
  const viewOn = await fetchDocumentAccessView(hv.client, TUTOR);
  check('the view reads the log lines about this person (newest first, at most 50) and the hold lines about this person (newest first)',
    hv.seen.includes(`eq:subject_id=${TUTOR}`) && hv.seen.includes(`eq:profile_id=${TUTOR}`) && hv.seen.includes('order:created_at:desc') && hv.seen.includes('order:seq:desc') && hv.seen.includes('limit:50'), hv.seen.join(','));
  check('two log lines come back with their type, and the newest hold line decides: "placed" = on hold', viewOn.logAvailable && viewOn.lines.length === 2 && viewOn.lines[0].documentType === 'police_clearance' && viewOn.lines[1].documentType === null && viewOn.holdAvailable && viewOn.onHold && viewOn.events.length === 2);
  // A database that has the hold but not the hold protections yet (migration 20261021120000 absent): list_safety_holds() is missing.
  const viewOff = await fetchDocumentAccessView(holdFake({ safety_hold_events: { data: [ev(3, 'released', 'Closed'), ev(2, 'placed', 'Reported')] } },
    { code: 'PGRST202', message: 'Could not find the function public.list_safety_holds without parameters in the schema cache' }).client, TUTOR);
  check('when the newest hold line says "released" the person is not on hold', viewOff.holdAvailable && !viewOff.onHold);
  const viewNoLog = await fetchDocumentAccessView(holdFake({ document_access_log: { error: missingTable }, safety_hold_events: { data: [] } }).client, TUTOR);
  check('before the migration the log is "not available" (no error, no lines) while the hold part still loads', !viewNoLog.logAvailable && viewNoLog.lines.length === 0 && viewNoLog.holdAvailable);
  const viewNone = await fetchDocumentAccessView(holdFake({ document_access_log: { error: missingTable }, safety_hold_events: { error: missingHold } }).client, TUTOR);
  check('with neither table on the database both parts are "not available" and nothing throws', !viewNone.logAvailable && !viewNone.holdAvailable && !viewNone.onHold);
  let thrown = '';
  try { await fetchDocumentAccessView(holdFake({ document_access_log: { error: { code: '57014', message: 'canceling statement due to statement timeout' } } }).client, TUTOR); } catch (e) { thrown = (e as Error).message; }
  check('any other database error is shown, not hidden as "not active"', /timeout/.test(thrown), thrown);

  const pc = holdFake({});
  await placeSafetyHold(pc.client, TUTOR, 'Reported for dangerous activity');
  await releaseSafetyHold(pc.client, TUTOR, 'Case closed');
  check('placing and releasing call place_safety_hold and release_safety_hold with the names the migration defines',
    pc.rpcCalls[0]?.fn === 'place_safety_hold' && pc.rpcCalls[0].args.p_profile === TUTOR && pc.rpcCalls[0].args.p_reason === 'Reported for dangerous activity'
    && pc.rpcCalls[1]?.fn === 'release_safety_hold' && pc.rpcCalls[1].args.p_profile === TUTOR && pc.rpcCalls[1].args.p_note === 'Case closed');
  let placeError = '';
  try { await placeSafetyHold(holdFake({}, { code: '22023', message: 'Say why: a short written reason is needed' }).client, TUTOR, 'x'); } catch (e) { placeError = (e as Error).message; }
  let notActive = '';
  try { await placeSafetyHold(holdFake({}, { code: 'PGRST202', message: 'Could not find the function public.place_safety_hold' }).client, TUTOR, 'reason'); } catch (e) { notActive = (e as Error).message; }
  check('a refusal from the database is passed on in its own words; a missing function says holds are not active yet', placeError === 'Say why: a short written reason is needed' && notActive === HOLD_NOT_ACTIVE, `${placeError} | ${notActive}`);

  const html = (v: Parameters<typeof DocumentAccessCardBody>[0]['view']) =>
    renderToStaticMarkup(React.createElement(DocumentAccessCardBody, { view: v, busy: false, error: null, onPlace: () => undefined, onRelease: () => undefined }));
  const onHtml = html(viewOn);
  check('the card shows who opened what, the hold, the reason, and offers to release it', /Who opened these documents/.test(onHtml) && /Police clearance/.test(onHtml) && /Web link/.test(onHtml) && /A One/.test(onHtml)
    && /On safety hold since/.test(onHtml) && /Reported for dangerous activity/.test(onHtml) && /Release the hold…/.test(onHtml) && /Hold placed/.test(onHtml) && /Hold released/.test(onHtml));
  const offHtml = html(viewOff);
  check('with no hold the card offers to place one, and says plainly that a hold stops only the 3-year clean-up of the access log',
    /No hold on this person/.test(offHtml) && /Place a safety hold…/.test(offHtml) && /past the 3-year clean-up/.test(offHtml) && /does not stop anything else being deleted/.test(offHtml));
  const noneHtml = html(viewNone);
  check('before the migration the card says the log and holds are not active on this database, and offers no hold button',
    /document access log is not active on this database yet/.test(noneHtml) && new RegExp(HOLD_NOT_ACTIVE).test(noneHtml) && !/Place a safety hold/.test(noneHtml));
  const cardSrc = read('admin/src/components/DocumentAccessCard.tsx') + read('admin/src/lib/safetyHold.ts');
  check('the view reads the log and hold tables only: it never asks Storage for a file, so it does not depend on the storage tie', !/\.storage\b|createSignedUrl|openStoredDocument/.test(cardSrc));
  check('the tutor page shows the card for this tutor and refreshes it after a document is opened', /<DocumentAccessCard profileId=\{tutorId\} refreshKey=\{accessRefresh\} \/>/.test(read('admin/src/pages/TutorVerificationDetail.tsx')) && /setAccessRefresh\(\(n\) => n \+ 1\)/.test(read('admin/src/pages/TutorVerificationDetail.tsx')));
  check('Tier 1 and School results name the person when they open a file, so a file kept outside an owner folder is still reachable',
    /openDocument\(r\.documentPath, r\.tutorId\)/.test(read('admin/src/pages/Tier1.tsx')) && /openDocument\(r\.documentPath!, r\.studentId\)/.test(read('admin/src/pages/SchoolResults.tsx'))
    && /subject: tutorId/.test(read('admin/src/lib/tier1.ts')) && /subject: learnerId/.test(read('admin/src/lib/schoolResults.ts')));
  check('the migration: hold lines are insert-only, written only by place_safety_hold and release_safety_hold (admin check first), and the retention job skips a person on hold',
    /create table if not exists public\.safety_hold_events/.test(mig) && /before update or delete on public\.safety_hold_events/.test(mig) && /before truncate on public\.safety_hold_events/.test(mig)
    && /revoke all on public\.safety_hold_events from public, anon, authenticated, service_role;\s*grant select on public\.safety_hold_events to authenticated;/.test(mig)
    && /function public\.place_safety_hold[\s\S]*?if v_admin is null or not public\.is_active_admin\(\) then\s+raise exception 'Admins only'/.test(mig)
    && /function public\.release_safety_hold[\s\S]*?if v_admin is null or not public\.is_active_admin\(\) then\s+raise exception 'Admins only'/.test(mig)
    && /and not public\.profile_is_on_safety_hold\(l\.subject_id\)/.test(mig) && /revoke all on function public\.profile_is_on_safety_hold\(uuid\) from public, anon, authenticated;/.test(mig));
  check('the migration: a stored file outside an owner folder can still be logged (the caller names the person) and a name with two dots is not refused', /elsif p_subject is not null then\s+v_subject := p_subject;/.test(mig) && /p_path ~ '\(\^\|\/\)\\\.\\\.\(\/\|\$\)'/.test(mig));

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
