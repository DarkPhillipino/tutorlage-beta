import React from 'react';
import { Link } from 'react-router-dom';

// The frame of a tutor's own pages: the public page /t/CODE, the sign-in and sign-up screens reached from it and the tutor's booking page.
// Colour rule 60 / 30 / 10 (CEO, 25 Nov 2026): a navy header bar and a navy hero panel (30), cream page and white cards (60), green only on the button and small accents (10).
// Real screen sizes (PM line 80, 25 Nov 2026): header and hero together end at about 29 percent of the screen's height (never above 32 percent, from 360x640 phones to a 1280x585 laptop), so the
// first thing to do on each page is on the first screen. tests/browser/tutor-layout.spec.ts measures it.
interface Props {
  // Where the word "Tutorlage" in the header goes. On the booking path it stays on the tutor's own page, never the start page.
  homeTo: string;
  headerRight?: React.ReactNode;
  hero: React.ReactNode;
  // From about 1024 px wide the page may use two columns (the public page).
  wide?: boolean;
  children: React.ReactNode;
}

export function LinkShell({ homeTo, headerRight, hero, wide, children }: Props) {
  const column = `mx-auto w-full px-4 ${wide ? 'max-w-xl lg:max-w-5xl' : 'max-w-xl'}`;
  return (
    <div className="min-h-screen flex flex-col bg-[#FAF7F2] text-[#0F172A]">
      <header className="bg-[#0F172A] text-white">
        <div className={`${column} h-14 flex items-center justify-between gap-3`}>
          <Link to={homeTo} className="text-2xl font-extrabold tracking-tight text-white py-2">Tutorlage</Link>
          {headerRight}
        </div>
      </header>
      {/* The hero is at least 29 percent of the screen less the 3.5rem header; the cards below overlap its last 1.5rem. */}
      <div className="flex flex-col justify-center pt-1 pb-8 min-h-[calc(29svh-3.5rem)] bg-[#0F172A] text-white" data-hero>
        <div className={column}>{hero}</div>
      </div>
      <main className={`${column} -mt-6 pb-10 space-y-4 flex-1`}>{children}</main>
    </div>
  );
}

// The tutor in the hero panel: the approved photo (if any), the name and one line under it.
export function TutorHero({ name, photo, title, subtitle }: { name: string; photo: string | null; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-4">
      {photo && <img src={photo} alt={`${name}, tutor on Tutorlage`} width={72} height={72} className="w-16 h-16 lg:w-[72px] lg:h-[72px] rounded-full object-cover shrink-0 ring-4 ring-white" data-testid="tutor-photo" />}
      <div className="min-w-0">
        <h1 className="font-serif text-2xl sm:text-3xl leading-tight break-words">{title}</h1>
        <p className="text-sm text-slate-300 mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

export const LINK_CARD = 'bg-white rounded-2xl border border-slate-200 p-5 shadow-sm';
export const LINK_HEADING = 'text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-1.5';
export const LINK_BUTTON = 'block w-full text-center bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-sm px-5 py-3.5 rounded-xl cursor-pointer';
export const LINK_INPUT = 'w-full bg-slate-100 text-[#0F172A] placeholder-slate-500 text-sm font-semibold px-4 py-3.5 rounded-xl border border-transparent focus:outline-none focus:border-[#15803D] focus:bg-white focus:ring-2 focus:ring-[#15803D]/20';
export const LINK_LABEL = 'block text-xs font-bold text-slate-600 mb-1.5';
