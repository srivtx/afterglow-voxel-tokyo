import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------------------
// Falling sakura petals: tiny tumbling voxel flakes, fully animated on the GPU
// inside a box that travels with the camera.
// ---------------------------------------------------------------------------
export function createPetals(count = 1900) {
  const base = new THREE.BoxGeometry(0.5, 0.09, 0.36);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('normal', base.attributes.normal);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = count;
  const uniforms = {
    uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(150, 90, 150) },
    uWind: { value: new THREE.Vector3(2.2, 0, -1.2) }, uTint: { value: new THREE.Color(1, 1, 1) }, uEm: { value: 0.2 },
    uScale: { value: 0.55 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec3 uWind; uniform float uScale;
      varying vec3 vN; varying float vS; varying float vFade;
      mat3 rot(vec3 a) {
        float cx = cos(a.x), sx = sin(a.x), cy = cos(a.y), sy = sin(a.y), cz = cos(a.z), sz = sin(a.z);
        return mat3(cy*cz, cy*sz, -sy, sx*sy*cz - cx*sz, sx*sy*sz + cx*cz, sx*cy, cx*sy*cz + sx*sz, cx*sy*sz - sx*cz, cx*cy);
      }
      void main() {
        vec3 b = aSeed.xyz * uBox;
        float sp = 0.6 + aSeed.w * 0.9;
        vec3 vel = vec3(uWind.x * sp, -1.5 - aSeed.w * 1.3, uWind.z * sp);
        vec3 p = b + vel * uTime;
        p.x += sin(uTime * 0.8 + aSeed.w * 31.0) * 2.6;
        p.z += cos(uTime * 0.6 + aSeed.y * 23.0) * 2.0;
        vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
        float d = length(rel);
        vFade = smoothstep(uBox.x * 0.5, uBox.x * 0.25, d) * smoothstep(4.0, 14.0, d);
        mat3 R = rot(vec3(uTime * (1.0 + aSeed.x * 2.5), uTime * (0.6 + aSeed.y * 1.8), uTime * (0.4 + aSeed.z)) + aSeed.xyz * 6.28);
        vec3 lp = R * position * (0.75 + aSeed.w * 0.9) * vFade * uScale;
        vN = R * normal;
        vS = aSeed.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(uCam + rel + lp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint; uniform float uEm;
      varying vec3 vN; varying float vS; varying float vFade;
      void main() {
        vec3 c = mix(vec3(1.0, 0.36, 0.58), vec3(1.0, 0.62, 0.78), vS);
        float l = 0.55 + 0.45 * abs(normalize(vN).y);
        gl_FragColor = vec4(c * (0.35 + uTint * l * 0.6 + uEm), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------
// Post: bloom -> optional tilt-shift (diorama) -> grade -> ACES output
// ---------------------------------------------------------------------------
const TiltShader = {
  uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uRes: { value: new THREE.Vector2(1, 1) }, uFocus: { value: 0.52 }, uBand: { value: 0.16 }, uAmount: { value: 2.4 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uDir; uniform vec2 uRes; uniform float uFocus; uniform float uBand; uniform float uAmount;
    varying vec2 vUv;
    void main() {
      float k = smoothstep(uBand, uBand + 0.32, abs(vUv.y - uFocus)) * uAmount;
      vec2 st = uDir / uRes * k;
      vec4 s = texture2D(tDiffuse, vUv) * 0.2270270270;
      s += (texture2D(tDiffuse, vUv + st * 1.3846153846) + texture2D(tDiffuse, vUv - st * 1.3846153846)) * 0.3162162162;
      s += (texture2D(tDiffuse, vUv + st * 3.2307692308) + texture2D(tDiffuse, vUv - st * 3.2307692308)) * 0.0702702703;
      gl_FragColor = s;
    }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
    uVignette: { value: 0.55 }, uGrain: { value: 0.035 }, uSat: { value: 1.24 }, uAberr: { value: 0.0012 },
    uShadow: { value: new THREE.Color(0.03, 0.012, 0.06) }, uHigh: { value: new THREE.Color(1.03, 0.99, 0.94) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime; uniform float uVignette; uniform float uGrain;
    uniform float uSat; uniform float uAberr; uniform vec3 uShadow; uniform vec3 uHigh;
    varying vec2 vUv;
    float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 d = vUv - 0.5;
      vec2 off = d * uAberr * length(d) * 4.0;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c += uShadow * (1.0 - smoothstep(0.0, 0.35, l));
      c *= mix(vec3(1.0), uHigh, smoothstep(0.4, 2.0, l));
      vec2 dv = d; dv.x *= uRes.x / uRes.y;
      c *= mix(1.0, smoothstep(1.05, 0.2, length(dv)), uVignette);
      c += (h12(vUv * uRes + fract(uTime) * 917.0) - 0.5) * uGrain * (0.25 + sqrt(max(l, 0.0)));
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.8, 0.55, 1.0);
  composer.addPass(bloom);
  const tiltH = new ShaderPass(TiltShader); tiltH.uniforms.uDir.value.set(1, 0);
  const tiltV = new ShaderPass(TiltShader); tiltV.uniforms.uDir.value.set(0, 1);
  tiltH.enabled = tiltV.enabled = false;
  composer.addPass(tiltH); composer.addPass(tiltV);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  const setSize = (w, h, pr) => {
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    const W = w * pr, H = h * pr;
    grade.uniforms.uRes.value.set(W, H);
    tiltH.uniforms.uRes.value.set(W, H); tiltV.uniforms.uRes.value.set(W, H);
  };
  return { composer, bloom, tiltH, tiltV, grade, setSize };
}
