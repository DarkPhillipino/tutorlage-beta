import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Circle,
  FileText,
  Info,
  Link2,
  Loader2,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { getErrorMessage } from '../lib/errors';
import { prepareFileForUpload } from '../lib/imageShrink';
import {
  ONBOARDING_CONSENT_VERSION,
  ONBOARDING_COPY,
  POLICE_MAX_AGE_MONTHS,
  TRACK_COPY,
  type Requirement,
  type RequirementKey,
  type TutorTrack,
  addMonthsIso,
  fileProblem,
  isOnboardingComplete,
  linkProblem,
  normaliseLink,
  policeCertificateProblem,
  policeExpiresOn,
  requirementStatuses,
  todayIsoSAST,
} from '../lib/tutorOnboarding';
import {
  type OnboardingDocument,
  type OnboardingRow,
  addLinkDocument,
  recordConsent,
  removeDocument,
  uploadDocument,
} from '../lib/tutorOnboardingData';

// Master 7cx: the tutor's third sign-up page. What it asks for depends on the kind of tutor chosen on page 2
// (src/lib/tutorOnboarding.ts holds the rules and the wording; this file only shows them).

const STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting for review',
  under_review: 'Being reviewed',
  verified: 'Approved',
  rejected: 'Not accepted',
};

const inputClass =
  'w-full bg-slate-100 text-[#0F172A] placeholder-slate-400 text-sm font-semibold px-4 py-3 rounded-xl border border-transparent focus:outline-none focus:border-[#15803D] focus:bg-white focus:ring-2 focus:ring-[#15803D]/20 transition-all';

const hostOf = (link: string) => {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return link;
  }
};

const formatDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

interface TutorDocumentsPageProps {
  tutorId: string;
  track: TutorTrack;
  onboarding: OnboardingRow;
  documents: OnboardingDocument[];
  reload: () => Promise<void> | void;
  onChangeType: () => void;
  onDone: () => void;
  onSkip?: () => void;
  onSignOut: () => void;
}

export const TutorDocumentsPage: React.FC<TutorDocumentsPageProps> = ({
  tutorId,
  track,
  onboarding,
  documents,
  reload,
  onChangeType,
  onDone,
  onSkip,
  onSignOut,
}) => {
  const today = todayIsoSAST();
  const oldestPolice = addMonthsIso(today, -POLICE_MAX_AGE_MONTHS)!;
  const consented = !!onboarding.consentedAt;
  const statuses = requirementStatuses(track, documents, today);
  const requiredStatuses = statuses.filter((s) => s.requirement.required);
  const doneCount = requiredStatuses.filter((s) => s.done).length;
  const complete = isOnboardingComplete(track, documents, consented, today);

  const [consentSaving, setConsentSaving] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<RequirementKey | null>(null);
  const [errors, setErrors] = useState<Partial<Record<RequirementKey, string>>>({});
  const [issuedOn, setIssuedOn] = useState('');
  const [linkText, setLinkText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const isTouchDevice = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

  const setError = (key: RequirementKey, message: string | null) =>
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });

  const handleConsent = async (checked: boolean) => {
    if (!checked || consented || consentSaving) return;
    setGeneralError(null);
    setConsentSaving(true);
    try {
      await recordConsent(supabase, ONBOARDING_CONSENT_VERSION);
      await reload();
    } catch (e) {
      setGeneralError(getErrorMessage(e, 'We could not record your agreement. Please try again.'));
    } finally {
      setConsentSaving(false);
    }
  };

  const handleFile = async (req: Requirement, file: File) => {
    setError(req.key, null);
    if (req.needsIssueDate) {
      const problem = policeCertificateProblem(issuedOn, today);
      if (problem) {
        setError(req.key, problem);
        return;
      }
    }
    setBusyKey(req.key);
    try {
      const prepared = await prepareFileForUpload(file);
      const problem = fileProblem(prepared);
      if (problem) throw new Error(problem);
      await uploadDocument(supabase, tutorId, req.documentType, prepared, req.needsIssueDate ? issuedOn : null);
      if (req.needsIssueDate) setIssuedOn('');
      await reload();
    } catch (e) {
      setError(req.key, getErrorMessage(e, 'The upload did not work. Please try again.'));
    } finally {
      setBusyKey(null);
      const input = fileInputs.current[req.key];
      if (input) input.value = '';
    }
  };

  const handleAddLink = async (req: Requirement) => {
    setError(req.key, null);
    const problem = linkProblem(linkText);
    if (problem) {
      setError(req.key, problem);
      return;
    }
    setBusyKey(req.key);
    try {
      await addLinkDocument(supabase, tutorId, normaliseLink(linkText));
      setLinkText('');
      await reload();
    } catch (e) {
      setError(req.key, getErrorMessage(e, 'We could not save that link. Please try again.'));
    } finally {
      setBusyKey(null);
    }
  };

  const handleRemove = async (req: Requirement, doc: OnboardingDocument) => {
    setError(req.key, null);
    setBusyKey(req.key);
    try {
      await removeDocument(supabase, tutorId, doc);
      await reload();
    } catch (e) {
      setError(req.key, getErrorMessage(e, 'We could not remove that document. Please try again.'));
    } finally {
      setBusyKey(null);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-6 py-12">
        <div className="w-full max-w-md bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80 text-center">
          <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center text-[#15803D] mx-auto mb-4">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <h1 className="font-serif text-2xl text-[#0F172A] mb-2">Documents received</h1>
          <p className="text-sm text-slate-500 mb-6">{ONBOARDING_COPY.submitted}</p>
          <button
            type="button"
            onClick={onDone}
            className="w-full bg-[#15803D] hover:bg-[#166534] text-white font-bold py-3.5 px-6 rounded-xl transition-all text-sm cursor-pointer"
          >
            Continue to Tutorlage
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF7F2] px-4 sm:px-6 py-10">
      <div className="w-full max-w-xl mx-auto bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-slate-200/80">
        <p className="text-xs font-bold text-[#15803D] uppercase tracking-wider mb-2">Step 3 of 3 · Tutor sign-up</p>
        <h1 className="font-serif text-3xl text-[#0F172A] mb-1">{ONBOARDING_COPY.documentsTitle}</h1>
        <p className="text-sm text-slate-500 mb-3">
          You chose <span className="font-bold text-[#0F172A]">{TRACK_COPY[track].title}</span>.{' '}
          <button type="button" onClick={onChangeType} className="font-bold text-[#15803D] hover:underline cursor-pointer">
            Change
          </button>
        </p>
        <p className="text-xs text-slate-600 leading-relaxed bg-sky-50 border border-sky-200 rounded-xl px-4 py-3 mb-5">{ONBOARDING_COPY.levelNote}</p>

        {/* Why the ID is kept, and the agreement. Nothing can be uploaded before it is ticked. */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-4 mb-4">
          <div className="flex items-center space-x-2 mb-1.5">
            <ShieldCheck className="w-4 h-4 text-[#15803D] shrink-0" />
            <h2 className="text-sm font-bold text-[#0F172A]">{ONBOARDING_COPY.whyIdTitle}</h2>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">{ONBOARDING_COPY.whyId}</p>
        </div>

        <label className={`flex items-start space-x-2.5 text-sm text-slate-700 mb-5 ${consented ? '' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={consented}
            disabled={consented || consentSaving}
            onChange={(e) => handleConsent(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-[#15803D] shrink-0"
          />
          <span className="leading-snug">
            {ONBOARDING_COPY.consent}
            {consentSaving && <Loader2 className="inline w-3.5 h-3.5 animate-spin ml-1.5 align-text-bottom" />}
          </span>
        </label>

        {generalError && (
          <div role="alert" className="mb-4 flex items-start space-x-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-semibold text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{generalError}</span>
          </div>
        )}
        {!consented && (
          <p className="text-xs font-semibold text-amber-700 mb-4 flex items-start space-x-1.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{ONBOARDING_COPY.consentNeeded}</span>
          </p>
        )}

        <div className="space-y-4">
          {statuses.map(({ requirement: req, done, problem }) => {
            const mine = documents.filter((d) => d.documentType === req.documentType);
            const busy = busyKey === req.key;
            const disabled = !consented || busy;
            const dateProblem = req.needsIssueDate && issuedOn ? policeCertificateProblem(issuedOn, today) : null;
            return (
              <section
                key={req.key}
                aria-label={req.title}
                className={`rounded-2xl border p-4 ${done ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'} ${consented ? '' : 'opacity-60'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start space-x-2.5 min-w-0">
                    {done ? <CheckCircle2 className="w-5 h-5 text-[#15803D] shrink-0 mt-0.5" /> : <Circle className="w-5 h-5 text-slate-300 shrink-0 mt-0.5" />}
                    <h3 className="text-sm font-bold text-[#0F172A] leading-snug">{req.title}</h3>
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${req.required ? 'bg-slate-100 text-slate-600' : 'bg-sky-50 text-sky-700'}`}>
                    {req.required ? 'Required' : 'Optional'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed mt-1.5 ml-7">{req.help}</p>

                {mine.length > 0 && (
                  <ul className="mt-3 ml-7 space-y-2">
                    {mine.map((doc) => {
                      const expires = doc.issuedOn ? policeExpiresOn(doc.issuedOn) : null;
                      const stale = req.needsIssueDate && doc.issuedOn ? policeCertificateProblem(doc.issuedOn, today) !== null : false;
                      return (
                        <li key={doc.id} className="flex items-start justify-between gap-2 text-xs bg-white border border-slate-200 rounded-xl px-3 py-2">
                          <div className="min-w-0">
                            <div className="flex items-center space-x-1.5 font-semibold text-[#0F172A] truncate">
                              {doc.isLink ? <Link2 className="w-3.5 h-3.5 shrink-0 text-slate-400" /> : <FileText className="w-3.5 h-3.5 shrink-0 text-slate-400" />}
                              <span className="truncate">{doc.isLink ? hostOf(doc.documentUrl) : 'File uploaded'}</span>
                            </div>
                            {doc.issuedOn && (
                              <div className={`mt-0.5 ${stale ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>
                                Issued {formatDay(doc.issuedOn)}
                                {expires ? (stale ? ` · over ${POLICE_MAX_AGE_MONTHS} months old, add a newer one` : ` · counts until ${formatDay(expires)}`) : ''}
                              </div>
                            )}
                            <div className={`mt-0.5 font-semibold ${doc.status === 'verified' ? 'text-[#15803D]' : doc.status === 'rejected' ? 'text-rose-600' : 'text-slate-500'}`}>
                              {STATUS_LABELS[doc.status ?? 'pending'] ?? doc.status}
                              {doc.status === 'rejected' && doc.adminNotes ? `: ${doc.adminNotes}` : ''}
                            </div>
                          </div>
                          {doc.status !== 'verified' && (
                            <button
                              type="button"
                              onClick={() => handleRemove(req, doc)}
                              disabled={busy}
                              aria-label={`Remove ${req.title}`}
                              className="p-2 -m-1 rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 cursor-pointer shrink-0"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {problem && (
                  <p role="alert" className="mt-2 ml-7 text-xs font-semibold text-rose-600">
                    {problem}
                  </p>
                )}

                <div className="mt-3 ml-7 space-y-2">
                  {req.needsIssueDate && (
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor={`issued-${req.key}`}>
                        Date issued (printed on the certificate)
                      </label>
                      <input
                        id={`issued-${req.key}`}
                        type="date"
                        value={issuedOn}
                        min={oldestPolice}
                        max={today}
                        disabled={disabled}
                        onChange={(e) => {
                          setIssuedOn(e.target.value);
                          setError(req.key, null);
                        }}
                        className={inputClass}
                      />
                      <p className={`text-[11px] mt-1 ${dateProblem ? 'text-rose-600 font-semibold' : 'text-slate-400'}`}>
                        {dateProblem ?? `Must be on or after ${formatDay(oldestPolice)} (issued in the last ${POLICE_MAX_AGE_MONTHS} months).`}
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={(el) => {
                        fileInputs.current[req.key] = el;
                      }}
                      id={`file-${req.key}`}
                      type="file"
                      accept="application/pdf,image/*"
                      className="hidden"
                      disabled={disabled}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFile(req, file);
                      }}
                    />
                    <button
                      type="button"
                      disabled={disabled || (req.needsIssueDate && !!policeCertificateProblem(issuedOn, today))}
                      onClick={() => document.getElementById(`file-${req.key}`)?.click()}
                      className="flex items-center justify-center gap-1.5 bg-[#0F172A] hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold px-4 py-3 rounded-xl cursor-pointer"
                    >
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      {mine.length > 0 ? 'Add another file' : 'Choose a file'}
                    </button>
                    {isTouchDevice && (
                      <>
                        <input
                          id={`camera-${req.key}`}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          disabled={disabled}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFile(req, file);
                            e.target.value = '';
                          }}
                        />
                        <button
                          type="button"
                          disabled={disabled || (req.needsIssueDate && !!policeCertificateProblem(issuedOn, today))}
                          onClick={() => document.getElementById(`camera-${req.key}`)?.click()}
                          className="flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-[#0F172A] text-xs font-bold px-4 py-3 rounded-xl cursor-pointer"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          Take a photo
                        </button>
                      </>
                    )}
                  </div>

                  {req.accepts === 'file-or-link' && (
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor={`link-${req.key}`}>
                        Or paste a link
                      </label>
                      <div className="flex gap-2">
                        <input
                          id={`link-${req.key}`}
                          type="url"
                          inputMode="url"
                          value={linkText}
                          disabled={disabled}
                          onChange={(e) => {
                            setLinkText(e.target.value);
                            setError(req.key, null);
                          }}
                          placeholder="https://"
                          className={inputClass}
                        />
                        <button
                          type="button"
                          onClick={() => handleAddLink(req)}
                          disabled={disabled || !linkText.trim()}
                          className="shrink-0 flex items-center gap-1.5 bg-[#0F172A] hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold px-4 rounded-xl cursor-pointer"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                          Add link
                        </button>
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] text-slate-400">PDF, JPG or PNG. Photos are made smaller automatically.</p>

                  {errors[req.key] && (
                    <div role="alert" className="flex items-start gap-1.5 text-xs text-rose-600 font-semibold">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{errors[req.key]}</span>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <div className="mt-6 border-t border-slate-100 pt-5">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 mb-2">
            <span>
              {doneCount} of {requiredStatuses.length} required documents added
            </span>
            {!consented && <span className="text-amber-700">Agreement needed</span>}
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-4" aria-hidden="true">
            <div className="h-full bg-[#15803D] transition-all" style={{ width: `${(doneCount / Math.max(1, requiredStatuses.length)) * 100}%` }} />
          </div>
          <button
            type="button"
            onClick={() => setSubmitted(true)}
            disabled={!complete}
            className="w-full bg-[#15803D] hover:bg-[#166534] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3.5 px-6 rounded-xl transition-all text-sm cursor-pointer"
          >
            Submit my documents
          </button>
          {!complete && <p className="text-[11px] text-slate-400 mt-2 text-center">{ONBOARDING_COPY.notApprovedYet}</p>}
          {onSkip && (
            <button type="button" onClick={onSkip} className="w-full mt-3 text-xs font-bold text-slate-500 hover:text-slate-700 cursor-pointer">
              I will finish this later
            </button>
          )}
          <button type="button" onClick={onSignOut} className="w-full mt-2 text-xs font-bold text-slate-400 hover:text-slate-600 cursor-pointer">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};
