// The maple: seasonal material (foliage-only hue remap, noise dissolve, snow on top faces, breeze),
// mesh analysis (where the leaves, trunk and moss are) and procedural winter twigs grown into the canopy.
import { THREE, clamp, lerp } from '../../src/core/engine.js';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';

export const NOISE = /* glsl */`
float kh13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float kvn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(kh13(i), kh13(i + vec3(1,0,0)), f.x), mix(kh13(i + vec3(0,1,0)), kh13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(kh13(i + vec3(0,0,1)), kh13(i + vec3(1,0,1)), f.x), mix(kh13(i + vec3(0,1,1)), kh13(i + vec3(1,1,1)), f.x), f.y), f.z); }
vec3 krgb2hsv(vec3 c){ vec4 K = vec4(0., -1./3., 2./3., -1.); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6. * d + 1e-10)), d / (q.x + 1e-10), q.x); }
vec3 khsv2rgb(vec3 c){ vec3 p = abs(fract(c.xxx + vec3(0., 2./3., 1./3.)) * 6. - 3.); return c.z * mix(vec3(1.), clamp(p - 1., 0., 1.), c.y); }
`;

// Shared seasonal uniforms (one object, referenced by every patched material).
export const U = {
  uTime: { value: 0 }, uBreeze: { value: 0.2 }, uWind: { value: new THREE.Vector3(-1, 0, 0.3).normalize() },
  uShake: { value: 0 }, uShakeDir: { value: new THREE.Vector3(1, 0, 0) },
  uSwayY0: { value: 0.4 }, uSwayY1: { value: 1.8 }, uInvModel: { value: new THREE.Matrix3() },
  uFolY0: { value: 0.5 }, uFolY1: { value: 0.6 },
  uCover: { value: 1 }, uAutumn: { value: 0 }, uFresh: { value: 0 }, uDeep: { value: 0 }, uSnow: { value: 0 }, uGlow: { value: 0.1 },
  uSnowCol: { value: new THREE.Color(0.9, 0.92, 0.96) }, uDbg: { value: 0 },
  uWarm: { value: new THREE.Color(1, 1, 1) },
  uTrunk: { value: Array.from({ length: 24 }, () => new THREE.Vector3(0, -10, 0)) }, uTrunkN: { value: 0 }, uTrunkR: { value: new THREE.Vector4(0.1, 0.045, 0, 1) },
};

const SWAY_HEAD = /* glsl */`
uniform float uTime, uBreeze, uShake, uSwayY0, uSwayY1; uniform vec3 uWind, uShakeDir; uniform mat3 uInvModel;
attribute float aFol;
varying vec3 vWPos; varying vec3 vWNrm;
vec3 kSway(vec3 wp){
  float hh = clamp((wp.y - uSwayY0) / (uSwayY1 - uSwayY0), 0., 1.);
  float bend = hh * hh;
  float ph = dot(wp, vec3(2.1, 1.3, 1.7));
  vec3 sway = uWind * (sin(uTime * 1.1 + ph * 0.5) * 0.6 + sin(uTime * 2.3 + ph * 1.3) * 0.4) * bend * (0.004 + 0.026 * uBreeze);
  vec3 flut = vec3(sin(uTime * 9.0 + ph * 23.), sin(uTime * 11.0 + ph * 17.) * 0.6, cos(uTime * 8.0 + ph * 19.)) * aFol * hh * (0.0008 + 0.0042 * uBreeze + 0.01 * abs(uShake));
  vec3 shake = uShakeDir * uShake * bend * (0.55 + 0.45 * aFol) * 0.085;
  return sway + flut + shake;
}`;
const SWAY_BODY = /* glsl */`
  vec3 kwp = (modelMatrix * vec4(transformed, 1.)).xyz;
  transformed += uInvModel * kSway(kwp);
  vWPos = (modelMatrix * vec4(transformed, 1.)).xyz;
`;

const FOL_HEAD = /* glsl */`
uniform float uFolY0, uFolY1, uCover, uAutumn, uFresh, uDeep, uSnow, uGlow, uDbg; uniform vec3 uSnowCol;
varying vec3 vWPos; varying vec3 vWNrm;
${NOISE}
uniform vec3 uTrunk[24]; uniform int uTrunkN; uniform vec4 uTrunkR; uniform vec3 uWarm;
// distance to the trunk centreline, so moss on the bark never counts as foliage
float kTrunkGuard(vec3 p){
  float d = 1e3;
  for (int i = 0; i < 23; i++) { if (i >= uTrunkN - 1) break; vec3 a = uTrunk[i], b = uTrunk[i + 1]; vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); d = min(d, length(pa - ba * h)); }
  float r = mix(uTrunkR.x, uTrunkR.y, clamp((p.y - uTrunkR.z) / (uTrunkR.w - uTrunkR.z), 0., 1.));
  return smoothstep(r, r * 1.35, d);
}
float kFoliage(vec3 lin, float wy){
  vec3 c = pow(max(lin, vec3(0.)), vec3(1. / 2.2));
  vec3 h = krgb2hsv(c);
  float hue = smoothstep(0.13, 0.18, h.x) * (1. - smoothstep(0.47, 0.53, h.x));
  float sat = smoothstep(0.17, 0.33, h.y);
  float val = smoothstep(0.04, 0.10, h.z);
  return hue * sat * val * smoothstep(uFolY0, uFolY1, wy);
}
// looser test for the leaf geometry itself (dark, shadowed, desaturated leaves) once the tree is bare
float kLeafGeo(vec3 lin, float wy){
  vec3 h = krgb2hsv(pow(max(lin, vec3(0.)), vec3(1. / 2.2)));
  float hue = smoothstep(0.12, 0.16, h.x) * (1. - smoothstep(0.5, 0.56, h.x));
  return hue * smoothstep(0.04, 0.1, h.y) * smoothstep(uFolY0, uFolY1, wy);
}
float kDrop(vec3 p){ return clamp((kvn(p * 13.) * 0.6 + kvn(p * 41. + 3.1) * 0.4 - 0.5) * 2.3 + 0.5, 0., 1.); }
`;

function patchVertex(shader, { normals = true } = {}) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${SWAY_HEAD}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY_BODY}\n${normals ? 'vWNrm = normalize(mat3(modelMatrix) * objectNormal);' : 'vWNrm = vec3(0., 1., 0.);'}`);
}

/** Patch the maple's own material (foliage recolour, dissolve, snow, glow). */
export function patchTreeMaterial(mat) {
  mat.side = THREE.DoubleSide;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, U);
    patchVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FOL_HEAD}`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        vec3 kBase = diffuseColor.rgb;
        float kRaw = kFoliage(kBase, vWPos.y);
        float kFol = kRaw * kTrunkGuard(vWPos);
        float kSnowA = 0.;
        if (kFol > 0.01) {
          vec3 cs = pow(max(kBase, vec3(0.)), vec3(1. / 2.2));
          vec3 hsv = krgb2hsv(cs);
          // Art-directed palettes; the texture only contributes its light and shade (v) and a little hue drift.
          float v = smoothstep(0.22, 0.92, hsv.z);
          float dev = clamp(hsv.x - 0.25, -0.06, 0.06);
          float n1 = kvn(vWPos * 5.5), n2 = kvn(vWPos * 19. + 11.), n3 = kvn(vWPos * 47. + 5.);
          vec3 late = mix(vec3(0.24, 0.36, 0.13), vec3(0.52, 0.64, 0.3), v);
          vec3 spring = mix(vec3(0.45, 0.6, 0.19), vec3(0.76, 0.86, 0.42), v) + vec3(dev * 0.5, 0., 0.);
          vec3 summer = mix(vec3(0.1, 0.2, 0.07), vec3(0.3, 0.46, 0.17), v) * (0.92 + n2 * 0.16);
          vec3 green = mix(late, spring, uFresh);
          green = mix(green, summer, uDeep);
          // autumn: each region turns at its own moment, crowns and outer tips first
          float turnAt = clamp(n1 * 0.7 + n2 * 0.3 - (vWPos.y - uFolY1) * 0.18, 0., 1.);
          float turned = smoothstep(turnAt - 0.18, turnAt + 0.18, uAutumn * 1.4 - 0.2);
          float red = clamp(0.8 + (n1 - 0.5) * 1.6 + (vWPos.y - uFolY1) * 0.22 + (n3 - 0.5) * 0.35, 0., 1.);
          vec3 wine = vec3(0.42, 0.07, 0.07), crimson = vec3(0.66, 0.12, 0.09), scarlet = vec3(0.79, 0.19, 0.11), orange = vec3(0.88, 0.45, 0.16), amber = vec3(0.9, 0.66, 0.24);
          vec3 aut = mix(orange, scarlet, smoothstep(0.15, 0.5, red));
          aut = mix(aut, crimson, smoothstep(0.5, 0.88, red));
          aut = mix(aut, amber, smoothstep(0.72, 0.92, n3) * 0.6 * (1. - red));
          aut = mix(wine, aut, smoothstep(0.0, 0.55, v)) * mix(0.72, 1.08, v);
          vec3 yel = mix(vec3(0.62, 0.52, 0.14), vec3(0.93, 0.78, 0.3), v);
          float mid = smoothstep(0.0, 0.5, turned) * (1. - smoothstep(0.5, 1.0, turned));
          vec3 leaf = mix(green, aut, turned);
          leaf = mix(leaf, yel, mid * 0.5);
          // drying before the drop
          float dn = kDrop(vWPos);
          float dry = smoothstep(uCover - 0.16, uCover + 0.02, dn) * (1. - uCover * 0.9) * uAutumn;
          leaf = mix(leaf, vec3(0.4, 0.2, 0.09) * (0.6 + v * 0.6), dry * 0.8);
          diffuseColor.rgb = mix(kBase, pow(leaf, vec3(2.2)), kFol);
          if (uDbg > 0.5) diffuseColor.rgb = mix(kBase, vec3(1., 0., 1.), kFol);
          if (kFol > mix(0.08, 0.42, uCover) && (dn > uCover || uCover < 0.01)) discard;
        }
        diffuseColor.rgb *= mix(uWarm, vec3(1.), kFol);
        // leaf texels protected on the trunk: in the bare months they read as dull winter moss, not stray leaves
        { float lum = dot(kBase, vec3(0.3, 0.55, 0.15)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.075, 0.05) + lum * vec3(0.35, 0.28, 0.18), clamp(kRaw - kFol, 0., 1.) * clamp(1. - uCover * 1.6, 0., 1.) * 0.85); }
        // bare tree: everything in the canopy zone except the trunk gives way to the grown branch structure
        if (uCover < 0.35) { float lg = kTrunkGuard(vWPos) * smoothstep(uFolY0, uFolY1, vWPos.y); if (lg > 0.5 && (kDrop(vWPos) > uCover * 2.8 || uCover < 0.01)) discard; }
        {
          vec3 wn = normalize(vWNrm);
          float up = wn.y * (gl_FrontFacing ? 1. : -1.);
          float sn = smoothstep(0.45, 0.85, up + (kvn(vWPos * 17.) - 0.5) * 0.45 + (kvn(vWPos * 61.) - 0.5) * 0.2);
          kSnowA = sn * uSnow * smoothstep(0.02, 0.12, vWPos.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, uSnowCol, kSnowA);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.74), kFol);\nroughnessFactor = mix(roughnessFactor, 0.62, kSnowA);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * kFol * uGlow * (1. - kSnowA);');
  };
  mat.customProgramCacheKey = () => 'koen-tree';
  mat.needsUpdate = true;
  return mat;
}

/** Shadow-casting depth material that drops the same leaves the colour pass drops. */
export function treeDepthMaterial(map) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, side: THREE.DoubleSide });
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, U);
    patchVertex(shader, { normals: false });
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FOL_HEAD}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        { float g = kTrunkGuard(vWPos); float f = kFoliage(diffuseColor.rgb, vWPos.y) * g; bool gone = kDrop(vWPos) > uCover || uCover < 0.01;
          if (f > mix(0.08, 0.42, uCover) && gone) discard;
          if (uCover < 0.35 && g * smoothstep(uFolY0, uFolY1, vWPos.y) > 0.5 && (kDrop(vWPos) > uCover * 2.8 || uCover < 0.01)) discard; }
        diffuseColor = vec4(1.);`);
  };
  m.customProgramCacheKey = () => 'koen-tree-depth';
  return m;
}

/** Bark material for procedural twigs and wire: sway + snow. */
export function patchBarkMaterial(mat, key = 'koen-bark', { snow = 1 } = {}) {
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, U);
    patchVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uSnow; uniform vec3 uSnowCol; varying vec3 vWPos; varying vec3 vWNrm;\n${NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float kSnowA = smoothstep(0.5, 0.88, normalize(vWNrm).y + (kvn(vWPos * 23.) - 0.5) * 0.35) * uSnow * ${snow.toFixed(2)};
        diffuseColor.rgb = mix(diffuseColor.rgb, uSnowCol, kSnowA);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.62, kSnowA);');
  };
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
  return mat;
}
export function barkDepthMaterial() {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = shader => { Object.assign(shader.uniforms, U); patchVertex(shader, { normals: false }); };
  m.customProgramCacheKey = () => 'koen-bark-depth';
  return m;
}

// ─── Analysis ──────────────────────────────────────────────────────────────────
function readPixels(map) {
  const img = map.image;
  const w = Math.min(img.width, 1024), h = Math.min(img.height, 1024);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, w, h);
  return { data: cx.getImageData(0, 0, w, h).data, w, h, flipY: map.flipY };
}
function texel(px, u, v) {
  u = ((u % 1) + 1) % 1; v = ((v % 1) + 1) % 1;
  const x = Math.floor(u * (px.w - 1)), y = Math.floor((px.flipY ? 1 - v : v) * (px.h - 1));
  const k = (y * px.w + x) * 4;
  return [px.data[k] / 255, px.data[k + 1] / 255, px.data[k + 2] / 255];
}
function hsv([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
  }
  return [h, mx > 0 ? d / mx : 0, mx];
}
const greenScore = c => {
  const [h, s, v] = hsv(c);
  const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  return sm(0.13, 0.18, h) * (1 - sm(0.47, 0.53, h)) * sm(0.17, 0.33, s) * sm(0.04, 0.1, v);
};

// Seeded random so the twigs grow the same way on every load.
function rng(seed = 7) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/**
 * Work out the anatomy of the tree from its surface: pot top, foliage pads, trunk line, ground height field.
 * Everything is in world space (call after the model is placed).
 */
export function analyze(mesh) {
  // MeshSurfaceSampler draws from Math.random: seed it so pads, branches and the wired branch are identical on every load.
  const mr = Math.random; Math.random = rng(1846);
  try { return analyzeInner(mesh); } finally { Math.random = mr; }
}
function analyzeInner(mesh) {
  mesh.updateMatrixWorld(true);
  const px = readPixels(mesh.material.map);
  const box = new THREE.Box3().setFromObject(mesh);
  const H = box.max.y - box.min.y, y0 = box.min.y;
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;

  // Per-vertex foliage attribute for the breeze.
  const geo = mesh.geometry;
  const uv = geo.attributes.uv, pos = geo.attributes.position;
  const fol = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) fol[i] = greenScore(texel(px, uv.getX(i), uv.getY(i)));

  // Surface samples.
  const N = 42000;
  const sampler = new MeshSurfaceSampler(mesh).build();
  const P = new Float32Array(N * 3), NR = new Float32Array(N * 3), G = new Float32Array(N);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color(), u2 = new THREE.Vector2();
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  for (let i = 0; i < N; i++) {
    sampler.sample(p, n, c, u2);
    p.applyMatrix4(mesh.matrixWorld); n.applyMatrix3(nm).normalize();
    P.set([p.x, p.y, p.z], i * 3); NR.set([n.x, n.y, n.z], i * 3);
    G[i] = greenScore(texel(px, u2.x, u2.y));
  }

  // Radial profile to find the pot rim: wide at the bottom (pot), narrow above it (trunk), wide again (canopy).
  const BINS = 60;
  const rad = Array.from({ length: BINS }, () => []);
  for (let i = 0; i < N; i++) {
    const t = (P[i * 3 + 1] - y0) / H;
    if (t >= 0.6) continue;
    const b = Math.floor(t / 0.6 * BINS);
    rad[b].push(Math.hypot(P[i * 3] - cx, P[i * 3 + 2] - cz));
  }
  const pct = (arr, q) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor((s.length - 1) * q)]; };
  const r95 = rad.map(a => pct(a, 0.95));
  const potR = Math.max(...r95.slice(0, Math.floor(BINS * 0.3)));
  let potTopBin = 0;
  for (let b = 0; b < BINS * 0.5; b++) { if (r95[b] > potR * 0.6) potTopBin = b; else if (b > 2) break; }
  const potTop = y0 + (potTopBin + 1) / BINS * 0.6 * H;

  // Foliage points above the rim.
  const leafIdx = [];
  for (let i = 0; i < N; i++) if (G[i] > 0.5 && P[i * 3 + 1] > potTop + 0.05 * H) leafIdx.push(i);
  let folMin = Infinity;
  const ys = leafIdx.map(i => P[i * 3 + 1]).sort((a, b) => a - b);
  folMin = ys.length ? ys[Math.floor(ys.length * 0.01)] : potTop + 0.15 * H;
  const folY0 = Math.max(potTop + 0.03 * H, Math.min(folMin - 0.03 * H, potTop + 0.12 * H));
  const folY1 = folY0 + 0.04 * H;

  // Ground height field across the pot (moss, roots, rim) for leaves to land on.
  const GR = 44;
  const gMinX = cx - potR * 1.05, gMinZ = cz - potR * 1.05, gSize = potR * 2.1;
  const ground = new Float32Array(GR * GR).fill(-1);
  for (let i = 0; i < N; i++) {
    const y = P[i * 3 + 1];
    if (y > potTop + 0.06 * H) continue;
    const gx = Math.floor((P[i * 3] - gMinX) / gSize * GR), gz = Math.floor((P[i * 3 + 2] - gMinZ) / gSize * GR);
    if (gx < 0 || gz < 0 || gx >= GR || gz >= GR) continue;
    const k = gz * GR + gx;
    if (y > ground[k]) ground[k] = y;
  }
  // Cells with few samples: fill from neighbours but only inside the rim footprint.
  for (let pass = 0; pass < 2; pass++) for (let z = 1; z < GR - 1; z++) for (let x = 1; x < GR - 1; x++) {
    const k = z * GR + x; if (ground[k] >= 0) continue;
    let s = 0, m = 0; for (const d of [-1, 1, -GR, GR]) if (ground[k + d] >= 0) { s += ground[k + d]; m++; }
    if (m >= 3) ground[k] = s / m;
  }
  const groundAt = (x, z) => {
    const gx = Math.floor((x - gMinX) / gSize * GR), gz = Math.floor((z - gMinZ) / gSize * GR);
    if (gx < 0 || gz < 0 || gx >= GR || gz >= GR) return -1;
    return ground[gz * GR + gx];
  };

  // Foliage pads: k-means on leaf points (height weighted so tiers separate).
  const rand = rng(11);
  const K = 7, WY = 1.6;
  const pts = leafIdx.map(i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
  const cents = [pts[Math.floor(rand() * pts.length)].slice()];
  while (cents.length < K) {
    let best = null, bd = -1;
    for (let j = 0; j < pts.length; j += 7) {
      const q = pts[j];
      let d = Infinity;
      for (const c0 of cents) d = Math.min(d, (q[0] - c0[0]) ** 2 + ((q[1] - c0[1]) * WY) ** 2 + (q[2] - c0[2]) ** 2);
      if (d > bd) { bd = d; best = q; }
    }
    cents.push(best.slice());
  }
  const assign = new Int32Array(pts.length);
  for (let it = 0; it < 14; it++) {
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (let j = 0; j < pts.length; j++) {
      const q = pts[j]; let bi = 0, bd = Infinity;
      for (let k = 0; k < K; k++) { const c0 = cents[k]; const d = (q[0] - c0[0]) ** 2 + ((q[1] - c0[1]) * WY) ** 2 + (q[2] - c0[2]) ** 2; if (d < bd) { bd = d; bi = k; } }
      assign[j] = bi; const a = acc[bi]; a[0] += q[0]; a[1] += q[1]; a[2] += q[2]; a[3]++;
    }
    for (let k = 0; k < K; k++) if (acc[k][3]) cents[k] = [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]];
  }
  const pads = cents.map((c0, k) => {
    const mem = []; for (let j = 0; j < pts.length; j++) if (assign[j] === k) mem.push(pts[j]);
    let sx = 0, sy = 0, sz = 0;
    for (const q of mem) { sx += (q[0] - c0[0]) ** 2; sy += (q[1] - c0[1]) ** 2; sz += (q[2] - c0[2]) ** 2; }
    const m = Math.max(1, mem.length);
    const std = new THREE.Vector3(Math.sqrt(sx / m), Math.sqrt(sy / m), Math.sqrt(sz / m));
    return { center: new THREE.Vector3(...c0), std, members: mem, radius: Math.max(std.x, std.y, std.z) * 1.9 };
  }).filter(pd => pd.members.length > 40);

  // Trunk line: track bark (non-green) points upward from the rim.
  const bark = [];
  for (let i = 0; i < N; i++) if (G[i] < 0.15 && P[i * 3 + 1] > potTop) bark.push([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
  const trunk = [];
  let tc = [cx, cz], rr = 0.14 * H;
  const step = 0.035 * H;
  for (let y = potTop + 0.02 * H; y < box.max.y - 0.1 * H; y += step) {
    const near = bark.filter(q => q[1] >= y && q[1] < y + step && Math.hypot(q[0] - tc[0], q[2] - tc[1]) < rr);
    if (near.length < 10) break;
    let sx = 0, sz = 0; for (const q of near) { sx += q[0]; sz += q[2]; }
    tc = [sx / near.length, sz / near.length];
    trunk.push(new THREE.Vector3(tc[0], y + step / 2, tc[1]));
    rr = 0.08 * H;
  }
  if (trunk.length < 3) {
    trunk.length = 0;
    for (let t = 0; t <= 1; t += 0.1) trunk.push(new THREE.Vector3(cx, lerp(potTop, y0 + 0.75 * H, t), cz));
  }
  // Leaf spawn points (surface + outward normal) for falling leaves.
  const spawn = { position: new Float32Array(leafIdx.length * 3), normal: new Float32Array(leafIdx.length * 3), count: leafIdx.length };
  leafIdx.forEach((i, j) => { spawn.position.set(P.subarray(i * 3, i * 3 + 3), j * 3); spawn.normal.set(NR.subarray(i * 3, i * 3 + 3), j * 3); });

  return { H, y0, box, center: new THREE.Vector3(cx, 0, cz), potTop, potR, folY0, folY1, pads, trunk, groundAt, spawn, vertexFoliage: fol };
}

// ─── Procedural branches ───────────────────────────────────────────────────────
/** Sweep a tapered tube along points. Returns arrays appended into `acc`. */
function tube(acc, pts, r0, r1, radial, segs, fol0 = 0, fol1 = 1) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const frames = curve.computeFrenetFrames(segs, false);
  const base = acc.pos.length / 3;
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    const r = lerp(r0, r1, Math.pow(t, 0.8));
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * Math.PI * 2;
      N.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a)).normalize();
      acc.pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r);
      acc.nor.push(N.x, N.y, N.z);
      acc.uv.push(j / radial, t);
      acc.fol.push(lerp(fol0, fol1, t));
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = base + i * (radial + 1) + j, b = a + radial + 1;
    acc.idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  return curve;
}

/** Tube along points with a radius per point (Catmull-Rom smoothed). */
function tubeR(acc, pts, radii, radial, segs, folOf) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const frames = curve.computeFrenetFrames(segs, false);
  const base = acc.pos.length / 3;
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  const n = radii.length - 1;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    const f = t * n, k = Math.min(n - 1, Math.floor(f));
    const r = lerp(radii[k], radii[k + 1], f - k);
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * Math.PI * 2;
      N.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a)).normalize();
      acc.pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r);
      acc.nor.push(N.x, N.y, N.z);
      acc.uv.push(j / radial, t * 4);
      acc.fol.push(folOf(r));
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = base + i * (radial + 1) + j, b = a + radial + 1;
    acc.idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  return curve;
}

/**
 * Winter structure: space colonisation inside each foliage pad. Leaf-surface points are the attractors; growth
 * starts on the trunk, so each pad gets a main limb that forks into the fine lace a pruned maple shows in winter.
 * Radii follow the pipe model (r^2.4 of a fork = sum of its children's).
 */
export function growBranches(A, { seed = 3, attractors = 150 } = {}) {
  const rand = rng(seed);
  const H = A.H;
  const acc = { pos: [], nor: [], uv: [], fol: [], idx: [] };
  const trunkTop = A.trunk[A.trunk.length - 1];
  const nearestTrunk = y => {
    let best = A.trunk[0];
    for (const t of A.trunk) if (t.y <= y && t.y > best.y) best = t;
    return best;
  };
  const SEG = 0.02 * H, KILL = 0.034 * H, RTIP = 0.0011 * H, RMAX = 0.0135 * H;
  const mains = [];
  const tmp = new THREE.Vector3();
  for (const pad of A.pads) {
    const c = pad.center;
    // attractors: leaf points, pulled a little inside and under the pad surface
    const att = [];
    for (let i = 0; i < attractors; i++) {
      const q = pad.members[Math.floor(rand() * pad.members.length)];
      const v = new THREE.Vector3(...q).lerp(c, 0.12);
      v.y -= 0.012 * H + rand() * 0.012 * H;
      att.push(v);
    }
    const isApex = c.y > trunkTop.y - 0.05 * H;
    const start = (isApex ? trunkTop : nearestTrunk(c.y - pad.std.y * 1.2 - 0.05 * H)).clone();
    const nodes = [{ p: start, parent: -1, dir: new THREE.Vector3(), n: 0 }];
    const alive = att.map(() => true);
    for (let it = 0; it < 90; it++) {
      for (const nd of nodes) { nd.dir.set(0, 0, 0); nd.n = 0; }
      let any = false;
      for (let a = 0; a < att.length; a++) {
        if (!alive[a]) continue;
        let bi = -1, bd = Infinity;
        for (let k = 0; k < nodes.length; k++) { const d = nodes[k].p.distanceToSquared(att[a]); if (d < bd) { bd = d; bi = k; } }
        if (bd < KILL * KILL) { alive[a] = false; continue; }
        const nd = nodes[bi];
        nd.dir.add(tmp.copy(att[a]).sub(nd.p).normalize()); nd.n++;
        any = true;
      }
      if (!any) break;
      const L = nodes.length;
      for (let k = 0; k < L; k++) {
        const nd = nodes[k];
        if (!nd.n) continue;
        const d = nd.dir.normalize();
        d.x += (rand() - 0.5) * 0.5; d.y += (rand() - 0.5) * 0.3; d.z += (rand() - 0.5) * 0.5;
        d.normalize();
        const p = nd.p.clone().addScaledVector(d, SEG);
        // avoid duplicates (two nodes growing into the same spot)
        let dup = false;
        for (let m = L; m < nodes.length; m++) if (nodes[m].p.distanceToSquared(p) < (SEG * 0.3) ** 2) { dup = true; break; }
        if (!dup) nodes.push({ p, parent: k, dir: new THREE.Vector3(), n: 0 });
      }
    }
    if (nodes.length < 3) continue;
    // pipe-model radii
    const kids = nodes.map(() => []);
    nodes.forEach((nd, i) => { if (nd.parent >= 0) kids[nd.parent].push(i); });
    const r = new Float32Array(nodes.length);
    const desc = new Int32Array(nodes.length);
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (!kids[i].length) { r[i] = RTIP; desc[i] = 1; continue; }
      let s = 0, dsum = 0;
      for (const k of kids[i]) { s += Math.pow(r[k], 2.4); dsum += desc[k]; }
      r[i] = Math.min(RMAX, Math.pow(s, 1 / 2.4) * 1.02 + 0.00005);
      desc[i] = dsum + 1;
    }
    // chains: follow the heaviest child, branch off the others
    const stack = [0];
    while (stack.length) {
      const s0 = stack.pop();
      const chain = nodes[s0].parent >= 0 ? [nodes[s0].parent, s0] : [s0];
      let cur = s0;
      while (kids[cur].length) {
        const ks = [...kids[cur]].sort((x, y) => desc[y] - desc[x]);
        for (let q = 1; q < ks.length; q++) stack.push(ks[q]);
        cur = ks[0];
        chain.push(cur);
      }
      if (chain.length < 2) continue;
      const pts = chain.map(i => nodes[i].p);
      const rad = chain.map(i => r[i]);
      if (pts.length === 2) { pts.splice(1, 0, pts[0].clone().lerp(pts[1], 0.5)); rad.splice(1, 0, (rad[0] + rad[1]) / 2); }
      const thick = rad[0] > 0.004 * H;
      const curve = tubeR(acc, pts, rad, thick ? 8 : rad[0] > 0.002 * H ? 5 : 4, Math.min(64, pts.length * (thick ? 3 : 2)), rr => clamp(1 - rr / (0.006 * H)));
      if (chain[0] === 0 || nodes[chain[0]].parent === -1) mains.push({ pad, curve, rad, len: pts.length, radiusAt: u => { const f = u * (rad.length - 1), k = Math.min(rad.length - 2, Math.floor(f)); return lerp(rad[k], rad[k + 1], f - k); } });
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uv, 2));
  g.setAttribute('aFol', new THREE.Float32BufferAttribute(acc.fol, 1));
  g.setIndex(acc.idx);
  return { geometry: g, mains };
}

/** A copper wire wound at ~45° along a branch curve; drawRange reveals the winding. */
export function wireGeometry(curve, radiusAt, { from = 0.06, to = 0.78, wire = 0.0032, turnsPerUnit = 0 } = {}) {
  const L = curve.getLength() * (to - from);
  const pts = [];
  const n = 420;
  const frames = curve.computeFrenetFrames(n, false);
  let ang = 0;
  const P = new THREE.Vector3(), T = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const t = from + (to - from) * i / n;
    curve.getPointAt(t, P);
    const fi = Math.min(n, Math.round(t * n));
    const r = radiusAt(t) + wire * 0.9;
    // 45°: advance one circumference of angle per circumference of length
    if (i > 0) ang += (L / n) / r * (turnsPerUnit || 1);
    T.copy(frames.normals[fi]).multiplyScalar(Math.cos(ang)).addScaledVector(frames.binormals[fi], Math.sin(ang));
    pts.push(P.clone().addScaledVector(T, r));
  }
  const path = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(path, 900, wire, 6, false);
  g.setAttribute('aFol', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(0.4), 1));
  return { geometry: g, segs: 900, radial: 6 };
}
