import { Engine, THREE, normalize, prepModel, damp, clamp, smooth, lerp, studioEnvironment } from '../../src/core/engine.js';
import { Assets } from '../../src/core/assets.js';
import { Pointer } from '../../src/core/input.js';
import { smoothScroll, gsap, reveal } from '../../src/core/scroll.js';
import { preloader, cursor, magnetic, worldNav } from '../../src/core/ui.js';
import { FogGlass, bellProfile } from './glass.js';
import { walnutMaterial, linenTextures, plasterTextures, WindowCookie, walnutBase, substrateLayers } from './set.js';

const Q = new URLSearchParams(location.search);
const MOBILE = matchMedia('(max-width: 760px)').matches;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ─── Engine ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gl');
const engine = new Engine({
  canvas, fov: 28, near: 0.05, far: 60, dpr: 1.5, background: 0xe7dfd0,
  post: {
    ao: { aoRadius: 0.32, intensity: 1.7, distanceFalloff: 0.55 },
    bloom: { intensity: 0.42, luminanceThreshold: 0.9, luminanceSmoothing: 0.25, radius: 0.62 },
    tone: 'neutral',
    vignette: { offset: 0.42, darkness: 0.34 },
    noise: 0.028,
    ca: 0.0005,
  },
});
const { scene, camera, renderer } = engine;
renderer.localClippingEnabled = true;

// A bright room: a four-pane window on the left (it shows up as a reflection on the glass), a warm ceiling, linen walls.
const panes = [[0.86, -0.72], [0.86, 0.72], [-0.86, -0.72], [-0.86, 0.72]].map(([dy, dz]) => ({ pos: [-9, 3.3 + dy, 1.4 + dz], size: [1.3, 1.6], intensity: 11, color: 0xfff2de }));
scene.environment = studioEnvironment(renderer, {
  top: 0xd6cdbd, bottom: 0x6e6252, blur: 0.02,
  panels: [...panes,
    { pos: [0, 9, 1], size: [7, 5], intensity: 1.3, color: 0xfff6ea },
    { pos: [9, 2.5, 2], size: [4, 5], intensity: 0.9, color: 0xf2ece2 },
    { pos: [1, 2.2, 10], size: [10, 4], intensity: 0.75, color: 0xf6efe4 }],
});
scene.environmentIntensity = 0.75;

const assets = new Assets();
const pointer = new Pointer({ lambda: 8 });
const loaderEl = document.querySelector('.loader');
const loader = preloader({
  assets, el: loaderEl, minTime: 1400,
  onValue: v => {
    loaderEl.querySelector('.loader-pct').textContent = Math.round(v * 100);
    loaderEl.style.setProperty('--p', v.toFixed(3));
  },
  exit: () => { startIntro(); return gsap.to(loaderEl, { '--r': '150vmax', duration: 1.7, ease: 'power2.in' }); },
});

// ─── The room ──────────────────────────────────────────────────────────────────
const cookie = new WindowCookie(renderer, 512);
const linen = linenTextures(renderer, { threads: 150, color: [0.9, 0.86, 0.78] });
for (const t of [linen.albedo, linen.normal]) t.repeat.set(34, 11);
const table = new THREE.Mesh(new THREE.PlaneGeometry(44, 13), new THREE.MeshStandardMaterial({
  map: linen.albedo, normalMap: linen.normal, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.94, envMapIntensity: 0.7,
}));
table.rotation.x = -Math.PI / 2; table.position.set(7, 0, 3.9); table.receiveShadow = true;
scene.add(table);
const plaster = plasterTextures(renderer);
for (const t of [plaster.albedo, plaster.normal]) t.repeat.set(6, 1.4);
const wall = new THREE.Mesh(new THREE.PlaneGeometry(44, 10), new THREE.MeshStandardMaterial({
  map: plaster.albedo, normalMap: plaster.normal, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.97, envMapIntensity: 0.6,
}));
wall.position.set(7, 5, -2.6); wall.receiveShadow = true;
scene.add(wall);

scene.add(new THREE.HemisphereLight(0xfaf5ec, 0xd6c8ae, 1.55));
const rim = new THREE.DirectionalLight(0xe4ecff, 0.55);
rim.position.set(4, 3.5, -4);
scene.add(rim, rim.target);

function windowLight(tx) {
  const s = new THREE.SpotLight(0xfff0d8, 3.6, 0, 0.42, 0.12, 0);
  s.map = cookie.texture;
  s.position.set(tx - 5.4, 4.7, 2.6);
  s.target.position.set(tx + 0.4, 0.2, -0.7);
  s.castShadow = !Q.has('noshadow');
  s.shadow.mapSize.set(2048, 2048);
  s.shadow.camera.near = 3; s.shadow.camera.far = 16;
  s.shadow.bias = -0.00025; s.shadow.normalBias = 0.02; s.shadow.radius = 5;
  scene.add(s, s.target);
  return s;
}
const sun = windowLight(0);
const SHOP_X = 7.4;
const shopSun = windowLight(SHOP_X);

// ─── The stage: walnut base, the world, the bell ──────────────────────────────
const clip = new THREE.Plane(V3(0, 1, 0), -0.16);
const walnut = walnutMaterial({ scale: 1.5, seed: 3 });
const profile = bellProfile();

const stage = new THREE.Group();
scene.add(stage);
const turntable = new THREE.Group();
stage.add(turntable);
const base = walnutBase(walnut);
turntable.add(base.mesh);
clip.constant = -base.top;
const hero = new FogGlass(renderer, profile, { res: MOBILE ? [1024, 512] : [2048, 1024] });
hero.group.position.y = base.grooveY;
stage.add(hero.group);

const CLIMATES = [
  { key: 'moss', file: 'models/terrarium/moss.glb', width: 1.1, yaw: -2.3, name: 'Moss Forest', no: '0412', fog: 1, fogMax: 1, streak: [0.07, 0.31], spore: [1.0, 0.96, 0.78], blink: 0, count: 55 },
  { key: 'desert', file: 'models/terrarium/desert.glb', width: 1.12, yaw: 0.25, name: 'High Desert', no: '0388', fog: 0.6, fogMax: 0.6, streak: [0.06, 0.24], spore: [1.0, 0.85, 0.55], blink: 0, count: 50 },
  { key: 'tropic', file: 'models/terrarium/tropic.glb', width: 1.08, yaw: 0.1, name: 'Cloud Tropic', no: '0431', fog: 1, fogMax: 0.6, streak: [0.13, 0.4], spore: [0.8, 1.0, 0.45], blink: 1, count: 46 },
];
const worlds = CLIMATES.map(() => { const h = new THREE.Group(); h.position.y = base.top; h.visible = false; turntable.add(h); return h; });
worlds[0].visible = true;

// Spores / fireflies inside the bell. Additive but in the opaque list, so the fogged glass blurs them properly.
const spores = (() => {
  const N = 140;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.46;
    pos.set([Math.cos(a) * r, 0.34 + Math.random() * 0.9, Math.sin(a) * r], i * 3);
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: false,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0.9, 1, 0.8) }, uBlink: { value: 0 }, uAlpha: { value: 0 }, uCount: { value: 90 }, uDpr: { value: 1 } },
    vertexShader: `attribute float seed; uniform float uTime, uBlink, uAlpha, uCount, uDpr; varying float vA;
      void main(){
        vec3 p = position; float t = uTime * (0.08 + seed * 0.1);
        p.x += sin(t * 2.3 + seed * 40.) * 0.07; p.z += cos(t * 1.9 + seed * 23.) * 0.07;
        p.y = 0.3 + mod(p.y - 0.3 + t * 0.12 * (1. - uBlink * .8), 0.95);
        float r = length(p.xz); if (r > 0.5) p.xz *= 0.5 / r;
        float edge = smoothstep(0.3, 0.42, p.y) * smoothstep(1.25, 1.05, p.y);
        float blink = mix(1., pow(0.5 + 0.5 * sin(uTime * (1.2 + seed * 1.6) + seed * 60.), 8.), uBlink);
        vA = edge * blink * uAlpha * step(seed * 140., uCount);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (7. + seed * 9.0 + uBlink * 6.) * uDpr * (3.2 / -mv.z);
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .0, d); a = a * a * (0.4 + 0.6 * a); gl_FragColor = vec4(uColor * a * vA * 3.4, 1.); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.renderOrder = 10;
  stage.add(pts);
  engine.onResize((w, h, dpr) => { mat.uniforms.uDpr.value = dpr; });
  return mat;
})();
function setSpores(i) {
  const c = CLIMATES[i];
  spores.uniforms.uColor.value.setRGB(...c.spore);
  spores.uniforms.uBlink.value = c.blink;
  spores.uniforms.uCount.value = c.count;
}
setSpores(0);

// Exploded substrate
const layers = substrateLayers(renderer, clip);
const LAYER_Y = { soil: 1.14, mesh: 0.87, charcoal: 0.57, stones: 0.25 };
const LAYER_T = { soil: [0.12, 0.55], mesh: [0.24, 0.66], charcoal: [0.36, 0.78], stones: [0.48, 0.9] };
for (const L of layers) { L.group.position.y = base.top - L.h - 0.02; stage.add(L.group); }
const WORLD_UP = 1.52;

// ─── Shop row: three bells on the same sill, further along ───────────────────
const SHOP = [
  { ci: 0, x: SHOP_X - 1.95, s: 0.8, yaw: -2.0 },
  { ci: 1, x: SHOP_X + 0.02, s: 1.0, yaw: 0.35 },
  { ci: 2, x: SHOP_X + 2.1, s: 1.2, yaw: -0.3 },
];
for (const st of SHOP) {
  st.group = new THREE.Group();
  st.group.position.set(st.x, 0, st.ci === 1 ? -0.1 : 0.05);
  st.group.scale.setScalar(st.s);
  scene.add(st.group);
  const b = new THREE.Mesh(base.mesh.geometry, walnut);
  b.castShadow = b.receiveShadow = true;
  b.rotation.y = st.ci * 2.1;
  st.group.add(b);
  st.holder = new THREE.Group(); st.holder.position.y = base.top; st.holder.rotation.y = st.yaw;
  st.group.add(st.holder);
  st.glass = new FogGlass(renderer, profile, { res: [1024, 512] });
  st.glass.group.position.y = base.grooveY;
  st.glass.ambientDrops = 0.3;
  st.glass.uniforms.uFogK.value = CLIMATES[st.ci].fog;
  st.glass.uniforms.uFogMax.value = CLIMATES[st.ci].fogMax;
  st.group.add(st.glass.group);
  st.glass.active = false;
}
const glasses = [hero, ...SHOP.map(s => s.glass)];
const glassShadow = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaHash: true, opacity: 0.22 });
for (const g of glasses) { g.mesh.castShadow = true; g.mesh.customDepthMaterial = glassShadow; }

// ─── Load worlds ───────────────────────────────────────────────────────────────
const loads = CLIMATES.map((c, i) => assets.gltf(c.file).then(g => {
  const m = g.scene;
  normalize(m, c.width, { axis: 'x' });
  prepModel(m, renderer, { env: 0.8 });
  const wrap = new THREE.Group(); wrap.rotation.y = c.yaw; wrap.add(m);
  // shop copies share geometry but not clipping
  for (const st of SHOP.filter(s => s.ci === i)) {
    const copy = m.clone(true);
    copy.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.clippingPlanes = null; } });
    st.holder.add(copy);
  }
  m.traverse(o => { if (o.isMesh) { o.material.clippingPlanes = [clip]; o.material.clipShadows = true; } });
  worlds[i].add(wrap);
}).catch(e => console.warn('world missing', c.key, e.message)));

// ─── Climate swaps ─────────────────────────────────────────────────────────────
const swap = { lift: 0, busy: false, cur: 0, want: 0, spin: 0 };
const tabs = [...document.querySelectorAll('.tab')];
const climCards = [...document.querySelectorAll('.clim')];
const heroLabel = document.querySelector('.hero-label');
function showClimate(i) {
  tabs.forEach((t, k) => { t.classList.toggle('on', k === i); t.setAttribute('aria-selected', k === i); });
  climCards.forEach((c, k) => c.classList.toggle('on', k === i));
  const c = CLIMATES[i];
  heroLabel.innerHTML = `<span>No. ${c.no}</span><span>${c.name}</span><span>Sealed 14 · 03 · 2026</span>`;
}
function requestClimate(i) {
  if (swap.want === i) return;
  swap.want = i;
  showClimate(i);
  if (!swap.busy) runSwap();
}
function runSwap() {
  const from = swap.cur, to = swap.want;
  if (from === to) return;
  swap.busy = true;
  const tl = gsap.timeline({ onComplete: () => { swap.busy = false; if (swap.want !== swap.cur) runSwap(); } });
  const spinTo = swap.spin + Math.PI;
  tl.to(swap, { lift: 1, duration: 0.85, ease: 'power2.inOut' })
    .to(swap, { spin: spinTo, duration: 1.7, ease: 'power3.inOut' }, 0.4)
    .to(worlds[from].position, { y: base.top - 0.98, duration: 0.72, ease: 'power2.in' }, 0.5)
    .add(() => {
      worlds[from].visible = false;
      worlds[to].visible = true; worlds[to].position.y = base.top - 0.98; worlds[to].rotation.y = -spinTo; // faces front when the base stops
      swap.cur = to; setSpores(to); hero.uniforms.uFogK.value = CLIMATES[to].fog; hero.uniforms.uFogMax.value = CLIMATES[to].fogMax;
    }, 1.22)
    .to(worlds[to].position, { y: base.top, duration: 0.9, ease: 'power3.out' }, 1.24)
    .to(swap, { lift: 0, duration: 0.95, ease: 'power2.inOut' }, 2.0);
}
tabs.forEach((t, i) => t.addEventListener('click', () => {
  const el = sections.climates;
  const y = el.offsetTop + (el.offsetHeight - innerHeight) * ((i + 0.5) / 3);
  window.__lenis?.scrollTo(y, { duration: 1.4 });
  requestClimate(i);
  manualUntil = performance.now() + 1600;
}));
let manualUntil = 0;

// ─── Scroll choreography ───────────────────────────────────────────────────────
const sections = Object.fromEntries([...document.querySelectorAll('[data-sec]')].map(el => [el.dataset.sec, el]));
sections.hero = document.querySelector('.hero');
const foot = document.querySelector('.foot');
const navEl = document.querySelector('.nav');
const navLinks = [...document.querySelectorAll('.links a')];
let navCur = null;
if (MOBILE) document.querySelector('.wipe-hint-text').textContent = 'Drag to wipe the glass';

// camera poses: position, target, vertical fov, lens shift (fraction of the frame, +x moves the subject right)
const P = (pos, look, fov, sx = 0, sy = 0, extra = {}) => ({ pos: V3(...pos), look: V3(...look), fov, sx, sy, ...extra });
const POSES = MOBILE ? {
  hero: P([0.8, 1.75, 8.4], [0, 0.82, 0], 34, 0, -0.1),
  clim: P([0.35, 1.5, 8.0], [0, 0.8, 0], 34, 0, -0.03),
  insideA: P([2.6, 2.8, 10.2], [0, 1.1, 0], 34, -0.17, 0.02),
  insideB: P([3.3, 3.2, 11.0], [0, 1.25, 0], 34, -0.2, 0.02),
  care: P([-1.5, 1.4, 8.4], [0, 0.8, 0], 34, 0, 0.14),
  careB: P([-0.8, 1.5, 8.6], [0, 0.8, 0], 34, 0, 0.14),
  shop: P([SHOP_X - 1.95, 1.45, 6.2], [SHOP_X - 1.95, 0.7, 0], 34, 0, 0.17),
  shopB: P([SHOP_X + 2.1, 1.75, 7.6], [SHOP_X + 2.1, 0.9, 0], 34, 0, 0.17),
  visit: P([SHOP_X + 5.4, 2.3, 6.2], [SHOP_X + 0.9, 0.72, -0.2], 34, 0, -0.14),
} : {
  hero: P([1.55, 1.5, 5.3], [0, 0.8, 0], 28, 0.17, 0.0),
  clim: P([0.4, 1.12, 5.25], [0, 0.8, 0], 28, 0.2, 0.0),
  insideA: P([2.3, 2.3, 7.4], [0, 1.0, 0], 28, 0.03, 0.0),
  insideB: P([3.0, 2.75, 7.9], [0, 1.24, 0], 28, 0.03, 0.0),
  care: P([-1.85, 1.05, 5.0], [0, 0.8, 0], 28, -0.2, 0.0),
  careB: P([-1.0, 1.15, 5.2], [0, 0.8, 0], 28, -0.2, 0.0),
  shop: P([SHOP_X, 1.7, 8.6], [SHOP_X, 0.95, 0], 28, 0, 0.075),
  shopB: P([SHOP_X + 0.6, 1.65, 8.5], [SHOP_X, 0.95, 0], 28, 0, 0.075),
  visit: P([SHOP_X + 5.0, 2.2, 5.6], [SHOP_X + 1.1, 0.72, -0.2], 30, 0.17, 0.02),
};
let KEYS = [];
function layout() {
  const vh = innerHeight;
  const top = el => el.getBoundingClientRect().top + scrollY;
  const s = sections;
  const cT = top(s.climates), cH = s.climates.offsetHeight;
  const iT = top(s.inside), iH = s.inside.offsetHeight;
  const kT = top(s.care), kH = s.care.offsetHeight;
  const sT = top(s.shop), sH = s.shop.offsetHeight;
  const vT = top(s.visit);
  const max = document.documentElement.scrollHeight - vh;
  const k = (y, pose, o = {}) => ({ y, pose: POSES[pose], explode: 0, lift: 0, day: 0.25, ...o });
  KEYS = [
    k(0, 'hero'),
    k(cT, 'clim'),
    k(cT + cH - vh, 'clim', { day: 0.25 }),
    k(iT, 'insideA'),
    k(iT + (iH - vh) * 0.62, 'insideB', { explode: 1, lift: 1 }),
    k(iT + iH - vh, 'insideB', { explode: 1, lift: 1 }),
    k(kT, 'care', { day: 0 }),
    k(kT + kH - vh, 'careB', { day: 1 }),
    k(sT, 'shop', { day: 0.3 }),
    k(sT + sH - vh, 'shopB', { day: 0.3 }),
    k(vT + s.visit.offsetHeight * 0.35, 'visit', { day: 0.3 }),
    k(max + 1, 'visit', { day: 0.3 }),
  ];
  // the lift during "inside" should happen before the layers separate
  KEYS[4].liftEarly = true;
}
const ST = { pos: V3(), look: V3(), fov: 28, sx: 0, sy: 0, explode: 0, lift: 0, day: 0.25 };
function sampleKeys(y) {
  let i = 0;
  while (i < KEYS.length - 2 && y > KEYS[i + 1].y) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const raw = clamp((y - a.y) / Math.max(1, b.y - a.y));
  const f = smooth(0, 1, raw);
  const out = {
    pos: V3().lerpVectors(a.pose.pos, b.pose.pos, f), look: V3().lerpVectors(a.pose.look, b.pose.look, f),
    fov: lerp(a.pose.fov, b.pose.fov, f), sx: lerp(a.pose.sx, b.pose.sx, f), sy: lerp(a.pose.sy, b.pose.sy, f),
    explode: lerp(a.explode, b.explode, raw), lift: lerp(a.lift, b.lift, b.liftEarly ? smooth(0, 0.35, raw) : raw), day: lerp(a.day, b.day, raw),
    seg: i, raw,
  };
  return out;
}

// ─── Wiping ────────────────────────────────────────────────────────────────────
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const wipeEl = document.querySelector('.wipe-cursor');
const hintEl = document.querySelector('.wipe-hint');
let lastHit = null;      // { glass, local }
let wiped = 0;           // metres the visitor has wiped (drives the hint)
let lastUserWipe = -99;
let pointerMoved = false;
let touchWipe = false;
const BRUSH = 0.1;
pointer.on('move', () => { pointerMoved = true; });
let cursorApi = null;

function castGlass(x, y) {
  ndc.set(x, y);
  ray.setFromCamera(ndc, camera);
  let best = null;
  for (const g of glasses) {
    if (!g.active || g.lifted) continue;
    const h = g.hit(ray);
    if (h && (!best || h.point.distanceToSquared(camera.position) < best.h.point.distanceToSquared(camera.position))) best = { g, h };
  }
  return best;
}
addEventListener('touchstart', e => {
  const t = e.touches[0];
  const hit = castGlass(t.clientX / innerWidth * 2 - 1, -(t.clientY / innerHeight) * 2 + 1);
  touchWipe = !!hit && !e.target.closest('a,button,input');
}, { passive: true });
addEventListener('touchmove', e => { if (touchWipe) e.preventDefault(); }, { passive: false });
addEventListener('touchend', () => { touchWipe = false; lastHit = null; });

// Ghost finger: draws a slow streak on the glass so the hero frame always shows the world through a wiped window.
const ghost = { on: false };
function ghostWipe(glass, { dur = 1.5, v0 = 0.36, v1 = 0.5, span = 0.2, delay = 0, wave = 0.05 } = {}) {
  const uc = glass.uFacing(camera.position);
  const st = { s: 0 };
  let prev = null;
  const R = BRUSH * 1.15;
  return gsap.to(st, {
    s: 1, duration: dur, delay, ease: 'power1.inOut',
    onStart: () => { ghost.on = true; },
    onUpdate: () => {
      const s = st.s;
      const u = uc + (s - 0.5) * span;
      const v = lerp(v0, v1, s) + Math.sin(s * Math.PI * 1.6 + 0.4) * wave;
      const p = profile.pos(((u % 1) + 1) % 1, v);
      glass.brush(prev ?? p, p, R, 1);
      prev = p;
    },
    onComplete: () => { ghost.on = false; },
  });
}

// ─── HTML anchored to 3D ──────────────────────────────────────────────────────
const labelEls = Object.fromEntries([...document.querySelectorAll('.layer-labels li')].map(li => [li.dataset.k, li]));
const productEls = [...document.querySelectorAll('.product')];
const careItems = [...document.querySelectorAll('.care-list li')];
const clockTime = document.querySelector('.clock-time'), clockNote = document.querySelector('.clock-note'), clockBar = document.querySelector('.clock');
const NOTES = [[0, 'The soil warms and the glass fogs over.'], [0.3, 'The sun climbs; the bell clears and the moss drinks.'],
  [0.62, 'Afternoon. Water rises as vapour, invisibly.'], [0.8, 'Evening. It rains on the inside.']];
const tmp = V3(), tmp2 = V3(), right = V3();
function project(v) { tmp.copy(v).project(camera); return [(tmp.x + 1) / 2 * innerWidth, (1 - tmp.y) / 2 * innerHeight, tmp.z]; }

// ─── Frame loop ────────────────────────────────────────────────────────────────
const cam = { pos: V3().copy(POSES.hero.pos), look: V3().copy(POSES.hero.look), fov: POSES.hero.fov, sx: POSES.hero.sx, sy: POSES.hero.sy };
const intro = { k: 0 };
const liftState = new Map(glasses.map(g => [g, { seated: true }]));
let dayS = 0.25, explodeS = 0, liftS = 0;
let scrollYS = 0;
let frameNo = 0;

engine.onTick((dt, t) => {
  pointer.update(dt);
  const y = window.__lenis ? window.__lenis.scroll : scrollY;
  scrollYS = y;
  const st = sampleKeys(y);

  // climate follows the scroll inside its section (tabs scroll there too)
  const cs = sections.climates;
  const cp = clamp((y - cs.offsetTop) / Math.max(1, cs.offsetHeight - innerHeight));
  const inClim = y >= cs.offsetTop - innerHeight * 0.5;
  const want = inClim ? Math.min(2, Math.floor(cp * 3 * 0.999)) : 0;
  if (performance.now() > manualUntil && KEYS.length) requestClimate(want);

  // camera
  const lam = 4.2;
  cam.pos.x = damp(cam.pos.x, st.pos.x, lam, dt); cam.pos.y = damp(cam.pos.y, st.pos.y, lam, dt); cam.pos.z = damp(cam.pos.z, st.pos.z, lam, dt);
  cam.look.x = damp(cam.look.x, st.look.x, lam, dt); cam.look.y = damp(cam.look.y, st.look.y, lam, dt); cam.look.z = damp(cam.look.z, st.look.z, lam, dt);
  cam.fov = damp(cam.fov, st.fov, lam, dt); cam.sx = damp(cam.sx, st.sx, lam, dt); cam.sy = damp(cam.sy, st.sy, lam, dt);
  const ik = 1 - intro.k;
  camera.position.copy(cam.pos).add(tmp.set(pointer.sx * 0.1 + Math.sin(t * 0.21) * 0.03, pointer.sy * 0.05 + Math.sin(t * 0.33) * 0.015 + ik * 0.35, ik * 0.9));
  camera.lookAt(tmp2.copy(cam.look).add(tmp.set(0, ik * 0.1, 0)));
  if (Math.abs(camera.fov - cam.fov) > 1e-3) { camera.fov = cam.fov; }
  const w = innerWidth, h = innerHeight;
  camera.setViewOffset(w, h, -cam.sx * w, cam.sy * h, w, h);

  // scene params
  explodeS = damp(explodeS, st.explode, 6, dt);
  liftS = damp(liftS, st.lift, 6, dt);
  dayS = damp(dayS, st.day, 5, dt);
  const e = explodeS;

  // bell lift: scroll (exploded view) or a climate swap
  const lift = Math.max(liftS, swap.lift);
  hero.group.position.y = base.grooveY + Math.max(smooth(0, 1, liftS) * 2.9, smooth(0, 1, swap.lift) * 1.3);
  hero.group.rotation.z = Math.sin(lift * Math.PI) * 0.035;
  hero.group.visible = hero.group.position.y < 2.9;
  hero.lifted = lift > 0.04;
  turntable.rotation.y = swap.spin + e * 0.5 + Math.sin(t * 0.1) * 0.02;
  spores.uniforms.uAlpha.value = (1 - smooth(0, 0.4, lift)) * intro.k;
  spores.uniforms.uTime.value = t;

  // exploded substrate
  const wy = base.top + smooth(0.0, 0.45, e) * WORLD_UP;
  if (!swap.busy) worlds[swap.cur].position.y = wy;
  for (const L of layers) {
    const [a, b] = LAYER_T[L.key];
    const k = smooth(a, b, e);
    L.group.visible = e > 0.01;
    L.group.position.y = lerp(base.top - L.h - 0.02, base.top + LAYER_Y[L.key], k);
    L.group.rotation.y = turntable.rotation.y * 0.6 + (1 - k) * 0.4;
  }

  // time of day: the window light swings across the wall; the fog lifts at noon and returns with the evening rain
  const d = dayS;
  const ang = lerp(-0.35, 0.5, d);
  sun.position.set(-5.4 * Math.cos(ang) , 4.1 + Math.sin(d * Math.PI) * 1.4, 2.6 + Math.sin(ang) * 5.2);
  const warm = smooth(0.65, 1, d) + (1 - smooth(0, 0.18, d)) * 0.4;
  if (Q.has('sunp')) { sun.position.set(...Q.get('sunp').split(',').map(Number)); sun.target.position.set(...(Q.get('sunt') ?? '0.4,0.2,-0.7').split(',').map(Number)); }
  sun.color.setRGB(1, lerp(0.95, 0.87, warm), lerp(0.86, 0.74, warm));
  sun.intensity = lerp(3.6, 2.8, warm) * (Q.has('nosun') ? 0 : 1);
  cookie.mat.uniforms.uWarm.value = warm * 0.3;
  const dryDay = smooth(0.16, 0.42, d) * (1 - smooth(0.56, 0.76, d)) * 0.92;
  const inCare = st.seg >= 5 && st.seg <= 7 ? 1 : 0;
  hero.ambientDrops = 0.5 + smooth(0.72, 0.95, d) * 7 * inCare;

  // glass state machines: dry when lifted, fog creeps up from the rim when set down again
  for (const g of glasses) {
    const L = liftState.get(g);
    const isHero = g === hero;
    if (isHero && g.lifted) {
      L.seated = false; g.front = null; g.grow = 1;
      g.dry = damp(g.dry, 1, 2.5, dt);
    } else if (isHero && !L.seated && lift < 0.02) {
      L.seated = true;
      g.dry = 0; g.clear(1); g.grow = 7;
      g.front = { v: -0.1 };
      gsap.to(g.front, { v: 1.15, duration: 2.6, ease: 'power1.inOut', onComplete: () => { g.front = null; g.grow = 1; if (g === hero) ghost.pending = engine.time + 0.9; } });
    } else if (L.seated) {
      g.dry = isHero ? dryDay * inCare : 0;
      if (!g.front) g.grow = isHero && inCare ? 2.6 : 1;
    }
  }

  // visibility / activity
  const camX = camera.position.x;
  hero.active = camX < 4.5 && !engine.paused;
  for (const s of SHOP) s.glass.active = camX > 3.2 && !engine.paused;
  frameNo++;
  sun.shadow.autoUpdate = frameNo < 4 || camX < 4.8;
  shopSun.shadow.autoUpdate = frameNo < 4 || camX > 2.8;

  // wiping
  const px = pointer.x, py = pointer.y;
  let hit = null;
  if (pointer.active && intro.k > 0.5 && (!MOBILE || touchWipe)) hit = castGlass(px, py);
  const overUI = document.elementFromPoint?.(pointer.px, pointer.py)?.closest?.('a,button,input,.tabs,.product,.clim-panel h2,.nav');
  if (hit && !overUI && (!MOBILE || touchWipe)) {
    const local = hit.h.local;
    const same = lastHit && lastHit.g === hit.g;
    const R = BRUSH * (touchWipe ? 1.45 : pointer.down ? 1.7 : 1);
    if (pointerMoved || pointer.down || touchWipe || !same) {
      hit.g.brush(same ? lastHit.local : local, local, R, 1);
      if (same) { wiped += lastHit.local.distanceTo(local) * hit.g.mesh.getWorldScale(tmp).x; lastUserWipe = t; }
    }
    lastHit = { g: hit.g, local };
    // wipe cursor, sized to the brush footprint on screen
    const [cx, cy] = project(hit.h.point);
    const [ex, ey] = project(tmp2.copy(hit.h.point).addScaledVector(right.setFromMatrixColumn(camera.matrixWorld, 0), R));
    const rad = Math.hypot(ex - cx, ey - cy);
    wipeEl.style.transform = `translate3d(${pointer.px}px, ${pointer.py}px, 0)`;
    wipeEl.style.setProperty('--s', (rad / 30).toFixed(3));
    wipeEl.style.setProperty('--rad', rad.toFixed(1) + 'px');
    if (!touchWipe) { wipeEl.classList.add('on'); cursorApi?.set('hidden'); }
  } else {
    lastHit = null;
    if (wipeEl.classList.contains('on')) { wipeEl.classList.remove('on'); cursorApi?.set(''); }
  }
  pointerMoved = false;

  // idle: if nobody has wiped for a while, the ghost finger draws another streak
  const ghostReady = intro.done && !ghost.on && hero.active && !hero.lifted && liftState.get(hero).seated && !hero.front && !swap.busy && st.seg <= 1;
  const afterLanding = ghost.pending && t > ghost.pending && t - lastUserWipe > 2;
  if (ghostReady && (afterLanding || (t - lastUserWipe > 9 && t - (ghost.last ?? 0) > 9.5))) {
    ghost.last = t; ghost.pending = null;
    const r = Math.random(), [a, b] = CLIMATES[swap.cur].streak;
    ghostWipe(hero, { dur: 1.8, v0: a + r * 0.04, v1: b + (r - 0.5) * 0.06, span: 0.26 + r * 0.05, wave: 0.02 + r * 0.02 });
  }
  if (ghost.pending && (st.seg > 1 || hero.lifted)) ghost.pending = null;

  // hint beside the bell
  const heroOn = st.seg === 0 && st.raw < 0.4;
  const [hx, hy] = project(tmp2.set(0.72, 0.62, 0).applyMatrix4(stage.matrixWorld));
  if (MOBILE) { const [bx, by] = project(tmp2.set(0, 0.02, 0.8).applyMatrix4(stage.matrixWorld)); hintEl.style.transform = `translate3d(${(bx - hintEl.offsetWidth / 2).toFixed(1)}px, ${(by + 18).toFixed(1)}px, 0)`; }
  else hintEl.style.transform = `translate3d(${(hx + 24).toFixed(1)}px, ${hy.toFixed(1)}px, 0)`;
  hintEl.classList.toggle('on', intro.done && heroOn && wiped < 0.9);

  // simulate
  for (const g of glasses) g.step(dt, t);
  cookie.update(dt, t);

  // layer labels
  const labelOn = e > 0.55 && st.seg >= 3 && st.seg <= 5;
  right.setFromMatrixColumn(camera.matrixWorld, 0);
  const lx = MOBILE ? innerWidth * 0.6 : innerWidth * 0.655;
  const anchors = {
    world: tmp2.set(0, wy + 0.22, 0), soil: V3(0, base.top + LAYER_Y.soil + 0.06, 0), mesh: V3(0, base.top + LAYER_Y.mesh + 0.01, 0),
    charcoal: V3(0, base.top + LAYER_Y.charcoal + 0.03, 0), stones: V3(0, base.top + LAYER_Y.stones + 0.05, 0), base: V3(0, 0.1, 0),
  };
  let n = 0;
  for (const [k, el] of Object.entries(labelEls)) {
    const a = anchors[k].clone().addScaledVector(right, k === 'base' ? 0.78 : k === 'world' ? 0.55 : 0.52);
    const [ax, ay] = project(a);
    el.style.transform = `translate3d(${lx.toFixed(1)}px, ${(ay - 10).toFixed(1)}px, 0)`;
    el.style.setProperty('--lead', Math.max(10, lx - ax - 12).toFixed(1) + 'px');
    el.classList.toggle('on', labelOn && e > 0.55 + n * 0.06);
    n++;
  }

  // care clock
  if (st.seg >= 5 && st.seg <= 7) {
    const hours = 7 + d * 12;
    const hh = Math.floor(hours), mm = Math.floor((hours - hh) * 60 / 5) * 5;
    clockTime.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    let note = NOTES[0][1]; for (const [v, s] of NOTES) if (d >= v) note = s;
    if (clockNote.textContent !== note) clockNote.textContent = note;
    clockBar.style.setProperty('--day', d.toFixed(3));
    careItems.forEach((li, i) => { li.classList.toggle('on', d > i * 0.22 + 0.02); li.classList.toggle('cur', d > i * 0.25 - 0.01 && d <= (i + 1) * 0.25 + (i === 3 ? 1 : 0)); });
  }

  // product cards under their bells
  const shopOn = st.seg >= 8 && st.seg <= 9 || (st.seg === 7 && st.raw > 0.8);
  SHOP.forEach((s, i) => {
    const [x] = project(tmp2.set(s.x, 0, 0));
    const el = productEls[i];
    if (!MOBILE) el.style.transform = `translate3d(${(x - el.offsetWidth / 2).toFixed(1)}px, 0, 0)`;
    el.classList.toggle('on', shopOn);
    if (MOBILE) el.classList.toggle('near', Math.abs(camera.position.x - s.x) < 1);
  });
  navEl.classList.toggle('solid', y > innerHeight * 0.6);
  const cur = st.seg >= 8 ? 'shop' : st.seg >= 6 ? 'care' : st.seg >= 3 ? 'inside' : st.seg >= 1 || st.raw > 0.6 ? 'climates' : '';
  if (cur !== navCur) { navCur = cur; navLinks.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + cur)); }

  // nothing to draw once the footer covers the canvas
  engine.paused = foot.getBoundingClientRect().top <= 0;
});

// ─── Shop buttons ──────────────────────────────────────────────────────────────
const toastEl = document.querySelector('.toast');
const basketEl = document.querySelector('.basket');
let toastTimer, basket = 0;
function toast(msg, ms = 2800) {
  toastEl.textContent = msg; toastEl.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms);
}
document.querySelectorAll('.add').forEach(b => b.addEventListener('click', () => {
  basket++; basketEl.textContent = basket; basketEl.classList.remove('bump'); void basketEl.offsetWidth; basketEl.classList.add('bump');
  toast(`${b.dataset.name} reserved — we’ll blow your bell on Thursday.`);
}));
document.querySelector('.foot-news').addEventListener('submit', e => { e.preventDefault(); toast('Thank you. See you at the equinox.'); });

// ─── Boot ─────────────────────────────────────────────────────────────────────
const INTRO_TEXT = '.hero .eyebrow, .hero-sub, .hero-body, .hero-cta, .hero-label, .scroll-cue, .nav';
gsap.set('.hero-title .ln', { yPercent: 60, opacity: 0 });
gsap.set(INTRO_TEXT, { opacity: 0, y: 16 });
function startIntro() {
  intro.done = false;
  gsap.to(intro, { k: 1, duration: 3.0, ease: 'power3.out' });
  gsap.to('.hero-title .ln', { yPercent: 0, opacity: 1, duration: 1.8, ease: 'expo.out', stagger: 0.12, delay: 0.55 });
  gsap.to(INTRO_TEXT, { opacity: 1, y: 0, duration: 1.3, ease: 'power3.out', stagger: 0.07, delay: 0.95 });
  ghostWipe(hero, { dur: 2.0, delay: 1.5, v0: 0.07, v1: 0.31, span: 0.3, wave: 0.02 }).then(() => { intro.done = true; ghost.last = engine.time; window.__introDone = true; });
}
worldNav('terrarium', { theme: 'light', corner: 'bl' });
cursorApi = cursor({ color: '#22281f', blend: 'normal', size: 30 });
magnetic();
const lenis = smoothScroll({ lerp: 0.085 });
document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
  const id = a.getAttribute('href'); const el = id === '#top' ? document.body : document.querySelector(id);
  if (!el) return; e.preventDefault(); lenis.scrollTo(id === '#top' ? 0 : el, { duration: 1.8 });
}));
reveal('.climates h2, .inside h2, .care h2, .shop h2, .visit h2', { type: 'lines', stagger: 0.08, start: 'top 92%' });
layout();
addEventListener('resize', () => requestAnimationFrame(layout));

await Promise.all(loads);
await document.fonts?.ready;
layout();

// warm-up: every world, every layer, lifted and seated, compiled before the first frame
for (const wv of worlds) wv.visible = true;
for (const L of layers) L.group.visible = true;
renderer.compile(scene, camera);
for (const wv of worlds) wv.visible = false;
worlds[0].visible = true;
for (const L of layers) L.group.visible = false;
// let the glass fog and a few old drips run before anyone sees it
for (const g of glasses) {
  g.clear(0);
  const act = g.active; g.active = true;
  for (let i = 0; i < 6; i++) g.spawnDrop(Math.random(), 0.25 + Math.random() * 0.5, 0.01 + Math.random() * 0.01, Math.random() * 3);
  for (let i = 0; i < 200; i++) g.step(1 / 30, i / 30);
  g.active = act;
}
engine.start();
await loader.finish();
// QA hooks: scroll to a fraction of a section
window.__glassRect = () => {
  const pts = [V3(-0.67, 0.15, 0), V3(0.67, 0.15, 0), V3(0, 1.6, 0), V3(0, 0.15, 0.67)].map(v => project(v.applyMatrix4(stage.matrixWorld)));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
window.__at = (sec, p = 0) => { const el = sections[sec]; const top = el.getBoundingClientRect().top + scrollY; return top + Math.max(0, el.offsetHeight - innerHeight) * p; };
if (Q.has('debug')) Object.assign(window, { hero, glasses, THREE, camera, scene, engine, swap, requestClimate, ghostWipe });
