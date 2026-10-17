import * as THREE from 'three';
import { TRACK } from './layout.js';

export const RAIL_HALF = 470;
export const DECK_TOP = 30; // rail-head level is DECK_TOP

// Built in track-local coordinates (x along the line, z across, y up).
export function buildViaduct(W, P) {
  const id = (n) => P.id(n);
  const V = id('viaduct'), VD = id('viaductDark'), G = id('girder'), GD = id('girderDark');
  const RL = id('rail'), SL = id('sleeper'), BA = id('ballast'), ST = id('steel'), LAMP = id('lampWarm');
  const wires = [];
  for (let x = -RAIL_HALF; x <= RAIL_HALF; x++) {
    // deck slab
    for (let z = -9; z <= 9; z++) for (let y = 24; y <= 26; y++) W.set(x, y, z, y === 24 ? VD : V);
    for (let z = -8; z <= 8; z++) W.set(x, 27, z, BA);
    // sleepers + rails (two tracks)
    if ((x & 1) === 0) for (const c of [-4, 4]) for (let z = c - 3; z <= c + 3; z++) W.set(x, 28, z, SL);
    for (const z of [-6, -2, 2, 6]) { W.set(x, 28, z, SL); W.set(x, 29, z, RL); }
    // truss side girders (open web)
    for (const s of [-1, 1]) {
      const z = s * 10;
      for (let y = 24; y <= 33; y++) {
        const yy = y - 24;
        let m = null;
        if (yy === 0 || yy === 9) m = G;
        else if (((x % 10) + 10) % 10 === 0) m = G;
        else if ((((x + yy) % 10) + 10) % 10 === 0 || (((x - yy) % 10) + 10) % 10 === 0) m = GD;
        if (m) { W.set(x, y, z, m); W.set(x, y, z + s, m); }
      }
      W.set(x, 34, z, GD);
    }
    // piers
    if ((((x + 18) % 36) + 36) % 36 === 0) {
      for (let y = 0; y <= 23; y++) W.box(x - 2, y, -3, x + 2, y, 3, (xx, yy, zz) => (Math.abs(zz) === 3 || Math.abs(xx - x) === 2 ? V : VD));
      W.box(x - 3, 21, -11, x + 3, 23, 11, V);
      // under-deck lamp
      W.set(x + 3, 22, 0, LAMP);
      W.light(x + 5, 20, 0, '#ffcf8a', 1.4, 18);
    }
    // catenary masts + gantries
    if (((x % 36) + 36) % 36 === 0) {
      for (const s of [-1, 1]) for (let y = 30; y <= 46; y++) W.set(x, y, s * 12, ST);
      for (let z = -12; z <= 12; z++) { W.set(x, 46, z, ST); if ((z & 3) === 0) W.set(x, 45, z, ST); }
      for (const c of [-4, 4]) W.box(x, 42, c, x, 44, c, ST);
    }
  }
  // overhead contact + messenger wires (thin tubes, added by the caller)
  for (const c of [-4, 4]) {
    wires.push([new THREE.Vector3(-RAIL_HALF, 41, c + 0.5), new THREE.Vector3(RAIL_HALF, 41, c + 0.5)]);
    wires.push([new THREE.Vector3(-RAIL_HALF, 43.5, c + 0.5), new THREE.Vector3(RAIL_HALF, 43.5, c + 0.5)]);
  }
  return { wires };
}

// One commuter car: length 30 along +x, centred on z = 0, wheels at y = 0.
export function buildCar(W, P, kind = 'mid') {
  const id = (n) => P.id(n);
  const B = id('trainBody'), BD = id('trainBodyDark'), GR = id('trainGreen'), YE = id('trainYellow');
  const WIN = id('trainWin'), DK = id('trainDark'), HL = id('headlight'), TL = id('taillight'), LED = id('destLED');
  const L = 30;
  const doors = [3, 10, 17, 24];
  for (let x = 0; x < L; x++)
    for (let z = -3; z <= 3; z++)
      for (let y = 2; y <= 10; y++) {
        const side = Math.abs(z) === 3, end = x === 0 || x === L - 1;
        if (!side && !end) { W.set(x, y, z, y === 10 ? BD : DK); continue; }
        let m = B;
        if (y === 2) m = DK;
        else if (y === 10) m = BD;
        else if (side) {
          const door = doors.some((d) => x >= d && x <= d + 2);
          if (door) m = y >= 6 && y <= 8 && x !== doors.find((d) => x >= d && x <= d + 2) + 1 ? WIN : y === 3 ? GR : BD;
          else if (y === 3 || y === 4) m = GR;
          else if (y === 5) m = YE;
          else if (y >= 6 && y <= 8) m = x % 4 === 0 ? B : WIN;
          else m = B;
        } else {
          // car ends
          const front = (kind === 'front' && x === L - 1) || (kind === 'rear' && x === 0);
          if (front) {
            if (y >= 6 && y <= 8 && Math.abs(z) <= 2) m = WIN;
            else if (y === 4 && Math.abs(z) === 2) m = kind === 'front' ? HL : TL;
            else if (y === 9 && Math.abs(z) <= 1) m = LED;
            else if (y <= 4) m = GR;
            else m = B;
          } else m = Math.abs(z) <= 1 && y >= 3 && y <= 8 ? DK : B;
        }
        W.set(x, y, z, m);
      }
  // roof units + pantograph
  W.box(8, 11, -2, 12, 11, 2, BD); W.box(18, 11, -2, 22, 11, 2, BD);
  if (kind === 'mid') { W.box(14, 11, -1, 15, 12, 1, DK); W.line(14, 12, 0, 16, 14, 0, DK); W.box(15, 14, -2, 17, 14, 2, DK); }
  // bogies + wheels
  for (const bx of [4, 21]) {
    W.box(bx, 1, -2, bx + 5, 1, 2, DK);
    for (const wx of [bx, bx + 4]) for (const z of [-3, 3]) W.box(wx, 0, z, wx + 1, 1, z, DK);
  }
  // under-floor equipment
  W.box(11, 1, -2, 18, 1, 2, BD);
}

export function trackFrame() {
  const g = new THREE.Group();
  g.position.set(TRACK.x, 0, TRACK.z);
  g.rotation.y = -TRACK.angle;
  return g;
}
