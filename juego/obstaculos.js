// Colisiones sencillas del coche con el escenario.
//  · Formas fijas en el suelo (círculos y cajas giradas), en una rejilla para buscarlas rápido:
//    árboles (troncos), rocas, casas y piezas del pueblo, la iglesia y demás modelos .glb, cajas, muros, cilindros,
//    postes de la meta y de los controles.
//  · Barreras de los caminos (guardarraíl, muro, neumáticos, vallas, paja…): una línea a lo largo del camino, a su
//    distancia del borde; la cinta y los conos solo frenan un poco.
//  · Pretiles de los puentes: no se puede salir por el lado del tablero.
// Las formas de árboles, rocas y casas se leen de lo que ha dibujado escena-3d.js (así coinciden con lo que se ve).
const CELDA = 20;

// Cómo responde cada barrera: rebote (0–1), roce (0–1) y si para el coche o solo lo frena
const BARRERAS = {
  guardarrail: { rebote: 0.15, roce: 0.12, dura: true, sonido: 'metal' },
  muro: { rebote: 0.12, roce: 0.18, dura: true, sonido: 'golpe' },
  neumaticos: { rebote: 0.45, roce: 0.25, dura: true, sonido: 'goma' },
  valla_madera: { rebote: 0.2, roce: 0.2, dura: true, sonido: 'madera' },
  balas_paja: { rebote: 0.05, roce: 0.35, dura: true, sonido: 'paja' },
  valla_publi: { rebote: 0.15, roce: 0.2, dura: true, sonido: 'madera' },
  cinta: { dura: false, freno: 0.6, sonido: 'cinta' },
  conos: { dura: false, freno: 1.2, sonido: 'cono' }
};

export class Obstaculos {
  constructor(E, esc, pista) {
    this.E = E; this.esc = esc; this.pista = pista;
    this.fijos = [];       // formas del escenario
    this.pueblos = [];     // formas de los pueblos (cambian al construirse el pueblo completo)
    this.rejilla = new Map();
    this.tocandoBlanda = new Map();
  }

  // --- Formas ---
  static circulo(x, z, r, extra) { return Object.assign({ forma: 'c', x, z, r, rebote: 0.2, roce: 0.15, sonido: 'golpe' }, extra); }
  // caja de medio ancho hx (x local) y medio fondo hz (z local), girada «ang» rad como un elemento con rotY
  static caja(x, z, hx, hz, ang, extra) { return Object.assign({ forma: 'b', x, z, hx, hz, c: Math.cos(ang), s: Math.sin(ang), r: Math.hypot(hx, hz), rebote: 0.12, roce: 0.2, sonido: 'golpe' }, extra); }

  _indexar() {
    this.rejilla.clear();
    for (const f of this.fijos.concat(this.pueblos)) {
      const i0 = Math.floor((f.x - f.r) / CELDA), i1 = Math.floor((f.x + f.r) / CELDA);
      const j0 = Math.floor((f.z - f.r) / CELDA), j1 = Math.floor((f.z + f.r) / CELDA);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = i + ',' + j; let l = this.rejilla.get(k); if (!l) this.rejilla.set(k, l = []); l.push(f);
      }
    }
  }
  get total() { return this.fijos.length + this.pueblos.length; }

  // Lee del escenario y de lo dibujado (escena: Escena3D de Mundos-). THREE: el módulo three.js.
  construir(escena, THREE) {
    const E = this.E, esc = this.esc, out = [];
    const m4 = new THREE.Matrix4(), p3 = new THREE.Vector3(), q4 = new THREE.Quaternion(), s3 = new THREE.Vector3();
    const caja3 = new THREE.Box3();
    const DEG = Math.PI / 180;
    for (const el of esc.elementos) {
      const g = escena && escena.objetos.get(el.id);
      const p = el.props || {};
      const ang = (el.rotY || 0) * DEG, esca = el.escala || 1;
      switch (el.tipo) {
        case 'bosque': case 'rocas': case 'roca': case 'arbol': {
          // árboles con modelo (registrados en la vegetación) …
          const regs = escena && escena.vegetacion && escena.vegetacion.registros && escena.vegetacion.registros.get(el.id);
          if (regs) for (const a of regs) out.push(Obstaculos.circulo(a.x, a.z, 0.3 + (a.alto || 12) * 0.014, { sonido: 'madera', rebote: 0.1, roce: 0.3 }));
          // … y árboles sencillos y rocas (instancias o mallas sueltas)
          if (!g) break;
          g.updateMatrixWorld(true);
          g.traverse(o => {
            if (!o.isMesh || !o.geometry || (o.material && o.material.visible === false)) return;
            if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
            const bb = o.geometry.boundingBox, alto = bb.max.y - bb.min.y, ancho = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
            const arbol = alto > ancho * 1.6 && alto > 3;
            const n = o.isInstancedMesh ? o.count : 1;
            for (let k = 0; k < n; k++) {
              if (o.isInstancedMesh) { o.getMatrixAt(k, m4); m4.premultiply(o.matrixWorld); } else m4.copy(o.matrixWorld);
              m4.decompose(p3, q4, s3);
              const s = Math.max(s3.x, s3.z);
              const r = arbol ? Math.max(0.25, ancho * s * 0.06) : ancho * s * 0.42;
              if (!arbol && (r < 0.45 || (bb.max.y * s3.y) < 0.5)) continue; // piedras pequeñas: se pasan por encima
              out.push(Obstaculos.circulo(p3.x, p3.z, r, arbol ? { sonido: 'madera', rebote: 0.1, roce: 0.3 } : { sonido: 'piedra', rebote: 0.18, roce: 0.2 }));
            }
          });
          break;
        }
        case 'glb': case 'enemigo': {
          // la caja del modelo en sus ejes (cuando ya ha cargado); mientras, el solar reservado (huella) reducido
          let hecho = false;
          if (g && g.children.length) {
            const pos = g.position.clone(), rot = g.rotation.y;
            g.position.set(0, 0, 0); g.rotation.y = 0; g.updateMatrixWorld(true);
            caja3.makeEmpty();
            g.traverse(o => { if (o.isMesh && !o.isSprite && o.geometry && o.visible !== false && !(o.material && o.material.wireframe)) { o.geometry.computeBoundingBox(); caja3.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
            g.position.copy(pos); g.rotation.y = rot; g.updateMatrixWorld(true);
            if (!caja3.isEmpty() && caja3.max.y - caja3.min.y > 0.8) {
              const cx = (caja3.min.x + caja3.max.x) / 2, cz = (caja3.min.z + caja3.max.z) / 2;
              const c = Math.cos(ang), s = Math.sin(ang);
              out.push(Obstaculos.caja(el.x + cx * c + cz * s, el.z - cx * s + cz * c, (caja3.max.x - caja3.min.x) / 2 * 0.92, (caja3.max.z - caja3.min.z) / 2 * 0.92, ang, { sonido: 'piedra' }));
              hecho = true;
            }
          }
          if (!hecho && Array.isArray(p.huella)) out.push(Obstaculos.caja(el.x, el.z, p.huella[0] * esca * 0.3, p.huella[1] * esca * 0.3, ang, { sonido: 'piedra' }));
          break;
        }
        case 'caja': out.push(Obstaculos.caja(el.x, el.z, p.ancho / 2 * esca, p.fondo / 2 * esca, ang)); break;
        case 'muro': out.push(Obstaculos.caja(el.x, el.z, p.largo / 2 * esca, p.grosor / 2 * esca, ang)); break;
        case 'plataforma': if ((el.y || 0) < 1.2) out.push(Obstaculos.caja(el.x, el.z, p.ancho / 2 * esca, p.fondo / 2 * esca, ang)); break;
        case 'cilindro': out.push(Obstaculos.circulo(el.x, el.z, p.radio * esca)); break;
        case 'esfera': if ((el.y || 0) < p.radio) out.push(Obstaculos.circulo(el.x, el.z, p.radio * esca * 0.9)); break;
        case 'meta': case 'checkpoint': {
          const c = Math.cos(ang), s = Math.sin(ang), a = (p.ancho || 14) / 2;
          for (const sg of [-1, 1]) out.push(Obstaculos.circulo(el.x + sg * a * c, el.z - sg * a * s, 0.35, { sonido: 'metal', rebote: 0.2 }));
          break;
        }
        default: break;
      }
    }
    this.fijos = out;
    this._indexar();
    return out.length;
  }

  // Casas, fuentes, farolas… del pueblo completo (su generador deja «colliders» en coordenadas del pueblo)
  actualizarPueblos(escena) {
    const out = [];
    const vivos = escena && escena.pueblosVivos;
    if (vivos) for (const [id, vivo] of vivos) {
      const el = this.E.buscarElemento(this.esc, id);
      const cols = vivo && vivo.pueblo && vivo.pueblo.colliders;
      if (!el || !cols) continue;
      const r = ((el.props.cfg && el.props.cfg.rotation) || 0) * Math.PI / 180, cr = Math.cos(r), sr = Math.sin(r);
      const aMundo = (lx, lz) => ({ x: el.x + lx * cr - lz * sr, z: el.z + lx * sr + lz * cr });
      for (const c of cols) {
        if (c.type === 'circle') {
          const q = aMundo(c.x, c.z);
          out.push(Obstaculos.circulo(q.x, q.z, c.r, { sonido: c.r < 1 ? 'metal' : 'piedra', rebote: 0.15 }));
        } else if (c.type === 'box') {
          const q = aMundo((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2);
          // el grupo del pueblo está girado −r: en ejes del mundo la caja va girada −r (como un elemento con rotY = −r)
          out.push(Obstaculos.caja(q.x, q.z, (c.maxX - c.minX) / 2, (c.maxZ - c.minZ) / 2, -r, { sonido: 'piedra' }));
        }
      }
    }
    const firma = out.length;
    if (firma !== this._firmaPueblos) { this._firmaPueblos = firma; this.pueblos = out; this._indexar(); }
    return out.length;
  }

  // Formas cerca de (x, z)
  cerca(x, z, r) {
    const res = new Set();
    const i0 = Math.floor((x - r) / CELDA), i1 = Math.floor((x + r) / CELDA), j0 = Math.floor((z - r) / CELDA), j1 = Math.floor((z + r) / CELDA);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const l = this.rejilla.get(i + ',' + j); if (l) for (const f of l) res.add(f); }
    return res;
  }

  // Resuelve los choques del coche (después de moverlo). Anota en coche.impactos { v, sonido, x, z }.
  resolver(coche, dt) {
    const cs = Math.cos(coche.rumbo), sn = Math.sin(coche.rumbo);
    let blandaEsteP = false; // la cinta y los conos frenan una vez por paso, no por cada círculo
    for (const ci of coche.circulos) {
      const px = coche.x + ci.lz * sn, pz = coche.z + ci.lz * cs, r = ci.r;
      // 1) formas fijas
      for (const f of this.cerca(px, pz, r + 2)) {
        let nx, nz, pen;
        if (f.forma === 'c') {
          const dx = px - f.x, dz = pz - f.z, d = Math.hypot(dx, dz);
          pen = r + f.r - d; if (pen <= 0) continue;
          nx = d > 1e-6 ? dx / d : 1; nz = d > 1e-6 ? dz / d : 0;
        } else {
          // a ejes de la caja (rotY: x' = x·c − z·s … inversa)
          const dx = px - f.x, dz = pz - f.z;
          const lx = dx * f.c - dz * f.s, lz = dx * f.s + dz * f.c;
          const qx = Math.max(-f.hx, Math.min(f.hx, lx)), qz = Math.max(-f.hz, Math.min(f.hz, lz));
          let ex = lx - qx, ez = lz - qz, d = Math.hypot(ex, ez);
          if (d > 1e-6) { pen = r - d; if (pen <= 0) continue; ex /= d; ez /= d; }
          else { // el centro dentro de la caja: sale por el lado más cercano
            const px1 = f.hx - Math.abs(lx), pz1 = f.hz - Math.abs(lz);
            if (px1 < pz1) { ex = Math.sign(lx) || 1; ez = 0; pen = r + px1; } else { ex = 0; ez = Math.sign(lz) || 1; pen = r + pz1; }
          }
          nx = ex * f.c + ez * f.s; nz = -ex * f.s + ez * f.c;
        }
        const v = coche.choque(px - nx * r, pz - nz * r, nx, nz, pen, f.rebote, f.roce);
        if (v > 0.5) coche.impactos.push({ v, sonido: f.sonido, x: px - nx * r, z: pz - nz * r });
      }
      // 2) barreras de los caminos y pretiles de los puentes
      for (const p of this.pista.caminos) {
        const pr = this.pista.proyectar(p, px, pz, p.c.ancho / 2 + 8);
        if (!pr) continue;
        const ux = (pr.x - px) / (pr.dist || 1), uz = (pr.z - pz) / (pr.dist || 1); // hacia el eje del camino
        for (const b of p.c.barreras || []) {
          const def = BARRERAS[b.tipo] || BARRERAS.muro;
          if (!this.E.enTramo(b, pr.d, p.c.cerrado)) continue;
          if (b.lado === 'izq' && pr.lado !== 1) continue;
          if (b.lado === 'der' && pr.lado !== -1) continue;
          const linea = p.c.ancho / 2 + (b.separacion || 0);
          if (!def.dura) {
            if (Math.abs(pr.dist - linea) < r && !blandaEsteP) { blandaEsteP = true; const k = Math.exp(-dt * def.freno); coche.vx *= k; coche.vz *= k; this._blanda(b, coche); }
            continue;
          }
          if (pr.dist < linea) { // por dentro: empuja hacia el camino
            const pen = pr.dist + r - linea; if (pen <= 0) continue;
            const v = coche.choque(px - ux * r, pz - uz * r, ux, uz, pen, def.rebote, def.roce);
            if (v > 0.5) coche.impactos.push({ v, sonido: def.sonido, x: px - ux * r, z: pz - uz * r });
          } else { // por fuera (ha rodeado el final): empuja hacia fuera
            const pen = linea + r - pr.dist; if (pen <= 0 || pr.dist > linea + r + 0.5) continue;
            const v = coche.choque(px + ux * r, pz + uz * r, -ux, -uz, pen, def.rebote, def.roce);
            if (v > 0.5) coche.impactos.push({ v, sonido: def.sonido, x: px + ux * r, z: pz + uz * r });
          }
        }
        for (const bp of p.puentes) {
          if (pr.d < bp.d0 + 0.5 || pr.d > bp.d1 - 0.5) continue;
          const linea = bp.mitadAncho - 0.15;
          const pen = pr.dist + r - linea;
          if (pen <= 0 || pr.dist > linea + 1.5) continue;
          const v = coche.choque(px - ux * r, pz - uz * r, ux, uz, pen, 0.12, 0.25);
          if (v > 0.5) coche.impactos.push({ v, sonido: 'piedra', x: px - ux * r, z: pz - uz * r });
        }
      }
    }
  }
  _blanda(b, coche) {
    const ahora = coche.reloj || 0, ant = this.tocandoBlanda.get(b) || -9;
    if (ahora - ant > 0.6) coche.impactos.push({ v: 1, sonido: (BARRERAS[b.tipo] || {}).sonido || 'cinta', x: coche.x, z: coche.z, blanda: true });
    this.tocandoBlanda.set(b, ahora);
  }
}
