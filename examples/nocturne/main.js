import { Engine, THREE, normalize, prepModel, damp, clamp, smooth, lerp, studioEnvironment } from '../../src/core/engine.js';
import { Assets, sampleSurface, firstMesh } from '../../src/core/assets.js';
import { Pointer } from '../../src/core/input.js';
import { smoothScroll, gsap, reveal } from '../../src/core/scroll.js';
import { preloader, cursor, magnetic, worldNav } from '../../src/core/ui.js';
import { PlanarReflection } from '../../src/core/reflector.js';
import { createBottle, DIM } from './bottle.js';
import { createFloor } from './floor.js';
import { createStream, burnKey, BURN_GLSL, BURN_A, BURN_B, DUR } from './stream.js';

const D2R = Math.PI / 180;
const Q = new URLSearchParams(location.search);
const P_END = 1 + DUR * 1.25 + 0.04;          // stream progress at which every particle has landed
const FILL0 = 0.42, FILL_STEP = 0.12;          // hero level, and what each note adds

// ─── Engine ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gl');
const engine = new Engine({
  canvas, fov: 26, near: 0.05, far: 60, dpr: 1.5, background: 0x040303,
  post: {
    ao: { aoRadius: 0.45, intensity: 1.6, distanceFalloff: 0.5 },
    bloom: { intensity: 0.85, luminanceThreshold: 0.78, luminanceSmoothing: 0.28, radius: 0.72 },
    tone: 'aces',
    vignette: { offset: 0.2, darkness: 0.8 },
    noise: 0.045,
    ca: 0.0007,
  },
});
const { scene, camera, renderer } = engine;
// The transmission pass clears to 50% white when the clear alpha is < 1 (the AO pass leaves it at 0): a real
// background colour makes the glass refract the black studio instead of a white void.
scene.background = new THREE.Color(0x040303);
// The studio rig is defined relative to the camera (camera on +Z looking at the flacon) and rotated with the orbit,
// the way a photographer moves the softboxes with the camera: the long strip highlights stay put on the glass.
const RIG = [
  { pos: [-0.42, 2.0, 7.6], size: [0.13, 11], intensity: 9, color: 0xfff4e6, glass: 5 },   // the long front strip
  { pos: [0.9, 1.6, 7.6], size: [0.06, 11], intensity: 4, color: 0xfff0dc, glass: 5 },     // its thin twin
  { pos: [-7.6, 2.2, 0.9], size: [0.7, 12], intensity: 10, color: 0xfff1e0, glass: 2.2 },  // left side strip -> chamfers
  { pos: [7.6, 2.2, -0.6], size: [0.5, 12], intensity: 7, color: 0xffeedd, glass: 2.2 },   // right side strip
  { pos: [-3.0, 2.8, -7.0], size: [0.45, 11], intensity: 6, color: 0xffd99c, glass: 2.5 }, // gold rim strips behind
  { pos: [3.4, 2.8, -7.0], size: [0.4, 11], intensity: 5, color: 0xffcf8a, glass: 2.5 },
  { pos: [0.6, 9, 0.4], size: [3.0, 0.35], intensity: 2.2, color: 0xfff4e6, glass: 1.5 },  // top bar -> shoulders
  { pos: [-4.5, 1.0, 6.0], size: [2.4, 2.4], intensity: 0.35, color: 0xffe6c4, glass: 1 }, // soft front fill
];
const ENV = studioEnvironment(renderer, { top: 0x0a0807, bottom: 0x010101, blur: 0.012, panels: RIG });
// Glass only reflects ~4% head-on, so it sees the same rig with the strips driven much hotter (metal would blow out).
const ENV_GLASS = studioEnvironment(renderer, { top: 0x0a0807, bottom: 0x010101, blur: 0.006, panels: RIG.map(p => ({ ...p, intensity: p.intensity * p.glass })) });
scene.environment = ENV;
scene.environmentIntensity = 1;
// r186 ignores material.envMapIntensity unless the material owns its envMap, so every lit material gets ENV explicitly
// (and its rotation is driven with the orbit, like scene.environmentRotation would be).
const envMats = new Set();
function useEnv(root, env = ENV) {
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [o.material].flat()) if (m && (m.isMeshStandardMaterial) && !envMats.has(m)) { m.envMap = env; m.needsUpdate = true; envMats.add(m); }
  });
}

const assets = new Assets();
const pointer = new Pointer({ lambda: 6 });
const loaderEl = document.querySelector('.loader');
const ldLiquid = loaderEl.querySelector('.ld-liquid');
const ldPct = loaderEl.querySelector('.ld-pct');
const loader = preloader({
  assets, el: loaderEl, minTime: 1500,
  onValue: v => {
    ldPct.textContent = Math.round(v * 100);
    const h = 68 * v;
    ldLiquid.setAttribute('y', 112 - h); ldLiquid.setAttribute('height', h);
  },
});

// Fonts must exist before we paint them into textures.
const fontsReady = Promise.race([
  Promise.all(['400 120px "Bodoni Moda"', 'italic 400 120px "Bodoni Moda"', '400 120px Italiana', '500 30px "Hanken Grotesk"'].map(f => document.fonts.load(f))),
  new Promise(r => setTimeout(r, 3500)),
]);

// ─── Lights ────────────────────────────────────────────────────────────────────
const KEY_POS = new THREE.Vector3(-3.3, 3.8, -3.1);
const key = new THREE.SpotLight(0xffdfb2, 170, 20, 0.34, 0.6, 1.7);
key.position.copy(KEY_POS);
key.target.position.set(0, 0.55, 0);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1; key.shadow.camera.far = 14;
key.shadow.bias = -0.0002; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
scene.add(key, key.target);
const fill = new THREE.SpotLight(0xffeedd, 26, 18, 0.15, 0.8, 1.6);
fill.position.set(3.4, 1.05, 4.6); fill.target.position.set(0, 1.45, 0);
scene.add(fill, fill.target);
const noteKey = new THREE.SpotLight(0xfff0dc, 0, 12, 0.45, 0.8, 1.5);
scene.add(noteKey, noteKey.target);
const noteRim = new THREE.SpotLight(0xffc98a, 0, 12, 0.5, 0.8, 1.5);
scene.add(noteRim, noteRim.target);
for (const l of [key, fill, noteKey, noteRim]) l.layers.enable(1);

// ─── Floor & reflection ────────────────────────────────────────────────────────
const reflection = new PlanarReflection(renderer, { resolution: 0.5 });
engine.onResize((w, h, dpr) => reflection.setSize(w, h, dpr));
const floor = createFloor(renderer, reflection);
scene.add(floor.mesh);
floor.mesh.layers.enable(1);

// Backlight haze behind the flacon (additive, drawn over the floor so there is no horizon line).
const glow = (() => {
  const m = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(0.42, 0.22, 0.08) }, uI: { value: 0.1 } },
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform vec3 uCol; uniform float uI;
      void main(){ vec2 p = (vUv - 0.5) * 2.0; p.y -= 0.08;
        float r = length(p * vec2(1.0, 1.6));
        float g = exp(-r * r * 7.0) * 0.8 + exp(-r * r * 26.0) * 0.9;
        float col = exp(-pow(p.x * 11.0, 2.0)) * exp(-pow((p.y - 0.05) * 2.6, 2.0)) * 0.55;
        gl_FragColor = vec4(uCol * (g + col) * uI, 1.0); }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 11), m);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.layers.enable(1);
  scene.add(mesh);
  reflection.hidden.push(mesh);
  return { mesh, m };
})();

// The title, in the scene, behind the glass — so the flacon refracts it.
const title = { mesh: null, mat: null, v: 0 };
function makeTitle() {
  const c = document.createElement('canvas'); c.width = 4096; c.height = 1100;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  const grd = g.createLinearGradient(0, 180, 0, 900);
  grd.addColorStop(0, '#fff2d2'); grd.addColorStop(0.55, '#e3c283'); grd.addColorStop(1, '#8e6630');
  g.fillStyle = grd; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = '400 900px "Bodoni Moda", Didot, serif';
  if ('letterSpacing' in g) g.letterSpacing = '-24px';
  g.fillText('Nocturne', 2048, 830);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(0, 0, 0) });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 7.4 * 1100 / 4096), mat);
  mesh.position.set(0, 0.98, -2.1);
  mesh.renderOrder = -5;
  mesh.layers.enable(1);
  scene.add(mesh);
  title.mesh = mesh; title.mat = mat;
}

// ─── The flacon ────────────────────────────────────────────────────────────────
let bottle;
const bgRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true });
const bgCam = new THREE.PerspectiveCamera();
bgCam.layers.set(1);
engine.onResize((w, h, dpr) => bgRT.setSize(Math.round(w * dpr * 0.5), Math.round(h * dpr * 0.5)));

// ─── Notes ─────────────────────────────────────────────────────────────────────
const NOTES = [
  { key: 'bergamot', file: 'models/nocturne/bergamot.glb', size: 1.05, axis: 'max', yaw: -30, pitch: 8 },
  { key: 'iris', file: 'models/nocturne/iris.glb', size: 1.45, axis: 'y', yaw: 20, pitch: 0 },
  { key: 'vanilla', file: 'models/nocturne/vanilla.glb', size: 1.2, axis: 'max', yaw: 70, pitch: 10 },
  { key: 'oud', file: 'models/nocturne/oud.glb', size: 1.15, axis: 'max', yaw: -25, pitch: 0 },
];

// Scroll stops: camera orbit around the flacon, where the flacon sits on screen (lx, ly in NDC) and where the note floats.
const STOPS = [
  { yaw: 0, elev: 4.5, dist: 6.9, look: [0, 0.93, 0], lx: 0, ly: 0 },
  { yaw: 30, elev: 9, dist: 6.9, look: [0, 0.9, 0], lx: 0.12, ly: 0, note: { nx: 0.57, ny: 0.1, dz: 0.4, side: 1 } },
  { yaw: -32, elev: 13, dist: 7.0, look: [0, 0.92, 0], lx: -0.16, ly: 0, note: { nx: -0.64, ny: 0.14, dz: 0.3, side: -1 } },
  { yaw: 58, elev: 19, dist: 6.8, look: [0, 0.82, 0], lx: 0.1, ly: 0.03, note: { nx: 0.53, ny: -0.1, dz: 0.5, side: 1 } },
  { yaw: -60, elev: 5, dist: 7.0, look: [0, 0.9, 0], lx: -0.16, ly: 0, note: { nx: -0.63, ny: 0.05, dz: 0.3, side: -1 } },
  { yaw: 22, elev: 9, dist: 4.7, look: [0, 0.98, 0], lx: 0.3, ly: 0.0 },
  { yaw: -18, elev: 7, dist: 7.0, look: [0, 0.92, 0], lx: 0.34, ly: 0 },
  { yaw: -30, elev: 12, dist: 9.2, look: [0, 0.9, 0], lx: 0.0, ly: 0.12 },
];
const mobile = () => innerWidth / innerHeight < 0.8;
function stopView(k) {
  const s = STOPS[k];
  if (!mobile()) return s;
  // Portrait: the flacon rides high, the copy sits underneath, notes float above the cap.
  const m = { ...s, lx: 0, ly: 0.47, dist: s.dist * (k === 5 ? 2.0 : 2.0) };
  if (s.note) m.note = { ...s.note, nx: s.note.side * 0.5, ny: 0.64, dz: 0.5 };
  if (k === 0) { m.ly = 0.18; m.dist = s.dist * 1.62; }
  return m;
}

const notes = NOTES.map((n, i) => ({ ...n, i, stop: i + 1, P: 0, arrive: 0, group: new THREE.Group(), rest: new THREE.Vector3(), from: new THREE.Vector3(), mesh: null, stream: null, U: null }));
const noteLoads = notes.map(n => assets.gltf(n.file).then(g => {
  const m = g.scene;
  normalize(m, n.size, { ground: false, axis: n.axis });
  prepModel(m, renderer, { env: 0.75, metal: 0 });
  const holder = new THREE.Group();
  holder.rotation.set(n.pitch * D2R, n.yaw * D2R, 0);
  holder.add(m);
  n.group.add(holder);
  n.holder = holder;
  n.mesh = firstMesh(m);
  useEnv(m);
  n.group.visible = false;
  n.group.traverse(o => o.layers.enable(1));
  scene.add(n.group);
}).catch(e => console.warn('note missing', n.key, e.message)));

let capModel = null;
const capLoad = assets.gltf('models/nocturne/cap.glb').then(g => {
  const m = g.scene;
  normalize(m, 0.6, { axis: 'y' });
  prepModel(m, renderer, { env: 1.9, onMat: mat => {
    mat.color?.setRGB(1.0, 0.93, 0.8);
    // Point lights on a mirror-smooth onyx make a blinding pin; keep a hair of roughness.
    mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = max(roughnessFactor, 0.2);'); };
  } });
  capModel = m;
  useEnv(m);
});

// Burn-dissolve for the note models (discard below a moving threshold, glowing gold at the front).
function burnMaterial(n, dir, mm, freq) {
  const U = { uBurn: { value: -1 }, uDir: { value: dir }, uMM: { value: new THREE.Vector2(...mm) }, uFreq: { value: freq }, uEdge: { value: new THREE.Color(1.0, 0.62, 0.22) } };
  n.mesh.material.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLocalP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vLocalP; uniform float uBurn, uFreq; uniform vec3 uDir, uEdge; uniform vec2 uMM; ${BURN_GLSL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float bk = burnKey(vLocalP, uDir, uMM, uFreq);
        if (bk < uBurn) discard;
        float bEdge = (1.0 - smoothstep(0.0, 0.045, bk - uBurn)) * step(-0.05, uBurn);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uEdge * bEdge * 7.0;`);
  };
  n.mesh.material.customProgramCacheKey = () => 'burn-' + n.key;
  n.mesh.material.needsUpdate = true;
  n.U = U;
}

// ─── Particles: dust, intro pour ─────────────────────────────────────────────
const dust = (() => {
  const N = 700;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = 0.5 + Math.pow(Math.random(), 0.7) * 4.5;
    pos.set([Math.cos(a) * r, Math.random() * 3.2, Math.sin(a) * r], i * 3);
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uDpr: { value: 1 }, uI: { value: 1 } },
    vertexShader: `attribute float seed; uniform float uTime, uDpr; varying float vA;
      void main(){ vec3 p = position; float t = uTime * (0.03 + seed * 0.04);
        p += vec3(sin(t * 3.1 + seed * 40.), 0.0, cos(t * 2.7 + seed * 27.)) * 0.4; p.y = mod(p.y + t * 0.6, 3.2);
        vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv;
        vA = (0.25 + 0.75 * fract(seed * 91.7)) * smoothstep(0.0, 0.4, p.y) * smoothstep(3.2, 2.4, p.y);
        gl_PointSize = (1.0 + seed * 2.2) * uDpr * (4.0 / -mv.z); }`,
    fragmentShader: `varying float vA; uniform float uI; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .0, d); gl_FragColor = vec4(vec3(1.0, .8, .52) * a * vA * 0.5 * uI, 1.); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.renderOrder = 9;
  scene.add(pts);
  engine.onResize((w, h, dpr) => { mat.uniforms.uDpr.value = dpr; });
  return mat;
})();

// Six spiral ribbons of gold that unwind into the flacon, inner ends first.
function introCloud(N) {
  const local = new Float32Array(N * 3), normal = new Float32Array(N * 3), color = new Float32Array(N * 3), key = new Float32Array(N);
  const R = 6;
  for (let i = 0; i < N; i++) {
    const r = i % R, u = Math.pow(Math.random(), 0.85);
    const a = r * Math.PI * 2 / R + u * 2.8 + (Math.random() - 0.5) * 0.12;
    const rad = 0.95 + u * 2.6 + (Math.random() - 0.5) * 0.12 * (1 + u);
    const y = 0.35 + u * 2.3 + Math.sin(u * 7 + r) * 0.18 + (Math.random() - 0.5) * 0.1;
    local.set([Math.cos(a) * rad, y, Math.sin(a) * rad * 0.75 - 0.2], i * 3);
    normal.set([-Math.sin(a) * 0.5, 0.35, Math.cos(a) * 0.5], i * 3);
    const g = Math.random();
    color.set([1.0, 0.62 + g * 0.2, 0.22 + g * 0.2], i * 3);
    key[i] = Math.min(0.92, u * 0.86 + Math.random() * 0.05);
  }
  return { local, normal, color, key };
}
const intro = { P: 0, stream: null };

// ─── Interaction: drag to tilt ─────────────────────────────────────────────────
const drag = { on: false, x0: 0, y0: 0, lx: 0, dx: 0, dy: 0, used: false, id: null };
const phys = { roll: 0, rollV: 0, pitch: 0, pitchV: 0, yaw: 0, yawV: 0, lift: 0, liftV: 0, demo: 0 };
const cur = cursor({ color: '#e8cf95', blend: 'normal', size: 34 });
cur?.set('hidden');
let overBottle = false, cursorState = '';
const bottleRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
function setCursor(s, label) { if (!cur || cursorState === s + label) return; cursorState = s + label; cur.set(s, label); }
function isUi(t) { return !!t.closest?.('a,button,.product,.nav,.tw-nav'); }
addEventListener('pointerdown', e => {
  if (!bottle || (e.pointerType === 'mouse' && e.button !== 0) || isUi(e.target)) return;
  const x = e.clientX, y = e.clientY;
  if (x < bottleRect.x0 || x > bottleRect.x1 || y < bottleRect.y0 || y > bottleRect.y1) return;
  drag.on = true; drag.x0 = drag.lx = x; drag.y0 = y; drag.dx = drag.dy = 0; drag.id = e.pointerId; drag.touch = e.pointerType !== 'mouse';
  if (!drag.used) { drag.used = true; document.body.classList.add('has-tilted'); }
  phys.demo = 0;
  if (e.pointerType === 'mouse') e.preventDefault();
}, { passive: false });
addEventListener('pointermove', e => {
  if (drag.on && e.pointerId === drag.id) {
    drag.dx = e.clientX - drag.x0; drag.dy = e.clientY - drag.y0;
    phys.yawV += (e.clientX - drag.lx) * 0.02;
    drag.lx = e.clientX;
  }
  overBottle = e.clientX > bottleRect.x0 && e.clientX < bottleRect.x1 && e.clientY > bottleRect.y0 && e.clientY < bottleRect.y1 && !isUi(e.target);
}, { passive: true });
const release = e => { if (drag.on && (!e || e.pointerId === drag.id)) drag.on = false; };
addEventListener('pointerup', release);
addEventListener('pointercancel', release);

// ─── Story (scroll) ────────────────────────────────────────────────────────────
const stopEls = [...document.querySelectorAll('[data-stop]')];
const footEl = document.querySelector('.foot');
const cards = [...document.querySelectorAll('.note-card')];
const heroEls = document.querySelectorAll('.hero-eyebrow, .hero-foot, .scroll-cue');
let anchors = [];
function measure() {
  anchors = stopEls.map(el => el.offsetTop);
  anchors.push(footEl.offsetTop - innerHeight * 0.2);
}
addEventListener('resize', measure);
function storyAt(y) {
  if (y <= anchors[0]) return 0;
  for (let k = 0; k < anchors.length - 1; k++) {
    if (y < anchors[k + 1]) return k + (y - anchors[k]) / (anchors[k + 1] - anchors[k]);
  }
  return anchors.length - 1;
}

// ─── Camera ────────────────────────────────────────────────────────────────────
const camLook = new THREE.Vector3(), camPos = new THREE.Vector3();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), qC = new THREE.Quaternion();
const cs = { yaw: 0, elev: 5, dist: 7.4, lx: 0, ly: 0, look: new THREE.Vector3() };
function blendStops(S, out) {
  const n = STOPS.length - 1;
  const i = Math.min(n - 1, Math.max(0, Math.floor(S)));
  const a = stopView(i), b = stopView(i + 1);
  const hold = a.note ? 0.24 : 0.05;
  const f = smooth(hold, 0.96, S - i);
  out.yaw = lerp(a.yaw, b.yaw, f); out.elev = lerp(a.elev, b.elev, f); out.dist = lerp(a.dist, b.dist, f);
  out.lx = lerp(a.lx, b.lx, f); out.ly = lerp(a.ly, b.ly, f);
  out.look.set(lerp(a.look[0], b.look[0], f), lerp(a.look[1], b.look[1], f), lerp(a.look[2], b.look[2], f));
  // Arc the orbit slightly upwards mid-transition.
  out.elev += Math.sin(f * Math.PI) * 3;
  return out;
}
function placeCamera(c, cam, extraYaw = 0, extraElev = 0) {
  const yaw = (c.yaw + extraYaw) * D2R, el = (c.elev + extraElev) * D2R;
  cam.position.set(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el)).multiplyScalar(c.dist).add(c.look);
  cam.lookAt(c.look);
  // Lens shift instead of re-aiming: the flacon moves on screen without changing the perspective.
  const t = Math.tan(cam.fov * D2R / 2);
  cam.filmOffset = -c.lx * cam.getFilmWidth() * cam.aspect * t;
  cam.updateProjectionMatrix();
  // Vertical placement: nudge the aim so the look point lands at NDC y = ly.
  if (c.ly) {
    const dy = c.ly * t * c.dist;
    v1.set(0, 1, 0).applyQuaternion(cam.quaternion);
    cam.lookAt(v2.copy(c.look).addScaledVector(v1, -dy));
  }
  cam.updateMatrixWorld();
}
// Note rest positions for a given stop, computed from that stop's camera so they land where the layout wants them.
const stopCam = new THREE.PerspectiveCamera(26, 1, 0.05, 60);
function notePose(n, out) {
  const s = stopView(n.stop);
  stopCam.aspect = camera.aspect; stopCam.fov = camera.fov;
  const c = { ...s, look: new THREE.Vector3(...s.look) };
  placeCamera(c, stopCam);
  const z = s.dist - s.note.dz;
  const t = Math.tan(stopCam.fov * D2R / 2);
  const fwd = v1.set(0, 0, -1).applyQuaternion(stopCam.quaternion);
  const right = v2.set(1, 0, 0).applyQuaternion(stopCam.quaternion);
  const up = v3.set(0, 1, 0).applyQuaternion(stopCam.quaternion);
  // Account for the lens shift: NDC x of the look point is lx.
  const ndcX = s.note.nx - s.lx * 0, ndcY = s.note.ny;
  v4.set(ndcX, ndcY, 0.5).unproject(stopCam).sub(stopCam.position).normalize();
  const cosA = v4.dot(fwd);
  out.rest.copy(stopCam.position).addScaledVector(v4, z / cosA);
  out.from.copy(out.rest).addScaledVector(right, s.note.side * 2.6).addScaledVector(up, 0.9).addScaledVector(fwd, 0.6);
  out.camRight = right.clone(); out.camFwd = fwd.clone();
}

// ─── Frame loop ────────────────────────────────────────────────────────────────
const toastEl = document.querySelector('.toast');
const gaugeFill = document.querySelector('.gauge-fill');
const gaugeV = document.querySelector('.gauge-v');
const gaugeTicks = [...document.querySelectorAll('.gauge-tick')];
const rootStyle = document.documentElement.style;
let S = 0, Sraw = 0, frameN = 0;
let introFill = 0;
const heroIn = { v: 0 };
const bottleWorld = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const box = new THREE.Box3();
const corners = Array.from({ length: 8 }, () => new THREE.Vector3());

function tick(dt, t) {
  pointer.update(dt);
  Sraw = storyAt(window.scrollY);
  S = damp(S, Sraw, 5.5, dt);
  document.body.classList.toggle('is-story', S > 0.55 && S < 5.4);

  // Camera
  blendStops(S, cs);
  const par = drag.on ? 0 : 1;
  placeCamera(cs, camera, pointer.sx * 2.2 * par + Math.sin(t * 0.21) * 0.6, pointer.sy * 1.2 * par + Math.sin(t * 0.33) * 0.25);
  scene.environmentRotation.y = cs.yaw * D2R;
  for (const m of envMats) m.envMapRotation.y = cs.yaw * D2R;

  // ── Bottle physics
  const held = drag.on;
  const rollT = held ? clamp(-drag.dx * 0.0062, -2.05, 2.05) : phys.demo - pointer.sx * 0.05 * (S < 0.5 ? 1 : 0);
  const pitchT = held && !drag.touch ? clamp(drag.dy * 0.0045, -0.85, 0.85) : 0;
  const K = held ? 70 : 34, C = held ? 13 : 5.2;
  phys.rollV += (K * (rollT - phys.roll) - C * phys.rollV) * dt; phys.roll += phys.rollV * dt;
  phys.pitchV += (K * (pitchT - phys.pitch) - C * phys.pitchV) * dt; phys.pitch += phys.pitchV * dt;
  phys.yawV *= Math.exp(-(held ? 6 : 1.6) * dt);
  phys.yaw += phys.yawV * dt;
  const idleYaw = Math.sin(t * 0.23) * 0.06;
  const tilt = Math.max(Math.abs(Math.sin(phys.roll)), Math.abs(Math.sin(phys.pitch)));
  const liftT = held ? 0.26 + 0.34 * tilt : Math.max(0, 0.34 * tilt - 0.02);
  phys.liftV += (46 * (liftT - phys.lift) - 10 * phys.liftV) * dt; phys.lift += phys.liftV * dt;
  if (phys.lift < 0) { if (phys.liftV < -0.6) { bottle.state.wobV.x += phys.liftV * 0.6 * (Math.random() - 0.5); bottle.state.wobV.y += phys.liftV * 0.8; } phys.lift = 0; phys.liftV = -phys.liftV * 0.18; }
  // Tilt axes follow the camera: horizontal drag = lean left/right on screen; vertical = toward/away.
  const fwdFlat = v1.set(-Math.sin(cs.yaw * D2R), 0, -Math.cos(cs.yaw * D2R));
  const rightFlat = v2.set(Math.cos(cs.yaw * D2R), 0, -Math.sin(cs.yaw * D2R));
  qA.setFromAxisAngle(fwdFlat, -phys.roll);
  qB.setFromAxisAngle(rightFlat, phys.pitch);
  qC.setFromAxisAngle(v3.set(0, 1, 0), phys.yaw + idleYaw);
  bottle.pivot.quaternion.copy(qA).multiply(qB).multiply(qC);
  bottle.root.position.y = phys.lift;

  // ── Notes: arrive with scroll, dissolve on a timer once you have read about them
  let absorb = 0, noteFill = 0;
  for (const n of notes) {
    if (!n.mesh) continue;
    const k = n.stop;
    n.arrive = smooth(k - 0.62, k - 0.06, S);
    const want = S > k + 0.14 ? P_END : 0;
    const rate = want > n.P ? P_END / 3.6 : P_END / 1.8;
    n.P = want > n.P ? Math.min(want, n.P + rate * dt) : Math.max(want, n.P - rate * dt);
    const e = 1 - Math.pow(1 - n.arrive, 3);
    n.group.position.lerpVectors(n.from, n.rest, e);
    const calm = 1 - clamp(n.P * 2);
    n.group.position.y += Math.sin(t * 0.9 + n.i * 2) * 0.035 * calm;
    n.group.rotation.set(Math.sin(t * 0.5 + n.i) * 0.05 * calm, (1 - e) * n.side * -1.6 + Math.sin(t * 0.35 + n.i) * 0.2 * calm, (1 - e) * 0.4 * (n.i % 2 ? 1 : -1));
    const sc = 0.55 + 0.45 * e;
    n.group.scale.setScalar(sc);
    n.U.uBurn.value = n.P > 0 ? Math.min(n.P, 1) * BURN_A - BURN_B : -1;
    n.group.visible = n.arrive > 0.001 && n.P < 1.0;
    const su = n.stream.uniforms;
    su.uP.value = n.P;
    n.stream.points.visible = n.P > 0.001 && n.P < P_END;
    const arrived = clamp((n.P - 0.45) / (P_END - 0.45));
    noteFill += arrived;
    absorb += n.P > 0.3 && n.P < P_END ? Math.sin(clamp((n.P - 0.3) / (P_END - 0.3)) * Math.PI) : 0;
  }
  intro.stream.uniforms.uP.value = intro.P;
  intro.stream.points.visible = intro.P > 0.001 && intro.P < P_END;
  introFill = FILL0 * clamp((intro.P - 0.42) / (P_END - 0.42 - 0.05));
  absorb += intro.P > 0.3 && intro.P < P_END ? Math.sin(clamp((intro.P - 0.3) / (P_END - 0.3)) * Math.PI) * 0.8 : 0;
  bottle.state.fill = introFill + noteFill * FILL_STEP;
  bottle.U.uAbsorb.value = damp(bottle.U.uAbsorb.value, Math.min(absorb, 1.2), 4, dt);
  bottle.GU.uBaseGlow.value.setRGB(0.9, 0.36, 0.05).multiplyScalar(0.3 * clamp(bottle.state.fill * 4) * (1 + bottle.U.uAbsorb.value * 0.6));

  bottle.solve(dt);
  bottle.U.uTime.value = t;
  bottle.body.updateWorldMatrix(true, true);

  // Streams need the flacon's pose.
  bottle.root.getWorldPosition(bottleWorld);
  const axisC = v4.set(0, 1.25 + phys.lift, 0).add(bottleWorld);
  for (const st of [intro.stream, ...notes.map(n => n.stream)]) {
    if (!st || !st.points.visible) continue;
    const u = st.uniforms;
    u.uTime.value = t;
    u.uBottleM.value.copy(bottle.body.matrixWorld);
    u.uSurf.value.copy(bottle.state.surf);
    u.uAxisC.value.copy(axisC);
  }
  for (const n of notes) if (n.mesh && n.stream.points.visible) n.stream.uniforms.uNoteM.value.copy(n.mesh.matrixWorld);

  // Note lighting follows whichever note is on stage.
  let best = null, bw = 0;
  for (const n of notes) { if (!n.mesh || !n.group.visible) continue; const w = n.arrive * (1 - clamp(n.P)); if (w > bw) { bw = w; best = n; } }
  if (best) {
    const p = best.group.position;
    noteKey.position.copy(p).addScaledVector(best.camRight, -best.side * 1.2).add(v1.set(0, 2.6, 0)).addScaledVector(best.camFwd, -1.8);
    noteKey.target.position.copy(p);
    noteRim.position.copy(p).addScaledVector(best.camRight, best.side * 1.6).add(v1.set(0, 1.4, 0)).addScaledVector(best.camFwd, 2.2);
    noteRim.target.position.copy(p);
  }
  noteKey.intensity = damp(noteKey.intensity, 34 * bw, 6, dt);
  noteRim.intensity = damp(noteRim.intensity, 40 * bw, 6, dt);

  // ── Floor: contact, caustic pool projected from the key light through the liquid
  const fu = floor.U;
  fu.uTime.value = t;
  fu.uBase.value.set(bottleWorld.x, phys.lift, bottleWorld.z);
  fu.uYaw.value.set(Math.cos(phys.yaw), Math.sin(phys.yaw));
  const cen = bottle.state.centroid;
  const L = v1.copy(cen).sub(KEY_POS);
  const hit = v2.copy(cen).addScaledVector(L, cen.y / Math.max(-L.y, 0.2));
  const dir = v3.set(L.x, 0, L.z).normalize();
  fu.uCauC.value.copy(bottleWorld).setY(0).addScaledVector(dir, 0.12).lerp(v2.set(hit.x, 0, hit.z), 0.35);
  fu.uCauDir.value.set(dir.x, dir.z);
  fu.uCauLen.value = 1.05 + tilt * 0.25 + Math.min(phys.lift, 0.3) * 0.5;
  const fillVis = clamp(bottle.state.fill * 2.2);
  fu.uCauI.value = fillVis * (0.85 + bottle.U.uAbsorb.value * 0.5) * (1 - clamp(phys.lift * 1.6) * 0.75);
  fu.uWob.value = bottle.state.energy;
  fu.uPool.value.set(0, 0, 0);

  // Glow plane sits behind the flacon, facing the camera.
  v1.copy(camera.position).sub(cs.look).setY(0).normalize();
  glow.mesh.position.set(-v1.x * 5.5, 1.1, -v1.z * 5.5);
  glow.mesh.lookAt(camera.position.x, 1.1, camera.position.z);
  glow.m.uniforms.uI.value = 0.1 + bottle.U.uAbsorb.value * 0.04;

  // Title: only in the hero.
  if (title.mat) {
    const tv = heroIn.v * (1 - smooth(0.02, 0.4, S));
    title.mat.color.setScalar(tv * 0.6);
    title.mesh.visible = tv > 0.002;
    title.mesh.position.y = 0.98 + S * 0.6;
    // Fit the word to the visible width at its depth (portrait screens).
    const dz = camera.position.distanceTo(title.mesh.position);
    const visW = 2 * dz * Math.tan(camera.fov * D2R / 2) * camera.aspect;
    title.mesh.scale.setScalar(Math.min(1, visW * 0.94 / 7.4));
  }
  dust.uniforms.uTime.value = t;

  // ── Screen-space box for grabbing the flacon
  box.set(v1.set(-0.6, 0, -0.4), v2.set(0.6, 1.95, 0.4));
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < 8; i++) {
    corners[i].set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).add(bottleWorld).project(camera);
    const sx = (corners[i].x + 1) / 2 * innerWidth, sy = (1 - corners[i].y) / 2 * innerHeight;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  const padX = (x1 - x0) * 0.12;
  Object.assign(bottleRect, { x0: x0 - padX, x1: x1 + padX, y0: y0 - 10, y1: y1 + 10 });
  if (drag.on) setCursor('drag', 'Tilt');
  else if (overBottle) setCursor('drag', 'Drag');
  else if (cursorState === 'dragDrag' || cursorState === 'dragTilt') setCursor('', '');

  // ── HTML
  for (let i = 0; i < cards.length; i++) {
    const k = i + 1;
    const vis = smooth(k - 0.42, k - 0.04, S) * (1 - smooth(k + 0.42, k + 0.6, S));
    cards[i].style.opacity = vis.toFixed(3);
    cards[i].style.transform = `translate3d(0, ${((1 - vis) * (S < k ? 30 : -30)).toFixed(1)}px, 0)`;
  }
  const hv = 1 - smooth(0.05, 0.3, S);
  for (const el of heroEls) el.style.opacity = (hv * heroIn.v).toFixed(3);
  const lvl = bottle.state.fill;
  gaugeFill.style.setProperty('--fill', clamp(lvl).toFixed(4));
  gaugeV.textContent = Math.round(clamp(lvl) * 100);
  for (let i = 0; i < gaugeTicks.length; i++) gaugeTicks[i].classList.toggle('on', notes[i].P > P_END * 0.7);

  // ── Offscreen passes
  if (!Q.has('norefl')) reflection.update(scene, camera);
  bgCam.position.copy(camera.position); bgCam.quaternion.copy(camera.quaternion);
  bgCam.projectionMatrix.copy(camera.projectionMatrix); bgCam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
  bgCam.updateMatrixWorld();
  // (not before the first main frames: shadow maps don't exist yet and an empty shadow sampler would be bound)
  if ((frameN = frameN + 1) > 3) {
    const prevRT = renderer.getRenderTarget(), prevAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(bgRT); renderer.clear(); renderer.render(scene, bgCam);
    renderer.setRenderTarget(prevRT); renderer.shadowMap.autoUpdate = prevAuto;
  }
  bottle.U.uMainVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

  engine.paused = footEl.getBoundingClientRect().top < -innerHeight * 0.3;
}

// ─── Shop ──────────────────────────────────────────────────────────────────────
let bagN = 0, toastT;
document.querySelectorAll('.add').forEach(b => b.addEventListener('click', () => {
  bagN++;
  document.querySelector('.bag-n').textContent = bagN;
  toastEl.textContent = `${b.dataset.item} — added. Poured and shipped from Grasse within 48 h.`;
  toastEl.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 3200);
}));

// ─── Boot ─────────────────────────────────────────────────────────────────────
worldNav('nocturne', { theme: 'dark', corner: 'bl' });
magnetic();
smoothScroll({ lerp: 0.08 });
reveal('.house h2, .shop h2', { type: 'lines', stagger: 0.1 });
reveal('.lede', { type: 'lines', stagger: 0.05, y: '100%' });

await fontsReady;
bottle = createBottle({ renderer });
scene.add(bottle.root);
for (const m of [bottle.glassMesh, bottle.backMesh, bottle.liqMesh]) useEnv(m, ENV_GLASS);
useEnv(bottle.root);
bottle.U.uBg.value = bgRT.texture;
makeTitle();
await Promise.all([...noteLoads, capLoad]);
if (capModel) {
  capModel.position.y += DIM.neckTop - 0.085;
  bottle.setCap(capModel);
}

// Sample every note into a stream (in mesh-local space, keyed by the same burn function the shader uses).
function buildStreams() {
  measure();
  for (const n of notes) {
    if (!n.mesh) continue;
    notePose(n, n);
    n.side = STOPS[n.stop].note.side;
    n.group.position.copy(n.rest); n.group.rotation.set(0, 0, 0); n.group.scale.setScalar(1);
    n.group.updateMatrixWorld(true);
  }
}
buildStreams();
const invM = new THREE.Matrix4(), nm = new THREE.Matrix3();
for (const n of notes) {
  if (!n.mesh) continue;
  const COUNT = 15000;
  const smp = sampleSurface(n.mesh, COUNT);
  invM.copy(n.mesh.matrixWorld).invert();
  nm.getNormalMatrix(invM);
  const local = new Float32Array(COUNT * 3), normal = new Float32Array(COUNT * 3), keyA = new Float32Array(COUNT);
  // Direction toward the flacon, in mesh space: the side facing the bottle burns first.
  const toB = v1.set(0, 0.8, 0).sub(n.rest).transformDirection(invM).normalize();
  let mn = 1e9, mx = -1e9;
  for (let i = 0; i < COUNT; i++) {
    v2.fromArray(smp.position, i * 3).applyMatrix4(invM);
    local.set([v2.x, v2.y, v2.z], i * 3);
    v3.fromArray(smp.normal, i * 3).applyMatrix3(nm).normalize();
    normal.set([v3.x, v3.y, v3.z], i * 3);
    const d = v2.dot(toB); mn = Math.min(mn, d); mx = Math.max(mx, d);
  }
  const freq = 2.4;
  for (let i = 0; i < COUNT; i++) keyA[i] = burnKey(local[i * 3], local[i * 3 + 1], local[i * 3 + 2], toB, [mn, mx], freq);
  n.stream = createStream({ local, normal, color: smp.color, key: keyA }, { size: 20 });
  n.stream.uniforms.uSpin.value = n.side * 0.6;
  n.stream.points.visible = false;
  n.stream.points.layers.enable(1);
  scene.add(n.stream.points);
  burnMaterial(n, toB.clone(), [mn, mx], freq);
  engine.onResize((w, h, dpr) => { n.stream.uniforms.uDpr.value = dpr * h / 900; });
}
intro.stream = createStream(introCloud(12000), { size: 20 });
intro.stream.points.visible = false;
scene.add(intro.stream.points);
engine.onResize((w, h, dpr) => { intro.stream.uniforms.uDpr.value = dpr * h / 900; });
addEventListener('resize', () => buildStreams());

engine.onTick(tick);
// Warm every program: show everything once, compile, hide again.
for (const n of notes) { if (n.mesh) { n.group.visible = true; n.stream.points.visible = true; } }
intro.stream.points.visible = true;
bottle.state.fill = 0.5;
renderer.compile(scene, camera);
engine.start();
await loader.finish();
if (cursorState === '') cur?.set('');

// Intro: an empty flacon; gold gathers from the dark and pours itself in. Then a nudge that says "you can tilt this".
if (Q.has('skip')) { heroIn.v = 1; intro.P = P_END; } else {
  gsap.to(heroIn, { v: 1, duration: 2.6, ease: 'power2.inOut', delay: 0.3 });
  gsap.to(intro, { P: P_END, duration: 4.4, ease: 'power1.inOut', delay: 0.1 });
}
gsap.from('.nav', { opacity: 0, y: -10, duration: 1.4, ease: 'power3.out', delay: 1.2 });
if (!Q.has('still')) gsap.timeline({ delay: 4.6 }).to(phys, { demo: 0.32, duration: 0.7, ease: 'power2.inOut' }).to(phys, { demo: -0.2, duration: 0.8, ease: 'power2.inOut' }).to(phys, { demo: 0, duration: 0.9, ease: 'power2.inOut' });

const scrollForS = v => { const k = Math.min(Math.floor(v), anchors.length - 1), f = v - k; const a = anchors[k], b = anchors[k + 1] ?? a; return a + (b - a) * f; };
window.__noct = { studioEnvironment, renderer, ENV, ENV_GLASS, envMats, key, fill, noteKey, noteRim, go: v => window.__lenis.scrollTo(scrollForS(v), { immediate: true }), anchors: () => anchors, S: () => S, notes, bottle, phys, drag, intro, scene, engine, floor, glow, title, reflection, bgRT, THREE };
