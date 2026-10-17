import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSky, skyU, sampleTime, applyEnv, DEFAULT_TIME, TIME_KEYS, sunDirection } from './sky.js';
import { emissiveGroups } from './voxel.js';
import { buildCity } from './world.js';
import { createPetals, createPost } from './fx.js';
import { Director } from './cinematic.js';
import { createMusic } from './audio.js';
import { HERO, groundH, PAGODA, TORII, TOWER, inFine } from './build/layout.js';
import { RAIL_HALF } from './build/rail.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const V3 = (a) => new THREE.Vector3(...a);

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
const MAX_PR = Math.min(window.devicePixelRatio || 1, 2);
let pixelRatio = Math.min(MAX_PR, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.info.autoReset = false;
$('#stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.5, 12000);
camera.position.set(...HERO.pos);

scene.add(createSky());

const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -320, right: 320, top: 320, bottom: -320, near: 10, far: 2400 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.9;
sun.target.position.set(0, 0, -30);
scene.add(sun, sun.target);
// soft bounce from the violet sky behind the viewer
const fill = new THREE.DirectionalLight(0xb9a6ff, 0.4);
fill.position.set(-0.3, 0.7, 1).multiplyScalar(100);
scene.add(fill);

const post = createPost(renderer, scene, camera);
post.setSize(window.innerWidth, window.innerHeight, pixelRatio);

const petals = createPetals();
scene.add(petals.mesh);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(...HERO.target);
Object.assign(controls, {
  enableDamping: true, dampingFactor: 0.07, screenSpacePanning: true, rotateSpeed: 0.5, panSpeed: 0.9, zoomSpeed: 0.9,
  minDistance: 6, maxDistance: 1400, maxPolarAngle: Math.PI * 0.495, autoRotateSpeed: 0.35,
});
controls.update();

const music = createMusic();
const moodFor = (t) => (t < 0.19 ? 'golden' : t < 0.55 ? 'sunset' : t < 0.86 ? 'blue' : 'night');
// browsers only allow audio after a gesture: resume on the first interaction
window.addEventListener('pointerdown', () => { if (music.on) music.start(); }, { once: false, passive: true });

// ------------------------------------------------------------------- state
const state = { time: DEFAULT_TIME, mode: 'explore', timelapse: false, ui: true };
let env = sampleTime(state.time);
let city = null;
let director = null;

function setTime(t, fromUser = false) {
  state.time = t;
  env = sampleTime(t);
  applyEnv(env);
  hemi.color.copy(env.hemiSky); hemi.groundColor.copy(env.hemiGround); hemi.intensity = env.hemiInt;
  sun.color.copy(env.sunColor); sun.intensity = env.sunInt;
  const ld = sunDirection(Math.max(env.sunElev, 9));
  const np = sun.target.position.clone().addScaledVector(ld, 1000);
  if (np.distanceToSquared(sun.position) > 0.5) { sun.position.copy(np); renderer.shadowMap.needsUpdate = true; }
  fill.intensity = env.fill;
  renderer.toneMappingExposure = env.exposure;
  post.bloom.strength = state.bloomOn === false ? 0 : env.bloom * 0.8;
  petals.uniforms.uTint.value.copy(env.hemiSky).multiplyScalar(0.55).add(env.sunColor.clone().multiplyScalar(0.25 * Math.min(1, env.sunInt)));
  petals.uniforms.uEm.value = 0.08 + env.sakura * 0.4;
  // label = nearest key
  let best = TIME_KEYS[0];
  for (const k of TIME_KEYS) if (Math.abs(k.t - t) < Math.abs(best.t - t)) best = k;
  $('#timeLabel').textContent = best.name;
  music.setMood(moodFor(t));
  updateNowPlaying();
  if (!fromUser) $('#time').value = t;
}

// emissive groups: 1 lamp spill · 2 steady · 3 windows · 4-9 neon · 10 lanterns · 11 tower · 12 blink · 13 sakura · 14 train
const frac = (x) => x - Math.floor(x);
function updateGroups(t) {
  const g = emissiveGroups.value;
  g[0] = 0; g[1] = env.lamp; g[2] = 0.6 + 0.4 * env.windows; g[3] = env.windows;
  for (let i = 4; i <= 9; i++) {
    const k = Math.floor(t * 14 + i * 97.3);
    const h = frac(Math.sin(k * 12.9898 + i * 78.233) * 43758.5453);
    const phase = frac(t * 0.13 + i * 0.37);
    let f = 1;
    if (i === 9) f = h < 0.22 ? 0.12 : 1;
    else if (phase < 0.035 && h < 0.65) f = 0.15;
    g[i] = env.neon * f * (0.97 + 0.03 * Math.sin(t * 40 + i));
  }
  g[10] = env.lamp * (0.93 + 0.07 * Math.sin(t * 2.1) * Math.sin(t * 3.7));
  g[11] = env.tower * (0.96 + 0.04 * Math.sin(t * 0.8));
  // neon breathes with the kick drum while the music plays
  const p = music.pulse();
  if (p > 0) { for (let i = 4; i <= 8; i++) g[i] *= 1 + 0.16 * p; g[11] *= 1 + 0.05 * p; }
  g[12] = frac(t * 0.75) < 0.18 ? 1.4 * env.neon : 0.06;
  g[13] = env.sakura * 4.5;
  g[14] = env.windows;
}

// ------------------------------------------------------------- train & co.
const TRAIN_SPEED = 26, LOOP = RAIL_HALF * 2;
let phase1 = 0, phase2 = 400, simT = 0;
const wrap = (v) => ((v % LOOP) + LOOP) % LOOP;
const trainCtx = {
  setTrainPhase(x) { phase1 = x + RAIL_HALF - simT * TRAIN_SPEED; },
  trainFrame() {
    return {
      local: (dx, y, z) => city.rail.localToWorld(new THREE.Vector3(city.train.position.x + dx, y, z)),
    };
  },
};

// ----------------------------------------------------------------- fly-to
let fly = null;
function flyTo(pos, target, dur = 2.4) {
  fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: V3(pos), t1: V3(target), u: 0, dur };
}
const VIEWS = {
  hero: { label: 'Hero', pos: HERO.pos, target: HERO.target },
  shrine: { label: 'Shrine', pos: [TORII.x + 30, 30, TORII.z + 48], target: [TORII.x, 34, TORII.z - 10] },
  pagoda: { label: 'Pagoda', pos: [PAGODA.x + 56, 64, PAGODA.z + 52], target: [PAGODA.x, 66, PAGODA.z] },
  street: { label: 'Street', pos: [2, 28, 104], target: [0, 16, -80] },
  neon: { label: 'Neon', pos: [-2, 8, -64], target: [2, 22, -210] },
  rail: { label: 'Railway', pos: [70, 56, 46], target: [0, 32, -40] },
  tower: { label: 'Tower', pos: [TOWER.x - 70, 40, TOWER.z + 150], target: [TOWER.x, 140, TOWER.z] },
  aerial: { label: 'Aerial', pos: [-300, 320, 420], target: [20, 20, -140] },
};

// voxel DDA raycast against the fine world (double-click to focus)
function raycastVoxel(origin, dir, maxD = 1500) {
  const W = city.fine;
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
  const tdx = Math.abs(1 / dir.x), tdy = Math.abs(1 / dir.y), tdz = Math.abs(1 / dir.z);
  let tx = (sx > 0 ? x + 1 - origin.x : origin.x - x) * tdx;
  let ty = (sy > 0 ? y + 1 - origin.y : origin.y - y) * tdy;
  let tz = (sz > 0 ? z + 1 - origin.z : origin.z - z) * tdz;
  let t = 0;
  while (t < maxD) {
    if (y < 0 && sy <= 0) return origin.clone().addScaledVector(dir, (origin.y - 1) / -dir.y);
    if (y >= 0 && W.get(x, y, z)) return origin.clone().addScaledVector(dir, t);
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; }
    else { z += sz; t = tz; tz += tdz; }
  }
  return null;
}

// ------------------------------------------------------------------ UI glue
const ui = {
  onShot(s, i, n) {
    music.accent();
    $('#caption .idx').textContent = `${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`;
    $('#caption .jp').textContent = s.jp;
    $('#caption .en').textContent = s.en;
    const c = $('#caption');
    c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
  },
  setFade(a) { $('#fade').style.opacity = a.toFixed(3); },
  setProgress(p) { $('#cineprogress i').style.transform = `scaleX(${p})`; },
};

function setMode(m) {
  if (m === state.mode) return;
  state.mode = m;
  document.body.classList.toggle('cine', m === 'cinematic');
  $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  if (m === 'cinematic') {
    if (!music.on && !music.userOff) setMusic(true);
    fly = null;
    controls.enabled = false;
    director.start(0);
  } else {
    director.stop();
    ui.setFade(0);
    controls.target.copy(director.look);
    controls.enabled = true;
    camera.fov = 48; camera.updateProjectionMatrix();
    controls.update();
  }
}

function setMusic(on) {
  if (on) music.start(); else music.stop(true);
  document.body.classList.toggle('music', music.on);
  $('#btnSound').classList.toggle('on', music.on);
  if (music.on) toast(`♪ 夕焼けラジオ — ${music.mood.name}`);
  updateNowPlaying();
}
function updateNowPlaying() {
  const m = music.mood;
  $('#npMood').textContent = `${m.jp} · ${m.name} · ${m.bpm} BPM`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1800);
}

function screenshot() {
  post.composer.render();
  renderer.domElement.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `afterglow-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
  toast('Screenshot saved');
}

function toggleUI(force) {
  state.ui = force ?? !state.ui;
  document.body.classList.toggle('noui', !state.ui);
}

function bindUI() {
  $$('#modeSeg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  const views = $('#views');
  Object.entries(VIEWS).forEach(([k, v], i) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.innerHTML = `<span>${i + 1}</span>${v.label}`;
    b.addEventListener('click', () => { if (state.mode !== 'explore') setMode('explore'); flyTo(v.pos, v.target); });
    views.appendChild(b);
  });
  $('#time').addEventListener('input', (e) => { state.timelapse = false; $('#tgTimelapse').classList.remove('on'); setTime(parseFloat(e.target.value), true); });
  $$('.tick').forEach((t) => t.addEventListener('click', () => setTime(parseFloat(t.dataset.t))));
  const tog = (id, fn) => $(id).addEventListener('click', (e) => { const on = !e.currentTarget.classList.contains('on'); e.currentTarget.classList.toggle('on', on); fn(on); });
  tog('#tgPetals', (on) => { petals.mesh.visible = on; });
  tog('#tgBloom', (on) => { state.bloomOn = on; post.bloom.strength = on ? env.bloom * 0.8 : 0; });
  tog('#tgTilt', (on) => { post.tiltH.enabled = post.tiltV.enabled = on; });
  tog('#tgOrbit', (on) => { controls.autoRotate = on; });
  tog('#tgTimelapse', (on) => { state.timelapse = on; });
  $('#btnSound').addEventListener('click', () => {
    setMusic(!music.on);
  });
  $('#btnShot').addEventListener('click', screenshot);
  $('#btnFull').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()));
  $('#btnHide').addEventListener('click', () => toggleUI(false));
  $('#btnHelp').addEventListener('click', () => $('#help').classList.toggle('show'));
  $('#cinePrev').addEventListener('click', () => director.next(-1));
  $('#cineNext').addEventListener('click', () => director.next(1));
  $('#cinePause').addEventListener('click', () => { director.paused = !director.paused; $('#cinePause').textContent = director.paused ? '▶' : '❚❚'; });
  $('#cineExit').addEventListener('click', () => setMode('explore'));
  $('#unhide').addEventListener('click', () => toggleUI(true));
  $('#dockMore').addEventListener('click', () => document.body.classList.toggle('dock-open'));
  $('#vol').addEventListener('input', (e) => music.setVolume(parseFloat(e.target.value)));

  renderer.domElement.addEventListener('dblclick', (e) => {
    if (state.mode !== 'explore') return;
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, camera);
    const hit = raycastVoxel(camera.position.clone(), rc.ray.direction.clone());
    if (hit) {
      const off = camera.position.clone().sub(controls.target);
      const d = Math.min(off.length(), 120);
      flyTo(hit.clone().add(off.setLength(d)).toArray(), hit.toArray(), 1.4);
    }
  });

  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === 'c') setMode(state.mode === 'cinematic' ? 'explore' : 'cinematic');
    else if (k === 'escape') { if (state.mode === 'cinematic') setMode('explore'); else toggleUI(true); }
    else if (k === 'h') toggleUI();
    else if (k === 'p') screenshot();
    else if (k === 'f') $('#btnFull').click();
    else if (k === 'm') $('#btnSound').click();
    else if (k === 't') {
      const i = TIME_KEYS.findIndex((x) => Math.abs(x.t - state.time) < 0.02);
      setTime(TIME_KEYS[(i + 1) % TIME_KEYS.length].t);
    } else if (k === ' ' && state.mode === 'cinematic') { e.preventDefault(); $('#cinePause').click(); }
    else if (k === 'arrowright' && state.mode === 'cinematic') director.next(1);
    else if (k === 'arrowleft' && state.mode === 'cinematic') director.next(-1);
    else if (k === '`') $('#stats').classList.toggle('show');
    else if (/^[1-8]$/.test(k)) { const v = Object.values(VIEWS)[+k - 1]; if (state.mode !== 'explore') setMode('explore'); flyTo(v.pos, v.target); }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  return keys;
}

// --------------------------------------------------------------- resizing
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h);
  post.setSize(w, h, pixelRatio);
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- the loop
const clock = new THREE.Clock();
let keys = new Set();
let frameAcc = 0, frameN = 0, goodTime = 0, statT = 0;
const tmpF = new THREE.Vector3(), tmpR = new THREE.Vector3(), tmpT = new THREE.Vector3();
const bandsBuf = new Float32Array(5);
const eqBars = $$('#nowplaying .eq i');

function loop() {
  const dt = Math.min(clock.getDelta(), 0.1);
  simT += dt;
  const t = simT;
  skyU.uTime.value = t;
  post.grade.uniforms.uTime.value = t;

  if (state.timelapse) {
    let nt = state.time + dt * 0.012;
    if (nt > 1) nt = 0;
    setTime(nt);
  }
  updateGroups(t);

  // trains
  if (city) {
    city.train.position.x = wrap(phase1 + t * TRAIN_SPEED) - RAIL_HALF;
    city.train2.position.x = RAIL_HALF - wrap(phase2 + t * TRAIN_SPEED * 0.82);
    for (const c of city.clouds) {
      let x = c.x0 + t * c.drift;
      x = ((x + 3400) % 6800 + 6800) % 6800 - 3400;
      c.group.position.x = x;
    }
  }

  // camera
  if (state.mode === 'cinematic' && director) director.update(dt);
  else {
    if (fly) {
      fly.u = Math.min(1, fly.u + dt / fly.dur);
      const e = fly.u < 0.5 ? 4 * fly.u ** 3 : 1 - Math.pow(-2 * fly.u + 2, 3) / 2;
      camera.position.lerpVectors(fly.p0, fly.p1, e);
      camera.position.y += Math.sin(Math.PI * e) * Math.min(60, fly.p0.distanceTo(fly.p1) * 0.12);
      controls.target.lerpVectors(fly.t0, fly.t1, e);
      if (fly.u >= 1) fly = null;
    }
    // WASD / QE flying
    if (keys.size) {
      const sp = (keys.has('shift') ? 160 : 60) * dt;
      camera.getWorldDirection(tmpF); tmpF.y = 0; tmpF.normalize();
      tmpR.crossVectors(tmpF, camera.up).normalize();
      const mv = new THREE.Vector3();
      if (keys.has('w')) mv.add(tmpF); if (keys.has('s')) mv.sub(tmpF);
      if (keys.has('d')) mv.add(tmpR); if (keys.has('a')) mv.sub(tmpR);
      if (keys.has('e')) mv.y += 1; if (keys.has('q')) mv.y -= 1;
      if (mv.lengthSq()) { mv.normalize().multiplyScalar(sp); camera.position.add(mv); controls.target.add(mv); fly = null; }
    }
    controls.update();
    const gx = camera.position.x, gz = camera.position.z;
    const floor = (inFine(gx, gz) ? groundH(Math.floor(gx), Math.floor(gz)) + 1 : 1) + 2.5;
    if (camera.position.y < floor) camera.position.y = floor;
  }

  // train rumble: nearest train, panned to where it is on screen
  if (city && music.on) {
    let best = 1e9, pan = 0;
    for (const [tr, dx, z] of [[city.train, 77, 4], [city.train2, -77, -3]]) {
      const w = city.rail.localToWorld(tmpT.set(tr.position.x + dx, 34, z));
      const d = w.distanceTo(camera.position);
      if (d < best) { best = d; camera.getWorldDirection(tmpF); tmpR.crossVectors(tmpF, camera.up).normalize(); pan = w.sub(camera.position).normalize().dot(tmpR); }
    }
    const lvl = Math.max(0, 1 - best / 240);
    music.setTrain(lvl * lvl, pan);
  }
  if (music.on && state.ui) {
    music.bands(bandsBuf);
    eqBars.forEach((b, i) => { b.style.transform = `scaleY(${Math.min(1, 0.12 + bandsBuf[i] * 0.95).toFixed(3)})`; });
  }
  petals.uniforms.uTime.value = t;
  petals.uniforms.uCam.value.copy(camera.position);
  // keep the sky dome centred on the camera
  scene.children[0].position.copy(camera.position);

  renderer.info.reset();
  post.composer.render();

  // adaptive resolution + stats
  frameAcc += dt; frameN++;
  if (frameAcc > 1.0) {
    const ms = (frameAcc / frameN) * 1000;
    if (ms > 30 && pixelRatio > 0.7) { pixelRatio = Math.max(0.7, pixelRatio - 0.2); resize(); goodTime = 0; }
    else if (ms < 17) { goodTime += frameAcc; if (goodTime > 6 && pixelRatio < Math.min(MAX_PR, 1.5)) { pixelRatio = Math.min(MAX_PR, 1.5, pixelRatio + 0.15); resize(); goodTime = 0; } }
    statT = ms;
    const info = renderer.info.render;
    $('#stats').textContent = `${(1000 / ms).toFixed(0)} fps · ${ms.toFixed(1)} ms · pr ${pixelRatio.toFixed(2)} · ${info.calls} calls · ${(info.triangles / 1e6).toFixed(2)}M tris${city ? ` · built in ${city.stats.ms} ms` : ''}`;
    frameAcc = 0; frameN = 0;
  }
}

// ------------------------------------------------------------------ boot
async function boot() {
  setTime(DEFAULT_TIME);
  keys = bindUI();
  renderer.setAnimationLoop(loop);
  city = await buildCity(scene, (p, label) => {
    $('#loader .bar i').style.transform = `scaleX(${p})`;
    $('#loader .stage').textContent = label;
  });
  director = new Director(camera, ui, trainCtx);
  console.info('[afterglow] built', city.stats);
  renderer.shadowMap.needsUpdate = true;
  document.body.classList.add('ready');
  setTimeout(() => $('#loader').remove(), 1600);
  // opening move: drift down from the clouds onto the hero view
  camera.position.set(-90, 260, 460);
  controls.target.set(40, 120, -500);
  flyTo(HERO.pos, HERO.target, 5.5);
  setTimeout(() => $('#help').classList.add('show'), 1500);
  setTimeout(() => $('#help').classList.remove('show'), 11000);
  setTimeout(() => { if (!music.on) toast('♪ Press M for the Afterglow FM soundtrack'); }, 6500);
  const q = new URLSearchParams(location.search);
  if (q.has('cine')) setMode('cinematic');
  if (q.has('t')) setTime(parseFloat(q.get('t')));
  if (q.has('view') && VIEWS[q.get('view')]) { fly = null; const v = VIEWS[q.get('view')]; camera.position.set(...v.pos); controls.target.set(...v.target); }
  if (q.has('noui')) toggleUI(false);
  // Offscreen capture at a fixed resolution (dev aid; POSTs to the dev server if present).
  const capture = async (name = 'shot', w = 1600, h = 900) => {
    const prevPR = pixelRatio;
    renderer.setPixelRatio(1); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    post.setSize(w, h, 1);
    renderer.shadowMap.needsUpdate = true;
    post.composer.render(); post.composer.render();
    const blob = await new Promise((r) => { post.composer.render(); renderer.domElement.toBlob(r, 'image/png'); });
    pixelRatio = prevPR; resize();
    await fetch('/__shot?name=' + name, { method: 'POST', body: blob });
    return blob.size;
  };
  window.__afterglow = { camera, controls, setTime, setMode, flyTo, city, director, scene, renderer, VIEWS, capture, post, petals, music, get env() { return env; } };
}
boot();
