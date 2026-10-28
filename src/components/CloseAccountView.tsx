import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import {
  CLOSE_COPY,
  ClosurePreview,
  confirmationProblem,
  formatAmount,
  formatHours,
  formatSessionTime,
} from '../lib/closeAccount';

// What the close-account flow draws, for each step (src/components/CloseAccountFlow.tsx holds the state and makes the calls). Kept apart
// from the flow so a test can draw every step from plain props.

export type CloseStage = 'loading' | 'preview' | 'confirm' | 'working' | 'failed';

export interface CloseAccountViewProps {
  stage: CloseStage;
  // 'learner' is a guardian closing one child's account; 'self' is closing the signed-in person's own account.
  subject: 'self' | 'learner';
  learnerName?: string;
  preview: ClosurePreview | null;
  // False for someone who signs in with Google only: there is no password to ask for.
  needsPassword: boolean;
  word: string;
  password: string;
  error: string | null;
  symbolOf?: (code: string) => string;
  onWord: (value: string) => void;
  onPassword: (value: string) => void;
  onContinue: () => void;
  onBack: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const inputClass = 'w-full bg-slate-100 text-[#0F172A] placeholder-slate-400 text-sm font-semibold px-3.5 py-3 rounded-xl border border-transparent focus:outline-none focus:border-[#15803D] focus:bg-white focus:ring-2 focus:ring-[#15803D]/20 transition-all';
const labelClass = 'block text-xs font-bold text-slate-500 mb-1.5';

export const CloseAccountView: React.FC<CloseAccountViewProps> = (p) => {
  const { stage, preview, subject, learnerName } = p;

  if (stage === 'loading') {
    return (
      <div className="flex items-center text-slate-500 text-xs py-2" role="status">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> {CLOSE_COPY.loading}
      </div>
    );
  }

  if (stage === 'failed' || !preview) {
    return (
      <div className="space-y-3">
        <ErrorLine text={p.error ?? CLOSE_COPY.failed} />
        <button type="button" onClick={p.onCancel} className="text-xs font-bold text-slate-500 hover:underline cursor-pointer">
          {CLOSE_COPY.backButton}
        </button>
      </div>
    );
  }

  // The person whose account this is (first in the list), and anyone closed with them.
  const others = preview.accounts.slice(1);
  const problem = confirmationProblem(p.word, p.password, p.needsPassword);

  if (stage === 'preview') {
    return (
      <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
        <h4 className="text-sm font-extrabold text-[#0F172A]">
          {subject === 'learner' && learnerName ? CLOSE_COPY.previewTitleLearner(learnerName) : CLOSE_COPY.previewTitle}
        </h4>

        {others.length > 0 && subject === 'self' && (
          <div>
            <p className="font-bold text-[#0F172A]">{CLOSE_COPY.householdLead}</p>
            <ul className="list-disc pl-5 mt-1">
              {others.map((a) => <li key={a.profileId}>{a.name || 'Learner'}</li>)}
            </ul>
          </div>
        )}

        {preview.accounts.map((a) => (
          <div key={a.profileId} data-account={a.profileId}>
            {preview.accounts.length > 1 && <p className="font-bold text-[#0F172A]">{a.name || 'Learner'}</p>}
            {a.sessions.length === 0 ? (
              <p>{CLOSE_COPY.noSessions}</p>
            ) : (
              <>
                <p className="font-semibold">{CLOSE_COPY.sessions(a.sessions.length, a.role)}</p>
                <ul className="mt-1 space-y-0.5">
                  {a.sessions.map((s) => (
                    <li key={s.sessionId} className="text-slate-600">
                      {formatSessionTime(s.scheduledStart)} · {formatHours(s.durationHours)} · {formatAmount(s.amount, s.currency, p.symbolOf)}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {a.payoutOwed !== null && a.payoutOwed > 0 && (
              <p className="mt-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-semibold text-amber-900">
                {CLOSE_COPY.payoutOwed(formatAmount(a.payoutOwed, 'ZAR', p.symbolOf))}
              </p>
            )}
          </div>
        ))}

        <div>
          <p className="font-bold text-[#0F172A]">{CLOSE_COPY.deletedTitle}</p>
          <p>{CLOSE_COPY.deletedLead(preview.deleteAfterDays, preview.deleteByDays)}</p>
          <ul className="list-disc pl-5 mt-1">
            {preview.deleted.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>

        <div>
          <p className="font-bold text-[#0F172A]">{CLOSE_COPY.keptTitle}</p>
          <ul className="list-disc pl-5 mt-1">
            {preview.kept.map((k) => (
              <li key={k.what}>
                {k.what} <span className="text-slate-500">· {k.howLong}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5">{preview.note}</p>
        </div>

        <p>{CLOSE_COPY.undo(preview.undoDays)}</p>

        {preview.blocked && (
          <div role="alert" className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-2.5 font-semibold text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{preview.blockedMessage ?? CLOSE_COPY.busy}. {CLOSE_COPY.busyWhy}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-action="continue"
            onClick={p.onContinue}
            disabled={preview.blocked}
            className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer"
          >
            {CLOSE_COPY.continueButton}
          </button>
          <button type="button" data-action="cancel" onClick={p.onCancel} className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer">
            {CLOSE_COPY.cancelButton}
          </button>
        </div>
      </div>
    );
  }

  // stage is 'confirm' or 'working'
  const working = stage === 'working';
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!problem && !working) p.onConfirm(); }}
      className="space-y-3 text-xs text-slate-700 leading-relaxed"
    >
      <h4 className="text-sm font-extrabold text-[#0F172A]">{CLOSE_COPY.confirmTitle}</h4>
      <p>{CLOSE_COPY.confirmLead(subject === 'learner' && learnerName ? learnerName : null, p.needsPassword)}</p>

      {subject === 'self' && others.length > 0 && (
        <div>
          <p className="font-bold text-[#0F172A]">{CLOSE_COPY.householdLead}</p>
          <ul className="list-disc pl-5 mt-1">
            {others.map((a) => <li key={a.profileId}>{a.name || 'Learner'}</li>)}
          </ul>
        </div>
      )}

      {!p.needsPassword && <p className="text-slate-500">{CLOSE_COPY.googleNote}</p>}

      {p.error && <ErrorLine text={p.error} />}

      <div>
        <label className={labelClass} htmlFor="closeAccountWord">{CLOSE_COPY.wordLabel}</label>
        <input
          id="closeAccountWord"
          value={p.word}
          onChange={(e) => p.onWord(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          className={inputClass}
        />
      </div>
      {p.needsPassword && (
        <div>
          <label className={labelClass} htmlFor="closeAccountPassword">{CLOSE_COPY.passwordLabel}</label>
          <input
            id="closeAccountPassword"
            type="password"
            value={p.password}
            onChange={(e) => p.onPassword(e.target.value)}
            autoComplete="current-password"
            className={inputClass}
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          data-action="confirm"
          disabled={problem !== null || working}
          className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer flex items-center gap-1.5"
        >
          {working && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {working ? CLOSE_COPY.working : subject === 'learner' ? CLOSE_COPY.confirmButton : CLOSE_COPY.confirmButtonSelf}
        </button>
        <button type="button" data-action="back" onClick={p.onBack} disabled={working} className="bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer">
          {CLOSE_COPY.backButton}
        </button>
      </div>
    </form>
  );
};

const ErrorLine: React.FC<{ text: string }> = ({ text }) => (
  <div role="alert" className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-rose-700">
    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{text}</span>
  </div>
);
