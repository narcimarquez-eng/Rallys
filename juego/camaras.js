// Cámaras: persecución (detrás y algo arriba, con retardo y mirando hacia donde va el coche), capó y cabina
// (pegadas a la carrocería: cabecean y se balancean con ella). C (o Y en el mando, o 🎥) cambia de cámara.
import * as THREE from 'three';

export const CAMARAS = [
  { id: 'persecucion', nombre: 'Persecución', fov: 62 },
  { id: 'capo', nombre: 'Capó', fov: 70 },
  { id: 'cabina', nombre: 'Cabina', fov: 72 }
];

export class Camaras {
  constructor(camara, pista) {
    this.camara = camara; this.pista = pista;
    this.i = 0;
    this.pos = new THREE.Vector3(); this.mira = new THREE.Vector3(); this.iniciada = false;
    this.temblor = 0;
    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion();
  }
  get actual() { return CAMARAS[this.i]; }
  usar(id) { const k = CAMARAS.findIndex(c => c.id === id); if (k >= 0) this.i = k; this.iniciada = false; this._fov(); }
  siguiente() { this.i = (this.i + 1) % CAMARAS.length; this.iniciada = false; this._fov(); return this.actual; }
  _fov() { this.camara.fov = this.actual.fov; this.camara.updateProjectionMatrix(); }
  sacudir(f) { this.temblor = Math.min(0.6, this.temblor + f); }

  actualizar(dt, coche, modelo) {
    const cam = this.camara, id = this.actual.id;
    modelo.objeto.updateMatrixWorld(true);
    if (id === 'persecucion') {
      const m = coche.m;
      const s = Math.sin(coche.rumbo), c = Math.cos(coche.rumbo);
      // dirección: mezcla del morro y de hacia dónde se mueve (en los derrapes se ve el coche cruzado)
      const v = Math.hypot(coche.vx, coche.vz);
      let dx = s, dz = c;
      if (v > 4) { const vx = coche.vx / v, vz = coche.vz / v, k = Math.min(0.55, (v - 4) / 20); if (vx * s + vz * c > 0) { dx = s * (1 - k) + vx * k; dz = c * (1 - k) + vz * k; const l = Math.hypot(dx, dz); dx /= l; dz /= l; } }
      const dist = 5.2 + m.largo * 0.45 + Math.min(2.5, v * 0.05), alto = 1.7 + m.alto * 0.5;
      const objetivo = new THREE.Vector3(coche.x - dx * dist, coche.y + alto, coche.z - dz * dist);
      const suelo = this.pista.consultar(objetivo.x, objetivo.z).y;
      objetivo.y = Math.max(objetivo.y, suelo + 1.2);
      const mirar = new THREE.Vector3(coche.x + dx * 4, coche.y + m.alto * 0.55, coche.z + dz * 4);
      if (!this.iniciada) { this.pos.copy(objetivo); this.mira.copy(mirar); this.iniciada = true; }
      const k = 1 - Math.exp(-dt * 7), ky = 1 - Math.exp(-dt * 4);
      this.pos.x += (objetivo.x - this.pos.x) * k; this.pos.z += (objetivo.z - this.pos.z) * k; this.pos.y += (objetivo.y - this.pos.y) * ky;
      this.pos.y = Math.max(this.pos.y, this.pista.consultar(this.pos.x, this.pos.z).y + 0.8);
      this.mira.lerp(mirar, 1 - Math.exp(-dt * 14));
      cam.position.copy(this.pos); cam.lookAt(this.mira);
    } else {
      const ancla = id === 'capo' ? modelo.anclaCapo : modelo.anclaCabina;
      ancla.getWorldPosition(cam.position);
      ancla.getWorldQuaternion(this._q);
      cam.quaternion.copy(this._q);
      cam.rotateY(Math.PI); // la cámara de three.js mira hacia −z; el coche, hacia +z
      // un poco de inclinación hacia abajo en cabina para ver el salpicadero
      if (id === 'cabina') cam.rotateX(-0.06);
    }
    if (this.temblor > 0.001) {
      const t = this.temblor;
      cam.position.x += (Math.random() - 0.5) * t * 0.3; cam.position.y += (Math.random() - 0.5) * t * 0.3;
      cam.rotateZ((Math.random() - 0.5) * t * 0.05);
      this.temblor *= Math.exp(-dt * 6);
    }
    // planos de recorte: en cabina hace falta ver muy cerca
    const cerca = id === 'cabina' ? 0.05 : id === 'capo' ? 0.1 : 0.3;
    if (cam.near !== cerca) { cam.near = cerca; cam.updateProjectionMatrix(); }
  }
}
