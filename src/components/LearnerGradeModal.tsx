import React, { useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { fetchGradeLevelSuggestions, setLearnerGrade } from '../lib/queries';
import { isMissingDatabaseFunction } from '../lib/keepOrSwap';
import { getErrorMessage } from '../lib/errors';

interface LearnerGradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  learner: { id: string; firstName: string; gradeLevel: string | null } | null;
  // Called with the grade as the database stored it, after it has saved.
  onChanged: (gradeLevel: string) => void;
}

// A parent changes the grade of the learner they are booking for (16 Oct 2026). Before this, the "Change" button on the
// booking form sent a parent to the home page, where they already were, so it appeared to do nothing, and there was no way
// to correct a grade chosen when the learner was added.
export const LearnerGradeModal: React.FC<LearnerGradeModalProps> = ({ isOpen, onClose, learner, onChanged }) => {
  const [options, setOptions] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !learner) return;
    setDraft(learner.gradeLevel ?? '');
    setError(null);
    fetchGradeLevelSuggestions()
      .then(setOptions)
      .catch((err) => {
        console.error('fetchGradeLevelSuggestions failed:', err);
        setError('Could not load the list of grades. Close this and try again.');
      });
  }, [isOpen, learner?.id]);

  if (!isOpen || !learner) return null;

  const handleSave = async () => {
    if (!draft) {
      setError('Choose a grade.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const stored = await setLearnerGrade(learner.id, draft);
      onChanged(stored);
      onClose();
    } catch (e) {
      // Before the migration is applied the function does not exist: say so in words, with no database text.
      setError(
        isMissingDatabaseFunction(e)
          ? "Changing a learner's grade isn't switched on yet. Please try again a little later."
          : getErrorMessage(e, 'Could not change the grade.'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60" onClick={onClose}>
      <div
        className="bg-white rounded-3xl max-w-sm w-full overflow-hidden shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Change ${learner.firstName}'s grade`}
      >
        <div className="p-5 bg-[#0A192F] text-white flex items-center justify-between">
          <h3 className="text-lg font-extrabold tracking-tight">{learner.firstName}'s grade</h3>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3 bg-[#FAF7F2]">
          <p className="text-xs text-slate-600">
            Tutors are matched to the grade you set, so choose the one {learner.firstName} is in now.
          </p>
          <select
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Grade"
            className="w-full bg-white rounded-xl px-3 py-3 text-sm font-semibold text-[#0F172A] border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
          >
            <option value="">Choose a grade…</option>
            {options.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
        </div>

        <div className="p-4 bg-white border-t border-slate-200 flex items-center justify-between">
          <button onClick={onClose} disabled={isSaving} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-[#0F172A] cursor-pointer">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !draft}
            className="flex items-center gap-1.5 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white font-bold text-xs px-5 py-2.5 rounded-xl cursor-pointer"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
