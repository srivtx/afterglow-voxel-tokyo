import { PAGODA, HILL } from './layout.js';
import { chochin } from './shrine.js';

// Five-storey pagoda (gojū-no-tō): vermilion bodies, bracketed eaves, wide
// thin roofs with upswept corners, gilded sōrin spire.
export function buildPagoda(W, P, reserve) {
  const cx = PAGODA.x, cz = PAGODA.z;
  const id = (n) => P.id(n);
  const RED = id('pagodaRed'), REDD = id('pagodaRedDark'), WH = id('pagodaWhite'), BR = id('bracket'), GOLD = id('gold');
  const R1 = id('pRoof'), R2 = id('pRoof2'), RE = id('pRoofEdge'), RR = id('pRidge'), SOR = id('sorin');
  const ST = id('stone'), STL = id('stoneLight'), SHOJI = id('shoji'), WDIM = id('winDim'), WD = id('woodDark');
  const S = (u, y, v, m) => W.set(cx + u, y, cz + v, m);

  let y = HILL + 1;
  // platform with steps on the +z side
  for (let v = -15; v <= 15; v++) for (let u = -15; u <= 15; u++) for (let k = 0; k < 3; k++) S(u, y + k, v, Math.max(Math.abs(u), Math.abs(v)) === 15 ? ST : STL);
  for (let k = 0; k < 3; k++) for (let u = -4; u <= 4; u++) S(u, y + k, 16 + (2 - k), ST);
  y += 3;

  const BW = [8, 7, 6, 6, 5];
  const BH = [8, 7, 7, 6, 6];
  for (let i = 0; i < 5; i++) {
    const bw = BW[i], bh = BH[i];
    // body
    for (let yl = 0; yl < bh; yl++)
      for (let v = -bw; v <= bw; v++)
        for (let u = -bw; u <= bw; u++) {
          const au = Math.abs(u), av = Math.abs(v);
          if (au < bw && av < bw) { S(u, y + yl, v, REDD); continue; }
          const a = au === bw ? av : au; // position along the face
          let m;
          if (au === bw && av === bw) m = RED;
          else if (yl >= bh - 2) m = a % 2 === 0 ? RED : WH;
          else if (a === bw - 2 || a === 2) m = RED;
          else if (a <= 1) m = i === 0 ? (yl <= 5 ? SHOJI : RED) : (yl >= 2 && yl <= 4 ? (a === 0 ? GOLD : REDD) : REDD);
          else m = i === 0 ? (yl >= 2 && yl <= 5 ? (a % 2 ? WD : WDIM) : REDD) : (yl >= 2 && yl <= 4 ? (a % 2 ? WD : REDD) : REDD);
          S(u, y + yl, v, m);
        }
    // balcony rail on upper tiers
    if (i > 0) {
      for (let v = -bw - 1; v <= bw + 1; v++)
        for (let u = -bw - 1; u <= bw + 1; u++) {
          if (Math.max(Math.abs(u), Math.abs(v)) !== bw + 1) continue;
          S(u, y, v, RED);
          if ((u + v) % 2 === 0) S(u, y + 1, v, RED);
        }
    }
    y += bh;
    // bracket sets (tokyō)
    for (let k = 0; k < 2; k++) {
      const hw = bw + 1 + k;
      for (let v = -hw; v <= hw; v++)
        for (let u = -hw; u <= hw; u++) {
          const m = Math.max(Math.abs(u), Math.abs(v));
          if (m > hw) continue;
          S(u, y + k, v, m === hw && (u + v + k) % 2 === 0 ? GOLD : BR);
        }
    }
    y += 2;
    // roof sheet
    const rw = bw + (i === 0 ? 8 : 7);
    const nextBw = i < 4 ? BW[i + 1] : -1;
    let peak = y;
    for (let v = -rw; v <= rw; v++)
      for (let u = -rw; u <= rw; u++) {
        const au = Math.abs(u), av = Math.abs(v);
        const mx = Math.max(au, av), along = Math.min(au, av);
        if (mx <= nextBw) continue;
        const e = rw - mx;
        const lift = Math.max(0, along - (rw - 6)) * 0.55;
        const rh = Math.floor(e * 0.48 + lift * Math.max(0, 1 - e / 4));
        const top = y + rh - 1;
        peak = Math.max(peak, top);
        let m;
        if (e === 0) m = RE;
        else if (au === av) m = RR;
        else if (e % 3 === 0) m = RE;
        else m = along % 2 ? R1 : R2;
        S(u, top, v, m);
        S(u, top - 1, v, e <= 1 ? RE : BR);
        if (e === 0) S(u, top - 2, v, RE);
      }
    // corner bells / lanterns
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lift = Math.floor(6 * 0.55);
      const cyy = y + lift - 3;
      S(su * rw, cyy, sv * rw, GOLD);
      if (i <= 1) chochin(W, P, cx + su * (rw - 1) - (su < 0 ? 0 : 1), cyy - 5, cz + sv * (rw - 1) - (sv < 0 ? 0 : 1), false, true);
    }
    if (i < 4) y = y + Math.floor((rw - nextBw - 1) * 0.48);
    else y = peak + 1;
  }
  // roban + sōrin spire with nine rings
  for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) { S(u, y, v, RE); if (Math.abs(u) < 2 && Math.abs(v) < 2) S(u, y + 1, v, BR); }
  y += 2;
  const H = 20;
  for (let k = 0; k < H; k++) S(0, y + k, 0, SOR);
  for (let r = 0; r < 9; r++) {
    const yy = y + 2 + r * 1.6;
    for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) S(u, Math.round(yy), v, SOR);
  }
  for (const [u, v] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) S(u, y + H - 3, v, SOR);
  S(0, y + H, 0, GOLD); S(0, y + H + 1, 0, GOLD);

  // warm uplights at the platform corners -> glowing red bodies
  for (const [lx, lz] of [[-14, 14], [14, 14], [-14, -14], [14, -14], [0, 18]])
    W.light(cx + lx, HILL + 4, cz + lz, '#ff9a5a', 1.6, 42);
  W.light(cx, HILL + 30, cz + 22, '#ff8a5a', 0.9, 40);
  reserve.mark(cx - 17, cz - 17, cx + 17, cz + 20);
  return y + H;
}
