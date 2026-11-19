/* Mapa para camiones — lógica de la página.
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
var ZOOM_LUGARES = 13;   // más lejos que esto no se muestran (taparían todo)

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

// ===== 2. Mapa base =====
// Abre donde quedó la última vez; si es la primera vez, en Buenos Aires
var vista = leerGuardado(CLAVE_VISTA);
if (!vista || typeof vista.lat !== 'number' || typeof vista.lng !== 'number' ||
    Math.abs(vista.lat) > 90 || Math.abs(vista.lng) > 180 || typeof vista.zoom !== 'number') vista = null;
var mapa = L.map('mapa', {
  center: vista ? [vista.lat, vista.lng] : CENTRO_INICIAL,
  zoom: vista ? Math.min(Math.max(vista.zoom, 4), 19) : ZOOM_INICIAL,
  minZoom: 4,
  attributionControl: false,  // el crédito de OpenStreetMap está siempre visible en el pie
  // Girar el mapa (agregado leaflet-rotate): con dos dedos en el celular, Shift + rueda en la PC
  rotate: true, touchRotate: true, shiftKeyRotate: true, rotateControl: false, bearing: 0
});
var PUEDE_GIRAR = typeof mapa.setBearing === 'function';   // si el agregado no cargó, el mapa anda igual sin girar

// Capas propias que tienen que girar junto con el mapa (si no, quedan derechas y desfasadas)
function crearPane(nombre) {
  return mapa.createPane(nombre, (PUEDE_GIRAR && mapa.getPane('rotatePane')) || undefined);
}

// Para que no gire sin querer al hacer zoom con dos dedos: recién empieza a girar si los dedos giran más de 20°
var UMBRAL_GIRO = 20;
if (PUEDE_GIRAR && L.Map.TouchGestures) {
  var gestoMover = L.Map.TouchGestures.prototype._onTouchMove;
  L.Map.TouchGestures.prototype._onTouchMove = function (e) {
    // gesto nuevo (todavía no se movió): vuelve a exigir el umbral. Se hace acá y no en _onTouchStart
    // porque el agregado ya registró su _onTouchStart original al crear el mapa.
    if (!this._moved) { this._giroLibre = false; this._angInicio = null; }
    if (this._rotating && !this._giroLibre && e.touches && e.touches.length === 2) {
      var m = this._map;
      var v = m.mouseEventToContainerPoint(e.touches[0]).subtract(m.mouseEventToContainerPoint(e.touches[1]));
      var ang = Math.atan2(v.y, v.x) * 180 / Math.PI;
      if (this._angInicio == null) this._angInicio = ang;
      var dif = Math.abs((((ang - this._angInicio) % 360) + 540) % 360 - 180);
      if (dif < UMBRAL_GIRO) {   // todavía no: solo zoom y movimiento
        this._rotating = false;
        try { gestoMover.call(this, e); } finally { this._rotating = true; }
        return;
      }
      // pasó el umbral: empieza a girar desde acá (sin salto)
      this._giroLibre = true;
      this._startTheta = Math.atan(v.x / v.y);
      this._startBearing = m.getBearing() + (v.y < 0 ? 180 : 0);
    }
    return gestoMover.call(this, e);
  };
}

// Girar el mapa de a poco hasta un ángulo (0 = norte arriba)
var giroAnim = null;
function girarA(destino) {
  if (!PUEDE_GIRAR) return;
  if (giroAnim) cancelAnimationFrame(giroAnim);
  var ini = mapa.getBearing(), d = ((((destino - ini) % 360) + 540) % 360) - 180, t0 = performance.now();
  if (Math.abs(d) < 0.5) { mapa.setBearing(destino); return; }
  (function paso() {
    var k = Math.min(1, (performance.now() - t0) / 350);
    mapa.setBearing(ini + d * (1 - Math.pow(1 - k, 3)));
    giroAnim = k < 1 ? requestAnimationFrame(paso) : null;
  })();
}

// Brújula: aparece cuando el mapa está girado; la aguja roja apunta al norte. Tocarla = norte arriba.
var ControlBrujula = L.Control.extend({
  options: { position: 'bottomright' },
  onAdd: function () {
    var b = L.DomUtil.create('button', 'boton-brujula');
    b.type = 'button';
    b.title = 'Poner el norte arriba';
    b.setAttribute('aria-label', 'Poner el norte arriba');
    b.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">' +
      '<path d="M12 2.5l4.5 9.5h-9z" fill="#d50000"/><path d="M12 21.5l-4.5-9.5h9z" fill="#8a8f98"/>' +
      '<text x="12" y="10.6" text-anchor="middle" font-size="5.5" font-weight="700" fill="#fff" font-family="sans-serif">N</text></svg>';
    L.DomEvent.disableClickPropagation(b);
    L.DomEvent.on(b, 'click', function () {
      if (typeof nav !== 'undefined' && nav.activo && nav.rumbo) cambiarRumbo(false);
      else girarA(0);
    });
    this.boton = b;
    return b;
  }
});
// crossOrigin: así el navegador puede guardar los pedazos del mapa para usarlos sin señal (ver sw.js)
// updateWhenIdle false + keepBuffer: va bajando el mapa mientras lo arrastrás y guarda más alrededor
// (antes en el celular quedaban cuadros grises hasta soltar el dedo)
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, crossOrigin: '', updateWhenIdle: false, keepBuffer: 4
}).addTo(mapa);

// Dibujar en "canvas" es más rápido con miles de elementos, y "tolerance"
// agranda la zona sensible al toque para poder tocar líneas finas con el dedo.
// padding 0.3: dibuja un 30% más alrededor de la pantalla, así al arrastrar no aparecen bordes vacíos
var dibujo = L.canvas({ tolerance: 10, padding: 0.3 });

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
  document.getElementById('camion-resumen').textContent = camion
    ? metros(camion.altura) + ' · ' + toneladas(camion.peso) + ' · ' + metros(camion.largo)
    : 'Cargar medidas';
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
    return { estado: 'no', norma: !!p.peso_desde };
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
// Zonas que tocan este rectángulo y NO se pudieron cargar: una ruta por ahí no está revisada
function zonasSinCargarEn(limites) {
  return zonasEn(limites).filter(function (z) { return !zonasOk[z.id]; }).map(function (z) { return z.titulo; });
}

CAPAS.forEach(function (c) {
  cantidades[c.id] = 0;
  grupos[c.id] = crearCapa([]);
  if (!apagadas[c.id] && c.id !== 'sin_salida') grupos[c.id].addTo(mapa);
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

function cargarZona(z) {
  if (zonasPedidas[z.id]) return zonasPedidas[z.id];
  zonasCargando++;
  mostrarMensaje('Cargando ' + z.titulo + '...');
  // Las restricciones son obligatorias; si fallan los lugares o la red, el mapa anda igual
  zonasPedidas[z.id] = Promise.all([bajarJSON(z.archivo, true), bajarJSON(z.lugares), bajarJSON(z.red), bajarJSON(z.normas), bajarJSON(z.obstaculos)])
    .then(function (r) {
      zonasCargando--;
      // las normas locales (ordenanzas) se suman a las restricciones de OpenStreetMap
      try {
        agregarZona({ zona: z, datos: { features: r[0].features.concat(r[3].features, r[4].features) }, lugares: r[1], red: r[2] });
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
  r.lugares.features.forEach(function (f) {
    var g = gruposLugares[f.properties.tipo];
    if (!g) return;
    g.addData(f);
    cantidadesLugares[f.properties.tipo]++;
  });
  agregarRedPesada(r);
  mostrarLugares();
  ponerRojosArriba();
  armarPanel();
  armarPanelLugares();
  revisarAvisoZona();
}

// Zonas que tocan un rectángulo (con un margen)
function zonasEn(limites) {
  return zonasIndice.filter(function (z) { return z.limites && L.latLngBounds(z.limites).pad(0.05).intersects(limites); });
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
  var visibles = zonasEn(mapa.getBounds().pad(0.2));
  if (!visibles.length && !zonasCargando) {
    // fuera de las ciudades descargadas: se avisa una vez qué hay y qué no
    if (pais.celdas.length) {
      if (pais.avisado) return;
      pais.avisado = true;
      mostrarMensaje('Acá solo hay restricciones cargadas en rutas y calles (alturas, pesos, prohibidos). ' +
                     'Las calles sin salida y los pasos bajos calculados están solo en las ciudades de Capas → "Ir a".');
      setTimeout(function () { if (/^Acá solo hay/.test(m.textContent)) ocultarMensaje(); }, 9000);
      return;
    }
    mostrarMensaje('Todavía no hay datos de esta zona. Las zonas con datos están en Capas → "Ir a".');
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
    pais.timer = setTimeout(function () { ponerRojosArriba(); if (zonasIndice.length) armarPanel(); }, 250);
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
function cargarPaisEnRutas(listas) {
  if (!pais.celdas.length) return Promise.resolve();
  var pedir = {};
  listas.forEach(function (puntos) {
    for (var i = 0; i < puntos.length; i++) {
      var a = puntos[i], b = puntos[i + 1] || a;
      var n = Math.max(1, Math.ceil(L.latLng(a).distanceTo(b) / 20000));   // un punto cada 20 km como mínimo
      for (var k = 0; k < n; k++) {
        var lat = a[0] + (b[0] - a[0]) * k / n, lng = a[1] + (b[1] - a[1]) * k / n;
        pais.celdas.forEach(function (c) {
          if (lat >= c.limites[0][0] && lat <= c.limites[1][0] && lng >= c.limites[0][1] && lng <= c.limites[1][1]) pedir[c.archivo] = c;
        });
      }
    }
  });
  return Promise.all(Object.keys(pedir).map(function (k) { return cargarCeldaPais(pedir[k]); }));
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
        z.aviso = 'En ' + z.titulo + ' casi no hay restricciones cargadas en el mapa (' + cargadas +
                  '). Puede haber calles prohibidas o puentes bajos que no figuran: respetá la señalización.';
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
function crearCapa(features) {
  return L.geoJSON({ type: 'FeatureCollection', features: features }, {
    renderer: dibujo,
    smoothFactor: 1.5,   // simplifica un poco las líneas al dibujar (no se nota y es más rápido)
    style: estiloLinea,
    pointToLayer: function (f, latlng) { return L.circleMarker(latlng, estiloPunto(f)); },
    onEachFeature: function (f, capaLeaflet) {
      capaLeaflet.bindPopup(function (capa) {
        return armarCartel(f.properties) + botonReportar(capa, describirRestriccion(f.properties));
      }, { maxWidth: 290 });
    }
  });
}

// Grosor de las líneas: finas de lejos (para no tapar la ciudad), gruesas de cerca (para tocarlas)
function grosorSegunZoom(estado) {
  var z = mapa.getZoom();
  var base = z <= 11 ? 1.5 : z <= 12 ? 2 : z <= 13 ? 3 : z <= 14 ? 4 : 5;
  return estado === 'no' ? base + 1.5 : estado === 'si' ? Math.max(1, base - 1) : base;
}

function estiloLinea(f) {
  var estado = evaluar(f.properties).estado;
  var lejos = mapa.getZoom() <= 13;
  return {
    renderer: dibujo,
    color: COLORES[estado],
    weight: grosorSegunZoom(estado),
    opacity: estado === 'no' ? 1 : estado === 'si' ? 0.5 : lejos ? 0.75 : 0.95,
    lineCap: 'round',
    dashArray: CAPA_POR_ID[f.properties.capa].forma === 'punteada' || (f.properties.capa === 'corte' && estado !== 'no') ? '8 6' : null,
    fill: f.geometry.type === 'Polygon',
    fillColor: COLORES[estado],
    fillOpacity: estado === 'si' ? 0.04 : 0.12
  };
}

// De lejos los puntos se achican para no tapar el mapa; de cerca se agrandan para tocarlos fácil
function radioSegunZoom() {
  var z = mapa.getZoom();
  return z <= 11 ? 2 : z <= 12 ? 2.5 : z <= 13 ? 4 : z <= 14 ? 5.5 : 7.5;
}

function estiloPunto(f) {
  var estado = evaluar(f.properties).estado;
  var r = radioSegunZoom() + (estado === 'no' ? 0.5 : 0);
  return {
    renderer: dibujo,
    radius: r,
    color: '#ffffff',
    weight: r < 4 ? 0.5 : r < 6 ? 1 : 2,
    fillColor: COLORES[estado],
    fillOpacity: estado === 'si' ? 0.6 : 0.95
  };
}

// Volver a pintar todo (cuando cambian las medidas, o el zoom cambia lo suficiente para cambiar el grosor)
var tramoPintado = null;
function tramoZoom() { return Math.max(11, Math.min(15, Math.ceil(mapa.getZoom()))); }
function repintar() {
  Object.keys(grupos).forEach(function (id) {
    grupos[id].eachLayer(function (l) {
      l.setStyle(l.setRadius ? estiloPunto(l.feature) : estiloLinea(l.feature));
    });
  });
  ponerRojosArriba();
  tramoPintado = tramoZoom();
}
// Antes se repintaba todo (miles de elementos) en cada zoom: en el celular trababa el mapa al soltar los dedos
mapa.on('zoomend', function () {
  if (tramoZoom() !== tramoPintado) repintar();
  mostrarSinSalida();
});

// Las calles sin salida (miles de puntos violetas) se ven solo de cerca: de lejos tapan todo y hacen lento el mapa
var ZOOM_SIN_SALIDA = 13;
function mostrarSinSalida() {
  var g = grupos.sin_salida;
  if (!g) return;
  var ver = !apagadas.sin_salida && mapa.getZoom() >= ZOOM_SIN_SALIDA;
  if (ver && !mapa.hasLayer(g)) g.addTo(mapa);
  if (!ver && mapa.hasLayer(g)) mapa.removeLayer(g);
}
mostrarSinSalida();

// Lo que no pasás se dibuja encima de todo lo demás, para que no quede tapado
// Borde blanco abajo de las líneas rojas: así se distinguen de las avenidas (que en el mapa de fondo son
// rosadas/naranjas) y se ven mejor. Va en su propio "canvas", arriba de la ruta y abajo de las restricciones.
crearPane('bordeRojo').style.zIndex = 395;
var dibujoBorde = L.canvas({ pane: 'bordeRojo', padding: 0.3 });
var bordesRojos = L.layerGroup().addTo(mapa);
function armarBordesRojos() {
  bordesRojos.clearLayers();
  var grosor = grosorSegunZoom('no') + 4;
  Object.keys(grupos).forEach(function (id) {
    if (!mapa.hasLayer(grupos[id])) return;
    grupos[id].eachLayer(function (l) {
      if (l.setRadius || !l.getLatLngs || l.feature.geometry.type === 'Polygon') return;
      if (evaluar(l.feature.properties).estado !== 'no') return;
      bordesRojos.addLayer(L.polyline(l.getLatLngs(), {
        renderer: dibujoBorde, pane: 'bordeRojo', color: '#ffffff', weight: grosor, opacity: 0.95,
        lineCap: 'round', lineJoin: 'round', smoothFactor: 1.5, interactive: false
      }));
    });
  });
}

function ponerRojosArriba() {
  armarBordesRojos();
  Object.keys(grupos).forEach(function (id) {
    if (!mapa.hasLayer(grupos[id])) return;
    grupos[id].eachLayer(function (l) {
      if (evaluar(l.feature.properties).estado === 'no') l.bringToFront();
    });
  });
}

// ===== 7. Cartel al tocar =====
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
  } else if (p.capa === 'prohibido') {
    titulo = 'NO PODÉS CIRCULAR: prohibido para camiones';
    if (p.peso_desde && camion) nota = 'Es para camiones de más de ' + toneladas(p.peso_desde) + ' y el tuyo pesa ' + toneladas(camion.peso) + '.';
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
function crearCapaLugares(features) {
  return L.geoJSON({ type: 'FeatureCollection', features: features }, {
    pointToLayer: function (f, latlng) {
      var tipo = LUGAR_POR_ID[f.properties.tipo];
      return L.marker(latlng, {
        icon: L.divIcon({
          className: 'lugar-marca',
          html: '<span class="lugar-icono">' + tipo.icono + '</span>',
          iconSize: [36, 36],
          iconAnchor: [18, 18],
          popupAnchor: [0, -16]
        }),
        title: tipo.nombre + (f.properties.nombre ? ': ' + f.properties.nombre : ''),
        keyboard: false
      });
    },
    onEachFeature: function (f, capaLeaflet) {
      capaLeaflet.bindPopup(function (capa) {
        var p = f.properties, tipo = LUGAR_POR_ID[p.tipo];
        return armarCartelLugar(f) + botonReportar(capa, tipo.uno + (p.nombre ? ' ' + p.nombre : '') + ' (' + p.osm + ')');
      }, { maxWidth: 290 });
    }
  });
}

// Muestra los tipos prendidos, pero solo de cerca
function mostrarLugares() {
  var cerca = mapa.getZoom() >= ZOOM_LUGARES;
  LUGARES.forEach(function (l) {
    var g = gruposLugares[l.id];
    if (!g) return;
    var ver = cerca && lugaresPrendidos[l.id];
    if (ver && !mapa.hasLayer(g)) g.addTo(mapa);
    if (!ver && mapa.hasLayer(g)) mapa.removeLayer(g);
  });
}
mapa.on('zoomend', mostrarLugares);

function armarCartelLugar(f) {
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

  var c = f.geometry.coordinates;   // [longitud, latitud]
  html += '<a class="cartel-boton" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&amp;destination=' +
          c[1] + ',' + c[0] + '">Cómo llegar (Google Maps)</a>';
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
      if (ev.target.checked && mapa.getZoom() < ZOOM_LUGARES) {
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

function botonReportar(capa, que) {
  var popup = capa.getPopup && capa.getPopup();
  var ll = (popup && popup.getLatLng()) || (capa.getLatLng && capa.getLatLng());
  var url = ll && linkFormulario(ll, que);
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
  L.popup({ maxWidth: 260 }).setLatLng(e.latlng).setContent(caja).openOn(mapa);
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
    pointToLayer: function (f, latlng) {
      return L.marker(latlng, {
        icon: L.divIcon({ className: 'lugar-marca', html: '<span class="lugar-icono reporte">📣</span>',
                          iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -16] }),
        title: 'Reporte: ' + f.properties.tipo, keyboard: false
      });
    },
    onEachFeature: function (f, capa) {
      capa.bindPopup(function () { return armarCartelReporte(f.properties); }, { maxWidth: 290 });
    }
  });
  if (!apagadas.reportes) grupoReportes.addTo(mapa);
}

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
    if (ev.target.checked) { if (grupoReportes) grupoReportes.addTo(mapa); delete apagadas.reportes; }
    else { if (grupoReportes) mapa.removeLayer(grupoReportes); apagadas.reportes = true; }
    guardar(CLAVE_CAPAS, apagadas);
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
  fitosanitario: { nombre: 'Control fitosanitario',   icono: '🌾' }
};
var ZOOM_CONTROLES = 9;
var controles = { lista: [], grupo: L.layerGroup(), actualizado: null };

fetch('datos/controles.geojson', { cache: 'no-cache' })
  .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
  .then(function (d) {
    controles.actualizado = d.actualizado;
    controles.lista = (d.features || []).map(function (f) {
      var c = f.geometry.coordinates;
      return { f: f, latlng: L.latLng(c[1], c[0]), marca: null };
    });
    if (!apagadas.controles) controles.grupo.addTo(mapa);
    mostrarControles();
    if (zonasIndice.length) armarPanel();
  })
  .catch(function (e) { console.warn('Sin controles policiales:', e); });

function marcaControl(item) {
  var p = item.f.properties, tipo = CONTROLES[p.tipo] || CONTROLES.policial;
  var m = L.marker(item.latlng, {
    icon: L.divIcon({ className: 'lugar-marca', html: '<span class="lugar-icono control">' + tipo.icono + '</span>',
                      iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -16] }),
    title: tipo.nombre + (p.nombre ? ': ' + p.nombre : ''),
    keyboard: false
  });
  m.feature = item.f;
  m.bindPopup(function (capa) {
    return armarCartelControl(p) + botonReportar(capa, tipo.nombre + (p.nombre ? ' ' + p.nombre : '') + ' (' + p.osm + ')');
  }, { maxWidth: 290 });
  return m;
}

// Pone en el mapa solo los controles que están en la vista (con un margen), y solo de no tan lejos
function mostrarControles() {
  if (!controles.lista.length) return;
  var ver = mapa.getZoom() >= ZOOM_CONTROLES && mapa.hasLayer(controles.grupo);
  var caja = mapa.getBounds().pad(0.5);
  controles.lista.forEach(function (it) {
    var adentro = ver && caja.contains(it.latlng);
    if (adentro && !it.marca) { it.marca = marcaControl(it); controles.grupo.addLayer(it.marca); }
    else if (!adentro && it.marca && !it.marca.isPopupOpen()) { controles.grupo.removeLayer(it.marca); it.marca = null; }
  });
}
mapa.on('moveend', mostrarControles);

function armarCartelControl(p) {
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
    if (mejor <= 60) res.push({ item: it, orden: idx, t: tMejor });
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
  celda.capas.forEach(function (l) {
    if (l.isPopupOpen && l.isPopupOpen()) mapa.closePopup();
    grupos.corte.removeLayer(l);
  });
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
  cortes.timer = setTimeout(function () { ponerRojosArriba(); if (zonasIndice.length) armarPanel(); }, 250);
}

// Al tocar un corte: entre qué calles es (un pedido de detalle por corte tocado, y queda guardado)
var detallesCorte = {};
grupos.corte.on('popupopen', function (e) {
  var l = e.layer || e.propagatedFrom, p = l && l.feature && l.feature.properties;
  if (!p || !p.id_tomtom || p.calle || !claveTomTom()) return;
  var poner = function (d) {
    if (!d) return;
    p.calle = d.calle;
    if (d.hasta && !p.hasta) p.hasta = d.hasta;
    p.detalle = detalleCorte(p.eventos, p.hasta, p.una_mano);
    if (e.popup && e.popup.isOpen()) e.popup.update();
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
});

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
function armarPanel() {
  var lista = document.getElementById('lista-capas');
  var leyenda =
    '<div class="leyenda">' +
      '<span><i style="background:' + COLORES.no + '"></i>No pasás</span>' +
      '<span><i style="background:' + COLORES.si + '"></i>Pasás</span>' +
      '<span><i style="background:' + COLORES.sin_dato + '"></i>Sin dato: verificar</span>' +
      '<span><i style="background:' + COLORES.aviso + '"></i>Sin salida</span>' +
    '</div>';
  lista.innerHTML = '<li>' + leyenda + '</li>';
  CAPAS.forEach(function (c) {
    var noPasa = 0;
    if (grupos[c.id]) grupos[c.id].eachLayer(function (l) { if (evaluar(l.feature.properties).estado === 'no') noPasa++; });
    var vacia = cantidades[c.id] === 0 && c.id !== 'corte';
    var muestra = c.id === 'sin_salida' ? COLORES.aviso : '#3d4652';
    var cuenta = vacia ? 'Sin datos en esta zona'
      : cantidades[c.id].toLocaleString('es-AR') + ' en el mapa' +
        (MEDIDA_DE_CAPA[c.id] && camion ? ' · no pasás en ' + noPasa.toLocaleString('es-AR') : '') +
        (c.id === 'sin_salida' ? ' · se ven al acercar el mapa' : '');
    if (c.id === 'corte') {
      if (!claveTomTom()) return;
      cuenta = (cantidades.corte ? cantidades.corte.toLocaleString('es-AR') + ' cerca de lo que miraste · ' : 'Se ven al acercar el mapa · ') +
               'datos de TomTom, se actualizan cada 10 minutos';
    }
    var li = document.createElement('li');
    li.innerHTML =
      '<label' + (vacia ? ' class="capa-vacia"' : '') + '>' +
        '<input type="checkbox"' + (apagadas[c.id] ? '' : ' checked') + '>' +
        '<span class="muestra ' + c.forma + '" style="--c:' + muestra + '"></span>' +
        '<span class="capa-texto">' + esc(c.nombre) +
          '<br><span class="capa-cantidad">' + cuenta + '</span></span>' +
      '</label>';
    li.querySelector('input').addEventListener('change', function (ev) {
      if (ev.target.checked) { grupos[c.id].addTo(mapa); delete apagadas[c.id]; ponerRojosArriba(); if (c.id === 'corte') mostrarCortes(); }
      else { mapa.removeLayer(grupos[c.id]); apagadas[c.id] = true; armarBordesRojos(); }
      guardar(CLAVE_CAPAS, apagadas);
      if (c.id === 'sin_salida') {
        mostrarSinSalida();
        if (ev.target.checked && mapa.getZoom() < ZOOM_SIN_SALIDA) { mostrarMensaje('Acercá el mapa para ver las calles sin salida.'); setTimeout(ocultarMensaje, 3000); }
      }
    });
    lista.appendChild(li);
  });
  if (redPesada.grupo) {
    var liRed = document.createElement('li');
    liRed.innerHTML =
      '<label><input type="checkbox"' + (apagadas.red_pesada ? '' : ' checked') + '>' +
        '<span class="muestra linea" style="--c:#2e7d32"></span>' +
        '<span class="capa-texto">Red de tránsito pesado<br><span class="capa-cantidad">' +
        (redPesada.km ? redPesada.km.toLocaleString('es-AR') + ' km · ' : '') +
        'calles marcadas para camiones (solo Buenos Aires)</span></span></label>';
    liRed.querySelector('input').addEventListener('change', function (ev) {
      if (ev.target.checked) { redPesada.grupo.addTo(mapa); delete apagadas.red_pesada; }
      else { mapa.removeLayer(redPesada.grupo); apagadas.red_pesada = true; }
      guardar(CLAVE_CAPAS, apagadas);
    });
    lista.appendChild(liRed);
  }
  if (controles.lista.length) {
    var liCon = document.createElement('li');
    liCon.innerHTML =
      '<label><input type="checkbox"' + (apagadas.controles ? '' : ' checked') + '>' +
        '<span class="muestra-lugar">👮</span>' +
        '<span class="capa-texto">Controles policiales fijos<br><span class="capa-cantidad">' +
        controles.lista.length.toLocaleString('es-AR') + ' en todo el país · se ven al acercar el mapa</span></span></label>';
    liCon.querySelector('input').addEventListener('change', function (ev) {
      if (ev.target.checked) { controles.grupo.addTo(mapa); delete apagadas.controles; mostrarControles(); }
      else { mapa.removeLayer(controles.grupo); apagadas.controles = true; }
      guardar(CLAVE_CAPAS, apagadas);
    });
    lista.appendChild(liCon);
  }
  var fechas = zonasCargadas.map(function (z) { return z.zona.titulo + ': ' + fecha(z.zona.actualizado); });
  if (pais.cargadas && pais.actualizado) fechas.push('Rutas y resto del país: ' + fecha(pais.actualizado));
  var nota = document.getElementById('nota-datos');
  nota.textContent = 'Datos actualizados — ' + fechas.join(' · ');
  zonasCargadas.forEach(function (z) {
    if (!z.zona.aviso) return;
    var p = document.createElement('span');
    p.className = 'nota-aviso';
    p.textContent = '⚠ ' + z.zona.aviso;
    nota.appendChild(p);
  });
  armarBotonesZonas();
}

// Botones "Ir a:" para saltar a cada zona (solo si hay más de una)
function armarBotonesZonas() {
  var caja = document.getElementById('ir-zonas');
  if (!caja) return;   // index.html viejo guardado en el celular
  caja.innerHTML = '';
  var conLimites = zonasIndice.map(function (z) { return { zona: z }; });
  if (conLimites.length < 2) { caja.hidden = true; return; }
  var titulo = document.createElement('span');
  titulo.className = 'ir-zonas-titulo';
  titulo.textContent = 'Ir a:';
  caja.appendChild(titulo);
  conLimites.forEach(function (z) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'boton-zona';
    b.textContent = z.zona.titulo;
    b.addEventListener('click', function () {
      abrirPanel(false);
      var ir = z.zona.ir_a;
      if (ir && ir.centro) mapa.setView(ir.centro, ir.zoom || 13);
      else mapa.fitBounds(z.zona.limites);
    });
    caja.appendChild(b);
  });
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
    mostrarMensaje('⚠ ' + z.zona.aviso + ' (tocá para cerrar)');
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
  botonCapas.setAttribute('aria-expanded', abrir ? 'true' : 'false');
}
botonCapas.addEventListener('click', function () { abrirPanel(panel.hidden); });
document.getElementById('cerrar-capas').addEventListener('click', function () { abrirPanel(false); });
mapa.on('click', function () { abrirPanel(false); });

// ===== 9. Mi ubicación (punto azul) =====
// El primer toque busca la ubicación y centra el mapa; después el punto se va moviendo solo.
// Los toques siguientes vuelven a centrar el mapa en donde estás.
crearPane('ubicacion');
mapa.getPane('ubicacion').style.zIndex = 450;   // arriba de las restricciones
var ubicacion = { punto: null, precision: null, ultima: null, buscando: false };

var ControlUbicacion = L.Control.extend({
  options: { position: 'bottomright' },
  onAdd: function () {
    var boton = L.DomUtil.create('button', 'boton-ubicacion');
    boton.type = 'button';
    boton.title = 'Mi ubicación';
    boton.setAttribute('aria-label', 'Mostrar mi ubicación');
    boton.innerHTML =
      '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="4" fill="currentColor"/>' +
      '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2"/></svg>';
    L.DomEvent.disableClickPropagation(boton);
    L.DomEvent.on(boton, 'click', tocarUbicacion);
    this.boton = boton;
    return boton;
  }
});
var controlUbicacion = new ControlUbicacion().addTo(mapa);
// la brújula va arriba del botón de ubicación, y solo se ve con el mapa girado (o manejando)
var controlBrujula = PUEDE_GIRAR ? new ControlBrujula().addTo(mapa) : null;
function ponerBrujula() {
  if (!controlBrujula) return;
  var g = mapa.getBearing();
  var girado = Math.abs(((g % 360) + 360) % 360) > 0.5 && Math.abs(((g % 360) + 360) % 360 - 360) > 0.5;
  controlBrujula.boton.hidden = !girado && !(typeof nav !== 'undefined' && nav.activo);
  controlBrujula.boton.firstChild.style.transform = 'rotate(' + g + 'deg)';
}
if (controlBrujula) { mapa.on('rotate', ponerBrujula); ponerBrujula(); }

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
    ubicacion.precision = L.circle(e.latlng, {
      pane: 'ubicacion', radius: e.accuracy, color: '#1a73e8', weight: 1, opacity: 0.4,
      fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false
    }).addTo(mapa);
    ubicacion.punto = L.circleMarker(e.latlng, {
      pane: 'ubicacion', radius: 9, color: '#ffffff', weight: 3,
      fillColor: '#1a73e8', fillOpacity: 1, interactive: false
    }).addTo(mapa);
  } else {
    ubicacion.punto.setLatLng(e.latlng);
    ubicacion.precision.setLatLng(e.latlng).setRadius(e.accuracy);
  }
  if (primera) {
    ubicacion.buscando = false;
    controlUbicacion.boton.classList.remove('buscando');
    controlUbicacion.boton.classList.add('activo');
    ocultarMensaje();
    mapa.setView(e.latlng, Math.max(mapa.getZoom(), 16));
  }
});

mapa.on('locationerror', function (e) {
  if (ubicacion.ultima) return;   // ya teníamos una ubicación; un error suelto no importa
  ubicacion.buscando = false;
  controlUbicacion.boton.classList.remove('buscando');
  mapa.stopLocate();
  var texto = e.code === 1
    ? 'No diste permiso para ver tu ubicación. Activalo en la configuración del navegador (ícono del candado, al lado de la dirección) y volvé a tocar el botón.'
    : e.code === 3
      ? 'Tardó demasiado en encontrar tu ubicación. Revisá que el GPS esté prendido y volvé a probar.'
      : 'No pude encontrar tu ubicación. Revisá que el GPS esté prendido y volvé a probar.';
  mostrarMensaje(texto, true);
  setTimeout(ocultarMensaje, 8000);
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
  config: null
};
var CAMION_ANCHO = 2.6;   // ancho legal; el formulario no lo pide

crearPane('ruta');
mapa.getPane('ruta').style.zIndex = 390;   // debajo de las restricciones: lo rojo se sigue viendo

fetch('datos/ruta_config.json', { cache: 'no-cache' })
  .then(function (r) { return r.ok ? r.json() : null; })
  .then(function (c) { ruta.config = c; mostrarCortes(); if (zonasIndice.length) armarPanel(); })
  .catch(function () { /* sin config: se usa Valhalla */ });

var panelRuta = document.getElementById('panel-ruta');

function abrirPanelRuta(abrir) {
  if (!panelRuta) return;
  if (abrir) abrirPanel(false);
  panelRuta.hidden = !abrir;
  if (abrir) prepararRuta();
}

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
  ponerPunto(cual, latlng, nombre);
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
if (panelRuta) new ControlRuta().addTo(mapa);

// --- Elegir los puntos ---
function ponerPunto(cual, latlng, nombre) {
  ruta[cual] = { latlng: L.latLng(latlng), nombre: nombre || coordenadas(latlng) };
  var input = document.getElementById('ruta-' + cual);
  if (input) input.value = ruta[cual].nombre;
  var lista = document.getElementById('resultados-' + cual);
  if (lista) { lista.hidden = true; lista.innerHTML = ''; }
  if (ruta.marcas[cual]) mapa.removeLayer(ruta.marcas[cual]);
  ruta.marcas[cual] = L.marker(ruta[cual].latlng, {
    icon: L.divIcon({ className: 'lugar-marca', html: '<span class="ruta-marca ' + cual + '">' + (cual === 'desde' ? 'A' : 'B') + '</span>',
                      iconSize: [34, 34], iconAnchor: [17, 17] }),
    keyboard: false, interactive: false
  }).addTo(mapa);
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
  sugerencia.timer = setTimeout(function () { buscarPhoton(cual, texto, inmediato); }, inmediato ? 0 : 350);
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

function buscarPhoton(cual, texto, conRespaldo) {
  var lista = document.getElementById('resultados-' + cual);
  if (sugerencia.ctrl) sugerencia.ctrl.abort();
  var ctrl = sugerencia.ctrl = window.AbortController ? new AbortController() : null;
  var c = mapa.getCenter();
  var url = 'https://photon.komoot.io/api/?limit=6&bbox=-73.6,-55.1,-53.6,-21.7' +
            '&lat=' + c.lat.toFixed(3) + '&lon=' + c.lng.toFixed(3) + '&q=' + encodeURIComponent(texto);
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
        if (conRespaldo) buscarNominatim(cual, texto);
        else lista.hidden = true;
        return;
      }
      mostrarOpciones(cual, res);
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
  var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=ar&accept-language=es' +
            '&viewbox=' + [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].map(function (n) { return n.toFixed(4); }).join(',') +
            '&q=' + encodeURIComponent(texto);
  fetch(url)
    .then(function (r) { if (!r.ok) throw new Error('buscador ' + r.status); return r.json(); })
    .then(function (res) {
      if (!res.length) {
        lista.innerHTML = '<li class="ruta-cargando">No encontré esa dirección. Probá con calle, número y ciudad, o tocá el lugar en el mapa.</li>';
        return;
      }
      mostrarOpciones(cual, res.map(function (r) {
        return { nombre: r.display_name.split(', ').slice(0, 4).join(', '), lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
      }));
    })
    .catch(function () { lista.innerHTML = '<li class="ruta-cargando">No pude buscar. Revisá la conexión.</li>'; });
}
function buscarDireccion(cual) { sugerir(cual, true); }

if (panelRuta) {
  document.getElementById('cerrar-ruta').addEventListener('click', function () { abrirPanelRuta(false); });
  document.getElementById('desde-ubicacion').addEventListener('click', usarMiUbicacion);
  ['desde', 'hasta'].forEach(function (cual) {
    document.querySelector('[data-buscar="' + cual + '"]').addEventListener('click', function () { buscarDireccion(cual); });
    document.querySelector('[data-tocar="' + cual + '"]').addEventListener('click', function () { empezarATocar(cual); });
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
  });
  document.getElementById('calcular-ruta').addEventListener('click', calcularRuta);
  document.getElementById('borrar-ruta').addEventListener('click', borrarRuta);
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
  var numero = ruta.numeroCalculo = (ruta.numeroCalculo || 0) + 1;
  var desde = ruta.desde.latlng, hasta = ruta.hasta.latlng;
  var largo = desde.distanceTo(hasta) / 1000 > VIAJE_LARGO_KM;

  cargarZonasEn(L.latLngBounds([desde, hasta]).pad(largo ? 0 : 0.1))
    .then(function () {
      if (!largo) return calcularTramo(desde, hasta, salida, true);
      return calcularViajeLargo(desde, hasta, salida);
    })
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

// Pide el camino entre a y b (hasta 3 opciones)
function pedirCaminos(a, b, evitar, conAlternativas) {
  var clave = ruta.config && ruta.config.ors_clave;
  return clave
    ? rutaORS(clave, evitar, !conAlternativas, a, b).catch(function (e) {
        console.warn('OpenRouteService falló:', e.message);
        return rutaValhalla(evitar, a, b);
      })
    : rutaValhalla(evitar, a, b);
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
  function vuelta(n, evitar, claves, anteriores) {
    return pedirCaminos(a, b, evitar, conAlternativas).then(function (caminos) {
      var todo = L.latLngBounds([]);
      caminos.forEach(function (c) { todo.extend(L.latLngBounds(c.puntos)); });
      var listas = caminos.map(function (c) { return c.puntos; });
      return Promise.all([cargarZonasEn(todo), cargarCortesEn(listas), cargarPaisEnRutas(listas)])
        .then(function () { return caminos; });
    }).then(function (caminos) {
      caminos.forEach(function (c) {
        c.avisos = revisarRuta(c.puntos, c.pasos);
        c.rojos = c.avisos.filter(function (x) { return x.rojo; }).length;
        // lugares que se pidió esquivar y por los que este camino ya no pasa
        c.esquivados = Object.keys(lugares).filter(function (k) {
          return !c.avisos.some(function (x) { return x.clave === k && x.rojo; });
        }).length;
        c.sinRevisar = zonasSinCargarEn(L.latLngBounds(c.puntos));
      });
      var limpios = caminos.filter(function (c) { return !c.avisos.some(function (x) { return x.zonas && x.zonas.length; }); });
      if (limpios.length || n >= MAX_VUELTAS) return caminos;
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
    }, function (e) {
      if (anteriores) return anteriores;   // no hay otros: se muestran los anteriores con el aviso
      throw e;
    });
  }
  var lugares = {};   // lugares (no zonas de ordenanza) que se pidió esquivar
  return vuelta(1, inicio.zonas, inicio.claves, null);
}

function calcularViajeLargo(desde, hasta, salida) {
  salida.innerHTML = '<p class="ruta-cargando">Viaje largo: buscando el recorrido...</p>';
  return pedirCaminos(desde, hasta, [], false).then(function (caminos) {
    var base = caminos[0];
    // distancia acumulada a lo largo del recorrido
    var acum = [0];
    for (var i = 1; i < base.puntos.length; i++) acum.push(acum[i - 1] + L.latLng(base.puntos[i - 1]).distanceTo(base.puntos[i]) / 1000);
    var total = acum[acum.length - 1];
    var corte = Math.min(TRAMO_CIUDAD_KM, total / 3);
    var i1 = acum.findIndex(function (d) { return d >= corte; });
    var i2 = acum.findIndex(function (d) { return d >= total - corte; });
    var p1 = L.latLng(base.puntos[i1]), p2 = L.latLng(base.puntos[i2]);
    salida.innerHTML = '<p class="ruta-cargando">Viaje largo: revisando la salida y la llegada para tu camión...</p>';
    // cargar las zonas de todo el recorrido (para revisar el tramo del medio)
    return Promise.all([cargarZonasEn(L.latLngBounds(base.puntos)), cargarCortesEn([base.puntos]), cargarPaisEnRutas([base.puntos])]).then(function () {
      return Promise.all([calcularTramo(desde, p1, null, true), calcularTramo(p2, hasta, null, true)]);
    }).then(function (r) {
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
      c.sinRevisar = zonasSinCargarEn(L.latLngBounds(c.puntos));
      return [c];
    });
  });
}

// --- Elegir el camino más fácil para un camión ---
// Puntaje en "minutos equivalentes" (más bajo = mejor):
//   minutos del servicio
//   + 3 por cada km por calles chicas (de barrio)
//   + 0,7 por cada vuelta (giro a la derecha o a la izquierda)
//   + 2 por cada km FUERA de la red de tránsito pesado, solo en las zonas que la tienen cargada
//   + 1000 por cada lugar rojo que no se pudo esquivar
var PUNTAJE = { kmCallesChicas: 3, vuelta: 0.7, kmFueraDeRed: 2, rojo: 1000 };

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
        var pasos = [], vueltas = 0;
        (f.properties.segments || []).forEach(function (s) {
          (s.steps || []).forEach(function (p) {
            // OpenRouteService a veces dice "Camina hacia..." aunque sea en camión
            var esVuelta = p.type >= 0 && p.type <= 3;   // izquierda, derecha, cerrada a la izq./der.
            pasos.push({ texto: String(p.instruction).replace(/^Camin[ae] /, 'Salí '), km: p.distance,
                         ini: p.way_points ? p.way_points[0] : null, vuelta: esVuelta });
            if (esVuelta) vueltas++;
          });
        });
        var c = f.geometry.coordinates, kmChicas = 0;
        var tipos = f.properties.extras && f.properties.extras.waytype;
        if (tipos) tipos.values.forEach(function (v) {   // [desde, hasta, tipo]; tipo 3 = "Street" (calle de barrio)
          if (v[2] !== 3) return;
          for (var i = v[0] + 1; i <= v[1]; i++) kmChicas += L.latLng(c[i - 1][1], c[i - 1][0]).distanceTo([c[i][1], c[i][0]]) / 1000;
        });
        return {
          servicio: 'OpenRouteService',
          puntos: c.map(function (p) { return [p[1], p[0]]; }),
          km: f.properties.summary.distance, segundos: f.properties.summary.duration,
          pasos: pasos, vueltas: vueltas, kmChicas: kmChicas
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
    if (chicos.length) cuerpo.exclude_locations = chicos.slice(-50).map(function (anillo) {
      return { lat: (anillo[0][1] + anillo[2][1]) / 2, lon: (anillo[0][0] + anillo[2][0]) / 2 };
    });
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
          pasos.push({ texto: m.instruction, km: m.length, ini: base + (m.begin_shape_index || 0), vuelta: esVuelta });
          if (esVuelta) vueltas++;
        });
      });
      return { servicio: 'Valhalla (servicio de respaldo, menos confiable)', puntos: puntos,
               km: trip.summary.length, segundos: trip.summary.time, pasos: pasos, vueltas: vueltas, kmChicas: null };
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
  (ruta.lineas || []).forEach(function (l) { mapa.removeLayer(l); });
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
  var salida = document.getElementById('ruta-resultado');
  salida.hidden = false;
  salida.innerHTML = '<p class="ruta-aviso">Cambiaste las medidas del camión. Tocá "Calcular ruta para mi camión" de nuevo.</p>';
}

function borrarRuta() {
  quitarLineasRuta();
  ruta.opciones = null;
  ['desde', 'hasta'].forEach(function (cual) {
    if (ruta.marcas[cual]) mapa.removeLayer(ruta.marcas[cual]);
    ruta.marcas[cual] = null; ruta[cual] = null;
    var input = document.getElementById('ruta-' + cual);
    if (input) input.value = '';
  });
  var salida = document.getElementById('ruta-resultado');
  if (salida) { salida.hidden = true; salida.innerHTML = ''; }
  document.getElementById('borrar-ruta').hidden = true;
}

function mostrarRuta(indice, sinMoverMapa) {
  var opciones = ruta.opciones;
  var r = opciones[indice];
  ruta.elegida = indice;
  quitarLineasRuta();
  // la otra opción, en gris finito, para que se vea por dónde iría
  opciones.forEach(function (o, i) {
    if (i === indice) return;
    ruta.lineas.push(L.polyline(o.puntos, { pane: 'ruta', color: '#5b6470', weight: 5, opacity: 0.55, dashArray: '8 8', interactive: false }).addTo(mapa));
  });
  ruta.lineas.push(L.polyline(r.puntos, { pane: 'ruta', color: '#ffffff', weight: 11, opacity: 0.9, interactive: false }).addTo(mapa));
  ruta.linea = L.polyline(r.puntos, { pane: 'ruta', color: '#1565c0', weight: 7, opacity: 0.85, interactive: false }).addTo(mapa);
  ruta.lineas.push(ruta.linea);
  document.getElementById('borrar-ruta').hidden = false;

  var html = '';
  if (opciones.length > 1) {
    html += '<div class="ruta-opciones">';
    opciones.forEach(function (o, i) {
      html += '<button type="button" data-opcion="' + i + '" class="ruta-opcion' + (i === indice ? ' elegida' : '') + '">' +
              '<b>' + esc(o.etiqueta) + '</b>' + numero(o.km, 1) + ' km · ' + duracion(o.segundos) +
              '<small>' + resumenFacilidad(o) + '</small></button>';
    });
    html += '</div>';
  }
  html += '<button type="button" id="empezar-manejo" class="boton-manejar">▶ Manejar con voz</button>';
  html += '<div class="ruta-resumen"><b>' + numero(r.km, 1) + ' km</b> · unos ' + duracion(r.segundos) +
          '<small>' + (opciones.length > 1 ? '' : resumenFacilidad(r) + '. ') +
          'Tiempo de auto: con camión puede ser más. Calculada por ' + esc(r.servicio) +
          ' con tus medidas (' + metros(camion.altura) + ', ' + toneladas(camion.peso) + ', ' + metros(camion.largo) + ').</small></div>';
  var avisos = r.avisos || [];
  if (r.esquivados) {
    html += '<p class="ruta-ok">Esquivé ' + r.esquivados + (r.esquivados === 1 ? ' lugar' : ' lugares') +
            ' donde tu camión no pasa (pasos bajos o reportes que el servicio de rutas no conocía).</p>';
  }
  if (r.sinRevisar && r.sinRevisar.length) {
    html += '<div class="ruta-peligro"><b>NO PUDE REVISAR esta ruta</b> en ' + esc(r.sinRevisar.join(', ')) +
            ': no se cargaron los datos (¿mala señal?). Puede pasar por lugares donde tu camión no pasa. ' +
            'Revisá la conexión y volvé a calcular.</div>';
  }
  if (r.rojos) {
    html += '<div class="ruta-peligro"><b>CUIDADO: no encontré una ruta que evite todo.</b> Esta ruta pasa por ' + r.rojos +
            (r.rojos === 1 ? ' lugar' : ' lugares') + ' donde según el mapa NO PASÁS. No la uses tal cual: ' +
            'elegí otro punto de salida o llegada, o buscá otro camino.</div>';
  }
  if (avisos.length) {
    html += '<div class="ruta-aviso"><b>Ojo: la ruta pasa por ' + avisos.length + (avisos.length === 1 ? ' punto' : ' puntos') +
            ' para revisar</b> (tocalos para verlos):</div><ul class="ruta-lista">';
    avisos.forEach(function (a, i) {
      html += '<li><button type="button" data-aviso="' + i + '"><i style="background:' + a.color + '"></i>' + esc(a.texto) + '</button></li>';
    });
    html += '</ul>';
  } else if (!(r.sinRevisar && r.sinRevisar.length)) {
    html += '<p class="ruta-ok">No encontré pasos bajos ni reportes sobre esta ruta. Igual respetá la señalización.</p>';
  }
  r.controles = controlesEnRuta(r.puntos);
  if (r.controles.length) {
    html += '<details class="ruta-pasos"><summary>👮 Controles policiales en el camino (' + r.controles.length + ')</summary><ul class="ruta-lista">';
    r.controles.forEach(function (c, i) {
      var p = c.item.f.properties, tipo = CONTROLES[p.tipo] || CONTROLES.policial;
      html += '<li><button type="button" data-control="' + i + '"><span class="ruta-lista-icono">' + tipo.icono + '</span>' +
              esc(tipo.nombre + (p.nombre && p.nombre !== tipo.nombre ? ': ' + p.nombre : '')) + '</button></li>';
    });
    html += '</ul></details>';
  }
  if (r.pasos.length) {
    html += '<details class="ruta-pasos"><summary>Ver indicaciones (' + r.pasos.length + ')</summary><ol>';
    r.pasos.forEach(function (p) {
      html += '<li>' + esc(p.texto) + (p.km ? ' <small>' + (p.km < 1 ? Math.round(p.km * 1000) + ' m' : numero(p.km, 1) + ' km') + '</small>' : '') + '</li>';
    });
    html += '</ol></details>';
  }
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
      if (a.capa) a.capa.openPopup(a.latlng);
    });
  });
  salida.querySelectorAll('[data-control]').forEach(function (b) {
    b.addEventListener('click', function () {
      var it = r.controles[+b.getAttribute('data-control')].item;
      abrirPanelRuta(false);
      mapa.setView(it.latlng, Math.max(mapa.getZoom(), 15));
      if (!it.marca) { it.marca = marcaControl(it); controles.grupo.addLayer(it.marca); }
      if (mapa.hasLayer(controles.grupo)) it.marca.openPopup();
    });
  });
  if (sinMoverMapa) return;
  var lim = L.latLngBounds([]);
  opciones.forEach(function (o) { lim.extend(L.latLngBounds(o.puntos)); });
  if (window.innerWidth <= 600) mapa.fitBounds(lim, { paddingTopLeft: [20, 20], paddingBottomRight: [20, 20] });
  else mapa.fitBounds(lim, { padding: [30, 30] });
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
crearPane('redPesada');
mapa.getPane('redPesada').style.zIndex = 380;   // debajo de la ruta y de las restricciones

function agregarRedPesada(r) {
  if (!r.red || !r.red.features.length) return;
  var features = r.red.features;
  if (r.zona.limites) redPesada.zonas.push(L.latLngBounds(r.zona.limites));
  redPesada.km += r.zona.red_km || 0;
  if (!redPesada.grupo) {
    redPesada.grupo = L.geoJSON(null, {
      // en canvas y no en SVG: con miles de tramos el SVG trababa el mapa al moverlo
      pane: 'redPesada', interactive: false, renderer: L.canvas({ pane: 'redPesada', padding: 0.3 }), smoothFactor: 3,
      style: function () { return { color: '#2e7d32', weight: grosorRed(), opacity: 0.5 }; }
    });
    if (!apagadas.red_pesada) redPesada.grupo.addTo(mapa);
    var grosorPintado = grosorRed();
    mapa.on('zoomend', function () {
      if (grosorRed() !== grosorPintado) { grosorPintado = grosorRed(); redPesada.grupo.setStyle({ weight: grosorPintado }); }
    });
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
  redPesada.grupo.addData({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: partes } });
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
function grosorRed() { var z = mapa.getZoom(); return z <= 12 ? 2 : z <= 14 ? 4 : 7; }

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
        agregar({ texto: texto + (extremoAdentro ? ' (tu salida o llegada está adentro: necesitás permiso municipal)' : ''),
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
        if (!esReporte && p.calle && /debajo/i.test(p.detalle || '') && textoPasos &&
            textoPasos.indexOf(normalizarCalle(p.calle)) === -1) {
          if (!rojo) return;
          // no cuenta como rojo (no dispara el "CUIDADO" ni descarta la ruta): es un aviso para mirar
          agregar({ texto: 'Posible: ' + texto + ' (si la ruta pasa por abajo)', rojo: false, posible: true,
                    voz: 'posible paso bajo de ' + textoValor(p).replace(/^Altura máxima( \(paso bajo\))? /i, '') +
                         ' en ' + p.calle + ', si pasás por abajo', latlng: ll, orden: cerca.i, clave: claveP });
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
nav.rumbo = PUEDE_GIRAR && leerGuardado('mapa-camiones:rumbo') !== false;

// Hacia dónde va la ruta en este punto (grados desde el norte), mirando ~40 m hacia adelante
function rumboEnRuta(u) {
  var pts = nav.r.puntos, a = L.latLng(pts[u.idx]), j = u.idx + 1;
  while (j < pts.length - 1 && a.distanceTo(pts[j]) < 40) j++;
  var b = L.latLng(pts[Math.min(j, pts.length - 1)]);
  return Math.atan2((b.lng - a.lng) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 180 / Math.PI;
}
function cambiarRumbo(prender) {
  nav.rumbo = PUEDE_GIRAR && prender;
  guardar('mapa-camiones:rumbo', nav.rumbo);
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

function hablar(texto, urgente) {
  if (!nav.voz || !window.speechSynthesis || !texto) return;
  try {
    if (urgente) window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(texto);
    u.lang = 'es-AR';
    var voces = window.speechSynthesis.getVoices();
    var v = voces.filter(function (x) { return /^es(-|_)AR/i.test(x.lang); })[0] ||
            voces.filter(function (x) { return /^es/i.test(x.lang); })[0];
    if (v) u.voice = v;
    u.rate = 1;
    window.speechSynthesis.speak(u);
  } catch (e) { /* el teléfono no habla: queda el cartel */ }
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
    var llegada = /^(Llegar|Su destino|Has llegado|Llegaste)/i.test(p.texto || '');
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
                      gendarmeria: 'control de Gendarmería', fitosanitario: 'control fitosanitario' };
  (r.controles || controlesEnRuta(r.puntos)).forEach(function (c, k) {
    var p = c.item.f.properties, tipo = CONTROLES[p.tipo] || CONTROLES.policial;
    nav.avisos.push({ n: 'ctl' + k, texto: tipo.nombre, voz: VOZ_CONTROL[p.tipo] || 'control policial',
                      icono: tipo.icono + ' ', rojo: false,
                      dist: nav.acum[Math.min(c.orden, nav.acum.length - 1)] +
                            (c.t || 0) * ((nav.acum[c.orden + 1] || nav.acum[c.orden]) - nav.acum[c.orden]) });
  });
  nav.idx = 0; nav.dichos = {}; nav.fuera = 0; nav.activo = true; nav.recalculando = false; nav.primera = true;
  abrirPanelRuta(false);
  abrirPanel(false);
  document.getElementById('nav-cartel').hidden = false;
  document.body.classList.add('navegando');
  ponerVozBoton();
  ponerRumboBoton();
  nav.ultimoRumbo = null;
  ponerBrujula();
  mostrarCartelNav('Buscando tu ubicación...', '');
  if (!ruta.esRecalculo) hablar('Vamos. Seguí la ruta azul.', true);
  ruta.esRecalculo = false;
  pedirPantallaPrendida();
  if (ubicacion.ultima) seguirNavegacion(ubicacion.ultima);
  tocarUbicacion();   // empieza a seguir el GPS (si ya estaba, centra)
}

function terminarNavegacion(mensaje) {
  nav.activo = false;
  girarA(0);   // al terminar, el norte vuelve arriba
  ponerBrujula();
  nav.recalculando = false;
  ruta.alTerminarCalculo = null;   // si estaba recalculando, al terminar no vuelve a arrancar sola
  document.getElementById('nav-cartel').hidden = true;
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
  if (!nav.activo || nav.recalculando) return;
  nav.ultimaPos = pos;
  var u = ubicarEnRuta(pos);
  // ¿Te saliste de la ruta?
  if (u.fuera > NAV.FUERA_DE_RUTA_M) {
    nav.fuera++;
    if (nav.fuera >= NAV.FUERA_VECES && Date.now() - nav.ultimoRecalculo > NAV.RECALCULO_CADA_S * 1000) recalcularDesde(pos);
    else mostrarCartelNav('Fuera de la ruta', 'Volvé a la ruta azul o esperá: la recalculo en unos segundos.');
    return;
  }
  nav.fuera = 0;
  nav.idx = u.idx;
  if (nav.rumbo) {
    var rumbo = rumboEnRuta(u);
    // solo si cambió algo (si no, el mapa tiembla con cada lectura del GPS)
    if (nav.ultimoRumbo == null || Math.abs((((rumbo - nav.ultimoRumbo) % 360) + 540) % 360 - 180) > 4) {
      nav.ultimoRumbo = rumbo;
      girarA(-rumbo);
    }
  }
  nav.primera = false;
  var total = nav.acum[nav.acum.length - 1];
  var falta = total - u.recorrido;
  // ¿Llegaste?
  if (falta < NAV.LLEGADA_M) {
    hablar('Llegaste a destino.', true);
    terminarNavegacion('Llegaste a destino.');
    return;
  }
  // Próxima indicación
  var prox = nav.maniobras.filter(function (m) { return m.dist > u.recorrido + 5; })[0];
  var peligro = '';
  var decir = [];   // todo lo que hay que decir en esta posición, en una sola frase
  // Pasos bajos, prohibidos o reportes que vienen adelante
  nav.avisos.forEach(function (a) {
    var hasta = a.dist - u.recorrido;
    if (hasta < -20 || hasta > NAV.AVISO_PELIGRO_M) return;
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
  mapa.panTo(pos, { animate: true, duration: 0.5 });
}

function recalcularDesde(pos) {
  if (!ruta.hasta) return;
  nav.recalculando = true;
  nav.ultimoRecalculo = Date.now();
  mostrarCartelNav('Recalculando...', 'Te saliste de la ruta. Busco otra desde donde estás.');
  hablar('Recalculando la ruta.', true);
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
  document.getElementById('nav-terminar').addEventListener('click', function () { terminarNavegacion('Navegación terminada.'); });
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
      document.querySelectorAll('script[src*="js/mapa.js"], link[href*="css/estilos.css"]').forEach(function (e) {
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
