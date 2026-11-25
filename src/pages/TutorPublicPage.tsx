import React, { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Clock, GraduationCap, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { PUBLIC_PAGE_COPY as COPY, bookPath, countPageEvent, gradesInWords, type PublicPageClient } from '../lib/publicTutorPage';
import { useNoIndex, usePublicTutor } from '../lib/publicTutorHooks';
import { LINK_BUTTON, LINK_CARD, LINK_HEADING, LinkShell, TutorHero } from '../components/LinkShell';
import { TutorLevelCard } from '../components/TutorLevelCard';
import { TutorPageMissing } from '../components/TutorPageMissing';

// A tutor's own public page, /t/CODE (CEO, 24 Nov 2026; job P slice 1; reworked 25 Nov 2026, PM line 79). Public: no sign-in. It is NEVER indexed by search engines: this page says noindex, nofollow itself, the
// static 404 page the host serves for this address says noindex, robots.txt disallows /t/ and the sitemap has no /t/ entry. The same plain page answers "no" for an unknown code, a tutor who has not made the
// page public and a tutor who switched it off (the database gives one empty answer for all three). The Book button goes to booking THIS tutor (/t/CODE/book), never to the start page.
export default function TutorPublicPage({ client = supabase as unknown as PublicPageClient }: { client?: PublicPageClient }) {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const page = usePublicTutor(client, code);
  useNoIndex();

  const shown = page?.code ?? null;
  useEffect(() => {
    if (shown) void countPageEvent(client, code, 'page_open');
  }, [client, code, shown]);

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

  if (page === null) return <TutorPageMissing />;

  return (
    <div data-testid="tutor-public-page">
      <LinkShell homeTo="/" hero={<TutorHero name={page.firstName} photo={page.photo} title={page.firstName} subtitle="Tutor on Tutorlage" />}>
        <section className={LINK_CARD}>
          <h2 className={LINK_HEADING}><GraduationCap className="w-3.5 h-3.5" aria-hidden="true" />{COPY.subjectsHeading}</h2>
          {page.subjects.length > 0 ? (
            <ul className="space-y-1">
              {page.subjects.map((s) => (
                <li key={`${s.subject}/${s.minGrade}/${s.maxGrade}`} className="text-sm"><span className="font-bold">{s.subject}</span>, {gradesInWords(s.minGrade, s.maxGrade)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">{COPY.subjectsPending}</p>
          )}
        </section>

        <TutorLevelCard page={page} />

        {page.hours && (
          <section className={LINK_CARD}>
            <h2 className={LINK_HEADING}><Clock className="w-3.5 h-3.5" aria-hidden="true" />{COPY.hoursHeading}</h2>
            <p className="text-sm">{page.hours}</p>
            <p className="text-xs text-slate-600 mt-1">{COPY.hoursNote(page.firstName)}</p>
          </section>
        )}

        <section className={`${LINK_CARD} space-y-2`}>
          <Link
            to={bookPath(page.code)}
            onClick={(e) => {
              // count the tap, then go on (at most 0.7 seconds is spent waiting for the count)
              e.preventDefault();
              const go = bookPath(page.code);
              void Promise.race([countPageEvent(client, page.code, 'book_tap'), new Promise((r) => setTimeout(r, 700))]).then(() => navigate(go));
            }}
            className={LINK_BUTTON}
          >
            {COPY.book}
          </Link>
          <p className="text-xs text-slate-600">{page.takingRequests ? COPY.bookNote(page.firstName) : COPY.notTaking(page.firstName)}</p>
          {page.discount && <p className="text-xs text-slate-600" data-discount>{COPY.discountNote(page.discount.percent, page.discount.lessons)}</p>}
        </section>
      </LinkShell>
    </div>
  );
}
