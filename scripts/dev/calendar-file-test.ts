// The "add to calendar" file for a booked lesson (23 Nov 2026). Run: npx --no-install tsx scripts/dev/calendar-file-test.ts
import fs from 'node:fs';
import { icsEscape, icsFold, icsTime, lessonCalendarFilename, lessonCalendarText } from '../../src/lib/calendarFile';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const NOW = new Date('2026-11-23T08:00:00Z');
const lesson = { id: 'abc-123', subjectName: 'Mathematics', otherName: 'Thandi Nkosi-Smith', scheduledStart: '2026-11-30T14:00:00+02:00', durationHours: 1.5 };
const text = lessonCalendarText(lesson, NOW)!;
const lines = text.split('\r\n');

check('R1 a calendar with one event, version 2.0, ends with a line break', lines[0] === 'BEGIN:VCALENDAR' && lines.includes('VERSION:2.0') && lines.includes('BEGIN:VEVENT') && lines.includes('END:VEVENT') && lines[lines.length - 2] === 'END:VCALENDAR' && text.endsWith('\r\n'));
check('R2 start and end are in UTC (14:00 SAST is 12:00Z, 90 minutes long)', lines.includes('DTSTART:20261130T120000Z') && lines.includes('DTEND:20261130T133000Z'));
check('R3 the lesson id is the UID, so adding it twice replaces it', lines.includes('UID:lesson-abc-123@tutorlage.com'));
check('R4 the title has the subject and the other person\'s FIRST name only', lines.includes('SUMMARY:Tutorlage: Mathematics with Thandi') && !/Nkosi|Smith/.test(text));
check('R5 no phone number, email address, web address or room link anywhere in the file', !/@(?!tutorlage\.com)/.test(text) && !/https?:/i.test(text) && !/\d{9,}/.test(text) && !/room/i.test(text));
check('R6 DTSTAMP is the moment it was made', lines.includes('DTSTAMP:20261123T080000Z'));
check('R7 a missing subject gets a plain title', lessonCalendarText({ ...lesson, subjectName: null }, NOW)!.includes('SUMMARY:Tutorlage: Tutoring session with Thandi'));
check('R8 a bad date or a zero length gives no file', lessonCalendarText({ ...lesson, scheduledStart: 'not a date' }, NOW) === null && lessonCalendarText({ ...lesson, durationHours: 0 }, NOW) === null);
const BS = String.fromCharCode(92);
check('R9 text is escaped (comma, semicolon, backslash, new line)', icsEscape(`a,b;c${BS}d\ne`) === `a${BS},b${BS};c${BS}${BS}d${BS}ne`);
check('R10 a long line is folded at 75 bytes, never inside a character, and unfolds to the original', (() => {
  const long = `SUMMARY:${'é'.repeat(60)}`;
  const folded = icsFold(long);
  const physical = folded.split('\r\n');
  return physical.length > 1 && physical.every((l) => new TextEncoder().encode(l).length <= 75) && physical.map((l, i) => (i === 0 ? l : l.slice(1))).join('') === long;
})());
check('R11 icsTime pads and uses UTC', icsTime(new Date('2026-01-02T03:04:05Z')) === '20260102T030405Z');
check('R12 the file is named by the lesson date', lessonCalendarFilename(lesson) === 'tutorlage-lesson-2026-11-30.ics' && lessonCalendarFilename({ ...lesson, scheduledStart: 'x' }) === 'tutorlage-lesson.ics');
check('R13 every line is at most 75 bytes', lines.every((l) => new TextEncoder().encode(l).length <= 75));

const read = (p: string) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
check('S1 the parent\'s upcoming list and the tutor\'s next sessions both carry the button', /AddToCalendarButton lesson=/.test(read('src/components/UpcomingSessionsPanel.tsx')) && /AddToCalendarButton lesson=/.test(read('src/components/TutorNextSessions.tsx')));
check('S2 nothing is sent anywhere: the file is built in the browser (no fetch, no rpc)', !/fetch\(|\.rpc\(|supabase/.test(read('src/lib/calendarFile.ts')) && !/fetch\(|\.rpc\(|supabase/.test(read('src/components/AddToCalendarButton.tsx')));

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
