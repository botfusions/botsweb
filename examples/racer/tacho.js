// Brass-bezel tachometer drawn in SVG; the needle has a little mass and overshoot.
const A0 = -130, SWEEP = 260, MAX = 10000;
const polar = (r, deg) => { const a = deg * Math.PI / 180; return [r * Math.sin(a), -r * Math.cos(a)]; };
const arc = (r, d0, d1) => {
  const [x0, y0] = polar(r, d0), [x1, y1] = polar(r, d1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};
const angleOf = rpm => A0 + Math.min(Math.max(rpm, 0), MAX * 1.02) / MAX * SWEEP;

export class Tacho {
  constructor(el) {
    this.el = el;
    this.needle = el.querySelector('.tacho-needle');
    this.rpmText = el.querySelector('.tacho-rpm');
    this.lit = el.querySelector('.tacho-arc');
    const ticks = el.querySelector('.tacho-ticks');
    const ns = 'http://www.w3.org/2000/svg';
    let html = '';
    for (let v = 0; v <= 10.001; v += 0.25) {
      const major = Math.abs(v - Math.round(v)) < 1e-3;
      const half = !major && Math.abs(v * 2 - Math.round(v * 2)) < 1e-3;
      const a = A0 + v / 10 * SWEEP;
      const r0 = 131, r1 = major ? 111 : half ? 119 : 123;
      const [x0, y0] = polar(r0, a), [x1, y1] = polar(r1, a);
      const cls = v >= 8.5 ? 'red' : major ? '' : 'minor';
      html += `<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}" class="${cls}" stroke-width="${major ? 2.6 : 1.2}"/>`;
      if (major) {
        const [tx, ty] = polar(93, a);
        html += `<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" class="${v >= 9 ? 'red' : ''}">${Math.round(v)}</text>`;
      }
    }
    ticks.innerHTML = html;
    void ns;
    el.querySelector('.tacho-red').setAttribute('d', arc(137, angleOf(8500), angleOf(10000)));
    this.a = angleOf(0); this.v = 0;
    this.shown = -1;
  }

  /** Spring the needle toward the rpm; dt in seconds. */
  update(rpm, dt, limit) {
    const target = angleOf(rpm);
    // under-damped spring: fast, with a hint of overshoot on blips
    const k = 520, c = 30;
    this.v += ((target - this.a) * k - this.v * c) * dt;
    this.a += this.v * dt;
    this.needle.setAttribute('transform', `rotate(${this.a.toFixed(2)})`);
    const lit = Math.max(this.a, A0 + 0.5);
    this.lit.setAttribute('d', arc(141, A0, lit));
    const shownRpm = Math.round(rpm / 50) * 50;
    if (shownRpm !== this.shown) { this.shown = shownRpm; this.rpmText.textContent = shownRpm.toLocaleString('en-US'); }
    this.el.classList.toggle('limit', !!limit);
  }
}
