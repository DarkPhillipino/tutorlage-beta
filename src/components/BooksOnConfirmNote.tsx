import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { acceptCurrentPolicies } from '../lib/queries';
import { getErrorMessage } from '../lib/errors';
import { siteUrl } from '../lib/siteUrl';
import { fetchMyPublicProfile, type PublicPageClient } from '../lib/publicTutorPage';
import { BOOKS_ON_CONFIRM_SENTENCE, OFFER_COPY, offersNewTerms } from '../lib/pageConfirm';

// On the working-hours screen and under "Your public page" (PM line 81 C). A tutor who books on confirm is told so. A tutor with a public page who has not
// yet accepted the new Terms is told what changes and asked to accept: the app never asks for a newer version by itself, and nothing changes until the
// tutor presses the button (the acceptance is recorded by the database, as every other one is). If a question cannot be asked, nothing is shown.
export const BooksOnConfirmNote: React.FC<{ tutorId?: string }> = ({ tutorId }) => {
  const [state, setState] = useState<'none' | 'on' | 'offer'>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const on = await supabase.rpc('my_page_books_on_confirm');
        if (on.data === true) {
          if (alive) setState('on');
          return;
        }
        const pending = await supabase.rpc('my_pending_acceptances');
        if (!offersNewTerms(pending.data)) {
          if (alive) setState('none');
          return;
        }
        const me = await fetchMyPublicProfile(supabase as unknown as PublicPageClient);
        if (alive) setState(me?.isTutor && me.isPublic ? 'offer' : 'none');
      } catch {
        if (alive) setState('none');
      }
    })();
    return () => {
      alive = false;
    };
  }, [tutorId, round]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await acceptCurrentPolicies();
      setRound((n) => n + 1);
    } catch (e) {
      setError(getErrorMessage(e, OFFER_COPY.failed));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'none') return null;
  if (state === 'on') {
    return (
      <p data-books-on-confirm className="text-xs font-semibold text-[#0F172A] bg-white border border-slate-300 rounded-xl px-3 py-2 mb-3">
        {BOOKS_ON_CONFIRM_SENTENCE}
      </p>
    );
  }
  return (
    <div data-books-offer className="bg-white border-2 border-[#0F172A] rounded-xl px-3 py-3 mb-3 space-y-2">
      <p className="text-xs font-extrabold text-[#0F172A]">{OFFER_COPY.heading}</p>
      <p className="text-xs text-slate-700">{OFFER_COPY.body}</p>
      <p className="text-xs text-slate-700">
        <a href={siteUrl('/terms')} target="_blank" rel="noopener noreferrer" className="font-bold text-[#15803D] underline">{OFFER_COPY.terms}</a>
        {' · '}
        <a href={siteUrl('/privacy')} target="_blank" rel="noopener noreferrer" className="font-bold text-[#15803D] underline">{OFFER_COPY.privacy}</a>
      </p>
      {error && <p role="alert" className="text-xs font-semibold text-rose-700">{error}</p>}
      <button type="button" onClick={() => void accept()} disabled={busy} className="bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold px-4 min-h-11 rounded-lg cursor-pointer">
        {busy ? OFFER_COPY.saving : OFFER_COPY.accept}
      </button>
    </div>
  );
};
