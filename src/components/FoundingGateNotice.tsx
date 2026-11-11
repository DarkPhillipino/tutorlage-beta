import React from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { FOUNDING_COPY, gateMessage, type FoundingGateState } from '../lib/foundingList';

// What the Teach button shows a person whose place has not opened (founding tutors list, drafts section 6). Pure (no database, no sign-in state), so a test can draw it;
// the checks that decide WHEN it shows are in FoundingGate.tsx.
export type BlockedGateState = Exclude<FoundingGateState, 'open' | 'released' | 'verified'>;

export const FoundingGateNotice: React.FC<{ state: BlockedGateState }> = ({ state }) => (
  <div data-founding-gate={state} className="max-w-md mx-auto w-full bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80 text-center">
    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
      <Lock className="w-5 h-5 text-slate-500" aria-hidden="true" />
    </div>
    <p role="status" className="text-sm font-semibold text-[#0F172A] leading-relaxed">{gateMessage(state)}</p>
    {state === 'not_listed' && (
      <Link to="/teach" className="mt-5 inline-flex items-center justify-center min-h-12 px-5 rounded-xl bg-[#15803D] hover:bg-[#166534] text-white font-bold text-sm">
        {FOUNDING_COPY.join}
      </Link>
    )}
  </div>
);

// The small version on the Teaching tab (where the document upload would be).
export const FoundingGateInline: React.FC<{ state: BlockedGateState }> = ({ state }) => (
  <div data-founding-gate={state} className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs font-semibold text-slate-700 leading-relaxed">
    {gateMessage(state)}
  </div>
);
