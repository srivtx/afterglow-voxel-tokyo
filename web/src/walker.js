import * as THREE from 'three';
import { VoxelWorld, meshModel, lanternLight } from './voxel.js';
import { inFine, trackDist } from './build/layout.js';

// ---------------------------------------------------------------------------
// 散歩 The walker: a little voxel person you can take for a stroll through the
// city. Built from the same voxels as everything else (so it gets the same
// light, wet streets and snow on its head), dressed for the season, with an
// umbrella in the rain and a paper lantern after dark. Collides with the fine
// voxel world and the railway viaduct; steps up kerbs and stairs on its own.
// ---------------------------------------------------------------------------
const VS = 0.21;              // one character voxel in world units (~3.4 tall, like the people in the street)
// The box is a little shorter than the model so a 3-voxel gap (under eaves,
// lantern rails, the viaduct) is passable; the head brushes the ceiling.
const R = 0.42, H = 2.9;      // collision box half-width and height
const GRAV = 36, JUMP = 13.7; // jump apex v²/2g ≈ 2.6 voxels: clears a 2-voxel wall
export const WALK = 5.4, RUN = 11.5;
const O = 16;                 // model voxel offset (models must fit in one chunk)

function addColors(P) {
  const A = (n, h, o = { j: 0.03 }) => P.add(n, h, o);
  A('wkJacket', '#efe3c8'); A('wkJacketAu', '#c98a3c'); A('wkScarf', '#d8323a'); A('wkPants', '#2b2c45');
  A('wkShoe', '#f4f0ea', { j: 0.02 }); A('wkEye', '#16121c', { j: 0 }); A('wkCheek', '#f2a09a', { j: 0.02 });
  A('wkBag', '#7a4a2c', { j: 0.04 }); A('wkYukata', '#2c3f7a'); A('wkYukataDot', '#e8e4f0', { j: 0.02 });
  A('wkCoat', '#3b4a6e'); A('wkKnit', '#f2ead8', { j: 0.05 }); A('wkPin', '#ff8cc4', { em: 0.3, grp: 13, j: 0.02 });
  A('wkRod', '#e9e6f0', { j: 0.02 });
}

// season → outfit
const OUTFIT = { spring: 'spring', summer: 'summer', autumn: 'autumn', winter: 'winter' };

// A part is built in "character space" (voxels, feet at y=0, facing +z) and
// hung from a pivot so it can swing.
function part(P, fill, pivot, parent) {
  const W = new VoxelWorld(P, 1, 'walker');
  fill((x, y, z, name) => W.set(x + O, y + O, z + O, P.id(name)));
  const mesh = new THREE.Mesh(meshModel(W), null);
  mesh.scale.setScalar(VS);
  mesh.position.set((-O - pivot[0]) * VS, (-O - pivot[1]) * VS, (-O - pivot[2]) * VS);
  const g = new THREE.Group();
  g.position.set(pivot[0] * VS, pivot[1] * VS, pivot[2] * VS);
  g.add(mesh);
  parent.add(g);
  return g;
}
const box = (set, x0, y0, z0, x1, y1, z1, name) => {
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) set(x, y, z, typeof name === 'function' ? name(x, y, z) : name);
};

function buildBody(P, outfit, root) {
  const yuk = outfit === 'summer', win = outfit === 'winter';
  const top = yuk ? 'wkYukata' : win ? 'wkCoat' : outfit === 'autumn' ? 'wkJacketAu' : 'wkJacket';
  const pattern = (x, y, z) => (yuk && (x * 3 + y * 5 + z * 7) % 6 === 0 ? 'wkYukataDot' : top);
  const scarf = outfit === 'autumn' || win;

  const body = new THREE.Group();
  root.add(body);
  const hips = [0, 5, 0];
  // torso (+ scarf, backpack or a fan tucked in the obi)
  const torso = part(P, (set) => {
    box(set, -3, 5, -2, 2, 9, 1, pattern);
    if (yuk) {
      box(set, -3, 5, -2, 2, 6, 1, 'obi');
      set(-1, 9, 1, 'skin'); set(0, 9, 1, 'skin'); set(0, 8, 1, 'skin');
      box(set, 0, 6, -3, 1, 8, -3, 'wkScarf');           // uchiwa fan in the obi
      set(0, 5, -3, 'woodLight');
    } else {
      set(0, 6, 1, 'wkEye'); set(0, 8, 1, 'wkEye');       // buttons
      box(set, -2, 5, -3, 1, 8, -3, 'wkBag');              // backpack
      box(set, -2, 8, -3, 1, 8, -3, 'woodDark');
    }
    if (scarf) {
      box(set, -3, 9, -2, 2, 9, 1, 'wkScarf');
      box(set, -2, 6, 2, -2, 8, 2, 'wkScarf');             // the tail hangs in front
    }
  }, hips, body);
  // head: a big chibi head, bob haircut, two-voxel eyes and rosy cheeks
  const head = part(P, (set) => {
    for (let x = -3; x <= 2; x++) for (let y = 10; y <= 14; y++) for (let z = -3; z <= 2; z++) {
      let m = 'skin';
      if (z === 2) {
        if (y === 14 || (y === 13 && (x === -3 || x === -2 || x === 0 || x === 2))) m = 'hair';
        else if ((y === 12 || y === 11) && (x === -2 || x === 1)) m = 'wkEye';
        else if (y === 11 && (x === -3 || x === 2)) m = 'wkCheek';
        else if (y >= 12 && (x === -3 || x === 2)) m = 'hair';
      } else if (y >= 13 || z <= -1 || ((x === -3 || x === 2) && y >= 11)) m = 'hair';
      set(x, y, z, m);
    }
    box(set, -2, 15, -2, 1, 15, 1, 'hair');
    if (win) {                                             // knit beanie with a pom-pom
      box(set, -3, 14, -3, 2, 14, 2, (x, y, z) => (z === 2 && y === 14 ? 'wkKnit' : 'wkKnit'));
      box(set, -2, 15, -2, 1, 15, 1, 'wkKnit'); box(set, -1, 16, -1, 0, 16, 0, 'wkScarf');
    }
    if (outfit === 'spring') { set(2, 14, 1, 'wkPin'); set(2, 13, 1, 'wkPin'); } // sakura hairpin
    if (yuk) { set(-3, 14, 0, 'chochinRed'); set(-3, 14, 1, 'chochinRed'); }      // red hair clip
  }, [0, 10, 0], body);
  // arms hang from the shoulders
  const arm = (side) => part(P, (set) => {
    const x0 = side < 0 ? -5 : 3;
    box(set, x0, 6, -1, x0 + 1, 9, 0, pattern);
    if (yuk) box(set, x0, 6, -2, x0 + 1, 8, -2, pattern), box(set, x0, 6, 1, x0 + 1, 8, 1, pattern); // wide sleeves
    box(set, x0, 5, -1, x0 + 1, 5, 0, win ? 'wkScarf' : 'skin');
  }, [side < 0 ? -4 : 4, 9.5, 0], body);
  const armR = arm(-1), armL = arm(1);
  // legs swing from the hips
  const leg = (side) => part(P, (set) => {
    const x0 = side < 0 ? -3 : 0;
    if (yuk) {
      box(set, x0, 2, -1, x0 + 2, 4, 0, pattern);
      box(set, x0, 1, -1, x0 + 2, 1, 0, 'skin');
      box(set, x0, 0, -1, x0 + 2, 0, 1, 'woodLight');      // geta
    } else {
      box(set, x0, 1, -1, x0 + 2, 4, 0, 'wkPants');
      box(set, x0, 0, -1, x0 + 2, 0, 1, win ? 'wkBag' : 'wkShoe');
      if (win) box(set, x0, 1, -1, x0 + 2, 1, 0, 'wkBag');  // boots
    }
  }, [side < 0 ? -1.5 : 1.5, 5, 0], body);
  const legR = leg(-1), legL = leg(1);
  return { body, torso, head, armR, armL, legR, legL };
}

// a clear vinyl umbrella (very Tokyo) and a paper lantern on a stick
function buildProps(P) {
  const umb = part(P, (set) => {
    for (let y = 0; y <= 13; y++) set(0, y, 0, 'wkRod');
    for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) {
      const r = Math.hypot(x, z);
      if (r <= 8.4) set(x, 13, z, r > 7.5 || (Math.abs(x) === Math.abs(z) && r > 2) ? 'wkRod' : 'umbClear');
      if (r <= 6) set(x, 14, z, 'umbClear');
      if (r <= 3) set(x, 15, z, 'umbClear');
    }
    set(0, 16, 0, 'wkRod');
  }, [0, 0, 0], new THREE.Group());
  const lan = new THREE.Group();
  part(P, (set) => { for (let i = 0; i <= 4; i++) set(0, Math.round(i * 0.75), i, 'woodDark'); }, [0, 0, 0], lan);
  const bulb = part(P, (set) => {
    set(0, 0, 0, 'black');
    box(set, -1, -1, -1, 1, -1, 1, 'black');
    box(set, -1, -4, -1, 1, -2, 1, (x, y) => (y === -3 ? 'chochinWhite' : 'chochinRed'));
    box(set, -1, -5, -1, 1, -5, 1, 'black');
  }, [0, 0, 0], lan);
  bulb.position.set(0, 3 * VS, 4 * VS);
  return { umb, lan, bulb };
}

// soft round contact shadow under the walker's feet
function decal(color, alpha) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color(color) }, uA: { value: alpha } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uC; uniform float uA; varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 2.0; float a = (1.0 - smoothstep(0.0, 1.0, r)); a *= a; gl_FragColor = vec4(uC, a * uA); }',
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 2;
  return mesh;
}

export function createWalker({ P, material, world, rail, railWorld }) {
  addColors(P);
  const passable = new Uint8Array(256);
  P.list.forEach((e, i) => { if (e && [1, 2, 4].includes(e.cls >> 4)) passable[i] = 1; }); // foliage

  const root = new THREE.Group();
  root.name = 'walker';
  root.visible = false;
  const shadow = decal('#0a0612', 0.5); shadow.scale.setScalar(2.6);
  // the paper lantern really lights the street (and the walker's face) after dark
  const light = new THREE.Vector3();
  const group = new THREE.Group();
  group.add(root, shadow);

  let rig = null, outfit = null;
  const props = buildProps(P);
  const setMat = (o) => o.traverse((m) => { if (m.isMesh && !m.material) { m.material = material; m.receiveShadow = true; } });
  setMat(props.umb); setMat(props.lan);
  function setOutfit(season) {
    const o = OUTFIT[season] || 'spring';
    if (o === outfit) return;
    outfit = o;
    if (rig) {
      props.umb.removeFromParent(); props.lan.removeFromParent();
      root.remove(rig.body); rig.body.traverse((m) => m.isMesh && m.geometry.dispose());
    }
    rig = buildBody(P, o, root);
    setMat(rig.body);
    rig.armR.add(props.umb); props.umb.position.set(0, -4.6 * VS, 0.4 * VS);
    rig.armL.add(props.lan); props.lan.position.set(0, -4.6 * VS, 0.4 * VS);
  }

  // ---------------------------------------------------------------- physics
  const tmp = new THREE.Vector3();
  const railInv = new THREE.Matrix4();
  rail.updateMatrixWorld(true);
  railInv.copy(rail.matrixWorld).invert();
  function railAt(x, y, z) {
    if (!railWorld || trackDist(x, z) >= 26) return false;
    tmp.set(x + 0.5, y + 0.5, z + 0.5).applyMatrix4(railInv);
    return railWorld.get(tmp.x, tmp.y, tmp.z) !== 0;
  }
  function solid(x, y, z) {
    if (y < 1) return true;
    if (!inFine(x, z)) return true;                  // the edge of the diorama
    const id = world.get(x, y, z);
    if (id && !passable[id]) return true;
    if (railWorld && trackDist(x, z) < 26) {
      tmp.set(x + 0.5, y + 0.5, z + 0.5).applyMatrix4(railInv);
      if (railWorld.get(tmp.x, tmp.y, tmp.z)) return true;
    }
    return false;
  }
  function hits(x, y, z) {
    const x0 = Math.floor(x - R), x1 = Math.floor(x + R), z0 = Math.floor(z - R), z1 = Math.floor(z + R);
    const y0 = Math.floor(y + 0.01), y1 = Math.floor(y + H);
    for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) if (solid(ix, iy, iz)) return true;
    return false;
  }
  // first standing spot at or below `fromY`
  function groundAt(x, z, fromY = 150) {
    for (let y = Math.floor(fromY); y >= 0; y--) if (solid(Math.floor(x), y, Math.floor(z))) return y + 1;
    return 1;
  }

  const pos = new THREE.Vector3(), vel = new THREE.Vector3();
  // keep a prop at a fixed orientation relative to the body, whatever its parent is doing
  const qRoot = new THREE.Quaternion(), qP = new THREE.Quaternion(), qT = new THREE.Quaternion(), eU = new THREE.Euler();
  function upright(obj, parent, euler) {
    parent.updateMatrixWorld(true);
    parent.getWorldQuaternion(qP).invert();
    obj.quaternion.copy(qP).multiply(qRoot).multiply(qT.setFromEuler(euler));
  }
  let yaw = 0, visY = 0, grounded = false, air = 0, phase = 0, prevSin = 0, idle = 0, bow = 0, placed = false, look = 0;
  let swing = 0, swingV = 0, umbK = 0, lanK = 0, jumpQ = 0;
  const hooks = { onStep: null, onLand: null };

  function place(x, z, y = null, yw = yaw) {
    let gy = y ?? groundAt(x, z);
    for (let i = 0; i < 160 && hits(x, gy, z); i++) gy++;
    pos.set(x, gy, z); vel.set(0, 0, 0); visY = gy; yaw = yw; placed = true; grounded = true; air = 0;
    root.visible = true;
  }

  function surfaceUnder() {
    const id = world.get(Math.floor(pos.x), Math.floor(pos.y - 0.5), Math.floor(pos.z));
    const n = id ? P.list[id].name : '';
    if (/^(grass|moss|dirt|petal|leaf)/.test(n)) return 'grass';
    if (/^gravel/.test(n)) return 'gravel';
    if (/wood|tatami|engawa/i.test(n)) return 'wood';
    return 'stone';
  }

  // How far the camera can go from `o` along `d` before it would sit inside
  // something it can't see through (any voxel, foliage included, or the viaduct).
  // The camera is never put inside geometry: voxel meshes have no inner faces,
  // so from inside a building you'd see straight through it.
  function rayFree(o, d, maxD) {
    for (let t = 0.25; t < maxD; t += 0.25) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < 1.3) return t;
      if (world.get(x, y, z) || railAt(Math.floor(x), Math.floor(y), Math.floor(z))) return t;
    }
    return maxD;
  }

  // ------------------------------------------------------------------ update
  // input: { x, z } world-space wish direction (length 0..1), run, wantJump
  function update(dt, t, input, env) {
    if (!placed) return;
    setOutfit(env.season);
    // never stay inside geometry (a spawn on a moved prop, a share link into a wall)
    for (let i = 0; i < 4 && hits(pos.x, pos.y, pos.z); i++) { pos.y = Math.floor(pos.y) + 1; vel.y = 0; }
    const n = Math.max(1, Math.ceil(dt / (1 / 90)));
    const h = dt / n;
    const mv = Math.min(1, Math.hypot(input.x, input.z));
    const speed = (input.run ? RUN : WALK) * mv * (umbK > 0.5 ? 0.92 : 1);
    if (input.jump) jumpQ = 0.15;
    for (let s = 0; s < n; s++) {
      // accelerate toward the wish velocity (snappy on the ground, floaty in the air)
      const k = Math.min(1, h * (grounded ? 14 : 3));
      const wx = mv > 0.01 ? (input.x / mv) * speed : 0, wz = mv > 0.01 ? (input.z / mv) * speed : 0;
      vel.x += (wx - vel.x) * k; vel.z += (wz - vel.z) * k;
      if (jumpQ > 0 && (grounded || air < 0.12) && bow <= 0) { vel.y = JUMP; grounded = false; air = 1; jumpQ = 0; }
      jumpQ -= h;
      // horizontal, axis by axis, stepping up one-voxel ledges
      for (const ax of ['x', 'z']) {
        const d = vel[ax] * h;
        if (!d) continue;
        const nx = ax === 'x' ? pos.x + d : pos.x, nz = ax === 'z' ? pos.z + d : pos.z;
        if (!hits(nx, pos.y, nz)) { pos.x = nx; pos.z = nz; continue; }
        // step up a one-voxel ledge on the ground; in the air, climb onto a
        // ledge the feet have nearly cleared (jump at a wall and you get up it)
        const up = Math.floor(pos.y + 0.01) + 1;
        const onGround = grounded || air < 0.1;
        if ((onGround || vel.y < 6) && up - pos.y <= (onGround ? 1.05 : 0.95) && !hits(nx, up, nz) && !hits(pos.x, up, pos.z)) {
          pos.y = up; pos.x = nx; pos.z = nz;
          if (!onGround) { vel.y = 0; grounded = true; air = 0; }
        } else vel[ax] = 0;
      }
      // vertical
      vel.y -= GRAV * h;
      const ny = pos.y + vel.y * h;
      if (vel.y <= 0) {
        // probe a hair below the feet, so standing on a floor stays grounded
        // (without it the walker sank 0.004, "fell" for a tick, and the gait,
        // footsteps and step-ups flickered on flat ground)
        const fy = ny - 0.02;
        if (hits(pos.x, fy, pos.z)) {
          if (!grounded && air > 0.2 && hooks.onLand) hooks.onLand(-vel.y, surfaceUnder());
          pos.y = Math.floor(fy + 0.01) + 1;
          vel.y = 0; grounded = true; air = 0;
        } else { pos.y = ny; grounded = false; air += h; }
      } else if (hits(pos.x, ny, pos.z)) vel.y = 0;
      else { pos.y = ny; air += h; }
      if (pos.y < -10) place(pos.x, pos.z);
    }
    // smooth the stairs out visually
    visY += (pos.y - visY) * Math.min(1, dt * (grounded ? 16 : 40));
    if (Math.abs(pos.y - visY) > 3) visY = pos.y;

    // face where we're going
    const hs = Math.hypot(vel.x, vel.z);
    if (mv > 0.05 && hs > 0.3) {
      const ty = Math.atan2(vel.x, vel.z);
      let dy = ty - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      yaw += dy * Math.min(1, dt * 12);
    }
    root.position.set(pos.x, visY, pos.z);
    root.rotation.y = yaw;

    // ---------------------------------------------------------------- pose
    const r = rig;
    const gait = grounded ? Math.min(1, hs / WALK) : 0, runK = THREE.MathUtils.clamp((hs - WALK) / (RUN - WALK), 0, 1);
    phase += dt * hs * (2 * Math.PI / (2.6 + runK * 1.4));
    const sn = Math.sin(phase);
    if (grounded && hs > 0.8 && Math.sign(sn) !== Math.sign(prevSin) && hooks.onStep) hooks.onStep(surfaceUnder(), runK);
    prevSin = sn;
    const amp = 0.15 + 0.55 * gait + 0.3 * runK;
    let lr = sn * amp * gait, ll = -sn * amp * gait, ar = -sn * amp * 0.9 * gait, al = sn * amp * 0.9 * gait, armOut = 0.06;
    let armOutR = null, lean = runK * 0.2 + gait * 0.04, bob = Math.abs(Math.cos(phase)) * 0.12 * gait * VS * 6;
    if (!grounded && air > 0.08) {                     // jump pose: knees up, arms out
      const u = vel.y > 0 ? 1 : 0.6;
      lr = -0.9 * u; ll = 0.35 * u; ar = -0.4; al = -0.4; armOut = 0.9 * u; lean = 0.05; bob = 0;
    }
    idle = hs < 0.3 && grounded ? idle + dt : 0;
    // breathing and glancing around when standing still
    const breathe = Math.sin(t * 2.2) * 0.012;
    look += ((idle > 2.5 ? Math.sin(t * 0.45) * 0.55 + Math.sin(t * 1.3) * 0.1 : 0) - look) * Math.min(1, dt * 2);
    if (bow > 0) {                                     // a respectful bow at the shrine
      bow -= dt;
      const b = Math.sin(Math.min(1, (2.2 - bow) / 2.2) * Math.PI);
      lean = 0.55 * b; ar = -0.5 * b; al = -0.5 * b; armOut = -0.25 * b; lr = ll = 0;
    }
    // props: umbrella in the rain (right hand), lantern after dark (left hand)
    umbK += ((env.rain > 0.3 ? 1 : 0) - umbK) * Math.min(1, dt * 4);
    const dusk = THREE.MathUtils.smoothstep(env.time, 0.44, 0.62);   // the paper lantern comes out after sunset
    lanK += ((env.time > 0.46 ? 1 : 0) - lanK) * Math.min(1, dt * 3);
    props.umb.visible = umbK > 0.05; props.umb.scale.setScalar(Math.max(0.01, umbK));
    props.lan.visible = lanK > 0.05; props.lan.scale.setScalar(Math.max(0.01, lanK));
    if (umbK > 0.05) { ar = THREE.MathUtils.lerp(ar, -0.55, umbK); armOutR = THREE.MathUtils.lerp(armOut, 0.3, umbK); }
    if (lanK > 0.05) { al = THREE.MathUtils.lerp(al, -0.85 + sn * 0.08 * gait, lanK); }
    const sm = (o, k, v) => { o[k] += (v - o[k]) * Math.min(1, dt * 14); };
    sm(r.legR.rotation, 'x', lr); sm(r.legL.rotation, 'x', ll);
    sm(r.armR.rotation, 'x', ar); sm(r.armL.rotation, 'x', al);
    sm(r.armR.rotation, 'z', -(armOutR ?? armOut)); sm(r.armL.rotation, 'z', armOut);
    sm(r.body.rotation, 'x', lean);
    // props stay upright whatever the arm is doing; the lantern swings like a pendulum
    const acc = -sn * gait * 2.5 - (hs > 0.3 ? 0.4 * runK : 0);
    swingV += (-swing * 30 + acc - swingV * 2.2) * dt; swing += swingV * dt;
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(qRoot);
    upright(props.umb, r.armR, eU.set(-0.06, 0, -0.22));          // canopy over the head
    upright(props.lan, r.armL, eU.set(-0.1, 0, 0));                // stick held out in front
    upright(props.bulb, props.lan, eU.set(swing * 0.6, 0, swing * 0.15)); // the lantern hangs (and swings)
    r.body.position.y = bob + breathe;
    r.head.rotation.y = look; r.head.rotation.x = -lean * 0.5 + (bow > 0 ? 0.2 : 0);

    // contact shadow on the ground below, and the lantern's light
    const gy = groundAt(pos.x, pos.z, pos.y + 0.5);
    const hgt = pos.y - gy;
    shadow.position.set(pos.x, gy + 0.04, pos.z);
    shadow.material.uniforms.uA.value = 0.5 * Math.max(0, 1 - hgt / 8);
    shadow.scale.setScalar(2.6 * (1 + hgt * 0.06));
    props.bulb.getWorldPosition(light);
    const li = lanK * dusk * 3.2 * (0.9 + 0.1 * Math.sin(t * 9) * Math.sin(t * 5.3)) * (group.visible ? 1 : 0);
    lanternLight.value.set(light.x, light.y - 0.5, light.z, li);
  }

  return {
    group,
    pos,
    get yaw() { return yaw; },
    get placed() { return placed; },
    get grounded() { return grounded; },
    get speed() { return Math.hypot(vel.x, vel.z); },
    get outfit() { return outfit; },
    focus(out) { return out.set(pos.x, visY + 2.7, pos.z); },
    place, groundAt, hits, rayFree, update, setOutfit,
    jump() { jumpQ = 0.15; },
    bow() { if (grounded) bow = 2.2; },
    hooks,
    set visible(v) { group.visible = v; },
    // the camera is right up against the walker: hide the body (the shadow and light stay)
    set near(v) { root.visible = placed && !v; },
  };
}
