import React, { useRef, useState } from 'react';
import { CheckCircle2, Loader2, MessageSquarePlus } from 'lucide-react';
import { SUGGESTION_COPY, SUGGESTION_MAX_CHARS, sendSuggestion, suggestionLength, type SuggestionClient } from '../lib/platformSuggestions';

interface PlatformSuggestionBoxProps {
  // The signed-in person. The box is for signed-in people only: the page does not draw it without one.
  userId: string;
  // The database client (the app passes suggestionDb from lib/suggestionDb.ts; a test hands in a fake). Not imported here, so this file loads under Node.
  client: SuggestionClient;
  // Test only: draw a given state without running the effects (server-rendered markup has no effects).
  initialText?: string;
  initialStatus?: 'writing' | 'sent';
  initialError?: string | null;
}

// "Suggestions": one box on the learn dashboard, above the footer (CEO, 5 Nov 2026). One text box (up to 1,000 characters), a Send button, a thank-you.
// What a person writes is shown only inside the box they type in and is never put on the page as HTML. The text stays in the box when a send fails.
export const PlatformSuggestionBox: React.FC<PlatformSuggestionBoxProps> = ({
  userId,
  client,
  initialText = '',
  initialStatus = 'writing',
  initialError = null,
}) => {
  const [text, setText] = useState(initialText);
  const [status, setStatus] = useState<'writing' | 'sending' | 'sent'>(initialStatus);
  const [error, setError] = useState<string | null>(initialError);
  const sendingRef = useRef(false);
  const used = suggestionLength(text);

  const handleSend = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setStatus('sending');
    setError(null);
    const result = await sendSuggestion(client, userId, text);
    sendingRef.current = false;
    // ('message' in result), not result.ok: this project's type check is not in strict mode, where the true/false split does not narrow.
    if ('message' in result) {
      setError(result.message);
      setStatus('writing');
    } else {
      setText('');
      setStatus('sent');
    }
  };

  return (
    <section
      aria-labelledby="platform-suggestions-heading"
      data-platform-suggestion-box
      className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-slate-200/80"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 text-[#15803D] flex items-center justify-center shrink-0">
          <MessageSquarePlus className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="platform-suggestions-heading" className="text-xl font-extrabold text-[#0F172A] tracking-tight">{SUGGESTION_COPY.heading}</h2>
          <p className="text-sm text-slate-600 mt-0.5">{SUGGESTION_COPY.intro}</p>

          {status === 'sent' ? (
            <div role="status" data-suggestion-sent className="mt-4 flex flex-wrap items-center gap-3">
              <p className="inline-flex items-center gap-2 text-sm font-bold text-[#15803D]">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {SUGGESTION_COPY.thanks}
              </p>
              <button
                type="button"
                onClick={() => setStatus('writing')}
                className="text-xs font-bold text-slate-600 hover:text-[#0F172A] underline cursor-pointer"
              >
                {SUGGESTION_COPY.another}
              </button>
            </div>
          ) : (
            <div className="mt-4">
              <label htmlFor="platform-suggestion-text" className="sr-only">{SUGGESTION_COPY.label}</label>
              <textarea
                id="platform-suggestion-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={SUGGESTION_MAX_CHARS}
                rows={4}
                disabled={status === 'sending'}
                placeholder={SUGGESTION_COPY.placeholder}
                aria-describedby="platform-suggestion-help"
                className="w-full bg-[#FAF7F2] border border-slate-200 rounded-xl px-4 py-3 text-sm text-[#0F172A] placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20 resize-y disabled:opacity-60"
              />
              <div id="platform-suggestion-help" className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-slate-500">{SUGGESTION_COPY.privacy}</p>
                <p className="text-[11px] text-slate-500" aria-live="off">{used} / {SUGGESTION_MAX_CHARS}</p>
              </div>
              {error && (
                <p role="alert" data-suggestion-error className="mt-2 text-xs font-semibold text-rose-600">{error}</p>
              )}
              <button
                type="button"
                onClick={handleSend}
                disabled={status === 'sending' || text.trim().length === 0}
                className="mt-3 inline-flex items-center gap-2 px-5 py-2.5 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-sm font-bold rounded-xl cursor-pointer disabled:cursor-not-allowed"
              >
                {status === 'sending' && <Loader2 className="w-4 h-4 animate-spin" />}
                {status === 'sending' ? SUGGESTION_COPY.sending : SUGGESTION_COPY.button}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
