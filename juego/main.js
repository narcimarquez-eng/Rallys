// Rallys: elige escenario (de Mundos-) y coche (de Hacer coches), sal desde «inicio» y haz las vueltas pasando los
// controles en orden. El escenario se dibuja con el mismo código que el visor de Mundos- (vendor/mundos).
import * as THREE from 'three';
import { Escena3D } from '../vendor/mundos/js/escena-3d.js';
import { Pista, SUPERFICIES } from './pista.js';
import { Coche } from './coche.js';
import { Obstaculos } from './obstaculos.js';
import { cargarCoche, colocarCoche } from './modelo-coche.js';
import { Cronometro, fmt, leerRecords } from './cronometro.js';
import { Camaras } from './camaras.js';
import { Controles } from './controles.js';
import { Sonido } from './sonido.js';
import { Particulas } from './particulas.js';
import { generarCoche, fichaCoche, fotoCoche, semillaNueva, barras } from './generador-coche.js';

const E = window.Escenario, A = window.Almacen;
const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;
const RAIZ = new URL('../', import.meta.url); // carpeta del juego (la página tiene <base> en vendor/mundos)
const url = r => new URL(r, RAIZ).href;
const params = new URLSearchParams(location.search);

// Preferencias
const prefs = { escenario: null, coche: 'urban', vueltas: 3, camara: 'persecucion', calidad: matchMedia('(pointer: coarse)').matches ? 'baja' : 'media', hora: '', sonido: true, tactil: null, generados: [] };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('rallys.prefs') || '{}')); } catch (e) { /* nada */ }
const guardarPrefs = () => { try { localStorage.setItem('rallys.prefs', JSON.stringify(prefs)); } catch (e) { /* nada */ } };
const esTactil = () => prefs.tactil != null ? prefs.tactil : matchMedia('(pointer: coarse)').matches;

function aviso(t, ms) {
  const d = document.createElement('div'); d.textContent = t; $('avisos').appendChild(d);
  setTimeout(() => d.remove(), ms || 4000);
}

// ---------------------------------------------------------------------------
// three.js
// ---------------------------------------------------------------------------
const lienzo = $('lienzo');
const renderer = new THREE.WebGLRenderer({ antialias: prefs.calidad !== 'baja', powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.type = THREE.PCFShadowMap;
lienzo.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camara = new THREE.PerspectiveCamera(62, 1, 0.3, 30000);
function redimensionar() {
  const r = lienzo.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camara.aspect = r.width / Math.max(1, r.height); camara.updateProjectionMatrix();
  if (particulas) particulas.setAlto(r.height);
}
new ResizeObserver(redimensionar).observe(lienzo);
function aplicarCalidad() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, prefs.calidad === 'alta' ? 2 : prefs.calidad === 'media' ? 1.5 : 1));
  renderer.shadowMap.enabled = prefs.calidad !== 'baja';
}
aplicarCalidad();

// ---------------------------------------------------------------------------
// Estado de la partida
// ---------------------------------------------------------------------------
let esc = null, escena = null, pista = null, obstaculos = null, coche = null, modelo = null, crono = null, camaras = null, particulas = null;
let datosCoche = null, fuenteEsc = null, modelosEsc = {};
let estado = 'menu'; // menu · carga · cuenta · carrera · fin · libre
let pausado = false, tCuenta = 0, acumulado = 0;
const controles = new Controles($('tactil'));
controles._tactil($('botones-hud')); // 🎥 ↺ ⏸ de arriba, también con ratón
const sonido = new Sonido(); sonido.activo = prefs.sonido;
const PASO = 1 / 120;

// ---------------------------------------------------------------------------
// Menú
// ---------------------------------------------------------------------------
let indiceEsc = [], indiceCoches = [];
let elegidoEsc = null, elegidoCoche = null;

async function cargarIndices() {
  try { indiceEsc = await (await fetch(url('escenarios/indice.json'))).json(); } catch (e) { indiceEsc = []; }
  try { indiceCoches = await (await fetch(url('coches/indice.json'))).json(); } catch (e) { indiceCoches = []; }
  // Coches generados con el creador de Hacer coches que se han quedado en el garaje (se guardan solo sus semillas)
  for (const s of prefs.generados || []) { try { indiceCoches.push(cocheGenerado(s)); } catch (e) { console.warn('Coche generado', s, e); } }
  // Escenarios guardados en el Creador (si el juego está publicado en el mismo sitio que Mundos-, comparten el almacén)
  let guardados = [];
  try { guardados = await Promise.race([A.listar(), new Promise(ok => setTimeout(() => ok([]), 1500))]); } catch (e) { guardados = []; }
  for (const g of guardados) indiceEsc.push({ id: 'almacen:' + g.id, nombre: g.nombre, desc: 'Guardado en el Creador de Escenarios · ' + (g.tam || '?') + ' m', icono: '💾', almacen: g.id });
}

// ---- Coches generados al momento (juego/generador-coche.js) ----
const MAX_GENERADOS = 8;
function cocheGenerado(semilla) {
  const f = fichaCoche(semilla);
  return { id: 'gen:' + semilla, semilla, nombre: f.nombre, desc: `${f.tipo} · tracción ${f.traccion.toLowerCase()} · neumáticos ${f.neumaticos.toLowerCase()}`,
    icono: '🎲', datos: f.datos, ficha: f, foto: null };
}
// Construye el coche (si hace falta) y le saca la foto para su tarjeta
function hacerFoto(c) {
  if (c.foto || !c.semilla) return;
  try { const g = generarCoche(c.semilla); c.foto = fotoCoche(g.grupo); liberar(g.grupo); } catch (e) { console.warn(e); c.foto = ''; }
}
function liberar(obj) { obj.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } }); }
function nuevoGenerado() {
  const s = semillaNueva();
  const c = cocheGenerado(s);
  hacerFoto(c);
  // el nuevo sustituye a los generados que no se han «guardado en el garaje»
  indiceCoches = indiceCoches.filter(x => !x.semilla || x.guardado);
  indiceCoches.push(c); elegidoCoche = c; prefs.coche = c.id; guardarPrefs();
  pintarMenu();
}
function guardarGenerado(c) {
  c.guardado = true;
  prefs.generados = [...(prefs.generados || []).filter(s => s !== c.semilla), c.semilla];
  while (prefs.generados.length > MAX_GENERADOS) {
    const fuera = prefs.generados.shift();
    if (fuera !== (elegidoCoche && elegidoCoche.semilla)) indiceCoches = indiceCoches.filter(x => x.semilla !== fuera);
  }
  guardarPrefs(); pintarMenu();
}
function quitarGenerado(c) {
  prefs.generados = (prefs.generados || []).filter(s => s !== c.semilla);
  indiceCoches = indiceCoches.filter(x => x !== c);
  if (elegidoCoche === c) { elegidoCoche = indiceCoches[0] || null; prefs.coche = elegidoCoche && elegidoCoche.id; }
  guardarPrefs(); pintarMenu();
}
function pintarFicha() {
  const d = $('ficha-coche'), c = elegidoCoche;
  if (!c) { d.hidden = true; d.innerHTML = ''; return; }
  d.hidden = false;
  if (!c.ficha) { // coche fijo: solo las barras
    d.innerHTML = `<ul class="barras">${barras(c.datos || {}).map(b => `<li><span>${b.nombre}</span><i><s style="width:${b.valor * 10}%"></s></i><em>${b.texto}</em></li>`).join('')}</ul>`;
    return;
  }
  const f = c.ficha;
  d.innerHTML = `<div class="ficha-cabeza">${c.foto ? `<img src="${c.foto}" alt="">` : ''}<div><b>${esc_(c.nombre)}</b>
      <small>${esc_(f.tipo)} · tracción ${esc_(f.traccion.toLowerCase())} · neumáticos ${esc_(f.neumaticos.toLowerCase())}</small>
      <small class="semilla">Semilla ${c.semilla}</small></div></div>
    <ul class="barras">${f.barras.map(b => `<li><span>${b.nombre}</span><i><s style="width:${b.valor * 10}%"></s></i><em>${b.texto}</em></li>`).join('')}</ul>
    <div class="fila-botones">
      <button data-f="otro">🎲 Generar otro</button>
      ${c.guardado ? '<button data-f="quitar">🗑 Quitar del garaje</button>' : '<button data-f="guardar">⭐ Guardar en el garaje</button>'}
    </div>`;
  d.querySelector('[data-f="otro"]').onclick = nuevoGenerado;
  const g = d.querySelector('[data-f="guardar"]'); if (g) g.onclick = () => guardarGenerado(c);
  const q = d.querySelector('[data-f="quitar"]'); if (q) q.onclick = () => quitarGenerado(c);
}

function pintarMenu() {
  const recs = leerRecords();
  const le = $('lista-escenarios'); le.innerHTML = '';
  for (const s of indiceEsc) {
    const b = document.createElement('button'); b.className = 'tarjeta' + (elegidoEsc && elegidoEsc.id === s.id ? ' elegida' : '');
    const r = recs[s.id] && recs[s.id].vuelta;
    b.innerHTML = `<span class="icono">${s.icono || '🏞'}</span><b>${esc_(s.nombre)}</b><small>${esc_(s.desc || '')}</small>${r ? `<small>🏆 Mejor vuelta ${fmt(r.t)}</small>` : ''}`;
    b.onclick = () => { elegidoEsc = s; prefs.escenario = s.id; guardarPrefs(); pintarMenu(); };
    le.appendChild(b);
  }
  const lc = $('lista-coches'); lc.innerHTML = '';
  for (const c of indiceCoches) {
    const b = document.createElement('button'); b.className = 'tarjeta' + (elegidoCoche && elegidoCoche.id === c.id ? ' elegida' : '');
    if (c.semilla && c.foto === null) setTimeout(() => { hacerFoto(c); pintarMenu(); }, 30); // la foto, en cuanto se pueda
    b.innerHTML = `${c.foto ? `<img class="foto" src="${c.foto}" alt="">` : `<span class="icono">${c.icono || '🚗'}</span>`}<b>${esc_(c.nombre)}</b><small>${esc_(c.desc || '')}</small><small>${c.datos ? Math.round(c.datos.potencia * 1.36) + ' CV · ' + c.datos.masa + ' kg' : ''}</small>`;
    b.onclick = () => { elegidoCoche = c; prefs.coche = c.id; guardarPrefs(); pintarMenu(); };
    lc.appendChild(b);
  }
  pintarFicha();
  const r = elegidoEsc && recs[elegidoEsc.id];
  $('record-menu').textContent = r ? `🏆 ${elegidoEsc.nombre}: mejor vuelta ${r.vuelta ? fmt(r.vuelta.t) : '–'}${r['total' + prefs.vueltas] ? ' · mejor carrera a ' + prefs.vueltas + ' vueltas ' + fmt(r['total' + prefs.vueltas].t) : ''}` : '';
}
function esc_(t) { return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

$('sel-vueltas').value = String(prefs.vueltas); $('sel-camara').value = prefs.camara; $('sel-calidad').value = prefs.calidad; $('sel-hora').value = prefs.hora;
$('sel-vueltas').onchange = e => { prefs.vueltas = +e.target.value; guardarPrefs(); pintarMenu(); };
$('sel-camara').onchange = e => { prefs.camara = e.target.value; guardarPrefs(); };
$('sel-calidad').onchange = e => { prefs.calidad = e.target.value; guardarPrefs(); };
$('sel-hora').onchange = e => { prefs.hora = e.target.value; guardarPrefs(); };
$('btn-abrir-esc').onclick = () => $('fichero-esc').click();
$('fichero-esc').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const s = { id: 'archivo:' + f.name, nombre: f.name.replace(/\.(escenario\.)?json$/i, ''), desc: 'Archivo abierto', icono: '📄', texto: await f.text() };
  try { s.id = 'archivo:' + (JSON.parse(s.texto).id || f.name); } catch (er) { /* el error saldrá al cargar */ }
  indiceEsc.push(s); elegidoEsc = s; pintarMenu(); e.target.value = '';
};
$('btn-url-esc').onclick = () => {
  const u = prompt('Dirección del .escenario.json (exportado desde Mundos-):');
  if (!u) return;
  const s = { id: 'url:' + u, nombre: decodeURIComponent(u.split('/').pop() || u), desc: u, icono: '🔗', url: u };
  indiceEsc.push(s); elegidoEsc = s; pintarMenu();
};
$('btn-abrir-coche').onclick = () => $('fichero-coche').click();
$('btn-generar-coche').onclick = nuevoGenerado;
$('fichero-coche').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const c = { id: 'archivo:' + f.name, nombre: f.name.replace(/\.glb$/i, ''), desc: 'Archivo .glb', icono: '📦', bytes: await f.arrayBuffer() };
  indiceCoches.push(c); elegidoCoche = c; pintarMenu(); e.target.value = '';
};
$('btn-correr').onclick = () => { sonido.iniciar(); empezarPartida(); };

// ---------------------------------------------------------------------------
// Carga del escenario y del coche
// ---------------------------------------------------------------------------
function b64ABuffer(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let k = 0; k < s.length; k++) u[k] = s.charCodeAt(k); return u.buffer; }

async function cargarEscenario(s) {
  let datos;
  if (s.plantilla) {
    const e = E.crear({ plantilla: s.plantilla, semilla: s.semilla, nombre: s.nombre });
    e.id = s.id; return { escenario: e, modelos: {} };
  }
  if (s.texto) datos = s.texto;
  else if (s.almacen) datos = await A.cargarEscenario(s.almacen);
  else {
    const r = await fetch(s.url || url(s.archivo));
    if (!r.ok) throw new Error('No se pudo descargar el escenario (' + r.status + ')');
    datos = await r.text();
  }
  const res = E.deserializar(datos);
  if (!s.almacen && !s.url && !s.texto) res.escenario.id = s.id;
  return res;
}

function textoCarga(t) { $('carga-texto').textContent = t; }

async function empezarPartida() {
  if (!elegidoEsc || !elegidoCoche) { aviso('Elige un escenario y un coche'); return; }
  estado = 'carga';
  $('menu').hidden = true; $('carga').hidden = false; $('resultados').hidden = true; $('pausa').hidden = true;
  try {
    if (fuenteEsc !== elegidoEsc || !esc) {
      textoCarga('Preparando el escenario…');
      await new Promise(r => setTimeout(r, 30));
      const res = await cargarEscenario(elegidoEsc);
      esc = res.escenario; modelosEsc = res.modelos || {}; fuenteEsc = elegidoEsc;
      if (!esc.caminos.some(c => !E.esRio(c) && c.puntos.length >= 2)) aviso('Este escenario no tiene caminos: se corre campo a través y sin controles.');
      construirEscena();
    }
    textoCarga('Cargando el coche…');
    await prepararCoche();
    textoCarga('¡Listos!');
    nuevaCarrera();
  } catch (e) {
    console.error(e);
    estado = 'menu'; $('carga').hidden = true; $('menu').hidden = false;
    aviso('No se pudo empezar: ' + e.message, 7000);
  }
}

function construirEscena() {
  if (escena) { scene.clear(); }
  aplicarCalidad();
  escena = new Escena3D({
    scene, renderer, editor: false, calidad: prefs.calidad, arbolesRealistas: true, texturasSuelo: true, pueblosReales: true,
    etiquetas: false, mostrarAreas: false,
    alAviso: t => setTimeout(() => aviso(t), 0),
    cargarModeloLocal: async id => modelosEsc[id] ? b64ABuffer(modelosEsc[id]) : A.cargarModelo(id),
    alCargar: n => { if (n === 0) rehacerObstaculos(); },
    alCambiar: () => rehacerObstaculos()
  });
  escena.construir(esc);
  // la marca de «inicio» (poste, bandera y flecha) es para el editor: en el juego el coche sale de ahí
  for (const el of esc.elementos) if (el.tipo === 'inicio') { const g = escena.objetos.get(el.id); if (g) g.visible = false; }
  if (prefs.hora !== '') escena.setHora(+prefs.hora);
  escena.setNiebla(Math.min(esc.ambiente.niebla, 0.45));
  particulas = new Particulas(scene); redimensionar();
  pista = new Pista(E, esc);
  obstaculos = new Obstaculos(E, esc, pista);
  obstaculos.construir(escena, THREE);
  camaras = new Camaras(camara, pista);
  dibujarMapaBase();
}
let tRehacer = null;
function rehacerObstaculos() {
  clearTimeout(tRehacer);
  tRehacer = setTimeout(() => { if (obstaculos && escena) obstaculos.construir(escena, THREE); }, 300);
}

async function prepararCoche() {
  if (modelo && datosCoche === elegidoCoche && coche && coche.pista === pista) return;
  if (modelo) scene.remove(modelo.objeto);
  const c = elegidoCoche;
  modelo = await cargarCoche(c.semilla ? generarCoche(c.semilla).grupo : (c.bytes || url(c.archivo)), { girar180: c.girar180 });
  datosCoche = c;
  scene.add(modelo.objeto);
  coche = new Coche(pista, modelo.medidas, c.datos);
  coche.alCambiar = () => { };
}

// Salida: el elemento «inicio» (mirando a su rotY); si no hay, el principio del primer camino
function puntoSalida() {
  const ini = esc.elementos.find(e => e.tipo === 'inicio');
  if (ini) return { x: ini.x, z: ini.z, rumbo: (ini.rotY || 0) * DEG };
  const p = pista.caminos[0];
  if (p) { const q = pista.puntoEn(p, 2); return { x: q.x, z: q.z, rumbo: Math.atan2(q.dx, q.dz) }; }
  return { x: 0, z: 0, rumbo: 0 };
}

function nuevaCarrera() {
  const s = puntoSalida();
  coche.reiniciar(s.x, s.z, s.rumbo);
  crono = new Cronometro(esc, pista, prefs.vueltas, fuenteEsc.id);
  crono.coche = datosCoche.nombre;
  camaras.usar(prefs.camara);
  colocarCoche(modelo, coche);
  // unos pasos parados para que la suspensión se asiente
  for (let k = 0; k < 120; k++) coche.paso(PASO, { gas: 0, freno: 0, giro: 0, manoFreno: true }, obstaculos);
  coche.atras = false; coche.marcha = 1;
  estado = 'cuenta'; tCuenta = 3.999; pausado = false; acumulado = 0;
  $('carga').hidden = true; $('hud').hidden = false; $('resultados').hidden = true; $('pausa').hidden = true;
  ponerTactil();
  mensaje('', ''); ultimoPitido = 4;
  actualizarHUD(true);
}

function ponerTactil() { const t = esTactil(); $('tactil').hidden = !t || estado === 'menu'; document.body.classList.toggle('tactil', t); $('p-tactil').checked = t; }

function volverAPista() {
  const cerca = pista.masCercano(coche.x, coche.z);
  if (!cerca) { const s = puntoSalida(); coche.reiniciar(s.x, s.z, s.rumbo); return; }
  const q = pista.puntoEn(cerca.p, cerca.pr.d);
  const f = coche.adelante;
  const sentido = f.x * q.dx + f.z * q.dz >= 0 ? 1 : -1;
  coche.reiniciar(q.x, q.z, Math.atan2(q.dx * sentido, q.dz * sentido));
  camaras.iniciada = false;
  aviso('↺ De vuelta a la pista', 1500);
}

// ---------------------------------------------------------------------------
// Pausa, resultados
// ---------------------------------------------------------------------------
function pausar(v) {
  if (estado === 'menu' || estado === 'carga') return;
  pausado = v; $('pausa').hidden = !v; sonido.pausar(v);
}
$('p-seguir').onclick = () => pausar(false);
$('p-reiniciar').onclick = () => { pausar(false); nuevaCarrera(); };
$('p-menu').onclick = () => irAlMenu();
$('p-sonido').checked = prefs.sonido;
$('p-sonido').onchange = e => { prefs.sonido = e.target.checked; sonido.setActivo(prefs.sonido); guardarPrefs(); };
$('p-tactil').onchange = e => { prefs.tactil = e.target.checked; guardarPrefs(); ponerTactil(); };
$('r-repetir').onclick = () => nuevaCarrera();
$('r-menu').onclick = () => irAlMenu();
$('r-libre').onclick = () => { $('resultados').hidden = true; estado = 'libre'; };
function irAlMenu() {
  pausado = false; sonido.pausar(true);
  estado = 'menu'; $('pausa').hidden = true; $('resultados').hidden = true; $('hud').hidden = true; $('tactil').hidden = true; $('menu').hidden = false;
  pintarMenu();
}
function mostrarResultados() {
  $('r-total').textContent = fmt(crono.t);
  const fin = crono.eventosFin || {};
  $('r-record').innerHTML = fin.record ? '<span class="mejor-t">🏆 ¡Récord!</span>' + (fin.delta != null ? ' (' + fmt(fin.delta, true) + ')' : '') : (crono.recordTotal != null ? 'Récord: ' + fmt(crono.recordTotal) : '');
  const ol = $('r-vueltas'); ol.innerHTML = '';
  const mejor = Math.min(...crono.tiemposVuelta);
  crono.tiemposVuelta.forEach(t => { const li = document.createElement('li'); li.textContent = fmt(t); if (t === mejor && crono.tiemposVuelta.length > 1) li.className = 'mejor'; ol.appendChild(li); });
  $('resultados').hidden = false;
}

// ---------------------------------------------------------------------------
// HUD y minimapa
// ---------------------------------------------------------------------------
let tMensaje = 0;
function mensaje(t, sub, dur, clase) {
  $('mensaje').textContent = t; $('submensaje').innerHTML = sub || '';
  $('submensaje').className = clase || '';
  $('mensaje').style.opacity = t ? 1 : 0; $('submensaje').style.opacity = sub ? 1 : 0;
  tMensaje = dur || 0;
}
let tHud = 0;
function actualizarHUD(forzar) {
  if (!forzar && (tHud += 1 / 60) < 0.06) return; tHud = 0;
  $('h-total').textContent = fmt(crono.t);
  $('h-vuelta').textContent = Math.min(crono.vuelta, crono.vueltas) + '/' + crono.vueltas;
  $('h-tvuelta').textContent = fmt(crono.tiempoVuelta);
  $('h-mejor').textContent = crono.mejorVuelta != null ? fmt(crono.mejorVuelta) : '–';
  $('h-control').textContent = crono.total ? (crono.siguiente < crono.total ? (crono.siguiente + 1) + '/' + crono.total : 'meta') : '–';
  const v = Math.hypot(coche.vx, coche.vz) * 3.6;
  $('h-vel').textContent = Math.round(v);
  $('h-marcha').textContent = coche.atras ? 'R' : coche.marcha;
  $('h-rpm').firstChild.style.width = Math.round((coche.rpm - coche.p.rpmRalenti) / (coche.p.rpmCorte - coche.p.rpmRalenti) * 100) + '%';
  const sup = supActual();
  $('h-superficie').textContent = (SUPERFICIES[sup] || {}).nombre || sup;
}
function supActual() {
  const cnt = {}; for (const w of coche.ruedas) cnt[w.sup] = (cnt[w.sup] || 0) + 1;
  return Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
}

let mapa = null;
function dibujarMapaBase() {
  const tam = 360, cv = document.createElement('canvas'); cv.width = cv.height = tam;
  const g = cv.getContext('2d');
  // encuadre: los caminos (o todo el terreno)
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pista.caminos) for (const m of p.mu) { x0 = Math.min(x0, m.x); x1 = Math.max(x1, m.x); z0 = Math.min(z0, m.z); z1 = Math.max(z1, m.z); }
  if (!isFinite(x0)) { const h = esc.terreno.tam / 2; x0 = z0 = -h; x1 = z1 = h; }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, lado = Math.max(x1 - x0, z1 - z0) * 1.18 + 40;
  const aP = (x, z) => [(x - cx) / lado * tam + tam / 2, (z - cz) / lado * tam + tam / 2];
  g.lineCap = g.lineJoin = 'round';
  for (const l of pista.lagos) { const [px, pz] = aP(l.x, l.z); g.fillStyle = 'rgba(80,150,200,0.7)'; g.beginPath(); g.arc(px, pz, l.r / 1.35 / lado * tam, 0, 7); g.fill(); }
  for (const r of pista.rios) { g.strokeStyle = 'rgba(90,160,220,0.85)'; g.lineWidth = 3; g.beginPath(); r.mu.forEach((m, k) => { const [px, pz] = aP(m.x, m.z); k ? g.lineTo(px, pz) : g.moveTo(px, pz); }); g.stroke(); }
  for (const pu of pista.pueblos) { const [px, pz] = aP(pu.x, pu.z); g.fillStyle = 'rgba(240,230,210,0.35)'; const h = E.mitadTerrenoPueblo(pu.props.cfg) / lado * tam; g.fillRect(px - h * 0.6, pz - h * 0.6, h * 1.2, h * 1.2); }
  for (const p of pista.caminos) {
    for (const [col, w] of [['rgba(0,0,0,0.6)', 9], ['#e8dcc0', 5]]) {
      g.strokeStyle = col; g.lineWidth = w; g.beginPath();
      p.mu.forEach((m, k) => { const [px, pz] = aP(m.x, m.z); k ? g.lineTo(px, pz) : g.moveTo(px, pz); });
      if (p.cerrado) g.closePath(); g.stroke();
    }
    for (const b of p.puentes) { const q = pista.puntoEn(p, b.d), [px, pz] = aP(q.x, q.z); g.fillStyle = '#b07a4a'; g.fillRect(px - 4, pz - 4, 8, 8); }
  }
  mapa = { cv, aP, tam };
}
let tMapa = 0;
function dibujarMinimapa(dt) {
  if ((tMapa += dt) < 0.08 || !mapa) return; tMapa = 0;
  const c = $('minimapa'), g = c.getContext('2d'), W = c.width;
  g.clearRect(0, 0, W, W);
  g.save(); g.beginPath(); g.arc(W / 2, W / 2, W / 2, 0, 7); g.clip();
  g.drawImage(mapa.cv, 0, 0, W, W);
  const k = W / mapa.tam;
  const P = (x, z) => { const [a, b] = mapa.aP(x, z); return [a * k, b * k]; };
  // controles (el siguiente, grande) y meta
  crono.controles.forEach((cp, i) => {
    const [px, pz] = P(cp.x, cp.z), sig = i === crono.siguiente;
    g.fillStyle = i < crono.siguiente ? 'rgba(60,207,110,0.9)' : sig ? '#ffb020' : 'rgba(255,255,255,0.7)';
    g.beginPath(); g.arc(px, pz, sig ? 6 : 3.5, 0, 7); g.fill();
    if (sig) { g.fillStyle = '#000'; g.font = 'bold 8px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), px, pz + 0.5); }
  });
  if (crono.meta) { const [px, pz] = P(crono.meta.x, crono.meta.z); g.fillStyle = crono.siguiente >= crono.total ? '#ffb020' : '#fff'; g.fillRect(px - 4, pz - 4, 8, 8); g.fillStyle = '#000'; g.fillRect(px - 4, pz - 4, 4, 4); g.fillRect(px, pz, 4, 4); }
  // coche
  const [cx, cz] = P(coche.x, coche.z);
  g.translate(cx, cz); g.rotate(-coche.rumbo + Math.PI);
  g.fillStyle = '#ff4030'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(0, 3); g.lineTo(-5, 6); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

// ---------------------------------------------------------------------------
// Bucle
// ---------------------------------------------------------------------------
let ultimo = performance.now(), ultimoPitido = 4, tPueblos = 0;
const mandoParado = { gas: 0, freno: 0, giro: 0, manoFreno: true };
function bucle(ahora) {
  requestAnimationFrame(bucle);
  const dt = Math.min(0.05, (ahora - ultimo) / 1000); ultimo = ahora;
  if (estado === 'menu' || estado === 'carga' || !coche || !escena) {
    if (escena && estado === 'menu') { // de fondo, el escenario girando despacio
      const t = ahora / 1000 * 0.05, s = puntoSalida();
      camara.position.set(s.x + Math.cos(t) * 60, E.alturaEn(esc, s.x, s.z) + 25, s.z + Math.sin(t) * 60);
      camara.lookAt(s.x, E.alturaEn(esc, s.x, s.z) + 2, s.z);
      escena.actualizar(dt, camara); renderer.render(scene, camara);
    }
    return;
  }
  const mandoLeido = autopiloto ? pilotoAuto() : controles.leer(dt);
  for (const a of controles.sacarAcciones()) {
    if (a === 'pausa') pausar(!pausado);
    else if (pausado) continue;
    else if (a === 'camara') { const c = camaras.siguiente(); prefs.camara = c.id; guardarPrefs(); aviso('🎥 ' + c.nombre, 1200); }
    else if (a === 'reiniciar' && estado !== 'cuenta') volverAPista();
    else if (a === 'sonido') { prefs.sonido = !prefs.sonido; sonido.setActivo(prefs.sonido); $('p-sonido').checked = prefs.sonido; aviso(prefs.sonido ? '🔊 Sonido' : '🔇 Sin sonido', 1000); }
  }
  if (pausado) { renderer.render(scene, camara); return; }

  // Cuenta atrás
  if (estado === 'cuenta') {
    tCuenta -= dt;
    const n = Math.ceil(tCuenta);
    if (n !== ultimoPitido && n >= 1 && n <= 3) { ultimoPitido = n; mensaje(String(n), ''); sonido.pitido(440, 0.18); }
    if (tCuenta <= 0) { estado = 'carrera'; crono.empezar(); mensaje('¡YA!', '', 1); sonido.pitido(880, 0.45); }
  }
  // Física a paso fijo
  const mando = estado === 'cuenta' ? Object.assign({}, mandoParado, { gas: mandoLeido.gas }) : estado === 'fin' ? { gas: 0, freno: 0.4, giro: 0, manoFreno: false } : mandoLeido;
  acumulado += dt;
  let pasos = 0;
  while (acumulado >= PASO && pasos < 8) {
    const px = coche.x, pz = coche.z;
    coche.paso(PASO, mando, obstaculos);
    if (estado === 'carrera') crono.actualizar(PASO, px, pz, coche.x, coche.z);
    for (const ev of crono.eventos) evento(ev);
    for (const im of coche.impactos) impacto(im);
    acumulado -= PASO; pasos++;
  }
  if (pasos === 8) acumulado = 0;
  if (coche.ahogado > 2.5) volverAPista();

  colocarCoche(modelo, coche);
  camaras.actualizar(dt, coche, modelo);
  escena.actualizar(dt, camara);
  escena.setFoco(coche.x, coche.z, prefs.calidad === 'alta' ? 140 : 90);
  if ((tPueblos += dt) > 1) { tPueblos = 0; obstaculos.actualizarPueblos(escena); }
  emitirParticulas(dt);
  particulas.actualizar(dt);
  sonido.actualizar({ rpm: coche.rpm, gas: coche.gasActual || 0, velocidad: coche.velocidad, superficie: supActual(), enSuelo: coche.enSuelo, derrape: Math.max(...coche.ruedas.map(w => w.deslizando)), agua: coche.agua });
  if (tMensaje > 0) { tMensaje -= dt; if (tMensaje <= 0) mensaje('', ''); }
  actualizarHUD(); dibujarMinimapa(dt);
  renderer.render(scene, camara);
}

// Piloto automático (para pruebas y demostraciones): apunta a la pista unos metros por delante y frena antes de las curvas
let autopiloto = false;
function pilotoAuto() {
  const p = pista.caminos[0];
  if (!p) return { gas: 0, freno: 0, giro: 0, manoFreno: false };
  const pr = pista.proyectar(p, coche.x, coche.z, 40) || pista.masCercano(coche.x, coche.z).pr;
  const v = coche.velocidad, q = pista.puntoEn(p, pr.d + 9 + v * 0.7);
  let dif = Math.atan2(q.x - coche.x, q.z - coche.z) - coche.rumbo;
  while (dif > Math.PI) dif -= 2 * Math.PI; while (dif < -Math.PI) dif += 2 * Math.PI;
  const a = pista.puntoEn(p, pr.d), b = pista.puntoEn(p, pr.d + 30 + v);
  const curva = Math.acos(Math.max(-1, Math.min(1, a.dx * b.dx + a.dz * b.dz)));
  const vObj = Math.max(9, 30 - curva * 38);
  return { gas: v < vObj ? 1 : 0, freno: v > vObj + 3 ? 0.6 : 0, giro: Math.max(-1, Math.min(1, -dif * 2.2)), manoFreno: false, analogico: true };
}
// Avanza la carrera «seg» segundos de golpe (sin dibujar), con el piloto automático
function avanzar(seg) {
  if (estado === 'cuenta') { estado = 'carrera'; crono.empezar(); }
  const n = Math.round(seg / PASO);
  for (let k = 0; k < n; k++) {
    const px = coche.x, pz = coche.z;
    coche.paso(PASO, estado === 'fin' ? { gas: 0, freno: 0.4, giro: 0, manoFreno: false } : pilotoAuto(), obstaculos);
    if (estado === 'carrera') crono.actualizar(PASO, px, pz, coche.x, coche.z);
    for (const ev of crono.eventos) evento(ev);
    if (k % 120 === 0) obstaculos.actualizarPueblos(escena);
  }
  camaras.iniciada = false;
}

function evento(ev) {
  if (ev.tipo === 'control') {
    const d = ev.delta;
    mensaje('', `Control ${ev.n} · ${fmt(ev.t)}${d != null ? ` <span class="${d <= 0 ? 'mejor-t' : 'peor-t'}">${fmt(d, true)}</span>` : ''}`, 2.5);
    sonido.pitido(1200, 0.08);
  } else if (ev.tipo === 'vuelta') {
    const d = ev.delta;
    if (ev.n < crono.vueltas) mensaje(`Vuelta ${ev.n + 1}`, `${fmt(ev.t)}${ev.record ? ' <span class="mejor-t">🏆 mejor vuelta</span>' : d != null ? ` <span class="peor-t">${fmt(d, true)}</span>` : ''}`, 3);
    sonido.pitido(990, 0.25);
  } else if (ev.tipo === 'fin') {
    crono.eventosFin = ev;
    estado = 'fin';
    mensaje('¡META!', fmt(ev.t) + (ev.record ? ' <span class="mejor-t">🏆 ¡récord!</span>' : ''), 3);
    sonido.pitido(660, 0.6);
    setTimeout(() => { if (estado === 'fin') mostrarResultados(); }, 2200);
  }
}
let tGolpe = 0;
function impacto(im) {
  const ahora = performance.now();
  if (!im.blanda && ahora - tGolpe < 120 && im.v < 6) return;
  tGolpe = ahora;
  sonido.golpe(im.v, im.sonido);
  if (!im.blanda && im.v > 2) { camaras.sacudir(Math.min(0.5, im.v / 20)); controles.vibrar(Math.min(1, im.v / 12), 150); }
}

function emitirParticulas(dt) {
  const v = coche.velocidad;
  for (const w of coche.ruedas) {
    if (!w.contacto) continue;
    const sup = SUPERFICIES[w.sup];
    if (w.agua > 0.04 && v > 2) {
      const n = Math.min(6, v * dt * 8 * Math.min(1, w.agua * 4));
      for (let k = 0; k < n; k++) particulas.emitir(w.x, w.y - coche.m.radio + 0.2, w.z, coche.vx * 0.3 + (Math.random() - 0.5) * 4, 2 + Math.random() * 3, coche.vz * 0.3 + (Math.random() - 0.5) * 4, '#e6f4fa', 0.9, 0.9);
      continue;
    }
    if (!sup || !sup.polvo) continue;
    const fuerza = (w.del ? 0.25 : 1) * Math.min(1, v / 25) + w.deslizando * 1.5 + w.patinando;
    const n = fuerza * dt * 22 * (prefs.calidad === 'baja' ? 0.5 : 1);
    let ent = Math.floor(n); if (Math.random() < n - ent) ent++;
    for (let k = 0; k < ent; k++) {
      particulas.emitir(w.x + (Math.random() - 0.5) * 0.4, w.y - coche.m.radio + 0.15, w.z + (Math.random() - 0.5) * 0.4,
        -coche.vx * 0.12 + (Math.random() - 0.5) * 1.5, 0.4 + Math.random() * 1.2, -coche.vz * 0.12 + (Math.random() - 0.5) * 1.5,
        sup.polvo, 1.2 + Math.random() * 1.2, 1.4 + Math.random() * 1.2);
    }
  }
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
(async () => {
  await cargarIndices();
  elegidoEsc = indiceEsc.find(s => s.id === (params.get('escenario') || prefs.escenario)) || indiceEsc[0] || null;
  // ?coche=gen:12345 (o la preferencia guardada) → ese coche generado, aunque no esté en el garaje
  const pc = params.get('coche') || prefs.coche;
  if (/^gen:\d+$/.test(pc || '') && !indiceCoches.some(c => c.id === pc)) { try { indiceCoches.push(cocheGenerado(+pc.slice(4))); } catch (e) { /* nada */ } }
  for (const c of indiceCoches) if (c.semilla && (prefs.generados || []).includes(c.semilla)) c.guardado = true;
  elegidoCoche = indiceCoches.find(c => c.id === pc) || indiceCoches[0] || null;
  // ?escenario=<dirección de un .json> también vale
  const pe = params.get('escenario');
  if (pe && !indiceEsc.some(s => s.id === pe) && /\.json($|\?)/.test(pe)) { elegidoEsc = { id: 'url:' + pe, nombre: pe.split('/').pop(), desc: pe, icono: '🔗', url: pe }; indiceEsc.push(elegidoEsc); }
  if (params.get('vueltas')) prefs.vueltas = +params.get('vueltas');
  if (params.get('camara')) prefs.camara = params.get('camara');
  if (params.get('calidad')) prefs.calidad = params.get('calidad');
  pintarMenu();
  requestAnimationFrame(bucle);
  if (params.has('jugar')) empezarPartida();
})();

// Para las pruebas automáticas (Playwright) y para trastear desde la consola
window.__rallys = {
  get coche() { return coche; }, get crono() { return crono; }, get pista() { return pista; }, get obstaculos() { return obstaculos; },
  get escena() { return escena; }, get estado() { return estado; }, get camaras() { return camaras; }, controles, THREE,
  colocar(x, z, rumbo) { coche.reiniciar(x, z, rumbo); camaras.iniciada = false; },
  saltarCuenta() { tCuenta = 0.001; },
  avanzar, set autopiloto(v) { autopiloto = v; }, get autopiloto() { return autopiloto; }
};
