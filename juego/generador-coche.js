// Coches generados al momento con el creador realista de Hacer coches y unas estadísticas al azar que salen con cada uno.
//
// El creador («Parametric Car 3D Studio (2).html», con sus piezas de Blender) se copia entero en
// vendor/hacer-coches/creador.html con tools/actualizar-hacer-coches.sh, que solo le añade un «puente» (window.__rallys).
// Aquí se abre oculto en un <iframe>, se le pide un coche y se copia su grupo de three.js a este lado: así sale
// exactamente el coche del creador, sin pasar por exportar un .glb (eso tarda mucho más que construirlo).
//
// Todo sale de una «semilla» (un número): la misma semilla da el mismo coche y las mismas estadísticas.
//
// Las estadísticas no son del todo al azar: parten de la carrocería y de los neumáticos que haya sacado el creador.
//  · Carrocería (compacto, cupé, berlina, SUV, limusina) → peso, recorrido de suspensión y altura del centro de gravedad.
//  · Dibujo del neumático → agarre: «racing» agarra más en asfalto y menos en tierra; «all-terrain», al revés.
//  · Potencia, tracción (delantera, total o trasera), frenos y dirección, al azar dentro de márgenes creíbles.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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

// ---- El creador, abierto en un <iframe> oculto ----
let creador = null;
export function abrirCreador() {
  if (creador) return creador;
  creador = new Promise((ok, mal) => {
    const f = document.createElement('iframe');
    f.src = new URL('../vendor/hacer-coches/creador.html', import.meta.url).href;
    f.title = 'Creador de coches (oculto)';
    f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
    Object.assign(f.style, { position: 'fixed', left: '-4000px', top: '0', width: '320px', height: '240px', border: '0', visibility: 'hidden' });
    const limite = setTimeout(() => mal(new Error('El creador de coches no ha cargado')), 90000);
    const mirar = () => {
      const w = f.contentWindow;
      if (w && w.__rallys) { clearTimeout(limite); ok(w.__rallys); return; }
      setTimeout(mirar, 150);
    };
    f.onload = mirar;
    document.body.appendChild(f);
  });
  creador.catch(() => { creador = null; });
  return creador;
}

// Copia un objeto de three.js del creador (su propia copia de three.js, en otra ventana) a este lado. No vale usarlo
// tal cual: three.js reconoce los arrays por su clase y las del iframe son otras.
const texturas = new Map();
function copiaArray(a) { return new globalThis[a.constructor.name](a); }
function textura(t) {
  if (texturas.has(t.uuid)) return texturas.get(t.uuid);
  let n;
  if (t.isDataTexture) n = new THREE.DataTexture(copiaArray(t.image.data), t.image.width, t.image.height, t.format, t.type);
  else n = new THREE.Texture(t.image); // un lienzo o una imagen del iframe: se pueden usar desde aquí
  for (const k of ['wrapS', 'wrapT', 'magFilter', 'minFilter', 'anisotropy', 'flipY', 'generateMipmaps', 'colorSpace', 'rotation', 'premultiplyAlpha', 'format', 'type', 'channel']) if (k in t) n[k] = t[k];
  n.repeat.set(t.repeat.x, t.repeat.y); n.offset.set(t.offset.x, t.offset.y); n.center.set(t.center.x, t.center.y);
  n.name = t.name; n.needsUpdate = true;
  texturas.set(t.uuid, n);
  return n;
}
function valor(v) {
  if (v === null || typeof v !== 'object') return v;
  if (v.isColor) return new THREE.Color(v.r, v.g, v.b);
  if (v.isTexture) return textura(v);
  if (v.isVector2) return new THREE.Vector2(v.x, v.y);
  if (v.isVector3) return new THREE.Vector3(v.x, v.y, v.z);
  if (v.isVector4) return new THREE.Vector4(v.x, v.y, v.z, v.w);
  if (v.isEuler) return new THREE.Euler(v.x, v.y, v.z, v.order);
  if (v.isMatrix3) return new THREE.Matrix3().fromArray(v.elements);
  if (v.isMatrix4) return new THREE.Matrix4().fromArray(v.elements);
  if (Array.isArray(v)) return v.map(valor);
  if (ArrayBuffer.isView(v)) return copiaArray(v);
  const o = {}; for (const k in v) o[k] = valor(v[k]); return o; // uniforms, defines
}
const materiales = new Map();
function material(m) {
  if (materiales.has(m.uuid)) return materiales.get(m.uuid);
  const Clase = THREE[m.type] || THREE.MeshStandardMaterial;
  const n = new Clase();
  for (const k of Object.keys(m)) {
    if (k === 'uuid' || k === 'id' || k === 'type' || k === 'version' || k === '_listeners' || k === 'userData') continue;
    const pub = k[0] === '_' && k.slice(1) in n ? k.slice(1) : k; // clearcoat, sheen… se guardan en _clearcoat
    const v = m[k];
    if (typeof v === 'function') { n[pub] = v; continue; }
    const c = valor(v);
    if (n[pub] && n[pub].isColor && c && c.isColor) n[pub].copy(c);
    else n[pub] = c;
  }
  n.needsUpdate = true;
  materiales.set(m.uuid, n);
  return n;
}
const geometrias = new Map();
function geometria(g) {
  if (geometrias.has(g.uuid)) return geometrias.get(g.uuid);
  const n = new THREE.BufferGeometry();
  const atributo = a => {
    if (a.isInterleavedBufferAttribute) a = a.clone(); // se separa (en el iframe) en un atributo normal
    const b = new THREE.BufferAttribute(copiaArray(a.array), a.itemSize, a.normalized);
    b.name = a.name || '';
    return b;
  };
  for (const [k, a] of Object.entries(g.attributes)) n.setAttribute(k, atributo(a));
  if (g.index) n.setIndex(atributo(g.index));
  for (const gr of g.groups) n.addGroup(gr.start, gr.count, gr.materialIndex);
  n.name = g.name;
  geometrias.set(g.uuid, n);
  return n;
}
function copiar(o) {
  if (o.isLight || o.isCamera || o.isLine || o.isPoints || o.visible === false) return null;
  if (o.isMesh && !Array.isArray(o.material) && o.material.wireframe) return null; // la caja azul de la zona elegida en el editor
  let n;
  const mat = m => Array.isArray(m) ? m.map(material) : material(m);
  if (o.isInstancedMesh) {
    n = new THREE.InstancedMesh(geometria(o.geometry), mat(o.material), o.count);
    n.instanceMatrix.array.set(o.instanceMatrix.array); n.instanceMatrix.needsUpdate = true;
    if (o.instanceColor) n.instanceColor = new THREE.InstancedBufferAttribute(copiaArray(o.instanceColor.array), 3);
  } else if (o.isMesh) n = new THREE.Mesh(geometria(o.geometry), mat(o.material));
  else if (o.isSprite) n = new THREE.Sprite(material(o.material));
  else n = new THREE.Group();
  n.name = o.name;
  n.position.set(o.position.x, o.position.y, o.position.z);
  n.quaternion.set(o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w);
  n.scale.set(o.scale.x, o.scale.y, o.scale.z);
  n.renderOrder = o.renderOrder; n.frustumCulled = o.frustumCulled;
  for (const [k, v] of Object.entries(o.userData || {})) if (v === null || typeof v !== 'object') n.userData[k] = v;
  for (const h of o.children) { if (h.userData && h.userData.editorOnly) continue; const c = copiar(h); if (c) n.add(c); }
  return n;
}

// El coche en 3D (un THREE.Group de este lado) con su configuración y sus estadísticas. Tarda menos de un segundo
// (más la primera vez, que hay que abrir el creador).
export async function generarCoche(semilla) {
  const api = await abrirCreador();
  const r = await api.coche({ semilla });
  geometrias.clear(); materiales.clear(); // (las texturas del creador se reutilizan de un coche a otro)
  const grupo = copiar(r.objeto);
  grupo.name = 'CocheGenerado';
  return { grupo, config: r.config, ...estadisticas(semilla, r.config) };
}

// Estadísticas: solo dependen de la semilla y de la configuración que sacó el creador
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
