import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, GraduationCap, BookOpen, AlertCircle, MailCheck } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';

type Role = 'tutor' | 'student';

const inputClass = 'w-full bg-slate-100 text-[#0F172A] placeholder-slate-400 text-sm font-semibold px-4 py-3.5 rounded-xl border border-transparent focus:outline-none focus:border-[#15803D] focus:bg-white focus:ring-2 focus:ring-[#15803D]/20 transition-all';
const labelClass = 'block text-xs font-bold text-slate-500 mb-1.5';

export default function CreateAccount() {
  const { role: rawRole } = useParams<{ role: string }>();
  const role: Role = rawRole === 'tutor' ? 'tutor' : 'student';
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);

  useEffect(() => {
    if (!authLoading && session) navigate('/', { replace: true });
  }, [authLoading, session, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setIsSubmitting(true);

    // The on_auth_user_created DB trigger reads this metadata and creates
    // the matching profiles + tutor_profiles/student_profiles rows
    // automatically — no separate insert needed on our end.
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          surname,
          phone_number: phoneNumber,
          role,
        },
      },
    });

    setIsSubmitting(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    if (data.session) {
      navigate('/', { replace: true });
    } else {
      // Email confirmation is required before a session is issued.
      setNeedsEmailConfirmation(true);
    }
  };

  const RoleIcon = role === 'tutor' ? GraduationCap : BookOpen;

  if (needsEmailConfirmation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-6">
        <div className="w-full max-w-md bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80 text-center">
          <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center text-[#15803D] mx-auto mb-4">
            <MailCheck className="w-7 h-7" />
          </div>
          <h1 className="font-serif text-2xl text-[#0F172A] mb-2">Check your email</h1>
          <p className="text-sm text-slate-500 mb-6">
            We've sent a confirmation link to <span className="font-semibold text-[#0F172A]">{email}</span>. Confirm your account, then sign in below.
          </p>
          <Link
            to={`/signin/${role}`}
            className="inline-block w-full bg-[#15803D] hover:bg-[#166534] text-white font-bold py-3 px-6 rounded-xl transition-all text-sm"
          >
            Go to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-6 py-12">
      <div className="w-full max-w-md">
        <Link
          to={`/signin/${role}`}
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
              Creating a {role} account
            </span>
          </div>

          <h1 className="font-serif text-3xl text-[#0F172A] mb-6">
            Join Tutorlage
          </h1>

          {error && (
            <div className="mb-4 flex items-start space-x-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-semibold text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="firstName">First name</label>
                <input id="firstName" type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Thandiwe" className={inputClass} />
              </div>
              <div>
                <label className={labelClass} htmlFor="surname">Surname</label>
                <input id="surname" type="text" required value={surname} onChange={(e) => setSurname(e.target.value)} placeholder="Nkosi" className={inputClass} />
              </div>
            </div>

            <div>
              <label className={labelClass} htmlFor="email">Email</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={inputClass} />
            </div>

            <div>
              <label className={labelClass} htmlFor="phoneNumber">Phone number</label>
              <input id="phoneNumber" type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="081 234 5678" className={inputClass} />
            </div>

            <div>
              <label className={labelClass} htmlFor="password">Password</label>
              <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" className={inputClass} />
            </div>

            <div>
              <label className={labelClass} htmlFor="confirmPassword">Confirm password</label>
              <input id="confirmPassword" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" className={inputClass} />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-md hover:shadow-lg active:scale-[0.99] flex items-center justify-center space-x-2 text-sm cursor-pointer mt-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Create {role === 'tutor' ? 'Tutor' : 'Student'} Account</span>
            </button>
          </form>

          {role === 'tutor' && (
            <p className="text-[11px] text-slate-400 mt-4 text-center leading-relaxed">
              Your subjects, rate tier, and availability are set up next, from your Teaching dashboard.
            </p>
          )}

          <p className="text-center text-xs text-slate-500 mt-6">
            Already have an account?{' '}
            <Link to={`/signin/${role}`} className="font-bold text-[#15803D] hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
