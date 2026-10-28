import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { CLOSE_COPY, ClosureResult, GENERIC_KEPT_LINE, formatClosureDate } from '../lib/closeAccount';

// The page a person lands on after closing their own account (src/pages/AccountClosed.tsx): what happens next (legal B5.1). The same
// words for everyone: the last line is the one the database gives to every closed person, held or not.
export const AccountClosedView: React.FC<{ result: ClosureResult | null; signInHref: string; supportEmail: string }> = ({ result, signInHref, supportEmail }) => (
  <div className="min-h-screen bg-[#FAF7F2] flex items-center justify-center p-4">
    <div className="bg-white rounded-3xl max-w-md w-full p-8 border border-slate-200 shadow-2xl text-sm text-slate-700 leading-relaxed space-y-4">
      <div className="flex items-center gap-2.5">
        <CheckCircle2 className="w-6 h-6 text-[#15803D]" />
        <h1 className="text-xl font-extrabold text-[#0F172A]">{CLOSE_COPY.closedTitle}</h1>
      </div>
      <p>{CLOSE_COPY.closedLead}</p>
      <ul className="list-disc pl-5 space-y-1.5">
        {result && result.sessionsCancelled > 0 && <li>{CLOSE_COPY.closedSessions(result.sessionsCancelled)}</li>}
        {result && result.deleteAfter && result.deleteBy ? (
          <li>{CLOSE_COPY.closedDelete(formatClosureDate(result.deleteAfter), formatClosureDate(result.deleteBy))}</li>
        ) : (
          <li>We delete your details within 30 days, and always within 90.</li>
        )}
        <li>
          {result && result.undoUntil
            ? CLOSE_COPY.closedUndo(formatClosureDate(result.undoUntil))
            : 'You can change your mind for 30 days: write to support and we will open your account again.'}{' '}
          <a href={`mailto:${supportEmail}`} className="font-bold text-[#15803D] hover:underline">{supportEmail}</a>
        </li>
        <li>{GENERIC_KEPT_LINE}</li>
      </ul>
      <a href={signInHref} className="inline-block text-xs font-bold text-[#15803D] hover:underline">{CLOSE_COPY.closedSignIn}</a>
    </div>
  </div>
);
