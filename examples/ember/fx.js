// Particles and screen effects: strike sparks (GPU, analytic ballistics with a floor bounce), forge embers,
// quench steam, and a heat-haze / shockwave UV distortion effect for the post stack.
import * as THREE from 'three';
import { Effect } from 'postprocessing';
import { NOISE, BLACKBODY } from './glsl.js';

const rnd = (a, b) => a + Math.random() * (b - a);

// ─── Sparks ─────────────────────────────────────────────────────────────────────
export class Sparks {
  constructor({ max = 2400, floor = 0 } = {}) {
    this.max = max; this.head = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aO = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aV = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aT = new THREE.InstancedBufferAttribute(new Float32Array(max * 4).fill(-100), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aO', this.aO); g.setAttribute('aV', this.aV); g.setAttribute('aT', this.aT);
    g.instanceCount = max;
    this.uniforms = { uTime: { value: 0 }, uFloor: { value: floor }, uRes: { value: new THREE.Vector2(1, 1) }, uDpr: { value: 1 }, uGain: { value: 1 } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        attribute vec3 aO; attribute vec3 aV; attribute vec4 aT;
        uniform float uTime, uFloor, uDpr, uGain; uniform vec2 uRes;
        varying vec3 vCol; varying vec2 vQ;
        ${BLACKBODY}
        vec3 motion(vec3 p0, vec3 v0, float k, float t, out vec3 v){
          float e = exp(-k * t);
          vec3 vt = vec3(0.0, -9.8 / k, 0.0);
          v = (v0 - vt) * e + vt;
          return p0 + (v0 - vt) * (1.0 - e) / k + vt * t;
        }
        void main(){
          float age = uTime - aT.x, life = aT.y, seed = aT.z, kind = aT.w;
          if (age < 0.0 || age > life){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float k = kind > 0.5 ? mix(2.6, 4.0, fract(seed * 7.1)) : mix(0.5, 1.6, fract(seed * 13.7));
          vec3 v; vec3 p = motion(aO, aV, k, age, v);
          if (p.y < uFloor){
            float a = 0.0, b = age; vec3 tv;
            for (int i = 0; i < 12; i++){ float m = 0.5 * (a + b); if (motion(aO, aV, k, m, tv).y < uFloor) b = m; else a = m; }
            vec3 vh; vec3 ph = motion(aO, aV, k, a, vh);
            vec3 v1 = vec3(vh.x * 0.6, -vh.y * mix(0.18, 0.42, fract(seed * 3.3)), vh.z * 0.6);
            p = motion(vec3(ph.x, uFloor + 0.001, ph.z), v1, k * 1.7, age - a, v);
            if (p.y < uFloor){ p.y = uFloor + 0.002; v = vec3(v.x, 0.0, v.z) * 0.25; }
          }
          float f = age / life;
          float K = kind > 0.5 ? mix(1450.0, 760.0, pow(f, 0.7)) : mix(2350.0, 820.0, pow(f, 0.55));
          float fade = 1.0 - smoothstep(0.72, 1.0, f);
          vCol = blackbody(K) * glowPower(K) * (kind > 0.5 ? 5.0 : 7.0) * fade * uGain;
          float stretch = kind > 0.5 ? 0.006 : mix(0.008, 0.02, fract(seed * 5.3));
          vec4 cH = projectionMatrix * viewMatrix * vec4(p, 1.0);
          vec4 cT = projectionMatrix * viewMatrix * vec4(p - v * stretch, 1.0);
          vec2 sH = cH.xy / cH.w * uRes * 0.5, sT = cT.xy / cT.w * uRes * 0.5;
          vec2 dir = sH - sT; float len = length(dir);
          dir = len > 0.001 ? dir / len : vec2(1.0, 0.0);
          vec2 perp = vec2(-dir.y, dir.x);
          float w = (kind > 0.5 ? mix(1.1, 2.2, fract(seed * 17.0)) : mix(0.55, 1.1, fract(seed * 23.0))) * uDpr * clamp(1.6 / cH.w, 0.6, 3.0);
          vec4 c = mix(cH, cT, position.x);
          vec2 extra = dir * (1.0 - position.x * 2.0) * w * 0.7; // round the ends a little
          c.xy += (perp * position.y * w + extra) / (uRes * 0.5) * c.w;
          vQ = position.xy;
          gl_Position = c;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vCol; varying vec2 vQ;
        void main(){
          float across = 1.0 - vQ.y * vQ.y;
          float along = mix(1.0, 0.15, vQ.x);
          gl_FragColor = vec4(vCol * across * across * along, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** Burst from a point. `dir` biases the spray; `power` 0..1 scales count and speed. */
  burst(p, { count = 400, power = 1, time, spread = 1, up = 1, flakes = 40 } = {}) {
    for (let i = 0; i < count + flakes; i++) {
      const flake = i >= count;
      const k = this.head++ % this.max;
      const a = Math.random() * Math.PI * 2;
      const sp = (flake ? rnd(0.5, 1.6) : Math.pow(Math.random(), 0.8) * rnd(1.4, 4.6)) * (0.55 + power * 0.55);
      const el = flake ? rnd(0.3, 1.0) : rnd(0.05, 0.75) * up; // mostly squeezed out sideways by the hammer face
      const h = Math.cos(Math.asin(Math.min(el, 0.99)));
      this.aO.setXYZ(k, p.x + rnd(-0.02, 0.02), p.y + 0.01, p.z + rnd(-0.015, 0.015));
      this.aV.setXYZ(k, Math.cos(a) * h * sp * spread, el * sp + (flake ? 0.5 : 0.4), Math.sin(a) * h * sp * spread * 0.8);
      this.aT.setXYZW(k, time + rnd(0, 0.035), flake ? rnd(0.7, 1.6) : rnd(0.5, 1.9), Math.random(), flake ? 1 : 0);
    }
    this.aO.needsUpdate = this.aV.needsUpdate = this.aT.needsUpdate = true;
  }

  /** A few lazy pops off hot scale. */
  pop(p, time, n = 2) {
    for (let i = 0; i < n; i++) {
      const k = this.head++ % this.max;
      this.aO.setXYZ(k, p.x, p.y, p.z);
      this.aV.setXYZ(k, rnd(-0.5, 0.5), rnd(0.6, 1.8), rnd(-0.4, 0.4));
      this.aT.setXYZW(k, time, rnd(0.4, 1.0), Math.random(), Math.random() < 0.5 ? 1 : 0);
    }
    this.aO.needsUpdate = this.aV.needsUpdate = this.aT.needsUpdate = true;
  }

  resize(w, h, dpr) { this.uniforms.uRes.value.set(w * dpr, h * dpr); this.uniforms.uDpr.value = dpr; }
}

// ─── Embers ─────────────────────────────────────────────────────────────────────
// Forge embers rise out of the fire pot and drift into the room; ambient motes hang in the air.
export class Embers {
  constructor({ count = 1400, forge, room, drift }) {
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i++) seed[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.uniforms = {
      uClock: { value: 0 }, uTime: { value: 0 }, uDpr: { value: 1 }, uBellows: { value: 0 }, uFire: { value: 1 },
      uForge: { value: forge.clone() }, uRoomMin: { value: room.min.clone() }, uRoomMax: { value: room.max.clone() },
      uDrift: { value: drift.clone() }, uGain: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute vec4 aSeed;
        uniform float uClock, uTime, uDpr, uBellows, uFire, uGain; uniform vec3 uForge, uRoomMin, uRoomMax, uDrift;
        varying vec3 vCol; varying float vA;
        ${BLACKBODY}
        void main(){
          vec3 p; float a; float K; float size;
          float kind = aSeed.w;
          if (kind < 0.7){
            // forge ember (0.55..0.7 only fly while the bellows blow)
            float roar = step(0.4, kind);
            float life = mix(2.2, 6.5, aSeed.x);
            float spd = 0.8 + aSeed.y * 0.5;
            float t = mod(uClock * spd + aSeed.z * life * 7.0, life);
            float f = t / life;
            float ang = aSeed.x * 6.2831 + aSeed.w * 51.0;
            float r = sqrt(fract(aSeed.y * 7.7)) * (0.3 + roar * 0.05);
            vec3 o = uForge + vec3(cos(ang) * r, 0.0, sin(ang) * r * 0.75);
            float rise = t * mix(0.3, 0.75, aSeed.z) * (1.0 + roar * 1.6);
            p = o + vec3(0.0, rise, 0.0);
            float sw = 0.04 + rise * 0.22;
            p.x += sin(t * 1.9 + aSeed.x * 21.0) * sw + sin(t * 4.3 + aSeed.z * 9.0) * 0.03;
            p.z += cos(t * 1.4 + aSeed.y * 17.0) * sw;
            p += uDrift * rise * rise * mix(0.25, 0.9, aSeed.w);
            a = smoothstep(0.0, 0.05, f) * (1.0 - smoothstep(0.35, 1.0, f));
            a *= 0.55 + 0.45 * sin(uTime * (9.0 + aSeed.x * 13.0) + aSeed.y * 40.0);
            a *= mix(1.0, uBellows * 1.6, roar) * (0.6 + uFire * 0.4 + uBellows * 0.6);
            K = mix(1500.0, 900.0, f) + uBellows * 150.0;
            size = mix(1.2, 2.8, aSeed.z) * (1.0 + roar * 0.4);
          } else {
            // ambient mote drifting in the smoky air
            vec3 span = uRoomMax - uRoomMin;
            vec3 q = vec3(fract(aSeed.x * 3.1), fract(aSeed.y * 5.3), fract(aSeed.z * 7.7));
            p = uRoomMin + q * span;
            p.y = uRoomMin.y + mod(q.y * span.y + uTime * mix(0.02, 0.07, aSeed.x), span.y);
            p.x += sin(uTime * 0.21 + aSeed.y * 30.0) * 0.25;
            p.z += cos(uTime * 0.17 + aSeed.x * 20.0) * 0.25;
            float edge = smoothstep(0.0, 0.15, (p.y - uRoomMin.y) / span.y) * (1.0 - smoothstep(0.8, 1.0, (p.y - uRoomMin.y) / span.y));
            a = edge * (0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (0.8 + aSeed.w) + aSeed.z * 30.0), 3.0)) * 0.45;
            K = mix(1050.0, 1350.0, aSeed.y);
            size = mix(0.9, 2.2, aSeed.x);
          }
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          gl_PointSize = size * 1.35 * uDpr * clamp(3.2 / dist, 0.6, 9.0);
          // big out-of-focus motes near the lens get dimmer per pixel
          a /= 1.0 + max(0.0, 1.2 - dist) * 2.0;
          vA = a * uGain;
          vCol = blackbody(K) * (glowPower(K) * 22.0 + 0.4);
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vCol; varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float s = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vCol * s * s * vA, 1.0);
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }
}

// ─── Steam ──────────────────────────────────────────────────────────────────────
export class Steam {
  constructor({ max = 220, puff }) {
    this.max = max; this.head = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aP = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aV = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aT = new THREE.InstancedBufferAttribute(new Float32Array(max * 4).fill(-100), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aP', this.aP); g.setAttribute('aV', this.aV); g.setAttribute('aT', this.aT);
    g.instanceCount = max;
    this.uniforms = {
      uTime: { value: 0 }, uPuff: { value: puff }, uGlow: { value: new THREE.Color(0, 0, 0) }, uWater: { value: 0.5 },
      uAmb: { value: new THREE.Color(0.035, 0.037, 0.042) }, uFire: { value: new THREE.Color(0.12, 0.05, 0.02) }, uMoon: { value: new THREE.Color(0.12, 0.125, 0.14) }, uOpacity: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: /* glsl */`
        attribute vec3 aP; attribute vec3 aV; attribute vec4 aT;
        uniform float uTime, uWater;
        varying vec2 vUv; varying float vA; varying float vH; varying float vRot; varying float vSeed;
        void main(){
          float age = uTime - aT.x, life = aT.y;
          if (age < 0.0 || age > life){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float f = age / life;
          vec3 p = aP + aV * (1.0 - exp(-age * 1.6)) / 1.6 + vec3(0.0, 0.16 * age * age, 0.0);
          p.x += sin(age * 1.3 + aT.w * 30.0) * 0.06 * age;
          p.z += cos(age * 1.1 + aT.w * 20.0) * 0.05 * age;
          float size = aT.z * (0.3 + 1.6 * sqrt(f));
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float rot = aT.w * 6.28 + age * (fract(aT.w * 9.1) - 0.5) * 0.8;
          vec2 c = position.xy; float cs = cos(rot), sn = sin(rot);
          mv.xy += vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
          gl_Position = projectionMatrix * mv;
          vUv = position.xy * 0.5 + 0.5;
          vA = smoothstep(0.0, 0.12, f) * (1.0 - smoothstep(0.35, 1.0, f)) * smoothstep(0.05, 0.4, -mv.z);
          vH = p.y - uWater; vRot = rot; vSeed = aT.w;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uPuff; uniform vec3 uGlow, uAmb, uFire, uMoon; uniform float uOpacity, uTime;
        varying vec2 vUv; varying float vA; varying float vH; varying float vSeed;
        void main(){
          vec2 q = vUv + vec2(vSeed * 0.37, vSeed * 0.71);
          float n = texture2D(uPuff, q * 0.9 + vec2(0.0, -uTime * 0.03)).r;
          float r = length(vUv - 0.5) * 2.0;
          float n2 = texture2D(uPuff, q * 2.3 + vec2(uTime * 0.05, -uTime * 0.09)).r;
          float m = smoothstep(0.35, 0.95, (n * 0.7 + n2 * 0.45) * (1.2 - r * r));
          float a = m * vA * uOpacity * 0.2;
          vec3 col = uAmb + uFire * 0.35 + uMoon * (0.5 + n * 1.1) + uGlow * exp(-max(vH, 0.0) * 2.4) * (0.35 + (1.0 - r) * 0.65);
          gl_FragColor = vec4(col * a, a);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  emit(p, time, { spread = 0.05, vel = 0.5, size = 0.18, life = 3.2 } = {}) {
    const k = this.head++ % this.max;
    this.aP.setXYZ(k, p.x + rnd(-spread, spread), p.y, p.z + rnd(-spread, spread) * 0.6);
    this.aV.setXYZ(k, rnd(-0.2, 0.2), vel * rnd(0.6, 1.3), rnd(-0.15, 0.15));
    this.aT.setXYZW(k, time, life * rnd(0.7, 1.3), size * rnd(0.7, 1.35), Math.random());
    this.aP.needsUpdate = this.aV.needsUpdate = this.aT.needsUpdate = true;
  }
}

// ─── Heat haze ──────────────────────────────────────────────────────────────────
const hazeFrag = /* glsl */`
uniform vec3 uPts[8];
uniform float uHazeTime, uStrength, uAsp;
uniform vec4 uShock;
${'' /* value noise for the refraction field */}
float hz_h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float hz_n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hz_h(i), hz_h(i + vec2(1, 0)), f.x), mix(hz_h(i + vec2(0, 1)), hz_h(i + vec2(1, 1)), f.x), f.y); }
void mainUv(inout vec2 uv){
  float m = 0.0;
  for (int i = 0; i < 8; i++){
    vec2 d = uv - uPts[i].xy; d.x *= uAsp;
    float w = exp(-d.x * d.x / 0.0035) * smoothstep(-0.03, 0.04, d.y) * exp(-max(d.y, 0.0) / 0.2);
    m += uPts[i].z * w;
  }
  m = min(m, 1.4) * uStrength;
  if (m > 0.001){
    vec2 q = vec2(uv.x * uAsp, uv.y) * 38.0 + vec2(0.0, -uHazeTime * 3.1);
    vec2 off = vec2(hz_n(q) - 0.5, hz_n(q * 1.13 + 17.0 + vec2(0.0, uHazeTime * 0.7)) - 0.5);
    off += 0.5 * vec2(hz_n(q * 2.1 + 5.0) - 0.5, hz_n(q * 2.3 + 9.0) - 0.5);
    uv += off * m * 0.009;
  }
  if (uShock.w > 0.001){
    vec2 d = (uv - uShock.xy) * vec2(uAsp, 1.0);
    float r = length(d) + 1e-5;
    float ring = uShock.z;
    float w = exp(-pow((r - ring) / 0.03, 2.0));
    uv -= (d / r) * w * uShock.w * 0.014 / vec2(uAsp, 1.0);
  }
}`;
export class HeatHaze extends Effect {
  constructor() {
    super('HeatHaze', hazeFrag, {
      uniforms: new Map([
        ['uPts', new THREE.Uniform(Array.from({ length: 8 }, () => new THREE.Vector3()))],
        ['uHazeTime', new THREE.Uniform(0)],
        ['uStrength', new THREE.Uniform(1)],
        ['uAsp', new THREE.Uniform(1.6)],
        ['uShock', new THREE.Uniform(new THREE.Vector4())],
      ]),
    });
  }
}

/** A soft cloud puff texture for steam. */
export function puffTexture(bake, renderer) {
  return bake(renderer, 256, `
    void main(){
      float n = fbm(vUv * 5.0, 5.0, 7, 0.58) * 0.5 + 0.5;
      float b = 1.0 - abs(fbm(vUv * 3.0 + 1.7, 3.0, 5, 0.5));
      gl_FragColor = vec4(vec3(clamp(n * 0.75 + b * b * 0.45 - 0.1, 0.0, 1.0)), 1.0);
    }`);
}

export { NOISE };
