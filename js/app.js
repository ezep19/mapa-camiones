/* Mapa para camiones — lógica de la página (motor MapLibre desde la v45; la versión vieja con Leaflet está en
   js/mapa.js y viejo.html, y se usa sola si el teléfono no tiene WebGL).
   Secciones:
   1. Configuración de capas y colores
   2. Mapa base
   3. Medidas del camión (guardar, leer, formulario)
   4. ¿Pasa o no pasa? (evaluación de cada restricción)
   5. Carga de datos (datos/zonas.json y un .geojson por zona)
   6. Dibujo de cada restricción (color y forma)
   7. Cartel al tocar
   8. Panel para prender y apagar capas
   9. Mi ubicación (punto azul)
   10. Utilidades
*/
'use strict';
var VERSION_APP = 74;   // se muestra abajo en "Qué mostrar" (para saber si el celular tiene la última)

// ===== 1. Configuración de capas y colores =====
// forma: 'linea', 'punteada' o 'punto' (los puntos se dibujan como círculo)
var CAPAS = [
  { id: 'altura',              nombre: 'Altura máxima',                            forma: 'linea' },
  { id: 'peso',                nombre: 'Peso máximo',                              forma: 'linea' },
  { id: 'largo',               nombre: 'Largo máximo',                             forma: 'linea' },
  { id: 'prohibido',           nombre: 'Prohibido camiones',                       forma: 'linea' },
  { id: 'verificar',           nombre: 'Túnel o paso bajo sin altura (verificar)', forma: 'punteada' },
  { id: 'verificar_autopista', nombre: 'Paso bajo autopista sin altura (verificar)', forma: 'punteada' },
  { id: 'ancho',               nombre: 'Ancho máximo o calle angosta',             forma: 'linea' },
  { id: 'barrera',             nombre: 'Pilotes, bloques o portones en la calle',  forma: 'punto' },
  { id: 'obra',                nombre: 'Calle en obra (verificar)',                forma: 'punteada' },
  { id: 'corte',               nombre: 'Cortes y obras EN VIVO',                    forma: 'linea' },
  { id: 'sin_salida',          nombre: 'Calle sin salida',                         forma: 'punto' }
];
var CAPA_POR_ID = {};
CAPAS.forEach(function (c) { CAPA_POR_ID[c.id] = c; });

// El color dice si TU camión pasa
var COLORES = {
  no: '#d50000',        // rojo fuerte: no pasás
  si: '#8a8f98',        // gris suave: pasás
  sin_dato: '#f2b705',  // amarillo: no hay dato, verificar
  aviso: '#7b3fa0'      // violeta: calle sin salida
};
// Lugares útiles (los baja scripts/descargar_lugares.py). Se ven solo de cerca.
var LUGARES = [
  { id: 'gomeria',         nombre: 'Gomerías', uno: 'Gomería',                        icono: '🛞' },
  { id: 'taller',          nombre: 'Talleres para camiones', uno: 'Taller para camiones',          icono: '🔧' },
  { id: 'combustible',     nombre: 'Estaciones de servicio', uno: 'Estación de servicio',          icono: '⛽' },
  { id: 'parador',         nombre: 'Paradores', uno: 'Parador',                       icono: '🍴' },
  { id: 'estacionamiento', nombre: 'Estacionamiento para camiones', uno: 'Estacionamiento para camiones',   icono: '🅿️' },
  { id: 'ducha',           nombre: 'Duchas', uno: 'Duchas',                          icono: '🚿' },
  { id: 'balanza',         nombre: 'Balanzas', uno: 'Balanza',                        icono: '⚖️' }
];
var LUGAR_POR_ID = {};
LUGARES.forEach(function (l) { LUGAR_POR_ID[l.id] = l; });
var ZOOM_LUGARES = 13;   // desde acá se ven TODOS los lugares
// Pedido del chofer (20/11/2026, parado en una gomería de la ruta 2): "que aparezcan sin tener que acercar tanto, capaz
// que pasás y no lo ves". Desde este zoom (bastante más lejos) se ven los que entran sin taparse, primero gomerías,
// talleres y paradores; al acercar aparecen los demás.
var ZOOM_LUGARES_LEJOS = 9.5;

// Qué medida del camión se compara con cada capa
var MEDIDA_DE_CAPA = { altura: 'altura', peso: 'peso', largo: 'largo', ancho: 'ancho' };
var ANCHO_CAMION = 2.6;   // ancho legal máximo; el formulario no lo pide (casi todos los camiones miden eso)
function medidaCamion(m) { return m === 'ancho' ? (camion && camion.ancho) || ANCHO_CAMION : camion[m]; }
// Rangos aceptados en el formulario (los mismos que usa el script de descarga)
var RANGOS = {
  altura: { min: 1.5, max: 6,   unidad: 'm', nombre: 'La altura' },
  peso:   { min: 1,   max: 100, unidad: 't', nombre: 'El peso' },
  largo:  { min: 3,   max: 40,  unidad: 'm', nombre: 'El largo' }
};

var CENTRO_INICIAL = [-34.6118, -58.4173];   // Ciudad de Buenos Aires
var ZOOM_INICIAL = 12;
var CLAVE_CAPAS = 'mapa-camiones:capas-apagadas';
var CLAVE_CAMION = 'mapa-camiones:camion';
var CLAVE_VISTA = 'mapa-camiones:vista';   // dónde estaba mirando el mapa la última vez
var CLAVE_LUGARES = 'mapa-camiones:lugares-prendidos';

// ===== 2. Mapa (MapLibre) =====
// Todo el mapa (fondo, restricciones, ruta, íconos) lo dibuja MapLibre con la placa de video del teléfono, como
// Google Maps: se mueve, acerca y gira suave. Hasta la v44 era Leaflet, que redibujaba todo en cada movimiento.
// Leaflet se sigue usando SOLO para cálculos (distancias, rectángulos, las líneas de los datos), sin dibujar nada.
// "mapa" es un intermediario con las mismas funciones que usaba el resto del código (getZoom, setView, on...):
// los zooms del código son los de siempre (13 = barrio); MapLibre usa uno menos (sus cuadros son de 512 px).
if (!window.maplibregl) { location.replace('viejo.html'); throw new Error('MapLibre no cargó'); }
var vista = leerGuardado(CLAVE_VISTA);
if (!vista || typeof vista.lat !== 'number' || typeof vista.lng !== 'number' ||
    Math.abs(vista.lat) > 90 || Math.abs(vista.lng) > 180 || typeof vista.zoom !== 'number') vista = null;
var inicioMapa = vista ? [vista.lat, vista.lng] : CENTRO_INICIAL;
var zoomInicio = vista ? Math.min(Math.max(vista.zoom, 4), 19) : ZOOM_INICIAL;

var ESTILO_FONDO = 'https://tiles.openfreemap.org/styles/liberty';
var ESTILO_VACIO = { version: 8, sources: {}, layers: [{ id: 'vacio', type: 'background', paint: { 'background-color': '#f2efe9' } }] };
// si el mapa vectorial no llega (sin señal y sin nada guardado, o el servidor caído): el mapa común de OpenStreetMap
var ESTILO_RESPALDO = { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
  tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] };

var gl = new maplibregl.Map({
  container: 'mapa', style: ESTILO_VACIO,
  center: [inicioMapa[1], inicioMapa[0]], zoom: zoomInicio - 1, minZoom: 3, maxZoom: 18,
  maxPitch: 60, pitchWithRotate: false, touchPitch: false, dragRotate: true,
  attributionControl: false, fadeDuration: 0,
  // pantallas de 3x: se dibuja a 2x (casi igual de nítido y mucho menos trabajo para el teléfono)
  pixelRatio: Math.min(window.devicePixelRatio || 1, 2)
});
gl.touchZoomRotate.enable();   // dos dedos: acercar y girar (lo de MapLibre, como Google Maps)
// Si cambia el tamaño de la pantalla (la barra del iPhone que aparece y desaparece, girar el teléfono), el mapa se
// acomoda (MapLibre lo hace solo, pero en algunos casos quedaba una franja vacía abajo)
(function () {
  var t = null;
  function acomodar() { clearTimeout(t); t = setTimeout(function () { gl.resize(); }, 60); }
  window.addEventListener('resize', acomodar);
  window.addEventListener('orientationchange', acomodar);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', acomodar);
})();
var PUEDE_GIRAR = true;
var fondo = { tipo: null };

function estiloLiviano(est) {
  // edificios planos (sin 3D, que pesa mucho en el celular) y sin los negocios chiquitos (ensucian el mapa)
  est.layers = est.layers.filter(function (l) { return l.id !== 'building-3d' && l.id !== 'poi_r20'; });
  est.layers.forEach(function (l) {
    if (l.id === 'building') delete l.maxzoom;
    // calles en blanco y autopistas en gris azulado (como Google Maps): el amarillo y el naranja del estilo original
    // se confundían con lo amarillo ("verificar") y lo rojo del camión
    if (l.type !== 'line' || !l.paint || !l.paint['line-color'] || !/^(road|bridge|tunnel)_/.test(l.id)) return;
    var auto = /motorway/.test(l.id), borde = /casing/.test(l.id);
    var c = JSON.stringify(l.paint['line-color']);
    if (auto && /#fc8|#ffdaa6|hsl\(26/.test(c)) l.paint['line-color'] = '#d9e2ec';
    else if (borde && /#e9ac77/.test(c)) l.paint['line-color'] = auto ? '#a7b4c2' : '#cdc9c3';
    else if (/#fea|#fff4c6/.test(c)) l.paint['line-color'] = '#ffffff';
  });
  return est;
}
(function ponerFondo() {
  var listo = false;
  function respaldo() { if (listo) return; listo = true; fondo.tipo = 'osm'; gl.setStyle(ESTILO_RESPALDO); }
  var espera = setTimeout(respaldo, 10000);
  fetch(ESTILO_FONDO).then(function (r) {
    if (!r.ok) throw new Error('estilo ' + r.status);
    return r.json();
  }).then(function (est) {
    if (listo) return;
    listo = true;
    clearTimeout(espera);
    fondo.tipo = 'vectorial';
    gl.setStyle(estiloLiviano(est));
  }).catch(function () { clearTimeout(espera); respaldo(); });
})();
gl.on('error', function (ev) { if (window.console) console.warn('Mapa:', ev && ev.error && ev.error.message); });

// --- Íconos (gomerías, controles, reportes): se dibujan una vez en un lienzo y MapLibre los usa como imagen ---
function datosIcono(id) {
  var m;
  if ((m = /^ic-l-(.+)$/.exec(id)) && LUGAR_POR_ID[m[1]]) return [LUGAR_POR_ID[m[1]].icono, '#1565c0', '#ffffff'];
  if ((m = /^ic-r-(\d+)$/.exec(id))) return ['#' + m[1]];
  if ((m = /^ic-c-(.+)$/.exec(id))) return [(CONTROLES[m[1]] || CONTROLES.policial).icono, '#263238', '#eceff1'];
  if (id === 'ic-reporte') return ['📣', '#e65100', '#ffffff'];
  return null;
}
function dibujarIcono(emoji, borde, relleno) {
  var k = 2, t = 36 * k, c = document.createElement('canvas');
  c.width = c.height = t;
  var x = c.getContext('2d');
  x.shadowColor = 'rgba(0,0,0,0.35)'; x.shadowBlur = 4 * k; x.shadowOffsetY = k;
  x.beginPath(); x.arc(t / 2, t / 2, 15 * k, 0, 2 * Math.PI);
  x.fillStyle = relleno; x.fill();
  x.shadowColor = 'transparent';
  x.lineWidth = 2 * k; x.strokeStyle = borde; x.stroke();
  x.font = (17 * k) + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(emoji, t / 2, t / 2 + k);
  return { width: t, height: t, data: new Uint8Array(x.getImageData(0, 0, t, t).data.buffer) };
}
// Cartel de velocidad máxima: círculo blanco con borde rojo y el número (para los radares)
function dibujarLimite(numero) {
  var k = 2, t = 36 * k, c = document.createElement('canvas');
  c.width = c.height = t;
  var x = c.getContext('2d');
  x.shadowColor = 'rgba(0,0,0,0.35)'; x.shadowBlur = 4 * k; x.shadowOffsetY = k;
  x.beginPath(); x.arc(t / 2, t / 2, 15 * k, 0, 2 * Math.PI);
  x.fillStyle = '#ffffff'; x.fill();
  x.shadowColor = 'transparent';
  x.lineWidth = 4 * k; x.strokeStyle = '#d50000'; x.beginPath(); x.arc(t / 2, t / 2, 13 * k, 0, 2 * Math.PI); x.stroke();
  x.fillStyle = '#111'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = 'bold ' + ((String(numero).length > 2 ? 11 : 13) * k) + 'px Arial, sans-serif';
  x.fillText(String(numero), t / 2, t / 2 + k);
  return { width: t, height: t, data: new Uint8Array(x.getImageData(0, 0, t, t).data.buffer) };
}
gl.on('styleimagemissing', function (ev) {
  if (gl.hasImage(ev.id)) return;
  var d = datosIcono(ev.id);
  if (d && d.length === 1) gl.addImage(ev.id, dibujarLimite(d[0].slice(1)), { pixelRatio: 2 });
  else if (d) gl.addImage(ev.id, dibujarIcono(d[0], d[1], d[2]), { pixelRatio: 2 });
  else gl.addImage(ev.id, { width: 1, height: 1, data: new Uint8Array(4) });   // íconos del fondo que no vienen
});

// --- Intermediario "mapa" (mismas funciones que Leaflet, para no cambiar el resto del código) ---
function aLatLng(ll) { return L.latLng(ll.lat, ll.lng); }
var eventosPropios = {};
var menuToque = { timer: null, x: 0, y: 0, ultimo: 0 };
function eventoL(e) { return e._l || (e._l = { latlng: aLatLng(e.lngLat), point: e.point }); }
var mapa = {
  getZoom: function () { return gl.getZoom() + 1; },
  getCenter: function () { return aLatLng(gl.getCenter()); },
  getBounds: function () {
    var b = gl.getBounds();
    return L.latLngBounds([b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]);
  },
  setView: function (ll, zoom, op) {
    ll = L.latLng(ll);
    var o = { center: [ll.lng, ll.lat] };
    if (zoom != null) o.zoom = zoom - 1;
    if (op && op.animate === false) gl.jumpTo(o); else gl.easeTo(Object.assign(o, { duration: 600 }));
    return mapa;
  },
  panTo: function (ll) { ll = L.latLng(ll); gl.easeTo({ center: [ll.lng, ll.lat], duration: 500 }); return mapa; },
  fitBounds: function (lim, op) {
    lim = L.latLngBounds(lim);
    op = op || {};
    var a = op.paddingTopLeft || [30, 30], b = op.paddingBottomRight || [30, 30];
    gl.fitBounds([[lim.getWest(), lim.getSouth()], [lim.getEast(), lim.getNorth()]], {
      padding: { top: a[1], left: a[0], bottom: b[1], right: b[0] }, maxZoom: 16.5, duration: 700, bearing: gl.getBearing()
    });
    return mapa;
  },
  // ángulo como lo usaba el código viejo (positivo = el mapa girado a la derecha); MapLibre lo usa al revés
  getBearing: function () { return -gl.getBearing(); },
  setBearing: function (g) { gl.setBearing(-g); },
  closePopup: function () { cerrarCartel(); },
  on: function (tipo, fn) {
    if (tipo === 'click') {
      gl.on('click', function (e) { if (Date.now() - menuToque.ultimo > 800) fn(eventoL(e)); });
    } else if (tipo === 'contextmenu' || tipo === 'locationfound' || tipo === 'locationerror') {
      (eventosPropios[tipo] = eventosPropios[tipo] || []).push(fn);
    } else gl.on(tipo, fn);
    return mapa;
  },
  fire: function (tipo, e) { (eventosPropios[tipo] || []).forEach(function (fn) { fn(e); }); },
  // ubicación por GPS (como locate de Leaflet: avisa con 'locationfound' / 'locationerror')
  locate: function (op) {
    if (mapa._gps != null) return;
    mapa._gps = navigator.geolocation.watchPosition(function (pos) {
      mapa.fire('locationfound', { latlng: L.latLng(pos.coords.latitude, pos.coords.longitude),
                                   accuracy: pos.coords.accuracy, heading: pos.coords.heading, speed: pos.coords.speed });
    }, function (err) {
      mapa.fire('locationerror', { code: err.code, message: err.message });
    }, { enableHighAccuracy: !!(op && op.enableHighAccuracy), maximumAge: (op && op.maximumAge) || 0, timeout: (op && op.timeout) || 20000 });
  },
  stopLocate: function () {
    if (mapa._gps != null) navigator.geolocation.clearWatch(mapa._gps);
    mapa._gps = null;
  },
  _gps: null
};

// Dedo apretado (o clic derecho en la PC): MapLibre no lo avisa en todos los teléfonos, se cuenta el tiempo acá
function menuEn(lngLat) {
  if (Date.now() - menuToque.ultimo < 1000) return;   // Android avisa dos veces (el nuestro y el del navegador)
  menuToque.ultimo = Date.now();
  mapa.fire('contextmenu', { latlng: aLatLng(lngLat) });
}
function cancelarMenu() { clearTimeout(menuToque.timer); menuToque.timer = null; }
gl.on('touchstart', function (e) {
  cancelarMenu();
  var t = e.originalEvent && e.originalEvent.touches;
  if (!t || t.length !== 1) return;
  menuToque.x = e.point.x; menuToque.y = e.point.y;
  var ll = e.lngLat;
  menuToque.timer = setTimeout(function () { menuToque.timer = null; menuEn(ll); }, 600);
});
gl.on('touchmove', function (e) {
  if (menuToque.timer && Math.hypot(e.point.x - menuToque.x, e.point.y - menuToque.y) > 10) cancelarMenu();
});
gl.on('touchend', cancelarMenu);
gl.on('touchcancel', cancelarMenu);
gl.on('contextmenu', function (e) { cancelarMenu(); menuEn(e.lngLat); });

// --- Carteles (al tocar algo) ---
var cartel = null;
function cerrarCartel() { if (cartel) { var c = cartel; cartel = null; c.remove(); } }
function abrirCartel(latlng, contenido) {
  cerrarCartel();
  latlng = L.latLng(latlng);
  // closeOnClick: false = el cartel lo cierra nuestro manejador de toques (al final del archivo). Si lo cerraba
  // MapLibre solo, en el iPhone el menú del dedo apretado se podía cerrar apenas se levantaba el dedo.
  var c = new maplibregl.Popup({ maxWidth: '300px', focusAfterOpen: false, offset: 10, closeOnClick: false }).setLngLat([latlng.lng, latlng.lat]);
  if (typeof contenido === 'string') c.setHTML(contenido); else c.setDOMContent(contenido);
  c.on('close', function () { if (cartel === c) cartel = null; if (!cartel) document.body.classList.remove('cartel-abierto'); });
  cartel = c;
  document.body.classList.add('cartel-abierto');   // el velocímetro se hace transparente para no tapar el cartel
  c.addTo(gl);
  // como Leaflet: si el cartel queda tapado arriba (barra de búsqueda) o se sale por abajo, se corre el mapa
  setTimeout(function () {
    if (cartel !== c || !c.getElement()) return;
    var r = c.getElement().getBoundingClientRect(), alto = gl.getContainer().clientHeight, ancho = gl.getContainer().clientWidth;
    var arriba = 76, abajo = 16, costado = 10, dy = 0, dx = 0;
    if (r.bottom > alto - abajo) dy = r.bottom - (alto - abajo);
    if (r.top - dy < arriba) dy = r.top - arriba;
    // en celulares angostos el cartel (300 px) puede salirse por un costado
    if (r.left < costado) dx = r.left - costado;
    else if (r.right > ancho - costado) dx = r.right - (ancho - costado);
    if (Math.abs(dy) > 4 || Math.abs(dx) > 4) gl.panBy([dx, dy], { duration: 250 });
  }, 0);
  return c;
}

// --- Botones redondos de abajo a la derecha (brújula, ubicación y, en la PC, acercar/alejar) ---
var controlesMapa = document.createElement('div');
controlesMapa.className = 'controles-mapa';
document.body.appendChild(controlesMapa);
function crearBotonMapa(clase, etiqueta, html, alTocar) {
  var b = document.createElement('button');
  b.type = 'button';
  b.className = clase;
  b.title = etiqueta;
  b.setAttribute('aria-label', etiqueta);
  b.innerHTML = html;
  b.addEventListener('click', alTocar);
  controlesMapa.appendChild(b);
  return b;
}

// Girar el mapa de a poco hasta un ángulo (0 = norte arriba; positivo = girado a la derecha, como antes)
function girarA(destino) { gl.easeTo({ bearing: -destino, duration: 350 }); }

// Brújula: la aguja roja apunta al norte. Tocarla = norte arriba.
var botonBrujula = crearBotonMapa('boton-brujula', 'Poner el norte arriba',
  '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">' +
  '<path d="M12 2.5l4.5 9.5h-9z" fill="#d50000"/><path d="M12 21.5l-4.5-9.5h9z" fill="#8a8f98"/>' +
  '<text x="12" y="10.6" text-anchor="middle" font-size="5.5" font-weight="700" fill="#fff" font-family="sans-serif">N</text></svg>',
  function () {
    // manejando: prende/apaga "el mapa gira hacia donde vas". Si no: norte arriba (o explica cómo girar)
    if (typeof nav !== 'undefined' && nav.activo) { cambiarRumbo(!nav.rumbo); return; }
    if (botonBrujula.classList.contains('al-norte')) {
      mostrarMensaje('Para girar el mapa, girá dos dedos sobre el mapa. Tocá la brújula para volver al norte.');
      setTimeout(ocultarMensaje, 3500);
    } else girarA(0);
  });
var controlBrujula = { boton: botonBrujula };

var grupos = {};           // id de capa -> capa de Leaflet
var cantidades = {};       // id de capa -> cuántas restricciones tiene
var zonasCargadas = [];
var apagadas = leerGuardado(CLAVE_CAPAS) || {};
var gruposLugares = {};    // tipo de lugar -> capa de Leaflet
var cantidadesLugares = {};
var lugaresPrendidos = leerGuardado(CLAVE_LUGARES) || {};   // arrancan apagados
var camion = camionValido(leerGuardado(CLAVE_CAMION));

// ===== 3. Medidas del camión =====
var ventana = document.getElementById('ventana-camion');
var formCamion = document.getElementById('form-camion');
var botonCancelar = document.getElementById('cancelar-camion');

function camionValido(c) {
  if (!c) return null;
  for (var k in RANGOS) {
    if (typeof c[k] !== 'number' || c[k] < RANGOS[k].min || c[k] > RANGOS[k].max) return null;
  }
  return c;
}

function mostrarResumenCamion() {
  var el = document.getElementById('camion-resumen');
  // en celulares angostos (estilos.css) el peso va abajo de la altura, más chico, para dejarle lugar al buscador
  if (camion) el.innerHTML = '<span class="c-alto">' + esc(metros(camion.altura)) + '</span><span class="c-sep"> · </span>' +
    '<span class="c-peso">' + esc(toneladas(camion.peso)) + '</span><span class="menos"> · ' + esc(metros(camion.largo)) + '</span>';
  else el.textContent = 'Medidas';
  var chip = document.getElementById('btn-camion');
  if (chip) chip.classList.toggle('falta', !camion);
}

function abrirVentanaCamion() {
  if (panel) abrirPanel(false);   // al abrir la página el panel todavía no existe
  ['altura', 'peso', 'largo'].forEach(function (k) {
    var input = document.getElementById('c-' + k);
    input.value = camion ? numero(camion[k], k === 'peso' ? 1 : 2, k === 'peso' ? 0 : 2) : '';
    marcarError(k, '');
  });
  botonCancelar.hidden = !camion;   // la primera vez hay que cargarlas sí o sí
  ventana.hidden = false;
  document.getElementById('c-altura').focus();
}

function cerrarVentanaCamion() { ventana.hidden = true; }

// Acepta "4,10", "4.10", "4,10 m", "45 t"
function leerNumero(texto) {
  var t = String(texto || '').trim().toLowerCase().replace(/\s*(m|mts|metros|t|tn|ton|toneladas)\.?$/, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return parseFloat(t);
}

function marcarError(k, texto) {
  document.getElementById('e-' + k).textContent = texto;
  document.getElementById('c-' + k).setAttribute('aria-invalid', texto ? 'true' : 'false');
}

formCamion.addEventListener('submit', function (ev) {
  ev.preventDefault();
  var nuevo = {};
  var primerError = null;
  Object.keys(RANGOS).forEach(function (k) {
    var r = RANGOS[k];
    var input = document.getElementById('c-' + k);
    var n = leerNumero(input.value);
    var error = '';
    if (input.value.trim() === '') error = 'Falta completar este dato.';
    else if (n === null) error = 'Escribí solo el número, por ejemplo ' + input.placeholder.replace('Ej: ', '') + '.';
    else if (n < r.min || n > r.max) {
      error = r.nombre + ' tiene que estar entre ' + numero(r.min, 1, 0) + ' y ' + numero(r.max, 1, 0) + ' ' + r.unidad + '.';
    }
    marcarError(k, error);
    if (error && !primerError) primerError = input;
    nuevo[k] = n;
  });
  if (primerError) { primerError.focus(); return; }
  var cambio = !camion || ['altura', 'peso', 'largo'].some(function (k) { return camion[k] !== nuevo[k]; });
  camion = nuevo;
  guardar(CLAVE_CAMION, camion);
  if (cambio && typeof anularRutaCalculada === 'function') anularRutaCalculada();
  mostrarResumenCamion();
  cerrarVentanaCamion();
  repintar();
  if (typeof ponerControles === 'function' && controles.lista.length) ponerControles();
  if (zonasIndice.length) armarPanel();   // "no pasás en N" cambia con las medidas
});
botonCancelar.addEventListener('click', cerrarVentanaCamion);
document.getElementById('btn-camion').addEventListener('click', abrirVentanaCamion);
document.addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape' && !ventana.hidden && camion) cerrarVentanaCamion();
});

// ===== 4. ¿Pasa o no pasa? =====
// Devuelve: estado ('no' | 'si' | 'sin_dato' | 'aviso'), y la medida y el límite comparados
function evaluar(p) {
  if (p.capa === 'prohibido') {
    // ordenanzas como "prohibido camiones de más de 6 t": un camión liviano sí puede pasar
    if (p.peso_desde && camion && camion.peso <= p.peso_desde) return { estado: 'si', norma: true };
    // zonas imposibles para camiones largos (semis): con uno corto no es rojo, pero hay que verificar
    if (p.largo_desde && camion && camion.largo <= p.largo_desde) return { estado: 'sin_dato', norma: true };
    return { estado: 'no', norma: !!(p.peso_desde || p.largo_desde) };
  }
  if (p.capa === 'sin_salida') return { estado: 'aviso' };
  // pilotes y bloques cortan el paso; un portón puede estar abierto o cerrado
  if (p.capa === 'barrera') return { estado: p.bloquea ? 'no' : 'sin_dato' };
  if (p.capa === 'obra') return { estado: 'sin_dato' };
  if (p.capa === 'corte') return { estado: p.cortada ? 'no' : 'sin_dato' };   // en vivo (TomTom)
  var medida = MEDIDA_DE_CAPA[p.capa];
  if (!medida || p.limite == null || !camion) return { estado: 'sin_dato', medida: medida };
  var valor = medidaCamion(medida);
  // Ancho de la calle (no un cartel de ancho máximo): hace falta medio metro más que el camión (espejos)
  if (p.calzada) {
    return { estado: p.limite < valor + 0.5 ? 'no' : 'sin_dato', calzada: true, medida: medida, valor: valor, limite: p.limite };
  }
  // Igual al límite: el cartel permite pasar, pero se avisa que es justo
  var justo = Math.abs(valor - p.limite) < 0.005;
  return { estado: valor > p.limite && !justo ? 'no' : 'si', justo: justo, medida: medida,
           valor: valor, limite: p.limite };
}

// ===== 5. Carga de datos =====
mostrarResumenCamion();
if (!camion) abrirVentanaCamion();

// Cada zona se baja recién cuando se la mira (o cuando una ruta pasa por ella):
// así el celular no tiene que bajar todas las zonas al abrir la página.
var zonasIndice = [];         // lo que dice datos/zonas.json (todas las zonas disponibles)
var zonasPedidas = {};        // id de zona -> promesa de su carga
var ZOOM_MINIMO_DATOS = 9;    // más lejos que esto no se baja nada (sería el país entero)
var zonasCargando = 0;
var zonasOk = {};             // zonas que se cargaron bien

CAPAS.forEach(function (c) {
  cantidades[c.id] = 0;
  grupos[c.id] = crearCapa([]);
});
LUGARES.forEach(function (l) {
  cantidadesLugares[l.id] = 0;
  gruposLugares[l.id] = crearCapaLugares([]);
});

function bajarJSON(archivo, obligatorio) {
  if (!archivo) return Promise.resolve({ features: [] });
  var pedido = fetch('datos/' + archivo, { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(archivo + ' ' + r.status); return r.json(); });
  return obligatorio ? pedido : pedido.catch(function (e) { console.error(e); return { features: [] }; });
}

// Las restricciones de una zona (lo que hace falta para revisar una ruta). v73: los lugares y la red de tránsito
// pesado van aparte (cargarZona): en un viaje largo se bajaban los de todas las ciudades del camino (varios MB).
var zonasExtras = {};          // id de zona -> promesa de sus lugares y su red
function cargarZona(z) {
  if (!zonasExtras[z.id]) {
    zonasExtras[z.id] = Promise.all([bajarJSON(z.lugares), bajarJSON(z.red)]).then(function (r) {
      try { agregarExtrasZona({ zona: z, lugares: r[0], red: r[1] }); } catch (e) { console.error(e); }
    });
  }
  return Promise.all([cargarRestriccionesZona(z), zonasExtras[z.id]]);
}
function agregarExtrasZona(r) {
  r.lugares.features.forEach(agregarLugar);
  agregarRedPesada(r);
  mostrarLugares();
  armarPanelLugares();
}
function cargarRestriccionesZona(z) {
  if (zonasPedidas[z.id]) return zonasPedidas[z.id];
  zonasCargando++;
  mostrarMensaje('Cargando ' + z.titulo + '...');
  // Las restricciones son obligatorias; si fallan las normas o los obstáculos, el mapa anda igual
  zonasPedidas[z.id] = Promise.all([bajarJSON(z.archivo, true), bajarJSON(z.normas), bajarJSON(z.obstaculos)])
    .then(function (r) {
      zonasCargando--;
      // las normas locales (ordenanzas) se suman a las restricciones de OpenStreetMap
      try {
        agregarZona({ zona: z, datos: { features: r[0].features.concat(r[1].features, r[2].features) }, lugares: { features: [] }, red: null });
        zonasOk[z.id] = true;
      } catch (e) { console.error(e); }
      if (!zonasCargando && /^Cargando /.test(document.getElementById('mensaje').textContent)) ocultarMensaje();
    }, function (e) {
      zonasCargando--;
      console.error(e);
      delete zonasPedidas[z.id];   // se puede volver a intentar
      mostrarMensaje('No pude cargar ' + z.titulo + '. Revisá la conexión y mové el mapa para reintentar.', true);
    });
  return zonasPedidas[z.id];
}

function agregarZona(r) {
  zonasCargadas.push(r);
  r.datos.features.forEach(function (f) {
    var g = grupos[f.properties.capa];
    if (!g) return;
    // si la misma restricción ya vino con el resto del país, queda la de la zona
    var k = clavePais(f.properties);
    if (k) {
      enZonas[k] = true;
      if (pais.capas[k]) { g.removeLayer(pais.capas[k]); cantidades[f.properties.capa]--; delete pais.capas[k]; }
    }
    g.addData(f);
    cantidades[f.properties.capa]++;
  });
  // (los lugares y la red llegan aparte: agregarExtrasZona; los bordes de lo rojo nuevo se agregan solos: anotarNuevo)
  if (!panel.hidden) armarPanel();
  armarPanelLugares();
  revisarAvisoZona();
}

// Zonas que tocan un rectángulo (con un margen)
function zonasEn(limites) {
  return zonasIndice.filter(function (z) { return z.limites && L.latLngBounds(z.limites).pad(0.05).intersects(limites); });
}
// Zonas por donde pasan uno o varios recorridos. No el rectángulo entero: en un viaje en diagonal
// (Mar del Plata → Córdoba) el rectángulo toca casi todas las zonas y el celular bajaría varios MB de más.
function zonasEnRutas(listas) {
  var cajas = zonasIndice.map(function (z) { return { z: z, b: L.latLngBounds(z.limites).pad(0.02) }; });
  var res = {};
  listas.forEach(function (puntos) {
    for (var i = 0; i < puntos.length; i++) {
      var a = puntos[i], b = puntos[i + 1] || a;
      var n = Math.max(1, Math.ceil(L.latLng(a).distanceTo(b) / 2000));   // un punto cada 2 km como mínimo
      for (var k = 0; k < n; k++) {
        var ll = L.latLng(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n);
        for (var j = 0; j < cajas.length; j++) if (!res[cajas[j].z.id] && cajas[j].b.contains(ll)) res[cajas[j].z.id] = cajas[j].z;
      }
    }
  });
  return Object.keys(res).map(function (k) { return res[k]; });
}
function cargarZonasEnRutas(listas) { return Promise.all(zonasEnRutas(listas).map(cargarRestriccionesZona)); }
function zonasSinCargarEnRutas(listas) {
  return zonasEnRutas(listas).filter(function (z) { return !zonasOk[z.id]; }).map(function (z) { return z.titulo; });
}
function cargarZonasEn(limites) {
  return Promise.all(zonasEn(limites).map(cargarZona));
}
function cargarZonasVisibles() {
  if (!zonasIndice.length) return;
  var m = document.getElementById('mensaje');
  if (mapa.getZoom() < ZOOM_MINIMO_DATOS) {
    if (!zonasCargadas.length) mostrarMensaje('Acercá el mapa a una ciudad para ver las restricciones.');
    return;
  }
  if (/^Acercá el mapa|^Todavía no hay datos|^Acá solo hay/.test(m.textContent)) ocultarMensaje();
  cargarPaisEn(mapa.getBounds().pad(0.2));
  cargarLugaresVista();
  var visibles = zonasEn(mapa.getBounds().pad(0.2));
  if (!visibles.length && !zonasCargando) {
    // fuera de las ciudades descargadas: se avisa una vez qué hay y qué no
    if (pais.celdas.length) {
      if (pais.avisado) return;
      pais.avisado = true;
      mostrarMensaje('Acá solo hay restricciones cargadas en rutas y calles (alturas, pesos, prohibidos). ' +
                     'Las calles sin salida y los pasos bajos calculados están solo en las ciudades de Capas → "Ir a una ciudad".');
      setTimeout(function () { if (/^Acá solo hay/.test(m.textContent)) ocultarMensaje(); }, 9000);
      return;
    }
    mostrarMensaje('Todavía no hay datos de esta zona. Las ciudades con datos están en Capas → "Ir a una ciudad".');
    setTimeout(function () { if (/^Todavía no hay datos/.test(m.textContent)) ocultarMensaje(); }, 6000);
    return;
  }
  visibles.forEach(cargarZona);
}
mapa.on('moveend', cargarZonasVisibles);

// --- Resto del país: restricciones cargadas en OSM fuera de las zonas (rutas, pueblos) ---
// Las baja scripts/descargar_pais.py en cuadrados de 2° (datos/pais/*.geojson, índice datos/pais.json).
// Se bajan los cuadrados que se miran (zoom >= 9) y los de por donde pasa una ruta.
var pais = { celdas: [], pedidas: {}, cargadas: 0, actualizado: null, timer: null, avisado: false, capas: {} };
var enZonas = {};   // restricciones ya cargadas por alguna zona (para no ponerlas dos veces)
function clavePais(p) { return p.osm && /^(altura|peso|largo|prohibido)$/.test(p.capa) ? p.osm + '|' + p.capa : null; }
fetch('datos/pais.json', { cache: 'no-cache' })
  .then(function (r) { return r.ok ? r.json() : null; })
  .then(function (d) {
    if (!d || !d.celdas) return;
    pais.celdas = d.celdas;
    pais.actualizado = d.actualizado;
    if (mapa.getZoom() >= ZOOM_MINIMO_DATOS) cargarPaisEn(mapa.getBounds().pad(0.2));
    // si ya se dijo "no hay datos" (el índice del país llegó después), se corrige el cartel
    if (/^Todavía no hay datos/.test(document.getElementById('mensaje').textContent)) cargarZonasVisibles();
  })
  .catch(function (e) { console.warn('Sin datos del resto del país:', e); });

function cargarCeldaPais(c) {
  if (pais.pedidas[c.archivo]) return pais.pedidas[c.archivo];
  pais.pedidas[c.archivo] = bajarJSON(c.archivo, true).then(function (d) {
    d.features.forEach(function (f) {
      var g = grupos[f.properties.capa], k = clavePais(f.properties);
      if (!g || (k && (enZonas[k] || pais.capas[k]))) return;
      g.addData(f);
      cantidades[f.properties.capa]++;
      if (k) { var capas = g.getLayers(); pais.capas[k] = capas[capas.length - 1]; }
    });
    pais.cargadas++;
    clearTimeout(pais.timer);   // si llegan varios cuadrados juntos, se redibuja una vez
    pais.timer = setTimeout(function () { if (zonasIndice.length && !panel.hidden) armarPanel(); }, 250);
  }, function (e) {
    console.error(e);
    delete pais.pedidas[c.archivo];   // se puede volver a intentar
  });
  return pais.pedidas[c.archivo];
}
function cargarPaisEn(limites) {
  return Promise.all(pais.celdas.filter(function (c) { return L.latLngBounds(c.limites).intersects(limites); })
    .map(cargarCeldaPais));
}
// Los cuadrados por donde pasan uno o varios recorridos (no el rectángulo entero: en un viaje en diagonal serían muchos)
function celdasEnRutas(celdas, listas) {
  var pedir = {};
  if (!celdas.length) return [];
  listas.forEach(function (puntos) {
    for (var i = 0; i < puntos.length; i++) {
      var a = puntos[i], b = puntos[i + 1] || a;
      var n = Math.max(1, Math.ceil(L.latLng(a).distanceTo(b) / 20000));   // un punto cada 20 km como mínimo
      for (var k = 0; k < n; k++) {
        var lat = a[0] + (b[0] - a[0]) * k / n, lng = a[1] + (b[1] - a[1]) * k / n;
        celdas.forEach(function (c) {
          if (lat >= c.limites[0][0] && lat <= c.limites[1][0] && lng >= c.limites[0][1] && lng <= c.limites[1][1]) pedir[c.archivo] = c;
        });
      }
    }
  });
  return Object.keys(pedir).map(function (k) { return pedir[k]; });
}
// (también baja las estaciones de servicio, paradores y gomerías de esos cuadrados, para la lista de la ruta)
function cargarPaisEnRutas(listas) {
  return Promise.all(celdasEnRutas(pais.celdas, listas).map(cargarCeldaPais)
    .concat(celdasEnRutas(paisLugares.celdas, listas).map(cargarCeldaLugares)));
}

// --- Lugares útiles del resto del país (estaciones de servicio, paradores, gomerías... en las rutas) ---
// Los baja scripts/descargar_lugares_pais.py en cuadrados de 2° (datos/pais-lugares/*.geojson, índice
// datos/pais-lugares.json). Se bajan los de lo que se ve (solo si los lugares están prendidos y el mapa cerca) y
// los de por donde pasa una ruta (para "Dónde cargar y parar en el camino").
var paisLugares = { celdas: [], pedidas: {}, timer: null };
var lugarVisto = {};   // osm -> true: un lugar que viene en una zona y en el país va una sola vez
fetch('datos/pais-lugares.json', { cache: 'no-cache' })
  .then(function (r) { return r.ok ? r.json() : null; })
  .then(function (d) {
    if (!d || !d.celdas) return;
    paisLugares.celdas = d.celdas;
    cargarLugaresVista();
  })
  .catch(function (e) { console.warn('Sin lugares del resto del país:', e); });
function agregarLugar(f) {
  var k = f.properties.osm, g = gruposLugares[f.properties.tipo];
  if (!g || (k && lugarVisto[k])) return false;
  if (k) lugarVisto[k] = true;
  g.addData(f);
  cantidadesLugares[f.properties.tipo]++;
  return true;
}
function cargarCeldaLugares(c) {
  if (paisLugares.pedidas[c.archivo]) return paisLugares.pedidas[c.archivo];
  paisLugares.pedidas[c.archivo] = bajarJSON(c.archivo, true).then(function (d) {
    var n = 0;
    d.features.forEach(function (f) { if (agregarLugar(f)) n++; });
    if (!n) return;
    clearTimeout(paisLugares.timer);   // varios cuadrados juntos: se redibuja una vez
    paisLugares.timer = setTimeout(function () { mostrarLugares(); armarPanelLugares(); }, 250);
  }, function (e) {
    console.error(e);
    delete paisLugares.pedidas[c.archivo];   // se puede volver a intentar
  });
  return paisLugares.pedidas[c.archivo];
}
function cargarLugaresVista() {
  if (!paisLugares.celdas.length || mapa.getZoom() < ZOOM_LUGARES_LEJOS) return;
  if (!LUGARES.some(function (l) { return lugaresPrendidos[l.id]; })) return;
  var lim = mapa.getBounds().pad(0.2);
  paisLugares.celdas.forEach(function (c) { if (L.latLngBounds(c.limites).intersects(lim)) cargarCeldaLugares(c); });
}

// Lugares útiles a menos de 150 m de la ruta, con el kilómetro donde quedan (para la lista de la tarjeta)
var TIPOS_EN_RUTA = { combustible: 1, parador: 1, gomeria: 1, taller: 1, estacionamiento: 1, balanza: 1 };
function lugaresEnRuta(puntos) {
  if (puntos.length < 2) return [];
  var lat0 = puntos[0][0] * Math.PI / 180, kx = Math.cos(lat0) * 111320, ky = 110540, C = 500;   // cuadraditos de 500 m
  var acum = [0], grilla = {};
  for (var i = 1; i < puntos.length; i++) {
    var ax = puntos[i - 1][1] * kx, ay = puntos[i - 1][0] * ky, bx = puntos[i][1] * kx, by = puntos[i][0] * ky;
    acum.push(acum[i - 1] + Math.hypot(bx - ax, by - ay));
    for (var gx = Math.floor(Math.min(ax, bx) / C); gx <= Math.floor(Math.max(ax, bx) / C); gx++) {
      for (var gy = Math.floor(Math.min(ay, by) / C); gy <= Math.floor(Math.max(ay, by) / C); gy++) {
        (grilla[gx + ',' + gy] || (grilla[gx + ',' + gy] = [])).push(i);
      }
    }
  }
  var res = [];
  Object.keys(TIPOS_EN_RUTA).forEach(function (tipo) {
    if (!gruposLugares[tipo]) return;
    gruposLugares[tipo].eachLayer(function (l) {
      var ll = l.getLatLng(), px = ll.lng * kx, py = ll.lat * ky, cx = Math.floor(px / C), cy = Math.floor(py / C);
      var mejor = Infinity, km = 0, visto = {};
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
        (grilla[(cx + dx) + ',' + (cy + dy)] || []).forEach(function (j) {
          if (visto[j]) return;
          visto[j] = true;
          var ax = puntos[j - 1][1] * kx, ay = puntos[j - 1][0] * ky, vx = puntos[j][1] * kx - ax, vy = puntos[j][0] * ky - ay;
          var L2 = vx * vx + vy * vy, t = L2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
          var d = Math.hypot(ax + t * vx - px, ay + t * vy - py);
          if (d < mejor) { mejor = d; km = (acum[j - 1] + t * Math.sqrt(L2)) / 1000; }
        });
      }
      if (mejor <= 150) res.push({ l: l, km: km });
    });
  });
  return res.sort(function (a, b) { return a.km - b.km; });
}

mostrarMensaje('Cargando restricciones...');
fetch('datos/zonas.json', { cache: 'no-cache' })
  .then(function (r) { if (!r.ok) throw new Error('zonas.json ' + r.status); return r.json(); })
  .then(function (indice) {
    // solo zonas con restricciones descargadas (una zona a medio bajar no se ofrece ni cuenta como revisada)
    zonasIndice = indice.zonas.filter(function (z) { return z.limites && z.archivo; });
    // Zonas con muy pocas restricciones cargadas en OpenStreetMap: avisar (como Mar del Plata)
    zonasIndice.forEach(function (z) {
      var c = z.conteo || {};
      var cargadas = (c.prohibido || 0) + (c.peso || 0) + (c.altura || 0) + (c.largo || 0);
      if (!z.aviso && z.conteo && cargadas < 25) {
        z.aviso = 'En ' + z.titulo + ' casi no hay datos de restricciones: respetá la señalización.';
      }
    });
    ocultarMensaje();
    armarPanel();
    cargarZonasVisibles();
    cargarReportes();
  })
  .catch(function (e) {
    console.error(e);
    var porArchivo = location.protocol === 'file:';
    mostrarMensaje(porArchivo
      ? 'No se pueden cargar los datos abriendo el archivo con doble clic. En PowerShell, dentro de la carpeta del proyecto, escribí: python scripts/servidor_local.py  y abrí http://localhost:8000'
      : 'No pude cargar las restricciones. Revisá la conexión y recargá la página.', true);
  });

// ===== 6. Dibujo de cada restricción =====
// Los datos quedan en capas de Leaflet que NO se dibujan (sirven para revisar la ruta y para los carteles).
// Lo que se ve es una fuente de MapLibre ("restr") que se arma con el estado de cada una según tu camión;
// el color, el grosor según el zoom, el borde blanco de lo rojo y lo punteado los pone MapLibre.
function crearCapa(features) {
  return L.geoJSON({ type: 'FeatureCollection', features: features }, {
    pointToLayer: function (f, latlng) { return L.circleMarker(latlng); }
  });
}

// ¿Se dibuja? Lo que tu camión pasa (gris) solo si lo pediste en Capas; "pasás justo" siempre
function oculto(e) { return e.estado === 'si' && !e.justo && !apagadas.ver_gris; }

var ZOOM_SIN_SALIDA = 13;   // las calles sin salida (miles de puntos violetas) se ven solo de cerca
var VACIO = { type: 'FeatureCollection', features: [] };
var fuentes = {};           // id de fuente -> datos (se vuelven a poner si cambia el mapa de fondo)
function ponerDatos(id, features) {
  fuentes[id] = { type: 'FeatureCollection', features: features };
  var f = gl.getSource(id);
  if (f) f.setData(fuentes[id]);
}

var restrPorId = {};        // número -> capa de Leaflet (para el cartel)
var pintura = { timer: null };
function pedirRepintar() { if (!pintura.timer) pintura.timer = setTimeout(repintar, 60); }
// --- Zonas agrupadas (20/11/2026, pedido del chofer: "unirlas como la zona de Mar del Plata, que no haya tantas rayas") ---
// Donde hay MUCHAS calles rojas juntas (ej. el microcentro de Buenos Aires), de lejos se dibuja una sola zona roja
// clarita y se esconden esas rayas; de cerca (zoom de MapLibre 14,5 o más) desaparece la zona y se ven las calles
// una por una (dentro de la zona puede haber calles permitidas). Es solo el dibujo: la ruta y los avisos siguen
// usando cada calle. Cómo se arma: cuadritos de 150 m; un cuadrito es "denso" si lo tocan 2 o más calles rojas
// distintas; los cuadritos densos pegados forman un grupo; si el grupo tiene 6 o más cuadritos y 8 o más calles,
// la zona es la envolvente de los puntos de esas calles dentro del grupo (más 25 m de margen).
var AGRUPAR = { celda: 150, minCeldas: 6, minCalles: 8, margen: 25, zoomCalles: 14.5 };
var zonasAgrupadas = [];
function agruparRojas(lineas) {   // lineas: [{ id, capa, coords: [[lng, lat], ...] }] (solo las rojas)
  zonasAgrupadas = [];
  if (lineas.length < AGRUPAR.minCalles) return { zonas: [], adentro: null };
  var lat0 = lineas[0].coords[0][1], kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540, C = AGRUPAR.celda;
  var celdas = {};   // 'x,y' -> { ids: {}, pts: [] }
  lineas.forEach(function (l) {
    var c = l.coords;
    for (var i = 0; i < c.length; i++) {
      var a = c[i], b = c[i + 1] || c[i];
      var dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 40));
      for (var k = 0; k < (i < c.length - 1 ? n : 1); k++) {
        var x = a[0] * kx + dx * k / n, y = a[1] * ky + dy * k / n;
        var key = Math.floor(x / C) + ',' + Math.floor(y / C);
        var cel = celdas[key] || (celdas[key] = { ids: {}, n: 0, pts: [] });
        if (!cel.ids[l.id]) { cel.ids[l.id] = l; cel.n++; }
        cel.pts.push([x, y]);
      }
    }
  });
  var densas = {};
  Object.keys(celdas).forEach(function (k) { if (celdas[k].n >= 2) densas[k] = true; });
  var visto = {}, zonas = [];
  Object.keys(densas).forEach(function (k0) {
    if (visto[k0]) return;
    var grupo = [], pila = [k0];
    visto[k0] = true;
    while (pila.length) {
      var k = pila.pop(), p = k.split(','), x = +p[0], y = +p[1];
      grupo.push(k);
      for (var ix = -1; ix <= 1; ix++) for (var iy = -1; iy <= 1; iy++) {
        var v = (x + ix) + ',' + (y + iy);
        if (densas[v] && !visto[v]) { visto[v] = true; pila.push(v); }
      }
    }
    if (grupo.length < AGRUPAR.minCeldas) return;
    var ids = {}, nCalles = 0, pts = [];
    grupo.forEach(function (k) {
      var cel = celdas[k];
      Object.keys(cel.ids).forEach(function (id) { if (!ids[id]) { ids[id] = cel.ids[id]; nCalles++; } });
      pts = pts.concat(cel.pts);
    });
    if (nCalles < AGRUPAR.minCalles) return;
    var casco = envolvente(pts);
    if (casco.length < 3) return;
    // margen: cada punto se aleja 25 m del centro
    var cx = 0, cy = 0;
    casco.forEach(function (q) { cx += q[0]; cy += q[1]; });
    cx /= casco.length; cy /= casco.length;
    casco = casco.map(function (q) {
      var d = Math.hypot(q[0] - cx, q[1] - cy) || 1;
      return [q[0] + (q[0] - cx) / d * AGRUPAR.margen, q[1] + (q[1] - cy) / d * AGRUPAR.margen];
    });
    // muy alargada (una avenida larga, no un barrio): no es una zona
    var area = 0;
    for (var i = 0; i < casco.length; i++) { var a = casco[i], b = casco[(i + 1) % casco.length]; area += a[0] * b[1] - b[0] * a[1]; }
    area = Math.abs(area) / 2;
    if (area > grupo.length * C * C * 3) return;
    var cuenta = {};
    Object.keys(ids).forEach(function (id) { var c = ids[id].capa; cuenta[c] = (cuenta[c] || 0) + 1; });
    zonas.push({ casco: casco, anillo: casco.concat([casco[0]]).map(function (q) { return [q[0] / kx, q[1] / ky]; }),
                 calles: nCalles, cuenta: cuenta });
  });
  zonasAgrupadas = zonas;
  return { zonas: zonas, adentro: function (lng, lat) {
    var x = lng * kx, y = lat * ky;
    for (var z = 0; z < zonas.length; z++) if (dentroConvexo(zonas[z].casco, x, y)) return z;
    return -1;
  } };
}
// envolvente convexa (cadena monótona), puntos [x, y] en metros
function envolvente(pts) {
  pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  if (pts.length < 3) return pts;
  function cruz(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
  var abajo = [], arriba = [];
  pts.forEach(function (p) {
    while (abajo.length >= 2 && cruz(abajo[abajo.length - 2], abajo[abajo.length - 1], p) <= 0) abajo.pop();
    abajo.push(p);
  });
  for (var i = pts.length - 1; i >= 0; i--) {
    var p = pts[i];
    while (arriba.length >= 2 && cruz(arriba[arriba.length - 2], arriba[arriba.length - 1], p) <= 0) arriba.pop();
    arriba.push(p);
  }
  abajo.pop(); arriba.pop();
  return abajo.concat(arriba);
}
function dentroConvexo(casco, x, y) {   // casco en sentido antihorario
  for (var i = 0; i < casco.length; i++) {
    var a = casco[i], b = casco[(i + 1) % casco.length];
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
  }
  return true;
}
// Parte una línea en pedazos de adentro / afuera de las zonas (para dibujar: lo de adentro se ve solo de cerca)
function partirLinea(coords, adentro) {
  var piezas = [], actual = null, estado = null;
  for (var i = 0; i < coords.length - 1; i++) {
    var a = coords[i], b = coords[i + 1];
    var dentro = adentro((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) >= 0;
    if (dentro !== estado) { if (actual) piezas.push({ ag: estado, coords: actual }); actual = [a]; estado = dentro; }
    actual.push(b);
  }
  if (actual) piezas.push({ ag: estado, coords: actual });
  return piezas;
}
function repintar() {
  clearTimeout(pintura.timer);
  pintura.timer = null;
  var feats = [], rojas = [];
  restrPorId = {};
  CAPAS.forEach(function (c) {
    if (apagadas[c.id] || !grupos[c.id]) return;
    grupos[c.id].eachLayer(function (l) {
      var f = l.feature, ev = evaluar(f.properties), id = L.stamp(l);
      restrPorId[id] = l;
      var props = { id: id, e: ev.estado, ve: oculto(ev) ? 0 : 1, ss: c.id === 'sin_salida' ? 1 : 0,
                    pt: c.forma === 'punteada' || (c.id === 'corte' && ev.estado !== 'no') ? 1 : 0 };
      var g = f.geometry;
      // calles rojas (no cortes en vivo): candidatas a juntarse en una zona
      if (ev.estado === 'no' && c.id !== 'corte' && g && (g.type === 'LineString' || g.type === 'MultiLineString')) {
        (g.type === 'LineString' ? [g.coordinates] : g.coordinates).forEach(function (cs) {
          if (cs.length > 1) rojas.push({ id: id, capa: f.properties.capa, coords: cs, props: props });
        });
        return;
      }
      feats.push({ type: 'Feature', geometry: g, properties: props });
    });
  });
  var ag = agruparRojas(rojas);
  rojas.forEach(function (r) {
    var piezas = ag.zonas.length ? partirLinea(r.coords, ag.adentro) : [{ ag: false, coords: r.coords }];
    piezas.forEach(function (pz) {
      feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pz.coords },
                   properties: pz.ag ? L.extend({ ag: 1 }, r.props) : r.props });
    });
  });
  ag.zonas.forEach(function (z, i) {
    feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [z.anillo] },
                 properties: { id: -1 - i, zg: i, e: 'no', ve: 1, ss: 0, pt: 0 } });
  });
  ponerDatos('restr', feats);
}
function ponerRojosArriba() { pedirRepintar(); }   // (lo rojo ya va siempre arriba)
// cuando llegan datos nuevos (una zona, el país, cortes en vivo) se vuelve a armar, una vez por tanda
Object.keys(grupos).forEach(function (id) {
  grupos[id].on('layeradd', pedirRepintar);
  grupos[id].on('layerremove', pedirRepintar);
});

// Capas de MapLibre propias. Se ponen al cargar el estilo (y de nuevo si cambia, por ejemplo al de respaldo).
// Las líneas van DEBAJO de los nombres de las calles del fondo (así se leen); puntos e íconos, arriba de todo.
var GEO_LINEAS = ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]];
var GEO_PUNTOS = ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]];
var GEO_AREAS = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]];
var COLOR_ESTADO = ['match', ['get', 'e'], 'no', COLORES.no, 'si', COLORES.si, 'sin_dato', COLORES.sin_dato, COLORES.aviso];
function es(campo, valor) { return ['==', ['get', campo], valor]; }
// grosor como antes: finas de lejos, gruesas de cerca (zoom de MapLibre = el de antes menos uno)
function grosorZoom(suma, minimo) {
  var m = minimo || 0;
  return ['interpolate', ['linear'], ['zoom'], 10, Math.max(m, 1.5 + suma), 11, Math.max(m, 2 + suma),
          12, Math.max(m, 3 + suma), 13, Math.max(m, 4 + suma), 14, Math.max(m, 5 + suma)];
}
function radioZoom() {
  var paso = function (r) { return ['case', es('e', 'no'), r + 0.5, r]; };
  return ['interpolate', ['linear'], ['zoom'], 10, paso(2), 11, paso(2.5), 12, paso(4), 13, paso(5.5), 14, paso(7.5)];
}
function ponerCapasPropias() {
  if (gl.getSource('restr')) return;
  var nombres = gl.getStyle().layers.filter(function (l) { return l.type === 'symbol'; })[0];
  var debajo = nombres ? nombres.id : undefined;
  ['red', 'ruta', 'restr', 'precision', 'lugares', 'controles', 'reportes'].forEach(function (id) {
    gl.addSource(id, { type: 'geojson', data: fuentes[id] || VACIO, tolerance: 0.4, buffer: 32 });
  });
  var redondo = { 'line-cap': 'round', 'line-join': 'round' };
  [
    { id: 'red-pesada', type: 'line', source: 'red', layout: redondo,
      paint: { 'line-color': '#2e7d32', 'line-opacity': 0.5, 'line-width': ['step', ['zoom'], 2, 12, 4, 14, 7] } },
    { id: 'ruta-alt', type: 'line', source: 'ruta', filter: es('t', 'alt'),
      paint: { 'line-color': '#5b6470', 'line-opacity': 0.55, 'line-width': 5, 'line-dasharray': [1.6, 1.6] } },
    { id: 'ruta-borde', type: 'line', source: 'ruta', filter: es('t', 'p'), layout: redondo,
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.9, 'line-width': 11 } },
    { id: 'ruta-linea', type: 'line', source: 'ruta', filter: es('t', 'p'), layout: redondo,
      paint: { 'line-color': '#1565c0', 'line-opacity': 0.85, 'line-width': 7 } },
    // zonas agrupadas (muchas calles rojas juntas): solo de lejos
    { id: 'r-agrupada', type: 'fill', source: 'restr', maxzoom: AGRUPAR.zoomCalles, filter: ['all', GEO_AREAS, ['has', 'zg']],
      paint: { 'fill-color': COLORES.no, 'fill-opacity': 0.14 } },
    { id: 'r-agrupada-borde', type: 'line', source: 'restr', maxzoom: AGRUPAR.zoomCalles, filter: ['all', GEO_AREAS, ['has', 'zg']],
      paint: { 'line-color': COLORES.no, 'line-width': grosorZoom(0), 'line-opacity': 0.9 } },
    { id: 'r-zona', type: 'fill', source: 'restr', filter: ['all', GEO_AREAS, es('ve', 1), ['!', ['has', 'zg']]],
      paint: { 'fill-color': COLOR_ESTADO, 'fill-opacity': ['case', es('e', 'si'), 0.04, 0.12] } },
    { id: 'r-zona-borde', type: 'line', source: 'restr', filter: ['all', GEO_AREAS, es('ve', 1), ['!', ['has', 'zg']]],
      paint: { 'line-color': COLOR_ESTADO, 'line-width': grosorZoom(0) } },
    { id: 'r-gris', type: 'line', source: 'restr', filter: ['all', GEO_LINEAS, es('ve', 1), es('e', 'si')], layout: redondo,
      paint: { 'line-color': COLORES.si, 'line-opacity': 0.5, 'line-width': grosorZoom(-1, 1) } },
    { id: 'r-amarillo', type: 'line', source: 'restr', filter: ['all', GEO_LINEAS, es('ve', 1), es('e', 'sin_dato'), es('pt', 0)],
      layout: redondo,
      paint: { 'line-color': COLORES.sin_dato, 'line-width': grosorZoom(0),
               'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.75, 13, 0.95] } },
    { id: 'r-amarillo-punteado', type: 'line', source: 'restr',
      filter: ['all', GEO_LINEAS, es('ve', 1), es('e', 'sin_dato'), es('pt', 1)],
      paint: { 'line-color': COLORES.sin_dato, 'line-width': grosorZoom(0), 'line-dasharray': [2, 1.5],
               'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.75, 13, 0.95] } },
    { id: 'r-rojo-borde', type: 'line', source: 'restr', filter: ['all', GEO_LINEAS, es('e', 'no'), ['!=', ['get', 'ag'], 1]], layout: redondo,
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.95, 'line-width': grosorZoom(5.5) } },
    { id: 'r-rojo', type: 'line', source: 'restr', filter: ['all', GEO_LINEAS, es('e', 'no'), ['!=', ['get', 'ag'], 1]], layout: redondo,
      paint: { 'line-color': COLORES.no, 'line-width': grosorZoom(1.5) } },
    // las calles de adentro de una zona agrupada: solo de cerca
    { id: 'r-rojo-ag-borde', type: 'line', source: 'restr', minzoom: AGRUPAR.zoomCalles, filter: ['all', GEO_LINEAS, es('ag', 1)], layout: redondo,
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.95, 'line-width': grosorZoom(5.5) } },
    { id: 'r-rojo-ag', type: 'line', source: 'restr', minzoom: AGRUPAR.zoomCalles, filter: ['all', GEO_LINEAS, es('ag', 1)], layout: redondo,
      paint: { 'line-color': COLORES.no, 'line-width': grosorZoom(1.5) } }
  ].forEach(function (c) { gl.addLayer(c, debajo); });
  [
    { id: 'r-sin-salida', type: 'circle', source: 'restr', minzoom: ZOOM_SIN_SALIDA - 1,
      filter: ['all', GEO_PUNTOS, es('ss', 1)],
      paint: { 'circle-color': COLORES.aviso, 'circle-radius': radioZoom(), 'circle-stroke-color': '#ffffff',
               'circle-stroke-width': ['step', ['zoom'], 0.5, 12, 1, 14, 2] } },
    { id: 'r-puntos', type: 'circle', source: 'restr', filter: ['all', GEO_PUNTOS, es('ss', 0), es('ve', 1)],
      paint: { 'circle-color': COLOR_ESTADO, 'circle-radius': radioZoom(), 'circle-stroke-color': '#ffffff',
               'circle-stroke-width': ['step', ['zoom'], 0.5, 12, 1, 14, 2],
               'circle-opacity': ['case', es('e', 'si'), 0.6, 0.95] } },
    { id: 'precision-area', type: 'fill', source: 'precision', paint: { 'fill-color': '#1a73e8', 'fill-opacity': 0.12 } },
    { id: 'precision-borde', type: 'line', source: 'precision', paint: { 'line-color': '#1a73e8', 'line-opacity': 0.4, 'line-width': 1 } },
    // de lejos: solo los que entran sin taparse y con lugar alrededor (MapLibre esconde los que se pisan; en una ciudad
    // quedan pocos, en la ruta casi todos), un poco más chicos
    { id: 'lugares-lejos', type: 'symbol', source: 'lugares', minzoom: ZOOM_LUGARES_LEJOS - 1, maxzoom: ZOOM_LUGARES - 1,
      layout: { 'icon-image': ['get', 'ic'], 'icon-allow-overlap': false, 'icon-padding': 16, 'symbol-sort-key': ['get', 'pr'],
                'icon-size': ['interpolate', ['linear'], ['zoom'], ZOOM_LUGARES_LEJOS - 1, 0.8, ZOOM_LUGARES - 1, 0.95] } },
    { id: 'lugares', type: 'symbol', source: 'lugares', minzoom: ZOOM_LUGARES - 1,
      layout: { 'icon-image': ['get', 'ic'], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
                'icon-size': ['interpolate', ['linear'], ['zoom'], ZOOM_LUGARES - 1, 1, 15, 1.15] } },
    { id: 'reportes', type: 'symbol', source: 'reportes',
      layout: { 'icon-image': 'ic-reporte', 'icon-allow-overlap': true, 'icon-ignore-placement': true } },
    { id: 'controles', type: 'symbol', source: 'controles', minzoom: ZOOM_CONTROLES - 1, filter: ['!=', ['get', 'r'], 1],
      layout: { 'icon-image': ['get', 'ic'], 'icon-allow-overlap': true, 'icon-ignore-placement': true } },
    // radares y cámaras: en las ciudades hay muchos; de lejos se ven los que entran sin taparse
    { id: 'radares-lejos', type: 'symbol', source: 'controles', minzoom: ZOOM_CONTROLES, maxzoom: 13, filter: ['==', ['get', 'r'], 1],
      layout: { 'icon-image': ['get', 'ic'], 'icon-allow-overlap': false, 'icon-padding': 12,
                'icon-size': ['interpolate', ['linear'], ['zoom'], ZOOM_CONTROLES, 0.75, 13, 0.95] } },
    { id: 'radares', type: 'symbol', source: 'controles', minzoom: 13, filter: ['==', ['get', 'r'], 1],
      layout: { 'icon-image': ['get', 'ic'], 'icon-allow-overlap': true, 'icon-ignore-placement': true } }
  ].forEach(function (c) { gl.addLayer(c); });
  ponerVisibilidad();
}
gl.on('style.load', ponerCapasPropias);

// Capas que se prenden y apagan enteras desde "Qué mostrar"
function ponerVisibilidad() {
  [['controles', 'controles'], ['radares', 'controles'], ['radares-lejos', 'controles'], ['reportes', 'reportes'],
   ['red-pesada', 'red_pesada']].forEach(function (x) {
    if (gl.getLayer(x[0])) gl.setLayoutProperty(x[0], 'visibility', apagadas[x[1]] ? 'none' : 'visible');
  });
}

// ===== 7. Cartel al tocar =====
function abrirCartelRestriccion(l, ll) {
  var p = l.feature.properties;
  ll = ll || (l.getLatLng ? l.getLatLng() : l.getBounds().getCenter());
  function contenido() { return armarCartel(p) + botonReportar(ll, describirRestriccion(p)); }
  var c = abrirCartel(ll, contenido());
  // un corte en vivo: entre qué calles es (se pide al tocarlo)
  if (p.capa === 'corte') detalleCorteAlAbrir(p, function () { if (cartel === c) c.setHTML(contenido()); });
}
// Cartel de una zona agrupada (muchas calles rojas juntas)
var NOMBRES_AGRUPADA = { prohibido: 'prohibidas para camiones', peso: 'con límite de peso', altura: 'con paso bajo',
                         largo: 'con límite de largo', ancho: 'angostas', barrera: 'con barrera', obra: 'en obra' };
function abrirCartelAgrupada(i, ll) {
  var z = zonasAgrupadas[i];
  if (!z) return;
  var detalle = Object.keys(z.cuenta).sort(function (a, b) { return z.cuenta[b] - z.cuenta[a]; }).map(function (c) {
    return z.cuenta[c] + ' ' + (NOMBRES_AGRUPADA[c] || c);
  }).join(' · ');
  var div = document.createElement('div');
  div.innerHTML = '<div class="cartel-tipo">Zona con muchas calles prohibidas</div>' +
    '<div class="cartel-valor">' + z.calles + ' calles donde tu camión NO pasa</div>' +
    '<div class="veredicto no">Evitá esta zona con el camión<small>' + esc(detalle) + '</small></div>' +
    '<div class="cartel-detalle">De lejos se muestran juntas para que el mapa se vea más limpio. Acercá el mapa para ver ' +
    'cuáles son: alguna calle de adentro puede estar permitida.</div>' +
    '<div class="cartel-fila"><button type="button" class="cartel-boton-chico">🔍 Acercar y ver las calles</button></div>' +
    '<div class="cartel-fuente">Fuente: OpenStreetMap</div>';
  div.querySelector('button').addEventListener('click', function () {
    cerrarCartel();
    gl.easeTo({ center: [ll.lng, ll.lat], zoom: Math.max(gl.getZoom(), AGRUPAR.zoomCalles + 0.6) });
  });
  abrirCartel(ll, div);
}
// Lo que marca un aviso de la ruta (una restricción o un reporte)
function abrirCartelDeCapa(l, ll) {
  if (!l || !l.feature) return;
  if (l.feature.properties.capa) abrirCartelRestriccion(l, ll);
  else abrirCartel(ll || l.getLatLng(), armarCartelReporte(l.feature.properties));
}

function armarCartel(p) {
  var html = '<div class="cartel-tipo">' + esc(p.titulo) + '</div>';
  html += '<div class="cartel-valor">' + esc(textoValor(p)) + '</div>';
  if (p.calle) html += '<div class="cartel-calle">' + esc(p.calle) + '</div>';
  html += veredicto(p);
  if (p.detalle) html += '<div class="cartel-detalle">' + esc(p.detalle) + '</div>';
  html += '<div class="cartel-fuente">Fuente: ' + esc(p.fuente || 'OpenStreetMap');
  if (p.fuente_url) {
    html += ' · <a href="' + esc(p.fuente_url) + '" target="_blank" rel="noopener">ver la norma</a>';
  } else if (p.osm) {
    html += ' · <a href="https://www.openstreetmap.org/' + encodeURI(p.osm) +
            '" target="_blank" rel="noopener">ver en OpenStreetMap</a>';
  }
  html += '</div>';
  return html;
}

function veredicto(p) {
  var e = evaluar(p);
  var titulo, nota = '';
  if (p.capa === 'prohibido' && e.estado === 'si') {
    titulo = 'PASÁS';
    nota = 'La prohibición es para camiones de más de ' + toneladas(p.peso_desde) + ' y el tuyo pesa ' + toneladas(camion.peso) + '.';
  } else if (p.capa === 'prohibido' && e.estado === 'sin_dato') {
    titulo = 'OJO: muy difícil para camiones';
    nota = 'Es imposible para camiones de más de ' + metros(p.largo_desde) + '. El tuyo mide ' + metros(camion.largo) +
           ': puede ser que pases, verificá antes de entrar.';
  } else if (p.capa === 'prohibido') {
    titulo = p.largo_desde ? 'NO PASÁS: imposible para tu camión' : 'NO PODÉS CIRCULAR: prohibido para camiones';
    if (p.peso_desde && camion) nota = 'Es para camiones de más de ' + toneladas(p.peso_desde) + ' y el tuyo pesa ' + toneladas(camion.peso) + '.';
    if (p.largo_desde && camion) nota = 'Es para camiones de más de ' + metros(p.largo_desde) + ' y el tuyo mide ' + metros(camion.largo) + '.';
  } else if (p.capa === 'barrera') {
    titulo = e.estado === 'no' ? 'NO PASÁS: la calle está cortada para vehículos' : 'OJO: puede estar cerrado';
    nota = e.estado === 'no' ? 'Según el mapa hay ' + String(p.titulo || 'una barrera').toLowerCase() + ' en la calle: no pasan autos ni camiones.'
                             : 'Hay un portón o barrera: puede estar cerrado o ser solo para algunos vehículos.';
  } else if (p.capa === 'obra') {
    titulo = 'OJO: calle en obra según el mapa';
    nota = 'Puede estar cortada, o la obra ya puede haber terminado. Verificá en el lugar.';
  } else if (p.capa === 'corte') {
    titulo = e.estado === 'no' ? 'NO PASÁS: calle cortada AHORA' : 'OJO: ' + String(p.titulo).toLowerCase() + ' ahora';
    nota = e.estado === 'no' ? 'Según TomTom (en vivo) la calle está cortada. La ruta la esquiva.'
                             : 'Según TomTom (en vivo). Puede haber demoras o un carril menos: verificá en el lugar.';
  } else if (e.calzada) {
    titulo = e.estado === 'no' ? 'NO PASÁS: calle demasiado angosta' : 'CALLE ANGOSTA: verificá';
    nota = 'La calle mide ' + metros(e.limite) + ' de ancho y tu camión ' + metros(e.valor) +
           (e.estado === 'no' ? '. No queda lugar para pasar.' : '. Pasa justo: cuidado con los espejos y los autos estacionados.');
  } else if (e.estado === 'aviso') {
    titulo = 'OJO: no tiene salida';
    nota = 'No entres si no tenés lugar para dar la vuelta.';
  } else if (!camion) {
    e.estado = 'sin_dato';
    titulo = 'Cargá las medidas de tu camión para saber si pasás';
  } else if (e.estado === 'sin_dato') {
    titulo = 'NO SE SABE si pasás';
    nota = 'Falta el dato en el mapa. Verificá la señalización en el lugar.';
  } else {
    var dice = { altura: 'mide de alto', peso: 'pesa', largo: 'mide de largo', ancho: 'mide de ancho' }[e.medida];
    var fmt = e.medida === 'peso' ? toneladas : metros;
    if (e.estado === 'no') {
      titulo = 'NO PASÁS';
      nota = 'Tu camión ' + dice + ' ' + fmt(e.valor) + ' y el límite es ' + fmt(e.limite) + '.';
    } else if (e.justo) {
      titulo = 'PASÁS JUSTO';
      nota = 'Tu camión ' + dice + ' ' + fmt(e.valor) + ', igual que el límite. ' +
             'Andá despacio y fijate la señalización.';
    } else {
      var sobra = e.limite - e.valor;
      titulo = 'PASÁS';
      nota = 'Tu camión ' + dice + ' ' + fmt(e.valor) + '. Te sobran ' + fmt(sobra) + '.';
      if (e.medida === 'altura' && sobra < 0.1) nota += ' Muy justo: andá despacio y mirá la señalización.';
    }
  }
  return '<div class="veredicto ' + e.estado + '">' + esc(titulo) +
         (nota ? '<small>' + esc(nota) + '</small>' : '') + '</div>';
}

function textoValor(p) {
  switch (p.capa) {
    case 'altura':
      return p.limite != null ? 'Altura máxima ' + metros(p.limite) : sinDato(p.limite_texto, 'altura');
    case 'largo':
      return p.limite != null ? 'Largo máximo ' + metros(p.limite) : sinDato(p.limite_texto, 'largo');
    case 'peso':
      return p.limite != null ? 'Peso máximo ' + toneladas(p.limite) : sinDato(p.limite_texto, 'peso');
    case 'prohibido':
      if (p.peso_desde) return 'Prohibido camiones de más de ' + toneladas(p.peso_desde);
      if (p.largo_desde) return 'Imposible para camiones de más de ' + metros(p.largo_desde);
      return 'Prohibido el paso de camiones';
    case 'verificar':
    case 'verificar_autopista':
      return 'Sin altura cargada';
    case 'sin_salida':
      return 'Calle sin salida';
    case 'ancho':
      if (p.limite == null) return sinDato(p.limite_texto, 'ancho');
      return (p.calzada ? 'Calle angosta: mide ' : 'Ancho máximo ') + metros(p.limite);
    case 'barrera':
      return p.bloquea ? 'Cortan la calle' : 'Puede estar cerrado';
    case 'obra':
      return 'Puede estar cortada';
    case 'corte':
      return p.hasta ? 'Hasta el ' + fechaHora(p.hasta) : 'En este momento';
  }
  return '';
}

// Cuando el mapa tiene un texto en vez de un número
function sinDato(texto, que) {
  if (!texto) return 'Sin dato de ' + que;
  var t = String(texto).toLowerCase();
  if (t.indexOf('below_default') !== -1) return 'Más bajo de lo normal, sin número';
  if (t.indexOf('default') !== -1) return 'Sin ' + que + ' señalizada';
  if (t === 'none') return 'Sin límite señalizado';
  return 'Dato no claro ("' + texto + '")';
}

// ===== 7b. Lugares útiles (gomerías, talleres, estaciones de servicio...) =====
// Los datos en capas de Leaflet sin dibujar; en el mapa, una capa de íconos de MapLibre (se ven solo de cerca)
function crearCapaLugares(features) {
  return L.geoJSON({ type: 'FeatureCollection', features: features }, {
    pointToLayer: function (f, latlng) { return L.circleMarker(latlng); }
  });
}

var lugarPorId = {};
var PRIORIDAD_LUGAR = { gomeria: 1, taller: 2, parador: 2, estacionamiento: 3, balanza: 4, combustible: 5, ducha: 6 };
// Pone en el mapa los tipos prendidos (de lejos no se ven: lo maneja MapLibre con el zoom mínimo de la capa)
function mostrarLugares() {
  var feats = [];
  lugarPorId = {};
  LUGARES.forEach(function (t) {
    if (!lugaresPrendidos[t.id] || !gruposLugares[t.id]) return;
    gruposLugares[t.id].eachLayer(function (l) {
      var id = L.stamp(l);
      lugarPorId[id] = l;
      var p = l.feature.properties;
      // de lejos, cuando no entran todos, ganan los de menor número
      var pr = PRIORIDAD_LUGAR[t.id] != null ? PRIORIDAD_LUGAR[t.id] : 5;
      if (p.camiones) pr -= 2;
      feats.push({ type: 'Feature', geometry: l.feature.geometry, properties: { k: 'l', id: id, ic: 'ic-l-' + t.id, pr: pr } });
    });
  });
  ponerDatos('lugares', feats);
}
function abrirCartelLugar(l) {
  var f = l.feature, p = f.properties, tipo = LUGAR_POR_ID[p.tipo], ll = l.getLatLng();
  abrirCartel(ll, armarCartelLugar(f, l) + botonReportar(ll, tipo.uno + (p.nombre ? ' ' + p.nombre : '') + ' (' + p.osm + ')'));
  completarDetalles(p.osm, p.tipo);
}

// --- Más detalles de un lugar (pedido del chofer, 20/11/2026: "tocar donde dice gomería o YPF y que te dé detalles") ---
// Lo que no viene en nuestros archivos (combustibles, servicios, formas de pago, página web...) se pide a OpenStreetMap
// al abrir el cartel, de a un lugar por vez (y queda guardado mientras la página esté abierta).
var detallesOSM = {};
function bajarDetallesOSM(osm) {
  if (!/^(node|way|relation)\/\d+$/.test(osm || '')) return Promise.resolve(null);
  if (!detallesOSM[osm]) {
    detallesOSM[osm] = conTiempoLimite('https://api.openstreetmap.org/api/0.6/' + osm + '.json', {}, 8)
      .then(function (r) { if (!r.ok) throw new Error('OSM ' + r.status); return r.json(); })
      .then(function (d) { var e = d.elements && d.elements[0]; return e ? { tags: e.tags || {}, fecha: e.timestamp } : null; })
      .catch(function (e) { console.warn('Sin detalles de', osm, e); delete detallesOSM[osm]; return null; });
  }
  return detallesOSM[osm];
}
var COMBUSTIBLES = [
  [['fuel:diesel', 'fuel:biodiesel'], 'Gasoil'], [['fuel:HGV_diesel'], 'Gasoil para camiones'],
  [['fuel:GTL_diesel', 'fuel:diesel:premium', 'fuel:diesel:class2'], 'Gasoil premium'],
  [['fuel:octane_91', 'fuel:octane_92', 'fuel:octane_93', 'fuel:octane_95'], 'Nafta súper'],
  [['fuel:octane_97', 'fuel:octane_98', 'fuel:octane_100'], 'Nafta premium'],
  [['fuel:cng'], 'GNC'], [['fuel:lpg'], 'GLP (gas)'], [['fuel:adblue', 'adblue'], 'AdBlue / urea']
];
var PAGOS = { cash: 'efectivo', debit_cards: 'débito', credit_cards: 'crédito', mercadopago: 'Mercado Pago',
              fuel_cards: 'tarjetas de flota', contactless: 'sin contacto', cheque: 'cheque', visa: 'Visa',
              mastercard: 'Mastercard', maestro: 'Maestro', american_express: 'American Express', cards: 'tarjeta' };
function esSi(v) { return v === 'yes' || v === 'designated' || v === 'only'; }
function detallesDeTags(t, tipo, nombre) {
  var lineas = [];
  var marca = t.brand || '';
  if (marca && (!nombre || nombre.toLowerCase().indexOf(marca.toLowerCase()) === -1)) lineas.push(['Marca', marca]);
  if (t.operator && t.operator !== marca && t.operator !== nombre) lineas.push(['Lo atiende', t.operator]);
  var comb = [];
  COMBUSTIBLES.forEach(function (c) { if (c[0].some(function (k) { return esSi(t[k]); }) && comb.indexOf(c[1]) === -1) comb.push(c[1]); });
  if (comb.length) lineas.push(['Combustibles', comb.join(', ')]);
  var serv = [];
  function si(cond, texto) { if (cond && serv.indexOf(texto) === -1) serv.push(texto); }
  si(/^(convenience|kiosk|supermarket)$/.test(t.shop || '') || esSi(t.convenience), 'tienda / minimercado');
  si(esSi(t.food) || esSi(t.restaurant) || t.cuisine || /^(restaurant|fast_food|cafe)$/.test(t.amenity || ''), 'comida');
  si(esSi(t.cafe), 'café');
  si(esSi(t.toilets) || t.amenity === 'toilets' || t['toilets:access'] === 'customers', 'baños');
  si(esSi(t.shower) && tipo !== 'ducha', 'duchas');
  si(esSi(t.compressed_air), 'aire para las cubiertas');
  si(esSi(t.car_wash) || esSi(t['hgv:wash']), 'lavadero');
  si(t.internet_access === 'wlan' || esSi(t.internet_access), 'wifi');
  si(esSi(t.atm), 'cajero automático');
  si(esSi(t['service:vehicle:tyres']) || esSi(t['service:tyres']) || (t.shop === 'tyres' && tipo !== 'gomeria'), 'cubiertas');
  si(esSi(t['service:vehicle:truck']) && tipo !== 'taller', 'arreglo de camiones');
  si(esSi(t['service:vehicle:repair']) || esSi(t['service:vehicle:car_repair']), 'mecánica');
  si(esSi(t['service:vehicle:oil_change']) || esSi(t['service:vehicle:oil']), 'cambio de aceite');
  si(esSi(t['parking:hgv']) || esSi(t['hgv:parking']), 'estacionamiento para camiones');
  if (serv.length) lineas.push(['Tiene', serv.join(', ')]);
  if (t['capacity:hgv']) lineas.push(['Lugar para', t['capacity:hgv'] + ' camiones']);
  if (esSi(t.hgv)) lineas.push(['Camiones', 'según el mapa, entra un camión']);
  else if (t.hgv === 'no') lineas.push(['Camiones', 'según el mapa, NO entra un camión']);
  var pago = [];
  Object.keys(t).forEach(function (k) {
    var m = /^payment:(.+)$/.exec(k);
    if (m && esSi(t[k])) { var n = PAGOS[m[1]] || m[1].replace(/_/g, ' '); if (pago.indexOf(n) === -1) pago.push(n); }
  });
  if (pago.length) lineas.push(['Se paga con', pago.join(', ')]);
  if (t.description) lineas.push(['Dice', t.description]);
  return lineas;
}
function completarDetalles(osm, tipo) {
  bajarDetallesOSM(osm).then(function (d) {
    var caja = document.querySelector('.cartel-mas[data-osm="' + osm + '"]');
    if (!caja) return;   // el cartel ya se cerró
    if (!d) { caja.innerHTML = '<div class="cartel-fuente">Sin señal: no pude buscar más datos de este lugar.</div>'; return; }
    var t = d.tags, html = '';
    detallesDeTags(t, tipo, t.name || '').forEach(function (x) {
      html += '<div class="cartel-dato"><b>' + esc(x[0]) + ':</b> ' + esc(x[1]) + '</div>';
    });
    var web = t.website || t['contact:website'] || t.url;
    var wa = t['contact:whatsapp'] || t.whatsapp;
    if (web && /^https?:\/\//.test(web)) html += '<div class="cartel-dato"><a href="' + esc(web) + '" target="_blank" rel="noopener">Página web</a></div>';
    if (wa) html += '<div class="cartel-dato"><a href="https://wa.me/' + esc(String(wa).replace(/[^\d]/g, '')) +
                    '" target="_blank" rel="noopener">WhatsApp: ' + esc(wa) + '</a></div>';
    if (!html) html = '<div class="cartel-fuente">No hay más datos cargados de este lugar. Si lo conocés, contalo con "Reportar".</div>';
    if (d.fecha) {
      var f = new Date(d.fecha);
      if (!isNaN(f)) html += '<div class="cartel-fuente">Dato revisado en el mapa: ' +
        f.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) + '</div>';
    }
    caja.innerHTML = html;
  });
}

// Lo que está alrededor: distancia a vos, kilómetro del viaje y otros lugares a menos de 300 m
var cartelCerca = [];
function armarCercania(l) {
  var ll = l.getLatLng(), html = '';
  function distancia(d) { return d < 1000 ? Math.max(10, Math.round(d / 10) * 10) + ' m' : numero(d / 1000, d < 10000 ? 1 : 0) + ' km'; }
  if (ubicacion.ultima) html += '<div class="cartel-dato">📍 A ' + distancia(ubicacion.ultima.distanceTo(ll)) + ' de vos (en línea recta)</div>';
  if (ruta.linea && ruta.linea.lugares) {
    var x = ruta.linea.lugares.filter(function (y) { return y.l === l; })[0];
    if (x) html += '<div class="cartel-dato">🛣️ En tu viaje: km ' + Math.round(x.km) + '</div>';
  }
  var cerca = [];
  LUGARES.forEach(function (t) {
    if (!gruposLugares[t.id]) return;
    gruposLugares[t.id].eachLayer(function (o) {
      if (o === l) return;
      var d = o.getLatLng().distanceTo(ll);
      if (d <= 300) cerca.push({ o: o, d: d, t: t });
    });
  });
  cerca.sort(function (a, b) { return a.d - b.d; });
  cartelCerca = cerca.slice(0, 5).map(function (c) { return c.o; });
  if (cerca.length) {
    html += '<div class="cartel-dato"><b>Al lado (a menos de 300 m):</b></div><div class="cartel-cerca">';
    cerca.slice(0, 5).forEach(function (c, i) {
      html += '<button type="button" data-cerca="' + i + '">' + c.t.icono + ' ' + esc(c.o.feature.properties.nombre || c.t.uno) +
              ' <small>' + distancia(c.d) + '</small></button>';
    });
    html += '</div>';
  }
  return html;
}
document.addEventListener('click', function (ev) {
  var b = ev.target.closest && ev.target.closest('[data-cerca]');
  if (!b) return;
  var o = cartelCerca[+b.getAttribute('data-cerca')];
  if (o) abrirCartelLugar(o);
});

function armarCartelLugar(f, l) {
  var p = f.properties;
  var tipo = LUGAR_POR_ID[p.tipo];
  var html = '<div class="cartel-tipo">' + tipo.icono + ' ' + esc(tipo.uno) + '</div>';
  html += '<div class="cartel-valor">' + esc(p.nombre || 'Sin nombre en el mapa') + '</div>';
  if (p.marca) html += '<div class="cartel-calle">' + esc(p.marca) + '</div>';
  if (p.direccion) html += '<div class="cartel-calle">' + esc(p.direccion) + '</div>';

  if (p.camiones === true) {
    html += '<div class="cartel-linea apto">✔ Figura como apto para camiones</div>';
  } else if (p.camiones === false) {
    html += '<div class="cartel-linea no-apto">✘ Figura como NO apto para camiones</div>';
  } else {
    html += '<div class="cartel-linea">No figura si entra un camión: preguntá antes de ir.</div>';
  }
  if (p.extras && p.extras.length) html += '<div class="cartel-linea">Tiene: ' + esc(p.extras.join(', ')) + '</div>';
  if (p.horario) html += '<div class="cartel-linea">Horario: ' + esc(horario(p.horario)) + '</div>';
  if (p.telefono) {
    var tel = String(p.telefono).split(/[;,]/)[0].trim();
    html += '<div class="cartel-linea">Teléfono: <a href="tel:' + esc(tel.replace(/[^\d+]/g, '')) + '">' + esc(tel) + '</a></div>';
  }

  html += '<div class="cartel-mas" data-osm="' + esc(p.osm) + '"><div class="cartel-fuente">Buscando más datos...</div></div>';
  if (l) html += armarCercania(l);

  var c = f.geometry.coordinates;   // [longitud, latitud]
  html += '<a class="cartel-boton" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&amp;destination=' +
          c[1] + ',' + c[0] + '">Cómo llegar (Google Maps)</a>';
  // fotos, opiniones y horarios que la gente carga en Google (abre Google Maps buscando ese nombre en ese lugar)
  html += '<a class="cartel-boton fotos" target="_blank" rel="noopener" href="https://www.google.com/maps/search/' +
          encodeURIComponent(p.nombre || tipo.uno) + '/@' + c[1] + ',' + c[0] + ',17z">Ver fotos y opiniones (Google)</a>';
  html += '<div class="cartel-fuente">Google Maps no conoce las restricciones para camiones: mirá este mapa antes de salir.</div>';
  html += '<div class="cartel-fuente">Fuente: OpenStreetMap · <a href="https://www.openstreetmap.org/' + encodeURI(p.osm) +
          '" target="_blank" rel="noopener">ver en OpenStreetMap</a></div>';
  return html;
}

// "Mo-Fr 08:00-18:00; Sa 08:00-12:00" -> "Lun a Vie 08:00-18:00 · Sáb 08:00-12:00"
function horario(texto) {
  if (/^\s*24\/7\s*$/.test(texto)) return 'Abierto las 24 horas';
  var dias = { Mo: 'Lun', Tu: 'Mar', We: 'Mié', Th: 'Jue', Fr: 'Vie', Sa: 'Sáb', Su: 'Dom', PH: 'Feriados' };
  return String(texto)
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, function (d) { return dias[d]; })
    .replace(/([A-Za-zé]{3})-([A-Za-zé]{3})/g, '$1 a $2')
    .replace(/24\/7/g, 'las 24 horas')
    .replace(/\boff\b/g, 'cerrado')
    .replace(/\s*;\s*/g, ' · ');
}

function armarPanelLugares() {
  var lista = document.getElementById('lista-lugares');
  var titulo = document.getElementById('titulo-lugares');
  if (!lista || !titulo) return;   // index.html viejo guardado en el celular
  var total = LUGARES.reduce(function (s, l) { return s + (cantidadesLugares[l.id] || 0); }, 0);
  lista.innerHTML = '';
  titulo.hidden = lista.hidden = total === 0;
  if (!total) return;
  LUGARES.forEach(function (l) {
    var n = cantidadesLugares[l.id] || 0;
    var li = document.createElement('li');
    li.innerHTML =
      '<label' + (n ? '' : ' class="capa-vacia"') + '>' +
        '<input type="checkbox"' + (lugaresPrendidos[l.id] ? ' checked' : '') + (n ? '' : ' disabled') + '>' +
        '<span class="muestra-lugar">' + l.icono + '</span>' +
        '<span class="capa-texto">' + esc(l.nombre) +
          '<br><span class="capa-cantidad">' + (n ? n.toLocaleString('es-AR') + ' en el mapa' : 'Ninguno en esta zona') + '</span></span>' +
      '</label>';
    li.querySelector('input').addEventListener('change', function (ev) {
      if (ev.target.checked) lugaresPrendidos[l.id] = true; else delete lugaresPrendidos[l.id];
      guardar(CLAVE_LUGARES, lugaresPrendidos);
      mostrarLugares();
      cargarLugaresVista();
      if (ev.target.checked && mapa.getZoom() < ZOOM_LUGARES_LEJOS) {
        mostrarMensaje('Acercá el mapa para ver los lugares.');
        setTimeout(ocultarMensaje, 3000);
      }
    });
    lista.appendChild(li);
  });
}

// ===== 7c. Reportes de choferes =====
// Los choferes reportan con un formulario de Google (con la ubicación ya cargada).
// El administrador escribe "sí" en la columna Aprobado de la planilla, y una hoja "Aprobados"
// publicada como CSV se muestra acá. Configuración: datos/reportes_config.json
//   { "formulario": "https://docs.google.com/forms/d/e/.../viewform",
//     "campos": { "ubicacion": "entry.111", "lugar": "entry.222" },
//     "aprobados_csv": "https://docs.google.com/spreadsheets/d/e/.../pub?...&output=csv" }
// Si el archivo no está o le falta algo, no se muestra nada de reportes.
var reportesConfig = null;
var grupoReportes = null;

function cargarReportes() {
  fetch('datos/reportes_config.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('sin reportes_config.json'); return r.json(); })
    .then(function (c) {
      if (c && /^https:\/\/docs\.google\.com\/forms\//.test(c.formulario || '') && c.campos &&
          c.campos.ubicacion && c.campos.lugar) reportesConfig = c;
      if (!c || !/^https:\/\/docs\.google\.com\//.test(c.aprobados_csv || '')) return null;
      return fetch(c.aprobados_csv, { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('aprobados_csv ' + r.status);
        return r.text();
      });
    })
    .then(function (csv) { if (csv) mostrarReportes(leerCSV(csv)); })
    .catch(function (e) { console.warn('Reportes:', e.message); })
    .then(armarPanelReportes);
}

// Texto que identifica una restricción en el reporte (para saber de qué habla el chofer)
function describirRestriccion(p) {
  return textoValor(p) + (p.calle ? ' — ' + p.calle : '') + (p.osm ? ' (' + p.osm + ')' : '');
}

function linkFormulario(latlng, que) {
  if (!reportesConfig) return null;
  var c = reportesConfig.campos;
  return reportesConfig.formulario + '?usp=pp_url' +
    '&' + encodeURIComponent(c.ubicacion) + '=' + encodeURIComponent(latlng.lat.toFixed(5) + ', ' + latlng.lng.toFixed(5)) +
    '&' + encodeURIComponent(c.lugar) + '=' + encodeURIComponent(que || 'Nada marcado en el mapa');
}

function botonReportar(ll, que) {
  var url = ll && linkFormulario(L.latLng(ll), que);
  if (!url) return '';
  return '<a class="cartel-boton secundario" target="_blank" rel="noopener" href="' + esc(url) + '">' +
         '📣 Reportar un problema acá</a>';
}

// Dedo apretado (o clic derecho en la PC) en cualquier lugar: armar una ruta o reportar algo ahí
mapa.on('contextmenu', function (e) {
  var caja = L.DomUtil.create('div');
  caja.innerHTML = '<div class="cartel-valor">Este lugar</div>';
  if (panelRuta) {
    var fila = L.DomUtil.create('div', 'cartel-fila', caja);
    [['desde', 'Salir desde acá'], ['hasta', 'Ir hasta acá']].forEach(function (op) {
      var b = L.DomUtil.create('button', 'cartel-boton-chico', fila);
      b.type = 'button';
      b.textContent = '🧭 ' + op[1];
      L.DomEvent.on(b, 'click', function () {
        mapa.closePopup();
        ponerPunto(op[0], e.latlng);   // antes de abrir el panel: así no busca la ubicación si elegiste la salida
        abrirPanelRuta(true);
        elegirPunto(op[0], e.latlng);
      });
    });
  }
  var url = linkFormulario(e.latlng, null);
  if (url) {
    var aviso = L.DomUtil.create('div', 'cartel-linea', caja);
    aviso.textContent = '¿Viste algo acá que no está en el mapa? Un puente bajo, una calle prohibida o cortada, una gomería...';
    var a = L.DomUtil.create('a', 'cartel-boton secundario', caja);
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = '📣 Reportar algo en este lugar';
  }
  if (!panelRuta && !url) return;
  abrirCartel(e.latlng, caja);
});

// CSV simple (respeta comillas, comas y saltos de línea dentro de un comentario)
function leerCSV(texto) {
  var filas = [], fila = [], campo = '', entreComillas = false;
  for (var i = 0; i < texto.length; i++) {
    var ch = texto[i];
    if (entreComillas) {
      if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') entreComillas = false;
      else campo += ch;
    } else if (ch === '"') entreComillas = true;
    else if (ch === ',') { fila.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += ch;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

// Columnas de la hoja "Aprobados": fecha, qué pasa, ubicación, qué decía el mapa, medida, comentario
function mostrarReportes(filas) {
  var features = [];
  filas.forEach(function (f) {
    var m = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(f[2] || '');
    if (!m) return;   // la fila de títulos o una ubicación que no se entiende
    var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: { fecha: fechaPlanilla(f[0]), tipo: f[1] || 'Reporte', lugar: f[3] || '',
                    medida: f[4] || '', comentario: f[5] || '' } });
  });
  grupoReportes = L.geoJSON({ type: 'FeatureCollection', features: features }, {
    pointToLayer: function (f, latlng) { return L.circleMarker(latlng); }
  });
  var feats = [];
  reportePorId = {};
  grupoReportes.eachLayer(function (l) {
    var id = L.stamp(l);
    reportePorId[id] = l;
    feats.push({ type: 'Feature', geometry: l.feature.geometry, properties: { k: 'r', id: id } });
  });
  ponerDatos('reportes', feats);
}
var reportePorId = {};

// La planilla puede mandar la fecha como "18/11/2026 20:46:02" o como número de días
// desde el 30/12/1899 (así guarda Google las fechas): "46344.86531" -> "18/11/2026"
function fechaPlanilla(v) {
  v = String(v || '').trim();
  if (/^\d+([.,]\d+)?$/.test(v)) {
    var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(parseFloat(v.replace(',', '.'))) * 86400000);
    if (isNaN(d)) return '';
    return ('0' + d.getUTCDate()).slice(-2) + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '/' + d.getUTCFullYear();
  }
  return v.split(' ')[0];
}

function armarCartelReporte(p) {
  var html = '<div class="cartel-tipo">📣 Reporte de un chofer</div>';
  html += '<div class="cartel-valor">' + esc(p.tipo) + '</div>';
  if (p.medida) html += '<div class="cartel-linea"><b>Medida informada:</b> ' + esc(p.medida) + '</div>';
  if (p.comentario) html += '<div class="cartel-linea">"' + esc(p.comentario) + '"</div>';
  if (p.lugar && p.lugar !== 'Nada marcado en el mapa') {
    html += '<div class="cartel-linea">En el mapa figuraba: ' + esc(p.lugar.replace(/\s*\((node|way)\/\d+\)$/, '')) + '</div>';
  }
  html += '<div class="veredicto sin_dato">Verificá en el lugar<small>Lo informó un chofer' +
          (p.fecha ? ' el ' + esc(p.fecha) : '') + ' y fue revisado, pero puede haber cambiado.</small></div>';
  return html;
}

function armarPanelReportes() {
  var lista = document.getElementById('lista-reportes');
  var titulo = document.getElementById('titulo-reportes');
  if (!lista || !titulo) return;   // index.html viejo guardado en el celular
  var n = 0;
  if (grupoReportes) grupoReportes.eachLayer(function () { n++; });
  var hay = reportesConfig || grupoReportes;
  titulo.hidden = lista.hidden = !hay;
  if (!hay) return;
  lista.innerHTML = '';
  var li = document.createElement('li');
  li.innerHTML =
    '<label' + (n ? '' : ' class="capa-vacia"') + '>' +
      '<input type="checkbox"' + (apagadas.reportes ? '' : ' checked') + (n ? '' : ' disabled') + '>' +
      '<span class="muestra-lugar">📣</span>' +
      '<span class="capa-texto">Reportes aprobados<br><span class="capa-cantidad">' +
        (n ? n.toLocaleString('es-AR') + ' en el mapa' : 'Todavía no hay') + '</span></span>' +
    '</label>';
  li.querySelector('input').addEventListener('change', function (ev) {
    if (ev.target.checked) delete apagadas.reportes; else apagadas.reportes = true;
    guardar(CLAVE_CAPAS, apagadas);
    ponerVisibilidad();
  });
  lista.appendChild(li);
  if (reportesConfig) {
    var ayuda = document.createElement('li');
    ayuda.className = 'reportes-ayuda';
    ayuda.textContent = 'Para reportar algo: tocá una marca del mapa y usá "Reportar un problema acá", ' +
                        'o dejá el dedo apretado sobre el lugar.';
    lista.appendChild(ayuda);
  }
}

// ===== 7d. Controles policiales fijos (toda Argentina) =====
// Los baja scripts/descargar_controles.py en datos/controles.geojson. Son pocos y casi todos están en las
// rutas, por eso no dependen de las zonas. Solo se ponen en el mapa los que caen en la vista (más fluido).
var CONTROLES = {
  policial:      { nombre: 'Control policial',        icono: '👮' },
  vial:          { nombre: 'Policía Caminera / Vial', icono: '🚓' },
  gendarmeria:   { nombre: 'Gendarmería',             icono: '🛂' },
  fitosanitario: { nombre: 'Control fitosanitario',   icono: '🌾' },
  // radares y cámaras (datos/radares.geojson, scripts/descargar_radares.py; pedido del chofer el 20/11/2026)
  radar:         { nombre: 'Radar de velocidad',      icono: '📷', radar: true },
  camara:        { nombre: 'Cámara de semáforo',      icono: '🚦', radar: true }
};
function esRadar(p) { return !!(CONTROLES[p.tipo] && CONTROLES[p.tipo].radar); }
// Los camiones tienen su propia máxima (80 km/h, lo marcó el chofer el 20/11/2026): aunque el cartel del radar diga
// 100 o 110, para el camión es 80. Solo para camiones de más de 3,5 t (o si no cargó el peso).
var MAXIMA_CAMION = 80;
function maximaCamion(m) {
  if (!m) return null;
  return (!camion || !camion.peso || camion.peso > 3.5) ? Math.min(m, MAXIMA_CAMION) : m;
}
var ZOOM_CONTROLES = 9;
var controles = { lista: [], actualizado: null, policiales: [], radares: [], radaresActualizado: null };

function iconoControl(p) {
  if (p.tipo === 'radar' && p.maxima) return 'ic-r-' + maximaCamion(p.maxima);
  return 'ic-c-' + (CONTROLES[p.tipo] ? p.tipo : 'policial');
}
function ponerControles() {
  controles.lista = controles.policiales.concat(controles.radares);
  // todos juntos en una fuente de íconos (r = 1: radar o cámara, van en sus propias capas)
  ponerDatos('controles', controles.lista.map(function (it, i) {
    var p = it.f.properties;
    return { type: 'Feature', geometry: it.f.geometry, properties: { k: 'c', i: i, ic: iconoControl(p), r: esRadar(p) ? 1 : 0 } };
  }));
  if (zonasIndice.length) armarPanel();
}
function bajarControles(archivo, donde, fechaEn) {
  fetch(archivo, { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (d) {
      controles[fechaEn] = d.actualizado;
      controles[donde] = (d.features || []).map(function (f) {
        var c = f.geometry.coordinates;
        return { f: f, latlng: L.latLng(c[1], c[0]) };
      });
      ponerControles();
    })
    .catch(function (e) { console.warn('Sin ' + archivo + ':', e); });
}
bajarControles('datos/controles.geojson', 'policiales', 'actualizado');
bajarControles('datos/radares.geojson', 'radares', 'radaresActualizado');

function abrirCartelControl(it) {
  var p = it.f.properties, tipo = CONTROLES[p.tipo] || CONTROLES.policial;
  abrirCartel(it.latlng, armarCartelControl(p) + botonReportar(it.latlng, tipo.nombre + (p.nombre ? ' ' + p.nombre : '') + ' (' + p.osm + ')'));
}
function mostrarControles() { /* (antes ponía y sacaba marcas según la vista; ahora lo hace MapLibre) */ }

function armarCartelRadar(p) {
  var tipo = CONTROLES[p.tipo];
  var html = '<div class="cartel-tipo">' + tipo.icono + ' ' + esc(tipo.nombre) + '</div>';
  var mc = maximaCamion(p.maxima);
  if (p.tipo === 'radar') {
    html += '<div class="cartel-valor">' + (mc ? 'Máxima ' + mc + ' km/h para tu camión' : 'Radar (no figura la máxima)') + '</div>';
    if (mc && mc < p.maxima) html += '<div class="cartel-linea">El cartel dice ' + p.maxima + ' km/h (para autos); ' +
                                     'los camiones, ' + MAXIMA_CAMION + '.</div>';
  } else {
    html += '<div class="cartel-valor">Fotomulta por cruzar en rojo</div>';
    if (mc) html += '<div class="cartel-linea">También controla velocidad: máxima ' + mc + ' km/h para tu camión</div>';
  }
  if (p.nombre) html += '<div class="cartel-calle">' + esc(p.nombre) + '</div>';
  if (p.ruta) html += '<div class="cartel-calle">' + esc(p.ruta) + '</div>';
  if (p.operador) html += '<div class="cartel-calle">' + esc(p.operador) + '</div>';
  html += '<div class="cartel-fuente">Figura en OpenStreetMap: puede no estar funcionando, haberse movido, o haber ' +
          'radares que no figuran.</div>';
  html += '<div class="cartel-fuente">Fuente: OpenStreetMap' + (controles.radaresActualizado ? ' (' + fecha(controles.radaresActualizado) + ')' : '') +
          ' · <a href="https://www.openstreetmap.org/' + encodeURI(p.osm) + '" target="_blank" rel="noopener">ver en OpenStreetMap</a></div>';
  return html;
}
function armarCartelControl(p) {
  if (esRadar(p)) return armarCartelRadar(p);
  var tipo = CONTROLES[p.tipo] || CONTROLES.policial;
  var html = '<div class="cartel-tipo">' + tipo.icono + ' ' + esc(tipo.nombre) + '</div>';
  html += '<div class="cartel-valor">' + esc(p.nombre || tipo.nombre) + '</div>';
  if (p.operador) html += '<div class="cartel-calle">' + esc(p.operador) + '</div>';
  if (p.ruta) html += '<div class="cartel-calle">' + esc(p.ruta) + '</div>';
  if (p.tipo === 'fitosanitario') {
    html += '<div class="cartel-linea">Revisan la carga (frutas, verduras, animales). Tené a mano la documentación.</div>';
  } else {
    html += '<div class="cartel-linea">Tené a mano los papeles del camión y de la carga.</div>';
  }
  if (p.horario) html += '<div class="cartel-linea">Horario: ' + esc(horario(p.horario)) + '</div>';
  if (p.telefono) {
    var tel = String(p.telefono).split(/[;,]/)[0].trim();
    html += '<div class="cartel-linea">Teléfono: <a href="tel:' + esc(tel.replace(/[^\d+]/g, '')) + '">' + esc(tel) + '</a></div>';
  }
  html += '<div class="cartel-fuente">Figura en OpenStreetMap como control fijo: puede no estar funcionando siempre, ' +
          'y puede haber controles que no figuran.</div>';
  html += '<div class="cartel-fuente">Fuente: OpenStreetMap' + (controles.actualizado ? ' (' + fecha(controles.actualizado) + ')' : '') +
          ' · <a href="https://www.openstreetmap.org/' + encodeURI(p.osm) + '" target="_blank" rel="noopener">ver en OpenStreetMap</a></div>';
  return html;
}

// Controles cerca de una ruta (para la lista del resultado y para la voz al manejar)
function controlesEnRuta(puntosRuta) {
  if (!controles.lista.length || !puntosRuta.length) return [];
  var lat0 = puntosRuta[0][0] * Math.PI / 180, kx = Math.cos(lat0) * 111320, ky = 110540;
  // rectángulo de la ruta agrandado 80 m (una ruta recta tiene un rectángulo finito)
  var c0 = L.latLngBounds(puntosRuta);
  var caja = L.latLngBounds([c0.getSouth() - 80 / ky, c0.getWest() - 80 / kx], [c0.getNorth() + 80 / ky, c0.getEast() + 80 / kx]);
  var res = [];
  controles.lista.forEach(function (it) {
    if (!caja.contains(it.latlng)) return;
    var px = it.latlng.lng * kx, py = it.latlng.lat * ky, mejor = Infinity, idx = 0, tMejor = 0;
    for (var i = 1; i < puntosRuta.length; i++) {
      var ax = puntosRuta[i - 1][1] * kx, ay = puntosRuta[i - 1][0] * ky, bx = puntosRuta[i][1] * kx, by = puntosRuta[i][0] * ky;
      var vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
      var t = L2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
      var d = Math.hypot(ax + t * vx - px, ay + t * vy - py);
      if (d < mejor) { mejor = d; idx = i - 1; tMejor = t; }
    }
    if (mejor <= (esRadar(it.f.properties) ? 35 : 60)) res.push({ item: it, orden: idx, t: tMejor });
  });
  return res.sort(function (a, b) { return a.orden - b.orden; });
}

// ===== 7e. Cortes de calle y obras EN VIVO (TomTom) =====
// TomTom junta cortes, obras y accidentes de muchas fuentes (municipios, policía, autos con GPS).
// Se piden en "cuadraditos" (tiles vectoriales de nivel 13, unos 5 x 4 km): el plan gratis da 200.000 por mes
// (los pedidos de detalle, en cambio, son solo 2.500 por mes: se usan únicamente al tocar un corte, para saber
// entre qué calles es). Se piden los de lo que se ve (con el mapa cerca) y los de por donde pasa una ruta, y
// quedan solo en la memoria de la página por 10 minutos. Clave: datos/ruta_config.json ("tomtom_clave").
var CORTES = { z: 13, vigencia: 10 * 60 * 1000, zoom: 13, maxCeldasVista: 8, maxCeldasRuta: 40 };
var TIPO_CORTE = { 1: 'Accidente', 3: 'Peligro en la calle', 7: 'Carril cerrado', 8: 'Calle cortada',
                   9: 'Obra en la calle', 11: 'Calle inundada', 14: 'Vehículo detenido' };
var cortes = { celdas: {}, atribucion: false };

function claveTomTom() { return ruta && ruta.config && ruta.config.tomtom_clave; }   // ruta se define más abajo

function bajarCeldaCortes(clave) {
  var clv = claveTomTom();
  if (!clv) return Promise.resolve();
  var c = cortes.celdas[clave];
  if (c && c.pedido) return c.pedido;
  if (c && Date.now() - c.hora < CORTES.vigencia) return Promise.resolve();
  var celda = cortes.celdas[clave] = { hora: c ? c.hora : 0, capas: c ? c.capas : [], pedido: null };
  var xy = clave.split(',');
  var url = 'https://api.tomtom.com/traffic/map/4/tile/incidents/' + CORTES.z + '/' + xy[0] + '/' + xy[1] + '.pbf?key=' +
    encodeURIComponent(clv) + '&language=es-ES&tags=' +
    encodeURIComponent('[icon_category,description,end_date,id,probability_of_occurrence,road_category,traffic_road_coverage]');
  celda.pedido = conTiempoLimite(url, {}, 15)
    .then(function (r) { if (!r.ok) throw new Error('TomTom ' + r.status); return r.arrayBuffer(); })
    .then(function (b) { ponerCortes(clave, leerTileCortes(new Uint8Array(b), +xy[0], +xy[1])); celda.hora = Date.now(); })
    .catch(function (e) {
      console.warn('Sin cortes en vivo:', e.message);
      celda.hora = Date.now() - CORTES.vigencia + 2 * 60 * 1000;   // reintenta en dos minutos
    })
    .then(function () { celda.pedido = null; });
  return celda.pedido;
}

// --- Lector de "vector tiles" (formato Mapbox, protobuf). Es chico y así no hay que agregar una biblioteca. ---
function leerTileCortes(b, tx, ty) {
  function varint(s) {
    var r = 0, m = 1, c;
    do { c = b[s.i++]; r += (c & 0x7f) * m; m *= 128; } while (c >= 128);
    return r;
  }
  function campos(ini, fin, cada) {   // recorre los campos de un mensaje: cada(número, tipo, s)
    var s = { i: ini };
    while (s.i < fin) {
      var k = varint(s), n = Math.floor(k / 8), t = k & 7, antes;
      if (t === 0) { antes = s.i; cada(n, t, s); if (s.i === antes) varint(s); }
      else if (t === 2) { var largo = varint(s); var fin2 = s.i + largo; cada(n, t, s, fin2); s.i = fin2; }
      else if (t === 1) s.i += 8;
      else if (t === 5) s.i += 4;
      else break;
    }
  }
  function texto(ini, fin) { return new TextDecoder().decode(b.subarray(ini, fin)); }
  var n2 = Math.pow(2, CORTES.z), res = [];
  campos(0, b.length, function (n, t, s, fin) {
    if (n !== 3 || t !== 2) return;   // capa
    var nombre = '', claves = [], valores = [], feats = [], extent = 4096;
    campos(s.i, fin, function (m, tt, s2, fin2) {
      if (m === 1 && tt === 2) nombre = texto(s2.i, fin2);
      else if (m === 3 && tt === 2) claves.push(texto(s2.i, fin2));
      else if (m === 4 && tt === 2) {
        var v = null;
        campos(s2.i, fin2, function (q, t3, s3, fin3) {
          if (q === 1 && t3 === 2) v = texto(s3.i, fin3);
          else if (t3 === 0) { v = varint(s3); if (q === 6) v = (v % 2) ? -(v + 1) / 2 : v / 2; }   // int / sint
          // los números con coma (rumbo) se saltean: no hacen falta
        });
        valores.push(v);
      }
      else if (m === 5 && tt === 0) extent = varint(s2);
      else if (m === 2 && tt === 2) feats.push([s2.i, fin2]);
    });
    var esLinea = /flow/i.test(nombre);
    feats.forEach(function (rango) {
      var tags = [], geom = [], tipo = 0;
      campos(rango[0], rango[1], function (m, tt, s2, fin2) {
        var arr = (m === 2) ? tags : (m === 4) ? geom : null;
        if (tt === 0 && m === 3) { tipo = varint(s2); return; }
        if (!arr || tt !== 2) return;
        var s4 = { i: s2.i };
        while (s4.i < fin2) arr.push(varint(s4));
      });
      var p = {};
      for (var k = 0; k + 1 < tags.length; k += 2) p[claves[tags[k]]] = valores[tags[k + 1]];
      // geometría: comandos MoveTo / LineTo con coordenadas relativas (zigzag) dentro del cuadradito
      var lineas = [], actual = null, x = 0, y = 0, i = 0;
      while (i < geom.length) {
        var cmd = geom[i] & 7, cuenta = geom[i] >> 3; i++;
        if (cmd === 7) continue;
        for (var j = 0; j < cuenta; j++) {
          var dx = geom[i++], dy = geom[i++];
          x += (dx % 2) ? -(dx + 1) / 2 : dx / 2;
          y += (dy % 2) ? -(dy + 1) / 2 : dy / 2;
          var lng = (tx + x / extent) / n2 * 360 - 180;
          var lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + y / extent) / n2))) * 180 / Math.PI;
          if (cmd === 1) { actual = [[lng, lat]]; lineas.push(actual); } else actual.push([lng, lat]);
        }
      }
      if (!lineas.length) return;
      res.push({ linea: esLinea, puntoSolo: !esLinea && p.poi_type === 'standalone_poi', tags: p, lineas: lineas });
    });
  });
  // de los puntos, solo los "sueltos" (los de punta de una línea ya están en la línea)
  return res.filter(function (f) { return f.linea || f.puntoSolo; });
}

// Convierte un corte del cuadradito en una restricción más (capa 'corte') con el mismo formato que las de OSM
function featureCorte(f) {
  var q = f.tags, cats = [], eventos = [];
  Object.keys(q).forEach(function (k) {
    if (/^icon_category(_\d+)?$/.test(k)) cats.push(+q[k]);
    if (/^description(_\d+)?$/.test(k) && q[k]) eventos.push(q[k]);
  });
  var cat = cats.filter(function (c) { return TIPO_CORTE[c]; })[0];
  if (cat == null) return null;   // embotellamientos, niebla, grupos: no interesan acá
  var probable = !q.probability_of_occurrence || /certain|probable/.test(q.probability_of_occurrence);
  var cortada = probable && (cats.indexOf(8) !== -1 || eventos.some(function (t) { return /^cerrad|cortad/i.test(t); }));
  var geometria = f.linea
    ? (f.lineas.length === 1 ? { type: 'LineString', coordinates: f.lineas[0] } : { type: 'MultiLineString', coordinates: f.lineas })
    : { type: 'Point', coordinates: f.lineas[0][0] };
  return {
    type: 'Feature', geometry: geometria,
    properties: { capa: 'corte', titulo: cortada ? 'Calle cortada' : TIPO_CORTE[cat], cortada: cortada, calle: null,
                  eventos: eventos.join('. '), hasta: q.end_date || null, una_mano: q.traffic_road_coverage === 'one_side',
                  detalle: detalleCorte(eventos.join('. '), q.end_date, q.traffic_road_coverage === 'one_side'),
                  fuente: 'TomTom (en vivo)', id_tomtom: q.id || null }
  };
}
function detalleCorte(eventos, hasta, unaMano) {
  return (eventos ? eventos + '. ' : '') + (hasta ? 'Hasta: ' + fechaHora(hasta) + '. ' : '') +
    (unaMano ? 'Es en una sola mano. ' : '') + 'Dato en vivo de TomTom: puede haberse levantado o no figurar todavía.';
}

function ponerCortes(clave, lista) {
  var celda = cortes.celdas[clave];
  celda.capas.forEach(function (l) { grupos.corte.removeLayer(l); });
  celda.capas = [];
  lista.forEach(function (f) {
    var feat = featureCorte(f);
    if (!feat) return;
    grupos.corte.addData(feat);
    var capas = grupos.corte.getLayers();
    celda.capas.push(capas[capas.length - 1]);
  });
  cantidades.corte = grupos.corte.getLayers().length;
  if (!cortes.atribucion && cantidades.corte) {
    var pie = document.getElementById('pie-tomtom');   // el crédito va en el pie, junto al de OpenStreetMap
    if (pie) pie.hidden = false;
    cortes.atribucion = true;
  }
  // si llegan varios cuadraditos juntos, se redibuja una sola vez
  clearTimeout(cortes.timer);
  cortes.timer = setTimeout(function () { if (zonasIndice.length && !panel.hidden) armarPanel(); }, 250);
}

// Al tocar un corte: entre qué calles es (un pedido de detalle por corte tocado, y queda guardado)
var detallesCorte = {};
function detalleCorteAlAbrir(p, actualizar) {
  if (!p || !p.id_tomtom || p.calle || !claveTomTom()) return;
  var poner = function (d) {
    if (!d) return;
    p.calle = d.calle;
    if (d.hasta && !p.hasta) p.hasta = d.hasta;
    p.detalle = detalleCorte(p.eventos, p.hasta, p.una_mano);
    actualizar();
  };
  if (detallesCorte[p.id_tomtom]) { detallesCorte[p.id_tomtom].then(poner); return; }
  var url = 'https://api.tomtom.com/traffic/services/5/incidentDetails?key=' + encodeURIComponent(claveTomTom()) +
    '&ids=' + encodeURIComponent(p.id_tomtom) + '&language=es-ES&fields=' +
    encodeURIComponent('{incidents{properties{id,from,to,roadNumbers,endTime}}}');
  detallesCorte[p.id_tomtom] = conTiempoLimite(url, {}, 10)
    .then(function (r) { if (!r.ok) throw new Error('TomTom ' + r.status); return r.json(); })
    .then(function (d) {
      var q = d.incidents && d.incidents[0] && d.incidents[0].properties;
      if (!q) return null;
      var calle = (q.roadNumbers && q.roadNumbers.length ? q.roadNumbers.join(' / ') + ' — ' : '') +
                  (q.from && q.to && q.from !== q.to ? 'Entre ' + sinCalle(q.from) + ' y ' + sinCalle(q.to) : sinCalle(q.from || q.to));
      return { calle: calle || null, hasta: q.endTime || null };
    })
    .catch(function (err) { console.warn('Sin detalle del corte:', err.message); delete detallesCorte[p.id_tomtom]; return null; });
  detallesCorte[p.id_tomtom].then(poner);
}

function sinCalle(s) {
  return String(s || '').replace(/^(Calle|Avenida) /, '').replace(/ \/ (Calle|Avenida) /g, ' / ').replace(/ exit \[[^\]]*\]/g, '');
}

// Número de cuadradito (nivel 13) de un punto
function celdaDe(lat, lng) {
  var n = Math.pow(2, CORTES.z);
  var x = Math.floor((lng + 180) / 360 * n);
  var y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  return x + ',' + y;
}
function celdasEn(limites) {
  var a = celdaDe(limites.getNorth(), limites.getWest()).split(','), b = celdaDe(limites.getSouth(), limites.getEast()).split(',');
  var res = [];
  for (var x = +a[0]; x <= +b[0]; x++) for (var y = +a[1]; y <= +b[1]; y++) res.push(x + ',' + y);
  return res;
}

// Los de lo que se ve (solo de cerca: de lejos serían muchos cuadraditos)
function mostrarCortes() {
  if (!claveTomTom() || apagadas.corte || mapa.getZoom() < CORTES.zoom) return;
  var centro = mapa.getCenter();
  // los más cercanos al centro primero (si la pantalla es grande y son muchos, los de la orilla quedan)
  celdasEn(mapa.getBounds()).map(function (k) {
    var xy = k.split(','), n = Math.pow(2, CORTES.z);
    var lng = (+xy[0] + 0.5) / n * 360 - 180;
    var lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (+xy[1] + 0.5) / n))) * 180 / Math.PI;
    return { k: k, d: centro.distanceTo([lat, lng]) };
  }).sort(function (a, b) { return a.d - b.d; }).slice(0, CORTES.maxCeldasVista)
    .forEach(function (c) { bajarCeldaCortes(c.k); });
}
mapa.on('moveend', mostrarCortes);
// Con el mapa abierto (por ejemplo, navegando) se actualizan cada 10 minutos
setInterval(function () { if (!document.hidden) mostrarCortes(); }, 60 * 1000);

// Los de los cuadraditos por donde pasan uno o varios recorridos (para revisar la ruta). Nunca falla.
function cargarCortesEn(listas) {
  if (!claveTomTom()) return Promise.resolve();
  var vistas = {}, orden = [];
  function marcar(lat, lng) { var k = celdaDe(lat, lng); if (!vistas[k]) { vistas[k] = true; orden.push(k); } }
  listas.forEach(function (puntos) {
    for (var i = 0; i < puntos.length; i++) {
      marcar(puntos[i][0], puntos[i][1]);
      // en una ruta recta los puntos pueden estar a varios km: se agregan puntos intermedios cada ~1 km
      if (i + 1 < puntos.length) {
        var d = L.latLng(puntos[i]).distanceTo(puntos[i + 1]), pasos = Math.floor(d / 1000);
        for (var j = 1; j <= pasos; j++) {
          var t = j / (pasos + 1);
          marcar(puntos[i][0] + (puntos[i + 1][0] - puntos[i][0]) * t, puntos[i][1] + (puntos[i + 1][1] - puntos[i][1]) * t);
        }
      }
    }
  });
  // en un viaje muy largo: los de la salida y la llegada (ahí están las calles chicas)
  if (orden.length > CORTES.maxCeldasRuta) {
    var mitad = CORTES.maxCeldasRuta / 2;
    orden = orden.slice(0, mitad).concat(orden.slice(-mitad));
  }
  return Promise.all(orden.map(bajarCeldaCortes));
}

function fechaHora(iso) {
  var d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ===== 8. Panel para prender y apagar capas =====
// Opciones del panel "Qué mostrar": pocas y juntas (antes había una casilla por cada tipo de dato)
var OPCIONES_MAPA = [
  { id: 'restricciones', icono: '⛔', nombre: 'Donde no pasás', detalle: 'Puentes bajos, pesos, prohibidos, calles angostas',
    capas: ['altura', 'peso', 'largo', 'prohibido', 'ancho', 'barrera'] },
  { id: 'verificar', icono: '⚠️', nombre: 'Para verificar', detalle: 'Pasos bajos sin altura, calles en obra',
    capas: ['verificar', 'verificar_autopista', 'obra'] },
  { id: 'corte', icono: '🚧', nombre: 'Cortes en vivo', detalle: 'Calles cortadas ahora (TomTom)', capas: ['corte'],
    hay: function () { return !!claveTomTom(); } },
  { id: 'sin_salida', icono: '🔚', nombre: 'Calles sin salida', detalle: 'Se ven de cerca', capas: ['sin_salida'] },
  { id: 'lugares', icono: '⛽', nombre: 'Lugares útiles', detalle: 'Gomerías, combustible, paradores, duchas', lugares: true },
  { id: 'controles', icono: '👮', nombre: 'Controles y radares', detalle: 'Policía, Gendarmería, radares y cámaras', clave: 'controles',
    hay: function () { return controles.lista.length > 0; } },
  { id: 'red_pesada', icono: '🟩', nombre: 'Calles para camiones', detalle: 'Red de tránsito pesado', clave: 'red_pesada',
    hay: function () { return !!redPesada.grupo; } },
  { id: 'reportes', icono: '📣', nombre: 'Reportes de choferes', clave: 'reportes',
    hay: function () { return !!(reportesConfig || grupoReportes); } },
  { id: 'ver_gris', icono: '⚪', nombre: 'También donde sí pasás', detalle: 'En gris', alReves: true }
];
function opcionPrendida(o) {
  if (o.lugares) return LUGARES.some(function (l) { return lugaresPrendidos[l.id]; });
  if (o.alReves) return !!apagadas[o.id];   // ver_gris: se guarda "prendido" (arranca apagado)
  if (o.clave) return !apagadas[o.clave];
  return o.capas.some(function (id) { return !apagadas[id]; });
}
function cambiarOpcion(o, prender) {
  if (o.lugares) {
    LUGARES.forEach(function (l) { if (prender) lugaresPrendidos[l.id] = true; else delete lugaresPrendidos[l.id]; });
    guardar(CLAVE_LUGARES, lugaresPrendidos);
    mostrarLugares();
    cargarLugaresVista();
    if (prender && mapa.getZoom() < ZOOM_LUGARES_LEJOS) { mostrarMensaje('Acercá el mapa para ver los lugares.'); setTimeout(ocultarMensaje, 3000); }
    return;
  }
  if (o.alReves) {
    if (prender) apagadas[o.id] = true; else delete apagadas[o.id];
    guardar(CLAVE_CAPAS, apagadas);
    repintar();
    return;
  }
  if (o.clave) {
    if (prender) delete apagadas[o.clave]; else apagadas[o.clave] = true;
    guardar(CLAVE_CAPAS, apagadas);
    ponerVisibilidad();
    return;
  }
  o.capas.forEach(function (id) { if (prender) delete apagadas[id]; else apagadas[id] = true; });
  guardar(CLAVE_CAPAS, apagadas);
  if (o.id === 'sin_salida' && prender && mapa.getZoom() < ZOOM_SIN_SALIDA) {
    mostrarMensaje('Acercá el mapa para ver las calles sin salida.'); setTimeout(ocultarMensaje, 3000);
  }
  if (o.id === 'corte' && prender) mostrarCortes();
  repintar();
}

function armarPanel() {
  var lista = document.getElementById('lista-capas');
  lista.innerHTML = '';
  OPCIONES_MAPA.forEach(function (o) {
    if (o.hay && !o.hay()) return;
    var li = document.createElement('li');
    li.innerHTML =
      '<label><input type="checkbox"' + (opcionPrendida(o) ? ' checked' : '') + '>' +
        '<span class="muestra-capa" aria-hidden="true">' + o.icono + '</span>' +
        '<span class="capa-texto">' + esc(o.nombre) +
          (o.detalle ? '<br><span class="capa-cantidad">' + esc(o.detalle) + '</span>' : '') + '</span>' +
      '</label>';
    li.querySelector('input').addEventListener('change', function (ev) { cambiarOpcion(o, ev.target.checked); });
    lista.appendChild(li);
  });
  // abajo, chiquito: de dónde salen los datos y el aviso de la zona que estás mirando
  var nota = document.getElementById('nota-datos');
  var c = mapa.getCenter();
  var aca = zonasIndice.filter(function (z) { return z.aviso && z.limites && L.latLngBounds(z.limites).contains(c); })[0];
  nota.textContent = 'Datos: OpenStreetMap' + (claveTomTom() ? ', TomTom' : '') + ' y ordenanzas. Pueden estar incompletos. ' +
                    'Versión ' + VERSION_APP + '.';
  if (aca) {
    var av = document.createElement('span');
    av.className = 'nota-aviso';
    av.textContent = '⚠ ' + aca.aviso;
    nota.appendChild(av);
  }
  armarBotonesZonas();
}

// "Ir a una ciudad": lista desplegable para saltar a cada zona (solo si hay más de una)
function armarBotonesZonas() {
  var caja = document.getElementById('ir-zonas');
  if (!caja) return;   // index.html viejo guardado en el celular
  if (zonasIndice.length < 2) { caja.hidden = true; return; }
  // con muchas ciudades, una lista desplegable (en el celular abre la lista grande del teléfono)
  var ordenadas = zonasIndice.slice().sort(function (a, b) { return a.titulo.localeCompare(b.titulo, 'es'); });
  var claveLista = ordenadas.map(function (z) { return z.id; }).join(',');
  if (caja.dataset.lista === claveLista) return;   // ya está armada (armarPanel se llama seguido)
  caja.dataset.lista = claveLista;
  caja.innerHTML = '<label class="ir-zonas-titulo" for="selector-zona">Ir a una ciudad con datos:</label>';
  var sel = document.createElement('select');
  sel.id = 'selector-zona';
  sel.className = 'selector-zona';
  sel.innerHTML = '<option value="">Elegí una ciudad (' + ordenadas.length + ')</option>' +
    ordenadas.map(function (z) { return '<option value="' + esc(z.id) + '">' + esc(z.titulo) + '</option>'; }).join('');
  sel.addEventListener('change', function () {
    var z = zonasIndice.filter(function (x) { return x.id === sel.value; })[0];
    sel.value = '';
    if (!z) return;
    abrirPanel(false);
    var ir = z.ir_a;
    if (ir && ir.centro) mapa.setView(ir.centro, ir.zoom || 13);
    else mapa.fitBounds(z.limites);
  });
  caja.appendChild(sel);
  caja.hidden = false;
}

// Recordar dónde quedó mirando el mapa
mapa.on('moveend', function () {
  var c = mapa.getCenter();
  guardar(CLAVE_VISTA, { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5), zoom: mapa.getZoom() });
  revisarAvisoZona();
});

// Aviso especial de una zona (ej.: Mar del Plata casi no tiene restricciones cargadas).
// Se muestra una vez cada vez que se abre la página, al mirar esa zona.
var avisosMostrados = {};
function revisarAvisoZona() {
  // con el panel de ruta arriba (escribiendo) el aviso lo taparía: se muestra después
  if (panelRuta && !panelRuta.hidden && !panelRuta.classList.contains('con-resultado')) return;
  var c = mapa.getCenter();
  var m = document.getElementById('mensaje');
  zonasIndice.forEach(function (zi) {
    var z = { zona: zi };
    var lim = z.zona.limites;
    if (!z.zona.aviso || !lim) return;
    var adentro = !(c.lat < lim[0][0] || c.lat > lim[1][0] || c.lng < lim[0][1] || c.lng > lim[1][1]);
    // si me fui de la zona, el aviso de esa zona ya no corresponde
    if (!adentro && !m.hidden && m.textContent.indexOf(z.zona.aviso) !== -1) ocultarMensaje();
    if (!adentro || avisosMostrados[z.zona.id]) return;
    avisosMostrados[z.zona.id] = true;
    mostrarMensaje('⚠ ' + z.zona.aviso);
    setTimeout(function () {
      var m = document.getElementById('mensaje');
      if (m.textContent.indexOf(z.zona.aviso) !== -1) ocultarMensaje();
    }, 15000);
  });
}
document.getElementById('mensaje').addEventListener('click', ocultarMensaje);

var botonCapas = document.getElementById('btn-capas');
var panel = document.getElementById('panel-capas');
function abrirPanel(abrir) {
  if (abrir && typeof abrirPanelRuta === 'function') abrirPanelRuta(false);
  panel.hidden = !abrir;
  if (abrir) armarPanel();
  botonCapas.setAttribute('aria-expanded', abrir ? 'true' : 'false');
}
botonCapas.addEventListener('click', function () { abrirPanel(panel.hidden); });
document.getElementById('cerrar-capas').addEventListener('click', function () { abrirPanel(false); });
mapa.on('click', function () { abrirPanel(false); });

// ===== 9. Mi ubicación (punto azul) =====
// El primer toque busca la ubicación y centra el mapa; después el punto se va moviendo solo.
// Los toques siguientes vuelven a centrar el mapa en donde estás.
var ubicacion = { punto: null, ultima: null, buscando: false };
var botonUbicacion = crearBotonMapa('boton-ubicacion', 'Mostrar mi ubicación',
  '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="4" fill="currentColor"/>' +
  '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2"/></svg>',
  function () { tocarUbicacion(); });
var controlUbicacion = { boton: botonUbicacion };
// en la PC: botones para acercar y alejar (en el celular se usan los dedos)
if (!L.Browser.mobile) {
  crearBotonMapa('boton-zoom', 'Acercar', '+', function () { gl.zoomIn(); });
  crearBotonMapa('boton-zoom', 'Alejar', '−', function () { gl.zoomOut(); });
}
function ponerBrujula() {
  var g = mapa.getBearing();
  var girado = Math.abs(((g % 360) + 360) % 360) > 0.5 && Math.abs(((g % 360) + 360) % 360 - 360) > 0.5;
  controlBrujula.boton.classList.toggle('al-norte', !girado);
  controlBrujula.boton.firstChild.style.transform = 'rotate(' + g + 'deg)';
}
gl.on('rotate', ponerBrujula);
ponerBrujula();

// Círculo de la precisión del GPS (en metros)
function circuloGeo(ll, radio) {
  var pts = [], kx = 111320 * Math.cos(ll.lat * Math.PI / 180), ky = 110540;
  for (var i = 0; i <= 48; i++) {
    var a = i / 48 * 2 * Math.PI;
    pts.push([ll.lng + Math.cos(a) * radio / kx, ll.lat + Math.sin(a) * radio / ky]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } };
}

function tocarUbicacion() {
  if (ubicacion.ultima) {
    mapa.setView(ubicacion.ultima, Math.max(mapa.getZoom(), 16));
    return;
  }
  if (!navigator.geolocation) {
    mostrarMensaje('Este navegador no puede mostrar tu ubicación.', true);
    return;
  }
  if (!window.isSecureContext) {
    mostrarMensaje('La ubicación solo funciona cuando la página está publicada en internet (https). ' +
                   'En la PC con localhost sí anda.', true);
    return;
  }
  if (ubicacion.buscando) return;
  ubicacion.buscando = true;
  controlUbicacion.boton.classList.add('buscando');
  mostrarMensaje('Buscando tu ubicación...');
  mapa.locate({ watch: true, enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
}

mapa.on('locationfound', function (e) {
  var primera = !ubicacion.ultima;
  ubicacion.ultima = e.latlng;
  if (!ubicacion.punto) {
    var el = document.createElement('div');
    el.className = 'punto-ubicacion';
    ubicacion.punto = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' })
      .setLngLat([e.latlng.lng, e.latlng.lat]).addTo(gl);
  } else ubicacion.punto.setLngLat([e.latlng.lng, e.latlng.lat]);
  // navegando no se dibuja el círculo de precisión (alrededor del camión molestaba)
  ponerDatos('precision', e.accuracy && !(typeof nav !== 'undefined' && nav.activo) ? [circuloGeo(e.latlng, e.accuracy)] : []);
  if (primera) {
    ubicacion.buscando = false;
    controlUbicacion.boton.classList.remove('buscando');
    controlUbicacion.boton.classList.add('activo');
    ocultarMensaje();
    mapa.setView(e.latlng, Math.max(mapa.getZoom(), 16));
  }
});

// --- Velocímetro (pedido del chofer, 20/11/2026) ---
// La velocidad la da el GPS del teléfono; si no la da, se calcula con las dos últimas ubicaciones.
// Arriba de 80 km/h (la máxima para camiones en ruta, Ley 24.449) el número se pone naranja.
var velocidad = { ult: null, timer: null };
mapa.on('locationfound', function (e) {
  var el = document.getElementById('velocimetro');
  if (!el) return;   // index.html viejo guardado en el celular
  var ahora = Date.now(), v = e.speed, u = velocidad.ult;
  if (v == null || isNaN(v) || v < 0) {
    v = null;
    if (u && ahora - u.t >= 1000 && ahora - u.t < 15000 && (e.accuracy || 99) <= 35) v = u.ll.distanceTo(e.latlng) / ((ahora - u.t) / 1000);
  }
  if (!u || ahora - u.t >= 1000) velocidad.ult = { ll: e.latlng, t: ahora };
  if (v == null) return;
  var kmh = v * 3.6;
  if (kmh > 200) return;   // salto del GPS
  if (kmh < 3) kmh = 0;
  velocidad.kmh = kmh;
  el.querySelector('b').textContent = Math.round(kmh);
  el.classList.toggle('rapido', kmh > 80.5);
  // con un radar adelante (navegando): rojo si vas más rápido que su máxima
  el.classList.toggle('pasado', !!(nav.activo && nav.limite && kmh > nav.limite + 1));
  el.hidden = false;
  document.body.classList.add('con-velocimetro');
  clearTimeout(velocidad.timer);
  velocidad.timer = setTimeout(function () {   // sin datos del GPS hace rato: se esconde
    el.hidden = true;
    document.body.classList.remove('con-velocimetro');
  }, 20000);
});

mapa.on('locationerror', function (e) {
  if (ubicacion.ultima) return;   // ya teníamos una ubicación; un error suelto no importa
  ubicacion.buscando = false;
  controlUbicacion.boton.classList.remove('buscando');
  mapa.stopLocate();
  var texto = e.code === 1
    ? (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
        ? 'No diste permiso para ver tu ubicación. En el iPhone: Ajustes → Privacidad y seguridad → Localización (que esté ' +
          'activada) → Sitios web de Safari → "Al usar la app". Después volvé a tocar el botón.'
        : 'No diste permiso para ver tu ubicación. Activalo en la configuración del navegador (ícono del candado, al lado de la dirección) y volvé a tocar el botón.')
    : e.code === 3
      ? 'Tardó demasiado en encontrar tu ubicación. Revisá que el GPS esté prendido y volvé a probar.'
      : 'No pude encontrar tu ubicación. Revisá que el GPS esté prendido y volvé a probar.';
  mostrarMensaje(texto, true);
  setTimeout(ocultarMensaje, e.code === 1 ? 15000 : 8000);
});

// ===== 9b. Ruta para mi camión =====
// Calcula la ruta con OpenRouteService (perfil camión, si hay clave en datos/ruta_config.json)
// o, si no hay clave o falla, con Valhalla (servidor público, perfil "truck").
// Los dos respetan las restricciones de OpenStreetMap con las medidas del camión.
// Después se revisa la ruta contra NUESTROS datos (pasos bajos calculados, reportes) y se avisa.
var ruta = {
  desde: null, hasta: null,            // { latlng, nombre }
  marcas: { desde: null, hasta: null },
  linea: null, borde: null,
  tocando: null,                       // 'desde' | 'hasta' mientras se espera un toque en el mapa
  esperandoUbicacion: false,
  config: null,
  paradas: []                          // "Pasar por": ids 'p1', 'p2'... en orden; ruta[id] = { latlng, nombre }
};
var CAMION_ANCHO = 2.6;   // ancho legal; el formulario no lo pide


fetch('datos/ruta_config.json', { cache: 'no-cache' })
  .then(function (r) { return r.ok ? r.json() : null; })
  .then(function (c) { ruta.config = c; mostrarCortes(); if (zonasIndice.length) armarPanel(); })
  .catch(function () { /* sin config: se usa Valhalla */ });

var panelRuta = document.getElementById('panel-ruta');

function abrirPanelRuta(abrir) {
  if (!panelRuta) return;
  if (abrir) abrirPanel(false);
  panelRuta.hidden = !abrir;
  document.body.classList.toggle('ruta-abierta', !!abrir);
  marcarEscribiendo();
  if (abrir) {
    // el aviso de "casi no hay datos" va arriba y tapaba los casilleros A / B: se saca (ya está en Qué mostrar)
    var m = document.getElementById('mensaje');
    if (!m.hidden && zonasIndice.some(function (z) { return z.aviso && m.textContent.indexOf(z.aviso) !== -1; })) ocultarMensaje();
    prepararRuta();
  }
}
// Pasa el panel de ruta a "resultado" (tarjeta abajo, como Google Maps) o a "escribir" (arriba)
function modoResultado(si) {
  if (!panelRuta) return;
  panelRuta.classList.toggle('con-resultado', !!si);
  marcarEscribiendo();
  actualizarTrayecto();
}
// body.ruta-escribiendo = panel de ruta arriba: los mensajes van abajo (ver estilos.css)
function marcarEscribiendo() {
  document.body.classList.toggle('ruta-escribiendo', !!panelRuta && !panelRuta.hidden && !panelRuta.classList.contains('con-resultado'));
  medirHoja();
}
// Con la tarjeta de la ruta abajo (celular), los botones redondos (brújula, ubicación) y el crédito suben y quedan
// arriba de la tarjeta, como en Google Maps (antes quedaban tapados). --alto-hoja = alto de la tarjeta.
function medirHoja() {
  var alto = 0, barra = document.getElementById('nav-abajo');
  if (panelRuta && !panelRuta.hidden && panelRuta.classList.contains('con-resultado') && window.innerWidth <= 600) {
    alto = Math.round(panelRuta.getBoundingClientRect().height);
  }
  if (barra && !barra.hidden && window.innerWidth <= 600) alto = Math.round(barra.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--alto-hoja', alto + 'px');
}
if (window.ResizeObserver && panelRuta) {
  var obsHoja = new ResizeObserver(medirHoja);
  obsHoja.observe(panelRuta);
  if (document.getElementById('nav-abajo')) obsHoja.observe(document.getElementById('nav-abajo'));
}
window.addEventListener('resize', medirHoja);
function actualizarTrayecto() {
  var b = document.getElementById('ruta-trayecto');
  var nums = '';
  ruta.paradas.forEach(function (c, i) { if (ruta[c]) nums += '<i class="ruta-marca parada">' + (i + 1) + '</i>'; });
  if (b) b.innerHTML = '<span class="ruta-marca desde">A</span><span>' + esc(ruta.desde ? ruta.desde.nombre : '¿Desde?') +
    '</span>' + nums + '<span class="ruta-marca hasta">B</span><span>' + esc(ruta.hasta ? ruta.hasta.nombre : '¿Hasta?') + '</span>';
  var t = document.getElementById('buscador-texto'), campo = document.getElementById('btn-buscar');
  if (t) t.textContent = ruta.hasta ? ruta.hasta.nombre : '¿A dónde vas?';
  if (campo) campo.classList.toggle('con-destino', !!ruta.hasta);
  // ✕ en la barra de arriba: sacar la ruta del mapa (antes no había forma clara de cancelarla)
  var cancelar = document.getElementById('btn-cancelar-ruta');
  if (cancelar) cancelar.hidden = !(ruta.hasta || ruta.opciones);
}
function cancelarRuta() {
  if (typeof nav !== 'undefined' && nav.activo) terminarNavegacion();
  borrarRuta();
  abrirPanelRuta(false);
  actualizarTrayecto();
  mostrarMensaje('Ruta cancelada.');
  setTimeout(ocultarMensaje, 2500);
}
if (document.getElementById('btn-cancelar-ruta')) document.getElementById('btn-cancelar-ruta').addEventListener('click', cancelarRuta);

// Para que sea rápido: al abrir, la salida es tu ubicación (si el GPS está disponible) y el cursor queda
// en "Hasta" con tus destinos recientes. Cuando están los dos puntos, la ruta se calcula sola.
function prepararRuta() {
  var enNav = typeof nav !== 'undefined' && nav.activo;
  if (!ruta.desde && !ruta.esperandoUbicacion && !enNav && window.isSecureContext && navigator.geolocation) {
    if (ubicacion.ultima) ponerPunto('desde', ubicacion.ultima, 'Mi ubicación');
    else { document.getElementById('ruta-desde').placeholder = 'Buscando tu ubicación...'; usarMiUbicacion(); }
  }
  if (!ruta.hasta && !enNav) {
    mostrarRecientes();
    setTimeout(function () { if (!panelRuta.hidden && !ruta.hasta) document.getElementById('ruta-hasta').focus(); }, 80);
  }
}

// Elegir un punto desde la pantalla (sugerencia, mapa, ubicación, recientes): si ya están los dos, calcula
function elegirPunto(cual, latlng, nombre) {
  // si elegiste otra salida mientras el GPS buscaba, cuando aparezca el GPS ya no la reemplaza
  if (cual === 'desde' && nombre !== 'Mi ubicación') ruta.esperandoUbicacion = false;
  ponerPunto(cual, latlng, nombre);
  ruta.paradas.forEach(function (c) { if (ruta[c]) ruta[c].pasada = false; });   // cambio a mano: vuelven a contar
  if (cual === 'hasta' && nombre && !/^Punto en el mapa/.test(nombre)) guardarReciente(nombre, latlng);
  if (ruta.desde && ruta.hasta) {
    if (panelRuta.hidden) abrirPanelRuta(true);
    calcularRuta();
  } else if (cual === 'hasta' && !ruta.desde && !ruta.esperandoUbicacion) {
    document.getElementById('ruta-desde').focus();
  }
}

// Destinos recientes (se guardan en el teléfono)
var CLAVE_RECIENTES = 'mapa-camiones:recientes';
function guardarReciente(nombre, latlng) {
  var ll = L.latLng(latlng);
  var lista = (leerGuardado(CLAVE_RECIENTES) || []).filter(function (r) {
    return r && r.nombre !== nombre && L.latLng(r.lat, r.lng).distanceTo(ll) > 30;
  });
  lista.unshift({ nombre: nombre, lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) });
  guardar(CLAVE_RECIENTES, lista.slice(0, 6));
}
function mostrarRecientes() {
  var lista = (leerGuardado(CLAVE_RECIENTES) || []).filter(function (r) { return r && r.nombre && typeof r.lat === 'number'; });
  if (!lista.length) { document.getElementById('resultados-hasta').hidden = true; return; }
  mostrarOpciones('hasta', lista, 'Destinos recientes', '🕘 ');
}

// Lista de opciones debajo de un campo (sugerencias, resultados o recientes)
function mostrarOpciones(cual, opciones, titulo, icono) {
  var lista = document.getElementById('resultados-' + cual);
  lista.innerHTML = '';
  lista.hidden = false;
  if (titulo) {
    var t = document.createElement('li');
    t.className = 'ruta-cargando';
    t.textContent = titulo;
    lista.appendChild(t);
  }
  opciones.forEach(function (o) {
    var li = document.createElement('li');
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = (icono || '') + o.nombre;
    b.addEventListener('click', function () { elegirPunto(cual, [o.lat, o.lng], o.nombre); });
    li.appendChild(b);
    lista.appendChild(li);
  });
}

var ControlRuta = L.Control.extend({
  options: { position: 'bottomleft' },
  onAdd: function () {
    var boton = L.DomUtil.create('button', 'boton-ruta');
    boton.type = 'button';
    boton.innerHTML = '<span aria-hidden="true">🧭</span> Ruta';
    boton.setAttribute('aria-label', 'Armar una ruta para mi camión');
    L.DomEvent.disableClickPropagation(boton);
    L.DomEvent.on(boton, 'click', function () { abrirPanelRuta(panelRuta.hidden); });
    return boton;
  }
});
// (el botón "Ruta" de abajo se reemplazó por "¿A dónde vas?" arriba)
var botonBuscar = document.getElementById('btn-buscar');
if (botonBuscar && panelRuta) botonBuscar.addEventListener('click', function () { abrirPanelRuta(true); });

// --- Elegir los puntos ---
function ponerPunto(cual, latlng, nombre) {
  ruta[cual] = { latlng: L.latLng(latlng), nombre: nombre || coordenadas(latlng) };
  var input = document.getElementById('ruta-' + cual);
  if (input) input.value = ruta[cual].nombre;
  actualizarTrayecto();
  var lista = document.getElementById('resultados-' + cual);
  if (lista) { lista.hidden = true; lista.innerHTML = ''; }
  if (ruta.marcas[cual]) ruta.marcas[cual].remove();
  var el = document.createElement('span');
  var esParada = cual !== 'desde' && cual !== 'hasta';
  el.className = 'ruta-marca ' + (esParada ? 'parada' : cual);
  el.textContent = cual === 'desde' ? 'A' : cual === 'hasta' ? 'B' : String(ruta.paradas.indexOf(cual) + 1);
  ruta.marcas[cual] = new maplibregl.Marker({ element: el }).setLngLat([ruta[cual].latlng.lng, ruta[cual].latlng.lat]).addTo(gl);
}

function coordenadas(ll) {
  ll = L.latLng(ll);
  return 'Punto en el mapa (' + ll.lat.toFixed(4) + ', ' + ll.lng.toFixed(4) + ')';
}

function usarMiUbicacion() {
  if (ubicacion.ultima) { elegirPunto('desde', ubicacion.ultima, 'Mi ubicación'); return; }
  ruta.esperandoUbicacion = true;
  tocarUbicacion();
}
mapa.on('locationerror', function () {
  ruta.esperandoUbicacion = false;
  var i = document.getElementById('ruta-desde');
  if (i) i.placeholder = 'Calle y número, ciudad';
});
mapa.on('locationfound', function (e) {
  if (!ruta.esperandoUbicacion) return;
  ruta.esperandoUbicacion = false;
  if (nav.activo) return;   // ya está manejando: no se toca la ruta
  document.getElementById('ruta-desde').placeholder = 'Calle y número, ciudad';
  elegirPunto('desde', e.latlng, 'Mi ubicación');
});

function empezarATocar(cual) {
  ruta.tocando = cual;
  abrirPanelRuta(false);
  mostrarMensaje(cual === 'desde' ? 'Tocá en el mapa desde dónde salís.' : 'Tocá en el mapa adónde vas.');
}
mapa.on('click', function (e) {
  if (!ruta.tocando) return;
  var cual = ruta.tocando;
  ruta.tocando = null;
  e.tomado = true;   // este toque no abre carteles
  mapa.closePopup();
  ocultarMensaje();
  ponerPunto(cual, e.latlng);
  abrirPanelRuta(true);
  elegirPunto(cual, e.latlng);
});

// Buscar direcciones.
// Mientras escribís: Photon (buscador de datos de OpenStreetMap hecho para sugerir al escribir), sesgado a lo que se ve.
// Al tocar "Buscar" o Enter: Photon y, si no encuentra, Nominatim (que no permite buscar mientras se escribe).
var sugerencia = { timer: null, ctrl: null };
function sugerir(cual, inmediato) {
  var input = document.getElementById('ruta-' + cual);
  var lista = document.getElementById('resultados-' + cual);
  var texto = input.value.trim();
  clearTimeout(sugerencia.timer);
  if (texto.length < 3) {
    if (inmediato) { input.focus(); return; }
    if (cual === 'hasta' && !texto) mostrarRecientes(); else lista.hidden = true;
    return;
  }
  sugerencia.timer = setTimeout(function () { buscarPhoton(cual, texto, inmediato); }, inmediato ? 0 : 250);
}

function etiquetaPhoton(p) {
  var partes = [];
  var calle = p.street ? p.street + (p.housenumber ? ' ' + p.housenumber : '') : '';
  if (p.name && p.name !== p.street) partes.push(p.name);
  if (calle) partes.push(calle);
  var lugar = p.city || p.town || p.village || p.district || p.county;
  if (lugar && partes.indexOf(lugar) === -1) partes.push(lugar);
  if (p.state && p.state !== lugar) partes.push(p.state);
  return partes.join(', ');
}

// "Pasar por": primero solo ciudades y pueblos (si no, "Arrecifes" daba calles con ese nombre cerca de lo que se ve)
function buscarPhoton(cual, texto, conRespaldo, sinFiltro) {
  var soloLugares = /^p\d/.test(cual) && !sinFiltro;
  var lista = document.getElementById('resultados-' + cual);
  if (sugerencia.ctrl) sugerencia.ctrl.abort();
  var ctrl = sugerencia.ctrl = window.AbortController ? new AbortController() : null;
  var c = mapa.getCenter();
  var url = 'https://photon.komoot.io/api/?limit=6&bbox=-73.6,-55.1,-53.6,-21.7' +
            (soloLugares ? '&osm_tag=place' : '&lat=' + c.lat.toFixed(3) + '&lon=' + c.lng.toFixed(3)) + '&q=' + encodeURIComponent(texto);
  if (conRespaldo) { lista.hidden = false; lista.innerHTML = '<li class="ruta-cargando">Buscando...</li>'; }
  fetch(url, ctrl ? { signal: ctrl.signal } : {})
    .then(function (r) { if (!r.ok) throw new Error('photon ' + r.status); return r.json(); })
    .then(function (d) {
      var vistos = {}, res = [];
      (d.features || []).forEach(function (f) {
        var p = f.properties || {};
        if (p.countrycode && p.countrycode !== 'AR') return;
        var nombre = etiquetaPhoton(p);
        if (!nombre || vistos[nombre]) return;
        vistos[nombre] = true;
        res.push({ nombre: nombre, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] });
      });
      if (document.getElementById('ruta-' + cual).value.trim() !== texto) return;   // ya escribió otra cosa
      if (!res.length) {
        if (soloLugares) { buscarPhoton(cual, texto, conRespaldo, true); return; }
        if (conRespaldo) buscarNominatim(cual, texto);
        else lista.hidden = true;
        return;
      }
      mostrarOpciones(cual, res);
      // Photon a veces no conoce un lugar (ej. "Parque Industrial Mar del Plata"): opción de buscar con el otro buscador
      var li = document.createElement('li'), mas = document.createElement('button');
      mas.type = 'button';
      mas.className = 'ruta-buscar-mas';
      mas.textContent = '🔎 No está en la lista: buscar más';
      mas.addEventListener('click', function () { buscarNominatim(cual, texto); });
      li.appendChild(mas);
      lista.appendChild(li);
    })
    .catch(function (e) {
      if (e && e.name === 'AbortError') return;
      if (conRespaldo) buscarNominatim(cual, texto);
    });
}

function buscarNominatim(cual, texto) {
  var lista = document.getElementById('resultados-' + cual);
  lista.hidden = false;
  lista.innerHTML = '<li class="ruta-cargando">Buscando...</li>';
  var b = mapa.getBounds();
  var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&countrycodes=ar&accept-language=es' +
            '&viewbox=' + [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].map(function (n) { return n.toFixed(4); }).join(',') +
            '&q=' + encodeURIComponent(texto);
  fetch(url)
    .then(function (r) { if (!r.ok) throw new Error('buscador ' + r.status); return r.json(); })
    .then(function (res) {
      if (!res.length) {
        lista.innerHTML = '<li class="ruta-cargando">No encontré esa dirección. Probá con calle, número y ciudad, o tocá el lugar en el mapa.</li>';
        return;
      }
      // lo más cerca de lo que se ve, primero (Nominatim da primero lo "más importante", aunque esté en otra provincia)
      var centro = mapa.getCenter();
      mostrarOpciones(cual, res.map(function (r) {
        return { nombre: r.display_name.split(', ').slice(0, 4).join(', '), lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
      }).sort(function (x, y) { return centro.distanceTo([x.lat, x.lng]) - centro.distanceTo([y.lat, y.lng]); }));
    })
    .catch(function () { lista.innerHTML = '<li class="ruta-cargando">No pude buscar. Revisá la conexión.</li>'; });
}
function buscarDireccion(cual) { sugerir(cual, true); }

function prepararCampo(cual) {
  var campo = document.getElementById('ruta-' + cual);
  campo.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); buscarDireccion(cual); }
  });
  campo.addEventListener('input', function () { sugerir(cual, false); });
  // al tocar el campo: elegir todo (para escribir encima) y, si "Hasta" está vacío, mostrar los recientes
  campo.addEventListener('focus', function () {
    if (/^Mi ubicación$|^Punto en el mapa/.test(campo.value)) campo.select();
    if (cual === 'hasta' && !campo.value.trim()) mostrarRecientes();
  });
}

// --- "Pasar por" (20/11/2026, pedido del chofer: "yo voy por ruta 2, la 7, la 51, la 9 hasta Córdoba y la 60") ---
// Hasta 5 lugares entre A y B. La ruta se arma por partes (A → 1 → 2 → ... → B), cada parte con el mismo cálculo
// de siempre (esquiva lo rojo, viajes largos por partes) y después se revisa entera.
var MAX_PARADAS = 5, numeroParada = 0;
function agregarParada() {
  if (ruta.paradas.length >= MAX_PARADAS) return;
  var cual = 'p' + (++numeroParada);
  ruta.paradas.push(cual);
  var fila = document.createElement('div');
  fila.className = 'ruta-fila ruta-fila-parada';
  fila.id = 'fila-' + cual;
  fila.innerHTML = '<span class="ruta-marca parada" aria-hidden="true"></span>' +
    '<input id="ruta-' + cual + '" type="search" placeholder="Pasar por (ciudad, pueblo...)" aria-label="Pasar por" ' +
    'enterkeyhint="search" autocomplete="off">' +
    '<button type="button" class="boton-icono" aria-label="Sacar este lugar">✕</button>';
  var lista = document.createElement('ul');
  lista.id = 'resultados-' + cual;
  lista.className = 'ruta-resultados';
  lista.hidden = true;
  var cont = document.getElementById('ruta-paradas');
  cont.appendChild(fila);
  cont.appendChild(lista);
  fila.querySelector('button').addEventListener('click', function () { sacarParada(cual); });
  prepararCampo(cual);
  numerarParadas();
  document.getElementById('agregar-parada').hidden = ruta.paradas.length >= MAX_PARADAS;
  if (panelRuta.classList.contains('con-resultado')) modoResultado(false);
  document.getElementById('ruta-' + cual).focus();
}
function sacarParada(cual, sinCalcular) {
  var habia = !!ruta[cual];
  ruta.paradas = ruta.paradas.filter(function (c) { return c !== cual; });
  if (ruta.marcas[cual]) ruta.marcas[cual].remove();
  delete ruta.marcas[cual];
  delete ruta[cual];
  ['fila-', 'resultados-'].forEach(function (pre) { var e = document.getElementById(pre + cual); if (e) e.remove(); });
  numerarParadas();
  var boton = document.getElementById('agregar-parada');
  if (boton) boton.hidden = false;
  actualizarTrayecto();
  if (habia && !sinCalcular && ruta.desde && ruta.hasta) calcularRuta();
}
function numerarParadas() {
  ruta.paradas.forEach(function (c, i) {
    var f = document.getElementById('fila-' + c);
    if (f) f.querySelector('.ruta-marca').textContent = i + 1;
    if (ruta.marcas[c]) ruta.marcas[c].getElement().textContent = i + 1;
  });
}
// las que tienen lugar elegido y todavía no se pasaron (navegando)
function paradasElegidas() {
  return ruta.paradas.filter(function (c) { return ruta[c] && !ruta[c].pasada; }).map(function (c) { return ruta[c]; });
}
// Navegando, al recalcular: las paradas que quedaron atrás (más cerca del comienzo de la ruta que vos) no se repiten
function marcarParadasPasadas(pos) {
  var r = ruta.linea;
  if (!r || !ruta.paradas.length) return;
  function indice(ll) {
    var mejor = 0, d = Infinity;
    for (var i = 0; i < r.puntos.length; i++) { var x = ll.distanceTo(r.puntos[i]); if (x < d) { d = x; mejor = i; } }
    return mejor;
  }
  var yo = indice(L.latLng(pos));
  ruta.paradas.forEach(function (c) { if (ruta[c] && indice(ruta[c].latlng) <= yo) ruta[c].pasada = true; });
}

if (panelRuta) {
  document.getElementById('cerrar-ruta').addEventListener('click', function () { abrirPanelRuta(false); });
  document.getElementById('desde-ubicacion').addEventListener('click', usarMiUbicacion);
  ['desde', 'hasta'].forEach(function (cual) {
    var bBuscar = document.querySelector('[data-buscar="' + cual + '"]'), bTocar = document.querySelector('[data-tocar="' + cual + '"]');
    if (bBuscar) bBuscar.addEventListener('click', function () { buscarDireccion(cual); });
    if (bTocar) bTocar.addEventListener('click', function () { empezarATocar(cual); });
    prepararCampo(cual);
  });
  if (document.getElementById('agregar-parada')) document.getElementById('agregar-parada').addEventListener('click', agregarParada);
  var bCalcular = document.getElementById('calcular-ruta');
  if (bCalcular) bCalcular.addEventListener('click', calcularRuta);
  document.getElementById('borrar-ruta').addEventListener('click', cancelarRuta);
  // "A ... B ...": volver a escribir la salida o la llegada
  var trayecto = document.createElement('button');
  trayecto.type = 'button'; trayecto.id = 'ruta-trayecto'; trayecto.className = 'ruta-trayecto';
  trayecto.setAttribute('aria-label', 'Cambiar la salida o la llegada');
  trayecto.addEventListener('click', function () {
    modoResultado(false);
    var h = document.getElementById('ruta-hasta'); h.focus(); h.select();
  });
  panelRuta.insertBefore(trayecto, document.getElementById('ruta-resultado'));
  actualizarTrayecto();
}

// --- Calcular ---
// OpenRouteService no deja esquivar zonas en viajes de más de 150 km. En un viaje largo se pide el
// recorrido entero sin esquivar y después se recalculan la salida y la llegada (los primeros y los
// últimos ~40 km, donde están las ciudades y sus prohibiciones) esquivando lo que haga falta.
var VIAJE_LARGO_KM = 110;      // distancia en línea recta a partir de la cual se arma por partes
var TRAMO_CIUDAD_KM = 40;

function calcularRuta() {
  var salida = document.getElementById('ruta-resultado');
  if (!camion) { abrirVentanaCamion(); return; }
  if (!ruta.desde || !ruta.hasta) {
    salida.hidden = false;
    salida.innerHTML = '<p class="ruta-aviso">Elegí desde dónde salís y adónde vas.</p>';
    return;
  }
  salida.hidden = false;
  if (!zonasIndice.length) {
    salida.innerHTML = '<div class="ruta-peligro"><b>No pude cargar los datos del mapa</b>, así que no puedo revisar ' +
      'ninguna ruta. Revisá la conexión y recargá la página.</div>';
    if (ruta.alTerminarCalculo) { var f0 = ruta.alTerminarCalculo; ruta.alTerminarCalculo = null; f0(false); }
    return;
  }
  salida.innerHTML = '<p class="ruta-cargando">Buscando caminos para tu camión...</p>';
  modoResultado(true);
  var numero = ruta.numeroCalculo = (ruta.numeroCalculo || 0) + 1;
  var desde = ruta.desde.latlng, hasta = ruta.hasta.latlng;
  var largo = desde.distanceTo(hasta) / 1000 > VIAJE_LARGO_KM;
  var paradas = paradasElegidas();

  (paradas.length ? calcularConParadas([ruta.desde].concat(paradas, [ruta.hasta]), salida)
   : (largo ? cargarZonasEnRutas([[[desde.lat, desde.lng]], [[hasta.lat, hasta.lng]]])
            : cargarZonasEn(L.latLngBounds([desde, hasta]).pad(0.1)))
    .then(function () {
      if (!largo) return calcularTramo(desde, hasta, salida, true);
      return calcularViajeLargo(desde, hasta, salida);
    }))
    .then(function (caminos) {
      if (numero !== ruta.numeroCalculo) return;   // hay un cálculo más nuevo: este ya no sirve
      ruta.opciones = elegirOpciones(caminos);
      mostrarRuta(0, !!ruta.alTerminarCalculo);
      terminoCalculo(true);
    })
    .catch(function (e) {
      if (numero !== ruta.numeroCalculo) return;
      console.error(e);
      salida.innerHTML = '<p class="ruta-aviso">' + esc(e.mensaje || 'No pude calcular la ruta. Revisá la conexión y probá de nuevo en un rato.') + '</p>';
      terminoCalculo(false);
    });
  function terminoCalculo(ok) {
    var f = ruta.alTerminarCalculo;
    ruta.alTerminarCalculo = null;
    if (f) f(ok);
  }
}

// Ruta que pasa por lugares elegidos: una parte por vez (así no se le pide todo junto al servicio de rutas)
function calcularConParadas(puntos, salida) {
  var n = puntos.length - 1, listas = 0;
  salida.innerHTML = '<p class="ruta-cargando">Buscando el camino (' + n + ' partes)...</p>';
  // de a 2 partes a la vez (antes, una por una: tardaba mucho más; todas juntas pasan el límite de pedidos por
  // minuto de OpenRouteService y caen al servicio de respaldo, que elige peor)
  var partes = [], siguiente = 0;
  function trabajar() {
    var k = siguiente++;
    if (k >= n) return Promise.resolve();
    return mejorCaminoEntre(puntos[k].latlng, puntos[k + 1].latlng, {}).then(function (c) {
      partes[k] = c;
      listas++;
      salida.innerHTML = '<p class="ruta-cargando">Buscando el camino: ' + listas + ' de ' + n + ' partes listas...</p>';
      return trabajar();
    });
  }
  return Promise.all([trabajar(), trabajar()]).then(function () { return [unirPartes(partes)]; });
}
function mejorCaminoEntre(a, b, salida) {
  if (a.distanceTo(b) / 1000 > VIAJE_LARGO_KM) {
    return cargarZonasEnRutas([[[a.lat, a.lng]], [[b.lat, b.lng]]])
      .then(function () { return calcularViajeLargo(a, b, salida); })
      .then(function (cs) { return cs[0]; });
  }
  return cargarZonasEn(L.latLngBounds([a, b]).pad(0.1))
    .then(function () { return calcularTramo(a, b, salida, false); })
    .then(function (cs) { return elegirOpciones(cs)[0]; });
}
function unirPartes(partes) {
  var c = { puntos: [], pasos: [], km: 0, segundos: 0, vueltas: 0, kmChicas: 0, esquivados: 0, servicio: '', largo: true };
  partes.forEach(function (p, k) {
    var base = c.puntos.length;
    // sin el "llegaste" de cada lugar intermedio; la parte siguiente no "sale", sigue
    var pasos = k === partes.length - 1 ? p.pasos : p.pasos.slice(0, -1);
    pasos.forEach(function (s, j) {
      c.pasos.push(Object.assign({}, s, {
        ini: s.ini == null ? null : s.ini + base,
        texto: k > 0 && j === 0 ? String(s.texto).replace(/^Sal[ií] /, 'Seguí ') : s.texto
      }));
    });
    c.puntos = c.puntos.concat(p.puntos);
    c.km += p.km;
    c.segundos += p.segundos;
    c.vueltas += p.vueltas || 0;
    c.kmChicas = c.kmChicas == null || p.kmChicas == null ? null : c.kmChicas + p.kmChicas;
    c.esquivados += p.esquivados || 0;
    String(p.servicio || '').split(' y ').forEach(function (sv) {
      if (sv && c.servicio.indexOf(sv) === -1) c.servicio += (c.servicio ? ' y ' : '') + sv;
    });
  });
  c.avisos = revisarRuta(c.puntos, c.pasos);
  c.rojos = c.avisos.filter(function (x) { return x.rojo; }).length;
  c.sinRevisar = zonasSinCargarEnRutas([c.puntos]);
  return c;
}

// Pide el camino entre a y b (hasta 3 opciones)
function pedirCaminos(a, b, evitar, conAlternativas) {
  var clave = ruta.config && ruta.config.ors_clave;
  // si OpenRouteService dijo que se terminó el cupo, se va directo a Valhalla un rato
  // (403 = cupo del día o clave mala: 15 minutos; 429 = demasiados pedidos por minuto: 1 minuto; sin respuesta
  // legible —cuando se queda sin cupo contesta sin permiso CORS y el navegador lo ve como "Failed to fetch"—: 2 minutos)
  if (clave && ruta.orsHasta && Date.now() < ruta.orsHasta) clave = null;
  // v74: si OpenRouteService no está (cupo del día gastado, caído), TomTom (también calcula para camión; 20.000
  // rutas gratis por mes con la cuenta del chofer) y recién después Valhalla (el de respaldo, que respeta menos)
  function respaldo() {
    if (!claveTomTom() || (ruta.tomtomHasta && Date.now() < ruta.tomtomHasta)) return rutaValhalla(evitar, a, b);
    return rutaTomTom(evitar, a, b, conAlternativas).catch(function (e) {
      console.warn('TomTom falló:', e.message);
      if (/ (403|429)$/.test(e.message)) ruta.tomtomHasta = Date.now() + 15 * 60 * 1000;
      return rutaValhalla(evitar, a, b);
    });
  }
  return clave
    ? rutaORS(clave, evitar, !conAlternativas, a, b).catch(function (e) {
        console.warn('OpenRouteService falló:', e.message);
        if (/ 403$/.test(e.message)) ruta.orsHasta = Date.now() + 15 * 60 * 1000;
        if (/ 429$/.test(e.message)) ruta.orsHasta = Date.now() + 60 * 1000;
        if (e instanceof TypeError) ruta.orsHasta = Date.now() + 2 * 60 * 1000;
        return respaldo();
      })
    : respaldo();
}

// Zonas prohibidas (ordenanzas) para este camión, salvo las que tienen adentro la salida o la llegada
function zonasProhibidasEntre(a, b) {
  var zonas = [], claves = {};
  if (grupos.prohibido) grupos.prohibido.eachLayer(function (l) {
    if (l.feature.geometry.type !== 'Polygon' || evaluar(l.feature.properties).estado !== 'no') return;
    var anillo = l.feature.geometry.coordinates[0];
    if (dentroDeAnillo([a.lng, a.lat], anillo) || dentroDeAnillo([b.lng, b.lat], anillo)) return;
    zonas.push(anillo);
    claves['zona#' + L.stamp(l)] = true;
  });
  return { zonas: zonas, claves: claves };
}

// Los servicios de rutas solo esquivan lo que está cargado en OpenStreetMap. Si TODOS los caminos pasan
// por algo que en NUESTRO mapa es rojo para este camión (pasos bajos calculados, reportes aprobados,
// zonas de ordenanzas), se vuelve a pedir esquivando esos lugares. Hasta 4 vueltas.
function calcularTramo(a, b, salida, conAlternativas) {
  var MAX_VUELTAS = 4;
  var inicio = zonasProhibidasEntre(a, b);
  var ultimoEvitar = inicio.zonas;
  function revisarCaminos(caminos) {
    var listas = caminos.map(function (c) { return c.puntos; });
    return Promise.all([cargarZonasEnRutas(listas), cargarCortesEn(listas), cargarPaisEnRutas(listas)]).then(function () {
      caminos.forEach(function (c) {
        c.avisos = revisarRuta(c.puntos, c.pasos);
        c.rojos = c.avisos.filter(function (x) { return x.rojo; }).length;
        // lugares que se pidió esquivar y por los que este camino ya no pasa
        c.esquivados = Object.keys(lugares).filter(function (k) {
          return !c.avisos.some(function (x) { return x.clave === k && x.rojo; });
        }).length;
        c.sinRevisar = zonasSinCargarEnRutas([c.puntos]);
      });
      return caminos;
    });
  }
  // Pedido del chofer (20/11/2026): "no mandar por calles de adentro, un camión grande no puede ir por ahí".
  // Si el mejor camino usa calles de barrio en el MEDIO del viaje (no al salir ni al llegar, donde a veces no queda
  // otra), se pide otra vez prohibiendo esas calles; queda el que tenga mejor puntaje (las calles de barrio pesan mucho).
  function salirDeLosBarrios(caminos, vueltas) {
    var mejor = elegirOpciones(caminos.slice())[0];
    var cuadros = cuadradosCallesChicas(mejor);
    if (!cuadros.length || vueltas >= 2) return caminos;
    if (salida) salida.innerHTML = '<p class="ruta-cargando">El camino entraba por calles de barrio. Buscando uno por avenidas y rutas...</p>';
    var clave = ruta.config && ruta.config.ors_clave;
    if (!clave || (ruta.orsHasta && Date.now() < ruta.orsHasta)) return caminos;   // solo OpenRouteService dice qué calles son de barrio
    ultimoEvitar = ultimoEvitar.concat(cuadros);
    return rutaORS(clave, ultimoEvitar, !conAlternativas, a, b).then(function (nuevos) {
      nuevos = nuevos.filter(function (c) { return c.chicas; });   // solo los que dicen por qué calles van
      if (!nuevos.length) return caminos;
      return revisarCaminos(nuevos).then(function (nuevos) { return salirDeLosBarrios(caminos.concat(nuevos), vueltas + 1); });
    }, function () { return caminos; });
  }
  function vuelta(n, evitar, claves, anteriores) {
    ultimoEvitar = evitar;
    return pedirCaminos(a, b, evitar, conAlternativas).then(revisarCaminos).then(function (caminos) {
      var limpios = caminos.filter(function (c) { return !c.avisos.some(function (x) { return x.zonas && x.zonas.length; }); });
      // v74: TomTom acepta solo 10 rectángulos para esquivar: si desde la 2.ª vuelta todavía no hay un camino limpio,
      // se pide también a Valhalla (acepta 50 lugares) y se elige entre todos
      if (!limpios.length && n >= 2 && /^TomTom/.test(caminos[0].servicio) && !caminos.conValhalla) {
        return rutaValhalla(evitar, a, b).then(revisarCaminos).then(function (v) {
          var todos = caminos.concat(v);
          todos.conValhalla = true;
          return todos;
        }, function () { caminos.conValhalla = true; return caminos; }).then(function (todos) {
          var ok = todos.filter(function (c) { return !c.avisos.some(function (x) { return x.zonas && x.zonas.length; }); });
          return ok.length || n >= MAX_VUELTAS ? todos : seguir(todos);
        });
      }
      if (limpios.length || n >= MAX_VUELTAS) return caminos;
      return seguir(caminos);
    }, function (e) {
      if (anteriores) return anteriores;   // no hay otros: se muestran los anteriores con el aviso
      throw e;
    });
    function seguir(caminos) {
      var nuevas = 0;
      caminos.forEach(function (c) {
        c.avisos.forEach(function (x) {
          if (!x.zonas) return;
          x.zonas.forEach(function (z, k) {
            var cl = x.zonasClaves[k];
            if (claves[cl]) return;
            claves[cl] = true; evitar = evitar.concat([z]); nuevas++;
            if (cl.indexOf('zona#') !== 0) lugares[x.clave] = true;
          });
        });
      });
      if (!nuevas) return caminos;
      if (salida) salida.innerHTML = '<p class="ruta-cargando">Los caminos pasaban por ' + nuevas +
        (nuevas === 1 ? ' lugar' : ' lugares') + ' donde no pasás. Buscando otros que los esquiven...</p>';
      return vuelta(n + 1, evitar, claves, caminos);
    }
  }
  var lugares = {};   // lugares (no zonas de ordenanza) que se pidió esquivar
  return vuelta(1, inicio.zonas, inicio.claves, null).then(function (caminos) { return salirDeLosBarrios(caminos, 0); });
}

// El camino de un viaje largo se dibuja apenas llega (en 1 o 2 segundos) mientras se revisa que el camión pase:
// el chofer ve enseguida por dónde va (pedido del chofer, 20/11/2026: "tarda mucho en cargar la ruta").
function mostrarBorrador(c, salida) {
  if (!salida || !salida.nodeType) return;   // partes de "Pasar por" o pedazos internos: no se dibujan
  ponerDatos('ruta', [{ type: 'Feature', properties: { t: 'p' },
                        geometry: { type: 'LineString', coordinates: c.puntos.map(function (q) { return [q[1], q[0]]; }) } }]);
  var lim = L.latLngBounds(c.puntos);
  if (window.innerWidth <= 600) mapa.fitBounds(lim, { paddingTopLeft: [20, 30], paddingBottomRight: [20, (panelRuta.offsetHeight || 0) + 20] });
  else mapa.fitBounds(lim, { paddingTopLeft: [(panelRuta.offsetWidth || 0) + 30, 30], paddingBottomRight: [30, 30] });
  salida.innerHTML = '<p class="ruta-resumen"><b>' + esc(duracion(c.segundos)) + '</b> ' + esc(numero(c.km, 1)) + ' km</p>' +
                     '<p class="ruta-cargando">Revisando que tu camión pase por todo el camino... (unos segundos)</p>';
}
function calcularViajeLargo(desde, hasta, salida) {
  salida.innerHTML = '<p class="ruta-cargando">Viaje largo: buscando el recorrido...</p>';
  return pedirCaminos(desde, hasta, [], false).then(function (caminos) {
    var base = caminos[0];
    mostrarBorrador(base, salida);
    // distancia acumulada a lo largo del recorrido
    var acum = [0];
    for (var i = 1; i < base.puntos.length; i++) acum.push(acum[i - 1] + L.latLng(base.puntos[i - 1]).distanceTo(base.puntos[i]) / 1000);
    var total = acum[acum.length - 1];
    var corte = Math.min(TRAMO_CIUDAD_KM, total / 3);
    var i1 = acum.findIndex(function (d) { return d >= corte; });
    var i2 = acum.findIndex(function (d) { return d >= total - corte; });
    var p1 = L.latLng(base.puntos[i1]), p2 = L.latLng(base.puntos[i2]);
    // las zonas de todo el recorrido (para revisar el tramo del medio) se bajan mientras se piden la salida y la
    // llegada (antes, primero una cosa y después la otra)
    var cargas = Promise.all([cargarZonasEnRutas([base.puntos]), cargarCortesEn([base.puntos]), cargarPaisEnRutas([base.puntos])]);
    return Promise.all([calcularTramo(desde, p1, null, true), calcularTramo(p2, hasta, null, true), cargas]).then(function (r) {
      var salidaMejor = elegirOpciones(r[0])[0], llegadaMejor = elegirOpciones(r[1])[0];
      var medio = {
        puntos: base.puntos.slice(i1, i2 + 1),
        km: acum[i2] - acum[i1],
        pasos: base.pasos.filter(function (p) { return p.ini == null || (p.ini >= i1 && p.ini < i2); }),
        vueltas: 0
      };
      medio.pasos.forEach(function (p) { if (p.vuelta) medio.vueltas++; });
      medio.segundos = base.segundos * medio.km / total;
      medio.kmChicas = base.kmChicas == null ? null : 0;   // el medio es ruta
      var c = {
        servicio: salidaMejor.servicio === llegadaMejor.servicio ? salidaMejor.servicio
          : salidaMejor.servicio + ' y ' + llegadaMejor.servicio,
        puntos: salidaMejor.puntos.concat(medio.puntos, llegadaMejor.puntos),
        km: salidaMejor.km + medio.km + llegadaMejor.km,
        segundos: salidaMejor.segundos + medio.segundos + llegadaMejor.segundos,
        // sin el "llegaste" de la salida ni el "salí hacia..." de la llegada (son puntos de corte, no paradas)
        pasos: salidaMejor.pasos.slice(0, -1).concat(
          // las indicaciones de cada parte apuntan a su propio recorrido: se corren al recorrido completo
          medio.pasos.map(function (p) { return Object.assign({}, p, { ini: p.ini == null ? null : p.ini - i1 + salidaMejor.puntos.length }); }),
          llegadaMejor.pasos.slice(1).map(function (p) {
            return Object.assign({}, p, { ini: p.ini == null ? null : p.ini + salidaMejor.puntos.length + medio.puntos.length });
          })),
        vueltas: salidaMejor.vueltas + medio.vueltas + llegadaMejor.vueltas,
        kmChicas: salidaMejor.kmChicas == null || llegadaMejor.kmChicas == null ? null : salidaMejor.kmChicas + llegadaMejor.kmChicas,
        largo: true
      };
      c.avisos = revisarRuta(c.puntos, c.pasos);
      c.rojos = c.avisos.filter(function (x) { return x.rojo; }).length;
      c.esquivados = salidaMejor.esquivados + llegadaMejor.esquivados;
      var m0 = salidaMejor.puntos.length, m1 = m0 + medio.puntos.length;
      return arreglarMedio(c, m0, m1, salida && salida.nodeType ? null : salida).then(function (c2) {
        c2.sinRevisar = zonasSinCargarEnRutas([c2.puntos]);
        return [c2];
      });
    });
  });
}

// En un viaje largo el tramo del medio se pide sin esquivar nada (OpenRouteService no lo permite en más de
// 150 km). Si en el camino hay algo ROJO para el camión, se vuelve a pedir solo ese pedazo (30 km antes y
// 30 km después) esquivándolo, y se empalma. Hasta 3 pedazos.
// v72 (el chofer, MdP → norte del conurbano: "me hace ir por donde no paso por la altura"): el pedazo ya no se corta
// en el límite del tramo del medio (el corte había caído justo en General Paz y Libertador, al lado de los rojos, y
// ningún camino podía esquivarlos); se revisan los rojos de TODO el viaje; y si quedan, otra vuelta con 60 km de margen.
function arreglarMedio(c, m0, m1, salida, margen, vez) {
  margen = margen || 30; vez = vez || 1;
  var rojos = c.avisos.filter(function (x) { return x.rojo && x.zonas && x.zonas.length && x.orden != null; });
  if (!rojos.length) return Promise.resolve(c);
  var acum = [0];
  for (var i = 1; i < c.puntos.length; i++) acum.push(acum[i - 1] + L.latLng(c.puntos[i - 1]).distanceTo(c.puntos[i]) / 1000);
  // juntar los rojos que están a menos de 60 km uno del otro
  rojos.sort(function (a, b) { return a.orden - b.orden; });
  var grupos2 = [];
  rojos.forEach(function (x) {
    var g = grupos2[grupos2.length - 1];
    if (g && acum[x.orden] - acum[g.fin] < 60) g.fin = x.orden; else grupos2.push({ ini: x.orden, fin: x.orden });
  });
  grupos2 = grupos2.slice(0, 3);
  function indiceEn(km) { var j = acum.findIndex(function (d) { return d >= km; }); return j < 0 ? acum.length - 1 : j; }
  // del último al primero: así los índices de los anteriores no cambian al empalmar
  var cadena = Promise.resolve(c);
  grupos2.reverse().forEach(function (g) {
    cadena = cadena.then(function (actual) {
      var total = acum[acum.length - 1];
      var iA = indiceEn(Math.max(0, acum[g.ini] - margen)), iB = indiceEn(Math.min(total, acum[g.fin] + margen));
      if (acum[iB] - acum[iA] > 140) {   // muy largo para pedirlo esquivando: se achica alrededor de los rojos
        iA = indiceEn(Math.max(0, acum[g.ini] - 20)); iB = indiceEn(Math.min(total, acum[g.fin] + 20));
      }
      if (iB - iA < 2 || acum[iB] - acum[iA] > 140) return actual;
      if (salida) salida.innerHTML = '<p class="ruta-cargando">Viaje largo: en el camino hay lugares donde no pasás. ' +
        'Buscando cómo esquivarlos...</p>';
      return calcularTramo(L.latLng(actual.puntos[iA]), L.latLng(actual.puntos[iB]), null, false).then(function (caminos) {
        var nuevo = elegirOpciones(caminos)[0];
        var antes = actual.avisos.filter(function (x) { return x.rojo && x.orden >= iA && x.orden <= iB; }).length;
        if (!nuevo || nuevo.rojos >= antes) return actual;   // no mejoró: queda como estaba (con el aviso)
        return empalmar(actual, iA, iB, nuevo, acum[iB] - acum[iA]);
      }, function () { return actual; });
    });
  });
  return cadena.then(function (final) {
    if (final !== c) {
      final.avisos = revisarRuta(final.puntos, final.pasos);
      final.rojos = final.avisos.filter(function (x) { return x.rojo; }).length;
    }
    // ¿quedaron rojos? otra vuelta, con más margen (más lugar para dar la vuelta)
    if (vez < 2 && final.avisos.some(function (x) { return x.rojo && x.zonas && x.zonas.length; })) {
      return arreglarMedio(final, 0, final.puntos.length, salida, 60, vez + 1);
    }
    return final;
  });
}

// Reemplaza los puntos iA..iB del recorrido por otro camino (con sus indicaciones)
function empalmar(c, iA, iB, nuevo, kmViejo) {
  var delta = nuevo.puntos.length - (iB - iA + 1);
  var pasosViejos = c.pasos.filter(function (p) { return p.ini != null && p.ini >= iA && p.ini < iB; });
  var vueltasViejas = pasosViejos.filter(function (p) { return p.vuelta; }).length;
  // el "Salí hacia..." del pedazo nuevo no es una salida: es seguir viaje
  var pasos = c.pasos.filter(function (p) { return p.ini != null && p.ini < iA; })
    .concat(nuevo.pasos.slice(0, -1).map(function (p, k) {
      return Object.assign({}, p, { ini: p.ini == null ? null : p.ini + iA,
                                    texto: k === 0 ? String(p.texto).replace(/^Sal[ií] /, 'Seguí ') : p.texto });
    }))
    .concat(c.pasos.filter(function (p) { return p.ini == null || p.ini >= iB; })
      .map(function (p) { return p.ini == null ? p : Object.assign({}, p, { ini: p.ini + delta }); }));
  return Object.assign({}, c, {
    puntos: c.puntos.slice(0, iA).concat(nuevo.puntos, c.puntos.slice(iB + 1)),
    pasos: pasos,
    km: c.km - kmViejo + nuevo.km,
    segundos: c.segundos - c.segundos * kmViejo / c.km + nuevo.segundos,
    vueltas: c.vueltas - vueltasViejas + nuevo.vueltas,
    kmChicas: c.kmChicas == null || nuevo.kmChicas == null ? c.kmChicas : c.kmChicas + nuevo.kmChicas,
    esquivados: (c.esquivados || 0) + (nuevo.esquivados || 0),
    servicio: c.servicio.indexOf(nuevo.servicio) === -1 ? c.servicio + ' y ' + nuevo.servicio : c.servicio
  });
}

// --- Elegir el camino más fácil para un camión ---
// Puntaje en "minutos equivalentes" (más bajo = mejor):
//   minutos del servicio
//   + 12 por cada km por calles chicas (de barrio): 1 km por adentro "cuesta" como 12 minutos más de viaje
//   + 0,7 por cada vuelta (giro a la derecha o a la izquierda)
//   + 2 por cada km FUERA de la red de tránsito pesado, solo en las zonas que la tienen cargada
//   + 1000 por cada lugar rojo que no se pudo esquivar
var PUNTAJE = { kmCallesChicas: 12, vuelta: 0.7, kmFueraDeRed: 2, rojo: 1000 };
// Nombres de calles grandes (si el servicio dice que es una calle "común" y el nombre no tiene nada de esto,
// se la trata como calle de barrio)
var NOMBRE_DE_AVENIDA = /(^|[^a-záéíóúñ])(av(da)?\.?|avenida|ruta|r[pn] ?\d|autopista|autov[ií]a|acceso|camino|colectora|bulevar|boulevard|bv\.?|costanera|circunvalaci[oó]n|diagonal|paseo|ruta|variante|traza|puente|t[uú]nel|rotonda)([^a-záéíóúñ]|$)/i;

// Cuadraditos para prohibir las calles de barrio del medio del camino (no los primeros ni los últimos 600 m).
// Uno cada 100 m de calle, lejos de las puntas del tramo (ahí se cruza con la avenida, que no hay que tapar).
function cuadradosCallesChicas(c) {
  if (!c || !c.chicas || !c.chicas.length) return [];
  var acum = [0];
  for (var i = 1; i < c.puntos.length; i++) acum.push(acum[i - 1] + L.latLng(c.puntos[i - 1]).distanceTo(c.puntos[i]));
  var total = acum[acum.length - 1], res = [], metros = 0;
  c.chicas.forEach(function (r) {
    var ini = acum[r[0]], fin = acum[r[1]];
    // los primeros y los últimos 600 m no se tocan (para salir o llegar a veces no hay otra: un puerto, un depósito);
    // si la calle de barrio sigue más allá, ese pedazo sí (antes se perdonaba entera y la ruta podía ir km por adentro)
    var desde = Math.max(ini, 600), hasta = Math.min(fin, total - 600);
    if (hasta - desde < 60) return;
    metros += hasta - desde;
    for (var d = desde + 35; d <= hasta - 35; d += 100) {
      var j = r[0];
      while (j < r[1] && acum[j + 1] < d) j++;
      var t = (d - acum[j]) / ((acum[j + 1] - acum[j]) || 1);
      var p = L.latLng(c.puntos[j][0] + (c.puntos[j + 1][0] - c.puntos[j][0]) * t, c.puntos[j][1] + (c.puntos[j + 1][1] - c.puntos[j][1]) * t);
      res.push(cuadrado(p, 12));
    }
  });
  return metros >= 200 ? res.slice(0, 60) : [];
}

function elegirOpciones(caminos) {
  caminos.forEach(function (c) {
    var red = medirRed(c.puntos);
    c.kmEnRed = red.enRed; c.kmZonaConRed = red.zonaConRed;
    c.puntaje = c.segundos / 60 + PUNTAJE.kmCallesChicas * (c.kmChicas || 0) + PUNTAJE.vuelta * c.vueltas +
                PUNTAJE.kmFueraDeRed * Math.max(0, red.zonaConRed - red.enRed) + PUNTAJE.rojo * c.rojos;
  });
  var porFacilidad = caminos.slice().sort(function (a, b) { return a.puntaje - b.puntaje; });
  var facil = porFacilidad[0];
  facil.etiqueta = 'Más fácil para camión';
  var opciones = [facil];
  // la más corta, si es otra y no pasa por lugares rojos (o la fácil tampoco los esquiva)
  var corta = caminos.filter(function (c) { return c !== facil && c.rojos <= facil.rojos; })
                     .sort(function (a, b) { return a.km - b.km; })[0];
  if (corta && corta.km < facil.km - 0.3) { corta.etiqueta = 'Más corta'; opciones.push(corta); }
  // la que más usa la red de tránsito pesado, si usa bastante más que la fácil (20 puntos o más)
  function parte(c) { return c.kmZonaConRed > 1 ? c.kmEnRed / c.kmZonaConRed : 0; }
  var porRed = caminos.filter(function (c) { return opciones.indexOf(c) === -1 && c.rojos <= facil.rojos && parte(c) >= parte(facil) + 0.2; })
                      .sort(function (a, b) { return parte(b) - parte(a); })[0];
  if (porRed) { porRed.etiqueta = 'Más por red de tránsito pesado'; opciones.push(porRed); }
  return opciones;
}

// Cuántos km de un camino van por la red de tránsito pesado, y cuántos km pasan por zonas que la tienen
function medirRed(puntos) {
  var r = { enRed: 0, zonaConRed: 0 };
  if (!redPesada.grilla) return r;
  for (var i = 1; i < puntos.length; i++) {
    var a = puntos[i - 1], b = puntos[i];
    var km = L.latLng(a).distanceTo(b) / 1000;
    var medio = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (!redPesada.zonas.some(function (z) { return z.contains(medio); })) continue;
    r.zonaConRed += km;
    if (redPesada.cerca(medio, 15)) r.enRed += km;
  }
  return r;
}

function cuadrado(latlng, metrosLado) {
  // Cuadradito (en grados) alrededor de un punto, para pedirle al servicio que no pase por ahí
  var dy = metrosLado / 110540, dx = metrosLado / (111320 * Math.cos(latlng.lat * Math.PI / 180));
  var a = latlng.lng, b = latlng.lat;
  return [[a - dx, b - dy], [a + dx, b - dy], [a + dx, b + dy], [a - dx, b + dy], [a - dx, b - dy]];
}

function conTiempoLimite(url, opciones, segundos) {
  var control = window.AbortController ? new AbortController() : null;
  if (control) { opciones.signal = control.signal; setTimeout(function () { control.abort(); }, segundos * 1000); }
  return fetch(url, opciones);
}

function rutaORS(clave, evitar, sinAlternativas, a, b) {
  a = a || ruta.desde.latlng; b = b || ruta.hasta.latlng;
  var cuerpo = {
    coordinates: [[a.lng, a.lat], [b.lng, b.lat]],
    language: 'es', units: 'km', instructions: true, extra_info: ['waytype'],
    options: { vehicle_type: 'hgv', profile_params: { restrictions: {
      height: camion.altura, weight: camion.peso, length: camion.largo, width: CAMION_ANCHO } } }
  };
  if (!sinAlternativas) cuerpo.alternative_routes = { target_count: 3, weight_factor: 1.6, share_factor: 0.6 };
  if (evitar && evitar.length) {
    cuerpo.options.avoid_polygons = { type: 'MultiPolygon', coordinates: evitar.map(function (anillo) { return [anillo]; }) };
  }
  return conTiempoLimite('https://api.openrouteservice.org/v2/directions/driving-hgv/geojson', {
    method: 'POST',
    headers: { 'Authorization': clave, 'Content-Type': 'application/json', 'Accept': 'application/geo+json' },
    body: JSON.stringify(cuerpo)
  }, 30).then(function (r) {
    // los caminos alternativos tienen límites (por ejemplo, rutas muy largas): se pide uno solo
    if (!r.ok && !sinAlternativas && r.status !== 401 && r.status !== 403 && r.status !== 429) return rutaORS(clave, evitar, true, a, b);
    if (!r.ok) throw new Error('OpenRouteService ' + r.status);
    return r.json().then(function (d) {
      return d.features.map(function (f) {
        var pasos = [], vueltas = 0, sinAvenida = [];
        (f.properties.segments || []).forEach(function (s) {
          (s.steps || []).forEach(function (p) {
            if (p.way_points && p.name && p.name !== '-' && !NOMBRE_DE_AVENIDA.test(p.name)) sinAvenida.push(p.way_points);
            // OpenRouteService a veces dice "Camina hacia..." aunque sea en camión
            var esVuelta = p.type >= 0 && p.type <= 3;   // izquierda, derecha, cerrada a la izq./der.
            pasos.push({ texto: aCastellano(String(p.instruction).replace(/^Camin[ae] /, 'Salí ')), km: p.distance,
                         ini: p.way_points ? p.way_points[0] : null, vuelta: esVuelta });
            if (esVuelta) vueltas++;
          });
        });
        var c = f.geometry.coordinates, kmChicas = 0, chicas = [];
        var tipos = f.properties.extras && f.properties.extras.waytype;
        function sumar(d, h) {
          chicas.push([d, h]);
          for (var i = d + 1; i <= h; i++) kmChicas += L.latLng(c[i - 1][1], c[i - 1][0]).distanceTo([c[i][1], c[i][0]]) / 1000;
        }
        if (tipos) tipos.values.forEach(function (v) {   // [desde, hasta, tipo]; tipo 3 = "Street" (calle de barrio)
          if (v[2] === 3) return sumar(v[0], v[1]);
          // tipo 2 = "Road": avenidas, pero también calles comunes cargadas como "terciarias" (ej. Alem en Playa Grande,
          // Mar del Plata: la ruta dejaba Juan B. Justo para cortar por ahí). Si el nombre no dice avenida / ruta /
          // bulevar..., cuenta como calle de barrio.
          if (v[2] !== 2) return;
          sinAvenida.forEach(function (w) {
            var d = Math.max(v[0], w[0]), h = Math.min(v[1], w[1]);
            if (h > d) sumar(d, h);
          });
        });
        return {
          servicio: 'OpenRouteService',
          puntos: c.map(function (p) { return [p[1], p[0]]; }),
          km: f.properties.summary.distance, segundos: f.properties.summary.duration,
          pasos: pasos, vueltas: vueltas, kmChicas: kmChicas, chicas: tipos ? chicas : null
        };
      });
    });
  });
}

function rutaValhalla(evitar, a, b) {
  a = a || ruta.desde.latlng; b = b || ruta.hasta.latlng;
  var cuerpo = {
    locations: [{ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng }],
    costing: 'truck',
    costing_options: { truck: { height: camion.altura, weight: camion.peso, length: camion.largo, width: CAMION_ANCHO,
                                use_living_streets: 0, use_highways: 1 } },
    alternates: 2,
    units: 'kilometers',
    directions_options: { language: 'es-ES', units: 'kilometers' }
  };
  // Valhalla acepta muy pocos polígonos (100 vértices en total): se le pasa el centro de cada
  // cuadradito como "lugar a evitar" (acepta hasta 50)
  if (evitar && evitar.length) {
    var grandes = evitar.filter(function (a) { return a.length > 5; });
    var chicos = evitar.filter(function (a) { return a.length <= 5; });
    var vertices = 0;
    cuerpo.exclude_polygons = grandes.filter(function (a) { vertices += a.length; return vertices <= 100; });
    if (!cuerpo.exclude_polygons.length) delete cuerpo.exclude_polygons;
    // v72: sin repetir (varios cuadraditos del mismo lugar, a menos de 40 m, son uno solo): antes se mandaban
    // muchos casi iguales, se pasaba de 50 y se perdían los primeros (y el camino volvía a pasar por ahí)
    var lugaresEvitar = [];
    chicos.slice().reverse().forEach(function (anillo) {   // los más nuevos primero
      var p = L.latLng((anillo[0][1] + anillo[2][1]) / 2, (anillo[0][0] + anillo[2][0]) / 2);
      if (lugaresEvitar.length < 50 && !lugaresEvitar.some(function (q) { return q.distanceTo(p) < 40; })) lugaresEvitar.push(p);
    });
    if (lugaresEvitar.length) cuerpo.exclude_locations = lugaresEvitar.map(function (p) { return { lat: p.lat, lon: p.lng }; });
  }
  return conTiempoLimite('https://valhalla1.openstreetmap.de/route', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo)
  }, 30).then(function (r) {
    return r.json().then(function (d) {
      if (!r.ok) {
        var e = new Error('Valhalla ' + r.status);
        if (d && /no.*(path|route)|no suitable edges/i.test(d.error || '')) {
          e.mensaje = 'No encontré una ruta por donde pueda pasar tu camión entre esos dos puntos. ' +
                      'Probá con un punto de salida o llegada sobre una calle más grande.';
        }
        throw e;
      }
      return d;
    });
  }).then(function (d) {
    var viajes = [d.trip].concat((d.alternates || []).map(function (a) { return a.trip; }));
    return viajes.map(function (trip) {
      var pasos = [], puntos = [], vueltas = 0;
      trip.legs.forEach(function (leg) {
        var base = puntos.length;
        puntos = puntos.concat(decodificarPolilinea(leg.shape, 6));
        leg.maneuvers.forEach(function (m) {
          var esVuelta = [10, 11, 14, 15].indexOf(m.type) !== -1;   // derecha, cerrada der., cerrada izq., izquierda
          pasos.push({ texto: aCastellano(m.instruction), km: m.length, ini: base + (m.begin_shape_index || 0), vuelta: esVuelta });
          if (esVuelta) vueltas++;
        });
      });
      return { servicio: 'Valhalla (servicio de respaldo, menos confiable)', puntos: puntos,
               km: trip.summary.length, segundos: trip.summary.time, pasos: pasos, vueltas: vueltas, kmChicas: null };
    });
  });
}

// TomTom Routing (travelMode=truck): medidas del camión en el pedido. Lo que hay que esquivar va como rectángulos
// (TomTom acepta hasta 10): los cuadraditos cercanos se juntan en uno; las zonas de ordenanza, su rectángulo.
var VUELTAS_TOMTOM = { TURN_LEFT: 1, TURN_RIGHT: 1, SHARP_LEFT: 1, SHARP_RIGHT: 1, MAKE_UTURN: 1 };
function rectangulosTomTom(evitar) {
  var cajas = [];
  (evitar || []).slice().reverse().forEach(function (anillo) {   // los más nuevos primero
    var b = L.latLngBounds(anillo.map(function (q) { return [q[1], q[0]]; }));
    var junto = cajas.filter(function (c) { return c.pad(0.0).getCenter().distanceTo(b.getCenter()) < 300 && anillo.length <= 5; })[0];
    if (junto) junto.extend(b); else cajas.push(b);
  });
  return cajas.slice(0, 10).map(function (b) {
    return { southWestCorner: { latitude: b.getSouth(), longitude: b.getWest() },
             northEastCorner: { latitude: b.getNorth(), longitude: b.getEast() } };
  });
}
function rutaTomTom(evitar, a, b, conAlternativas) {
  a = a || ruta.desde.latlng; b = b || ruta.hasta.latlng;
  var q = 'key=' + encodeURIComponent(claveTomTom()) + '&travelMode=truck&vehicleCommercial=true' +
          '&vehicleWeight=' + Math.round(camion.peso * 1000) + '&vehicleHeight=' + camion.altura +
          '&vehicleLength=' + camion.largo + '&vehicleWidth=' + CAMION_ANCHO +
          '&instructionsType=text&language=es-ES&routeType=fastest&traffic=false' +
          (conAlternativas ? '&maxAlternatives=2' : '');
  var url = 'https://api.tomtom.com/routing/1/calculateRoute/' + a.lat.toFixed(6) + ',' + a.lng.toFixed(6) + ':' +
            b.lat.toFixed(6) + ',' + b.lng.toFixed(6) + '/json?' + q;
  var rect = rectangulosTomTom(evitar);
  var op = rect.length ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({ avoidAreas: { rectangles: rect } }) } : {};
  return conTiempoLimite(url, op, 30).then(function (r) {
    if (!r.ok) throw new Error('TomTom ' + r.status);
    return r.json();
  }).then(function (d) {
    if (!d.routes || !d.routes.length) throw new Error('TomTom sin ruta');
    return d.routes.map(function (rt) {
      var puntos = [];
      rt.legs.forEach(function (leg) { leg.points.forEach(function (p) { puntos.push([p.latitude, p.longitude]); }); });
      var ins = (rt.guidance && rt.guidance.instructions) || [], pasos = [], vueltas = 0;
      // a veces trae dos "Ha llegado" (uno antes de tiempo): queda solo el último
      ins = ins.filter(function (it, k) { return !/^ARRIVE/.test(it.maneuver || '') || k === ins.length - 1; });
      ins.forEach(function (it, k) {
        var sig = ins[k + 1], esVuelta = !!VUELTAS_TOMTOM[it.maneuver];
        if (esVuelta) vueltas++;
        pasos.push({ texto: aCastellano(String(it.message || '').replace(/^Salga de /, 'Salí por ')),
                     km: ((sig ? sig.routeOffsetInMeters : rt.summary.lengthInMeters) - (it.routeOffsetInMeters || 0)) / 1000,
                     ini: it.pointIndex != null ? Math.min(it.pointIndex, puntos.length - 1) : null, vuelta: esVuelta });
      });
      return { servicio: 'TomTom (camión)', puntos: puntos, km: rt.summary.lengthInMeters / 1000,
               segundos: rt.summary.travelTimeInSeconds, pasos: pasos, vueltas: vueltas, kmChicas: null };
    });
  });
}

// Formato "polyline" de Valhalla (6 decimales)
function decodificarPolilinea(texto, decimales) {
  var factor = Math.pow(10, decimales), i = 0, lat = 0, lng = 0, puntos = [];
  while (i < texto.length) {
    [0, 1].forEach(function (k) {
      var resultado = 0, corrimiento = 0, b;
      do { b = texto.charCodeAt(i++) - 63; resultado |= (b & 0x1f) << corrimiento; corrimiento += 5; } while (b >= 0x20);
      var delta = (resultado & 1) ? ~(resultado >> 1) : (resultado >> 1);
      if (k === 0) lat += delta; else lng += delta;
    });
    puntos.push([lat / factor, lng / factor]);
  }
  return puntos;
}

// --- Mostrar ---
function quitarLineasRuta() {
  ponerDatos('ruta', []);
  ruta.lineas = [];
  ruta.linea = null;
}

// Al cambiar las medidas, la ruta calculada (y su revisión) ya no vale: hay que calcularla de nuevo
function anularRutaCalculada() {
  if (nav.activo) terminarNavegacion('Cambiaste las medidas del camión: calculá la ruta de nuevo.');
  if (!ruta.opciones) return;
  ruta.numeroCalculo = (ruta.numeroCalculo || 0) + 1;   // descarta cálculos en curso
  quitarLineasRuta();
  ruta.opciones = null;
  if (ruta.desde && ruta.hasta) calcularRuta();   // con las medidas nuevas
}

function borrarRuta() {
  quitarLineasRuta();
  ruta.opciones = null;
  ruta.paradas.slice().forEach(function (c) { sacarParada(c, true); });
  ['desde', 'hasta'].forEach(function (cual) {
    if (ruta.marcas[cual]) ruta.marcas[cual].remove();
    ruta.marcas[cual] = null; ruta[cual] = null;
    var input = document.getElementById('ruta-' + cual);
    if (input) input.value = '';
  });
  var salida = document.getElementById('ruta-resultado');
  if (salida) { salida.hidden = true; salida.innerHTML = ''; }
  document.getElementById('borrar-ruta').hidden = true;
  modoResultado(false);
}

function mostrarRuta(indice, sinMoverMapa) {
  var opciones = ruta.opciones;
  var r = opciones[indice];
  ruta.elegida = indice;
  quitarLineasRuta();
  // la otra opción, en gris finito, para que se vea por dónde iría
  function linea(o, t) {
    return { type: 'Feature', properties: { t: t },
             geometry: { type: 'LineString', coordinates: o.puntos.map(function (q) { return [q[1], q[0]]; }) } };
  }
  var lineas = [];
  opciones.forEach(function (o, i) { if (i !== indice) lineas.push(linea(o, 'alt')); });
  lineas.push(linea(r, 'p'));
  ponerDatos('ruta', lineas);
  ruta.linea = r;
  document.getElementById('borrar-ruta').hidden = false;

  var avisos = r.avisos || [];
  var sinRevisar = r.sinRevisar && r.sinRevisar.length;
  // Arriba, lo importante (como Google Maps): cuánto tarda, si hay problemas y el botón para salir
  var html = '<div class="ruta-cabeza"><div class="ruta-tiempo"><b>' + duracion(r.segundos) + '</b><span>' +
             numero(r.km, 1) + ' km</span></div>' +
             '<button type="button" id="empezar-manejo" class="boton-ir">▶ Ir</button></div>';
  if (r.rojos) {
    html += '<div class="ruta-estado mal">⛔ Pasa por ' + r.rojos + (r.rojos === 1 ? ' lugar' : ' lugares') +
            ' donde NO pasás<small>No encontré otro camino. Probá salir o llegar por otro lado.</small></div>';
  } else if (sinRevisar) {
    html += '<div class="ruta-estado mal">⚠ No pude revisar parte de la ruta<small>No se cargaron los datos de ' +
            esc(r.sinRevisar.join(', ')) + ' (¿mala señal?). Volvé a intentar.</small></div>';
  } else if (avisos.length) {
    html += '<div class="ruta-estado ojo">⚠ ' + avisos.length + (avisos.length === 1 ? ' cosa' : ' cosas') +
            ' para mirar en el camino<small>Están abajo, en "Ver detalles".</small></div>';
  } else {
    html += '<div class="ruta-estado bien">✓ Sin problemas para tu camión</div>';
  }
  if (opciones.length > 1) {
    html += '<div class="ruta-opciones">';
    opciones.forEach(function (o, i) {
      html += '<button type="button" data-opcion="' + i + '" class="ruta-opcion' + (i === indice ? ' elegida' : '') + '">' +
              '<b>' + esc(o.etiqueta) + '</b>' + duracion(o.segundos) + ' · ' + numero(o.km, 1) + ' km</button>';
    });
    html += '</div>';
  }
  // Lo demás, escondido
  // abierto solo si hay lugares donde NO pasás (si no, la tarjeta tapaba medio mapa; lo demás se ve al tocar)
  html += '<details class="ruta-mas"' + (r.rojos ? ' open' : '') + '><summary>Ver detalles</summary>';
  if (avisos.length) {
    html += '<ul class="ruta-lista">';
    avisos.forEach(function (a, i) {
      html += '<li><button type="button" data-aviso="' + i + '"><i style="background:' + a.color + '"></i>' + esc(a.texto) + '</button></li>';
    });
    html += '</ul>';
  }
  r.controles = controlesEnRuta(r.puntos);
  if (r.controles.length) {
    html += '<details class="ruta-pasos"><summary>👮📷 Controles y radares (' + r.controles.length + ')</summary><ul class="ruta-lista">';
    r.controles.forEach(function (c, i) {
      var p = c.item.f.properties, tipo = CONTROLES[p.tipo] || CONTROLES.policial;
      var txt = tipo.nombre + (p.tipo === 'radar' && p.maxima ? ' (máx. ' + maximaCamion(p.maxima) + ' km/h)' : '') +
                (p.nombre && p.nombre !== tipo.nombre ? ': ' + p.nombre : '');
      html += '<li><button type="button" data-control="' + i + '"><span class="ruta-lista-icono">' + tipo.icono + '</span>' +
              esc(txt) + '</button></li>';
    });
    html += '</ul></details>';
  }
  r.lugares = lugaresEnRuta(r.puntos).slice(0, 250);
  if (r.lugares.length) {
    html += '<details class="ruta-pasos"><summary>⛽ Dónde cargar y parar en el camino (' + r.lugares.length + ')</summary>' +
            '<ul class="ruta-lista">';
    r.lugares.forEach(function (x, i) {
      var p = x.l.feature.properties, tipo = LUGAR_POR_ID[p.tipo];
      var extra = [];
      if (p.camiones) extra.push('para camiones');
      if (p.extras && p.extras.indexOf('gasoil') !== -1) extra.push('gasoil');
      html += '<li><button type="button" data-lugar="' + i + '"><span class="ruta-lista-icono">' + tipo.icono + '</span>' +
              '<span class="ruta-lugar-km">km ' + Math.round(x.km) + '</span> ' +
              esc(p.nombre || tipo.uno) + (extra.length ? ' <small>' + esc(extra.join(' · ')) + '</small>' : '') + '</button></li>';
    });
    html += '</ul></details>';
  }
  if (r.pasos.length) {
    html += '<details class="ruta-pasos"><summary>Indicaciones (' + r.pasos.length + ')</summary><ol>';
    r.pasos.forEach(function (p) {
      html += '<li>' + esc(p.texto) + (p.km ? ' <small>' + (p.km < 1 ? Math.round(p.km * 1000) + ' m' : numero(p.km, 1) + ' km') + '</small>' : '') + '</li>';
    });
    html += '</ol></details>';
  }
  html += '<p class="panel-nota">' + (r.esquivados ? 'Esquivé ' + r.esquivados + (r.esquivados === 1 ? ' lugar' : ' lugares') +
          ' donde tu camión no pasa. ' : '') + resumenFacilidad(r) + '. Tiempo de auto: con camión puede ser más. ' +
          'Calculada por ' + esc(r.servicio) + ' con tus medidas (' + metros(camion.altura) + ', ' + toneladas(camion.peso) +
          ', ' + metros(camion.largo) + '). Respetá siempre la señalización.</p></details>';
  var salida = document.getElementById('ruta-resultado');
  salida.innerHTML = html;
  document.getElementById('empezar-manejo').addEventListener('click', function () { empezarNavegacion(); });
  salida.querySelectorAll('[data-opcion]').forEach(function (b) {
    b.addEventListener('click', function () { mostrarRuta(+b.getAttribute('data-opcion'), true); });
  });
  salida.querySelectorAll('[data-aviso]').forEach(function (b) {
    b.addEventListener('click', function () {
      var a = avisos[+b.getAttribute('data-aviso')];
      abrirPanelRuta(false);
      mapa.setView(a.latlng, Math.max(mapa.getZoom(), 17));
      if (a.capa) abrirCartelDeCapa(a.capa, a.latlng);
    });
  });
  salida.querySelectorAll('[data-lugar]').forEach(function (b) {
    b.addEventListener('click', function () {
      var l = r.lugares[+b.getAttribute('data-lugar')].l;
      abrirPanelRuta(false);
      mapa.setView(l.getLatLng(), Math.max(mapa.getZoom(), 16));
      abrirCartelLugar(l);
    });
  });
  salida.querySelectorAll('[data-control]').forEach(function (b) {
    b.addEventListener('click', function () {
      var it = r.controles[+b.getAttribute('data-control')].item;
      abrirPanelRuta(false);
      mapa.setView(it.latlng, Math.max(mapa.getZoom(), 15));
      abrirCartelControl(it);
    });
  });
  if (sinMoverMapa) return;
  var lim = L.latLngBounds([]);
  opciones.forEach(function (o) { lim.extend(L.latLngBounds(o.puntos)); });
  // que la ruta no quede tapada por la tarjeta de abajo (celular) o por el panel de la izquierda (PC)
  if (window.innerWidth <= 600) mapa.fitBounds(lim, { paddingTopLeft: [20, 30], paddingBottomRight: [20, (panelRuta.offsetHeight || 0) + 20] });
  else mapa.fitBounds(lim, { paddingTopLeft: [(panelRuta.offsetWidth || 0) + 30, 30], paddingBottomRight: [30, 30] });
}

// "6 vueltas · 69% por red de tránsito pesado · 0,5 km por calles chicas"
function resumenFacilidad(o) {
  var partes = [o.vueltas + (o.vueltas === 1 ? ' vuelta' : ' vueltas')];
  if (o.kmZonaConRed > 0.5) partes.push(Math.round(100 * o.kmEnRed / o.kmZonaConRed) + '% por red de tránsito pesado');
  if (o.kmChicas != null) partes.push(o.kmChicas < 0.05 ? 'sin calles chicas' : numero(o.kmChicas, 1) + ' km por calles chicas');
  return esc(partes.join(' · '));
}

function duracion(seg) {
  var min = Math.round(seg / 60);
  if (min < 60) return min + ' min';
  return Math.floor(min / 60) + ' h ' + ('0' + (min % 60)).slice(-2) + ' min';
}

// --- Red de tránsito pesado (calles marcadas para camiones) ---
// Se dibuja en verde y se usa para elegir el camino más fácil.
var redPesada = { grupo: null, grilla: null, zonas: [], km: 0 };

function agregarRedPesada(r) {
  if (!r.red || !r.red.features.length) return;
  var features = r.red.features;
  if (r.zona.limites) redPesada.zonas.push(L.latLngBounds(r.zona.limites));
  redPesada.km += r.zona.red_km || 0;
  if (!redPesada.grupo) {
    redPesada.grupo = { lineas: [] };   // lo que se dibuja (en verde, abajo de todo: capa 'red-pesada')
    redPesada.grilla = {};
    redPesada.cerca = function (ll, metrosMax) {   // ll = [lat, lng]
      var p = [ll[1] * RED_KX, ll[0] * RED_KY], gx = Math.floor(p[0] / RED_C), gy = Math.floor(p[1] / RED_C);
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
        var s = redPesada.grilla[(gx + dx) + ',' + (gy + dy)];
        if (!s) continue;
        for (var k = 0; k < s.length; k++) {
          var a = s[k][0], b = s[k][1], vx = b[0] - a[0], vy = b[1] - a[1];
          var t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1)));
          if (Math.hypot(a[0] + t * vx - p[0], a[1] + t * vy - p[1]) < metrosMax) return true;
        }
      }
      return false;
    };
  }
  // Todos los tramos de la zona como UNA sola línea de muchas partes: con miles de líneas sueltas
  // el mapa tardaba bastante más en redibujarse en cada zoom (la red no se toca, así que da igual)
  var partes = [];
  features.forEach(function (f) {
    var g = f.geometry;
    if (g.type === 'LineString') partes.push(g.coordinates);
    else if (g.type === 'MultiLineString') partes = partes.concat(g.coordinates);
  });
  redPesada.grupo.lineas.push({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: partes } });
  ponerDatos('red', redPesada.grupo.lineas);
  // grilla de 50 m para buscar rápido si un punto está sobre la red
  var grilla = redPesada.grilla;
  features.forEach(function (f) {
    var c = f.geometry.coordinates;
    for (var i = 1; i < c.length; i++) {
      var a = [c[i - 1][0] * RED_KX, c[i - 1][1] * RED_KY], b = [c[i][0] * RED_KX, c[i][1] * RED_KY];
      for (var gx = Math.floor(Math.min(a[0], b[0]) / RED_C); gx <= Math.floor(Math.max(a[0], b[0]) / RED_C); gx++) {
        for (var gy = Math.floor(Math.min(a[1], b[1]) / RED_C); gy <= Math.floor(Math.max(a[1], b[1]) / RED_C); gy++) {
          (grilla[gx + ',' + gy] = grilla[gx + ',' + gy] || []).push([a, b]);
        }
      }
    }
  });
}
var RED_C = 50, RED_KX = 111320 * Math.cos(-35 * Math.PI / 180), RED_KY = 110540;

// --- Revisar la ruta contra nuestros datos ---
// Puntos (pasos bajos, alturas puntuales, reportes): a menos de 20 m de la ruta.
// Líneas rojas o amarillas: que la ruta vaya por encima al menos 30 m (no solo que las cruce).
function revisarRuta(puntosRuta, pasos) {
  // nombres de calles por las que va la ruta (para saber si va POR DEBAJO de un puente o por arriba)
  var textoPasos = normalizarCalle((pasos || []).map(function (p) { return p.texto; }).join(' | '));
  var desde = ruta.desde && ruta.desde.latlng, hasta = ruta.hasta && ruta.hasta.latlng;
  function cercaDeLosExtremos(ll) {
    return (desde && desde.distanceTo(ll) < 30) || (hasta && hasta.distanceTo(ll) < 30);
  }
  var lat0 = puntosRuta[0][0] * Math.PI / 180;
  var kx = Math.cos(lat0) * 111320, ky = 110540;
  function xy(ll) { return [ll[1] * kx, ll[0] * ky]; }
  // Grilla de 50 m con los tramos de la ruta: buscar el tramo más cercano mira solo 9 casilleros
  // (antes se recorría la ruta entera por cada muestra y en rutas largas podía trabar el celular)
  var C = 50, grilla = {};
  for (var i = 1; i < puntosRuta.length; i++) {
    var a0 = xy(puntosRuta[i - 1]), b0 = xy(puntosRuta[i]);
    for (var gx = Math.floor(Math.min(a0[0], b0[0]) / C); gx <= Math.floor(Math.max(a0[0], b0[0]) / C); gx++) {
      for (var gy = Math.floor(Math.min(a0[1], b0[1]) / C); gy <= Math.floor(Math.max(a0[1], b0[1]) / C); gy++) {
        (grilla[gx + ',' + gy] = grilla[gx + ',' + gy] || []).push(i - 1);
      }
    }
  }
  // tramo más cercano de la ruta (hasta ~50 m): { d: metros, i: índice del tramo }
  function distRuta(p) {
    var mejor = { d: Infinity, i: -1 }, gx = Math.floor(p[0] / C), gy = Math.floor(p[1] / C);
    for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
      var lista = grilla[(gx + dx) + ',' + (gy + dy)];
      if (!lista) continue;
      for (var k = 0; k < lista.length; k++) {
        var j = lista[k], a = xy(puntosRuta[j]), b = xy(puntosRuta[j + 1]);
        var vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
        var t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2)) : 0;
        var d = Math.hypot(a[0] + t * vx - p[0], a[1] + t * vy - p[1]);
        if (d < mejor.d) mejor = { d: d, i: j };
      }
    }
    return mejor;
  }
  // rectángulo de la ruta agrandado 40 m (antes era un 2%: en una ruta recta quedaba de pocos metros)
  var caja0 = L.latLngBounds(puntosRuta);
  var caja = L.latLngBounds([caja0.getSouth() - 40 / ky, caja0.getWest() - 40 / kx], [caja0.getNorth() + 40 / ky, caja0.getEast() + 40 / kx]);
  function claveCuadrado(ll) { return 'q' + ll.lat.toFixed(5) + ',' + ll.lng.toFixed(5); }

  var avisos = [];
  function revisarCapa(grupo, esReporte) {
    if (!grupo) return;
    grupo.eachLayer(function (l) {
      var p = l.feature.properties;
      var estado = esReporte ? 'reporte' : evaluar(p).estado;
      if (estado !== 'no' && estado !== 'sin_dato' && estado !== 'reporte') return;
      // reportes aprobados que cierran el paso: cuentan como rojos (se esquivan y castigan la ruta)
      var bloquea = esReporte && /prohibid|peso|cortad|obra|puente|paso bajo/i.test(p.tipo || '');
      var rojo = estado === 'no' || bloquea;
      var color = estado === 'no' ? COLORES.no : estado === 'reporte' ? '#e65100' : COLORES.sin_dato;
      var texto = esReporte ? 'Reporte de un chofer: ' + p.tipo
        : (estado === 'no' ? 'NO PASÁS: ' : 'Verificar: ') + (p.norma ? p.titulo : (p.capa === 'barrera' || p.capa === 'obra' || p.capa === 'corte' ? p.titulo + (p.capa === 'corte' ? ' (en vivo)' : '') : textoValor(p)) + (p.calle ? ' — ' + p.calle : ''));
      // lo que dice la voz durante la navegación
      var voz = esReporte ? 'reporte de un chofer: ' + p.tipo
        : (p.titulo || textoValor(p)).replace(/^./, function (c) { return c.toLowerCase(); }) +
          (p.calle && !p.norma ? (p.capa === 'corte' ? ', ' : ' en ') + p.calle : '') + (estado === 'no' ? '. Tu camión no pasa' : '. Verificá en el lugar');
      var esquivar = rojo;
      function agregar(extra) {
        avisos.push(Object.assign({ voz: voz, texto: texto, color: color, rojo: rojo, capa: l, zonas: null, zonasClaves: null }, extra));
      }

      if (l.feature.geometry.type === 'Polygon') {   // zona entera
        if (!caja.intersects(l.getBounds())) return;
        var anillo = l.feature.geometry.coordinates[0];
        var primero = -1;
        for (var q = 0; q < puntosRuta.length; q++) {
          if (dentroDeAnillo([puntosRuta[q][1], puntosRuta[q][0]], anillo)) { primero = q; break; }
        }
        if (primero < 0) return;
        var extremoAdentro = [desde, hasta].some(function (x) { return x && dentroDeAnillo([x.lng, x.lat], anillo); });
        var clave = 'zona#' + L.stamp(l);
        agregar({ texto: texto + (extremoAdentro ? (p.largo_desde ? ' (tu salida o llegada está adentro: con tu camión no entrás, buscá dónde dejarlo afuera)' : ' (tu salida o llegada está adentro: necesitás permiso municipal)') : ''),
                  latlng: L.latLng(puntosRuta[primero]), orden: primero,   // donde la ruta ENTRA a la zona
                  clave: clave, zonas: esquivar && !extremoAdentro ? [anillo] : null, zonasClaves: [clave] });
        return;
      }

      if (l.getLatLng) {   // punto
        var ll = l.getLatLng();
        if (!caja.contains(ll)) return;
        var cerca = distRuta(xy([ll.lat, ll.lng]));
        // una barrera (pilotes, portón) cuenta solo si está SOBRE la ruta: si está en la calle de al lado,
        // a pocos metros de la esquina, no molesta (y esquivarla cerraría la esquina)
        var esBarrera = p.capa === 'barrera';
        if (cerca.d > (esBarrera ? 4 : 20)) return;
        var claveP = (p.osm || '') + '@' + ll.lat.toFixed(5) + ',' + ll.lng.toFixed(5);
        // Paso bajo: si en las indicaciones no aparece la calle de abajo, lo más probable es que la ruta vaya
        // por el puente de arriba. Si es amarillo no se avisa (si no, cada autopista avisaría decenas);
        // si es ROJO se avisa igual como "posible", pero no se esquiva (esquivarlo cerraría el puente).
        // Lo mismo con un punto de altura / peso cargado en una calle que la ruta cruza por arriba o por al lado.
        if (!esReporte && p.calle && !esBarrera && p.capa !== 'corte' && textoPasos &&
            (/debajo/i.test(p.detalle || '') || /^(altura|peso|largo|prohibido|verificar|verificar_autopista)$/.test(p.capa)) &&
            textoPasos.indexOf(normalizarCalle(p.calle)) === -1) {
          if (!rojo) return;
          // no cuenta como rojo (no dispara el "CUIDADO" ni descarta la ruta): es un aviso para mirar
          var deAltura = p.capa === 'altura' || /debajo/i.test(p.detalle || '');
          agregar({ texto: 'Posible: ' + texto + (deAltura ? ' (si la ruta pasa por abajo)' : ' (si vas por esa calle)'),
                    rojo: false, posible: true,
                    voz: deAltura ? 'posible paso bajo de ' + textoValor(p).replace(/^Altura máxima( \(paso bajo\))? /i, '') +
                                    ' en ' + p.calle + ', si pasás por abajo'
                                  : voz.replace(/\. Tu camión no pasa$/, '') + ', si vas por esa calle',
                    latlng: ll, orden: cerca.i, clave: claveP });
          return;
        }
        var cl = claveCuadrado(ll);
        agregar({ latlng: ll, orden: cerca.i, clave: claveP,
                  zonas: esquivar && !cercaDeLosExtremos(ll) ? [cuadrado(ll, esBarrera ? 4 : 12)] : null, zonasClaves: [cl] });
        return;
      }

      // línea: medir cuánto de la línea va POR la ruta (no solo cruzarla)
      if (!caja.intersects(l.getBounds())) return;
      var partes = l.getLatLngs();
      if (partes.length && !Array.isArray(partes[0])) partes = [partes];
      // muestras cada 5 m a lo largo de la línea; cada una cerca de la ruta suma 5 m "por encima".
      // Cruzarla en una esquina da ~20 m; ir por ella, mucho más.
      var encima = 0, largoTotal = 0, ordenMin = Infinity, zonas = [], claves = [], ultimo = null;
      partes.forEach(function (linea) {
        for (var k = 1; k < linea.length; k++) {
          var a = xy([linea[k - 1].lat, linea[k - 1].lng]), b = xy([linea[k].lat, linea[k].lng]);
          var largo = Math.hypot(b[0] - a[0], b[1] - a[1]);
          largoTotal += largo;
          var n = Math.max(1, Math.round(largo / 5));
          for (var m = 0; m < n; m++) {
            var mq = [a[0] + (b[0] - a[0]) * (m + 0.5) / n, a[1] + (b[1] - a[1]) * (m + 0.5) / n];
            var dq = distRuta(mq);
            if (dq.d > 10) continue;
            encima += largo / n;
            if (dq.i < ordenMin) ordenMin = dq.i;
            var llq = L.latLng(mq[1] / ky, mq[0] / kx);
            // un cuadradito cada ~20 m de la parte que la ruta usa
            if (esquivar && (!ultimo || ultimo.distanceTo(llq) >= 20) && !cercaDeLosExtremos(llq)) {
              zonas.push(cuadrado(llq, 12)); claves.push(claveCuadrado(llq)); ultimo = llq;
            }
          }
        }
      });
      // tramos cortos (por ejemplo, el pedacito de calle bajo un puente): alcanza con el 80% de su largo
      if (encima < Math.min(40, Math.max(8, 0.8 * largoTotal))) return;
      // Calle paralela pegada (ej.: el Paseo del Bajo al lado de Alicia Moreau de Justo, o una colectora): si la
      // calle restringida tiene nombre y ese nombre no aparece en NINGUNA indicación de la ruta, lo más probable es
      // que la ruta vaya por la de al lado. Si es rojo se avisa como "posible" (sin esquivarlo); si no, nada.
      if (!esReporte && p.capa !== 'corte' && p.calle && textoPasos && !/^(Entre|Calle|Avenida)$/i.test(p.calle) &&
          textoPasos.indexOf(normalizarCalle(p.calle)) === -1) {
        if (!rojo) return;
        agregar({ texto: 'Posible: ' + texto + ' (si vas por esa calle; la ruta parece ir por una paralela)', rojo: false,
                  posible: true, voz: voz.replace(/\. Tu camión no pasa$/, '') + ', si vas por esa calle',
                  latlng: L.latLng(puntosRuta[ordenMin]), orden: ordenMin, clave: (p.osm || '') + '#' + L.stamp(l) });
        return;
      }
      agregar({ latlng: L.latLng(puntosRuta[ordenMin]), orden: ordenMin,   // donde la ruta EMPIEZA a usarla
                clave: (p.osm || '') + '#' + L.stamp(l), zonas: esquivar ? zonas : null, zonasClaves: esquivar ? claves : null });
    });
  }
  CAPAS.forEach(function (c) {
    if (c.id === 'sin_salida') return;   // la ruta no entra a una calle sin salida salvo que sea el destino
    revisarCapa(grupos[c.id], false);
  });
  revisarCapa(grupoReportes, true);
  // primero lo que no pasás; después en el orden en que aparecen sobre la ruta
  avisos.sort(function (a, b) { return (a.rojo ? 0 : 1) - (b.rojo ? 0 : 1) || a.orden - b.orden; });
  return avisos;
}

// ¿El punto [lng, lat] está dentro del anillo [[lng, lat], ...]? (regla par-impar)
function dentroDeAnillo(pt, anillo) {
  var x = pt[0], y = pt[1], dentro = false;
  for (var i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    var xi = anillo[i][0], yi = anillo[i][1], xj = anillo[j][0], yj = anillo[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function normalizarCalle(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(avenida|av\.?|calle|pasaje|boulevard|bv\.?|autopista|intendente|int\.?|coronel|cnel\.?|general|gral\.?|doctor|dr\.?|presidente|pres\.?|ingeniero|ing\.?|teniente|tte\.?|almirante|alte\.?)\s+/g, '')
    .replace(/\s+/g, ' ').trim();
}

// ===== 10. Utilidades =====
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function numero(n, maxDecimales, minDecimales) {
  return Number(n).toLocaleString('es-AR', {
    minimumFractionDigits: minDecimales == null ? maxDecimales : minDecimales,
    maximumFractionDigits: maxDecimales
  });
}
function metros(n) { return numero(n, 2) + ' m'; }
function toneladas(n) { return numero(n, 1, 0) + ' t'; }

function fecha(iso) {
  var p = String(iso || '').split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}

function mostrarMensaje(texto, esError) {
  var m = document.getElementById('mensaje');
  m.textContent = texto;
  m.className = 'mensaje' + (esError ? ' error' : '');
  m.hidden = false;
}
function ocultarMensaje() { document.getElementById('mensaje').hidden = true; }

// Guardar en el teléfono (si el navegador no deja, la página igual funciona mientras esté abierta)
function leerGuardado(clave) {
  try { return JSON.parse(localStorage.getItem(clave)); } catch (e) { return null; }
}
function guardar(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* sin guardar */ }
}

// ===== 12. Navegación por voz ("Manejar con voz") =====
// Sigue al GPS sobre la ruta elegida, muestra la próxima indicación arriba y la dice en voz alta.
// Avisa los pasos bajos / reportes que vienen, recalcula si te salís y mantiene la pantalla prendida.
var nav = {
  activo: false, r: null, acum: [], idx: 0, maniobras: [], avisos: [], dichos: {},
  fuera: 0, ultimoRecalculo: 0, recalculando: false, wake: null, voz: true, ultimaPos: null
};
var NAV = {
  FUERA_DE_RUTA_M: 60,      // más lejos que esto de la ruta = te saliste
  FUERA_VECES: 3,           // ...durante 3 posiciones seguidas
  RECALCULO_CADA_S: 30,
  PRIMER_AVISO_M: 600, ULTIMO_AVISO_M: 80, AVISO_PELIGRO_M: 400, LLEGADA_M: 35
};

try { nav.voz = leerGuardado('mapa-camiones:voz') !== false; } catch (e) { /* sin guardar */ }
// "Rumbo arriba": al manejar, el mapa gira para que lo de adelante quede arriba (como los GPS)
// v67: "rumbo2" = de nuevo girando hacia donde vas para todos (como Google Maps); el botón 🧭 lo cambia
nav.rumbo = PUEDE_GIRAR && leerGuardado('mapa-camiones:rumbo2') !== false;

// Hacia dónde va la ruta en este punto (grados desde el norte), mirando ~40 m hacia adelante
function rumboEnRuta(u) {
  // desde donde estás sobre la ruta (no desde el principio del tramo: justo en una esquina miraba para atrás)
  var a = puntoEnRuta(u.recorrido != null ? u.recorrido : nav.acum[u.idx]), b = puntoEnRuta((u.recorrido != null ? u.recorrido : nav.acum[u.idx]) + 40);
  return Math.atan2((b.lng - a.lng) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 180 / Math.PI;
}
// El punto de la ruta a tantos metros de la salida
function puntoEnRuta(m) {
  var pts = nav.r.puntos, ac = nav.acum, i = 1;
  if (m <= 0) return L.latLng(pts[0]);
  while (i < pts.length - 1 && ac[i] < m) i++;
  var t = Math.max(0, Math.min(1, (m - ac[i - 1]) / ((ac[i] - ac[i - 1]) || 1)));
  return L.latLng(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t);
}
function cambiarRumbo(prender) {
  nav.rumbo = PUEDE_GIRAR && prender;
  guardar('mapa-camiones:rumbo2', nav.rumbo);
  ponerRumboBoton();
  if (!nav.rumbo) girarA(0);
  else if (nav.activo && nav.ultimaPos) { nav.ultimoRumbo = null; seguirNavegacion(nav.ultimaPos); }
  mostrarMensaje(nav.rumbo ? 'El mapa gira hacia donde vas.' : 'Norte arriba: el mapa queda fijo.');
  setTimeout(ocultarMensaje, 2500);
}
function ponerRumboBoton() {
  var b = document.getElementById('nav-rumbo');
  if (!b) return;
  b.hidden = !PUEDE_GIRAR;
  b.classList.toggle('apagado', !nav.rumbo);
  b.setAttribute('aria-label', nav.rumbo ? 'Poner el norte arriba' : 'Que el mapa gire hacia donde vas');
  b.title = nav.rumbo ? 'El mapa gira hacia donde vas (tocá para norte arriba)' : 'Norte arriba (tocá para que gire hacia donde vas)';
}

// Voz. El 19/11/2026 el chofer probó dos veces en la calle y no habló nada. Cuidados:
// - "cancel()" seguido enseguida de "speak()" a veces se traga la frase nueva (Chrome en Android): si había algo
//   hablando, se corta y la frase nueva sale 150 ms después; si no había nada, no se llama a cancel().
// - la frase se guarda en una variable (si no, el navegador puede tirarla antes de decirla y no suena).
// - si quedó en pausa (la app estuvo en segundo plano), se reanuda.
// - PLAN B: hay teléfonos que se quedan callados si se les pide una voz o un idioma que no tienen bien instalado.
//   Si la primera frase no empieza en 3 s, se repite SIN elegir voz (la del teléfono) y, si así anda, queda
//   recordado ("mapa-camiones:voz-modo"). Si tampoco, se avisa en pantalla qué revisar.
// - Algunos navegadores no tienen voz (el que se abre dentro de WhatsApp o Facebook): se avisa que abra en Chrome.
// - Botón "Probar la voz" (en Qué mostrar): habla y dice en pantalla qué pasó (para saber qué falla).
var voz = { frases: [], probada: false, avisada: false, modo: leerGuardado('mapa-camiones:voz-modo') || 'elegida' };
if (window.speechSynthesis) {
  try {
    window.speechSynthesis.getVoices();   // en Android la lista llega después: se pide al abrir
    window.speechSynthesis.addEventListener('voiceschanged', function () { window.speechSynthesis.getVoices(); });
  } catch (e) { /* nada */ }
}
function hayVoz() { return !!(window.speechSynthesis && window.SpeechSynthesisUtterance); }
// ¿la página se abrió dentro de otra app (WhatsApp, Facebook, Instagram...)? Esos navegadores no hablan
function navegadorDeApp() { return /; wv\)|FBAN|FBAV|Instagram|WhatsApp|Line\//i.test(navigator.userAgent || ''); }
function vocesDelTelefono() {
  try { return window.speechSynthesis.getVoices() || []; } catch (e) { return []; }
}
function vozEnEspanol() {
  var voces = vocesDelTelefono();
  return voces.filter(function (x) { return /^es(-|_)(AR|419|US|MX)/i.test(x.lang); })[0] ||
         voces.filter(function (x) { return /^es/i.test(x.lang); })[0] || null;
}
function textoSinVoz() {
  return 'Este navegador no puede hablar' + (navegadorDeApp() ? ' (se abrió dentro de otra app, como WhatsApp)' : '') +
         '. Abrí el mapa en Chrome: tocá ⋮ arriba a la derecha → "Abrir en Chrome".';
}
function avisarVozFalla(motivo) {
  if (voz.avisada || !nav.activo) return;
  voz.avisada = true;
  mostrarMensaje(hayVoz()
    ? '🔇 El teléfono no está hablando' + (motivo ? ' (' + motivo + ')' : '') + '. Subí el volumen "multimedia" y ' +
      'revisá que tenga la voz en español (Ajustes → Texto a voz). Las indicaciones siguen en el cartel verde.'
    : '🔇 ' + textoSinVoz() + ' Las indicaciones siguen en el cartel verde.', true);
  setTimeout(ocultarMensaje, 15000);
}
// Arma una frase según el modo: 'elegida' = una voz en español del teléfono; 'telefono' = la que el teléfono use
function armarFrase(texto, modo) {
  var u = new SpeechSynthesisUtterance(texto);
  if (modo === 'elegida') {
    u.lang = 'es-AR';
    var v = vozEnEspanol();
    if (v) { u.voice = v; u.lang = v.lang; }
  }
  u.rate = 1;
  u.volume = 1;
  voz.frases.push(u);
  if (voz.frases.length > 8) voz.frases.shift();
  return u;
}
// Dice una frase. alFin(ok, detalle) se llama una vez: ok = empezó a hablar.
function decirFrase(texto, urgente, alFin) {
  var s = window.speechSynthesis, listo = false;
  function fin(ok, detalle) { if (!listo) { listo = true; if (alFin) alFin(ok, detalle); } }
  function intentar(modo, esReintento) {
    var u = armarFrase(texto, modo), empezo = false;
    u.onstart = function () {
      empezo = true;
      voz.probada = true;
      if (esReintento && voz.modo !== modo) { voz.modo = modo; guardar('mapa-camiones:voz-modo', modo); }   // así anda
      fin(true, modo);
    };
    u.onend = function () { if (!empezo) { empezo = true; voz.probada = true; fin(true, modo); } };
    u.onerror = function (ev) {
      var err = ev && ev.error;
      if (err === 'interrupted' || err === 'canceled') return;   // la cortó otra frase: normal
      if (!esReintento && modo === 'elegida') { intentar('telefono', true); return; }
      fin(false, err === 'not-allowed' ? 'el navegador no lo dejó' : err);
    };
    // no empezó en 3 s: plan B (sin elegir voz). Si tampoco, falla.
    setTimeout(function () {
      if (empezo || listo) return;
      if (!esReintento && modo === 'elegida' && !voz.probada) { try { s.cancel(); } catch (e) { /* nada */ } intentar('telefono', true); }
      else if (!voz.probada) fin(false, null);
    }, 3000);
    try {
      var ocupado = s.speaking || s.pending;
      if (urgente && ocupado) s.cancel();
      if (s.paused) s.resume();
      if (urgente && ocupado) setTimeout(function () { s.speak(u); }, 150); else s.speak(u);
    } catch (e) { fin(false, e.message); }
  }
  intentar(voz.modo, voz.modo !== 'elegida');
}
// Indicaciones de los servicios de ruta: vienen "de usted" y con palabras de España ("Gire a la izquierda").
// Se pasan a como se habla acá ("Doblá a la izquierda"). Se respeta la mayúscula inicial.
// (las palabras se buscan enteras: antes y después no puede haber una letra, también con acento)
var A_CASTELLANO = [
  ['gire bruscamente', 'doblá cerrado'],
  ['gire ligeramente', 'doblá levemente'],
  ['gire', 'doblá'],
  ['continúe', 'seguí'],
  ['siga', 'seguí'],
  ['manténgase', 'mantenete'],
  ['mantenga', 'mantenete'],
  ['tome', 'tomá'],
  ['entre en', 'entrá en'],
  ['salga', 'salí'],
  ['diríjase', 'andá'],
  ['conduzca', 'andá'],
  ['incorpórese', 'incorporate'],
  ['haga un cambio de sentido', 'pegá la vuelta'],
  ['haga', 'hacé'],
  ['dé la vuelta', 'pegá la vuelta'],
  ['su destino', 'tu destino'],
  ['ha llegado', 'llegaste']
].map(function (r) { return [new RegExp('(^|[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ])(' + r[0] + ')(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ])', 'gi'), r[1]]; });
function aCastellano(texto) {
  var t = String(texto || '');
  A_CASTELLANO.forEach(function (r) {
    t = t.replace(r[0], function (todo, antes, m) {
      return antes + (m.charAt(0) !== m.charAt(0).toLowerCase() ? r[1].charAt(0).toUpperCase() + r[1].slice(1) : r[1]);
    });
  });
  return t;
}
// Para la voz: abreviaturas y unidades dichas enteras ("6 t" → "6 toneladas", "4,10 m" → "4 coma 10 metros")
function paraDecir(texto) {
  return String(texto)
    // códigos de caminos rurales ("Camino viejo a Miramar/045-01. Seguí en 045-01."): no se leen
    .replace(/\s*Seguí en \d{3}-\d{2}\.?/g, '')
    .replace(/\s*\/\s*\d{3}-\d{2}\b/g, '')
    .replace(/\s*\/\s*/g, ' o ')
    .replace(/\bAv(da)?\.\s*/g, 'Avenida ')
    .replace(/\bRN ?(\d+)/g, 'ruta nacional $1')
    .replace(/\bRP ?(\d+)/g, 'ruta provincial $1')
    .replace(/(\d) ?km\b/g, '$1 kilómetros')
    .replace(/(\d) ?t\b/g, '$1 toneladas')
    .replace(/(\d) ?m\b/g, '$1 metros')
    .replace(/(\d+),(\d+)/g, '$1 coma $2')
    .replace(/\s+/g, ' ');
}
// ===== Voz grabada (20/11/2026) =====
// En el iPhone con el silencio puesto, Safari NO deja sonar la voz del teléfono (speechSynthesis), pero sí los
// sonidos comunes (por eso se escuchaba el pitido y no las indicaciones). La "voz grabada" son frases cortas
// grabadas de antemano (voz/*.wav, scripts/grabar_voz.ps1) que se encadenan: "En 300 metros" + "doblá a la
// derecha". No dice nombres de calles (están en el cartel verde). En el iPhone es la voz por defecto.
// Se usa SIEMPRE el mismo reproductor: el iPhone solo deja sonar sin tocar la pantalla a un reproductor que ya
// sonó una vez después de un toque (el pitido de "▶ Ir" o de "Probar la voz").
var ES_IPHONE = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
voz.motor = leerGuardado('mapa-camiones:voz-motor') || (ES_IPHONE ? 'grabada' : 'telefono');
var grabada = { el: null, cola: [], sonando: false, bajadas: false };
function reproductor() {
  if (!grabada.el) {
    grabada.el = new Audio();
    grabada.el.preload = 'auto';
    grabada.el.addEventListener('ended', siguienteGrabada);
    grabada.el.addEventListener('error', function () { setTimeout(siguienteGrabada, 50); });
  }
  return grabada.el;
}
function siguienteGrabada() {
  var url = grabada.cola.shift();
  if (!url) { grabada.sonando = false; return; }
  grabada.sonando = true;
  var a = reproductor();
  sesionDeAudio();
  a.src = url;
  try {
    var p = a.play();
    if (p && p.catch) p.catch(function (e) {
      if (e && e.name === 'AbortError') return;   // se cambió el sonido antes de empezar: normal
      grabada.sonando = false;
      grabada.cola = [];
      avisarVozFalla('el teléfono no dejó reproducir el sonido');
    });
  } catch (e) { grabada.sonando = false; }
}
// urgente: se descarta lo que estaba esperando (lo que está sonando termina)
function sonar(urls, urgente) {
  if (!urls.length) return;
  if (urgente) grabada.cola = [];
  grabada.cola = grabada.cola.concat(urls);
  if (!grabada.sonando) siguienteGrabada();
}
// Baja todas las frases una vez (quedan guardadas: sirven sin señal)
function bajarVozGrabada() {
  if (grabada.bajadas) return;
  grabada.bajadas = true;
  fetch('voz/frases.json').then(function (r) { return r.json(); }).then(function (lista) {
    lista.forEach(function (k, i) { setTimeout(function () { fetch('voz/' + k + '.wav').catch(function () {}); }, i * 40); });
  }).catch(function () { grabada.bajadas = false; });
}
// Distancia dicha ("300 metros", "1 coma 5 kilómetros") → grabación "En 300 metros"
function clipDistancia(t) {
  var m = /(\d+) metros/.exec(t);
  if (m) {
    var n = +m[1];
    n = n < 100 ? Math.max(30, Math.min(90, Math.round(n / 10) * 10)) : Math.min(1000, Math.round(n / 50) * 50);
    return 'd_' + n;
  }
  var k = /(\d+)(?: coma (\d))? kilómetros/.exec(t);
  if (k && +k[1] + (k[2] ? +k[2] / 10 : 0) < 1.3) return 'd_1k';
  return 'd_mas';
}
// Qué peligro es, por las palabras de la frase
function clipPeligro(t) {
  t = t.toLowerCase();
  var vel = /máxima (\d+)/.exec(t), clipVel = vel && +vel[1] >= 20 && +vel[1] <= 130 && +vel[1] % 10 === 0 ? 'v_' + vel[1] : null;
  if (/radar/.test(t)) return clipVel ? ['h_radar', clipVel] : ['h_radar'];
  if (/cámara de semáforo|camara de semaforo/.test(t)) return ['h_camara'];
  var tipo = /caminera/.test(t) ? 'h_caminera' : /gendarmer/.test(t) ? 'h_gendarmeria' : /fitosanitari/.test(t) ? 'h_fito'
    : /control/.test(t) ? 'h_control' : /reporte/.test(t) ? 'h_reporte' : /zona/.test(t) ? 'h_zona'
    : /paso bajo|altura|puente/.test(t) ? 'h_altura' : /peso/.test(t) ? 'h_peso' : /largo/.test(t) ? 'h_largo'
    : /angost|ancho/.test(t) ? 'h_ancho' : /cortad|corte/.test(t) ? 'h_corte' : /obra/.test(t) ? 'h_obra'
    : /barrera|port[oó]n|bolardo|cadena/.test(t) ? 'h_barrera' : /prohib/.test(t) ? 'h_prohibido' : 'h_otro';
  var fin = /no pasa/.test(t) ? 's_nopasa' : /si vas por esa calle|si la ruta pasa/.test(t) ? 's_sivas' : /verific/.test(t) ? 's_verificar' : null;
  return fin ? [tipo, fin] : [tipo];
}
// Qué maniobra es ("doblá a la izquierda hacia Avenida...")
function clipManiobra(t) {
  t = t.toLowerCase();
  var izq = /izquierda/.test(t), der = /derecha/.test(t), lado = izq ? 'izq' : der ? 'der' : '';
  if (/destino/.test(t)) return lado ? 'm_dest_' + lado : 'm_llegas';
  if (/rotonda|glorieta/.test(t)) {
    var n = /(\d)\s*(ª|a\b|°|º)?\s*salida/.exec(t), pal = /(primera|segunda|tercera|cuarta|quinta) salida/.exec(t);
    var num = n ? +n[1] : pal ? ['primera', 'segunda', 'tercera', 'cuarta', 'quinta'].indexOf(pal[1]) + 1 : 0;
    return num >= 1 && num <= 5 ? 'm_rot' + num : 'm_rot';
  }
  if (/pegá la vuelta|cambio de sentido|vuelta en u/.test(t)) return 'm_vuelta';
  if (/mantenete|seguí por la (izquierda|derecha)|manten[eé]/.test(t)) return lado ? 'm_mant_' + lado : 'm_recto';
  if (/salida|rampa/.test(t)) return lado ? 'm_salida_' + lado : 'm_salida';
  if (/incorpor/.test(t)) return 'm_incorp';
  if (lado && /cerrad|brusca/.test(t)) return 'm_' + lado + '_cer';
  if (lado && /levemente|ligeramente/.test(t)) return 'm_' + lado + '_lev';
  if (lado) return 'm_' + lado;
  if (/seguí|continu|recto|derecho/.test(t)) return 'm_recto';
  return 'm_otro';
}
// Pasa lo que diría la voz del teléfono a la lista de grabaciones. Las frases las arma esta misma página
// (navegación: "Cuidado. En 300 metros, paso bajo... Tu camión no pasa. Ahora, doblá a la derecha hacia X.").
var INICIO_FRASE = /\s(?=(?:Cuidado|Atención)\.|En \d|Ahora,|Seguí por \d|Llegaste a destino|Recalculando)/;
function clipsDe(texto) {
  var t = String(texto || '').trim(), out = [], vueltas = 0;
  function cuerpo() {   // hasta el comienzo de la frase siguiente
    var i = t.search(INICIO_FRASE), c = i < 0 ? t : t.slice(0, i);
    t = i < 0 ? '' : t.slice(i).trim();
    return c;
  }
  while (t && vueltas++ < 12) {
    var m;
    if ((m = /^Vamos\. Seguí la ruta azul\.\s*/.exec(t))) { out.push('vamos'); t = t.slice(m[0].length); }
    else if ((m = /^Recalculando la ruta\.\s*/.exec(t))) { out.push('recalc'); t = t.slice(m[0].length); }
    else if ((m = /^Llegaste a destino\.\s*/.exec(t))) { out.push('llegaste'); t = t.slice(m[0].length); }
    else if ((m = /^Voz prendida\.\s*/.exec(t))) { out.push('voz_on'); t = t.slice(m[0].length); }
    else if ((m = /^Seguí por [^.]*\.\s*/.exec(t))) { out.push('seguir'); t = t.slice(m[0].length); }
    else if ((m = /^(Cuidado|Atención)\.\s*(?:(Acá)|(?:En|A) ([^,]+)),\s*/.exec(t))) {
      t = t.slice(m[0].length);
      out.push(m[1] === 'Cuidado' ? 'cuidado' : 'atencion', m[2] ? 'aca' : clipDistancia(m[3]));
      out = out.concat(clipPeligro(cuerpo()));
    } else if ((m = /^En ([^,]+),\s*/.exec(t))) {
      t = t.slice(m[0].length);
      out.push(clipDistancia(m[1]), clipManiobra(cuerpo()));
    } else if ((m = /^Ahora,\s*/.exec(t))) {
      t = t.slice(m[0].length);
      out.push('ahora', clipManiobra(cuerpo()));
    } else { out.push('m_otro'); break; }
  }
  return out;
}
function decirGrabado(texto, urgente) {
  bajarVozGrabada();
  sonar(clipsDe(texto).map(function (k) { return 'voz/' + k + '.wav'; }), urgente);
}
function hablar(texto, urgente) {
  if (!nav.voz || !texto) return;
  if (voz.motor === 'grabada') { decirGrabado(texto, urgente); return; }
  texto = paraDecir(texto);
  sesionDeAudio();
  if (!hayVoz()) { avisarVozFalla(); return; }
  decirFrase(texto, urgente, function (ok, detalle) { if (!ok) avisarVozFalla(detalle); });
}
// Botón "Probar la voz": habla y muestra qué pasó (sirve para saber por qué no habla en un teléfono)
// iPhone: con el teléfono en silencio las páginas web no suenan. Se pide sonar "como una app de música"
// (navigator.audioSession, iOS 16.4 o más nuevo), que suena aunque esté en silencio.
function sesionDeAudio() {
  try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) { /* nada */ }
}
sesionDeAudio();
// Un pitido corto (un archivo de sonido armado acá, no Web Audio: en el iPhone suena aunque esté en silencio y
// además "despierta" el sonido de la página). Si se escucha el pitido pero no la voz, lo que falla es la voz.
var sonidoPitido = null;
function archivoPitido() {
  if (sonidoPitido) return sonidoPitido;
  var hz = 8000, n = Math.round(hz * 0.35), b = new Uint8Array(44 + n), v = new DataView(b.buffer);
  function txt(o, t) { for (var k = 0; k < t.length; k++) b[o + k] = t.charCodeAt(k); }
  txt(0, 'RIFF'); v.setUint32(4, 36 + n, true); txt(8, 'WAVE'); txt(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, hz, true);
  v.setUint32(28, hz, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); txt(36, 'data'); v.setUint32(40, n, true);
  for (var i = 0; i < n; i++) {
    var env = Math.min(1, i / 200, (n - i) / 400);
    b[44 + i] = 128 + Math.round(100 * env * Math.sin(2 * Math.PI * 880 * i / hz));
  }
  var bin = '';
  for (var q = 0; q < b.length; q++) bin += String.fromCharCode(b[q]);
  sonidoPitido = 'data:audio/wav;base64,' + btoa(bin);
  return sonidoPitido;
}
function pitido() {
  sesionDeAudio();
  // en el reproductor de la voz grabada: así ese reproductor queda "habilitado" para sonar después sin tocar
  try { sonar([archivoPitido()], true); return true; } catch (e) { return false; }
}
function probarVoz() {
  if (voz.motor === 'grabada') {
    pitido();
    bajarVozGrabada();
    sonar(['voz/prueba.wav']);
    if (!nav.voz) { nav.voz = true; guardar('mapa-camiones:voz', true); }
    mostrarMensaje('🔊 Tiene que sonar un pitido y después "Hola, soy la voz del mapa para camiones". Si no escuchás nada, ' +
                   'subí el volumen con los botones del costado del teléfono (con el silencio puesto también tiene que sonar).');
    setTimeout(ocultarMensaje, 12000);
    return;
  }
  var hubo = pitido();
  if (!hayVoz()) { mostrarMensaje('🔇 ' + textoSinVoz(), true); return; }
  var voces = vocesDelTelefono(), es = voces.filter(function (x) { return /^es/i.test(x.lang); });
  mostrarMensaje('🔊 Primero suena un pitido y después habla la voz...');
  setTimeout(function () { probarVoz2(voces, es, hubo); }, 900);
}
function probarVoz2(voces, es, hubo) {
  decirFrase('Hola. Soy la voz del mapa para camiones. Si me escuchás, la voz anda bien.', true, function (ok, detalle) {
    var datos = ' (voces en español: ' + es.length + ' de ' + voces.length + (detalle && ok ? '; modo ' + detalle : '') +
                (hubo ? '' : '; sin pitido') + ')';
    if (ok) {
      mostrarMensaje('✓ El teléfono dice que está hablando' + datos + '. ¿Escuchaste el pitido? Si no escuchaste NADA: subí el ' +
                     'volumen "multimedia" y fijate si el sonido se va a un parlante Bluetooth (el del camión o auriculares). ' +
                     'Si escuchaste el pitido pero no la voz: Ajustes del teléfono → "Texto a voz" → elegí ' +
                     '"Servicios de voz de Google" e instalá Español.');
      if (!nav.voz) { nav.voz = true; guardar('mapa-camiones:voz', true); }
    } else {
      mostrarMensaje('🔇 El teléfono no habló' + (detalle ? ' (error: ' + detalle + ')' : '') + datos +
                     '. Revisá en Ajustes del teléfono → "Texto a voz" que haya una voz en español instalada.', true);
    }
    setTimeout(ocultarMensaje, 30000);
  });
}

function textoDistancia(m) {
  if (m >= 1000) return numero(m / 1000, 1) + ' km';
  if (m >= 100) return (Math.round(m / 50) * 50) + ' m';
  return (Math.round(m / 10) * 10) + ' m';
}
function vozDistancia(m) {
  if (m >= 1000) return numero(m / 1000, 1).replace(',', ' coma ') + ' kilómetros';
  return (m >= 100 ? Math.round(m / 50) * 50 : Math.round(m / 10) * 10) + ' metros';
}
// "Gire a la derecha a Avenida Juan B. Justo." -> "gire a la derecha a Avenida Juan B. Justo"
function frase(texto) {
  var t = String(texto || '').replace(/\.\s*$/, '');
  return t.charAt(0).toLowerCase() + t.slice(1);
}

function empezarNavegacion(rutaElegida) {
  var r = rutaElegida || (ruta.opciones && ruta.opciones[ruta.elegida || 0]);
  if (!r) return;
  nav.r = r;
  nav.acum = [0];
  for (var i = 1; i < r.puntos.length; i++) nav.acum.push(nav.acum[i - 1] + L.latLng(r.puntos[i - 1]).distanceTo(r.puntos[i]));
  nav.maniobras = r.pasos.map(function (p, n) {
    var idx = p.ini == null ? null : Math.min(p.ini, r.puntos.length - 1);
    var llegada = /^(Llegar|Su destino|Tu destino|Has llegado|Llegaste|Lleg[óo])/i.test(p.texto || '');
    var lado = /izquierda/i.test(p.texto) ? ', a la izquierda' : /derecha/i.test(p.texto) ? ', a la derecha' : '';
    return { n: n, texto: llegada ? 'Llegás a destino' + lado : p.texto, llegada: llegada,
             idx: idx, dist: idx == null ? null : nav.acum[idx] };
  }).filter(function (m) { return m.dist != null && m.n > 0; });   // la primera es "salí hacia..."
  nav.avisos = (r.avisos || []).map(function (a, n) {
    // "orden" = tramo de la ruta donde empieza el lugar (lo calcula revisarRuta)
    var mejor = a.orden != null ? Math.min(a.orden, r.puntos.length - 1) : 0;
    if (a.orden == null) {
      var dmin = Infinity;
      for (var k = 0; k < r.puntos.length; k++) {
        var d = a.latlng.distanceTo(r.puntos[k]);
        if (d < dmin) { dmin = d; mejor = k; }
      }
    }
    return { n: n, texto: a.texto, voz: a.voz, rojo: !!a.rojo, dist: nav.acum[mejor] };
  });
  // controles policiales: se avisan como un peligro, pero sin alarma
  var VOZ_CONTROL = { policial: 'control policial', vial: 'control de la policía caminera',
                      gendarmeria: 'control de Gendarmería', fitosanitario: 'control fitosanitario',
                      radar: 'radar de velocidad', camara: 'cámara de semáforo' };
  (r.controles || controlesEnRuta(r.puntos)).forEach(function (c, k) {
    var p = c.item.f.properties, tipo = CONTROLES[p.tipo] || CONTROLES.policial;
    var maxRadar = p.tipo === 'radar' && p.maxima ? maximaCamion(p.maxima) : null;
    nav.avisos.push({ n: 'ctl' + k, texto: tipo.nombre + (maxRadar ? ', máxima ' + maxRadar + ' km/h' : ''),
                      voz: (VOZ_CONTROL[p.tipo] || 'control policial') + (maxRadar ? ', máxima ' + maxRadar + ' kilómetros por hora' : ''),
                      maxima: maxRadar, icono: tipo.icono + ' ', rojo: false,
                      dist: nav.acum[Math.min(c.orden, nav.acum.length - 1)] +
                            (c.t || 0) * ((nav.acum[c.orden + 1] || nav.acum[c.orden]) - nav.acum[c.orden]) });
  });
  nav.idx = 0; nav.dichos = {}; nav.fuera = 0; nav.posAnterior = null; nav.activo = true; nav.recalculando = false; nav.primera = true;
  nav.primeraCamara = !ruta.esRecalculo;
  volverACentrar(false);
  abrirPanelRuta(false);
  abrirPanel(false);
  document.getElementById('nav-cartel').hidden = false;
  document.getElementById('nav-abajo').hidden = false;
  resumenNav(nav.acum[nav.acum.length - 1]);
  medirHoja();
  document.body.classList.add('navegando');
  ponerVozBoton();
  ponerRumboBoton();
  nav.ultimoRumbo = null;
  ponerBrujula();
  mostrarCartelNav('Buscando tu ubicación...', '');
  if (!ruta.esRecalculo && nav.voz) pitido();
  if (!ruta.esRecalculo) hablar('Vamos. Seguí la ruta azul.', true);
  // si la voz quedó apagada (botón 🔇) o el navegador no habla, se dice en pantalla (antes no avisaba nada)
  if (!ruta.esRecalculo && !nav.voz) {
    mostrarMensaje('🔇 La voz está apagada. Tocá 🔇 abajo para prenderla.');
    setTimeout(ocultarMensaje, 10000);
  } else if (!ruta.esRecalculo && !hayVoz()) avisarVozFalla();
  ruta.esRecalculo = false;
  pedirPantallaPrendida();
  // si el GPS ya estaba andando, la cámara de navegación se acomoda sola (antes tocarUbicacion() la cortaba:
  // quedaba con el norte arriba y más lejos); si no, se prende el GPS
  if (ubicacion.ultima) seguirNavegacion(ubicacion.ultima);
  else {
    // sin GPS todavía: la cámara de viaje se pone en la salida, mirando hacia donde arranca la ruta
    if (nav.primeraCamara && r.puntos.length > 1) {
      nav.ultimoRumbo = rumboEnRuta({ idx: 0 });
      seguirConCamara(L.latLng(r.puntos[0]));
      nav.primeraCamara = true;   // cuando llegue el GPS, se vuelve a acomodar suave
    }
    tocarUbicacion();
  }
}

function terminarNavegacion(mensaje) {
  volverACentrar(false);
  nav.activo = false;
  gl.easeTo({ bearing: 0, pitch: 0, duration: 600 });   // al terminar: mapa derecho y el norte arriba
  if (ubicacion.punto) ubicacion.punto.setRotation(0);
  ponerBrujula();
  nav.recalculando = false;
  ruta.alTerminarCalculo = null;   // si estaba recalculando, al terminar no vuelve a arrancar sola
  document.getElementById('nav-cartel').hidden = true;
  document.getElementById('nav-abajo').hidden = true;
  medirHoja();
  document.body.classList.remove('navegando');
  if (nav.wake) { try { nav.wake.release(); } catch (e) { /* nada */ } nav.wake = null; }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (mensaje) { mostrarMensaje(mensaje); setTimeout(ocultarMensaje, 6000); }
}

function pedirPantallaPrendida() {
  if (!('wakeLock' in navigator) || nav.wake) return;
  navigator.wakeLock.request('screen').then(function (w) {
    nav.wake = w;
    w.addEventListener('release', function () { nav.wake = null; });
  }).catch(function () { /* el teléfono no deja: se puede apagar la pantalla */ });
}
document.addEventListener('visibilitychange', function () {
  if (nav.activo && document.visibilityState === 'visible') pedirPantallaPrendida();
});

// Barra de abajo: "14:35 llegada" y "12 min · 7,4 km". El tiempo es el de la ruta (de auto), en proporción a lo que falta.
function resumenNav(faltaM) {
  var total = nav.acum[nav.acum.length - 1] || 1, seg = (nav.r && nav.r.segundos || 0) * Math.max(0, faltaM) / total;
  var llega = new Date(Date.now() + seg * 1000);
  document.getElementById('nav-falta-tiempo').textContent = duracion(seg);
  document.getElementById('nav-falta-resto').textContent = textoDistancia(faltaM) + ' · llegás ' +
    ('0' + llega.getHours()).slice(-2) + ':' + ('0' + llega.getMinutes()).slice(-2);
}
function mostrarCartelNav(distancia, texto, peligro) {
  document.getElementById('nav-distancia').textContent = distancia;
  document.getElementById('nav-texto').textContent = texto;
  document.getElementById('nav-peligro').textContent = peligro || '';
  document.getElementById('nav-peligro').hidden = !peligro;
}

// Dónde estoy sobre la ruta: tramo más cercano (buscando cerca del último) y metros recorridos
function ubicarEnRuta(pos) {
  var pts = nav.r.puntos, desde = Math.max(0, nav.idx - 10), hasta = Math.min(pts.length - 1, nav.idx + 400);
  if (nav.primera) {
    hasta = pts.length - 1;
    for (var h = 1; h < pts.length; h++) { if (nav.acum[h] > 3000) { hasta = h; break; } }
  }
  var kx = 111320 * Math.cos(pos.lat * Math.PI / 180), ky = 110540;
  var px = pos.lng * kx, py = pos.lat * ky, mejor = { d: Infinity, i: nav.idx, t: 0 };
  for (var i = desde; i < hasta; i++) {
    var ax = pts[i][1] * kx, ay = pts[i][0] * ky, bx = pts[i + 1][1] * kx, by = pts[i + 1][0] * ky;
    var vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
    var t = L2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
    var d = Math.hypot(ax + t * vx - px, ay + t * vy - py);
    if (d < mejor.d) mejor = { d: d, i: i, t: t };
  }
  var recorrido = nav.acum[mejor.i] + mejor.t * (nav.acum[mejor.i + 1] - nav.acum[mejor.i]);
  return { fuera: mejor.d, idx: mejor.i, recorrido: recorrido };
}

function seguirNavegacion(pos) {
  if (!nav.activo) return;
  // mientras se recalcula, el mapa sigue al camión igual (si no, se iba de la pantalla justo cuando te perdiste)
  if (nav.recalculando) { nav.ultimaPos = pos; seguirConCamara(pos); return; }
  nav.ultimaPos = pos;
  var u = ubicarEnRuta(pos);
  // ¿Te saliste de la ruta?
  var rumboGps = null;   // hacia dónde vas (con las últimas posiciones)
  if (nav.posAnterior && L.latLng(nav.posAnterior).distanceTo(pos) > 8) {
    rumboGps = rumboEntre(L.latLng(nav.posAnterior), L.latLng(pos));
    nav.posAnterior = pos;
  } else if (!nav.posAnterior) nav.posAnterior = pos;
  if (u.fuera > NAV.FUERA_DE_RUTA_M) {
    nav.fuera++;
    // fuera de la ruta no hay avisos preparados: se mira lo que hay adelante (lo rojo para tu camión)
    var lista = peligrosAdelante(L.latLng(pos), rumboGps), p0 = lista[0];
    var txtP = p0 ? '⛔ A ' + textoDistancia(p0.d) + ': ' + p0.texto : '';
    // una vez por calle (las avenidas vienen en varios pedazos); se puede repetir a los 3 minutos
    p0 = lista.filter(function (x) { return !(Date.now() - (nav.dichos['f' + x.clave] || 0) < 180000); })[0];
    if (p0) {
      nav.dichos['f' + p0.clave] = Date.now();
      hablar('Cuidado. ' + (p0.d < 30 ? 'Acá' : 'A ' + vozDistancia(Math.max(30, p0.d))) + ', ' + p0.voz + '.', true);
    }
    if (nav.fuera >= NAV.FUERA_VECES && Date.now() - nav.ultimoRecalculo > NAV.RECALCULO_CADA_S * 1000) recalcularDesde(pos);
    else mostrarCartelNav('Fuera de la ruta', 'Volvé a la ruta azul o esperá: la recalculo en unos segundos.', txtP);
    // fuera de la ruta el mapa sigue al camión, mirando hacia donde va (según el GPS)
    if (rumboGps != null) nav.ultimoRumbo = rumboGps;
    seguirConCamara(pos);
    return;
  }
  nav.fuera = 0;
  nav.idx = u.idx;
  if (true) {
    var rumbo = rumboEnRuta(u);
    // solo si cambió algo (si no, el mapa tiembla con cada lectura del GPS)
    if (nav.ultimoRumbo == null || Math.abs((((rumbo - nav.ultimoRumbo) % 360) + 540) % 360 - 180) > 4) {
      nav.ultimoRumbo = rumbo;   // el mapa gira junto con el movimiento (seguirConCamara)
    }
  }
  nav.primera = false;
  var total = nav.acum[nav.acum.length - 1];
  var falta = total - u.recorrido;
  resumenNav(falta);
  // ¿Llegaste?
  if (falta < NAV.LLEGADA_M) {
    hablar('Llegaste a destino.', true);
    terminarNavegacion('Llegaste a destino.');
    borrarRuta();   // al llegar, la ruta ya no hace falta
    actualizarTrayecto();
    return;
  }
  // Próxima indicación
  var prox = nav.maniobras.filter(function (m) { return m.dist > u.recorrido + 5; })[0];
  var peligro = '';
  var decir = [];   // todo lo que hay que decir en esta posición, en una sola frase
  // Pasos bajos, prohibidos o reportes que vienen adelante
  nav.limite = null;
  nav.avisos.forEach(function (a) {
    var hasta = a.dist - u.recorrido;
    if (hasta < -20 || hasta > NAV.AVISO_PELIGRO_M) return;
    if (a.maxima && (nav.limite == null || a.maxima < nav.limite)) nav.limite = a.maxima;
    if (!peligro) peligro = (a.icono || (a.rojo ? '⛔ ' : '⚠ ')) + 'En ' + textoDistancia(Math.max(0, hasta)) + ': ' + a.texto;
    if (!nav.dichos['a' + a.n]) {
      nav.dichos['a' + a.n] = true;
      decir.push((a.rojo ? 'Cuidado. ' : 'Atención. ') + 'En ' + vozDistancia(Math.max(50, hasta)) + ', ' + (a.voz || a.texto) + '.');
    }
  });
  if (!prox) {
    mostrarCartelNav(textoDistancia(falta), 'Seguí hasta el destino', peligro);
    if (decir.length) hablar(decir.join(' '));
    return;
  }
  var dist = prox.dist - u.recorrido;
  mostrarCartelNav('En ' + textoDistancia(dist), prox.texto, peligro);
  if (prox.llegada) {
    // del destino se avisa una sola vez; al llegar se dice "Llegaste"
    if (dist <= NAV.PRIMER_AVISO_M && !nav.dichos['b' + prox.n]) {
      nav.dichos['b' + prox.n] = true;
      decir.push('En ' + vozDistancia(dist) + ', llegás a destino' + prox.texto.replace('Llegás a destino', '') + '.');
    }
  } else if (dist <= NAV.ULTIMO_AVISO_M && !nav.dichos['c' + prox.n]) {
    nav.dichos['c' + prox.n] = nav.dichos['b' + prox.n] = true;
    decir.push('Ahora, ' + frase(prox.texto) + '.');
  } else if (dist <= NAV.PRIMER_AVISO_M && !nav.dichos['b' + prox.n]) {
    nav.dichos['b' + prox.n] = true;
    decir.push('En ' + vozDistancia(dist) + ', ' + frase(prox.texto) + '.');
  } else if (dist > 2000 && !nav.dichos['s' + prox.n]) {
    nav.dichos['s' + prox.n] = true;
    decir.push('Seguí por ' + vozDistancia(dist) + '.');
  }
  // los peligros van primero; no se corta lo que se estaba diciendo
  if (decir.length) hablar(decir.join(' '));
  seguirConCamara(pos);
}

// La cámara sigue al camión: en un solo movimiento suave se corre y (con "rumbo arriba") gira hacia donde vas.
// El camión queda más abajo del centro, así se ve más de lo que viene (como Google Maps).
// "Modo viaje" (pedido del chofer, 20/11/2026: "que se acerque y se ponga como navegador, como hace Maps"):
// mapa inclinado (VIAJE.inclinacion), de cerca, girando hacia donde vas y con una flecha en vez del punto azul.
// El zoom depende de la velocidad: en la ciudad más cerca, en la ruta un poco más lejos para ver lo que viene.
var VIAJE = { inclinacion: 50 };
function zoomDeViaje() {
  var kmh = velocidad.kmh;
  if (kmh == null || kmh < 35) return 17;
  return kmh < 70 ? 16.4 : 15.8;
}
function seguirConCamara(pos) {
  if (ubicacion.punto && nav.ultimoRumbo != null) ubicacion.punto.setRotation(nav.ultimoRumbo);   // la flecha
  if (nav.libre) return;   // el chofer está mirando otra parte del mapa (botón "Centrar")
  var o = { center: [pos.lng, pos.lat], duration: 900, easing: function (t) { return t; }, pitch: VIAJE.inclinacion,
            offset: [0, Math.round(gl.getContainer().clientHeight * 0.22)] };
  // siempre se dice el giro: con "rumbo arriba" apagado, 0 (si no, un giro al norte a medias quedaba torcido)
  o.bearing = nav.rumbo ? (nav.ultimoRumbo != null ? nav.ultimoRumbo : gl.getBearing()) : 0;
  var z = zoomDeViaje();
  if (Math.abs(gl.getZoom() - z) > 0.25) o.zoom = z;
  if (nav.primeraCamara) {   // al tocar "Ir": se acerca de a poco (como Google Maps)
    nav.primeraCamara = false;
    o.duration = 1600;
    delete o.easing;
    o.zoom = z;
  }
  gl.easeTo(o);
}

// Lo que hay adelante (hasta 150 m) donde tu camión NO pasa, del más cercano al más lejano (uno por calle).
// Se usa estando fuera de la ruta.
// Sin rumbo (parado o recién empezado) mira alrededor, hasta 60 m.
function peligrosAdelante(pos, rumbo) {
  var MAX = rumbo == null ? 60 : 150;
  var caja = pos.toBounds(MAX * 2.2), kx = Math.cos(pos.lat * Math.PI / 180) * 111320, ky = 110540, porClave = {};
  function xy(ll) { return [(ll.lng - pos.lng) * kx, (ll.lat - pos.lat) * ky]; }
  function considerar(ll, d, l, p) {
    if (d > MAX) return;
    if (rumbo != null && d > 25) {   // tiene que estar adelante (no atrás ni muy al costado)
      var dif = Math.abs((((rumboEntre(pos, ll) - rumbo) % 360) + 540) % 360 - 180);
      if (dif > 40) return;
    }
    var k = p.calle ? p.capa + ':' + p.calle : L.stamp(l);
    if (!porClave[k] || d < porClave[k].d) porClave[k] = { d: d, l: l, p: p, clave: k };
  }
  Object.keys(grupos).forEach(function (id) {
    if (id === 'sin_salida' || !grupos[id]) return;
    grupos[id].eachLayer(function (l) {
      var p = l.feature.properties;
      if (evaluar(p).estado !== 'no') return;
      if (l.getLatLng) { var q = l.getLatLng(); if (caja.contains(q)) considerar(q, pos.distanceTo(q), l, p); return; }
      if (!caja.intersects(l.getBounds())) return;
      if (l.feature.geometry.type === 'Polygon') {   // zona prohibida: ¿estás adentro?
        if (dentroDeAnillo([pos.lng, pos.lat], l.feature.geometry.coordinates[0])) considerar(pos, 0, l, p);
        return;
      }
      var partes = l.getLatLngs();
      if (partes.length && !Array.isArray(partes[0])) partes = [partes];
      partes.forEach(function (linea) {
        for (var k = 1; k < linea.length; k++) {
          var a = xy(linea[k - 1]), b = xy(linea[k]), vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
          var t = L2 ? Math.max(0, Math.min(1, -(a[0] * vx + a[1] * vy) / L2)) : 0;
          var cx = a[0] + t * vx, cy = a[1] + t * vy;
          considerar(L.latLng(pos.lat + cy / ky, pos.lng + cx / kx), Math.hypot(cx, cy), l, p);
        }
      });
    });
  });
  return Object.keys(porClave).map(function (k) { return porClave[k]; })
    .sort(function (a, b) { return a.d - b.d; })
    .map(function (m) {
      var p = m.p;
      var que = p.capa === 'barrera' || p.capa === 'obra' || p.capa === 'corte' || p.norma ? p.titulo : textoValor(p);
      return { d: Math.round(m.d), clave: m.clave, texto: que + (p.calle && !p.norma ? ' — ' + p.calle : ''),
               voz: String(que).replace(/^./, function (c) { return c.toLowerCase(); }) + (p.calle && !p.norma ? ' en ' + p.calle : '') +
                    '. Tu camión no pasa' };
    });
}
function rumboEntre(a, b) {
  var y = (b.lng - a.lng) * Math.cos(a.lat * Math.PI / 180), x = b.lat - a.lat;
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function recalcularDesde(pos) {
  if (!ruta.hasta) return;
  nav.recalculando = true;
  nav.ultimoRecalculo = Date.now();
  mostrarCartelNav('Recalculando...', 'Te saliste de la ruta. Busco otra desde donde estás.');
  hablar('Recalculando la ruta.', true);
  marcarParadasPasadas(pos);
  ponerPunto('desde', pos, 'Mi ubicación');
  ruta.alTerminarCalculo = function (ok) {
    nav.recalculando = false;
    if (!nav.activo) return;   // el chofer terminó la navegación mientras recalculaba
    if (ok && ruta.opciones) { ruta.esRecalculo = true; empezarNavegacion(ruta.opciones[0]); }
    else mostrarCartelNav('Sin ruta nueva', 'No pude recalcular (¿sin señal?). Lo vuelvo a intentar en unos segundos.');
  };
  calcularRuta();
}

mapa.on('locationfound', function (e) { if (nav.activo) seguirNavegacion(e.latlng); });

function ponerVozBoton() {
  var b = document.getElementById('nav-voz');
  b.textContent = nav.voz ? '🔊' : '🔇';
  b.setAttribute('aria-label', nav.voz ? 'Apagar la voz' : 'Prender la voz');
}
if (document.getElementById('nav-cartel')) {
  // "Salir": termina la navegación y vuelve a la tarjeta de la ruta (ahí está "▶ Ir" y "✕ Cancelar ruta")
  document.getElementById('nav-terminar').addEventListener('click', function () {
    terminarNavegacion('Navegación terminada. Para sacar la ruta, tocá ✕ Cancelar.');
    if (ruta.opciones) { abrirPanelRuta(true); modoResultado(true); }
  });
  if (document.getElementById('nav-rumbo')) {
    document.getElementById('nav-rumbo').addEventListener('click', function () { cambiarRumbo(!nav.rumbo); });
  }
  document.getElementById('nav-voz').addEventListener('click', function () {
    nav.voz = !nav.voz;
    guardar('mapa-camiones:voz', nav.voz);
    if (!nav.voz && window.speechSynthesis) window.speechSynthesis.cancel();
    ponerVozBoton();
    if (nav.voz) hablar('Voz prendida.', true);
  });
}

// ===== Ayuda ("?") =====
(function () {
  var ventanaAyuda = document.getElementById('ventana-ayuda');
  if (!ventanaAyuda) return;
  function abrir(si) { ventanaAyuda.hidden = !si; }
  document.getElementById('btn-ayuda').addEventListener('click', function () { abrirPanel(false); abrirPanelRuta(false); abrir(true); });
  var bVoz = document.getElementById('btn-probar-voz');
  if (bVoz) bVoz.addEventListener('click', function () { abrirPanel(false); probarVoz(); });
  // qué voz usar: la grabada (suena con el iPhone en silencio) o la del teléfono (dice los nombres de las calles)
  var selMotor = document.getElementById('voz-motor');
  if (selMotor) {
    selMotor.value = voz.motor;
    selMotor.addEventListener('change', function () { voz.motor = selMotor.value; guardar('mapa-camiones:voz-motor', voz.motor); });
  }
  document.getElementById('cerrar-ayuda').addEventListener('click', function () { abrir(false); });
  ventanaAyuda.addEventListener('click', function (ev) { if (ev.target === ventanaAyuda) abrir(false); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') abrir(false); });
})();

// ===== 11. App instalable y uso sin señal =====
// sw.js guarda la página, los datos y los pedazos del mapa que ya se miraron.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('Sin modo sin señal:', e.message); });
    // En la primera visita la página se bajó antes de que el service worker existiera: se guarda ahora
    // lo que hace falta para abrir sin señal (código, estilos, índice de zonas y las zonas ya vistas)
    navigator.serviceWorker.ready.then(function () {
      if (!window.caches) return;
      var archivos = ['./', 'index.html', 'datos/zonas.json'];
      document.querySelectorAll('script[src*="js/app.js"], link[href*="css/estilos.css"]').forEach(function (e) {
        archivos.push(e.getAttribute('src') || e.getAttribute('href'));
      });
      zonasCargadas.forEach(function (z) {
        ['archivo', 'lugares', 'red', 'normas'].forEach(function (k) { if (z.zona[k]) archivos.push('datos/' + z.zona[k]); });
      });
      caches.keys().then(function (nombres) {
        var nombre = nombres.filter(function (n) { return n.indexOf('mapa-camiones-app-') === 0; }).sort().pop();
        if (!nombre) return;
        caches.open(nombre).then(function (c) {
          archivos.forEach(function (u) { c.match(u).then(function (r) { if (!r) c.add(u).catch(function () {}); }); });
        });
      });
    });
  });
}
window.addEventListener('offline', function () {
  mostrarMensaje('Sin señal: ves lo que ya estaba guardado. Las rutas y la búsqueda de direcciones necesitan internet.');
});
window.addEventListener('online', function () {
  if (/^Sin señal/.test(document.getElementById('mensaje').textContent)) ocultarMensaje();
});

// ===== Tocar el mapa: cartel de lo que hay ahí (íconos primero; después lo rojo, lo amarillo, lo gris) =====
// Se mira un cuadrado alrededor del dedo (las líneas finas se tocan fácil). Va al final: así los otros usos del
// toque (elegir un punto de la ruta) se fijan antes.
gl.on('click', function (e) {
  if (Date.now() - menuToque.ultimo < 800) return;   // fue un dedo apretado: ya se abrió su cartel
  if (e._l && e._l.tomado) return;
  var habiaCartel = !!cartel;
  var pt = e.point;
  function buscar(capas, t) {
    var hay = capas.filter(function (id) { return gl.getLayer(id); });
    return hay.length ? gl.queryRenderedFeatures([[pt.x - t, pt.y - t], [pt.x + t, pt.y + t]], { layers: hay }) : [];
  }
  var iconos = buscar(['reportes', 'controles', 'radares', 'radares-lejos', 'lugares', 'lugares-lejos'], 18);
  if (iconos.length) {
    // el más cercano al dedo (antes ganaba siempre el control o el reporte aunque el lugar estuviera más cerca)
    var lejos = function (f) {
      var c = f.geometry.coordinates, s = gl.project(c);
      return (s.x - pt.x) * (s.x - pt.x) + (s.y - pt.y) * (s.y - pt.y);
    };
    iconos.sort(function (a, b) { return lejos(a) - lejos(b); });
    var q = iconos[0].properties;
    if (q.k === 'l' && lugarPorId[q.id]) abrirCartelLugar(lugarPorId[q.id]);
    else if (q.k === 'c' && controles.lista[q.i]) abrirCartelControl(controles.lista[q.i]);
    else if (q.k === 'r' && reportePorId[q.id]) abrirCartel(reportePorId[q.id].getLatLng(), armarCartelReporte(reportePorId[q.id].feature.properties));
    return;
  }
  // las zonas prohibidas (polígonos) van al final: si no, adentro de una zona cualquier toque abría la zona
  // y no se podían abrir las calles ni los puntos que hay adentro
  var r = buscar(['r-puntos', 'r-sin-salida', 'r-rojo', 'r-rojo-ag', 'r-amarillo', 'r-amarillo-punteado', 'r-gris'], 14);
  if (!r.length) r = buscar(['r-zona-borde'], 14);
  // tocar adentro de la zona (sin nada más cerca) abre la zona, salvo que haya un cartel abierto: ese toque es para cerrarlo
  if (!r.length && !habiaCartel) r = buscar(['r-zona', 'r-agrupada'], 2);
  if (!r.length) { cerrarCartel(); return; }   // tocar donde no hay nada: cierra el cartel abierto
  var normales = r.filter(function (f) { return f.properties.zg == null; });
  if (!normales.length) { abrirCartelAgrupada(r[0].properties.zg, aLatLng(e.lngLat)); return; }
  r = normales;
  var orden = { no: 0, sin_dato: 1, si: 2, aviso: 3 };
  r.sort(function (a, b) {
    return (orden[a.properties.e] - orden[b.properties.e]) || ((a.layer.type === 'circle' ? 0 : 1) - (b.layer.type === 'circle' ? 0 : 1));
  });
  var l = restrPorId[r[0].properties.id];
  if (l) abrirCartelRestriccion(l, l.getLatLng ? l.getLatLng() : aLatLng(e.lngLat));
});

// ===== Navegando: si el chofer mueve el mapa con el dedo, deja de seguirlo y aparece "Centrar" (como Google Maps).
// Tocarlo (o esperar 12 s sin tocar el mapa) vuelve a seguir al camión.
var botonCentrar = document.createElement('button');
botonCentrar.type = 'button';
botonCentrar.className = 'boton-centrar';
botonCentrar.hidden = true;
botonCentrar.innerHTML = '<span aria-hidden="true">➤</span> Centrar';
document.body.appendChild(botonCentrar);
botonCentrar.addEventListener('click', function () { volverACentrar(true); });
function volverACentrar(mover) {
  clearTimeout(nav.timerLibre);
  nav.libre = false;
  botonCentrar.hidden = true;
  if (mover && nav.activo && nav.ultimaPos) seguirConCamara(nav.ultimaPos);
}
function soltarCamara(e) {
  if (!nav.activo || !e || !e.originalEvent) return;   // solo si lo movió el chofer (no la cámara sola)
  nav.libre = true;
  botonCentrar.hidden = false;
  clearTimeout(nav.timerLibre);
  nav.timerLibre = setTimeout(function () { volverACentrar(true); }, 12000);
}
gl.on('dragstart', soltarCamara);
gl.on('zoomstart', soltarCamara);
gl.on('rotatestart', soltarCamara);
// mientras sigue tocando el mapa, se corre la espera
gl.on('moveend', function (e) {
  if (nav.libre && e && e.originalEvent) {
    clearTimeout(nav.timerLibre);
    nav.timerLibre = setTimeout(function () { volverACentrar(true); }, 12000);
  }
});
