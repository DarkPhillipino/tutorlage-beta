import React, { useEffect, useState } from 'react';
import { X, LogOut, CreditCard, Check, AlertCircle } from 'lucide-react';
import { UserAccount } from '../types';
import { fetchGradeLevelSuggestions, fetchMySavedCards, updateStudentGradeLevel, type SavedCard } from '../lib/queries';
import { getErrorMessage } from '../lib/errors';
import { TeachingProfilePanel } from './TeachingProfilePanel';
import { UpcomingSessionsPanel } from './UpcomingSessionsPanel';

interface ManageAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  userAccount: UserAccount;
  onUpdateInstitution: () => void;
  onUpdateGradeLevel: (gradeLevel: string) => void;
  initialTab?: 'profile' | 'sessions' | 'billing' | 'teaching';
  tutorId: string;
  // Parents/guardians see their learners' sessions on the Sessions tab.
  isGuardian?: boolean;
  onSignOut: () => void;
}

export const ManageAccountModal: React.FC<ManageAccountModalProps> = ({
  isOpen,
  onClose,
  userAccount,
  onUpdateInstitution,
  onUpdateGradeLevel,
  initialTab = 'profile',
  tutorId,
  isGuardian = false,
  onSignOut,
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'sessions' | 'billing' | 'teaching'>(initialTab);

  // Grade level lives on the account (student_profiles.grade_level), set
  // here rather than re-entered per search — see PricesPage.tsx/
  // BookingForm.tsx, which both just read userAccount.gradeLevel now.
  // "tutorId" above is really just the signed-in user's id regardless of
  // role (same as TeachingProfilePanel's use of it) — fine to reuse here.
  const [isEditingGradeLevel, setIsEditingGradeLevel] = useState(false);
  const [gradeLevelOptions, setGradeLevelOptions] = useState<string[]>([]);
  const [gradeLevelDraft, setGradeLevelDraft] = useState('');
  const [isSavingGradeLevel, setIsSavingGradeLevel] = useState(false);
  const [gradeLevelError, setGradeLevelError] = useState<string | null>(null);

  const handleStartEditGradeLevel = () => {
    setGradeLevelError(null);
    setGradeLevelDraft(userAccount.gradeLevel);
    setIsEditingGradeLevel(true);
    if (gradeLevelOptions.length === 0) {
      fetchGradeLevelSuggestions()
        .then(setGradeLevelOptions)
        .catch((err) => console.error('fetchGradeLevelSuggestions failed:', err));
    }
  };

  const handleSaveGradeLevel = async () => {
    if (!gradeLevelDraft) {
      setGradeLevelError('Choose a grade level.');
      return;
    }
    setIsSavingGradeLevel(true);
    setGradeLevelError(null);
    try {
      await updateStudentGradeLevel(tutorId, gradeLevelDraft);
      onUpdateGradeLevel(gradeLevelDraft);
      setIsEditingGradeLevel(false);
    } catch (e) {
      setGradeLevelError(getErrorMessage(e, 'Could not save your grade level.'));
    } finally {
      setIsSavingGradeLevel(false);
    }
  };

  // The modal stays mounted (it just returns null below) so state survives
  // between opens — reset to whichever tab the caller asked for each time
  // it's (re)opened, rather than only on first mount.
  useEffect(() => {
    if (isOpen) setActiveTab(initialTab);
  }, [isOpen, initialTab]);

  // Billing shows the person's real saved cards (7a), loaded each time the
  // tab opens so a card saved by a new request shows up.
  const [savedCards, setSavedCards] = useState<SavedCard[] | null>(null);
  const [cardsError, setCardsError] = useState(false);
  useEffect(() => {
    if (!isOpen || activeTab !== 'billing') return;
    setCardsError(false);
    setSavedCards(null);
    fetchMySavedCards(tutorId)
      .then(setSavedCards)
      .catch((err) => {
        console.error('fetchMySavedCards failed:', err);
        setCardsError(true);
      });
  }, [isOpen, activeTab, tutorId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-3xl max-w-lg w-full overflow-hidden flex flex-col shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Header */}
        <div className="p-6 bg-[#0A192F] text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-full bg-emerald-500 text-slate-950 font-black flex items-center justify-center text-lg shadow-md border-2 border-white">
              {userAccount.name ? userAccount.name.charAt(0).toUpperCase() : '?'}
            </div>
            <div>
              <h3 className="text-xl font-extrabold tracking-tight">{userAccount.name || 'Loading…'}</h3>
              <p className="text-xs text-slate-300 mt-0.5">{userAccount.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 bg-[#FAF7F2] px-6 pt-3">
          <button
            onClick={() => setActiveTab('profile')}
            className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 cursor-pointer ${
              activeTab === 'profile'
                ? 'border-[#15803D] text-[#15803D]'
                : 'border-transparent text-slate-500 hover:text-[#0F172A]'
            }`}
          >
            Account Details
          </button>
          <button
            onClick={() => setActiveTab('sessions')}
            className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 cursor-pointer ${
              activeTab === 'sessions'
                ? 'border-[#15803D] text-[#15803D]'
                : 'border-transparent text-slate-500 hover:text-[#0F172A]'
            }`}
          >
            Sessions & History
          </button>
          <button
            onClick={() => setActiveTab('billing')}
            className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 cursor-pointer ${
              activeTab === 'billing'
                ? 'border-[#15803D] text-[#15803D]'
                : 'border-transparent text-slate-500 hover:text-[#0F172A]'
            }`}
          >
            Payment Methods
          </button>
          <button
            onClick={() => setActiveTab('teaching')}
            className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 cursor-pointer whitespace-nowrap ${
              activeTab === 'teaching'
                ? 'border-[#15803D] text-[#15803D]'
                : 'border-transparent text-slate-500 hover:text-[#0F172A]'
            }`}
          >
            Teaching
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 bg-[#FAF7F2] space-y-4 max-h-[55vh] overflow-y-auto">
          
          {activeTab === 'profile' && (
            <div className="space-y-4">
              
              {/* Institution Card */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Primary Campus Institution
                  </div>
                  <div className="text-sm font-bold text-[#0F172A] mt-0.5">
                    {userAccount.institution || 'Not set'}
                  </div>
                  <div className="text-xs text-emerald-700 font-semibold mt-0.5">
                    Verified Student Membership
                  </div>
                </div>
                <button
                  onClick={() => {
                    onClose();
                    onUpdateInstitution();
                  }}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-[#0F172A] font-bold text-xs rounded-xl transition-colors cursor-pointer"
                >
                  Change
                </button>
              </div>

              {/* Grade Level Card */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200">
                {isEditingGradeLevel ? (
                  <div className="space-y-2">
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Grade Level
                    </div>
                    <select
                      value={gradeLevelDraft}
                      onChange={(e) => setGradeLevelDraft(e.target.value)}
                      className="w-full bg-slate-100 text-sm font-semibold text-[#0F172A] rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20 cursor-pointer"
                    >
                      <option value="" disabled>Select a grade level</option>
                      {gradeLevelOptions.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                    {gradeLevelError && (
                      <div className="flex items-center gap-1.5 text-[11px] text-rose-600 font-semibold">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{gradeLevelError}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={handleSaveGradeLevel}
                        disabled={isSavingGradeLevel}
                        className="flex items-center gap-1 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold px-3 py-2 rounded-lg transition-all cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Save
                      </button>
                      <button
                        onClick={() => { setIsEditingGradeLevel(false); setGradeLevelError(null); }}
                        disabled={isSavingGradeLevel}
                        className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold px-3 py-2 rounded-lg transition-all cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Grade Level
                      </div>
                      <div className="text-sm font-bold text-[#0F172A] mt-0.5">
                        {userAccount.gradeLevel || 'Not set'}
                      </div>
                    </div>
                    <button
                      onClick={handleStartEditGradeLevel}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-[#0F172A] font-bold text-xs rounded-xl transition-colors cursor-pointer"
                    >
                      {userAccount.gradeLevel ? 'Change' : 'Set'}
                    </button>
                  </div>
                )}
              </div>

              {/* Only the upcoming count is backed by real data. "Completed",
                  "Saved Tutors" (no such feature), a "Notification
                  Preferences" link that went nowhere and an "Academic
                  Verification Badge" shown to everyone were removed
                  2026-10-03 (backlog 7aw). */}
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200 text-center">
                <div className="text-xl font-extrabold text-[#0F172A]">{userAccount.upcomingSessions}</div>
                <div className="text-[10px] text-slate-500 font-bold uppercase mt-1">
                  Upcoming sessions
                </div>
              </div>

            </div>
          )}

          {activeTab === 'sessions' && <UpcomingSessionsPanel studentId={tutorId} isGuardian={isGuardian} />}

          {activeTab === 'billing' && (
            <div className="space-y-3">
              {cardsError ? (
                <p className="text-xs font-semibold text-rose-600">Couldn't load your saved cards. Try again later.</p>
              ) : savedCards === null ? (
                <p className="text-xs text-slate-500">Loading…</p>
              ) : savedCards.length === 0 ? (
                <div className="bg-white rounded-2xl p-4 border border-slate-200 text-xs text-slate-600 leading-relaxed">
                  No saved card yet. When you send a request, Paystack saves your card with a R1 check
                  (refunded straight away), so it can be charged when a tutor accepts.
                </div>
              ) : (
                savedCards.map((card) => (
                  <div key={card.id} className="bg-white rounded-2xl p-4 border border-slate-200 flex items-center space-x-3">
                    <CreditCard className="w-5 h-5 text-[#0F172A]" />
                    <div>
                      <div className="text-xs font-bold text-[#0F172A]">
                        {card.cardType ? card.cardType.trim().replace(/^\w/, (c) => c.toUpperCase()) : 'Card'}
                        {card.last4 ? ` ending in ${card.last4}` : ''}
                      </div>
                      <div className="text-[10px] text-slate-400 font-medium">
                        {[card.bank, card.expMonth && card.expYear ? `expires ${card.expMonth}/${card.expYear}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'teaching' && <TeachingProfilePanel tutorId={tutorId} />}

        </div>

        {/* Footer */}
        <div className="p-4 bg-white border-t border-slate-200 flex items-center justify-between px-6">
          <button
            onClick={() => {
              onClose();
              onSignOut();
            }}
            className="flex items-center space-x-1.5 text-xs font-bold text-rose-600 hover:text-rose-800 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
          
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#0F172A] text-white font-bold text-xs rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
};
