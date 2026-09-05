import React, { useEffect, useState } from 'react';
import { Inbox, Check, X, Loader2, AlertCircle } from 'lucide-react';
import { IncomingSessionRequest } from '../types';
import { fetchIncomingSessionRequests, acceptSessionRequest, declineSessionRequest } from '../lib/queries';

interface IncomingSessionRequestsProps {
  tutorId: string;
}

// The tutor-facing accept/decline queue — the other end of "Book Session"
// on PricesPage.tsx. A student's booking creates a real, pending
// public.session_requests row; this is where the tutor actually sees it and
// turns it into a real public.sessions row (or declines it).
export const IncomingSessionRequests: React.FC<IncomingSessionRequestsProps> = ({ tutorId }) => {
  const [requests, setRequests] = useState<IncomingSessionRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setLoadError(false);
    fetchIncomingSessionRequests(tutorId)
      .then(setRequests)
      .catch((err) => {
        console.error('fetchIncomingSessionRequests failed:', err);
        setRequests([]);
        setLoadError(true);
      })
      .finally(() => setIsLoading(false));
  }, [tutorId, retryCount]);

  const handleAccept = async (request: IncomingSessionRequest) => {
    setError(null);
    setRespondingId(request.id);
    try {
      await acceptSessionRequest(request, tutorId);
      setRequests((prev) => prev.filter((r) => r.id !== request.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not accept that request.');
    } finally {
      setRespondingId(null);
    }
  };

  const handleDecline = async (requestId: string) => {
    setError(null);
    setRespondingId(requestId);
    try {
      await declineSessionRequest(requestId);
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not decline that request.');
    } finally {
      setRespondingId(null);
    }
  };

  return (
    <div className="bg-[#FAF7F2] rounded-2xl p-4 border border-slate-200">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Inbox className="w-3.5 h-3.5 text-[#15803D]" />
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Session Requests</span>
        </div>
        {requests.length > 0 && (
          <span className="text-[10px] font-bold bg-[#15803D] text-white px-2 py-0.5 rounded-full">{requests.length}</span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          <span className="text-xs font-semibold">Loading…</span>
        </div>
      ) : loadError ? (
        <div className="text-center py-4">
          <p className="text-xs font-semibold text-rose-600">Couldn't load session requests.</p>
          <button
            onClick={() => setRetryCount((c) => c + 1)}
            className="mt-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-[#0F172A] font-bold text-[11px] rounded-lg cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : requests.length === 0 ? (
        <p className="text-xs text-slate-500 py-1">No pending requests right now.</p>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => {
            const isResponding = respondingId === r.id;
            const requestedDate = new Date(r.requestedStart);
            return (
              <div key={r.id} className="bg-white rounded-xl p-3 border border-slate-200">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#0F172A] truncate">{r.studentName}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {r.subjectName ?? 'Any subject'}{r.gradeLevel ? ` · ${r.gradeLevel}` : ''}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {requestedDate.toLocaleDateString()} {requestedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {r.durationHours}h
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleAccept(r)}
                      disabled={isResponding}
                      className="p-1.5 rounded-full bg-emerald-100 hover:bg-emerald-200 text-[#15803D] transition-colors cursor-pointer disabled:opacity-50"
                      aria-label={`Accept request from ${r.studentName}`}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDecline(r.id)}
                      disabled={isResponding}
                      className="p-1.5 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-600 transition-colors cursor-pointer disabled:opacity-50"
                      aria-label={`Decline request from ${r.studentName}`}
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
