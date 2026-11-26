// Clasificación y fantasmas de cada circuito.
//  · Local (siempre): tu mejor vuelta de cada circuito, con su fantasma, en el navegador.
//  · Online (si está configurada, ver docs/ONLINE.md): una tabla «vueltas» en Supabase, a la que se habla con su API
//    REST (PostgREST) con la clave pública «anon». Cualquiera puede leer la clasificación y subir vueltas; nadie puede
//    cambiar ni borrar las de otros (lo deciden las reglas de la tabla, en online/supabase.sql).
//
// Un circuito se identifica por su id en el menú (escenarios/indice.json) y por una «versión»: una huella del trazado.
// Si el circuito cambia (otra versión de Mundos-), la clasificación vieja no se mezcla con la nueva.
import { ONLINE } from './online.config.js';

const CLAVE_LOCAL = 'rallys.fantasmas';

// Huella del trazado del circuito (el camino principal): cambia si cambia la carretera
export function versionEscenario(E, esc) {
  const c = esc.caminos.find(x => !E.esRio(x) && x.cerrado) || esc.caminos.find(x => !E.esRio(x));
  const txt = c ? JSON.stringify(c.puntos.map(p => [Math.round(p.x * 10), Math.round(p.z * 10)])) + c.ancho : esc.id;
  return E.hashTexto(txt).toString(36);
}

// Configuración: la de online.config.js o, para pruebas, la guardada en el navegador (localStorage «rallys.online»)
export function configOnline() {
  let c = ONLINE;
  try { const o = JSON.parse(localStorage.getItem('rallys.online') || 'null'); if (o && o.url) c = o; } catch (e) { /* nada */ }
  return c && c.url && c.clave ? { url: c.url.replace(/\/+$/, ''), clave: c.clave } : null;
}

// --- Local ---
function leerLocal() { try { return JSON.parse(localStorage.getItem(CLAVE_LOCAL) || '{}'); } catch (e) { return {}; } }
export function mejorLocal(escenario, version) {
  const r = leerLocal()[escenario];
  return r && r.version === version ? r : null;
}
// Guarda la vuelta si es tu mejor en ese circuito (y esa versión). Devuelve true si lo era.
export function guardarLocal(reg) {
  const todo = leerLocal(), ant = todo[reg.escenario];
  if (ant && ant.version === reg.version && ant.tiempo <= reg.tiempo) return false;
  todo[reg.escenario] = reg;
  try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(todo)); }
  catch (e) { // sin sitio: se quedan solo las 10 vueltas más recientes
    const claves = Object.keys(todo).sort((a, b) => (todo[b].fecha || '').localeCompare(todo[a].fecha || '')).slice(0, 10);
    try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(Object.fromEntries(claves.map(k => [k, todo[k]])))); } catch (e2) { return false; }
  }
  return true;
}

// --- Online (Supabase / PostgREST) ---
async function pedir(cfg, ruta, opciones) {
  const r = await fetch(cfg.url + '/rest/v1/' + ruta, Object.assign({}, opciones, {
    headers: Object.assign({ apikey: cfg.clave, 'Content-Type': 'application/json' },
      // la clave «anon» antigua es un JWT (eyJ…) y va también como Bearer; la nueva «publishable» (sb_publishable_…) no
      /^eyJ/.test(cfg.clave) ? { Authorization: 'Bearer ' + cfg.clave } : {},
      (opciones && opciones.headers) || {})
  }));
  if (!r.ok) throw new Error('El servidor de la clasificación respondió ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.status === 204 ? null : r.json();
}
const q = encodeURIComponent;

// Las mejores vueltas de un circuito (de esa versión; sin versión, de todas): [{ id, piloto, coche, coche_nombre,
// tiempo, creado }], una por piloto
export async function clasificacion(escenario, version, limite) {
  const cfg = configOnline();
  if (!cfg) return null;
  const filas = await pedir(cfg, `vueltas?select=id,piloto,coche,coche_nombre,tiempo,creado&escenario=eq.${q(escenario)}${version ? '&version=eq.' + q(version) : ''}&order=tiempo.asc&limit=200`);
  const vistos = new Set(), out = [];
  for (const f of filas) { const k = f.piloto.trim().toLowerCase(); if (vistos.has(k)) continue; vistos.add(k); out.push(f); if (out.length >= (limite || 20)) break; }
  return out;
}
// El fantasma (texto) de una vuelta de la clasificación
export async function fantasmaOnline(id) {
  const cfg = configOnline();
  if (!cfg) return null;
  const f = await pedir(cfg, `vueltas?select=fantasma,piloto,coche,coche_nombre,tiempo&id=eq.${q(id)}`);
  return f && f[0] ? f[0] : null;
}
// Sube una vuelta: { escenario, version, piloto, coche, coche_nombre, tiempo, fantasma }. Devuelve su id.
export async function subirVuelta(reg) {
  const cfg = configOnline();
  if (!cfg) return null;
  const f = await pedir(cfg, 'vueltas?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(reg) });
  return f && f[0] ? f[0].id : null;
}
