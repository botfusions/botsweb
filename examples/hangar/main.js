import { Engine, THREE, normalize, prepModel, damp, clamp, smooth, lerp, studioEnvironment } from '../../src/core/engine.js';
import { Assets, firstMesh } from '../../src/core/assets.js';
import { Pointer } from '../../src/core/input.js';
import { smoothScroll, gsap } from '../../src/core/scroll.js';
import { preloader, cursor, magnetic, worldNav } from '../../src/core/ui.js';
import { PlanarReflection } from '../../src/core/reflector.js';
import { Effect, EffectPass } from 'postprocessing';
import { fbmTexture } from '../../src/core/textures.js';
import { HangarVolumetric } from './volumetric.js';
import { buildHangar, BAYS_Z } from './world.js';
import { mechUniforms, patchMech, scanSheet, Steam, Sparks, BeamDust } from './fx.js';
import { Sound } from './audio.js';

const DBG = new URLSearchParams(location.search);
const D = Math.PI / 180;
const MECH_H = 11.4;
const HOLD_TIME = 1.9;
const body = document.body;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ─── Engine ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gl');
// If the GPU drops the context (driver reset, tab starved), ask for it back and restart cleanly.
canvas.addEventListener('webglcontextlost', e => e.preventDefault());
canvas.addEventListener('webglcontextrestored', () => location.reload());
let vol;
const engine = new Engine({
  canvas, fov: 38, near: 0.15, far: 300, dpr: 1.5, background: 0x040506,
  post: {
    ao: { aoRadius: 1.6, intensity: 2.4, distanceFalloff: 1.2 },
    bloom: { intensity: 0.95, luminanceThreshold: 0.62, luminanceSmoothing: 0.32, radius: 0.84 },
    pre: cam => [(vol = new HangarVolumetric(cam, { density: 0.022, noise: 0.92, noiseScale: 0.19, maxDist: 75, floorY: 0, hazeTop: 30, phase: 0.7 }))],
    tone: DBG.get('tone') || 'aces',
    vignette: { offset: 0.18, darkness: 0.86 },
    noise: 0.075,
    ca: false,
  },
});
const { scene, camera, renderer } = engine;
// Clamp + NaN guard before bloom: 4000 cd floods on near-mirror metal can overflow half-float specular,
// and one Inf pixel smeared by the bloom mip chain blacks out the whole frame.
{
  const clampFx = new Effect('HN9Clamp', `void mainImage(const in vec4 c, const in vec2 uv, out vec4 o){ vec3 v = c.rgb; if (any(isnan(v)) || any(isinf(v))) v = vec3(0.0); o = vec4(min(max(v, vec3(0.0)), vec3(64.0)), c.a); }`);
  const { composer } = engine.post;
  composer.addPass(new EffectPass(camera, clampFx), engine.post.ao ? 2 : 1);
}
// Hold distortion: radial RGB split + zoom streaks that build with the charge and spike at ignition.
const surgeFx = new Effect('HN9Surge', `
  uniform float uAmt;
  void mainImage(const in vec4 c, const in vec2 uv, out vec4 o){
    vec2 d = uv - 0.5; float r = length(d);
    vec2 off = d * r * (0.004 + uAmt * 0.03);
    vec3 col = vec3(texture2D(inputBuffer, uv + off).r, c.g, texture2D(inputBuffer, uv - off).b);
    if (uAmt > 0.02) {
      vec3 acc = col; float w = 1.0;
      for (int i = 1; i < 7; i++) { float k = float(i) / 6.0; vec2 q = uv - d * k * 0.07 * uAmt; acc += texture2D(inputBuffer, q).rgb * (1.0 - k * 0.6); w += 1.0 - k * 0.6; }
      col = mix(col, acc / w, clamp(uAmt * 1.4, 0.0, 0.85));
    }
    o = vec4(col, c.a);
  }`, { uniforms: new Map([['uAmt', new THREE.Uniform(0)]]) });
engine.post.composer.addPass(new EffectPass(camera, surgeFx));
scene.fog = new THREE.FogExp2(0x06080b, 0.0105);

const envLive = studioEnvironment(renderer, {
  top: 0x262b33, bottom: 0x08090b, blur: 0.05, panels: [
    { pos: [0, 9, 0], size: [2.2, 16], intensity: 5, color: 0xf0f3ff },
    { pos: [-6, 9, 0], size: [1.6, 16], intensity: 3.2, color: 0xf0f3ff },
    { pos: [6, 9, 0], size: [1.6, 16], intensity: 3.2, color: 0xf0f3ff },
    { pos: [0, 2.5, 10], size: [9, 4], intensity: 1.1, color: 0xffd6a8 },
    { pos: [-10, 3, -3], size: [3, 6], intensity: 0.9, color: 0xa8c8ff },
  ],
});
const envCold = studioEnvironment(renderer, {
  top: 0x0a0b0e, bottom: 0x020203, blur: 0.05, panels: [
    { pos: [-7, 4, -5], size: [1.5, 3], intensity: 2.2, color: 0xff1a0a },
    { pos: [7, 4, -5], size: [1.5, 3], intensity: 2.2, color: 0xff1a0a },
    { pos: [0, 9, 0], size: [12, 1.5], intensity: 0.5, color: 0x5a78a8 },
  ],
});
scene.environment = envCold;
scene.environmentIntensity = 0.12;
const hemi = new THREE.HemisphereLight(0x7088aa, 0x0c0a09, 0.02);
scene.add(hemi);

const assets = new Assets();
const pointer = new Pointer({ lambda: 5 });
const sound = new Sound();

// ─── Loader ────────────────────────────────────────────────────────────────────
const loaderEl = document.querySelector('.loader');
const ldLog = [...loaderEl.querySelectorAll('.ld-log li')];
const loader = preloader({
  assets, el: loaderEl, minTime: 1600,
  onValue: v => {
    loaderEl.querySelector('.ld-pct').textContent = String(Math.round(v * 100)).padStart(3, '0');
    loaderEl.style.setProperty('--p', v.toFixed(3));
    for (const li of ldLog) li.classList.toggle('on', v >= +li.dataset.at - 1e-3);
  },
  exit: async () => {
    const tl = gsap.timeline();
    tl.to('.ld-in', { opacity: 0, duration: 0.3 })
      .to('.ld-bar', { opacity: 0, duration: 0.2 }, 0.2)
      .to('.ld-top', { yPercent: -101, duration: 1.1, ease: 'power4.inOut' }, 0.25)
      .to('.ld-bot', { yPercent: 101, duration: 1.1, ease: 'power4.inOut' }, 0.25);
    await tl;
  },
});

// ─── World ────────────────────────────────────────────────────────────────────
const reflection = new PlanarReflection(renderer, { resolution: 0.5 });
engine.onResize((w, h, dpr) => reflection.setSize(w, h, dpr));
const mechP = assets.gltf('models/hangar/mech.glb');
const droneP = assets.gltf('models/hangar/drone.glb');
await Promise.race([
  Promise.all(['700 100px "Chakra Petch"', '600 100px "Chakra Petch"'].map(f => document.fonts.load(f))),
  new Promise(r => setTimeout(r, 2500)),
]);
const W = buildHangar({ scene, renderer, reflection, maxAniso: renderer.capabilities.getMaxAnisotropy() });

// Volumetric registrations
const floodVol = W.floods.map((f, i) => vol.add(f.light, { scale: i < 2 ? 0.0019 : 0.0003, range: 0.009, softness: 0.3 }));
const beaconVol = W.beacons.map(b => vol.add(b.light, { scale: 0.006, range: 0.01, softness: 0.5 }));

// Scene lights beyond the fixtures
const strobe = new THREE.PointLight(0xff2210, 0, 34, 2);
strobe.position.set(0, 9.5, -8.5);
scene.add(strobe);
const visorLight = new THREE.PointLight(0xff7a20, 0, 9, 2);
scene.add(visorLight);
const weldLight = new THREE.PointLight(0xa8d8ff, 0, 14, 2);
scene.add(weldLight);
const droneSpot = new THREE.SpotLight(0xe6f4ff, 0, 45, 0.15, 0.55, 2);
scene.add(droneSpot, droneSpot.target);
const droneVol = vol.add(droneSpot, { scale: 0.0055, range: 0.014, softness: 0.45 });
const dawn = new THREE.SpotLight(0xffa860, 0, 0, 0.36, 0.7, 2);
dawn.position.set(0, 17, 100);
dawn.target.position.set(0, 0, -6);
dawn.castShadow = true;
dawn.shadow.mapSize.set(2048, 2048);
dawn.shadow.camera.near = 50; dawn.shadow.camera.far = 150;
dawn.shadow.bias = -0.0002; dawn.shadow.normalBias = 0.05;
dawn.shadow.autoUpdate = false;
dawn.shadow.needsUpdate = true;
scene.add(dawn, dawn.target);
const dawnVol = vol.add(dawn, { scale: 0.000006, range: 0.00004, softness: 0.6 });
// Cold moonlight through the clerestory: the only non-red light before power-up.
const moon = new THREE.SpotLight(0x7f9cd8, 0, 0, 0.1, 0.6, 2);
moon.position.set(-29, 23, -16);
moon.target.position.set(1.5, 4, -1.5);
scene.add(moon, moon.target);
const moonVol = vol.add(moon, { scale: 0.0045, range: 0.0006, softness: 0.6 });

// FX
const MU = mechUniforms();
const sheet = scanSheet();
scene.add(sheet);
const steamNoise = fbmTexture(renderer, { size: 256, scale: 4, octaves: 5, contrast: 1.4, bias: 0.5 });
const steam = new Steam(steamNoise);
scene.add(steam.mesh);
const sparks = new Sparks();
scene.add(sparks.mesh);
const dust = new BeamDust(DBG.has('nodust') ? 10 : 9000);
scene.add(dust.points);
engine.onResize((w, h, dpr) => { dust.mat.uniforms.uDpr.value = dpr; sparks.mat.uniforms.uRes.value.set(w, h); });
// Weld glow billboard
const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.12, 'rgba(200,235,255,.9)'); grd.addColorStop(0.35, 'rgba(90,170,255,.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const weldGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(0, 0, 0), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
weldGlow.scale.setScalar(1.6);
scene.add(weldGlow);
const visorGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(0, 0, 0), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, fog: false }));
visorGlow.scale.set(2.8, 1.2, 1);
scene.add(visorGlow);

// ─── Mech + drone ───────────────────────────────────────────────────────────────
const mechGroup = new THREE.Group();
scene.add(mechGroup);
const A = {}; // anchors
let mechMesh = null;

function probeSetup(mesh) {
  mesh.updateMatrixWorld(true);
  const p = mesh.geometry.attributes.position;
  const out = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
  return out;
}
/** First surface point along a thick ray (vertex based — fast on 250k verts, good enough for anchors). */
function probe(P, o, dir, r = 0.25) {
  let best = Infinity, bi = -1;
  const r2 = r * r;
  for (let i = 0; i < P.length; i += 3) {
    const dx = P[i] - o.x, dy = P[i + 1] - o.y, dz = P[i + 2] - o.z;
    const t = dx * dir.x + dy * dir.y + dz * dir.z;
    if (t < 0 || t > best) continue;
    const px = dx - dir.x * t, py = dy - dir.y * t, pz = dz - dir.z * t;
    if (px * px + py * py + pz * pz < r2) { best = t; bi = i; }
  }
  return bi < 0 ? null : new THREE.Vector3(P[bi], P[bi + 1], P[bi + 2]);
}

const mechLoad = mechP.then(g => {
  const m = g.scene;
  normalize(m, MECH_H, { axis: 'y' });
  prepModel(m, renderer, { env: 1.0, onMat: mat => { patchMech(mat, MU); } });
  mechGroup.add(m);
  mechGroup.updateMatrixWorld(true);
  mechMesh = firstMesh(m);
  const P = probeSetup(mechMesh);
  let crown = 0;
  for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i]) < 0.45 && P[i + 1] > crown) crown = P[i + 1];
  A.crown = crown;
  const fwd = new THREE.Vector3(0, 0, -1);
  A.visor = probe(P, new THREE.Vector3(0, crown - 0.62, 40), fwd, 0.22) ?? new THREE.Vector3(0, crown - 0.6, 1);
  A.reactor = probe(P, new THREE.Vector3(0, MECH_H * 0.71, 40), fwd, 0.3) ?? new THREE.Vector3(0, 8, 1.5);
  A.knee = probe(P, new THREE.Vector3(1.7, MECH_H * 0.31, 40), fwd, 0.35) ?? new THREE.Vector3(1.7, 3.5, 1);
  A.shoulder = probe(P, new THREE.Vector3(40, MECH_H * 0.78, 0.2), new THREE.Vector3(-1, 0, 0), 0.4) ?? new THREE.Vector3(3.8, 8.9, 0);
  {
    // shoulder rotary: centroid of everything high on the -x side
    const c = new THREE.Vector3(); let n = 0;
    for (let i = 0; i < P.length; i += 3) if (P[i + 1] > MECH_H * 0.86 && P[i] < -1.3) { c.x += P[i]; c.y += P[i + 1]; c.z += P[i + 2]; n++; }
    A.gun = n ? c.multiplyScalar(1 / n) : new THREE.Vector3(-2.6, 10.5, 0.8);
    A.gun.y += 0.35;
  }
  A.weld = probe(P, new THREE.Vector3(40, MECH_H * 0.71, -1.6), new THREE.Vector3(-1, 0, 0), 0.3) ?? new THREE.Vector3(3.6, 8.1, -1.6);
  A.normals = { reactor: new THREE.Vector3(0, 0, 1), knee: new THREE.Vector3(0.3, 0, 1).normalize(), shoulder: new THREE.Vector3(1, 0.1, 0).normalize(), gun: new THREE.Vector3(0, 1, 0.2).normalize() };
  MU.uVisorPos.value.copy(A.visor).add(new THREE.Vector3(0, 0, -0.25));
  visorLight.position.copy(A.visor).add(new THREE.Vector3(0, -0.4, 1.4));
  visorGlow.position.copy(A.visor).add(new THREE.Vector3(0, 0, 0.15));
  if (DBG.has('anchors')) console.warn('anchors', ['shoulder', 'gun', 'weld'].map(k => k + ':' + A[k].toArray().map(v => v.toFixed(2)).join(',')).join(' '));
  buildArm(A.weld);
});

let drone = null;
const droneGroup = new THREE.Group();
scene.add(droneGroup);
const droneLoad = droneP.then(g => {
  const m = g.scene;
  normalize(m, 1.7, { axis: 'max' });
  prepModel(m, renderer, { env: 1.2 });
  // centre vertically so it pivots about its body
  m.position.y -= 0.35;
  droneGroup.add(m);
  // nav lights
  for (const [x, c] of [[-0.8, 0xff2a14], [0.8, 0x2aff6a]]) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(6) }));
    s.position.set(x, -0.05, 0.1); droneGroup.add(s);
  }
  drone = m;
});

// Welding arm on the right tower reaching the mech's shoulder.
let weldTip = new THREE.Vector3();
const armMat = new THREE.MeshStandardMaterial({ color: 0xa87406, metalness: 0.4, roughness: 0.55 });
const armDark = new THREE.MeshStandardMaterial({ color: 0x1c1f23, metalness: 0.7, roughness: 0.5 });
const steelArm = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 1, roughness: 0.22 });
function buildArm(tip) {
  const base = new THREE.Vector3(W.T.xin + 0.2, W.levels[1] + 0.1, -4.4);
  const t = tip.clone().add(new THREE.Vector3(0.55, 0.15, 0));
  weldTip = tip.clone().add(new THREE.Vector3(0.06, 0, 0));
  const shoulder = base.clone().add(new THREE.Vector3(0, 1.1, 0));
  // two-bone IK: elbow up and back
  const L1 = 2.3, L2 = 2.1;
  const d = t.clone().sub(shoulder); const dl = Math.min(d.length(), L1 + L2 - 0.01);
  const a = (L1 * L1 - L2 * L2 + dl * dl) / (2 * dl);
  const h = Math.sqrt(Math.max(L1 * L1 - a * a, 0));
  const dn = d.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(dn, -dn.y).normalize();
  const elbow = shoulder.clone().addScaledVector(dn, a).addScaledVector(up, h);
  const seg = (p0, p1, r, mat, round = true) => {
    const len = p0.distanceTo(p1);
    const g = round ? new THREE.CylinderGeometry(r * 0.5, r * 0.5, len, 18) : new THREE.BoxGeometry(r, len, r);
    const m = new THREE.Mesh(g, mat);
    m.position.copy(p0).add(p1).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const joint = (p, r, axis) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * 1.5, 24), armDark);
    m.position.copy(p);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    m.castShadow = true; scene.add(m);
  };
  const side = new THREE.Vector3().subVectors(t, shoulder).cross(new THREE.Vector3(0, 1, 0)).normalize();
  seg(base, shoulder, 0.62, armDark);
  joint(shoulder, 0.36, side);
  seg(shoulder, elbow, 0.46, armMat);
  // hydraulic ram along the upper arm
  seg(shoulder.clone().addScaledVector(up, 0.32).lerp(elbow, 0.08), elbow.clone().addScaledVector(up, 0.3).lerp(shoulder, 0.25), 0.12, steelArm);
  joint(elbow, 0.3, side);
  seg(elbow, t, 0.34, armMat);
  joint(t, 0.2, side);
  const nozzle = seg(t, weldTip, 0.12, armDark);
  const baseBox = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.35, 24), armDark);
  baseBox.position.copy(base); baseBox.castShadow = true; scene.add(baseBox);
  weldGlow.position.copy(weldTip);
  weldLight.position.copy(weldTip).add(new THREE.Vector3(0.4, 0, 0));
}

// ─── Page state ────────────────────────────────────────────────────────────────
const S = {
  surge: 0, charge: 0, holding: false, powered: false, live: 0, env: 0, beacon: 1,
  scanY: -10, band: 0, holo: 0, visor: 0.06, drone: 0, weld: 0, shake: 0, door: 0, wave: 0, waveR: 0, settle: 0,
};

// ─── Camera shots ──────────────────────────────────────────────────────────────
// az: degrees around the mech (0 = in front), side: look offset along camera-right (positive puts the mech left of centre)
const SHOTS = {
  hero: { az: -12, r: 25, y: 1.4, ly: 6.4, side: -7.2, fov: 38, mob: { rk: 1.1, ly: -3.6 } },
  heroLive: { az: -16, r: 25.5, y: 1.8, ly: 7.2, side: -7.0, fov: 40, mob: { rk: 1.12, ly: -3.8 } },
  power: { az: 36, r: 27, y: 6.2, ly: 8.8, side: 5.4, fov: 40, mob: { rk: 1.2 } },
  reactor: { az: 12, r: 14, y: 7.8, ly: 8.0, side: -3.4, fov: 36 },
  actuators: { az: 46, r: 17, y: 1.2, ly: 4.4, side: 4.4, fov: 42 },
  armour: { az: 76, r: 13.5, y: 12.2, ly: 8.9, side: -3.3, fov: 38 },
  weapons: { az: -80, r: 13.5, y: 13.2, ly: 10.2, side: 3.3, fov: 38 },
  stats: { az: -24, r: 11.5, y: 0.45, ly: 6.2, side: -4.3, fov: 52 },
  program: { az: 24, r: 11.5, y: 11.4, ly: 9.8, side: -4.0, fov: 40 },
  apply: { az: 172, r: 30, y: 1.3, ly: 6, side: 0, fov: 40, look: [3.5, 8, 36], mob: { rk: 1, look: [1.5, 3.5, 36] } },
};
const sections = [...document.querySelectorAll('.sec')];
const shotList = sections.map(s => s.dataset.shot);
let holds = [];
function measure() {
  const vh = innerHeight;
  holds = sections.map(s => { const r = s.getBoundingClientRect(); const top = r.top + scrollY; return top + (r.height - vh) / 2; });
}
measure();
addEventListener('resize', measure);
function scrollU() {
  const y = scrollY;
  if (y <= holds[0]) return 0;
  for (let i = 0; i < holds.length - 1; i++) if (y < holds[i + 1]) return i + (y - holds[i]) / (holds[i + 1] - holds[i]);
  return holds.length - 1 + Math.min(1, (y - holds[holds.length - 1]) / innerHeight);
}

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
function shotState(s, out) {
  const portrait = camera.aspect < 0.85;
  const pm = portrait ? (s.mob ?? {}) : {};
  const az = (pm.az ?? s.az) * D, r = s.r * (portrait ? (pm.rk ?? 1.5) : 1);
  const y = s.y + (portrait ? (pm.dy ?? 0) : 0);
  out.pos.set(Math.sin(az) * r, y, Math.cos(az) * r);
  const right = tmpC.set(Math.cos(az), 0, -Math.sin(az));
  if (s.look && !pm.look) out.look.set(...s.look);
  else if (pm.look) out.look.set(...pm.look);
  // portrait: the copy sits in the lower half, so aim low and let the mech ride up the frame
  else out.look.set(0, s.ly + (portrait ? (pm.ly ?? -3.2) : 0), 0).addScaledVector(right, portrait ? s.side * 0.1 : s.side);
  out.fov = s.fov + (portrait ? 8 : 0);
  out.az = portrait ? (pm.az ?? s.az) : s.az; out.r = r; out.y = y;
  return out;
}
const mk = () => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 38, az: 0, r: 10, y: 1 });
const sA = mk(), sB = mk(), sH = mk(), sHL = mk();
const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 38 };
function blendShots(u, out) {
  const n = shotList.length - 1;
  const i = Math.min(n - 1, Math.max(0, Math.floor(u)));
  const f = smooth(0.12, 0.88, clamp(u - i));
  const getShot = (k, o) => {
    if (shotList[k] === 'hero') {
      shotState(SHOTS.hero, sH); shotState(SHOTS.heroLive, sHL);
      const L = S.live;
      o.az = lerp(sH.az, sHL.az, L); o.r = lerp(sH.r, sHL.r, L) - S.charge * 1.6; o.y = lerp(sH.y, sHL.y, L);
      o.look.lerpVectors(sH.look, sHL.look, L); o.fov = lerp(sH.fov, sHL.fov, L);
      return o;
    }
    return shotState(SHOTS[shotList[k]], o);
  };
  getShot(i, sA); getShot(i + 1, sB);
  let dAz = ((sB.az - sA.az + 540) % 360) - 180;
  const az = (sA.az + dAz * f) * D;
  const r = lerp(sA.r, sB.r, f) + Math.sin(f * Math.PI) * 2.5; // swing wide between stops
  const y = lerp(sA.y, sB.y, f) + Math.sin(f * Math.PI) * 0.8;
  out.pos.set(Math.sin(az) * r, y, Math.cos(az) * r);
  out.look.lerpVectors(sA.look, sB.look, f);
  out.fov = lerp(sA.fov, sB.fov, f);
}

// ─── Hotspots, reticle, ruler ─────────────────────────────────────────────────────
const SPOTS = [
  { key: 'reactor', label: '01 Reactor' },
  { key: 'knee', label: '02 Actuators' },
  { key: 'shoulder', label: '03 Armour' },
  { key: 'gun', label: '04 Hardpoints' },
];
const spotsEl = document.querySelector('.spots');
const specSecs = [...document.querySelectorAll('.sec.spec')];
for (const [i, s] of SPOTS.entries()) {
  const el = document.createElement('button');
  el.className = 'spot'; el.type = 'button';
  el.innerHTML = `<span>${s.label}</span>`;
  el.setAttribute('aria-label', s.label);
  el.addEventListener('click', () => { const sec = specSecs[i]; const y = sec.getBoundingClientRect().top + scrollY + (sec.offsetHeight - innerHeight) / 2; window.__lenis?.scrollTo(y, { duration: 1.6 }); });
  spotsEl.appendChild(el);
  s.el = el;
}
const leader = document.querySelector('.leader');
const leaderLine = leader.querySelector('line'), leaderDot = leader.querySelector('circle');
const reticle = document.querySelector('.hud-reticle');
const hudEl = document.querySelector('.hud');
const rulerEl = document.querySelector('.ruler');
function project(v, out) {
  tmpA.copy(v).project(camera);
  out.x = (tmpA.x + 1) / 2 * innerWidth; out.y = (1 - tmpA.y) / 2 * innerHeight; out.vis = tmpA.z < 1 && Math.abs(tmpA.x) < 1.1 && Math.abs(tmpA.y) < 1.1;
  return out;
}
const sp = { x: 0, y: 0, vis: false }, sp2 = { x: 0, y: 0, vis: false };

// ─── HUD boot ─────────────────────────────────────────────────────────────────
const bootEl = document.querySelector('.hud-boot');
const rd = { rctr: document.querySelector('.rd-rctr'), core: document.querySelector('.rd-core'), hyd: document.querySelector('.rd-hyd'), sync: document.querySelector('.rd-sync') };
const readout = { rctr: 0.3, core: 31, hyd: 0, sync: 0 };
function renderReadout() {
  rd.rctr.textContent = readout.rctr.toFixed(1) + '%';
  rd.core.textContent = Math.round(readout.core) + '°C';
  rd.hyd.textContent = Math.round(readout.hyd) + ' bar';
  rd.sync.textContent = readout.sync > 0.5 ? readout.sync.toFixed(1) + '%' : '—';
  const bars = document.querySelectorAll('.rd em');
  bars[0].style.setProperty('--v', (readout.rctr / 100).toFixed(3));
  bars[1].style.setProperty('--v', (readout.core / 700).toFixed(3));
  bars[2].style.setProperty('--v', (readout.hyd / 340).toFixed(3));
  bars[3].style.setProperty('--v', (readout.sync / 100).toFixed(3));
}
function bootLine(text, dim = false) {
  const li = document.createElement('li');
  li.textContent = text; if (dim) li.className = 'dim';
  bootEl.appendChild(li);
  while (bootEl.children.length > 7) bootEl.firstElementChild.remove();
}
const stateEl = document.querySelector('.hud-state');

// ─── Power-up ─────────────────────────────────────────────────────────────────
const flashEl = document.querySelector('.flash');
function kick(a = 1) { S.shake = Math.max(S.shake, a); }
function flicker(obj, key, to, { dur = 0.5, onUpdate } = {}) {
  const tl = gsap.timeline({ onUpdate });
  tl.to(obj, { [key]: to * 0.9, duration: 0.03 })
    .to(obj, { [key]: to * 0.08, duration: 0.05 })
    .to(obj, { [key]: to * 0.7, duration: 0.03, delay: 0.05 })
    .to(obj, { [key]: to * 0.25, duration: 0.05 })
    .to(obj, { [key]: to, duration: dur * 0.4, ease: 'power2.out', delay: 0.04 });
  return tl;
}
function bayOn(i) {
  const b = { v: 0 };
  flicker(b, 'v', 1, { onUpdate: () => W.setBay(i, b.v) });
  sound.clank(0.55);
  kick(0.25);
}
function floodOn(i) {
  const f = W.floods[i];
  if (f.light.castShadow) { f.light.shadow.autoUpdate = true; f.light.shadow.needsUpdate = true; }
  flicker(f, 'on', 1, { dur: 0.9 });
  sound.clank(1);
  kick(0.7);
}
function steamBurst(big = true) {
  const t = engine.time;
  const up = new THREE.Vector3(0, 1, 0);
  for (const v of W.vents) steam.burst(v, up, big ? 26 : 8, t, { speed: big ? 9 : 5, spread: 0.18, life: big ? 4.2 : 3, size: big ? 1.6 : 1.1 });
  if (A.crown) {
    for (const s of [-1, 1]) {
      steam.burst(new THREE.Vector3(s * 1.9, MECH_H * 0.78, -2.0), new THREE.Vector3(s * 0.6, 0.6, -1).normalize(), big ? 22 : 6, t, { speed: big ? 7 : 4, spread: 0.25, life: 3.4, size: 1.2 });
      steam.burst(new THREE.Vector3(s * 1.5, MECH_H * 0.26, -0.8), new THREE.Vector3(s, 0.2, -0.5).normalize(), big ? 14 : 4, t + 0.15, { speed: big ? 6 : 3, spread: 0.3, life: 2.8, size: 0.9 });
    }
  }
  sound.hiss(big ? 2.6 : 1.4, big ? 1 : 0.5);
}

function powerUp({ instant = false } = {}) {
  if (S.powered) return;
  S.powered = true;
  S.holding = false;
  body.classList.remove('is-cold', 'is-holding');
  body.classList.add('is-booting');
  stateEl.textContent = 'Power transfer';
  if (instant) {
    S.charge = 0; S.beacon = 0; S.env = 1; S.live = 1; S.visor = 1; S.drone = 1; S.weld = 1; S.holo = 0; S.band = 0; S.scanY = 20;
    BAYS_Z.forEach((z, i) => W.setBay(i, 1));
    W.floods.forEach(f => { f.on = 1; if (f.light.castShadow) f.light.shadow.autoUpdate = true; });
    finishBoot(true);
    return;
  }
  sound.drop();
  const tl = gsap.timeline();
  tl.to(S, { beacon: 0, duration: 0.18, ease: 'power2.in' }, 0)
    .to(S, { charge: 0, duration: 0.5, ease: 'power2.in' }, 0)
    .call(() => { kick(1.1); gsap.fromTo(flashEl, { opacity: 0.35 }, { opacity: 0, duration: 0.6, ease: 'expo.out' }); gsap.fromTo(S, { surge: 1 }, { surge: 0, duration: 1.1, ease: 'expo.out' }); }, null, 0.02)
    .fromTo(S, { waveR: 0, wave: 1.6 }, { waveR: 34, wave: 0, duration: 1.8, ease: 'power2.out' }, 0.05);
  BAYS_Z.forEach((z, i) => tl.call(() => bayOn(i), null, 0.45 + i * 0.19));
  tl.call(() => { bootLine('Power transfer ··· OK'); stateEl.textContent = 'Lighting'; }, null, 0.5);
  tl.call(() => floodOn(0), null, 0.95).call(() => floodOn(1), null, 1.12).call(() => floodOn(2), null, 1.78).call(() => floodOn(3), null, 1.95);
  tl.call(() => bootLine('Bay lighting ··· 8/8'), null, 2.0);
  tl.to(S, { env: 1, duration: 2.4, ease: 'power2.inOut' }, 0.7);
  tl.to(S, { live: 1, duration: 6.4, ease: 'power2.inOut' }, 0.8);
  tl.to(readout, { rctr: 100, core: 612, duration: 3.2, ease: 'power2.out', onUpdate: renderReadout }, 0.6);
  tl.call(() => { steamBurst(true); kick(0.5); }, null, 2.25);
  tl.call(() => bootLine('Reactor ··· 42.0 MW'), null, 2.4);
  // the scan
  tl.call(() => { sound.scan(); stateEl.textContent = 'Diagnostic scan'; gsap.fromTo('.hud-scan', { top: 0, opacity: 1 }, { top: '100%', opacity: 0.2, duration: 1.6, ease: 'power1.inOut', onComplete: () => gsap.set('.hud-scan', { opacity: 0 }) }); body.classList.add('is-scan'); }, null, 2.6);
  tl.set(S, { scanY: -0.3, band: 1, holo: 1 }, 2.6)
    .to(S, { scanY: MECH_H + 0.8, duration: 2.7, ease: 'power1.inOut' }, 2.6)
    .to(readout, { hyd: 310, duration: 2.2, ease: 'power2.out', onUpdate: renderReadout }, 2.8)
    .call(() => bootLine('Actuator bus ··· 41/41'), null, 3.3)
    .call(() => bootLine('Armour integrity ··· 212/212'), null, 3.9)
    .call(() => bootLine('Gyro sync ··· locked'), null, 4.5)
    .to(S, { band: 0, duration: 0.5 }, 5.2)
    .to(S, { holo: 0.0, duration: 3.2, ease: 'power2.out' }, 5.6);
  // visor + settle
  tl.call(() => {
    flicker(S, 'visor', 1, { dur: 0.8 });
    sound.online();
    kick(0.9);
    gsap.fromTo(S, { settle: 0 }, { settle: 1, duration: 1.4, ease: 'power2.out' });
    bootLine('Optics ··· online');
  }, null, 5.35);
  tl.to(readout, { sync: 99.2, duration: 1.4, ease: 'power2.out', onUpdate: renderReadout }, 5.4);
  tl.call(() => finishBoot(false), null, 5.8);
  tl.to(S, { drone: 1, duration: 3.4, ease: 'power2.inOut' }, 6.0);
  tl.set(S, { weld: 1 }, 6.8);
}
function finishBoot(instant) {
  body.classList.remove('is-booting', 'is-scan');
  body.classList.add('is-live');
  stateEl.textContent = 'Online · pilot seat vacant';
  if (instant) { Object.assign(readout, { rctr: 100, core: 612, hyd: 310, sync: 99.2 }); }
  renderReadout();
  bootLine('Pilot seat ··· vacant', true);
  reticle.classList.add('lock');
  document.querySelector('.g-label').innerHTML = 'Online';
  document.querySelector('.g-pct').textContent = '100';
  document.querySelector('.ignite-title').textContent = 'Warden online';
  document.querySelector('.ignite-hint').textContent = 'Forty-one actuators, one empty seat. Scroll to walk around it.';
}

// ─── Hold input ─────────────────────────────────────────────────────────────────
const gaugeEl = document.querySelector('.gauge');
const gPct = document.querySelector('.g-pct');
const holdEl = document.querySelector('.hold');
const heroSec = document.querySelector('.sec.hero');
let heroU = 0;
const canHold = () => !S.powered && heroU < 0.6;
function startHold(e) {
  if (!canHold()) return;
  sound.on && sound._init();
  S.holding = true;
  body.classList.add('is-holding');
}
function endHold() { S.holding = false; body.classList.remove('is-holding'); }
addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  if (e.target.closest('a, .nav, .snd, .tw-nav, .card, .quote, .spot')) return;
  startHold(e);
});
gaugeEl.addEventListener('pointerdown', e => { e.preventDefault(); startHold(e); });
addEventListener('pointerup', endHold);
addEventListener('pointercancel', endHold);
addEventListener('blur', endHold);
addEventListener('contextmenu', e => { if (!S.powered) e.preventDefault(); });
addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.repeat || !canHold()) return;
  e.preventDefault(); startHold(e);
});
addEventListener('keyup', e => { if (e.code === 'Space') endHold(); });
gaugeEl.addEventListener('keydown', e => { if (e.key === 'Enter' && canHold()) { e.preventDefault(); powerUp(); } });

// Sound toggle
const sndBtn = document.querySelector('.snd');
sndBtn.addEventListener('click', () => {
  const on = sound.toggle();
  sndBtn.setAttribute('aria-pressed', String(on));
  sndBtn.querySelector('.snd-state').textContent = on ? 'On' : 'Off';
  if (on && S.powered) sound.online();
});

// ─── Reveal helpers ─────────────────────────────────────────────────────────────
for (const s of sections) {
  if (s.classList.contains('hero')) continue;
  const items = s.querySelectorAll('.kicker, h2, h3, .body, .steps li, .data, .figs li, .timeline li, .req, .quote, .cta-row, .cta-meta');
  items.forEach((el, i) => { el.classList.add('rv'); el.style.setProperty('--i', i); });
}
const statsSec = document.querySelector('.sec.stats');
let counted = false;
function countUp() {
  counted = true;
  statsSec.querySelectorAll('[data-count]').forEach((el, i) => {
    const o = { v: 0 }, to = +el.dataset.count, dec = +el.dataset.dec;
    gsap.to(o, { v: to, duration: 1.8, delay: 0.15 + i * 0.12, ease: 'expo.out', onUpdate: () => { el.textContent = o.v.toFixed(dec); } });
  });
}
const SCRIM = { hero: [1, 0, 0.3], power: [0, 1, 0], reactor: [1, 0, 0], actuators: [0, 1, 0], armour: [1, 0, 0], weapons: [0, 1, 0], stats: [1, 0, 0], program: [1, 0.6, 0.2], apply: [0.7, 0, 1] };
const rootStyle = document.documentElement.style;

// ─── Frame loop ────────────────────────────────────────────────────────────────
let u = 0, lastMove = -10, weldOn = false, weldNext = 0, puffNext = 8, clockT = 0;
pointer.on('move', () => { lastMove = engine.time; });
const footEl = document.querySelector('.foot');
const navEl = document.querySelector('.nav');
const clockEl = document.querySelector('.hud-clock');
const baseSec = 7 * 60 + 3 * 3600 + 12 * 60;
const droneTarget = new THREE.Vector3(), droneAim = new THREE.Vector3(0, 6, 0);
const ray = new THREE.Raycaster();
const aimPlane = new THREE.Plane();
const parked = new THREE.Vector3(3.2, 12.9, -6.85);

engine.onTick((dt, t) => {
  pointer.update(dt);
  MU.uTime.value = t;

  // hold / charge
  if (!S.powered) {
    if (S.holding) S.charge = Math.min(1, S.charge + dt / HOLD_TIME);
    else S.charge = Math.max(0, S.charge - dt * 1.1);
    if (S.charge >= 1) powerUp();
  }
  const c = S.charge;
  sound.charge(S.powered ? 0 : c);
  rootStyle.setProperty('--c', c.toFixed(3));
  surgeFx.uniforms.get('uAmt').value = (reduced ? 0.3 : 1) * Math.max(S.surge, c * c * 0.55);
  if (!S.powered) {
    gPct.textContent = String(Math.round(c * 100)).padStart(2, '0');
    stateEl.textContent = c > 0.01 ? `Ignition ${Math.round(c * 100)}%` : 'Reactor cold';
    readout.rctr = 0.3 + c * 11; readout.core = 31 + c * 90; renderReadout();
  }

  // scroll → camera
  const target = scrollU();
  u = damp(u, target, 4.2, dt);
  heroU = u;
  if (!S.powered && target > 0.45) powerUp();
  blendShots(u, cam);
  // shake: heavy, low frequency
  S.shake = damp(S.shake, 0, 3.2, dt);
  const sh = (S.shake * 0.12 + c * c * 0.05) * (reduced ? 0.2 : 1);
  const sx = (Math.sin(t * 23.1) + Math.sin(t * 37.7) * 0.6) * sh, sy = (Math.sin(t * 29.3 + 1) + Math.sin(t * 41.9) * 0.5) * sh;
  const right = tmpB.subVectors(cam.look, cam.pos).cross(camera.up).normalize();
  camera.position.copy(cam.pos).addScaledVector(right, pointer.sx * 0.45 + sx).add(tmpC.set(0, pointer.sy * 0.25 + sy + Math.sin(t * 0.5) * 0.04, 0));
  camera.lookAt(cam.look.x + sx * 0.5, cam.look.y + sy * 0.5, cam.look.z);
  if (DBG.has('cam')) { const v = DBG.get('cam').split(',').map(Number); camera.position.set(v[0], v[1], v[2]); camera.lookAt(v[3], v[4], v[5]); if (v[6]) cam.fov = v[6]; }
  if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }

  // environment and lights
  const live = S.env;
  const door = S.door = DBG.has('door') ? +DBG.get('door') : smooth(7.25, 7.95, u);

  scene.environment = live > 0.02 ? envLive : envCold;
  scene.environmentIntensity = (live > 0.02 ? lerp(0.05, 0.24, live) : 0.1) * (1 - door * 0.55);
  hemi.intensity = lerp(0.015, 0.3, live) * (1 - door * 0.6);
  scene.fog.color.setRGB(lerp(0.005, 0.012, live), lerp(0.006, 0.014, live), lerp(0.008, 0.018, live));
  vol.density = DBG.has('novol') ? 0 : lerp(0.026, 0.016, live);
  if (DBG.has('noao')) engine.post.ao.enabled = false;
  // beacons + strobe
  const spin = t * (1.9 + c * 5);
  for (const b of W.beacons) {
    const a = spin + b.phase;
    tmpA.set(Math.cos(a), -0.55, Math.sin(a)).normalize();
    b.light.target.position.copy(b.pos).addScaledVector(tmpA, 10);
    b.light.intensity = 130 * S.beacon;
    tmpC.subVectors(camera.position, b.pos).setY(0).normalize();
    const facing = Math.pow(Math.max(0, tmpA.x * tmpC.x + tmpA.z * tmpC.z), 10);
    b.cap.material.color.setRGB(1, 0.04, 0.02).multiplyScalar((0.8 + facing * 14) * S.beacon + 0.15);
  }
  moon.intensity = lerp(380, 60, live) * (1 - door);
  const ph = (t * (1 + c * 1.5)) % 1.4;
  const strobeV = (ph < 0.05 ? 1 : 0) + (ph > 0.16 && ph < 0.21 ? 0.8 : 0);
  strobe.intensity = (35 + strobeV * 300) * S.beacon;
  W.redStripMat.color.setRGB(1, 0.05, 0.02).multiplyScalar(0.25 + S.beacon * 1.8 * (0.8 + strobeV * 0.4));
  W.glassMat.color.setRGB(0.05, 0.07, 0.1).multiplyScalar(1 + live * 0.8);
  // floods
  const hazeGrade = lerp(1, 0.62, smooth(0.7, 1.9, u)) - smooth(5.3, 6, u) * 0.24 + smooth(6.2, 7, u) * 0.12;
  for (const [i, f] of W.floods.entries()) {
    floodVol[i].gain = hazeGrade * (i === 1 ? 1 - smooth(0.6, 0, Math.abs(u - 3)) * 0.7 : 1);
    const g = f.on * (1 - door * 0.96);
    f.light.intensity = f.power * g;
    f.lensMat.color.setRGB(1, 0.97, 0.92).multiplyScalar(f.on * 40);
  }
  W.coneMat.uniforms.uTime.value = t;
  // floor wave
  W.floorU.uWave.value.set(S.waveR, S.wave);
  // door + dawn
  for (const d of W.doors) d.position.x = lerp(d.userData.closedX, d.userData.openX, door);
  W.dawnMat.color.setScalar(door * 1.15);
  dawn.intensity = 42000 * door;
  dawn.shadow.autoUpdate = door > 0.001;

  // mech shader state
  MU.uScanY.value = S.scanY;
  MU.uBand.value = S.band;
  MU.uHolo.value = S.holo;
  sheet.position.y = Math.max(0.05, S.scanY);
  sheet.material.uniforms.uAmt.value = S.band;
  sheet.material.uniforms.uTime.value = t;
  let visor = S.visor;
  if (!S.powered) visor = 0.13 + Math.sin(t * 1.1) * 0.05 + (c > 0.2 && Math.random() < c * 0.4 ? Math.random() * c * 0.8 : 0);
  else visor *= 0.92 + Math.sin(t * 2.1) * 0.04 + Math.sin(t * 17) * 0.02;
  MU.uVisor.value = visor;
  visorLight.intensity = visor * 9;
  visorGlow.material.color.setRGB(1, 0.42, 0.1).multiplyScalar(visor * 0.55);
  // hotspot focus: amber reactor glow while charging, cyan system highlight in the spec sections
  const specI = Math.round(u) - 2;
  const specW = 1 - smooth(0.18, 0.45, Math.abs(u - Math.round(u)));
  if (!S.powered || S.live < 0.9) {
    if (A.reactor) MU.uFocus.value.set(A.reactor.x, A.reactor.y, A.reactor.z - 0.8, 1.2 + c * 2.2);
    MU.uFocusCol.value.setRGB(1.0, 0.5, 0.05);
    MU.uFocusAmt.value = c * 1.4;
  } else if (specI >= 0 && specI < 4 && A.crown) {
    const key = SPOTS[specI].key;
    const rad = [2.4, 2.2, 2.4, 2.6][specI];
    MU.uFocus.value.set(A[key].x, A[key].y, A[key].z, rad);
    MU.uFocusCol.value.setRGB(0.28, 0.9, 1.0);
    MU.uFocusAmt.value = damp(MU.uFocusAmt.value, specW * 0.9, 6, dt);
  } else MU.uFocusAmt.value = damp(MU.uFocusAmt.value, 0, 6, dt);
  MU.uXray.value = MU.uFocusAmt.value * 0.4 * (S.powered ? 1 : 0);
  // settle after power: hydraulics take the weight
  mechGroup.position.y = -Math.sin(S.settle * Math.PI) * 0.08 * (1 - S.settle * 0.5);

  // drone
  if (drone) {
    const dT = S.drone;
    const th = t * 0.19 + 1.2;
    const R = 10.5;
    tmpA.set(Math.sin(th) * R, 9.4 + Math.sin(t * 0.47) * 1.3, Math.cos(th) * R);
    const lift = tmpC.copy(parked).lerp(tmpA, smooth(0.25, 1, dT));
    lift.y += Math.sin(clamp(dT) * Math.PI) * 1.6 + (dT > 0 ? Math.sin(t * 2.3) * 0.05 : 0);
    const prev = tmpB.copy(droneGroup.position);
    droneGroup.position.copy(lift);
    const vel = prev.sub(droneGroup.position).negate();
    if (dT > 0.01) {
      if (vel.lengthSq() > 1e-8) {
        const want = Math.atan2(vel.x, vel.z);
        const dy = ((want - droneGroup.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        droneGroup.rotation.y += dy * (1 - Math.exp(-2 * dt));
      }
      droneGroup.rotation.z = damp(droneGroup.rotation.z, clamp(-vel.length() * 3, -0.25, 0.25), 3, dt);
    }
    // searchlight: follows the pointer after power-up, otherwise sweeps the mech
    const user = S.powered && t - lastMove < 3.5 && u < 7 ? 1 : 0;
    aimPlane.setFromNormalAndCoplanarPoint(tmpC.subVectors(camera.position, mechGroup.position).setY(0).normalize(), mechGroup.position);
    ray.setFromCamera({ x: pointer.x, y: pointer.y }, camera);
    if (user && ray.ray.intersectPlane(aimPlane, droneTarget)) {
      droneTarget.y = clamp(droneTarget.y, 0.5, 12); droneTarget.x = clamp(droneTarget.x, -6, 6); droneTarget.z = clamp(droneTarget.z, -6, 6);
    } else droneTarget.set(Math.sin(t * 0.61) * 2.4, 6 + Math.sin(t * 0.37) * 4.2, Math.cos(t * 0.53) * 1.2);
    droneAim.lerp(droneTarget, 1 - Math.exp(-(user ? 6 : 2) * dt));
    droneSpot.position.copy(droneGroup.position).add(tmpA.set(0, -0.35, 0));
    droneSpot.target.position.copy(droneAim);
    droneSpot.intensity = 700 * smooth(0.5, 1, dT);
  }

  // welding
  if (S.weld > 0 && A.crown) {
    if (t > weldNext) { weldOn = !weldOn; weldNext = t + (weldOn ? 2.2 + Math.random() * 3 : 0.4 + Math.random() * 0.9); }
    if (weldOn) {
      const n = Math.random() < 0.5 ? 2 : 5;
      sparks.emit(weldTip, tmpA.set(1, -0.2, 0.3).normalize(), n, t);
      const fl = 0.6 + Math.random() * 0.8;
      weldLight.intensity = 38 * fl;
      weldGlow.material.color.setRGB(0.8, 0.9, 1).multiplyScalar(fl * 1.6);
      weldGlow.scale.setScalar(1.1 + Math.random() * 0.8);
    } else { weldLight.intensity = damp(weldLight.intensity, 0, 20, dt); weldGlow.material.color.multiplyScalar(0.7); }
  }
  // ambient steam puffs once live
  if (S.live > 0.99 && t > puffNext) { puffNext = t + 3.5 + Math.random() * 4; steamBurst(false); }
  steam.mat.uniforms.uLight.value = lerp(0.12, 1.1, live) * (1 - door * 0.3);
  steam.mat.uniforms.uWarmAmt.value = door * 0.4;
  steam.update(t);
  sparks.update(t);

  // dust in beams
  dust.mat.uniforms.uTime.value = t;
  dust.mat.uniforms.uFall.value = 0;
  W.floods.forEach((f, i) => dust.setLight(i, f.light, f.light.intensity * 0.00045));
  dust.setLight(4, droneSpot, droneSpot.intensity * 0.0025);
  dust.setLight(5, dawn, dawn.intensity * 0.00002);

  // ─── HTML overlays ───
  // sections on/off
  sections.forEach((s, i) => {
    const on = Math.abs(u - i) < 0.4 && (i > 0 || true);
    if (on !== s._on) { s._on = on; s.classList.toggle('is-on', on); if (on && s === statsSec && !counted) countUp(); }
  });
  // scrims
  const i0 = Math.min(shotList.length - 1, Math.floor(u)), i1 = Math.min(shotList.length - 1, i0 + 1), fu = smooth(0.2, 0.8, u - i0);
  const s0 = SCRIM[shotList[i0]], s1 = SCRIM[shotList[i1]];
  rootStyle.setProperty('--scrimL', lerp(s0[0], s1[0], fu).toFixed(3));
  rootStyle.setProperty('--scrimR', lerp(s0[1], s1[1], fu).toFixed(3));
  rootStyle.setProperty('--scrimB', lerp(s0[2], s1[2], fu).toFixed(3));
  // hold gauge near the pointer
  const showHold = !S.powered && pointer.active && u < 0.4 && !pointer.overUI;
  body.classList.toggle('show-hold', showHold);
  if (showHold) holdEl.style.transform = `translate3d(${pointer.px}px, ${pointer.py}px, 0)`;
  // reticle on the visor
  if (A.visor) {
    project(A.visor, sp);
    const showR = S.powered && S.live > 0.6 && sp.vis && (u < 1.4 || Math.abs(u - 7) < 0.4);
    hudEl.classList.toggle('on-reticle', showR);
    if (showR) reticle.style.transform = `translate3d(${sp.x.toFixed(1)}px, ${sp.y.toFixed(1)}px, 0)`;
  }
  // hotspots
  const inSpecs = S.powered && u > 1.55 && u < 5.45;
  let activeSpot = -1;
  SPOTS.forEach((s, i) => {
    const a = A[s.key];
    if (!a) return;
    project(a, sp);
    tmpC.subVectors(camera.position, a).normalize();
    const facing = tmpC.dot(A.normals[s.key]) > -0.2;
    const isActive = Math.abs(u - (i + 2)) < 0.3;
    const on = inSpecs && sp.vis && facing;
    s.el.classList.toggle('on', on);
    s.el.classList.toggle('dim', !isActive);
    if (on) s.el.style.transform = `translate3d(${sp.x.toFixed(1)}px, ${sp.y.toFixed(1)}px, 0)`;
    if (on && isActive) { activeSpot = i; sp2.x = sp.x; sp2.y = sp.y; }
  });
  leader.classList.toggle('on', activeSpot >= 0);
  if (activeSpot >= 0) {
    const card = specSecs[activeSpot].querySelector('.card').getBoundingClientRect();
    const toLeft = card.left > sp2.x;
    const ex = toLeft ? card.left : card.right, ey = clamp(sp2.y, card.top + 30, card.bottom - 30);
    leaderLine.setAttribute('x1', sp2.x.toFixed(1)); leaderLine.setAttribute('y1', sp2.y.toFixed(1));
    leaderLine.setAttribute('x2', ex.toFixed(1)); leaderLine.setAttribute('y2', ey.toFixed(1));
    leaderDot.setAttribute('cx', ex.toFixed(1)); leaderDot.setAttribute('cy', ey.toFixed(1));
  }
  // height ruler in the numbers section
  const showRuler = Math.abs(u - 6) < 0.35;
  rulerEl.classList.toggle('on', showRuler);
  if (showRuler) {
    const rr = tmpB.subVectors(cam.look, cam.pos).cross(camera.up).normalize();
    const base = tmpC.copy(rr).multiplyScalar(-4.7);
    project(base, sp); const bx = sp.x, by = sp.y;
    base.y = A.crown || MECH_H;
    project(base, sp);
    rulerEl.style.transform = `translate3d(${bx.toFixed(1)}px, ${sp.y.toFixed(1)}px, 0)`;
    rulerEl.style.height = Math.max(0, by - sp.y).toFixed(1) + 'px';
  }
  // HUD clock
  clockT += dt;
  if (clockT > 1) {
    clockT = 0;
    const s = baseSec + Math.floor(t);
    clockEl.textContent = [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':');
  }

  reflection.update(scene, camera);
  const footTop = footEl.getBoundingClientRect().top;
  engine.paused = footTop <= 0;
  navEl.classList.toggle('solid', footTop < 90);
});
// pointer over UI (for the hold gauge)
addEventListener('pointerover', e => { pointer.overUI = !!e.target.closest?.('a, button:not(.gauge), .nav, .card, .quote, .tw-nav'); });

// ─── Boot ─────────────────────────────────────────────────────────────────────
worldNav('hangar', { theme: 'dark', corner: 'bl' });
const cur = cursor({ color: '#ffb000', blend: 'normal', size: 30 });
magnetic();
const lenis = smoothScroll({ lerp: 0.08 });
document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
  const id = a.getAttribute('href');
  const el = id === '#top' ? document.body : document.querySelector(id);
  if (!el) return;
  e.preventDefault();
  let y = id === '#top' ? 0 : el.getBoundingClientRect().top + scrollY;
  if (el.classList?.contains('sec')) y += (el.offsetHeight - innerHeight) / 2;
  else if (el.firstElementChild?.classList.contains('sec')) y += (el.firstElementChild.offsetHeight - innerHeight) / 2;
  lenis.scrollTo(y, { duration: 2 });
}));

const T0 = performance.now();
await Promise.all([mechLoad, droneLoad]);
const T1 = performance.now();
// Warm every program with everything switched on, then return to the cold state.
{
  const save = { beacon: S.beacon };
  W.floods.forEach(f => (f.light.intensity = 1));
  dawn.intensity = 1; droneSpot.intensity = 1;
  scene.environment = envLive;
  renderer.compile(scene, camera);
  scene.environment = envCold;
  renderer.compile(scene, camera);
  Object.assign(S, save);
}
const T2 = performance.now();
if (DBG.has('t')) console.warn('boot', Math.round(T0), 'models', Math.round(T1 - T0), 'compile', Math.round(T2 - T1));
measure();
if (DBG.has('powered')) powerUp({ instant: true });
engine.start();
await loader.finish();
window.__power = (instant = false) => powerUp({ instant });
window.__S = S;
gsap.from('.title > span', { yPercent: 30, opacity: 0, duration: 1.6, ease: 'expo.out', stagger: 0.1, delay: 0.1 });
gsap.from('.eyebrow, .tag, .lede, .ignite, .nav', { opacity: 0, y: 16, duration: 1.2, ease: 'power3.out', stagger: 0.07, delay: 0.45 });
