// Master 7cv: a picked institution must be saved where it can be, and the person told only what really happened.
// Found 13 Oct: the 7cq fix saved only for role 'student', so the admin, tutor and parent accounts were shown
// "Institution updated" and nothing was written; and a write the row-level rules filter out is "success, zero rows"
// in supabase-js, so even a learner could have been told "saved" about nothing.
//
// Part A: the rules, on their own (which role saves where; what each is told).
// Part B: the real supabase-js against a pretend database (a local server answering the way PostgREST does,
//         including "the rules filtered the update out" = an empty list). No network beyond localhost, no keys.
// Part C: source guards, because the original fault was in the wiring: App.tsx must use the rules, and queries.ts
//         must use the checked write.
// Run: npx tsx scripts/dev/institution-save-test.ts   (exits 1 if any check fails)
import { createServer, type IncomingMessage } from 'node:http';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  institutionMessage,
  institutionSaveTarget,
  requireChangedRow,
  savesOnOwnProfile,
  updateOwnLearnerRow,
} from '../../src/lib/institutionSave';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
};

async function main() {
  // ---- Part A: the rules ---------------------------------------------------------------------------------------
  check('a learner saves on their own profile', savesOnOwnProfile('student'));
  check('an admin saves on their own profile (it has a learner row)', savesOnOwnProfile('admin'));
  check('a tutor does not', !savesOnOwnProfile('tutor'));
  check('a parent does not', !savesOnOwnProfile('parent'));
  check('nobody signed in does not', !savesOnOwnProfile(undefined));

  check('learner, no learner chosen: own profile', institutionSaveTarget('student', false) === 'own-profile');
  check('admin: own profile', institutionSaveTarget('admin', false) === 'own-profile');
  check('parent with a learner chosen: remembered on this device', institutionSaveTarget('parent', true) === 'device-for-learner');
  check('parent with no learner chosen: this search only', institutionSaveTarget('parent', false) === 'this-search-only');
  check('tutor: this search only', institutionSaveTarget('tutor', false) === 'this-search-only');
  check('tutor is never given a learner row even if a learner is chosen', institutionSaveTarget('tutor', true) === 'this-search-only');
  check('signed out: this search only', institutionSaveTarget(undefined, false) === 'this-search-only');

  const roles = ['student', 'admin', 'parent', 'tutor', undefined] as const;
  let lies = 0;
  for (const role of roles) {
    for (const hasLearner of [true, false]) {
      const target = institutionSaveTarget(role, hasLearner);
      if (target === 'own-profile') continue;
      const text = institutionMessage(role, target, 'Test High School');
      if (/\b(saved|updated)\b/i.test(text)) lies += 1; // only an own-profile write may say "saved"
    }
  }
  check('no message for a choice that is NOT saved says "saved" or "updated"', lies === 0);
  check('the saved message names the institution', institutionMessage('student', 'own-profile', 'Test High School') === 'Institution saved: "Test High School"');
  check('the device message says this device only', /this device only/.test(institutionMessage('parent', 'device-for-learner', 'X')));
  check('the tutor message points to Teaching', /Teaching/.test(institutionMessage('tutor', 'this-search-only', 'X')));
  check('the parent-with-no-learner message says to choose a learner', /Choose a learner/.test(institutionMessage('parent', 'this-search-only', 'X')));

  let threwEmpty = 0;
  const emptyCases: (unknown[] | null | undefined)[] = [null, undefined, []];
  for (const rows of emptyCases) {
    try {
      requireChangedRow(rows);
    } catch (e) {
      if (e instanceof Error && /no learner profile/.test(e.message)) threwEmpty += 1;
    }
  }
  check('no rows back (null, undefined or empty) is an error in plain words', threwEmpty === 3);
  let threwOne = false;
  try {
    requireChangedRow([{ id: 'x' }]);
  } catch {
    threwOne = true;
  }
  check('one row back is fine', !threwOne);

  // ---- Part B: the real supabase-js against a pretend database ---------------------------------------------------
  const seen: { method: string; url: string; prefer: string; body: string }[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', prefer: String(req.headers['prefer'] ?? ''), body });
      const id = decodeURIComponent((req.url ?? '').match(/id=eq\.([^&]+)/)?.[1] ?? '');
      res.setHeader('content-type', 'application/json');
      // Like the real PostgREST: rows come back only when the request asks for them (Prefer: return=representation);
      // otherwise a successful write is "204 No Content", whatever happened to the row.
      if (id !== 'broken' && !/return=representation/.test(String(req.headers['prefer'] ?? ''))) {
        res.statusCode = 204;
        res.end();
      } else if (id === 'learner-ok') {
        res.statusCode = 200;
        res.end(JSON.stringify([{ id }])); // the row came back: it was changed
      } else if (id === 'filtered') {
        res.statusCode = 200;
        res.end('[]'); // the row-level rules filtered the update out: success, zero rows
      } else {
        res.statusCode = 500;
        res.end(JSON.stringify({ message: 'database fell over', code: 'XX000' }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const client = createClient(`http://127.0.0.1:${port}`, 'fake-key', { auth: { persistSession: false, autoRefreshToken: false } });

  let okThrew = false;
  try {
    await updateOwnLearnerRow(client, 'learner-ok', { school_id: 'a1b2c3d4-0000-4000-8000-000000000001' });
  } catch {
    okThrew = true;
  }
  check('a write that changed the row succeeds', !okThrew);
  const first = seen[0];
  check('it is a PATCH on student_profiles for exactly that learner', first?.method === 'PATCH' && /\/rest\/v1\/student_profiles\?/.test(first.url) && /id=eq\.learner-ok/.test(first.url));
  check('it asks for the changed row back', /return=representation/.test(first?.prefer ?? '') && /select=id/.test(first?.url ?? ''));
  check('it sends only the institution', first?.body === JSON.stringify({ school_id: 'a1b2c3d4-0000-4000-8000-000000000001' }));

  let filteredMessage = '';
  try {
    await updateOwnLearnerRow(client, 'filtered', { school_id: 'a1b2c3d4-0000-4000-8000-000000000001' });
  } catch (e) {
    filteredMessage = e instanceof Error ? e.message : String(e);
  }
  check('a write the rules filter out (zero rows) FAILS instead of looking saved', /no learner profile/.test(filteredMessage), filteredMessage);

  let gradeMessage = '';
  try {
    await updateOwnLearnerRow(client, 'filtered', { grade_level: 'Grade 12' });
  } catch (e) {
    gradeMessage = e instanceof Error ? e.message : String(e);
  }
  check('the grade level save fails the same way', /no learner profile/.test(gradeMessage));

  let serverMessage = '';
  try {
    await updateOwnLearnerRow(client, 'broken', { school_id: 'x' });
  } catch (e) {
    serverMessage = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
  }
  check('a real database error is passed on, not swallowed', /database fell over/.test(serverMessage), serverMessage);
  server.close();

  // ---- Part C: source guards -----------------------------------------------------------------------------------
  const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  const start = app.indexOf('const handleSelectInstitution');
  const end = app.indexOf('\n  };', start);
  const handler = app.slice(start, end);
  check('found handleSelectInstitution in App.tsx', start > 0 && end > start);
  check('handleSelectInstitution decides with institutionSaveTarget', /institutionSaveTarget\(role,/.test(handler));
  check("handleSelectInstitution no longer hard-codes role === 'student'", !/role === 'student'/.test(handler));
  check('handleSelectInstitution tells the person via institutionMessage', /institutionMessage\(/.test(handler));
  check('the "updated" toast that said nothing true is gone', !/Institution updated to/.test(handler));
  check('the load effect uses the same rule as the save', /savesOnOwnProfile\(role\)/.test(app));

  const queries = readFileSync(new URL('../../src/lib/queries.ts', import.meta.url), 'utf8');
  check('updateStudentInstitution uses the checked write', /updateStudentInstitution[\s\S]{0,400}updateOwnLearnerRow\(supabase, studentId, \{ school_id: institutionId \}\)/.test(queries));
  check('updateStudentGradeLevel uses the checked write', /updateStudentGradeLevel[\s\S]{0,400}updateOwnLearnerRow\(supabase, studentId, \{ grade_level: gradeLevel \}\)/.test(queries));

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
