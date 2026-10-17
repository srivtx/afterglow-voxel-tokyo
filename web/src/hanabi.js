import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 花火 Hanabi: GPU fireworks over the bay. Each shell is a pool of square
// "voxel" sparks with a few time-lagged copies for trails; positions are pure
// functions of time, so the CPU only schedules launches.
// ---------------------------------------------------------------------------
const SLOTS = 10, SPARKS = 420, LAGS = 4, ROCKET = 24;
const KINDS = ['peony', 'willow', 'ring', 'chrysanthemum', 'palm'];
const PALETTES = [
  ['#ff4f8a', '#ffd0e6'], ['#5ad8ff', '#e6fbff'], ['#ffd24a', '#fff2c0'], ['#b46aff', '#ffd6ff'],
  ['#ff7a2a', '#ffe0a0'], ['#62ff9a', '#e0ffe8'], ['#ff3a3a', '#ffd24a'], ['#ffffff', '#9ad8ff'],
];

export function createHanabi() {
  const per = (SPARKS + ROCKET) * LAGS;
  const n = SLOTS * per;
  const aDir = new Float32Array(n * 3), aInfo = new Float32Array(n * 4);
  let k = 0;
  const v = new THREE.Vector3();
  for (let s = 0; s < SLOTS; s++)
    for (let i = 0; i < SPARKS + ROCKET; i++) {
      const rocket = i >= SPARKS;
      // even-ish sphere (fibonacci) with jitter
      const t = (i + 0.5) / SPARKS, ph = i * 2.39996;
      const y = 1 - 2 * t, r = Math.sqrt(Math.max(0, 1 - y * y));
      v.set(Math.cos(ph) * r, y, Math.sin(ph) * r).multiplyScalar(0.92 + Math.random() * 0.16);
      const seed = Math.random();
      for (let l = 0; l < LAGS; l++, k++) {
        aDir[k * 3] = rocket ? (Math.random() - 0.5) * 0.4 : v.x;
        aDir[k * 3 + 1] = rocket ? (i - SPARKS) / ROCKET : v.y;
        aDir[k * 3 + 2] = rocket ? (Math.random() - 0.5) * 0.4 : v.z;
        aInfo[k * 4] = s; aInfo[k * 4 + 1] = l; aInfo[k * 4 + 2] = rocket ? 1 : 0; aInfo[k * 4 + 3] = seed;
      }
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(aDir, 3));
  geo.setAttribute('aInfo', new THREE.BufferAttribute(aInfo, 4));
  const uniforms = {
    uTime: { value: 0 }, uPix: { value: 1 },
    uOrigin: { value: Array.from({ length: SLOTS }, () => new THREE.Vector3(0, -9999, 0)) },
    uStart: { value: new Float32Array(SLOTS).fill(-999) },
    uKind: { value: new Float32Array(SLOTS) },
    uRadius: { value: new Float32Array(SLOTS).fill(80) },
    uCol: { value: Array.from({ length: SLOTS }, () => new THREE.Color()) },
    uCol2: { value: Array.from({ length: SLOTS }, () => new THREE.Color()) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      #define SLOTS ${SLOTS}
      attribute vec4 aInfo;
      uniform float uTime; uniform float uPix;
      uniform vec3 uOrigin[SLOTS]; uniform float uStart[SLOTS]; uniform float uKind[SLOTS]; uniform float uRadius[SLOTS];
      uniform vec3 uCol[SLOTS]; uniform vec3 uCol2[SLOTS];
      varying vec3 vC;
      const float RISE = 1.7;
      void main() {
        int s = int(aInfo.x + 0.5);
        float lag = aInfo.y * 0.055;
        float t = uTime - uStart[s] - lag;            // time since burst
        vec3 o = uOrigin[s];
        float kind = uKind[s];
        float bright = 0.0; vec3 p = o; vec3 col = uCol[s]; float size = 1.0;
        if (aInfo.z > 0.5) {
          // rising shell: a short glittering trail
          float tr = t + RISE - position.y * 0.18;
          float u = clamp(tr / RISE, 0.0, 1.0);
          float e = 1.0 - (1.0 - u) * (1.0 - u);
          p = o + vec3(position.x * 3.0 * (1.0 - u), -uRadius[s] * 2.6 * (1.0 - e), position.z * 3.0 * (1.0 - u));
          bright = step(0.0, tr) * step(tr, RISE) * (0.5 + 0.5 * u) * (1.0 - position.y * 0.7) * 2.2;
          col = vec3(1.0, 0.78, 0.5);
          size = 0.8;
        } else if (t > 0.0) {
          float willow = step(0.5, kind) * step(kind, 1.5);
          float drag = mix(1.9, 0.9, willow);
          float life = mix(2.6, 4.4, willow) * (0.8 + aInfo.w * 0.35);
          vec3 d = position;
          if (kind > 1.5 && kind < 2.5) { d.y *= 0.12; d = normalize(d) * 0.95; }           // ring
          float sp = uRadius[s] * drag;
          vec3 disp = d * sp * (1.0 - exp(-drag * t)) / drag * 1.0;
          disp.y -= (mix(9.0, 16.0, willow)) * t * t * 0.5;
          if (kind > 3.5) disp.y += uRadius[s] * 0.25 * (1.0 - exp(-t));                    // palm lift
          p = o + disp;
          float u = t / life;
          bright = (1.0 - smoothstep(0.55, 1.0, u)) * step(u, 1.0);
          bright *= mix(1.0, 0.55 + 0.45 * step(0.5, fract(aInfo.w * 31.0 + uTime * 9.0)), smoothstep(0.35, 0.6, u)); // crackle
          bright *= 1.0 - aInfo.y / ${LAGS}.0 * 0.8;
          // white-hot core -> colour, chrysanthemum switches colour mid-flight
          col = mix(vec3(1.2, 1.12, 1.0), uCol[s], smoothstep(0.0, 0.2, u));
          if (kind > 2.5 && kind < 3.5) col = mix(col, uCol2[s], smoothstep(0.4, 0.55, u));
          if (willow > 0.5) col = mix(vec3(1.4, 1.1, 0.6), vec3(1.0, 0.55, 0.15), smoothstep(0.1, 0.8, u));
          // sparks start packed at the centre: fade them in as the shell opens
          bright *= 1.7 * smoothstep(0.0, 0.18, t) * (1.0 + 0.5 * exp(-t * 4.0));
          size = mix(1.3, 0.7, u);
        }
        vC = col * bright;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = bright > 0.001 ? max(1.0, 2600.0 * size * uPix / -mv.z) : 0.0;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      void main() { gl_FragColor = vec4(vC, 1.0); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 1;

  let next = 0, slot = 0, enabled = false, salvo = 0;
  const flashes = [];
  const listeners = [];
  const tmp = new THREE.Color();

  function launch(time, at) {
    const s = slot; slot = (slot + 1) % SLOTS;
    const o = uniforms.uOrigin.value[s];
    if (at) o.copy(at);
    else o.set(THREE.MathUtils.randFloat(-320, 340), THREE.MathUtils.randFloat(230, 360), THREE.MathUtils.randFloat(-1050, -760));
    const kind = Math.floor(Math.random() * KINDS.length);
    const pal = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    uniforms.uKind.value[s] = kind;
    uniforms.uRadius.value[s] = THREE.MathUtils.randFloat(62, 105) * (kind === 2 ? 1.15 : 1);
    uniforms.uCol.value[s].set(pal[0]);
    uniforms.uCol2.value[s].set(pal[1]);
    uniforms.uStart.value[s] = time + 1.7; // burst after the rise
    flashes.push({ t: time + 1.7, color: tmp.set(kind === 1 ? '#ffb050' : pal[0]).clone(), r: uniforms.uRadius.value[s] });
    for (const fn of listeners) fn({ at: o.clone(), when: 1.7, kind: KINDS[kind], radius: uniforms.uRadius.value[s] });
  }

  return {
    points,
    get enabled() { return enabled; },
    set enabled(v) { enabled = v; points.visible = v || flashes.length > 0; },
    onBurst(fn) { listeners.push(fn); },
    launch,
    // returns the current sky flash (colour * strength) for lighting
    update(time, outColor) {
      uniforms.uTime.value = time;
      if (enabled && time >= next) {
        launch(time);
        if (salvo > 0) { salvo--; next = time + THREE.MathUtils.randFloat(0.25, 0.6); }
        else {
          next = time + THREE.MathUtils.randFloat(1.1, 3.2);
          if (Math.random() < 0.12) salvo = 3 + Math.floor(Math.random() * 4);
        }
      }
      outColor.setRGB(0, 0, 0);
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        const dt = time - f.t;
        if (dt > 3) { flashes.splice(i, 1); continue; }
        if (dt < 0) continue;
        const k = Math.exp(-dt * 2.2) * (f.r / 90);
        outColor.r += f.color.r * k; outColor.g += f.color.g * k; outColor.b += f.color.b * k;
      }
      points.visible = enabled || flashes.length > 0;
      return outColor;
    },
    setPixelRatio(pr) { uniforms.uPix.value = pr; },
  };
}
