// Física del coche: arcade, pero con lo que hace creíble un rally.
//  · Suspensión independiente en las 4 ruedas: cada una mira la altura de la pista bajo ella (terreno, camino,
//    tablero del puente…) y su muelle y amortiguador mueven la carrocería en altura, cabeceo y balanceo.
//    La carga de cada rueda sale de su muelle: si una rueda va en el aire, no agarra.
//  · Neumáticos con curva de agarre (pico y caída, tipo Pacejka simplificado) y círculo de fricción: al acelerar o
//    frenar fuerte se pierde agarre lateral, y el freno de mano bloquea las traseras → derrapes.
//  · Agarre según la superficie de cada rueda (asfalto > grava > tierra > barro > hierba; agua en el vado).
//  · Motor con curva de par, cambio automático de 6 marchas y marcha atrás, tracción total.
//  · Gravedad a lo largo de la pendiente, rodadura, aire y arrastre del agua.
// No depende de three.js: el dibujo lee el estado (posición, giros, ruedas) en cada fotograma.
import { SUPERFICIES, bache } from './pista.js';

const G = 9.81;

// Parámetros por defecto (se ajustan con las medidas del modelo y los datos del coche)
export const PARAMS_BASE = {
  masa: 1250,            // kg
  potencia: 210,         // kW
  rpmRalenti: 900, rpmCorte: 7400, rpmSubir: 6900, rpmBajar: 3300,
  marchas: [3.3, 2.2, 1.65, 1.3, 1.06, 0.88],
  marchaAtras: 3.2,
  grupo: 4.2,            // relación final, para una rueda de 0,33 m de radio
  reparto: 0.45,         // parte de la fuerza del motor que va delante (tracción total)
  giroMax: 0.6,          // rad de giro de las ruedas a poca velocidad
  recorrido: 0.17,       // m que baja la rueda desde la posición del modelo (y lo que se comprime en reposo)
  tope: 0.12,            // m de compresión extra hasta el tope
  amortiguacion: 0.38,   // fracción del amortiguamiento crítico
  alturaCdg: 0.5,        // m del centro de gravedad sobre el suelo
  aire: 0.9,             // N/(m/s)² de resistencia del aire
  frenada: 1.05,         // × peso
  repartoFreno: 0.64,
  // neumáticos: multiplican el agarre en firme (asfalto, adoquín) y en suelto (todo lo demás)
  agarreFirme: 1, agarreSuelto: 1
};
const FIRMES = new Set(['asfalto', 'piedra']);

function curva(alfa, B) { // fuerza lateral normalizada (−1…1) según el ángulo de deriva
  return Math.sin(1.45 * Math.atan(B * alfa));
}
function par(rpm, p) { // par del motor (N·m) con pico hacia el 60 % del régimen
  const pmax = p.potencia * 1000 / (5200 * Math.PI / 30) * 1.12;
  const x = (rpm - p.rpmRalenti) / (p.rpmCorte - p.rpmRalenti);
  return pmax * (0.62 + 0.38 * Math.sin(Math.min(1, Math.max(0, x)) * Math.PI * 0.95));
}

export class Coche {
  // medidas: { batalla (distancia entre ejes), ejeDel (z del eje delantero), ejeTras (z del trasero), via (ancho entre
  // ruedas), radio (de la rueda), largo, ancho, alto } en metros, en coordenadas del modelo (+z hacia delante)
  constructor(pista, medidas, datos) {
    this.pista = pista;
    this.p = Object.assign({}, PARAMS_BASE, datos || {});
    const m = this.m = medidas;
    this.p.grupo = this.p.grupo * m.radio / 0.33; // misma velocidad por marcha con cualquier rueda
    // Centro de gravedad entre los ejes (algo hacia delante: motor delantero)
    this.cdgZ = m.ejeTras + (m.ejeDel - m.ejeTras) * 0.52;
    this.a = m.ejeDel - this.cdgZ; this.b = this.cdgZ - m.ejeTras;
    const masa = this.p.masa;
    this.Iz = masa * (m.largo * m.largo + m.ancho * m.ancho) / 12 * 1.1;
    this.Ip = masa * (m.batalla * m.batalla) / 12 * 1.6;  // cabeceo
    this.Ir = masa * (m.via * m.via) / 12 * 2.2;          // balanceo
    this.k = masa * G / 4 / this.p.recorrido;             // muelle: en reposo la rueda queda donde la dibuja el modelo
    this.c = 2 * this.p.amortiguacion * Math.sqrt(this.k * masa / 4);
    // Ruedas: 0 del. izq., 1 del. der., 2 tras. izq., 3 tras. der. (izquierda = +x del modelo)
    this.ruedas = [[1, 1], [-1, 1], [1, 0], [-1, 0]].map(([s, del]) => ({
      lx: s * m.via / 2, lz: (del ? m.ejeDel : m.ejeTras) - this.cdgZ, del: !!del,
      comp: this.p.recorrido, compAnt: this.p.recorrido, fz: masa * G / 4, contacto: true,
      y: 0, omega: 0, vueltas: 0, sup: 'tierra', agua: 0, deslizando: 0, patinando: 0, consulta: null
    }));
    // Círculos de choque a lo largo de la carrocería
    const r = m.ancho / 2 * 0.92, mitad = m.largo / 2;
    this.circulos = [];
    const n = Math.max(2, Math.ceil((m.largo - 2 * r) / (r * 1.2)) + 1);
    for (let k = 0; k < n; k++) this.circulos.push({ lz: (m.zCentro || 0) - this.cdgZ + (-(mitad - r) + (2 * (mitad - r)) * k / (n - 1)), r });
    this.reiniciar(0, 0, 0);
  }

  // Coloca el coche parado en (x, z) mirando a «rumbo» (rad; 0 = +z)
  reiniciar(x, z, rumbo) {
    this.x = x; this.z = z; this.rumbo = rumbo;
    this.vx = 0; this.vz = 0; this.vy = 0; this.r = 0;
    this.cab = 0; this.vcab = 0; this.bal = 0; this.vbal = 0; // cabeceo (morro arriba +) y balanceo (izquierda arriba +)
    this.rumbo = rumbo;
    this.marcha = 1; this.rpm = this.p.rpmRalenti; this.cambio = 0; this.atras = false;
    this.giro = 0; // ángulo actual de las ruedas delanteras (rad, + izquierda)
    this.aLong = 0; this.aLat = 0;
    // apoyado en el suelo: altura, cabeceo y balanceo según el suelo bajo las cuatro ruedas (la base del modelo,
    // y = 0 del .glb, queda en el suelo con la suspensión en reposo)
    const h = this.ruedas.map(w => { const pt = this.aMundo(w.lx, w.lz); return this.pista.consultar(pt.x, pt.z).y; });
    this.cab = ((h[0] + h[1]) - (h[2] + h[3])) / 2 / this.m.batalla;
    this.bal = ((h[0] + h[2]) - (h[1] + h[3])) / 2 / this.m.via;
    this.y = h.reduce((a, b) => a + b, 0) / 4 - this.ruedas.reduce((a, w) => a + w.lz * this.cab + w.lx * this.bal, 0) / 4;
    for (const w of this.ruedas) { w.comp = w.compAnt = this.p.recorrido; w.vueltas = 0; w.omega = 0; }
    this.ahogado = 0;
    this.impactos = [];
    this.velocidad = 0;
  }

  get adelante() { return { x: Math.sin(this.rumbo), z: Math.cos(this.rumbo) }; }
  // Punto del coche (coordenadas locales respecto al centro de gravedad) en el mundo
  aMundo(lx, lz) {
    const c = Math.cos(this.rumbo), s = Math.sin(this.rumbo);
    return { x: this.x + lx * c + lz * s, z: this.z - lx * s + lz * c };
  }

  // Un paso de física. mando: { gas 0–1, freno 0–1, giro −1 (izq.) … 1 (der.), manoFreno bool }
  paso(dt, mando, obstaculos) {
    const p = this.p, masa = p.masa, m = this.m;
    this.reloj = (this.reloj || 0) + dt;
    const sn = Math.sin(this.rumbo), cs = Math.cos(this.rumbo);
    // velocidades en ejes del coche: longitudinal (adelante) y lateral (+ izquierda)
    let vL = this.vx * sn + this.vz * cs;
    let vT = this.vx * cs - this.vz * sn;
    const v = Math.hypot(this.vx, this.vz);
    this.velocidad = v;

    // --- Dirección: menos giro cuanto más rápido, con velocidad de giro limitada (como un volante) ---
    const giroMax = p.giroMax / (1 + Math.abs(vL) / 22);
    const objetivo = -mando.giro * giroMax;
    const rapidez = (Math.abs(objetivo) < Math.abs(this.giro) ? 4.5 : 2.6) * (mando.analogico ? 3 : 1);
    this.giro += Math.max(-rapidez * dt, Math.min(rapidez * dt, objetivo - this.giro));

    // --- Suspensión: altura del suelo bajo cada rueda y fuerza de su muelle ---
    let fzDel = 0, fzTras = 0, contactos = 0, fy = 0, tCab = 0, tBal = 0;
    let agarreDel = 0, agarreTras = 0, nDel = 0, nTras = 0, rodadura = 0, aguaMax = 0;
    const alturas = [];
    for (const w of this.ruedas) {
      const pt = this.aMundo(w.lx, w.lz);
      const q = this.pista.consultar(pt.x, pt.z);
      const sup = SUPERFICIES[q.tipo] || SUPERFICIES.tierra;
      const suelo = q.y + sup.bache * bache(pt.x, pt.z);
      alturas.push(suelo);
      w.consulta = q; w.sup = q.tipo; w.agua = q.agua; w.x = pt.x; w.z = pt.z;
      // anclaje de la rueda en la carrocería (altura del centro de la rueda en la posición del modelo)
      const ancla = this.y + m.radio + w.lz * this.cab + w.lx * this.bal;
      // la rueda cuelga hasta «recorrido» por debajo del anclaje; el suelo la empuja hacia arriba
      const centro = Math.max(ancla - p.recorrido, suelo + m.radio);
      w.comp = centro - (ancla - p.recorrido); // 0 = colgando, recorrido = reposo
      w.y = centro;
      let f = 0;
      w.contacto = suelo + m.radio >= ancla - p.recorrido - 0.002;
      if (w.contacto) {
        const vel = Math.max(-6, Math.min(6, (w.comp - w.compAnt) / dt));
        f = this.k * w.comp + this.c * vel;
        const exceso = w.comp - p.recorrido - p.tope;
        if (exceso > 0) f += this.k * 12 * exceso + this.c * 3 * Math.max(0, vel); // tope de la suspensión
        f = Math.max(0, f);
        contactos++;
      }
      w.compAnt = w.comp;
      w.fz = f;
      fy += f; tCab += f * w.lz; tBal += f * w.lx;
      const agarre = sup.agarre * (FIRMES.has(q.tipo) ? p.agarreFirme : p.agarreSuelto) * (q.agua > 0.04 ? 0.9 : 1);
      if (w.del) { fzDel += f; if (w.contacto) { agarreDel += agarre; nDel++; } } else { fzTras += f; if (w.contacto) { agarreTras += agarre; nTras++; } }
      if (w.contacto) rodadura += sup.rodadura / 4;
      aguaMax = Math.max(aguaMax, q.agua);
    }
    const muDel = nDel ? agarreDel / nDel : 0, muTras = nTras ? agarreTras / nTras : 0;
    this.enSuelo = contactos > 0;

    // --- Motor y caja de cambios ---
    const ratio = () => (this.atras ? p.marchaAtras : p.marchas[this.marcha - 1]) * p.grupo;
    if (this.cambio > 0) this.cambio -= dt;
    // marcha atrás: frenando casi parado; volver adelante: acelerando casi parado
    if (!this.atras && mando.freno > 0.3 && mando.gas < 0.1 && vL < 0.8) this.atras = true;
    else if (this.atras && mando.gas > 0.1 && vL > -0.8) this.atras = false;
    const gas = this.atras ? mando.freno : mando.gas;
    const freno = this.atras ? mando.gas : mando.freno;
    let rpmRueda = Math.abs(vL) / m.radio * ratio() * 60 / (2 * Math.PI);
    if (!this.atras && this.cambio <= 0) {
      if (rpmRueda > p.rpmSubir && this.marcha < p.marchas.length) { this.marcha++; this.cambio = 0.22; this.alCambiar && this.alCambiar(+1); }
      else if (this.marcha > 1 && rpmRueda < p.rpmBajar * (this.marcha === 2 ? 0.6 : 1)) { this.marcha--; this.cambio = 0.15; this.alCambiar && this.alCambiar(-1); }
      rpmRueda = Math.abs(vL) / m.radio * ratio() * 60 / (2 * Math.PI);
    }
    // con las ruedas patinando o en el aire, el motor sube de vueltas
    const patina = Math.max(...this.ruedas.map(w => w.patinando));
    const rpmLibre = p.rpmRalenti + gas * (p.rpmCorte - p.rpmRalenti) * 0.85;
    let rpmObj = Math.max(p.rpmRalenti, rpmRueda);
    if (!this.enSuelo || patina > 0.3) rpmObj = Math.max(rpmObj, rpmLibre * (this.enSuelo ? 0.5 + patina * 0.5 : 1));
    if (this.marcha === 1 && !this.atras && Math.abs(vL) < 4) rpmObj = Math.max(rpmObj, p.rpmRalenti + gas * 2800); // embrague al salir
    this.rpm += (Math.min(p.rpmCorte, rpmObj) - this.rpm) * Math.min(1, dt * 14);
    let fMotor = 0;
    if (this.cambio <= 0 && gas > 0) {
      const corte = this.rpm >= p.rpmCorte - 50 ? 0.2 : 1;
      fMotor = par(this.rpm, p) * ratio() * 0.88 / m.radio * gas * corte;
      if (this.atras) { fMotor = -fMotor; if (vL < -9) fMotor = 0; }
    }
    this.gasActual = gas;

    // --- Neumáticos ---
    // Ángulos de deriva (para poca velocidad, con un mínimo en el denominador)
    const vRef = Math.max(Math.abs(vL), 3);
    const alfaDel = Math.atan2(vT + this.a * this.r, vRef) - this.giro * Math.sign(vL || 1);
    const alfaTras = Math.atan2(vT - this.b * this.r, vRef);
    const BDel = 7 + 7 * Math.min(1, muDel), BTras = 7 + 7 * Math.min(1, muTras);
    const limDel = muDel * fzDel, limTras = muTras * fzTras * (mando.manoFreno ? 0.55 : 1);
    let fyDel = -limDel * curva(alfaDel, BDel);
    let fyTras = -limTras * curva(alfaTras, BTras);
    // longitudinal: motor repartido, frenos y freno de mano
    let fxDel = fMotor * p.reparto, fxTras = fMotor * (1 - p.reparto);
    const sentido = Math.abs(vL) > 0.3 ? Math.sign(vL) : 0;
    if (freno > 0) {
      const fb = freno * p.frenada * masa * G;
      if (sentido) { fxDel -= sentido * fb * p.repartoFreno; fxTras -= sentido * fb * (1 - p.repartoFreno); }
    }
    let bloqueo = false;
    if (mando.manoFreno) {
      if (sentido) fxTras = -sentido * limTras * 0.95; else fxTras = 0;
      bloqueo = true;
    }
    // patinaje al acelerar (para sonido y polvo) y círculo de fricción por eje
    const patDel = limDel > 0 ? Math.max(0, Math.abs(fxDel) / (limDel * 1.05) - 0.75) * 4 : (fMotor ? 1 : 0);
    const patTras = limTras > 0 ? Math.max(0, Math.abs(fxTras) / (limTras * 1.05) - 0.75) * 4 : (fMotor ? 1 : 0);
    const circulo = (fx, fyy, lim) => {
      const t = Math.hypot(fx, fyy);
      if (t > lim && t > 0) { const k = lim / t; return [fx * k, fyy * k]; }
      return [fx, fyy];
    };
    [fxDel, fyDel] = circulo(fxDel, fyDel, limDel);
    [fxTras, fyTras] = circulo(fxTras, fyTras, limTras);
    // a poca velocidad, amortiguar el deslizamiento lateral (si no, el coche tiembla parado)
    const lento = Math.max(0, 1 - Math.abs(vL) / 3);
    const fLento = -vT * masa * 4 * lento * (contactos / 4);
    // deslizamiento de cada eje (0–1) para el sonido, las marcas y el polvo
    const desDel = Math.min(1, Math.max(0, Math.abs(alfaDel) - 0.12) * 3) * (Math.abs(vL) > 3 ? 1 : 0);
    const desTras = Math.min(1, Math.max(0, Math.abs(alfaTras) - 0.12) * 3 + (bloqueo && Math.abs(vL) > 2 ? 0.7 : 0)) * (Math.abs(vL) > 3 ? 1 : 0);
    for (const w of this.ruedas) {
      w.deslizando = w.contacto ? (w.del ? desDel : desTras) : 0;
      w.patinando = w.contacto ? Math.min(1, w.del ? patDel : patTras) : 0;
    }

    // --- Fuerzas totales en ejes del coche ---
    const cd = Math.cos(this.giro), sd = Math.sin(this.giro);
    let FL = fxDel * cd - fyDel * sd + fxTras;
    let FT = fyDel * cd + fxDel * sd + fyTras + fLento;
    // rodadura y aire
    if (sentido) FL -= sentido * rodadura * masa * G;
    else if (!fMotor) FL -= vL * masa * 2 * (contactos / 4);
    FL -= p.aire * vL * Math.abs(vL);
    FT -= p.aire * 2 * vT * Math.abs(vT);
    // agua: frena mucho según la hondura
    if (aguaMax > 0.04) {
      const k = Math.min(1.2, aguaMax) * 1.6;
      FL -= vL * masa * k; FT -= vT * masa * k * 0.5;
    }
    // pendiente: la gravedad empuja cuesta abajo (desde las alturas bajo las ruedas)
    const hDel = (alturas[0] + alturas[1]) / 2, hTras = (alturas[2] + alturas[3]) / 2;
    const hIzq = (alturas[0] + alturas[2]) / 2, hDer = (alturas[1] + alturas[3]) / 2;
    const pendL = (hDel - hTras) / m.batalla, pendT = (hIzq - hDer) / m.via;
    const enContacto = contactos / 4;
    FL -= masa * G * pendL / Math.sqrt(1 + pendL * pendL) * enContacto;
    FT -= masa * G * pendT / Math.sqrt(1 + pendT * pendT) * enContacto;

    // --- Integración horizontal ---
    this.aLong = FL / masa; this.aLat = FT / masa;
    this.vx += (FL * sn + FT * cs) / masa * dt;
    this.vz += (FL * cs - FT * sn) / masa * dt;
    // giro: par de los neumáticos
    let tz = this.a * (fyDel * cd + fxDel * sd) - this.b * fyTras;
    tz -= this.r * this.Iz * 1.2 * lento * enContacto; // sin derrapes fantasma parado
    this.r += tz / this.Iz * dt;
    if (!this.enSuelo) this.r *= Math.exp(-dt * 0.3);
    this.rumbo += this.r * dt;
    // parado con el freno o el freno de mano: quieto del todo (también en cuesta)
    if ((freno > 0.2 || mando.manoFreno) && Math.abs(vL) < 0.4 && !fMotor && this.enSuelo) { this.vx *= 0.8; this.vz *= 0.8; this.r *= 0.8; }
    this.x += this.vx * dt; this.z += this.vz * dt;

    // --- Integración vertical: altura, cabeceo y balanceo ---
    this.vy += (fy / masa - G) * dt;
    this.y += this.vy * dt;
    const h = p.alturaCdg;
    tCab += masa * this.aLong * h * 0.6;  // al acelerar se levanta el morro; al frenar se hunde
    tBal += masa * this.aLat * h * 0.6;   // en las curvas se inclina hacia fuera
    this.vcab += tCab / this.Ip * dt; this.vbal += tBal / this.Ir * dt;
    if (!this.enSuelo) { this.vcab *= Math.exp(-dt * 0.8); this.vbal *= Math.exp(-dt * 0.8); }
    this.cab += this.vcab * dt; this.bal += this.vbal * dt;
    const lim = 0.7;
    if (Math.abs(this.cab) > lim) { this.cab = Math.sign(this.cab) * lim; this.vcab = 0; }
    if (Math.abs(this.bal) > lim) { this.bal = Math.sign(this.bal) * lim; this.vbal = 0; }
    // la carrocería nunca por debajo del suelo (si la suspensión no ha bastado)
    const sueloCentro = Math.max(...alturas);
    if (this.y < sueloCentro - m.radio * 0.6) { this.y = sueloCentro - m.radio * 0.6; if (this.vy < 0) this.vy = 0; }

    // --- Ruedas: giro de la llanta ---
    for (const w of this.ruedas) {
      let wv = vL / m.radio;
      if (w.contacto && w.patinando > 0.2) wv += Math.sign(fMotor || 1) * w.patinando * 18;
      if (bloqueo && !w.del) wv = 0;
      else if (!w.contacto) wv = w.omega * 0.995 + (gas && !this.atras ? 2 : 0);
      w.omega = wv;
      w.vueltas += wv * dt;
    }

    // --- Choques ---
    this.impactos.length = 0;
    if (obstaculos) obstaculos.resolver(this, dt);
    // límites del terreno
    const mitad = this.pista.esc.terreno.tam / 2 - 2;
    if (Math.abs(this.x) > mitad) { this.x = Math.sign(this.x) * mitad; this.vx *= -0.3; }
    if (Math.abs(this.z) > mitad) { this.z = Math.sign(this.z) * mitad; this.vz *= -0.3; }

    // ahogado en agua honda: se vuelve a la pista
    this.ahogado = aguaMax > 0.85 ? this.ahogado + dt : 0;
    this.agua = aguaMax;
  }

  // Impulso de choque en el punto (lx, lz local respecto al centro de gravedad) con normal (nx, nz) del mundo.
  // rebote 0–1, roce 0–1. Devuelve la velocidad de impacto (m/s).
  choque(px, pz, nx, nz, pen, rebote, roce) {
    this.x += nx * pen; this.z += nz * pen;
    const ax = px - this.x, az = pz - this.z;
    const vpx = this.vx + this.r * az, vpz = this.vz - this.r * ax;
    const vn = vpx * nx + vpz * nz;
    if (vn >= 0) return 0;
    const brazo = az * nx - ax * nz;
    const j = -(1 + rebote) * vn / (1 / this.p.masa + brazo * brazo / this.Iz);
    this.vx += j * nx / this.p.masa; this.vz += j * nz / this.p.masa;
    this.r += j * brazo / this.Iz;
    // roce: frena la componente tangente
    const tx = -nz, tz = nx, vt = this.vx * tx + this.vz * tz;
    this.vx -= tx * vt * roce; this.vz -= tz * vt * roce;
    return -vn;
  }
}
