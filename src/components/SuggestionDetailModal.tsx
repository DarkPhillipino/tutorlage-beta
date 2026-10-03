import React from 'react';
import { X, CheckCircle, ArrowRight, ShieldCheck, Sparkles, BookOpen } from 'lucide-react';
import { SuggestionItem } from '../types';

interface SuggestionDetailModalProps {
  item: SuggestionItem | null;
  onClose: () => void;
  onSelectFormat: (format: SuggestionItem) => void;
}

export const SuggestionDetailModal: React.FC<SuggestionDetailModalProps> = ({
  item,
  onClose,
  onSelectFormat,
}) => {
  if (!item) return null;

  // Wording from Drake/marketing-gtm/site-copy-v1.md — each line must be true
  // today (no document-review, "excelled" or group-session claims until those
  // are real; see backlog item 3).
  const getFormatFeatures = (id: string) => {
    switch (id) {
      case '1-on-1':
        return [
          'One-to-one online sessions with a matched tutor',
          'A single price for the level you choose',
          'Send one request — no back-and-forth to find someone free'
        ];
      case 'scheduled':
        return [
          'Pick a future date and time',
          'Same price for the level you choose',
          'A tutor who fits accepts your request'
        ];
      case 'homework':
        return [
          "Bring the assignment you're stuck on",
          'Step-by-step help, not answers handed over',
          'Same booking and pricing as any session'
        ];
      case 'examprep':
        return [
          'Sessions focused on an upcoming test or exam',
          'Matched with a tutor who teaches that subject',
          'Same booking and pricing as any session'
        ];
      case 'teens':
        return [
          'For learners in Grades 8-12',
          // "A parent or guardian holds the account and books" goes here once the
          // guardian account flow ships (backlog 7k) — not true before then.
          "Help with the CAPS subjects they're taking",
          'You see who the tutor is before the session'
        ];
      default:
        return ['One request, one matched tutor', 'One clear price'];
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-lg w-full overflow-hidden flex flex-col shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Header */}
        <div className="p-6 bg-[#0A192F] text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-[#15803D] flex items-center justify-center text-white font-bold">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                Tutorlage Learning Format
              </span>
              <h3 className="text-xl font-extrabold tracking-tight">{item.title}</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 bg-[#FAF7F2] space-y-5">
          <p className="text-sm text-slate-700 font-medium leading-relaxed">
            {item.description}
          </p>

          <div className="bg-white rounded-2xl p-5 border border-slate-200 space-y-3">
            <h4 className="text-xs font-bold text-[#0F172A] uppercase tracking-wider flex items-center space-x-1.5">
              <BookOpen className="w-4 h-4 text-[#15803D]" />
              <span>What's Included:</span>
            </h4>

            <ul className="space-y-2.5">
              {getFormatFeatures(item.id).map((feature, idx) => (
                <li key={idx} className="flex items-start text-xs text-slate-700 font-medium">
                  <CheckCircle className="w-4 h-4 text-[#15803D] mr-2.5 shrink-0 mt-0.5" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center text-xs">
            <div className="flex items-center space-x-2 text-[#15803D] font-bold">
              <ShieldCheck className="w-4 h-4" />
              <span>You see who your tutor is before you start</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-white border-t border-slate-200 flex items-center justify-between px-6">
          <button
            onClick={onClose}
            className="text-xs font-bold text-slate-500 hover:text-[#0F172A] cursor-pointer"
          >
            Close
          </button>
          <button
            onClick={() => {
              onSelectFormat(item);
              onClose();
            }}
            className="px-5 py-2.5 bg-[#15803D] hover:bg-[#166534] text-white font-bold text-xs rounded-xl transition-all shadow-xs cursor-pointer flex items-center space-x-1.5"
          >
            <span>Find a tutor</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

      </div>
    </div>
  );
};
