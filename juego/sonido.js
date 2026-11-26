// Sonido hecho con Web Audio, sin archivos:
//  · Motor: dos osciladores (diente de sierra y cuadrada) a la frecuencia de encendido de un 4 cilindros
//    (rpm / 60 × 2), con distorsión suave, un filtro que se abre con el acelerador y un leve trémolo.
//  · Superficie: ruido filtrado distinto para asfalto, grava, tierra, barro, hierba, nieve y el agua del vado;
//    sube con la velocidad.
//  · Derrape: chirrido en asfalto y adoquín; en lo suelto, más ruido de piedras.
//  · Golpes: un golpe corto filtrado, según la fuerza y el material (metal, madera, goma, piedra…).
// El navegador solo deja sonar después de un toque o una tecla: se crea en el primer «¡A correr!».
const SUP = {
  asfalto: { f: 500, q: 0.6, g: 0.05 }, piedra: { f: 900, q: 0.9, g: 0.14 }, grava: { f: 2200, q: 0.5, g: 0.3 },
  tierra: { f: 1000, q: 0.7, g: 0.2 }, arena: { f: 700, q: 0.6, g: 0.18 }, barro: { f: 320, q: 1.2, g: 0.28 },
  hierba: { f: 1500, q: 0.4, g: 0.15 }, roca: { f: 1300, q: 0.8, g: 0.22 }, nieve: { f: 600, q: 0.5, g: 0.12 },
  hielo: { f: 400, q: 0.5, g: 0.04 }, agua: { f: 900, q: 0.4, g: 0.55 }
};
const GOLPES = { metal: [1800, 6], madera: [600, 3], goma: [180, 1.5], piedra: [350, 2], golpe: [250, 1.5], paja: [400, 0.8], cinta: [2500, 8], cono: [1200, 4] };

export class Sonido {
  constructor() { this.ctx = null; this.activo = true; this.volumen = 0.8; }
  iniciar() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.maestro = ctx.createGain(); this.maestro.gain.value = this.activo ? this.volumen : 0;
    const comp = ctx.createDynamicsCompressor(); this.maestro.connect(comp); comp.connect(ctx.destination);
    // ruido blanco en bucle (para superficie, derrape y golpes)
    const largo = ctx.sampleRate * 2, buf = ctx.createBuffer(1, largo, ctx.sampleRate), d = buf.getChannelData(0);
    for (let k = 0; k < largo; k++) d[k] = Math.random() * 2 - 1;
    this.ruido = buf;
    // Motor
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'square';
    this.o3 = ctx.createOscillator(); this.o3.type = 'sine';
    const g1 = ctx.createGain(); g1.gain.value = 0.5; const g2 = ctx.createGain(); g2.gain.value = 0.22; const g3 = ctx.createGain(); g3.gain.value = 0.6;
    const dist = ctx.createWaveShaper(); dist.curve = curvaDistorsion(18); dist.oversample = '2x';
    this.filtroMotor = ctx.createBiquadFilter(); this.filtroMotor.type = 'lowpass'; this.filtroMotor.Q.value = 2.5;
    this.gMotor = ctx.createGain(); this.gMotor.gain.value = 0;
    this.tremolo = ctx.createGain(); this.tremolo.gain.value = 1;
    this.lfo = ctx.createOscillator(); this.lfo.frequency.value = 12; const lfoG = ctx.createGain(); lfoG.gain.value = 0.12;
    this.lfo.connect(lfoG); lfoG.connect(this.tremolo.gain);
    this.o1.connect(g1); this.o2.connect(g2); this.o3.connect(g3);
    g1.connect(dist); g2.connect(dist); g3.connect(this.filtroMotor); dist.connect(this.filtroMotor);
    this.filtroMotor.connect(this.tremolo); this.tremolo.connect(this.gMotor); this.gMotor.connect(this.maestro);
    for (const o of [this.o1, this.o2, this.o3, this.lfo]) o.start();
    // Superficie
    const fuenteRuido = () => { const s = ctx.createBufferSource(); s.buffer = this.ruido; s.loop = true; s.start(0, Math.random() * 1.5); return s; };
    this.fSup = ctx.createBiquadFilter(); this.fSup.type = 'bandpass';
    this.gSup = ctx.createGain(); this.gSup.gain.value = 0;
    fuenteRuido().connect(this.fSup); this.fSup.connect(this.gSup); this.gSup.connect(this.maestro);
    // Grava: crujido de piedras (ruido modulado a golpes)
    this.fPiedras = ctx.createBiquadFilter(); this.fPiedras.type = 'highpass'; this.fPiedras.frequency.value = 2500;
    this.gPiedras = ctx.createGain(); this.gPiedras.gain.value = 0;
    this.modPiedras = ctx.createGain(); this.modPiedras.gain.value = 0;
    const lfo2 = ctx.createOscillator(); lfo2.type = 'square'; lfo2.frequency.value = 23; lfo2.connect(this.modPiedras.gain); lfo2.start();
    fuenteRuido().connect(this.fPiedras); this.fPiedras.connect(this.modPiedras); this.modPiedras.connect(this.gPiedras); this.gPiedras.connect(this.maestro);
    this.lfoPiedras = lfo2;
    // Derrape
    this.fDerrape = ctx.createBiquadFilter(); this.fDerrape.type = 'bandpass'; this.fDerrape.frequency.value = 2400; this.fDerrape.Q.value = 6;
    this.gDerrape = ctx.createGain(); this.gDerrape.gain.value = 0;
    fuenteRuido().connect(this.fDerrape); this.fDerrape.connect(this.gDerrape); this.gDerrape.connect(this.maestro);
    // Viento
    this.fViento = ctx.createBiquadFilter(); this.fViento.type = 'lowpass'; this.fViento.frequency.value = 600;
    this.gViento = ctx.createGain(); this.gViento.gain.value = 0;
    fuenteRuido().connect(this.fViento); this.fViento.connect(this.gViento); this.gViento.connect(this.maestro);
  }
  setActivo(v) { this.activo = v; if (this.maestro) this.maestro.gain.setTargetAtTime(v ? this.volumen : 0, this.ctx.currentTime, 0.05); }
  pausar(v) { if (!this.ctx) return; if (v) this.ctx.suspend(); else this.ctx.resume(); }

  // estado: { rpm, gas, velocidad (m/s), superficie, enSuelo, derrape 0–1, agua (m) }
  actualizar(e) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.04;
    const f = e.rpm / 60 * 2;
    this.o1.frequency.setTargetAtTime(f, t, 0.02); this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.02); this.o3.frequency.setTargetAtTime(f * 0.5, t, 0.02);
    this.lfo.frequency.setTargetAtTime(6 + e.rpm / 400, t, 0.05);
    this.filtroMotor.frequency.setTargetAtTime(300 + e.gas * 1800 + e.rpm * 0.18, t, k);
    this.gMotor.gain.setTargetAtTime(0.16 + e.gas * 0.2 + e.rpm / 7500 * 0.1, t, k);
    const s = SUP[e.superficie] || SUP.tierra, v = Math.min(1, e.velocidad / 30) * (e.enSuelo ? 1 : 0);
    this.fSup.frequency.setTargetAtTime(s.f * (0.7 + v * 0.6), t, k); this.fSup.Q.value = s.q;
    this.gSup.gain.setTargetAtTime(s.g * v * (0.4 + 0.6 * v), t, 0.08);
    const suelta = e.superficie === 'grava' || e.superficie === 'roca' || e.superficie === 'tierra';
    this.gPiedras.gain.setTargetAtTime(suelta ? (0.08 + e.derrape * 0.25) * v : 0, t, 0.08);
    this.lfoPiedras.frequency.setTargetAtTime(14 + e.velocidad * 1.3, t, 0.1);
    const firme = e.superficie === 'asfalto' || e.superficie === 'piedra' || e.superficie === 'hielo';
    this.gDerrape.gain.setTargetAtTime(firme ? e.derrape * 0.35 : 0, t, 0.05);
    this.fDerrape.frequency.setTargetAtTime(1800 + e.velocidad * 25, t, 0.1);
    this.gViento.gain.setTargetAtTime(Math.min(0.25, (e.velocidad / 60) ** 2), t, 0.2);
  }

  golpe(fuerza, tipo) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, [frec, q] = GOLPES[tipo] || GOLPES.golpe;
    const src = ctx.createBufferSource(); src.buffer = this.ruido;
    const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = frec; fl.Q.value = q;
    const g = ctx.createGain(); const v = Math.min(1, fuerza / 12) * 0.9 + 0.08;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12 + v * 0.35);
    src.connect(fl); fl.connect(g); g.connect(this.maestro);
    src.start(t, Math.random()); src.stop(t + 0.6);
    // golpe sordo grave para los fuertes
    if (fuerza > 4) {
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
      const go = ctx.createGain(); go.gain.setValueAtTime(Math.min(0.8, fuerza / 15), t); go.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(go); go.connect(this.maestro); o.start(t); o.stop(t + 0.32);
    }
  }
  pitido(frec, dur) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = frec; g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + (dur || 0.2));
    o.connect(g); g.connect(this.maestro); o.start(t); o.stop(t + (dur || 0.2) + 0.05);
  }
}

function curvaDistorsion(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
  return c;
}
