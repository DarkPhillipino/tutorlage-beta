import React, { useEffect, useRef, useState } from 'react';
import { Download, Share2, Copy, Camera, ImagePlus, Trash2 } from 'lucide-react';
import { fetchPublicPage, profileLink, type PublicPageClient, type PublicTutorPage } from '../lib/publicTutorPage';
import {
  SHARE_CARD_COPY as COPY, canvasToPng, drawShareCard, drawWeeklyCard, launchCaption, parseWeeklyPost, preparePhoto, weeklyCaption, type CardPhoto, type WeeklyPost,
} from '../lib/shareCard';

// The share card and the weekly post on the Teach screen (JOBS CARD, WEEKLY, FACE). Loaded only when her page is on and she opens the Teach screen (lazy from
// PublicPageCard), so the canvas drawing is not part of any other screen. The pictures are made in her phone when she taps Share my profile; nothing is sent
// anywhere and her photo is never uploaded or stored (PM lines 69 and 70). The weekly numbers come from the database (my_weekly_post: lessons COMPLETED in the last 7 days).

interface PanelProps {
  heading: string;
  how: string;
  caption: string;
  fileName: string;
  idBase: string;
  draw: (canvas: HTMLCanvasElement) => Promise<void>;
}

const CardPanel: React.FC<PanelProps> = ({ heading, how, caption, fileName, idBase, draw }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'making' | 'ready' | 'failed'>('making');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    if (!canvasRef.current) return undefined;
    setState('making');
    draw(canvasRef.current).then(
      () => live && setState('ready'),
      () => live && setState('failed'),
    );
    return () => {
      live = false;
    };
  }, [draw]);

  // The picture is drawn again at the tap, so it always carries her photo as it is now.
  const makeFile = async (): Promise<File | null> => {
    if (!canvasRef.current) return null;
    try {
      await draw(canvasRef.current);
      const blob = await canvasToPng(canvasRef.current);
      return new File([blob], fileName, { type: 'image/png' });
    } catch {
      return null;
    }
  };

  const save = async () => {
    const file = await makeFile();
    if (!file) return;
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && typeof navigator.share === 'function';
  const share = async () => {
    const file = await makeFile();
    if (!file) return;
    try {
      // The picture and the caption (with her link) go together; a phone that cannot do that saves the card and she copies the caption.
      if (navigator.canShare({ files: [file], text: caption })) await navigator.share({ files: [file], text: caption });
      else await save();
    } catch {
      /* she closed the share sheet: nothing to do */
    }
  };

  const copyCaption = () => {
    try {
      navigator.clipboard?.writeText(caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* the caption is shown in the box, so it can be copied by hand */
    }
  };

  return (
    <div className="space-y-2 pt-2 border-t border-slate-200" data-testid={idBase}>
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{heading}</p>
      <p className="text-[11px] text-slate-700 leading-relaxed">{how}</p>
      {state === 'making' && <p className="text-[11px] text-slate-500" role="status">{COPY.making}</p>}
      {state === 'failed' && <p className="text-[11px] text-slate-600" role="status">{COPY.failed}</p>}
      <canvas ref={canvasRef} aria-label={COPY.alt} role="img" className={state === 'ready' ? 'w-40 h-auto rounded-lg border border-slate-200 shadow-xs' : 'hidden'} />
      {state === 'ready' && (
        <>
          <div className="flex flex-wrap gap-2">
            {canShareFiles && (
              <button type="button" onClick={share} className="min-h-9 px-3 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold cursor-pointer inline-flex items-center gap-1.5">
                <Share2 className="w-3.5 h-3.5" aria-hidden="true" />{COPY.share}
              </button>
            )}
            <button type="button" onClick={save} className={`min-h-9 px-3 rounded-lg text-xs font-bold cursor-pointer inline-flex items-center gap-1.5 ${canShareFiles ? 'border border-slate-300 bg-white text-[#0F172A]' : 'bg-[#15803D] hover:bg-[#166534] text-white'}`}>
              <Download className="w-3.5 h-3.5" aria-hidden="true" />{COPY.download}
            </button>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">{COPY.privacyLine}</p>
          <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`${idBase}-caption`}>{COPY.captionLabel}</label>
          <textarea id={`${idBase}-caption`} readOnly value={caption} rows={5} className="w-full text-[11px] text-slate-700 border border-slate-300 rounded-lg p-2 bg-white" />
          <button type="button" onClick={copyCaption} className="min-h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold text-[#0F172A] cursor-pointer inline-flex items-center gap-1.5">
            <Copy className="w-3.5 h-3.5" aria-hidden="true" />{copied ? COPY.copied : COPY.copyCaption}
          </button>
        </>
      )}
    </div>
  );
};

// The optional face photo: picked or taken on her own phone, cropped and kept in memory here; it is never uploaded.
const PhotoPicker: React.FC<{ hasPhoto: boolean; failed: boolean; onFile: (f: File) => void; onRemove: () => void }> = ({ hasPhoto, failed, onFile, onRemove }) => {
  const choose = useRef<HTMLInputElement>(null);
  const take = useRef<HTMLInputElement>(null);
  const picked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) onFile(f);
  };
  const btn = 'min-h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold text-[#0F172A] cursor-pointer inline-flex items-center gap-1.5';
  return (
    <div className="space-y-2 pt-2 border-t border-slate-200" data-testid="share-card-photo">
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{COPY.photoHeading}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => take.current?.click()} className={btn}>
          <Camera className="w-3.5 h-3.5" aria-hidden="true" />{COPY.photoTake}
        </button>
        <button type="button" onClick={() => choose.current?.click()} className={btn}>
          <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />{COPY.photoChoose}
        </button>
        {hasPhoto && (
          <button type="button" onClick={onRemove} className={btn}>
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />{COPY.photoRemove}
          </button>
        )}
      </div>
      <input ref={take} type="file" accept="image/*" capture="user" className="hidden" onChange={picked} aria-label={COPY.photoTake} />
      <input ref={choose} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={picked} aria-label={COPY.photoChoose} />
      <p className="text-[11px] text-slate-700 leading-relaxed">{COPY.photoAdvice}</p>
      <p className="text-[11px] text-slate-600 leading-relaxed">{COPY.photoStays}</p>
      {failed && <p className="text-[11px] font-bold text-rose-600" role="alert">{COPY.photoFailed}</p>}
    </div>
  );
};

const ShareCard: React.FC<{ client: PublicPageClient; code: string }> = ({ client, code }) => {
  const [page, setPage] = useState<PublicTutorPage | null>(null);
  const [weekly, setWeekly] = useState<WeeklyPost | null>(null);
  const [photo, setPhoto] = useState<CardPhoto | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const link = profileLink(code);

  useEffect(() => {
    let live = true;
    fetchPublicPage(client, code).then((p) => live && setPage(p));
    Promise.resolve(client.rpc('my_weekly_post')).then(
      ({ data, error }) => live && !error && setWeekly(parseWeeklyPost(data)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client, code]);

  const onFile = (f: File) => {
    setPhotoFailed(false);
    preparePhoto(f).then(setPhoto, () => setPhotoFailed(true));
  };

  const launchDraw = React.useCallback(
    (canvas: HTMLCanvasElement) => (page ? drawShareCard(canvas, { firstName: page.firstName, subjects: page.subjects, photo }) : Promise.reject(new Error('no page'))),
    [page, photo],
  );
  const weeklyDraw = React.useCallback(
    (canvas: HTMLCanvasElement) => (page && weekly ? drawWeeklyCard(canvas, { firstName: page.firstName, post: weekly, photo }) : Promise.reject(new Error('no numbers'))),
    [page, weekly, photo],
  );

  return (
    <>
      {page && page.subjects.length > 0 && <PhotoPicker hasPhoto={photo !== null} failed={photoFailed} onFile={onFile} onRemove={() => setPhoto(null)} />}
      {page && page.subjects.length > 0 && (
        <CardPanel
          heading={COPY.heading}
          how={COPY.how}
          caption={launchCaption(link)}
          fileName="tutorlage-share-card.png"
          idBase="share-card"
          draw={launchDraw}
        />
      )}
      {page && weekly && (
        <CardPanel
          heading={COPY.weeklyHeading}
          how={COPY.weeklyHow}
          caption={weeklyCaption(weekly, link)}
          fileName={`tutorlage-week-${weekly.week}.png`}
          idBase="weekly-post"
          draw={weeklyDraw}
        />
      )}
    </>
  );
};

export default ShareCard;
