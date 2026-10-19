import React, { useEffect, useState } from 'react';
import { X, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { BookingFormState } from '../types';
import {
  MONTH_NAMES,
  SESSION_LENGTHS,
  WEEKDAY_HEADINGS,
  describeLength,
  firstOpenSlot,
  isPastSlot,
  monthGrid,
  shiftMonth,
  southAfricaClock,
  timeSlots,
} from '../lib/requestSchedule';

// The date, the time and the length chosen here decide which tutors are free (CEO, 19 Oct 2026): a month calendar with days that
// have gone switched off, times in half-hours (South African time, past times off for today), and a length from 1 to 3 hours on
// both tabs. The value kept is a real ISO date ("YYYY-MM-DD"), never the display label.

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  formState: BookingFormState;
  onUpdateSchedule: (scheduleType: 'now' | 'scheduled', date?: string, time?: string, hours?: number) => void;
}

// The date and time the window starts from: the current choice, moved on to today or the next open time if it has gone.
function startingChoice(formState: BookingFormState, now: Date): { date: string; time: string } {
  const today = southAfricaClock(now).date;
  const date = formState.scheduledDate && formState.scheduledDate >= today ? formState.scheduledDate : today;
  const wanted = formState.scheduledTime || '14:00';
  const time = isPastSlot(date, wanted, now) ? firstOpenSlot(date, now) ?? wanted : wanted;
  return { date, time };
}

const monthOf = (iso: string) => ({ year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) - 1 });

export const ScheduleModal: React.FC<ScheduleModalProps> = ({
  isOpen,
  onClose,
  formState,
  onUpdateSchedule,
}) => {
  const initial = startingChoice(formState, new Date());
  const [activeOption, setActiveOption] = useState<'now' | 'scheduled'>(formState.scheduleType);
  const [selectedDate, setSelectedDate] = useState(initial.date);
  const [selectedTime, setSelectedTime] = useState(initial.time);
  const [selectedHours, setSelectedHours] = useState(formState.durationHours);
  const [shownMonth, setShownMonth] = useState(monthOf(initial.date));

  // Every time the window opens it starts from what is chosen now (book-again and the first visit set it from outside).
  useEffect(() => {
    if (!isOpen) return;
    const start = startingChoice(formState, new Date());
    setActiveOption(formState.scheduleType);
    setSelectedDate(start.date);
    setSelectedTime(start.time);
    setSelectedHours(formState.durationHours);
    setShownMonth(monthOf(start.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const now = new Date();
  const todayMonth = monthOf(southAfricaClock(now).date);
  const weeks = monthGrid(shownMonth.year, shownMonth.month, now);
  const onCurrentMonth = shownMonth.year === todayMonth.year && shownMonth.month === todayMonth.month;
  const times = timeSlots();
  const timeHasGone = activeOption === 'scheduled' && isPastSlot(selectedDate, selectedTime, now);

  const chooseDate = (iso: string) => {
    setSelectedDate(iso);
    // Choosing today after the chosen time has gone moves the time on to the next one that is still open.
    if (isPastSlot(iso, selectedTime, now)) setSelectedTime(firstOpenSlot(iso, now) ?? selectedTime);
  };

  const handleSave = () => {
    if (timeHasGone) return;
    onUpdateSchedule(activeOption, selectedDate, selectedTime, selectedHours);
    onClose();
  };

  const lengthPicker = (
    <div>
      <label className="text-xs font-bold text-[#0F172A] block mb-1.5">Session length:</label>
      <div className="grid grid-cols-5 gap-1.5">
        {SESSION_LENGTHS.map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => setSelectedHours(h)}
            aria-pressed={selectedHours === h}
            aria-label={describeLength(h)}
            className={`py-1.5 rounded-xl text-xs font-semibold border text-center transition-all cursor-pointer ${
              selectedHours === h
                ? 'bg-[#0F172A] text-white border-[#0F172A]'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            {h}h
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-md w-full max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >

        {/* Header */}
        <div className="p-5 bg-[#0A192F] text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <Clock className="w-5 h-5 text-emerald-400" />
            <h3 className="text-xl font-extrabold tracking-tight">Schedule Session</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Option Tabs */}
        <div className="p-5 bg-[#FAF7F2] space-y-4 overflow-y-auto">

          <div className="grid grid-cols-2 gap-2 bg-slate-200/80 p-1 rounded-2xl">
            <button
              onClick={() => setActiveOption('now')}
              className={`py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer ${
                activeOption === 'now'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-slate-600 hover:text-[#0F172A]'
              }`}
            >
              Book Instant Tutor
            </button>
            <button
              onClick={() => setActiveOption('scheduled')}
              className={`py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer ${
                activeOption === 'scheduled'
                  ? 'bg-[#0F172A] text-white shadow-xs'
                  : 'text-slate-600 hover:text-[#0F172A]'
              }`}
            >
              Schedule in Advance
            </button>
          </div>

          {activeOption === 'now' ? (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl p-4 border border-slate-200 text-center">
                <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-[#15803D] mx-auto mb-2">
                  <Clock className="w-5 h-5" />
                </div>
                <h4 className="text-sm font-extrabold text-[#0F172A]">Instant Match Active</h4>
                <p className="text-xs text-slate-500 mt-1">
                  Connect with mentors online right now at your institution.
                </p>
              </div>
              <div className="bg-white rounded-2xl p-4 border border-slate-200">{lengthPicker}</div>
            </div>
          ) : (
            <div className="space-y-4 bg-white rounded-2xl p-4 border border-slate-200">
              {/* Date selection: a month calendar */}
              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1.5">
                  Select Date:
                </label>
                <div className="flex items-center justify-between mb-1.5">
                  <button
                    type="button"
                    onClick={() => setShownMonth((m) => shiftMonth(m.year, m.month, -1))}
                    disabled={onCurrentMonth}
                    aria-label="Previous month"
                    className="p-1.5 rounded-full text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-extrabold text-[#0F172A]">
                    {MONTH_NAMES[shownMonth.month]} {shownMonth.year}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShownMonth((m) => shiftMonth(m.year, m.month, 1))}
                    aria-label="Next month"
                    className="p-1.5 rounded-full text-slate-600 hover:bg-slate-100 cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label="Calendar">
                  {WEEKDAY_HEADINGS.map((w) => (
                    <div key={w} className="text-[10px] font-bold text-slate-400 py-1">{w}</div>
                  ))}
                  {weeks.flat().map((day) =>
                    day.inMonth ? (
                      <button
                        key={day.iso}
                        type="button"
                        onClick={() => chooseDate(day.iso)}
                        disabled={day.isPast}
                        aria-label={day.iso}
                        aria-pressed={selectedDate === day.iso}
                        className={`py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                          day.isPast
                            ? 'border-transparent text-slate-300 cursor-default'
                            : selectedDate === day.iso
                              ? 'bg-[#15803D] text-white border-[#15803D] cursor-pointer'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 cursor-pointer'
                        }`}
                      >
                        {day.day}
                      </button>
                    ) : (
                      <div key={day.iso} aria-hidden="true" />
                    ),
                  )}
                </div>
              </div>

              {/* Time selection: half-hours, South African time */}
              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1.5">
                  Select Slot:
                </label>
                <div className="grid grid-cols-4 gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {times.map((t) => {
                    const gone = isPastSlot(selectedDate, t, now);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setSelectedTime(t)}
                        disabled={gone}
                        aria-pressed={selectedTime === t}
                        className={`py-1.5 rounded-xl text-xs font-semibold border text-center transition-all ${
                          gone
                            ? 'border-transparent text-slate-300 cursor-default'
                            : selectedTime === t
                              ? 'bg-[#0F172A] text-white border-[#0F172A] cursor-pointer'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 cursor-pointer'
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>

              {lengthPicker}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 bg-white border-t border-slate-200 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-[#0F172A] cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={timeHasGone}
            className="px-5 py-2.5 bg-[#15803D] hover:bg-[#166534] disabled:opacity-50 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-xs"
          >
            Confirm Schedule
          </button>
        </div>

      </div>
    </div>
  );
};
