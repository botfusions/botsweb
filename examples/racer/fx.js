// Nightshift — page-local rendering pieces: wet asphalt, rain, splashes, heat haze, neon, wet paint.
import { THREE } from '../../src/core/engine.js';
import { Effect } from 'postprocessing';

// ─── Shared GLSL ──────────────────────────────────────────────────────────────
const HASH = /* glsl */`
  vec2 nsHash2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
  float nsHash1(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

// Rain-drop rings on standing water: gradient of a field of expanding, decaying ring waves.
const RIPPLES = /* glsl */`
  vec2 nsRipples(vec2 uv, float t){
    vec2 g = vec2(0.0);
    vec2 id0 = floor(uv);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 id = id0 + vec2(float(i), float(j));
      vec2 h = nsHash2(id);
      float tt = t * (0.75 + h.x * 0.6) + h.y * 11.0;
      float cyc = floor(tt);
      float ph = fract(tt);
      vec2 c = id + 0.5 + (nsHash2(id + cyc * 1.37) - 0.5) * 0.9;
      vec2 d = uv - c;
      float r = length(d);
      float x = (r - ph * 0.95) * 11.0;
      float env = (1.0 - ph) * (1.0 - ph) * exp(-x * x);
      g += (d / max(r, 1e-3)) * cos(x * 2.6) * env;
    }
    return g;
  }
`;

// ─── Wet asphalt ─────────────────────────────────────────────────────────────
// Planar reflection sampled with a vertical streak kernel (wet roads smear lights downward),
// puddles that turn to mirrors, and rain rings that distort both the surface and the reflection.
export function patchWetFloor(material, reflection, shared) {
  const u = {
    uPuddle: { value: shared.puddle },
    uReflStrength: { value: 1.7 },
    uStreak: { value: 0.09 },
    uRipple: { value: 0.55 },
    uTime: shared.uTime,
  };
  material.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, reflection.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vW;
        uniform sampler2D uRefl; uniform mat4 uReflMat; uniform sampler2D uPuddle;
        uniform float uTime, uReflStrength, uStreak, uRipple;
        ${HASH}
        ${RIPPLES}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float pudA = texture2D(uPuddle, vW.xz * 0.075).r;
        float pudB = texture2D(uPuddle, vW.xz * 0.31 + 0.37).r;
        float puddle = smoothstep(0.53, 0.6, pudA + (pudB - 0.5) * 0.18);
        diffuseColor.rgb *= mix(0.8, 0.28, puddle);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.03, puddle);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          normal = normalize(mix(normal, upV, puddle * 0.9));
          vec2 rg = nsRipples(vW.xz * 5.5, uTime) + nsRipples(vW.xz * 8.3 + 17.3, uTime * 1.21) * 0.7;
          rg *= uRipple * mix(0.28, 1.0, puddle);
          normal = normalize(normal + (viewMatrix * vec4(rg.x, 0.0, rg.y, 0.0)).xyz * 0.6);
        }`)
      .replace('#include <opaque_fragment>', `
        {
          vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          vec4 rp = uReflMat * vec4(vW, 1.0);
          vec2 ruv = rp.xy / rp.w + nW.xz * vec2(0.05, 0.08);
          float rough = roughnessFactor;
          float lod = 0.2 + rough * 5.5;
          vec3 acc = vec3(0.0); float ws = 0.0;
          for (int i = -5; i <= 5; i++) {
            float fi = float(i) / 5.0;
            float w = exp(-fi * fi * 2.2);
            vec2 o = vec2(fi * rough * 0.006, fi * (0.002 + rough * uStreak));
            acc += textureLod(uRefl, ruv + o, lod * 0.75).rgb * w; ws += w;
          }
          vec3 refl = acc / ws;
          float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
          float edge = smoothstep(0.0, 0.03, ruv.x) * smoothstep(1.0, 0.97, ruv.x) * smoothstep(0.0, 0.02, ruv.y) * smoothstep(1.0, 0.98, ruv.y);
          outgoingLight += refl * uReflStrength * mix(0.25, 1.0, fres) * (1.0 - rough * 0.55) * edge;
        }
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'ns-wetfloor';
  material.needsUpdate = true;
  return u;
}

// ─── Wall wash: neon light falling on the bricks (respects albedo) ────────────
export function patchWallWash(material, washes) {
  // washes: [{ tex, rect: Vector4(x0, y0, w, h), color: Color, level: {value} }]
  const u = {};
  washes.forEach((w, i) => {
    u[`uWashTex${i}`] = { value: w.tex };
    u[`uWashRect${i}`] = { value: w.rect };
    u[`uWashCol${i}`] = { value: w.color };
    u[`uWashLvl${i}`] = w.level;
    u[`uWashPos${i}`] = { value: w.pos };
  });
  const decl = washes.map((_, i) => `uniform sampler2D uWashTex${i}; uniform vec4 uWashRect${i}; uniform vec3 uWashCol${i}; uniform float uWashLvl${i}; uniform vec3 uWashPos${i};`).join('\n');
  const body = washes.map((_, i) => `{
      vec2 wuv = (vWW.xy - uWashRect${i}.xy) / uWashRect${i}.zw;
      float inside = step(0.0, wuv.x) * step(wuv.x, 1.0) * step(0.0, wuv.y) * step(wuv.y, 1.0);
      float h = texture2D(uWashTex${i}, clamp(wuv, 0.0, 1.0)).r * inside;
      // grazing light from tubes that sit a hand's width off the bricks: relief facing the sign lights up
      vec3 Lw = normalize(uWashPos${i} - vWW);
      float ndl = max(dot(normal, normalize((viewMatrix * vec4(Lw, 0.0)).xyz)), 0.0);
      totalEmissiveRadiance += diffuseColor.rgb * uWashCol${i} * h * uWashLvl${i} * (0.2 + ndl * 2.6);
    }`).join('\n');
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWW;\n${decl}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${body}`);
  };
  material.customProgramCacheKey = () => 'ns-wash-' + washes.length + (material.name || '');
  material.needsUpdate = true;
}

// ─── Wet paint: clearcoat on smooth parts + beaded rain drops ─────────────────
export function wetMaterial(src, { drops = 1, dropScale = 70, clearcoat = 1, env = 1 } = {}) {
  const p = {
    map: src.map, normalMap: src.normalMap, normalScale: src.normalScale?.clone(),
    roughnessMap: src.roughnessMap, metalnessMap: src.metalnessMap, roughness: src.roughness, metalness: src.metalness,
    aoMap: src.aoMap, emissive: src.emissive?.clone(), emissiveMap: src.emissiveMap, side: THREE.FrontSide,
    clearcoat, clearcoatRoughness: 0.06, envMapIntensity: env,
  };
  for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
  const m = new THREE.MeshPhysicalMaterial(p);
  const u = { uDrops: { value: drops }, uDropScale: { value: dropScale } };
  m.userData.wet = u;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vWN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvOP = transformed; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vOP; varying vec3 vWN; uniform float uDrops, uDropScale;
        ${HASH}
        // one bead per cell (some cells empty): spherical cap height gradient
        vec3 nsDrop(vec2 p){
          vec2 id = floor(p); vec2 f = fract(p) - 0.5;
          vec2 h = nsHash2(id);
          vec2 c = (h - 0.5) * 0.45;
          float r = 0.16 + 0.24 * nsHash1(id + 7.1);
          float keep = step(0.62, nsHash1(id * 1.7 + 3.3));
          vec2 d = f - c;
          float q = 1.0 - dot(d, d) / (r * r);
          if (q <= 0.0 || keep < 0.5) return vec3(0.0);
          float hgt = sqrt(q);
          return vec3(-d / (r * r * max(hgt, 0.25)) * 0.12, 1.0);
        }`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        {
          // smooth surfaces (paint, chrome, polished cases) get the wet clearcoat; rubber and fabric do not
          float gloss = 1.0 - smoothstep(0.28, 0.72, roughnessFactor);
          vec3 wn = normalize(vWN);
          vec3 an = abs(wn);
          vec2 pp = an.y > max(an.x, an.z) ? vOP.xz : (an.x > an.z ? vOP.zy : vOP.xy);
          vec3 dA = nsDrop(pp * uDropScale);
          vec3 dB = nsDrop(pp * uDropScale * 0.47 + 11.7);
          float up = smoothstep(-0.2, 0.75, wn.y);
          float dm = max(dA.z, dB.z * 0.8) * uDrops * up * mix(0.4, 1.0, gloss);
          vec2 gr = (dA.xy + dB.xy * 0.7) * uDrops * up;
          // perturb the coat normal in world space along the projection plane, then back to view space
          vec3 gW = an.y > max(an.x, an.z) ? vec3(gr.x, 0.0, gr.y) : (an.x > an.z ? vec3(0.0, gr.y, gr.x) : vec3(gr.x, gr.y, 0.0));
          clearcoatNormal = normalize(clearcoatNormal + (viewMatrix * vec4(gW, 0.0)).xyz * 0.9);
          material.clearcoat = clamp(material.clearcoat * gloss + dm * 0.5, 0.0, 1.0);
          material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.0525, dm);
        }`);
  };
  m.customProgramCacheKey = () => 'ns-wet';
  return m;
}

// ─── Rain: instanced streaks lit by the scene's lights (forward-scattering) ───
export const MAX_RAIN_LIGHTS = 6;
export function createRain({ count = 16000, box = new THREE.Vector3(16, 9, 16) } = {}) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = new THREE.BufferAttribute(new Uint16Array([0, 2, 1, 2, 3, 1]), 1);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 1, 0, 1, 1, 0, -1, 0, 0, 1, 0, 0]), 3));
  base.dispose();
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) seed[i] = Math.random();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.instanceCount = count;
  const L = MAX_RAIN_LIGHTS;
  const uniforms = {
    uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: box }, uWind: { value: new THREE.Vector3(0.6, 0, 0.25) },
    uWindOff: { value: new THREE.Vector3() }, uLen: { value: 0.3 }, uWidth: { value: 0.85 }, uRes: { value: new THREE.Vector2(1, 1) },
    uBike: { value: new THREE.Vector3(0, 0.5, 0) }, uRev: { value: 0 }, uAlpha: { value: 1 }, uAmbient: { value: new THREE.Color(0.0015, 0.0015, 0.0022) },
    uLPos: { value: Array.from({ length: L }, () => new THREE.Vector3()) },
    uLCol: { value: Array.from({ length: L }, () => new THREE.Vector3()) },
    uLDir: { value: Array.from({ length: L }, () => new THREE.Vector4(0, -1, 0, -2)) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec4 aSeed;
      uniform float uTime, uLen, uWidth, uRev, uAlpha;
      uniform vec3 uCenter, uBox, uWind, uWindOff, uBike, uAmbient;
      uniform vec2 uRes;
      uniform vec3 uLPos[${L}]; uniform vec3 uLCol[${L}]; uniform vec4 uLDir[${L}];
      varying vec3 vC; varying vec2 vQ; varying float vA;
      void main(){
        float speed = 7.5 + aSeed.w * 3.5;
        vec3 p;
        vec3 lo = uCenter - uBox * 0.5;
        p.xz = mod(aSeed.xz * uBox.xz + uWindOff.xz - lo.xz, uBox.xz) + lo.xz;
        p.y = mod(aSeed.y * uBox.y - uTime * speed, uBox.y) - 0.05;
        vec3 vel = vec3(uWind.x, -speed, uWind.z);
        // hot air off the engine and exhaust bends the rain when the throttle is open
        vec3 d = p - uBike;
        float near = exp(-dot(d * vec3(0.7, 0.9, 1.0), d) * 0.55);
        vel.xz += normalize(d.xz + 1e-4) * near * uRev * 6.5;
        vel.y += near * uRev * 5.0;
        vel.x -= uRev * 1.6;
        p += normalize(vel) * near * uRev * 0.25;
        vec3 dir = normalize(vel);
        float len = uLen * clamp(length(vel) / 9.0, 0.35, 1.2);
        vec3 tail = p - dir * len;
        vec4 ch = projectionMatrix * viewMatrix * vec4(p, 1.0);
        vec4 ct = projectionMatrix * viewMatrix * vec4(tail, 1.0);
        vec2 sd = (ch.xy / ch.w - ct.xy / ct.w) * uRes;
        float sl = length(sd);
        vec2 sn = sl > 1e-4 ? sd / sl : vec2(0.0, 1.0);
        vec2 perp = vec2(-sn.y, sn.x);
        vec4 c = mix(ct, ch, position.y);
        float camD = max(c.w, 0.01);
        float w = uWidth * (1.0 + 1.5 / camD);
        c.xy += perp * position.x * w * 2.0 / uRes * c.w;
        gl_Position = c;
        vec3 V = normalize(p - cameraPosition);
        vec3 lit = uAmbient;
        for (int i = 0; i < ${L}; i++) {
          vec3 ld = p - uLPos[i];
          float dist = max(length(ld), 0.05);
          vec3 ln = ld / dist;
          float cone = uLDir[i].w < -1.5 ? 1.0 : smoothstep(uLDir[i].w, uLDir[i].w + 0.05, dot(ln, uLDir[i].xyz));
          float fwd = pow(max(dot(ln, -V), 0.0), 4.0);
          lit += uLCol[i] * cone / (1.0 + dist * dist) * (0.12 + 2.4 * fwd);
        }
        vC = lit;
        vQ = position.xy;
        vA = smoothstep(1.2, 2.6, camD) * (1.0 - smoothstep(9.0, 15.0, camD)) * uAlpha * (0.55 + aSeed.w * 0.6);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying vec2 vQ; varying float vA;
      void main(){
        float across = 1.0 - abs(vQ.x);
        float along = smoothstep(0.0, 0.55, vQ.y) * smoothstep(1.0, 0.86, vQ.y);
        float a = across * across * along * vA;
        gl_FragColor = vec4(vC * a, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return { mesh, uniforms };
}

// Crown splashes on the ground: short-lived bright ticks that re-seed every cycle.
export function createSplashes(rainUniforms, { count = 5000, radius = 7 } = {}) {
  const seed = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) seed[i] = Math.random();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  const L = MAX_RAIN_LIGHTS;
  const uniforms = { ...rainUniforms, uRadius: { value: radius }, uDpr: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 aSeed;
      uniform float uTime, uRadius, uDpr, uAlpha;
      uniform vec3 uCenter, uAmbient;
      uniform vec3 uLPos[${L}]; uniform vec3 uLCol[${L}]; uniform vec4 uLDir[${L}];
      varying vec3 vC; varying float vLife;
      ${HASH}
      void main(){
        float period = 0.55 + aSeed.z * 0.9;
        float tt = uTime / period + aSeed.x * 17.0;
        float cyc = floor(tt);
        vLife = fract(tt);
        vec2 h = nsHash2(vec2(cyc, aSeed.y * 311.0));
        float ang = h.x * 6.2831853, rad = sqrt(h.y) * uRadius;
        vec3 p = vec3(uCenter.x + cos(ang) * rad, 0.012, uCenter.z + sin(ang) * rad);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float life = smoothstep(0.0, 0.05, vLife) * (1.0 - smoothstep(0.05, 0.16, vLife));
        gl_PointSize = (2.0 + vLife * 26.0) * uDpr * (1.0 / max(-mv.z, 0.6));
        vec3 V = normalize(p - cameraPosition);
        vec3 lit = uAmbient * 2.0;
        for (int i = 0; i < ${L}; i++) {
          vec3 ld = p - uLPos[i];
          float dist = max(length(ld), 0.05);
          vec3 ln = ld / dist;
          float cone = uLDir[i].w < -1.5 ? 1.0 : smoothstep(uLDir[i].w, uLDir[i].w + 0.05, dot(ln, uLDir[i].xyz));
          float fwd = pow(max(dot(ln, -V), 0.0), 4.0);
          lit += uLCol[i] * cone / (1.0 + dist * dist) * (0.5 + 2.5 * fwd);
        }
        vC = lit * life * uAlpha * 0.4 * step(vLife, 0.18) * (1.0 - smoothstep(6.0, 11.0, -mv.z));
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying float vLife;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        q.y *= 2.6;
        float r = length(q);
        float ring = smoothstep(0.5, 0.36, r) * smoothstep(0.12, 0.3, r) + smoothstep(0.18, 0.0, r) * 0.6;
        gl_FragColor = vec4(vC * ring, 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  return { points: pts, uniforms };
}

// ─── Heat haze: screen-space refraction plumes (exhaust tip + cylinder head) ──
const hazeFrag = /* glsl */`
  uniform vec2 uA0; uniform vec2 uB0; uniform vec2 uA1; uniform vec2 uB1;
  uniform float uS0; uniform float uS1; uniform float uW0; uniform float uW1; uniform float uHTime;
  float hzH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hzN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hzH(i), hzH(i + vec2(1.0, 0.0)), f.x), mix(hzH(i + vec2(0.0, 1.0)), hzH(i + vec2(1.0, 1.0)), f.x), f.y); }
  float hzPlume(vec2 uv, vec2 a, vec2 b, float w){
    vec2 asp = vec2(aspect, 1.0);
    vec2 pa = (uv - a) * asp, ba = (b - a) * asp;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    float d = length(pa - ba * h);
    float ww = w * (0.35 + h * 1.6);
    return exp(-d * d / (ww * ww)) * smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(0.55, 1.0, h));
  }
  void mainUv(inout vec2 uv){
    float m = hzPlume(uv, uA0, uB0, uW0) * uS0 + hzPlume(uv, uA1, uB1, uW1) * uS1;
    if (m > 0.0005) {
      vec2 q = uv * vec2(aspect, 1.0) * 70.0;
      vec2 n = vec2(hzN(q + vec2(0.0, -uHTime * 7.0)), hzN(q * 1.37 + vec2(13.1, -uHTime * 9.0))) - 0.5;
      n += (vec2(hzN(q * 2.9 + vec2(3.0, -uHTime * 15.0)), hzN(q * 3.3 + vec2(7.0, -uHTime * 17.0))) - 0.5) * 0.5;
      uv += n * m * 0.011;
    }
  }
`;
export class HeatHazeEffect extends Effect {
  constructor() {
    super('HeatHazeEffect', hazeFrag, {
      uniforms: new Map([
        ['uA0', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))], ['uB0', new THREE.Uniform(new THREE.Vector2(0.5, 0.6))],
        ['uA1', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))], ['uB1', new THREE.Uniform(new THREE.Vector2(0.5, 0.6))],
        ['uS0', new THREE.Uniform(0)], ['uS1', new THREE.Uniform(0)], ['uW0', new THREE.Uniform(0.04)], ['uW1', new THREE.Uniform(0.05)],
        ['uHTime', new THREE.Uniform(0)],
      ]),
    });
  }
  update(renderer, input, dt) { this.uniforms.get('uHTime').value += dt; }
}

// ─── Canvas textures ──────────────────────────────────────────────────────────
export function canvasTex(w, h, draw, { srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Neon sign drawn as glass tubes. Returns the lit-tube texture, a dim "unlit glass" texture,
 * and a soft wash texture for the wall. `flickerIndex` splits one letter into its own texture.
 */
export function neonTextures({ word = 'Nightshift', sub = 'MOTOR  CO.', W = 2048, H = 768, flickerIndex = 6 } = {}) {
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = '400 100px Neonderthaw';
  const fontPx = Math.min(H * 0.56, 100 * W * 0.84 / Math.max(1, probe.measureText(word).width));
  const font = `400 ${Math.round(fontPx)}px Neonderthaw`;
  const subFont = `500 ${Math.round(H * 0.075)}px Inter`;
  const layout = g => {
    g.font = font;
    const tw = g.measureText(word).width;
    const x0 = (W - tw) / 2, y0 = H * 0.46;
    return { x0, y0 };
  };
  const drawWord = (g, range, stroke) => {
    const { x0, y0 } = layout(g);
    g.font = font; g.textBaseline = 'middle'; g.textAlign = 'left';
    for (let i = 0; i < word.length; i++) {
      if (!range(i)) continue;
      const x = x0 + g.measureText(word.slice(0, i)).width;
      stroke(g, word[i], x, y0);
    }
  };
  const drawSub = (g, stroke) => {
    g.font = subFont; g.textAlign = 'center'; g.textBaseline = 'middle';
    if ('letterSpacing' in g) g.letterSpacing = `${Math.round(H * 0.035)}px`;
    stroke(g, sub, W / 2 + H * 0.02, H * 0.86);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    // tube underline swash with a gap for the text
    g.beginPath(); g.moveTo(W * 0.2, H * 0.86); g.lineTo(W * 0.32, H * 0.86); g.moveTo(W * 0.68, H * 0.86); g.lineTo(W * 0.8, H * 0.86);
  };
  const tube = (core, edge, w) => (g, s, x, y) => {
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = edge; g.lineWidth = w; g.strokeText(s, x, y);
    g.fillStyle = edge; g.fillText(s, x, y);
    g.strokeStyle = core; g.lineWidth = w * 0.28; g.strokeText(s, x, y);
  };
  const tw = H * 0.017;
  const lit = (range, withSub) => canvasTex(W, H, g => {
    g.clearRect(0, 0, W, H);
    g.shadowColor = 'rgba(255,40,80,0.9)'; g.shadowBlur = H * 0.012;
    drawWord(g, range, tube('#ffe2e8', '#ff2e57', tw));
    if (withSub) {
      drawSub(g, tube('#ffe2e8', '#ff2e57', tw * 0.55));
      g.strokeStyle = '#ff2e57'; g.lineWidth = tw * 0.9; g.stroke();
      g.strokeStyle = '#ffe2e8'; g.lineWidth = tw * 0.25; g.stroke();
    }
  });
  const main = lit(i => i !== flickerIndex, true);
  const flick = lit(i => i === flickerIndex, false);
  const glass = canvasTex(W, H, g => {
    drawWord(g, () => true, tube('rgba(255,210,220,0.5)', 'rgba(120,90,100,0.55)', tw));
    drawSub(g, tube('rgba(255,210,220,0.5)', 'rgba(120,90,100,0.55)', tw * 0.55));
    g.strokeStyle = 'rgba(120,90,100,0.55)'; g.lineWidth = tw * 0.9; g.stroke();
  });
  // Wall wash: the glyphs blurred wide, over a broad soft falloff. Canvas is 2x the sign in each direction.
  const wash = canvasTex(1024, 768, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h * 0.5, 0, w / 2, h * 0.5, w * 0.5);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.22)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    const src = main.image;
    g.filter = 'blur(26px)'; g.globalCompositeOperation = 'lighter';
    g.drawImage(src, w * 0.25, h * 0.25, w * 0.5, h * 0.5);
    g.filter = 'blur(8px)';
    g.globalAlpha = 0.8; g.drawImage(src, w * 0.25, h * 0.25, w * 0.5, h * 0.5);
  }, { srgb: false });
  return { main, flick, glass, wash, aspect: W / H };
}

/** Soft radial sprite (for lens glows, embers, flames). */
export function glowTexture(stops = [[0, 'rgba(255,255,255,1)'], [0.08, 'rgba(255,255,255,0.7)'], [0.25, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']], size = 256) {
  return canvasTex(size, size, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    for (const [o, c] of stops) grd.addColorStop(o, c);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}

/** Backfire flame: a hot core with ragged tongues, drawn once. */
export function flameTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.translate(w / 2, h / 2);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const a = (Math.random() - 0.5) * 1.3, len = 40 + Math.random() * 80;
      g.save(); g.rotate(a);
      const grd = g.createLinearGradient(0, 0, len, 0);
      grd.addColorStop(0, 'rgba(255,240,210,0.55)'); grd.addColorStop(0.4, 'rgba(255,120,30,0.28)'); grd.addColorStop(1, 'rgba(120,20,0,0)');
      g.fillStyle = grd;
      g.beginPath(); g.ellipse(len * 0.45, 0, len * 0.55, 6 + Math.random() * 10, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    const core = g.createRadialGradient(0, 0, 0, 0, 0, 40);
    core.addColorStop(0, 'rgba(210,225,255,1)'); core.addColorStop(0.4, 'rgba(255,200,140,0.8)'); core.addColorStop(1, 'rgba(255,100,20,0)');
    g.fillStyle = core; g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.fill();
  });
}

// ─── Steam: rain flashing off hot exhaust pipes, rising in soft wisps ────────
export function createSteam(rainUniforms, path, { count = 420 } = {}) {
  // path: array of Vector3 (bike-local) along the pipes; particles are born along it
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) seed[i] = Math.random();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const L = MAX_RAIN_LIGHTS;
  const P = path.length;
  const tex = glowTexture([[0, 'rgba(255,255,255,0.9)'], [0.35, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']], 128);
  const uniforms = {
    uTime: rainUniforms.uTime, uLPos: rainUniforms.uLPos, uLCol: rainUniforms.uLCol, uLDir: rainUniforms.uLDir, uAmbient: rainUniforms.uAmbient,
    uWind: rainUniforms.uWind, uHeat: { value: 0 }, uBikeMat: { value: new THREE.Matrix4() }, uDpr: { value: 1 }, uTex: { value: tex },
    uPath: { value: path },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec4 aSeed;
      uniform float uTime, uHeat, uDpr;
      uniform mat4 uBikeMat;
      uniform vec3 uPath[${P}];
      uniform vec3 uWind, uAmbient;
      uniform vec3 uLPos[${L}]; uniform vec3 uLCol[${L}]; uniform vec4 uLDir[${L}];
      varying vec3 vC; varying float vRot;
      void main(){
        float life = 1.6 + aSeed.z * 1.6;
        float age = fract(uTime / life + aSeed.x);
        // where on the pipe this puff was born
        float s = aSeed.y * float(${P - 1});
        int k = int(floor(s));
        vec3 a = uPath[0], b = uPath[1];
        for (int i = 0; i < ${P - 1}; i++) if (i == k) { a = uPath[i]; b = uPath[i + 1]; }
        vec3 born = (uBikeMat * vec4(mix(a, b, fract(s)), 1.0)).xyz;
        float t = age * life;
        vec3 p = born + vec3(uWind.x * 0.35 * t + sin(t * 1.7 + aSeed.w * 9.0) * 0.05 * t, 0.32 * t - 0.03 * t * t, uWind.z * 0.3 * t + cos(t * 1.3 + aSeed.x * 7.0) * 0.05 * t);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = 0.03 + age * 0.2;
        gl_PointSize = size * uDpr * 900.0 / max(-mv.z, 0.2) * projectionMatrix[1][1] * 0.5;
        vec3 V = normalize(p - cameraPosition);
        vec3 lit = uAmbient * 6.0;
        for (int i = 0; i < ${L}; i++) {
          vec3 ld = p - uLPos[i];
          float dist = max(length(ld), 0.05);
          vec3 ln = ld / dist;
          float cone = uLDir[i].w < -1.5 ? 1.0 : smoothstep(uLDir[i].w, uLDir[i].w + 0.08, dot(ln, uLDir[i].xyz));
          float fwd = pow(max(dot(ln, -V), 0.0), 3.0);
          lit += uLCol[i] * cone / (1.0 + dist * dist) * (0.3 + 1.2 * fwd);
        }
        float fade = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.35, 1.0, age));
        vC = lit * fade * uHeat * 0.018;
        vRot = aSeed.w * 6.2831;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex;
      varying vec3 vC; varying float vRot;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float c = cos(vRot), s = sin(vRot);
        q = mat2(c, -s, s, c) * q * vec2(1.0, 1.35);
        float a = texture2D(uTex, q + 0.5).r;
        gl_FragColor = vec4(vC * a, 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 7;
  return { points: pts, uniforms };
}
