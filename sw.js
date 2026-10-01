/**
 * sw.js — Service Worker del Simulador OPE SESCAM.
 *
 * Estrategia: RED PRIMERO para recursos propios (así nunca sirve JS/HTML
 * antiguos) y caché solo como respaldo cuando no hay conexión. Las llamadas
 * a Supabase y al CDN (otro origen) NO se cachean.
 *
 * Sube CACHE al cambiar el shell para invalidar lo viejo.
 */
const CACHE = 'ope-sescam-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return; // Supabase/CDN: sin caché

    event.respondWith(
        fetch(req)
            .then(res => {
                if (res && res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
                }
                return res;
            })
            .catch(() => caches.match(req))
    );
});
