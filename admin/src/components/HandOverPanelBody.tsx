import React from 'react';
import { AlertCircle, CheckCircle2, PackageOpen } from 'lucide-react';
import {
  AUTHORITIES, HAND_OVER_NOT_ACTIVE, HandOverForm, HandOverPart, HandOverResult, PARTS, PastHandOvers, TUTOR_TOLD_CHOICES, formProblems, resolveScope,
} from '../lib/handOver';
import { formatWhen } from '../lib/safetyHold';

// The screen for "Prepare hand-over bundle" on a tutor's page (state and calls live in HandOverPanel.tsx). Drawn from props so a test can
// render it. The button stays off until every field is filled (legal A3), and the parts a kind of authority allows are fixed by the
// kind: some are always in, some can never be, the rest are ticked only if the paper names them.

interface Props {
  tutorName: string;
  open: boolean;
  form: HandOverForm;
  busy: boolean;
  error: string | null;
  result: HandOverResult | null;
  past: PastHandOvers | null;
  // The hand-over a delivery is being written down for (the one just prepared, or one picked from the earlier list); null = no delivery form.
  deliverFor: string | null;
  delivery: { method: string; address: string; recorded: boolean };
  onPickDelivery: (handOverId: string) => void;
  onOpen: () => void;
  onChange: (next: HandOverForm) => void;
  onPrepare: () => void;
  onDelivery: (next: { method: string; address: string }) => void;
  onRecordDelivery: () => void;
}

const field = 'w-full bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20';
const label = 'block text-[11px] font-bold text-slate-500 mb-1';

export const HandOverPanelBody: React.FC<Props> = ({ tutorName, open, form, busy, error, result, past, deliverFor, delivery, onPickDelivery, onOpen, onChange, onPrepare, onDelivery, onRecordDelivery }) => {
  const set = (patch: Partial<HandOverForm>) => onChange({ ...form, ...patch });
  const rules = AUTHORITIES.find((a) => a.value === form.authority)?.rules;
  const problems = formProblems(form);
  const scope = resolveScope(form.authority, form.ticks);
  const text = (key: keyof HandOverForm, name: string, placeholder = '') => (
    <div>
      <label className={label} htmlFor={`ho-${key}`}>{name}</label>
      <input id={`ho-${key}`} value={form[key] as string} onChange={(e) => set({ [key]: e.target.value } as Partial<HandOverForm>)} placeholder={placeholder} className={field} />
    </div>
  );

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 mb-4">
      <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <PackageOpen className="w-3.5 h-3.5" /> Hand-over bundle
      </h2>
      <p className="text-[11px] text-slate-500 mb-3">
        For when the police, a court or the Information Regulator are given what Tutorlage holds about {tutorName || 'this tutor'}. Only with the
        paper in hand first. The bundle is built to the kind of authority, every document file in it is written into the document access log, and
        a safety hold is placed on the tutor if there is none.
      </p>

      {past?.state === 'not_active' && (
        <div role="status" className="flex items-start gap-1.5 mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {HAND_OVER_NOT_ACTIVE}
        </div>
      )}
      {past?.state === 'ok' && past.rows.length > 0 && (
        <div className="mb-3 divide-y divide-slate-100 border border-slate-200 rounded-xl">
          {past.rows.map((p) => (
            <div key={p.id} className="px-3 py-2 text-xs flex flex-wrap items-baseline justify-between gap-x-4">
              <span className="font-bold text-[#0F172A]">
                {p.event === 'delivered' ? 'Delivered' : 'Prepared'}{p.reference ? ` · ${p.reference}` : ''}{p.deliveredTo ? ` · ${p.deliveredTo}` : ''}
              </span>
              <span className="text-slate-500">
                {p.adminLabel || 'An admin'} · {formatWhen(p.createdAt)}
                {p.event === 'prepared' && (
                  <button type="button" onClick={() => onPickDelivery(p.id)} className="ml-3 text-[11px] font-bold text-[#15803D] hover:underline cursor-pointer">
                    Record a delivery
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {result ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
            <p className="font-bold flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Bundle prepared and recorded ({result.savedFiles.length} files saved)</p>
            <ul className="mt-1 list-disc pl-5">{result.savedFiles.map((f) => <li key={f} className="break-all">{f}</li>)}</ul>
            {result.holdPlaced && <p className="mt-1">A safety hold was placed on this tutor.</p>}
            <p className="mt-1">Your browser saved the files one by one. Send them only to a named official address or hand them over in person, never by WhatsApp or a personal mailbox. Send any password separately.</p>
          </div>
          {!result.complete && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              <p className="font-bold">This bundle is not complete:</p>
              <ul className="mt-1 list-disc pl-5">{result.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
        </div>
      ) : !open ? (
        <button type="button" onClick={onOpen} className="text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer">
          Prepare hand-over bundle…
        </button>
      ) : (
        <div className="space-y-3">
          <div>
            <label className={label} htmlFor="ho-authority">What kind of authority is this?</label>
            <select id="ho-authority" value={form.authority} onChange={(e) => set({ authority: e.target.value as HandOverForm['authority'], ticks: {} })} className={field}>
              <option value="">Choose…</option>
              {AUTHORITIES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {text('reference', 'Reference (case, order, warrant or notice number, or the s 54 report number)')}
            {text('requesterName', 'Requester: name')}
            {text('requesterRole', 'Requester: rank or role')}
            {text('requesterOrganisation', 'Requester: organisation (station or court)')}
            {text('requesterPhone', 'Requester: official phone')}
            {text('requesterEmail', 'Requester: official email')}
          </div>
          {text('verifiedHow', 'How the requester was verified', 'For example: called the station back on its public number')}
          <div>
            <label className={label} htmlFor="ho-reason">Reason, written by the safeguarding lead (one or two sentences)</label>
            <textarea id="ho-reason" rows={2} value={form.reason} onChange={(e) => set({ reason: e.target.value })} className={field} />
          </div>
          {text('approvedBy', 'Approved by (the safeguarding lead or the deputy)')}
          <div>
            <label className={label} htmlFor="ho-tutorTold">Was the tutor told, or why not?</label>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {TUTOR_TOLD_CHOICES.map((c) => (
                <button key={c} type="button" onClick={() => set({ tutorTold: c })} className="text-[11px] font-semibold px-2 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer text-left">{c}</button>
              ))}
            </div>
            <textarea id="ho-tutorTold" rows={2} value={form.tutorTold} onChange={(e) => set({ tutorTold: e.target.value })} className={field} />
          </div>

          <div>
            <p className={label}>What goes in the bundle</p>
            {!rules ? (
              <p className="text-xs text-slate-500">Choose the kind of authority first: it decides what may be included.</p>
            ) : (
              <ul className="space-y-1">
                {PARTS.map((p) => {
                  const rule = rules[p.value];
                  const on = scope.includes(p.value);
                  return (
                    <li key={p.value} className="text-xs flex items-start gap-2">
                      <input
                        type="checkbox"
                        id={`ho-part-${p.value}`}
                        checked={on}
                        disabled={rule === 'always' || rule === 'never'}
                        onChange={(e) => set({ ticks: { ...form.ticks, [p.value as HandOverPart]: e.target.checked } })}
                        className="mt-0.5"
                      />
                      <label htmlFor={`ho-part-${p.value}`} className={rule === 'never' ? 'text-slate-400' : 'text-[#0F172A]'}>
                        {p.label}
                        <span className="text-slate-400">
                          {rule === 'always' ? ' · always included for this kind of authority' : rule === 'never' ? ' · may not be included for this kind of authority'
                            : rule === 'relevant' ? ' · only if the report depends on it' : ' · only if the paper names it'}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {problems.length > 0 && <p className="text-[11px] text-slate-500">Still needed: {problems.join('; ')}.</p>}
          <button type="button" disabled={busy || problems.length > 0} onClick={onPrepare}
            className="text-xs font-bold px-3 py-2 rounded-lg bg-rose-600 text-white disabled:opacity-50 cursor-pointer">
            {busy ? 'Preparing…' : 'Prepare the bundle'}
          </button>
        </div>
      )}
      {deliverFor && (
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
          {delivery.recorded ? (
            <p className="text-xs font-bold text-emerald-700">Delivery recorded.</p>
          ) : (
            <>
              <p className="text-[11px] font-bold text-slate-500">When you hand it over, write it down:</p>
              <input aria-label="How it was delivered" value={delivery.method} onChange={(e) => onDelivery({ ...delivery, method: e.target.value })} placeholder="How (for example: email to the station's official address, in person)" className={field} />
              <input aria-label="Address it was delivered to" value={delivery.address} onChange={(e) => onDelivery({ ...delivery, address: e.target.value })} placeholder="To whom and where" className={field} />
              <button type="button" disabled={busy || delivery.method.trim().length < 3 || delivery.address.trim().length < 3} onClick={onRecordDelivery}
                className="text-xs font-bold px-3 py-2 rounded-lg bg-[#15803D] text-white disabled:opacity-50 cursor-pointer">Record the delivery</button>
            </>
          )}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-1.5 mt-3 text-xs text-rose-600 font-semibold">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
};
