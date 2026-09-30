// Things on the water: lotus, lily pads, falling maple leaves and petals, food pellets, splash droplets, snow.
import * as THREE from 'three';
import { bakeTexture } from '../../src/core/textures.js';
import { pondSDF } from './shape.js';
import { underShared } from './water.js';

// Floating objects sample the ripple surface in the vertex shader: heave with the height, tilt with the slope.
export const floatShared = { uBob: { value: 5 }, uTilt: { value: 0.9 } };
export function patchFloat(mat, key) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, floatShared, { uSurf: underShared.uSurf, uSimRect: underShared.uSimRect });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uSurf; uniform vec4 uSimRect; uniform float uBob, uTilt;')
      .replace('#include <project_vertex>', /* glsl */`
        vec4 kw = vec4(transformed, 1.0);
        vec4 kc = vec4(0., 0., 0., 1.);
        #ifdef USE_INSTANCING
          kw = instanceMatrix * kw; kc = instanceMatrix * kc;
        #endif
        kw = modelMatrix * kw; kc = modelMatrix * kc;
        vec4 ks = texture2D(uSurf, (kc.xz - uSimRect.xy) / uSimRect.z);
        float kfl = 1. - smoothstep(0.02, 0.12, kc.y);
        kw.y += kfl * (ks.x * uBob - dot(kw.xz - kc.xz, ks.yz) * uTilt * 0.12);
        vec4 mvPosition = viewMatrix * kw;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  mat.customProgramCacheKey = () => 'float' + key;
  return mat;
}

// ─── Leaf & petal atlas (canvas-drawn) ─────────────────────────────────────────
function leafAtlas() {
  const W = 256, c = document.createElement('canvas'); c.width = W * 3; c.height = W * 2;
  const g = c.getContext('2d');
  const pals = [['#f7784a', '#e0503a', '#9e2317'], ['#ec4a33', '#b8261a', '#6d1210'], ['#f9a440', '#e8702a', '#a8401a'],
    ['#f5cf5a', '#e9a03a', '#b0621c'], ['#a8c455', '#6f9632', '#35561c'], ['#ffe0e6', '#f7b3c3', '#dc7d96']];
  for (let s = 0; s < 6; s++) {
    const ox = (s % 3) * W + W / 2, oy = Math.floor(s / 3) * W + W / 2;
    const [c0, c1, c2] = pals[s];
    g.save(); g.translate(ox, oy);
    if (s < 5) {
      const R = W * 0.46;
      const lobes = [[0, 1], [0.8, 0.9], [-0.8, 0.9], [1.58, 0.7], [-1.58, 0.7], [2.3, 0.36], [-2.3, 0.36]];
      g.beginPath();
      for (let k = 0; k <= 720; k++) {
        const phi = -Math.PI + k / 720 * Math.PI * 2;
        let r = 0.2;
        for (const [a, l] of lobes) { let u = Math.abs(phi - a) / 0.3; r = Math.max(r, l * Math.pow(Math.max(0, 1 - u), 0.85)); }
        r += 0.018 * Math.abs(Math.sin(phi * 46)) * (r > 0.3 ? 1 : 0);
        const x = Math.sin(phi) * r * R, y = -Math.cos(phi) * r * R + R * 0.08;
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
      const gr = g.createRadialGradient(0, R * 0.1, 0, 0, R * 0.1, R);
      gr.addColorStop(0, c0); gr.addColorStop(0.55, c1); gr.addColorStop(1, c2);
      g.fillStyle = gr; g.fill();
      g.strokeStyle = 'rgba(40,10,5,.35)'; g.lineWidth = 2;
      for (const [a, l] of lobes) { g.beginPath(); g.moveTo(0, R * 0.12); g.lineTo(Math.sin(a) * l * R * 0.9, -Math.cos(a) * l * R * 0.9 + R * 0.08); g.stroke(); }
      g.strokeStyle = c2; g.lineWidth = 4; g.beginPath(); g.moveTo(0, R * 0.12); g.quadraticCurveTo(R * 0.05, R * 0.5, -R * 0.02, R * 0.85); g.stroke();
    } else {
      const R = W * 0.42;
      g.beginPath();
      g.moveTo(0, R);
      g.bezierCurveTo(R * 0.9, R * 0.5, R * 0.75, -R * 0.75, R * 0.12, -R * 0.9);
      g.lineTo(0, -R * 0.68);
      g.lineTo(-R * 0.12, -R * 0.9);
      g.bezierCurveTo(-R * 0.75, -R * 0.75, -R * 0.9, R * 0.5, 0, R);
      const gr = g.createLinearGradient(0, R, 0, -R);
      gr.addColorStop(0, c2); gr.addColorStop(0.35, c1); gr.addColorStop(1, c0);
      g.fillStyle = gr; g.fill();
    }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function padTexture(renderer) {
  return bakeTexture(renderer, 1024, /* glsl */`
    void main(){
      vec2 p = vUv * 2. - 1.;
      float r = length(p), a = atan(p.y, p.x);
      float veins = pow(abs(sin(a * 13. + fbm(vUv * 6., 6., 2, .5) * 0.8)), 42.) * smoothstep(0.06, 0.35, r) * (1. - smoothstep(0.85, 0.98, r));
      float n = fbm(vUv * 7., 7., 5, .55);
      float n2 = fbm(vUv * 2.5 + 3.1, 2.5, 4, .5);
      vec3 base = mix(vec3(0.035, 0.085, 0.022), vec3(0.09, 0.17, 0.04), n * .5 + .5);
      base = mix(base, vec3(0.12, 0.2, 0.05), smoothstep(0.15, 0.0, r) * 0.7);
      base = mix(base, base * 1.55, veins * 0.6);
      base = mix(base, vec3(0.16, 0.08, 0.04), smoothstep(0.86, 0.99, r) * 0.75);
      base = mix(base, vec3(0.2, 0.17, 0.05), smoothstep(0.25, 0.5, n2) * 0.25);
      gl_FragColor = vec4(base, 1.);
    }`);
}

function padGeometry() {
  const g = new THREE.CircleGeometry(0.5, 64, 0.22, Math.PI * 2 - 0.44);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z) * 2;
    p.setY(i, Math.pow(r, 6) * 0.03 + Math.sin(Math.atan2(z, x) * 7) * 0.004 * r);
  }
  g.computeVertexNormals();
  return g;
}

function leafGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 8, 8);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, (x * x + z * z) * 0.16 + Math.sin(x * 3) * 0.02); }
  g.computeVertexNormals();
  return g;
}

// ─── The floating world ────────────────────────────────────────────────────────
export class Flora {
  constructor({ renderer, scene, under, lotusGltf, sim }) {
    this.scene = scene; this.under = under; this.sim = sim;
    this.season = { leaves: 50, petals: 0, slots: [0, 1, 2, 2, 3], snow: 0 };
    // Lotus flowers with their pads
    const src = lotusGltf.scene;
    this.lotus = [];
    const lotusSpots = [[2.45, 1.3, 0.6, 0.4], [3.3, 2.2, 0.52, 2.1], [4.6, -0.3, 0.62, 1.0], [-4.1, 1.7, 0.66, 1.2], [-1.7, 7.2, 0.6, 3.3]];
    const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    for (const [x, z, s, r] of lotusSpots) {
      const m = src.clone(true);
      m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const holder = new THREE.Group();
      holder.add(m);
      holder.position.set(x, 0.0, z); holder.rotation.y = r; holder.scale.setScalar(s);
      scene.add(holder);
      const proxy = holder.clone(true);
      proxy.traverse(o => { if (o.isMesh) { o.material = proxyMat; o.castShadow = true; } });
      under.add(proxy);
      this.lotus.push({ holder, proxy, x, z, r, s, bx: x, bz: z, vx: 0, vz: 0 });
    }
    // Pads without flowers, clustered around the lotus
    const padMat = patchFloat(new THREE.MeshStandardMaterial({ map: padTexture(renderer), roughness: 0.48, metalness: 0, envMapIntensity: 1.0, side: THREE.DoubleSide }), 'pad');
    const padGeo = padGeometry();
    const padSpots = [];
    let rs = 5; const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
    for (const [x, z] of lotusSpots) for (let k = 0; k < 7; k++) {
      const a = rnd() * 6.28, d = 0.38 + rnd() * 0.75;
      const s = 0.2 + rnd() * 0.22;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (pondSDF(px, pz) < -0.4 && Math.hypot(px - x, pz - z) > 0.33 && padSpots.every(p => Math.hypot(p[0] - px, p[1] - pz) > (p[2] + s) * 0.5)) padSpots.push([px, pz, s, rnd() * 6.28]);
    }
    this.pads = new THREE.InstancedMesh(padGeo, padMat, padSpots.length);
    this.pads.castShadow = true; this.pads.receiveShadow = true;
    this.padState = padSpots.map(([x, z, s, r]) => ({ x, z, s, r, bx: x, bz: z, vx: 0, vz: 0, spin: 0 }));
    scene.add(this.pads);
    this.padProxy = new THREE.InstancedMesh(padGeo, proxyMat, padSpots.length);
    this.padProxy.instanceMatrix = this.pads.instanceMatrix;
    this.padProxy.castShadow = true;
    under.add(this.padProxy);

    // Leaves and petals
    this.leafTex = leafAtlas();
    const leafMat = new THREE.MeshStandardMaterial({ map: this.leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55, metalness: 0, envMapIntensity: 0.9 });
    patchFloat(leafMat, 'leaf');
    const prevLeaf = leafMat.onBeforeCompile;
    leafMat.onBeforeCompile = (sh, r) => {
      prevLeaf(sh, r);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSlot;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = (vMapUv + vec2(mod(aSlot, 3.), 1. - floor(aSlot / 3.))) / vec2(3., 2.);');
    };
    this.LEAVES = 420;
    this.leafGeo = leafGeometry();
    this.leafSlot = new THREE.InstancedBufferAttribute(new Float32Array(this.LEAVES), 1);
    this.leafGeo.setAttribute('aSlot', this.leafSlot);
    this.leaves = new THREE.InstancedMesh(this.leafGeo, leafMat, this.LEAVES);
    this.leaves.castShadow = true; this.leaves.receiveShadow = true;
    this.leaves.frustumCulled = false;
    this.leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.leafTex, alphaTest: 0.5, side: THREE.DoubleSide });
    this.leafDepth.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSlot;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (vMapUv + vec2(mod(aSlot, 3.), 1. - floor(aSlot / 3.))) / vec2(3., 2.);\n#endif');
    };
    this.leaves.customDepthMaterial = this.leafDepth;
    scene.add(this.leaves);
    this.leafProxy = new THREE.InstancedMesh(this.leafGeo, proxyMat, this.LEAVES);
    this.leafProxy.instanceMatrix = this.leaves.instanceMatrix;
    this.leafProxy.castShadow = true; this.leafProxy.frustumCulled = false;
    this.leafProxy.customDepthMaterial = this.leafDepth;
    under.add(this.leafProxy);
    this.leafState = Array.from({ length: this.LEAVES }, () => ({ alive: false }));
    this.leafAcc = 0;

    // Food pellets
    this.PELLETS = 48;
    this.pellets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.017, 12, 8), patchFloat(new THREE.MeshStandardMaterial({ color: 0x6b4526, roughness: 0.62, envMapIntensity: 0.6 }), 'pellet'), this.PELLETS);
    this.pellets.castShadow = true; this.pellets.frustumCulled = false;
    this.pelletState = Array.from({ length: this.PELLETS }, () => ({ alive: false }));
    scene.add(this.pellets);

    // Splash droplets
    this.DROPS = 260;
    const dmat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.75, 1.8) });
    this.droplets = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), dmat, this.DROPS);
    this.droplets.frustumCulled = false;
    this.dropState = Array.from({ length: this.DROPS }, () => ({ alive: false }));
    scene.add(this.droplets);

    // Snow
    const SN = 2400, sp = new Float32Array(SN * 3), sd = new Float32Array(SN);
    for (let i = 0; i < SN; i++) { sp.set([(Math.random() - 0.5) * 16, Math.random() * 7, (Math.random() - 0.5) * 14 + 2], i * 3); sd[i] = Math.random(); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('seed', new THREE.BufferAttribute(sd, 1));
    this.snowMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uDpr: { value: 1 }, uCol: { value: new THREE.Color(1.3, 1.35, 1.45) } },
      vertexShader: /* glsl */`
        attribute float seed; uniform float uTime, uAmt, uDpr; varying float vA;
        void main(){
          vec3 p = position;
          float fall = 0.32 + seed * 0.3;
          p.y = mod(p.y - uTime * fall, 7.0);
          p.x += sin(uTime * 0.7 + seed * 30.) * 0.25; p.z += cos(uTime * 0.5 + seed * 17.) * 0.2;
          vA = step(seed, uAmt) * smoothstep(0.0, 0.25, p.y) * smoothstep(7.0, 6.0, p.y);
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (3.0 + seed * 4.5) * uDpr * (9.0 / -mv.z);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uCol; varying float vA;
        void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .15, d) * vA; if (a < .01) discard; gl_FragColor = vec4(uCol, a * .9); }`,
    });
    this.snow = new THREE.Points(sg, this.snowMat);
    this.snow.frustumCulled = false;
    scene.add(this.snow);

    // Fireflies over the water at dusk
    const FN = 90, fp = new Float32Array(FN * 3), fs = new Float32Array(FN);
    for (let i = 0; i < FN; i++) {
      const a = Math.random() * 6.28, r = Math.random();
      const cx = i % 3 === 0 ? 3.4 : i % 3 === 1 ? -2.6 : 0.8, cz = i % 3 === 0 ? -2.6 : i % 3 === 1 ? -1.8 : 2.0;
      fp.set([cx + Math.cos(a) * r * 3.2, 0.25 + Math.random() * 1.4, cz + Math.sin(a) * r * 2.6], i * 3); fs[i] = Math.random();
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    fg.setAttribute('seed', new THREE.BufferAttribute(fs, 1));
    this.fireMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uDpr: { value: 1 } },
      vertexShader: /* glsl */`
        attribute float seed; uniform float uTime, uAmt, uDpr; varying float vA;
        void main(){
          vec3 p = position;
          float t = uTime * (0.25 + seed * 0.2) + seed * 40.;
          p += vec3(sin(t * 1.3) * 0.35 + sin(t * 0.37) * 0.6, sin(t * 0.9 + seed * 9.) * 0.18, cos(t * 1.1) * 0.35 + cos(t * 0.29) * 0.6);
          float blink = pow(max(0., sin(uTime * (0.6 + seed * 0.9) + seed * 31.)), 6.);
          vA = blink * uAmt;
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (5. + seed * 5.) * uDpr * (3.0 / -mv.z) * (0.4 + blink * 0.6);
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .0, d); a = a * a; if (vA * a < .002) discard; gl_FragColor = vec4(vec3(2.4, 3.2, 1.1) * a * vA, 1.); }`,
    });
    this.fireflies = new THREE.Points(fg, this.fireMat);
    this.fireflies.frustumCulled = false;
    scene.add(this.fireflies);

    // Low mist that lies on the water at dawn
    this.mistMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uCol: { value: new THREE.Color(0.8, 0.82, 0.8) }, uNoise: { value: null }, uLayer: { value: 0 } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */`
        uniform sampler2D uNoise; uniform float uTime, uAmt, uLayer; uniform vec3 uCol; varying vec3 vW;
        void main(){
          vec2 q = vW.xz * 0.07 + vec2(uTime * 0.006, uTime * 0.0035) + uLayer * 0.37;
          float n = texture2D(uNoise, q).r * 0.65 + texture2D(uNoise, q * 2.3 - vec2(uTime * 0.009, 0.)).r * 0.35;
          float a = smoothstep(0.55, 0.95, n) * smoothstep(0.3, 0.7, texture2D(uNoise, q * 0.37 + 0.2).r) * uAmt * (0.42 - uLayer * 0.1);
          if (a < 0.003) discard;
          gl_FragColor = vec4(uCol, a);
        }`,
    });
    this.mist = [];
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(34, 34).rotateX(-Math.PI / 2), this.mistMat.clone());
      m.material.uniforms.uLayer.value = k;
      m.position.set(0, 0.06 + k * 0.16, 2);
      m.renderOrder = 2 + k;
      scene.add(m);
      this.mist.push(m);
    }

    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this.syncPads();
    for (let i = 0; i < 24; i++) this.spawnLeaf(true);
    for (let i = 0; i < 26; i++) this.spawnLeaf(true, { x: 0.4, z: 0.2, w: 5.2, h: 4.4 });
  }

  syncPads() {
    const { _m, _q, _e, _s, _p } = this;
    this.padState.forEach((p, i) => {
      _e.set(0, p.r, 0); _q.setFromEuler(_e); _s.setScalar(p.s * (this.padScale ?? 1)); _p.set(p.x, 0.004, p.z);
      this.pads.setMatrixAt(i, _m.compose(_p, _q, _s));
    });
    this.pads.instanceMatrix.needsUpdate = true;
  }

  spawnLeaf(onWater = false, near = null, kind = 'leaf') {
    const i = this.leafState.findIndex(l => !l.alive);
    if (i < 0) return;
    const slots = kind === 'petal' ? [5] : this.season.slots;
    const slot = slots[Math.floor(Math.random() * slots.length)];
    let x, z, tries = 0;
    do {
      x = near ? near.x + (Math.random() - 0.5) * near.w : (Math.random() - 0.5) * 14 - 0.5;
      z = near ? near.z + (Math.random() - 0.5) * near.h : (Math.random() - 0.5) * 10 + 2;
    } while (pondSDF(x, z) > -0.35 && ++tries < 30);
    const petal = slot === 5;
    this.leafSlot.setX(i, slot); this.leafSlot.needsUpdate = true;
    this.leafState[i] = {
      alive: true, x, z, y: onWater ? 0.012 : 1.2 + Math.random() * 2.8, vx: 0, vz: 0,
      rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 3, tilt: Math.random() * 6.28, flutter: 2 + Math.random() * 2,
      size: petal ? 0.042 + Math.random() * 0.02 : 0.085 + Math.random() * 0.06, landed: onWater, age: onWater ? Math.random() * 40 : 0,
      life: 60 + Math.random() * 60, sink: 0, petal,
    };
  }

  drop(x, z, n = 4, hooks) {
    for (let k = 0; k < n; k++) {
      const i = this.pelletState.findIndex(p => !p.alive);
      if (i < 0) break;
      const a = Math.random() * 6.28, d = k === 0 ? 0 : 0.05 + Math.random() * 0.16;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const delay = k * 0.06 + Math.random() * 0.05;
      this.pelletState[i] = { alive: true, x: px, z: pz, y: 1.2 + delay * 4, vy: -3.2, landed: false, t: 0, food: null, delay };
    }
  }

  splash(x, z, n = 10, power = 1) {
    for (let k = 0; k < n; k++) {
      const i = this.dropState.findIndex(d => !d.alive);
      if (i < 0) return;
      const a = Math.random() * 6.28, h = (0.25 + Math.random() * 0.75) * power;
      this.dropState[i] = { alive: true, x, z, y: 0.01, vx: Math.cos(a) * h * 0.55, vz: Math.sin(a) * h * 0.55, vy: (0.9 + Math.random() * 1.1) * power, r: 0.004 + Math.random() * 0.006 };
    }
  }

  update(dt, t, { school, pointer, hooks, view }) {
    const { _m, _q, _e, _s, _p } = this;
    // pads drift back to their anchors, pushed by the visitor's hand
    for (const p of this.padState) {
      if (pointer?.on) {
        const dx = p.x - pointer.x, dz = p.z - pointer.z, d = Math.hypot(dx, dz);
        if (d < p.s * 0.5 + 0.35) { p.vx += pointer.vx * dt * 0.8; p.vz += pointer.vz * dt * 0.8; p.spin += (pointer.vx * dz - pointer.vz * dx) * dt * 0.8; }
      }
      p.vx += (p.bx - p.x) * dt * 0.6; p.vz += (p.bz - p.z) * dt * 0.6;
      p.vx *= Math.exp(-dt * 1.5); p.vz *= Math.exp(-dt * 1.5); p.spin *= Math.exp(-dt * 1.2);
      p.x += p.vx * dt; p.z += p.vz * dt; p.r += p.spin * dt + Math.sin(t * 0.1 + p.bx) * 0.0006;
    }
    this.syncPads();
    for (const l of this.lotus) {
      if (pointer?.on) {
        const dx = l.x - pointer.x, dz = l.z - pointer.z, d = Math.hypot(dx, dz);
        if (d < l.s * 0.5 + 0.3) { l.vx += pointer.vx * dt * 0.6; l.vz += pointer.vz * dt * 0.6; }
      }
      l.vx += (l.bx - l.x) * dt * 0.5; l.vz += (l.bz - l.z) * dt * 0.5;
      l.vx *= Math.exp(-dt * 1.4); l.vz *= Math.exp(-dt * 1.4);
      l.x += l.vx * dt; l.z += l.vz * dt;
      l.holder.position.set(l.x, 0, l.z);
      l.holder.rotation.y = l.r + Math.sin(t * 0.13 + l.bx) * 0.08;
      l.proxy.position.copy(l.holder.position); l.proxy.rotation.copy(l.holder.rotation);
    }

    // leaves and petals: keep the view stocked to the season's taste, let the out-of-season ones sink
    let nLeaf = 0, nPetal = 0;
    const R2 = (view.w * 0.75) ** 2;
    for (const l of this.leafState) {
      if (!l.alive || l.sink) continue;
      const d2 = (l.x - view.x) ** 2 + (l.z - view.z) ** 2;
      if (d2 > R2) { if (l.landed && l.life - l.age > 12) l.life = l.age + 4 + Math.random() * 8; continue; }
      l.petal ? nPetal++ : nLeaf++;
    }
    const want = [[this.season.leaves, nLeaf, 'leaf'], [this.season.petals, nPetal, 'petal']];
    for (const [target, n, kind] of want) {
      const deficit = target - n;
      if (deficit > 0) {
        const rate = Math.min(40, 0.25 + deficit * 0.18);
        this[kind + 'Acc'] = (this[kind + 'Acc'] ?? 0) + dt * rate;
        while (this[kind + 'Acc'] > 1) { this[kind + 'Acc'] -= 1; this.spawnLeaf(false, view, kind); }
      } else if (deficit < -8) {
        // thin the surplus: the oldest on-screen ones slowly sink
        let k = Math.min(6, -deficit - 8);
        for (const l of this.leafState) {
          if (!k) break;
          if (l.alive && l.landed && !l.sink && (kind === 'petal') === !!l.petal && l.life - l.age > 6) { l.life = l.age + 1 + Math.random() * 5; k--; }
        }
      }
    }
    let alive = 0;
    for (let i = 0; i < this.LEAVES; i++) {
      const l = this.leafState[i];
      if (!l.alive) { this.leaves.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
      alive++;
      if (!l.landed) {
        l.y -= dt * (l.petal ? 0.5 : 0.75) * (0.8 + Math.sin(t * l.flutter + i) * 0.4);
        l.x += Math.sin(t * 0.9 + i) * dt * 0.25 + dt * 0.08; l.z += Math.cos(t * 0.7 + i * 1.3) * dt * 0.2;
        l.tilt += dt * l.flutter; l.rot += l.spin * dt;
        if (l.y <= 0.012) {
          l.y = 0.012; l.landed = true;
          if (pondSDF(l.x, l.z) < -0.1) { hooks.leafLand?.(l); } else { l.sink = 1; }
        }
      } else {
        l.age += dt;
        const drift = 0.018;
        l.vx += (Math.sin(t * 0.05 + l.z * 0.3) * drift - l.vx) * dt * 0.3;
        l.vz += (Math.cos(t * 0.04 + l.x * 0.3) * drift - l.vz) * dt * 0.3;
        if (pointer?.on) {
          const dx = l.x - pointer.x, dz = l.z - pointer.z, d2 = dx * dx + dz * dz;
          if (d2 < 0.16) { const k = (1 - Math.sqrt(d2) / 0.4); l.vx += pointer.vx * k * dt * 2.2; l.vz += pointer.vz * k * dt * 2.2; l.spin += (Math.random() - 0.5) * k * pointer.speed * dt * 10; }
        }
        for (const f of school.fish) { // koi nosing up under a leaf push it aside
          if (f.y > -0.18) { const dx = l.x - f.x, dz = l.z - f.z, d2 = dx * dx + dz * dz; if (d2 < 0.05) { l.vx += dx * dt * 3; l.vz += dz * dt * 3; } }
        }
        const sdf = pondSDF(l.x, l.z);
        if (sdf > -0.15) { l.vx -= (l.x - 0.2) * dt * 0.02; l.vz -= (l.z - 2.2) * dt * 0.02; }
        l.vx *= Math.exp(-dt * 0.9); l.vz *= Math.exp(-dt * 0.9);
        l.x += l.vx * dt; l.z += l.vz * dt;
        l.spin *= Math.exp(-dt * 0.8); l.rot += l.spin * dt;
        if (l.age > l.life && !l.sink) l.sink = 0.001;
        if (l.sink) { l.sink += dt * 0.25; l.y = 0.012 - l.sink * 0.06; if (l.sink > 1) { l.alive = false; continue; } }
      }
      const fallTilt = l.landed ? 0 : Math.sin(l.tilt) * 0.9;
      _e.set(fallTilt, l.rot, l.landed ? 0 : Math.cos(l.tilt * 0.7) * 0.6, 'YXZ');
      _q.setFromEuler(_e); _s.setScalar(l.size * (l.sink ? 1 - l.sink * 0.4 : 1)); _p.set(l.x, l.y, l.z);
      this.leaves.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.leaves.instanceMatrix.needsUpdate = true;

    // pellets
    for (let i = 0; i < this.PELLETS; i++) {
      const p = this.pelletState[i];
      if (!p.alive) { this.pellets.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
      p.t += dt;
      if (!p.landed) {
        if (p.t < p.delay) { this.pellets.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
        p.y += p.vy * dt; p.vy -= 9.8 * dt;
        if (p.y <= 0.008) { p.y = 0.008; p.landed = true; p.food = { x: p.x, z: p.z, t, eaten: false, pellet: p }; school.food.push(p.food); hooks.pelletLand?.(p); }
      } else {
        p.x += Math.sin(t * 0.3 + i) * dt * 0.01; p.z += Math.cos(t * 0.27 + i) * dt * 0.01;
        p.food.x = p.x; p.food.z = p.z;
        if (p.food.eaten) { p.alive = false; school.food.splice(school.food.indexOf(p.food), 1); this.pellets.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
        if (p.t > 40) { p.food.eaten = true; }
      }
      _p.set(p.x, p.y, p.z); this.pellets.setMatrixAt(i, _m.compose(_p, _q.identity(), _s.setScalar(1)));
    }
    this.pellets.instanceMatrix.needsUpdate = true;

    // droplets
    for (let i = 0; i < this.DROPS; i++) {
      const d = this.dropState[i];
      if (!d.alive) { this.droplets.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
      d.vy -= 9.8 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.y < 0) { d.alive = false; hooks.dropletLand?.(d); this.droplets.setMatrixAt(i, _m.makeScale(0, 0, 0)); continue; }
      _p.set(d.x, d.y, d.z); this.droplets.setMatrixAt(i, _m.compose(_p, _q.identity(), _s.setScalar(d.r)));
    }
    this.droplets.instanceMatrix.needsUpdate = true;

    for (const m of this.mist) { m.material.uniforms.uTime.value = t; m.visible = m.material.uniforms.uAmt.value > 0.005; }
    this.fireMat.uniforms.uTime.value = t;
    this.fireflies.visible = this.fireMat.uniforms.uAmt.value > 0.01;
    this.snowMat.uniforms.uTime.value = t;
    this.snowMat.uniforms.uAmt.value = this.season.snow;
    this.snow.visible = this.season.snow > 0.01;
    return alive;
  }
}
