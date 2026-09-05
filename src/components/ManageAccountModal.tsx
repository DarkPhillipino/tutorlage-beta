import React, { useEffect, useState } from 'react';
import { X, User, BookOpen, ShieldCheck, Settings, LogOut, Award, CreditCard, ChevronRight } from 'lucide-react';
import { UserAccount } from '../types';
import { TeachingProfilePanel } from './TeachingProfilePanel';
import { UpcomingSessionsPanel } from './UpcomingSessionsPanel';

interface ManageAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  userAccount: UserAccount;
  onUpdateInstitution: () => void;
  initialTab?: 'profile' | 'sessions' | 'billing' | 'teaching';
  tutorId: string;
  onSignOut: () => void;
}

export const ManageAccountModal: React.FC<ManageAccountModalProps> = ({
  isOpen,
  onClose,
  userAccount,
  onUpdateInstitution,
  initialTab = 'profile',
  tutorId,
  onSignOut,
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'sessions' | 'billing' | 'teaching'>(initialTab);

  // The modal stays mounted (it just returns null below) so state survives
  // between opens — reset to whichever tab the caller asked for each time
  // it's (re)opened, rather than only on first mount.
  useEffect(() => {
    if (isOpen) setActiveTab(initialTab);
  }, [isOpen, initialTab]);

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

              {/* Stats Grid — real (currently zero, no bookings backend yet) */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 text-center">
                  <div className="text-xl font-extrabold text-[#0F172A]">{userAccount.upcomingSessions}</div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase mt-1">
                    Upcoming
                  </div>
                </div>
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 text-center">
                  <div className="text-xl font-extrabold text-[#0F172A]">{userAccount.completedSessions}</div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase mt-1">
                    Completed
                  </div>
                </div>
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 text-center">
                  <div className="text-xl font-extrabold text-[#15803D]">{userAccount.savedTutorsCount}</div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase mt-1">
                    Saved Tutors
                  </div>
                </div>
              </div>

              {/* Settings list */}
              <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                <a href="#settings" onClick={(e) => e.preventDefault()} className="p-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-center space-x-3 text-xs font-bold text-[#0F172A]">
                    <Settings className="w-4 h-4 text-slate-500" />
                    <span>Notification Preferences</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </a>
                <a href="#security" onClick={(e) => e.preventDefault()} className="p-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-center space-x-3 text-xs font-bold text-[#0F172A]">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Academic Verification Badge</span>
                  </div>
                  <span className="text-[10px] font-bold bg-emerald-100 text-[#15803D] px-2 py-0.5 rounded-full">
                    Active
                  </span>
                </a>
              </div>

            </div>
          )}

          {activeTab === 'sessions' && <UpcomingSessionsPanel studentId={tutorId} />}

          {activeTab === 'billing' && (
            <div className="space-y-3">
              <div className="bg-white rounded-2xl p-4 border border-slate-200 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <CreditCard className="w-5 h-5 text-[#0F172A]" />
                  <div>
                    <div className="text-xs font-bold text-[#0F172A]">Visa ending in 4022</div>
                    <div className="text-[10px] text-slate-400 font-medium">Default Payment Method</div>
                  </div>
                </div>
                <span className="text-xs text-[#15803D] font-bold">Verified</span>
              </div>
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
