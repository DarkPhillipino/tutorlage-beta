// The bridge between the admin pages and the desktop program (see admin/src/lib/desktopBridge.ts for what each piece is for). Only these few calls cross;
// the page gets no Node, no file access and no way to run anything. Every call is checked again on the other side (main.cjs).
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel, callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('tutorlageDesktop', {
  secureStorage: {
    getItem: (key) => ipcRenderer.invoke('secure:get', String(key)),
    setItem: (key, value) => ipcRenderer.invoke('secure:set', String(key), String(value)),
    removeItem: (key) => ipcRenderer.invoke('secure:remove', String(key)),
  },
  notify: (toast) => ipcRenderer.invoke('alerts:notify', toast),
  isMuted: () => ipcRenderer.invoke('alerts:isMuted'),
  getStatus: () => ipcRenderer.invoke('alerts:status'),
  setMuted: (muted, hours) => ipcRenderer.invoke('alerts:setMuted', !!muted, hours),
  sendTest: () => ipcRenderer.invoke('alerts:test'),
  onNavigate: (callback) => listen('alerts:navigate', callback),
  onCheckNow: (callback) => listen('alerts:check-now', () => callback()),
  onStatusChange: (callback) => listen('alerts:status-changed', callback),
});
