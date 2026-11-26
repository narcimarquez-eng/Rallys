// Pruebas sin navegador: la pista, la física y el cronómetro con el escenario de ejemplo de Mundos-.
// npm test  (o node --test test/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Pista } from '../juego/pista.js';
import { Coche } from '../juego/coche.js';
import { Obstaculos } from '../juego/obstaculos.js';
import { Cronometro } from '../juego/cronometro.js';

globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } };
const E = createRequire(import.meta.url)('../vendor/mundos/js/escenario-core.js');
const esc = E.crear({ plantilla: 'rally', semilla: 4242 });
const pista = new Pista(E, esc);
// medidas del «Urban Speedster» de Hacer coches
const MEDIDAS = { ejeDel: 1.38, ejeTras: -1.3, batalla: 2.68, via: 1.7, radio: 0.41, largo: 3.9, ancho: 1.85, alto: 1.5, zCentro: 0.05, techo: 1.5 };

// Piloto automático: apunta a un punto de la pista unos metros por delante y regula la velocidad en las curvas
function piloto(coche, p, d) {
  const v = coche.velocidad, mira = 9 + v * 0.7;
  const q = pista.puntoEn(p, d + mira);
  const ang = Math.atan2(q.x - coche.x, q.z - coche.z);
  let dif = ang - coche.rumbo; while (dif > Math.PI) dif -= 2 * Math.PI; while (dif < -Math.PI) dif += 2 * Math.PI;
  // curva que viene: ángulo entre la dirección ahora y 40 m más adelante
  const a = pista.puntoEn(p, d), b = pista.puntoEn(p, d + 30 + v);
  const curva = Math.acos(Math.max(-1, Math.min(1, a.dx * b.dx + a.dz * b.dz)));
  const vObj = Math.max(9, 30 - curva * 38);
  return { gas: v < vObj ? 1 : 0, freno: v > vObj + 3 ? 0.6 : 0, giro: Math.max(-1, Math.min(1, -dif * 2.2)), manoFreno: false, analogico: true };
}

test('la pista sabe qué hay bajo cada punto', () => {
  const p = pista.caminos[0];
  const q = pista.puntoEn(p, 100);
  const c = pista.consultar(q.x, q.z);
  assert.ok(c.camino, 'en el camino');
  assert.ok(Math.abs(c.y - (E.alturaEn(esc, q.x, q.z) + 0.14)) < 0.05, 'la calzada va sobre el terreno');
  const tr = p.c.tramos.find(t => t.tipo === 'asfalto');
  const qa = pista.puntoEn(p, (tr.desde + tr.hasta) / 2);
  assert.equal(pista.consultar(qa.x, qa.z).tipo, 'asfalto');
  const b = p.puentes[0];
  assert.ok(b, 'hay un puente en la pista');
  const qb = pista.puntoEn(p, b.d), cb = pista.consultar(qb.x, qb.z);
  assert.ok(cb.puente, 'sobre el tablero');
  assert.equal(cb.agua, 0, 'sin agua sobre el puente');
  assert.ok(cb.y > E.alturaEn(esc, qb.x, qb.z) + 1.5, 'el tablero va por encima del cauce');
});

test('una vuelta completa con el piloto automático: controles en orden, puente y meta', () => {
  const p = pista.caminos[0];
  const coche = new Coche(pista, MEDIDAS, { masa: 1150, potencia: 200 });
  const obs = new Obstaculos(E, esc, pista);
  const ini = esc.elementos.find(e => e.tipo === 'inicio');
  coche.reiniciar(ini.x, ini.z, ini.rotY * Math.PI / 180);
  const crono = new Cronometro(esc, pista, 1, 'prueba');
  crono.empezar();
  const dt = 1 / 120;
  let d = pista.proyectar(p, coche.x, coche.z).d, vMax = 0, sobrePuente = false, alturaPuente = 0, golpes = 0, superficies = new Set();
  const eventos = [];
  for (let k = 0; k < 120 * 400 && crono.estado !== 'fin'; k++) {
    const px = coche.x, pz = coche.z;
    coche.paso(dt, piloto(coche, p, d), obs);
    crono.actualizar(dt, px, pz, coche.x, coche.z);
    eventos.push(...crono.eventos.map(e => e.tipo + (e.n || '')));
    const pr = pista.proyectar(p, coche.x, coche.z, 30);
    if (pr) d = pr.d;
    assert.ok(Number.isFinite(coche.x + coche.z + coche.y + coche.rumbo), 'sin NaN');
    vMax = Math.max(vMax, coche.velocidad);
    golpes += coche.impactos.length;
    for (const w of coche.ruedas) superficies.add(w.sup);
    const q = pista.consultar(coche.x, coche.z);
    if (q.puente) { sobrePuente = true; alturaPuente = Math.max(alturaPuente, coche.y - E.alturaEn(esc, coche.x, coche.z)); }
  }
  console.log(`  vuelta: ${crono.t.toFixed(1)} s · v máx ${(vMax * 3.6).toFixed(0)} km/h · golpes ${golpes} · superficies ${[...superficies].join(', ')} · altura sobre el cauce en el puente ${alturaPuente.toFixed(1)} m`);
  console.log('  eventos:', eventos.join(' '));
  assert.equal(crono.estado, 'fin', 'llega a la meta');
  assert.deepEqual(eventos.filter(e => e.startsWith('control')), ['control1', 'control2', 'control3', 'control4', 'control5']);
  assert.ok(sobrePuente && alturaPuente > 1, 'cruza el puente por encima');
  assert.ok(vMax * 3.6 > 90, 'corre');
  assert.ok(superficies.has('asfalto') && superficies.has('grava') && superficies.has('piedra'), 'pasa por asfalto, grava y el pueblo');
});

test('el coche choca con una barrera y no la atraviesa', () => {
  const p = pista.caminos[0];
  const b = p.c.barreras.find(x => x.tipo === 'guardarrail');
  const dm = (b.desde + b.hasta) / 2, q = pista.puntoEn(p, dm);
  const coche = new Coche(pista, MEDIDAS, {});
  const obs = new Obstaculos(E, esc, pista);
  // cruzado, mirando hacia el lado izquierdo del camino
  const nx = -q.dz, nz = q.dx; // izquierda del sentido del camino: (−dz, dx)
  coche.reiniciar(q.x, q.z, Math.atan2(nx, nz));
  let maxLat = 0, golpes = 0;
  for (let k = 0; k < 120 * 4; k++) {
    coche.paso(1 / 120, { gas: 1, freno: 0, giro: 0, manoFreno: false }, obs);
    golpes += coche.impactos.length;
    const pr = pista.proyectar(p, coche.x, coche.z, 20);
    maxLat = Math.max(maxLat, pr.dist);
  }
  const linea = p.c.ancho / 2 + b.separacion;
  console.log(`  distancia máxima al eje ${maxLat.toFixed(2)} m (barrera a ${linea} m), golpes ${golpes}`);
  assert.ok(golpes > 0, 'hay choque');
  assert.ok(maxLat + MEDIDAS.largo / 2 < linea + 0.3, 'no la atraviesa (con el morro)');
});
