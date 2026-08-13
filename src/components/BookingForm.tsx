import React, { useState } from 'react';
import { MapPin, Clock, ChevronDown, ArrowRight, Circle, Square, Search, Sparkles } from 'lucide-react';
import { BookingFormState } from '../types';
import { POPULAR_SUBJECTS, POPULAR_GRADE_LEVELS } from '../data/mockData';

interface BookingFormProps {
  formState: BookingFormState;
  setFormState: React.Dispatch<React.SetStateAction<BookingFormState>>;
  onChangeInstitution: () => void;
  onOpenScheduleModal: () => void;
  onSeePrices: () => void;
}

export const BookingForm: React.FC<BookingFormProps> = ({
  formState,
  setFormState,
  onChangeInstitution,
  onOpenScheduleModal,
  onSeePrices,
}) => {
  const [showSubjectSuggestions, setShowSubjectSuggestions] = useState(false);
  const [showGradeSuggestions, setShowGradeSuggestions] = useState(false);

  const filteredSubjects = POPULAR_SUBJECTS.filter(s =>
    s.toLowerCase().includes(formState.subject.toLowerCase())
  );

  const filteredGradeLevels = POPULAR_GRADE_LEVELS.filter(g =>
    g.toLowerCase().includes(formState.gradeLevel.toLowerCase())
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSeePrices();
  };

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-slate-200/80">
      
      {/* Institution Subtext & Location Link */}
      <div className="flex items-center space-x-2 text-sm text-slate-700 font-medium mb-6 flex-wrap gap-y-1">
        <div className="flex items-center text-[#0F172A] font-semibold">
          <MapPin className="w-4 h-4 mr-1.5 text-[#15803D] shrink-0" />
          <span>{formState.institution}</span>
        </div>
        <span className="text-slate-300">•</span>
        <button
          type="button"
          onClick={onChangeInstitution}
          className="text-[#0F172A] font-bold underline underline-offset-4 hover:text-[#15803D] transition-colors cursor-pointer"
        >
          Change institution
        </button>
      </div>

      {/* Main Heading */}
      <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-[#0F172A] tracking-tight mb-6">
        Book a tutor
      </h1>

      {/* Schedule Dropdown Button */}
      <div className="mb-6">
        <button
          type="button"
          onClick={onOpenScheduleModal}
          className="inline-flex items-center space-x-2.5 px-4 py-2.5 rounded-full bg-slate-100 hover:bg-slate-200/80 text-[#0F172A] font-semibold text-sm transition-all cursor-pointer border border-slate-200/60"
        >
          <Clock className="w-4 h-4 text-[#0F172A]" />
          <span>
            {formState.scheduleType === 'now' 
              ? 'Schedule session' 
              : `Scheduled: ${formState.scheduledDate || 'Today'}, ${formState.scheduledTime || '14:00'}`}
          </span>
          <ChevronDown className="w-4 h-4 text-slate-600" />
        </button>
      </div>

      {/* Form Fields Container with Vertical Dot-Connector Line */}
      <form onSubmit={handleSubmit} className="space-y-3 relative mb-6">
        
        {/* Input 1: Subject or Skill */}
        <div className="relative">
          <div className="relative flex items-center bg-slate-100 rounded-xl px-4 py-3.5 border border-transparent focus-within:border-[#15803D] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 transition-all">
            {/* Dot Indicator */}
            <div className="mr-3 flex flex-col items-center justify-center">
              <div className="w-2.5 h-2.5 rounded-full bg-[#0F172A] ring-4 ring-slate-200"></div>
            </div>

            <input
              type="text"
              value={formState.subject}
              onChange={(e) => setFormState(prev => ({ ...prev, subject: e.target.value }))}
              onFocus={() => setShowSubjectSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSubjectSuggestions(false), 200)}
              placeholder="Enter subject or skill (e.g. Math, Python)"
              className="w-full bg-transparent text-[#0F172A] placeholder-slate-500 text-sm sm:text-base font-semibold focus:outline-none"
            />

            {/* Right arrow / navigation indicator icon matching Uber's location arrow */}
            <div className="ml-2 text-slate-400 shrink-0">
              <Search className="w-4 h-4 text-slate-500" />
            </div>
          </div>

          {/* Subject Autocomplete Dropdown */}
          {showSubjectSuggestions && filteredSubjects.length > 0 && (
            <div className="absolute left-0 right-0 mt-1 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-30 max-h-56 overflow-y-auto">
              <div className="px-3 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Suggested Subjects & Skills
              </div>
              {filteredSubjects.map((subj, idx) => (
                <button
                  key={idx}
                  type="button"
                  onMouseDown={() => {
                    setFormState(prev => ({ ...prev, subject: subj }));
                    setShowSubjectSuggestions(false);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-[#0F172A] font-medium hover:bg-slate-50 flex items-center justify-between"
                >
                  <span>{subj}</span>
                  <span className="text-xs text-slate-400 font-normal">Select</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Vertical Connecting Line between top dot and bottom square */}
        <div className="absolute left-[21px] top-[28px] bottom-[28px] w-0.5 bg-slate-400 z-10 pointer-events-none"></div>

        {/* Input 2: Grade Level or Topic */}
        <div className="relative">
          <div className="relative flex items-center bg-slate-100 rounded-xl px-4 py-3.5 border border-transparent focus-within:border-[#15803D] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 transition-all">
            {/* Square Indicator */}
            <div className="mr-3 flex flex-col items-center justify-center">
              <div className="w-2.5 h-2.5 bg-[#0F172A]"></div>
            </div>

            <input
              type="text"
              value={formState.gradeLevel}
              onChange={(e) => setFormState(prev => ({ ...prev, gradeLevel: e.target.value }))}
              onFocus={() => setShowGradeSuggestions(true)}
              onBlur={() => setTimeout(() => setShowGradeSuggestions(false), 200)}
              placeholder="Enter grade level or topic"
              className="w-full bg-transparent text-[#0F172A] placeholder-slate-500 text-sm sm:text-base font-semibold focus:outline-none"
            />
          </div>

          {/* Grade Level Autocomplete Dropdown */}
          {showGradeSuggestions && filteredGradeLevels.length > 0 && (
            <div className="absolute left-0 right-0 mt-1 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-30 max-h-52 overflow-y-auto">
              <div className="px-3 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Select Academic Level
              </div>
              {filteredGradeLevels.map((lvl, idx) => (
                <button
                  key={idx}
                  type="button"
                  onMouseDown={() => {
                    setFormState(prev => ({ ...prev, gradeLevel: lvl }));
                    setShowGradeSuggestions(false);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-[#0F172A] font-medium hover:bg-slate-50 flex items-center justify-between"
                >
                  <span>{lvl}</span>
                  <span className="text-xs text-slate-400 font-normal">Select</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main CTA Button strictly titled "See prices" */}
        <div className="pt-2">
          <button
            type="submit"
            className="w-full bg-[#15803D] hover:bg-[#166534] text-white font-bold py-4 px-6 rounded-xl transition-all shadow-md hover:shadow-lg active:scale-[0.99] flex items-center justify-center space-x-2 text-base cursor-pointer"
          >
            <span>See prices</span>
          </button>
        </div>

      </form>

      {/* Quick Subject Chips underneath */}
      <div className="pt-2 border-t border-slate-100">
        <div className="text-xs font-semibold text-slate-500 mb-2.5 flex items-center">
          <Sparkles className="w-3.5 h-3.5 mr-1 text-[#15803D]" />
          Popular at {formState.institution.split(' ')[0]}:
        </div>
        <div className="flex flex-wrap gap-1.5">
          {['Python', 'Calculus', 'Accounting', 'Physics', 'Essay Writing'].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setFormState(prev => ({ ...prev, subject: chip }))}
              className="text-xs font-semibold bg-slate-100 hover:bg-[#15803D]/10 hover:text-[#15803D] text-[#0F172A] px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              + {chip}
            </button>
          ))}
        </div>
      </div>

    </div>
  );
};
