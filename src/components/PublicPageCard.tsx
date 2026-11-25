import React, { useEffect, useState } from 'react';
import { BooksOnConfirmNote } from './BooksOnConfirmNote';
import { Link2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import {
  PUBLIC_PAGE_COPY as COPY, fetchMyPublicProfile, profileLink, setMyPublicProfile, type MyPublicProfile, type PublicPageClient,
} from '../lib/publicTutorPage';

const ShareCard = React.lazy(() => import('./ShareCard'));

// The tutor's switch for her public page, /t/CODE, and "Copy my profile link" (CEO, 24 Nov 2026; job P slice 1). WAVE-MARKED: this is the ONLY change to the Teach screen for this job. Default OFF; switching on needs an
// explicit tick of the consent line; switching off is one tap and the page disappears at once. A tutor who is not approved, or has no code, sees one plain line and no switch. Anything that goes wrong
// shows nothing extra (the Teach screen is never held up by this card).
export const PublicPageCard: React.FC<{ client?: PublicPageClient }> = ({ client = supabase as unknown as PublicPageClient }) => {
  const [me, setMe] = useState<MyPublicProfile | null>(null);
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    fetchMyPublicProfile(client).then((m) => {
      if (live) setMe(m);
    });
    return () => {
      live = false;
    };
  }, [client]);

  if (!me || !me.isTutor) return null;

  const change = async (on: boolean) => {
    setBusy(true);
    setProblem(null);
    const err = await setMyPublicProfile(client, on);
    if (err) setProblem(err);
    else {
      setTicked(false);
      setMe(await fetchMyPublicProfile(client));
    }
    setBusy(false);
  };

  const link = me.code ? profileLink(me.code) : null;
  const copy = () => {
    if (!link) return;
    try {
      navigator.clipboard?.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* the link is shown, so it can still be copied by hand */
    }
  };

  return (
    <div className="bg-[#FAF7F2] rounded-2xl p-4 border border-slate-200 space-y-2" data-testid="public-page-card">
      <div className="flex items-center space-x-1.5">
        <Link2 className="w-3.5 h-3.5 text-[#15803D]" aria-hidden="true" />
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{COPY.cardTitle}</span>
      </div>
      {!me.canBePublic ? (
        <p className="text-[11px] text-slate-600 leading-relaxed">{COPY.cantYet}</p>
      ) : me.isPublic ? (
        <>
          <p className="text-[11px] text-slate-700 leading-relaxed">{COPY.cardOn}</p>
          <BooksOnConfirmNote />
          {link && <p className="text-[11px] font-mono text-slate-600 break-all">{link}</p>}
          {me.code && (
            <React.Suspense fallback={null}>
              <ShareCard client={client} code={me.code} />
            </React.Suspense>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copy} className="min-h-9 px-3 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold cursor-pointer">{copied ? COPY.copied : COPY.copy}</button>
            <button type="button" disabled={busy} onClick={() => change(false)} className="min-h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold text-[#0F172A] cursor-pointer disabled:opacity-50">{COPY.switchOff}</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[11px] text-slate-700 leading-relaxed">{COPY.cardOff}</p>
          <p className="text-[11px] text-slate-600 leading-relaxed">{COPY.consent}</p>
          <label className="flex items-start gap-2 text-[11px] font-semibold text-[#0F172A]">
            <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} className="mt-0.5" />
            {COPY.consentLabel}
          </label>
          <button type="button" disabled={busy || !ticked} onClick={() => change(true)} className="min-h-9 px-3 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold cursor-pointer disabled:opacity-50">{COPY.switchOn}</button>
        </>
      )}
      {problem && <p className="text-[11px] font-bold text-rose-600" role="alert">{problem}</p>}
    </div>
  );
};
