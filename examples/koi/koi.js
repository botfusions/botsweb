// Koi: each Meshy fish is re-parameterised along an automatically extracted spine (arc length s, lateral, vertical,
// along offsets), so the vertex shader can bend it along a live follow-the-leader chain with a travelling body wave.
import * as THREE from 'three';
import { firstMesh } from '../../src/core/assets.js';
import { patchUnder } from './water.js';
import { pondSDF } from './shape.js';

export const SEG = 24;

// ─── Spine extraction ──────────────────────────────────────────────────────────
function extractSpine(P, n, index) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = P[i * 3], z = P[i * 3 + 2]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const G = 160, cs = Math.max(x1 - x0, z1 - z0) / (G - 8), ox = x0 - 4 * cs, oz = z0 - 4 * cs;
  const ymin = new Float32Array(G * G).fill(1e9), ymax = new Float32Array(G * G).fill(-1e9), cnt = new Uint32Array(G * G);
  // Rasterise every triangle's top-down footprint so thin fins stay connected.
  const tri = index.count / 3;
  for (let f = 0; f < tri; f++) {
    const a = index.getX(f * 3) * 3, b = index.getX(f * 3 + 1) * 3, c = index.getX(f * 3 + 2) * 3;
    const ax = (P[a] - ox) / cs, az = (P[a + 2] - oz) / cs, bx = (P[b] - ox) / cs, bz = (P[b + 2] - oz) / cs, cx = (P[c] - ox) / cs, cz = (P[c + 2] - oz) / cs;
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), i1 = Math.min(G - 1, Math.floor(Math.max(ax, bx, cx)));
    const j0 = Math.max(0, Math.floor(Math.min(az, bz, cz))), j1 = Math.min(G - 1, Math.floor(Math.max(az, bz, cz)));
    const ya = P[a + 1], yb = P[b + 1], yc = P[c + 1];
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = i + 0.5, pz = j + 0.5;
      let y;
      if (i0 === i1 && j0 === j1) y = (ya + yb + yc) / 3;
      else {
        if (Math.abs(den) < 1e-12) continue;
        const w1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, w2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den, w3 = 1 - w1 - w2;
        if (w1 < -0.02 || w2 < -0.02 || w3 < -0.02) continue;
        y = ya * w1 + yb * w2 + yc * w3;
      }
      const k = j * G + i;
      ymin[k] = Math.min(ymin[k], y); ymax[k] = Math.max(ymax[k], y); cnt[k]++;
    }
    // always mark the vertices' own cells too (tiny triangles)
    for (const [vx, vz, vy] of [[ax, az, ya], [bx, bz, yb], [cx, cz, yc]]) {
      const k = Math.floor(vz) * G + Math.floor(vx);
      ymin[k] = Math.min(ymin[k], vy); ymax[k] = Math.max(ymax[k], vy); cnt[k]++;
    }
  }
  const occ = new Uint8Array(G * G), thick = new Float32Array(G * G);
  for (let j = 1; j < G - 1; j++) for (let i = 1; i < G - 1; i++) {
    const k = j * G + i;
    if (cnt[k]) { occ[k] = 1; thick[k] = ymax[k] - ymin[k]; continue; }
    // one-cell closing so fins and body stay connected
    let c = 0; for (const d of [-1, 1, -G, G]) if (cnt[k + d]) c++;
    if (c >= 2) occ[k] = 1;
  }
  let maxT = 0; for (let k = 0; k < G * G; k++) maxT = Math.max(maxT, thick[k]);
  let head = -1;
  for (let k = G * G - 1; k >= 0; k--) if (thick[k] > maxT * 0.42) { head = k; break; } // highest z row first
  // Dijkstra over the occupancy grid (8-connected)
  const dist = new Float64Array(G * G).fill(Infinity);
  dist[head] = 0;
  const heap = [[0, head]];
  const push = (d, k) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  while (heap.length) {
    const [d, k] = pop();
    if (d > dist[k]) continue;
    const i = k % G, j = (k / G) | 0;
    for (const [di, dj, w] of nb) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= G || jj >= G) continue;
      const kk = jj * G + ii; if (!occ[kk]) continue;
      const nd = d + w; if (nd < dist[kk]) { dist[kk] = nd; push(nd, kk); }
    }
  }
  let maxD = 0; for (let k = 0; k < G * G; k++) if (occ[k] && dist[k] < Infinity) maxD = Math.max(maxD, dist[k]);
  const B = 44, sx = new Float64Array(B), sz = new Float64Array(B), sy = new Float64Array(B), sw = new Float64Array(B), syw = new Float64Array(B);
  for (let k = 0; k < G * G; k++) {
    if (!occ[k] || dist[k] === Infinity) continue;
    const b = Math.min(B - 1, Math.floor(dist[k] / maxD * B));
    const w = thick[k] * thick[k] + 1e-6 * maxT * maxT;
    const cx = ox + ((k % G) + 0.5) * cs, cz = oz + (((k / G) | 0) + 0.5) * cs;
    sx[b] += cx * w; sz[b] += cz * w; sw[b] += w;
    if (cnt[k]) { sy[b] += (ymin[k] + ymax[k]) * 0.5 * w; syw[b] += w; }
  }
  let pts = [];
  const hx = ox + ((head % G) + 0.5) * cs, hz = oz + (((head / G) | 0) + 0.5) * cs;
  pts.push([hx, 0, hz]);
  for (let b = 0; b < B; b++) if (sw[b] > 0) pts.push([sx[b] / sw[b], syw[b] ? sy[b] / syw[b] : 0, sz[b] / sw[b]]);
  pts[0][1] = pts[1][1];
  for (let it = 0; it < 6; it++) pts = pts.map((p, i) => (i === 0 || i === pts.length - 1) ? p : p.map((v, c) => pts[i - 1][c] * 0.25 + v * 0.5 + pts[i + 1][c] * 0.25));
  // resample by arc length
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
  const L = cum[cum.length - 1];
  const out = [];
  for (let s = 0; s < SEG; s++) {
    const t = s / (SEG - 1) * L;
    let i = 1; while (i < cum.length - 1 && cum[i] < t) i++;
    const f = (t - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-9);
    out.push(pts[i - 1].map((v, c) => v + (pts[i][c] - v) * f));
  }
  return { pts: out, length: L };
}

function tangents(pts) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = a[0] - b[0], dz = a[2] - b[2], l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l]; // toward the head
  });
}

/** Re-express a fish mesh in spine coordinates. Returns a prototype shared by all instances of that variety. */
export function koiPrototype(gltf) {
  const src = firstMesh(gltf.scene);
  gltf.scene.updateMatrixWorld(true);
  const g = src.geometry;
  const n = g.attributes.position.count;
  const P = new Float32Array(n * 3), Nn = new Float32Array(n * 3);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(src.matrixWorld);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(g.attributes.position, i).applyMatrix4(src.matrixWorld); P.set([v.x, v.y, v.z], i * 3);
    v.fromBufferAttribute(g.attributes.normal, i).applyMatrix3(nm).normalize(); Nn.set([v.x, v.y, v.z], i * 3);
  }
  const { pts, length } = extractSpine(P, n, g.index);
  const T = tangents(pts);
  const cum = [0]; for (let i = 1; i < SEG; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), aS = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
    let best = Infinity, bi = 0, bt = 0;
    for (let i = 0; i < SEG - 1; i++) {
      const ax = pts[i][0], az = pts[i][2], bx = pts[i + 1][0] - ax, bz = pts[i + 1][2] - az;
      const t = Math.min(1, Math.max(0, ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz)));
      const dx = x - ax - bx * t, dz = z - az - bz * t, d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; bt = t; }
    }
    const a = pts[bi], b = pts[bi + 1];
    const px = a[0] + (b[0] - a[0]) * bt, py = a[1] + (b[1] - a[1]) * bt, pz = a[2] + (b[2] - a[2]) * bt;
    let tx = T[bi][0] + (T[bi + 1][0] - T[bi][0]) * bt, tz = T[bi][1] + (T[bi + 1][1] - T[bi][1]) * bt;
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = tz, nz = -tx; // lateral axis
    const ox = x - px, oy = y - py, oz = z - pz;
    pos.set([(ox * nx + oz * nz) / length, oy / length, (ox * tx + oz * tz) / length], k * 3);
    const qx = Nn[k * 3], qy = Nn[k * 3 + 1], qz = Nn[k * 3 + 2];
    nor.set([qx * nx + qz * nz, qy, qx * tx + qz * tz], k * 3);
    aS[k] = (cum[bi] + (cum[bi + 1] - cum[bi]) * bt) / length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', g.attributes.uv);
  geo.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
  geo.setIndex(g.index);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return { geometry: geo, material: src.material, restSpine: pts, length };
}

const FRAME_GLSL = /* glsl */`
  attribute float aS;
  uniform vec4 uSp[${SEG}];
  uniform float uScale;
  void koiFrame(float s, out vec3 P, out vec3 T, out vec3 N){
    float f = clamp(s, 0., 1.) * ${(SEG - 1).toFixed(1)};
    int i = int(min(floor(f), ${(SEG - 2).toFixed(1)}));
    float t = f - float(i);
    vec4 a = uSp[i], b = uSp[i + 1];
    P = mix(a.xyz, b.xyz, t);
    vec2 d = normalize(mix(vec2(sin(a.w), cos(a.w)), vec2(sin(b.w), cos(b.w)), t));
    T = vec3(d.x, 0., d.y);
    N = vec3(T.z, 0., -T.x);
  }
`;
const BEGIN = /* glsl */`
  vec3 kP, kT, kN; koiFrame(aS, kP, kT, kN);
  vec3 transformed = kP + (kN * position.x + vec3(0., 1., 0.) * position.y + kT * position.z) * uScale;
`;
const BEGIN_NORMAL = /* glsl */`
  vec3 kP0, kT0, kN0; koiFrame(aS, kP0, kT0, kN0);
  vec3 objectNormal = kN0 * normal.x + vec3(0., 1., 0.) * normal.y + kT0 * normal.z;
`;

/** Pond-wide steering for the school. */
export class School {
  constructor({ protos, specs, env }) {
    this.fish = specs.map((s, i) => new Koi(protos[s.kind], s, i, env));
    this.food = [];      // { x, z, eaten, t, owner }
    this.pointer = null; // { x, z, speed, on }
    this.time = 0;
  }
  update(dt, t, hooks) {
    this.time = t;
    for (const f of this.fish) f.think(dt, t, this, hooks);
    for (const f of this.fish) f.move(dt, t, hooks);
  }
}

let seedN = 0;
export class Koi {
  constructor(proto, spec, i, env) {
    this.i = i;
    this.len = spec.len;
    const mat = proto.material.clone();
    if (spec.tint) mat.color = new THREE.Color(spec.tint);
    mat.envMapIntensity = spec.env ?? 1.0;
    if (spec.rough != null) mat.roughness = spec.rough;
    if (spec.metal != null) mat.metalness = spec.metal;
    this.uniforms = { uSp: { value: Array.from({ length: SEG }, () => new THREE.Vector4()) }, uScale: { value: spec.len } };
    const u = this.uniforms;
    patchUnder(mat, {
      key: 'koi',
      extraVertexHead: FRAME_GLSL,
      custom: {
        uniforms: u,
        patch: sh => {
          sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', BEGIN_NORMAL).replace('#include <begin_vertex>', BEGIN);
        },
      },
    });
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depthMat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + FRAME_GLSL).replace('#include <begin_vertex>', BEGIN);
    };
    depthMat.customProgramCacheKey = () => 'koidepth';
    this.mesh = new THREE.Mesh(proto.geometry, mat);
    this.mesh.customDepthMaterial = depthMat;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.env = env;
    // state
    this.x = spec.x; this.z = spec.z; this.head = spec.heading ?? Math.random() * 6.28;
    this.speed = 0.12; this.tSpeed = 0.15;
    this.cruiseDepth = spec.depth; this.y = spec.depth; this.tY = spec.depth;
    this.phase = Math.random() * 10;
    this.seed = ++seedN * 17.13 + Math.random() * 100;
    this.turn = 0;
    this.mode = 'cruise';
    this.target = null;
    this.gulp = 0;
    this.startle = 0;
    this.chain = new Float32Array(SEG * 3);
    this.render = new Float32Array(SEG * 3);
    const seg = this.len / (SEG - 1);
    for (let k = 0; k < SEG; k++) {
      this.chain[k * 3] = this.x - Math.sin(this.head) * seg * k;
      this.chain[k * 3 + 1] = this.y;
      this.chain[k * 3 + 2] = this.z - Math.cos(this.head) * seg * k;
    }
  }

  think(dt, t, school, hooks) {
    const fx = Math.sin(this.head), fz = Math.cos(this.head);
    let dx = fx, dz = fz; // desired direction
    // wander: slow smooth noise in the turning rate
    const w = Math.sin(t * 0.21 + this.seed) * 0.6 + Math.sin(t * 0.53 + this.seed * 1.7) * 0.4;
    const wa = this.head + w * 0.9;
    dx += Math.sin(wa) * 0.8; dz += Math.cos(wa) * 0.8;
    // shoreline: look ahead and steer down the distance gradient
    const ax = this.x + fx * (0.6 + this.speed * 1.5), az = this.z + fz * (0.6 + this.speed * 1.5);
    const d = pondSDF(ax, az);
    if (d > -0.9) {
      const e = 0.05, gx = pondSDF(ax + e, az) - pondSDF(ax - e, az), gz = pondSDF(ax, az + e) - pondSDF(ax, az - e);
      const gl = Math.hypot(gx, gz) || 1, k = (d + 0.9) * 4.5;
      dx -= gx / gl * k; dz -= gz / gl * k;
    }
    for (const o of this.env.avoid) { // lantern rock, stepping stones
      const ox = this.x - o.x, oz = this.z - o.z, od = Math.hypot(ox, oz);
      if (od < o.r + 0.6) { const k = (o.r + 0.6 - od) * 3; dx += ox / od * k; dz += oz / od * k; }
    }
    // koi drift toward wherever people are looking (they expect to be fed)
    const home = school.home;
    if (home) {
      const hx = home.x - this.x, hz = home.z - this.z, hd = Math.hypot(hx, hz) || 1;
      const k = Math.min(1, Math.max(0, (hd - home.w * 0.28) / 2.5)) * 1.6;
      dx += hx / hd * k; dz += hz / hd * k;
    }
    // separation from the others (mid-body positions)
    for (const f of school.fish) {
      if (f === this) continue;
      const ox = this.x - f.x, oz = this.z - f.z, od = Math.hypot(ox, oz);
      const r = (this.len + f.len) * 0.55;
      if (od < r && od > 1e-4) { const k = (r - od) / r * (this.mode === 'seek' ? 1.5 : 2.4) * (Math.abs(this.y - f.y) < 0.14 ? 1 : 0.3); dx += ox / od * k; dz += oz / od * k; }
    }
    this.tSpeed = 0.13 + (Math.sin(t * 0.17 + this.seed * 3.1) * 0.5 + 0.5) * 0.14;
    this.tY = this.cruiseDepth + Math.sin(t * 0.11 + this.seed) * 0.12;
    // food
    let best = null, bd = 7.5;
    for (const p of school.food) {
      if (p.eaten || t < p.t + 0.25 + Math.hypot(p.x - this.x, p.z - this.z) * 0.18) continue; // ripples reach them after a beat
      const pd = Math.hypot(p.x - this.x, p.z - this.z);
      if (pd < bd) { bd = pd; best = p; }
    }
    if (best) {
      this.mode = 'seek';
      const hx = this.chain[0], hz = this.chain[2];
      const px = best.x - hx, pz = best.z - hz, pd = Math.hypot(px, pz) || 1;
      dx = dx * 0.25 + px / pd * 3.2; dz = dz * 0.25 + pz / pd * 3.2;
      this.tSpeed = pd > 0.6 ? 0.62 + (this.i % 3) * 0.09 : 0.2 + pd * 0.5;
      this.tY = (pd < 0.9 ? -0.06 - pd * 0.12 : -0.22) - (this.i % 3) * 0.08;
      if (pd < 0.09 + this.len * 0.05) {
        best.eaten = true; this.gulp = 1; hooks.eat?.(best, this);
      }
    } else if (this.mode === 'seek') this.mode = 'cruise';
    // the visitor's hand: a slow hand is interesting, a fast one is not
    const p = school.pointer;
    if (p?.on) {
      const ox = this.x - p.x, oz = this.z - p.z, od = Math.hypot(ox, oz);
      if (p.speed > 1.4 && od < 0.9) { this.startle = 1; const k = 4; dx += ox / od * k; dz += oz / od * k; }
      else if (p.speed < 0.35 && od < 2.6 && !best) {
        const k = (od > 0.3 ? 0.9 : -0.4) * (1 - od / 2.6); dx -= ox / od * k; dz -= oz / od * k;
        this.tY = Math.max(this.tY, od < 0.7 ? -0.07 : -0.28);
        this.tSpeed = Math.min(this.tSpeed, 0.1 + od * 0.1);
        // close under a still hand they come up and mouth at the surface
        const hx = this.chain[0], hz = this.chain[2];
        if (od < 0.75 && this.y > -0.12 && Math.random() < dt * 1.3) hooks.kiss?.(this, hx, hz);
      }
    }
    if (this.startle > 0.01) { this.tSpeed = Math.max(this.tSpeed, 0.4 + this.startle * 1.1); this.startle *= Math.exp(-dt * 1.6); this.tY = Math.min(this.tY, this.cruiseDepth - 0.15); }
    if (this.gulp > 0) { this.gulp = Math.max(0, this.gulp - dt * 1.4); this.tY = -0.04; }
    // turn toward desired heading, rate-limited
    const want = Math.atan2(dx, dz);
    let da = want - this.head; da = Math.atan2(Math.sin(da), Math.cos(da));
    const maxTurn = 0.8 + this.speed * 3.2;
    const tr = Math.max(-maxTurn, Math.min(maxTurn, da * 2.2));
    this.turn += (tr - this.turn) * (1 - Math.exp(-dt * 4));
    this.head += this.turn * dt;
  }

  move(dt, t, hooks) {
    const acc = this.tSpeed > this.speed ? 1.6 : 0.9;
    this.speed += (this.tSpeed - this.speed) * (1 - Math.exp(-dt * acc));
    this.y += (this.tY - this.y) * (1 - Math.exp(-dt * 1.1));
    this.x += Math.sin(this.head) * this.speed * dt;
    this.z += Math.cos(this.head) * this.speed * dt;
    const c = this.chain, seg = this.len / (SEG - 1);
    c[0] = this.x; c[1] = this.y; c[2] = this.z;
    for (let k = 1; k < SEG; k++) {
      const i = k * 3;
      let dx = c[i] - c[i - 3], dz = c[i + 2] - c[i - 1];
      const l = Math.hypot(dx, dz) || 1;
      c[i] = c[i - 3] + dx / l * seg; c[i + 2] = c[i - 1] + dz / l * seg;
      c[i + 1] += (c[i - 2] - c[i + 1]) * Math.min(1, dt * 9);
    }
    // travelling body wave; amplitude grows toward the tail and with effort
    const effort = Math.min(1, this.speed / 0.8) + Math.abs(this.turn) * 0.15;
    const freq = 0.45 + this.speed * 2.6;
    this.phase += dt * freq * Math.PI * 2;
    const amp = this.len * (0.03 + effort * 0.075);
    const r = this.render;
    for (let k = 0; k < SEG; k++) {
      const s = k / (SEG - 1), i = k * 3;
      const a = Math.max(0, k - 1) * 3, b = Math.min(SEG - 1, k + 1) * 3;
      let tx = c[a] - c[b], tz = c[a + 2] - c[b + 2]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const lat = amp * (0.12 + 0.88 * s * s) * Math.sin(this.phase - s * Math.PI * 1.7);
      r[i] = c[i] + tz * lat; r[i + 1] = c[i + 1]; r[i + 2] = c[i + 2] - tx * lat;
    }
    const U = this.uniforms.uSp.value;
    for (let k = 0; k < SEG; k++) {
      const a = Math.max(0, k - 1) * 3, b = Math.min(SEG - 1, k + 1) * 3;
      U[k].set(r[k * 3], r[k * 3 + 1], r[k * 3 + 2], Math.atan2(r[a] - r[b], r[a + 2] - r[b + 2]));
    }
    if (this.y > -0.2 && this.speed > 0.25) hooks.wake?.(this, c[0], c[2], c[3], c[5]);
  }
}
