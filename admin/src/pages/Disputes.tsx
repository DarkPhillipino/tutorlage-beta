import React, { useEffect, useState } from 'react';
import { Loader2, AlertTriangle, X } from 'lucide-react';
import { fetchDisputes, resolveDispute } from '../lib/queries';
import { useAdminAuth } from '../lib/AuthContext';
import { Dispute, DisputeStatus } from '../types';
import { getErrorMessage } from '../lib/errors';

const STATUS_COLORS: Record<DisputeStatus, string> = {
  open: 'bg-rose-100 text-rose-700',
  under_investigation: 'bg-amber-100 text-amber-700',
  resolved_payout: 'bg-emerald-100 text-emerald-700',
  resolved_refunded: 'bg-emerald-100 text-emerald-700',
  dismissed: 'bg-slate-100 text-slate-600',
};

const ResolveModal: React.FC<{ dispute: Dispute; onClose: () => void; onResolved: () => void }> = ({ dispute, onClose, onResolved }) => {
  const { adminProfile } = useAdminAuth();
  const [status, setStatus] = useState<DisputeStatus>('resolved_payout');
  const [notes, setNotes] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!adminProfile || !notes.trim()) {
      setError('Add resolution notes.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await resolveDispute(
        dispute.id, adminProfile.id, status, notes,
        status === 'resolved_refunded' && refundAmount ? Number(refundAmount) : undefined
      );
      onResolved();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not resolve this dispute.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-extrabold text-[#0F172A]">Resolve Dispute</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-100 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-xs text-slate-500 mb-4">{dispute.description}</p>

        <label className="block text-xs font-bold text-slate-500 mb-1.5">Resolution</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as DisputeStatus)}
          className="w-full bg-slate-100 text-sm font-semibold text-[#0F172A] rounded-xl px-3 py-2.5 mb-3 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
        >
          <option value="resolved_payout">Resolved — tutor keeps payout</option>
          <option value="resolved_refunded">Resolved — refund student</option>
          <option value="dismissed">Dismissed</option>
          <option value="under_investigation">Still investigating</option>
        </select>

        {status === 'resolved_refunded' && (
          <>
            <label className="block text-xs font-bold text-slate-500 mb-1.5">Refund amount ({dispute.currencyCode ?? 'ZAR'})</label>
            <input
              type="number"
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              className="w-full bg-slate-100 text-sm font-semibold text-[#0F172A] rounded-xl px-3 py-2.5 mb-3 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
            />
          </>
        )}

        <label className="block text-xs font-bold text-slate-500 mb-1.5">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full bg-slate-100 text-sm font-semibold text-[#0F172A] rounded-xl px-3 py-2.5 mb-3 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
        />

        {error && <p className="text-xs text-rose-600 font-semibold mb-3">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white font-bold py-2.5 rounded-xl text-sm cursor-pointer"
        >
          Confirm Resolution
        </button>
      </div>
    </div>
  );
};

export const Disputes: React.FC = () => {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [resolving, setResolving] = useState<Dispute | null>(null);

  const load = () => {
    setIsLoading(true);
    fetchDisputes().then(setDisputes).catch(() => setDisputes([])).finally(() => setIsLoading(false));
  };

  useEffect(load, []);

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-[#0F172A] mb-6">Disputes</h1>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm font-semibold">Loading disputes…</span>
        </div>
      ) : disputes.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center">
          <AlertTriangle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-bold text-[#0F172A]">No disputes</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          {disputes.map((d) => (
            <div key={d.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-[#0F172A] capitalize">{d.reason.replace(/_/g, ' ')}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[d.status]}`}>
                    {d.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5 truncate max-w-md">{d.description}</p>
                <p className="text-[11px] text-slate-400 mt-1">Raised by {d.raisedByName} · {new Date(d.createdAt).toLocaleDateString()}</p>
              </div>
              {(d.status === 'open' || d.status === 'under_investigation') && (
                <button
                  onClick={() => setResolving(d)}
                  className="shrink-0 px-3 py-2 bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-bold rounded-xl cursor-pointer"
                >
                  Resolve
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {resolving && (
        <ResolveModal
          dispute={resolving}
          onClose={() => setResolving(null)}
          onResolved={() => { setResolving(null); load(); }}
        />
      )}
    </div>
  );
};
