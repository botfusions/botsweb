import { Engine, THREE, normalize, prepModel, damp, clamp, smooth, lerp, studioEnvironment } from '../../src/core/engine.js';
import { Assets } from '../../src/core/assets.js';
import { Pointer } from '../../src/core/input.js';
import { smoothScroll, gsap, reveal } from '../../src/core/scroll.js';
import { preloader, cursor, magnetic, worldNav } from '../../src/core/ui.js';
import { fbmTexture } from '../../src/core/textures.js';
import { RippleSim, waterMaterial, causticTexture, microTexture, underShared, patchUnder } from './water.js';
import { koiPrototype, School } from './koi.js';
import { Flora, patchFloat } from './flora.js';
import { MapleBranch } from './maple.js';
import { buildTerrain, terrainTextures, rockMaterial, buildRocks, gardenShared, buildEnclosure } from './garden.js';
import { terrainH, pondSDF, LANTERN } from './shape.js';
import { PlanarReflection } from '../../src/core/reflector.js';

const DBG = new URLSearchParams(location.search);
const D = Math.PI / 180;
const isTouch = matchMedia('(pointer: coarse)').matches;

// ─── Engine ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gl');
const engine = new Engine({
  canvas, fov: 32, near: 0.05, far: 90, dpr: 1.5, background: 0x0b1511,
  post: {
    ao: { aoRadius: 0.5, intensity: 1.6, distanceFalloff: 0.5 },
    bloom: { intensity: 0.55, luminanceThreshold: 0.92, luminanceSmoothing: 0.25, radius: 0.62 },
    vignette: { offset: 0.28, darkness: 0.58 },
    noise: 0.04,
    ca: 0.0005,
    tone: 'agx',
  },
});
const { scene, camera, renderer } = engine;
const under = new THREE.Scene();
renderer.shadowMap.autoUpdate = true;

const envMain = studioEnvironment(renderer, {
  top: 0x9fb3bf, bottom: 0x18200f,
  panels: [{ pos: [2, 8, -5], size: [9, 6], intensity: 3.2, color: 0xfff3e0 }, { pos: [-7, 4, 2], size: [4, 6], intensity: 1.2, color: 0xd8e6ff }],
});
const envUnder = studioEnvironment(renderer, {
  top: 0x7fa090, bottom: 0x040a07,
  panels: [{ pos: [0, 9, -2], size: [10, 10], intensity: 2.2, color: 0xe4f4ea }],
});
scene.environment = envMain; scene.environmentIntensity = 0.55;
under.environment = envUnder; under.environmentIntensity = 0.5;

// Key light (sun by day, moon by night): one per scene, same parameters.
function makeKey() {
  const l = new THREE.DirectionalLight(0xfff3dd, 3.5);
  l.castShadow = true;
  l.shadow.mapSize.set(3072, 3072);
  const c = l.shadow.camera; c.left = -12; c.right = 12; c.top = 12; c.bottom = -12; c.near = 1; c.far = 110;
  l.shadow.bias = -0.00025; l.shadow.normalBias = 0.02; l.shadow.radius = 2;
  return l;
}
const keyMain = makeKey(), keyUnder = makeKey();
keyUnder.shadow.bias = -0.0004;
scene.add(keyMain, keyMain.target); under.add(keyUnder, keyUnder.target);
const hemiMain = new THREE.HemisphereLight(0xcfe0ea, 0x2a3318, 0.35);
const hemiUnder = new THREE.HemisphereLight(0x9fc4b0, 0x0a140e, 0.3);
scene.add(hemiMain); under.add(hemiUnder);
const lampMain = new THREE.PointLight(0xffa24a, 0, 9, 1.4);
const lampUnder = new THREE.PointLight(0xffa24a, 0, 7, 1.6);
scene.add(lampMain); under.add(lampUnder);

// ─── Loading ───────────────────────────────────────────────────────────────────
const assets = new Assets();
const loaderEl = document.querySelector('.loader');
const loader = preloader({
  assets, el: loaderEl, minTime: 1600,
  onValue: v => {
    loaderEl.querySelector('.loader-pct').textContent = Math.round(v * 100);
    loaderEl.style.setProperty('--p', v.toFixed(3));
  },
  exit: async () => {
    loaderEl.classList.add('out');
    await gsap.to(loaderEl, { autoAlpha: 0, duration: 1.4, ease: 'power2.inOut', delay: 0.35 });
  },
});

// ─── Water ─────────────────────────────────────────────────────────────────────
const sim = new RippleSim(renderer, { res: DBG.has('lowsim') ? 512 : 1024, x0: -10.5, z0: -8.5, size: 21 });
underShared.uSurf.value = sim.texture;
underShared.uSimRect.value.copy(sim.rect);
underShared.uCaust.value = causticTexture(renderer);
underShared.uFocus.value = 0.045;

// The maple canopy lives on a plane 6.5 m above the water; reflections and dapple both look it up.
const CANOPY = { x0: -12, z0: -9.5, w: 16, h: 14.5 };
const canopyMat = new THREE.Matrix3().set(1 / CANOPY.w, 0, -CANOPY.x0 / CANOPY.w, 0, -1 / CANOPY.h, 1 + CANOPY.z0 / CANOPY.h, 0, 0, 1);
underShared.uCanopyMat.value = canopyMat;

const underRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
const W = {
  uUnder: { value: underRT.texture }, uUnderSize: { value: new THREE.Vector2(4, 4) },
  uSurf: { value: sim.texture }, uSimRect: { value: sim.rect },
  uMicro: { value: microTexture(renderer) }, uCanopy: { value: null }, uCookie: { value: null },
  uCanopyMat: { value: canopyMat }, uCanopyH: underShared.uCanopyH,
  uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() },
  uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
  uAbsorb: { value: new THREE.Vector3(1.55, 0.64, 0.8) }, uScatter: { value: new THREE.Vector3(0.006, 0.028, 0.02) },
  uMoonDir: { value: new THREE.Vector3(0, 0.5, -1).normalize() }, uMoonCol: { value: new THREE.Color(0, 0, 0) },
  uLampPos: { value: new THREE.Vector3() }, uLampCol: { value: new THREE.Color(0, 0, 0) },
  uLeafTint: { value: new THREE.Color(0.95, 0.22, 0.08) },
  uTime: { value: 0 }, uSlope: { value: 1 }, uRefr: { value: 0.07 }, uWind: { value: 0.06 },
  uAutumn: { value: 0 }, uBare: { value: 0 }, uGlint: { value: 1 }, uCanopyK: { value: 1 }, uReflK: { value: 0.75 }, uDebug: { value: +(DBG.get('wdbg') ?? 0) }, uMicroK: { value: 1 },
};
const reflection = new PlanarReflection(renderer, { resolution: 0.5 });
engine.onResize((w, h, dpr) => reflection.setSize(w, h, dpr));
W.uRefl = { value: reflection.rt.texture }; W.uReflMat = { value: reflection.texMatrix };
const water = new THREE.Mesh(new THREE.PlaneGeometry(sim.rect.z, sim.rect.z, 1, 1).rotateX(-Math.PI / 2), waterMaterial(W));
water.position.set(sim.rect.x + sim.rect.z / 2, 0, sim.rect.y + sim.rect.z / 2);
water.renderOrder = -1;
scene.add(water);
reflection.hidden.push(water);
engine.onResize((w, h, dpr) => {
  underRT.setSize(Math.round(w * dpr), Math.round(h * dpr));
  W.uUnderSize.value.set(Math.round(w * dpr), Math.round(h * dpr));
});

// ─── Garden ────────────────────────────────────────────────────────────────────
const texLoads = [
  terrainTextures(renderer, assets),
  assets.texture('img/koi/canopy.webp').then(t => { t.anisotropy = 8; W.uCanopy.value = t; }),
  assets.texture('img/koi/cookie.webp', { srgb: false }).then(t => { W.uCookie.value = t; underShared.uCookie.value = t; }),
];
const terrain = buildTerrain(renderer);
under.add(terrain.under); scene.add(terrain.above);
const rocks = buildRocks(rockMaterial(renderer));
const enclosure = buildEnclosure(W);
scene.add(enclosure.hedge, enclosure.sky);
enclosure.sky.onBeforeRender = (r, s, cam) => enclosure.sky.position.copy(cam.position);
rocks.under.forEach(r => under.add(r)); rocks.above.forEach(r => scene.add(r));

// Lantern on its bank; its fire box glows at dusk.
const lanternGroup = new THREE.Group();
lanternGroup.position.set(LANTERN.x, terrainH(LANTERN.x, LANTERN.z) - 0.04, LANTERN.z);
lanternGroup.rotation.y = -28 * D;
scene.add(lanternGroup);
const LANTERN_H = 1.7;
const fire = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.13, 0.17), new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) }));
fire.position.y = LANTERN_H * 0.625;
lanternGroup.add(fire);
lanternGroup.updateMatrixWorld(true);
const firePos = new THREE.Vector3(); fire.getWorldPosition(firePos);
lampMain.position.copy(firePos); lampUnder.position.copy(firePos);
W.uLampPos.value.copy(firePos);

const loads = [
  assets.gltf('models/koi/kohaku.glb'), assets.gltf('models/koi/showa.glb'),
  assets.gltf('models/koi/lotus.glb'), assets.gltf('models/koi/lantern.glb'),
];

// ─── Koi ───────────────────────────────────────────────────────────────────────
const KOI = [
  { kind: 'kohaku', len: 0.9, depth: -0.36, x: 0.9, z: 0.5, heading: 2.2 },
  { kind: 'showa', len: 0.84, depth: -0.5, x: -0.6, z: 1.2, heading: -0.6 },
  { kind: 'kohaku', len: 0.72, depth: -0.28, x: 1.9, z: -0.6, heading: 3.6 },
  { kind: 'showa', len: 0.7, depth: -0.62, x: -1.4, z: -0.4, heading: 1.2 },
  { kind: 'kohaku', len: 0.96, depth: -0.7, x: 0.1, z: -1.3, heading: 0.4, tint: 0xffcf6a },
  { kind: 'kohaku', len: 0.66, depth: -0.24, x: 2.3, z: 1.4, heading: -2.2 },
  { kind: 'showa', len: 0.92, depth: -0.44, x: -0.2, z: 2.0, heading: 2.8 },
  { kind: 'kohaku', len: 0.8, depth: -0.56, x: 1.4, z: 1.9, heading: -1.1, tint: 0xc9a07a },
  { kind: 'showa', len: 0.74, depth: -0.34, x: -1.8, z: 0.9, heading: 0.9 },
];
let school, flora, branch;

// ─── Looks (lighting + season) and scroll stations ────────────────────────────
const sunDir = (az, el) => [Math.sin(az * D) * Math.cos(el * D), Math.sin(el * D), -Math.cos(az * D) * Math.cos(el * D)];
const LOOK = {
  day: {
    keyDir: sunDir(-135, 55), key: [1.0, 0.95, 0.86], keyI: 4.2, env: 0.5, envU: 0.26, hemi: 0.14,
    zen: [0.55, 0.7, 0.86], hor: [1.25, 1.35, 1.42], moon: 0, lamp: 0, glint: 1,
    autumn: 0.3, bare: 0, snow: 0, petals: 0, leaves: 60, wind: 0.06, lotus: 1,
    scatter: [0.0028, 0.013, 0.0105], moss: [1, 1, 1], mist: 0, caust: 1,
  },
};
LOOK.morning = { ...LOOK.day, keyDir: sunDir(155, 32), key: [1.0, 0.88, 0.72], keyI: 2.6, zen: [0.9, 1.1, 1.35], hor: [1.7, 1.65, 1.55], autumn: 0.15, leaves: 35, wind: 0.02, mist: 0.55 };
LOOK.afternoon = { ...LOOK.day, keyDir: sunDir(140, 38), key: [1.0, 0.82, 0.6], keyI: 3.2, zen: [1.0, 1.05, 1.15], hor: [1.9, 1.6, 1.2], autumn: 1, leaves: 230, wind: 0.08 };
LOOK.night = {
  ...LOOK.day, keyDir: sunDir(4, 30), key: [0.55, 0.68, 1.0], keyI: 0.7, env: 0.08, envU: 0.08, hemi: 0.06,
  zen: [0.02, 0.035, 0.09], hor: [0.05, 0.075, 0.14], moon: 1, lamp: 1, glint: 0.9, autumn: 0.6, leaves: 70, wind: 0.02,
  scatter: [0.0006, 0.0018, 0.002],
};
LOOK.spring = { ...LOOK.day, caust: 0.55, keyDir: sunDir(-160, 52), autumn: 0, petals: 300, leaves: 6, zen: [1.1, 1.25, 1.45], moss: [1.05, 1.08, 0.95] };
LOOK.summer = { ...LOOK.day, caust: 0.6, keyDir: sunDir(175, 62), keyI: 3.9, autumn: 0, leaves: 10, wind: 0.04, moss: [0.95, 1.05, 0.9] };
LOOK.autumn = { ...LOOK.afternoon, caust: 0.55, keyDir: sunDir(-165, 42), autumn: 1, leaves: 340 };
LOOK.winter = {
  ...LOOK.day, keyDir: sunDir(190, 26), key: [0.82, 0.9, 1.0], keyI: 2.0, env: 0.7, hemi: 0.45, zen: [1.3, 1.4, 1.55], hor: [2.0, 2.05, 2.1],
  autumn: 0.5, bare: 1, snow: 1, leaves: 0, lotus: 0, wind: 0.02, scatter: [0.006, 0.02, 0.022], moss: [0.7, 0.75, 0.72],
};
LOOK.dawn = { ...LOOK.day, keyDir: sunDir(150, 16), key: [1.0, 0.72, 0.5], keyI: 2.2, env: 0.4, zen: [0.7, 0.8, 1.05], hor: [1.9, 1.3, 0.95], autumn: 0.35, leaves: 40, wind: 0.02, mist: 0.4 };

const V = (...a) => new THREE.Vector3(...a);
const STATIONS = {
  hero: { pos: V(0.35, 4.4, 2.75), look: V(0.35, -0.35, 0.35), look_: 'day', subject: V(1.1, 0, 0.3) },
  moss: { pos: V(2.1, 1.72, 1.5), look: V(2.45, 0.72, -2.3), look_: 'morning', subject: V(3.45, 0.7, -2.6) },
  maple: { pos: V(1.85, 4.7, 2.35), look: V(1.7, -0.2, -0.35), look_: 'afternoon', subject: V(2.2, 1.2, 0.5) },
  moon: { pos: V(0.9, 2.7, 5.4), look: V(0.9, -0.1, -0.2), look_: 'night', subject: V(1.4, 0, 0.6) },
  kaiseki: { pos: V(5.9, 2.0, 1.55), look: V(4.05, 0.75, -2.1), look_: 'night', subject: V(3.45, 0.9, -2.6) },
  spring: { pos: V(1.3, 6.3, 4.6), look: V(1.7, -0.4, 0.5), look_: 'spring' },
  summer: { pos: V(1.7, 6.2, 4.5), look: V(1.9, -0.4, 0.45), look_: 'summer' },
  autumn: { pos: V(2.1, 6.1, 4.4), look: V(2.1, -0.4, 0.4), look_: 'autumn' },
  winter: { pos: V(2.5, 6.0, 4.3), look: V(2.3, -0.4, 0.35), look_: 'winter' },
  reserve: { pos: V(0.2, 5.4, 4.2), look: V(0.1, -0.3, 0.6), look_: 'dawn' },
  foot: { pos: V(0.2, 7.2, 4.8), look: V(0.1, -0.3, 0.8), look_: 'dawn' },
};
// Portrait screens: a wider lens, the subject pulled to the centre line and lifted above the paper panels.
let portrait = false;
engine.onResize((w, h) => {
  portrait = w / h < 0.85;
  camera.fov = portrait ? 54 : 32;
  camera.updateProjectionMatrix();
});
for (const s of Object.values(STATIONS)) {
  const subj = s.subject ?? s.look;
  const look = s.look.clone().lerp(subj, 0.85);
  const pos = look.clone().add(s.pos.clone().sub(s.look).multiplyScalar(1.12));
  s.m = { pos, look };
}
const keyEls = [...document.querySelectorAll('[data-key]')];
let anchors = [];
function measure() {
  anchors = keyEls.map(el => {
    const r = el.getBoundingClientRect();
    const top = r.top + scrollY;
    const k = el.dataset.key;
    const a = k === 'hero' ? 0 : k === 'foot' ? document.documentElement.scrollHeight - innerHeight : top + r.height / 2 - innerHeight / 2;
    return { key: k, a };
  });
}
addEventListener('resize', measure);
addEventListener('load', measure);
document.fonts?.ready.then(measure);
setInterval(measure, 2500);
// in-page links glide with Lenis to the station they name
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const id = a.getAttribute('href').slice(1);
  const el = id === 'top' ? document.body : document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  const key = el.dataset.key ? el : el.querySelector('[data-key]');
  const anchor = key && anchors.find(x => x.key === key.dataset.key);
  window.__lenis?.scrollTo(id === 'top' ? 0 : anchor ? anchor.a : el, { duration: 2.4, easing: t => 1 - Math.pow(1 - t, 3) });
});
function scrollU() {
  const y = scrollY;
  if (!anchors.length) return 0;
  if (y <= anchors[0].a) return 0;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i].a, b = anchors[i + 1].a;
    if (y < b) return i + (y - a) / Math.max(1, b - a);
  }
  return anchors.length - 1;
}

const lookKeys = Object.keys(LOOK.day);
function mixLook(a, b, t) {
  const o = {};
  for (const k of lookKeys) {
    const x = a[k], y = b[k];
    o[k] = Array.isArray(x) ? x.map((v, i) => lerp(v, y[i], t)) : lerp(x, y, t);
  }
  return o;
}
let look = { ...LOOK.day };

// ─── Interaction ───────────────────────────────────────────────────────────────
const pointer = new Pointer({ lambda: 9 });
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const hand = { x: 0, z: 0, px: 0, pz: 0, vx: 0, vz: 0, speed: 0, on: false, valid: false, lastMove: -10, still: 0 };
let overWater = false;
addEventListener('pointermove', e => { overWater = e.target === canvas; hand.lastMove = engine.time; }, { passive: true });
document.addEventListener('pointerleave', () => { overWater = false; });
function waterHit(nx, ny, out) {
  ndc.set(nx, ny);
  ray.setFromCamera(ndc, camera);
  const d = ray.ray.direction, o = ray.ray.origin;
  if (d.y > -0.02) return false;
  const t = -o.y / d.y;
  out.x = o.x + d.x * t; out.z = o.z + d.z * t;
  return pondSDF(out.x, out.z) < -0.05;
}

// Audio: a soft plop, synthesized, only ever in response to a click.
let audio = null, soundOn = true;
const soundBtn = document.querySelector('.sound');
soundBtn.addEventListener('click', () => { soundOn = !soundOn; soundBtn.setAttribute('aria-pressed', soundOn); soundBtn.classList.toggle('off', !soundOn); });
let gestured = false;
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { gestured = true; }, { once: true, capture: true });
function plop(vol = 1, pitch = 1) {
  if (!soundOn || !gestured) return;
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime + 0.001;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine';
    const f0 = (620 + Math.random() * 240) * pitch;
    o.frequency.setValueAtTime(f0 * 0.5, t);
    o.frequency.exponentialRampToValueAtTime(f0, t + 0.035);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.35, t + 0.16);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09 * vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + 0.25);
  } catch { /* optional */ }
}

let fedOnce = false;
function feed(x, z) {
  flora.drop(x, z, 5);
  fedOnce = true;
  document.body.classList.add('has-fed');
}
canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !flora) return;
  const nx = (e.clientX / innerWidth) * 2 - 1, ny = -(e.clientY / innerHeight) * 2 + 1;
  const p = {};
  if (waterHit(nx, ny, p)) feed(p.x, p.z);
});

const hooks = {
  pelletLand: p => { sim.drop(p.x, p.z, 0.05, 0.012); flora.splash(p.x, p.z, 7, 0.8); if (p.delay < 0.08) plop(0.9); else if (Math.random() < 0.5) plop(0.4, 1.3); },
  eat: (food, fish) => {
    sim.drop(food.x, food.z, 0.08, -0.009);
    setTimeout(() => { sim.drop(food.x, food.z, 0.05, 0.006); flora.splash(food.x, food.z, 5, 0.55); plop(0.55, 0.7); }, 90);
  },
  leafLand: l => sim.drop(l.x, l.z, l.petal ? 0.025 : 0.04, l.petal ? 0.0012 : 0.0026),
  kiss: (f, x, z) => { sim.drop(x, z, 0.035, -0.004); setTimeout(() => sim.drop(x, z, 0.025, 0.003), 120); },
  dropletLand: d => sim.drop(d.x, d.z, 0.018, 0.0009),
  wake: (f, hx, hz, bx, bz) => { if (Math.random() < 0.35) sim.drop(hx, hz, 0.05, 0.0005 * f.speed * (1 + f.y * 3), bx, bz); },
};

// ─── UI ────────────────────────────────────────────────────────────────────────
worldNav('koi', { theme: 'dark', corner: 'bl' });
const cur = cursor({ color: '#f3efe6', blend: 'normal', size: 30 });
magnetic();
const lenis = smoothScroll({ lerp: 0.07 });
reveal('.sec-head h2, .kaiseki-paper h2, .season-paper h2, .reserve-paper h2', { type: 'lines', stagger: 0.09 });
reveal('.lede', { type: 'lines', stagger: 0.05, y: '100%' });
if (isTouch) {
  document.querySelector('.hint-feed').innerHTML = '<b>Tap</b> the water to feed the koi';
  document.body.classList.add('touch');
}
const toastEl = document.querySelector('.toast');
let toastT;
function toast(msg, ms = 3200) { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), ms); }
document.querySelector('.booking').addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.target);
  toast(`Thank you. We will write back by hand about ${f.get('nights')} nights in a ${f.get('room')} room.`, 4200);
});
const roomEls = [...document.querySelectorAll('.room')], roomDots = [...document.querySelectorAll('.room-dots li')];
const seasonEls = [...document.querySelectorAll('.season-list li')], seasonKanji = [...document.querySelectorAll('.season-kanji span')];
let activeKey = '';
function setActive(k) {
  if (k === activeKey) return;
  activeKey = k;
  const ri = ['moss', 'maple', 'moon'].indexOf(k);
  if (ri >= 0) { roomEls.forEach((el, i) => el.classList.toggle('is-on', i === ri)); roomDots.forEach((el, i) => el.classList.toggle('is-on', i === ri)); }
  const si = ['spring', 'summer', 'autumn', 'winter'].indexOf(k);
  if (si >= 0) { seasonEls.forEach((el, i) => el.classList.toggle('is-on', i === si)); seasonKanji.forEach((el, i) => el.classList.toggle('is-on', i === si)); }
  document.body.dataset.station = k;
}

// ─── Frame loop ────────────────────────────────────────────────────────────────
const camPos = new THREE.Vector3().copy(STATIONS.hero.pos), camLook = new THREE.Vector3().copy(STATIONS.hero.look);
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), right = new THREE.Vector3();
const intro = { v: 1 };
let uS = 0;
const keyDirV = new THREE.Vector3();
const bgColor = new THREE.Color(0x0b1511);
const view = { x: 0, z: 0, w: 6, h: 5 };

function applyLook(L) {
  keyDirV.set(...L.keyDir).normalize();
  for (const k of [keyMain, keyUnder]) {
    k.color.setRGB(...L.key);
    k.intensity = L.keyI;
    k.target.position.set(0, 0, 1.5);
    k.position.copy(k.target.position).addScaledVector(keyDirV, 45);
  }
  underShared.uKeyDir.value.copy(keyDirV);
  // refracted key direction under water (for caustic and dapple offsets)
  const sinT = Math.sqrt(1 - keyDirV.y * keyDirV.y) / 1.33, cosT = Math.sqrt(1 - sinT * sinT);
  const hl = Math.hypot(keyDirV.x, keyDirV.z) || 1;
  underShared.uSunRefr.value.set(keyDirV.x / hl * sinT / cosT, keyDirV.z / hl * sinT / cosT);
  hemiMain.intensity = L.hemi; hemiUnder.intensity = L.hemi * 0.9;
  scene.environmentIntensity = L.env; under.environmentIntensity = L.envU;
  W.uSunDir.value.copy(keyDirV);
  W.uSunCol.value.setRGB(...L.key).multiplyScalar(L.keyI / 3.4);
  W.uZenith.value.setRGB(...L.zen); W.uHorizon.value.setRGB(...L.hor);
  W.uMoonCol.value.setRGB(1.0, 0.97, 0.9).multiplyScalar(L.moon * 1.2);
  W.uMoonDir.value.copy(keyDirV);
  W.uLampCol.value.setRGB(1.0, 0.55, 0.2).multiplyScalar(L.lamp * 1.6);
  W.uAutumn.value = L.autumn; W.uBare.value = L.bare; W.uWind.value = L.wind; W.uGlint.value = L.glint; W.uMicroK.value = 1 - L.moon * 0.75;
  W.uScatter.value.set(...L.scatter);
  lampMain.intensity = L.lamp * 9; lampUnder.intensity = L.lamp * 4;
  fire.material.color.setRGB(9, 4.2, 1.4).multiplyScalar(L.lamp);
  gardenShared.uSnow.value = L.snow;
  underShared.uCaustK.value = L.caust;
  enclosure.uniforms.uKeyDir.value.copy(keyDirV); enclosure.uniforms.uKeyCol.value.setRGB(...L.key).multiplyScalar(L.keyI / 3.4);
  enclosure.uniforms.uAmb.value.setRGB(0.5, 0.62, 0.5).multiplyScalar(L.hemi * 1.6 + L.env * 0.3);
  gardenShared.uMossTint.value.setRGB(...L.moss);
  underShared.uDappleK.value = 1 - L.bare * 0.7;
  if (flora) {
    flora.season.leaves = Math.round(L.leaves);
    flora.season.petals = Math.round(L.petals);
    flora.season.snow = L.snow;
    flora.season.slots = L.autumn > 0.55 ? [0, 1, 1, 2, 3] : L.autumn > 0.2 ? [0, 2, 3, 4, 4] : [4, 4, 3];
    for (const l of flora.lotus) l.holder.scale.setScalar(l.s * Math.max(0.001, L.lotus));
    flora.padScale = Math.max(0.001, L.lotus);
    flora.fireMat.uniforms.uAmt.value = L.lamp;
    for (const m of flora.mist) { m.material.uniforms.uAmt.value = L.mist; m.material.uniforms.uCol.value.setRGB(...L.key).multiplyScalar(0.35 + L.keyI * 0.12).lerp(W.uHorizon.value, 0.35); }
  }
}

engine.onTick((dt, t) => {
  pointer.update(dt);
  if (!school) return;
  // scroll → station
  const u = scrollU();
  uS = damp(uS, u, 4.5, dt);
  const i0 = clamp(Math.floor(uS), 0, anchors.length - 1), i1 = Math.min(i0 + 1, anchors.length - 1);
  const f = smooth(0.12, 0.88, uS - i0);
  const A = STATIONS[anchors[i0].key], B = STATIONS[anchors[i1].key];
  setActive(anchors[Math.round(u)]?.key ?? 'hero');
  const Am = portrait ? A.m : A, Bm = portrait ? B.m : B;
  tmp.lerpVectors(Am.pos, Bm.pos, f);
  tmp2.lerpVectors(Am.look, Bm.look, f);
  // lift the camera a little mid-transition so the drift reads as flight over water
  tmp.y += Math.sin(f * Math.PI) * 0.5 * (A === B ? 0 : 1);
  tmp.y += intro.v * 3.2; tmp.z += intro.v * 1.2;
  camPos.copy(tmp); camLook.copy(tmp2);
  look = mixLook(LOOK[A.look_], LOOK[B.look_], f);
  applyLook(look);
  document.body.classList.toggle('is-night', look.lamp > 0.5);
  document.body.classList.toggle('scrolled', u > 0.15);

  // camera: slow breath + pointer parallax
  right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  camera.position.copy(camPos)
    .addScaledVector(right, pointer.sx * 0.12 + Math.sin(t * 0.13) * 0.05)
    .add(tmp.set(0, Math.sin(t * 0.21) * 0.04, pointer.sy * -0.08));
  if (DBG.has('cam')) { const c = DBG.get('cam').split(',').map(Number); camera.position.set(c[0], c[1], c[2]); camera.lookAt(c[3], c[4], c[5]); if (DBG.has('look')) { look = { ...LOOK[DBG.get('look')] }; applyLook(look); } }
  else {
    camera.lookAt(camLook);
    if (portrait) { // nudge the subject into the upper half, above the panels
      tmp2.set(0, 1, 0).applyQuaternion(camera.quaternion);
      camera.lookAt(tmp.copy(camLook).addScaledVector(tmp2, -camera.position.distanceTo(camLook) * 0.2));
    }
  }
  camera.updateMatrixWorld();

  // the visitor's hand on the water
  const onW = overWater && pointer.active && !isTouch && engine.time - hand.lastMove < 4;
  const p = {};
  const hit = onW && waterHit(pointer.x, pointer.y, p);
  if (hit) {
    if (hand.valid) {
      const vx = (p.x - hand.x) / dt, vz = (p.z - hand.z) / dt;
      hand.vx = damp(hand.vx, vx, 12, dt); hand.vz = damp(hand.vz, vz, 12, dt);
      hand.speed = Math.hypot(hand.vx, hand.vz);
      const moved = Math.hypot(p.x - hand.x, p.z - hand.z);
      if (moved > 0.002) sim.drop(hand.x, hand.z, 0.05, -0.0048 * clamp(hand.speed / 1.4, 0.12, 1.3), p.x, p.z);
    }
    hand.x = p.x; hand.z = p.z; hand.valid = true; hand.on = true;
  } else { hand.valid = false; hand.on = false; hand.speed = 0; }
  school.pointer = hand;
  hand.still = hand.on && hand.speed < 0.2 ? hand.still + dt : 0;
  if (cur) cur.set(hand.on && u < 0.6 ? (hand.still > 0.9 && !fedOnce ? 'label' : '') : '', 'feed');

  // what the camera sees (for spawning leaves where they will be noticed)
  camera.getWorldDirection(tmp);
  const tHit = -camera.position.y / Math.min(tmp.y, -0.2);
  view.x = camera.position.x + tmp.x * tHit; view.z = camera.position.z + tmp.z * tHit;
  view.w = camera.position.y * 1.2; view.h = camera.position.y * 0.9;

  school.home = view;
  school.update(dt, t, hooks);
  flora.update(dt, t, { school, pointer: hand, hooks, view });
  branch.update(t, look);
  // a koi occasionally kisses the surface
  if (Math.random() < dt * 0.35) { const k = school.fish[Math.floor(Math.random() * school.fish.length)]; if (k.y > -0.3) { sim.drop(k.chain[0], k.chain[2], 0.03, 0.002); } }
  sim.step(dt);

  underShared.uTime.value = t;
  W.uTime.value = t;

  // mirrored garden for the surface
  if (!DBG.has('norefl')) {
    renderer.setClearColor(0x000000, 0);
    reflection.update(scene, camera);
  }
  // under-water pass
  underShared.uDepthOut.value = 1;
  const prevT = renderer.getRenderTarget();
  renderer.setRenderTarget(underRT);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(under, camera);
  renderer.setRenderTarget(prevT);
  renderer.setClearColor(bgColor, 1);
  underShared.uDepthOut.value = 0;
});

// ─── Boot ──────────────────────────────────────────────────────────────────────
const T0 = performance.now();
const [kohaku, showa, lotus, lanternG] = await Promise.all(loads);
await Promise.all(texLoads);
const T1 = performance.now();
{
  const m = lanternG.scene;
  normalize(m, LANTERN_H, { axis: 'y' });
  prepModel(m, renderer, { env: 0.8, onMat: mat => patchUnder(mat, { key: 'lantern' }) });
  lanternGroup.add(m);
}
normalize(lotus.scene, 1.0);
prepModel(lotus.scene, renderer, { env: 1.0, onMat: mat => { patchFloat(mat, 'lotus'); patchUnder(mat, { key: 'lotus' }); } });
const protos = { kohaku: koiPrototype(kohaku), showa: koiPrototype(showa) };
const T2 = performance.now();
school = new School({ protos, specs: KOI, env: { avoid: rocks.avoid } });
for (const f of school.fish) {
  f.mesh.material.envMapIntensity = 0.9;
  under.add(f.mesh);
}
flora = new Flora({ renderer, scene, under, lotusGltf: lotus, sim });
{ const nt = fbmTexture(renderer, { size: 512, scale: 5, octaves: 5, contrast: 1.3 }); for (const m of flora.mist) { m.material.uniforms.uNoise.value = nt; reflection.hidden.push(m); } }
engine.onResize((w, h, dpr) => { flora.fireMat.uniforms.uDpr.value = dpr; flora.snowMat.uniforms.uDpr.value = dpr; });
branch = new MapleBranch({ renderer, scene, under, leafTex: flora.leafTex, leafGeo: flora.leafGeo });
patchUnder(flora.pads.material, { key: 'pad' });
patchUnder(flora.leaves.material, { key: 'leaf' });
measure();
applyLook(LOOK.day);
// warm up: one sim step + both passes compiled before the loader goes
sim.step(1 / 60);
renderer.compile(under, camera);
renderer.compile(scene, camera);
const T3 = performance.now();
if (DBG.has('debug')) console.info('[koi] boot', { sinceNav: Math.round(T0), load: Math.round(T1 - T0), protos: Math.round(T2 - T1), compile: Math.round(T3 - T2) });
engine.start();
await loader.finish();
if (DBG.has('nointro')) intro.v = 0;
gsap.to(intro, { v: 0, duration: 3.4, ease: 'power3.inOut' });
setTimeout(() => { sim.drop(0.4, 0.4, 0.16, 0.03); plop(0.6, 0.6); }, 900);
gsap.from('.title .line', { yPercent: 110, opacity: 0, duration: 2.0, ease: 'expo.out', stagger: 0.14, delay: 1.1 });
gsap.from('.hero .eyebrow, .hero .sub, .hero-cta, .nav, .scroll-cue', { opacity: 0, y: 16, duration: 1.6, ease: 'power3.out', stagger: 0.07, delay: 1.5 });
setTimeout(() => document.body.classList.add('ready'), 900);
window.__koi = { school, flora, sim, look: LOOK, STATIONS, feed, protos, get anchors() { return anchors; }, camera, W, underShared, engine };
