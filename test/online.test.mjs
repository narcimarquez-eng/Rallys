// Fantasmas (codificar/decodificar) y clasificación online contra un Supabase simulado (PostgREST en memoria)
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
const { Grabadora, codificar, decodificar, estadoEn, HZ } = await import('../juego/fantasma.js');
const C = await import('../juego/clasificacion.js');

// Una vuelta inventada: un círculo de 300 m de radio en 60 s, subiendo y bajando, con algo de balanceo
function vueltaDePrueba(seg) {
  const g = new Grabadora(), coche = {};
  for (let k = 0; k <= seg * 120; k++) {
    const t = k / 120, a = t / seg * 2 * Math.PI;
    Object.assign(coche, { x: 100 + Math.cos(a) * 300, z: -50 + Math.sin(a) * 300, y: 12 + Math.sin(a * 3) * 4, rumbo: a + Math.PI / 2, cab: 0.02 * Math.sin(t), bal: -0.04 * Math.cos(t), giro: 0.1 });
    g.paso(t, coche);
  }
  return g.cerrar(seg);
}

test('fantasma: 20 muestras por segundo, y se codifica y decodifica sin perder precisión', async () => {
  const v = vueltaDePrueba(60);
  assert.equal(v.muestras.length, 60 * HZ + 1);
  const texto = await codificar(v, { piloto: 'Ana', coche: 'retro', parciales: [10, 20] });
  assert.ok(texto.startsWith('R1:gz:'), 'comprimido');
  console.log(`  1 minuto de vuelta → ${(texto.length / 1024).toFixed(1)} KB de texto`);
  assert.ok(texto.length < 40000, 'pequeño');
  const f = await decodificar(texto);
  assert.equal(f.datos.piloto, 'Ana'); assert.deepEqual(f.datos.parciales, [10, 20]);
  assert.equal(f.duracion, 60);
  let peor = 0, peorAng = 0;
  for (let k = 0; k < v.muestras.length; k++) {
    const e = estadoEn(f, k / HZ), m = v.muestras[k];
    peor = Math.max(peor, Math.hypot(e[0] - m[0], e[1] - m[1], e[2] - m[2]));
    let da = e[3] - m[3]; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    peorAng = Math.max(peorAng, Math.abs(da), Math.abs(e[5] - m[5]));
  }
  assert.ok(peor < 0.02, 'posición a menos de 2 cm: ' + peor);
  assert.ok(peorAng < 0.001, 'ángulos a menos de una milésima: ' + peorAng);
  assert.equal(estadoEn(f, 61), null, 'acabada la vuelta, no se ve');
});

test('clasificación local: solo se guarda tu mejor vuelta de cada circuito y versión', () => {
  assert.equal(C.guardarLocal({ escenario: 'campos', version: 'v1', tiempo: 200, fantasma: 'a' }), true);
  assert.equal(C.guardarLocal({ escenario: 'campos', version: 'v1', tiempo: 210, fantasma: 'b' }), false);
  assert.equal(C.guardarLocal({ escenario: 'campos', version: 'v1', tiempo: 190, fantasma: 'c' }), true);
  assert.equal(C.mejorLocal('campos', 'v1').fantasma, 'c');
  assert.equal(C.mejorLocal('campos', 'v2'), null, 'otra versión del circuito no vale');
});

test('clasificación online contra un Supabase simulado: subir, ver el puesto y bajar el fantasma', async () => {
  assert.equal(C.configOnline(), null, 'sin configurar no hay online');
  const filas = [];
  let id = 1;
  globalThis.fetch = async (url, op) => {
    const u = new URL(url);
    assert.equal(u.pathname, '/rest/v1/vueltas');
    assert.equal(op.headers.apikey, 'clave-anon'); assert.equal(op.headers.Authorization, 'Bearer clave-anon');
    const filtro = f => [...u.searchParams].every(([k, v]) => !v.startsWith('eq.') || String(f[k]) === v.slice(3));
    if (op.method === 'POST') { const f = Object.assign({ id: id++, creado: new Date().toISOString() }, JSON.parse(op.body)); filas.push(f); return new Response(JSON.stringify([{ id: f.id }]), { status: 201 }); }
    const sel = u.searchParams.get('select').split(',');
    let out = filas.filter(filtro);
    if (u.searchParams.get('order') === 'tiempo.asc') out.sort((a, b) => a.tiempo - b.tiempo);
    return new Response(JSON.stringify(out.map(f => Object.fromEntries(sel.map(k => [k, f[k]])))), { status: 200 });
  };
  localStorage.setItem('rallys.online', JSON.stringify({ url: 'https://prueba.supabase.co/', clave: 'clave-anon' }));
  assert.deepEqual(C.configOnline(), { url: 'https://prueba.supabase.co', clave: 'clave-anon' });
  const base = { escenario: 'campos', version: 'v1', coche: 'retro', coche_nombre: 'Hatch', fantasma: 'R1:raw:' };
  await C.subirVuelta(Object.assign({}, base, { piloto: 'Ana', tiempo: 201.5 }));
  await C.subirVuelta(Object.assign({}, base, { piloto: 'Luis', tiempo: 195.2 }));
  await C.subirVuelta(Object.assign({}, base, { piloto: 'ana', tiempo: 199.1 })); // Ana mejora: se queda la mejor
  await C.subirVuelta(Object.assign({}, base, { piloto: 'Eva', tiempo: 180, version: 'v0' })); // otra versión
  const lista = await C.clasificacion('campos', 'v1');
  assert.deepEqual(lista.map(f => [f.piloto, f.tiempo]), [['Luis', 195.2], ['ana', 199.1]], 'una por piloto, ordenada');
  assert.ok(!('fantasma' in lista[0]), 'la lista no trae los fantasmas (pesan)');
  const f = await C.fantasmaOnline(lista[0].id);
  assert.equal(f.piloto, 'Luis'); assert.equal(f.fantasma, 'R1:raw:');
  localStorage.removeItem('rallys.online');
});
