// Carreras en grupo: la sala (con un Supabase Realtime simulado en memoria) y el orden de los pilotos
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sala, codigoNuevo, normalizarCodigo } from '../juego/sala.js';
import { ordenar, ESTADO } from '../juego/rivales.js';

// Realtime simulado: canales con presencia y mensajes, compartidos por todos los clientes
function realtimeSimulado() {
  const canales = new Map(); // nombre → { presencia: Map key → meta, miembros: Set }
  return {
    canales,
    createClient() {
      return {
        channel(nombre, opciones) {
          const c = canales.get(nombre) || { presencia: new Map(), miembros: new Set() };
          canales.set(nombre, c);
          const key = opciones.config.presence.key, oyentes = [];
          const yo = {
            on(tipo, filtro, fn) { oyentes.push({ tipo, ev: filtro.event, fn }); return yo; },
            subscribe(cb) { c.miembros.add(yo); setTimeout(() => cb('SUBSCRIBED'), 1); return yo; },
            async track(meta) { c.presencia.set(key, { ...meta }); for (const m of c.miembros) m._disparar('presence', 'sync'); },
            async untrack() { c.presencia.delete(key); for (const m of c.miembros) m._disparar('presence', 'sync'); },
            async send(msg) { for (const m of c.miembros) if (m !== yo) m._disparar('broadcast', msg.event, { payload: msg.payload }); return 'ok'; },
            presenceState() { return Object.fromEntries([...c.presencia].map(([k, v]) => [k, [v]])); },
            _disparar(tipo, ev, datos) { for (const o of oyentes) if (o.tipo === tipo && o.ev === ev) o.fn(datos); }
          };
          return yo;
        },
        async removeChannel(ch) { for (const c of canales.values()) c.miembros.delete(ch); }
      };
    }
  };
}
const espera = ms => new Promise(r => setTimeout(r, ms));

test('códigos de sala: 4 caracteres sin letras que se confunden, y se normalizan', () => {
  for (let k = 0; k < 200; k++) assert.match(codigoNuevo(), /^[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(normalizarCodigo(' rx-7k '), 'RX7K');
});

test('sala: se ven todos, el anfitrión es el primero en llegar (y si se va, el siguiente) y las órdenes llegan', async () => {
  const rt = realtimeSimulado(), cfg = { url: 'https://x.supabase.co', clave: 'k' };
  const op = { directa: false, cargarCliente: async () => rt };
  const ana = new Sala(cfg, { id: 'a1', nombre: 'Ana', desde: 1000 }, op);
  const luis = new Sala(cfg, { id: 'b2', nombre: 'Luis', desde: 2000 }, op);
  const marta = new Sala(cfg, { id: 'c3', nombre: 'Marta', desde: 3000 }, op);
  await ana.entrar('ab12'); await luis.entrar('AB12'); await marta.entrar('AB12');
  await espera(10);
  for (const s of [ana, luis, marta]) { assert.equal(s.pilotos.size, 3); assert.equal(s.anfitrion.id, 'a1'); }
  assert.ok(ana.soyAnfitrion && !luis.soyAnfitrion);
  const recibidos = [];
  luis.on('mensaje', (t, d, de) => recibidos.push([t, d, de]));
  ana.enviar('cargar', { carrera: 'x' });
  await espera(5);
  assert.deepEqual(recibidos, [['cargar', { carrera: 'x' }, 'a1']]);
  // publicar varias veces seguidas: a Supabase solo le llega lo último (y no más de una vez cada 400 ms)
  luis.publicar({ fase: 'cargando' }); luis.publicar({ fase: 'listo' }); luis.publicar({ fase: 'carrera' });
  assert.equal(luis.pilotos.get('b2').fase, 'carrera'); // en local, al momento
  await espera(450);
  assert.equal(ana.pilotos.get('b2').fase, 'carrera');
  await ana.salir(); await espera(10);
  assert.equal(luis.pilotos.size, 2); assert.equal(luis.anfitrion.id, 'b2'); assert.ok(luis.soyAnfitrion);
  await luis.salir(); await marta.salir();
});

test('sala sin conexión directa: la posición va por el servidor, como mucho 5 veces por segundo', async () => {
  const rt = realtimeSimulado(), cfg = { url: 'https://x.supabase.co', clave: 'k' };
  const op = { directa: false, cargarCliente: async () => rt };
  const a = new Sala(cfg, { id: 'a', nombre: 'A' }, op), b = new Sala(cfg, { id: 'b', nombre: 'B' }, op);
  await a.entrar('ZZZZ'); await b.entrar('ZZZZ'); await espera(10);
  assert.equal(a.red('b'), 'servidor');
  const llegan = [];
  b.on('estado', (id, v, via) => llegan.push([id, v[ESTADO.x], via]));
  const v = new Float32Array(ESTADO.n);
  for (let k = 0; k < 10; k++) { v[ESTADO.x] = k + 0.25; a.enviarEstado(v); }
  await espera(5);
  assert.deepEqual(llegan, [['a', 0.25, 'servidor']]);
  await espera(210); v[ESTADO.x] = 42; a.enviarEstado(v); await espera(5);
  assert.deepEqual(llegan[1], ['a', 42, 'servidor']);
  await a.salir(); await b.salir();
});

test('puestos: primero los que han llegado (por tiempo), luego por lo recorrido', () => {
  const o = ordenar([
    { id: 'a', prog: 300000 }, { id: 'b', total: 210.5, prog: 1e9 }, { id: 'c', prog: 299990 },
    { id: 'd', total: 200.1, prog: 1e9 }, { id: 'e' }
  ]).map(x => x.id);
  assert.deepEqual(o, ['d', 'b', 'a', 'c', 'e']);
});
