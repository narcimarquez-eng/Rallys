#!/usr/bin/env python3
"""Caras amables para el público: retoca los rostros pintados del estudio de Armaduras-glb
(public/assets/aistudio/textures/rostro_*.png) que usa tools/exportar-aldeanos.cjs.

  · borra cicatrices y adornos (relleno por difusión desde el borde: la piel de alrededor se extiende hacia dentro)
  · sube un poco las comisuras de la boca (una sonrisa leve) y relaja el entrecejo

Uso: python3 tools/caras-amables.py <carpeta textures del estudio>  → tools/caras-amables/rostro_*.png
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter

ORIGEN = sys.argv[1] if len(sys.argv) > 1 else '../Armaduras-glb/public/assets/aistudio/textures'
SALIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'caras-amables')

# clave: (archivo, [zonas a borrar como (x0, y0, x1, y1) en la imagen de 410×543 o la suya], boca izq, boca der, cejas (y))
LAM = json.load(open(os.path.join(ORIGEN, 'rostros_lamina.json')))
def lam(k, borrar, sonrisa=1.0):
    d = LAM[k]
    return (f'rostro_{k}.png', borrar, d['mouthL'], d['mouthR'], d.get('browY', 190), sonrisa)
CARAS = {
    'ref_mujer':   ('rostro_ref_mujer.png', [], [152.0, 297.0], [236.0, 297.0], 137, 0.8),
    'ref_anciano': ('rostro_anciano.png', [], [152.0, 378.0], [267.0, 378.0], 192, 0.7),
    'ref_guerrero': ('rostro_guerrero.png', [(284, 150, 314, 205), (298, 248, 334, 296)], [147.0, 380.0], [265.0, 380.0], 190, 1.0),
    'lam_18_11': lam('lam_18_11', [(290, 250, 345, 308), (160, 95, 240, 185, 'liso')]),
    'lam_20_00': lam('lam_20_00', [(296, 245, 360, 305)]),
    'lam_20_12': lam('lam_20_12', [(280, 132, 326, 190), (298, 218, 334, 298)]),
    'lam_18_01': lam('lam_18_01', [(300, 240, 360, 305), (286, 100, 334, 176)]),
    'lam_18_02': lam('lam_18_02', [(290, 92, 346, 204), (58, 248, 132, 322, 'liso'), (315, 212, 358, 308)]),
}

def rellenar(img, zonas):
    """Tapa cada zona con la piel de alrededor: convolución normalizada (media gaussiana de lo que NO está tapado),
    con un poco de grano y el borde fundido, para que no se note el parche."""
    a = np.asarray(img).astype(np.float32)
    rgb, alfa = a[..., :3].copy(), (a[..., 3:] if a.shape[2] == 4 else None)
    h, w = rgb.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    mask = np.zeros((h, w), bool)
    for (x0, y0, x1, y1) in zonas:  # rectángulo con las esquinas redondeadas, un poco más grande
        cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 + 4, (y1 - y0) / 2 + 4
        mask |= (np.abs((xx - cx) / rx) ** 4 + np.abs((yy - cy) / ry) ** 4) <= 1.0
    if not mask.any(): return img
    # la piel sale solo de piel: alrededor, sin lo mucho más oscuro (pelo, cejas, sombras) ni lo muy rojo (cicatrices)
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    anillo = np.zeros_like(mask)
    for (x0, y0, x1, y1) in zonas:
        anillo |= (xx >= x0 - 18) & (xx <= x1 + 18) & (yy >= y0 - 18) & (yy <= y1 + 18)
    anillo &= ~mask
    ref = np.median(lum[anillo]) if anillo.any() else lum.mean()
    rojo = rgb[..., 0] - (rgb[..., 1] + rgb[..., 2]) / 2
    rojoRef = np.median(rojo[anillo]) if anillo.any() else 0
    piel = (lum > ref * 0.82) & (lum < ref * 1.25) & (rojo < rojoRef + 22)
    libre = ((~mask) & piel).astype(np.float32)
    def desenfocar(arr, r):  # gaussiana separable en numpy
        k = np.exp(-0.5 * (np.arange(-3 * r, 3 * r + 1) / r) ** 2); k /= k.sum()
        pad = 3 * r
        t = np.pad(arr, pad, mode='edge')
        t = np.apply_along_axis(lambda v: np.convolve(v, k, 'valid'), 0, t)
        t = np.apply_along_axis(lambda v: np.convolve(v, k, 'valid'), 1, t)
        return t.astype(np.float32)
    relleno = np.zeros_like(rgb)
    for r in (8, 16, 32):  # de cerca a lejos: lo que no alcance un radio lo alcanza el siguiente
        peso = desenfocar(libre, r)
        for c in range(3):
            v = desenfocar(rgb[..., c] * libre, r) / np.maximum(peso, 1e-4)
            hueco = (relleno[..., c] == 0) & (peso > 0.02)
            relleno[..., c][hueco] = v[hueco]
    rng = np.random.default_rng(7)
    relleno += rng.normal(0, 1.6, (h, w, 1)).astype(np.float32)
    m = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3)), np.float32) / 255
    m = np.maximum(m, mask.astype(np.float32))[..., None]
    rgb = rgb * (1 - m) + relleno * m
    res = np.concatenate([rgb, alfa], 2) if alfa is not None else rgb
    return Image.fromarray(np.clip(res, 0, 255).astype(np.uint8), img.mode)

def espejo(img, zonas, cx):
    """Tapa cada zona con la del otro lado de la cara (reflejada respecto a x = cx), igualando el color con lo de
    alrededor y fundiendo el borde: conserva la textura y las sombras de la piel pintada."""
    a = np.asarray(img).astype(np.float32)
    h, w = a.shape[:2]
    for (x0, y0, x1, y1) in zonas:
        yy, xx = np.mgrid[0:h, 0:w]
        rx, ry, mx, my = (x1 - x0) / 2 + 5, (y1 - y0) / 2 + 5, (x0 + x1) / 2, (y0 + y1) / 2
        m = (np.abs((xx - mx) / rx) ** 4 + np.abs((yy - my) / ry) ** 4) <= 1.0
        # borde fundido (8 px)
        fm = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5)), np.float32) / 255
        sx = np.clip(np.round(2 * cx - xx), 0, w - 1).astype(int)
        refl = a[yy, sx]
        anillo = (np.abs(xx - mx) < rx + 14) & (np.abs(yy - my) < ry + 14) & ~m
        anilloR = anillo[:, ::-1] if False else None
        # color: la media de alrededor del destino frente a la de alrededor de lo copiado
        dst = a[..., :3][anillo].mean(0)
        src = refl[..., :3][anillo].mean(0)
        refl = refl.copy(); refl[..., :3] += (dst - src)
        a = a * (1 - fm[..., None]) + refl * fm[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), img.mode)

def deformar(img, puntos):
    """Mueve la imagen alrededor de unos puntos: [(x, y, dx, dy, radio)] (muestreo inverso con caída gaussiana)."""
    a = np.asarray(img).astype(np.float32)
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = np.zeros((h, w), np.float32); dy = np.zeros((h, w), np.float32)
    for (px, py, mx, my, r) in puntos:
        g = np.exp(-((xx - px) ** 2 + (yy - py) ** 2) / (2 * r * r))
        dx += mx * g; dy += my * g
    sx, sy = np.clip(xx - dx, 0, w - 1), np.clip(yy - dy, 0, h - 1)
    x0, y0 = np.floor(sx).astype(int), np.floor(sy).astype(int)
    x1, y1 = np.minimum(x0 + 1, w - 1), np.minimum(y0 + 1, h - 1)
    fx, fy = (sx - x0)[..., None], (sy - y0)[..., None]
    v = a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x1] * fx * (1 - fy) + a[y1, x0] * (1 - fx) * fy + a[y1, x1] * fx * fy
    return Image.fromarray(np.clip(v, 0, 255).astype(np.uint8), img.mode)

os.makedirs(SALIDA, exist_ok=True)
for clave, (archivo, borrar, bi, bd, ceja, k) in CARAS.items():
    img = Image.open(os.path.join(ORIGEN, archivo))
    img = img.convert('RGBA' if img.mode in ('RGBA', 'LA', 'P') else 'RGB')
    cx = (bi[0] + bd[0]) / 2
    lisas = [z[:4] for z in borrar if len(z) > 4]          # frente, adornos: piel lisa de alrededor
    img = rellenar(img, lisas)
    img = espejo(img, [z[:4] for z in borrar if len(z) == 4], cx)  # cicatrices: la otra mejilla
    ancho = abs(bd[0] - bi[0])
    s = 1.45 * k * ancho / 110  # a la escala de cada boca
    cx = (bi[0] + bd[0]) / 2
    puntos = [
        (bi[0], bi[1], -1.5 * s, -6.0 * s, 15 * s + 6), (bd[0], bd[1], 1.5 * s, -6.0 * s, 15 * s + 6),   # comisuras arriba
        (bi[0] + 6, bi[1] - 26 * s, 0, -3.0 * s, 20 * s + 6), (bd[0] - 6, bd[1] - 26 * s, 0, -3.0 * s, 20 * s + 6),  # mejillas
        (cx - 22 * s, ceja + 8, -2.5 * s, -2.0 * s, 16 * s + 4), (cx + 22 * s, ceja + 8, 2.5 * s, -2.0 * s, 16 * s + 4),  # entrecejo relajado
    ]
    img = deformar(img, puntos)
    img.save(os.path.join(SALIDA, archivo))
    print('ok', clave, archivo, img.size)
json.dump({'caras': {k: v[0] for k, v in CARAS.items()}}, open(os.path.join(SALIDA, 'indice.json'), 'w'), indent=1)
