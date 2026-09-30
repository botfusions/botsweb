import { Engine, THREE, damp, clamp, smooth, lerp } from '../../src/core/engine.js';
import { Assets } from '../../src/core/assets.js';
import { Pointer } from '../../src/core/input.js';
import { smoothScroll, gsap, elementProgress } from '../../src/core/scroll.js';
import { preloader, cursor, magnetic, worldNav } from '../../src/core/ui.js';
import { TUNE, buildHeight, HF, LAYOUT, regolithTextures, heightTexture, patchRegolith, sunUniform, nearTerrain, farTerrain, farHeightfield, rocks } from './terrain.js';
import { Prints } from './prints.js';
import { Dust } from './dust.js';
import { Astronaut } from './astronaut.js';
import { makeEarth, makeSun, makeStars } from './sky.js';
import { buildOutpost } from './outpost.js';

const DBG = new URLSearchParams(location.search);
const D2R = Math.PI / 180;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mobile = matchMedia('(max-width: 640px)').matches;

// ─── Engine ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gl');
const engine = new Engine({
  canvas, fov: 32, near: 0.08, far: 20000, dpr: mobile ? 1.5 : 1.5, background: 0x000000,
  post: {
    ao: { aoRadius: 0.8, intensity: 2.4, distanceFalloff: 0.5 },
    bloom: { intensity: 0.42, luminanceThreshold: 2.4, luminanceSmoothing: 0.45, radius: 0.72 },
    tone: 'agx',
    vignette: { offset: 0.34, darkness: 0.5 },
    noise: 0.045,
    ca: 0.0005,
  },
});
const { scene, camera, renderer } = engine;
renderer.shadowMap.type = THREE.PCFShadowMap;

const assets = new Assets();
const pointer = new Pointer({ lambda: 4 });

// ─── Loader: powered descent ──────────────────────────────────────────────────
const loaderEl = document.querySelector('.loader');
const numEl = loaderEl.querySelector('.loader-num'), pctEl = loaderEl.querySelector('.loader-pct'), callEl = loaderEl.querySelector('.loader-call');
const CALLS = [[0, 'Braking phase'], [0.45, 'Pitchover'], [0.75, 'Approach'], [0.93, 'Landing phase'], [1, 'Contact light']];
const loader = preloader({
  assets, el: loaderEl, minTime: 1600,
  onValue: v => {
    const alt = Math.round(15000 * Math.pow(1 - v, 1.7));
    numEl.textContent = alt.toLocaleString('en-US');
    pctEl.textContent = Math.round(v * 100);
    loaderEl.style.setProperty('--p', v.toFixed(3));
    callEl.textContent = CALLS.filter(c => v >= c[0]).pop()[1];
  },
  exit: async () => {
    callEl.textContent = 'Contact light';
    await new Promise(r => setTimeout(r, 420));
    callEl.textContent = 'Engine stop';
    await new Promise(r => setTimeout(r, 380));
    await gsap.to(loaderEl, { autoAlpha: 0, duration: 1.1, ease: 'power2.inOut' });
  },
});

// ─── Assets (downloads run while the rim is generated on the CPU) ─────────────
const pAstro = assets.gltf('models/artemis/astro-rig.glb');
const pEarth = assets.texture('img/artemis/earth.webp');
await new Promise(r => setTimeout(r, 60));
const H = buildHeight();

// ─── Lights ───────────────────────────────────────────────────────────────────
const SUN0 = LAYOUT.toSun.clone();
const sun = new THREE.DirectionalLight(0xfffcf6, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 13, bottom: -13, near: 1, far: 320 });
sun.shadow.bias = -0.00018; sun.shadow.normalBias = 0.022;
scene.add(sun, sun.target);
const earthshine = new THREE.HemisphereLight(0x4a6aa8, 0x000000, 0.1);
scene.add(earthshine);

// A cheap starting environment (replaced by a capture of the real scene once it exists).
{
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide,
    vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'varying vec3 p; void main(){ gl_FragColor = vec4(vec3(0.42) * smoothstep(0.05, -0.3, p.y), 1.); }' })));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(s, 0.04).texture;
  pm.dispose();
}

// ─── Terrain ──────────────────────────────────────────────────────────────────
const tex = regolithTextures(renderer);
const hfTex = heightTexture(H.data, HF.N + 1, renderer);
const farHF = farHeightfield(H, 512, 16000);
const farTex = heightTexture(farHF.data, farHF.n, renderer);
const midHF = farHeightfield(H, 512, 1600);
const midTex = heightTexture(midHF.data, midHF.n, renderer);
const regCtx = { tex, hf: { tex: hfTex, x0: H.x0, z0: H.z0, size: HF.half * 2 } };
const GROUND = 0x5d5c59;
const groundMat = patchRegolith(new THREE.MeshStandardMaterial({ color: GROUND, roughness: 1, metalness: 0, envMapIntensity: 0.4 }), regCtx);
const farMat = patchRegolith(new THREE.MeshStandardMaterial({ color: GROUND, roughness: 1, metalness: 0, envMapIntensity: 0.4 }),
  { tex, hf: { tex: farTex, x0: farHF.x0, z0: farHF.z0, size: farHF.size }, far: { tex: midTex, x0: midHF.x0, z0: midHF.z0, size: midHF.size }, fill: { value: 0.11 } });
const near = nearTerrain(H, groundMat);
const farMesh = farTerrain(H, farMat);
scene.add(near, farMesh);
const rockMat = patchRegolith(new THREE.MeshStandardMaterial({ color: 0x55534f, roughness: 0.94, metalness: 0, envMapIntensity: 0.6 }), { ...regCtx, rock: true, ls: 0.3 });
const rockGroup = rocks(H, rockMat);
scene.add(rockGroup);

const prints = new Prints(H, { ...regCtx, color: new THREE.Color(GROUND) });
scene.add(prints.mesh);
const dust = new Dust(mobile ? 3000 : 6000);
scene.add(dust.points);

// ─── Sky ──────────────────────────────────────────────────────────────────────
const SITE = V3(HF.cx, 0, HF.cz);
const earthTex = await pEarth;
earthTex.anisotropy = 8;
const earth = makeEarth(earthTex, { dist: 11500, ang: 5.4 });
earth.position.copy(SITE).addScaledVector(LAYOUT.toEarth, 11500);
scene.add(earth);
const sunDisc = makeSun();
scene.add(sunDisc);
const stars = makeStars(mobile ? 2500 : 5000);
stars.position.copy(SITE);
scene.add(stars);

// ─── Astronaut ────────────────────────────────────────────────────────────────
let simulating = false;
const gltf = await pAstro;
const tmp = V3(), tmp2 = V3();
const astro = new Astronaut(gltf, H, {
  onStep: e => {
    prints.stamp(e.x, e.z, e.yaw);
    if (simulating) return;
    const g = H.heightAt(e.x, e.z);
    dust.kick(tmp.set(e.x, g + 0.02, e.z), tmp2.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)), Math.round(26 + e.lope * 50),
      { speed: [0.12, 0.45 + e.lope * 0.7], elev: [0.35, 1.2], spread: 1.7, time: engine.time, ground: g, jitter: 0.07 });
  },
  onLift: e => {
    if (simulating) return;
    const g = H.heightAt(e.toe.x, e.toe.z);
    dust.kick(tmp.set(e.toe.x, g + 0.03, e.toe.z), e.fwd, Math.round(70 + e.lope * 110),
      { speed: [0.45, 1.25 + e.lope * 1.1], elev: [0.3, 0.95], spread: 0.42, time: engine.time, ground: g, jitter: 0.05 });
  },
});
scene.add(astro.root);
astro.model.traverse(o => {
  if (!o.isMesh) return;
  o.castShadow = true; o.receiveShadow = true;
  const m = o.material;
  m.envMapIntensity = 0.6;
  m.color.setScalar(0.7);
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (m[k]) m[k].anisotropy = 8;
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      float gRatio = diffuseColor.g / max(diffuseColor.r, 1e-3);
      float visor = step(0.6, gRatio) * step(gRatio, 0.86) * smoothstep(0.05, 0.12, diffuseColor.r - diffuseColor.b) * step(0.06, diffuseColor.r);
      metalnessFactor = max(metalnessFactor, visor);
      roughnessFactor = mix(max(roughnessFactor, 0.6), min(roughnessFactor, 0.14), max(smoothstep(0.35, 0.8, metalnessFactor), visor));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.72, 0.36), visor * 0.6);`);
  };
});

// ─── Outpost ──────────────────────────────────────────────────────────────────
const outpost = await buildOutpost({ assets, renderer, H, scene });
outpost.group.traverse(o => { if (o.isMesh && o.material?.envMapIntensity !== undefined) o.material.envMapIntensity = Math.max(o.material.envMapIntensity, 1); });

// ─── Sun control (the week turns the Sun around the horizon) ──────────────────
const sunState = { az: 0, envAz: -99 };
const toSun = V3();
function applySun(az) {
  toSun.copy(SUN0).applyAxisAngle(V3(0, 1, 0), -az);
  sunUniform.value.copy(toSun);
  earth.userData.uniforms.uSun.value.copy(toSun);
  sunDisc.position.copy(SITE).addScaledVector(toSun, 12000);
  outpost.trackSun(toSun);
}
applySun(0);

// Environment = a capture of the actual scene (sunlit regolith below, black sky, Earth), so the gold visor and foil
// reflect the rim they stand on.
const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
const cubeCam = new THREE.CubeCamera(0.5, 16000, cubeRT);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
function captureEnv() {
  astro.root.visible = false; dust.points.visible = false; prints.mesh.visible = false; stars.visible = false;
  cubeCam.position.copy(astro.root.position).add(V3(0, 1.6, 0));
  cubeCam.update(renderer, scene);
  astro.root.visible = true; dust.points.visible = true; prints.mesh.visible = true; stars.visible = true;
  const rt = pmrem.fromCubemap(cubeRT.texture);
  envRT?.dispose();
  envRT = rt;
  scene.environment = rt.texture;
  sunState.envAz = sunState.az;
}

// ─── Sections & camera choreography ───────────────────────────────────────────
const $ = s => document.querySelector(s);
const secs = { hero: $('.hero'), walk: $('.walk'), outpost: $('.outpost'), days: $('.days'), training: $('.training'), price: $('.price'), foot: $('.foot') };
const measure = el => ({ top: el.offsetTop, span: Math.max(1, el.offsetHeight - innerHeight) });
const RC = new Map();   // section ranges, measured on resize only (no layout reads inside the frame loop)
const range = el => RC.get(el) ?? measure(el);
const prog = el => { const r = range(el); return clamp((scrollY - r.top) / r.span); };
const A = V3(), F = V3(), S = V3(), L = outpost.center.clone();
const rel = (f, s, y, out = V3()) => out.copy(A).addScaledVector(F, f).addScaledVector(S, s).setY(A.y + y);
const toEarthFlat = V3(LAYOUT.toEarth.x, 0, LAYOUT.toEarth.z).normalize();
const siteC = V3(30, 0, -7);
// Portrait screens: centre the subject, pull back and widen, so the same choreography reads on a phone.
let portrait = innerWidth / innerHeight < 0.9;
addEventListener('resize', () => { portrait = innerWidth / innerHeight < 0.9; });
const shot = (pos, look, fov, subj, lift = 0.2) => {
  if (portrait && subj) { look.lerp(subj, 0.8); pos.sub(subj).multiplyScalar(1.22).add(subj); fov *= 1.32; look.y -= lift * pos.distanceTo(subj); }
  else if (portrait) fov *= 1.25;
  return { pos, look, fov };
};
const subA = (y = 0.95) => V3(A.x, A.y + y, A.z);
const at = (x, y, z) => V3(A.x + x, A.y + y, A.z + z);
const aroundL = (az, r, y) => V3(L.x + Math.sin(az * D2R) * r, L.y + y, L.z + Math.cos(az * D2R) * r);
const UP = V3(0, 1, 0);
const earthRight = V3(-toEarthFlat.z, 0, toEarthFlat.x);
const earthLook = V3().copy(toEarthFlat).applyAxisAngle(UP, 7.4 * D2R);
earthLook.y = Math.tan(3.6 * D2R);
const SHOTS = {
  hero: () => shot(at(1.35, 1.55, 7.2), at(-1.9, 1.2, -3.0), 30, portrait ? at(-0.2, 0.62, -0.4) : null, 0),
  side: () => shot(rel(-0.9, 6.4, 1.35), rel(0.3, 0, 1.05), 32, subA()),
  side3: () => shot(rel(0.2, 6.3, 1.4), rel(-1.2, 0, 1.1), 32, subA()),
  side2: () => shot(rel(-3.0, 3.0, 0.75), rel(0.7, -0.3, 0.7), 36, subA()),
  behind: () => shot(rel(-7.0, 2.2, 3.4), rel(5, -0.8, 0.5), 38, subA(0.3)),
  over: () => shot(rel(-2.4, 4.8, 8.4), rel(1.4, -0.3, 0), 36, subA(0)),
  front: () => shot(rel(4.2, 3.2, 1.1), rel(0, -0.2, 0.95), 34, subA()),
  boot: () => shot(rel(3.9, 1.7, 0.3), rel(0, 0, 0.92), 40, subA(0.9)),
  approach: () => shot(rel(-6.2, 3.8, 2.5), V3(L.x - 1.5, L.y + 2.9, L.z), 38, V3((A.x + L.x) / 2, L.y + 2, (A.z + L.z) / 2)),
  outA: () => shot(aroundL(-30, 15.5, 2.4), V3(L.x - 3.4, L.y + 2.9, L.z + 1.8), 36, V3(L.x, L.y + 3.4, L.z)),
  outB: () => shot(aroundL(6, 14.5, 3.4), V3(L.x - 3.6, L.y + 2.7, L.z + 0.4), 38, V3(L.x, L.y + 3.4, L.z)),
  daysA: () => shot(V3(43, 7.5, 23), V3(39.5, 5.2, -9.8), 38, V3(46, 2, -8)),
  daysB: () => shot(V3(39, 9.0, 20), V3(40.2, 4.6, -13), 40, V3(46, 2, -8)),
  portraitA: () => shot(rel(3.0, -0.3, 1.45), V3().copy(A).addScaledVector(S, 0.62).setY(A.y + 1.22), 28, subA(1.45)),
  portraitB: () => shot(rel(2.4, -1.5, 1.0), V3().copy(A).addScaledVector(S, 0.5).addScaledVector(F, 0.3).setY(A.y + 1.2), 30, subA(1.45)),
  earth: () => { const c = V3(A.x, A.y + 0.7, A.z).addScaledVector(toEarthFlat, -12).addScaledVector(earthRight, -0.62); return shot(c, c.clone().addScaledVector(earthLook, 40), 20); },
  foot: () => shot(V3(L.x - 22, L.y + 3.2, L.z + 16), V3(L.x - 6, L.y + 5.5, L.z - 4), 38),
};
let KEYS = [];
function layoutKeys() {
  RC.clear(); for (const el of Object.values(secs)) RC.set(el, measure(el));
  const k = (el, t, name) => { const r = range(el); return { y: r.top + t * r.span, name }; };
  KEYS = [
    { y: 0, name: 'hero' },
    k(secs.walk, 0.0, 'side'), k(secs.walk, 0.16, 'side2'), k(secs.walk, 0.32, 'behind'), k(secs.walk, 0.48, 'over'),
    k(secs.walk, 0.62, 'front'), k(secs.walk, 0.76, 'boot'), k(secs.walk, 0.88, 'side3'), k(secs.walk, 1.0, 'approach'),
    k(secs.outpost, 0.15, 'outA'), k(secs.outpost, 0.9, 'outB'),
    k(secs.days, 0.08, 'daysA'), k(secs.days, 0.92, 'daysB'),
    k(secs.training, 0.12, 'portraitA'), k(secs.training, 0.9, 'portraitB'),
    k(secs.price, 0.2, 'earth'), k(secs.price, 0.85, 'earth'),
    k(secs.foot, 0, 'foot'),
  ].sort((a, b) => a.y - b.y);
}
layoutKeys();
addEventListener('resize', () => setTimeout(layoutKeys, 50));
document.fonts?.ready.then(layoutKeys);
addEventListener('load', layoutKeys);

const camT = { pos: V3(), look: V3(), fov: 32 };
function evalCam(y) {
  let i = 0;
  while (i < KEYS.length - 2 && y >= KEYS[i + 1].y) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const f = smooth(0, 1, clamp((y - a.y) / Math.max(1, b.y - a.y)));
  const sa = SHOTS[a.name](), sb = SHOTS[b.name]();
  camT.pos.lerpVectors(sa.pos, sb.pos, f);
  camT.look.lerpVectors(sa.look, sb.look, f);
  camT.fov = lerp(sa.fov, sb.fov, f);
}

// ─── HTML bindings ────────────────────────────────────────────────────────────
const caps = [...document.querySelectorAll('.cap')].map(el => ({ el, from: +el.dataset.from, to: +el.dataset.to }));
const days = [...document.querySelectorAll('.itinerary li')];
const tm = { dist: $('.tm-dist'), steps: $('.tm-steps'), gait: $('.tm-gait'), prints: $('.tm-prints'), rate: $('.tm-rate'), rateV: $('.tm-rate-v') };
const hud = { sun: $('.hud-sun'), met: $('.hud-met'), frame: $('.hud-frame') };
const navLinks = [...document.querySelectorAll('.links a')];
const hsEl = $('.hotspots');
const HOTSPOTS = [
  { title: 'Crew cabin', text: 'Four berths, one Earth-facing window, 38 m³ per guest pair.', at: () => V3(0, 4.9, 0).applyAxisAngle(V3(0, 1, 0), LAYOUT.lander.yaw).add(L) },
  { title: 'Descent stage', text: 'Lands you, then stays behind as four tonnes of radiation shielding.', at: () => V3(0, 2.2, 0).add(L) },
  { title: 'Solar mast', text: 'Fifteen metres tall. Turns a full circle every lunar day. 48 kW.', at: () => V3(LAYOUT.mast.x, H.heightAt(LAYOUT.mast.x, LAYOUT.mast.z) + 11.5, LAYOUT.mast.z) },
  { title: 'Hab 2', text: 'Galley, gym, and the only shower within 384,000 km.', at: () => V3(LAYOUT.hab.x, H.heightAt(LAYOUT.hab.x, LAYOUT.hab.z) + 4.4, LAYOUT.hab.z) },
].map(h => { const el = document.createElement('div'); el.className = 'hs'; el.innerHTML = `<i></i><div><b>${h.title}</b><span>${h.text}</span></div>`; hsEl.appendChild(el); return { ...h, el }; });

document.querySelectorAll('a[href^="#"]:not([data-jump])').forEach(a => a.addEventListener('click', e => {
  const id = a.getAttribute('href').slice(1);
  const el = id === 'top' ? null : document.getElementById(id);
  e.preventDefault();
  if (id === 'reserve') { const r = range(secs.price); lenis.scrollTo(r.top + r.span * 0.5, { duration: 2.4 }); return; }
  lenis.scrollTo(el ?? 0, { duration: 2.2 });
}));
navLinks.concat([...document.querySelectorAll('[data-jump]')]).forEach(a => a.addEventListener('click', e => {
  const id = a.dataset.jump; if (!id || !secs[id]) return;
  e.preventDefault();
  const r = range(secs[id]);
  lenis.scrollTo(r.top + (id === 'walk' ? 0 : r.span * 0.12), { duration: 2.2 });
}));

// ─── Frame loop ───────────────────────────────────────────────────────────────
const state = { intro: 0, walkP: 0, target: 0, dayP: 0, starAmt: 0, lastHud: 0, frame: 0, par: V3() };
const camPos = V3(), camLook = V3();
let camInit = false;
const dbgCam = DBG.get('pos') ? { pos: V3(...DBG.get('pos').split(',').map(Number)), look: V3(...DBG.get('look').split(',').map(Number)), fov: +(DBG.get('fov') ?? 30) } : null;
const proj = V3();
const fmt = (n, w) => String(Math.floor(n)).padStart(w, '0');

engine.onTick((dt, t) => {
  pointer.update(dt);
  const y = scrollY;
  // astronaut target from the pinned walk
  state.walkP = prog(secs.walk);
  const target = clamp((state.walkP - 0.015) / 0.95) * (astro.len - 0.45);
  {
    const pr = range(secs.price);
    const want = smooth(pr.top - innerHeight * 0.8, pr.top + pr.span * 0.2, y);
    const dyaw = Math.atan2(toEarthFlat.x, toEarthFlat.z) - Math.atan2(astro.fwd.x, astro.fwd.z);
    const wrap = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    astro.yawOffset = damp(astro.yawOffset || 0, wrap * want * 0.8, 1.6, dt);
  }
  astro.update(dt, target, t);
  A.copy(astro.pos); F.copy(astro.fwd); S.copy(astro.side);
  dust.mat.uniforms.uTime.value = t;
  earth.userData.earth.rotation.y += dt * 0.006;

  // week → sun azimuth
  const dp = prog(secs.days);
  state.dayP = damp(state.dayP, dp, 3, dt);
  sunState.az = state.dayP * 85 * D2R;
  applySun(sunState.az);
  if (Math.abs(sunState.az - sunState.envAz) > 0.14) captureEnv();

  // camera
  evalCam(y);
  if (dbgCam) { camT.pos.copy(dbgCam.pos); camT.look.copy(dbgCam.look); camT.fov = dbgCam.fov; }
  // feed-forward so the damped follow camera doesn't trail a loping astronaut out of frame
  if (state.walkP > 0 && state.walkP < 1) { tmp.copy(F).multiplyScalar(astro.v / 5.5); camT.pos.add(tmp); camT.look.add(tmp); }
  // hand-held 70 mm: a breath of drift
  camT.pos.x += Math.sin(t * 0.43) * 0.012; camT.pos.y += Math.sin(t * 0.61 + 1) * 0.008;
  if (state.intro < 1) {
    const f = 1 - state.intro;
    camT.pos.add(tmp.set(-6 * f * f, 26 * f * f * f + 2 * f, 10 * f * f));
    camT.look.y += 0.6 * f;
  }
  state.par.set(pointer.sx * 0.22, pointer.sy * 0.12, 0).applyQuaternion(camera.quaternion);
  if (!camInit) { camPos.copy(camT.pos); camLook.copy(camT.look); camInit = true; }
  const k = dbgCam ? 50 : 5.5;
  camPos.set(damp(camPos.x, camT.pos.x, k, dt), damp(camPos.y, camT.pos.y, k, dt), damp(camPos.z, camT.pos.z, k, dt));
  camLook.set(damp(camLook.x, camT.look.x, k, dt), damp(camLook.y, camT.look.y, k, dt), damp(camLook.z, camT.look.z, k, dt));
  camera.position.copy(camPos).add(state.par);
  const gmin = H.heightAt(camera.position.x, camera.position.z) + 0.14;
  if (camera.position.y < gmin) camera.position.y = gmin;
  camera.lookAt(camLook);
  if (Math.abs(camera.fov - camT.fov) > 0.01) { camera.fov = damp(camera.fov, camT.fov, k, dt); camera.updateProjectionMatrix(); }

  // shadow frustum follows what we look at
  const focus = tmp.copy(camLook).lerp(camera.position, 0.25);
  focus.y = H.heightAt(focus.x, focus.z);
  sun.target.position.copy(focus);
  sun.position.copy(focus).addScaledVector(toSun, 160);
  sun.target.updateMatrixWorld();

  // stars open up at the very end
  const fr = range(secs.foot);
  state.starAmt = damp(state.starAmt, smooth(fr.top - innerHeight * 0.9, fr.top, y), 3, dt);
  stars.material.uniforms.uAmount.value = state.starAmt;

  // UI
  const walking = state.walkP > 0.004 && state.walkP < 0.999;
  document.body.classList.toggle('is-walking', walking);
  for (const c of caps) c.el.classList.toggle('on', walking && astro.d >= c.from && astro.d < c.to);
  for (const [name, el] of Object.entries(secs)) {
    if (name === 'hero' || name === 'walk' || name === 'foot') continue;
    const r = range(el);
    el.classList.toggle('in', y > r.top - innerHeight * 0.35 && y < r.top + r.span + innerHeight * 0.2);
  }
  const di = clamp(Math.floor(dp * 7), 0, 6);
  days.forEach((li, i) => li.classList.toggle('on', i === di));
  const outR = range(secs.outpost), outOn = y > outR.top - innerHeight * 0.1 && y < outR.top + outR.span;
  for (const h of HOTSPOTS) {
    proj.copy(h.at()).project(camera);
    const sy = (1 - proj.y) / 2 * innerHeight;
    const vis = outOn && proj.z < 1 && Math.abs(proj.x) < 0.85 && sy > 150 && sy < innerHeight - 140;
    h.el.classList.toggle('on', vis);
    if (vis) h.el.style.transform = `translate3d(${((proj.x + 1) / 2 * innerWidth).toFixed(1)}px, ${((1 - proj.y) / 2 * innerHeight).toFixed(1)}px, 0)`;
  }
  $('.hero').style.opacity = 1 - smooth(innerHeight * 0.05, innerHeight * 0.55, y);

  if (t - state.lastHud > 0.08) {
    state.lastHud = t;
    tm.dist.textContent = astro.d.toFixed(1);
    tm.steps.textContent = astro.steps;
    tm.gait.textContent = astro.v < -0.06 ? 'Retracing' : astro.moveW < 0.35 ? 'Standing' : astro.runW > 0.55 ? 'Lope' : 'Walk';
    tm.prints.textContent = prints.count;
    const rate = Math.abs(astro.v) / 1.35;
    tm.rate.classList.toggle('on', rate > 1.9);
    tm.rateV.textContent = rate > 1.9 ? `×${rate.toFixed(1)}` : '×1.0';
    const az = (218 + sunState.az / D2R) % 360;
    hud.sun.textContent = `Sun az ${az.toFixed(1)}° · el 7.2°`;
    const met = t + 0.0;
    hud.met.textContent = `${fmt(met / 86400, 3)}:${fmt((met / 3600) % 24, 2)}:${fmt((met / 60) % 60, 2)}:${fmt(met % 60, 2)}`;
    const sec = Object.entries(secs).filter(([n, el]) => n !== 'hero' && n !== 'foot' && y >= range(el).top - innerHeight * 0.5).pop()?.[0];
    navLinks.forEach(a => a.classList.toggle('on', a.dataset.jump === sec));
  }
  hud.frame.textContent = `Frame ${fmt(++state.frame % 10000, 4)}`;
});
engine.onResize((w, h, dpr) => {
  dust.mat.uniforms.uDpr.value = dpr; dust.mat.uniforms.uH.value = h;
  stars.material.uniforms.uDpr.value = dpr;
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
gsap.set('.hero-title .ln > span', { yPercent: 105 });
gsap.set('.eyebrow, .hero-sub, .hero-cta, .scroll-hint, .nav, .hud', { opacity: 0, y: 12 });
worldNav('artemis', { theme: 'dark', corner: 'bl' });
cursor({ color: '#ffffff', blend: 'difference', size: 30 });
magnetic();
const lenis = smoothScroll({ lerp: 0.08 });
window.__art = { captureEnv, sun, TUNE, groundMat, farMat, farMesh, near, earth, astro, prints, dust, engine, H, state, sunState, lenis, camera,
  jump(sec, p = 0) {
    const r = range(secs[sec]);
    lenis.scrollTo(r.top + p * r.span, { immediate: true, force: true });
    const target = clamp((prog(secs.walk) - 0.015) / 0.95) * (astro.len - 0.45);
    if (target > astro.d + 0.3) { simulating = true; astro.simulateTo(target, true); simulating = false; }
    else if (target < astro.d - 0.3) astro.d = target;
    state.intro = 1; camInit = false;
  } };

// Reloaded mid-page? Put the walker (and every print behind him) where the scroll says he should be.
{
  const target = clamp((prog(secs.walk) - 0.015) / 0.95) * (astro.len - 0.45);
  if (target > 0.5) { simulating = true; astro.simulateTo(target, true); simulating = false; }
}
astro.update(0.016, astro.d, 0);
captureEnv();
renderer.compile(scene, camera);
engine.start();
await loader.finish();
gsap.to(state, { intro: 1, duration: 3.4, ease: 'power3.inOut' });
gsap.to('.hero-title .ln > span', { yPercent: 0, duration: 1.6, ease: 'expo.out', stagger: 0.12, delay: 0.9 });
gsap.to('.eyebrow, .hero-sub, .hero-cta, .scroll-hint, .nav, .hud', { opacity: 1, y: 0, duration: 1.4, ease: 'power3.out', stagger: 0.08, delay: 1.3 });
