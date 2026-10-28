import React from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ShieldAlert } from 'lucide-react';
import { SafetyHoldList, holdPagePath } from '../lib/safetyHolds';
import { formatWhen } from '../lib/safetyHold';

// The list on the "Safety holds" screen (loaded by pages/SafetyHolds.tsx). Kept apart from the page so it can be drawn in a test.
export const SafetyHoldsBody: React.FC<{ list: SafetyHoldList }> = ({ list }) => {
  if (list.state === 'not_active') {
    return (
      <div role="status" className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        {list.note}
      </div>
    );
  }
  if (list.holds.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center">
        <ShieldAlert className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm font-bold text-[#0F172A]">No one is on a safety hold</p>
        <p className="text-xs text-slate-500 mt-1">A hold is placed from a person&apos;s page, with a written reason.</p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
      {list.holds.map((h) => {
        const to = holdPagePath(h);
        return (
          <div key={h.profileId} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#0F172A] break-words">{h.name || h.email || 'Unnamed person'}</div>
                {h.name && h.email && <div className="text-xs text-slate-500 break-words">{h.email}</div>}
              </div>
              {to ? (
                <Link to={to} className="shrink-0 text-xs font-bold text-[#15803D] hover:underline">Open their page</Link>
              ) : (
                <span className="shrink-0 text-[11px] text-slate-400">No tutor page</span>
              )}
            </div>
            <p className="mt-2 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{h.reason}</p>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Placed by {h.placedBy || 'an admin'} · {formatWhen(h.placedAt)}
            </p>
          </div>
        );
      })}
    </div>
  );
};
