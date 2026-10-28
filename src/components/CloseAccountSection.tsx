import React, { useState } from 'react';
import { CLOSE_COPY, CloseAccountSetup, ClosureClient, ClosureResult } from '../lib/closeAccount';
import { CloseAccountFlow } from './CloseAccountFlow';

// "Close my account", at the bottom of the account details in the manage-account modal (legal B1: the person, signed in).
// An adult learner, a guardian or a tutor gets the flow; a learner under 18 gets a line and no button (their guardian closes it);
// an admin sees nothing (admin accounts are closed another way).

interface CloseAccountSectionProps {
  client: ClosureClient;
  setup: CloseAccountSetup;
  symbolOf?: (code: string) => string;
  // The caller signs the person out and shows the closing page.
  onClosed: (result: ClosureResult) => void;
}

export const CloseAccountSection: React.FC<CloseAccountSectionProps> = ({ client, setup, symbolOf, onClosed }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (setup.mode === 'none') return null;

  return (
    <div id="close-my-account" className="bg-white rounded-2xl p-4 border border-slate-200">
      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{CLOSE_COPY.sectionTitle}</div>
      {setup.mode === 'minor' ? (
        <p className="text-xs text-slate-600 leading-relaxed mt-1.5">{CLOSE_COPY.minorNote}</p>
      ) : isOpen ? (
        <div className="mt-2">
          <CloseAccountFlow client={client} setup={setup} symbolOf={symbolOf} onCancel={() => setIsOpen(false)} onClosed={onClosed} />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 mt-1.5">
          <p className="text-xs text-slate-600 leading-relaxed">{CLOSE_COPY.sectionLead}</p>
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="shrink-0 px-3 py-1.5 bg-slate-100 hover:bg-rose-50 text-rose-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
          >
            {CLOSE_COPY.openButton}
          </button>
        </div>
      )}
    </div>
  );
};
