// The season dial: a year drawn as a brushed ring with twenty-four solar-term ticks.
// Drag the ink bead around the ring (or anywhere on the dial) to turn the year.
import { wrap, sekkiAt, SEASON_NAMES, seasonIndex } from './seasons.js';

const R = 62, C = 80;
export class Dial {
  constructor(el, { onInput, onStart, onEnd } = {}) {
    this.el = el;
    this.onInput = onInput; this.onStart = onStart; this.onEnd = onEnd;
    const ticks = Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
      const major = i % 6 === 0;
      const r0 = R - (major ? 9 : 5), r1 = R - 1;
      return `<line x1="${C + Math.cos(a) * r0}" y1="${C + Math.sin(a) * r0}" x2="${C + Math.cos(a) * r1}" y2="${C + Math.sin(a) * r1}" class="${major ? 'maj' : ''}"/>`;
    }).join('');
    const labels = SEASON_NAMES.map(([k], i) => {
      const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
      return `<text x="${C + Math.cos(a) * (R + 13)}" y="${C + Math.sin(a) * (R + 13) + 4}" data-i="${i}">${k}</text>`;
    }).join('');
    el.innerHTML = `
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <defs>
          <filter id="dial-brush" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n"/>
            <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2"/>
          </filter>
        </defs>
        <circle class="ring" cx="${C}" cy="${C}" r="${R}" filter="url(#dial-brush)"/>
        <path class="arc" d="" filter="url(#dial-brush)"/>
        <g class="ticks">${ticks}</g>
        <g class="labels">${labels}</g>
        <g class="bead"><circle class="bead-halo" r="11"/><circle class="bead-dot" r="5.2"/></g>
      </svg>
      <div class="dial-core"><span class="dial-kanji">秋</span></div>`;
    this.bead = el.querySelector('.bead');
    this.arc = el.querySelector('.arc');
    this.kanji = el.querySelector('.dial-kanji');
    this.labels = [...el.querySelectorAll('.labels text')];
    this.cap = document.querySelector('.dial-caption');
    this.dragging = false;
    this.value = 2;
    const angleOf = e => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
      let a = Math.atan2(y, x) + Math.PI / 2; // 0 at top, clockwise
      if (a < 0) a += Math.PI * 2;
      return a / (Math.PI * 2) * 4;
    };
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.dragging = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('is-drag', 'was-used');
      this.onStart?.();
      this.onInput?.(angleOf(e));
    });
    el.addEventListener('pointermove', e => { if (this.dragging) this.onInput?.(angleOf(e)); });
    const end = e => {
      if (!this.dragging) return;
      this.dragging = false;
      el.classList.remove('is-drag');
      try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      this.onEnd?.();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    // keyboard: arrows step one solar term
    el.tabIndex = 0;
    el.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { this.onStart?.(); this.onInput?.(wrap(this.value + 1 / 6)); this.onEnd?.(); e.preventDefault(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { this.onStart?.(); this.onInput?.(wrap(this.value - 1 / 6)); this.onEnd?.(); e.preventDefault(); }
    });
    this._last = '';
  }

  /** s: unwrapped season; age: how many autumns the tree has seen. */
  set(s, age) {
    this.value = wrap(s);
    const f = this.value;
    const a = f / 4 * Math.PI * 2 - Math.PI / 2;
    this.bead.setAttribute('transform', `translate(${(C + Math.cos(a) * R).toFixed(2)} ${(C + Math.sin(a) * R).toFixed(2)})`);
    // ink arc from the start of the current season to the bead
    const si = Math.floor(f + 0.5) % 4;
    const a0 = ((si - 0.5 + 4) % 4) / 4 * Math.PI * 2 - Math.PI / 2;
    let da = a - a0; if (da < 0) da += Math.PI * 2;
    const x0 = C + Math.cos(a0) * R, y0 = C + Math.sin(a0) * R, x1 = C + Math.cos(a) * R, y1 = C + Math.sin(a) * R;
    this.arc.setAttribute('d', `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${da > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`);
    const idx = seasonIndex(s);
    const [kj, en] = SEASON_NAMES[idx];
    const [sk, ro, mean] = sekkiAt(s);
    const key = kj + sk + age;
    if (key !== this._last) {
      this._last = key;
      this.kanji.textContent = kj;
      this.labels.forEach((l, i) => l.classList.toggle('on', i === idx));
      if (this.cap) this.cap.innerHTML = `<b>${sk}</b> <span>${ro} — ${mean}</span><em>${en} · the tree's ${ordinal(age)} ${en.toLowerCase()}</em>`;
      this.el.setAttribute('aria-label', `Season dial: ${en}, ${ro} (${mean}). Use arrow keys to turn the year.`);
    }
  }
}
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
