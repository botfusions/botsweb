// Optional, synthesized sound: a low vault hum, stone grinding under the hold, the crack and a crystal ring.
// Off by default; the nav toggle creates the AudioContext on a user gesture.
export class Sound {
  constructor(btn) {
    this.on = false;
    this.btn = btn;
    btn?.addEventListener('click', () => this.toggle());
  }

  toggle() {
    this.on = !this.on;
    this.btn?.setAttribute('aria-pressed', String(this.on));
    if (this.on) this._ensure();
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.on ? 0.9 : 0, t, 0.25);
      if (this.on) this.ctx.resume();
    }
  }

  _noise(sec = 2) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _ensure() {
    if (this.ctx) return;
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(ctx.destination);
    // Hum: two detuned low sines through a gentle lowpass.
    const hum = ctx.createGain(); hum.gain.value = 0.05; hum.connect(this.master);
    for (const [f, g] of [[55, 0.6], [82.6, 0.3], [110.3, 0.12]]) {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = g;
      o.connect(og).connect(hum); o.start();
    }
    // Grind: band-passed noise with a crackle LFO; gain follows the hold.
    const src = ctx.createBufferSource(); src.buffer = this._noise(3); src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
    this.grind = ctx.createGain(); this.grind.gain.value = 0;
    src.connect(bp).connect(this.grind).connect(this.master); src.start();
    this.grindF = bp.frequency;
  }

  setHold(v) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    this.grind.gain.setTargetAtTime(v > 0.01 ? (0.04 + v * v * 0.35) * (0.6 + Math.random() * 0.8) : 0, t, 0.04);
    this.grindF.setTargetAtTime(500 + v * 1600, t, 0.1);
  }

  crack() {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // The snap.
    const n = ctx.createBufferSource(); n.buffer = this._noise(0.6);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    n.connect(hp).connect(g).connect(this.master); n.start(t);
    // The thump of the stone.
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.4);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.8);
    // Crystal ring: inharmonic partials, long decay.
    [1318.5, 1975.5, 2637, 3322.4, 4186].forEach((f, i) => {
      const s = ctx.createOscillator(); s.type = 'sine'; s.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
      const sg = ctx.createGain(); const st = t + 0.08 + i * 0.07;
      sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(0.05 / (1 + i * 0.4), st); sg.gain.exponentialRampToValueAtTime(0.0001, st + 3.5 - i * 0.3);
      s.connect(sg).connect(this.master); s.start(t); s.stop(st + 4);
    });
    this.setHold(0);
  }
}
