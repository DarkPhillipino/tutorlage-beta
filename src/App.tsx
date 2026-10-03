import React, { useEffect, useState } from 'react';
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
import { LinkedLearner, fetchMyLearners } from './lib/guardian';

import { BookingFormState, SuggestionItem, UserAccount, PriceLevel, Institution } from './types';
import { toIsoDate } from './lib/format';
import { fetchUpcomingStudentSessions, fetchStudentGradeLevel } from './lib/queries';

export default function App() {
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();
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

  // A guardian's upcoming count is their learners' sessions (backlog 7k).
  const role = profile?.role;
  useEffect(() => {
    if (!user || !role) return;
    const learnerIds = role === 'parent'
      ? fetchMyLearners(user.id).then((learners) => learners.map((l) => l.id))
      : Promise.resolve([user.id]);
    learnerIds
      .then(fetchUpcomingStudentSessions)
      .then((sessions) => setUserAccount(prev => ({ ...prev, upcomingSessions: sessions.length })))
      .catch((err) => console.error('fetchUpcomingStudentSessions failed:', err));
    fetchStudentGradeLevel(user.id)
      .then((gradeLevel) => setUserAccount(prev => ({ ...prev, gradeLevel: gradeLevel ?? '' })))
      .catch((err) => console.error('fetchStudentGradeLevel failed:', err));
  }, [user, role]);

  // Parents/guardians book for one of their learners (backlog 7k): the search
  // uses that learner's grade, and the request is made for them.
  const isGuardian = profile?.role === 'parent';
  const [bookingFor, setBookingFor] = useState<LinkedLearner | null>(null);
  const searchGradeLevel = isGuardian ? (bookingFor?.gradeLevel ?? '') : userAccount.gradeLevel;

  // Page / view state
  const [view, setView] = useState<'home' | 'prices' | 'tiers' | 'teach' | 'about'>('home');
  const [selectedLevel, setSelectedLevel] = useState<PriceLevel | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<SuggestionItem | null>(null);

  // Left-nav clicks (Learn/Teach/About, and Schools/Resources while they're
  // hidden in Header.tsx) double as view switches: Teach and About jump to
  // their own screens, anything else returns to the home view (where the
  // "Viewing: X Portal" banner still handles any future/unbuilt nav item).
  const handleSetActiveNav = (nav: string) => {
    setActiveNav(nav);
    setView(nav === 'teach' ? 'teach' : nav === 'about' ? 'about' : 'home');
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

  // A learner's grade is set when their guardian adds them, so a guardian
  // "changes grade" by choosing the learner on the home page.
  const handleChangeGradeLevel = () => {
    if (isGuardian) {
      setView('home');
    } else {
      openManageAccount('profile');
    }
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
    showToast(`Institution updated to "${institution.name}"`);
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
      />

      {/* 2. Secondary Sub-Header Banner */}
      <SubHeaderBanner
        upcomingSessionsCount={userAccount.upcomingSessions}
        onOpenActivity={() => showToast(`Activity log: ${userAccount.completedSessions} completed tutoring session${userAccount.completedSessions === 1 ? '' : 's'}.`)}
        onOpenAccount={() => openManageAccount('profile')}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">

        {view === 'about' ? (
          <AboutPage />
        ) : view === 'teach' ? (
          <TeachGoScreen
            tutorId={user!.id}
            onOpenMenu={() => openManageAccount('profile')}
            onViewTeachingProfile={() => openManageAccount('teaching')}
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
          />
        ) : view === 'prices' ? (
          <PricesPage
            learner={isGuardian && bookingFor ? { id: bookingFor.id, firstName: bookingFor.firstName } : null}
            formState={formState}
            setFormState={setFormState}
            gradeLevel={searchGradeLevel}
            onChangeGradeLevel={handleChangeGradeLevel}
            onBack={() => setView('home')}
            onChangeInstitution={() => setIsInstitutionModalOpen(true)}
            onOpenScheduleModal={() => setIsScheduleModalOpen(true)}
            onSearch={() => setView('tiers')}
            selectedLevel={selectedLevel}
            onClearLevel={() => setSelectedLevel(null)}
            selectedFormat={selectedFormat}
            onClearFormat={() => setSelectedFormat(null)}
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
                guardianId={user.id}
                selectedLearnerId={bookingFor?.id ?? null}
                onSelectLearner={setBookingFor}
              />
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
