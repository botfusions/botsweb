// Synthesised forge sounds. Nothing plays until the visitor clicks; everything routes through one master gain
// so the nav toggle can silence it instantly.
export class ForgeAudio {
  constructor() {
    this.enabled = true;
    this.ctx = null;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
    try {
      const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = ctx.createGain();
      this.master.gain.value = this.enabled ? 0.8 : 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.2;
      this.master.connect(comp).connect(ctx.destination);
      // Stone room: a short synthetic impulse response.
      this.verb = ctx.createConvolver();
      const len = ctx.sampleRate * 1.9, ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < len; i++) { const k = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, 3.2) * (i < 900 ? i / 900 : 1); }
      }
      this.verb.buffer = ir;
      this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.32;
      this.verb.connect(this.verbGain).connect(this.master);
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const nd = this.noise.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      this._ambient();
      return ctx;
    } catch { this.ctx = null; return null; }
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  _out(node, wet = 1) { node.connect(this.master); const s = this.ctx.createGain(); s.gain.value = wet; node.connect(s).connect(this.verb); }

  /** Hammer on hot steel over an anvil: a dull thud, a bright inharmonic ring, a spit of noise. */
  clang(power = 1, heat = 0.6) {
    const ctx = this.ensure(); if (!ctx) return;
    const t = ctx.currentTime + 0.005;
    const pan = ctx.createStereoPanner(); pan.pan.value = (Math.random() - 0.5) * 0.3;
    const bus = ctx.createGain(); bus.gain.value = 0.55 * (0.6 + power * 0.4);
    bus.connect(pan); this._out(pan, 0.9);
    // Anvil ring: inharmonic partials of a thick steel bar. Hot steel damps the ring a little.
    const f0 = 540 + Math.random() * 60;
    const partials = [[1, 1, 1.3], [2.76, 0.55, 0.9], [5.4, 0.32, 0.55], [8.93, 0.2, 0.32], [13.34, 0.12, 0.2], [1.51, 0.25, 0.7]];
    const damp = 1 - heat * 0.35;
    for (const [r, a, d] of partials) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.value = f0 * r * (1 + (Math.random() - 0.5) * 0.004);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a * 0.5, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d * damp * (0.8 + Math.random() * 0.3));
      o.connect(g).connect(bus); o.start(t); o.stop(t + 1.6);
    }
    // Body thud.
    const th = ctx.createOscillator(); th.type = 'sine';
    th.frequency.setValueAtTime(140, t); th.frequency.exponentialRampToValueAtTime(48, t + 0.18);
    const tg = ctx.createGain(); tg.gain.setValueAtTime(0.9, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    th.connect(tg).connect(bus); th.start(t); th.stop(t + 0.3);
    // Impact transient + scale spit.
    const n = ctx.createBufferSource(); n.buffer = this.noise; n.playbackRate.value = 1.3;
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 3200; hp.Q.value = 0.7;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.7, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    n.connect(hp).connect(ng).connect(bus); n.start(t, Math.random()); n.stop(t + 0.12);
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const sf = ctx.createBiquadFilter(); sf.type = 'highpass'; sf.frequency.value = 5200;
    const sg = ctx.createGain(); sg.gain.setValueAtTime(0.0, t); sg.gain.linearRampToValueAtTime(0.12 * heat, t + 0.03); sg.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    s.connect(sf).connect(sg).connect(bus); s.start(t, Math.random()); s.stop(t + 0.7);
  }

  /** Continuous bellows breath while held. */
  bellows(on) {
    const ctx = this.ensure(); if (!ctx) return;
    const t = ctx.currentTime;
    if (on && !this._bel) {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 420; lp.Q.value = 0.6;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.35);
      src.connect(lp).connect(g); this._out(g, 0.4);
      // Pumping: the breath swells and dips.
      const lfo = ctx.createOscillator(); lfo.frequency.value = 1.1;
      const lg = ctx.createGain(); lg.gain.value = 0.22; lfo.connect(lg).connect(g.gain);
      const lf2 = ctx.createGain(); lf2.gain.value = 180; lfo.connect(lf2).connect(lp.frequency);
      src.start(); lfo.start();
      this._bel = { src, g, lfo };
    } else if (!on && this._bel) {
      const b = this._bel; this._bel = null;
      b.g.gain.cancelScheduledValues(t); b.g.gain.setTargetAtTime(0, t, 0.12);
      b.src.stop(t + 0.8); b.lfo.stop(t + 0.8);
    }
  }

  /** A hiss for the quench, scaled by how much hot steel just met the water. */
  hiss(amount) {
    const ctx = this.ctx; if (!ctx || amount < 0.01) return;
    if (!this._hiss) {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
      const bp = ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 6000; bp.gain.value = 6;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(hp).connect(bp).connect(g); this._out(g, 0.5); src.start();
      this._hiss = g;
    }
    this._hiss.gain.setTargetAtTime(Math.min(amount, 1) * 0.45, ctx.currentTime, 0.08);
  }

  _ambient() {
    // Low roar of the coals + irregular crackle. Very quiet.
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true; src.playbackRate.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    const g = ctx.createGain(); g.gain.value = 0.0; g.gain.setTargetAtTime(0.16, ctx.currentTime, 1.5);
    src.connect(lp).connect(g).connect(this.master); src.start();
    this.roar = { g, lp };
    const crackle = () => {
      if (!this.ctx) return;
      const t = ctx.currentTime;
      const s = ctx.createBufferSource(); s.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500 + Math.random() * 3500; f.Q.value = 2;
      const cg = ctx.createGain(); cg.gain.setValueAtTime(0.05 + Math.random() * 0.1, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.03 + Math.random() * 0.05);
      s.connect(f).connect(cg).connect(this.master); s.start(t, Math.random() * 1.5); s.stop(t + 0.1);
      setTimeout(crackle, 80 + Math.random() * (this._bel ? 180 : 700));
    };
    crackle();
  }

  fire(level) {
    if (!this.roar) return;
    this.roar.g.gain.setTargetAtTime(0.12 + level * 0.25, this.ctx.currentTime, 0.2);
    this.roar.lp.frequency.setTargetAtTime(160 + level * 260, this.ctx.currentTime, 0.2);
  }
}
