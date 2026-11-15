import React, { useEffect, useState } from 'react';
import { Link2, MessageCircle } from 'lucide-react';
import {
  TUTOR_CODE_COPY, bonusLine, bonusPaidLine, familiesLine, fetchMyTutorCode, savingLine, shareText, tutorCodeLink, whatsappShareLink, type TutorCode, type TutorCodeClient,
} from '../lib/tutorCode';
import { promoDb } from '../lib/promoHooks';

// A tutor's own code on their earnings page (CEO, 10 Nov 2026): the code, its sign-up link, how many families have used it and, once the CEO switches the bonus on,
// what it has paid. A tutor with no code (or a database without the migration) sees nothing at all.
export const TutorCodeCard: React.FC<{ client?: TutorCodeClient }> = ({ client = promoDb as unknown as TutorCodeClient }) => {
  const [code, setCode] = useState<TutorCode | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    fetchMyTutorCode(client).then((c) => { if (live) setCode(c); });
    return () => { live = false; };
  }, [client]);

  if (!code) return null;
  const link = tutorCodeLink(code.code);
  const copy = () => {
    try {
      navigator.clipboard?.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };
  const paid = code.bonusOn ? bonusPaidLine(code) : null;

  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-2" data-tutor-code>
      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{TUTOR_CODE_COPY.title}</h4>
      <div className="text-xl font-extrabold text-[#0F172A] tracking-wide" data-tutor-code-value>{code.code}</div>
      {!code.active ? (
        <p className="text-xs text-amber-800 font-semibold">{TUTOR_CODE_COPY.paused}</p>
      ) : (
        <>
          <p className="text-xs text-slate-600">{savingLine(code)} {familiesLine(code.families)}</p>
          {code.bonusOn && <p className="text-xs text-slate-600" data-tutor-code-bonus>{bonusLine(code)}{paid ? ` ${paid}` : ''}</p>}
          <div className="text-xs font-semibold text-slate-700 break-all">{link}</div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={copy} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-[#0F172A] text-xs font-bold rounded-lg cursor-pointer inline-flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5" aria-hidden="true" /> {copied ? TUTOR_CODE_COPY.copied : TUTOR_CODE_COPY.copyLink}
            </button>
            <a href={whatsappShareLink(shareText(code))} target="_blank" rel="noopener noreferrer"
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-[#0F172A] text-xs font-bold rounded-lg inline-flex items-center gap-1.5">
              <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" /> {TUTOR_CODE_COPY.whatsapp}
            </a>
          </div>
          <span role="status" aria-live="polite" className="sr-only">{copied ? TUTOR_CODE_COPY.copied : ''}</span>
        </>
      )}
    </div>
  );
};
