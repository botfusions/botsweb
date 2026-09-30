import { Engine, THREE, normalize, prepModel, damp, clamp, smooth, lerp, studioEnvironment } from '../../src/core/engine.js';
import { Assets, firstMesh } from '../../src/core/assets.js';
import { Pointer } from '../../src/core/input.js';
import { smoothScroll, gsap } from '../../src/core/scroll.js';
import { preloader, cursor, magnetic, worldNav } from '../../src/core/ui.js';
import { sky, skyDome, patchAtmosphere } from './sky.js';
import { Clouds, rng } from './clouds.js';
import { buildAirship } from './airship.js';
import { Flock } from './birds.js';
import { fallStream, petals, lighthouseLamp, pointU, motes } from './water.js';

// ─── The archipelago ──────────────────────────────────────────────────────────
const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
const TAU = Math.PI * 2;
const DBG = new URLSearchParams(location.search);
const portrait = () => innerWidth < innerHeight * 0.95;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// side: -1 → the ticket sits left and the island is framed right of centre; +1 the opposite.
const ISLES = [
  { key: 'lighthouse', id: 'lanternholm', name: 'Lanternholm', num: 'I', time: '3 h', s: 1.25, pos: [6.4, 0.6, 7], yaw: -0.55,
    az: 0.62, sweep: 0.6, dist: 15.5, h: 2.6, side: -1 },
  { key: 'windmill', id: 'amberlea', name: 'Amberlea', num: 'II', time: '4½ h', s: 1.2, pos: [22, -4, -14], yaw: -0.35,
    az: -0.5, sweep: 0.6, dist: 16.5, h: 3.4, side: 1,
    fall: { a: [-0.4, 1.5, 2.18], b: [-0.13, 1.5, 2.18], boxA: [-0.5, 0.0, 1.98], boxB: [-0.05, 4.3, 2.42], drop: 18 } },
  { key: 'falls', id: 'hollowmere', name: 'Hollowmere', num: 'III', time: '6 h', s: 1.15, pos: [-1, 12, -32], yaw: 0.1,
    az: 0.42, sweep: 0.55, dist: 16, h: 2.0, side: -1,
    fall: { a: [0.45, 1.5, 1.98], b: [0.85, 1.5, 1.98], boxA: [0.36, 0.05, 1.76], boxB: [0.95, 4.35, 2.26], drop: 25 } },
  { key: 'pagoda', id: 'hanakumo', name: 'Hanakumo', num: 'IV', time: '9 h', s: 1.1, pos: [30, 16, -56], yaw: -0.3,
    az: -0.5, sweep: 0.55, dist: 14.5, h: 3.0, side: 1 },
];
const ARCH = new V3(12, 6, -24); // archipelago centre
const HERO_POS0 = new THREE.Vector3(0, 6.5, 31), HERO_LOOK0 = new THREE.Vector3(1, 5.2, 0), BOOK_POS0 = new THREE.Vector3(-10, 16, 54);
const tmp = new V3(), tmp2 = new V3(), tmp3 = new V3(), tmp4 = new V3();

// ─── Engine ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gl');
const engine = new Engine({
  canvas, fov: 40, near: 0.3, far: 2600, dpr: 1.5, background: 0x9fd0ff,
  post: {
    ao: DBG.has('noao') ? false : { aoRadius: 1.4, intensity: 1.6, distanceFalloff: 0.5 },
    bloom: { intensity: 0.55, luminanceThreshold: 1.25, luminanceSmoothing: 0.35, radius: 0.8 },
    tone: DBG.get('tone') ?? 'neutral',
    vignette: { offset: 0.42, darkness: 0.34 },
    noise: 0.028,
  },
});
const { scene, camera, renderer } = engine;
renderer.shadowMap.autoUpdate = false;
scene.environment = studioEnvironment(renderer, {
  top: 0x7fb8ec, bottom: 0xf4dccb,
  panels: [
    { pos: [-6, 7, 6], size: [9, 4], intensity: 2.6, color: 0xfff0dc },
    { pos: [7, 2, -5], size: [4, 7], intensity: 1.1, color: 0xcfe6ff },
    { pos: [0, -6, 0], size: [12, 12], intensity: 0.8, color: 0xffe2cc },
  ],
});
scene.environmentIntensity = 0.55;

const hemi = new THREE.HemisphereLight('#d9ecff', '#ffdcc8', 1.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff0dc', 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -46, right: 46, top: 46, bottom: -46, near: 1, far: 260 });
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.05; sun.shadow.radius = 2.5;
scene.add(sun, sun.target);

const DAY = { dir: new V3(-0.55, 0.62, 0.56).normalize(), skyDir: new V3(-0.337, 0.174, -0.925).normalize(), sun: new THREE.Color('#fff0dc'), sunI: 2.5, hemiI: 1.35,
  zenith: new THREE.Color('#3f8fe0'), mid: new THREE.Color('#7cc4ff'), horizon: new THREE.Color('#ffe7d2'), below: new THREE.Color('#f0e8e8'), glow: new THREE.Color('#ffd9ae'),
  lit: new THREE.Color('#fffaf3').multiplyScalar(1.12), midC: new THREE.Color('#fae5d9'), shadow: new THREE.Color('#a6bade') };
const DUSK = { dir: new V3(-0.72, 0.16, 0.68).normalize(), skyDir: new V3(0.616, 0.075, -0.784).normalize(), sun: new THREE.Color('#ffb07a'), sunI: 2.2, hemiI: 1.05,
  zenith: new THREE.Color('#4f79c4'), mid: new THREE.Color('#c2c3e0'), horizon: new THREE.Color('#ffcb92'), below: new THREE.Color('#f4d8c2'), glow: new THREE.Color('#ffae64'),
  lit: new THREE.Color('#fff0da').multiplyScalar(1.15), midC: new THREE.Color('#ffd2ac'), shadow: new THREE.Color('#a8a4cb') };

const dome = skyDome();
scene.add(dome);

const assets = new Assets();
const pointer = new Pointer({ lambda: 5 });
const loaderEl = document.querySelector('.loader');
const routePath = loaderEl.querySelector('#route');
const routeDone = loaderEl.querySelector('.route-done');
const loaderShip = loaderEl.querySelector('.loader-ship');
const routeLen = routePath.getTotalLength();
routeDone.style.strokeDasharray = `${routeLen} ${routeLen}`;
const loader = preloader({
  assets, el: loaderEl, minTime: 1500,
  onValue: v => {
    loaderEl.querySelector('.loader-pct').textContent = Math.round(v * 100);
    const p = routePath.getPointAtLength(v * routeLen), q = routePath.getPointAtLength(Math.min(routeLen, v * routeLen + 2));
    loaderShip.setAttribute('transform', `translate(${p.x} ${p.y - 12}) rotate(${Math.atan2(q.y - p.y, q.x - p.x) * 57.3})`);
    routeDone.style.strokeDashoffset = routeLen * (1 - v);
  },
  exit: () => gsap.timeline()
    .to('.loader-card', { y: -30, opacity: 0, duration: 0.6, ease: 'power2.in' })
    .add(() => beginIntro(), '-=0.1')
    .to(loaderEl, { yPercent: -112, duration: 1.5, ease: 'expo.inOut' }, '-=0.2'),
});

// ─── Clouds ────────────────────────────────────────────────────────────────────
const clouds = new Clouds(renderer, { max: 1800 });
scene.add(clouds.mesh);
if (DBG.has('nosoft')) clouds.uniforms.uSoftOn.value = 0;
if (DBG.has('noclouds')) clouds.mesh.visible = false;
if (DBG.has('nobloom')) engine.post.bloom.intensity = 0;
{
  const R = rng(11);
  // The cloud sea: a deep undulating floor that runs to the horizon — fine puffs near, broad banks far.
  const sea = (n, r0, r1, s0, s1) => {
    for (let i = 0; i < n; i++) {
      const r = r0 + Math.sqrt(R()) * (r1 - r0), a = R() * TAU;
      const x = ARCH.x + Math.cos(a) * r * 1.1, z = ARCH.z + Math.sin(a) * r;
      const far = r / 340;
      const dip = R();
      const y = -11 + Math.sin(x * 0.035) * 2.5 + Math.cos(z * 0.045 + 1) * 2.5 - dip * 4 - far * 10;
      clouds.add(x, y, z, lerp(s0, s1, R()), { tile: R() < 0.55 ? 3 : Math.floor(R() * 3), shade: 0.7 + (1 - dip) * 0.48, alpha: 0.95, aspect: 0.45 + R() * 0.22 });
    }
  };
  sea(300, 0, 95, 14, 34);
  sea(230, 95, 340, 40, 110);
  // Horizon banks: towering far cumulus that give the sky its depth.
  for (let i = 0; i < 46; i++) {
    const a = R() * TAU, r = 420 + R() * 260;
    clouds.add(ARCH.x + Math.cos(a) * r, -30 + R() * 30, ARCH.z + Math.sin(a) * r, 140 + R() * 160, { tile: Math.floor(R() * 3), shade: 1 + R() * 0.2, alpha: 0.85, aspect: 0.6 + R() * 0.3 });
  }
  // Mid-level cumulus drifting between the islands: flat bases, heaped tops, kept out of every sightline the tour uses.
  const cluster = (cx, cy, cz, rad, n, shade = 1) => {
    for (let k = 0; k < n; k++) {
      const h = Math.pow(R(), 1.4);                         // most puffs sit low, a few heap up
      const spread = 1 - h * 0.55;
      const ox = (R() - 0.5) * 2.2 * rad * spread, oz = (R() - 0.5) * 1.5 * rad * spread;
      const oy = h * rad * 0.9;
      clouds.add(cx + ox, cy + oy, cz + oz, rad * (0.55 + R() * 0.55) * (1 - h * 0.3), { tile: Math.floor(R() * 3), shade: (0.8 + h * 0.4) * shade, alpha: 0.96, aspect: 0.75 + R() * 0.2 });
    }
  };
  // A towering cumulus: flat base on the sea, heaped cauliflower crown.
  const sunH = new V3(DAY.dir.x, 0, DAY.dir.z).normalize();
  const tower = (x, z, base, height, width, n) => {
    for (let k = 0; k < n; k++) {
      const h = Math.pow(R(), 0.75);
      const w = width * (1 - h * 0.45) * (h > 0.82 ? 1.2 : 1);
      const ox = (R() - 0.5) * w, oz = (R() - 0.5) * w * 0.7;
      const sunSide = (ox * sunH.x + oz * sunH.z) / (w * 0.5 + 1e-3);
      clouds.add(x + ox, base + h * height, z + oz, width * (0.46 + R() * 0.3) * (1 - h * 0.3),
        { tile: Math.floor(R() * 3), shade: (0.7 + h * 0.5) * (1 + sunSide * 0.14), alpha: 0.97, aspect: 0.82 + R() * 0.18 });
    }
  };
  const segs = [];
  const heroP = HERO_POS0;
  for (const I of ISLES) {
    const c = new V3(I.pos[0], I.pos[1] + 3.5 * I.s, I.pos[2]);
    segs.push([heroP, c], [BOOK_POS0, c]);
    for (const da of [-0.35, 0, 0.35]) {
      const az = I.yaw + I.az + da;
      segs.push([new V3(c.x + Math.sin(az) * I.dist, c.y + I.h, c.z + Math.cos(az) * I.dist), c]);
    }
  }
  const segDist = (p, a, b) => { const ab = tmp2.subVectors(b, a); const t = clamp(tmp3.subVectors(p, a).dot(ab) / ab.lengthSq()); return p.distanceTo(tmp4.copy(a).addScaledVector(ab, t)); };
  let placed = 0, tries = 0;
  while (placed < 16 && tries++ < 4000) {
    const x = (R() - 0.5) * 150, z = 30 - R() * 150, y = -9 + R() * 22;
    const rad = 7 + R() * 9;
    const c = new V3(x, y, z);
    const reach = rad * 2 + 3;
    if (segs.some(([a, b]) => segDist(c, a, b) < reach)) continue;
    if (ISLES.some(I => c.distanceTo(tmp.set(I.pos[0], I.pos[1] + 3, I.pos[2])) < reach + 6)) continue;
    // nothing between the hero camera and the archipelago
    const toC = tmp.subVectors(c, heroP), dC = toC.length();
    if (dC < 70 && toC.normalize().dot(tmp2.subVectors(HERO_LOOK0, heroP).normalize()) > 0.55 && y + rad > -4) continue;
    cluster(x, y, z, rad, 12 + Math.floor(R() * 10));
    placed++;
  }
  // Set-piece cumulus: towers behind each island (seen from its orbit), a bed of cloud beneath it,
  // and a few big towers on the hero horizon.
  for (const I of ISLES) {
    const c = new V3(I.pos[0], I.pos[1] + 3.5 * I.s, I.pos[2]);
    const az = I.yaw + I.az;
    const camP = new V3(c.x + Math.sin(az) * I.dist, c.y + I.h, c.z + Math.cos(az) * I.dist);
    const d = tmp.subVectors(c, camP).setY(0).normalize().clone();
    const side = new V3().crossVectors(d, UP).normalize();
    const t1 = c.clone().addScaledVector(d, 70).addScaledVector(side, -I.side * 30);
    tower(t1.x, t1.z, -10, c.y + 12, 24, 13);
    const t2 = c.clone().addScaledVector(d, 110).addScaledVector(side, I.side * 38);
    tower(t2.x, t2.z, -12, c.y + 18, 32, 14);
    const bed = c.clone().addScaledVector(d, 18).add(new V3(0, -13 * I.s, 0));
    cluster(bed.x, bed.y, bed.z, 10, 16, 0.95);
  }
  // towers on the hero horizon, behind the archipelago
  for (const [x, z, h, w, n] of [[-70, -170, 52, 50, 18], [92, -190, 60, 56, 20], [-190, -120, 40, 50, 14], [200, -150, 44, 54, 14]]) tower(x, z, -12, h, w, n);
  // Mist skirts hugging each island's roots.
  for (const I of ISLES) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + R() * 0.5, r = (2.4 + R() * 2.2) * I.s;
      clouds.add(I.pos[0] + Math.cos(a) * r, I.pos[1] + (0.1 + R() * 1.4) * I.s, I.pos[2] + Math.sin(a) * r, (3 + R() * 2.5) * I.s,
        { tile: Math.floor(R() * 3), shade: 1 + R() * 0.2, alpha: 0.38, aspect: 0.6 });
    }
  }
}
// Fly-through wisps, re-seeded along every flight path.
const wisps = [];
for (let k = 0; k < 36; k++) { const w = clouds.add(0, -999, 0, 6, { alpha: 0 }); w.peak = 0.8; wisps.push(w); }
let wispT = 99, wispDur = 3;

// ─── Islands ──────────────────────────────────────────────────────────────────
const pinsEl = document.querySelector('.pins');
for (const I of ISLES) {
  I.root = new THREE.Group();
  I.root.position.set(...I.pos);
  I.root.rotation.y = I.yaw;
  I.root.scale.setScalar(I.s);
  I.bob = new THREE.Group();
  I.root.add(I.bob);
  scene.add(I.root);
  I.center = new V3(I.pos[0], I.pos[1] + 3.9 * I.s, I.pos[2]);
  I.top = new V3(I.pos[0], I.pos[1] + 6.35 * I.s, I.pos[2]);
  I.sphere = new THREE.Sphere(new V3(I.pos[0], I.pos[1] + 3.4 * I.s, I.pos[2]), 3.1 * I.s);
  I.hover = { value: 0 };
  I.hot = false;
  I.phase = Math.random() * TAU;
  const pin = document.createElement('div');
  pin.className = 'pin';
  pin.innerHTML = `<div class="pin-card"><em>${I.num}</em><b>${I.name}</b><span>${I.time}</span></div><i class="pin-stem"></i><i class="pin-dot"></i>`;
  pinsEl.appendChild(pin);
  I.pin = pin;
}
const loads = ISLES.map(I => assets.gltf(`models/atlas/${I.key}.glb`).then(g => {
  const m = g.scene;
  normalize(m, 6, { axis: 'y' });
  m.updateMatrixWorld(true);
  const mesh = firstMesh(m);
  const rel = { value: mesh.matrixWorld.clone() };
  prepModel(m, renderer, {
    env: 0.5, metal: 0,
    onMat: mat => patchAtmosphere(mat, {
      hover: I.hover, rel,
      fallA: I.fall ? new V3(...I.fall.boxA) : undefined, fallB: I.fall ? new V3(...I.fall.boxB) : undefined,
    }),
  });
  m.traverse(o => { if (o.isMesh) o.layers.enable(1); });
  I.bob.add(m);
  I.model = m;
  if (I.fall) I.bob.add(fallStream({ a: I.fall.a, b: I.fall.b, drop: I.fall.drop }));
}));
// Island life
const hana = ISLES[3], lantern = ISLES[0];
hana.bob.add(petals({ box: [[-1.5, 4.0, -1.7], [1.4, 4.9, 0.6]] }));
const lamp = lighthouseLamp();
lamp.position.set(0.67, 5.5, -1.1);
lantern.bob.add(lamp);

// ─── Airship & birds ─────────────────────────────────────────────────────────
const ship = buildAirship();
scene.add(ship);
const SHIP = { c: new V3(12, 18, -26), rx: 52, rz: 54, w: 0.011, a: -Math.PI / 2 - 0.62 };
const shipFwd = new V3(), shipPos = new V3();
function placeShip(dt) {
  SHIP.a += SHIP.w * dt;
  const a = SHIP.a;
  shipPos.set(SHIP.c.x + Math.cos(a) * SHIP.rx, SHIP.c.y + Math.sin(a * 2) * 2.5, SHIP.c.z + Math.sin(a) * SHIP.rz);
  shipFwd.set(-Math.sin(a) * SHIP.rx, Math.cos(a * 2) * 5, Math.cos(a) * SHIP.rz).normalize();
  ship.position.copy(shipPos);
  ship.lookAt(tmp.copy(shipPos).add(shipFwd));
  ship.rotateZ(-0.06); // leaning gently into its endless turn
}
// The Halcyon, the overnight sleeper, forever setting off toward the sunset.
const halcyon = buildAirship({ a: '#f4ecdf', b: '#33436e', fin: '#ef7d5c', name: 'HALCYON' });
halcyon.scale.setScalar(0.8);
scene.add(halcyon);
const HAL = { a: new V3(150, 12, -40), b: new V3(-120, 19, -95), period: 110, u: 0.3 };
function placeHalcyon(dt, active) {
  // it only sails while the evening is up, and always sets off from beside the sun
  if (active) HAL.u = (HAL.u + dt / HAL.period) % 1; else HAL.u = 0.3;
  const u = HAL.u;
  halcyon.position.lerpVectors(HAL.a, HAL.b, u);
  halcyon.lookAt(tmp.copy(halcyon.position).add(tmp2.subVectors(HAL.b, HAL.a)));
}
const dust = motes();
scene.add(dust);
const flock = new Flock(DBG.has('nobirds') ? 0 : 56);
flock.scale = 0.38;
scene.add(flock.mesh);

// ─── Soft-particle depth: islands + airship only (layer 1), half resolution ─────
const depthRT = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });
depthRT.depthTexture = new THREE.DepthTexture(4, 4);
depthRT.texture.generateMipmaps = false;
const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
clouds.uniforms.uDepth.value = depthRT.depthTexture;
engine.onResize((w, h, dpr) => {
  depthRT.setSize(Math.ceil(w * dpr * 0.5), Math.ceil(h * dpr * 0.5));
  clouds.uniforms.uRes.value.set(w * dpr, h * dpr);
  pointU.uResY.value = h * dpr;
});
function depthPass() {
  const mask = camera.layers.mask;
  camera.layers.set(1);
  scene.overrideMaterial = depthMat;
  renderer.setRenderTarget(depthRT);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  scene.overrideMaterial = null;
  camera.layers.mask = mask;
}

// ─── Stations & camera poses ─────────────────────────────────────────────────
// 0 hero · 1–4 islands · 5 fleet · 6 booking
const HERO = { pos: new V3(0, 6.5, 31), look: new V3(1, 5.2, 0), mpos: new V3(3, 7, 46), mlook: new V3(6, 0.5, 0) };
if (DBG.get('hero')) { const v = DBG.get('hero').split(',').map(Number); HERO.pos.set(v[0], v[1], v[2]); HERO.look.set(v[3], v[4], v[5]); }
const BOOK = { pos: new V3(-10, 16, 54), look: new V3(16, 9, -40), mpos: new V3(-2, 19, 76), mlook: new V3(14, 5, -40) };
function tanHalf(fov) { return Math.tan(fov * Math.PI / 360); }
function baseFov() { return portrait() ? 56 : 40; }

function poseOf(st, t, local, out) {
  const P = portrait();
  out.fov = baseFov();
  if (st === 0) {
    out.pos.copy(P ? HERO.mpos : HERO.pos).add(tmp.set(Math.sin(t * 0.06) * 1.6, Math.sin(t * 0.045) * 0.5 - local * 1.5, -local * 5));
    out.look.copy(P ? HERO.mlook : HERO.look);
  } else if (st >= 1 && st <= 4) {
    const I = ISLES[st - 1];
    const R = I.dist * (P ? 1.45 : 1);
    const az = I.yaw + I.az + (local - 0.5) * I.sweep + Math.sin(t * 0.09) * 0.22;
    out.pos.set(I.center.x + Math.sin(az) * R, I.center.y + I.h * (P ? 1.25 : 1), I.center.z + Math.cos(az) * R);
    const fwd = tmp.subVectors(I.center, out.pos).normalize();
    const right = tmp2.crossVectors(fwd, UP).normalize();
    out.look.copy(I.center);
    if (P) out.look.addScaledVector(UP, -R * tanHalf(out.fov) * 0.36);
    else out.look.addScaledVector(right, I.side * R * tanHalf(out.fov) * camera.aspect * 0.3);
  } else if (st === 5) {
    const off = tmp.set(P ? -15 : -13.5, P ? -0.6 : -1.2, P ? 6 : 5.5).applyQuaternion(ship.quaternion);
    out.pos.copy(shipPos).add(off);
    const right = tmp2.set(1, 0, 0).applyQuaternion(ship.quaternion);
    out.look.copy(shipPos).addScaledVector(shipFwd, 0.4).addScaledVector(UP, P ? -3.6 : -0.9);
    const toShip = tmp3.subVectors(shipPos, out.pos).normalize();
    const camRight = tmp4.crossVectors(toShip, UP).normalize();
    if (!P) out.look.addScaledVector(camRight, -4.2);
  } else {
    out.pos.copy(P ? BOOK.mpos : BOOK.pos).add(tmp.set(Math.sin(t * 0.05) * 1.2, local * 3, 0));
    out.look.copy(P ? BOOK.mlook : BOOK.look);
  }
  return out;
}

// ─── Flight ────────────────────────────────────────────────────────────────────
const cam = { pos: new V3().copy(HERO.pos).add(new V3(0, -16, 16)), look: HERO.look.clone(), fov: 40, roll: 0,
  vel: new V3(), acc: new V3(), prev: new V3(), prevVel: new V3() };
const pose = { pos: new V3(), look: new V3(), fov: 40 };
const fl = { on: false, u: 0, dur: 3, st: 0, p0: new V3(), p1: new V3(), look0: new V3(), lat: new V3(), dip: new V3(), dist: 1, fov0: 40, side: 1 };
let station = -1;
const R2 = rng(5);
const ease = u => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
function bez(a, b, c, d, t, out) {
  const s = 1 - t;
  return out.set(0, 0, 0).addScaledVector(a, s * s * s).addScaledVector(b, 3 * s * s * t).addScaledVector(c, 3 * s * t * t).addScaledVector(d, t * t * t);
}
function bezD(a, b, c, d, t, out) {
  const s = 1 - t;
  return out.set(0, 0, 0).addScaledVector(tmp4.subVectors(b, a), 3 * s * s).addScaledVector(tmp4.subVectors(c, b), 6 * s * t).addScaledVector(tmp4.subVectors(d, c), 3 * t * t);
}
const P1 = new V3(), P2 = new V3(), P3 = new V3(), BP = new V3(), BT = new V3();
function controls(t) {
  poseOf(fl.st, t, stLocal(fl.st), pose);
  P3.copy(pose.pos);
  const back = tmp.subVectors(pose.pos, pose.look).normalize();
  P2.copy(P3).addScaledVector(back, fl.dist * 0.3).add(fl.lat).add(fl.dip).addScaledVector(UP, fl.dist * 0.05);
  P1.copy(fl.p1).addScaledVector(fl.lat, 0.55).add(fl.dip);
}
function fly(st, { dur, intro = false } = {}) {
  const t = engine.time;
  fl.intro = intro;
  poseOf(st, t, stLocal(st), pose);
  fl.on = true; fl.u = 0; fl.st = st;
  fl.p0.copy(cam.pos); fl.look0.copy(cam.look); fl.fov0 = cam.fov;
  const d = tmp2.subVectors(pose.pos, cam.pos);
  fl.dist = Math.max(d.length(), 6);
  fl.dur = (dur ?? clamp(2.4 + fl.dist * 0.02, 2.8, 4.4)) * (REDUCED ? 0.5 : 1);
  const dir = d.normalize();
  if (cam.vel.length() > 2) fl.p1.copy(cam.pos).addScaledVector(cam.vel, fl.dur / 3 * 0.6);
  else fl.p1.copy(cam.pos).addScaledVector(dir, fl.dist * 0.2).addScaledVector(UP, fl.dist * 0.06);
  // sweep out to one side so the ship-of-a-camera banks through the turn; alternate sides
  const lateralSign = Math.sign(tmp3.crossVectors(tmp.subVectors(cam.look, cam.pos), dir).y || 1);
  fl.side = lateralSign;
  fl.lat.crossVectors(dir, UP).normalize().multiplyScalar(fl.dist * 0.26 * fl.side);
  fl.dip.set(0, -fl.dist * 0.045, 0);
  controls(t);
  // seed the cloud wisps along the route so every flight threads through weather
  for (let k = 0; k < wisps.length; k++) {
    const w = wisps[k];
    const u = 0.16 + (k / wisps.length) * 0.46 + (R2() - 0.5) * 0.04;
    bez(fl.p0, P1, P2, P3, u, BP);
    bezD(fl.p0, P1, P2, P3, u, BT).normalize();
    const side = tmp.crossVectors(BT, UP).normalize(), upv = tmp3.crossVectors(side, BT);
    const ang = R2() * TAU, rad = k % 9 === 0 ? 0.8 + R2() * 1.2 : 2.5 + R2() * 8;
    w.x = BP.x + side.x * Math.cos(ang) * rad + upv.x * Math.sin(ang) * rad * 0.55;
    w.y = BP.y + side.y * Math.cos(ang) * rad + upv.y * Math.sin(ang) * rad * 0.55 - 0.6;
    w.z = BP.z + side.z * Math.cos(ang) * rad + upv.z * Math.sin(ang) * rad * 0.55;
    w.size = 3.5 + R2() * 7; w.tile = k % 3; w.shade = 0.95 + R2() * 0.22; w.aspect = 0.62 + R2() * 0.25;
    w.peak = k % 9 === 0 ? 0.5 : 0.45 + R2() * 0.4;
  }
  wispT = 0; wispDur = fl.dur;
  document.body.classList.add('is-flying');
}

// ─── Scroll → stations ────────────────────────────────────────────────────────
const stops = [...document.querySelectorAll('.stop')];
const panels = stops.map(s => s.querySelector('.panel'));
panels.forEach(p => p.querySelectorAll('[data-rise]').forEach((el, i) => el.style.setProperty('--i', i)));
const footEl = document.querySelector('.foot');
const navLinks = [...document.querySelectorAll('.links a')];
let lock = null, lockTimer = 0;
const locals = new Array(stops.length).fill(0.5);
function stLocal(st) { return locals[st] ?? 0.5; }
function readScroll() {
  const mid = innerHeight * 0.5;
  let st = 0;
  for (let k = 0; k < stops.length; k++) {
    const r = stops[k].getBoundingClientRect();
    locals[k] = clamp((mid - r.top) / r.height);
    if (r.top <= mid) st = k;
  }
  return st;
}
const lenis = smoothScroll({ lerp: 0.08 });
function goTo(st) {
  if (st === fl.st && (fl.on || station === st)) return;
  lock = st;
  fly(st);
  const el = stops[st];
  const y = st === 0 ? 0 : el.offsetTop - innerHeight * 0.5 + el.offsetHeight * 0.32;
  lenis.scrollTo(y, { duration: fl.dur * 0.85, easing: ease, onComplete: () => { lock = null; } });
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => { lock = null; }, fl.dur * 1000 + 700);
}
document.querySelectorAll('[data-go]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  const dest = a.dataset.dest;
  if (dest) document.querySelector('.booking select[name=dest]').value = dest;
  goTo(+a.dataset.go);
}));

// ─── Hover, pins & click-to-fly ──────────────────────────────────────────────
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hovered = null, overUI = false;
const cur = cursor({ color: '#1d2742', blend: 'normal', size: 30 });
const UI_SEL = 'a,button,input,select,label,.panel.is-on,.chart,.nav,.foot,.toast';
addEventListener('pointerover', e => { overUI = !!e.target.closest?.(UI_SEL); });
function pick(x, y) {
  ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  let best = null, bd = Infinity;
  for (const I of ISLES) {
    if (!I.model) continue;
    const hit = ray.ray.intersectSphere(I.sphere, tmp3);
    if (hit) { const d = hit.distanceTo(camera.position); if (d < bd) { bd = d; best = I; } }
  }
  return best;
}
let downAt = null;
addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY, t: performance.now(), ui: !!e.target.closest(UI_SEL) }; });
addEventListener('pointerup', e => {
  if (!downAt || downAt.ui || !started) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 10) return;
  const I = pick(e.clientX, e.clientY);
  if (I) goTo(ISLES.indexOf(I) + 1);
});

// ─── Chart of the drift ─────────────────────────────────────────────────────
const chartCanvas = document.querySelector('.chart-canvas');
const cx = chartCanvas.getContext('2d');
const chartDots = document.querySelector('.chart-dots');
const whereEl = document.querySelector('.chart-where');
const WHERE = ['Port Aubade', 'I · Lanternholm', 'II · Amberlea', 'III · Hollowmere', 'IV · Hanakumo', 'Zephyrine', 'Golden hour'];
const MAPB = { z0: 22, z1: -78, x0: -30, x1: 30 };
let CW = 248, CH = 136;
function toMap(x, z) {
  if (portrait()) return [0, 0];
  return [CW * 0.07 + (MAPB.z0 - z) / (MAPB.z0 - MAPB.z1) * CW * 0.86, CH * 0.12 + (x - MAPB.x0) / (MAPB.x1 - MAPB.x0) * CH * 0.76];
}
ISLES.forEach((I, k) => {
  const b = document.createElement('button');
  b.className = 'chart-dot';
  b.type = 'button';
  b.setAttribute('aria-label', `Fly to ${I.name}`);
  b.innerHTML = `<i></i><b>${I.num}</b>`;
  b.addEventListener('click', () => goTo(k + 1));
  b.addEventListener('pointerenter', () => { I.hot = true; });
  b.addEventListener('pointerleave', () => { I.hot = false; });
  chartDots.appendChild(b);
  I.dot = b;
});
function layoutChart() {
  const r = chartCanvas.getBoundingClientRect();
  CW = r.width || 248; CH = r.height || 136;
  chartCanvas.width = CW * 2; chartCanvas.height = CH * 2;
  ISLES.forEach((I, k) => {
    if (portrait()) { I.dot.style.left = `${22 + k * 42}px`; I.dot.style.top = '50%'; return; }
    const [u, v] = toMap(I.pos[0], I.pos[2]);
    I.dot.style.left = `${u}px`; I.dot.style.top = `${v}px`;
  });
}
function drawChart(t) {
  if (portrait()) return;
  const g = cx;
  g.setTransform(2, 0, 0, 2, 0, 0);
  g.clearRect(0, 0, CW, CH);
  // paper, latitude lines
  g.strokeStyle = 'rgba(29,39,66,.07)'; g.lineWidth = 1;
  for (let x = 0; x < CW; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, CH); g.stroke(); }
  for (let y = 0; y < CH; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(CW, y); g.stroke(); }
  // airship loop
  g.setLineDash([2, 4]); g.strokeStyle = 'rgba(239,125,92,.45)'; g.beginPath();
  for (let k = 0; k <= 64; k++) { const a = k / 64 * TAU; const [u, v] = toMap(SHIP.c.x + Math.cos(a) * SHIP.rx, SHIP.c.z + Math.sin(a) * SHIP.rz); k ? g.lineTo(u, v) : g.moveTo(u, v); }
  g.stroke();
  // the tour route
  g.setLineDash([3, 4]); g.strokeStyle = 'rgba(29,39,66,.5)'; g.lineWidth = 1.2; g.beginPath();
  const [su, sv] = toMap(0, 26); g.moveTo(su - 16, sv);
  ISLES.forEach(I => { const [u, v] = toMap(I.pos[0], I.pos[2]); g.lineTo(u, v); });
  g.stroke(); g.setLineDash([]);
  // soft island halos
  ISLES.forEach(I => { const [u, v] = toMap(I.pos[0], I.pos[2]); const grd = g.createRadialGradient(u, v, 2, u, v, 20); grd.addColorStop(0, 'rgba(140,201,255,.55)'); grd.addColorStop(1, 'rgba(140,201,255,0)'); g.fillStyle = grd; g.beginPath(); g.arc(u, v, 20, 0, TAU); g.fill(); });
  // the airship
  const [au, av] = toMap(shipPos.x, shipPos.z);
  if (au > 0 && au < CW && av > 0 && av < CH) {
    const [bu, bv] = toMap(shipPos.x + shipFwd.x, shipPos.z + shipFwd.z);
    g.save(); g.translate(au, av); g.rotate(Math.atan2(bv - av, bu - au));
    g.fillStyle = '#ef7d5c'; g.beginPath(); g.ellipse(0, 0, 6, 2.6, 0, 0, TAU); g.fill(); g.restore();
  }
  // you are here
  const [cu, cv] = toMap(camera.position.x, camera.position.z);
  const dir = tmp.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const [du, dv] = toMap(camera.position.x + dir.x, camera.position.z + dir.z);
  const ang = Math.atan2(dv - cv, du - cu);
  g.save(); g.translate(clamp(cu, 6, CW - 6), clamp(cv, 6, CH - 6)); g.rotate(ang);
  g.fillStyle = 'rgba(29,39,66,.12)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 26, -0.45, 0.45); g.closePath(); g.fill();
  g.fillStyle = '#1d2742'; g.beginPath(); g.moveTo(7, 0); g.lineTo(-5, -4.5); g.lineTo(-2.5, 0); g.lineTo(-5, 4.5); g.closePath(); g.fill();
  g.restore();
  // compass
  g.fillStyle = 'rgba(29,39,66,.55)'; g.font = '700 8px "Nunito Sans", sans-serif'; g.fillText('N ↑', CW - 22, 12);
}
engine.onResize(() => layoutChart());

// ─── Toast & booking ─────────────────────────────────────────────────────────
const toastEl = document.querySelector('.toast');
let toastTimer;
function toast(msg, ms = 3600) { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms); }
const form = document.querySelector('.booking');
const dateIn = form.querySelector('input[type=date]');
{ const d = new Date(Date.now() + 21 * 864e5); dateIn.value = d.toISOString().slice(0, 10); }
form.addEventListener('submit', e => {
  e.preventDefault();
  const sel = form.querySelector('select[name=dest]');
  const name = sel.options[sel.selectedIndex].text.split(' · ')[0];
  const pax = form.querySelector('select[name=pax]').value;
  toast(`${pax} ${pax === '1' ? 'berth' : 'berths'} to ${name} held for twenty minutes. (A demonstration — no airships were harmed.)`);
});

// ─── Frame loop ────────────────────────────────────────────────────────────────
let started = false;
let dusk = 0;
let shownPanel = -1;
const shadowSize = 46;
const vtmp = new V3(), lightDir = new V3();
engine.onTick((dt, t) => {
  pointer.update(dt);
  sky.uTime.value = t;
  renderer.shadowMap.needsUpdate = true;
  if (!started) return;

  // scroll → station
  const want = readScroll();
  const target = lock ?? want;
  if (target !== (fl.on ? fl.st : station)) fly(target);

  // time of day: morning over the islands, golden hour by the time you book
  const footIn = footEl.getBoundingClientRect().top < innerHeight * 0.72;
  document.body.classList.toggle('is-foot', footIn);
  const duskT = (fl.on ? fl.st : station) >= 6 ? 1 : (fl.on ? fl.st : station) === 5 ? 0.3 : 0;
  dusk = damp(dusk, duskT, 0.9, dt);
  const e = smooth(0, 1, dusk);
  sky.uSunDir.value.lerpVectors(DAY.skyDir, DUSK.skyDir, e).normalize();
  const sd = lightDir.lerpVectors(DAY.dir, DUSK.dir, e).normalize();
  sky.uZenith.value.lerpColors(DAY.zenith, DUSK.zenith, e);
  sky.uMid.value.lerpColors(DAY.mid, DUSK.mid, e);
  sky.uHorizon.value.lerpColors(DAY.horizon, DUSK.horizon, e);
  sky.uBelow.value.lerpColors(DAY.below, DUSK.below, e);
  sky.uSunCol.value.lerpColors(DAY.glow, DUSK.glow, e);
  clouds.uniforms.uLitC.value.lerpColors(DAY.lit, DUSK.lit, e);
  clouds.uniforms.uMidC.value.lerpColors(DAY.midC, DUSK.midC, e);
  clouds.uniforms.uShadowC.value.lerpColors(DAY.shadow, DUSK.shadow, e);
  sun.color.lerpColors(DAY.sun, DUSK.sun, e);
  sun.intensity = lerp(DAY.sunI, DUSK.sunI, e);
  hemi.intensity = lerp(DAY.hemiI, DUSK.hemiI, e);
  sky.uFogDensity.value = lerp(0.0032, 0.0022, e);
  sun.target.position.copy(ARCH);
  sun.position.copy(ARCH).addScaledVector(sd, 120);

  // camera
  placeShip(dt);
  if (fl.on) {
    fl.u = Math.min(1, fl.u + dt / fl.dur);
    const u = fl.u, k = ease(u);
    controls(t);
    bez(fl.p0, P1, P2, P3, k, cam.pos);
    bezD(fl.p0, P1, P2, P3, k, BT).normalize();
    // path curvature in the horizontal plane → how hard the ship-of-a-camera is turning
    const k2 = Math.min(1, k + 0.02);
    bezD(fl.p0, P1, P2, P3, k2, BP).normalize();
    let dpsi = Math.atan2(BP.x, -BP.z) - Math.atan2(BT.x, -BT.z); dpsi = Math.atan2(Math.sin(dpsi), Math.cos(dpsi));
    const kdot = (ease(Math.min(1, u + 0.005)) - ease(Math.max(0, u - 0.005))) / 0.01 / fl.dur;
    fl.turn = (k2 > k ? dpsi / (k2 - k) : 0) * kdot;
    const dOld = tmp.subVectors(fl.look0, cam.pos).normalize();
    const dNew = tmp2.subVectors(pose.look, cam.pos).normalize();
    const dir = fl.intro ? vtmp.copy(dOld).lerp(dNew, smooth(0.0, 0.7, u)).normalize()
      : vtmp.copy(dOld).lerp(BT, smooth(0.0, 0.35, u) * 0.85).lerp(dNew, smooth(0.42, 0.92, u)).normalize();
    // keep the horizon in frame while swooping low over the cloud sea
    const minY = lerp(-0.12, dNew.y, smooth(0.55, 0.95, u));
    if (dir.y < minY) { const h = Math.hypot(dir.x, dir.z) || 1, ny = minY, nh = Math.sqrt(1 - ny * ny); dir.set(dir.x / h * nh, ny, dir.z / h * nh); }
    cam.look.copy(cam.pos).addScaledVector(dir, 14);
    cam.fov = lerp(fl.fov0, pose.fov, k) + Math.pow(Math.sin(Math.PI * u), 2) * (REDUCED ? 0 : 13);
    if (u >= 1) {
      fl.on = false; station = fl.st;
      window.__atlasReady = true;
      cam.look.copy(pose.look);
      document.body.classList.remove('is-flying');
    }
  } else if (station >= 0) {
    poseOf(station, t, stLocal(station), pose);
    const lam = station === 5 ? 6 : 3;
    cam.pos.x = damp(cam.pos.x, pose.pos.x, lam, dt); cam.pos.y = damp(cam.pos.y, pose.pos.y, lam, dt); cam.pos.z = damp(cam.pos.z, pose.pos.z, lam, dt);
    cam.look.x = damp(cam.look.x, pose.look.x, lam, dt); cam.look.y = damp(cam.look.y, pose.look.y, lam, dt); cam.look.z = damp(cam.look.z, pose.look.z, lam, dt);
    cam.fov = damp(cam.fov, pose.fov, 3, dt);
  }
  // bank from lateral acceleration
  if (dt > 0) {
    const v = tmp.subVectors(cam.pos, cam.prev).divideScalar(dt);
    cam.vel.lerp(v, 1 - Math.exp(-10 * dt));
    const a = tmp2.subVectors(cam.vel, cam.prevVel).divideScalar(dt);
    cam.acc.lerp(a, 1 - Math.exp(-5 * dt));
    cam.prevVel.copy(cam.vel);
  }
  cam.prev.copy(cam.pos);
  const fwd = tmp3.subVectors(cam.look, cam.pos).normalize();
  const right = tmp4.crossVectors(fwd, UP).normalize();
  const yaw = Math.atan2(fwd.x, -fwd.z);
  let dyaw = yaw - (cam.yaw ?? yaw); dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  cam.yaw = yaw;
  cam.yawRate = damp(cam.yawRate ?? 0, dt > 0 ? dyaw / dt : 0, 4, dt);
  const bankEnv = fl.on ? Math.pow(Math.sin(Math.PI * clamp(fl.u * 1.15)), 0.7) : 0;
  const rollT = fl.on ? clamp((cam.yawRate * 0.45 + (fl.turn ?? 0) * 0.55) * bankEnv, -0.5, 0.5) : Math.sin(t * 0.3) * 0.008;
  cam.roll = damp(cam.roll, REDUCED ? 0 : rollT, 3.2, dt);
  const par = fl.on ? 0.15 : 1;
  camera.position.copy(cam.pos).addScaledVector(right, pointer.sx * 0.5 * par).addScaledVector(UP, pointer.sy * 0.3 * par);
  camera.up.copy(UP);
  camera.lookAt(cam.look);
  camera.rotateZ(cam.roll);
  if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
  dome.position.copy(camera.position);
  dust.material.uniforms.uCam.value.copy(camera.position);

  // wisps
  wispT += dt;
  const wa = smooth(0, 0.35, wispT) * (1 - smooth(wispDur * 0.72, wispDur + 0.6, wispT));
  for (const w of wisps) w.alpha = w.peak * wa;

  // islands: bob, hover glow, pins
  const cur0 = fl.on ? fl.st : station;
  let hit = null;
  if (!overUI && pointer.active && !portrait()) hit = pick(pointer.px, pointer.py);
  if (hit !== hovered) { hovered = hit; cur?.set(hit ? 'label' : '', hit ? 'Fly' : ''); }
  for (let k = 0; k < ISLES.length; k++) {
    const I = ISLES[k];
    I.bob.position.y = Math.sin(t * 0.42 + I.phase) * 0.22;
    I.bob.rotation.z = Math.sin(t * 0.31 + I.phase) * 0.012;
    I.bob.rotation.x = Math.sin(t * 0.27 + I.phase * 2) * 0.01;
    const hot = hovered === I || I.hot;
    I.hover.value = damp(I.hover.value, hot ? 1 : 0, 6, dt);
    const showAll = cur0 === 0 && !fl.on && !footIn;
    const on = !!I.model && (showAll || (hot && cur0 !== k + 1)) && !(fl.on && fl.u < 0.9);
    tmp.copy(I.top); tmp.y += I.bob.position.y * I.s;
    tmp.project(camera);
    const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
    I.pin.classList.toggle('on', on && vis);
    I.pin.classList.toggle('hot', hot);
    if (vis) {
      const hw = (I.pinW ??= I.pin.offsetWidth || 160) / 2 + 8;
      const px = clamp((tmp.x + 1) / 2 * innerWidth, hw, innerWidth - hw);
      const py = Math.max((1 - tmp.y) / 2 * innerHeight, portrait() ? 190 : 150);
      I.pin.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
    I.dot.classList.toggle('on', cur0 === k + 1);
  }
  whereEl.textContent = WHERE[cur0] ?? WHERE[0];
  const navOn = cur0 >= 1 && cur0 <= 4 ? 0 : cur0 === 5 ? 1 : cur0 === 6 ? 2 : -1;
  navLinks.forEach((a, i) => a.classList.toggle('is-active', i === navOn));

  // birds roost around whichever island you are visiting
  const roostI = cur0 >= 1 && cur0 <= 4 ? ISLES[cur0 - 1] : cur0 === 0 ? ISLES[0] : ISLES[2];
  flock.setRoost(tmp.copy(roostI.center).add(tmp2.set(0, 3.5, 0)), 7 * roostI.s);
  flock.update(Math.min(dt, 1 / 30), t);
  ship.userData.update(dt, t);
  placeHalcyon(dt, e > 0.5); halcyon.visible = e > 0.05; halcyon.userData.update(dt, t + 3);
  lamp.userData.update(t, 0.12 + e * 0.9);

  // panels: the destination ticket slides in as the camera settles into orbit
  // reveal early enough that the ticket is crisp by the time the camera settles: ~40% in, never later than 1.1 s
  let wantPanel = fl.on ? (fl.u * fl.dur > Math.min(fl.dur * 0.4, 1.1) ? fl.st : -1) : station;
  if (footIn && wantPanel === 6) wantPanel = -1;
  if (wantPanel !== shownPanel) {
    panels[shownPanel]?.classList.remove('is-on');
    panels[wantPanel]?.classList.add('is-on');
    shownPanel = wantPanel;
  }

  drawChart(t);
  clouds.update(camera);
  depthPass();
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
worldNav('atlas', { theme: 'light', corner: 'bl' });
magnetic();
layoutChart();
window.__atlas = { fly: i => goTo(i), flyOnly: i => { lock = i; fly(i); }, engine, cam, ISLES, debug: () => ({ t: +engine.time.toFixed(2), fl: { on: fl.on, u: +fl.u.toFixed(2), dur: +fl.dur.toFixed(2), st: fl.st }, station, fps: window.__fps, lock, cam: cam.pos.toArray().map(v => +v.toFixed(1)) }) };

await Promise.all(loads);
placeShip(0);
placeHalcyon(0, false);
flock.setRoost(ISLES[0].center, 7);
for (let k = 0; k < 90; k++) flock.update(1 / 30, k / 30);
// compile everything so the first frames do not hitch, then hold the camera down in the cloud sea
poseOf(0, 0, 0, pose);
camera.position.copy(pose.pos); camera.lookAt(pose.look); camera.updateMatrixWorld();
clouds.update(camera);
renderer.compile(scene, camera);
depthPass();
if (portrait()) cam.pos.copy(HERO.mpos).add(new V3(0, -18, 18));
camera.position.copy(cam.pos); camera.lookAt(cam.look); camera.updateMatrixWorld();
clouds.update(camera);
depthPass();
let introDone = false;
function beginIntro() {
  if (introDone) return;
  introDone = true;
  started = true;
  window.__atlasIntro = performance.now();
  cam.prev.copy(cam.pos);
  readScroll();
  fly(readScroll(), { dur: 5.2, intro: true });
}
engine.start();
document.fonts?.load('64px "Young Serif"').then(() => { ship.userData.refreshName?.(); halcyon.userData.refreshName?.(); });
await loader.finish();
beginIntro();
