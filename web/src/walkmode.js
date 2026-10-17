import * as THREE from 'three';
import { createWalker } from './walker.js';
import { FINE, PAGODA, TORII, SHRINE, STAIRS, MAIN_HALF, DISTRICT_Z, SLOPE, trackDist, groundH, inFine } from './build/layout.js';

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

export const PLACES = {
  sando: { jp: '参道', en: 'The shrine approach' },
  hall: { jp: '拝殿', en: 'The shrine hall' },
  pagoda: { jp: '五重塔', en: 'Pagoda hill' },
  street: { jp: '商店街', en: 'The old shopping street' },
  slope: { jp: '夕焼け坂', en: 'Sunset slope' },
  tracks: { jp: '高架下', en: 'Under the tracks' },
  district: { jp: '繁華街', en: 'The neon district' },
  lanes: { jp: '下町', en: 'Old town lanes' },
  roofs: { jp: '屋根の上', en: 'On the rooftops' },
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
    aimBehind();
    // fly to a spot behind the walker that is clear of walls
    const f = walker.focus(new THREE.Vector3());
    const free = Math.max(1.5, clearance(f, want, camDist) - 0.4);
    effDist = Math.min(camDist, free);
    const p = f.clone().addScaledVector(want, effDist);
    ctx.flyTo(p.toArray(), f.toArray(), at ? 0.01 : 1.9);
    shownPlace = null; placeT = 0; placeK = null;
    if (!mapBase) setTimeout(buildMap, 400);   // after the fly-in has started
    $('#walkKeys').classList.add('show');
    clearTimeout(keysTimer); keysTimer = setTimeout(() => $('#walkKeys').classList.remove('show'), 9000);
    return true;
  }
  function leave() {
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
    if (pk !== placeK) { placeK = pk; placeT = 0; } else placeT += dt;
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
  }

  // ----------------------------------------------------------------- map
  const MS = 2;  // world units per map pixel
  // built in small slices (a few ms each) so entering walk mode never stutters;
  // each column scan starts at the top of its tallest voxel chunk
  let mapBuilding = false;
  function buildMap() {
    if (mapBuilding) return;
    mapBuilding = true;
    const W = Math.floor((FINE.x1 - FINE.x0) / MS) + 1, Hh = Math.floor((FINE.z1 - FINE.z0) / MS) + 1;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    const g = cv.getContext('2d'), img = g.createImageData(W, Hh), P = city.palette, world = city.fine;
    const tops = new Map();
    for (const c of world.chunks.values()) {
      if (c.y1 < 0) continue;
      const k = c.cx + ',' + c.cz, top = c.cy * 64 + c.y1;
      if (!(tops.get(k) >= top)) tops.set(k, top);
    }
    let j = 0;
    const slice = () => {
      const t0 = performance.now();
      for (; j < Hh && performance.now() - t0 < 5; j++) for (let i = 0; i < W; i++) {
        const x = FINE.x0 + i * MS, z = FINE.z0 + j * MS;
        let y = tops.get((x >> 6) + ',' + (z >> 6)) ?? 0;
        while (y > 0 && !world.get(x, y, z)) y--;
        const e = P.list[world.get(x, y, z)];
        const hgt = y - groundH(x, z);
        const k = hgt > 2 ? 0.62 + Math.min(0.55, hgt / 70) : 0.4;
        const c = e ? e.s : [0.2, 0.2, 0.3], em = e && e.em >= 1 ? 1.5 : 1;
        const o = (i + j * W) * 4;
        img.data[o] = 255 * Math.min(1, (c[0] * 0.75 + 0.1) * k * em);
        img.data[o + 1] = 255 * Math.min(1, (c[1] * 0.7 + 0.07) * k * em);
        img.data[o + 2] = 255 * Math.min(1, (c[2] * 0.7 + 0.16) * k * em);
        img.data[o + 3] = 235;
      }
      if (j < Hh) { setTimeout(slice, 0); return; }
      g.putImageData(img, 0, 0);
      mapBase = cv;
      drawMap();
    };
    slice();
  }
  function drawMap() {
    if (!mapBase || !walker) return;
    const cv = $('#minimap'), g = cv.getContext('2d');
    if (cv.width !== mapBase.width * 2) { cv.width = mapBase.width * 2; cv.height = mapBase.height * 2; }
    const s = cv.width / (mapBase.width * MS);
    const X = (x) => (x - FINE.x0) * s, Z = (z) => (z - FINE.z0) * s;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(mapBase, 0, 0, cv.width, cv.height);
    const dot = (x, z, col, r = 5) => { g.fillStyle = col; g.beginPath(); g.arc(X(x), Z(z), r, 0, Math.PI * 2); g.fill(); };
    g.font = '600 20px "Hiragino Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const label = (x, z, txt, col) => { g.fillStyle = 'rgba(10,6,20,0.55)'; g.fillText(txt, X(x) + 1, Z(z) + 1); g.fillStyle = col; g.fillText(txt, X(x), Z(z)); };
    dot(TORII.x, TORII.z, '#ff5a3a'); label(TORII.x, TORII.z - 12, '鳥居', '#ffb0a0');
    label(PAGODA.x, PAGODA.z, '塔', '#ffe0a0');
    label(OFFERING.x - 10, OFFERING.z, '社', '#ffe0a0');
    label(0, -140, '繁華街', '#ffc0f0');
    const px = X(walker.pos.x), pz = Z(walker.pos.z);
    // what the camera sees
    camera.getWorldDirection(dir);
    const a = Math.atan2(dir.z, dir.x);
    const grd = g.createRadialGradient(px, pz, 4, px, pz, 70);
    grd.addColorStop(0, 'rgba(255,236,210,0.38)'); grd.addColorStop(1, 'rgba(255,236,210,0)');
    g.fillStyle = grd; g.beginPath(); g.moveTo(px, pz); g.arc(px, pz, 70, a - 0.55, a + 0.55); g.closePath(); g.fill();
    // the walker
    g.save(); g.translate(px, pz); g.rotate(Math.atan2(Math.cos(walker.yaw), Math.sin(walker.yaw)));
    g.shadowColor = '#ff9ac2'; g.shadowBlur = 12; g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(11, 0); g.lineTo(-7, 7); g.lineTo(-3, 0); g.lineTo(-7, -7); g.closePath(); g.fill();
    g.restore();
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
    base.addEventListener('pointerup', end); base.addEventListener('pointercancel', end);
    $('#btnJump').addEventListener('pointerdown', (e) => { e.preventDefault(); jumpReq = true; });
    $('#btnAct').addEventListener('pointerdown', (e) => { e.preventDefault(); act(); });
  }

  return {
    init, enter, leave, update, follow, act,
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
