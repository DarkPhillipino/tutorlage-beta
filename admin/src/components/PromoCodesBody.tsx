import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, TicketPercent, Pause, Play, Link2, Pencil, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  EMPTY_CODE_FORM, PROMO_NOT_AVAILABLE, STATUS_WORDS, attachPromoCode, canUsePromoCodes, codeStatus, createPromoCode, exampleLine, fetchPromoCodes, findTutors,
  formFromRow, parseCodeForm, promoLink, ruleLine, setPromoCodeActive, totalsOf, updatePromoCode, type CodeForm, type PromoAdminClient, type PromoCodeRow,
  type PromoListResult, type TutorChoice,
} from '../lib/promoCodes';
import { rand0 } from '../lib/walletAdmin';
import type { AdminRole } from '../types';

const inputClass = 'w-full bg-slate-100 text-[#0F172A] placeholder-slate-400 text-sm font-semibold px-3 py-2.5 rounded-xl border border-transparent focus:outline-none focus:border-[#15803D] focus:bg-white';
const labelClass = 'block text-[11px] font-bold text-slate-500 mb-1';
const btnPrimary = 'px-4 py-2.5 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-sm font-bold rounded-xl cursor-pointer';
const btnQuiet = 'px-3 py-2 bg-slate-100 hover:bg-slate-200 text-[#0F172A] text-xs font-bold rounded-lg cursor-pointer inline-flex items-center gap-1.5';

interface Props {
  client: PromoAdminClient;
  role: AdminRole | null | undefined;
}

const dayText = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
};

// The Codes page (PROMO CODES, CEO's decision of 5 Nov 2026): make, edit and pause codes, see the sign-ups, lessons and rand given away per code, and attach
// a code to an account that forgot to enter it. Finance admins only (the database says the same). A database without the codes migration shows an
// empty page with one plain line, and works as soon as the migration is applied.
export const PromoCodesBody: React.FC<Props> = ({ client, role }) => {
  const [result, setResult] = useState<PromoListResult | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState<CodeForm>(EMPTY_CODE_FORM);
  const [creatingTutorName, setCreatingTutorName] = useState('');
  const [editing, setEditing] = useState<{ id: string; form: CodeForm; tutorName: string } | null>(null);

  const load = useCallback(async () => {
    setResult(await fetchPromoCodes(client));
  }, [client]);
  useEffect(() => {
    load();
  }, [load]);

  if (!canUsePromoCodes(role)) {
    return <p className="text-sm text-slate-500">Codes are for the finance manager and the super admin.</p>;
  }

  const run = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setNotice(null);
    try {
      const text = await action();
      if (text) setNotice({ tone: 'good', text });
      await load();
    } catch (e) {
      setNotice({ tone: 'bad', text: e instanceof Error ? e.message : 'That did not work. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseCodeForm(creating);
    // (checked with `in`: the admin app's compiler settings do not narrow a union on a true/false field)
    if ('message' in parsed) {
      setNotice({ tone: 'bad', text: parsed.message });
      return;
    }
    const args = parsed.args;
    run(async () => {
      await createPromoCode(client, args);
      setCreating(EMPTY_CODE_FORM);
      setCreatingTutorName('');
      return `Code ${args.code} is ready. Its link: ${promoLink(args.code)}`;
    });
  };

  const onSaveEdit = (c: PromoCodeRow) => {
    if (!editing) return;
    const parsed = parseCodeForm(editing.form, { codeRequired: false });
    if ('message' in parsed) {
      setNotice({ tone: 'bad', text: parsed.message });
      return;
    }
    const args = parsed.args;
    run(async () => {
      await updatePromoCode(client, c.id, args, c.active);
      setEditing(null);
      return `Code ${c.code} was changed. The new numbers count from the next request; a request already sent keeps what it was told.`;
    });
  };

  const codes = result?.status === 'ready' ? result.codes : [];
  const totals = totalsOf(codes);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-[#0F172A] mb-1 flex items-center gap-2"><TicketPercent className="w-6 h-6 text-[#15803D]" /> Codes</h1>
        <p className="text-sm text-slate-500 max-w-2xl">
          A code gives a parent a percent off their first lessons (10% off the first 3 by default). The discount comes out of Tutorlage's share: the tutor's pay never
          changes. It is the answer to "who told you about us" without asking anyone.
        </p>
      </div>

      {notice && (
        <div role="status" data-codes-notice={notice.tone} className={`rounded-xl px-4 py-3 text-sm font-semibold flex items-start gap-2 ${notice.tone === 'good' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-rose-50 border border-rose-200 text-rose-700'}`}>
          {notice.tone === 'good' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span className="break-all">{notice.text}</span>
        </div>
      )}

      {result === null && (
        <div className="flex items-center text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading codes…</div>
      )}
      {result?.status === 'not_available' && (
        <p role="status" data-codes-not-available className="text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{PROMO_NOT_AVAILABLE}</p>
      )}
      {result?.status === 'forbidden' && (
        <p role="alert" className="text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">The database says this account may not see codes.</p>
      )}
      {result?.status === 'error' && (
        <p role="alert" className="text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
          Could not load the codes: {result.message}{' '}
          <button type="button" onClick={load} className="underline font-bold cursor-pointer">Try again</button>
        </p>
      )}

      {result?.status === 'ready' && (
        <div data-codes-totals className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            ['Codes', String(totals.codes)],
            ['Families signed up', String(totals.signups)],
            ['Lessons booked', String(totals.lessonsBooked)],
            ['Given away so far', rand0(totals.randGiven)],
            ['Committed (booked, not done yet)', rand0(totals.randBooked - totals.randGiven)],
          ].map(([label, value]) => (
            <div key={label} className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="text-[11px] font-bold text-slate-500">{label}</div>
              <div className="text-xl font-extrabold text-[#0F172A]">{value}</div>
            </div>
          ))}
        </div>
      )}

      {result?.status !== 'forbidden' && result !== null && (
        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="text-sm font-extrabold text-[#0F172A] mb-3">Make a code</h2>
          <form onSubmit={onCreate} className="space-y-3" data-codes-create>
            <CodeFields form={creating} onChange={setCreating} client={client} tutorName={creatingTutorName} onTutorName={setCreatingTutorName} codeEditable />
            <p className="text-[11px] text-slate-500">
              Example at {creating.percent || '10'}% off: {exampleLine(Math.min(30, Math.max(1, Number(creating.percent) || 10)), 280)}. The parent's link will be{' '}
              <span className="font-bold">{promoLink(creating.code.trim().toUpperCase() || 'YOURCODE')}</span>.
            </p>
            <button type="submit" disabled={busy} className={btnPrimary}>Make the code</button>
          </form>
        </section>
      )}

      {result?.status === 'ready' && (
        <section>
          <h2 className="text-sm font-extrabold text-[#0F172A] mb-3">Codes ({codes.length})</h2>
          {codes.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 text-sm text-slate-500">No code yet. Make the first one above.</div>
          ) : (
            <div className="space-y-3">
              {codes.map((c) => {
                const status = codeStatus(c);
                return (
                  <div key={c.id} data-code-row={c.code} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-base font-extrabold text-[#0F172A]">{c.code}{c.label && <span className="ml-2 text-xs font-bold text-slate-500">{c.label}</span>}</div>
                        <div className="text-xs text-slate-600">{ruleLine(c)} · {c.maxFamilies === null ? 'no cap on families' : `at most ${c.maxFamilies} families`} · {dayText(c.validFrom)} to {c.validUntil ? dayText(new Date(new Date(c.validUntil).getTime() - 1).toISOString()) : 'no end'}</div>
                        {c.referringTutorId && <div className="text-xs text-slate-600">Referring tutor: {c.referringTutorName ?? c.referringTutorId}</div>}
                        <div data-code-status={status} className={`text-xs font-bold mt-1 ${status === 'active' ? 'text-[#15803D]' : 'text-amber-700'}`}>{STATUS_WORDS[status]}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={btnQuiet} disabled={busy} onClick={() => run(async () => { await setPromoCodeActive(client, c.id, !c.active); return c.active ? `Code ${c.code} is paused.` : `Code ${c.code} is active again.`; })}>
                          {c.active ? <><Pause className="w-3.5 h-3.5" /> Pause</> : <><Play className="w-3.5 h-3.5" /> Resume</>}
                        </button>
                        <button type="button" className={btnQuiet} onClick={() => setEditing(editing?.id === c.id ? null : { id: c.id, form: formFromRow(c), tutorName: c.referringTutorName ?? '' })}>
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </button>
                        <button type="button" className={btnQuiet} onClick={() => { try { navigator.clipboard?.writeText(promoLink(c.code)); setNotice({ tone: 'good', text: `Copied: ${promoLink(c.code)}` }); } catch { setNotice({ tone: 'good', text: promoLink(c.code) }); } }}>
                          <Link2 className="w-3.5 h-3.5" /> Copy link
                        </button>
                      </div>
                    </div>
                    <div data-code-numbers className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                      <Stat label="Signed up" value={String(c.signups)} />
                      <Stat label="Lessons booked" value={String(c.lessonsBooked)} />
                      <Stat label="Lessons done" value={String(c.lessonsCompleted)} />
                      <Stat label="Given back" value={String(c.lessonsReturned)} />
                      <Stat label="Rand given away" value={rand0(c.randGiven)} extra={c.randBooked > c.randGiven ? `+ ${rand0(c.randBooked - c.randGiven)} booked` : undefined} />
                    </div>
                    {editing?.id === c.id && (
                      <form onSubmit={(e) => { e.preventDefault(); onSaveEdit(c); }} className="space-y-3 border-t border-slate-100 pt-3" data-codes-edit>
                        <CodeFields form={editing.form} onChange={(form) => setEditing({ ...editing, form })} client={client} tutorName={editing.tutorName} onTutorName={(tutorName) => setEditing({ ...editing, tutorName })} codeEditable={false} />
                        <button type="submit" disabled={busy} className={btnPrimary}>Save changes</button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {result !== null && result.status !== 'forbidden' && result.status !== 'not_available' && <AttachBox client={client} busy={busy} run={run} />}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; extra?: string }> = ({ label, value, extra }) => (
  <div className="bg-slate-50 rounded-xl px-3 py-2">
    <div className="text-[10px] font-bold text-slate-500">{label}</div>
    <div className="text-sm font-extrabold text-[#0F172A]">{value}</div>
    {extra && <div className="text-[10px] text-slate-500">{extra}</div>}
  </div>
);

// The fields of a code, for both "make" and "edit". A code's own letters cannot be changed once it is made (it is printed in messages).
const CodeFields: React.FC<{
  form: CodeForm;
  onChange: (f: CodeForm) => void;
  client: PromoAdminClient;
  tutorName: string;
  onTutorName: (n: string) => void;
  codeEditable: boolean;
}> = ({ form, onChange, client, tutorName, onTutorName, codeEditable }) => {
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<TutorChoice[] | null>(null);
  const set = (patch: Partial<CodeForm>) => onChange({ ...form, ...patch });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className={labelClass}>Code</label>
          <input className={inputClass} value={form.code} onChange={(e) => set({ code: e.target.value })} disabled={!codeEditable} placeholder="ODI2026" maxLength={32} />
        </div>
        <div>
          <label className={labelClass}>Channel (who is it for?)</label>
          <input className={inputClass} value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="Faculty of Education" maxLength={80} />
        </div>
        <div>
          <label className={labelClass}>Percent off (1 to 30)</label>
          <input className={inputClass} inputMode="numeric" value={form.percent} onChange={(e) => set({ percent: e.target.value })} />
        </div>
        <div>
          <label className={labelClass}>Lessons per account</label>
          <input className={inputClass} inputMode="numeric" value={form.uses} onChange={(e) => set({ uses: e.target.value })} />
        </div>
        <div>
          <label className={labelClass}>First day (empty = now)</label>
          <input className={inputClass} type="date" value={form.validFrom} onChange={(e) => set({ validFrom: e.target.value })} />
        </div>
        <div>
          <label className={labelClass}>Last day to sign up (empty = no end)</label>
          <input className={inputClass} type="date" value={form.validUntil} onChange={(e) => set({ validUntil: e.target.value })} />
        </div>
        <div>
          <label className={labelClass}>Most families (empty = no cap)</label>
          <input className={inputClass} inputMode="numeric" value={form.maxFamilies} onChange={(e) => set({ maxFamilies: e.target.value })} />
        </div>
        <div>
          <label className={labelClass}>Referring tutor (optional)</label>
          {form.tutorId ? (
            <div className="flex items-center gap-2 text-sm font-semibold text-[#0F172A]">
              <span>{tutorName || form.tutorId}</span>
              <button type="button" className={btnQuiet} onClick={() => { set({ tutorId: '' }); onTutorName(''); setFound(null); }}>Remove</button>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex gap-1.5">
                <input className={inputClass} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Name or e-mail" />
                <button type="button" className={btnQuiet} onClick={async () => setFound(await findTutors(client, term))}>Find</button>
              </div>
              {found !== null && found.length === 0 && <div className="text-[11px] text-slate-500">No tutor found.</div>}
              {found?.map((t) => (
                <button key={t.id} type="button" className="block w-full text-left text-xs font-semibold text-[#0F172A] bg-slate-50 hover:bg-slate-100 rounded-lg px-2 py-1.5 cursor-pointer"
                  onClick={() => { set({ tutorId: t.id }); onTutorName(t.name || t.email); setFound(null); setTerm(''); }}>
                  {t.name} <span className="text-slate-500">{t.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// "I forgot to enter it": attach a code to an account that already exists, found by e-mail, with a written reason (kept in the audit log).
const AttachBox: React.FC<{ client: PromoAdminClient; busy: boolean; run: (a: () => Promise<string | void>) => Promise<void> }> = ({ client, busy, run }) => {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5" data-codes-attach>
      <h2 className="text-sm font-extrabold text-[#0F172A] mb-1">Attach a code to an account</h2>
      <p className="text-xs text-slate-500 mb-3">For a parent or learner who forgot to enter it at sign-up. The code has to be active. The reason is kept in the audit log.</p>
      <form
        className="grid grid-cols-1 lg:grid-cols-4 gap-3 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await attachPromoCode(client, email, code, reason);
            setEmail('');
            setCode('');
            setReason('');
            return r.already ? 'That account already had this code.' : 'The code is on the account. Their next lesson shows the discount.';
          });
        }}
      >
        <div>
          <label className={labelClass}>Account e-mail</label>
          <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="parent@example.com" required />
        </div>
        <div>
          <label className={labelClass}>Code</label>
          <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} placeholder="ODI2026" required />
        </div>
        <div>
          <label className={labelClass}>Reason</label>
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Forgot to type it at sign-up" required minLength={5} />
        </div>
        <button type="submit" disabled={busy} className={btnPrimary}>Attach</button>
      </form>
    </section>
  );
};
