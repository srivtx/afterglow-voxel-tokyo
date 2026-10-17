import * as THREE from 'three';
import { createWalker } from './walker.js';
import { FINE, PAGODA, TORII, SHRINE, STAIRS, MAIN_HALF, DISTRICT_Z, SLOPE, TOWER, TRACK, trackDist, groundH, inFine } from './build/layout.js';

// ---------------------------------------------------------------------------
// 散歩 Walk mode: input (keys, touch stick), the follow camera, the places
// you discover, and the small things you can do along the way: pray at the
// shrine and draw a fortune, strike the temple bell, buy a drink from a
// vending machine, or let a sky lantern go.
// ---------------------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const UP = new THREE.Vector3(0, 1, 0);
const SPAWN = { x: 2.5, z: 128, yaw: Math.PI };       // the old street, facing downhill
const OFFERING = { x: -76, y: 17, z: 113 };            // the offering box in front of the shrine hall
const BELL = { x: PAGODA.x + 15, z: PAGODA.z + 12 };   // where the map shows the bell (any spot on the hill top rings it)

// `at`: where the name sits on the map. `go`: where you're set down when you
// travel there from the big map (x, z, facing). `s`: a shorter name for the small
// map, where there's less room. `hint`: shown until it's found.
export const PLACES = {
  sando: { jp: '参道', en: 'The shrine approach', at: [-62, 60], go: [-62, 64, 0], hint: 'Through the red torii' },
  hall: { jp: '拝殿', en: 'The shrine hall', at: [-80, 124], go: [-66, 113, -Math.PI / 2], hint: 'At the end of the approach' },
  pagoda: { jp: '五重塔', en: 'Pagoda hill', at: [-62, -12], go: [-62, 8, Math.PI], s: ['塔', -62, -12], hint: 'Up the stone stairs' },
  street: { jp: '商店街', en: 'The old shopping street', at: [0, 150], go: [2.5, 128, Math.PI], hint: 'Where the walk begins' },
  slope: { jp: '夕焼け坂', en: 'Sunset slope', at: [0, -18], go: [2.5, 4, Math.PI], s: ['坂', 18, -14], hint: 'Downhill from the old street' },
  tracks: { jp: '高架下', en: 'Under the tracks', at: [64, -4], go: [12.5, -35, -Math.PI / 2], s: ['高架', 100, 14], hint: 'Beneath the railway' },
  district: { jp: '繁華街', en: 'The neon district', at: [0, -150], go: [0, -110, Math.PI], hint: 'Past the railway, into the lights' },
  lanes: { jp: '下町', en: 'Old town lanes', at: [70, 90], go: [40, 100, Math.PI / 2], hint: 'The side streets off the old street' },
  roofs: { jp: '屋根の上', en: 'On the rooftops', hint: 'Somewhere up high' },
};
const N_PLACES = Object.keys(PLACES).length;
function placeAt(x, y, z) {
  const g = groundH(Math.floor(x), Math.floor(z)) + 1;
  if (Math.hypot(x - PAGODA.x, z - PAGODA.z) < PAGODA.r + 2 && y >= 27) return 'pagoda';
  if (trackDist(x, z) < 9) return 'tracks';
  if (y - g > 6) return 'roofs';
  if (x >= -104 && x <= -50 && z >= 96 && z <= 136) return 'hall';
  if ((x >= SHRINE.x0 && x <= SHRINE.x1 && z >= SHRINE.z0) || (x >= STAIRS.x0 - 3 && x <= STAIRS.x1 + 3 && z >= STAIRS.z0 && z <= STAIRS.z1)) return 'sando';
  if (z < DISTRICT_Z) return 'district';
  if (Math.abs(x) <= MAIN_HALF + 1) return z > SLOPE.top ? 'street' : 'slope';
  return 'lanes';
}

// おみくじ: fortunes drawn at the shrine
const OMIKUJI = [
  [2, '大吉', 'Great blessing', 'Every lantern you let go tonight will find the sea.'],
  [3, '中吉', 'Middle blessing', 'The train you almost missed will wait one more minute.'],
  [3, '小吉', 'Small blessing', 'Look up at the next firework. That one is yours.'],
  [4, '吉', 'Blessing', 'Someone on this street is humming the song stuck in your head.'],
  [3, '末吉', 'Blessing to come', 'The rain stops at the third crossing. Keep walking.'],
  [1, '凶', 'Bad luck', 'Tie this one to the shrine fence and walk on. The evening forgives.'],
];
const DRINKS = {
  spring: ['お茶', 'Cold green tea', '¥140'],
  summer: ['ラムネ', 'Ramune — the marble pops', '¥160'],
  autumn: ['あったか〜い', 'Hot canned coffee', '¥130'],
  winter: ['おしるこ', 'Hot sweet red-bean soup', '¥150'],
};

export function createWalkMode(ctx) {
  const { camera, controls, music, lanterns, toast, store } = ctx;
  let walker = null, city = null, active = false, camDist = 12, rotIn = 0, vend = new Set();
  const head = new THREE.Vector3(), delta = new THREE.Vector3(), off = new THREE.Vector3(), dir = new THREE.Vector3();
  const fwd = new THREE.Vector3(), right = new THREE.Vector3();
  const joy = { x: 0, y: 0, on: false, id: -1 };
  let jumpReq = false, actionT = 0, action = null, busy = 0, placeK = null, placeT = 0, shownPlace = null, saved = null;
  let mapBase = null, mapT = 0, released = 0, keysTimer = 0, cardTimer = 0, placeTimer = 0;
  let found;
  try { found = new Set(JSON.parse(store.get('places') || '[]')); } catch (e) { found = new Set(); }

  // --------------------------------------------------------------- setup
  function init(c) {
    city = c;
    walker = createWalker({ P: c.palette, material: c.material, world: c.fine, rail: c.rail, railWorld: c.railWorld });
    ctx.scene.add(walker.group);
    vend = new Set(['vending', 'vendingRed', 'vendingBlue'].map((n) => c.palette.map[n]).filter(Boolean));
    walker.hooks.onStep = (surf, run) => music.sfx('step', { surf: ground(surf), lvl: 0.45 + 0.35 * run });
    walker.hooks.onLand = (v, surf) => music.sfx('land', { surf: ground(surf), lvl: Math.min(1, v / 18) });
    bindTouch();
    bindMap();
    $('#omikuji').addEventListener('click', closeCard);
  }
  function ground(surf) {
    const e = ctx.env();
    if (e.snowCover > 0.4 && surf !== 'wood') return 'snow';
    if (e.wet > 0.3 && surf !== 'grass') return 'wet';
    return surf;
  }

  // Start where the camera is looking, at street level; fall back to the old street.
  function spawnFromView() {
    camera.getWorldDirection(dir);
    const hit = ctx.raycast(camera.position.clone(), dir.clone(), 900);
    const yaw = Math.atan2(dir.x, dir.z);
    if (hit && inFine(hit.x, hit.z)) {
      const back = new THREE.Vector3(camera.position.x - hit.x, 0, camera.position.z - hit.z);
      const len = back.length(); back.normalize();
      for (let d = 0; d < Math.min(len, 120); d += 1.5) {
        const x = hit.x + back.x * d, z = hit.z + back.z * d;
        if (!inFine(x, z)) break;
        const gy = walker.groundAt(x, z);
        if (gy <= groundH(Math.floor(x), Math.floor(z)) + 2 && !walker.hits(x, gy, z)) { walker.place(x, z, gy, yaw); return; }
      }
    }
    walker.place(SPAWN.x, SPAWN.z, null, SPAWN.yaw);
  }

  function enter(at = null) {
    if (!walker) return false;
    active = true;
    document.body.classList.add('walk');
    saved = saved || { min: controls.minDistance, max: controls.maxDistance, polar: controls.maxPolarAngle, pan: controls.enablePan };
    Object.assign(controls, { minDistance: 2.5, maxDistance: 70, maxPolarAngle: Math.PI * 0.68, enablePan: false, autoRotate: false });
    if (at) walker.place(at.x, at.z, at.y, at.yaw);
    else if (!walker.placed) spawnFromView();
    walker.visible = true;
    camDist = window.innerWidth < window.innerHeight ? 15 : 12.5;
    frame(at ? 0.01 : 1.9);
    shownPlace = null; placeT = 0; placeK = null;
    if (!mapBase) setTimeout(buildMap, 400);   // after the fly-in has started
    $('#walkKeys').classList.add('show');
    clearTimeout(keysTimer); keysTimer = setTimeout(() => $('#walkKeys').classList.remove('show'), 9000);
    return true;
  }
  // fly the camera to a spot behind the walker that is clear of walls
  function frame(dur) {
    aimBehind();
    const f = walker.focus(new THREE.Vector3());
    const free = Math.max(1.5, clearance(f, want, camDist) - 0.4);
    effDist = Math.min(camDist, free);
    ctx.flyTo(f.clone().addScaledVector(want, effDist).toArray(), f.toArray(), dur);
  }
  function leave() {
    closeMap();
    active = false;
    document.body.classList.remove('walk');
    if (saved) Object.assign(controls, { minDistance: saved.min, maxDistance: saved.max, maxPolarAngle: saved.polar, enablePan: saved.pan });
    saved = null;
    if (walker) walker.near = false;
    joy.on = false; joy.x = joy.y = 0;
    $('#walkKeys').classList.remove('show');
    closeCard();
  }

  // ---------------------------------------------------------------- frame
  function update(dt, t, flying) {
    if (!walker || !walker.placed) return;
    const e = ctx.env();
    let ix = 0, iz = 0, run = false;
    rotIn = 0;
    if (active && !flying) {
      const k = ctx.keys();
      camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
      right.crossVectors(fwd, UP);
      let f = 0, s = 0;
      if (k.has('w') || k.has('arrowup')) f += 1;
      if (k.has('s') || k.has('arrowdown')) f -= 1;
      if (k.has('d')) s += 1;
      if (k.has('a')) s -= 1;
      if (joy.on) { f += joy.y; s += joy.x; }
      ix = fwd.x * f + right.x * s; iz = fwd.z * f + right.z * s;
      const m = Math.hypot(ix, iz);
      if (m > 1) { ix /= m; iz /= m; }
      run = k.has('shift') || (joy.on && Math.hypot(joy.x, joy.y) > 0.92);
      rotIn = (k.has('arrowleft') ? 1 : 0) - (k.has('arrowright') ? 1 : 0);
    }
    walker.update(dt, t, { x: ix, z: iz, run, jump: jumpReq && active }, e);
    jumpReq = false;
    busy -= dt;
    if (!active) return;
    if ((actionT -= dt) <= 0) {
      actionT = 0.2;
      const a = findAction();
      if (a !== action) { action = a; renderPrompt(); }   // touch the DOM only when it changes
    }
    const pk = placeAt(walker.pos.x, walker.pos.y, walker.pos.z);
    if (pk !== placeK) { placeK = pk; placeT = 0; showHere(pk); } else placeT += dt;
    if (placeT > 0.8 && pk !== shownPlace) { shownPlace = pk; showPlace(pk); }
    if ((mapT += dt) > 0.07) { mapT = 0; drawMap(); }
  }

  // Third-person camera: carried along with the walker, orbit with a drag, ← →
  // to turn. A thick probe keeps it out of walls, trees and the viaduct; when
  // boxed in it rises over the walker's head instead of entering a building.
  const want = new THREE.Vector3(0, 0.38, 1).normalize(), cur = new THREE.Vector3(0, 0.38, 1).normalize();
  const tryDir = new THREE.Vector3(), side = new THREE.Vector3(), upv = new THREE.Vector3(), probe = new THREE.Vector3();
  let effDist = 12;
  function clearance(from, d, maxD) {
    side.crossVectors(d, UP);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize().multiplyScalar(0.4);
    upv.crossVectors(side, d).normalize().multiplyScalar(0.3);
    let m = walker.rayFree(from, d, maxD);
    for (let k = 0; k < 4 && m > 0.3; k++) {
      probe.copy(from).addScaledVector(k < 2 ? side : upv, k % 2 ? -1 : 1);
      m = Math.min(m, walker.rayFree(probe, d, m));
    }
    return m;
  }
  // candidate camera directions when the view behind the walker is blocked:
  // swing round to either side, then rise over the walker's head
  const SWINGS = [[0, 0], [0.55, 0], [-0.55, 0], [1.1, 0], [-1.1, 0], [0, 0.4], [1.7, 0], [-1.7, 0], [0.55, 0.4], [-0.55, 0.4], [2.5, 0], [-2.5, 0], [0, 0.75]];
  const cands = SWINGS.map(() => new THREE.Vector3());
  let pick = 0;
  // the camera's near plane must not touch anything either
  function boxed(p) {
    const W = city.fine;
    for (let dx = -0.55; dx <= 0.56; dx += 0.55) for (let dy = -0.55; dy <= 0.56; dy += 0.55) for (let dz = -0.55; dz <= 0.56; dz += 0.55)
      if (W.get(p.x + dx, p.y + dy, p.z + dz)) return true;
    return false;
  }
  function follow(dt) {
    walker.focus(head);
    controls.target.copy(head);
    off.copy(want);
    if (rotIn) off.applyAxisAngle(UP, rotIn * dt * 1.9);
    camera.position.copy(head).addScaledVector(off, camDist);
    controls.update();                                   // the user's drag and zoom
    camDist = Math.max(controls.minDistance, camera.position.distanceTo(head));
    want.subVectors(camera.position, head).normalize();
    // find somewhere the camera can be: prefer the user's view, stick with the last swing while it works
    const need = Math.min(camDist, 4.5);
    SWINGS.forEach(([yawOff, rise], k) => cands[k].copy(want).applyAxisAngle(UP, yawOff).lerp(UP, rise).normalize());
    let best = -1, bestC = -1;
    const order = pick ? [0, pick] : [0];
    for (let k = 1; k < cands.length; k++) if (k !== pick) order.push(k);
    for (const k of order) {
      const c = clearance(head, cands[k], camDist);
      if (c >= need) { best = k; bestC = c; break; }
      if (c > bestC + 0.3) { best = k; bestC = c; }
    }
    pick = best;
    cur.lerp(cands[best], Math.min(1, dt * 5)).normalize();
    let d = Math.max(0.3, Math.min(camDist, Math.min(bestC, clearance(head, cur, camDist)) - 0.4));
    effDist = d < effDist ? d : effDist + (d - effDist) * Math.min(1, dt * 2.5);
    camera.position.copy(head).addScaledVector(cur, effDist);
    while (effDist > 0.3 && boxed(camera.position)) { effDist -= 0.25; camera.position.copy(head).addScaledVector(cur, effDist); }
    camera.lookAt(head);
    walker.near = effDist < 1.6;
  }
  function aimBehind() {
    walker.focus(head);
    want.set(-Math.sin(walker.yaw), 0.5, -Math.cos(walker.yaw)).normalize();
    cur.copy(want);
    effDist = 0.5;                                        // grows out to the free distance
  }

  // -------------------------------------------------------------- actions
  const ACTIONS = {
    pray: { jp: '参拝', en: 'Pray at the shrine', run: pray, cool: 4 },
    bell: { jp: '鐘', en: 'Strike the temple bell', run: bell, cool: 4 },
    drink: { jp: '自販機', en: 'Buy a drink', run: drink, cool: 1.6 },
    lantern: { jp: '灯籠', en: 'Let a lantern go', run: lantern, cool: 0.7 },
  };
  function nearVending() {
    const p = walker.pos, x0 = Math.floor(p.x), y0 = Math.floor(p.y), z0 = Math.floor(p.z);
    for (let y = y0; y <= y0 + 4; y++) for (let x = x0 - 3; x <= x0 + 3; x++) for (let z = z0 - 3; z <= z0 + 3; z++) if (vend.has(city.fine.get(x, y, z))) return true;
    return false;
  }
  function findAction() {
    const p = walker.pos;
    if (p.x > OFFERING.x - 4 && p.x < OFFERING.x + 14 && Math.abs(p.z - OFFERING.z) < 11 && Math.abs(p.y - OFFERING.y) < 4) return ACTIONS.pray;
    if (Math.hypot(p.x - PAGODA.x, p.z - PAGODA.z) < PAGODA.r + 1 && p.y > 27) return ACTIONS.bell;
    if (nearVending()) return ACTIONS.drink;
    return ACTIONS.lantern;
  }
  function renderPrompt() {
    const el = $('#walkPrompt');
    const special = action && action !== ACTIONS.lantern;
    el.innerHTML = action ? `<kbd>E</kbd><b>${action.jp}</b> ${action.en}` : '';
    el.classList.toggle('special', !!special);
    $('#btnAct').innerHTML = action ? `<b>${action.jp}</b>` : '';
  }
  function act() {
    if (!active || !walker || busy > 0 || !action) return;
    if ($('#omikuji').classList.contains('show')) { closeCard(); return; }
    busy = action.cool;
    action.run();
  }
  function pray() {
    walker.bow();
    music.sfx('coin');
    setTimeout(() => music.sfx('suzu'), 750);
    setTimeout(() => music.sfx('clap'), 1550);
    setTimeout(drawFortune, 2700);
    if (!music.ambOn) toast('参拝 · A coin, the bell, two bows, two claps');
  }
  function drawFortune() {
    const total = OMIKUJI.reduce((a, o) => a + o[0], 0);
    let r = Math.random() * total, pick = OMIKUJI[0];
    for (const o of OMIKUJI) { r -= o[0]; if (r <= 0) { pick = o; break; } }
    const c = $('#omikuji');
    c.querySelector('.rank').textContent = pick[1];
    c.querySelector('.en').textContent = pick[2];
    c.querySelector('.line').textContent = pick[3];
    c.classList.toggle('bad', pick[1] === '凶');
    c.classList.add('show');
    clearTimeout(cardTimer); cardTimer = setTimeout(closeCard, 9000);
  }
  function closeCard() { $('#omikuji').classList.remove('show'); }
  function bell() {
    walker.bow();
    music.sfx('bell');
    toast(music.ambOn ? 'ゴーン… · The bell carries across the city' : '鐘 · Turn the city sound on (N) to hear it');
  }
  function drink() {
    const d = DRINKS[ctx.env().season] || DRINKS.spring;
    music.sfx('vending');
    setTimeout(() => toast(`${d[0]} · ${d[1]} — ${d[2]}`), 550);
  }
  function lantern() {
    const p = walker.pos, y = walker.yaw;
    lanterns.release(1, { x: p.x + Math.sin(y) * 1.4, y: p.y + 0.6, z: p.z + Math.cos(y) * 1.4 });
    released++;
    if (released === 1) toast(ctx.env().time > 0.45 ? '灯籠 · Your lantern rises — make a wish' : '灯籠 · Your lantern rises — they glow best after dusk');
    else if (released % 10 === 0) toast(`灯籠 · ${released} lanterns over the city`);
  }

  // ---------------------------------------------------------- places found
  function showPlace(k) {
    const p = PLACES[k];
    const isNew = !found.has(k);
    if (isNew) { found.add(k); store.set('places', JSON.stringify([...found])); }
    const el = $('#place');
    el.querySelector('.jp').textContent = p.jp;
    el.querySelector('.en').textContent = p.en;
    el.querySelector('.n').textContent = isNew ? `New place · ${found.size} / ${N_PLACES} found` : `${found.size} / ${N_PLACES} places found`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(placeTimer); placeTimer = setTimeout(() => el.classList.remove('show'), 3600);
    if (isNew && found.size === N_PLACES) setTimeout(() => toast('全部 · You have found every corner of the city'), 3800);
    if (bigOpen) renderList();
  }

  // ----------------------------------------------------------------- map
  // One top-down picture of the old town (a pixel per voxel column, hill-shaded),
  // drawn small at the side and large when opened (click it, or Tab). On the big
  // map, a place you have already found can be clicked to go straight there.
  const MW = FINE.x1 - FINE.x0 + 1, MH = FINE.z1 - FINE.z0 + 1;
  const vendPins = [];
  let mapBuilding = false, bigOpen = false, closing = null, hot = [], hoverK = null, hereK = null;
  // built in small slices (a few ms each) so entering walk mode never stutters;
  // each column scan starts at the top of its tallest voxel chunk
  function buildMap() {
    if (mapBuilding) return;
    mapBuilding = true;
    const cv = document.createElement('canvas'); cv.width = MW; cv.height = MH;
    const g = cv.getContext('2d'), img = g.createImageData(MW, MH), P = city.palette, world = city.fine;
    const hgt = new Float32Array(MW * MH), vendAt = [];
    const tops = new Map();
    for (const c of world.chunks.values()) {
      if (c.y1 < 0) continue;
      const k = c.cx + ',' + c.cz, top = c.cy * 64 + c.y1;
      if (!(tops.get(k) >= top)) tops.set(k, top);
    }
    let j = 0;
    const slice = () => {
      const t0 = performance.now();
      for (; j < MH && performance.now() - t0 < 5; j++) for (let i = 0; i < MW; i++) {
        const x = FINE.x0 + i, z = FINE.z0 + j, gh = groundH(x, z);
        let y = tops.get((x >> 6) + ',' + (z >> 6)) ?? 0;
        while (y > 0 && !world.get(x, y, z)) y--;
        const e = P.list[world.get(x, y, z)];
        const h = y - gh;
        const k = h > 2 ? 0.62 + Math.min(0.55, h / 70) : 0.42;
        const c = e ? e.s : [0.2, 0.2, 0.3], em = e && e.em >= 1 ? 1.5 : 1;
        const o = (i + j * MW) * 4;
        img.data[o] = 255 * Math.min(1, (c[0] * 0.75 + 0.1) * k * em);
        img.data[o + 1] = 255 * Math.min(1, (c[1] * 0.7 + 0.07) * k * em);
        img.data[o + 2] = 255 * Math.min(1, (c[2] * 0.7 + 0.16) * k * em);
        img.data[o + 3] = 240;
        hgt[i + j * MW] = y;
        for (let yy = gh + 1; yy <= gh + 5; yy++) if (vend.has(world.get(x, yy, z))) { vendAt.push([x, z]); break; }
      }
      if (j < MH) { setTimeout(slice, 0); return; }
      // light from the north-west: lit edges and a short shadow to the south-east
      for (let jj = 2; jj < MH; jj++) for (let i = 2; i < MW; i++) {
        const q = i + jj * MW, d = hgt[q] - Math.max(hgt[q - MW - 1], hgt[q - 2 * MW - 2] - 2);
        const f = d > 0 ? Math.min(1.3, 1 + d * 0.05) : Math.max(0.62, 1 + d * 0.035);
        for (let ch = 0; ch < 3; ch++) img.data[q * 4 + ch] = Math.min(255, img.data[q * 4 + ch] * f);
      }
      g.putImageData(img, 0, 0);
      // the railway viaduct (its own model, not in the voxel world): deck, ballast, two tracks
      g.save(); g.translate(TRACK.x - FINE.x0 + 0.5, TRACK.z - FINE.z0 + 0.5); g.rotate(TRACK.angle);
      g.fillStyle = 'rgba(8,4,18,0.45)'; g.fillRect(-700, -9, 1400, 24);
      g.fillStyle = '#6e6684'; g.fillRect(-700, -11, 1400, 22);
      g.fillStyle = '#3c3550'; g.fillRect(-700, -8, 1400, 16);
      g.fillStyle = '#c9c0d8'; for (const z of [-6, -2, 2, 6]) g.fillRect(-700, z, 1400, 1);
      g.restore();
      // one pin per vending machine (each is a few voxels wide)
      for (const [x, z] of vendAt) if (!vendPins.some((v) => Math.abs(v[0] - x) < 5 && Math.abs(v[1] - z) < 5)) vendPins.push([x, z]);
      mapBase = cv;
      drawMap();
    };
    slice();
  }

  // the outline of the walker and what the camera sees, for both maps
  function drawYou(g, X, Z, r) {
    const px = X(walker.pos.x), pz = Z(walker.pos.z);
    camera.getWorldDirection(dir);
    const a = Math.atan2(dir.z, dir.x), R = r * 13;
    const grd = g.createRadialGradient(px, pz, r, px, pz, R);
    grd.addColorStop(0, 'rgba(255,236,210,0.42)'); grd.addColorStop(1, 'rgba(255,236,210,0)');
    g.fillStyle = grd; g.beginPath(); g.moveTo(px, pz); g.arc(px, pz, R, a - 0.55, a + 0.55); g.closePath(); g.fill();
    g.save(); g.translate(px, pz); g.rotate(Math.atan2(Math.cos(walker.yaw), Math.sin(walker.yaw))); g.scale(r, r);
    g.shadowColor = '#ff9ac2'; g.shadowBlur = 12; g.fillStyle = '#fff'; g.strokeStyle = 'rgba(30,14,40,0.8)'; g.lineWidth = 1.2 / r * 1.6;
    g.beginPath(); g.moveTo(5.5, 0); g.lineTo(-3.5, 3.5); g.lineTo(-1.5, 0); g.lineTo(-3.5, -3.5); g.closePath(); g.fill(); g.shadowBlur = 0; g.stroke();
    g.restore();
  }
  function txt(g, s, x, y, font, col, halo = 'rgba(14,8,28,0.82)', hw = 3) {
    g.font = font; g.lineJoin = 'round'; g.lineWidth = hw; g.strokeStyle = halo; g.strokeText(s, x, y); g.fillStyle = col; g.fillText(s, x, y);
  }
  function pin(g, x, y, r, col) {
    g.fillStyle = 'rgba(14,8,28,0.75)'; g.beginPath(); g.arc(x, y, r + 1.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }

  // the corner map: short names, the place you're in picked out
  function drawMap() {
    if (!mapBase || !walker) return;
    const cv = $('#minimap'), u = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round((cv.clientWidth || 140) * u), ch = Math.round((cv.clientHeight || 195) * u);
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    const g = cv.getContext('2d'), s = cw / MW;
    const X = (x) => (x - FINE.x0) * s, Z = (z) => (z - FINE.z0) * s;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cw, ch);
    g.drawImage(mapBase, 0, 0, cw, ch);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const fs = Math.max(8, Math.min(11, cw / u / 13)) * u;
    pin(g, X(TORII.x), Z(TORII.z), 2.2 * u, '#ff5a3a');
    for (const [k, p] of Object.entries(PLACES)) {
      if (!p.at) continue;
      const here = k === placeK, [nm, x, z] = p.s || [p.jp, ...p.at];
      txt(g, nm, X(x), Z(z), `${here ? 700 : 600} ${here ? fs * 1.12 : fs}px "Hiragino Sans", "Noto Sans JP", sans-serif`,
        here ? '#ffd9a8' : found.has(k) ? 'rgba(255,240,250,0.92)' : 'rgba(255,240,250,0.55)', 'rgba(14,8,28,0.85)', 2.6 * u);
    }
    drawYou(g, X, Z, 1.6 * u);
    if (bigOpen) drawBig();
  }

  // the big map: full names, what you can do where, and a way back to places you know
  function drawBig() {
    const cv = $('#bigmap');
    if (!mapBase || !cv.width) return;
    const g = cv.getContext('2d'), u = cv.width / cv.clientWidth || 1, s = cv.width / MW;
    const X = (x) => (x - FINE.x0) * s, Z = (z) => (z - FINE.z0) * s;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(mapBase, 0, 0, cv.width, cv.height);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // Tokyo Tower is off the top of the map
    const tx = X(Math.min(FINE.x1 - 10, TOWER.x));
    g.fillStyle = 'rgba(255,150,90,0.9)'; g.beginPath(); g.moveTo(tx, 6 * u); g.lineTo(tx - 6 * u, 15 * u); g.lineTo(tx + 6 * u, 15 * u); g.closePath(); g.fill();
    txt(g, '東京タワー', tx, 26 * u, `600 ${11 * u}px "Hiragino Sans", sans-serif`, '#ffc79a', undefined, 3 * u);
    txt(g, 'TOKYO TOWER', tx, 39 * u, `600 ${8.5 * u}px "Space Grotesk", sans-serif`, 'rgba(255,220,200,0.75)', undefined, 3 * u);
    // things to do
    for (const [x, z] of vendPins) { g.fillStyle = 'rgba(14,8,28,0.8)'; g.fillRect(X(x) - 4 * u, Z(z) - 4 * u, 8 * u, 8 * u); g.fillStyle = '#7fe3ff'; g.fillRect(X(x) - 2.6 * u, Z(z) - 2.6 * u, 5.2 * u, 5.2 * u); }
    pin(g, X(TORII.x), Z(TORII.z), 4 * u, '#ff5a3a');
    txt(g, '鳥居', X(TORII.x) + 8 * u, Z(TORII.z), `600 ${10 * u}px "Hiragino Sans", sans-serif`, '#ffb4a4', undefined, 3 * u);
    g.textAlign = 'center';
    for (const [x, z, jp] of [[OFFERING.x, OFFERING.z, '参拝'], [BELL.x, BELL.z, '鐘']]) {
      pin(g, X(x), Z(z), 4 * u, '#ffc85a');
      g.textAlign = 'left'; txt(g, jp, X(x) + 8 * u, Z(z), `600 ${10 * u}px "Hiragino Sans", sans-serif`, '#ffe0a0', undefined, 3 * u); g.textAlign = 'center';
    }
    // places
    hot = [];
    for (const [k, p] of Object.entries(PLACES)) {
      if (!p.at) continue;
      const x = X(p.at[0]), y = Z(p.at[1]), on = found.has(k), here = k === placeK, hov = k === hoverK;
      if (hov && on) { g.fillStyle = 'rgba(255,200,150,0.18)'; g.beginPath(); g.arc(x, y + 4 * u, 34 * u, 0, Math.PI * 2); g.fill(); }
      const col = here ? '#ffd9a8' : on ? '#fff3fa' : 'rgba(255,240,250,0.55)';
      txt(g, p.jp, x, y - 2 * u, `700 ${(here || hov ? 17 : 15.5) * u}px "Shippori Mincho", "Hiragino Mincho ProN", serif`, col, 'rgba(14,8,28,0.85)', 4 * u);
      txt(g, (on ? p.en : '? ' + p.en).toUpperCase(), x, y + 13 * u, `600 ${8 * u}px "Space Grotesk", sans-serif`, on ? 'rgba(255,236,244,0.9)' : 'rgba(255,236,244,0.5)', 'rgba(14,8,28,0.85)', 3 * u);
      if (on) hot.push({ k, x: x / u, y: y / u });
    }
    drawYou(g, X, Z, 2.4 * u);
  }

  function sizeBig() {
    const cv = $('#bigmap'), r = cv.getBoundingClientRect(), u = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * u); cv.height = Math.round(r.height * u);
  }
  function renderList() {
    const ol = $('#mapList');
    ol.innerHTML = Object.entries(PLACES).map(([k, p]) => {
      const on = found.has(k), here = k === placeK, go = on && !here && p.go;
      const note = here ? 'You are here' : !on ? 'Not found yet' : go ? 'Go there →' : '';
      return `<li data-k="${k}" class="${on ? 'on' : ''} ${here ? 'here' : ''} ${go ? 'go' : ''}"><b>${on ? p.jp : '？'}</b><span>${on ? p.en : p.hint}</span><i>${note}</i></li>`;
    }).join('');
    $('#mapCount').textContent = `${found.size} / ${N_PLACES} found`;
  }
  function openMap() {
    if (bigOpen || !active || !walker) return;
    if (!mapBase) buildMap();
    clearTimeout(closing); closing = null;
    bigOpen = true; hoverK = null;
    const box = $('#mapBig');
    box.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    box.classList.add('show'); box.setAttribute('aria-hidden', 'false');
    void box.offsetWidth;                                // so the backdrop fades in
    document.body.classList.add('mapopen');
    renderList(); sizeBig(); drawBig();
    music.sfx('map', { open: true });
    // grow out of the corner map
    const a = $('#minimap').getBoundingClientRect(), panel = box.querySelector('.panel');
    const b = $('#bigmap').getBoundingClientRect(), pr = panel.getBoundingClientRect();
    if (a.width > 0) {
      panel.style.transformOrigin = `${b.left - pr.left}px ${b.top - pr.top}px`;
      panel.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width})`, opacity: 0.5 }, { transform: 'none', opacity: 1 }],
        { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    }
  }
  function closeMap() {
    if (!bigOpen) return;
    bigOpen = false; hoverK = null;
    const box = $('#mapBig'), panel = box.querySelector('.panel');
    box.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('mapopen');
    music.sfx('map', { open: false });
    const a = $('#minimap').getBoundingClientRect(), b = $('#bigmap').getBoundingClientRect();
    const done = () => { if (!bigOpen) box.classList.remove('show'); };
    if (a.width > 0 && active) {
      panel.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width})`, opacity: 0 }],
        { duration: 300, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' });
    }
    closing = setTimeout(() => { done(); box.getAnimations({ subtree: true }).forEach((x) => x.cancel()); }, 300);
  }
  // walk straight to a place you know: the walker is set down there and the camera flies over
  function travel(k) {
    const p = PLACES[k];
    if (!p?.go || !found.has(k) || !walker) return;
    closeMap(); closeCard();
    walker.place(p.go[0], p.go[1], groundH(Math.floor(p.go[0]), Math.floor(p.go[1])) + 1, p.go[2]);   // at street level, never on the viaduct
    frame(1.5);
    music.sfx('travel');
    shownPlace = null; placeK = null; placeT = 0;
  }
  function hotAt(e) {
    const r = $('#bigmap').getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 40;
    for (const h of hot) { const d = Math.hypot(h.x - x, (h.y + 4) - y); if (d < bd) { bd = d; best = h.k; } }
    return best;
  }
  function bindMap() {
    $('#minimap').addEventListener('click', openMap);
    $('#mapClose').addEventListener('click', closeMap);
    $('#mapBig').addEventListener('click', (e) => { if (e.target.id === 'mapBig') closeMap(); });
    const big = $('#bigmap');
    big.addEventListener('pointermove', (e) => {
      const k = hotAt(e);
      big.style.cursor = k && k !== placeK && PLACES[k].go ? 'pointer' : 'default';
      if (k !== hoverK) { hoverK = k; drawBig(); }
    });
    big.addEventListener('pointerleave', () => { if (hoverK) { hoverK = null; drawBig(); } });
    big.addEventListener('click', (e) => { const k = hotAt(e); if (k && k !== placeK) travel(k); });
    const ol = $('#mapList');
    ol.addEventListener('click', (e) => { const li = e.target.closest('li.go'); if (li) travel(li.dataset.k); });
    ol.addEventListener('pointerover', (e) => { const li = e.target.closest('li'); const k = li && found.has(li.dataset.k) ? li.dataset.k : null; if (k !== hoverK) { hoverK = k; drawBig(); } });
    ol.addEventListener('pointerleave', () => { hoverK = null; drawBig(); });
    window.addEventListener('resize', () => { if (bigOpen) { sizeBig(); drawBig(); } });
  }
  function showHere(k) {
    if (k === hereK) return;
    hereK = k;
    const el = $('#mapHere'), p = PLACES[k];
    el.innerHTML = p ? `<b>${p.jp}</b><span>${p.en}</span>` : '';
    if (bigOpen) renderList();
  }

  // ---------------------------------------------------------------- touch
  function bindTouch() {
    const base = $('#joy'), knob = $('#joy i');
    const move = (e) => {
      const r = base.getBoundingClientRect(), R = r.width / 2 - 10;
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const m = Math.hypot(dx, dy);
      if (m > R) { dx *= R / m; dy *= R / m; }
      joy.x = dx / R; joy.y = -dy / R;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { base.setPointerCapture(e.pointerId); } catch (err) { /* not an active pointer */ }
      joy.on = true; joy.id = e.pointerId; move(e);
    });
    base.addEventListener('pointermove', (e) => { if (joy.on && e.pointerId === joy.id) move(e); });
    const end = () => { joy.on = false; joy.x = joy.y = 0; knob.style.transform = ''; };
    base.addEventListener('pointerup', end); base.addEventListener('pointercancel', end); base.addEventListener('lostpointercapture', end);
    $('#btnJump').addEventListener('pointerdown', (e) => { e.preventDefault(); jumpReq = true; });
    $('#btnAct').addEventListener('pointerdown', (e) => { e.preventDefault(); act(); });
  }

  return {
    init, enter, leave, update, follow, act,
    map: { open: openMap, close: closeMap, toggle: () => (bigOpen ? closeMap() : openMap()), get isOpen() { return bigOpen; } },
    jump() { jumpReq = true; },
    get active() { return active; },
    get walker() { return walker; },
    get placed() { return !!walker?.placed; },
    // where the walker stands, for street life (cars wait, people step aside)
    player() { return walker?.placed && walker.group.visible ? walker.pos : null; },
    shareParam() { const p = walker.pos; return [p.x, p.y, p.z].map((v) => v.toFixed(1)).join(',') + ',' + walker.yaw.toFixed(2); },
    get found() { return found.size; },
  };
}
