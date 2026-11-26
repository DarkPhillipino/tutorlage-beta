import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { confirmPageBooking, createSessionRequest, fetchGradeLevelSuggestions, fetchStudentGradeLevel } from '../lib/queries';
import { CONFIRM_COPY, lessonTimes, longDate, parseBooked, wasRefused, type BookedResult } from '../lib/pageConfirm';
import { BookedPanel, ConfirmBooking, type LessonFacts } from './ConfirmBooking';
import { initializePayment } from '../lib/payments';
import { FREE_FOR_NOW_DETAIL, FREE_FOR_NOW_NOTICE } from '../lib/freeSessions';
import { sendMyRequestFree, useFreeSessionsOpen } from '../lib/freeSessionsHooks';
import { sendMyRequestWallet, useCardAllowed, useWalletBalance, useWalletOpenAnswer } from '../lib/walletHooks';
import { CARD_CLOSED_COPY } from '../lib/cardCheckout';
import { WalletRefusal, rand0, shortfall, walletPrice } from '../lib/wallet';
import { promoQuoteLine } from '../lib/promoCode';
import { usePromoQuote } from '../lib/promoHooks';
import { useBankMainWay } from '../lib/walletOnlineHooks';
import { ONLINE_COPY } from '../lib/walletOnline';
import { siteUrl } from '../lib/siteUrl';
import { getErrorMessage } from '../lib/errors';
import { COPY } from '../lib/accountRules';
import { PAYMENTS_NOT_OPEN, PAYMENTS_NOT_OPEN_NOTICE } from '../lib/features';
import { SESSION_LENGTHS, DEFAULT_SESSION_HOURS, describeLength } from '../lib/requestSchedule';
import { describeDate } from '../lib/format';
import { pendingBookingCode, noteBookingLanded, BOOKING_META_KEY } from '../lib/bookingPath';
import { pagePath, type PublicPageClient, type PublicTutorPage } from '../lib/publicTutorPage';
import {
  BOOKING_COPY as WORDS, bookingRefusalWords, fetchBookingPage, fetchTutorTimes, gradesFor, subjectNames, type BookingPage, type TutorTimes,
} from '../lib/tutorBooking';
import type { LinkedLearner } from '../lib/guardian';
import { useAccountStatus } from './AccountGate';
import { LearnersPanel } from './LearnersPanel';
import { AddMoneyModal } from './AddMoneyModal';
import { WalletPayBox } from './WalletPayBox';
import { BankMainCheckout } from './BankMainCheckout';
import { TutorPageMissing } from './TutorPageMissing';
import { PageLoading } from './PageLoading';
import { LINK_BUTTON, LINK_CARD, LINK_HEADING, LINK_INPUT, LINK_LABEL, LinkShell, TutorHero } from './LinkShell';

const client = supabase as unknown as PublicPageClient;
const headerLink = 'text-sm font-bold text-slate-200 hover:text-white py-2 cursor-pointer';
const tab = (on: boolean) =>
  `px-3.5 py-2.5 rounded-xl border text-sm font-bold cursor-pointer ${on ? 'bg-[#0F172A] border-[#0F172A] text-white' : 'bg-white border-slate-300 text-[#0F172A] hover:border-[#0F172A]'}`;

// ONE TUTOR'S BOOKING PAGE (PM line 79 D, 25 Nov 2026). Only this tutor: the subjects and grades approved for the tutor, the tutor's price (one card), times inside the tutor's working hours that are
// not already taken, and a request that is addressed to the tutor and goes to nobody else. No other price level, no count of tutors, no way to send it to someone else. The payment part uses the same
// pieces, the same database calls and the same rules as the general request page (PricesPage.tsx); the database checks every request again.
export function TutorBookingPage({ code, shown }: { code: string; shown: PublicTutorPage }) {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const { isViewOnlyLearner } = useAccountStatus();
  const role = profile?.role;
  const isGuardian = role === 'parent';
  const canUse = role === 'parent' || role === 'student';

  // The person has arrived: the account forgets which tutor it was made to book, so the home page is the home page from now on.
  useEffect(() => {
    const pending = pendingBookingCode(user);
    if (!pending) return;
    noteBookingLanded(pending);
    void supabase.auth.updateUser({ data: { [BOOKING_META_KEY]: null } }).catch(() => undefined);
    // Once per account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const [page, setPage] = useState<BookingPage | null | undefined>(undefined);
  const [pageError, setPageError] = useState(false);
  const loadPage = useCallback(() => {
    setPageError(false);
    fetchBookingPage(client, code).then(setPage).catch((e) => {
      console.error('tutor_booking_page failed:', e);
      setPageError(true);
    });
  }, [code]);
  useEffect(() => {
    if (canUse) loadPage();
  }, [canUse, loadPage]);

  const [allGrades, setAllGrades] = useState<string[]>([]);
  useEffect(() => {
    fetchGradeLevelSuggestions().then(setAllGrades).catch((e) => console.error('fetchGradeLevelSuggestions failed:', e));
  }, []);

  // Who the lesson is for: the signed-in learner, or the learner a parent or guardian chooses (adding one here if there is none).
  const [bookingFor, setBookingFor] = useState<LinkedLearner | null>(null);
  const [ownGrade, setOwnGrade] = useState('');
  useEffect(() => {
    if (!user || role !== 'student') return;
    fetchStudentGradeLevel(user.id).then((g) => setOwnGrade(g ?? '')).catch((e) => console.error('fetchStudentGradeLevel failed:', e));
  }, [user?.id, role]);
  const learnerGrade = isGuardian ? (bookingFor?.gradeLevel ?? '') : ownGrade;

  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState('');
  const subjects = page ? subjectNames(page.subjects) : [];
  const grades = page && subject ? gradesFor(page.subjects, subject, allGrades) : [];
  useEffect(() => {
    if (!subject && subjects.length === 1) setSubject(subjects[0]);
  }, [subject, subjects]);
  // The grade follows the learner when the tutor covers it; otherwise it is asked.
  const gradeKey = `${subject}|${learnerGrade}|${grades.join(',')}`;
  useEffect(() => {
    setGrade((g) => (grades.includes(learnerGrade) ? learnerGrade : grades.includes(g) ? g : grades.length === 1 ? grades[0] : ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeKey]);

  const [hours, setHours] = useState<number>(DEFAULT_SESSION_HOURS);
  const [asap, setAsap] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [times, setTimes] = useState<{ status: 'loading' } | { status: 'failed' } | { status: 'ok'; value: TutorTimes }>({ status: 'loading' });
  const [timesTick, setTimesTick] = useState(0);
  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    setTimes({ status: 'loading' });
    fetchTutorTimes(client, code, hours)
      .then((value) => !cancelled && setTimes({ status: 'ok', value }))
      .catch((e) => {
        console.error('tutor_page_times failed:', e);
        if (!cancelled) setTimes({ status: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [page, code, hours, timesTick]);
  const value = times.status === 'ok' ? times.value : null;
  const nowOk = value?.nowOk ?? false;
  const day = value?.days.find((d) => d.date === date) ?? null;
  // Keep the choice inside what is open: never a day or a time the tutor cannot be asked for.
  useEffect(() => {
    if (!value) return;
    if (asap && !value.nowOk) setAsap(false);
    const chosen = value.days.find((d) => d.date === date) ?? null;
    if (date && !chosen) {
      setDate('');
      setTime('');
    } else if (chosen && time && !chosen.times.includes(time)) setTime('');
  }, [value, asap, date, time]);

  const price = page ? walletPrice(page.price * hours) : 0;
  const freeOpen = useFreeSessionsOpen();
  const walletOpenAnswer = useWalletOpenAnswer();
  const walletAvailable = walletOpenAnswer === true && !freeOpen && page?.currency === 'ZAR';
  const bank = useBankMainWay(walletAvailable);
  const bankMain = walletAvailable && bank.bankIsMain;
  const cardAnswer = useCardAllowed(!freeOpen);
  const cardAllowed = !freeOpen && cardAnswer === 'yes';
  const wallet = useWalletBalance(user?.id, walletAvailable);
  const promo = usePromoQuote(walletAvailable, price);
  const payPrice = promo ? promo.payRand : price;
  const walletEnough = walletAvailable && wallet.state.status === 'ready' && payPrice > 0 && wallet.state.available >= payPrice;
  const [addMoneyOpen, setAddMoneyOpen] = useState(false);

  const [isSending, setIsSending] = useState(false);
  const sendingRef = useRef(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sendError) errorRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [sendError]);
  // A refusal belongs to what was asked for.
  useEffect(() => setSendError(null), [subject, grade, hours, asap, date, time, bookingFor?.id]);

  const learnerReady = !isViewOnlyLearner && (!isGuardian || !!bookingFor);
  const lessonReady = !!subject && !!grade && (asap ? nowOk : !!date && !!time && !!day?.times.includes(time));
  const ready = learnerReady && lessonReady;

  const send = async (way: 'wallet' | 'free' | 'card') => {
    if (!page || !user?.email || !ready || sendingRef.current) return;
    if (way === 'wallet' && !walletEnough) return;
    if (way === 'card' && (!cardAllowed || PAYMENTS_NOT_OPEN)) return;
    sendingRef.current = true;
    setIsSending(true);
    setSendError(null);
    try {
      const reference = crypto.randomUUID();
      const created = await createSessionRequest({
        studentId: isGuardian ? bookingFor!.id : user.id,
        requestedById: user.id,
        subjectName: subject,
        gradeLevel: grade,
        minSubTierId: page.levelId,
        // No school and no curriculum: nothing here may hide the request from the tutor it is addressed to.
        institutionId: null,
        curriculumId: null,
        scheduleType: asap ? 'now' : 'scheduled',
        scheduledDate: date,
        scheduledTime: time,
        durationHours: hours,
        paystackReference: reference,
        requestedTutorId: page.tutorId,
        viaTutorPage: true,
      });
      if (way === 'card') {
        window.location.href = (await initializePayment(reference)).authorizationUrl;
        return;
      }
      if (way === 'free') await sendMyRequestFree(created.id);
      else await sendMyRequestWallet(created.id);
      window.location.href = siteUrl(`/payment/callback?${way}=1&request=${created.id}&tutor=${encodeURIComponent(page.code)}`);
    } catch (e) {
      setSendError(bookingRefusalWords(getErrorMessage(e, 'Could not send your request.'), page.firstName));
      if (e instanceof WalletRefusal) wallet.reload();
      // The time may have gone: read the open times again.
      setTimesTick((t) => t + 1);
      sendingRef.current = false;
      setIsSending(false);
    }
  };

  // BOOKED ON CONFIRM (PM line 81 C): where the database says so for this tutor, nothing is sent from this form. "Continue" shows the confirm step, and only
  // "Confirm booking" books and charges, in one database step. The reference stays the same for one confirm step, so a repeat can never book twice.
  const confirmMode = !!page?.booksOnConfirm && walletAvailable;
  const [step, setStep] = useState<{ reference: string; lesson: LessonFacts; price: number; promoLine: string | null; left: number } | null>(null);
  const [stepError, setStepError] = useState<{ text: string; nothing: boolean } | null>(null);
  const [booked, setBooked] = useState<{ lesson: LessonFacts; result: BookedResult } | null>(null);
  useEffect(() => {
    if (step || booked) window.scrollTo(0, 0);
  }, [step, booked]);

  const review = () => {
    if (!page || !ready || !walletEnough || wallet.state.status !== 'ready') return;
    setStepError(null);
    setStep({
      reference: crypto.randomUUID(),
      lesson: {
        tutor: page.firstName,
        learner: isGuardian ? `${bookingFor!.firstName} ${bookingFor!.surname}`.trim() : (profile?.fullName ?? 'You'),
        subject,
        grade,
        date: longDate(date),
        times: lessonTimes(time, hours),
      },
      price: payPrice,
      promoLine: promo ? promoQuoteLine(promo) : null,
      left: wallet.state.available - payPrice,
    });
  };

  const confirm = async () => {
    if (!page || !user || !step || sendingRef.current) return;
    sendingRef.current = true;
    setIsSending(true);
    setStepError(null);
    try {
      const result = parseBooked(await confirmPageBooking({
        studentId: isGuardian ? bookingFor!.id : user.id,
        subjectName: subject,
        gradeLevel: grade,
        tutorId: page.tutorId,
        levelId: page.levelId,
        date,
        time,
        durationHours: hours,
        reference: step.reference,
        expectedRand: step.price,
      }));
      if (!result) throw new Error('no answer');
      setBooked({ lesson: step.lesson, result });
      setStep(null);
      wallet.reload();
    } catch (e) {
      const refused = wasRefused(e);
      console.error('confirm_page_booking failed:', e);
      setStepError(refused ? { text: bookingRefusalWords(getErrorMessage(e, 'The booking could not be made.'), page.firstName), nothing: true } : { text: CONFIRM_COPY.unknown, nothing: false });
      if (refused) {
        wallet.reload();
        setTimesTick((t) => t + 1);
      }
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  };

  const another = () => {
    setBooked(null);
    setDate('');
    setTime('');
    setTimesTick((t) => t + 1);
  };

  const doSignOut = async () => {
    await signOut();
  };

  const frame = (children: React.ReactNode, compact = false) => (
    <LinkShell
      homeTo={pagePath(code)}
      headerRight={
        <nav className="flex items-center gap-4" aria-label="Your account">
          {canUse && <Link to="/?view=sessions" className={headerLink}>My sessions</Link>}
          <button type="button" onClick={() => void doSignOut()} className={headerLink}>Sign out</button>
        </nav>
      }
      // The confirm step and "Booked" keep a slim band, so the details and the button fit the first screen.
      hero={compact ? <p className="text-lg font-extrabold">{WORDS.title(shown.firstName)}</p> : <TutorHero name={shown.firstName} photo={shown.photo} title={WORDS.title(shown.firstName)} subtitle="Tutor on Tutorlage" />}
    >
      {children}
    </LinkShell>
  );

  if (!profile) return <PageLoading />;
  if (!canUse) {
    return frame(
      <section className={`${LINK_CARD} space-y-3`} data-tutor-account>
        <h2 className="text-base font-extrabold">{WORDS.tutorAccount}</h2>
        <p className="text-sm text-slate-600">{role === 'tutor' ? WORDS.tutorAccountMore(shown.firstName) : WORDS.otherAccount}</p>
        <button type="button" onClick={() => void doSignOut()} className={LINK_BUTTON}>Sign out</button>
        <button type="button" onClick={() => navigate('/')} className="block w-full text-sm font-bold text-slate-600 hover:underline py-2 cursor-pointer">Go to my Tutorlage</button>
      </section>,
    );
  }
  if (pageError) {
    return frame(
      <section className={`${LINK_CARD} text-center`} role="alert">
        <p className="text-sm font-bold mb-1">We could not load this page</p>
        <p className="text-xs text-slate-600 mb-3">Check your connection and try again.</p>
        <button type="button" onClick={loadPage} className={LINK_BUTTON}>Try again</button>
      </section>,
    );
  }
  if (page === undefined) return <PageLoading />;
  if (page === null) return <TutorPageMissing />;
  const name = page.firstName;

  const cardPart = cardAllowed ? (
    <>
      <p data-test-mode className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">Test mode: use a Paystack test card. No real money is taken.</p>
      {PAYMENTS_NOT_OPEN && <p role="status" data-payments-not-open className="text-xs font-bold text-amber-800 mb-3">{PAYMENTS_NOT_OPEN_NOTICE}</p>}
      <button type="button" onClick={() => void send('card')} disabled={isSending || !ready || PAYMENTS_NOT_OPEN} className={LINK_BUTTON}>
        {isSending ? 'Redirecting to secure checkout…' : `Save card & send request to ${name}`}
      </button>
    </>
  ) : null;

  if (booked) return frame(<BookedPanel lesson={booked.lesson} paid={booked.result.paidRand} creditNow={booked.result.availableRand} onAnother={another} />, true);
  if (step) {
    return frame(
      <ConfirmBooking lesson={step.lesson} price={step.price} promoLine={step.promoLine} creditLeft={step.left} busy={isSending} error={stepError} onConfirm={() => void confirm()} onChange={() => { setStep(null); setStepError(null); }} />,
      true,
    );
  }

  return frame(
    <>
      {isGuardian && user && (
        <div className="-mb-4">
          <LearnersPanel guardianId={user.id} selectedLearnerId={bookingFor?.id ?? null} onSelectLearner={setBookingFor} tutorName={name} />
        </div>
      )}
      {isViewOnlyLearner && (
        <section className={LINK_CARD}><p className="text-sm text-slate-600" data-view-only>{COPY.viewOnlyLearner}</p></section>
      )}

      <section className={`${LINK_CARD} space-y-4 scroll-mt-4`} id="book-a-tutor" data-lesson-card>
        <h2 className={LINK_HEADING}>{WORDS.lessonHeading}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LINK_LABEL} htmlFor="lessonSubject">{WORDS.subject}</label>
            <select id="lessonSubject" value={subject} onChange={(e) => setSubject(e.target.value)} className={LINK_INPUT}>
              <option value="">{WORDS.chooseSubject}</option>
              {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={LINK_LABEL} htmlFor="lessonGrade">{WORDS.grade}</label>
            <select id="lessonGrade" value={grade} onChange={(e) => setGrade(e.target.value)} disabled={!subject} className={`${LINK_INPUT} disabled:opacity-60`}>
              <option value="">{WORDS.chooseGrade}</option>
              {grades.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>

        <fieldset>
          <legend className={LINK_LABEL}>{WORDS.length}</legend>
          <div className="flex flex-wrap gap-2">
            {SESSION_LENGTHS.map((h) => (
              <button key={h} type="button" aria-pressed={hours === h} onClick={() => setHours(h)} className={tab(hours === h)}>{describeLength(h)}</button>
            ))}
          </div>
        </fieldset>

        <div ref={timeRef} className="scroll-mt-4">
          <span className={LINK_LABEL}>{WORDS.when}</span>
          {page.hours && <p data-tutor-hours className="text-xs font-semibold mb-2">{WORDS.hours(name, page.hours)}</p>}
          {!page.takingRequests ? (
            <p className="text-sm text-slate-600">{name} has not set working hours yet, so a lesson cannot be {page.booksOnConfirm ? 'booked' : 'requested'} at the moment.</p>
          ) : times.status === 'loading' ? (
            <p role="status" className="flex items-center gap-2 text-xs font-semibold text-slate-600"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Loading the times…</p>
          ) : times.status === 'failed' ? (
            <div role="alert">
              <p className="text-xs font-semibold text-rose-700 mb-2">{WORDS.timesFailed}</p>
              <button type="button" onClick={() => setTimesTick((t) => t + 1)} className={tab(false)}>Try again</button>
            </div>
          ) : (
            <>
              {nowOk && (
                <div className="flex gap-2 mb-3">
                  <button type="button" aria-pressed={!asap} onClick={() => setAsap(false)} className={tab(!asap)}>{WORDS.pickTime}</button>
                  <button type="button" aria-pressed={asap} onClick={() => setAsap(true)} className={tab(asap)}>{WORDS.asap}</button>
                </div>
              )}
              {!asap && (value && value.days.length === 0 ? (
                <p className="text-sm text-slate-600" data-no-times>{WORDS.noTimes(name)}</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={LINK_LABEL} htmlFor="lessonDay">{WORDS.day}</label>
                    <select id="lessonDay" value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} className={LINK_INPUT}>
                      <option value="">Choose a day</option>
                      {(value?.days ?? []).map((d) => <option key={d.date} value={d.date}>{describeDate(d.date)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LINK_LABEL} htmlFor="lessonTime">{WORDS.time}</label>
                    <select id="lessonTime" value={time} onChange={(e) => setTime(e.target.value)} disabled={!day} className={`${LINK_INPUT} disabled:opacity-60`}>
                      <option value="">Choose a time</option>
                      {(day?.times ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              ))}
              <p className="text-xs text-slate-600 mt-2" data-wait-note>{confirmMode ? CONFIRM_COPY.note(name) : asap ? WORDS.waitAsap(name) : WORDS.waitScheduled(name)}</p>
            </>
          )}
        </div>
      </section>

      <section className={`${LINK_CARD} flex flex-col items-center text-center`} data-pay-card>
        <p className="text-sm font-bold mb-1" data-lesson-total>{describeLength(hours)} with {name}: {rand0(price)}</p>
        <p className="text-xs text-slate-600 mb-4">{confirmMode ? CONFIRM_COPY.youBook(name) : WORDS.toHer(name)}</p>
        {sendError && (
          <div ref={errorRef} role="alert" className="w-full mb-4 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-semibold text-rose-700 text-left" data-booking-refusal>
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{sendError}</span>
            </div>
            <div className="mt-2 pl-6">
              <p className="text-slate-700">{confirmMode ? CONFIRM_COPY.nothing : WORDS.nothingSent}</p>
              {page.hours && <p className="mt-1 text-slate-700">{WORDS.hours(name, page.hours)}</p>}
              <button type="button" onClick={() => timeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="mt-3 px-4 py-2.5 rounded-xl bg-[#0F172A] text-white text-xs font-bold cursor-pointer">
                {WORDS.changeTime}
              </button>
            </div>
          </div>
        )}
        {!learnerReady && !isViewOnlyLearner && <p className="text-xs font-semibold text-slate-700 mb-3" data-need-learner>{WORDS.chooseLearner}</p>}
        {learnerReady && !lessonReady && <p className="text-xs font-semibold text-slate-700 mb-3" data-need-lesson>{WORDS.chooseFirst}</p>}

        {isViewOnlyLearner ? null : freeOpen ? (
          <>
            <p role="status" data-free-sessions className="text-sm font-extrabold text-[#15803D] mb-1">{FREE_FOR_NOW_NOTICE}</p>
            <p className="text-xs text-slate-600 mb-4">{FREE_FOR_NOW_DETAIL}</p>
            <button type="button" onClick={() => void send('free')} disabled={isSending || !ready} className={LINK_BUTTON}>{isSending ? 'Sending your request…' : `Send request to ${name}`}</button>
          </>
        ) : walletOpenAnswer === null || cardAnswer === 'loading' ? (
          <p role="status" className="flex items-center gap-2 text-xs font-semibold text-slate-600"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />{CARD_CLOSED_COPY.loading}</p>
        ) : !walletAvailable ? (
          cardPart ?? <p role="status" data-payments-not-open className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{CARD_CLOSED_COPY.nothingOpen}</p>
        ) : confirmMode ? (
          <div data-wallet-main className="w-full flex flex-col items-center">
            <WalletPayBox price={payPrice} promoLine={promo ? promoQuoteLine(promo) : null} state={wallet.state} onAddMoney={() => setAddMoneyOpen(true)} onRetry={wallet.reload} addLabel={bankMain ? ONLINE_COPY.addByBank : undefined} heldNote={CONFIRM_COPY.creditNote} booking />
            {walletEnough && (
              <button type="button" onClick={review} disabled={!ready} className={LINK_BUTTON}>{CONFIRM_COPY.next}</button>
            )}
          </div>
        ) : bankMain ? (
          <BankMainCheckout
            price={payPrice}
            promoLine={promo ? promoQuoteLine(promo) : null}
            state={wallet.state}
            walletEnough={walletEnough && ready}
            isSending={isSending}
            test={bank.test}
            provider={bank.provider}
            onAddMoney={() => setAddMoneyOpen(true)}
            onRetry={wallet.reload}
            onPayFromWallet={() => void send('wallet')}
            cardSection={cardPart}
            heldNote={WORDS.held(name)}
          />
        ) : (
          <div data-wallet-main className="w-full flex flex-col items-center">
            <p className="text-sm font-extrabold mb-1">{CARD_CLOSED_COPY.walletHeading}</p>
            <p className="text-xs text-slate-600 mb-4 max-w-sm">{CARD_CLOSED_COPY.walletHow}</p>
            <WalletPayBox price={payPrice} promoLine={promo ? promoQuoteLine(promo) : null} state={wallet.state} onAddMoney={() => setAddMoneyOpen(true)} onRetry={wallet.reload} heldNote={WORDS.held(name)} />
            {walletEnough && (
              <button type="button" onClick={() => void send('wallet')} disabled={isSending || !ready} className={LINK_BUTTON}>
                {isSending ? 'Sending your request…' : `Pay ${rand0(payPrice)} from your credit`}
              </button>
            )}
            {cardPart && <div className="mt-4 w-full">{cardPart}</div>}
          </div>
        )}
      </section>

      {walletAvailable && user && (
        <AddMoneyModal
          isOpen={addMoneyOpen}
          onClose={() => {
            setAddMoneyOpen(false);
            wallet.reload();
          }}
          payerId={user.id}
          suggestedRand={wallet.state.status === 'ready' ? shortfall(payPrice, wallet.state.available) : null}
          onChanged={wallet.reload}
          preferOnline={bankMain}
        />
      )}
    </>,
  );
}
