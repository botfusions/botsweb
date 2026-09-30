// Falling things: maple leaves, samaras and petals as GPU-animated instanced cards that tumble,
// land and pile up; snow and summer motes as points.
import { THREE, clamp, lerp } from '../../src/core/engine.js';

// ─── Atlas (2×2): 7-lobed maple leaf, 5-lobed leaf, cherry petal, samara ──────
function drawAtlas() {
  const S = 512, cv = document.createElement('canvas');
  cv.width = cv.height = S * 2;
  const g = cv.getContext('2d');
  const leaf = (ox, oy, lobes, spread, lens, width) => {
    g.save(); g.translate(ox + S / 2, oy + S * 0.6);
    const path = new Path2D();
    const L = S * 0.4;
    const angs = [];
    for (let i = 0; i < lobes; i++) angs.push(-spread / 2 + spread * i / (lobes - 1));
    // outline through each lobe tip with serrated flanks and notches between lobes
    const pt = (a, r) => [Math.sin(a) * r, -Math.cos(a) * r];
    const first = pt(angs[0] - 0.22, L * 0.12);
    path.moveTo(first[0], first[1]);
    angs.forEach((a, i) => {
      const len = L * lens[i];
      const w = width;
      const notchL = pt(a - w, len * 0.32), tip = pt(a, len), notchR = pt(a + w, len * 0.32);
      // left flank, serrated
      const teeth = 7;
      for (let k = 1; k <= teeth; k++) {
        const t = k / teeth;
        const aa = lerp(a - w, a, t), rr = lerp(len * 0.32, len, t);
        const [x, y] = pt(aa - 0.05 * (1 - t), rr * (k % 2 ? 1.035 : 0.985));
        path.lineTo(x, y);
      }
      path.lineTo(tip[0], tip[1]);
      for (let k = teeth; k >= 1; k--) {
        const t = k / teeth;
        const aa = lerp(a + w, a, t), rr = lerp(len * 0.32, len, t);
        const [x, y] = pt(aa + 0.05 * (1 - t), rr * (k % 2 ? 1.035 : 0.985));
        path.lineTo(x, y);
      }
      path.lineTo(notchR[0], notchR[1]);
      if (i < angs.length - 1) { const nn = pt((a + angs[i + 1]) / 2, len * 0.22); path.lineTo(nn[0], nn[1]); }
      void notchL;
    });
    const last = pt(angs[angs.length - 1] + 0.22, L * 0.12);
    path.lineTo(last[0], last[1]);
    path.lineTo(0, L * 0.06);
    path.closePath();
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, L);
    grd.addColorStop(0, '#f4f0ea'); grd.addColorStop(0.6, '#e2dbd2'); grd.addColorStop(1, '#c9c0b5');
    g.fillStyle = grd; g.fill(path);
    // veins
    g.strokeStyle = 'rgba(90,70,60,0.35)'; g.lineWidth = 3;
    angs.forEach((a, i) => { const tip = pt(a, L * lens[i] * 0.92); g.beginPath(); g.moveTo(0, 0); g.lineTo(tip[0], tip[1]); g.stroke(); });
    g.lineWidth = 1.2; g.strokeStyle = 'rgba(90,70,60,0.18)';
    angs.forEach((a, i) => {
      for (let k = 1; k < 5; k++) {
        const r = L * lens[i] * k / 5.5; const [x, y] = pt(a, r);
        for (const sd of [-1, 1]) { const [x2, y2] = pt(a + sd * width * 0.7, r + L * 0.06); g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke(); }
      }
    });
    // petiole
    g.strokeStyle = '#b9ab9c'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(6, L * 0.3, -4, L * 0.52); g.stroke();
    g.restore();
  };
  leaf(0, 0, 7, 4.3, [0.62, 0.84, 0.96, 1, 0.96, 0.84, 0.62], 0.2);
  leaf(S, 0, 5, 3.3, [0.7, 0.94, 1, 0.94, 0.7], 0.3);
  // petal
  {
    g.save(); g.translate(S / 2, S * 1.5 + 20);
    const p = new Path2D();
    p.moveTo(0, S * 0.3);
    p.bezierCurveTo(S * 0.34, S * 0.14, S * 0.3, -S * 0.26, S * 0.07, -S * 0.3);
    p.lineTo(0, -S * 0.22);
    p.lineTo(-S * 0.07, -S * 0.3);
    p.bezierCurveTo(-S * 0.3, -S * 0.26, -S * 0.34, S * 0.14, 0, S * 0.3);
    const grd = g.createLinearGradient(0, S * 0.3, 0, -S * 0.3);
    grd.addColorStop(0, '#e6d6d6'); grd.addColorStop(0.35, '#fbf6f5'); grd.addColorStop(1, '#fffafa');
    g.fillStyle = grd; g.fill(p);
    g.strokeStyle = 'rgba(160,110,120,0.15)'; g.lineWidth = 2;
    for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(0, S * 0.28); g.quadraticCurveTo(k * S * 0.06, 0, k * S * 0.08, -S * 0.24); g.stroke(); }
    g.restore();
  }
  // samara (maple seed wing)
  {
    g.save(); g.translate(S * 1.5, S * 1.5);
    g.rotate(-0.5);
    const p = new Path2D();
    p.ellipse(0, S * 0.26, S * 0.07, S * 0.06, 0, 0, Math.PI * 2);
    g.fillStyle = '#b8a48c'; g.fill(p);
    const w = new Path2D();
    w.moveTo(-S * 0.05, S * 0.24);
    w.bezierCurveTo(-S * 0.2, 0, -S * 0.16, -S * 0.3, 0, -S * 0.36);
    w.bezierCurveTo(S * 0.14, -S * 0.3, S * 0.14, 0, S * 0.05, S * 0.22);
    w.closePath();
    const grd = g.createLinearGradient(0, S * 0.24, 0, -S * 0.36);
    grd.addColorStop(0, '#d8cbbb'); grd.addColorStop(1, '#f2ebe2');
    g.fillStyle = grd; g.fill(w);
    g.strokeStyle = 'rgba(110,90,70,0.25)'; g.lineWidth = 1.5;
    for (let k = 0; k < 9; k++) { g.beginPath(); g.moveTo(-S * 0.03, S * 0.22); g.quadraticCurveTo(-S * 0.1 + k * 0.02 * S, -S * 0.1, -S * 0.08 + k * S * 0.025, -S * 0.33); g.stroke(); }
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  return t;
}

const LEAF_HEAD = /* glsl */`
attribute vec3 aP0; attribute vec3 aP1; attribute vec4 aT; attribute vec4 aK; attribute vec3 aCol;
uniform float uTime; uniform vec3 uWind;
varying vec3 vCol; varying float vLanded;
vec4 qAx(vec3 a, float t){ return vec4(normalize(a) * sin(t * .5), cos(t * .5)); }
vec4 qMul(vec4 a, vec4 b){ return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz)); }
vec3 qRot(vec4 q, vec3 v){ return v + 2. * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
vec4 qSlerp(vec4 a, vec4 b, float t){ if (dot(a, b) < 0.) b = -b; return normalize(mix(a, b, t)); }
void kLeaf(out vec3 p, out vec4 q, out float s, out float land){
  float age = uTime - aT.x;
  float k = clamp(age / aT.y, 0., 1.);
  float seed = aT.w;
  float alive = step(0., age) * step(uTime, aT.z);
  s = aK.y * alive * smoothstep(aT.z, aT.z - 1.4, uTime) * smoothstep(0., 0.35, age);
  land = smoothstep(0.93, 1.0, k);
  p = mix(aP0, aP1, k);
  float fr = 1.3 + fract(seed * 7.3) * 1.1;
  float sw = sin(age * fr + seed * 40.);
  vec3 side = normalize(vec3(cos(seed * 50.), 0., sin(seed * 50.)));
  float fl = aK.w * (1. - land) * smoothstep(0., 0.12, k);
  p += side * sw * fl;
  p.y += (1. - abs(sw)) * fl * -0.3;
  vec3 ax = normalize(vec3(sin(seed * 12.), cos(seed * 7.) * 0.4, cos(seed * 12.)));
  vec4 fly;
  if (aK.x > 2.5) fly = qMul(qAx(vec3(0., 1., 0.), age * aK.z * 4.), qAx(vec3(1., 0., 0.), 1.1)); // samara: helicopter
  else fly = qMul(qAx(ax, age * aK.z), qAx(side, sw * 0.9));
  vec4 flat_ = qMul(qAx(vec3(0., 1., 0.), seed * 6.2831), qAx(vec3(1., 0., 0.), -1.5708 + (fract(seed * 9.1) - 0.5) * 0.45));
  q = qSlerp(fly, flat_, land);
}
`;

export class Fall {
  constructor(scene, { count = 1800, groundAt = () => 0, receiveShadow = true } = {}) {
    this.count = count;
    this.groundAt = groundAt;
    this.cursor = 0;
    this.time = 0;
    this.uniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector3() }, uSnow: { value: 0 }, uSnowCol: { value: new THREE.Color(0.9, 0.92, 0.96) } };
    const base = new THREE.PlaneGeometry(1, 1, 3, 3);
    // cup the card slightly so leaves read as leaves, not stickers
    const bp = base.attributes.position;
    for (let i = 0; i < bp.count; i++) bp.setZ(i, (bp.getX(i) ** 2 + bp.getY(i) ** 2 * 0.4) * 0.28);
    base.computeVertexNormals();
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('normal', base.attributes.normal);
    g.setAttribute('uv', base.attributes.uv);
    const mk = n => new THREE.InstancedBufferAttribute(new Float32Array(count * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aP0 = mk(3); this.aP1 = mk(3); this.aT = mk(4); this.aK = mk(4); this.aCol = mk(3);
    for (let i = 0; i < count; i++) this.aT.setXYZW(i, -100, 1, -99, Math.random());
    g.setAttribute('aP0', this.aP0); g.setAttribute('aP1', this.aP1); g.setAttribute('aT', this.aT); g.setAttribute('aK', this.aK); g.setAttribute('aCol', this.aCol);
    g.instanceCount = count;
    this.geometry = g;
    const atlas = drawAtlas();
    const U = this.uniforms;
    const vtx = shader => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${LEAF_HEAD}`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          #ifdef USE_MAP
          { float kd = floor(aK.x + 0.5); vMapUv = uv * 0.5 + vec2(mod(kd, 2.) * 0.5, kd < 1.5 ? 0.5 : 0.); }
          #endif`)
        .replace('#include <begin_vertex>', `vec3 kp; vec4 kq; float ks; float kl; kLeaf(kp, kq, ks, kl);
          vec3 transformed = qRot(kq, position * ks) + kp; vCol = aCol; vLanded = kl;`);
    };
    this.material = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.62, metalness: 0, envMapIntensity: 0.7 });
    this.material.onBeforeCompile = shader => {
      vtx(shader);
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `vec3 objectNormal;
        { vec3 kp; vec4 kq; float ks; float kl; kLeaf(kp, kq, ks, kl); objectNormal = qRot(kq, normal); }`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCol; varying float vLanded; uniform float uSnow; uniform vec3 uSnowCol;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          diffuseColor.rgb *= vCol;
          diffuseColor.rgb = mix(diffuseColor.rgb, uSnowCol, uSnow * vLanded * 0.82);`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.16;');
    };
    this.material.customProgramCacheKey = () => 'koen-fall';
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5, side: THREE.DoubleSide });
    depth.onBeforeCompile = vtx;
    depth.customProgramCacheKey = () => 'koen-fall-depth';
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.customDepthMaterial = depth;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = receiveShadow;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this._dirty = false;
    this.pile = new Map();
  }

  /** p0: start, drift: horizontal velocity, speed: fall speed (units/s). */
  spawn({ p0, drift, speed = 0.3, kind = 0, color, size = 0.065, life = 60, spin = 2, flutter = 0.08, landed = 0 }) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.count;
    let t0 = this.time;
    // two passes to find where it lands
    let gy = 0, dur = 1, lx = p0.x, lz = p0.z;
    for (let it = 0; it < 3; it++) {
      dur = Math.max(0.3, (p0.y - gy) / speed);
      lx = p0.x + drift.x * dur; lz = p0.z + drift.z * dur;
      gy = this.groundAt(lx, lz);
    }
    // leaves pile: each landing lifts the next a little
    if (landed) t0 -= dur + landed; // already on the ground when the page opens
    const key = `${Math.round(lx * 30)},${Math.round(lz * 30)}`;
    const stack = this.pile.get(key) ?? 0;
    this.pile.set(key, stack + 1);
    const lift = Math.min(stack, 6) * 0.0035 + 0.003;
    this.aP0.setXYZ(i, p0.x, p0.y, p0.z);
    this.aP1.setXYZ(i, lx, gy + lift, lz);
    this.aT.setXYZW(i, t0, dur, t0 + dur + life, Math.random());
    this.aK.setXYZW(i, kind, size, spin, flutter);
    this.aCol.setXYZ(i, color.r, color.g, color.b);
    this._dirty = true;
  }

  /** Remove everything that has landed (spring clean) over a few seconds. */
  clearLanded(within = 2.5) {
    const now = this.time;
    for (let i = 0; i < this.count; i++) {
      const t0 = this.aT.getX(i), dur = this.aT.getY(i), death = this.aT.getZ(i);
      if (death > now && this.aK.getX(i) < 1.5) this.aT.setZ(i, now + 0.4 + Math.random() * within);
    }
    this.pile.clear();
    this._dirty = true;
  }

  update(dt, wind) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uWind.value.copy(wind);
    if (this._dirty) {
      for (const a of [this.aP0, this.aP1, this.aT, this.aK, this.aCol]) a.needsUpdate = true;
      this._dirty = false;
    }
  }
}

// ─── Points: snow and motes ───────────────────────────────────────────────────
export class Drift {
  constructor(scene, { count = 5000, box = [-3.5, 0, -3, 3.5, 3.6, 3.4], color = 0xffffff, size = 5, speed = 0.4, swirl = 0.1, bright = 1, glow = false } = {}) {
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    const [x0, y0, z0, x1, y1, z1] = box;
    for (let i = 0; i < count; i++) {
      pos[i * 3] = lerp(x0, x1, Math.random()); pos[i * 3 + 1] = lerp(y0, y1, Math.random()); pos[i * 3 + 2] = lerp(z0, z1, Math.random());
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = {
      uTime: { value: 0 }, uAmt: { value: 0 }, uDpr: { value: 1 }, uSize: { value: size }, uSpeed: { value: speed }, uSwirl: { value: swirl },
      uBox0: { value: new THREE.Vector3(x0, y0, z0) }, uBox1: { value: new THREE.Vector3(x1, y1, z1) }, uWind: { value: new THREE.Vector3() },
      uCol: { value: new THREE.Color(color).multiplyScalar(bright) }, uFogCol: { value: new THREE.Color() }, uFogD: { value: 0.02 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute float seed; uniform float uTime, uAmt, uDpr, uSize, uSpeed, uSwirl, uFogD; uniform vec3 uBox0, uBox1, uWind;
        varying float vA; varying float vFog;
        void main(){
          vec3 span = uBox1 - uBox0;
          vec3 p = position;
          float t = uTime;
          p.y -= t * uSpeed * (0.6 + seed * 0.8);
          p += uWind * t * (0.7 + seed * 0.6);
          p.x += sin(t * (0.5 + seed) + seed * 30.) * uSwirl;
          p.z += cos(t * (0.4 + seed * 0.7) + seed * 17.) * uSwirl;
          p = uBox0 + mod(p - uBox0, span);
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * mv;
          float edge = smoothstep(0., 0.3, p.y - uBox0.y) * smoothstep(0., 0.4, uBox1.y - p.y);
          vA = uAmt * edge * smoothstep(0.25, 0.9, -mv.z) * step(fract(seed * 13.7), uAmt * 1.2 + 0.05);
          vFog = 1. - exp(-uFogD * uFogD * mv.z * mv.z);
          gl_PointSize = uSize * (0.45 + fract(seed * 31.) * 0.9) * uDpr * (2.2 / -mv.z);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uCol, uFogCol; varying float vA; varying float vFog;
        void main(){
          float d = length(gl_PointCoord - .5);
          float a = smoothstep(.5, .12, d);
          gl_FragColor = vec4(mix(uCol, uFogCol, vFog * 0.7), a * vA);
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }
  update(dt, t, amt, wind) {
    this.uniforms.uTime.value = t;
    this.uniforms.uAmt.value = amt;
    this.uniforms.uWind.value.copy(wind);
    this.points.visible = amt > 0.002;
  }
}
