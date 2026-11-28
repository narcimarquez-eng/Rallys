// Cielo con fotos 360° (panorámicas equirectangulares de nubes reales, las mismas del Creador de Mundos RPG):
// día, atardecer y noche, mezcladas según la hora. Cada panorámica se gira para que su sol caiga donde está el sol
// de la escena (así la luz y las sombras cuadran con las nubes iluminadas). Bajo el horizonte se funde con la niebla.
// assets/cielos/{dia,atardecer,noche}.webp
import * as THREE from 'three';

// Dónde está el sol (o la luna) en cada foto, en coordenada u (0–1) de la panorámica
const SOL_U = { dia: 0.13, atardecer: 0.9, noche: 0.375 };
const FOTOS = ['dia', 'atardecer', 'noche'];

const VS = /* glsl */`
  varying vec3 vDir;
  void main() {
    // esfera unidad centrada en la cámara: la dirección no depende de dónde esté la cámara
    vDir = position;
    vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + position * 100.0, 1.0);
    gl_Position = p.xyww; // siempre al fondo
  }`;
const FS = /* glsl */`
  uniform sampler2D tDia, tOro, tNoche;
  uniform vec3 uPesos;      // día, atardecer, noche
  uniform vec3 uGiro;       // giro de cada foto (en u)
  uniform vec3 uHorizonte;  // color de la niebla
  uniform float uBrillo;
  varying vec3 vDir;
  vec3 muestra(sampler2D t, float giro, vec3 d) {
    vec2 uv = vec2(fract(atan(d.z, d.x) / 6.2831853 + 0.5 + giro), asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5);
    uv.y = max(uv.y, 0.505); // bajo el horizonte de la foto hay relleno: se repite la franja del horizonte
    return texture2D(t, uv).rgb;
  }
  void main() {
    vec3 d = normalize(vDir);
    vec3 c = vec3(0.0); float w = 0.0;
    if (uPesos.x > 0.001) { c += muestra(tDia, uGiro.x, d) * uPesos.x; w += uPesos.x; }
    if (uPesos.y > 0.001) { c += muestra(tOro, uGiro.y, d) * uPesos.y; w += uPesos.y; }
    if (uPesos.z > 0.001) { c += muestra(tNoche, uGiro.z, d) * uPesos.z; w += uPesos.z; }
    c = w > 0.0 ? c / w : uHorizonte;
    c *= uBrillo;
    // bruma en el horizonte y la niebla debajo, para que cuadre con el terreno lejano
    float alto = smoothstep(-0.03, 0.16, d.y);
    c = mix(uHorizonte, c, 0.25 + 0.75 * alto);
    c = mix(uHorizonte, c, smoothstep(-0.08, 0.0, d.y));
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

export class CieloFoto {
  constructor(ruta) {
    this.ruta = ruta || 'assets/cielos/';
    const blanco = new THREE.DataTexture(new Uint8Array([150, 180, 210, 255]), 1, 1); blanco.needsUpdate = true;
    this.uniforms = {
      tDia: { value: blanco }, tOro: { value: blanco }, tNoche: { value: blanco },
      uPesos: { value: new THREE.Vector3(1, 0, 0) }, uGiro: { value: new THREE.Vector3() },
      uHorizonte: { value: new THREE.Color('#bcd3e6') }, uBrillo: { value: 1 }
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
    this.malla = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    this.malla.frustumCulled = false; this.malla.renderOrder = -1000;
    this.malla.name = 'cielo-foto';
    this.cargadas = 0;
    this.firma = '';
  }
  // Carga las tres fotos (una vez). alListo: cuando hay alguna (para rehacer reflejos)
  cargar(alListo) {
    if (this._cargando) return; this._cargando = true;
    const cargador = new THREE.TextureLoader();
    const uni = { dia: 'tDia', atardecer: 'tOro', noche: 'tNoche' };
    FOTOS.forEach(f => cargador.load(this.ruta + f + '.webp', t => {
      t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; // sin mipmaps: la costura de atan no se nota
      this.uniforms[uni[f]].value = t; this.cargadas++; this.firma += f;
      if (alListo) alListo();
    }, undefined, () => console.warn('Cielo 360°: no se pudo cargar ' + f)));
  }
  // dia, ocaso: 0–1 (como en Escena3D.setHora); sol: vector hacia el sol; horizonte: color de la niebla
  ajustar(dia, ocaso, sol, horizonte) {
    const noche = 1 - dia, oro = Math.min(1, ocaso * 1.6) * dia, claro = Math.max(0, dia - oro);
    this.uniforms.uPesos.value.set(claro, oro, noche);
    this.uniforms.uBrillo.value = 0.35 + 0.65 * dia;
    const us = Math.atan2(sol.z, sol.x) / (2 * Math.PI) + 0.5; // u del sol en la esfera de la escena
    this.uniforms.uGiro.value.set(SOL_U.dia - us, SOL_U.atardecer - us, SOL_U.noche - us);
    if (horizonte) this.uniforms.uHorizonte.value.copy(horizonte);
  }
  // Copia para el reflejo del agua (comparte el material)
  copia() { const m = new THREE.Mesh(this.malla.geometry, this.malla.material); m.frustumCulled = false; return m; }
}
