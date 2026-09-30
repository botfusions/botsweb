// Solar geometry and the day's palette for Casa do Penhasco, Cabo Espichel, on the June solstice.
import * as THREE from 'three';

const D = Math.PI / 180;
export const SITE = { lat: 38.42, lon: -9.22, name: 'Cabo Espichel', coords: '38°25′N  9°13′W' };
const DEC = 23.44 * D;                       // solar declination, 21 June
export const NOON = 13 + 38 / 60;            // local clock (WEST, UTC+1) at solar noon
export const T0 = 5.5, T1 = 22.75;           // the handle's range, in clock hours
// The house is rotated so the pool terrace (+z) faces 240° WSW, over the Atlantic.
export const NORTH_OFFSET = -60 * D;

export const DECS = { jun: DEC, equinox: 0, dec: -DEC };
export function sunAngles(clock, dec = DEC) {
  const H = (clock - NOON) * 15 * D;
  const lat = SITE.lat * D;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(sinAlt);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) + Math.PI;
  return { alt, az };
}

/** World direction for a compass azimuth (radians, clockwise from north) and altitude. */
export function compassDir(az, alt, out = new THREE.Vector3()) {
  const a = az + NORTH_OFFSET;
  return out.set(Math.sin(a) * Math.cos(alt), Math.sin(alt), -Math.cos(a) * Math.cos(alt));
}

// Sunrise / sunset with refraction (altitude −0.83°).
function crossing(sign) {
  const lat = SITE.lat * D;
  const c = (Math.sin(-0.83 * D) - Math.sin(lat) * Math.sin(DEC)) / (Math.cos(lat) * Math.cos(DEC));
  return NOON + sign * Math.acos(c) / D / 15;
}
export const SUNRISE = crossing(-1), SUNSET = crossing(1);

export function fmtTime(h) {
  let m = Math.round(h * 60);
  const hh = Math.floor(m / 60) % 24, mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function phaseName(h, altDeg) {
  if (altDeg < -12) return 'Night';
  if (altDeg < -0.83) return h < NOON ? 'Blue hour' : 'Blue hour';
  if (Math.abs(h - SUNRISE) < 0.25) return 'Sunrise';
  if (Math.abs(h - SUNSET) < 0.25) return 'Sunset';
  if (altDeg < 9) return h < NOON ? 'First light' : 'Golden hour';
  if (Math.abs(h - NOON) < 0.4) return 'Solar noon';
  return h < NOON ? 'Morning' : 'Afternoon';
}

// ─── Palette ──────────────────────────────────────────────────────────────────
// Keyed on the clock. Colours are sRGB hex (converted to linear on use); intensities are linear.
// zen/hor: sky; sun: light colour; I: sun intensity; amb: environment strength; ink: 0 = dark type on paper, 1 = light type.
const K = [
  { t: 5.50, zen: '#04060c', hor: '#0b1222', sun: '#8aa2ff', I: 0.00, amb: 0.55, ink: 1 },
  { t: 5.75, zen: '#0a1428', hor: '#1f2c49', sun: '#8aa2ff', I: 0.00, amb: 0.6, ink: 1 },
  { t: 6.00, zen: '#27344f', hor: '#7d7189', sun: '#ff9a7a', I: 0.00, amb: 0.7, ink: 1 },
  { t: 6.22, zen: '#56637f', hor: '#e1a794', sun: '#ff8f6c', I: 0.55, amb: 0.7, ink: 0.55 },
  { t: 6.80, zen: '#8997b1', hor: '#efc6b2', sun: '#ffb793', I: 1.4, amb: 0.62, ink: 0 },
  { t: 8.00, zen: '#b3bfcd', hor: '#ebe1d6', sun: '#ffeedd', I: 2.0, amb: 0.56, ink: 0 },
  { t: 10.0, zen: '#c6ced6', hor: '#ecebe6', sun: '#fff8ef', I: 2.3, amb: 0.52, ink: 0 },
  { t: 13.6, zen: '#ccd3d9', hor: '#ecebe6', sun: '#fffdf8', I: 2.4, amb: 0.5, ink: 0 },
  { t: 16.8, zen: '#c3cad2', hor: '#eeeae3', sun: '#fff3e2', I: 2.3, amb: 0.5, ink: 0 },
  { t: 18.5, zen: '#b8c1cf', hor: '#f4e4c8', sun: '#ffdcaa', I: 2.5, amb: 0.5, ink: 0 },
  { t: 19.5, zen: '#aeb8cb', hor: '#f8d7a0', sun: '#ffc278', I: 3.2, amb: 0.48, ink: 0 },
  { t: 20.4, zen: '#8e97b4', hor: '#f6bd82', sun: '#ffa35a', I: 2.6, amb: 0.5, ink: 0 },
  { t: 20.62, zen: '#727ca3', hor: '#f0a878', sun: '#ff8c4a', I: 1.8, amb: 0.52, ink: 0.35 },
  { t: 21.02, zen: '#4b5281', hor: '#d98b76', sun: '#ff6a36', I: 0.45, amb: 0.58, ink: 1 },
  { t: 21.35, zen: '#1c2644', hor: '#465176', sun: '#ff6a36', I: 0.0, amb: 0.62, ink: 1 },
  { t: 21.9, zen: '#0b1227', hor: '#19223c', sun: '#8aa2ff', I: 0.0, amb: 0.6, ink: 1 },
  { t: 22.75, zen: '#04060c', hor: '#0b1222', sun: '#8aa2ff', I: 0.0, amb: 0.55, ink: 1 },
];
const cache = K.map(k => ({ ...k, zenC: new THREE.Color(k.zen), horC: new THREE.Color(k.hor), sunC: new THREE.Color(k.sun) }));

export function palette(h, out) {
  let i = 0;
  while (i < cache.length - 2 && h > cache[i + 1].t) i++;
  const a = cache[i], b = cache[i + 1];
  const f = THREE.MathUtils.clamp((h - a.t) / (b.t - a.t), 0, 1);
  const s = f * f * (3 - 2 * f);
  out.zen.copy(a.zenC).lerp(b.zenC, s);
  out.hor.copy(a.horC).lerp(b.horC, s);
  out.sun.copy(a.sunC).lerp(b.sunC, s);
  out.I = a.I + (b.I - a.I) * s;
  out.amb = a.amb + (b.amb - a.amb) * s;
  out.ink = a.ink + (b.ink - a.ink) * s;
  // Night: 0 by day, 1 in full dark (windows, pool, stars, moon).
  const eve = THREE.MathUtils.smoothstep(h, 20.75, 21.7), morn = 1 - THREE.MathUtils.smoothstep(h, 5.7, 6.35);
  out.night = Math.max(eve, morn);
  out.stars = Math.max(THREE.MathUtils.smoothstep(h, 21.3, 22.1), 1 - THREE.MathUtils.smoothstep(h, 5.6, 6.0));
  return out;
}
export const makePalette = () => ({ zen: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), I: 0, amb: 1, ink: 0, night: 0, stars: 0 });
