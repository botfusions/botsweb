// Optional, muted-by-default foley: soft pats when pastries land, a knuckle on marble, paper and a chime for the box.
// Everything is synthesised (no files), throttled, and starts only after the visitor turns it on.
export class Foley {
  constructor() { this.on = false; this.ctx = null; this.last = 0; this.budget = 0; }

  enable(v) {
    this.on = v;
    if (v && !this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.out = this.ctx.createGain(); this.out.gain.value = 0.55;
        const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
        this.out.connect(comp).connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 0.25, b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noise = b;
      } catch { this.on = false; }
    }
    this.ctx?.resume?.();
  }

  _ok() {
    if (!this.on || !this.ctx) return false;
    const t = this.ctx.currentTime;
    this.budget = Math.max(0, this.budget - (t - this.last) * 14);
    this.last = t;
    if (this.budget > 10) return false;
    this.budget++;
    return true;
  }

  _burst(t, { freq = 900, q = 0.8, dur = 0.08, gain = 0.3, type = 'lowpass' }) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(f).connect(g).connect(this.out); s.start(t, Math.random() * 0.1); s.stop(t + dur + 0.02);
  }

  _tone(t, { f0 = 180, f1 = 90, dur = 0.09, gain = 0.25, type = 'sine' }) {
    const c = this.ctx, o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  }

  land(kind, speed) {
    if (!this._ok()) return;
    const t = this.ctx.currentTime, v = Math.min(1, (speed - 5) / 18);
    if (v <= 0) return;
    const pitch = 0.85 + Math.random() * 0.3;
    if (kind === 'berry') { this._tone(t, { f0: 420 * pitch, f1: 160, dur: 0.06, gain: 0.12 * v }); this._burst(t, { freq: 2400, dur: 0.03, gain: 0.05 * v }); }
    else if (kind === 'croissant') this._burst(t, { freq: 1700 * pitch, q: 0.4, dur: 0.12, gain: 0.2 * v, type: 'bandpass' });
    else if (kind === 'tart') { this._tone(t, { f0: 150, f1: 70, dur: 0.12, gain: 0.25 * v }); this._burst(t, { freq: 900, dur: 0.06, gain: 0.12 * v }); }
    else { this._tone(t, { f0: 240 * pitch, f1: 110, dur: 0.07, gain: 0.16 * v }); this._burst(t, { freq: 1300 * pitch, dur: 0.05, gain: 0.1 * v }); }
  }

  knock() {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(t, { f0: 210, f1: 120, dur: 0.12, gain: 0.5 });
    this._burst(t, { freq: 3200, q: 1.2, dur: 0.025, gain: 0.25, type: 'bandpass' });
  }

  paper() {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(t, { f0: 120, f1: 60, dur: 0.16, gain: 0.45 });
    this._burst(t, { freq: 1100, q: 0.5, dur: 0.14, gain: 0.25 });
  }

  chime() {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    [1318.5, 1760, 2093].forEach((f, i) => this._tone(t + i * 0.09, { f0: f, f1: f * 0.995, dur: 0.9, gain: 0.07, type: 'sine' }));
  }
}
