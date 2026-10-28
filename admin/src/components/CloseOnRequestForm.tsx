import React, { useState } from 'react';
import { ActionResult, CloseForm, ClosuresClient, ROLE_LABELS, closeFormProblem, closeOnRequest, emptyCloseForm, todayInSa } from '../lib/accountClosures';

// "Close on a written request" (legal B1: an admin, only on a request from the account's own registered address or after the same identity
// check as Privacy §15, recorded). Every field is required. The person is found with the same search the Users page uses (handed in, so
// a test can draw this form without a database). A person on a safety hold is refused by the database unless a super admin does it.

export interface FoundPerson { id: string; fullName: string; email: string; role: string }

const inputClass = 'w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20';
const labelClass = 'block text-[11px] font-bold text-slate-500 mb-1';

export const CloseOnRequestForm: React.FC<{
  client: ClosuresClient;
  findPeople: (term: string) => Promise<FoundPerson[]>;
  onClosed: () => void;
}> = ({ client, findPeople, onClosed }) => {
  const [form, setForm] = useState<CloseForm>(emptyCloseForm);
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<FoundPerson[] | null>(null);
  const [chosen, setChosen] = useState<FoundPerson | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  const set = (patch: Partial<CloseForm>) => setForm((f) => ({ ...f, ...patch }));
  const problem = closeFormProblem(form);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (term.trim().length === 0) return;
    setResult(null);
    try {
      setFound(await findPeople(term.trim()));
    } catch {
      setFound([]);
      setResult({ ok: false, message: 'The search did not work. Try again.' });
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await closeOnRequest(client, form);
    setBusy(false);
    setResult(r);
    if (r.ok) {
      setForm(emptyCloseForm);
      setChosen(null);
      setFound(null);
      setTerm('');
      onClosed();
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-6">
      <h2 className="text-sm font-extrabold text-[#0F172A]">Close on a written request</h2>
      <p className="text-xs text-slate-500 mt-1 mb-3">
        Only for a request that came from the account&apos;s own registered email address, or after the same identity check as Privacy §15.
        Closing a guardian also closes their learners under 18. Upcoming sessions are cancelled and refunded.
      </p>

      <form onSubmit={search} className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="flex-1">
          <label className={labelClass} htmlFor="closePersonSearch">Find the person (name or email)</label>
          <input id="closePersonSearch" value={term} onChange={(e) => setTerm(e.target.value)} className={inputClass} />
        </div>
        <button type="submit" className="self-end px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 cursor-pointer">Find</button>
      </form>

      {found && found.length === 0 && <p className="text-xs text-slate-500 mb-3">No one found.</p>}
      {found && found.length > 0 && !chosen && (
        <ul className="mb-3 border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-40 overflow-y-auto">
          {found.slice(0, 8).map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { setChosen(p); set({ profileId: p.id }); }} className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer">
                <span className="font-bold text-[#0F172A]">{p.fullName || p.email}</span>{' '}
                <span className="text-slate-500">· {ROLE_LABELS[p.role] ?? p.role} · {p.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {chosen && (
        <p className="mb-3 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          Closing <span className="font-bold text-[#0F172A]">{chosen.fullName || chosen.email}</span> ({ROLE_LABELS[chosen.role] ?? chosen.role}, {chosen.email}){' '}
          <button type="button" onClick={() => { setChosen(null); set({ profileId: '' }); }} className="font-bold text-[#15803D] hover:underline cursor-pointer">Choose someone else</button>
        </p>
      )}

      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="closeAskedBy">Who asked</label>
          <input id="closeAskedBy" required value={form.askedBy} onChange={(e) => set({ askedBy: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="closeHowVerified">How you checked it was them</label>
          <input id="closeHowVerified" required value={form.howVerified} onChange={(e) => set({ howVerified: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="closeReference">Reference of the request</label>
          <input id="closeReference" required value={form.reference} onChange={(e) => set({ reference: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="closeRequestedOn">Date they asked</label>
          <input id="closeRequestedOn" type="date" required max={todayInSa()} value={form.requestedOn} onChange={(e) => set({ requestedOn: e.target.value })} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="closeReason">Reason</label>
          <input id="closeReason" required value={form.reason} onChange={(e) => set({ reason: e.target.value })} className={inputClass} />
        </div>
        <div className="sm:col-span-2 flex items-center gap-3">
          <button
            type="submit"
            data-action="close-on-request"
            disabled={busy || problem !== null}
            className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Close the account
          </button>
          {problem && <span className="text-[11px] text-slate-500">{problem}</span>}
        </div>
      </form>

      {result && (
        <p role={result.ok ? 'status' : 'alert'} className={`mt-3 text-xs font-semibold ${result.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
          {result.message}
        </p>
      )}
    </div>
  );
};
