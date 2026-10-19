import React, { useState } from 'react';
import { Library, Trash2 } from 'lucide-react';
import type { CriterionRow, CurriculumOption, SchoolCurriculaInfo, SchoolSearchResult } from '../types';
import { CURRICULUM_TYPES, curriculumLabel } from '../lib/subjectApprovals';
import { getErrorMessage } from '../lib/errors';

// The Curricula screen (CEO, 19 Oct 2026): (1) the approval checklist for each curriculum, edited here (what an admin ticks before
// approving a tutor's subject), and (2) the curricula a school follows (its own plus extras), which decide whether a learner is
// asked "Which curriculum are you following?". The database functions check the caller and write the audit rows.

export interface CurriculaActions {
  saveCriterion: (c: { id: string | null; curriculum: string; text: string; required: boolean; active: boolean; sortOrder: number }) => Promise<void>;
  deleteCriterion: (id: string) => Promise<void>;
  searchSchools: (term: string) => Promise<SchoolSearchResult[]>;
  loadSchool: (school: SchoolSearchResult) => Promise<SchoolCurriculaInfo | null>;
  saveSchoolCurricula: (schoolId: string, curriculumIds: string[]) => Promise<void>;
}

interface Props {
  criteria: CriterionRow[] | null; // null: the database update is not applied yet
  curricula: CurriculumOption[];
  actions: CurriculaActions;
  onChanged: () => void;
}

const inputClass = 'bg-slate-100 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#15803D]/20';
const buttonClass = 'px-3 py-1.5 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold rounded-lg cursor-pointer';

const CriterionEditor: React.FC<{
  start: CriterionRow | null;
  curriculum: string;
  nextOrder: number;
  actions: CurriculaActions;
  onChanged: () => void;
}> = ({ start, curriculum, nextOrder, actions, onChanged }) => {
  const [text, setText] = useState(start?.text ?? '');
  const [required, setRequired] = useState(start?.required ?? true);
  const [active, setActive] = useState(start?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<void>, reset = false) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      if (reset) setText('');
      onChanged();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3 space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder={start ? undefined : 'Write a new checklist line'}
        aria-label={start ? 'Checklist line' : 'New checklist line'}
        className={`w-full ${inputClass}`}
      />
      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-[#0F172A] cursor-pointer">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[#0F172A] cursor-pointer">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> In use
        </label>
        <button
          type="button"
          disabled={busy}
          className={`${buttonClass} ml-auto`}
          onClick={() => run(() => actions.saveCriterion({ id: start?.id ?? null, curriculum, text, required, active, sortOrder: start?.sortOrder ?? nextOrder }), !start)}
        >
          {start ? 'Save' : 'Add line'}
        </button>
        {start && (
          <button
            type="button"
            disabled={busy}
            aria-label="Delete this line"
            onClick={() => run(() => actions.deleteCriterion(start.id))}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
    </div>
  );
};

const SchoolEditor: React.FC<{ curricula: CurriculumOption[]; actions: CurriculaActions }> = ({ curricula, actions }) => {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<SchoolSearchResult[] | null>(null);
  const [info, setInfo] = useState<SchoolCurriculaInfo | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  const guard = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (e) {
      setMessage({ text: getErrorMessage(e, 'Something went wrong.'), bad: true });
    } finally {
      setBusy(false);
    }
  };

  const search = () => guard(async () => {
    setInfo(null);
    setResults(await actions.searchSchools(term));
  });

  const open = (school: SchoolSearchResult) => guard(async () => {
    const loaded = await actions.loadSchool(school);
    if (!loaded) {
      setMessage({ text: 'The database update for curricula has not been applied yet.', bad: true });
      return;
    }
    setInfo(loaded);
    setChosen(loaded.chosenIds);
  });

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const save = () => guard(async () => {
    if (!info) return;
    await actions.saveSchoolCurricula(info.schoolId, chosen);
    setMessage({ text: 'Saved.', bad: false });
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Search a school by name (3 letters or more)"
          aria-label="Search a school"
          className={`flex-1 ${inputClass}`}
        />
        <button type="button" disabled={busy} onClick={search} className={buttonClass}>Search</button>
      </div>
      {results && !info && (
        results.length === 0 ? (
          <p className="text-xs text-slate-500">No school found.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
            {results.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => open(s)} className="w-full text-left px-3 py-2 text-xs font-semibold text-[#0F172A] hover:bg-slate-50 cursor-pointer">
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      {info && (
        <div className="space-y-2">
          <div className="text-sm font-extrabold text-[#0F172A]">{info.schoolName}</div>
          <p className="text-xs text-slate-500">
            A learner at a school that follows more than one curriculum is asked which one they follow. The school's own curriculum cannot be removed.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {curricula.map((c) => {
              const own = info.ownIds.includes(c.id);
              return (
                <label key={c.id} className="flex items-center gap-2 text-xs text-[#0F172A]">
                  <input type="checkbox" checked={chosen.includes(c.id)} disabled={own} onChange={() => toggle(c.id)} />
                  {c.name}
                  {own && <span className="text-slate-400">(its own)</span>}
                </label>
              );
            })}
          </div>
          <div className="flex gap-2 items-center">
            <button type="button" disabled={busy} onClick={save} className={buttonClass}>Save curricula</button>
            <button type="button" onClick={() => setInfo(null)} className="text-xs font-bold text-slate-500 hover:underline cursor-pointer">Choose another school</button>
          </div>
        </div>
      )}
      {message && <p className={`text-xs font-semibold ${message.bad ? 'text-rose-600' : 'text-[#15803D]'}`}>{message.text}</p>}
    </div>
  );
};

export const CurriculaBody: React.FC<Props> = ({ criteria, curricula, actions, onChanged }) => {
  const [selected, setSelected] = useState(CURRICULUM_TYPES[0].value);
  const lines = (criteria ?? []).filter((c) => c.curriculum === selected).sort((a, b) => a.sortOrder - b.sortOrder);
  const nextOrder = lines.reduce((most, c) => Math.max(most, c.sortOrder), 0) + 1;

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold text-[#0F172A] mb-1 flex items-center gap-2">
          <Library className="w-6 h-6" />
          Curricula
        </h1>
        <p className="text-sm text-slate-500">The checklist you tick before approving a tutor's subject, and which curricula each school follows.</p>
      </div>

      <section aria-label="Approval checklist">
        <h2 className="text-sm font-extrabold text-[#0F172A] mb-2">Approval checklist</h2>
        {criteria === null ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs font-semibold text-amber-800">
            The database update for subject approvals has not been applied yet, so the checklist cannot be shown or edited.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {CURRICULUM_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setSelected(t.value)}
                  aria-pressed={selected === t.value}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer ${
                    selected === t.value ? 'bg-[#0F172A] text-white border-[#0F172A]' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {lines.length === 0 && (
                <p className="p-4 text-xs text-slate-500">
                  There is no checklist for {curriculumLabel(selected)} yet, so approving one of its subjects needs a written note.
                </p>
              )}
              {lines.map((c) => (
                <CriterionEditor key={`${c.id}-${c.text}-${c.required}-${c.active}`} start={c} curriculum={selected} nextOrder={nextOrder} actions={actions} onChanged={onChanged} />
              ))}
              <CriterionEditor key={`new-${selected}-${lines.length}`} start={null} curriculum={selected} nextOrder={nextOrder} actions={actions} onChanged={onChanged} />
            </div>
          </>
        )}
      </section>

      <section aria-label="Schools">
        <h2 className="text-sm font-extrabold text-[#0F172A] mb-2">Schools</h2>
        <SchoolEditor curricula={curricula} actions={actions} />
      </section>
    </div>
  );
};
