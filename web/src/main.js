import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSky, skyU, sampleTime, applyEnv, DEFAULT_TIME, TIME_KEYS, sunDirection } from './sky.js';
import { emissiveGroups } from './voxel.js';
import { buildCity } from './world.js';
import { createPetals, createPost, createRain, FLAKE_MODES } from './fx.js';
import { createAtmos, SEASONS, WEATHERS } from './atmos.js';
import { createHanabi, SHAPES, SKY_PALETTES, planMessage } from './hanabi.js';
import { createLanterns } from './lanterns.js';
import { createLife } from './life.js';
import { setCustomSign, SIGN_COLORS } from './sign.js';
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
const rain = createRain();
scene.add(rain.mesh);
const atmos = createAtmos({ renderer, scene, flakes: petals, rain });
atmos.setSize(window.innerWidth * pixelRatio, window.innerHeight * pixelRatio);
const hanabi = createHanabi();
hanabi.setViewer(camera);
scene.add(hanabi.points);
const lanterns = createLanterns({ groundAt: (x, z) => (inFine(x, z) ? groundH(Math.floor(x), Math.floor(z)) : 0) });
scene.add(lanterns.mesh);
let life = null;

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(...HERO.target);
Object.assign(controls, {
  enableDamping: true, dampingFactor: 0.07, screenSpacePanning: true, rotateSpeed: 0.5, panSpeed: 0.9, zoomSpeed: 0.9,
  minDistance: 6, maxDistance: 1400, maxPolarAngle: Math.PI * 0.6, autoRotateSpeed: 0.35,
});
controls.update();

const music = createMusic();
const moodFor = (t) => (t < 0.19 ? 'golden' : t < 0.55 ? 'sunset' : t < 0.86 ? 'blue' : 'night');
// Browsers only allow audio after a gesture: the first interaction unlocks it
// and the city sound (環境音) starts, unless it was muted on a previous visit.
const store = {
  get(k) { try { return localStorage.getItem('afterglow.' + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('afterglow.' + k, v); } catch (e) { /* private mode */ } },
};
if (store.get('amb') === 'off') music.stopAmbience(true);
let unlocked = false;
function unlockAudio() {
  if (unlocked) { if (music.on) music.start(); return; }
  unlocked = true;
  music.unlock();
  syncSoundButtons();
  if (music.ambOn && !store.get('ambHint')) { store.set('ambHint', '1'); setTimeout(() => toast('環境音 · City sound on — N mutes it, M adds music'), 400); }
}
window.addEventListener('pointerdown', unlockAudio, { passive: true });
window.addEventListener('keydown', unlockAudio);

// ------------------------------------------------------------------- state
const state = { time: DEFAULT_TIME, mode: 'explore', timelapse: false, ui: true, hanabi: false, ink: false, life: true, sign: null, lanterns: false };
const tmpCol = new THREE.Color(), flashCol = new THREE.Color();
let env = sampleTime(state.time);
let city = null;
let director = null;

function setTime(t, fromUser = false) {
  state.time = t;
  env = atmos.modifyEnv(sampleTime(t));
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
  petals.uniforms.uEm.value = 0.08 + env.sakura * 0.4 + (atmos.flakeMode === 'snow' ? 0.12 + env.lamp * 0.08 : 0);
  rain.uniforms.uTint.value.copy(env.hemiSky).multiplyScalar(0.45).add(tmpCol.setRGB(0.32, 0.26, 0.4).multiplyScalar(env.lamp * 0.5));
  lanterns.setAmbient(tmpCol.copy(env.hemiSky).multiplyScalar(env.hemiInt * 0.5).add(env.sunColor.clone().multiplyScalar(0.3 * Math.min(1, env.sunInt))));
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
  timeToNextBar: () => music.timeToNextBar(),
  barLength: () => music.barLength,
  pulse: () => music.pulse(),
  hanabiOn: () => state.hanabi,
  salvo: () => { for (let i = 0; i < 4; i++) setTimeout(() => hanabi.launch(simT), i * 450); },
  lanternsOn: () => state.lanterns,
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
  neon: { label: 'Neon', pos: [0, 8.5, -66], target: [-1, 14, -190] }, // centre line, clear of bus roofs
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
  unlocked = true;
  if (on) music.start(); else music.stop(true);
  syncSoundButtons();
  if (music.on) toast(`♪ 夕焼けラジオ — ${music.mood.name}`);
  updateNowPlaying();
}
// city sound: wind, rain, trains, fireworks, crowds, insects, bells
function setAmbience(on) {
  unlocked = true;
  if (on) music.startAmbience(); else music.stopAmbience(true);
  store.set('amb', on ? 'on' : 'off');
  syncSoundButtons();
  toast(on ? '環境音 · City sound on' : '環境音 · City sound muted');
}
function syncSoundButtons() {
  document.body.classList.toggle('music', music.on);
  $('#btnSound').classList.toggle('on', music.on);
  $('#btnAmb').classList.toggle('on', music.ambOn);
  $('#btnAmb').classList.toggle('muted', !music.ambOn);
}
function updateNowPlaying() {
  const m = music.mood;
  $('#npMood').textContent = music.fileMode ? `Your track · ${m.name}` : `${m.jp} · ${m.name} · ${m.bpm} BPM`;
}

// ------------------------------------------------------- seasons & weather
function setSeason(name, quiet = false) {
  if (!SEASONS[name]) return;
  atmos.setSeason(name);
  $$('#seasonSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === name));
  if (name === 'summer' && !state.hanabi) setHanabi(true, true);
  if (!quiet) toast(`${SEASONS[name].jp} · ${SEASONS[name].name}`);
  setTime(state.time);
}
function setWeather(name, quiet = false) {
  if (!WEATHERS[name]) return;
  atmos.setWeather(name);
  $$('#weatherSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === name));
  if (!quiet) toast(`${WEATHERS[name].jp} · ${WEATHERS[name].name}${name === 'rain' && state.time < 0.55 ? ' — try it at night' : ''}`);
}
function setHanabi(on, quiet = false) {
  state.hanabi = on;
  hanabi.enabled = on;
  $('#tgHanabi').classList.toggle('on', on);
  if (on && !quiet) toast(state.time < 0.5 ? '花火 · Fireworks — best after sunset' : '花火 · Fireworks');
}
function setInk(on) {
  state.ink = on;
  post.ink.enabled = on;
  $('#tgInk').classList.toggle('on', on);
  post.grade.uniforms.uSat.value = on ? 1.32 : 1.24;
  post.grade.uniforms.uGrain.value = on ? 0.022 : 0.035;
}
function setLanterns(on, quiet = false) {
  state.lanterns = on;
  lanterns.releasing = on;
  if (on && lanterns.count < 12) lanterns.release(10);
  $('#tgLantern').classList.toggle('on', on);
  if (on && !quiet) toast(state.time < 0.5 ? '灯籠 · Sky lanterns — they glow best after dusk' : '灯籠 · Sky lanterns');
}
// 祭 Matsuri: a summer festival night in one press. Pressing it again ends
// the festival and puts the scene back the way it was.
let finaleTimer = 0;
function festival(on = !state.matsuri) {
  if (on === !!state.matsuri) return;
  if (on) {
    state.matsuri = {
      season: atmos.season, weather: atmos.weather, time: state.time, hanabi: state.hanabi,
      lanterns: state.lanterns, life: state.life, music: music.on,
    };
    if (state.mode !== 'explore') setMode('explore');
    setSeason('summer', true);
    setWeather('clear', true);
    setTime(0.92);
    setHanabi(true, true);
    setLife(true);
    setLanterns(true, true);
    lanterns.release(40);
    if (!music.on) setMusic(true);
    flyTo(HERO.pos, HERO.target, 2.6);
    clearTimeout(finaleTimer);
    finaleTimer = setTimeout(() => { if (state.matsuri) hanabi.finale(simT); }, 5000);
    toast('祭 · Matsuri — a summer festival night (press again to end it)');
  } else {
    const prev = state.matsuri;
    state.matsuri = null;
    clearTimeout(finaleTimer);
    hanabi.cancelQueued();
    setSeason(prev.season, true);
    setWeather(prev.weather, true);
    setTime(prev.time);
    setHanabi(prev.hanabi, true);
    setLanterns(prev.lanterns, true); // lanterns already aloft drift away on their own
    setLife(prev.life);
    if (!prev.music && music.on) setMusic(false);
    toast('祭 · The festival is over');
  }
  $('#btnMatsuri').classList.toggle('on', !!state.matsuri);
}
// 空文字 sky-writing
function skyWrite(text, palette = 'rainbow', repeat = false) {
  const n = hanabi.write(simT, text, { palette });
  if (!n) return;
  if (repeat) { hanabi.setMessage({ text, palette }, simT, 20 + n * 5); if (!state.hanabi) setHanabi(true, true); }
  else hanabi.setMessage(null);
  state.sky = repeat ? { text, palette } : null;
  toast(state.time < 0.45 ? '空文字 · Look up — it reads best after dusk' : n > 1 ? `空文字 · ${n} shells, one after another` : '空文字 · Look up');
}
function setLife(on) {
  state.life = on;
  if (life) life.group.visible = on;
  $('#tgLife').classList.toggle('on', on);
}
function updateFlakeLabel() {
  const m = atmos.flakeMode;
  $('#tgPetals').textContent = m ? FLAKE_MODES[m].label : 'Particles';
}

// ------------------------------------------------------------ custom sign
async function applySign(opts, fly = true) {
  if (!city) return;
  state.sign = await setCustomSign(city, opts);
  $('#btnSign').classList.toggle('on', !!state.sign);
  if (state.sign && fly) { if (state.mode !== 'explore') setMode('explore'); flyTo([3, 23, 18], [0, 27, -40], 2.2); }
}

// --------------------------------------------------------------- recording
let rec = null;
function toggleRecord(film = false) {
  if (rec) { rec.stop(); return; }
  if (!window.MediaRecorder) { toast('Recording is not supported in this browser'); return; }
  const stream = renderer.domElement.captureStream(60);
  if (music.audible) music.stream().getAudioTracks().forEach((t) => stream.addTrack(t));
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
  const chunks = [];
  rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 14e6 });
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `afterglow-${Date.now()}.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    rec = null; recStart = 0;
    document.body.classList.remove('rec');
    $('#btnRec').classList.remove('on');
    director.onLoop = null;
    toast('Clip saved');
  };
  rec.start(500);
  recStart = performance.now();
  document.body.classList.add('rec');
  $('#btnRec').classList.add('on');
  if (film) {
    setMode('explore'); setMode('cinematic');
    director.onLoop = () => rec?.stop();
    toast('● Recording the film — it stops at the end');
  } else toast('● Recording — press R to stop');
}
let recStart = 0;

// ------------------------------------------------------------------ share
function shareURL() {
  const q = new URLSearchParams();
  const tg = state.mode === 'cinematic' ? director.look : controls.target;
  q.set('cam', [...camera.position.toArray(), ...tg.toArray()].map((v) => v.toFixed(1)).join(','));
  q.set('t', state.time.toFixed(3));
  if (atmos.season !== 'spring') q.set('season', atmos.season);
  if (atmos.weather !== 'clear') q.set('weather', atmos.weather);
  if (state.ink) q.set('style', 'ink');
  if (state.hanabi && atmos.season !== 'summer') q.set('hanabi', '1');
  if (!state.life) q.set('life', '0');
  if (state.lanterns) q.set('lanterns', '1');
  if (state.sky) { q.set('sky', state.sky.text); if (state.sky.palette !== 'rainbow') q.set('skyp', state.sky.palette); }
  if (state.sign) { q.set('sign', state.sign.text); q.set('signc', state.sign.color); if (state.sign.style !== 'neon') q.set('signs', state.sign.style); }
  return `${location.origin}${location.pathname}?${q}`;
}
async function share() {
  const url = shareURL();
  history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); toast('Link copied — it reopens this exact scene'); }
  catch (e) { toast('Link is in the address bar'); }
}

// 4K postcard (offscreen render at a fixed size)
async function renderAt(w, h) {
  const prevPR = pixelRatio;
  renderer.setPixelRatio(1); renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  post.setSize(w, h, 1);
  atmos.setSize(w, h);
  renderer.shadowMap.needsUpdate = true;
  atmos.renderReflection(camera);
  post.composer.render(); post.composer.render();
  const blob = await new Promise((r) => { post.composer.render(); renderer.domElement.toBlob(r, 'image/png'); });
  pixelRatio = prevPR; resize();
  return blob;
}
async function postcard() {
  toast('Rendering a 4K postcard…');
  await new Promise((r) => setTimeout(r, 50));
  const blob = await renderAt(3840, 2160);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `afterglow-4k-${Date.now()}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('4K postcard saved');
}

async function playTrack(file) {
  if (!file || !/^audio\//.test(file.type)) { toast('Drop an audio file (mp3, wav, m4a…)'); return; }
  try {
    await music.playFile(file);
    document.body.classList.add('music');
    $('#btnSound').classList.add('on');
    updateNowPlaying();
    toast(`♪ ${music.mood.name} — the city is listening`);
  } catch (e) { console.error(e); toast('Could not decode that file'); }
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1800);
}

function screenshot(e) {
  if (e?.shiftKey) { postcard(); return; }
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
  tog('#tgPetals', (on) => { atmos.flakesOn = on; });
  tog('#tgBloom', (on) => { state.bloomOn = on; post.bloom.strength = on ? env.bloom * 0.8 : 0; });
  tog('#tgTilt', (on) => { post.tiltH.enabled = post.tiltV.enabled = on; });
  tog('#tgOrbit', (on) => { controls.autoRotate = on; });
  tog('#tgTimelapse', (on) => { state.timelapse = on; });
  $('#btnSound').addEventListener('click', () => {
    setMusic(!music.on);
  });
  $('#btnAmb').addEventListener('click', () => setAmbience(!music.ambOn));
  $('#ambVol').addEventListener('input', (e) => music.setAmbVolume(parseFloat(e.target.value)));
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
  $$('#seasonSeg button').forEach((b) => b.addEventListener('click', () => setSeason(b.dataset.v)));
  $$('#weatherSeg button').forEach((b) => b.addEventListener('click', () => setWeather(b.dataset.v)));
  $('#tgHanabi').addEventListener('click', () => setHanabi(!state.hanabi));
  $('#tgInk').addEventListener('click', () => setInk(!state.ink));
  $('#tgLife').addEventListener('click', () => setLife(!state.life));
  $('#tgLantern').addEventListener('click', () => setLanterns(!state.lanterns));
  $('#btnMatsuri').addEventListener('click', () => festival());
  // sky-writing dialog
  let skyPal = 'rainbow';
  const sp = $('#skyPal');
  const PAL_SW = { rainbow: 'conic-gradient(#ff4f8a, #ffd24a, #62ff9a, #5ad8ff, #b46aff, #ff4f8a)', gold: '#ffc860', sakura: 'linear-gradient(135deg,#ff7ab8,#ffe4f2)', neon: 'linear-gradient(90deg,#ff2fd0 50%,#3ff0ff 50%)', confetti: 'conic-gradient(#ffd24a 0 33%,#ff4f8a 0 66%,#5ad8ff 0)' };
  Object.keys(SKY_PALETTES).forEach((k) => {
    const b = document.createElement('button');
    b.className = 'sw' + (k === skyPal ? ' on' : ''); b.title = k;
    b.style.setProperty('--c', PAL_SW[k]); b.style.background = PAL_SW[k];
    b.addEventListener('click', () => { skyPal = k; $$('#skyPal .sw').forEach((x) => x.classList.toggle('on', x === b)); });
    sp.appendChild(b);
  });
  const SHAPE_ICON = { heart: '♥', star: '★', smile: '☺', sakura: '✿', butterfly: '🦋' };
  SHAPES.forEach((name) => {
    const b = document.createElement('button');
    b.textContent = SHAPE_ICON[name]; b.title = name;
    b.addEventListener('click', () => { hanabi.shape(simT, name, { palette: skyPal }); });
    $('#skyShapes').appendChild(b);
  });
  const closeSky = () => $('#skyDlg').classList.remove('show');
  const openSky = () => { $('#signDlg').classList.remove('show'); $('#skyDlg').classList.toggle('show'); if ($('#skyDlg').classList.contains('show')) $('#skyText').focus(); };
  const updateSkyHint = () => {
    const parts = planMessage($('#skyText').value || '');
    $('#skyHint').textContent = parts.length > 1 ? `${parts.length} shells: ${parts.join(' · ')}` : '';
  };
  $('#skyText').addEventListener('input', updateSkyHint);
  $('#btnSky').addEventListener('click', openSky);
  $('#skyLaunch').addEventListener('click', () => { skyWrite($('#skyText').value || '夕焼け', skyPal, $('#skyRepeat').checked); closeSky(); });
  $('#skyFinale').addEventListener('click', () => { hanabi.finale(simT); closeSky(); toast('スターマイン · Grand finale'); });
  $('#skyText').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#skyLaunch').click(); if (e.key === 'Escape') closeSky(); });
  // tap the sky to launch a shell there (while the fireworks are on)
  let down = null, tapTimer = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || !state.hanabi || !city || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), held = performance.now() - down.t;
    down = null;
    if (moved > 6 || held > 350) return;
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, camera);
    const dir = rc.ray.direction.clone();
    if (dir.y < 0.03 || raycastVoxel(camera.position.clone(), dir, 700)) return;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => hanabi.launchToward(simT, dir), 260); // a double-click cancels it
  });
  renderer.domElement.addEventListener('dblclick', () => clearTimeout(tapTimer));
  $('#btnRec').addEventListener('click', (e) => toggleRecord(e.shiftKey));
  $('#recPill').addEventListener('click', () => toggleRecord());
  $('#btnShare').addEventListener('click', share);
  $('#btnTrack').addEventListener('click', () => $('#trackFile').click());
  $('#trackFile').addEventListener('change', (e) => playTrack(e.target.files[0]));
  window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drop'); });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drop'); });
  window.addEventListener('drop', (e) => { e.preventDefault(); document.body.classList.remove('drop'); playTrack(e.dataTransfer.files[0]); });
  // sign dialog
  let signColor = 'pink', signStyle = 'neon';
  const sc = $('#signColors');
  SIGN_COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'sw' + (c === signColor ? ' on' : ''); b.dataset.c = c; b.title = c;
    b.style.setProperty('--c', getComputedStyle(document.documentElement).getPropertyValue('--n-' + c) || c);
    b.addEventListener('click', () => { signColor = c; $$('#signColors .sw').forEach((x) => x.classList.toggle('on', x === b)); });
    sc.appendChild(b);
  });
  $$('#signStyle button').forEach((b) => b.addEventListener('click', () => { signStyle = b.dataset.v; $$('#signStyle button').forEach((x) => x.classList.toggle('on', x === b)); }));
  const closeSign = () => $('#signDlg').classList.remove('show');
  $('#btnSign').addEventListener('click', () => { $('#skyDlg').classList.remove('show'); $('#signDlg').classList.toggle('show'); if ($('#signDlg').classList.contains('show')) $('#signText').focus(); });
  $('#signApply').addEventListener('click', async () => { closeSign(); await applySign({ text: $('#signText').value || '夕焼け TOKYO', color: signColor, style: signStyle }); });
  $('#signRemove').addEventListener('click', () => { closeSign(); applySign(null); });
  $('#signText').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#signApply').click(); if (e.key === 'Escape') closeSign(); });

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
    else if (k === 'p') screenshot(e);
    else if (k === 'r') toggleRecord(e.shiftKey);
    else if (k === 'b') setHanabi(!state.hanabi);
    else if (k === 'i') setInk(!state.ink);
    else if (k === 'l') setLife(!state.life);
    else if (k === 'k') setLanterns(!state.lanterns);
    else if (k === 'n') setAmbience(!music.ambOn);
    else if (k === 'y') { e.preventDefault(); $('#btnSky').click(); }
    else if (k === 'g') { hanabi.finale(simT); toast('スターマイン · Grand finale'); }
    else if (k === 'z') { const ks = Object.keys(SEASONS); setSeason(ks[(ks.indexOf(atmos.season) + 1) % ks.length]); }
    else if (k === 'x') { const ks = Object.keys(WEATHERS); setWeather(ks[(ks.indexOf(atmos.weather) + 1) % ks.length]); }
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
  atmos.setSize(w * pixelRatio, h * pixelRatio);
  hanabi.setPixelRatio(pixelRatio);
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- the loop
const clock = new THREE.Clock();
let keys = new Set();
let frameAcc = 0, frameN = 0, goodTime = 0, statT = 0;
const tmpF = new THREE.Vector3(), tmpR = new THREE.Vector3(), tmpT = new THREE.Vector3();
const bandsBuf = new Float32Array(5);
const eqBars = $$('#nowplaying .eq i');

let forcedDt = null, adapt = 0, sceneSoundT = 1;
function loop() {
  const real = clock.getDelta();
  const dt = forcedDt ?? Math.min(real, 0.1);
  simT += dt;
  const t = simT;
  skyU.uTime.value = t;
  post.grade.uniforms.uTime.value = t;

  if (state.timelapse) {
    let nt = state.time + dt * 0.012;
    if (nt > 1) nt = 0;
    setTime(nt);
  }
  // seasons / weather easing (re-derives the environment while it moves)
  const prevFlake = atmos.flakeMode;
  if (atmos.update(dt, env, state.time)) {
    setTime(state.time);
    music.setWeather(atmos.st.rainK, atmos.st.snowK);
  }
  if (prevFlake !== atmos.flakeMode) { updateFlakeLabel(); setTime(state.time); }
  updateGroups(t);
  // fireworks light the sky a little
  hanabi.update(t, flashCol);
  const fl = Math.min(1.5, flashCol.r + flashCol.g + flashCol.b);
  hemi.intensity = env.hemiInt + fl * 0.35;
  if (fl > 0.001) hemi.color.copy(env.hemiSky).lerp(tmpCol.copy(flashCol).multiplyScalar(1 / fl), Math.min(0.6, fl * 0.5));
  else hemi.color.copy(env.hemiSky);
  if (life && state.life) life.update(dt, t, atmos.st.rainK);
  lanterns.update(dt, t, env.lamp);
  rain.uniforms.uTime.value = t;
  rain.uniforms.uCam.value.copy(camera.position);
  // eye adaptation: down among the signs the city is far brighter than from the hill
  {
    const c = camera.position, sat = THREE.MathUtils.clamp;
    const inDistrict = sat((-44 - c.z) / 24, 0, 1) * sat((70 - Math.abs(c.x)) / 25, 0, 1) * sat((48 - c.y) / 26, 0, 1);
    const gy = inFine(c.x, c.z) ? groundH(Math.floor(c.x), Math.floor(c.z)) : 0;
    const inOld = sat((c.z + 40) / 20, 0, 1) * sat((60 - Math.abs(c.x)) / 30, 0, 1) * sat((gy + 26 - c.y) / 16, 0, 1);
    const night = THREE.MathUtils.smoothstep(state.time, 0.3, 0.9);
    const target = Math.max(inDistrict * (0.35 + 0.65 * night), inOld * 0.6 * night);
    adapt += (target - adapt) * Math.min(1, dt * 2.5);
    // where the listener stands, for the city soundscape
    if (music.ambOn && (sceneSoundT += dt) > 0.12) {
      sceneSoundT = 0;
      const street = sat(1 - Math.abs(c.x) / 40, 0, 1) * sat((c.z + 60) / 16, 0, 1) * sat((40 - c.z) / 40, 0, 1);
      const district = sat((-44 - c.z) / 24, 0, 1) * sat((70 - Math.abs(c.x)) / 25, 0, 1);
      const dx = PAGODA.x - c.x, dz = PAGODA.z - c.z;
      camera.getWorldDirection(tmpF); tmpR.crossVectors(tmpF, camera.up).normalize();
      music.setScene({
        time: state.time, season: atmos.season, street, district, alt: c.y - gy, life: state.life,
        rain: atmos.st.rainK, snow: atmos.st.snowK,
        shrine: sat(1 - (Math.hypot(dx, dz) - 25) / 160, 0, 1),
        shrinePan: tmpT.set(dx, 0, dz).normalize().dot(tmpR),
      });
    }
    renderer.toneMappingExposure = env.exposure * (1 - 0.5 * adapt);
    post.bloom.strength = state.bloomOn === false ? 0 : env.bloom * 0.8 * (1 - 0.6 * adapt);
  }

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
  if (city && music.ambOn) {
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
  camera.updateMatrixWorld();
  atmos.renderReflection(camera);
  post.composer.render();
  if (rec) {
    const s = Math.floor((performance.now() - recStart) / 1000);
    $('#recTime').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  // adaptive resolution + stats
  frameAcc += dt; frameN++;
  if (frameAcc > 1.0) {
    const ms = (frameAcc / frameN) * 1000;
    if (rec) { /* keep the canvas size fixed while recording */ }
    else if (ms > 30 && pixelRatio > 0.7) { pixelRatio = Math.max(0.7, pixelRatio - 0.2); resize(); goodTime = 0; }
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
  life = createLife(scene, city.palette, city.material);
  hanabi.onBurst(({ at, when, kind, radius }) => {
    const d = at.distanceTo(camera.position);
    music.boom(when + (d * 0.6) / 343, Math.min(1, radius / 90) * Math.max(0.3, 1 - d / 2600), kind === 'chrysanthemum' || kind === 'willow');
  });
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
  if (q.has('season')) setSeason(q.get('season'), true);
  if (q.has('weather')) setWeather(q.get('weather'), true);
  if (q.get('style') === 'ink') setInk(true);
  if (q.get('hanabi') === '1') setHanabi(true, true);
  if (q.get('life') === '0') setLife(false);
  if (q.get('lanterns') === '1') setLanterns(true, true);
  if (q.has('sky')) {
    const text = q.get('sky').slice(0, 48), palette = SKY_PALETTES[q.get('skyp')] ? q.get('skyp') : 'rainbow';
    state.sky = { text, palette };
    setHanabi(true, true);
    hanabi.setMessage(state.sky, simT, 9);
    $('#skyText').value = text;
  }
  if (q.has('matsuri')) festival(true);
  if (q.has('sign')) applySign({ text: q.get('sign'), color: q.get('signc'), style: q.get('signs') }, false);
  if (q.has('cine')) setMode('cinematic');
  if (q.has('t')) setTime(parseFloat(q.get('t')));
  if (q.has('cam')) {
    const c = q.get('cam').split(',').map(Number);
    if (c.length === 6 && c.every(Number.isFinite)) { fly = null; camera.position.set(c[0], c[1], c[2]); controls.target.set(c[3], c[4], c[5]); controls.update(); }
  }
  if (q.has('view') && VIEWS[q.get('view')]) { fly = null; const v = VIEWS[q.get('view')]; camera.position.set(...v.pos); controls.target.set(...v.target); }
  if (q.has('noui')) toggleUI(false);
  // Offscreen capture at a fixed resolution (dev aid; POSTs to the dev server if present).
  const capture = async (name = 'shot', w = 1600, h = 900) => {
    const blob = await renderAt(w, h);
    await fetch('/__shot?name=' + name, { method: 'POST', body: blob });
    return blob.size;
  };
  window.__afterglow = {
    camera, controls, setTime, setMode, flyTo, city, director, scene, renderer, VIEWS, capture, post, petals, music, atmos, hanabi, life, lanterns,
    setSeason, setWeather, setHanabi, setInk, setLife, setLanterns, setAmbience, festival, skyWrite, applySign, shareURL, renderAt,
    get simT() { return simT; }, get env() { return env; },
    // dev: advance the simulation without rAF (hidden tabs / headless checks)
    step(n = 1, dt = 1 / 30) { forcedDt = dt; for (let i = 0; i < n; i++) loop(); forcedDt = null; },
  };
}
boot();
