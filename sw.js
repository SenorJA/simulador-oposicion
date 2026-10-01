/**
 * sw.js — Service Worker del Simulador OPE SESCAM.
 *
 * Estrategia: RED PRIMERO *sin caché HTTP* para recursos propios, de modo que
 * el navegador NUNCA sirva JS/HTML antiguos (bucket de la API Cache solo como
 * respaldo offline). Las llamadas a Supabase y al CDN (otro origen) no se tocan.
 *
 * Sube CACHE al cambiar el shell para invalidar lo viejo.
 */
const CACHE = 'ope-sescam-v2';

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
        // `no-store` evita la caché HTTP del navegador: siempre pide la versión
        // actual al servidor y la guarda solo como respaldo offline.
        fetch(req, { cache: 'no-store' })
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
