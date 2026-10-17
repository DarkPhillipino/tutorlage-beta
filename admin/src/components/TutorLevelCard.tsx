import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { TutorLevelCardBody } from './TutorLevelCardBody';
import {
  assignTutorLevel,
  clearTutorAssignedLevel,
  fetchLevelsConfig,
  fetchTutorLevelInfo,
  recordTutorCredential,
  removeTutorCredential,
} from '../lib/levelQueries';
import { getErrorMessage } from '../lib/errors';
import type { CredentialConfig, LevelConfig, TutorLevelInfo, VerificationDocument } from '../types';

// CEO, 17 Oct 2026: "admins should be able to assign tier roles from the admin app". This loads what the Level section of a tutor's
// page needs and hands it to TutorLevelCardBody (TutorLevelCardBody.tsx), which has the screen and the notes on how it works.
const ACTIONS = { assignTutorLevel, clearTutorAssignedLevel, recordTutorCredential, removeTutorCredential };

export const TutorLevelCard: React.FC<{ tutorId: string; documents: VerificationDocument[] }> = ({ tutorId, documents }) => {
  const [loaded, setLoaded] = useState<{ info: TutorLevelInfo; levels: LevelConfig[]; definitions: CredentialConfig[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    Promise.all([fetchTutorLevelInfo(tutorId), fetchLevelsConfig()])
      .then(([info, cfg]) => {
        setLoaded({ info, levels: cfg.levels, definitions: cfg.credentials });
        setLoadError(null);
      })
      .catch((e) => setLoadError(getErrorMessage(e, "Could not load this tutor's level.")));
  };
  useEffect(load, [tutorId]);

  if (loadError) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-slate-200 mb-4">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Level</h2>
        <p className="text-xs text-rose-600 font-semibold">{loadError}</p>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-slate-200 mb-4 flex items-center text-slate-400 text-xs">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading level…
      </div>
    );
  }
  return <TutorLevelCardBody tutorId={tutorId} documents={documents} info={loaded.info} levels={loaded.levels} definitions={loaded.definitions} actions={ACTIONS} onChanged={load} />;
};

