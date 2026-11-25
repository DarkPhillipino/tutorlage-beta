import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { rememberPromoCode } from '../lib/promoCode';
import { pagePath, type PublicPageClient } from '../lib/publicTutorPage';
import { useNoIndex, usePublicTutor } from '../lib/publicTutorHooks';
import { AccountGate } from '../components/AccountGate';
import { LinkSignIn } from '../components/LinkSignIn';
import { LINK_CARD, LinkShell, TutorHero } from '../components/LinkShell';
import { TutorBookingPage } from '../components/TutorBookingPage';
import { TutorPageMissing } from '../components/TutorPageMissing';
import { PageLoading } from '../components/PageLoading';

// /t/CODE/book (PM line 79 C and D, 25 Nov 2026): signed out, the sign-in card; signed in, the date of birth and Terms gate if the account still needs it, then the booking page of THIS tutor.
// No home page and no banner comes between.
export default function TutorBook() {
  const { code = '' } = useParams();
  const { session, loading } = useAuth();
  const page = usePublicTutor(supabase as unknown as PublicPageClient, code);
  useNoIndex();

  const tutorCode = page?.code ?? '';
  // A new account made from here (Google included) carries the tutor's code, as a code link does.
  useEffect(() => {
    if (tutorCode && !loading && !session) rememberPromoCode(tutorCode);
  }, [tutorCode, loading, session]);

  useEffect(() => {
    if (page) document.title = `Book with ${page.firstName} | Tutorlage`;
  }, [page]);

  if (loading || page === undefined) return <PageLoading />;
  if (page === null) return <TutorPageMissing />;
  if (!session) return <LinkSignIn page={page} />;

  return (
    <AccountGate
      frame={(content) => (
        <LinkShell homeTo={pagePath(page.code)} hero={<TutorHero name={page.firstName} photo={page.photo} title={`Book with ${page.firstName}`} subtitle="Tutor on Tutorlage" />}>
          <section className={LINK_CARD}>{content}</section>
        </LinkShell>
      )}
    >
      <TutorBookingPage code={page.code} shown={page} />
    </AccountGate>
  );
}
