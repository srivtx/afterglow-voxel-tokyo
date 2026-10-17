import * as THREE from 'three';
import { rasterText } from './build/layout.js';

// ---------------------------------------------------------------------------
// 花火 Hanabi: GPU fireworks over the bay. Each shell is a pool of square
// "voxel" sparks with a few time-lagged copies for trails; positions are pure
// functions of time, so the CPU only schedules launches.
//
// Besides the classic shells there are colour modes (rainbow, split,
// confetti, gradient), shaped shells (heart, star, smile, sakura, butterfly)
// and 空文字 sky-writing: a shell that bursts as a sphere, then its sparks
// rearrange into your words, hang there, and drip away.
// ---------------------------------------------------------------------------
const SLOTS = 12, SPARKS = 640, LAGS = 4, ROCKET = 24;
export const KINDS = ['peony', 'willow', 'ring', 'chrysanthemum', 'palm', 'strobe', 'shape', 'text'];
export const SHAPES = ['heart', 'star', 'smile', 'sakura', 'butterfly'];
export const COLOR_MODES = ['solid', 'rainbow', 'split', 'confetti', 'gradient'];
const PALETTES = [
  ['#ff4f8a', '#ffd0e6'], ['#5ad8ff', '#e6fbff'], ['#ffd24a', '#fff2c0'], ['#b46aff', '#ffd6ff'],
  ['#ff7a2a', '#ffe0a0'], ['#62ff9a', '#e0ffe8'], ['#ff3a3a', '#ffd24a'], ['#ffffff', '#9ad8ff'],
  ['#ff2fd0', '#4af0ff'], ['#3a7bff', '#ff5ab4'], ['#c8ff3a', '#a04aff'], ['#ff9a3a', '#3affd8'],
  ['#2affc8', '#ffe14a'], ['#ff5a5a', '#5a8cff'], ['#ffb3d9', '#b3ffe0'], ['#e8c46a', '#fff8e0'],
];
// named palettes for the sky-writing dialog
export const SKY_PALETTES = {
  rainbow: { mode: 1, pal: ['#ffffff', '#ffffff', '#ffffff'] },
  gold: { mode: 0, pal: ['#ffc860', '#fff0c0', '#ffffff'] },
  sakura: { mode: 4, pal: ['#ff7ab8', '#ffe4f2', '#ffffff'] },
  neon: { mode: 2, pal: ['#ff2fd0', '#3ff0ff', '#ffffff'] },
  confetti: { mode: 3, pal: ['#ffd24a', '#ff4f8a', '#5ad8ff'] },
};

// ---- shape outlines, normalised to about [-1, 1]
function shapePoints(name, n) {
  const pts = [];
  const push = (x, y) => pts.push([x, y]);
  if (name === 'heart') {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      push((16 * Math.sin(a) ** 3) / 17, (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 17 + 0.12);
    }
  } else if (name === 'star') {
    const V = [];
    for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? 0.42 : 1; V.push([Math.cos(a) * r, Math.sin(a) * r]); }
    for (let i = 0; i < n; i++) {
      const u = (i / n) * 10, k = Math.floor(u), f = u - k, A = V[k], B = V[(k + 1) % 10];
      push(A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f);
    }
  } else if (name === 'smile') {
    const nf = Math.floor(n * 0.55), ne = Math.floor(n * 0.12), nm = n - nf - ne * 2;
    for (let i = 0; i < nf; i++) { const a = (i / nf) * Math.PI * 2; push(Math.cos(a), Math.sin(a)); }
    for (const ex of [-0.36, 0.36]) for (let i = 0; i < ne; i++) { const a = (i / ne) * Math.PI * 2; push(ex + Math.cos(a) * 0.1, 0.3 + Math.sin(a) * 0.14); }
    for (let i = 0; i < nm; i++) { const a = Math.PI * (1.15 + 0.7 * (i / nm)); push(Math.cos(a) * 0.58, Math.sin(a) * 0.58 + 0.02); }
  } else if (name === 'sakura') {
    const nc = Math.floor(n * 0.12), np = n - nc;
    for (let i = 0; i < np; i++) {
      const a = (i / np) * Math.PI * 2;
      // five petals with the little notch at each tip
      const lobe = Math.abs(Math.cos(2.5 * a));
      const notch = 1 - 0.16 * Math.exp(-Math.pow((((a * 5) / (2 * Math.PI)) % 1) - 0.5, 2) * 260);
      const r = (0.32 + 0.68 * Math.pow(lobe, 0.6)) * notch;
      push(Math.cos(a + Math.PI / 2) * r, Math.sin(a + Math.PI / 2) * r);
    }
    for (let i = 0; i < nc; i++) { const a = (i / nc) * Math.PI * 2; push(Math.cos(a) * 0.14, Math.sin(a) * 0.14); }
  } else { // butterfly curve
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 12;
      const r = Math.exp(Math.sin(a)) - 2 * Math.cos(4 * a) + Math.pow(Math.sin((2 * a - Math.PI) / 24), 5);
      push((Math.sin(a) * r) / 3.2, (Math.cos(a) * r) / 3.2 - 0.25);
    }
  }
  return pts;
}

// ---- text raster -> spark targets (normalised by half-width)
function textTargets(text) {
  const n = [...text].length, cjk = /[\u3000-\u9fff\uff00-\uffef]/.test(text);
  const px = cjk ? (n <= 4 ? 17 : n <= 7 ? 14 : 12) : n <= 4 ? 13 : 11;
  const bmp = rasterText(text, px);
  const lit = [];
  for (let y = 0; y < bmp.h; y++) for (let x = 0; x < bmp.w; x++) if (bmp.bits[x + y * bmp.w]) lit.push([x, y]);
  return { bmp, lit };
}
// split a message into shells that each fit the spark budget
export function planMessage(text) {
  const clean = text.trim().slice(0, 48);
  if (!clean) return [];
  if (textTargets(clean).lit.length <= SPARKS * 0.92) return [clean];
  const words = clean.split(/\s+/);
  const out = [];
  let cur = '';
  for (const w of words) {
    const tryS = cur ? cur + ' ' + w : w;
    if (cur && textTargets(tryS).lit.length > SPARKS * 0.92) { out.push(cur); cur = w; } else cur = tryS;
  }
  if (cur) out.push(cur);
  // a single word that is still too big gets split by characters
  return out.flatMap((s) => {
    if (textTargets(s).lit.length <= SPARKS || [...s].length < 2) return [s];
    const ch = [...s], parts = [];
    let buf = '';
    for (const c of ch) { if (buf && textTargets(buf + c).lit.length > SPARKS * 0.92) { parts.push(buf); buf = c; } else buf += c; }
    if (buf) parts.push(buf);
    return parts;
  });
}

export function createHanabi() {
  const per = (SPARKS + ROCKET) * LAGS;
  const n = SLOTS * per;
  const aDir = new Float32Array(n * 3), aInfo = new Float32Array(n * 4), aTgt = new Float32Array(n * 2);
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
  const tgtAttr = new THREE.BufferAttribute(aTgt, 2);
  tgtAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aTgt', tgtAttr);
  const arr = (f) => Array.from({ length: SLOTS }, f);
  const uniforms = {
    uTime: { value: 0 }, uPix: { value: 1 },
    uOrigin: { value: arr(() => new THREE.Vector3(0, -9999, 0)) },
    uStart: { value: new Float32Array(SLOTS).fill(-999) },
    uKind: { value: new Float32Array(SLOTS) },
    uMode: { value: new Float32Array(SLOTS) },
    uRadius: { value: new Float32Array(SLOTS).fill(80) },
    uCol: { value: arr(() => new THREE.Color()) },
    uCol2: { value: arr(() => new THREE.Color()) },
    uCol3: { value: arr(() => new THREE.Color()) },
    uRight: { value: arr(() => new THREE.Vector3(1, 0, 0)) },
    uDot: { value: new Float32Array(SLOTS).fill(1) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      #define SLOTS ${SLOTS}
      attribute vec4 aInfo;
      attribute vec2 aTgt;
      uniform float uTime; uniform float uPix;
      uniform vec3 uOrigin[SLOTS]; uniform float uStart[SLOTS]; uniform float uKind[SLOTS]; uniform float uRadius[SLOTS];
      uniform float uMode[SLOTS];
      uniform vec3 uCol[SLOTS]; uniform vec3 uCol2[SLOTS]; uniform vec3 uCol3[SLOTS]; uniform vec3 uRight[SLOTS];
      uniform float uDot[SLOTS];
      varying vec3 vC;
      const float RISE = 1.7;
      vec3 hsv(float h, float s, float v) {
        vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        return v * mix(vec3(1.0), k, s);
      }
      void main() {
        int s = int(aInfo.x + 0.5);
        float lag = aInfo.y * 0.055;
        float t = uTime - uStart[s] - lag;            // time since burst
        vec3 o = uOrigin[s];
        float kind = uKind[s];
        float bright = 0.0; vec3 p = o; vec3 col = uCol[s]; float size = 1.0;
        bool planar = kind > 5.5;                     // shape or text
        // colour mode: per-spark base colour
        float mode = uMode[s];
        vec3 base = uCol[s];
        float axis = planar ? aTgt.x * 0.5 + 0.5 : atan(position.z, position.x) / 6.2832 + 0.5;
        float side = planar ? aTgt.y : position.x;
        if (mode > 0.5 && mode < 1.5) base = hsv(fract(axis + uTime * 0.05), 0.85, 1.15);
        else if (mode > 1.5 && mode < 2.5) base = side > 0.0 ? uCol[s] : uCol2[s];
        else if (mode > 2.5 && mode < 3.5) { float q = fract(aInfo.w * 7.31); base = q < 0.34 ? uCol[s] : q < 0.67 ? uCol2[s] : uCol3[s]; }
        else if (mode > 3.5) base = mix(uCol[s], uCol2[s], planar ? clamp(length(aTgt), 0.0, 1.0) : position.y * 0.5 + 0.5);

        if (aInfo.z > 0.5) {
          // rising shell: a short glittering trail
          float tr = t + RISE - position.y * 0.18;
          float u = clamp(tr / RISE, 0.0, 1.0);
          float e = 1.0 - (1.0 - u) * (1.0 - u);
          p = o + vec3(position.x * 3.0 * (1.0 - u), -min(uRadius[s], 95.0) * 2.6 * (1.0 - e), position.z * 3.0 * (1.0 - u));
          bright = step(0.0, tr) * step(tr, RISE) * (0.5 + 0.5 * u) * (1.0 - position.y * 0.7) * 2.2;
          col = vec3(1.0, 0.78, 0.5);
          size = 0.8;
        } else if (t > 0.0 && planar) {
          // shapes and sky-writing: sparks fly to targets on a plane facing the viewer
          bool text = kind > 6.5;
          float W = uRadius[s];
          vec3 tgt = (uRight[s] * aTgt.x + vec3(0.0, 1.0, 0.0) * aTgt.y) * W;
          float hold = text ? 4.6 : 2.3, life = hold + 1.7;
          vec3 pp;
          if (text) {
            // burst as a sphere, then rearrange into the letters
            vec3 burst = position * min(W, 140.0) * 0.55 * (1.0 - exp(-3.2 * t));
            pp = mix(burst, tgt, smoothstep(0.35, 1.55, t));
          } else pp = tgt * (1.0 - exp(-4.5 * t)) + position * 6.0 * exp(-4.0 * t);
          float fall = max(0.0, t - hold);
          pp.y -= 8.0 * fall * fall;
          pp += position * fall * 7.0;
          p = o + pp;
          bright = 1.3 * smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(hold, life, t)) * (1.0 + 0.6 * exp(-t * 5.0));
          bright *= mix(1.0, 0.35 + 0.65 * step(0.5, fract(aInfo.w * 31.0 + uTime * 8.0)), smoothstep(hold - 0.5, hold + 0.5, t));
          // trails while moving; once settled only the lead spark shows so letters stay crisp
          float settled = smoothstep(text ? 1.5 : 0.6, text ? 2.0 : 1.0, t) * (1.0 - smoothstep(hold, hold + 0.3, t));
          bright *= mix(1.0 - aInfo.y / ${LAGS}.0 * 0.8, aInfo.y < 0.5 ? 1.7 : 0.0, settled);
          col = mix(vec3(1.25, 1.15, 1.0), base, smoothstep(0.05, 0.6, t));
          size = text ? uDot[s] : 1.15;
        } else if (t > 0.0) {
          float willow = step(0.5, kind) * step(kind, 1.5);
          float strobe = step(4.5, kind);
          float drag = mix(mix(1.9, 0.9, willow), 1.4, strobe);
          float life = mix(mix(2.6, 4.4, willow), 3.4, strobe) * (0.8 + aInfo.w * 0.35);
          vec3 d = position;
          if (kind > 1.5 && kind < 2.5) { d.y *= 0.12; d = normalize(d) * 0.95; }           // ring
          float sp = uRadius[s] * drag;
          vec3 disp = d * sp * (1.0 - exp(-drag * t)) / drag * 1.0;
          disp.y -= (mix(9.0, 16.0, willow)) * t * t * 0.5;
          if (kind > 3.5 && kind < 4.5) disp.y += uRadius[s] * 0.25 * (1.0 - exp(-t));       // palm lift
          p = o + disp;
          float u = t / life;
          bright = (1.0 - smoothstep(0.55, 1.0, u)) * step(u, 1.0);
          bright *= mix(1.0, 0.55 + 0.45 * step(0.5, fract(aInfo.w * 31.0 + uTime * 9.0)), smoothstep(0.35, 0.6, u)); // crackle
          // strobe: hard silver glitter
          bright *= mix(1.0, 1.8 * step(0.72, fract(aInfo.w * 13.7 + uTime * 11.0)), strobe * smoothstep(0.12, 0.3, u));
          bright *= 1.0 - aInfo.y / ${LAGS}.0 * 0.8;
          // white-hot core -> colour, chrysanthemum switches colour mid-flight
          col = mix(vec3(1.2, 1.12, 1.0), base, smoothstep(0.0, 0.2, u));
          if (kind > 2.5 && kind < 3.5) col = mix(col, mode > 0.5 ? base * 0.6 + uCol2[s] * 0.6 : uCol2[s], smoothstep(0.4, 0.55, u));
          if (willow > 0.5) col = mix(vec3(1.4, 1.1, 0.6), mode > 0.5 ? base : vec3(1.0, 0.55, 0.15), smoothstep(0.1, 0.8, u));
          if (strobe > 0.5) col = mix(vec3(1.3), base * 0.5 + vec3(0.7), 0.5);
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

  let next = 0, slot = 0, enabled = false, salvo = 0, busyUntil = -1, viewer = null;
  let message = null, nextMessage = 0;
  const flashes = [];
  const listeners = [];
  const queue = [];
  const tmp = new THREE.Color(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  function writeTargets(s, pts, jitter) {
    const base = s * per * 2;
    const m = pts.length;
    for (let i = 0; i < SPARKS + ROCKET; i++) {
      let x = 0, y = 0;
      if (i < SPARKS && m) {
        const j = m >= SPARKS ? Math.floor((i * m) / SPARKS) : i % m;
        x = pts[j][0]; y = pts[j][1];
        if (i >= m) { x += (Math.random() - 0.5) * jitter; y += (Math.random() - 0.5) * jitter; }
      }
      for (let l = 0; l < LAGS; l++) { const q = base + (i * LAGS + l) * 2; aTgt[q] = x; aTgt[q + 1] = y; }
    }
    tgtAttr.addUpdateRange(base, per * 2);
    tgtAttr.needsUpdate = true;
  }

  // a point in front of the viewer, high in the sky, and the plane facing them
  function frontOfViewer(dist = 820) {
    viewer.getWorldDirection(fwd);
    // a little above where the viewer is looking, clear of the skyline
    const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
    const elev = THREE.MathUtils.clamp(pitch + 0.22, 0.16, 0.5);
    fwd.y = 0; fwd.normalize();
    const o = viewer.position.clone().addScaledVector(fwd, dist);
    o.y = THREE.MathUtils.clamp(viewer.position.y + dist * Math.tan(elev), 170, 700);
    return o;
  }
  function faceViewer(s, at) {
    const r = uniforms.uRight.value[s];
    if (!viewer) { r.set(1, 0, 0); return; }
    fwd.copy(at).sub(viewer.position); fwd.y = 0;
    if (fwd.lengthSq() < 1) fwd.set(0, 0, -1);
    fwd.normalize();
    right.set(-fwd.z, 0, fwd.x); // camera-right for a viewer looking along fwd
    r.copy(right);
  }

  // opts: { at, kind, mode, palette: [c1, c2, c3], shape, text, radius }
  function launch(time, opts = {}) {
    if (opts.isVector3) opts = { at: opts };
    const s = slot; slot = (slot + 1) % SLOTS;
    const o = uniforms.uOrigin.value[s];
    if (opts.at) o.copy(opts.at);
    else o.set(THREE.MathUtils.randFloat(-320, 340), THREE.MathUtils.randFloat(230, 360), THREE.MathUtils.randFloat(-1050, -760));
    let kind = opts.kind != null ? KINDS.indexOf(opts.kind) : -1;
    if (kind < 0) kind = pick([0, 0, 0, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 5]);
    const pal = opts.palette || [...pick(PALETTES), pick(PALETTES)[0]];
    let mode = opts.mode != null ? opts.mode : Math.random() < 0.45 ? 0 : pick([1, 2, 2, 3, 3, 4]);
    let radius = opts.radius || THREE.MathUtils.randFloat(62, 105) * (kind === 2 ? 1.15 : 1);
    if (kind === 6) {
      writeTargets(s, shapePoints(opts.shape || pick(SHAPES), SPARKS), 0.02);
      radius = opts.radius || THREE.MathUtils.randFloat(85, 120);
      faceViewer(s, o);
    } else if (kind === 7) {
      const { bmp, lit } = textTargets(opts.text || '花火');
      const sp = THREE.MathUtils.clamp(780 / bmp.w, 7, 15);
      uniforms.uDot.value[s] = THREE.MathUtils.clamp(sp / 9, 0.9, 1.5);
      const W = (bmp.w / 2) * sp;
      writeTargets(s, lit.map(([x, y]) => [((x - bmp.w / 2 + 0.5) * sp) / W, ((bmp.h / 2 - y - 0.5) * sp) / W]), (0.5 * sp) / W);
      radius = W;
      faceViewer(s, o);
    }
    uniforms.uKind.value[s] = kind;
    uniforms.uMode.value[s] = mode;
    uniforms.uRadius.value[s] = radius;
    uniforms.uCol.value[s].set(pal[0]);
    uniforms.uCol2.value[s].set(pal[1]);
    uniforms.uCol3.value[s].set(pal[2] || pal[0]);
    uniforms.uStart.value[s] = time + 1.7; // burst after the rise
    busyUntil = Math.max(busyUntil, time + 1.7 + (kind === 7 ? 7 : 5.5));
    const fr = Math.min(radius, 110);
    flashes.push({ t: time + 1.7, color: tmp.set(mode === 1 ? '#fff0f8' : kind === 1 ? '#ffb050' : pal[0]).clone(), r: kind >= 6 ? 80 : fr });
    for (const fn of listeners) fn({ at: o.clone(), when: 1.7, kind: KINDS[kind], radius: Math.min(radius, 110) });
    points.visible = true;
  }

  // sky-writing: one or more shells that spell the message, one after another
  function write(time, text, style = {}) {
    const parts = planMessage(text);
    if (!parts.length) return 0;
    const at = style.at || (viewer ? frontOfViewer() : new THREE.Vector3(0, 300, -900));
    const named = SKY_PALETTES[style.palette] || SKY_PALETTES.rainbow;
    parts.forEach((p, i) => queue.push({ t: time + i * 5, opts: { kind: 'text', text: p, at: at.clone(), mode: named.mode, palette: named.pal } }));
    return parts.length;
  }
  function shape(time, name, style = {}) {
    const at = style.at || (viewer ? frontOfViewer(950) : null);
    const named = style.palette ? SKY_PALETTES[style.palette] : null;
    launch(time, { kind: 'shape', shape: name, at, mode: named?.mode, palette: named?.pal });
  }
  // スターマイン: a rapid-fire grand finale
  function finale(time) {
    for (let i = 0; i < 26; i++) queue.push({ t: time + Math.pow(i / 26, 0.8) * 7 + Math.random() * 0.2, opts: {} });
    for (let i = 0; i < 3; i++) queue.push({ t: time + 7.6 + i * 0.12, opts: { kind: 'chrysanthemum', radius: 125, mode: 1 } });
    queue.push({ t: time + 8.4, opts: { kind: 'strobe', radius: 140 } });
  }

  return {
    points,
    get enabled() { return enabled; },
    set enabled(v) { enabled = v; points.visible = v || flashes.length > 0 || queue.length > 0; },
    setViewer(cam) { viewer = cam; },
    // a message that recurs during the show (and travels in share links)
    get message() { return message; },
    // the first showing waits `delay` seconds (0 = at the next launch)
    setMessage(m, time = 0, delay = 0) { message = m && m.text ? m : null; nextMessage = time + delay; },
    onBurst(fn) { listeners.push(fn); },
    launch, write, shape, finale,
    // launch toward a direction from the viewer (tap the sky)
    launchToward(time, dir) {
      const o = viewer.position.clone().addScaledVector(dir, 850);
      o.y = THREE.MathUtils.clamp(o.y, 160, 560);
      launch(time, { at: o });
    },
    // returns the current sky flash (colour * strength) for lighting
    update(time, outColor) {
      uniforms.uTime.value = time;
      for (let i = queue.length - 1; i >= 0; i--) if (time >= queue[i].t) { launch(time, queue[i].opts); queue.splice(i, 1); }
      if (enabled && time >= next) {
        const r = Math.random();
        if (message && time >= nextMessage) {
          write(time, message.text, { palette: message.palette });
          nextMessage = time + 26 + planMessage(message.text).length * 5;
        } else if (r < 0.08) launch(time, { kind: 'shape', shape: pick(SHAPES), at: viewer && Math.random() < 0.5 ? frontOfViewer(1000) : undefined });
        else launch(time);
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
      points.visible = enabled || flashes.length > 0 || queue.length > 0 || time < busyUntil;
      return outColor;
    },
    setPixelRatio(pr) { uniforms.uPix.value = pr; },
  };
}
