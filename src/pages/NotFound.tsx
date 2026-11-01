import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { NOT_FOUND_META } from '../lib/pageMeta';

// What an address nobody built shows (release gate FE-SPA-ROUTING-01). Public: it needs no sign-in, so a mistyped link or an old
// bookmark gets a plain page with two ways on, never a blank screen or a silent bounce to the sign-in page.
export default function NotFound() {
  useEffect(() => {
    document.title = NOT_FOUND_META.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', NOT_FOUND_META.description);
    // Tell search engines not to keep it (the static 404 page the host serves already says so; this covers moving here in the app).
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    robots.dataset.notFound = 'true';
    document.head.appendChild(robots);
    return () => robots.remove();
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-6">
      <div className="w-full max-w-md text-center">
        <div className="text-2xl font-extrabold tracking-tight text-[#0F172A] mb-6">Tutorlage</div>
        <p className="uppercase tracking-[0.25em] text-[#15803D] text-xs mb-3 font-bold">Error 404</p>
        <h1 className="font-serif text-4xl text-[#0F172A] leading-tight mb-3">We can't find that page</h1>
        <p className="text-sm text-slate-600 leading-relaxed mb-8">
          The address may be mistyped, or the page may have moved. Nothing on your account has changed.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/"
            className="px-5 py-3 rounded-xl bg-[#15803D] hover:bg-[#166534] text-white font-bold text-sm"
          >
            Go to the start page
          </Link>
          <Link
            to="/login"
            className="px-5 py-3 rounded-xl border border-slate-300 bg-white hover:border-[#15803D] text-[#0F172A] font-bold text-sm"
          >
            Sign in or join
          </Link>
        </div>
      </div>
    </main>
  );
}
