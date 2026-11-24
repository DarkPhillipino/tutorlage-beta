// Checks on the tutor's own photo upload (RUN 7, 24 Nov 2026; migration 20261125110000). Run: npx tsx scripts/dev/tutor-photo-test.ts
// Proves, on the pure parts in src/lib/tutorPhoto.ts and by reading the sources: the file rules (type, size), the framing maths (the picture always covers the circle, zoom keeps the middle, the source square is inside the picture),
// the upload goes to her own folder and then records it as pending, a failure at either step is a plain line, removal asks the database first and then deletes the file, the card shows nothing to a non-tutor and says the photo is
// checked before anyone sees it, the words avoid the banned ones and never name a campus, and the public page and share card are untouched (they read only the approved copy). The database half is supabase/tests/tutor_photo_upload.sql.
import { readFileSync } from 'node:fs';
import {
  MAX_PICK_BYTES, MAX_UPLOAD_BYTES, MAX_ZOOM, PHOTO_COPY, VIEW_PX, clampFrame, fetchMyPhoto, photoPath, pickProblem, removeMyPhoto, scaleFor, sourceSquare, startFrame, uploadMyPhoto, zoomFrame,
  type PhotoDb,
} from '../../src/lib/tutorPhoto';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` ${detail}`}`);
  if (!ok) failed += 1;
};
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

const fakeDb = (o: { uploadErr?: boolean; rpcErr?: boolean; throws?: boolean } = {}) => {
  const log: string[] = [];
  const db: PhotoDb = {
    rpc: async (fn, args) => {
      log.push(`rpc ${fn} ${JSON.stringify(args ?? {})}`);
      if (o.throws) throw new Error('down');
      return { data: null, error: o.rpcErr ? { message: 'x' } : null };
    },
    storage: {
      from: (bucket) => ({
        upload: async (path, _b, opt) => {
          log.push(`upload ${bucket} ${path} ${opt.contentType} upsert=${opt.upsert}`);
          return { error: o.uploadErr ? { message: 'x' } : null };
        },
        remove: async (paths) => {
          log.push(`remove ${bucket} ${paths.join(',')}`);
          return { error: null };
        },
      }),
    },
  };
  return { db, log };
};

async function main() {
  // the rules
  check('JPG, PNG and WebP are allowed; HEIC, GIF, PDF are not', pickProblem({ type: 'image/jpeg', size: 1 }) === null && pickProblem({ type: 'image/png', size: 1 }) === null && pickProblem({ type: 'image/webp', size: 1 }) === null
    && pickProblem({ type: 'image/heic', size: 1 }) === PHOTO_COPY.badType && pickProblem({ type: 'image/gif', size: 1 }) === PHOTO_COPY.badType && pickProblem({ type: 'application/pdf', size: 1 }) === PHOTO_COPY.badType);
  check('a picture over the pick limit is refused, one at the limit is not; what is stored is limited to 2 MB', pickProblem({ type: 'image/jpeg', size: MAX_PICK_BYTES + 1 }) === PHOTO_COPY.tooBig && pickProblem({ type: 'image/jpeg', size: MAX_PICK_BYTES }) === null && MAX_UPLOAD_BYTES === 2 * 1024 * 1024);
  check('her file always goes to the one name in her own folder', photoPath('abc') === 'abc/pending.jpg');

  // the framing maths, on a landscape, a portrait and a square picture
  for (const [w, h] of [[4000, 3000], [3000, 4000], [800, 800], [512, 2000]] as const) {
    let ok = true;
    for (const zoom of [1, 1.7, MAX_ZOOM, 99, 0, NaN]) {
      for (const [x, y] of [[0, 0], [-99999, -99999], [99999, 99999], [-50, -20]] as const) {
        const f = clampFrame(w, h, { zoom, x, y });
        const s = scaleFor(w, h, f.zoom);
        if (!(f.x <= 1e-9 && f.y <= 1e-9 && f.x + w * s >= VIEW_PX - 1e-6 && f.y + h * s >= VIEW_PX - 1e-6)) ok = false; // the window is always covered
        const q = sourceSquare(w, h, f);
        if (!(q.sx >= -1e-6 && q.sy >= -1e-6 && q.sx + q.side <= w + 1e-6 && q.sy + q.side <= h + 1e-6 && q.side > 0)) ok = false; // the source square is inside the picture
      }
    }
    check(`${w} x ${h}: the circle is always covered and the source square is always inside the picture`, ok);
  }
  const sf = startFrame(3000, 4000);
  check('the start frame shows the whole short side (zoom 1) and is placed above the middle for a portrait', sf.zoom === 1 && sf.x === 0 && sf.y < 0 && sf.y > -(4000 * scaleFor(3000, 4000, 1) - VIEW_PX) / 2 && near(sourceSquare(3000, 4000, sf).side, 3000));
  const z0 = startFrame(4000, 3000);
  const z1 = zoomFrame(4000, 3000, z0, 2.5);
  const mid = (f: typeof z0, w: number, h: number) => { const s = scaleFor(w, h, f.zoom); return [(VIEW_PX / 2 - f.x) / s, (VIEW_PX / 2 - f.y) / s]; };
  const a = mid(z0, 4000, 3000);
  const b = mid(z1, 4000, 3000);
  check('zooming keeps the middle of the window on the same part of the picture (inside the limits)', z1.zoom === 2.5 && near(a[0], b[0]) && near(a[1], b[1]), `${a} vs ${b}`);
  check('zoom is limited to 1 to 4 times', zoomFrame(4000, 3000, z0, 50).zoom === MAX_ZOOM && zoomFrame(4000, 3000, z0, 0.2).zoom === 1);

  // the database answers
  const mk = (data: unknown, error: { message: string } | null = null) => ({ rpc: async () => ({ data, error }) });
  const photo = 'data:image/jpeg;base64,/9j/4AAQ';
  const m1 = await fetchMyPhoto(mk({ is_tutor: true, approved: photo, pending: true, rejected: false }));
  check('her state is read: approved photo, waiting', !!m1 && m1.isTutor && m1.approved === photo && m1.pending && !m1.rejected);
  const m2 = await fetchMyPhoto(mk({ is_tutor: true, approved: 'https://x.test/a.jpg', pending: false, rejected: true }));
  check('anything but a small JPEG data address is dropped as her approved photo', !!m2 && m2.approved === null && m2.rejected);
  const m3 = await fetchMyPhoto(mk({ is_tutor: false }));
  check('a non-tutor is told so', !!m3 && !m3.isTutor);
  check('an error, a throw or an odd answer is "no card", never a crash', (await fetchMyPhoto(mk(null, { message: 'x' }))) === null && (await fetchMyPhoto({ rpc: async () => { throw new Error('x'); } })) === null && (await fetchMyPhoto(mk('x'))) === null);

  // upload and removal
  const jpeg = new Blob([new Uint8Array(1000)], { type: 'image/jpeg' });
  const good = fakeDb();
  const r1 = await uploadMyPhoto(good.db, 'tutor1', jpeg);
  check('an upload goes to her own folder in the private bucket, replaces her old waiting file, then records it as pending', r1 === null && good.log[0] === 'upload tutor-photos tutor1/pending.jpg image/jpeg upsert=true' && good.log[1] === 'rpc submit_my_photo {"p_path":"tutor1/pending.jpg"}' && good.log.length === 2, good.log.join(' | '));
  const big = new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)], { type: 'image/jpeg' });
  const bigDb = fakeDb();
  check('a stored picture over 2 MB is refused before anything is sent', (await uploadMyPhoto(bigDb.db, 't', big)) === PHOTO_COPY.tooLarge && bigDb.log.length === 0);
  const f1 = fakeDb({ uploadErr: true });
  check('a failed file upload is a plain line and nothing is recorded', (await uploadMyPhoto(f1.db, 't', jpeg)) === PHOTO_COPY.failed && !f1.log.some((l) => l.startsWith('rpc')));
  check('a failed record or a throw is a plain line', (await uploadMyPhoto(fakeDb({ rpcErr: true }).db, 't', jpeg)) === PHOTO_COPY.failed && (await uploadMyPhoto(fakeDb({ throws: true }).db, 't', jpeg)) === PHOTO_COPY.failed);
  const rm = fakeDb();
  check('removal asks the database first (the public copy goes at once), then deletes her file', (await removeMyPhoto(rm.db, 'tutor1')) === null && rm.log[0] === 'rpc remove_my_photo {}' && rm.log[1] === 'remove tutor-photos tutor1/pending.jpg');
  const rm2 = fakeDb({ rpcErr: true });
  check('a failed removal says so and leaves her file alone', (await removeMyPhoto(rm2.db, 't')) === PHOTO_COPY.removeFailed && !rm2.log.some((l) => l.startsWith('remove')));

  // the words
  const words = JSON.stringify(PHOTO_COPY);
  check('no "free", "instant", "vetted", "certified", "background-checked", "wallet" and no campus or school name in the words', !/\bfree\b|instant|vetted|certified|background|wallet|campus|universit|school/i.test(words.replace(/No school or campus badges/g, '')), words);
  check('the card says the new photo is checked before anyone else sees it and that the page and card keep the old photo', /looked at by us before anyone else can see it/.test(PHOTO_COPY.checked) && /keep the photo they have now/.test(PHOTO_COPY.checked));

  // the screen and what it must not touch
  const card = code('src/components/MyPhotoCard.tsx');
  check('the card shows nothing to anyone who is not a tutor', /!me\.isTutor/.test(card) && /return null/.test(card));
  check('the card never writes the approved copy or the public page (it only calls the three own-photo functions and the private folder)', !/public_tutor_page|tutor_photo\b|photo_data/.test(card) && /uploadMyPhoto/.test(card) && /removeMyPhoto/.test(card));
  check('the card makes no request to any other site and sends no personal data in an address', !/fetch\(|https?:\/\//.test(card.replace(/https?:\/\/www\.w3\.org[^'"]*/g, '')));
  const teach = read('src/components/TeachGoScreen.tsx');
  check('the Teach screen loads the card lazily, once', (teach.match(/MyPhotoCard/g) ?? []).length === 3 && /React\.lazy\(\(\) => import\('\.\/MyPhotoCard'\)\)/.test(teach));
  check('the public page and the share card are not changed by this run', !/tutorPhoto|my_photo|tutor-photos/.test(read('src/pages/TutorPublicPage.tsx') + read('src/components/ShareCard.tsx') + read('src/lib/shareCard.ts') + read('src/lib/publicTutorPage.ts')));
  const mig = read('supabase/migrations/20261125110000_tutor_photo_upload.sql');
  check('the migration never writes the approved copy and keeps the bucket private with a 2 MB limit', !/set\s+photo_data\s*=\s*[^n]/i.test(mig.replace(/photo_data = null/g, '')) && /'tutor-photos', 'tutor-photos', false, 2097152/.test(mig));

  console.log(failed === 0 ? '\nALL OK' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
