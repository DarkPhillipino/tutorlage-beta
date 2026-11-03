// Tutorlage Admin as a Windows desktop app (CEO, 17 Oct 2026: "how to install it as an app onto my desktop").
// It is the same admin app (admin/src), built once (`npm run build` in admin/) and shown in its own window: no terminal, no
// dev server, no browser tabs. The pages are served from the built files through a private address (tutorlage://admin) so that
// the sign-in is remembered between runs; everything else (sign-in, the database, the audit log) is exactly the admin app.
// Documents and links the admin app opens in a new tab open in the normal browser instead.
//
// WALLET PHASE 5 (CEO, 2 Nov 2026: "it should run in the background"): the app now starts with Windows (hidden), lives in the tray (the icon by the clock),
// and closing the window HIDES it instead of quitting; "Quit" in the tray menu is the only way out. The signed-in admin page checks every 2 minutes for things
// that need a person (admin/src/lib/adminAlerts.ts) and asks THIS program to show a Windows notification; a click opens the right page. This program also
// keeps the admin's sign-in encrypted with Windows (safeStorage), mutes notifications (tray menu), and sends no data anywhere: it only shows what the page gives it.
const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, net, powerMonitor, protocol, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SMOKE = process.argv.includes('--smoke');
const SMOKE_TOAST = SMOKE && process.argv.includes('--smoke-toast');   // also show one real notification and say whether Windows accepted it
const SMOKE_TRAY = SMOKE && process.argv.includes('--smoke-tray');     // also try the tray, hide-on-close, a notification click and mute for real
const START_HIDDEN = !SMOKE && process.argv.includes('--hidden');       // started by Windows at sign-in: no window until asked
const ORIGIN = 'tutorlage://admin';
// Packaged: the built admin app sits beside the program (resources/app-dist). Run from the folder: admin/dist.
const DIST = path.resolve(app.isPackaged ? path.join(process.resourcesPath, 'app-dist') : path.join(__dirname, '..', 'dist'));

app.setName('Tutorlage Admin');
// The same id the installer gives the shortcut (build.appId), so Windows shows the notifications under the name and icon "Tutorlage Admin".
app.setAppUserModelId('com.tutorlage.admin');
// A smoke check runs in its own throw-away profile, so it never touches a running copy's sign-in or settings.
let smokeProfile = null;
if (SMOKE) {
  smokeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'tutorlage-admin-smoke-'));
  app.setPath('userData', smokeProfile);
}
protocol.registerSchemesAsPrivileged([{ scheme: 'tutorlage', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// A second click on the icon brings the open window forward instead of opening another copy.
const gotLock = SMOKE || app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function serveFile(request) {
  const url = new URL(request.url);
  let file = path.resolve(path.join(DIST, decodeURIComponent(url.pathname)));
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return new Response('Not found', { status: 404 });
  // The admin app's own pages (/verification, /levels ...) are not files: every address that is not a file gets the app.
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  return net.fetch(pathToFileURL(file).toString());
}

// ---- what this PC remembers: settings, and the sign-in (encrypted) ----------------------------------------------------------------------------------
const userFile = (name) => path.join(app.getPath('userData'), name);
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
// Written to a temporary file first and then renamed, so a power cut never leaves half a file.
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

// The admin's sign-in (supabase-js tokens). Encrypted with Windows (DPAPI, tied to this Windows user) before it touches the disk; if Windows cannot encrypt,
// nothing is written (the page then keeps the sign-in in memory until the app quits). Never a password; never plain text.
const SECURE_FILE = 'secure-session.json';
const KEY_OK = /^[A-Za-z0-9_.:-]{1,200}$/;
function secureGet(key) {
  if (!KEY_OK.test(key) || !safeStorage.isEncryptionAvailable()) return null;
  const encoded = readJson(userFile(SECURE_FILE), {})[key];
  if (typeof encoded !== 'string') return null;
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  } catch {
    return null;
  }
}
function secureSet(key, value) {
  if (!KEY_OK.test(key) || typeof value !== 'string' || value.length > 200000 || !safeStorage.isEncryptionAvailable()) return false;
  const store = readJson(userFile(SECURE_FILE), {});
  store[key] = safeStorage.encryptString(value).toString('base64');
  writeJson(userFile(SECURE_FILE), store);
  return true;
}
function secureRemove(key) {
  if (!KEY_OK.test(key)) return false;
  const store = readJson(userFile(SECURE_FILE), {});
  if (key in store) {
    delete store[key];
    writeJson(userFile(SECURE_FILE), store);
  }
  return true;
}

// Mute, start-with-Windows and the one-time "still running" hint. (Which kinds of alert are on is the admin's choice on the Notifications page.)
const SETTINGS_FILE = 'alert-settings.json';
let settings = { muted: false, mutedUntil: null, autostart: true, hintShown: false };
function loadSettings() {
  const raw = readJson(userFile(SETTINGS_FILE), {});
  settings = {
    muted: raw.muted === true,
    mutedUntil: typeof raw.mutedUntil === 'number' && Number.isFinite(raw.mutedUntil) ? raw.mutedUntil : null,
    autostart: raw.autostart !== false,
    hintShown: raw.hintShown === true,
  };
}
const saveSettings = () => {
  try {
    writeJson(userFile(SETTINGS_FILE), settings);
  } catch {
    // not writable: the setting lasts until quit
  }
};

// ---- the window and the tray ----------------------------------------------------------------------------------------------------------------------
let mainWindow = null;
let tray = null;
let quitting = false;
let muteTimer = null;
const appIcon = () => nativeImage.createFromPath(path.join(__dirname, 'icon.png'));

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: !SMOKE && !START_HIDDEN,
    title: 'Tutorlage Admin',
    backgroundColor: '#0A192F',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    // backgroundThrottling off: the page keeps its 2-minute checks and its sign-in refresh running while the window is hidden in the tray.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs'), backgroundThrottling: false },
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  // Closing the window hides it; the app keeps watching. "Quit" in the tray menu (or Windows shutting down) really closes it.
  win.on('close', (event) => {
    if (quitting || (SMOKE && !SMOKE_TRAY)) return;
    event.preventDefault();
    win.hide();
    if (!settings.hintShown) {
      settings.hintShown = true;
      saveSettings();
      showToast({ title: 'Tutorlage Admin is still running', body: 'It keeps watching in the background. Right-click the icon by the clock to mute it or quit.', route: '/notifications' });
    }
  });
  win.on('session-end', () => {
    quitting = true;
  });
  // Anything that is not the admin app itself opens in the normal browser (signed document links, a tutor's profile link).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  win.loadURL(`${ORIGIN}/`);
  return win;
}

const send = (channel, payload) => {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(channel, payload);
};

// A page address inside the admin app only ("/payouts?wallet=topups"): no scheme, no host.
const validRoute = (route) => typeof route === 'string' && route.length <= 120 && /^\/[A-Za-z0-9_\-/]*(\?[A-Za-z0-9_=&-]*)?$/.test(route);

function openWindow(route) {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (validRoute(route)) {
    const go = () => win.webContents.send('alerts:navigate', route);
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', go);
    else go();
  }
}

// ---- mute -----------------------------------------------------------------------------------------------------------------------------------------
function isMuted() {
  if (!settings.muted) return false;
  if (settings.mutedUntil !== null && Date.now() >= settings.mutedUntil) {
    settings.muted = false;
    settings.mutedUntil = null;
    saveSettings();
    return false;
  }
  return true;
}
const status = () => ({ muted: isMuted(), mutedUntil: settings.muted ? settings.mutedUntil : null, autostart: settings.autostart, notificationsSupported: Notification.isSupported() });
function statusChanged(checkNow) {
  refreshTray();
  send('alerts:status-changed', status());
  if (checkNow) send('alerts:check-now');
}
function scheduleUnmute() {
  clearTimeout(muteTimer);
  if (settings.muted && settings.mutedUntil !== null) {
    muteTimer = setTimeout(() => {
      isMuted();
      statusChanged(true);
    }, Math.min(Math.max(settings.mutedUntil - Date.now(), 0) + 1000, 2147483000));
  }
}
function setMuted(muted, hours) {
  const h = Number(hours);
  settings.muted = !!muted;
  settings.mutedUntil = muted && Number.isFinite(h) && h > 0 && h <= 72 ? Date.now() + h * 3600000 : null;
  saveSettings();
  scheduleUnmute();
  statusChanged(!muted); // turning notifications back on checks at once, so what arrived while muted comes as one notification
  return status();
}
// Only the installed program registers itself with Windows (not a run from the folder, not a smoke check).
function applyAutostart() {
  if (!app.isPackaged || SMOKE) return;
  try {
    app.setLoginItemSettings({ openAtLogin: settings.autostart, path: process.execPath, args: ['--hidden'] });
  } catch {
    // Windows refused: the app still works, it just does not start by itself
  }
}
function setAutostart(on) {
  settings.autostart = !!on;
  saveSettings();
  applyAutostart();
  statusChanged(false);
}

// ---- notifications --------------------------------------------------------------------------------------------------------------------------------
const clip = (text, max) => (String(text).length <= max ? String(text) : `${String(text).slice(0, max - 1)}…`);
const alive = new Set(); // a notification that is not referenced can be collected before it is clicked
function showToast(toast) {
  if (!Notification.isSupported()) return null;
  const note = new Notification({ title: clip(toast.title, 80), body: clip(toast.body, 250), icon: appIcon(), silent: false });
  alive.add(note);
  if (alive.size > 60) alive.delete(alive.values().next().value);
  const done = () => alive.delete(note);
  note.on('click', () => {
    done();
    openWindow(toast.route);
  });
  note.on('close', done);
  note.on('failed', done);
  note.show();
  return note;
}
// Resolves true when Windows accepted the notification ('show'), false when it refused or said nothing for 4 seconds.
function showToastChecked(toast) {
  return new Promise((resolve) => {
    const note = showToast(toast);
    if (!note) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => resolve(false), 4000);
    note.once('show', () => {
      clearTimeout(timer);
      resolve(true);
    });
    note.once('failed', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}
const TEST_TOAST = { title: 'Tutorlage Admin: test', body: 'If you can read this, notifications work on this computer. Click it to open the Notifications page.', route: '/notifications' };

function refreshTray() {
  if (!tray) return;
  const muted = isMuted();
  tray.setToolTip(muted ? 'Tutorlage Admin (notifications muted)' : 'Tutorlage Admin');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Tutorlage Admin', click: () => openWindow() },
      { type: 'separator' },
      muted ? { label: 'Turn notifications back on', click: () => setMuted(false) } : { label: 'Mute notifications', click: () => setMuted(true) },
      { label: 'Mute for 1 hour', click: () => setMuted(true, 1) },
      { label: 'Send a test notification', click: () => void showToastChecked(TEST_TOAST) },
      { type: 'separator' },
      { label: 'Start with Windows', type: 'checkbox', checked: settings.autostart, click: (item) => setAutostart(item.checked) },
      { type: 'separator' },
      {
        label: 'Quit Tutorlage Admin (stops notifications)',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}
function createTray() {
  tray = new Tray(appIcon().resize({ width: 16, height: 16 }));
  tray.on('click', () => openWindow());
  refreshTray();
}

// ---- what the page may ask (each call is checked again here; only our own pages are listened to) ------------------------------------------------------
function fromOurPage(event) {
  const url = (event.senderFrame && event.senderFrame.url) || '';
  return url.startsWith(ORIGIN);
}
function guarded(handler) {
  return (event, ...args) => {
    if (!fromOurPage(event)) throw new Error('Not allowed.');
    return handler(...args);
  };
}
ipcMain.handle('secure:get', guarded((key) => secureGet(String(key))));
ipcMain.handle('secure:set', guarded((key, value) => secureSet(String(key), value)));
ipcMain.handle('secure:remove', guarded((key) => secureRemove(String(key))));
ipcMain.handle('alerts:isMuted', guarded(() => isMuted()));
ipcMain.handle('alerts:status', guarded(() => status()));
ipcMain.handle('alerts:setMuted', guarded((muted, hours) => setMuted(muted, hours)));
ipcMain.handle('alerts:test', guarded(() => showToastChecked(TEST_TOAST)));
ipcMain.handle(
  'alerts:notify',
  guarded((toast) => {
    if (isMuted() || !toast || typeof toast.title !== 'string' || typeof toast.body !== 'string') return false;
    const route = validRoute(toast.route) ? toast.route : '/';
    return !!showToast({ title: toast.title, body: toast.body, route });
  }),
);

// ---- start ----------------------------------------------------------------------------------------------------------------------------------------
function cleanUpSmoke() {
  if (smokeProfile) {
    try {
      fs.rmSync(smokeProfile, { recursive: true, force: true });
    } catch {
      // the temp folder is cleared by Windows later
    }
  }
}

// --smoke-tray: what a person does with the running app, done by the program itself on the throw-away profile: close the window (it must hide, not quit),
// click a notification (the window must come back and the page must be told where to go), mute (a muted notification must not show) and unmute (the page
// is told to check at once). Shows two or three real notifications and a tray icon for a second. Only a check; nothing here runs in normal use.
async function trayChecks(win) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const page = (js) => win.webContents.executeJavaScript(js);
  const report = {};
  createTray();
  report.trayCreated = !!tray && !tray.isDestroyed();
  await page(`window.__navs = []; window.__checks = 0; window.tutorlageDesktop.onNavigate((r) => window.__navs.push(r)); window.tutorlageDesktop.onCheckNow(() => { window.__checks += 1; }); true;`);
  win.show();
  win.close();
  report.hiddenNotQuit = !win.isDestroyed() && !win.isVisible();
  // A hidden window must keep its timers running (the 2-minute check lives in the page). `info` is only reported: the sign-in library stops its own refresh
  // ticker while the page says it is hidden, so the checks themselves ask for a fresh token every round (getSession() refreshes one that is near its end).
  report.timersRunWhileHidden = (await page(`new Promise((resolve) => { let n = 0; const t = setInterval(() => { n += 1; }, 100); setTimeout(() => { clearInterval(t); resolve(n); }, 1000); })`)) >= 8;
  report.info = { visibilityWhenHidden: await page('document.visibilityState') };
  const note = showToast({ title: 'Tutorlage Admin: smoke check', body: 'Click test. You can ignore this.', route: '/notifications' });
  if (note) note.emit('click');
  await wait(600);
  report.clickBringsWindowBack = win.isVisible();
  report.clickNavigates = (await page('window.__navs')).includes('/notifications');
  const muted = await page(`window.tutorlageDesktop.setMuted(true, 1)`);
  report.mutedWhileMuted = muted.muted === true && typeof muted.mutedUntil === 'number';
  report.noToastWhileMuted = (await page(`window.tutorlageDesktop.notify({ title: 'x', body: 'y', route: '/' })`)) === false;
  const unmuted = await page(`window.tutorlageDesktop.setMuted(false)`);
  await wait(300);
  report.unmuteChecksAtOnce = unmuted.muted === false && (await page('window.__checks')) >= 1;
  report.badRouteBecomesRoot = (await page(`window.tutorlageDesktop.notify({ title: 'Tutorlage Admin: smoke check', body: 'Address test. You can ignore this.', route: 'https://evil.example' })`)) === true;
  report.ok = Object.entries(report).filter(([key]) => key !== 'info').every(([, value]) => value === true);
  tray.destroy();
  tray = null;
  return report;
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  protocol.handle('tutorlage', serveFile);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    ]),
  );
  loadSettings();
  const win = createWindow();

  if (SMOKE) {
    // A check, not a feature: load the app without showing it, say what it drew, prove the encrypted store works and holds no plain text, and quit.
    win.webContents.on('did-fail-load', (_e, code, description) => {
      console.log(JSON.stringify({ ok: false, failed: description, code }));
      cleanUpSmoke();
      app.exit(1);
    });
    win.webContents.on('did-finish-load', async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const result = await win.webContents.executeJavaScript(`({
        url: location.href,
        title: document.title,
        heading: document.querySelector('h1')?.textContent ?? null,
        hasPasswordField: !!document.querySelector('input[type="password"]'),
        externalCss: [...document.styleSheets].length,
      })`);
      // The desktop bridge, seen from the page: a secret goes in through the page's own call, comes back, and must NOT be readable in the file on disk.
      const probe = `smoke-secret-${Math.random().toString(36).slice(2)}-${Date.now()}`;
      const bridge = await win.webContents.executeJavaScript(`(async () => {
        const d = window.tutorlageDesktop;
        if (!d) return { present: false };
        const stored = await d.secureStorage.setItem('smoke-probe', ${JSON.stringify(probe)});
        const back = await d.secureStorage.getItem('smoke-probe');
        return { present: true, stored, roundTrip: back === ${JSON.stringify(probe)}, status: await d.getStatus(), muted: await d.isMuted() };
      })()`);
      let fileText = '';
      try {
        fileText = fs.readFileSync(userFile(SECURE_FILE), 'utf8');
      } catch {
        // none written
      }
      const secure = {
        encryptionAvailable: safeStorage.isEncryptionAvailable(),
        roundTrip: bridge.roundTrip === true,
        fileExists: fileText.length > 0,
        plainTextOnDisk: fileText.includes(probe),
      };
      await win.webContents.executeJavaScript(`window.tutorlageDesktop ? window.tutorlageDesktop.secureStorage.removeItem('smoke-probe') : null`);
      let toast = 'not asked';
      if (SMOKE_TOAST) {
        toast = (await showToastChecked({ title: 'Tutorlage Admin: smoke check', body: 'A check of the notification system. You can ignore this.', route: '/' })) ? 'shown' : 'not shown';
      }
      const tray = SMOKE_TRAY ? await trayChecks(win) : 'not asked';
      console.log(JSON.stringify({ ok: true, ...result, bridge: bridge.present, secure, notificationsSupported: bridge.status ? bridge.status.notificationsSupported : null, toast, tray }));
      cleanUpSmoke();
      const secureOk = bridge.present && secure.encryptionAvailable && secure.roundTrip && !secure.plainTextOnDisk;
      app.exit(result.hasPasswordField && secureOk && (!SMOKE_TRAY || tray.ok) ? 0 : 2);
    });
    return;
  }

  scheduleUnmute();
  applyAutostart();
  createTray();
  // Waking from sleep or unlocking the screen: check at once (the page shows ONE catch-up notification if it was away for a while).
  powerMonitor.on('resume', () => send('alerts:check-now'));
  powerMonitor.on('unlock-screen', () => send('alerts:check-now'));
});

// A second click on the icon (or on the desktop shortcut) brings the running copy forward, even if it is hidden in the tray.
app.on('second-instance', () => openWindow());
app.on('before-quit', () => {
  quitting = true;
});
// The window being closed does not end the app: it lives in the tray. Only a smoke check ends with its window.
app.on('window-all-closed', () => {
  if (SMOKE) app.quit();
});
