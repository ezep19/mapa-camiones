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
var MEDIDA_DE_CAPA = { altura: 'altura', peso: 'peso', largo: 'largo' };
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
  attributionControl: false   // el crédito de OpenStreetMap está siempre visible en el pie
});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapa);

// Dibujar en "canvas" es más rápido con miles de elementos, y "tolerance"
// agranda la zona sensible al toque para poder tocar líneas finas con el dedo.
var dibujo = L.canvas({ tolerance: 10 });

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
  camion = nuevo;
  guardar(CLAVE_CAMION, camion);
  mostrarResumenCamion();
  cerrarVentanaCamion();
  repintar();
});
botonCancelar.addEventListener('click', cerrarVentanaCamion);
document.getElementById('btn-camion').addEventListener('click', abrirVentanaCamion);
document.addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape' && !ventana.hidden && camion) cerrarVentanaCamion();
});

// ===== 4. ¿Pasa o no pasa? =====
// Devuelve: estado ('no' | 'si' | 'sin_dato' | 'aviso'), y la medida y el límite comparados
function evaluar(p) {
  if (p.capa === 'prohibido') return { estado: 'no' };
  if (p.capa === 'sin_salida') return { estado: 'aviso' };
  var medida = MEDIDA_DE_CAPA[p.capa];
  if (!medida || p.limite == null || !camion) return { estado: 'sin_dato', medida: medida };
  // Igual al límite: el cartel permite pasar, pero se avisa que es justo
  var justo = Math.abs(camion[medida] - p.limite) < 0.005;
  return { estado: camion[medida] > p.limite && !justo ? 'no' : 'si', justo: justo, medida: medida,
           valor: camion[medida], limite: p.limite };
}

// ===== 5. Carga de datos =====
mostrarResumenCamion();
if (!camion) abrirVentanaCamion();

mostrarMensaje('Cargando restricciones...');
fetch('datos/zonas.json', { cache: 'no-cache' })
  .then(function (r) { if (!r.ok) throw new Error('zonas.json ' + r.status); return r.json(); })
  .then(function (indice) {
    return Promise.all(indice.zonas.map(function (z) {
      // Las restricciones son obligatorias; si fallan los lugares, el mapa anda igual
      var restricciones = !z.archivo ? Promise.resolve({ features: [] })
        : fetch('datos/' + z.archivo, { cache: 'no-cache' })
          .then(function (r) { if (!r.ok) throw new Error(z.archivo + ' ' + r.status); return r.json(); });
      var lugares = !z.lugares ? Promise.resolve({ features: [] })
        : fetch('datos/' + z.lugares, { cache: 'no-cache' })
          .then(function (r) { if (!r.ok) throw new Error(z.lugares + ' ' + r.status); return r.json(); })
          .catch(function (e) { console.error(e); return { features: [] }; });
      return Promise.all([restricciones, lugares]).then(function (r) {
        return { zona: z, datos: r[0], lugares: r[1] };
      });
    }));
  })
  .then(function (zonas) {
    zonasCargadas = zonas;
    var porCapa = {};
    CAPAS.forEach(function (c) { porCapa[c.id] = []; });
    var porLugar = {};
    LUGARES.forEach(function (l) { porLugar[l.id] = []; });
    zonas.forEach(function (z) {
      z.datos.features.forEach(function (f) {
        if (porCapa[f.properties.capa]) porCapa[f.properties.capa].push(f);
      });
      z.lugares.features.forEach(function (f) {
        if (porLugar[f.properties.tipo]) porLugar[f.properties.tipo].push(f);
      });
    });
    CAPAS.forEach(function (c) {
      cantidades[c.id] = porCapa[c.id].length;
      grupos[c.id] = crearCapa(porCapa[c.id]);
      if (!apagadas[c.id]) grupos[c.id].addTo(mapa);
    });
    LUGARES.forEach(function (l) {
      cantidadesLugares[l.id] = porLugar[l.id].length;
      gruposLugares[l.id] = crearCapaLugares(porLugar[l.id]);
    });
    mostrarLugares();
    ponerRojosArriba();
    armarPanel();
    armarPanelLugares();
    ocultarMensaje();
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
    style: estiloLinea,
    pointToLayer: function (f, latlng) { return L.circleMarker(latlng, estiloPunto(f)); },
    onEachFeature: function (f, capaLeaflet) {
      capaLeaflet.bindPopup(function () { return armarCartel(f.properties); }, { maxWidth: 290 });
    }
  });
}

// Grosor de las líneas: finas de lejos (para no tapar la ciudad), gruesas de cerca (para tocarlas)
function grosorSegunZoom(estado) {
  var z = mapa.getZoom();
  var base = z <= 11 ? 1.5 : z <= 12 ? 2 : z <= 13 ? 3 : z <= 14 ? 4 : 5;
  return estado === 'no' ? base + 1 : estado === 'si' ? Math.max(1, base - 1) : base;
}

function estiloLinea(f) {
  var estado = evaluar(f.properties).estado;
  var lejos = mapa.getZoom() <= 13;
  return {
    renderer: dibujo,
    color: COLORES[estado],
    weight: grosorSegunZoom(estado),
    opacity: estado === 'si' ? 0.5 : lejos ? 0.75 : 0.95,
    lineCap: 'round',
    dashArray: CAPA_POR_ID[f.properties.capa].forma === 'punteada' ? '8 6' : null
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

// Volver a pintar todo (cuando cambian las medidas o el zoom)
function repintar() {
  Object.keys(grupos).forEach(function (id) {
    grupos[id].eachLayer(function (l) {
      l.setStyle(l.setRadius ? estiloPunto(l.feature) : estiloLinea(l.feature));
    });
  });
  ponerRojosArriba();
  if (zonasCargadas.length) armarPanel();
}
mapa.on('zoomend', repintar);

// Lo que no pasás se dibuja encima de todo lo demás, para que no quede tapado
function ponerRojosArriba() {
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
  if (p.osm) {
    html += ' · <a href="https://www.openstreetmap.org/' + encodeURI(p.osm) +
            '" target="_blank" rel="noopener">ver en OpenStreetMap</a>';
  }
  html += '</div>';
  return html;
}

function veredicto(p) {
  var e = evaluar(p);
  var titulo, nota = '';
  if (p.capa === 'prohibido') {
    titulo = 'NO PODÉS CIRCULAR: prohibido para camiones';
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
    var dice = { altura: 'mide de alto', peso: 'pesa', largo: 'mide de largo' }[e.medida];
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
      return 'Prohibido el paso de camiones';
    case 'verificar':
    case 'verificar_autopista':
      return 'Sin altura cargada';
    case 'sin_salida':
      return 'Calle sin salida';
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
      capaLeaflet.bindPopup(function () { return armarCartelLugar(f); }, { maxWidth: 290 });
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
    var vacia = cantidades[c.id] === 0;
    var muestra = c.id === 'sin_salida' ? COLORES.aviso : '#3d4652';
    var cuenta = vacia ? 'Sin datos en esta zona'
      : cantidades[c.id].toLocaleString('es-AR') + ' en el mapa' +
        (MEDIDA_DE_CAPA[c.id] && camion ? ' · no pasás en ' + noPasa.toLocaleString('es-AR') : '');
    var li = document.createElement('li');
    li.innerHTML =
      '<label' + (vacia ? ' class="capa-vacia"' : '') + '>' +
        '<input type="checkbox"' + (apagadas[c.id] ? '' : ' checked') + '>' +
        '<span class="muestra ' + c.forma + '" style="--c:' + muestra + '"></span>' +
        '<span class="capa-texto">' + esc(c.nombre) +
          '<br><span class="capa-cantidad">' + cuenta + '</span></span>' +
      '</label>';
    li.querySelector('input').addEventListener('change', function (ev) {
      if (ev.target.checked) { grupos[c.id].addTo(mapa); delete apagadas[c.id]; ponerRojosArriba(); }
      else { mapa.removeLayer(grupos[c.id]); apagadas[c.id] = true; }
      guardar(CLAVE_CAPAS, apagadas);
    });
    lista.appendChild(li);
  });
  var fechas = zonasCargadas.map(function (z) { return z.zona.titulo + ': ' + fecha(z.zona.actualizado); });
  document.getElementById('nota-datos').textContent = 'Datos actualizados — ' + fechas.join(' · ');
  armarBotonesZonas();
}

// Botones "Ir a:" para saltar a cada zona (solo si hay más de una)
function armarBotonesZonas() {
  var caja = document.getElementById('ir-zonas');
  if (!caja) return;   // index.html viejo guardado en el celular
  caja.innerHTML = '';
  var conLimites = zonasCargadas.filter(function (z) { return z.zona.limites; });
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
      mapa.fitBounds(z.zona.limites);
    });
    caja.appendChild(b);
  });
  caja.hidden = false;
}

// Recordar dónde quedó mirando el mapa
mapa.on('moveend', function () {
  var c = mapa.getCenter();
  guardar(CLAVE_VISTA, { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5), zoom: mapa.getZoom() });
});

var botonCapas = document.getElementById('btn-capas');
var panel = document.getElementById('panel-capas');
function abrirPanel(abrir) {
  panel.hidden = !abrir;
  botonCapas.setAttribute('aria-expanded', abrir ? 'true' : 'false');
}
botonCapas.addEventListener('click', function () { abrirPanel(panel.hidden); });
document.getElementById('cerrar-capas').addEventListener('click', function () { abrirPanel(false); });
mapa.on('click', function () { abrirPanel(false); });

// ===== 9. Mi ubicación (punto azul) =====
// El primer toque busca la ubicación y centra el mapa; después el punto se va moviendo solo.
// Los toques siguientes vuelven a centrar el mapa en donde estás.
mapa.createPane('ubicacion');
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
