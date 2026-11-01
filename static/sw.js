/**
 * sw.js — Linus Music Player Service Worker
 *
 * Strategy:
 *  - App Shell (HTML, CSS, JS): Network-first with cache fallback (always loads latest updates)
 *  - API calls: Network-only (live data)
 *  - Audio/media/video: Network-only (streaming)
 */

const CACHE_NAME = 'linus-shell-v3';

const SHELL_URLS = [
  '/',
  '/static/styles.css',
  '/static/dj_styles.css',
  '/static/tour.css',
  '/static/app.js',
  '/static/dj_engine.js',
  '/static/dj_ui.js',
  '/static/youtube.js',
  '/static/audio_dsp.js',
  '/static/keyboard.js',
  '/static/command_palette.js',
  '/static/visualizers.js',
  '/static/fullscreen.js',
  '/static/theme_studio.js',
  '/static/recommendations.js',
  '/static/discord_rpc.js',
  '/static/smart_playlists.js',
  '/static/tour.js',
  '/static/manifest.json',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        SHELL_URLS.map((url) =>
          cache.add(url).catch(() => {})
        )
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => {
        return Promise.all(keys.map((key) => caches.delete(key)));
      })
    );
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/media/') ||
      url.pathname.startsWith('/static/wallpapers/') ||
      url.pathname.startsWith('/static/live_wallpapers/') ||
      url.pathname.startsWith('/static/videos/')) {
    return;
  }

  // Network-first with Cache fallback for app shell to prevent stale cached code
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
