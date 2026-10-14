import React from 'react';
import { AlertCircle, GraduationCap, Loader2, Sprout } from 'lucide-react';
import { ONBOARDING_COPY, TRACK_COPY, type TutorTrack } from '../lib/tutorOnboarding';

// Master 7cx: the tutor's second sign-up page. Two choices; the choice decides which documents the third page asks for.
// Presentational: TutorOnboardingGate saves the choice.

const OPTIONS: { track: TutorTrack; Icon: React.ComponentType<{ className?: string }> }[] = [
  { track: 'beginner', Icon: Sprout },
  { track: 'experienced', Icon: GraduationCap },
];

interface TutorTypePageProps {
  selected: TutorTrack | null;
  onSelect: (track: TutorTrack) => void;
  onContinue: () => void;
  isSaving: boolean;
  error: string | null;
  onSignOut: () => void;
}

export const TutorTypePage: React.FC<TutorTypePageProps> = ({ selected, onSelect, onContinue, isSaving, error, onSignOut }) => (
  <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-6 py-12">
    <div className="w-full max-w-lg bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80">
      <p className="text-xs font-bold text-[#15803D] uppercase tracking-wider mb-2">Step 2 of 3 · Tutor sign-up</p>
      <h1 className="font-serif text-3xl text-[#0F172A] mb-2">{ONBOARDING_COPY.trackTitle}</h1>
      <p className="text-sm text-slate-500 mb-6">{ONBOARDING_COPY.trackIntro}</p>

      {error && (
        <div role="alert" className="mb-4 flex items-start space-x-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-semibold text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div role="radiogroup" aria-label={ONBOARDING_COPY.trackTitle} className="space-y-3">
        {OPTIONS.map(({ track, Icon }) => {
          const isSelected = selected === track;
          const copy = TRACK_COPY[track];
          return (
            <button
              key={track}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(track)}
              className={`w-full text-left rounded-2xl border-2 p-4 transition-all cursor-pointer flex items-start space-x-3 ${
                isSelected ? 'border-[#15803D] bg-emerald-50/60 ring-2 ring-[#15803D]/15' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${isSelected ? 'bg-[#15803D] text-white' : 'bg-emerald-100 text-[#15803D]'}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-base font-bold text-[#0F172A]">{copy.title}</div>
                <div className="text-sm text-slate-600 mt-0.5 leading-snug">{copy.blurb}</div>
                <div className="text-xs text-slate-500 mt-2 leading-snug">
                  <span className="font-bold text-slate-600">You will need:</span> {copy.needs}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onContinue}
        disabled={!selected || isSaving}
        className="w-full mt-6 bg-[#15803D] hover:bg-[#166534] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3.5 px-6 rounded-xl transition-all flex items-center justify-center space-x-2 text-sm cursor-pointer"
      >
        {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
        <span>Continue</span>
      </button>

      <button type="button" onClick={onSignOut} className="w-full mt-4 text-xs font-bold text-slate-400 hover:text-slate-600 cursor-pointer">
        Sign out
      </button>
    </div>
  </div>
);
