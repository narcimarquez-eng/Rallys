// El público: aldeanos de Armaduras-glb (aldeanos/*.glb, exportados con tools/exportar-aldeanos.cjs) mirando la
// carrera en los puntos clave: la meta, los controles y las curvas más cerradas (por dentro, que es donde se ponen
// los aficionados: por fuera es donde se sale el coche).
//
// · Detrás de la cuneta, a 4–7 m del borde de la calzada, en dos filas, mirando a la carretera; nunca en el agua,
//   en otro camino ni encima de un árbol, una roca, una casa o una barrera.
// · Esperan con la animación «idle» y, cuando pasa un coche cerca, celebran («victory») o saltan («jump»).
// · Solo se dibujan los grupos cercanos y solo se animan los que están a la vista (son ~45 piezas por aldeano).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const cargador = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const ALTURA = 1.74;    // m: a esta altura se escalan (el estudio los hace de unos 2,1 m)
const VISTA = 230;      // m: grupos más lejos de la cámara, ocultos
const ANIMA = 130;      // m: más lejos, se dibujan quietos
const CERCA = 42;       // m: un coche a menos de esto, ¡a celebrar!
let modelos = null;     // url del índice → promesa de [{ id, escena, clips, escala }]

function cargarModelos(urlIndice) {
  if (!modelos) modelos = new Map();
  if (!modelos.has(urlIndice)) modelos.set(urlIndice, (async () => {
    const r = await fetch(urlIndice);
    if (!r.ok) throw new Error('Sin aldeanos (' + r.status + ')');
    const idx = await r.json();
    const base = new URL('.', new URL(urlIndice, location.href));
    const lista = await Promise.all(idx.aldeanos.map(async a => {
      try {
        const g = await cargador.loadAsync(new URL(a.archivo.replace(/^aldeanos\//, ''), base).href);
        const b = new THREE.Box3().setFromObject(g.scene), alto = b.max.y - b.min.y;
        g.scene.traverse(o => { if (o.isMesh) { o.frustumCulled = true; o.castShadow = false; o.receiveShadow = false; } });
        return { id: a.id, escena: g.scene, clips: g.animations, escala: alto > 0.5 ? ALTURA / alto : 1, base: -b.min.y };
      } catch (e) { console.warn('Aldeano ' + a.id, e); return null; }
    }));
    return lista.filter(Boolean);
  })());
  return modelos.get(urlIndice);
}

// Generador pseudoaleatorio con semilla (la colocación es siempre la misma en cada escenario)
function azar(semilla) {
  let a = semilla >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Publico {
  // { pista, obstaculos, crono (para la meta y los controles), scene, calidad: 'baja'|'media'|'alta', url (del índice) }
  constructor(op) {
    Object.assign(this, op);
    this.grupos = []; this.raiz = new THREE.Group(); this.raiz.name = 'Publico';
    this.scene.add(this.raiz);
  }

  // Los puntos clave del camino principal: [{ d, tipo, lados: [±1] }]
  puntos() {
    const P = this.pista, p = P.caminos[0];
    if (!p) return [];
    const out = [], dDe = g => { const pr = g && P.proyectar(p, g.x, g.z, 60); return pr ? pr.d : null; };
    const dMeta = dDe(this.crono.meta);
    if (dMeta != null) out.push({ d: dMeta, tipo: 'meta' });
    for (const g of this.crono.controles) { const d = dDe(g); if (d != null) out.push({ d, tipo: 'control' }); }
    // curvas cerradas: lo que gira la carretera en 40 m
    const giro = d => { const a = P.puntoEn(p, d - 20), b = P.puntoEn(p, d + 20); return Math.acos(Math.max(-1, Math.min(1, a.dx * b.dx + a.dz * b.dz))); };
    const curvas = [];
    for (let d = 25; d < p.total - 25; d += 5) {
      const g = giro(d);
      if (g > 1.0 && g >= giro(d - 5) && g >= giro(d + 5)) curvas.push({ d, g });
    }
    curvas.sort((a, b) => b.g - a.g);
    const lejosDe = (d, m) => out.every(o => { const x = Math.abs(o.d - d); return Math.min(x, p.cerrado ? p.total - x : x) > m; });
    for (const c of curvas) { if (out.filter(o => o.tipo === 'curva').length >= 3) break; if (lejosDe(c.d, 90)) out.push({ d: c.d, tipo: 'curva' }); }
    return out;
  }

  // ¿Se puede poner a alguien en (x, z)?
  libre(x, z) {
    const P = this.pista, mitad = P.esc.terreno.tam / 2 - 6;
    if (Math.abs(x) > mitad || Math.abs(z) > mitad) return null;
    const q = P.consultar(x, z);
    if (q.camino || q.agua > 0.02 || q.puente) return null;
    for (const c of P.caminos) { const pr = P.proyectar(c, x, z, c.c.ancho / 2 + 3); if (pr && pr.dist < c.c.ancho / 2 + 2.6) return null; }
    for (const r of P.rios) { const pr = P.proyectar(r, x, z, r.c.ancho + 2); if (pr && pr.dist < r.c.ancho * 0.75 + 1) return null; }
    if (this.obstaculos) for (const f of this.obstaculos.cerca(x, z, 1)) {
      const dx = x - f.x, dz = z - f.z;
      if (f.forma === 'c' ? Math.hypot(dx, dz) < f.r + 0.55 : (Math.abs(dx * f.c - dz * f.s) < f.hx + 0.55 && Math.abs(dx * f.s + dz * f.c) < f.hz + 0.55)) return null;
    }
    // ni en una cuesta muy empinada
    const E = P.E, esc = P.esc, h = E.alturaEn(esc, x, z);
    if (Math.abs(E.alturaEn(esc, x + 0.8, z) - h) > 0.55 || Math.abs(E.alturaEn(esc, x, z + 0.8) - h) > 0.55) return null;
    return q;
  }

  async construir() {
    let mods;
    try { mods = await cargarModelos(this.url); } catch (e) { console.warn(e); return 0; }
    if (!mods.length) return 0;
    // reflejos (la escena no tiene mapa de entorno: sin él, el cuero y la tela salen casi negros)
    if (this.entorno) for (const m of mods) if (!m.conEntorno) {
      m.conEntorno = true;
      m.escena.traverse(o => { if (o.isMesh) for (const mt of Array.isArray(o.material) ? o.material : [o.material]) if (mt && mt.isMeshStandardMaterial) { mt.envMap = this.entorno; mt.envMapIntensity = 0.9; mt.needsUpdate = true; } });
    }
    const P = this.pista, p = P.caminos[0], baja = this.calidad === 'baja';
    const cuantos = { meta: baja ? 4 : 8, control: baja ? 2 : 4, curva: baja ? 0 : 4 };
    const rnd = azar(Math.round((p ? p.total : 1) * 1000) ^ 0x5eed);
    let total = 0, turno = Math.floor(rnd() * mods.length);
    for (const pt of this.puntos()) {
      const n = cuantos[pt.tipo]; if (!n) continue;
      const c = P.puntoEn(p, pt.d), nx = c.dz, nz = -c.dx, ancho = p.c.ancho;
      // lados: la meta, los dos; un control, el que tenga sitio; una curva, el de dentro
      let lados = [1, -1];
      if (pt.tipo === 'curva') {
        const a = P.puntoEn(p, pt.d - 30), b = P.puntoEn(p, pt.d + 30), mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        lados = [Math.hypot(c.x + nx * 8 - mx, c.z + nz * 8 - mz) < Math.hypot(c.x - nx * 8 - mx, c.z - nz * 8 - mz) ? 1 : -1];
      } else if (pt.tipo === 'control') lados = rnd() < 0.5 ? [1, -1] : [-1, 1]; // el primero con sitio
      const grupo = { x: c.x, z: c.z, gente: [], obj: new THREE.Group(), celebrando: false };
      for (const lado of lados) {
        const porLado = pt.tipo === 'meta' ? Math.ceil(n / 2) : n;
        if (pt.tipo === 'control' && grupo.gente.length) break; // un control: un solo lado
        let puestos = 0;
        for (let k = 0; k < porLado * 3 && puestos < porLado; k++) {
          const fila = k % 2, s = (puestos - (porLado - 1) / 2) * 1.35 + (rnd() - 0.5) * 0.5 + (pt.tipo === 'meta' ? 7 : 0);
          const lat = ancho / 2 + 4 + fila * 1.25 + rnd() * 0.6 + Math.floor(k / porLado) * 1.8;
          const q = P.puntoEn(p, pt.d + s), x = q.x + q.dz * lado * lat, z = q.z - q.dx * lado * lat;
          const suelo = this.libre(x, z);
          if (!suelo) continue;
          const m = mods[turno++ % mods.length];
          const o = m.escena.clone(true);
          const esc = m.escala * (0.94 + rnd() * 0.1);
          o.scale.setScalar(esc);
          o.position.set(x, suelo.y + m.base * esc - 0.02, z);
          o.rotation.y = Math.atan2(q.x - x, q.z - z) + (rnd() - 0.5) * 0.6; // mirando a la carretera
          if (!baja) o.traverse(h => { if (h.isMesh) h.castShadow = this.calidad === 'alta'; });
          const mixer = new THREE.AnimationMixer(o), acc = {};
          for (const cl of m.clips) acc[cl.name] = mixer.clipAction(cl);
          const idle = acc.idle || Object.values(acc)[0];
          if (idle) { idle.play(); idle.time = rnd() * idle.getClip().duration; idle.timeScale = 0.85 + rnd() * 0.3; }
          grupo.obj.add(o);
          grupo.gente.push({ o, mixer, acc, actual: idle, prefiere: rnd() < 0.7 ? 'victory' : 'jump', retraso: rnd() * 0.5, espera: 0 });
          puestos++; total++;
        }
      }
      if (grupo.gente.length) { this.raiz.add(grupo.obj); this.grupos.push(grupo); }
    }
    return total;
  }

  // dt: s; camara: THREE.Camera; coches: [{ x, z }] (el tuyo y los de los demás)
  actualizar(dt, camara, coches) {
    const cx = camara.position.x, cz = camara.position.z;
    for (const g of this.grupos) {
      const dCam = Math.hypot(g.x - cx, g.z - cz);
      g.obj.visible = dCam < VISTA;
      if (!g.obj.visible) continue;
      let dCoche = Infinity;
      for (const c of coches) dCoche = Math.min(dCoche, Math.hypot(g.x - c.x, g.z - c.z));
      const celebrar = dCoche < CERCA, calmarse = dCoche > CERCA * 1.6;
      for (const pp of g.gente) {
        const quiere = celebrar ? (pp.acc[pp.prefiere] || pp.acc.victory) : calmarse ? pp.acc.idle : pp.actual;
        if (quiere && quiere !== pp.actual) {
          if ((pp.espera += dt) >= pp.retraso) { // no todos a la vez
            quiere.reset().play(); if (pp.actual) pp.actual.crossFadeTo(quiere, 0.35, false);
            pp.actual = quiere; pp.espera = 0;
          }
        } else pp.espera = 0;
        if (dCam < ANIMA) pp.mixer.update(dt);
      }
    }
  }

  get total() { return this.grupos.reduce((a, g) => a + g.gente.length, 0); }
  quitar() { this.scene.remove(this.raiz); for (const g of this.grupos) for (const pp of g.gente) pp.mixer.stopAllAction(); this.grupos = []; }
}
