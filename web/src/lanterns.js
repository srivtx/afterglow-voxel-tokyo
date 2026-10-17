import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 灯籠 Sky lanterns: paper lanterns released from the old street, the shrine
// approach and the pagoda hill. They lift off slowly, sway, and ride the
// evening air out over the skyline toward the bay. One instanced draw call.
// ---------------------------------------------------------------------------
const MAX = 200;
const SPOTS = [ // [x0, x1, z0, z1, weight]
  [-8, 8, -46, 30, 3],      // the old street
  [-74, -50, 40, 120, 2],   // torii approach
  [-90, -36, -34, 10, 2],   // pagoda hill
  [-50, 50, -200, -70, 3],  // the district
  [-120, 120, -40, 160, 2], // rooftops all over the old town
];

export function createLanterns({ groundAt }) {
  const geo = new THREE.BoxGeometry(1.6, 2.1, 1.6);
  const aGlow = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2); // seed, brightness
  aGlow.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aGlow', aGlow);
  const uniforms = { uTime: { value: 0 }, uLit: { value: 1 }, uAmb: { value: new THREE.Color(0.5, 0.45, 0.5) } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec2 aGlow;
      varying vec3 vN; varying float vY; varying vec2 vG;
      void main() {
        vN = normal; vY = position.y; vG = aGlow;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uLit; uniform vec3 uAmb;
      varying vec3 vN; varying float vY; varying vec2 vG;
      void main() {
        float flick = 0.86 + 0.14 * sin(uTime * 9.0 + vG.x * 40.0) * sin(uTime * 5.3 + vG.x * 17.0);
        float h = clamp(vY / 2.1 + 0.5, 0.0, 1.0);            // 0 bottom .. 1 top
        vec3 paper = vec3(0.92, 0.72, 0.5) * uAmb;
        vec3 glow = mix(vec3(1.0, 0.62, 0.26), vec3(0.9, 0.3, 0.12), h) * (1.15 - 0.6 * h);
        vec3 c = paper + glow * uLit * flick * 1.5;
        if (vN.y < -0.5) c = vec3(1.4, 1.0, 0.55) * (uLit * 2.6 * flick) + paper;  // the open bottom and its flame
        if (vN.y > 0.5) c = paper * 0.6 + glow * uLit * 0.5;
        gl_FragColor = vec4(c * vG.y, 1.0);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const L = [];
  let releasing = false, acc = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  const totalW = SPOTS.reduce((a, s) => a + s[4], 0);

  function spawn(near) {
    if (L.length >= MAX) return;
    let x, z;
    if (near) { x = near.x + (Math.random() - 0.5) * 10; z = near.z + (Math.random() - 0.5) * 10; }
    else {
      let r = Math.random() * totalW, s = SPOTS[0];
      for (const sp of SPOTS) { r -= sp[4]; if (r <= 0) { s = sp; break; } }
      x = THREE.MathUtils.randFloat(s[0], s[1]); z = THREE.MathUtils.randFloat(s[2], s[3]);
    }
    const y = (near?.y ?? groundAt(x, z)) + 2.5;
    L.push({
      x, y, z, age: 0, seed: Math.random(),
      rise: THREE.MathUtils.randFloat(2.2, 3.6), size: THREE.MathUtils.randFloat(0.85, 1.25),
      sway: THREE.MathUtils.randFloat(0.4, 1.0), spin: THREE.MathUtils.randFloat(-0.3, 0.3),
      wx: THREE.MathUtils.randFloat(-0.6, 1.4), wz: THREE.MathUtils.randFloat(0.5, 1.8),
    });
  }

  return {
    mesh,
    get releasing() { return releasing; },
    set releasing(v) { releasing = v; },
    get count() { return L.length; },
    release(n = 1, near = null) { for (let i = 0; i < n; i++) spawn(near); },
    update(dt, time, lamp) {
      uniforms.uTime.value = time;
      uniforms.uLit.value = 0.3 + 0.9 * lamp;
      if (releasing) { acc += dt * 0.9; while (acc > 1) { acc--; spawn(); } }
      for (let i = L.length - 1; i >= 0; i--) {
        const l = L[i];
        l.age += dt;
        const lift = Math.min(1, l.age / 6);                 // slow lift-off, then the breeze takes them
        const alt = Math.max(0, l.y - 40);
        l.y += l.rise * (0.35 + 0.65 * lift) * dt;
        l.x += l.wx * (1 + alt * 0.008) * lift * dt + Math.sin(time * 0.5 + l.seed * 20) * l.sway * dt;
        l.z -= l.wz * (1 + alt * 0.012) * lift * dt;
        if (l.y > 700 || l.age > 300) { L.splice(i, 1); }
      }
      for (let i = 0; i < L.length; i++) {
        const l = L[i];
        const grow = Math.min(1, l.age / 1.2), fade = 1 - THREE.MathUtils.smoothstep(l.y, 520, 700);
        e.set(Math.sin(time * 0.8 + l.seed * 9) * 0.08, l.seed * 6 + time * l.spin, Math.cos(time * 0.7 + l.seed * 7) * 0.08);
        q.setFromEuler(e);
        sc.setScalar(l.size * grow);
        pos.set(l.x, l.y + Math.sin(time * 1.3 + l.seed * 30) * 0.15, l.z);
        m4.compose(pos, q, sc);
        mesh.setMatrixAt(i, m4);
        aGlow.array[i * 2] = l.seed; aGlow.array[i * 2 + 1] = fade * grow;
      }
      mesh.count = L.length;
      mesh.visible = L.length > 0;
      mesh.instanceMatrix.needsUpdate = true;
      aGlow.needsUpdate = true;
    },
    setAmbient(c) { uniforms.uAmb.value.copy(c); },
  };
}
