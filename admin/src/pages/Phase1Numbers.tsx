import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { fetchKeepOrSwapCounts, fetchPhase1Metrics, fetchSessionOutcomes, fetchWaitlistDemand } from '../lib/queries';
import { getErrorMessage } from '../lib/errors';
import { Phase1Metrics } from '../types';
import { REBOOK_WINDOW_DAYS, SessionOutcomes } from '../lib/sessionOutcomes';
import { WaitlistDemand } from '../lib/waitlistDemand';
import { KeepOrSwapCounts } from '../lib/keepOrSwapCounts';

// Test phase 1's evidence (backlog 7ad): how fast requests get accepted, how
// many never are, and how sessions end. Classmates answer faster than
// strangers will, so read acceptance times as a best case.
// "Successful sessions" (backlog 7cy, the CEO agreed on 14 Oct 2026) measures
// whether a match worked well enough to continue, not just whether it was paid.
// "Waiting for a tutor" (backlog 7cz) shows unmet demand by subject and grade;
// it hides itself until the waiting-list migration is on the database.

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
  const [outcomes, setOutcomes] = useState<(SessionOutcomes & { approvedTutors: number }) | null>(null);
  const [outcomesError, setOutcomesError] = useState<string | null>(null);
  const [demand, setDemand] = useState<WaitlistDemand | null>(null);
  const [keepOrSwap, setKeepOrSwap] = useState<KeepOrSwapCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = () => {
    setIsLoading(true);
    setError(null);
    setOutcomesError(null);
    fetchPhase1Metrics()
      .then(setMetrics)
      .catch((e) => setError(getErrorMessage(e, 'Could not load the numbers.')))
      .finally(() => setIsLoading(false));
    // Loaded separately, so a failure here never blanks the numbers above it.
    fetchSessionOutcomes()
      .then(setOutcomes)
      .catch((e) => setOutcomesError(getErrorMessage(e, 'Could not load the successful-session numbers.')));
    // Null (hidden) when the waiting-list table does not exist yet.
    fetchWaitlistDemand()
      .then(setDemand)
      .catch(() => setDemand(null));
    // Null (hidden) until the keep-or-swap migration is on the database.
    fetchKeepOrSwapCounts()
      .then(setKeepOrSwap)
      .catch(() => setKeepOrSwap(null));
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

          <section>
            <h2 className="text-sm font-extrabold text-[#0F172A] mb-1">Successful sessions</h2>
            <p className="text-xs text-slate-500 mb-2">
              A session is successful when it was completed, rated 4 or more, and the same learner and tutor booked
              again within {REBOOK_WINDOW_DAYS} days. A payment alone is not a success. Until the learner can keep a tutor
              and book them again (keep or swap, below), the same pair only meets again if that tutor happens to accept
              again, so expect a low rate until it is switched on.
            </p>
            {outcomesError ? (
              <p className="text-sm font-semibold text-rose-600">{outcomesError}</p>
            ) : outcomes ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat
                  label="Successful sessions"
                  value={outcomes.successfulSessions}
                  note={`${outcomes.completedSessions} completed in total`}
                />
                <Stat
                  label="Success rate"
                  value={outcomes.successRatePct === null ? '—' : `${outcomes.successRatePct}%`}
                  note={`of ${outcomes.decidedSessions} sessions whose ${REBOOK_WINDOW_DAYS} days are over`}
                />
                <Stat label="Rated 4 or more" value={outcomes.ratedFourPlus} note={`${outcomes.ratedSessions} rated`} />
                <Stat label="Too early to tell" value={outcomes.stillOpenSessions} note={`completed in the last ${REBOOK_WINDOW_DAYS} days`} />
                <Stat
                  label="Pairs with 2 or more bookings"
                  value={outcomes.pairsBookedAgain}
                  note={`${outcomes.pairsWithACompletedSession} pairs have a completed session`}
                />
                <Stat
                  label="Stopped while their tutor kept working"
                  value={outcomes.leakageSignals}
                  note="a signal, not proof"
                />
                <Stat
                  label="Hours booked, last 28 days"
                  value={outcomes.hoursBookedLast28Days}
                  note={`${outcomes.tutorsWorkedLast28Days} of ${outcomes.approvedTutors} approved tutors worked`}
                />
              </div>
            ) : (
              <div className="flex items-center text-slate-400 py-4">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                <span className="text-xs font-semibold">Loading…</span>
              </div>
            )}
          </section>

          {demand && (
            <section>
              <h2 className="text-sm font-extrabold text-[#0F172A] mb-1">Waiting for a tutor</h2>
              <p className="text-xs text-slate-500 mb-2">
                People who asked to be told when a tutor is available for a subject and grade nobody teaches yet. This is
                unmet demand: the subjects to recruit tutors for first.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <Stat label="Waiting now" value={demand.waiting} />
                <Stat label="Already told" value={demand.told} note="a tutor became available" />
              </div>
              {demand.lines.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="text-left font-bold px-4 py-2">Subject</th>
                        <th className="text-left font-bold px-4 py-2">Grade</th>
                        <th className="text-right font-bold px-4 py-2">Waiting</th>
                        <th className="text-right font-bold px-4 py-2">Told</th>
                      </tr>
                    </thead>
                    <tbody>
                      {demand.lines.map((line) => (
                        <tr key={`${line.subject}|${line.gradeLevel}`} className="border-t border-slate-100">
                          <td className="px-4 py-2 font-semibold text-[#0F172A]">{line.subject}</td>
                          <td className="px-4 py-2 text-slate-600">{line.gradeLevel}</td>
                          <td className="px-4 py-2 text-right font-bold text-[#0F172A]">{line.waiting}</td>
                          <td className="px-4 py-2 text-right text-slate-500">{line.told}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {keepOrSwap && (
            <section>
              <h2 className="text-sm font-extrabold text-[#0F172A] mb-1">Keep or swap</h2>
              <p className="text-xs text-slate-500 mb-2">
                What learners chose after a session, and the pairings tutors ended. Private to admins: a tutor never sees
                these numbers, and nothing here penalises anyone automatically. Many learners trying someone else instead
                of one tutor is a signal worth a conversation, not a finding.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <Stat label="Kept a tutor" value={keepOrSwap.kept} />
                <Stat label="Tried someone else" value={keepOrSwap.avoided} />
                <Stat label="Pairings a tutor ended" value={keepOrSwap.ended} />
              </div>
              {keepOrSwap.lines.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="text-left font-bold px-4 py-2">Tutor</th>
                        <th className="text-right font-bold px-4 py-2">Kept</th>
                        <th className="text-right font-bold px-4 py-2">Tried someone else</th>
                        <th className="text-right font-bold px-4 py-2">Ended by the tutor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keepOrSwap.lines.map((line) => (
                        <tr key={line.tutorId} className="border-t border-slate-100">
                          <td className="px-4 py-2 font-semibold text-[#0F172A]">{line.name}</td>
                          <td className="px-4 py-2 text-right text-slate-600">{line.kept}</td>
                          <td className="px-4 py-2 text-right font-bold text-[#0F172A]">{line.avoided}</td>
                          <td className="px-4 py-2 text-right text-slate-500">{line.ended}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      ) : null}
    </div>
  );
};
