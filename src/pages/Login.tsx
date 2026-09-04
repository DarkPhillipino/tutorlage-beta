import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, BookOpen, ChevronRight } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';

/**
 * Login.tsx
 * Entry page: the person picks which role they're joining as.
 * Each choice routes to a role-aware Sign In page (see SignIn.tsx),
 * which itself links onward to CreateAccount.tsx for that same role.
 *
 * Layout/intent adapted from a reference design (role-picker cards, divider,
 * "which role are you" copy) but restyled to Tutorlage's existing light
 * brand palette instead of the reference's dark/gold theme, per the design
 * decision to keep auth pages visually consistent with the rest of the app.
 */
export default function Login() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!loading && session) navigate('/', { replace: true });
  }, [loading, session, navigate]);

  const goToSignIn = (role: 'tutor' | 'student') => {
    navigate(`/signin/${role}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="text-2xl font-extrabold tracking-tight text-[#0F172A] mb-6">
            Tutorlage
          </div>
          <p className="uppercase tracking-[0.25em] text-[#15803D] text-xs mb-3 font-bold">
            Welcome back
          </p>
          <h1 className="font-serif text-4xl text-[#0F172A] leading-tight">
            Who's picking up
            <br />
            the chalk today?
          </h1>
        </div>

        <div className="relative flex flex-col gap-5">
          <button
            type="button"
            onClick={() => goToSignIn('tutor')}
            className="group w-full rounded-2xl border border-slate-200 bg-white px-6 py-5 text-left transition-all hover:border-[#15803D] hover:bg-emerald-50/40 hover:shadow-md cursor-pointer flex items-center justify-between"
          >
            <div>
              <span className="flex items-center gap-2 font-serif text-2xl text-[#0F172A]">
                <GraduationCap className="w-6 h-6 text-[#15803D]" />
                Tutor
              </span>
              <span className="block text-sm text-slate-500 mt-1">
                I teach — take me to my sign in
              </span>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-[#15803D] transition-colors shrink-0" />
          </button>

          {/* Hand-drawn style divider between the two roles */}
          <div className="flex items-center justify-center -my-2" aria-hidden="true">
            <svg width="120" height="16" viewBox="0 0 120 16" className="opacity-50">
              <path
                d="M2 8 C 20 2, 40 14, 60 8 S 100 2, 118 8"
                fill="none"
                stroke="#15803D"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>

          <button
            type="button"
            onClick={() => goToSignIn('student')}
            className="group w-full rounded-2xl border border-slate-200 bg-white px-6 py-5 text-left transition-all hover:border-[#15803D] hover:bg-emerald-50/40 hover:shadow-md cursor-pointer flex items-center justify-between"
          >
            <div>
              <span className="flex items-center gap-2 font-serif text-2xl text-[#0F172A]">
                <BookOpen className="w-6 h-6 text-[#15803D]" />
                Student
              </span>
              <span className="block text-sm text-slate-500 mt-1">
                I'm learning — take me to my sign in
              </span>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-[#15803D] transition-colors shrink-0" />
          </button>
        </div>
      </div>
    </div>
  );
}
