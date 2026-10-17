// 夕焼けラジオ · Afterglow FM
// A generative lo-fi / city-pop soundtrack composed live in WebAudio — no
// audio files. Electric piano (FM), koto (Karplus-Strong), bass, pads,
// swung drums, vinyl crackle and fūrin chimes. The mood follows the time of
// day and changes on the next bar line.
//
// The world's own sound (wind, rain, thunder, trains, fireworks and the
// soundscape in soundscape.js) runs on a separate channel, so muting the music
// never silences the city.
import { createSoundscape } from './soundscape.js';

const MOODS = {
  golden: {
    name: 'Golden hour', jp: '黄金色', bpm: 84, swing: 0.14, lpf: 6200, verb: 0.22, pad: 0.05, mel: 0.7, drums: 'groove',
    prog: [[38, [54, 57, 61, 64]], [47, [57, 62, 66, 73]], [43, [54, 59, 62, 66]], [45, [54, 59, 61, 64]]],
  },
  sunset: {
    name: 'Sunset', jp: '夕焼け', bpm: 78, swing: 0.18, lpf: 4800, verb: 0.3, pad: 0.06, mel: 0.62, drums: 'groove',
    prog: [[43, [59, 62, 66, 69]], [42, [57, 61, 64, 66]], [40, [55, 59, 62, 66]], [45, [55, 61, 66, 71]]],
  },
  blue: {
    name: 'Blue hour', jp: '青の時間', bpm: 72, swing: 0.2, lpf: 3900, verb: 0.38, pad: 0.075, mel: 0.5, drums: 'lazy',
    prog: [[47, [57, 61, 62, 66]], [43, [59, 62, 66, 69]], [40, [55, 59, 62, 66]], [42, [52, 59, 61, 66]]],
  },
  night: {
    name: 'Night', jp: '夜', bpm: 66, swing: 0.22, lpf: 3100, verb: 0.5, pad: 0.09, mel: 0.38, drums: 'half',
    prog: [[40, [55, 59, 62, 66]], [43, [54, 59, 62, 66]], [47, [57, 62, 66, 69]], [45, [55, 62, 64, 69]]],
  },
};
const PENTA = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86]; // D major pentatonic, D4..D6
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const RHYTHMS = [ // melody rhythm templates over 2 bars (32 sixteenths): [step, lengthInSteps]
  [[0, 3], [3, 3], [6, 2], [10, 6], [20, 2], [22, 2], [24, 8]],
  [[2, 2], [4, 4], [8, 2], [10, 2], [12, 8], [24, 3], [27, 5]],
  [[0, 6], [6, 2], [8, 6], [16, 2], [18, 2], [20, 4], [26, 6]],
  [[4, 2], [6, 2], [8, 4], [14, 2], [16, 8], [28, 4]],
  [[0, 2], [2, 2], [4, 2], [6, 6], [16, 2], [18, 2], [20, 2], [22, 10]],
];

export function createMusic() {
  let ctx = null, running = false, userOff = false, timer = null;
  let ambOn = false, ambUserOff = false, ambTimer = null, amb, ambOut, ambVerbIn, ambVol = 0.8, windG, scape = null, mix;
  let master, musicBus, lofi, shaper, drumBus, verb, verbIn, delay, delayIn, duck, analyser, wow, out, vol = 0.7;
  let noiseBuf, crackleSrc, windSrc, trainGain, trainPan, trainLP;
  const ksCache = new Map();
  let mood = MOODS.sunset, pendingMood = null;
  let step = 0, bar = 0, nextTime = 0, phrase = null, phraseBar = -1, melodyPrev = 69;
  const kickTimes = [];
  let lastChime = 0, trainLevel = 0, lastClack = 0;
  let rainGain, rainHiss, weatherLP, rainLevel = 0, lastDrip = 0, lastThunder = 0, streamDest = null;
  let fileSrc = null, fileName = '', bassAvg = 0, filePulse = 0;
  const listeners = new Set();
  let wbBuf = null;

  // ------------------------------------------------------------------ graph
  function impulse(sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  function init() {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    // music: master (volume) -> out (on/off fade) -> analyser -> mix
    // city:  amb (volume) -> ambOut (on/off fade) -> mix
    // mix -> weather low-pass -> compressor -> speakers (and clip recording)
    out = ctx.createGain(); out.gain.value = 0;
    mix = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    analyser = ctx.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.82;
    master = ctx.createGain(); master.gain.value = vol;
    weatherLP = ctx.createBiquadFilter(); weatherLP.type = 'lowpass'; weatherLP.frequency.value = 20000; weatherLP.Q.value = 0.4;
    master.connect(out).connect(analyser).connect(mix);
    mix.connect(weatherLP).connect(comp).connect(ctx.destination);
    mix._comp = comp;
    mix._meter = ctx.createAnalyser(); mix._meter.fftSize = 1024; comp.connect(mix._meter);
    ambOut = ctx.createGain(); ambOut.gain.value = 0;
    amb = ctx.createGain(); amb.gain.value = ambVol;
    amb.connect(ambOut).connect(mix);

    // lo-fi bus: soft saturation + wobbling low-pass
    musicBus = ctx.createGain();
    duck = ctx.createGain();
    shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(1.6 * x) / Math.tanh(1.6); }
    shaper.curve = curve;
    lofi = ctx.createBiquadFilter(); lofi.type = 'lowpass'; lofi.frequency.value = mood.lpf; lofi.Q.value = 0.5;
    const wob = ctx.createOscillator(); wob.frequency.value = 0.13;
    const wobG = ctx.createGain(); wobG.gain.value = 350;
    wob.connect(wobG).connect(lofi.frequency); wob.start();
    musicBus.connect(duck).connect(shaper).connect(lofi).connect(master);

    drumBus = ctx.createGain(); drumBus.gain.value = 0.9;
    const dLP = ctx.createBiquadFilter(); dLP.type = 'lowpass'; dLP.frequency.value = 7500;
    const dHP = ctx.createBiquadFilter(); dHP.type = 'highpass'; dHP.frequency.value = 35;
    drumBus.connect(dLP).connect(dHP).connect(master);

    verbIn = ctx.createGain(); verb = ctx.createConvolver(); verb.buffer = impulse(4.2, 2.8);
    const verbOut = ctx.createGain(); verbOut.gain.value = 0.9;
    const verbLP = ctx.createBiquadFilter(); verbLP.type = 'lowpass'; verbLP.frequency.value = 5200;
    verbIn.connect(verb).connect(verbLP).connect(verbOut).connect(master);
    // the city has its own (wider, darker) space
    ambVerbIn = ctx.createGain();
    const ambVerb = ctx.createConvolver(); ambVerb.buffer = impulse(3.4, 2.2);
    const ambVerbLP = ctx.createBiquadFilter(); ambVerbLP.type = 'lowpass'; ambVerbLP.frequency.value = 3800;
    const ambVerbOut = ctx.createGain(); ambVerbOut.gain.value = 0.7;
    ambVerbIn.connect(ambVerb).connect(ambVerbLP).connect(ambVerbOut).connect(amb);

    delayIn = ctx.createGain();
    delay = ctx.createDelay(2);
    const fb = ctx.createGain(); fb.gain.value = 0.36;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2600;
    delayIn.connect(delay); delay.connect(dlp).connect(fb).connect(delay);
    dlp.connect(verbIn); dlp.connect(musicBus);

    // tape wow shared by every keys oscillator
    const wl = ctx.createOscillator(); wl.frequency.value = 0.55;
    wow = ctx.createGain(); wow.gain.value = 7; // cents
    wl.connect(wow); wl.start();

    // shared white noise
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // vinyl crackle bed
    const cb = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const cd = cb.getChannelData(0);
    for (let i = 0; i < cd.length; i++) {
      cd[i] = (Math.random() * 2 - 1) * 0.012;
      if (Math.random() < 0.00035) { const a = (Math.random() * 0.6 + 0.2) * (Math.random() < 0.5 ? -1 : 1); for (let k = 0; k < 40 && i + k < cd.length; k++) cd[i + k] += a * Math.exp(-k / 6); }
    }
    crackleSrc = ctx.createBufferSource(); crackleSrc.buffer = cb; crackleSrc.loop = true;
    const chp = ctx.createBiquadFilter(); chp.type = 'highpass'; chp.frequency.value = 900;
    const cg = ctx.createGain(); cg.gain.value = 0.22;
    crackleSrc.connect(chp).connect(cg).connect(master); crackleSrc.start();

    // evening wind
    const wb = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const wd = wb.getChannelData(0); let last = 0;
    for (let i = 0; i < wd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; wd[i] = last * 3.5; }
    wbBuf = () => wb;
    windSrc = ctx.createBufferSource(); windSrc.buffer = wb; windSrc.loop = true;
    const wlp = ctx.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 480;
    const wg = ctx.createGain(); wg.gain.value = 0.1;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.06;
    lfo.connect(lfoG).connect(wg.gain); lfo.start();
    windG = ctx.createGain(); windG.gain.value = 1;
    windSrc.connect(wlp).connect(wg).connect(windG).connect(amb); windSrc.start();

    // rain: a hiss bed + a lower patter, gain driven by the weather
    rainGain = ctx.createGain(); rainGain.gain.value = 0;
    rainHiss = ctx.createBufferSource(); rainHiss.buffer = noiseBuf; rainHiss.loop = true;
    const rhp = ctx.createBiquadFilter(); rhp.type = 'highpass'; rhp.frequency.value = 1800;
    const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 9000;
    const rhg = ctx.createGain(); rhg.gain.value = 0.16;
    rainHiss.connect(rhp).connect(rlp).connect(rhg).connect(rainGain);
    const rp = ctx.createBufferSource(); rp.buffer = wbBuf(); rp.loop = true; rp.playbackRate.value = 3.2;
    const rpb = ctx.createBiquadFilter(); rpb.type = 'bandpass'; rpb.frequency.value = 700; rpb.Q.value = 0.6;
    const rpg = ctx.createGain(); rpg.gain.value = 0.5;
    rp.connect(rpb).connect(rpg).connect(rainGain);
    rainGain.connect(amb);
    rainHiss.start(); rp.start();

    // train: rumble bed (gain/pan driven from the scene)
    const rs = ctx.createBufferSource(); rs.buffer = wb; rs.loop = true; rs.playbackRate.value = 0.6;
    trainLP = ctx.createBiquadFilter(); trainLP.type = 'lowpass'; trainLP.frequency.value = 160;
    trainGain = ctx.createGain(); trainGain.gain.value = 0;
    trainPan = ctx.createStereoPanner();
    rs.connect(trainLP).connect(trainGain).connect(trainPan).connect(amb);
    rs.start();

    scape = createSoundscape(ctx, { out: amb, verbIn: ambVerbIn, noise: noiseBuf, brown: wb });
  }

  // --------------------------------------------------------------- voices
  const env = (g, t, a, peak, d, sus, rel, end) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(sus, t + a, d);
    g.gain.setTargetAtTime(0.0001, end, rel);
  };

  // Rhodes-ish FM electric piano
  function epiano(m, t, dur, vel, dest = musicBus) {
    const f = mtof(m);
    const car = ctx.createOscillator(); car.frequency.value = f; wow.connect(car.detune);
    const mod = ctx.createOscillator(); mod.frequency.value = f;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 2.2 * vel, t); mg.gain.setTargetAtTime(f * 0.35, t, 0.35);
    const tine = ctx.createOscillator(); tine.frequency.value = f * 14;
    const tg = ctx.createGain(); tg.gain.setValueAtTime(f * 0.9 * vel, t); tg.gain.setTargetAtTime(0, t, 0.05);
    mod.connect(mg).connect(car.frequency); tine.connect(tg).connect(car.frequency);
    const a = ctx.createGain();
    env(a, t, 0.006, 0.16 * vel, 0.9, 0.05 * vel, 0.18, t + dur);
    const pan = ctx.createStereoPanner(); pan.pan.value = (m - 62) / 30;
    car.connect(a).connect(pan); pan.connect(dest);
    const vs = ctx.createGain(); vs.gain.value = mood.verb; pan.connect(vs).connect(verbIn);
    const end = t + dur + 1.2;
    for (const o of [car, mod, tine]) { o.start(t); o.stop(end); }
  }

  // Karplus-Strong koto pluck, pre-rendered per pitch
  function ksBuffer(m) {
    if (ksCache.has(m)) return ksCache.get(m);
    const sr = ctx.sampleRate, f = mtof(m), N = Math.max(2, Math.round(sr / f)), len = Math.floor(sr * 2.4);
    const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    const ring = new Float32Array(N);
    let p = 0;
    for (let i = 0; i < N; i++) { p = p * 0.45 + (Math.random() * 2 - 1) * 0.55; ring[i] = p; }
    let idx = 0;
    const damp = 0.9965 - Math.max(0, m - 76) * 0.0006;
    for (let i = 0; i < len; i++) {
      const cur = ring[idx], nxt = ring[(idx + 1) % N];
      ring[idx] = (cur * 0.52 + nxt * 0.48) * damp;
      d[i] = cur;
      idx = (idx + 1) % N;
    }
    ksCache.set(m, buf);
    return buf;
  }
  function koto(m, t, vel, bend = false) {
    const s = ctx.createBufferSource(); s.buffer = ksBuffer(m);
    if (bend) { s.playbackRate.setValueAtTime(1, t + 0.18); s.playbackRate.linearRampToValueAtTime(1.0595, t + 0.32); }
    const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 2100; body.gain.value = 5; body.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.value = 0.32 * vel;
    const pan = ctx.createStereoPanner(); pan.pan.value = 0.25;
    s.connect(body).connect(g).connect(pan);
    pan.connect(musicBus);
    const ds = ctx.createGain(); ds.gain.value = 0.32; pan.connect(ds).connect(delayIn);
    const vs = ctx.createGain(); vs.gain.value = mood.verb + 0.15; pan.connect(vs).connect(verbIn);
    s.start(t); s.stop(t + 2.4);
  }

  function bass(m, t, dur, vel) {
    const f = mtof(m);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2;
    const g2 = ctx.createGain(); g2.gain.value = 0.18;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const a = ctx.createGain();
    env(a, t, 0.01, 0.42 * vel, 0.4, 0.26 * vel, 0.08, t + dur);
    o.connect(lp); o2.connect(g2).connect(lp); lp.connect(a).connect(master);
    for (const x of [o, o2]) { x.start(t); x.stop(t + dur + 0.5); }
  }

  function pad(chord, t, dur) {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.3;
    const a = ctx.createGain();
    a.gain.setValueAtTime(0.0001, t);
    a.gain.linearRampToValueAtTime(mood.pad, t + dur * 0.35);
    a.gain.setTargetAtTime(0.0001, t + dur * 0.85, dur * 0.12);
    lp.connect(a); a.connect(musicBus);
    const vs = ctx.createGain(); vs.gain.value = 0.6; a.connect(vs).connect(verbIn);
    for (const m of chord) for (const det of [-9, 9]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur * 1.4);
    }
  }

  function noise(t, dur) { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.start(t, Math.random() * 0.5); s.stop(t + dur); return s; }

  function kick(t, vel) {
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.95 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(g).connect(drumBus); o.start(t); o.stop(t + 0.45);
    // side-chain pump on the music bus
    duck.gain.cancelScheduledValues(t);
    duck.gain.setValueAtTime(0.62, t); duck.gain.linearRampToValueAtTime(1, t + 0.28);
    kickTimes.push(t); if (kickTimes.length > 16) kickTimes.shift();
    for (const fn of listeners) setTimeout(fn, Math.max(0, (t - ctx.currentTime) * 1000));
  }
  function snare(t, vel) {
    const n = noise(t, 0.25);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.42 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    n.connect(bp).connect(g).connect(drumBus);
    const vs = ctx.createGain(); vs.gain.value = 0.18; g.connect(vs).connect(verbIn);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 185;
    const og = ctx.createGain(); og.gain.setValueAtTime(0.22 * vel, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og).connect(drumBus); o.start(t); o.stop(t + 0.12);
  }
  function hat(t, vel, open = false) {
    const n = noise(t, open ? 0.35 : 0.06);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7200;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.1 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + (open ? 0.3 : 0.045));
    const pan = ctx.createStereoPanner(); pan.pan.value = -0.2;
    n.connect(hp).connect(g).connect(pan).connect(drumBus);
  }

  function chime(t, gainScale = 1) {
    const f = mtof(PENTA[5 + Math.floor(Math.random() * 6)] + 12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.035 * gainScale, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 1.4 - 0.7;
    g.connect(pan); pan.connect(master);
    const vs = ctx.createGain(); vs.gain.value = 1.2; pan.connect(vs).connect(verbIn);
    for (const [r, a] of [[1, 1], [2.76, 0.4], [5.4, 0.15]]) {
      const o = ctx.createOscillator(); o.frequency.value = f * r;
      const og = ctx.createGain(); og.gain.value = a;
      o.connect(og).connect(g); o.start(t); o.stop(t + 3.5);
    }
  }

  function clack(t, lvl) {
    for (const dt of [0, 0.11]) {
      const n = noise(t + dt, 0.06);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 2;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.18 * lvl, t + dt); g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.05);
      n.connect(bp).connect(g).connect(trainPan);
    }
  }

  // rain drips on eaves / umbrellas
  function drip(t, lvl) {
    const o = ctx.createOscillator(); o.type = 'sine';
    const f = 1400 + Math.random() * 2400;
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.06);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.03 * lvl, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 1.6 - 0.8;
    o.connect(g).connect(pan).connect(amb); o.start(t); o.stop(t + 0.1);
  }
  function thunder(t, lvl) {
    const n = ctx.createBufferSource(); n.buffer = wbBuf(); n.playbackRate.value = 0.35 + Math.random() * 0.2;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(120, t + 5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.9 * lvl, t + 0.25 + Math.random() * 0.4);
    g.gain.setTargetAtTime(0.0001, t + 1.2, 1.4);
    n.connect(lp).connect(g).connect(amb); n.start(t); n.stop(t + 7);
    const vs = ctx.createGain(); vs.gain.value = 0.6; g.connect(vs).connect(ambVerbIn);
  }
  // fireworks: low thump + a crackle tail
  function boom(t, size, crackle) {
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.75 * size, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(g).connect(amb); o.start(t); o.stop(t + 1.5);
    const n = ctx.createBufferSource(); n.buffer = wbBuf(); n.playbackRate.value = 0.8;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.5 * size, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    n.connect(lp).connect(ng).connect(amb); n.start(t); n.stop(t + 2);
    const vs = ctx.createGain(); vs.gain.value = 0.5; ng.connect(vs).connect(ambVerbIn);
    if (crackle) for (let i = 0; i < 26; i++) {
      const ct = t + 0.9 + Math.random() * 1.6;
      const c = noise(ct, 0.02);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000 + Math.random() * 3000;
      const cg = ctx.createGain(); cg.gain.setValueAtTime(0.05 * size, ct); cg.gain.exponentialRampToValueAtTime(0.0001, ct + 0.018);
      const cp = ctx.createStereoPanner(); cp.pan.value = Math.random() * 1.2 - 0.6;
      c.connect(hp).connect(cg).connect(cp).connect(amb);
    }
  }

  // ------------------------------------------------- the walker's world
  // footsteps per surface, the shrine (coin, suzu bell, two claps), a vending
  // machine, car horns. All on the city channel, so N mutes them too.
  function sfxOut(pan = 0, verb = 0.06) {
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(amb);
    if (verb) { const v = ctx.createGain(); v.gain.value = verb; p.connect(v).connect(ambVerbIn); }
    return p;
  }
  const blip = (dest, t, type, f0, f1, a, peak, dec) => {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dec);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dec + 0.05);
  };
  const burst = (dest, t, type, f, q, peak, dec, a = 0.003) => {
    const n = noise(t, dec + 0.05);
    const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    n.connect(b).connect(g).connect(dest);
  };
  const STEP = { stone: [1500, 1.1, 0.055, 0.3], gravel: [2600, 0.6, 0.1, 0.24], grass: [800, 0.7, 0.08, 0.13], wood: [480, 2.2, 0.07, 0.34], snow: [1700, 0.5, 0.15, 0.2], wet: [2000, 0.8, 0.07, 0.24] };
  function footstep(t, surf, lvl, pan) {
    const o = sfxOut(pan, 0.04), P = STEP[surf] || STEP.stone, r = 0.9 + Math.random() * 0.2;
    burst(o, t, 'bandpass', P[0] * r, P[1], P[3] * lvl, P[2] * r);
    blip(o, t, 'sine', surf === 'wood' ? 150 : 100, 48, 0.003, (surf === 'grass' || surf === 'snow' ? 0.08 : 0.16) * lvl, 0.07);
    if (surf === 'snow' || surf === 'gravel') for (let i = 0; i < 7; i++) burst(o, t + 0.01 + Math.random() * 0.07, 'highpass', 2800 + Math.random() * 2500, 0.7, 0.06 * lvl, 0.012);
    if (surf === 'wet') {
      burst(o, t + 0.01, 'highpass', 3600, 0.6, 0.12 * lvl, 0.14, 0.01);
      blip(o, t + 0.02, 'sine', 1300 + Math.random() * 400, 650, 0.002, 0.03 * lvl, 0.05);
    }
  }
  function clap(t, pan) {
    const o = sfxOut(pan, 0.35);
    burst(o, t, 'bandpass', 1150, 0.9, 0.55, 0.09, 0.002);
    burst(o, t + 0.008, 'bandpass', 2300, 1.2, 0.25, 0.05, 0.002);
  }
  function suzu(t) {                       // the big shrine bell rattled by its rope
    const o = sfxOut(0, 0.4);
    for (let i = 0; i < 16; i++) {
      const tt = t + Math.pow(Math.random(), 1.6) * 0.75, f = 2300 + Math.random() * 1500;
      blip(o, tt, 'sine', f, f, 0.002, 0.05, 0.5 + Math.random() * 0.5);
      blip(o, tt, 'sine', f * 2.76, f * 2.76, 0.002, 0.018, 0.25);
    }
  }
  function coin(t) {
    const o = sfxOut(0, 0.2);
    for (const [dt, f] of [[0, 3400], [0.16, 4100], [0.27, 2900]]) { blip(o, t + dt, 'sine', f, f, 0.001, 0.07, 0.18); blip(o, t + dt, 'sine', f * 1.5, f * 1.5, 0.001, 0.03, 0.08); }
    burst(o, t + 0.42, 'bandpass', 900, 1.5, 0.15, 0.08);   // into the wooden box
  }
  function vending(t) {
    const o = sfxOut(0, 0.12);
    blip(o, t, 'sine', 1320, 1320, 0.005, 0.05, 0.12);        // button beep
    blip(o, t + 0.5, 'sine', 90, 42, 0.004, 0.5, 0.25);       // gakon!
    burst(o, t + 0.5, 'lowpass', 420, 0.8, 0.45, 0.2);
    blip(o, t + 0.52, 'triangle', 620, 600, 0.002, 0.06, 0.35); // can rings in the tray
    burst(o, t + 0.68, 'bandpass', 1800, 2, 0.08, 0.06);
  }
  function honk(t, lvl, pan) {
    const o = sfxOut(pan, 0.15);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1900; lp.connect(o);
    for (const [dt, d] of [[0, 0.16], [0.24, 0.32]]) for (const f of [415, 523]) {
      const v = ctx.createOscillator(); v.type = 'square'; v.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + dt); g.gain.linearRampToValueAtTime(0.06 * lvl, t + dt + 0.01); g.gain.setValueAtTime(0.06 * lvl, t + dt + d); g.gain.linearRampToValueAtTime(0.0001, t + dt + d + 0.03);
      v.connect(g).connect(lp); v.start(t + dt); v.stop(t + dt + d + 0.05);
    }
  }

  // ------------------------------------------------------------ composer
  function section() {
    if (bar < 4) return 'intro';
    const s = Math.floor((bar - 4) / 8) % 4;
    return ['A', 'B', 'B2', 'break'][s];
  }

  function newPhrase() {
    const r = RHYTHMS[Math.floor(Math.random() * RHYTHMS.length)];
    const notes = [];
    let idx = PENTA.indexOf(melodyPrev); if (idx < 0) idx = 3;
    for (let k = 0; k < r.length; k++) {
      const mv = [-2, -1, -1, 0, 1, 1, 2, 3][Math.floor(Math.random() * 8)];
      idx = Math.max(1, Math.min(PENTA.length - 2, idx + mv));
      notes.push([r[k][0], r[k][1], PENTA[idx], Math.random() < 0.18]);
    }
    melodyPrev = PENTA[idx];
    return notes;
  }

  function playStep(s, t) {
    const sixteenth = 60 / mood.bpm / 4;
    const sec = section();
    const [root, chord] = mood.prog[bar % mood.prog.length];
    const barDur = sixteenth * 16;
    const hum = () => (Math.random() - 0.5) * 0.008;

    if (s === 0) {
      if (sec !== 'A' || bar % 2 === 0) pad(chord, t, barDur * (sec === 'break' || sec === 'intro' ? 1 : 1));
      if (Math.random() < 0.35 && t - lastChime > 6) { chime(t + barDur * Math.random()); lastChime = t; }
    }
    // keys comping
    const comp = sec === 'intro' || sec === 'break' ? [[0, 14]] : [[0, 6], [6, 3], [10, 6]];
    for (const [cs, cl] of comp) if (cs === s) chord.forEach((m, i) => epiano(m, t + i * 0.014 + hum(), cl * sixteenth, s === 0 ? 0.9 : 0.6));

    const drumsOn = sec !== 'intro' && sec !== 'break';
    if (drumsOn) {
      const style = mood.drums;
      const kicks = style === 'half' ? [0, 10] : style === 'lazy' ? [0, 7, 10] : [0, 10, 11];
      if (kicks.includes(s) && !(s === 11 && Math.random() < 0.6)) kick(t, s === 0 ? 1 : 0.8);
      const snares = style === 'half' ? [8] : [4, 12];
      if (snares.includes(s)) snare(t + 0.012, 1);
      else if ((s === 7 || s === 15) && Math.random() < 0.25) snare(t, 0.25);
      if (s % 2 === 0 && style !== 'half') hat(t + hum(), s % 4 === 0 ? 0.9 : 0.55, s === 14 && Math.random() < 0.3);
      if (style === 'half' && s % 4 === 2) hat(t, 0.5);
      if (sec === 'B2' && s % 2 === 1 && Math.random() < 0.35) hat(t, 0.3);
      // bass
      if (s === 0) bass(root, t, sixteenth * 9, 1);
      if (s === 10) bass(root + (Math.random() < 0.5 ? 12 : 7), t, sixteenth * 4, 0.8);
      if (s === 14 && Math.random() < 0.5) bass(root + 12 - 2, t, sixteenth * 2, 0.6);
    }
    // koto melody in B sections
    if ((sec === 'B' || sec === 'B2' || sec === 'break') && Math.random() < 1) {
      if (bar % 2 === 0 && s === 0 && phraseBar !== bar) {
        if (!phrase || bar % 4 === 0) phrase = newPhrase();
        phraseBar = bar;
      }
      if (phrase) {
        const local = (bar % 2) * 16 + s;
        for (const [ps, , m, bend] of phrase) if (ps === local && Math.random() < mood.mel + 0.3) koto(m, t + hum(), 0.9, bend);
      }
    }
  }

  function scheduler() {
    if (!running) return;
    const ahead = document.hidden ? 1.5 : 0.25;
    if (fileSrc) { nextTime = ctx.currentTime + 0.05; return; }
    while (nextTime < ctx.currentTime + ahead) {
      const sixteenth = 60 / mood.bpm / 4;
      const swing = step % 2 === 1 ? sixteenth * mood.swing : 0;
      playStep(step, nextTime + swing);
      step++;
      nextTime += sixteenth;
      if (step === 16) {
        step = 0; bar++;
        if (pendingMood) { mood = pendingMood; pendingMood = null; lofi.frequency.setTargetAtTime(mood.lpf, nextTime, 1.5); }
      }
    }
  }

  // the city channel: weather one-shots, train clacks and the soundscape
  function ambScheduler() {
    if (!ambOn) return;
    const t = ctx.currentTime;
    if (rainLevel > 0.05) {
      if (t - lastDrip > 0.12 && Math.random() < rainLevel * 0.35 * 2) { drip(t + 0.05 + Math.random() * 0.1, rainLevel); lastDrip = t; }
      if (rainLevel > 0.6 && t - lastThunder > 28 && Math.random() < 0.008) { thunder(t + 0.1, rainLevel); lastThunder = t; }
    }
    // train clacks follow the scene's proximity
    if (trainLevel > 0.04 && t - lastClack > 1.15) { clack(t + 0.05, trainLevel); lastClack = t; }
    scape.tick();
  }
  function ensure() {
    if (!ctx) init();
    if (ctx.state !== 'running') ctx.resume();
  }

  // ------------------------------------------------------------- API
  return {
    get on() { return running; },
    get userOff() { return userOff; },
    get mood() { return fileSrc ? { name: fileName, jp: '持ち込み', bpm: '—' } : pendingMood || mood; },
    get fileMode() { return !!fileSrc; },
    start() {
      ensure();
      if (running) return;
      running = true; userOff = false;
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
      out.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5);
      bar = 0; step = 0; phrase = null;
      nextTime = ctx.currentTime + 0.1;
      timer = setInterval(scheduler, 25);
      scheduler();
    },
    stop(byUser = true) {
      if (byUser) userOff = true;
      if (!running) return;
      running = false;
      if (fileSrc) { const f = fileSrc; fileSrc = null; try { f.stop(ctx.currentTime + 1.3); } catch (e) { /* already stopped */ } }
      clearInterval(timer);
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
      out.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
    },
    setVolume(v) { vol = v; if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05); },
    get volume() { return vol; },

    // ---- city sound (環境音): independent of the music
    get ambOn() { return ambOn; },
    get ambUserOff() { return ambUserOff; },
    // the first user gesture unlocks audio; the city starts unless muted
    unlock() { if (ambUserOff && !running) return; ensure(); if (!ambUserOff) this.startAmbience(); },
    startAmbience() {
      ensure();
      ambUserOff = false;
      if (ambOn) return;
      ambOn = true;
      ambOut.gain.cancelScheduledValues(ctx.currentTime);
      ambOut.gain.setValueAtTime(ambOut.gain.value, ctx.currentTime);
      ambOut.gain.linearRampToValueAtTime(1, ctx.currentTime + 2);
      rainGain.gain.setTargetAtTime(rainLevel * 0.55, ctx.currentTime, 0.6);
      ambTimer = setInterval(ambScheduler, 50);
    },
    stopAmbience(byUser = true) {
      if (byUser) ambUserOff = true;
      if (!ambOn) return;
      ambOn = false;
      clearInterval(ambTimer);
      ambOut.gain.cancelScheduledValues(ctx.currentTime);
      ambOut.gain.setValueAtTime(ambOut.gain.value, ctx.currentTime);
      ambOut.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
    },
    setAmbVolume(v) { ambVol = v; if (amb) amb.gain.setTargetAtTime(v, ctx.currentTime, 0.05); },
    get ambVolume() { return ambVol; },
    // where the listener is and what the world is doing (see soundscape.js)
    setScene(o) {
      if (!scape) return;
      scape.set(o);
      if (windG) windG.gain.setTargetAtTime(0.7 + Math.min(1.6, Math.max(0, (o.alt - 60) / 160)) + (o.season === 'winter' ? 0.5 : 0), ctx.currentTime, 1);
    },
    get scape() { return scape; },
    get audible() { return running || ambOn; },
    setMood(key) {
      const m = MOODS[key];
      if (!m || m === mood || m === pendingMood) return;
      if (!running) { mood = m; return; }
      pendingMood = m;
    },
    // gentle bell swell on cinematic cuts
    accent() {
      if (!running) return;
      const t = ctx.currentTime + 0.05;
      chime(t, 1.4); chime(t + 0.18, 1.0);
      const [, chord] = mood.prog[bar % mood.prog.length];
      chord.forEach((m, i) => epiano(m + 12, t + i * 0.05, 1.5, 0.45));
    },
    // 0..1 envelope that peaks on each kick (for visuals)
    pulse() {
      if (!running || !ctx) return 0;
      if (fileSrc) {
        // dropped track: onset detector on the low end
        const d = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(d);
        const e = (d[1] + d[2] + d[3]) / 765;
        bassAvg += (e - bassAvg) * 0.05;
        filePulse = Math.max(filePulse * 0.86, Math.min(1, Math.max(0, (e - bassAvg * 1.08) * 6)));
        return filePulse;
      }
      const now = ctx.currentTime;
      let p = 0;
      for (const k of kickTimes) if (k <= now) p = Math.max(p, Math.exp(-(now - k) * 7));
      return p;
    },
    onBeat(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // seconds until the next bar line (for beat-synced cuts); null when silent
    timeToNextBar() {
      if (!running || !ctx || fileSrc) return null;
      const sixteenth = 60 / mood.bpm / 4;
      return nextTime + ((16 - step) % 16) * sixteenth - ctx.currentTime;
    },
    get barLength() { return (60 / mood.bpm) * 4; },
    // weather ambience: rain level 0..1, snow muffles the mix
    setWeather(rain, snow) {
      rainLevel = rain;
      if (!ctx) return;
      rainGain.gain.setTargetAtTime(ambOn ? rain * 0.55 : 0, ctx.currentTime, 0.6);
      weatherLP.frequency.setTargetAtTime(20000 - snow * 15500, ctx.currentTime, 0.8);
    },
    // a firework heard `delay` seconds after it bursts
    boom(delay, size = 1, crackle = false) {
      if (!ambOn || !ctx) return;
      boom(ctx.currentTime + delay, size, crackle);
    },
    // little sounds from the walker's world (see walkmode.js)
    sfx(name, o = {}) {
      if (!ambOn || !ctx) return;
      const t = ctx.currentTime + 0.01;
      if (name === 'step') footstep(t, o.surf, o.lvl ?? 0.6, o.pan ?? 0);
      else if (name === 'land') { footstep(t, o.surf, 1.2, 0); blip(sfxOut(0, 0.1), t, 'sine', 120, 40, 0.004, 0.3 * (o.lvl ?? 1), 0.16); }
      else if (name === 'clap') { clap(t, -0.05); clap(t + 0.36, 0.05); }
      else if (name === 'suzu') suzu(t);
      else if (name === 'coin') coin(t);
      else if (name === 'vending') vending(t);
      else if (name === 'honk') honk(t, o.lvl ?? 1, o.pan ?? 0);
      else if (name === 'bell') scape.bell();
    },
    // audio for clip recording
    stream() {
      ensure();
      if (!streamDest) { streamDest = ctx.createMediaStreamDestination(); mix._comp.connect(streamDest); }
      return streamDest.stream;
    },
    // drop in your own track: the city reacts to it instead of Afterglow FM
    async playFile(file) {
      ensure();
      const buf = await ctx.decodeAudioData(await file.arrayBuffer());
      if (fileSrc) { try { fileSrc.stop(); } catch (e) { /* noop */ } }
      if (!running) this.start();
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const g = ctx.createGain(); g.gain.value = 0.9;
      src.connect(g).connect(master);
      src.start(ctx.currentTime + 0.1);
      fileSrc = src; fileName = file.name.replace(/\.[^.]+$/, '').slice(0, 40);
      bassAvg = 0; filePulse = 0;
    },
    setTrain(level, pan) {
      trainLevel = level;
      if (!ctx) return;
      trainGain.gain.setTargetAtTime(ambOn ? level * 0.9 : 0, ctx.currentTime, 0.2);
      trainPan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), ctx.currentTime, 0.2);
    },
    // debug: peak sample + current bar/section
    meter() {
      if (!analyser) return null;
      const d = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(d);
      let pk = 0; for (const v of d) pk = Math.max(pk, Math.abs(v));
      const m = new Float32Array(mix._meter.fftSize); mix._meter.getFloatTimeDomainData(m);
      let all = 0; for (const v of m) all = Math.max(all, Math.abs(v));
      return { peak: pk, mixPeak: all, bar, section: section(), mood: mood.name, state: ctx.state, music: running, city: ambOn };
    },
    // 5 spectrum bands 0..1 for the equaliser
    bands(out5) {
      if (!analyser || !running) { out5.fill(0); return out5; }
      const d = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(d);
      const edges = [1, 3, 7, 15, 30, 60];
      for (let b = 0; b < 5; b++) {
        let s = 0;
        for (let i = edges[b]; i < edges[b + 1]; i++) s += d[i];
        out5[b] = s / (edges[b + 1] - edges[b]) / 255;
      }
      return out5;
    },
  };
}
