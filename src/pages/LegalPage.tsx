import React from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { BUSINESS_INFO, SAFETY_EMAIL, SUPPORT_EMAIL, isBusinessInfoComplete } from '../lib/businessInfo';

// Public (not behind sign-in) so anyone can read the terms before signing up.
//
// The documents themselves are still drafts (Drake/legal/drafts/*.md, v3).
// Publishing draft text full of review flags would be worse than saying plainly
// that they're being finalised, so each page says exactly that. When a document
// is final, render it here in place of the notice. (The CEO, 2026-10-07: no
// attorney sign-off is needed for the policies.)
//
// Test phase 1 (backlog 7ar): during the closed test the tester notice stands
// in for the Terms and the Privacy Policy, because sign-up asks people to
// accept them. It renders only once BUSINESS_INFO is complete: the notice must
// name the company (POPIA s 18(1)(b)), and legal's rule is never to publish
// placeholder supplier details. When publishing, also set
// current_terms_version / current_privacy_version on the database to
// TESTER_NOTICE_VERSION so acceptances point at this text.
const TEST_PHASE_1 = true;
// '-b' (2026-10-05): names GitHub (site hosting) and Google Forms (feedback), and adds browser storage.
// '-c' (2026-10-07): adults invited personally, not only Emeris student teachers; one main role each;
// online sessions, including Tutorlage's own video room (carried live by Cloudflare, not recorded).
// Publishing it needs current_terms_version / current_privacy_version on dev set to the same value.
export const TESTER_NOTICE_VERSION = '2026-10-phase1-c';
// How long after the phase ends its data is deleted (CEO, 2026-10-03: 30 days).
const PHASE_1_RETENTION_DAYS = 30;

const DOCUMENTS = {
  terms: { title: 'Terms of Service' },
  privacy: { title: 'Privacy Policy' },
  refunds: { title: 'Refund Policy' },
} as const;

export type LegalDocument = keyof typeof DOCUMENTS;

export default function LegalPage({ document }: { document: LegalDocument }) {
  const { title } = DOCUMENTS[document];

  if (TEST_PHASE_1 && document !== 'refunds' && isBusinessInfoComplete()) {
    return <TesterNotice />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-4 py-12">
      <div className="max-w-lg w-full bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80">
        <div className="w-12 h-12 rounded-xl bg-emerald-100 text-[#15803D] flex items-center justify-center mb-4">
          <FileText className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-extrabold text-[#0F172A] tracking-tight mb-2">{title}</h1>
        <p className="text-sm text-slate-600 leading-relaxed mb-6">
          Our {title} is being finalised. It will be published on this page before Tutorlage opens to
          the public, and you'll be asked to accept it when you create an account.
        </p>
        <Link to="/" className="text-sm font-bold text-[#15803D] hover:underline">
          Back to Tutorlage
        </Link>
      </div>
    </div>
  );
}

// Text from Drake/legal/drafts/phase-1-tester-notice.md — keep the two in step.
function TesterNotice() {
  const h2 = 'text-base font-extrabold text-[#0F172A] mt-6 mb-2';
  const p = 'text-sm text-slate-600 leading-relaxed';
  const li = 'text-sm text-slate-600 leading-relaxed';
  const mail = (address: string) => (
    <a href={`mailto:${address}`} className="font-bold text-[#15803D] hover:underline">{address}</a>
  );

  return (
    <div className="min-h-screen bg-[#FAF7F2] px-4 py-12">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-slate-200/80">
        <div className="w-12 h-12 rounded-xl bg-emerald-100 text-[#15803D] flex items-center justify-center mb-4">
          <FileText className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-extrabold text-[#0F172A] tracking-tight mb-1">Test phase 1: tester notice</h1>
        <p className="text-xs text-slate-400 mb-4">Version {TESTER_NOTICE_VERSION}</p>
        <p className={p}>
          <strong>Please read this before you create an account.</strong> It's what you agree to when you
          tick "I accept" at sign-up.
        </p>

        <h2 className={h2}>What this is</h2>
        <p className={p}>
          Tutorlage is a South African tutoring platform that is still being built. Test phase 1 is a small,
          closed test with adults invited personally, mostly student teachers from The IIE's Emeris campuses.
          (The test isn't run or endorsed by The IIE.) Each tester uses this site in one main role:
          a <strong>tutor</strong>, a <strong>learner</strong> or a <strong>parent</strong>. You'll book
          sessions, accept requests, hold short real online sessions, and tell us what worked and what didn't.
        </p>
        <p className={`${p} mt-2`}>
          Tutorlage is run by <strong>{BUSINESS_INFO.legalName}</strong>, registration
          number {BUSINESS_INFO.registrationNumber}, of {BUSINESS_INFO.physicalAddress}. Questions:{' '}
          {mail(SUPPORT_EMAIL)}. Anything about safety or behaviour: {mail(SAFETY_EMAIL)}.
        </p>

        <h2 className={h2}>The rules of the test</h2>
        <ol className="list-decimal pl-5 space-y-1.5">
          <li className={li}><strong>Adults only.</strong> You must be 18 or older. The site checks your date of birth.</li>
          <li className={li}>
            <strong>No real money.</strong> Payments run in test mode. At the payment page, press Success.
            Nobody is charged and no tutor is paid, even when the screen says "paid".
          </li>
          <li className={li}>
            <strong>Never type real financial or ID details.</strong> Don't enter a real card number, bank
            account number, or ID or passport number anywhere. For tutor bank details, use the made-up numbers
            on the "how to test" sheet and choose the Passport option.
          </li>
          <li className={li}>
            <strong>Made-up learners only.</strong> If you test the parent side by adding a learner, invent the
            child: a made-up name and date of birth. Never enter a real child's details, even if you're a
            parent, and including a younger relative's.
          </li>
          <li className={li}>
            <strong>Online sessions.</strong> Sessions happen online, either through a Google Meet, Teams or Zoom
            link the tutor adds (that service's own terms apply), or in Tutorlage's own video room once it's
            switched on during the test. Tutorlage's room carries your camera, microphone and any screen you
            share live to the others in the room. We don't record it.
          </li>
          <li className={li}>
            <strong>Treat each other as you would real clients.</strong> The tutor code of conduct applies to
            sessions. Be respectful and keep sessions to the subject. If anything makes you uncomfortable, stop
            the session and email {mail(SAFETY_EMAIL)}.
          </li>
          <li className={li}><strong>Don't record sessions</strong>, and don't share another tester's details outside the test.</li>
          <li className={li}>
            <strong>Things will break.</strong> That's the point. Please report it in the app ("Report a
            problem") or by email, rather than working around it.
          </li>
        </ol>

        <h2 className={h2}>Your information</h2>
        <ul className="list-disc pl-5 space-y-1.5">
          <li className={li}>
            <strong>What we collect:</strong> your name, email, phone number, date of birth, the role you choose,
            the subjects you add, your requests and sessions, ratings, and your answers to the feedback form. If
            you book for a made-up learner, the tutor sees your name and phone number for that session. In
            Tutorlage's video room, the others see your name, and your camera, microphone and screen share are
            carried live, not stored.
          </li>
          <li className={li}>
            <strong>Why:</strong> to run the test, contact you about it, and learn how to improve Tutorlage.
            Feedback is used only inside Tutorlage. It won't be published, and anything we quote will have your
            name removed.
          </li>
          <li className={li}>
            <strong>Voluntary:</strong> taking part is voluntary. Without these details the site can't create
            your account.
          </li>
          <li className={li}>
            <strong>Who else handles it:</strong> Supabase (our database and sign-in; stored in Ireland),
            Cloudflare (runs our server, and carries Tutorlage's video room live), GitHub (hosts this website, so it sees visitors' IP addresses), Paystack
            (test-mode payments), Resend (account emails) and Google (our feedback forms, and "Sign in with
            Google" if you choose it). Some of these are based outside South Africa, mainly in the EU and the US.
            By accepting, you agree to your information being handled there for the test.
          </li>
          <li className={li}>
            <strong>On your device:</strong> the site keeps your sign-in and language choice in your browser's
            storage. It uses no advertising or tracking cookies.
          </li>
          <li className={li}>
            <strong>How long:</strong> test phase 1 data is deleted within {PHASE_1_RETENTION_DAYS} days after
            the phase ends. We keep only the feedback and usage numbers, with names removed.
          </li>
          <li className={li}>
            <strong>Your rights:</strong> you can ask to see or correct your information, object to how it's
            used, withdraw from the test and have your account deleted at any time (email {mail(SUPPORT_EMAIL)}),
            and complain to the Information Regulator (inforegulator.org.za).
          </li>
        </ul>

        <h2 className={h2}>Accepting</h2>
        <p className={p}>
          Ticking "I accept" at sign-up means you've read this notice and agree to take part on these terms.
          During test phase 1 this notice takes the place of Tutorlage's Terms of Service and Privacy Policy,
          which are still being finalised for the public launch.
        </p>

        <Link to="/" className="inline-block mt-6 text-sm font-bold text-[#15803D] hover:underline">
          Back to Tutorlage
        </Link>
      </div>
    </div>
  );
}
