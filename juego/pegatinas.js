// Pegatinas de rally sobre la carrocería: dorsal en las puertas, en el capó y en el techo (el que se ve desde el
// helicóptero… y desde la cámara de persecución), la franja «RALLYS» en lo alto del parabrisas y los patrocinadores
// (los otros proyectos: Mundos-, Hacer coches y Armaduras; nada de marcas reales).
//
// Cada pegatina se proyecta sobre la carrocería con DecalGeometry (three.js): se adapta a la curva de la chapa y,
// si cae en el hueco entre dos piezas (puerta delantera y trasera), se reparte entre las dos. Funciona con cualquier
// coche (los de Hacer coches, los generados y cualquier .glb): se busca la chapa lanzando rayos desde fuera.
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

const PATROCINADORES = [['MUNDOS-', '#1f6fd6'], ['HACER COCHES', '#e8541e'], ['ARMADURAS', '#8e2a2a']];
const cacheTex = new Map();

function textura(clave, w, h, dibujar) {
  if (cacheTex.has(clave)) return cacheTex.get(clave);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  dibujar(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  cacheTex.set(clave, t);
  return t;
}
function rect(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
const FUENTE = 'system-ui, "Segoe UI", Roboto, Arial, sans-serif';

// Placa de la puerta: franja de color con RALLYS, el dorsal grande y una tira de cuadros
function texPuerta(dorsal, color) {
  return textura('puerta' + dorsal + color, 512, 400, (g, w, h) => {
    rect(g, 6, 6, w - 12, h - 12, 34); g.fillStyle = '#fff'; g.fill();
    g.lineWidth = 8; g.strokeStyle = '#111'; g.stroke();
    g.save(); rect(g, 6, 6, w - 12, h - 12, 34); g.clip();
    g.fillStyle = color; g.fillRect(0, 0, w, 104);
    g.fillStyle = '#fff'; g.font = `italic 900 76px ${FUENTE}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('RALLYS', w / 2, 58);
    for (let i = 0; i < 26; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2) { g.fillStyle = '#111'; g.fillRect(i * 20, h - 46 + j * 20, 20, 20); }
    g.restore();
    g.fillStyle = '#111'; g.font = `900 ${dorsal > 9 ? 210 : 230}px ${FUENTE}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(dorsal), w / 2, 230);
  });
}
// Círculo con el dorsal (capó y techo)
function texCirculo(dorsal, color) {
  return textura('circulo' + dorsal + color, 512, 512, (g, w) => {
    g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 6, 0, 7); g.fillStyle = color; g.fill();
    g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 44, 0, 7); g.fillStyle = '#fff'; g.fill();
    g.fillStyle = '#111'; g.font = `900 ${dorsal > 9 ? 250 : 290}px ${FUENTE}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(dorsal), w / 2, w / 2 + 14);
  });
}
// Franja del parabrisas
function texParasol(color) {
  return textura('parasol' + color, 1024, 128, (g, w, h) => {
    g.fillStyle = '#121416'; g.fillRect(0, 0, w, h);
    g.fillStyle = color; g.fillRect(0, h - 16, w, 16);
    g.fillStyle = '#fff'; g.font = `italic 900 84px ${FUENTE}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    if ('letterSpacing' in g) g.letterSpacing = '14px';
    g.fillText('RALLYS', w / 2, 58);
  });
}
function texPatrocinador(nombre, color) {
  return textura('patro' + nombre, 512, 112, (g, w, h) => {
    rect(g, 4, 4, w - 8, h - 8, 18); g.fillStyle = '#fff'; g.fill();
    g.fillStyle = color; g.font = `italic 900 ${nombre.length > 9 ? 58 : 70}px ${FUENTE}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(nombre, w / 2, h / 2 + 3, w - 30);
  });
}

const INTERIOR = /interior|seat|asiento|dash|salpic|steer|volante|pedal|cabin_?inner|headliner/i;
function esInterior(o) { for (let p = o; p; p = p.parent) if (INTERIOR.test(p.name || '')) return true; return false; }
function esVidrio(o) {
  const ms = Array.isArray(o.material) ? o.material : [o.material];
  return ms.some(m => m && (m.transparent || m.opacity < 0.99 || m.transmission > 0)) || /glass|window|windshield|vidrio|cristal|luna/i.test(o.name || '');
}

// modelo: lo que devuelve cargarCoche (recién cargado o no: se calcula con el coche en el origen y sin inclinar)
// opciones: { dorsal (1–99), color (de la franja y el círculo) }
export function ponerPegatinas(modelo, opciones) {
  const dorsal = Math.max(1, Math.min(99, Math.round(+opciones.dorsal || 1))), color = opciones.color || '#e8541e';
  quitarPegatinas(modelo);
  const obj = modelo.objeto, cuerpo = modelo.carroceria;
  const guardado = { p: obj.position.clone(), q: obj.quaternion.clone(), cp: cuerpo.position.clone(), cq: cuerpo.quaternion.clone() };
  obj.position.set(0, 0, 0); obj.quaternion.identity(); cuerpo.position.set(0, 0, 0); cuerpo.quaternion.identity();
  obj.updateMatrixWorld(true);
  const chapa = [], vidrios = [];
  cuerpo.traverse(o => {
    if (!o.isMesh || !o.visible || o.userData.pegatina || !o.geometry.attributes.normal || esInterior(o)) return;
    (esVidrio(o) ? vidrios : chapa).push(o);
  });
  const M = modelo.medidas, grupo = new THREE.Group(); grupo.name = 'Pegatinas';
  const inv = new THREE.Matrix4().copy(cuerpo.matrixWorld).invert();
  const ray = new THREE.Raycaster(), ayuda = new THREE.Object3D(), caja = new THREE.Box3(), esfera = new THREE.Sphere();
  let puestas = 0;

  function pegar(origen, dir, w, h, tex, sobre, arriba) {
    ray.set(origen, dir.clone().normalize()); ray.far = 20;
    const hit = ray.intersectObjects(sobre, false)[0];
    if (!hit || !hit.face) return false;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (n.dot(ray.ray.direction) > 0) n.negate();
    if (n.dot(ray.ray.direction) > -0.3) return false; // chapa casi de canto: quedaría estirada
    ayuda.position.copy(hit.point); ayuda.up.copy(arriba || new THREE.Vector3(0, 1, 0));
    ayuda.lookAt(hit.point.clone().add(n));
    const tam = new THREE.Vector3(w, h, Math.max(0.18, Math.min(w, h) * 0.6));
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.42, metalness: 0 });
    esfera.set(hit.point, Math.hypot(w, h, tam.z) / 2);
    let alguna = false;
    for (const m of sobre) {
      caja.setFromObject(m);
      if (!caja.intersectsSphere(esfera)) continue;
      const geo = new DecalGeometry(m, hit.point, ayuda.rotation, tam);
      if (!geo.attributes.position || geo.attributes.position.count === 0) { geo.dispose(); continue; }
      geo.applyMatrix4(inv);
      const d = new THREE.Mesh(geo, mat); d.userData.pegatina = true; d.renderOrder = 1; d.receiveShadow = true;
      grupo.add(d); alguna = true;
    }
    if (alguna) puestas++;
    return alguna;
  }

  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const mitadZ = (M.ejeDel + M.ejeTras) / 2, frente = M.zCentro + M.largo / 2, cola = M.zCentro - M.largo / 2, lejos = M.ancho + 2;
  const yPuerta = Math.max(M.radio * 1.6, M.alto * 0.44);
  const alto = Math.min(0.46, M.alto * 0.3), ancho = alto * 1.28;
  // ¿hay chapa en (y, z) de ese lado, casi a la misma distancia que en el centro de la placa?
  const xChapa = (s, y, z) => { ray.set(V(s * lejos, y, z), V(-s, 0, 0)); ray.far = 20; const h = ray.intersectObjects(chapa, false)[0]; return h ? h.point.x : null; };
  const cabe = (s, y, z, w, h) => {
    const xc = xChapa(s, y, z); if (xc == null) return false;
    for (const [dy, dz] of [[h / 2, -w / 2], [h / 2, w / 2], [-h / 2, -w / 2], [-h / 2, w / 2], [h / 2, 0]]) {
      const x = xChapa(s, y + dy * 0.95, z + dz * 0.95); if (x == null || Math.abs(x - xc) > 0.09) return false;
    }
    return true;
  };
  for (const s of [1, -1]) {
    // placa con el dorsal en las puertas (un poco por detrás del centro, donde suele estar la puerta delantera),
    // bajándola o achicándola hasta que quepa entera en la chapa (sin morder la ventanilla ni el paso de rueda)
    const zP = mitadZ + M.batalla * 0.06;
    let puesta = false;
    for (const f of [1, 0.85, 0.72]) {
      for (let y = yPuerta; y > M.radio * 0.9 && !puesta; y -= 0.04) {
        if (cabe(s, y, zP, ancho * f, alto * f)) puesta = pegar(V(s * lejos, y, zP), V(-s, 0, 0), ancho * f, alto * f, texPuerta(dorsal, color), chapa);
      }
      if (puesta) break;
    }
    if (!puesta) pegar(V(s * lejos, yPuerta, zP), V(-s, 0, 0), ancho * 0.8, alto * 0.8, texPuerta(dorsal, color), chapa);
    // patrocinadores: en la aleta delantera (detrás de la rueda) y en la trasera (sobre el paso de rueda)
    const [n1, c1] = PATROCINADORES[s > 0 ? 0 : 1], [n2, c2] = PATROCINADORES[2];
    pegar(V(s * lejos, yPuerta, M.ejeDel - M.radio - 0.22), V(-s, 0, 0), 0.42, 0.092, texPatrocinador(n1, c1), chapa);
    pegar(V(s * lejos, Math.min(M.radio * 2 + 0.16, M.alto * 0.62), M.ejeTras), V(-s, 0, 0), 0.5, 0.11, texPatrocinador(n2, c2), chapa);
  }
  // capó: entre la base del parabrisas y el morro, para leerlo de frente (como en los rallys de verdad)
  const zCapo = modelo.capo ? (modelo.capo.z + frente) / 2 : M.ejeDel;
  pegar(V(0, M.techo + 2, zCapo), V(0, -1, 0), 0.5, 0.5, texCirculo(dorsal, color), chapa, V(0, 0, -1));
  // techo: para leerlo desde detrás (la cámara de persecución)
  const zTecho = modelo.ojos ? modelo.ojos.z - 0.25 : mitadZ;
  if (!pegar(V(0, M.techo + 2, zTecho), V(0, -1, 0), 0.56, 0.56, texCirculo(dorsal, color), chapa, V(0, 0, 1)))
    pegar(V(0, M.techo + 2, zTecho), V(0, -1, 0), 0.56, 0.56, texCirculo(dorsal, color), vidrios, V(0, 0, 1));
  // franja del parabrisas: por arriba del cristal delantero
  if (vidrios.length) {
    const yP = M.techo - Math.max(0.1, M.alto * 0.075);
    pegar(V(0, yP, frente + 2), V(0, -0.12, -1), Math.min(1.25, M.ancho * 0.62), 0.15, texParasol(color), vidrios);
  }
  // por si no se ve nada por detrás: el dorsal pequeño en la trasera
  pegar(V(-M.ancho * 0.22, M.alto * 0.5, cola - 2), V(0, 0, 1), 0.22, 0.22, texCirculo(dorsal, color), chapa);

  cuerpo.add(grupo);
  obj.position.copy(guardado.p); obj.quaternion.copy(guardado.q); cuerpo.position.copy(guardado.cp); cuerpo.quaternion.copy(guardado.cq);
  obj.updateMatrixWorld(true);
  modelo.pegatinas = grupo;
  return puestas;
}

export function quitarPegatinas(modelo) {
  const g = modelo.pegatinas; if (!g) return;
  g.parent && g.parent.remove(g);
  g.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  modelo.pegatinas = null;
}
