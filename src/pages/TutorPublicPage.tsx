import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Clock, GraduationCap, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import {
  PUBLIC_PAGE_COPY as COPY, bookLink, countPageEvent, fetchPublicPage, gradesInWords, priceLine, type PublicPageClient, type PublicTutorPage,
} from '../lib/publicTutorPage';

// A tutor's own public page, /t/CODE (CEO, 24 Nov 2026; job P slice 1). Public: no sign-in. It is NEVER indexed by search engines: this page says noindex, nofollow itself, the static 404 page the host serves
// for this address says noindex, robots.txt disallows /t/ and the sitemap has no /t/ entry. The same plain page answers "no" for an unknown code, a tutor who has not made her page public and a tutor who
// switched it off (the database gives one empty answer for all three). The Book button is the same sign-up link her code link has always been; the sign-up flow itself is not touched.
export default function TutorPublicPage({ client = supabase as unknown as PublicPageClient }: { client?: PublicPageClient }) {
  const { code = '' } = useParams();
  const [page, setPage] = useState<PublicTutorPage | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setPage(undefined);
    fetchPublicPage(client, code).then((p) => {
      if (live) setPage(p);
      if (live && p) void countPageEvent(client, code, 'page_open');
    });
    return () => {
      live = false;
    };
  }, [client, code]);

  // noindex, nofollow: set on the robots line the page already has (the host's 404 copy carries one), or add one
  useEffect(() => {
    const existing = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    const before = existing?.content ?? null;
    const meta = existing ?? Object.assign(document.createElement('meta'), { name: 'robots' });
    meta.content = 'noindex,nofollow';
    if (!existing) document.head.appendChild(meta);
    return () => {
      if (existing && before !== null) existing.content = before;
      else if (!existing) meta.remove();
    };
  }, []);

  useEffect(() => {
    if (page === undefined) return;
    document.title = page ? `${page.firstName} | Tutor on Tutorlage` : 'Page not available | Tutorlage';
  }, [page]);

  if (page === undefined) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-6" aria-busy="true">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" aria-label="Loading" />
      </main>
    );
  }

  if (page === null) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-6">
        <div className="w-full max-w-md text-center">
          <div className="text-2xl font-extrabold tracking-tight text-[#0F172A] mb-6">Tutorlage</div>
          <h1 className="font-serif text-3xl text-[#0F172A] leading-tight mb-3">{COPY.notFound}</h1>
          <p className="text-sm text-slate-600 leading-relaxed mb-8">{COPY.notFoundMore}</p>
          <Link to="/" className="px-5 py-3 rounded-xl bg-[#15803D] hover:bg-[#166534] text-white font-bold text-sm">Go to the start page</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FAF7F2] px-4 py-8" data-testid="tutor-public-page">
      <div className="mx-auto w-full max-w-xl space-y-4">
        <Link to="/" className="text-2xl font-extrabold tracking-tight text-[#0F172A]">Tutorlage</Link>

        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center gap-4">
            {page.photo && <img src={page.photo} alt={`${page.firstName}, tutor on Tutorlage`} width={96} height={96} className="w-24 h-24 rounded-full object-cover shrink-0" data-testid="tutor-photo" />}
            <div>
              <h1 className="font-serif text-3xl text-[#0F172A] leading-tight">{page.firstName}</h1>
              <p className="text-sm text-slate-600 mt-1">Tutor on Tutorlage</p>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><GraduationCap className="w-3.5 h-3.5" aria-hidden="true" />{COPY.subjectsHeading}</h2>
          {page.subjects.length > 0 ? (
            <ul className="space-y-1">
              {page.subjects.map((s) => (
                <li key={`${s.subject}/${s.minGrade}/${s.maxGrade}`} className="text-sm text-[#0F172A]"><span className="font-bold">{s.subject}</span>, {gradesInWords(s.minGrade, s.maxGrade)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">Her subjects are being approved.</p>
          )}
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">{COPY.levelHeading}</h2>
          <p className="text-sm text-[#0F172A]"><span className="font-bold">{page.levelName}</span> (level {page.levelId}), {priceLine(page)}</p>
        </section>

        {page.checked.length > 0 && (
          <section className="bg-white rounded-2xl border border-slate-200 p-5">
            <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">{COPY.checkedHeading}</h2>
            <ul className="space-y-1">
              {page.checked.map((line) => (
                <li key={line} className="flex items-start gap-1.5 text-sm text-[#0F172A]"><CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-[#15803D]" aria-hidden="true" />{line}</li>
              ))}
            </ul>
            <p className="text-[11px] text-slate-500 mt-2">{COPY.checkedNote}</p>
          </section>
        )}

        {page.hours && (
          <section className="bg-white rounded-2xl border border-slate-200 p-5">
            <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" aria-hidden="true" />{COPY.hoursHeading}</h2>
            <p className="text-sm text-[#0F172A]">{page.hours}</p>
            <p className="text-[11px] text-slate-500 mt-1">South African time. These are her weekly hours; a time inside them is booked when you send your request.</p>
          </section>
        )}

        <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-2">
          <a
            href={bookLink(page.code)}
            onClick={(e) => {
              // count the tap, then go on (at most 0.7 seconds is spent waiting for the count)
              e.preventDefault();
              const go = bookLink(page.code);
              void Promise.race([countPageEvent(client, page.code, 'book_tap'), new Promise((r) => setTimeout(r, 700))]).then(() => window.location.assign(go));
            }}
            className="block w-full text-center bg-[#15803D] hover:bg-[#166534] text-white font-bold text-sm px-5 py-3 rounded-xl"
          >
            {COPY.book}
          </a>
          <p className="text-[11px] text-slate-600">{COPY.bookNote}</p>
          <p className="text-[11px] text-slate-600">{page.takingRequests ? COPY.otherTutorNote : COPY.notTaking}</p>
        </section>
      </div>
    </main>
  );
}
