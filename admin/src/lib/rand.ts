// A rand amount in whole rands: 150 reads "150", never "150.00" (CEO, 1 Nov 2026). An amount that really has cents keeps both decimals
// ("187.50"): this screen reports money that moved, so it must never show a figure different from the one charged or paid. The same rule
// as formatRate in the app's src/lib/format.ts (the admin app is built apart and shares no code with it).
export function formatRand(amount: number): string {
  const cents = Math.round(amount * 100);
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}
