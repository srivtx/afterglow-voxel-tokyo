import * as THREE from 'three';
import { VoxelWorld, meshWorld, makeVoxelMaterial, makeCloudMaterial, makeFlatMaterial } from './voxel.js';
import { makePalette } from './palette.js';
import { RNG } from './rng.js';
import { Reserve } from './build/layout.js';
import { buildTerrain } from './build/terrain.js';
import { buildPagoda } from './build/pagoda.js';
import { buildShrine } from './build/shrine.js';
import { buildStreetHouses, buildBigHouses } from './build/houses.js';
import { buildDistrict } from './build/district.js';
import { buildTower } from './build/tower.js';
import { buildTrees } from './build/trees.js';
import { buildProps, wireGeometry, wireLines } from './build/props.js';
import { buildSkyline, buildFarSkyline } from './build/skyline.js';
import { buildViaduct, buildCar, trackFrame, DECK_TOP } from './build/rail.js';
import { buildClouds } from './build/clouds.js';

// rAF lets the loader paint; the timeout keeps building in a hidden tab
const tick = () => new Promise((r) => { requestAnimationFrame(() => setTimeout(r, 0)); setTimeout(r, 60); });

export async function buildCity(scene, onProgress = () => {}) {
  const t0 = performance.now();
  const P = makePalette();
  const mat = makeVoxelMaterial();
  const reserve = new Reserve();
  const fine = new VoxelWorld(P, 1, 'fine');
  const stats = {};

  const stages = [
    ['Shaping the hillside', () => buildTerrain(fine, P)],
    ['Raising the five-storey pagoda', () => buildPagoda(fine, P, reserve)],
    ['Lighting the shrine lanterns', () => buildShrine(fine, P, new RNG(11), reserve)],
    ['Building the old town', () => { stats.houses = buildStreetHouses(fine, P, new RNG(21), reserve) + buildBigHouses(fine, P, new RNG(22), reserve); }],
    ['Switching on the neon', () => { stats.district = buildDistrict(fine, P, new RNG(31), reserve); }],
    ['Assembling Tokyo Tower', () => buildTower(fine, P, new RNG(41))],
    ['Stringing the power lines', () => { stats.wires = buildProps(fine, P, new RNG(51), reserve); }],
    ['Blooming the cherry trees', () => { stats.trees = buildTrees(fine, P, new RNG(61), reserve); }],
  ];
  const total = stages.length + 8;
  let step = 0;
  const report = (label, sub = 0) => onProgress((step + sub) / total, label);
  for (const [label, fn] of stages) {
    report(label);
    await tick();
    fn();
    step++;
  }

  report('Laying the skyline');
  await tick();
  const coarse = new VoxelWorld(P, 3, 'coarse');
  stats.skyline = buildSkyline(coarse, P, new RNG(71));
  const far = new VoxelWorld(P, 6, 'far');
  stats.far = buildFarSkyline(far, P, new RNG(72));
  step++;

  report('Raising the railway');
  await tick();
  const railW = new VoxelWorld(P, 1, 'rail');
  const { wires: railWires } = buildViaduct(railW, P);
  const cars = {};
  for (const k of ['front', 'mid', 'rear']) { cars[k] = new VoxelWorld(P, 1, 'car-' + k); buildCar(cars[k], P, k); }
  const clouds = buildClouds(P);
  step++;

  // ------------------------------------------------------------------ meshing
  const groups = {};
  const mk = (name) => { const g = new THREE.Group(); g.name = name; scene.add(g); groups[name] = g; return g; };
  let faces = 0;
  report('Meshing the old town');
  faces += await meshWorld(fine, mat, mk('fine'), { shadows: true, onProgress: (f) => report('Meshing the old town', f * 2) });
  step += 2;
  report('Meshing the skyline');
  faces += await meshWorld(coarse, mat, mk('coarse'), { shadows: false, freeData: true, onProgress: (f) => report('Meshing the skyline', f) });
  step++;
  faces += await meshWorld(far, mat, mk('far'), { shadows: false, receive: false, freeData: true });
  step++;

  report('Meshing the railway');
  const rail = trackFrame();
  rail.name = 'rail';
  scene.add(rail);
  groups.rail = rail;
  faces += await meshWorld(railW, mat, rail, { shadows: true }); // voxels kept: the walker collides with the viaduct
  const wireMat = makeFlatMaterial('#1a1824');
  const railW2 = railWires.map(([a, b]) => [a, b, 0.2]);
  rail.add(new THREE.Mesh(wireGeometry(railW2, 0.11), wireMat), new THREE.LineSegments(wireLines(railW2), wireMat));

  const carGroups = {};
  for (const k of Object.keys(cars)) {
    carGroups[k] = new THREE.Group();
    await meshWorld(cars[k], mat, carGroups[k], { shadows: false, freeData: true });
  }
  const makeTrain = () => {
    const t = new THREE.Group();
    const order = ['rear', 'mid', 'mid', 'mid', 'front'];
    order.forEach((k, i) => { const c = carGroups[k].clone(); c.position.x = i * 31; t.add(c); });
    return t;
  };
  const train = makeTrain();
  train.position.set(0, DECK_TOP, 4);
  rail.add(train);
  const train2 = makeTrain();
  train2.rotation.y = Math.PI;
  train2.position.set(0, DECK_TOP, -3);
  rail.add(train2);
  step++;

  report('Gathering the clouds');
  const cloudMat = makeCloudMaterial();
  const cloudGroup = mk('clouds');
  const cloudItems = [];
  for (const c of clouds) {
    const g = new THREE.Group();
    g.position.set(c.x, c.y, c.z);
    await meshWorld(c.world, cloudMat, g, { shadows: false, receive: false, freeData: true });
    cloudGroup.add(g);
    cloudItems.push({ group: g, drift: c.drift, x0: c.x });
  }
  step++;

  // street wires
  const wires = new THREE.Mesh(wireGeometry(stats.wires), wireMat);
  wires.name = 'wires';
  wires.add(new THREE.LineSegments(wireLines(stats.wires), wireMat));
  scene.add(wires);

  // ground plane under the coarse city
  const pg = new THREE.PlaneGeometry(9000, 9000, 1, 1);
  pg.rotateX(-Math.PI / 2);
  const n = pg.attributes.position.count;
  pg.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(n * 3).fill(0).map((_, i) => [62, 58, 80][i % 3]), 3, true));
  pg.setAttribute('bake', new THREE.BufferAttribute(new Uint8Array(n * 3), 3, true));
  pg.setAttribute('grp', new THREE.BufferAttribute(new Uint8Array(n), 1));
  const ground = new THREE.Mesh(pg, mat);
  ground.position.y = 0.6;
  ground.receiveShadow = true;
  scene.add(ground);

  stats.faces = faces;
  stats.ms = Math.round(performance.now() - t0);
  stats.lights = fine.lights.length;
  onProgress(1, 'Ready');
  return { fine, railWorld: railW, groups, rail, train, train2, clouds: cloudItems, wires, stats, palette: P, material: mat };
}
