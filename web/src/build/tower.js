import { TOWER } from './layout.js';
import { broadleaf } from './trees.js';

export const TOWER_H = 262;

export function buildTower(W, P, rng) {
  const cx = TOWER.x, cz = TOWER.z;
  const id = (n) => P.id(n);
  const AMB = id('towerAmber'), OR = id('towerOrange'), WH = id('towerWhite'), DECK = id('towerDeck'), DW = id('towerDeckWin');
  const hw = (y) => 4 + 38 * Math.exp(-y / 72);
  const c = (y) => Math.round(hw(y));

  // plaza
  for (let z = cz - 90; z <= cz + 90; z++)
    for (let x = cx - 90; x <= cx + 90; x++) {
      const r = Math.hypot(x - cx, z - cz);
      if (r > 90) continue;
      W.set(x, 0, z, r > 62 ? (((x + z) & 7) === 0 ? id('grass2') : id('grass')) : ((Math.floor(x / 3) + Math.floor(z / 3)) & 1 ? id('sidewalk') : id('stone')));
    }
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2, r = 74 + rng.range(-4, 6);
    broadleaf(W, P, rng, Math.round(cx + Math.cos(a) * r), Math.round(cz + Math.sin(a) * r), rng.range(0.9, 1.2), 0, k % 3 === 0);
  }
  // Foot Town building under the legs
  W.box(cx - 22, 1, cz - 18, cx + 22, 14, cz + 18, (x, y, z) => {
    const edge = x === cx - 22 || x === cx + 22 || z === cz - 18 || z === cz + 18;
    if (!edge) return id('conc4');
    const u = x === cx - 22 || x === cx + 22 ? z : x;
    if (y % 4 === 0) return id('conc4');
    return u % 3 ? id('winWarm2') : id('conc2');
  });
  W.light(cx, 8, cz + 30, '#ffb070', 1.6, 50);

  // legs
  for (let y = 1; y <= 178; y++) {
    const cc = c(y), t = y < 50 ? 4 : y < 112 ? 3 : 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const xa = sx > 0 ? cx + cc - t + 1 : cx - cc, za = sz > 0 ? cz + cc - t + 1 : cz - cc;
      W.box(xa, y, za, xa + t - 1, y, za + t - 1, AMB);
    }
  }
  // horizontal rings + X bracing
  const levels = [36, 48, 60, 72, 84, 96, 108, 118, 128, 138, 148, 158, 168, 178];
  const ring = (y, m) => {
    const cc = c(y);
    for (let k = -cc; k <= cc; k++) {
      W.set(cx + k, y, cz - cc, m); W.set(cx + k, y, cz + cc, m);
      W.set(cx - cc, y, cz + k, m); W.set(cx + cc, y, cz + k, m);
    }
  };
  for (let i = 0; i < levels.length; i++) {
    const y = levels[i];
    ring(y, y === 60 || y === 128 || y === 158 ? WH : OR);
    if (i < levels.length - 1) {
      const ya = y, yb = levels[i + 1], a = c(ya), b = c(yb);
      for (const s of [-1, 1]) {
        // faces at z = ±c
        W.line(cx - a, ya, cz + s * a, cx + b, yb, cz + s * b, OR);
        W.line(cx + a, ya, cz + s * a, cx - b, yb, cz + s * b, OR);
        // faces at x = ±c
        W.line(cx + s * a, ya, cz - a, cx + s * b, yb, cz + b, OR);
        W.line(cx + s * a, ya, cz + a, cx + s * b, yb, cz - b, OR);
      }
    }
  }
  // base arches on each face
  for (let i = 0; i <= 120; i++) {
    const t = -1 + (2 * i) / 120;
    const y = Math.round(12 + 24 * (1 - t * t));
    const u = Math.round(t * hw(y));
    const cc = c(y);
    W.set(cx + u, y, cz - cc, OR); W.set(cx + u, y, cz + cc, OR);
    W.set(cx - cc, y, cz + u, OR); W.set(cx + cc, y, cz + u, OR);
  }
  // diagonal struts between arch and legs
  for (const s of [-1, 1]) {
    W.line(cx - c(14), 14, cz + s * c(14), cx - 10, 36, cz + s * c(36), OR);
    W.line(cx + c(14), 14, cz + s * c(14), cx + 10, 36, cz + s * c(36), OR);
    W.line(cx + s * c(14), 14, cz - c(14), cx + s * c(36), 36, cz - 10, OR);
    W.line(cx + s * c(14), 14, cz + c(14), cx + s * c(36), 36, cz + 10, OR);
  }

  // main observatory (two tiers) and top deck
  const deck = (y0, y1, half, winRows) => {
    W.box(cx - half, y0, cz - half, cx + half, y1, cz + half, (x, y, z) => {
      const edge = Math.abs(x - cx) === half || Math.abs(z - cz) === half;
      if (!edge) return DECK;
      if (winRows.includes(y)) return ((x + z) & 3) === 0 ? WH : DW;
      return WH;
    });
  };
  deck(96, 101, 18, [97, 98, 99]);
  deck(102, 107, 16, [103, 104, 105]);
  deck(168, 173, 9, [169, 170, 171]);
  // antenna
  let y = 174;
  for (; y <= TOWER_H; y++) {
    const half = y < 200 ? 2 : y < 230 ? 1 : 0;
    const m = Math.floor((y - 174) / 7) % 2 ? WH : OR;
    for (let z = -half; z <= half; z++)
      for (let x = -half; x <= half; x++) {
        if (half > 0 && Math.abs(x) < half && Math.abs(z) < half && (y % 6)) continue;
        W.set(cx + x, y, cz + z, m);
      }
  }
  W.set(cx, TOWER_H + 1, cz, id('aviation'));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    W.set(cx + sx * 15, 108, cz + sz * 15, id('aviation'));
    W.set(cx + sx * 8, 174, cz + sz * 8, id('aviation'));
  }
}
