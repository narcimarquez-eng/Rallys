// Exporta a coches/<diseño>.glb los diseños que trae el creador realista de Hacer coches (vendor/hacer-coches,
// copiado con tools/actualizar-hacer-coches.sh), en su versión ligera (gltfpack).
//
// Uso (con el juego servido en el puerto 8080, p. ej. «npm run servir» en otra terminal):
//   node tools/exportar-coches-fijos.cjs                  # todos
//   node tools/exportar-coches-fijos.cjs tucson retro     # solo esos
// Necesita Playwright (con su Chromium). Los datos de cada coche para la física están en coches/indice.json.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ viewport: { width: 640, height: 480 } });
  await pagina.goto('http://localhost:8080/vendor/hacer-coches/creador.html');
  await pagina.waitForFunction(() => window.__rallys, null, { timeout: 180000 });
  const presets = await pagina.evaluate(() => window.__rallys.presets);
  const elegidos = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(presets);
  for (const clave of elegidos) {
    const b64 = await pagina.evaluate(async clave => {
      const r = await window.__rallys.coche({ preset: clave, glb: true, ligero: true });
      let s = ''; for (let i = 0; i < r.bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, r.bytes.subarray(i, i + 0x8000));
      return btoa(s);
    }, clave);
    const destino = path.join(__dirname, '..', 'coches', clave + '.glb');
    fs.writeFileSync(destino, Buffer.from(b64, 'base64'));
    console.log(`${clave} (${presets[clave].nombre}) → coches/${clave}.glb, ${(fs.statSync(destino).size / 1e6).toFixed(1)} MB`);
  }
  // Fotos para las tarjetas del menú, hechas con el propio juego (coches/<diseño>.jpg)
  await pagina.goto('http://localhost:8080/');
  await pagina.waitForFunction(() => window.__rallys && window.__rallys.foto, null, { timeout: 60000 });
  for (const clave of elegidos) {
    const datos = await pagina.evaluate(archivo => window.__rallys.foto(archivo), `coches/${clave}.glb`);
    fs.writeFileSync(path.join(__dirname, '..', 'coches', clave + '.jpg'), Buffer.from(datos.split(',')[1], 'base64'));
    console.log(`foto → coches/${clave}.jpg`);
  }
  await navegador.close();
})();
