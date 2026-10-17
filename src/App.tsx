import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './lib/AuthContext';
import { Header } from './components/Header';
import { SubHeaderBanner } from './components/SubHeaderBanner';
import { BookingForm } from './components/BookingForm';
import { SuggestionsGrid } from './components/SuggestionsGrid';
import { PricesPage } from './components/PricesPage';
import { LevelSelectionPage } from './components/LevelSelectionPage';
import { TeachGoScreen } from './components/TeachGoScreen';
import { AboutPage } from './components/AboutPage';
import { InstitutionModal } from './components/InstitutionModal';
import { ScheduleModal } from './components/ScheduleModal';
import { SuggestionDetailModal } from './components/SuggestionDetailModal';
import { ManageAccountModal } from './components/ManageAccountModal';
import { Footer } from './components/Footer';
import { LearnersPanel } from './components/LearnersPanel';
import { SchoolResultsPanel } from './components/SchoolResultsPanel';
import { SessionsHistoryPage } from './components/SessionsHistoryPage';
import { LearnerGradeModal } from './components/LearnerGradeModal';
import { notificationTarget } from './lib/notificationTarget';
import { siteUrl } from './lib/siteUrl';
import { useAccountStatus } from './components/AccountGate';
import { FEATURES } from './lib/features';
import { LinkedLearner, fetchMyLearners } from './lib/guardian';

import { BookingFormState, SuggestionItem, UserAccount, PriceLevel, Institution, AppNotification } from './types';
import { toIsoDate } from './lib/format';
import { fetchUpcomingStudentSessions, fetchUpcomingTutorSessions, fetchStudentGradeLevel, fetchStudentInstitution, updateStudentInstitution, fetchPriceLevelById } from './lib/queries';
import { defaultBookAgainSchedule, type MyTutor } from './lib/keepOrSwap';
import type { BookAgainLearner } from './components/MyTutorsPanel';
import { rememberInstitution, recallInstitution } from './lib/institutionMemory';
import { institutionSaveTarget, institutionMessage, savesOnOwnProfile } from './lib/institutionSave';

export default function App() {
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();
  const { isViewOnlyLearner } = useAccountStatus();
  const [activeNav, setActiveNav] = useState<string>('learn');

  // Booking Form State. Institution starts empty — there's no seeded
  // institution to default to (schools_institutions is a live, currently
  // empty table); the user picks one via InstitutionModal.
  const [formState, setFormState] = useState<BookingFormState>({
    institution: '',
    institutionId: null,
    subject: '',
    scheduleType: 'now',
    scheduledDate: toIsoDate(new Date()),
    scheduledTime: '14:00',
  });

  // User Account State. Name/email come from the real signed-in profile;
  // upcomingSessions/gradeLevel are now real too (see below) — completedSessions/
  // savedTutorsCount aren't backed by real queries yet, so they stay
  // placeholder zeros rather than fabricated numbers.
  const [userAccount, setUserAccount] = useState<UserAccount>({
    name: '',
    email: '',
    institution: '',
    gradeLevel: '',
    upcomingSessions: 0,
    completedSessions: 0,
    savedTutorsCount: 0,
  });

  useEffect(() => {
    if (!profile) return;
    setUserAccount(prev => ({ ...prev, name: profile.fullName, email: profile.email }));
  }, [profile]);

  // The "You have N upcoming sessions" line in the dark banner (CEO, 17 Oct 2026). A guardian's count is their learners' sessions
  // (backlog 7k); a TUTOR's is the sessions they will run (it used to read the learner side with the tutor's id, so a tutor always
  // saw "no upcoming sessions"). Upcoming means booked and not over yet, so a session that has just started counts. It is read
  // again every 30 seconds while the page is open and the moment the person comes back to the tab, so a session a tutor has just
  // accepted shows up without a reload.
  const role = profile?.role;
  const refreshUpcoming = useCallback(() => {
    if (!user || !role) return;
    const sessions =
      role === 'tutor'
        ? fetchUpcomingTutorSessions(user.id)
        : (role === 'parent'
            ? fetchMyLearners(user.id).then((learners) => learners.map((l) => l.id))
            : Promise.resolve([user.id])
          ).then(fetchUpcomingStudentSessions);
    sessions
      .then((found) => setUserAccount((prev) => (prev.upcomingSessions === found.length ? prev : { ...prev, upcomingSessions: found.length })))
      .catch((err) => console.error('upcoming sessions count failed:', err));
  }, [user, role]);
  useEffect(() => {
    refreshUpcoming();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshUpcoming();
    }, 30_000);
    const onBack = () => {
      if (document.visibilityState === 'visible') refreshUpcoming();
    };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
    };
  }, [refreshUpcoming]);
  useEffect(() => {
    if (!user || !role) return;
    fetchStudentGradeLevel(user.id)
      .then((gradeLevel) => setUserAccount(prev => ({ ...prev, gradeLevel: gradeLevel ?? '' })))
      .catch((err) => console.error('fetchStudentGradeLevel failed:', err));
  }, [user, role]);

  // Parents/guardians book for one of their learners (backlog 7k): the search
  // uses that learner's grade, and the request is made for them.
  const isGuardian = profile?.role === 'parent';
  const [bookingFor, setBookingFor] = useState<LinkedLearner | null>(null);
  const searchGradeLevel = isGuardian ? (bookingFor?.gradeLevel ?? '') : userAccount.gradeLevel;

  // 7cq: a learner's institution comes back with them instead of being asked again after every reload or
  // sign-in. A learner's own is saved on their profile. For a guardian it is the learner they are booking
  // for: the learner's saved one if it has one, otherwise the last one chosen for that learner on this device
  // (a guardian can't change a learner's profile). Tutors set theirs under Teaching.
  // 7cv: the roles that load from their own profile are the same ones that save to it (savesOnOwnProfile).
  // Depends on the ids, not the user object, so a token refresh doesn't clear a choice just made.
  useEffect(() => {
    if (!user || !role || (role !== 'parent' && !savesOnOwnProfile(role))) return;
    const learnerId = role === 'parent' ? bookingFor?.id ?? null : user.id;
    // Start empty so switching learner never carries the previous learner's institution over.
    setFormState(prev => ({ ...prev, institution: '', institutionId: null }));
    setUserAccount(prev => ({ ...prev, institution: '' }));
    if (!learnerId) return;
    let cancelled = false;
    fetchStudentInstitution(learnerId)
      .then((saved) => saved ?? (role === 'parent' ? recallInstitution(user.id, learnerId) : null))
      .then((institution) => {
        if (cancelled || !institution) return;
        // Only fill an empty choice: anything picked while this was loading wins.
        setFormState(prev => (prev.institutionId ? prev : { ...prev, institution: institution.name, institutionId: institution.id }));
        setUserAccount(prev => (prev.institution ? prev : { ...prev, institution: institution.name }));
      })
      .catch((err) => console.error('fetchStudentInstitution failed:', err));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, role, bookingFor?.id]);

  // Page / view state
  const [view, setView] = useState<'home' | 'prices' | 'tiers' | 'teach' | 'about' | 'sessions'>('home');
  const [selectedLevel, setSelectedLevel] = useState<PriceLevel | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<SuggestionItem | null>(null);

  // Keep or swap (master 7aa; FEATURES.keepOrSwap): "Book again" from My tutors addresses the next request to that tutor.
  // The request page shows who it is addressed to and lets the learner send it to anyone instead.
  const [bookAgain, setBookAgain] = useState<{ tutorId: string; firstName: string } | null>(null);

  const handleBookAgain = async (tutor: MyTutor, forLearner: BookAgainLearner) => {
    setIsManageAccountOpen(false);
    let learnerToBookFor: LinkedLearner | null = null;
    if (isGuardian && user) {
      // The parent books for the learner whose tutor this is: the search and the request both use that learner.
      try {
        const found = await fetchMyLearners(user.id);
        learnerToBookFor = found.find((l) => l.id === forLearner.id) ?? null;
      } catch (err) {
        console.error('fetchMyLearners failed:', err);
      }
      if (!learnerToBookFor) {
        showToast('Could not open that learner. Please try again.');
        return;
      }
    }
    const schedule = defaultBookAgainSchedule(new Date());
    if (learnerToBookFor) setBookingFor(learnerToBookFor);
    setFormState(prev => ({
      ...prev,
      subject: tutor.lastSubject ?? prev.subject,
      scheduleType: 'scheduled',
      scheduledDate: schedule.date,
      scheduledTime: schedule.time,
    }));
    setSelectedFormat(null);
    setSelectedLevel(null);
    setBookAgain({ tutorId: tutor.tutorId, firstName: tutor.firstName });
    setActiveNav('learn');
    setView('prices');
    // The price level last time ("the same price rules": repeat pricing is on hold). If it cannot be found, the learner chooses one.
    if (tutor.lastLevelId) {
      const level = await fetchPriceLevelById(tutor.lastLevelId);
      if (level) setSelectedLevel(level);
    }
  };

  // Left-nav clicks (Learn/Teach/About, and Schools/Resources while they're
  // hidden in Header.tsx) double as view switches: Teach and About jump to
  // their own screens, anything else returns to the home view (where the
  // "Viewing: X Portal" banner still handles any future/unbuilt nav item).
  const handleSetActiveNav = (nav: string) => {
    setBookAgain(null);
    setActiveNav(nav);
    setView(nav === 'teach' ? 'teach' : nav === 'about' ? 'about' : 'home');
  };

  // The "Sessions & history" page (the CEO, 16 Oct 2026): reached from a notification in the header and from the
  // "upcoming sessions" line in the dark banner, instead of through Manage Account.
  const openSessionsPage = () => {
    setBookAgain(null);
    setActiveNav(role === 'tutor' ? 'teach' : 'learn');
    setView('sessions');
    window.scrollTo({ top: 0 });
  };

  const handleOpenNotification = (notification: AppNotification) => {
    const target = notificationTarget(notification.type);
    if (target === 'teach') handleSetActiveNav('teach');
    else if (target === 'terms') window.open(siteUrl('/terms'), '_blank', 'noopener');
    else openSessionsPage();
  };

  // Modals state
  const [isInstitutionModalOpen, setIsInstitutionModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<SuggestionItem | null>(null);
  const [isManageAccountOpen, setIsManageAccountOpen] = useState(false);
  const [manageAccountTab, setManageAccountTab] = useState<'profile' | 'sessions' | 'billing' | 'teaching'>('profile');

  const openManageAccount = (tab: 'profile' | 'sessions' | 'billing' | 'teaching' = 'profile') => {
    setManageAccountTab(tab);
    setIsManageAccountOpen(true);
  };

  // A parent's "Change" (or "Set") next to the grade (16 Oct 2026). It used to send a parent to the home page, which on the home
  // page itself did nothing, and a parent could not change a learner's grade at all. Now: with a learner chosen, a small window
  // lets the parent change THAT learner's grade; with none chosen, the page scrolls to "Your learners" and says why.
  const [isLearnerGradeOpen, setIsLearnerGradeOpen] = useState(false);
  // Bumped after a grade is saved so "Your learners" reloads and shows it.
  const [learnersVersion, setLearnersVersion] = useState(0);

  const handleChangeGradeLevel = () => {
    if (isGuardian) {
      if (bookingFor) {
        setIsLearnerGradeOpen(true);
      } else {
        showToast("Choose who you're booking for first: the grade belongs to the learner.");
        setView('home');
        // After the home view has drawn, bring "Your learners" into view.
        window.setTimeout(() => document.getElementById('your-learners')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      }
    } else {
      openManageAccount('profile');
    }
  };

  // The words on the grade row's button when no grade is showing: a parent has to choose a learner first; others set it in their account.
  const gradeSetLabel = isGuardian ? (bookingFor ? 'Set' : 'Choose a learner') : undefined;

  const handleLearnerGradeChanged = (gradeLevel: string) => {
    const name = bookingFor?.firstName ?? 'The learner';
    setBookingFor((prev) => (prev ? { ...prev, gradeLevel } : prev));
    setLearnersVersion((v) => v + 1);
    showToast(`${name}'s grade is now ${gradeLevel}`);
  };

  // Notification / Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  const handleSelectInstitution = (institution: Institution) => {
    setFormState(prev => ({ ...prev, institution: institution.name, institutionId: institution.id }));
    setUserAccount(prev => ({ ...prev, institution: institution.name }));
    // 7cq/7cv: keep it where it can be kept, and say only what really happened. A learner's (or an admin's own)
    // goes on their own profile and is announced only after the database confirms a row changed; a guardian's is
    // remembered for the learner they are booking for, on this device; a tutor sets theirs under Teaching.
    const target = institutionSaveTarget(role, !!bookingFor);
    if (user && target === 'own-profile') {
      updateStudentInstitution(user.id, institution.id)
        .then(() => showToast(institutionMessage(role, target, institution.name)))
        .catch((err) => {
          console.error('updateStudentInstitution failed:', err);
          showToast(`"${institution.name}" is set for this search but could not be saved. Please try again.`);
        });
      return;
    }
    if (user && target === 'device-for-learner' && bookingFor) rememberInstitution(user.id, bookingFor.id, institution);
    showToast(institutionMessage(role, target, institution.name));
  };

  // ManageAccountModal.tsx persists the actual write (updateStudentGradeLevel)
  // and only calls this once that succeeds — mirrors how institution changes
  // flow back up to keep a single source of truth in this component's state.
  const handleGradeLevelChange = (gradeLevel: string) => {
    setUserAccount(prev => ({ ...prev, gradeLevel }));
    showToast(`Grade level updated to "${gradeLevel}"`);
  };

  const handleUpdateSchedule = (scheduleType: 'now' | 'scheduled', date?: string, time?: string) => {
    setFormState(prev => ({
      ...prev,
      scheduleType,
      scheduledDate: date || prev.scheduledDate,
      scheduledTime: time || prev.scheduledTime,
    }));
    showToast(scheduleType === 'now' ? 'Set to instant tutor matching' : `Scheduled for ${date || 'Today'} at ${time || '14:00'}`);
  };

  // The picked format (1-on-1, Homework Help, etc.) is a teaching-style
  // choice, not a subject — kept as its own piece of state so it never
  // overwrites whatever the student already typed into the subject field.
  const handleSelectSuggestionFormat = (format: SuggestionItem) => {
    setSelectedFormat(format);
    setView('prices');
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF7F2] font-sans text-[#0F172A] selection:bg-[#15803D]/20 selection:text-[#15803D]">
      
      {/* 1. Header Navigation Bar */}
      <Header
        activeNav={activeNav}
        setActiveNav={handleSetActiveNav}
        onOpenManageAccount={() => openManageAccount('profile')}
        onOpenNotification={handleOpenNotification}
      />

      {/* 2. Secondary Sub-Header Banner */}
      <SubHeaderBanner
        upcomingSessionsCount={userAccount.upcomingSessions}
        onOpenAccount={() => openManageAccount('profile')}
        onOpenSessions={openSessionsPage}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">

        {view === 'sessions' ? (
          <SessionsHistoryPage
            userId={user!.id}
            role={role}
            isGuardian={isGuardian}
            onBack={() => handleSetActiveNav(role === 'tutor' ? 'teach' : 'learn')}
            onBookAgain={FEATURES.keepOrSwap ? handleBookAgain : undefined}
          />
        ) : view === 'about' ? (
          <AboutPage />
        ) : view === 'teach' ? (
          <TeachGoScreen
            tutorId={user!.id}
            onOpenMenu={() => openManageAccount('profile')}
            onViewTeachingProfile={() => openManageAccount('teaching')}
            onOpenSessions={openSessionsPage}
          />
        ) : view === 'tiers' ? (
          <LevelSelectionPage
            formState={formState}
            gradeLevel={searchGradeLevel}
            onBack={() => setView('prices')}
            onSelectLevel={(level) => {
              setSelectedLevel(level);
              setView('prices');
            }}
            waitlistLearnerId={isViewOnlyLearner ? null : isGuardian ? (bookingFor?.id ?? null) : (user?.id ?? null)}
          />
        ) : view === 'prices' ? (
          <PricesPage
            learner={isGuardian && bookingFor ? { id: bookingFor.id, firstName: bookingFor.firstName } : null}
            formState={formState}
            setFormState={setFormState}
            gradeLevel={searchGradeLevel}
            onChangeGradeLevel={handleChangeGradeLevel}
            gradeSetLabel={gradeSetLabel}
            onBack={() => {
              setBookAgain(null);
              setView('home');
            }}
            onChangeInstitution={() => setIsInstitutionModalOpen(true)}
            onOpenScheduleModal={() => setIsScheduleModalOpen(true)}
            onSelectLevel={(level) => setSelectedLevel(level)}
            selectedLevel={selectedLevel}
            onClearLevel={() => setSelectedLevel(null)}
            selectedFormat={selectedFormat}
            onClearFormat={() => setSelectedFormat(null)}
            bookAgain={FEATURES.keepOrSwap ? bookAgain : null}
            onClearBookAgain={() => setBookAgain(null)}
          />
        ) : (
          <>
            {/* Dynamic Nav View Banner when switching left nav items */}
            {activeNav !== 'learn' && (
              <div className="mb-6 bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex items-center justify-between">
                <div className="text-sm font-bold text-[#0F172A]">
                  Viewing: <span className="text-[#15803D] uppercase tracking-wider">{activeNav}</span> Portal
                </div>
                <button
                  onClick={() => handleSetActiveNav('learn')}
                  className="text-xs font-bold text-[#15803D] hover:underline cursor-pointer"
                >
                  Return to Learn Home →
                </button>
              </div>
            )}

            {isGuardian && user && (
              <LearnersPanel
                key={learnersVersion}
                guardianId={user.id}
                selectedLearnerId={bookingFor?.id ?? null}
                onSelectLearner={setBookingFor}
              />
            )}

            {/* Phase 2: an adult learner's own school results (FEATURES.schoolResults). */}
            {FEATURES.schoolResults && user && profile?.role === 'student' && !isViewOnlyLearner && (
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs mb-8">
                <SchoolResultsPanel learnerId={user.id} learnerName={profile.fullName?.split(' ')[0] || 'You'} isSelf />
              </div>
            )}

            {/* 3 & 4. Main Section Grid: Left Column (Booking Form) + Right Column (Suggestions Grid) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

              {/* Left Column (5 cols on lg screen) */}
              <div className="lg:col-span-5 w-full">
                <BookingForm
                  formState={formState}
                  setFormState={setFormState}
                  gradeLevel={searchGradeLevel}
                  onChangeGradeLevel={handleChangeGradeLevel}
                  gradeSetLabel={gradeSetLabel}
                  onChangeInstitution={() => setIsInstitutionModalOpen(true)}
                  onOpenScheduleModal={() => setIsScheduleModalOpen(true)}
                  onSeePrices={() => setView('prices')}
                />
              </div>

              {/* Right Column (7 cols on lg screen) */}
              <div className="lg:col-span-7 w-full">
                <SuggestionsGrid
                  onSelectSuggestion={(item) => setSelectedSuggestion(item)}
                />
              </div>

            </div>
          </>
        )}

      </main>

      {/* Footer */}
      <Footer />

      {/* Modals & Overlays */}
      <InstitutionModal
        isOpen={isInstitutionModalOpen}
        onClose={() => setIsInstitutionModalOpen(false)}
        currentInstitution={formState.institution}
        onSelectInstitution={handleSelectInstitution}
      />

      <ScheduleModal
        isOpen={isScheduleModalOpen}
        onClose={() => setIsScheduleModalOpen(false)}
        formState={formState}
        onUpdateSchedule={handleUpdateSchedule}
      />

      <SuggestionDetailModal
        item={selectedSuggestion}
        onClose={() => setSelectedSuggestion(null)}
        onSelectFormat={handleSelectSuggestionFormat}
      />

      <LearnerGradeModal
        isOpen={isLearnerGradeOpen}
        onClose={() => setIsLearnerGradeOpen(false)}
        learner={bookingFor ? { id: bookingFor.id, firstName: bookingFor.firstName, gradeLevel: bookingFor.gradeLevel } : null}
        onChanged={handleLearnerGradeChanged}
      />

      <ManageAccountModal
        isOpen={isManageAccountOpen}
        onClose={() => setIsManageAccountOpen(false)}
        userAccount={userAccount}
        onUpdateInstitution={() => setIsInstitutionModalOpen(true)}
        onUpdateGradeLevel={handleGradeLevelChange}
        initialTab={manageAccountTab}
        tutorId={user!.id}
        isGuardian={isGuardian}
        onSignOut={handleSignOut}
        onBookAgain={FEATURES.keepOrSwap ? handleBookAgain : undefined}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#0F172A] text-white text-xs font-bold px-4 py-3 rounded-2xl shadow-2xl border border-slate-700 flex items-center space-x-2 animate-in slide-in-from-bottom-5 duration-200">
          <div className="w-2 h-2 rounded-full bg-[#15803D]"></div>
          <span>{toastMessage}</span>
        </div>
      )}

    </div>
  );
}
