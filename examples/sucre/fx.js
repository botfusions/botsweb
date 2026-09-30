// Small tactile effects: icing-sugar puffs and gold-leaf flakes (one GPU particle pool),
// ripples on the marble when you knock, and the fingertip mark that shows where the cursor touches the counter.
import { THREE } from '../../src/core/engine.js';

export class Dust {
  constructor(scene, N = 4000) {
    this.N = N; this.head = 0;
    const geo = new THREE.BufferGeometry();
    this.aOrigin = new THREE.BufferAttribute(new Float32Array(N * 3).fill(-999), 3);
    this.aVel = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
    this.aInfo = new THREE.BufferAttribute(new Float32Array(N * 4).fill(-99), 4); // birth, life, size, seed
    this.aCol = new THREE.BufferAttribute(new Float32Array(N * 4), 4);           // rgb, gravity
    for (const a of [this.aOrigin, this.aVel, this.aInfo, this.aCol]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aOrigin);
    geo.setAttribute('aVel', this.aVel);
    geo.setAttribute('aInfo', this.aInfo);
    geo.setAttribute('aCol', this.aCol);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uScale: { value: 800 } },
      vertexShader: /* glsl */`
        attribute vec3 aVel; attribute vec4 aInfo; attribute vec4 aCol;
        uniform float uTime, uScale;
        varying float vA; varying vec3 vC; varying float vSeed; varying float vFlake;
        void main(){
          float age = uTime - aInfo.x;
          float life = aInfo.y;
          float k = clamp(age / life, 0.0, 1.0);
          vFlake = step(1.5, aCol.w);
          float drag = mix(3.2, 1.3, vFlake);
          vec3 p = position + aVel * (1.0 - exp(-drag * age)) / drag;
          p.y -= aCol.w * age * age * 0.5;
          p.y = max(p.y, 0.012);
          if (vFlake > 0.5) { p.x += sin(age * 7.0 + aInfo.w * 30.0) * 0.08 * k; p.z += cos(age * 6.0 + aInfo.w * 17.0) * 0.08 * k; }
          vA = (age < 0.0 || age > life) ? 0.0 : smoothstep(0.0, 0.06, k) * (1.0 - smoothstep(0.35, 1.0, k));
          if (vFlake > 0.5) vA = (age < 0.0 || age > life) ? 0.0 : (1.0 - smoothstep(0.7, 1.0, k)) * (0.55 + 0.45 * sin(age * 18.0 + aInfo.w * 40.0));
          vC = aCol.rgb; vSeed = aInfo.w;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float sz = aInfo.z * mix(1.0, 2.6, vFlake > 0.5 ? 0.0 : sqrt(k));
          gl_PointSize = vA > 0.0 ? sz * uScale / -mv.z : 0.0;
        }`,
      fragmentShader: /* glsl */`
        varying float vA; varying vec3 vC; varying float vSeed; varying float vFlake;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          float a;
          if (vFlake > 0.5) { a = step(abs(d.x) + abs(d.y) * 1.6, 0.42); }
          else { a = exp(-r * r * 16.0) * (0.75 + 0.25 * fract(sin(dot(floor(gl_PointCoord * 5.0), vec2(12.9, 78.2)) + vSeed) * 4375.5)); }
          if (a * vA < 0.01) discard;
          gl_FragColor = vec4(vC, a * vA * (vFlake > 0.5 ? 1.0 : 0.55));
        }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.dirty = false;
  }

  emit(p, n, { spread = 0.25, speed = 2.2, up = 1.1, life = 1.4, size = 0.1, color = [1, 0.985, 0.975], gravity = 0.25, time }) {
    for (let j = 0; j < n; j++) {
      const i = this.head; this.head = (this.head + 1) % this.N;
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      this.aOrigin.setXYZ(i, p.x + Math.cos(a) * r, p.y + Math.random() * 0.05, p.z + Math.sin(a) * r);
      const s = speed * (0.35 + Math.random() * 0.65);
      this.aVel.setXYZ(i, Math.cos(a) * s, up * (0.3 + Math.random()), Math.sin(a) * s);
      this.aInfo.setXYZW(i, time + Math.random() * 0.03, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), Math.random());
      const c = Array.isArray(color[0]) ? color[(Math.random() * color.length) | 0] : color;
      this.aCol.setXYZW(i, c[0], c[1], c[2], gravity);
    }
    this.dirty = true;
  }

  update(t, h, fov) {
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uScale.value = h / (2 * Math.tan(fov * Math.PI / 360));
    if (this.dirty) {
      for (const a of [this.aOrigin, this.aVel, this.aInfo, this.aCol]) a.needsUpdate = true;
      this.dirty = false;
    }
  }
}

/** Flat marks on the marble: expanding knock ripples and the fingertip ring. */
export class Marks {
  constructor(scene) {
    const ringMat = (color, mode) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      uniforms: { uR: { value: 0.3 }, uW: { value: 0.03 }, uA: { value: 0 }, uFill: { value: 0 }, uC: { value: new THREE.Color(color) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uR, uW, uA, uFill; uniform vec3 uC; varying vec2 vUv;
        void main(){ float r = length(vUv); float ring = exp(-pow((r - uR) / uW, 2.0)); float fill = smoothstep(uR, uR * 0.2, r) * uFill;
          float a = (ring + fill) * uA * smoothstep(1.0, 0.92, r); if (a < 0.003) discard; gl_FragColor = vec4(uC, a); }`,
    });
    this.tip = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), ringMat(0x45202b));
    this.tip.rotation.x = -Math.PI / 2;
    this.tip.renderOrder = 4;
    this.tip.material.uniforms.uR.value = 0.26; // in uv units of the 0.8 half-size plane
    scene.add(this.tip);
    this.ripples = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), ringMat(0x6d3a47));
      m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 4;
      scene.add(m);
      this.ripples.push({ m, t: 1e9 });
    }
    this.k = 0;
    this.tipA = 0; this.tipTarget = 0; this.tipPress = 0;
  }

  ripple(p, t) {
    const r = this.ripples[this.k++ % this.ripples.length];
    r.m.position.set(p.x, 0.006, p.z); r.m.visible = true; r.t = t;
  }

  tipAt(p, visible, pressed, dt) {
    this.tipTarget = visible ? 1 : 0;
    this.tipA += (this.tipTarget - this.tipA) * (1 - Math.exp(-10 * dt));
    this.tipPress += ((pressed ? 1 : 0) - this.tipPress) * (1 - Math.exp(-14 * dt));
    if (p) this.tip.position.set(p.x, 0.005, p.z);
    const u = this.tip.material.uniforms;
    u.uA.value = this.tipA * 0.42;
    u.uR.value = 0.44 - this.tipPress * 0.1;
    u.uW.value = 0.018 + this.tipPress * 0.01;
    u.uFill.value = 0.12 + this.tipPress * 0.2;
    this.tip.visible = this.tipA > 0.01;
  }

  update(t) {
    for (const r of this.ripples) {
      if (!r.m.visible) continue;
      const age = t - r.t;
      if (age > 0.6) { r.m.visible = false; continue; }
      const u = r.m.material.uniforms;
      u.uR.value = 0.02 + age * 1.6;   // ≈ the speed of the impulse wave (8 units/s on a 10-unit plane)
      u.uW.value = 0.012 + age * 0.05;
      u.uA.value = 0.34 * (1 - age / 0.6) ** 1.3;
    }
  }
}
