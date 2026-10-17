// World layout. Units: 1 = one fine voxel. +y up, camera looks toward -z.
//
//            (far skyline, Tokyo Tower at TOWER)
//   ---------------------------------------------  z = -212  (fine district edge)
//        neon district (city level, y=0)
//   ======= elevated railway (diagonal) =========  z ≈ -40 + 0.35x
//        downhill street (slope z 12 → -50)
//   pagoda hill (HILL)   |street|   houses
//   torii + lantern path | x=0  |   big roofs
//   ---------------------------------------------  z = 176
//                 hero camera (≈ -20, 54, 150)

export const FINE = { x0: -140, x1: 139, z0: -212, z1: 176 };
export const PLATEAU = 16, HILL = 28;
export const SLOPE = { top: 12, bot: -50 };
export const PAGODA = { x: -62, z: -12, r: 24 };
export const TORII = { x: -62, z: 70 };
export const STAIRS = { x0: -66, x1: -58, z0: 12, z1: 32 };
export const SHRINE = { x0: -104, x1: -14, z0: 38, z1: 176 };
export const DISTRICT_Z = -52;
export const MAIN_HALF = 7;        // street half width (incl. sidewalks) in the old town
export const DMAIN_HALF = 11;      // wider boulevard in the district
export const TRACK = { x: 0, z: -40, angle: Math.atan(0.35), deck: 28 };
export const TOWER = { x: 100, z: -360 };
export const HERO = { pos: [-2, 54, 170], target: [12, 60, -120] };

const TS = Math.sin(TRACK.angle), TC = Math.cos(TRACK.angle);
export function trackDist(x, z) { return Math.abs((x - TRACK.x) * TS - (z - TRACK.z) * TC); }
export function trackS(x, z) { return (x - TRACK.x) * TC + (z - TRACK.z) * TS; }

export function inFine(x, z) { return x >= FINE.x0 && x <= FINE.x1 && z >= FINE.z0 && z <= FINE.z1; }

export function groundH(x, z) {
  if (!inFine(x, z)) return 0;
  let h;
  if (z >= SLOPE.top) h = PLATEAU;
  else if (z <= SLOPE.bot) h = 0;
  else h = Math.round((PLATEAU * (z - SLOPE.bot)) / (SLOPE.top - SLOPE.bot));
  const dx = x - PAGODA.x, dz = z - PAGODA.z;
  if (dx * dx + dz * dz < PAGODA.r * PAGODA.r) h = HILL;
  if (x >= STAIRS.x0 && x <= STAIRS.x1 && z >= STAIRS.z0 && z < STAIRS.z1)
    h = Math.max(h, HILL - 1 - Math.floor(((z - STAIRS.z0) * 12) / (STAIRS.z1 - STAIRS.z0 + 1)));
  return h;
}

// 2D footprint reservation so trees / props don't spawn inside buildings.
export class Reserve {
  constructor() {
    this.x0 = -1000; this.z0 = -1200; this.w = 1000; this.h = 1200; // 2-unit cells
    this.g = new Uint8Array(this.w * this.h);
  }
  _c(x, z) { return [Math.floor((x - this.x0) / 2), Math.floor((z - this.z0) / 2)]; }
  mark(x0, z0, x1, z1, v = 1) {
    const [a, b] = this._c(Math.min(x0, x1), Math.min(z0, z1)), [c, d] = this._c(Math.max(x0, x1), Math.max(z0, z1));
    for (let j = Math.max(0, b); j <= Math.min(this.h - 1, d); j++)
      for (let i = Math.max(0, a); i <= Math.min(this.w - 1, c); i++) this.g[i + j * this.w] = v;
  }
  free(x0, z0, x1, z1) {
    const [a, b] = this._c(Math.min(x0, x1), Math.min(z0, z1)), [c, d] = this._c(Math.max(x0, x1), Math.max(z0, z1));
    for (let j = Math.max(0, b); j <= Math.min(this.h - 1, d); j++)
      for (let i = Math.max(0, a); i <= Math.min(this.w - 1, c); i++) if (this.g[i + j * this.w]) return false;
    return true;
  }
}

// ---------------------------------------------------------------------------
// Rasterise Japanese text into a voxel bitmap (supersampled + max pooled so
// thin katakana strokes survive at 7-14 voxel heights).
// ---------------------------------------------------------------------------
const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", "Meiryo", sans-serif';
const cache = new Map();
export function rasterText(text, px, vertical = false) {
  const key = text + '|' + px + '|' + vertical;
  if (cache.has(key)) return cache.get(key);
  const S = 4;
  const chars = [...text];
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.font = `800 ${px * S}px ${FONT}`;
  let W, H;
  if (vertical) {
    W = px; H = chars.length * (px + 1) - 1;
  } else {
    W = Math.ceil(ctx.measureText(text).width / S); H = px;
  }
  cv.width = W * S; cv.height = H * S;
  ctx.font = `800 ${px * S}px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  if (vertical) chars.forEach((ch, i) => ctx.fillText(ch, (W * S) / 2, (i * (px + 1) + px / 2) * S));
  else ctx.fillText(text, (W * S) / 2, (H * S) / 2 + S * 0.5);
  const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const bits = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) sum += img[((y * S + sy) * cv.width + x * S + sx) * 4 + 3];
      bits[x + y * W] = sum / (S * S * 255) > 0.3 ? 1 : 0;
    }
  const r = { w: W, h: H, bits };
  cache.set(key, r);
  return r;
}
