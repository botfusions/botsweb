import { Engine, THREE, normalize, prepModel, damp, clamp, smooth, lerp, studioEnvironment } from '../../src/core/engine.js';
import { Assets, sampleSurface, firstMesh } from '../../src/core/assets.js';
import { Pointer } from '../../src/core/input.js';
import { smoothScroll, gsap, reveal } from '../../src/core/scroll.js';
import { preloader, cursor, magnetic, worldNav } from '../../src/core/ui.js';
import { PlanarReflection } from '../../src/core/reflector.js';
import { Lens, MODES } from './lens.js';
import { buildCyc, matTexture, ContactShadow, MM } from './studio.js';
import { NOISE, DISSOLVE } from './shaders.js';

const Q = new URLSearchParams(location.search);
// Canvas-drawn labels (floor ruler, CAD dimensions) need the mono face.
await Promise.race([Promise.all(['500 17px "JetBrains Mono"', '600 44px "JetBrains Mono"'].map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 1800))]).catch(() => {});
const D = Math.PI / 180;
const isTouch = matchMedia('(pointer: coarse)').matches;

// ─── Choreography: one state per section ─────────────────────────────────────
// cam/look in world units; pos = shoe pivot xz; yaw/bank/pitch in radians; lens radius as a fraction of the viewport.
const STATES = {
  hero:   { cam: [0.0, 1.45, 5.75], look: [0.36, 0.47, 0], fov: 25, pos: [0.8, 0.05], yaw: -0.3, bank: 0, pitch: 0, lift: 0, lensR: 0.175, zoom: 1.12, mode: 0, dock: 'plateMid', mob: -0.05 },
  lens:   { cam: [0.0, 1.3, 5.7], look: [-0.12, 0.45, 0], fov: 25, pos: [-0.66, 0], yaw: 0.55, bank: 0, pitch: 0, lift: 0, lensR: 0.18, zoom: 1.15, mode: null, dock: 'midsole', text: 'r', mob: 0.74 },
  plate:  { cam: [0.0, 0.7, 5.1], look: [0.36, 0.6, 0], fov: 24, pos: [0.8, 0], yaw: -0.16, bank: -0.36, pitch: 0.06, lift: 0.36, lensR: 0.21, zoom: 1.12, mode: 0, dock: 'plateMid', text: 'l', mob: 0.62 },
  foam:   { cam: [0.0, 1.0, 4.7], look: [-0.2, 0.42, 0], fov: 24, pos: [-0.62, 0.1], yaw: 1.04, bank: 0, pitch: 0, lift: 0, lensR: 0.17, zoom: 1.2, mode: 1, dock: 'heelFoam', text: 'r', mob: 0.62 },
  upper:  { cam: [0.0, 3.1, 4.4], look: [0.5, 0.3, 0], fov: 25, pos: [0.82, 0], yaw: -0.6, bank: 0, pitch: 0, lift: 0, lensR: 0.17, zoom: 1.2, mode: 2, dock: 'vamp', text: 'l', mob: 0.62 },
  colour: { cam: [0.0, 1.4, 5.9], look: [0.3, 0.5, 0], fov: 25, pos: [0.78, 0], yaw: 0.35, bank: 0, pitch: 0, lift: 0, lensR: 0.12, zoom: 1.1, mode: 0, dock: 'plateMid', sway: 1, text: 'l', mob: -0.5 },
  drop:   { cam: [0.0, 1.3, 7.3], look: [0.0, 0.34, 0], fov: 25, pos: [0.0, -0.2], yaw: -0.5, bank: 0, pitch: 0.06, lift: 0.86, lensR: 0.1, zoom: 1.1, mode: 0, dock: 'core', sway: 1, mob: 0.5 },
};
const CALLOUTS = {
  plate: [
    { a: 'plateMid', k: '02.1', t: 'Carbon plate', v: 'Full length · 1.1 mm UD', off: [60, -250] },
    { a: 'plateFore', k: '02.2', t: 'Rocker apex', v: '62% of length · 4.2°', off: [140, 120] },
    { a: 'heelWing', k: '02.3', t: 'Heel wing', v: 'Lateral stability rail', off: [-200, 150] },
  ],
  foam: [
    { a: 'heelFoam', k: '03.1', t: 'Heel strike zone', v: '38 mm · 81% air', off: [-260, -120] },
    { a: 'foreFoam', k: '03.2', t: 'Energy return', v: '87% · Supercritical PEBA', off: [90, -210] },
    { a: 'lugs', k: '03.3', t: 'Outsole lugs', v: '1.5 mm · 36 per sole', off: [70, 120] },
  ],
  upper: [
    { a: 'vamp', k: '04.1', t: 'Engineered mesh', v: '212 knit zones', off: [150, -120] },
    { a: 'cage', k: '04.2', t: 'Ripstop cage', v: '11 g · zero seams', off: [-280, 90] },
    { a: 'tab', k: '04.3', t: 'Heel tab', v: '3 g · Solar TPU', off: [-250, -110] },
  ],
};

// ─── Engine ──────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gl');
const engine = new Engine({
  canvas, fov: 25, near: 0.05, far: 120, dpr: 1.6, background: 0xf2f3f5,
  post: {
    ao: { aoRadius: 0.34, intensity: 2.4, distanceFalloff: 0.55 },
    bloom: { intensity: 1.25, luminanceThreshold: 1.55, luminanceSmoothing: 0.3, radius: 0.66 },
    tone: 'neutral',
    vignette: { offset: 0.42, darkness: 0.34 },
    noise: 0.028,
    ca: 0.0003,
  },
});
const { scene, camera, renderer } = engine;
renderer.shadowMap.type = THREE.PCFShadowMap;
scene.environment = studioEnvironment(renderer, {
  top: 0xe4e5e7, bottom: 0x808286, panels: [
    { pos: [0, 7, 2.5], size: [9, 4], intensity: 3.4, color: 0xffffff },
    { pos: [-7, 3, 3.5], size: [3, 7], intensity: 2.4, color: 0xfff5ec },
    { pos: [7, 3.2, -2], size: [2.5, 7], intensity: 2.8, color: 0xf2f5fa },
    { pos: [0, 2.2, -8], size: [12, 3], intensity: 1.5, color: 0xffffff },
  ],
});
scene.environmentIntensity = 0.8;

// Lights: a big key from front-left, a cool rim from back-right, a wash on the cyc.
const key = new THREE.DirectionalLight(0xfffcf8, 2.6);
key.position.set(-2.8, 6.8, 4.4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, near: 2, far: 16 });
key.shadow.radius = 7; key.shadow.blurSamples = 16;
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.025;
const keyTarget = new THREE.Object3D();
key.target = keyTarget;
scene.add(key, keyTarget);
const rim = new THREE.DirectionalLight(0xf4f6fa, 1.7);
rim.position.set(4.5, 3.6, -5);
scene.add(rim);
const hemi = new THREE.HemisphereLight(0xffffff, 0xc9cdd4, 0.3);
scene.add(hemi);


// Studio
const cyc = buildCyc({ z0: -3.4, R: 4.4, wallColor: 0xcfd0d3 });
scene.add(cyc.group);
const mat = matTexture(2048, 7);
mat.wrapS = mat.wrapT = THREE.ClampToEdgeWrapping;
mat.repeat.set(10, 40 / 7);
mat.offset.set(-4.5, 0.5 - (-3.4 + 40) / 7);
cyc.floorMat.map = mat;
cyc.floorMat.color.set(0xe6e6e8);
const reflection = new PlanarReflection(renderer, { resolution: 0.5 });
reflection.hidden.push(cyc.floor);
reflection.patch(cyc.floorMat, { strength: 0.32, distort: 0, lodScale: 3.2, lodBias: 0.2, f0: 0.03 });
{
  const base = cyc.floorMat.onBeforeCompile;
  cyc.floorMat.onBeforeCompile = (sh, r) => {
    base(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('outgoingLight += refl', 'outgoingLight += smoothstep(-3.0, -0.6, vReflW.z) * smoothstep(8.0, 2.5, length(vReflW.xz)) * refl');
  };
}
engine.onResize((w, h, dpr) => reflection.setSize(w, h, dpr));
const contact = new ContactShadow(renderer, { size: 512, width: 4.6, height: 4.6, far: 1.15, blur: 3.4, opacity: 0.88, darkness: 1.6 });
scene.add(contact.group);
reflection.hidden.push(contact.plane);

// ─── Shoe ────────────────────────────────────────────────────────────────────
const pivot = new THREE.Group();
scene.add(pivot);
const U = {
  uTime: { value: 0 }, uShoeInv: { value: new THREE.Matrix4() }, uGait: { value: 0 }, uPx: { value: 500 },
  uProfile: { value: null }, uProfX: { value: new THREE.Vector2(-1, 1) }, uDis: { value: -0.25 },
};

const assets = new Assets();
const pointer = new Pointer({ lambda: 9 });
const loaderEl = document.querySelector('.loader');
// loader dial
{
  const g = loaderEl.querySelector('.loader-ticks');
  let s = '';
  for (let i = 0; i < 72; i++) {
    const a = i / 72 * Math.PI * 2 - Math.PI / 2, major = i % 6 === 0;
    const r0 = major ? 45 : 47, r1 = 52;
    s += `<line class="${major ? 'major' : ''}" x1="${(Math.cos(a) * r0).toFixed(2)}" y1="${(Math.sin(a) * r0).toFixed(2)}" x2="${(Math.cos(a) * r1).toFixed(2)}" y2="${(Math.sin(a) * r1).toFixed(2)}"/>`;
  }
  g.innerHTML = s;
}
const loaderTicks = [...loaderEl.querySelectorAll('.loader-ticks line')];
const STEPS = ['— optics', '— carbon plate', '— foam lattice', '— thermal', '— ready'];
const loader = preloader({
  assets, el: loaderEl, minTime: 1400,
  exit: async () => {
    const o = { h: 0 };
    loaderEl.querySelector('.loader-dial').style.transition = 'transform .6s cubic-bezier(.7,0,.3,1), opacity .4s';
    loaderEl.querySelector('.loader-dial').style.transform = 'scale(.6)';
    loaderEl.querySelector('.loader-dial').style.opacity = '0';
    loaderEl.querySelector('.loader-line').style.opacity = '0';
    await gsap.to(o, { h: Math.hypot(innerWidth, innerHeight) * 0.6, duration: 1.15, ease: 'expo.inOut', delay: 0.15, onUpdate: () => loaderEl.style.setProperty('--hole', o.h + 'px') });
  },
  onValue: v => {
    loaderEl.querySelector('.loader-pct').textContent = String(Math.round(v * 100)).padStart(3, '0');
    const n = Math.round(v * loaderTicks.length);
    loaderTicks.forEach((l, i) => l.classList.toggle('on', i < n));
    loaderEl.querySelector('.loader-step').textContent = STEPS[Math.min(4, Math.floor(v * 4.2))];
  },
});

function prepShoe(g, black) {
  const m = g.scene;
  m.rotation.y = Math.PI; // toe to +x, lateral side (the photographed one) to +z
  normalize(m, 2.0, { axis: 'x' });
  const box = new THREE.Box3().setFromObject(m);
  m.position.y -= box.max.y / 2;
  prepModel(m, renderer, {
    env: 1.0, onMat: (mat) => {
      mat.envMapIntensity = black ? 1.1 : 0.55;
      if (mat.normalScale) mat.normalScale.multiplyScalar(1.5);
      patchDissolve(mat, black);
    },
  });
  m.traverse(o => { if (o.isMesh) o.layers.enable(contact.layer); });
  return { model: m, height: box.max.y };
}

function patchDissolve(mat, black) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uDis = U.uDis; sh.uniforms.uShoeInv = U.uShoeInv;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uShoeInv; varying vec3 vSP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSP = (uShoeInv * modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uDis; varying vec3 vSP;\n${NOISE}\n${DISSOLVE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb = max(mix(vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), diffuseColor.rgb, ${black ? '1.25' : '1.4'}), 0.0);`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float dF = disField(vSP) - uDis;
        ${black ? 'if (dF > 0.0) discard;' : 'if (dF < 0.0) discard;'}
        float dEdge = 1.0 - smoothstep(0.0, 0.05, abs(dF));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += mix(vec3(1.0, 0.24, 0.02), vec3(1.0, 0.9, 0.62), dEdge * dEdge * dEdge) * dEdge * 7.0;`);
  };
  mat.customProgramCacheKey = () => 'vx-dissolve-' + (black ? 'b' : 'w');
  mat.needsUpdate = true;
}

// Measure the sole so the plate, the foam lattice, the thermal field and the callouts sit where the real shoe is.
function measure(model) {
  model.updateMatrixWorld(true);
  const mesh = firstMesh(model);
  const pos = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  const n = pos.count;
  const P = new Float32Array(n * 3);
  const box = new THREE.Box3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; box.expandByPoint(v); }
  const NX = 64, NY = 32;
  const x0 = box.min.x, x1 = box.max.x, y0 = box.min.y, y1 = box.max.y;
  const bx = x => clamp(Math.floor((x - x0) / (x1 - x0) * NX), 0, NX - 1);
  const by = y => clamp(Math.floor((y - y0) / (y1 - y0) * NY), 0, NY - 1);
  const minY = new Float32Array(NX).fill(Infinity), maxY = new Float32Array(NX).fill(-Infinity);
  const side = new Float32Array(NX * NY).fill(-Infinity), sideN = new Float32Array(NX * NY).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const ix = bx(x);
    if (y < minY[ix]) minY[ix] = y;
    if (y > maxY[ix]) maxY[ix] = y;
    const k = by(y) * NX + ix;
    if (z > side[k]) side[k] = z;
    if (z < sideN[k]) sideN[k] = z;
  }
  const zlo = new Float32Array(NX).fill(Infinity), zhi = new Float32Array(NX).fill(-Infinity);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const ix = bx(x);
    if (y < minY[ix] + 0.06) { if (z < zlo[ix]) zlo[ix] = z; if (z > zhi[ix]) zhi[ix] = z; }
  }
  const fillGaps = a => { for (let i = 0; i < a.length; i++) if (!isFinite(a[i])) a[i] = isFinite(a[i - 1]) ? a[i - 1] : a.find(isFinite); return a; };
  const blur = (a, r = 2) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) { let s = 0, c = 0; for (let j = -r; j <= r; j++) { const k = clamp(i + j, 0, a.length - 1); s += a[k]; c++; } o[i] = s / c; } return o; };
  [minY, maxY, zlo, zhi].forEach(fillGaps);
  const bottomA = blur(minY, 2), topA = blur(maxY, 1);
  const zc = new Float32Array(NX), hw = new Float32Array(NX);
  for (let i = 0; i < NX; i++) { zc[i] = (zlo[i] + zhi[i]) / 2; hw[i] = Math.max(0.02, (zhi[i] - zlo[i]) / 2); }
  const zcA = blur(zc, 3), hwA = blur(hw, 2);
  const at = (a, x) => { const f = clamp((x - x0) / (x1 - x0) * NX - 0.5, 0, NX - 1); const i = Math.floor(f), t = f - i; return lerp(a[i], a[Math.min(NX - 1, i + 1)], t); };
  const bottom = x => at(bottomA, x), top = x => at(topA, x);
  const H = y1 - y0;
  const midTop = x => bottom(x) + H * lerp(0.38, 0.17, smooth(-0.55, 0.5, x));
  const plateY = x => bottom(x) + H * lerp(0.215, 0.075, smooth(-0.5, 0.32, x));
  const sideZ = (x, y) => { const ix = bx(x), iy = by(y); let z = side[iy * NX + ix]; if (!isFinite(z)) z = at(zcA, x) + at(hwA, x); return z; };
  // profile texture
  const tex = new Float32Array(NX * 4);
  for (let i = 0; i < NX; i++) {
    const x = x0 + (i + 0.5) / NX * (x1 - x0);
    tex[i * 4] = bottom(x); tex[i * 4 + 1] = at(zcA, x); tex[i * 4 + 2] = at(hwA, x); tex[i * 4 + 3] = midTop(x);
  }
  const dt = new THREE.DataTexture(tex, NX, 1, THREE.RGBAFormat, THREE.FloatType);
  dt.minFilter = dt.magFilter = THREE.NearestFilter; // float linear filtering is not universal; 64 bins is smooth enough
  dt.needsUpdate = true;

  // Carbon plate: a spoon-shaped sheet following the rocker.
  const nu = 90, nv = 12;
  const pp = [], uv = [], idx = [];
  const pu0 = x0 + 0.1, pu1 = x1 - 0.1;
  for (let i = 0; i <= nu; i++) {
    const x = lerp(pu0, pu1, i / nu);
    const c = at(zcA, x), w = at(hwA, x) * lerp(0.62, 0.8, smooth(-0.6, 0.4, x));
    for (let j = 0; j <= nv; j++) {
      const s = j / nv * 2 - 1;
      pp.push(x, plateY(x) + 0.02 * s * s, c + s * w);
      uv.push(i / nu, j / nv);
    }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const plateGeo = new THREE.BufferGeometry();
  plateGeo.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
  plateGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  plateGeo.setIndex(idx); plateGeo.computeVertexNormals();

  // Foam lattice: surface samples of the midsole pushed inward, thinned to an even spacing.
  const smp = sampleSurface(mesh, 30000, { colors: false });
  const cells = [], seeds = [], sizes = [];
  const cellHash = new Map(), CS = 0.034;
  const key3 = (x, y, z) => `${Math.floor(x / CS)},${Math.floor(y / CS)},${Math.floor(z / CS)}`;
  for (let i = 0; i < 30000 && cells.length / 3 < 2600; i++) {
    let x = smp.position[i * 3], y = smp.position[i * 3 + 1], z = smp.position[i * 3 + 2];
    const b = bottom(x), mt = midTop(x);
    if (y > mt - 0.01 || y < b + 0.012 || x < x0 + 0.05 || x > x1 - 0.05) continue;
    const d = Math.pow(Math.random(), 0.8) * at(hwA, x) * 0.9;
    x -= smp.normal[i * 3] * d * 0.3; y -= smp.normal[i * 3 + 1] * d; z -= smp.normal[i * 3 + 2] * d;
    y = clamp(y, b + 0.02, mt - 0.02);
    const c = at(zcA, x), w = at(hwA, x) * 0.92;
    z = clamp(z, c - w, c + w);
    const k = key3(x, y, z);
    if (cellHash.has(k)) continue;
    cellHash.set(k, cells.length / 3);
    cells.push(x, y, z); seeds.push(Math.random()); sizes.push(lerp(0.026, 0.05, Math.random()));
  }
  const cellGeo = new THREE.BufferGeometry();
  cellGeo.setAttribute('position', new THREE.Float32BufferAttribute(cells, 3));
  cellGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  cellGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  // struts between near neighbours
  const struts = [];
  const nc = cells.length / 3;
  const grid = new Map(), GS = 0.07;
  for (let i = 0; i < nc; i++) { const k = `${Math.floor(cells[i * 3] / GS)},${Math.floor(cells[i * 3 + 1] / GS)},${Math.floor(cells[i * 3 + 2] / GS)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  for (let i = 0; i < nc; i++) {
    const ax = cells[i * 3], ay = cells[i * 3 + 1], az = cells[i * 3 + 2];
    const gx = Math.floor(ax / GS), gy = Math.floor(ay / GS), gz = Math.floor(az / GS);
    const near = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const l = grid.get(`${gx + a},${gy + b},${gz + c}`); if (!l) continue;
      for (const j of l) { if (j <= i) continue; const dx = cells[j * 3] - ax, dy = cells[j * 3 + 1] - ay, dz = cells[j * 3 + 2] - az; const d2 = dx * dx + dy * dy + dz * dz; if (d2 < GS * GS) near.push([d2, j]); }
    }
    near.sort((p, q) => p[0] - q[0]);
    for (const [, j] of near.slice(0, 2)) struts.push(ax, ay, az, cells[j * 3], cells[j * 3 + 1], cells[j * 3 + 2]);
  }
  const strutGeo = new THREE.BufferGeometry();
  strutGeo.setAttribute('position', new THREE.Float32BufferAttribute(struts, 3));

  // Embers for the colourway dissolve
  const em = sampleSurface(mesh, 7000, { colors: false });
  const emSeed = new Float32Array(7000).map(() => Math.random());
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(em.position, 3));
  emberGeo.setAttribute('aN', new THREE.BufferAttribute(em.normal, 3));
  emberGeo.setAttribute('aSeed', new THREE.BufferAttribute(emSeed, 1));

  const surf = (x, dy) => { const y = bottom(x) + dy; return new THREE.Vector3(x, y, sideZ(x, y) + 0.004); };
  const anchors = {
    plateMid: new THREE.Vector3(-0.05, plateY(-0.05), at(zcA, -0.05)),
    core: new THREE.Vector3(-0.08, lerp(bottom(-0.08), top(-0.08), 0.36), at(zcA, -0.08)),
    plateFore: new THREE.Vector3(0.5, plateY(0.5), at(zcA, 0.5)),
    midsole: new THREE.Vector3(-0.15, lerp(bottom(-0.15), midTop(-0.15), 0.5), at(zcA, -0.15)),
    heelWing: surf(x0 + 0.22, H * 0.3),
    heelFoam: surf(x0 + 0.3, H * 0.17),
    foreFoam: surf(0.48, H * 0.1),
    lugs: surf(0.2, H * 0.012),
    vamp: surf(0.5, H * 0.34),
    cage: surf(-0.12, H * 0.5),
    tab: new THREE.Vector3(x0 + 0.05, top(x0 + 0.05) - 0.07, at(zcA, x0 + 0.05)),
  };
  return {
    mesh, box, H, x0, x1, bottom, top, midTop, plateY, zFront: box.max.z,
    profileTex: dt, plateGeo, cellGeo, strutGeo, emberGeo, anchors,
  };
}

// Dissolve embers
function makeEmbers(geo) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uDis: U.uDis, uDir: { value: 1 }, uPx: { value: 500 }, uOn: { value: 0 } },
    vertexShader: `
      attribute vec3 aN; attribute float aSeed;
      uniform float uDis, uDir, uPx, uOn; varying float vA; varying float vH;
      ${NOISE} ${DISSOLVE}
      void main(){
        float f = disField(position) - uDis;
        float passed = -f * uDir;
        float life = clamp(passed / 0.22, 0.0, 1.0);
        vec3 drift = aN * 0.5 + vec3(0.0, 1.0, 0.0) * (0.7 + aSeed) + vec3(sin(aSeed * 91.0), 0.0, cos(aSeed * 57.0)) * 0.35;
        vec3 p = position + drift * life * life * 0.3 * (0.4 + aSeed);
        vA = uOn * (exp(-pow(f / 0.022, 2.0)) * 0.9 + step(0.0, passed) * (1.0 - life) * 0.8) * step(0.35, aSeed);
        vH = 1.0 - life;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.006 + aSeed * 0.01) * uPx / -mv.z;
      }`,
    fragmentShader: `
      varying float vA; varying float vH;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); if (vA < 0.01) discard;
        gl_FragColor = vec4(mix(vec3(1.0, 0.2, 0.02), vec3(1.0, 0.85, 0.5), vH) * a * vA * 6.0, 1.0); }`,
  });
  const p = new THREE.Points(geo, m);
  p.frustumCulled = false;
  return p;
}

// ─── Load ───────────────────────────────────────────────────────────────────
const [gw, gb] = await Promise.all([assets.gltf('models/velocity/white.glb'), assets.gltf('models/velocity/black.glb')]);
const white = prepShoe(gw, false), black = prepShoe(gb, true);
const H = white.height;
const data = measure(white.model);
pivot.add(white.model, black.model);
black.model.visible = false;
U.uProfile.value = data.profileTex;
U.uProfX.value.set(data.x0, data.x1);
const embers = makeEmbers(data.emberGeo);
embers.visible = false;
pivot.add(embers);
if (Q.has('debug')) {
  firstMesh(white.model).material && console.log('mat', ['roughness', 'metalness', 'envMapIntensity'].map(k => k + '=' + firstMesh(white.model).material[k]).join(' '), !!firstMesh(white.model).material.roughnessMap);
}

const lens = new Lens(engine, U);
lens.build(white.model, data);

// ─── Interaction state ───────────────────────────────────────────────────────
const lensUI = document.querySelector('.lens-ui');
const lensSvg = lensUI.querySelector('svg');
const lensTicks = lensUI.querySelector('.lens-ticks');
{
  let s = '';
  for (let i = 0; i < 120; i++) {
    const a = i / 120 * Math.PI * 2, major = i % 10 === 0, hot = i === 90;
    const r0 = 102.5, r1 = hot ? 113 : major ? 109 : 105.5;
    s += `<line class="${hot ? 'hot' : major ? 'major' : ''}" x1="${(Math.cos(a) * r0).toFixed(2)}" y1="${(Math.sin(a) * r0).toFixed(2)}" x2="${(Math.cos(a) * r1).toFixed(2)}" y2="${(Math.sin(a) * r1).toFixed(2)}"/>`;
  }
  lensTicks.innerHTML = s;
}
const lensArc = lensUI.querySelector('.lens-arc textPath');
lensUI.querySelector('#lens-arc').setAttribute('d', 'M -118,0 A 118,118 0 0,1 118,0');
lensArc.setAttribute('startOffset', '50%');
lensArc.parentNode.setAttribute('text-anchor', 'middle');
const lensTag = lensUI.querySelector('.lens-tag');
lensArc.textContent = 'X-RAY · MODE 01/03 · CFRP PLATE 1.1 MM · PEBA LATTICE';
const lensCoord = lensUI.querySelector('.lens-coord');
const ARC = [
  'X-RAY · MODE 01/03 · CFRP PLATE 1.1 MM · PEBA LATTICE',
  'THERMAL · MODE 02/03 · 1,200 STRIDES · 18–36 °C',
  'CAD · MODE 03/03 · MASTER DRAWING REV. 14 · MM',
];

let userAt = -100, userMode = false, holdT = -1, holding = false, overUI = false;
let stageIdx = -1, stage = 0, stageRaw = 0;
const state = { open: 0, r: 150, zoom: 1.1, userW: 0, heroIn: 0, spinIn: 0, dockX: innerWidth * 0.6, dockY: innerHeight * 0.6, dockS: 1, idleVis: 1 };

// ─── Idle docking: which on-shoe anchor can hold the lens without covering copy ────────────────────
const TEXT_SEL = '.hero .eyebrow, .title .t1, .title .t2, .hero .sub, .hero-note, .s .col > .eyebrow, .s .col > h2, .s .col > .lede, .drop-inner > .eyebrow, .drop-inner > h2, .drop-note';
const BOX_SEL = '.specs, .s .col > .stat, .s .col > .minor, .s .col > .modes, .swatches, .count, .join';
const BOX_SEL_PHONE = '.s .col, .specs, .hero-copy > *, .drop-inner > *';
const copyEls = { text: [...document.querySelectorAll(TEXT_SEL)], box: [...document.querySelectorAll(BOX_SEL)], phone: [...document.querySelectorAll(BOX_SEL_PHONE)] };
const copyRange = document.createRange();
let copyRects = [];
function readCopy() {
  copyRects = [];
  const vis = r => r.width > 0 && r.bottom > 0 && r.top < innerHeight;
  if (innerWidth <= 900) { for (const el of copyEls.phone) { const r = el.getBoundingClientRect(); if (vis(r)) copyRects.push(r); } return; }
  for (const el of copyEls.text) { copyRange.selectNodeContents(el); const r = copyRange.getBoundingClientRect(); if (vis(r)) copyRects.push(r); }
  for (const el of copyEls.box) { const r = el.getBoundingClientRect(); if (vis(r)) copyRects.push(r); }
}
const DOCK_ALT = ['plateMid', 'core', 'midsole', 'plateFore', 'heelFoam', 'foreFoam', 'vamp', 'cage'];
let dockKey = null;
const pD = { x: 0, y: 0, z: 0 };
function dockOK(key, r) {
  project(data.anchors[key], pD);
  if (pD.z > 1 || pD.x < 24 + r * 0.3 || pD.x > innerWidth - 24 - r * 0.3 || pD.y < 80 + r * 0.3 || pD.y > innerHeight - 84 - r * 0.3) return false;
  const rr = r * 1.18 + 12; // bezel ticks and arc lettering
  for (const q of copyRects) { const dx = pD.x - clamp(pD.x, q.left, q.right), dy = pD.y - clamp(pD.y, q.top, q.bottom); if (dx * dx + dy * dy < rr * rr) return false; }
  return true;
}
function chooseDock(pref, baseR) {
  for (const s of [1, 0.72]) {
    for (const k of [pref, dockKey, ...DOCK_ALT]) {
      if (k && dockOK(k, baseR * s)) { dockKey = k; return { key: k, x: pD.x, y: pD.y, scale: s }; }
    }
  }
  dockKey = null;
  return { key: null, scale: 0.72 };
}
const modeButtons = [...document.querySelectorAll('[data-mode]')];
function setMode(i, fromUser = false) {
  if (fromUser) userMode = true;
  if (!lens.setMode(i)) return;
  gsap.killTweensOf(lens, 'wipe,hot');
  gsap.to(lens, { wipe: 1, duration: 0.8, ease: 'power2.out' });
  gsap.fromTo(lens, { hot: 1 }, { hot: 0, duration: 0.9, ease: 'power2.out' });
  modeButtons.forEach(b => b.classList.toggle('is-on', +b.dataset.mode === i));
  lensTag.querySelector('.lens-tag-n').textContent = String(i + 1).padStart(2, '0');
  lensTag.querySelector('.lens-tag-m').textContent = MODES[i].name;
  lensArc.textContent = ARC[i];
}
modeButtons.forEach(b => b.addEventListener('click', e => { e.stopPropagation(); setMode(+b.dataset.mode, true); }));
addEventListener('keydown', e => {
  if (e.target.closest?.('input')) return;
  if (e.key >= '1' && e.key <= '3') setMode(+e.key - 1, true);
  if (e.key === 'c' || e.key === 'C') setWay(way ? 0 : 1);
});
const UI_SEL = 'a,button,input,label,form,[data-nolens],.console,.nav,.tw-nav,.foot';
pointer.on('move', e => {
  userAt = engine.time;
  overUI = !!e.target?.closest?.(UI_SEL);
  cur?.set(overUI ? (e.target.closest('a,button,input') ? 'link' : '') : 'hidden');
});
pointer.on('down', e => {
  userAt = engine.time;
  if (e.button !== 0 || e.target?.closest?.(UI_SEL)) return;
  holdT = engine.time; holding = false;
});
pointer.on('up', e => {
  if (holdT < 0) return;
  const quick = engine.time - holdT < 0.24;
  holdT = -1;
  if (holding) { holding = false; return; }
  if (quick && e.pointerType === 'mouse') setMode((lens.mode + 1) % 3, true);
});

// Colourways
let way = 0;
const swatches = [...document.querySelectorAll('.swatch')];
function setWay(i) {
  if (i === way) return;
  way = i;
  swatches.forEach(s => s.classList.toggle('is-on', +s.dataset.way === i));
  white.model.visible = black.model.visible = true;
  embers.visible = true;
  embers.material.uniforms.uDir.value = i ? 1 : -1;
  gsap.killTweensOf(U.uDis);
  gsap.to(embers.material.uniforms.uOn, { value: 1, duration: 0.2 });
  gsap.to(U.uDis, {
    value: i ? 1.25 : -0.25, duration: 2.1, ease: 'power1.inOut',
    onComplete: () => { white.model.visible = !i; black.model.visible = !!i; gsap.to(embers.material.uniforms.uOn, { value: 0, duration: 0.4, onComplete: () => { embers.visible = false; } }); },
  });
}
swatches.forEach(s => s.addEventListener('click', e => { e.stopPropagation(); setWay(+s.dataset.way); }));
let autoWay = false;

// ─── Callouts ───────────────────────────────────────────────────────────────
const leadersEl = document.querySelector('.leaders');
const calloutsEl = document.querySelector('.callouts');
const SVGNS = 'http://www.w3.org/2000/svg';
const callouts = [];
for (const [sk, list] of Object.entries(CALLOUTS)) {
  for (const c of list) {
    const el = document.createElement('div');
    el.className = 'callout';
    el.innerHTML = `<span class="c-k">${c.k}</span><b>${c.t}</b><span class="c-v">${c.v}</span>`;
    calloutsEl.appendChild(el);
    const g = document.createElementNS(SVGNS, 'g');
    g.innerHTML = '<path pathLength="1"/><circle class="ring" r="8"/><circle class="pin" r="3"/>';
    g.style.opacity = 0;
    leadersEl.appendChild(g);
    callouts.push({ ...c, state: sk, el, g, path: g.firstChild, ring: g.children[1], pin: g.children[2], vis: 0 });
  }
}

// ─── HUD ────────────────────────────────────────────────────────────────────
const sections = [...document.querySelectorAll('[data-state]')].map(el => ({ el, key: el.dataset.state }));
const stateList = sections.map(s => STATES[s.key]);
const chapterN = document.querySelector('.chapter-n'), chapterName = document.querySelector('.chapter-name');
const CHAPTERS = ['Launch file', 'The lens', 'Plate', 'Foam', 'Upper', 'Colourways', 'The drop'];
const rulerMark = document.querySelector('.ruler-mark'), rulerVal = document.querySelector('.ruler-val'), rulerEl = document.querySelector('.ruler');
const footEl = document.querySelector('.foot');
const navLinks = [...document.querySelectorAll('.links a')];
let anchorsY = [];
function measureSections() {
  const max = document.documentElement.scrollHeight - innerHeight;
  anchorsY = sections.map(s => { const r = s.el.getBoundingClientRect(); return clamp(r.top + scrollY + r.height / 2 - innerHeight / 2, 0, max); });
  anchorsY[0] = 0;
}
addEventListener('resize', measureSections);
function stageAt(y) {
  const a = anchorsY;
  if (y <= a[0]) return 0;
  for (let i = 0; i < a.length - 1; i++) if (y < a[i + 1]) return i + smooth(0.12, 0.88, (y - a[i]) / Math.max(1, a[i + 1] - a[i]));
  return a.length - 1;
}

// countdown to Friday 16 Oct 2026, 09:00 Zürich (CEST)
const DROP = new Date('2026-10-16T09:00:00+02:00').getTime();
const cnt = Object.fromEntries([...document.querySelectorAll('.count b')].map(b => [b.dataset.u, b]));
function tickCount() {
  let s = Math.max(0, Math.floor((DROP - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  cnt.d.textContent = String(d).padStart(2, '0'); cnt.h.textContent = String(h).padStart(2, '0');
  cnt.m.textContent = String(m).padStart(2, '0'); cnt.s.textContent = String(s).padStart(2, '0');
}
tickCount(); setInterval(tickCount, 1000);

// ─── Frame loop ─────────────────────────────────────────────────────────────
const cur0 = { cam: new THREE.Vector3(), look: new THREE.Vector3() };
const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), ray = new THREE.Raycaster(), plane = new THREE.Plane();
const inv = new THREE.Matrix4();
const L3 = (a, b, f, out) => out.set(lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f));
function blendState(s) {
  const i = Math.min(stateList.length - 2, Math.floor(s)), f = s - i;
  const A = stateList[i], B = stateList[i + 1] ?? A;
  return { A, B, f, i };
}
function project(v, out) { tv2.copy(v).applyMatrix4(pivot.matrixWorld).project(camera); out.x = (tv2.x + 1) / 2 * innerWidth; out.y = (1 - tv2.y) / 2 * innerHeight; out.z = tv2.z; return out; }
const pA = { x: 0, y: 0, z: 0 }, pB = { x: 0, y: 0, z: 0 };
let prevCx = 0, prevCy = 0;
let cur = null;

engine.onTick((dt, t) => {
  pointer.update(dt);
  U.uTime.value = t;
  U.uGait.value = (t * 0.62) % 1;
  lens.uScan.value = ((t * 0.32) % 1) * 2.8 - 1.4;

  // stage
  stageRaw = stageAt(scrollY);
  stage = damp(stage, stageRaw, 6, dt);
  const { A, B, f, i } = blendState(stage);
  const near = Math.round(stage);
  if (near !== stageIdx) {
    stageIdx = near;
    userMode = false;
    const st = stateList[near];
    if (st.mode !== null && st.mode !== undefined) setMode(st.mode);
    chapterN.textContent = String(near).padStart(2, '0');
    chapterName.textContent = CHAPTERS[near] ?? '';
    const key = sections[near]?.key;
    navLinks.forEach(a => a.classList.toggle('is-on', a.getAttribute('href') === '#' + (key === 'lens' ? 'lens' : sections[near]?.el.id)));
    if (sections[near]?.key === 'colour' && !autoWay) { autoWay = true; setTimeout(() => { if (way === 0) setWay(1); }, 700); }
  }

  // camera
  L3(A.cam, B.cam, f, cur0.cam); L3(A.look, B.look, f, cur0.look);
  const fov = lerp(A.fov, B.fov, f);
  const aspect = innerWidth / innerHeight, narrow = aspect < 0.95;
  const wide = Math.max(1, aspect / 1.6); // keep screen-space staging constant on wide viewports
  cur0.look.x *= wide;
  if (narrow) {
    // Portrait: centre the shoe, back off until it fits the width, and aim low so it sits above the text card.
    const k = Math.pow(clamp(1.6 / aspect, 1, 3.4), 0.56);
    cur0.look.x = 0;
    tv.subVectors(cur0.cam, cur0.look).multiplyScalar(k);
    cur0.cam.copy(cur0.look).add(tv); cur0.cam.x = 0;
    cur0.look.y -= lerp(A.mob ?? 0.42, B.mob ?? 0.42, f) * Math.tan(fov * D / 2) * tv.length();
  }
  camera.position.copy(cur0.cam).add(tv.set(pointer.sx * 0.08, pointer.sy * 0.04, 0));
  camera.lookAt(cur0.look);
  if (Math.abs(camera.fov - fov) > 1e-4) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();

  // shoe
  const sway = lerp(A.sway ?? 0, B.sway ?? 0, f);
  // past the last section the shoe rises with the page, so the countdown never scrolls over it
  const tail = Math.max(0, scrollY - (anchorsY[anchorsY.length - 1] ?? 1e9)) / innerHeight;
  const lift = lerp(A.lift, B.lift, f) + tail * 2 * Math.tan(fov * D / 2) * camera.position.distanceTo(cur0.look);
  const bob = lift > 0.01 ? Math.sin(t * 1.1) * 0.012 * smooth(0, 0.3, lift) : 0;
  pivot.position.set(narrow ? 0 : lerp(A.pos[0], B.pos[0], f) * wide, H / 2 + lift + bob, lerp(A.pos[1], B.pos[1], f));
  const intro = state.heroIn;
  pivot.rotation.set(lerp(A.bank, B.bank, f), lerp(A.yaw, B.yaw, f) + Math.sin(t * 0.35) * 0.03 + sway * Math.sin(t * 0.3) * 0.75 - (1 - intro) * 0.9, lerp(A.pitch, B.pitch, f) + (1 - intro) * 0.08, 'YXZ');
  pivot.updateMatrixWorld(true);
  U.uShoeInv.value.copy(pivot.matrixWorld).invert();
  keyTarget.position.copy(pivot.position); keyTarget.updateMatrixWorld();
  key.position.set(pivot.position.x - 2.8, 6.8, pivot.position.z + 4.4);
  contact.group.position.set(pivot.position.x, 0, pivot.position.z);
  cyc.sweepMat.userData.halo.uHalo.value.x = pivot.position.x * 0.8;
  // the measuring mat travels with the shoe
  mat.offset.set(-4.5 - pivot.position.x / 7, 0.5 - (-3.4 + 40) / 7 + pivot.position.z / 7);

  // lens target: the pointer when in use; otherwise parked on the shoe, never over copy (fades out if nowhere fits)
  const userActive = pointer.active && (t - userAt < 2.6 || pointer.down) && !isTouch || (isTouch && pointer.down);
  state.userW = damp(state.userW, userActive ? 1 : 0, userActive ? 10 : 1.8, dt);
  const unit = isTouch ? Math.min(innerHeight, innerWidth * 1.15) : innerHeight;
  const footCover = clamp(1 - footEl.getBoundingClientRect().top / innerHeight);
  const baseR = lerp(A.lensR, B.lensR, f) * unit;
  if (engine._frames % 3 === 0) readCopy();
  const dock = chooseDock(stateList[near].dock, baseR);
  if (dock.key) { state.dockX = dock.x; state.dockY = dock.y; state.dockS = damp(state.dockS, dock.scale, 5, dt); }
  state.idleVis = damp(state.idleVis, dock.key ? 1 : 0, dock.key ? 3 : 7, dt);
  const aimX = lerp(state.dockX, pointer.px, state.userW), aimY = lerp(state.dockY, pointer.py, state.userW);
  const follow = lerp(6, 14, state.userW);
  lens.cx = damp(lens.cx, aimX, follow, dt); lens.cy = damp(lens.cy, aimY, follow, dt);
  const vx = (lens.cx - prevCx) / Math.max(dt, 1e-3), vy = (lens.cy - prevCy) / Math.max(dt, 1e-3);
  prevCx = lens.cx; prevCy = lens.cy;
  lens.vx = damp(lens.vx, vx, 12, dt); lens.vy = damp(lens.vy, vy, 12, dt);
  if (holdT >= 0 && t - holdT > 0.24) holding = true;
  const rT = baseR * lerp(state.dockS, 1, state.userW) * (holding ? 1.22 : 1) * (overUI && state.userW > 0.5 ? 0.12 : 1);
  lens.r = damp(lens.r, rT, 9, dt);
  lens.zoom = damp(lens.zoom, holding ? 2.7 : lerp(A.zoom, B.zoom, f), holding ? 5 : 7, dt);
  lens.open = state.open;
  lens.mix = (1 - smooth(0.12, 0.5, footCover)) * lerp(state.idleVis, 1, state.userW);
  lens.sync(pivot);
  lens.render();

  // lens chrome
  const R = lens.r * lens.open;
  const sp = Math.hypot(lens.vx, lens.vy), st = clamp(sp * 0.00012, 0, 0.2);
  const ang = Math.atan2(lens.vy, lens.vx) / D;
  lensUI.classList.toggle('on', R > 20);
  lensUI.style.setProperty('--mix', lens.mix.toFixed(3));
  lensSvg.style.transform = `translate3d(${lens.cx.toFixed(1)}px, ${lens.cy.toFixed(1)}px, 0) rotate(${ang.toFixed(2)}deg) scale(${(1 / (1 - st)).toFixed(4)}, ${(1 / (1 + st * 0.5)).toFixed(4)}) rotate(${(-ang).toFixed(2)}deg) scale(${(R / 100).toFixed(4)})`;
  lensTicks.style.transform = `rotate(${(lens.cx * 0.12).toFixed(2)}deg)`;
  const ta = 38 * D;
  lensTag.style.transform = `translate3d(${(lens.cx + Math.cos(ta) * (R * 1.1 + 6)).toFixed(1)}px, ${(lens.cy + Math.sin(ta) * (R * 1.1 + 6) - 14).toFixed(1)}px, 0)`;
  lensCoord.style.opacity = rT > innerHeight * 0.15 ? 1 : 0;
  lensCoord.style.transform = `translate3d(${(lens.cx - lensCoord.offsetWidth / 2).toFixed(1)}px, ${(lens.cy + R * 1.14 + 12).toFixed(1)}px, 0)`;
  // lens position in shoe millimetres (on the shoe's centre plane)
  if ((engine._frames & 3) === 0) {
    ray.setFromCamera(tv.set(lens.cx / innerWidth * 2 - 1, -(lens.cy / innerHeight) * 2 + 1, 0), camera);
    plane.setFromNormalAndCoplanarPoint(tv2.set(0, 0, 1).transformDirection(pivot.matrixWorld), pivot.position);
    if (ray.ray.intersectPlane(plane, tv)) {
      tv.applyMatrix4(U.uShoeInv.value);
      const xx = clamp(tv.x, data.x0, data.x1);
      const mx = (tv.x - data.x0) * MM, my = (tv.y - data.bottom(xx)) * MM;
      const inX = tv.x > data.x0 && tv.x < data.x1, b = data.bottom(xx);
      const what = !inX || tv.y > data.top(xx) || tv.y < b - 0.01 ? 'AIR'
        : tv.y < b + 0.035 ? 'OUTSOLE · 1.5 MM LUGS'
        : Math.abs(tv.y - data.plateY(xx)) < 0.045 ? 'CFRP PLATE · 1.1 MM'
        : tv.y < data.midTop(xx) ? 'PEBA FOAM · 81% AIR'
        : tv.x < data.x0 + 0.28 ? 'HEEL COUNTER · TPU'
        : tv.y > data.top(xx) - 0.14 && tv.x > -0.35 && tv.x < 0.55 ? 'LACING · 6 EYELETS'
        : 'ENGINEERED MESH';
      lensCoord.innerHTML = `X ${mx.toFixed(1).padStart(5, '0')} · Y ${my.toFixed(1).padStart(4, '0')} MM · <b>${what}</b>${lens.zoom > 1.6 ? ' · ×' + lens.zoom.toFixed(1) : ''}`;
    }
  }

  // callouts
  const placed = [{ x: lens.cx + Math.cos(38 * D) * (R * 1.1 + 6), y: lens.cy + Math.sin(38 * D) * (R * 1.1 + 6) - 14, w: 100, h: 32 }];
  const activeKey = sections[near]?.key;
  const sf = Math.abs(stage - near);
  for (const c of callouts) {
    const on = c.state === activeKey && sf < 0.3 && lens.open > 0.5 && innerWidth > 700;
    c.vis = on;
    c.el.classList.toggle('on', on);
    c.g.style.opacity = on ? 1 : 0;
    if (!on && !c.el.classList.contains('on')) continue;
    project(data.anchors[c.a], pA);
    const w = c.el.offsetWidth || 160, hgt = c.el.offsetHeight || 60;
    const side = STATES[c.state].text;
    let lx = pA.x + c.off[0] * (innerWidth / 1440), ly = pA.y + c.off[1] * (innerHeight / 900);
    if (side === 'l') lx = Math.max(lx, innerWidth * 0.4); else if (side === 'r') lx = Math.min(lx, innerWidth * 0.6 - w);
    // keep labels clear of the lens (and its bezel lettering)
    const rr = R * 1.22 + 14;
    for (let k = 0; k < 3; k++) {
      const qx = clamp(lens.cx, lx, lx + w), qy = clamp(lens.cy, ly, ly + hgt);
      const dx = qx - lens.cx, dy = qy - lens.cy, dd = Math.hypot(dx, dy);
      if (dd >= rr) break;
      let nx = lx + w / 2 - lens.cx, ny = ly + hgt / 2 - lens.cy; const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
      lx += nx * (rr - dd + 2); ly += ny * (rr - dd + 2);
    }
    // back out of the text column; if that lands on the lens again, slide vertically instead
    const lx0 = lx;
    if (side === 'l') lx = Math.max(lx, innerWidth * 0.4); else if (side === 'r') lx = Math.min(lx, innerWidth * 0.6 - w);
    if (lx !== lx0) {
      const qx = clamp(lens.cx, lx, lx + w), qy = clamp(lens.cy, ly, ly + hgt);
      const dy0 = qy - lens.cy, need = Math.sqrt(Math.max(0, rr * rr - (qx - lens.cx) ** 2));
      if (Math.hypot(qx - lens.cx, dy0) < rr) ly = ly + hgt / 2 > lens.cy ? lens.cy + need + 4 : lens.cy - need - hgt - 4;
    }
    lx = clamp(lx, 24, innerWidth - w - 48); ly = clamp(ly, 96, innerHeight - hgt - 90);
    for (let k = 0; k < 3; k++) for (const p of placed) {
      if (lx < p.x + p.w + 10 && lx + w + 10 > p.x && ly < p.y + p.h + 10 && ly + hgt + 10 > p.y) ly = ly > p.y ? p.y + p.h + 12 : p.y - hgt - 12;
    }
    ly = clamp(ly, 96, innerHeight - hgt - 90);
    placed.push({ x: lx, y: ly, w, h: hgt });
    const right = lx + w / 2 > pA.x;
    const ax = right ? lx - 2 : lx + w + 2, ay = ly + 14;
    const ex = right ? ax - 26 : ax + 26;
    c.path.setAttribute('d', `M${pA.x.toFixed(1)} ${pA.y.toFixed(1)} L${ex.toFixed(1)} ${ay.toFixed(1)} L${ax.toFixed(1)} ${ay.toFixed(1)}`);
    c.pin.setAttribute('cx', pA.x.toFixed(1)); c.pin.setAttribute('cy', pA.y.toFixed(1));
    c.ring.setAttribute('cx', pA.x.toFixed(1)); c.ring.setAttribute('cy', pA.y.toFixed(1));
    c.el.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0)`;
  }

  // HUD
  const max = document.documentElement.scrollHeight - innerHeight;
  const prog = max > 0 ? scrollY / max : 0;
  const rh = rulerEl.offsetHeight;
  rulerMark.style.setProperty('--y', (prog * rh).toFixed(1) + 'px');
  rulerVal.textContent = String(Math.round(prog * 1000)).padStart(3, '0');
  document.body.classList.toggle('is-footer', footCover > 0.35);
  document.body.classList.toggle('nav-dark', footEl.getBoundingClientRect().top < 64);

  engine.paused = footCover >= 0.999;
  if (engine.paused) return;
  // world passes
  embers.material.uniforms.uPx.value = innerHeight * Math.min(devicePixelRatio, 1.6) * camera.projectionMatrix.elements[5] / 2;
  if ((engine._frames & 1) === 0) contact.update(scene);
  reflection.update(scene, camera);
});

// ─── Boot ───────────────────────────────────────────────────────────────────
worldNav('velocity', { theme: 'light', corner: 'bl' });
cur = cursor({ color: '#111317', blend: 'normal', size: 30 });
cur?.set('hidden');
magnetic();
const lenis = smoothScroll({ lerp: 0.085 });
reveal('.s h2', { type: 'lines', stagger: 0.08 });
reveal('.lede', { type: 'lines', stagger: 0.04, y: '100%' });
measureSections();
if (isTouch) document.querySelector('.console-hint')?.classList.add('touch');

// Warm up every program (both colourways, every lens mode) before revealing.
white.model.visible = black.model.visible = true; embers.visible = true;
renderer.compile(scene, camera);
for (const s of [...lens.scenes.filter(Boolean), lens.cadN, lens.cadQuadScene, lens.cadDims]) renderer.compile(s, camera);
black.model.visible = false; embers.visible = false;
lens.open = 0;
engine.start();
await loader.finish();
setMode(0);
gsap.to(state, { heroIn: 1, duration: 2.4, ease: 'expo.out' });
gsap.to(state, { open: 1, duration: 1.5, ease: 'expo.out', delay: 0.55 });
gsap.from('.title .t1', { yPercent: 60, opacity: 0, duration: 1.6, ease: 'expo.out', delay: 0.05 });
gsap.from('.title .t2', { yPercent: 60, opacity: 0, duration: 1.6, ease: 'expo.out', delay: 0.14 });
gsap.from('.hero .eyebrow, .hero .sub, .hero-note, .specs > div, .nav > *', { opacity: 0, y: 12, duration: 1.2, ease: 'power3.out', stagger: 0.05, delay: 0.4 });
setTimeout(() => document.body.classList.add('ready'), 900);
window.__vx = {
  setMode, setWay, lens, state, U, get stage() { return stage; },
  goto(k) { measureSections(); const i = typeof k === 'number' ? -1 : sections.findIndex(s => s.key === k); const y = i >= 0 ? anchorsY[i] : k * (document.documentElement.scrollHeight - innerHeight); lenis.scrollTo(y, { immediate: true, force: true }); },
};
setTimeout(() => { window.__vxReady = true; }, 2600);
