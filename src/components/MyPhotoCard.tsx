import React, { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import {
  MAX_ZOOM, OUTPUT_PX, PHOTO_COPY as COPY, VIEW_PX, clampFrame, fetchMyPhoto, pickProblem, removeMyPhoto, scaleFor, sourceSquare, startFrame, uploadMyPhoto, zoomFrame,
  type Frame, type MyPhoto, type PhotoDb,
} from '../lib/tutorPhoto';

interface Picked { bitmap: ImageBitmap | HTMLImageElement; w: number; h: number; url: string | null }

async function decode(file: File): Promise<Picked | null> {
  try {
    if (typeof createImageBitmap === 'function') {
      const b = await createImageBitmap(file); // applies the photo's rotation
      return { bitmap: b, w: b.width, h: b.height, url: null };
    }
  } catch {
    /* fall through to an <img> */
  }
  try {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    return { bitmap: img, w: img.naturalWidth, h: img.naturalHeight, url };
  } catch {
    return null;
  }
}

// "Your photo" on the Teach screen (RUN 7, 24 Nov 2026). Tutors only (the card shows nothing for anyone else). Her new photo goes to the company to be checked and has NO public effect until it is approved: her page and card keep the old approved photo (or none).
// The picture is framed here, in her browser (drag and zoom inside a circle), and only the 512 px square she framed is sent. Anything that goes wrong at load shows nothing extra.
const MyPhotoCard: React.FC<{ db?: PhotoDb }> = ({ db = supabase as unknown as PhotoDb }) => {
  const { user } = useAuth();
  const [me, setMe] = useState<MyPhoto | null>(null);
  const [pick, setPick] = useState<Picked | null>(null);
  const [frame, setFrame] = useState<Frame>({ zoom: 1, x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ px: number; py: number; fx: number; fy: number } | null>(null);

  useEffect(() => {
    let live = true;
    fetchMyPhoto(db).then((m) => {
      if (live) setMe(m);
    });
    return () => {
      live = false;
    };
  }, [db]);

  // draw the window: the picture under a circular mask
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !pick) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const s = scaleFor(pick.w, pick.h, frame.zoom);
    ctx.clearRect(0, 0, VIEW_PX, VIEW_PX);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, 0, VIEW_PX, VIEW_PX);
    ctx.drawImage(pick.bitmap, frame.x, frame.y, pick.w * s, pick.h * s);
    // dim everything outside the circle
    ctx.save();
    ctx.fillStyle = 'rgba(15,23,42,0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_PX, VIEW_PX);
    ctx.arc(VIEW_PX / 2, VIEW_PX / 2, VIEW_PX / 2 - 4, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(VIEW_PX / 2, VIEW_PX / 2, VIEW_PX / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();
  }, [pick, frame]);

  if (!me || !me.isTutor || !user) return null;

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setNote(null);
    setProblem(null);
    if (!file) return;
    const bad = pickProblem(file);
    if (bad) return setProblem(bad);
    const d = await decode(file);
    if (!d || !d.w || !d.h) return setProblem(COPY.unreadable);
    setPick(d);
    setFrame(startFrame(d.w, d.h));
  };

  const closePick = () => {
    if (pick?.url) URL.revokeObjectURL(pick.url);
    setPick(null);
  };

  const save = async () => {
    if (!pick) return;
    setBusy(true);
    setProblem(null);
    const out = document.createElement('canvas');
    out.width = OUTPUT_PX;
    out.height = OUTPUT_PX;
    const ctx = out.getContext('2d');
    if (!ctx) {
      setBusy(false);
      return setProblem(COPY.failed);
    }
    const { sx, sy, side } = sourceSquare(pick.w, pick.h, frame);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, OUTPUT_PX, OUTPUT_PX);
    ctx.drawImage(pick.bitmap, sx, sy, side, side, 0, 0, OUTPUT_PX, OUTPUT_PX);
    const blob: Blob | null = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.85));
    if (!blob) {
      setBusy(false);
      return setProblem(COPY.unreadable);
    }
    const err = await uploadMyPhoto(db, user.id, blob);
    if (err) setProblem(err);
    else {
      closePick();
      setNote(COPY.waiting);
      setMe(await fetchMyPhoto(db));
    }
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    setProblem(null);
    const err = await removeMyPhoto(db, user.id);
    if (err) setProblem(err);
    else {
      setNote(COPY.removed);
      setMe(await fetchMyPhoto(db));
    }
    setBusy(false);
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, fx: frame.x, fy: frame.y };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || !pick) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const k = VIEW_PX / (rect.width || VIEW_PX);
    setFrame(clampFrame(pick.w, pick.h, { ...frame, x: d.fx + (e.clientX - d.px) * k, y: d.fy + (e.clientY - d.py) * k }));
  };
  const onUp = () => {
    drag.current = null;
  };

  const hasAny = !!me.approved || me.pending;

  return (
    <div className="bg-[#FAF7F2] rounded-2xl p-4 border border-slate-200 space-y-2" data-testid="my-photo-card">
      <div className="flex items-center space-x-1.5">
        <Camera className="w-3.5 h-3.5 text-[#15803D]" aria-hidden="true" />
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{COPY.title}</span>
      </div>
      <p className="text-[11px] text-slate-600 leading-relaxed">{COPY.advice}</p>
      <p className="text-[11px] text-slate-600 leading-relaxed">{COPY.checked}</p>

      {pick ? (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-700">{COPY.dragHint}</p>
          <canvas
            ref={canvasRef}
            width={VIEW_PX}
            height={VIEW_PX}
            data-testid="my-photo-canvas"
            aria-label={COPY.dragHint}
            className="rounded-xl touch-none cursor-grab max-w-full bg-slate-200"
            style={{ width: VIEW_PX, height: VIEW_PX }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
          <label className="flex items-center gap-2 text-[11px] font-semibold text-[#0F172A]">
            {COPY.zoom}
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={frame.zoom}
              onChange={(e) => setFrame(zoomFrame(pick.w, pick.h, frame, Number(e.target.value)))}
              className="flex-1"
              data-testid="my-photo-zoom"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={save} className="min-h-9 px-3 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold cursor-pointer disabled:opacity-50">{busy ? COPY.saving : COPY.save}</button>
            <button type="button" disabled={busy} onClick={closePick} className="min-h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold text-[#0F172A] cursor-pointer disabled:opacity-50">{COPY.cancel}</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            {me.approved && <img src={me.approved} alt="Your photo as it is on your page and card" width={64} height={64} className="w-16 h-16 rounded-full object-cover border border-slate-200" />}
            <p className="text-[11px] text-slate-700 leading-relaxed">{me.approved ? COPY.hasApproved : COPY.none}</p>
          </div>
          {me.pending && <p className="text-[11px] font-semibold text-slate-700" data-testid="my-photo-waiting">{COPY.waiting}</p>}
          {me.rejected && !me.pending && <p className="text-[11px] font-semibold text-slate-700">{COPY.rejected}</p>}
          <div className="flex flex-wrap gap-2">
            <label className="min-h-9 px-3 inline-flex items-center rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold cursor-pointer">
              {COPY.choose}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onFile} data-testid="my-photo-file" />
            </label>
            {hasAny && (
              <button type="button" disabled={busy} onClick={remove} className="min-h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold text-[#0F172A] cursor-pointer disabled:opacity-50">{busy ? COPY.removing : COPY.remove}</button>
            )}
          </div>
        </>
      )}
      {note && <p className="text-[11px] font-semibold text-slate-700" role="status">{note}</p>}
      {problem && <p className="text-[11px] font-bold text-rose-600" role="alert">{problem}</p>}
    </div>
  );
};

export default MyPhotoCard;
