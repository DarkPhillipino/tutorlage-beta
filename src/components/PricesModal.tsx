import React, { useState } from 'react';
import { X, Star, ShieldCheck, CheckCircle2, Clock, Calendar, ChevronRight, User, DollarSign, Filter } from 'lucide-react';
import { BookingFormState, Tutor } from '../types';
import { MOCK_TUTORS } from '../data/mockData';

interface PricesModalProps {
  isOpen: boolean;
  onClose: () => void;
  formState: BookingFormState;
  onBookTutor: (tutor: Tutor) => void;
}

export const PricesModal: React.FC<PricesModalProps> = ({
  isOpen,
  onClose,
  formState,
  onBookTutor,
}) => {
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'verified' | 'today'>('all');
  const [bookedTutorSuccess, setBookedTutorSuccess] = useState<Tutor | null>(null);

  if (!isOpen) return null;

  const subjectSearch = formState.subject || 'Mathematics / Python';
  const gradeSearch = formState.gradeLevel || 'Undergraduate';

  const filteredTutors = MOCK_TUTORS.filter(t => {
    if (selectedFilter === 'verified' && !t.verifiedBadge) return false;
    if (selectedFilter === 'today' && !t.availability.toLowerCase().includes('today')) return false;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Header */}
        <div className="p-6 bg-[#0A192F] text-white flex items-center justify-between border-b border-slate-800">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-1 flex items-center space-x-1">
              <span>{formState.institution}</span>
            </div>
            <h3 className="text-2xl font-extrabold tracking-tight">
              Tutor Rates & Available Experts
            </h3>
            <p className="text-xs text-slate-300 mt-1">
              Matching for <span className="text-white font-bold">{subjectSearch}</span> ({gradeSearch})
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Filters bar */}
        <div className="px-6 py-3 bg-[#FAF7F2] border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-[#0F172A]" />
            <span className="text-xs font-bold text-[#0F172A]">Filter Tutors:</span>
            <button
              onClick={() => setSelectedFilter('all')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                selectedFilter === 'all'
                  ? 'bg-[#0F172A] text-white'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              All Matches ({MOCK_TUTORS.length})
            </button>
            <button
              onClick={() => setSelectedFilter('today')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                selectedFilter === 'today'
                  ? 'bg-[#15803D] text-white'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              Available Today
            </button>
          </div>

          <div className="text-xs font-medium text-slate-500">
            Avg Rate: <span className="font-bold text-[#0F172A]">R250 - R320 / hr</span>
          </div>
        </div>

        {/* Content Body: Tutors list */}
        <div className="p-6 overflow-y-auto space-y-4 max-h-[60vh] bg-[#FAF7F2]">
          
          {bookedTutorSuccess ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-[#15803D] mx-auto mb-3">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h4 className="text-xl font-extrabold text-[#0F172A] mb-1">
                Session Requested with {bookedTutorSuccess.name}!
              </h4>
              <p className="text-xs text-slate-600 mb-4 max-w-md mx-auto">
                We have sent your confirmation details for {formState.subject || 'Tutoring'} at {formState.institution}. Your tutor will confirm within 15 minutes.
              </p>
              <button
                onClick={() => setBookedTutorSuccess(null)}
                className="px-5 py-2.5 bg-[#15803D] text-white font-bold rounded-xl text-sm hover:bg-[#166534] transition-all cursor-pointer"
              >
                View Other Tutors
              </button>
            </div>
          ) : (
            filteredTutors.map((tutor) => (
              <div
                key={tutor.id}
                className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs hover:shadow-md transition-all flex flex-col md:flex-row md:items-center md:justify-between gap-4"
              >
                {/* Tutor Info */}
                <div className="flex items-start space-x-4">
                  <img
                    src={tutor.avatar}
                    alt={tutor.name}
                    className="w-14 h-14 rounded-2xl object-cover border border-slate-200 shadow-xs shrink-0"
                  />
                  <div>
                    <div className="flex items-center space-x-2">
                      <h4 className="text-base font-bold text-[#0F172A]">{tutor.name}</h4>
                      {tutor.verifiedBadge && (
                        <span className="inline-flex items-center text-[10px] font-bold bg-emerald-100 text-[#15803D] px-2 py-0.5 rounded-full border border-emerald-200">
                          <ShieldCheck className="w-3 h-3 mr-0.5" />
                          Verified
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-medium text-slate-600 mt-0.5">{tutor.title}</div>
                    
                    {/* Rating & Availability */}
                    <div className="flex items-center space-x-3 text-xs mt-2">
                      <div className="flex items-center text-amber-500 font-bold">
                        <Star className="w-3.5 h-3.5 fill-current mr-1" />
                        <span>{tutor.rating}</span>
                        <span className="text-slate-400 font-normal ml-1">({tutor.reviewsCount})</span>
                      </div>
                      <span className="text-slate-300">•</span>
                      <div className="flex items-center text-slate-600 font-medium">
                        <Clock className="w-3.5 h-3.5 mr-1 text-[#15803D]" />
                        <span>{tutor.availability}</span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-500 mt-2 line-clamp-2">
                      "{tutor.bio}"
                    </p>
                  </div>
                </div>

                {/* Price & Action Button */}
                <div className="flex md:flex-col items-center md:items-end justify-between border-t md:border-t-0 border-slate-100 pt-3 md:pt-0 shrink-0">
                  <div className="text-left md:text-right mb-0 md:mb-3">
                    <div className="text-2xl font-black text-[#0F172A]">
                      {tutor.currency} {tutor.hourlyRate}
                      <span className="text-xs text-slate-500 font-semibold"> / hr</span>
                    </div>
                    <div className="text-[11px] text-emerald-700 font-bold">
                      Zero platform markup
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setBookedTutorSuccess(tutor);
                      onBookTutor(tutor);
                    }}
                    className="px-5 py-2.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer flex items-center space-x-1"
                  >
                    <span>Book Session</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

              </div>
            ))
          )}

        </div>

        {/* Footer */}
        <div className="p-4 bg-white border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 px-6">
          <span>All sessions protected by Tutorlage Academic Assurance</span>
          <button
            onClick={onClose}
            className="font-bold text-[#0F172A] hover:underline cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
