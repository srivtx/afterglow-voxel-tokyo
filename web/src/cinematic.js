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
        // stays over the centre line, above the bus roofs (y 5.5), so oncoming
        // headlights never pass right under the lens and flood the bloom
        const x = Math.sin(u * 3.2) * 0.5;
        return { p: V(x, 8.5 + Math.sin(u * Math.PI) * 1.5, z), l: V(x * 0.4, 19 + u * 4, z - 120) };
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
      jp: '花火', en: 'Hanabi over the bay', dur: 14, fov: [50, 44],
      when: () => ctx.hanabiOn?.(),
      setup() { ctx.salvo?.(); },
      cam(u) {
        const e = easeInOut(u);
        const p = V(THREE.MathUtils.lerp(-40, 10, e), THREE.MathUtils.lerp(46, 64, e), THREE.MathUtils.lerp(150, 120, e));
        return { p, l: V(THREE.MathUtils.lerp(-20, 30, e), THREE.MathUtils.lerp(150, 230, e), -800) };
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
    this.lensA = 0; this.lensB = 0;
  }
  get count() { return this.shots.filter((s) => !s.when || s.when()).length; }
  get index() { return this.shots.slice(0, this.i).filter((s) => !s.when || s.when()).length; }
  begin() {
    this.t = 0; this.dur = this.shots[this.i].dur; this.synced = false;
    this.shots[this.i].setup?.();
    this.ui.onShot(this.shots[this.i], this.index, this.count);
  }
  start(i = 0) { this.active = true; this.i = i; this.begin(); }
  stop() { this.active = false; }
  next(d = 1) {
    const n = this.shots.length;
    let i = this.i;
    do { i = (i + d + n) % n; } while (this.shots[i].when && !this.shots[i].when());
    if (d > 0 && i <= this.i) this.onLoop?.();
    this.i = i;
    this.begin();
  }
  update(dt) {
    if (!this.active) return;
    if (!this.paused) this.t += dt;
    const s = this.shots[this.i];
    // music-video mode: stretch the shot so the next one starts on a bar line
    if (!this.synced && this.t > this.dur - 2.4) {
      this.synced = true;
      const tb = this.ctx.timeToNextBar?.();
      if (tb != null) {
        const bar = this.ctx.barLength();
        let cut = this.t + tb;
        while (cut < this.dur - bar * 0.5) cut += bar;
        this.dur = Math.max(this.t + 0.9, cut);
      }
    }
    if (this.t >= this.dur) { this.next(1); return this.update(0); }
    const u = Math.min(1, this.t / this.dur);
    const { p, l } = s.cam(u);
    this.camera.position.copy(p);
    this.look.copy(l);
    this.camera.lookAt(l);
    // the lens breathes with the kick: two cascaded smoothers turn the sharp
    // kick envelope into an eased swell of ~0.1° instead of a snap
    const k = 1 - Math.exp(-8 * dt);
    this.lensA += ((this.ctx.pulse?.() || 0) - this.lensA) * k;
    this.lensB += (this.lensA - this.lensB) * k;
    const fov = THREE.MathUtils.lerp(s.fov[0], s.fov[1], u) - this.lensB * 0.4;
    if (Math.abs(this.camera.fov - fov) > 1e-3) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    // dip-to-black between shots
    const fade = Math.min(1, this.t / 0.7, (this.dur - this.t) / 0.7);
    this.ui.setFade(1 - Math.max(0, fade));
    this.ui.setProgress((this.index + u) / this.count);
  }
}
