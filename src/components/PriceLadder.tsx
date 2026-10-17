import React from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { PriceLevel } from '../types';
import { formatRate } from '../lib/format';
import {
  CREDENTIAL_LEAD,
  FIRST_LEVEL_LINE,
  LadderRow,
  MINIMUMS_LEAD,
  TALLY_NOTE,
  availabilityLine,
  requirementLines,
} from '../lib/ladderCopy';

interface PriceLadderProps {
  rows: LadderRow[];
  // Tutors able to take a request at each level (at that level or above) for this search, by level id. null: not known (the
  // lookup failed), in which case no count is shown and every level can still be chosen.
  available: Map<string, number> | null;
  selectedId: string | null;
  onSelect: (level: PriceLevel) => void;
  // The symbol for a currency code (the page passes getCurrencySymbol; a test passes a plain function).
  currencySymbol: (code: string) => string;
}

// All 16 price levels, one card each, with the price and what a tutor at that level has achieved at the least (hours, rating,
// learners who come back, reviews, learners' progress) from the database's own rules. Choosing one pays exactly its price; any
// tutor at that level or above may take the request (CEO, 17 Oct 2026).
export const PriceLadder: React.FC<PriceLadderProps> = ({ rows, available, selectedId, onSelect, currencySymbol }) => {
  const tiers = Array.from(new Set(rows.map((r) => r.tierId))).map((tierId) => {
    const members = rows.filter((r) => r.tierId === tierId);
    return { tierId, name: members[0]?.tierName ?? '', quote: members[0]?.tierQuote ?? '', members };
  });

  return (
    <div className="space-y-6 text-left">
      {available && <p className="text-[11px] text-slate-500 leading-relaxed">{TALLY_NOTE}</p>}
      {tiers.map((tier) => (
        <section key={tier.tierId} aria-label={tier.name}>
          <h3 className="text-sm font-extrabold text-[#0F172A]">{tier.name}</h3>
          {tier.quote && <p className="text-xs text-slate-500 mt-0.5 mb-2.5">{tier.quote}</p>}
          <div className="space-y-2.5">
            {tier.members.map((row) => {
              const tutors = available ? (available.get(row.id) ?? 0) : null;
              const lines = requirementLines(row);
              const chosen = selectedId === row.id;
              const availability = availabilityLine(tutors);
              return (
                <button
                  key={row.id}
                  type="button"
                  data-level={row.id}
                  aria-pressed={chosen}
                  onClick={() =>
                    onSelect({
                      id: row.id,
                      tierId: row.tierId,
                      tierName: row.tierName,
                      price: row.price,
                      currencyCode: row.currencyCode,
                      tutors: tutors ?? 0,
                    })
                  }
                  className={`w-full text-left flex items-start gap-4 p-4 rounded-2xl border bg-white transition-all cursor-pointer group ${
                    chosen ? 'border-[#15803D] ring-2 ring-[#15803D]/20' : 'border-slate-200 hover:border-[#15803D] hover:bg-emerald-50/40'
                  }`}
                >
                  <div className="w-24 shrink-0">
                    <div className="text-lg font-black text-[#0F172A] leading-tight">
                      {currencySymbol(row.currencyCode)}
                      {formatRate(row.price)}
                    </div>
                    <div className="text-[10px] text-slate-400 font-semibold">per hour</div>
                    <div className="mt-1.5 inline-block rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                      Level {row.id}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    {lines.length === 0 ? (
                      <p className="text-xs text-slate-600">{FIRST_LEVEL_LINE}</p>
                    ) : (
                      <>
                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">{MINIMUMS_LEAD}</p>
                        <ul className="space-y-0.5">
                          {lines.map((line) => (
                            <li key={line} className="text-xs text-slate-600 leading-relaxed flex gap-1.5">
                              <Check className="w-3 h-3 text-[#15803D] shrink-0 mt-[3px]" />
                              <span>{line}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {row.credentials.length > 0 && (
                      <div className="mt-1.5 text-[11px] text-slate-500 leading-relaxed" data-credentials={row.id}>
                        <p>{CREDENTIAL_LEAD}</p>
                        <ul className="list-disc pl-4">
                          {row.credentials.map((label) => (
                            <li key={label}>{label}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {availability && (
                      <p className={`text-[11px] font-bold mt-2 ${tutors && tutors > 0 ? 'text-[#15803D]' : 'text-slate-400'}`}>{availability}</p>
                    )}
                  </div>

                  <div className="shrink-0 self-center">
                    {chosen ? (
                      <Check className="w-4 h-4 text-[#15803D]" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[#15803D]" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};
