// The south-pole rim: CPU heightfield (so boots, rocks and the lander sit exactly on it), a warped near mesh,
// a polar far mesh with massifs and a crater that never sees the Sun, and the regolith shader:
// world-space albedo + micro-crater normals, raymarched heightfield shadows with a physically sized penumbra,
// and a partial Lommel–Seeliger term (the reason the Moon looks flat and bright under a grazing sun).
import { THREE, smooth } from '../../src/core/engine.js';
import { bakeTexture, fbmTexture } from '../../src/core/textures.js';
import { makeNoise, mulberry32 } from './noise.js';

export const HF = { cx: 22, cz: -4, half: 64, N: 1024 };

// Walk path (x, z), the outpost pads and the sky directions.
export const LAYOUT = {
  path: [[-1.5, 0.4], [0, 0], [7, 0.6], [14, 0.1], [21, -1.3], [28, -3.2], [34, -4.8], [38.6, -6.1]],
  lander: { x: 45.2, z: -9.2, r: 6.5, yaw: -2.2 },
  hab: { x: 57, z: 8, r: 5 },
  mast: { x: 58, z: -21, r: 3 },
  toSun: new THREE.Vector3(-0.84, 0.123, 0.52).normalize(),
  toEarth: new THREE.Vector3(-0.05, 0.108, -1).normalize(),
};

const ss = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildHeight() {
  const nz = makeNoise(11);
  const rnd = mulberry32(2031);
  const { cx, cz, half, N } = HF;
  const x0 = cx - half, z0 = cz - half, step = (half * 2) / N;

  // Path as a dense polyline + distance lookup grid (1 m).
  const curve = new THREE.CatmullRomCurve3(LAYOUT.path.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const samples = curve.getSpacedPoints(160).map(v => [v.x, v.z]);
  const DG = 129, dd = (half * 2) / (DG - 1);
  const distGrid = new Float32Array(DG * DG);
  for (let j = 0; j < DG; j++) for (let i = 0; i < DG; i++) {
    const x = x0 + i * dd, z = z0 + j * dd;
    let m = 1e9;
    for (let k = 0; k < samples.length - 1; k++) {
      const [ax, az] = samples[k], [bx, bz] = samples[k + 1];
      const vx = bx - ax, vz = bz - az, wx = x - ax, wz = z - az;
      const t = Math.min(1, Math.max(0, (wx * vx + wz * vz) / (vx * vx + vz * vz)));
      const ex = wx - vx * t, ez = wz - vz * t;
      m = Math.min(m, ex * ex + ez * ez);
    }
    distGrid[j * DG + i] = Math.sqrt(m);
  }
  const pathDist = (x, z) => {
    const fx = Math.min(DG - 1.001, Math.max(0, (x - x0) / dd)), fz = Math.min(DG - 1.001, Math.max(0, (z - z0) / dd));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = distGrid[j * DG + i], b = distGrid[j * DG + i + 1], c = distGrid[(j + 1) * DG + i], d = distGrid[(j + 1) * DG + i + 1];
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  };
  const pads = [LAYOUT.lander, LAYOUT.hab, LAYOUT.mast];
  const padMask = (x, z, pad = 4) => {
    let m = 1;
    for (const p of pads) m = Math.min(m, ss(p.r, p.r + pad, Math.hypot(x - p.x, z - p.z)));
    return m;
  };

  // Large undulation shared with the far field.
  const base0 = (x, z) => nz.fbm2(x / 150, z / 150, 3) * 4.2 + nz.fbm2(x / 34 + 3.1, z / 34, 3) * 0.75;
  const padH = pads.map(p => base0(p.x, p.z));
  const base = (x, z) => {
    let b = base0(x, z);
    pads.forEach((p, k) => { const w = 1 - ss(p.r * 0.6, p.r + 7, Math.hypot(x - p.x, z - p.z)); b += (padH[k] - b) * w; });
    return b;
  };

  // Craters: a spatial hash keeps per-vertex cost low.
  const craters = [];
  const addCraters = (n, rMin, rMax, pow, clear, depthK, focus) => {
    let tries = 0;
    while (n > 0 && tries++ < n * 40) {
      const r = rMin + (rMax - rMin) * Math.pow(rnd(), pow);
      const fx = focus ? (rnd() * 2 - 1) * focus[0] + focus[1] : x0 + rnd() * half * 2;
      const fz = focus ? (rnd() * 2 - 1) * focus[2] + focus[3] : z0 + rnd() * half * 2;
      if (Math.abs(fx - cx) > half - 2 || Math.abs(fz - cz) > half - 2) continue;
      if (pathDist(fx, fz) < r + clear) continue;
      if (padMask(fx, fz, r + 2) < 1) continue;
      const depth = r * depthK * (0.55 + rnd() * 0.6);
      const fresh = rnd() < 0.3;
      craters.push({ x: fx, z: fz, r, depth: fresh ? depth : depth * 0.45, rim: depth * (fresh ? 0.3 + rnd() * 0.15 : 0.08 + rnd() * 0.1), infl: r * 2.2 });
      n--;
    }
  };
  addCraters(9, 7, 20, 1.3, 4, 0.17);
  addCraters(120, 1.2, 5.5, 2.2, 1.6, 0.2);
  addCraters(90, 0.8, 3, 2, 1.2, 0.22, [30, 20, 18, -3]);
  addCraters(520, 0.2, 1.1, 2.6, 0.55, 0.2, [36, 20, 22, -3]);
  addCraters(380, 0.25, 1.3, 2.4, 0.55, 0.16);
  const CELL = 4, GC = Math.ceil((half * 2) / CELL);
  const cells = Array.from({ length: GC * GC }, () => []);
  for (const c of craters) {
    const i0 = Math.max(0, Math.floor((c.x - c.infl - x0) / CELL)), i1 = Math.min(GC - 1, Math.floor((c.x + c.infl - x0) / CELL));
    const j0 = Math.max(0, Math.floor((c.z - c.infl - z0) / CELL)), j1 = Math.min(GC - 1, Math.floor((c.z + c.infl - z0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells[j * GC + i].push(c);
  }
  const K = Math.pow(2.2, -4);
  const craterH = (x, z) => {
    const i = Math.floor((x - x0) / CELL), j = Math.floor((z - z0) / CELL);
    if (i < 0 || j < 0 || i >= GC || j >= GC) return 0;
    let h = 0;
    for (const c of cells[j * GC + i]) {
      const dx = x - c.x, dz = z - c.z, d2 = dx * dx + dz * dz;
      if (d2 > c.infl * c.infl) continue;
      const u = Math.sqrt(d2) / c.r;
      if (u < 1) h += -c.depth + (c.depth + c.rim) * Math.pow(u, 2.3);
      else { const q = u * u; h += c.rim * (1 / (q * q) - K) / (1 - K); }
    }
    return h;
  };

  const H = (x, z) => {
    const edge = 1 - ss(half - 16, half - 3, Math.max(Math.abs(x - cx), Math.abs(z - cz)));
    const pm = ss(0.45, 2.6, pathDist(x, z));
    const pads_ = padMask(x, z);
    const detail = nz.fbm2(x / 5.2, z / 5.2, 4, 0.5) * 0.022 + nz.noise2(x / 1.3 + 7, z / 1.3) * 0.007;
    return base(x, z) + (detail * (0.25 + 0.75 * pm) * pads_ + craterH(x, z)) * edge;
  };

  const data = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) {
    const z = z0 + j * step;
    for (let i = 0; i <= N; i++) data[j * (N + 1) + i] = H(x0 + i * step, z);
  }
  const heightAt = (x, z) => {
    const fx = Math.min(N - 0.0001, Math.max(0, (x - x0) / step)), fz = Math.min(N - 0.0001, Math.max(0, (z - z0) / step));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, W = N + 1;
    const a = data[j * W + i], b = data[j * W + i + 1], c = data[(j + 1) * W + i], d = data[(j + 1) * W + i + 1];
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };
  const normalAt = (x, z, out = new THREE.Vector3(), e = step) => {
    const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  };

  // Far field: same undulation + massifs + a deep crater towards -Z, lunar curvature.
  const crater = { x: 1400, z: -4600, r: 2100, depth: 650, rim: 140 };
  const farH = (x, z) => {
    const dx = x - cx, dz = z - cz, r = Math.hypot(dx, dz);
    let h = base0(x, z);
    const far = ss(1800, 6500, r);
    const m = nz.fbm2(x / 3600 + 1.7, z / 3600 - 4.2, 5, 0.5);
    h += Math.max(0, m + 0.06) * 560 * far;
    h += nz.fbm2(x / 520, z / 520, 4) * 20 * ss(150, 900, r);
    // two named massifs on the horizon: a big one under the Earth, a lower one to the east
    for (const [mx, mz, mh, mw] of [[-900, -7600, 820, 2600], [5200, -5600, 430, 1900], [-6200, -2600, 380, 1700]]) {
      const d2 = ((x - mx) ** 2 + (z - mz) ** 2) / (mw * mw);
      if (d2 < 9) h += mh * Math.exp(-d2) * (0.72 + 0.28 * nz.ridge2(x / 900 + mx, z / 900, 5));
    }
    const u = Math.hypot(x - crater.x, z - crater.z) / crater.r;
    if (u < 1) h += -crater.depth + (crater.depth + crater.rim) * Math.pow(u, 2.0);
    else if (u < 1.7) h += crater.rim * Math.pow(1 - (u - 1) / 0.7, 2);
    h -= (r * r) / (2 * 1737400);
    return h;
  };

  return { data, step, x0, z0, heightAt, normalAt, farH, pathDist, curve, craters };
}

// ─── Textures ───────────────────────────────────────────────────────────────
const CRATER_GLSL = /* glsl */`
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float craterField(vec2 uv, float per, float dens){
    vec2 g = uv * per; vec2 id = floor(g); float h = 0.;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = id + vec2(float(i), float(j)); vec2 cw = mod(c, per);
      if (h21(cw) > dens) continue;
      vec2 ctr = c + vec2(h21(cw + 3.1), h21(cw + 7.7));
      float rad = mix(0.1, 0.5, pow(h21(cw + 1.3), 2.2));
      float u = length(g - ctr) / rad;
      if (u < 1.) h += (-1. + 1.32 * pow(u, 2.2)) * rad;
      else if (u < 2.) h += 0.32 * rad * pow(2. - u, 2.);
    }
    return h / per;
  }
  float H(vec2 uv){
    return craterField(uv, 22., 0.26) * 0.75 + craterField(uv + 0.37, 61., 0.3) * 0.55 + craterField(uv + 0.71, 131., 0.32) * 0.4
      + fbm(uv * 24., 24., 6, 0.55) * 0.012 + fbm(uv * 96., 96., 3, 0.5) * 0.003;
  }`;

export function regolithTextures(renderer) {
  const size = 1024;
  const detail = bakeTexture(renderer, size, `${CRATER_GLSL}
    void main(){
      float e = 1.0 / ${size.toFixed(1)};
      float hx = H(vUv + vec2(e, 0.)) - H(vUv - vec2(e, 0.));
      float hy = H(vUv + vec2(0., e)) - H(vUv - vec2(0., e));
      vec3 n = normalize(vec3(-hx * ${size.toFixed(1)} * 0.5, -hy * ${size.toFixed(1)} * 0.5, 1.));
      gl_FragColor = vec4(n * 0.5 + 0.5, 1.);
    }`);
  const albedo = fbmTexture(renderer, { size: 512, scale: 5, octaves: 6, gain: 0.55, contrast: 1.4, bias: 0.5 });
  const speck = bakeTexture(renderer, 512, `
    void main(){
      float n = fbm(vUv * 64., 64., 3, 0.5);
      float s = step(0.965, fract(sin(dot(floor(vUv * 512.), vec2(12.9898, 78.233))) * 43758.5453));
      gl_FragColor = vec4(vec3(0.5 + n * 0.5 + s * 0.6), 1.);
    }`);
  for (const t of [detail, albedo, speck]) t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return { detail, albedo, speck };
}

export function heightTexture(data, n, renderer) {
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.FloatType);
  const lin = renderer.extensions.has('OES_texture_float_linear');
  tex.magFilter = tex.minFilter = lin ? THREE.LinearFilter : THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// ─── Regolith shader patch (terrain, far field, bootprints, rocks) ───────────
export const sunUniform = { value: LAYOUT.toSun.clone() };
export const TUNE = { ls: { value: 0.35 }, detail: { value: 0.5 }, fill: { value: 0.09 } };
export function patchRegolith(mat, { tex, hf, far = false, print = null, albedo = true, ls = 0.55, detailK = 1, rock = false, fill = null }) {
  mat.onBeforeCompile = sh => {
    mat.userData.sh = sh;
    Object.assign(sh.uniforms, {
      uHF: { value: hf.tex }, uHFMin: { value: new THREE.Vector2(hf.x0, hf.z0) }, uHFSize: { value: hf.size },
      ...(far ? { uMid: { value: far.tex }, uMidMin: { value: new THREE.Vector2(far.x0, far.z0) }, uMidSize: { value: far.size } } : {}),
      uRay: { value: far ? new THREE.Vector4(4, 1.15, 0.25, 1.5) : new THREE.Vector4(0.12, 1.14, 0.014, 0.035) },
      uRayBias: { value: far ? 2.5 : (rock ? 0.004 : 0.03) },
      uSun: sunUniform, uDetail: { value: tex.detail }, uAlb: { value: tex.albedo }, uSpeck: { value: tex.speck },
      uFill: fill ?? TUNE.fill, uLS: rock || print ? { value: print ? 0.12 : ls } : TUNE.ls, uDetailK: rock ? { value: detailK } : TUNE.detail,
    });
    if (print) Object.assign(sh.uniforms, { uPrint: { value: print } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;' + (print ? '\nvarying vec3 vPT, vPB;' : ''))
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wpA = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpA = instanceMatrix * wpA;
        #endif
        vWPos = (modelMatrix * wpA).xyz;
        ${print ? `vPT = normalize((modelMatrix * instanceMatrix * vec4(1., 0., 0., 0.)).xyz);
        vPB = normalize((modelMatrix * instanceMatrix * vec4(0., 0., -1., 0.)).xyz);` : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        uniform sampler2D uHF, uDetail, uAlb, uSpeck; uniform vec2 uHFMin; uniform float uHFSize, uLS, uDetailK, uRayBias, uFill; uniform vec4 uRay; uniform vec3 uSun;
        ${print ? `uniform sampler2D uPrint; varying vec3 vPT, vPB;
        float printShadow(float ph, vec2 puv){
          vec3 nP = normalize(cross(vPT, vPB));
          vec3 s = vec3(dot(uSun, vPT), dot(uSun, vPB), dot(uSun, nP));
          if (s.z <= 0.0) return 0.0;
          float hl = max(length(s.xy), 1e-4);
          vec2 duv = (s.xy / hl) / vec2(0.25, 0.5);
          float slope = s.z / hl;
          float h0 = ph * 0.015, sh = 1.0;
          for (int i = 1; i <= 14; i++) {
            float dist = float(i) * 0.012;
            float hs = (texture2D(uPrint, puv + duv * dist).b * 2.0 - 1.3) * 0.015;
            sh = min(sh, smoothstep(-0.0015, 0.0015, h0 + dist * slope - hs));
          }
          return sh;
        }` : ''}
        ${far ? 'uniform sampler2D uMid; uniform vec2 uMidMin; uniform float uMidSize;' : ''}
        float terrainVis(vec3 p, vec3 L){
          float vis = 1.0; float t = uRay.x;
          for (int i = 0; i < 34; i++) {
            vec3 q = p + L * t;
            vec2 uv = (q.xz - uHFMin) / uHFSize;
            if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) break;
            ${far ? `vec2 uvm = (q.xz - uMidMin) / uMidSize;
            bool inMid = uvm.x > 0. && uvm.y > 0. && uvm.x < 1. && uvm.y < 1.;
            float h = inMid ? textureLod(uMid, uvm, 0.0).r : textureLod(uHF, uv, 0.0).r;
            float bias = inMid ? 0.35 + t * 0.002 : uRayBias + t * 0.003;` : `float h = textureLod(uHF, uv, 0.0).r;
            float bias = uRayBias;`}
            float k = uRay.z + t * 0.0094;
            vis = min(vis, smoothstep(-k, k, q.y + bias - h));
            if (vis < 0.005) break;
            t = t * uRay.y + uRay.w;
          }
          return vis;
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 wxz = vWPos.xz;
        ${albedo ? `
        float a1 = texture2D(uAlb, wxz / 41.0).r, a2 = texture2D(uAlb, wxz / 6.1 + 0.37).r, a3 = texture2D(uAlb, wxz / 233.0 + 0.1).r;
        float sp = texture2D(uSpeck, wxz / 1.9).r;
        diffuseColor.rgb *= (0.66 + a1 * 0.5) * (0.86 + a2 * 0.26) * (0.72 + a3 * 0.5) * (0.82 + sp * 0.3);` : ''}
        ${print ? `
        vec4 pr = texture2D(uPrint, vUv);
        float ph = pr.b * 2.0 - 1.3;
        float inside = smoothstep(-0.2, -0.6, ph);
        diffuseColor.rgb *= mix(1.0, 0.6, inside) * (1.0 + smoothstep(0.05, 0.3, ph) * 0.16);
        diffuseColor.a *= pr.a;` : ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          vec3 T = normalize(vec3(1., 0., 0.) - nW * nW.x); vec3 B = normalize(cross(nW, T)) * -1.0;
          vec2 pert = vec2(0.);
          ${rock ? `
            vec3 an = abs(nW);
            vec2 tuv = an.y > max(an.x, an.z) ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy);
            pert += (texture2D(uDetail, tuv / 0.9).xy * 2. - 1.) * 0.9 + (texture2D(uDetail, tuv / 0.23 + .3).xy * 2. - 1.) * 0.5;` : `
            float fade = 1.0 - smoothstep(20.0, 90.0, length(vWPos - cameraPosition));
            pert += (texture2D(uDetail, wxz / 5.3).xy * 2. - 1.) * 0.95 * mix(0.5, 1.0, fade);
            pert += (texture2D(uDetail, wxz / 23.0 + 0.5).xy * 2. - 1.) * 0.8;
            pert += (texture2D(uDetail, wxz / 1.37 + 0.21).xy * 2. - 1.) * 0.6 * fade;`}
          ${print ? 'pert *= 1.0 - inside * 0.85;' : ''}
          pert *= uDetailK;
          // micro-relief self-occludes at grazing view angles: fade it (kills moiré and backlit 'sand ripples')
          pert *= mix(0.28, 1.0, smoothstep(0.03, 0.32, dot(nW, normalize(cameraPosition - vWPos))));
          nW = normalize(nW + T * pert.x + B * pert.y);
          ${print ? 'vec2 pn = pr.rg * 2. - 1.; nW = normalize(nW + (vPT * pn.x + vPB * pn.y) * 3.0);' : ''}
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          vec3 nW2 = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float vis = terrainVis(vWPos + nW2 * ${far ? '1.5' : '0.02'}, uSun)${print ? ' * printShadow(ph, vUv)' : ''};
          float mu0 = max(dot(nW2, uSun), 0.0);
          float mu = max(dot(nW2, normalize(cameraPosition - vWPos)), 0.0);
          float lsK = mix(1.0, 2.0 / (mu0 + mu + 0.08), uLS);
          reflectedLight.directDiffuse *= vis * lsK;
          reflectedLight.directSpecular *= vis;
          reflectedLight.indirectDiffuse += diffuseColor.rgb * uFill * (0.6 + 0.4 * nW2.y);
        }`);
  };
  mat.customProgramCacheKey = () => `regolith-${far}-${!!print}-${albedo}-${rock}`;
  return mat;
}

// ─── Meshes ───────────────────────────────────────────────────────────────────
export function nearTerrain(H, material) {
  const { cx, cz, half } = HF;
  const S = 560;
  const warp = u => half * (0.55 * u + 0.45 * u * u * u);
  const pos = new Float32Array((S + 1) * (S + 1) * 3), nor = new Float32Array((S + 1) * (S + 1) * 3);
  const n = new THREE.Vector3();
  let k = 0;
  for (let j = 0; j <= S; j++) {
    const z = cz + warp(j / S * 2 - 1);
    for (let i = 0; i <= S; i++) {
      const x = cx + warp(i / S * 2 - 1);
      pos[k] = x; pos[k + 1] = H.heightAt(x, z); pos[k + 2] = z;
      H.normalAt(x, z, n);
      nor[k] = n.x; nor[k + 1] = n.y; nor[k + 2] = n.z;
      k += 3;
    }
  }
  const idx = new Uint32Array(S * S * 6);
  k = 0;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const a = j * (S + 1) + i, b = a + 1, c = a + S + 1, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  return m;
}

export function farTerrain(H, material) {
  const { cx, cz, half } = HF;
  const A = 420, R = 170, r0 = 40, r1 = 16000;
  const pos = new Float32Array((A + 1) * (R + 1) * 3);
  let k = 0;
  for (let j = 0; j <= R; j++) {
    const r = r0 * Math.pow(r1 / r0, j / R);
    for (let i = 0; i <= A; i++) {
      const a = (i / A) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const cheb = Math.max(Math.abs(x - cx), Math.abs(z - cz));
      pos[k] = x; pos[k + 1] = H.farH(x, z) - 6 * (1 - ss(half - 12, half, cheb)); pos[k + 2] = z;
      k += 3;
    }
  }
  const idx = [];
  for (let j = 0; j < R; j++) for (let i = 0; i < A; i++) {
    const a = j * (A + 1) + i, b = a + 1, c = a + A + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  return m;
}

export function farHeightfield(H, n = 512, extent = 16000) {
  const data = new Float32Array(n * n);
  const x0 = HF.cx - extent, z0 = HF.cz - extent, st = (extent * 2) / (n - 1);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = H.farH(x0 + i * st, z0 + j * st);
  return { data, n, x0, z0, size: (n - 1) * st };
}

// ─── Rocks ────────────────────────────────────────────────────────────────────
function rockGeometry(seed, detail, rough = 1) {
  const nz = makeNoise(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const sx = 0.8 + nz.rnd() * 0.5, sy = 0.45 + nz.rnd() * 0.35, sz = 0.7 + nz.rnd() * 0.5;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let d = 1 + nz.noise3(v.x * 1.4 + seed, v.y * 1.4, v.z * 1.4) * 0.28 * rough + nz.noise3(v.x * 4, v.y * 4 + seed, v.z * 4) * 0.08 * rough
      + nz.noise3(v.x * 11, v.y * 11, v.z * 11 + seed) * 0.025 * rough;
    // facet it a little: planar chips
    const f = Math.abs(nz.noise3(v.x * 2.2 - seed, v.y * 2.2, v.z * 2.2));
    d -= f * 0.12 * rough;
    v.multiplyScalar(d);
    v.x *= sx; v.y *= sy; v.z *= sz;
    if (v.y < -0.15) v.y = -0.15 + (v.y + 0.15) * 0.25;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function rocks(H, material, rnd = mulberry32(77)) {
  const group = new THREE.Group();
  const place = (geo, count, sizeFn, spot, clear, castShadow) => {
    const im = new THREE.InstancedMesh(geo, material, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    let n = 0, tries = 0;
    while (n < count && tries++ < count * 30) {
      const [x, z] = spot();
      const size = sizeFn();
      if (H.pathDist(x, z) < clear + size) continue;
      const pads = [LAYOUT.lander, LAYOUT.hab, LAYOUT.mast];
      if (pads.some(pd => Math.hypot(x - pd.x, z - pd.z) < pd.r * 0.9)) continue;
      e.set((rnd() - 0.5) * 0.5, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.5);
      q.setFromEuler(e);
      s.setScalar(size).multiply(new THREE.Vector3(1, 0.8 + rnd() * 0.5, 1));
      p.set(x, H.heightAt(x, z) - size * 0.12, z);
      m.compose(p, q, s);
      im.setMatrixAt(n++, m);
    }
    im.count = n;
    im.castShadow = castShadow; im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
    return im;
  };
  const { cx, cz, half } = HF;
  const anywhere = () => [cx + (rnd() * 2 - 1) * (half - 4), cz + (rnd() * 2 - 1) * (half - 4)];
  const nearPath = () => { const t = rnd(); const pt = H.curve.getPointAt(t); const a = rnd() * Math.PI * 2, r = 0.6 + Math.pow(rnd(), 1.6) * 16; return [pt.x + Math.cos(a) * r, pt.z + Math.sin(a) * r]; };
  const big = [rockGeometry(3, 5), rockGeometry(9, 5), rockGeometry(21, 5, 1.2)];
  const mid = [rockGeometry(5, 3), rockGeometry(13, 3, 1.3)];
  const small = [rockGeometry(17, 1, 1.2), rockGeometry(29, 1)];
  big.forEach(g => place(g, 3, () => 0.9 + Math.pow(rnd(), 2) * 2.2, anywhere, 5, true));
  mid.forEach(g => place(g, 40, () => 0.18 + Math.pow(rnd(), 2.5) * 0.7, () => (rnd() < 0.6 ? nearPath() : anywhere()), 1.5, true));
  small.forEach(g => place(g, 1100, () => 0.02 + Math.pow(rnd(), 3) * 0.16, nearPath, 0.25, true));
  return group;
}
