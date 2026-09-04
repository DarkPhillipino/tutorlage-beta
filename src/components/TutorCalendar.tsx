import React from 'react';
import { CalendarClock, CheckCircle2, Circle, GraduationCap } from 'lucide-react';
import { TutorAvailabilitySlot, TutorSession } from '../types';

interface TutorCalendarProps {
  availability: TutorAvailabilitySlot[];
  sessions: TutorSession[];
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatTime = (t: string) => t.slice(0, 5);

// Combines a calendar date with a "HH:MM:SS" time-of-day into a Date in the
// viewer's own local timezone — this is what makes the calendar "sync with
// device time": no server-side timezone handling needed, the browser does it.
function atTime(date: Date, time: string): Date {
  const [h, m, s] = time.split(':').map(Number);
  const d = new Date(date);
  d.setHours(h, m, s ?? 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// A slot instance (this specific date's occurrence of a recurring weekly
// availability slot) counts as booked if any upcoming session overlaps it.
function isSlotBooked(slotStart: Date, slotEnd: Date, sessions: TutorSession[]): boolean {
  return sessions.some((s) => {
    const sessionStart = new Date(s.scheduledStart);
    const sessionEnd = new Date(sessionStart.getTime() + s.durationHours * 3600_000);
    return sessionStart < slotEnd && sessionEnd > slotStart;
  });
}

export const TutorCalendar: React.FC<TutorCalendarProps> = ({ availability, sessions }) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));

  return (
    <div className="space-y-4">

      {/* Next 7 days: availability slots, marked open vs booked */}
      <div>
        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <CalendarClock className="w-3.5 h-3.5" />
          Next 7 Days
        </h4>
        <div className="grid grid-cols-7 gap-1.5">
          {days.map((day) => {
            const daySlots = availability.filter((a) => a.dayOfWeek === day.getDay());
            return (
              <div key={day.toISOString()} className="bg-white rounded-xl border border-slate-200 p-1.5 min-h-[5.5rem]">
                <div className="text-center mb-1">
                  <div className="text-[9px] font-bold text-slate-400 uppercase">{DAY_LABELS[day.getDay()]}</div>
                  <div className="text-[11px] font-bold text-[#0F172A]">{day.getDate()}</div>
                </div>
                <div className="space-y-1">
                  {daySlots.length === 0 ? (
                    <div className="text-center text-[8px] text-slate-300 leading-tight">—</div>
                  ) : (
                    daySlots.map((slot) => {
                      const slotStart = atTime(day, slot.startTime);
                      const slotEnd = atTime(day, slot.endTime);
                      const booked = isSlotBooked(slotStart, slotEnd, sessions);
                      return (
                        <div
                          key={slot.id}
                          className={`rounded-md px-1 py-0.5 text-center leading-tight ${
                            booked ? 'bg-[#0F172A] text-white' : 'bg-emerald-100 text-[#15803D]'
                          }`}
                        >
                          <div className="text-[8px] font-bold">{formatTime(slot.startTime)}</div>
                          <div className="text-[7px] font-semibold opacity-80">{booked ? 'Booked' : 'Open'}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-100 border border-emerald-200 inline-block" /> Open, not yet booked</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#0F172A] inline-block" /> Booked</span>
        </div>
      </div>

      {/* Upcoming sessions */}
      <div>
        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <GraduationCap className="w-3.5 h-3.5" />
          Upcoming Sessions
        </h4>
        {sessions.length === 0 ? (
          <div className="bg-white rounded-2xl p-4 border border-slate-200 text-center">
            <p className="text-xs text-slate-500">No upcoming sessions — nothing to prepare for yet.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {sessions.map((s) => {
              const start = new Date(s.scheduledStart);
              return (
                <div key={s.id} className="bg-white rounded-xl p-3 border border-slate-200 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#0F172A] truncate">
                      {s.subjectName ?? 'Tutoring session'} with {s.studentName}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                      {' · '}
                      {start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      {' · '}{s.durationHours}h
                    </div>
                  </div>
                  {s.status === 'confirmed' ? (
                    <CheckCircle2 className="w-4 h-4 text-[#15803D] shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-slate-300 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
};
