import React, { useEffect, useState } from 'react';
import { Loader2, ScrollText } from 'lucide-react';
import { fetchAuditLog } from '../lib/queries';
import { AuditLogEntry } from '../types';

const ACTION_LABELS: Record<string, string> = {
  tutor_approved: 'Tutor approved',
  tutor_rejected: 'Tutor rejected',
  tutor_suspended: 'Tutor suspended',
  user_banned: 'User banned',
  dispute_resolved: 'Dispute resolved',
  refund_issued: 'Refund issued',
  payout_batch_executed: 'Payout batch executed',
  manual_tier_override: 'Manual tier override',
  system_setting_updated: 'System setting updated',
  date_of_birth_recorded: 'Date of birth recorded',
};

export const AuditLog: React.FC = () => {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchAuditLog().then(setEntries).catch(() => setEntries([])).finally(() => setIsLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-[#0F172A] mb-1">Audit Log</h1>
      <p className="text-sm text-slate-500 mb-6">Every action taken from this admin app, in one place — the receipts for everything above.</p>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm font-semibold">Loading audit log…</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center">
          <ScrollText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-bold text-[#0F172A]">No admin actions logged yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          {entries.map((e) => (
            <div key={e.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#0F172A]">{ACTION_LABELS[e.action] ?? e.action}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {e.adminName ?? 'Unknown admin'} · {e.targetEntityType} <span className="font-mono text-[10px]">{e.targetEntityId.slice(0, 8)}</span>
                </div>
              </div>
              <span className="text-[11px] text-slate-400 shrink-0">{new Date(e.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
