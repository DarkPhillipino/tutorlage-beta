import React from 'react';
import { Globe, ShieldCheck, Heart } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-[#0A192F] text-slate-300 border-t border-slate-800 pt-12 pb-8 mt-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Top brand line */}
        <div className="flex flex-col md:flex-row md:items-center justify-between pb-8 border-b border-slate-800 gap-4">
          <div>
            <span className="text-2xl font-extrabold text-white tracking-tight">Tutorlage</span>
            <p className="text-xs text-slate-400 mt-1 max-w-md">
              Democratizing access to high-impact academic mentorship, campus tutors, exam prep, and group workshops worldwide.
            </p>
          </div>
          <div className="flex items-center space-x-6 text-xs text-slate-400 font-semibold">
            <a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">Help Center</a>
            <a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">Safety Guidelines</a>
            <a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">Campus Ambassadors</a>
            <a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">Become a Tutor</a>
          </div>
        </div>

        {/* Links Column Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 py-8 border-b border-slate-800 text-xs">
          
          <div>
            <h4 className="text-xs font-extrabold text-white uppercase tracking-wider mb-3">
              Students & Learners
            </h4>
            <ul className="space-y-2 text-slate-400">
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">1-on-1 Campus Tutoring</a></li>
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">Scheduled Weekly Sessions</a></li>
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">Homework & Lab Review</a></li>
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">Midterm & Exam Prep</a></li>
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">Group Classes & Peer Study</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-extrabold text-white uppercase tracking-wider mb-3">
              Institutions & Schools
            </h4>
            <ul className="space-y-2 text-slate-400">
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">The IIE's Emeris Waterfall</a></li>
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">The IIE Varsity College Sandton</a></li>
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">Wits University Campus Hub</a></li>
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">University of Cape Town (UCT)</a></li>
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">Enterprise Campus Solutions</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-extrabold text-white uppercase tracking-wider mb-3">
              Educators & Tutors
            </h4>
            <ul className="space-y-2 text-slate-400">
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">Apply to Teach</a></li>
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">Educator Certification</a></li>
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">Tutor Rates & Payouts</a></li>
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">Teaching Resources & Whiteboard</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-extrabold text-white uppercase tracking-wider mb-3">
              Tutorlage Platform
            </h4>
            <ul className="space-y-2 text-slate-400">
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">About Tutorlage</a></li>
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">Press & Media</a></li>
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">Careers & Internship</a></li>
              <li><a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white transition-colors">Terms & Academic Integrity</a></li>
            </ul>
          </div>

        </div>

        {/* Bottom copyright line */}
        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-3">
          <div className="flex items-center space-x-2">
            <span>© {new Date().getFullYear()} Tutorlage Inc. All rights reserved.</span>
          </div>

          <div className="flex items-center space-x-4">
            <span className="flex items-center text-slate-400 font-semibold">
              <Globe className="w-3.5 h-3.5 mr-1" />
              English (South Africa)
            </span>
            <span className="text-slate-600">•</span>
            <a href="#" onClick={(e) => e.preventDefault()} className="hover:text-slate-300">Privacy Policy</a>
            <a href="#" onClick={(e) => e.preventDefault()} className="hover:text-slate-300">Cookies</a>
          </div>
        </div>

      </div>
    </footer>
  );
};
