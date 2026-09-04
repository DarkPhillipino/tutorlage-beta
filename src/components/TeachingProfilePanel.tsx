import React, { useEffect, useState } from 'react';
import { Star, ShieldCheck, Loader2, BookOpen, MessageSquare, GraduationCap, Clock, UserX } from 'lucide-react';
import { TutorDashboardData, TutorReview, TutorAvailabilitySlot, TutorSession } from '../types';
import { fetchTutorDashboard, fetchTutorReviews, fetchTutorAvailability, fetchUpcomingTutorSessions } from '../lib/queries';
import { TutorCalendar } from './TutorCalendar';
import { AvailabilityEditor } from './AvailabilityEditor';

// The "Teaching" tab body inside ManageAccountModal.tsx — content only, no
// outer page frame (the modal already provides that). Was previously its
// own full-page TeachDashboard; moved here so it lives alongside the rest
// of account info instead of behind the Teach nav button (see TeachGoScreen
// for what Teach shows now).
interface TeachingProfilePanelProps {
  tutorId: string;
}

export const TeachingProfilePanel: React.FC<TeachingProfilePanelProps> = ({ tutorId }) => {
  const [tutor, setTutor] = useState<TutorDashboardData | null>(null);
  const [reviews, setReviews] = useState<TutorReview[]>([]);
  const [availability, setAvailability] = useState<TutorAvailabilitySlot[]>([]);
  const [sessions, setSessions] = useState<TutorSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchTutorDashboard(tutorId)
      .then(async (data) => {
        setTutor(data);
        if (data) {
          const [r, a, s] = await Promise.all([
            fetchTutorReviews(data.id),
            fetchTutorAvailability(data.id),
            fetchUpcomingTutorSessions(data.id),
          ]);
          setReviews(r);
          setAvailability(a);
          setSessions(s);
        }
      })
      .catch(() => setTutor(null))
      .finally(() => setIsLoading(false));
  }, [tutorId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-semibold">Loading teaching profile…</span>
      </div>
    );
  }

  if (!tutor) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-slate-200 text-center space-y-2">
        <UserX className="w-8 h-8 text-slate-400 mx-auto" />
        <h4 className="text-sm font-bold text-[#0F172A]">No tutor profile found</h4>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">
          There isn't a tutor profile to show yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Profile summary */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 flex items-center space-x-3">
        {tutor.avatarUrl ? (
          <img src={tutor.avatarUrl} alt={tutor.name} className="w-12 h-12 rounded-2xl object-cover border border-slate-200 shrink-0" />
        ) : (
          <div className="w-12 h-12 rounded-2xl bg-emerald-500 text-slate-950 font-black flex items-center justify-center text-lg shrink-0">
            {tutor.name.charAt(0)}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center space-x-2">
            <div className="text-sm font-bold text-[#0F172A] truncate">{tutor.name}</div>
            {tutor.verified && (
              <span className="inline-flex items-center text-[10px] font-bold bg-emerald-100 text-[#15803D] px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
                <ShieldCheck className="w-3 h-3 mr-0.5" />
                Verified
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 truncate">{tutor.headline || 'Tutorlage Tutor'}</div>
          {tutor.tier && (
            <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">
              {tutor.tier.publicName} · R{tutor.hourlyRate} / hr
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-white p-3 rounded-2xl border border-slate-200 text-center">
          <div className="text-lg font-extrabold text-[#0F172A]">{tutor.totalSessionsCompleted}</div>
          <div className="text-[9px] text-slate-500 font-bold uppercase mt-0.5">Sessions</div>
        </div>
        <div className="bg-white p-3 rounded-2xl border border-slate-200 text-center">
          <div className="text-lg font-extrabold text-[#0F172A]">{tutor.totalCompletedHours}</div>
          <div className="text-[9px] text-slate-500 font-bold uppercase mt-0.5">Hours</div>
        </div>
        <div className="bg-white p-3 rounded-2xl border border-slate-200 text-center">
          <div className="text-lg font-extrabold text-[#15803D] flex items-center justify-center gap-0.5">
            <Star className="w-3.5 h-3.5 fill-current" />
            {tutor.rating.toFixed(2)}
          </div>
          <div className="text-[9px] text-slate-500 font-bold uppercase mt-0.5">Rating</div>
        </div>
        <div className="bg-white p-3 rounded-2xl border border-slate-200 text-center">
          <div className="text-lg font-extrabold text-[#0F172A]">{tutor.reviewsCount}</div>
          <div className="text-[9px] text-slate-500 font-bold uppercase mt-0.5">Reviews</div>
        </div>
      </div>

      {/* Status list */}
      <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
        <div className="p-3.5 flex items-center justify-between">
          <div className="flex items-center space-x-3 text-xs font-bold text-[#0F172A]">
            <Clock className="w-4 h-4 text-slate-500" />
            <span>Teaching mode</span>
          </div>
          <span className="text-xs font-semibold text-slate-600 capitalize">{tutor.teachingMode}</span>
        </div>
        <div className="p-3.5 flex items-center justify-between">
          <div className="flex items-center space-x-3 text-xs font-bold text-[#0F172A]">
            <ShieldCheck className="w-4 h-4 text-slate-500" />
            <span>Onboarding status</span>
          </div>
          <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full capitalize">
            {tutor.onboardingStatus?.replace(/_/g, ' ') || 'Unknown'}
          </span>
        </div>
      </div>

      {/* Subjects */}
      <div>
        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <GraduationCap className="w-3.5 h-3.5" />
          Subjects Taught
        </h4>
        {tutor.subjects.length === 0 ? (
          <div className="bg-white rounded-2xl p-4 border border-slate-200 text-center">
            <BookOpen className="w-5 h-5 text-slate-300 mx-auto mb-1" />
            <p className="text-xs text-slate-500">No subjects added yet.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {tutor.subjects.map((s, idx) => (
              <div key={idx} className="bg-white rounded-xl p-3 border border-slate-200">
                <div className="text-xs font-bold text-[#0F172A]">{s.subjectName}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{s.curriculum} · {s.minGradeLevel} - {s.maxGradeLevel}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reviews */}
      <div>
        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5" />
          Recent Reviews
        </h4>
        {reviews.length === 0 ? (
          <div className="bg-white rounded-2xl p-4 border border-slate-200 text-center">
            <p className="text-xs text-slate-500">No reviews yet.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {reviews.map((r) => (
              <div key={r.id} className="bg-white rounded-xl p-3 border border-slate-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center text-amber-500 font-bold text-xs">
                    <Star className="w-3.5 h-3.5 fill-current mr-1" />
                    {r.rating ?? '—'}
                  </div>
                  <span className="text-[10px] text-slate-400">{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
                {r.comment && <p className="text-[11px] text-slate-600 mt-1.5">"{r.comment}"</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Set working hours */}
      <AvailabilityEditor tutorId={tutor.id} availability={availability} onChange={setAvailability} />

      {/* Calendar: availability (open vs booked) + upcoming sessions */}
      <TutorCalendar availability={availability} sessions={sessions} />

    </div>
  );
};
