// Checks the admin side of the hold protections (migration 20261021120000: the "Safety holds" screen) and of the hand-over bundle
// (migration 20261021130000: "Prepare hand-over bundle") with fake clients and rendered markup. Run: npx tsx scripts/dev/holds-handover-test.ts
// The database halves are proved by supabase/tests/holds_and_handover.sql (rolled back). This checks: the order of the bundle (record first, then
// each file through the logging helper with action "downloaded", then the log lines, then the report), what happens when the record is
// refused or the migration is absent, that nothing is built from a half-filled form, that the bundle follows the kind of authority (the same
// rules as the database), and that the new screens tolerate the migrations being absent.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  AUTHORITIES, HAND_OVER_NOT_ACTIVE, HandOverAuthority, HandOverClient, HandOverDeps, HandOverForm, HandOverPart, Manifest, PARTS, emptyHandOverForm, fetchPastHandOvers,
  formProblems, prepareHandOver, recordDelivery, renderReportHtml, resolveScope,
} from '../../admin/src/lib/handOver';
import { HOLD_NOT_ACTIVE, HoldClient, fetchDocumentAccessView } from '../../admin/src/lib/safetyHold';
import { fetchSafetyHolds, holdPagePath } from '../../admin/src/lib/safetyHolds';
import { SafetyHoldsBody } from '../../admin/src/components/SafetyHoldsBody';
import { DocumentAccessCardBody } from '../../admin/src/components/DocumentAccessCardBody';
import { HandOverPanelBody } from '../../admin/src/components/HandOverPanelBody';

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
const TUTOR = '3f2b8a54-1111-4222-8333-444455556666';
const HO_ID = '9d3c1a2b-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-21T10:00:00Z');

// ---------------------------------------------------------------------------------------------------------------------------------
// A fake Supabase client for the bundle: records the order of every call.
// ---------------------------------------------------------------------------------------------------------------------------------
interface Script {
  record?: { data?: unknown; error?: Err };
  log?: (path: string) => Err;
  sign?: (path: string) => Err;
  tables?: Record<string, { data?: Record<string, unknown>[]; error?: Err }>;
}
const rec = (docs: Record<string, unknown>[], placed = false) => ({
  id: HO_ID, created_at: '2026-10-21T10:00:00Z', prepared_by: 'A One <a1@example.invalid>', hold_placed_by_this_hand_over: placed, documents: docs,
});
const docRow = (id: string, type: string, path: string, status = 'pending') =>
  ({ id, type, path, status, uploaded_at: '2026-10-01T08:00:00Z', reviewed_at: null, issued_on: null });

function makeClient(script: Script) {
  const calls: string[] = [];
  const rpcArgs: Record<string, Record<string, unknown>> = {};
  const logArgs: Record<string, unknown>[] = [];
  const client: HandOverClient = {
    rpc: async (fn, args) => {
      calls.push(`rpc:${fn}`);
      if (fn === 'log_document_access') {
        logArgs.push(args);
        const err = script.log?.(String(args.p_path)) ?? null;
        return { data: err ? null : 'log-id', error: err };
      }
      rpcArgs[fn] = args;
      if (fn === 'record_hand_over') {
        const r = script.record ?? { data: rec([]) };
        return { data: r.error ? null : r.data, error: r.error ?? null };
      }
      return { data: 'ok-id', error: null };
    },
    storage: { from: () => ({ createSignedUrl: async (path) => {
      calls.push(`sign:${path}`);
      const err = script.sign?.(path) ?? null;
      return err ? { data: null, error: err } : { data: { signedUrl: `https://files.example.invalid/${path}?t=1` }, error: null };
    } }) },
    from: (table) => ({ select: () => {
      calls.push(`from:${table}`);
      const t = script.tables?.[table] ?? { data: [] };
      const q = {
        eq: (c: string, v: string) => { calls.push(`eq:${c}=${v}`); return q; },
        order: () => q,
        limit: () => q,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve({ data: t.error ? null : (t.data ?? []), error: t.error ?? null }).then(res, rej),
      };
      return q as unknown as ReturnType<ReturnType<HoldClient['from']>['select']>;
    } }),
  };
  return { client, calls, rpcArgs, logArgs };
}

function makeDeps(failFetchFor: string[] = []) {
  const events: string[] = [];
  const saved: Record<string, string | Uint8Array> = {};
  const deps: HandOverDeps = {
    fetchFile: async (url) => {
      events.push(`fetch:${url}`);
      if (failFetchFor.some((p) => url.includes(p))) throw new Error('The file could not be fetched (404).');
      return { bytes: new Uint8Array([7, 7, 7, 7, 7]), contentType: 'application/pdf' };
    },
    sha256: async (bytes) => `sha-${bytes.length}-${bytes[0]}`,
    save: (name, data) => { events.push(`save:${name}`); saved[name] = data; },
    now: () => NOW,
  };
  return { deps, events, saved };
}

const goodForm = (over: Partial<HandOverForm> = {}): HandOverForm => ({
  ...emptyHandOverForm(), authority: 's54_report', reference: 'Tutorlage s 54 report 2026-014', requesterName: 'Sgt P Dlamini', requesterRole: 'Detective Sergeant',
  requesterOrganisation: 'SAPS Sandton', requesterPhone: '011 555 0100', requesterEmail: 'p.dlamini@saps.example.invalid', verifiedHow: 'Called the station back on its public number',
  reason: 'Suspected offence against a child, reported by a parent', approvedBy: 'J Mokoena, deputy safeguarding lead', tutorTold: 'Not told at this time',
  ticks: { other_documents: true, access_log: true }, ...over,
});
const tutor = { id: TUTOR, name: 'Tia Nkosi', email: 'tia@example.invalid', phone: '082 555 0101', createdAt: '2026-09-01T08:00:00Z' };
const FILE = `${TUTOR}/id.pdf`;
const LINK = 'https://www.superprof.co.za/tutor/x';
const logLine = { id: 'l1', created_at: '2026-10-21T09:00:00Z', admin_label: 'A One <a1@example.invalid>', bucket: 'tutor-documents', document_path: FILE, document_type: 'identity_doc', action: 'downloaded' };
const holdLine = { seq: 1, event: 'placed', reason: 'Reported for dangerous activity', admin_label: 'A One <a1@example.invalid>', created_at: '2026-10-21T08:00:00Z' };

async function attempt<T>(run: () => Promise<T>): Promise<{ ok: T | null; error: string }> {
  try { return { ok: await run(), error: '' }; } catch (e) { return { ok: null, error: (e as Error).message }; }
}

async function main() {
  // ================= the Safety holds screen =================
  const row = (id: string, tutorFlag: boolean, name: string, reason: string) => ({
    hold_profile_id: id, hold_name: name, hold_email: `${name.toLowerCase()}@example.invalid`, hold_is_tutor: tutorFlag, hold_reason: reason,
    hold_placed_by: 'A One <a1@example.invalid>', hold_placed_at: '2026-10-21T09:00:00Z',
  });
  const seen: { fn: string; args: Record<string, unknown> }[] = [];
  const okList = await fetchSafetyHolds({ rpc: async (fn, args) => { seen.push({ fn, args }); return { data: [row(TUTOR, true, 'Tia', 'Reported for dangerous activity'), row('aaaa', false, 'Lee', 'A parent reported')], error: null }; } });
  check('the screen asks the database for list_safety_holds() with no arguments', seen.length === 1 && seen[0].fn === 'list_safety_holds' && Object.keys(seen[0].args).length === 0);
  check('two holds come back with reason, who, when and whether the person is a tutor', okList.state === 'ok' && okList.holds.length === 2 && okList.holds[0].reason === 'Reported for dangerous activity'
    && okList.holds[0].isTutor && !okList.holds[1].isTutor && okList.holds[0].placedBy.startsWith('A One') && okList.holds[0].placedAt === '2026-10-21T09:00:00Z');
  check('only a tutor gets a link to their page, and it goes to the verification page for that tutor',
    okList.state === 'ok' && holdPagePath(okList.holds[0]) === `/verification/${TUTOR}` && holdPagePath(okList.holds[1]) === null);
  for (const err of [{ code: 'PGRST202', message: 'Could not find the function public.list_safety_holds' }, { code: '42883', message: 'function public.list_safety_holds() does not exist' }]) {
    const miss = await fetchSafetyHolds({ rpc: async () => ({ data: null, error: err }) });
    check(`when the migration is absent (${err.code}) the screen gets the "not active" note, not an error`, miss.state === 'not_active' && miss.note === HOLD_NOT_ACTIVE);
  }
  const broken = await attempt(() => fetchSafetyHolds({ rpc: async () => ({ data: null, error: { code: '42501', message: 'Admins only' } }) }));
  check('any other database error is shown as an error, not hidden as "not active"', broken.error === 'Admins only', broken.error);

  // The screen's <Link> comes from the admin app's ES module build of react-router-dom, so the router must be that same copy (a second copy has its own context).
  const { MemoryRouter } = (await import('../../admin/node_modules/react-router-dom/dist/index.mjs')) as unknown as typeof import('react-router-dom');
  const inRouter = (el: React.ReactElement) => renderToStaticMarkup(React.createElement(MemoryRouter, null, el));
  const listHtml = inRouter(React.createElement(SafetyHoldsBody, { list: okList }));
  check('the list shows each name, the reason, who placed it and a link "Open their page" for the tutor only',
    /Tia/.test(listHtml) && /Lee/.test(listHtml) && /Reported for dangerous activity/.test(listHtml) && /A parent reported/.test(listHtml) && /Placed by A One/.test(listHtml)
    && listHtml.split('Open their page').length === 2 && new RegExp(`href="/verification/${TUTOR}"`).test(listHtml) && /No tutor page/.test(listHtml));
  const emptyHtml = inRouter(React.createElement(SafetyHoldsBody, { list: { state: 'ok', holds: [] } }));
  check('an empty list says no one is on a safety hold', /No one is on a safety hold/.test(emptyHtml));
  const naHtml = inRouter(React.createElement(SafetyHoldsBody, { list: { state: 'not_active', note: HOLD_NOT_ACTIVE } }));
  check('before the migration the screen shows the plain "not active on this database" note', /not active on this database/.test(naHtml) && !/Open their page/.test(naHtml));

  const pageSrc = read('admin/src/pages/SafetyHolds.tsx') + read('admin/src/lib/safetyHolds.ts') + read('admin/src/components/SafetyHoldsBody.tsx');
  check('the Safety holds screen is a menu entry and a route, and never touches Storage', /to: '\/safety-holds', label: 'Safety Holds'/.test(read('admin/src/components/AdminLayout.tsx'))
    && /path="safety-holds" element=\{<SafetyHolds \/>\}/.test(read('admin/src/App.tsx')) && !/\.storage\b|createSignedUrl|openStoredDocument/.test(pageSrc));

  // ---- the person's page says what a hold stops, depending on whether the protections are on this database ----
  const holdClient = (rpcError: Err): HoldClient => ({
    from: (table) => ({ select: () => {
      const data = table === 'safety_hold_events' ? [holdLine] : [];
      const q = { eq: () => q, order: () => q, limit: () => q, then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res, rej) };
      return q as unknown as ReturnType<ReturnType<HoldClient['from']>['select']>;
    } }),
    rpc: async () => ({ data: null, error: rpcError }),
  });
  const viewWith = await fetchDocumentAccessView(holdClient(null), TUTOR);
  const viewWithout = await fetchDocumentAccessView(holdClient({ code: 'PGRST202', message: 'Could not find the function public.list_safety_holds' }), TUTOR);
  check('the page probes list_safety_holds(): present -> protectionsActive, missing -> not', viewWith.protectionsActive && !viewWithout.protectionsActive && viewWith.onHold);
  const card = (v: Awaited<ReturnType<typeof fetchDocumentAccessView>>) => renderToStaticMarkup(React.createElement(DocumentAccessCardBody, { view: v, busy: false, error: null, onPlace: () => undefined, onRelease: () => undefined }));
  check('with the protections the card says a hold also keeps video rooms and stops removing or replacing their own documents, and still names what it does not stop',
    /video rooms they hosted or joined past\s+the 30-day clean-up/.test(card(viewWith)) && /stops them removing or replacing their own documents/.test(card(viewWith)) && /does not stop closing or deleting their account/.test(card(viewWith)));
  check('without the protections the card keeps the old, narrower sentence', /does not stop anything else being deleted/.test(card(viewWithout)) && !/stops them removing or replacing/.test(card(viewWithout)));

  // ================= the hand-over bundle: the rules by kind of authority =================
  const names = (xs: HandOverPart[]) => xs.join(',');
  const want: Record<HandOverAuthority, [string, string]> = {
    s54_report: ['profile,identity,hold_events', 'profile,identity,other_documents,access_log,hold_events'],
    warrant: ['', 'profile,identity,other_documents,access_log,hold_events'],
    court_order: ['', 'profile,identity,other_documents,access_log,hold_events'],
    regulator_notice: ['access_log', 'profile,identity,other_documents,access_log,hold_events'],
    request_with_consent: ['profile,identity,hold_events', 'profile,identity,hold_events'],
  };
  const allTicks = { profile: true, identity: true, other_documents: true, access_log: true, hold_events: true };
  for (const a of AUTHORITIES) {
    const [base, withTicks] = want[a.value];
    check(`${a.value}: with nothing ticked the bundle holds only "${base || 'nothing'}"; ticking everything gives "${withTicks}"`,
      names(resolveScope(a.value, {})) === base && names(resolveScope(a.value, allTicks)) === withTicks, `${names(resolveScope(a.value, {}))} | ${names(resolveScope(a.value, allTicks))}`);
  }
  check('the same rules are written in the database function (always-included and never-included lists per kind of authority)', (() => {
    const sql = read('supabase/migrations/20261021130000_hand_over_export.sql');
    const lists = (label: string) => {
      const block = new RegExp(`${label} := case p_authority([\\s\\S]*?)end;`).exec(sql)?.[1] ?? '';
      const out: Record<string, string> = {};
      for (const m of block.matchAll(/when '(\w+)' then array\[([^\]]*)\]/g)) out[m[1]] = m[2].replace(/'/g, '').replace(/\s/g, '');
      return out;
    };
    const req = lists('v_required');
    const forb = lists('v_forbidden');
    return AUTHORITIES.every((a) => {
      const always = PARTS.map((p) => p.value).filter((p) => a.rules[p] === 'always').join(',');
      const never = PARTS.map((p) => p.value).filter((p) => a.rules[p] === 'never').join(',');
      return (req[a.value] ?? '') === always && (forb[a.value] ?? '') === never;
    });
  })());
  check('a request with the tutor\'s consent can never include other documents or the access log, even if ticked', !resolveScope('request_with_consent', allTicks).includes('other_documents') && !resolveScope('request_with_consent', allTicks).includes('access_log'));

  check('a complete form has no problems', formProblems(goodForm()).length === 0, formProblems(goodForm()).join('; '));
  const blanks: [keyof HandOverForm, string][] = [['reference', 'reference'], ['requesterName', 'requester name'], ['requesterRole', 'requester role or rank'], ['requesterOrganisation', 'requester organisation'],
    ['requesterPhone', 'requester phone'], ['requesterEmail', 'requester email'], ['verifiedHow', 'how the requester was verified'], ['reason', 'reason'], ['approvedBy', 'who approved it'], ['tutorTold', 'whether the tutor was told']];
  check('every one of the ten fields, left blank, stops the bundle and is named', blanks.every(([k, word]) => {
    const p = formProblems(goodForm({ [k]: '  ' } as Partial<HandOverForm>));
    return p.length === 1 && p[0].toLowerCase().includes(word);
  }));
  check('no kind of authority chosen, or nothing named by a warrant, stops the bundle', formProblems(goodForm({ authority: '' })).length > 0 && formProblems(goodForm({ authority: 'warrant', ticks: {} })).some((p) => /Pick what the paper names/.test(p)));

  // ================= the bundle, in order =================
  const full = makeClient({
    record: { data: rec([docRow('d1', 'identity_doc', FILE), docRow('d2', 'proof_of_experience', LINK)], true) },
    tables: { document_access_log: { data: [logLine] }, safety_hold_events: { data: [holdLine] } },
  });
  const fd = makeDeps();
  const done = await attempt(() => prepareHandOver(full.client, fd.deps, tutor, goodForm()));
  const idx = (needle: string) => full.calls.findIndex((c) => c.startsWith(needle));
  check('the record is written first: nothing is opened, signed, fetched or saved before record_hand_over', full.calls[0] === 'rpc:record_hand_over' && fd.events.length > 0);
  check('the record carries the tutor, the kind of authority, the typed fields and the parts the authority and the ticks allow',
    full.rpcArgs.record_hand_over?.p_subject === TUTOR && full.rpcArgs.record_hand_over?.p_authority === 's54_report' && full.rpcArgs.record_hand_over?.p_reference === 'Tutorlage s 54 report 2026-014'
    && full.rpcArgs.record_hand_over?.p_requester_name === 'Sgt P Dlamini' && full.rpcArgs.record_hand_over?.p_approved_by === 'J Mokoena, deputy safeguarding lead'
    && JSON.stringify(full.rpcArgs.record_hand_over?.p_scope) === JSON.stringify(['profile', 'identity', 'other_documents', 'access_log', 'hold_events']));
  check('each document goes through the logging helper with the action "downloaded" and the tutor named, then Storage signs the link (stored file) or nothing is signed (a web link)',
    full.logArgs.length === 2 && full.logArgs.every((a) => a.p_action === 'downloaded' && a.p_subject === TUTOR && a.p_bucket === 'tutor-documents')
    && full.logArgs[0].p_path === FILE && full.logArgs[1].p_path === LINK && idx('rpc:log_document_access') < idx(`sign:${FILE}`) && full.calls.filter((c) => c.startsWith('sign:')).length === 1);
  check('the web link is listed but not fetched; the stored file is fetched once',
    fd.events.filter((e) => e.startsWith('fetch:')).length === 1 && fd.events.some((e) => e.includes(FILE)) && !fd.events.some((e) => e.includes('superprof')));
  check('the access log and the hold lines are read AFTER the files were opened, so the bundle shows its own downloads',
    idx('from:document_access_log') > idx(`sign:${FILE}`) && idx('from:safety_hold_events') > idx('from:document_access_log') && full.calls.includes(`eq:subject_id=${TUTOR}`) && full.calls.includes(`eq:profile_id=${TUTOR}`));
  const names3 = Object.keys(fd.saved);
  check('three files are saved one by one: the document, then the report, then the manifest, named after the record',
    JSON.stringify(names3) === JSON.stringify(['handover-9d3c1a2b-document-01-identity-doc.pdf', 'handover-9d3c1a2b-report.html', 'handover-9d3c1a2b-manifest.json']), names3.join(', '));
  const manifest = JSON.parse(String(fd.saved['handover-9d3c1a2b-manifest.json'])) as Manifest;
  check('the manifest has who prepared it, when, for whom, the requester and the reference, and is complete',
    manifest.handOverId === HO_ID && manifest.preparedBy.startsWith('A One') && manifest.preparedAt === '2026-10-21T10:00:00Z' && manifest.tutor.name === 'Tia Nkosi'
    && manifest.requester.name === 'Sgt P Dlamini' && manifest.requester.organisation === 'SAPS Sandton' && manifest.reference === 'Tutorlage s 54 report 2026-014' && manifest.complete && done.ok?.complete === true && manifest.holdPlacedByThisHandOver);
  check('each stored file has its SHA-256 and the name it was saved as; the web link has neither',
    manifest.documents[0].sha256 === 'sha-5-7' && manifest.documents[0].savedAs === 'handover-9d3c1a2b-document-01-identity-doc.pdf' && manifest.documents[1].isLink && manifest.documents[1].sha256 === '' && manifest.documents[1].link === LINK);
  check('the manifest carries the log lines and the hold lines', manifest.accessLog?.length === 1 && manifest.accessLog[0].action === 'downloaded' && manifest.holdEvents?.length === 1 && manifest.holdEvents[0].reason === 'Reported for dangerous activity');
  const html = String(fd.saved['handover-9d3c1a2b-report.html']);
  check('the report page shows the requester, the reference, the authority, the hash, the link, the log and the holds, and says what is not in it',
    /Sgt P Dlamini/.test(html) && /Tutorlage s 54 report 2026-014/.test(html) && /sha-5-7/.test(html) && /Web link: https:\/\/www\.superprof/.test(html) && /Who opened this tutor/.test(html)
    && /Safety holds/.test(html) && /Never in any bundle/.test(html) && /A safety hold was placed on this tutor/.test(html) && !/<script/i.test(html));

  // ---- the kind of authority decides what is read ----
  const consent = makeClient({ record: { data: rec([docRow('d1', 'identity_doc', FILE)]) }, tables: { safety_hold_events: { data: [holdLine] } } });
  const cd = makeDeps();
  await attempt(() => prepareHandOver(consent.client, cd.deps, tutor, goodForm({ authority: 'request_with_consent', ticks: allTicks })));
  check('a request with consent sends only profile, ID and hold lines, reads no access log, and the report says the access log and other documents are not included',
    JSON.stringify(consent.rpcArgs.record_hand_over?.p_scope) === JSON.stringify(['profile', 'identity', 'hold_events']) && !consent.calls.includes('from:document_access_log')
    && /may not include it/.test(String(cd.saved['handover-9d3c1a2b-report.html'])));
  const reg = makeClient({ record: { data: rec([]) }, tables: { document_access_log: { data: [logLine] } } });
  const rd = makeDeps();
  await attempt(() => prepareHandOver(reg.client, rd.deps, tutor, goodForm({ authority: 'regulator_notice', ticks: {} })));
  const regManifest = JSON.parse(String(rd.saved['handover-9d3c1a2b-manifest.json'])) as Manifest;
  check('a Regulator notice always includes the access log and, with nothing else ticked, no profile details, no documents and no hold lines',
    JSON.stringify(reg.rpcArgs.record_hand_over?.p_scope) === JSON.stringify(['access_log']) && regManifest.accessLog?.length === 1 && regManifest.holdEvents === null && regManifest.tutor.name === '' && regManifest.documents.length === 0);

  // ---- the record fails: nothing is built ----
  const refused = makeClient({ record: { error: { code: '42501', message: 'Admins only' } } });
  const rf = makeDeps();
  const r1 = await attempt(() => prepareHandOver(refused.client, rf.deps, tutor, goodForm()));
  check('when the record is refused nothing is opened, signed, fetched or saved, and the admin sees the database\'s words', r1.error === 'Admins only' && refused.calls.length === 1 && rf.events.length === 0, `${r1.error} | ${refused.calls.join(',')}`);
  const absent = makeClient({ record: { error: { code: 'PGRST202', message: 'Could not find the function public.record_hand_over' } } });
  const r2 = await attempt(() => prepareHandOver(absent.client, makeDeps().deps, tutor, goodForm()));
  check('when the migration is absent the admin is told hand-over bundles are not active on this database, and nothing else happens', r2.error === HAND_OVER_NOT_ACTIVE && absent.calls.length === 1);
  const blankRun = makeClient({});
  const r3 = await attempt(() => prepareHandOver(blankRun.client, makeDeps().deps, tutor, goodForm({ reference: ' ' })));
  check('a half-filled form is stopped before any call is made', /Fill in: reference/.test(r3.error) && blankRun.calls.length === 0, r3.error);

  // ---- partial failures are listed, not hidden ----
  const partial = makeClient({ record: { data: rec([docRow('d1', 'identity_doc', FILE), docRow('d2', 'police_clearance', `${TUTOR}/police.pdf`)]) }, tables: { document_access_log: { data: [] }, safety_hold_events: { data: [] } } });
  const pd = makeDeps(['police.pdf']);
  const rp = await attempt(() => prepareHandOver(partial.client, pd.deps, tutor, goodForm()));
  const pm = JSON.parse(String(pd.saved['handover-9d3c1a2b-manifest.json'])) as Manifest;
  check('a file that cannot be fetched is listed with the reason, the other file is still saved, and the bundle says it is NOT complete',
    pm.documents[0].savedAs !== '' && pm.documents[1].savedAs === '' && /404/.test(pm.documents[1].problem) && rp.ok?.complete === false && !pm.complete && /NOT in this bundle/.test(rp.ok?.problems.join(' ') ?? '')
    && /This bundle is not complete/.test(String(pd.saved['handover-9d3c1a2b-report.html'])));
  const noLog = makeClient({ record: { data: rec([docRow('d1', 'identity_doc', FILE)]) }, log: () => ({ code: 'PGRST202', message: 'Could not find the function public.log_document_access' }) });
  const nd = makeDeps();
  const rn = await attempt(() => prepareHandOver(noLog.client, nd.deps, tutor, goodForm()));
  check('if the access log is not active the file is still included but the bundle says its opening was NOT recorded and is not complete', rn.ok?.complete === false && /NOT recorded/.test(rn.ok.problems.join(' ')) && Object.keys(nd.saved).length === 3);
  const refusedLog = makeClient({ record: { data: rec([docRow('d1', 'identity_doc', FILE)]) }, log: () => ({ code: 'P0002', message: 'No such stored document' }) });
  const ld = makeDeps();
  const rl = await attempt(() => prepareHandOver(refusedLog.client, ld.deps, tutor, goodForm()));
  check('a file whose opening cannot be recorded is not fetched at all, and is listed as not in the bundle', rl.ok?.complete === false && !ld.events.some((e) => e.startsWith('fetch:')) && !refusedLog.calls.some((c) => c.startsWith('sign:')));
  const noTable = makeClient({ record: { data: rec([]) }, tables: { document_access_log: { error: { code: '42P01', message: 'relation "public.document_access_log" does not exist' } }, safety_hold_events: { data: [] } } });
  const td = makeDeps();
  const rt = await attempt(() => prepareHandOver(noTable.client, td.deps, tutor, goodForm()));
  check('with no access-log table the bundle is built without it and says so', rt.ok?.complete === false && /document access log is not active/i.test(rt.ok.problems.join(' ')));

  // ---- the report escapes what an admin typed ----
  const evil = renderReportHtml({ ...manifest, reference: '<script>alert(1)</script>', requester: { ...manifest.requester, name: 'A & B "C"' } });
  check('what the admin typed is escaped in the report', !/<script>alert/.test(evil) && /&lt;script&gt;alert\(1\)&lt;\/script&gt;/.test(evil) && /A &amp; B &quot;C&quot;/.test(evil));

  // ================= delivery and earlier hand-overs =================
  const dc = makeClient({});
  await recordDelivery(dc.client, HO_ID, ' Email to the station ', ' station@saps.example.invalid ');
  check('the delivery calls record_hand_over_delivery with the hand-over and the trimmed method and address', dc.calls[0] === 'rpc:record_hand_over_delivery' && dc.rpcArgs.record_hand_over_delivery?.p_hand_over === HO_ID
    && dc.rpcArgs.record_hand_over_delivery?.p_method === 'Email to the station' && dc.rpcArgs.record_hand_over_delivery?.p_address === 'station@saps.example.invalid');
  const blankDelivery = await attempt(() => recordDelivery(makeClient({}).client, HO_ID, ' ', 'x@y.example.invalid'));
  check('a blank delivery method is stopped before the call', /Fill in: how it was delivered/.test(blankDelivery.error));
  const past = await fetchPastHandOvers(makeClient({ tables: { hand_over_events: { data: [{ id: 'e1', event: 'prepared', hand_over_id: null, created_at: '2026-10-21T10:00:00Z', admin_label: 'A One', authority: 'warrant', reference: 'CAS 1', delivery_method: null, delivery_address: null }] } } }).client, TUTOR);
  check('earlier hand-overs for this tutor are read from hand_over_events', past.state === 'ok' && past.rows.length === 1 && past.rows[0].reference === 'CAS 1');
  const pastMissing = await fetchPastHandOvers(makeClient({ tables: { hand_over_events: { error: { code: 'PGRST205', message: "Could not find the table 'public.hand_over_events' in the schema cache" } } } }).client, TUTOR);
  check('before the migration the list of earlier hand-overs is "not active", not an error', pastMissing.state === 'not_active');

  // ================= the button's screen =================
  const props = {
    tutorName: 'Tia Nkosi', open: true, form: emptyHandOverForm(), busy: false, error: null, result: null, past: null as null | Awaited<ReturnType<typeof fetchPastHandOvers>>,
    deliverFor: null as string | null, delivery: { method: '', address: '', recorded: false }, onPickDelivery: () => undefined, onOpen: () => undefined, onChange: () => undefined, onPrepare: () => undefined, onDelivery: () => undefined, onRecordDelivery: () => undefined,
  };
  const body = (over: Partial<typeof props> = {}) => renderToStaticMarkup(React.createElement(HandOverPanelBody, { ...props, ...over }));
  check('closed, the panel offers "Prepare hand-over bundle…"; before the migration it shows the "not active" note', /Prepare hand-over bundle…/.test(body({ open: false })) && new RegExp(HAND_OVER_NOT_ACTIVE).test(body({ open: false, past: { state: 'not_active' } })));
  check('open with nothing chosen, it says to choose the authority first and the Prepare button is off', /Choose the kind of authority first/.test(body()) && /<button[^>]*disabled=""[^>]*>Prepare the bundle/.test(body()));
  const filled = body({ form: goodForm({ authority: 'request_with_consent', ticks: {} }) });
  check('with a consent request and every field filled the button is on, the access log and other documents are disabled and marked "may not be included"',
    /<button(?![^>]*disabled="")[^>]*>Prepare the bundle/.test(filled) && (filled.match(/may not be included for this kind of authority/g) ?? []).length === 2 && /always included for this kind of authority/.test(filled));
  check('with a warrant the parts are all "only if the paper names it"', (body({ form: goodForm({ authority: 'warrant', ticks: {} }) }).match(/only if the paper names it/g) ?? []).length === 5);
  const resultHtml = body({ deliverFor: HO_ID, result: { handOverId: HO_ID, holdPlaced: true, savedFiles: ['handover-9d3c1a2b-report.html'], problems: ['Document 1 is NOT in this bundle'], complete: false } });
  check('after the bundle: the saved files are listed, an incomplete bundle says so, the hold is mentioned, and the delivery is asked for', /handover-9d3c1a2b-report\.html/.test(resultHtml) && /This bundle is not complete/.test(resultHtml)
    && /A safety hold was placed on this tutor/.test(resultHtml) && /Record the delivery/.test(resultHtml) && /never by WhatsApp/.test(resultHtml));
  check('the delivery form shows only for a hand-over picked or just prepared, and says "Delivery recorded." afterwards',
    !/Record the delivery/.test(body({ open: false })) && /Delivery recorded\./.test(body({ deliverFor: HO_ID, delivery: { method: 'Email', address: 'station', recorded: true } })) && !/Record the delivery/.test(body({ deliverFor: HO_ID, delivery: { method: 'Email', address: 'station', recorded: true } })));
  const earlier = body({ open: false, past: { state: 'ok', rows: [
    { id: 'p1', event: 'prepared', handOverId: '', createdAt: '2026-10-21T10:00:00Z', adminLabel: 'A One', authority: 'warrant', reference: 'CAS 1', deliveredTo: '' },
    { id: 'p2', event: 'delivered', handOverId: 'p1', createdAt: '2026-10-21T11:00:00Z', adminLabel: 'A One', authority: '', reference: '', deliveredTo: 'Email · station@saps.example.invalid' }] } });
  check('an earlier hand-over can have its delivery written down later: only a "prepared" line offers "Record a delivery", a "delivered" line does not',
    (earlier.match(/Record a delivery/g) ?? []).length === 1 && /Prepared · CAS 1/.test(earlier) && /Delivered · Email/.test(earlier));

  // ================= source checks =================
  const files = ['admin/src/lib/handOver.ts', 'admin/src/components/HandOverPanel.tsx', 'admin/src/components/HandOverPanelBody.tsx', 'admin/src/lib/safetyHolds.ts', 'admin/src/pages/SafetyHolds.tsx'];
  const src = files.map(read).join('\n');
  check('no service key and no Storage link of its own in the new admin files (only the logging helper makes links)', !/service_role|serviceKey|SERVICE_KEY|createSignedUrl/.test(src));
  check('the panel uses the admin\'s own signed-in client only', /from '\.\.\/lib\/supabaseClient'/.test(read('admin/src/components/HandOverPanel.tsx')) && /<HandOverPanel/.test(read('admin/src/pages/TutorVerificationDetail.tsx')));
  check('every file in the bundle goes through openStoredDocument with the action "downloaded"', /openStoredDocument\(client, 'tutor-documents', path, \{ action: 'downloaded', subject: tutor\.id \}\)/.test(read('admin/src/lib/handOver.ts')));

  const m120 = read('supabase/migrations/20261021120000_hold_protections.sql');
  check('120000: the video clean-up skips rooms a held person hosted or joined, and its grants are as before (server key only)',
    /and not public\.profile_is_on_safety_hold\(host_id\)/.test(m120) && /public\.profile_is_on_safety_hold\(m\.profile_id\)/.test(m120)
    && /where coalesce\(ended_at, expires_at\) < now\(\) - interval '30 days'/.test(m120) && /revoke all on function public\.purge_old_video_rooms\(\) from public, anon, authenticated;\s*grant execute on function public\.purge_old_video_rooms\(\) to service_role;/.test(m120));
  check('120000: a new trigger is added and the existing document guard is NOT replaced; the plain message is the one asked for',
    /create trigger guard_held_documents before update or delete on public\.tutor_verification_documents/.test(m120) && !/create or replace function public\.guard_verification_documents/.test(m120)
    && /This document can''t be changed right now\. If you need help, email support@tutorlage\.com\./.test(m120));
  check('120000: the storage delete policy keeps its two old tests and adds the hold test', /bucket_id = 'tutor-documents'[\s\S]*foldername\(name\)\)\[1\] = \(auth\.uid\(\)\)::text[\s\S]*d\.status = 'verified'[\s\S]*and not public\.my_documents_are_kept\(\)/.test(m120));
  check('120000: the list is for admins only, the check function takes no argument', /function public\.list_safety_holds\(\)[\s\S]*?if auth\.uid\(\) is null or not public\.is_active_admin\(\) then\s+raise exception 'Admins only'/.test(m120) && /function public\.my_documents_are_kept\(\)/.test(m120));
  const m130 = read('supabase/migrations/20261021130000_hand_over_export.sql');
  check('130000: the hand-over table is insert-only (no write rights, admin read policy, a trigger on update, delete and truncate), written only by two functions that check for an active admin first',
    /revoke all on public\.hand_over_events from public, anon, authenticated, service_role;\s*grant select on public\.hand_over_events to authenticated;/.test(m130)
    && /create policy "Admins read hand-over events"[^;]*is_active_admin\(\)/.test(m130) && /before update or delete on public\.hand_over_events/.test(m130) && /before truncate on public\.hand_over_events/.test(m130)
    && /function public\.record_hand_over\([\s\S]*?if v_admin is null or not public\.is_active_admin\(\) then\s+raise exception 'Admins only'/.test(m130)
    && /function public\.record_hand_over_delivery\([\s\S]*?if v_admin is null or not public\.is_active_admin\(\) then\s+raise exception 'Admins only'/.test(m130));
  check('130000: who and when come from the database; the retention job skips a person on hold and is the only thing that may delete', !/p_admin|p_time|p_created/.test(m130)
    && /tg_op = 'DELETE' and coalesce\(current_setting\('tutorlage\.purging_hand_over_events', true\), ''\) = 'on'/.test(m130) && /and not public\.profile_is_on_safety_hold\(e\.subject_id\)/.test(m130)
    && /revoke all on function public\.purge_old_hand_over_events\(\) from public, anon, authenticated;/.test(m130));
  check('130000: nothing existing is replaced (no "create or replace" of a function the earlier migrations define)', !/create or replace function public\.(log_document_access|place_safety_hold|release_safety_hold|profile_is_on_safety_hold|purge_old_document_access_log|admin_may_read_document)/.test(m130));
  const keyShaped = new RegExp(['sk_' + 'live', 'pk_' + 'live', 'whsec' + '_'].join('|'));
  check('no key-shaped text in the new files', ![...files, 'supabase/migrations/20261021120000_hold_protections.sql', 'supabase/migrations/20261021130000_hand_over_export.sql', 'supabase/tests/holds_and_handover.sql', 'scripts/dev/holds-handover-test.ts'].some((f) => keyShaped.test(read(f))));

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
