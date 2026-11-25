import React from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { rand0 } from '../lib/wallet';
import { CONFIRM_COPY as WORDS } from '../lib/pageConfirm';
import { LINK_BUTTON, LINK_CARD } from './LinkShell';

export interface LessonFacts {
  tutor: string;
  learner: string;
  subject: string;
  grade: string;
  date: string; // in words
  times: string; // "14:00 to 15:00"
}

const outline = 'block w-full text-center bg-white border border-slate-300 hover:border-[#0F172A] disabled:opacity-60 text-[#0F172A] font-bold text-sm px-5 py-3 rounded-xl cursor-pointer';

const Rows: React.FC<{ rows: [string, string][] }> = ({ rows }) => (
  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" data-lesson-facts>
    {rows.map(([label, value]) => (
      <React.Fragment key={label}>
        <dt className="text-slate-600">{label}</dt>
        <dd className="font-bold text-right text-[#0F172A]">{value}</dd>
      </React.Fragment>
    ))}
  </dl>
);

const facts = (f: LessonFacts): [string, string][] => [
  [WORDS.tutor, f.tutor], [WORDS.learner, f.learner], [WORDS.subject, f.subject], [WORDS.grade, f.grade], [WORDS.date, f.date], [WORDS.time, f.times],
];

// The step before anything happens (PM line 81 C): everything the family is about to book, the price, the credit left and the Terms' cancellation rule.
export const ConfirmBooking: React.FC<{
  lesson: LessonFacts;
  price: number;
  promoLine: string | null;
  creditLeft: number;
  busy: boolean;
  error: { text: string; nothing: boolean } | null;
  onConfirm: () => void;
  onChange: () => void;
}> = ({ lesson, price, promoLine, creditLeft, busy, error, onConfirm, onChange }) => (
  <section className={`${LINK_CARD} space-y-3`} data-confirm-step>
    <h2 className="text-base font-extrabold">{WORDS.heading}</h2>
    <Rows rows={[...facts(lesson), [WORDS.price, rand0(price)], [WORDS.left, rand0(creditLeft)]]} />
    {promoLine && <p data-promo-applied className="text-xs font-extrabold text-[#15803D]">{promoLine}</p>}
    <div className="text-xs text-slate-700 border-t border-slate-200 pt-2" data-cancel-rule>
      <span className="font-bold">{WORDS.cancelHeading}: </span>{WORDS.cancelSelf} {WORDS.cancelTutor}
    </div>
    {error && (
      <div role="alert" data-booking-refusal className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 text-xs font-semibold text-rose-700 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>{error.text}{error.nothing ? ` ${WORDS.nothing}` : ''}</span>
      </div>
    )}
    <button type="button" onClick={onConfirm} disabled={busy} className={LINK_BUTTON}>
      {busy ? <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />{WORDS.confirming}</span> : WORDS.confirm}
    </button>
    <button type="button" onClick={onChange} disabled={busy} className={outline}>{WORDS.change}</button>
  </section>
);

export const BookedPanel: React.FC<{
  lesson: LessonFacts;
  paid: number;
  creditNow: number | null;
  onAnother: () => void;
}> = ({ lesson, paid, creditNow, onAnother }) => (
  <section className={`${LINK_CARD} space-y-3`} data-booked role="status">
    <h2 className="text-xl font-extrabold flex items-center gap-2"><CheckCircle2 className="w-6 h-6 text-[#15803D]" aria-hidden="true" />{WORDS.booked}</h2>
    <p className="text-sm text-slate-700">{WORDS.bookedMore(lesson.tutor)}</p>
    <Rows rows={[...facts(lesson), [WORDS.paid, rand0(paid)], ...(creditNow === null ? [] : [[WORDS.creditNow, rand0(creditNow)] as [string, string]])]} />
    <Link to="/?view=sessions" className={LINK_BUTTON}>{WORDS.sessions}</Link>
    <button type="button" onClick={onAnother} className={outline}>{WORDS.another}</button>
  </section>
);
