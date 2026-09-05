// Rand amounts render as fixed 2-decimal currency, not raw floats (R150.50,
// never R150.5).
export function formatRate(amount: number): string {
  return amount.toFixed(2);
}

// The top pricing tier's max_rate is set to a huge sentinel value
// (10,000,000.00 as of writing) rather than a real ceiling, since there
// genuinely isn't one — the DB needs *some* number in a NOT NULL numeric
// column. Never render that sentinel as a literal number (it reads as an
// absurd, off-putting price cap); render "min+" instead. Anything at or
// above this threshold is treated as "uncapped."
const UNCAPPED_RATE_THRESHOLD = 100_000;

export function isUncappedRate(maxRate: number): boolean {
  return maxRate >= UNCAPPED_RATE_THRESHOLD;
}

// Formats a tier's rate range for display, collapsing the uncapped sentinel
// into "R{min}+" instead of ever showing the literal huge max_rate.
export function formatRateRange(minRate: number, maxRate: number): string {
  return isUncappedRate(maxRate)
    ? `R${formatRate(minRate)}+`
    : `R${formatRate(minRate)} - R${formatRate(maxRate)}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "YYYY-MM-DD" in the *local* timezone — deliberately not toISOString()
// (which is UTC and can land on the wrong calendar day near midnight).
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// The inverse of toIsoDate for display: "Today"/"Tomorrow" for the next two
// days, otherwise "Weekday, Mon D" — the actual source of truth for a
// scheduled booking is the ISO date (BookingFormState.scheduledDate); this
// is only ever a display label derived from it, never stored itself.
export function describeDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  const todayIso = toIsoDate(today);
  const tomorrowIso = toIsoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));

  if (isoDate === todayIso) return 'Today';
  if (isoDate === tomorrowIso) return 'Tomorrow';
  return `${WEEKDAYS[target.getDay()]}, ${MONTHS[target.getMonth()]} ${target.getDate()}`;
}
