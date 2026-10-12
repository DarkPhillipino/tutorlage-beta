import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { BUSINESS_INFO, isBusinessInfoComplete } from '../lib/businessInfo';
import { useAuth } from '../lib/AuthContext';
import { siteUrl } from '../lib/siteUrl';

// Every link here goes somewhere real. The previous footer advertised pages and
// features that didn't exist (group classes, a whiteboard, campus ambassadors,
// educator certification, careers, press) and a campus list implying a
// presence Tutorlage doesn't have — all removed (backlog item 3; copy from
// Drake/marketing-gtm/site-copy-v1.md).
export const Footer: React.FC = () => {
  const showBusinessInfo = isBusinessInfoComplete();
  const { profile, signOut } = useAuth();
  const [askingAboutTutorAccount, setAskingAboutTutorAccount] = useState(false);

  // Master 7cr (12 Oct, from a tester's call to the CEO): "Become a tutor" always linked to the tutor sign-up
  // page, and that page sends anyone who is signed in straight back to the Learn page, so for every tester it
  // looked like a dead button. An account has one role, so a signed-in learner or parent can't become a tutor
  // on the account they have: say so, and offer the way (sign out, then sign up as a tutor). A tutor already is
  // one, so nothing is shown. Signed out, it is the plain link it always was.
  const role = profile?.role;
  const showTutorsColumn = role !== 'tutor';

  const handleSignOutForTutorAccount = async () => {
    await signOut();
    // A full load on the sign-up page, after the sign-out, so no signed-in screen can send the visitor elsewhere.
    window.location.assign(siteUrl('/signup/tutor'));
  };

  return (
    <footer className="bg-[#0A192F] text-slate-300 border-t border-slate-800 pt-12 pb-8 mt-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        <div className="flex flex-col md:flex-row md:items-start justify-between pb-8 border-b border-slate-800 gap-8">
          <div>
            <span className="text-2xl font-extrabold text-white tracking-tight">Tutorlage</span>
            <p className="text-xs text-slate-400 mt-1 max-w-md">Tutoring from people who know the work.</p>
          </div>

          <div className="grid grid-cols-2 gap-8 text-xs">
            <div>
              <h4 className="text-xs font-extrabold text-white uppercase tracking-wider mb-3">Learners</h4>
              <ul className="space-y-2 text-slate-400">
                <li><Link to="/" className="hover:text-white transition-colors">Book a session</Link></li>
              </ul>
            </div>
            {showTutorsColumn && (
              <div>
                <h4 className="text-xs font-extrabold text-white uppercase tracking-wider mb-3">Tutors</h4>
                <ul className="space-y-2 text-slate-400">
                  {role ? (
                    <li>
                      <button
                        type="button"
                        onClick={() => setAskingAboutTutorAccount((open) => !open)}
                        aria-expanded={askingAboutTutorAccount}
                        className="hover:text-white transition-colors cursor-pointer text-left"
                      >
                        Become a tutor
                      </button>
                      {askingAboutTutorAccount && (
                        <div className="mt-2 max-w-[16rem] space-y-2 text-slate-300">
                          <p>
                            A tutor account is separate from the one you're signed in with. Sign out, then sign up as a
                            tutor with a different email address.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={handleSignOutForTutorAccount}
                              className="px-3 py-1.5 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white font-bold cursor-pointer"
                            >
                              Sign out and sign up as a tutor
                            </button>
                            <button
                              type="button"
                              onClick={() => setAskingAboutTutorAccount(false)}
                              className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-bold cursor-pointer"
                            >
                              Not now
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ) : (
                    <li><Link to="/signup/tutor" className="hover:text-white transition-colors">Become a tutor</Link></li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* ECTA s43 supplier details — only shown once every field is real. */}
        {showBusinessInfo && (
          <div className="py-6 border-b border-slate-800 text-xs text-slate-400 space-y-1">
            <h4 className="text-xs font-extrabold text-white uppercase tracking-wider mb-2">About this business</h4>
            <p>{BUSINESS_INFO.legalName} · Registration number {BUSINESS_INFO.registrationNumber}</p>
            <p>{BUSINESS_INFO.physicalAddress}</p>
            <p>
              <a href={`mailto:${BUSINESS_INFO.email}`} className="hover:text-white">{BUSINESS_INFO.email}</a>
              {' · '}
              {BUSINESS_INFO.phone}
            </p>
          </div>
        )}

        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-3">
          <span>© {new Date().getFullYear()} {showBusinessInfo ? BUSINESS_INFO.legalName : 'Tutorlage'}</span>
          <div className="flex items-center space-x-4">
            <Link to="/terms" className="hover:text-slate-300">Terms of Service</Link>
            <Link to="/privacy" className="hover:text-slate-300">Privacy Policy</Link>
            <Link to="/refunds" className="hover:text-slate-300">Refund Policy</Link>
          </div>
        </div>

      </div>
    </footer>
  );
};
