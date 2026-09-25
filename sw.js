self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// ── Push notifications
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Söröm', {
      body: data.body || '',
      icon: 'img/icon-512.png',
      // Android masks this to its alpha channel and renders a flat,
      // theme-tinted silhouette — must be a monochrome shape, never a
      // full-color icon (a color image here renders as a garbled blob).
      badge: 'img/icon-badge.png',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/index.html' },
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/index.html'));
});
