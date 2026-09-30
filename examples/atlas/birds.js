// A flock of swifts: CPU boids steering toward a roost that migrates from island to island,
// drawn as one instanced mesh whose wings flap in the vertex shader.
import { THREE } from '../../src/core/engine.js';
import { patchAtmosphere } from './sky.js';

const ZERO = new THREE.Vector3(), ZAX = new THREE.Vector3(0, 0, 1);

function birdGeometry() {
  // body + two swept wings; attribute `wing` = signed span position for flapping
  const P = [], W = [];
  const tri = (a, b, c, wa, wb, wc) => { P.push(...a, ...b, ...c); W.push(wa, wb, wc); };
  // body (a thin diamond, both faces)
  const nose = [0, 0, 0.32], tail = [0, 0, -0.3], top = [0, 0.05, 0], bot = [0, -0.04, 0], l = [-0.05, 0, 0.02], r = [0.05, 0, 0.02];
  tri(nose, l, top, 0, 0, 0); tri(nose, top, r, 0, 0, 0); tri(tail, top, l, 0, 0, 0); tri(tail, r, top, 0, 0, 0);
  tri(nose, bot, l, 0, 0, 0); tri(nose, r, bot, 0, 0, 0); tri(tail, l, bot, 0, 0, 0); tri(tail, bot, r, 0, 0, 0);
  // wings: scythe shape
  for (const s of [-1, 1]) {
    const root0 = [s * 0.04, 0, 0.1], root1 = [s * 0.04, 0, -0.08], mid = [s * 0.34, 0.01, -0.02], tip = [s * 0.62, 0.0, -0.22];
    tri(root0, mid, root1, 0, s * 0.55, 0); tri(root1, mid, tip, 0, s * 0.55, s * 1);
    tri(root0, root1, mid, 0, 0, s * 0.55); tri(root1, tip, mid, 0, s * 1, s * 0.55);
  }
  // tail fork
  tri([0, 0, -0.26], [-0.1, 0, -0.44], [0, 0, -0.32], 0, 0, 0); tri([0, 0, -0.26], [0, 0, -0.32], [0.1, 0, -0.44], 0, 0, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('wing', new THREE.Float32BufferAttribute(W, 1));
  g.computeVertexNormals();
  return g;
}

export class Flock {
  constructor(count = 70) {
    this.n = count;
    this.pos = []; this.vel = [];
    for (let i = 0; i < count; i++) {
      this.pos.push(new THREE.Vector3((Math.random() - 0.5) * 12, 6 + Math.random() * 4, (Math.random() - 0.5) * 12));
      this.vel.push(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(3));
    }
    this.target = new THREE.Vector3();
    this.roost = new THREE.Vector3();
    this.roostR = 7;
    const mat = new THREE.MeshStandardMaterial({ color: '#2d3654', roughness: 0.9, side: THREE.DoubleSide });
    const u = patchAtmosphere(mat);
    const flap = { value: 0 };
    mat.onBeforeCompile = (orig => sh => {
      orig(sh);
      sh.uniforms.uFlapT = flap;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float wing; attribute float phase; uniform float uFlapT;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float fl = sin(uFlapT * (11.0 + phase * 4.0) + phase * 40.0);
          float glide = smoothstep(0.2, 0.8, sin(uFlapT * 0.7 + phase * 17.0) * 0.5 + 0.5);
          transformed.y += abs(wing) * fl * 0.32 * (1.0 - glide * 0.85);
          transformed.x *= 1.0 - abs(wing) * abs(fl) * 0.12 * (1.0 - glide);`);
    })(mat.onBeforeCompile);
    mat.customProgramCacheKey = () => 'atlas-bird';
    this.flap = flap;
    const geo = birdGeometry();
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    const ph = new Float32Array(count); for (let i = 0; i < count; i++) ph[i] = Math.random();
    geo.setAttribute('phase', new THREE.InstancedBufferAttribute(ph, 1));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(1, 1, 1);
    this._side = new THREE.Vector3(); this._bq = new THREE.Quaternion(); this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3();
    this.scale = 0.9;
  }

  setRoost(v, r = 7) { this.roost.copy(v); this.roostR = r; }

  update(dt, t) {
    this.flap.value = t;
    const { pos, vel, n } = this;
    // the flock circles its roost; the circling point leads the birds around
    const ang = t * 0.35;
    this.target.set(this.roost.x + Math.cos(ang) * this.roostR, this.roost.y + Math.sin(t * 0.5) * 1.5, this.roost.z + Math.sin(ang) * this.roostR);
    const sep = this._a, ali = this._b, coh = this._c;
    const acc = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      sep.set(0, 0, 0); ali.set(0, 0, 0); coh.set(0, 0, 0);
      let k = 0;
      const p = pos[i];
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const q = pos[j];
        const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 9) continue;
        k++;
        ali.add(vel[j]); coh.add(q);
        if (d2 < 1.4) { const inv = 1 / (d2 + 0.05); sep.x += dx * inv; sep.y += dy * inv; sep.z += dz * inv; }
      }
      acc.set(0, 0, 0);
      if (k) {
        ali.divideScalar(k).sub(vel[i]).multiplyScalar(0.9);
        coh.divideScalar(k).sub(p).multiplyScalar(0.3);
        acc.add(ali).add(coh).addScaledVector(sep, 1.6);
      }
      const tx = this.target.x - p.x, ty = this.target.y - p.y, tz = this.target.z - p.z;
      const td = Math.hypot(tx, ty, tz) || 1;
      acc.x += tx / td * 2.2; acc.y += ty / td * 2.2; acc.z += tz / td * 2.2;
      const v = vel[i];
      v.addScaledVector(acc, dt);
      const sp = v.length();
      const lim = sp > 6.5 ? 6.5 / sp : sp < 2.6 ? 2.6 / sp : 1;
      v.multiplyScalar(lim);
      p.addScaledVector(v, dt);
      // orient along velocity, bank into the turn
      this._m.lookAt(v, ZERO, THREE.Object3D.DEFAULT_UP);
      this._q.setFromRotationMatrix(this._m);
      const bank = THREE.MathUtils.clamp(acc.dot(this._side.set(-v.z, 0, v.x).normalize()) * 0.12, -0.8, 0.8);
      this._q.multiply(this._bq.setFromAxisAngle(ZAX, bank));
      this._m.compose(p, this._q, this._s.setScalar(this.scale));
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
