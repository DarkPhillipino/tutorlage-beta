import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { CurriculaBody } from '../components/CurriculaBody';
import {
  deleteCriterion,
  fetchCriteria,
  fetchCurricula,
  fetchSchoolCurriculaInfo,
  saveCriterion,
  searchSchools,
  setSchoolCurricula,
} from '../lib/curriculumQueries';
import { getErrorMessage } from '../lib/errors';
import type { CriterionRow, CurriculumOption } from '../types';

// CEO, 19 Oct 2026: the approval checklist per curriculum, and the curricula each school follows, both edited here. This page loads
// them and hands them to CurriculaBody (components/CurriculaBody.tsx), which has the screen.
const ACTIONS = {
  saveCriterion,
  deleteCriterion,
  searchSchools,
  loadSchool: fetchSchoolCurriculaInfo,
  saveSchoolCurricula: setSchoolCurricula,
};

export const Curricula: React.FC = () => {
  const [criteria, setCriteria] = useState<CriterionRow[] | null | undefined>(undefined);
  const [curricula, setCurricula] = useState<CurriculumOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    Promise.all([fetchCriteria(), fetchCurricula()])
      .then(([checklist, list]) => {
        setCriteria(checklist);
        setCurricula(list);
        setLoadError(null);
      })
      .catch((e) => setLoadError(getErrorMessage(e, 'Could not load the curricula.')));
  };
  useEffect(load, []);

  if (loadError) {
    return (
      <div className="bg-white rounded-2xl p-8 border border-slate-200 max-w-2xl">
        <p className="text-sm font-bold text-rose-600">{loadError}</p>
      </div>
    );
  }
  if (criteria === undefined || !curricula) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-semibold">Loading curricula…</span>
      </div>
    );
  }
  return <CurriculaBody criteria={criteria} curricula={curricula} actions={ACTIONS} onChanged={load} />;
};
