import React, { useState } from 'react';
import { Header } from './components/Header';
import { SubHeaderBanner } from './components/SubHeaderBanner';
import { BookingForm } from './components/BookingForm';
import { SuggestionsGrid } from './components/SuggestionsGrid';
import { PricesModal } from './components/PricesModal';
import { InstitutionModal } from './components/InstitutionModal';
import { ScheduleModal } from './components/ScheduleModal';
import { SuggestionDetailModal } from './components/SuggestionDetailModal';
import { ManageAccountModal } from './components/ManageAccountModal';
import { Footer } from './components/Footer';

import { BookingFormState, SuggestionItem, UserAccount, Tutor } from './types';
import { INITIAL_INSTITUTION } from './data/mockData';

export default function App() {
  const [activeNav, setActiveNav] = useState<string>('learn');

  // Booking Form State
  const [formState, setFormState] = useState<BookingFormState>({
    institution: INITIAL_INSTITUTION,
    subject: '',
    gradeLevel: '',
    scheduleType: 'now',
    scheduledDate: 'Today',
    scheduledTime: '14:00',
  });

  // User Account State
  const [userAccount, setUserAccount] = useState<UserAccount>({
    name: 'Pakiso',
    email: 'pakiso@example.com',
    institution: INITIAL_INSTITUTION,
    upcomingSessions: 0,
    completedSessions: 12,
    savedTutorsCount: 3,
  });

  // Modals state
  const [isPricesModalOpen, setIsPricesModalOpen] = useState(false);
  const [isInstitutionModalOpen, setIsInstitutionModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<SuggestionItem | null>(null);
  const [isManageAccountOpen, setIsManageAccountOpen] = useState(false);

  // Notification / Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  const handleBookTutor = (tutor: Tutor) => {
    showToast(`Session request sent to ${tutor.name} (${formState.subject || 'Tutoring'})!`);
  };

  const handleSelectInstitution = (instName: string) => {
    setFormState(prev => ({ ...prev, institution: instName }));
    setUserAccount(prev => ({ ...prev, institution: instName }));
    showToast(`Institution updated to "${instName}"`);
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

  const handleSelectSuggestionFormat = (formatTitle: string) => {
    setFormState(prev => ({ ...prev, subject: formatTitle }));
    setIsPricesModalOpen(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF7F2] font-sans text-[#0F172A] selection:bg-[#15803D]/20 selection:text-[#15803D]">
      
      {/* 1. Header Navigation Bar */}
      <Header
        activeNav={activeNav}
        setActiveNav={setActiveNav}
        onOpenManageAccount={() => setIsManageAccountOpen(true)}
      />

      {/* 2. Secondary Sub-Header Banner */}
      <SubHeaderBanner
        onOpenActivity={() => showToast('Activity log: 12 completed tutoring sessions.')}
        onOpenPromotions={() => showToast('Promotions: Use code CAMPUS2026 for 15% off exam prep!')}
        onOpenAccount={() => setIsManageAccountOpen(true)}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        
        {/* Dynamic Nav View Banner when switching left nav items */}
        {activeNav !== 'learn' && (
          <div className="mb-6 bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex items-center justify-between">
            <div className="text-sm font-bold text-[#0F172A]">
              Viewing: <span className="text-[#15803D] uppercase tracking-wider">{activeNav}</span> Portal
            </div>
            <button
              onClick={() => setActiveNav('learn')}
              className="text-xs font-bold text-[#15803D] hover:underline cursor-pointer"
            >
              Return to Learn Home →
            </button>
          </div>
        )}

        {/* 3 & 4. Main Section Grid: Left Column (Booking Form) + Right Column (Suggestions Grid) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column (5 cols on lg screen) */}
          <div className="lg:col-span-5 w-full">
            <BookingForm
              formState={formState}
              setFormState={setFormState}
              onChangeInstitution={() => setIsInstitutionModalOpen(true)}
              onOpenScheduleModal={() => setIsScheduleModalOpen(true)}
              onSeePrices={() => setIsPricesModalOpen(true)}
            />
          </div>

          {/* Right Column (7 cols on lg screen) */}
          <div className="lg:col-span-7 w-full">
            <SuggestionsGrid
              onSelectSuggestion={(item) => setSelectedSuggestion(item)}
            />
          </div>

        </div>

      </main>

      {/* Footer */}
      <Footer />

      {/* Modals & Overlays */}
      <PricesModal
        isOpen={isPricesModalOpen}
        onClose={() => setIsPricesModalOpen(false)}
        formState={formState}
        onBookTutor={handleBookTutor}
      />

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
