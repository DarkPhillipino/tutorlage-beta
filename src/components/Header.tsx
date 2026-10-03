import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, ChevronDown, User, HelpCircle } from 'lucide-react';
import { SUPPORTED_LANGUAGES } from '../lib/i18n';
import { NotificationsBell } from './NotificationsBell';

interface HeaderProps {
  onOpenManageAccount: () => void;
  activeNav: string;
  setActiveNav: (nav: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenManageAccount, activeNav, setActiveNav }) => {
  const { t, i18n } = useTranslation();
  const [showAboutDropdown, setShowAboutDropdown] = useState(false);
  const [showLangDropdown, setShowLangDropdown] = useState(false);

  // Schools and Resources are hidden until further notice — kept in the
  // data so they're one flag away from coming back, not deleted outright.
  const mainLinks = [
    { name: t('nav.learn'), id: 'learn', hidden: false },
    { name: t('nav.teach'), id: 'teach', hidden: false },
    { name: t('nav.schools'), id: 'schools', hidden: true },
    { name: t('nav.resources'), id: 'resources', hidden: true },
  ].filter((link) => !link.hidden);

  // Only entries with a real destination. "Verified Educators" (which claimed
  // certification that doesn't exist), "Careers" and "Press & Impact" had no
  // pages behind them and were removed (backlog item 3).
  const aboutLinks = [
    { id: 'about', title: t('about.aboutTutorlage'), desc: 'What we do and how matching works' },
  ];

  const currentLanguage = SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) ?? SUPPORTED_LANGUAGES[0];

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">

          {/* Left Side: Brand Logo & Navigation Links */}
          <div className="flex items-center space-x-8">
            {/* Logo */}
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); setActiveNav('learn'); }}
              className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0F172A] hover:text-[#15803D] transition-colors"
            >
              Tutorlage
            </a>

            {/* Desktop Left Nav Items */}
            <nav className="hidden md:flex items-center space-x-1">
              {mainLinks.map((link) => (
                <button
                  key={link.id}
                  onClick={() => setActiveNav(link.id)}
                  className={`px-3 py-2 rounded-full text-sm font-semibold transition-colors ${
                    activeNav === link.id
                      ? 'bg-[#0F172A] text-white'
                      : 'text-[#0F172A] hover:bg-slate-100'
                  }`}
                >
                  {link.name}
                </button>
              ))}

              {/* About with Dropdown Arrow */}
              <div className="relative">
                <button
                  onClick={() => setShowAboutDropdown(!showAboutDropdown)}
                  onBlur={() => setTimeout(() => setShowAboutDropdown(false), 200)}
                  className="px-3 py-2 rounded-full text-sm font-semibold text-[#0F172A] hover:bg-slate-100 flex items-center space-x-1.5 transition-colors"
                >
                  <span>{t('nav.about')}</span>
                  <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showAboutDropdown ? 'rotate-180' : ''}`} />
                </button>

                {/* About Dropdown Menu */}
                {showAboutDropdown && (
                  <div className="absolute left-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                    {aboutLinks.map((item) => (
                      <a
                        key={item.id}
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setShowAboutDropdown(false);
                          if (item.id === 'about') setActiveNav('about');
                        }}
                        className="block px-4 py-2.5 hover:bg-slate-50 transition-colors"
                      >
                        <div className="text-sm font-bold text-[#0F172A]">{item.title}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{item.desc}</div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </nav>
          </div>

          {/* Right Side: Utility Navigation */}
          <div className="flex items-center space-x-2 sm:space-x-3">

            {/* Language Selector — hidden 2026-09-09 per CEO request (not deleted; a
                reinstatement suggestion was logged to the PM's game plan under app
                features). Restore by uncommenting this block. */}
            {false && (
            <div className="relative">
              <button
                onClick={() => setShowLangDropdown(!showLangDropdown)}
                onBlur={() => setTimeout(() => setShowLangDropdown(false), 200)}
                className="px-2.5 py-1.5 rounded-full text-sm font-semibold text-[#0F172A] hover:bg-slate-100 flex items-center space-x-1.5 transition-colors"
                aria-label="Select Language"
              >
                <Globe className="w-4 h-4 text-[#0F172A]" />
                <span className="hidden sm:inline">{currentLanguage.code.toUpperCase()}</span>
              </button>

              {showLangDropdown && (
                <div className="absolute right-0 mt-2 w-40 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50">
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => { i18n.changeLanguage(lang.code); setShowLangDropdown(false); }}
                      className={`w-full text-left px-4 py-2 text-xs font-semibold hover:bg-slate-100 ${
                        lang.code === i18n.language ? 'text-[#15803D]' : 'text-[#0F172A]'
                      }`}
                    >
                      {lang.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}

            {/* Help Button — hidden 2026-09-09 per CEO request (not deleted; a
                reinstatement suggestion was logged to the PM's game plan under app
                features). Restore by uncommenting this block. */}
            {false && (
            <a
              href="#help"
              onClick={(e) => { e.preventDefault(); alert("Tutorlage Support: How can we assist you today?"); }}
              className="px-3 py-1.5 rounded-full text-sm font-semibold text-[#0F172A] hover:bg-slate-100 flex items-center space-x-1.5 transition-colors shrink-0"
            >
              <HelpCircle className="w-4 h-4 text-[#0F172A] sm:hidden" />
              <span className="hidden sm:inline">{t('help')}</span>
            </a>
            )}

            <NotificationsBell />

            {/* Manage Account Dropdown Pill Button */}
            <button
              onClick={onOpenManageAccount}
              className="px-3 sm:px-4 py-2 rounded-full text-sm font-bold bg-[#0F172A] text-white hover:bg-slate-800 transition-all flex items-center space-x-2 shadow-xs cursor-pointer shrink-0 whitespace-nowrap"
            >
              <User className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">{t('manageAccount')}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-300" />
            </button>

          </div>
        </div>

        {/* Mobile Navigation bar below header for small screens */}
        <div className="flex md:hidden items-center justify-around border-t border-slate-100 py-2 text-xs font-semibold text-[#0F172A]">
          {mainLinks.map((link) => (
            <button
              key={link.id}
              onClick={() => setActiveNav(link.id)}
              className={`px-3 py-1 rounded-full ${activeNav === link.id ? 'bg-[#0F172A] text-white' : 'text-slate-700'}`}
            >
              {link.name}
            </button>
          ))}
        </div>

      </div>
    </header>
  );
};
