// Page-local copy of src/core/volumetric.js, extended for the hangar:
// up to 8 spotlights, lights at zero intensity are packed out on the CPU (so the red strobes, floods,
// drone and dawn light only cost when they are on), a height-dependent haze layer and a cheap phase term
// that brightens beams you look down (the Titanfall "god ray toward camera" look).
import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

const N = 8;
const frag = /* glsl */`
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform int uCount;
uniform vec3 uLPos[${N}];
uniform vec3 uLDir[${N}];
uniform vec3 uLCol[${N}];
uniform vec2 uLCone[${N}];
uniform float uLRange[${N}];
uniform float uDensity;
uniform float uTime;
uniform float uNoise;
uniform float uNoiseScale;
uniform float uMaxDist;
uniform vec3 uWind;
uniform float uFloorY;
uniform float uHazeTop;
uniform float uPhase;

float vhash(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(vhash(i), vhash(i + vec3(1,0,0)), f.x), mix(vhash(i + vec3(0,1,0)), vhash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(vhash(i + vec3(0,0,1)), vhash(i + vec3(1,0,1)), f.x), mix(vhash(i + vec3(0,1,1)), vhash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (uCount == 0) { outputColor = inputColor; return; }
  vec4 clip = vec4(uv * 2. - 1., depth * 2. - 1., 1.);
  vec4 vp = uProjInv * clip; vp /= vp.w;
  vec3 wp = (uCamWorld * vec4(vp.xyz, 1.)).xyz;
  vec3 ro = uCamPos;
  vec3 rd = wp - ro;
  float len = min(length(rd), uMaxDist);
  rd = normalize(rd);
  const int STEPS = 36;
  float stepL = len / float(STEPS);
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uTime * 0.61803);
  vec3 acc = vec3(0.);
  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + jitter) * stepL;
    vec3 p = ro + rd * t;
    vec3 q = p * uNoiseScale + uWind * uTime;
    float n = vnoise(q) * 0.62 + vnoise(q * 2.7 + 7.1) * 0.38;
    float dens = uDensity * mix(1.0, n * n * 2.6, uNoise) * smoothstep(uFloorY - 0.2, uFloorY + 1.2, p.y) * (1.0 - smoothstep(uHazeTop * 0.6, uHazeTop, p.y) * 0.7);
    for (int l = 0; l < ${N}; l++) {
      if (l >= uCount) break;
      vec3 d = p - uLPos[l];
      float dist = max(length(d), 1e-3);
      vec3 dn = d / dist;
      float c = dot(dn, uLDir[l]);
      float cone = smoothstep(uLCone[l].x, uLCone[l].y, c);
      float att = 1.0 / (1.0 + dist * dist * uLRange[l]);
      // forward scattering: beams glow brighter when they point at the viewer
      float ph = 1.0 + uPhase * pow(max(dot(dn, -rd), 0.0), 6.0);
      acc += uLCol[l] * cone * att * dens * stepL * ph;
    }
  }
  outputColor = vec4(inputColor.rgb + acc, inputColor.a);
}`;

export class HangarVolumetric extends Effect {
  constructor(camera, { density = 0.02, noise = 0.9, noiseScale = 0.22, maxDist = 70, wind = new THREE.Vector3(0.05, 0.12, 0.03), floorY = 0, hazeTop = 30, phase = 1.5 } = {}) {
    const vec3s = () => Array.from({ length: N }, () => new THREE.Vector3());
    super('HangarVolumetric', frag, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uProjInv', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamPos', new THREE.Uniform(new THREE.Vector3())],
        ['uCount', new THREE.Uniform(0)],
        ['uLPos', new THREE.Uniform(vec3s())],
        ['uLDir', new THREE.Uniform(vec3s())],
        ['uLCol', new THREE.Uniform(vec3s())],
        ['uLCone', new THREE.Uniform(Array.from({ length: N }, () => new THREE.Vector2(0.9, 0.95)))],
        ['uLRange', new THREE.Uniform(new Array(N).fill(0.01))],
        ['uDensity', new THREE.Uniform(density)],
        ['uTime', new THREE.Uniform(0)],
        ['uNoise', new THREE.Uniform(noise)],
        ['uNoiseScale', new THREE.Uniform(noiseScale)],
        ['uMaxDist', new THREE.Uniform(maxDist)],
        ['uWind', new THREE.Uniform(wind)],
        ['uFloorY', new THREE.Uniform(floorY)],
        ['uHazeTop', new THREE.Uniform(hazeTop)],
        ['uPhase', new THREE.Uniform(phase)],
      ]),
    });
    this.camera = camera;
    this.lights = [];
    this._d = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  /** Track a SpotLight. `scale` multiplies colour*intensity into the haze; `range` is quadratic falloff; `gain` is a live multiplier. */
  add(light, { scale = 0.001, range = 0.01, softness = 0.2 } = {}) {
    const e = { light, scale, range, softness, gain: 1 };
    this.lights.push(e);
    return e;
  }

  get density() { return this.uniforms.get('uDensity').value; }
  set density(v) { this.uniforms.get('uDensity').value = v; }

  update(renderer, inputBuffer, dt) {
    const u = this.uniforms;
    const cam = this.camera;
    u.get('uProjInv').value.copy(cam.projectionMatrixInverse);
    u.get('uCamWorld').value.copy(cam.matrixWorld);
    u.get('uCamPos').value.setFromMatrixPosition(cam.matrixWorld);
    u.get('uTime').value += dt;
    let n = 0;
    for (const e of this.lights) {
      const { light, scale, range, softness, gain } = e;
      const on = light.visible ? light.intensity * scale * gain : 0;
      if (on < 1e-4 || n >= N) continue;
      light.updateMatrixWorld();
      light.target.updateMatrixWorld();
      this._p.setFromMatrixPosition(light.matrixWorld);
      this._d.setFromMatrixPosition(light.target.matrixWorld).sub(this._p).normalize();
      u.get('uLPos').value[n].copy(this._p);
      u.get('uLDir').value[n].copy(this._d);
      u.get('uLCol').value[n].set(light.color.r * on, light.color.g * on, light.color.b * on);
      const outer = Math.cos(light.angle);
      const inner = Math.cos(light.angle * (1 - Math.max(light.penumbra, softness)));
      u.get('uLCone').value[n].set(outer, inner);
      u.get('uLRange').value[n] = range;
      n++;
    }
    u.get('uCount').value = n;
  }
}
