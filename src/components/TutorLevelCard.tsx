import React from 'react';
import { Check } from 'lucide-react';
import { getCurrencySymbol } from '../lib/currencies';
import { formatRate } from '../lib/format';
import { PUBLIC_PAGE_COPY as COPY, type PublicTutorPage } from '../lib/publicTutorPage';
import { LINK_CARD } from './LinkShell';

// ONE level card for one tutor, in the style of the price ladder's card (PM line 79 B, 25 Nov 2026): the price per hour, the level, the tier's name and its line, and what THIS tutor's
// level rests on. Only the tutor's own credential or own record is ever shown here; the list of what could reach a level belongs to the general price ladder and never appears.
// What is passed inside it (the public page's Book button and its notes) is drawn at the foot of the same card.
export function TutorLevelCard({ page, children }: { page: PublicTutorPage; children?: React.ReactNode }) {
  const basis = page.basis;
  const money = (amount: number) => `${page.currency === 'ZAR' ? 'R' : getCurrencySymbol(page.currency)}${formatRate(amount)}`;
  // While the tutor's code gives a discount, the usual price is crossed out and the price with the discount stands beside it (CEO, 26 Nov 2026). The note under the button, inside this
  // card, says who gets it. The rounding is the database's (promo_paid_rand): the nearest whole rand, halves up.
  // The line is drawn here, not by the browser: lighter than the number and a little below its middle, so a crossed-out 8 does not read as a 0 (CEO, 26 and 28 Nov 2026).
  const offer = page.discount ? Math.round((page.price * (100 - page.discount.percent)) / 100) : page.price;
  return (
    <section className={LINK_CARD} data-level-card={page.levelId} aria-label="Level and price per hour">
      <div className="flex items-start gap-4">
        <div className="min-w-24 shrink-0">
          <div className="flex items-baseline gap-1.5 whitespace-nowrap" data-price>
            {offer < page.price && (
              <s className="relative no-underline text-base font-bold text-slate-500 after:absolute after:inset-x-0 after:top-[55%] after:h-0.5 after:bg-slate-300" data-price-was><span className="sr-only">Usually </span>{money(page.price)}</s>
            )}
            <span className="text-2xl font-black leading-tight" data-price-now>{offer < page.price && <span className="sr-only">with the offer </span>}{money(offer)}</span>
          </div>
          <div className="text-[11px] text-slate-600 font-semibold">per hour</div>
          <div className="mt-1.5 inline-block rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600">Level {page.levelId}</div>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-extrabold">{page.levelName}</h2>
          {page.tierLine && <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{page.tierLine}</p>}
          {basis && (
            <div className="mt-2.5" data-level-basis={basis.kind}>
              <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1">{basis.kind === 'credential' ? COPY.credentialHeading : COPY.recordHeading(page.firstName)}</p>
              <ul className="space-y-0.5">
                {(basis.kind === 'credential' ? [basis.label] : basis.lines).map((line) => (
                  <li key={line} className="text-xs leading-relaxed flex gap-1.5">
                    <Check className="w-3.5 h-3.5 text-[#15803D] shrink-0 mt-[2px]" aria-hidden="true" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
