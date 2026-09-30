// Bootprints: a canvas-baked cleated sole (height → normal + depression mask + alpha), stamped as instanced decals
// that reuse the regolith shader, so their albedo, micro-normals and raymarched shadows match the ground exactly.
import { THREE } from '../../src/core/engine.js';
import { patchRegolith } from './terrain.js';
import { mulberry32 } from './noise.js';

function bootTexture() {
  const W = 128, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  const read = () => { const d = g.getImageData(0, 0, W, H).data; const o = new Float32Array(W * H); for (let i = 0; i < W * H; i++) o[i] = d[i * 4] / 255; return o; };
  const sole = blur => {
    g.filter = 'none'; g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.filter = `blur(${blur}px)`; g.fillStyle = '#fff';
    g.beginPath(); g.ellipse(W * 0.5, H * 0.33, W * 0.33, H * 0.165, 0, 0, Math.PI * 2); g.fill();       // forefoot (toe at top)
    g.beginPath(); g.ellipse(W * 0.5, H * 0.72, W * 0.275, H * 0.13, 0, 0, Math.PI * 2); g.fill();       // heel
    g.fillRect(W * 0.24, H * 0.32, W * 0.52, H * 0.4);                                                     // waist
    return read();
  };
  const m = sole(1.2), wide = sole(9), mid = sole(3.5);
  const rnd = mulberry32(5);
  const h = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    // Chevron cleats across the sole, a smooth instep band, and crumbs.
    const u = (x / W - 0.5), v = y / H;
    const chev = Math.cos(((v + Math.abs(u) * 0.35) * H) / 13 * Math.PI * 2) * 0.5 + 0.5;
    const instep = v > 0.5 && v < 0.58 ? 0 : 1;
    const cleat = Math.pow(chev, 2.2) * instep;
    const rim = Math.max(0, wide[i] - mid[i] * 0.95);
    h[i] = -m[i] * (0.9 + cleat * 0.2) + rim * 0.5 + (rnd() - 0.5) * 0.07 * (m[i] + rim);
  }
  // Raw bytes (a canvas would premultiply and destroy RGB wherever alpha is 0); rows flipped so the toe is +v.
  const px = new Uint8Array(W * H * 4);
  const k = 3.2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = ((H - 1 - y) * W + x) * 4;
    const l = h[y * W + Math.max(0, x - 1)], r = h[y * W + Math.min(W - 1, x + 1)];
    const t = h[Math.max(0, y - 1) * W + x], bt = h[Math.min(H - 1, y + 1) * W + x];
    let nx = (l - r) * k, ny = (bt - t) * k, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len;
    px[o] = (nx * 0.5 + 0.5) * 255;
    px[o + 1] = (ny * 0.5 + 0.5) * 255;
    px[o + 2] = Math.min(1, Math.max(0, (h[i] + 1.3) / 2)) * 255;
    px[o + 3] = Math.min(1, wide[i] * 1.6) * 255;
  }
  const tex = new THREE.DataTexture(px, W, H, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export class Prints {
  constructor(H, ctx, max = 900) {
    this.H = H; this.max = max; this.count = 0; this.list = [];
    const tex = bootTexture();
    const geo = new THREE.PlaneGeometry(0.25, 0.5).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: ctx.color, roughness: 1, metalness: 0, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    mat.defines = { USE_UV: '' };
    patchRegolith(mat, { ...ctx, print: tex });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this._m = new THREE.Matrix4(); this._up = new THREE.Vector3(); this._f = new THREE.Vector3(); this._x = new THREE.Vector3(); this._z = new THREE.Vector3();
  }
  near(x, z, r = 0.14) {
    for (let i = this.list.length - 1; i >= Math.max(0, this.list.length - 60); i--) { const p = this.list[i]; if ((p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return true; }
    return false;
  }
  stamp(x, z, yaw) {
    if (this.near(x, z)) return false;
    const up = this.H.normalAt(x, z, this._up, 0.12);
    const f = this._f.set(Math.sin(yaw), 0, Math.cos(yaw));
    f.addScaledVector(up, -f.dot(up)).normalize();
    const zA = this._z.copy(f).negate();              // plane's local -Z is the toe
    const xA = this._x.crossVectors(up, zA).normalize();
    const y = this.H.heightAt(x, z) + 0.008;
    this._m.makeBasis(xA, up, zA).setPosition(x, y, z);
    const i = this.count % this.max;
    this.mesh.setMatrixAt(i, this._m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.count++;
    this.mesh.count = Math.min(this.count, this.max);
    this.list.push({ x, z });
    if (this.list.length > this.max) this.list.shift();
    return true;
  }
}
