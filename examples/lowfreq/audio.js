// Low Frequency — everything you hear is synthesised here.
// Each track is an 8-bar loop rendered once into an AudioBuffer with an OfflineAudioContext
// (kick, snare/clap, hats, bass, FM Rhodes, pads, tape wobble, vinyl crackle), then played by a
// deck that follows the platter: playbackRate = platter speed, backwards via a reversed buffer.

const hz = m => 440 * 2 ** ((m - 69) / 12);
function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Chord = bass root + upper voicing (MIDI).
const C = (bass, ...v) => ({ bass, v });
export const TRACKS = [
  { id: 'A1', title: 'Last Train, Shimokita', bpm: 122, time: '4:12', style: 'house', swing: 0.54, seed: 11,
    scale: [65, 68, 70, 72, 75, 77, 80],
    prog: [C(41, 56, 60, 63, 67), C(41, 56, 60, 63, 67), C(37, 53, 56, 60, 63), C(39, 55, 58, 60, 65),
           C(41, 56, 60, 63, 67), C(41, 56, 60, 63, 68), C(37, 53, 56, 60, 63), C(36, 51, 55, 58, 62)] },
  { id: 'A2', title: 'Aubergine Hours', bpm: 84, time: '5:03', style: 'hop', swing: 0.63, seed: 23,
    scale: [62, 64, 65, 67, 69, 72, 74, 76],
    prog: [C(38, 53, 57, 60, 64), C(43, 53, 59, 64, 69), C(36, 52, 55, 59, 62), C(45, 55, 61, 65, 69),
           C(38, 53, 57, 60, 64), C(43, 53, 59, 64, 69), C(36, 52, 55, 59, 62), C(45, 55, 61, 65, 68)] },
  { id: 'A3', title: 'Seat Seven', bpm: 118, time: '3:48', style: 'deep', swing: 0.56, seed: 37,
    scale: [69, 72, 74, 76, 79, 81, 84],
    prog: [C(45, 60, 64, 67, 71), C(41, 57, 60, 64, 67), C(45, 60, 64, 67, 71), C(43, 59, 62, 64, 69),
           C(45, 60, 64, 67, 71), C(41, 57, 60, 64, 67), C(38, 57, 60, 64, 65), C(40, 55, 59, 62, 67)] },
  { id: 'A4', title: 'Needle Rain', bpm: 96, time: '6:20', style: 'dub', swing: 0.52, seed: 41,
    scale: [63, 65, 67, 70, 72, 75],
    prog: [C(39, 55, 58, 62, 65), C(39, 55, 58, 62, 65), C(44, 55, 60, 62, 63), C(44, 55, 60, 62, 63),
           C(41, 56, 58, 63, 67), C(41, 56, 58, 63, 67), C(46, 56, 60, 63, 65), C(46, 56, 60, 63, 65)] },
];

function makeCurve(k) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}
function impulse(ctx, secs, decay, R) {
  const len = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch); let lp = 0;
    for (let i = 0; i < len; i++) { const w = R() * 2 - 1; lp += (w - lp) * (0.35 - 0.3 * i / len); d[i] = lp * Math.pow(1 - i / len, decay); }
  }
  return b;
}

export async function renderTrack(def, sampleRate = 44100) {
  const R = rng(def.seed);
  const S0 = def.style;
  const spb = 60 / def.bpm, st = spb / 4, bar = spb * 4, bars = def.prog.length;
  const dur = bars * bar, tail = 3.5;
  const len = Math.ceil((dur + tail) * sampleRate);
  const ctx = new OfflineAudioContext(2, len, sampleRate);
  const sr = sampleRate;

  const noise = ctx.createBuffer(1, sr * 2, sr);
  { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = R() * 2 - 1; }

  // Master: mix -> wow/flutter -> tape saturation -> band limit -> glue compression.
  const out = ctx.createGain(); out.gain.value = 0.62;
  const sat = ctx.createWaveShaper(); sat.curve = makeCurve(1.5); sat.oversample = '2x';
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 28;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = def.style === 'hop' ? 6800 : 9800; lp.Q.value = 0.4;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.006; comp.release.value = 0.18; comp.knee.value = 8;
  out.connect(sat).connect(hp).connect(lp).connect(comp).connect(ctx.destination);
  const mix = ctx.createGain();
  const wow = ctx.createDelay(0.1); wow.delayTime.value = 0.02;
  const w1 = ctx.createOscillator(), w1g = ctx.createGain(); w1.frequency.value = 0.47; w1g.gain.value = 0.0011;
  const w2 = ctx.createOscillator(), w2g = ctx.createGain(); w2.frequency.value = 5.9; w2g.gain.value = 0.00012;
  w1.connect(w1g).connect(wow.delayTime); w2.connect(w2g).connect(wow.delayTime); w1.start(0); w2.start(0);
  mix.connect(wow).connect(out);

  // Sends: room reverb and a tape echo.
  const verb = ctx.createConvolver(); verb.buffer = impulse(ctx, 2.6, 2.6, R);
  const verbIn = ctx.createGain(); verbIn.gain.value = def.style === 'dub' ? 0.5 : 0.28;
  verbIn.connect(verb).connect(mix);
  const echo = ctx.createDelay(2); echo.delayTime.value = spb * 0.75;
  const echoFb = ctx.createGain(); echoFb.gain.value = def.style === 'dub' ? 0.55 : 0.32;
  const echoLp = ctx.createBiquadFilter(); echoLp.type = 'lowpass'; echoLp.frequency.value = 2200;
  const echoIn = ctx.createGain(); echoIn.gain.value = 0.5;
  echoIn.connect(echo); echo.connect(echoLp).connect(echoFb).connect(echo); echoLp.connect(mix); echoLp.connect(verbIn);

  const drums = ctx.createGain(); drums.gain.value = 0.9; drums.connect(mix);
  const bassBus = ctx.createGain(); bassBus.gain.value = S0 === 'hop' ? 0.5 : 0.42;
  const bassLp = ctx.createBiquadFilter(); bassLp.type = 'lowpass'; bassLp.frequency.value = 900;
  bassBus.connect(bassLp).connect(mix);
  // Rhodes bus: tremolo autopan + sidechain duck from the kick.
  const keys = ctx.createGain(); keys.gain.value = def.style === 'hop' ? 0.78 : 0.62;
  const pan = ctx.createStereoPanner();
  const tl = ctx.createOscillator(), tlg = ctx.createGain(); tl.frequency.value = def.style === 'hop' ? 3.2 : 4.4; tlg.gain.value = 0.42;
  tl.connect(tlg).connect(pan.pan); tl.start(0);
  const duck = ctx.createGain();
  keys.connect(pan).connect(duck).connect(mix);
  keys.connect(verbIn);
  const duckOn = def.style === 'house' || def.style === 'deep';

  const at = (b, s) => {
    // time of 16th step s in bar b, with swing on off-16ths (or off-8ths for hip-hop)
    let t = b * bar + s * st;
    if (def.style === 'hop') { if (s % 4 === 2) t += (def.swing - 0.5) * 2 * (st * 2); }
    else if (s % 2 === 1) t += (def.swing - 0.5) * 2 * st;
    return Math.max(0, t + (R() - 0.5) * 0.006);
  };

  const noiseHit = (t, dur, type, f, v, dest, q = 0.7) => {
    const s = ctx.createBufferSource(); s.buffer = noise;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g); for (const d of [dest].flat()) g.connect(d);
    s.start(t, R() * 1.6, dur + 0.03);
  };
  const tone = (t, f0, f1, dur, v, type, dest) => {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); for (const d of [dest].flat()) g.connect(d);
    o.start(t); o.stop(t + dur + 0.02);
  };
  const kick = (t, v = 1) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(165, t); o.frequency.exponentialRampToValueAtTime(58, t + 0.07); o.frequency.exponentialRampToValueAtTime(43, t + 0.4);
    v *= 1.2;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(v * 0.35, t + 0.13); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(drums); o.start(t); o.stop(t + 0.52);
    noiseHit(t, 0.012, 'highpass', 1800, 0.22 * v, drums);
    if (duckOn) { duck.gain.setTargetAtTime(0.42, t, 0.004); duck.gain.setTargetAtTime(1, t + 0.04, 0.085); }
  };
  const snare = (t, v = 1) => {
    noiseHit(t, 0.22, 'bandpass', 1900, 0.55 * v, [drums, verbIn], 0.6);
    tone(t, 200, 150, 0.1, 0.32 * v, 'triangle', drums);
  };
  const clap = (t, v = 1) => {
    for (let k = 0; k < 3; k++) noiseHit(t + k * 0.011, 0.018, 'bandpass', 1250, 0.45 * v, drums, 1.3);
    noiseHit(t + 0.024, 0.2, 'bandpass', 1250, 0.4 * v, [drums, verbIn], 1);
  };
  const rim = (t, v = 1, dest = drums) => { noiseHit(t, 0.035, 'bandpass', 3100, 0.5 * v, dest, 3); tone(t, 1720, 1650, 0.025, 0.12 * v, 'square', dest); };
  const hat = (t, v, open = false) => noiseHit(t, open ? 0.24 : 0.035, 'highpass', open ? 7200 : 8200, v * 0.24, drums, 0.6);
  const shaker = (t, v) => noiseHit(t, 0.06, 'bandpass', 5600, v * 0.2, drums, 1.4);

  const bass = (t, m, dur, v = 1, sub = false) => {
    const f = hz(m);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = sub ? 'triangle' : 'sawtooth'; o2.frequency.value = f; o2.detune.value = 4;
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 3;
    fl.frequency.setValueAtTime(sub ? 400 : 1100, t); fl.frequency.exponentialRampToValueAtTime(sub ? 180 : 240, t + 0.22);
    const g2 = ctx.createGain(); g2.gain.value = sub ? 0.18 : 0.32;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * v, t + 0.008);
    g.gain.setTargetAtTime(0.62 * v, t + 0.02, 0.18);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.03);
    o.connect(g); o2.connect(fl).connect(g2).connect(g); g.connect(bassBus);
    o.start(t); o2.start(t); o.stop(t + dur + 0.25); o2.stop(t + dur + 0.25);
  };
  // FM electric piano: 1:1 modulator with decaying index (bright bark -> mellow), plus a tine partial.
  const rhodes = (t, m, dur, v = 0.6, dest = keys) => {
    const f = hz(m);
    const car = ctx.createOscillator(); car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.frequency.value = f;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * (0.7 + v * 1.9), t); mg.gain.exponentialRampToValueAtTime(f * 0.12, t + 1.1);
    mod.connect(mg).connect(car.frequency);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t); amp.gain.exponentialRampToValueAtTime(v * 0.2, t + 0.005);
    amp.gain.setTargetAtTime(v * 0.085, t + 0.012, 0.5);
    amp.gain.setTargetAtTime(0.0001, t + dur, 0.14);
    car.connect(amp).connect(dest);
    const tine = ctx.createOscillator(); tine.frequency.value = f * 7.05;
    const tg = ctx.createGain(); tg.gain.setValueAtTime(0.028 * v, t); tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    tine.connect(tg).connect(dest);
    const end = t + dur + 0.9;
    car.start(t); mod.start(t); tine.start(t); car.stop(end); mod.stop(end); tine.stop(t + 0.2);
  };
  const vibe = (t, m, v = 0.5) => {
    const f = hz(m);
    for (const [mul, a, d] of [[1, 1, 1.6], [4, 0.32, 0.35], [10.2, 0.08, 0.12]]) {
      const o = ctx.createOscillator(); o.frequency.value = f * mul;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v * 0.11 * a, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(keys); g.connect(echoIn); o.start(t); o.stop(t + d + 0.05);
    }
  };
  const pad = (t, notes, dur, v = 0.5) => {
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 0.8;
    fl.frequency.setValueAtTime(420, t); fl.frequency.linearRampToValueAtTime(1100, t + dur * 0.5); fl.frequency.linearRampToValueAtTime(500, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.05, t + 0.9);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.4);
    fl.connect(g); g.connect(duck); g.connect(verbIn);
    for (const m of notes) for (const d of [-7, 6]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = d;
      o.connect(fl); o.start(t); o.stop(t + dur + 2);
    }
  };

  // ── Arrangement ───────────────────────────────────────────────────────────
  const S = def.style;
  let lastLead = def.scale[2];
  for (let b = 0; b < bars; b++) {
    const ch = def.prog[b], next = def.prog[(b + 1) % bars];
    const hv = () => 0.75 + R() * 0.35;
    // drums
    for (let s = 0; s < 16; s++) {
      const t = at(b, s);
      if (S === 'house') {
        if (s % 4 === 0) kick(t, 0.95);
        if (s === 4 || s === 12) clap(t, 0.8);
        if (s % 4 === 2) hat(t, 0.7 * hv(), true);
        else if (s % 2 === 1) hat(t, 0.38 * hv());
        if (s % 2 === 1 && b % 2) shaker(t, 0.35 * hv());
      } else if (S === 'hop') {
        if (s === 0 || s === 10 || (s === 7 && b % 2 === 1) || (s === 15 && b % 4 === 3)) kick(t, s === 0 ? 1 : 0.8);
        if (s === 4 || s === 12) snare(t, 0.85 * hv());
        else if (R() < 0.1) snare(t, 0.12);
        if (s % 2 === 0) hat(t, (s % 4 === 0 ? 0.5 : 0.34) * hv());
        else if (R() < 0.22) hat(t, 0.14);
      } else if (S === 'deep') {
        if (s % 4 === 0) kick(t, 0.9);
        if (s === 4 || s === 12) rim(t, 0.55);
        if (s === 12 && b % 2 === 1) clap(t, 0.5);
        if (s % 4 === 2) hat(t, 0.55 * hv(), true);
        else hat(t, 0.16 * hv());
        if (s % 2 === 1) shaker(t, 0.45 * hv());
      } else { // dub: one drop
        if (s === 8 || (s === 0 && b % 2 === 0)) kick(t, 0.95);
        if (s === 8) rim(t, 0.7, [drums, echoIn]);
        if (s % 2 === 1 && R() < 0.55) hat(t, 0.2 * hv());
        if (s === 14 && b % 4 === 3) snare(t, 0.4);
      }
    }
    // bass
    const r = ch.bass;
    const bl = st * 0.95;
    if (S === 'house') {
      for (const s of [2, 6, 10, 14]) bass(at(b, s), r, bl * 1.6, 0.9);
      if (R() < 0.5) bass(at(b, 15), r + 12, bl * 0.7, 0.55);
    } else if (S === 'hop') {
      bass(at(b, 0), r, bl * 5.5, 1);
      bass(at(b, 6), r + 7, bl * 2, 0.7);
      bass(at(b, 10), r, bl * 3, 0.85);
      bass(at(b, 14), next.bass - 1, bl * 1.6, 0.6);
    } else if (S === 'deep') {
      bass(at(b, 0), r, bl * 2.5, 0.95); bass(at(b, 3), r, bl, 0.6); bass(at(b, 6), r + 12, bl, 0.55);
      bass(at(b, 8), r, bl * 2, 0.85); bass(at(b, 11), r + 7, bl, 0.6); bass(at(b, 14), r, bl * 1.5, 0.7);
    } else {
      bass(at(b, 0), r, bl * 6, 1, true); bass(at(b, 7), r, bl, 0.6, true); bass(at(b, 10), r + 7, bl * 4, 0.8, true);
    }
    // chords
    const strum = (t, len, v, gap = 0.008) => ch.v.forEach((m, k) => rhodes(t + k * gap + R() * 0.004, m, len, v * (0.85 + R() * 0.2)));
    if (S === 'house') {
      for (const [s, l] of [[0, 3], [3, 3], [7, 2], [10, 4]]) strum(at(b, s), l * st, 0.52, 0.004);
    } else if (S === 'hop') {
      strum(at(b, 0), st * 9.5, 0.62, 0.016);
      strum(at(b, 10), st * 5.5, 0.5, 0.014);
    } else if (S === 'deep') {
      for (const s of [2, 6, 10, 14]) strum(at(b, s), st * 1.1, 0.46, 0.003);
      if (b % 2 === 0) pad(at(b, 0), ch.v, bar * 2, 0.45);
    } else {
      pad(at(b, 0), ch.v, bar, 0.7);
      for (const s of [4, 12]) ch.v.forEach(m => rhodes(at(b, s), m, st * 0.8, 0.42, echoIn));
      for (const s of [4, 12]) ch.v.forEach(m => rhodes(at(b, s), m, st * 0.8, 0.36));
    }
    // a little melody in the second half
    if (b >= bars / 2 && S !== 'house') {
      for (let s = 0; s < 16; s += 2) {
        if (R() > (S === 'hop' ? 0.34 : 0.3)) continue;
        const i = def.scale.indexOf(lastLead);
        let j = Math.max(0, Math.min(def.scale.length - 1, (i < 0 ? 2 : i) + Math.round((R() - 0.5) * 4)));
        lastLead = def.scale[j];
        if (S === 'hop') rhodes(at(b, s), lastLead + 12, st * 3, 0.5);
        else vibe(at(b, s), lastLead + (S === 'dub' ? 12 : 0), 0.55);
      }
    }
    if (S === 'house' && b >= 4) for (const s of [3, 11]) if (R() < 0.6) vibe(at(b, s), def.scale[Math.floor(R() * def.scale.length)] + 12, 0.35);
  }
  if (S === 'dub') { // rain on the window
    const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = 0.035; s.connect(f).connect(g).connect(mix); s.start(0);
  }

  const rendered = await ctx.startRendering();
  // Fold the tail back onto the head so the loop is seamless.
  const n = Math.round(dur * sr);
  const buf = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr });
  let peak = 0;
  const chans = [0, 1].map(c => {
    const d = rendered.getChannelData(c), o = new Float32Array(n);
    o.set(d.subarray(0, n));
    for (let i = 0; i < len - n && i < n; i++) o[i] += d[n + i];
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(o[i]));
    return o;
  });
  // Surface noise and crackle, pressed into the same groove (so it scratches with the music).
  const k = 0.88 / Math.max(peak, 1e-3);
  const CR = rng(def.seed * 7 + 1);
  let hiss = 0;
  for (let i = 0; i < n; i++) {
    hiss += ((CR() * 2 - 1) - hiss) * 0.08;
    const h = hiss * 0.006;
    chans[0][i] = chans[0][i] * k + h; chans[1][i] = chans[1][i] * k + h * 0.9;
  }
  const pops = Math.floor(dur * 9);
  for (let p = 0; p < pops; p++) {
    const i0 = Math.floor(CR() * (n - 64));
    const a = (CR() < 0.08 ? 0.16 : 0.035) * (0.4 + CR());
    const side = CR();
    for (let j = 0; j < 40; j++) {
      const v = a * Math.exp(-j / 5) * (j % 2 ? -0.6 : 1);
      chans[0][i0 + j] += v * (side < 0.7 ? 1 : 0.3); chans[1][i0 + j] += v * (side > 0.3 ? 1 : 0.3);
    }
  }
  buf.copyToChannel(chans[0], 0); buf.copyToChannel(chans[1], 1);
  return buf;
}

export function reverseBuffer(b) {
  const r = new AudioBuffer({ length: b.length, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c).slice(); d.reverse(); r.copyToChannel(d, c); }
  return r;
}

/** RMS envelope (0..1), `n` points across the loop — used to cut the visible grooves. */
export function envelope(b, n = 256) {
  const d = b.getChannelData(0), step = Math.floor(d.length / n), out = new Float32Array(n);
  let mx = 0;
  for (let i = 0; i < n; i++) {
    let s = 0; for (let j = 0; j < step; j += 4) { const v = d[i * step + j]; s += v * v; }
    out[i] = Math.sqrt(s / (step / 4)); mx = Math.max(mx, out[i]);
  }
  for (let i = 0; i < n; i++) out[i] /= mx || 1;
  return out;
}

// ── The deck: a player that is driven by the platter ─────────────────────────
export class Deck {
  constructor() {
    this.ctx = null;
    this.fwd = []; this.rev = []; this.env = [];
    this.track = 0; this.pos = 0; this.dir = 1; this.src = null; this.applied = 0;
    this.volume = 0.8; this.muted = false; this.ready = false;
    this.levels = { bass: 0, mid: 0, high: 0, rms: 0 };
  }

  async prerender(onEach) {
    for (let i = 0; i < TRACKS.length; i++) {
      const b = await renderTrack(TRACKS[i]);
      this.fwd[i] = b; this.rev[i] = reverseBuffer(b); this.env[i] = envelope(b);
      onEach?.(i, this.env[i]);
    }
  }

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    const ctx = this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.gate = ctx.createGain(); this.gate.gain.value = 0;
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9;
    this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 17000;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0.7;
    this.analyser.minDecibels = -92; this.analyser.maxDecibels = -22;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, ctx.currentTime, 0.4);
    this.gate.connect(this.tone); this.sfx.connect(this.tone);
    this.tone.connect(this.analyser).connect(this.master).connect(ctx.destination);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.wave = new Float32Array(this.analyser.fftSize);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.lastA = ctx.currentTime;
    this.ready = true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.08);
  }

  cue(i) { this.track = i; this.pos = 0; this._stopSrc(); }

  /** Called every frame. rate = platter speed / 33⅓ (negative = backwards). */
  update(rate, needleDown) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime, dA = Math.min(0.1, now - this.lastA);
    this.lastA = now;
    const fwd = this.fwd[this.track];
    if (!fwd) return;
    const D = fwd.duration;
    if (this.src) this.pos = (((this.pos + this.applied * dA) % D) + D) % D;
    if (!needleDown) {
      this.gate.gain.setTargetAtTime(0, now, 0.01);
      if (this._gateOffAt == null) this._gateOffAt = now + 0.1;
      if (this.src && now > this._gateOffAt) this._stopSrc();
      this.applied = 0;
      return;
    }
    this._gateOffAt = null;
    const mag = Math.abs(rate);
    const dir = rate < -0.003 ? -1 : rate > 0.003 ? 1 : this.dir;
    if (!this.src || dir !== this.dir) this._startSrc(dir, now, mag);
    this.src.playbackRate.setTargetAtTime(Math.max(mag, 0.0005), now, 0.008);
    this.gate.gain.setTargetAtTime(mag < 0.02 ? 0 : Math.min(1, mag * 3), now, 0.01);
    this.applied = dir * Math.max(this.src.playbackRate.value, 0);
  }

  _startSrc(dir, now, mag) {
    const buf = dir > 0 ? this.fwd[this.track] : this.rev[this.track];
    const D = buf.duration;
    if (this.src) { const o = this.src, og = this.srcGain; og.gain.setTargetAtTime(0, now, 0.003); o.stop(now + 0.03); }
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true;
    s.playbackRate.value = Math.max(mag, 0.0005);
    const g = this.ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(1, now, 0.003);
    s.connect(g).connect(this.gate);
    const off = dir > 0 ? this.pos : D - this.pos;
    s.start(now, Math.min(D - 0.001, Math.max(0, off)));
    this.src = s; this.srcGain = g; this.dir = dir;
  }

  _stopSrc() {
    if (!this.src || !this.ctx) { this.src = null; return; }
    const now = this.ctx.currentTime;
    this.srcGain.gain.setTargetAtTime(0, now, 0.004);
    this.src.stop(now + 0.04);
    this.src = null;
  }

  /** Stylus touching down: a soft thump and a burst of surface noise. */
  needleDrop() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.14);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.22);
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.5;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.12, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    s.connect(f).connect(ng).connect(this.sfx); s.start(t, Math.random() * 0.5, 0.55);
  }

  needleLift() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    s.connect(f).connect(g).connect(this.sfx); s.start(t, Math.random() * 0.5, 0.08);
  }

  /** Fill `out` (length N) with a log-spaced spectrum; updates this.levels. Returns false if silent. */
  spectrum(out) {
    if (!this.analyser) return false;
    const a = this.analyser, fr = this.freq;
    a.getByteFrequencyData(fr);
    const binHz = this.ctx.sampleRate / a.fftSize, N = out.length;
    let any = 0;
    for (let i = 0; i < N; i++) {
      const f = 38 * Math.pow(11000 / 38, i / (N - 1));
      const b = f / binHz, i0 = Math.floor(b), t = b - i0;
      const v = ((fr[i0] ?? 0) * (1 - t) + (fr[i0 + 1] ?? 0) * t) / 255;
      out[i] = Math.min(1, v * (0.85 + i / N * 0.45));
      any += v;
    }
    const band = (f0, f1) => { let s = 0, c = 0; for (let i = Math.floor(f0 / binHz); i <= Math.ceil(f1 / binHz); i++) { s += fr[i]; c++; } return s / (c * 255); };
    a.getFloatTimeDomainData(this.wave);
    let rms = 0; for (let i = 0; i < this.wave.length; i++) rms += this.wave[i] * this.wave[i];
    const L = this.levels;
    L.bass = band(40, 120); L.mid = band(300, 2000); L.high = band(4500, 11000); L.rms = Math.sqrt(rms / this.wave.length);
    return any / N > 0.02;
  }
}
