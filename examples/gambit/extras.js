// Loader knight's tour and the (optional, off by default) sound of marble on walnut.

/** Draw a knight's tour (Warnsdorff) across an 8x8 grid; set(v) reveals it as loading progresses. */
export function buildTour(svg) {
  const NS = 'http://www.w3.org/2000/svg';
  const grid = svg.querySelector('.tour-grid');
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const s = document.createElementNS(NS, 'rect');
    s.setAttribute('x', f * 10); s.setAttribute('y', r * 10); s.setAttribute('width', 10); s.setAttribute('height', 10);
    if ((r + f) % 2) s.classList.add('d');
    grid.appendChild(s);
  }
  const J = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  const seen = new Set();
  const key = (f, r) => f * 8 + r;
  const ok = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8 && !seen.has(key(f, r));
  const deg = (f, r) => J.filter(([a, b]) => ok(f + a, r + b)).length;
  let f = 1, r = 7; // g1-ish from White's view: start on b1 (knight's home)
  const path = [[f, r]];
  seen.add(key(f, r));
  for (let i = 1; i < 64; i++) {
    let best = null, bd = 9;
    for (const [a, b] of J) {
      const nf = f + a, nr = r + b;
      if (!ok(nf, nr)) continue;
      seen.add(key(nf, nr)); const d = deg(nf, nr); seen.delete(key(nf, nr));
      if (d < bd) { bd = d; best = [nf, nr]; }
    }
    if (!best) break;
    [f, r] = best; seen.add(key(f, r)); path.push([f, r]);
  }
  const pts = path.map(([a, b]) => [a * 10 + 5, b * 10 + 5]);
  const line = svg.querySelector('.tour-line');
  line.setAttribute('points', pts.map(p => p.join(',')).join(' '));
  const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = segs.reduce((a, b) => a + b, 0);
  line.style.strokeDasharray = total;
  line.style.strokeDashoffset = total;
  const dot = svg.querySelector('.tour-knight');
  return {
    set(v) {
      line.style.strokeDashoffset = total * (1 - v);
      let d = total * v, i = 0;
      while (i < segs.length - 1 && d > segs[i]) { d -= segs[i]; i++; }
      const k = Math.min(1, d / segs[i]);
      dot.setAttribute('cx', pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k);
      dot.setAttribute('cy', pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k);
    },
  };
}

/** Synthesised sounds: a stone-on-wood "clack", a softer lift, and a toppling knock. */
export const sound = (() => {
  let ctx = null, on = false, master = null;
  const ensure = () => {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain(); master.gain.value = 0.55;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  function noiseBurst(t, len, freq, q, gain) {
    const c = ctx, buf = c.createBuffer(1, Math.ceil(c.sampleRate * len), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) { const k = i / d.length; d[i] = (Math.random() * 2 - 1) * Math.exp(-k * 30); }
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(bp).connect(g).connect(master); src.start(t);
  }
  function tone(t, f0, f1, len, gain, type = 'sine') {
    const c = ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(master); o.start(t); o.stop(t + len + 0.02);
  }
  return {
    toggle() { on = !on; if (on) ensure(); return on; },
    get on() { return on; },
    clack(s = 1) {
      if (!on) return; ensure();
      const t = ctx.currentTime + 0.005, v = 0.5 + Math.random() * 0.3;
      noiseBurst(t, 0.05, 2600 + Math.random() * 900, 2.2, 0.9 * s * v);
      tone(t, 1150 + Math.random() * 200, 780, 0.07, 0.18 * s * v, 'triangle');
      tone(t, 190, 120, 0.12, 0.32 * s * v);
    },
    lift() { if (!on) return; ensure(); noiseBurst(ctx.currentTime, 0.035, 4200, 1.2, 0.16); },
    topple(s = 1) {
      if (!on) return; ensure();
      const t = ctx.currentTime + 0.02;
      noiseBurst(t, 0.06, 1700, 2, 0.6 * s); tone(t, 160, 90, 0.16, 0.35 * s);
      noiseBurst(t + 0.11, 0.05, 2100, 2, 0.28 * s); tone(t + 0.11, 150, 95, 0.1, 0.15 * s);
    },
  };
})();
