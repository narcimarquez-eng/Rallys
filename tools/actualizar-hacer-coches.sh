#!/usr/bin/env bash
# Saca el generador de coches de Hacer coches (parametric_car.html) a un módulo que el juego puede importar:
# vendor/hacer-coches/generador.js.
#
# Uso:
#   tools/actualizar-hacer-coches.sh                         # desde ../Hacer-coches- (la carpeta de al lado)
#   tools/actualizar-hacer-coches.sh /ruta/a/Hacer-coches-
#   tools/actualizar-hacer-coches.sh --rama main             # clona esa rama de GitHub en una carpeta temporal
#
# El creador es una sola página con todo dentro (visor, interfaz y generador). Se copian tal cual, sin tocar ni una
# línea, las secciones «1. CONFIG» a «6. GEOMETRY BUILDERS» (parámetros, modelos base, texturas, materiales y piezas)
# y las funciones applyPresetGlass y randomize. Lo que esas funciones usan de la interfaz (markDirty, syncUI, las luces
# de las ruedas…) se sustituye por versiones vacías, y al final se exporta lo que usa juego/generador-coche.js.
set -euo pipefail
cd "$(dirname "$0")/.."
DESTINO=vendor/hacer-coches
REPO=https://github.com/narcimarquez-eng/Hacer-coches-.git

ORIGEN=../Hacer-coches-
if [ "${1:-}" = "--rama" ]; then
  TMP=$(mktemp -d)
  git clone --depth 1 --branch "$2" "$REPO" "$TMP/Hacer-coches-"
  ORIGEN="$TMP/Hacer-coches-"
elif [ -n "${1:-}" ]; then
  ORIGEN="$1"
fi
HTML="$ORIGEN/parametric_car.html"
[ -f "$HTML" ] || { echo "No encuentro $HTML"; exit 1; }

# Líneas de cada trozo, por sus marcas (los títulos de sección y las declaraciones de función)
ini=$(grep -n '^   1\. CONFIG' "$HTML" | cut -d: -f1)
fin=$(grep -n '^   7\. CAR_BUILDER' "$HTML" | cut -d: -f1)
[ -n "$ini" ] && [ -n "$fin" ] || { echo "No encuentro las secciones 1 a 6 en $HTML (¿ha cambiado el creador?)"; exit 1; }
funcion() { # imprime «function $1(…){ … }» hasta la primera línea que sea solo «}»
  awk -v f="function $1(" 'index($0, f) == 1 { dentro = 1 } dentro { print } dentro && /^}$/ { exit }' "$HTML"
}

mkdir -p "$DESTINO"
COMMIT=$(git -C "$ORIGEN" rev-parse --short HEAD 2>/dev/null || echo '?')
{
  echo "// GENERADO por tools/actualizar-hacer-coches.sh a partir de Hacer-coches-/parametric_car.html (commit $COMMIT)."
  echo "// No se edita a mano: los cambios se hacen en Hacer coches y se vuelve a ejecutar el script."
  echo "import * as THREE from 'three';"
  echo ""
  echo "// Lo que el código copiado usa de la página del creador (interfaz, luces de la escena), aquí sin efecto"
  echo "const markDirty = () => {}, syncUI = () => {}, setStatus = () => {};"
  echo "const wheelLightL = {}, wheelLightR = {};"
  sed -n "$((ini - 1)),$((fin - 2))p" "$HTML"
  echo ""
  funcion applyPresetGlass
  echo ""
  funcion randomize
  echo ""
  echo "export { CONFIG, DEFAULTS, PAINT_TYPES, PRESETS, CAR_COLLECTION, MAT, derive, createMaterials, updateMaterials,"
  echo "  applyPresetGlass, randomize, buildBody, buildCabin, buildFrontDetails, buildRearDetails, buildSideDetails,"
  echo "  buildInterior, buildWheels };"
} > "$DESTINO/generador.js"
echo "Origen: Hacer-coches- commit $COMMIT ($(date -u +%Y-%m-%d))" > "$DESTINO/ORIGEN.txt"
grep -q '^function applyPresetGlass' "$DESTINO/generador.js" && grep -q '^function randomize' "$DESTINO/generador.js" \
  || { echo "Faltan applyPresetGlass o randomize en el creador"; exit 1; }
echo "Hecho: $DESTINO/generador.js ($(wc -l < "$DESTINO/generador.js") líneas, commit $COMMIT)"
