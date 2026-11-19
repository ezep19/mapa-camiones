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
    revisarAvisoZona();
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
        ponerPunto(op[0], e.latlng);
        abrirPanelRuta(true);
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
  zonasCargadas.forEach(function (z) {
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

mapa.createPane('ruta');
mapa.getPane('ruta').style.zIndex = 390;   // debajo de las restricciones: lo rojo se sigue viendo

fetch('datos/ruta_config.json', { cache: 'no-cache' })
  .then(function (r) { return r.ok ? r.json() : null; })
  .then(function (c) { ruta.config = c; })
  .catch(function () { /* sin config: se usa Valhalla */ });

var panelRuta = document.getElementById('panel-ruta');

function abrirPanelRuta(abrir) {
  if (!panelRuta) return;
  if (abrir) abrirPanel(false);
  panelRuta.hidden = !abrir;
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
  if (ubicacion.ultima) { ponerPunto('desde', ubicacion.ultima, 'Mi ubicación'); return; }
  ruta.esperandoUbicacion = true;
  tocarUbicacion();
}
mapa.on('locationfound', function (e) {
  if (!ruta.esperandoUbicacion) return;
  ruta.esperandoUbicacion = false;
  ponerPunto('desde', e.latlng, 'Mi ubicación');
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
});

// Buscar una dirección con el buscador de OpenStreetMap (Nominatim).
// Solo al tocar "Buscar" (su regla de uso no permite buscar mientras se escribe).
function buscarDireccion(cual) {
  var input = document.getElementById('ruta-' + cual);
  var lista = document.getElementById('resultados-' + cual);
  var texto = input.value.trim();
  if (texto.length < 3) { input.focus(); return; }
  lista.hidden = false;
  lista.innerHTML = '<li class="ruta-cargando">Buscando...</li>';
  var b = mapa.getBounds();
  var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=ar&accept-language=es' +
            '&viewbox=' + [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].map(function (n) { return n.toFixed(4); }).join(',') +
            '&q=' + encodeURIComponent(texto);
  fetch(url)
    .then(function (r) { if (!r.ok) throw new Error('buscador ' + r.status); return r.json(); })
    .then(function (res) {
      lista.innerHTML = '';
      if (!res.length) { lista.innerHTML = '<li class="ruta-cargando">No encontré esa dirección. Probá con calle, número y ciudad.</li>'; return; }
      res.forEach(function (r) {
        var li = document.createElement('li');
        var b2 = document.createElement('button');
        b2.type = 'button';
        b2.textContent = r.display_name.split(', ').slice(0, 4).join(', ');
        b2.addEventListener('click', function () {
          ponerPunto(cual, [parseFloat(r.lat), parseFloat(r.lon)], b2.textContent);
        });
        li.appendChild(b2);
        lista.appendChild(li);
      });
    })
    .catch(function () { lista.innerHTML = '<li class="ruta-cargando">No pude buscar. Revisá la conexión.</li>'; });
}

if (panelRuta) {
  document.getElementById('cerrar-ruta').addEventListener('click', function () { abrirPanelRuta(false); });
  document.getElementById('desde-ubicacion').addEventListener('click', usarMiUbicacion);
  ['desde', 'hasta'].forEach(function (cual) {
    document.querySelector('[data-buscar="' + cual + '"]').addEventListener('click', function () { buscarDireccion(cual); });
    document.querySelector('[data-tocar="' + cual + '"]').addEventListener('click', function () { empezarATocar(cual); });
    document.getElementById('ruta-' + cual).addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); buscarDireccion(cual); }
    });
  });
  document.getElementById('calcular-ruta').addEventListener('click', calcularRuta);
  document.getElementById('borrar-ruta').addEventListener('click', borrarRuta);
}

// --- Calcular ---
function calcularRuta() {
  var salida = document.getElementById('ruta-resultado');
  if (!camion) { abrirVentanaCamion(); return; }
  if (!ruta.desde || !ruta.hasta) {
    salida.hidden = false;
    salida.innerHTML = '<p class="ruta-aviso">Elegí desde dónde salís y adónde vas.</p>';
    return;
  }
  salida.hidden = false;
  salida.innerHTML = '<p class="ruta-cargando">Calculando la ruta para tu camión...</p>';
  var clave = ruta.config && ruta.config.ors_clave;
  var pedido = clave
    ? rutaORS(clave).catch(function (e) { console.warn('OpenRouteService falló:', e.message); return rutaValhalla(); })
    : rutaValhalla();
  pedido.then(mostrarRuta).catch(function (e) {
    console.error(e);
    salida.innerHTML = '<p class="ruta-aviso">' + esc(e.mensaje || 'No pude calcular la ruta. Revisá la conexión y probá de nuevo en un rato.') + '</p>';
  });
}

function conTiempoLimite(url, opciones, segundos) {
  var control = window.AbortController ? new AbortController() : null;
  if (control) { opciones.signal = control.signal; setTimeout(function () { control.abort(); }, segundos * 1000); }
  return fetch(url, opciones);
}

function rutaORS(clave) {
  var cuerpo = {
    coordinates: [[ruta.desde.latlng.lng, ruta.desde.latlng.lat], [ruta.hasta.latlng.lng, ruta.hasta.latlng.lat]],
    language: 'es', units: 'km', instructions: true,
    options: { vehicle_type: 'hgv', profile_params: { restrictions: {
      height: camion.altura, weight: camion.peso, length: camion.largo, width: CAMION_ANCHO } } }
  };
  return conTiempoLimite('https://api.openrouteservice.org/v2/directions/driving-hgv/geojson', {
    method: 'POST',
    headers: { 'Authorization': clave, 'Content-Type': 'application/json', 'Accept': 'application/geo+json' },
    body: JSON.stringify(cuerpo)
  }, 25).then(function (r) {
    if (!r.ok) throw new Error('OpenRouteService ' + r.status);
    return r.json();
  }).then(function (d) {
    var f = d.features[0];
    var pasos = [];
    (f.properties.segments || []).forEach(function (s) {
      (s.steps || []).forEach(function (p) {
        // OpenRouteService a veces dice "Camina hacia..." aunque sea en camión
        pasos.push({ texto: String(p.instruction).replace(/^Camin[ae] /, 'Salí '), km: p.distance });
      });
    });
    return {
      servicio: 'OpenRouteService',
      puntos: f.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }),
      km: f.properties.summary.distance, segundos: f.properties.summary.duration, pasos: pasos
    };
  });
}

function rutaValhalla() {
  var cuerpo = {
    locations: [{ lat: ruta.desde.latlng.lat, lon: ruta.desde.latlng.lng }, { lat: ruta.hasta.latlng.lat, lon: ruta.hasta.latlng.lng }],
    costing: 'truck',
    costing_options: { truck: { height: camion.altura, weight: camion.peso, length: camion.largo, width: CAMION_ANCHO } },
    units: 'kilometers',
    directions_options: { language: 'es-ES', units: 'kilometers' }
  };
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
    var pasos = [], puntos = [];
    d.trip.legs.forEach(function (leg) {
      puntos = puntos.concat(decodificarPolilinea(leg.shape, 6));
      leg.maneuvers.forEach(function (m) { pasos.push({ texto: m.instruction, km: m.length }); });
    });
    return { servicio: 'Valhalla', puntos: puntos, km: d.trip.summary.length, segundos: d.trip.summary.time, pasos: pasos };
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
function borrarRuta() {
  if (ruta.linea) { mapa.removeLayer(ruta.linea); mapa.removeLayer(ruta.borde); ruta.linea = ruta.borde = null; }
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

function mostrarRuta(r) {
  if (ruta.linea) { mapa.removeLayer(ruta.linea); mapa.removeLayer(ruta.borde); }
  ruta.borde = L.polyline(r.puntos, { pane: 'ruta', color: '#ffffff', weight: 11, opacity: 0.9, interactive: false }).addTo(mapa);
  ruta.linea = L.polyline(r.puntos, { pane: 'ruta', color: '#1565c0', weight: 7, opacity: 0.85, interactive: false }).addTo(mapa);
  document.getElementById('borrar-ruta').hidden = false;

  var avisos = revisarRuta(r.puntos);
  var html = '<div class="ruta-resumen"><b>' + numero(r.km, 1) + ' km</b> · unos ' + duracion(r.segundos) +
             '<small>Tiempo de auto: con camión puede ser más. Calculada por ' + esc(r.servicio) +
             ' con tus medidas (' + metros(camion.altura) + ', ' + toneladas(camion.peso) + ', ' + metros(camion.largo) + ').</small></div>';
  if (avisos.length) {
    html += '<div class="ruta-aviso"><b>Ojo: la ruta pasa por ' + avisos.length + (avisos.length === 1 ? ' punto' : ' puntos') +
            ' para revisar</b> (tocalos para verlos):</div><ul class="ruta-lista">';
    avisos.forEach(function (a, i) {
      html += '<li><button type="button" data-aviso="' + i + '"><i style="background:' + a.color + '"></i>' + esc(a.texto) + '</button></li>';
    });
    html += '</ul>';
  } else {
    html += '<p class="ruta-ok">No encontré pasos bajos ni reportes sobre esta ruta. Igual respetá la señalización.</p>';
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
  salida.querySelectorAll('[data-aviso]').forEach(function (b) {
    b.addEventListener('click', function () {
      var a = avisos[+b.getAttribute('data-aviso')];
      abrirPanelRuta(false);
      mapa.setView(a.latlng, Math.max(mapa.getZoom(), 17));
      if (a.capa) a.capa.openPopup(a.latlng);
    });
  });
  var lim = ruta.linea.getBounds();
  if (window.innerWidth <= 600) mapa.fitBounds(lim, { paddingTopLeft: [20, 20], paddingBottomRight: [20, 20] });
  else mapa.fitBounds(lim, { padding: [30, 30] });
}

function duracion(seg) {
  var min = Math.round(seg / 60);
  if (min < 60) return min + ' min';
  return Math.floor(min / 60) + ' h ' + ('0' + (min % 60)).slice(-2) + ' min';
}

// --- Revisar la ruta contra nuestros datos ---
// Puntos (pasos bajos, alturas puntuales, reportes): a menos de 20 m de la ruta.
// Líneas rojas o amarillas: que la ruta vaya por encima al menos 30 m (no solo que las cruce).
function revisarRuta(puntosRuta) {
  var lat0 = puntosRuta[0][0] * Math.PI / 180;
  var kx = Math.cos(lat0) * 111320, ky = 110540;
  function xy(ll) { return [ll[1] * kx, ll[0] * ky]; }
  var segs = [];
  for (var i = 1; i < puntosRuta.length; i++) segs.push([xy(puntosRuta[i - 1]), xy(puntosRuta[i])]);
  var caja = L.latLngBounds(puntosRuta).pad(0.02);
  function distRuta(p) {
    var mejor = Infinity;
    for (var j = 0; j < segs.length; j++) {
      var a = segs[j][0], b = segs[j][1], dx = b[0] - a[0], dy = b[1] - a[1];
      var t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
      var ex = a[0] + t * dx - p[0], ey = a[1] + t * dy - p[1];
      var d = ex * ex + ey * ey;
      if (d < mejor) mejor = d;
    }
    return Math.sqrt(mejor);
  }
  var avisos = [];
  function revisarCapa(grupo, esReporte) {
    if (!grupo) return;
    grupo.eachLayer(function (l) {
      var p = l.feature.properties;
      var estado = esReporte ? 'reporte' : evaluar(p).estado;
      if (estado !== 'no' && estado !== 'sin_dato' && estado !== 'reporte') return;
      var color = estado === 'no' ? COLORES.no : estado === 'reporte' ? '#e65100' : COLORES.sin_dato;
      var texto = esReporte ? 'Reporte de un chofer: ' + p.tipo
        : (estado === 'no' ? 'NO PASÁS: ' : 'Verificar: ') + textoValor(p) + (p.calle ? ' — ' + p.calle : '');
      if (l.getLatLng) {   // punto
        var ll = l.getLatLng();
        if (!caja.contains(ll) || distRuta(xy([ll.lat, ll.lng])) > 20) return;
        avisos.push({ texto: texto, color: color, latlng: ll, capa: l });
      } else {             // línea: medir cuánto de la línea va por la ruta
        if (!caja.intersects(l.getBounds())) return;
        var partes = l.getLatLngs();
        if (partes.length && !Array.isArray(partes[0])) partes = [partes];
        // muestras cada 5 m a lo largo de la línea; cada una cerca de la ruta suma 5 m "por encima".
        // Cruzarla en una esquina da ~20 m; ir por ella, mucho más.
        var encima = 0, donde = null;
        partes.forEach(function (linea) {
          for (var k = 1; k < linea.length; k++) {
            var a = xy([linea[k - 1].lat, linea[k - 1].lng]), b = xy([linea[k].lat, linea[k].lng]);
            var largo = Math.hypot(b[0] - a[0], b[1] - a[1]);
            var n = Math.max(1, Math.round(largo / 5));
            for (var m = 0; m < n; m++) {
              var q = [a[0] + (b[0] - a[0]) * (m + 0.5) / n, a[1] + (b[1] - a[1]) * (m + 0.5) / n];
              if (distRuta(q) <= 10) { encima += largo / n; if (!donde) donde = L.latLng(q[1] / ky, q[0] / kx); }
            }
          }
        });
        if (encima >= 40) avisos.push({ texto: texto, color: color, latlng: donde, capa: l });
      }
    });
  }
  CAPAS.forEach(function (c) {
    if (c.id === 'sin_salida') return;   // la ruta no entra a una calle sin salida salvo que sea el destino
    revisarCapa(grupos[c.id], false);
  });
  revisarCapa(grupoReportes, true);
  // primero lo que no pasás
  avisos.sort(function (a, b) { return (a.color === COLORES.no ? 0 : 1) - (b.color === COLORES.no ? 0 : 1); });
  return avisos;
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
