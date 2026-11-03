import React from 'react';
import { Bell, BellOff } from 'lucide-react';
import type { WatcherDef, WatcherId } from '../lib/adminAlerts';
import type { DesktopStatus } from '../lib/desktopBridge';
import { formatSast } from '../lib/walletAdmin';

// The Notifications screen: what the background alerts are doing on THIS computer, a switch per kind of alert (only the kinds this admin's role may see),
// mute, and a test button. The page (pages/Notifications.tsx) holds the state; this draws it, so a test can draw it to markup.
// `status` is null when this is not the installed Windows app (a normal browser has no background alerts) or while it is being read.
interface Props {
  inDesktopApp: boolean;
  status: DesktopStatus | null;
  watchers: WatcherDef[];
  disabled: WatcherId[];
  busy: boolean;
  testSent: boolean | null;
  onToggleWatcher: (id: WatcherId, on: boolean) => void;
  onMute: (muted: boolean, hours?: number) => void;
  onTest: () => void;
}

export const NotificationsBody: React.FC<Props> = ({ inDesktopApp, status, watchers, disabled, busy, testSent, onToggleWatcher, onMute, onTest }) => {
  const muteText = !status?.muted ? 'On' : status.mutedUntil ? `Muted until ${formatSast(new Date(status.mutedUntil).toISOString())}` : 'Muted';
  return (
    <div data-notifications>
      <h1 className="text-2xl font-extrabold text-[#0F172A] mb-1">Notifications</h1>
      <p className="text-sm text-slate-500 mb-5 max-w-2xl">
        The installed Tutorlage Admin app keeps running in the background, even with its window closed (look for its icon by the clock), and shows a Windows
        notification when something needs you, the way WhatsApp does. Clicking it opens the right page. It checks every 2 minutes.
        A notification only says what and how many, never a name, an amount or a document.
      </p>

      {!inDesktopApp ? (
        <div data-not-desktop className="bg-white rounded-2xl border border-slate-200 p-5 max-w-2xl text-sm text-slate-600">
          Background notifications only run in the installed Tutorlage Admin app on Windows. This page is open in a browser, so nothing is sent from here.
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-slate-200 p-5 max-w-2xl mb-5">
            <div className="flex items-center gap-3 flex-wrap">
              {status?.muted ? <BellOff className="w-5 h-5 text-amber-600" /> : <Bell className="w-5 h-5 text-[#15803D]" />}
              <div className="flex-1 min-w-[10rem]">
                <div className="text-sm font-extrabold text-[#0F172A]" data-mute-state>Notifications on this computer: {status ? muteText : 'checking...'}</div>
                <div className="text-xs text-slate-500">
                  {status?.autostart ? 'Starts with Windows.' : status ? 'Does not start with Windows (switch it on in the tray menu).' : ''}
                  {status && !status.notificationsSupported ? ' Windows says it cannot show notifications here: check Settings, System, Notifications.' : ''}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                {status?.muted ? (
                  <button type="button" disabled={busy} onClick={() => onMute(false)} className="px-3 py-2 rounded-xl text-xs font-bold bg-[#15803D] text-white disabled:opacity-50 cursor-pointer">
                    Turn notifications back on
                  </button>
                ) : (
                  <>
                    <button type="button" disabled={busy || !status} onClick={() => onMute(true, 1)} className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 disabled:opacity-50 cursor-pointer">
                      Mute for 1 hour
                    </button>
                    <button type="button" disabled={busy || !status} onClick={() => onMute(true)} className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 disabled:opacity-50 cursor-pointer">
                      Mute until I turn them on
                    </button>
                  </>
                )}
                <button type="button" disabled={busy || !status} onClick={onTest} className="px-3 py-2 rounded-xl text-xs font-bold border border-slate-300 text-slate-700 disabled:opacity-50 cursor-pointer">
                  Send a test notification
                </button>
              </div>
            </div>
            {testSent === true && <p className="text-xs font-semibold text-[#15803D] mt-3" data-test-sent>Sent. Look at the bottom right of the screen; if nothing appeared, see the note below.</p>}
            {testSent === false && <p className="text-xs font-semibold text-rose-600 mt-3" data-test-failed>Windows did not accept the notification. See the note below.</p>}
            <p className="text-[11px] text-slate-400 mt-3">
              While muted nothing is checked; when you turn them back on, what arrived in between comes as one notification. If you see nothing at all: Windows Settings,
              System, Notifications, make sure Notifications is on and that Tutorlage Admin is switched on in the list, and that Do not disturb is off.
            </p>
          </div>

          <h2 className="text-sm font-extrabold text-[#0F172A] mb-2">What you are told about</h2>
          {watchers.length === 0 ? (
            <p className="text-sm text-slate-500">Your role has no alerts.</p>
          ) : (
            <ul className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 max-w-2xl" data-watchers>
              {watchers.map((w) => {
                const on = !disabled.includes(w.id);
                return (
                  <li key={w.id} className="flex items-start gap-3 px-5 py-3">
                    <input
                      id={`alert-${w.id}`}
                      type="checkbox"
                      checked={on}
                      onChange={(e) => onToggleWatcher(w.id, e.target.checked)}
                      className="mt-1 w-4 h-4 accent-[#15803D] cursor-pointer"
                    />
                    <label htmlFor={`alert-${w.id}`} className="flex-1 cursor-pointer">
                      <div className="text-sm font-bold text-[#0F172A]">{w.label}</div>
                      <div className="text-xs text-slate-500">{w.help}</div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
};
