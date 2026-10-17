// Tutorlage Admin as a Windows desktop app (CEO, 17 Oct 2026: "how to install it as an app onto my desktop").
// It is the same admin app (admin/src), built once (`npm run build` in admin/) and shown in its own window: no terminal, no
// dev server, no browser tabs. The pages are served from the built files through a private address (tutorlage://admin) so that
// the sign-in is remembered between runs; everything else (sign-in, the database, the audit log) is exactly the admin app.
// Documents and links the admin app opens in a new tab open in the normal browser instead.
const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SMOKE = process.argv.includes('--smoke');
const ORIGIN = 'tutorlage://admin';
// Packaged: the built admin app sits beside the program (resources/app-dist). Run from the folder: admin/dist.
const DIST = path.resolve(app.isPackaged ? path.join(process.resourcesPath, 'app-dist') : path.join(__dirname, '..', 'dist'));

app.setName('Tutorlage Admin');
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: !SMOKE,
    title: 'Tutorlage Admin',
    backgroundColor: '#0A192F',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
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
  const win = createWindow();

  if (SMOKE) {
    // A check, not a feature: load the app without showing it, say what it drew, and quit.
    win.webContents.on('did-fail-load', (_e, code, description) => {
      console.log(JSON.stringify({ ok: false, failed: description, code }));
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
      console.log(JSON.stringify({ ok: true, ...result }));
      app.exit(result.hasPasswordField ? 0 : 2);
    });
  }
});

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => app.quit());
