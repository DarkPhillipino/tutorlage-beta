// A learner under 18 never uses a camera on Tutorlage (CEO, 17 Oct 2026: "a learner under 18's camera should be restricted prior,
// during and after the session ... on the entire platform from the moment the account was created for them").
//
// The video rooms are the only place the platform ever switches a camera on, so the rule lives there: the server tells every
// person's page whether their own camera may be used and, in the room's list of people, whose video the others must not
// show (src/pages/RoomPage.tsx and src/lib/roomCall.ts act on it). The rule fails safe: no date of birth on file, or one
// that cannot be read, means no camera. Adults are anyone whose 18th birthday has come (the same boundary the database uses:
// `current_date - interval '18 years'`, in UTC, with 29 February moving to 28 February in a year that has none).

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// The latest date of birth, as yyyy-mm-dd, that makes someone an adult today.
export function adultCutoff(today: Date = new Date()): string {
  const year = today.getUTCFullYear() - 18;
  const month = today.getUTCMonth() + 1;
  let day = today.getUTCDate();
  const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  if (month === 2 && day === 29 && !isLeap(year)) day = 28;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isAdultDateOfBirth(dateOfBirth: string | null | undefined, today: Date = new Date()): boolean {
  if (typeof dateOfBirth !== 'string') return false;
  const match = DATE.exec(dateOfBirth);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  return dateOfBirth <= adultCutoff(today);
}
