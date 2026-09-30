import { Engine, THREE, normalize, prepModel, damp, clamp, smooth, lerp, studioEnvironment } from '../../src/core/engine.js';
import { Assets } from '../../src/core/assets.js';
import { Pointer } from '../../src/core/input.js';
import { smoothScroll, gsap, reveal } from '../../src/core/scroll.js';
import { preloader, cursor, magnetic, worldNav } from '../../src/core/ui.js';
import { PlanarReflection } from '../../src/core/reflector.js';
import { DepthOfFieldEffect, BrightnessContrastEffect, HueSaturationEffect } from 'postprocessing';
import { buildSet, windowCookie, COUNTER } from './set.js';
import { Patisserie, TYPES, FLAVOURS } from './pastry.js';
import { Coffret } from './coffret.js';
import { Dust, Marks } from './fx.js';
import { Foley } from './sound.js';

const DBG = new URLSearchParams(location.search);
const isTouch = matchMedia('(pointer: coarse)').matches;
const CAKE_POS = new THREE.Vector3(2.7, 0, -0.9);
const PILE = { x: 2.3, z: 1.75 };
const BOX_POS = new THREE.Vector3(11.2, 0, 1.15);

// ─── Engine ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gl');
let dof;
const engine = new Engine({
  canvas, fov: 30, near: 0.1, far: 120, dpr: 1.5, background: 0xf3d3da,
  post: {
    ao: { aoRadius: 0.55, intensity: 2.4, distanceFalloff: 0.6 },
    bloom: { intensity: 0.32, luminanceThreshold: 0.92, luminanceSmoothing: 0.25, radius: 0.7 },
    pre: cam => (DBG.has('nodof') ? [] : [(dof = new DepthOfFieldEffect(cam, { focusDistance: 12, focusRange: 6, bokehScale: 1.4, resolutionScale: 0.5 }))]),
    tone: 'neutral',
    extra: () => [new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.09 }), new HueSaturationEffect({ saturation: -0.04 })],
    vignette: { offset: 0.34, darkness: 0.36 },
    noise: 0.035,
    ca: 0.0005,
  },
});
const { scene, camera, renderer } = engine;
renderer.shadowMap.type = THREE.PCFShadowMap;
scene.environment = studioEnvironment(renderer, {
  top: 0xf6e4e6, bottom: 0xb98f98,
  panels: [
    { pos: [-8, 7, 6], size: [5, 7], intensity: 5.5, color: 0xfff4e8 },   // the window
    { pos: [0, 10, 2], size: [8, 3], intensity: 2.2, color: 0xffffff },   // ceiling bounce
    { pos: [8, 4, -5], size: [2.5, 6], intensity: 2.6, color: 0xffe6ec }, // rim card
    { pos: [4, 2, 9], size: [6, 3], intensity: 1.4, color: 0xffeef0 },    // front fill card
  ],
});
scene.environmentIntensity = 0.36;
scene.fog = new THREE.Fog(0xf3d3da, 40, 95);

const assets = new Assets();
const foley = new Foley();
const soundBtn = document.querySelector('.sound');
soundBtn.addEventListener('click', () => { foley.enable(!foley.on); soundBtn.setAttribute('aria-pressed', String(foley.on)); soundBtn.querySelector('span').textContent = foley.on ? 'Sound on' : 'Sound'; });
const pointer = new Pointer({ lambda: 8 });
const loaderEl = document.querySelector('.loader');
const loader = preloader({
  assets, el: loaderEl, minTime: 1500,
  onValue: v => {
    loaderEl.querySelector('.loader-pct').textContent = Math.round(v * 100);
    loaderEl.style.setProperty('--p', v.toFixed(3));
  },
  exit: async () => {
    await gsap.timeline()
      .to('.loader-mac, .loader-line, .loader-g', { y: -18, opacity: 0, duration: 0.5, ease: 'power2.in', stagger: 0.05 })
      .to(loaderEl, { yPercent: -100, duration: 1.1, ease: 'expo.inOut' }, '-=0.1');
  },
});

// ─── Lights: window key with a cookie, rim card, soft fill ────────────────────
const key = new THREE.SpotLight(0xfff4ea, 5.6, 0, 0.5, 0.3, 0);
key.position.set(-12, 17.5, 15.5);
key.target.position.set(4.5, 0, -0.5);
key.map = windowCookie();
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
key.shadow.camera.near = 12; key.shadow.camera.far = 60;
key.shadow.bias = -0.00012; key.shadow.normalBias = 0.02;
key.shadow.radius = 5;
key.shadow.blurSamples = 16;
scene.add(key, key.target);
const rim = new THREE.SpotLight(0xffe4ea, 60, 26, 0.6, 0.8, 1.2);
rim.position.set(7, 11, -2.6);
rim.target.position.set(2, 1.5, 0.5);
scene.add(rim, rim.target);
const hemi = new THREE.HemisphereLight(0xfff3f1, 0xd8a9b3, 0.16);
scene.add(hemi);
// Beauty light: a soft warm pool on the cake, the way a cover shoot would flag the subject.
const beauty = new THREE.SpotLight(0xfff0e4, 70, 30, 0.2, 0.9, 1.4);
beauty.position.set(-1.5, 12, 9);
beauty.target.position.set(2.7, 2.2, -0.9);
scene.add(beauty, beauty.target);

// ─── Set ───────────────────────────────────────────────────────────────────────
const set = buildSet(renderer, scene);
const reflection = new PlanarReflection(renderer, { resolution: 0.5 });
reflection.hidden.push(set.top);
if (!DBG.has('norefl')) reflection.patch(set.marble, { strength: 0.9, distort: 0.004, lodScale: 5.5, lodBias: 0.2, f0: 0.045 });
engine.onResize((w, h, dpr) => reflection.setSize(w, h, dpr));

// ─── Physics & pastries ───────────────────────────────────────────────────────
const pat = new Patisserie(scene);
const physicsReady = pat.init();
const dust = new Dust(scene);
const marks = new Marks(scene);

const typeLoads = TYPES.map(def => Promise.all([assets.gltf(def.file), assets.gltf(def.shadow).catch(() => null)]).then(([g, s]) => ({ def, g, s })));
let cake, cakeSpin = { v: 0.14 };
const cakeLoad = assets.gltf('models/sucre/cake.glb').then(g => {
  const m = g.scene;
  normalize(m, 4.3, { axis: 'y' });
  prepModel(m, renderer, { env: 0.9, onMat: mat => warmFrosting(mat) });
  cake = new THREE.Group();
  cake.position.copy(CAKE_POS);
  cake.add(m);
  scene.add(cake);
  m.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(m);
  if (DBG.has('log')) console.log('cake bb', bb.min.toArray(), bb.max.toArray());
});

// The model's buttercream bakes out grey-beige; warm the pale, unsaturated texels (frosting, ruffles, sugar roses)
// toward the pink cream of the reference plate. Berries, leaves and gold leaf are saturated and stay as they are;
// the porcelain stand (below the first tier) stays white.
function warmFrosting(mat) {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCakeY;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCakeY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCakeY;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 s = pow(max(diffuseColor.rgb, 0.0), vec3(1.0 / 2.2));
          float lum = dot(s, vec3(0.299, 0.587, 0.114));
          float sat = max(s.r, max(s.g, s.b)) - min(s.r, min(s.g, s.b));
          float m = smoothstep(0.24, 0.5, lum) * (1.0 - smoothstep(0.12, 0.28, sat)) * smoothstep(1.02, 1.2, vCakeY);
          vec3 cream = vec3(1.0, 0.905, 0.865) * min(1.0, lum * 1.2 + 0.07);
          diffuseColor.rgb = pow(mix(s, cream, m * 0.92), vec3(2.2));
        }`);
  };
  mat.customProgramCacheKey = () => 'sucre-cake-cream';
  mat.needsUpdate = true;
}

// ─── Coffret UI ───────────────────────────────────────────────────────────────
const toastEl = document.querySelector('.toast');
let toastTimer;
function toast(msg, ms = 2600) {
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms);
}
const slotsEl = [...document.querySelectorAll('.slots li')];
const countEl = document.querySelector('.box-count .n');
const statusEl = document.querySelector('.box-status');
const flavEl = document.querySelector('.box-flavours');
const orderBtn = document.querySelector('.order-btn');
const coffretEl = document.querySelector('.coffret');
let lastFilled = 0;
function renderBox(s) {
  slotsEl.forEach((li, i) => {
    const f = s.slots[i];
    li.classList.toggle('on', !!f);
    li.style.setProperty('--c', f ? FLAVOURS[f].css : 'transparent');
    li.title = f ? FLAVOURS[f].name : 'Empty';
  });
  countEl.textContent = s.filled;
  statusEl.textContent = s.closed ? '— tied with a ribbon, ready for you' : s.filled === 0 ? '— the box is waiting' : s.filled < 6 ? `— ${6 - s.filled} more to go` : '— closing the lid…';
  const tally = {};
  s.slots.forEach(f => { if (f) tally[f] = (tally[f] || 0) + 1; });
  flavEl.textContent = Object.entries(tally).map(([f, n]) => `${n} ${FLAVOURS[f].name}`).join(' · ') || 'Pick a flavour. Any flavour.';
  const ready = s.closed && !s.busy;
  orderBtn.setAttribute('aria-disabled', s.closed ? 'false' : 'true');
  orderBtn.classList.toggle('ready', ready);
  coffretEl.classList.toggle('is-closed', ready);
  if (s.closed && !s.busy && lastFilled !== 7) { toast('Tied with a ribbon. Your coffret is ready — €24.', 3200); lastFilled = 7; }
  else if (!s.closed) lastFilled = s.filled;
}

// ─── Camera choreography ──────────────────────────────────────────────────────
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const KEYS = {
  hero:    { pos: V(0.3, 2.75, 13.2), look: V(1.05, 2.05, 0), fov: 30, focus: V(2.7, 1.8, 0), range: 7, bokeh: 1.2, subject: V(2.7, 1.6, 0), m: { pos: V(2.4, 5.6, 19.5), look: V(2.45, 4.25, 0) } },
  carte:   { pos: V(0.1, 1.2, 9.3), look: V(1.25, 0.85, 1.2), fov: 22, focus: V(2.0, 0.3, 2.1), range: 2.2, bokeh: 3.2, subject: V(2.3, 0.6, 1.6), m: { pos: V(2.2, 3.0, 15.5), look: V(2.35, -0.35, 1.5) } },
  box:     { pos: V(11.9, 7.5, 6.0), look: V(10.2, 0, 1.15), fov: 30, focus: V(11.2, 0.2, 1.2), range: 8, bokeh: 0.8, subject: V(11.2, 0.3, 1.2), m: { pos: V(11.2, 14.5, 10.4), look: V(11.2, 0, 3.7) } },
  atelier: { pos: V(9.6, 2.5, 8.4), look: V(4.3, 2.3, -2.1), fov: 28, focus: V(2.7, 2.0, -0.9), range: 5, bokeh: 1.6, subject: V(2.7, 2.1, -0.9), m: { pos: V(7.4, 3.9, 15), look: V(2.8, 0.6, -0.9) } },
  visit:   { pos: V(9.2, 6.1, 19.5), look: V(7.2, 2.3, 0.4), fov: 30, focus: V(6.5, 0.8, 1), range: 14, bokeh: 0.8, subject: V(6, 0.8, 0.6) },
};
const stages = [...document.querySelectorAll('[data-cam]')].map(el => ({ el, key: KEYS[el.dataset.cam], name: el.dataset.cam, a: 0, b: 0 }));
function measure() {
  for (const s of stages) {
    const r = s.el.getBoundingClientRect();
    s.a = r.top + scrollY;
    s.b = Math.max(s.a, s.a + r.height - innerHeight);
  }
}
addEventListener('resize', measure);
const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 30, focus: 12, range: 6, bokeh: 1 };
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
function keyFrame(k, out) {
  // Portrait screens: back off along the view line and centre on the subject.
  const asp = camera.aspect;
  out.look.copy(k.look); out.pos.copy(k.pos);
  if (asp < 0.8 && k.m) { out.look.copy(k.m.look); out.pos.copy(k.m.pos); }
  else if (asp < 1) {
    out.look.lerp(k.subject, 0.85);
    tmpC.subVectors(k.pos, k.look);
    out.pos.copy(out.look).addScaledVector(tmpC, Math.pow(1 / asp, 0.62));
  }
  out.fov = k.fov; out.range = k.range; out.bokeh = k.bokeh;
  out.focus = out.pos.distanceTo(k.focus);
  return out;
}
const kfA = { pos: new THREE.Vector3(), look: new THREE.Vector3() }, kfB = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
let stageIdx = 0, stageF = 0;
function sampleCamera(y, out) {
  let i = 0;
  while (i < stages.length - 1 && y > stages[i].b) i++;
  // y is in (stages[i-1].b, stages[i].a] → transition from i-1 to i; else holding at i
  if (i > 0 && y < stages[i].a) {
    const A = stages[i - 1], B = stages[i];
    const f = easeIO(clamp((y - A.b) / (B.a - A.b)));
    keyFrame(A.key, kfA); keyFrame(B.key, kfB);
    out.pos.lerpVectors(kfA.pos, kfB.pos, f);
    out.look.lerpVectors(kfA.look, kfB.look, f);
    out.pos.y += Math.sin(f * Math.PI) * 0.9;
    out.fov = lerp(kfA.fov, kfB.fov, f); out.focus = lerp(kfA.focus, kfB.focus, f);
    out.range = lerp(kfA.range, kfB.range, f); out.bokeh = lerp(kfA.bokeh, kfB.bokeh, f);
    stageIdx = f < 0.5 ? i - 1 : i; stageF = f;
  } else {
    keyFrame(stages[i].key, out);
    stageIdx = i; stageF = 1;
  }
  return out;
}
const camTarget = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 30, focus: 12, range: 6, bokeh: 1 };

// ─── Pointer: fingertip, pick-up & toss, knock ────────────────────────────────
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane();
const hit = new THREE.Vector3();
const CURSOR_Y = 0.3;
let overCanvas = false, dragging = null, downAt = null, hoverE = null;
const dragPlane = new THREE.Plane();
let cur = null;
function rayFrom(px, py) {
  ndc.set(px / innerWidth * 2 - 1, -(py / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray;
}
function counterHit(r, y = CURSOR_Y, out = hit) {
  plane.set(tmpA.set(0, 1, 0), -y);
  return r.intersectPlane(plane, out);
}
function pickAt(px, py) {
  const r = rayFrom(px, py);
  return pat.pick(r.origin, r.direction);
}
addEventListener('pointermove', e => { overCanvas = e.target === canvas; }, { passive: true });
canvas.addEventListener('pointerleave', () => { overCanvas = false; });
canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !started) return;
  const p = pickAt(e.clientX, e.clientY);
  downAt = { x: e.clientX, y: e.clientY, t: performance.now(), pick: p };
  if (p) startDrag(p.e);
  else rainHold = { t0: engine.time, next: 0, n: 0 };
});
// Hold on the marble: pastries rain onto that spot, borrowed from wherever the camera is not looking.
let rainHold = null;
const frustum = new THREE.Frustum(), projM = new THREE.Matrix4(), sph = new THREE.Sphere();
function inView(e) { sph.center.copy(pat.pos(e, sph.center)); sph.radius = 0.4; return frustum.intersectsSphere(sph); }
function updateRainHold(t) {
  if (!rainHold) return;
  if (!pointer.down || !downAt || Math.hypot(pointer.px - downAt.x, pointer.py - downAt.y) > 14) { if (!pointer.down) rainHold = null; return; }
  if (t - rainHold.t0 < 0.32 || t < rainHold.next) return;
  if (!counterHit(ray.ray, 0, tmpC)) return;
  const burst = rainHold.n < 3 ? 2 : 1;
  rainHold.n++;
  rainHold.next = t + 0.075;
  projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projM);
  pat.rain({ x: tmpC.x, z: tmpC.z, rx: 0.32, rz: 0.32, count: burst, over: 0.05, height: [6, 7.5], vy: -6,
    pick: e => e.state === 'live' || e.state === 'parked', prefer: e => !inView(e) });
  if (rainHold.n === 1) { document.body.classList.add('is-raining'); hintUsed(); }
}
// On touch screens, touching a pastry holds it instead of scrolling the page.
canvas.addEventListener('touchstart', e => {
  const t = e.touches[0];
  if (t && started && pickAt(t.clientX, t.clientY)) e.preventDefault();
}, { passive: false });
const lift = { v: 0 };
let dragT0 = 0;
function startDrag(e) {
  pat.grab(e);
  pat.holdActive = false;
  dragT0 = engine.time;
  dragging = e;
  const p = pat.pos(e);
  const fwd = camera.getWorldDirection(tmpB);
  // Looking down at the counter: drag on a raised horizontal plane. Looking across it: on an upright plane.
  if (Math.abs(fwd.y) > 0.5) dragPlane.set(tmpA.set(0, 1, 0), -(Math.max(p.y, 0.3) + 1.1));
  else { tmpA.set(-fwd.x, 0, -fwd.z).normalize(); dragPlane.setFromNormalAndCoplanarPoint(tmpA, p); }
  lift.v = 0;
  gsap.to(lift, { v: 1, duration: 0.35, ease: 'power2.out' });
  cur?.set('drag', 'Toss');
  document.body.classList.add('is-dragging');
  hintUsed();
}
addEventListener('pointerup', e => {
  const tap = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 8 && performance.now() - downAt.t < 380;
  if (rainHold) { rainHold = null; document.body.classList.remove('is-raining'); }
  if (dragging) {
    const e2 = pat.release();
    if (e2 && coffret && !tap) coffret.releasedOver(e2);
    dragging = null;
    document.body.classList.remove('is-dragging');
    cur?.set('');
  }
  if (tap && (e.target === canvas || downAt.pick)) {
    // A tap is a knuckle on the marble; on a pastry, it knocks right beneath it.
    const r = rayFrom(e.clientX, e.clientY);
    if (downAt.pick) knockAt(pat.pos(downAt.pick.e, tmpC).setY(0).clone());
    else if (counterHit(r, 0, tmpC)) knockAt(tmpC.clone());
  }
  downAt = null;
});
function knockAt(p) {
  pat.knock(p);
  foley.knock();
  marks.ripple(p, engine.time);
  dust.emit(p, 26, { spread: 0.12, speed: 2.6, up: 0.9, size: 0.09, life: 1.1, time: engine.time });
  hintUsed();
}
let hintDone = false;
function hintUsed() {
  if (hintDone) return;
  hintDone = true;
  setTimeout(() => document.querySelector('.hint')?.classList.add('used'), 2500);
}

// ─── Menu hover: the line you hover stands up on the counter ──────────────────
const hopPick = {
  tart: e => e.T.def.key === 'tart', croissant: e => e.T.def.key === 'croissant', berry: e => e.T.def.key === 'berry',
};
let lastHop = {};
document.querySelectorAll('[data-hop]').forEach(li => {
  const k = li.dataset.hop;
  li.addEventListener('pointerenter', () => {
    if (!started || engine.time - (lastHop[k] ?? -9) < 0.9) return;
    lastHop[k] = engine.time;
    if (k === 'cake') {
      gsap.timeline().to(cakeSpin, { v: 7, duration: 0.5, ease: 'power2.in' }).to(cakeSpin, { v: 0.14, duration: 1.6, ease: 'power3.out' });
      pat.hop(() => true, { strength: 0.45, spread: 0.5 });
      return;
    }
    const pick = hopPick[k] ?? (e => e.flavour === k);
    const n = pat.hop(pick, { strength: 1, spread: 0.3 });
    if (n === 0) {
      const src = k in hopPick ? { tart: 'tart', croissant: 'croissant', berry: 'berry' }[k] : null;
      pat.rain({ x: PILE.x - 0.5, z: PILE.z, rx: 1.4, rz: 0.8, count: 4, over: 0.6, height: [5, 7], pick: src ? e => e.T.def.key === src : e => e.flavour === k });
    }
  });
});

// ─── Frame loop ────────────────────────────────────────────────────────────────
const footEl = document.querySelector('.foot');
const navLinks = [...document.querySelectorAll('.links a')];
let started = false, coffret = null;
const visited = new Set();
let impactsThisFrame = 0;
pat.onImpact = (e, tr, sp) => {
  const k = e.T.def.key;
  foley.land(k, sp);
  if (impactsThisFrame++ > 6 || sp < 7) return;
  const n = Math.round(clamp((sp - 6) * 0.9, 2, 9));
  const col = k === 'croissant' ? [[0.86, 0.6, 0.32], [0.95, 0.78, 0.5], [0.7, 0.44, 0.2]] : k === 'tart' ? [0.99, 0.975, 0.96] : [1, 0.985, 0.975];
  dust.emit({ x: tr.x, y: Math.max(0.02, tr.y - e.T.hy), z: tr.z }, k === 'croissant' ? n * 2 : n, {
    spread: 0.18, speed: 1.4 + sp * 0.08, up: 0.6, size: k === 'croissant' ? 0.035 : 0.06, life: k === 'croissant' ? 1.0 : 1.2,
    color: k === 'croissant' ? col : [0.86, 0.84, 0.83], gravity: k === 'croissant' ? 9 : 0.2, time: engine.time,
  });
};
pat.onLost = e => {
  // A pastry fell off the counter: it comes back as rain where the camera is looking.
  if (!started) return;
  const z = stageZone();
  pat.rain({ x: z.x, z: z.z, rx: z.rx, rz: z.rz, count: 1, over: 0, delay: 0.6 + Math.random(), pick: x => x === e, avoid: z.avoid });
};
function stageZone() {
  const n = stages[stageIdx]?.name;
  if (n === 'box') return { x: BOX_POS.x + 0.2, z: BOX_POS.z + 0.5, rx: 2.3, rz: 1.35, avoid: (x, z) => coffret?.over(tmpA.set(x, 0, z), 0.3) || x < BOX_POS.x - 2.2 };
  if (n === 'visit') return { x: 6.5, z: 1.6, rx: 6, rz: 1.5 };
  return { x: PILE.x, z: PILE.z, rx: 2.4, rz: 1.3 };
}
function onStage(name) {
  if (!started) return;
  navLinks.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + ({ hero: 'top', carte: 'carte', box: 'coffret', atelier: 'atelier', visit: 'visit' }[name])));
  if (visited.has(name)) return;
  visited.add(name);
  if (name === 'box') {
    const macs = e => (e.T.def.key === 'macA' || e.T.def.key === 'macB');
    const z = stageZone();
    pat.rain({ x: z.x, z: z.z, rx: 2.4, rz: 1.25, count: 16, over: 1.6, delay: 0.25, pick: e => macs(e) && e.state !== 'boxed', avoid: z.avoid, height: [9, 13] });
    pat.rain({ x: z.x + 1.2, z: z.z, rx: 2.4, rz: 1.1, count: 5, over: 1.4, delay: 0.6, pick: e => e.T.def.key === 'berry', avoid: z.avoid, height: [9, 12] });
  }
  if (name === 'visit') {
    pat.rain({ x: 6.2, z: 1.9, rx: 5.5, rz: 1.4, count: 26, over: 2.4, delay: 0.3, pick: e => e.state !== 'boxed', height: [10, 15], avoid: (x, z) => coffret?.over(tmpA.set(x, 0, z), 0.3) });
  }
}
let lastStage = -1;

engine.onTick((dt, t) => {
  pointer.update(dt);
  impactsThisFrame = 0;

  // Camera from scroll, with a little hand-held float and pointer parallax.
  sampleCamera(scrollY, camTarget);
  const k = 1 - Math.exp(-6 * dt);
  cam.pos.lerp(camTarget.pos, k); cam.look.lerp(camTarget.look, k);
  cam.fov = lerp(cam.fov, camTarget.fov, k); cam.focus = lerp(cam.focus, camTarget.focus, k);
  cam.range = lerp(cam.range, camTarget.range, k); cam.bokeh = lerp(cam.bokeh, camTarget.bokeh, k);
  const par = dragging ? 0 : 1;
  camera.position.copy(cam.pos).add(tmpA.set(pointer.sx * 0.22 * par + Math.sin(t * 0.3) * 0.03, pointer.sy * 0.1 * par + Math.sin(t * 0.47) * 0.02, 0));
  camera.lookAt(cam.look);
  if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  if (dof) {
    dof.cocMaterial.focusDistance = cam.focus;
    dof.cocMaterial.focusRange = cam.range;
    dof.bokehScale = cam.bokeh;
  }
  if (stageIdx !== lastStage) { lastStage = stageIdx; onStage(stages[stageIdx].name); }

  // Pointer → fingertip on the counter, hover pick, drag target.
  const r = ray.ray;
  ndc.set(pointer.x, pointer.y);
  ray.setFromCamera(ndc, camera);
  let tipP = null;
  if (started) {
    if (dragging) {
      if (!pat.holdActive && downAt && (Math.hypot(pointer.px - downAt.x, pointer.py - downAt.y) > 7 || t - dragT0 > 0.2)) pat.holdActive = true;
      if (r.intersectPlane(dragPlane, tmpB)) {
        if (dragPlane.normal.y < 0.5) tmpB.y += lift.v * 0.6;
        tmpB.y = clamp(tmpB.y, 0.35, 7);
        tmpB.x = clamp(tmpB.x, COUNTER.x0 + 0.5, COUNTER.x1 - 0.5);
        tmpB.z = clamp(tmpB.z, COUNTER.z0 + 0.4, COUNTER.z1 + 0.6);
        pat.holdTarget.copy(tmpB);
      }
      tipP = pat.pos(dragging, tmpC); tipP.y = 0;
      marks.tipAt(tipP, true, true, dt);
    } else {
      const onC = overCanvas && pointer.active && !isTouch;
      if (onC && counterHit(r)) {
        pat.setCursor(hit, true);
        tipP = hit;
      } else pat.setCursor(null, false);
      // Hover label over pastries (cheap Rapier ray).
      const h = onC ? pat.pick(r.origin, r.direction) : null;
      const he = h?.e ?? null;
      if (he !== hoverE) { hoverE = he; cur?.set(he ? 'drag' : '', he ? 'Pick up' : ''); }
      marks.tipAt(tipP, onC && !he, pointer.down, dt);
    }
  }

  // Cake turns on its stand (kinematic, so anything resting on a tier turns with it).
  if (pat.cake) {
    pat.cake.setAngvel({ x: 0, y: cakeSpin.v, z: 0 }, true);
    const q = pat.cake.rotation();
    cake?.quaternion.set(q.x, q.y, q.z, q.w);
  }
  if (started) {
    updateRainHold(t);
    pat.update(dt);
    coffret?.update(dt);
  }
  dust.update(t, engine.size.h * engine.size.dpr, camera.fov);
  marks.update(t);

  if (!DBG.has('norefl')) reflection.update(scene, camera);
  engine.paused = footEl.getBoundingClientRect().top <= 0;
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
worldNav('sucre', { theme: 'light', corner: 'bl' });
cur = cursor({ color: '#45202b', blend: 'normal', size: 32 });
magnetic();
const lenis = smoothScroll({ lerp: 0.085 });
// Split the gravity words into letters that will fall into place.
document.querySelectorAll('.grav').forEach(el => {
  el.innerHTML = el.textContent.split(' ').map(w => `<span class="w">${[...w].map(c => `<span class="ch">${c}</span>`).join('')}</span>`).join(' ');
});
reveal('.stage h2', { type: 'lines', stagger: 0.08 });
reveal('.atelier .lede', { type: 'lines', stagger: 0.05, y: '100%' });

document.querySelector('.fill-btn').addEventListener('click', () => coffret?.fillForMe());
document.querySelector('.reset-btn').addEventListener('click', () => coffret?.reset());
document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
  const id = a.getAttribute('href');
  const el = id === '#top' ? document.body : document.querySelector(id);
  if (!el) return;
  e.preventDefault();
  lenis.scrollTo(id === '#top' ? 0 : el, { duration: 2.2, easing: t => 1 - Math.pow(1 - t, 4) });
}));

const [types] = await Promise.all([Promise.all(typeLoads), physicsReady, cakeLoad, document.fonts.ready]);
await Promise.all([document.fonts.load('italic 500 80px "Playfair Display"'), document.fonts.load('600 20px "DM Sans"')]).catch(() => {});
for (const { def, g, s } of types) pat.addType(def, g, s);
if (DBG.has('log')) for (const k in pat.types) console.log(k, pat.types[k].dim.toArray().map(v => v.toFixed(3)).join(','), 'hy', pat.types[k].hy.toFixed(3));
// Cake colliders: stand, plate and three tiers (measured from the model's proportions).
pat.addCake(CAKE_POS, [
  { y: 0, h: 0.7, r: 0.5 }, { y: 0.7, h: 0.4, r: 1.28 }, { y: 1.1, h: 0.82, r: 0.9 }, { y: 1.92, h: 0.84, r: 0.74 }, { y: 2.76, h: 0.9, r: 0.56 },
]);
coffret = new Coffret({ scene, renderer, pat, pos: BOX_POS, onChange: renderBox, toast });
coffret.onTied = () => foley.chime();
coffret.onLand = (e, p) => (foley.land('macA', 14), dust.emit({ x: p.x, y: 0.1, z: p.z }, 10, { spread: 0.2, speed: 1.2, up: 0.5, size: 0.06, life: 0.9, time: engine.time }));
coffret.onThud = () => {
  foley.paper();
  const p = coffret.pos;
  dust.emit({ x: p.x, y: 0.5, z: p.z }, 70, { spread: 1.1, speed: 3.2, up: 3.2, size: 0.05, life: 2.2, gravity: 2.5, color: [[0.93, 0.8, 0.48], [0.99, 0.9, 0.62], [0.8, 0.62, 0.3]], time: engine.time });
  pat.knock(p, { radius: 3.2, strength: 0.55 });
};
measure();
sampleCamera(scrollY, cam);
camera.position.copy(cam.pos); camera.lookAt(cam.look);

// Warm up every program (pastries visible, dust alive) before the first frame.
for (const k in pat.types) { const T = pat.types[k]; for (const e of T.entries) T.im.setMatrixAt(e.i, new THREE.Matrix4().makeTranslation(PILE.x, 0.3, PILE.z)); T.im.instanceMatrix.needsUpdate = true; }
dust.emit(new THREE.Vector3(0, -50, 0), 4, { time: -100 });
renderer.compile(scene, camera);
for (const k in pat.types) { const T = pat.types[k]; for (const e of T.entries) T.im.setMatrixAt(e.i, new THREE.Matrix4().makeScale(0, 0, 0)); T.im.instanceMatrix.needsUpdate = true; }
engine.start();
window.__sucre = {
  pat, coffret, engine, knockAt, lenis,
  // QA helpers: screen position (0..1) of the live pastry of a kind nearest the screen centre.
  find(kind = 'macB') {
    let best = null, bd = 9;
    for (const e of pat.entries) {
      if (e.state !== 'live' || (e.T.def.key !== kind && e.flavour !== kind)) continue;
      const v = pat.pos(e).project(camera);
      const d = Math.hypot(v.x - 0.2, v.y + 0.3);
      if (Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 && d < bd) { bd = d; best = [(v.x + 1) / 2, (1 - v.y) / 2]; }
    }
    return best;
  },
  emptySpot(y = 0.82) {
    for (let x = 0.5; x < 0.95; x += 0.02) {
      const r = rayFrom(x * innerWidth, y * innerHeight);
      if (!pat.pick(r.origin, r.direction) && !pickAt(x * innerWidth + 30, y * innerHeight) && !pickAt(x * innerWidth - 30, y * innerHeight)) return [x, y];
    }
    return [0.3, 0.92];
  },
};
await loader.finish();
started = true;
lastStage = -1;
setTimeout(measure, 300);

// Intro: the title settles, then the pastries rain around the cake — a few land on its tiers.
const heroRain = () => {
  pat.rain({ x: PILE.x + 0.2, z: PILE.z, rx: 1.7, rz: 0.8, count: 30, over: 2.6, delay: 0.1, pick: e => e.T.def.key === 'macA' || e.T.def.key === 'macB', height: [7, 12] });
  pat.rain({ x: PILE.x + 0.3, z: PILE.z + 0.2, rx: 2.9, rz: 1.1, count: 12, over: 2.4, delay: 0.4, pick: e => e.T.def.key === 'macA' || e.T.def.key === 'macB', height: [7, 11] });
  pat.rain({ x: PILE.x + 0.4, z: PILE.z, rx: 2.0, rz: 0.9, count: 14, over: 2.2, delay: 0.3, pick: e => e.T.def.key === 'berry', height: [7, 11] });
  pat.rain({ x: PILE.x, z: PILE.z - 0.2, rx: 3.2, rz: 0.8, count: 3, over: 1.6, delay: 0.7, pick: e => e.T.def.key === 'croissant', height: [8, 10] });
  pat.rain({ x: PILE.x + 1.2, z: PILE.z + 0.3, rx: 2.4, rz: 0.6, count: 2, over: 1.2, delay: 1.1, pick: e => e.T.def.key === 'tart', height: [8, 10] });
  pat.rain({ x: CAKE_POS.x, z: CAKE_POS.z, rx: 0.5, rz: 0.4, count: 3, over: 1.4, delay: 0.9, pick: e => e.T.def.key === 'macA' || e.T.def.key === 'berry', height: [9, 11] });
};
if (!DBG.has('norain')) heroRain();
visited.add('hero');
gsap.from('.title .line:first-child', { yPercent: 60, opacity: 0, duration: 1.6, ease: 'expo.out', delay: 0.1 });
gsap.from('.grav .ch', { y: () => -innerHeight * (0.6 + Math.random() * 0.4), rotation: () => (Math.random() - 0.5) * 50, duration: 1.5, ease: 'bounce.out', stagger: { each: 0.045, from: 'random' }, delay: 0.5 });
gsap.from('.hero .eyebrow, .sub, .hero-cta, .hint li, .nav', { opacity: 0, y: 16, duration: 1.2, ease: 'power3.out', stagger: 0.06, delay: 1.0 });
