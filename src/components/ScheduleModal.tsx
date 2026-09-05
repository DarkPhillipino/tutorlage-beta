import React, { useState } from 'react';
import { X, Clock, Calendar as CalendarIcon, Check } from 'lucide-react';
import { BookingFormState } from '../types';
import { describeDate, toIsoDate } from '../lib/format';

// Real, always-current date options — "Today"/"Tomorrow" plus the next few
// actual calendar dates, instead of a fixed list that goes stale the day
// after it was written. The value stored/selected is a real ISO date
// ("YYYY-MM-DD"), not the display label — a real booking downstream needs
// an actual date, not "Monday, Sep 7" as a string to re-parse.
function getUpcomingDateOptions(count: number): { iso: string; label: string }[] {
  const today = new Date();
  const options: { iso: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    options.push({ iso: toIsoDate(d), label: describeDate(toIsoDate(d)) });
  }
  return options;
}

interface ScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  formState: BookingFormState;
  onUpdateSchedule: (scheduleType: 'now' | 'scheduled', date?: string, time?: string) => void;
}

export const ScheduleModal: React.FC<ScheduleModalProps> = ({
  isOpen,
  onClose,
  formState,
  onUpdateSchedule,
}) => {
  const [activeOption, setActiveOption] = useState<'now' | 'scheduled'>(formState.scheduleType);
  const [selectedDate, setSelectedDate] = useState(formState.scheduledDate || toIsoDate(new Date()));
  const [selectedTime, setSelectedTime] = useState(formState.scheduledTime || '14:00');

  if (!isOpen) return null;

  const dates = getUpcomingDateOptions(5);
  const times = ['09:00', '10:30', '12:00', '14:00', '15:30', '17:00', '18:30', '20:00'];

  const handleSave = () => {
    onUpdateSchedule(activeOption, selectedDate, selectedTime);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-md w-full overflow-hidden flex flex-col shadow-2xl border border-slate-200"
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
        <div className="p-5 bg-[#FAF7F2] space-y-4">
          
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
            <div className="bg-white rounded-2xl p-4 border border-slate-200 text-center">
              <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-[#15803D] mx-auto mb-2">
                <Clock className="w-5 h-5" />
              </div>
              <h4 className="text-sm font-extrabold text-[#0F172A]">Instant Match Active</h4>
              <p className="text-xs text-slate-500 mt-1">
                Connect with mentors online right now at your institution.
              </p>
            </div>
          ) : (
            <div className="space-y-4 bg-white rounded-2xl p-4 border border-slate-200">
              {/* Date selection */}
              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1.5">
                  Select Date:
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {dates.map((d) => (
                    <button
                      key={d.iso}
                      onClick={() => setSelectedDate(d.iso)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                        selectedDate === d.iso
                          ? 'bg-[#15803D] text-white border-[#15803D]'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time selection */}
              <div>
                <label className="text-xs font-bold text-[#0F172A] block mb-1.5">
                  Select Slot:
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {times.map((t) => (
                    <button
                      key={t}
                      onClick={() => setSelectedTime(t)}
                      className={`py-1.5 rounded-xl text-xs font-semibold border text-center transition-all cursor-pointer ${
                        selectedTime === t
                          ? 'bg-[#0F172A] text-white border-[#0F172A]'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
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
            className="px-5 py-2.5 bg-[#15803D] hover:bg-[#166534] text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-xs"
          >
            Confirm Schedule
          </button>
        </div>

      </div>
    </div>
  );
};
