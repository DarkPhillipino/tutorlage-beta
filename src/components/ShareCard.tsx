import React, { useEffect, useRef, useState } from 'react';
import { Download, Share2, Copy } from 'lucide-react';
import { fetchPublicPage, profileLink, type PublicPageClient, type PublicTutorPage } from '../lib/publicTutorPage';
import {
  SHARE_CARD_COPY as COPY, canvasToPng, drawShareCard, drawWeeklyCard, launchCaption, parseWeeklyPost, weeklyCaption, type WeeklyPost,
} from '../lib/shareCard';

// The week-one share card and the weekly post on the Teach screen (JOBS CARD and WEEKLY). Loaded only when her page is on and she opens the Teach screen (lazy from
// PublicPageCard), so the canvas drawing and the QR code library are not part of any other screen. The pictures are made in her phone; nothing is sent anywhere.
// The weekly numbers come from the database (my_weekly_post: lessons COMPLETED in the last 7 days, counts only).

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
    draw(canvasRef.current).then(
      () => live && setState('ready'),
      () => live && setState('failed'),
    );
    return () => {
      live = false;
    };
  }, [draw]);

  const makeFile = async (): Promise<File | null> => {
    if (!canvasRef.current) return null;
    try {
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
      if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text: caption });
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
            <button type="button" onClick={save} className="min-h-9 px-3 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold cursor-pointer inline-flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" aria-hidden="true" />{COPY.download}
            </button>
            {canShareFiles && (
              <button type="button" onClick={share} className="min-h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold text-[#0F172A] cursor-pointer inline-flex items-center gap-1.5">
                <Share2 className="w-3.5 h-3.5" aria-hidden="true" />{COPY.share}
              </button>
            )}
          </div>
          <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`${idBase}-caption`}>{COPY.captionLabel}</label>
          <textarea id={`${idBase}-caption`} readOnly value={caption} rows={4} className="w-full text-[11px] text-slate-700 border border-slate-300 rounded-lg p-2 bg-white" />
          <button type="button" onClick={copyCaption} className="min-h-9 px-3 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold cursor-pointer inline-flex items-center gap-1.5">
            <Copy className="w-3.5 h-3.5" aria-hidden="true" />{copied ? COPY.copied : COPY.copyCaption}
          </button>
        </>
      )}
    </div>
  );
};

const ShareCard: React.FC<{ client: PublicPageClient; code: string }> = ({ client, code }) => {
  const [page, setPage] = useState<PublicTutorPage | null>(null);
  const [weekly, setWeekly] = useState<WeeklyPost | null>(null);
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

  const launchDraw = React.useCallback(
    (canvas: HTMLCanvasElement) => (page ? drawShareCard(canvas, { firstName: page.firstName, subjects: page.subjects, link }) : Promise.reject(new Error('no page'))),
    [page, link],
  );
  const weeklyDraw = React.useCallback(
    (canvas: HTMLCanvasElement) => (page && weekly ? drawWeeklyCard(canvas, { firstName: page.firstName, post: weekly, link }) : Promise.reject(new Error('no numbers'))),
    [page, weekly, link],
  );

  return (
    <>
      {page && page.subjects.length > 0 && (
        <CardPanel
          heading={COPY.heading}
          how={COPY.how}
          caption={launchCaption(page.subjects, link)}
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
