import React, { useEffect, useState } from 'react';
import { Bug, Loader2, RefreshCw } from 'lucide-react';
import { fetchClientErrors } from '../lib/queries';
import { ClientErrorsResult, KIND_LABELS, describeAgo, describeWho, summariseClientErrors } from '../lib/clientErrors';

// Error tracking (release gate OPS-ERRORS-01): what the public app reported when a screen crashed or something went wrong that nobody
// caught. One line per kind of error, newest first. The log holds no names, emails or tokens, so what you read here cannot identify
// anyone. Rows not seen for 30 days are deleted by a daily job.
export const ClientErrors: React.FC = () => {
  const [result, setResult] = useState<ClientErrorsResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = () => {
    setIsLoading(true);
    fetchClientErrors()
      .then(setResult)
      .catch((e) => setResult({ state: 'failed', message: e instanceof Error ? e.message : 'Could not load the error log.' }))
      .finally(() => setIsLoading(false));
  };

  useEffect(load, []);

  const summary = result?.state === 'ok' ? summariseClientErrors(result.rows) : null;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-extrabold text-[#0F172A]">Errors</h1>
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
        What the Tutorlage app reported when a screen crashed or something failed that nobody caught. One line per kind of error, most
        recent first. No names, emails or sign-in details are kept; lines not seen for 30 days are deleted.
      </p>

      {isLoading && !result ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm font-semibold">Loading errors…</span>
        </div>
      ) : result?.state === 'not_set_up' ? (
        <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center">
          <Bug className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-bold text-[#0F172A]">Error tracking is not switched on in this database yet</p>
          <p className="text-xs text-slate-500 mt-1">
            It starts working as soon as its small database change is applied. Until then crashes are only written to the visitor's own browser.
          </p>
        </div>
      ) : result?.state === 'failed' ? (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">
          The error log could not be loaded: {result.message}
        </div>
      ) : result?.state === 'ok' && result.rows.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center">
          <Bug className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-bold text-[#0F172A]">No errors reported</p>
          <p className="text-xs text-slate-500 mt-1">Nothing has crashed since tracking was switched on, or everything older than 30 days has been cleared.</p>
        </div>
      ) : result?.state === 'ok' && summary ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              ['Different errors', summary.kinds],
              ['Times they happened', summary.occurrences],
              ['Seen in the last 24 hours', summary.lastDay],
              ['First seen this week', summary.newThisWeek],
            ].map(([label, value]) => (
              <div key={label as string} className="bg-white rounded-xl border border-slate-200 p-3">
                <div className="text-xl font-extrabold text-[#0F172A]">{value}</div>
                <div className="text-[11px] text-slate-500">{label}</div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {result.rows.map((row) => (
              <div key={row.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[#0F172A] break-words">{row.message}</div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      {KIND_LABELS[row.kind] ?? row.kind}
                      {row.kind !== 'overflow' && <> · screen <span className="font-mono text-[11px]">{row.screen}</span></>}
                      {row.browser && <> · {row.browser}</>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-extrabold text-[#0F172A]">{row.occurrences}×</div>
                    {describeWho(row) && <div className="text-[11px] text-slate-500">{describeWho(row)}</div>}
                  </div>
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  First seen {new Date(row.firstSeen).toLocaleString()} · last seen {new Date(row.lastSeen).toLocaleString()} ({describeAgo(row.lastSeen)})
                </div>
                {row.details && (
                  <details className="mt-2">
                    <summary className="text-[11px] font-bold text-slate-500 cursor-pointer">Where in the code</summary>
                    <pre className="mt-1 text-[11px] text-slate-600 bg-slate-50 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-words">{row.details}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
};
