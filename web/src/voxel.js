import * as THREE from 'three';
import { SKY_GLSL, skyU, atmosU } from './sky.js';
import { hash3 } from './rng.js';

// ---------------------------------------------------------------------------
// Chunked sparse voxel storage
// ---------------------------------------------------------------------------
export const CB = 6, CS = 1 << CB, CM = CS - 1;
const CS3 = CS * CS * CS;
const P = CS + 2, P2 = P * P;

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export class Palette {
  constructor() { this.list = [null]; this.map = Object.create(null); }
  // o.em: emissive strength, o.j: brightness jitter, o.grp: emissive group, o.ao: AO strength
  add(name, hex, o = {}) {
    if (this.map[name] !== undefined) return this.map[name];
    const id = this.list.length;
    if (id > 255) throw new Error('palette full');
    const n = parseInt(hex.slice(1), 16);
    const s = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    this.list.push({
      name, s, l: s.map(toLin),
      em: o.em || 0, j: o.j ?? 0.06, grp: o.grp ?? 2, ao: o.ao ?? (o.em >= 1 ? 0 : 1), cls: (o.cls || 0) << 4,
    });
    this.map[name] = id;
    return id;
  }
  id(name) {
    const i = this.map[name];
    if (i === undefined) throw new Error('unknown palette entry ' + name);
    return i;
  }
}

export class VoxelWorld {
  constructor(pal, scale = 1, name = 'world') {
    this.pal = pal; this.scale = scale; this.name = name;
    this.chunks = new Map();
    this.lights = [];
    this._sk = -1; this._sc = null; this._gk = -1; this._gc = null;
  }
  static key(cx, cy, cz) { return (cx + 512) * 1048576 + (cy + 512) * 1024 + (cz + 512); }

  set(x, y, z, m) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0) return;
    const cx = x >> CB, cy = y >> CB, cz = z >> CB;
    const k = VoxelWorld.key(cx, cy, cz);
    let c;
    if (k === this._sk) c = this._sc;
    else {
      c = this.chunks.get(k);
      if (!c) {
        if (!m) return;
        c = { cx, cy, cz, d: new Uint8Array(CS3), y0: CS, y1: -1 };
        this.chunks.set(k, c);
      }
      this._sk = k; this._sc = c;
    }
    const ly = y & CM;
    c.d[(x & CM) | (ly << CB) | ((z & CM) << (2 * CB))] = m;
    if (m) { if (ly < c.y0) c.y0 = ly; if (ly > c.y1) c.y1 = ly; }
  }

  get(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0) return 0;
    const k = VoxelWorld.key(x >> CB, y >> CB, z >> CB);
    let c;
    if (k === this._gk) c = this._gc;
    else { c = this.chunks.get(k); this._gk = k; this._gc = c; }
    return c ? c.d[(x & CM) | ((y & CM) << CB) | ((z & CM) << (2 * CB))] : 0;
  }

  put(x, y, z, m) { if (!this.get(x, y, z)) this.set(x, y, z, m); }

  // Inclusive box. m: palette id, or fn(x,y,z) -> id | undefined (skip)
  box(x0, y0, z0, x1, y1, z1, m) {
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (y0 > y1) [y0, y1] = [y1, y0];
    if (z0 > z1) [z0, z1] = [z1, z0];
    const fn = typeof m === 'function';
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const v = fn ? m(x, y, z) : m;
          if (v !== undefined && v !== null) this.set(x, y, z, v);
        }
  }

  line(x0, y0, z0, x1, y1, z1, m, r = 0) {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)) * 1.5) + 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, z = z0 + (z1 - z0) * t;
      if (r <= 0) this.set(Math.round(x), Math.round(y), Math.round(z), m);
      else this.box(Math.round(x - r), Math.round(y - r), Math.round(z - r), Math.round(x + r), Math.round(y + r), Math.round(z + r), m);
    }
  }

  // Baked point light (voxel coords of this world). Colour hex is sRGB.
  light(x, y, z, hex, intensity, radius) {
    const n = parseInt(hex.slice(1), 16);
    this.lights.push({
      x, y, z, R: radius,
      r: toLin(((n >> 16) & 255) / 255) * intensity,
      g: toLin(((n >> 8) & 255) / 255) * intensity,
      b: toLin((n & 255) / 255) * intensity,
    });
  }
}

// ---------------------------------------------------------------------------
// Mesher: face culling + per-vertex ambient occlusion + baked light spill.
// Attributes are tightly packed (uint8 positions/colours, int8 normals).
// ---------------------------------------------------------------------------
const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const FACE_DEFS = [
  { n: [1, 0, 0], u: 1, v: 2 }, { n: [-1, 0, 0], u: 2, v: 1 },
  { n: [0, 1, 0], u: 2, v: 0 }, { n: [0, -1, 0], u: 0, v: 2 },
  { n: [0, 0, 1], u: 0, v: 1 }, { n: [0, 0, -1], u: 1, v: 0 },
];
const off = (v) => v[0] + v[1] * P + v[2] * P2;
const FACES = FACE_DEFS.map((f) => {
  const n = f.n, u = AXES[f.u], v = AXES[f.v];
  const base = n.map((c) => (c > 0 ? 1 : 0));
  const nOff = off(n);
  const corners = [], ao = [];
  const cuv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const [cu, cv] of cuv) {
    corners.push([0, 1, 2].map((i) => base[i] + (cu ? u[i] : 0) + (cv ? v[i] : 0)));
    const su = u.map((c) => (cu ? c : -c)), sv = v.map((c) => (cv ? c : -c));
    ao.push([nOff + off(su), nOff + off(sv), nOff + off(su) + off(sv)]);
  }
  return { n, nOff, corners, ao };
});
const AO_CURVE = [1.0, 0.8, 0.64, 0.5];

let cap = 0, sPos, sNrm, sCol, sBake, sGrp, sIdx;
function ensure(faces) {
  if (faces <= cap) return;
  cap = Math.max(faces, cap * 2, 65536);
  const g = (T, n) => new T(n);
  const np = sPos, nn = sNrm, nc = sCol, nb = sBake, ng = sGrp, ni = sIdx;
  sPos = g(Uint8Array, cap * 12); sNrm = g(Int8Array, cap * 12); sCol = g(Uint8Array, cap * 12);
  sBake = g(Uint8Array, cap * 12); sGrp = g(Uint8Array, cap * 4); sIdx = g(Uint32Array, cap * 6);
  if (np) { sPos.set(np); sNrm.set(nn); sCol.set(nc); sBake.set(nb); sGrp.set(ng); sIdx.set(ni); }
}
ensure(200000);

const pad = new Uint8Array(P * P * P);

function fillPad(world, c) {
  const nb = new Array(27);
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const ch = world.chunks.get(VoxelWorld.key(c.cx + dx, c.cy + dy, c.cz + dz));
        nb[dx + 1 + (dy + 1) * 3 + (dz + 1) * 9] = ch ? ch.d : null;
      }
  const d = c.d;
  for (let z = 0; z < CS; z++)
    for (let y = 0; y < CS; y++) {
      const src = (y << CB) | (z << (2 * CB));
      pad.set(d.subarray(src, src + CS), 1 + (y + 1) * P + (z + 1) * P2);
    }
  const border = (px, py, pz) => {
    const lx = px - 1, ly = py - 1, lz = pz - 1;
    const ox = lx < 0 ? -1 : lx > CM ? 1 : 0, oy = ly < 0 ? -1 : ly > CM ? 1 : 0, oz = lz < 0 ? -1 : lz > CM ? 1 : 0;
    const arr = nb[ox + 1 + (oy + 1) * 3 + (oz + 1) * 9];
    pad[px + py * P + pz * P2] = arr ? arr[(lx & CM) | ((ly & CM) << CB) | ((lz & CM) << (2 * CB))] : 0;
  };
  for (let pz = 0; pz < P; pz++) {
    const zEdge = pz === 0 || pz === P - 1;
    for (let py = 0; py < P; py++) {
      if (zEdge || py === 0 || py === P - 1) { for (let px = 0; px < P; px++) border(px, py, pz); }
      else { border(0, py, pz); border(P - 1, py, pz); }
    }
  }
}

function meshChunk(world, c) {
  fillPad(world, c);
  const pal = world.pal.list;
  const ox = c.cx * CS, oy = c.cy * CS, oz = c.cz * CS;
  // lights touching this chunk
  const L = [];
  for (const l of world.lights) {
    const cxm = Math.max(ox, Math.min(l.x, ox + CS)), cym = Math.max(oy, Math.min(l.y, oy + CS)), czm = Math.max(oz, Math.min(l.z, oz + CS));
    const dx = l.x - cxm, dy = l.y - cym, dz = l.z - czm;
    if (dx * dx + dy * dy + dz * dz < l.R * l.R) L.push(l);
  }
  let f = 0;
  const y0 = Math.max(0, c.y0), y1 = Math.min(CM, c.y1);
  for (let z = 0; z < CS; z++) {
    for (let y = y0; y <= y1; y++) {
      let i = 1 + (y + 1) * P + (z + 1) * P2;
      for (let x = 0; x < CS; x++, i++) {
        const m = pad[i];
        if (!m) continue;
        const e = pal[m];
        const wx = ox + x, wy = oy + y, wz = oz + z;
        const jf = 1 + (hash3(wx, wy, wz) - 0.5) * 2 * e.j;
        for (let fi = 0; fi < 6; fi++) {
          const F = FACES[fi];
          if (pad[i + F.nOff]) continue;
          ensure(f + 1);
          const n = F.n;
          // light spill at the face centre
          let lr = 0, lg = 0, lb = 0;
          if (!e.em && L.length) {
            const fx = wx + 0.5 + n[0] * 0.55, fy = wy + 0.5 + n[1] * 0.55, fz = wz + 0.5 + n[2] * 0.55;
            for (let k = 0; k < L.length; k++) {
              const l = L[k];
              const dx = l.x - fx, dy = l.y - fy, dz = l.z - fz;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 >= l.R * l.R) continue;
              const d = Math.sqrt(d2) + 1e-4;
              const ndl = (dx * n[0] + dy * n[1] + dz * n[2]) / d;
              if (ndl <= -0.1) continue;
              const a = 1 - d / l.R;
              const w = a * a * (Math.max(ndl, 0) * 0.85 + 0.15);
              lr += l.r * w; lg += l.g * w; lb += l.b * w;
            }
          }
          const vb = f * 4;
          let aoSum02 = 0, aoSum13 = 0;
          for (let k = 0; k < 4; k++) {
            const A = F.ao[k];
            const s1 = pad[i + A[0]] ? 1 : 0, s2 = pad[i + A[1]] ? 1 : 0, cc = pad[i + A[2]] ? 1 : 0;
            const occ = s1 && s2 ? 3 : s1 + s2 + cc;
            const ao = 1 - (1 - AO_CURVE[occ]) * e.ao;
            if (k === 0 || k === 2) aoSum02 += ao; else aoSum13 += ao;
            const cr = F.corners[k];
            const vi = (vb + k) * 3;
            sPos[vi] = x + cr[0]; sPos[vi + 1] = y + cr[1]; sPos[vi + 2] = z + cr[2];
            sNrm[vi] = n[0] * 127; sNrm[vi + 1] = n[1] * 127; sNrm[vi + 2] = n[2] * 127;
            const glowOnly = e.em >= 1;
            const cm = glowOnly ? 0.3 : jf * ao;
            sCol[vi] = Math.min(255, e.s[0] * cm * 255); sCol[vi + 1] = Math.min(255, e.s[1] * cm * 255); sCol[vi + 2] = Math.min(255, e.s[2] * cm * 255);
            let br, bg, bb;
            if (e.em) { const q = e.em * jf * (glowOnly ? 1 : ao); br = e.l[0] * q; bg = e.l[1] * q; bb = e.l[2] * q; sGrp[vb + k] = e.grp | e.cls; }
            else { const q = jf * ao; br = e.l[0] * lr * q; bg = e.l[1] * lg * q; bb = e.l[2] * lb * q; sGrp[vb + k] = 1 | e.cls; }
            // sqrt encoding keeps precision in the dark range (decode: v*v*16)
            sBake[vi] = Math.sqrt(Math.min(br / 16, 1)) * 255;
            sBake[vi + 1] = Math.sqrt(Math.min(bg / 16, 1)) * 255;
            sBake[vi + 2] = Math.sqrt(Math.min(bb / 16, 1)) * 255;
          }
          const ii = f * 6;
          if (aoSum02 < aoSum13) {
            sIdx[ii] = vb + 1; sIdx[ii + 1] = vb + 2; sIdx[ii + 2] = vb + 3;
            sIdx[ii + 3] = vb + 1; sIdx[ii + 4] = vb + 3; sIdx[ii + 5] = vb;
          } else {
            sIdx[ii] = vb; sIdx[ii + 1] = vb + 1; sIdx[ii + 2] = vb + 2;
            sIdx[ii + 3] = vb; sIdx[ii + 4] = vb + 2; sIdx[ii + 5] = vb + 3;
          }
          f++;
        }
      }
    }
  }
  if (!f) return null;
  const g = new THREE.BufferGeometry();
  const free = function () { this.array = null; };
  const attr = (arr, size, norm) => new THREE.BufferAttribute(arr, size, norm).onUpload(free);
  g.setAttribute('position', attr(sPos.slice(0, f * 12), 3, false));
  g.setAttribute('normal', attr(sNrm.slice(0, f * 12), 3, true));
  g.setAttribute('color', attr(sCol.slice(0, f * 12), 3, true));
  g.setAttribute('bake', attr(sBake.slice(0, f * 12), 3, true));
  g.setAttribute('grp', attr(sGrp.slice(0, f * 4), 1, false));
  const nv = f * 4;
  const idx = nv > 65535 ? sIdx.slice(0, f * 6) : Uint16Array.from(sIdx.subarray(0, f * 6));
  g.setIndex(attr(idx, 1, false));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(CS / 2, (y0 + y1 + 1) / 2, CS / 2), Math.sqrt(2 * (CS / 2) ** 2 + ((y1 - y0 + 1) / 2) ** 2) + 1);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(0, y0, 0), new THREE.Vector3(CS, y1 + 1, CS));
  return { geo: g, faces: f };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// Meshes every chunk of a world into `group`. Yields to keep the loader alive.
export async function meshWorld(world, material, group, { shadows = false, receive = true, onProgress, freeData = false } = {}) {
  const chunks = [...world.chunks.values()].filter((c) => c.y1 >= 0);
  let t0 = performance.now(), faces = 0, done = 0;
  for (const c of chunks) {
    const r = meshChunk(world, c);
    if (r) {
      const mesh = new THREE.Mesh(r.geo, material);
      mesh.position.set(c.cx * CS * world.scale, c.cy * CS * world.scale, c.cz * CS * world.scale);
      mesh.scale.setScalar(world.scale);
      mesh.castShadow = shadows; mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      group.add(mesh);
      faces += r.faces;
    }
    done++;
    if (performance.now() - t0 > 40) { onProgress?.(done / chunks.length); await tick(); t0 = performance.now(); }
  }
  if (freeData) world.chunks.clear();
  return faces;
}

// Meshes a small model (must fit inside chunk 0,0,0) into one geometry.
export function meshModel(world) {
  const c = world.chunks.get(VoxelWorld.key(0, 0, 0));
  if (world.chunks.size !== 1 || !c) throw new Error('model must fit in one chunk');
  return meshChunk(world, c).geo;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
export const emissiveGroups = { value: new Float32Array(16).fill(1) };
// Neon soft knee: luminance above `x` is compressed toward `x + y`, keeping the
// hue. Bright tubes (white, yellow, cyan, green) stop clipping to a white blob
// and flooding the bloom, so the strokes of a sign stay readable at night.
export const glowKnee = { value: new THREE.Vector2(1.1, 0.9) };

const FOG_GLSL = /* glsl */ `
  {
    vec3 fv = vWPos - cameraPosition;
    float fd = length(fv);
    vec3 fdir = fv / max(fd, 1e-3);
    float hm = max(0.5 * (vWPos.y + cameraPosition.y), 0.0);
    float dens = uFogDensity * (0.4 + 0.6 * exp(-hm * uFogHeight));
    float fogAmt = 1.0 - exp(-fd * dens);
    vec3 fcol = mix(fogColor(fdir), skyColor(normalize(vec3(fdir.x, 0.004, fdir.z))), smoothstep(1400.0, 4200.0, fd));
    float punch = vGlow * clamp(dot(vBakeOut, vec3(0.3, 0.59, 0.11)) * 0.18, 0.0, 0.6);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fcol, clamp(fogAmt * (1.0 - punch), 0.0, 1.0));
  }
`;

// Season recolour (vertex): foliage classes are re-tinted while keeping their
// baked AO / jitter, so a whole season is just a few uniforms.
const SEASON_VERT = /* glsl */ `
  #ifdef USE_COLOR
  if (cls > 0) {
    vec3 cell = floor(vWPos * 0.34);
    float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float h2 = fract(h * 13.7 + 0.31);
    float lum = dot(vColor, vec3(0.2126, 0.7152, 0.0722));
    vec3 tgt; float mx; float ref;
    if (cls == 1) { tgt = mix(uSak0, uSak1, h); mx = uSakMix; ref = 0.45; }
    else if (cls == 2) { tgt = mix(uLeaf0, uLeaf1, h); mx = uLeafMix * step(0.14, h2); ref = 0.15; }
    else if (cls == 3) { tgt = uGrass0 * (0.8 + 0.4 * h); mx = uGrassMix; ref = 0.16; }
    else { tgt = uMaple0; mx = uMapleMix; ref = 0.26; }
    vColor = mix(vColor, tgt * clamp(lum / ref, 0.3, 1.5), mx);
    if (cls == 1) vBakeOut = mix(vBakeOut, vec3(dot(vBakeOut, vec3(0.333))) * tgt * 2.2, mx);
  }
  #endif
`;

const ATMOS_FRAG_DECL = /* glsl */ `
  varying vec3 vWN;
  uniform float uTime; uniform float uWet; uniform float uRain; uniform float uSnow;
  uniform sampler2D uRefl; uniform mat4 uReflMat; uniform float uReflOn; uniform float uReflY;
  float ah12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(ah12(i), ah12(i + vec2(1, 0)), f.x), mix(ah12(i + vec2(0, 1)), ah12(i + vec2(1, 1)), f.x), f.y);
  }
  // expanding raindrop rings -> normal offset
  vec2 ripple(vec2 p, float t) {
    vec2 c = floor(p); vec2 f = fract(p) - 0.5;
    float h = ah12(c);
    float ph = fract(t * 0.85 + h * 7.0);
    vec2 o = (vec2(ah12(c + 3.7), ah12(c + 9.1)) - 0.5) * 0.3;
    vec2 d = f - o; float r = length(d);
    float w = exp(-pow((r - ph * 0.45) * 20.0, 2.0)) * (1.0 - ph) * step(0.25, h);
    return d / max(r, 1e-3) * w;
  }
`;

// snow cover + wet darkening (after the vertex colour is applied)
const ATMOS_COLOR = /* glsl */ `
  float upF = smoothstep(0.6, 0.95, vWN.y);
  float snowM = 0.0, wetM = 0.0, pudM = 0.0;
  vec2 vox = floor(vWPos.xz + 0.001);
  if (uSnow > 0.001 && vGlow < 0.5) {
    float n = vnoise(vox * 0.19) * 0.6 + vnoise(vox * 0.71) * 0.4;
    snowM = upF * smoothstep(0.0, 0.16, uSnow * 1.3 - (1.0 - n) * 0.6);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.88, 1.0) * (0.9 + 0.1 * n), snowM);
  }
  if (uWet > 0.001) {
    float pd = vnoise(vox * 0.075) * 0.65 + vnoise(vox * 0.26) * 0.35;
    float puddle = smoothstep(0.42, 0.6, pd);
    wetM = uWet * (upF * mix(0.55, 1.0, puddle) + (1.0 - upF) * 0.35) * (1.0 - snowM);
    pudM = uWet * upF * mix(0.4, 1.0, puddle) * (1.0 - vGlow) * (1.0 - snowM);
    diffuseColor.rgb *= 1.0 - 0.5 * wetM;
  }
`;

// mirror-like puddles: planar reflection near street level, sky elsewhere
const WET_GLSL = /* glsl */ `
  if (pudM > 0.002) {
    vec3 V = normalize(vWPos - cameraPosition);
    vec2 rip = uRain > 0.001 ? ripple(vWPos.xz * 1.3, uTime) * uRain : vec2(0.0);
    vec3 N = normalize(vec3(rip.x * 0.3, 1.0, rip.y * 0.3));
    vec3 R = reflect(V, N);
    float fres = 0.08 + 0.92 * pow(1.0 - max(dot(-V, N), 0.0), 4.0);
    vec3 refl = fogColor(R) * 0.5 + skyColor(normalize(vec3(R.x, max(R.y, 0.02), R.z))) * 0.2;
    if (uReflOn > 0.5) {
      vec4 rp = uReflMat * vec4(vWPos, 1.0);
      vec2 ruv = rp.xy / rp.w + rip * 0.014;
      float nearP = exp(-abs(vWPos.y - uReflY) * 0.5);
      float inside = step(0.0, ruv.x) * step(ruv.x, 1.0) * step(0.0, ruv.y) * step(ruv.y, 1.0);
      refl = mix(refl, texture2D(uRefl, clamp(ruv, 0.001, 0.999)).rgb, nearP * inside);
    }
    gl_FragColor.rgb += vBakeOut * pudM * 0.5;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, refl, clamp(fres * pudM, 0.0, 0.9));
  }
`;

export function makeVoxelMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, skyU, atmosU, { uGroups: emissiveGroups, uKnee: glowKnee });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 bake; attribute float grp;
        uniform float uGroups[16]; uniform vec2 uKnee;
        uniform vec3 uSak0; uniform vec3 uSak1; uniform float uSakMix;
        uniform vec3 uLeaf0; uniform vec3 uLeaf1; uniform float uLeafMix;
        uniform vec3 uGrass0; uniform float uGrassMix; uniform vec3 uMaple0; uniform float uMapleMix;
        varying vec3 vBakeOut; varying vec3 vWPos; varying float vGlow; varying vec3 vWN;`)
      .replace('#include <color_vertex>', `
        #ifdef USE_COLOR
          vColor = pow(color.rgb, vec3(2.2));
        #endif`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vec3 bk = bake * bake * 16.0;
        float gq = floor(grp + 0.5);
        float clsF = floor(gq / 16.0);
        int gi = int(gq - clsF * 16.0);
        int cls = int(clsF);
        vBakeOut = bk * uGroups[gi];
        if (gi >= 4 && gi <= 9) {
          float L = dot(vBakeOut, vec3(0.2126, 0.7152, 0.0722)), over = L - uKnee.x;
          if (over > 0.0) vBakeOut *= (uKnee.x + over / (1.0 + over / uKnee.y)) / L;
        }
        vGlow = gi > 1 && gi != 13 ? 1.0 : 0.0;
        vec4 wp4 = vec4(transformed, 1.0);
        mat3 im3 = mat3(1.0);
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4; im3 = mat3(instanceMatrix);
        #endif
        vWPos = (modelMatrix * wp4).xyz;
        vWN = normalize(mat3(modelMatrix) * im3 * objectNormal);
        ${SEASON_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBakeOut; varying vec3 vWPos; varying float vGlow;
        uniform float uFogDensity; uniform float uFogHeight;
        ${SKY_GLSL}
        ${ATMOS_FRAG_DECL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${ATMOS_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.14, pudM);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vBakeOut;`)
      .replace('#include <fog_fragment>', WET_GLSL + FOG_GLSL);
  };
  mat.customProgramCacheKey = () => 'voxel-v3';
  return mat;
}

// Unlit-ish flat material with the same atmospheric fog (wires, petals ground etc.)
export function makeFlatMaterial(hex, emissive = 0) {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex) });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, skyU, { uEm: { value: emissive } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; uniform float uFogDensity; uniform float uFogHeight; uniform float uEm;
        ${SKY_GLSL}
        #define vBakeOut vec3(uEm)
        #define vGlow 1.0`)
      .replace('#include <fog_fragment>', FOG_GLSL);
  };
  mat.customProgramCacheKey = () => 'flat-v1-' + emissive;
  return mat;
}

export function makeCloudMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: skyU,
    vertexColors: true,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vC; varying vec3 vW;
      void main() {
        vN = normalize(mat3(modelMatrix) * normal);
        vC = pow(color, vec3(2.2));
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      uniform vec3 uCloudLit; uniform vec3 uCloudShade; uniform vec3 uCloudRim; uniform vec3 uCloudSunDir;
      varying vec3 vN; varying vec3 vC; varying vec3 vW;
      void main() {
        vec3 n = normalize(vN);
        float sunF = dot(n, uCloudSunDir) * 0.5 + 0.5;
        float under = max(-n.y, 0.0);
        vec3 c = mix(uCloudShade, uCloudLit, smoothstep(0.35, 1.0, sunF + under * 0.25));
        vec3 vd = vW - cameraPosition;
        float dist = length(vd); vd /= dist;
        float sd = max(dot(vd, uSunDir), 0.0);
        // warm silver lining toward the sun + rose undersides
        c += uCloudRim * (pow(sd, 5.0) * 0.8 + under * 0.25) * smoothstep(0.2, 0.9, sunF);
        c *= mix(vec3(1.0), vC, 0.7);
        c = mix(c, fogColor(vd) * 1.1, clamp(dist / 9000.0, 0.0, 0.3));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}
