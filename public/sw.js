// Tutorlage service worker: web push for a lesson request addressed to ONE tutor (24 Nov 2026). It is registered ONLY after a tutor taps "Turn on alerts" (never on page load).
// The push arrives EMPTY: the words below are the only words that can ever be shown, so no learner, subject or family detail can reach a lock screen.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('Tutorlage', {
      body: 'You have a new lesson request on Tutorlage. Open the app to answer.',
      icon: '/apple-touch-icon.png',
      tag: 'direct-request',
      renotify: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/');
    }),
  );
});
