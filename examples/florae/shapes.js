// Specimen point clouds: surface samples of each Meshy model packed into GPU data textures.
// Every shape shares the same particle count; texel j of every shape is "the same petal", so a morph
// is one particle travelling from its place on one specimen to its place on the next.
import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';

/** Surface samples with sRGB texture colour (bytes) — a leaner variant of core sampleSurface. */
export function sampleMesh(mesh, count) {
  mesh.updateMatrixWorld(true);
  const sampler = new MeshSurfaceSampler(mesh).build();
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Uint8Array(count * 3);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), uv = new THREE.Vector2();
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const map = mesh.material?.map;
  let px = null, tw = 0, th = 0;
  if (map?.image) {
    const img = map.image;
    tw = Math.min(img.width, 2048); th = Math.min(img.height, 2048);
    const cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, tw, th);
    px = cx.getImageData(0, 0, tw, th).data;
  }
  const e = mesh.matrixWorld.elements;
  for (let i = 0; i < count; i++) {
    sampler.sample(p, n, undefined, uv);
    const x = p.x, y = p.y, z = p.z;
    pos[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
    pos[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    pos[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    n.applyMatrix3(nm).normalize();
    nor[i * 3] = n.x; nor[i * 3 + 1] = n.y; nor[i * 3 + 2] = n.z;
    if (px) {
      const u = ((uv.x % 1) + 1) % 1, v = ((uv.y % 1) + 1) % 1;
      const tx = Math.floor(u * (tw - 1)), ty = Math.floor((map.flipY ? 1 - v : v) * (th - 1));
      const k = (ty * tw + tx) * 4;
      col[i * 3] = px[k]; col[i * 3 + 1] = px[k + 1]; col[i * 3 + 2] = px[k + 2];
    } else { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 220; }
  }
  return { pos, nor, col, count };
}

/**
 * Ambient occlusion from point density: voxelise the cloud, then march a few short rays through the
 * hemisphere on each side of the (double-sided) surface. The heart of a rose is enclosed on both sides,
 * an outer petal is open on one — so we keep the more open side.
 */
function densityAO(pos, nor, count) {
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  const ext = Math.max(mxx - mnx, mxy - mny, mxz - mnz);
  const cell = ext / 70, pad = 10;
  const gx = Math.ceil((mxx - mnx) / cell) + pad * 2, gy = Math.ceil((mxy - mny) / cell) + pad * 2, gz = Math.ceil((mxz - mnz) / cell) + pad * 2;
  const ox = mnx - pad * cell, oy = mny - pad * cell, oz = mnz - pad * cell;
  const grid = new Uint16Array(gx * gy * gz);
  for (let i = 0; i < count; i++) {
    const ix = ((pos[i * 3] - ox) / cell) | 0, iy = ((pos[i * 3 + 1] - oy) / cell) | 0, iz = ((pos[i * 3 + 2] - oz) / cell) | 0;
    const k = (iz * gy + iy) * gx + ix;
    if (grid[k] < 65535) grid[k]++;
  }
  let occ = 0, sum = 0;
  for (let k = 0; k < grid.length; k++) if (grid[k]) { occ++; sum += grid[k]; }
  const inv = 1 / Math.max(1, (sum / occ) * 0.45);
  const steps = [2.2, 3.6, 5.6, 8.5], wts = [1, 0.85, 0.65, 0.45];
  let wsum = 0; for (const w of wts) wsum += w;
  const ao = new Float32Array(count), cov = new Float32Array(count);
  // coverage: single-layer surfaces (leaves, wings) get bigger dots than the many-layered heart
  const hist = new Uint32Array(256);
  for (let k = 0; k < grid.length; k++) if (grid[k]) hist[Math.min(255, grid[k])]++;
  let acc = 0, ref = 1;
  for (let c = 1; c < 256; c++) { acc += hist[c]; if (acc >= occ * 0.8) { ref = c; break; } }
  const D = [[0, 0, 1], [0.62, 0, 0.78], [-0.62, 0, 0.78], [0, 0.62, 0.78], [0, -0.62, 0.78], [0.44, 0.44, 0.78], [-0.44, -0.44, 0.78]];
  const look = (x, y, z) => {
    const ix = ((x - ox) / cell) | 0, iy = ((y - oy) / cell) | 0, iz = ((z - oz) / cell) | 0;
    if (ix < 0 || iy < 0 || iz < 0 || ix >= gx || iy >= gy || iz >= gz) return 0;
    return Math.min(1, grid[(iz * gy + iy) * gx + ix] * inv);
  };
  for (let i = 0; i < count; i++) {
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
    const nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2];
    // tangent frame
    let tx, ty, tz;
    if (Math.abs(ny) < 0.9) { tx = nz; ty = 0; tz = -nx; } else { tx = 0; ty = -nz; tz = ny; }
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    let best = 1;
    for (let side = 1; side >= -1; side -= 2) {
      let o = 0;
      for (const d of D) {
        const dx = (tx * d[0] + bx * d[1] + nx * d[2] * side), dy = (ty * d[0] + by * d[1] + ny * d[2] * side), dz = (tz * d[0] + bz * d[1] + nz * d[2] * side);
        for (let s = 0; s < steps.length; s++) {
          const r = steps[s] * cell;
          o += look(px + dx * r, py + dy * r, pz + dz * r) * wts[s];
        }
      }
      o /= D.length * wsum;
      if (o < best) best = o;
    }
    ao[i] = 1 - Math.min(1, best * 1.9);
    const ix = ((px - ox) / cell) | 0, iy = ((py - oy) / cell) | 0, iz = ((pz - oz) / cell) | 0;
    cov[i] = Math.min(2.6, Math.max(0.85, Math.sqrt(ref / Math.max(1, grid[(iz * gy + iy) * gx + ix]))));
  }
  return { ao, cov };
}

/**
 * Pack a sampled cloud into textures. Particles are ranked by height so texel j sits at the same
 * relative height in every specimen (stems become stems) — the swirl does the rest.
 *   pos  (float): xyz, w = dot coverage factor (sparse surfaces draw bigger dots)
 *   col  (rgba8): sRGB colour, a = ambient occlusion
 *   nrm  (rgba8): normal, a = bloom order (0 = heart of the flower, 1 = farthest tip)
 */
export function packShape(s, size, { heart = 'top', rand = Math.random } = {}) {
  const N = size * size, { pos, nor, col } = s;
  const { ao, cov } = s.ao ? { ao: s.ao, cov: null } : densityAO(pos, nor, N);
  // heart of the specimen, where re-blooming starts
  const idx = new Uint32Array(N);
  for (let i = 0; i < N; i++) idx[i] = i;
  const key = new Float32Array(N);
  for (let i = 0; i < N; i++) key[i] = pos[i * 3 + 1] + rand() * 1e-4;
  idx.sort((a, b) => key[a] - key[b]);
  let hx = 0, hy = 0, hz = 0;
  if (heart === 'center') { hx = hy = hz = 0; }
  else {
    const from = heart === 'top' ? Math.floor(N * 0.82) : 0, to = heart === 'top' ? N : Math.floor(N * 0.04);
    for (let j = from; j < to; j++) { const i = idx[j]; hx += pos[i * 3]; hy += pos[i * 3 + 1]; hz += pos[i * 3 + 2]; }
    const c = to - from; hx /= c; hy /= c; hz /= c;
    if (heart === 'top') hy = Math.max(hy - 0.1, -1e9);
  }
  if (s.heart) [hx, hy, hz] = s.heart;
  let maxD = 0;
  const dist = new Float32Array(N);
  for (let i = 0; i < N; i++) { const d = Math.hypot(pos[i * 3] - hx, pos[i * 3 + 1] - hy, pos[i * 3 + 2] - hz); dist[i] = d; if (d > maxD) maxD = d; }
  const P = new Float32Array(N * 4), C = new Uint8Array(N * 4), Q = new Uint8Array(N * 4);
  for (let j = 0; j < N; j++) {
    const i = idx[j];
    P[j * 4] = pos[i * 3]; P[j * 4 + 1] = pos[i * 3 + 1]; P[j * 4 + 2] = pos[i * 3 + 2];
    P[j * 4 + 3] = cov ? cov[i] : 1;
    C[j * 4] = col[i * 3]; C[j * 4 + 1] = col[i * 3 + 1]; C[j * 4 + 2] = col[i * 3 + 2];
    C[j * 4 + 3] = Math.round(Math.max(0, Math.min(1, ao[i])) * 255);
    Q[j * 4] = Math.round(nor[i * 3] * 127.5 + 127.5); Q[j * 4 + 1] = Math.round(nor[i * 3 + 1] * 127.5 + 127.5); Q[j * 4 + 2] = Math.round(nor[i * 3 + 2] * 127.5 + 127.5);
    Q[j * 4 + 3] = Math.round(Math.pow(dist[i] / maxD, 0.85) * 255);
  }
  const tex = (data, type) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, type);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  };
  return { pos: tex(P, THREE.FloatType), col: tex(C, THREE.UnsignedByteType), nrm: tex(Q, THREE.UnsignedByteType), P, C, Q, heart: [hx, hy, hz] };
}

/**
 * The archive: a sunflower head. Florets at the golden angle, oldest (outermost) rings coloured by the
 * specimens already sent, the centre still in bud — the months to come.
 */
export function spiralShape(size, sources, { R = 1.95, per = 40 } = {}) {
  const N = size * size, NF = Math.floor(N / per);
  const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), col = new Uint8Array(N * 3), ao = new Float32Array(N);
  const GA = Math.PI * (3 - Math.sqrt(5));
  const bud = [[196, 160, 72], [150, 150, 64], [120, 132, 58], [214, 186, 110]];
  const spacing = R * Math.sqrt(Math.PI / NF);
  // one colour per floret: rings of past specimens, oldest (rose) at the rim, buds at the centre
  const fc = new Uint8Array(NF * 3);
  for (let i = 0; i < NF; i++) {
    const rr = Math.sqrt((i + 0.5) / NF) + (Math.random() - 0.5) * 0.1;
    let c;
    if (rr < 0.2) c = bud[(Math.random() * 4) | 0];
    else {
      const src = sources[3 - Math.min(3, Math.floor((rr - 0.2) / 0.2))];
      const k = (Math.random() * src.count) | 0;
      c = [src.col[k * 3], src.col[k * 3 + 1], src.col[k * 3 + 2]];
    }
    const arm = (i % 34) < 17 ? 1 : 0.86;
    fc[i * 3] = c[0] * arm; fc[i * 3 + 1] = c[1] * arm; fc[i * 3 + 2] = c[2] * arm;
  }
  for (let j = 0; j < N; j++) {
    const i = Math.min(NF - 1, Math.floor(j / per)), f = (i + 0.5) / NF;
    const r = R * Math.sqrt(f), a = i * GA;
    // each floret is a small domed seed of `per` particles
    const sr = spacing * 0.36 * (0.75 + 0.5 * f) * Math.sqrt(Math.random()), sa = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r + Math.cos(sa) * sr, z = Math.sin(a) * r + Math.sin(sa) * sr;
    const rn = Math.hypot(x, z) / R;
    pos[j * 3] = x; pos[j * 3 + 2] = z;
    pos[j * 3 + 1] = -0.2 * rn * rn + 0.012 * (1 - (sr / (spacing * 0.5)) ** 2);
    const nx = 0.4 * x / R, nz = 0.4 * z / R, nl = Math.hypot(nx, 1, nz);
    nor[j * 3] = nx / nl; nor[j * 3 + 1] = 1 / nl; nor[j * 3 + 2] = nz / nl;
    col[j * 3] = fc[i * 3]; col[j * 3 + 1] = fc[i * 3 + 1]; col[j * 3 + 2] = fc[i * 3 + 2];
    ao[j] = (0.6 + 0.4 * Math.min(1, f * 3)) * (1 - 0.35 * sr / (spacing * 0.5));
  }
  return { pos, nor, col, ao, count: N, heart: [0, 0, 0] };
}

/** Screen-space anchor on a shape: the particle nearest a point given in the shape's bbox (0..1). */
export function anchorOf(packed, size, [u, v, w]) {
  const N = size * size, P = packed.P;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let j = 0; j < N; j += 7) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[j * 4 + k]); mx[k] = Math.max(mx[k], P[j * 4 + k]); }
  const t = [mn[0] + (mx[0] - mn[0]) * u, mn[1] + (mx[1] - mn[1]) * v, mn[2] + (mx[2] - mn[2]) * w];
  let best = 0, bd = Infinity;
  for (let j = 0; j < N; j += 3) {
    const d = (P[j * 4] - t[0]) ** 2 + (P[j * 4 + 1] - t[1]) ** 2 + (P[j * 4 + 2] - t[2]) ** 2;
    if (d < bd) { bd = d; best = j; }
  }
  return new THREE.Vector3(P[best * 4], P[best * 4 + 1], P[best * 4 + 2]);
}
