// Cronómetro de rally: salida desde «inicio», puntos de control en orden (props.orden), meta y vueltas.
// Las puertas (meta y controles) son segmentos en el suelo: el elemento en (x, z), girado rotY, con su ancho
// (props.ancho) a lo largo de su x local. Se cuenta una puerta cuando el coche la cruza entre dos pasos de física.
// La primera vuelta empieza con el «¡Ya!»; una vuelta se cierra al cruzar la meta con todos los controles pasados.
// Si el camino no es un circuito (no está cerrado) es un tramo: una sola pasada hasta la meta.
const DEG = Math.PI / 180;

function puerta(el, margen) {
  const a = (el.rotY || 0) * DEG, c = Math.cos(a), s = Math.sin(a), m = (el.props.ancho || 14) / 2 + (margen || 3);
  return { el, x: el.x, z: el.z, ax: el.x - m * c, az: el.z + m * s, bx: el.x + m * c, bz: el.z - m * s, fx: Math.sin(a), fz: Math.cos(a) };
}
// ¿Corta el movimiento p→q el segmento de la puerta?
function cruza(g, px, pz, qx, qz) {
  const d1x = qx - px, d1z = qz - pz, d2x = g.bx - g.ax, d2z = g.bz - g.az;
  const den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) < 1e-9) return false;
  const s1 = ((g.ax - px) * d2z - (g.az - pz) * d2x) / den, s2 = ((g.ax - px) * d1z - (g.az - pz) * d1x) / den;
  return s1 >= 0 && s1 <= 1 && s2 >= 0 && s2 <= 1;
}

export function fmt(t, signo) {
  if (t == null || !isFinite(t)) return '–:––.–––';
  const neg = t < 0; t = Math.abs(t);
  const m = Math.floor(t / 60), s = t - m * 60;
  const txt = (m ? m + ':' + (s < 10 ? '0' : '') : '') + s.toFixed(3).replace('.', ',');
  return (neg ? '−' : signo ? '+' : '') + txt;
}

export class Cronometro {
  // esc: escenario; pista: Pista; vueltas: número de vueltas (en un circuito); clave: para los récords
  constructor(esc, pista, vueltas, clave) {
    this.esc = esc; this.pista = pista; this.clave = clave;
    this.controles = esc.elementos.filter(e => e.tipo === 'checkpoint').sort((a, b) => (a.props.orden || 0) - (b.props.orden || 0)).map(e => puerta(e));
    const meta = esc.elementos.find(e => e.tipo === 'meta');
    this.inicio = esc.elementos.find(e => e.tipo === 'inicio') || null;
    this.principal = pista.caminos[0] || null;
    this.circuito = this.principal ? this.principal.cerrado : true;
    this.meta = meta ? puerta(meta) : this.inicio ? puerta(Object.assign({}, this.inicio, { props: { ancho: 14 } })) : null;
    this.vueltas = this.circuito ? Math.max(1, vueltas | 0) : 1;
    this.estado = 'espera'; // espera → cuenta → carrera → fin
    this.t = 0; this.vuelta = 1; this.siguiente = 0; this.tVuelta0 = 0;
    this.tiemposVuelta = []; this.parciales = []; this.parcialesVuelta = [];
    this.records = leerRecords()[clave] || {};
    this.eventos = [];
    this.recorrido = 0; // m desde la última meta (sin controles, para no contar la meta de la salida)
  }
  get total() { return this.controles.length; }
  empezar() { this.estado = 'carrera'; this.t = 0; this.tVuelta0 = 0; }

  // Avanza el tiempo y mira las puertas cruzadas entre (px, pz) y (qx, qz)
  actualizar(dt, px, pz, qx, qz) {
    this.eventos.length = 0;
    if (this.estado !== 'carrera') return;
    this.t += dt;
    this.recorrido += Math.hypot(qx - px, qz - pz);
    const g = this.controles[this.siguiente];
    if (g && cruza(g, px, pz, qx, qz)) {
      const tv = this.t - this.tVuelta0;
      this.parcialesVuelta[this.siguiente] = tv;
      const mejor = this.records.vuelta && this.records.vuelta.parciales ? this.records.vuelta.parciales[this.siguiente] : null;
      this.eventos.push({ tipo: 'control', n: this.siguiente + 1, t: tv, delta: mejor != null ? tv - mejor : null });
      this.siguiente++;
    }
    const sinControles = this.total === 0;
    if (this.meta && this.siguiente >= this.total && cruza(this.meta, px, pz, qx, qz) && (!sinControles || this.recorrido > 150)) this._meta();
  }
  _meta() {
    const tv = this.t - this.tVuelta0;
    this.tiemposVuelta.push(tv);
    const parciales = this.parcialesVuelta.slice();
    const mejorAnt = this.records.vuelta ? this.records.vuelta.t : null;
    const recordVuelta = mejorAnt == null || tv < mejorAnt;
    if (recordVuelta) this.records.vuelta = { t: tv, parciales, coche: this.coche || '', fecha: new Date().toISOString() };
    this.eventos.push({ tipo: 'vuelta', n: this.vuelta, t: tv, record: recordVuelta, delta: mejorAnt != null ? tv - mejorAnt : null });
    this.parcialesVuelta = []; this.siguiente = 0; this.recorrido = 0;
    if (this.vuelta >= this.vueltas) {
      this.estado = 'fin';
      const k = 'total' + this.vueltas;
      const ant = this.records[k] ? this.records[k].t : null;
      const record = ant == null || this.t < ant;
      if (record) this.records[k] = { t: this.t, vueltas: this.tiemposVuelta.slice(), coche: this.coche || '', fecha: new Date().toISOString() };
      this.eventos.push({ tipo: 'fin', t: this.t, record, delta: ant != null ? this.t - ant : null });
    } else { this.vuelta++; this.tVuelta0 = this.t; }
    guardarRecords(this.clave, this.records);
  }
  get tiempoVuelta() { return this.estado === 'carrera' ? this.t - this.tVuelta0 : (this.tiemposVuelta[this.tiemposVuelta.length - 1] || 0); }
  get mejorVuelta() { return this.records.vuelta ? this.records.vuelta.t : null; }
  get recordTotal() { const r = this.records['total' + this.vueltas]; return r ? r.t : null; }
  // Puerta a la que hay que ir ahora (para la flecha y el minimapa)
  get objetivo() { return this.siguiente < this.total ? this.controles[this.siguiente] : this.meta; }
}

// Récords en el navegador: { [clave del escenario]: { vuelta: {t, parciales, coche, fecha}, total3: {…} } }
const CLAVE = 'rallys.records';
export function leerRecords() { try { return JSON.parse(localStorage.getItem(CLAVE) || '{}'); } catch (e) { return {}; } }
function guardarRecords(clave, r) { try { const todo = leerRecords(); todo[clave] = r; localStorage.setItem(CLAVE, JSON.stringify(todo)); } catch (e) { /* sin almacenamiento */ } }
