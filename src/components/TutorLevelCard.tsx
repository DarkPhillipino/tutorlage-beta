import React from 'react';
import { Check } from 'lucide-react';
import { getCurrencySymbol } from '../lib/currencies';
import { formatRate } from '../lib/format';
import { PUBLIC_PAGE_COPY as COPY, type PublicTutorPage } from '../lib/publicTutorPage';
import { LINK_CARD } from './LinkShell';

// ONE level card for one tutor, in the style of the price ladder's card (PM line 79 B, 25 Nov 2026): the price per hour, the level, the tier's name and its line, and what THIS tutor's
// level rests on. Only the tutor's own credential or own record is ever shown here; the list of what could reach a level belongs to the general price ladder and never appears.
export function TutorLevelCard({ page }: { page: PublicTutorPage }) {
  const basis = page.basis;
  return (
    <section className={LINK_CARD} data-level-card={page.levelId} aria-label="Level and price per hour">
      <div className="flex items-start gap-4">
        <div className="w-24 shrink-0">
          <div className="text-2xl font-black leading-tight">{page.currency === 'ZAR' ? 'R' : getCurrencySymbol(page.currency)}{formatRate(page.price)}</div>
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
    </section>
  );
}
