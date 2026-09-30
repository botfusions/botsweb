// Nightshift — everything you hear is synthesised here. Nothing plays until the visitor turns sound on.
//   Engine: a 270° parallel twin. One PeriodicWave cycle = two crank revolutions (720°), with two exhaust
//   pulses at 0° and 270° — the uneven gap is what makes it lope. Pulses are AM'd onto band-passed noise,
//   driven through a soft clipper and a low-pass that opens with RPM. Overrun pops are one-shot bursts.
//   Ambience: pre-rendered stereo rain loop and a 100 Hz neon transformer buzz (Dutch mains are 50 Hz).

function twinWave(ctx, H = 180) {
  const N = 4096, s = new Float32Array(N);
  const pulse = (ph, amp) => {
    for (let i = 0; i < N; i++) {
      const x = (i / N - ph + 1) % 1; // cycle fraction since this cylinder fired
      s[i] += amp * (Math.exp(-x / 0.018) * 1.0 - Math.exp(-x / 0.05) * 0.55 + Math.exp(-x / 0.12) * Math.sin(2 * Math.PI * x / 0.21) * 0.25);
    }
  };
  pulse(0, 1);
  pulse(0.375, 0.9);
  let mean = 0; for (let i = 0; i < N; i++) mean += s[i] / N;
  const real = new Float32Array(H + 1), imag = new Float32Array(H + 1);
  for (let k = 1; k <= H; k++) {
    let re = 0, im = 0;
    const w = 2 * Math.PI * k / N;
    for (let i = 0; i < N; i++) { const v = s[i] - mean; re += v * Math.cos(w * i); im += v * Math.sin(w * i); }
    // gentle roll-off so the top harmonics don't fizz
    const roll = 1 / (1 + Math.pow(k / 90, 2));
    real[k] = re / N * 2 * roll; imag[k] = im / N * 2 * roll;
  }
  return ctx.createPeriodicWave(real, imag);
}

function softClip(k = 2.2, n = 2048) {
  const c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
  return c;
}

function noiseBuffer(ctx, seconds = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function rainBuffer(ctx, seconds = 6) {
  const sr = ctx.sampleRate, n = sr * seconds;
  const b = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    // pink-ish noise (Paul Kellet) for the wash
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.05; b6 = w * 0.115926;
    }
    // individual drops on metal and puddles
    for (let k = 0; k < seconds * 140; k++) {
      const at = Math.floor(Math.random() * (n - 800)), amp = Math.random() ** 3 * 0.35, f = 2500 + Math.random() * 5000, len = 60 + Math.random() * 500;
      for (let j = 0; j < len; j++) d[at + j] += Math.sin(j * f * 2 * Math.PI / sr) * amp * Math.exp(-j / (len * 0.25));
    }
    // seamless loop: crossfade the tail into the head
    const fade = sr * 0.25;
    for (let i = 0; i < fade; i++) { const t = i / fade; d[i] = d[i] * t + d[n - fade + i] * (1 - t); }
  }
  return b;
}

export class EngineAudio {
  constructor() { this.ctx = null; this.on = false; this.rpm = 1100; }

  async enable() {
    if (!this.ctx) this._build();
    await this.ctx.resume();
    this.on = true;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0.8, t, 0.35);
  }

  disable() {
    this.on = false;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.12);
    clearTimeout(this._susp);
    this._susp = setTimeout(() => { if (!this.on) this.ctx.suspend(); }, 700);
  }

  _build() {
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = this.master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.22;
    master.connect(comp).connect(ctx.destination);

    // ── engine ──
    const osc = this.osc = ctx.createOscillator();
    osc.setPeriodicWave(twinWave(ctx));
    osc.frequency.value = 1100 / 120;
    const drive = this.drive = ctx.createGain(); drive.gain.value = 0.8;
    const shaper = ctx.createWaveShaper(); shaper.curve = softClip(2.4); shaper.oversample = '2x';
    const lp = this.lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.8;
    const chest = ctx.createBiquadFilter(); chest.type = 'peaking'; chest.frequency.value = 110; chest.Q.value = 1.1; chest.gain.value = 6;
    const pipe = ctx.createBiquadFilter(); pipe.type = 'peaking'; pipe.frequency.value = 460; pipe.Q.value = 1.8; pipe.gain.value = 4;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 32;
    const eng = this.engGain = ctx.createGain(); eng.gain.value = 0.32;
    osc.connect(drive);
    // exhaust roar: noise gated by the pulse train, so the hiss arrives with each firing
    const nsrc = ctx.createBufferSource(); nsrc.buffer = noiseBuffer(ctx); nsrc.loop = true;
    const nbp = this.nbp = ctx.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 900; nbp.Q.value = 0.7;
    const nam = ctx.createGain(); nam.gain.value = 0;
    const namDepth = this.namDepth = ctx.createGain(); namDepth.gain.value = 0.25;
    osc.connect(namDepth).connect(nam.gain);
    nsrc.connect(nbp).connect(nam).connect(drive);
    drive.connect(shaper).connect(chest).connect(pipe).connect(lp).connect(hp).connect(eng).connect(master);
    // intake / valve-train rasp on top, only with throttle
    const isrc = ctx.createBufferSource(); isrc.buffer = noiseBuffer(ctx, 1.3); isrc.loop = true;
    const ihp = ctx.createBiquadFilter(); ihp.type = 'bandpass'; ihp.frequency.value = 2600; ihp.Q.value = 0.9;
    const ig = this.intake = ctx.createGain(); ig.gain.value = 0;
    isrc.connect(ihp).connect(ig).connect(master);

    // ── overrun pops bus ──
    this.popBus = ctx.createGain(); this.popBus.gain.value = 0.9;
    const pshaper = ctx.createWaveShaper(); pshaper.curve = softClip(3);
    this.popBus.connect(pshaper).connect(master);
    this.popNoise = noiseBuffer(ctx, 0.5);

    // ── rain ──
    const rsrc = ctx.createBufferSource(); rsrc.buffer = rainBuffer(ctx); rsrc.loop = true;
    const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 6500;
    const rg = this.rainGain = ctx.createGain(); rg.gain.value = 0.55;
    rsrc.connect(rlp).connect(rg).connect(master);

    // ── neon buzz ──
    const buzz = ctx.createOscillator(); buzz.type = 'sawtooth'; buzz.frequency.value = 100;
    const bbp = ctx.createBiquadFilter(); bbp.type = 'bandpass'; bbp.frequency.value = 1400; bbp.Q.value = 2.5;
    const bg = this.buzzGain = ctx.createGain(); bg.gain.value = 0.004;
    buzz.connect(bbp).connect(bg).connect(master);

    const t = ctx.currentTime + 0.02;
    for (const s of [osc, nsrc, isrc, rsrc, buzz]) s.start(t);
  }

  /** Called every frame. rpm in r/min, throttle 0..1, neon 0..1 (current brightness), crackle 0..1 (flicker spikes). */
  update(rpm, throttle, neon = 1, crackle = 0) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const rn = Math.min(1, Math.max(0, (rpm - 1100) / 7400));
    const wobble = 1 + (Math.random() - 0.5) * 0.012 * (1 - rn);
    this.osc.frequency.setTargetAtTime(rpm / 120 * wobble, t, 0.015);
    this.lp.frequency.setTargetAtTime(420 + rpm * 0.38 + throttle * 900, t, 0.03);
    this.nbp.frequency.setTargetAtTime(700 + rpm * 0.28, t, 0.05);
    this.drive.gain.setTargetAtTime(0.7 + throttle * 1.3 + rn * 0.5, t, 0.03);
    this.namDepth.gain.setTargetAtTime(0.18 + throttle * 0.35, t, 0.05);
    this.engGain.gain.setTargetAtTime(0.26 + rn * 0.16 + throttle * 0.12, t, 0.04);
    this.intake.gain.setTargetAtTime(throttle * (0.012 + rn * 0.03), t, 0.05);
    this.buzzGain.gain.setTargetAtTime(0.0025 + neon * 0.004 + crackle * 0.02, t, 0.02);
  }

  /** One overrun crackle. */
  pop(strength = 1) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.005;
    const src = ctx.createBufferSource(); src.buffer = this.popNoise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500 + Math.random() * 900; bp.Q.value = 0.9;
    const g = ctx.createGain();
    const a = 0.5 * strength * (0.5 + Math.random() * 0.6);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.002); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05 + Math.random() * 0.05);
    src.connect(bp).connect(g).connect(this.popBus);
    src.start(t, Math.random() * 0.3, 0.12);
    const th = ctx.createOscillator(); th.type = 'sine';
    th.frequency.setValueAtTime(95 + Math.random() * 40, t); th.frequency.exponentialRampToValueAtTime(42, t + 0.09);
    const tg = ctx.createGain(); tg.gain.setValueAtTime(0, t); tg.gain.linearRampToValueAtTime(a * 0.9, t + 0.003); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    th.connect(tg).connect(this.popBus);
    th.start(t); th.stop(t + 0.12);
  }

  /** Headlight relay clunk. */
  click() {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.003;
    const src = ctx.createBufferSource(); src.buffer = this.popNoise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 3;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    src.connect(bp).connect(g).connect(this.master); src.start(t, 0, 0.04);
  }
}
