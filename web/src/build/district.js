import { trackDist, rasterText, DMAIN_HALF } from './layout.js';
import { CROSS_Z, SIDE_X } from './terrain.js';
import { hash3 } from '../rng.js';
import { NEON_COLORS, PANEL_COLORS } from '../palette.js';

const WORDS_H = ['ゲーム', 'アニメ', 'マンガ', 'カラオケ', 'ラーメン', '居酒屋', '東京', 'ホテル', '寿司', 'コーヒー',
  '映画館', '書店', 'ネオン', '夕焼け', '電気街', 'カメラ', '薬局', 'ゲームセンター', 'アニメ・マンガ', '焼肉', 'ラジオ'];
const WORDS_V = ['カラオケ', '居酒屋', 'ラーメン', 'ホテル', '焼肉', '喫茶', '酒場', '寿司', '占い', '麻雀', 'BAR', '中華'];
const NEONS = Object.keys(NEON_COLORS);
const PANELS = Object.keys(PANEL_COLORS);

// Draw a sign in the x/y plane facing +z. (x0, yTop) is the top-left corner.
export function sign(W, P, rng, { x0, yTop, zp, bmp, style, pad = 2, light = true }) {
  const w = bmp.w + pad * 2, h = bmp.h + pad * 2;
  const g = rng.int(4, 9);
  const neon = (c) => P.id(`neon_${c}_${g}`);
  let panel, text, border;
  const ncol = rng.pick(NEONS);
  if (style === 'backlit') {
    const pc = rng.pick(PANELS);
    panel = P.id('panel_' + pc);
    const tc = pc === 'yellow' || pc === 'white' || pc === 'orange' ? rng.pick(['red', 'blue', 'purple', 'pink']) : rng.pick(['white', 'yellow', 'cyan']);
    text = neon(tc);
    border = neon(rng.pick(NEONS));
  } else {
    panel = P.id('panelDark');
    text = neon(ncol);
    border = neon(rng.pick(NEONS.filter((n) => n !== ncol)));
  }
  const frame = P.id('signFrame');
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = x0 + i, y = yTop - j;
      W.set(x, y, zp - 1, frame);
      const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
      W.set(x, y, zp, edge ? border : panel);
      const bx = i - pad, by = j - pad;
      if (bx >= 0 && by >= 0 && bx < bmp.w && by < bmp.h && bmp.bits[bx + by * bmp.w]) W.set(x, y, zp + 1, text);
    }
  if (light) {
    const lc = style === 'backlit' ? PANEL_COLORS[P.list[panel].name.slice(6)] : NEON_COLORS[ncol];
    W.light(x0 + w / 2, yTop - h / 2, zp + 6, lc, 0.55, Math.max(14, w * 0.7));
  }
  return { w, h };
}

function rooftop(W, P, rng, x0, z0, x1, z1, h) {
  const ac = P.id('ac'), st = P.id('steel'), ant = P.id('antenna');
  const n = rng.int(1, 4);
  for (let k = 0; k < n; k++) {
    const ax = rng.int(x0 + 1, x1 - 3), az = rng.int(z0 + 1, z1 - 3);
    W.box(ax, h + 1, az, ax + 1, h + 2, az + 1, ac);
  }
  if (rng.chance(0.4)) {
    const tx = rng.int(x0 + 2, x1 - 4), tz = rng.int(z0 + 2, z1 - 4);
    for (const [a, b] of [[0, 0], [2, 0], [0, 2], [2, 2]]) W.box(tx + a, h + 1, tz + b, tx + a, h + 3, tz + b, st);
    W.box(tx, h + 4, tz, tx + 2, h + 6, tz + 2, P.id('conc4'));
  }
  if (rng.chance(0.35)) {
    const ax = rng.int(x0 + 1, x1 - 1), az = rng.int(z0 + 1, z1 - 1), ah = rng.int(6, 14);
    W.box(ax, h + 1, az, ax, h + ah, az, ant);
    W.set(ax, h + ah + 1, az, P.id('aviation'));
  }
}

export function building(W, P, rng, b) {
  const { x0, x1, z0, z1, h } = b;
  const conc = P.id('conc' + rng.int(0, 9));
  const slab = rng.chance(0.5) ? P.id('concDark') : conc;
  const style = rng.pick(['grid', 'grid', 'band', 'glass']);
  const lit = rng.range(0.25, 0.6);
  const warm = rng.chance(0.6);
  const winOn = P.id(warm ? 'winWarm2' : rng.chance(0.7) ? 'winCool' : 'winTeal');
  const winOn2 = P.id(warm ? 'winWarm' : 'winCool');
  const off = P.id('winOff'), glass = P.id(rng.chance(0.5) ? 'glass' : 'glass2');
  const shop = P.id(rng.chance(0.5) ? 'shopWhite' : 'shopWarm'), shutter = P.id('shutter');
  const FH = 5;
  const seed = rng.int(0, 1e6);
  const shopFaces = b.shopFaces || ['+z'];
  const shut = rng.chance(0.2);
  const band = b.neonBand ? P.id(`neon_${b.neonBand}_${rng.int(4, 8)}`) : 0;
  const fn = (x, y, z) => {
    const fx = x === x0 ? '-x' : x === x1 ? '+x' : null;
    const fz = z === z0 ? '-z' : z === z1 ? '+z' : null;
    if (!fx && !fz) return y === h ? P.id('rooftop') : conc;
    if (fx && fz) return conc;
    const face = fz || fx;
    const u = fz ? x : z;
    const yl = y - b.y0;
    if (yl < 6) {
      if (!shopFaces.includes(face)) return yl === 5 ? slab : conc;
      if (yl === 5) return slab;
      if (shut) return yl < 4 ? shutter : conc;
      return u % 5 === 0 ? P.id('concDark') : shop;
    }
    if (y >= h) return conc;
    const fl = Math.floor((yl - 6) / FH), r = (yl - 6) % FH;
    if (r === 0) return band && fx && shopFaces.includes(face) && fl % 2 === 0 && y < h - 2 ? band : slab;
    const bay = Math.floor(u / 3);
    const on = hash3(seed + bay, fl, face.charCodeAt(1)) < lit;
    const wm = hash3(seed, bay, fl) < 0.15 ? winOn2 : winOn;
    if (style === 'glass') return r === 4 ? glass : on ? wm : glass;
    if (style === 'band') return r >= 1 && r <= 3 ? (u % 6 === 0 ? conc : on ? wm : off) : conc;
    return r >= 1 && r <= 3 && u % 3 !== 0 ? (on ? wm : off) : conc;
  };
  W.box(x0, b.y0, z0, x1, h, z1, fn);
  // parapet
  for (let x = x0; x <= x1; x++) { W.set(x, h + 1, z0, conc); W.set(x, h + 1, z1, conc); }
  for (let z = z0; z <= z1; z++) { W.set(x0, h + 1, z, conc); W.set(x1, h + 1, z, conc); }
  rooftop(W, P, rng, x0, z0, x1, z1, h);
  // shop light spilling onto the pavement
  for (const f of shopFaces) {
    if (shut) continue;
    if (f === '+z') W.light((x0 + x1) / 2, b.y0 + 3, z1 + 4, warm ? '#ffd29a' : '#e6efff', 0.75, 14);
    if (f === '-x') W.light(x0 - 4, b.y0 + 3, (z0 + z1) / 2, '#ffd29a', 0.7, 13);
    if (f === '+x') W.light(x1 + 4, b.y0 + 3, (z0 + z1) / 2, '#ffd29a', 0.7, 13);
  }
}

function fitText(words, maxW, minPx, maxPx, rng, vertical = false) {
  for (let tries = 0; tries < 8; tries++) {
    const word = rng.pick(words);
    for (let px = maxPx; px >= minPx; px--) {
      const b = rasterText(word, px, vertical);
      if (b.w + 4 <= maxW) return b;
    }
  }
  return null;
}

// Big rooftop sign towers that read from the hero view (the painting's neon cluster).
function landmark(W, P, rng, x, z, word, vertical, px) {
  let y = 150;
  while (y > 0 && !W.get(x, y, z)) y--;
  const base = y + 1;
  const bmp = rasterText(word, px, vertical);
  const w = bmp.w + 4, h = bmp.h + 4;
  const x0 = Math.round(x - w / 2);
  const lift = vertical ? 4 : 8;
  const yTop = base + lift + h - 1;
  const st = P.id('steel');
  for (const lx of [x0 + 1, x0 + w - 2]) for (let yy = base; yy < base + lift; yy++) { W.set(lx, yy, z - 1, st); W.set(lx, yy, z - 2, st); }
  for (let lx = x0; lx < x0 + w; lx++) W.set(lx, base + lift - 1, z - 2, st);
  sign(W, P, rng, { x0, yTop, zp: z, bmp, style: rng.chance(0.5) ? 'backlit' : 'dark' });
}

export function buildDistrict(W, P, rng, reserve) {
  const xr = [[DMAIN_HALF + 1, SIDE_X[0][0] - 1], [SIDE_X[0][1] + 1, SIDE_X[1][0] - 1], [SIDE_X[1][1] + 1, 139]];
  const zr = [];
  for (let i = 0; i < CROSS_Z.length - 1; i++) zr.push([CROSS_Z[i + 1][1] + 1, CROSS_Z[i][0] - 1]);
  let n = 0;
  for (const [bz0, bz1] of zr)
    for (const [ax0, ax1] of xr)
      for (const side of [1, -1]) {
        const bx0 = side > 0 ? ax0 : -ax1, bx1 = side > 0 ? ax1 : -ax0;
        const midZ = Math.floor((bz0 + bz1) / 2);
        for (const row of ['front', 'back']) {
          const rz0 = row === 'front' ? midZ + 1 : bz0, rz1 = row === 'front' ? bz1 : midZ;
          let x = bx0;
          while (x < bx1 - 6) {
            let w = rng.int(11, 22);
            if (bx1 - (x + w) < 8) w = bx1 - x + 1;
            const x0 = x, x1 = Math.min(bx1, x + w - 1);
            const dz = rng.int(0, 2);
            const z0 = rz0 + (row === 'back' ? 0 : dz), z1 = rz1 - (row === 'front' ? 0 : dz);
            const depth = -bz1;
            const nearMain = Math.min(Math.abs(x0), Math.abs(x1)) <= DMAIN_HALF + 1;
            let h = Math.round(rng.range(18, 36) + (depth - 60) * 0.16 + (row === 'back' ? rng.range(2, 10) : 0) + (nearMain ? 14 : Math.abs(x0) < 40 ? 4 : 0));
            const corners = [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, (z0 + z1) / 2]];
            const nearTrack = Math.min(...corners.map(([a, b]) => trackDist(a, b)));
            if (nearTrack < 18) h = rng.int(7, 13);
            const shopFaces = [row === 'front' ? '+z' : '-z'];
            if (nearMain) shopFaces.push(side > 0 ? '-x' : '+x');
            building(W, P, rng, { x0, x1, z0, z1, h, y0: 1, shopFaces, neonBand: nearMain && rng.chance(0.55) ? rng.pick(NEONS) : null });
            reserve.mark(x0, z0, x1, z1);
            n++;
            const fw = x1 - x0 + 1;
            // ---- signage on +z faces
            if (row === 'front' && h > 16) {
              if (fw >= 14 && rng.chance(0.62)) {
                const bmp = fitText(WORDS_H, fw - 2, 7, 13, rng);
                if (bmp) {
                  const yTop = h - rng.int(1, 6);
                  if (yTop - bmp.h - 4 > 8) sign(W, P, rng, { x0: x0 + Math.floor((fw - bmp.w - 4) / 2), yTop, zp: z1 + 1, bmp, style: rng.chance(0.55) ? 'backlit' : 'dark' });
                }
              } else if (rng.chance(0.7)) {
                const bmp = fitText(WORDS_V, 12, 6, 8, rng, true);
                if (bmp && bmp.h + 12 < h) {
                  const sx = rng.chance(0.5) ? x0 + 1 : x1 - bmp.w - 4;
                  sign(W, P, rng, { x0: sx, yTop: Math.min(h - 2, 10 + bmp.h + rng.int(2, 10)), zp: z1 + 1, bmp, style: rng.chance(0.4) ? 'backlit' : 'dark' });
                }
              }
            }
            // rooftop billboards on taller blocks (visible above the skyline)
            if (h > 34 && rng.chance(0.38) && fw >= 14) {
              const bmp = fitText(WORDS_H, fw + 6, 9, 15, rng);
              if (bmp) {
                const sx = x0 + Math.floor((fw - bmp.w - 4) / 2), sz = Math.round((z0 + z1) / 2);
                const base = h + 2, yTop = base + 3 + bmp.h + 4;
                for (const lx of [sx + 2, sx + bmp.w + 1]) W.box(lx, h + 1, sz - 1, lx, base + 2, sz - 1, P.id('steel'));
                sign(W, P, rng, { x0: sx, yTop, zp: sz, bmp, style: rng.chance(0.5) ? 'backlit' : 'dark' });
              }
            }
            // protruding vertical signs over the boulevard
            if (nearMain && h > 22 && rng.chance(0.75)) {
              const bmp = fitText(WORDS_V, 12, 6, 7, rng, true);
              if (bmp && h - 2 - (bmp.h + 4) >= 11) {
                const fxFace = side > 0 ? x0 : x1;
                const sw = bmp.w + 4;
                const sx = side > 0 ? fxFace - sw : fxFace + 1;
                const sz = z1 - 2;
                sign(W, P, rng, { x0: sx, yTop: Math.min(h - 1, 12 + bmp.h + 4 + rng.int(0, 8)), zp: sz, bmp, style: rng.chance(0.5) ? 'backlit' : 'dark' });
                for (let yy = 8; yy < h - 2; yy += 6) W.set(side > 0 ? fxFace - 1 : fxFace + 1, yy, sz - 1, P.id('steel'));
              }
            }
            x = x1 + rng.int(2, 3);
          }
        }
      }
  const lrng = rng;
  for (const [x, z, word, v, px] of [
    [-30, -72, 'ゲーム', false, 13], [26, -74, 'アニメ', true, 11], [-66, -124, 'カラオケ', true, 10],
    [44, -124, 'ラーメン', false, 12], [-18, -126, '東京', false, 15], [70, -80, '居酒屋', true, 10], [-110, -128, 'マンガ', false, 12],
  ]) landmark(W, P, lrng, x, z, word, v, px);
  return n;
}
