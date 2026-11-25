import React from 'react';
import { Link } from 'react-router-dom';
import { PUBLIC_PAGE_COPY as COPY } from '../lib/publicTutorPage';
import { LINK_BUTTON, LINK_CARD, LinkShell } from './LinkShell';

// "This page is not available": an unknown code, a page that is off or switched off.
export function TutorPageMissing() {
  return (
    <LinkShell homeTo="/" hero={<h1 className="font-serif text-3xl leading-tight">{COPY.notFound}</h1>}>
      <section className={`${LINK_CARD} space-y-4`}>
        <p className="text-sm text-slate-600 leading-relaxed">{COPY.notFoundMore}</p>
        <Link to="/" className={LINK_BUTTON}>Go to the start page</Link>
      </section>
    </LinkShell>
  );
}
