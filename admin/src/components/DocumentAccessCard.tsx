import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { DocumentAccessCardBody } from './DocumentAccessCardBody';
import { DocumentAccessView, HoldClient, fetchDocumentAccessView, placeSafetyHold, releaseSafetyHold } from '../lib/safetyHold';
import { supabase } from '../lib/supabaseClient';
import { getErrorMessage } from '../lib/errors';

// "Who opened these documents" and the safety hold, on a person's page. Loads what DocumentAccessCardBody (the screen) needs. Reading
// does not depend on the storage tie: it reads the log table itself, so it works even if no file can be opened. `refreshKey` goes up
// each time a document is opened on the page, so the new line shows at once.
const client = supabase as unknown as HoldClient;

export const DocumentAccessCard: React.FC<{ profileId: string; refreshKey: number }> = ({ profileId, refreshKey }) => {
  const [view, setView] = useState<DocumentAccessView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchDocumentAccessView(client, profileId)
      .then((v) => { setView(v); setError(null); })
      .catch((e) => setError(getErrorMessage(e, 'Could not load the document access log.')));
  }, [profileId]);
  useEffect(load, [load, refreshKey]);

  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await run();
      load();
    } catch (e) {
      setError(getErrorMessage(e, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };

  if (!view) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-slate-200 mb-4 text-xs">
        {error ? <p className="text-rose-600 font-semibold">{error}</p> : <span className="flex items-center text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading the access log…</span>}
      </div>
    );
  }
  return (
    <DocumentAccessCardBody
      view={view}
      busy={busy}
      error={error}
      onPlace={(reason) => act(() => placeSafetyHold(client, profileId, reason))}
      onRelease={(note) => act(() => releaseSafetyHold(client, profileId, note))}
    />
  );
};
