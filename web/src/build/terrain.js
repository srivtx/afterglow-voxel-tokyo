import { FINE, groundH, MAIN_HALF, DMAIN_HALF, DISTRICT_Z, SHRINE, STAIRS, PAGODA, TORII } from './layout.js';
import { hash3, hash2, fbm2 } from '../rng.js';

// District street grid (city level)
export const CROSS_Z = [[-62, -52], [-112, -102], [-160, -150], [-212, -200]];
export const SIDE_X = [[48, 56], [98, 106]];

export function districtStreet(x, z) {
  if (z > DISTRICT_Z + 1) return false;
  if (Math.abs(x) <= DMAIN_HALF) return true;
  for (const [a, b] of CROSS_Z) if (z >= a && z <= b) return true;
  const ax = Math.abs(x);
  for (const [a, b] of SIDE_X) if (ax >= a && ax <= b) return true;
  return false;
}
export function oldStreet(x, z) { return z > DISTRICT_Z && Math.abs(x) <= MAIN_HALF; }
export function onPath(x, z) { return x >= STAIRS.x0 && x <= STAIRS.x1 && z >= STAIRS.z1 && z <= SHRINE.z1; }

export function buildTerrain(W, P) {
  const id = (n) => P.id(n);
  const M = {
    grass: id('grass'), grass2: id('grass2'), grassDark: id('grassDark'), moss: id('moss'), dirt: id('dirt'),
    stone: id('stone'), stoneDark: id('stoneDark'), stoneLight: id('stoneLight'), cobble: id('cobble'), cobble2: id('cobble2'),
    gravel: id('gravel'), asphalt: id('asphalt'), line: id('line'), curb: id('curb'), sidewalk: id('sidewalk'),
  };
  const ishigaki = (x, y, z) => {
    const row = Math.floor(y / 2);
    const h = hash3(Math.floor((x + row * 2) / 3), row, Math.floor((z + row * 2) / 3));
    return h < 0.2 ? M.stoneDark : h > 0.85 ? M.stoneLight : M.stone;
  };

  const top = (x, z, h) => {
    // district
    if (z <= DISTRICT_Z + 1) {
      if (districtStreet(x, z)) {
        const ax = Math.abs(x);
        if (ax <= DMAIN_HALF && ax >= DMAIN_HALF - 2 && !CROSS_Z.some(([a, b]) => z >= a && z <= b)) return M.sidewalk;
        // crosswalks
        for (const [a, b] of CROSS_Z) if (z >= a && z <= b && ax <= DMAIN_HALF - 2 && (z === a + 1 || z === b - 1 || false)) return M.asphalt;
        for (const [a, b] of CROSS_Z) if ((z === a - 1 || z === a - 2 || z === b + 1 || z === b + 2) && ax <= DMAIN_HALF - 3 && x % 2 === 0) return M.line;
        if (x === 0 && ((z % 10) + 10) % 10 < 5 && !CROSS_Z.some(([a, b]) => z >= a - 3 && z <= b + 3)) return M.line;
        return M.asphalt;
      }
      return M.sidewalk;
    }
    // old town street (stone pavers)
    if (oldStreet(x, z)) {
      const ax = Math.abs(x);
      if (ax === MAIN_HALF) return M.curb;
      return ((Math.floor(x / 2) + Math.floor(z / 3)) & 1) ? M.cobble : M.cobble2;
    }
    // shrine path
    if (onPath(x, z) || (x >= STAIRS.x0 && x <= STAIRS.x1 && z >= STAIRS.z0 && z < STAIRS.z1)) {
      return ((Math.floor(x / 4) + Math.floor(z / 3)) & 1) ? M.stoneLight : M.stone;
    }
    const pdx = x - PAGODA.x, pdz = z - PAGODA.z;
    if (h === 28 && pdx * pdx + pdz * pdz < PAGODA.r * PAGODA.r) {
      const r = Math.sqrt(pdx * pdx + pdz * pdz);
      if (r > PAGODA.r - 4) return hash2(x, z) < 0.6 ? M.moss : M.grassDark;
      return hash2(x, z) < 0.08 ? M.moss : M.gravel;
    }
    if (x >= SHRINE.x0 && x <= SHRINE.x1 && z >= SHRINE.z0 && z <= SHRINE.z1) {
      const n = fbm2(x * 0.05, z * 0.05, 3);
      if (Math.abs(x - TORII.x) < 26 && z > TORII.z - 40 && z < TORII.z + 30) return hash2(x, z) < 0.05 ? M.stone : M.gravel;
      return n > 0.55 ? M.moss : n > 0.45 ? M.grass2 : M.grass;
    }
    const n = fbm2(x * 0.06, z * 0.06, 3), r = hash2(x, z);
    if (n < 0.36) return M.dirt;
    return r < 0.15 ? M.grassDark : n > 0.6 ? M.grass2 : r > 0.9 ? M.moss : M.grass;
  };

  for (let z = FINE.z0; z <= FINE.z1; z++) {
    for (let x = FINE.x0; x <= FINE.x1; x++) {
      const h = groundH(x, z);
      const t = top(x, z, h);
      W.set(x, h, z, t);
      if (h >= 1) W.set(x, h - 1, z, t === M.cobble || t === M.cobble2 || t === M.stone || t === M.stoneLight ? M.stoneDark : M.dirt);
      for (let y = 0; y < h - 1; y++) W.set(x, y, z, ishigaki(x, y, z));
    }
  }
  // low curb wall where the old street meets the slope cut
  return M;
}
