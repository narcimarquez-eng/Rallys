// Coches de «Hacer coches» (narcimarquez-eng/Hacer-coches-): un .glb exportado con GLTFExporter.
//
// Lo que sale de allí (parametric_car.html → «⬇ Exportar GLB»):
//  · Metros, +Y arriba, el morro hacia +Z (eje delantero en z > 0), el suelo en y = 0 (las ruedas lo tocan).
//  · Raíz «LuxuryCar» con grupos Body, Cabin, FrontDetails, RearDetails, SideDetails, Interior y Wheels.
//  · Wheels tiene 4 grupos «Wheel» (al cargar: Wheel, Wheel_1…) con el origen en el centro de la rueda, en
//    (±ancho de vía/2, radio, ±eje). El nombre no dice cuál es cuál: se sabe por su posición.
//  · El conductor va en −x (asientos «SeatCushionF_-1»): el volante está a ese lado.
//  · Trae luces puntuales (una por rueda y otra en la cabina) y, si había una zona seleccionada al exportar, la caja
//    azul de selección (malla en alambre sin nombre). Aquí se quitan; también las mallas con vértices NaN (algunas
//    piezas de detalle salen con medidas NaN).
// Cualquier otro .glb también vale: si no tiene ruedas con nombre se buscan por forma, y si no hay, el coche se mueve
// igual (sin ruedas animadas). Se escala a un largo creíble si viene en otras unidades.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const cargador = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

function tieneNaN(geo) {
  const a = geo && geo.attributes && geo.attributes.position;
  if (!a) return false;
  for (let k = 0; k < a.array.length; k++) if (!Number.isFinite(a.array[k])) return true;
  return false;
}

// fuente: URL (string), ArrayBuffer (un .glb) o un THREE.Object3D ya hecho (los coches generados al momento).
// opciones: { girar180, escala }
export async function cargarCoche(fuente, opciones) {
  opciones = opciones || {};
  const raiz = fuente && fuente.isObject3D ? fuente
    : (typeof fuente === 'string' ? await cargador.loadAsync(fuente) : await cargador.parseAsync(fuente, '')).scene;
  // Limpieza
  const quitar = [];
  raiz.traverse(o => {
    if (o.isLight || o.isLine || o.isPoints) quitar.push(o); // luces y la caja de selección (líneas)
    else if (o.isMesh && (tieneNaN(o.geometry) || (o.material && o.material.wireframe))) quitar.push(o);
  });
  for (const o of quitar) o.parent && o.parent.remove(o);
  if (opciones.girar180) raiz.rotation.y = Math.PI;
  raiz.updateMatrixWorld(true);

  // Ruedas: por nombre, y si no, mallas o grupos casi cilíndricos cerca de las cuatro esquinas inferiores
  let ruedas = [];
  raiz.traverse(o => { if (/^(wheel|rueda)(_\d+)?$/i.test(o.name) && !ruedas.some(r => isAncestro(r, o))) ruedas.push(o); });
  if (ruedas.length < 4) ruedas = buscarRuedasPorForma(raiz);
  const caja = new THREE.Box3();
  const cajaCuerpo = new THREE.Box3();
  raiz.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    caja.union(b);
    if (!ruedas.some(r => isAncestro(r, o))) cajaCuerpo.union(b);
  });
  // Escala: un coche mide entre 2,5 y 7 m; si no, se lleva a 4,3 m
  const largo0 = caja.max.z - caja.min.z, ancho0 = caja.max.x - caja.min.x;
  let escala = opciones.escala || 1;
  if (!opciones.escala && (Math.max(largo0, ancho0) < 2.2 || Math.max(largo0, ancho0) > 9)) escala = 4.3 / Math.max(largo0, ancho0);
  // modelo «de lado» (largo en x): se gira para que el largo vaya en z
  const deLado = ancho0 > largo0 * 1.3;

  const contenedor = new THREE.Group();
  const cuerpo = new THREE.Group(); // cabecea y se balancea; dentro va el modelo tal cual (con su giro y escala)
  contenedor.add(cuerpo);
  cuerpo.add(raiz);
  if (deLado) raiz.rotation.y += Math.PI / 2;
  raiz.scale.multiplyScalar(escala);
  contenedor.updateMatrixWorld(true);
  // Medidas con todo ya colocado; el suelo (lo más bajo de las ruedas o del coche) a y = 0
  const centros = ruedas.map(r => { const c = new THREE.Box3().setFromObject(r); return { obj: r, c: c.getCenter(new THREE.Vector3()), radio: (c.max.y - c.min.y) / 2, caja: c }; });
  const total = new THREE.Box3().setFromObject(raiz);
  const suelo = centros.length ? Math.min(...centros.map(w => w.caja.min.y)) : total.min.y;
  raiz.position.y -= suelo; contenedor.updateMatrixWorld(true);
  for (const w of centros) w.c.y -= suelo;
  total.setFromObject(raiz);

  let medidas;
  if (centros.length >= 4) {
    const zs = centros.map(w => w.c.z), xs = centros.map(w => Math.abs(w.c.x));
    const ejeDel = Math.max(...zs), ejeTras = Math.min(...zs);
    medidas = { ejeDel, ejeTras, batalla: ejeDel - ejeTras, via: 2 * xs.reduce((a, b) => a + b, 0) / xs.length, radio: centros.reduce((a, w) => a + w.radio, 0) / centros.length };
  } else {
    const L = total.max.z - total.min.z;
    medidas = { ejeDel: total.max.z - L * 0.2, ejeTras: total.min.z + L * 0.2, batalla: L * 0.6, via: (total.max.x - total.min.x) * 0.85, radio: 0.33 };
  }
  Object.assign(medidas, {
    largo: total.max.z - total.min.z, ancho: total.max.x - total.min.x, alto: total.max.y - total.min.y,
    zCentro: (total.max.z + total.min.z) / 2, techo: total.max.y
  });
  // Ruedas: se sacan a un pivote propio (dirección y suspensión) en coordenadas del contenedor
  const piezasRueda = [];
  for (const w of centros) {
    const pivote = new THREE.Group();
    pivote.position.copy(w.c);
    const giro = new THREE.Group(); // gira con la dirección (Y) y rueda (X)
    giro.rotation.order = 'YXZ';
    pivote.add(giro);
    // mover la rueda dentro de «giro» conservando su posición en el mundo
    const mundo = w.obj.matrixWorld.clone();
    w.obj.parent.remove(w.obj);
    giro.add(w.obj);
    contenedor.add(pivote);
    contenedor.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(giro.matrixWorld).invert();
    w.obj.matrix.copy(inv.multiply(mundo)); w.obj.matrix.decompose(w.obj.position, w.obj.quaternion, w.obj.scale);
    piezasRueda.push({ pivote, giro, x: w.c.x, y: w.c.y, z: w.c.z, del: w.c.z > (medidas.ejeDel + medidas.ejeTras) / 2, izq: w.c.x > 0 });
  }
  // Cabina: el asiento del conductor (en Hacer coches, el delantero de −x) o, si no, una posición razonable
  let asiento = null;
  raiz.traverse(o => { if (!asiento && /^SeatCushionF_-1/.test(o.name)) asiento = o; });
  let ojos;
  if (asiento) {
    const b = new THREE.Box3().setFromObject(asiento), c = b.getCenter(new THREE.Vector3());
    ojos = new THREE.Vector3(c.x, Math.min(b.max.y + 0.72, medidas.techo - 0.12), c.z - 0.12);
  } else {
    ojos = new THREE.Vector3(-medidas.via * 0.22, medidas.techo - 0.22, medidas.ejeTras + medidas.batalla * 0.45);
  }
  // Capó: sobre la base del parabrisas, mirando por encima del capó (que se ve abajo)
  const alturaEn = z => {
    const rayo = new THREE.Raycaster(new THREE.Vector3(0, medidas.techo + 1, z), new THREE.Vector3(0, -1, 0));
    const h = rayo.intersectObject(raiz, true).filter(g => !/glass|win|shield|roof/i.test(g.object.name));
    return h.length ? h[0].point.y : null;
  };
  // Si hay parabrisas («Windshield» en Hacer coches), justo delante de su base; si no, sobre el eje delantero
  let parabrisas = null;
  raiz.traverse(o => { if (!parabrisas && o.isMesh && /windshield|parabrisas/i.test(o.name)) parabrisas = new THREE.Box3().setFromObject(o); });
  let capo;
  if (parabrisas) capo = new THREE.Vector3(0, parabrisas.min.y + 0.32, parabrisas.max.z + 0.12);
  else {
    const altoCapo = alturaEn(medidas.ejeDel) || medidas.techo * 0.65;
    capo = new THREE.Vector3(0, Math.min(medidas.techo - 0.05, altoCapo + 0.42), medidas.ejeDel - medidas.batalla * 0.15);
  }

  raiz.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = true; } });
  // Puntos de las cámaras de capó y cabina, pegados a la carrocería (cabecean y se balancean con ella)
  const anclaCabina = new THREE.Object3D(); anclaCabina.position.copy(ojos); cuerpo.add(anclaCabina);
  const anclaCapo = new THREE.Object3D(); anclaCapo.position.copy(capo); cuerpo.add(anclaCapo);
  return { objeto: contenedor, carroceria: cuerpo, ruedas: piezasRueda, medidas, ojos, capo, anclaCabina, anclaCapo };
}

function isAncestro(a, o) { while (o) { if (o === a) return true; o = o.parent; } return false; }

function buscarRuedasPorForma(raiz) {
  const cands = [];
  raiz.traverse(o => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o), s = b.getSize(new THREE.Vector3());
    // casi redonda vista de lado (y ≈ z) y estrecha (x pequeña)
    if (s.y > 0.2 && Math.abs(s.y - s.z) < s.y * 0.15 && s.x < s.y * 0.8) cands.push({ o, b, s });
  });
  cands.sort((a, b) => b.s.y - a.s.y);
  const out = [];
  for (const c of cands) {
    const cen = c.b.getCenter(new THREE.Vector3());
    if (out.some(w => w.cen.distanceTo(cen) < c.s.y)) continue;
    out.push({ o: c.o, cen });
    if (out.length === 4) break;
  }
  return out.length === 4 ? out.map(w => w.o) : [];
}

// Coloca el modelo con el estado de la física (coche: Coche de coche.js). modelo: lo que devuelve cargarCoche.
// El contenedor va a la altura de la base y gira con el rumbo; la carrocería cabecea y se balancea; cada rueda baja
// o sube con su suspensión, gira con la dirección y rueda.
export function colocarCoche(modelo, coche) {
  const o = modelo.objeto;
  o.position.set(coche.x, coche.y, coche.z);
  // el centro de gravedad de la física está en z = cdgZ del modelo
  const s = Math.sin(coche.rumbo), c = Math.cos(coche.rumbo);
  o.position.x -= coche.cdgZ * s; o.position.z -= coche.cdgZ * c;
  o.rotation.order = 'YXZ';
  o.rotation.set(0, coche.rumbo, 0);
  // cabeceo y balanceo alrededor del centro de gravedad
  const car = modelo.carroceria;
  car.rotation.order = 'YXZ';
  const pivoteZ = coche.cdgZ, pivoteY = coche.p.alturaCdg;
  car.rotation.x = -coche.cab; car.rotation.z = coche.bal;
  // compensar para que gire alrededor del cdg y no del origen del modelo
  const q = new THREE.Quaternion().setFromEuler(car.rotation);
  const piv = new THREE.Vector3(0, pivoteY, pivoteZ);
  const rot = piv.clone().applyQuaternion(q);
  car.position.copy(piv).sub(rot);
  for (let k = 0; k < modelo.ruedas.length; k++) {
    const w = modelo.ruedas[k];
    // rueda física que le toca (0 DI, 1 DD, 2 TI, 3 TD)
    const f = coche.ruedas[(w.del ? 0 : 2) + (w.izq ? 0 : 1)];
    w.pivote.position.y = f.y - coche.y;
    w.giro.rotation.y = w.del ? coche.giro : 0;
    w.giro.rotation.x = f.vueltas;
  }
}
