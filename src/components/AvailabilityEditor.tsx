import React, { useState } from 'react';
import { Plus, Trash2, Clock, AlertCircle } from 'lucide-react';
import { TutorAvailabilitySlot } from '../types';
import { addTutorAvailabilitySlot, deleteTutorAvailabilitySlot } from '../lib/queries';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface AvailabilityEditorProps {
  tutorId: string;
  availability: TutorAvailabilitySlot[];
  onChange: (slots: TutorAvailabilitySlot[]) => void;
}

// Lets a tutor set their own recurring weekly working hours — the write
// side of tutor_availability (TutorCalendar / fetchTutorAvailability only
// ever read it). RLS: "Tutors manage own availability" (auth.uid() = tutor_id).
export const AvailabilityEditor: React.FC<AvailabilityEditorProps> = ({ tutorId, availability, onChange }) => {
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortSlots = (slots: TutorAvailabilitySlot[]) =>
    [...slots].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));

  const handleAdd = async () => {
    setError(null);
    if (startTime >= endTime) {
      setError('End time must be after start time.');
      return;
    }
    setIsSaving(true);
    try {
      const slot = await addTutorAvailabilitySlot(tutorId, dayOfWeek, startTime, endTime);
      onChange(sortSlots([...availability, slot]));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that slot.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (slotId: string) => {
    setError(null);
    setDeletingId(slotId);
    try {
      await deleteTutorAvailabilitySlot(slotId);
      onChange(availability.filter((s) => s.id !== slotId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that slot.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" />
        Working Hours
      </h4>

      <div className="space-y-1.5 mb-3">
        {availability.length === 0 ? (
          <div className="bg-white rounded-2xl p-4 border border-slate-200 text-center">
            <p className="text-xs text-slate-500">No working hours set yet — add some below.</p>
          </div>
        ) : (
          availability.map((slot) => (
            <div key={slot.id} className="bg-white rounded-xl p-3 border border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold text-[#0F172A]">{DAY_NAMES[slot.dayOfWeek] ?? `Day ${slot.dayOfWeek}`}</span>
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] font-semibold text-slate-600">{slot.startTime.slice(0, 5)} - {slot.endTime.slice(0, 5)}</span>
                <button
                  onClick={() => handleDelete(slot.id)}
                  disabled={deletingId === slot.id}
                  className="p-1 rounded-full hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer disabled:opacity-50"
                  aria-label={`Remove ${DAY_NAMES[slot.dayOfWeek]} ${slot.startTime.slice(0, 5)}-${slot.endTime.slice(0, 5)} slot`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="bg-white rounded-2xl p-3 border border-slate-200 flex items-center gap-2 flex-wrap">
        <select
          value={dayOfWeek}
          onChange={(e) => setDayOfWeek(Number(e.target.value))}
          className="flex-1 min-w-[7rem] bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20 cursor-pointer"
        >
          {DAY_NAMES.map((d, i) => (
            <option key={i} value={i}>{d}</option>
          ))}
        </select>
        <input
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          className="bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
        />
        <span className="text-xs text-slate-400">to</span>
        <input
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          className="bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
        />
        <button
          onClick={handleAdd}
          disabled={isSaving}
          className="ml-auto flex items-center gap-1 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold px-3 py-2 rounded-lg transition-all cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-1.5 mt-2 text-[11px] text-rose-600 font-semibold">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
