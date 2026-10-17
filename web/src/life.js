import * as THREE from 'three';
import { VoxelWorld, meshModel } from './voxel.js';
import { groundH, PAGODA, MAIN_HALF, DMAIN_HALF } from './build/layout.js';

// ---------------------------------------------------------------------------
// Street life: voxel cars on the boulevard (driving on the left), people on
// the old street and the district sidewalks (umbrellas up in the rain), and
// crows circling the pagoda. All instanced; one draw call per model.
// ---------------------------------------------------------------------------

// ---- models (built at fine voxel resolution, scaled down per instance) ----
function carModel(P, kind) {
  const W = new VoxelWorld(P, 1, 'car');
  const id = (n) => P.id(n);
  const body = id({ taxi: 'carTaxi', white: 'carWhite', blue: 'carBlue', red: 'carRed', bus: 'carBus', black: 'carBlack' }[kind]);
  const bus = kind === 'bus';
  const L = bus ? 24 : 14, Wd = 7, H = bus ? 9 : 3;
  const G = id('carGlass'), T = id('tire'), HL = id('headlight'), TL = id('taillight');
  for (let z = 0; z < L; z++)
    for (let x = 0; x < Wd; x++) {
      for (let y = 1; y <= H; y++) {
        let m = body;
        if (bus) {
          if (y >= 4 && y <= 7 && (x === 0 || x === Wd - 1 || z === 0 || z === L - 1) && z % 4 !== 1) m = G;
          if (y <= 2) m = id('carWhite');
          if (y === 9) m = id('carWhite');
        }
        W.set(x, y, z, m);
      }
      const wheel = (bus ? [3, 4, 19, 20] : [2, 3, 10, 11]).includes(z) && (x === 0 || x === Wd - 1);
      if (wheel) W.set(x, 0, z, T);
    }
  if (!bus) {
    // cabin with glass all round
    for (let z = 3; z <= 10; z++)
      for (let x = 1; x <= 5; x++)
        for (let y = 4; y <= 6; y++) {
          const shell = x === 1 || x === 5 || z === 3 || z === 10;
          W.set(x, y, z, y === 6 ? body : shell ? G : body);
        }
    if (kind === 'taxi') W.box(2, 7, 6, 4, 7, 7, id('taxiSign'));
  } else W.box(2, 8, L - 1, 4, 8, L - 1, id('destLED'));
  // lights: +z is the front
  for (const x of [1, Wd - 2]) { W.set(x, 2, L - 1, HL); W.set(x, 2, L, HL); }
  for (const x of [0, 1, Wd - 2, Wd - 1]) W.set(x, 2, -0, TL);
  return { geo: meshModel(W), off: new THREE.Vector3(Wd / 2, 0, L / 2), len: L, scale: 0.5 };
}

function personModel(P, shirt, kimono = false) {
  const W = new VoxelWorld(P, 1, 'person');
  const id = (n) => P.id(n);
  const S = id(shirt), PA = id('pants'), SK = id('skin'), HA = id('hair');
  for (let x = 0; x <= 2; x++)
    for (let z = 0; z <= 1; z++) {
      for (let y = 0; y <= 2; y++) if (kimono || x !== 1 || y === 2) W.set(x, y, z, kimono ? S : PA);
      for (let y = 3; y <= 5; y++) W.set(x, y, z, kimono && y === 4 ? id('obi') : S);
      for (let y = 6; y <= 7; y++) W.set(x, y, z, z === 0 || (y === 7 && x !== 1) ? HA : SK);
      W.set(x, 8, z, HA);
    }
  return { geo: meshModel(W), off: new THREE.Vector3(1.5, 0, 1), scale: 0.36 };
}

function umbrellaModel(P, col) {
  const W = new VoxelWorld(P, 1, 'umbrella');
  const C = P.id(col), H = P.id('woodDark');
  for (let y = 4; y <= 10; y++) W.set(4, y, 3, H);
  for (let x = 0; x <= 8; x++)
    for (let z = 0; z <= 6; z++) {
      const dx = x - 4, dz = z - 3, r = Math.max(Math.abs(dx), Math.abs(dz) * 1.3);
      if (r <= 4.2) W.set(x, 11, z, C);
      if (r <= 2.6) W.set(x, 12, z, C);
      if (r <= 1) W.set(x, 13, z, C);
    }
  // align handle with the person model's centre (person off = 1.5,0,1)
  return { geo: meshModel(W), off: new THREE.Vector3(4.5, 0, 3.5), scale: 0.36 };
}

function birdModel(P, up) {
  const W = new VoxelWorld(P, 1, 'bird');
  const C = P.id('crow');
  W.box(3, 2, 1, 3, 2, 4, C); W.set(3, 3, 4, C); W.set(3, 2, 5, C); W.set(3, 2, 0, C);
  if (up) { W.box(1, 3, 2, 2, 3, 3, C); W.box(4, 3, 2, 5, 3, 3, C); W.set(0, 4, 2, C); W.set(6, 4, 2, C); }
  else { W.box(1, 2, 2, 2, 2, 3, C); W.box(4, 2, 2, 5, 2, 3, C); W.set(0, 1, 2, C); W.set(6, 1, 2, C); }
  return { geo: meshModel(W), off: new THREE.Vector3(3.5, 2.5, 3), scale: 0.5 };
}

// ---------------------------------------------------------------------------
export function createLife(scene, P, material) {
  const group = new THREE.Group();
  group.name = 'life';
  scene.add(group);
  const M = new THREE.Matrix4(), O = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Pv = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  // shadows are baked into a static shadow map, so moving things don't cast
  const inst = (model, count, shadows = false) => {
    const m = new THREE.InstancedMesh(model.geo, material, count);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.castShadow = shadows; m.receiveShadow = true;
    m.userData.model = model;
    group.add(m);
    return m;
  };
  const place = (mesh, i, x, y, z, yaw, scaleMul = 1, roll = 0) => {
    const md = mesh.userData.model;
    const s = md.scale * scaleMul;
    Q.setFromAxisAngle(Y, yaw);
    if (roll) Q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
    M.compose(Pv.set(x, y, z), Q, S.set(s, s, s));
    O.makeTranslation(-md.off.x, -md.off.y, -md.off.z);
    M.multiply(O);
    mesh.setMatrixAt(i, M);
  };

  // ---- traffic ----
  const Z0 = -58, Z1 = -208, SPAN = Z0 - Z1;
  const carKinds = ['taxi', 'white', 'blue', 'red', 'black', 'taxi', 'white', 'bus'];
  const carMeshes = {};
  const cars = [];
  const lanes = [
    { x: -2.6, dir: -1, speed: 11 }, { x: -6.6, dir: -1, speed: 8 },
    { x: 2.6, dir: 1, speed: 10 }, { x: 6.6, dir: 1, speed: 7.5 },
  ];
  let ci = 0;
  for (const lane of lanes) {
    let z = Math.random() * 20;
    while (z < SPAN - 6) {
      const kind = carKinds[ci++ % carKinds.length];
      cars.push({ lane, kind, s: z });
      z += (kind === 'bus' ? 26 : 16) + Math.random() * 22;
    }
  }
  for (const k of new Set(carKinds)) {
    const n = cars.filter((c) => c.kind === k).length;
    carMeshes[k] = inst(carModel(P, k), n);
    carMeshes[k].userData.used = 0;
  }
  for (const c of cars) { const m = carMeshes[c.kind]; c.mesh = m; c.idx = m.userData.used++; }

  // ---- people ----
  const shirts = ['shirt0', 'shirt1', 'shirt2', 'shirt3', 'shirt4', 'shirt5', 'kimono'];
  const walkers = [];
  const addWalkers = (n, xs, za, zb) => {
    for (let i = 0; i < n; i++) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      walkers.push({
        x: xs[Math.floor(Math.random() * xs.length)] + (Math.random() - 0.5) * 0.8,
        z: za + Math.random() * (zb - za), za, zb, dir,
        speed: 1.4 + Math.random() * 1.2, ph: Math.random() * 10, y: null,
        v: Math.floor(Math.random() * shirts.length), u: Math.floor(Math.random() * 3),
        pause: 0,
      });
    }
  };
  const oh = MAIN_HALF - 2, dh = DMAIN_HALF - 1.2;
  addWalkers(34, [-oh, -oh + 1.6, oh - 1.6, oh], -48, 168);
  addWalkers(26, [-dh, dh], -206, -56);
  const personMeshes = shirts.map((sh) => inst(personModel(P, sh, sh === 'kimono'), walkers.filter((w) => shirts[w.v] === sh).length || 1));
  const umbMeshes = ['umbRed', 'umbNavy', 'umbClear'].map((c) => inst(umbrellaModel(P, c), walkers.filter((w) => w.u === ['umbRed', 'umbNavy', 'umbClear'].indexOf(c)).length || 1));
  const pUsed = shirts.map(() => 0), uUsed = [0, 0, 0];
  for (const w of walkers) { w.pi = pUsed[w.v]++; w.ui = uUsed[w.u]++; }

  // ---- crows over the pagoda ----
  const birds = [];
  for (let i = 0; i < 16; i++) {
    birds.push({
      r: 30 + Math.random() * 70, w: (0.16 + Math.random() * 0.14) * (i % 4 === 0 ? -1 : 1), a: Math.random() * Math.PI * 2,
      h: 78 + Math.random() * 50, ph: Math.random() * 10, bob: Math.random() * 10,
    });
  }
  const birdUp = inst(birdModel(P, true), birds.length, false);
  const birdDn = inst(birdModel(P, false), birds.length, false);

  function update(dt, t, rainK) {
    // cars
    for (const c of cars) {
      c.s = (c.s + c.lane.speed * dt) % SPAN;
      const z = c.lane.dir < 0 ? Z0 - c.s : Z1 + c.s;
      const edge = Math.min(c.s, SPAN - c.s);
      const k = THREE.MathUtils.smoothstep(edge, 0, 6);
      place(c.mesh, c.idx, c.lane.x, 1, z, c.lane.dir < 0 ? Math.PI : 0, k);
    }
    for (const m of Object.values(carMeshes)) m.instanceMatrix.needsUpdate = true;

    // people
    const umb = rainK > 0.35;
    for (const w of walkers) {
      if (w.pause > 0) w.pause -= dt;
      else {
        w.z += w.dir * w.speed * dt * (umb ? 0.8 : 1);
        if (w.z > w.zb) { w.z = w.zb; w.dir = -1; }
        if (w.z < w.za) { w.z = w.za; w.dir = 1; }
        if (Math.random() < dt * 0.02) w.pause = 2 + Math.random() * 5;
      }
      const gy = groundH(Math.round(w.x), Math.floor(w.z)) + 1;
      w.y = w.y === null ? gy : w.y + (gy - w.y) * Math.min(1, dt * 10);
      const walk = w.pause > 0 ? 0 : 1;
      const step = t * w.speed * 2.6 + w.ph;
      const bob = Math.abs(Math.sin(step)) * 0.16 * walk;
      const yaw = w.dir > 0 ? 0 : Math.PI;
      place(personMeshes[w.v], w.pi, w.x, w.y + bob, w.z, yaw, 1, Math.sin(step) * 0.05 * walk);
      if (umb) place(umbMeshes[w.u], w.ui, w.x, w.y + bob, w.z, yaw + Math.sin(t * 0.7 + w.ph) * 0.2);
      else umbMeshes[w.u].setMatrixAt(w.ui, ZERO);
    }
    for (const m of personMeshes) m.instanceMatrix.needsUpdate = true;
    for (const m of umbMeshes) m.instanceMatrix.needsUpdate = true;

    // birds
    birds.forEach((b, i) => {
      b.a += b.w * dt;
      const x = PAGODA.x + Math.cos(b.a) * b.r, z = PAGODA.z + Math.sin(b.a) * b.r;
      const y = b.h + Math.sin(t * 0.4 + b.bob) * 6;
      const yaw = Math.atan2(-Math.sin(b.a) * Math.sign(b.w), Math.cos(b.a) * Math.sign(b.w));
      const flapping = Math.sin(t * 0.5 + b.ph) > -0.3;
      const up = flapping ? Math.sin(t * 13 + b.ph * 5) > 0 : true;
      place(up ? birdUp : birdDn, i, x, y, z, yaw, 1, -0.35 * Math.sign(b.w));
      (up ? birdDn : birdUp).setMatrixAt(i, ZERO);
    });
    birdUp.instanceMatrix.needsUpdate = birdDn.instanceMatrix.needsUpdate = true;
  }

  return { group, update, get counts() { return { cars: cars.length, people: walkers.length, birds: birds.length }; } };
}
