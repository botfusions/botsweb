import { ToneMappingMode } from 'postprocessing';
import { Engine, THREE, normalize, prepModel, damp, clamp, smooth, lerp, studioEnvironment } from '../../src/core/engine.js';
import { Assets, firstMesh } from '../../src/core/assets.js';
import { Pointer } from '../../src/core/input.js';
import { smoothScroll, gsap, reveal, ScrollTrigger } from '../../src/core/scroll.js';
import { preloader, cursor, magnetic, worldNav } from '../../src/core/ui.js';
import { VolumetricSpotEffect } from '../../src/core/volumetric.js';
import { PlanarReflection } from '../../src/core/reflector.js';
import { bakeTexture } from '../../src/core/textures.js';
import { analyseSword, heatMaterial } from './heat.js';
import { Sparks, Embers, Steam, HeatHaze, puffTexture } from './fx.js';
import { ForgeAudio } from './audio.js';
import { buildSmithy, ROOM, FIRE, TROUGH, WATER_Y, PRES_Y, PEGS, BLOCK, BLOCK_H } from './smithy.js';

const DBG = new URLSearchParams(location.search);
const coarse = matchMedia('(pointer: coarse)').matches;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ─── Engine ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gl');
let vol, haze;
const engine = new Engine({
  canvas, fov: 36, near: 0.03, far: 40, dpr: coarse ? 2 : 1.5, background: 0x040302,
  post: {
    ao: { aoRadius: 0.45, intensity: 2.6, distanceFalloff: 0.5 },
    bloom: { intensity: 0.7, luminanceThreshold: 0.95, luminanceSmoothing: 0.4, radius: 0.78 },
    pre: cam => [
      (haze = new HeatHaze()),
      (vol = new VolumetricSpotEffect(cam, { density: 0.028, noise: 0.92, noiseScale: 1.5, maxDist: 12, floorY: 0, wind: V(0.03, 0.09, 0.02) })),
    ],
    tone: 'aces',
    vignette: { offset: 0.22, darkness: 0.82 },
    noise: 0.055,
    ca: false,
  },
});
const { scene, camera, renderer } = engine;
scene.fog = new THREE.FogExp2(0x050302, 0.12);

// Environment: dim soot dome, the forge as a hot orange softbox, the moonlit window as a cold one.
scene.environment = studioEnvironment(renderer, {
  top: 0x0e0b09, bottom: 0x030202, blur: 0.06,
  panels: [
    { pos: [4.6, 1.6, -7.0], size: [3.6, 2.4], intensity: 3.2, color: 0xff6a22 },
    { pos: [4.0, -0.5, -6.0], size: [3.0, 1.2], intensity: 1.6, color: 0xff4a10 },
    { pos: [7.0, 2.7, 1.1], size: [1.6, 2.0], intensity: 1.1, color: 0x8ea8d8 },
    { pos: [0, 8, 0], size: [8, 8], intensity: 0.05, color: 0xffcfa0 },
  ],
});
scene.environmentIntensity = 0.4;

const assets = new Assets();
const pointer = new Pointer({ lambda: 5 });
const audio = new ForgeAudio();
const loaderEl = document.querySelector('.loader');
const loaderState = loaderEl.querySelector('.loader-state');
const loader = preloader({
  assets, el: loaderEl, minTime: 1600,
  onValue: v => {
    loaderEl.querySelector('.loader-pct').textContent = String(Math.round(v * 100)).padStart(2, '0');
    loaderEl.style.setProperty('--p', v.toFixed(3));
    loaderState.textContent = v < 0.45 ? 'Lighting the forge' : v < 0.9 ? 'Bringing the billet to heat' : 'At welding heat';
  },
  exit: async () => {
    await gsap.timeline()
      .to('.loader-bar i', { boxShadow: '0 0 40px rgba(255,220,170,1), 0 0 140px rgba(255,140,50,.9)', duration: 0.25 })
      .to(loaderEl, { autoAlpha: 0, duration: 0.9, ease: 'power2.inOut' }, '+=0.1');
  },
});

// ─── Lights ────────────────────────────────────────────────────────────────────
scene.add(new THREE.HemisphereLight(0x1c2436, 0x0a0706, 0.09));
const fireSpot = new THREE.SpotLight(0xff8a45, 0, 0, 0.78, 1.0, 2);
fireSpot.position.set(FIRE.x - 0.12, FIRE.y + 0.34, FIRE.z + 0.5);
fireSpot.target.position.set(-0.1, 0.7, 0.35);
fireSpot.castShadow = true;
fireSpot.shadow.mapSize.set(2048, 2048);
fireSpot.shadow.camera.near = 0.15; fireSpot.shadow.camera.far = 9;
fireSpot.shadow.bias = -0.00025; fireSpot.shadow.normalBias = 0.02;
scene.add(fireSpot, fireSpot.target);
const fireGlow = new THREE.PointLight(0xff7a38, 0, 6.5, 1.7);
fireGlow.position.set(FIRE.x, FIRE.y + 0.28, FIRE.z + 0.12);
scene.add(fireGlow);
const moon = new THREE.SpotLight(0x7f9ccf, 48, 0, 0.3, 0.5, 1.2);
moon.position.set(ROOM.x1 - 0.05, 2.4, 0.55);
moon.target.position.set(0.9, 0, 2.3);
scene.add(moon, moon.target);
const lanternLight = new THREE.PointLight(0xffa458, 1.4, 5, 2);
scene.add(lanternLight);
const bladeLight = new THREE.PointLight(0xff7a2a, 0, 3.2, 2);
const bladeLight2 = new THREE.PointLight(0xff7a2a, 0, 2.6, 2);
scene.add(bladeLight, bladeLight2);
// Finale lights: a cold bone-white key and a warm rim for the finished blade.
const displayKey = new THREE.SpotLight(0xf1e4d0, 0, 0, 0.3, 0.9, 2);
displayKey.position.set(1.25, 2.75, 0.95);
const displayRim = new THREE.SpotLight(0xff9a50, 0, 0, 0.3, 0.9, 2);
displayRim.position.set(3.35, 2.25, 2.75);
const displayRim2 = new THREE.SpotLight(0xbcd0ff, 0, 0, 0.3, 0.9, 2);
displayRim2.position.set(3.4, 1.9, 0.75);
scene.add(displayRim2, displayRim2.target);
scene.add(displayKey, displayKey.target, displayRim, displayRim.target);
const flash = new THREE.PointLight(0xffd6a8, 0, 9, 1.4);
scene.add(flash);
vol.add(moon, { scale: 0.016, range: 0.02, softness: 0.45 });
vol.add(fireSpot, { scale: 0.0016, range: 0.12, softness: 0.6 });

// ─── Assets ────────────────────────────────────────────────────────────────────
const T0 = performance.now();
window.__emberDbg = {};
const [anvilG, swordG, hammerG, brick, brickN, floorT, floorN, damT] = await Promise.all([
  assets.gltf('models/ember/anvil.glb'),
  assets.gltf('models/ember/sword.glb'),
  assets.gltf('models/ember/hammer.glb'),
  assets.texture('img/ember/brick.webp'),
  assets.texture('img/ember/brick-n.webp', { srgb: false }),
  assets.texture('img/ember/floor.webp'),
  assets.texture('img/ember/floor-n.webp', { srgb: false }),
  assets.texture('img/ember/damascus.webp'),
]);
window.__emberDbg.assets = Math.round(performance.now() - T0);
damT.wrapS = THREE.MirroredRepeatWrapping; damT.wrapT = THREE.ClampToEdgeWrapping; damT.anisotropy = 16; damT.needsUpdate = true;

const smithy = buildSmithy({ scene, renderer, tex: { brick, brickN, floor: floorT, floorN } });
lanternLight.position.copy(smithy.lantern.position);

// Anvil on its stump.
const anvil = anvilG.scene;
normalize(anvil, 0.9, { axis: 'y' });
prepModel(anvil, renderer, { env: 0.9 });
scene.add(anvil);
anvil.updateMatrixWorld(true);
const ray = new THREE.Raycaster();
const hitY = (x, z, fallback) => {
  ray.set(V(x, 3, z), V(0, -1, 0));
  const h = ray.intersectObject(anvil, true)[0];
  return h ? h.point.y : fallback;
};
const FACE_Y = Math.max(hitY(0.15, 0, 0.9), hitY(0.3, 0.02, 0.9));
const STUMP_Y = hitY(0.0, 0.29, 0.45);

// The sword.
const swordMesh = firstMesh(swordG.scene);
const SW = analyseSword(swordMesh.geometry, 0.95);
swordMesh.removeFromParent();
swordMesh.matrixAutoUpdate = false;
swordMesh.matrix.copy(SW.matrix);
swordMesh.castShadow = swordMesh.receiveShadow = true;
prepModel(swordMesh, renderer, { env: 1.1 });
const heat = heatMaterial(swordMesh.material, damT);
const sword = new THREE.Group();
sword.add(swordMesh);
scene.add(sword);
const bladeLocal = (u, out, top = true) => out.set(-(1 - u) * SW.bladeLength, top ? SW.halfThickness * 0.7 : 0, 0);

// Finished blades hanging on the north wall.
const wallEnv = studioEnvironment(renderer, {
  top: 0x14100d, bottom: 0x040303, blur: 0.05,
  panels: [
    { pos: [3.5, 1.5, 6.0], size: [5, 3], intensity: 2.2, color: 0xff7a30 },
    { pos: [-5.0, 2.5, 4.0], size: [2, 3], intensity: 1.4, color: 0x9fb4e0 },
    { pos: [0, 6, 3], size: [4, 2], intensity: 0.8, color: 0xffe2c0 },
    { pos: [0.5, 1.0, 8], size: [7, 4], intensity: 2.1, color: 0xeee2d2 },
    { pos: [-2.5, 4.0, 5], size: [3, 2], intensity: 1.6, color: 0xf6ecdf },
  ],
});
const wallSwords = [-1.58, -1.3, -1.02].map((x, i) => {
  const m = swordMesh.clone();
  m.material = swordMesh.material.clone();
  m.material.envMap = wallEnv; m.material.envMapIntensity = 1.3;
  const u = heatMaterial(m.material, damT);
  u.uForged.value = 0; u.uDam.value = 1.4; u.uPeak.value = 0; u.uFront.value = 0;
  const g = new THREE.Group();
  g.add(m);
  g.position.set(x, 1.68 - i * 0.02, ROOM.z0 + 0.1);
  g.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2 + (i - 1) * 0.12, Math.PI / 2 + (i - 1) * 0.02, 'YXZ'));
  scene.add(g);
  return g;
});

// The presentation blade: a finished sword on two pegs above the rack, lit for the macro in "The steel".
const presEnv = studioEnvironment(renderer, {
  top: 0x110d0b, bottom: 0x030202, blur: 0.04,
  panels: [
    { pos: [5.0, 1.2, 6.2], size: [1.6, 9], intensity: 4.2, color: 0xf3e7d6 },
    { pos: [2.2, 1.0, 7.5], size: [1.0, 9], intensity: 1.6, color: 0xffd2a0 },
    { pos: [7.5, 0.5, 2.0], size: [3, 3], intensity: 2.6, color: 0xff6a22 },
    { pos: [-3, 5, 5], size: [4, 2], intensity: 0.6, color: 0xa8bce6 },
  ],
});
const presSword = (() => {
  const m = swordMesh.clone();
  m.material = swordMesh.material.clone();
  m.material.envMap = presEnv; m.material.envMapIntensity = 1.5;
  const u = heatMaterial(m.material, damT);
  u.uForged.value = 0; u.uDam.value = 1.4; u.uPeak.value = 0; u.uFront.value = 0;
  // Lowest point of the mid-blade (sword-space +Z edge) so it rests exactly on the pegs.
  const pos = swordMesh.geometry.attributes.position, bl = swordMesh.geometry.attributes.blade, v = V(0, 0, 0);
  let edge = 0;
  for (let i = 0; i < pos.count; i += 3) { const uu = bl.getX(i); if (uu > 0.2 && uu < 0.8) { v.fromBufferAttribute(pos, i).applyMatrix4(SW.matrix); edge = Math.max(edge, v.z); } }
  const g = new THREE.Group();
  g.add(m);
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(1, 0, 0), V(0, 0, 1), V(0, -1, 0)));
  g.position.set(PEGS[1] + 0.08, PRES_Y - 0.027 + edge, ROOM.z0 + 0.03);
  scene.add(g);
  return g;
})();
const presSpot = new THREE.SpotLight(0xffe0bc, 0, 0, 0.42, 0.85, 2);
presSpot.position.set(-2.35, 2.62, -2.35);
presSpot.target.position.set(-1.05, 2.25, -2.9);
scene.add(presSpot, presSpot.target);
// The finished blade in its block: a strip softbox behind the camera and the forge off to one side.
const displayEnv = studioEnvironment(renderer, {
  top: 0x0f0c0a, bottom: 0x030202, blur: 0.04,
  panels: [
    { pos: [-7.8, 0.6, 1.6], size: [1.5, 10], intensity: 4.0, color: 0xf3e8d8 },
    { pos: [-6.5, 0.8, 4.6], size: [0.8, 10], intensity: 1.6, color: 0xc8d6f4 },
    { pos: [-5.0, 0.2, -6.2], size: [3.5, 2.2], intensity: 4.5, color: 0xff6a22 },
    { pos: [6.0, 3.0, -2.0], size: [2.0, 2.5], intensity: 1.2, color: 0x9fb4e0 },
  ],
});

// The hammer.
const hammerRoot = hammerG.scene;
hammerRoot.updateMatrixWorld(true);
const hBox = new THREE.Box3().setFromObject(hammerRoot);
const hSize = hBox.getSize(V(0, 0, 0));
const HS = 0.42 / hSize.x;
prepModel(hammerRoot, renderer, { env: 0.9 });
// Rig space: hand at the origin, handle along +X toward the hand, striking face pointing -Y.
const hammerInner = new THREE.Group();
hammerInner.add(hammerRoot);
hammerRoot.rotation.x = Math.PI / 2;
hammerRoot.scale.multiplyScalar(HS);
const gripModel = V(hBox.max.x - hSize.x * 0.08, 0, (hBox.min.z + hBox.max.z) / 2 + 0.05);
const faceModel = V(hBox.min.x + hSize.x * 0.08 + 0.02, 0, hBox.max.z);
const headModel = V(hBox.min.x + hSize.x * 0.08 + 0.02, 0, 0);
const toRig = p => V(p.x, -p.z, p.y).multiplyScalar(HS);
hammerRoot.position.copy(toRig(gripModel)).negate();
const FACE_L = toRig(faceModel).sub(toRig(gripModel));
const HEAD_L = toRig(headModel).sub(toRig(gripModel));
const hammer = new THREE.Group();
hammer.add(hammerInner);
scene.add(hammer);

// ─── Brine reflection ─────────────────────────────────────────────────────────
const brine = new PlanarReflection(renderer, { resolution: 0.5, point: V(0, WATER_Y, 0) });
brine.hidden.push(smithy.waterMesh);
{
  const wm = smithy.waterMat, own = wm.onBeforeCompile;
  brine.patch(wm, { strength: 1.8, distort: 0.035, lodScale: 3, lodBias: 0.4, f0: 0.035 });
  const rp = wm.onBeforeCompile;
  wm.onBeforeCompile = sh => { rp(sh); own(sh); };
  wm.customProgramCacheKey = () => 'water-refl';
}
engine.onResize((w, h, dpr) => brine.setSize(w, h, dpr));
const tubSphere = new THREE.Sphere(V(TROUGH.x, WATER_Y, TROUGH.z), 0.45), frustum = new THREE.Frustum(), projM = new THREE.Matrix4();

// ─── Particles & haze ──────────────────────────────────────────────────────────
const sparks = new Sparks({ max: 2600, floor: 0.004 });
scene.add(sparks.mesh);
const embers = new Embers({ count: coarse ? 900 : 1500, forge: V(FIRE.x, FIRE.y + 0.05, FIRE.z), room: new THREE.Box3(V(-3.0, 0.1, -2.7), V(3.4, 3.2, 3.0)), drift: V(-0.32, 0.04, 0.5) });
scene.add(embers.points);
const steam = new Steam({ max: 420, puff: puffTexture(bakeTexture, renderer) });
scene.add(steam.mesh);
engine.onResize((w, h, dpr) => {
  sparks.resize(w, h, dpr);
  embers.uniforms.uDpr.value = dpr;
  haze.uniforms.get('uAsp').value = w / h;
});

// ─── Stations (camera + heat + sword pose per section) ────────────────────────
const ST = {
  hero:       { pos: [-1.7, 1.55, 2.0], look: [-0.74, 0.8, -0.2], fov: 36, front: 0.42, peak: 0.7 },
  fold:       { pos: [-0.85, 1.2, 0.75], look: [0.25, 0.85, -0.35], fov: 34, front: 0.5, peak: 0.76 },
  forge:      { pos: [1.25, 1.1, 1.1], look: [-0.3, 0.85, -0.15], fov: 36, front: 0.6, peak: 0.82 },
  quenchstep: { pos: [2.4, 1.45, 2.0], look: [1.35, 0.45, 0.3], fov: 36, front: 0.68, peak: 0.86 },
  polish:     { pos: [-2.55, 1.5, -1.2], look: [-1.7, 1.55, -2.9], fov: 38, front: 0.74, peak: 0.9 },
  steel:      { pos: [-1.8, 2.14, -2.26], look: [-1.22, 2.3, -2.88], fov: 32, front: 0.98, peak: 0.92 },
  wide:       { pos: [2.3, 2.0, 2.2], look: [0.1, 0.55, -0.7], fov: 42, front: 1.06, peak: 1.0 },
  voices:     { pos: [1.2, 0.6, -1.0], look: [-0.5, 0.95, 0.45], fov: 36, front: 1.06, peak: 1.0 },
  qlift:      { pos: [-0.36, 1.38, 2.17], look: [0.91, 1.15, 0.26], fov: 36, front: 1.06, peak: 1.0, sword: 'lift' },
  qplunge:    { pos: [0.5, 1.05, 1.65], look: [1.15, 0.62, 0.45], fov: 36, front: 1.06, peak: 1.0, sword: 'plunge' },
  qrise:      { pos: [0.3, 1.32, 2.0], look: [1.05, 1.24, 0.42], fov: 34, front: 1.06, peak: 1.0, sword: 'rise' },
  display:    { pos: [-0.3, 1.02, 2.1], look: [2.05, 1.16, 2.02], fov: 34, front: 1.06, peak: 1.0, sword: 'display' },
};
const FOCUS = {
  hero: [0.05, 0.86, 0], fold: [-0.1, 0.9, -0.05], forge: [0.05, 0.9, 0], quenchstep: [1.2, 0.45, 0.45], polish: [-1.3, 1.5, -2.85],
  steel: [-1.3, 2.3, -2.86], wide: [0.2, 0.6, -0.4], voices: [0, 0.9, 0], qlift: [1.2, 1.15, 0.45], qplunge: [1.2, 0.62, 0.45], qrise: [1.2, 1.25, 0.45], display: [2.05, 1.1, 1.75],
};
for (const k in ST) { ST[k].pos = V(...ST[k].pos); ST[k].look = V(...ST[k].look); ST[k].focus = V(...FOCUS[k]); ST[k].sword ??= 'anvil'; ST[k].key = k; }
const stEls = [...document.querySelectorAll('[data-station]')];
const stations = stEls.map(el => ST[el.dataset.station]);
let anchors = [];
function measure() {
  const max = document.documentElement.scrollHeight - innerHeight;
  anchors = stEls.map((el, i) => {
    const r = el.getBoundingClientRect();
    const top = r.top + scrollY;
    if (i === 0) return 0;
    const a = el.classList.contains('q-marker') ? top - innerHeight * 0.5 : top + r.height / 2 - innerHeight / 2;
    return Math.min(a, max);
  });
}
addEventListener('resize', () => requestAnimationFrame(measure));
document.fonts?.ready.then(measure);

// Sword poses.
const qAnvil = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.06, 0));
// Vertical, hilt up, the flat turned toward the display camera.
const vertFacing = f => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 1, 0), f, new THREE.Vector3().crossVectors(V(0, 1, 0), f)));
const faceQ = V(ST.qplunge.pos.x - TROUGH.x, 0, ST.qplunge.pos.z - TROUGH.z).normalize();
const faceD = V(ST.display.pos.x - BLOCK.x, 0, ST.display.pos.z - BLOCK.z).normalize().applyAxisAngle(V(0, 1, 0), 0.22);
const qVert = vertFacing(faceQ), qShow = vertFacing(faceD);
const qPlunge = new THREE.Quaternion().setFromAxisAngle(faceQ, 0.3).multiply(qVert);
const L = SW.bladeLength;
const tipAt = (tip, q) => tip.clone().sub(V(-L, 0, 0).applyQuaternion(q));
const POSES = {
  anvil: { p: V(0.47, 0, 0.0), q: qAnvil },
  lift: { p: tipAt(V(TROUGH.x, WATER_Y + 0.26, TROUGH.z), qVert), q: qVert },
  plunge: { p: tipAt(V(TROUGH.x - 0.04, WATER_Y - 0.34, TROUGH.z + 0.02), qPlunge), q: qPlunge },
  rise: { p: tipAt(V(TROUGH.x, WATER_Y + 0.2, TROUGH.z), qVert), q: qVert },
  display: { p: tipAt(V(BLOCK.x, BLOCK_H - 0.05, BLOCK.z), qShow), q: qShow },
};
POSES.anvil.p.y = FACE_Y - SW.thickMin + 0.0015;

// ─── Hammer rig ────────────────────────────────────────────────────────────────
const hm = {
  state: 'rest', t: 0,
  from: { p: V(0, 0, 0), q: new THREE.Quaternion() },
  cur: { p: V(0, 0, 0), q: new THREE.Quaternion() },
  rest: { p: V(0, 0, 0), q: new THREE.Quaternion() },
  impact: { p: V(0, 0, 0), q: new THREE.Quaternion() },
  raised: { p: V(0, 0, 0), q: new THREE.Quaternion() },
  axis: V(0, 0, 1), target: V(0, 0, 0), u: 0.4,
};
{
  // Lying on the stump, head near the anvil foot, handle out toward the smith.
  const handle = V(0.75, 0, -0.66).normalize();
  const up = V(0, 1, 0);
  const y = new THREE.Vector3().crossVectors(up, handle);
  const m = new THREE.Matrix4().makeBasis(handle, y, up);
  hm.rest.q.setFromRotationMatrix(m);
  const headRest = V(-0.05, STUMP_Y + 0.03, -0.25);
  hm.rest.p.copy(headRest).sub(HEAD_L.clone().applyQuaternion(hm.rest.q));
  hm.cur.p.copy(hm.rest.p); hm.cur.q.copy(hm.rest.q);
}
const tmpV = V(0, 0, 0), tmpV2 = V(0, 0, 0), tmpQ = new THREE.Quaternion();
function strikeTarget(out) {
  hm.u = clamp(heat.uFront.value * 0.52, 0.3, 0.52);
  sword.updateMatrixWorld(true);
  return out.copy(bladeLocal(hm.u, tmpV)).applyMatrix4(sword.matrixWorld);
}
function computeSwing() {
  strikeTarget(hm.target);
  const D = V(0.5, 0.34, -1).normalize(); // handle direction at impact: toward the smith across the anvil, rising slightly
  const Y = V(0, 1, 0).addScaledVector(D, -D.y).normalize();
  const Z = new THREE.Vector3().crossVectors(D, Y);
  hm.impact.q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(D, Y, Z));
  hm.impact.p.copy(hm.target).sub(FACE_L.clone().applyQuaternion(hm.impact.q));
  hm.axis.copy(Z);
  // Raised: rotate about the wrist so the head lifts up and back, and lift the arm.
  const th = 1.35;
  tmpQ.setFromAxisAngle(hm.axis, th);
  const headA = HEAD_L.clone().applyQuaternion(tmpQ.clone().multiply(hm.impact.q));
  const sgn = headA.y > HEAD_L.clone().applyQuaternion(hm.impact.q).y ? 1 : -1;
  hm.sign = sgn;
  hm.raised.q.setFromAxisAngle(hm.axis, th * sgn).multiply(hm.impact.q);
  hm.raised.p.copy(hm.impact.p).add(V(0, 0.2, 0)).addScaledVector(D, 0.1);
}
const ease = {
  out: t => 1 - Math.pow(1 - t, 3), inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), in: t => t * t * t,
};
function setPose(p, q, arc = 0) { hammer.position.copy(p); hammer.position.y += arc; hammer.quaternion.copy(q); hm.cur.p.copy(hammer.position); hm.cur.q.copy(q); }
function blendPose(a, b, t, arc = 0) {
  tmpV.lerpVectors(a.p, b.p, t);
  tmpQ.slerpQuaternions(a.q, b.q, t);
  setPose(tmpV, tmpQ, Math.sin(t * Math.PI) * arc);
}
const hammerApi = {
  canStrike: () => swordOnAnvil > 0.95,
  grab() {
    if (!this.canStrike() || hm.state === 'swing') return false;
    computeSwing();
    hm.from.p.copy(hm.cur.p); hm.from.q.copy(hm.cur.q);
    hm.state = 'grab'; hm.t = 0; hm.release = false;
    return true;
  },
  release() { if (hm.state === 'grab' || hm.state === 'raised') hm.release = true; },
  cancel() {
    if (hm.state === 'grab' || hm.state === 'raised') { hm.from.p.copy(hm.cur.p); hm.from.q.copy(hm.cur.q); hm.state = 'return'; hm.t = 0; }
  },
};
function updateHammer(dt) {
  hm.t += dt;
  if (hm.state === 'rest') { setPose(hm.rest.p, hm.rest.q); return; }
  if (hm.state === 'grab') {
    const k = clamp(hm.t / 0.2);
    blendPose(hm.from, hm.raised, ease.out(k), 0.08);
    if (k >= 1) { hm.state = 'raised'; hm.t = 0; }
  }
  if (hm.state === 'raised') {
    // Tiny tremble at the top of the swing.
    tmpQ.setFromAxisAngle(hm.axis, Math.sin(hm.t * 30) * 0.01).multiply(hm.raised.q);
    setPose(hm.raised.p, tmpQ);
    if (hm.release && hm.t > 0.04) { hm.state = 'swing'; hm.t = 0; computeSwing(); }
  }
  if (hm.state === 'swing') {
    const k = clamp(hm.t / 0.11);
    const e = ease.in(k);
    tmpQ.setFromAxisAngle(hm.axis, 1.35 * hm.sign * (1 - e)).multiply(hm.impact.q);
    tmpV.lerpVectors(hm.raised.p, hm.impact.p, e);
    setPose(tmpV, tmpQ);
    if (k >= 1) { hm.state = 'recoil'; hm.t = 0; impact(hm.target); }
  }
  if (hm.state === 'recoil') {
    const k = clamp(hm.t / 0.18);
    tmpQ.setFromAxisAngle(hm.axis, 0.34 * hm.sign * Math.sin(k * Math.PI * 0.9)).multiply(hm.impact.q);
    tmpV.copy(hm.impact.p).add(V(0, Math.sin(k * Math.PI * 0.9) * 0.03, 0));
    setPose(tmpV, tmpQ);
    if (k >= 1) { hm.state = 'hover'; hm.t = 0; hm.from.p.copy(hm.cur.p); hm.from.q.copy(hm.cur.q); }
  }
  if (hm.state === 'hover') {
    // Held just above the steel for a beat, ready for another blow.
    const k = clamp(hm.t / 0.25);
    tmpQ.setFromAxisAngle(hm.axis, 0.45 * hm.sign).multiply(hm.impact.q);
    tmpV.copy(hm.impact.p).add(V(0, 0.07, 0));
    blendPose(hm.from, { p: tmpV.clone(), q: tmpQ.clone() }, ease.out(k));
    if (hm.t > 0.32) { hm.state = 'return'; hm.t = 0; hm.from.p.copy(hm.cur.p); hm.from.q.copy(hm.cur.q); }
  }
  if (hm.state === 'return') {
    const k = clamp(hm.t / 0.7);
    blendPose(hm.from, hm.rest, ease.inOut(k), 0.12);
    if (k >= 1) hm.state = 'rest';
  }
}

// ─── Strike ────────────────────────────────────────────────────────────────────
const flashEl = document.querySelector('.flash');
const foldsEl = document.querySelector('.hud-f');
let folds = 0, shake = 0, lastStrike = -10, strikeScreen = new THREE.Vector2();
let heatBoost = 0;
function impact(p) {
  const t = engine.time;
  const h = heat.uPeak.value * smooth(0.0, 0.3, heat.uFront.value - hm.u + 0.25);
  sparks.burst(p, { count: Math.round(50 + h * 190), flakes: Math.round(14 + h * 46), power: 0.4 + h * 0.7, time: t });
  heat.uStrike.value.set(hm.u, 1, 0);
  shake = 1;
  lastStrike = t;
  heatBoost = Math.min(heatBoost + 0.02, 0.35);
  gsap.fromTo(flash, { intensity: 6 + h * 10 }, { intensity: 0, duration: 0.5, ease: 'expo.out', overwrite: true });
  flash.position.copy(p).add(V(0, 0.4, 0.35));
  tmpV.copy(p).project(camera);
  strikeScreen.set((tmpV.x + 1) / 2, (tmpV.y + 1) / 2);
  flashEl.style.setProperty('--fx', (strikeScreen.x * 100).toFixed(1) + '%');
  flashEl.style.setProperty('--fy', ((1 - strikeScreen.y) * 100).toFixed(1) + '%');
  gsap.fromTo(flashEl, { opacity: 0.1 + h * 0.18 }, { opacity: 0, duration: 0.5, ease: 'expo.out', overwrite: true });
  if (audioReady) audio.clang(0.6 + h * 0.4, h);
  folds = Math.min(512, folds + 1);
  foldsEl.textContent = String(folds).padStart(3, '0');
  gsap.fromTo(foldsEl, { scale: 1.35, color: '#ffb35a' }, { scale: 1, color: '#e2d6c2', duration: 0.6, ease: 'expo.out' });
  if (folds === 512) toast('512 folds. Now quench it.');
}

// ─── Input: click to strike, hold for the bellows ─────────────────────────────
let press = null, holdTimer = 0, bellowsHeld = false, audioReady = false;
const cur = cursor({ color: '#ffd9b8', blend: 'normal', size: 34 });
const blocked = e => e.target.closest?.('a,button,input,form,.blade-card,.cta-row,.foot,.tw-nav,.nav');
addEventListener('pointerdown', e => {
  if (e.button !== 0 || blocked(e) || !started) return;
  audio.ensure(); audioReady = true; audio.setEnabled(soundOn);
  press = { t: performance.now() };
  if (!coarse) hammerApi.grab(); // touch waits for a clean tap so scrolling never lifts the hammer
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    if (!press) return;
    press.hold = true;
    hammerApi.cancel();
    bellowsHeld = true;
    document.body.classList.add('is-bellows');
    cur?.set('hold', 'Bellows');
    audio.bellows(true);
  }, 280);
});
const endPress = cancel => {
  if (!press) return;
  clearTimeout(holdTimer);
  if (press.hold) { bellowsHeld = false; document.body.classList.remove('is-bellows'); audio.bellows(false); cur?.set(''); }
  else if (cancel) hammerApi.cancel();
  else if (coarse) { if (hammerApi.grab()) setTimeout(() => hammerApi.release(), 40); }
  else hammerApi.release();
  press = null;
};
addEventListener('pointerup', () => endPress(false));
addEventListener('pointercancel', () => endPress(true));
addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && document.activeElement === document.body) { e.preventDefault(); if (hammerApi.grab()) setTimeout(() => hammerApi.release(), 60); } });

// Sound toggle.
const soundBtn = document.querySelector('.sound');
let soundOn = true;
soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  soundBtn.setAttribute('aria-pressed', String(soundOn));
  soundBtn.querySelector('.sound-label').textContent = soundOn ? 'Sound on' : 'Sound off';
  if (audioReady) audio.setEnabled(soundOn);
});

const toastEl = document.querySelector('.toast');
let toastTimer;
function toast(msg, ms = 2600) { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms); }

// ─── HUD ───────────────────────────────────────────────────────────────────────
const hudBel = document.querySelector('.hud-bellows');
const hintEl = document.querySelector('.hint');
const hudC = document.querySelector('.hud-c'), hudName = document.querySelector('.hud-name'), hudEl = document.querySelector('.hud');
const HEATS = [[480, 'Black heat'], [580, 'Faint red'], [680, 'Blood red'], [780, 'Dark cherry'], [880, 'Cherry red'], [980, 'Bright cherry'], [1080, 'Orange'], [1180, 'Yellow'], [1280, 'Light yellow'], [9999, 'Welding white']];
let hudShown = -1, hudTick = 0;
const hudAvoid = [...document.querySelectorAll('.stats, .blades, .foot-grid, .quotes blockquote, .steel-head, .steel-lede, .com-head, .step > *')];

// ─── Frame loop ────────────────────────────────────────────────────────────────
const camPos = V(0, 0, 0), camLook = V(0, 0, 0), camTmp = V(0, 0, 0);
let camT = 0, swordOnAnvil = 1, started = false, intro = { fire: 0, heat: 0 };
let coolFront = 0, damFront = 0, lastSteamT = 0, submergedPrev = 0;
const qaEl = document.querySelector('.q-a'), qbEl = document.querySelector('.q-b');
const shakeN = t => Math.sin(t * 91.3) * 0.5 + Math.sin(t * 57.1 + 1.3) * 0.35 + Math.sin(t * 131.7 + 2.1) * 0.15;
const hazePts = haze.uniforms.get('uPts').value;
const debugCam = DBG.get('cam')?.split(',').map(Number);

function stationBlend(y) {
  // Returns [i, f] with f eased so the camera settles at each station.
  if (!anchors.length) return [0, 0, 0];
  let i = 0;
  while (i < anchors.length - 2 && y >= anchors[i + 1]) i++;
  const a = anchors[i], b = anchors[i + 1] ?? a + 1;
  const raw = clamp((y - a) / Math.max(b - a, 1));
  return [i, smooth(0.08, 0.92, raw), raw];
}

engine.onTick((dt, t) => {
  pointer.update(dt);
  const y = window.__lenis?.animatedScroll ?? scrollY;
  const [si, sf, raw] = stationBlend(y);
  camT = damp(camT, si + sf, 6, dt);
  const i0 = Math.min(Math.floor(camT), stations.length - 1), i1 = Math.min(i0 + 1, stations.length - 1), f = camT - i0;
  const A = stations[i0], B = stations[i1];
  const heatT = si + raw; // unsmoothed for heat, so the steel keeps warming as you read
  const hA = stations[Math.min(Math.floor(heatT), stations.length - 1)], hB = stations[Math.min(Math.floor(heatT) + 1, stations.length - 1)], hf = heatT - Math.floor(heatT);
  document.body.classList.toggle('is-scrolled', y > 40);

  // Camera.
  camPos.lerpVectors(A.pos, B.pos, f);
  camLook.lerpVectors(A.look, B.look, f);
  // Keep long moves from cutting through the anvil: lift the path a little mid-transition.
  camPos.y += Math.sin(f * Math.PI) * A.pos.distanceTo(B.pos) * 0.08;
  camera.fov = lerp(A.fov, B.fov, f);
  const asp = camera.aspect;
  if (asp < 1) {
    // Portrait: aim at the subject itself, pull back, and lift it into the upper half above the copy.
    const dir = camTmp.copy(camPos).sub(camLook);
    camLook.lerpVectors(A.focus, B.focus, f);
    const k = 1 + (1 - asp) * 1.05;
    camPos.copy(camLook).addScaledVector(dir, k);
    camLook.y -= dir.length() * k * 0.2 * (1 - asp);
  }
  const dc = window.__cam ?? debugCam;
  if (dc) { camPos.set(dc[0], dc[1], dc[2]); camLook.set(dc[3], dc[4], dc[5]); if (dc[6]) camera.fov = dc[6]; }
  shake = Math.max(0, shake - dt * 3.2);
  const sh = shake * shake * 0.018;
  camera.position.copy(camPos).add(camTmp.set(pointer.sx * 0.06 + Math.sin(t * 0.3) * 0.012 + shakeN(t) * sh, pointer.sy * 0.035 + Math.sin(t * 0.47) * 0.008 + shakeN(t + 7) * sh, 0));
  camera.lookAt(camLook.x + shakeN(t + 3) * sh * 0.6, camLook.y + shakeN(t + 5) * sh * 0.6, camLook.z);
  camera.updateProjectionMatrix();

  // Bellows.
  const bel = embers.uniforms.uBellows;
  bel.value = damp(bel.value, bellowsHeld ? 1 : 0, bellowsHeld ? 2.2 : 1.1, dt);
  if (bellowsHeld) heatBoost = Math.min(heatBoost + dt * 0.1, 0.4);
  else heatBoost = Math.max(0, heatBoost - dt * 0.012);
  hudBel.style.setProperty('--b', bel.value.toFixed(3));

  // Heat along the page.
  const frontT = lerp(hA.front, hB.front, hf) * intro.heat + heatBoost;
  const peakT = Math.min(1, lerp(hA.peak, hB.peak, hf) * intro.heat + heatBoost * 0.5 + bel.value * 0.06);
  const rate = 1.1 + bel.value * 2.2;
  heat.uFront.value = damp(heat.uFront.value, Math.min(frontT, 1.12), rate, dt);
  heat.uPeak.value = damp(heat.uPeak.value, peakT, rate, dt);
  heat.uTime.value = t;
  heat.uStrike.value.z = t - lastStrike;

  // Fire.
  const flick = 0.82 + 0.1 * Math.sin(t * 13.1) * Math.sin(t * 7.3 + 1.2) + 0.08 * Math.sin(t * 23.7);
  const pump = bel.value * (0.8 + 0.2 * Math.sin(t * 5.5));
  const fireLevel = intro.fire * (1 + pump * 1.1);
  if (bel.value > 0.3 && Math.random() < dt * 14 * bel.value) sparks.pop(tmpV.set(FIRE.x + (Math.random() - 0.5) * 0.4, FIRE.y + 0.1, FIRE.z + (Math.random() - 0.5) * 0.3), t, 1);
  smithy.fire.uTime.value = t;
  smithy.fire.uFire.value = fireLevel;
  fireSpot.intensity = 36 * fireLevel * flick;
  fireGlow.intensity = 18 * fireLevel * (flick * 0.8 + 0.2);
  lanternLight.intensity = 5.5 * (0.94 + Math.sin(t * 17) * 0.03 + Math.sin(t * 5.3) * 0.03) * intro.fire;
  embers.uniforms.uClock.value += dt * (1 + bel.value * 2.4);
  embers.uniforms.uTime.value = t;
  embers.uniforms.uFire.value = intro.fire;
  if (audioReady) audio.fire(bel.value);

  // Sword pose: blend between the station poses.
  const pA = POSES[A.sword], pB = POSES[B.sword];
  const sf2 = A.sword === B.sword ? 0 : f;
  sword.position.lerpVectors(pA.p, pB.p, sf2);
  sword.quaternion.slerpQuaternions(pA.q, pB.q, sf2);
  if (A.sword === 'anvil' && B.sword !== 'anvil') sword.position.y += Math.sin(sf2 * Math.PI) * 0.25;
  if (A.sword !== 'anvil' && B.sword !== 'display') sword.position.y += Math.sin(t * 1.3) * 0.004; // held, not fixed
  if (B.sword === 'display' && A.sword !== 'display') sword.position.y += Math.sin(sf2 * Math.PI) * 0.12; // lifted over, set down
  swordOnAnvil = A.sword === 'anvil' ? (B.sword === 'anvil' ? 1 : 1 - sf2) : 0;
  sword.updateMatrixWorld(true);

  // Quench: which part of the blade is under the brine?
  const tipW = bladeLocal(0, tmpV, false).applyMatrix4(sword.matrixWorld);
  const guardW = bladeLocal(1, tmpV2, false).applyMatrix4(sword.matrixWorld);
  const inTrough = Math.hypot(tipW.x - TROUGH.x, tipW.z - TROUGH.z) < 0.33;
  const uSub = inTrough && tipW.y < WATER_Y ? clamp((WATER_Y - tipW.y) / Math.max(guardW.y - tipW.y, 0.01)) : 0;
  // The quench is tied to scroll position (so jumps via the nav still land on a finished blade),
  // but the cold front travels up the steel over time.
  const qpi = anchorIndex('qplunge');
  const coolTarget = Math.max(uSub > 0 ? uSub + 0.06 : 0, camT > qpi + 0.12 ? 1.25 : 0);
  coolFront = coolTarget > coolFront ? damp(coolFront, coolTarget, uSub > 0 ? 2.6 : 1.6, dt) : damp(coolFront, coolTarget, 1.0, dt);
  heat.uCool.value = coolFront;
  // Scale falls away as it rises from the brine.
  const damTarget = camT > anchorIndex('qrise') - 0.5 ? clamp((camT - (anchorIndex('qrise') - 0.5)) / 1.2) * 1.4 : 0;
  damFront = damp(damFront, damTarget * smooth(0.6, 1.0, coolFront), 3, dt);
  heat.uDam.value = damFront;
  heat.uForged.value = 1;
  const reveal = clamp(damFront / 1.2);
  swordMesh.material.envMap = reveal > 0.02 ? displayEnv : null;
  swordMesh.material.envMapIntensity = lerp(1.1, 1.6, reveal);
  const onDisplay = smooth(anchorIndex('display') - 1, anchorIndex('display') - 0.2, camT);
  displayKey.intensity = reveal * 14 + onDisplay * 10; displayRim.intensity = reveal * 16 + onDisplay * 14; displayRim2.intensity = onDisplay * 12;
  displayKey.target.position.set(sword.position.x, sword.position.y - L * 0.55, sword.position.z);
  displayRim.target.position.copy(displayKey.target.position); displayRim2.target.position.copy(displayKey.target.position);
  const nearSteel = clamp(1 - Math.abs(camT - anchorIndex('steel')) / 1.1);
  presSpot.intensity = 3 + nearSteel * 9;

  // Steam: hot steel entering water.
  const hotSub = Math.max(0, uSub - coolFront * 0.6) * heat.uPeak.value;
  const entering = Math.max(0, uSub - submergedPrev);
  submergedPrev = uSub;
  let steamRate = hotSub * 170 + entering * 1400 + (uSub > 0 ? 6 : 0) + (coolFront > 0.3 && coolFront < 1.19 && uSub === 0 ? 8 : 0);
  steam.uniforms.uTime.value = t;
  if (steamRate > 0) {
    lastSteamT += dt * steamRate;
    while (lastSteamT > 1) {
      lastSteamT -= 1;
      if (uSub > 0) {
        // Emit at the waterline where the blade pierces it.
        const k = clamp((WATER_Y - tipW.y) / Math.max(guardW.y - tipW.y, 0.01));
        tmpV.lerpVectors(tipW, guardW, k);
        tmpV.y = WATER_Y + 0.01;
        steam.emit(tmpV, t, { spread: 0.1, vel: 0.6 + hotSub * 0.9, size: 0.09 + hotSub * 0.08, life: 3.0 });
      } else {
        tmpV.lerpVectors(tipW, guardW, Math.random() * 0.9);
        steam.emit(tmpV, t, { spread: 0.02, vel: 0.25, size: 0.08, life: 2.4 });
      }
    }
  }
  const glowK = 520 + heat.uPeak.value * 1080;
  const glowCol = blackbodyJS(glowK);
  const glowI = Math.pow(Math.max(glowK - 720, 0) / 930, 2.6);
  steam.uniforms.uGlow.value.copy(glowCol).multiplyScalar(glowI * 9 * clamp(Math.max(0, uSub - coolFront * 0.8 + 0.15)) * (uSub > 0 ? 1 : 0));
  steam.uniforms.uFire.value.setRGB(0.1, 0.045, 0.02).multiplyScalar(fireLevel);
  smithy.water.uTime.value = t;
  smithy.water.uBlade.value.set(tipW.x + (guardW.x - tipW.x) * uSub, tipW.z + (guardW.z - tipW.z) * uSub);
  smithy.water.uBoil.value = damp(smithy.water.uBoil.value, uSub > 0 ? clamp(hotSub * 3 + 0.2) : 0, 3, dt);
  smithy.water.uGlow.value.copy(glowCol).multiplyScalar(glowI * 4 * Math.max(0, uSub - coolFront * 0.9 + 0.05));
  if (audioReady) audio.hiss(uSub > 0 ? hotSub * 2 + entering * 20 : 0);

  // Light from the hot steel itself.
  const fr = heat.uFront.value;
  const hotLen = Math.max(0, Math.min(fr, 1) - coolFront);
  const peakK = 520 + heat.uPeak.value * 1080 * (coolFront > 1 ? 0 : 1);
  const bI = Math.pow(Math.max(peakK - 720, 0) / 930, 2.6);
  bladeLight.color.copy(blackbodyJS(peakK));
  bladeLight2.color.copy(bladeLight.color);
  bladeLocal(clamp(coolFront + hotLen * 0.3, 0, 1), bladeLight.position).applyMatrix4(sword.matrixWorld);
  bladeLocal(clamp(coolFront + hotLen * 0.75, 0, 1), bladeLight2.position).applyMatrix4(sword.matrixWorld);
  bladeLight.position.y += 0.16; bladeLight2.position.y += 0.16;
  bladeLight.intensity = bI * 7 * Math.min(1, hotLen * 2.5);
  bladeLight2.intensity = bI * 4.5 * Math.min(1, hotLen * 1.6);

  // Glowing flakes popping off the hottest steel.
  if (swordOnAnvil > 0.9 && Math.random() < dt * heat.uPeak.value * fr * 5) {
    bladeLocal(Math.random() * Math.min(fr, 1) * 0.9, tmpV).applyMatrix4(sword.matrixWorld);
    sparks.pop(tmpV, t, 1 + (Math.random() < 0.3 ? 1 : 0));
  }
  sparks.uniforms.uTime.value = t;

  // Heat haze above the hot part of the blade (screen space).
  for (let k = 0; k < 8; k++) {
    const u = clamp(coolFront + (k + 0.5) / 8 * hotLen, 0, 1);
    bladeLocal(u, tmpV).applyMatrix4(sword.matrixWorld).project(camera);
    const vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.3 && Math.abs(tmpV.y) < 1.3 ? 1 : 0;
    hazePts[k].set((tmpV.x + 1) / 2, (tmpV.y + 1) / 2, vis * Math.min(1, hotLen * 2) * heat.uPeak.value * 0.5);
  }
  const shockAge = t - lastStrike;
  haze.uniforms.get('uShock').value.set(strikeScreen.x, strikeScreen.y, shockAge * 0.75, shockAge < 0.6 ? (1 - shockAge / 0.6) : 0);
  haze.uniforms.get('uHazeTime').value = t;

  // Brine reflection, only while the tub is in view.
  camera.updateMatrixWorld();
  frustum.setFromProjectionMatrix(projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  brine.enabled = frustum.intersectsSphere(tubSphere);
  smithy.water.uForgeCol.value.setRGB(1.0, 0.36, 0.09).multiplyScalar(fireLevel * flick * 1.2);
  brine.update(scene, camera);

  // Hammer.
  updateHammer(dt);
  if (swordOnAnvil < 0.95 && hm.state !== 'rest' && hm.state !== 'return') hammerApi.cancel();

  // Finale copy.
  const qi = anchorIndex('qplunge'), ri = anchorIndex('qrise'), di = anchorIndex('display');
  qaEl.style.opacity = (smooth(qi - 1.1, qi - 0.5, camT) * (1 - smooth(qi + 0.35, qi + 0.85, camT))).toFixed(3);
  qbEl.style.opacity = smooth(di - 0.5, di - 0.05, camT).toFixed(3);
  qbEl.style.transform = `translateY(${((1 - smooth(di - 0.5, di, camT)) * 30).toFixed(1)}px)`;
  document.body.classList.toggle('is-finale', camT > anchorIndex('qlift') - 0.4);

  // HUD: step aside when content panels pass underneath it.
  if ((hudTick = (hudTick + 1) % 8) === 0) {
    const hr = hudEl.getBoundingClientRect();
    let over = false;
    for (const el of hudAvoid) { const r = el.getBoundingClientRect(); if (r.top < hr.bottom && r.bottom > hr.top && r.left < hr.right && r.right > hr.left) { over = true; break; } }
    hudEl.classList.toggle('hud-away', over);
    hintEl.classList.toggle('away', over || y > innerHeight * 5.5);
  }
  // HUD.
  const hottest = Math.max(0, heat.uPeak.value * (hotLen > 0.02 ? 1 : 0) * (1 + (t - lastStrike < 0.4 ? 0.04 : 0)));
  const C = Math.round((520 + hottest * 1080 - 273) / 5) * 5;
  if (C !== hudShown) {
    hudShown = C;
    hudC.textContent = Math.max(C, 20).toLocaleString('en-US');
    hudName.textContent = HEATS.find(h => C < h[0])[1];
    hudEl.style.setProperty('--t', clamp((C - 250) / 1100).toFixed(3));
  }
});
function anchorIndex(key) { const i = stations.findIndex(s => s.key === key); return i < 0 ? 99 : i; }
function blackbodyJS(K) {
  const t = K / 100;
  let g = clamp((99.4708025861 * Math.log(Math.max(t, 1)) - 161.1195681661) / 255);
  let b = t <= 19 ? 0 : clamp((138.5177312231 * Math.log(t - 10) - 305.0447927307) / 255);
  const c = new THREE.Color(1, Math.pow(g, 2.2), Math.pow(b, 2.2));
  c.g += smooth(1250, 1750, K) * 0.16;
  return c;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
worldNav('ember', { theme: 'dark', corner: 'bl' });
if (coarse) { document.querySelector('.k-strike').textContent = 'Tap'; document.querySelector('.k-verb').textContent = 'tap'; }
magnetic();
const lenis = smoothScroll({ lerp: 0.08 });
// In-page links glide through the scene instead of jumping; the commission CTA lands on the finished blade.
document.addEventListener('click', e => {
  const a = e.target.closest?.('a[href^="#"]');
  if (!a) return;
  const id = a.getAttribute('href').slice(1);
  e.preventDefault();
  let y = 0;
  if (id === 'commission') y = anchors[anchorIndex('display')] ?? 0;
  else if (id && id !== 'top') { const el = document.getElementById(id); if (el) y = el.getBoundingClientRect().top + scrollY; }
  const dist = Math.abs(y - scrollY) / innerHeight;
  lenis.scrollTo(y, { duration: Math.min(1.2 + dist * 0.35, 4.5), easing: t => 1 - Math.pow(1 - t, 3) });
});
measure();
// Cursor label over the forge.
document.addEventListener('pointermove', e => {
  if (!cur || bellowsHeld) return;
  const over3D = !blocked(e) && swordOnAnvil > 0.95;
  if (over3D && cur.root.dataset.state !== 'link') cur.set('strike', '');
  else if (!over3D && cur.root.dataset.state === 'strike') cur.set('');
}, { passive: true });

// Warm up every program with the fire and the steel at full heat.
intro.fire = 1; intro.heat = 1;
heat.uPeak.value = 1; heat.uFront.value = 0.6;
camera.position.copy(ST.hero.pos); camera.lookAt(ST.hero.look);
const TC = performance.now();
renderer.compile(scene, camera);
window.__emberDbg.compile = Math.round(performance.now() - TC);
sparks.burst(V(0, 1, 0), { count: 1, flakes: 1, time: -10 });
steam.emit(V(0, -5, 0), -100);
intro.fire = 0; intro.heat = 0;
heat.uPeak.value = 0; heat.uFront.value = 0;
gsap.set('.title .t-line > span, .title .t-accent > span', { yPercent: 110 });
gsap.set('.eyebrow, .sub, .hint, .hud, .nav', { opacity: 0 });
engine.start();
window.__ember = { setTone: m => { engine.post.tone.mode = ToneMappingMode[m]; }, post: engine.post, sparks, steam, embers, smithy, heat, hm, hammerApi, stations, anchors: () => anchors, impact, POSES, sword, SW, FACE_Y, STUMP_Y, camera };
if (DBG.has('now')) { intro.fire = 1; intro.heat = 1; }
await loader.finish();
started = true;
measure();
window.__emberReady = true;
window.__emberDbg.ready = Math.round(performance.now() - T0);

// Intro: the fire wakes, the steel comes up to heat, the first blow lands with the title.
reveal('.step h2, .steel-head h2, .com-head h2, .q-b h2', { type: 'lines', stagger: 0.09 });
reveal('.quotes blockquote p, .lede', { type: 'lines', stagger: 0.05, y: '100%' });
gsap.to(intro, { fire: 1, duration: 2.2, ease: 'power2.out' });
gsap.to(intro, { heat: 1, duration: 2.6, ease: 'power2.inOut', delay: 0.2 });
setTimeout(() => { if (hammerApi.grab()) setTimeout(() => hammerApi.release(), 120); }, 1300);
gsap.to('.title .t-line > span', { yPercent: 0, duration: 1.1, ease: 'expo.out', stagger: 0.07, delay: 1.72 });
gsap.to('.title .t-accent > span', { yPercent: 0, duration: 1.4, ease: 'expo.out', delay: 2.05 });
gsap.to('.eyebrow, .sub, .hint, .hud, .nav', { opacity: 1, duration: 1.2, ease: 'power2.out', stagger: 0.06, delay: 2.2 });

// Count-up stats.
document.querySelectorAll('.stats .num[data-count]').forEach(el => {
  const to = +el.dataset.count, dec = +(el.dataset.dec ?? 0);
  const o = { v: 0 };
  gsap.to(o, { v: to, duration: 2, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 90%', once: true },
    onUpdate: () => { el.textContent = o.v.toFixed(dec); } });
});
