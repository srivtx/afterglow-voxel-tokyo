import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { atmosU } from './sky.js';
import { groundH, inFine, PLATEAU } from './build/layout.js';

// ---------------------------------------------------------------------------
// Seasons + weather. Everything here is uniforms and particles: switching a
// season or weather never re-meshes the city.
// ---------------------------------------------------------------------------
export const SEASONS = {
  spring: { jp: '春', name: 'Spring', flakes: 'petals', sakGlow: 1 },
  summer: {
    jp: '夏', name: 'Summer', flakes: 'fireflies', sakGlow: 0, hanabi: true,
    sak: ['#3a8638', '#5a9e46', 1], leaf: ['#2c7630', '#4a943c', 0.55], grass: ['#4c9838', 0.45], maple: ['#4a8a38', 0.9],
  },
  autumn: {
    jp: '秋', name: 'Autumn', flakes: 'leaves', sakGlow: 0.1,
    sak: ['#e2522a', '#f4a63a', 1], leaf: ['#e2a832', '#c84e2a', 0.9], grass: ['#a08a4a', 0.55], maple: ['#d4301e', 0.4],
  },
  winter: {
    jp: '冬', name: 'Winter', flakes: null, sakGlow: 0.12, snow: 0.72,
    sak: ['#eef2fa', '#d4dcee', 0.94], leaf: ['#5d5a4a', '#6e5c46', 0.65], grass: ['#8c8a7c', 0.6], maple: ['#6e4c3c', 0.75],
  },
};
export const WEATHERS = {
  clear: { jp: '晴', name: 'Clear' },
  rain: { jp: '雨', name: 'Rain' },
  snow: { jp: '雪', name: 'Snow' },
};

const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));
const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
// pull a colour toward a cool grey of the same brightness, then scale it
function overcast(c, amt, mul, cool = 1.12) {
  if (amt <= 0) return;
  const l = lum(c);
  c.lerp(new THREE.Color(l * 0.96, l, l * cool), amt).multiplyScalar(1 + (mul - 1) * amt);
}

export function createAtmos({ renderer, scene, flakes, rain }) {
  const st = {
    season: 'spring', weather: 'clear',
    rainK: 0, snowK: 0, snowCover: 0, flakeFade: 1, flakeMode: 'petals', flakesOn: true,
  };
  const U = atmosU;
  const tgt = { sak: [new THREE.Color(), new THREE.Color(), 0], leaf: [new THREE.Color(), new THREE.Color(), 0], grass: [new THREE.Color(), 0], maple: [new THREE.Color(), 0] };

  // planar reflection of the city in the wet streets (rendered only when wet)
  const mirror = new Reflector(new THREE.PlaneGeometry(10, 10), { textureWidth: 512, textureHeight: 512, multisample: 0 });
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.y = U.uReflY.value;
  mirror.updateMatrixWorld(true);
  const mirrorRT = mirror.getRenderTarget();
  const mirrorInv = mirror.matrixWorld.clone().invert();
  // the mirror sits at the street level under the camera: the old town's
  // plateau or the low district, so both get real reflections in the rain
  function setMirrorLevel(y) {
    if (U.uReflY.value === y) return;
    U.uReflY.value = y;
    mirror.position.y = y;
    mirror.updateMatrixWorld(true);
    mirrorInv.copy(mirror.matrixWorld).invert();
  }

  function setSeason(name) {
    const s = SEASONS[name];
    if (!s) return;
    st.season = name;
    const set = (key, arr) => {
      if (!arr) { tgt[key][tgt[key].length - 1] = 0; return; }
      const n = arr.length;
      for (let i = 0; i < n - 1; i++) tgt[key][i].set(arr[i]);
      tgt[key][n - 1] = arr[n - 1];
    };
    set('sak', s.sak); set('leaf', s.leaf); set('grass', s.grass); set('maple', s.maple);
  }
  function setWeather(name) { if (WEATHERS[name]) st.weather = name; }

  function wantFlakes(nightK) {
    if (st.weather === 'snow') return 'snow';
    if (st.weather === 'rain') return null;
    const f = SEASONS[st.season].flakes;
    if (f === 'fireflies' && nightK < 0.15) return null;
    return f;
  }

  // Returns true while anything that feeds the environment is still easing.
  function update(dt, env, time) {
    const nightK = THREE.MathUtils.smoothstep(time, 0.5, 0.85);
    // season colours
    const lerpC = (u, c, m) => { if (m > 0) u.value.lerp(c, 1 - Math.exp(-2.5 * dt)); };
    lerpC(U.uSak0, tgt.sak[0], tgt.sak[2]); lerpC(U.uSak1, tgt.sak[1], tgt.sak[2]);
    lerpC(U.uLeaf0, tgt.leaf[0], tgt.leaf[2]); lerpC(U.uLeaf1, tgt.leaf[1], tgt.leaf[2]);
    lerpC(U.uGrass0, tgt.grass[0], tgt.grass[1]); lerpC(U.uMaple0, tgt.maple[0], tgt.maple[1]);
    U.uSakMix.value = approach(U.uSakMix.value, tgt.sak[2], 2.5, dt);
    U.uLeafMix.value = approach(U.uLeafMix.value, tgt.leaf[2], 2.5, dt);
    U.uGrassMix.value = approach(U.uGrassMix.value, tgt.grass[1], 2.5, dt);
    U.uMapleMix.value = approach(U.uMapleMix.value, tgt.maple[1], 2.5, dt);

    // weather blend
    const r0 = st.rainK, s0 = st.snowK;
    st.rainK = approach(st.rainK, st.weather === 'rain' ? 1 : 0, 1.4, dt);
    st.snowK = approach(st.snowK, st.weather === 'snow' ? 1 : 0, 1.4, dt);
    const coverT = Math.max(SEASONS[st.season].snow || 0, st.weather === 'snow' ? 1 : 0);
    st.snowCover = approach(st.snowCover, coverT, st.snowCover < coverT ? 0.5 : 1.2, dt);
    U.uSnow.value = st.snowCover;
    U.uWet.value = st.rainK * (1 - st.snowCover * 0.8);
    U.uRain.value = st.rainK;
    rain.uniforms.uAmount.value = st.rainK;
    rain.mesh.visible = st.rainK > 0.01;

    // flakes: fade out, swap look, fade in
    const want = st.flakesOn ? wantFlakes(nightK) : null;
    if (want !== st.flakeMode) {
      st.flakeFade = approach(st.flakeFade, 0, 4, dt);
      if (st.flakeFade < 0.02) { st.flakeMode = want; if (want) flakes.setMode(want); }
    } else st.flakeFade = approach(st.flakeFade, want ? 1 : 0, 1.5, dt);
    let fade = st.flakeFade;
    if (st.flakeMode === 'fireflies') fade *= THREE.MathUtils.smoothstep(nightK, 0.1, 0.6);
    flakes.uniforms.uFade.value = fade;
    flakes.mesh.visible = fade > 0.01;

    return Math.abs(st.rainK - r0) > 1e-4 || Math.abs(st.snowK - s0) > 1e-4;
  }

  // weather on top of the time-of-day environment
  function modifyEnv(env) {
    const r = THREE.MathUtils.smoothstep(st.rainK, 0, 1), s = THREE.MathUtils.smoothstep(st.snowK, 0, 1);
    if (r > 0) {
      for (const k of ['zenith', 'mid']) overcast(env[k], 0.55 * r, 0.62);
      for (const k of ['band', 'bandAnti', 'horizonAnti']) overcast(env[k], 0.6 * r, 0.6);
      overcast(env.horizon, 0.5 * r, 0.5);
      overcast(env.cloudLit, 0.6 * r, 0.5); overcast(env.cloudRim, 0.7 * r, 0.4); env.cloudShade.multiplyScalar(1 - 0.35 * r);
      env.sunGlow.multiplyScalar(1 - 0.7 * r); env.glow *= 1 - 0.5 * r;
      env.sunInt *= 1 - 0.7 * r; env.hemiInt *= 1 - 0.18 * r; env.fill *= 1 - 0.4 * r;
      env.fog *= 1 + 1.3 * r; env.stars *= 1 - r;
      env.bloom += 0.14 * r; env.neon *= 1 + 0.06 * r; env.lamp *= 1 + 0.08 * r;
    }
    if (s > 0) {
      for (const k of ['zenith', 'mid', 'band', 'bandAnti', 'horizonAnti']) overcast(env[k], 0.5 * s, 0.85, 1.18);
      overcast(env.horizon, 0.45 * s, 0.7);
      overcast(env.cloudLit, 0.45 * s, 0.85); overcast(env.cloudShade, 0.4 * s, 1.1);
      env.sunGlow.multiplyScalar(1 - 0.5 * s); env.sunInt *= 1 - 0.45 * s; env.hemiInt *= 1 + 0.12 * s;
      env.fog *= 1 + 1.0 * s; env.stars *= 1 - 0.8 * s;
    }
    const sg = SEASONS[st.season].sakGlow;
    env.sakura *= sg;
    return env;
  }

  const dummy = new THREE.Vector3();
  function renderReflection(camera) {
    const on = U.uWet.value > 0.01 && camera.position.y < 160;
    U.uReflOn.value = 0;
    U.uRefl.value = null;
    if (!on) return;
    camera.getWorldPosition(dummy);
    const gy = inFine(dummy.x, dummy.z) ? groundH(Math.floor(dummy.x), Math.floor(dummy.z)) : 0;
    setMirrorLevel(gy >= 10 ? PLATEAU + 1 : 1);
    if (dummy.y <= U.uReflY.value + 0.2) return;
    const rainVis = rain.mesh.visible, flakeVis = flakes.mesh.visible;
    rain.mesh.visible = false; flakes.mesh.visible = false;
    mirror.onBeforeRender(renderer, scene, camera);
    rain.mesh.visible = rainVis; flakes.mesh.visible = flakeVis;
    U.uRefl.value = mirrorRT.texture;
    // the Reflector's matrix expects mirror-local positions; ours are world positions
    U.uReflMat.value.copy(mirror.material.uniforms.textureMatrix.value).multiply(mirrorInv);
    U.uReflOn.value = 1;
  }

  function setSize(w, h) { mirrorRT.setSize(Math.max(256, Math.round(w * 0.5)), Math.max(256, Math.round(h * 0.5))); }

  setSeason('spring');
  return {
    st, mirror, setSeason, setWeather, update, modifyEnv, renderReflection, setSize,
    get season() { return st.season; }, get weather() { return st.weather; },
    get flakeMode() { return st.flakeMode; },
    set flakesOn(v) { st.flakesOn = v; },
  };
}
