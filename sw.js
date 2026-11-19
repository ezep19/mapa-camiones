/* Service worker: deja usar la página sin señal con lo que ya se vio.
   - Página, estilos, código y datos: primero internet (para tener siempre lo último);
     si no hay señal, lo guardado.
   - Leaflet (de unpkg) e íconos: lo guardado primero (no cambian).
   - Pedazos del mapa (tiles): lo guardado primero, y se guardan solo los que ya se miraron
     (como hace cualquier navegador), con un tope para no llenar el teléfono.
   - Rutas, buscador, formularios: siempre por internet (no se guardan). */
'use strict';

var VERSION = 'v1';
var CACHE_APP = 'mapa-camiones-app-' + VERSION;
var CACHE_TILES = 'mapa-camiones-tiles';
var MAX_TILES = 1500;

var BASICO = [
  './',
  './index.html',
  './manifest.webmanifest',
  './iconos/icono-192.png',
  './iconos/favicon-32.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', function (ev) {
  ev.waitUntil(caches.open(CACHE_APP).then(function (c) {
    // si algo falla (sin señal al instalar), no se traba la instalación
    return Promise.all(BASICO.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (nombres) {
    return Promise.all(nombres.filter(function (n) {
      return n.indexOf('mapa-camiones-app-') === 0 && n !== CACHE_APP;
    }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

function primeroInternet(pedido) {
  return fetch(pedido).then(function (resp) {
    if (resp && resp.ok) {
      var copia = resp.clone();
      caches.open(CACHE_APP).then(function (c) { c.put(pedido, copia); });
    }
    return resp;
  }).catch(function () {
    return caches.match(pedido, { ignoreSearch: true }).then(function (r) {
      return r || (pedido.mode === 'navigate' ? caches.match('./index.html') : undefined) || Response.error();
    });
  });
}

function primeroGuardado(pedido, cache) {
  return caches.match(pedido).then(function (r) {
    if (r) return r;
    return fetch(pedido).then(function (resp) {
      if (resp && resp.ok) {   // las respuestas "opacas" no se guardan: ocupan muchísimo
        var copia = resp.clone();
        caches.open(cache).then(function (c) {
          c.put(pedido, copia);
          if (cache === CACHE_TILES && Math.random() < 0.05) recortarTiles(c);
        });
      }
      return resp;
    });
  });
}

function recortarTiles(c) {
  c.keys().then(function (claves) {
    var sobran = claves.length - MAX_TILES;
    for (var i = 0; i < sobran; i++) c.delete(claves[i]);   // se borran los más viejos
  });
}

self.addEventListener('fetch', function (ev) {
  var pedido = ev.request;
  if (pedido.method !== 'GET') return;
  var url = new URL(pedido.url);
  if (url.hostname === 'tile.openstreetmap.org') { ev.respondWith(primeroGuardado(pedido, CACHE_TILES)); return; }
  if (url.hostname === 'unpkg.com') { ev.respondWith(primeroGuardado(pedido, CACHE_APP)); return; }
  if (url.origin !== self.location.origin) return;   // rutas, buscador, Google: siempre por internet
  if (/\/iconos\//.test(url.pathname)) { ev.respondWith(primeroGuardado(pedido, CACHE_APP)); return; }
  ev.respondWith(primeroInternet(pedido));
});
