// Manejo: con las ayudas (altas y medias) ningún coche hace un trompo en maniobras normales con el teclado
// (golpe de volante, eslalon y frenar en plena curva) en asfalto, grava y nieve, a 60 y 100 km/h.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Coche, AYUDAS } from '../juego/coche.js';

const COCHES = JSON.parse(fs.readFileSync(new URL('../coches/indice.json', import.meta.url), 'utf8'));
const M = { ejeDel: 1.38, ejeTras: -1.3, batalla: 2.68, via: 1.7, radio: 0.36, largo: 4.1, ancho: 1.85, alto: 1.45, zCentro: 0.05, techo: 1.45 };
const dt = 1 / 120;
const plana = tipo => ({ esc: { terreno: { tam: 1e5 } }, consultar: () => ({ y: 0, suelo: 0, tipo, agua: 0, camino: null }) });
// el giro del teclado (controles.js): sube a 4,5/s (9/s al cambiar de lado) y vuelve a 8/s
const teclado = (e, obj) => { const vel = obj === 0 ? 8 : (Math.sign(obj) !== Math.sign(e.g) && e.g !== 0 ? 9 : 4.5); e.g += Math.max(-vel * dt, Math.min(vel * dt, obj - e.g)); return e.g; };
function maniobra(datos, ayudas, tipo, kmh, fn, seg) {
  const c = new Coche(plana(tipo), M, Object.assign({}, datos, { ayudas }));
  c.reiniciar(0, 0, 0);
  const v = kmh / 3.6;
  for (let k = 0; k < 120 * 30 && c.velocidad < v; k++) c.paso(dt, { gas: 1, freno: 0, giro: 0 });
  let beta = 0; const e = { g: 0 };
  for (let k = 0; k < seg * 120; k++) {
    c.paso(dt, fn(k / 120, c, e, v));
    const sn = Math.sin(c.rumbo), cs = Math.cos(c.rumbo), vL = c.vx * sn + c.vz * cs, vT = c.vx * cs - c.vz * sn;
    if (c.velocidad > 3) beta = Math.max(beta, Math.abs(Math.atan2(vT, Math.abs(vL))), vL < -1 ? Math.PI : 0);
  }
  return beta * 180 / Math.PI;
}
const MANIOBRAS = {
  golpe: (t, c, e, v) => ({ gas: c.velocidad < v ? 0.6 : 0, freno: 0, giro: teclado(e, t < 1.2 ? 1 : 0) }),
  eslalon: (t, c, e, v) => ({ gas: c.velocidad < v ? 0.6 : 0, freno: 0, giro: teclado(e, Math.floor(t / 0.8) % 2 ? -1 : 1) }),
  frenarEnCurva: (t, c, e) => ({ gas: t < 1 ? 1 : 0, freno: t > 1 && t < 1.6 ? 0.6 : 0, giro: teclado(e, 1) })
};

for (const [ayudas, maximo] of [['altas', 25], ['medias', 40]]) {
  test(`ayudas ${ayudas}: sin trompos (derrape de ${maximo}° como mucho)`, () => {
    for (const c of COCHES) for (const tipo of ['asfalto', 'grava', 'nieve']) for (const kmh of [60, 100]) for (const [n, fn] of Object.entries(MANIOBRAS)) {
      const b = maniobra(c.datos, ayudas, tipo, kmh, fn, n === 'eslalon' ? 4 : 3);
      assert.ok(b < maximo, `${c.id} · ${tipo} · ${kmh} km/h · ${n}: derrape de ${b.toFixed(0)}°`);
    }
  });
}

test('las ayudas existen y «no» las quita todas', () => {
  assert.deepEqual(Object.keys(AYUDAS).sort(), ['altas', 'medias', 'no']);
  assert.equal(AYUDAS.no.esc, 0); assert.equal(AYUDAS.no.tc, 0);
});
