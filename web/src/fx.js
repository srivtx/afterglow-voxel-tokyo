import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// ---------------------------------------------------------------------------
// Falling flakes: tiny tumbling voxel bits, fully animated on the GPU inside a
// box that travels with the camera. One system, four looks (FLAKE_MODES):
// sakura petals, autumn leaves, snow and summer fireflies.
// ---------------------------------------------------------------------------
export const FLAKE_MODES = {
  petals: { label: 'Petals', a: [1, 0.36, 0.58], b: [1, 0.62, 0.78], shape: [1, 1, 1], scale: 0.55, fall: 1, swirl: 1, spin: 1, amount: 1, blink: 0, bob: 0 },
  leaves: { label: 'Leaves', a: [0.85, 0.2, 0.06], b: [1.0, 0.6, 0.1], shape: [1.3, 1.2, 1.3], scale: 0.72, fall: 0.7, swirl: 1.4, spin: 0.7, amount: 0.42, blink: 0, bob: 0 },
  snow: { label: 'Snow', a: [0.86, 0.9, 1.0], b: [1, 1, 1], shape: [0.55, 3.0, 0.75], scale: 0.62, fall: 0.5, swirl: 1.5, spin: 0.25, amount: 1, blink: 0, bob: 0 },
  fireflies: { label: 'Fireflies', a: [0.55, 1.0, 0.25], b: [0.95, 1.0, 0.45], shape: [0.45, 2.4, 0.6], scale: 0.42, fall: 0, swirl: 0.7, spin: 0, amount: 0.09, blink: 1, bob: 1.5 },
};
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
    uScale: { value: 0.55 }, uColA: { value: new THREE.Color(1, 0.36, 0.58) }, uColB: { value: new THREE.Color(1, 0.62, 0.78) },
    uShape: { value: new THREE.Vector3(1, 1, 1) }, uFall: { value: 1 }, uSwirl: { value: 1 }, uSpin: { value: 1 },
    uAmount: { value: 1 }, uBlink: { value: 0 }, uBob: { value: 0 }, uFade: { value: 1 },
  };
  const setMode = (name) => {
    const m = FLAKE_MODES[name];
    uniforms.uColA.value.setRGB(...m.a); uniforms.uColB.value.setRGB(...m.b);
    uniforms.uShape.value.set(...m.shape); uniforms.uScale.value = m.scale;
    uniforms.uFall.value = m.fall; uniforms.uSwirl.value = m.swirl; uniforms.uSpin.value = m.spin;
    uniforms.uAmount.value = m.amount; uniforms.uBlink.value = m.blink; uniforms.uBob.value = m.bob;
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec3 uWind; uniform float uScale;
      uniform vec3 uShape; uniform float uFall; uniform float uSwirl; uniform float uSpin; uniform float uAmount; uniform float uBob; uniform float uFade;
      varying vec3 vN; varying float vS; varying float vFade; varying float vBl;
      mat3 rot(vec3 a) {
        float cx = cos(a.x), sx = sin(a.x), cy = cos(a.y), sy = sin(a.y), cz = cos(a.z), sz = sin(a.z);
        return mat3(cy*cz, cy*sz, -sy, sx*sy*cz - cx*sz, sx*sy*sz + cx*cz, sx*cy, cx*sy*cz + sx*sz, cx*sy*sz - sx*cz, cx*cy);
      }
      void main() {
        vec3 b = aSeed.xyz * uBox;
        float sp = 0.6 + aSeed.w * 0.9;
        vec3 vel = vec3(uWind.x * sp * mix(0.15, 1.0, uFall), (-1.5 - aSeed.w * 1.3) * uFall, uWind.z * sp * mix(0.15, 1.0, uFall));
        vec3 p = b + vel * uTime;
        p.x += sin(uTime * 0.8 + aSeed.w * 31.0) * 2.6 * uSwirl;
        p.z += cos(uTime * 0.6 + aSeed.y * 23.0) * 2.0 * uSwirl;
        p.y += sin(uTime * 0.45 + aSeed.x * 17.0) * uBob;
        float on = step(fract(aSeed.x * 7.13 + aSeed.z * 3.1), uAmount) * uFade;
        vBl = pow(max(sin(uTime * (1.2 + aSeed.z * 1.7) + aSeed.y * 40.0), 0.0), 6.0);
        vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
        float d = length(rel);
        vFade = smoothstep(uBox.x * 0.5, uBox.x * 0.25, d) * smoothstep(4.0, 14.0, d);
        mat3 R = rot(vec3(uTime * (1.0 + aSeed.x * 2.5), uTime * (0.6 + aSeed.y * 1.8), uTime * (0.4 + aSeed.z)) * uSpin + aSeed.xyz * 6.28);
        vec3 lp = R * (position * uShape) * (0.75 + aSeed.w * 0.9) * vFade * uScale * on;
        vN = R * normal;
        vS = aSeed.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(uCam + rel + lp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint; uniform float uEm; uniform vec3 uColA; uniform vec3 uColB; uniform float uBlink;
      varying vec3 vN; varying float vS; varying float vFade; varying float vBl;
      void main() {
        vec3 c = mix(uColA, uColB, vS);
        float l = 0.55 + 0.45 * abs(normalize(vN).y);
        vec3 col = c * (0.35 + uTint * l * 0.6 + uEm);
        col = mix(col, c * (0.25 + vBl * 9.0), uBlink);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return { mesh, uniforms, setMode };
}

// ---------------------------------------------------------------------------
// Rain: camera-following streaks, stretched along the fall direction and
// widened with distance so they stay about a pixel thick.
// ---------------------------------------------------------------------------
export function createRain(count = 9000) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = count;
  const uniforms = {
    uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(110, 70, 110) },
    uVel: { value: new THREE.Vector3(-4, -62, 7) }, uTint: { value: new THREE.Color(0.5, 0.55, 0.75) }, uAmount: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec3 uVel; uniform float uAmount;
      varying float vA; varying float vV;
      void main() {
        vec3 p = aSeed.xyz * uBox + uVel * uTime * (0.85 + aSeed.w * 0.3);
        vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
        vec3 wp = uCam + rel;
        float d = length(rel);
        vec3 dir = normalize(uVel);
        vec3 side = normalize(cross(dir, normalize(uCam - wp)));
        float len = 1.4 + aSeed.w * 1.6;
        vA = smoothstep(uBox.x * 0.5, uBox.x * 0.18, d) * smoothstep(1.0, 4.0, d) * step(aSeed.w, uAmount);
        vV = position.y + 0.5;
        vec3 pos = wp + dir * position.y * len + side * position.x * (0.025 + d * 0.0016);
        gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint;
      varying float vA; varying float vV;
      void main() {
        gl_FragColor = vec4(uTint * vA * (0.15 + 0.85 * vV) * 0.55, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.visible = false;
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

// ---------------------------------------------------------------------------
// 墨 Ink: anime-style outlines from depth silhouettes + soft cel banding.
// Sits before bloom so the lines never glow.
// ---------------------------------------------------------------------------
const InkShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.5 }, uFar: { value: 12000 }, uInk: { value: new THREE.Color(0.05, 0.025, 0.1) },
    uWidth: { value: 1.2 }, uBands: { value: 1.0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 uRes; uniform float uNear; uniform float uFar;
    uniform vec3 uInk; uniform float uWidth; uniform float uBands;
    varying vec2 vUv;
    float lin(vec2 uv) { float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
    void main() {
      // clamp first: the sun disc can be +inf in half float, and inf - inf in the
      // banding below would make NaNs that bloom smears over the whole frame
      vec3 c = min(texture2D(tDiffuse, vUv).rgb, vec3(6.0e4));
      vec2 px = uWidth / uRes;
      float d0 = lin(vUv);
      float dl = lin(vUv - vec2(px.x, 0.0)), dr = lin(vUv + vec2(px.x, 0.0));
      float du = lin(vUv + vec2(0.0, px.y)), dd = lin(vUv - vec2(0.0, px.y));
      float dmax = max(max(dl, dr), max(du, dd));
      float sil = smoothstep(0.015, 0.05, (dmax - d0) / d0);
      // creases: second derivative of depth across the pixel
      float cr = (abs(dl + dr - 2.0 * d0) + abs(du + dd - 2.0 * d0)) / d0;
      float crease = smoothstep(0.012, 0.04, cr) * 0.55;
      float line = max(sil, crease) * (1.0 - smoothstep(260.0, 950.0, d0)) * step(d0, uFar * 0.9);
      // cel banding in log-luminance, keeping hue
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float ll = log2(max(l, 0.0) + 1e-4);
      float q = floor(ll * 1.6 + 0.5) / 1.6;
      float band = mix(ll, q, 0.65 * smoothstep(-9.0, -5.0, ll));
      c *= mix(1.0, exp2(band - ll), uBands);
      c = mix(c, uInk * (0.4 + l * 0.2), line * 0.9);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

class InkPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.material = new THREE.ShaderMaterial({ ...InkShader, uniforms: THREE.UniformsUtils.clone(InkShader.uniforms), depthTest: false, depthWrite: false });
    this.fsQuad = new FullScreenQuad(this.material);
    this.enabled = false;
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    u.uNear.value = this.camera.near; u.uFar.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
}

export function createPost(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(size.x, size.y) });
  const composer = new EffectComposer(renderer, rt);
  // the composer clones rt, and a cloned DepthTexture shares its Source -> the
  // same GL texture in both buffers (a feedback loop for the ink pass)
  composer.renderTarget2.depthTexture = new THREE.DepthTexture(size.x, size.y);
  composer.addPass(new RenderPass(scene, camera));
  const ink = new InkPass(camera);
  composer.addPass(ink);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.8, 0.55, 1.0);
  // Soft-knee threshold: bloom only the light *above* the threshold (on the
  // brightest channel), not the whole pixel. The stock pass blooms a pixel's
  // full colour once its luminance passes, so a big sign seen up close floods
  // its own panel and the lettering drowns; this keeps halos around the tubes.
  bloom.materialHighPassFilter.fragmentShader = /* glsl */ `
    uniform sampler2D tDiffuse; uniform float luminosityThreshold;
    varying vec2 vUv;
    void main() {
      vec3 c = min(texture2D(tDiffuse, vUv).rgb, vec3(6e4));
      // one NaN pixel would be smeared over the whole frame by the blur: drop it
      if (any(isnan(c))) c = vec3(0.0);
      float br = max(max(c.r, c.g), c.b);
      float knee = luminosityThreshold * 0.5;
      float rq = clamp(br - luminosityThreshold + knee, 0.0, 2.0 * knee);
      rq = rq * rq / (4.0 * knee + 1e-4);
      gl_FragColor = vec4(c * max(rq, br - luminosityThreshold) / max(br, 1e-4), 1.0);
    }`;
  bloom.materialHighPassFilter.needsUpdate = true;
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
    // depth textures use immutable storage: free them so they re-allocate at the new size
    for (const t of [composer.renderTarget1, composer.renderTarget2]) {
      const d = t.depthTexture;
      if (d.image.width !== t.width || d.image.height !== t.height) { d.image.width = t.width; d.image.height = t.height; d.dispose(); }
    }

    const W = w * pr, H = h * pr;
    grade.uniforms.uRes.value.set(W, H);
    tiltH.uniforms.uRes.value.set(W, H); tiltV.uniforms.uRes.value.set(W, H);
    ink.material.uniforms.uRes.value.set(W, H);
    ink.material.uniforms.uWidth.value = Math.max(1.25, pr * 1.05);
  };
  return { composer, bloom, tiltH, tiltV, grade, ink, setSize };
}
