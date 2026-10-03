import React from 'react';
import { Link } from 'react-router-dom';
import { BUSINESS_INFO, isBusinessInfoComplete } from '../lib/businessInfo';

// Every link here goes somewhere real. The previous footer advertised pages and
// features that didn't exist (group classes, a whiteboard, campus ambassadors,
// educator certification, careers, press) and a campus list implying a
// presence Tutorlage doesn't have — all removed (backlog item 3; copy from
// Drake/marketing-gtm/site-copy-v1.md).
export const Footer: React.FC = () => {
  const showBusinessInfo = isBusinessInfoComplete();

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
            <div>
              <h4 className="text-xs font-extrabold text-white uppercase tracking-wider mb-3">Tutors</h4>
              <ul className="space-y-2 text-slate-400">
                <li><Link to="/signup/tutor" className="hover:text-white transition-colors">Become a tutor</Link></li>
              </ul>
            </div>
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
          <span>© {new Date().getFullYear()} Tutorlage</span>
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
