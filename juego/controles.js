// Controles: teclado, mando (API Gamepad, distribución estándar) y táctil (botones en pantalla).
// Todos acaban en el mismo «mando»: { gas 0–1, freno 0–1, giro −1…1 (+ derecha), manoFreno, analogico }
// y en acciones sueltas: 'camara', 'pausa', 'reiniciar' (volver a la pista).
//
// Teclado: W/↑ acelerar · S/↓ frenar y marcha atrás · A D/← → girar · Espacio freno de mano · C cámara ·
//          R volver a la pista · Esc/P pausa · M sonido
// Mando:   RT acelerar · LT frenar · stick izquierdo (o cruceta) girar · A/B freno de mano · Y cámara ·
//          X volver a la pista · Start pausa
// Táctil:  ◀ ▶ girar (a la izquierda) · pedales acelerar y frenar y freno de mano (a la derecha) · botones arriba
export class Controles {
  constructor(raizTactil) {
    this.teclas = new Set();
    this.tactil = { izq: false, der: false, gas: false, freno: false, mano: false };
    this.acciones = [];
    this.mando = { gas: 0, freno: 0, giro: 0, manoFreno: false, analogico: false };
    this.giroTeclado = 0;
    this.padAnterior = {};
    this.usandoPad = false;
    addEventListener('keydown', e => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      const k = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
      if (!e.repeat) {
        if (k === 'KeyC') this.acciones.push('camara');
        if (k === 'KeyR') this.acciones.push('reiniciar');
        if (k === 'Escape' || k === 'KeyP') this.acciones.push('pausa');
        if (k === 'KeyM') this.acciones.push('sonido');
      }
      this.teclas.add(k);
    });
    addEventListener('keyup', e => this.teclas.delete(e.code));
    addEventListener('blur', () => this.teclas.clear());
    if (raizTactil) this._tactil(raizTactil);
  }

  _tactil(raiz) {
    // Cada botón con data-t="izq|der|gas|freno|mano" (se mantiene) o data-accion="camara|pausa|reiniciar" (toque)
    const mantener = (el, on) => { const t = el.dataset.t; if (t) { this.tactil[t] = on; el.classList.toggle('pulsado', on); } };
    raiz.querySelectorAll('[data-t]').forEach(el => {
      const dedos = new Set();
      el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture && el.setPointerCapture(e.pointerId); dedos.add(e.pointerId); mantener(el, true); });
      const soltar = e => { dedos.delete(e.pointerId); if (!dedos.size) mantener(el, false); };
      el.addEventListener('pointerup', soltar); el.addEventListener('pointercancel', soltar); el.addEventListener('lostpointercapture', soltar);
      el.addEventListener('contextmenu', e => e.preventDefault());
    });
    raiz.querySelectorAll('[data-accion]').forEach(el => el.addEventListener('pointerdown', e => { e.preventDefault(); this.acciones.push(el.dataset.accion); }));
  }

  // Lee todo y devuelve el mando de este fotograma
  leer(dt) {
    const T = this.teclas, t = this.tactil;
    let gas = (T.has('KeyW') || T.has('ArrowUp') || t.gas) ? 1 : 0;
    let freno = (T.has('KeyS') || T.has('ArrowDown') || t.freno) ? 1 : 0;
    let mano = T.has('Space') || t.mano;
    const izq = T.has('KeyA') || T.has('ArrowLeft') || t.izq, der = T.has('KeyD') || T.has('ArrowRight') || t.der;
    // teclado: el giro sube poco a poco (más suave que todo o nada) y vuelve rápido al centro
    const obj = (der ? 1 : 0) - (izq ? 1 : 0);
    const vel = obj === 0 ? 8 : (Math.sign(obj) !== Math.sign(this.giroTeclado) && this.giroTeclado !== 0 ? 9 : 4.5);
    this.giroTeclado += Math.max(-vel * dt, Math.min(vel * dt, obj - this.giroTeclado));
    let giro = this.giroTeclado, analogico = false;
    // mando
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const b = i => pad.buttons[i] ? pad.buttons[i].value || (pad.buttons[i].pressed ? 1 : 0) : 0;
      const pulsado = i => pad.buttons[i] && pad.buttons[i].pressed;
      let eje = pad.axes[0] || 0;
      if (Math.abs(eje) < 0.12) eje = 0; else eje = Math.sign(eje) * (Math.abs(eje) - 0.12) / 0.88;
      eje = Math.sign(eje) * Math.pow(Math.abs(eje), 1.4); // más fino en el centro
      if (pulsado(14)) eje = -1; if (pulsado(15)) eje = 1;
      const pg = b(7), pf = b(6);
      if (eje || pg > 0.05 || pf > 0.05 || pulsado(0) || pulsado(1)) this.usandoPad = true;
      if (eje) { giro = eje; analogico = true; }
      gas = Math.max(gas, pg > 0.05 ? pg : 0, pulsado(12) ? 1 : 0);
      freno = Math.max(freno, pf > 0.05 ? pf : 0, pulsado(13) ? 1 : 0);
      mano = mano || pulsado(0) || pulsado(1);
      const ant = this.padAnterior[pad.index] || [];
      const nuevo = i => pulsado(i) && !ant[i];
      if (nuevo(3)) this.acciones.push('camara');
      if (nuevo(2)) this.acciones.push('reiniciar');
      if (nuevo(9)) this.acciones.push('pausa');
      this.padAnterior[pad.index] = pad.buttons.map(x => x.pressed);
    }
    Object.assign(this.mando, { gas, freno, giro: Math.max(-1, Math.min(1, giro)), manoFreno: !!mano, analogico });
    return this.mando;
  }
  // Acciones pendientes (y las vacía)
  sacarAcciones() { const a = this.acciones.slice(); this.acciones.length = 0; return a; }
  vibrar(fuerza, ms) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) if (pad && pad.vibrationActuator && pad.vibrationActuator.playEffect) {
      try { pad.vibrationActuator.playEffect('dual-rumble', { duration: ms || 120, strongMagnitude: Math.min(1, fuerza), weakMagnitude: Math.min(1, fuerza * 0.6) }); } catch (e) { /* nada */ }
    }
  }
}
