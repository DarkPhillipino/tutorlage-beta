import React, { createContext, useContext, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  CredentialDraft,
  LevelDraft,
  TierDraft,
  codeFromLabel,
  credentialDraftFrom,
  credentialFromDraft,
  emptyLevelDraft,
  ladderWarnings,
  levelDraftFrom,
  levelFromDraft,
  tierDraftFrom,
  tierFromDraft,
} from '../lib/levelForms';
import type { LevelActions } from '../lib/levelActions';
import { getErrorMessage } from '../lib/errors';
import type { CredentialConfig, LevelConfig, TierConfig } from '../types';

// CEO, 17 Oct 2026: "the tiers should be defined in the admin app". The tiers, the 16 levels (price, minimums, Tutorlage's share)
// and what starts a tutor at a level are edited here. The tutor app, the price ladder on the request page and the rules that move
// tutors between levels all read these same tables, so a change here is a change everywhere. Every save is checked by the
// database and written to the audit log.

const inputClass =
  'w-full bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20';
const labelClass = 'block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1';
const buttonClass = 'bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-lg cursor-pointer';

const Field: React.FC<{ label: string; value: string; onChange: (v: string) => void; disabled?: boolean; hint?: string; wide?: boolean }> = ({
  label,
  value,
  onChange,
  disabled,
  hint,
  wide,
}) => (
  <label className={`block ${wide ? 'col-span-2 sm:col-span-4' : ''}`}>
    <span className={labelClass}>{label}</span>
    <input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={inputClass} aria-label={label} />
    {hint && <span className="block text-[10px] text-slate-400 mt-0.5">{hint}</span>}
  </label>
);

// "Saved." or the reason it was not.
const Result: React.FC<{ saved: boolean; problem: string | null }> = ({ saved, problem }) =>
  problem ? (
    <span role="alert" className="flex items-center gap-1 text-[11px] font-semibold text-rose-600">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      {problem}
    </span>
  ) : saved ? (
    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
      Saved
    </span>
  ) : null;

const ActionsContext = createContext<LevelActions | null>(null);
function useActions(): LevelActions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error('LevelsBody needs its actions');
  return actions;
}

// ---- a tier -------------------------------------------------------------------------------------------------------------

const TierEditor: React.FC<{ tier: TierConfig; onSaved: () => void }> = ({ tier, onSaved }) => {
  const actions = useActions();
  const [draft, setDraft] = useState<TierDraft>(tierDraftFrom(tier));
  // Follow the saved values (after a save, or a change made elsewhere) without touching what is being typed in other rows.
  useEffect(() => setDraft(tierDraftFrom(tier)), [JSON.stringify(tier)]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<TierDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };

  const save = async () => {
    const { tier: parsed, problem: bad } = tierFromDraft(draft);
    setProblem(bad);
    if (!parsed) return;
    setBusy(true);
    try {
      await actions.saveTier(parsed);
      setSaved(true);
      onSaved();
    } catch (e) {
      setProblem(getErrorMessage(e, 'Could not save this tier.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-200" data-tier={tier.id}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label={`Tier ${tier.id} name`} value={draft.publicName} onChange={(v) => set({ publicName: v })} wide />
        <Field label="What this tier means (shown to learners)" value={draft.quote} onChange={(v) => set({ quote: v })} wide />
        <Field label="Lowest price (R/hr)" value={draft.minRate} onChange={(v) => set({ minRate: v })} />
        <Field label="Highest price (R/hr)" value={draft.maxRate} onChange={(v) => set({ maxRate: v })} />
        <Field label="Tutorlage's share (%)" value={draft.sharePct} onChange={(v) => set({ sharePct: v })} hint="Used when a level has none" />
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button onClick={save} disabled={busy} className={buttonClass}>
          Save tier
        </button>
        <Result saved={saved} problem={problem} />
      </div>
    </div>
  );
};

// ---- a level ------------------------------------------------------------------------------------------------------------

const LevelFields: React.FC<{ draft: LevelDraft; set: (patch: Partial<LevelDraft>) => void; idLocked: boolean }> = ({ draft, set, idLocked }) => (
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
    <Field label="Level" value={draft.id} onChange={(v) => set({ id: v })} disabled={idLocked} hint={idLocked ? undefined : 'For example 5A'} />
    <Field label="Price (R/hr)" value={draft.price} onChange={(v) => set({ price: v })} />
    <Field label="Tutorlage's share (%)" value={draft.sharePct} onChange={(v) => set({ sharePct: v })} />
    <Field label="Hours taught" value={draft.minHours} onChange={(v) => set({ minHours: v })} />
    <Field label="Rating at least" value={draft.minRating} onChange={(v) => set({ minRating: v })} />
    <Field label="Learners who come back (%)" value={draft.minRepeatPct} onChange={(v) => set({ minRepeatPct: v })} />
    <Field label="Reviews" value={draft.minReviews} onChange={(v) => set({ minReviews: v })} />
    <Field label="Marks up by (%)" value={draft.uplift} onChange={(v) => set({ uplift: v })} />
    <Field label="...measured for (learners)" value={draft.minStudents} onChange={(v) => set({ minStudents: v })} />
  </div>
);

const LevelEditor: React.FC<{ level: LevelConfig; onSaved: () => void }> = ({ level, onSaved }) => {
  const actions = useActions();
  const [draft, setDraft] = useState<LevelDraft>(levelDraftFrom(level));
  useEffect(() => setDraft(levelDraftFrom(level)), [JSON.stringify(level)]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<LevelDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };

  const save = async () => {
    const { level: parsed, problem: bad } = levelFromDraft(draft);
    setProblem(bad);
    if (!parsed) return;
    setBusy(true);
    try {
      await actions.saveLevel(parsed);
      setSaved(true);
      onSaved();
    } catch (e) {
      setProblem(getErrorMessage(e, 'Could not save this level.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4" data-level={level.id}>
      <LevelFields draft={draft} set={set} idLocked />
      <div className="flex items-center gap-3 mt-3">
        <button onClick={save} disabled={busy} className={buttonClass}>
          Save level {level.id}
        </button>
        <Result saved={saved} problem={problem} />
      </div>
    </div>
  );
};

const NewLevel: React.FC<{ tiers: TierConfig[]; onSaved: () => void }> = ({ tiers, onSaved }) => {
  const actions = useActions();
  const [draft, setDraft] = useState<LevelDraft>(emptyLevelDraft(tiers[tiers.length - 1]?.id ?? 1));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<LevelDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const add = async () => {
    const { level, problem: bad } = levelFromDraft(draft);
    setProblem(bad);
    if (!level) return;
    setBusy(true);
    try {
      await actions.saveLevel(level);
      setDraft(emptyLevelDraft(level.tierId));
      onSaved();
    } catch (e) {
      setProblem(getErrorMessage(e, 'Could not add this level.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-4 border border-dashed border-slate-300">
      <h3 className="text-xs font-bold text-slate-500 mb-3 flex items-center gap-1.5">
        <Plus className="w-3.5 h-3.5" />
        Add a level
      </h3>
      <label className="block mb-3 max-w-xs">
        <span className={labelClass}>Tier</span>
        <select value={draft.tierId} onChange={(e) => set({ tierId: e.target.value })} className={inputClass} aria-label="Tier of the new level">
          {tiers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id} · {t.publicName}
            </option>
          ))}
        </select>
      </label>
      <LevelFields draft={draft} set={set} idLocked={false} />
      <div className="flex items-center gap-3 mt-3">
        <button onClick={add} disabled={busy} className={buttonClass}>
          Add level
        </button>
        <Result saved={false} problem={problem} />
      </div>
    </div>
  );
};

// ---- a credential -------------------------------------------------------------------------------------------------------

const CredentialFields: React.FC<{ draft: CredentialDraft; set: (patch: Partial<CredentialDraft>) => void; levels: LevelConfig[]; codeLocked: boolean }> = ({
  draft,
  set,
  levels,
  codeLocked,
}) => (
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
    <Field label="Name (shown on the price ladder)" value={draft.label} onChange={(v) => set({ label: v })} wide />
    <label className="block col-span-2">
      <span className={labelClass}>Starts a tutor at level</span>
      <select value={draft.entrySubTier} onChange={(e) => set({ entrySubTier: e.target.value })} className={inputClass} aria-label="Level this credential starts a tutor at">
        <option value="">Choose a level</option>
        {levels.map((l) => (
          <option key={l.id} value={l.id}>
            {l.id} · R{l.price}/hr
          </option>
        ))}
      </select>
    </label>
    <Field label="Counts for (years)" value={draft.recencyYears} onChange={(v) => set({ recencyYears: v })} hint="Empty: for ever" />
    <Field label="Code" value={draft.code} onChange={(v) => set({ code: v })} disabled={codeLocked} hint={codeLocked ? undefined : 'Made from the name'} />
    <Field label="What the tutor must show (notes for the review team)" value={draft.description} onChange={(v) => set({ description: v })} wide />
  </div>
);

const CredentialEditor: React.FC<{ credential: CredentialConfig; levels: LevelConfig[]; onSaved: () => void }> = ({ credential, levels, onSaved }) => {
  const actions = useActions();
  const [draft, setDraft] = useState<CredentialDraft>(credentialDraftFrom(credential));
  useEffect(() => setDraft(credentialDraftFrom(credential)), [JSON.stringify(credential)]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<CredentialDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };

  if (credential.code === 'admin_assigned') {
    return (
      <div className="p-4" data-credential={credential.code}>
        <div className="text-sm font-bold text-[#0F172A]">{credential.label}</div>
        <p className="text-xs text-slate-500 mt-1">
          Built in. Set from a tutor's own page ("Assign a level"), with the reason; it is not a credential a tutor can claim, and it has no level of its own.
          {credential.heldBy > 0 ? ` ${credential.heldBy} tutor${credential.heldBy === 1 ? ' has' : 's have'} one now.` : ''}
        </p>
      </div>
    );
  }

  const save = async () => {
    const { credential: parsed, problem: bad } = credentialFromDraft(draft);
    setProblem(bad);
    if (!parsed) return;
    setBusy(true);
    try {
      await actions.saveCredentialDefinition(parsed);
      setSaved(true);
      onSaved();
    } catch (e) {
      setProblem(getErrorMessage(e, 'Could not save this credential.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${credential.label}"? Nobody holds it, so no tutor is affected.`)) return;
    setBusy(true);
    setProblem(null);
    try {
      await actions.deleteCredentialDefinition(credential.code);
      onSaved();
    } catch (e) {
      setProblem(getErrorMessage(e, 'Could not delete this credential.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4" data-credential={credential.code}>
      <CredentialFields draft={draft} set={set} levels={levels} codeLocked />
      <div className="flex items-center gap-3 mt-3 flex-wrap">
        <button onClick={save} disabled={busy} className={buttonClass}>
          Save credential
        </button>
        <button
          onClick={remove}
          disabled={busy || credential.heldBy > 0}
          title={credential.heldBy > 0 ? 'Tutors hold this, so it cannot be deleted. Change its level instead.' : 'Delete this credential'}
          className="flex items-center gap-1 text-xs font-bold text-rose-600 hover:text-rose-700 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </button>
        <span className="text-[11px] text-slate-400">{credential.heldBy === 0 ? 'Nobody holds this yet' : `${credential.heldBy} held`}</span>
        <Result saved={saved} problem={problem} />
      </div>
    </div>
  );
};

const NewCredential: React.FC<{ levels: LevelConfig[]; onSaved: () => void }> = ({ levels, onSaved }) => {
  const actions = useActions();
  const blank: CredentialDraft = { code: '', label: '', entrySubTier: '', recencyYears: '', description: '' };
  const [draft, setDraft] = useState<CredentialDraft>(blank);
  const [codeEdited, setCodeEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<CredentialDraft>) => {
    if (patch.code !== undefined) setCodeEdited(true);
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (patch.label !== undefined && !codeEdited) next.code = codeFromLabel(patch.label);
      return next;
    });
  };

  const add = async () => {
    const { credential, problem: bad } = credentialFromDraft(draft);
    setProblem(bad);
    if (!credential) return;
    setBusy(true);
    try {
      await actions.saveCredentialDefinition(credential);
      setDraft(blank);
      setCodeEdited(false);
      onSaved();
    } catch (e) {
      setProblem(getErrorMessage(e, 'Could not add this credential.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-4 border border-dashed border-slate-300">
      <h3 className="text-xs font-bold text-slate-500 mb-3 flex items-center gap-1.5">
        <Plus className="w-3.5 h-3.5" />
        Add a credential
      </h3>
      <CredentialFields draft={draft} set={set} levels={levels} codeLocked={false} />
      <div className="flex items-center gap-3 mt-3">
        <button onClick={add} disabled={busy} className={buttonClass}>
          Add credential
        </button>
        <Result saved={false} problem={problem} />
      </div>
    </div>
  );
};

// ---- the page -----------------------------------------------------------------------------------------------------------

export interface LevelsData {
  tiers: TierConfig[];
  levels: LevelConfig[];
  credentials: CredentialConfig[];
}

// The whole page once its data is in. The component at the bottom fetches the data; scripts/dev/levels-admin-test.ts renders this one
// directly.
export const LevelsBody: React.FC<{ data: LevelsData; actions: LevelActions; onSaved: () => void }> = ({ data, actions, onSaved }) => {
  const [recalcBusy, setRecalcBusy] = useState(false);
  const [recalcMessage, setRecalcMessage] = useState<string | null>(null);
  const [recalcError, setRecalcError] = useState<string | null>(null);

  const recalc = async () => {
    if (
      !window.confirm(
        "Work out every tutor's level again with the current prices and minimums?\n\nTutors who now meet a higher level move up, and tutors who no longer meet their level move down. Tutors whose rates are frozen do not move.",
      )
    ) {
      return;
    }
    setRecalcBusy(true);
    setRecalcMessage(null);
    setRecalcError(null);
    try {
      const n = await actions.recalculateAllLevels();
      setRecalcMessage(`Worked out ${n} tutor${n === 1 ? '' : 's'}.`);
    } catch (e) {
      setRecalcError(getErrorMessage(e, "Could not work out the tutors' levels."));
    } finally {
      setRecalcBusy(false);
    }
  };

  const warnings = ladderWarnings(data.levels);

  return (
    <ActionsContext.Provider value={actions}>
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold text-[#0F172A] mb-2">Levels</h1>
        <p className="text-sm text-slate-500 max-w-2xl">
          The four tiers, the {data.levels.length} price levels with what a tutor must have reached to be at each one, and what can start a tutor at a level without that
          record (a teaching qualification, years in the classroom, exam marking). The request page, the tutor app and the rules that move tutors between levels all read
          these, so a change here is a change everywhere. Every save is written to the Audit Log. To put one tutor at a level, open them under Tutor Verification.
        </p>
      </div>

      <section className="bg-white rounded-2xl p-4 border border-slate-200">
        <h2 className="text-sm font-extrabold text-[#0F172A] mb-1">When a change takes effect</h2>
        <p className="text-xs text-slate-500 mb-3">
          A new price is what learners pay for requests at that level from then on. A tutor's level is only worked out again when they complete a session, or when you press
          the button below, so changing a minimum moves nobody until then.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={recalc} disabled={recalcBusy} className={`${buttonClass} flex items-center gap-1.5`}>
            {recalcBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Recalculate everyone's level
          </button>
          {recalcMessage && <span className="text-[11px] font-semibold text-emerald-600">{recalcMessage}</span>}
          {recalcError && <span className="text-[11px] font-semibold text-rose-600">{recalcError}</span>}
        </div>
      </section>

      {warnings.length > 0 && (
        <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4" aria-label="Warnings about the ladder">
          <h2 className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-2">Worth a look</h2>
          <ul className="text-xs text-amber-800 space-y-0.5 list-disc pl-4">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm font-extrabold text-[#0F172A] mb-3">Tiers</h2>
        <div className="space-y-3">
          {data.tiers.map((t) => (
            <TierEditor key={t.id} tier={t} onSaved={onSaved} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-extrabold text-[#0F172A] mb-3">Levels</h2>
        <div className="space-y-5">
          {data.tiers.map((t) => {
            const members = data.levels.filter((l) => l.tierId === t.id);
            return (
              <div key={t.id}>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Tier {t.id} · {t.publicName}
                </h3>
                <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                  {members.length === 0 && <p className="p-4 text-xs text-slate-500">No levels in this tier.</p>}
                  {members.map((l) => (
                    <LevelEditor key={l.id} level={l} onSaved={onSaved} />
                  ))}
                </div>
              </div>
            );
          })}
          <NewLevel tiers={data.tiers} onSaved={onSaved} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-extrabold text-[#0F172A] mb-1">What starts a tutor at a level</h2>
        <p className="text-xs text-slate-500 mb-3 max-w-2xl">
          Record one of these on a tutor's page once you have seen the proof. The highest level among a tutor's current credentials, or what they have earned on Tutorlage, whichever is higher, is their level. The name is shown to learners under the level on the request page.
        </p>
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden mb-3">
          {data.credentials.map((c) => (
            <CredentialEditor key={c.code} credential={c} levels={data.levels} onSaved={onSaved} />
          ))}
        </div>
        <NewCredential levels={data.levels} onSaved={onSaved} />
      </section>
    </div>
    </ActionsContext.Provider>
  );
};
