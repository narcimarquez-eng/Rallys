// Salas para correr en grupo por internet (docs/GRUPO.md).
//
// · La sala es un canal de Supabase Realtime («rallys:<CÓDIGO>»): con su «presencia» cada jugador publica quién es
//   (nombre, coche, en qué fase está, su tiempo al llegar a meta…) y por sus mensajes («broadcast») van las órdenes
//   del anfitrión (cargar el circuito, salida) y la señalización de WebRTC.
// · Durante la carrera, la posición de cada coche va directa de un jugador a otro por WebRTC (un DataChannel sin
//   reenvíos: si un paquete se pierde, ya llega el siguiente). Supabase solo presenta a los jugadores.
// · Si dos jugadores no consiguen conectarse directamente (algunas redes de empresa o de datos móviles), la posición
//   va por el canal de Supabase, menos a menudo (5 veces por segundo): se ve algo menos suave, pero se juega.
//
// Sin dependencias en el código: supabase-js se carga de la CDN la primera vez que se entra en una sala.
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
const HIELO = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I, O, 0, 1 (se confunden)
const HZ_SERVIDOR = 5;
const ESPERA_DIRECTA = 8000; // ms: si en este tiempo no hay conexión directa con alguien, se le manda por el servidor

export function codigoNuevo(n = 4) { let s = ''; for (let k = 0; k < n; k++) s += LETRAS[Math.floor(Math.random() * LETRAS.length)]; return s; }
export function normalizarCodigo(t) { return String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }
export function idNuevo() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

export class Sala {
  // cfg: { url, clave } de Supabase; yo: lo que se publica de este jugador (id, nombre, coche…)
  // opciones: { directa: false para no usar WebRTC (pruebas), cargarCliente: para inyectar supabase-js en pruebas }
  constructor(cfg, yo, opciones) {
    this.cfg = cfg; this.yo = Object.assign({ desde: Date.now() }, yo);
    this.op = Object.assign({ directa: true }, opciones || {});
    this.pilotos = new Map(); // id → lo que publica (incluido yo)
    this.pares = new Map();   // id → { pc, dc, abierto, ice: [], desde }
    this.oyentes = {};
    this.codigo = null; this.canal = null; this.tServidor = 0;
  }
  on(ev, fn) { (this.oyentes[ev] = this.oyentes[ev] || []).push(fn); return this; }
  emitir(ev, ...a) { for (const fn of this.oyentes[ev] || []) { try { fn(...a); } catch (e) { console.error(e); } } }

  async entrar(codigo) {
    this.codigo = normalizarCodigo(codigo);
    if (this.codigo.length < 3) throw new Error('Código de sala no válido');
    const { createClient } = this.op.cargarCliente ? await this.op.cargarCliente() : await import(SUPABASE_JS);
    this.cliente = createClient(this.cfg.url, this.cfg.clave, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, realtime: Object.assign({ params: { eventsPerSecond: 40 } }, this.op.depurar ? { logger: (k, m, d) => { if (!/heartbeat|presence_diff/.test(m + JSON.stringify(d || ''))) console.log('[sala] rt', k, m, JSON.stringify(d || '').slice(0, 300)); } } : {}) });
    const canal = this.canal = this.cliente.channel('rallys:' + this.codigo, { config: { broadcast: { self: false }, presence: { key: this.yo.id } } });
    canal.on('presence', { event: 'sync' }, () => this._sync());
    canal.on('broadcast', { event: 'm' }, m => this._mensaje(m.payload || {}));
    await new Promise((ok, mal) => {
      const t = setTimeout(() => mal(new Error('No se pudo conectar con la sala (sin respuesta del servidor)')), 15000);
      let primera = true;
      canal.subscribe((st, err) => {
        if (this.op.depurar) console.log('[sala] canal', st, err ? err.message : '');
        if (st === 'SUBSCRIBED') {
          clearTimeout(t);
          if (primera) { primera = false; ok(); }
          else { // tras un corte: volver a decir quién eres y rehacer las conexiones directas
            this._ultTrack = 0; this._track();
            for (const id of [...this.pares.keys()]) this._cerrarPar(id);
            this._rehacer = true; this.enviar('hola');
            this.emitir('reconectada');
          }
        }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { clearTimeout(t); mal(new Error('No se pudo conectar con la sala' + (err ? ': ' + err.message : ''))); }
        else if (st === 'CLOSED' && this.canal === canal) this.emitir('cerrada');
      });
    });
    await canal.track(this.yo); this._ultTrack = performance.now();
  }
  // Cambia lo que se publica de este jugador (fase, coche, resultados…)
  publicar(cambios) {
    if (this.op.depurar) console.log('[sala] publicar', JSON.stringify(cambios).slice(0, 120), new Error().stack.split('\n').slice(2, 5).join(' < ').replace(/http:\/\/[^ ]*\//g, ''));
    Object.assign(this.yo, cambios);
    this.pilotos.set(this.yo.id, Object.assign({}, this.yo));
    this._track();
    this.emitir('pilotos', this.pilotos);
  }
  // Supabase cierra el canal a quien publica su presencia demasiado a menudo: como mucho, cada 400 ms (lo último)
  _track() {
    if (!this.canal || this._tTrack) return;
    const espera = Math.max(0, 400 - (performance.now() - (this._ultTrack || -1e9)));
    this._tTrack = setTimeout(() => {
      this._tTrack = null; this._ultTrack = performance.now();
      if (this.canal) this.canal.track(this.yo).catch(e => console.warn(e));
    }, espera);
  }
  // Mensaje para todos (o para uno: a = su id). Lo que ordena el anfitrión, la señalización y el plan B de posiciones.
  enviar(tipo, datos, a) {
    if (!this.canal) return;
    this.canal.send({ type: 'broadcast', event: 'm', payload: { t: tipo, de: this.yo.id, a: a || null, d: datos } }).catch(e => console.warn(e));
  }
  // El anfitrión: el que lleva más tiempo en la sala (el que la creó, mientras siga)
  get anfitrion() {
    let best = null;
    for (const p of this.pilotos.values()) if (!best || p.desde < best.desde || (p.desde === best.desde && p.id < best.id)) best = p;
    return best;
  }
  get soyAnfitrion() { const a = this.anfitrion; return !!a && a.id === this.yo.id; }

  _sync() {
    if (!this.canal) return; // ya has salido
    const st = this.canal.presenceState(), antes = new Set(this.pilotos.keys());
    this.pilotos = new Map();
    for (const [id, metas] of Object.entries(st)) if (metas && metas.length) this.pilotos.set(id, metas[metas.length - 1]);
    if (!this.pilotos.has(this.yo.id)) this.pilotos.set(this.yo.id, Object.assign({}, this.yo)); // aún no ha vuelto mi «track»
    for (const id of this.pilotos.keys()) if (id !== this.yo.id && (this._rehacer || !antes.has(id))) this._nuevo(id);
    this._rehacer = false;
    for (const id of antes) if (!this.pilotos.has(id)) { this._cerrarPar(id); this.emitir('sale', id); }
    this.emitir('pilotos', this.pilotos);
  }
  _mensaje(m) {
    if (!m.de || m.de === this.yo.id || (m.a && m.a !== this.yo.id)) return;
    if (m.t === 'sdp') this._sdp(m.de, m.d);
    else if (m.t === 'ice') this._ice(m.de, m.d);
    else if (m.t === 'hola') { this._cerrarPar(m.de); this._nuevo(m.de); } // volvió tras un corte
    else if (m.t === 'pos') { const p = this.pares.get(m.de); if (!(p && p.abierto) && Array.isArray(m.d)) this.emitir('estado', m.de, Float32Array.from(m.d), 'servidor'); }
    else this.emitir('mensaje', m.t, m.d, m.de);
  }

  // --- WebRTC: una conexión por pareja de jugadores; la abre el de id menor ---
  _nuevo(id) {
    if (!this.op.directa || typeof RTCPeerConnection === 'undefined') return;
    if (this.yo.id < id) this._par(id, true);
  }
  _par(id, inicia) {
    let p = this.pares.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: HIELO });
    p = { pc, dc: null, abierto: false, ice: [], desde: performance.now() };
    this.pares.set(id, p);
    pc.onicecandidate = e => { if (e.candidate) this.enviar('ice', e.candidate.toJSON(), id); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') { p.fallo = true; p.abierto = false; this.emitir('red', id, this.red(id)); }
    };
    const preparar = dc => {
      p.dc = dc; dc.binaryType = 'arraybuffer';
      dc.onopen = () => { p.abierto = true; this.emitir('red', id, 'directa'); };
      dc.onclose = () => { p.abierto = false; this.emitir('red', id, this.red(id)); };
      dc.onmessage = e => { if (e.data instanceof ArrayBuffer) this.emitir('estado', id, new Float32Array(e.data), 'directa'); };
    };
    if (inicia) {
      preparar(pc.createDataChannel('pos', { ordered: false, maxRetransmits: 0 }));
      (async () => {
        try { await pc.setLocalDescription(await pc.createOffer()); this.enviar('sdp', { type: pc.localDescription.type, sdp: pc.localDescription.sdp }, id); }
        catch (e) { console.warn('WebRTC', e); p.fallo = true; }
      })();
    } else pc.ondatachannel = e => preparar(e.channel);
    return p;
  }
  async _sdp(de, d) {
    if (!this.op.directa || typeof RTCPeerConnection === 'undefined' || !d) return;
    if (d.type === 'offer') { const v = this.pares.get(de); if (v && (v.pc.remoteDescription || v.dc)) this._cerrarPar(de); } // una conexión nueva
    const p = this._par(de, false);
    try {
      await p.pc.setRemoteDescription(d);
      for (const c of p.ice.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
      if (d.type === 'offer') { await p.pc.setLocalDescription(await p.pc.createAnswer()); this.enviar('sdp', { type: p.pc.localDescription.type, sdp: p.pc.localDescription.sdp }, de); }
    } catch (e) { console.warn('WebRTC', e); p.fallo = true; }
  }
  async _ice(de, c) {
    const p = this.pares.get(de);
    if (!p || !c) { if (this.op.directa) this._par(de, false).ice.push(c); return; }
    if (p.pc.remoteDescription) await p.pc.addIceCandidate(c).catch(() => {}); else p.ice.push(c);
  }
  _cerrarPar(id) { const p = this.pares.get(id); if (p) { try { p.pc.close(); } catch (e) { /* nada */ } this.pares.delete(id); } }
  // Cómo llega lo de este jugador: 'directa', 'servidor' o 'conectando'
  red(id) {
    const p = this.pares.get(id);
    if (p && p.abierto) return 'directa';
    if (!this.op.directa || !p || p.fallo || performance.now() - p.desde > ESPERA_DIRECTA) return 'servidor';
    return 'conectando';
  }

  // El estado del coche (Float32Array) a todos: directo a quien se pueda y, si alguien no tiene conexión directa,
  // también por el servidor (como mucho HZ_SERVIDOR veces por segundo)
  enviarEstado(v) {
    let faltan = false;
    for (const id of this.pilotos.keys()) {
      if (id === this.yo.id) continue;
      const p = this.pares.get(id);
      if (p && p.abierto && p.dc.readyState === 'open') { try { p.dc.send(v.buffer.byteLength === v.byteLength ? v.buffer : v.slice().buffer); continue; } catch (e) { /* por el servidor */ } }
      if (this.red(id) === 'servidor') faltan = true;
    }
    const ahora = performance.now();
    if (faltan && ahora - this.tServidor >= 1000 / HZ_SERVIDOR) {
      this.tServidor = ahora;
      this.enviar('pos', Array.from(v, x => Math.round(x * 1000) / 1000));
    }
  }

  async salir() {
    clearTimeout(this._tTrack); this._tTrack = null;
    for (const id of [...this.pares.keys()]) this._cerrarPar(id);
    const c = this.canal; this.canal = null;
    if (c) { try { await c.untrack(); } catch (e) { /* nada */ } try { await this.cliente.removeChannel(c); } catch (e) { /* nada */ } }
    this.pilotos = new Map();
  }
}
