// Still Water — the pond surface.
//  RippleSim: height-field wave equation in ping-pong float targets, plus a derived surface texture (h, dh/dx, dh/dz, laplacian).
//  waterMaterial: the surface shader — screen-space refraction of the under-water pass with depth absorption,
//  fresnel reflection of sky and maple canopy, sun glints, moon and lantern reflections.
//  patchUnder: caustics + depth-in-alpha for every material that is drawn in the under-water pass.
import * as THREE from 'three';
import { bakeTexture } from '../../src/core/textures.js';
import { pondSDF } from './shape.js';

const quadGeo = new THREE.PlaneGeometry(2, 2);
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';

function pass(frag, uniforms) {
  const mat = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(quadGeo, mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return { mat, scene, uniforms };
}

const MAX_DROPS = 24;

export class RippleSim {
  constructor(renderer, { res = 1024, x0 = -10, z0 = -8.5, size = 20 } = {}) {
    this.renderer = renderer;
    this.res = res;
    this.rect = new THREE.Vector4(x0, z0, size, size / res); // xmin, zmin, size, texel (m)
    const gl = renderer.getContext();
    const floatOK = !!gl.getExtension('EXT_color_buffer_float');
    const type = floatOK ? THREE.FloatType : THREE.HalfFloatType;
    const opts = { type, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };
    this.a = new THREE.WebGLRenderTarget(res, res, opts);
    this.b = new THREE.WebGLRenderTarget(res, res, opts);
    this.surf = new THREE.WebGLRenderTarget(res, res, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
    this.texture = this.surf.texture;

    // Land mask: waves reflect off the shore instead of running up the moss.
    const MR = 256, md = new Uint8Array(MR * MR * 4);
    for (let j = 0; j < MR; j++) for (let i = 0; i < MR; i++) {
      const x = x0 + (i + 0.5) / MR * size, z = z0 + (j + 0.5) / MR * size;
      const d = pondSDF(x, z);
      const m = Math.min(1, Math.max(0, (-d + 0.02) / 0.18));
      md.set([m * 255, m * 255, m * 255, 255], (j * MR + i) * 4);
    }
    this.mask = new THREE.DataTexture(md, MR, MR, THREE.RGBAFormat);
    this.mask.magFilter = this.mask.minFilter = THREE.LinearFilter;
    this.mask.needsUpdate = true;

    this.dropA = Array.from({ length: MAX_DROPS }, () => new THREE.Vector4());
    this.dropB = Array.from({ length: MAX_DROPS }, () => new THREE.Vector4());
    this.queue = [];
    this.stepPass = pass(/* glsl */`
      precision highp float;
      uniform sampler2D uPrev, uMask; uniform vec2 uTexel; uniform float uDamp;
      uniform vec4 uDropA[${MAX_DROPS}]; uniform vec4 uDropB[${MAX_DROPS}]; uniform int uN;
      varying vec2 vUv;
      void main(){
        vec4 info = texture2D(uPrev, vUv);
        float avg = (texture2D(uPrev, vUv - vec2(uTexel.x, 0.)).r + texture2D(uPrev, vUv + vec2(uTexel.x, 0.)).r +
                     texture2D(uPrev, vUv - vec2(0., uTexel.y)).r + texture2D(uPrev, vUv + vec2(0., uTexel.y)).r) * 0.25;
        info.g += (avg - info.r) * 2.0;
        info.g *= uDamp;
        info.r += info.g;
        info.r *= 0.99965;
        for (int i = 0; i < ${MAX_DROPS}; i++) {
          if (i >= uN) break;
          vec4 a = uDropA[i]; vec4 b = uDropB[i];
          vec2 pa = vUv - a.xy, ba = a.zw - a.xy;
          float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0., 1.);
          float d = length(pa - ba * t) / b.x;
          if (d < 1.) info.r += (0.5 + 0.5 * cos(3.14159265 * d)) * b.y;
        }
        float m = texture2D(uMask, vUv).r;
        info.rg *= m;
        gl_FragColor = info;
      }`, {
      uPrev: { value: null }, uMask: { value: this.mask }, uTexel: { value: new THREE.Vector2(1 / res, 1 / res) }, uDamp: { value: 0.9955 },
      uDropA: { value: this.dropA }, uDropB: { value: this.dropB }, uN: { value: 0 },
    });
    this.surfPass = pass(/* glsl */`
      precision highp float;
      uniform sampler2D uSim; uniform vec2 uTexel; uniform float uTw;
      varying vec2 vUv;
      void main(){
        float h = texture2D(uSim, vUv).r;
        float l = texture2D(uSim, vUv - vec2(uTexel.x, 0.)).r, r = texture2D(uSim, vUv + vec2(uTexel.x, 0.)).r;
        float d = texture2D(uSim, vUv - vec2(0., uTexel.y)).r, u = texture2D(uSim, vUv + vec2(0., uTexel.y)).r;
        gl_FragColor = vec4(h, (r - l) / (2. * uTw), (u - d) / (2. * uTw), (l + r + u + d - 4. * h) / (uTw * uTw));
      }`, { uSim: { value: null }, uTexel: { value: new THREE.Vector2(1 / res, 1 / res) }, uTw: { value: size / res } });
    this.acc = 0;
    this.clear();
  }

  clear() {
    const r = this.renderer, prev = r.getRenderTarget();
    for (const t of [this.a, this.b, this.surf]) { r.setRenderTarget(t); r.setClearColor(0, 0); r.clear(); }
    r.setRenderTarget(prev);
  }

  /** A soft disc (or capsule from a to b) of displaced water, in world metres. strength in metres of height. */
  drop(x, z, radius = 0.06, strength = 0.01, x2 = x, z2 = z) {
    if (this.queue.length > 96) return;
    this.queue.push([x, z, x2, z2, radius, strength]);
  }

  step(dt) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    this.acc = Math.min(this.acc + dt * 60, 3);
    const R = this.rect;
    const toU = (x, z) => [(x - R.x) / R.z, (z - R.y) / R.z];
    let steps = 0;
    while (this.acc >= 1 || (steps === 0 && this.queue.length)) {
      this.acc = Math.max(0, this.acc - 1);
      const n = Math.min(MAX_DROPS, this.queue.length);
      for (let i = 0; i < n; i++) {
        const [x, z, x2, z2, rad, s] = this.queue.shift();
        const [u1, v1] = toU(x, z), [u2, v2] = toU(x2, z2);
        this.dropA[i].set(u1, v1, u2, v2);
        this.dropB[i].set(rad / R.z, s, 0, 0);
      }
      const u = this.stepPass.uniforms;
      u.uN.value = n;
      u.uPrev.value = this.a.texture;
      r.setRenderTarget(this.b);
      r.render(this.stepPass.scene, orthoCam);
      [this.a, this.b] = [this.b, this.a];
      steps++;
      if (steps > 3) break;
    }
    this.surfPass.uniforms.uSim.value = this.a.texture;
    r.setRenderTarget(this.surf);
    r.render(this.surfPass.scene, orthoCam);
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAuto;
  }
}

// ─── Procedural textures ───────────────────────────────────────────────────────
export function causticTexture(renderer) {
  const t = bakeTexture(renderer, 1024, /* glsl */`
    vec2 h2(vec2 p){ p = mod(p, 7.0); return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
    void main(){
      vec2 p = vUv * 7.0;
      p += vec2(fbm(vUv * 3., 3., 3, .5), fbm(vUv * 3. + 5.3, 3., 3, .5)) * 1.1;
      vec2 ip = floor(p), fp = fract(p);
      float f1 = 9., f2 = 9.;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 r = g + h2(ip + g) * 0.9 + 0.05 - fp;
        float d = dot(r, r);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
      float e = sqrt(f2) - sqrt(f1);
      float c = pow(1.0 - smoothstep(0.0, 0.2, e), 2.2) + pow(1.0 - smoothstep(0.0, 0.5, e), 3.0) * 0.25;
      gl_FragColor = vec4(vec3(c), 1.);
    }`);
  return t;
}

/** Small wind ripples: RG = tangent-space slope, B = broad breeze patches. Tileable. */
export function microTexture(renderer) {
  return bakeTexture(renderer, 512, /* glsl */`
    float H(vec2 p){ return fbm(p * 5., 5., 3, .45); }
    void main(){
      float e = 1. / 512.;
      float hx = H(vUv + vec2(e, 0.)) - H(vUv - vec2(e, 0.));
      float hy = H(vUv + vec2(0., e)) - H(vUv - vec2(0., e));
      vec2 s = vec2(hx, hy) * 30.;
      float b = fbm(vUv * 2., 2., 4, .5) * .5 + .5;
      gl_FragColor = vec4(s * .5 + .5, b, 1.);
    }`);
}

// ─── Caustics + depth output for under-water materials ─────────────────────────
export const underShared = {
  uSurf: { value: null }, uSimRect: { value: new THREE.Vector4() }, uCaust: { value: null }, uTime: { value: 0 },
  uSunRefr: { value: new THREE.Vector2(0.2, 0.3) }, uCaustK: { value: 1 }, uDepthOut: { value: 0 }, uFocus: { value: 0.006 },
  uLightAbs: { value: new THREE.Vector3(0.55, 0.16, 0.3) },
  uCookie: { value: null }, uCanopyMat: { value: new THREE.Matrix3() }, uCanopyH: { value: 6.5 }, uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
  uDappleK: { value: 1 }, uLeafLight: { value: 0.16 },
};
export const CAUSTIC_GLSL = /* glsl */`
  uniform sampler2D uSurf, uCaust, uCookie; uniform vec4 uSimRect; uniform float uTime, uCaustK, uDepthOut, uFocus, uCanopyH, uDappleK, uLeafLight;
  uniform vec2 uSunRefr; uniform vec3 uLightAbs, uKeyDir; uniform mat3 uCanopyMat;
  varying vec3 vWP;
  float dappleAt(vec3 wp){
    float t = (uCanopyH - wp.y) / max(uKeyDir.y, 0.08);
    vec2 cuv = (uCanopyMat * vec3(wp.xz + uKeyDir.xz * t, 1.)).xy;
    vec2 e = smoothstep(vec2(0.), vec2(0.08), cuv) * smoothstep(vec2(1.), vec2(0.92), cuv);
    float c = texture2D(uCookie, cuv, 0.6).r;
    return mix(1., mix(uLeafLight, 1., smoothstep(0.25, 0.85, c)), e.x * e.y * uDappleK);
  }
  vec3 causticsAt(vec3 wp){
    float depth = max(-wp.y, 0.);
    vec2 sp = wp.xz + uSunRefr * depth;
    vec4 s = texture2D(uSurf, (sp - uSimRect.xy) / uSimRect.z);
    vec2 p = sp * 0.42 + s.yz * depth * 0.08;
    float c1 = texture2D(uCaust, p + vec2(uTime * 0.013, uTime * 0.008)).r;
    float c2 = texture2D(uCaust, p * 1.17 + vec2(-uTime * 0.011, uTime * 0.012) + 0.37).r;
    float c = pow((c1 + c2) * 0.5, 1.2) * 1.45;
    float focus = clamp(-s.w * uFocus * min(depth, 1.2), -0.85, 2.5);
    float k = smoothstep(0.0, 0.18, depth) * uCaustK;
    return max(mix(1.0, (0.3 + c * 2.8) * (1.0 + focus), k), 0.0) * exp(-uLightAbs * depth);
  }
`;

/** Patch a standard material so it gets caustics under water and writes view distance to alpha in the under pass. */
export function patchUnder(mat, { extraVertexHead = '', extraFragHead = '', mapFragment = null, roughFragment = null, custom = null, key = '' } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    Object.assign(shader.uniforms, underShared);
    custom?.uniforms && Object.assign(shader.uniforms, custom.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\n' + extraVertexHead)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 kwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          kwp = instanceMatrix * kwp;
        #endif
        vWP = (modelMatrix * kwp).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + CAUSTIC_GLSL + extraFragHead)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nfloat kDap = dappleAt(vWP); vec3 kCaust = mix(vec3(1.), causticsAt(vWP), smoothstep(0.25, 0.85, kDap)) * kDap;')
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin
        .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\ndirectLight.color *= kCaust;'))
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif (uDepthOut > 0.5) gl_FragColor.a = length(vViewPosition);');
    if (mapFragment) shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', mapFragment);
    if (roughFragment) shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', roughFragment);
    prev?.(shader, r);
    custom?.patch?.(shader);
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => 'under' + key + (prevKey ? prevKey() : '');
  return mat;
}

// ─── The surface ───────────────────────────────────────────────────────────────
export function waterMaterial(u) {
  return new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform sampler2D uUnder, uSurf, uMicro, uCanopy, uCookie, uRefl; uniform mat4 uReflMat;
      uniform vec2 uUnderSize; uniform vec4 uSimRect;
      uniform mat3 uCanopyMat; uniform float uCanopyH;
      uniform vec3 uSunDir, uSunCol, uZenith, uHorizon, uAbsorb, uScatter, uMoonDir, uMoonCol, uLampPos, uLampCol, uLeafTint;
      uniform float uTime, uSlope, uRefr, uWind, uAutumn, uBare, uGlint, uCanopyK, uReflK, uDebug, uMicroK;
      varying vec3 vW;

      vec3 skyAt(vec3 R, vec3 R0, vec3 P, float blur){
        float up = max(R.y, 0.03);
        vec3 sky = mix(uHorizon, uZenith, pow(up, 0.55));
        float t = (uCanopyH - P.y) / up;
        vec2 q = P.xz + R.xz * t;
        vec2 cuv = (uCanopyMat * vec3(q, 1.)).xy;
        vec2 e = smoothstep(vec2(0.), vec2(0.08), cuv) * smoothstep(vec2(1.), vec2(0.92), cuv);
        float inside = e.x * e.y * uCanopyK;
        vec3 c = texture2D(uCanopy, cuv, blur).rgb;
        float lum = dot(c, vec3(0.3, 0.55, 0.15));
        float leaf = 1. - smoothstep(0.35, 0.9, lum);
        vec3 autumn = uLeafTint * (0.25 + lum * 1.6);
        vec3 tr = mix(c, mix(c, autumn, leaf), uAutumn);
        tr = mix(tr, vec3(1.), uBare * leaf * 0.75);
        sky *= mix(vec3(1.), tr, inside);
        float md = dot(R0, uMoonDir);
        sky += uMoonCol * (smoothstep(0.999969, 0.999982, md) * 70. + pow(max(md, 0.), 9000.) * 0.8 + pow(max(md, 0.), 60.) * 0.015);
        // a scatter of stars where the canopy opens
        vec2 sg = R0.xz / max(R0.y, 0.2) * 70.;
        float sh = fract(sin(dot(floor(sg), vec2(12.9898, 78.233))) * 43758.5453);
        vec2 sf = fract(sg) - 0.5;
        float star = smoothstep(0.9965, 1.0, sh) * smoothstep(0.32, 0.0, length(sf));
        sky += uMoonCol * star * 3.5 * (1. - inside * leaf);
        vec3 lp = uLampPos - P;
        float lg = max(dot(R0, normalize(lp)), 0.);
        sky += uLampCol * (pow(lg, 2600.) * 30. + pow(lg, 160.) * 0.5 + pow(lg, 12.) * 0.03);
        return sky;
      }

      void main(){
        vec2 suv = (vW.xz - uSimRect.xy) / uSimRect.z;
        vec4 s = texture2D(uSurf, suv);
        vec3 n = normalize(vec3(-s.y * uSlope, 1., -s.z * uSlope));
        vec3 m1 = texture2D(uMicro, vW.xz * 0.23 + uTime * vec2(0.011, 0.007)).xyz;
        vec3 m2 = texture2D(uMicro, vW.xz * 0.61 + uTime * vec2(-0.009, 0.013)).xyz;
        float breeze = smoothstep(0.52, 0.78, texture2D(uMicro, vW.xz * 0.018 + uTime * vec2(0.0045, 0.003)).b);
        vec2 mslope = (m1.xy * 2. - 1.) + (m2.xy * 2. - 1.) * 0.6;
        mslope *= uMicroK;
        n = normalize(n + vec3(mslope.x, 0., mslope.y) * (0.022 + breeze * uWind));

        vec3 V = normalize(cameraPosition - vW);
        float NdV = clamp(dot(n, V), 0., 1.);
        float F = (0.02 + 0.98 * pow(1. - NdV, 5.)) * uReflK;

        vec2 sc = gl_FragCoord.xy / uUnderSize;
        float dS = length(cameraPosition - vW);
        vec4 u0 = texture2D(uUnder, sc);
        float L0 = max(u0.a - dS, 0.);
        vec3 nv = mat3(viewMatrix) * vec3(n.x, 0., n.z);
        vec2 off = nv.xy * uRefr * min(L0 + 0.1, 1.4);
        vec2 ruv = sc - off;
        ruv = clamp(ruv, vec2(0.002), vec2(0.998));
        vec4 u1 = texture2D(uUnder, ruv);
        float L = u1.a - dS;
        if (L < 0.) { u1 = u0; L = L0; }
        vec3 Tr = exp(-uAbsorb * L);
        vec3 scat = uScatter * (1. - exp(-L * 1.3));
        vec3 refr = u1.rgb * Tr + scat;

        // ripples read in a photograph mostly through what they reflect: exaggerate the reflection normal
        vec3 nR = normalize(vec3(-s.y * uSlope * 2.6 + mslope.x * (0.03 + breeze * uWind), 1., -s.z * uSlope * 2.6 + mslope.y * (0.03 + breeze * uWind)));
        vec3 R = reflect(-V, nR);
        float blur = clamp(length(s.yz) * 1.5 + breeze * 1.5, 0., 5.);
        vec3 R0 = reflect(-V, n);
        vec3 refl = skyAt(R, R0, vW, blur);
        // the garden itself — banks, lantern, lotus, the maple limb — mirrored in the water
        vec4 rp = uReflMat * vec4(vW, 1.0);
        vec2 rduv = rp.xy / rp.w + (mat3(viewMatrix) * vec3(nR.x - n.x * 0.0, 0., nR.z)).xy * 0.09;
        vec4 ro = texture2D(uRefl, rduv, blur * 0.5);
        refl = mix(refl, ro.rgb, clamp(ro.a, 0., 1.));
        float slope = length(s.yz);
        F = max(F, 0.035 * uReflK) + smoothstep(0.03, 0.4, slope) * 0.05 * uReflK;
        vec3 col = mix(refr, refl, F);
        // lit and shaded flanks of each ripple, as the eye reads them on a still pond
        vec2 ld = normalize(uSunDir.xz + vec2(0.0001));
        col += uHorizon * 0.018 * clamp(dot(-s.yz, ld) * 1.6 + slope * 0.6, -0.6, 1.2);

        float tt = (uCanopyH - vW.y) / max(uSunDir.y, 0.08);
        vec2 cuv = (uCanopyMat * vec3(vW.xz + uSunDir.xz * tt, 1.)).xy;
        vec2 ce = smoothstep(vec2(0.), vec2(0.08), cuv) * smoothstep(vec2(1.), vec2(0.92), cuv);
        float lit = mix(1., smoothstep(0.3, 0.9, texture2D(uCookie, cuv).r), ce.x * ce.y * uCanopyK);
        float sd = max(dot(R, uSunDir), 0.);
        col += uSunCol * lit * uGlint * pow(sd, 2400.) * 140.;
        // shallow shoreline: a soft meniscus sheen
        col += refl * smoothstep(0.08, 0.0, L) * 0.08;
        if (uDebug > 0.5 && uDebug < 1.5) col = u0.rgb;
        if (uDebug > 1.5 && uDebug < 2.5) col = refl;
        if (uDebug > 2.5 && uDebug < 3.5) col = vec3(fract(u0.a), fract(dS), L * 0.3);
        gl_FragColor = vec4(col, 1.);
      }`,
  });
}
