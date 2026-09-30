import { Engine, THREE, normalize, damp, clamp, smooth, lerp } from '../../src/core/engine.js';
import { Assets, firstMesh } from '../../src/core/assets.js';
import { Pointer } from '../../src/core/input.js';
import { smoothScroll, gsap, reveal, SplitText } from '../../src/core/scroll.js';
import { preloader, cursor, magnetic, worldNav } from '../../src/core/ui.js';
import { bakeTexture } from '../../src/core/textures.js';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { sampleMesh, packShape, spiralShape, anchorOf } from './shapes.js';
import { VELOCITY, POSITION, CORE_VERT, CORE_FRAG, GLOW_VERT, GLOW_FRAG, MOTE_VERT, MOTE_FRAG, PAPER_VERT, PAPER_FRAG } from './shaders.js';

const Q = new URLSearchParams(location.search);
const MOBILE = matchMedia('(max-width: 760px)').matches;
const COARSE = matchMedia('(pointer: coarse)').matches;
const SIZE = +(Q.get('size') ?? (MOBILE || COARSE ? 320 : 448));
const N = SIZE * SIZE;
const FOV = 30;

// paper, toned edge, light pool — one set per plate (display colours; the paper shader inverts the tone mapper)
const PALETTES = [
  ['#f4efe6', '#e6dac8', '#f8f3ea'], // rose: cream
  ['#f5ebe3', '#e7d4c7', '#f9f2ec'], // protea: blush
  ['#e9e7df', '#d4d1c4', '#f1efe8'], // orchid: pearl — a little darker so white petals can shine
  ['#ebedea', '#d6dad3', '#f3f4f0'], // morpho: river mist
  ['#f2ebdf', '#e2d4bf', '#f7f1e7'], // archive: old stock
].map(p => p.map(h => new THREE.Color(h)));

// ─── Engine ─────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gl');
const engine = new Engine({
  canvas, fov: FOV, near: 0.05, far: 80, dpr: MOBILE ? 2 : 1.75, background: 0xf4efe6, shadows: false,
  post: {
    ao: false,
    bloom: { intensity: 0.8, luminanceThreshold: 2.3, luminanceSmoothing: 0.5, radius: 0.65 }, // above the paper (≈1.1–1.5 pre-tone): only glints bloom
    tone: 'neutral', vignette: false, noise: 0.042, ca: false, smaa: false,
  },
});
const { scene, camera, renderer } = engine;

// ─── Loader: a sunflower head that fills floret by floret ───────────────────
const assets = new Assets();
const loaderEl = document.querySelector('.loader');
const seedCv = loaderEl.querySelector('.loader-seed');
const seedCx = seedCv.getContext('2d');
{
  const s = 200 * Math.min(2, devicePixelRatio || 1);
  seedCv.width = seedCv.height = s; seedCx.scale(s / 200, s / 200);
}
const GA = Math.PI * (3 - Math.sqrt(5));
const FLORETS = 460;
let florets = 0;
function drawFlorets(n) {
  while (florets < n) {
    const i = florets++, f = i / FLORETS;
    const r = 4.3 * Math.sqrt(i + 0.5), a = i * GA;
    const x = 100 + Math.cos(a) * r, y = 100 + Math.sin(a) * r;
    seedCx.fillStyle = f < 0.2 ? `rgba(150,140,62,${0.9 - f})` : `rgba(${Math.round(lerp(168, 214, f))},${Math.round(lerp(40, 69, f))},${Math.round(lerp(75, 107, f))},${0.55 + f * 0.4})`;
    seedCx.beginPath(); seedCx.arc(x, y, 1.1 + f * 1.9, 0, Math.PI * 2); seedCx.fill();
  }
}
let procP = 0;
const progress = { get progress() { return assets.progress * 0.8 + procP * 0.2; } };
const pctEl = loaderEl.querySelector('.loader-pct');
const loader = preloader({
  assets: progress, el: loaderEl, minTime: 1400,
  onValue: v => { drawFlorets(Math.floor(v * FLORETS)); pctEl.textContent = String(Math.round(v * 100)).padStart(2, '0'); },
  exit: () => gsap.timeline()
    .to(seedCv, { scale: 1.6, rotation: 40, opacity: 0, duration: 1.1, ease: 'power3.in' })
    .to(loaderEl.querySelectorAll('p'), { opacity: 0, y: -8, duration: 0.5, stagger: 0.05 }, 0)
    .to(loaderEl, { autoAlpha: 0, duration: 0.9, ease: 'power2.inOut' }, 0.55),
});

// ─── Paper ──────────────────────────────────────────────────────────────────
const grain = bakeTexture(renderer, 512, `
  void main(){
    float a = fbm(vUv * 6.0, 6.0, 6, 0.55) * 0.5 + 0.5;
    float b = fbm(vUv * 48.0, 48.0, 3, 0.5) * 0.5 + 0.5;
    gl_FragColor = vec4(a, b, 0.0, 1.0);
  }`);
const paperU = {
  uPaper: { value: PALETTES[0][0].clone() }, uEdge: { value: PALETTES[0][1].clone() }, uGlowC: { value: PALETTES[0][2].clone() },
  uGlowP: { value: new THREE.Vector2(0.65, 0.5) }, uAspect: { value: 1.6 }, uGlow: { value: 1 }, tGrain: { value: grain },
};
const paper = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: paperU, vertexShader: PAPER_VERT, fragmentShader: PAPER_FRAG, depthTest: false, depthWrite: false,
}));
paper.frustumCulled = false; paper.renderOrder = -10;
scene.add(paper);

// ─── Specimens ──────────────────────────────────────────────────────────────
const SPECS = [
  { key: 'rose', file: 'models/florae/rose.glb', size: 2.4, axis: 'y', heart: 'top' },
  { key: 'protea', file: 'models/florae/protea.glb', size: 2.55, axis: 'y', heart: 'top' },
  { key: 'orchid', file: 'models/florae/orchid.glb', size: 2.6, axis: 'max', heart: 'bottom' },
  { key: 'morpho', file: 'models/florae/morpho.glb', size: 2.6, axis: 'max', heart: 'center' },
];
const yieldFrame = () => new Promise(r => setTimeout(r, 0));
async function buildShapes() {
  const tl = performance.now();
  const glbs = await Promise.all(SPECS.map(s => assets.gltf(s.file)));
  const raws = [], packs = [];
  const t0 = performance.now();
  console.info(`[florae] models loaded in ${Math.round(t0 - tl)} ms`);
  for (let i = 0; i < SPECS.length; i++) {
    const s = SPECS[i], root = glbs[i].scene;
    normalize(root, s.size, { ground: false, axis: s.axis });
    root.updateMatrixWorld(true);
    const ta = performance.now();
    const raw = sampleMesh(firstMesh(root), N);
    raws.push(raw);
    procP = (i + 0.5) / 5; await yieldFrame();
    const tb = performance.now();
    packs.push(packShape(raw, SIZE, { heart: s.heart }));
    console.info(`[florae] ${s.key}: sample ${Math.round(tb - ta)} ms, pack+AO ${Math.round(performance.now() - tb)} ms`);
    procP = (i + 1) / 5; await yieldFrame();
  }
  packs.push(packShape(spiralShape(SIZE, raws), SIZE, { heart: 'center' }));
  procP = 1;
  console.info(`[florae] ${N} particles × 5 shapes in ${Math.round(performance.now() - t0)} ms`);
  return packs;
}

// ─── Simulation ─────────────────────────────────────────────────────────────
const U = {
  tA: { value: null }, tB: { value: null }, tNA: { value: null }, tNB: { value: null },
  uF: { value: 0 }, uFlapA: { value: 0 }, uFlapB: { value: 0 }, uBloom: { value: 0 }, uTime: { value: 0 }, uStagger: { value: 0.55 },
  uDisc: { value: new THREE.Matrix3() },
};
const SIMU = {
  ...U, uDt: { value: 1 / 60 }, uStiff: { value: 50 }, uBreeze: { value: 0 }, uBreezeR: { value: 0.4 }, uCharge: { value: 0 }, uScrollV: { value: 0 },
  uRayO: { value: new THREE.Vector3(0, 0, 50) }, uRayD: { value: new THREE.Vector3(0, 0, -1) }, uRayV: { value: new THREE.Vector3() },
  uGustD: { value: new THREE.Vector3(0, 0, -1) }, uGust: { value: new THREE.Vector4() },
};
const gpu = new GPUComputationRenderer(SIZE, SIZE, renderer);
const pos0 = gpu.createTexture(), vel0 = gpu.createTexture();
{
  const d = pos0.image.data;
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 2.2 + Math.pow(Math.random(), 0.6) * 5;
    const s = Math.sqrt(1 - u * u);
    d[i * 4] = Math.cos(a) * s * r; d[i * 4 + 1] = u * r * 0.7 - 0.6; d[i * 4 + 2] = Math.sin(a) * s * r; d[i * 4 + 3] = 1;
  }
}
const posVar = gpu.addVariable('texturePosition', POSITION, pos0);
const velVar = gpu.addVariable('textureVelocity', VELOCITY, vel0);
gpu.setVariableDependencies(posVar, [posVar, velVar]);
gpu.setVariableDependencies(velVar, [posVar, velVar]);
Object.assign(velVar.material.uniforms, SIMU);
posVar.material.uniforms.uDt = SIMU.uDt;
{ const err = gpu.init(); if (err) console.error(err); }

// ─── Particles: opaque pointillist cores + a soft glow / bokeh pass ─────────
const R = {
  ...U,
  tPos: { value: null }, tCA: { value: null }, tCB: { value: null },
  uDot: { value: MOBILE ? 0.0085 : 0.0068 }, uScale: { value: 1000 }, uFocus: { value: 5 }, uAperture: { value: 0.05 }, uCoreCut: { value: 3.2 },
  uCharge: SIMU.uCharge, uGlowFrac: { value: MOBILE || COARSE ? 0.7 : 1.0 }, uGlowA: { value: 0.3 }, uIrid: { value: 2.6 }, uPetal: { value: 0.02 }, uLift: { value: 0.1 },
  uSize: { value: SIZE },
  uL: { value: new THREE.Vector3(-0.5, 0.62, 0.6).normalize() },
  uKey: { value: new THREE.Color(1.22, 1.12, 1.02) }, uAmb: { value: new THREE.Color(0.28, 0.27, 0.31) },
};
const geo = new THREE.BufferGeometry();
{
  const ref = new Float32Array(N * 2), perm = new Uint32Array(N);
  for (let i = 0; i < N; i++) perm[i] = i;
  for (let i = N - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let j = 0; j < N; j++) { const i = perm[j]; ref[j * 2] = ((i % SIZE) + 0.5) / SIZE; ref[j * 2 + 1] = (Math.floor(i / SIZE) + 0.5) / SIZE; }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('ref', new THREE.BufferAttribute(ref, 2));
}
const flower = new THREE.Group();
scene.add(flower);
const cores = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: R, vertexShader: CORE_VERT, fragmentShader: CORE_FRAG }));
const glows = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: R, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false }));
cores.frustumCulled = glows.frustumCulled = false;
glows.renderOrder = 2;
flower.add(cores, glows);
if (Q.has('noflower')) flower.visible = false;

// The specimen's shadow on the paper: its silhouette at low resolution, disc-blurred by the paper shader.
const SHADOW = !MOBILE && !Q.has('noshadow');
const SH_DIV = 5;
const shadowRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType, depthBuffer: false });
const shadowScene = new THREE.Scene();
const shadowU = { ...R, uScale: { value: 100 }, uCoreCut: { value: 1e6 }, uPetal: { value: 0 } };
const shadowPts = new THREE.Points(geo, new THREE.ShaderMaterial({
  uniforms: shadowU, vertexShader: CORE_VERT, depthTest: false, depthWrite: false,
  fragmentShader: 'void main(){ vec2 c = gl_PointCoord * 2.0 - 1.0; if (dot(c, c) > 1.0) discard; gl_FragColor = vec4(1.0); }',
}));
shadowPts.frustumCulled = false; shadowPts.matrixAutoUpdate = false;
shadowScene.add(shadowPts);
paperU.tShadow = { value: shadowRT.texture };
paperU.uShadow = { value: SHADOW ? 1 : 0 };
paperU.uShadowOff = { value: new THREE.Vector2(0.012, -0.022) };
paperU.uTexel = { value: new THREE.Vector2(1 / 288, 1 / 180) };

// Pollen, seed fluff: pure depth of field
const moteU = { uTime: U.uTime, uScale: R.uScale, uFocus: R.uFocus, uAperture: R.uAperture, uGustE: { value: 0 }, uGustC: { value: new THREE.Vector3() } };
{
  const M = MOBILE ? 700 : 1800;
  const p = new Float32Array(M * 3), s = new Float32Array(M * 4);
  for (let i = 0; i < M; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 1.6 + Math.random() * 8.5, q = Math.sqrt(1 - u * u);
    p[i * 3] = Math.cos(a) * q * r * 1.3; p[i * 3 + 1] = u * r * 0.8; p[i * 3 + 2] = Math.sin(a) * q * r;
    for (let k = 0; k < 4; k++) s[i * 4 + k] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(s, 4));
  const motes = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: moteU, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, transparent: true, depthWrite: false }));
  motes.frustumCulled = false; motes.renderOrder = 3;
  if (!Q.has('nomotes')) scene.add(motes);
}

engine.onResize((w, h, dpr) => {
  R.uScale.value = h * dpr / (2 * Math.tan(FOV * Math.PI / 360));
  const sw = Math.max(4, Math.round(w / SH_DIV)), sh = Math.max(4, Math.round(h / SH_DIV));
  shadowRT.setSize(sw, sh);
  shadowU.uScale.value = sh / (2 * Math.tan(FOV * Math.PI / 360)) * 1.5;
  paperU.uTexel.value.set(1 / sw, 1 / sh);
  paperU.uAspect.value = w / h;
});

// ─── Scroll choreography ────────────────────────────────────────────────────
// Each keyframe is a full scene state; the page's sections pin them to scroll positions.
const D = Math.PI / 180;
const S = o => ({ m: 0, dist: 5.6, elev: 0.1, azim: 0, ty: 0.2, sx: 0.3, sy: 0, yaw: 0, pal: 0, ap: 0.05, spin: 1, rot: 0, glow: 1, ...o });
const ST = {
  hero: S({ m: 0, dist: 5.7, elev: 7 * D, ty: 0.06, sx: 0.3, sy: 0.02, yaw: -20 * D, ap: 0.05 }),
  atelier: S({ m: 0, dist: 4.4, elev: 24 * D, ty: 0.45, sx: -0.36, sy: 0.02, yaw: 40 * D, ap: 0.06 }),
  rose: S({ m: 0, dist: 4.8, elev: 32 * D, ty: 0.45, sx: 0.26, sy: -0.04, yaw: 95 * D, ap: 0.07 }),
  protea: S({ m: 1, dist: 5.5, elev: -2 * D, ty: 0.28, sx: -0.36, sy: -0.02, yaw: 150 * D, pal: 1, ap: 0.055 }),
  orchid: S({ m: 2, dist: 6.3, elev: 8 * D, ty: 0.12, sx: 0.28, sy: -0.03, yaw: 0, pal: 2, ap: 0.055 }),
  morpho: S({ m: 3, dist: 6.1, elev: 16 * D, ty: 0, sx: -0.34, sy: 0.02, yaw: -24 * D, pal: 3, ap: 0.06, spin: 0.5 }),
  archive: S({ m: 4, dist: 10.2, elev: 68 * D, ty: -0.2, sx: 0.52, sy: 0.0, yaw: 0, pal: 4, ap: 0.07, spin: 0, rot: 0.06 }),
  subscribe: S({ m: 5, dist: 6.6, elev: 12 * D, ty: 0.1, sx: 0.54, sy: 0.0, yaw: 200 * D, pal: 0, ap: 0.05 }),
  foot: S({ m: 5, dist: 5.9, elev: 14 * D, ty: 0.2, sx: 0.46, sy: -0.04, yaw: 250 * D, pal: 0, ap: 0.05 }),
};
// Phones: the specimen takes the top of the screen, type sits below it.
const MOB = { hero: [1.75, 0.36], atelier: [1.6, 0.38], rose: [1.8, 0.32], protea: [1.6, 0.3], orchid: [1.65, 0.3], morpho: [2.1, 0.33], archive: [1.45, 0.4], subscribe: [1.9, 0.42], foot: [2.9, 0.68] };
if (MOBILE) for (const k in ST) Object.assign(ST[k], { sx: 0, sy: MOB[k][1], dist: ST[k].dist * MOB[k][0] });
const KEYS_NUM = Object.keys(ST.hero);
let KEYS = [];
function layoutKeys() {
  const vh = innerHeight, top = el => el.getBoundingClientRect().top + scrollY;
  const specs = [...document.querySelectorAll('.spec')];
  const at = document.querySelector('.atelier'), ar = document.querySelector('.archive'), su = document.querySelector('.subscribe'), fo = document.querySelector('.foot');
  const order = [ST.rose, ST.protea, ST.orchid, ST.morpho];
  const K = [[0, ST.hero], [top(at) + vh * 0.05, ST.atelier], [top(specs[0]), ST.rose]];
  for (let k = 1; k < 4; k++) {
    const t = top(specs[k]), span = specs[k].offsetHeight - vh;
    K.push([t - vh * 0.6, order[k - 1]], [t + span * 0.38, order[k]]);
  }
  K.push([top(ar) - vh * 0.85, ST.morpho], [top(ar) + vh * 0.15, ST.archive]);
  K.push([top(su) - vh * 0.55, ST.archive], [top(su) + vh * 0.25, ST.subscribe]);
  K.push([top(fo) - vh * 0.3, ST.subscribe], [document.documentElement.scrollHeight - vh, ST.foot]);
  KEYS = K.sort((a, b) => a[0] - b[0]);
  specY = specs.map(s => [top(s), s.offsetHeight]);
  subY = top(su);
}
let specY = [], subY = 1e9, hintReady = false;
const target = S({}), cur = S({});
function sampleKeys(y, out) {
  let i = 0;
  while (i < KEYS.length - 2 && y > KEYS[i + 1][0]) i++;
  const [y0, a] = KEYS[i], [y1, b] = KEYS[i + 1];
  const f = clamp((y - y0) / Math.max(1, y1 - y0));
  const e = f * f * (3 - 2 * f);
  // during a morph the specimen changes sides early, so the swirl never passes under the pinned plate
  const es = a.m !== b.m ? smooth(0.0, 0.34, f) : e;
  for (const k of KEYS_NUM) out[k] = lerp(a[k], b[k], k === 'm' ? f : (k === 'sx' || k === 'sy') ? es : e);
  return out;
}

// ─── Interaction: breeze, gust, storm ───────────────────────────────────────
const pointer = new Pointer({ lambda: 9 });
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const invM = new THREE.Matrix4();
const rayO = new THREE.Vector3(), rayD = new THREE.Vector3(), rayP = new THREE.Vector3(), rayPrev = new THREE.Vector3(), rayV = new THREE.Vector3();
let lastMove = -10, breeze = 0, rayInit = false;
const hintEl = document.querySelector('.hint');
if (COARSE) { hintEl.children[0].remove(); hintEl.querySelector('i').textContent = 'Tap'; }
const hintSpans = hintEl.querySelectorAll('span');
const litIdx = COARSE ? [-1, 0, 1] : [0, 1, 2];
const litHint = j => { const i = litIdx[j]; if (i < 0) return; hintSpans[i].classList.add('lit'); clearTimeout(hintSpans[i]._t); hintSpans[i]._t = setTimeout(() => hintSpans[i].classList.remove('lit'), 1400); };
pointer.on('move', () => { lastMove = engine.time; });

const bloom = { v: 0 };
const gustS = { w: 0 };
const shake = { v: 0 };
let charge = 0, pressing = false, pressT = 0, started = false;
const chargeEl = document.querySelector('.charge'), chargeFg = chargeEl.querySelector('.charge-fg');
const isUI = t => t.closest?.('a, button, input, select, textarea, label, .tier, .rail, .nav, .months li');

function gust(power) {
  if (!started) return;
  // centre: the point on the pointer ray nearest the specimen's axis, nudged toward the viewer
  const t = Math.max(0.5, -rayO.dot(rayD));
  const c = rayP.copy(rayO).addScaledVector(rayD, t - 0.35);
  SIMU.uGust.value.set(c.x, c.y, c.z, 0);
  SIMU.uGustD.value.copy(rayD);
  gsap.killTweensOf(gustS);
  gsap.fromTo(gustS, { w: 9 + 13 * power }, { w: 0, duration: 0.35 + 0.12 * power, ease: 'power2.out' });
  gsap.killTweensOf(bloom);
  bloom.v = 0;
  gsap.to(bloom, { v: 1, duration: 2.4 + power * 0.6, delay: 0.5 + power * 0.4, ease: 'power1.inOut' });
  moteU.uGustC.value.copy(c).applyMatrix4(flower.matrixWorld);
  gsap.fromTo(moteU.uGustE, { value: 0.4 + power * 0.5 }, { value: 0, duration: 3.5, ease: 'power2.out' });
  gsap.fromTo(shake, { v: 0.02 + power * 0.03 }, { v: 0, duration: 0.9, ease: 'power2.out' });
  gsap.fromTo(paperU.uGlow, { value: 1.25 + power * 0.25 }, { value: 1, duration: 2.4, ease: 'power2.out' });
}
addEventListener('pointerdown', e => {
  if (e.button !== 0 || isUI(e.target)) return;
  pressing = true; pressT = engine.time;
});
addEventListener('pointerup', () => {
  if (!pressing) return;
  pressing = false;
  const p = charge;
  litHint(p > 0.25 ? 2 : 1);
  gust(1 + p * 2.2);
  gsap.to({ c: charge }, { c: 0, duration: 0.25, onUpdate() { charge = this.targets()[0].c; } });
});
addEventListener('pointercancel', () => { pressing = false; charge = 0; });
addEventListener('contextmenu', e => { if (!isUI(e.target)) e.preventDefault(); });

// ─── Botanical callouts, projected from the specimen ────────────────────────
// `at`: a fixed point (bbox fractions); `band` + `pick`: the extreme particle within a height band on the
// given screen side (r / l / t), chosen when the callouts appear, so labels always sit outside the silhouette.
const NOTES = [
  [ // rose — plate on the left, labels to the right
    { at: [0.5, 0.96, 0.5], n: 'i.', h: 'The heart', d: 'forty-two petals, still furled', dx: 250, dy: -120 },
    { band: [0.6, 0.86], pick: 'r', n: 'ii.', h: 'Guard petals', d: 'reflexed, velvet to the touch', dx: 110, dy: 16 },
    { band: [0.12, 0.45], pick: 'r', n: 'iii.', h: 'Compound leaf', d: 'five leaflets, finely serrate', dx: 100, dy: 24 },
  ],
  [ // protea — plate on the right, labels to the left
    { band: [0.86, 1.0], pick: 't', n: 'i.', h: 'The florets', d: 'two hundred, packed in one cone', dx: -150, dy: -46 },
    { band: [0.62, 0.84], pick: 'l', n: 'ii.', h: 'Involucral bracts', d: 'pink, with silver hairs', dx: -150, dy: -20 },
    { band: [0.3, 0.58], pick: 'l', n: 'iii.', h: 'Leathery leaves', d: 'fire-hardened, red at the rim', dx: -80, dy: 40 },
  ],
  [ // orchid — plate on the left, labels to the right
    { at: [0.7, 0.8, 1.0], n: 'i.', h: 'Dorsal sepal', d: 'white as a moth, 9 cm across', dx: 190, dy: -70 },
    { at: [0.85, 0.55, 1.0], n: 'ii.', h: 'Labellum', d: 'a landing strip for one bee', dx: 150, dy: 40 },
    { at: [0.0, 0.85, 0.5], n: 'iii.', h: 'The buds', d: 'opening in order, tip last', dx: 90, dy: -150 },
  ],
  [ // morpho — plate on the right, labels to the left
    { at: [0.15, 0.95, 1.0], n: 'i.', h: 'Forewing', d: 'structural blue — no pigment', dx: -120, dy: -60 },
    { at: [0.1, 0.12, 1.0], n: 'ii.', h: 'The margin', d: 'a border of white eyespots', dx: -110, dy: 70 },
    { at: [0.5, 0.64, 1.0], n: 'iii.', h: 'Thorax', d: 'all flight muscle', dx: -60, dy: -230 },
  ],
];
const leadersEl = document.querySelector('.leaders');
const calloutsEl = document.querySelector('.callouts');
const SVGNS = 'http://www.w3.org/2000/svg';
const callouts = NOTES.map(list => {
  const g = document.createElementNS(SVGNS, 'g');
  leadersEl.appendChild(g);
  return list.map(n => {
    const path = document.createElementNS(SVGNS, 'path'), dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('r', '3.2');
    g.append(path, dot);
    const el = document.createElement('div');
    el.className = 'callout' + (n.dx < 0 ? ' left' : '');
    el.innerHTML = `<b>${n.n}</b><span>${n.h}</span><small>${n.d}</small>`;
    calloutsEl.appendChild(el);
    return { ...n, g, path, dot, el, p: null };
  });
});
function candidates(shape, n = 1600) {
  const P = shape.P, NN = P.length / 4;
  let y0 = Infinity, y1 = -Infinity;
  for (let j = 0; j < NN; j += 5) { y0 = Math.min(y0, P[j * 4 + 1]); y1 = Math.max(y1, P[j * 4 + 1]); }
  const out = [];
  for (let i = 0; i < n; i++) { const j = (Math.random() * NN) | 0; out.push({ p: new THREE.Vector3(P[j * 4], P[j * 4 + 1], P[j * 4 + 2]), v: (P[j * 4 + 1] - y0) / (y1 - y0) }); }
  return out;
}
function pickAnchors(k, flap, only = null) {
  for (const c of callouts[k]) {
    if (!c.band || (only && c !== only)) continue;
    let best = null, bs = -Infinity;
    for (const q of cands[k]) {
      if (q.v < c.band[0] || q.v > c.band[1]) continue;
      flapJS(q.p, k === 3 ? flap : 0, tmp).applyMatrix4(flower.matrixWorld).project(camera);
      const sc = c.pick === 'r' ? tmp.x : c.pick === 'l' ? -tmp.x : tmp.y;
      if (sc > bs) { bs = sc; best = q.p; }
    }
    if (best) c.p = best;
  }
}
let cands = [];
const flapJS = (p, ang, out) => {
  if (ang <= 0) return out.copy(p);
  const hx = Math.abs(p.x) / 1.3, ht = clamp((hx - 0.02) / 0.12), a = ang * ht * ht * (3 - 2 * ht) * (0.7 + 0.3 * hx), sd = p.x < 0 ? -1 : 1, ax = Math.abs(p.x), c = Math.cos(a), s = Math.sin(a);
  return out.set(sd * (ax * c - p.z * s), p.y - (ang - 0.45) * 0.07, ax * s + p.z * c);
};

// ─── UI elements driven by the scene ────────────────────────────────────────
const plates = [...document.querySelectorAll('.plate')];
const statusEls = plates.map(p => p.querySelector('.plate-status'));
const railEl = document.querySelector('.rail'), railLinks = [...railEl.querySelectorAll('a')];
const figEl = document.querySelector('.fig');
const heroEl = document.querySelector('.hero');
const navEl = document.querySelector('.nav');
document.querySelector('.fig-n').textContent = N.toLocaleString('en-US');

// ─── Frame loop ─────────────────────────────────────────────────────────────
let SHAPES = null;
let yawOsc = 0, rotPhase = 0, scrollV = 0;
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), camTarget = new THREE.Vector3();
const discN = new THREE.Vector3(), discT = new THREE.Vector3(), discB = new THREE.Vector3();
let activePlate = -1, calloutOn = -1;

engine.onTick((dt, t) => {
  if (!SHAPES) return;
  pointer.update(dt);
  U.uTime.value = t;
  SIMU.uDt.value = Math.min(dt, 1 / 30);

  // scroll → state
  sampleKeys(scrollY, target);
  for (const k of KEYS_NUM) cur[k] = damp(cur[k], target[k], k === 'm' ? 7 : 4.2, dt);

  // camera orbit, lens-shifted so the specimen sits beside the type
  camTarget.set(0, cur.ty, 0);
  const ce = Math.cos(cur.elev), fm = cur.m - Math.floor(cur.m);
  const dist = cur.dist + Math.sin(Math.PI * fm) * 1.3; // step back to watch the swirl
  camera.position.set(Math.sin(cur.azim) * ce, Math.sin(cur.elev), Math.cos(cur.azim) * ce).multiplyScalar(dist).add(camTarget);
  camera.lookAt(camTarget);
  tmp.set(pointer.sx * 0.16 + (Math.random() - 0.5) * shake.v, pointer.sy * 0.1 + (Math.random() - 0.5) * shake.v, 0).applyQuaternion(camera.quaternion);
  camera.position.add(tmp);
  camera.lookAt(camTarget);
  camera.updateProjectionMatrix();
  camera.projectionMatrix.elements[8] = -cur.sx;
  camera.projectionMatrix.elements[9] = -cur.sy;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.updateMatrixWorld();

  rotPhase += cur.rot * dt;
  yawOsc = Math.sin(t * 0.16) * 0.32 * cur.spin;
  flower.rotation.y = cur.yaw + yawOsc + rotPhase;
  flower.updateMatrixWorld();

  // the whirl's plane tilts toward the viewer
  discN.copy(camera.position).applyMatrix4(invM.copy(flower.matrixWorld).invert()).normalize().multiplyScalar(0.75).add(tmp.set(0, 0.7, 0)).normalize();
  discT.set(1, 0, 0).addScaledVector(discN, -discN.x).normalize();
  discB.crossVectors(discT, discN);
  U.uDisc.value.set(discT.x, discN.x, discB.x, discT.y, discN.y, discB.y, discT.z, discN.z, discB.z);

  // morph: shape k → k+1
  const m = clamp(cur.m, 0, SHAPES.length - 1);
  const k = Math.min(SHAPES.length - 2, Math.floor(m)), f = m - k;
  const A = SHAPES[k], B = SHAPES[k + 1];
  U.tA.value = A.pos; U.tB.value = B.pos; U.tNA.value = A.nrm; U.tNB.value = B.nrm;
  R.tCA.value = A.col; R.tCB.value = B.col;
  U.uF.value = f;
  const flap = 0.2 + 0.62 * Math.pow(0.5 + 0.5 * Math.sin(t * 2.3), 1.4);
  U.uFlapA.value = k === 3 ? flap : 0;
  U.uFlapB.value = k + 1 === 3 ? flap : 0;
  U.uBloom.value = bloom.v;

  // lens
  R.uFocus.value = dist;
  R.uAperture.value = cur.ap;
  const pi = clamp(cur.pal, 0, PALETTES.length - 1), p0 = Math.floor(pi), p1 = Math.min(PALETTES.length - 1, p0 + 1), pf = pi - p0;
  paperU.uPaper.value.copy(PALETTES[p0][0]).lerp(PALETTES[p1][0], pf);
  paperU.uEdge.value.copy(PALETTES[p0][1]).lerp(PALETTES[p1][1], pf);
  paperU.uGlowC.value.copy(PALETTES[p0][2]).lerp(PALETTES[p1][2], pf);
  tmp.set(0, 0.35, 0).applyMatrix4(flower.matrixWorld).project(camera);
  paperU.uGlowP.value.set(tmp.x * 0.5 + 0.5, tmp.y * 0.5 + 0.5);

  // pointer ray, in the specimen's space
  ndc.set(pointer.x, pointer.y);
  ray.setFromCamera(ndc, camera);
  invM.copy(flower.matrixWorld).invert();
  rayO.copy(ray.ray.origin).applyMatrix4(invM);
  rayD.copy(ray.ray.direction).transformDirection(invM);
  tmp2.copy(rayO).addScaledVector(rayD, cur.dist);
  if (!rayInit) { rayPrev.copy(tmp2); rayInit = true; }
  rayV.subVectors(tmp2, rayPrev).divideScalar(Math.max(dt, 1e-3));
  if (rayV.length() > 10) rayV.setLength(10);
  rayPrev.copy(tmp2);
  SIMU.uRayV.value.lerp(rayV, 1 - Math.exp(-12 * dt));
  const speed = SIMU.uRayV.value.length();
  const idle = clamp(1 - (t - lastMove - 0.6) / 0.8);
  breeze = damp(breeze, pointer.active && started ? clamp(0.18 + speed * 0.32, 0, 1.5) * idle : 0, 10, dt);
  if (speed > 1.2 && started) litHint(0);
  SIMU.uBreeze.value = breeze;
  SIMU.uRayO.value.copy(rayO); SIMU.uRayD.value.copy(rayD);
  SIMU.uGust.value.w = gustS.w;

  // holding charges a storm
  if (pressing && t - pressT > 0.16) charge = Math.min(1, charge + dt / 1.5);
  SIMU.uCharge.value = charge;
  chargeEl.classList.toggle('on', pressing && t - pressT > 0.2);
  chargeEl.style.transform = `translate3d(${pointer.px}px, ${pointer.py}px, 0)`;
  chargeFg.style.strokeDashoffset = (163.4 * (1 - charge)).toFixed(1);

  // scrolling drags the petals
  scrollV = damp(scrollV, clamp((window.__lenis?.velocity ?? 0) / 50, -1, 1), 6, dt);
  SIMU.uScrollV.value = scrollV;

  gpu.compute();
  R.tPos.value = gpu.getCurrentRenderTarget(posVar).texture;
  if (SHADOW) {
    shadowPts.matrix.copy(flower.matrixWorld); shadowPts.matrixWorld.copy(flower.matrixWorld);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(shadowRT);
    renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(shadowScene, camera);
    renderer.setRenderTarget(prev);
    renderer.setClearColor(0xf4efe6, 1);
  }

  // ── page chrome tied to the scene ──
  const vh = innerHeight;
  let ap = -1;
  specY.forEach(([y, h], i) => { if (scrollY >= y - vh * (i ? 0.02 : 0.2) && scrollY < y + h - vh * 1.12) ap = i; });
  if (ap !== activePlate) {
    plates.forEach((p, i) => p.classList.toggle('on', i === ap));
    railLinks.forEach((a, i) => a.classList.toggle('on', i === ap));
    railEl.classList.toggle('on', ap >= 0);
    activePlate = ap;
  }
  if (ap >= 0) {
    const formed = ap === 0 ? 1 : clamp(cur.m - (ap - 1));
    const b = bloom.v;
    const st = formed < 0.995 ? `Assembling ${Math.round(formed * 100)}%` : b < 0.995 ? `Re-blooming ${Math.round(b * 100)}%` : 'Settled';
    if (statusEls[ap]._s !== st) { statusEls[ap].textContent = st; statusEls[ap]._s = st; plates[ap].classList.toggle('forming', st !== 'Settled'); }
  }
  const calm = Math.abs(cur.dist - target.dist) + Math.abs(cur.sx - target.sx) * 3 + Math.abs(cur.yaw - target.yaw) + Math.abs(cur.elev - target.elev) < 0.06;
  const settled = ap >= 0 && Math.abs(cur.m - ap) < 0.02 && bloom.v > 0.97 && calm && !MOBILE;
  const cOn = settled ? ap : -1;
  if (cOn !== calloutOn) {
    if (cOn >= 0) callouts[cOn].forEach(c => { c.fresh = true; });
    callouts.forEach((list, i) => { list[0].g.classList.toggle('on', i === cOn); list.forEach(c => c.el.classList.toggle('on', i === cOn)); });
    calloutOn = cOn;
  }
  if (cOn >= 0) {
    pickAnchors(cOn, flap);
    for (const c of callouts[cOn]) {
      flapJS(c.p, cOn === 3 ? flap : 0, tmp).applyMatrix4(flower.matrixWorld).project(camera);
      const tx = (tmp.x * 0.5 + 0.5) * innerWidth, ty = (0.5 - tmp.y * 0.5) * innerHeight;
      if (c.fresh) { c.sx = tx; c.sy = ty; c.fresh = false; }
      c.sx = damp(c.sx, tx, 5, dt); c.sy = damp(c.sy, ty, 5, dt);
      const x = c.sx, y = c.sy;
      const ex = clamp(x + c.dx, 210, innerWidth - 210), ey = clamp(y + c.dy, 110, innerHeight - 110);
      c.path.setAttribute('d', `M${x.toFixed(1)} ${y.toFixed(1)} L${lerp(x, ex, 0.4).toFixed(1)} ${ey.toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)}`);
      c.dot.setAttribute('cx', x.toFixed(1)); c.dot.setAttribute('cy', y.toFixed(1));
      c.el.style.transform = `translate3d(${(c.dx < 0 ? ex - 198 : ex + 8).toFixed(1)}px, ${(ey - 11).toFixed(1)}px, 0)`;
    }
  }

  // hero figure caption hangs under the rose
  const heroOn = scrollY < vh * 0.3 && started;
  figEl.style.opacity = heroOn ? 1 - smooth(0, vh * 0.3, scrollY) : 0;
  if (heroOn) {
    tmp.set(0, -1.05, 0).applyMatrix4(flower.matrixWorld).project(camera);
    figEl.style.transform = `translate3d(${((tmp.x * 0.5 + 0.5) * innerWidth + 64).toFixed(1)}px, ${((0.5 - tmp.y * 0.5) * innerHeight).toFixed(1)}px, 0)`;
  }
  heroEl.style.setProperty('--fade', 1 - smooth(0, vh * 0.6, scrollY));
  navEl.classList.toggle('scrolled', scrollY > vh * 0.5);
  if (hintReady) hintEl.classList.toggle('on', MOBILE ? scrollY < vh * 0.5 : scrollY < subY - vh * 0.6);
});

// ─── Boot ───────────────────────────────────────────────────────────────────
worldNav('florae', { theme: 'light', corner: 'bl' });
cursor({ color: '#a8284b', blend: 'normal', size: 30 });
magnetic();
const lenis = smoothScroll({ lerp: 0.08 });
document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
  const id = a.getAttribute('href');
  const el = id === '#top' ? 0 : document.querySelector(id);
  if (el === null) return;
  e.preventDefault();
  lenis.scrollTo(el, { duration: 2.2 });
}));

SHAPES = await buildShapes();
SHAPES.push(SHAPES[0]); // the rose returns at the end: rose, protea, orchid, morpho, archive, rose
callouts.forEach((list, i) => list.forEach(c => { c.p = anchorOf(SHAPES[i], SIZE, c.at ?? [0.5, (c.band[0] + c.band[1]) / 2, 0.5]); }));
cands = SHAPES.slice(0, 4).map(sh => candidates(sh));
layoutKeys();
addEventListener('resize', layoutKeys);
new ResizeObserver(layoutKeys).observe(document.body);
sampleKeys(scrollY, target); Object.assign(cur, target);

// Every particle starts packed in the rose's heart, a bud about to open.
{
  const [hx, hy, hz] = SHAPES[0].heart, d = pos0.image.data;
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 0.16 * Math.cbrt(Math.random()), q = Math.sqrt(1 - u * u);
    d[i * 4] = hx + Math.cos(a) * q * r; d[i * 4 + 1] = hy + u * r * 1.2; d[i * 4 + 2] = hz + Math.sin(a) * q * r;
  }
  pos0.needsUpdate = true;
  gpu.renderTexture(pos0, posVar.renderTargets[0]);
  gpu.renderTexture(pos0, posVar.renderTargets[1]);
}
// Warm every program before the reveal.
U.tA.value = U.tB.value = SHAPES[0].pos; U.tNA.value = U.tNB.value = SHAPES[0].nrm; R.tCA.value = R.tCB.value = SHAPES[0].col;
gpu.compute();
R.tPos.value = gpu.getCurrentRenderTarget(posVar).texture;
renderer.compile(scene, camera);
engine.start();
await loader.finish();
started = true;

// Intro: the rose assembles from its heart outward.
gsap.to(bloom, { v: 1, duration: 3.6, ease: 'power1.inOut', delay: 0.25 });
const titleSplit = SplitText.create('.hero-title', { type: 'chars', charsClass: 'char' });
gsap.from(titleSplit.chars, { yPercent: 70, opacity: 0, rotate: 6, duration: 2.2, ease: 'expo.out', stagger: 0.07, delay: 0.25 });
gsap.from('.hero-kicker, .hero-line, .hero-body, .hero-cta, .nav', { opacity: 0, y: 16, duration: 1.4, ease: 'power3.out', stagger: 0.09, delay: 0.7 });
setTimeout(() => { hintReady = true; }, 1500);
reveal('.atelier h2, .archive h2, .subscribe h2, .foot-title', { type: 'lines', stagger: 0.09 });
reveal('.atelier-cols p, .lede', { type: 'lines', stagger: 0.05, y: '100%' });
gsap.from('.months li', { opacity: 0, x: -18, duration: 1, ease: 'power3.out', stagger: 0.08, scrollTrigger: { trigger: '.months', start: 'top 80%', once: true } });
gsap.from('.tier', { opacity: 0, y: 40, duration: 1.2, ease: 'power3.out', stagger: 0.12, scrollTrigger: { trigger: '.tiers', start: 'top 85%', once: true } });
gsap.from('.stats > div', { opacity: 0, y: 20, duration: 1, ease: 'power3.out', stagger: 0.1, scrollTrigger: { trigger: '.stats', start: 'top 88%', once: true } });

window.__florae = { gust, bloom, cur, SHAPES, R, SIMU, ready: true };
