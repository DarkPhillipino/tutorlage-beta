import React, { useEffect, useState } from 'react';
import { Inbox, Check, X, Loader2, AlertCircle } from 'lucide-react';
import { AvailableSessionRequest } from '../types';
import { fetchAvailableRequests, acceptAvailableRequest } from '../lib/queries';

interface AvailableRequestsQueueProps {
  tutorId: string;
}

// The tutor-facing side of anonymous matching: a browsable list of
// unclaimed requests (no student identity shown — that's the whole point,
// see AvailableSessionRequest in types.ts), filtered to ones this tutor is
// actually positioned to take. Accepting one is the only real action here;
// "Not for me" is a local-only dismiss (no DB write) so a tutor isn't
// stuck looking at a request they can't help with for the rest of this
// session — it stays visible to every other tutor and reappears for this
// one on next reload.
export const AvailableRequestsQueue: React.FC<AvailableRequestsQueueProps> = ({ tutorId }) => {
  const [requests, setRequests] = useState<AvailableSessionRequest[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setLoadError(false);
    fetchAvailableRequests(tutorId)
      .then(setRequests)
      .catch((err) => {
        console.error('fetchAvailableRequests failed:', err);
        setRequests([]);
        setLoadError(true);
      })
      .finally(() => setIsLoading(false));
  }, [tutorId, retryCount]);

  const visibleRequests = requests.filter((r) => !dismissedIds.has(r.id));

  const handleAccept = async (request: AvailableSessionRequest) => {
    setError(null);
    setAcceptingId(request.id);
    try {
      await acceptAvailableRequest(request, tutorId);
      setRequests((prev) => prev.filter((r) => r.id !== request.id));
    } catch (e) {
      // Someone else may have just claimed it — refresh so this tutor
      // isn't left staring at a request that's no longer really available.
      setError(e instanceof Error ? e.message : 'Could not accept that request.');
      setRetryCount((c) => c + 1);
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <div className="bg-[#FAF7F2] rounded-2xl p-4 border border-slate-200">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Inbox className="w-3.5 h-3.5 text-[#15803D]" />
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Available Requests</span>
        </div>
        {visibleRequests.length > 0 && (
          <span className="text-[10px] font-bold bg-[#15803D] text-white px-2 py-0.5 rounded-full">{visibleRequests.length}</span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          <span className="text-xs font-semibold">Loading…</span>
        </div>
      ) : loadError ? (
        <div className="text-center py-4">
          <p className="text-xs font-semibold text-rose-600">Couldn't load available requests.</p>
          <button
            onClick={() => setRetryCount((c) => c + 1)}
            className="mt-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-[#0F172A] font-bold text-[11px] rounded-lg cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : visibleRequests.length === 0 ? (
        <p className="text-xs text-slate-500 py-1">No requests available for you right now.</p>
      ) : (
        <div className="space-y-2">
          {visibleRequests.map((r) => {
            const isAccepting = acceptingId === r.id;
            const requestedDate = new Date(r.requestedStart);
            return (
              <div key={r.id} className="bg-white rounded-xl p-3 border border-slate-200">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#0F172A] truncate">
                      {r.subjectName ?? 'Any subject'}{r.gradeLevel ? ` · ${r.gradeLevel}` : ''}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {requestedDate.toLocaleDateString()} {requestedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {r.durationHours}h
                      {r.tierName ? ` · ${r.tierName}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleAccept(r)}
                      disabled={isAccepting}
                      className="p-1.5 rounded-full bg-emerald-100 hover:bg-emerald-200 text-[#15803D] transition-colors cursor-pointer disabled:opacity-50"
                      aria-label={`Accept ${r.subjectName ?? 'this'} request`}
                    >
                      {isAccepting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => setDismissedIds((prev) => new Set(prev).add(r.id))}
                      disabled={isAccepting}
                      className="p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors cursor-pointer disabled:opacity-50"
                      aria-label={`Not for me — hide ${r.subjectName ?? 'this'} request`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1.5 mt-2 text-[11px] text-rose-600 font-semibold">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
