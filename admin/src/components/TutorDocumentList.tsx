import React from 'react';
import { CheckCircle2, ExternalLink, Eye, XCircle } from 'lucide-react';
import type { VerificationDocument } from '../types';
import { DOC_LABELS } from '../lib/documentLabels';
import { documentCountSentence, fileKindLabel, positionInKind, sortDocumentsOldestFirst } from '../lib/documentViewing';
import { formatIsoLong, policeExpiresOn, todayIsoSAST } from '../lib/tutorOnboarding';

// Everything a tutor has sent, one line per row, oldest first: what it is ("Identity Document (1 of 2)"), the kind of file, when it was
// uploaded, its status, and the buttons to look at it and to mark it verified or rejected. The count line counts EVERY row, so an admin
// can see at a glance how many documents there are and which. Shown on a tutor's page (pages/TutorVerificationDetail.tsx).

const isLink = (doc: VerificationDocument) => /^https?:\/\//i.test(doc.documentUrl);
const hostOf = (link: string) => {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return link;
  }
};

interface TutorDocumentListProps {
  documents: VerificationDocument[];
  busyDocId: string | null;
  // A stored file: opens in the viewer window.
  onView: (docId: string) => void;
  // A web address the tutor gave (proof of experience): opens in the normal browser, recorded.
  onOpenLink: (url: string) => void;
  onReview: (docId: string, decision: 'verified' | 'rejected') => void;
}

export const TutorDocumentList: React.FC<TutorDocumentListProps> = ({ documents, busyDocId, onView, onOpenLink, onReview }) => {
  if (documents.length === 0) return <p className="text-xs text-slate-500">No documents uploaded yet.</p>;
  const sortedDocs = sortDocumentsOldestFirst(documents);
  const storedCount = sortedDocs.filter((d) => !isLink(d)).length;
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold text-slate-500">{documentCountSentence(sortedDocs.length, storedCount)}. Click a document to look at it here.</p>
      {sortedDocs.map((doc) => {
        const link = isLink(doc);
        const policeExpiry = doc.documentType === 'police_clearance' && doc.issuedOn ? policeExpiresOn(doc.issuedOn) : null;
        return (
          <div key={doc.id} className="p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => (link ? onOpenLink(doc.documentUrl) : onView(doc.id))}
                className="text-xs font-bold text-[#0F172A] hover:text-[#15803D] flex items-center gap-1 cursor-pointer"
              >
                {DOC_LABELS[doc.documentType] ?? doc.documentType}
                {positionInKind(sortedDocs, doc)}
                {link ? <ExternalLink className="w-3 h-3" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              <span className="block text-[11px] text-slate-500">
                {fileKindLabel(doc.documentUrl)}
                {doc.uploadedAt ? ` · uploaded ${new Date(doc.uploadedAt).toLocaleString('en-ZA')}` : ''}
              </span>
              {link && (
                <span className="block text-[11px] text-slate-500 truncate" title={doc.documentUrl}>
                  Link to {hostOf(doc.documentUrl)} (the tutor's own page: opens in your browser, treat with care)
                </span>
              )}
              {doc.issuedOn && (
                <span className="block text-[11px] text-slate-500">
                  Issued {formatIsoLong(doc.issuedOn)}
                  {policeExpiry ? ` · ${policeExpiry < todayIsoSAST() ? 'expired' : 'counts until'} ${formatIsoLong(policeExpiry)}` : ''}
                </span>
              )}
              <span className={`text-[10px] font-bold capitalize ${doc.status === 'verified' ? 'text-emerald-600' : doc.status === 'rejected' ? 'text-rose-600' : 'text-amber-600'}`}>
                {doc.status ?? 'pending'}
              </span>
              {doc.status === 'rejected' && doc.adminNotes && <span className="block text-[11px] text-rose-600">{doc.adminNotes}</span>}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => onReview(doc.id, 'verified')}
                disabled={busyDocId === doc.id || doc.status === 'verified'}
                className="p-1.5 rounded-full hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 disabled:opacity-40 cursor-pointer"
                aria-label="Mark document verified"
              >
                <CheckCircle2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => onReview(doc.id, 'rejected')}
                disabled={busyDocId === doc.id || doc.status === 'rejected'}
                className="p-1.5 rounded-full hover:bg-rose-50 text-slate-400 hover:text-rose-600 disabled:opacity-40 cursor-pointer"
                aria-label="Mark document rejected"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
