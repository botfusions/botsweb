import { Engine, THREE, normalize, prepModel, damp, clamp, smooth, lerp, studioEnvironment } from '../../src/core/engine.js';
import { Assets, BASE } from '../../src/core/assets.js';
import { Pointer } from '../../src/core/input.js';
import { smoothScroll, gsap, reveal } from '../../src/core/scroll.js';
import { preloader, cursor, magnetic, worldNav } from '../../src/core/ui.js';
import { PlanarReflection } from '../../src/core/reflector.js';
import { VolumetricSpotEffect } from '../../src/core/volumetric.js';
import { DepthOfFieldEffect, EffectPass } from 'postprocessing';
import { buildDeck, BANDS, L } from './deck.js';
import { buildRoom, WALL_Z, FLOOR_Y } from './room.js';
import { Deck, TRACKS } from './audio.js';

const Q = new URLSearchParams(location.search);
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const portrait = () => innerWidth / innerHeight < 0.85;
const coarse = matchMedia('(pointer: coarse)').matches;
if (Q.has('noui')) document.documentElement.classList.add('noui');

const fontsReady = Promise.race([
  Promise.all([
    document.fonts.load('800 88px "Syne"'), document.fonts.load('700 40px "Syne"'),
    document.fonts.load('400 20px "Space Mono"'), document.fonts.load('700 20px "Space Mono"'),
    document.fonts.load('400 300px "M PLUS Rounded 1c"', '低周波'),
  ]).catch(() => {}),
  new Promise(r => setTimeout(r, 3000)),
]);

// ─── Engine & post ────────────────────────────────────────────────────────────
const canvas = $('#gl');
let vol;
const engine = new Engine({
  canvas, fov: 34, near: 0.01, far: 30, dpr: 1.5, background: 0x07040a,
  post: {
    ao: Q.has('noao') ? false : { aoRadius: 0.12, intensity: 2.4, distanceFalloff: 0.22 },
    bloom: { intensity: 0.85, luminanceThreshold: 0.78, luminanceSmoothing: 0.3, radius: 0.8 },
    pre: cam => Q.has('novol') ? ((vol = { add() {} }), []) : [(vol = new VolumetricSpotEffect(cam, { density: 0.055, noise: 0.9, noiseScale: 3.4, maxDist: 7, floorY: FLOOR_Y, wind: new THREE.Vector3(0.03, 0.07, 0.01) }))],
    tone: Q.get('tone') ?? 'aces',
    vignette: { offset: 0.22, darkness: 0.82 },
    noise: 0.07,
    ca: 0.0013,
  },
});
const { scene, camera, renderer } = engine;
const dof = new DepthOfFieldEffect(camera, { focusDistance: 0.55, focusRange: 0.18, bokehScale: 3, resolutionScale: 0.5 });
if (!Q.has('nodof')) {
  const comp = engine.post.composer, i = comp.passes.indexOf(engine.post.ao);
  comp.addPass(new EffectPass(camera, dof), i >= 0 ? i + 1 : 1);
}
scene.fog = new THREE.FogExp2(0x07040b, 0.08);
scene.environment = studioEnvironment(renderer, {
  top: 0x1b1024, bottom: 0x040305, panels: [
    { pos: [0, 7, 1.5], size: [3, 2.2], intensity: 6, color: 0xffc27e },
    { pos: [0, 2.4, -7], size: [1.6, 4.5], intensity: 3.2, color: 0xa78bfa },
    { pos: [-7, 2, 3], size: [1.4, 4], intensity: 1.1, color: 0xff9a4d },
    { pos: [7, 3, 2], size: [1.2, 5], intensity: 1.4, color: 0x8e76ff },
    { pos: [0, 1, 8], size: [6, 1.2], intensity: 0.5, color: 0xffd9b0 },
  ],
});
scene.environmentIntensity = 0.24;
const hemi = new THREE.HemisphereLight(0x2c1b3e, 0x0a0508, 0.2);
scene.add(hemi);

// ─── Lights ───────────────────────────────────────────────────────────────────
const KEY_ON = 7.5;
const key = new THREE.SpotLight(0xffcf9e, 0, 3.6, 0.27, 0.7, 2);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.3; key.shadow.camera.far = 2.4;
key.shadow.bias = -0.00012; key.shadow.normalBias = 0.006; key.shadow.radius = 4;
scene.add(key, key.target);
vol.add(key, { scale: 0.28, range: 0.4, softness: 0.55 });
const counterSpots = [-1.5, 0, 1.5].map((x, i) => {
  const s = new THREE.SpotLight(0xffbf80, 0, 3, 0.5, 0.7, 2);
  s.position.set(x, 1.0, 1.12); s.target.position.set(x, 0, 1.12);
  scene.add(s, s.target);
  if (i !== 1) vol.add(s, { scale: 0.18, range: 0.6, softness: 0.6 });
  return s;
});
const wallWash = new THREE.SpotLight(0xd6b8ff, 0, 4, 0.9, 0.9, 1.6);
wallWash.position.set(0, 2.35, 0.6); wallWash.target.position.set(0, 0.6, WALL_Z - 0.2);
scene.add(wallWash, wallWash.target);
const rim = new THREE.DirectionalLight(0xb9a3ff, 0);
rim.position.set(-1.2, 1.6, -2.4);
scene.add(rim, rim.target);
const streak = new THREE.SpotLight(0xd9ccff, 0, 3, 0.2, 0.8, 1.5);
scene.add(streak, streak.target);
const fill = new THREE.PointLight(0x8c6cff, 0, 5, 1.4);
fill.position.set(-0.8, 1.2, 1.6);
scene.add(fill);
const touch = new THREE.PointLight(0xcdb8ff, 0, 0.35, 2);
scene.add(touch);
const LIGHTS = { key: KEY_ON, counter: 1.5, wash: 1.1, rim: 0.55, fill: 0.5, streak: Q.has('nostreak') ? 0 : 0.9 };

// ─── Loading ──────────────────────────────────────────────────────────────────
const assets = new Assets();
const pointer = new Pointer({ lambda: 5 });
const loaderEl = $('.loader');
{
  const g = loaderEl.querySelector('.ld-grooves');
  for (let i = 0; i < 26; i++) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', 100); c.setAttribute('cy', 100); c.setAttribute('r', 94 - i * 2.35); c.style.opacity = 0;
    g.appendChild(c);
  }
}
const grooveEls = [...loaderEl.querySelectorAll('.ld-grooves circle')];
const loader = preloader({
  assets, el: loaderEl, minTime: 1600,
  onValue: v => {
    loaderEl.querySelector('.loader-pct').textContent = String(Math.round(v * 100)).padStart(3, '0');
    grooveEls.forEach((c, i) => { c.style.opacity = v * 26 > i ? 1 : 0.08; });
  },
});
const texLoad = name => assets.texture(`img/lowfreq/${name}.webp`);
const COVER_NAMES = ['aubergine', 'tidal', 'counter', 'rain', 'valves', 'geometry'];
const loads = {
  tt: assets.gltf('models/lowfreq/turntable.glb'),
  sp: assets.gltf('models/lowfreq/speaker.glb'),
  covers: Promise.all(COVER_NAMES.map(texLoad)),
};

// ─── State ────────────────────────────────────────────────────────────────────
const OMEGA = 2 * Math.PI * (100 / 3) / 60; // 33⅓ rpm in rad/s
const IDLE = 0.26;
const S = { playing: false, needle: false, track: 0, speed: 1, spin: 0, recAngle: 0, held: false, scratched: false, intro: 0, motor: false };
const arm = { yaw: 0, lift: 0.03 };
const audio = new Deck();
const woofer = { value: 0 };
let deck3, room, RC = new THREE.Vector3(), recR = 0.152, speakers = [];
const SPEC = new Float32Array(72);
const env = { bass: 0, mid: 0, high: 0, rms: 0, kick: 0 };
let fakeMix = 1;

// ─── Build the world ─────────────────────────────────────────────────────────
async function build() {
  const [ttG, spG, covers] = await Promise.all([loads.tt, loads.sp, loads.covers]);
  await fontsReady;
  for (const c of covers) { c.anisotropy = renderer.capabilities.getMaxAnisotropy(); }

  room = buildRoom(renderer, scene, { covers });

  // Turntable
  const tt = ttG.scene;
  normalize(tt, 0.41);
  prepModel(tt, renderer, { env: 0.9, onMat: m => { m.color.setRGB(0.62, 0.56, 0.54); } });
  tt.position.x += 0.02;
  scene.add(tt);
  deck3 = buildDeck(renderer, tt, { tracks: TRACKS });
  tt.updateMatrixWorld(true);
  deck3.center(RC);
  recR = deck3.radiusWorld();
  arm.yaw = deck3.restYaw;

  // Speakers (woofer cones pump with the kick)
  const spk = spG.scene;
  normalize(spk, 0.43, { axis: 'y' });
  prepModel(spk, renderer, { env: 0.9, onMat: m => {
    m.onBeforeCompile = sh => {
      sh.uniforms.uWoof = woofer;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWoof;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          { float r = length(position.xy - vec2(0.0, -0.285)); float w = 1.0 - smoothstep(0.16, 0.37, r); w *= smoothstep(0.35, 0.5, position.z);
            transformed.z += uWoof * w * 0.055; }`);
    };
  } });
  for (const [x, ry] of [[-0.87, 0.28], [0.88, -0.28]]) {
    const g = new THREE.Group(); g.add(x < 0 ? spk : spk.clone());
    g.position.set(x, 0.006, -0.1); g.rotation.y = ry;
    scene.add(g); speakers.push(g);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.006, 16), new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.6 }));
    for (const [px, pz] of [[-0.08, -0.1], [0.08, -0.1], [-0.08, 0.1], [0.08, 0.1]]) { const p = pad.clone(); p.position.set(px, -0.003, pz); g.add(p); }
  }

  // Key light hangs in the deck pendant, aimed at the record.
  key.position.copy(room.keyPendant.position).add(new THREE.Vector3(0, -0.02, 0));
  key.target.position.copy(RC).add(new THREE.Vector3(0.03, 0, -0.035));
  rim.target.position.copy(RC);
  // a low lavender practical behind the deck: its reflection draws the radial streak across the vinyl
  streak.position.copy(RC).add(new THREE.Vector3(-0.55, 0.3, -1.05));
  streak.target.position.copy(RC);

  // Glossy back counter reflects the deck, the valves and the halo.
  const refl = new PlanarReflection(renderer, { resolution: 0.5 });
  const topMat = room.counterTopMat.clone();
  room.reflectFloor.material = topMat;
  refl.hidden.push(room.reflectFloor);
  refl.patch(topMat, { strength: 1.1, distort: 0.006, lodScale: 5.5, lodBias: 0.25, f0: 0.05 });
  engine.onResize((w, h, dpr) => refl.setSize(w, h, dpr));
  reflection = refl;

  // Band markers: a lavender wash over the grooves of the band a cue will land on
  bandMarkers = BANDS.map(b => {
    const m = new THREE.Mesh(new THREE.RingGeometry(b.inner, b.outer, 192, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xa78bfa).multiplyScalar(0.55), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.position.set(L.cx, L.top + 0.0035, L.cz);
    deck3.mesh.add(m);
    return m;
  });

  makeDust();
  makeTrail();
  defineShots();
}
let bandMarkers = [], reflection;

// ─── Dust in the beam ─────────────────────────────────────────────────────────
let dust;
function makeDust(N = 1400) {
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.5;
    pos[i * 3] = RC.x + Math.cos(a) * r; pos[i * 3 + 1] = 0.03 + Math.random() * 1.0; pos[i * 3 + 2] = RC.z + Math.sin(a) * r;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uLPos: { value: new THREE.Vector3() }, uLDir: { value: new THREE.Vector3(0, -1, 0) }, uCos: { value: 0.93 },
      uPow: { value: 0 }, uKick: { value: 0 }, uEnergy: { value: 0 }, uDpr: { value: 1 }, uAxis: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */`
      attribute float seed; uniform float uTime, uCos, uPow, uKick, uEnergy, uDpr; uniform vec3 uLPos, uLDir, uAxis; varying float vA;
      void main(){
        vec3 p = position;
        float t = uTime * (0.03 + seed * 0.05) * (1.0 + uEnergy * 2.5);
        p += vec3(sin(t * 3.1 + seed * 40.), sin(t * 2.3 + seed * 13.) * 0.5 + t * 0.06, cos(t * 2.7 + seed * 27.)) * 0.12;
        p.y = mod(p.y - 0.03, 1.0) + 0.03;
        vec2 rad = p.xz - uAxis.xz;
        p.xz += normalize(rad + 1e-4) * uKick * 0.018 * seed;
        p.y += uKick * 0.012 * (seed - 0.3);
        vec3 d = p - uLPos; float dist = length(d);
        float cone = smoothstep(uCos, uCos + 0.04, dot(d / dist, uLDir));
        float tw = 0.55 + 0.45 * sin(uTime * (1.5 + seed * 5.0) + seed * 60.0);
        vA = cone * uPow * tw * (0.35 + 0.65 * fract(seed * 91.7)) * (1.0 + uKick * 1.5);
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.6 + seed * 1.3) * uDpr * (0.5 / -mv.z);
      }`,
    fragmentShader: /* glsl */`varying float vA; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .0, d); gl_FragColor = vec4(vec3(1.0, .82, .6) * a * vA * 1.6, 1.); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  engine.onResize((w, h, dpr) => { mat.uniforms.uDpr.value = dpr; });
  dust = mat;
}

// ─── Scratch comet: glowing points that follow the hand across the vinyl ─────
let trail;
function makeTrail(N = 900) {
  const pos = new Float32Array(N * 3), born = new Float32Array(N).fill(-99), heat = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('born', new THREE.BufferAttribute(born, 1));
  geo.setAttribute('heat', new THREE.BufferAttribute(heat, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uDpr: { value: 1 }, uA: { value: new THREE.Color(0xa78bfa) }, uB: { value: new THREE.Color(0xffb45c) } },
    vertexShader: /* glsl */`
      attribute float born, heat; uniform float uTime, uDpr; varying float vA, vH;
      void main(){
        float age = uTime - born;
        vA = exp(-age * 0.95) * step(0.0, age);
        vH = heat;
        vec4 mv = modelViewMatrix * vec4(position + vec3(0.0, age * 0.012, 0.0), 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uDpr * (9.0 + 26.0 * vA) * (0.35 / -mv.z) * (0.75 + heat * 0.5);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uA, uB; varying float vA, vH;
      void main(){ float d = length(gl_PointCoord - 0.5); float core = smoothstep(0.5, 0.0, d); float hot = smoothstep(0.18, 0.0, d);
        vec3 c = mix(uA, uB, clamp(vH, 0.0, 1.0));
        gl_FragColor = vec4((c * core * core * 3.2 + vec3(1.0, 0.95, 0.9) * hot * 2.2) * vA, 1.0); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.renderOrder = 7;
  scene.add(pts);
  engine.onResize((w, h, dpr) => { mat.uniforms.uDpr.value = dpr; });
  let head = 0; const last = new THREE.Vector3(); let has = false;
  const emit = (p, t, h) => { pos.set([p.x, p.y, p.z], head * 3); born[head] = t; heat[head] = h; head = (head + 1) % N; };
  trail = {
    update(dt, t, hand, speed) {
      mat.uniforms.uTime.value = t;
      if (!hand) { has = false; return; }
      const p = _p4.copy(hand); p.y = RC.y + 0.006;
      if (!has) { last.copy(p); has = true; emit(p, t, speed / 2.5); }
      const d = last.distanceTo(p), steps = Math.min(24, Math.floor(d / 0.0016));
      for (let k = 1; k <= steps; k++) emit(_p3.lerpVectors(last, p, k / steps), t - (1 - k / steps) * dt, Math.min(1.2, speed / 2.5));
      if (steps) last.copy(p);
      geo.attributes.position.needsUpdate = geo.attributes.born.needsUpdate = geo.attributes.heat.needsUpdate = true;
    },
  };
}

// ─── Camera shots ─────────────────────────────────────────────────────────────
const K = {};
const INTRO = { pos: new THREE.Vector3(0.35, 1.25, 2.9), look: new THREE.Vector3(0, 0.25, -0.2), fov: 40 };
function defineShots() {
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const r = (x, y, z) => RC.clone().add(v(x, y, z));
  const woof = speakers[1].localToWorld(v(0, 0.12, 0.1));
  K.hero = { pos: r(0.43, 0.17, 0.5), look: r(-0.2, 0.01, -0.06), fov: 33, focus: r(0.02, 0, 0.05), range: 0.16, bokeh: 3.4, par: 1,
    m: { pos: r(0.03, 0.5, 0.52), look: r(0.0, -0.2, 0.12), fov: 46 } };
  K.press = { pos: r(0.22, 0.8, 0.14), look: r(0.22, 0, 0.0), fov: 33, focus: r(0, 0, 0), range: 0.32, bokeh: 1.4, par: 0.35, key: 0.55,
    m: { pos: r(0.0, 0.7, 0.4), look: r(0.0, 0, 0.13), fov: 44 } };
  K.bar = { pos: v(2.25, 1.1, 3.7), look: v(0.72, 0.22, 0.1), fov: 38, focus: v(0.0, 0.2, 0.0), range: 2.2, bokeh: 1.4, par: 1, streak: 0.15,
    m: { pos: v(0.4, 0.9, 3.9), look: v(0.0, 0.2, -0.2), fov: 52 } };
  K.cat = { pos: v(-1.45, 0.92, 0.78), look: v(-1.7, 0.86, WALL_Z), fov: 38, focus: v(-1.7, 0.92, WALL_Z), range: 0.9, bokeh: 1.3, drift: v(1.1, 0.0, 0), par: 0.5,
    m: { pos: v(-1.2, 0.92, 0.72), look: v(-1.35, 0.86, WALL_Z), fov: 52 } };
  K.club = { pos: v(0.46, 0.2, 0.62), look: v(0.9, 0.16, -0.12), fov: 35, focus: woof, range: 0.28, bokeh: 3, par: 1,
    m: { pos: v(0.62, 0.3, 0.95), look: v(0.8, 0.14, -0.1), fov: 46 } };
  K.end = { pos: r(-0.36, 0.045, 0.19), look: r(0.09, 0.012, -0.03), fov: 30, focus: r(-0.03, 0.0, 0.03), range: 0.3, bokeh: 2.6, par: 0.6,
    m: { pos: r(-0.28, 0.12, 0.34), look: r(0.03, 0.0, -0.02), fov: 42 } };
}
const SECTIONS = $$('[data-cam]');
let ranges = [];
function measure() {
  const vh = innerHeight, max = document.documentElement.scrollHeight - vh;
  ranges = SECTIONS.map(el => {
    let a = el.offsetTop - vh * 0.25, b = el.offsetTop + el.offsetHeight - vh * 0.75;
    if (b < a) a = b = (a + b) / 2;
    return { a: clamp(a, 0, max), b: clamp(b, 0, max) };
  });
  ranges[0].a = 0; ranges[ranges.length - 1].b = max;
}
addEventListener('resize', measure);
new ResizeObserver(measure).observe(document.body);

const shot = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 34, focus: new THREE.Vector3(), range: 0.2, bokeh: 3, par: 1, key: 1, streak: 1 };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
let secIdx = 0, secBlend = 0;
function kf(k, idx, y, pm, oPos, oLook) {
  const P = pm && k.m ? k.m : k;
  oPos.copy(P.pos); oLook.copy(P.look);
  if (k.drift) {
    const R = ranges[idx], u = clamp((y - R.a) / Math.max(1, R.b - R.a)) - 0.5;
    oPos.addScaledVector(k.drift, u * (pm ? 0.5 : 1)); oLook.addScaledVector(k.drift, u * (pm ? 0.5 : 1));
  }
  return P;
}
function shotAt(y, out) {
  let i = 0;
  while (i < ranges.length - 1 && y > ranges[i].b) i++;
  // inside a hold range -> that shot; between ranges -> eased blend from the previous one
  let ia, ib, e;
  if (y >= ranges[i].a || i === 0) { ia = ib = i; e = 0; }
  else { ia = i - 1; ib = i; e = smooth(0, 1, (y - ranges[ia].b) / Math.max(1, ranges[ib].a - ranges[ia].b)); }
  const A = K[SECTIONS[ia].dataset.cam], B = K[SECTIONS[ib].dataset.cam];
  const pm = portrait();
  const PA = kf(A, ia, y, pm, _a, _c), PB = kf(B, ib, y, pm, _b, _d);
  out.pos.lerpVectors(_a, _b, e);
  out.look.lerpVectors(_c, _d, e);
  out.pos.y += Math.sin(e * Math.PI) * 0.08;
  out.fov = lerp(PA.fov, PB.fov, e);
  out.focus.lerpVectors(A.focus, B.focus, e);
  out.range = lerp(A.range, B.range, e);
  out.bokeh = lerp(A.bokeh, B.bokeh, e);
  out.par = lerp(A.par, B.par, e);
  out.key = lerp(A.key ?? 1, B.key ?? 1, e);
  out.streak = lerp(A.streak ?? 1, B.streak ?? 1, e);
  secIdx = e < 0.5 ? ia : ib; secBlend = ia === ib ? 0 : e;
  return out;
}

// ─── Playback control ─────────────────────────────────────────────────────────
const toastEl = $('.toast');
let toastT;
function toast(msg, ms = 2600) { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), ms); }
let armTl = null, cueToken = 0;
const trackReady = i => new Promise(res => { const k = () => (audio.fwd[i] ? res() : setTimeout(k, 60)); k(); });
function soundOn() {
  audio.unlock();
  const b = $('.sound');
  if (!audio.muted) { b.setAttribute('aria-pressed', 'true'); b.querySelector('.sound-label').textContent = 'Sound on'; }
}
async function play(i = S.track, { quick = false } = {}) {
  soundOn();
  const token = ++cueToken;
  S.playing = true; S.track = i;
  updateUI();
  if (!audio.fwd[i]) { $$('.tracks li')[i]?.classList.add('wait'); toast(`Pressing ${TRACKS[i].id} — one moment`); await trackReady(i); $$('.tracks li')[i]?.classList.remove('wait'); }
  if (token !== cueToken) return;
  if (S.needle) { S.needle = false; audio.needleLift(); }
  armTl?.kill();
  armTl = gsap.timeline()
    .to(arm, { lift: 0.09, duration: quick ? 0.18 : 0.32, ease: 'power2.out' })
    .to(arm, { yaw: deck3.bandYaw[i], duration: quick ? 0.55 : 1.15, ease: 'power2.inOut' })
    .to(arm, { lift: 0, duration: quick ? 0.25 : 0.55, ease: 'power2.in', onComplete: () => {
      if (token !== cueToken) return;
      audio.cue(i); S.needle = true; audio.needleDrop(); dropPulse = 1;
    } });
}
function pause() {
  const token = ++cueToken;
  S.playing = false;
  updateUI();
  // brake with the needle still down (the platter winds down), then lift and park
  armTl?.kill();
  armTl = gsap.timeline({ delay: S.needle ? 1.25 : 0 })
    .add(() => { if (token !== cueToken) return; if (S.needle) audio.needleLift(); S.needle = false; })
    .to(arm, { lift: 0.09, duration: 0.3, ease: 'power2.out' })
    .to(arm, { yaw: deck3.restYaw, duration: 1.1, ease: 'power2.inOut' })
    .to(arm, { lift: 0.03, duration: 0.4, ease: 'power2.in' });
}
let dropPulse = 0;
function updateUI() {
  document.body.classList.toggle('is-playing', S.playing);
  $$('.tracks li').forEach((li, k) => li.classList.toggle('on', S.playing && k === S.track));
  const t = TRACKS[S.track];
  $('.np-t').textContent = `${t.id} · ${t.title}`;
  $('.play-main .pl').textContent = S.playing ? 'Lift the needle' : 'Drop the needle';
  $('.pp').setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
  $('.bpm-read').textContent = `${Math.round(t.bpm * S.speed)} bpm`;
  document.documentElement.style.setProperty('--spin-state', S.playing ? 'running' : 'paused');
}
const togglePlay = () => (S.playing ? pause() : play(S.track));
$('.play-main').addEventListener('click', togglePlay);
$('.pp').addEventListener('click', togglePlay);
$('.sound').addEventListener('click', () => {
  const b = $('.sound');
  if (!audio.ctx) { audio.unlock(); audio.setMuted(false); }
  else audio.setMuted(!audio.muted);
  const on = !audio.muted;
  b.setAttribute('aria-pressed', String(on));
  b.querySelector('.sound-label').textContent = on ? 'Sound on' : 'Sound off';
  if (on && !S.playing) toast('Sound is on — drop the needle or put your hand on the record');
});
$$('.rpm button').forEach(b => b.addEventListener('click', () => {
  $$('.rpm button').forEach(x => x.classList.toggle('on', x === b));
  S.speed = +b.dataset.rpm;
  $('.rpm-read').textContent = S.speed > 1 ? '45 rpm' : '33⅓ rpm';
  updateUI();
}));
$$('.tracks li').forEach((li, k) => {
  li.addEventListener('click', () => play(k));
  li.addEventListener('pointerenter', () => { hoverTrack = k; });
  li.addEventListener('pointerleave', () => { if (hoverTrack === k) hoverTrack = -1; });
});
let hoverTrack = -1;

// ─── Scratching ───────────────────────────────────────────────────────────────
const scratchEl = $('.scratch');
const hintEl = $('.hint'), chipEl = $('.hint-chip');
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2(), hitP = new THREE.Vector3();
function hitRecord(cx, cy) {
  ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  plane.constant = -RC.y;
  if (!ray.ray.intersectPlane(plane, hitP)) return null;
  const dx = hitP.x - RC.x, dz = hitP.z - RC.z;
  return { r: Math.hypot(dx, dz), phi: Math.atan2(-dz, dx), p: hitP };
}
const grab = { phi: 0, acc: 0, rec0: 0, target: 0, hover: false, world: new THREE.Vector3() };
scratchEl.addEventListener('pointerdown', e => {
  const h = hitRecord(e.clientX, e.clientY);
  if (!h || h.r > recR * 1.06) return;
  e.preventDefault();
  scratchEl.setPointerCapture(e.pointerId);
  S.held = true;
  grab.phi = h.phi; grab.acc = 0; grab.rec0 = S.recAngle; grab.target = S.recAngle; grab.world.copy(h.p);
  if (!S.playing) play(S.track, { quick: true });
  else soundOn();
  if (!S.scratched) { S.scratched = true; hintEl.classList.remove('on'); chipEl.classList.remove('on'); }
  document.body.classList.add('is-scratching');
});
scratchEl.addEventListener('pointermove', e => {
  const h = hitRecord(e.clientX, e.clientY);
  grab.hover = !!h && h.r < recR * 1.04;
  if (h) { touch.position.set(h.p.x, RC.y + 0.035, h.p.z); grab.world.copy(h.p); }
  if (!S.held || !h) return;
  if (h.r < recR * 0.12) { grab.phi = h.phi; return; } // dead zone at the spindle
  let d = h.phi - grab.phi;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  grab.phi = h.phi; grab.acc += d;
  grab.target = grab.rec0 + grab.acc;
});
const release = () => { if (!S.held) return; S.held = false; document.body.classList.remove('is-scratching'); cur?.set(grab.hover ? 'drag' : '', grab.hover ? 'Scratch' : ''); };
scratchEl.addEventListener('pointerup', release);
scratchEl.addEventListener('pointercancel', release);
scratchEl.addEventListener('pointerleave', () => { grab.hover = false; });
addEventListener('pointerup', release);

// ─── Projection helpers ───────────────────────────────────────────────────────
const proj = (p, out = new THREE.Vector3()) => { out.copy(p).project(camera); out.x = (out.x + 1) / 2 * innerWidth; out.y = (1 - out.y) / 2 * innerHeight; return out; };
const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _p3 = new THREE.Vector3(), _p4 = new THREE.Vector3();
const leader = $('.leader'), leaderPath = leader.querySelector('path'), leaderDot = leader.querySelector('circle');

// ─── Fake spectrum for the silent state ──────────────────────────────────────
function fakeSpectrum(out, t) {
  const beat = t * 118 / 60, ph = beat % 1;
  const kick = Math.exp(-ph * 6.5), hat = Math.exp(-((beat + 0.5) % 1) * 9), bar = Math.floor(beat / 4);
  const chord = 0.5 + 0.5 * Math.sin(t * 0.8 + bar);
  for (let i = 0; i < out.length; i++) {
    const f = i / (out.length - 1);
    out[i] = 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(t * 2.1 + i * 0.9) * Math.sin(t * 1.3 + i * 0.37))
      + kick * 0.62 * Math.exp(-f * 7) + hat * 0.32 * smooth(0.62, 0.95, f)
      + chord * 0.22 * Math.exp(-((f - 0.38) ** 2) / 0.015) + 0.1 * Math.exp(-((f - 0.2) ** 2) / 0.004) * (0.5 + 0.5 * Math.sin(t * 3 + 1));
  }
  return { bass: kick * 0.75, mid: 0.2 + chord * 0.2, high: hat * 0.5, rms: 0.12 + kick * 0.12 };
}

// ─── Frame ────────────────────────────────────────────────────────────────────
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3();
let tubeWarm = 0, neonOn = 0, lightsOn = 0, heroFade = 1, lastRec = 0;
const vuState = { v: 0 };
const heroEl = $('.hero');
function tick(dt, t) {
  pointer.update(dt);
  // Camera: scroll shot, intro blend, hand-held drift, parallax
  shotAt(window.__lenis?.animatedScroll ?? scrollY, shot);
  const ie = S.intro;
  camPos.lerpVectors(INTRO.pos, shot.pos, ie); camLook.lerpVectors(INTRO.look, shot.look, ie);
  const par = shot.par * (coarse ? 0.3 : 1);
  tmp.subVectors(camLook, camPos).normalize();
  const right = _p4.crossVectors(tmp, camera.up).normalize();
  const dist = camPos.distanceTo(camLook);
  camPos.addScaledVector(right, (pointer.sx * 0.028 + Math.sin(t * 0.29) * 0.004) * par * dist);
  camPos.y += (pointer.sy * 0.018 + Math.sin(t * 0.41) * 0.003) * par * dist;
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  const fov = lerp(INTRO.fov, shot.fov, ie);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  dof.cocMaterial.focusDistance = camera.position.distanceTo(shot.focus);
  dof.cocMaterial.focusRange = shot.range;
  dof.bokehScale = shot.bokeh;

  // Platter: motor, hand, speed
  const target = (S.playing ? OMEGA * S.speed : OMEGA * IDLE) * (S.motor ? 1 : 0);
  if (S.held) {
    const prev = S.recAngle;
    S.recAngle = damp(S.recAngle, grab.target, 38, dt);
    const raw = -(S.recAngle - prev) / Math.max(dt, 1e-4);
    S.spin = damp(S.spin, raw, 28, dt);
  } else {
    const up = target > S.spin;
    S.spin = damp(S.spin, target, up ? (S.playing ? 3.2 : 2) : (S.playing ? 2.4 : 1.25), dt);
    S.recAngle -= S.spin * dt;
  }
  if (deck3) {
    deck3.record.rotation.y = S.recAngle;
    trail?.update(dt, t, S.held ? grab.world : null, Math.abs(S.spin) / OMEGA);
    if (S.held && cur) cur.set('drag', `${S.spin < -0.05 ? '◀' : '▶'} ${Math.abs(S.spin / OMEGA).toFixed(1)}×`);
    const wob = S.needle ? Math.sin(S.recAngle) * 0.0035 : 0;
    deck3.setArm(arm.yaw + wob, arm.lift);
  }
  const rate = S.spin / OMEGA;
  audio.update(rate, S.needle);

  // Spectrum: real when the needle is in the groove, a believable fake otherwise
  let live = false;
  if (audio.ready && S.needle) live = audio.spectrum(SPEC);
  fakeMix = damp(fakeMix, live ? 0 : 1, 3, dt);
  let lv = audio.levels;
  if (fakeMix > 0.01) {
    const FK = fakeSpectrum(fakeSpec, t);
    const k = fakeMix * (S.playing ? 1 : 0.8);
    for (let i = 0; i < SPEC.length; i++) SPEC[i] = lerp(live ? SPEC[i] : 0, fakeSpec[i] * 0.85, k);
    lv = { bass: lerp(live ? audio.levels.bass : 0, FK.bass, k), mid: lerp(live ? audio.levels.mid : 0, FK.mid, k), high: lerp(live ? audio.levels.high : 0, FK.high, k), rms: lerp(live ? audio.levels.rms * 3 : 0, FK.rms, k) };
  } else lv = { ...audio.levels, rms: audio.levels.rms * 3 };
  env.bass = lv.bass > env.bass ? lerp(env.bass, lv.bass, 0.6) : damp(env.bass, lv.bass, 9, dt);
  env.mid = damp(env.mid, lv.mid, 6, dt); env.high = damp(env.high, lv.high, 10, dt);
  env.rms = damp(env.rms, lv.rms, 5, dt);
  const kickNow = Math.max(0, lv.bass - 0.35) / 0.65;
  env.kick = Math.max(kickNow, env.kick * Math.exp(-dt * 7));

  if (deck3) {
    const ring = deck3.ring, N = ring.N;
    for (let i = 0; i < N; i++) {
      // lows face the camera side (front), highs run round to the back
      const a = i / N * Math.PI * 2;
      const dA = Math.abs(Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2))) / Math.PI;
      const b = Math.min(SPEC.length - 1, Math.floor(dA * (SPEC.length - 1)));
      const v = SPEC[b] * (0.75 + 0.25 * Math.sin(a * 3 + t * 0.6));
      ring.amp[i] = v > ring.amp[i] ? lerp(ring.amp[i], v, 0.6) : damp(ring.amp[i], v, 7, dt);
    }
    ring.tex.needsUpdate = true;
    dropPulse = damp(dropPulse, 0, 2.5, dt);
    ring.mat.uniforms.uI.value = (0.42 + env.rms * 0.45 + dropPulse * 1.2 + (S.held ? 0.25 : 0)) * lightsOn;
    ring.circ.material.opacity = (0.35 + env.bass * 0.5 + dropPulse) * lightsOn;
    // cue marker + leader
    const show = hoverTrack >= 0 ? hoverTrack : (S.playing && secIdx === 1 ? S.track : -1);
    bandMarkers.forEach((m, k) => { m.material.opacity = damp(m.material.opacity, k === show && secIdx === 1 ? (hoverTrack === k ? 0.55 : 0.28) : 0, 7, dt); });
    const leaderOn = show >= 0 && secIdx === 1 && secBlend < 0.05 && !portrait();
    leader.classList.toggle('on', leaderOn);
    if (leaderOn) {
      const li = $$('.tracks li')[show].getBoundingClientRect();
      const b = BANDS[show], mid = (b.outer + b.inner) / 2;
      const w = proj(deck3.toWorld(L.cx + mid * 0.94, L.top, L.cz + mid * 0.34, _p3), _p3);
      const x0 = li.left - 8, y0 = li.top + li.height / 2;
      leaderPath.setAttribute('d', `M${x0},${y0} L${x0 - 36},${y0} L${w.x.toFixed(1)},${w.y.toFixed(1)}`);
      leaderDot.setAttribute('cx', w.x.toFixed(1)); leaderDot.setAttribute('cy', w.y.toFixed(1));
    }
  }

  // Room reacts
  woofer.value = env.bass * 0.8 + env.kick * 0.6 + (S.held ? Math.min(1, Math.abs(rate - 1)) * 0.15 * Math.sin(t * 60) : 0);
  const breathe = 1 + env.rms * 0.35 + env.kick * 0.08;
  key.intensity = LIGHTS.key * lerp(1, shot.key, S.intro) * lightsOn * (1 + Math.sin(t * 37) * Math.sin(t * 13.7) * 0.012) * (0.97 + env.kick * 0.05);
  counterSpots.forEach(s => { s.intensity = LIGHTS.counter * lightsOn; });
  wallWash.intensity = LIGHTS.wash * lightsOn * breathe;
  rim.intensity = LIGHTS.rim * lightsOn;
  streak.intensity = LIGHTS.streak * lightsOn * (0.9 + env.mid * 0.3) * shot.streak;
  fill.intensity = LIGHTS.fill * lightsOn * (0.4 + env.mid * 1.0 + env.kick * 0.4);
  hemi.intensity = 0.2 * (0.8 + env.rms * 0.4) * (0.3 + lightsOn * 0.7);
  touch.intensity = damp(touch.intensity, (grab.hover || S.held) && !coarse ? (S.held ? 0.03 : 0.018) : 0, 8, dt);
  if (room) {
    const n = room.neon;
    const buzz = neonOn * (0.94 + 0.06 * Math.sin(t * 120) * Math.sin(t * 7.3) + env.kick * 0.12);
    n.mat.color.copy(n.base).multiplyScalar(buzz);
    n.halo.opacity = neonOn * (0.8 + env.bass * 0.4);
    n.light.intensity = 1.3 * buzz * (0.8 + env.mid * 0.6);
    for (const tb of room.tubes) {
      const f = tubeWarm * (0.9 + 0.1 * Math.sin(t * (3 + tb.phase) + tb.phase) + env.rms * 0.35);
      tb.fil.color.copy(tb.base).multiplyScalar(f);
      tb.glow.opacity = 0.4 * f;
    }
    room.ampLight.intensity = 0.28 * tubeWarm * (1 + env.rms * 0.6);
    room.shelfGlow.value = lightsOn * (0.8 + env.rms * 0.5 + env.kick * 0.12);
    room.ledMat.color.copy(room.ledBase).multiplyScalar(lightsOn * (0.9 + env.kick * 0.25));
    vuState.v = damp(vuState.v, clamp(env.rms * 1.4 + env.kick * 0.25), 7, dt);
    room.vuNeedle.rotation.z = lerp(0.85, -0.75, vuState.v);
  }
  if (dust) {
    const u = dust.uniforms;
    u.uTime.value = t; u.uLPos.value.copy(key.position);
    u.uLDir.value.copy(key.target.position).sub(key.position).normalize();
    u.uCos.value = Math.cos(key.angle * 0.98);
    u.uPow.value = lightsOn; u.uKick.value = env.kick; u.uEnergy.value = env.rms; u.uAxis.value.copy(RC);
  }

  // Projected UI: scratch zone and hint ring follow the record on screen
  if (deck3) {
    const c = proj(RC, _p0);
    const ex = proj(_p1.copy(RC).add(tmp.set(recR, 0, 0)), _p1);
    const ez = proj(_p2.copy(RC).add(tmp.set(0, 0, recR)), _p2);
    const ex2 = proj(_p3.copy(RC).add(tmp.set(-recR, 0, 0)), _p3);
    const rx = Math.max(Math.hypot(ex.x - c.x, ex.y - c.y), Math.hypot(ex2.x - c.x, ex2.y - c.y));
    const ry = Math.abs(ez.y - c.y);
    const zoneOn = ie > 0.72 && (secIdx === 0 || secIdx === 1 || secIdx === SECTIONS.length - 1) && rx > 70 && c.z < 1 && secBlend < 0.08;
    scratchEl.classList.toggle('on', zoneOn || S.held);
    if (zoneOn || S.held) {
      const w = rx * 2.1, h = Math.max(ry, rx * 0.25) * 2.1;
      scratchEl.style.transform = `translate3d(${(c.x - w / 2).toFixed(1)}px, ${(c.y - h / 2).toFixed(1)}px, 0)`;
      scratchEl.style.width = `${w.toFixed(0)}px`; scratchEl.style.height = `${h.toFixed(0)}px`;
    }
    const hintOn = zoneOn && secIdx === 0 && !S.scratched && S.intro > 0.75;
    hintEl.classList.toggle('on', hintOn);
    chipEl.classList.toggle('on', hintOn);
    if (hintOn) {
      const sx = rx * 1.12 / 92, sy = Math.max(ry, 1) * 1.12 / 92;
      hintEl.style.transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
      const cw = chipEl.offsetWidth || 180;
      const pm = portrait();
      const cx = pm ? c.x - cw / 2 : clamp(c.x + rx * 0.35, 10, innerWidth - cw - 10), cy = pm ? c.y + ry * 0.2 : Math.min(innerHeight - 120, c.y + ry * 1.2 + 26);
      chipEl.style.transform = `translate3d(${cx.toFixed(0)}px, ${cy.toFixed(0)}px, 0)`;
    }
  }
  heroFade = damp(heroFade, secIdx === 0 ? 1 : 0, 6, dt);
  heroEl.style.opacity = heroFade.toFixed(3);
}
const fakeSpec = new Float32Array(SPEC.length);

// ─── Catalogue sleeves ────────────────────────────────────────────────────────
$$('.sleeve').forEach(el => {
  el.querySelector('.sl-cover').style.backgroundImage = `url(${BASE}img/lowfreq/${el.dataset.img}.webp)`;
  const art = el.querySelector('.sl-art');
  el.addEventListener('pointermove', e => {
    const r = art.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    gsap.to(art, { rotateY: x * 22, rotateX: -y * 16, z: 30, duration: 0.6, ease: 'power3.out' });
    art.style.setProperty('--glare', (0.45 + x * 0.6).toFixed(2));
  });
  el.addEventListener('pointerleave', () => gsap.to(art, { rotateY: 0, rotateX: 0, z: 0, duration: 1.1, ease: 'elastic.out(1, 0.5)' }));
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
worldNav('lowfreq', { theme: 'dark', corner: 'bl' });
const cur = cursor({ color: '#eadcff', blend: 'normal', size: 30 });
magnetic();
smoothScroll({ lerp: 0.08 });
$$('.title .line').forEach(l => { const s = document.createElement('span'); while (l.firstChild) s.appendChild(l.firstChild); l.appendChild(s); });

const T0 = performance.now();
await build();
const T1 = performance.now();
measure();
updateUI();
engine.onTick(tick);
engine.onTick(() => { if (!Q.has('norefl')) reflection.update(scene, camera); });
// compile everything with the lights on so nothing hitches later
lightsOn = 1; tubeWarm = 1; neonOn = 1; S.intro = 1;
tick(0.016, 0);
// compile against an HDR target: the scene is always drawn into the composer's buffers, and programs are keyed on output colour space
renderer.setRenderTarget(engine.post.composer.inputBuffer);
try { await renderer.compileAsync(scene, camera); } catch { renderer.compile(scene, camera); }
renderer.setRenderTarget(null);
const T2 = performance.now();
if (Q.has('debug')) console.warn('timing', { assetsAndBuild: Math.round(T1 - T0), compile: Math.round(T2 - T1), sinceNav: Math.round(T2) });
lightsOn = 0; tubeWarm = 0; neonOn = 0; S.intro = 0;
engine.start();
// let the first frames (post-processing programs, shadow maps) compile behind the loader
await new Promise(r => { let n = 0; const f = () => (++n > 3 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
if (Q.has('debug')) console.warn('timing', { firstFrames: Math.round(performance.now() - T2) });
await loader.finish();
reveal('.sec h2', { type: 'lines', stagger: 0.08 });
reveal('.lede', { type: 'lines', stagger: 0.05, y: '100%' });
for (const [sel, trig] of [['.tracks li', '.tracks'], ['.bar-grid article', '.bar-grid'], ['.stats > div', '.stats'], ['.sleeve', '.sleeves'], ['.tier', '.tiers'], ['.foot-cols > p', '.foot-cols']]) {
  gsap.from(sel, { opacity: 0, y: 36, duration: 1.1, ease: 'power3.out', stagger: 0.08, scrollTrigger: { trigger: trig, start: 'top 88%', once: true } });
}
addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.target.closest('input, textarea, button, a')) return;
  e.preventDefault(); togglePlay();
});

// Intro: valves warm, neon stutters on, the pendant fades up, camera settles on the record, platter spins up.
const intro = gsap.timeline();
intro.to(S, { intro: 1, duration: Q.has('fast') ? 0.01 : 3.4, ease: 'power3.inOut' }, 0)
  .to({ v: 0 }, { v: 1, duration: 2.6, ease: 'power1.in', onUpdate() { tubeWarm = this.targets()[0].v; } }, 0)
  .to({ v: 0 }, { v: 1, duration: 1.5, ease: 'power2.out', onUpdate() { lightsOn = this.targets()[0].v; } }, 0.3)
  .add(() => { S.motor = true; }, 0.9)
  .add(() => {
    const seq = [0.8, 0, 1, 0.2, 0, 1];
    seq.forEach((v, k) => setTimeout(() => { neonOn = v; }, k * 90));
  }, 0.7);
gsap.from('.title .line > span', { yPercent: 105, duration: 1.6, ease: 'expo.out', stagger: 0.12, delay: 1.7 });
gsap.from('.hero .eyebrow, .hero .sub, .hero-cta, .nav, .player, .hero-meta, .vert', { opacity: 0, y: 16, duration: 1.3, ease: 'power3.out', stagger: 0.07, delay: 2.1 });

// Press the whole side in the background (offline rendering, no gesture needed).
setTimeout(() => {
  audio.prerender(() => deck3.grooves.userData.fill(audio.env)).catch(e => console.warn('audio render failed', e));
}, 600);

window.__lf = { S, arm, audio, play, pause, deck: () => deck3, K, camera, shot };
if (Q.has('debug')) Object.assign(window, { THREE, scene });
