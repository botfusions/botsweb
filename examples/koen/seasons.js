// The year as a number. s is unwrapped (it keeps counting up as the page turns years);
// f = s mod 4 with 0 = mid-spring, 1 = mid-summer, 2 = peak autumn, 3 = deep winter.
import { THREE, clamp, smooth } from '../../src/core/engine.js';

export const wrap = s => ((s % 4) + 4) % 4;

// Twenty-four solar terms (nijūshi sekki). Index 0 = Risshun; mid-spring (f = 0) sits on Shunbun (index 3).
export const SEKKI = [
  ['立春', 'Risshun', 'Spring begins'], ['雨水', 'Usui', 'Snow turns to rain'], ['啓蟄', 'Keichitsu', 'Insects wake'],
  ['春分', 'Shunbun', 'Spring equinox'], ['清明', 'Seimei', 'Clear and bright'], ['穀雨', 'Kokuu', 'Rain for the grain'],
  ['立夏', 'Rikka', 'Summer begins'], ['小満', 'Shōman', 'Small ripening'], ['芒種', 'Bōshu', 'Seeds in the ear'],
  ['夏至', 'Geshi', 'Summer solstice'], ['小暑', 'Shōsho', 'Small heat'], ['大暑', 'Taisho', 'Great heat'],
  ['立秋', 'Risshū', 'Autumn begins'], ['処暑', 'Shosho', 'Heat withdraws'], ['白露', 'Hakuro', 'White dew'],
  ['秋分', 'Shūbun', 'Autumn equinox'], ['寒露', 'Kanro', 'Cold dew'], ['霜降', 'Sōkō', 'Frost descends'],
  ['立冬', 'Rittō', 'Winter begins'], ['小雪', 'Shōsetsu', 'Small snow'], ['大雪', 'Taisetsu', 'Great snow'],
  ['冬至', 'Tōji', 'Winter solstice'], ['小寒', 'Shōkan', 'Small cold'], ['大寒', 'Daikan', 'Great cold'],
];
// Peak colour for a Saitama maple is Sōkō / Rittō, so autumn (f = 2) is pinned to Sōkō rather than the equinox.
export function sekkiAt(s) {
  const f = wrap(s);
  // piecewise: spring/summer evenly, autumn stretched so f=2 → index 17 (Sōkō), winter compresses.
  const keys = [[0, 3], [1, 9], [2, 17], [3, 21.5], [4, 27]];
  let idx = 3;
  for (let i = 0; i < keys.length - 1; i++) {
    const [a, ia] = keys[i], [b, ib] = keys[i + 1];
    if (f >= a && f <= b) { idx = ia + (ib - ia) * (f - a) / (b - a); break; }
  }
  return SEKKI[Math.floor(idx + 0.5) % 24];
}
export const SEASON_NAMES = [['春', 'Spring'], ['夏', 'Summer'], ['秋', 'Autumn'], ['冬', 'Winter']];
export const seasonIndex = s => Math.floor(wrap(s + 0.5)) % 4;

// ── What the tree is doing ──────────────────────────────────────────────────────
export function treeState(s) {
  const f = wrap(s);
  // leaves on the tree: full until late autumn, gone in winter, budding back at the end of winter
  const cover = f < 2.3 ? 1 : f < 2.9 ? 1 - smooth(2.3, 2.9, f) : f < 3.5 ? 0 : smooth(3.5, 3.97, f);
  const autumn = f < 3.3 ? smooth(1.4, 2.0, f) : 1 - smooth(3.3, 3.5, f);
  // fresh spring lime: strongest just after budding, fading into summer
  const fresh = f > 3.4 ? smooth(3.4, 3.9, f) : 1 - smooth(0.15, 0.95, f);
  const snow = f < 2.84 ? 0 : f < 3.35 ? smooth(2.84, 3.05, f) : 1 - smooth(3.35, 3.72, f);
  const deep = smooth(0.4, 1.0, f) * (1 - smooth(1.2, 1.8, f)); // high-summer darkening
  return { f, cover, autumn, fresh, snow, deep };
}

// ── What the world is doing ─────────────────────────────────────────────────────
// Four keyframes (spring, summer, autumn, winter); cyclic, eased interpolation.
const C = h => new THREE.Color(h);
const KEYS = [
  { // spring — pale blush paper, a fresh morning from the right
    wall: C(0xf4ede6), floor: C(0xefe6dc), fog: C(0xf2ebe4), fogD: 0.018,
    key: C(0xfff1e2), keyI: 3.1, az: 38, el: 46, soft: 5,
    sky: C(0xfbf3ec), ground: C(0xcdbfae), hemiI: 1.05, glow: 0.07, accent: '#c9788a', ink: '#1d1a17',
  },
  { // summer — green-tinted haze, sun high and hard
    wall: C(0xeeecdc), floor: C(0xe9e5d2), fog: C(0xebe9d8), fogD: 0.055,
    key: C(0xfff5da), keyI: 3.7, az: 18, el: 64, soft: 2,
    sky: C(0xf4f3e2), ground: C(0xb7b394), hemiI: 0.95, glow: 0.05, accent: '#4f7a3a', ink: '#1b1c16',
  },
  { // autumn — warm paper, low golden side light from the left
    wall: C(0xf2e5d3), floor: C(0xecdcc6), fog: C(0xf0e2cf), fogD: 0.022,
    key: C(0xffc58c), keyI: 3.6, az: -48, el: 21, soft: 3.5,
    sky: C(0xf6e6d0), ground: C(0x8f6b4b), hemiI: 0.8, glow: 0.09, accent: '#d2553b', ink: '#1e1813',
  },
  { // winter — cool slate paper so the snow reads, diffuse cold light
    wall: C(0xd3d7dc), floor: C(0xd8dce0), fog: C(0xd2d7dd), fogD: 0.045,
    key: C(0xe2ebff), keyI: 1.7, az: -12, el: 52, soft: 16,
    sky: C(0xeef2f8), ground: C(0x8f98a3), hemiI: 1.45, glow: 0.03, accent: '#4b5d7a', ink: '#171a1f',
  },
];
const ease = t => t * t * (3 - 2 * t);
const out = {
  wall: new THREE.Color(), floor: new THREE.Color(), fog: new THREE.Color(), key: new THREE.Color(),
  sky: new THREE.Color(), ground: new THREE.Color(), accent: new THREE.Color(), ink: new THREE.Color(),
};
const ca = new THREE.Color(), cb = new THREE.Color();
export function worldState(s) {
  const f = wrap(s);
  const i = Math.floor(f) % 4, j = (i + 1) % 4;
  const t = ease(f - Math.floor(f));
  const a = KEYS[i], b = KEYS[j];
  for (const k of ['wall', 'floor', 'fog', 'key', 'sky', 'ground']) out[k].copy(a[k]).lerp(b[k], t);
  out.accent.copy(ca.set(a.accent)).lerp(cb.set(b.accent), t);
  out.ink.copy(ca.set(a.ink)).lerp(cb.set(b.ink), t);
  for (const k of ['fogD', 'keyI', 'el', 'soft', 'hemiI', 'glow']) out[k] = a[k] + (b[k] - a[k]) * t;
  // azimuth goes the short way round
  let d = b.az - a.az; out.az = a.az + d * t;
  // particles
  out.petals = clamp(1 - Math.abs(((f + 2) % 4) - 2) / 0.55);            // around f = 0
  out.motes = clamp(1 - Math.abs(f - 1) / 0.7) + clamp(1 - Math.abs(((f + 2) % 4) - 2) / 0.5) * 0.4;
  out.snowfall = clamp(1 - Math.abs(f - 3.08) / 0.36);
  out.leafRate = f > 1.7 && f < 2.95 ? 5.5 + 34 * smooth(2.2, 2.45, f) * (1 - smooth(2.55, 2.9, f)) : f > 0.6 && f < 1.4 ? 0.12 : 0;
  return out;
}
