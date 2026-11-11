import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { BASE_PATH } from '../lib/siteUrl';
import { SUPPORT_EMAIL } from '../lib/businessInfo';
import { capsGradeBand } from '../lib/subjectGradeDefaults';
import {
  EMPTY_FOUNDING_FORM, FOUNDING_COPY, FOUNDING_MAX_SUBJECTS, SHOW_PERSONAL_LINK_LINE,
  buildJoinPayload, countingSwitchedOff, getFirstTag, getVisitorId, joinFoundingList, logFoundingEvent, looksLikeBot, noticeBody, srcFromSearch, validateFoundingForm,
  type FormErrors, type FoundingClient, type FoundingEvent, type FoundingForm, type FoundingLists, type SubjectPick, type VisitorStore,
} from '../lib/foundingList';

// THE FOUNDING TUTORS LIST PAGE: tutorlage.com/teach (CEO, 10 Nov 2026). Not shown in search engines (pageMeta.ts + a noindex line while it is open), not linked from
// anywhere public. Mobile first and light on data: no images, one small read of the subject and grade lists once the page has drawn, and one call to join.
// The words are in src/lib/foundingList.ts (from Drake/marketing-gtm/founding-tutors-drafts-2026-11-10.md). The page counts four things for the admin (opens by
// ?src= tag, "See more" opens, form starts and, in the database, joins) against a random id kept in the browser; it holds no personal data.
const db = supabase as unknown as FoundingClient;

const field = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#15803D]/30 focus:border-[#15803D]';
const buttonBase = 'inline-flex items-center justify-center min-h-12 px-5 rounded-xl font-bold text-sm transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed';

function safeStorage(): VisitorStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Keeps the page out of search results while it is open, even in a browser that never saw the build's own line. Put back as it was on the way out.
function useNoIndex(): void {
  useEffect(() => {
    const tag = document.querySelector('meta[name="robots"]');
    const before = tag?.getAttribute('content') ?? null;
    tag?.setAttribute('content', 'noindex');
    return () => {
      if (tag && before !== null) tag.setAttribute('content', before);
    };
  }, []);
}

const Field: React.FC<{ id: string; label: string; hint?: string; error?: string; children: React.ReactNode }> = ({ id, label, hint, error, children }) => (
  <div data-error={error ? 'true' : undefined}>
    <label htmlFor={id} className="block text-sm font-bold text-[#0F172A] mb-1">{label}</label>
    {hint && <p id={`${id}-hint`} className="text-xs text-slate-500 mb-1.5">{hint}</p>}
    {children}
    {error && <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-semibold text-rose-700">{error}</p>}
  </div>
);

const Choices: React.FC<{
  name: string; legend: string; options: ReadonlyArray<{ value: string; label: string }>; value: string; onChange: (v: string) => void; error?: string; inline?: boolean;
}> = ({ name, legend, options, value, onChange, error, inline }) => (
  <fieldset data-error={error ? 'true' : undefined} aria-describedby={error ? `${name}-error` : undefined}>
    <legend className="block text-sm font-bold text-[#0F172A] mb-1.5">{legend}</legend>
    <div className={inline ? 'flex flex-wrap gap-2' : 'space-y-2'}>
      {options.map((o) => (
        <label key={o.value} className={`flex items-center gap-3 rounded-xl border px-3 min-h-12 cursor-pointer text-sm ${value === o.value ? 'border-[#15803D] bg-emerald-50' : 'border-slate-300 bg-white'}`}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="h-5 w-5 accent-[#15803D]" />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
    {error && <p id={`${name}-error`} role="alert" className="mt-1.5 text-xs font-semibold text-rose-700">{error}</p>}
  </fieldset>
);

const Tick: React.FC<{ id: string; checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; error?: string }> = ({ id, checked, onChange, children, error }) => (
  <div data-error={error ? 'true' : undefined}>
    <label htmlFor={id} className={`flex items-start gap-3 rounded-xl border px-3 py-3 cursor-pointer text-sm leading-snug ${checked ? 'border-[#15803D] bg-emerald-50' : 'border-slate-300 bg-white'}`}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 mt-0.5 shrink-0 accent-[#15803D]" aria-describedby={error ? `${id}-error` : undefined} />
      <span>{children}</span>
    </label>
    {error && <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-semibold text-rose-700">{error}</p>}
  </div>
);

export default function FoundingTutors() {
  useNoIndex();
  // The tag this link carried (opens are counted under it) and the visitor's FIRST tag ever (See more, form starts and the join are filed under it).
  const src = useMemo(() => srcFromSearch(window.location.search), []);
  const firstTag = useMemo(() => getFirstTag(safeStorage(), src), [src]);
  const visitor = useMemo(() => getVisitorId(safeStorage()), []);
  // Nothing is counted in a browser that was switched off with ?nocount=1 (the CEO's and PM's), or in a scripted browser. The page only counts after it has run here, so a
  // link-preview fetch (which never runs this script) is never counted.
  const skipCount = useMemo(() => countingSwitchedOff(window.location.search, safeStorage()) || looksLikeBot(typeof navigator === 'undefined' ? null : navigator), []);
  const shownAt = useRef(Date.now());
  const [moreOpen, setMoreOpen] = useState(false);
  const [lists, setLists] = useState<FoundingLists>({ subjects: [], grades: [] });
  const [listsState, setListsState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [form, setForm] = useState<FoundingForm>(EMPTY_FOUNDING_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [website, setWebsite] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const counted = useRef<Record<FoundingEvent, boolean>>({ open: false, see_more: false, form_start: false, code_open: false });

  // Each count is sent at most once per page load (the database also limits each visitor).
  const count = useCallback((event: FoundingEvent) => {
    if (counted.current[event]) return;
    counted.current[event] = true;
    if (skipCount) return;
    void logFoundingEvent(db, visitor, event, src, firstTag);
  }, [visitor, src, firstTag, skipCount]);

  useEffect(() => {
    count('open');
  }, [count]);

  // The subject and grade lists are the app's own (the same ones the tutor's Subjects screen uses). Read once, after the page has drawn.
  const loadLists = useCallback(async () => {
    setListsState('loading');
    try {
      const [s, g] = await Promise.all([
        supabase.from('subjects').select('name').order('name'),
        supabase.from('grade_levels').select('name').order('sort_order'),
      ]);
      if (s.error || g.error || !s.data || !g.data) throw new Error('lists');
      setLists({ subjects: s.data.map((r) => String(r.name)), grades: g.data.map((r) => String(r.name)) });
      setListsState('ready');
    } catch {
      setListsState('failed');
    }
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => void loadLists(), 250);
    return () => window.clearTimeout(t);
  }, [loadLists]);

  const set = <K extends keyof FoundingForm>(key: K, value: FoundingForm[K]) => {
    count('form_start');
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key as keyof FormErrors]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const toggleAvailability = (value: string) => set('availability', form.availability.includes(value) ? form.availability.filter((v) => v !== value) : [...form.availability, value]);

  const setSubject = (index: number, patch: Partial<SubjectPick>) => {
    count('form_start');
    setForm((f) => {
      const rows = f.subjects.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        // Picking a Grade R to 9 subject starts the grades at the range CAPS teaches it in (a starting point only; the person can change both).
        if (patch.subject !== undefined && !row.minGrade && !row.maxGrade) {
          const band = capsGradeBand(patch.subject, lists.grades);
          if (band) {
            next.minGrade = band.min;
            next.maxGrade = band.max;
          }
        }
        return next;
      });
      return { ...f, subjects: rows };
    });
    if (errors.subjects) setErrors((e) => ({ ...e, subjects: undefined }));
  };
  const addSubject = () => {
    if (form.subjects.length >= FOUNDING_MAX_SUBJECTS) return;
    setForm((f) => ({ ...f, subjects: [...f.subjects, { subject: '', minGrade: '', maxGrade: '' }] }));
  };
  const removeSubject = (index: number) => setForm((f) => ({ ...f, subjects: f.subjects.length > 1 ? f.subjects.filter((_, i) => i !== index) : [{ subject: '', minGrade: '', maxGrade: '' }] }));

  const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const goToForm = () => {
    document.getElementById('founding-join')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    window.setTimeout(() => document.getElementById('f-fullName')?.focus({ preventScroll: true }), reduceMotion ? 0 : 350);
  };

  const toggleMore = () => {
    const next = !moreOpen;
    setMoreOpen(next);
    if (next) count('see_more');
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const found = validateFoundingForm(form, lists);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setProblem(FOUNDING_COPY.fixErrors);
      window.setTimeout(() => (document.querySelector('[data-error="true"] input, [data-error="true"] select, [data-error="true"] textarea') as HTMLElement | null)?.focus(), 0);
      return;
    }
    setProblem(null);
    setSending(true);
    const result = await joinFoundingList(db, buildJoinPayload(form, { elapsedMs: Date.now() - shownAt.current, website, src: firstTag, visitor }));
    setSending(false);
    if ('message' in result) {
      setProblem(result.message);
    } else {
      setDone(true);
      window.setTimeout(() => document.getElementById('founding-done')?.focus(), 0);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#0F172A]">
      <header className="max-w-xl mx-auto px-4 pt-5">
        <span className="text-2xl font-extrabold tracking-tight">Tutorlage</span>
      </header>

      <main className="max-w-xl mx-auto px-4 pb-16">
        <section className="pt-8 pb-6" aria-labelledby="founding-heading">
          <h1 id="founding-heading" className="font-serif text-3xl sm:text-4xl leading-tight mb-3">{FOUNDING_COPY.pageTitle}</h1>
          <p className="text-base text-slate-700 leading-relaxed mb-5">{FOUNDING_COPY.intro}</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <button type="button" onClick={goToForm} className={`${buttonBase} bg-[#15803D] hover:bg-[#166534] text-white`}>{FOUNDING_COPY.join}</button>
            <button
              type="button"
              onClick={toggleMore}
              aria-expanded={moreOpen}
              aria-controls="founding-more"
              className={`${buttonBase} gap-2 border border-slate-300 bg-white hover:border-[#15803D] text-[#0F172A]`}
            >
              {moreOpen ? FOUNDING_COPY.seeLess : FOUNDING_COPY.seeMore}
              <ChevronDown className={`w-4 h-4 transition-transform ${moreOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
          </div>
        </section>

        {moreOpen && (
          <section id="founding-more" aria-label="More about the list" className="bg-white rounded-2xl border border-slate-200 p-5 mb-8 space-y-5 text-sm leading-relaxed text-slate-700">
            <div>
              <h2 className="font-bold text-[#0F172A] mb-1">{FOUNDING_COPY.more.whatTitle}</h2>
              <p>{FOUNDING_COPY.more.what}</p>
            </div>
            <div>
              <h2 className="font-bold text-[#0F172A] mb-1">{FOUNDING_COPY.more.earnTitle}</h2>
              <p>{FOUNDING_COPY.more.earn}</p>
            </div>
            <div>
              <h2 className="font-bold text-[#0F172A] mb-1">{FOUNDING_COPY.more.howTitle}</h2>
              <p>{FOUNDING_COPY.more.how}</p>
            </div>
            <div>
              <h2 className="font-bold text-[#0F172A] mb-1">{FOUNDING_COPY.more.openTitle}</h2>
              <p>{FOUNDING_COPY.more.open}</p>
            </div>
            <div>
              <h2 className="font-bold text-[#0F172A] mb-1">{FOUNDING_COPY.more.docsTitle}</h2>
              <p className="mb-1">{FOUNDING_COPY.more.docsIntro}</p>
              <ul className="list-disc pl-5 space-y-0.5">
                {FOUNDING_COPY.more.docs.map((d) => <li key={d}>{d}</li>)}
              </ul>
              <p className="mt-2 font-semibold text-[#0F172A]">{FOUNDING_COPY.more.docsWarning}</p>
            </div>
            {SHOW_PERSONAL_LINK_LINE && (
              <div>
                <h2 className="font-bold text-[#0F172A] mb-1">{FOUNDING_COPY.more.linkTitle}</h2>
                <p>{FOUNDING_COPY.more.link}</p>
              </div>
            )}
            <div>
              <h2 className="font-bold text-[#0F172A] mb-1">{FOUNDING_COPY.more.whoTitle}</h2>
              <p>{FOUNDING_COPY.more.who}</p>
            </div>
            <button type="button" onClick={goToForm} className={`${buttonBase} bg-[#15803D] hover:bg-[#166534] text-white w-full sm:w-auto`}>{FOUNDING_COPY.join}</button>
          </section>
        )}

        <section id="founding-join" aria-labelledby="founding-form-heading" className="bg-white rounded-2xl border border-slate-200 p-5 scroll-mt-4">
          <h2 id="founding-form-heading" className="font-serif text-2xl mb-1">{FOUNDING_COPY.formTitle}</h2>

          {done ? (
            <div id="founding-done" tabIndex={-1} role="status" aria-live="polite" className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 p-4 outline-none">
              <p className="font-bold text-emerald-900">{FOUNDING_COPY.doneTitle}</p>
              <p className="text-sm text-emerald-900 mt-1">{FOUNDING_COPY.done}</p>
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate className="mt-2 space-y-5" aria-describedby="founding-form-intro">
              <p id="founding-form-intro" className="text-sm text-slate-600">{FOUNDING_COPY.formIntro}</p>

              {/* The bot trap: a field a person never sees or reaches. A bot that fills every field fills this one too. */}
              <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden' }}>
                <label htmlFor="f-website">Website</label>
                <input id="f-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>

              <Field id="f-fullName" label={FOUNDING_COPY.labels.fullName} error={errors.fullName}>
                <input id="f-fullName" name="name" type="text" autoComplete="name" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} className={field} aria-invalid={!!errors.fullName} aria-describedby={errors.fullName ? 'f-fullName-error' : undefined} maxLength={100} />
              </Field>
              <Field id="f-codeName" label={FOUNDING_COPY.labels.codeName} error={errors.codeName}>
                <input id="f-codeName" name="nickname" type="text" autoComplete="nickname" value={form.codeName} onChange={(e) => set('codeName', e.target.value)} className={field} aria-invalid={!!errors.codeName} aria-describedby={errors.codeName ? 'f-codeName-error' : undefined} maxLength={30} />
              </Field>
              <Field id="f-whatsapp" label={FOUNDING_COPY.labels.whatsapp} hint={FOUNDING_COPY.labels.whatsappHint} error={errors.whatsapp}>
                <input id="f-whatsapp" name="tel" type="tel" inputMode="tel" autoComplete="tel" value={form.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} className={field} aria-invalid={!!errors.whatsapp} aria-describedby={`f-whatsapp-hint${errors.whatsapp ? ' f-whatsapp-error' : ''}`} maxLength={30} />
              </Field>
              <Field id="f-email" label={FOUNDING_COPY.labels.email} error={errors.email}>
                <input id="f-email" name="email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={field} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'f-email-error' : undefined} maxLength={254} />
              </Field>
              <Tick id="f-adult" checked={form.isAdult} onChange={(v) => set('isAdult', v)} error={errors.isAdult}>{FOUNDING_COPY.labels.isAdult}</Tick>

              <fieldset data-error={errors.subjects ? 'true' : undefined} aria-describedby={errors.subjects ? 'f-subjects-error' : 'f-subjects-hint'}>
                <legend className="block text-sm font-bold text-[#0F172A] mb-1">{FOUNDING_COPY.labels.subjects}</legend>
                <p id="f-subjects-hint" className="text-xs text-slate-500 mb-2">{FOUNDING_COPY.labels.subjectsHint}</p>
                {listsState === 'loading' && <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Loading the subject list…</p>}
                {listsState === 'failed' && (
                  <p className="text-xs font-semibold text-rose-700">
                    We could not load the subject list. <button type="button" onClick={() => void loadLists()} className="underline font-bold cursor-pointer">Try again</button>
                  </p>
                )}
                {listsState === 'ready' && (
                  <div className="space-y-3">
                    {form.subjects.map((row, i) => (
                      <div key={i} className="rounded-xl border border-slate-200 bg-[#FAF7F2] p-3 space-y-2">
                        <div>
                          <label htmlFor={`f-subject-${i}`} className="block text-xs font-bold text-slate-600 mb-1">{FOUNDING_COPY.labels.subject}</label>
                          <select id={`f-subject-${i}`} value={row.subject} onChange={(e) => setSubject(i, { subject: e.target.value })} className={field}>
                            <option value="">{FOUNDING_COPY.labels.chooseSubject}</option>
                            {lists.subjects.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label htmlFor={`f-from-${i}`} className="block text-xs font-bold text-slate-600 mb-1">{FOUNDING_COPY.labels.fromGrade}</label>
                            <select id={`f-from-${i}`} value={row.minGrade} onChange={(e) => setSubject(i, { minGrade: e.target.value })} className={field}>
                              <option value="">Choose</option>
                              {lists.grades.map((g) => <option key={g} value={g}>{g}</option>)}
                            </select>
                          </div>
                          <div>
                            <label htmlFor={`f-to-${i}`} className="block text-xs font-bold text-slate-600 mb-1">{FOUNDING_COPY.labels.toGrade}</label>
                            <select id={`f-to-${i}`} value={row.maxGrade} onChange={(e) => setSubject(i, { maxGrade: e.target.value })} className={field}>
                              <option value="">Choose</option>
                              {lists.grades.map((g) => <option key={g} value={g}>{g}</option>)}
                            </select>
                          </div>
                        </div>
                        {form.subjects.length > 1 && (
                          <button type="button" onClick={() => removeSubject(i)} className="text-xs font-bold text-slate-500 hover:text-rose-700 underline cursor-pointer">{FOUNDING_COPY.labels.removeSubject}</button>
                        )}
                      </div>
                    ))}
                    {form.subjects.length < FOUNDING_MAX_SUBJECTS && (
                      <button type="button" onClick={addSubject} className={`${buttonBase} border border-slate-300 bg-white hover:border-[#15803D] w-full`}>{FOUNDING_COPY.labels.addSubject}</button>
                    )}
                  </div>
                )}
                {errors.subjects && <p id="f-subjects-error" role="alert" className="mt-1.5 text-xs font-semibold text-rose-700">{errors.subjects}</p>}
              </fieldset>

              <fieldset>
                <legend className="block text-sm font-bold text-[#0F172A] mb-1.5">{FOUNDING_COPY.labels.availability}</legend>
                <div className="space-y-2">
                  {FOUNDING_COPY.availabilityOptions.map((o) => (
                    <label key={o.value} className={`flex items-center gap-3 rounded-xl border px-3 min-h-12 cursor-pointer text-sm ${form.availability.includes(o.value) ? 'border-[#15803D] bg-emerald-50' : 'border-slate-300 bg-white'}`}>
                      <input type="checkbox" checked={form.availability.includes(o.value)} onChange={() => toggleAvailability(o.value)} className="h-5 w-5 accent-[#15803D]" />
                      <span>{o.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field id="f-weeks" label={FOUNDING_COPY.labels.unavailableWeeks}>
                <input id="f-weeks" type="text" value={form.unavailableWeeks} onChange={(e) => set('unavailableWeeks', e.target.value)} className={field} maxLength={200} />
              </Field>

              <Choices name="practicum" legend={FOUNDING_COPY.labels.practicum} options={FOUNDING_COPY.practicumOptions} value={form.practicum} onChange={(v) => set('practicum', v)} error={errors.practicum} />
              <Choices name="police" legend={FOUNDING_COPY.labels.police} options={FOUNDING_COPY.policeOptions} value={form.policeClearance} onChange={(v) => set('policeClearance', v)} error={errors.policeClearance} />
              <Choices name="reach" legend={FOUNDING_COPY.labels.reach} options={FOUNDING_COPY.reachOptions} value={form.parentReach} onChange={(v) => set('parentReach', v)} error={errors.parentReach} inline />
              <Choices name="willing" legend={FOUNDING_COPY.labels.reachWilling} options={FOUNDING_COPY.yesNo} value={form.parentReachWilling} onChange={(v) => set('parentReachWilling', v as 'yes' | 'no')} error={errors.parentReachWilling} inline />

              <Field id="f-prior" label={FOUNDING_COPY.labels.prior} error={errors.priorTutoring}>
                <textarea id="f-prior" rows={3} value={form.priorTutoring} onChange={(e) => set('priorTutoring', e.target.value)} className={field} maxLength={300} aria-invalid={!!errors.priorTutoring} aria-describedby={errors.priorTutoring ? 'f-prior-error' : undefined} />
              </Field>
              <Choices name="heard" legend={FOUNDING_COPY.labels.heard} options={FOUNDING_COPY.heardOptions} value={form.heardFrom} onChange={(v) => set('heardFrom', v)} inline />

              <fieldset>
                <legend className="block text-sm font-bold text-[#0F172A] mb-1.5">{FOUNDING_COPY.labels.haveTitle}</legend>
                <div className="space-y-2">
                  <Tick id="f-device" checked={form.hasDevice} onChange={(v) => set('hasDevice', v)}>{FOUNDING_COPY.have.device}</Tick>
                  <Tick id="f-connection" checked={form.hasConnection} onChange={(v) => set('hasConnection', v)}>{FOUNDING_COPY.have.connection}</Tick>
                  <Tick id="f-bank" checked={form.hasBank} onChange={(v) => set('hasBank', v)}>{FOUNDING_COPY.have.bank}</Tick>
                </div>
              </fieldset>

              <div className="space-y-2 pt-1">
                <Tick id="f-consent-contact" checked={form.consentContact} onChange={(v) => set('consentContact', v)} error={errors.consentContact}>{FOUNDING_COPY.consentContact}</Tick>
                <Tick id="f-consent-marketing" checked={form.consentMarketing} onChange={(v) => set('consentMarketing', v)}>{FOUNDING_COPY.consentMarketing}</Tick>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                <strong>{FOUNDING_COPY.noticeTitle}</strong> {noticeBody(SUPPORT_EMAIL)}{' '}
                <a href={`${BASE_PATH}/privacy`} target="_blank" rel="noopener noreferrer" className="underline font-semibold text-[#15803D]">{FOUNDING_COPY.privacyLink}</a>
              </p>

              {problem && <p role="alert" className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2.5 text-sm font-semibold text-rose-700">{problem}</p>}
              <button type="submit" disabled={sending} className={`${buttonBase} w-full bg-[#15803D] hover:bg-[#166534] text-white`}>
                {sending ? (<><Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" />{FOUNDING_COPY.sending}</>) : FOUNDING_COPY.submit}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
