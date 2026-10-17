import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { LevelsBody, LevelsData } from '../components/LevelsBody';
import {
  deleteCredentialDefinition,
  fetchLevelsConfig,
  recalculateAllLevels,
  saveCredentialDefinition,
  saveLevel,
  saveTier,
} from '../lib/levelQueries';
import { getErrorMessage } from '../lib/errors';

// CEO, 17 Oct 2026: "the tiers should be defined in the admin app". This page loads the tiers, the 16 levels and the credentials
// that start a tutor at a level, and hands them to LevelsBody (components/LevelsBody.tsx), which has the screen. The actions are
// the admin-only database functions in lib/levelQueries.ts.
const ACTIONS = { saveTier, saveLevel, saveCredentialDefinition, deleteCredentialDefinition, recalculateAllLevels };

export const Levels: React.FC = () => {
  const [data, setData] = useState<LevelsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    fetchLevelsConfig()
      .then((d) => {
        setData(d);
        setLoadError(null);
      })
      .catch((e) => setLoadError(getErrorMessage(e, 'Could not load the levels.')));
  };
  useEffect(load, []);

  if (loadError) {
    return (
      <div className="bg-white rounded-2xl p-8 border border-slate-200 max-w-2xl">
        <p className="text-sm font-bold text-rose-600">{loadError}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-semibold">Loading levels…</span>
      </div>
    );
  }
  return <LevelsBody data={data} actions={ACTIONS} onSaved={load} />;
};

