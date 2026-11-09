import React, { useState } from 'react';
import { Lightbulb, Loader2 } from 'lucide-react';
import {
  NOTE_MAX_CHARS, ROLE_LABELS, STATUS_LABELS, SUGGESTIONS_NOT_ON_YET, SUGGESTION_STATUSES,
  countsByStatus, describeAgo, filterSuggestions,
  type SuggestionRow, type SuggestionStatus, type SuggestionsResult,
} from '../lib/suggestions';

// The Suggestions page, drawn (pure: the data and the actions come in as props, so a test can render every state). What people wrote is printed as
// plain text inside the page (React escapes it): nothing here is ever put on the page as HTML.

export type StatusFilter = SuggestionStatus | 'all';

interface Props {
  // null while the first read is running.
  result: SuggestionsResult | null;
  filter: StatusFilter;
  onFilter: (f: StatusFilter) => void;
  // The id being saved right now (its buttons wait), and the sentence to show if the last save failed.
  busyId: string | null;
  error: string | null;
  // Save a status and the note typed on that card. Resolves when the screen has read the list again.
  onHandle: (id: string, status: SuggestionStatus, note: string) => void | Promise<void>;
  onRetry: () => void;
}

const STATUS_TONE: Record<SuggestionStatus, string> = {
  new: 'bg-amber-100 text-amber-800',
  read: 'bg-slate-100 text-slate-700',
  planned: 'bg-sky-100 text-sky-800',
  done: 'bg-emerald-100 text-emerald-800',
  dismissed: 'bg-slate-100 text-slate-500',
};

const SuggestionCard: React.FC<{ row: SuggestionRow; busy: boolean; onHandle: Props['onHandle'] }> = ({ row, busy, onHandle }) => {
  const [note, setNote] = useState(row.note);
  const changed = note.trim() !== row.note.trim();
  const when = row.createdAt ? new Date(row.createdAt).toLocaleString() : '';
  // Every status button also saves the note typed here. "Save note" keeps the status as it is.
  const actions: { status: SuggestionStatus; label: string }[] = [
    { status: 'read', label: 'Mark read' },
    { status: 'planned', label: 'Planned' },
    { status: 'done', label: 'Done' },
    { status: 'dismissed', label: 'Dismiss' },
    { status: 'new', label: 'Back to new' },
  ];
  return (
    <div data-suggestion={row.status} className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold text-[#0F172A]">
            {row.name} <span className="font-semibold text-slate-500">· {ROLE_LABELS[row.role] ?? (row.role || 'Unknown role')}</span>
          </div>
          <div className="text-[11px] text-slate-400">
            {when}{row.createdAt && <> ({describeAgo(row.createdAt)})</>}
          </div>
        </div>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STATUS_TONE[row.status]}`}>{STATUS_LABELS[row.status]}</span>
      </div>

      <p data-suggestion-body className="text-sm text-[#0F172A] mt-2 whitespace-pre-wrap break-words">{row.body}</p>

      {row.handledAt && (
        <p className="text-[11px] text-slate-400 mt-1">
          Last handled {new Date(row.handledAt).toLocaleString()}{row.handledBy ? ` by ${row.handledBy}` : ''}
        </p>
      )}

      <label className="block mt-3">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Internal note (the person never sees it)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={NOTE_MAX_CHARS}
          className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {actions.filter((a) => a.status !== row.status).map((a) => (
          <button
            key={a.status}
            type="button"
            disabled={busy}
            onClick={() => void onHandle(row.id, a.status, note)}
            className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
          >
            {a.label}
          </button>
        ))}
        {changed && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onHandle(row.id, row.status, note)}
            className="px-3 py-1.5 rounded-lg bg-[#0F172A] text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
          >
            Save note
          </button>
        )}
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
      </div>
    </div>
  );
};

export const SuggestionsBody: React.FC<Props> = ({ result, filter, onFilter, busyId, error, onHandle, onRetry }) => {
  if (result === null) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-semibold">Loading suggestions…</span>
      </div>
    );
  }
  if (result.state === 'not_set_up') {
    return (
      <div data-suggestions-not-set-up className="bg-white rounded-2xl p-8 border border-slate-200 text-center">
        <Lightbulb className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm font-bold text-[#0F172A]">No suggestions yet</p>
        <p className="text-xs text-slate-500 mt-1">{SUGGESTIONS_NOT_ON_YET}</p>
      </div>
    );
  }
  if (result.state === 'failed') {
    return (
      <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">
        The suggestions could not be loaded: {result.message}{' '}
        <button type="button" onClick={onRetry} className="font-bold underline cursor-pointer">Try again</button>
      </div>
    );
  }

  const counts = countsByStatus(result.rows);
  const shown = filterSuggestions(result.rows, filter);
  const tabs: { key: StatusFilter; label: string }[] = [{ key: 'all', label: 'All' }, ...SUGGESTION_STATUSES.map((s) => ({ key: s as StatusFilter, label: STATUS_LABELS[s] }))];
  return (
    <>
      <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-2 mb-4">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={filter === t.key}
            onClick={() => onFilter(t.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer ${filter === t.key ? 'bg-[#0F172A] text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-xs font-semibold text-rose-600 mb-3">{error}</p>}
      {shown.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center">
          <Lightbulb className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-bold text-[#0F172A]">{result.rows.length === 0 ? 'No suggestions yet' : `No ${filter === 'all' ? '' : STATUS_LABELS[filter].toLowerCase() + ' '}suggestions`}</p>
          <p className="text-xs text-slate-500 mt-1">{result.rows.length === 0 ? 'What people send from the Suggestions box on the learn page appears here, newest first.' : 'Choose another status above.'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          {shown.map((row) => (
            // Keyed on the saved state too, so the note box shows what was saved after a re-read.
            <SuggestionCard key={`${row.id}:${row.status}:${row.note}`} row={row} busy={busyId === row.id} onHandle={onHandle} />
          ))}
        </div>
      )}
    </>
  );
};
