// Exporta el público de la carrera del estudio de personajes de Armaduras-glb (narcimarquez-eng/Armaduras-glb:
// public/assets/aistudio/Parametric_Character_Outfitter…html, su «Generador de aldeanos») a aldeanos/:
//   <id>.glb        de lejos: sin la cara pintada (solo los ojos), muy simplificado con gltfpack (~700 KB)
//   <id>-cerca.glb  de cerca: la cabeza y la cara pintada intactas, el resto simplificado (~1,3 MB)
// con tres animaciones: idle (esperando), victory (celebración) y jump (saltar de emoción).
// Las caras son las de tools/caras-amables (los rostros del estudio retocados con tools/caras-amables.py).
//
// Uso (Playwright ya está instalado):
//   1. Sirve la carpeta del estudio:  cd Armaduras-glb/public/assets/aistudio && python3 -m http.server 8090
//   2. node tools/exportar-aldeanos.cjs [dirección del .html del estudio]      (LIMITE=n: solo los n primeros)
// Cada uno sale de una semilla fija: volver a exportarlos da los mismos.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ESTUDIO = process.argv[2] || 'http://localhost:8090/Parametric_Character_Outfitter___Wardrobe_Studio__10__fc55dc6c.html';
const SALIDA = path.join(__dirname, '..', 'aldeanos');
// El público, moderno: cara amable (tools/caras-amables: los rostros pintados del estudio sin cicatrices ni adornos y
// con media sonrisa), pelo de láminas con textura de mechones (la técnica 5 del estudio, con sus «peinados modernos»
// por zonas y sus melenas y coletas de tiras) y ropa de calle hecha con las piezas del generador de
// aldeanos: camiseta o sudadera (la túnica con mangas cortas o largas, en colores lisos), vaqueros (el pantalón de lana
// en azul denim), chupa de cuero (el jubón, en negro), zapatillas blancas (los zapatos de cuero blando)…
// [id, género, complexión, cara, peinado, color del pelo [raíz, punta, brillo], ropa, semilla]
const VAQUERO = '#34507e', VAQUERO_CLARO = '#5f7fae', VAQUERO_NEGRO = '#23262d';
const ZAPATILLA = { boots: 'turnshoe', leatherColor: '#ecebe6' };
const CASTANO = ['#180d07', '#6b3e23', '#c8905a'], NEGRO = ['#07080c', '#1b1d24', '#4a5060'], RUBIO = ['#4a2c11', '#d8a85a', '#fff0c0'];
const PELIRROJO = ['#380d06', '#b8461f', '#f08a4a'], CANOSO = ['#5a5550', '#c9c4bc', '#f4f1ea'], CASTANO_OSCURO = ['#140c08', '#3a281d', '#7d5f4b'];
const ALDEANOS = [
  ['aficionado', 'hombre', 'natural', 'lam_18_01', 'm0205', NEGRO,
    { torso: 'peasant_tunic', sleeves: 'long_linen', lower: 'wool_trousers', belt: 'leather_pouch', head: 'none', shirtColor: '#c8272d', pantsColor: VAQUERO, accentColor: '#c8272d', ...ZAPATILLA }, 31],
  ['aficionada', 'mujer', 'esbelto', 'ref_mujer', 'tiras_coleta_alta', CASTANO,
    { torso: 'peasant_tunic', sleeves: 'rolled', lower: 'wool_trousers', belt: 'leather_pouch', head: 'none', shirtColor: '#f2c230', pantsColor: VAQUERO_CLARO, accentColor: '#f2c230', ...ZAPATILLA }, 32],
  ['abuelo', 'anciano', 'natural', 'ref_anciano', 'tiras_atras', CANOSO,
    { torso: 'leather_jerkin', sleeves: 'long_linen', lower: 'wool_trousers', belt: 'leather_pouch', boots: 'laced_boot', head: 'none', shirtColor: '#d8dbe0', leatherColor: '#3b2a20', pantsColor: '#6a6a66', accentColor: '#4a5a6a' }, 33],
  ['chica-falda', 'mujer', 'esbelto', 'lam_18_11', 'tiras_raya_lado', NEGRO,
    { torso: 'peasant_tunic', sleeves: 'rolled', lower: 'tunic_skirt', belt: 'leather_pouch', boots: 'cuff_boot', head: 'none', shirtColor: '#1f8a8a', leatherColor: '#1d1d1f', pantsColor: '#22304a', accentColor: '#22304a' }, 34],
  ['chico-negro', 'hombre', 'esbelto', 'lam_18_02', 'm0202', NEGRO,
    { torso: 'peasant_tunic', sleeves: 'rolled', lower: 'wool_trousers', belt: 'leather_pouch', head: 'none', shirtColor: '#202226', pantsColor: VAQUERO, accentColor: '#e8541e', ...ZAPATILLA }, 35],
  ['motera', 'mujer', 'natural', 'lam_20_00', 'tiras_coleta', CASTANO_OSCURO,
    { torso: 'leather_jerkin', sleeves: 'long_linen', lower: 'wool_trousers', belt: 'leather_pouch', boots: 'laced_boot', head: 'none', shirtColor: '#e9e4da', leatherColor: '#151517', pantsColor: VAQUERO_NEGRO, accentColor: '#151517' }, 36],
  ['chico-blanco', 'hombre', 'natural', 'ref_guerrero', 'm0210', CASTANO,
    { torso: 'peasant_tunic', sleeves: 'rolled', lower: 'wool_trousers', belt: 'leather_pouch', boots: 'turnshoe', head: 'none', shirtColor: '#eeeeec', leatherColor: '#c8302c', pantsColor: VAQUERO_CLARO, accentColor: '#1f6fd6' }, 37],
  ['chica-rosa', 'mujer', 'esbelto', 'lam_20_12', 'tiras_ondas', RUBIO,
    { torso: 'peasant_tunic', sleeves: 'long_linen', lower: 'leather_trousers', belt: 'leather_pouch', head: 'none', shirtColor: '#e86a92', pantsColor: '#1c1c1e', accentColor: '#e86a92', ...ZAPATILLA }, 38],
  ['fan-rallys', 'hombre', 'fornido', 'lam_18_01', 'm0028', CASTANO_OSCURO,
    { torso: 'peasant_tunic', sleeves: 'long_linen', lower: 'wool_trousers', belt: 'leather_pouch', boots: 'laced_boot', head: 'none', shirtColor: '#e8541e', leatherColor: '#2a1f18', pantsColor: '#4a4f3a', accentColor: '#1a1a1a' }, 39],
  ['chica-azul', 'mujer', 'natural', 'ref_mujer', 'tiras_raya_lado', PELIRROJO,
    { torso: 'peasant_tunic', sleeves: 'rolled', lower: 'wool_trousers', belt: 'leather_pouch', boots: 'laced_boot', head: 'none', shirtColor: '#1f6fd6', leatherColor: '#5b3a26', pantsColor: VAQUERO_NEGRO, accentColor: '#1f6fd6' }, 40]
];
const CLIPS = ['idle', 'victory', 'jump'];
// Dos versiones de cada uno: «cerca» (cabeza y cara pintada intactas, el cuerpo simplificado) y la de lejos (sin la
// cara pintada y muy simplificada: ~10 000 triángulos). gltfpack: comprimir (y en la de lejos, simplificar).
const VERSIONES = [
  { sufijo: '-cerca', op: { simplificar: 0.35, cabeza: 1, sinCara: false }, gltfpack: ['-cc'] },
  { sufijo: '', op: { simplificar: 1, sinCara: true }, gltfpack: ['-si', '0.12', '-sa', '-cc'] }
];

// gltfpack (el de Hacer coches, vendor/hacer-coches/vendor/gltfpack) como CommonJS en una carpeta temporal
function cargarGltfpack() {
  const ori = path.join(__dirname, '..', 'vendor', 'hacer-coches', 'vendor', 'gltfpack');
  if (!fs.existsSync(path.join(ori, 'library.wasm'))) return null;
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gltfpack-'));
  fs.copyFileSync(path.join(ori, 'library.js'), path.join(tmp, 'library.cjs'));
  fs.copyFileSync(path.join(ori, 'library.wasm'), path.join(tmp, 'library.wasm'));
  return require(path.join(tmp, 'library.cjs'));
}
async function aligerar(gp, buf, args) {
  let out = null;
  await gp.pack(['-i', 'in.glb', '-o', 'out.glb', ...args], { read: () => buf, write: (p, d) => { out = Buffer.from(d); } });
  return out;
}

// Puente que se mete en el módulo del estudio (las funciones del generador y del GLB ligero no están en window)
const PUENTE = `
window.__rallysAldeanos = {
  oficios: VILLAGER_PROFESSIONS.map(p => ({ id: p.id, nombre: p.name })),
  generar(o) {
    let a = o.semilla >>> 0;
    const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const CH = window.CreadorHumano;
    // la cara elegida: mientras se genera, en el catálogo de rostros solo está esa
    const caras = CH.FACE_TEXTURES, todas = Object.assign({}, caras);
    for (const k of Object.keys(caras)) if (k !== o.cara && k !== 'maniqui') delete caras[k];
    // pelo de láminas con textura de mechones (técnica 5 del estudio, «Láminas de pelo»)
    const bt = document.querySelector('.hair-tech-btn[data-tech="locks"]'); if (bt && HAIR_CONFIG.technique !== 'locks') bt.click();
    const orig = Math.random; Math.random = rnd;
    try {
      generateVillagerCharacter({ professionId: 'campesino', gender: o.genero, build: o.complexion || 'esbelto' });
      setHairPresetColor(o.pelo[0], o.pelo[1], o.pelo[2], true);
      HAIR_CONFIG.technique = 'locks';
      // peinados modernos: los «elegidos» por zonas (m0…) o los de tiras (tiras_…)
      if (HAIR_ZONE_PRESETS[o.peinado]) applyHairZonePreset(o.peinado); else applyHairCutPreset(o.peinado, true);
      syncHairUISliders();
      applyVillagerOutfit(Object.assign({ professionId: 'moderno', professionName: 'Público' }, o.ropa));
    } finally { Math.random = orig; Object.assign(caras, todas); }
    return { cara: CH.CONFIG.cara.faceTexture, pelo: HAIR_CONFIG.technique + ' · ' + (HAIR_ZONE_PRESETS[o.peinado] ? HAIR_ZONE_PRESETS[o.peinado].name : HAIR_CONFIG.cutStyle) };
  },
  async exportar(o) {
    const MS = await loadMeshoptSimplifier();
    if (typeof restoreBindPose === 'function') restoreBindPose();
    if (typeof restoreAllClothRestPose === 'function') restoreAllClothRestPose();
    const clips = getLightExportClips(o.fps || 15).filter(c => o.clips.includes(c.name));
    // La cara pintada es una malla transparente pegada encima de la cabeza («face_tex_overlay_…»): para la versión de
    // lejos se quita (de lejos no se distingue y, simplificada aparte de la cabeza, se despega y hace rayas)
    // Además el GLB ligero del estudio la guarda en JPEG (sin transparencia) y entonces tapa o no la cabeza según le
    // toque: se marca (nombre «CaraPintada») para devolverle su textura con transparencia, y el juego la dibuja delante.
    const ocultas = [], nombres = [], originales = new Map();
    mannequinRoot.traverse(n => {
      if (!n.isMesh) return;
      for (const m of [].concat(n.material)) {
        if (!m) continue;
        if (/^face_tex_overlay_/.test(n.name)) {
          // sin cara pintada se quedan solo los ojos (el iris de la ilustración), que sin ellos parecían ciegos
          if (o.sinCara && !/^face_tex_overlay_eye_/.test(n.name)) { if (m.visible !== false) { m.visible = false; ocultas.push(m); } continue; }
          if (!originales.has(m)) { nombres.push([m, m.name]); originales.set(m, 'CaraPintada' + originales.size); m.name = originales.get(m); }
        } else if (n.name === 'eye_sclera' && o.sinCara) { nombres.push([m, m.name]); m.name = 'Esclerotica'; }
        else if (n.name === 'eye_cornea' && o.sinCara && m.visible !== false) { m.visible = false; ocultas.push(m); }
      }
    });
    const porNombre = new Map([...originales].map(([m, k]) => [k, m.map]));
    let built;
    try { built = buildLightweightExportScene({ armorOnly: false, maxTex: o.maxTex, clips, simplifyRatio: 1, simplifyError: 0.004 }); }
    finally { for (const m of ocultas) m.visible = true; for (const [m, n] of nombres) m.name = n; }
    // la cara pintada, otra vez con su transparencia (PNG); sin ella, los ojos, de un gris pardo (de lejos, blancos daban miedo)
    built.scene.traverse(m => {
      if (!m.isMesh) return;
      for (const mt of [].concat(m.material)) {
        if (!mt) continue;
        const k = /^(CaraPintada[0-9]+)/.exec(mt.name || '');
        const t = k && porNombre.get(k[1]);
        if (t && t.image) {
          const esc = Math.min(1, o.maxTex / Math.max(t.image.width, t.image.height));
          const c = document.createElement('canvas'); c.width = Math.round(t.image.width * esc); c.height = Math.round(t.image.height * esc);
          c.getContext('2d').drawImage(t.image, 0, 0, c.width, c.height);
          const n = new THREE.CanvasTexture(c);
          for (const p of ['flipY', 'wrapS', 'wrapT', 'channel']) n[p] = t[p];
          n.colorSpace = THREE.SRGBColorSpace; n.repeat.copy(t.repeat); n.offset.copy(t.offset);
          mt.map = n; mt.alphaTest = 0.35; mt.transparent = false;
        }
        if (/^Esclerotica/.test(mt.name || '')) mt.color.set('#7d6d62');
      }
    });
    // Simplificación nuestra (meshoptimizer, con los bordes y las costuras de textura fijos): o.simplificar en todo
    // menos la cabeza (o.cabeza, normalmente 1 = intacta, para que la cara pintada siga encajada)
    let tri = 0;
    built.scene.traverse(m => {
      if (!m.isMesh || !m.geometry.index) return;
      let cabeza = false; for (let q = m; q; q = q.parent) if (/^Head/.test(q.name || '')) cabeza = true;
      const r = cabeza ? (o.cabeza ?? 1) : o.simplificar;
      const g = m.geometry, n = g.index.count;
      if (MS && r < 0.999 && n > 600) {
        try {
          const objetivo = Math.max(240, Math.floor(n * r / 3) * 3);
          const res = MS.simplify(new Uint32Array(g.index.array), new Float32Array(g.attributes.position.array), 3, objetivo, o.error || 0.01, ['LockBorder']);
          if (res[0] && res[0].length >= 3) g.setIndex(new THREE.BufferAttribute(new Uint32Array(res[0]), 1));
        } catch (e) { console.warn('simplificar', e); }
      }
      tri += g.index.count / 3;
    });
    // Público visto desde la carretera: la cara y el pelo, nítidos (o.maxTex); la ropa, a o.texRopa y sin mapas de
    // relieve (normal, rugosidad, oclusión), que de lejos no se ven y pesan más que el resto
    const achicar = new Map();
    const pequena = t => {
      if (!t || !t.image || !(t.image.width > o.texRopa)) return t;
      if (achicar.has(t)) return achicar.get(t);
      const k = o.texRopa / Math.max(t.image.width, t.image.height);
      const c = document.createElement('canvas'); c.width = Math.max(4, Math.round(t.image.width * k)); c.height = Math.max(4, Math.round(t.image.height * k));
      c.getContext('2d').drawImage(t.image, 0, 0, c.width, c.height);
      const n = new THREE.CanvasTexture(c);
      for (const p of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'channel']) n[p] = t[p];
      n.repeat.copy(t.repeat); n.offset.copy(t.offset); n.rotation = t.rotation; n.center.copy(t.center);
      achicar.set(t, n); return n;
    };
    built.scene.traverse(m => {
      if (!m.isMesh) return;
      let cabeza = false; for (let q = m; q; q = q.parent) if (/^Head/.test(q.name || '')) cabeza = true;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map(mt => {
        if (!mt) return mt;
        const n = mt.clone();
        n.normalMap = null; n.roughnessMap = null; n.metalnessMap = null; n.aoMap = null; n.bumpMap = null;
        const pelo = /cabello|hair|pelo/i.test(mt.name || '') || mt.isShaderMaterial;
        if (!(cabeza || pelo)) n.map = pequena(n.map);
        return n;
      });
      m.material = Array.isArray(m.material) ? mats : mats[0];
    });
    // el pelo (horneado con su color de raíz a punta): mate, que de lejos brillaba como un casco
    built.scene.traverse(m => { if (m.isMesh) for (const mt of [].concat(m.material)) if (mt && /cabello/i.test(mt.name || '')) mt.roughness = 0.85; });
    const glb = await new Promise((ok, mal) => new THREE.GLTFExporter().parse(built.scene, ok, mal, { binary: true, animations: clips, maxTextureSize: o.maxTex }));
    const q = new Uint8Array(glb); // sin cuantizar: lo hace gltfpack al simplificar
    let s = ''; for (let i = 0; i < q.length; i += 0x8000) s += String.fromCharCode.apply(null, q.subarray(i, i + 0x8000));
    built.scene.traverse(n => { if (n.isMesh) n.geometry.dispose(); });
    return { b64: btoa(s), triangulos: Math.round(tri), clips: clips.map(c => c.name) };
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
  const CARAS = path.join(__dirname, 'caras-amables');
  await p.route(/\/textures\/rostro_[^/?]+\.png(\?.*)?$/, r => {
    const f = path.join(CARAS, path.basename(new URL(r.request().url()).pathname));
    if (fs.existsSync(f)) r.fulfill({ path: f, contentType: 'image/png' }); else r.continue();
  });
  await p.goto(ESTUDIO);
  await p.waitForFunction(() => window.__rallysAldeanos && window.__studio && window.__studio.mannequinRoot, null, { timeout: 180000 });
  console.log('Oficios:', (await p.evaluate(() => __rallysAldeanos.oficios.map(o => o.id))).join(', '));
  const indice = [];
  for (const [id, genero, complexion, cara, peinado, pelo, ropa, semilla] of ALDEANOS.slice(0, +process.env.LIMITE || ALDEANOS.length)) {
    const info = await p.evaluate(o => __rallysAldeanos.generar(o), { genero, complexion, cara, peinado, pelo, ropa, semilla});
    await p.waitForTimeout(2500); // texturas y telas
    const tamanos = [];
    for (const v of VERSIONES) {
      const r = await p.evaluate(o => __rallysAldeanos.exportar(o), Object.assign({ clips: CLIPS, maxTex: 256, texRopa: 128, fps: 15 }, v.op));
      let buf = Buffer.from(r.b64, 'base64');
      if (gp) buf = await aligerar(gp, buf, v.gltfpack);
      fs.writeFileSync(path.join(SALIDA, id + v.sufijo + '.glb'), buf);
      tamanos.push(`${v.sufijo || 'lejos'} ${(buf.length / 1024).toFixed(0)} KB (${Math.round(r.triangulos / 1000)}k tri antes de gltfpack)`);
    }
    console.log(`${id}: ${tamanos.join(' · ')} · cara ${info.cara} · pelo ${info.pelo}`);
    indice.push({ id, archivo: 'aldeanos/' + id + '.glb', cerca: 'aldeanos/' + id + '-cerca.glb', genero, cara: info.cara });
  }
  fs.writeFileSync(path.join(SALIDA, 'indice.json'), JSON.stringify({ origen: 'narcimarquez-eng/Armaduras-glb · Generador de aldeanos (caras amables, pelo de tarjetas y ropa moderna)', animaciones: CLIPS, aldeanos: indice }, null, 2) + '\n');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
