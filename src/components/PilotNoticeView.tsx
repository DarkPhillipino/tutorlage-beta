import React from 'react';
import { Info } from 'lucide-react';
import type { PilotNotice } from '../lib/topupNotice';

// The pilot notice, drawn (pure: the words come in as a prop). Plain text only: nothing in the notice is ever put on the page as HTML.
export const PilotNoticeView: React.FC<{ notice: PilotNotice | null; className?: string }> = ({ notice, className = '' }) => {
  if (!notice || !notice.enabled || !notice.text) return null;
  return (
    <div
      role="note"
      data-pilot-notice
      className={`flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 ${className}`}
    >
      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-700" aria-hidden="true" />
      <p>{notice.text}</p>
    </div>
  );
};
