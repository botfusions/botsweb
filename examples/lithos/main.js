import { Engine, THREE, normalize, damp, clamp, smooth, lerp, studioEnvironment } from '../../src/core/engine.js';
import { Assets, firstMesh } from '../../src/core/assets.js';
import { Pointer } from '../../src/core/input.js';
import { smoothScroll, gsap, reveal } from '../../src/core/scroll.js';
import { preloader, cursor, magnetic, worldNav } from '../../src/core/ui.js';
import { VolumetricSpotEffect } from '../../src/core/volumetric.js';
import { bakeTexture } from '../../src/core/textures.js';
import { DepthOfFieldEffect } from 'postprocessing';
import { velvetMaterial, crystalMaterial, patchPyrite, nacreMaterial } from './materials.js';
import { Geode } from './geode.js';
import { Sound } from './sound.js';

const Q = new URLSearchParams(location.search);
const D = Math.PI / 180;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const touch = matchMedia('(pointer: coarse)').matches;

// ─── Engine ────────────────────────────────────────────────────────────────────
let vol, dof;
const engine = new Engine({
  canvas: document.getElementById('gl'), fov: 30, near: 0.05, far: 60, dpr: 1.6, background: 0x040306,
  post: {
    ao: { aoRadius: 0.35, intensity: 2.4, distanceFalloff: 0.6, halfRes: false, denoiseRadius: 8 },
    bloom: { intensity: 1.0, luminanceThreshold: 0.6, luminanceSmoothing: 0.3, radius: 0.64 },
    pre: cam => {
      vol = new VolumetricSpotEffect(cam, { density: 0.026, noise: 0.92, noiseScale: 1.7, maxDist: 12, floorY: 0, wind: V3(0.03, 0.06, 0.01) });
      dof = new DepthOfFieldEffect(cam, { focusDistance: 3.5, focusRange: 1.4, bokehScale: 2.2, resolutionScale: 0.5 });
      return Q.has('nodof') ? [vol] : [vol, dof];
    },
    tone: 'agx', vignette: { offset: 0.18, darkness: 0.84 }, noise: 0.045, ca: 0.0008,
  },
});
const { scene, camera, renderer } = engine;
renderer.shadowMap.type = THREE.PCFShadowMap;
scene.fog = new THREE.FogExp2(0x040306, 0.035);
scene.environment = studioEnvironment(renderer, {
  top: 0x0b0910, bottom: 0x020203, blur: 0.015,
  panels: [
    { pos: [0, 7, 1.5], size: [4.5, 2.0], intensity: 5.5, color: 0xffffff },
    { pos: [-6.5, 2.6, 2.5], size: [0.6, 5.5], intensity: 5, color: 0xf3efff },
    { pos: [6.5, 3.2, -1.2], size: [0.45, 5], intensity: 3.5, color: 0xe4ddff },
    { pos: [0.5, 3.4, -7], size: [7, 0.45], intensity: 2.4, color: 0xb194ff },
    { pos: [3.5, 1.0, 6.5], size: [1.2, 1.2], intensity: 2.0, color: 0xffeedd },
  ],
});

// A brighter "light tent" environment for the metal and the crystal only.
const jewelEnv = studioEnvironment(renderer, {
  top: 0x24222a, bottom: 0x050506, blur: 0.02,
  panels: [
    { pos: [0, 6, 0.5], size: [6, 4], intensity: 4, color: 0xffffff },
    { pos: [-5, 2, 3], size: [2, 5], intensity: 3.5, color: 0xfff4ea },
    { pos: [5, 2.5, 2], size: [1.4, 5], intensity: 3, color: 0xeef0ff },
    { pos: [0, 1.5, -6], size: [8, 1.2], intensity: 2.2, color: 0xc6b2ff },
    { pos: [0, 1, 6], size: [3, 1], intensity: 2.5, color: 0xffffff },
  ],
});
const assets = new Assets();
const pointer = new Pointer({ lambda: 6 });
const sound = new Sound(document.querySelector('.sound'));

// ─── Loader: the stone cracks as the vault loads, then splits open ────────────
const loaderEl = document.querySelector('.loader');
const loader = preloader({
  assets, el: loaderEl, minTime: 1500,
  onValue: v => {
    loaderEl.querySelector('.loader-pct').textContent = Math.round(v * 100);
    loaderEl.style.setProperty('--p', v.toFixed(3));
  },
  exit: async () => {
    const tl = gsap.timeline();
    tl.to('.loader-crack', { strokeWidth: 2.4, duration: 0.25, ease: 'power2.in' })
      .to('.loader-core', { opacity: 0, duration: 0.35, ease: 'power2.in' }, '+=0.05')
      .to('.loader-top', { yPercent: -101, duration: 1.3, ease: 'expo.inOut' }, '-=0.1')
      .to('.loader-bot', { yPercent: 101, duration: 1.3, ease: 'expo.inOut' }, '<');
    await tl;
  },
});

// ─── The vitrine: black velvet cove with hanging folds ────────────────────────
const velvet = velvetMaterial(renderer, bakeTexture);
function coveGeometry() {
  const W = 30, x0 = -10, segX = 540, segS = 260;
  const zF = 6, zC = -2.1, R = 1.9, yTop = 8;
  const Lf = zF - zC, La = Math.PI / 2 * R, Lw = yTop - R, S = Lf + La + Lw;
  const pos = new Float32Array((segX + 1) * (segS + 1) * 3), uv = new Float32Array((segX + 1) * (segS + 1) * 2);
  const specs = [[0, 0], [3.3, -0.35], [6.5, 0], [9.7, -0.25]];
  let k = 0;
  for (let j = 0; j <= segS; j++) {
    const s = S * j / segS;
    let y, z, ny, nz;
    if (s < Lf) { z = zF - s; y = 0; ny = 1; nz = 0; } else if (s < Lf + La) {
      const a = (s - Lf) / R; z = zC - Math.sin(a) * R; y = R - Math.cos(a) * R; ny = Math.cos(a); nz = Math.sin(a);
    } else { z = zC - R; y = R + (s - Lf - La); ny = 0; nz = 1; }
    const wall = smooth(Lf + 0.2, Lf + La + 1.4, s);
    for (let i = 0; i <= segX; i++) {
      const x = x0 + W * i / segX;
      const ph = Math.sin(x * 0.37) * 1.7 + Math.sin(x * 0.11 + 1.2) * 2.2;
      const drape = (0.17 * Math.sin(x * 1.75 + ph) + 0.06 * Math.sin(x * 4.3 + ph * 1.6 + 1.3) + 0.022 * Math.sin(x * 9.7 + 0.5)) * wall * (0.5 + 0.5 * smooth(0, 4, y));
      let away = 1;
      for (const [sx, sz] of specs) away = Math.min(away, smooth(0.75, 1.7, Math.hypot(x - sx, z - sz)));
      const ripple = (0.03 * Math.sin(x * 2.1 + z * 1.6 + Math.sin(z * 0.9) * 2) * Math.sin(z * 1.3 - x * 0.45) + 0.012 * Math.sin(x * 5.3 - z * 3.1)) * away * (1 - wall);
      const d = drape + ripple;
      pos[k * 3] = x; pos[k * 3 + 1] = y + ny * d; pos[k * 3 + 2] = z + nz * d;
      uv[k * 2] = x / 2.2; uv[k * 2 + 1] = s / 2.2;
      k++;
    }
  }
  const idx = [];
  for (let j = 0; j < segS; j++) for (let i = 0; i < segX; i++) {
    const a = j * (segX + 1) + i, b = a + 1, c = a + segX + 1, e = c + 1;
    idx.push(a, b, c, b, e, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const cove = new THREE.Mesh(coveGeometry(), velvet);
cove.receiveShadow = true;
scene.add(cove);

// ─── Specimens ─────────────────────────────────────────────────────────────────
const SPECS = [
  { key: 'geode', file: 'models/lithos/geode.glb', pos: V3(0, 0, 0) },
  { key: 'quartz', file: 'models/lithos/quartz.glb', pos: V3(3.3, 0, -0.35), size: 1.2, axis: 'y', yaw: -24 * D },
  { key: 'pyrite', file: 'models/lithos/pyrite.glb', pos: V3(6.5, 0, 0), size: 1.08, axis: 'max', yaw: 18 * D },
  { key: 'ammonite', file: 'models/lithos/ammonite.glb', pos: V3(9.7, 0, -0.25), size: 1.02, axis: 'y', yaw: -16 * D },
];
const FOCUS = [V3(0, 0.46, 0), V3(3.3, 0.55, -0.35), V3(6.5, 0.4, 0), V3(9.7, 0.5, -0.25), V3(4.85, 0.45, -0.15)];
let geode = null;
const loads = SPECS.map((s, i) => assets.gltf(s.file).then(g => {
  if (s.key === 'geode') {
    geode = new Geode(g, { size: 1.0, position: s.pos, scene, camera, renderer });
    geode.on(e => onGeode(e));
    return;
  }
  const m = g.scene;
  normalize(m, s.size, { axis: s.axis });
  const holder = new THREE.Group();
  holder.position.copy(s.pos);
  holder.rotation.y = s.yaw;
  holder.add(m);
  scene.add(holder);
  s.model = m;
  const aniso = renderer.capabilities.getMaxAnisotropy();
  m.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const src = o.material;
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (src[k]) src[k].anisotropy = aniso;
    if (s.key === 'quartz') o.material = crystalMaterial(src, { envMap: jewelEnv });
    else if (s.key === 'pyrite') patchPyrite(src, jewelEnv);
    else if (s.key === 'ammonite') o.material = nacreMaterial(src, jewelEnv);
  });
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m);
  FOCUS[i].copy(box.getCenter(V3())).setY(box.min.y + (box.max.y - box.min.y) * 0.46);
}).catch(e => console.error('specimen', s.key, e)));

// ─── Lights: a museum vitrine rig that travels with the camera ────────────────
scene.add(new THREE.HemisphereLight(0x2a2438, 0x050407, 0.08));
function spot(color, intensity, dist, angle, pen, decay = 2) {
  const l = new THREE.SpotLight(color, intensity, dist, angle, pen, decay);
  scene.add(l, l.target);
  return l;
}
const key = spot(0xfff2e6, 0, 11, 0.36, 0.85);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.5; key.shadow.camera.far = 9;
key.shadow.bias = -0.00012; key.shadow.normalBias = 0.012; key.shadow.radius = 3;
const rim = spot(0xd4dcff, 0, 9, 0.5, 0.8);
const pool = spot(0x8a6ee0, 0, 14, 0.4, 1, 1.4);
const lamp = spot(0xf6f2ff, 0, 5, 0.85, 1);   // the cursor light
lamp.castShadow = true;
lamp.shadow.mapSize.set(1024, 1024);
lamp.shadow.camera.near = 0.05; lamp.shadow.camera.far = 5;
lamp.shadow.bias = -0.0002; lamp.shadow.normalBias = 0.01; lamp.shadow.radius = 4;
const pins = SPECS.map(s => {
  const l = spot(0xfff0e0, 0, 7, 0.2, 0.75);
  l.position.copy(s.pos).add(V3(0.25, 3.2, 0.95));
  l.target.position.copy(s.pos).add(V3(0, 0.4, 0));
  return l;
});
vol.add(key, { scale: 0.0022, range: 0.16, softness: 0.4 });
const K = { key: 44, rim: 22, pool: 70, lamp: 4.5, pin: 7 };
const power = { v: 0 };  // global light-up during the intro

// Motes of dust drifting in the vitrine light.
const motes = (() => {
  const N = 3200;
  const p = new Float32Array(N * 3), s = new Float32Array(N);
  for (let i = 0; i < N; i++) { p.set([Math.random() * 13 - 1.8, Math.random() * 2.6, Math.random() * 3.4 - 1.8], i * 3); s[i] = Math.random(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(s, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uKP: { value: V3() }, uKD: { value: V3(0, -1, 0) }, uCos: { value: 0.94 }, uLP: { value: V3() }, uPow: { value: 0 }, uDpr: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float seed; uniform float uTime, uCos, uPow, uDpr; uniform vec3 uKP, uKD, uLP; varying float vA;
      void main(){
        vec3 p = position; float t = uTime * (0.03 + seed * 0.04);
        p += vec3(sin(t * 3.1 + seed * 40.), sin(t * 2.3 + seed * 13.) * 0.5 + t * 0.12, cos(t * 2.7 + seed * 27.)) * 0.3;
        p.y = mod(p.y, 2.6) + 0.02;
        vec3 d = p - uKP; float dist = length(d);
        float cone = smoothstep(uCos, uCos + 0.025, dot(d / dist, uKD));
        float nearL = exp(-length(p - uLP) * 3.5) * 0.8;
        vA = (cone * 0.9 / (1. + dist * dist * 0.1) + nearL) * uPow * (0.35 + 0.65 * fract(seed * 91.7));
        vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.8 + seed * 1.8) * uDpr * (3.0 / -mv.z);
        if (vA < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`varying float vA; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, 0., d) * vA; if (a < 0.003) discard; gl_FragColor = vec4(vec3(1., .95, 1.) * 1.6, min(a, 1.)); }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; scene.add(pts);
  return mat;
})();

// ─── Camera stations ───────────────────────────────────────────────────────────
// pos / look for a 16:10 frame; f = focus specimen for the light rig (4 = the whole row).
const ST = {
  hero: { pos: [0, 1.25, 5.8], look: [0, 0.95, 0], key: [-2.5, 1.45, 0.55], lampK: 0.45, f: 0, range: 3.4, wide: 0 },
  heroO: { pos: [0.42, 2.75, 6.6], look: [0.42, 1.12, -0.2], f: 0, range: 3.2, wide: 0 },
  crack: { pos: [-1.55, 1.15, 3.55], look: [-0.7, 0.5, 0.0], key: [-2.3, 1.6, 1.25], lampK: 0.55, lift: -0.07, f: 0, range: 3, wide: 0 },
  crackO: { pos: [-0.9, 2.6, 3.9], look: [-0.25, 0.26, -0.2], f: 0, range: 2.2, wide: 0 },
  amethyst: { pos: [0.2, 2.75, 3.45], look: [-0.02, 0.24, -0.28], f: 0, range: 2.6, wide: 0, card: true, mk: 1.3 },
  quartz: { pos: [3.95, 0.8, 2.85], look: [3.72, 0.6, -0.35], f: 1, range: 2.8, wide: 0, card: true },
  pyrite: { pos: [5.98, 1.3, 2.55], look: [6.12, 0.42, 0.0], f: 2, range: 2.8, wide: 0, card: true },
  ammonite: { pos: [10.5, 0.8, 3.15], look: [10.32, 0.55, -0.25], f: 3, range: 2.8, wide: 0, card: true },
  wide: { pos: [4.85, 5.4, 13.2], look: [4.85, -1.15, -0.15], f: 4, range: 8, wide: 1 },
  low: { pos: [-1.35, 0.3, 1.4], look: [3.2, 0.44, -0.4], f: 0, range: 1.8, wide: 0.4, dofAt: 1 },
  foot: { pos: [0.5, 4.3, 5.6], look: [0.42, -1.25, -0.35], f: 0, range: 3, wide: 0 },
  final: { pos: [0.5, 3.75, 5.2], look: [0.42, -0.8, -0.35], f: 0, range: 2.6, wide: 0, lift: 0.1, mk: 1.15 },
};
const stationEls = [...document.querySelectorAll('[data-station]')];
let spans = [];
function measure() {
  const vh = innerHeight;
  spans = stationEls.map(el => {
    const r = el.getBoundingClientRect();
    const top = r.top + scrollY, h = r.height;
    const hold = parseFloat(el.dataset.hold ?? 0.62);
    const c = top + Math.max(0, h - vh) / 2, half = Math.max(0, h - vh) / 2 * hold;
    return { name: el.dataset.station, a: c - half, b: c + half };
  });
  spans[0].a = 0; spans[0].b = 0;
  const max = document.documentElement.scrollHeight - vh;
  for (const sp of spans) { sp.a = Math.min(sp.a, max - 2); sp.b = Math.min(sp.b, max - 1); }
  bindCards();
}
function stationFloat(y) {
  for (let i = 0; i < spans.length; i++) {
    if (y <= spans[i].b) return i === 0 || y >= spans[i].a ? i : i - 1 + smooth(spans[i - 1].b, spans[i].a, y);
  }
  return spans.length - 1;
}

const tmpA = V3(), tmpB = V3(), tmpC = V3();
let cards = [];
function bindCards() {
  cards = [...document.querySelectorAll('.spec')].map(sec => ({ el: sec.querySelector('.spec-card'), idx: spans.findIndex(sp => sp.name === sec.dataset.station) }));
}
function stationPose(name, out) {
  let s = ST[name];
  out.pos.set(...s.pos); out.look.set(...s.look);
  // Once the stone is open, the hero and crack framings rise to look into the cavities.
  const alt = ST[name + 'O'];
  if (alt && geode) {
    const o = smooth(0, 1, geode.open);
    out.pos.lerp(tmpA.set(...alt.pos), o); out.look.lerp(tmpB.set(...alt.look), o);
  }
  out.focus.copy(FOCUS[s.f]);
  if (s.f === 0 && geode) out.focus.lerp(tmpC.set(0.44, 0.46, -0.16), smooth(0, 1, geode.open));
  out.dofAt.copy(FOCUS[s.dofAt ?? s.f]);
  out.range = s.range; out.wide = s.wide;
  out.key.set(...(s.key ?? KEY)); out.lampK = s.lampK ?? 1;
  if (alt && geode && !alt.key) { const o = smooth(0, 1, geode.open); out.key.lerp(tmpA.set(...KEY), o); out.lampK = lerp(out.lampK, 1, o); }
  // Portrait screens: centre the specimen and step back so it fits the narrow frame.
  const a = camera.aspect;
  if (a < 1.25) {
    const k = lerp(2.05, 1.1, clamp((a - 0.45) / 0.8)) * (s.mk ?? 1);
    const f = s.f === 4 ? out.look : out.focus;
    out.look.x = lerp(out.look.x, f.x, 0.8); out.look.z = lerp(out.look.z, f.z, 0.8);
    out.look.y = lerp(out.look.y, f.y, 0.5) + 0.12;
    out.pos.sub(out.look).multiplyScalar(k).add(out.look);
    // Specimen stations: the card owns the lower part of a phone screen, so lift the specimen into the upper half.
    if (s.card || s.lift) { const dz = out.pos.distanceTo(out.look) * (s.lift ?? 0.085); out.look.y -= dz; out.pos.y -= dz; }
  }
  return out;
}
const KEY = [-1.05, 2.85, 1.3];
const mkPose = () => ({ pos: V3(), look: V3(), focus: V3(), dofAt: V3(), key: V3(), lampK: 1, range: 1, wide: 0 });
const pA = mkPose(), pB = mkPose(), pose = mkPose();
const cam = { pos: V3(0, 1.4, 6), look: V3(0, 0.8, 0), focus: V3().copy(FOCUS[0]), dofAt: V3().copy(FOCUS[0]), range: 1.2, wide: 0 };
let stF = 0, stSmooth = 0;
const intro = { k: 1 };
const shake = { v: 0 };

// ─── Interaction state ─────────────────────────────────────────────────────────
const root = document.documentElement;
const pressEl = document.querySelector('.press');
const labelEl = document.querySelector('.hero .label');
const labelHTML = labelEl.innerHTML;
const toastEl = document.querySelector('.toast');
const hintEl = document.querySelector('.light-hint');
const hotspot = document.createElement('div');
hotspot.className = 'hotspot';
hotspot.innerHTML = '<i></i><span class="cz">Press &amp; hold</span>';
document.body.appendChild(hotspot);
let holding = false, started = false, lastMove = -10;
let toastTimer;
function toast(msg, ms = 3600) {
  toastEl.textContent = msg; toastEl.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms);
}
const uiTarget = e => e.target.closest?.('a,button,.spec-card,.piece,.prov-inner,.visit-inner,.foot,.nav,.tw-nav');
let overUI = false;
pointer.on('move', e => { lastMove = engine.time; overUI = !!uiTarget(e); });
addEventListener('pointerdown', e => {
  if (!started || !geode || geode.state !== 'closed' || uiTarget(e) || e.button > 0) return;
  if (stSmooth > 1.7) return;
  holding = true;
  document.body.classList.add('is-holding');
});
const release = () => { holding = false; document.body.classList.remove('is-holding'); };
addEventListener('pointerup', release);
addEventListener('pointercancel', release);
addEventListener('blur', release);
addEventListener('contextmenu', e => { if (holding) e.preventDefault(); });
document.querySelector('.reseal').addEventListener('click', () => geode?.reseal());

function onGeode(e) {
  if (e === 'split') {
    release();
    sound.crack();
    document.body.classList.add('is-open');
    labelEl.innerHTML = '<b>Specimen I</b><br>Amethyst geode · Artigas<br>Opened by you, just now';
    toast('Specimen I — seen for the first time in 132 million years');
    gsap.fromTo(shake, { v: 1 }, { v: 0, duration: 1.1, ease: 'power2.out' });
  }
  if (e === 'closed') { document.body.classList.remove('is-open'); labelEl.innerHTML = labelHTML; }
}

// ─── Frame loop ────────────────────────────────────────────────────────────────
const ray = new THREE.Raycaster();
const aim = new THREE.Vector2();
const right = V3(), up = V3(), fwd = V3();
const lampPos = V3(0, 1, 2);
engine.onResize((w, h, dpr) => {
  measure();
  geode?.setDpr(dpr);
  motes.uniforms.uDpr.value = dpr;
  dof?.cocMaterial.copyCameraSettings(camera);
});

engine.onTick((dt, t) => {
  pointer.update(dt);
  const y = scrollY;
  stF = stationFloat(y);
  stSmooth = damp(stSmooth, stF, 6, dt);
  const i = Math.min(spans.length - 2, Math.floor(stSmooth));
  const f = stSmooth - i;
  stationPose(spans[i].name, pA);
  stationPose(spans[Math.min(i + 1, spans.length - 1)].name, pB);
  pose.pos.lerpVectors(pA.pos, pB.pos, f);
  pose.look.lerpVectors(pA.look, pB.look, f);
  pose.focus.lerpVectors(pA.focus, pB.focus, f);
  pose.dofAt.lerpVectors(pA.dofAt, pB.dofAt, f);
  pose.range = lerp(pA.range, pB.range, f);
  pose.wide = lerp(pA.wide, pB.wide, f);
  pose.key.lerpVectors(pA.key, pB.key, f);
  pose.lampK = lerp(pA.lampK, pB.lampK, f);
  // Crane move between stations: rise and ease back mid-flight.
  const arc = Math.sin(f * Math.PI);
  pose.pos.y += arc * 0.22;
  tmpA.subVectors(pose.pos, pose.look).normalize();
  pose.pos.addScaledVector(tmpA, arc * 0.45);
  // Intro dolly.
  pose.pos.addScaledVector(tmpA, intro.k * 2.2).y += intro.k * 0.5;

  // Auto-open once the visitor scrolls into the collection without cracking it.
  const colIdx = spans.findIndex(s => s.name === 'amethyst');
  if (geode && geode.state === 'closed' && stF > colIdx - 0.55 && started) geode.split();

  cam.pos.copy(pose.pos); cam.look.copy(pose.look);
  camera.position.copy(cam.pos);
  camera.lookAt(cam.look);
  camera.updateMatrixWorld();
  right.setFromMatrixColumn(camera.matrixWorld, 0); up.setFromMatrixColumn(camera.matrixWorld, 1);
  const px = touch ? 0 : pointer.sx, py = touch ? 0 : pointer.sy;
  camera.position.addScaledVector(right, px * 0.05).addScaledVector(up, py * 0.03);
  if (geode && geode.state === 'closed') {
    const h = geode.hold;
    camera.position.addScaledVector(fwd.subVectors(cam.look, cam.pos).normalize(), h * h * 0.18);
  }
  if (shake.v > 0.001) camera.position.add(tmpA.set(Math.sin(t * 91), Math.sin(t * 77 + 1), Math.sin(t * 83 + 2)).multiplyScalar(shake.v * 0.018));
  camera.lookAt(cam.look);
  camera.updateMatrixWorld();

  // Light rig follows the focus.
  const F = cam.focus.copy(pose.focus);
  const wide = pose.wide;
  key.position.copy(F).add(pose.key).add(tmpA.set(-wide * 0.4, wide * 1.6, wide * 1.4));
  key.target.position.copy(F);
  key.angle = lerp(0.36, 0.62, wide);
  key.intensity = K.key * power.v * (1 + wide * 1.2);
  rim.position.copy(F).add(tmpA.set(1.4, 2.2, -2.3)); rim.target.position.copy(F).add(tmpA.set(0, 0.2, 0));
  rim.intensity = K.rim * power.v;
  pool.position.copy(F).add(tmpA.set(0.3, 3.4, 1.7)); pool.target.position.copy(F).add(tmpA.set(0, 1.2, -3.9));
  pool.intensity = K.pool * power.v;
  pins.forEach((l, k) => { l.intensity = K.pin * power.v * (0.35 + wide * 1.1 + (1 - Math.min(1, cam.focus.distanceTo(FOCUS[k]) / 2)) * 0.2); });

  // The cursor is a light: it hangs on the pointer ray, in front of the specimen.
  const user = touch ? (pointer.down ? 1 : 0) : clamp(1 - (t - lastMove - 4) / 2);
  const ix = Math.sin(t * 0.31) * 0.55 + Math.sin(t * 0.77) * 0.12, iy = Math.cos(t * 0.43) * 0.25 + 0.2;
  aim.set(lerp(ix, pointer.sx, user), lerp(iy, pointer.sy, user));
  ray.setFromCamera(aim, camera);
  const reach = camera.position.distanceTo(F) * 0.6;
  tmpA.copy(ray.ray.origin).addScaledVector(ray.ray.direction, reach);
  tmpA.y = Math.max(tmpA.y, 0.12);
  lampPos.lerp(tmpA, 1 - Math.exp(-10 * dt));
  lamp.position.copy(lampPos);
  lamp.target.position.copy(F).add(tmpB.set(0, 0.1, 0));
  lamp.intensity = K.lamp * power.v * (0.7 + 0.3 * user) * (1 - wide * 0.5) * pose.lampK;

  // Geode.
  if (geode) {
    geode.update(dt, t, holding);
    const u = geode.u;
    u.uL1Pos.value.copy(lamp.position).applyMatrix4(camera.matrixWorldInverse);
    u.uL1Col.value.set(1, 0.97, 1.02).multiplyScalar(lamp.intensity * 0.8);
    u.uL2Pos.value.copy(key.position).applyMatrix4(camera.matrixWorldInverse);
    u.uL2Col.value.set(1, 0.95, 0.9).multiplyScalar(key.intensity * 0.05);
    geode.setLights(lamp.position, lamp.intensity * 1.4, key.position, key.intensity * 0.07);
    root.style.setProperty('--hold', geode.hold.toFixed(3));
    sound.setHold(holding ? geode.hold : 0);
    // Hotspot on the seam.
    const showHot = started && geode.state === 'closed' && stSmooth < 1.6 && !holding;
    hotspot.classList.toggle('on', showHot);
    if (showHot) {
      tmpA.copy(geode.front).project(camera);
      hotspot.style.transform = `translate3d(${((tmpA.x + 1) / 2 * innerWidth - 7).toFixed(1)}px, ${((1 - tmpA.y) / 2 * innerHeight - 7).toFixed(1)}px, 0)`;
    }
    pressEl.classList.toggle('on', holding || (started && geode.state === 'closed' && stSmooth < 1.6 && pointer.active && !touch && !overUI));
  }
  pressEl.style.transform = `translate3d(${pointer.px}px, ${pointer.py}px, 0)`;
  hintEl.classList.toggle('on', started && !touch && stSmooth > 2.2 && stSmooth < 6.5);
  // Specimen cards belong to their camera station: they rise in as the camera settles and leave as it moves on.
  for (const c of cards) {
    const d = stSmooth - c.idx;
    const v = 1 - smooth(0.22, 0.5, Math.abs(d));
    c.el.style.opacity = v.toFixed(3);
    c.el.style.setProperty('--ty', ((d < 0 ? 1 : -1) * (1 - v) * 60).toFixed(1) + 'px');
    c.el.style.visibility = v < 0.01 ? 'hidden' : 'visible';
  }

  // Motes.
  motes.uniforms.uTime.value = t;
  motes.uniforms.uKP.value.copy(key.position);
  motes.uniforms.uKD.value.subVectors(key.target.position, key.position).normalize();
  motes.uniforms.uCos.value = Math.cos(key.angle * 0.95);
  motes.uniforms.uLP.value.copy(lamp.position);
  motes.uniforms.uPow.value = power.v;

  // Focus pull.
  if (dof) {
    dof.cocMaterial.focusDistance = camera.position.distanceTo(pose.dofAt);
    dof.cocMaterial.focusRange = pose.range;
  }
});

// ─── Boot ──────────────────────────────────────────────────────────────────────
worldNav('lithos', { theme: 'dark', corner: 'bl' });
const cur = cursor({ color: '#e9e2ff', blend: 'normal', size: 34 });
magnetic();
const lenis = smoothScroll({ lerp: 0.08 });
document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
  const id = a.getAttribute('href');
  const el = id.length > 1 ? document.querySelector(id) : null;
  e.preventDefault();
  lenis.scrollTo(el ?? 0, { duration: 2.2, easing: t => 1 - Math.pow(1 - t, 4) });
}));
reveal('.h2', { type: 'lines', stagger: 0.1 });
reveal('.lede, .spec-desc, .principles p', { type: 'lines', stagger: 0.05, y: '100%' });
gsap.utils.toArray('.piece, .principles li, .stats > div').forEach(el => gsap.from(el, { opacity: 0, y: 50, duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 88%', once: true } }));
window.__lithos = {
  scrollTo: f => lenis.scrollTo(f * (document.documentElement.scrollHeight - innerHeight), { immediate: true }),
  station: name => { const s = spans.find(x => x.name === name); lenis.scrollTo((s.a + s.b) / 2, { immediate: true }); },
  split: () => geode?.split(), debug: () => ({ stF, stSmooth, y: scrollY, spans: spans.map(s => [s.name, Math.round(s.a), Math.round(s.b)]) }), get geode() { return geode; }, engine, scene, motes, cove, lights: { key, rim, pool, lamp, pins },
};

await Promise.all(loads);
await document.fonts?.ready;
measure();
// Warm every program with all lights at full power before the curtain lifts.
power.v = 1;
geode.u.uGlint.value = 1; geode.u.uCrack.value = 0.5;
renderer.compile(scene, camera);
geode.u.uGlint.value = 0; geode.u.uCrack.value = 0;
power.v = 0;
engine.start();
await loader.finish();
gsap.to(power, { v: 1, duration: 2.6, ease: 'power2.inOut', delay: 0.1 });
gsap.to(intro, { k: 0, duration: 3.4, ease: 'expo.out' });
gsap.from('.title .line > span', { yPercent: 105, duration: 2.0, ease: 'expo.out', stagger: 0.14, delay: 0.35 });
gsap.from('.hero .eyebrow, .hero-foot > *, .nav', { opacity: 0, y: 16, duration: 1.4, ease: 'power3.out', stagger: 0.08, delay: 0.9 });
setTimeout(() => { started = true; window.__lithosReady = true; }, 1200);
