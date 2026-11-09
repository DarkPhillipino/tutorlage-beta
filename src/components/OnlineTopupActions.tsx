import React, { useRef, useState } from 'react';
import { ONLINE_COPY, checkOnlineTopup, startOnlinePayment } from '../lib/walletOnline';
import { goToBankPage, onlineRequest } from '../lib/walletOnlineHooks';

interface OnlineTopupActionsProps {
  topupId: string;
  // Called after "Check now" got an answer, so the list behind can read the top-up again.
  onChanged: () => void;
}

// The two buttons under an online top-up that is still waiting on the wallet page: "Continue to your bank" (the Worker gives back the same payment page
// while it is still valid) and "Check now" (the Worker looks again; it never credits by this click, the database does when the bank has confirmed).
export const OnlineTopupActions: React.FC<OnlineTopupActionsProps> = ({ topupId, onChanged }) => {
  const [busy, setBusy] = useState<'continue' | 'check' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const busyRef = useRef(false);

  const run = async (kind: 'continue' | 'check') => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setNote(null);
    try {
      if (kind === 'continue') {
        const started = await startOnlinePayment(onlineRequest, topupId);
        if ('redirectUrl' in started) {
          goToBankPage(started.redirectUrl);
        } else {
          setNote(started.message);
          // the top-up was closed behind the screen: read the list again so its line says so
          if (started.rowClosed) onChanged();
        }
      } else {
        const asked = await checkOnlineTopup(onlineRequest, topupId);
        if ('message' in asked) {
          setNote(asked.message);
        } else {
          setNote(ONLINE_COPY.checkedNothing);
          onChanged();
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  return (
    <div className="space-y-1" data-online-actions>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          onClick={() => void run('continue')}
          disabled={busy !== null}
          className="text-[11px] font-bold text-[#15803D] hover:underline disabled:opacity-60 cursor-pointer"
        >
          {busy === 'continue' ? ONLINE_COPY.opening : ONLINE_COPY.continueToBank}
        </button>
        <button
          onClick={() => void run('check')}
          disabled={busy !== null}
          className="text-[11px] font-bold text-slate-600 hover:underline disabled:opacity-60 cursor-pointer"
        >
          {busy === 'check' ? 'Checking…' : ONLINE_COPY.checkNow}
        </button>
      </div>
      {note && <p role="status" className="text-[11px] text-slate-600" data-online-note>{note}</p>}
    </div>
  );
};
