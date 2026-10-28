import React, { useState } from 'react';
import { AlertCircle, ShieldAlert } from 'lucide-react';
import { ACCESS_LINES_SHOWN, DocumentAccessView, HOLD_NOT_ACTIVE, describeDocument, formatWhen } from '../lib/safetyHold';

// The screen for the "Document access and safety hold" section of a person's page (loaded by DocumentAccessCard.tsx).
// Part 1 is read-only: every line the access log holds about this person's documents (who opened which, when). Part 2 is the safety
// hold (CEO, 21 Oct 2026: the data must stay retrievable when a profile is reported for dangerous or illegal activities): a written
// reason to place it, a written note to release it, and the history of both. A hold only keeps this person's lines in the access log
// past the 3-year clean-up. It does not stop anything else being deleted, and the page says so.

interface Props {
  view: DocumentAccessView;
  busy: boolean;
  error: string | null;
  onPlace: (reason: string) => void;
  onRelease: (note: string) => void;
}

const field = 'w-full bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20';

export const DocumentAccessCardBody: React.FC<Props> = ({ view, busy, error, onPlace, onRelease }) => {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const placed = view.events.find((e) => e.event === 'placed');

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 mb-4">
      <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Who opened these documents</h2>
      {!view.logAvailable ? (
        <div role="status" className="flex items-start gap-1.5 mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          The document access log is not active on this database yet, so there are no lines to show.
        </div>
      ) : view.lines.length === 0 ? (
        <p className="text-xs text-slate-500 mb-3">No one has opened this person&apos;s documents since the log began.</p>
      ) : (
        <div className="mb-3 divide-y divide-slate-100 border border-slate-200 rounded-xl">
          {view.lines.map((l) => (
            <div key={l.id} className="px-3 py-2 text-xs flex flex-wrap items-baseline justify-between gap-x-4">
              <span className="font-bold text-[#0F172A]">{describeDocument(l)}{l.action === 'downloaded' ? ' (downloaded)' : ''}</span>
              <span className="text-slate-500">{l.adminLabel || 'An admin'} · {formatWhen(l.createdAt)}</span>
            </div>
          ))}
          {view.lines.length >= ACCESS_LINES_SHOWN && (
            <p className="px-3 py-2 text-[11px] text-slate-400">Showing the latest {ACCESS_LINES_SHOWN} lines.</p>
          )}
        </div>
      )}

      <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-5">Safety hold</h2>
      {!view.holdAvailable ? (
        <p className="text-xs text-slate-500">{HOLD_NOT_ACTIVE}</p>
      ) : (
        <>
          {view.onHold && placed ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 mb-3 text-xs text-rose-800">
              <p className="font-bold flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5" /> On safety hold since {formatWhen(placed.createdAt)}</p>
              <p className="mt-1">{placed.reason}</p>
              <p className="mt-0.5 text-rose-600">Placed by {placed.adminLabel || 'an admin'}</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 mb-3">No hold on this person.</p>
          )}
          {view.protectionsActive ? (
            <p className="text-[11px] text-slate-500 mb-3">
              A hold keeps this person&apos;s lines in the access log past the 3-year clean-up, keeps the video rooms they hosted or joined past
              the 30-day clean-up, and stops them removing or replacing their own documents. It does not stop closing or deleting their account,
              or the other automatic clean-ups (error records, waiting-list requests): check the Safety Holds list before deleting anything by hand.
            </p>
          ) : (
            <p className="text-[11px] text-slate-500 mb-3">
              A hold keeps this person&apos;s lines in the access log past the 3-year clean-up. It does not stop anything else being deleted:
              the person removing their own unverified documents, closing their account, or the other automatic clean-ups.
            </p>
          )}
          {open ? (
            <div className="space-y-2 mb-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                aria-label={view.onHold ? 'Note for releasing the hold' : 'Reason for the hold'}
                placeholder={view.onHold ? 'Why is the hold being released? (written down, needed)' : 'Why is a hold being placed? (written down, needed)'}
                className={field}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || text.trim().length < 3}
                  onClick={() => (view.onHold ? onRelease(text.trim()) : onPlace(text.trim()))}
                  className={`text-xs font-bold px-3 py-2 rounded-lg text-white disabled:opacity-50 cursor-pointer ${view.onHold ? 'bg-[#15803D]' : 'bg-rose-600'}`}
                >
                  {view.onHold ? 'Release the hold' : 'Place the hold'}
                </button>
                <button type="button" onClick={() => { setOpen(false); setText(''); }} className="text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 text-slate-600 cursor-pointer">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer mb-3"
            >
              {view.onHold ? 'Release the hold…' : 'Place a safety hold…'}
            </button>
          )}
          {view.events.length > 0 && (
            <div className="border-t border-slate-100 pt-2 space-y-1">
              {view.events.map((e) => (
                <p key={e.seq} className="text-[11px] text-slate-500">
                  <span className="font-bold text-slate-700">{e.event === 'placed' ? 'Hold placed' : 'Hold released'}</span> · {formatWhen(e.createdAt)} · {e.adminLabel || 'an admin'} · {e.reason}
                </p>
              ))}
            </div>
          )}
        </>
      )}
      {error && (
        <div className="flex items-center gap-1.5 mt-2 text-xs text-rose-600 font-semibold">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
};
