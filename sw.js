/* Service worker: deja usar la página sin señal con lo que ya se vio.
   - Página, estilos, código y datos: primero internet (para tener siempre lo último);
     si no hay señal, lo guardado.
   - Leaflet (de unpkg) e íconos: lo guardado primero (no cambian).
   - Pedazos del mapa (tiles): lo guardado primero, y se guardan solo los que ya se miraron
     (como hace cualquier navegador), con un tope para no llenar el teléfono.
   - Rutas, buscador, formularios: siempre por internet (no se guardan). */
'use strict';

var VERSION = 'v6';
var CACHE_APP = 'mapa-camiones-app-' + VERSION;
var CACHE_TILES = 'mapa-camiones-tiles';
var MAX_TILES = 1500;
// Mapa de fondo vectorial (OpenFreeMap): los pedazos pesan más que los comunes pero hacen falta muchos menos
// (llegan hasta el nivel 14 y de más cerca se reusan), por eso el tope es más bajo
var CACHE_VECTOR = 'mapa-camiones-vector';
var MAX_VECTOR = 800;
var CACHE_ESTILO = 'mapa-camiones-estilo';   // letras e íconos del mapa de fondo (pocos y chicos)

var BASICO = [
  './',
  './index.html',
  './manifest.webmanifest',
  './iconos/icono-192.png',
  './iconos/favicon-32.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css',
  'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js',
  'https://unpkg.com/leaflet-rotate@0.2.8/dist/leaflet-rotate.js'
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

// Lo guardado para este pedido (primero exacto; si no, sin mirar el "?v=")
function guardado(pedido) {
  return caches.match(pedido).then(function (r) {
    return r || caches.match(pedido, { ignoreSearch: true });
  }).then(function (r) {
    return r || (pedido.mode === 'navigate' ? caches.match('./index.html') : undefined);
  });
}

// Primero internet; si no hay señal, o si tarda más de 6 s y hay algo guardado, lo guardado
function primeroInternet(pedido) {
  return new Promise(function (resolver) {
    var listo = false;
    function dar(r) { if (!listo && r) { listo = true; resolver(r); } }
    var red = fetch(pedido).then(function (resp) {
      if (resp && resp.ok) {
        var copia = resp.clone();
        caches.open(CACHE_APP).then(function (c) { c.put(pedido, copia); });
      }
      dar(resp);
    }).catch(function () {
      guardado(pedido).then(function (r) { dar(r || Response.error()); });
    });
    setTimeout(function () { guardado(pedido).then(dar); }, 6000);
  });
}

// Igual que primeroInternet pero para otro dominio (estilo del mapa de fondo): se guarda aparte de la página
function primeroInternetAfuera(pedido) {
  return fetch(pedido).then(function (resp) {
    if (resp && resp.ok) {
      var copia = resp.clone();
      caches.open(CACHE_ESTILO).then(function (c) { c.put(pedido, copia); });
    }
    return resp;
  }).catch(function () {
    return caches.match(pedido).then(function (r) { return r || Response.error(); });
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
          if (cache === CACHE_TILES && Math.random() < 0.05) recortarTiles(c, MAX_TILES);
          if (cache === CACHE_VECTOR && Math.random() < 0.05) recortarTiles(c, MAX_VECTOR);
        });
      }
      return resp;
    });
  });
}

function recortarTiles(c, max) {
  c.keys().then(function (claves) {
    var sobran = claves.length - max;
    for (var i = 0; i < sobran; i++) c.delete(claves[i]);   // se borran los más viejos
  });
}

self.addEventListener('fetch', function (ev) {
  var pedido = ev.request;
  if (pedido.method !== 'GET') return;
  var url = new URL(pedido.url);
  if (url.hostname === 'tile.openstreetmap.org') { ev.respondWith(primeroGuardado(pedido, CACHE_TILES)); return; }
  if (url.hostname === 'tiles.openfreemap.org') {
    // el estilo y el índice cambian (cada semana hay mapa nuevo): primero internet. Pedazos, letras e íconos: guardado
    if (/\.pbf$/.test(url.pathname) && /\/planet\//.test(url.pathname)) ev.respondWith(primeroGuardado(pedido, CACHE_VECTOR));
    else if (/\/(fonts|sprites|natural_earth)\//.test(url.pathname)) ev.respondWith(primeroGuardado(pedido, CACHE_ESTILO));
    else ev.respondWith(primeroInternetAfuera(pedido));
    return;
  }
  if (url.hostname === 'unpkg.com') { ev.respondWith(primeroGuardado(pedido, CACHE_APP)); return; }
  if (url.origin !== self.location.origin) return;   // rutas, buscador, Google: siempre por internet
  if (/\/iconos\//.test(url.pathname)) { ev.respondWith(primeroGuardado(pedido, CACHE_APP)); return; }
  ev.respondWith(primeroInternet(pedido));
});
