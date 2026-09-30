// Particle life on the islands: waterfall streams that keep falling where the sculpted sheet ends,
// drifting blossom from Hanakumo, and the lighthouse lamp.
import { THREE } from '../../src/core/engine.js';
import { sky, SKY_GLSL } from './sky.js';

export const pointU = { uResY: { value: 900 }, uDpr: { value: 1 } };

/** A waterfall continuing from a lip segment (island-local space) down into the cloud sea. */
export function fallStream({ a, b, drop = 16, count = 5000, push = 1 }) {
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { ...sky, ...pointU, uA: { value: new THREE.Vector3(...a) }, uB: { value: new THREE.Vector3(...b) }, uDrop: { value: drop }, uPush: { value: push } },
    vertexShader: /* glsl */`
      uniform float uTime, uResY, uDpr, uDrop, uPush; uniform vec3 uA, uB;
      attribute vec4 aSeed;
      varying float vA; varying vec3 vW; varying float vLife;
      void main(){
        float life = fract(uTime * (0.1 + aSeed.z * 0.06) + aSeed.y);
        vec3 p = mix(uA, uB, aSeed.x);
        float f = life;
        p.y -= f * f * uDrop * 0.7 + f * uDrop * 0.3;
        p.z += (f * (0.35 + aSeed.w * 0.9) + f * f * 1.5) * uPush;
        p.x += (aSeed.x - 0.5) * f * 1.8 + sin(uTime * 1.3 + aSeed.y * 20.0) * f * 0.35;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vW = w.xyz;
        vec4 mv = viewMatrix * w;
        gl_Position = projectionMatrix * mv;
        float sz = mix(0.16, 2.2, pow(f, 1.5)) * (0.5 + aSeed.w);
        gl_PointSize = sz * projectionMatrix[1][1] * uResY * 0.5 / -mv.z;
        vA = smoothstep(0.0, 0.03, f) * pow(1.0 - f, 1.1) * mix(1.0, 0.35, smoothstep(0.1, 0.6, f));
        vLife = f;
      }`,
    fragmentShader: /* glsl */`
      ${SKY_GLSL}
      varying float vA; varying vec3 vW; varying float vLife;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        // early on each drop is a vertical streak, later a soft ball of spray
        float stretch = mix(3.2, 1.0, smoothstep(0.0, 0.45, vLife));
        float a = smoothstep(0.5, 0.0, length(c * vec2(stretch, 1.0)));
        vec3 col = mix(vec3(0.86, 0.95, 1.05), vec3(1.0, 0.98, 0.96), vLife);
        col = atmosphere(col, vW);
        gl_FragColor = vec4(col, a * vA * 0.7);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  return pts;
}

/** Blossom that lifts off Hanakumo's cherry trees and drifts away on the wind. */
export function petals({ box, count = 700, wind = [3.2, -0.25, 1.4] }) {
  const seed = new Float32Array(count * 4), base = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    base.set([THREE.MathUtils.lerp(box[0][0], box[1][0], Math.random()), THREE.MathUtils.lerp(box[0][1], box[1][1], Math.random()), THREE.MathUtils.lerp(box[0][2], box[1][2], Math.random())], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(base, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { ...sky, ...pointU, uWind: { value: new THREE.Vector3(...wind) } },
    vertexShader: /* glsl */`
      uniform float uTime, uResY; uniform vec3 uWind;
      attribute vec4 aSeed;
      varying float vA; varying vec3 vW; varying float vRot;
      void main(){
        float life = fract(uTime * (0.045 + aSeed.z * 0.03) + aSeed.y);
        vec3 p = position;
        float T = life * 9.0;
        p += uWind * T;
        p.y -= T * T * 0.05;
        p.x += sin(uTime * 1.7 + aSeed.x * 30.0) * 0.25 * life;
        p.z += cos(uTime * 1.3 + aSeed.w * 30.0) * 0.25 * life;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vW = w.xyz;
        vec4 mv = viewMatrix * w;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.07 + aSeed.w * 0.05) * projectionMatrix[1][1] * uResY * 0.5 / -mv.z;
        vA = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.7, 1.0, life));
        vRot = uTime * (1.5 + aSeed.x * 3.0) + aSeed.z * 6.28;
      }`,
    fragmentShader: /* glsl */`
      ${SKY_GLSL}
      varying float vA; varying vec3 vW; varying float vRot;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float cr = cos(vRot), sr = sin(vRot);
        c = mat2(cr, -sr, sr, cr) * c;
        c.x *= 1.0 + 0.9 * abs(sin(vRot * 0.7));   // tumbling: the ellipse thins as it turns edge-on
        float d = length(c * vec2(1.0, 1.8));
        float a = smoothstep(0.5, 0.36, d);
        vec3 col = mix(vec3(1.0, 0.66, 0.76), vec3(1.0, 0.86, 0.9), c.y + 0.5);
        col = atmosphere(col, vW);
        gl_FragColor = vec4(col, a * vA);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  return pts;
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.18, 'rgba(255,236,200,.7)'); grd.addColorStop(0.5, 'rgba(255,200,140,.15)'); grd.addColorStop(1, 'rgba(255,200,140,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** The Lanternholm lamp: a glow and a slow sweeping beam (faint by day, it comes up at golden hour). */
export function lighthouseLamp() {
  const g = new THREE.Group();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#ffd89a').multiplyScalar(3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(0.9);
  g.add(glow);
  const beamGeo = new THREE.CylinderGeometry(0.06, 1.5, 16, 24, 1, true);
  beamGeo.translate(0, 8, 0);
  beamGeo.rotateZ(-Math.PI / 2);
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uPower: { value: 0.25 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vX; void main(){ vX = position.x / 16.0; vec4 mv = modelViewMatrix * vec4(position,1.); vV = normalize(-mv.xyz); vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float uPower; varying vec3 vN; varying vec3 vV; varying float vX; void main(){ float f = pow(abs(dot(vN, vV)), 1.6); float a = f * (1.0 - smoothstep(0.0, 1.0, vX)) * smoothstep(0.0, 0.04, vX); gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * a * uPower, 1.0); }',
  });
  const beam = new THREE.Group();
  const b1 = new THREE.Mesh(beamGeo, beamMat), b2 = new THREE.Mesh(beamGeo, beamMat);
  b2.rotation.y = Math.PI;
  beam.add(b1, b2);
  g.add(beam);
  g.userData.update = (t, power) => { beam.rotation.y = t * 0.6; beamMat.uniforms.uPower.value = power; glow.material.opacity = 0.6 + power; };
  return g;
}

/** Sunlit pollen and dust drifting around the camera: tiny warm motes that give the air some depth. */
export function motes({ count = 700, box = 34 } = {}) {
  const seed = new Float32Array(count * 4), pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4); pos.set([Math.random(), Math.random(), Math.random()], i * 3); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { ...sky, ...pointU, uBox: { value: box }, uCam: { value: new THREE.Vector3() }, uAmt: { value: 1 } },
    vertexShader: /* glsl */`
      uniform float uTime, uResY, uBox, uAmt; uniform vec3 uCam;
      attribute vec4 aSeed;
      varying float vA;
      void main(){
        // a box of motes that wraps around the camera so it never runs out
        vec3 p = position * uBox + vec3(uTime * 0.35, sin(uTime * 0.2 + aSeed.x * 6.0) * 0.6, uTime * 0.12) + aSeed.xyz * 3.0;
        p = mod(p - uCam + uBox * 0.5, uBox) + uCam - uBox * 0.5;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        gl_PointSize = (0.035 + aSeed.w * 0.05) * projectionMatrix[1][1] * uResY * 0.5 / d;
        float tw = 0.55 + 0.45 * sin(uTime * (1.0 + aSeed.y * 2.0) + aSeed.z * 30.0);
        vA = smoothstep(0.5, 3.0, d) * (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, d)) * tw * uAmt;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunCol;
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(mix(uSunCol, vec3(1.0), 0.5) * a * vA * 0.9, 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return pts;
}
