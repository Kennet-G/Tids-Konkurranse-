// Service worker: alt caches ved installasjon, slik at appen virker helt uten nett.
// Øk VERSION ved hver endring av filene, så nettbrettet henter ny versjon neste gang det er på nett.
const VERSION = 'trox-vvs2026-v1.0.0';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './app/main.js',
  './app/core/db.js',
  './app/core/events.js',
  './app/core/excel.js',
  './app/core/pin.js',
  './app/core/stats.js',
  './app/core/time.js',
  './app/core/validation.js',
  './app/services/backup.js',
  './app/services/scanner.js',
  './app/services/store.js',
  './app/services/wakelock.js',
  './app/styles/app.css',
  './app/styles/theme.css',
  './app/ui/admin.js',
  './app/ui/auth.js',
  './app/ui/dom.js',
  './app/ui/public.js',
  './lib/html5-qrcode.min.js',
  './lib/xlsx.full.min.js',
  './assets/logo.svg',
  './assets/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))),
  );
});
