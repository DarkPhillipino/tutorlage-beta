import React, { useState } from 'react';
import { AlertCircle, Trash2 } from 'lucide-react';
import type { TutorLevelActions } from '../lib/levelActions';
import { getErrorMessage } from '../lib/errors';
import type { CredentialConfig, LevelConfig, TutorLevelInfo, VerificationDocument } from '../types';

// CEO, 17 Oct 2026: "admins should be able to assign tier roles from the admin app". On a tutor's page: the level they are at and
// why, the credentials recorded for them (each gives a starting level), and two ways to change it: record a credential after
// seeing the proof, or assign a level directly with a reason. Both go through admin-only database functions that write the audit
// log. A tutor's level is the higher of what they have earned on Tutorlage and the highest level their credentials give them; a
// tutor whose rates are frozen for a low rating does not move until the freeze lifts.

const selectClass =
  'w-full bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20';
const inputClass = selectClass;
const labelClass = 'block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1';
const buttonClass = 'bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-lg cursor-pointer';

const DOC_NAMES: Record<string, string> = {
  identity_doc: 'ID or passport',
  matric_certificate: 'Matric certificate',
  university_transcript: 'University transcript',
  police_clearance: 'Police clearance',
  proof_of_address: 'Proof of address',
  nrso_clearance: 'Sex offenders register clearance',
  child_protection_register_clearance: 'Child Protection Register clearance',
  teaching_qualification: 'Teaching qualification',
  sace_certificate: 'SACE registration',
  practicum_letter: 'Teaching practicum letter',
  marking_appointment_letter: 'Exam marking or moderation letter',
  subject_results: 'Subject results',
  proof_of_experience: 'Proof of experience',
};

interface BodyProps {
  tutorId: string;
  documents: VerificationDocument[];
  info: TutorLevelInfo;
  levels: LevelConfig[];
  definitions: CredentialConfig[];
  actions: TutorLevelActions;
  onChanged: () => void;
}

// The card once its data is in. The component at the bottom fetches the data; scripts/dev/levels-admin-test.ts renders this one directly.
export const TutorLevelCardBody: React.FC<BodyProps> = ({ tutorId, documents, info, levels, definitions, actions, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Record a credential
  const [code, setCode] = useState('');
  const [obtainedOn, setObtainedOn] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [note, setNote] = useState('');
  // Assign a level
  const [assignLevel, setAssignLevel] = useState('');
  const [assignReason, setAssignReason] = useState('');
  // Take something away
  const [removeReason, setRemoveReason] = useState('');

  const run = async (action: () => Promise<void>, after: () => void) => {
    setError(null);
    setBusy(true);
    try {
      await action();
      after();
      onChanged();
    } catch (e) {
      setError(getErrorMessage(e, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };

  const price = (id: string | null) => {
    const l = levels.find((x) => x.id === id);
    return l ? ` · R${l.price}/hr` : '';
  };
  const recordable = definitions.filter((d) => d.entrySubTier && d.code !== 'admin_assigned');
  const assigned = info.credentials.find((c) => c.code === 'admin_assigned');
  const chosenDefinition = recordable.find((d) => d.code === code);

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 mb-4" data-section="level">
      <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Level</h2>

      <p className="text-sm">
        <span className="text-slate-500">Level now: </span>
        <span className="font-bold text-[#0F172A]">{info.currentLevel ? `${info.currentLevel}${price(info.currentLevel)}` : 'not set'}</span>
      </p>
      <p className="text-xs text-slate-500 mt-1">
        Credentials give them a starting level of{' '}
        <span className="font-semibold text-[#0F172A]">{info.floorLevel ? `${info.floorLevel}${price(info.floorLevel)}` : 'none'}</span>. Their level is the higher of that and what
        they have earned on Tutorlage.
      </p>
      {info.frozen && (
        <p className="text-xs text-amber-700 font-semibold mt-2 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Their rates are frozen{info.freezeReason ? ` (${info.freezeReason})` : ''}. A level set here applies when the freeze lifts.</span>
        </p>
      )}

      <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-5 mb-2">Credentials recorded</h3>
      {info.credentials.length === 0 ? (
        <p className="text-xs text-slate-500">None.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {info.credentials.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 text-xs border border-slate-200 rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <div className="font-semibold text-[#0F172A]">{c.label}</div>
                  <div className="text-slate-500">
                    {c.level ? `Level ${c.level}${price(c.level)}` : 'No level'}
                    {c.obtainedOn ? ` · obtained ${c.obtainedOn}` : ''}
                    {c.status !== 'verified' ? ` · ${c.status}` : ''}
                  </div>
                  {c.note && <div className="text-slate-500">{c.note}</div>}
                </div>
                <button
                  type="button"
                  disabled={busy || !removeReason.trim()}
                  onClick={() => run(() => actions.removeTutorCredential(c.id, removeReason.trim()), () => setRemoveReason(''))}
                  title={removeReason.trim() ? 'Remove this credential' : 'Write the reason below first'}
                  aria-label={`Remove ${c.label}`}
                  className="p-1.5 rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
          <input
            value={removeReason}
            onChange={(e) => setRemoveReason(e.target.value)}
            placeholder="Reason for removing a credential (write it, then use the bin)"
            aria-label="Reason for removing a credential"
            className={`${inputClass} mt-2`}
          />
        </>
      )}

      <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-5 mb-2">Record a credential you have seen the proof for</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="block col-span-2">
          <span className={labelClass}>Credential</span>
          <select value={code} onChange={(e) => setCode(e.target.value)} className={selectClass} aria-label="Credential to record">
            <option value="">Choose a credential</option>
            {recordable.map((d) => (
              <option key={d.code} value={d.code}>
                {d.label} (level {d.entrySubTier})
              </option>
            ))}
          </select>
          {chosenDefinition?.description && <span className="block text-[10px] text-slate-400 mt-0.5">{chosenDefinition.description}</span>}
        </label>
        <label className="block">
          <span className={labelClass}>Obtained on (optional)</span>
          <input type="date" value={obtainedOn} onChange={(e) => setObtainedOn(e.target.value)} className={inputClass} aria-label="Date the credential was obtained" />
        </label>
        <label className="block">
          <span className={labelClass}>Proof (optional)</span>
          <select value={documentId} onChange={(e) => setDocumentId(e.target.value)} className={selectClass} aria-label="Document that shows it">
            <option value="">No document linked</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {DOC_NAMES[d.documentType] ?? d.documentType} · {d.status ?? 'pending'}
                {d.uploadedAt ? ` · ${new Date(d.uploadedAt).toLocaleDateString('en-ZA')}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block col-span-2">
          <span className={labelClass}>Note (optional): what you checked</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} aria-label="What you checked" />
        </label>
      </div>
      <div className="mt-3">
        <button
          type="button"
          disabled={busy || !code}
          onClick={() =>
            run(
              () => actions.recordTutorCredential(tutorId, code, obtainedOn || null, documentId || null, note),
              () => {
                setCode('');
                setObtainedOn('');
                setDocumentId('');
                setNote('');
              },
            )
          }
          className={buttonClass}
        >
          Record credential
        </button>
      </div>

      <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-5 mb-2">Or put them at a level directly</h3>
      {assigned && (
        <p className="text-xs text-slate-600 mb-2">
          Assigned now: <span className="font-bold text-[#0F172A]">{assigned.level}</span>
          {assigned.note ? ` (${assigned.note})` : ''}. Assigning again replaces it.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelClass}>Level</span>
          <select value={assignLevel} onChange={(e) => setAssignLevel(e.target.value)} className={selectClass} aria-label="Level to assign">
            <option value="">Choose a level</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.id} · R{l.price}/hr
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Reason (kept in the audit log)</span>
          <input value={assignReason} onChange={(e) => setAssignReason(e.target.value)} className={inputClass} aria-label="Reason for the level" />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={busy || !assignLevel || assignReason.trim().length < 3}
          onClick={() =>
            run(
              () => actions.assignTutorLevel(tutorId, assignLevel, assignReason.trim()),
              () => {
                setAssignLevel('');
                setAssignReason('');
              },
            )
          }
          className={buttonClass}
        >
          Assign level
        </button>
        {assigned && (
          <button
            type="button"
            disabled={busy || assignReason.trim().length < 3}
            title={assignReason.trim().length < 3 ? 'Write the reason first' : 'Remove the assigned level'}
            onClick={() => run(() => actions.clearTutorAssignedLevel(tutorId, assignReason.trim()), () => setAssignReason(''))}
            className="text-xs font-bold text-rose-600 hover:text-rose-700 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          >
            Remove the assigned level
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-1.5 mt-3 text-xs text-rose-600 font-semibold">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
};
