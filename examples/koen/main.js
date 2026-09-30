import { Engine, THREE, normalize, prepModel, damp, clamp, smooth, lerp, range, studioEnvironment } from '../../src/core/engine.js';
import { Assets, firstMesh, url } from '../../src/core/assets.js';
import { Pointer } from '../../src/core/input.js';
import { smoothScroll, gsap, reveal } from '../../src/core/scroll.js';
import { preloader, cursor, magnetic, worldNav } from '../../src/core/ui.js';
import { bakeTexture, fbmNormal } from '../../src/core/textures.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Effect } from 'postprocessing';
import { U, patchTreeMaterial, treeDepthMaterial, patchBarkMaterial, barkDepthMaterial, analyze, growBranches, wireGeometry } from './tree.js';
import { Fall, Drift } from './particles.js';
import { treeState, worldState, wrap, seasonIndex } from './seasons.js';
import { Dial } from './dial.js';

const DBG = new URLSearchParams(location.search);
const MOBILE = matchMedia('(max-width: 900px)').matches;
const TREE_H = 1.75;
const SLAB_TOP = 0.085;
const D = Math.PI / 180;

document.querySelectorAll('[data-src]').forEach(img => { img.src = url(img.dataset.src); });

// ─── Paper: the frame is printed on washi ─────────────────────────────────────
class PaperEffect extends Effect {
  constructor() {
    super('KoenPaper', /* glsl */`
      uniform sampler2D tPaper; uniform vec2 uScale; uniform float uAmt;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        float p = texture2D(tPaper, uv * uScale).r;
        vec3 c = inputColor.rgb;
        float lum = dot(c, vec3(0.299, 0.587, 0.114));
        c *= 1.0 + (p - 0.5) * uAmt * mix(0.3, 1.0, lum);
        outputColor = vec4(c, inputColor.a);
      }`, { uniforms: new Map([['tPaper', new THREE.Uniform(null)], ['uScale', new THREE.Uniform(new THREE.Vector2(1, 1))], ['uAmt', new THREE.Uniform(0.06)]]) });
  }
}

// ─── Engine ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gl');
let paper;
const engine = new Engine({
  canvas, fov: 26, near: 0.05, far: 60, dpr: 1.75, background: 0xf1ece2,
  post: {
    ao: { aoRadius: 0.3, intensity: 2.2, distanceFalloff: 0.45 },
    bloom: { intensity: 0.3, luminanceThreshold: 1.25, luminanceSmoothing: 0.3, radius: 0.5 },
    tone: 'neutral',
    extra: () => [(paper = new PaperEffect())],
    vignette: { offset: 0.5, darkness: 0.34 },
    noise: 0.028,
  },
});
const { scene, camera, renderer } = engine;
scene.fog = new THREE.FogExp2(0xf1ece2, 0.02);
scene.environment = studioEnvironment(renderer, {
  top: 0x8a8378, bottom: 0x2a2621,
  panels: [
    { pos: [-6, 4, 5], size: [5, 4], intensity: 3, color: 0xfff2e2 },
    { pos: [6, 5, 3], size: [4, 5], intensity: 1.6, color: 0xf2f4ff },
    { pos: [0, 8, 0], size: [8, 3], intensity: 2, color: 0xffffff },
  ],
});
scene.environmentIntensity = 0.42;

const assets = new Assets();
const pointer = new Pointer({ lambda: 6 });
const loaderEl = document.querySelector('.loader');
const loader = preloader({
  assets, el: loaderEl, minTime: 1500,
  onValue: v => {
    loaderEl.querySelector('.loader-pct').textContent = String(Math.round(v * 100)).padStart(2, '0');
    loaderEl.style.setProperty('--p', (0.04 + v * 0.96).toFixed(3));
  },
  exit: async () => {
    await gsap.to('.loader-line, .loader-seal', { opacity: 0, duration: 0.5, ease: 'power2.in' });
    await gsap.to(loaderEl, { opacity: 0, duration: 1.1, ease: 'power2.inOut' });
  },
});

// ─── Studio: a washi cyclorama, a walnut slab ─────────────────────────────────
const washi = new THREE.TextureLoader().load(url('img/koen/washi.webp'), t => { paper.uniforms.get('tPaper').value = t; });
washi.wrapS = washi.wrapT = THREE.RepeatWrapping;
washi.colorSpace = THREE.NoColorSpace;
engine.onResize((w, h) => { paper?.uniforms.get('uScale').value.set(w / 1024, h / 1024); });

function cycGeometry() {
  const W = 40, wallZ = -3.9, cove = 2.0, front = 18, top = 16;
  const prof = [[front, 0], [wallZ + cove, 0]];
  for (let i = 1; i <= 24; i++) { const a = i / 24 * Math.PI / 2; prof.push([wallZ + cove - Math.sin(a) * cove, cove - Math.cos(a) * cove]); }
  prof.push([wallZ, top]);
  const pos = [], uv = [], idx = [];
  let acc = 0;
  prof.forEach(([z, y], i) => {
    if (i) acc += Math.hypot(z - prof[i - 1][0], y - prof[i - 1][1]);
    for (const x of [-W / 2, W / 2]) { pos.push(x, y, z); uv.push(x / 2.6, acc / 2.6); }
  });
  for (let i = 0; i < prof.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// An ensō brushed on the wall behind the tree (projected along z, so it follows the cove and takes the tree's shadow).
const ensoTex = new THREE.TextureLoader().load(url('img/koen/enso.webp'));
ensoTex.colorSpace = THREE.SRGBColorSpace;
ensoTex.anisotropy = 8;
const cycU = { uWallC: { value: new THREE.Color() }, uFloorC: { value: new THREE.Color() }, uEnso: { value: ensoTex },
  uEnsoC: { value: new THREE.Vector2(1.1, 1.24) }, uEnsoS: { value: 2.45 }, uEnsoA: { value: 0.9 } };
const cycMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0, map: washi, envMapIntensity: 0.3 });
cycMat.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, cycU);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vKw;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKw = (modelMatrix * vec4(position, 1.)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vKw; uniform vec3 uWallC, uFloorC; uniform sampler2D uEnso; uniform vec2 uEnsoC; uniform float uEnsoS, uEnsoA;')
    .replace('#include <map_fragment>', `
      float kp = texture2D(map, vMapUv).r;
      diffuseColor.rgb *= mix(uFloorC, uWallC, smoothstep(0.1, 2.4, vKw.y)) * (0.965 + 0.05 * kp);
      vec2 eu = (vKw.xy - uEnsoC) / uEnsoS + 0.5;
      if (uEnsoA > 0.01 && vKw.z < -1.6 && eu.x > 0. && eu.x < 1. && eu.y > 0. && eu.y < 1.) {
        float ink = clamp(texture2D(uEnso, eu).a * uEnsoA * 1.15, 0., 1.) * (0.93 + 0.07 * kp);
        vec3 cs = pow(diffuseColor.rgb, vec3(1. / 2.2));
        diffuseColor.rgb = pow(mix(cs, vec3(0.1, 0.09, 0.085), ink), vec3(2.2));
      }`);
};
const cyc = new THREE.Mesh(cycGeometry(), cycMat);
cyc.receiveShadow = true;
scene.add(cyc);

// Walnut slab (jita) under the pot.
const woodAlbedo = bakeTexture(renderer, 1024, `
  void main(){
    float n = fbm(vUv * 3.0, 3.0, 5, 0.55);
    float w = fbm(vec2(vUv.x * 2.0, vUv.y * 12.0), 2.0, 4, 0.5);
    float rings = sin((vUv.y * 30.0 + n * 5.0 + w * 2.0) * 6.2831853);
    float fine = fbm(vec2(vUv.x * 64.0, vUv.y * 2.0), 64.0, 3, 0.5);
    vec3 dark = vec3(0.036, 0.022, 0.014), mid = vec3(0.085, 0.052, 0.032), light = vec3(0.13, 0.082, 0.05);
    vec3 col = mix(dark, mid, 0.5 + 0.5 * rings);
    col = mix(col, light, smoothstep(0.55, 0.95, rings) * 0.5 + fine * 0.25);
    col *= 0.85 + n * 0.4;
    gl_FragColor = vec4(col, 1.0);
  }`);
const woodRough = bakeTexture(renderer, 512, `void main(){ float r = 0.36 + fbm(vec2(vUv.x * 40.0, vUv.y * 3.0), 40.0, 3, 0.5) * 0.18 + fbm(vUv * 4.0, 4.0, 4, 0.5) * 0.12; gl_FragColor = vec4(1., clamp(r, .1, 1.), 0., 1.); }`);
woodAlbedo.colorSpace = THREE.SRGBColorSpace;
const slab = new THREE.Mesh(new RoundedBoxGeometry(1.62, SLAB_TOP, 0.98, 5, 0.03),
  new THREE.MeshStandardMaterial({ map: woodAlbedo, roughnessMap: woodRough, roughness: 1, metalness: 0, envMapIntensity: 0.45, color: 0xffffff }));
patchBarkMaterial(slab.material, 'koen-slab');
slab.position.y = SLAB_TOP / 2;
slab.castShadow = slab.receiveShadow = true;
scene.add(slab);
const SLAB = { x: 0.81, z: 0.49 };

// ─── Light ─────────────────────────────────────────────────────────────────────
const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 3);
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
Object.assign(key.shadow.camera, { left: -3.6, right: 3.6, top: 3.6, bottom: -3.6, near: 1, far: 24 });
key.shadow.bias = -0.00022;
key.shadow.normalBias = 0.018;
const keyTarget = new THREE.Object3D();
keyTarget.position.set(0, 0.9, -1.1);
key.target = keyTarget;
scene.add(key, keyTarget);
const fill = new THREE.DirectionalLight(0xffffff, 0.4);
scene.add(fill, fill.target);
const rim = new THREE.DirectionalLight(0xffffff, 0.9);
rim.position.set(1.5, 4, -5);
scene.add(rim);

// ─── Tree ─────────────────────────────────────────────────────────────────────
const treeRoot = new THREE.Group();
scene.add(treeRoot);
let A = null, treeMesh = null, twigs = null, wire = null, wireInfo = null;
const barkN = fbmNormal(renderer, { size: 512, scale: 6, octaves: 5, strength: 2.2 });
barkN.repeat.set(1, 8);

const modelUrl = DBG.get('m') ?? 'models/koen/maple2.glb';
const treeLoad = assets.gltf(modelUrl).then(g => {
  const m = g.scene;
  m.rotation.y = +(DBG.get('rot') ?? 0) * D;
  normalize(m, TREE_H, { axis: 'y' });
  m.position.y += SLAB_TOP;
  prepModel(m, renderer, { env: 0.8, metal: 0 });
  treeRoot.add(m);
  m.updateMatrixWorld(true);
  treeMesh = firstMesh(m);
  A = analyze(treeMesh);
  treeMesh.geometry.setAttribute('aFol', new THREE.BufferAttribute(A.vertexFoliage, 1));
  U.uFolY0.value = A.folY0; U.uFolY1.value = A.folY1;
  U.uSwayY0.value = A.potTop + 0.03 * A.H; U.uSwayY1.value = A.box.max.y;
  U.uInvModel.value.setFromMatrix4(treeMesh.matrixWorld).invert();
  A.trunk.slice(0, 24).forEach((p, i) => U.uTrunk.value[i].copy(p));
  U.uTrunkN.value = Math.min(24, A.trunk.length);
  U.uTrunkR.value.set(0.105 * A.H / 1.75, 0.05 * A.H / 1.75, A.potTop, A.trunk[A.trunk.length - 1].y);
  const map = treeMesh.material.map;
  patchTreeMaterial(treeMesh.material);
  treeMesh.customDepthMaterial = treeDepthMaterial(map);

  // Winter structure: branches grown into each foliage pad.
  const br = growBranches(A);
  const barkMat = patchBarkMaterial(new THREE.MeshStandardMaterial({ color: 0x5a3f2d, roughness: 0.86, normalMap: barkN, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 0.6 }));
  twigs = new THREE.Mesh(br.geometry, barkMat);
  twigs.castShadow = true; twigs.receiveShadow = true;
  twigs.customDepthMaterial = barkDepthMaterial();
  scene.add(twigs);
  // Copper wire on the branch that faces the camera best.
  const score = m => { const a = m.curve.getPointAt(0), b = m.curve.getPointAt(1); return Math.abs(b.x - a.x) * 2 - Math.abs(b.z - a.z) + (m.pad.center.z > -0.15 ? 0.3 : -1) + Math.min(m.len, 14) * 0.02 + (m.pad.center.x > 0 ? 0.25 : 0); };
  const pick = [...br.mains].filter(m => m.len >= 6).sort((a, b) => score(b) - score(a))[0];
  if (pick) {
    wireInfo = wireGeometry(pick.curve, pick.radiusAt, { wire: 0.0042 * A.H / 1.75, from: 0.06, to: 0.74 });
    wireInfo.anchor = pick.curve.getPointAt(0.42);
    const w0 = pick.curve.getPointAt(0), w1 = pick.curve.getPointAt(1);
    wireInfo.view = w0.clone().lerp(w1, MOBILE ? 0.3 : 0.62);
    wireInfo.len = w0.distanceTo(w1);
    const dx = w1.x - w0.x, dz = w1.z - w0.z;
    let az = Math.atan2(dx, dz) + Math.PI / 2;               // perpendicular to the branch
    if (Math.cos(az) * dx - Math.sin(az) * dz < 0) az += Math.PI; // trunk end on the left
    wireInfo.az = Math.atan2(Math.sin(az), Math.cos(az));
    const copper = patchBarkMaterial(new THREE.MeshStandardMaterial({ color: 0xd7895a, metalness: 0.85, roughness: 0.32, envMapIntensity: 2.2, emissive: 0x3a1a0a, emissiveIntensity: 0.5 }), 'koen-copper', { snow: 0.15 });
    wire = new THREE.Mesh(wireInfo.geometry, copper);
    wire.castShadow = true;
    wire.customDepthMaterial = barkDepthMaterial();
    wire.geometry.setDrawRange(0, 0);
    scene.add(wire);
  }
  if (DBG.has('noleafmesh')) treeMesh.visible = false;
  if (DBG.has('mask')) U.uDbg.value = 1;
  if (DBG.has('notwigs')) twigs.visible = false;
}).catch(e => { console.warn('maple missing', e?.message ?? e); });

// ─── Falling things ───────────────────────────────────────────────────────────
const groundAt = (x, z) => {
  const g = A ? A.groundAt(x, z) : -1;
  if (g > 0) return g;
  if (Math.abs(x) < SLAB.x - 0.02 && Math.abs(z) < SLAB.z - 0.02) return SLAB_TOP;
  return 0;
};
const fall = new Fall(scene, { count: 2200, groundAt });
const snow = new Drift(scene, { count: 7000, color: 0xffffff, size: 6.5, speed: 0.34, swirl: 0.11, box: [-3.2, 0, -3.2, 3.2, 3.4, 3.8] });
const motes = new Drift(scene, { count: 1100, color: 0xfff1cf, size: 3.2, speed: -0.015, swirl: 0.3, bright: 1.25, box: [-2.6, 0.1, -2.2, 2.6, 2.6, 2.6] });
engine.onResize((w, h, dpr) => { snow.uniforms.uDpr.value = dpr * h / 900; motes.uniforms.uDpr.value = dpr * h / 900; });

const PAL_AUTUMN = ['#b3261e', '#c8321f', '#d2553b', '#a61e1a', '#e06a2c', '#8e1b17', '#d9442a', '#e89a34'].map(h => new THREE.Color(h));
const PAL_SPRING = ['#f7d9dd', '#f3c5cc', '#fbe7e8', '#eeb8c1'].map(h => new THREE.Color(h));
const PAL_GREEN = ['#5d8a2c', '#6f9a35', '#4f7a26'].map(h => new THREE.Color(h));
const pickC = p => p[Math.floor(Math.random() * p.length)];
const tmpC = new THREE.Color();
const tmpV = new THREE.Vector3(), tmpW = new THREE.Vector3(), tmpQ = new THREE.Vector3();
const wind = new THREE.Vector3(-0.08, 0, 0.03);
function spawnLeaf(ts, { burst = false, near = null, landed = 0 } = {}) {
  if (!A || !A.spawn.count) return;
  let i = Math.floor(Math.random() * A.spawn.count);
  if (near) { // pick the spawn point closest to a random handful near the pointer ray
    let bd = Infinity;
    for (let k = 0; k < 24; k++) {
      const j = Math.floor(Math.random() * A.spawn.count);
      tmpV.fromArray(A.spawn.position, j * 3);
      const d = tmpV.distanceToSquared(near);
      if (d < bd) { bd = d; i = j; }
    }
  }
  tmpV.fromArray(A.spawn.position, i * 3);
  tmpW.fromArray(A.spawn.normal, i * 3);
  tmpV.addScaledVector(tmpW, 0.02);
  const aut = ts.autumn > 0.45;
  if (aut) tmpC.copy(pickC(PAL_AUTUMN)).lerp(new THREE.Color('#6b3a1c'), ts.cover < 0.4 ? Math.random() * 0.5 : Math.random() * 0.15);
  else tmpC.copy(pickC(PAL_GREEN)).lerp(new THREE.Color('#b6c94a'), ts.fresh * 0.6);
  tmpC;
  fall.spawn({
    p0: tmpV, drift: tmpQ.set(wind.x + (Math.random() - 0.5) * 0.12, 0, wind.z + (Math.random() - 0.5) * 0.12),
    speed: (burst ? 0.34 : 0.26) + Math.random() * 0.16, kind: Math.random() < 0.72 ? 0 : 1, color: tmpC,
    size: (0.052 + Math.random() * 0.03) * TREE_H / 1.75, life: 70 + Math.random() * 60 + landed, spin: 1.2 + Math.random() * 2.6, flutter: 0.05 + Math.random() * 0.09, landed,
  });
}
function spawnSamara() {
  if (!A) return;
  const i = Math.floor(Math.random() * A.spawn.count);
  tmpV.fromArray(A.spawn.position, i * 3);
  tmpC.set(Math.random() < 0.5 ? '#b56a3c' : '#c58e5a');
  fall.spawn({ p0: tmpV, drift: tmpQ.set(wind.x * 1.6 + (Math.random() - 0.5) * 0.1, 0, wind.z), speed: 0.42 + Math.random() * 0.12, kind: 3, color: tmpC,
    size: 0.05, life: 40, spin: 3 + Math.random() * 2, flutter: 0.02 });
}
function spawnPetal() {
  tmpV.set(-2.6 + Math.random() * 3.0, 1.9 + Math.random() * 1.0, -1.2 + Math.random() * 3.0);
  tmpC.copy(pickC(PAL_SPRING));
  fall.spawn({ p0: tmpV, drift: tmpQ.set(0.26 + Math.random() * 0.2, 0, 0.04 + (Math.random() - 0.5) * 0.1), speed: 0.15 + Math.random() * 0.09, kind: 2, color: tmpC,
    size: 0.032 + Math.random() * 0.014, life: 16, spin: 1 + Math.random() * 1.5, flutter: 0.1 + Math.random() * 0.1 });
}
function spawnSnowClump(near) {
  if (!A) return;
  const i = Math.floor(Math.random() * A.spawn.count);
  tmpV.fromArray(A.spawn.position, i * 3);
  if (near) tmpV.lerp(near, 0.35);
  tmpC.setRGB(0.92, 0.94, 0.97);
  fall.spawn({ p0: tmpV, drift: tmpQ.set((Math.random() - 0.5) * 0.08, 0, (Math.random() - 0.5) * 0.08), speed: 0.7 + Math.random() * 0.4, kind: 2, color: tmpC,
    size: 0.012 + Math.random() * 0.012, life: 5, spin: 4, flutter: 0.01 });
}

// ─── Scroll keys: camera + season per scroll position ─────────────────────────
const $ = s => document.querySelector(s);
const secs = { seasons: $('.seasons'), nursery: $('.nursery'), craft: $('.craft'), visit: $('.visit'), foot: $('.foot') };
let KEYS = [];
const cam = { az: -0.3, el: 0.1, dist: 5.3, tx: 0, ty: 0.92, tz: 0, ox: 0.2, oy: 0, en: 0.9 };
function prunePad() { return A?.pads?.length ? [...A.pads].filter(p => p.center.y < A.box.max.y - 0.35 * A.H).sort((a, b) => (b.center.z - b.center.x * 0.3) - (a.center.z - a.center.x * 0.3))[0] : null; }
function topOf(el) { let y = 0; while (el) { y += el.offsetTop; el = el.offsetParent; } return y; }
function layout() {
  const vh = innerHeight;
  const sT = topOf(secs.seasons), sL = secs.seasons.offsetHeight - vh, c = sL / 4;
  const nT = topOf(secs.nursery), nH = secs.nursery.offsetHeight;
  const cT = topOf(secs.craft), cL = secs.craft.offsetHeight - vh, k = cL / 3;
  const vT = topOf(secs.visit), fT = topOf(secs.foot);
  const m = MOBILE;
  const ox = v => (m ? 0 : v);
  const pad = prunePad()?.center ?? new THREE.Vector3(-0.3, 0.8, 0.3);
  const paz = Math.atan2(pad.x, pad.z) * 0.8;
  const wa = wireInfo?.view ?? new THREE.Vector3(0.3, 1.0, 0.2);
  const waz = wireInfo?.az ?? 0.2, wd = clamp((wireInfo?.len ?? 0.5) * 2.9, 1.5, 2.6);
  const potTop = A?.potTop ?? 0.4;
  const base = { tx: 0, tz: 0, oy: m ? -0.075 : 0, en: 0 };
  const K = (y, o) => ({ y, ...base, ...o });
  const asp = innerWidth / innerHeight;
  const d = asp < 1 ? 1 + (1 / asp - 1) * 0.6 : 1; // pull back on narrow screens
  KEYS = [
    K(0, { az: -0.34, el: 0.1, dist: 5.85 * d, ty: 0.9, ox: ox(0.2), s: 2.0, oy: m ? 0.2 : -0.035, en: 0.9 }),
    K(sT, { az: -0.2, el: 0.12, dist: 4.8 * d, ty: 0.92, ox: ox(0.17), s: 2.02, en: 0.55 }),
    K(sT + c * 0.55, { az: -0.08, el: 0.2, dist: 4.7 * d, ty: 0.78, ox: ox(0.17), s: 2.42 }),
    K(sT + c * 1.2, { az: 0.08, el: 0.17, dist: 4.4 * d, ty: 0.95, ox: ox(0.17), s: 3.08 }),
    K(sT + c * 1.6, { az: 0.14, el: 0.16, dist: 4.3 * d, ty: 0.95, ox: ox(0.17), s: 3.14 }),
    K(sT + c * 2.25, { az: 0.28, el: 0.09, dist: 4.55 * d, ty: 0.92, ox: ox(0.17), s: 4.0 }),
    K(sT + c * 2.6, { az: 0.32, el: 0.09, dist: 4.55 * d, ty: 0.92, ox: ox(0.17), s: 4.04 }),
    K(sT + c * 3.3, { az: 0.44, el: 0.05, dist: 4.7 * d, ty: 0.95, ox: ox(0.17), s: 5.0 }),
    K(sT + c * 4, { az: 0.48, el: 0.06, dist: 4.8 * d, ty: 0.95, ox: ox(0.17), s: 5.02 }),
    K(nT - vh * 0.45, { az: 0.6, el: 0.16, dist: 5.9 * d, ty: 0.85, ox: ox(-0.22), s: 5.14, oy: m ? -0.22 : 0 }),
    K(nT + nH - vh, { az: 0.74, el: 0.22, dist: 6.0 * d, ty: 0.8, ox: ox(-0.23), s: 5.28, oy: m ? -0.22 : 0 }),
    K(cT, { az: paz * 0.75, el: 0.24, dist: 3.3 * d, tx: pad.x, ty: pad.y + 0.05, tz: pad.z, ox: ox(0.25), s: 5.2, oy: m ? -0.12 : 0 }),
    K(cT + k * 0.6, { az: paz * 0.75 + 0.1, el: 0.22, dist: 3.15 * d, tx: pad.x, ty: pad.y + 0.05, tz: pad.z, ox: ox(0.25), s: 5.26, oy: m ? -0.12 : 0 }),
    K(cT + k * 1.05, { az: waz + 0.1, el: 0.2, dist: wd * 1.08 * d, tx: wa.x, ty: wa.y, tz: wa.z, ox: ox(0.31), s: 6.9, oy: m ? -0.12 : 0 }),
    K(cT + k * 1.6, { az: waz - 0.02, el: 0.16, dist: wd * 1.02 * d, tx: wa.x, ty: wa.y, tz: wa.z, ox: ox(0.31), s: 6.92, oy: m ? -0.12 : 0 }),
    K(cT + k * 2.1, { az: 0.5, el: 0.2, dist: 3.1 * d, tx: 0.05, ty: potTop + 0.02, tz: 0.05, ox: ox(0.28), s: 7.74, oy: m ? -0.12 : -0.08 }),
    K(cT + k * 3, { az: 0.4, el: 0.22, dist: 3.2 * d, tx: 0.05, ty: potTop + 0.02, tz: 0.05, ox: ox(0.28), s: 7.78, oy: m ? -0.12 : -0.08 }),
    K(vT - vh * 0.45, { az: -0.4, el: 0.1, dist: 5.7 * d, ty: 0.95, ox: ox(0.24), s: 10.0, oy: m ? -0.24 : 0, en: 0.85 }),
    K(fT, { az: -0.46, el: 0.14, dist: 6.0 * d, ty: 1.0, ox: ox(0.24), s: 10.02, oy: m ? -0.24 : 0, en: 0.85 }),
  ];
  secs._s = { sT, sL, cT, cL, nT, vT, fT };
}
const CAMK = ['az', 'el', 'dist', 'tx', 'ty', 'tz', 'ox', 'oy', 's', 'en'];
const keyOut = {};
function sample(y) {
  const K = KEYS;
  if (y <= K[0].y) { for (const k of CAMK) keyOut[k] = K[0][k]; return keyOut; }
  for (let i = 0; i < K.length - 1; i++) {
    const a = K[i], b = K[i + 1];
    if (y <= b.y) {
      const t = smooth(0, 1, (y - a.y) / Math.max(1, b.y - a.y));
      for (const k of CAMK) keyOut[k] = lerp(a[k], b[k], t);
      return keyOut;
    }
  }
  const L = K[K.length - 1];
  for (const k of CAMK) keyOut[k] = L[k];
  return keyOut;
}

// ─── UI ────────────────────────────────────────────────────────────────────────
const root = document.documentElement;
const body = document.body;
let manual = null;
let season = 1.55;
let intro = 0;
const dial = new Dial($('.dial'), {
  onStart: () => { manual = { s: season, y: scrollY }; },
  onInput: f => {
    if (!manual) manual = { s: season, y: scrollY };
    const cur = manual.s;
    let d = f - wrap(cur); if (d > 2) d -= 4; if (d < -2) d += 4;
    manual.s = cur + d;
    manual.y = scrollY;
  },
  onEnd: () => { if (manual) manual.y = scrollY; },
});
const railLis = [...document.querySelectorAll('.rail li')];
const seasonArts = [...document.querySelectorAll('.season-copy article'), ...document.querySelectorAll('.season-glyph span')];
const craftArts = [...document.querySelectorAll('.craft-steps article')];
const craftIdx = [...document.querySelectorAll('.craft-index li')];
const progEl = $('.season-progress');
const craftPin = $('.craft-pin');
const callout = $('.callout'), calloutLine = callout.querySelector('line'), calloutDot = callout.querySelector('circle'), calloutP = callout.querySelector('p');
const CALLOUTS = [
  { label: 'Sentei · June', text: 'Cut above the second pair of leaves.' },
  { label: 'Harigane · 3.5 mm copper', text: 'Wound at forty-five degrees, a third the thickness of the branch.' },
  { label: 'Nebari', text: 'The root flare — 180 years in the making.' },
];
let lastY = 0, lastSI = -1, lastCI = -1, lastAccent = '';
const dividers = [...document.querySelectorAll('.brush-divider')];

// Nursery hover preview.
const preview = $('.preview'), previewImg = preview.querySelector('img');
document.querySelectorAll('.catalogue li[data-img]').forEach(li => {
  li.addEventListener('pointerenter', () => { previewImg.src = url(li.dataset.img); preview.classList.add('on'); });
  li.addEventListener('pointerleave', () => preview.classList.remove('on'));
});
const catEl = $('.catalogue');
let overCanvas = true;
addEventListener('pointermove', e => {
  overCanvas = e.target === canvas;
  const r = catEl.getBoundingClientRect();
  preview.style.transform = `translate3d(${(r.left - 250).toFixed(0)}px, ${(e.clientY - 160).toFixed(0)}px, 0) rotate(-2.5deg)`;
}, { passive: true });

// ─── Interaction: breeze on hover, shake on touch ─────────────────────────────
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hover = 0, hovering = false, shakeT = -10, shakeA = 0;
const hitPoint = new THREE.Vector3();
function treeHit() {
  if (!A) return false;
  ndc.set(pointer.x, pointer.y);
  ray.setFromCamera(ndc, camera);
  let best = Infinity;
  const sph = new THREE.Sphere();
  for (const p of A.pads) {
    sph.set(p.center, p.radius * 0.85);
    const hit = ray.ray.intersectSphere(sph, tmpW);
    if (hit) { const d = hit.distanceTo(ray.ray.origin); if (d < best) { best = d; hitPoint.copy(hit); } }
  }
  if (best === Infinity) {
    sph.set(new THREE.Vector3(0, A.potTop + 0.12, 0), 0.32);
    if (ray.ray.intersectSphere(sph, tmpW)) { hitPoint.copy(tmpW); return true; }
  }
  return best < Infinity;
}
let cur = null;
function shake() {
  const ts = treeState(season);
  shakeT = engine.time;
  shakeA = 1;
  U.uShakeDir.value.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
  if (ts.cover > 0.2 && ts.autumn > 0.5) for (let i = 0; i < 110 * ts.cover; i++) spawnLeaf(ts, { burst: true, near: i % 5 < 3 ? hitPoint : null });
  else if (ts.cover > 0.2) { for (let i = 0; i < 9; i++) spawnLeaf(ts, { burst: true, near: hitPoint }); if (wrap(season) > 1.3) for (let i = 0; i < 6; i++) spawnSamara(); }
  if (ts.snow > 0.3) for (let i = 0; i < 90; i++) spawnSnowClump(hitPoint);
  if (ts.cover < 0.2 && ts.snow < 0.3) for (let i = 0; i < 4; i++) spawnSamara();
}
// Pruning: a few shoots are cut and drift down when the step opens.
function snip() {
  const pad = prunePad(); if (!pad) return;
  const ts = treeState(season);
  for (let i = 0; i < 14; i++) spawnLeaf(ts, { burst: true, near: tmpQ.copy(pad.center).add(tmpW.set((Math.random() - 0.5) * 0.3, pad.std.y, (Math.random() - 0.5) * 0.3)) });
  shakeT = engine.time; shakeA = 0.35;
}
canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !intro) return;
  if (treeHit()) shake();
});

const NZ = new THREE.Vector3(0, 0, 1), NY = new THREE.Vector3(0, 1, 0);
const _L = new THREE.Vector3(), _E = new THREE.Color(), _c = new THREE.Color();
const PAPER_GAIN = +(DBG.get('pg') ?? 1.1);
function paperAlbedo(out, target, n) {
  _E.setRGB(0.06, 0.06, 0.06); // environment, roughly
  for (const l of [key, fill, rim]) {
    _L.copy(l.position).sub(l.target ? l.target.position : keyTarget.position).normalize();
    const d = Math.max(0, n.dot(_L));
    _E.r += l.color.r * l.intensity * d / Math.PI; _E.g += l.color.g * l.intensity * d / Math.PI; _E.b += l.color.b * l.intensity * d / Math.PI;
  }
  const hw = 0.5 + 0.5 * n.y;
  _c.copy(hemi.groundColor).lerp(hemi.color, hw).multiplyScalar(hemi.intensity / Math.PI);
  _E.add(_c);
  out.setRGB(target.r / _E.r, target.g / _E.g, target.b / _E.b).multiplyScalar(PAPER_GAIN);
}

// ─── Frame loop ────────────────────────────────────────────────────────────────
let leafAcc = 0, petalAcc = 0, samaraAcc = 0, cleared = true, frameN = 0;
const tgt = new THREE.Vector3();
const forced = DBG.has('s') ? +DBG.get('s') : null;
engine.onTick((dt, t) => {
  pointer.update(dt);
  const y = scrollY;
  const k = sample(y);
  for (const n of ['az', 'el', 'dist', 'tx', 'ty', 'tz', 'ox', 'oy', 'en']) cam[n] = damp(cam[n], k[n], 4.2, dt);
  cycU.uEnsoA.value = cam.en;

  // Season: scroll by default; the dial overrides until you scroll on.
  if (manual && !dial.dragging && Math.abs(y - manual.y) > innerHeight * 0.4) {
    season += 4 * Math.round((k.s - season) / 4);
    manual = null;
  }
  let target = manual ? manual.s : k.s - (1 - intro) * 0.5;
  if (forced !== null) target = forced;
  season = damp(season, target, manual ? 5 : 2.6, dt);
  const ts = treeState(season);
  const ws = worldState(season);

  // Camera.
  const introPush = (1 - intro) * 1.4;
  const dist = cam.dist + introPush;
  const ce = Math.cos(cam.el);
  const az = cam.az + pointer.sx * 0.035 + (1 - intro) * -0.12;
  tgt.set(cam.tx, cam.ty, cam.tz);
  camera.position.set(tgt.x + Math.sin(az) * ce * dist, tgt.y + Math.sin(cam.el) * dist + pointer.sy * 0.04 + Math.sin(t * 0.3) * 0.008, tgt.z + Math.cos(az) * ce * dist);
  camera.lookAt(tgt);
  const w = innerWidth, h = innerHeight;
  camera.setViewOffset(w, h, -cam.ox * w, -cam.oy * h, w, h);

  // World.
  scene.fog.color.copy(ws.fog); scene.fog.density = ws.fogD;
  renderer.setClearColor(ws.fog);
  hemi.color.copy(ws.sky); hemi.groundColor.copy(ws.ground); hemi.intensity = ws.hemiI * 1.3;
  key.color.copy(ws.key); key.intensity = ws.keyI;
  const kaz = ws.az * D, kel = ws.el * D;
  key.position.set(Math.sin(kaz) * Math.cos(kel), Math.sin(kel), Math.cos(kaz) * Math.cos(kel)).multiplyScalar(11).add(keyTarget.position);
  key.shadow.radius = ws.soft;
  fill.position.set(-Math.sin(kaz) * 5, 2.5, 4); fill.color.copy(ws.wall); fill.intensity = 0.55;
  rim.color.copy(ws.key).lerp(_c.set(0xffc996), ts.snow * 0.8); rim.intensity = 0.7 + ts.autumn * 0.5 + ts.snow * 2.4;
  U.uWarm.value.setRGB(1 + 0.2 * ts.snow, 1 + 0.03 * ts.snow, 1 - 0.14 * ts.snow);
  // Calibrate the paper so its lit tone lands on the season's colour; only the key's share falls into shadow.
  paperAlbedo(cycU.uWallC.value, ws.wall, NZ);
  paperAlbedo(cycU.uFloorC.value, ws.floor, NY);

  // Tree uniforms.
  U.uTime.value = t;
  U.uCover.value = ts.cover; U.uAutumn.value = ts.autumn; U.uFresh.value = ts.fresh; U.uDeep.value = ts.deep; U.uSnow.value = ts.snow;
  U.uGlow.value = ws.glow;
  // Breeze: hovering the canopy wakes the wind; pointer speed gusts it.
  if ((frameN++ & 3) === 0) overCanvas = pointer.active && document.elementFromPoint(pointer.px, pointer.py) === canvas;
  hovering = intro > 0.5 && pointer.active && !MOBILE && overCanvas && !engine.paused && treeHit();
  hover = damp(hover, hovering ? 1 : 0, 3, dt);
  const gust = clamp(Math.hypot(pointer.vx, pointer.vy) * 0.25 * hover);
  U.uBreeze.value = damp(U.uBreeze.value, 0.16 + hover * 0.7 + gust * 0.8, 2.5, dt);
  if (Math.abs(pointer.vx) > 0.02) U.uWind.value.x = damp(U.uWind.value.x, Math.sign(pointer.vx), 2 * hover, dt);
  U.uWind.value.normalize();
  const st = t - shakeT;
  U.uShake.value = shakeA * Math.exp(-st * 3.4) * Math.sin(st * 19);
  if (cur) cur.set(hovering ? 'label' : '', hovering ? (ts.snow > 0.3 ? 'shake snow' : 'shake') : '');
  if (hovering && Math.random() < dt * 0.6 * hover && ts.cover > 0.4 && ts.autumn > 0.5) spawnLeaf(ts, { near: hitPoint });

  // Particles.
  wind.set(-0.08 + Math.sin(t * 0.13) * 0.03 - hover * 0.04, 0, 0.03);
  leafAcc += ws.leafRate * (ts.cover > 0.04 ? 1 : 0) * dt * intro;
  while (leafAcc > 1) { spawnLeaf(ts); leafAcc -= 1; }
  petalAcc += ws.petals * 6 * dt * intro;
  while (petalAcc > 1) { spawnPetal(); petalAcc -= 1; }
  const f = wrap(season);
  samaraAcc += (f > 1.45 && f < 2.2 ? 0.25 : 0) * dt * intro;
  while (samaraAcc > 1) { spawnSamara(); samaraAcc -= 1; }
  if (!cleared && (f > 3.5 || f < 1.5)) { fall.clearLanded(3); cleared = true; }
  if (f > 1.8 && f < 3.4) cleared = false;
  fall.uniforms.uSnow.value = ts.snow;
  fall.update(dt, wind);
  snow.uniforms.uFogCol.value.copy(ws.fog); snow.uniforms.uFogD.value = ws.fogD;
  snow.update(dt, t, ws.snowfall, tmpQ.set(wind.x * 0.8, 0, wind.z));
  motes.uniforms.uFogCol.value.copy(ws.fog); motes.uniforms.uFogD.value = ws.fogD;
  motes.update(dt, t, ws.motes * 0.9, tmpQ.set(0.02, 0.01, 0));
  if (wire && wireInfo) {
    const { cT, cL } = secs._s;
    const p = range(y, cT + cL / 3 * 0.45, cT + cL / 3 * 1.3);
    wire.geometry.setDrawRange(0, Math.floor(p * wireInfo.segs) * wireInfo.radial * 6);
    wire.visible = p > 0.001;
  }

  // Page chrome.
  const accent = '#' + ws.accent.getHexString();
  if (accent !== lastAccent) {
    root.style.setProperty('--accent', accent); lastAccent = accent;
    _c.copy(ws.fog).convertLinearToSRGB();
    root.style.setProperty('--scene-rgb', `${Math.round(_c.r * 255)}, ${Math.round(_c.g * 255)}, ${Math.round(_c.b * 255)}`);
  }
  dial.set(season, 180 + Math.floor((season - 2 + 0.5) / 4));
  body.classList.toggle('is-scrolled', y > 60);
  if (Math.abs(y - lastY) > 4) { body.classList.toggle('nav-hide', y > lastY && y > innerHeight * 0.7); lastY = y; }
  const { sT, sL, cT, cL, fT } = secs._s;
  const inSeasons = y > sT - innerHeight * 0.3 && y < sT + sL + innerHeight * 0.2;
  const si = seasonIndex(season);
  if (si !== lastSI) {
    lastSI = si;
    railLis.forEach(li => li.classList.toggle('on', +li.dataset.i === si));
    seasonArts.forEach(a => a.classList.toggle('on', +a.dataset.i === si));
  }
  if (inSeasons) progEl.style.setProperty('--sp', clamp((y - sT) / sL).toFixed(4));
  craftPin.classList.toggle('is-on', y > cT - h * 0.2 && y < cT + cL + h * 0.25);
  const cp = (y - cT) / cL;
  const ci = cp < -0.08 || cp > 1.02 ? -1 : clamp(Math.floor(cp * 3), 0, 2);
  if (ci !== lastCI) {
    lastCI = ci;
    craftArts.forEach((a, i) => a.classList.toggle('on', i === ci));
    craftIdx.forEach((a, i) => a.classList.toggle('on', i === ci));
    if (ci >= 0) calloutP.innerHTML = `<b>${CALLOUTS[ci].label}</b>${CALLOUTS[ci].text}`;
    if (ci === 0 && intro > 0.9) setTimeout(snip, 700);
  }
  // Callout anchored to the 3D subject of each craft step.
  let anchor = null;
  if (ci === 0 && A?.pads?.length) {
    const pad = prunePad();
    anchor = tmpV.copy(pad.center).add(tmpW.set(pad.center.x > 0 ? 0.1 : -0.1, pad.std.y * 1.2, 0.08));
  } else if (ci === 1 && wireInfo) anchor = tmpV.copy(wireInfo.anchor);
  else if (ci === 2 && A) anchor = tmpV.set(A.trunk[0].x + 0.12, A.potTop + 0.015, A.trunk[0].z + 0.1);
  const within = ci >= 0 && Math.abs(cp * 3 - (ci + 0.5)) < 0.42;
  callout.classList.toggle('on', !!anchor && within);
  if (anchor) {
    anchor.project(camera);
    const ax = (anchor.x + 1) / 2 * w, ay = (1 - anchor.y) / 2 * h;
    const flip = ax > w * 0.84;
    const lx = MOBILE ? clamp(ax - 60, 16, w - 190) : flip ? ax - 300 : Math.min(ax + 90, w - 300), ly = Math.max(90, ay - (MOBILE ? 90 : 130));
    calloutLine.setAttribute('x1', ax.toFixed(1)); calloutLine.setAttribute('y1', ay.toFixed(1));
    calloutLine.setAttribute('x2', lx.toFixed(1)); calloutLine.setAttribute('y2', (ly + 34).toFixed(1));
    calloutDot.setAttribute('cx', ax.toFixed(1)); calloutDot.setAttribute('cy', ay.toFixed(1));
    calloutP.style.transform = `translate3d(${lx.toFixed(1)}px, ${(ly - 10).toFixed(1)}px, 0)`;
  }
  for (const dv of dividers) {
    const r = dv.getBoundingClientRect();
    dv.style.setProperty('--draw', clamp((h - r.top) / (h * 0.6)).toFixed(3));
  }
  body.classList.toggle('in-foot', y + h > fT + h * 0.35);
  body.classList.toggle('dial-off', y > secs._s.nT + h * 0.1 && y < secs._s.cT - h * 0.35);
  engine.paused = y > fT + 2;
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
worldNav('koen', { theme: 'light', corner: 'bl' });
cur = cursor({ color: '#1d1a17', blend: 'normal', size: 30 });
magnetic();
const lenis = smoothScroll({ lerp: 0.07 });
reveal('.panel h2', { type: 'lines', stagger: 0.1 });
reveal('.lede', { type: 'lines', stagger: 0.05, y: '100%' });
gsap.from('.catalogue li', { opacity: 0, y: 26, duration: 1.1, ease: 'expo.out', stagger: 0.07, scrollTrigger: { trigger: '.catalogue', start: 'top 80%', once: true } });
gsap.from('.facts > div', { opacity: 0, y: 22, duration: 1.1, ease: 'expo.out', stagger: 0.08, scrollTrigger: { trigger: '.facts', start: 'top 85%', once: true } });
document.querySelectorAll('.hero-title .ln').forEach(l => { l.innerHTML = `<span>${l.innerHTML}</span>`; });
gsap.set('.hero-title .ln > span', { yPercent: 110 });
gsap.set('.eyebrow, .hero-sub, .hero-cta, .hint, .nav, .hero-vert, .dial-wrap', { opacity: 0 });

await treeLoad;
// The page opens in late autumn: some leaves are already down on the moss and the slab.
if (A) { const ts0 = treeState(2); for (let i = 0; i < 90; i++) spawnLeaf(ts0, { landed: 1 + Math.random() * 30 }); }
await document.fonts.ready;
layout();
addEventListener('resize', () => { layout(); });
new ResizeObserver(() => layout()).observe(document.body);
{ const s0 = sample(scrollY); for (const n of ['az', 'el', 'dist', 'tx', 'ty', 'tz', 'ox', 'oy', 'en']) cam[n] = s0[n]; }
if (DBG.has('s')) season = +DBG.get('s');
// Warm every program: summer, autumn and winter states, leaves and snow visible.
U.uSnow.value = 1; snow.points.visible = true; motes.points.visible = true;
renderer.compile(scene, camera);
engine.start();
await loader.finish();
gsap.to({ v: 0 }, { v: 1, duration: 3.6, ease: 'power2.inOut', onUpdate() { intro = this.targets()[0].v; } });
gsap.to('.hero-title .ln > span', { yPercent: 0, duration: 1.8, ease: 'expo.out', stagger: 0.12, delay: 0.35 });
gsap.to('.eyebrow, .hero-sub, .hero-cta, .nav, .hero-vert', { opacity: 1, duration: 1.4, ease: 'power2.out', stagger: 0.08, delay: 0.9 });
gsap.to('.hint, .dial-wrap', { opacity: 1, duration: 1.4, ease: 'power2.out', delay: 1.8 });
window.__koen = { get season() { return season; }, set season(v) { season = v; }, shake, lenis, A: () => A, keys: () => KEYS, cam: () => ({ ...cam }), info: () => ({ ...renderer.info.render, twigTris: twigs?.geometry.index.count / 3 }), wire: () => wireInfo, camera };
