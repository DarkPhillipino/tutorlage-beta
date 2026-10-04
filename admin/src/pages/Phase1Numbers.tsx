import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { fetchPhase1Metrics } from '../lib/queries';
import { getErrorMessage } from '../lib/errors';
import { Phase1Metrics } from '../types';

// Test phase 1's evidence (backlog 7ad): how fast requests get accepted, how
// many never are, and how sessions end. Classmates answer faster than
// strangers will, so read acceptance times as a best case.

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  return hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} days`;
}

const Stat: React.FC<{ label: string; value: string | number; note?: string }> = ({ label, value, note }) => (
  <div className="bg-white rounded-2xl p-4 border border-slate-200">
    <div className="text-2xl font-extrabold text-[#0F172A]">{value}</div>
    <div className="text-xs font-bold text-slate-500 mt-1">{label}</div>
    {note && <div className="text-[11px] text-slate-400 mt-0.5">{note}</div>}
  </div>
);

export const Phase1Numbers: React.FC = () => {
  const [metrics, setMetrics] = useState<Phase1Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = () => {
    setIsLoading(true);
    setError(null);
    fetchPhase1Metrics()
      .then(setMetrics)
      .catch((e) => setError(getErrorMessage(e, 'Could not load the numbers.')))
      .finally(() => setIsLoading(false));
  };

  useEffect(load, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-extrabold text-[#0F172A]">Phase 1 numbers</h1>
        <button
          onClick={load}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-[#0F172A] disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Everything on this database, from the first request. Testers know each other, so acceptance times are a
        best case, not what strangers would see.
      </p>

      {isLoading && !metrics ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm font-semibold">Loading…</span>
        </div>
      ) : error ? (
        <p className="text-sm font-semibold text-rose-600">{error}</p>
      ) : metrics ? (
        <div className="space-y-6">
          <section>
            <h2 className="text-sm font-extrabold text-[#0F172A] mb-2">Requests</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Sent to tutors" value={metrics.requestsSent} note="card check passed" />
              <Stat
                label="Accepted"
                value={metrics.requestsAccepted}
                note={metrics.acceptanceRatePct === null ? undefined : `${metrics.acceptanceRatePct}% of those decided`}
              />
              <Stat label="Expired, nobody accepted" value={metrics.requestsExpired} note="never charged" />
              <Stat label="Still waiting" value={metrics.requestsWaiting} />
              <Stat label="Median time to accept" value={formatMinutes(metrics.medianMinutesToAccept)} note="from sending the request" />
              <Stat label="Slowest accept" value={formatMinutes(metrics.slowestMinutesToAccept)} />
              <Stat label="Cancelled before a match" value={metrics.requestsCancelled} />
              <Stat label="Charge failures" value={metrics.chargeFailures} note="see Payments" />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-extrabold text-[#0F172A] mb-2">Sessions</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Booked, not yet done" value={metrics.sessionsScheduled} />
              <Stat label="Completed by the tutor" value={metrics.sessionsCompletedByTutor} />
              <Stat label="Completed automatically" value={metrics.sessionsCompletedAutomatically} note="estimated from timing" />
              <Stat
                label="Cancelled"
                value={metrics.sessionsCancelledByLearner + metrics.sessionsCancelledByTutor}
                note={`${metrics.sessionsCancelledByLearner} by learners, ${metrics.sessionsCancelledByTutor} by tutors`}
              />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-extrabold text-[#0F172A] mb-2">Quality</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Ratings" value={metrics.ratingsCount} />
              <Stat label="Average rating" value={metrics.averageRating === null ? '—' : metrics.averageRating.toFixed(2)} />
              <Stat label="Problem reports open" value={metrics.problemReportsOpen} note={`${metrics.problemReportsTotal} in total — see Disputes`} />
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
};
