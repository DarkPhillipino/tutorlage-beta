import React from 'react';
import { Link } from 'react-router-dom';
import { Send, Calendar, Tag, Repeat, ShieldCheck, Wallet } from 'lucide-react';
import { BUSINESS_INFO, SAFETY_EMAIL, SUPPORT_EMAIL, isBusinessInfoComplete } from '../lib/businessInfo';

// Every line must be true today. The tutor-checking line is the CEO's approved wording (21 Oct 2026) and is true by construction:
// approving a tutor is refused without both an ID document and a police clearance certificate on file. The payment line describes the
// wallet and bank-transfer top-ups that went live on 3 Nov 2026. This page is also the public /about page (pages/AboutPublic.tsx).
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
    body: 'Sessions start from R50 an hour. You choose a level and see the price before you send a request. If no tutor accepts in time, the price goes straight back to your wallet.',
  },
  {
    icon: Wallet,
    title: 'Pay from your wallet',
    body: 'You pay from a Tutorlage wallet that you top up by bank transfer. Card payments may be added later.',
  },
  {
    icon: ShieldCheck,
    title: 'Checked before they can accept',
    body: 'Every Tutorlage tutor is 18 or older, has given us their ID and a police clearance certificate, and is approved by our team, subject by subject, before they can take a request.',
  },
  {
    icon: Repeat,
    title: 'Learning pays',
    body: "High-performing students, including recent matriculants and trainee teachers, earn part-time from what they're good at, and families get affordable help from people who know the work.",
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
          Tutorlage connects learners with tutors who know their subject, and makes it easier for
          high-performing students to earn money part-time as tutors. You send a request with your
          subject, grade and budget, a tutor who fits accepts it, and your session takes place online.
        </p>

        <h2 className="text-lg font-extrabold text-[#0F172A] mb-2">Why Tutorlage exists</h2>
        <p className="text-sm sm:text-base text-slate-600 leading-relaxed mb-3">
          I started Tutorlage for one purpose: to make it easier for high-performing students to earn money
          part-time as tutors. A strong student already has what other learners need, a real understanding of
          the work. Tutorlage gives them a way to put that to use alongside their own studies, and gives
          learners help from people who know the subject well.
        </p>
        <p className="text-sm text-slate-700 font-semibold mb-1">Pakiso Daniel Setunku</p>
        <p className="text-sm text-slate-600 mb-8">
          Director and founder. Born in Nelspruit, Mpumalanga, and a student at Emeris.
        </p>

        <h2 className="text-lg font-extrabold text-[#0F172A] mb-2">Who we serve</h2>
        <p className="text-sm sm:text-base text-slate-600 leading-relaxed mb-8">
          Today we serve South African learners from Grade R to Grade 12, in online sessions. We plan to
          expand globally and to serve anyone who is seeking an education, from personal learning and
          home schooling to tertiary education, and to add in-person lessons as well.
        </p>

        <h2 className="text-lg font-extrabold text-[#0F172A] mb-3">How it works for you</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
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

        <h2 className="text-lg font-extrabold text-[#0F172A] mb-2">Safety and support</h2>
        <ul className="text-sm sm:text-base text-slate-600 leading-relaxed space-y-1 mb-8 list-disc pl-5">
          <li>Learners under 18 book through a parent or guardian's account.</li>
          <li>
            Safety concerns: <a href={`mailto:${SAFETY_EMAIL}`} className="text-[#15803D] font-semibold hover:underline">{SAFETY_EMAIL}</a>.
          </li>
          <li>
            Questions and support:{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#15803D] font-semibold hover:underline">{SUPPORT_EMAIL}</a>
            {isBusinessInfoComplete() && ` or ${BUSINESS_INFO.phone}`}, Monday to Friday, 9 am to 5 pm South African time (SAST).
          </li>
        </ul>

        {isBusinessInfoComplete() && (
          <p className="text-xs text-slate-500 leading-relaxed border-t border-slate-100 pt-4">
            {BUSINESS_INFO.legalName} · Registration number {BUSINESS_INFO.registrationNumber} · {BUSINESS_INFO.physicalAddress}
            <br />
            <Link to="/terms" className="text-[#15803D] hover:underline">Terms of Service</Link>
            {' · '}
            <Link to="/privacy" className="text-[#15803D] hover:underline">Privacy Policy</Link>
            {' · '}
            <Link to="/refunds" className="text-[#15803D] hover:underline">Refund Policy</Link>
            {' · '}
            <Link to="/delivery" className="text-[#15803D] hover:underline">Delivery Policy</Link>
          </p>
        )}
      </div>
    </div>
  );
};
