// Polvo, barro y salpicaduras: puntos con tamaño según la distancia, que crecen, suben un poco y se desvanecen.
import * as THREE from 'three';

const MAX = 1400;

export class Particulas {
  constructor(scene) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3); this.col = new Float32Array(MAX * 3); this.vida = new Float32Array(MAX * 2); // edad, duración
    this.vel = new Float32Array(MAX * 3); this.tam = new Float32Array(MAX);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aVida', new THREE.BufferAttribute(this.vida, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aTam', new THREE.BufferAttribute(this.tam, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uEscala: { value: 600 } }]),
      vertexShader: `
        attribute vec2 aVida; attribute float aTam; varying vec3 vCol; varying float vA;
        uniform float uEscala;
        #include <fog_pars_vertex>
        void main() {
          float f = clamp(aVida.x / max(aVida.y, 0.001), 0.0, 1.0);
          vCol = color; vA = aVida.y > 0.0 ? (1.0 - f) * min(1.0, f * 8.0) : 0.0;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(aTam * (0.5 + f * 1.6) * uEscala / -mvPosition.z, 180.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        varying vec3 vCol; varying float vA;
        #include <fog_pars_fragment>
        void main() {
          vec2 d = gl_PointCoord - 0.5; float r = dot(d, d);
          if (r > 0.25) discard;
          gl_FragColor = vec4(vCol, vA * 0.32 * (1.0 - r * 4.0));
          #include <fog_fragment>
        }`,
      vertexColors: true
    });
    this.puntos = new THREE.Points(g, m);
    this.puntos.frustumCulled = false;
    this.puntos.renderOrder = 3;
    scene.add(this.puntos);
    this.sig = 0;
    this._c = new THREE.Color();
  }
  setAlto(px) { this.puntos.material.uniforms.uEscala.value = px * 0.32; }
  emitir(x, y, z, vx, vy, vz, color, tam, vida) {
    const i = this.sig; this.sig = (this.sig + 1) % MAX;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3);
    this._c.set(color); this.col.set([this._c.r, this._c.g, this._c.b], i * 3);
    this.vida[i * 2] = 0; this.vida[i * 2 + 1] = vida; this.tam[i] = tam;
  }
  actualizar(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.vida[i * 2 + 1] <= 0) continue;
      this.vida[i * 2] += dt;
      if (this.vida[i * 2] >= this.vida[i * 2 + 1]) { this.vida[i * 2 + 1] = 0; continue; }
      const k = i * 3, fr = Math.exp(-dt * 2.2);
      this.vel[k] *= fr; this.vel[k + 2] *= fr; this.vel[k + 1] = this.vel[k + 1] * fr - dt * 1.5;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
    }
    const g = this.puntos.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.aVida.needsUpdate = true; g.attributes.aTam.needsUpdate = true;
  }
}
