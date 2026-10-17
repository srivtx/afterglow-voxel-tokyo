import { VoxelWorld } from '../voxel.js';
import { fbm3, RNG } from '../rng.js';

export const CLOUD_SCALE = 9;
// Cumulus banks: [x, y, z, length, height, depth] in world units
const BANKS = [
  [-820, 760, -1500, 1100, 260, 420], [-200, 600, -1950, 760, 200, 300], [600, 860, -1700, 1000, 260, 380],
  [1150, 560, -1850, 640, 190, 280], [-560, 1180, -1050, 900, 240, 380], [420, 1260, -900, 760, 220, 340],
  [60, 420, -2500, 1500, 140, 260], [-1400, 600, -2150, 900, 220, 300], [1550, 760, -1200, 800, 220, 340],
  [-1200, 980, -1550, 640, 200, 280], [1050, 1080, -1300, 640, 190, 260], [-40, 1450, -1350, 700, 200, 320],
  [1500, 700, 300, 800, 220, 340], [-1500, 760, 300, 840, 220, 360], [0, 900, 1500, 1000, 220, 380],
  [-820, 820, 1150, 700, 200, 300], [900, 640, 1100, 700, 190, 300], [-200, 1350, 300, 900, 200, 440],
];

export function buildClouds(P) {
  const rng = new RNG(77);
  const C1 = P.id('cloud'), C2 = P.id('cloud2');
  const S = CLOUD_SCALE;
  const out = [];
  BANKS.forEach(([cx, cy, cz, L, H, D], bi) => {
    const W = new VoxelWorld(P, S, 'cloud' + bi);
    const hl = L / 2 / S, hh = H / S, hd = D / 2 / S;
    // a chain of puffs: big in the middle, smaller toward the ends, sitting on a common base
    const balls = [];
    const n = Math.round(rng.range(7, 13) * (L / 900));
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0 : (k / (n - 1)) * 2 - 1;
      const x = u * hl * 0.85 + rng.range(-2, 2);
      const taper = 1 - 0.55 * Math.abs(u) ** 1.5;
      const r = hh * rng.range(0.38, 0.62) * taper + 2;
      balls.push([x, r * 0.55 + rng.range(-1, 2), rng.range(-0.4, 0.4) * hd, r]);
    }
    // a few top puffs for the towering look
    for (let k = 0; k < Math.max(2, n / 3); k++) {
      const [bx, by, bz, br] = balls[rng.int(Math.floor(n * 0.25), Math.ceil(n * 0.75) - 1)];
      balls.push([bx + rng.range(-3, 3), by + br * 0.6, bz + rng.range(-2, 2), br * rng.range(0.55, 0.8)]);
    }
    const X = Math.ceil(hl + hh) + 2, Y = Math.ceil(hh * 1.8) + 3, Z = Math.ceil(hd + hh * 0.7) + 2;
    const seed = bi * 13.7;
    for (let z = -Z; z <= Z; z++)
      for (let y = 0; y <= Y; y++)
        for (let x = -X; x <= X; x++) {
          let best = 9;
          for (const [bx, by, bz, br] of balls) {
            const dz = (z - bz) / Math.max(hd * 0.8, br * 0.9);
            const d = ((x - bx) / br) ** 2 + ((y - by) / br) ** 2 + dz * dz;
            if (d < best) best = d;
          }
          if (best > 1.6) continue;
          const nz = fbm3(x * 0.17 + seed, y * 0.21, z * 0.17, 3);
          const base = 0.9 + (fbm3(x * 0.05, seed, z * 0.05, 2) - 0.5) * 3;
          if (y < base) continue;
          if (best < 0.78 + (nz - 0.5) * 1.2) W.set(x + X, y, z + Z, nz > 0.52 ? C1 : C2);
        }
    out.push({ world: W, x: cx - X * S, y: cy - (hh * 0.5) * S, z: cz - Z * S, drift: rng.range(1.5, 4) });
  });
  return out;
}
