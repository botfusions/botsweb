// Earth over the horizon (NB2 Blue-Marble plate on a sphere, lit by our own sun so its phase is honest),
// a thin atmosphere shell, a sun disc for the rare reverse angle, and a star field that only appears
// when the "camera" opens up its exposure near the end of the page.
import { THREE } from '../../src/core/engine.js';
import { mulberry32 } from './noise.js';

export function makeEarth(map, { dist = 11500, ang = 5.2 } = {}) {
  const R = dist * Math.tan((ang * Math.PI) / 360);
  const group = new THREE.Group();
  const uniforms = { uMap: { value: map }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uGain: { value: 1.25 } };
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vP; varying vec2 vUv;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform vec3 uSun; uniform float uGain;
      varying vec3 vN; varying vec3 vP; varying vec2 vUv;
      void main(){
        vec3 n = normalize(vN), V = normalize(cameraPosition - vP);
        vec3 day = texture2D(uMap, vUv).rgb;
        float ndl = dot(n, uSun);
        float lit = smoothstep(-0.08, 0.22, ndl) * (0.35 + 0.65 * clamp(ndl, 0., 1.));
        float ocean = smoothstep(0.02, 0.12, day.b - max(day.r, day.g) * 0.9) * (1. - smoothstep(0.55, 0.8, dot(day, vec3(.33))));
        float spec = pow(max(dot(reflect(-uSun, n), V), 0.), 36.) * ocean * 1.6 * step(0., ndl);
        float fres = pow(1. - max(dot(n, V), 0.), 2.4);
        vec3 atm = vec3(0.32, 0.56, 1.0) * fres * smoothstep(-0.25, 0.5, ndl) * 1.4;
        vec3 col = day * lit * uGain + atm + vec3(0.9, 0.95, 1.) * spec;
        col = mix(col, col * vec3(0.8, 0.9, 1.15), fres * 0.6);
        gl_FragColor = vec4(col * 2.2, 1.);
      }`,
  }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.045, 64, 48), new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uSun; varying vec3 vN; varying vec3 vP;
      void main(){ vec3 n = normalize(vN), V = normalize(cameraPosition - vP);
        float rim = pow(clamp(1. - abs(dot(n, V)) , 0., 1.), 5.0);
        float day = smoothstep(-0.35, 0.6, dot(n, uSun));
        gl_FragColor = vec4(vec3(0.3, 0.55, 1.0) * rim * day * 2.2, 1.); }`,
  }));
  group.add(earth, halo);
  earth.rotation.set(0.35, -2.1, 0.18);
  group.userData = { earth, halo, uniforms, R, dist };
  return group;
}

export function makeSun() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, '#fff'); grd.addColorStop(0.12, '#fff'); grd.addColorStop(0.16, 'rgba(255,250,240,.35)');
  grd.addColorStop(0.4, 'rgba(255,245,230,.06)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color: new THREE.Color(40, 39, 37), depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  s.scale.setScalar(900);
  return s;
}

export function makeStars(n = 5000, r = 14000) {
  const rnd = mulberry32(8);
  const pos = new Float32Array(n * 3), mag = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * s * r, Math.abs(u) * r * (u > -0.2 ? 1 : 0.2), Math.sin(a) * s * r], i * 3);
    mag[i] = Math.pow(rnd(), 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uAmount: { value: 0 }, uDpr: { value: 1 } },
    vertexShader: `attribute float mag; uniform float uDpr; varying float vM; void main(){ vM = mag; vec4 mv = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mv; gl_PointSize = (1. + mag * 2.4) * uDpr; }`,
    fragmentShader: `uniform float uAmount; varying float vM; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, 0., d); gl_FragColor = vec4(vec3(0.85, 0.9, 1.) * a * (0.25 + vM * 3.) * uAmount, 1.); }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}
