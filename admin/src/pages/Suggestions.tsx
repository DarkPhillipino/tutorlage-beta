import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import {
  SUGGESTIONS_CHANGED_EVENT, fetchSuggestions, handleSuggestion,
  type SuggestionStatus, type SuggestionsClient, type SuggestionsResult,
} from '../lib/suggestions';
import { SuggestionsBody, type StatusFilter } from '../components/SuggestionsBody';

const db = supabase as unknown as SuggestionsClient;

// Suggestions (CEO, 5 Nov 2026): what people typed into the Suggestions box on the learn page, newest first. Filter by status, mark one read / planned /
// done / dismissed, keep an internal note nobody else sees, and see who sent it (name, role) and when. It is also where we hear whether anyone wants
// "classes" or an "exam booster" before either is built. Opens cleanly before the database change is applied (a plain "not switched on yet").
export const Suggestions: React.FC = () => {
  const [result, setResult] = useState<SuggestionsResult | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setResult(await fetchSuggestions(db));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onHandle = async (id: string, status: SuggestionStatus, note: string) => {
    setBusyId(id);
    setError(null);
    const problem = await handleSuggestion(db, id, status, note);
    if (problem) setError(problem);
    else {
      await load();
      // The number on the menu item reads again.
      window.dispatchEvent(new Event(SUGGESTIONS_CHANGED_EVENT));
    }
    setBusyId(null);
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-extrabold text-[#0F172A]">Suggestions</h1>
        <button
          type="button"
          onClick={() => void load()}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        What people typed into the Suggestions box on the learn page, newest first. Your note stays inside the admin app: the person never sees it.
        People are asked not to include other people's personal details; if one does, mark it dismissed.
      </p>
      <SuggestionsBody result={result} filter={filter} onFilter={setFilter} busyId={busyId} error={error} onHandle={onHandle} onRetry={() => void load()} />
    </div>
  );
};
