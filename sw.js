/* Service Worker تل‌چت: کش برنامه برای اجرای سریع و آفلاین + نمایش اعلان */
const VERSION = 'telchat-v3';
const MEDIA = 'telchat-media-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'assets/css/app.css?v=3', 'assets/js/icons.js?v=3', 'assets/js/app.js?v=3', 'assets/js/settings.js?v=3',
  'assets/fonts/Vazirmatn.woff2', 'assets/icons/icon-192.png', 'assets/icons/badge.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== MEDIA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.includes('/api/') || url.pathname.endsWith('.php')) return;

  // فایل‌های آپلود شده: اول از کش (نام فایل‌ها یکتا و غیرقابل تغییر است)
  if (url.pathname.includes('/uploads/')) {
    if (req.headers.get('range')) return;
    e.respondWith(caches.open(MEDIA).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200 && /^image\//.test(res.headers.get('content-type') || '')) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // صفحه اصلی: اول شبکه، در صورت قطعی از کش
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put('index.html', copy));
      return res;
    }).catch(() => caches.match('index.html')));
    return;
  }

  // فایل‌های برنامه: نمایش از کش و به‌روزرسانی در پس‌زمینه
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(req);
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'پیام جدید';
  e.waitUntil((async () => {
    if (d.badge !== undefined && self.navigator.setAppBadge) {
      try { d.badge ? await self.navigator.setAppBadge(d.badge) : await self.navigator.clearAppBadge(); } catch (err) { /* ignore */ }
    }
    await self.registration.showNotification(title, {
      body: d.body || '',
      icon: d.icon || 'assets/icons/icon-192.png',
      badge: 'assets/icons/badge.png',
      tag: d.tag || 'telchat',
      renotify: true,
      data: { chat_id: d.chat_id || 0 },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const chatId = e.notification.data && e.notification.data.chat_id;
  const target = chatId ? './#/chat/' + chatId : './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
    for (const c of list) {
      if ('focus' in c) {
        await c.focus();
        if (chatId) c.postMessage({ type: 'open_chat', chat_id: chatId });
        return;
      }
    }
    return self.clients.openWindow(target);
  }));
});
