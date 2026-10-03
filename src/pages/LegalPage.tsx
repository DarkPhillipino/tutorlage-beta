import React from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';

// Public (not behind sign-in) so anyone can read the terms before signing up.
//
// The documents themselves are still drafts under attorney review
// (Drake/legal/drafts/*.md, v2). Publishing unreviewed text — full of review
// flags — would be worse than saying plainly that they're being finalised, so
// until the attorney signs off each page says exactly that. When a document is
// final, render it here in place of the notice.
const DOCUMENTS = {
  terms: { title: 'Terms of Service' },
  privacy: { title: 'Privacy Policy' },
  refunds: { title: 'Refund Policy' },
} as const;

export type LegalDocument = keyof typeof DOCUMENTS;

export default function LegalPage({ document }: { document: LegalDocument }) {
  const { title } = DOCUMENTS[document];

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-4 py-12">
      <div className="max-w-lg w-full bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80">
        <div className="w-12 h-12 rounded-xl bg-emerald-100 text-[#15803D] flex items-center justify-center mb-4">
          <FileText className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-extrabold text-[#0F172A] tracking-tight mb-2">{title}</h1>
        <p className="text-sm text-slate-600 leading-relaxed mb-6">
          Our {title} is being finalised with our attorney. It will be published on this page before
          Tutorlage opens to the public, and you'll be asked to accept it when you create an account.
        </p>
        <Link to="/" className="text-sm font-bold text-[#15803D] hover:underline">
          Back to Tutorlage
        </Link>
      </div>
    </div>
  );
}
