import React from 'react';
import { ledgerAmount, ledgerLineText, rand0, type LedgerLine } from '../lib/wallet';
import { formatSaDateTime } from '../lib/saTime';

interface WalletHistoryProps {
  lines: LedgerLine[];
  // The subject of the request / session a line names, when it could be read (the lines read fine without it).
  requestSubjects: Map<string, string>;
  sessionSubjects: Map<string, string>;
  tutorView: boolean;
}

// The wallet's history from the ledger, newest first, in words ("On hold for your Maths request", "Refund: session cancelled").
export const WalletHistory: React.FC<WalletHistoryProps> = ({ lines, requestSubjects, sessionSubjects, tutorView }) => {
  if (lines.length === 0) {
    return <p className="text-xs text-slate-500">Nothing has happened in your wallet yet.</p>;
  }
  return (
    <ul className="space-y-1.5" data-wallet-history>
      {lines.map((line) => {
        const subject = (line.requestId && requestSubjects.get(line.requestId)) || (line.sessionId && sessionSubjects.get(line.sessionId)) || null;
        const amount = ledgerAmount(line);
        return (
          <li key={line.id} className="bg-white rounded-xl px-3 py-2.5 border border-slate-200 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-bold text-[#0F172A]">{ledgerLineText(line, subject, tutorView)}</div>
              <div className="text-[10px] text-slate-500">{formatSaDateTime(line.createdAt)}</div>
            </div>
            <div className={`text-sm font-extrabold shrink-0 ${amount > 0 ? 'text-[#15803D]' : 'text-slate-600'}`}>
              {amount > 0 ? '+' : ''}{rand0(amount)}
            </div>
          </li>
        );
      })}
    </ul>
  );
};
