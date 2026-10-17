// Checks on the camera rule for learners under 18 (CEO, 17 Oct 2026): server/cameraRule.ts, how server/index.ts uses it, and how
// the room page and call use the answer. Run: npx tsx scripts/dev/camera-rule-test.ts
// (The in-browser checks T35 to T38 of scripts/dev/room-loopback.html cover the page and the call themselves.)
import fs from 'node:fs';
import { adultCutoff, isAdultDateOfBirth } from '../../server/cameraRule';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

// ---- the rule -----------------------------------------------------------------------------------------------------------
const today = day('2026-10-17');
check('the cutoff is 18 years ago to the day', adultCutoff(today) === '2008-10-17', adultCutoff(today));
check('born exactly 18 years ago today: an adult', isAdultDateOfBirth('2008-10-17', today));
check('born the day after that: still under 18', !isAdultDateOfBirth('2008-10-18', today));
check('born 17 years and 364 days ago: under 18', !isAdultDateOfBirth('2008-10-18', today) && !isAdultDateOfBirth('2009-10-16', today));
check('a 16-year-old learner: no camera', !isAdultDateOfBirth('2010-03-04', today));
check('a 30-year-old: camera allowed', isAdultDateOfBirth('1996-01-31', today));
check('no date of birth on file (null, undefined, empty): no camera', !isAdultDateOfBirth(null, today) && !isAdultDateOfBirth(undefined, today) && !isAdultDateOfBirth('', today));
check('an unreadable date: no camera', !isAdultDateOfBirth('not a date', today) && !isAdultDateOfBirth('2000-13-01', today) && !isAdultDateOfBirth('2000-00-10', today) && !isAdultDateOfBirth('20000101', today));
check('a date in the future: no camera', !isAdultDateOfBirth('2030-01-01', today));
// The database's boundary is `current_date - interval '18 years'`, in which 29 February becomes 28 February in a year without one.
check('29 Feb 2028 (a leap day), 18 years back lands on 28 Feb 2010 as the database does', adultCutoff(day('2028-02-29')) === '2010-02-28', adultCutoff(day('2028-02-29')));
check('29 Feb 2032, 18 years back (2014) lands on 28 Feb 2014', adultCutoff(day('2032-02-29')) === '2014-02-28', adultCutoff(day('2032-02-29')));
check('1 March is not moved', adultCutoff(day('2027-03-01')) === '2009-03-01');
check('the clock is UTC, like the database: 23:30 UTC is still that UTC day', adultCutoff(new Date('2026-10-17T23:30:00Z')) === '2008-10-17');

// ---- how the server uses it ---------------------------------------------------------------------------------------------------
const server = fs.readFileSync(new URL('../../server/index.ts', import.meta.url), 'utf8');
check('the server imports the rule', /import \{ isAdultDateOfBirth \} from '\.\/cameraRule'/.test(server));
check('everyone starts as "no camera" and only a readable adult date of birth changes that',
  /new Map<string, boolean>\(ids\.map\(\(id\) => \[id, false\]\)\)/.test(server) && /allowed\.set\(row\.id, isAdultDateOfBirth\(row\.date_of_birth\)\)/.test(server));
check('if the lookup fails nobody gets a camera, and it is logged', /could not read dates of birth, so nobody gets a camera/.test(server) && /if \(error\) \{[\s\S]{0,200}return allowed;/.test(server));
check('the join answer carries the caller\'s answer, and only a clear true counts', /joinAnswer\(row, ice, camera\.get\(user\.id\) === true\)/.test(server) && /function joinAnswer\(row: JoinedRow, iceServers: IceServer\[\], cameraAllowed: boolean\)/.test(server));
check('the state answer carries it for the caller and for every person listed', /cameraAllowed: camera\.get\(user\.id\) === true,/.test(server) && /cameraAllowed: camera\.get\(p\.profile_id\) === true,/.test(server));
check('the date of birth itself is never sent to a browser', !/date_of_birth: /.test(server.slice(server.indexOf('async function cameraAllowedFor'), server.indexOf('function joinAnswer'))) || !/res\.json\([\s\S]{0,400}date_of_birth/.test(server));

// ---- how the page and the call use it -------------------------------------------------------------------------------------------
const page = fs.readFileSync(new URL('../../src/pages/RoomPage.tsx', import.meta.url), 'utf8');
const call = fs.readFileSync(new URL('../../src/lib/roomCall.ts', import.meta.url), 'utf8');
const rooms = fs.readFileSync(new URL('../../src/lib/videoRooms.ts', import.meta.url), 'utf8');
check('the page asks for a camera only when the server said yes (a clear true)', /const allowCamera = cameraIsAllowed\(state\)/.test(page) && /export const cameraIsAllowed = [^\n]*cameraAllowed === true/.test(rooms));
check('without it the page asks the browser for sound only (no camera permission is even requested)', /if \(!allowCamera\) \{[\s\S]{0,300}getUserMedia\(\{ audio:/.test(page) && !/if \(!allowCamera\) \{[\s\S]{0,300}video:/.test(page.slice(page.indexOf('async function getLocalMedia'), page.indexOf('function stopStream'))));
check('the camera button is shown only to someone whose camera is allowed', /\{camAllowed && \(\s*<button[\s\S]{0,120}onClick=\{toggleCam\}/.test(page));
check('the call is told, and never sends a video track of ours when it is not allowed', /cameraAllowed: allowCamera,/.test(page) && /track\.kind === 'video' && this\.opts\.cameraAllowed === false/.test(call));
check('the others\' video is dropped for anyone not allowed: when it arrives and when the flag arrives later',
  /event\.track\.kind === 'video' && this\.noVideo\.has\(id\)/.test(call) && /peer\.stream\.removeTrack\(track\)/.test(call) && /call\.setRoster\(roster, noVideo\)/.test(page) && /callRef\.current\.setRoster\(roster, noVideo\)/.test(page));
check('the people flagged are everyone listed without a clear "camera allowed"', /const withoutVideo = \(people: RoomPerson\[\], selfId: string\) =>\s*people\.filter\(\(p\) => p\.id !== selfId && !cameraIsAllowed\(p\)\)/.test(page));
// The only two places in the app that can use a camera: the video room (this rule), and the tutor's document page, where
// a file box lets a tutor photograph an ID or certificate with their phone ("capture"). Tutors must be 18 or older (B1, the
// database refuses a younger one), so no learner under 18 ever reaches that page. Any new use of a camera must be added here
// on purpose.
const MAY_USE_CAMERA = new Set(['RoomPage.tsx', 'TutorDocumentsPage.tsx']);
check('nothing else in the app opens a camera (the video room is the only place a learner could)', ['src/components', 'src/pages', 'src/lib'].every((dir) => {
  const root = new URL(`../../${dir}/`, import.meta.url);
  return fs.readdirSync(root).filter((f) => /\.(ts|tsx)$/.test(f)).every((f) => {
    const text = fs.readFileSync(new URL(f, root), 'utf8');
    return !/getUserMedia|capture=["']|facingMode/.test(text) || MAY_USE_CAMERA.has(f);
  });
}));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
