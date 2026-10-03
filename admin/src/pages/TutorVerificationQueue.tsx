import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ShieldCheck, ChevronRight, FileText } from 'lucide-react';
import { fetchTutorVerificationQueue } from '../lib/queries';
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

export const TutorVerificationQueue: React.FC = () => {
  const [tutors, setTutors] = useState<TutorForVerification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showVerified, setShowVerified] = useState(false);

  useEffect(() => {
    fetchTutorVerificationQueue().then(setTutors).catch(() => setTutors([])).finally(() => setIsLoading(false));
  }, []);

  const visible = showVerified ? tutors : tutors.filter((t) => t.onboardingStatus !== 'verified');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-[#0F172A]">Tutor Verification</h1>
          <p className="text-sm text-slate-500 mt-0.5">{visible.length} tutor{visible.length === 1 ? '' : 's'} {showVerified ? '' : 'awaiting review'}</p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
          <input type="checkbox" checked={showVerified} onChange={(e) => setShowVerified(e.target.checked)} className="cursor-pointer" />
          Show verified too
        </label>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm font-semibold">Loading queue…</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center">
          <ShieldCheck className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-bold text-[#0F172A]">Nothing to review</p>
          <p className="text-xs text-slate-500 mt-1">All caught up.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          {visible.map((t) => (
            <Link
              key={t.id}
              to={`/verification/${t.id}`}
              className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-[#0F172A]">{t.name}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[t.onboardingStatus]}`}>
                    {STATUS_LABELS[t.onboardingStatus]}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5 truncate">{t.email} {t.headline ? `· ${t.headline}` : ''}</div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-1">
                  <FileText className="w-3 h-3" />
                  {t.documentCount} document{t.documentCount === 1 ? '' : 's'}
                  {t.pendingDocumentCount > 0 && <span className="font-bold text-amber-600 ml-1">· {t.pendingDocumentCount} awaiting review</span>}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};
