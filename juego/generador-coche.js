// Coches generados al momento con el creador de Hacer coches (vendor/hacer-coches/generador.js, sacado de
// parametric_car.html con tools/actualizar-hacer-coches.sh) y unas estadísticas al azar que salen con cada uno.
//
// Todo sale de una «semilla» (un número): la misma semilla da el mismo coche y las mismas estadísticas, así que basta
// con guardar el número para volver a tenerlo (preferencias, récords, ?coche=gen:12345 en la dirección).
//
// Las estadísticas no son del todo al azar: parten de la carrocería y de los neumáticos que haya sacado el creador.
//  · Carrocería (compacto, cupé, berlina, SUV, limusina) → peso, recorrido de suspensión y altura del centro de gravedad.
//  · Dibujo del neumático → agarre: «racing» agarra más en asfalto y menos en tierra; «all-terrain», al revés.
//  · Potencia, tracción (delantera, total o trasera), frenos y dirección, al azar dentro de márgenes creíbles.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as G from '../vendor/hacer-coches/generador.js';
import { PARAMS_BASE } from './coche.js';

// Generador de números al azar con semilla (mulberry32)
function azar(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function semillaNueva() { return 1 + Math.floor(Math.random() * 999998); }

// Por carrocería: [masa mín, masa máx], recorrido de suspensión, alturaCdg y nombre corto
const CARROCERIAS = {
  compact:   { masa: [980, 1220], recorrido: [0.14, 0.2], cdg: 0.46, nombre: 'Compacto' },
  coupe:     { masa: [1120, 1380], recorrido: [0.12, 0.17], cdg: 0.42, nombre: 'Cupé' },
  sedan:     { masa: [1320, 1580], recorrido: [0.15, 0.2], cdg: 0.5, nombre: 'Berlina' },
  suv:       { masa: [1500, 1820], recorrido: [0.21, 0.27], cdg: 0.66, nombre: 'Todoterreno' },
  limousine: { masa: [1700, 2000], recorrido: [0.15, 0.2], cdg: 0.54, nombre: 'Limusina' }
};
// Por dibujo del neumático: agarre en firme y en suelto
const NEUMATICOS = {
  racing:        { firme: 1.09, suelto: 0.9, nombre: 'De carreras' },
  sport:         { firme: 1.0, suelto: 1.0, nombre: 'Deportivos' },
  'all-terrain': { firme: 0.93, suelto: 1.12, nombre: 'Todo terreno' }
};
const TRACCIONES = [
  { nombre: 'Delantera', reparto: 1 },
  { nombre: 'Total', reparto: 0.42 },
  { nombre: 'Total', reparto: 0.5 },
  { nombre: 'Trasera', reparto: 0 }
];
const NOMBRES = ['Cierzo', 'Tramontana', 'Lince', 'Halcón', 'Centella', 'Brava', 'Furia', 'Sierra', 'Rayo', 'Garbí',
  'Mistral', 'Pardal', 'Jabalí', 'Corzo', 'Vendaval', 'Galerna', 'Torbellino', 'Cometa', 'Relámpago', 'Bravío'];

// Saca la configuración del creador para una semilla. randomize() usa Math.random: se cambia un momento por el de la
// semilla para que salga siempre igual. Los materiales se crean nuevos cada vez (randomize los retoca al final), así el
// coche anterior conserva los suyos.
function configurar(semilla) {
  const original = Math.random;
  Object.assign(G.CONFIG, JSON.parse(JSON.stringify(G.DEFAULTS)));
  G.createMaterials();
  Math.random = azar(semilla);
  try { G.randomize(); } finally { Math.random = original; }
  return JSON.parse(JSON.stringify(G.CONFIG));
}

// El coche en 3D (un THREE.Group como el que exporta el creador) con sus datos para la física
export function generarCoche(semilla) {
  const config = configurar(semilla);
  const P = G.derive(G.PRESETS[G.CONFIG.model]);
  const original = Math.random;
  Math.random = azar(semilla ^ 0x9e3779b9); // algunas líneas de diseño salen al azar
  const grupo = new THREE.Group();
  try {
    grupo.name = 'LuxuryCar';
    grupo.add(G.buildBody(P), G.buildCabin(P), G.buildFrontDetails(P), G.buildRearDetails(P), G.buildSideDetails(P),
      G.buildInterior(P), G.buildWheels(P).group);
  } finally { Math.random = original; }
  return { grupo, config, ...estadisticas(semilla, config) };
}

// Solo nombre y estadísticas, sin construir el coche
export function fichaCoche(semilla) { return estadisticas(semilla, configurar(semilla)); }

// Estadísticas (solo dependen de la semilla y de lo que sacó el creador; no hace falta construir el coche)
function estadisticas(semilla, config) {
  const r = azar(semilla ^ 0x5bd1e995);
  const entre = (a, b) => a + (b - a) * r();
  const car = CARROCERIAS[config.model] || CARROCERIAS.sedan;
  const neu = NEUMATICOS[config.tire.treadStyle] || NEUMATICOS.sport;
  const tr = TRACCIONES[Math.floor(r() * TRACCIONES.length)];
  // ruedas grandes: algo más de peso y de recorrido
  const ruedas = config.wheelRadius || 1;
  const datos = {
    masa: Math.round(entre(car.masa[0], car.masa[1]) * (0.94 + ruedas * 0.06) / 10) * 10,
    potencia: Math.round(entre(140, 330)),
    reparto: tr.reparto,
    recorrido: +(entre(car.recorrido[0], car.recorrido[1]) * (0.9 + ruedas * 0.1)).toFixed(3),
    amortiguacion: +entre(0.3, 0.44).toFixed(2),
    alturaCdg: +(car.cdg * entre(0.92, 1.08)).toFixed(2),
    frenada: +entre(0.92, 1.16).toFixed(2),
    giroMax: +entre(0.52, 0.66).toFixed(2),
    agarreFirme: +(neu.firme * entre(0.96, 1.04)).toFixed(3),
    agarreSuelto: +(neu.suelto * entre(0.96, 1.04)).toFixed(3)
  };
  const nombre = `${NOMBRES[Math.floor(r() * NOMBRES.length)]} ${car.nombre} ${100 + (semilla % 900)}`;
  return { nombre, datos, tipo: car.nombre, neumaticos: neu.nombre, traccion: tr.nombre, color: config.paint.color, barras: barras(datos) };
}

// Valores de 0 a 10 para pintar las barras del menú (también para los coches fijos, con lo que no traen de PARAMS_BASE)
export function barras(datos) {
  const d = Object.assign({}, PARAMS_BASE, datos);
  const a10 = (v, min, max) => Math.max(0, Math.min(10, Math.round((v - min) / (max - min) * 10 * 10) / 10));
  const kgPorCv = d.masa / (d.potencia * 1.36);
  return [
    { nombre: 'Potencia', valor: a10(d.potencia, 120, 340), texto: Math.round(d.potencia * 1.36) + ' CV' },
    { nombre: 'Aceleración', valor: a10(-kgPorCv, -12, -2.5), texto: kgPorCv.toFixed(1) + ' kg/CV' },
    { nombre: 'Agarre en asfalto', valor: a10(d.agarreFirme, 0.86, 1.14), texto: '×' + d.agarreFirme.toFixed(2) },
    { nombre: 'Agarre en tierra', valor: a10(d.agarreSuelto, 0.84, 1.18), texto: '×' + d.agarreSuelto.toFixed(2) },
    { nombre: 'Suspensión', valor: a10(d.recorrido, 0.1, 0.3), texto: Math.round(d.recorrido * 100) + ' cm' },
    { nombre: 'Frenos', valor: a10(d.frenada, 0.88, 1.18), texto: d.frenada.toFixed(2) + ' g' },
    { nombre: 'Peso', valor: a10(d.masa, 900, 2100), texto: d.masa + ' kg' }
  ];
}

// Foto del coche para la tarjeta del menú (un renderizador pequeño que se reutiliza)
let foto = null;
export function fotoCoche(grupo, ancho = 360, alto = 200) {
  if (!foto) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1d252e);
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.8));
    const sol = new THREE.DirectionalLight(0xffffff, 1.8); sol.position.set(5, 8, 6); scene.add(sol);
    const contra = new THREE.DirectionalLight(0xaaccff, 1.2); contra.position.set(-6, 3, -5); scene.add(contra);
    const camara = new THREE.PerspectiveCamera(30, ancho / alto, 0.1, 100);
    foto = { renderer, scene, camara };
  }
  const { renderer, scene, camara } = foto;
  renderer.setSize(ancho, alto, false);
  camara.aspect = ancho / alto; camara.updateProjectionMatrix();
  scene.add(grupo);
  const caja = new THREE.Box3().setFromObject(grupo);
  const c = caja.getCenter(new THREE.Vector3()), tam = caja.getSize(new THREE.Vector3());
  const d = Math.max(tam.z, tam.x * 1.6) * 1.75;
  camara.position.set(c.x + d * 0.72, c.y + d * 0.32, c.z + d * 0.62);
  camara.lookAt(c.x, c.y - tam.y * 0.08, c.z);
  renderer.render(scene, camara);
  scene.remove(grupo);
  return renderer.domElement.toDataURL('image/jpeg', 0.85);
}
