import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Send, UserCheck, Video, ShieldCheck, GraduationCap, BookOpen } from 'lucide-react';
import { PAYMENTS_NOT_OPEN, PAYMENTS_NOT_OPEN_NOTICE } from '../lib/features';
import { SUPPORT_EMAIL } from '../lib/businessInfo';

// The front door of tutorlage.com for someone who is not signed in. Plain on purpose (CEO, 1 Nov 2026: marketing's copy never arrived and
// we are told to disregard it): every sentence below states something the app already does, taken from the About page, the Terms and the
// code that decides who may accept a request. Left out on purpose: prices and earnings figures, any "qualified", "certified" or
// "validated" claim about tutors, a mailing-list form, and anything about payments that are not open yet. The sign-in page is one click
// away from every part of the page.
//
// When something here stops being true, change this file: the list of claims it relies on is in the programmer's report of 1 Nov 2026.

const STEPS = [
  {
    icon: Send,
    title: 'Send a request',
    body: 'Choose a subject, a grade and a level, and ask for a session now or at a day and time that suits you. You see the price of the level you choose before you send.',
  },
  {
    icon: UserCheck,
    title: 'A tutor who fits accepts',
    body: 'Only a tutor who teaches that subject and grade, and is free at that time, can accept. You are charged only when a tutor accepts. If none does in time, you are not charged.',
  },
  {
    icon: Video,
    title: 'Meet online',
    body: "Sessions take place online, in Tutorlage's own video room or through a meeting link the tutor adds. Afterwards you can rate the session, then keep the tutor and book again, or try someone else.",
  },
];

const PARENT_POINTS = [
  "Learners under 18 use Tutorlage through a parent's or guardian's account. The parent or guardian books and gives consent, and the tutor is given the parent's or guardian's name and phone number.",
  "A learner under 18's camera is never switched on or shown. They join the video room with sound only.",
  'Calls are not recorded by Tutorlage.',
  'A tutor may not contact a learner under 18 privately outside a session, except through the parent or guardian.',
  'A parent or guardian can end a lesson at any time and report it.',
];

const TUTOR_POINTS = [
  'Tutors must be 18 or older.',
  'You give Tutorlage your ID or passport and a police clearance certificate issued in the last six months. You cannot accept requests until Tutorlage has verified your profile.',
  'You choose your working hours, and you take requests for the subjects and grades you are approved to teach.',
];

const linkButton =
  'inline-flex items-center justify-center px-5 py-3 rounded-xl font-bold text-sm transition-colors';

export default function Landing() {
  // While the visitor reads, fetch the next pages they are likely to open (the sign-in and sign-up pages, a few kB each) so that a tap on
  // "Sign in or join" still works if the signal drops at that moment. Quiet on failure: it is only a head start.
  useEffect(() => {
    const prefetch = () => {
      for (const load of [() => import('./Login'), () => import('./SignIn'), () => import('./CreateAccount')]) load().catch(() => {});
    };
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(prefetch, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(prefetch, 1500);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#0F172A]">
      <header className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
        <Link to="/" className="text-2xl font-extrabold tracking-tight" aria-label="Tutorlage, start page">
          Tutorlage
        </Link>
        <nav aria-label="Account" className="flex items-center gap-3 text-sm font-bold">
          <Link to="/signup/tutor" className="hidden sm:inline text-[#15803D] hover:underline">
            Become a tutor
          </Link>
          <Link to="/login" className={`${linkButton} bg-[#0F172A] hover:bg-slate-800 text-white py-2.5`}>
            Sign in or join
          </Link>
        </nav>
      </header>

      <main>
        <section className="max-w-5xl mx-auto px-6 pt-8 pb-14 sm:pt-14 sm:pb-20">
          <p className="uppercase tracking-[0.2em] text-[#15803D] text-xs mb-4 font-bold">Online tutoring in South Africa</p>
          <h1 className="font-serif text-4xl sm:text-5xl leading-tight max-w-3xl mb-5">
            Send one request. A tutor who fits accepts it.
          </h1>
          <p className="text-base sm:text-lg text-slate-700 leading-relaxed max-w-2xl mb-8">
            Tutorlage matches school learners and university students with tutors for online sessions. Tell us the subject, grade and time you need.
            There are no profiles to search through and no tutors to message one by one.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link to="/login" className={`${linkButton} bg-[#15803D] hover:bg-[#166534] text-white`}>
              Sign in or join
            </Link>
            <Link to="/signup/tutor" className={`${linkButton} border border-slate-300 bg-white hover:border-[#15803D] text-[#0F172A]`}>
              Become a tutor
            </Link>
          </div>
          {PAYMENTS_NOT_OPEN && (
            <p role="status" data-landing-payments-notice className="mt-6 max-w-xl text-sm font-semibold rounded-lg px-3 py-2.5 bg-amber-50 border border-amber-300 text-amber-900">
              {PAYMENTS_NOT_OPEN_NOTICE}
            </p>
          )}
        </section>

        <section aria-labelledby="how-heading" className="bg-white border-y border-slate-200">
          <div className="max-w-5xl mx-auto px-6 py-14">
            <h2 id="how-heading" className="font-serif text-3xl mb-8">
              How booking works
            </h2>
            <ol className="grid grid-cols-1 md:grid-cols-3 gap-5 list-none p-0 m-0">
              {STEPS.map((s, i) => (
                <li key={s.title} className="bg-[#FAF7F2] rounded-2xl p-6 border border-slate-200/70">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 text-[#15803D] flex items-center justify-center mb-4">
                    <s.icon className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <h3 className="text-base font-bold mb-2">
                    <span className="text-[#15803D]">{i + 1}.</span> {s.title}
                  </h3>
                  <p className="text-sm text-slate-700 leading-relaxed">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="who-heading" className="max-w-5xl mx-auto px-6 py-14">
          <h2 id="who-heading" className="font-serif text-3xl mb-8">
            Who it is for
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <article className="bg-white rounded-2xl p-6 border border-slate-200/80">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="w-5 h-5 text-[#15803D]" aria-hidden="true" />
                <h3 className="text-lg font-bold">Parents and guardians</h3>
              </div>
              <ul className="space-y-2.5 text-sm text-slate-700 leading-relaxed list-disc pl-5">
                {PARENT_POINTS.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <Link to="/signup/parent" className="inline-block mt-5 text-sm font-bold text-[#15803D] hover:underline">
                Join as a parent or guardian
              </Link>
            </article>

            <div className="flex flex-col gap-5">
              <article className="bg-white rounded-2xl p-6 border border-slate-200/80">
                <div className="flex items-center gap-2 mb-3">
                  <BookOpen className="w-5 h-5 text-[#15803D]" aria-hidden="true" />
                  <h3 className="text-lg font-bold">University and college students</h3>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed">
                  If you are 18 or older you can join as a student and book sessions for yourself.
                </p>
                <Link to="/signup/student" className="inline-block mt-4 text-sm font-bold text-[#15803D] hover:underline">
                  Join as a student
                </Link>
              </article>

              <article className="bg-white rounded-2xl p-6 border border-slate-200/80">
                <div className="flex items-center gap-2 mb-3">
                  <GraduationCap className="w-5 h-5 text-[#15803D]" aria-hidden="true" />
                  <h3 className="text-lg font-bold">Tutors</h3>
                </div>
                <ul className="space-y-2.5 text-sm text-slate-700 leading-relaxed list-disc pl-5">
                  {TUTOR_POINTS.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <Link to="/signup/tutor" className="inline-block mt-4 text-sm font-bold text-[#15803D] hover:underline">
                  Become a tutor
                </Link>
              </article>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-sm text-slate-700">
          <nav aria-label="Legal and help" className="flex flex-wrap gap-x-5 gap-y-2 font-semibold">
            <Link to="/about" className="text-[#15803D] hover:underline">About</Link>
            <Link to="/terms" className="text-[#15803D] hover:underline">Terms of Service</Link>
            <Link to="/privacy" className="text-[#15803D] hover:underline">Privacy Policy</Link>
            <Link to="/refunds" className="text-[#15803D] hover:underline">Refund Policy</Link>
            <Link to="/delivery" className="text-[#15803D] hover:underline">Delivery Policy</Link>
            <Link to="/login" className="text-[#15803D] hover:underline">Sign in or join</Link>
          </nav>
          <p>
            Questions? Write to{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-[#15803D] hover:underline">
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
