import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, GraduationCap, BookOpen, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';

type Role = 'tutor' | 'student';

export default function SignIn() {
  const { role: rawRole } = useParams<{ role: string }>();
  const role: Role = rawRole === 'tutor' ? 'tutor' : 'student';
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && session) navigate('/', { replace: true });
  }, [authLoading, session, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setIsSubmitting(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    navigate('/', { replace: true });
  };

  const RoleIcon = role === 'tutor' ? GraduationCap : BookOpen;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-6">
      <div className="w-full max-w-md">
        <Link
          to="/login"
          className="inline-flex items-center space-x-1.5 text-sm font-bold text-slate-600 hover:text-[#0F172A] mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </Link>

        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80">

          <div className="flex items-center space-x-2 mb-1">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-[#15803D] flex items-center justify-center shrink-0">
              <RoleIcon className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold text-[#15803D] uppercase tracking-wider">
              Signing in as {role}
            </span>
          </div>

          <h1 className="font-serif text-3xl text-[#0F172A] mb-6">
            Welcome back
          </h1>

          {error && (
            <div className="mb-4 flex items-start space-x-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-semibold text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-slate-100 text-[#0F172A] placeholder-slate-400 text-sm font-semibold px-4 py-3.5 rounded-xl border border-transparent focus:outline-none focus:border-[#15803D] focus:bg-white focus:ring-2 focus:ring-[#15803D]/20 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-100 text-[#0F172A] placeholder-slate-400 text-sm font-semibold px-4 py-3.5 rounded-xl border border-transparent focus:outline-none focus:border-[#15803D] focus:bg-white focus:ring-2 focus:ring-[#15803D]/20 transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-md hover:shadow-lg active:scale-[0.99] flex items-center justify-center space-x-2 text-sm cursor-pointer mt-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Sign In</span>
            </button>
          </form>

          <p className="text-center text-xs text-slate-500 mt-6">
            New to Tutorlage?{' '}
            <Link to={`/signup/${role}`} className="font-bold text-[#15803D] hover:underline">
              Create a {role} account
            </Link>
          </p>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Not a {role === 'tutor' ? 'tutor' : 'student'}?{' '}
          <Link to="/login" className="font-bold text-slate-600 hover:underline">
            Choose a different role
          </Link>
        </p>
      </div>
    </div>
  );
}
