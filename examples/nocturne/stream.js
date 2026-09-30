// Golden particle streams: a note's surface burns away point by point and each point flies, on its own curve,
// around the flacon and into the liquid surface. One draw call per note; everything is computed in the vertex shader
// from a single progress uniform, so it can play forwards and backwards.
import { THREE } from '../../src/core/engine.js';

export const BURN_GLSL = /* glsl */`
  float burnNoise(vec3 p){
    return 0.5 + 0.25 * sin(p.x * 1.7 + sin(p.y * 2.3 + p.z * 0.7)) * sin(p.z * 1.9 + p.y * 1.3)
               + 0.25 * sin(p.y * 3.1 + sin(p.x * 2.9 - p.z * 1.1) * 1.4);
  }
  float burnKey(vec3 p, vec3 dir, vec2 mm, float freq){
    float a = 1.0 - clamp((dot(p, dir) - mm.x) / (mm.y - mm.x), 0.0, 1.0);
    return clamp(0.7 * a + 0.3 * burnNoise(p * freq), 0.0, 1.0);
  }
`;
const fract = v => v - Math.floor(v);
export function burnNoise(x, y, z) {
  return 0.5 + 0.25 * Math.sin(x * 1.7 + Math.sin(y * 2.3 + z * 0.7)) * Math.sin(z * 1.9 + y * 1.3)
    + 0.25 * Math.sin(y * 3.1 + Math.sin(x * 2.9 - z * 1.1) * 1.4);
}
export function burnKey(x, y, z, dir, mm, freq) {
  const a = 1 - Math.min(1, Math.max(0, ((x * dir.x + y * dir.y + z * dir.z) - mm[0]) / (mm[1] - mm[0])));
  return Math.min(1, Math.max(0, 0.7 * a + 0.3 * burnNoise(x * freq, y * freq, z * freq)));
}
// uBurn(P) = P * BURN_A - BURN_B, P in [0, 1 + DUR]
export const BURN_A = 1.12, BURN_B = 0.08, DUR = 0.62;

const VERT = /* glsl */`
  attribute vec3 aLocal; attribute vec3 aNormal; attribute vec3 aColor; attribute float aKey; attribute vec4 aRand;
  uniform mat4 uNoteM; uniform mat4 uBottleM; uniform vec3 uSurf; uniform vec3 uAxisC; uniform float uAxisR;
  uniform float uP, uTime, uDpr, uSize, uDur, uBurnA, uBurnB, uSpin;
  varying vec3 vCol; varying float vA;
  vec3 bez(vec3 a, vec3 b, vec3 c, vec3 d, float t){ float s = 1.0 - t; return s*s*s*a + 3.0*s*s*t*b + 3.0*s*t*t*c + t*t*t*d; }
  void main(){
    float rel = (aKey + uBurnB) / uBurnA;
    float t = clamp((uP - rel) / (uDur * (0.75 + aRand.w * 0.5)), 0.0, 1.0);
    if (t <= 0.0 || t >= 1.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; vCol = vec3(0.0); return; }
    vec3 s = (uNoteM * vec4(aLocal, 1.0)).xyz;
    vec3 nW = normalize(mat3(uNoteM) * aNormal);
    vec3 e = uSurf + mat3(uBottleM) * vec3((aRand.x - 0.5) * 0.5, 0.0, (aRand.y - 0.5) * 0.28);
    // Around the flacon on the way in.
    vec3 toS = s - uAxisC; toS.y = 0.0;
    float a0 = atan(toS.z, toS.x) + (aRand.z - 0.5) * 1.6 + uSpin;
    vec3 ring = uAxisC + vec3(cos(a0), 0.0, sin(a0)) * uAxisR * (0.8 + aRand.x * 0.5) + vec3(0.0, 0.25 + aRand.y * 0.55, 0.0);
    vec3 p1 = s + nW * (0.18 + aRand.z * 0.35) + vec3(0.0, 0.12 + aRand.w * 0.2, 0.0);
    float te = t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
    te = mix(t, te, 0.6);
    vec3 p = bez(s, p1, ring, e, te);
    // Curl-ish drift so a paused stream still breathes.
    float w = sin(t * 3.14159);
    p += vec3(sin(uTime * 1.3 + aRand.x * 40.0 + t * 7.0), sin(uTime * 1.1 + aRand.y * 30.0 + t * 5.0), cos(uTime * 1.2 + aRand.z * 20.0 + t * 6.0)) * 0.035 * w;
    // Swirl about the bottle axis in the second half.
    vec3 r = p - uAxisC; float sw = (1.0 - t) * t * 2.2 * (aRand.x > 0.5 ? 1.0 : -1.0);
    float cs = cos(sw), sn = sin(sw);
    p = uAxisC + vec3(r.x * cs - r.z * sn, r.y, r.x * sn + r.z * cs);
    vec3 gold = mix(vec3(1.0, 0.5, 0.12), vec3(1.0, 0.72, 0.36), aRand.z * aRand.z);
    float burn = exp(-t * 22.0);
    vCol = mix(aColor * 1.4 + gold * 0.35, gold * 1.7, smoothstep(0.02, 0.32, t)) * (1.0 + burn * 3.0);
    vA = smoothstep(1.0, 0.86, t) * (0.35 + 0.65 * aRand.w) * 0.6;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.6 + aRand.y * 0.9) * (1.0 + burn * 1.5) * uDpr / -mv.z;
  }
`;
const FRAG = /* glsl */`
  varying vec3 vCol; varying float vA;
  void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); float a = exp(-r * 18.0);
    gl_FragColor = vec4(vCol * a * vA, 1.0); }
`;

/**
 * pts: { local: Float32Array(3N), normal: Float32Array(3N), color: Float32Array(3N), key: Float32Array(N) }
 */
export function createStream(pts, { size = 9 } = {}) {
  const N = pts.key.length;
  const g = new THREE.BufferGeometry();
  const rand = new Float32Array(N * 4);
  for (let i = 0; i < N * 4; i++) rand[i] = Math.random();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('aLocal', new THREE.BufferAttribute(pts.local, 3));
  g.setAttribute('aNormal', new THREE.BufferAttribute(pts.normal, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(pts.color, 3));
  g.setAttribute('aKey', new THREE.BufferAttribute(pts.key, 1));
  g.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
  const uniforms = {
    uNoteM: { value: new THREE.Matrix4() }, uBottleM: { value: new THREE.Matrix4() }, uSurf: { value: new THREE.Vector3() },
    uAxisC: { value: new THREE.Vector3() }, uAxisR: { value: 0.85 }, uP: { value: 0 }, uTime: { value: 0 }, uDpr: { value: 1 },
    uSize: { value: size }, uDur: { value: DUR }, uBurnA: { value: BURN_A }, uBurnB: { value: BURN_B }, uSpin: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = 8;
  return { points, uniforms, count: N };
}

export { fract };
