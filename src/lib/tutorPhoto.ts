// The tutor's OWN photo (RUN 7, PM lines 73, 75, 77; 24 Nov 2026). She chooses a JPG, PNG or WebP, drags and zooms it inside a circle, and the square she framed is saved as a 512 px JPEG in her private folder.
// It stays PENDING: it has no public effect. Her public page and her share card keep the old approved photo (or none) until the company approves the new one. She can remove her photo at any time.
// Tutors only. The pure parts (the rules, the framing maths, the words, the database calls) live here and are tested in scripts/dev/tutor-photo-test.ts; the screen is src/components/MyPhotoCard.tsx.
import { PHOTO_ADVICE } from './shareCard';

export const PHOTO_BUCKET = 'tutor-photos';
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // what is stored (the cropped copy is far smaller)
export const MAX_PICK_BYTES = 15 * 1024 * 1024; // what she may choose from her phone: it is cropped and shrunk here before it goes anywhere
export const OUTPUT_PX = 512;
export const VIEW_PX = 280;
export const MAX_ZOOM = 4;

export const photoPath = (tutorId: string): string => `${tutorId}/pending.jpg`;

export function pickProblem(file: { type: string; size: number }): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return PHOTO_COPY.badType;
  if (file.size > MAX_PICK_BYTES) return PHOTO_COPY.tooBig;
  return null;
}

// --- framing maths: the picture sits under a square window (view x view); zoom 1 shows the whole short side; offsets move it. ---
export interface Frame { zoom: number; x: number; y: number } // x and y are the picture's top-left corner inside the window, in window pixels

export function scaleFor(w: number, h: number, zoom: number, view = VIEW_PX): number {
  return (view / Math.min(w, h)) * Math.min(MAX_ZOOM, Math.max(1, zoom));
}

// Keeps the window always covered by the picture (no empty edge in the circle).
export function clampFrame(w: number, h: number, f: Frame, view = VIEW_PX): Frame {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, Number.isFinite(f.zoom) ? f.zoom : 1));
  const s = scaleFor(w, h, zoom, view);
  const minX = view - w * s;
  const minY = view - h * s;
  return { zoom, x: Math.min(0, Math.max(minX, Number.isFinite(f.x) ? f.x : 0)), y: Math.min(0, Math.max(minY, Number.isFinite(f.y) ? f.y : 0)) };
}

// The starting frame: zoom 1, centred, a little higher than centre so a head-and-shoulders portrait keeps the face in the circle.
export function startFrame(w: number, h: number, view = VIEW_PX): Frame {
  const s = scaleFor(w, h, 1, view);
  return clampFrame(w, h, { zoom: 1, x: (view - w * s) / 2, y: (view - h * s) / 3 }, view);
}

// Changing the zoom keeps the middle of the window where it was.
export function zoomFrame(w: number, h: number, f: Frame, zoom: number, view = VIEW_PX): Frame {
  const s0 = scaleFor(w, h, f.zoom, view);
  const cx = (view / 2 - f.x) / s0;
  const cy = (view / 2 - f.y) / s0;
  const z = Math.min(MAX_ZOOM, Math.max(1, zoom));
  const s1 = scaleFor(w, h, z, view);
  return clampFrame(w, h, { zoom: z, x: view / 2 - cx * s1, y: view / 2 - cy * s1 }, view);
}

// The part of the original picture that is inside the window: a source square.
export function sourceSquare(w: number, h: number, f: Frame, view = VIEW_PX): { sx: number; sy: number; side: number } {
  const c = clampFrame(w, h, f, view);
  const s = scaleFor(w, h, c.zoom, view);
  return { sx: -c.x / s, sy: -c.y / s, side: view / s };
}

// --- words (no "free", "instant", "vetted", "certified", "background-checked", no campus) ---
export const PHOTO_COPY = {
  title: 'Your photo',
  advice: PHOTO_ADVICE,
  checked: 'A new photo is looked at by us before anyone else can see it. Until we have approved it, your page and your card keep the photo they have now (or none).',
  choose: 'Choose a photo',
  zoom: 'Zoom',
  dragHint: 'Drag the picture to place your face in the circle.',
  save: 'Send this photo to be checked',
  saving: 'Sending...',
  cancel: 'Choose a different photo',
  remove: 'Remove my photo',
  removing: 'Removing...',
  waiting: 'Your new photo has been sent. We will look at it soon. Until then nothing has changed on your page or card.',
  rejected: 'We could not use your last photo. Please send a new one that follows the advice above.',
  hasApproved: 'This is the photo on your page and card now.',
  none: 'You have no photo on your page or card.',
  removed: 'Your photo has been removed.',
  badType: 'Please choose a JPG, PNG or WebP photo.',
  tooBig: 'That photo is too large. Please choose one under 15 MB.',
  unreadable: 'We could not read that photo. Please choose a JPG, PNG or WebP photo.',
  tooLarge: 'That photo is still too large after cropping. Please choose a different one.',
  failed: 'Could not send your photo. Check your connection and try again.',
  removeFailed: 'Could not remove your photo. Try again.',
};

// --- the database and the private folder ---
export interface MyPhoto { isTutor: boolean; approved: string | null; pending: boolean; rejected: boolean }

export interface PhotoDb {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  storage: {
    from: (bucket: string) => {
      upload: (path: string, body: Blob, options: { contentType: string; upsert: boolean }) => PromiseLike<{ error: { message: string } | null }>;
      remove: (paths: string[]) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

export async function fetchMyPhoto(db: Pick<PhotoDb, 'rpc'>): Promise<MyPhoto | null> {
  try {
    const { data, error } = await db.rpc('my_photo');
    if (error || !data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    if (d.is_tutor !== true) return { isTutor: false, approved: null, pending: false, rejected: false };
    const a = d.approved;
    return {
      isTutor: true,
      approved: typeof a === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(a) && a.length <= 250000 ? a : null,
      pending: d.pending === true,
      rejected: d.rejected === true,
    };
  } catch {
    return null;
  }
}

// Returns null when it worked, else a plain line.
export async function uploadMyPhoto(db: PhotoDb, tutorId: string, jpeg: Blob): Promise<string | null> {
  if (jpeg.size > MAX_UPLOAD_BYTES) return PHOTO_COPY.tooLarge;
  try {
    const path = photoPath(tutorId);
    const up = await db.storage.from(PHOTO_BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: true });
    if (up.error) return PHOTO_COPY.failed;
    const { error } = await db.rpc('submit_my_photo', { p_path: path });
    return error ? PHOTO_COPY.failed : null;
  } catch {
    return PHOTO_COPY.failed;
  }
}

// The approved copy stops being served at once (the database call), then her private file is deleted.
export async function removeMyPhoto(db: PhotoDb, tutorId: string): Promise<string | null> {
  try {
    const { error } = await db.rpc('remove_my_photo');
    if (error) return PHOTO_COPY.removeFailed;
    await db.storage.from(PHOTO_BUCKET).remove([photoPath(tutorId)]); // a file left behind is private and harmless
    return null;
  } catch {
    return PHOTO_COPY.removeFailed;
  }
}
