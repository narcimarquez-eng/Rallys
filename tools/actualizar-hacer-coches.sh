#!/usr/bin/env bash
# Copia el creador de coches realista de Hacer coches («Parametric Car 3D Studio (2).html», con las piezas de Blender
# dentro) en vendor/hacer-coches/creador.html, para que el juego genere coches con él.
#
# Uso:
#   tools/actualizar-hacer-coches.sh                                  # rama ccr-b02f9bfd-g5ar6l de GitHub (la más nueva)
#   tools/actualizar-hacer-coches.sh --rama main                      # otra rama de GitHub
#   tools/actualizar-hacer-coches.sh /ruta/a/Hacer-coches-            # una carpeta local, tal como esté
#
# La página se copia entera, sin tocar nada de lo que hay: el juego la abre oculta en un <iframe> y el coche sale
# exactamente igual que en el creador. Solo se le añade al final del módulo un «puente» (window.__rallys, más abajo)
# para pedirle desde el juego un coche (aleatorio con semilla, o uno de sus diseños) y recibirlo (el grupo de three.js o un .glb). También se
# copia vendor/gltfpack (para exportar en versión ligera los coches fijos de coches/).
set -euo pipefail
cd "$(dirname "$0")/.."
DESTINO=vendor/hacer-coches
REPO=https://github.com/narcimarquez-eng/Hacer-coches-.git
PAGINA="Parametric Car 3D Studio (2).html"

RAMA=ccr-b02f9bfd-g5ar6l
ORIGEN=""
if [ "${1:-}" = "--rama" ]; then RAMA="$2"; elif [ -n "${1:-}" ]; then ORIGEN="$1"; fi
if [ -z "$ORIGEN" ]; then
  TMP=$(mktemp -d)
  git clone --depth 1 --branch "$RAMA" "$REPO" "$TMP/Hacer-coches-"
  ORIGEN="$TMP/Hacer-coches-"
fi
[ -f "$ORIGEN/$PAGINA" ] || { echo "No encuentro «$PAGINA» en $ORIGEN"; exit 1; }
grep -q '^(function animate(){' "$ORIGEN/$PAGINA" || { echo "El creador ha cambiado: no encuentro su bucle «animate»"; exit 1; }

rm -rf "$DESTINO"
mkdir -p "$DESTINO/vendor"
cp -r "$ORIGEN/vendor/gltfpack" "$DESTINO/vendor/" 2>/dev/null || echo "(sin vendor/gltfpack: los coches fijos se exportarán sin comprimir)"

# El puente va justo antes del último </script> (el del módulo principal), cuando todo el creador ya está cargado
python3 - "$ORIGEN/$PAGINA" "$DESTINO/creador.html" <<'PY'
import sys
html = open(sys.argv[1], encoding='utf-8').read()
puente = r'''
// ── [Rallys] Puente para el juego (lo añade tools/actualizar-hacer-coches.sh; no es parte del creador) ──────────
// El juego abre esta página oculta y llama a window.__rallys.coche({ semilla }) o ({ preset }) para recibir el coche
// (el grupo de three.js, o un .glb con glb: true). randomize() usa Math.random: se cambia un momento por uno con semilla para que el mismo número dé
// siempre el mismo coche.
{
  const azar = semilla => {
    let a = semilla >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  // Dibujo de neumático según la carrocería (el creador no lo sortea): da el agarre del coche en el juego
  const NEUMATICOS = { suv: ['all-terrain', 'all-terrain', 'sport'], coupe: ['racing', 'racing', 'sport'],
    compact: ['sport', 'racing', 'all-terrain'], sedan: ['sport', 'sport', 'racing', 'all-terrain'], limousine: ['sport'] };
  async function exportar(ligero){
    const ocultos = [];
    car.traverse(o => { if (o.userData.editorOnly && o.visible){ ocultos.push(o); o.visible = false; } });
    if (zoneHighlight && zoneHighlight.visible){ ocultos.push(zoneHighlight); zoneHighlight.visible = false; }
    try {
      let bytes = new Uint8Array(await new GLTFExporter().parseAsync(car, { binary: true, onlyVisible: true }));
      if (ligero) bytes = await packGLB(bytes);
      return bytes;
    } finally { for (const o of ocultos) o.visible = true; }
  }
  window.__rallys = {
    presets: Object.fromEntries(Object.entries(FIVE_CARS).map(([k, p]) => [k, { nombre: p.name, modelo: p.model }])),
    async coche({ semilla, preset, glb, ligero }){
      if (showroomMode) toggleShowroom();
      if (preset){
        Object.assign(CONFIG, presetConfig(preset));
        applyPresetGlass(CONFIG.model, preset);
      } else {
        Object.assign(CONFIG, JSON.parse(JSON.stringify(DEFAULTS)));
        const original = Math.random;
        Math.random = azar(semilla);
        try {
          randomize();
          const lista = NEUMATICOS[CONFIG.model] || ['sport'];
          CONFIG.tire.treadStyle = lista[Math.floor(Math.random() * lista.length)];
        } finally { Math.random = original; }
      }
      updateMaterials();
      const t0 = performance.now();
      buildCar();
      dirty = false;
      const t1 = performance.now();
      const config = JSON.parse(JSON.stringify(CONFIG));
      // glb: el coche exportado (lento: para guardarlo en un archivo). Si no, el grupo de three.js tal cual, que el
      // juego copia a su lado (juego/generador-coche.js); vale hasta el siguiente coche que se pida.
      if (!glb) return { objeto: car, config, ms: { construir: Math.round(t1 - t0) } };
      const bytes = await exportar(ligero);
      return { bytes, config, ms: { construir: Math.round(t1 - t0), exportar: Math.round(performance.now() - t1) } };
    },
    // Mientras está oculta, que dibuje lo mínimo
    dormir(){ RENDER.quality = 'basica'; renderer.setPixelRatio(1); renderer.setSize(2, 2, false); }
  };
  window.__rallys.dormir();
  window.dispatchEvent(new Event('rallys-listo'));
}
'''
i = html.rfind('</script>')
assert i > 0
open(sys.argv[2], 'w', encoding='utf-8').write(html[:i] + puente + html[i:])
PY

COMMIT=$(git -C "$ORIGEN" rev-parse --short HEAD 2>/dev/null || echo '?')
echo "Origen: Hacer-coches- «$PAGINA», rama ${RAMA}, commit $COMMIT ($(date -u +%Y-%m-%d))" > "$DESTINO/ORIGEN.txt"
echo "Hecho: $DESTINO/creador.html ($(du -h "$DESTINO/creador.html" | cut -f1), commit $COMMIT)"
