import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Loader2, ShieldCheck, ChevronRight, FileText, Search, CheckCircle2 } from 'lucide-react';
import { fetchTutorVerificationQueue } from '../lib/queries';
import { fetchWaitingSince } from '../lib/verificationQueueExtras';
import { buildSections, groupOf, waitingFrom, waitingText } from '../lib/verificationQueueOrder';
import { TutorForVerification } from '../types';

const STATUS_LABELS: Record<string, string> = {
  pending_academic: 'Pending: Academic',
  pending_pedagogy: 'Pending: Pedagogy',
  pending_diagnostic: 'Pending: Diagnostic',
  verified: 'Verified',
  rejected: 'Rejected',
};

const STATUS_COLORS: Record<string, string> = {
  pending_academic: 'bg-amber-100 text-amber-700',
  pending_pedagogy: 'bg-amber-100 text-amber-700',
  pending_diagnostic: 'bg-amber-100 text-amber-700',
  verified: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
};

// Burst-readiness (4 Nov 2026): the list is grouped and ordered so the tutor who has waited longest for a decision is first, tutors with nothing
// to review yet sit below, and a search box finds one person among 100 (rules in lib/verificationQueueOrder.ts).
export const TutorVerificationQueue: React.FC = () => {
  const [tutors, setTutors] = useState<TutorForVerification[]>([]);
  const [since, setSince] = useState<ReadonlyMap<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [showVerified, setShowVerified] = useState(false);
  const [search, setSearch] = useState('');
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice ?? null;

  useEffect(() => {
    Promise.all([fetchTutorVerificationQueue().catch(() => [] as TutorForVerification[]), fetchWaitingSince()])
      .then(([list, waiting]) => {
        setTutors(list);
        setSince(waiting);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const sections = useMemo(() => buildSections(tutors, since, { search, showVerified }), [tutors, since, search, showVerified]);
  const shown = sections.reduce((n, s) => n + s.tutors.length, 0);
  const toReview = sections.find((s) => s.group === 'to_review')?.tutors.length ?? 0;
  const now = Date.now();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[#0F172A]">Tutor Verification</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {toReview} tutor{toReview === 1 ? '' : 's'} with documents waiting for you · {shown} shown
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
          <input type="checkbox" checked={showVerified} onChange={(e) => setShowVerified(e.target.checked)} className="cursor-pointer" />
          Show verified too
        </label>
      </div>

      {notice && (
        <div className="flex items-center gap-1.5 mb-4 text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2" role="status">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          {notice}
        </div>
      )}

      <div className="relative mb-4 max-w-sm">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a tutor by name or email"
          aria-label="Find a tutor by name or email"
          className="w-full bg-white border border-slate-200 text-xs font-semibold text-[#0F172A] rounded-lg pl-9 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm font-semibold">Loading queue…</span>
        </div>
      ) : shown === 0 ? (
        <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center">
          <ShieldCheck className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-bold text-[#0F172A]">{search.trim() ? 'No tutor matches that' : 'Nothing to review'}</p>
          <p className="text-xs text-slate-500 mt-1">{search.trim() ? 'Try part of the name or email.' : 'All caught up.'}</p>
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.group} className="mb-6" aria-label={section.title}>
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              {section.title} <span className="text-slate-300">({section.tutors.length})</span>
            </h2>
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {section.tutors.map((t) => (
                <Link key={t.id} to={`/verification/${t.id}`} className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-[#0F172A]">{t.name}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[t.onboardingStatus]}`}>
                        {STATUS_LABELS[t.onboardingStatus]}
                      </span>
                      {t.tutorType && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700">
                          {t.tutorType === 'beginner' ? 'Beginner' : 'Experienced'}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 truncate">{t.email} {t.headline ? `· ${t.headline}` : ''}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-1">
                      <FileText className="w-3 h-3" />
                      {t.documentCount} document{t.documentCount === 1 ? '' : 's'}
                      {t.pendingDocumentCount > 0 && (
                        <span className="font-bold text-amber-600 ml-1">
                          · {t.pendingDocumentCount} awaiting review · {waitingText(waitingFrom(t, since), now)}
                        </span>
                      )}
                      {groupOf(t) === 'nothing_yet' && t.documentCount === 0 && <span className="ml-1">· nothing uploaded yet</span>}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
};
