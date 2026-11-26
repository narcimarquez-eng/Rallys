# Formato `.escenario.json` (versión 1)

Lo produce el Creador de Escenarios (exportar, o el guardado del navegador) y lo leen el visor y los juegos.
Unidades en **metros**. Ejes como en three.js: `x` y `z` en el suelo, `y` hacia arriba. El terreno está centrado en el origen.

```jsonc
{
  "format": "escenario-3d",       // siempre así
  "version": 1,
  "id": "esc-…", "nombre": "Circuito del valle", "descripcion": "",
  "plantilla": "rally",           // de qué plantilla salió (informativo)
  "semilla": 4242,
  "nextId": 31,                   // contador para ids nuevos
  "creado": "…", "actualizado": "…",
  "terreno": { … },
  "ambiente": { "hora": 13, "niebla": 0.35, "nubes": 0.4, "cielo": "auto" },
  "caminos": [ /* Camino */ ],
  "elementos": [ /* Elemento */ ],
  "enlaces": { "rpgBase": "https://narcimarquez-eng.github.io/Creador-de-mundos-Rpg/" },
  "glbs": { "m1a2b3": { "nombre": "torre", "tam": 123456, "bytes": "…base64 (solo si se exporta con modelos)…" } }
}
```

## Terreno
| Campo | Descripción |
|---|---|
| `tam` | Lado del terreno en metros. Va de `-tam/2` a `tam/2` en `x` y en `z`. |
| `res` | Puntos por lado de la rejilla (65, 129, 257 o 513). Distancia entre puntos: `tam / (res − 1)`. |
| `alturas` | `Float32Array` de `res × res` en **base64** (little-endian). Índice `j·res + i`; el punto `(i, j)` está en `x = −tam/2 + i·paso`, `z = −tam/2 + j·paso`. |
| `materiales` | `Uint8Array` de `res × res` en base64: material pintado en cada punto (0 = automático). Ver la tabla. |
| `vegetacion` | `Uint8Array` de `res × res` en base64 (opcional): vegetación baja pintada. 0 = automática, 255 = nada, 1–250 = `1 + tipo·50 + (densidad − 1)` con `tipo` 0 hierba, 1 trigo, 2 flores, 3 hierba alta, 4 bambú y `densidad` 1–50 (÷ 50). `Escenario.vegetacionEn(esc, x, z)` da lo que crece en un punto. |
| `hierbaAuto` | Densidad (0–1) de la hierba automática sobre los suelos de hierba, hierba seca y musgo. 0 = sin hierba automática. |
| `bioma` | `templado`, `desierto`, `tropical`, `nevado`, `volcanico` u `otono`: decide los materiales automáticos y el color del agua. |
| `gen` | Parámetros con los que se generó: `{ tipo, escala, altura, octavas, base, semilla }`. `tipo`: `plano`, `colinas`, `montanas`, `isla`, `archipielago`, `valle`, `dunas`, `mesetas`, `canon`, `crater`. |
| `agua` | `{ activa, nivel, color }`: plano de agua a esa altura (`color` null = el del bioma). |
| `bordes` | `cortado` (bloque) o `infinito` (en el visor el agua llega al horizonte y no se dibuja el borde). |

Materiales: 0 automático · 1 hierba · 2 hierba seca · 3 tierra · 4 roca · 5 arena · 6 nieve · 7 asfalto · 8 barro · 9 grava · 10 musgo · 11 ceniza · 12 hielo · 13 baldosa.

Altura en un punto cualquiera: interpolación bilineal (`Escenario.alturaEn`).

## Camino
```jsonc
{ "id": "c_1", "nombre": "Circuito", "tipo": "grava", "ancho": 11, "cerrado": true, "bordes": false,
  "puntos": [ { "x": -120, "z": 40 }, … ],
  "tramos": [ { "desde": 700, "hasta": 1100, "tipo": "asfalto" } ],
  "barreras": [ { "tipo": "guardarrail", "lado": "ambos", "desde": 700, "hasta": 1100, "separacion": 0.8 } ] }
```
Además, opcionales (los archivos de antes se cargan con listas vacías):
- `tramos: [{ desde, hasta, tipo }]`: superficie distinta entre dos distancias (m desde el inicio). Si se solapan, manda el último. En un circuito (`cerrado`) un tramo con `hasta < desde` pasa por la salida.
- `barreras: [{ tipo, lado, desde, hasta, separacion }]`: `tipo` = `cinta`, `valla_madera`, `guardarrail`, `neumaticos`, `muro`, `balas_paja`, `conos` o `valla_publi`; `lado` = `ambos`, `izq` o `der` (izquierda según el sentido del camino); `separacion` = metros desde el borde del camino.

Con `tipo: "riachuelo"` el camino es agua: corre del primer punto al último, `profundidad` (opcional, m) es la hondura del cauce (por defecto 22 % del ancho, entre 0,5 y 2 m).

Los puntos son de control: la línea real es una curva Catmull-Rom que pasa por ellos (`Escenario.muestrearCamino(c, paso)` → `[{ x, z, d }]`, `d` = metros desde el inicio). `cerrado` une el último con el primero (circuito). `tipo`: `tierra`, `grava`, `asfalto`, `piedra`, `arena`, `barro`, `nieve`. `bordes`: líneas blancas a los lados.

## Elemento
```jsonc
{ "id": "pue_3", "tipo": "pueblo", "nombre": "Valdris",
  "x": 120, "z": -340,     // posición en el suelo
  "y": 0,                  // metros por encima del terreno en (x, z)
  "rotY": 90,              // giro en grados; con 0 el elemento mira hacia +z
  "escala": 1,             // no se usa en las áreas (usan props.radio)
  "props": { … } }         // depende del tipo
```

| Tipo | Forma | `props` |
|---|---|---|
| `caja` | punto | `ancho, alto, fondo, color` |
| `plataforma` | punto | `ancho, fondo, grosor, color, borde` (color de la cara de arriba) |
| `rampa` | punto | `ancho, alto, largo, color` (sube hacia +z) |
| `cilindro`, `esfera` | punto | `radio, (alto), color` |
| `muro` | punto | `largo, alto, grosor, color` (a lo largo de x) |
| `arbol` | punto | `especie`: con modelo (`liquidambar`, `pinsapo`, `pino_pinonero`, `palmera_datilera`) o sencilla (`roble`, `pino`, `abeto`, `palmera`, `abedul`, `seco`, `cactus`); `alto` en m (0 = la del modelo) |
| `roca` | punto | `tam, color` |
| `bosque` | área | `radio, especie` (o `mixto`: mezcla según el bioma), `densidad` (árboles cada 1000 m²), `tamano` (× la altura de los árboles con modelo), `altoMin, altoMax` (árboles sencillos), `rocas, semilla` |
| `rocas` | área | `radio, cantidad, tamMin, tamMax, color, semilla` |
| `lago` | área | `radio, nivel` (altura del agua sobre el suelo del centro), `color`, `forma` (semilla de la orilla irregular; `Escenario.excavarLago` hace el vaso) |
| `puente` | punto | `modelo` (`romano`, `torreon`, `madera`, `riotinto`, `muelle`), `largo` y `ancho` (m; 0 = los del modelo), `camino` (id del camino que cruza). Cruza a lo largo de su X local (`rotY`); `Escenario.puentesDeCamino` da los tramos del camino que van por él. |
| `inicio` | punto | `color`. Salida del jugador, mirando a `rotY`. |
| `meta` | punto | `ancho, alto`. Arco de meta. |
| `checkpoint` | punto | `orden, ancho, alto, color` |
| `moneda` | punto | `color, tam`. Coleccionable. |
| `luz` | punto | `color, intensidad, alcance` |
| `cartel` | punto | `texto, color` |
| `camara` | punto | `altura, inclinacion`. Punto de vista para el visor (dirección = `rotY`). |
| `glb` | punto | `modelo`, `alturaObjetivo` (0 = tamaño original), `sombras`, `huella` (opcional, `[ancho, fondo]` en m: dentro de un pueblo, solar libre de casas y calles) |
| `enemigo` | punto | `modelo, alturaObjetivo, nivel` |
| `pueblo` | área | `radio, nivel, notas, cfg` — `cfg` es **la configuración del Creador de Pueblos** (la misma que `town.cfg` del Creador de Mundos: `style, terrainType, seed, size, houseDensity, …, rotation, exits, edits`). `cfg.exits[].angle` son las salidas (grados locales, `atan2(z, x)`); `Escenario.puntoSalidaPueblo(el, angulo)` da el punto del borde donde enlaza el camino. |
| `zona` | área | `radio, subtipo` (caza, elite, jefe, pvp, segura, arena), `nivelMin, nivelMax, semilla, enemigos: [{ modelo, cantidad, alto }]` |
| `mazmorra` | punto | `nivel, dungeon` — `dungeon` es la configuración del Creador de Mazmorras. |

### Modelos (`props.modelo`)
- `rpg:<ruta>`: archivo del Creador RPG, relativo a `enlaces.rpgBase` (p. ej. `rpg:glb/cabanas/cabana_5_redonda.glb`).
- `local:<id>`: modelo importado; sus datos están en el navegador y, si se exportó con modelos, en `glbs[id].bytes`.
- Una dirección `https://…` a un `.glb`.

Al dibujarlo se centra en `x`/`z`, se apoya en el suelo y, si `alturaObjetivo > 0`, se escala a esa altura.

## Añadir un tipo de elemento
```js
// En escenario-core.js (o en un script propio cargado después)
Escenario.registrarTipo({
  id: 'portal', nombre: 'Portal', icono: '🌀', grupo: 'juego', forma: 'punto',
  props: { destino: '', color: '#8e44ad' },
  campos: [{ k: 'destino', n: 'Destino', t: 'texto' }, { k: 'color', n: 'Color', t: 'color' }]
});
// En escena-3d.js: cómo se ve (devuelve un Object3D con la base en y = 0)
registrarDibujo('portal', (el, ctx) => { … });
```
Aparece solo en la paleta de **➕ Colocar** y en el panel de propiedades. Tipos de campo: `num`, `rango`, `color`, `bool`, `texto`, `sel` (con `op: [[valor, texto]]`), `glb` y `modelo`.

## Conexión con el Creador de Pueblos y el Creador de Mazmorras
El editor abre `<rpgBase>/creador-de-pueblos.html#mundo=<json>` con
`{ sessionId: "esc:<id del escenario>", townId, name, cfg, volver, claveRetorno: "escenarios.retornoPueblo" }`
(o `creador-de-mazmorras.html` con `dungeonId, dungeon` y `escenarios.retornoMazmorra`).
Al pulsar «Guardar y volver», el creador escribe `{ sessionId, townId, cfg }` (o `{ sessionId, dungeonId, dungeon }`) en
`localStorage[claveRetorno]` y vuelve a `volver` si es del mismo sitio. El editor lo aplica al arrancar.
