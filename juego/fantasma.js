// Fantasmas: la vuelta grabada de un coche (la tuya o la de otro piloto) y su repetición como coche semitransparente.
//
// Grabación: 20 muestras por segundo con la posición (x, y, z), el rumbo, el cabeceo, el balanceo y el giro de la
// dirección. Se guarda en enteros pequeños (diferencias en centímetros y diezmilésimas de radián) y, si el navegador
// sabe, comprimido con gzip: una vuelta de 3 minutos ocupa unos 20–40 KB en texto.
//
// Formato del texto (versión 1): «R1:» + (gz: | raw:) + base64 de
//   cabecera JSON (una línea) + '\n' + Int16Array con n × 7 valores (diferencias con la muestra anterior)
// (sin importar three.js: así también se puede probar en Node; Fantasma recibe THREE)

export const HZ = 20;
const ESC_POS = 100;     // cm
const ESC_ANG = 10000;   // diezmilésimas de radián
const N = 7;             // x, y, z, rumbo, cabeceo, balanceo, giro

export class Grabadora {
  constructor() { this.reiniciar(); }
  reiniciar() { this.muestras = []; this.siguiente = 0; }
  // t: segundos desde que empezó la vuelta; coche: el de la física
  paso(t, coche) {
    if (t + 1e-6 < this.siguiente) return;
    this.siguiente = (Math.floor(t * HZ + 1e-6) + 1) / HZ;
    this.muestras.push([coche.x, coche.y, coche.z, coche.rumbo, coche.cab || 0, coche.bal || 0, coche.giro || 0]);
  }
  // La vuelta terminada (en ese momento): { hz, duracion, muestras }
  cerrar(duracion) { const v = { hz: HZ, duracion, muestras: this.muestras }; this.reiniciar(); return v; }
}

function aBase64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function deBase64(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
async function porStream(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }

// vuelta: { hz, duracion, muestras } + datos (piloto, coche…) → texto
export async function codificar(vuelta, datos) {
  const m = vuelta.muestras, n = m.length;
  const enteros = new Int16Array(n * N);
  const prev = [0, 0, 0, 0, 0, 0, 0];
  const base = n ? m[0] : [0, 0, 0, 0, 0, 0, 0];
  let rumboAnt = base[3];
  for (let k = 0; k < n; k++) {
    // el rumbo, sin saltos de ±2π, para que sus diferencias sean pequeñas
    let r = m[k][3]; while (r - rumboAnt > Math.PI) r -= 2 * Math.PI; while (r - rumboAnt < -Math.PI) r += 2 * Math.PI; rumboAnt = r;
    const q = [Math.round((m[k][0] - base[0]) * ESC_POS), Math.round((m[k][1] - base[1]) * ESC_POS), Math.round((m[k][2] - base[2]) * ESC_POS),
      Math.round((r - base[3]) * ESC_ANG), Math.round(m[k][4] * ESC_ANG), Math.round(m[k][5] * ESC_ANG), Math.round(m[k][6] * ESC_ANG)];
    for (let j = 0; j < N; j++) {
      const d = j < 4 ? q[j] - prev[j] : q[j]; // posición y rumbo: diferencia; el resto, tal cual
      enteros[k * N + j] = Math.max(-32767, Math.min(32767, d));
      if (j < 4) prev[j] += enteros[k * N + j]; // lo que de verdad queda guardado (por si se recortó)
    }
  }
  const cab = JSON.stringify(Object.assign({}, datos || {}, { v: 1, hz: vuelta.hz, n, duracion: +vuelta.duracion.toFixed(3), base: base.slice(0, 4).map(v => +v.toFixed(3)) }));
  const cabB = new TextEncoder().encode(cab + '\n');
  const todo = new Uint8Array(cabB.length + enteros.byteLength);
  todo.set(cabB); todo.set(new Uint8Array(enteros.buffer), cabB.length);
  if (typeof CompressionStream !== 'undefined') {
    try { return 'R1:gz:' + aBase64(await porStream(todo, new CompressionStream('gzip'))); } catch (e) { /* sin gzip */ }
  }
  return 'R1:raw:' + aBase64(todo);
}

// texto → { datos (cabecera), hz, duracion, muestras: Float32Array n × 7 }
export async function decodificar(texto) {
  const m = /^R1:(gz|raw):(.*)$/s.exec(texto || '');
  if (!m) throw new Error('Fantasma con formato desconocido');
  let bytes = deBase64(m[2]);
  if (m[1] === 'gz') bytes = await porStream(bytes, new DecompressionStream('gzip'));
  const fin = bytes.indexOf(10);
  const cab = JSON.parse(new TextDecoder().decode(bytes.subarray(0, fin)));
  const resto = bytes.slice(fin + 1);
  const enteros = new Int16Array(resto.buffer, 0, cab.n * N);
  const out = new Float32Array(cab.n * N), acc = [0, 0, 0, 0];
  for (let k = 0; k < cab.n; k++) {
    for (let j = 0; j < N; j++) {
      const v = enteros[k * N + j];
      if (j < 4) { acc[j] += v; out[k * N + j] = cab.base[j] + acc[j] / (j < 3 ? ESC_POS : ESC_ANG); }
      else out[k * N + j] = v / ESC_ANG;
    }
  }
  return { datos: cab, hz: cab.hz, duracion: cab.duracion, muestras: out };
}

// Estado interpolado en el instante t (s desde el inicio de la vuelta): [x, y, z, rumbo, cabeceo, balanceo, giro] o null
export function estadoEn(f, t) {
  const n = f.muestras.length / N;
  if (!n || t < 0 || t > f.duracion) return null;
  const p = Math.min(n - 1, t * f.hz), a = Math.floor(p), b = Math.min(n - 1, a + 1), u = p - a, M = f.muestras;
  const o = [];
  for (let j = 0; j < N; j++) o.push(M[a * N + j] + (M[b * N + j] - M[a * N + j]) * u);
  return o;
}

// El coche fantasma en la escena: un modelo (con su «coche» de medidas, sin física) teñido y semitransparente
export class Fantasma {
  // f: el fantasma decodificado; modelo: de cargarCoche; coche: un Coche de esas medidas (solo para colocarlo)
  constructor(THREE, scene, f, modelo, coche, colocarCoche) {
    this.f = f; this.modelo = modelo; this.coche = coche; this.colocar = colocarCoche;
    this.reposo = coche.ruedas.map(w => w.y - coche.y);
    this.vueltas = 0; this.prev = null;
    modelo.objeto.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const nuevos = mats.map(m => {
        const n = m.clone();
        n.transparent = true; n.opacity = 0.42; n.depthWrite = false;
        if (n.color) n.color.lerp(new THREE.Color('#9fd4ff'), 0.45);
        if ('emissive' in n && n.emissive) { n.emissive.set('#2a6fb0'); n.emissiveIntensity = 0.35; }
        return n;
      });
      o.material = Array.isArray(o.material) ? nuevos : nuevos[0];
      o.renderOrder = 2;
    });
    modelo.objeto.visible = false;
    scene.add(modelo.objeto);
  }
  // t: tiempo de vuelta del jugador
  actualizar(t) {
    const e = estadoEn(this.f, t);
    this.modelo.objeto.visible = !!e;
    if (!e) { this.prev = null; return; }
    const c = this.coche;
    [c.x, c.y, c.z, c.rumbo, c.cab, c.bal, c.giro] = e;
    if (this.prev) this.vueltas += Math.hypot(e[0] - this.prev[0], e[2] - this.prev[2]) / Math.max(0.2, c.m.radio);
    this.prev = e;
    c.ruedas.forEach((w, k) => { w.y = c.y + this.reposo[k]; w.vueltas = this.vueltas; });
    this.colocar(this.modelo, c);
  }
  quitar(scene) { scene.remove(this.modelo.objeto); }
}
