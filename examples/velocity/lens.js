// The X-ray lens. The shoe is rendered a second time — scissored to the lens, with a real zoom via camera view offset —
// in one of three alternate modes, then composited over the product shot with a refractive glass rim.
import { THREE } from '../../src/core/engine.js';
import { Effect, EffectPass } from 'postprocessing';
import { NOISE, PROFILE, GAIT, PALETTE, PERTURB } from './shaders.js';

export const MODES = [
  { key: 'xray', name: 'X-RAY', bg: 0x03060b },
  { key: 'thermal', name: 'THERMAL', bg: 0x05030b },
  { key: 'cad', name: 'CAD', bg: 0x101216 },
];

// ─── Composite ────────────────────────────────────────────────────────────────
const LENS_FRAG = /* glsl */`
  uniform sampler2D tAlt; uniform sampler2D tPrev;
  uniform vec2 uC; uniform float uR; uniform float uZ; uniform float uWipe; uniform vec2 uVel; uniform float uHot; uniform float uTimeL;
  uniform vec3 uTint; uniform float uMix;

  vec3 altAt(sampler2D t, vec2 o, float g, float ca){
    return vec3(texture2D(t, uC + o * g * (1.0 + ca)).r, texture2D(t, uC + o * g).g, texture2D(t, uC + o * g * (1.0 - ca)).b);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
    vec2 px = (uv - uC) * resolution;
    float R = max(uR, 1.0);
    // liquid squash & stretch along the lens velocity
    float sp = length(uVel);
    vec2 vd = sp > 1e-3 ? uVel / sp : vec2(1.0, 0.0);
    vec2 pd = vec2(-vd.y, vd.x);
    float st = clamp(sp * 0.00012, 0.0, 0.2);
    vec2 qs = vd * dot(px, vd) * (1.0 - st) + pd * dot(px, pd) * (1.0 + st * 0.5);
    float d = length(qs) / R;
    float aa = 1.2 / R;
    vec3 col = inputColor.rgb;
    vec2 dir = px / max(length(px), 1e-3);

    // Outside: the glass lip bends the product shot, and the puck casts a soft shadow onto the page.
    if (d >= 1.0) {
      float lip = smoothstep(1.0 + 16.0 / R, 1.0, d);
      vec2 duv = uv - dir * lip * lip * 9.0 / resolution;
      vec3 bent = vec3(texture2D(inputBuffer, duv - dir * 1.5 / resolution).r, texture2D(inputBuffer, duv).g, texture2D(inputBuffer, duv + dir * 1.5 / resolution).b);
      col = mix(col, bent, lip);
      float sd = length(px - vec2(0.0, -R * 0.09)) / R;
      float sh = smoothstep(1.5, 0.98, sd);
      col *= 1.0 - 0.16 * sh * sh;
    }

    // Inside: the alternate render, magnified at the centre and compressed at the rim like a thick loupe.
    float inside = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
    if (inside > 0.0) {
      float dd = min(d, 1.0);
      float g = 1.0 + (uZ - 1.0) * pow(dd, 3.2);
      float ca = 0.05 * pow(dd, 5.0);
      vec2 o = px / resolution;
      vec3 a = altAt(tAlt, o, g, ca);
      if (uWipe < 1.0) {
        vec3 p = altAt(tPrev, o, g, ca);
        float w = uWipe * 1.15;
        a = mix(p, a, smoothstep(w, w - 0.04, dd));
        a += vec3(0.85, 1.0, 0.25) * 2.6 * exp(-pow((dd - w) * 34.0, 2.0)) * (1.0 - uWipe);
      }
      // glow around hot internals (the plate), independent of the page bloom
      vec3 glo = vec3(0.0);
      for (int k = 0; k < 8; k++) {
        float an = float(k) * 0.7854 + 0.39;
        vec2 dq = vec2(cos(an), sin(an)) / resolution;
        glo += max(texture2D(tAlt, uC + o * g + dq * 8.0).rgb - 0.6, 0.0);
        glo += max(texture2D(tAlt, uC + o * g + dq * 18.0).rgb - 0.6, 0.0) * 0.55;
      }
      a += glo * vec3(0.12, 0.045, 0.008);
      // glass: darker rim, a caustic crescent at the bottom right, a glint at the top left
      a *= mix(1.0, 0.5, smoothstep(0.72, 1.0, dd));
      float up = dot(dir, normalize(vec2(-0.62, 0.78)));
      a += vec3(1.0) * smoothstep(0.84, 0.985, dd) * smoothstep(0.35, 0.95, up) * 0.32;
      a += uTint * smoothstep(0.8, 0.98, dd) * smoothstep(0.4, 0.95, -up) * 0.22;
      col = mix(col, a, inside);
    }

    // Thin bright inner ring + dark bezel
    float ring = exp(-pow((d - 0.988) * R / 1.05, 2.0));
    col += uTint * ring * (2.6 + uHot * 6.0);
    float bw = 3.0 / R;
    float bezel = smoothstep(1.0 - aa * 0.5, 1.0 + aa, d) * (1.0 - smoothstep(1.0 + bw, 1.0 + bw + aa, d));
    col = mix(col, vec3(0.008, 0.009, 0.011), bezel * 0.94);
    outputColor = vec4(mix(inputColor.rgb, col, uMix), inputColor.a);
  }
`;

class LensEffect extends Effect {
  constructor(uniforms) {
    super('LensEffect', LENS_FRAG, { uniforms: new Map(Object.entries(uniforms).map(([k, v]) => [k, new THREE.Uniform(v)])) });
  }
}

// ─── Mode materials ──────────────────────────────────────────────────────────
const SHELL_VERT = /* glsl */`
  uniform mat4 uShoeInv;
  varying vec3 vN; varying vec3 vVP; varying vec3 vSP; varying vec2 vUv;
  void main(){
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vSP = (uShoeInv * wp).xyz;
    vec4 mv = viewMatrix * wp;
    vVP = mv.xyz;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const XRAY_FRAG = /* glsl */`
  uniform sampler2D map; uniform sampler2D nmap; uniform float uTime; uniform float uScan;
  varying vec3 vN; varying vec3 vVP; varying vec3 vSP; varying vec2 vUv;
  ${NOISE} ${PROFILE} ${GAIT} ${PERTURB}
  void main(){
    vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
    vec3 mn = texture2D(nmap, vUv).xyz * 2.0 - 1.0; mn.xy *= 1.8;
    n = perturbN(n, vVP, vUv, normalize(mn));
    vec3 v = normalize(-vVP);
    float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 2.4);
    vec3 alb = texture2D(map, vUv).rgb;
    float lum = dot(alb, vec3(0.299, 0.587, 0.114));
    vec4 pr = prof(vSP.x);
    float mid = 1.0 - smoothstep(pr.a - 0.03, pr.a + 0.03, vSP.y);
    float sat = max(max(alb.r, alb.g), alb.b) - min(min(alb.r, alb.g), alb.b);
    float dens = mix(0.62, 1.0, mid) * mix(1.7, 0.75, lum) + sat * 2.2;
    vec3 cold = vec3(0.42, 0.7, 1.0);
    vec3 c = cold * (0.014 + 0.8 * fres + 1.1 * pow(1.0 - ndv, 8.0)) * dens;
    // foam cell walls on the midsole skin, squeezed by the footstrike
    float P = pressure(vSP.x);
    vec2 vr = voro3(vSP * vec3(20.0, 24.0 + P * 8.0, 20.0));
    float wall = 1.0 - smoothstep(0.0, 0.08, vr.y - vr.x);
    c += mix(cold, vec3(1.0, 0.62, 0.25), P * 0.6) * wall * mid * (0.018 + 0.12 * fres + P * 0.05);
    // scanning band
    float scan = exp(-pow((vSP.x - uScan) * 7.0, 2.0));
    c += vec3(0.7, 1.0, 0.25) * scan * (0.012 + 0.22 * fres);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const THERMAL_FRAG = /* glsl */`
  uniform float uTime;
  varying vec3 vN; varying vec3 vVP; varying vec3 vSP; varying vec2 vUv;
  ${NOISE} ${PROFILE} ${GAIT} ${PALETTE}
  void main(){
    vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(-vVP);
    float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
    vec4 pr = prof(vSP.x);
    float h = max(vSP.y - pr.r, 0.0);
    float mid = 1.0 - smoothstep(pr.a - 0.04, pr.a + 0.05, vSP.y + (fbm3(vSP * 6.0) - 0.5) * 0.06);
    float xw = vSP.x + (fbm3(vSP * 3.2 + 4.0) - 0.5) * 0.22 - h * 0.35;
    float P = pressure(xw);
    float Rz = residual(xw);
    float sole = exp(-h * 8.0);
    float collar = exp(-pow((vSP.x + 0.4) / 0.32, 2.0)) * smoothstep(0.05, 0.38, vSP.y);
    float toe = smoothstep(0.55, 0.95, vSP.x);
    float inner = gl_FrontFacing ? 0.0 : 0.22;
    float T = mix(0.3, 0.47, 1.0 - mid) + (1.0 - mid) * (0.26 * collar - 0.12 * toe) + inner;
    T += (P * 0.62 + Rz * 0.42) * sole + mid * (P * 0.2 + Rz * 0.15);
    T += (fbm3(vSP * 7.0 + vec3(0.0, uTime * 0.12, 0.0)) - 0.5) * 0.08;
    T *= 0.86 + 0.14 * ndv;
    vec3 c = ironbow(T);
    float k = T * 16.0; float w = fwidth(k); float fk = min(fract(k), 1.0 - fract(k));
    c *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, w * 1.4, fk));
    gl_FragColor = vec4(c * 1.08, 1.0);
  }
`;

const FLOORHEAT_FRAG = /* glsl */`
  uniform float uTime; uniform mat4 uShoeInv; uniform vec2 uFloorC;
  varying vec3 vWP;
  ${NOISE} ${PROFILE} ${GAIT} ${PALETTE}
  void main(){
    vec3 sp = (uShoeInv * vec4(vWP, 1.0)).xyz;
    vec4 pr = prof(sp.x);
    float inX = smoothstep(uProfX.x - 0.03, uProfX.x + 0.07, sp.x) * smoothstep(uProfX.y + 0.03, uProfX.y - 0.07, sp.x);
    float dz = abs(sp.z - pr.g) - pr.b * 0.92;
    float foot = smoothstep(0.035, -0.035, dz) * inX;
    float halo = exp(-max(dz, 0.0) * 10.0) * mix(0.4, 1.0, inX) * smoothstep(uProfX.x - 0.4, uProfX.x, sp.x) * smoothstep(uProfX.y + 0.4, uProfX.y, sp.x);
    float gap = max(pr.r - sp.y, 0.0);
    float contact = exp(-gap * 22.0);
    float xw = sp.x + (fbm3(vec3(sp.xz * 3.0, 1.7)) - 0.5) * 0.2;
    float heat = pressure(xw) + residual(xw) * 0.9;
    float T = 0.06 + (foot * 0.62 + halo * 0.2) * contact * heat;
    T += (vnoise(vec3(vWP.xz * 38.0, uTime * 3.0)) - 0.5) * 0.025;
    float fade = smoothstep(3.2, 0.6, length(vWP.xz - uFloorC));
    vec3 c = ironbow(T) * mix(0.35, 1.0, fade);
    float k = T * 16.0; float w = fwidth(k); float fk = min(fract(k), 1.0 - fract(k));
    c *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, w * 1.4, fk)) * step(0.1, T);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const NORMAL_FRAG = /* glsl */`
  varying vec3 vN; varying vec3 vVP;
  void main(){ vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; gl_FragColor = vec4(n * 0.5 + 0.5, -vVP.z * 0.1); }
`;

const CAD_FRAG = /* glsl */`
  uniform sampler2D tN; uniform vec2 uRes; uniform float uDpr; uniform vec2 uC; uniform float uTime;
  vec4 N(vec2 o){ return texture2D(tN, (gl_FragCoord.xy + o) / uRes); }
  float cov(vec4 s){ return step(0.0005, s.a); }
  float grid(vec2 p, float s, float w){ vec2 m = abs(fract(p / s + 0.5) - 0.5) * s; return 1.0 - smoothstep(0.0, w, min(m.x, m.y)); }
  void main(){
    float s = max(uDpr, 1.0);
    vec4 c = N(vec2(0.0));
    vec4 l = N(vec2(-s, 0.0)), r = N(vec2(s, 0.0)), u = N(vec2(0.0, s)), d = N(vec2(0.0, -s));
    vec4 lu = N(vec2(-s, s)), ru = N(vec2(s, s)), ld = N(vec2(-s, -s)), rd = N(vec2(s, -s));
    vec3 gx = (ru.rgb + 2.0 * r.rgb + rd.rgb) - (lu.rgb + 2.0 * l.rgb + ld.rgb);
    vec3 gy = (lu.rgb + 2.0 * u.rgb + ru.rgb) - (ld.rgb + 2.0 * d.rgb + rd.rgb);
    float cv = cov(c);
    float allc = cov(l) * cov(r) * cov(u) * cov(d) * cov(lu) * cov(ru) * cov(ld) * cov(rd) * cv;
    float anyc = max(max(max(cov(l), cov(r)), max(cov(u), cov(d))), cv);
    float sil = anyc * (1.0 - allc);
    float en = (length(gx) + length(gy)) * allc;
    float dx = (ru.a + 2.0 * r.a + rd.a) - (lu.a + 2.0 * l.a + ld.a);
    float dy = (lu.a + 2.0 * u.a + ru.a) - (ld.a + 2.0 * d.a + rd.a);
    float ed = (abs(dx) + abs(dy)) / max(c.a, 0.02) * allc;
    float line = max(smoothstep(1.0, 1.8, en) * 0.6, smoothstep(0.1, 0.24, ed));
    line = max(line, sil);
    vec2 cp = gl_FragCoord.xy / s;
    vec3 bg = vec3(0.0052, 0.0058, 0.0072);
    bg += vec3(0.010, 0.012, 0.016) * grid(cp, 12.0, 0.7) + vec3(0.02, 0.024, 0.03) * grid(cp, 60.0, 0.9);
    vec3 n = c.rgb * 2.0 - 1.0;
    float lam = clamp(dot(n, normalize(vec3(-0.45, 0.65, 0.6))), 0.0, 1.0);
    float hatch = step(0.62, fract((cp.x + cp.y) / 4.0)) * (1.0 - smoothstep(0.15, 0.5, lam));
    vec3 fill = vec3(0.012, 0.014, 0.018) + vec3(0.024, 0.028, 0.034) * lam + vec3(0.02, 0.024, 0.03) * hatch;
    vec3 col = mix(bg, fill, cv);
    col = mix(col, vec3(0.78, 0.84, 0.92), clamp(line, 0.0, 1.0) * 0.92);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const BG_VERT = 'varying vec2 vQ; void main(){ vQ = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const XRAY_BG = /* glsl */`
  uniform vec2 uCpx; uniform float uRpx; uniform float uTime; uniform float uDpr;
  ${NOISE}
  void main(){
    float d = length(gl_FragCoord.xy - uCpx) / max(uRpx, 1.0);
    vec3 c = mix(vec3(0.010, 0.020, 0.040), vec3(0.0015, 0.003, 0.006), smoothstep(0.0, 1.1, d));
    float scan = 0.5 + 0.5 * sin(gl_FragCoord.y / uDpr * 3.14159 / 1.5);
    c *= 0.88 + 0.12 * scan;
    c += (hash12(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.004;
    gl_FragColor = vec4(c, 1.0);
  }
`;

// Point sprites for the foam lattice (cells squeezed by the footstrike) and lattice struts.
const CELL_VERT = /* glsl */`
  attribute float aSeed; attribute float aSize;
  uniform float uPx; uniform float uTime;
  varying float vA; varying float vP;
  ${PROFILE} ${GAIT}
  void main(){
    vec3 p = position;
    float P = pressure(p.x);
    vec4 pf = prof(p.x);
    float h = p.y - pf.r;
    p.y = pf.r + h * (1.0 - 0.16 * P);
    p.xz += vec2(sin(uTime * 0.7 + aSeed * 40.0), cos(uTime * 0.6 + aSeed * 23.0)) * 0.002;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPx / -mv.z * (1.0 - 0.18 * P);
    vA = 0.5 + 0.35 * fract(aSeed * 7.13); vP = P;
  }
`;
const CELL_FRAG = /* glsl */`
  varying float vA; varying float vP;
  void main(){
    vec2 q = gl_PointCoord * 2.0 - 1.0; float d = length(q);
    if (d > 1.0) discard;
    float ring = smoothstep(0.2, 0.0, abs(d - 0.8));
    float fill = (1.0 - d) * 0.1;
    vec3 c = mix(vec3(0.35, 0.62, 1.0), vec3(1.0, 0.55, 0.18), clamp(vP * 1.3, 0.0, 1.0));
    gl_FragColor = vec4(c * (ring * 0.42 + fill) * vA * (0.32 + vP * 1.5), 1.0);
  }
`;

const PLATE_VERT = /* glsl */`
  varying vec2 vUv; varying vec3 vN; varying vec3 vVP;
  void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vVP = mv.xyz; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }
`;
const PLATE_FRAG = /* glsl */`
  uniform float uTime; uniform float uHot;
  varying vec2 vUv; varying vec3 vN; varying vec3 vVP;
  void main(){
    vec3 n = normalize(vN); vec3 v = normalize(-vVP); float ndv = abs(dot(n, v));
    // 2x2 twill: diagonal ribs with alternating tow direction, faded out where it would alias
    vec2 w = vec2(vUv.x * 124.0, vUv.y * 30.0);
    float dg = (w.x + w.y) * 0.5;
    float rib = 0.5 + 0.5 * sin(dg * 6.2832);
    float tow = step(0.5, fract((w.x - w.y) * 0.25));
    float weave = 1.0 - smoothstep(0.25, 0.7, fwidth(dg));
    float thread = mix(0.6, rib * mix(0.7, 1.0, tow), weave);
    float ev = min(vUv.y, 1.0 - vUv.y), eu = min(vUv.x, 1.0 - vUv.x);
    float edge = exp(-ev * 42.0) + exp(-eu * 90.0);
    float pulse = exp(-pow((vUv.x - fract(uTime * 0.3) * 1.3 + 0.15) * 8.0, 2.0));
    vec3 hot = vec3(0.86, 0.15, 0.008);
    vec3 c = hot * (0.55 + 0.6 * thread) * (0.8 + 0.45 * pow(1.0 - ndv, 1.4));
    c += vec3(1.0, 0.62, 0.22) * edge * 3.6;
    c += vec3(1.0, 0.7, 0.3) * pulse * (0.6 + thread) * 2.2;
    gl_FragColor = vec4(c * uHot, 0.96);
  }
`;

function textSprite(text, { color = '#d2ff1e', h = 0.06, weight = 600 } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const fs = 44;
  g.font = `${weight} ${fs}px "JetBrains Mono", monospace`;
  const w = Math.ceil(g.measureText(text).width) + 24;
  c.width = w; c.height = 64;
  g.font = `${weight} ${fs}px "JetBrains Mono", monospace`;
  g.fillStyle = 'rgba(16,18,22,.86)'; g.fillRect(0, 6, w, 52);
  g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 12, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, depthWrite: false, transparent: true }));
  s.scale.set(h * w / 64, h, 1);
  s.renderOrder = 10;
  return s;
}

// ─── The lens ────────────────────────────────────────────────────────────────
export class Lens {
  constructor(engine, shared) {
    this.engine = engine;
    this.renderer = engine.renderer;
    this.camera = engine.camera;
    this.u = shared; // { uTime, uShoeInv, uProfile, uProfX, uGait, uPx }
    const hf = { type: THREE.HalfFloatType, depthBuffer: true, colorSpace: THREE.LinearSRGBColorSpace };
    this.rtA = new THREE.WebGLRenderTarget(2, 2, hf);
    this.rtB = new THREE.WebGLRenderTarget(2, 2, hf);
    this.rtN = new THREE.WebGLRenderTarget(2, 2, { ...hf, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.mode = 0; this.prev = 0; this.wipe = 1;
    this.cx = innerWidth / 2; this.cy = innerHeight / 2; this.r = 150; this.open = 0; this.zoom = 1.08; this.vx = 0; this.vy = 0; this.hot = 0; this.mix = 1;
    this.sc = new THREE.Vector4();
    this.effect = new LensEffect({
      tAlt: this.rtA.texture, tPrev: this.rtB.texture, uC: new THREE.Vector2(0.5, 0.5), uR: 0, uZ: 1, uWipe: 1,
      uVel: new THREE.Vector2(), uHot: 0, uTimeL: 0, uTint: new THREE.Color(0.85, 1.0, 0.45), uMix: 1,
    });
    this.pass = new EffectPass(this.camera, this.effect);
    const comp = engine.post.composer;
    const at = comp.passes.findIndex(p => p instanceof EffectPass);
    comp.addPass(this.pass, at < 0 ? undefined : at);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    engine.onResize((w, h, dpr) => {
      const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
      this.bw = bw; this.bh = bh; this.dpr = dpr;
      for (const rt of [this.rtA, this.rtB, this.rtN]) rt.setSize(bw, bh);
      if (this.cadQuad) { this.cadQuad.material.uniforms.uRes.value.set(bw, bh); this.cadQuad.material.uniforms.uDpr.value = dpr; }
    });
    this.scenes = [new THREE.Scene(), new THREE.Scene(), null];
    this.holders = [];
  }

  _holder(scene) { const h = new THREE.Group(); h.matrixAutoUpdate = false; scene.add(h); this.holders.push(h); return h; }

  /** Build the alternate worlds once the shoe is measured. */
  build(model, data) {
    const u = this.u;
    const src = data.mesh.material;
    // X-RAY
    const xs = this.scenes[0];
    this.xrayBg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: BG_VERT, fragmentShader: XRAY_BG, depthTest: false, depthWrite: false,
      uniforms: { uCpx: { value: new THREE.Vector2() }, uRpx: { value: 100 }, uTime: u.uTime, uDpr: { value: 1 } },
    }));
    this.xrayBg.frustumCulled = false; this.xrayBg.renderOrder = -10;
    xs.add(this.xrayBg);
    const xh = this._holder(xs);
    this.uScan = { value: 0 };
    const xrayMat = new THREE.ShaderMaterial({
      vertexShader: SHELL_VERT, fragmentShader: XRAY_FRAG, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { map: { value: src.map }, nmap: { value: src.normalMap }, uTime: u.uTime, uScan: this.uScan, uShoeInv: u.uShoeInv, uProfile: u.uProfile, uProfX: u.uProfX, uGait: u.uGait },
    });
    xh.add(this._cloneWith(model, xrayMat));
    // plate
    this.uHot = { value: 1 };
    const plateMat = new THREE.ShaderMaterial({
      vertexShader: PLATE_VERT, fragmentShader: PLATE_FRAG, transparent: true, depthTest: false, depthWrite: false,
      side: THREE.DoubleSide, uniforms: { uTime: u.uTime, uHot: this.uHot },
    });
    const plate = new THREE.Mesh(data.plateGeo, plateMat); plate.renderOrder = 3;
    xh.add(plate);
    // foam lattice
    const cellMat = new THREE.ShaderMaterial({
      vertexShader: CELL_VERT, fragmentShader: CELL_FRAG, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uPx: u.uPx, uTime: u.uTime, uProfile: u.uProfile, uProfX: u.uProfX, uGait: u.uGait },
    });
    const cells = new THREE.Points(data.cellGeo, cellMat); cells.frustumCulled = false; cells.renderOrder = 2;
    xh.add(cells);
    const struts = new THREE.LineSegments(data.strutGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(0.025, 0.06, 0.11), transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    struts.renderOrder = 1; struts.frustumCulled = false;
    xh.add(struts);

    // THERMAL
    const ts = this.scenes[1];
    const th = this._holder(ts);
    const thermalMat = new THREE.ShaderMaterial({
      vertexShader: SHELL_VERT, fragmentShader: THERMAL_FRAG, side: THREE.DoubleSide,
      uniforms: { uTime: u.uTime, uShoeInv: u.uShoeInv, uProfile: u.uProfile, uProfX: u.uProfX, uGait: u.uGait },
    });
    th.add(this._cloneWith(model, thermalMat));
    this.uFloorC = { value: new THREE.Vector2() };
    const heat = new THREE.Mesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vWP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: FLOORHEAT_FRAG,
      uniforms: { uTime: u.uTime, uShoeInv: u.uShoeInv, uProfile: u.uProfile, uProfX: u.uProfX, uGait: u.uGait, uFloorC: this.uFloorC },
    }));
    heat.position.y = 0.0005;
    this.heatFloor = heat;
    ts.add(heat);

    // CAD: normals pass → Sobel quad → dimension overlay
    this.cadN = new THREE.Scene();
    const nh = this._holder(this.cadN);
    const nMat = new THREE.ShaderMaterial({ vertexShader: SHELL_VERT, fragmentShader: NORMAL_FRAG, side: THREE.DoubleSide, uniforms: { uShoeInv: u.uShoeInv } });
    nh.add(this._cloneWith(model, nMat));
    this.cadQuadScene = new THREE.Scene();
    this.cadQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: BG_VERT, fragmentShader: CAD_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tN: { value: this.rtN.texture }, uRes: { value: new THREE.Vector2(this.bw, this.bh) }, uDpr: { value: this.dpr }, uC: { value: new THREE.Vector2() }, uTime: u.uTime },
    }));
    this.cadQuad.frustumCulled = false;
    this.cadQuadScene.add(this.cadQuad);
    this.cadDims = new THREE.Scene();
    const dh = this._holder(this.cadDims);
    dh.add(this._buildDims(data));
  }

  _cloneWith(model, mat) {
    const c = model.clone(true);
    c.traverse(o => { if (o.isMesh) { o.material = mat; o.castShadow = o.receiveShadow = false; o.frustumCulled = false; o.layers.set(0); } });
    return c;
  }

  _buildDims(data) {
    const g = new THREE.Group();
    const volt = new THREE.Color(0xd2ff1e), white = new THREE.Color(0xc8d2de);
    const segs = [], segsW = [];
    const L = (arr, a, b) => arr.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    const tick = (arr, p, s = 0.025) => L(arr, [p[0] - s, p[1] - s, p[2]], [p[0] + s, p[1] + s, p[2]]);
    const z = data.zFront + 0.02;
    const { x0, x1, bottom, top, midTop, plateY } = data;
    const hx = x0 + 0.1, fx = x1 - 0.16;
    const yb = bottom(hx), yh = midTop(hx), yfb = bottom(fx), yft = midTop(fx);
    // heel stack
    const dxh = x0 - 0.14;
    L(segsW, [hx - 0.02, yb, z], [dxh - 0.05, yb, z]); L(segsW, [hx - 0.02, yh, z], [dxh - 0.05, yh, z]);
    L(segs, [dxh, yb, z], [dxh, yh, z]); tick(segs, [dxh, yb, z]); tick(segs, [dxh, yh, z]);
    const sHeel = textSprite('38.0'); sHeel.position.set(dxh - 0.2, (yb + yh) / 2, z); g.add(sHeel);
    // forefoot stack
    const dxf = x1 + 0.12;
    L(segsW, [fx + 0.02, yfb, z], [dxf + 0.05, yfb, z]); L(segsW, [fx + 0.02, yft, z], [dxf + 0.05, yft, z]);
    L(segs, [dxf, yfb, z], [dxf, yft, z]); tick(segs, [dxf, yfb, z]); tick(segs, [dxf, yft, z]);
    const sFore = textSprite('30.0'); sFore.position.set(dxf + 0.2, (yfb + yft) / 2, z); g.add(sFore);
    // length
    const ly = Math.min(bottom(0), bottom(x0 + 0.2)) - 0.12;
    L(segsW, [x0, bottom(x0 + 0.03), z], [x0, ly - 0.04, z]); L(segsW, [x1, bottom(x1 - 0.03), z], [x1, ly - 0.04, z]);
    L(segs, [x0, ly, z], [x1, ly, z]); tick(segs, [x0, ly, z]); tick(segs, [x1, ly, z]);
    const sLen = textSprite('L 285.0'); sLen.position.set(0, ly - 0.06, z); g.add(sLen);
    // overall height
    const ty = top(x0 + 0.35);
    const dxt = x0 - 0.36;
    L(segsW, [x0 + 0.3, ty, z], [dxt - 0.05, ty, z]);
    L(segs, [dxt, yb, z], [dxt, ty, z]); tick(segs, [dxt, ty, z]); tick(segs, [dxt, yb, z]);
    const sH = textSprite('H 121.6', { color: '#c8d2de' }); sH.position.set(dxt - 0.02, ty + 0.07, z); g.add(sH);
    // drop callout
    const sDrop = textSprite('DROP 8.0', { color: '#ff7a3a' }); sDrop.position.set(0.02, midTop(0.02) + 0.11, z); g.add(sDrop);
    // plate centreline, dashed
    for (let i = 0; i < 60; i++) {
      if (i % 2) continue;
      const xa = x0 + 0.12 + (x1 - x0 - 0.2) * i / 60, xb = x0 + 0.12 + (x1 - x0 - 0.2) * (i + 1) / 60;
      L(segs, [xa, plateY(xa), z], [xb, plateY(xb), z]);
    }
    const sPlate = textSprite('CFRP 1.1', { color: '#ff7a3a' }); sPlate.position.set(-0.28, plateY(-0.28) - 0.07, z); g.add(sPlate);
    // centre line (dash-dot) along the last
    for (let i = 0; i < 40; i++) {
      const xa = x0 - 0.05 + (x1 - x0 + 0.1) * i / 40, xb = xa + (x1 - x0 + 0.1) / 40 * (i % 3 === 2 ? 0.15 : 0.7);
      L(segsW, [xa, (yb + ty) * 0.5, z], [xb, (yb + ty) * 0.5, z]);
    }
    // toe spring angle
    const ax = x1 - 0.42, ay = bottom(x1 - 0.42);
    for (let i = 0; i < 12; i++) {
      const a0 = i / 12 * 0.32, a1 = (i + 1) / 12 * 0.32, rr = 0.34;
      L(segs, [ax + Math.cos(a0) * rr, ay + Math.sin(a0) * rr, z], [ax + Math.cos(a1) * rr, ay + Math.sin(a1) * rr, z]);
    }
    L(segsW, [ax, ay, z], [ax + 0.44, ay, z]);
    const sA = textSprite('4.2°'); sA.position.set(ax + 0.46, ay + 0.1, z); g.add(sA);
    const mk = (arr, col, op) => {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const m = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: col, depthTest: false, depthWrite: false, transparent: true, opacity: op }));
      m.frustumCulled = false; m.renderOrder = 5; return m;
    };
    g.add(mk(segs, volt, 0.95), mk(segsW, white, 0.45));
    return g;
  }

  setMode(i) {
    if (i === this.mode) return false;
    this.prev = this.mode; this.mode = i; this.wipe = 0;
    return true;
  }

  sync(pivot) {
    for (const h of this.holders) { h.matrix.copy(pivot.matrixWorld); h.matrixWorldNeedsUpdate = true; }
    if (this.uFloorC) this.uFloorC.value.set(pivot.position.x, pivot.position.z);
    if (this.heatFloor) { this.heatFloor.position.x = pivot.position.x; this.heatFloor.position.z = pivot.position.z; }
  }

  /** Draw the lens contents for this frame (call before the main render). */
  render() {
    const r = this.renderer, cam = this.camera;
    const dpr = this.dpr, bw = this.bw, bh = this.bh;
    const R = this.r * this.open * dpr;
    const U = this.effect.uniforms;
    const cx = this.cx * dpr, cy = bh - this.cy * dpr; // buffer px, y up
    U.get('uC').value.set(cx / bw, cy / bh);
    U.get('uR').value = R;
    U.get('uZ').value = this.zoom;
    U.get('uWipe').value = this.wipe;
    U.get('uVel').value.set(this.vx * dpr, -this.vy * dpr);
    U.get('uHot').value = this.hot;
    U.get('uMix').value = this.mix;
    this.pass.enabled = R > 1.5 && this.mix > 0.004;
    if (!this.pass.enabled || !this.cadQuad) return;
    const ext = R * 1.34 * this.zoom * 1.06 + 8;
    const x0 = Math.max(0, Math.floor(cx - ext)), y0 = Math.max(0, Math.floor(cy - ext));
    const x1 = Math.min(bw, Math.ceil(cx + ext)), y1 = Math.min(bh, Math.ceil(cy + ext));
    if (x1 <= x0 || y1 <= y0) { this.pass.enabled = false; return; }
    this.sc.set(x0, y0, x1 - x0, y1 - y0);
    this.xrayBg.material.uniforms.uCpx.value.set(cx, cy);
    this.xrayBg.material.uniforms.uRpx.value = R;
    this.xrayBg.material.uniforms.uDpr.value = dpr;

    const Z = this.zoom;
    const cyTop = bh - cy;
    cam.setViewOffset(bw, bh, cx * (1 - 1 / Z), cyTop * (1 - 1 / Z), bw / Z, bh / Z);
    this.u.uPx.value = bh * cam.projectionMatrix.elements[5] / 2;
    const prevRT = r.getRenderTarget(), prevAuto = r.autoClear, prevCol = r.getClearColor(new THREE.Color()), prevA = r.getClearAlpha();
    r.autoClear = false;
    this._draw(this.mode, this.rtA);
    if (this.wipe < 1) this._draw(this.prev, this.rtB);
    r.autoClear = prevAuto;
    r.setClearColor(prevCol, prevA);
    r.setRenderTarget(prevRT);
    cam.clearViewOffset();
  }

  _draw(mode, target) {
    const r = this.renderer, cam = this.camera;
    target.scissor.copy(this.sc); target.scissorTest = true;
    r.setRenderTarget(target);
    r.setClearColor(MODES[mode].bg, 1); r.clear(true, true, false);
    if (mode === 2) {
      this.rtN.scissor.copy(this.sc); this.rtN.scissorTest = true;
      r.setRenderTarget(this.rtN); r.setClearColor(0x000000, 0); r.clear(true, true, false);
      r.render(this.cadN, cam);
      r.setRenderTarget(target);
      r.render(this.cadQuadScene, this.ortho);
      r.render(this.cadDims, cam);
    } else {
      r.render(this.scenes[mode], cam);
    }
  }
}
