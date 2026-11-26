// Exporta los aldeanos (público de la carrera) del estudio de personajes de Armaduras-glb
// (narcimarquez-eng/Armaduras-glb: public/assets/aistudio/Parametric_Character_Outfitter…html, su «Generador de
// aldeanos» con 8 oficios) a aldeanos/<id>.glb: personaje ligero (texturas de 128 px, malla simplificada
// con gltfpack y comprimida con meshopt) con tres animaciones: idle (esperando), victory (celebración) y jump (saltar de emoción).
//
// Uso (Playwright ya está instalado):
//   1. Sirve la carpeta del estudio:  cd Armaduras-glb/public/assets/aistudio && python3 -m http.server 8090
//   2. node tools/exportar-aldeanos.cjs [dirección del .html del estudio]
// Cada aldeano sale de una semilla fija: volver a exportarlos da los mismos.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ESTUDIO = process.argv[2] || 'http://localhost:8090/Parametric_Character_Outfitter___Wardrobe_Studio__10__fc55dc6c.html';
const SALIDA = path.join(__dirname, '..', 'aldeanos');
// [id, oficio, género, complexión, semilla]
const ALDEANOS = [
  ['campesino', 'campesino', 'hombre', 'natural', 11],
  ['campesina', 'campesino', 'mujer', 'esbelto', 12],
  ['herrero', 'herrero', 'hombre', 'fornido', 13],
  ['tabernera', 'tabernero', 'mujer', 'natural', 14],
  ['mercader', 'mercader', 'anciano', 'natural', 15],
  ['herbolaria', 'herbolario', 'anciana', 'esbelto', 16],
  ['lenador', 'lenador', 'hombre', 'fornido', 17],
  ['cazadora', 'cazador', 'mujer', 'esbelto', 18],
  ['aldeana', 'aldeana', 'mujer', 'esbelto', 19],
  ['cazador', 'cazador', 'hombre', 'esbelto', 20]
];
const CLIPS = ['idle', 'victory', 'jump'];
const GLTFPACK = ['-si', '0.12', '-sa', '-cc']; // simplificar al 12 % (son público: se ven de lejos) y comprimir

// gltfpack (el de Hacer coches, vendor/hacer-coches/vendor/gltfpack) como CommonJS en una carpeta temporal
function cargarGltfpack() {
  const ori = path.join(__dirname, '..', 'vendor', 'hacer-coches', 'vendor', 'gltfpack');
  if (!fs.existsSync(path.join(ori, 'library.wasm'))) return null;
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gltfpack-'));
  fs.copyFileSync(path.join(ori, 'library.js'), path.join(tmp, 'library.cjs'));
  fs.copyFileSync(path.join(ori, 'library.wasm'), path.join(tmp, 'library.wasm'));
  return require(path.join(tmp, 'library.cjs'));
}
async function aligerar(gp, buf) {
  let out = null;
  await gp.pack(['-i', 'in.glb', '-o', 'out.glb', ...GLTFPACK], { read: () => buf, write: (p, d) => { out = Buffer.from(d); } });
  return out;
}

// Puente que se mete en el módulo del estudio (las funciones del generador y del GLB ligero no están en window)
const PUENTE = `
window.__rallysAldeanos = {
  oficios: VILLAGER_PROFESSIONS.map(p => ({ id: p.id, nombre: p.name })),
  generar(o) {
    let a = o.semilla >>> 0;
    const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const orig = Math.random; Math.random = rnd;
    try { generateVillagerCharacter({ professionId: o.oficio, gender: o.genero || 'random', build: o.complexion || 'esbelto' }); }
    finally { Math.random = orig; }
    const v = STATE.fit.villagerOutfit;
    return v ? { oficio: v.professionName || o.oficio } : null;
  },
  async exportar(o) {
    const MS = await loadMeshoptSimplifier();
    if (typeof restoreBindPose === 'function') restoreBindPose();
    if (typeof restoreAllClothRestPose === 'function') restoreAllClothRestPose();
    const clips = getLightExportClips(o.fps || 15).filter(c => o.clips.includes(c.name));
    const built = buildLightweightExportScene({ armorOnly: false, maxTex: o.maxTex, clips, simplifyRatio: MS ? o.simplificar : 1, simplifyError: 0.004 });
    const glb = await new Promise((ok, mal) => new THREE.GLTFExporter().parse(built.scene, ok, mal, { binary: true, animations: clips, maxTextureSize: o.maxTex }));
    const q = new Uint8Array(glb); // sin cuantizar: lo hace gltfpack al simplificar
    let s = ''; for (let i = 0; i < q.length; i += 0x8000) s += String.fromCharCode.apply(null, q.subarray(i, i + 0x8000));
    built.scene.traverse(n => { if (n.isMesh) n.geometry.dispose(); });
    return { b64: btoa(s), triangulos: built.triangles, clips: clips.map(c => c.name) };
  }
};
`;

(async () => {
  fs.mkdirSync(SALIDA, { recursive: true });
  const gp = cargarGltfpack();
  if (!gp) console.warn('Sin gltfpack (vendor/hacer-coches/vendor/gltfpack): los aldeanos saldrán sin simplificar');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 900, height: 700 } });
  p.on('pageerror', e => console.warn('  (estudio)', e.message));
  await p.route(u => u.href.split('?')[0] === ESTUDIO, async r => {
    const res = await r.fetch(); let html = await res.text();
    const k = html.lastIndexOf('</script>');
    html = html.slice(0, k) + PUENTE + html.slice(k);
    r.fulfill({ response: res, body: html, headers: Object.assign({}, res.headers(), { 'content-type': 'text/html; charset=utf-8' }) });
  });
  await p.goto(ESTUDIO);
  await p.waitForFunction(() => window.__rallysAldeanos && window.__studio && window.__studio.mannequinRoot, null, { timeout: 180000 });
  console.log('Oficios:', (await p.evaluate(() => __rallysAldeanos.oficios.map(o => o.id))).join(', '));
  const indice = [];
  for (const [id, oficio, genero, complexion, semilla] of ALDEANOS.slice(0, +process.env.LIMITE || ALDEANOS.length)) {
    const info = await p.evaluate(o => __rallysAldeanos.generar(o), { oficio, genero, complexion, semilla });
    await p.waitForTimeout(2500); // texturas y telas
    const r = await p.evaluate(o => __rallysAldeanos.exportar(o), { clips: CLIPS, maxTex: 128, simplificar: 0.3, fps: 15 });
    let buf = Buffer.from(r.b64, 'base64');
    if (gp) buf = await aligerar(gp, buf);
    fs.writeFileSync(path.join(SALIDA, id + '.glb'), buf);
    console.log(`${id}: ${(buf.length / 1024).toFixed(0)} KB · ${Math.round(r.triangulos / 1000)}k triángulos · ${r.clips.join(', ')}`);
    indice.push({ id, archivo: 'aldeanos/' + id + '.glb', oficio: info ? info.oficio : oficio, genero });
  }
  fs.writeFileSync(path.join(SALIDA, 'indice.json'), JSON.stringify({ origen: 'narcimarquez-eng/Armaduras-glb · Generador de aldeanos', animaciones: CLIPS, aldeanos: indice }, null, 2) + '\n');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
