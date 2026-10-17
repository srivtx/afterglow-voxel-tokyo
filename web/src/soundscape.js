// 環境音 City soundscape: what you would hear standing in the diorama, on its
// own channel so it keeps playing when the music is off. Every layer is
// synthesized; levels follow the camera (street, district, shrine, altitude),
// the time of day, the season and the weather.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x, a, b) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Evening chime, in the spirit of the 5 o'clock "Yūyake Koyake" played over
// the town loudspeakers ([scale degree, beats]).
const CHIME = [
  [5, 1], [5, 1], [6, 1], [5, 1], [3, 1], [3, 1], [2, 2],
  [3, 1], [5, 1], [3, 1], [2, 1], [1, 4],
  [1, 1], [1, 1], [2, 1], [3, 1], [5, 1], [5, 1], [6, 2],
  [5, 1], [3, 1], [2, 1], [3, 1], [5, 4],
];
const DEG = { 1: 0, 2: 2, 3: 4, 5: 7, 6: 9 };

export function createSoundscape(ctx, { out, verbIn, noise, brown }) {
  const S = {
    time: 0.38, season: 'spring', street: 0, district: 0, shrine: 0, shrinePan: 0, alt: 50, life: true, rain: 0, snow: 0,
  };
  const now = () => ctx.currentTime;
  const loop = (buf, rate = 1) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random()); return s; };
  const filt = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const panner = (p) => { const n = ctx.createStereoPanner(); n.pan.value = Math.max(-1, Math.min(1, p)); return n; };
  const shot = (t, dur) => { const s = ctx.createBufferSource(); s.buffer = noise; s.start(t, Math.random() * 0.5); s.stop(t + dur); return s; };

  // ---------------------------------------------------------------- beds
  // city hum: distant traffic and machinery, a low brown rumble with a swish
  const humG = gain();
  loop(brown, 0.45).connect(filt('lowpass', 210)).connect(humG);
  const swishG = gain(0.35);
  loop(brown, 1.3).connect(filt('bandpass', 900, 0.6)).connect(swishG).connect(humG);
  humG.connect(out);

  // crowd: a murmur bed plus scheduled "syllables" (formant-filtered noise)
  const crowdG = gain();
  const crowdLP = filt('lowpass', 2200);
  crowdLP.connect(crowdG).connect(out);
  const crowdBed = gain(0.5);
  loop(brown, 1.9).connect(filt('bandpass', 520, 1.1)).connect(crowdBed).connect(crowdLP);

  // summer cicada shower (aburazemi): bright sizzle under the trees
  const semiG = gain();
  const semiAM = ctx.createOscillator(); semiAM.frequency.value = 23;
  const semiAMG = gain(0.35); semiAM.connect(semiAMG); semiAM.start();
  const semiMod = gain(0.65); semiAMG.connect(semiMod.gain);
  loop(noise, 1).connect(filt('bandpass', 5200, 2.2)).connect(semiMod).connect(semiG).connect(out);

  // --------------------------------------------------------------- voices
  // one murmured syllable of the crowd
  function syllable(t, lvl) {
    const dur = rnd(0.07, 0.24);
    const n = shot(t, dur + 0.05);
    const f1 = rnd(280, 820), f2 = rnd(950, 2500);
    const a = filt('bandpass', f1, 5), b = filt('bandpass', f2, 7);
    a.frequency.setValueAtTime(f1, t); a.frequency.linearRampToValueAtTime(f1 * rnd(0.82, 1.18), t + dur);
    const g = gain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11 * lvl, t + 0.025); g.gain.setTargetAtTime(0.0001, t + dur * 0.7, 0.04);
    const bg = gain(0.45);
    const p = panner(rnd(-0.85, 0.85));
    n.connect(a).connect(g); n.connect(b).connect(bg).connect(g);
    g.connect(p).connect(crowdLP);
  }

  // higurashi: the evening cicada, a falling "kana-kana-kana" trill
  function higurashi(t, lvl, pan) {
    const n = Math.floor(rnd(22, 34)), f0 = rnd(4300, 5100);
    const o = ctx.createOscillator(); o.type = 'sine';
    const o2 = ctx.createOscillator(); o2.type = 'sine';
    const g = gain(), g2 = gain(0.25);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const a = 0.05 * lvl * Math.min(1, (i + 1) / 3) * Math.pow(1 - u, 0.7);
      o.frequency.setValueAtTime(f0 * (1 - 0.13 * u), tt);
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(a, tt + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.07);
      tt += 0.085 * (1 + u * 0.55);
    }
    o2.frequency.value = f0 * 1.52;
    const p = panner(pan);
    o.connect(g); o2.connect(g2).connect(g); g.connect(p).connect(out);
    const vs = gain(0.4); p.connect(vs).connect(verbIn);
    o.start(t); o2.start(t); o.stop(tt + 0.1); o2.stop(tt + 0.1);
  }

  // minmin-zemi: "miiin min min min miiiin" in the summer heat
  function minmin(t, lvl, pan) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const bp = filt('bandpass', 3900, 5);
    const am = ctx.createOscillator(); am.frequency.value = 62;
    const amg = gain(0.5); am.connect(amg);
    const vca = gain(0.5); amg.connect(vca.gain);
    const g = gain();
    const reps = Math.floor(rnd(4, 8));
    let tt = t;
    const f = rnd(3500, 3900);
    for (let i = 0; i <= reps; i++) {
      const long = i === 0 || i === reps;
      const d = long ? rnd(0.7, 1.2) : 0.24;
      o.frequency.setValueAtTime(f * 0.86, tt);
      o.frequency.linearRampToValueAtTime(f, tt + d * 0.4);
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.03 * lvl, tt + d * 0.35);
      g.gain.linearRampToValueAtTime(0.0001, tt + d);
      tt += d + 0.05;
    }
    const p = panner(pan);
    o.connect(bp).connect(vca).connect(g).connect(p).connect(out);
    o.start(t); am.start(t); o.stop(tt + 0.1); am.stop(tt + 0.1);
  }

  // suzumushi (bell cricket) "riiin" and kōrogi triple chirps
  const crickets = Array.from({ length: 6 }, (_, i) => ({ f: rnd(3800, 4700), pan: rnd(-0.9, 0.9), next: 0, kind: i < 3 ? 'suzu' : 'korogi' }));
  function cricket(c, t, lvl) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = c.kind === 'suzu' ? c.f : c.f * 0.78;
    const am = ctx.createOscillator(); am.frequency.value = c.kind === 'suzu' ? 38 : 70;
    const amg = gain(0.5); am.connect(amg);
    const vca = gain(0.5); amg.connect(vca.gain);
    const g = gain();
    let end;
    if (c.kind === 'suzu') {
      const d = rnd(0.35, 0.6);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.022 * lvl, t + d * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      end = t + d;
    } else {
      for (let k = 0; k < 3; k++) { const tk = t + k * 0.11; g.gain.setValueAtTime(0.0001, tk); g.gain.linearRampToValueAtTime(0.016 * lvl, tk + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, tk + 0.08); }
      end = t + 0.36;
    }
    const p = panner(c.pan);
    o.connect(vca).connect(g).connect(p).connect(out);
    o.start(t); am.start(t); o.stop(end + 0.05); am.stop(end + 0.05);
  }

  // bonshō: the temple bell, struck with a wooden beam
  function bonsho(t, lvl, pan) {
    const f0 = 98;
    const g = gain(0.22 * lvl);
    const p = panner(pan * 0.7);
    g.connect(p).connect(out);
    const vs = gain(1.1); p.connect(vs).connect(verbIn);
    const partials = [[0.5, 0.55, 16], [1, 1, 12], [1.007, 0.6, 12], [1.61, 0.42, 8], [2.03, 0.32, 6], [2.68, 0.22, 4.5], [3.21, 0.16, 3.2], [4.12, 0.1, 2.2], [5.4, 0.06, 1.4]];
    for (const [r, a, dec] of partials) {
      const o = ctx.createOscillator(); o.frequency.value = f0 * r;
      const og = gain(); og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(a, t + 0.01); og.gain.setTargetAtTime(0.0001, t + 0.02, dec / 4);
      o.connect(og).connect(g); o.start(t); o.stop(t + dec * 1.6);
    }
    const n = shot(t, 0.25);
    const lp = filt('lowpass', 900);
    const ng = gain(); ng.gain.setValueAtTime(0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(lp).connect(ng).connect(g);
  }

  // karasu: two or three hoarse caws
  function crow(t, lvl, pan) {
    const caws = Math.floor(rnd(2, 4));
    const p = panner(pan);
    p.connect(out);
    const vs = gain(0.35); p.connect(vs).connect(verbIn);
    const base = rnd(480, 600);
    for (let i = 0; i < caws; i++) {
      const tc = t + i * rnd(0.42, 0.6), d = rnd(0.28, 0.4);
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(base, tc); o.frequency.linearRampToValueAtTime(base * 1.22, tc + 0.06); o.frequency.exponentialRampToValueAtTime(base * 0.82, tc + d);
      const f1 = filt('bandpass', 1250, 2.2), f2 = filt('bandpass', 2500, 3);
      const g = gain(); g.gain.setValueAtTime(0.0001, tc); g.gain.linearRampToValueAtTime(0.07 * lvl, tc + 0.03); g.gain.setTargetAtTime(0.0001, tc + d * 0.8, 0.03);
      const n = shot(tc, d + 0.1); const nb = filt('bandpass', 1600, 1.5); const ng = gain(0.5);
      o.connect(f1).connect(g); o.connect(f2).connect(g); n.connect(nb).connect(ng).connect(g);
      g.connect(p);
      o.start(tc); o.stop(tc + d + 0.2);
    }
  }

  // the evening chime over the town loudspeakers, echoing off the hills
  function townChime(t, lvl) {
    const bus = gain(0.075 * lvl);
    const hp = filt('highpass', 380), pk = filt('peaking', 1900, 1); pk.gain.value = 5;
    const lp = filt('lowpass', 3000);
    const echo = ctx.createDelay(1.5); echo.delayTime.value = 0.43;
    const fb = gain(0.42), elp = filt('lowpass', 1400);
    bus.connect(hp).connect(pk).connect(lp);
    lp.connect(out); lp.connect(echo); echo.connect(elp).connect(fb).connect(echo); elp.connect(out);
    const vs = gain(1.4); lp.connect(vs).connect(verbIn);
    const beat = 0.46, root = 65; // F4
    let tt = t;
    for (const [d, b] of CHIME) {
      const f = mtof(root + DEG[d]);
      for (const [r, a, dec] of [[1, 1, 1.2], [2, 0.18, 0.5], [4.02, 0.08, 0.2]]) {
        const o = ctx.createOscillator(); o.frequency.value = f * r;
        const g = gain(); g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(a, tt + 0.01); g.gain.setTargetAtTime(0.0001, tt + 0.02, dec * Math.min(1.6, b * 0.6));
        o.connect(g).connect(bus); o.start(tt); o.stop(tt + b * beat + 3);
      }
      tt += b * beat;
    }
    return tt - t;
  }

  // ------------------------------------------------------------ schedule
  const next = { syl: 0, minmin: 0, higu: 0, bell: 0, crow: 0 };
  let lastChime = -1e9, prevTime = null, armedChime = true;
  const inChime = (t) => t > 0.3 && t < 0.52;

  function levels() {
    const night = smooth(S.time, 0.55, 0.88);
    const ground = 1 - smooth(S.alt, 60, 420);
    const near = 1 - smooth(S.alt, 25, 110);
    const wet = 1 - 0.6 * S.rain, hush = 1 - 0.55 * S.snow;
    const summer = S.season === 'summer' ? 1 : 0;
    return {
      night, ground, near, wet, hush,
      hum: (0.07 + 0.09 * S.district + 0.04 * S.street) * (0.3 + 0.7 * ground) * (1 - 0.15 * night) * hush,
      crowd: (S.life ? 1 : 0) * Math.max(S.street, S.district * 1.15) * near * wet * hush * (0.65 + 0.35 * smooth(S.time, 0.2, 0.7)),
      semi: summer * (1 - smooth(S.time, 0.42, 0.62)) * (0.35 + 0.65 * S.shrine) * wet * ground,
      higu: summer * smooth(S.time, 0.22, 0.38) * (1 - smooth(S.time, 0.72, 0.86)) * (0.4 + 0.6 * S.shrine) * wet * ground,
      bugs: ({ summer: 0.75, autumn: 1, spring: 0.18, winter: 0 }[S.season] ?? 0) * smooth(S.time, 0.62, 0.85) * (1 - 0.85 * S.rain) * ground,
      bell: (night > 0.5 || (S.season === 'winter' && S.time > 0.45) ? 1 : 0) * (0.55 + 0.45 * S.shrine) * (0.6 + 0.4 * ground),
      crow: (S.life ? 1 : 0) * (1 - smooth(S.time, 0.5, 0.66)) * (1 - S.rain) * (0.5 + 0.5 * S.shrine) * ground,
    };
  }

  function apply() {
    const L = levels(), t = now();
    humG.gain.setTargetAtTime(L.hum, t, 0.5);
    swishG.gain.setTargetAtTime(0.25 + 0.35 * S.district, t, 0.5);
    crowdG.gain.setTargetAtTime(L.crowd * 0.55, t, 0.4);
    semiG.gain.setTargetAtTime(L.semi * 0.05, t, 0.8);
    return L;
  }

  function tick() {
    const t = now();
    const L = apply();
    // crowd chatter density follows the level
    if (L.crowd > 0.03 && t > next.syl) { syllable(t + 0.05, Math.min(1, L.crowd)); next.syl = t + rnd(0.03, 0.16) / Math.max(0.2, L.crowd); }
    if (L.semi > 0.05 && t > next.minmin) { if (next.minmin) minmin(t + 0.1, L.semi, rnd(-0.8, 0.8)); next.minmin = t + rnd(7, 18); }
    if (L.higu > 0.05 && t > next.higu) { if (next.higu) higurashi(t + 0.1, L.higu, rnd(-0.9, 0.9)); next.higu = t + rnd(8, 20); }
    if (L.bugs > 0.04) for (const c of crickets) {
      if (t > c.next) { cricket(c, t + 0.05, L.bugs); c.next = t + (c.kind === 'suzu' ? rnd(0.5, 1.3) : rnd(0.8, 2.6)) / (0.5 + L.bugs * 0.5); }
    }
    if (L.bell > 0.05 && t > next.bell) { if (next.bell) bonsho(t + 0.1, L.bell, S.shrinePan); next.bell = t + rnd(38, 75); }
    if (L.crow > 0.05 && t > next.crow) { if (next.crow) crow(t + 0.1, L.crow, rnd(-0.9, 0.9)); next.crow = t + rnd(12, 32); }
    // the evening chime plays when dusk arrives (at most every few minutes)
    const tm = S.time;
    if (prevTime !== null && !inChime(prevTime) && inChime(tm)) armedChime = true;
    if (armedChime && inChime(tm) && t - lastChime > 180 && t > 6) { townChime(t + 1.5, 0.6 + 0.4 * L.ground); lastChime = t; armedChime = false; }
    if (!inChime(tm)) armedChime = false;
    prevTime = tm;
  }

  return {
    set(o) { Object.assign(S, o); },
    tick,
    bell() { bonsho(now() + 0.05, 1, S.shrinePan); },
    chime() { lastChime = now(); return townChime(now() + 0.1, 1); },
    crow() { crow(now() + 0.05, 1, rnd(-0.6, 0.6)); },
    levels,
  };
}
