import React from 'react';
import { AlertCircle } from 'lucide-react';
import { ACCESS_LOG_NOT_ACTIVE_NOTE } from '../lib/documentAccess';

// Shown after a document was opened on a database that has no document access log yet (migration 20261021100000 not applied).
export const AccessLogNote: React.FC<{ show: boolean }> = ({ show }) =>
  show ? (
    <div role="status" className="flex items-start gap-1.5 mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      {ACCESS_LOG_NOT_ACTIVE_NOTE}
    </div>
  ) : null;
