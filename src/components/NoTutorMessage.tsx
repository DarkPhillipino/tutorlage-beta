import React from 'react';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import { ALL_FULLY_BOOKED, CHANGE_YOUR_TIME, NOT_A_PROMISE, NO_TUTOR_FOR_SUBJECT, formatWindow, type NoTutorReason } from '../lib/noTutorReason';

// P5-b (CEO, 21 Nov 2026): the three reasons a learner can be shown no tutor, each in its own words. Case 1 is red (text-red-700 on white, 6.5:1)
// and also has an icon and the words, so colour is never the only signal. Time frames are a list, soonest first, in South African time.
export function NoTutorMessage({ reason }: { reason: NoTutorReason }) {
  if (reason.kind === 'no_subject') {
    return (
      <p data-no-tutor-case="no_subject" className="mt-1 inline-flex items-start justify-center gap-1.5 text-sm font-bold text-red-700">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
        <span>{NO_TUTOR_FOR_SUBJECT}</span>
      </p>
    );
  }
  if (reason.kind === 'fully_booked') {
    return (
      <p data-no-tutor-case="fully_booked" className="mt-1 text-sm font-bold text-[#0F172A]">
        {ALL_FULLY_BOOKED}
      </p>
    );
  }
  return (
    <div data-no-tutor-case="other_time" className="mt-1 max-w-md mx-auto text-left">
      <p className="text-sm font-bold text-[#0F172A]">{CHANGE_YOUR_TIME}</p>
      <ul className="mt-3 space-y-2 list-none p-0 m-0">
        {reason.windows.map((w) => (
          <li key={`${w.date}-${w.from}-${w.to}`} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-[#0F172A]">
            <CalendarClock className="w-4 h-4 text-[#15803D] shrink-0" aria-hidden="true" />
            <span>{formatWindow(w)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-slate-600">{NOT_A_PROMISE}</p>
    </div>
  );
}
