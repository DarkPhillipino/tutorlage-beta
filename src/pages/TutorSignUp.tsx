import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Loader2, MailCheck } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { fetchCurrentPolicyVersions, type PolicyVersions } from '../lib/queries';
import { ADULT_AGE, COPY, ageFromIsoDate, isPlausibleDateOfBirth } from '../lib/accountRules';
import { FEATURES } from '../lib/features';
import { signupConfirmationRedirect } from '../lib/authRedirects';
import { MIN_PASSWORD_LENGTH, describeSignUpFault, noteSendStarted, signupResendKey, validateNewPassword } from '../lib/authHelpers';
import { logClientError } from '../lib/errorLog';
import { ResendConfirmation } from '../lib/ResendConfirmation';
import { forgetPromoCode, promoCheckMessage, promoSignupMetadata, rememberPromoCode } from '../lib/promoCode';
import { usePromoCodeCheck } from '../lib/promoHooks';
import { BOOKING_META_KEY, forgetGoogleBooking } from '../lib/bookingPath';
import { bookPath, pagePath, type PublicPageClient } from '../lib/publicTutorPage';
import { useNoIndex, usePublicTutor } from '../lib/publicTutorHooks';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { PasswordInput } from '../components/PasswordInput';
import { LinkRolePicker, type BookingRole } from '../components/LinkRolePicker';
import { LINK_BUTTON, LINK_CARD, LINK_INPUT, LINK_LABEL, LinkShell, TutorHero } from '../components/LinkShell';
import { TutorPageMissing } from '../components/TutorPageMissing';
import { PageLoading } from '../components/PageLoading';

// SIGNING UP ON A TUTOR'S BOOKING PATH, /t/CODE/signup (PM line 79 C, 25 Nov 2026). The same safeguards as /signup/:role (real date of birth, parents and guardians 18 or older, a learner under 18
// cannot finish alone, the Terms never pre-ticked, the accepted versions recorded), with the choice "Parent or guardian" or "Learner" as part of the form, no tutor anywhere, and the tutor's own code.
// The account remembers which tutor it was made to book (user_metadata), so the confirmation e-mail, opened on any phone, ends on that tutor's booking page.
export default function TutorSignUp() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation();
  const { session, loading: authLoading } = useAuth();
  const page = usePublicTutor(supabase as unknown as PublicPageClient, code);
  useNoIndex();

  const handed = (state as { role?: unknown } | null)?.role;
  const [role, setRole] = useState<BookingRole | null>(handed === 'parent' || handed === 'student' ? handed : null);
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [versions, setVersions] = useState<PolicyVersions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);

  const tutorCode = page?.code ?? '';
  const promoMessage = promoCheckMessage(usePromoCodeCheck(tutorCode));

  // A Google sign-up has no form to carry the code, so it is remembered the same way a code link remembers it.
  useEffect(() => {
    if (tutorCode && !session) rememberPromoCode(tutorCode);
  }, [tutorCode, session]);

  useEffect(() => {
    fetchCurrentPolicyVersions().then(setVersions).catch((e) => console.error('fetchCurrentPolicyVersions failed:', e));
  }, []);

  if (authLoading || page === undefined) return <PageLoading />;
  if (page === null) return <TutorPageMissing />;
  // Signed in already (or just signed up): straight to the booking page.
  if (session) return <Navigate to={bookPath(page.code)} replace />;

  const age = isPlausibleDateOfBirth(dateOfBirth) ? ageFromIsoDate(dateOfBirth) : null;
  const isUnder18Learner = role === 'student' && age !== null && age < ADULT_AGE;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!role) {
      setError('Choose Parent or guardian, or Learner.');
      return;
    }
    if (age === null) {
      setError('Enter your real date of birth.');
      return;
    }
    if (isUnder18Learner) return;
    if (age < ADULT_AGE && role === 'parent') {
      setError(COPY.parentUnder18);
      return;
    }
    const passwordProblem = validateNewPassword(password, confirmPassword);
    if (passwordProblem) {
      setError(passwordProblem);
      return;
    }
    if (!accepted) {
      setError('Please accept the Terms of Service and the Privacy Policy to create an account.');
      return;
    }
    setBusy(true);
    forgetGoogleBooking();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: signupConfirmationRedirect(),
        data: {
          first_name: firstName,
          surname,
          phone_number: phoneNumber,
          role,
          date_of_birth: dateOfBirth,
          ...promoSignupMetadata(page.code),
          [BOOKING_META_KEY]: page.code,
          ...(versions && { accepted_terms_version: versions.termsVersion, accepted_privacy_version: versions.privacyVersion }),
        },
      },
    });
    setBusy(false);
    if (signUpError) {
      const fault = describeSignUpFault(signUpError);
      if (fault?.log) logClientError(signUpError, 'logged');
      setError(
        /database error/i.test(signUpError.message)
          ? 'We could not create this account. Check your date of birth — tutors and parents must be 18 or older.'
          : fault?.text ?? signUpError.message,
      );
      return;
    }
    forgetPromoCode();
    if (data.session) {
      navigate(bookPath(page.code), { replace: true });
    } else {
      noteSendStarted(signupResendKey(email), Date.now());
      setNeedsEmailConfirmation(true);
    }
  };

  const hero = <TutorHero name={page.firstName} photo={page.photo} title={`Book with ${page.firstName}`} subtitle="Create your account to choose your lesson" />;

  if (needsEmailConfirmation) {
    return (
      <LinkShell homeTo={pagePath(page.code)} hero={hero}>
        <section className={`${LINK_CARD} text-center`} data-link-check-email>
          <MailCheck className="w-8 h-8 text-[#15803D] mx-auto mb-3" aria-hidden="true" />
          <h2 className="font-serif text-2xl mb-2">Check your email</h2>
          <p className="text-sm text-slate-600 mb-4">
            We've sent a confirmation link to <span className="font-semibold text-[#0F172A] break-all">{email}</span>. Open it, on this phone or another one, and you come to the page where you book {page.firstName}.
          </p>
          <ResendConfirmation key={email.trim()} email={email} className="mb-4" />
          <p className="text-xs text-slate-600 mb-5">
            Already have an account with this address?{' '}
            <Link to={`/forgot-password/${role ?? 'parent'}`} state={{ email }} className="font-bold text-[#15803D] hover:underline">Reset your password</Link>, or sign in.
          </p>
          <Link to={bookPath(page.code)} className={LINK_BUTTON}>Go to Sign In</Link>
        </section>
      </LinkShell>
    );
  }

  return (
    <LinkShell homeTo={pagePath(page.code)} hero={hero}>
      <section className={LINK_CARD} data-link-signup-card>
        <Link to={bookPath(page.code)} className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-600 hover:text-[#0F172A] py-2 -mt-1 mb-2">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Back</span>
        </Link>
        <h2 className="font-serif text-3xl mb-4">Create account</h2>

        {error && (
          <div role="alert" className="mb-4 flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-semibold text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-3">
          <div>
            <span className={LINK_LABEL}>I am a</span>
            <LinkRolePicker value={role} onChange={(r) => { setRole(r); setError(null); }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LINK_LABEL} htmlFor="firstName">First name</label>
              <input id="firstName" type="text" required autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Thandiwe" className={LINK_INPUT} />
            </div>
            <div>
              <label className={LINK_LABEL} htmlFor="surname">Surname</label>
              <input id="surname" type="text" required autoComplete="family-name" value={surname} onChange={(e) => setSurname(e.target.value)} placeholder="Nkosi" className={LINK_INPUT} />
            </div>
          </div>
          <div>
            <label className={LINK_LABEL} htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={LINK_INPUT} />
          </div>
          <div>
            <label className={LINK_LABEL} htmlFor="phoneNumber">Phone number</label>
            <input id="phoneNumber" type="tel" autoComplete="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="081 234 5678" className={LINK_INPUT} />
          </div>
          <div>
            <label className={LINK_LABEL} htmlFor="dateOfBirth">Date of birth</label>
            <input id="dateOfBirth" type="date" required value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={LINK_INPUT} />
            <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">{COPY.dateOfBirthWhy}</p>
          </div>

          {isUnder18Learner ? (
            <div className="bg-[#FAF7F2] border border-slate-200 rounded-xl px-4 py-4" data-under18>
              <p className="text-sm font-bold mb-1">{COPY.learnerUnder18Title}</p>
              <p className="text-xs text-slate-600 leading-relaxed mb-3">{COPY.learnerUnder18Body}</p>
              <button type="button" onClick={() => { setRole('parent'); setDateOfBirth(''); }} className="text-xs font-bold text-[#15803D] hover:underline cursor-pointer py-1">
                Create a parent or guardian account →
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className={LINK_LABEL} htmlFor="password">Password</label>
                <PasswordInput id="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} className={LINK_INPUT} />
              </div>
              <div>
                <label className={LINK_LABEL} htmlFor="confirmPassword">Confirm password</label>
                <PasswordInput id="confirmPassword" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" className={LINK_INPUT} />
              </div>
              {promoMessage?.tone === 'good' && (
                <p role="status" data-promo-message="good" className="text-xs font-semibold text-[#15803D]">Code {page.code}. {promoMessage.text}</p>
              )}
              {/* Legal spec §1: never pre-ticked; the account can't be created without it. */}
              <label className="flex items-start gap-2.5 text-sm text-slate-600 cursor-pointer pt-1">
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#15803D] shrink-0" />
                <span>
                  {COPY.acceptTermsLead}{' '}
                  <Link to="/terms" target="_blank" className="font-bold text-[#15803D] hover:underline">Terms of Service</Link>
                  {' '}and the{' '}
                  <Link to="/privacy" target="_blank" className="font-bold text-[#15803D] hover:underline">Privacy Policy</Link>.
                </span>
              </label>
              <p className="text-[11px] text-slate-600 leading-relaxed">{COPY.termsSummary}</p>
              <button type="submit" disabled={busy} className={`${LINK_BUTTON} flex items-center justify-center gap-2`}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                <span>Create account</span>
              </button>
            </>
          )}
        </form>

        {FEATURES.googleSignIn && (
          <>
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>
            <GoogleSignInButton role={role ?? 'student'} bookingCode={page.code} disabled={role === null} label="Sign up with Google" onError={setError} />
            <p className="text-[11px] text-slate-600 mt-2 text-center">
              {role === null ? 'To use Google, first choose Parent or guardian, or Learner.' : "With Google, we'll ask for your date of birth and your acceptance of our terms right after."}
            </p>
          </>
        )}

        <p className="text-center text-sm text-slate-600 mt-5">
          Already have an account?{' '}
          <Link to={bookPath(page.code)} className="font-bold text-[#15803D] hover:underline">Sign in</Link>
        </p>
        <p className="text-center text-xs mt-3">
          <Link to="/privacy" target="_blank" className="font-bold text-[#15803D] hover:underline">Privacy Policy</Link>
        </p>
      </section>
    </LinkShell>
  );
}
