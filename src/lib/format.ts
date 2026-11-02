// Rand amounts are shown in whole rands: R150, never R150.00 (CEO, 1 Nov 2026: "150 not 150,50"; release gate row SA-LOCALE-01). An amount
// that really has cents is still shown with both decimals (R187.50, never R187.5 and never a rounded R188), because a screen must not name a
// price other than the one charged or paid. Whether such amounts can arise at all is a rounding decision for the CEO; once it is made at the
// source they cannot, and this shows only whole rands. Rounds to the cent first, so 150.0000001 reads R150.
export function formatRate(amount: number): string {
  const cents = Math.round(amount * 100);
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
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
// into "{symbol}{min}+" instead of ever showing the literal huge max_rate.
// symbol defaults to Rand ('R') since that's every real record's currency
// today, but callers with a real currency_code should resolve the actual
// symbol via getCurrencySymbol() in lib/currencies.ts and pass it through —
// this function itself has no data dependency, just formatting.
export function formatRateRange(minRate: number, maxRate: number, symbol: string = 'R'): string {
  return isUncappedRate(maxRate)
    ? `${symbol}${formatRate(minRate)}+`
    : `${symbol}${formatRate(minRate)} - ${symbol}${formatRate(maxRate)}`;
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
