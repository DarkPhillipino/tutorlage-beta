import React, { useEffect, useRef, useState } from 'react';
import { Download, Share2, Copy } from 'lucide-react';
import { fetchPublicPage, profileLink, type PublicPageClient, type PublicTutorPage } from '../lib/publicTutorPage';
import { SHARE_CARD_COPY as COPY, canvasToPng, drawShareCard, launchCaption } from '../lib/shareCard';

// The week-one share card on the Teach screen (JOB CARD). Loaded only when her page is on and she opens the Teach screen (lazy from PublicPageCard), so the
// canvas drawing and the QR code library are not part of any other screen. The picture is made in her phone; nothing is sent anywhere.
const ShareCard: React.FC<{ client: PublicPageClient; code: string }> = ({ client, code }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState<PublicTutorPage | null>(null);
  const [state, setState] = useState<'making' | 'ready' | 'failed'>('making');
  const [copied, setCopied] = useState(false);
  const link = profileLink(code);

  useEffect(() => {
    let live = true;
    fetchPublicPage(client, code).then(async (p) => {
      if (!live) return;
      if (!p || p.subjects.length === 0 || !canvasRef.current) {
        setState('failed');
        return;
      }
      setPage(p);
      try {
        await drawShareCard(canvasRef.current, { firstName: p.firstName, subjects: p.subjects, link });
        if (live) setState('ready');
      } catch {
        if (live) setState('failed');
      }
    });
    return () => {
      live = false;
    };
  }, [client, code, link]);

  const caption = page ? launchCaption(page.subjects, link) : '';

  const makeFile = async (): Promise<File | null> => {
    if (!canvasRef.current) return null;
    try {
      const blob = await canvasToPng(canvasRef.current);
      return new File([blob], 'tutorlage-share-card.png', { type: 'image/png' });
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
    <div className="space-y-2 pt-2 border-t border-slate-200" data-testid="share-card">
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{COPY.heading}</p>
      <p className="text-[11px] text-slate-700 leading-relaxed">{COPY.how}</p>
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
          <label className="block text-[11px] font-semibold text-slate-600" htmlFor="share-caption">{COPY.captionLabel}</label>
          <textarea id="share-caption" readOnly value={caption} rows={4} className="w-full text-[11px] text-slate-700 border border-slate-300 rounded-lg p-2 bg-white" />
          <button type="button" onClick={copyCaption} className="min-h-9 px-3 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold cursor-pointer inline-flex items-center gap-1.5">
            <Copy className="w-3.5 h-3.5" aria-hidden="true" />{copied ? COPY.copied : COPY.copyCaption}
          </button>
        </>
      )}
    </div>
  );
};

export default ShareCard;
