// Hangar Nine — effects: mech hologram/scan/visor shader patch, scan sheet, steam, weld sparks, dust in beams.
import * as THREE from 'three';

// ─── Mech material patch ────────────────────────────────────────────────────────
export function mechUniforms() {
  return {
    uScanY: { value: -10 }, uHolo: { value: 0 }, uBand: { value: 0 }, uHoloCol: { value: new THREE.Color(0.28, 0.9, 1.0) },
    uFocus: { value: new THREE.Vector4(0, 0, 0, 1) }, uFocusAmt: { value: 0 }, uFocusCol: { value: new THREE.Color(0.28, 0.9, 1.0) },
    uVisor: { value: 0 }, uVisorPos: { value: new THREE.Vector3(0, 10, 1) }, uVisorR: { value: 1.2 },
    uXray: { value: 0 }, uTime: { value: 0 },
  };
}

export function patchMech(mat, U) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMW; varying vec3 vMN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvMW = (modelMatrix * vec4(transformed, 1.0)).xyz; vMN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vMW; varying vec3 vMN;
        uniform float uScanY, uHolo, uBand, uVisor, uVisorR, uFocusAmt, uXray, uTime;
        uniform vec3 uHoloCol, uFocusCol, uVisorPos; uniform vec4 uFocus;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 mechAlbedo = diffuseColor.rgb;
        diffuseColor.rgb *= 1.0 - uXray * 0.55;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 hp = vMW;
          vec3 gq = hp / 0.34;
          vec3 fw = max(fwidth(gq), vec3(1e-4));
          vec3 d = abs(fract(gq - 0.5) - 0.5) / fw;
          vec3 L = 1.0 - clamp(d / 1.15, 0.0, 1.0);
          vec3 an = abs(normalize(vMN)); vec3 w = an * an * an * an; w /= (w.x + w.y + w.z + 1e-4);
          float grid = max(L.y, L.z) * w.x + max(L.x, L.z) * w.y + max(L.x, L.y) * w.z;
          grid *= clamp(1.4 - max(max(fw.x, fw.y), fw.z) * 2.2, 0.0, 1.0);
          vec3 V = normalize(vViewPosition);
          float fres = pow(1.0 - clamp(abs(dot(normal, V)), 0.0, 1.0), 2.6);
          float below = 1.0 - smoothstep(uScanY - 0.03, uScanY + 0.03, hp.y);
          float band = exp(-pow((hp.y - uScanY) * 2.4, 2.0));
          float trail = exp(-max(uScanY - hp.y, 0.0) * 0.28);
          float flick = 0.85 + 0.15 * sin(uTime * 31.0 + hp.y * 4.0);
          vec3 holo = uHoloCol * (uHolo * below * (grid * 1.5 + fres * 0.9 + 0.025) * mix(0.35, 1.0, trail) * flick
                                  + uBand * band * (0.6 + grid * 5.0 + fres * 2.5) * 2.6);
          float fm = 1.0 - smoothstep(uFocus.w * 0.5, uFocus.w, distance(hp, uFocus.xyz));
          holo += uFocusCol * uFocusAmt * fm * (grid * 1.7 + fres * 1.3 + 0.04) * flick;
          totalEmissiveRadiance += holo;
          // visor: orange pixels of the albedo, only around the head
          float orange = smoothstep(0.05, 0.25, mechAlbedo.r - mechAlbedo.b) * smoothstep(0.02, 0.12, mechAlbedo.r - mechAlbedo.g * 1.25);
          float hm = 1.0 - smoothstep(uVisorR * 0.45, uVisorR, distance(hp, uVisorPos));
          totalEmissiveRadiance += vec3(1.0, 0.36, 0.05) * orange * hm * uVisor * 26.0;
        }`);
  };
  mat.customProgramCacheKey = () => 'hn9-mech';
  mat.needsUpdate = true;
}

// ─── Scan sheet: a horizontal laser plane that climbs the mech ─────────────────────
export function scanSheet() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uAmt: { value: 0 }, uTime: { value: 0 }, uCol: { value: new THREE.Color(0.28, 0.9, 1.0) } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float uAmt, uTime; uniform vec3 uCol; varying vec2 vP;
      void main(){
        float r = length(vP);
        float fall = smoothstep(6.8, 0.0, r);
        float rings = pow(abs(sin(r * 3.0 - uTime * 4.0)), 40.0) * 0.35 * smoothstep(6.5, 2.0, r);
        float ang = atan(vP.y, vP.x);
        float ticks = step(0.94, fract(ang / 6.2831853 * 96.0)) * smoothstep(6.3, 6.2, r) * smoothstep(5.9, 6.0, r);
        float edge = exp(-pow((r - 6.5) * 6.0, 2.0));
        float a = (fall * fall * (0.035 + rings) + ticks * 0.9 + edge * 0.55) * uAmt;
        gl_FragColor = vec4(uCol * a * 0.9, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(6.8, 128), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 6;
  m.frustumCulled = false;
  return m;
}

// ─── Instanced particle pools ───────────────────────────────────────────────────
class Pool {
  constructor(count, base) {
    this.count = count;
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    for (const k of Object.keys(base.attributes)) this.geo.setAttribute(k, base.attributes[k]);
    this.aO = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.aV = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    const d = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) d[i * 4] = -1e4;
    this.aD = new THREE.InstancedBufferAttribute(d, 4);
    for (const a of [this.aO, this.aV, this.aD]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aO', this.aO); this.geo.setAttribute('aV', this.aV); this.geo.setAttribute('aD', this.aD);
    this.geo.instanceCount = count;
    this.i = 0;
    this.dirty = false;
  }
  spawn(o, v, birth, life, a, b) {
    const i = this.i; this.i = (this.i + 1) % this.count;
    this.aO.array.set([o.x, o.y, o.z], i * 3);
    this.aV.array.set([v.x, v.y, v.z], i * 3);
    this.aD.array.set([birth, life, a, b], i * 4);
    this.dirty = true;
  }
  flush() {
    if (!this.dirty) return;
    this.aO.needsUpdate = this.aV.needsUpdate = this.aD.needsUpdate = true;
    this.dirty = false;
  }
}

const _v = new THREE.Vector3(), _o = new THREE.Vector3();

export class Steam {
  constructor(noiseTex, count = 900) {
    this.pool = new Pool(count, new THREE.PlaneGeometry(1, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { uTime: { value: 0 }, uNoise: { value: noiseTex }, uLight: { value: 1 }, uCol: { value: new THREE.Color(0.8, 0.84, 0.9) }, uWarm: { value: new THREE.Color(1.0, 0.25, 0.1) }, uWarmAmt: { value: 0 } },
      vertexShader: `
        attribute vec3 aO, aV; attribute vec4 aD;
        uniform float uTime;
        varying vec2 vUv; varying float vA; varying float vSeed; varying float vT; varying float vH;
        void main(){
          float age = uTime - aD.x; float t = age / aD.y;
          if (t < 0.0 || t > 1.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
          float drag = 1.6;
          vec3 p = aO + aV * (1.0 - exp(-drag * age)) / drag + vec3(0.0, 0.7, 0.0) * age * age * 0.5;
          p += vec3(sin(age * 1.3 + aD.w * 20.0), 0.0, cos(age * 1.1 + aD.w * 13.0)) * 0.35 * age;
          float size = aD.z * (0.3 + 2.1 * sqrt(t));
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float r = aD.w * 6.28 + age * (aD.w - 0.5) * 0.9;
          vec2 c = mat2(cos(r), -sin(r), sin(r), cos(r)) * position.xy;
          mv.xy += c * size;
          gl_Position = projectionMatrix * mv;
          vUv = uv; vT = t; vSeed = aD.w; vH = p.y;
          vA = smoothstep(0.0, 0.05, t) * pow(1.0 - t, 1.5);
        }`,
      fragmentShader: `
        uniform sampler2D uNoise; uniform float uLight, uWarmAmt; uniform vec3 uCol, uWarm;
        varying vec2 vUv; varying float vA; varying float vSeed; varying float vT; varying float vH;
        void main(){
          vec2 q = vUv - 0.5; float r = length(q) * 2.0;
          float n = texture2D(uNoise, vUv * 0.55 + vec2(vSeed * 7.3, vSeed * 3.1) + vT * 0.08).r;
          float n2 = texture2D(uNoise, vUv * 1.3 - vec2(vSeed * 2.1, vT * 0.2)).r;
          float a = smoothstep(1.0, 0.15, r) * smoothstep(0.15, 0.85, n * 0.7 + n2 * 0.5) * vA * 0.3;
          a = clamp(a, 0.0, 1.0);
          vec3 col = mix(uCol, uWarm, uWarmAmt) * uLight * (0.55 + n * 0.7) * (0.8 + smoothstep(2.0, 12.0, vH) * 0.5);
          gl_FragColor = vec4(col * a, a);
        }`,
    });
    this.mesh = new THREE.Mesh(this.pool.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
  }
  burst(origin, dir, n, t, { speed = 6, spread = 0.35, life = 3.2, size = 1.2 } = {}) {
    for (let k = 0; k < n; k++) {
      _v.copy(dir).add(_o.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(spread * 2)).normalize()
        .multiplyScalar(speed * (0.55 + Math.random() * 0.6));
      _o.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3));
      this.pool.spawn(_o, _v, t + Math.random() * 0.25, life * (0.7 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), Math.random());
    }
  }
  update(t) { this.mat.uniforms.uTime.value = t; this.pool.flush(); }
}

export class Sparks {
  constructor(count = 1400) {
    this.pool = new Pool(count, new THREE.PlaneGeometry(1, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1440, 900) }, uWidth: { value: 2.2 } },
      vertexShader: `
        attribute vec3 aO, aV; attribute vec4 aD;
        uniform float uTime; uniform vec2 uRes; uniform float uWidth;
        varying float vHeat; varying float vA; varying vec2 vUv;
        vec3 posAt(float age){
          vec3 g = vec3(0.0, -9.8, 0.0);
          float vy = aV.y, y0 = aO.y;
          float th = (vy + sqrt(vy * vy + 19.6 * y0)) / 9.8;
          if (age < th) return aO + aV * age + 0.5 * g * age * age;
          vec3 ph = aO + aV * th + 0.5 * g * th * th; ph.y = 0.02;
          vec3 vh = aV + g * th;
          vec3 nv = vec3(vh.x * 0.42, -vh.y * 0.26, vh.z * 0.42);
          float a2 = age - th;
          vec3 p = ph + nv * a2 + 0.5 * g * a2 * a2;
          p.y = max(p.y, 0.02);
          return p;
        }
        void main(){
          float age = uTime - aD.x; float t = age / aD.y;
          if (t < 0.0 || t > 1.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
          vec3 h = posAt(age), tl = posAt(max(age - 0.045, 0.0));
          vec4 ch = projectionMatrix * viewMatrix * vec4(h, 1.0);
          vec4 ct = projectionMatrix * viewMatrix * vec4(tl, 1.0);
          vec2 asp = vec2(uRes.x / uRes.y, 1.0);
          vec2 dir = (ch.xy / ch.w - ct.xy / ct.w) * asp;
          float l = length(dir);
          dir = l > 1e-6 ? dir / l : vec2(0.0, 1.0);
          vec2 nrm = vec2(-dir.y, dir.x) / asp;
          float along = position.y + 0.5;
          vec4 c = mix(ct, ch, along);
          c.xy += nrm * position.x * (uWidth * aD.z) / uRes.y * 2.0 * c.w;
          // stretch a little past the head so slow sparks still read as dots
          c.xy += vec2(dir.x, dir.y) / asp * (along - 0.5) * (uWidth * aD.z) / uRes.y * 2.0 * c.w;
          gl_Position = c;
          vHeat = pow(1.0 - t, 1.3) * aD.w;
          vA = 1.0 - smoothstep(0.7, 1.0, t);
          vUv = vec2(position.x + 0.5, along);
        }`,
      fragmentShader: `
        varying float vHeat; varying float vA; varying vec2 vUv;
        void main(){
          float x = 1.0 - abs(vUv.x - 0.5) * 2.0;
          vec3 hot = vec3(1.0, 0.95, 0.8), mid = vec3(1.0, 0.55, 0.12), cold = vec3(0.6, 0.08, 0.01);
          vec3 c = mix(cold, mix(mid, hot, smoothstep(0.55, 1.0, vHeat)), smoothstep(0.0, 0.55, vHeat));
          gl_FragColor = vec4(c * (2.0 + vHeat * 10.0) * vA * x * vUv.y, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(this.pool.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
  }
  emit(origin, normal, n, t) {
    for (let k = 0; k < n; k++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar(2).add(_o.copy(normal).multiplyScalar(1.3)).normalize()
        .multiplyScalar(1.5 + Math.random() * 5.5);
      this.pool.spawn(origin, _v, t, 0.6 + Math.random() * 1.6, 0.6 + Math.random() * 0.9, 0.7 + Math.random() * 0.3);
    }
  }
  update(t) { this.mat.uniforms.uTime.value = t; this.pool.flush(); }
}

/** Dust motes that only exist where the floods and searchlight pass. */
export class BeamDust {
  constructor(count = 9000) {
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(Math.random()) * 17, a = Math.random() * Math.PI * 2;
      pos.set([Math.cos(a) * r, Math.random() * 20 + 0.3, Math.sin(a) * r + 1], i * 3);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const L = 6;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uDpr: { value: 1 }, uFall: { value: 0 },
        uLP: { value: Array.from({ length: L }, () => new THREE.Vector3()) },
        uLD: { value: Array.from({ length: L }, () => new THREE.Vector3(0, -1, 0)) },
        uLC: { value: Array.from({ length: L }, () => new THREE.Vector4(0.9, 0, 0, 0)) }, // cos, rgb*power
      },
      vertexShader: `
        attribute float seed; uniform float uTime, uDpr, uFall;
        uniform vec3 uLP[${L}]; uniform vec3 uLD[${L}]; uniform vec4 uLC[${L}];
        varying float vA; varying vec3 vC;
        void main(){
          vec3 p = position;
          float t = uTime * (0.04 + seed * 0.05);
          p += vec3(sin(t * 3.1 + seed * 40.0), sin(t * 2.3 + seed * 13.0) * 0.6, cos(t * 2.7 + seed * 27.0)) * 0.8;
          p.y -= uFall * (uTime * (1.5 + seed * 2.0));
          p.y = mod(p.y, 20.0) + 0.3;
          vec3 acc = vec3(0.0);
          for (int i = 0; i < ${L}; i++) {
            vec4 lc = uLC[i];
            if (lc.y + lc.z + lc.w <= 0.0) continue;
            vec3 d = p - uLP[i]; float dist = length(d);
            float cone = smoothstep(lc.x, lc.x + 0.02, dot(d / dist, uLD[i]));
            acc += lc.yzw * cone / (1.0 + dist * dist * 0.004);
          }
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = (0.35 + 0.65 * fract(seed * 91.7)) * smoothstep(1.5, 5.0, -mv.z);
          vC = acc;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min((1.0 + seed * 2.4) * (22.0 / -mv.z), 5.0) * uDpr;
        }`,
      fragmentShader: `varying float vA; varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vC * a * vA * 0.9, 1.0); }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.L = L;
  }
  setLight(i, light, power) {
    const u = this.mat.uniforms;
    light.updateMatrixWorld(); light.target.updateMatrixWorld();
    u.uLP.value[i].setFromMatrixPosition(light.matrixWorld);
    u.uLD.value[i].setFromMatrixPosition(light.target.matrixWorld).sub(u.uLP.value[i]).normalize();
    const c = light.color;
    u.uLC.value[i].set(Math.cos(light.angle * 0.92), c.r * power, c.g * power, c.b * power);
  }
}
