import * as THREE from 'three';
import { VoxelWorld, meshWorld } from './voxel.js';
import { rasterText } from './build/layout.js';
import { NEON_COLORS, PANEL_COLORS } from './palette.js';

// ---------------------------------------------------------------------------
// 看板 Your own neon: a billboard hung on the railway girder, right over the
// street in the hero view. Built in track-local coordinates like the viaduct.
// ---------------------------------------------------------------------------
export const SIGN_COLORS = ['pink', 'cyan', 'yellow', 'purple', 'green', 'orange', 'red', 'white'];

let current = null;

export async function setCustomSign(city, opts) {
  if (current) {
    current.parent?.remove(current);
    current.traverse((o) => o.geometry?.dispose());
    current = null;
  }
  const text = (opts?.text || '').trim().slice(0, 14);
  if (!text) return null;
  const color = SIGN_COLORS.includes(opts.color) ? opts.color : 'pink';
  const style = opts.style === 'panel' ? 'panel' : 'neon';
  const P = city.palette;

  let bmp = null;
  for (let px = 11; px >= 7; px--) { bmp = rasterText(text, px); if (bmp.w <= 58) break; }
  const pad = 3, w = bmp.w + pad * 2, h = bmp.h + pad * 2;
  const x0 = -Math.floor(w / 2), yTop = 26 + Math.ceil(h / 2);
  const W = new VoxelWorld(P, 1, 'custom-sign');
  const neon = (c) => P.id(`neon_${c}_5`);
  const frame = P.id('signFrame'), steel = P.id('steel');
  const panelCol = { pink: 'pink', cyan: 'teal', yellow: 'yellow', purple: 'purple', green: 'teal', orange: 'orange', red: 'red', white: 'white' }[color];
  const panel = style === 'panel' ? P.id('panel_' + panelCol) : P.id('panelDark');
  const textM = style === 'panel' ? neon(color === 'white' || color === 'yellow' ? 'red' : 'white') : neon(color);
  const border = style === 'panel' ? neon('white') : neon(color === 'cyan' ? 'pink' : 'cyan');
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = x0 + i, y = yTop - j;
      W.set(x + 64, y, 13, frame);
      const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
      W.set(x + 64, y, 14, edge ? border : panel);
      const bx = i - pad, by = j - pad;
      if (bx >= 0 && by >= 0 && bx < bmp.w && by < bmp.h && bmp.bits[bx + by * bmp.w]) W.set(x + 64, y, 15, textM);
    }
  // brackets back to the girder
  for (let i = 4; i < w - 2; i += 9) for (const y of [yTop - 2, yTop - h + 3]) W.set(x0 + i + 64, y, 12, steel);
  const lc = style === 'panel' ? PANEL_COLORS[panelCol] : NEON_COLORS[color];
  W.light(64, yTop - h / 2, 22, lc, 0.7, Math.max(18, w * 0.6));

  const g = new THREE.Group();
  g.name = 'custom-sign';
  g.position.x = -64; // built shifted so all voxels sit at x >= 0
  await meshWorld(W, city.material, g, { shadows: false, freeData: true });
  city.rail.add(g);
  current = g;
  return { text, color, style };
}
