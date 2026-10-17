"""
AFTERGLOW - procedural texture library.

Blender's Principled BSDF with a flat base colour is the single biggest reason
the scene reads as a blockout. These generators build real image textures in
memory with numpy, assign them through UV coordinates, and pack them so the
glTF exporter embeds them in the .glb.

Nothing here needs an external image file, so the whole project stays
self-contained and reproducible.

Texture inventory
-----------------
  facade_*     : window-grid facades with varied lit/unlit cells (replaces
                 hundreds of individual window boxes)
  roof_*       : ridged ceramic roof tiles
  plaster_*    : weathered lime plaster with timber grain
  timber_*     : vertical cedar boards
  concrete_*   : panelised concrete for distant towers
  asphalt_*    : road surface
  sign_*       : neon signboards with glyph-like marks
  stone_*      : granite paving
"""

import bpy
import numpy as np


# ----------------------------------------------------------------------------
# Low-level helpers
# ----------------------------------------------------------------------------

def _smooth_noise(h, w, cells, rng, octaves=4, persistence=0.5):
    """Cheap fractal value noise: bilinear-upsampled random lattices."""
    h, w, cells = int(h), int(w), int(cells)
    total = np.zeros((h, w), dtype=np.float32)
    amp = 1.0
    norm = 0.0
    for o in range(octaves):
        c = max(2, int(cells * (2 ** o)))
        lattice = rng.random((c + 1, c + 1)).astype(np.float32)

        # Tile the lattice so the result wraps seamlessly.
        ys = np.linspace(0, c, h, endpoint=False)
        xs = np.linspace(0, c, w, endpoint=False)
        y0 = ys.astype(np.int32)
        x0 = xs.astype(np.int32)
        fy = (ys - y0)[:, None]
        fx = (xs - x0)[None, :]
        # Smoothstep interpolation
        fy = fy * fy * (3 - 2 * fy)
        fx = fx * fx * (3 - 2 * fx)

        v00 = lattice[np.ix_(y0, x0)]
        v01 = lattice[np.ix_(y0, x0 + 1)]
        v10 = lattice[np.ix_(y0 + 1, x0)]
        v11 = lattice[np.ix_(y0 + 1, x0 + 1)]

        top = v00 * (1 - fx) + v01 * fx
        bot = v10 * (1 - fx) + v11 * fx
        total += (top * (1 - fy) + bot * fy) * amp
        norm += amp
        amp *= persistence
    return total / max(norm, 1e-6)


def make_image(name, rgb, size=512):
    """
    rgb: (H, W, 3) float array in 0..1 (sRGB-ish). Creates and packs a
    Blender image with those pixels. Returns the image datablock.
    """
    h, w = rgb.shape[:2]
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, width=w, height=h, alpha=True)
    img.colorspace_settings.name = 'sRGB'

    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(rgb, 0.0, 1.0)
    # Blender image pixels are bottom-up.
    flat = rgba[::-1].ravel()
    img.pixels.foreach_set(flat)
    img.pack()
    return img


def textured_material(name, base_color, rough=0.75, image=None,
                      uv_scale=(1.0, 1.0), emission=0.0, emission_color=None,
                      metallic=0.0, detail_mix=0.0, detail_color=None,
                      roughness_from_image=False):
    """
    Principled material driven by an image through UV -> Mapping -> Image
    Texture. `detail_mix` blends a second noise image over the base for
    surface breakup.
    """
    mat = bpy.data.materials.get(name)
    if mat:
        bpy.data.materials.remove(mat)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]

    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (uv_scale[0], uv_scale[1], 1.0)

    nt.links.new(coord.outputs["UV"], mapping.inputs["Vector"])

    src_rgba = None
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        tex.extension = 'REPEAT'
        tex.interpolation = 'Smart'
        nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
        src_rgba = tex.outputs["Color"]

    if detail_mix > 0.0 and image is not None:
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 18.0
        noise.inputs["Detail"].default_value = 8.0
        noise.inputs["Roughness"].default_value = 0.6
        nt.links.new(mapping.outputs["Vector"], noise.inputs["Vector"])

        mix = nt.nodes.new("ShaderNodeMixRGB")
        mix.blend_type = 'MULTIPLY'
        mix.inputs["Fac"].default_value = detail_mix
        nt.links.new(src_rgba, mix.inputs[1])
        nt.links.new(noise.outputs["Fac"], mix.inputs[2])
        src_rgba = mix.outputs["Color"]

    if src_rgba is not None:
        nt.links.new(src_rgba, bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)

    if roughness_from_image and image is not None:
        rmap = nt.nodes.new("ShaderNodeTexImage")
        rmap.image = image
        nt.links.new(mapping.outputs["Vector"], rmap.inputs["Vector"])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (rough, rough, rough, 1)
        ramp.color_ramp.elements[1].color = (min(1.0, rough + 0.25),) * 3 + (1,)
        nt.links.new(rmap.outputs["Color"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Roughness"].default_value = rough

    bsdf.inputs["Metallic"].default_value = metallic

    if emission > 0:
        ec = emission_color or base_color
        if image is not None and detail_mix == 0.0:
            # Drive emission from the same map so lit windows glow correctly.
            nt.links.new(src_rgba, bsdf.inputs["Emission Color"])
        else:
            bsdf.inputs["Emission Color"].default_value = (*ec, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission

    return mat


# ----------------------------------------------------------------------------
# Facade generator: the highest-value texture in the project.
# ---------------------------------------------------------------------------

def _facade(windows_x, windows_y, lit_ratio, warm, cool, dark,
            rng, seed_tint=0.0):
    """
    Build one tileable facade cell image: a window grid where each cell is
    either dark glass, warm-lit interior, or cool fluorescent, with a frame
    and a sill. Returns an RGB array.
    """
    h = w = 256
    img = np.zeros((h, w, 3), dtype=np.float32)
    img[:, :] = dark

    mx, my = windows_x, windows_y
    cw, ch = w / mx, h / my

    for iy in range(my):
        for ix in range(mx):
            x0, x1 = int(ix * cw), int((ix + 1) * cw)
            y0, y1 = int(iy * ch), int((iy + 1) * ch)
            if x1 - x0 < 3 or y1 - y0 < 3:
                continue

            pad_x = max(1, int(cw * 0.22))
            pad_y = max(1, int(ch * 0.20))
            gx0, gx1 = x0 + pad_x, x1 - pad_x
            gy0, gy1 = y0 + pad_y, y1 - pad_y

            r = rng.random()
            if r < lit_ratio:
                if rng.random() < 0.72:
                    tint = warm
                else:
                    tint = cool
                # Interior gradient: brighter near the top of the pane.
                g = np.linspace(1.0, 0.55, gy1 - gy0, dtype=np.float32)[:, None]
                pane = np.array(tint, dtype=np.float32)[None, None, :] * g[:, :, None]
                # Occasional silhouette / blind pattern inside the pane.
                if rng.random() < 0.30:
                    bh = int((gy1 - gy0) * rng.uniform(0.25, 0.6))
                    pane[:bh, :, :] *= rng.uniform(0.25, 0.6)
            else:
                v = rng.uniform(0.55, 1.0)
                pane = np.array(dark, dtype=np.float32)[None, None, :] * v

            img[gy0:gy1, gx0:gx1, :] = pane

            # Sill highlight under each window.
            sy = min(h - 1, gy1)
            img[sy, gx0:gx1, :] = np.clip(img[sy, gx0:gx1, :] * 1.25 + 0.02, 0, 1)

    # Global vertical grime gradient + subtle per-pixel grain.
    grad = np.linspace(0.82, 1.06, h, dtype=np.float32)[:, None, None]
    img *= grad
    img += rng.normal(0, 0.012, img.shape).astype(np.float32)
    if seed_tint:
        img *= (1.0 + seed_tint)
    return np.clip(img, 0, 1)


def build_facade_textures(seed=1234, size=256):
    """
    Four independently tiling facade images, one per building style.

    Separate images (rather than one atlas) keep the material setup trivial --
    plain REPEAT mapping, no UV offset arithmetic -- and export cleanly to
    glTF, which does not support per-material texture transforms.
    """
    rng = np.random.default_rng(seed)
    warm = (1.0, 0.72, 0.42)
    cool = (0.72, 0.82, 1.0)

    # key -> (windows_x, windows_y, lit_ratio, dark)
    # Many small windows read as a tower; a couple of large ones read as a
    # low-rise. Mixing both keeps the skyline from looking uniform.
    specs = {
        "A": (4, 6, 0.46, (0.055, 0.060, 0.085)),
        "B": (6, 9, 0.34, (0.070, 0.072, 0.100)),
        "C": (2, 3, 0.58, (0.045, 0.048, 0.070)),
        "D": (8, 12, 0.28, (0.085, 0.085, 0.115)),
    }

    out = {}
    for key, (mx, my, lr, dark) in specs.items():
        cell = _facade(mx, my, lr, warm, cool, dark, rng)
        out[key] = make_image(f"AG_TEX_Facade{key}", cell, size)
    return out


# ----------------------------------------------------------------------------
# Surface textures
# ---------------------------------------------------------------------------

def build_roof_texture(seed=7, size=256):
    """Ridged ceramic roof tiles running horizontally, with per-tile value
    variation and a wet specular sheen band."""
    rng = np.random.default_rng(seed)
    h = w = size
    img = np.zeros((h, w, 3), dtype=np.float32)

    base = np.array([0.085, 0.075, 0.115], dtype=np.float32)
    img[:, :] = base

    rows = 10
    rh = h / rows
    for i in range(rows):
        y0, y1 = int(i * rh), int((i + 1) * rh)
        n_rows = y1 - y0
        if n_rows < 2:
            continue
        shade = rng.uniform(0.82, 1.20)
        # Rounded ridge profile across the tile's height.
        # sin() can dip a hair below zero at the endpoints, so clip before
        # the fractional power or the whole array becomes NaN.
        prof = np.clip(np.sin(np.linspace(0, np.pi, n_rows, dtype=np.float32)),
                       0.0, 1.0) ** 0.6
        # (n_rows, 1, 3) so it broadcasts across a tile column.
        band = base[None, None, :] * (0.65 + 0.75 * prof[:, None, None]) * shade

        # Vertical tile seams.
        cols = 14
        for j in range(cols):
            x0 = int(j * (w / cols))
            x1 = int((j + 1) * (w / cols))
            if x1 <= x0:
                continue
            cs = rng.uniform(0.85, 1.18)
            img[y0:y1, x0:x1, :] = band * cs
            # Dark seam line.
            if x1 < w:
                img[y0:y1, x1:x1 + 1, :] *= 0.45

        # Highlight along the top of each row (the overlap lip).
        img[y0:y0 + 2, :, :] = np.clip(base[None, :] * 2.4, 0, 1)

    img += rng.normal(0, 0.010, img.shape).astype(np.float32)
    return make_image("AG_TEX_Roof", np.clip(img, 0, 1))


def build_plaster_texture(seed=11, size=256):
    """Weathered lime plaster: soft mottling plus fine cracks."""
    rng = np.random.default_rng(seed)
    h = w = size
    n = _smooth_noise(h, w, 4, rng, octaves=5)
    base = np.array([0.46, 0.41, 0.36], dtype=np.float32)
    img = base[None, None, :] * (0.72 + 0.55 * n[:, :, None])

    # Thin cracks.
    for _ in range(9):
        x = rng.integers(0, w)
        y = rng.integers(0, h)
        length = rng.integers(12, 60)
        ang = rng.uniform(0, np.pi)
        for s in range(length):
            px = int(x + np.cos(ang) * s) % w
            py = int(y + np.sin(ang) * s + rng.normal(0, 0.7)) % h
            img[py, px] *= 0.55

    img += rng.normal(0, 0.012, img.shape).astype(np.float32)
    return make_image("AG_TEX_Plaster", np.clip(img, 0, 1))


def build_timber_texture(seed=17, size=256):
    """Vertical cedar boards with grain."""
    rng = np.random.default_rng(seed)
    h = w = size
    img = np.zeros((h, w, 3), dtype=np.float32)
    boards = 8
    bw = w / boards
    for b in range(boards):
        x0, x1 = int(b * bw), int((b + 1) * bw)
        if x1 <= x0:
            continue
        tone = rng.uniform(0.80, 1.18)
        base = np.array([0.30, 0.155, 0.075], dtype=np.float32) * tone
        grain = _smooth_noise(h, 8, 3, rng, octaves=4)
        # Collapse the 8px width so the grain varies vertically only, giving
        # (h, 1, 1) which broadcasts across the board to (h, w_board, 3).
        g = grain[:, 0][:, None, None]
        col = base[None, None, :] * (0.75 + 0.5 * g)
        img[:, x0:x1, :] = col
        if x1 < w:
            img[:, x1:x1 + 1, :] *= 0.35      # board gap
    img += rng.normal(0, 0.010, img.shape).astype(np.float32)
    return make_image("AG_TEX_Timber", np.clip(img, 0, 1))


def build_concrete_texture(seed=23, size=256):
    """Panelised concrete with form-tie marks and streaking."""
    rng = np.random.default_rng(seed)
    h = w = size
    n = _smooth_noise(h, w, 3, rng, octaves=5)
    base = np.array([0.16, 0.155, 0.19], dtype=np.float32)
    img = base[None, None, :] * (0.70 + 0.60 * n[:, :, None])

    # Panel joints every 64px.
    for k in range(1, 4):
        img[int(k * size / 4):int(k * size / 4) + 2, :, :] *= 0.5
        img[:, int(k * size / 4):int(k * size / 4) + 2, :] *= 0.5

    # Vertical rain streaks.
    for _ in range(26):
        x = rng.integers(0, w)
        y0 = rng.integers(0, h // 2)
        ln = rng.integers(h // 4, h)
        img[y0:min(h, y0 + ln), x, :] *= rng.uniform(0.72, 0.94)

    img += rng.normal(0, 0.012, img.shape).astype(np.float32)
    return make_image("AG_TEX_Concrete", np.clip(img, 0, 1))


def build_asphalt_texture(seed=29, size=256):
    rng = np.random.default_rng(seed)
    h = w = size
    n = _smooth_noise(h, w, 12, rng, octaves=5)
    base = np.array([0.055, 0.052, 0.070], dtype=np.float32)
    img = base[None, None, :] * (0.65 + 0.75 * n[:, :, None])
    img += rng.normal(0, 0.018, img.shape).astype(np.float32)
    return make_image("AG_TEX_Asphalt", np.clip(img, 0, 1))


def build_stone_texture(seed=31, size=256):
    """Granite paving slabs with mortar joints."""
    rng = np.random.default_rng(seed)
    h = w = size
    img = np.zeros((h, w, 3), dtype=np.float32)
    base = np.array([0.20, 0.19, 0.21], dtype=np.float32)
    tiles = 4
    th = h / tiles
    for ty in range(tiles):
        for tx in range(tiles):
            y0, y1 = int(ty * th), int((ty + 1) * th)
            x0, x1 = int(tx * th), int((tx + 1) * th)
            v = rng.uniform(0.82, 1.18)
            n = _smooth_noise(y1 - y0, x1 - x0, 3, rng, octaves=4)
            img[y0:y1, x0:x1, :] = base[None, None, :] * v * (0.72 + 0.55 * n[:, :, None])
            img[y0:y0 + 2, x0:x1, :] *= 0.5
            img[y0:y1, x0:x0 + 2, :] *= 0.5
    img += rng.normal(0, 0.014, img.shape).astype(np.float32)
    return make_image("AG_TEX_Stone", np.clip(img, 0, 1))


# ----------------------------------------------------------------------------
# Neon sign textures with glyph-like marks
# ----------------------------------------------------------------------------

def build_sign_textures(seed=41, size=256):
    """
    Vertical signboard faces. Rather than meaningless noise, each carries
    blocky abstract 'glyph' marks laid out in a column, which is what reads as
    signage at a distance without needing a real font or real language.
    """
    rng = np.random.default_rng(seed)
    specs = {
        "Cyan":   ((0.05, 0.62, 0.72), "AG_TEX_SignCyan"),
        "Pink":   ((0.72, 0.14, 0.34), "AG_TEX_SignPink"),
        "Amber":  ((0.78, 0.48, 0.06), "AG_TEX_SignAmber"),
        "Red":    ((0.70, 0.08, 0.08), "AG_TEX_SignRed"),
        "Green":  ((0.16, 0.62, 0.24), "AG_TEX_SignGreen"),
        "Violet": ((0.45, 0.16, 0.70), "AG_TEX_SignViolet"),
    }
    imgs = {}
    for name, (col, img_name) in specs.items():
        h = w = size
        img = np.zeros((h, w, 3), dtype=np.float32)
        img[:, :] = np.array(col, dtype=np.float32) * 0.16   # dark board

        # Bright border frame.
        b = 6
        img[:b, :] = np.array(col, dtype=np.float32)
        img[-b:, :] = np.array(col, dtype=np.float32)
        img[:, :b] = np.array(col, dtype=np.float32)
        img[:, -b:] = np.array(col, dtype=np.float32)

        # 4 stacked glyph blocks.
        cells = 4
        ch = (h - 2 * b) // cells
        for c in range(cells):
            y0 = b + c * ch + 4
            y1 = b + (c + 1) * ch - 4
            if y1 - y0 < 6:
                continue
            # Each glyph = a random rectilinear arrangement of strokes.
            strokes = rng.integers(3, 6)
            for _ in range(strokes):
                horiz = rng.random() > 0.5
                t = max(2, int((y1 - y0) * rng.uniform(0.08, 0.18)))
                if horiz:
                    yy = rng.integers(y0, max(y0 + 1, y1 - t))
                    xx0 = b + 10
                    xx1 = w - b - 10
                    ln = int((xx1 - xx0) * rng.uniform(0.45, 1.0))
                    img[yy:yy + t, xx0:xx0 + ln, :] = np.array(col, dtype=np.float32) * 1.5
                else:
                    xx = rng.integers(b + 10, max(b + 11, w - b - 10 - t))
                    ln = int((y1 - y0) * rng.uniform(0.4, 0.9))
                    img[y0:y0 + ln, xx:xx + t, :] = np.array(col, dtype=np.float32) * 1.5

        img = np.clip(img, 0, 1)
        img += rng.normal(0, 0.010, img.shape).astype(np.float32)
        imgs[name] = make_image(img_name, np.clip(img, 0, 1))
    return imgs