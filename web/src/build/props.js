import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundH, MAIN_HALF, DMAIN_HALF, DISTRICT_Z, trackDist } from './layout.js';
import { CROSS_Z } from './terrain.js';

// Utility pole; returns wire anchor points (world space).
function pole(W, P, x, z, { h = 34, side = 1, transformer = false, lamp = true } = {}) {
  const g = groundH(x, z);
  const PO = P.id('pole'), PD = P.id('poleDark'), TR = P.id('transformer'), LAMP = P.id('lampWarm'), ST = P.id('stoneLight');
  const top = g + h;
  for (let y = g + 1; y <= top; y++) W.set(x, y, z, PO);
  for (let k = -3; k <= 3; k++) { W.set(x + k, top - 1, z, PD); if (Math.abs(k) <= 2) W.set(x + k, top - 5, z, PD); }
  for (const k of [-3, 0, 3]) W.set(x + k, top, z, ST);
  for (const k of [-2, 2]) W.set(x + k, top - 4, z, ST);
  if (transformer) {
    W.box(x - side * 2, top - 13, z, x - side * 1, top - 9, z + 1, TR);
    W.set(x - side * 1, top - 8, z, PD);
  }
  if (lamp) {
    const ly = g + 17;
    for (let k = 1; k <= 3; k++) W.set(x + side * k, ly + (k === 3 ? 0 : 1), z, PD);
    W.set(x + side * 3, ly - 1, z, LAMP);
    W.light(x + side * 3 + 0.5, ly - 3, z + 0.5, '#ffd9a0', 2.0, 22);
  }
  const A = (dx, dy) => new THREE.Vector3(x + dx + 0.5, top + dy + 0.5, z + 0.5);
  return { hi: [A(-3, 0), A(0, 0), A(3, 0)], lo: [A(-2, -4), A(2, -4)], mid: A(0, -11) };
}

function streetLamp(W, P, x, z, side) {
  const g = groundH(x, z);
  const PD = P.id('poleDark'), LAMP = P.id('lampWarm');
  for (let y = g + 1; y <= g + 12; y++) W.set(x, y, z, PD);
  W.set(x + side, g + 12, z, PD); W.set(x + side * 2, g + 12, z, PD);
  W.set(x + side * 2, g + 11, z, LAMP);
  W.light(x + side * 2 + 0.5, g + 9, z + 0.5, '#ffe0b0', 1.3, 18);
}

export function buildProps(W, P, rng, reserve) {
  const wires = [];
  const link = (a, b, sag = 1) => wires.push([a, b, sag]);
  // poles down the old street, both sides
  for (const side of [-1, 1]) {
    let prev = null;
    for (let z = 140 - (side > 0 ? 13 : 0); z >= DISTRICT_Z + 4; z -= 26) {
      const x = side * (MAIN_HALF + 1);
      if (trackDist(x, z) < 13) { prev = null; continue; }
      const p = pole(W, P, x, z, { side: -side, transformer: rng.chance(0.4) });
      reserve.mark(x - 1, z - 1, x + 1, z + 1);
      if (prev) {
        for (let i = 0; i < 3; i++) link(prev.hi[i], p.hi[i], 1.2);
        for (let i = 0; i < 2; i++) link(prev.lo[i], p.lo[i], 1.6);
        link(prev.mid, p.mid, 2.2);
      }
      // service drops to the houses
      for (let k = 0; k < 2; k++) {
        const hz = z + rng.int(-10, 10);
        link(p.lo[k], new THREE.Vector3(side * (MAIN_HALF + 5), groundH(side * 12, hz) + 15, hz), 1.2);
      }
      prev = p;
    }
  }
  // cross-street spans
  for (let z = 100; z >= DISTRICT_Z + 4; z -= 52) {
    const g = groundH(0, z);
    link(new THREE.Vector3(-MAIN_HALF - 0.5, g + 33, z + 0.5), new THREE.Vector3(MAIN_HALF + 1.5, g + 33, z - 12.5), 2.5);
  }
  // the hero pole, foreground left, with a fan of wires (as in the painting)
  const hero = pole(W, P, -50, 128, { h: 40, side: 1, transformer: true, lamp: true });
  reserve.mark(-52, 126, -48, 130);
  const fanTargets = [new THREE.Vector3(-110, 58, 150), new THREE.Vector3(-118, 46, 104), new THREE.Vector3(-96, 50, 78)];
  for (const t of fanTargets) for (const a of hero.hi) link(a, t, 2.0);
  for (const a of hero.lo) link(a, fanTargets[2], 2.4);

  // district street lamps
  for (let z = DISTRICT_Z - 8; z >= -205; z -= 16) {
    if (CROSS_Z.some(([a, b]) => z >= a - 1 && z <= b + 1)) continue;
    for (const side of [-1, 1]) {
      const x = side * (DMAIN_HALF - 1);
      if (trackDist(x, z) < 12) continue;
      streetLamp(W, P, x, z, -side);
    }
  }
  return wires;
}

export function wireGeometry(wires, radius = 0.09) {
  const geos = [];
  for (const [a, b, sag] of wires) {
    const len = a.distanceTo(b);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y -= sag * (0.6 + len * 0.025) * 2;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    geos.push(new THREE.TubeGeometry(curve, Math.max(6, Math.ceil(len / 5)), radius, 3, false));
  }
  const g = mergeGeometries(geos, false);
  geos.forEach((x) => x.dispose());
  return g;
}
