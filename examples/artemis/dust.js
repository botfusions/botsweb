// Kicked regolith: every grain is a closed-form ballistic arc under lunar gravity. No air, so no drag and no
// billowing — the spray rises, falls on a clean parabola and stops dead when it meets the ground.
import { THREE } from '../../src/core/engine.js';
import { mulberry32 } from './noise.js';

export const G_MOON = 1.62;

export class Dust {
  constructor(max = 6000) {
    this.max = max; this.head = 0;
    this.rnd = mulberry32(99);
    const geo = new THREE.BufferGeometry();
    this.a0 = new Float32Array(max * 4); // p0.xyz, t0
    this.a1 = new Float32Array(max * 4); // v.xyz, life
    this.a2 = new Float32Array(max);     // size/brightness seed
    for (let i = 0; i < max; i++) { this.a0[i * 4 + 3] = -100; this.a1[i * 4 + 3] = 0; this.a2[i] = this.rnd(); }
    this.b0 = new THREE.BufferAttribute(this.a0, 4).setUsage(THREE.DynamicDrawUsage);
    this.b1 = new THREE.BufferAttribute(this.a1, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    geo.setAttribute('a0', this.b0); geo.setAttribute('a1', this.b1); geo.setAttribute('seed', new THREE.BufferAttribute(this.a2, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uG: { value: G_MOON }, uDpr: { value: 1 }, uBright: { value: 1.5 }, uH: { value: 900 } },
      vertexShader: /* glsl */`
        attribute vec4 a0; attribute vec4 a1; attribute float seed;
        uniform float uTime, uG, uDpr, uH; varying float vA; varying float vS;
        void main(){
          float t = uTime - a0.w;
          if (t < 0. || t > a1.w + 0.35) { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 0.; return; }
          float tf = min(t, a1.w);
          vec3 p = a0.xyz + a1.xyz * tf + vec3(0., -0.5 * uG * tf * tf, 0.);
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * mv;
          float sz = mix(0.004, 0.02, seed * seed * seed);
          gl_PointSize = max(1.3, sz * uH * projectionMatrix[1][1] * 0.5 / -mv.z) * uDpr;
          vA = (t > a1.w ? 1. - (t - a1.w) / 0.35 : 1.) * smoothstep(0., 0.05, t);
          vS = seed;
        }`,
      fragmentShader: /* glsl */`
        uniform float uBright; varying float vA; varying float vS;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.2, d) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.6, 0.59, 0.57) * uBright * (0.55 + vS * 0.5), a * 0.85);
        }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }
  // Launch n grains from p with directions around `dir` (unit, horizontal), speed range and elevation range (radians).
  kick(p, dir, n, { speed = [0.5, 1.4], elev = [0.35, 1.0], spread = 0.8, time, ground = p.y, jitter = 0.05 }) {
    const r = this.rnd;
    let lo = this.head, cnt = 0;
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % this.max; cnt++;
      const yaw = Math.atan2(dir.x, dir.z) + (r() - 0.5) * spread * 2;
      const el = elev[0] + (elev[1] - elev[0]) * r();
      const s = speed[0] + (speed[1] - speed[0]) * Math.pow(r(), 1.6);
      const vx = Math.sin(yaw) * Math.cos(el) * s, vz = Math.cos(yaw) * Math.cos(el) * s, vy = Math.sin(el) * s;
      const px = p.x + (r() - 0.5) * jitter * 2, py = p.y + r() * 0.02, pz = p.z + (r() - 0.5) * jitter * 2;
      const h0 = Math.max(0, py - ground);
      const life = (vy + Math.sqrt(vy * vy + 2 * G_MOON * h0)) / G_MOON;
      this.a0.set([px, py, pz, time + r() * 0.05], i * 4);
      this.a1.set([vx, vy, vz, life], i * 4);
    }
    // upload the touched range (handles wrap-around by uploading everything in that case)
    if (lo + cnt <= this.max) {
      this.b0.addUpdateRange(lo * 4, cnt * 4); this.b1.addUpdateRange(lo * 4, cnt * 4);
    } else { this.b0.clearUpdateRanges(); this.b1.clearUpdateRanges(); }
    this.b0.needsUpdate = true; this.b1.needsUpdate = true;
  }
}
