import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { cancelSession, cancelWaitingRequest } from '../lib/queries';
import { getErrorMessage } from '../lib/errors';
import { formatSaDateTime } from '../lib/saTime';
import { rand0 } from '../lib/wallet';
import {
  WATCH_COPY,
  detailsLine,
  endedSentence,
  endedTitle,
  payModeOf,
  sessionOverSentence,
  waitingLine,
  type WatchMode,
  type WatchView,
} from '../lib/requestWatch';

// The inside of the card on /payment/callback once the request has been READ (src/lib/requestWatch.ts decides what the row means). The page's heading and
// words sit in one polite live region, so a screen reader hears "A tutor said yes" / "Your session is booked" when the screen changes by itself.
// Cancelling uses the same two doors as the Sessions page (cancelWaitingRequest for a request still waiting, cancelSession for a booked session) and asks first.

export type ReadView = Exclude<WatchView, { kind: 'reading' } | { kind: 'fallback' }>;

interface Props {
  view: ReadView;
  mode: WatchMode;
  stopped: boolean;
  lookFailed: boolean;
  busy: boolean;
  onRefresh: () => void;
  // After a cancel went through: look again so the screen shows what the database now says.
  onCancelled: () => void | Promise<void>;
  onSessions: () => void;
  onNewRequest: () => void;
}

const primary = 'px-5 py-2.5 bg-[#15803D] text-white font-bold rounded-xl text-sm hover:bg-[#166534] transition-all cursor-pointer';
const secondary = 'px-5 py-2.5 bg-slate-100 text-[#0F172A] font-bold rounded-xl text-sm hover:bg-slate-200 transition-all cursor-pointer disabled:opacity-60';
const quiet = 'text-sm font-semibold text-slate-600 underline underline-offset-2 hover:text-[#0F172A] cursor-pointer py-2';

// Two steps, so a stray tap cannot cancel: the first press asks, the second does it.
function CancelAction({ label, note, onConfirm, onCancelled }: { label: string; note: string; onConfirm: () => Promise<void>; onCancelled: () => void | Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setWorking(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not cancel. Please try again.'));
      setWorking(false);
      return;
    }
    // The cancel went through: look again, so the screen changes to what the database now says. (If this card is gone by then, these are no-ops.)
    await onCancelled();
    setWorking(false);
    setAsking(false);
  };

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="text-sm font-bold text-rose-700 hover:underline cursor-pointer py-2" data-cancel-open>
        {label}
      </button>
    );
  }
  return (
    <div className="space-y-2" data-cancel-confirm>
      <p className="text-xs text-slate-700">{note}</p>
      <div className="flex flex-col sm:flex-row gap-2 justify-center">
        <button type="button" onClick={() => void confirm()} disabled={working} className="px-4 py-2 text-sm font-bold text-white bg-rose-700 hover:bg-rose-800 disabled:opacity-60 rounded-xl cursor-pointer">
          {working ? 'Cancelling…' : 'Yes, cancel'}
        </button>
        <button type="button" onClick={() => setAsking(false)} disabled={working} className="px-4 py-2 text-sm font-bold text-slate-700 hover:underline cursor-pointer">
          Keep it
        </button>
      </div>
      {error && (
        <p role="alert" className="flex items-center justify-center gap-1.5 text-xs text-rose-700 font-semibold">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

function Facts({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="text-left bg-[#FAF7F2] rounded-xl p-4 mb-5 space-y-2.5" data-request-facts>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-bold text-slate-600">{label}</dt>
          <dd className="text-sm font-bold text-[#0F172A]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const Badge = ({ children, tone }: { children: React.ReactNode; tone: 'good' | 'bad' | 'wait' }) => {
  if (tone === 'wait') {
    return (
      <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 mx-auto mb-4">
        <Clock className="w-8 h-8" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${tone === 'good' ? 'bg-emerald-100 text-[#15803D]' : 'bg-rose-100 text-rose-600'}`}>
      {children}
    </div>
  );
};

export function RequestWatchCard({ view, mode, stopped, lookFailed, busy, onRefresh, onCancelled, onSessions, onNewRequest }: Props) {
  const request = view.request;
  const payMode = payModeOf(request, mode);

  let tone: 'good' | 'bad' | 'wait' = 'wait';
  let title: string = WATCH_COPY.waitingTitle;
  let body: React.ReactNode = null;

  if (view.kind === 'waiting') {
    title = view.confirming ? WATCH_COPY.confirmingTitle : WATCH_COPY.waitingTitle;
    body = view.confirming ? WATCH_COPY.confirmingBody : WATCH_COPY.waitingLead;
  } else if (view.kind === 'booked') {
    tone = 'good';
    title = WATCH_COPY.bookedTitle;
    body = WATCH_COPY.bookedLead(view.session.tutorName);
  } else if (view.kind === 'booked_unseen') {
    tone = 'good';
    title = WATCH_COPY.bookedTitle;
    body = WATCH_COPY.bookedUnseenBody;
  } else if (view.kind === 'ended') {
    tone = 'bad';
    title = endedTitle(view.why);
    body = endedSentence(view.why, request);
  } else {
    tone = view.why === 'completed' ? 'good' : 'bad';
    title = view.why === 'completed' ? WATCH_COPY.sessionDoneTitle : WATCH_COPY.sessionCancelledTitle;
    body = sessionOverSentence(view, mode);
  }

  const price = request.holdRand ? rand0(request.holdRand) : null;

  return (
    <div data-request-watch={view.kind}>
      {tone === 'good' ? (
        <Badge tone="good"><CheckCircle2 className="w-8 h-8" aria-hidden="true" /></Badge>
      ) : tone === 'bad' ? (
        <Badge tone="bad"><XCircle className="w-8 h-8" aria-hidden="true" /></Badge>
      ) : (
        <Badge tone="wait">{null}</Badge>
      )}

      <div role="status" aria-live="polite" aria-atomic="true">
        <h1 className="text-lg font-extrabold text-[#0F172A] mb-1">{title}</h1>
        <p className="text-sm text-slate-700 mb-4">{body}</p>
      </div>

      {view.kind === 'waiting' && !view.confirming && (
        <>
          <Facts
            rows={[
              ['Lesson', detailsLine(request.subjectName, request.requestedStart, request.durationHours)],
              ...(payMode === 'wallet' && price ? ([['On hold in your wallet', price]] as Array<[string, string]>) : []),
            ]}
          />
          <p className="text-xs text-slate-700 mb-5">{waitingLine(payMode)}</p>
          {stopped && <p className="text-xs font-semibold text-slate-700 mb-3" data-watch-stopped>{WATCH_COPY.stopped}</p>}
        </>
      )}

      {view.kind === 'booked' && (
        <>
          <Facts
            rows={[
              ['Tutor', view.session.tutorName],
              ['When', `${formatSaDateTime(view.session.scheduledStart)} · ${view.session.durationHours}h`],
              ['Subject', view.session.subjectName ?? request.subjectName ?? 'Tutoring session'],
            ]}
          />
          {(payMode === 'wallet' || view.session.walletPaid) && <p className="text-xs font-semibold text-[#15803D] mb-2">{WATCH_COPY.paidFromWallet}</p>}
          <p className="text-xs text-slate-700 mb-5">{WATCH_COPY.bookedMeeting}</p>
        </>
      )}

      {lookFailed && <p className="text-xs text-slate-700 mb-3" data-watch-lookfailed>{WATCH_COPY.lookFailed}</p>}

      <div className="flex flex-col items-center gap-2">
        {view.kind === 'waiting' && !view.confirming && (
          <>
            {stopped && (
              <button type="button" onClick={onRefresh} disabled={busy} className={secondary}>
                {busy ? WATCH_COPY.checking : WATCH_COPY.checkNow}
              </button>
            )}
            <CancelAction
              label={WATCH_COPY.cancelRequest}
              note={WATCH_COPY.cancelRequestNote[payMode]}
              onConfirm={() => cancelWaitingRequest(request.id)}
              onCancelled={onCancelled}
            />
            <button type="button" onClick={onSessions} className={quiet}>{WATCH_COPY.viewSessions}</button>
          </>
        )}
        {view.kind === 'waiting' && view.confirming && <button type="button" onClick={onSessions} className={quiet}>{WATCH_COPY.viewSessions}</button>}
        {view.kind === 'booked' && (
          <>
            <button type="button" onClick={onSessions} className={primary}>{WATCH_COPY.viewSessions}</button>
            <CancelAction
              label={WATCH_COPY.cancelSession}
              note={WATCH_COPY.cancelSessionNote[view.session.walletPaid ? 'wallet' : payMode]}
              onConfirm={() => cancelSession(view.session.id)}
              onCancelled={onCancelled}
            />
          </>
        )}
        {view.kind === 'booked_unseen' && <button type="button" onClick={onSessions} className={primary}>{WATCH_COPY.viewSessions}</button>}
        {(view.kind === 'ended' || (view.kind === 'session_over' && view.why !== 'completed')) && (
          <>
            <button type="button" onClick={onNewRequest} className={primary}>{WATCH_COPY.newRequest}</button>
            <button type="button" onClick={onSessions} className={quiet}>{WATCH_COPY.viewSessions}</button>
          </>
        )}
        {view.kind === 'session_over' && view.why === 'completed' && <button type="button" onClick={onSessions} className={primary}>{WATCH_COPY.viewSessions}</button>}
      </div>
    </div>
  );
}
