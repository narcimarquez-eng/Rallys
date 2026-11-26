// Circuitos de rally DISEÑADOS (no aleatorios): cada uno se describe a mano como lo haría un organizador de rallies.
//  · El trazado, con «notas» de copiloto: rectas y curvas con su ángulo y radio, enlazadas por curvas de transición
//    (la curvatura cambia poco a poco, como en una carretera de verdad) y cerradas en una vuelta exacta.
//  · El relieve, con formas pensadas para el trazado: el monte por el que sube la carretera con horquillas, la loma que
//    hace un cambio de rasante ciego, la vaguada donde está el vado, la meseta del pueblo…
//  · El perfil de la carretera: rasante suave que sigue el terreno, más los cambios de rasante y saltos donde se quieren.
//  · Lo que hay alrededor, colocado con criterio: barreras según la curva y el desnivel (paja por fuera de las curvas
//    cerradas, guardarraíl donde el terreno cae, neumáticos en la salida…), pasillos de bosque con espacio a los lados,
//    hileras de árboles en las rectas, pueblos junto a la carretera, ríos con su puente o su vado, campos de trigo…
// El azar solo pone el detalle (dónde cae cada árbol de un bosque, la textura del relieve): el diseño es fijo.
// Funciona en el navegador (después de escenario-core.js: amplía window.Escenario) y en Node (require).
(function (raiz) {
  'use strict';
  const E = (typeof module !== 'undefined' && module.exports) ? require('./escenario-core.js') : raiz.Escenario;
  const { clamp, lerp } = E;
  const suave = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const RAD = Math.PI / 180;

  // ---------------------------------------------------------------------------
  // 1. Trazado
  // ---------------------------------------------------------------------------
  // Como se diseñan las carreteras: una poligonal de vértices en planta y, en cada vértice, el radio de su curva (un
  // arco tangente a las dos rectas). Luego, curvas de transición: la curvatura se reparte en «transicion» metros para
  // que no cambie de golpe (clotoides, como en una carretera de verdad).
  // spec: { vertices: [{ x, z, r }], cerrado = true, transicion = 18, paso = 10 }
  //   r: radio de la curva en ese vértice (m). Una horquilla son dos vértices seguidos de ~90° con radio pequeño.
  // Devuelve { puntos (de control del camino), largo, avisos }.
  function trazarRuta(spec) {
    const V = spec.vertices, n = V.length, cerr = spec.cerrado !== false;
    if (n < 3) throw new Error('Hacen falta al menos 3 vértices');
    const avisos = [];
    const get = i => V[(i + n) % n];
    // para cada vértice: deflexión (con signo, + izquierda), tangente T = R·tan(Δ/2)
    const info = [];
    for (let i = 0; i < n; i++) {
      if (!cerr && (i === 0 || i === n - 1)) { info.push({ d: 0, T: 0, R: 0 }); continue; }
      const a = get(i - 1), b = get(i), c = get(i + 1);
      const t1 = Math.atan2(b.x - a.x, b.z - a.z), t2 = Math.atan2(c.x - b.x, c.z - b.z);
      let d = t2 - t1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      const R = b.r || 60;
      info.push({ d, R, T: R * Math.tan(Math.abs(d) / 2) });
    }
    // las tangentes de dos vértices seguidos no pueden pisarse: si no caben, se reduce el radio
    for (let i = 0; i < n; i++) {
      if (!cerr && i === n - 1) break;
      const a = get(i), b = get(i + 1), L = Math.hypot(b.x - a.x, b.z - a.z);
      const A = info[i], B = info[(i + 1) % n];
      if (A.T + B.T > L) {
        const f = L / (A.T + B.T) * 0.98;
        for (const X of [A, B]) { X.T *= f; X.R = X.T / Math.max(1e-6, Math.tan(Math.abs(X.d) / 2)); }
        avisos.push(`Entre los vértices ${i} y ${(i + 1) % n} no caben las curvas: radios reducidos`);
      }
    }
    // curvatura por metro: recta (lo que queda de cada tramo) + arco de cada vértice
    const kap = [];
    const recta = L => { for (let k = 0; k < Math.round(L); k++) kap.push(0); };
    const arco = X => { if (!X.d) return; const L = Math.max(1, Math.round(Math.abs(X.d) * X.R)); for (let k = 0; k < L; k++) kap.push(X.d / L); };
    const i0 = cerr ? 0 : 0;
    // empieza al salir de la curva del vértice 0 (o en el vértice 0 si el camino es abierto)
    const v0 = get(i0), v1 = get(i0 + 1), dir0 = Math.atan2(v1.x - v0.x, v1.z - v0.z);
    const x0 = v0.x + Math.sin(dir0) * info[0].T, z0 = v0.z + Math.cos(dir0) * info[0].T;
    const tramos = cerr ? n : n - 1;
    for (let s = 0; s < tramos; s++) {
      const a = get(s), b = get(s + 1), L = Math.hypot(b.x - a.x, b.z - a.z);
      recta(L - info[s].T - info[(s + 1) % n].T);
      if (cerr || s + 1 < n - 1) arco(info[(s + 1) % n]);
    }
    const r = integrar(kap, x0, z0, dir0, spec.transicion == null ? 18 : spec.transicion, cerr, spec.paso || 10);
    r.avisos = avisos.concat(r.error > 3 ? ['Cierre repartido: ' + r.error.toFixed(1) + ' m'] : []);
    return r;
  }

  // Integra una curvatura por metro desde (x, z) con rumbo «th» (rad). En un circuito, ajusta el giro a ±360° y reparte
  // el pequeño desajuste del final a lo largo de la vuelta.
  function integrar(kap, x, z, th, transicion, cerr, paso) {
    const N = kap.length;
    const w = Math.max(0, Math.round(transicion / 2));
    let k2 = kap;
    if (w > 0) {
      k2 = new Array(N).fill(0);
      for (let i = 0; i < N; i++) {
        let s = 0, c = 0;
        for (let q = -w; q <= w; q++) { let j = i + q; if (cerr) j = (j + N) % N; else if (j < 0 || j >= N) continue; s += kap[j]; c++; }
        k2[i] = s / c;
      }
    }
    if (cerr) {
      const tot = k2.reduce((a, b) => a + b, 0), obj = Math.sign(tot) * Math.PI * 2;
      if (Math.abs(tot - obj) > 0.3) throw new Error('El trazado gira ' + Math.round(tot / RAD) + '°: una vuelta tiene que girar ±360°');
      for (let i = 0; i < N; i++) k2[i] *= obj / tot;
    }
    const pts = [{ x, z }];
    for (let i = 0; i < N; i++) {
      const t0 = th; th += k2[i];
      const tm = (t0 + th) / 2;
      x += Math.sin(tm); z += Math.cos(tm);
      pts.push({ x, z });
    }
    let error = 0;
    if (cerr) {
      const ex = pts[N].x - pts[0].x, ez = pts[N].z - pts[0].z;
      error = Math.hypot(ex, ez);
      for (let i = 0; i <= N; i++) { pts[i].x -= ex * i / N; pts[i].z -= ez * i / N; }
      pts.pop();
    }
    const puntos = [];
    for (let i = 0; i < pts.length; i += paso) puntos.push({ x: Math.round(pts[i].x * 10) / 10, z: Math.round(pts[i].z * 10) / 10 });
    if (!cerr && (pts.length - 1) % paso) puntos.push(pts[pts.length - 1]);
    return { puntos, largo: N, error };
  }

  // Curvatura con signo (1/m; + izquierda) en cada muestra de un camino, medida en ±L/2 metros
  function curvaturas(mu, cerrado, L) {
    L = L || 12;
    const n = mu.length, out = new Float32Array(n);
    const paso = mu.length > 1 ? (mu[mu.length - 1].d / (n - 1)) : 1, h = Math.max(1, Math.round(L / 2 / paso));
    for (let k = 0; k < n; k++) {
      const a = mu[cerrado ? (k - h + n) % n : Math.max(0, k - h)], b = mu[k], c = mu[cerrado ? (k + h) % n : Math.min(n - 1, k + h)];
      const t1 = Math.atan2(b.x - a.x, b.z - a.z), t2 = Math.atan2(c.x - b.x, c.z - b.z);
      let dt = t2 - t1; while (dt > Math.PI) dt -= 2 * Math.PI; while (dt < -Math.PI) dt += 2 * Math.PI;
      const l = Math.hypot(c.x - a.x, c.z - a.z) / 2 || 1;
      out[k] = dt / l;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // 2. Relieve con formas
  // ---------------------------------------------------------------------------
  // Distancia a una polilínea (suavizada como un camino) con una rejilla de cubos: rápida para todo el mapa.
  function campoDistancia(puntos, cerrado, alcance) {
    const mu = E.muestrearCamino({ puntos, cerrado: !!cerrado }, 4), C = Math.max(16, alcance / 2), cubos = new Map();
    mu.forEach(m => { const k = Math.floor(m.x / C) + ',' + Math.floor(m.z / C); if (!cubos.has(k)) cubos.set(k, []); cubos.get(k).push(m); });
    const n = Math.ceil(alcance / C);
    return (x, z) => {
      const cx = Math.floor(x / C), cz = Math.floor(z / C);
      let best = Infinity, bm = null;
      for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) {
        const l = cubos.get((cx + a) + ',' + (cz + b)); if (!l) continue;
        for (const m of l) { const d = (m.x - x) * (m.x - x) + (m.z - z) * (m.z - z); if (d < best) { best = d; bm = m; } }
      }
      return { d: Math.sqrt(best), m: bm };
    };
  }
  // formas: lista de
  //  { tipo: 'colina', x, z, radio (o rx, rz y giro en grados), alto }  monte o loma (negativo: hondonada)
  //  { tipo: 'meseta', x, z, radio, alto, borde }                        cima plana con borde en talud
  //  { tipo: 'cresta', puntos, ancho, alto }                             sierra a lo largo de una línea
  //  { tipo: 'vaguada', puntos, ancho, hondo }                           valle a lo largo de una línea
  //  { tipo: 'inclinar', hacia (grados, 0 = +z), pendiente }             todo el terreno, en rampa
  function modelarTerreno(esc, formas) {
    const t = esc.terreno, r = t.res, p = E.paso(esc), m = t.tam / 2;
    const prep = formas.map(f => {
      if (f.puntos) return Object.assign({ dist: campoDistancia(f.puntos, f.cerrado, (f.ancho || 60) * 2.2) }, f);
      if (f.tipo === 'colina' || f.tipo === 'meseta') {
        const g = (f.giro || 0) * RAD;
        return Object.assign({ c: Math.cos(g), s: Math.sin(g), rx: f.rx || f.radio, rz: f.rz || f.radio }, f);
      }
      return f;
    });
    for (let j = 0; j < r; j++) for (let i = 0; i < r; i++) {
      const x = -m + i * p, z = -m + j * p;
      let h = 0;
      for (const f of prep) {
        switch (f.tipo) {
          case 'colina': {
            const dx = x - f.x, dz = z - f.z, lx = (dx * f.c - dz * f.s) / f.rx, lz = (dx * f.s + dz * f.c) / f.rz;
            const d2 = lx * lx + lz * lz;
            if (d2 < 4) h += f.alto * Math.exp(-3 * d2);
            break;
          }
          case 'meseta': {
            const d = Math.hypot((x - f.x) / f.rx, (z - f.z) / f.rz) * f.radio;
            h += f.alto * suave((f.radio - d) / (f.borde || 30) + 0.5);
            break;
          }
          case 'cresta': case 'vaguada': {
            const q = f.dist(x, z); if (q.d === Infinity) break;
            const u = q.d / f.ancho, v = Math.exp(-3 * u * u);
            h += f.tipo === 'cresta' ? f.alto * v : -f.hondo * v;
            break;
          }
          case 'inclinar': { const a = f.hacia * RAD; h += (x * Math.sin(a) + z * Math.cos(a)) * f.pendiente; break; }
        }
      }
      t.alturas[j * r + i] += h;
    }
    E.olvidarRango(esc);
  }

  // ---------------------------------------------------------------------------
  // 3. Ayudas sobre el camino
  // ---------------------------------------------------------------------------
  function enCamino(mu, cerrado) {
    const total = mu[mu.length - 1].d;
    // punto, dirección (unitaria) y normal (hacia el lado que Escenario llama «izq») a d metros
    return d => {
      const a = E.puntoEnD(mu, d - 2, cerrado), b = E.puntoEnD(mu, d + 2, cerrado), q = E.puntoEnD(mu, d, cerrado);
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1, ux = (b.x - a.x) / l, uz = (b.z - a.z) / l;
      // proyectarEnCamino: lado +1 («izq») si dx·(z − az) − dz·(x − ax) > 0 → normal (−uz, ux)·(−1)… se calcula así:
      return { x: q.x, z: q.z, ux, uz, nx: uz, nz: -ux, rot: Math.atan2(ux, uz) / RAD, total };
    };
  }
  // Rango de distancias [d0, d1] (en un circuito puede dar la vuelta) → función «está dentro»
  const dentroRango = (d, a, b, total) => b >= a ? d >= a && d <= b : (d >= a || d <= b);
  const redondear = v => Math.round(v);

  // Barreras según el trazado: por fuera de las curvas cerradas, donde el terreno cae a un lado, en la salida y donde
  // está el público. estilo: { cerrada, rapida, caida, salida, publico, publi } (tipo de barrera o null).
  function barrerasSegunTrazado(esc, c, estilo, evitar) {
    estilo = Object.assign({ cerrada: 'balas_paja', rapida: null, caida: 'guardarrail', salida: 'neumaticos', publico: 'cinta', publi: 'valla_publi' }, estilo || {});
    const mu = E.muestrearCamino(c, 2), total = mu[mu.length - 1].d, n = mu.length;
    const k = curvaturas(mu, c.cerrado, 16), en = enCamino(mu, c.cerrado);
    const libre = d => !(evitar || []).some(r => dentroRango(d, r[0], r[1], total));
    const out = [];
    const ladoDe = (d, signo) => { // signo +1 / −1 respecto a la normal de enCamino → 'izq' o 'der' de Escenario
      const q = en(d), px = q.x + q.nx * signo * 6, pz = q.z + q.nz * signo * 6;
      return E.proyectarEnCamino(c, px, pz, mu).lado > 0 ? 'izq' : 'der';
    };
    // tramos seguidos que cumplen una condición
    const grupos = (cond, minLargo) => {
      const res = []; let ini = null;
      for (let i = 0; i < n; i++) {
        const ok = cond(i);
        if (ok && ini == null) ini = i;
        if ((!ok || i === n - 1) && ini != null) { const fin = ok ? i : i - 1; if (mu[fin].d - mu[ini].d >= (minLargo || 0)) res.push([ini, fin]); ini = null; }
      }
      return res;
    };
    // 1) curvas cerradas (R < 34 m): por fuera; y curvas rápidas al final de una recta larga
    if (estilo.cerrada) for (const [a, b] of grupos(i => Math.abs(k[i]) > 1 / 34, 6)) {
      const dm = (mu[a].d + mu[b].d) / 2; if (!libre(dm)) continue;
      const signo = k[(a + b) >> 1] > 0 ? -1 : 1; // por fuera: al contrario del giro (giro + = hacia la normal)
      out.push({ tipo: estilo.cerrada, lado: ladoDe(dm, signo), desde: redondear(Math.max(0, mu[a].d - 14)), hasta: redondear(Math.min(total, mu[b].d + 12)), separacion: 2.2 });
    }
    if (estilo.rapida) for (const [a, b] of grupos(i => Math.abs(k[i]) > 1 / 90 && Math.abs(k[i]) <= 1 / 34, 10)) {
      let recta = 0; for (let i = a - 1; i > 0 && Math.abs(k[i]) < 1 / 250; i--) recta += 2;
      if (recta < 140) continue;
      const dm = (mu[a].d + mu[b].d) / 2; if (!libre(dm)) continue;
      out.push({ tipo: estilo.rapida, lado: ladoDe(dm, k[(a + b) >> 1] > 0 ? -1 : 1), desde: redondear(mu[a].d - 10), hasta: redondear(mu[b].d + 15), separacion: 3.5 });
    }
    // 2) donde el terreno cae a un lado más de 2,5 m (a 7 m del borde): barrera a ese lado
    if (estilo.caida) for (const signo of [1, -1]) {
      const cae = i => {
        const q = en(mu[i].d), y = E.alturaEn(esc, q.x, q.z), off = c.ancho / 2 + 7;
        return y - E.alturaEn(esc, q.x + q.nx * signo * off, q.z + q.nz * signo * off) > 2.5 && libre(mu[i].d);
      };
      for (const [a, b] of grupos(cae, 24)) out.push({ tipo: estilo.caida, lado: ladoDe(mu[(a + b) >> 1].d, signo), desde: redondear(mu[a].d - 8), hasta: redondear(mu[b].d + 8), separacion: 0.8 });
    }
    // 3) salida y meta
    if (estilo.salida) out.push({ tipo: estilo.salida, lado: 'ambos', desde: redondear(total - 45), hasta: 50, separacion: 1.4 });
    if (estilo.publi) out.push({ tipo: estilo.publi, lado: ladoDe(30, 1), desde: 58, hasta: 120, separacion: 4 });
    c.barreras.push(...out);
    return out;
  }

  // Árboles a lo largo del camino: «bosque» en pasillo (manchas de bosque a los lados con «holgura» libre junto al
  // camino) o «hilera» (árboles sueltos a una distancia fija, como los chopos de una carretera).
  function pasilloBosque(esc, c, o, mu) {
    const en = enCamino(mu, c.cerrado), total = mu[mu.length - 1].d;
    const R = o.radio || 42, desde = o.desde * total, hasta = (o.hasta < o.desde ? o.hasta + 1 : o.hasta) * total;
    const lados = o.lados === 'izq' ? [1] : o.lados === 'der' ? [-1] : [1, -1];
    let n = 0;
    for (let d = desde; d <= hasta; d += R * 1.3) {
      for (const s of lados) {
        const q = en(d % total), D = c.ancho / 2 + R * 0.75 + (o.separacion || 0);
        crearEl(esc, 'bosque', q.x + q.nx * s * D, q.z + q.nz * s * D, { radio: R, especie: o.especie || 'mixto', densidad: o.densidad || 9,
          holgura: o.holgura == null ? 4 : o.holgura, rocas: o.rocas == null ? 0.08 : o.rocas, tamano: o.tamano || 1, nombre: o.nombre || 'Bosque' });
        n++;
      }
    }
    return n;
  }
  function hileraArboles(esc, c, o, mu) {
    const en = enCamino(mu, c.cerrado), total = mu[mu.length - 1].d;
    const desde = o.desde * total, hasta = (o.hasta < o.desde ? o.hasta + 1 : o.hasta) * total;
    const lados = o.lados === 'izq' ? [1] : o.lados === 'der' ? [-1] : [1, -1];
    for (let d = desde; d <= hasta; d += o.separacion || 14) for (const s of lados) {
      const q = en(d % total), D = c.ancho / 2 + (o.distancia || 7);
      const el = crearEl(esc, 'arbol', q.x + q.nx * s * D, q.z + q.nz * s * D, { especie: o.especie || 'pino', alto: o.alto || 0 });
      el.rotY = Math.round((d * 37) % 360);
    }
  }
  function crearEl(esc, tipo, x, z, props) {
    // bosques y pedregales: semilla fija según el circuito y el orden (así cada árbol cae siempre en el mismo sitio)
    if ((tipo === 'bosque' || tipo === 'rocas') && !(props && props.semilla)) props = Object.assign({}, props, { semilla: 1 + E.hashTexto(esc.plantilla + ':' + esc.nextId) % 99998 });
    return E.crearElemento(esc, tipo, Math.round(x * 10) / 10, Math.round(z * 10) / 10, props);
  }
  // Campos (trigo, flores, hierba alta) en rectángulos: se pintan a golpes de pincel
  function pintarCampo(esc, o) {
    const g = (o.giro || 0) * RAD, cs = Math.cos(g), sn = Math.sin(g), paso = 7;
    for (let a = -o.ancho / 2; a <= o.ancho / 2; a += paso) for (let b = -o.largo / 2; b <= o.largo / 2; b += paso) {
      const x = o.x + a * cs + b * sn, z = o.z - a * sn + b * cs;
      if (o.material != null) E.pintar(esc, { x, z, radio: 6, material: o.material });
      E.pintarVegetacion(esc, { x, z, radio: 6, tipo: o.tipo || 'trigo', densidad: o.densidad || 0.8 });
    }
  }
  // Arcenes: una franja de otro suelo a cada lado del camino (tierra pisada, hierba seca…)
  function pintarArcenes(esc, c, material, mu, ancho) {
    const en = enCamino(mu, c.cerrado), total = mu[mu.length - 1].d;
    for (let d = 0; d < total; d += 3) {
      const q = en(d);
      for (const s of [1, -1]) {
        const D = c.ancho / 2 + (ancho || 2) / 2 + 0.5;
        E.pintar(esc, { x: q.x + q.nx * s * D, z: q.z + q.nz * s * D, radio: (ancho || 2) * 0.9, material });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Un circuito a partir de su diseño
  // ---------------------------------------------------------------------------
  function construirCircuito(esc, D, rng) {
    const T = esc.terreno;
    if (D.agua) T.agua = Object.assign({ activa: true, nivel: 0, color: null }, D.agua);
    if (D.bordes) T.bordes = D.bordes;
    if (D.hierbaAuto != null) T.hierbaAuto = D.hierbaAuto;
    if (D.cotaNieve !== undefined) T.cotaNieve = D.cotaNieve; // null o un número: altura a partir de la que hay nieve
    Object.assign(esc.ambiente, D.ambiente || {});
    esc.descripcion = D.desc || '';
    // Relieve: base suave (solo detalle) + formas del diseño
    // (el diseño es fijo: las semillas salen de él, no de la del escenario)
    E.generarTerreno(esc, Object.assign({ tipo: 'colinas', escala: 260, altura: 8, octavas: 5, semilla: D.semilla || 7 }, D.relieve.base || {}));
    modelarTerreno(esc, D.relieve.formas || []);
    // Trazado
    const tr = trazarRuta(D.ruta), avisos = tr.avisos.slice();
    const cam = Object.assign({ tipo: 'grava', ancho: 10, bordes: false }, D.camino);
    const c = E.crearCamino(esc, { tipo: cam.tipo, ancho: cam.ancho, cerrado: true, bordes: cam.bordes, puntos: tr.puntos, nombre: D.nombreCamino || 'Tramo' });
    const mu0 = E.muestrearCamino(c, 2), total = mu0[mu0.length - 1].d;
    const pasoM = Math.max(1, E.paso(esc) * 0.75), ventana = Math.max(2, Math.round((cam.suavizado || 36) / pasoM));
    // Ríos y lagos primero: el agua excava su valle en el terreno natural y la carretera lo cruza después
    const rios = (D.rios || []).map(o => {
      const r = E.crearCamino(esc, { tipo: 'riachuelo', ancho: o.ancho || 6, profundidad: o.profundidad, nombre: o.nombre || 'Arroyo', puntos: o.puntos });
      E.ajustarTerrenoACamino(esc, r);
      return { o, r };
    });
    for (const o of D.lagos || []) { const l = crearEl(esc, 'lago', o.x, o.z, { radio: o.radio, nombre: o.nombre || 'Lago', forma: o.forma || 7 }); E.excavarLago(esc, l); }
    // Cruces con los ríos (rios[].cruces, en el orden en que los encuentra la carretera):
    //  · puente: la carretera sigue a la altura de las orillas altas, en terraplén, y el puente salva el cauce;
    //  · vado: la carretera baja hasta 30 cm por debajo del agua, con rampas de un 6 % de media.
    const bultos = (D.rasante || []).map(b => ({ d: b.en * total, alto: b.alto, largo: b.largo || 30 }));
    const dist = (d, a) => { const x = Math.abs(d - a); return Math.min(x, total - x); };
    const conBultos = (d, y) => { for (const b of bultos) { const x = dist(d, b.d); if (x < b.largo / 2) y += b.alto * 0.5 * (1 + Math.cos(Math.PI * x / (b.largo / 2))); } return y; };
    if (D.relieve.minimo != null) { // que la carretera no baje de esta altura (costa)
      for (const m of E.muestrearCamino(c, 12)) if (E.alturaEn(esc, m.x, m.z) < D.relieve.minimo) E.allanarArea(esc, m.x, m.z, cam.ancho * 1.6, D.relieve.minimo + 0.5, 24);
    }
    // primera pasada: la carretera, asentada (rellena los valles); con ella se sabe a qué altura va cada puente
    E.ajustarTerrenoACamino(esc, c, { margen: cam.margen || 16, ventana, perfil: conBultos });
    const cruces = E.crucesCaminoRio(esc).filter(cr => cr.camino === c).sort((a, b) => a.d - b.d);
    const usados = new Map(), vados = [], puentes = [];
    const alturaA = (d0, o) => { const q = E.puntoEnD(mu0, d0 + o, true); return E.alturaEn(esc, q.x, q.z); };
    for (const cr of cruces) {
      const def = rios.find(x => x.r === cr.rio), i = usados.get(cr.rio) || 0; usados.set(cr.rio, i + 1);
      const que = def ? (def.o.cruces ? def.o.cruces[i] : def.o.puente) || 'vado' : 'vado';
      if (que !== 'vado') {
        const P = E.PUENTES[que] || E.PUENTES.romano, L = Math.max(P.vano, cr.rio.ancho * 2.2 + 8);
        const H = Math.max(alturaA(cr.d, -(L / 2 + 40)), alturaA(cr.d, L / 2 + 40), alturaA(cr.d, -L / 2 - 4), alturaA(cr.d, L / 2 + 4)) + 0.2;
        puentes.push({ cr, modelo: que, nombre: def && def.o.nombrePuente, L, H, d: cr.d });
      } else vados.push({ cr, d: cr.d, alto: Math.max(alturaA(cr.d, -70), alturaA(cr.d, 70)) });
    }
    // los ríos vuelven a abrir su cauce donde la primera pasada lo había tapado; con el cauce abierto, el nivel del agua
    // en cada vado (y el largo de sus rampas)
    for (const { r } of rios) E.ajustarTerrenoACamino(esc, r);
    for (const v of vados) {
      const muR = E.muestrearCamino(v.cr.rio, 2), niv = E.nivelesRio(esc, v.cr.rio, muR);
      const pr = E.proyectarEnCamino(v.cr.rio, v.cr.x, v.cr.z, muR);
      let k = 0; while (k < muR.length - 1 && muR[k].d < pr.d) k++;
      v.nivel = niv[k]; v.largo = clamp((v.alto - v.nivel) / 0.06, 40, 170);
    }
    // Rasante final: la del terreno suavizada, con los cambios de rasante y saltos (+) o badenes (−) del diseño, los
    // vados y los terraplenes de los puentes. Bajo los puentes no se toca el terreno (por ahí pasa el río).
    const perfil = (d, y) => {
      y = conBultos(d, y);
      for (const v of vados) { const x = dist(d, v.d); if (x < v.largo) y = lerp(y, v.nivel - 0.3, suave(1 - x / v.largo)); }
      for (const p of puentes) { const x = dist(d, p.d) - p.L / 2, rampa = 60; if (x < rampa) y = lerp(y, p.H, x <= 0 ? 1 : suave(1 - x / rampa)); }
      return y;
    };
    const respetar = d => puentes.some(p => dist(d, p.d) < p.L / 2 - 1);
    const optsR = { margen: cam.margen || 16, ventana, perfil, respetar };
    E.ajustarTerrenoACamino(esc, c, optsR);
    for (const p of puentes) {
      const el = crearEl(esc, 'puente', p.cr.x, p.cr.z, { modelo: p.modelo, nombre: p.nombre || 'Puente', largo: Math.round(p.L * 10) / 10 });
      E.ajustarPuenteACamino(esc, el, p.cr.rio.ancho);
      const P = E.PUENTES[p.modelo] || E.PUENTES.romano;
      el.y = Math.round((p.H - P.extremo - E.alturaEn(esc, el.x, el.z)) * 100) / 100; // el tablero, a la altura de la carretera
    }
    // Pueblos junto a la carretera, con su camino de acceso
    const enC = enCamino(mu0, true);
    for (const o of D.pueblos || []) {
      // en: punto de la vuelta junto al que va el pueblo (o x, z: sitio fijo; el acceso sale del punto más cercano)
      const q = o.x != null ? enC(E.proyectarEnCamino(c, o.x, o.z, mu0).d) : enC(o.en * total);
      const cfg = E.cfgPuebloPorDefecto(o.semilla || 4242, o.size || 3);
      Object.assign(cfg, { style: o.style || 'european', casas: o.casas || 'glb', trazado: o.trazado || 'variado', houseDensity: o.densidad || 85, maxFloors: o.plantas || 2,
        puestos: false, hasWalls: false, hasRiver: false, hasMagic: false, specialCount: 0, treeDensity: o.arboles == null ? 30 : o.arboles, relief: 0,
        rotation: o.giro != null ? o.giro : Math.round(Math.atan2(q.uz, q.ux) / RAD) }); // un lado del pueblo, paralelo a la carretera
      // el cuadrado del pueblo (donde mandan sus calles) no puede tocar la carretera: se aparta hasta que no la toque
      const hP = E.mitadTerrenoPueblo(cfg);
      let px, pz, s = o.lado || 1, sitio = null;
      const prueba = { props: { cfg } }, dentroMapa = (x, z) => Math.abs(x) + hP < T.tam / 2 && Math.abs(z) + hP < T.tam / 2;
      if (o.x != null) sitio = { x: o.x, z: o.z, lado: ((o.x - q.x) * q.nx + (o.z - q.z) * q.nz) > 0 ? 1 : -1 };
      for (const lado of sitio ? [] : [s, -s]) { // primero en el lado que pide el diseño; si no cabe, en el otro
        for (let k = 0, dist = o.dist || hP + 10; k < 30 && !sitio; k++, dist += 10) {
          prueba.x = q.x + q.nx * lado * dist; prueba.z = q.z + q.nz * lado * dist;
          if (dentroMapa(prueba.x, prueba.z) && !mu0.some(m => E.dentroTerrenoPueblo(prueba, m.x, m.z, -10))) sitio = { x: prueba.x, z: prueba.z, lado };
        }
        if (sitio) break;
      }
      if (!sitio) { avisos.push('No cabe el pueblo ' + (o.nombre || '') + ' junto a la carretera'); continue; }
      px = sitio.x; pz = sitio.z; s = sitio.lado;
      const pu = crearEl(esc, 'pueblo', px, pz, { nombre: o.nombre || 'Aldea', nivel: 1, cfg });
      const allanar = () => o.altura != null ? E.allanarArea(esc, px, pz, pu.props.radio * 0.9, o.altura) : E.prepararPueblo(esc, pu); // altura: fija (p. ej. sobre el mar)
      allanar();
      const ac = E.crearCamino(esc, { tipo: o.acceso || 'tierra', ancho: 6, nombre: 'Acceso a ' + (o.nombre || 'la aldea'),
        puntos: [{ x: q.x, z: q.z }, { x: q.x + q.nx * s * (cam.ancho / 2 + 12), z: q.z + q.nz * s * (cam.ancho / 2 + 12) }, { x: px, z: pz }] });
      E.conectarCaminosPueblo(esc, pu);
      E.ajustarTerrenoACamino(esc, ac, { margen: 10 });
      allanar();
      if (o.iglesia) {
        const ig = crearEl(esc, 'glb', px + o.iglesia.dx, pz + o.iglesia.dz, { nombre: 'Iglesia', modelo: 'glb/edificios/iglesia_granada_moguer.glb', alturaObjetivo: 48, huella: [81, 64] });
        ig.rotY = o.iglesia.rotY || 0;
      }
    }
    E.ajustarTerrenoACamino(esc, c, optsR); // otra vez, por si los pueblos y sus accesos han tocado la carretera
    const pasos = E.puentesDeCamino(esc, c).map(b => [b.d0 - 4, b.d1 + 4]);
    // Superficies por tramos
    for (const t of D.tramos || []) c.tramos.push({ desde: redondear(t.desde * total), hasta: redondear(t.hasta * total), tipo: t.tipo });
    // Salida, meta y controles
    const mu = E.muestrearCamino(c, 2), en = enCamino(mu, true);
    const pm = en(D.meta || 30), meta = crearEl(esc, 'meta', pm.x, pm.z, { ancho: cam.ancho + 6, nombre: 'Meta' }); meta.rotY = Math.round(pm.rot);
    const pi = en((D.meta || 30) - 18), ini = crearEl(esc, 'inicio', pi.x, pi.z, { nombre: 'Salida' }); ini.rotY = Math.round(pm.rot);
    // Controles: cada uno en el tramo más recto a ±60 m de donde dice el diseño (nunca en plena curva, ni en un puente
    // o un vado): es donde se puede pasar por el arco sin jugársela
    const kC = curvaturas(mu, true, 24), enAgua = d => vados.some(v => dist(d, v.d) < 30) || puentes.some(p => dist(d, p.d) < p.L / 2 + 25);
    (D.controles || [0.2, 0.4, 0.6, 0.75, 0.9]).forEach((f, i) => {
      let mejor = f * total, kMin = Infinity;
      for (let dd = f * total - 60; dd <= f * total + 60; dd += 4) {
        const dm = (dd + total) % total, k = Math.abs(kC[Math.round(dm / 2) % kC.length]) + (enAgua(dm) ? 1 : 0) + Math.abs(dd - f * total) * 1e-5;
        if (k < kMin) { kMin = k; mejor = dm; }
      }
      const q = en(mejor), cp = crearEl(esc, 'checkpoint', q.x, q.z, { orden: i + 1, ancho: cam.ancho + 5, nombre: 'Control ' + (i + 1) });
      cp.rotY = Math.round(q.rot);
    });
    // Barreras: según el trazado (sin ponerlas en puentes ni vados) y las que pide el diseño
    const evitar = vados.map(v => [v.d - 20, v.d + 20]).concat(pasos);
    barrerasSegunTrazado(esc, c, D.barreras, evitar);
    for (const b of D.barrerasExtra || []) c.barreras.push({ tipo: b.tipo, lado: b.lado || 'ambos', desde: redondear(b.desde * total), hasta: redondear(b.hasta * total), separacion: b.separacion || 3 });
    for (const cpF of D.publico || []) c.barreras.push({ tipo: 'cinta', lado: 'ambos', desde: redondear(cpF * total - 45), hasta: redondear(cpF * total + 45), separacion: 5 });
    // Suelos, campos y vegetación
    if (D.arcenes != null) pintarArcenes(esc, c, D.arcenes, mu, D.anchoArcen || 2.2);
    for (const s of D.suelos || []) E.pintar(esc, s);
    for (const r of D.ramblas || []) { // cauces secos: una franja de grava (o el suelo que se diga) a lo largo de una línea
      for (const m of E.muestrearCamino({ puntos: r.puntos, cerrado: false }, 5)) E.pintar(esc, { x: m.x, z: m.z, radio: (r.ancho || 14) / 2, material: r.material || 9 });
    }
    for (const f of D.campos || []) pintarCampo(esc, f);
    for (const o of D.pasillos || []) pasilloBosque(esc, c, o, mu);
    for (const o of D.hileras || []) hileraArboles(esc, c, o, mu);
    for (const o of D.bosques || []) crearEl(esc, 'bosque', o.x, o.z, Object.assign({ especie: 'mixto', densidad: 6, nombre: 'Bosque' }, o));
    for (const o of D.rocas || []) crearEl(esc, 'rocas', o.x, o.z, Object.assign({ cantidad: 12, tamMin: 0.8, tamMax: 3, nombre: 'Rocas' }, o));
    for (const o of D.arboles || []) crearEl(esc, 'arbol', o.x, o.z, o);
    for (const o of D.carteles || []) { const q = en(o.en * total), s = o.lado || 1, el = crearEl(esc, 'cartel', q.x + q.nx * s * (cam.ancho / 2 + 3), q.z + q.nz * s * (cam.ancho / 2 + 3), { texto: o.texto, color: o.color || '#8b5a2b' }); el.rotY = Math.round(q.rot + 180); }
    for (const o of D.vistas || []) { const v = crearEl(esc, 'camara', o.x, o.z, { altura: o.altura || 30, inclinacion: o.inclinacion || -18, nombre: o.nombre || 'Vista' }); v.rotY = o.rotY || 0; }
    E.olvidarRango(esc);
    return { camino: c, largo: total, avisos };
  }

  // Registra un circuito diseñado como plantilla del creador
  const CIRCUITOS = {};
  function registrarCircuito(D) {
    CIRCUITOS[D.id] = D;
    E.registrarPlantilla({ id: D.id, nombre: D.nombre, icono: D.icono || '🏁', desc: D.desc, tam: D.tam || 1536, bioma: D.bioma || 'templado', disenado: true,
      aplicar(esc, rng) {
        if (D.res && esc.terreno.res !== D.res) { // resolución propia del diseño
          esc.terreno.res = D.res; const n = D.res * D.res;
          esc.terreno.alturas = new Float32Array(n); esc.terreno.materiales = new Uint8Array(n); esc.terreno.vegetacion = new Uint8Array(n);
        }
        construirCircuito(esc, D, rng);
      } });
  }

  // ---------------------------------------------------------------------------
  // 5. Los circuitos
  // ---------------------------------------------------------------------------
  // Fracciones de la vuelta (en, desde, hasta, controles) en 0–1 desde la salida. Coordenadas en metros.

  // Rally rápido de tierra: la recta de salida con salto, la subida por el flanco del cerro, el puente de piedra sobre el
  // arroyo, la recta larga que acaba en horquilla, el vado en la vaguada y la vuelta por el pueblo con su iglesia.
  registrarCircuito({
    id: 'rally_campos', nombre: 'Campos de Castilla', icono: '🌾', tam: 1536, res: 513, bioma: 'templado',
    desc: 'Tierra y grava rápidas al atardecer entre trigales y dehesa: salto en la recta de salida, cambio de rasante ciego, puente de piedra, vado en la vaguada y un pueblo blanco con su iglesia.',
    cotaNieve: 9999,
    ambiente: { hora: 16.4, niebla: 0.3, nubes: 0.35 },
    relieve: {
      base: { tipo: 'colinas', escala: 300, altura: 7, octavas: 5 },
      formas: [
        { tipo: 'inclinar', hacia: 135, pendiente: 0.02 },
        { tipo: 'colina', x: 560, z: -640, radio: 300, alto: 34 },
        { tipo: 'colina', x: -300, z: -470, rx: 90, rz: 140, alto: 9 },
        { tipo: 'colina', x: 330, z: -300, radio: 150, alto: 14 },
        { tipo: 'colina', x: -40, z: -60, rx: 260, rz: 200, giro: 20, alto: 16 },
        { tipo: 'cresta', puntos: [{ x: -170, z: -760 }, { x: -120, z: -420 }, { x: -60, z: -250 }], ancho: 55, alto: 7 },
        { tipo: 'colina', x: -480, z: 640, radio: 190, alto: 20 },
        { tipo: 'colina', x: 700, z: 600, radio: 220, alto: 26 },
        { tipo: 'vaguada', puntos: [{ x: 780, z: -300 }, { x: 560, z: -200 }, { x: 470, z: 20 }, { x: 360, z: 300 }, { x: 170, z: 560 }, { x: -120, z: 620 }, { x: -420, z: 760 }], ancho: 85, hondo: 7 }
      ]
    },
    ruta: { transicion: 22, vertices: [
      { x: -560, z: -420, r: 45 }, { x: -210, z: -455, r: 160 }, { x: 120, z: -470, r: 110 }, { x: 330, z: -380, r: 70 },
      { x: 360, z: -150, r: 40 }, { x: 240, z: -40, r: 60 }, { x: 420, z: 120, r: 150 },
      { x: 560, z: 380, r: 18 }, { x: 480, z: 470, r: 18 }, { x: 250, z: 330, r: 60 },
      { x: 60, z: 480, r: 50 }, { x: -200, z: 420, r: 90 }, { x: -330, z: 520, r: 30 },
      { x: -560, z: 360, r: 70 }, { x: -470, z: 120, r: 120 }, { x: -620, z: -120, r: 55 } ] },
    camino: { tipo: 'grava', ancho: 10, suavizado: 40, margen: 16 },
    rasante: [{ en: 0.075, alto: 2.4, largo: 26 }, { en: 0.205, alto: 1.6, largo: 40 }],
    tramos: [{ desde: 0.5, hasta: 0.66, tipo: 'tierra' }, { desde: 0.79, hasta: 0.93, tipo: 'asfalto' }, { desde: 0.6, hasta: 0.62, tipo: 'barro' }],
    rios: [{ nombre: 'Arroyo de la Vega', ancho: 6, puntos: [{ x: 780, z: -300 }, { x: 560, z: -200 }, { x: 470, z: 20 }, { x: 360, z: 300 }, { x: 170, z: 560 }, { x: -120, z: 620 }, { x: -420, z: 760 }], cruces: ['romano', 'vado'], nombrePuente: 'Puente de la Vega' }],
    pueblos: [{ en: 0.86, lado: -1, nombre: 'Villanueva del Trigo', size: 3, style: 'andaluz', casas: 'andaluza', trazado: 'adosadas', acceso: 'asfalto' }],
    controles: [0.16, 0.36, 0.55, 0.72, 0.9],
    barreras: { cerrada: 'balas_paja', rapida: 'balas_paja', caida: 'muro_piedra', salida: 'neumaticos', publi: 'valla_publi' },
    publico: [0.075, 0.45, 0.61],
    arcenes: 3,
    campos: [
      { x: -330, z: -300, ancho: 220, largo: 140, giro: 5, tipo: 'trigo', material: 2 },
      { x: 100, z: -300, ancho: 260, largo: 120, giro: -3, tipo: 'trigo', material: 2 },
      { x: -760 + 1000, z: 640, ancho: 160, largo: 120, giro: 30, tipo: 'trigo', material: 2 },
      { x: -250, z: 260, ancho: 180, largo: 160, giro: -12, tipo: 'flores', densidad: 0.5 }
    ],
    bosques: [
      { x: -60, z: 30, radio: 170, especie: 'pino_pinonero', densidad: 1.6, holgura: 6 },
      { x: 540, z: -560, radio: 200, especie: 'pino_pinonero', densidad: 2.5, holgura: 6 },
      { x: 650, z: 560, radio: 160, especie: 'mixto', densidad: 3, holgura: 6 },
      { x: -460, z: 640, radio: 130, especie: 'pino_pinonero', densidad: 2, holgura: 6 }
    ],
    hileras: [{ desde: 0.0, hasta: 0.12, lados: 'izq', especie: 'pino_pinonero', separacion: 22, distancia: 10 }],
    rocas: [{ x: 420, z: -520, radio: 60, cantidad: 30, tamMin: 1, tamMax: 4.5, piedra: 'granito', forma: 'canto' }]
  });

  // Puerto de montaña: la subida de asfalto por la ladera sur con tres horquillas encadenadas (los tramos entre ellas
  // suben en diagonal, como en los puertos de verdad), la cresta con vistas y la bajada de grava entre pinsapos, con
  // un repecho, hasta el puente medieval.
  registrarCircuito({
    id: 'rally_puerto', nombre: 'Puerto del Pinsapar', icono: '⛰', tam: 1536, res: 513, bioma: 'templado', cotaNieve: 9999,
    desc: 'Puerto de montaña: subida de asfalto con tres horquillas encadenadas, cresta con vistas, bajada de grava entre pinsapos y puente romano sobre el arroyo.',
    ambiente: { hora: 11, niebla: 0.22, nubes: 0.45 },
    relieve: {
      base: { tipo: 'colinas', escala: 240, altura: 10, octavas: 5 },
      formas: [
        { tipo: 'meseta', x: -100, z: -420, radio: 660, alto: 72, borde: 680 },
        { tipo: 'cresta', puntos: [{ x: -520, z: -260 }, { x: -150, z: -330 }, { x: 260, z: -330 }, { x: 600, z: -220 }], ancho: 110, alto: 8 },
        { tipo: 'colina', x: 640, z: -580, radio: 230, alto: 45 },
        { tipo: 'colina', x: 560, z: -60, rx: 230, rz: 300, alto: 40 },
        { tipo: 'colina', x: -640, z: -560, radio: 200, alto: 35 },
        { tipo: 'vaguada', puntos: [{ x: 200, z: -40 }, { x: 420, z: 170 }, { x: 580, z: 330 }, { x: 760, z: 560 }], ancho: 70, hondo: 8 },
        { tipo: 'colina', x: 0, z: 790, rx: 600, rz: 110, alto: 12 }
      ]
    },
    ruta: { transicion: 14, vertices: [
      { x: 300, z: 560, r: 60 }, { x: -480, z: 530, r: 50 },
      { x: -470, z: 390, r: 45 }, { x: -150, z: 330, r: 14 }, { x: -130, z: 290, r: 14 },
      { x: -440, z: 235, r: 14 }, { x: -460, z: 195, r: 14 },
      { x: -150, z: 135, r: 14 }, { x: -130, z: 95, r: 14 },
      { x: -400, z: 30, r: 60 }, { x: -320, z: -240, r: 80 }, { x: 240, z: -300, r: 120 },
      { x: 540, z: -260, r: 60 }, { x: 700, z: -70, r: 70 }, { x: 560, z: 80, r: 45 }, { x: 690, z: 250, r: 55 }, { x: 470, z: 440, r: 60 } ] },
    camino: { tipo: 'asfalto', ancho: 9.5, suavizado: 34, margen: 14 },
    rasante: [{ en: 0.955, alto: 1.6, largo: 30 }],
    tramos: [{ desde: 0.6, hasta: 0.93, tipo: 'grava' }, { desde: 0.74, hasta: 0.77, tipo: 'tierra' }],
    rios: [{ nombre: 'Arroyo del Pinsapar', ancho: 7, puntos: [{ x: 200, z: -40 }, { x: 420, z: 170 }, { x: 580, z: 330 }, { x: 760, z: 560 }], cruces: ['romano'], nombrePuente: 'Puente Romano' }],
    pueblos: [{ en: 0.05, lado: 1, nombre: 'San Bartolomé', size: 3, style: 'european', casas: 'glb', trazado: 'variado', acceso: 'asfalto' }],
    controles: [0.2, 0.36, 0.52, 0.7, 0.93],
    barreras: { cerrada: 'guardarrail', rapida: 'balas_paja', caida: 'guardarrail', salida: 'neumaticos', publi: 'valla_publi' },
    publico: [0.24, 0.31],
    arcenes: 3,
    pasillos: [{ desde: 0.62, hasta: 0.8, especie: 'pinsapo', densidad: 11, holgura: 5, radio: 40 }],
    bosques: [
      { x: -600, z: -60, radio: 160, especie: 'pinsapo', densidad: 7, holgura: 6 },
      { x: 60, z: -560, radio: 210, especie: 'pinsapo', densidad: 6, holgura: 6 },
      { x: -330, z: 330, radio: 70, especie: 'pino_pinonero', densidad: 4, holgura: 6 },
      { x: 650, z: 40, radio: 120, especie: 'mixto', densidad: 6, holgura: 6 },
      { x: -620, z: 700, radio: 140, especie: 'liquidambar', densidad: 4, holgura: 6 }
    ],
    rocas: [
      { x: -60, z: -400, radio: 70, cantidad: 40, tamMin: 1.2, tamMax: 6, piedra: 'gris', forma: 'bloque' },
      { x: 380, z: -400, radio: 50, cantidad: 25, tamMin: 1, tamMax: 5, piedra: 'gris', forma: 'losa' }
    ]
  });

  // Rally de nieve en el bosque: curvas medias enlazadas entre pinsapos, cuatro lomos largos para volar, el puente de
  // madera sobre el río que baja al lago y, al otro lado de la vuelta, el mismo río cruzado por un vado.
  registrarCircuito({
    id: 'rally_boreal', nombre: 'Bosque Boreal', icono: '🌲', tam: 1536, res: 513, bioma: 'nevado',
    desc: 'Nieve entre pinsapos con curvas enlazadas y cuatro cambios de rasante para volar, la orilla de un lago, un puente de madera, un vado helado y una aldea nórdica.',
    ambiente: { hora: 12.5, niebla: 0.42, nubes: 0.7 },
    relieve: {
      base: { tipo: 'colinas', escala: 170, altura: 12, octavas: 5 },
      formas: [
        { tipo: 'colina', x: 300, z: -250, rx: 260, rz: 180, giro: 30, alto: 22 },
        { tipo: 'colina', x: -300, z: -150, radio: 180, alto: 16 },
        { tipo: 'colina', x: 120, z: 650, rx: 400, rz: 140, alto: 18 },
        { tipo: 'colina', x: 100, z: 360, radio: 170, alto: -10 },
        { tipo: 'vaguada', puntos: [{ x: -60, z: -780 }, { x: -120, z: -520 }, { x: -80, z: -300 }, { x: 20, z: -60 }, { x: 60, z: 150 }, { x: 100, z: 300 }], ancho: 60, hondo: 5 }
      ]
    },
    ruta: { transicion: 20, vertices: [
      { x: -560, z: 260, r: 40 }, { x: -250, z: 210, r: 120 }, { x: 60, z: 230, r: 70 }, { x: 300, z: 160, r: 50 },
      { x: 420, z: 300, r: 35 }, { x: 600, z: 260, r: 60 }, { x: 620, z: 40, r: 90 }, { x: 480, z: -120, r: 45 },
      { x: 580, z: -300, r: 40 }, { x: 420, z: -480, r: 70 }, { x: 150, z: -420, r: 55 }, { x: 40, z: -560, r: 35 },
      { x: -200, z: -480, r: 80 }, { x: -260, z: -260, r: 45 }, { x: -450, z: -320, r: 50 }, { x: -620, z: -120, r: 70 },
      { x: -480, z: 60, r: 45 } ] },
    camino: { tipo: 'nieve', ancho: 9.5, suavizado: 34, margen: 14 },
    rasante: [{ en: 0.2, alto: 2.6, largo: 48 }, { en: 0.37, alto: 2.2, largo: 44 }, { en: 0.585, alto: 2.8, largo: 50 }, { en: 0.82, alto: 2.0, largo: 44 }],
    tramos: [{ desde: 0.44, hasta: 0.52, tipo: 'grava' }],
    rios: [{ nombre: 'Río Helado', ancho: 7, puntos: [{ x: -60, z: -780 }, { x: -120, z: -520 }, { x: -80, z: -300 }, { x: 20, z: -60 }, { x: 60, z: 150 }, { x: 100, z: 300 }], cruces: ['madera', 'vado'], nombrePuente: 'Puente de Madera' }],
    lagos: [{ x: 100, z: 380, radio: 120, nombre: 'Lago del Norte', forma: 11 }],
    pueblos: [{ x: 300, z: -80, nombre: 'Kallio', size: 2, style: 'nordic', casas: 'glb', trazado: 'variado', acceso: 'nieve', arboles: 40 }],
    controles: [0.15, 0.33, 0.5, 0.7, 0.86],
    barreras: { cerrada: 'balas_paja', rapida: null, caida: 'valla_madera', salida: 'neumaticos', publi: 'valla_publi' },
    publico: [0.2, 0.585],
    pasillos: [
      { desde: 0.14, hasta: 0.46, especie: 'pinsapo', densidad: 12, holgura: 4, radio: 40 },
      { desde: 0.52, hasta: 0.88, especie: 'pinsapo', densidad: 12, holgura: 4, radio: 40 }
    ],
    bosques: [
      { x: -560, z: 560, radio: 150, especie: 'pinsapo', densidad: 8, holgura: 6 },
      { x: 560, z: 600, radio: 170, especie: 'pinsapo', densidad: 7, holgura: 6 },
      { x: 0, z: -200, radio: 150, especie: 'mixto', densidad: 7, holgura: 6 },
      { x: 650, z: -620, radio: 160, especie: 'pinsapo', densidad: 7, holgura: 6 }
    ],
    rocas: [{ x: 300, z: -250, radio: 50, cantidad: 25, tamMin: 1, tamMax: 4, piedra: 'granito', forma: 'canto' }]
  });

  // Desierto: tres saltos en las dunas de la recta de salida, la vuelta al oasis con su poblado, el paso entre dos
  // mesetas de paredes de roca (el cañón) y la rambla seca que cruza dos veces.
  registrarCircuito({
    id: 'rally_tabernas', nombre: 'Rambla de Tabernas', icono: '🏜', tam: 1536, res: 513, bioma: 'desierto', cotaNieve: 9999,
    desc: 'Desierto al caer la tarde: dunas con saltos, el cañón entre dos mesetas de paredes de roca, la rambla seca y un oasis con palmeras junto al poblado.',
    ambiente: { hora: 17.0, niebla: 0.22, nubes: 0.15 },
    hierbaAuto: 0.15,
    relieve: {
      base: { tipo: 'dunas', escala: 220, altura: 7, octavas: 4 },
      formas: [
        { tipo: 'meseta', x: -390, z: -320, radio: 190, alto: 36, borde: 34 },
        { tipo: 'meseta', x: 260, z: -250, rx: 160, rz: 130, radio: 150, alto: 30, borde: 30 },
        { tipo: 'meseta', x: 560, z: -600, radio: 150, alto: 44, borde: 40 },
        { tipo: 'colina', x: 0, z: 700, rx: 700, rz: 160, alto: 10 },
        { tipo: 'vaguada', puntos: [{ x: -60, z: -760 }, { x: -90, z: -420 }, { x: -110, z: -150 }, { x: -40, z: 120 }, { x: 80, z: 400 }, { x: 160, z: 760 }], ancho: 60, hondo: 4 }
      ]
    },
    ruta: { transicion: 20, vertices: [
      { x: -560, z: 480, r: 60 }, { x: 120, z: 560, r: 140 }, { x: 520, z: 500, r: 50 }, { x: 620, z: 220, r: 80 },
      { x: 450, z: 20, r: 45 }, { x: 560, z: -250, r: 60 }, { x: 300, z: -480, r: 90 }, { x: -50, z: -420, r: 40 },
      { x: -120, z: -150, r: 110 }, { x: 60, z: 80, r: 55 }, { x: -150, z: 260, r: 40 }, { x: -420, z: 180, r: 70 },
      { x: -640, z: -60, r: 90 } ] },
    camino: { tipo: 'arena', ancho: 11, suavizado: 36, margen: 14 },
    rasante: [{ en: 0.06, alto: 2.4, largo: 40 }, { en: 0.1, alto: 2.0, largo: 36 }, { en: 0.14, alto: 2.6, largo: 44 }, { en: 0.66, alto: 1.8, largo: 34 }],
    tramos: [{ desde: 0.3, hasta: 0.56, tipo: 'tierra' }, { desde: 0.56, hasta: 0.7, tipo: 'grava' }, { desde: 0.86, hasta: 0.96, tipo: 'tierra' }],
    lagos: [{ x: 430, z: 240, radio: 55, nombre: 'Oasis', forma: 23 }],
    pueblos: [{ x: 215, z: 350, nombre: 'Aldea del Oasis', size: 2, style: 'desert', casas: 'original', trazado: 'variado', acceso: 'tierra', arboles: 20 }],
    controles: [0.14, 0.32, 0.5, 0.68, 0.86],
    barreras: { cerrada: 'neumaticos', rapida: 'balas_paja', caida: 'muro', salida: 'neumaticos', publi: 'valla_publi' },
    publico: [0.1, 0.58],
    ramblas: [{ puntos: [{ x: -60, z: -760 }, { x: -90, z: -420 }, { x: -110, z: -150 }, { x: -40, z: 120 }, { x: 80, z: 400 }, { x: 160, z: 760 }], ancho: 22, material: 9 }],
    bosques: [
      { x: 450, z: 230, radio: 85, especie: 'palmera_datilera', densidad: 5, holgura: 6, rocas: 0 },
      { x: -620, z: 640, radio: 120, especie: 'cactus', densidad: 1.5, holgura: 4 },
      { x: 640, z: 640, radio: 120, especie: 'cactus', densidad: 1.2, holgura: 4 }
    ],
    rocas: [
      { x: -180, z: -300, radio: 40, cantidad: 18, tamMin: 2, tamMax: 7, piedra: 'ocre', forma: 'aguja' },
      { x: 100, z: -330, radio: 40, cantidad: 16, tamMin: 2, tamMax: 6, piedra: 'ocre', forma: 'aguja' },
      { x: -560, z: -120, radio: 60, cantidad: 25, tamMin: 1.5, tamMax: 6, piedra: 'ocre', forma: 'bloque' },
      { x: 420, z: -120, radio: 40, cantidad: 14, tamMin: 1.5, tamMax: 5, piedra: 'ocre', forma: 'partida' }
    ],
    arboles: [{ x: 500, z: 330, especie: 'palmera_datilera' }, { x: 380, z: 150, especie: 'palmera_datilera' }]
  });

  // Costa: la recta de salida al borde del acantilado (guardarraíl donde cae al mar), la bajada por el valle costero
  // hasta el barranco del río, que se cruza por el puente de hierro sobre la cala, y la vuelta tierra adentro por grava
  // entre pinos piñoneros, con el pueblo blanco en la meseta.
  registrarCircuito({
    id: 'rally_acantilados', nombre: 'Costa de los Acantilados', icono: '🌊', tam: 1536, res: 513, bioma: 'templado', cotaNieve: 9999,
    agua: { activa: true, nivel: 0, color: '#2a7f9e' }, bordes: 'infinito',
    desc: 'Asfalto al borde del acantilado sobre el mar, bajada en curvas cerradas a una cala con su pueblo blanco, puente de hierro en la desembocadura y subida por grava entre pinos.',
    ambiente: { hora: 13, niebla: 0.18, nubes: 0.3 },
    relieve: {
      base: { tipo: 'colinas', escala: 230, altura: 9, octavas: 5, base: -6 },
      minimo: 2.5,
      formas: [
        { tipo: 'meseta', x: 0, z: -500, rx: 1100, rz: 760, radio: 760, alto: 40, borde: 160 },
        { tipo: 'colina', x: 330, z: 330, rx: 900, rz: 450, alto: -34 },
        { tipo: 'colina', x: 330, z: 420, rx: 260, rz: 200, alto: -10 },
        { tipo: 'colina', x: -250, z: -620, rx: 380, rz: 220, alto: 34 },
        { tipo: 'colina', x: 620, z: -560, radio: 220, alto: 26 },
        { tipo: 'vaguada', puntos: [{ x: 420, z: -760 }, { x: 390, z: -400 }, { x: 360, z: -50 }, { x: 340, z: 200 }, { x: 330, z: 420 }], ancho: 80, hondo: 12 }
      ]
    },
    ruta: { transicion: 18, vertices: [
      { x: -600, z: 60, r: 60 }, { x: -260, z: 160, r: 150 }, { x: -20, z: 170, r: 90 }, { x: 170, z: 245, r: 70 },
      { x: 330, z: 255, r: 80 }, { x: 480, z: 225, r: 60 }, { x: 570, z: 120, r: 70 }, { x: 640, z: -60, r: 70 }, { x: 620, z: -150, r: 90 },
      { x: 420, z: -380, r: 55 }, { x: 120, z: -300, r: 80 }, { x: -150, z: -470, r: 45 }, { x: -420, z: -360, r: 70 },
      { x: -560, z: -120, r: 60 } ] },
    camino: { tipo: 'asfalto', ancho: 9.5, bordes: true, suavizado: 36, margen: 14 },
    rasante: [{ en: 0.78, alto: 1.6, largo: 34 }],
    tramos: [{ desde: 0.56, hasta: 0.84, tipo: 'grava' }],
    rios: [{ nombre: 'Río de la Cala', ancho: 8, puntos: [{ x: 420, z: -760 }, { x: 390, z: -400 }, { x: 360, z: -50 }, { x: 340, z: 200 }, { x: 330, z: 420 }], cruces: ['riotinto', 'romano'], nombrePuente: 'Puente de la Cala' }],
    pueblos: [{ x: -300, z: -150, nombre: 'Cala Blanca', size: 2, style: 'andaluz', casas: 'andaluza', trazado: 'adosadas', acceso: 'asfalto', arboles: 30 }],
    controles: [0.18, 0.33, 0.5, 0.68, 0.86],
    barreras: { cerrada: 'muro_piedra', rapida: null, caida: 'guardarrail', salida: 'neumaticos', publi: 'valla_publi' },
    publico: [0.27],
    arcenes: 2,
    bosques: [
      { x: -250, z: -560, radio: 200, especie: 'pino_pinonero', densidad: 5, holgura: 6 },
      { x: 620, z: -520, radio: 170, especie: 'pino_pinonero', densidad: 5, holgura: 6 },
      { x: 150, z: -560, radio: 120, especie: 'mixto', densidad: 5, holgura: 6 },
      { x: 330, z: 330, radio: 60, especie: 'palmera_datilera', densidad: 4, holgura: 5, rocas: 0 }
    ],
    rocas: [
      { x: -300, z: 300, radio: 60, cantidad: 30, tamMin: 1.5, tamMax: 6, piedra: 'estratos', forma: 'bloque' },
      { x: 600, z: 240, radio: 50, cantidad: 24, tamMin: 1.5, tamMax: 5, piedra: 'estratos', forma: 'losa' }
    ]
  });

  Object.assign(E, { trazarRuta, curvaturas, modelarTerreno, barrerasSegunTrazado, construirCircuito, registrarCircuito, CIRCUITOS });
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
})(typeof window !== 'undefined' ? window : globalThis);
