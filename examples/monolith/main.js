import { Engine, THREE, normalize, prepModel, damp, clamp, smooth, lerp } from '../../src/core/engine.js';
import { Assets, firstMesh } from '../../src/core/assets.js';
import { Pointer } from '../../src/core/input.js';
import { smoothScroll, gsap, reveal } from '../../src/core/scroll.js';
import { preloader, cursor, magnetic, worldNav } from '../../src/core/ui.js';
import { sunAngles, compassDir, palette, makePalette, phaseName, fmtTime, T0, T1, SUNRISE, SUNSET } from './sun.js';
import { concreteTextures, floorTexture, patchModel, sectionOutline, GoldenGrade } from './materials.js';
import { buildDiagram } from './diagram.js';

const D = Math.PI / 180;
const Q = new URLSearchParams(location.search);
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;
const root = document.documentElement;

// ─── Engine ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gl');
let grade;
const engine = new Engine({
  canvas, fov: 26, near: 0.1, far: 600, dpr: 1.75, background: 0xecebe6,
  post: {
    ao: { aoRadius: 0.55, intensity: 1.7, distanceFalloff: 0.9 },
    bloom: { intensity: 0.75, luminanceThreshold: 2.0, luminanceSmoothing: 0.3, radius: 0.74 },
    tone: 'neutral',
    extra: () => [(grade = new GoldenGrade())],
    vignette: { offset: 0.45, darkness: 0.2 },
    noise: 0.03,
    ca: false,
  },
});
const { scene, camera, renderer } = engine;
renderer.localClippingEnabled = true;
scene.fog = new THREE.Fog(0xecebe6, 40, 170);

const assets = new Assets();
const pointer = new Pointer({ lambda: 8 });

// ─── Loader ────────────────────────────────────────────────────────────────────
const loaderEl = document.querySelector('.loader');
{
  const g = loaderEl.querySelector('.loader-ticks');
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI - (i / 12) * Math.PI, r0 = 110, r1 = i % 3 ? 104 : 100;
    g.insertAdjacentHTML('beforeend', `<line x1="${120 + Math.cos(a) * r0}" y1="${120 - Math.sin(a) * r0}" x2="${120 + Math.cos(a) * r1}" y2="${120 - Math.sin(a) * r1}"/>`);
  }
}
const loaderSun = loaderEl.querySelector('.loader-sun');
const loader = preloader({
  assets, el: loaderEl, minTime: 1500,
  onValue: v => {
    loaderEl.querySelector('.loader-pct').textContent = String(Math.round(v * 100)).padStart(2, '0') + '%';
    const a = Math.PI - v * Math.PI * 0.5;
    loaderSun.setAttribute('cx', (120 + Math.cos(a) * 110).toFixed(1));
    loaderSun.setAttribute('cy', (120 - Math.sin(a) * 110).toFixed(1));
  },
  exit: () => gsap.to(loaderEl, { autoAlpha: 0, duration: 1.1, ease: 'power2.inOut' }),
});

// ─── Sky ───────────────────────────────────────────────────────────────────────
const skyUniforms = {
  uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uBounce: { value: new THREE.Color() },
  uSunCol: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunI: { value: 0 }, uGlow: { value: 0 },
  uMoonDir: { value: new THREE.Vector3() }, uMoon: { value: 0 }, uGain: { value: 1 }, uBelt: { value: 0 },
};
const SKY_VS = 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }';
const SKY_FS = `
  uniform vec3 uZen, uHor, uGround, uBounce, uSunCol, uSunDir, uMoonDir; uniform float uSunI, uGlow, uMoon, uGain, uBelt; varying vec3 vDir;
  void main(){
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHor, uZen, pow(clamp(h, 0., 1.), 0.42));
    float cs = max(dot(d, uSunDir), 0.);
    float hz = exp(-abs(h) * 5.0);
    col += uSunCol * (pow(cs, 5.) * 0.42 * hz + pow(cs, 48.) * 0.3 + pow(max(dot(d, uSunDir) * 0.5 + 0.5, 0.), 3.) * 0.16 * hz) * uGlow;
    // Belt of Venus: a pink band opposite the low sun, with the earth's blue shadow beneath it.
    vec3 sflat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-5);
    float anti = 0.5 + 0.5 * dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), -sflat);
    float band = smoothstep(0.015, 0.07, h) * (1.0 - smoothstep(0.09, 0.3, h));
    col = mix(col, vec3(0.96, 0.64, 0.55) * (0.55 + 0.45 * length(uHor)), band * anti * uBelt * 0.18);
    col = mix(col, uZen * 0.9, (1.0 - smoothstep(0.0, 0.035, h)) * smoothstep(-0.01, 0.0, h) * anti * uBelt * 0.2);
    float cm = max(dot(d, uMoonDir), 0.);
    col += vec3(0.5, 0.6, 0.9) * pow(cm, 90.) * 0.06 * uMoon;
  #ifdef ENV
    col = mix(col, uBounce, 1.0 - smoothstep(-0.14, 0.03, h));
    col += uSunCol * uSunI * smoothstep(0.9993, 0.9998, cs) * 14.;
  #else
    col = mix(col, uGround, 1.0 - smoothstep(-0.03, 0.06, h));
    col *= uGain;
  #endif
    gl_FragColor = vec4(col, 1.);
  }`;
const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 64, 32),
  new THREE.ShaderMaterial({ uniforms: skyUniforms, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false }));
sky.renderOrder = -10;
sky.frustumCulled = false;
scene.add(sky);

// Environment lighting re-baked from the same sky whenever the sun moves.
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24),
  new THREE.ShaderMaterial({ uniforms: skyUniforms, vertexShader: SKY_VS.replace('p.xyww', 'p'), fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, defines: { ENV: 1 } })));
const cubeRT = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType });
const cubeCam = new THREE.CubeCamera(0.1, 50, cubeRT);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
function bakeEnv() {
  cubeCam.update(renderer, envScene);
  envRT = pmrem.fromCubemap(cubeRT.texture, envRT);
  scene.environment = envRT.texture;
}

// Stars, only after dark.
const stars = (() => {
  const N = 7000, pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const u = Math.random(), v = Math.random() * 0.96 + 0.04;
    const th = u * Math.PI * 2, y = Math.pow(v, 1.9);
    const r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(th) * r * 280, y * 280, Math.sin(th) * r * 280], i * 3);
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uA: { value: 0 }, uT: { value: 0 }, uDpr: { value: 1 } },
    vertexShader: `attribute float seed; uniform float uT, uDpr; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv;
        float big = step(0.985, seed); float tw = 0.65 + 0.35 * sin(uT * (1.2 + seed * 3.) + seed * 60.);
        vA = (0.35 + 0.65 * pow(fract(seed * 13.7), 2.)) * tw * (1. + big * 2.5) * smoothstep(0.0, 0.06, position.y / 280.);
        gl_PointSize = (1.1 + big * 1.6 + fract(seed * 7.1)) * uDpr; }`,
    fragmentShader: `uniform float uA; varying float vA; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .1, d);
      gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a * vA * uA * 2.2, 1.); }`,
  });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false; p.renderOrder = -9;
  scene.add(p);
  engine.onResize((w, h, dpr) => { mat.uniforms.uDpr.value = dpr; });
  return mat;
})();

// Moon: a small disc in the south-east sky with a soft halo.
const MOON_DIR = compassDir(128 * D, 24 * D, new THREE.Vector3());
const MOON_COL = new THREE.Color(0.55, 0.66, 1);
function discTexture(inner, outer, soft = false) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  if (soft) { grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(inner, 'rgba(255,255,255,.35)'); grd.addColorStop(outer, 'rgba(255,255,255,.06)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); }
  else { grd.addColorStop(0, '#fff'); grd.addColorStop(inner, '#fff'); grd.addColorStop(outer, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); }
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture(0.42, 0.5), color: new THREE.Color(2.2, 2.3, 2.6), transparent: true, depthWrite: false, fog: false }));
moon.scale.setScalar(5.2);
moon.position.copy(MOON_DIR).multiplyScalar(250);
const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture(0.08, 0.35, true), color: new THREE.Color(0.35, 0.42, 0.7), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
moonHalo.scale.setScalar(46);
moonHalo.position.copy(moon.position);
moon.renderOrder = moonHalo.renderOrder = -8;
scene.add(moon, moonHalo);

// ─── Light ─────────────────────────────────────────────────────────────────────
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const SH = 4.6;
Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 0.5, far: 110 });
sun.shadow.bias = -0.00012;
sun.shadow.normalBias = 0.018;
sun.shadow.radius = 2;
sun.shadow.autoUpdate = false;
scene.add(sun, sun.target);

// ─── Plinth & floor ────────────────────────────────────────────────────────────
const PH = 1.25;                // plinth height; its top is y = 0, the floor is y = -PH
const conc = concreteTextures(renderer);
const plinthMat = new THREE.MeshStandardMaterial({ map: conc.map, normalMap: conc.normal, roughnessMap: conc.rough, roughness: 1, metalness: 0,
  normalScale: new THREE.Vector2(1, 1), envMapIntensity: 1 });
const floorMat = new THREE.MeshStandardMaterial({ color: '#dedad2', map: floorTexture(renderer), roughness: 0.6, metalness: 0, envMapIntensity: 1.35 });
floorMat.map.repeat.set(26, 26);
const floor = new THREE.Mesh(new THREE.CircleGeometry(290, 96), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -PH;
floor.receiveShadow = true;
scene.add(floor);

function worldUVBox(w, h, d, tile) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i) + h / 2, z = p.getZ(i);
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    if (nx > 0.5) uv.setXY(i, z / tile, y / tile);
    else if (ny > 0.5) uv.setXY(i, x / tile, z / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  return g;
}

// ─── Night lights ──────────────────────────────────────────────────────────────
const warmA = new THREE.PointLight(0xffb06a, 0, 5.5, 2);
const warmB = new THREE.PointLight(0xffa860, 0, 5, 2);
const poolLight = new THREE.PointLight(0x39d8ff, 0, 3.6, 2);
scene.add(warmA, warmB, poolLight);

// ─── Palette state ─────────────────────────────────────────────────────────────
const pal = makePalette();
const U = patchModel.uniforms;          // shared uniforms for the model shader patch
engine.onResize((w, h, dpr) => { U.uPx.value = dpr; });
const sunDir = new THREE.Vector3(), lightDir = new THREE.Vector3();
let dc = new THREE.Vector3();          // diagram centre (plinth top centre)
let diagram = null, model = null;
const cutLines = {};

// ─── Model ─────────────────────────────────────────────────────────────────────
const rawToWorld = (x, y, z) => model.localToWorld(new THREE.Vector3(x, y, z));
const load = assets.gltf('models/monolith/house.glb').then(g => {
  model = g.scene;
  model.rotation.y = Math.PI;
  normalize(model, 4);
  prepModel(model, renderer, { env: 1, onMat: m => patchModel(m) });
  scene.add(model);
  model.updateMatrixWorld(true);
  U.uWorldToRaw.value.copy(model.matrixWorld).invert();

  // Footprint of the rock base -> plinth.
  const mesh = firstMesh(model);
  const pa = mesh.geometry.attributes.position, v = new THREE.Vector3();
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < pa.count; i += 3) {
    v.fromBufferAttribute(pa, i).applyMatrix4(mesh.matrixWorld);
    if (v.y > 0.05) continue;
    x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z);
  }
  const m = 0.1;
  const pw = x1 - x0 + m * 2, pd = z1 - z0 + m * 2;
  const plinth = new THREE.Mesh(worldUVBox(pw, PH, pd, 4.8), plinthMat);
  plinth.position.set((x0 + x1) / 2, -PH / 2, (z0 + z1) / 2);
  plinth.castShadow = plinth.receiveShadow = true;
  scene.add(plinth);
  dc.set((x0 + x1) / 2, 0, (z0 + z1) / 2);

  warmA.position.copy(rawToWorld(-0.12, 0.45, 0.24));
  warmB.position.copy(rawToWorld(0.02, 0.24, 0.2));
  poolLight.position.copy(rawToWorld(0.33, 0.2, -0.31));

  diagram = buildDiagram({ scene, center: dc, sunAngles, compassDir, T0, T1 });
  // The cut lines of the two drawings (plan at +38.10, section A–A), traced once from the mesh.
  cutLines.plan = sectionOutline(mesh, new THREE.Vector3(0, -1, 0), rawToWorldY(0.5), { width: 1.6 });
  cutLines.sect = sectionOutline(mesh, new THREE.Vector3(1, 0, 0), -rawToWorldX(0.22), { width: 2.2 });
  scene.add(cutLines.plan, cutLines.sect);
  engine.onResize((w, h) => { for (const l of Object.values(cutLines)) l.material.resolution.set(w, h); });
  buildAnchors();
});

// ─── Scroll keyframes ──────────────────────────────────────────────────────────
// az/el in degrees around the diorama; sx/sy shift the frame (fraction of the viewport).
const KF = {
  hero:       { msy: -0.08, az: 16, el: 12, dist: 15, t: [0, 1.0, 0], sx: 0.2, sy: 0.03, time: 13.3, diag: 1, plan: 0, sect: 0 },
  works:      { az: -34, el: 15, dist: 18.5, t: [0, 0.7, 0], sx: 0.24, sy: 0.0, time: 14.6, diag: 0.5, plan: 0, sect: 0 },
  cliffIntro: { az: 52, el: 21, dist: 16.5, t: [0, 0.8, 0], sx: 0.2, sy: 0.02, time: 16.2, diag: 0.7, plan: 0, sect: 0 },
  plan:       { msy: 0.17, az: 0, el: 89.2, dist: 14.8, fov: 15, t: [0.05, 0.6, -0.2], sx: 0.19, sy: 0.0, time: 17.3, diag: 1, plan: 1, sect: 0 },
  section:    { msy: 0.15, az: -90, el: 1.5, dist: 10.6, fov: 14, t: [0, 1.3, 0.15], sx: -0.18, sy: 0.02, time: 18.3, diag: 0.14, plan: 0, sect: 1 },
  detail:     { msy: 0.14, az: 20, el: 17, dist: 6.6, t: [-0.8, 1.2, 0.65], sx: 0.16, sy: 0.0, time: 19.3, diag: 0, plan: 0, sect: 0 },
  principles: { az: 64, el: 12, dist: 18, t: [0, 0.8, 0], sx: -0.24, sy: 0.02, time: 19.95, diag: 0.6, plan: 0, sect: 0 },
  studio:     { msy: -0.02, az: -26, el: 8, dist: 18.5, t: [0, 0.8, 0], sx: -0.3, sy: 0.02, time: 21.32, diag: 0.45, plan: 0, sect: 0 },
  contact:    { az: 16, el: 6, dist: 18.5, t: [0, 0.6, 0], sx: 0.18, sy: -0.2, time: 22.2, diag: 0.5, plan: 0, sect: 0 },
  footer:     { msy: 0.26, az: 30, el: 11, dist: 30, t: [0, 0.4, 0], sx: 0.0, sy: 0.3, time: 22.6, diag: 0.25, plan: 0, sect: 0 },
};
let anchorsY = [];
function measure() {
  anchorsY = [...document.querySelectorAll('[data-k]')].map(el => {
    const r = el.getBoundingClientRect();
    const top = r.top + scrollY;
    const y = el.dataset.k === 'hero' ? 0 : top + r.height / 2 - innerHeight / 2;
    return { k: el.dataset.k, y: Math.max(0, y), kf: KF[el.dataset.k] };
  }).sort((a, b) => a.y - b.y);
  const max = document.documentElement.scrollHeight - innerHeight;
  anchorsY[anchorsY.length - 1].y = Math.min(anchorsY[anchorsY.length - 1].y, max);
}
addEventListener('resize', measure);
const cur = { msy: -0.05, az: 16, el: 12, dist: 15, fov: 26, t: new THREE.Vector3(0, 1.0, 0), sx: 0.2, sy: 0.03, time: 13.3, diag: 1, plan: 0, sect: 0 };
const goal = { ...cur, t: new THREE.Vector3() };
let activeK = 'hero', activeW = 1, hoverSelf = false;
function sampleScroll(y) {
  let i = 0;
  while (i < anchorsY.length - 2 && y > anchorsY[i + 1].y) i++;
  const A = anchorsY[i], B = anchorsY[i + 1] ?? A;
  const f = B.y > A.y ? clamp((y - A.y) / (B.y - A.y)) : 0;
  const e = smooth(0.18, 0.82, f);
  const a = A.kf, b = B.kf;
  for (const k of ['az', 'el', 'dist', 'sx', 'sy', 'time', 'diag', 'plan', 'sect']) goal[k] = lerp(a[k], b[k], e);
  goal.fov = lerp(a.fov ?? 26, b.fov ?? 26, e);
  goal.msy = lerp(a.msy ?? -0.05, b.msy ?? -0.05, e);
  goal.t.set(lerp(a.t[0], b.t[0], e), lerp(a.t[1], b.t[1], e), lerp(a.t[2], b.t[2], e));
  if (hoverSelf) goal.diag = 1;
  activeK = e < 0.5 ? A.k : B.k;
  activeW = e < 0.5 ? 1 - e * 2 : e * 2 - 1;
}

// ─── Time of day: scroll, drag, bar, keys ──────────────────────────────────────
let clockT = 5.6;              // what is rendered
let introTween = null;
let userT = null, userScroll = 0, dragging = false, introT = null;
let coastV = 0, lastSet = { t: 0, at: 0 };
const setUser = t => {
  userT = clamp(t, T0, T1); userScroll = scrollY; document.body.classList.add('has-dragged');
  const now = performance.now() / 1000;
  if (dragging && now - lastSet.at < 0.2) coastV = lerp(coastV, (userT - lastSet.t) / Math.max(now - lastSet.at, 1 / 120), 0.35);
  lastSet = { t: userT, at: now };
};

// Arc samples for picking.
const ARC = [];
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmpC = new THREE.Color();
function arcPoint(t, out) { return diagram.handlePos(t, out); }
function pickArc(px, py, around = null) {
  let best = null, bd = 1e9;
  const w = innerWidth, h = innerHeight;
  let prev = null;
  for (const s of ARC) {
    if (around !== null && Math.abs(s.t - around) > 2.2) { prev = null; continue; }
    tmp.copy(s.p).project(camera);
    const x = (tmp.x + 1) / 2 * w, y = (1 - tmp.y) / 2 * h;
    if (tmp.z > 1) { prev = null; continue; }
    if (prev) {
      const dx = x - prev.x, dy = y - prev.y, L = dx * dx + dy * dy || 1;
      const u = clamp(((px - prev.x) * dx + (py - prev.y) * dy) / L);
      const qx = prev.x + dx * u, qy = prev.y + dy * u, d = (px - qx) ** 2 + (py - qy) ** 2;
      if (d < bd) { bd = d; best = lerp(prev.t, s.t, u); }
    }
    prev = { x, y, t: s.t };
  }
  return { t: best, d: Math.sqrt(bd) };
}
function handleScreen(out) {
  arcPoint(clockT, tmp2).project(camera);
  out.x = (tmp2.x + 1) / 2 * innerWidth; out.y = (1 - tmp2.y) / 2 * innerHeight; out.vis = tmp2.z < 1;
  return out;
}
const hs = { x: 0, y: 0, vis: false };
let touchStart = null;
canvas.addEventListener('pointerdown', e => {
  if (!diagram || e.button !== 0) return;
  if (e.pointerType === 'touch') { touchStart = { x: e.clientX, y: e.clientY, t: userT ?? clockT, on: false }; return; }
  const pick = pickArc(e.clientX, e.clientY);
  if (pick.t === null) return;
  stopPlay();
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
  setUser(pick.t);
  curs?.set('drag', fmtTime(pick.t));
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch' && touchStart) {
    const dx = e.clientX - touchStart.x, dy = e.clientY - touchStart.y;
    if (!touchStart.on && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) touchStart.on = true;
    if (touchStart.on) { if (!dragging) stopPlay(); dragging = true; setUser(touchStart.t + dx / innerWidth * 11); }
    return;
  }
  if (dragging) {
    const pick = pickArc(e.clientX, e.clientY, userT);
    if (pick.t !== null) setUser(pick.t);
    curs?.set('drag', fmtTime(userT));
  } else if (diagram && !IS_TOUCH) {
    const near = Math.hypot(e.clientX - hs.x, e.clientY - hs.y) < 46 && hs.vis;
    const onArc = !near && pickArc(e.clientX, e.clientY).d < 22;
    curs?.set(near ? 'drag' : onArc ? 'label' : '', near ? 'Drag' : onArc ? 'Place' : '');
  }
});
const endDrag = () => { if (dragging) { dragging = false; curs?.set(''); if (performance.now() / 1000 - lastSet.at > 0.12) coastV = 0; coastV = clamp(coastV, -2.2, 2.2); } touchStart = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// Day bar.
const bar = document.querySelector('.daybar');
const knob = bar.querySelector('.daybar-knob');
{
  const ticks = bar.querySelector('.daybar-ticks');
  for (let h = 6; h <= 22; h++) {
    const x = ((h - T0) / (T1 - T0) * 100).toFixed(3);
    ticks.insertAdjacentHTML('beforeend', `<i class="${h % 3 ? '' : 'major'}" style="left:${x}%"></i>`);
    if (h % 3 === 0) ticks.insertAdjacentHTML('beforeend', `<span style="left:${x}%">${String(h).padStart(2, '0')}</span>`);
  }
  for (const [t, s] of [[SUNRISE, '↑'], [SUNSET, '↓']]) ticks.insertAdjacentHTML('beforeend', `<span class="ev" style="left:${((t - T0) / (T1 - T0) * 100).toFixed(3)}%">${s} ${fmtTime(t)}</span>`);
  // Gradient of the actual horizon colour through the day.
  const stops = [], p = makePalette();
  for (let i = 0; i <= 40; i++) { const t = T0 + (T1 - T0) * i / 40; palette(t, p); stops.push(`#${p.hor.getHexString(THREE.SRGBColorSpace)} ${(i / 40 * 100).toFixed(1)}%`); }
  bar.querySelector('.daybar-sky').style.background = `linear-gradient(90deg, ${stops.join(',')})`;
}
const barT = e => { const r = bar.getBoundingClientRect(); return T0 + clamp((e.clientX - r.left) / r.width) * (T1 - T0); };
bar.addEventListener('pointerdown', e => { stopPlay(); bar.setPointerCapture(e.pointerId); dragging = true; setUser(barT(e)); e.preventDefault(); });
bar.addEventListener('pointermove', e => { if (dragging && bar.hasPointerCapture(e.pointerId)) setUser(barT(e)); });
bar.addEventListener('pointerup', e => { dragging = false; coastV = 0; bar.releasePointerCapture(e.pointerId); });
bar.addEventListener('keydown', e => {
  const step = e.shiftKey ? 0.5 : 1 / 12;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { setUser((userT ?? clockT) + step); e.preventDefault(); }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { setUser((userT ?? clockT) - step); e.preventDefault(); }
});

// ─── HTML anchored to 3D ───────────────────────────────────────────────────────
const anchorsEl = document.querySelector('.anchors');
const TAGS = [
  { k: 'plan', raw: [-0.2, 0.36, 0.24], html: '<b>01</b>Living, 62 m²' },
  { k: 'plan', raw: [0.38, 0.1, -0.3], html: '<b>02</b>Pool, 18.0 × 3.2 m' },
  { k: 'plan', raw: [-0.38, 0.13, -0.3], html: '<b>03</b>Terrace, larch' },
  { k: 'plan', raw: [0.6, 0.36, 0.22], html: '<b>04</b>Studio' },
  { k: 'detail', raw: [0.77, 0.06, -0.3], html: 'Laminated glass, 19 mm' },
  { k: 'detail', raw: [0.3, 0.1, -0.46], html: 'Overflow edge, 6 mm' },
  { k: 'detail', raw: [0.55, -0.03, -0.44], html: 'Board-marked concrete' },
];
const LEVELS = [
  { k: 'section', raw: [0.2, 0.58, -0.2], html: '+38.10 &nbsp;Roof' },
  { k: 'section', raw: [0.2, 0.355, -0.2], html: '+34.60 &nbsp;Upper floor' },
  { k: 'section', raw: [0.2, 0.12, -0.2], html: '+31.20 &nbsp;Terrace &amp; pool' },
  { k: 'section', raw: [0.2, -0.49, -0.2], html: '±0.00 &nbsp;Atlantic' },
];
const tags = [];
function buildAnchors() {
  for (const a of TAGS) {
    const el = document.createElement('div'); el.className = 'tag'; el.innerHTML = `<i></i><span>${a.html}</span>`;
    anchorsEl.appendChild(el); tags.push({ ...a, el, p: rawToWorld(...a.raw), level: false });
  }
  for (const a of LEVELS) {
    const el = document.createElement('div'); el.className = 'level'; el.innerHTML = `<span>${a.html}</span>`;
    anchorsEl.appendChild(el); tags.push({ ...a, el, p: rawToWorld(...a.raw), level: true });
  }
}
function updateAnchors() {
  const w = innerWidth, h = innerHeight;
  for (const a of tags) {
    const on = activeK === a.k && activeW > 0.55;
    a.el.classList.toggle('on', on);
    tmp.copy(a.p).project(camera);
    const x = (tmp.x + 1) / 2 * w, y = (1 - tmp.y) / 2 * h;
    if (a.level) {
      const x0 = Math.max(18, w * 0.03);
      a.el.style.width = Math.max(0, x - x0) + 'px';
      a.el.style.transform = `translate3d(${x0.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      a.el.querySelector('span').style.cssText = 'left:0; right:auto';
    } else a.el.style.transform = `translate3d(${(x - 3.5).toFixed(1)}px, ${(y - 10).toFixed(1)}px, 0)`;
  }
}

// ─── Works: hover-reveal photographs ───────────────────────────────────────────
const reveal0 = document.querySelector('.work-reveal');
const revealIn = reveal0.querySelector('.work-reveal-in');
const revealCap = reveal0.querySelector('figcaption');
const IMG = n => `${import.meta.env.BASE_URL}img/monolith/${n}.webp`;
['stal', 'mertola', 'ulvik', 'lajes'].forEach(n => { const i = new Image(); i.src = IMG(n); });
const rv = { x: innerWidth / 2, y: innerHeight / 2 };
document.querySelectorAll('.work').forEach(li => {
  li.addEventListener('pointerenter', () => {
    if (!li.dataset.img) { reveal0.classList.remove('on'); document.body.classList.add('hover-self'); hoverSelf = true; return; }
    revealIn.style.backgroundImage = `url(${IMG(li.dataset.img)})`;
    revealCap.textContent = `${li.querySelector('.w-name').textContent} — ${li.querySelector('.w-year').textContent}`;
    reveal0.classList.add('on');
  });
  li.addEventListener('pointerleave', () => { reveal0.classList.remove('on'); document.body.classList.remove('hover-self'); hoverSelf = false; });
  li.addEventListener('click', () => { if (li.hasAttribute('data-self')) window.__lenis?.scrollTo('#cliff', { duration: 1.6 }); });
});

// Play the day: a fourteen-second time-lapse from wherever the sun is to full night.
const playBtn = document.querySelector('.play');
let playTween = null;
function stopPlay() { playTween?.kill(); playTween = null; playBtn.classList.remove('on'); }
playBtn.addEventListener('click', () => {
  if (playTween) { stopPlay(); return; }
  const from = (userT ?? clockT) > 22.2 ? T0 + 0.1 : (userT ?? clockT);
  const o = { v: from };
  userT = from; coastV = 0;
  playBtn.classList.add('on');
  playTween = gsap.to(o, { v: T1 - 0.05, duration: 14 * (T1 - from) / (T1 - T0), ease: 'none',
    onUpdate: () => { userT = o.v; clockT = o.v; }, onComplete: stopPlay });
  userScroll = scrollY;
  document.body.classList.add('has-dragged');
});

// ─── HUD & theme ───────────────────────────────────────────────────────────────
const hudSh = document.querySelector('.hud-sh');
const hudTime = document.querySelector('.hud-time'), hudAz = document.querySelector('.hud-az'), hudAlt = document.querySelector('.hud-alt'), hudPhase = document.querySelector('.hud-phase');
const tagEl = document.querySelector('.sun-tag'), tagTime = tagEl.querySelector('.sun-tag-time');
const clocks = [...document.querySelectorAll('.foot-clock')];
let lastStr = '', lastTheme = '';
const INK_D = [17, 17, 16], INK_L = [236, 235, 230];
function updateHud(altDeg, azDeg) {
  const s = fmtTime(clockT);
  if (s !== lastStr) {
    lastStr = s;
    hudTime.textContent = s; tagTime.textContent = s;
    hudAz.textContent = Math.round(azDeg) + '°';
    hudAlt.textContent = (altDeg < 0 ? '−' : '') + Math.abs(Math.round(altDeg)) + '°';
    hudPhase.textContent = phaseName(clockT, altDeg);
    hudSh.textContent = altDeg > 0.5 ? '×' + (1 / Math.tan(altDeg * D)).toFixed(altDeg > 20 ? 2 : 1) : '—';
    bar.setAttribute('aria-valuenow', clockT.toFixed(2)); bar.setAttribute('aria-valuetext', s);
    clocks.forEach(c => { c.textContent = `${fmtTime(clockT + +c.dataset.off)} — sun time`; });
  }
  knob.style.left = ((clockT - T0) / (T1 - T0) * 100).toFixed(2) + '%';
  const k = pal.ink;
  const ink = INK_D.map((d, i) => Math.round(lerp(d, INK_L[i], k))).join(' ');
  const hc = pal.hor.clone().convertLinearToSRGB();
  const paper = [hc.r, hc.g, hc.b].map(v => Math.round(clamp(v) * 255)).join(' ');
  const theme = ink + '|' + paper;
  if (theme !== lastTheme) {
    lastTheme = theme;
    root.style.setProperty('--ink-rgb', ink);
    root.style.setProperty('--paper-rgb', paper);
  }
}

// The type answers to the sun too: big headings cast a shadow away from the handle.
let lastShadow = '';
function castTypeShadow(altDeg) {
  const k = smooth(-1, 4, altDeg) * (1 - pal.ink);
  let css = 'none';
  if (k > 0.01 && hs.vis) {
    let dx = innerWidth * 0.3 - hs.x, dy = innerHeight * 0.4 - hs.y;
    const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const len = clamp(3 / Math.tan(Math.max(altDeg, 2) * D), 2, 26);
    css = `${(dx * len).toFixed(1)}px ${(dy * len).toFixed(1)}px ${(0.8 + len * 0.14).toFixed(1)}px rgb(var(--ink-rgb) / ${(0.15 * k * (1 - len / 70)).toFixed(3)})`;
  }
  if (css !== lastShadow) { lastShadow = css; root.style.setProperty('--type-shadow', css); }
}

// ─── Frame loop ────────────────────────────────────────────────────────────────
const camTarget = new THREE.Vector3();
const upV = new THREE.Vector3();
let lastEnv = -1, envFrames = 0, lastShadowT = -1;
const aspectFit = () => camera.aspect < 1 ? Math.pow(1.25 / camera.aspect, 0.85) : camera.aspect < 1.3 ? 1.2 : 1;
engine.onTick((dt, t) => {
  pointer.update(dt);
  if (!model) return;
  sampleScroll(window.__lenis?.scroll ?? scrollY);

  // Time: the intro, then the user's sun, then the scroll's. Scrolling away cuts the intro short.
  if (introT !== null && introTween && scrollY > innerHeight * 0.25) { introTween.kill(); introTween = null; clockT = introT; introT = null; }
  if (userT !== null && !dragging && Math.abs(scrollY - userScroll) > innerHeight * 0.55) { userT = null; coastV = 0; stopPlay(); }
  // Let a flung sun coast along its path.
  if (!dragging && userT !== null && Math.abs(coastV) > 0.02 && !playTween) {
    userT = clamp(userT + coastV * dt, T0, T1); coastV *= Math.exp(-3.2 * dt);
    if (userT <= T0 || userT >= T1) coastV = 0;
  } else if (!dragging) coastV = 0;
  const want = introT ?? userT ?? goal.time;
  clockT = introT !== null ? introT : playTween ? userT : damp(clockT, want, dragging ? 12 : Math.abs(coastV) > 0.02 ? 9 : 2.6, dt);

  // Camera.
  const lam = 3.2;
  for (const k of ['az', 'el', 'dist', 'fov', 'sx', 'sy', 'msy', 'diag', 'plan', 'sect']) cur[k] = damp(cur[k], goal[k], lam, dt);
  cur.t.x = damp(cur.t.x, goal.t.x, lam, dt); cur.t.y = damp(cur.t.y, goal.t.y, lam, dt); cur.t.z = damp(cur.t.z, goal.t.z, lam, dt);
  const narrow = camera.aspect < 0.9;
  const az = (cur.az + pointer.sx * 3) * D, el = clamp(cur.el + pointer.sy * 1.5, -5, 89.4) * D;
  // Narrow lenses for the drawings (plan, section): same framing, flatter perspective.
  if (Math.abs(camera.fov - cur.fov) > 1e-3) { camera.fov = cur.fov; camera.updateProjectionMatrix(); }
  const dist = cur.dist * aspectFit() * Math.tan(13 * D) / Math.tan(cur.fov / 2 * D);
  camTarget.copy(cur.t).add(dc);
  camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(camTarget);
  const top = smooth(70, 89, cur.el);
  camera.up.set(0, 1, 0).lerp(upV.set(-Math.sin(az), 0, -Math.cos(az)), top).normalize();
  camera.lookAt(camTarget);
  const sx = narrow ? 0 : cur.sx, sy = narrow ? cur.msy : cur.sy;
  const { w, h } = engine.size;
  camera.setViewOffset(w, h, -sx * w, sy * h, w, h);

  // Sun.
  const { alt, az: sAz } = sunAngles(clockT);
  compassDir(sAz, alt, sunDir);
  palette(clockT, pal);
  const altDeg = alt / D;
  const sunUp = smooth(-4, 1.5, altDeg), moonUp = smooth(-5, -11, altDeg);
  if (sunUp > 0.001) lightDir.copy(sunDir); else lightDir.copy(MOON_DIR);
  sun.position.copy(dc).addScaledVector(lightDir, 40).add(tmp.set(0, 0.6, 0));
  sun.target.position.copy(dc).add(tmp.set(0, 0.6, 0));
  sun.color.copy(sunUp > 0.001 ? pal.sun : MOON_COL);
  sun.intensity = pal.I * sunUp + 0.55 * moonUp;
  if (Math.abs(clockT - lastShadowT) > 0.0015 || sunUp * moonUp !== 0) { sun.shadow.needsUpdate = true; lastShadowT = clockT; }

  // Sky & environment.
  skyUniforms.uGain.value = lerp(1.0, 1.16, sunUp);
  skyUniforms.uZen.value.copy(pal.zen); skyUniforms.uHor.value.copy(pal.hor);
  const dusk = smooth(22, 4, Math.abs(altDeg)) * 0.55 + (altDeg < 0 ? 0.1 : 0);
  skyUniforms.uGround.value.copy(pal.hor).lerp(pal.zen, altDeg > 0 ? 0.05 : 0.05 + dusk * 0.4).multiplyScalar(lerp(0.98, altDeg > 0 ? 0.97 : 0.88, dusk));
  skyUniforms.uSunCol.value.copy(pal.sun); skyUniforms.uSunDir.value.copy(sunDir);
  skyUniforms.uSunI.value = pal.I * sunUp;
  skyUniforms.uGlow.value = smooth(28, 0, altDeg) * smooth(-9, -1, altDeg) * 1.3;
  skyUniforms.uMoonDir.value.copy(MOON_DIR); skyUniforms.uMoon.value = pal.stars;
  const bounce = Math.max(0, Math.sin(alt)) * pal.I * sunUp * 0.18 + smooth(25, 4, altDeg) * sunUp * 0.12;
  skyUniforms.uBounce.value.copy(skyUniforms.uGround.value).multiplyScalar(0.3).add(tmpC.copy(pal.sun).multiplyScalar(bounce));
  scene.environmentIntensity = pal.amb;
  skyUniforms.uBelt.value = smooth(6, -1, altDeg) * smooth(-8, -2, altDeg);
  scene.fog.color.copy(skyUniforms.uGround.value).multiplyScalar(skyUniforms.uGain.value);
  stars.uniforms.uA.value = pal.stars; stars.uniforms.uT.value = t;
  moon.material.opacity = moonHalo.material.opacity = pal.stars;
  moon.visible = moonHalo.visible = pal.stars > 0.01;
  if ((Math.abs(clockT - lastEnv) > 0.02 && ++envFrames % 2 === 0) || lastEnv < 0) { bakeEnv(); lastEnv = clockT; }

  // Night.
  U.uNight.value = pal.night;
  // Grade peaks from golden hour through sunset, off by blue hour.
  grade.weight = smooth(18.7, 19.4, clockT) * (1 - smooth(20.75, 21.2, clockT));
  U.uTime.value = t;
  engine.post.bloom.luminanceMaterial.threshold = lerp(2.0, 0.85, pal.night);
  warmA.intensity = pal.night * 7; warmB.intensity = pal.night * 5; poolLight.intensity = pal.night * 5;

  // Plan and section cuts (world space planes).
  const cutY = lerp(9, rawToWorldY(0.5), smooth(0, 1, cur.plan));
  U.uCutA.value.set(0, -1, 0, cutY);
  const cutX = lerp(-9, rawToWorldX(0.22), smooth(0, 1, cur.sect));
  U.uCutB.value.set(1, 0, 0, -cutX);
  patchModel.planes[0].set(new THREE.Vector3(0, -1, 0), cutY);
  patchModel.planes[1].set(new THREE.Vector3(1, 0, 0), -cutX);
  U.uPoche.value = Math.max(smooth(0.3, 0.9, cur.plan), smooth(0.3, 0.9, cur.sect));
  cutLines.plan.material.opacity = smooth(0.85, 0.99, cur.plan) * 0.95;
  cutLines.sect.material.opacity = smooth(0.85, 0.99, cur.sect) * 0.95;
  cutLines.plan.visible = cutLines.plan.material.opacity > 0.01;
  cutLines.sect.visible = cutLines.sect.material.opacity > 0.01;
  for (const l of Object.values(cutLines)) l.material.color.copy(U.uInk.value).multiplyScalar(0.8);
  U.uInk.value.setRGB(0.014, 0.013, 0.012).lerp(tmpC.setRGB(0.05, 0.055, 0.07), pal.ink);
  // Poché fills follow the light a little so they never glow at night.
  const fillK = lerp(1, 0.16, pal.ink) * lerp(0.9, 1.05, sunUp);
  U.uFillC.value.set('#8f8a82').multiplyScalar(fillK);
  U.uFillE.value.set('#b3ab9d').multiplyScalar(fillK);

  // Diagram.
  diagram.update({ clockT, altDeg, camera, opacity: cur.diag, ink: pal.ink, sunColor: pal.sun, t });
  handleScreen(hs);
  const showTag = hs.vis && introT === null && (narrow ? activeK === 'hero' : cur.diag > 0.4);
  tagEl.classList.toggle('on', showTag);
  if (hs.vis) {
    const tw = tagEl.offsetWidth + 16, flip = hs.x + tw > innerWidth - 12;
    tagEl.classList.toggle('flip', flip);
    tagEl.style.transform = `translate3d(${(flip ? hs.x - tw : hs.x + 16).toFixed(1)}px, ${(hs.y - 8).toFixed(1)}px, 0)`;
  }

  updateHud(altDeg, ((sAz / D) % 360 + 360) % 360);
  document.body.classList.toggle('hud-compact', activeK !== 'hero' || scrollY > innerHeight * 0.5);
  castTypeShadow(altDeg);
  updateAnchors();

  rv.x = damp(rv.x, pointer.px, 9, dt); rv.y = damp(rv.y, pointer.py, 9, dt);
  reveal0.style.transform = `translate3d(${(rv.x + 28).toFixed(1)}px, ${(rv.y - reveal0.offsetHeight * 0.55).toFixed(1)}px, 0) rotate(${clamp(pointer.vx * -2, -5, 5).toFixed(2)}deg)`;
});
const rawToWorldY = y => rawToWorld(0, y, 0).y;
const rawToWorldX = x => rawToWorld(x, 0, 0).x;

// ─── Boot ─────────────────────────────────────────────────────────────────────
worldNav('monolith', { theme: 'light', corner: 'br' });
const curs = cursor({ color: '#111110', blend: 'difference', size: 30 });
if (curs) curs.root.style.setProperty('--c', '#f2f0ea');
magnetic();
const lenis = smoothScroll({ lerp: 0.09 });
reveal('h2', { type: 'lines', stagger: 0.08 });
reveal('.step-card h3, .studio-lede, .contact-lede', { type: 'lines', stagger: 0.06 });

await load;
measure();
document.fonts?.ready.then(measure);
setTimeout(measure, 1600);
// In-page links glide with Lenis instead of jumping.
document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
  const id = a.getAttribute('href');
  const el = id === '#top' ? 0 : document.querySelector(id);
  if (el === null) return;
  e.preventDefault();
  lenis.scrollTo(el, { duration: 1.8, easing: t => 1 - Math.pow(1 - t, 4) });
}));
ARC.length = 0;
for (let t = T0; t <= T1 + 1e-6; t += 1 / 30) ARC.push({ t, p: arcPoint(t, new THREE.Vector3()) });
// Warm the GPU in the night state (all lights on) before revealing.
clockT = 22; U.uNight.value = 1;
bakeEnv();
renderer.compile(scene, camera);
clockT = 5.6;
engine.start();
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!Q.has('t') && !REDUCED) introT = 5.6;
await loader.finish();
if (Q.has('t')) { userT = +Q.get('t'); clockT = userT; }
else if (REDUCED) clockT = KF.hero.time;
else {
  // Sunrise over the house, then the day runs to the afternoon.
  introTween = gsap.to({ v: 5.6 }, { v: KF.hero.time, duration: 4.6, ease: 'power2.inOut', delay: 0.15,
    onUpdate() { introT = this.targets()[0].v; }, onComplete() { clockT = introT; introT = null; } });
}
gsap.from('.hero-title .line > span', { yPercent: 105, duration: 1.6, ease: 'expo.out', stagger: 0.1, delay: 0.5 });
gsap.from('.hero-meta, .hero-sub, .nav, .hud, .scroll-cue', { opacity: 0, y: 12, duration: 1.3, ease: 'power3.out', stagger: 0.07, delay: 1.0 });
// QA hooks (scripts/qa-monolith.mjs).
window.__mono = { setTime: v => { userT = v; clockT = v; userScroll = scrollY; }, get t() { return clockT; }, handle: () => ({ x: hs.x / innerWidth, y: hs.y / innerHeight }), arcAt: tt => { arcPoint(tt, tmp).project(camera); return { x: (tmp.x + 1) / 2, y: (1 - tmp.y) / 2 }; } };
