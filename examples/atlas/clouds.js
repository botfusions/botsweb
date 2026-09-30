// Soft volumetric-looking clouds: one instanced draw of world-up billboards, each sampling a GPU-baked
// cumulus atlas (density + self-shadowing from above), lit in three tones, hazed by the shared sky and
// depth-faded against the islands (soft particles), then depth-sorted on the CPU every frame.
import { THREE } from '../../src/core/engine.js';
import { bakeTexture } from '../../src/core/textures.js';
import { sky, SKY_GLSL } from './sky.js';

function bakeAtlas(renderer) {
  // pass 1: cumulus density per tile
  const density = bakeTexture(renderer, 1024, /* glsl */`
    float h1(float n){ return fract(sin(n) * 43758.5453123); }
    float puff(vec2 p, float id){
      float f = -1.0;
      float flt = step(2.5, id);           // tile 3: long, low stratus for the cloud sea
      for (int i = 0; i < 11; i++){
        float fi = float(i);
        float a = h1(fi * 12.7 + id * 91.3), b = h1(fi * 3.9 + id * 17.1), c = h1(fi * 7.3 + id * 33.7);
        float spread = mix(0.5, 0.66, flt);
        float x = 0.5 + (a - 0.5) * spread;
        float edge = 1.0 - abs(x - 0.5) * mix(1.5, 1.2, flt);
        float r = mix(0.075, 0.19, c) * edge * mix(1.0, 0.72, flt);
        float y = mix(0.34, 0.36, flt) + r * 0.75 + b * mix(0.13, 0.05, flt) * edge;
        vec2 dp = (p - vec2(x, y)) * vec2(1.0, 1.08);
        f = max(f, (r - length(dp)) / r);
      }
      return f;
    }
    void main(){
      vec2 tile = floor(vUv * 2.0);
      vec2 p = fract(vUv * 2.0);
      float id = tile.x + tile.y * 2.0;
      float n = fbm(p * 4.0 + id * 3.7, 64.0, 6, 0.55);
      float n2 = fbm(p * 14.0 + id * 1.3, 64.0, 4, 0.5);
      float f = puff(p + vec2(n, n * 0.8) * 0.07, id);
      float d = smoothstep(-0.12, 0.6, f + n * 0.45 + n2 * 0.18);
      d *= smoothstep(0.24, 0.42, p.y + n * 0.06 + n2 * 0.02);
      d *= smoothstep(0.5, 0.38, max(abs(p.x - 0.5), abs(p.y - 0.5)));
      gl_FragColor = vec4(d, 0.0, 0.0, 1.0);
    }`);
  density.generateMipmaps = false;
  // pass 2: light transmitted from above (self-shadowing), marched through the density texture
  return bakeTexture(renderer, 1024, /* glsl */`
    uniform sampler2D uDen;
    float den(vec2 p, vec2 tile){ p = clamp(p, 0.0, 1.0); return texture2D(uDen, (p + tile) * 0.5).r; }
    void main(){
      vec2 tile = floor(vUv * 2.0);
      vec2 p = fract(vUv * 2.0);
      float d = den(p, tile);
      float acc = 0.0;
      for (int i = 1; i <= 16; i++) acc += den(p + vec2(0.01, 0.024) * float(i), tile);
      float acc2 = 0.0;
      for (int i = 1; i <= 6; i++) acc2 += den(p + vec2(0.0, 0.07) * float(i), tile);
      float T = exp(-acc * 0.15), T2 = exp(-acc2 * 0.22);
      gl_FragColor = vec4(d, T * 0.7 + T2 * 0.3, 0.0, 1.0);
    }`, { uDen: { value: density } });
}

export class Clouds {
  constructor(renderer, { max = 1400 } = {}) {
    this.max = max;
    this.items = [];
    this.tex = bakeAtlas(renderer);
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.a = new Float32Array(max * 4);
    this.b = new Float32Array(max * 4);
    this.attrA = new THREE.InstancedBufferAttribute(this.a, 4).setUsage(THREE.DynamicDrawUsage);
    this.attrB = new THREE.InstancedBufferAttribute(this.b, 4).setUsage(THREE.DynamicDrawUsage);
    this.c = new Float32Array(max * 2);
    this.attrC = new THREE.InstancedBufferAttribute(this.c, 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iA', this.attrA);
    geo.setAttribute('iB', this.attrB);
    geo.setAttribute('iC', this.attrC);
    geo.instanceCount = 0;
    this.uniforms = {
      ...sky,
      uTex: { value: this.tex },
      uDepth: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 }, uFar: { value: 1000 },
      uLitC: { value: new THREE.Color('#fffaf2').multiplyScalar(1.12) },
      uMidC: { value: new THREE.Color('#fae5d9') },
      uShadowC: { value: new THREE.Color('#a6bade') },
      uNearFade: { value: new THREE.Vector2(0.4, 1.5) },
      uCloudFog: { value: 0.0034 },
      uSoftOn: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true,
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        attribute vec4 iA; attribute vec4 iB; attribute vec2 iC;
        uniform float uTime;
        varying vec2 vUv; varying float vViewZ; varying vec3 vWorld; varying vec4 vB; varying float vSize;
        void main(){
          vec3 c = iA.xyz;
          float seed = fract(iA.x * 0.1373 + iA.z * 0.0711 + iA.y * 0.031);
          c += vec3(sin(uTime * 0.045 + seed * 30.0), sin(uTime * 0.03 + seed * 11.0) * 0.25, cos(uTime * 0.04 + seed * 20.0)) * (0.4 + iA.w * 0.025);
          vec3 toCam = normalize(cameraPosition - c);
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
          vec3 up = cross(toCam, right);
          vec2 q = position.xy * vec2(1.0, iB.w);
          float cr = cos(iC.x), sr = sin(iC.x);
          q = vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y);
          vec3 wp = c + (right * q.x + up * q.y) * iA.w;
          vUv = vec2(iC.y > 0.5 ? 1.0 - uv.x : uv.x, uv.y); vWorld = wp; vB = iB; vSize = iA.w;
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          vViewZ = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        #include <packing>
        ${SKY_GLSL}
        uniform sampler2D uTex, uDepth; uniform vec2 uRes; uniform float uNear, uFar; uniform vec2 uNearFade;
        uniform vec3 uLitC, uMidC, uShadowC; uniform float uCloudFog, uSoftOn;
        varying vec2 vUv; varying float vViewZ; varying vec3 vWorld; varying vec4 vB; varying float vSize;
        void main(){
          float id = floor(vB.x + 0.5); float ty = floor((id + 0.5) * 0.5); vec2 tile = vec2(id - ty * 2.0, ty);
          vec4 t = texture2D(uTex, (clamp(vUv, 0.004, 0.996) + tile) * 0.5);
          float d = t.r * vB.z;
          if (d < 0.004) discard;
          float L = clamp((0.3 + 0.7 * t.g) * vB.y, 0.0, 1.25);
          vec3 col = mix(uShadowC, uMidC, smoothstep(0.0, 0.38, L));
          col = mix(col, uLitC, smoothstep(0.3, 0.85, L));
          vec3 dir = normalize(vWorld - cameraPosition);
          float s = max(dot(dir, uSunDir), 0.0);
          col += mix(uSunCol, vec3(1.0), 0.5) * (pow(s, 4.0) * (1.0 - t.r) * 0.4 + pow(s, 16.0) * 0.25);
          float fz = uCloudFog * vViewZ; float f = 1.0 - exp(-fz * fz);
          col = mix(col, skyColor(dir), clamp(f, 0.0, 0.97));
          float sceneZ = -perspectiveDepthToViewZ(texture2D(uDepth, gl_FragCoord.xy / uRes).x, uNear, uFar);
          float soft = mix(1.0, clamp((sceneZ - vViewZ) / (vSize * 0.28), 0.0, 1.0), uSoftOn);
          float nearF = smoothstep(vSize * 0.06 + uNearFade.x, vSize * 0.42 + uNearFade.y, vViewZ);
          gl_FragColor = vec4(col, d * soft * nearF);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.geo = geo;
    this._order = [];
  }

  /** tile 0-3, shade (lighting multiplier), alpha, aspect (h/w). Returns the item so callers can animate it. */
  add(x, y, z, size, { tile = 0, shade = 1, alpha = 1, aspect = 1, rot = (Math.random() - 0.5) * 0.3, flip = Math.random() < 0.5 ? 1 : 0 } = {}) {
    if (this.items.length >= this.max) return null;
    const it = { x, y, z, size, tile, shade, alpha, aspect, rot, flip };
    this.items.push(it);
    return it;
  }

  update(camera) {
    const n = this.items.length;
    const cp = camera.position;
    const fx = -camera.matrixWorld.elements[8], fy = -camera.matrixWorld.elements[9], fz = -camera.matrixWorld.elements[10];
    const order = this._order;
    order.length = 0;
    for (let i = 0; i < n; i++) {
      const it = this.items[i];
      if (it.alpha <= 0.001) continue;
      it._d = (it.x - cp.x) * fx + (it.y - cp.y) * fy + (it.z - cp.z) * fz;
      if (it._d < -it.size) continue; // fully behind the camera
      order.push(it);
    }
    order.sort((p, q) => q._d - p._d);
    const a = this.a, b = this.b;
    for (let k = 0; k < order.length; k++) {
      const it = order[k];
      a[k * 4] = it.x; a[k * 4 + 1] = it.y; a[k * 4 + 2] = it.z; a[k * 4 + 3] = it.size;
      b[k * 4] = it.tile; b[k * 4 + 1] = it.shade; b[k * 4 + 2] = it.alpha; b[k * 4 + 3] = it.aspect;
      this.c[k * 2] = it.rot; this.c[k * 2 + 1] = it.flip;
    }
    this.attrC.needsUpdate = true;
    this.attrC.addUpdateRange(0, order.length * 2);
    this.geo.instanceCount = order.length;
    this.attrA.needsUpdate = true; this.attrB.needsUpdate = true;
    this.attrA.addUpdateRange(0, order.length * 4);
    this.attrB.addUpdateRange(0, order.length * 4);
    this.uniforms.uNear.value = camera.near; this.uniforms.uFar.value = camera.far;
  }
}

/** Seeded RNG so the sky is the same sky every visit. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
