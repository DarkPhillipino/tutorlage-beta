import React from 'react';
import { CalendarPlus } from 'lucide-react';
import { downloadLessonCalendar, type LessonForCalendar } from '../lib/calendarFile';

// "Add to calendar" for one booked lesson: a small file the person's own calendar opens (lib/calendarFile.ts). Built in the browser; nothing is sent.
export const AddToCalendarButton: React.FC<{ lesson: LessonForCalendar }> = ({ lesson }) => (
  <button
    type="button"
    onClick={() => downloadLessonCalendar(lesson)}
    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#15803D] hover:underline cursor-pointer"
    data-add-to-calendar
  >
    <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" />
    Add to calendar
  </button>
);
