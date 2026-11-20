/* Prueba del mapa nuevo (19/11/2026): TODO el mapa lo dibuja MapLibre (como Google Maps), sin Leaflet.
   Sirve para que el chofer compare en su celular la fluidez al mover, acercar y girar, antes de pasar toda la app.
   Muestra el mapa de fondo y las restricciones con los mismos colores que la app (según las medidas guardadas). */
'use strict';

var COLORES = { no: '#d50000', si: '#8a8f98', sin_dato: '#f2b705', aviso: '#7b3fa0' };
var PUNTEADAS = { verificar: true, verificar_autopista: true, obra: true };
var MEDIDA_DE_CAPA = { altura: 'altura', peso: 'peso', largo: 'largo', ancho: 'ancho' };
var ANCHO_CAMION = 2.6;

function leer(clave) { try { return JSON.parse(localStorage.getItem(clave)); } catch (e) { return null; } }
var camion = leer('mapa-camiones:camion');
var apagadas = leer('mapa-camiones:capas-apagadas') || {};

// Igual que evaluar() de mapa.js
function evaluar(p) {
  if (p.capa === 'prohibido') {
    if (p.peso_desde && camion && camion.peso <= p.peso_desde) return { estado: 'si' };
    return { estado: 'no' };
  }
  if (p.capa === 'sin_salida') return { estado: 'aviso' };
  if (p.capa === 'barrera') return { estado: p.bloquea ? 'no' : 'sin_dato' };
  if (p.capa === 'obra') return { estado: 'sin_dato' };
  var medida = MEDIDA_DE_CAPA[p.capa];
  if (!medida || p.limite == null || !camion) return { estado: 'sin_dato' };
  var valor = medida === 'ancho' ? (camion.ancho || ANCHO_CAMION) : camion[medida];
  if (p.calzada) return { estado: p.limite < valor + 0.5 ? 'no' : 'sin_dato' };
  var justo = Math.abs(valor - p.limite) < 0.005;
  return { estado: valor > p.limite && !justo ? 'no' : 'si', justo: justo };
}

// ---- mapa de fondo (el mismo estilo que la app) ----
function estiloLiviano(est) {
  est.layers = est.layers.filter(function (l) { return l.id !== 'building-3d' && l.id !== 'poi_r20'; });
  est.layers.forEach(function (l) {
    if (l.id === 'building') delete l.maxzoom;
    if (l.type !== 'line' || !l.paint || !l.paint['line-color'] || !/^(road|bridge|tunnel)_/.test(l.id)) return;
    var auto = /motorway/.test(l.id), borde = /casing/.test(l.id);
    var c = JSON.stringify(l.paint['line-color']);
    if (auto && /#fc8|#ffdaa6|hsl\(26/.test(c)) l.paint['line-color'] = '#d9e2ec';
    else if (borde && /#e9ac77/.test(c)) l.paint['line-color'] = auto ? '#a7b4c2' : '#cdc9c3';
    else if (/#fea|#fff4c6/.test(c)) l.paint['line-color'] = '#ffffff';
  });
  return est;
}

var vista = leer('mapa-camiones:vista');
var inicio = vista && typeof vista.lat === 'number' ? { center: [vista.lng, vista.lat], zoom: Math.max(3, vista.zoom - 1) }
                                                    : { center: [-58.4173, -34.6118], zoom: 11 };

fetch('https://tiles.openfreemap.org/styles/liberty').then(function (r) { return r.json(); }).then(function (est) {
  arrancar(estiloLiviano(est));
}).catch(function () {
  document.getElementById('texto-prueba').textContent = 'No se pudo bajar el mapa (¿sin señal?).';
});

var mapa;
function arrancar(estilo) {
  mapa = new maplibregl.Map({
    container: 'mapa', style: estilo, center: inicio.center, zoom: inicio.zoom,
    minZoom: 3, maxZoom: 18.5, maxPitch: 0, pitchWithRotate: false, touchPitch: false,
    attributionControl: false, pixelRatio: Math.min(window.devicePixelRatio || 1, 2)
  });
  mapa.touchZoomRotate.enable();
  mapa.addControl(new maplibregl.NavigationControl({ showZoom: !matchMedia('(pointer: coarse)').matches,
                                                     showCompass: true, visualizePitch: false }), 'bottom-right');
  mapa.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true },
                                                    trackUserLocation: true, showAccuracyCircle: true }), 'bottom-right');
  mapa.on('styleimagemissing', function (ev) {
    if (!mapa.hasImage(ev.id)) mapa.addImage(ev.id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
  mapa.on('load', function () {
    ponerCapas();
    bajarIndices();
    mapa.on('moveend', cargarVista);
    mapa.on('click', tocar);
  });
}

// ---- restricciones ----
var datos = { type: 'FeatureCollection', features: [] };
var vistas = {};   // osm|capa ya puesto (para no repetir lo del país)

function ponerCapas() {
  mapa.addSource('r', { type: 'geojson', data: datos, buffer: 32, tolerance: 0.5 });
  var ancho = function (suma) {
    return ['interpolate', ['linear'], ['zoom'], 10, 1.5 + suma, 11, 2 + suma, 12, 3 + suma, 13, 4 + suma, 14, 5 + suma];
  };
  var lineas = ['==', ['geometry-type'], 'LineString'];
  var visible = ['==', ['get', 've'], 1];
  // zonas prohibidas (ordenanzas): relleno suave y borde
  mapa.addLayer({ id: 'r-zona', type: 'fill', source: 'r', filter: ['all', ['==', ['geometry-type'], 'Polygon'], visible],
                  paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 } });
  mapa.addLayer({ id: 'r-zona-borde', type: 'line', source: 'r', filter: ['all', ['==', ['geometry-type'], 'Polygon'], visible],
                  paint: { 'line-color': ['get', 'color'], 'line-width': 2 } });
  // gris (pasás) y amarillo (verificar) debajo; rojo encima con borde blanco
  mapa.addLayer({ id: 'r-gris', type: 'line', source: 'r', filter: ['all', lineas, visible, ['==', ['get', 'e'], 'si']],
                  layout: { 'line-cap': 'round', 'line-join': 'round' },
                  paint: { 'line-color': COLORES.si, 'line-opacity': 0.5, 'line-width': ancho(-1) } });
  mapa.addLayer({ id: 'r-amarillo', type: 'line', source: 'r', filter: ['all', lineas, visible, ['==', ['get', 'e'], 'sin_dato'], ['!=', ['get', 'p'], 1]],
                  layout: { 'line-cap': 'round', 'line-join': 'round' },
                  paint: { 'line-color': COLORES.sin_dato, 'line-opacity': 0.9, 'line-width': ancho(0) } });
  mapa.addLayer({ id: 'r-amarillo-punteado', type: 'line', source: 'r', filter: ['all', lineas, visible, ['==', ['get', 'e'], 'sin_dato'], ['==', ['get', 'p'], 1]],
                  paint: { 'line-color': COLORES.sin_dato, 'line-opacity': 0.9, 'line-width': ancho(0), 'line-dasharray': [2, 1.5] } });
  mapa.addLayer({ id: 'r-rojo-borde', type: 'line', source: 'r', filter: ['all', lineas, ['==', ['get', 'e'], 'no']],
                  layout: { 'line-cap': 'round', 'line-join': 'round' },
                  paint: { 'line-color': '#ffffff', 'line-width': ancho(4) } });
  mapa.addLayer({ id: 'r-rojo', type: 'line', source: 'r', filter: ['all', lineas, ['==', ['get', 'e'], 'no']],
                  layout: { 'line-cap': 'round', 'line-join': 'round' },
                  paint: { 'line-color': COLORES.no, 'line-width': ancho(1.5) } });
  // puntos: sin salida (violeta) solo de cerca; el resto siempre
  var radio = function (suma) {
    return ['interpolate', ['linear'], ['zoom'], 10, 2 + suma, 11, 2.5 + suma, 12, 4 + suma, 13, 5.5 + suma, 14, 7.5 + suma];
  };
  mapa.addLayer({ id: 'r-sin-salida', type: 'circle', source: 'r', minzoom: 12,
                  filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'e'], 'aviso']],
                  paint: { 'circle-color': COLORES.aviso, 'circle-radius': radio(0), 'circle-stroke-color': '#fff',
                           'circle-stroke-width': 1.5 } });
  mapa.addLayer({ id: 'r-puntos', type: 'circle', source: 'r',
                  filter: ['all', ['==', ['geometry-type'], 'Point'], visible, ['!=', ['get', 'e'], 'aviso']],
                  paint: { 'circle-color': ['get', 'color'], 'circle-radius': radio(0.5), 'circle-stroke-color': '#fff',
                           'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 13, 2] } });
}
var TOCABLES = ['r-rojo', 'r-amarillo', 'r-amarillo-punteado', 'r-gris', 'r-puntos', 'r-sin-salida', 'r-zona'];

function preparar(f) {
  var p = f.properties, ev = evaluar(p);
  p.e = ev.estado;
  p.color = COLORES[ev.estado];
  p.p = PUNTEADAS[p.capa] ? 1 : 0;
  p.justo = ev.justo ? 1 : 0;
  // lo gris (pasás) no se dibuja salvo "pasás justo" o si se pidió en Capas (como en la app)
  p.ve = ev.estado === 'si' && !ev.justo && !apagadas.ver_gris ? 0 : 1;
  if (f.geometry.type === 'MultiLineString' || f.geometry.type === 'MultiPolygon' || f.geometry.type === 'MultiPoint') {
    return f.geometry.coordinates.map(function (c) {
      return { type: 'Feature', properties: p, geometry: { type: f.geometry.type.replace('Multi', ''), coordinates: c } };
    });
  }
  return [f];
}

var hayCambios = null;
function agregar(features, delPais) {
  features.forEach(function (f) {
    var p = f.properties || {};
    var clave = p.osm ? p.osm + '|' + p.capa : null;
    if (clave && vistas[clave]) return;
    if (clave && !delPais) vistas[clave] = true;
    if (clave && delPais) vistas[clave] = true;
    Array.prototype.push.apply(datos.features, preparar(f));
  });
  clearTimeout(hayCambios);
  hayCambios = setTimeout(function () { mapa.getSource('r').setData(datos); }, 80);
}

var zonas = [], celdas = [], pedidos = {};
function bajarIndices() {
  Promise.all([
    fetch('datos/zonas.json').then(function (r) { return r.json(); }).then(function (z) { zonas = z.zonas || []; }),
    fetch('datos/pais.json').then(function (r) { return r.json(); }).then(function (p) { celdas = p.celdas || []; }).catch(function () {})
  ]).then(cargarVista);
}
function seCruza(lim, b) {
  return !(lim[1][0] < b.getSouth() || lim[0][0] > b.getNorth() || lim[1][1] < b.getWest() || lim[0][1] > b.getEast());
}
function cargarVista() {
  if (mapa.getZoom() < 8) return;
  var b = mapa.getBounds();
  zonas.forEach(function (z) {
    if (!z.limites || !seCruza(z.limites, b)) return;
    [z.archivo, z.normas, z.obstaculos].forEach(function (a) { if (a) bajar(a, false); });
  });
  // el país después de las zonas (así lo repetido queda el de la zona)
  setTimeout(function () {
    celdas.forEach(function (c) { if (seCruza(c.limites, b)) bajar(c.archivo, true); });
  }, 1500);
}
function bajar(archivo, delPais) {
  if (pedidos[archivo]) return;
  pedidos[archivo] = fetch('datos/' + archivo).then(function (r) { return r.json(); })
    .then(function (g) { agregar(g.features || [], delPais); })
    .catch(function () { delete pedidos[archivo]; });
}

// ---- tocar una marca ----
var NOMBRE = { no: 'NO PASÁS', si: 'PASÁS', sin_dato: 'VERIFICÁ EN EL LUGAR', aviso: 'Calle sin salida' };
function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function tocar(ev) {
  var t = 14, pt = ev.point;
  var lista = mapa.queryRenderedFeatures([[pt.x - t, pt.y - t], [pt.x + t, pt.y + t]], { layers: TOCABLES });
  if (!lista.length) return;
  var orden = { no: 0, sin_dato: 1, si: 2, aviso: 3 };
  lista.sort(function (a, b) { return orden[a.properties.e] - orden[b.properties.e]; });
  var p = lista[0].properties;
  var txt = NOMBRE[p.e] + (p.e === 'si' && p.justo ? ' JUSTO (andá despacio)' : '');
  new maplibregl.Popup({ maxWidth: '280px' }).setLngLat(ev.lngLat).setHTML(
    '<b>' + esc(p.titulo) + '</b>' + (p.calle ? esc(p.calle) + '<br>' : '') +
    (p.limite_texto ? 'Límite: ' + esc(p.limite_texto) : '') +
    '<div class="veredicto ' + p.e + '">' + txt + '</div>').addTo(mapa);
}
