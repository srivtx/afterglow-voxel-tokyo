import { groundH, FINE, PAGODA, TORII, SHRINE, MAIN_HALF, trackDist } from './layout.js';
import { fbm3, hash3 } from '../rng.js';
import { oldStreet, districtStreet, onPath } from './terrain.js';

function blob(W, cx, cy, cz, rx, ry, rz, colorFn, seed, rough = 0.45) {
  const X = Math.ceil(rx + 2), Y = Math.ceil(ry + 2), Z = Math.ceil(rz + 2);
  for (let z = -Z; z <= Z; z++)
    for (let y = -Y; y <= Y; y++)
      for (let x = -X; x <= X; x++) {
        const d = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2);
        if (d > 1.3) continue;
        const wx = Math.round(cx + x), wy = Math.round(cy + y), wz = Math.round(cz + z);
        const n = fbm3(wx * 0.22 + seed, wy * 0.22, wz * 0.22, 3);
        if (d < 0.72 + (n - 0.5) * 2 * rough + 0.12) {
          const m = colorFn(y / ry, d, wx, wy, wz);
          if (m) W.put(wx, wy, wz, m);
        }
      }
}

function trunkLine(W, x0, y0, z0, x1, y1, z1, m, thick) {
  W.line(x0, y0, z0, x1, y1, z1, m, 0);
  if (thick) { W.line(x0 + 1, y0, z0, x1 + 1, y1, z1, m, 0); W.line(x0, y0, z0 + 1, x1, y1, z1 + 1, m, 0); W.line(x0 + 1, y0, z0 + 1, x1 + 1, y1, z1 + 1, m, 0); }
}

function petals(W, P, x, z, R, rng) {
  const pg = P.id('petalGround');
  const ok = new Set(['grass', 'grass2', 'grassDark', 'moss', 'gravel', 'dirt', 'cobble', 'cobble2', 'stone', 'stoneLight', 'sidewalk']
    .map((n) => P.id(n)));
  for (let dz = -R; dz <= R; dz++)
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz > R * R) continue;
      const gx = x + dx, gz = z + dz;
      const h = groundH(gx, gz);
      const cur = W.get(gx, h, gz);
      if (ok.has(cur) && rng.chance(0.42 * (1 - Math.sqrt(dx * dx + dz * dz) / (R + 1)) + 0.05)) W.set(gx, h, gz, pg);
    }
}

export function sakura(W, P, rng, x, z, s = 1, gy = groundH(x, z)) {
  const tr = P.id('trunk'), trd = P.id('trunkDark');
  const C = ['sakura1', 'sakura2', 'sakura3', 'sakura4', 'sakura5', 'sakuraDeep', 'sakuraGlow'].map((n) => P.id(n));
  const y0 = gy + 1;
  const th = Math.round(rng.range(5, 8) * s);
  const thick = s > 0.95;
  const lean = rng.range(0, Math.PI * 2), li = rng.range(0, 1.5) * s;
  const tx = x + Math.cos(lean) * li, tz = z + Math.sin(lean) * li;
  trunkLine(W, x, y0 - 1, z, tx, y0 + th, tz, trd, thick);
  const seed = rng.range(0, 100);
  const color = (yy, d, wx, wy, wz) => {
    const h = hash3(wx, wy, wz);
    if (h < 0.06) return C[6];
    if (yy > 0.35) return h < 0.5 ? C[2] : h < 0.8 ? C[0] : C[4];
    if (yy < -0.35) return h < 0.55 ? C[3] : C[5];
    return h < 0.45 ? C[0] : h < 0.85 ? C[1] : C[2];
  };
  const n = rng.int(3, 5);
  const ends = [[tx, y0 + th + 3 * s, tz, 6.5 * s]];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const L = rng.range(5, 9) * s, rise = rng.range(2, 5) * s;
    const ex = tx + Math.cos(a) * L, ez = tz + Math.sin(a) * L, ey = y0 + th + rise;
    W.line(tx, y0 + th, tz, ex, ey, ez, tr, 0);
    ends.push([ex, ey + 1, ez, rng.range(4.2, 6.2) * s]);
  }
  for (const [ex, ey, ez, r] of ends) blob(W, ex, ey, ez, r * 1.15, r * 0.78, r * 1.15, color, seed, 0.5);
  // drooping lower fringe
  for (const [ex, ey, ez, r] of ends.slice(1)) blob(W, ex, ey - r * 0.6, ez, r * 0.7, r * 0.35, r * 0.7, color, seed + 7, 0.6);
  petals(W, P, Math.round(tx), Math.round(tz), Math.round(9 * s), rng);
}

export function broadleaf(W, P, rng, x, z, s = 1, gy = groundH(x, z), maple = false) {
  const tr = P.id('trunk');
  const C = maple ? ['maple1', 'maple2', 'maple3'].map((n) => P.id(n)) : ['leaf1', 'leaf2', 'leaf3'].map((n) => P.id(n));
  const y0 = gy + 1, th = Math.round(rng.range(6, 9) * s);
  trunkLine(W, x, y0 - 1, z, x, y0 + th, z, tr, s > 1);
  const seed = rng.range(0, 100);
  const color = (yy, d, wx, wy, wz) => {
    const h = hash3(wx, wy, wz);
    if (yy > 0.3) return h < 0.6 ? C[1] : C[0];
    if (yy < -0.3) return h < 0.7 ? C[2] : C[0];
    return h < 0.5 ? C[0] : h < 0.8 ? C[1] : C[2];
  };
  const r = rng.range(6, 8.5) * s;
  blob(W, x, y0 + th + r * 0.5, z, r, r * 0.85, r, color, seed, 0.4);
  for (let i = 0; i < 3; i++) {
    const a = rng.range(0, Math.PI * 2);
    blob(W, x + Math.cos(a) * r * 0.7, y0 + th + rng.range(-1, 2), z + Math.sin(a) * r * 0.7, r * 0.6, r * 0.5, r * 0.6, color, seed + i, 0.45);
  }
}

// Japanese black pine with cloud-pruned pads (niwaki)
export function pine(W, P, rng, x, z, s = 1, gy = groundH(x, z)) {
  const tr = P.id('trunkDark');
  const C = [P.id('pine1'), P.id('pine2'), P.id('leaf3')];
  const y0 = gy + 1;
  let px = x, pz = z, py = y0 - 1;
  const H = Math.round(rng.range(12, 18) * s);
  const pts = [];
  const lean = rng.range(0, Math.PI * 2);
  for (let k = 1; k <= 4; k++) {
    const nx = x + Math.cos(lean + k * 0.7) * k * 1.2 * s, nz = z + Math.sin(lean + k * 0.7) * k * 1.2 * s, ny = y0 + (H * k) / 4;
    W.line(px, py, pz, nx, ny, nz, tr, 0); W.line(px + 1, py, pz, nx + 1, ny, nz, tr, 0);
    pts.push([nx, ny, nz]);
    px = nx; py = ny; pz = nz;
  }
  const color = (yy, d, wx, wy, wz) => (yy > 0.2 ? C[1] : hash3(wx, wy, wz) < 0.5 ? C[0] : C[2]);
  for (let i = 0; i < pts.length; i++) {
    const [bx, by, bz] = pts[i];
    const a = rng.range(0, Math.PI * 2), L = rng.range(3, 7) * s;
    const ex = bx + Math.cos(a) * L, ez = bz + Math.sin(a) * L;
    W.line(bx, by, bz, ex, by + 1, ez, tr, 0);
    const r = rng.range(3.5, 5.5) * s * (i === pts.length - 1 ? 1.1 : 1);
    blob(W, ex, by + 2, ez, r, r * 0.42, r, color, i * 3.1, 0.35);
    if (i > 0) blob(W, bx, by + 2, bz, r * 0.8, r * 0.38, r * 0.8, color, i * 7.3, 0.35);
  }
}

export function bush(W, P, x, z, r = 2.5) {
  const C = [P.id('bush'), P.id('leaf3'), P.id('leaf1')];
  const gy = groundH(x, z);
  blob(W, x, gy + r * 0.6, z, r, r * 0.7, r, (yy, d, wx, wy, wz) => C[Math.floor(hash3(wx, wy, wz) * 3)], x * 0.37, 0.4);
}

// ---------------------------------------------------------------------------
export function buildTrees(W, P, rng, reserve) {
  let n = 0;
  const plant = (fn, x, z, s, ...rest) => {
    const r = Math.ceil(6 * s);
    fn(W, P, rng, x, z, s, groundH(x, z), ...rest);
    reserve.mark(x - r, z - r, x + r, z + r, 2);
    n++;
  };
  // --- shrine approach: sakura avenue either side of the lantern path
  for (let z = 160; z >= 40; z -= rng.int(16, 22)) {
    if (Math.abs(z - TORII.z) < 9) continue;
    for (const [x, zz] of [[TORII.x - 18 + rng.int(-2, 2), z], ...(z < 60 ? [[TORII.x + 18 + rng.int(-2, 2), z + rng.int(-4, 4)]] : [])])
      if (reserve.free(x - 2, zz - 2, x + 2, zz + 2)) plant(sakura, x, zz, rng.range(0.95, 1.2));
  }
  plant(sakura, -38, 52, 1.35); plant(sakura, -90, 62, 1.3);
  plant(pine, -96, 96, 1.1); plant(pine, -100, 150, 0.95); plant(broadleaf, -98, 136, 1.2);
  plant(sakura, -96, 112, 1.2);
  plant(broadleaf, -104, 44, 1.1, true); plant(sakura, -112, 72, 1.1);

  // --- pagoda hill crown
  const ring = [[-84, -4, 1.15], [-40, -2, 1.05], [-42, -26, 1.1], [-82, -26, 1.0], [-70, -34, 0.9], [-52, -36, 0.9]];
  for (const [x, z, s] of ring) plant(sakura, x, z, s);
  plant(pine, -48, 6, 0.9); plant(pine, -78, 8, 0.85);
  plant(broadleaf, -94, -16, 1.2, true); plant(broadleaf, -96, 10, 1.15);
  plant(sakura, -100, -36, 1.25); plant(broadleaf, -110, 0, 1.3);
  plant(sakura, -32, 26, 1.2); plant(sakura, -88, 28, 1.1);

  // --- right foreground gardens
  for (const [x, z, s, kind] of [
    [68, 112, 1.3, 's'], [102, 104, 1.2, 's'], [36, 106, 1.1, 's'], [130, 96, 1.2, 'b'], [64, 68, 1.2, 's'],
    [100, 62, 1.1, 'm'], [134, 60, 1.0, 's'], [36, 150, 1.1, 'p'], [72, 158, 1.2, 's'], [118, 150, 1.2, 'b'],
    [38, 66, 1.0, 's'], [128, 20, 1.1, 's'], [60, 26, 1.1, 'b'], [92, 30, 1.0, 's'],
  ]) {
    if (!reserve.free(x - 3, z - 3, x + 3, z + 3)) continue;
    plant(kind === 's' ? sakura : kind === 'p' ? pine : broadleaf, x, z, s, kind === 'm');
  }

  // --- blossoms along the old street & the boulevard (leads the eye downhill)
  for (let z = 30; z > -52; z -= rng.int(12, 18)) {
    for (const side of [-1, 1]) {
      const x = side * (z < -52 ? 9 : MAIN_HALF + 2);
      if (trackDist(x, z) < 14) continue;
      if (z > -52 && !reserve.free(x - 1, z - 1, x + 1, z + 1)) continue;
      if (rng.chance(0.55)) { sakura(W, P, rng, x, z, z < -52 ? 0.7 : 0.75); n++; }
    }
  }

  // --- random scatter over free ground
  let tries = 0;
  while (tries++ < 900) {
    const x = rng.int(FINE.x0 + 6, FINE.x1 - 6), z = rng.int(-48, FINE.z1 - 4);
    if (oldStreet(x, z) || districtStreet(x, z) || onPath(x, z)) continue;
    if (Math.abs(x) < MAIN_HALF + 3) continue;
    if (!reserve.free(x - 6, z - 6, x + 6, z + 6)) continue;
    if (Math.abs(x - TORII.x) < 14 && z > 30 && z < 176) continue;
    const pd = Math.hypot(x - PAGODA.x, z - PAGODA.z);
    if (pd < 16) continue;
    if (trackDist(x, z) < 12) continue;
    if (x > SHRINE.x0 && x < SHRINE.x1 && z > 150) continue;
    if (z > 40 && x > -52 && x < 30) continue; // keep the hero sightline clear
    const r = rng.f();
    const s = rng.range(0.8, 1.2);
    if (r < 0.45) plant(sakura, x, z, s);
    else if (r < 0.7) plant(broadleaf, x, z, s, false);
    else if (r < 0.85) plant(pine, x, z, s);
    else plant(broadleaf, x, z, s, true);
    if (n > 140) break;
  }
  return n;
}
