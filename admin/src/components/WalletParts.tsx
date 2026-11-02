import React, { useState } from 'react';
import { AlertCircle, Check, Copy, Loader2 } from 'lucide-react';

// Small pieces shared by the four wallet tabs (Payments page). Plain, like the rest of the admin app.

export const Loading: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-center justify-center py-10 text-slate-400" role="status">
    <Loader2 className="w-5 h-5 animate-spin mr-2" />
    <span className="text-sm font-semibold">{text}</span>
  </div>
);

// What a tab shows when the wallet is not on this database, or a call failed: said in words, with a way to try again. Never a crash.
export const NotAvailable: React.FC<{ message: string; onRetry?: () => void; failed?: boolean }> = ({ message, onRetry, failed }) => (
  <div role={failed ? 'alert' : 'status'} className={`rounded-2xl border p-4 text-sm flex items-start gap-2 ${failed ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
    <div className="flex-1">
      <p className="font-semibold">{failed ? `This could not be loaded: ${message}` : message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 text-xs font-bold px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 cursor-pointer">Try again</button>
      )}
    </div>
  </div>
);

export const Empty: React.FC<{ text: string }> = ({ text }) => (
  <div className="bg-white rounded-2xl p-6 border border-slate-200 text-sm text-slate-500">{text}</div>
);

export const Pill: React.FC<{ tone: 'red' | 'amber' | 'green' | 'slate'; children: React.ReactNode }> = ({ tone, children }) => {
  const tones = { red: 'bg-rose-50 text-rose-700 border-rose-200', amber: 'bg-amber-50 text-amber-800 border-amber-200', green: 'bg-emerald-50 text-emerald-700 border-emerald-200', slate: 'bg-slate-100 text-slate-600 border-slate-200' };
  return <span className={`inline-block text-[10px] font-bold rounded-full border px-2 py-0.5 ${tones[tone]}`}>{children}</span>;
};

// Copies a reference so it can be pasted into the banking app's search. Falls back to nothing when the clipboard is not available.
export const CopyButton: React.FC<{ text: string; label: string }> = ({ text, label }) => {
  const [done, setDone] = useState(false);
  const copy = () => {
    try {
      void navigator.clipboard?.writeText(text).then(() => {
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      });
    } catch {
      // No clipboard: the reference is still readable on the screen.
    }
  };
  return (
    <button type="button" onClick={copy} aria-label={label} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-[#15803D] cursor-pointer">
      {done ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {done ? 'Copied' : 'Copy'}
    </button>
  );
};

export const FieldLabel: React.FC<{ htmlFor: string; children: React.ReactNode }> = ({ htmlFor, children }) => (
  <label htmlFor={htmlFor} className="block text-[11px] font-bold text-slate-500 mb-1">{children}</label>
);
export const inputClass = 'w-full bg-slate-100 text-sm font-semibold text-[#0F172A] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20 disabled:opacity-60';

// The "are you sure" box under a button that moves money.
export const ConfirmBox: React.FC<{ text: string; yes: string; busy: boolean; onYes: () => void; onNo: () => void; danger?: boolean }> = ({ text, yes, busy, onYes, onNo, danger }) => (
  <div role="alertdialog" aria-label="Confirm" className={`mt-3 rounded-xl border p-3 ${danger ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'}`}>
    <p className="text-sm font-bold text-[#0F172A] mb-2">{text}</p>
    <div className="flex gap-2">
      <button type="button" onClick={onYes} disabled={busy} className={`text-xs font-bold text-white px-3 py-2 rounded-lg disabled:opacity-60 cursor-pointer ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#15803D] hover:bg-[#166534]'}`}>
        {busy ? 'Working…' : yes}
      </button>
      <button type="button" onClick={onNo} disabled={busy} className="text-xs font-bold text-slate-600 px-3 py-2 rounded-lg bg-white border border-slate-200 disabled:opacity-60 cursor-pointer">Go back</button>
    </div>
  </div>
);

export const ErrorLine: React.FC<{ text: string | null }> = ({ text }) =>
  text ? <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">{text}</p> : null;
