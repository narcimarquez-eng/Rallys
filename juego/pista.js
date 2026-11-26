// La pista: qué hay bajo un punto del escenario (altura por la que rueda el coche, superficie y agua).
// Usa el núcleo de Mundos- (window.Escenario, o el require de Node en las pruebas) y reproduce lo que dibuja
// escena-3d.js: la cinta del camino sobre el terreno, las rampas y el tablero de los puentes, los riachuelos
// (con el vado donde un camino los cruza sin puente), los lagos, el mar y las calles de los pueblos.
//
// No depende de three.js: sirve igual en el navegador y en Node.

// Superficies: agarre (coeficiente de rozamiento de los neumáticos), rodadura (resistencia, × peso), bache
// (amplitud en m del firme irregular), polvo (color de lo que levantan las ruedas o null) y sonido.
export const SUPERFICIES = {
  asfalto: { nombre: 'Asfalto', agarre: 1.0, rodadura: 0.012, bache: 0.004, polvo: null, sonido: 'asfalto' },
  piedra: { nombre: 'Adoquín', agarre: 0.86, rodadura: 0.018, bache: 0.014, polvo: null, sonido: 'piedra' },
  grava: { nombre: 'Grava', agarre: 0.74, rodadura: 0.028, bache: 0.02, polvo: '#b9a586', sonido: 'grava' },
  tierra: { nombre: 'Tierra', agarre: 0.68, rodadura: 0.032, bache: 0.018, polvo: '#a68a62', sonido: 'tierra' },
  arena: { nombre: 'Arena', agarre: 0.56, rodadura: 0.09, bache: 0.012, polvo: '#d8c79a', sonido: 'arena' },
  barro: { nombre: 'Barro', agarre: 0.48, rodadura: 0.085, bache: 0.02, polvo: '#5b4632', sonido: 'barro' },
  hierba: { nombre: 'Hierba', agarre: 0.55, rodadura: 0.05, bache: 0.03, polvo: '#6f8a45', sonido: 'hierba' },
  roca: { nombre: 'Roca', agarre: 0.7, rodadura: 0.03, bache: 0.05, polvo: '#8a8580', sonido: 'piedra' },
  nieve: { nombre: 'Nieve', agarre: 0.5, rodadura: 0.04, bache: 0.01, polvo: '#f4f6fa', sonido: 'nieve' },
  hielo: { nombre: 'Hielo', agarre: 0.18, rodadura: 0.01, bache: 0.002, polvo: null, sonido: 'asfalto' },
  agua: { nombre: 'Agua (vado)', agarre: 0.45, rodadura: 0.05, bache: 0.01, polvo: '#d9eef5', sonido: 'agua' }
};
// Tipos de camino de Mundos- → superficie
const DE_CAMINO = { tierra: 'tierra', grava: 'grava', asfalto: 'asfalto', piedra: 'piedra', arena: 'arena', barro: 'barro', nieve: 'nieve' };
// Materiales del terreno (0 automático, 1 hierba … 13 baldosa) → superficie
const DE_MATERIAL = [null, 'hierba', 'hierba', 'tierra', 'roca', 'arena', 'nieve', 'asfalto', 'barro', 'grava', 'hierba', 'tierra', 'hielo', 'asfalto'];

const CELDA = 16; // m de la rejilla de búsqueda de tramos de camino

function smoothstep(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

export class Pista {
  constructor(E, esc) {
    this.E = E; this.esc = esc;
    this.mar = esc.terreno.agua && esc.terreno.agua.activa ? esc.terreno.agua.nivel : -Infinity;
    this.rango = E.rangoAlturas(esc);
    this.caminos = []; // pistas (no riachuelos)
    this.rios = [];
    for (const c of esc.caminos) {
      if (!c.puntos || c.puntos.length < 2) continue;
      if (E.esRio(c)) this.rios.push(this._prepararRio(c));
      else this.caminos.push(this._prepararCamino(c));
    }
    this.pueblos = esc.elementos.filter(e => e.tipo === 'pueblo' && e.props && e.props.cfg);
    this.lagos = esc.elementos.filter(e => e.tipo === 'lago').map(el => ({
      el, x: el.x, z: el.z, r: el.props.radio * 1.35, nivel: E.alturaEn(esc, el.x, el.z) + (el.props.nivel || 0) + 0.05
    }));
  }

  // --- Preparación ---
  _rejilla(mu) {
    const celdas = new Map();
    for (let k = 0; k + 1 < mu.length; k++) {
      const a = mu[k], b = mu[k + 1];
      const x0 = Math.floor(Math.min(a.x, b.x) / CELDA), x1 = Math.floor(Math.max(a.x, b.x) / CELDA);
      const z0 = Math.floor(Math.min(a.z, b.z) / CELDA), z1 = Math.floor(Math.max(a.z, b.z) / CELDA);
      for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
        const key = i + ',' + j;
        let l = celdas.get(key); if (!l) celdas.set(key, l = []);
        l.push(k);
      }
    }
    return celdas;
  }
  _prepararCamino(c) {
    const E = this.E, esc = this.esc;
    const mu = E.muestrearCamino(c, 1.5);
    const total = mu[mu.length - 1].d;
    // Puentes de este camino: centro (d), medio largo, base, altura del tablero en los extremos y en el centro,
    // ancho de la calzada. Igual que puentesDeCamino, pero con el perfil completo del tablero.
    const puentes = [];
    for (const el of esc.elementos) {
      if (el.tipo !== 'puente' || el.props.camino !== c.id) continue;
      const def = E.PUENTES[el.props.modelo] || E.PUENTES.romano;
      const pr = E.proyectarEnCamino(c, el.x, el.z, mu);
      if (!pr || pr.dist > c.ancho) continue;
      const L = (el.props.largo || def.vano) / 2;
      const base = E.alturaEn(esc, el.x, el.z) + (el.y || 0);
      puentes.push({ el, d: pr.d, d0: pr.d - L, d1: pr.d + L, base, extremo: def.extremo, centro: def.centro,
        alto: base + def.extremo, rampa: Math.max(4, def.extremo * 3), mitadAncho: (el.props.ancho || def.calzada) / 2 });
    }
    return { c, mu, total, celdas: this._rejilla(mu), puentes, cerrado: !!c.cerrado, ultimo: 0 };
  }
  _prepararRio(c) {
    const E = this.E;
    const mu = E.muestrearCamino(c, 1.5);
    const niveles = E.nivelesRio(this.esc, c, mu);
    return { c, mu, niveles, celdas: this._rejilla(mu), total: mu[mu.length - 1].d };
  }

  // Proyección de (x, z) sobre un camino preparado, buscando solo en los tramos cercanos.
  // → { d, dist, lado (+1 izquierda, −1 derecha según el sentido), k (tramo), t, dx, dz (dirección) } o null
  proyectar(p, x, z, radio) {
    radio = radio || 12;
    const i0 = Math.floor((x - radio) / CELDA), i1 = Math.floor((x + radio) / CELDA);
    const j0 = Math.floor((z - radio) / CELDA), j1 = Math.floor((z + radio) / CELDA);
    let best = null;
    const vistos = new Set();
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = p.celdas.get(i + ',' + j); if (!l) continue;
      for (const k of l) {
        if (vistos.has(k)) continue; vistos.add(k);
        const a = p.mu[k], b = p.mu[k + 1];
        const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
        const px = a.x + dx * t, pz = a.z + dz * t, dist = Math.hypot(x - px, z - pz);
        if (!best || dist < best.dist) {
          const ll = Math.sqrt(l2);
          best = { d: a.d + (b.d - a.d) * t, dist, lado: (dx * (z - a.z) - dz * (x - a.x)) > 0 ? 1 : -1, k, t, x: px, z: pz, dx: dx / ll, dz: dz / ll };
        }
      }
    }
    return best;
  }

  // Altura de la calzada a d metros: la cinta va 0,14 m sobre el terreno (o sobre el mar), sube en rampa a los
  // puentes y sobre el tablero sigue su perfil (más alto en el centro en los puentes de lomo).
  _puenteEn(p, d) {
    for (const b of p.puentes) if (d >= b.d0 && d <= b.d1) return b;
    return null;
  }
  _alturaPuente(b, d) {
    const t = (d - b.d0) / (b.d1 - b.d0), u = 2 * t - 1;
    return b.base + b.extremo + (b.centro - b.extremo) * (1 - u * u);
  }
  _rampa(p, d) {
    let r = null;
    for (const b of p.puentes) {
      const fuera = d < b.d0 ? b.d0 - d : d > b.d1 ? d - b.d1 : 0;
      if (fuera > b.rampa || fuera === 0) continue;
      const f = smoothstep(1 - fuera / b.rampa);
      if (!r || f > r.f) r = { alto: b.alto, f };
    }
    return r;
  }

  enPueblo(x, z, margen) {
    for (const pu of this.pueblos) if (this.E.dentroTerrenoPueblo(pu, x, z, margen || 0)) return pu;
    return null;
  }

  // Todo lo que hay bajo (x, z). Devuelve { y, tipo, agua (hondura del agua sobre el suelo), camino, puente,
  // pueblo }. «camino» es { p (camino preparado), d, dist, lado, dx, dz } si el punto está en la calzada o cerca.
  consultar(x, z) {
    const E = this.E, esc = this.esc;
    const suelo = E.alturaEn(esc, x, z);
    let y = suelo, tipo = null, agua = 0, camino = null, puente = null;
    // Caminos: el más cercano dentro de su ancho (con 0,6 m de arcén)
    for (const p of this.caminos) {
      const pr = this.proyectar(p, x, z, p.c.ancho);
      if (!pr) continue;
      const b = this._puenteEn(p, pr.d);
      const lim = b ? Math.max(p.c.ancho / 2, b.mitadAncho) + 0.6 : p.c.ancho / 2 + 0.6;
      if (pr.dist > lim) continue;
      if (camino && pr.dist >= camino.dist) continue;
      camino = Object.assign(pr, { p });
      puente = b;
    }
    const pueblo = this.enPueblo(x, z, 0);
    if (camino) {
      const c = camino.p.c;
      tipo = DE_CAMINO[E.superficieEn(c, camino.d)] || 'tierra';
      if (puente) {
        y = this._alturaPuente(puente, camino.d) + 0.05;
        tipo = puente.el.props.modelo === 'madera' ? 'tierra' : (puente.el.props.modelo === 'riotinto' || puente.el.props.modelo === 'muelle') ? 'asfalto' : 'piedra';
      } else {
        const borde = Math.min(1, camino.dist / (c.ancho / 2));
        y = Math.max(suelo, this.mar) + (borde > 0.98 ? 0.06 : 0.14);
        const r = this._rampa(camino.p, camino.d);
        if (r) y = Math.max(y, y + (r.alto + 0.05 - y) * r.f);
      }
      if (pueblo && !puente) { tipo = 'piedra'; y = suelo + 0.03; } // dentro del pueblo se corre por sus calles
    } else if (pueblo) {
      tipo = 'piedra'; y = suelo + 0.03;
    }
    if (!tipo) tipo = this.materialTerreno(x, z);
    // Agua: riachuelos (también el vado), lagos y mar. Sobre un puente no hay agua.
    if (!puente) {
      for (const r of this.rios) {
        const pr = this.proyectar(r, x, z, r.c.ancho * 1.2);
        if (!pr || pr.dist > r.c.ancho * 0.75) continue;
        const k = Math.min(pr.k, r.niveles.length - 2);
        const nivel = r.niveles[k] + (r.niveles[k + 1] - r.niveles[k]) * pr.t;
        if (nivel > y) agua = Math.max(agua, nivel - y);
      }
      for (const l of this.lagos) {
        if (Math.hypot(x - l.x, z - l.z) > l.r) continue;
        if (l.nivel > y) agua = Math.max(agua, l.nivel - y);
      }
      if (this.mar > y) agua = Math.max(agua, this.mar - y);
      if (agua > 0.04) tipo = 'agua';
    }
    return { y, suelo, tipo, agua, camino, puente, pueblo };
  }

  // Superficie del terreno fuera de los caminos (material pintado o el automático por altura, pendiente y bioma)
  materialTerreno(x, z) {
    const E = this.E, esc = this.esc;
    if (!E.dentro(esc, x, z)) return 'hierba';
    const g = E.aRejilla(esc, x, z), r = esc.terreno.res;
    const i = Math.max(0, Math.min(r - 1, Math.round(g.gi))), j = Math.max(0, Math.min(r - 1, Math.round(g.gj)));
    const m = E.materialEn(esc, i, j, this.rango);
    return DE_MATERIAL[m] || 'hierba';
  }

  // Punto de un camino preparado a d metros: { x, z, dx, dz, y }
  puntoEn(p, d) {
    const mu = p.mu, n = mu.length;
    if (p.cerrado) d = ((d % p.total) + p.total) % p.total; else d = Math.max(0, Math.min(p.total, d));
    let a = 0, b = n - 1;
    while (b - a > 1) { const m = (a + b) >> 1; if (mu[m].d < d) a = m; else b = m; }
    const t = (d - mu[a].d) / Math.max(1e-6, mu[b].d - mu[a].d);
    const x = mu[a].x + (mu[b].x - mu[a].x) * t, z = mu[a].z + (mu[b].z - mu[a].z) * t;
    const l = Math.hypot(mu[b].x - mu[a].x, mu[b].z - mu[a].z) || 1;
    return { x, z, dx: (mu[b].x - mu[a].x) / l, dz: (mu[b].z - mu[a].z) / l, d };
  }

  // Camino (preparado) más cercano a un punto, sin límite de distancia (para volver a la pista)
  masCercano(x, z) {
    let best = null;
    for (const p of this.caminos) {
      let pr = this.proyectar(p, x, z, 40);
      if (!pr) pr = this._proyectarTodo(p, x, z);
      if (pr && (!best || pr.dist < best.pr.dist)) best = { p, pr };
    }
    return best;
  }
  _proyectarTodo(p, x, z) {
    let best = null;
    for (let k = 0; k + 1 < p.mu.length; k++) {
      const a = p.mu[k], b = p.mu[k + 1];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const px = a.x + dx * t, pz = a.z + dz * t, dist = Math.hypot(x - px, z - pz);
      if (!best || dist < best.dist) { const ll = Math.sqrt(l2); best = { d: a.d + (b.d - a.d) * t, dist, lado: (dx * (z - a.z) - dz * (x - a.x)) > 0 ? 1 : -1, k, t, x: px, z: pz, dx: dx / ll, dz: dz / ll }; }
    }
    return best;
  }
}

// Irregularidad del firme: ruido de valor suave (−1…1) a escala de ~0,8 m, para que la suspensión trabaje en grava.
function hash2(i, j) { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
export function bache(x, z) {
  const s = 1.25, fx = x * s, fz = z * s, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return ((a + (b - a) * su) * (1 - sv) + (c + (d - c) * su) * sv) * 2 - 1;
}
