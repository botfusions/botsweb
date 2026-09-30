// Board-marked concrete for the plinth, a quiet floor, and the shader patch that gives the house its night.
import * as THREE from 'three';
import { bakeTexture } from '../../src/core/textures.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Effect } from 'postprocessing';

// One tile = 2.4 × 2.4 m of wall: 1.2 × 0.6 m formwork panels, six tie holes each, 120 mm boards.
const CONCRETE_H = `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  struct C { float v; float hole; float ring; float seam; float bseam; float n; float pr; };
  C concrete(vec2 uv){
    C c;
    vec2 w = uv * 2.4;
    vec2 cs = vec2(1.2, 0.6);
    vec2 id = floor(w / cs), f = fract(w / cs);
    c.pr = hash(id + 3.1);
    vec2 hp = f * vec2(3.0, 2.0); vec2 hc = fract(hp) - 0.5;
    float d = length(hc * vec2(cs.x / 3.0, cs.y / 2.0));
    c.hole = 1.0 - smoothstep(0.012, 0.016, d);
    c.ring = smoothstep(0.014, 0.018, d) * (1.0 - smoothstep(0.018, 0.03, d));
    vec2 e = min(f, 1.0 - f) * cs;
    c.seam = 1.0 - smoothstep(0.0, 0.0035, min(e.x, e.y));
    float bf = fract(w.y / 0.12);
    c.bseam = 1.0 - smoothstep(0.0, 0.025, min(bf, 1.0 - bf));
    float board = hash(vec2(floor(w.y / 0.12), id.x));
    c.n = fbm(uv * 6.0, 6.0, 6, 0.55) + (board - 0.5) * 0.18 + fbm(uv * 48.0, 48.0, 3, 0.5) * 0.4;
    return c;
  }`;

export function concreteTextures(renderer) {
  const map = bakeTexture(renderer, 1024, `${CONCRETE_H}
    void main(){
      C c = concrete(vUv);
      float v = 0.60 + c.n * 0.085 + (c.pr - 0.5) * 0.05;
      v -= c.seam * 0.09 + c.bseam * 0.018 + c.ring * 0.035;
      v = mix(v, 0.34, c.hole);
      gl_FragColor = vec4(v, v * 0.988, v * 0.962, 1.0);
    }`);
  map.colorSpace = THREE.SRGBColorSpace;
  const normal = bakeTexture(renderer, 1024, `${CONCRETE_H}
    float H(vec2 uv){ C c = concrete(uv); return c.n * 0.25 - c.hole * 1.0 - c.seam * 0.45 - c.bseam * 0.08 + c.ring * 0.05; }
    void main(){
      float e = 1.0 / 1024.0;
      float hx = H(vUv + vec2(e, 0.)) - H(vUv - vec2(e, 0.));
      float hy = H(vUv + vec2(0., e)) - H(vUv - vec2(0., e));
      vec3 n = normalize(vec3(-hx * 9.0, -hy * 9.0, 1.0));
      gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
    }`);
  const rough = bakeTexture(renderer, 512, `${CONCRETE_H}
    void main(){ C c = concrete(vUv); float r = 0.8 + c.n * 0.12 + c.hole * 0.15 - c.ring * 0.05; gl_FragColor = vec4(1.0, clamp(r, 0.4, 1.0), 0.0, 1.0); }`);
  return { map, normal, rough };
}

export function floorTexture(renderer) {
  const t = bakeTexture(renderer, 1024, `
    void main(){
      float n = fbm(vUv * 3.0, 3.0, 6, 0.55) * 0.05 + fbm(vUv * 24.0, 24.0, 3, 0.5) * 0.025;
      float v = 0.96 + n;
      gl_FragColor = vec4(v, v * 0.995, v * 0.985, 1.0);
    }`);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ─── Model patch: night windows, pool glow, reflective water, section poché ───────
const uniforms = {
  uNight: { value: 0 }, uPoche: { value: 0 }, uTime: { value: 0 },
  uWorldToRaw: { value: new THREE.Matrix4() },
  uWin: { value: new THREE.Color(1.0, 0.56, 0.24).multiplyScalar(2.4) },
  uPool: { value: new THREE.Color(0.1, 0.85, 1.0).multiplyScalar(1.6) },
  uCutA: { value: new THREE.Vector4(0, -1, 0, 99) }, uCutB: { value: new THREE.Vector4(1, 0, 0, 99) },
  uInk: { value: new THREE.Color(0.012, 0.012, 0.011) },
  uFillC: { value: new THREE.Color() }, uFillE: { value: new THREE.Color() }, uPx: { value: 1 },
};
const planes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 99), new THREE.Plane(new THREE.Vector3(1, 0, 0), 99)];

export function patchModel(m) {
  m.side = THREE.DoubleSide;
  m.clippingPlanes = planes;
  m.clipShadows = true;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uWorldToRaw; varying vec3 vRaw; varying vec3 vWp;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n{ vec4 wp_ = modelMatrix * vec4(transformed, 1.0); vWp = wp_.xyz; vRaw = (uWorldToRaw * wp_).xyz; }');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight, uPoche, uTime, uPx; uniform vec3 uWin, uPool, uInk, uFillC, uFillE; uniform vec4 uCutA, uCutB; varying vec3 vRaw; varying vec3 vWp;
        float boxm(vec3 p, vec3 a, vec3 b, float s){ vec3 q = smoothstep(a - s, a + s, p) * (1.0 - smoothstep(b - s, b + s, p)); return q.x * q.y * q.z; }
        float h1(float x){ return fract(sin(x * 91.17) * 43758.5453); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float blu_ = diffuseColor.b - max(diffuseColor.r, diffuseColor.g * 0.86);
        float water_ = smoothstep(0.05, 0.16, blu_) * step(vRaw.y, 0.125);
        roughnessFactor = mix(roughnessFactor, 0.06, water_ * 0.9);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Wind on the water: two drifting wave trains, enough to break the sun into glitter.
          vec2 wp = vRaw.xz * vec2(160.0, 190.0);
          float a1 = sin(wp.x + uTime * 1.7 + sin(wp.y * 0.37 + uTime * 0.6) * 1.8);
          float a2 = sin(wp.y * 1.3 - uTime * 1.3 + sin(wp.x * 0.52 - uTime * 0.4) * 1.4);
          float calm = step(0.05, vRaw.y);   // the pool is calmer than the Atlantic
          normal = normalize(normal + water_ * mix(0.16, 0.05, calm) * vec3(a1, a2, 0.0));
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          float up = boxm(vRaw, vec3(-0.70, 0.358, -0.03), vec3(0.40, 0.542, 0.37), 0.003);
          float lo = boxm(vRaw, vec3(-0.47, 0.142, 0.26), vec3(0.41, 0.314, 0.40), 0.003);
          float room = mix(0.35, 1.0, step(0.3, h1(floor(vRaw.x * 7.0) + (up > 0.5 ? 11.0 : 0.0))));
          float win = clamp(up + lo, 0.0, 1.0) * room;
          totalEmissiveRadiance += uWin * win * smoothstep(0.1, 0.55, lum) * (0.35 + lum) * uNight;
          float pool = boxm(vRaw, vec3(-0.14, 0.0, -0.48), vec3(0.8, 0.118, -0.15), 0.005) * water_;
          totalEmissiveRadiance += uPool * pool * uNight * (0.5 + diffuseColor.g);
        }`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        if (uPoche > 0.001) {
          // Architectural poché: surfaces seen through the cut (back faces) get a flat fill with a fine
          // 45° hatch — warm concrete grey for the building, a paler, sparser earth hatch for the rock.
          // Foliage keeps its rendered look so trees don't turn into grey flecks.
          float px = uPx * 1.0;
          float leaf = step(0.02, diffuseColor.g - max(diffuseColor.r, diffuseColor.b) * 1.05);
          if (!gl_FrontFacing && leaf < 0.5) {
            float earth = 1.0 - smoothstep(0.0, 0.03, vRaw.y);
            float per = mix(6.0, 11.0, earth) * px;
            float m = mod(gl_FragCoord.x + gl_FragCoord.y, per);
            float line = 1.0 - smoothstep(0.35 * px, 1.05 * px, abs(m - per * 0.5));
            vec3 fill = mix(uFillC, uFillE, earth);
            vec3 hatch = fill * mix(0.58, 0.74, earth);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fill, hatch, line), uPoche);
          }
        }`);
  };
  m.needsUpdate = true;
}
patchModel.uniforms = uniforms;
patchModel.planes = planes;

// Exact cut outline: intersect every triangle with the plane once, draw the segments as fat lines.
export function sectionOutline(mesh, normal, constant, { width = 2, color = 0x1a1917, lift = 0.004 } = {}) {
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index;
  const n = pos.count, W = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); W[i * 3] = v.x; W[i * 3 + 1] = v.y; W[i * 3 + 2] = v.z; }
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) dist[i] = normal.x * W[i * 3] + normal.y * W[i * 3 + 1] + normal.z * W[i * 3 + 2] + constant;
  const out = [];
  const tri = idx ? idx.array : null, T = tri ? tri.length : n;
  const hit = (a, b) => { const t = dist[a] / (dist[a] - dist[b]); for (let k = 0; k < 3; k++) out.push(W[a * 3 + k] + (W[b * 3 + k] - W[a * 3 + k]) * t - normal.getComponent(k) * lift); };
  for (let f = 0; f < T; f += 3) {
    const a = tri ? tri[f] : f, b = tri ? tri[f + 1] : f + 1, c = tri ? tri[f + 2] : f + 2;
    const sa = dist[a] > 0, sb = dist[b] > 0, sc = dist[c] > 0;
    if (sa === sb && sb === sc) continue;
    const before = out.length;
    if (sa !== sb) hit(a, b);
    if (sb !== sc) hit(b, c);
    if (sc !== sa) hit(c, a);
    if (out.length - before !== 6) out.length = before;
  }
  const geo = new LineSegmentsGeometry().setPositions(out);
  const mat = new LineMaterial({ color, linewidth: width, transparent: true, opacity: 0, depthWrite: false, worldUnits: false });
  const lines = new LineSegments2(geo, mat);
  lines.renderOrder = 3;
  lines.frustumCulled = false;
  return lines;
}

// Golden-hour grade (display space, after tone mapping): more saturation, a gold hue shift and lifted
// mid-tones so low warm light reads golden instead of brown. Blacks and highlights are left alone.
export class GoldenGrade extends Effect {
  constructor() {
    super('GoldenGrade', `
      uniform float uW;
      void mainImage(const in vec4 ic, const in vec2 uv, out vec4 oc) {
        vec3 c = ic.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 s = mix(vec3(l), c, 1.0 + 0.3 * uW);
        vec3 g = s * vec3(1.04, 1.0, 0.9);
        float mid = smoothstep(0.0, 0.2, l) * (1.0 - smoothstep(0.45, 0.95, l));
        g = pow(max(g, vec3(0.0)), vec3(1.0 - 0.15 * mid));
        oc = vec4(mix(c, g, uW), ic.a);
      }`, { uniforms: new Map([['uW', new THREE.Uniform(0)]]) });
  }
  set weight(v) { this.uniforms.get('uW').value = v; }
}
