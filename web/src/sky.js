import * as THREE from 'three';

// Shared atmosphere uniforms. The same objects are plugged into the sky dome,
// every voxel material, the clouds and the wires, so one update per frame
// re-lights the whole city.
export const skyU = {
  uZenith: { value: new THREE.Color() },
  uSkyMid: { value: new THREE.Color() },
  uBand: { value: new THREE.Color() },
  uBandAnti: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uHorizonAnti: { value: new THREE.Color() },
  uSunGlow: { value: new THREE.Color() },
  uSunDir: { value: new THREE.Vector3(0.2, 0.03, -1).normalize() },
  uGlowStr: { value: 1 },
  uStars: { value: 0 },
  uTime: { value: 0 },
  uFogDensity: { value: 0.0016 },
  uFogHeight: { value: 0.006 },
  uCloudLit: { value: new THREE.Color() },
  uCloudShade: { value: new THREE.Color() },
  uCloudRim: { value: new THREE.Color() },
  uCloudSunDir: { value: new THREE.Vector3(0.2, -0.2, -1).normalize() },
};

// Sky gradient: horizon -> warm band -> violet mid -> deep blue zenith, with the
// horizon colour swinging from molten orange (toward the sun) to rose-violet
// (away from it). Reused as the fog colour so distant blocks melt into the sky.
export const SKY_GLSL = /* glsl */ `
uniform vec3 uZenith; uniform vec3 uSkyMid; uniform vec3 uBand; uniform vec3 uBandAnti;
uniform vec3 uHorizon; uniform vec3 uHorizonAnti; uniform vec3 uSunGlow; uniform vec3 uSunDir;
uniform float uGlowStr;
vec3 skyBase(vec3 d, out float t) {
  float y = d.y;
  vec2 hd = normalize(d.xz + vec2(1e-5));
  vec2 hs = normalize(uSunDir.xz + vec2(1e-5));
  float az = dot(hd, hs) * 0.5 + 0.5;
  float azS = pow(az, 2.6);
  vec3 hor = mix(uHorizonAnti, uHorizon, azS);
  vec3 band = mix(uBandAnti, uBand, pow(az, 1.6));
  t = clamp(y, 0.0, 1.0);
  float bh = mix(0.05, 0.16, azS);
  vec3 c = mix(hor, band, smoothstep(0.0, bh, t));
  c = mix(c, uSkyMid, smoothstep(bh * 0.7, bh + 0.17, t));
  c = mix(c, uZenith, smoothstep(0.12, 0.5, t));
  if (y < 0.0) c = mix(c, hor * 0.8, clamp(-y * 5.0, 0.0, 1.0));
  return c;
}
vec3 skyColor(vec3 d) {
  float t;
  vec3 c = skyBase(d, t);
  float sd = max(dot(d, uSunDir), 0.0);
  c += uSunGlow * (pow(sd, 40.0) * 0.9 + pow(sd, 10.0) * 0.26 + pow(sd, 3.0) * 0.03) * uGlowStr
       * (1.0 - smoothstep(0.0, 0.55, t) * 0.75);
  return c;
}
// Aerial-perspective colour: the violet/rose band of the sky, never the hot horizon.
vec3 fogColor(vec3 d) {
  float t;
  vec3 dd = normalize(vec3(d.x, 0.3, d.z));
  vec3 c = skyBase(dd, t);
  vec3 lo = skyBase(normalize(vec3(d.x, 0.06, d.z)), t);
  float sd = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
  c = mix(c, lo, 0.3 * pow(sd, 6.0));
  return c * vec3(0.7, 0.72, 0.86);
}
`;

export function createSky() {
  const geo = new THREE.SphereGeometry(4500, 64, 32);
  const mat = new THREE.ShaderMaterial({
    uniforms: skyU,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      uniform float uStars; uniform float uTime;
      varying vec3 vDir;
      float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        // sun disc (only visible when the sun is above the horizon)
        float sd = dot(d, uSunDir);
        c += uSunGlow * smoothstep(0.99955, 0.9998, sd) * 6.0 * step(0.0, uSunDir.y + 0.01);
        if (uStars > 0.001 && d.y > 0.0) {
          vec3 g = floor(d * 420.0);
          float h = h13(g);
          float tw = 0.6 + 0.4 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
          float s = step(0.9965, h) * tw * smoothstep(0.02, 0.35, d.y);
          c += vec3(0.85, 0.9, 1.0) * s * uStars * 2.2;
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// Time-of-day keyframes. t=0.38 is the reference painting.
// ---------------------------------------------------------------------------
const K = [
  {
    t: 0.0, name: 'Golden hour',
    zenith: '#4467c8', mid: '#9c8fe0', band: '#ffc08a', bandAnti: '#d7a6d6',
    horizon: ['#ffe08a', 1.3], horizonAnti: '#efb3c9', sunGlow: ['#ffb54d', 1.0], glow: 1.1,
    sunElev: 6, sunInt: 3.4, sunColor: '#ffbd7a', hemiSky: '#a9b0f2', hemiGround: '#6a4a40', hemiInt: 1.45,
    fill: 0.45, fog: 0.0014,
    cloudLit: ['#ffd2a6', 1.2], cloudShade: '#8f80c8', cloudRim: '#fff0c0', cloudSunY: 0.1,
    windows: 0.45, lamp: 0.5, neon: 0.7, tower: 0.75, sakura: 0.12, stars: 0, exposure: 1.0, bloom: 0.55,
  },
  {
    t: 0.38, name: 'Sunset',
    zenith: '#2440c4', mid: '#6a52d6', band: '#ff7088', bandAnti: '#b062c4',
    horizon: ['#ffaa3c', 1.7], horizonAnti: '#d27ab9', sunGlow: ['#ff8a3a', 1.0], glow: 1.0,
    sunElev: 1.5, sunInt: 2.1, sunColor: '#ff9a5c', hemiSky: '#8f88ec', hemiGround: '#6a3a4c', hemiInt: 1.45,
    fill: 0.6, fog: 0.00118,
    cloudLit: ['#ff9a8a', 1.35], cloudShade: '#5c43a6', cloudRim: '#ffc070', cloudSunY: -0.45,
    windows: 1.0, lamp: 1.0, neon: 1.0, tower: 1.0, sakura: 0.22, stars: 0, exposure: 1.0, bloom: 0.8,
  },
  {
    t: 0.7, name: 'Blue hour',
    zenith: '#151c66', mid: '#363a9e', band: '#a463ad', bandAnti: '#56489e',
    horizon: ['#ff8a5c', 1.0], horizonAnti: '#6a58aa', sunGlow: ['#ff5a4a', 0.6], glow: 0.8,
    sunElev: -3, sunInt: 0.55, sunColor: '#ff7a8a', hemiSky: '#5058c0', hemiGround: '#2c1a38', hemiInt: 0.95,
    fill: 0.4, fog: 0.0017,
    cloudLit: '#c06aa0', cloudShade: '#3a3480', cloudRim: '#ff9a80', cloudSunY: -0.35,
    windows: 1.25, lamp: 1.35, neon: 1.3, tower: 1.25, sakura: 0.3, stars: 0.25, exposure: 1.05, bloom: 0.95,
  },
  {
    t: 1.0, name: 'Night',
    zenith: '#05081f', mid: '#11164a', band: '#2a2766', bandAnti: '#161948',
    horizon: ['#6a3c74', 1.0], horizonAnti: '#2a2862', sunGlow: ['#000000', 0], glow: 0,
    sunElev: -12, sunInt: 0.35, sunColor: '#8ea4ff', hemiSky: '#2c3478', hemiGround: '#1c1028', hemiInt: 0.6,
    fill: 0.3, fog: 0.0019,
    cloudLit: '#3a3a7a', cloudShade: '#141638', cloudRim: '#5a4a8a', cloudSunY: -0.2,
    windows: 1.4, lamp: 1.65, neon: 1.55, tower: 1.45, sakura: 0.32, stars: 1, exposure: 1.1, bloom: 1.05,
  },
];
export const TIME_KEYS = K.map((k) => ({ t: k.t, name: k.name }));
export const DEFAULT_TIME = 0.38;

const tmpA = new THREE.Color(), tmpB = new THREE.Color();
function col(v) {
  if (Array.isArray(v)) return new THREE.Color(v[0]).multiplyScalar(v[1]);
  return new THREE.Color(v);
}
const KC = K.map((k) => {
  const o = {};
  for (const [key, v] of Object.entries(k)) {
    o[key] = (typeof v === 'string' && v.startsWith('#')) || Array.isArray(v) ? col(v) : v;
  }
  return o;
});

// Returns an interpolated environment state for t in [0,1].
export function sampleTime(t) {
  t = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < KC.length - 2 && t > KC[i + 1].t) i++;
  const a = KC[i], b = KC[i + 1];
  const f = THREE.MathUtils.smoothstep((t - a.t) / (b.t - a.t), 0, 1);
  const o = {};
  for (const key of Object.keys(a)) {
    const va = a[key], vb = b[key];
    if (va instanceof THREE.Color) o[key] = va.clone().lerp(vb, f);
    else if (typeof va === 'number') o[key] = va + (vb - va) * f;
    else o[key] = f < 0.5 ? va : vb;
  }
  return o;
}

// Sun azimuth: low behind Tokyo Tower, slightly right of the street axis.
const SUN_AZ = new THREE.Vector3(0.36, 0, -1).normalize();
export function sunDirection(elevDeg, out = new THREE.Vector3()) {
  const e = THREE.MathUtils.degToRad(elevDeg);
  return out.set(SUN_AZ.x * Math.cos(e), Math.sin(e), SUN_AZ.z * Math.cos(e)).normalize();
}

export function applyEnv(env) {
  skyU.uZenith.value.copy(env.zenith);
  skyU.uSkyMid.value.copy(env.mid);
  skyU.uBand.value.copy(env.band);
  skyU.uBandAnti.value.copy(env.bandAnti);
  skyU.uHorizon.value.copy(env.horizon);
  skyU.uHorizonAnti.value.copy(env.horizonAnti);
  skyU.uSunGlow.value.copy(env.sunGlow);
  skyU.uGlowStr.value = env.glow;
  sunDirection(env.sunElev, skyU.uSunDir.value);
  skyU.uStars.value = env.stars;
  skyU.uFogDensity.value = env.fog;
  skyU.uCloudLit.value.copy(env.cloudLit);
  skyU.uCloudShade.value.copy(env.cloudShade);
  skyU.uCloudRim.value.copy(env.cloudRim);
  const sd = skyU.uSunDir.value;
  skyU.uCloudSunDir.value.set(sd.x, env.cloudSunY, sd.z).normalize();
}
