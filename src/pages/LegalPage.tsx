import React from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { isBusinessInfoComplete } from '../lib/businessInfo';
import { MarkdownText } from '../lib/miniMarkdown';
import termsText from '../content/legal/terms.md?raw';
import privacyText from '../content/legal/privacy.md?raw';
import refundsText from '../content/legal/refunds.md?raw';

// The Terms of Service, Privacy Policy and Refund Policy. Public (not behind sign-in) so anyone can read them before
// signing up. The text lives in src/content/legal/*.md, one file each: edit it there, then raise LEGAL_VERSION and
// set current_terms_version and current_privacy_version on the database to the same value (the CEO's yes; publish the
// page first, confirm it is live, then change the two rows, never the rows first). Everyone is then asked to accept
// the new version the next time they sign in.
//
// One product (CEO, 16 Oct 2026): these replaced the "tester notice" (version 2026-10-phase1-c) on 16 Oct 2026.
export const LEGAL_VERSION = '2026-10-17';
const LAST_UPDATED = '17 October 2026';
// (17 Oct 2026: the "closed test" box that sat above the text was removed at the CEO's request. The closed-test data deletion
// promise stays in the Privacy Policy, §14, last row.)

const DOCUMENTS = {
  terms: { title: 'Terms of Service', text: termsText },
  privacy: { title: 'Privacy Policy', text: privacyText },
  refunds: { title: 'Refund Policy', text: refundsText },
} as const;

export type LegalDocument = keyof typeof DOCUMENTS;

export default function LegalPage({ document }: { document: LegalDocument }) {
  const { title, text } = DOCUMENTS[document];

  // The supplier's details (ECTA s 43) must be complete before any of this is shown: never publish placeholders.
  if (!isBusinessInfoComplete()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-4 py-12">
        <div className="max-w-lg w-full bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 text-[#15803D] flex items-center justify-center mb-4">
            <FileText className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-extrabold text-[#0F172A] tracking-tight mb-2">{title}</h1>
          <p className="text-sm text-slate-600 leading-relaxed mb-6">
            Our {title} is being finalised. It will be published on this page before Tutorlage opens to the public.
          </p>
          <Link to="/" className="text-sm font-bold text-[#15803D] hover:underline">
            Back to Tutorlage
          </Link>
        </div>
      </div>
    );
  }

  const others = (Object.keys(DOCUMENTS) as LegalDocument[]).filter((d) => d !== document);

  return (
    <div className="min-h-screen bg-[#FAF7F2] px-4 py-12">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-slate-200/80">
        <div className="w-12 h-12 rounded-xl bg-emerald-100 text-[#15803D] flex items-center justify-center mb-4">
          <FileText className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-extrabold text-[#0F172A] tracking-tight mb-1">Tutorlage {title}</h1>
        <p className="text-xs text-slate-400 mb-4">Version {LEGAL_VERSION} · Last updated {LAST_UPDATED}</p>

        <MarkdownText source={text} />

        <div className="mt-8 border-t border-slate-100 pt-4 text-xs text-slate-500">
          Also read:{' '}
          {others.map((d, i) => (
            <React.Fragment key={d}>
              {i > 0 && ' · '}
              <Link to={`/${d}`} className="font-bold text-[#15803D] hover:underline">{DOCUMENTS[d].title}</Link>
            </React.Fragment>
          ))}
        </div>

        <Link to="/" className="inline-block mt-4 text-sm font-bold text-[#15803D] hover:underline">
          Back to Tutorlage
        </Link>
      </div>
    </div>
  );
}
