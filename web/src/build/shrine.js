import { groundH, TORII, STAIRS, PAGODA, HILL, SHRINE } from './layout.js';
import { machiya } from './houses.js';

export function stoneLantern(W, P, x, z, scale = 1) {
  const s = P.id('stone'), sd = P.id('stoneDark'), fire = P.id('fire'), sl = P.id('stoneLight');
  const y0 = groundH(x, z) + 1;
  W.box(x - 1, y0, z - 1, x + 1, y0 + 1, z + 1, sd);
  W.box(x, y0 + 2, z, x, y0 + 5, z, s);
  W.box(x - 1, y0 + 6, z - 1, x + 1, y0 + 6, z + 1, sl);
  W.box(x - 1, y0 + 7, z - 1, x + 1, y0 + 8, z + 1, (xx, yy, zz) => (xx !== x && zz !== z ? s : fire));
  W.set(x, y0 + 7, z, fire); W.set(x, y0 + 8, z, fire);
  W.box(x - 2, y0 + 9, z - 2, x + 2, y0 + 9, z + 2, sd);
  W.box(x - 1, y0 + 10, z - 1, x + 1, y0 + 10, z + 1, sd);
  W.set(x, y0 + 11, z, s);
  W.light(x + 0.5, y0 + 8, z + 0.5, '#ffad5a', 1.6 * scale, 11);
}

// hanging paper lantern (2x4x2)
export function chochin(W, P, x, y, z, red = false, light = true) {
  const b = P.id('black'), body = P.id(red ? 'chochinRed' : 'chochinWhite'), band = P.id('chochinRed');
  W.box(x, y + 3, z, x + 1, y + 3, z + 1, b);
  W.box(x, y + 1, z, x + 1, y + 2, z + 1, (xx, yy) => (yy === y + 1 && !red ? band : body));
  W.box(x, y, z, x + 1, y, z + 1, b);
  if (light) W.light(x + 1, y + 1.5, z + 1, '#ffbf78', 1.25, 10);
}

export function buildShrine(W, P, rng, reserve) {
  const V = P.id('vermilion'), VD = P.id('vermilionDark'), BK = P.id('black'), G = P.id('gold');
  const tx = TORII.x, tz = TORII.z, y0 = groundH(tx, tz) + 1;

  // ---- great torii
  for (const px of [tx - 10, tx + 10]) {
    W.box(px - 2, y0, tz - 2, px + 2, y0 + 1, tz + 2, BK);
    for (let y = y0 + 2; y <= y0 + 23; y++)
      W.box(px - 1, y, tz - 1, px + 1, y, tz + 1, (x, yy, z) => (x !== px && z !== tz ? undefined : V));
    W.box(px - 1, y0 + 2, tz - 1, px + 1, y0 + 2, tz + 1, VD);
  }
  // nuki (tie beam)
  W.box(tx - 14, y0 + 16, tz, tx + 14, y0 + 17, tz, V);
  // gakuzuka + plaque
  W.box(tx - 1, y0 + 18, tz, tx + 1, y0 + 20, tz, V);
  W.box(tx - 2, y0 + 17, tz + 1, tx + 2, y0 + 21, tz + 1, BK);
  W.box(tx - 1, y0 + 18, tz + 2, tx + 1, y0 + 20, tz + 2, G);
  // shimaki + kasagi with upswept ends
  W.box(tx - 15, y0 + 22, tz - 1, tx + 15, y0 + 22, tz + 1, V);
  for (let x = tx - 18; x <= tx + 18; x++) {
    const dx = Math.abs(x - tx);
    const lift = dx >= 13 ? Math.floor((dx - 12) / 2) : 0;
    W.box(x, y0 + 23 + lift, tz - 1, x, y0 + 24 + lift, tz + 1, BK);
    if (dx >= 16) W.set(x, y0 + 25 + lift, tz, BK);
  }
  // shimenawa rope + paper streamers under the nuki
  for (let x = tx - 8; x <= tx + 8; x++) {
    W.set(x, y0 + 15 - Math.round(1.5 * Math.sin(((x - tx + 8) / 16) * Math.PI)), tz, P.id('rope'));
    if ((x - tx) % 4 === 0) { W.set(x, y0 + 13, tz, P.id('shide')); W.set(x, y0 + 12, tz, P.id('shide')); }
  }
  // lanterns hanging from the nuki (as in the painting)
  for (const lx of [tx - 7, tx - 3, tx + 2, tx + 6]) chochin(W, P, lx, y0 + 9, tz - 1, false, true);
  W.light(tx, y0 + 6, tz + 6, '#ffb070', 1.6, 26);
  reserve.mark(tx - 20, tz - 4, tx + 20, tz + 4);

  // ---- stone lanterns flanking the gate and the approach
  stoneLantern(W, P, tx - 16, tz + 10); stoneLantern(W, P, tx + 16, tz + 10);
  for (let z = tz - 22; z >= STAIRS.z1 + 4; z -= 22) { stoneLantern(W, P, tx - 11, z); stoneLantern(W, P, tx + 11, z); }
  stoneLantern(W, P, tx - 13, tz + 46); stoneLantern(W, P, tx + 13, tz + 46);

  // ---- lantern frames along the approach (yatai-style posts with a rail)
  const frameMat = P.id('woodDark');
  for (const fx of [tx - 7, tx + 6]) {
    for (let z = SHRINE.z1 - 30; z >= STAIRS.z1 + 2; z--) {
      if (Math.abs(z - tz) < 4) continue;
      const g = groundH(fx, z);
      if ((z - tz) % 8 === 0) for (let y = g + 1; y <= g + 10; y++) W.set(fx, y, z, frameMat);
      W.set(fx, g + 10, z, V);
      if (((z - tz) % 4 + 4) % 4 === 2) chochin(W, P, fx, g + 5, z, ((z / 4) | 0) % 3 === 0, ((z / 4) | 0) % 2 === 0);
    }
  }
  reserve.mark(tx - 10, STAIRS.z1, tx + 10, SHRINE.z1);

  // ---- vermilion stair rails up the pagoda hill
  for (let z = STAIRS.z0; z < STAIRS.z1; z++) {
    const g = groundH(STAIRS.x0, z);
    for (const x of [STAIRS.x0 - 1, STAIRS.x1 + 1]) {
      const gg = Math.max(g, groundH(x, z));
      for (let y = Math.min(16, gg) + 1; y <= gg + 2; y++) W.set(x, y, z, y === gg + 2 ? V : P.id('stone'));
    }
  }
  // a second, smaller torii at the top of the stairs
  const t2z = STAIRS.z0 + 1, t2y = HILL + 1;
  for (const px of [tx - 6, tx + 6]) W.box(px, t2y - 12, t2z, px, t2y + 11, t2z, V);
  W.box(tx - 8, t2y + 8, t2z, tx + 8, t2y + 8, t2z, V);
  for (let x = tx - 10; x <= tx + 10; x++) W.box(x, t2y + 11 + (Math.abs(x - tx) >= 8 ? 1 : 0), t2z, x, t2y + 11 + (Math.abs(x - tx) >= 8 ? 1 : 0), t2z, BK);
  W.box(tx - 9, t2y + 10, t2z, tx + 9, t2y + 10, t2z, V);

  // ---- shrine hall (haiden) facing the approach
  machiya(W, P, rng, { x: tx - 20, z: 126, facing: '+x', w: 26, d: 20, floors: 1, big: true, plaster: 'plasterWhite', roof: 'hip' });
  for (let z = 101; z <= 126; z += 5) for (let y = groundH(tx - 20, z) + 1; y <= groundH(tx - 20, z) + 10; y++) W.set(tx - 20, y, z, V);
  reserve.mark(tx - 44, 98, tx - 16, 130);
  chochin(W, P, tx - 18, groundH(tx - 18, 116) + 6, 116, true); chochin(W, P, tx - 18, groundH(tx - 18, 108) + 6, 108, true);

  // ---- offering box / ema board near the hall
  W.box(tx - 15, 17, 112, tx - 13, 18, 114, P.id('wood'));

  // ---- low stone fence along the shrine edge facing the street
  for (let z = SHRINE.z0; z <= SHRINE.z1; z++) {
    const g = groundH(SHRINE.x1, z);
    if (z % 6 === 0) for (let y = g + 1; y <= g + 4; y++) W.set(SHRINE.x1, y, z, P.id('stone'));
    W.set(SHRINE.x1, g + 4, z, P.id('stoneLight'));
  }
  // foreground balustrade (bottom-left of the hero view)
  for (let x = tx + 6; x <= tx + 34; x++) {
    const z = 136, g = groundH(x, z);
    if ((x - tx) % 4 === 2) for (let y = g + 1; y <= g + 5; y++) W.set(x, y, z, P.id('stone'));
    W.set(x, g + 5, z, P.id('stoneLight')); W.set(x, g + 2, z, P.id('stoneDark'));
  }
  void PAGODA;
}
