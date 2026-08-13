import React from 'react';
import { Calendar, FileText, Tag, User } from 'lucide-react';

interface SubHeaderBannerProps {
  onOpenActivity?: () => void;
  onOpenPromotions?: () => void;
  onOpenAccount?: () => void;
}

export const SubHeaderBanner: React.FC<SubHeaderBannerProps> = ({
  onOpenActivity,
  onOpenPromotions,
  onOpenAccount,
}) => {
  return (
    <section className="bg-[#0A192F] text-white border-b border-slate-800 py-3.5 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        
        {/* Left Side: Welcome back & Upcoming status */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-6">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
            Welcome back
          </h2>
          
          <div className="flex items-center text-xs sm:text-sm font-medium text-slate-300 bg-slate-800/60 px-3 py-1.5 rounded-full border border-slate-700/60">
            <Calendar className="w-4 h-4 mr-2 text-emerald-400 shrink-0" />
            <span>You have no upcoming sessions</span>
          </div>
        </div>

        {/* Right Side: Activity, Promotions, Account (Strictly NO pill button like Uber One) */}
        <div className="flex items-center space-x-6 text-sm font-semibold text-slate-200">
          
          {/* Activity */}
          <button
            onClick={onOpenActivity}
            className="flex items-center space-x-2 hover:text-white hover:underline transition-all cursor-pointer py-1"
          >
            <FileText className="w-4 h-4 text-emerald-400" />
            <span>Activity</span>
          </button>

          {/* Promotions */}
          <button
            onClick={onOpenPromotions}
            className="flex items-center space-x-2 hover:text-white hover:underline transition-all cursor-pointer py-1"
          >
            <Tag className="w-4 h-4 text-emerald-400" />
            <span>Promotions</span>
          </button>

          {/* Account */}
          <button
            onClick={onOpenAccount}
            className="flex items-center space-x-2 hover:text-white hover:underline transition-all cursor-pointer py-1"
          >
            <User className="w-4 h-4 text-emerald-400" />
            <span>Account</span>
          </button>

        </div>

      </div>
    </section>
  );
};
