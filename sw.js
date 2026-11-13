// Service worker de Sonora: guarda la app para que abra rápido e instalable.
// La música, las búsquedas y las miniaturas las maneja (y cachea) el servidor local: aquí no se tocan.
const VERSION = 'sonora-v2.0.0';
const CACHE_APP = 'sonora-app-' + VERSION;
const ARCHIVOS_APP = [
  './', 'index.html', 'manifest.webmanifest', 'css/sonora.css',
  'js/app.js', 'js/api.js', 'js/player.js', 'js/covers.js', 'js/local.js', 'js/util.js',
  'fuentes/bricolage-grotesque-latin.woff2', 'fuentes/outfit-latin-variable.woff2', 'fuentes/figtree-latin-400.woff2', 'fuentes/figtree-latin-500.woff2', 'fuentes/figtree-latin-600.woff2', 'fuentes/figtree-latin-700.woff2',
  'iconos/icono-192.png', 'iconos/icono-512.png', 'iconos/favicon-64.png', 'iconos/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_APP).then(c => c.addAll(ARCHIVOS_APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(k => (k.startsWith('sonora-app-') && k !== CACHE_APP) || k === 'sonora-musica').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // App: primero la red (para tener siempre la última versión) y, sin conexión, la copia guardada.
  e.respondWith(
    fetch(req)
      .then(r => {
        if (r.ok && r.status === 200 && r.type === 'basic') { const copia = r.clone(); caches.open(CACHE_APP).then(c => c.put(req, copia)).catch(() => {}); }
        return r;
      })
      .catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))
  );
});
