import React, { useEffect, useState } from 'react';
import { Clock, AlertCircle, CheckCircle2, Repeat } from 'lucide-react';
import { TutorAvailabilitySlot } from '../types';
import { saveTutorAvailabilityChanges } from '../lib/queries';
import { getErrorMessage } from '../lib/errors';
import { supabase } from '../lib/supabaseClient';
import {
  DAY_NAMES,
  DAY_SHORT,
  END_OPTIONS,
  EVERY_DAY,
  START_OPTIONS,
  WEEKDAYS,
  WEEKENDS,
  WEEK_ORDER,
  describeDays,
  formatRange,
  fromMinutes,
  idsForDay,
  planSave,
  rangesForDay,
  withValue,
} from '../lib/availabilityPlan';

interface AvailabilityEditorProps {
  tutorId: string;
  availability: TutorAvailabilitySlot[];
  onChange: (slots: TutorAvailabilitySlot[]) => void;
}

const selectClass =
  'w-full bg-slate-100 text-sm font-semibold text-[#0F172A] rounded-lg px-2.5 min-h-11 focus:outline-none focus:ring-2 focus:ring-[#15803D]/40 cursor-pointer';
const shortcutClass =
  'min-h-11 px-3 rounded-lg border border-slate-200 bg-white text-xs font-bold text-[#0F172A] hover:bg-slate-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#15803D]/40';
const rowButtonClass =
  'min-h-9 px-2.5 rounded-lg text-[11px] font-bold cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#15803D]/40 disabled:opacity-50';

// Lets a tutor set their own weekly working hours: tick the days, pick one start and one end time, press Save. The hours repeat every week
// until the tutor changes them (tutor_availability holds a repeating weekly pattern, one row per day and time range, so nothing expires).
// RLS: "Tutors manage own availability" (auth.uid() = tutor_id). What Save writes is decided in lib/availabilityPlan.ts.
export const AvailabilityEditor: React.FC<AvailabilityEditorProps> = ({ tutorId, availability, onChange }) => {
  const [days, setDays] = useState<number[]>([]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [replaceIds, setReplaceIds] = useState<string[]>([]);
  const [replaceLabel, setReplaceLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const rows = availability;
  const hasAny = rows.length > 0;

  // "Set from your sign-up answer" (23 Nov 2026): the database filled these hours from what the tutor said on the join form and stamps the record the first time the tutor
  // changes them (table tutor_hours_autofill, the tutor reads only their own row). Read again whenever the hours change; if the read fails the line is simply not shown.
  const [setFromSignup, setSetFromSignup] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.from('tutor_hours_autofill').select('changed_at').eq('tutor_id', tutorId).maybeSingle();
        if (alive) setSetFromSignup(!!data && data.changed_at === null);
      } catch {
        if (alive) setSetFromSignup(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tutorId, availability]);

  const toggleDay = (d: number) => {
    setNotice(null);
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  };
  const pickDays = (list: number[]) => {
    setNotice(null);
    setDays(list);
  };

  const run = async (inserts: { dayOfWeek: number; startTime: string; endTime: string }[], deleteIds: string[], done: string, failure: string) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const fresh = await saveTutorAvailabilityChanges(tutorId, inserts, deleteIds);
      onChange(fresh);
      setNotice(done);
      return true;
    } catch (e) {
      setError(getErrorMessage(e, failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    const plan = planSave(rows, days, startTime, endTime, replaceIds);
    if (plan.message) {
      setError(plan.message);
      setNotice(null);
      return;
    }
    const what = days.length > 0 ? `${describeDays(days)}, ${startTime} to ${endTime}` : '';
    const done =
      plan.inserts.length === 0 && plan.deleteIds.length === 0
        ? `Those hours were already saved (${what}).`
        : `Saved: ${what}. This repeats every week until you change it.`;
    const ok = await run(plan.inserts, plan.deleteIds, done, 'Could not save those hours.');
    if (ok) {
      setReplaceIds([]);
      setReplaceLabel(null);
      setDays([]);
    }
  };

  const startChange = (day: number, range: { start: number; end: number; ids: string[] }) => {
    setError(null);
    setNotice(null);
    setDays([day]);
    setStartTime(fromMinutes(range.start));
    setEndTime(fromMinutes(range.end));
    setReplaceIds(range.ids);
    setReplaceLabel(`${DAY_NAMES[day]} ${formatRange(range)}`);
  };

  const cancelChange = () => {
    setReplaceIds([]);
    setReplaceLabel(null);
    setDays([]);
  };

  const removeIds = (ids: string[], label: string) =>
    run([], ids, `Removed ${label}.`, 'Could not remove those hours.');

  const clearAll = async () => {
    setConfirmClearAll(false);
    await run([], rows.map((r) => r.id), 'All your working hours were cleared.', 'Could not clear your hours.');
  };

  const startOptions = withValue(START_OPTIONS, startTime);
  const endOptions = withValue(END_OPTIONS, endTime);
  const editing = replaceLabel !== null;

  return (
    <div>
      <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" />
        Working Hours
      </h4>

      <p className="flex items-start gap-1.5 text-xs text-slate-600 mb-3">
        <Repeat className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#15803D]" aria-hidden="true" />
        <span>
          Your hours repeat every week until you change them. You never need to add them again. A learner picks a time inside these hours, and
          the rest of the hours stay open for other lessons. Times are South African time.
        </span>
      </p>

      {setFromSignup && hasAny && (
        <p className="text-xs font-semibold text-[#15803D] mb-2" data-testid="hours-from-signup">
          Set from your sign-up answer
        </p>
      )}

      {/* The week at a glance: what a learner can book. */}
      <div className="space-y-1.5 mb-3" aria-label="Your week">
        {WEEK_ORDER.map((day) => {
          const ranges = rangesForDay(rows, day);
          return (
            <div key={day} className="bg-white rounded-xl p-2.5 border border-slate-200 flex items-start gap-2">
              <span className="w-24 shrink-0 pt-2 text-xs font-bold text-[#0F172A]">{DAY_NAMES[day]}</span>
              <div className="flex-1 min-w-0">
                {ranges.length === 0 ? (
                  <span className="block pt-2 text-xs text-slate-500">Not available</span>
                ) : (
                  ranges.map((r) => (
                    <div key={`${r.start}-${r.end}`} className="flex items-center justify-between gap-1 flex-wrap">
                      <span className="text-xs font-semibold text-slate-700 py-1.5">{formatRange(r)}</span>
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startChange(day, r)}
                          disabled={busy}
                          className={`${rowButtonClass} text-[#15803D] hover:bg-emerald-50`}
                          aria-label={`Change ${DAY_NAMES[day]} ${formatRange(r)}`}
                        >
                          Change
                        </button>
                        <button
                          type="button"
                          onClick={() => removeIds(r.ids, `${DAY_NAMES[day]} ${formatRange(r)}`)}
                          disabled={busy}
                          className={`${rowButtonClass} text-rose-700 hover:bg-rose-50`}
                          aria-label={`Remove ${DAY_NAMES[day]} ${formatRange(r)}`}
                        >
                          Remove
                        </button>
                      </span>
                    </div>
                  ))
                )}
              </div>
              {ranges.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeIds(idsForDay(rows, day), `all of ${DAY_NAMES[day]}`)}
                  disabled={busy}
                  className={`${rowButtonClass} text-slate-600 hover:bg-slate-100`}
                  aria-label={`Clear ${DAY_NAMES[day]}`}
                >
                  Clear day
                </button>
              )}
            </div>
          );
        })}
        {!hasAny && (
          <p className="text-xs text-slate-500 px-1">No working hours yet. Tick your days below, pick your times and press Save.</p>
        )}
      </div>

      {/* One step: days, one time range, one Save. */}
      <div className="bg-white rounded-2xl p-3 border border-slate-200 space-y-3">
        <p className="text-xs font-bold text-[#0F172A]">{editing ? `Change ${replaceLabel}` : 'Add hours'}</p>

        <fieldset>
          <legend className="text-[11px] font-bold text-slate-500 mb-1.5">Which days?</legend>
          <div className="grid grid-cols-7 gap-1" role="group" aria-label="Days of the week">
            {WEEK_ORDER.map((d) => {
              const on = days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(d)}
                  className={`min-h-11 rounded-lg text-xs font-bold border cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#15803D]/40 ${
                    on ? 'bg-[#15803D] border-[#15803D] text-white' : 'bg-white border-slate-300 text-[#0F172A] hover:bg-slate-50'
                  }`}
                >
                  {DAY_SHORT[d]}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <button type="button" onClick={() => pickDays(WEEKDAYS)} className={shortcutClass}>Weekdays</button>
            <button type="button" onClick={() => pickDays(WEEKENDS)} className={shortcutClass}>Weekends</button>
            <button type="button" onClick={() => pickDays(EVERY_DAY)} className={shortcutClass}>Every day</button>
            {days.length > 0 && !editing && (
              <button type="button" onClick={() => pickDays([])} className={`${shortcutClass} text-slate-600`}>Clear ticks</button>
            )}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-[11px] font-bold text-slate-500 mb-1">From</span>
            <select
              value={startTime}
              onChange={(e) => {
                setNotice(null);
                setStartTime(e.target.value);
              }}
              className={selectClass}
            >
              {startOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-bold text-slate-500 mb-1">Until</span>
            <select
              value={endTime}
              onChange={(e) => {
                setNotice(null);
                setEndTime(e.target.value);
              }}
              className={selectClass}
            >
              {endOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>

        {days.length > 0 && (
          <p className="text-xs text-slate-600">
            {describeDays(days)}, {startTime} to {endTime}, every week.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-sm font-bold px-4 min-h-11 rounded-lg transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#15803D]/40 focus:ring-offset-1"
          >
            {busy ? 'Saving…' : editing ? 'Save change' : 'Save'}
          </button>
          {editing && (
            <button type="button" onClick={cancelChange} disabled={busy} className={shortcutClass}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {hasAny && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {confirmClearAll ? (
            <>
              <span className="text-xs text-slate-700">Clear every day?</span>
              <button type="button" onClick={clearAll} disabled={busy} className={`${rowButtonClass} bg-rose-700 text-white hover:bg-rose-800`}>
                Yes, clear all
              </button>
              <button type="button" onClick={() => setConfirmClearAll(false)} className={`${rowButtonClass} text-slate-700 hover:bg-slate-100`}>
                No
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmClearAll(true)} disabled={busy} className={`${rowButtonClass} text-slate-600 hover:bg-slate-100`}>
              Clear all days
            </button>
          )}
        </div>
      )}

      <div aria-live="polite">
        {notice && (
          <div className="flex items-start gap-1.5 mt-2 text-xs text-[#166534] font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
      </div>
      <div role="alert">
        {error && (
          <div className="flex items-start gap-1.5 mt-2 text-xs text-rose-700 font-semibold">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};
