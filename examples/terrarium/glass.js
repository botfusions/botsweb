// Hand-blown glass cloche with a live condensation layer.
// The bell is a LatheGeometry whose UVs are (angle, arc length). A ping-pong render target holds the state of the
// inside surface of the glass in that UV space:  R = clear (wiped) · G = wet band (beads pushed aside by a wipe)
// B = drip trail · A = height of running drops (redrawn every frame). The glass material (MeshPhysicalMaterial with
// transmission) reads it to decide, per pixel, how frosted the view through the glass is, how milky the fog is and
// where the water beads bend the light.
import { THREE } from '../../src/core/engine.js';

const TAU = Math.PI * 2;
const N_PROFILE = 180;

/** Outer surface of the bell, rim → crown. Uniform arc-length sampling so v is proportional to distance along the glass. */
export function bellProfile() {
  const ctrl = [
    [0.664, 0.0], [0.666, 0.045], [0.659, 0.28], [0.646, 0.56], [0.626, 0.79], [0.592, 0.965],
    [0.532, 1.115], [0.442, 1.24], [0.322, 1.327], [0.176, 1.381], [0.06, 1.399], [0.0, 1.401],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const curve = new THREE.SplineCurve(ctrl);
  const pts = curve.getSpacedPoints(N_PROFILE - 1);
  const len = curve.getLength();
  const data = new Float32Array(N_PROFILE * 4);
  const slope = new Float32Array(N_PROFILE);
  for (let i = 0; i < N_PROFILE; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N_PROFILE - 1, i + 1)];
    const t = new THREE.Vector2().subVectors(b, a).normalize();
    data.set([pts[i].x, pts[i].y, t.x, t.y], i * 4);
    slope[i] = Math.abs(t.y);
  }
  const tex = new THREE.DataTexture(data, N_PROFILE, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  const at = (arr, v) => {
    const f = Math.min(Math.max(v, 0), 1) * (N_PROFILE - 1), i = Math.floor(f), k = f - i, j = Math.min(i + 1, N_PROFILE - 1);
    return arr(i) * (1 - k) + arr(j) * k;
  };
  return {
    pts, len, tex, n: N_PROFILE, rMax: 0.666,
    rAt: v => at(i => pts[i].x, v),
    yAt: v => at(i => pts[i].y, v),
    slopeAt: v => at(i => slope[i], v),
    /** local position on the bell for (u, v) — u = 0.5 faces +Z of the cloche group (the mesh is turned by π). */
    pos(u, v, out = new THREE.Vector3()) {
      const r = this.rAt(v), phi = u * TAU;
      return out.set(r * Math.sin(phi), this.yAt(v), r * Math.cos(phi));
    },
  };
}

const NOISE = /* glsl */`
  float gH(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec2 gH2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
  // value noise, periodic in x with period 'per' lattice cells
  float gN(vec2 p, float per){
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
    float i0 = mod(i.x, per), i1 = mod(i.x + 1., per);
    return mix(mix(gH(vec2(i0, i.y)), gH(vec2(i1, i.y)), u.x), mix(gH(vec2(i0, i.y + 1.)), gH(vec2(i1, i.y + 1.)), u.x), u.y);
  }
`;

// ─── Glass material ─────────────────────────────────────────────────────────────
function glassMaterial(glass) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.035, transmission: 1, thickness: 0.012, ior: 1.5,
    attenuationColor: new THREE.Color(0xe9f3e6), attenuationDistance: 1.2, specularIntensity: 1,
    envMapIntensity: 1.0, side: THREE.DoubleSide, transparent: false,
  });
  const U = glass.uniforms;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec2 vGUv; varying vec3 vGTan; varying vec3 vGUp; varying float vGR;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGUv = uv;
        vGR = length(position.xz);
        vec3 gT = normalize(vec3(position.z, 0.0, -position.x) + vec3(1e-6, 0.0, 0.0));
        vec3 gU = normalize(cross(normal, gT));
        vGTan = normalize((modelViewMatrix * vec4(gT, 0.0)).xyz);
        vGUp = normalize((modelViewMatrix * vec4(gU, 0.0)).xyz);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <transmission_fragment>', THREE.ShaderChunk.transmission_fragment)
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>
        uniform sampler2D uMask; uniform vec2 uTexel; uniform float uCirc, uLen, uRMax, uRoughFog, uMilkAmt, uMilkGain, uLensThick, uFogK, uFogMax, uTime, uGlint;
        uniform vec3 uEdgeTint;
        varying vec2 vGUv; varying vec3 vGTan; varying vec3 vGUp; varying float vGR;
        ${NOISE}
        float gNP(float scale){ float per = floor(uCirc / scale + .5); return gN(vec2(vGUv.x * per, vGUv.y * uLen / scale), per); }
        // one layer of beads on a jittered grid; returns (coverage, tilt.xy)
        vec3 gBeads(vec2 g, float per, float amt, float maxR, float sq, float seed){
          vec2 id0 = floor(g); vec3 best = vec3(0.);
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 id = id0 + vec2(float(i), float(j));
            vec2 idw = vec2(mod(id.x, per), id.y);
            vec2 h = gH2(idw + seed);
            float thr = gH(idw * 1.7 + seed * 3.1);
            float pres = smoothstep(thr, thr + .12, amt);
            vec2 c = id + .12 + .76 * h;
            float rad = maxR * (.35 + .65 * gH(idw + seed + 7.3)) * (.55 + .45 * pres);
            vec2 d = (g - c) * vec2(sq, 1.) / rad;
            float cov = pres * smoothstep(1., .62, dot(d, d));
            if (cov > best.x) best = vec3(cov, d);
          }
          return best;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec4 gM = texture2D(uMask, vGUv);
        float gSq = clamp(vGR / uRMax, .12, 1.);
        // condensation: speckled threshold so it re-forms as nucleating dots, not a flat fade
        float gSpeck = gNP(.011) * .6 + gNP(.034) * .4;
        float gThr = mix(.06, .92, gSpeck);
        float gFogAmt = 1. - gM.r;
        float gFog = min(smoothstep(gThr - .1, gThr + .1, gFogAmt) * uFogK, uFogMax);
        float gDens = .7 + .36 * gNP(.13) + .16 * (1. - smoothstep(.0, .2, vGUv.y)) - .05 * smoothstep(.75, 1., vGUv.y);
        gFog *= clamp(gDens, 0., 1.) * (gl_FrontFacing ? 1. : .62);
        // beads: micro condensation, the wet band pushed aside by a wipe, and a few big ones
        vec2 gm = vec2(vGUv.x, vGUv.y * uLen / uCirc);
        float perA = floor(uCirc / .0105 + .5), perB = floor(uCirc / .026 + .5), perC = floor(uCirc / .05 + .5);
        vec3 bA = gBeads(gm * perA, perA, gFog * .9, .34, gSq, 1.0);
        vec3 bB = gBeads(gm * perB, perB, clamp(gM.g * 1.5, 0., 1.) + gFog * .06, .36, gSq, 5.0);
        vec3 bC = gBeads(gm * perC, perC, clamp(gM.g * 1.25 - .3, 0., 1.) + gFog * .015, .34, gSq, 9.0);
        vec3 gB = bB; if (bC.x > gB.x) gB = bC;
        // running drops (height in A) and their trails (B)
        float hR = texture2D(uMask, vGUv + vec2(uTexel.x, 0.)).a, hL = texture2D(uMask, vGUv - vec2(uTexel.x, 0.)).a;
        float hU = texture2D(uMask, vGUv + vec2(0., uTexel.y)).a, hD = texture2D(uMask, vGUv - vec2(0., uTexel.y)).a;
        float tR = texture2D(uMask, vGUv + vec2(uTexel.x * 1.5, 0.)).b, tL = texture2D(uMask, vGUv - vec2(uTexel.x * 1.5, 0.)).b;
        float gDrop = smoothstep(.04, .35, gM.a);
        vec2 gTilt = gB.yz * gB.x * .8 + bA.yz * bA.x * .2 - vec2(hR - hL, hU - hD) * 1.6 - vec2(tR - tL, 0.) * .35;
        float gTr = gM.b * (1. - gDrop);
        float gLens = max(gB.x, gDrop);
        gFog *= 1. - gLens * .8;
        gTilt = clamp(gTilt, vec2(-.85), vec2(.85));
        // water catches the window: a bright point up-left, a darker meniscus at the rim
        float gGlint = smoothstep(.24, .0, length(gTilt - vec2(-.3, .34))) * gLens;
        float gRim = smoothstep(.32, .72, length(gTilt)) * gLens;
        float gGrain = gNP(.0065);
        normal = normalize(normal * sqrt(max(.05, 1. - dot(gTilt, gTilt))) + vGTan * gTilt.x + vGUp * gTilt.y);
        float gRough = uRoughFog * gFog;`)
      .replace('material.thickness = thickness;', 'material.thickness = thickness + gLens * uLensThick;')
      .replace('vec3 pos = vWorldPosition;', 'vec3 gLit = totalDiffuse;\n\tvec3 pos = vWorldPosition;')
      .replace('n, v, material.roughness, material.diffuseContribution', 'n, v, gRough, material.diffuseContribution')
      .replace('totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );', `totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
        float gLum = dot(transmitted.rgb, vec3(.2126, .7152, .0722));
        vec3 gMilk = (gLit * uMilkGain + mix(transmitted.rgb, vec3(gLum), .18) * .66) * (.93 + .14 * gGrain);
        totalDiffuse = mix(totalDiffuse, gMilk, gFog * uMilkAmt);
        totalDiffuse *= (1. + gTr * .05) * (1. - gRim * .4);
        totalDiffuse += (gLit * .5 + .35) * gGlint * uGlint;
        float gNV = abs(dot(normalize(vNormal), normalize(vViewPosition)));
        totalDiffuse *= mix(vec3(1.), uEdgeTint, pow(1. - gNV, 2.2) * (1. - gFog * .6));`);
  };
  mat.customProgramCacheKey = () => 'fogglass-3';
  return mat;
}

// ─── Mask simulation ────────────────────────────────────────────────────────────
const SIM_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uPrev, uProfile; uniform float uN, uDt, uGrow, uDry, uFront, uFrontOn, uR, uStr, uStroke, uWetDecay;
  uniform vec3 uA, uB;
  varying vec2 vUv;
  vec3 profilePos(vec2 uv){
    float f = clamp(uv.y, 0., 1.) * (uN - 1.); int i0 = int(floor(f)); float t = f - floor(f);
    vec4 a = texelFetch(uProfile, ivec2(i0, 0), 0), b = texelFetch(uProfile, ivec2(min(i0 + 1, int(uN) - 1), 0), 0);
    vec2 ry = mix(a.xy, b.xy, t); float phi = uv.x * 6.2831853;
    return vec3(ry.x * sin(phi), ry.y, ry.x * cos(phi));
  }
  float segDist(vec3 p, vec3 a, vec3 b){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0., 1.); return length(pa - ba * h); }
  void main(){
    vec4 s = texture2D(uPrev, vUv);
    float clear = s.r, wet = s.g, trail = s.b, fog = 1. - clear;
    // condensation nucleates slowly, then races: ~8 s from wiped to fully fogged
    float rate = uGrow * (.15 + 2.2 * fog) / 8.0 * (1. - .7 * trail);
    clear = max(0., clear - rate * uDt);
    clear = max(clear, uDry);
    clear = max(clear, uFrontOn * smoothstep(uFront - .05, uFront + .05, vUv.y));
    trail = max(0., trail - uDt / 6.5);
    wet = max(0., wet - uDt * uWetDecay);
    if (uStr > 0.) {
      vec3 P = profilePos(vUv);
      float d = segDist(P, uA, uB);
      float c = (1. - smoothstep(uR * .5, uR, d)) * uStr;
      clear = max(clear, c);
      float ring = smoothstep(uR * .6, uR * .93, d) * (1. - smoothstep(uR * 1.0, uR * 1.45, d));
      wet = clamp(wet * (1. - c * .92) + ring * uStroke, 0., 1.);
    }
    gl_FragColor = vec4(clear, wet, trail, 0.);
  }`;

const DROP_VERT = /* glsl */`
  attribute vec2 aP0, aP1; attribute float aR, aSU, aHead;
  uniform float uLen;
  varying vec2 vP, vA, vB; varying float vR, vSU, vHead;
  void main(){
    vec2 ext = vec2(aR * aSU, aR / uLen) * 1.7;
    vec2 lo = min(aP0, aP1) - ext, hi = max(aP0, aP1) + ext;
    vec2 p = mix(lo, hi, position.xy * .5 + .5);
    vP = p; vA = aP0; vB = aP1; vR = aR; vSU = aSU; vHead = aHead;
    gl_Position = vec4(p * 2. - 1., 0., 1.);
  }`;
const DROP_FRAG = /* glsl */`
  precision highp float;
  uniform float uLen;
  varying vec2 vP, vA, vB; varying float vR, vSU, vHead;
  void main(){
    if (vR <= 0.) discard;
    vec2 toM = vec2(1. / vSU, uLen);
    vec2 q = (vP - vB) * toM, a = (vA - vB) * toM;
    vec2 qh = q; qh.y *= q.y > 0. ? .78 : 1.12;           // tear shape: round front below, tail above
    float dh = length(qh) / vR;
    float head = (1. - smoothstep(.72, 1., dh)) * vHead;
    float height = sqrt(max(0., 1. - dh * dh)) * vHead;
    float h = clamp(dot(q, a) / max(dot(a, a), 1e-12), 0., 1.);
    float dtl = length(q - a * h);
    float trail = (1. - smoothstep(vR * .3, vR * .55, dtl)) * step(1e-7, dot(a, a));
    gl_FragColor = vec4(max(trail, head), 0., trail, height);
  }`;

const MAX_DROPS = 72;
const _ws = new THREE.Vector3();

export class FogGlass {
  constructor(renderer, profile, { res = [2048, 1024], envIntensity = 2.0 } = {}) {
    this.renderer = renderer;
    this.profile = profile;
    this.res = res;
    const rtOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, generateMipmaps: false };
    this.rt = [new THREE.WebGLRenderTarget(res[0], res[1], rtOpts), new THREE.WebGLRenderTarget(res[0], res[1], rtOpts)];
    this.idx = 0;
    const circ = TAU * profile.rMax;
    this.uniforms = {
      uMask: { value: this.rt[0].texture }, uTexel: { value: new THREE.Vector2(1 / res[0], 1 / res[1]) },
      uCirc: { value: circ }, uLen: { value: profile.len }, uRMax: { value: profile.rMax },
      uRoughFog: { value: 0.46 }, uMilkAmt: { value: 0.5 }, uMilkGain: { value: 0.32 }, uLensThick: { value: 0.1 },
      uFogK: { value: 1 }, uFogMax: { value: 1 }, uTime: { value: 0 }, uGlint: { value: 1.3 }, uEdgeTint: { value: new THREE.Color(0.66, 0.76, 0.68) },
    };

    // geometry: visible bell + low-res proxy for raycasting
    this.group = new THREE.Group();
    this.material = glassMaterial(this);
    this.material.envMapIntensity = envIntensity;
    this.mesh = new THREE.Mesh(new THREE.LatheGeometry(profile.pts, 200), this.material);
    this.mesh.rotation.y = Math.PI; // the lathe seam faces the wall
    this.mesh.renderOrder = 2;
    this.group.add(this.mesh);
    const proxyPts = [];
    for (let i = 0; i < 60; i++) proxyPts.push(profile.pts[Math.round(i / 59 * (profile.n - 1))]);
    this.proxy = new THREE.Mesh(new THREE.LatheGeometry(proxyPts, 72), new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
    this.proxy.visible = false;
    this.mesh.add(this.proxy);

    // knob and rolled rim: solid glass, a touch of dispersion
    const solid = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transmission: 1, thickness: 0.1, ior: 1.5,
      dispersion: 3, attenuationColor: new THREE.Color(0xe4f0df), attenuationDistance: 0.9, envMapIntensity: envIntensity * 1.2 });
    const knobPts = [[0, 1.388], [0.07, 1.392], [0.058, 1.41], [0.042, 1.44], [0.04, 1.462], [0.062, 1.485], [0.084, 1.52],
      [0.089, 1.55], [0.08, 1.585], [0.052, 1.61], [0.02, 1.62], [0, 1.621]].map(([x, y]) => new THREE.Vector2(x, y));
    const knob = new THREE.Mesh(new THREE.LatheGeometry(new THREE.SplineCurve(knobPts).getSpacedPoints(48), 64), solid);
    knob.renderOrder = 3;
    this.group.add(knob);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(profile.rMax - 0.004, 0.011, 16, 200), solid.clone());
    rim.material.thickness = 0.03; rim.material.dispersion = 1;
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.012; rim.renderOrder = 3;
    this.group.add(rim);
    this.solids = [knob, rim];

    // simulation passes
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.simMat = new THREE.ShaderMaterial({
      uniforms: {
        uPrev: { value: null }, uProfile: { value: profile.tex }, uN: { value: profile.n }, uDt: { value: 0 }, uGrow: { value: 1 },
        uDry: { value: 0 }, uFront: { value: 0 }, uFrontOn: { value: 0 }, uR: { value: 0.1 }, uStr: { value: 0 }, uStroke: { value: 0 },
        uWetDecay: { value: 1 / 30 }, uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: SIM_FRAG, depthTest: false, depthWrite: false,
    });
    this.simScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.simMat);
    quad.frustumCulled = false;
    this.simScene.add(quad);

    const dg = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(2, 2);
    dg.index = base.index; dg.setAttribute('position', base.getAttribute('position'));
    this.dA = {
      aP0: new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS * 2), 2),
      aP1: new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS * 2), 2),
      aR: new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS), 1),
      aSU: new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS), 1),
      aHead: new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS), 1),
    };
    for (const [k, a] of Object.entries(this.dA)) { a.setUsage(THREE.DynamicDrawUsage); dg.setAttribute(k, a); }
    dg.instanceCount = MAX_DROPS;
    this.dropMat = new THREE.ShaderMaterial({
      uniforms: { uLen: { value: profile.len } }, vertexShader: DROP_VERT, fragmentShader: DROP_FRAG,
      depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendEquationAlpha: THREE.MaxEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    });
    const dm = new THREE.Mesh(dg, this.dropMat);
    dm.frustumCulled = false;
    this.dropScene = new THREE.Scene();
    this.dropScene.add(dm);
    this.drops = [];

    this.brushQ = null;
    this.front = null;
    this.dry = 0;
    this.grow = 1;
    this.wetDecay = 1 / 30;
    this.ambientDrops = 0.55; // drops per second that run on their own
    this.active = true;
    this.clear(0);
  }

  get scale() { return this.group.scale.x; }

  /** Fill the whole mask: 0 = fully fogged, 1 = clear. */
  clear(v = 0) {
    const r = this.renderer, prev = r.getRenderTarget(), cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
    for (const t of this.rt) { r.setRenderTarget(t); r.setClearColor(new THREE.Color(v, 0, 0), 1); r.clear(true, false, false); }
    r.setRenderTarget(prev); r.setClearColor(cc, ca);
  }

  /** Brush stroke in the bell mesh's local space (A → B), radius in world units. */
  brush(a, b, radiusWorld, strength = 1) {
    const s = this.mesh.getWorldScale(_ws).x;
    const len = a.distanceTo(b);
    const R = radiusWorld / s;
    this.brushQ = { a: a.clone(), b: b.clone(), R, str: strength, stroke: Math.min(len / R * 0.32, 0.6) };
    // wipes push water to their edges; some of it gathers into drops and runs
    this._acc = (this._acc ?? 0) + len;
    const spacing = R * 0.9;
    while (this._acc > spacing) {
      this._acc -= spacing;
      if (Math.random() < 0.5) {
        const p = new THREE.Vector3().lerpVectors(a, b, Math.random());
        const uv = this.uvOf(p);
        if (uv.v < 0.07 || this.profile.slopeAt(uv.v) < 0.35) continue;
        this.spawnDrop(uv.u + (Math.random() - 0.5) * 0.004, uv.v - R * (0.95 + Math.random() * 0.2) / this.profile.len,
          0.009 + Math.random() * 0.011, 0.25 + Math.random() * 2.2);
      }
    }
  }

  uvOf(p) {
    let u = Math.atan2(p.x, p.z) / TAU; if (u < 0) u += 1;
    // invert the profile's height (monotonic) by bisection
    let lo = 0, hi = 1;
    for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (this.profile.yAt(m) < p.y) lo = m; else hi = m; }
    return { u, v: (lo + hi) / 2 };
  }

  spawnDrop(u, v, r, stick = 1) {
    if (v < 0.02 || v > 0.9) return;
    if (this.drops.length >= MAX_DROPS) this.drops.shift();
    this.drops.push({ u, v, pu: u, pv: v, r, age: 0, stick, seed: Math.random() * 100, head: 0 });
  }

  /** Run one simulation step. */
  step(dt, t) {
    if (!this.active) return;
    const r = this.renderer, U = this.simMat.uniforms, P = this.profile;
    // ambient run-off: drops that let go on their own, mostly low on the walls
    this._amb = (this._amb ?? 0) + dt * this.ambientDrops * (1 - this.dry);
    while (this._amb > 1) {
      this._amb -= 1;
      this.spawnDrop(Math.random(), 0.12 + Math.random() * 0.55, 0.008 + Math.random() * 0.012, Math.random() * 1.5);
    }
    // drops
    const A = this.dA;
    for (let i = 0; i < MAX_DROPS; i++) {
      const d = this.drops[i];
      if (!d) { A.aR.array[i] = 0; A.aHead.array[i] = 0; A.aP0.array.set([-5, -5], i * 2); A.aP1.array.set([-5, -5], i * 2); continue; }
      d.pu = d.u; d.pv = d.v;
      d.age += dt;
      d.head = Math.min(1, d.head + dt * 3);
      if (d.age > d.stick) {
        const n = 0.5 + 0.5 * Math.sin(t * 2.1 + d.seed) * Math.sin(t * 3.7 + d.seed * 1.7);
        const go = n < 0.28 ? 0 : Math.min(1, (n - 0.28) * 2.5);
        const speed = (0.035 + d.r * 7) * P.slopeAt(d.v) * go;
        d.v -= speed * dt / P.len;
        d.u += Math.sin(t * 1.3 + d.seed * 7) * speed * dt * 0.35 / (TAU * Math.max(P.rAt(d.v), 0.05));
        d.r = Math.max(0, d.r - speed * dt * 0.02);
      }
      if (this.dry > 0.5) d.r -= dt * 0.02;
      A.aP0.array.set([d.pu, d.pv], i * 2);
      A.aP1.array.set([d.u, d.v], i * 2);
      A.aR.array[i] = Math.max(0, d.r);
      A.aSU.array[i] = 1 / (TAU * Math.max(P.rAt(d.v), 0.05));
      A.aHead.array[i] = d.head;
    }
    this.drops = this.drops.filter(d => d.v > 0.012 && d.r > 0.004);
    for (const a of Object.values(A)) a.needsUpdate = true;

    U.uPrev.value = this.rt[this.idx].texture;
    U.uDt.value = dt;
    U.uGrow.value = this.grow;
    U.uDry.value = this.dry;
    U.uWetDecay.value = this.wetDecay + this.dry * 2;
    if (this.front) { U.uFrontOn.value = 1; U.uFront.value = this.front.v; } else U.uFrontOn.value = 0;
    const b = this.brushQ;
    if (b) { U.uA.value.copy(b.a); U.uB.value.copy(b.b); U.uR.value = b.R; U.uStr.value = b.str; U.uStroke.value = b.stroke; }
    else U.uStr.value = 0;
    this.brushQ = null;

    const out = this.rt[1 - this.idx];
    const prev = r.getRenderTarget(), ac = r.autoClear;
    r.setRenderTarget(out);
    r.autoClear = false;
    r.render(this.simScene, this.cam);
    r.render(this.dropScene, this.cam);
    r.autoClear = ac;
    r.setRenderTarget(prev);
    this.idx = 1 - this.idx;
    this.uniforms.uMask.value = out.texture;
    this.uniforms.uTime.value = t;
  }

  /** Raycast the bell; returns { local, uv } or null. */
  hit(raycaster) {
    const h = raycaster.intersectObject(this.proxy, false)[0];
    if (!h) return null;
    const local = this.mesh.worldToLocal(h.point.clone());
    return { local, point: h.point, uv: h.uv };
  }

  /** Mesh-local azimuth (0..1 in u) that faces a world-space point, e.g. the camera. */
  uFacing(worldPoint) {
    const p = this.mesh.worldToLocal(worldPoint.clone());
    let u = Math.atan2(p.x, p.z) / TAU; if (u < 0) u += 1;
    return u;
  }
}
