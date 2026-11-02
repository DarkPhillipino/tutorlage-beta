import React, { useState } from 'react';
import {
  BANK_KEYS, LIMIT_KEYS, SWITCH_WARNING, SettingsLoad, WalletSettingsValues, checkBank, checkLimits, planSettingSaves, switchSummary,
} from '../lib/walletAdmin';
import { ConfirmBox, ErrorLine, FieldLabel, NotAvailable, Pill, inputClass } from './WalletParts';

// Tab 4, "Wallet settings": Tutorlage's own bank details (what learners pay into), the limits, how long proofs are kept, and the master switch
// wallet_payments_enabled, shown with its state and a plain warning. Saved through the System Settings write path (the database guard lets only a
// finance manager or super admin change a wallet_ key, and checks the values again). This screen never turns the switch on by itself.

interface Props {
  load: SettingsLoad;
  // Return the error text, or null when everything was saved (the page then reads the settings again).
  onSave: (next: { bank: Record<string, string>; limits: Record<string, string> }) => Promise<string | null>;
  onSwitch: (enabled: boolean) => Promise<string | null>;
  onRetry: () => void;
}

// The message after a save lives in the parent: a save re-reads the settings, which re-mounts the form, and the message must survive that.
type Notice = { error: string | null; saved: boolean };

const SettingsForm: React.FC<{ values: WalletSettingsValues; notice: Notice; setNotice: React.Dispatch<React.SetStateAction<Notice>> } & Pick<Props, 'onSave' | 'onSwitch'>> = ({ values, notice, setNotice, onSave, onSwitch }) => {
  const [bank, setBank] = useState<Record<string, string>>(values.bank);
  const [limits, setLimits] = useState<Record<string, string>>(values.limits);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [busy, setBusy] = useState(false);
  const { error, saved } = notice;
  const setError = (e: string | null) => setNotice((n) => ({ ...n, error: e }));
  const setSaved = (v: boolean) => setNotice((n) => ({ ...n, saved: v }));
  const summary = switchSummary(values);
  const writes = planSettingSaves(values, { bank, limits });
  const changesBank = writes.some((w) => w.key.startsWith('wallet_bank_'));

  const askSave = () => {
    const problems = { ...checkBank(bank), ...checkLimits(limits) };
    setErrors(problems);
    setSaved(false);
    if (Object.keys(problems).length > 0) return setError('Fix the highlighted boxes first.');
    setError(null);
    if (writes.length === 0) return setError('Nothing has changed.');
    setConfirmSave(true);
  };
  const save = async () => {
    setBusy(true);
    const problem = await onSave({ bank, limits });
    setBusy(false);
    setConfirmSave(false);
    if (problem) setError(problem);
    else setSaved(true);
  };
  const flip = async () => {
    setBusy(true);
    const problem = await onSwitch(!values.enabled);
    setBusy(false);
    setConfirmSwitch(false);
    setError(problem);
  };
  const turnOnBlocked = !values.enabled && summary.missing.length > 0;

  const field = (key: string, label: string, value: string, set: (v: string) => void) => (
    <div key={key}>
      <FieldLabel htmlFor={`set-${key}`}>{label}</FieldLabel>
      <input id={`set-${key}`} value={value} onChange={(e) => { set(e.target.value); setConfirmSave(false); setSaved(false); }} disabled={busy} aria-invalid={Boolean(errors[key])} className={`${inputClass} ${errors[key] ? 'ring-2 ring-rose-300' : ''}`} />
      {errors[key] && <p className="text-[11px] font-semibold text-rose-600 mt-1">{errors[key]}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      <section data-switch-card className={`rounded-2xl border p-4 ${values.enabled ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-extrabold text-[#0F172A]">The wallet switch</h2>
          <Pill tone={values.enabled ? 'green' : 'slate'}>{summary.state}</Pill>
          {values.freeOn !== null && <Pill tone={values.freeOn ? 'amber' : 'slate'}>Free sessions: {values.freeOn ? 'ON' : 'OFF'}</Pill>}
        </div>
        <p className="text-sm font-semibold text-[#0F172A] mt-2">{summary.line}</p>
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">{SWITCH_WARNING}</p>
        {turnOnBlocked && <p data-switch-blocked className="text-xs font-bold text-rose-700 mt-2">Before you can turn it on, fill in and save: {summary.missing.join(', ')}.</p>}
        <button
          type="button"
          onClick={() => { setConfirmSwitch(true); setError(null); }}
          disabled={busy || turnOnBlocked}
          className={`mt-3 text-xs font-bold px-4 py-2 rounded-lg disabled:opacity-50 cursor-pointer ${values.enabled ? 'bg-white border border-rose-300 text-rose-700 hover:bg-rose-50' : 'bg-[#15803D] hover:bg-[#166534] text-white'}`}
        >
          {values.enabled ? 'Turn the wallet OFF' : 'Turn the wallet ON'}
        </button>
        {confirmSwitch && (
          <ConfirmBox
            text={values.enabled ? 'Turn the wallet OFF? Learners and tutors stop seeing it. Money already in wallets stays there.' : `Turn the wallet ON? ${values.freeOn ? 'Free sessions are still ON, so nothing will change for learners until you turn free sessions off in System Settings.' : 'Learners and tutors will see it straight away.'}`}
            yes={values.enabled ? 'Yes, turn it off' : 'Yes, turn it on'}
            danger={values.enabled}
            busy={busy}
            onYes={flip}
            onNo={() => setConfirmSwitch(false)}
          />
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-4">
        <h2 className="text-sm font-extrabold text-[#0F172A] mb-1">Tutorlage's bank details</h2>
        <p className="text-xs text-slate-500 mb-3">Learners see these on the Add money screen and pay into this account. Check each box twice. Changing them tells every admin.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {BANK_KEYS.map((b) => field(b.key, b.label, bank[b.key] ?? '', (v) => setBank((prev) => ({ ...prev, [b.key]: v }))))}
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-4">
        <h2 className="text-sm font-extrabold text-[#0F172A] mb-1">Limits</h2>
        <p className="text-xs text-slate-500 mb-3">Whole numbers. The smallest transfer cannot be more than the largest, and the largest cannot be more than what a wallet may hold.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {LIMIT_KEYS.filter((l) => l.group !== 'keep').map((l) => field(l.key, l.label, limits[l.key] ?? '', (v) => setLimits((prev) => ({ ...prev, [l.key]: v }))))}
        </div>
        <h3 className="text-xs font-extrabold text-[#0F172A] mt-4 mb-1">Keeping proof of payment files</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {LIMIT_KEYS.filter((l) => l.group === 'keep').map((l) => field(l.key, l.label, limits[l.key] ?? '', (v) => setLimits((prev) => ({ ...prev, [l.key]: v }))))}
        </div>
      </section>

      <div>
        <button type="button" onClick={askSave} disabled={busy} className="text-xs font-bold text-white bg-[#0F172A] hover:bg-slate-800 px-5 py-2.5 rounded-lg disabled:opacity-60 cursor-pointer">Save changes</button>
        {saved && <span role="status" className="ml-3 text-xs font-bold text-[#15803D]">Saved.</span>}
        {confirmSave && (
          <ConfirmBox
            text={changesBank ? 'Save these changes? You are changing the bank account learners pay into: every admin will be told.' : 'Save these changes?'}
            yes="Yes, save"
            busy={busy}
            onYes={save}
            onNo={() => setConfirmSave(false)}
          />
        )}
        <ErrorLine text={error} />
      </div>
    </div>
  );
};

export const WalletSettingsBody: React.FC<Props> = ({ load, onSave, onSwitch, onRetry }) => {
  const [notice, setNotice] = useState<Notice>({ error: null, saved: false });
  if (load.state === 'not_available') return <NotAvailable message={load.note} />;
  if (load.state === 'error') return <NotAvailable message={load.message} failed onRetry={onRetry} />;
  // Re-mounted whenever the saved values change, so the boxes always show what the database holds.
  const key = JSON.stringify([load.values.enabled, load.values.freeOn, load.values.bank, load.values.limits]);
  return <SettingsForm key={key} values={load.values} notice={notice} setNotice={setNotice} onSave={onSave} onSwitch={onSwitch} />;
};
