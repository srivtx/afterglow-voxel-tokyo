import { TOWER, HERO, trackDist } from './layout.js';
import { hash3 } from '../rng.js';

// Distance from point to the hero->tower sightline (keeps the tower framed).
function sightDist(x, z) {
  const ax = HERO.pos[0], az = HERO.pos[2], bx = TOWER.x, bz = TOWER.z;
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

function heightAt(x, z, rng) {
  const g = (cx, cz, r, a) => a * Math.exp(-(((x - cx) ** 2 + (z - cz) ** 2) / (r * r)));
  let h = 34 + g(140, -620, 320, 140) + g(-340, -480, 230, 110) + g(400, -300, 200, 90) + g(-60, -860, 300, 80);
  h *= rng.range(0.5, 1.2);
  // keep the near ring low so the sky stays open above the skyline
  const dCam = Math.hypot(x - HERO.pos[0], z - HERO.pos[2]);
  h = Math.min(h, 20 + Math.max(0, dCam - 300) * 0.32);
  if (z > -210) h = Math.min(h, rng.range(16, 48));
  if (z > 180) h = Math.min(h, rng.range(14, 40));
  if (sightDist(x, z) < 70 && z > TOWER.z) h = Math.min(h, 26);
  if (trackDist(x, z) < 22) h = Math.min(h, 14);
  return h;
}

// Builds a tower block in a coarse world. Coordinates are in that world's voxels.
function tower(W, P, rng, x0, z0, x1, z1, h, seed) {
  const conc = P.id('conc' + rng.int(0, 9));
  const style = rng.pick(['grid', 'grid', 'glass', 'fins', 'band']);
  const lit = rng.range(0.18, 0.55);
  const warm = rng.chance(0.55);
  const on = P.id(warm ? 'winWarm2' : rng.chance(0.75) ? 'winCool' : 'winTeal');
  const on2 = P.id(warm ? 'winWarm' : 'winCool');
  const off = P.id('winOff'), glass = P.id(rng.chance(0.5) ? 'glass' : 'glass2'), dark = P.id('concDark');
  const sb1 = h > 40 && rng.chance(0.6) ? Math.round(h * rng.range(0.6, 0.8)) : 1e9;
  const sb2 = sb1 < 1e9 && rng.chance(0.5) ? Math.round(h * rng.range(0.85, 0.93)) : 1e9;
  const inset = (y) => (y > sb2 ? 4 : y > sb1 ? 2 : 0);
  for (let y = 0; y <= h; y++) {
    const k = inset(y);
    const ax = x0 + k, bx = x1 - k, az = z0 + k, bz = z1 - k;
    if (ax >= bx || az >= bz) break;
    for (let z = az; z <= bz; z++)
      for (let x = ax; x <= bx; x++) {
        const ex = x === ax || x === bx, ez = z === az || z === bz;
        if (!ex && !ez) { if (y === h || inset(y + 1) !== k) W.set(x, y, z, P.id('rooftop')); else W.set(x, y, z, conc); continue; }
        if (ex && ez) { W.set(x, y, z, conc); continue; }
        const u = ez ? x : z;
        const face = (ez ? (z === az ? 1 : 2) : (x === ax ? 3 : 4));
        const lon = hash3(seed + (u >> 1), y >> 1, face) < lit;
        const wm = hash3(seed, u, y) < 0.12 ? on2 : on;
        let m;
        if (y < 2) m = (u % 3 ? P.id('shopWarm') : dark);
        else if (style === 'glass') m = y % 3 === 0 ? glass : lon ? wm : glass;
        else if (style === 'fins') m = u % 3 === 0 ? conc : lon ? wm : off;
        else if (style === 'band') m = y % 2 === 0 ? conc : lon ? wm : off;
        else m = y % 2 === 1 && u % 2 === 1 ? (lon ? wm : off) : conc;
        W.set(x, y, z, m);
      }
  }
  const topK = inset(h), cx = Math.round((x0 + x1) / 2), cz = Math.round((z0 + z1) / 2);
  if (h > 50 && rng.chance(0.45)) {
    for (let z = z0 + topK; z <= z1 - topK; z++) for (let x = x0 + topK; x <= x1 - topK; x++)
      if (x === x0 + topK || x === x1 - topK || z === z0 + topK || z === z1 - topK) W.set(x, h - 1, z, P.id('ledCrown'));
  }
  if (h > 34 && W.scale <= 3 && rng.chance(0.4)) {
    const ah = rng.int(2, 6);
    for (let y = h + 1; y <= h + ah; y++) W.set(cx, y, cz, P.id('antenna'));
    W.set(cx, h + ah + 1, cz, P.id('aviation'));
  }
  if (rng.chance(0.5)) W.box(cx - 1, h + 1, cz - 1, cx + 1, h + 2, cz + 1, P.id('ac'));
}

// Coarse ring: 2-unit voxels from the fine district out to ~1 km.
export function buildSkyline(W, P, rng) {
  const S = W.scale;
  let n = 0;
  const cell = 56;
  for (let gz = -1050; gz <= 640; gz += cell)
    for (let gx = -840; gx <= 840; gx += cell) {
      const ccx = gx + cell / 2, ccz = gz + cell / 2;
      if (Math.hypot(ccx, ccz + 200) > 800) continue;
      // detailed area is handled by the fine world
      const inFine = gx + cell > -146 && gx < 146 && gz + cell > -216 && gz < 182;
      if (inFine) continue;
      if (Math.hypot(ccx - TOWER.x, ccz - TOWER.z) < 100) continue;
      // split cell into 1-3 lots
      const lots = rng.chance(0.4) ? [[0, 0, 1, 1]] : rng.chance(0.5) ? [[0, 0, 0.5, 1], [0.5, 0, 1, 1]] : [[0, 0, 1, 0.5], [0, 0.5, 0.5, 1], [0.5, 0.5, 1, 1]];
      for (const [a, b, c2, d] of lots) {
        const lx0 = gx + 5 + a * (cell - 10), lx1 = gx + 5 + c2 * (cell - 10) - 3;
        const lz0 = gz + 5 + b * (cell - 10), lz1 = gz + 5 + d * (cell - 10) - 3;
        if (lx1 - lx0 < 8 || lz1 - lz0 < 8) continue;
        const sx = rng.range(0, 0.25) * (lx1 - lx0), sz = rng.range(0, 0.25) * (lz1 - lz0);
        const x0 = lx0 + sx * rng.f(), x1 = lx1 - sx * rng.f(), z0 = lz0 + sz * rng.f(), z1 = lz1 - sz * rng.f();
        if (Math.min(Math.abs(x0), Math.abs(x1)) < 150 && z1 > -216 && z0 < 182) continue;
        const h = heightAt((x0 + x1) / 2, (z0 + z1) / 2, rng);
        tower(W, P, rng, Math.round(x0 / S), Math.round(z0 / S), Math.round(x1 / S), Math.round(z1 / S), Math.max(5, Math.round(h / S)), rng.int(0, 1e6));
        n++;
      }
    }
  return n;
}

// Far silhouettes: 5-unit voxels toward the horizon.
export function buildFarSkyline(W, P, rng) {
  const S = W.scale;
  let n = 0;
  const cell = 130;
  for (let gz = -2700; gz <= 1400; gz += cell)
    for (let gx = -2600; gx <= 2600; gx += cell) {
      const ccx = gx + cell / 2, ccz = gz + cell / 2;
      const r = Math.hypot(ccx, ccz + 200);
      if (r < 800 || r > 2700) continue;
      if (!rng.chance(0.75)) continue;
      const w = rng.range(30, 80), d = rng.range(30, 80);
      const x0 = gx + rng.range(0, cell - w), z0 = gz + rng.range(0, cell - d);
      let h = rng.range(24, 80) + 110 * Math.exp(-(((ccx - 150) ** 2 + (ccz + 1500) ** 2) / 600 ** 2)) * rng.range(0.4, 1.3);
      if (ccz > 0) h *= 0.6;
      tower(W, P, rng, Math.round(x0 / S), Math.round(z0 / S), Math.round((x0 + w) / S), Math.round((z0 + d) / S), Math.max(4, Math.round(h / S)), rng.int(0, 1e6));
      n++;
    }
  return n;
}
