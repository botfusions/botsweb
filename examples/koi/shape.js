// The pond's plan: one signed-distance outline shared by the terrain, the ripple mask, the koi and the leaves.
// World units are metres; the water surface is y = 0, +y up; the far (north) shore is toward -z.

// Seeded 2D gradient noise.
const P = new Uint8Array(512);
{
  let s = 1337;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
}
const G = Array.from({ length: 256 }, (_, i) => [Math.cos(i * 2.39996), Math.sin(i * 2.39996)]);
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
export function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const g = (ix, iy) => G[P[(P[ix & 255] + iy) & 255]];
  const d = (gg, dx, dy) => gg[0] * dx + gg[1] * dy;
  const u = fade(xf), v = fade(yf);
  const a = d(g(xi, yi), xf, yf), b = d(g(xi + 1, yi), xf - 1, yf);
  const c = d(g(xi, yi + 1), xf, yf - 1), e = d(g(xi + 1, yi + 1), xf - 1, yf - 1);
  return (a + (b - a) * u) + ((c + (e - c) * u) - (a + (b - a) * u)) * v; // ~[-0.7, 0.7]
}
export const fbm = (x, y, o = 4) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * noise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; };

const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
const ell = (x, z, cx, cz, rx, rz) => { const dx = (x - cx) / rx, dz = (z - cz) / rz; return (Math.hypot(dx, dz) - 1) * Math.min(rx, rz); };

/** Signed distance to the shoreline in metres: negative over water. */
export function pondSDF(x, z) {
  let d = ell(x, z, 0.2, 2.2, 7.4, 5.6);             // main basin
  d = smin(d, ell(x, z, -5.2, 5.8, 3.6, 3.0), 1.6);  // south-west lobe
  d = smin(d, ell(x, z, -2.2, -2.6, 3.4, 2.0), 1.4); // north-west bay, under the maple
  d = smax(d, -ell(x, z, 3.7, -3.35, 1.9, 1.35), 1.2); // the lantern's bank juts in from the north-east
  d = smax(d, -ell(x, z, 6.9, 3.4, 1.4, 2.2), 1.0);  // east bank bulge
  d += fbm(x * 0.32 + 3.1, z * 0.32 - 1.7, 3) * 1.1;
  return d;
}

const ss = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Terrain height: the pond floor under water, moss banks above. */
export function terrainH(x, z) {
  const d = pondSDF(x, z);
  if (d < 0) {
    const deep = Math.pow(ss(0, 2.8, -d), 0.8);
    const lumps = fbm(x * 0.9, z * 0.9, 3) * 0.14 * ss(0.3, 1.5, -d);
    return 0.02 - 0.12 * ss(0, 0.35, -d) - 1.25 * deep + lumps;
  }
  const mounds = fbm(x * 0.35 + 7, z * 0.35, 4) * 0.55 * ss(0.4, 3, d);
  return 0.02 + 0.13 * ss(0, 0.4, d) + 0.32 * ss(0.4, 4, d) + Math.max(mounds, -0.1);
}

export const LANTERN = { x: 3.45, z: -2.62, rock: 1.25 };
export const MAPLE = { x: -3.4, z: -3.2 }; // trunk position, canopy spreads south-east over the bay
