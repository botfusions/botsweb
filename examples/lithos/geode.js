// The closed geode: two copies of the cut half, the top one mirrored across the measured cut plane so the rims
// meet exactly. Hold to crack (violet seam glow, falling grit, tremble), release the stone at 100%.
import { THREE, clamp, lerp, smooth } from '../../src/core/engine.js';
import { firstMesh } from '../../src/core/assets.js';
import { gsap } from '../../src/core/scroll.js';
import { patchGeode } from './materials.js';

// Cut plane of models/lithos/geode.glb, measured once offline (max-coplanar-vertex search): unit normal, offset along it, rim centroid.
const PLANE_N = new THREE.Vector3(-0.01168, 0.74314, 0.66903).normalize();
const PLANE_D = 0.2214;
const RIM_C = new THREE.Vector3(0.00324, 0.59829, -0.34094);
const WIDTH = 1.9;
const HOLD_TIME = 1.9;
const UP = new THREE.Vector3(0, 1, 0);

export class Geode {
  constructor(gltf, { size = 1, position = new THREE.Vector3(), scene, camera, renderer }) {
    this.scene = scene; this.camera = camera;
    this.S = size / WIDTH;
    const S = this.S;
    const src = gltf.scene;
    src.position.set(0, 0, 0); src.updateMatrixWorld(true);
    const mesh = firstMesh(src);
    const meshRel = mesh.matrixWorld.clone();
    const c = RIM_C.clone().addScaledVector(PLANE_N, PLANE_D - 0.0015 - RIM_C.dot(PLANE_N));
    const q = new THREE.Quaternion().setFromUnitVectors(PLANE_N, UP);
    this.toHalf = new THREE.Matrix4().compose(new THREE.Vector3(), q, new THREE.Vector3(S, S, S))
      .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z)).multiply(meshRel);

    this.u = {
      uToHalf: { value: this.toHalf }, uSeal: { value: 1 }, uSeamY: { value: 0.02 }, uCrack: { value: 0 }, uGlint: { value: 0 }, uInner: { value: 0 }, uTime: { value: 0 },
      uGlintScale: { value: 95 }, uCrackColor: { value: new THREE.Color(0x9d6bff).multiplyScalar(1.6) },
      uL1Pos: { value: new THREE.Vector3() }, uL1Col: { value: new THREE.Vector3() },
      uL2Pos: { value: new THREE.Vector3() }, uL2Col: { value: new THREE.Vector3() },
    };
    patchGeode(mesh.material, { ...this.u, uSide: { value: -1 } });
    mesh.material.envMapIntensity = 0.55;
    this.mat = mesh.material;
    mesh.castShadow = mesh.receiveShadow = true;
    const aniso = renderer.capabilities.getMaxAnisotropy();
    for (const k of ['map', 'normalMap', 'roughnessMap']) if (mesh.material[k]) mesh.material[k].anisotropy = aniso;

    // Geometry in half space: rest height, rim ring (dust), cavity points (burst).
    const pos = mesh.geometry.attributes.position, nor = mesh.geometry.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(this.toHalf);
    const P = new THREE.Vector3(), N = new THREE.Vector3();
    let minY = 0, maxR = 0;
    const rim = [], cav = [], cavN = [], all = [];
    for (let i = 0; i < pos.count; i++) {
      P.fromBufferAttribute(pos, i).applyMatrix4(this.toHalf);
      minY = Math.min(minY, P.y);
      const r = Math.hypot(P.x, P.z);
      maxR = Math.max(maxR, r);
      if (i % 3 === 0) all.push(P.x, P.y, P.z);
      if (Math.abs(P.y) < 0.008) rim.push([P.x, P.z, r]);
      N.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      if (P.y < -0.03 && N.dot(P.clone().normalize()) < -0.25 && i % 2 === 0) { cav.push(P.x, P.y, P.z); cavN.push(N.x, N.y, N.z); }
    }
    this.depth = -minY;
    this.all = all;
    const rimMax = rim.reduce((m, p) => Math.max(m, p[2]), 0);
    this.rim = rim.filter(p => p[2] > rimMax * 0.93);
    this.rimR = rimMax;
    this.cav = cav;
    this.cavN = cavN;
    this.radius = maxR;

    // Hierarchy: pair (tremble) -> root (animated) -> flip (mirror) -> align (plane to y=0) -> gltf scene.
    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);
    this.pair = new THREE.Group();
    this.group.add(this.pair);
    const half = (mirror) => {
      const root = new THREE.Group();
      const flip = new THREE.Group(); if (mirror) flip.scale.y = -1;
      const align = new THREE.Group(); align.quaternion.copy(q); align.scale.setScalar(S);
      const inner = mirror ? src.clone(true) : src;
      inner.position.copy(c).negate();
      if (mirror) {
        // Same maps and uniforms, different crack pattern, so the lid is not a mirror image of the base.
        const mm = firstMesh(inner);
        mm.material = patchGeode(this.mat.clone(), { ...this.u, uSide: { value: 1 } });
      }
      align.add(inner); flip.add(align); root.add(flip);
      root.position.y = this.depth - 0.018;
      root.userData.flip = flip;
      this.pair.add(root);
      return root;
    };
    this.bottom = half(false);
    this.top = half(true);
    this.seamY = this.depth - 0.018;

    // Where the lid comes to rest: standing behind, leaning back, its cavity turned to the room.
    this.restN = new THREE.Vector3(-0.3, 0.5, 0.81).normalize();
    this.restQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), this.restN);
    let lo = 0;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < all.length; i += 3) { tmp.set(all[i], -all[i + 1], all[i + 2]).applyQuaternion(this.restQ); lo = Math.min(lo, tmp.y); }
    this.restPos = new THREE.Vector3(0.88, -lo - 0.02, -0.36);
    this.bottomTilt = 0.34;
    this.closeGap = 0.04;

    this.state = 'closed';
    this.hold = 0;
    this.open = 0;      // 0 closed .. 1 fully open (camera blend)
    this.lidT = 0;      // lid path parameter
    this.burstT = -1;
    this.listeners = [];
    this.front = new THREE.Vector3(0, this.seamY, 0);
    let best = -1e9;
    for (const [x, z] of this.rim) if (z > best) { best = z; this.front.set(x, this.seamY, z); }
    this.front.add(position);

    this._buildDust();
    this._buildBurst();
    this._buildChips();
    this.flareU = { uL1: { value: new THREE.Vector3() }, uL2: { value: new THREE.Vector3() }, uC1: { value: 0 }, uC2: { value: 0 }, uGlint: this.u.uGlint, uTime: this.u.uTime, uDpr: { value: 1 } };
    for (const r of [this.bottom, this.top]) r.userData.flip.add(this._buildFlares(r === this.top ? 7.1 : 0));
    this.burstLight = new THREE.PointLight(0xa47bff, 0, 3.5, 2);
    this.burstLight.position.set(0, this.seamY - 0.08, 0);
    this.group.add(this.burstLight);
  }

  on(f) { this.listeners.push(f); }
  _emit(e) { for (const f of this.listeners) f(e); }

  // ── falling grit from the seam ─────────────────────────────────────────────
  _buildDust() {
    const N = 2200;
    const p = new Float32Array(N * 3), d = new Float32Array(N * 3), s = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const [x, z] = this.rim[(Math.random() * this.rim.length) | 0];
      p.set([x, this.seamY, z], i * 3);
      const l = Math.hypot(x, z) || 1;
      d.set([x / l, 0, z / l], i * 3);
      s.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('dir', new THREE.BufferAttribute(d, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(s, 4));
    this.dustMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uEmit: { value: 0 }, uDpr: { value: 1 }, uColor: { value: new THREE.Color(0x9d6bff) } },
      vertexShader: /* glsl */`
        attribute vec3 dir; attribute vec4 seed; uniform float uTime, uEmit, uDpr; varying float vA; varying float vHot;
        float h(float n){ return fract(sin(n) * 43758.5453); }
        void main(){
          float period = 0.9 + seed.x * 1.1;
          float ph = uTime / period + seed.y * 17.0;
          float age = fract(ph);
          float alive = step(h(floor(ph) * 7.13 + seed.z * 91.7), uEmit * 0.9);
          float t = age * period;
          vec3 p = position + dir * (0.004 + t * (0.03 + seed.w * 0.05)) + vec3(0.0, -2.6 * t * t, 0.0);
          vec4 wp = modelMatrix * vec4(p, 1.0);
          wp.y = max(wp.y, 0.006);
          vHot = 1.0 - smoothstep(0.0, 0.12, t);
          vA = alive * (1.0 - smoothstep(0.55, 1.0, age)) * smoothstep(0.01, 0.06, wp.y);
          vec4 mv = viewMatrix * wp;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.7 + seed.w * 1.5) * uDpr * (3.0 / -mv.z);
          if (vA < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; varying float vA; varying float vHot;
        void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .1, d) * vA;
          if (a < 0.003) discard;
          vec3 c = mix(vec3(0.34, 0.31, 0.29), uColor * 5.0, vHot);
          gl_FragColor = vec4(c, a); }`,
    });
    const pts = new THREE.Points(g, this.dustMat);
    pts.frustumCulled = false;
    this.pair.add(pts);
    this.dust = pts;
  }

  // ── violet glitter released when the stone opens ──────────────────────────
  _buildBurst() {
    const src = this.cav;
    const N = 2600;
    const p = new Float32Array(N * 3), v = new Float32Array(N * 3), s = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const k = ((Math.random() * (src.length / 3)) | 0) * 3;
      p.set([src[k], src[k + 1] + this.seamY, src[k + 2]], i * 3);
      const a = Math.random() * Math.PI * 2, sp = 0.15 + Math.random() * 0.9;
      v.set([Math.cos(a) * sp * 0.55 + src[k] * 1.2, 0.5 + Math.random() * 1.6, Math.sin(a) * sp * 0.55 + src[k + 2] * 1.2], i * 3);
      s[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('vel', new THREE.BufferAttribute(v, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(s, 1));
    this.burstMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: -1 }, uDpr: { value: 1 }, uTime: { value: 0 } },
      vertexShader: /* glsl */`
        attribute vec3 vel; attribute float seed; uniform float uT, uDpr, uTime; varying float vA; varying float vS;
        void main(){
          float t = max(uT - seed * 0.25, 0.0);
          vec3 p = position + vel * t * (0.55 + seed * 0.5) + vec3(0.0, -1.1 * t * t, 0.0);
          vec4 wp = modelMatrix * vec4(p, 1.0);
          wp.y = max(wp.y, 0.006);
          vA = step(0.0, uT) * exp(-t * (0.9 + seed * 1.6)) * smoothstep(0.0, 0.05, t);
          vS = 0.55 + 0.45 * sin(uTime * (9.0 + seed * 14.0) + seed * 60.0);
          vec4 mv = viewMatrix * wp;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.0 + seed * 2.6) * uDpr * (3.4 / -mv.z);
          if (vA < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying float vA; varying float vS;
        void main(){ vec2 q = gl_PointCoord - .5; float d = length(q);
          float core = smoothstep(.5, .0, d); float cross = max(smoothstep(.06, .0, abs(q.x)), smoothstep(.06, .0, abs(q.y))) * smoothstep(.5, .1, d);
          float a = (core + cross * 0.6) * vA * vS;
          if (a < 0.003) discard;
          vec3 c = mix(vec3(0.62, 0.42, 1.0), vec3(1.0, 0.95, 1.0), core * core) * 6.0;
          gl_FragColor = vec4(c, min(a, 1.0)); }`,
    });
    const pts = new THREE.Points(g, this.burstMat);
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  // ── stone chips that spit off the seam ────────────────────────────────────
  _buildChips() {
    const N = 46;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x7d746b, roughness: 0.92, metalness: 0 });
    this.chips = new THREE.InstancedMesh(geo, mat, N);
    this.chips.castShadow = true;
    this.chips.count = 0;
    this.chipState = [];
    for (let i = 0; i < N; i++) {
      const [x, z] = this.rim[(Math.random() * this.rim.length) | 0];
      const l = Math.hypot(x, z) || 1;
      const sp = 0.4 + Math.random() * 1.1;
      this.chipState.push({
        p: new THREE.Vector3(x, this.seamY, z), v: new THREE.Vector3(x / l * sp, 0.4 + Math.random() * 1.2, z / l * sp),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6), w: new THREE.Vector3().randomDirection().multiplyScalar(8 + Math.random() * 14),
        s: 0.006 + Math.random() ** 2 * 0.02, rest: false,
      });
    }
    this.group.add(this.chips);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._sv = new THREE.Vector3();
  }

  // ── star flares: facets that catch the key or the cursor light flash into four-point stars ─────
  _buildFlares(salt) {
    const src = this.cav, sn = this.cavN;
    const N = 1800;
    const p = new Float32Array(N * 3), n = new Float32Array(N * 3), s = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const k = ((Math.random() * (src.length / 3)) | 0) * 3;
      p.set([src[k] + sn[k] * 0.004, src[k + 1] + sn[k + 1] * 0.004, src[k + 2] + sn[k + 2] * 0.004], i * 3);
      n.set([sn[k], sn[k + 1], sn[k + 2]], i * 3);
      s[i] = Math.random() + salt;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('nrm', new THREE.BufferAttribute(n, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(s, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.flareU,
      vertexShader: /* glsl */`
        attribute vec3 nrm; attribute float seed;
        uniform vec3 uL1, uL2; uniform float uC1, uC2, uGlint, uTime, uDpr;
        varying float vI; varying float vRot;
        vec3 h3(float n){ return fract(sin(vec3(n * 91.37, n * 47.13, n * 13.71)) * 43758.5453) - 0.5; }
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec3 wn = normalize(mat3(modelMatrix) * nrm);
          vec3 nf = normalize(wn + h3(seed) * 1.1);
          vec3 V = normalize(cameraPosition - wp.xyz);
          float s1 = pow(max(dot(nf, normalize(normalize(uL1 - wp.xyz) + V)), 0.0), 160.0);
          float s2 = pow(max(dot(nf, normalize(normalize(uL2 - wp.xyz) + V)), 0.0), 160.0);
          float tw = 0.55 + 0.45 * sin(uTime * (1.7 + fract(seed * 7.3) * 4.0) + seed * 50.0);
          vI = (s1 * uC1 + s2 * uC2) * tw * uGlint;
          vRot = fract(seed * 13.1) * 0.5;
          vec4 mv = viewMatrix * wp;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(sqrt(vI), 0.0, 1.5) * 56.0 * uDpr * (2.4 / -mv.z);
          if (vI < 0.015) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying float vI; varying float vRot;
        void main(){
          vec2 q = gl_PointCoord - 0.5;
          float c = cos(vRot), s = sin(vRot);
          q = mat2(c, -s, s, c) * q;
          float d = length(q);
          float core = exp(-d * d * 180.0);
          float ray = (exp(-abs(q.x) * 90.0) + exp(-abs(q.y) * 90.0)) * (1.0 - smoothstep(0.0, 0.5, d));
          float diag = exp(-abs(q.x + q.y) * 120.0) * exp(-abs(q.x - q.y) * 3.0) + exp(-abs(q.x - q.y) * 120.0) * exp(-abs(q.x + q.y) * 3.0);
          float a = (core * 1.6 + ray * 0.7 + diag * 0.12 * (1.0 - smoothstep(0.0, 0.35, d)));
          vec3 col = mix(vec3(0.78, 0.62, 1.0), vec3(1.0), core);
          float i = min(vI, 3.0);
          if (a * i < 0.004) discard;
          gl_FragColor = vec4(col * 3.0, min(a * i, 1.0));
        }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    return pts;
  }

  setLights(l1, c1, l2, c2) { this.flareU.uL1.value.copy(l1); this.flareU.uC1.value = c1; this.flareU.uL2.value.copy(l2); this.flareU.uC2.value = c2; }

  setDpr(d) { this.dustMat.uniforms.uDpr.value = d; this.burstMat.uniforms.uDpr.value = d; this.flareU.uDpr.value = d; }

  // ── state ─────────────────────────────────────────────────────────────────
  update(dt, t, holding) {
    this.u.uTime.value = t;
    this.dustMat.uniforms.uTime.value = t;
    this.burstMat.uniforms.uTime.value = t;
    if (this.state === 'closed') {
      this.hold = clamp(this.hold + (holding ? dt / HOLD_TIME : -dt * 0.9));
      const h = this.hold;
      // A faint breathing hairline hints that something is alive inside before anyone touches it.
      const idle = 0.05 + 0.035 * Math.sin(t * 1.6);
      this.u.uCrack.value = Math.max(h * h * (3 - 2 * h) * 0.95, idle);
      this.dustMat.uniforms.uEmit.value = smooth(0.12, 1, h);
      // Tremble: a stone under stress, not a phone buzzing.
      const a = h * h * 0.0065 + (h > 0.85 ? (h - 0.85) * 0.03 : 0);
      this.pair.position.set(Math.sin(t * 71) * a, Math.abs(Math.sin(t * 53)) * a * 0.6, Math.cos(t * 67) * a);
      this.pair.rotation.set(Math.sin(t * 43) * a * 0.9, Math.sin(t * 29) * a * 0.5, Math.cos(t * 37) * a * 0.9);
      if (this.hold >= 1) this.split();
    } else {
      this.dustMat.uniforms.uEmit.value = Math.max(0, this.dustMat.uniforms.uEmit.value - dt * 1.5);
    }
    if (this.burstT >= 0) {
      this.burstT += dt;
      this.burstMat.uniforms.uT.value = this.burstT;
      this._chips(dt);
      if (this.burstT > 6) { this.burstT = -1; this.burstMat.uniforms.uT.value = -1; }
    }
    this._lid();
  }

  _chips(dt) {
    let n = 0;
    for (const c of this.chipState) {
      if (!c.rest) {
        c.v.y -= 3.2 * dt;
        c.p.addScaledVector(c.v, dt);
        c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
        if (c.p.y < c.s * 0.6) {
          c.p.y = c.s * 0.6;
          if (Math.abs(c.v.y) < 0.25) { c.rest = true; c.v.set(0, 0, 0); }
          else { c.v.y *= -0.32; c.v.x *= 0.5; c.v.z *= 0.5; c.w.multiplyScalar(0.5); }
        }
      }
      this._q.setFromEuler(c.r);
      this._m.compose(c.p, this._q, this._sv.set(c.s, c.s * 0.7, c.s * 0.85));
      this.chips.setMatrixAt(n++, this._m);
    }
    this.chips.count = n;
    this.chips.instanceMatrix.needsUpdate = true;
  }

  _lid() {
    const k = this.lidT;
    const lift = this.seamY;
    const up = new THREE.Vector3(0, lift + 0.5, 0.02);
    const end = this.restPos;
    // Rise, hang for a heartbeat, swing back and down onto the velvet.
    const a = smooth(0, 0.34, k), b = smooth(0.34, 1, k);
    // Closed, the lid sinks a hair into the base: the sawn rim is not perfectly flat, and a gap would show the crystals.
    const p = new THREE.Vector3(0, lift - this.closeGap, 0).lerp(up, a);
    const mid = up.clone().lerp(end, b); mid.y += Math.sin(b * Math.PI) * 0.12;
    if (k > 0.34) p.copy(mid);
    this.top.position.copy(p);
    const qa = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.18 * a, -0.35 * a, -0.06 * a));
    this.top.quaternion.copy(qa).slerp(this.restQ, b);
    this.bottom.rotation.x = this.bottomTilt * smooth(0.25, 1, k);
    this.bottom.position.z = 0.06 * smooth(0.25, 1, k);
  }

  split() {
    if (this.state !== 'closed') return;
    this.state = 'opening';
    this.hold = 1;
    this._emit('split');
    this.pair.position.set(0, 0, 0); this.pair.rotation.set(0, 0, 0);
    this.burstT = 0;
    for (const c of this.chipState) c.rest = false;
    const tl = gsap.timeline({ onComplete: () => { this.state = 'open'; this._emit('open'); } });
    tl.to(this.u.uCrack, { value: 1.5, duration: 0.12, ease: 'power2.out' }, 0)
      .to(this.u.uSeal, { value: 0, duration: 0.6 }, 0.2)
      .to(this.u.uCrack, { value: 0, duration: 2.4, ease: 'power2.inOut' }, 0.35)
      .to(this.burstLight, { intensity: 9, duration: 0.18, ease: 'power2.out' }, 0.05)
      .to(this.burstLight, { intensity: 0.35, duration: 3.2, ease: 'power3.out' }, 0.3)
      .to(this.u.uInner, { value: 2.4, duration: 0.2 }, 0.1)
      .to(this.u.uInner, { value: 0.06, duration: 3.2, ease: 'power2.out' }, 0.4)
      .to(this.u.uGlint, { value: 1, duration: 1.4, ease: 'power2.inOut' }, 0.3)
      .to(this, { lidT: 1, duration: 3.1, ease: 'power1.inOut' }, 0.05)
      .to(this, { open: 1, duration: 3.6, ease: 'power2.inOut' }, 0.15);
    this.tl = tl;
  }

  reseal() {
    if (this.state !== 'open') return;
    this.state = 'closing';
    this.tl?.kill();
    gsap.timeline({ onComplete: () => { this.state = 'closed'; this.hold = 0; this.chips.count = 0; this._emit('closed'); } })
      .to(this, { lidT: 0, duration: 2.2, ease: 'power2.inOut' }, 0)
      .to(this, { open: 0, duration: 2.4, ease: 'power2.inOut' }, 0)
      .to(this.u.uGlint, { value: 0, duration: 1.2 }, 1)
      .to(this.u.uSeal, { value: 1, duration: 0.6 }, 1.6)
      .to(this.u.uInner, { value: 0, duration: 1 }, 0)
      .to(this.burstLight, { intensity: 0, duration: 1 }, 0);
  }
}
