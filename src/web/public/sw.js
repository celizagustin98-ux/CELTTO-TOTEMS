// Service worker del tótem y la TV: permite abrir la app aunque se corte la red.
// - Archivos de la app (/assets, con hash en el nombre): caché primero.
// - Páginas: red primero; sin red, la última versión guardada.
// - Configuración pública y logo: red primero; sin red, lo último guardado.
// No guarda nada de la API privada ni datos de pacientes.
const VERSION = 'celtto-v1'
const SHELL = ['/', '/index.html']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

const networkFirst = async (req, fallbackUrl) => {
  const cache = await caches.open(VERSION)
  try {
    const res = await fetch(req)
    if (res.ok) cache.put(fallbackUrl ?? req, res.clone())
    return res
  } catch {
    return (await cache.match(fallbackUrl ?? req)) || Response.error()
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, '/index.html'))
    return
  }
  if (url.pathname.startsWith('/assets/') || /\.(woff2?|svg|png|ico)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()))
            return res
          }),
      ),
    )
    return
  }
  if (url.pathname === '/api/public/sectors' || url.pathname === '/api/public/logo') e.respondWith(networkFirst(req))
})
