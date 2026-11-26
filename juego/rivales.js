// Los coches de los demás jugadores de la sala: su modelo, movido con lo que mandan (posición, rumbo, cabeceo,
// balanceo, dirección) unas 15 veces por segundo, interpolado para que vaya suave, y su nombre encima.
//
// Estado que manda cada jugador (Float32Array, ESTADO.n valores):
export const ESTADO = { t: 0, x: 1, y: 2, z: 3, rumbo: 4, cab: 5, bal: 6, giro: 7, vel: 8, prog: 9, vuelta: 10, fase: 11, n: 12 };
export const FASE = { espera: 0, cuenta: 1, carrera: 2, fin: 3 };
const RETRASO = 0.12; // s: se dibuja un poco en el pasado para tener siempre dos muestras entre las que interpolar
const ANG = new Set([ESTADO.rumbo]);

export const COLORES = ['#ff4030', '#2f8fff', '#30c060', '#ffb020', '#c050ff', '#00c8c8', '#ff70b0', '#f0f0f0'];

function etiqueta(THREE, texto, color) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 112;
  const g = cv.getContext('2d');
  g.font = 'bold 60px system-ui, sans-serif';
  const w = Math.min(500, g.measureText(texto).width + 56);
  g.fillStyle = 'rgba(10,14,18,0.72)';
  g.beginPath(); g.roundRect((512 - w) / 2, 10, w, 92, 30); g.fill();
  g.fillStyle = color; g.beginPath(); g.arc((512 - w) / 2 + 30, 56, 11, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(texto, 256 + 12, 58, 440);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(3.6, 0.79, 1); s.renderOrder = 5;
  return s;
}

export class Rival {
  // modelo: de cargarCoche; coche: un Coche de esas medidas (sin física, solo para colocarlo)
  constructor(THREE, scene, { id, nombre, color, modelo, coche, colocar }) {
    Object.assign(this, { id, nombre, color, modelo, coche, colocar, scene });
    this.reposo = coche.ruedas.map(w => w.y - coche.y);
    this.muestras = []; this.desfase = null; this.ultimo = null; this.tRecibido = -1e9; this.vueltas = 0; this.prev = null;
    this.etiqueta = etiqueta(THREE, nombre, color);
    scene.add(this.etiqueta);
    modelo.objeto.visible = false;
    scene.add(modelo.objeto);
  }
  // Un estado recibido (ahora: segundos del reloj local)
  recibir(v, ahora) {
    const t = v[ESTADO.t];
    const ult = this.muestras[this.muestras.length - 1];
    if (ult && t < ult[ESTADO.t] - 1) { this.muestras.length = 0; this.desfase = null; } // carrera nueva
    if (ult && t <= ult[ESTADO.t]) return; // repetido o desordenado
    this.muestras.push(Float32Array.from(v));
    if (this.muestras.length > 40) this.muestras.splice(0, this.muestras.length - 40);
    // reloj del otro − el mío: el máximo visto (el de menos retraso de red), que olvida despacio por si cambia
    const d = t - ahora;
    this.desfase = this.desfase == null ? d : Math.max(d, this.desfase - 0.002);
    this.ultimo = this.muestras[this.muestras.length - 1]; this.tRecibido = ahora;
  }
  get fase() { return this.ultimo ? this.ultimo[ESTADO.fase] : -1; }
  get prog() { return this.ultimo ? this.ultimo[ESTADO.prog] : -Infinity; }
  // El estado interpolado en «ahora» (o null)
  estadoEn(ahora) {
    const M = this.muestras;
    if (!M.length || ahora - this.tRecibido > 4) return null;
    const tr = ahora + this.desfase - RETRASO;
    let k = M.length - 1;
    while (k > 0 && M[k - 1][ESTADO.t] > tr) k--;
    const b = M[k], a = M[k - 1];
    if (!a || tr >= b[ESTADO.t]) { // sin muestra posterior: se sigue un poco con la velocidad que llevaba
      if (!a) return Array.from(b);
      const ex = Math.min(0.3, tr - b[ESTADO.t]), dt = Math.max(1e-3, b[ESTADO.t] - a[ESTADO.t]);
      return Array.from(b, (v, j) => j >= ESTADO.x && j <= ESTADO.z ? v + (v - a[j]) / dt * ex : v);
    }
    const u = Math.max(0, Math.min(1, (tr - a[ESTADO.t]) / Math.max(1e-4, b[ESTADO.t] - a[ESTADO.t])));
    return Array.from(b, (v, j) => {
      let d = v - a[j];
      if (ANG.has(j)) { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; }
      return a[j] + d * u;
    });
  }
  actualizar(ahora) {
    const e = this.estadoEn(ahora);
    const o = this.modelo.objeto;
    o.visible = !!e; this.etiqueta.visible = !!e;
    if (!e) { this.prev = null; return; }
    const c = this.coche;
    c.x = e[ESTADO.x]; c.y = e[ESTADO.y]; c.z = e[ESTADO.z]; c.rumbo = e[ESTADO.rumbo]; c.cab = e[ESTADO.cab]; c.bal = e[ESTADO.bal]; c.giro = e[ESTADO.giro];
    if (this.prev) this.vueltas += Math.hypot(c.x - this.prev[0], c.z - this.prev[1]) / Math.max(0.2, c.m.radio);
    this.prev = [c.x, c.z];
    c.ruedas.forEach((w, k) => { w.y = c.y + this.reposo[k]; w.vueltas = this.vueltas; });
    this.colocar(this.modelo, c);
    this.etiqueta.position.set(c.x, c.y + 2.3, c.z);
  }
  quitar() { this.scene.remove(this.modelo.objeto); this.scene.remove(this.etiqueta); this.etiqueta.material.map.dispose(); this.etiqueta.material.dispose(); }
}

// Puesto en carrera: los que han llegado, por tiempo; luego los que corren, por lo que llevan recorrido
// pilotos: [{ id, total (s, si ha llegado), prog }]
export function ordenar(pilotos) {
  return pilotos.slice().sort((a, b) => {
    const fa = a.total != null, fb = b.total != null;
    if (fa && fb) return a.total - b.total;
    if (fa !== fb) return fa ? -1 : 1;
    return (b.prog ?? -Infinity) - (a.prog ?? -Infinity);
  });
}
