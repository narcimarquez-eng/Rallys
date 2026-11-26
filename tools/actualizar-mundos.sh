#!/usr/bin/env bash
# Copia en vendor/mundos/ los módulos y recursos de Mundos- (el Creador de Escenarios) que usa el juego.
#
# Uso:
#   tools/actualizar-mundos.sh                      # desde ../Mundos- (la carpeta de al lado), tal como esté
#   tools/actualizar-mundos.sh /ruta/a/Mundos-      # desde otra carpeta
#   tools/actualizar-mundos.sh --rama claude/world-generator-viewer-kk0hn3
#                                                   # clona esa rama de GitHub en una carpeta temporal y copia de ahí
#
# Se copian sin cambios: el juego los usa tal cual (la página pone <base href="vendor/mundos/"> para que las rutas
# relativas de Mundos-, como 'assets/…' o 'glb/…', sigan funcionando). Queda anotado de qué commit salen en
# vendor/mundos/ORIGEN.txt.
set -euo pipefail
cd "$(dirname "$0")/.."
DESTINO=vendor/mundos
REPO=https://github.com/narcimarquez-eng/Mundos-.git

ORIGEN=../Mundos-
if [ "${1:-}" = "--rama" ]; then
  TMP=$(mktemp -d)
  git clone --depth 1 --branch "$2" "$REPO" "$TMP/Mundos-"
  ORIGEN="$TMP/Mundos-"
elif [ -n "${1:-}" ]; then
  ORIGEN="$1"
fi
[ -f "$ORIGEN/js/escenario-core.js" ] || { echo "No encuentro Mundos- en $ORIGEN"; exit 1; }

# Módulos de dibujo y núcleo (los mismos que carga el visor) y el generador de pueblos que pueblos3d.js carga al acercarse
JS="escenario-core.js escena-3d.js vegetacion.js pradera.js pradera-atlas.js rocas.js agua.js suelos.js pueblos3d.js
    texturas-lib.js almacen.js casa-madera.js puestos-datos.js three-puente.js arboles.js pueblo-edits.js casas-glb.js village-core.js"
# Modelos: árboles, casas y piezas del pueblo, edificios (la iglesia) y puentes
GLB="arboles pueblo edificios puente0.glb puente1.glb puente3.glb muelle_riotinto_odiel_juego_web.glb muelle_recto_juego_web.glb muelle_curvo_juego_web.glb"

rm -rf "$DESTINO"
mkdir -p "$DESTINO/js" "$DESTINO/glb" "$DESTINO/docs"
for f in $JS; do cp "$ORIGEN/js/$f" "$DESTINO/js/"; done
for f in $GLB; do cp -r "$ORIGEN/glb/$f" "$DESTINO/glb/"; done
cp -r "$ORIGEN/assets" "$DESTINO/"
cp "$ORIGEN/docs/FORMATO-ESCENARIO.md" "$ORIGEN/docs/ASSETS-CREADOR-RPG.md" "$DESTINO/docs/" 2>/dev/null || true

# En Node, escenario-core.js se carga con require (las pruebas): que no lo tome por un módulo ES del juego
echo '{ "type": "commonjs" }' > "$DESTINO/package.json"
{
  echo "Copia de Mundos- (https://github.com/narcimarquez-eng/Mundos-) hecha con tools/actualizar-mundos.sh"
  echo "Fecha: $(date -u +%Y-%m-%dT%H:%MZ)"
  if git -C "$ORIGEN" rev-parse HEAD >/dev/null 2>&1; then
    echo "Commit: $(git -C "$ORIGEN" rev-parse HEAD)"
    echo "Rama: $(git -C "$ORIGEN" rev-parse --abbrev-ref HEAD)"
    echo "Último cambio: $(git -C "$ORIGEN" log -1 --format=%s)"
  fi
  echo "No edites estos archivos aquí: los cambios se hacen en Mundos- y se vuelven a copiar."
} > "$DESTINO/ORIGEN.txt"
echo "Copiado en $DESTINO ($(du -sh "$DESTINO" | cut -f1))"
cat "$DESTINO/ORIGEN.txt"
