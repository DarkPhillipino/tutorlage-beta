// An "add to calendar" file for one booked lesson (register row 14, 23 Nov 2026). Built in the browser, nothing is sent anywhere.
// What is in it, on purpose: the lesson's own id (so adding it twice replaces it), the start and end in UTC (so no time-zone block is needed and every
// calendar shows it at the right local time), a title with the subject and the OTHER person's FIRST NAME only, and a plain line to open Tutorlage.
// What is never in it: a surname, a phone number, an email address, a school, the video room link or any web address of a room.
export interface LessonForCalendar {
  id: string;
  subjectName: string | null;
  // The other person's name as the app holds it; only the first word is used.
  otherName: string;
  scheduledStart: string; // ISO timestamptz
  durationHours: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function icsTime(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// RFC 5545 text escaping: backslash, semicolon, comma and line breaks.
export function icsEscape(text: string): string {
  const B = String.fromCharCode(92);
  return text.split(B).join(B + B).split(';').join(B + ';').split(',').join(B + ',').split('\r\n').join(B + 'n').split('\n').join(B + 'n');
}

// Lines longer than 75 bytes are folded: a line break and one space (counted in bytes, never inside a multi-byte character).
export function icsFold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74; // the leading space of a continuation line counts too
    }
    current += ch;
    bytes += b;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function lessonCalendarText(lesson: LessonForCalendar, now: Date = new Date()): string | null {
  const start = new Date(lesson.scheduledStart);
  if (Number.isNaN(start.getTime()) || !(lesson.durationHours > 0)) return null;
  const end = new Date(start.getTime() + Math.round(lesson.durationHours * 3600) * 1000);
  const first = (lesson.otherName || '').trim().split(/\s+/)[0] || 'your tutor';
  const title = `Tutorlage: ${lesson.subjectName?.trim() || 'Tutoring session'} with ${first}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tutorlage//Lessons//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:lesson-${lesson.id}@tutorlage.com`,
    `DTSTAMP:${icsTime(now)}`,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsEscape(title)}`,
    `DESCRIPTION:${icsEscape('Open Tutorlage when it is time to start your lesson.')}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(icsFold).join('\r\n')}\r\n`;
}

export function lessonCalendarFilename(lesson: LessonForCalendar): string {
  const d = new Date(lesson.scheduledStart);
  return Number.isNaN(d.getTime()) ? 'tutorlage-lesson.ics' : `tutorlage-lesson-${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}.ics`;
}

// Gives the person the file. Does nothing outside a browser.
export function downloadLessonCalendar(lesson: LessonForCalendar): boolean {
  const text = lessonCalendarText(lesson);
  if (!text || typeof document === 'undefined' || typeof URL === 'undefined') return false;
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = lessonCalendarFilename(lesson);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}
