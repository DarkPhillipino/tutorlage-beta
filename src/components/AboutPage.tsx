import React from 'react';
import { Send, Calendar, Tag, Repeat } from 'lucide-react';

// Copy from Drake/marketing-gtm/site-copy-v1.md — every line must be true
// today. The old "Strict verification" pillar claimed document review that
// no part of the app performs yet; it returns once verification is real
// (backlog items 7i/7/7h), with the wording site-copy-v1.md gives for then.
const PILLARS = [
  {
    icon: Send,
    title: 'Matched, not browsed',
    body: "Send one request and a tutor who teaches your subject at your level accepts it. No scrolling through profiles or messaging five tutors to find one who's free.",
  },
  {
    icon: Calendar,
    title: 'Book now or later',
    body: 'Ask for a session straight away or pick a day and time that suits you.',
  },
  {
    icon: Tag,
    title: 'One clear price',
    body: 'You choose a level and pay that price. If no tutor accepts in time, you get your money back automatically.',
  },
  {
    icon: Repeat,
    title: 'Learning pays',
    body: "Recent matriculants and trainee teachers earn from what they're good at, and families get affordable help from people who know the work.",
  },
];

export const AboutPage: React.FC = () => {
  return (
    <div className="max-w-3xl mx-auto w-full">
      <div className="bg-white rounded-2xl p-6 sm:p-10 shadow-sm border border-slate-200/80">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-[#0F172A] tracking-tight mb-4">
          About Tutorlage
        </h1>
        <p className="text-sm sm:text-base text-slate-600 leading-relaxed mb-8">
          Tutorlage connects learners with tutors who know their subject. You send a request with your
          subject, grade and budget, a tutor who fits accepts it, and you see exactly who you've been
          matched with before the session. Tutorlage is built for two kinds of tutor: recent
          matriculants who did well in the subjects they teach, and student and qualified teachers —
          so learners get help from people who know the work, and good students and new teachers get
          paid for what they're good at.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PILLARS.map((p) => (
            <div key={p.title} className="bg-[#FAF7F2] rounded-2xl p-5 border border-slate-200/60">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-[#15803D] flex items-center justify-center mb-3">
                <p.icon className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-[#0F172A] mb-1">{p.title}</h3>
              <p className="text-xs text-slate-600 leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
