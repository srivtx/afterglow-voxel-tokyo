import * as THREE from 'three';
import { PAGODA, TORII, TOWER, HERO } from './build/layout.js';
import { TOWER_H } from './build/tower.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ease = (u) => u * u * u * (u * (u * 6 - 15) + 10); // smootherstep
const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const path = (pts) => new THREE.CatmullRomCurve3(pts, false, 'centripetal');

// Each shot returns camera position + look target for u in [0,1].
export function makeShots(ctx) {
  const heroPos = V(...HERO.pos), heroLook = V(...HERO.target);
  return [
    {
      jp: '夕焼け', en: 'Afterglow over Tokyo', dur: 13, fov: [44, 48],
      setup() {},
      cam(u) {
        const p = path([V(-120, 330, 520), V(-70, 190, 360), V(-30, 90, 220), heroPos]).getPoint(ease(u));
        const l = V(60, 160, -600).lerp(heroLook, ease(u));
        return { p, l };
      },
    },
    {
      jp: '五重塔', en: 'The five-storey pagoda', dur: 14, fov: [40, 40],
      cam(u) {
        const a = THREE.MathUtils.lerp(0.18, 0.86, easeInOut(u)) * Math.PI;
        const r = THREE.MathUtils.lerp(64, 50, u);
        const p = V(PAGODA.x + Math.cos(a) * r, THREE.MathUtils.lerp(58, 92, ease(u)), PAGODA.z + Math.sin(a) * r);
        return { p, l: V(PAGODA.x, THREE.MathUtils.lerp(64, 78, u), PAGODA.z) };
      },
    },
    {
      jp: '参道', en: 'The lantern approach', dur: 12, fov: [52, 50],
      cam(u) {
        const e = ease(u);
        const p = V(TORII.x + Math.sin(u * 3) * 0.4, THREE.MathUtils.lerp(20.5, 22, e), THREE.MathUtils.lerp(TORII.z + 52, TORII.z - 26, e));
        return { p, l: V(TORII.x, THREE.MathUtils.lerp(27, 66, e), PAGODA.z) };
      },
    },
    {
      jp: '坂道', en: 'Down the old street', dur: 15, fov: [50, 54],
      cam(u) {
        const e = easeInOut(u);
        const z = THREE.MathUtils.lerp(118, -92, e);
        const ground = z > 12 ? 16 : z < -50 ? 0 : (16 * (z + 50)) / 62;
        const p = V(Math.sin(u * 4.5) * 1.6, ground + THREE.MathUtils.lerp(12, 10, e), z);
        return { p, l: V(Math.sin(u * 4.5 + 0.6) * 2, ground + 12 - 2, z - 80) };
      },
    },
    {
      jp: 'ネオン街', en: 'Neon after dark', dur: 13, fov: [46, 46],
      cam(u) {
        // low dolly down the neon boulevard, under the hanging signs
        const e = easeInOut(u);
        const z = THREE.MathUtils.lerp(-60, -172, e);
        const x = Math.sin(u * 3.2) * 2.2;
        return { p: V(x, 7 + Math.sin(u * Math.PI) * 1.5, z), l: V(x * 0.4, 19 + u * 4, z - 120) };
      },
    },
    {
      jp: '山手線', en: 'The evening train', dur: 12, fov: [48, 44],
      setup() { ctx.setTrainPhase(-200); },
      cam(u) {
        const f = ctx.trainFrame();
        const lag = THREE.MathUtils.lerp(-30, 40, easeInOut(u));
        const p = f.local(70 + lag, 46 + u * 8, 46);
        const l = f.local(80 + lag * 0.4, 34, 0);
        return { p, l };
      },
    },
    {
      jp: '東京タワー', en: 'Tokyo Tower', dur: 14, fov: [46, 40],
      cam(u) {
        const e = easeInOut(u);
        const a = THREE.MathUtils.lerp(0.62, 0.3, e) * Math.PI;
        const r = THREE.MathUtils.lerp(92, 150, e);
        const p = V(TOWER.x + Math.cos(a) * r, THREE.MathUtils.lerp(14, 210, e), TOWER.z + Math.sin(a) * r);
        return { p, l: V(TOWER.x, THREE.MathUtils.lerp(120, TOWER_H * 0.7, e), TOWER.z) };
      },
    },
    {
      jp: '黄昏', en: 'Until the lanterns sleep', dur: 15, fov: [46, 50],
      cam(u) {
        const e = ease(u);
        const p = path([V(TORII.x + 12, 30, TORII.z + 30), V(TORII.x + 30, 60, TORII.z + 110), V(10, 150, 320), V(30, 260, 470)]).getPoint(e);
        return { p, l: V(-30, 50, -60).lerp(V(40, 90, -400), e) };
      },
    },
  ];
}

export class Director {
  constructor(camera, ui, ctx) {
    this.camera = camera; this.ui = ui; this.ctx = ctx;
    this.shots = makeShots(ctx);
    this.active = false; this.i = 0; this.t = 0; this.paused = false;
    this.look = new THREE.Vector3();
  }
  start(i = 0) {
    this.active = true; this.i = i; this.t = 0;
    this.shots[i].setup?.();
    this.ui.onShot(this.shots[i], i, this.shots.length);
  }
  stop() { this.active = false; }
  next(d = 1) {
    this.i = (this.i + d + this.shots.length) % this.shots.length;
    this.t = 0;
    this.shots[this.i].setup?.();
    this.ui.onShot(this.shots[this.i], this.i, this.shots.length);
  }
  update(dt) {
    if (!this.active) return;
    if (!this.paused) this.t += dt;
    const s = this.shots[this.i];
    if (this.t >= s.dur) { this.next(1); return this.update(0); }
    const u = this.t / s.dur;
    const { p, l } = s.cam(u);
    this.camera.position.copy(p);
    this.look.copy(l);
    this.camera.lookAt(l);
    const fov = THREE.MathUtils.lerp(s.fov[0], s.fov[1], u);
    if (Math.abs(this.camera.fov - fov) > 1e-3) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    // dip-to-black between shots
    const fade = Math.min(1, this.t / 0.7, (s.dur - this.t) / 0.7);
    this.ui.setFade(1 - Math.max(0, fade));
    this.ui.setProgress((this.i + u) / this.shots.length);
  }
}
