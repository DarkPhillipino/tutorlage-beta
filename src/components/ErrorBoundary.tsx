import React from 'react';
import { useLocation } from 'react-router-dom';
import { logClientError } from '../lib/errorLog';

// Release-gate check FE-ERRBOUND-01 (20 Oct 2026): before this, one thrown error while drawing any screen left a learner or tutor
// looking at a blank white page with no way back. This catches it and shows a plain message with a way out. It uses no translation,
// no auth and no Supabase on purpose: it has to work when any of those is what broke.

export const ErrorScreen: React.FC<{ onReload: () => void; homeHref: string }> = ({ onReload, homeHref }) => (
  <div role="alert" className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-4">
    <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 sm:p-8 text-center">
      <h1 className="text-xl font-extrabold text-[#0F172A] tracking-tight">Something went wrong</h1>
      <p className="text-sm text-slate-600 mt-2 leading-relaxed">
        This page hit a problem and could not be shown. Reload the page to try again. If it keeps happening, please tell us.
      </p>
      <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
        <button
          type="button"
          onClick={onReload}
          className="px-5 py-3 rounded-xl bg-[#15803D] hover:bg-[#166534] text-white text-sm font-bold cursor-pointer"
        >
          Reload the page
        </button>
        <a
          href={homeHref}
          className="px-5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#0F172A] text-sm font-bold"
        >
          Go to the start
        </a>
      </div>
    </div>
  </div>
);

interface BoundaryProps {
  children: React.ReactNode;
  // When this changes (the learner moved to another page) the boundary tries drawing again.
  resetKey?: string;
  homeHref?: string;
}

interface BoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Screen crashed:', error, info.componentStack);
    // Release gate OPS-ERRORS-01: also leave a cleaned, rate-limited record in our own database (src/lib/errorLog.ts never throws).
    logClientError(error, 'render', { componentStack: info.componentStack });
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return <ErrorScreen onReload={() => window.location.reload()} homeHref={this.props.homeHref ?? '/'} />;
    }
    return this.props.children;
  }
}

// Used once, inside the router: a crash on one page clears when the person goes to another.
export const AppErrorBoundary: React.FC<{ children: React.ReactNode; homeHref?: string }> = ({ children, homeHref }) => {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname} homeHref={homeHref}>
      {children}
    </ErrorBoundary>
  );
};
