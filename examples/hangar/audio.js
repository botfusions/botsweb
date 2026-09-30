// Hangar Nine — synthesized sound. Off by default; the nav toggle creates the AudioContext on a user gesture.
export class Sound {
  constructor() { this.on = false; this.ctx = null; this._charge = 0; }

  toggle() {
    this.on = !this.on;
    if (this.on) this._init();
    if (this.ctx) this.master.gain.setTargetAtTime(this.on ? 0.8 : 0, this.ctx.currentTime, 0.15);
    return this.on;
  }

  _init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const c = this.ctx = new AudioContext();
    this.master = c.createGain(); this.master.gain.value = 0;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    // noise source
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    // charge hum: two detuned saws through a lowpass
    this.hum = c.createGain(); this.hum.gain.value = 0;
    this.humF = c.createBiquadFilter(); this.humF.type = 'lowpass'; this.humF.frequency.value = 120; this.humF.Q.value = 6;
    this.oscs = [0, 7].map(det => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 40; o.detune.value = det; o.connect(this.humF); o.start(); return o; });
    this.humF.connect(this.hum).connect(this.master);
    // room tone once powered
    const room = c.createBufferSource(); room.buffer = buf; room.loop = true;
    const rf = c.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 180;
    this.room = c.createGain(); this.room.gain.value = 0;
    room.connect(rf).connect(this.room).connect(this.master); room.start();
    this.drone = c.createOscillator(); this.drone.type = 'sine'; this.drone.frequency.value = 55;
    this.droneG = c.createGain(); this.droneG.gain.value = 0;
    this.drone.connect(this.droneG).connect(this.master); this.drone.start();
  }

  charge(v) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.hum.gain.setTargetAtTime(v > 0.001 ? 0.05 + v * 0.22 : 0, t, 0.05);
    for (const o of this.oscs) o.frequency.setTargetAtTime(38 + v * v * 90, t, 0.05);
    this.humF.frequency.setTargetAtTime(110 + v * 1900, t, 0.05);
  }

  _noise(dur, type, freq, q, gain, attack = 0.002, when = 0) {
    const c = this.ctx, t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  _tone(freq, dur, gain, type = 'sine', when = 0, attack = 0.004, glide = null) {
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  /** Big contactor closing: thump + metallic ring + a short crackle. */
  clank(v = 1) {
    if (!this.on || !this.ctx) return;
    this._tone(62, 0.5, 0.5 * v, 'sine', 0, 0.002, 34);
    this._noise(0.18, 'bandpass', 900 + Math.random() * 500, 1.2, 0.35 * v);
    this._tone(1320 + Math.random() * 200, 0.6, 0.03 * v, 'triangle');
    this._tone(2210 + Math.random() * 300, 0.4, 0.02 * v, 'triangle');
  }
  drop() { if (!this.on || !this.ctx) return; this._tone(90, 1.4, 0.4, 'sine', 0, 0.01, 28); this.charge(0); }
  hiss(dur = 2.2, v = 1) { if (!this.on || !this.ctx) return; this._noise(dur, 'highpass', 2400, 0.7, 0.25 * v, 0.03); this._noise(dur * 0.6, 'bandpass', 700, 0.6, 0.12 * v, 0.02); }
  scan() { if (!this.on || !this.ctx) return; this._tone(220, 2.6, 0.05, 'sawtooth', 0, 0.2, 880); }
  online() {
    if (!this.on || !this.ctx) return;
    for (const [f, g] of [[110, 0.12], [165, 0.08], [220, 0.06], [330, 0.035]]) this._tone(f, 3.6, g, 'sine', 0, 0.5);
    const t = this.ctx.currentTime;
    this.room.gain.setTargetAtTime(0.03, t, 1.5);
    this.droneG.gain.setTargetAtTime(0.025, t, 2);
  }
}
