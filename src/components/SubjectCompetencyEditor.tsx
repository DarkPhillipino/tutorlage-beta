import React, { useEffect, useState } from 'react';
import { Plus, Trash2, GraduationCap, AlertCircle, Info } from 'lucide-react';
import { TutorSubjectCompetency } from '../types';
import { addTutorSubjectCompetency, deleteTutorSubjectCompetency, fetchSubjectSuggestions, fetchGradeLevelSuggestions, logSubjectCandidate } from '../lib/queries';
import { getErrorMessage } from '../lib/errors';

// Curriculum is a fixed Postgres enum (see CLAUDE.md's routing table), not a
// reference table — hardcoded here the same way TIER_ICONS is hardcoded in
// TierSelectionPage.tsx.
const CURRICULUM_OPTIONS: { value: string; label: string }[] = [
  { value: 'caps', label: 'CAPS' },
  { value: 'ieb', label: 'IEB' },
  { value: 'cambridge', label: 'Cambridge' },
  { value: 'tertiary', label: 'Tertiary' },
  { value: 'primary_caps', label: 'Primary CAPS' },
  { value: 'other', label: 'Other' },
];

interface SubjectCompetencyEditorProps {
  tutorId: string;
  subjects: TutorSubjectCompetency[];
  onChange: (subjects: TutorSubjectCompetency[]) => void;
}

// Lets a tutor add/remove the subjects they teach — the write side of
// tutor_subject_competencies (fetchTutorDashboard only ever read it). This
// is the thing that actually makes a tutor show up in subject-filtered
// search (see fetchTutors in queries.ts): with zero rows here, no subject
// search will ever match, no matter how complete the rest of the profile is.
export const SubjectCompetencyEditor: React.FC<SubjectCompetencyEditorProps> = ({ tutorId, subjects, onChange }) => {
  const [subjectOptions, setSubjectOptions] = useState<string[]>([]);
  const [gradeLevelOptions, setGradeLevelOptions] = useState<string[]>([]);

  const [subjectName, setSubjectName] = useState('');
  const [curriculum, setCurriculum] = useState(CURRICULUM_OPTIONS[0].value);
  const [minGradeLevel, setMinGradeLevel] = useState('');
  const [maxGradeLevel, setMaxGradeLevel] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidateNotice, setCandidateNotice] = useState<string | null>(null);

  useEffect(() => {
    fetchSubjectSuggestions()
      .then((names) => {
        setSubjectOptions(names);
      })
      .catch((err) => {
        console.error('fetchSubjectSuggestions failed:', err);
        setSubjectOptions([]);
      });
    fetchGradeLevelSuggestions()
      .then((names) => {
        setGradeLevelOptions(names);
        setMinGradeLevel((prev) => prev || names[0] || '');
        setMaxGradeLevel((prev) => prev || names[names.length - 1] || '');
      })
      .catch((err) => {
        console.error('fetchGradeLevelSuggestions failed:', err);
        setGradeLevelOptions([]);
      });
  }, []);

  const handleAdd = async () => {
    setError(null);
    setCandidateNotice(null);
    const trimmedName = subjectName.trim();
    if (!trimmedName) {
      setError('Enter a subject.');
      return;
    }
    const minIdx = gradeLevelOptions.indexOf(minGradeLevel);
    const maxIdx = gradeLevelOptions.indexOf(maxGradeLevel);
    if (minIdx === -1 || maxIdx === -1 || minIdx > maxIdx) {
      setError('Grade range is invalid — "from" must not be after "to".');
      return;
    }

    // Self-expanding taxonomy: a subject not on the official list isn't
    // blocked — it's added to the tutor's profile right away (so they can
    // start teaching it immediately) and separately logged as a candidate
    // for the official list, rather than making the tutor wait on approval
    // before they can use it at all.
    const isKnownSubject = subjectOptions.some((s) => s.toLowerCase() === trimmedName.toLowerCase());

    setIsSaving(true);
    try {
      const competency = await addTutorSubjectCompetency(tutorId, {
        subjectName: trimmedName,
        curriculum,
        minGradeLevel,
        maxGradeLevel,
      });
      onChange([...subjects, competency]);
      setSubjectName('');

      if (!isKnownSubject) {
        logSubjectCandidate(tutorId, trimmedName, curriculum).catch((e) =>
          console.error('logSubjectCandidate failed:', e)
        );
        setCandidateNotice(
          `"${trimmedName}" isn't on our official subject list yet — it's live on your profile now, and we've logged it for review.`
        );
      }
    } catch (e) {
      setError(getErrorMessage(e, 'Could not add that subject.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    setDeletingId(id);
    try {
      await deleteTutorSubjectCompetency(id);
      onChange(subjects.filter((s) => s.id !== id));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not remove that subject.'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <GraduationCap className="w-3.5 h-3.5" />
        Subjects Taught
      </h4>

      <div className="space-y-1.5 mb-3">
        {subjects.length === 0 ? (
          <div className="bg-white rounded-2xl p-4 border border-slate-200 text-center">
            <p className="text-xs text-slate-500">No subjects added yet — add one below so students searching for it can find you.</p>
          </div>
        ) : (
          subjects.map((s) => (
            <div key={s.id} className="bg-white rounded-xl p-3 border border-slate-200 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-bold text-[#0F172A] truncate">{s.subjectName}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{s.curriculum} · {s.minGradeLevel} - {s.maxGradeLevel}</div>
              </div>
              <button
                onClick={() => handleDelete(s.id)}
                disabled={deletingId === s.id}
                className="p-1 rounded-full hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                aria-label={`Remove ${s.subjectName}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="bg-white rounded-2xl p-3 border border-slate-200 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            list="subject-options"
            value={subjectName}
            onChange={(e) => setSubjectName(e.target.value)}
            placeholder="e.g. Mathematics, or type a new subject"
            className="flex-1 min-w-[8rem] bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
          />
          <datalist id="subject-options">
            {subjectOptions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <select
            value={curriculum}
            onChange={(e) => setCurriculum(e.target.value)}
            className="bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20 cursor-pointer"
          >
            {CURRICULUM_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={minGradeLevel}
            onChange={(e) => setMinGradeLevel(e.target.value)}
            className="flex-1 min-w-[7rem] bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20 cursor-pointer"
          >
            {gradeLevelOptions.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <span className="text-xs text-slate-400">to</span>
          <select
            value={maxGradeLevel}
            onChange={(e) => setMaxGradeLevel(e.target.value)}
            className="flex-1 min-w-[7rem] bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20 cursor-pointer"
          >
            {gradeLevelOptions.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={isSaving}
            className="ml-auto flex items-center gap-1 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold px-3 py-2 rounded-lg transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-1.5 mt-2 text-[11px] text-rose-600 font-semibold">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {candidateNotice && (
        <div className="flex items-start gap-1.5 mt-2 text-[11px] text-[#15803D] font-semibold">
          <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{candidateNotice}</span>
        </div>
      )}
    </div>
  );
};
