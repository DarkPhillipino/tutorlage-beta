import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { getErrorMessage } from '../lib/errors';
import { HoldListClient, SafetyHoldList, fetchSafetyHolds } from '../lib/safetyHolds';
import { SafetyHoldsBody } from '../components/SafetyHoldsBody';

// Safety holds (CEO, 21 Oct 2026): the people whose data is being kept because they were reported for dangerous or illegal activity.
// A hold is placed and released from the person's own page; this is the one place to see everyone on hold at once, for example before
// anything is deleted by hand.
const client = supabase as unknown as HoldListClient;

export const SafetyHolds: React.FC = () => {
  const [list, setList] = useState<SafetyHoldList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = () => {
    setIsLoading(true);
    fetchSafetyHolds(client)
      .then((l) => { setList(l); setError(null); })
      .catch((e) => setError(getErrorMessage(e, 'Could not load the safety holds.')))
      .finally(() => setIsLoading(false));
  };
  useEffect(load, []);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-extrabold text-[#0F172A]">Safety holds</h1>
        <button
          type="button"
          onClick={load}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        People on a safety hold right now, with the reason written down when it was placed. While a hold is on, their access-log lines and
        video-room records are kept past the usual clean-up, and they cannot remove or replace their own documents. Check this list before
        deleting anything by hand.
      </p>
      {isLoading && !list ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm font-semibold">Loading safety holds…</span>
        </div>
      ) : error ? (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">
          The safety holds could not be loaded: {error}
        </div>
      ) : list ? (
        <SafetyHoldsBody list={list} />
      ) : null}
    </div>
  );
};
