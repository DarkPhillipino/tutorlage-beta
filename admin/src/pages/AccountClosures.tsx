import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { getErrorMessage } from '../lib/errors';
import { fetchUsers } from '../lib/queries';
import { ClosureList, ClosuresClient, fetchAccountClosures } from '../lib/accountClosures';
import { AccountClosuresBody } from '../components/AccountClosuresBody';
import { CloseOnRequestForm } from '../components/CloseOnRequestForm';

// Account closures (legal B1 to B5): accounts that were closed and are waiting for their day-30 deletion; closing someone on a written
// request; undoing a closure; deferring a deletion. The people close their own accounts from the app; this page is for what an admin does.
// On a database without the migration the list shows a plain note, never an error (like the Safety holds page).
const client = supabase as unknown as ClosuresClient;

export const AccountClosures: React.FC = () => {
  const [list, setList] = useState<ClosureList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = () => {
    setIsLoading(true);
    fetchAccountClosures(client)
      .then((l) => { setList(l); setError(null); })
      .catch((e) => setError(getErrorMessage(e, 'Could not load the account closures.')))
      .finally(() => setIsLoading(false));
  };
  useEffect(load, []);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-extrabold text-[#0F172A]">Account closures</h1>
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
        Closed accounts waiting for deletion (30 days after closing, and always within 90). A person on a safety hold stays here and nothing
        about them is deleted. You can undo a closure for the first 30 days, or ask deletion to wait.
      </p>

      {list?.state !== 'not_active' && (
        <CloseOnRequestForm
          client={client}
          findPeople={(term) => fetchUsers(term).then((rows) => rows.map((r) => ({ id: r.id, fullName: r.fullName, email: r.email, role: r.role })))}
          onClosed={load}
        />
      )}

      {isLoading && !list ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm font-semibold">Loading account closures…</span>
        </div>
      ) : error ? (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">
          The account closures could not be loaded: {error}
        </div>
      ) : list ? (
        <AccountClosuresBody list={list} client={client} onChanged={load} />
      ) : null}
    </div>
  );
};
