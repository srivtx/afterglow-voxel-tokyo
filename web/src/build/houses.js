import { groundH, trackDist, MAIN_HALF, DISTRICT_Z } from './layout.js';

const DIRS = {
  '+x': { f: [1, 0], l: [0, -1] }, '-x': { f: [-1, 0], l: [0, 1] },
  '+z': { f: [0, 1], l: [1, 0] }, '-z': { f: [0, -1], l: [-1, 0] },
};

export function frame(W, ox, oz, facing) {
  const { f, l } = DIRS[facing];
  const wx = (u, v) => ox + u * l[0] - v * f[0];
  const wz = (u, v) => oz + u * l[1] - v * f[1];
  return {
    wx, wz,
    set: (u, y, v, m) => W.set(wx(u, v), y, wz(u, v), m),
    put: (u, y, v, m) => W.put(wx(u, v), y, wz(u, v), m),
    get: (u, y, v) => W.get(wx(u, v), y, wz(u, v)),
    light: (u, y, v, hex, i, r) => W.light(wx(u, v) + 0.5, y + 0.5, wz(u, v) + 0.5, hex, i, r),
  };
}

// Stepped tiled roof. type: 'gable' (ridge along u) or 'hip'.
export function roof(F, P, { w, d, yr, ov = 2, type = 'gable', slope = 0.6, mats = {} }) {
  const R = { tile: P.id(mats.tile || 'roof'), tile2: P.id(mats.tile2 || 'roof2'), ridge: P.id(mats.ridge || 'roofRidge'), edge: P.id(mats.edge || 'roofEdge'), fill: P.id(mats.fill || 'plaster') };
  let maxTop = yr;
  const ridgeCells = [];
  for (let v = -ov; v <= d - 1 + ov; v++) {
    for (let u = -ov; u <= w - 1 + ov; u++) {
      const ev = Math.min(v + ov, d - 1 + ov - v);
      const eu = Math.min(u + ov, w - 1 + ov - u);
      const e = type === 'hip' ? Math.min(eu, ev) : ev;
      const rh = Math.floor(e * slope);
      const top = yr + rh;
      maxTop = Math.max(maxTop, top);
      const inside = u >= 0 && u < w && v >= 0 && v < d;
      const bottom = inside ? yr : top - (e === 0 ? 1 : 0);
      let tm;
      const evMax = Math.floor((d - 1 + 2 * ov) / 2);
      if (e === 0) tm = R.edge;
      else if (type === 'gable' && (u === -ov || u === w - 1 + ov)) tm = R.edge;
      else if (type === 'hip' && eu === ev && e > 1) tm = R.ridge;
      else if (ev >= evMax && type === 'gable') tm = R.ridge;
      else tm = (u & 1) ? R.tile : (e % 3 === 0 ? R.edge : R.tile2);
      for (let y = bottom; y <= top; y++) F.set(u, y, v, y === top ? tm : R.fill);
      if (type === 'gable' && ev >= evMax) ridgeCells.push([u, top, v]);
    }
  }
  // ridge cap with raised onigawara ends
  if (type === 'gable') {
    for (const [u, top, v] of ridgeCells) {
      if (u <= -ov || u >= w - 1 + ov) continue;
      F.set(u, top + 1, v, R.ridge);
      if (u === -ov + 1 || u === w - 2 + ov) F.set(u, top + 2, v, R.ridge);
    }
  }
  return maxTop;
}

// Traditional town house. Returns footprint for reservation.
export function machiya(W, P, rng, o) {
  const F = frame(W, o.x, o.z, o.facing);
  const { w, d } = o;
  const floors = o.floors ?? 2;
  const big = !!o.big;
  // base: highest ground under the footprint so nothing floats
  let base = -1, low = 999;
  for (const [u, v] of [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1], [w >> 1, d >> 1]]) {
    const g = groundH(F.wx(u, v), F.wz(u, v));
    base = Math.max(base, g); low = Math.min(low, g);
  }
  const y0 = base + 1;
  const F1 = big ? 10 : 9, F2 = 8;
  const H = floors === 2 ? F1 + F2 : F1;
  const m = (n) => P.id(n);
  const woodDark = m('woodDark'), wood = m('wood'), plaster = m(o.plaster || rng.pick(['plaster', 'plaster', 'plasterWhite', 'plasterDark']));
  const shoji = m('shoji'), win = m('winWarm'), winDim = m('winDim'), stone = m('stoneDark');
  const noren = m(rng.pick(['noren', 'noren', 'norenRed', 'norenWhite']));
  const darkFront = !big && rng.chance(0.35); // dark timber front
  const post = big ? 6 : 5;
  const door0 = big ? Math.floor(w / 2) - 2 : rng.int(2, Math.max(2, w - 6));

  // foundation (stone plinth down to the lowest ground)
  for (let v = 0; v < d; v++) for (let u = 0; u < w; u++) for (let y = Math.min(low, base) - 2; y <= base; y++) F.set(u, y, v, stone);

  for (let v = 0; v < d; v++)
    for (let u = 0; u < w; u++)
      for (let yl = 0; yl < H; yl++) {
        const y = y0 + yl;
        const edgeU = u === 0 || u === w - 1, edgeV = v === 0 || v === d - 1;
        if (!edgeU && !edgeV) { F.set(u, y, v, plaster); continue; }
        let mat = plaster;
        const fl2 = yl >= F1, yy = fl2 ? yl - F1 : yl, FH = fl2 ? F2 : F1;
        if (edgeU && edgeV) mat = woodDark;
        else if (yy === FH - 1 || yy === 0) mat = woodDark;
        else if (v === 0) {
          // street front
          const postHere = u % post === 0;
          if (!fl2) {
            if (u >= door0 && u <= door0 + 3) {
              if (u === door0 || u === door0 + 3) mat = woodDark;
              else mat = yy >= 5 ? noren : shoji;
            } else if (postHere) mat = woodDark;
            else if (big) mat = yy >= 2 && yy <= 7 ? ((u % 3 === 0) ? wood : shoji) : wood;
            else if (darkFront) mat = yy >= 2 && yy <= 6 ? ((u & 1) ? wood : win) : wood;
            else mat = yy >= 1 && yy <= 7 ? ((u & 1) ? wood : shoji) : wood;
          } else {
            if (postHere) mat = woodDark;
            else if (yy >= 2 && yy <= 5 && u % post !== 0) mat = (u & 1) ? woodDark : (rng.chance(0.85) ? win : winDim);
            else mat = darkFront ? wood : plaster;
          }
        } else {
          // sides/back: plaster panels, timber posts, wainscot
          const along = edgeV ? u : v;
          if (along % post === 0) mat = woodDark;
          else if (yy <= 2) mat = wood;
          else if (yy >= 4 && yy <= 6 && along % post === 2 && rng.chance(0.5)) mat = winDim;
          else if (yy >= 3 && yy <= 6 && v === d - 1 && big && along % post === 3) mat = shoji;
        }
        F.set(u, y, v, mat);
      }

  // front lean-to roof (hisashi) between floors
  if (floors === 2 || big) {
    const yh = y0 + F1 - 1;
    for (let u = -1; u <= w; u++) {
      F.set(u, yh, -2, m('roofEdge'));
      F.set(u, yh + 1, -1, (u & 1) ? m('roof') : m('roof2'));
    }
  }
  // engawa (veranda) for big houses
  if (big) for (let u = 0; u < w; u++) { F.set(u, y0 - 1, -1, m('woodLight')); F.set(u, y0 - 1, -2, m('woodLight')); }

  const top = roof(F, P, {
    w, d, yr: y0 + H, ov: big ? 3 : 2, type: o.roof || (big ? 'hip' : 'gable'), slope: big ? 0.55 : 0.6,
  });

  // lantern by the door + light spill on the street
  const lu = Math.max(0, door0 - 1);
  const ly = y0 + 5;
  const lanternMat = m(rng.chance(0.55) ? 'chochinRed' : 'chochinWhite');
  F.set(lu, ly + 3, -1, m('black'));
  F.set(lu, ly + 2, -1, lanternMat); F.set(lu, ly + 1, -1, lanternMat);
  F.set(lu, ly, -1, m('black'));
  F.light(lu, ly + 1, -3, '#ffb070', 1.8, 15);
  // doorway glow
  F.light(door0 + 1.5, y0 + 3, -3, '#ffc27a', 1.3, 12);
  if (big) F.light(w / 2, y0 + 4, -5, '#ffc27a', 1.5, 22);

  // shop sign board over the door on some houses
  if (!big && rng.chance(0.45)) {
    const sy = y0 + F1 - 2;
    for (let u = door0 - 1; u <= door0 + 4; u++) for (let y = sy; y <= sy + 1; y++) F.set(u, y, -1, m('kanban'));
    for (let u = door0; u <= door0 + 3; u++) if (rng.chance(0.7)) F.set(u, sy + (u & 1), -2, m('kanbanGold'));
  }
  // potted plants / vending machine at the front
  if (rng.chance(0.3) && !big) {
    const vu = w - 3;
    for (let y = y0; y <= y0 + 4; y++) for (let uu = vu; uu <= vu + 1; uu++) F.set(uu, y, -1, y === y0 + 4 ? m('vendingRed') : (y >= y0 + 2 ? m('vending') : m('vendingRed')));
    F.light(vu + 1, y0 + 3, -3, '#dff0ff', 1.2, 9);
  } else if (rng.chance(0.5)) {
    F.set(w - 2, y0, -1, m('stoneDark')); F.set(w - 2, y0 + 1, -1, m('bush')); F.set(w - 3, y0, -1, m('bush'));
  }
  return { top, y0, base };
}

// ---------------------------------------------------------------------------
export function buildStreetHouses(W, P, rng, reserve) {
  let count = 0;
  // left side (faces +x), right side (faces -x)
  const sides = [
    { facing: '+x', fx: -(MAIN_HALF + 4), zFrom: 36, zTo: DISTRICT_Z + 2, dir: -1 },
    { facing: '-x', fx: MAIN_HALF + 4, zFrom: DISTRICT_Z + 2, zTo: 174, dir: 1 },
  ];
  for (const s of sides) {
    let z = s.zFrom;
    while (s.dir < 0 ? z > s.zTo + 10 : z < s.zTo - 10) {
      const w = rng.int(12, 20);
      const d = rng.int(15, 21);
      const zA = z, zB = z + s.dir * (w - 1);
      const cz = (zA + zB) / 2, cx = s.fx - Math.sign(s.fx) * (d / 2);
      const gap = rng.int(1, 3);
      // keep clear of the railway viaduct and the foreground big-house quarter
      if (trackDist(cx, cz) < 17 || trackDist(s.fx, zA) < 15 || trackDist(s.fx, zB) < 15) { z = zB + s.dir * (gap + 1); continue; }
      const floors = rng.chance(0.7) ? 2 : 1;
      machiya(W, P, rng, { x: s.fx, z: zA, facing: s.facing, w, d, floors });
      const xs = [s.fx, s.fx - Math.sign(s.fx) * d];
      reserve.mark(Math.min(...xs) - 2, Math.min(zA, zB) - 1, Math.max(...xs) + 2, Math.max(zA, zB) + 1);
      count++;
      z = zB + s.dir * (gap + 1);
    }
  }
  return count;
}

// Large hip-roofed houses in the right foreground (like the painting's right edge)
export function buildBigHouses(W, P, rng, reserve) {
  const lots = [
    { x: 40, z: 128, w: 30, d: 22, f: '+z' },
    { x: 78, z: 140, w: 26, d: 20, f: '+z' },
    { x: 110, z: 122, w: 24, d: 22, f: '+z' },
    { x: 38, z: 88, w: 26, d: 20, f: '+z' },
    { x: 74, z: 96, w: 30, d: 24, f: '+z' },
    { x: 112, z: 80, w: 24, d: 20, f: '+z' },
    { x: 42, z: 50, w: 24, d: 18, f: '+z' },
    { x: 76, z: 54, w: 26, d: 20, f: '+z' },
    { x: 110, z: 44, w: 22, d: 18, f: '+z' },
    { x: 42, z: 170, w: 26, d: 18, f: '+z' },
    { x: 84, z: 174, w: 30, d: 20, f: '+z' },
    // left back quarter behind the shrine
    { x: -134, z: 150, w: 22, d: 18, f: '+z' },
    { x: -134, z: 112, w: 24, d: 20, f: '+z' },
    { x: -132, z: 30, w: 22, d: 18, f: '+z' },
  ];
  let n = 0;
  for (const L of lots) {
    // +z facing: origin is the front-left corner, house extends to -z
    const x0 = L.x, x1 = L.x + L.w - 1, z1 = L.z, z0 = L.z - L.d + 1;
    if (x1 > 137) continue;
    if (trackDist((x0 + x1) / 2, (z0 + z1) / 2) < 22) continue;
    if (!reserve.free(x0, z0, x1, z1)) continue;
    machiya(W, P, rng, { x: x0, z: z1, facing: L.f, w: L.w, d: L.d, floors: rng.chance(0.5) ? 2 : 1, big: true, plaster: rng.pick(['plasterWhite', 'plaster']) });
    reserve.mark(x0 - 4, z0 - 4, x1 + 4, z1 + 4);
    // garden wall (tsuiji-bei) along the front with tile cap
    const g = groundH(x0, z1 + 6);
    if (z1 + 7 < 176)
      for (let x = x0 - 3; x <= x1 + 3; x++) {
        if (Math.abs(x - (x0 + x1) / 2) < 3) continue; // gate gap
        const gy = groundH(x, z1 + 7);
        for (let y = gy + 1; y <= gy + 3; y++) W.set(x, y, z1 + 7, P.id('plasterWhite'));
        W.set(x, gy + 4, z1 + 7, P.id('roof')); W.set(x, gy + 4, z1 + 8, P.id('roofEdge')); W.set(x, gy + 4, z1 + 6, P.id('roofEdge'));
      }
    void g;
    n++;
  }
  return n;
}
