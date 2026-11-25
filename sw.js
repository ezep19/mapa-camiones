/* Service worker: deja usar la página sin señal con lo que ya se vio.
   - Página y datos: primero internet (para tener siempre lo último); si no hay señal, lo guardado.
   - Código y estilos (llevan su versión en la dirección): la versión guardada, sin ir a internet.
   - Bibliotecas (de unpkg) e íconos: lo guardado primero (no cambian).
   - Pedazos del mapa (tiles): lo guardado primero, y se guardan solo los que ya se miraron
     (como hace cualquier navegador), con un tope para no llenar el teléfono.
   - Rutas, buscador, formularios: siempre por internet (no se guardan). */
'use strict';

var VERSION = 'v13';
var CACHE_APP = 'mapa-camiones-app-' + VERSION;   // la página: index, código, estilos, bibliotecas, íconos
// v13: los datos y la voz van en cachés SIN versión: antes estaban en el de la página y se borraban enteros con cada
// versión nueva del service worker (se perdían las ciudades y la voz guardadas para usar sin señal)
var CACHE_DATOS = 'mapa-camiones-datos';          // zonas, país, lugares, radares...
var MAX_DATOS = 900;
var CACHE_NEGOCIOS = 'mapa-camiones-negocios';    // datos/negocios/*.json (793 pedazos, 62 MB en total): con tope
var MAX_NEGOCIOS = 60;
var CACHE_VOZ = 'mapa-camiones-voz';              // frases grabadas
var CACHE_TILES = 'mapa-camiones-tiles';
var MAX_TILES = 1500;
// Mapa de fondo vectorial (OpenFreeMap): los pedazos pesan más que los comunes pero hacen falta muchos menos
// (llegan hasta el nivel 14 y de más cerca se reusan), por eso el tope es más bajo
var CACHE_VECTOR = 'mapa-camiones-vector';
var MAX_VECTOR = 800;
var CACHE_ESTILO = 'mapa-camiones-estilo';   // letras e íconos del mapa de fondo (pocos y chicos)
// v93: pedazos del mapa a lo largo de la ruta, bajados al armarla para usar sin señal (los pide la página con
// "?guardar-viaje=1"; el tope lo maneja la página). Aparte, para que no los borre el tope del mapa común.
var CACHE_VIAJE = 'mapa-camiones-viaje';

var BASICO = [
  './manifest.webmanifest',
  './iconos/icono-192.png',
  './iconos/favicon-32.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css',
  'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js',
  'https://unpkg.com/leaflet-rotate@0.2.8/dist/leaflet-rotate.js'
];

// En qué caché va cada cosa del sitio
function cacheDe(url) {
  if (/\/datos\/negocios\//.test(url.pathname)) return CACHE_NEGOCIOS;
  if (/\/datos\//.test(url.pathname)) return CACHE_DATOS;
  if (/\/voz\//.test(url.pathname)) return CACHE_VOZ;
  return CACHE_APP;
}

self.addEventListener('install', function (ev) {
  ev.waitUntil(caches.open(CACHE_APP).then(function (c) {
    // si algo falla (sin señal al instalar), no se traba la instalación
    return Promise.all(BASICO.map(function (u) { return c.add(u).catch(function () {}); })).then(function () {
      // v13: la página de AHORA (no la que el navegador tenga guardada de hace 10 minutos) y, con ella, el código y los
      // estilos de esa versión (app.js?v=N, estilos.css?v=N). Antes no se guardaban al instalar: después de una
      // actualización, si la próxima vez abrías sin señal, la página aparecía pero sin código (muerta).
      return fetch(new Request('./index.html', { cache: 'no-cache' })).then(function (r) {
        if (!r || !r.ok) throw new Error('sin página');
        var c1 = r.clone(), c2 = r.clone();
        return r.text().then(function (h) {
          var archivos = h.match(/(?:js\/app\.js|css\/estilos\.css)\?v=\d+/g) || [];
          return Promise.all([c.put('./index.html', c1), c.put('./', c2)].concat(archivos.map(function (u) {
            return c.add('./' + u).catch(function () {});
          })));
        });
      }).catch(function () {
        // no se pudo bajar: queda la página que ya estaba guardada (el caché viejo se borra al activar)
        return caches.match('./index.html').then(function (v) {
          return v && Promise.all([c.put('./index.html', v.clone()), c.put('./', v.clone())]);
        }).catch(function () {});
      });
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (nombres) {
    var viejos = nombres.filter(function (n) { return n.indexOf('mapa-camiones-app-') === 0 && n !== CACHE_APP; });
    return Promise.all(viejos.map(function (n) {
      // v13: los datos y la voz que estaban en el caché viejo de la página se pasan a los nuevos (no se pierden);
      // los pedazos de negocios no (son muchos: se vuelven a bajar los que hagan falta)
      return caches.open(n).then(function (c) {
        return c.keys().then(function (claves) {
          return Promise.all(claves.map(function (k) {
            var destino = cacheDe(new URL(k.url));
            if (destino !== CACHE_DATOS && destino !== CACHE_VOZ) return null;
            return c.match(k).then(function (r) {
              return r && caches.open(destino).then(function (d) { return d.put(k, r); });
            }).catch(function () {});
          }));
        });
      }).catch(function () {}).then(function () { return caches.delete(n); });
    }));
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

function recortar(c, max) {
  c.keys().then(function (claves) {
    var sobran = claves.length - max;
    for (var i = 0; i < sobran; i++) c.delete(claves[i]);   // se borran los más viejos
  });
}

// Primero internet; si no hay señal, o si tarda más de 4 s y hay algo guardado, lo guardado
function primeroInternet(pedido, nombre) {
  nombre = nombre || CACHE_APP;
  return new Promise(function (resolver) {
    var listo = false;
    function dar(r) { if (!listo && r) { listo = true; resolver(r); } }
    // cache: 'no-cache' = preguntar siempre al servidor si hay algo nuevo (GitHub Pages deja guardar la página
    // 10 minutos: sin esto, después de publicar, el celular seguía mostrando la versión anterior un rato)
    fetch(pedido.mode === 'navigate' ? new Request(pedido.url, { cache: 'no-cache', credentials: 'same-origin' })
                                     : new Request(pedido, { cache: 'no-cache' })).then(function (resp) {
      if (resp && resp.ok) {
        if (resp.status === 200) {   // (un pedazo de archivo, 206, no se puede guardar)
          var copia = resp.clone();
          caches.open(nombre).then(function (c) {
            return c.put(pedido, copia).then(function () {
              if (nombre === CACHE_DATOS && Math.random() < 0.03) recortar(c, MAX_DATOS);
              if (nombre === CACHE_NEGOCIOS && Math.random() < 0.2) recortar(c, MAX_NEGOCIOS);
            });
          }).catch(function () {});
        }
        dar(resp);
      } else {
        // el servidor contestó con error (página que ya no existe, GitHub caído un momento): si hay algo guardado,
        // se muestra eso (para una página, el mapa guardado) en vez de la pantalla de error
        guardado(pedido).then(function (r) { dar(r || resp); });
      }
    }).catch(function () {
      guardado(pedido).then(function (r) { dar(r || Response.error()); });
    });
    // v113: 4 s (antes 6): con poca señal en la ruta la página tardaba mucho en abrir
    setTimeout(function () { guardado(pedido).then(dar); }, 4000);
  });
}

// v113: el código y los estilos llevan su versión en la dirección (app.js?v=113): si ya está guardada ESA versión
// exacta, se usa sin preguntar a internet (abre al instante con poca señal). Una versión nueva tiene otra dirección,
// así que se baja sola.
// v13: si no está guardada se ESPERA a internet (antes, a los 4 s se daba "cualquier versión guardada": la página nueva
// podía quedar andando con un código viejo). Solo si internet falla se usa otra versión. Y al guardar una versión
// nueva se borran las anteriores (se acumulaban todas).
function versionGuardada(pedido) {
  return caches.match(pedido).then(function (r) {
    if (r) return r;
    // (si internet no contesta en 15 s y hay otra versión guardada, esa: mejor que una página sin código)
    var espera = new Promise(function (resolver) {
      setTimeout(function () { caches.match(pedido, { ignoreSearch: true }).then(function (v) { if (v) resolver(v); }); }, 15000);
    });
    return Promise.race([espera, fetch(new Request(pedido, { cache: 'no-cache' })).then(function (resp) {
      if (!resp || !resp.ok) throw new Error('sin respuesta');
      var copia = resp.clone(), camino = new URL(pedido.url).pathname;
      caches.open(CACHE_APP).then(function (c) {
        return c.put(pedido, copia).then(function () { return c.keys(); }).then(function (claves) {
          claves.forEach(function (k) { if (k.url !== pedido.url && new URL(k.url).pathname === camino) c.delete(k); });
        });
      }).catch(function () {});
      return resp;
    }).catch(function () {
      return caches.match(pedido, { ignoreSearch: true }).then(function (r2) { return r2 || Response.error(); });
    })]);
  });
}

// Igual que primeroInternet pero para otro dominio (estilo del mapa de fondo): se guarda aparte de la página.
// v13: con tiempo límite (3 s). Antes lo guardado se usaba solo si internet FALLABA, no si quedaba colgado: con una
// rayita de señal el mapa no aparecía aunque estuviera guardado (a los 10 s la página pasaba al mapa de respaldo).
function primeroInternetAfuera(pedido) {
  return new Promise(function (resolver) {
    var listo = false;
    function dar(r) { if (!listo && r) { listo = true; resolver(r); } }
    fetch(pedido).then(function (resp) {
      if (resp && resp.ok) {
        var copia = resp.clone();
        caches.open(CACHE_ESTILO).then(function (c) { return c.put(pedido, copia); }).catch(function () {});
        dar(resp);
      } else caches.match(pedido).then(function (r) { dar(r || resp); });
    }).catch(function () {
      caches.match(pedido).then(function (r) { dar(r || Response.error()); });
    });
    setTimeout(function () { caches.match(pedido).then(dar); }, 3000);
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
          if (cache === CACHE_TILES && Math.random() < 0.05) recortar(c, MAX_TILES);
          if (cache === CACHE_VECTOR && Math.random() < 0.05) recortar(c, MAX_VECTOR);
        });
      }
      return resp;
    });
  });
}

// v13: frases de la voz: lo guardado primero (suena al instante) y por detrás se actualiza por si se grabaron de nuevo.
// Antes cada pedazo de frase preguntaba primero a internet (con mala señal, hasta 4 s de espera por pedazo).
function guardadoYActualizar(pedido, nombre) {
  return caches.open(nombre).then(function (c) {
    return c.match(pedido).then(function (r) {
      if (r && Math.random() > 0.15) return r;   // se actualiza de vez en cuando (las frases casi nunca cambian)
      var red = fetch(pedido).then(function (resp) {
        if (resp && resp.status === 200) c.put(pedido, resp.clone()).catch(function () {});
        return resp;
      });
      if (r) { red.catch(function () {}); return r; }
      return red;
    });
  });
}

// Guarda un pedazo del mapa para el viaje (sin el "?guardar-viaje=1", que es solo la marca): si ya estaba guardado
// para el viaje no hace nada; si estaba en el mapa común lo copia; si no, lo baja. Contesta vacío (la página no lo usa).
function guardarParaViaje(pedido) {
  var url = pedido.url.replace(/[?&]guardar-viaje=1$/, '');
  return caches.open(CACHE_VIAJE).then(function (c) {
    return c.match(url).then(function (ya) {
      if (ya) return new Response('', { status: 200 });
      return caches.match(url).then(function (comun) {
        return comun || fetch(url, { mode: 'cors' });
      }).then(function (resp) {
        if (!resp || !resp.ok) return new Response('', { status: 502 });
        return c.put(url, resp.clone()).then(function () { return new Response('', { status: 200 }); });
      });
    });
  }).catch(function () { return new Response('', { status: 503 }); });
}

self.addEventListener('fetch', function (ev) {
  var pedido = ev.request;
  if (pedido.method !== 'GET') return;
  var url = new URL(pedido.url);
  if (url.hostname === 'tile.openstreetmap.org') { ev.respondWith(primeroGuardado(pedido, CACHE_TILES)); return; }
  // v98: relieve (altura del terreno) y fotos satelitales: igual que los pedazos del mapa común (tope MAX_TILES)
  if (url.hostname === 'elevation-tiles-prod.s3.amazonaws.com' || url.hostname === 'tiles.maps.eox.at') {
    ev.respondWith(primeroGuardado(pedido, CACHE_TILES)); return;
  }
  if (url.hostname === 'tiles.openfreemap.org') {
    // el estilo y el índice cambian (cada semana hay mapa nuevo): primero internet. Pedazos, letras e íconos: guardado
    if (/\.pbf$/.test(url.pathname) && /\/planet\//.test(url.pathname)) {
      ev.respondWith(url.searchParams.has('guardar-viaje') ? guardarParaViaje(pedido) : primeroGuardado(pedido, CACHE_VECTOR));
    }
    else if (/\/(fonts|sprites|natural_earth)\//.test(url.pathname)) ev.respondWith(primeroGuardado(pedido, CACHE_ESTILO));
    else ev.respondWith(primeroInternetAfuera(pedido));
    return;
  }
  if (url.hostname === 'unpkg.com') { ev.respondWith(primeroGuardado(pedido, CACHE_APP)); return; }
  if (url.origin !== self.location.origin) return;   // rutas, buscador, Google: siempre por internet
  if (/\/iconos\//.test(url.pathname)) { ev.respondWith(primeroGuardado(pedido, CACHE_APP)); return; }
  if (/\.(js|css)$/.test(url.pathname) && url.searchParams.has('v') && !/\/sw\.js$/.test(url.pathname)) {
    ev.respondWith(versionGuardada(pedido)); return;
  }
  if (/\/voz\/.+\.(mp3|wav)$/.test(url.pathname)) {
    // el reproductor de sonido pide "un pedazo" del archivo (Range): eso va derecho a internet y, si no hay, lo guardado
    if (pedido.headers.has('range')) {
      ev.respondWith(fetch(pedido).catch(function () { return caches.match(pedido).then(function (r) { return r || Response.error(); }); }));
    } else ev.respondWith(guardadoYActualizar(pedido, CACHE_VOZ));
    return;
  }
  ev.respondWith(primeroInternet(pedido, cacheDe(url)));
});
