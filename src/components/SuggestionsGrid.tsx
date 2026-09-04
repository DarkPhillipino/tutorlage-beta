import React from 'react';
import { UserCheck, Calendar, FileText, GraduationCap, Users, UserPlus, ArrowUpRight, Sparkles } from 'lucide-react';
import { SuggestionItem } from '../types';

// Static learning-format copy — there's no database table for this, it's
// presentational content the UI owns, not tutor/institution data.
const SUGGESTIONS_LIST: SuggestionItem[] = [
  {
    id: '1-on-1',
    title: '1-on-1 Tutoring',
    description: 'Personalized live instruction tailored to your specific pace & syllabus.',
    iconName: '1-on-1',
    badge: 'Popular'
  },
  {
    id: 'scheduled',
    title: 'Scheduled Sessions',
    description: 'Book ahead for weekly recurring study blocks with top verified mentors.',
    iconName: 'scheduled'
  },
  {
    id: 'homework',
    title: 'Homework Help',
    description: 'Get step-by-step guidance on assignments, code reviews, and labs.',
    iconName: 'homework'
  },
  {
    id: 'examprep',
    title: 'Exam Prep',
    description: 'Targeted past-paper drills, crash courses, and exam strategy reviews.',
    iconName: 'examprep',
    badge: 'High Impact'
  },
  {
    id: 'group',
    title: 'Group Classes',
    description: 'Collaborative peer workshops with max 6 students per session.',
    iconName: 'group'
  },
  {
    id: 'teens',
    title: 'Kids & Teens',
    description: 'Engaging, safe foundational tutoring for secondary school learners.',
    iconName: 'teens'
  }
];

interface SuggestionsGridProps {
  onSelectSuggestion: (item: SuggestionItem) => void;
}

export const SuggestionsGrid: React.FC<SuggestionsGridProps> = ({ onSelectSuggestion }) => {

  const renderCardIcon = (iconName: SuggestionItem['iconName']) => {
    switch (iconName) {
      case '1-on-1':
        return (
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-100 to-emerald-200 flex items-center justify-center text-[#15803D] shadow-xs group-hover:scale-105 transition-transform">
            <UserCheck className="w-7 h-7" />
          </div>
        );
      case 'scheduled':
        return (
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-200 flex items-center justify-center text-indigo-700 shadow-xs group-hover:scale-105 transition-transform">
            <Calendar className="w-7 h-7" />
          </div>
        );
      case 'homework':
        return (
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-100 to-orange-200 flex items-center justify-center text-amber-800 shadow-xs group-hover:scale-105 transition-transform">
            <FileText className="w-7 h-7" />
          </div>
        );
      case 'examprep':
        return (
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-100 to-purple-200 flex items-center justify-center text-purple-800 shadow-xs group-hover:scale-105 transition-transform">
            <GraduationCap className="w-7 h-7" />
          </div>
        );
      case 'group':
        return (
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-100 to-teal-200 flex items-center justify-center text-teal-800 shadow-xs group-hover:scale-105 transition-transform">
            <Users className="w-7 h-7" />
          </div>
        );
      case 'teens':
        return (
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-100 to-pink-200 flex items-center justify-center text-rose-700 shadow-xs group-hover:scale-105 transition-transform">
            <UserPlus className="w-7 h-7" />
          </div>
        );
      default:
        return <UserCheck className="w-7 h-7 text-[#15803D]" />;
    }
  };

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-slate-200/80">
      
      {/* Section Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] tracking-tight">
          Suggestions
        </h2>
        <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
          {SUGGESTIONS_LIST.length} Formats Available
        </span>
      </div>

      {/* 3x2 Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        {SUGGESTIONS_LIST.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelectSuggestion(item)}
            className="group relative bg-[#FAF7F2] hover:bg-slate-100 border border-slate-200/60 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center text-center transition-all duration-200 hover:shadow-md hover:border-[#15803D]/40 cursor-pointer min-h-[140px]"
          >
            {/* Optional Badge */}
            {item.badge && (
              <span className="absolute top-2.5 right-2.5 text-[10px] font-bold bg-[#15803D] text-white px-2 py-0.5 rounded-full uppercase tracking-wider">
                {item.badge}
              </span>
            )}

            {/* Clean Icon */}
            <div className="mb-3">
              {renderCardIcon(item.iconName)}
            </div>

            {/* Label below icon */}
            <span className="text-sm font-bold text-[#0F172A] group-hover:text-[#15803D] transition-colors leading-snug">
              {item.title}
            </span>

            {/* Sub-indicator hover cue */}
            <div className="mt-1 flex items-center text-[11px] font-semibold text-slate-400 group-hover:text-[#15803D] opacity-0 group-hover:opacity-100 transition-opacity">
              <span>Explore</span>
              <ArrowUpRight className="w-3 h-3 ml-0.5" />
            </div>
          </button>
        ))}
      </div>

      {/* Trust & Verification Footer Strip */}
      <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center space-x-1.5">
          <Sparkles className="w-4 h-4 text-[#15803D]" />
          <span className="font-medium">100% Academic Vetted Mentors</span>
        </div>
        <span className="text-slate-400 hidden sm:inline">24-hr Money Back Guarantee</span>
      </div>

    </div>
  );
};
