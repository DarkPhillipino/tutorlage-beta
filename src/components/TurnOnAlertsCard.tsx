import React, { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import {
  PUSH_COPY as COPY, fetchPushConfig, fetchPushSettings, pushSupport, readPushEnvironment, realBrowser, savePushSettings, turnOffAlerts, turnOnAlerts,
  type PushConfig, type PushDb, type PushSettings,
} from '../lib/webPush';

const hours = Array.from({ length: 24 }, (_, h) => h);
const label = (h: number) => `${String(h).padStart(2, '0')}:00`;

// "Turn on alerts" on the Teach screen (RUN 6, 24 Nov 2026). HIDDEN while the database setting web_push_enabled is off (it is off until the Worker sender is live): the card renders nothing at all, makes no
// browser permission request and registers no service worker. Anything that goes wrong at load shows nothing extra (the Teach screen is never held up by this card).
export const TurnOnAlertsCard: React.FC<{ db?: PushDb }> = ({ db = supabase as unknown as PushDb }) => {
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [settings, setSettings] = useState<PushSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const support = pushSupport(readPushEnvironment());

  useEffect(() => {
    let live = true;
    fetchPushConfig(db).then(async (c) => {
      if (!live) return;
      setConfig(c);
      if (c.enabled) setSettings(await fetchPushSettings(db));
    });
    return () => {
      live = false;
    };
  }, [db]);

  if (!config?.enabled || !settings) return null;

  const reload = async () => setSettings(await fetchPushSettings(db));
  const on = async () => {
    setBusy(true);
    setProblem(await turnOnAlerts(db, realBrowser(), config));
    await reload();
    setBusy(false);
  };
  const off = async () => {
    setBusy(true);
    setProblem(await turnOffAlerts(db, realBrowser()));
    await reload();
    setBusy(false);
  };
  const save = async (next: Partial<Omit<PushSettings, 'devices'>>) => {
    const merged = { alertsOn: settings.alertsOn, quietOn: settings.quietOn, quietStart: settings.quietStart, quietEnd: settings.quietEnd, ...next };
    setSettings({ ...settings, ...merged });
    setProblem(await savePushSettings(db, merged));
  };

  return (
    <div className="bg-[#FAF7F2] rounded-2xl p-4 border border-slate-200 space-y-2" data-testid="turn-on-alerts-card">
      <div className="flex items-center space-x-1.5">
        <BellRing className="w-3.5 h-3.5 text-[#15803D]" aria-hidden="true" />
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{COPY.title}</span>
      </div>
      <p className="text-xs text-slate-600">{COPY.intro}</p>
      {support === 'unsupported' && <p className="text-xs text-slate-600">{COPY.unsupported}</p>}
      {support === 'ios_needs_home_screen' && <p className="text-xs text-slate-600">{COPY.iphoneSteps}</p>}
      {support === 'ok' && settings.devices === 0 && (
        <>
          <p className="text-xs text-slate-600">{COPY.android}</p>
          <button type="button" onClick={on} disabled={busy} className="w-full py-2.5 rounded-xl bg-[#15803D] text-white text-sm font-bold disabled:opacity-60 cursor-pointer">{COPY.turnOn}</button>
        </>
      )}
      {support === 'ok' && settings.devices > 0 && (
        <>
          <p className="text-xs font-semibold text-[#15803D]">{COPY.on}</p>
          <label className="flex items-center space-x-2 text-xs text-slate-700">
            <input type="checkbox" checked={settings.alertsOn} onChange={(e) => save({ alertsOn: e.target.checked })} />
            <span>{COPY.switchLabel}</span>
          </label>
          <label className="flex items-center space-x-2 text-xs text-slate-700">
            <input type="checkbox" checked={settings.quietOn} onChange={(e) => save({ quietOn: e.target.checked })} />
            <span>{COPY.quietLabel}</span>
          </label>
          {settings.quietOn && (
            <div className="flex items-center space-x-2 text-xs text-slate-700">
              <select aria-label="Quiet hours start" value={settings.quietStart} onChange={(e) => save({ quietStart: Number(e.target.value) })} className="border border-slate-300 rounded-lg px-2 py-1">
                {hours.map((h) => <option key={h} value={h}>{label(h)}</option>)}
              </select>
              <span>to</span>
              <select aria-label="Quiet hours end" value={settings.quietEnd} onChange={(e) => save({ quietEnd: Number(e.target.value) })} className="border border-slate-300 rounded-lg px-2 py-1">
                {hours.map((h) => <option key={h} value={h}>{label(h)}</option>)}
              </select>
            </div>
          )}
          {settings.quietOn && <p className="text-[11px] text-slate-500">{COPY.quietNote}</p>}
          <button type="button" onClick={off} disabled={busy} className="text-xs font-semibold text-slate-500 underline cursor-pointer">{COPY.turnOff}</button>
        </>
      )}
      <p className="text-[11px] text-slate-500">{COPY.honest}</p>
      {problem && <p role="alert" className="text-xs text-red-700">{problem}</p>}
    </div>
  );
};
