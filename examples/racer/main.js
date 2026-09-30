import { Engine, THREE, normalize, prepModel, damp, clamp, smooth, lerp, studioEnvironment } from '../../src/core/engine.js';
import { Assets } from '../../src/core/assets.js';
import { Pointer } from '../../src/core/input.js';
import { smoothScroll, gsap, reveal } from '../../src/core/scroll.js';
import { preloader, cursor, magnetic, worldNav } from '../../src/core/ui.js';
import { PlanarReflection } from '../../src/core/reflector.js';
import { VolumetricSpotEffect } from '../../src/core/volumetric.js';
import { bakeTexture } from '../../src/core/textures.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { DepthOfFieldEffect, BloomEffect, HueSaturationEffect } from 'postprocessing';
import {
  patchWetFloor, patchWallWash, wetMaterial, createRain, createSplashes, HeatHazeEffect,
  neonTextures, glowTexture, flameTexture, canvasTex, MAX_RAIN_LIGHTS, createSteam,
} from './fx.js';
import { EngineAudio } from './audio.js';
import { Tacho } from './tacho.js';

const D = Math.PI / 180;
const Q = new URLSearchParams(location.search);
const TOUCH = matchMedia('(pointer: coarse)').matches;
const MOBILE = innerWidth < 760;

// ─── World layout (metres). Bike nose points +X, exhaust side faces the street (+Z). ──
const WALL_Z = -2.3;
const SHUTTER = { x0: -9.8, x1: -5.6, top: 3.1, gap: 0.42 };
const SIGN = { x: 2.0, y: 1.52, w: 2.5 };
const BIKE_YAW = -22 * D;
const LAMP = new THREE.Vector3(-0.35, 3.75, WALL_Z + 0.26);
const CRATE = new THREE.Vector3(2.45, 0, -1.62);
// Cold fluorescent batten on the wall behind the tail: the cool counter-light to the neon.
const TUBE = new THREE.Vector3(-2.3, 2.35, WALL_Z + 0.1);
const TUBE_LEN = 1.5;
const BIKE_LEN = 2.05;
// Points on the bike, in the bike group's local space.
const HEAD_L = new THREE.Vector3(0.62, 0.915, 0);
const TIP_L = new THREE.Vector3(-0.74, 0.47, 0.19);
const TIP_DIR = new THREE.Vector3(-0.9, 0.42, 0).normalize();
const HEADS_L = new THREE.Vector3(0.1, 0.66, 0.12);

// Camera stations: orbit around a point of interest. az: 0 = street side (+Z), 90 = nose-on.
const STATIONS = {
  hero: { poi: [0.08, 0.52, 0], az: 6, el: -3.5, dist: 3.75, fov: 31, shift: [-0.14, 0.2], bokeh: 1.8, range: 1.4, vol: 1, mag: 0.9, sat: -0.06, fill: 1.1 },
  rev: { poi: [0.0, 0.55, 0], az: -45, el: 2, dist: 4.8, fov: 30, shift: [0.22, 0.12], bokeh: 1.6, range: 1.6, vol: 1, mag: 0.8, sat: -0.1 },
  buildhead: { poi: [0, 0.5, 0], az: -12, el: 9, dist: 5.6, fov: 30, shift: [0.52, 0.36], bokeh: 1.4, range: 2, vol: 0.8 },
  tank: { poi: [0.26, 0.84, 0.1], local: true, az: 22, el: 9, dist: 0.85, fov: 26, shift: [-0.3, 0.02], bokeh: 4, range: 0.22, vol: 0.1, mag: 0.4, sat: -0.3, fill: 1.6 },
  engine: { poi: [0.1, 0.56, 0.12], local: true, az: 10, el: 4, dist: 0.8, fov: 28, shift: [0.3, 0], bokeh: 4, range: 0.22, vol: 0.1, mag: 0.4, sat: -0.32, fill: 1.6 },
  seat: { poi: [-0.42, 0.82, 0.0], local: true, az: -35, el: 30, dist: 1.0, fov: 26, shift: [-0.3, 0], bokeh: 4, range: 0.25, vol: 0.1, mag: 0.4, sat: -0.28, fill: 1.6 },
  wheel: { poi: [0.68, 0.34, 0.06], local: true, az: 32, el: 3, dist: 1.2, fov: 28, shift: [0.3, 0], bokeh: 3.5, range: 0.3, vol: 0.14, mag: 0.45, sat: -0.28, fill: 1.5 },
  waitlist: { poi: [0.0, 0.55, 0], az: -52, el: 15, dist: 5.6, fov: 30, shift: [-0.36, 0], bokeh: 1.5, range: 2, vol: 0.8 },
  garage: { poi: [2.45, 0.66, -1.62], az: -8, el: 4, dist: 2.1, fov: 30, shift: [0.3, -0.05], bokeh: 3, range: 0.45, vol: 0.6 },
  quote: { poi: [2.0, 1.35, -2.2], az: 24, el: 3, dist: 5.2, fov: 30, shift: [-0.42, 0.22], bokeh: 2, range: 1, vol: 0.3 },
  foot: { poi: [0.4, 0.7, -0.6], az: 14, el: 9, dist: 11, fov: 32, shift: [0.2, 0.56], bokeh: 0.6, range: 4, vol: 1 },
};

// ─── Engine ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gl');
let vol, dof, bloom, haze, hueSat;
const engine = new Engine({
  canvas, fov: 30, near: 0.05, far: 140, dpr: MOBILE ? 1.25 : 1.5, background: 0x030304,
  post: {
    ao: { aoRadius: 0.55, intensity: 2.4, distanceFalloff: 0.6 },
    bloom: false,
    pre: cam => [
      (dof = new DepthOfFieldEffect(cam, { focusDistance: 5, focusRange: 1.8, bokehScale: 1.5, resolutionScale: 0.5 })),
      (bloom = new BloomEffect({ intensity: 1.2, luminanceThreshold: 0.62, luminanceSmoothing: 0.3, mipmapBlur: true, radius: 0.8, levels: 8 })),
      (vol = new VolumetricSpotEffect(cam, { density: 0.032, noise: 0.8, noiseScale: 2.2, maxDist: 24, floorY: 0, wind: new THREE.Vector3(0.15, -0.9, 0.05) })),
      (haze = new HeatHazeEffect()),
    ],
    tone: 'agx',
    extra: () => [(hueSat = new HueSaturationEffect({ saturation: 0 }))],
    vignette: { offset: 0.26, darkness: 0.74 },
    noise: 0.055,
    ca: false,
  },
});
const { scene, camera, renderer } = engine;
RectAreaLightUniformsLib.init();
scene.fog = new THREE.FogExp2(0x030305, 0.035);

scene.environment = studioEnvironment(renderer, {
  top: 0x0d0b14, bottom: 0x020203, blur: 0.03,
  panels: [
    { pos: [SIGN.x, SIGN.y, WALL_Z], size: [3, 0.9], intensity: 2.4, color: 0xff3b5c },
    { pos: [TUBE.x, TUBE.y, TUBE.z], size: [TUBE_LEN, 0.14], intensity: 9, color: 0xd6f2ff },
    { pos: [-5, 1.6, 3], size: [0.3, 2.6], intensity: 1.2, color: 0x9fe6ff },
    { pos: [LAMP.x, LAMP.y, LAMP.z], size: [0.7, 0.25], intensity: 14, color: 0xd6e2ff },
    { pos: [(SHUTTER.x0 + SHUTTER.x1) / 2, 0.22, WALL_Z], size: [4, 0.45], intensity: 3.5, color: 0xffa050 },
    { pos: [2.5, 3.4, 5.5], size: [6, 0.3], intensity: 2.2, color: 0xdfe6ff },
    { pos: [7, 2.2, 1], size: [0.35, 3.5], intensity: 1.1, color: 0x9fb0ff },
    { pos: [0, 12, 0], size: [16, 16], intensity: 0.1, color: 0x6b5a8e },
  ],
});
scene.environmentIntensity = 0.4;

const assets = new Assets();
const pointer = new Pointer({ lambda: 5 });

// ─── Loader ────────────────────────────────────────────────────────────────────
const loaderEl = document.querySelector('.loader');
const loader = preloader({
  assets, el: loaderEl, minTime: 1500,
  onValue: v => {
    loaderEl.querySelector('.loader-pct').textContent = Math.round(v * 100);
    loaderEl.style.setProperty('--p', (v * v * (Math.random() < 0.08 ? 0.5 : 1)).toFixed(3));
  },
  exit: async () => {
    loaderEl.style.setProperty('--p', 1);
    loaderEl.classList.add('buzz');
    await new Promise(r => setTimeout(r, 850));
    await gsap.to(loaderEl, { autoAlpha: 0, duration: 1.0, ease: 'power2.inOut' });
  },
});

// ─── Textures ──────────────────────────────────────────────────────────────────
const shared = { uTime: { value: 0 } };
const texP = Promise.all([
  assets.texture('img/racer/asphalt.webp'), assets.texture('img/racer/brick.webp'), assets.texture('img/racer/shutter.webp'),
  assets.texture('img/racer/workshop.webp'), assets.texture('img/racer/city.webp'),
]);
const fontP = Promise.race([
  Promise.all([document.fonts.load('300px Neonderthaw'), document.fonts.load('500 60px Inter'), document.fonts.load('40px Anton')]),
  new Promise(r => setTimeout(r, 4000)),
]);
const modelP = Promise.all([assets.gltf('models/racer/bike.glb'), assets.gltf('models/racer/helmet.glb')]);

/** Height-from-luminance normal map + roughness, baked on the GPU from a photo texture. */
function derive(src, { size = 1024, strength = 3, rough = '0.5' } = {}) {
  const u = { uSrc: { value: src }, uStr: { value: strength } };
  const lum = 'float L(vec2 uv){ return dot(texture2D(uSrc, uv).rgb, vec3(0.299, 0.587, 0.114)); }';
  const normal = bakeTexture(renderer, size, `
    uniform sampler2D uSrc; uniform float uStr; ${lum}
    void main(){
      float e = 1.0 / ${size.toFixed(1)};
      float hx = L(vUv + vec2(e, 0.)) - L(vUv - vec2(e, 0.));
      float hy = L(vUv + vec2(0., e)) - L(vUv - vec2(0., e));
      vec3 n = normalize(vec3(-hx * uStr, -hy * uStr, 1.0));
      gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
    }`, u);
  const roughness = bakeTexture(renderer, size, `
    uniform sampler2D uSrc; ${lum}
    void main(){ vec3 c = texture2D(uSrc, vUv).rgb; float l = L(vUv); float r = ${rough}; gl_FragColor = vec4(1.0, clamp(r, 0.03, 1.0), 0.0, 1.0); }`, u);
  return { normal, roughness };
}
const tile = (t, rx, ry, mirror = true) => {
  t.wrapS = t.wrapT = mirror ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
  t.repeat.set(rx, ry); t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
};

// ─── Build the street ─────────────────────────────────────────────────────────
const reflection = new PlanarReflection(renderer, { resolution: MOBILE ? 0.4 : 0.5 });
engine.onResize((w, h, dpr) => reflection.setSize(w, h, dpr));
const neon = { level: 0, flick: 0, crackle: 0, target: 1 };
const washLevel = { value: 0 };
const garageWash = { value: 0.9 };
let floor, floorU, neonMats = {}, splashes, rain, steam;
const lights = {};

async function buildWorld() {
  const [asphalt, brick, shutterTex, workshop, city] = await texP;
  await fontP;

  // Wet asphalt with puddles.
  const puddle = bakeTexture(renderer, 512, `void main(){ float n = fbm(vUv * 5.0, 5.0, 6, 0.55) * 0.5 + 0.5; gl_FragColor = vec4(vec3(n), 1.0); }`);
  puddle.wrapS = puddle.wrapT = THREE.RepeatWrapping;
  shared.puddle = puddle;
  const ad = derive(asphalt, { size: 1024, strength: 2.2, rough: '0.14 + smoothstep(0.02, 0.2, l) * 0.34 + (fbm(vUv * 6.0, 6.0, 4, 0.5)) * 0.12' });
  const AR = 1 / 2.6; // one asphalt tile per 2.6 m
  const floorMat = new THREE.MeshStandardMaterial({
    map: tile(asphalt, 90 * AR, 44 * AR), normalMap: tile(ad.normal, 90 * AR, 44 * AR), roughnessMap: tile(ad.roughness, 90 * AR, 44 * AR),
    normalScale: new THREE.Vector2(0.9, 0.9), roughness: 1, metalness: 0, envMapIntensity: 0.14, color: 0x5a5a60,
  });
  floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 44), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(-15, 0, WALL_Z + 22);
  floor.receiveShadow = true;
  scene.add(floor);
  reflection.hidden.push(floor);
  floorU = patchWetFloor(floorMat, reflection, shared);

  // Brick wall with an opening for the shutter.
  const bd = derive(brick, { size: 1024, strength: 4.5, rough: '0.62 - smoothstep(0.02, 0.12, l) * 0.2 - smoothstep(0.35, 0.9, fbm(vec2(vUv.x * 18.0, vUv.y * 1.5), 18.0, 4, 0.5) + 0.5) * 0.35' });
  const BR = 1 / 3.4;
  const wallShape = new THREE.Shape();
  wallShape.moveTo(-42, 0); wallShape.lineTo(9, 0); wallShape.lineTo(9, 12); wallShape.lineTo(-42, 12); wallShape.lineTo(-42, 0);
  const hole = new THREE.Path();
  hole.moveTo(SHUTTER.x0, 0); hole.lineTo(SHUTTER.x1, 0); hole.lineTo(SHUTTER.x1, SHUTTER.top); hole.lineTo(SHUTTER.x0, SHUTTER.top); hole.lineTo(SHUTTER.x0, 0);
  wallShape.holes.push(hole);
  const wallMat = new THREE.MeshStandardMaterial({
    map: tile(brick, BR, BR), normalMap: tile(bd.normal, BR, BR), roughnessMap: tile(bd.roughness, BR, BR), roughness: 1,
    normalScale: new THREE.Vector2(1.2, 1.2), envMapIntensity: 0.5, color: 0xb8aeb0, name: 'wall',
  });
  const wall = new THREE.Mesh(new THREE.ShapeGeometry(wallShape), wallMat);
  wall.position.z = WALL_Z;
  wall.receiveShadow = true;
  scene.add(wall);

  // Concrete plinth along the base of the wall.
  const plinthMat = new THREE.MeshStandardMaterial({ color: 0x1b1a1c, roughness: 0.55, envMapIntensity: 0.4 });
  for (const [a, b] of [[-42, SHUTTER.x0 - 0.12], [SHUTTER.x1 + 0.12, 9]]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(b - a, 0.22, 0.12), plinthMat);
    p.position.set((a + b) / 2, 0.11, WALL_Z + 0.06);
    p.receiveShadow = p.castShadow = true;
    scene.add(p);
  }

  // Roll-up shutter, lifted a hand's width: the workshop light leaks out underneath.
  const sd = derive(shutterTex, { size: 1024, strength: 5, rough: '0.3 + (1.0 - l) * 0.45 + max(c.r - c.b, 0.0) * 1.2' });
  const sw = SHUTTER.x1 - SHUTTER.x0, sh = SHUTTER.top - SHUTTER.gap;
  const shutterMat = new THREE.MeshStandardMaterial({
    map: shutterTex, normalMap: sd.normal, roughnessMap: sd.roughness, roughness: 1, metalness: 0.65, normalScale: new THREE.Vector2(1.6, 1.6),
    envMapIntensity: 0.9, color: 0x9b9ba4,
  });
  shutterTex.repeat.set(1, 1);
  const shutter = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), shutterMat);
  shutter.position.set((SHUTTER.x0 + SHUTTER.x1) / 2, SHUTTER.gap + sh / 2, WALL_Z - 0.06);
  shutter.receiveShadow = true;
  scene.add(shutter);
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.38, metalness: 0.85, envMapIntensity: 1.1 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.06, 0.07), steel);
  bar.position.set(shutter.position.x, SHUTTER.gap + 0.03, WALL_Z - 0.03);
  bar.castShadow = true;
  scene.add(bar);
  for (const x of [SHUTTER.x0 - 0.05, SHUTTER.x1 + 0.05]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, SHUTTER.top + 0.2, 0.14), steel);
    rail.position.set(x, (SHUTTER.top + 0.2) / 2, WALL_Z + 0.02);
    rail.castShadow = rail.receiveShadow = true;
    scene.add(rail);
  }
  const housing = new THREE.Mesh(new RoundedBoxGeometry(sw + 0.4, 0.46, 0.4, 2, 0.03), steel);
  housing.position.set(shutter.position.x, SHUTTER.top + 0.25, WALL_Z + 0.12);
  housing.castShadow = housing.receiveShadow = true;
  scene.add(housing);

  // The workshop behind it: a warm plate and floor, only ever seen through the gap.
  const inside = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 3.6), new THREE.MeshBasicMaterial({ map: workshop, color: new THREE.Color(1.3, 0.95, 0.65), fog: false }));
  inside.position.set(shutter.position.x, 1.2, WALL_Z - 4.2);
  scene.add(inside);
  const inFloor = new THREE.Mesh(new THREE.PlaneGeometry(sw + 1, 4.2), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.25, metalness: 0, envMapIntensity: 0 }));
  inFloor.rotation.x = -Math.PI / 2; inFloor.position.set(shutter.position.x, 0.002, WALL_Z - 2.1);
  scene.add(inFloor);
  const inLight = new THREE.PointLight(0xffa458, 12, 7, 1.6);
  inLight.position.set(shutter.position.x, 1.6, WALL_Z - 2.4);
  scene.add(inLight);
  const garageRect = new THREE.RectAreaLight(0xffa050, 2.5, sw, SHUTTER.gap);
  garageRect.position.set(shutter.position.x, SHUTTER.gap / 2, WALL_Z + 0.02);
  garageRect.lookAt(shutter.position.x, SHUTTER.gap / 2, 10);
  scene.add(garageRect);
  lights.garage = garageRect;
  // A low warm spot to haze the air just outside the gap.
  const garageSpot = new THREE.SpotLight(0xffa050, 9, 6, 0.9, 0.9, 1.8);
  garageSpot.position.set(shutter.position.x, 0.3, WALL_Z - 0.3);
  garageSpot.target.position.set(shutter.position.x, 0.0, WALL_Z + 4);
  scene.add(garageSpot, garageSpot.target);
  lights.garageSpot = garageSpot;

  // Neon sign.
  const nt = neonTextures({});
  const signH = SIGN.w / nt.aspect;
  const mk = (map, blending, color, z) => {
    const m = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending, color, fog: false, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SIGN.w, signH), m);
    mesh.position.set(SIGN.x, SIGN.y, WALL_Z + z);
    mesh.renderOrder = 6;
    scene.add(mesh);
    return m;
  };
  neonMats.glass = mk(nt.glass, THREE.NormalBlending, new THREE.Color(0.08, 0.06, 0.07), 0.055);
  neonMats.main = mk(nt.main, THREE.AdditiveBlending, new THREE.Color(0, 0, 0), 0.06);
  neonMats.flick = mk(nt.flick, THREE.AdditiveBlending, new THREE.Color(0, 0, 0), 0.061);
  // standoffs
  const standoffMat = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 1, roughness: 0.3 });
  for (const [dx, dy] of [[-1.2, 0.25], [1.2, 0.25], [-1.2, -0.3], [1.2, -0.3], [0, 0.34]]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 8), standoffMat);
    s.rotation.x = Math.PI / 2; s.position.set(SIGN.x + dx, SIGN.y + dy, WALL_Z + 0.03);
    scene.add(s);
  }
  patchWallWash(wallMat, [{ tex: nt.wash, rect: new THREE.Vector4(SIGN.x - SIGN.w, SIGN.y - signH, SIGN.w * 2, signH * 2), pos: new THREE.Vector3(SIGN.x, SIGN.y, WALL_Z + 0.1), color: new THREE.Color(1.0, 0.16, 0.3), level: washLevel }]);
  const neonRect = new THREE.RectAreaLight(0xff3b5c, 0, SIGN.w * 0.9, signH * 0.7);
  neonRect.position.set(SIGN.x, SIGN.y, WALL_Z + 0.08);
  neonRect.lookAt(SIGN.x, SIGN.y - 0.6, 10);
  scene.add(neonRect);
  lights.neon = neonRect;
  const neonSpot = new THREE.SpotLight(0xff3b5c, 0, 9, 0.62, 1, 1.6);
  neonSpot.position.set(SIGN.x, SIGN.y + 0.2, WALL_Z + 0.2);
  neonSpot.target.position.set(SIGN.x, 0, WALL_Z + 1.5);
  scene.add(neonSpot, neonSpot.target);
  lights.neonSpot = neonSpot;

  // Caged bulkhead lamp over the shutter: the cold key from above and behind.
  const lampHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.14, 24), steel);
  lampHousing.position.copy(LAMP).add(new THREE.Vector3(0, 0.06, 0));
  scene.add(lampHousing);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), steel);
  arm.position.set(LAMP.x, LAMP.y + 0.1, WALL_Z + 0.13);
  scene.add(arm);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.12, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 10, 12), fog: false }));
  lens.rotation.x = Math.PI / 2; lens.position.copy(LAMP).add(new THREE.Vector3(0, -0.012, 0));
  scene.add(lens);
  lights.lampLens = lens.material;
  const lamp = new THREE.SpotLight(0xd4e0ff, 70, 16, 0.37, 0.5, 1.5);
  lamp.position.copy(LAMP).add(new THREE.Vector3(0, -0.05, 0));
  lamp.target.position.set(0.05, 0, 0.15);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.camera.near = 0.3; lamp.shadow.camera.far = 12;
  lamp.shadow.bias = -0.0002; lamp.shadow.normalBias = 0.02; lamp.shadow.radius = 3;
  scene.add(lamp, lamp.target);
  lights.lamp = lamp;
  vol.add(lamp, { scale: 0.022, range: 0.06, softness: 0.25 });
  vol.add(neonSpot, { scale: 0.012, range: 0.12, softness: 0.9 });
  // Fluorescent batten: emissive tube, a long area light for reflections, a spot for the rim + haze.
  const tubeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, TUBE_LEN, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 7, 8), fog: false }));
  tubeMesh.rotation.z = Math.PI / 2; tubeMesh.position.copy(TUBE).add(new THREE.Vector3(0, 0, 0.04));
  scene.add(tubeMesh);
  const batten = new THREE.Mesh(new RoundedBoxGeometry(TUBE_LEN + 0.12, 0.07, 0.06, 2, 0.01), steel);
  batten.position.copy(TUBE).add(new THREE.Vector3(0, 0.035, -0.01));
  scene.add(batten);
  const tubeRect = new THREE.RectAreaLight(0xd6f2ff, 0, TUBE_LEN, 0.1);
  tubeRect.position.copy(TUBE).add(new THREE.Vector3(0, 0, 0.06));
  tubeRect.lookAt(0.2, 0.55, 0.3);
  scene.add(tubeRect);
  const tubeSpot = new THREE.SpotLight(0xc8ecff, 0, 9, 0.42, 0.6, 1.6);
  tubeSpot.position.copy(TUBE).add(new THREE.Vector3(0, -0.02, 0.1));
  tubeSpot.target.position.set(0.25, 0.45, 0.2);
  scene.add(tubeSpot, tubeSpot.target);
  lights.tube = { mesh: tubeMesh.material, rect: tubeRect, spot: tubeSpot };
  vol.add(tubeSpot, { scale: 0.004, range: 0.12, softness: 0.5 });

  // Soft cold fill from across the street (a shop window we never see).
  const fill = new THREE.RectAreaLight(0xc4d0ff, 2.2, 6, 0.35);
  fill.position.set(2.5, 3.0, 6.5);
  fill.lookAt(0, 0.6, 0);
  scene.add(fill);
  lights.fill = fill;
  scene.add(new THREE.HemisphereLight(0x1c1c30, 0x060505, 0.12));

  // Drainpipe, left of the shutter.
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.7, roughness: 0.35, envMapIntensity: 1 });
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 9.6, 16), pipeMat);
  pipe.position.set(SHUTTER.x1 + 0.55, 4.8 + 0.12, WALL_Z + 0.1);
  pipe.castShadow = pipe.receiveShadow = true;
  scene.add(pipe);
  const shoe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.2, 16, 1, true), pipeMat);
  shoe.position.set(pipe.position.x, 0.1, WALL_Z + 0.12); shoe.rotation.x = 0.5;
  scene.add(shoe);

  // Crate with a stencil, for the helmet.
  const crateTex = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#2b1d14'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const y0 = i * h / 4;
      g.fillStyle = `hsl(24, 32%, ${12 + Math.random() * 5}%)`; g.fillRect(0, y0 + 4, w, h / 4 - 8);
      for (let k = 0; k < 90; k++) {
        g.strokeStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '120,80,50'},${Math.random() * 0.18})`; g.lineWidth = 1 + Math.random() * 2;
        const yy = y0 + 8 + Math.random() * (h / 4 - 16);
        g.beginPath(); g.moveTo(0, yy); g.bezierCurveTo(w * 0.3, yy + (Math.random() - 0.5) * 12, w * 0.7, yy + (Math.random() - 0.5) * 12, w, yy + (Math.random() - 0.5) * 6); g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(0, y0, w, 5);
    }
    g.globalAlpha = 0.55; g.fillStyle = '#d9cdb4'; g.textAlign = 'center';
    g.font = '400 118px Anton'; g.fillText('NIGHTSHIFT', w / 2, h * 0.44);
    g.font = '600 44px Inter'; if ('letterSpacing' in g) g.letterSpacing = '14px'; g.fillText('MOTOR CO. · ROTTERDAM', w / 2, h * 0.58);
    g.font = '400 70px Anton'; g.fillText('No. 07', w / 2, h * 0.76);
  });
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.55, metalness: 0, envMapIntensity: 0.6 });
  const crate = new THREE.Mesh(new RoundedBoxGeometry(0.64, 0.44, 0.46, 2, 0.012), crateMat);
  crate.position.copy(CRATE).add(new THREE.Vector3(0, 0.22, 0));
  crate.rotation.y = 0.2;
  crate.castShadow = crate.receiveShadow = true;
  scene.add(crate);
  lights.crateTop = crate.position.y + 0.22;

  // The street beyond the wall's end.
  const cityMat = new THREE.MeshBasicMaterial({ map: city, color: new THREE.Color(0.5, 0.46, 0.55), fog: false, depthWrite: false });
  const cityPlane = new THREE.Mesh(new THREE.PlaneGeometry(46, 19.7), cityMat);
  cityPlane.position.set(-44, 6.2, 5);
  cityPlane.rotation.y = Math.PI / 2;
  scene.add(cityPlane);

  // Rain + splashes.
  rain = createRain({ count: MOBILE ? 14000 : 36000, box: new THREE.Vector3(13, 8, 13) });
  scene.add(rain.mesh);
  splashes = createSplashes(rain.uniforms, { count: MOBILE ? 2500 : 5000, radius: 7 });
  scene.add(splashes.points);
  reflection.hidden.push(splashes.points);
  // steam off the pipes: headers down from the head, under the engine, back along the muffler
  steam = createSteam(rain.uniforms, [
    new THREE.Vector3(0.26, 0.5, 0.16), new THREE.Vector3(0.2, 0.3, 0.2), new THREE.Vector3(0.05, 0.17, 0.2),
    new THREE.Vector3(-0.3, 0.24, 0.2), new THREE.Vector3(-0.55, 0.36, 0.2), new THREE.Vector3(-0.74, 0.47, 0.19),
  ], { count: MOBILE ? 200 : 420 });
  scene.add(steam.points);
  reflection.hidden.push(steam.points);
  engine.onResize((w, h, dpr) => { rain.uniforms.uRes.value.set(w * dpr, h * dpr); splashes.uniforms.uDpr.value = dpr * (h / 900); steam.uniforms.uDpr.value = dpr * (h / 900); });
}

// ─── Bike, helmet, headlight, exhaust ─────────────────────────────────────────
const bike = new THREE.Group();          // vibrates
const bikeRoot = new THREE.Group();       // leans on its stand
bikeRoot.add(bike);
bikeRoot.rotation.set(-4.5 * D, BIKE_YAW, 0, 'YXZ');
scene.add(bikeRoot);
const glowTex = glowTexture();
const streakTex = glowTexture([[0, 'rgba(255,255,255,1)'], [0.1, 'rgba(255,255,255,0.35)'], [0.4, 'rgba(255,255,255,0.05)'], [1, 'rgba(255,255,255,0)']]);
const head = new THREE.SpotLight(0xfff2de, 0, 32, 0.36, 0.5, 1.25);
head.target.position.set(10, 0.2, 0.4);
scene.add(head, head.target);
vol.add(head, { scale: 0.05, range: 0.035, softness: 0.22 });
const headLens = new THREE.Mesh(new THREE.CircleGeometry(0.083, 40), new THREE.MeshBasicMaterial({ map: glowTex, color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
headLens.rotation.y = Math.PI / 2;
headLens.position.copy(HEAD_L).add(new THREE.Vector3(0.012, 0, 0));
bike.add(headLens);
const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x000000, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, fog: false }));
const streak = new THREE.Sprite(new THREE.SpriteMaterial({ map: streakTex, color: 0x000000, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
scene.add(flare, streak);
const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTexture(), color: 0x000000, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
scene.add(flame);
const tipGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x000000, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
scene.add(tipGlow);
const popLight = new THREE.PointLight(0xff7a2a, 0, 5, 2);
scene.add(popLight);
let bikeModel, helmetModel;

async function buildBike() {
  const [bikeG, helmetG] = await modelP;
  const m = bikeG.scene;
  normalize(m, BIKE_LEN, { axis: 'x' });
  m.rotation.y = Math.PI;
  prepModel(m, renderer, {
    env: 1,
    onMat: (mat, mesh) => { mesh.material = wetMaterial(mat, { drops: 0.5, dropScale: 110, env: 1.15 }); },
  });
  bike.add(m);
  bikeModel = m;
  if (Q.has('dbg')) for (const [p, c] of [[HEAD_L, 0x00ff00], [TIP_L, 0xff0000], [HEADS_L, 0x0088ff]]) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.015, 12, 8), new THREE.MeshBasicMaterial({ color: c, depthTest: false }));
    s.position.copy(p); s.renderOrder = 99; bike.add(s);
  }
  const h = helmetG.scene;
  normalize(h, 0.3, { axis: 'max' });
  prepModel(h, renderer, { env: 1, onMat: (mat, mesh) => { mesh.material = wetMaterial(mat, { drops: 0.6, dropScale: 16, env: 1.1 }); } });
  const hg = new THREE.Group();
  hg.add(h);
  hg.position.set(CRATE.x + 0.02, lights.crateTop ?? 0.44, CRATE.z + 0.02);
  hg.rotation.y = 0.75;
  scene.add(hg);
  helmetModel = hg;
}

// ─── Throttle, RPM and everything it drives ───────────────────────────────────
const IDLE = 1100, RED = 8500;
const rev = { held: false, throttle: 0, rpm: IDLE, rn: 0, heat: 0, limiter: 0, lastHeld: -10, pops: 0, beam: 0, highUntil: 0, used: false };
const audio = new EngineAudio();
const tacho = new Tacho(document.querySelector('.tacho'));
const tachoEl = document.querySelector('.tacho');
const flashEl = document.querySelector('.redline-flash');
const root = document.documentElement;
const body = document.body;
let beamPower = 0; // 0 dark, 1 low beam, >1 high beam

function setHeld(v) {
  if (v === rev.held) return;
  rev.held = v;
  if (v) {
    rev.used = true;
    if (rev.beam < 2 && beamPower > 0.5) { rev.beam = 2; audio.click(); snapBeam(); }
  } else rev.lastHeld = engine.time;
  body.classList.toggle('is-revving', v);
  document.querySelectorAll('.rev-btn').forEach(b => b.classList.toggle('on', v));
}
function snapBeam() {
  // relay chatter on the switch to high beam
  gsap.timeline().to(beam, { k: 0.2, duration: 0.03 }).to(beam, { k: 1.25, duration: 0.03, delay: 0.04 }).to(beam, { k: 0.6, duration: 0.03, delay: 0.03 }).to(beam, { k: 1, duration: 0.15 });
}
const beam = { k: 1 };
const interactive = t => t.closest?.('a, button, input, select, textarea, label, .wl-panel, .nav, .tw-nav');
addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const btn = e.target.closest?.('.rev-btn');
  if (btn) { e.preventDefault(); try { btn.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointers */ } setHeld(true); return; }
  if (e.pointerType === 'touch' || interactive(e.target)) return;
  setHeld(true);
});
addEventListener('pointerup', () => setHeld(false));
addEventListener('pointercancel', () => setHeld(false));
addEventListener('blur', () => setHeld(false));
addEventListener('contextmenu', e => { if (e.target.closest?.('.rev-btn')) e.preventDefault(); });
addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.target.closest?.('input, textarea, select, button')) return;
  e.preventDefault();
  setHeld(true);
});
addEventListener('keyup', e => { if (e.code === 'Space') setHeld(false); });

function popFlash(s) {
  audio.pop(s);
  const k = 0.6 + Math.random() * 0.8;
  gsap.killTweensOf(fx);
  gsap.fromTo(fx, { flame: k * s }, { flame: 0, duration: 0.09 + Math.random() * 0.08, ease: 'power2.out' });
  fx.flameRot = Math.random() * Math.PI * 2;
}
const fx = { flame: 0, flameRot: 0 };

function updateRev(dt, t) {
  rev.throttle = damp(rev.throttle, rev.held ? 1 : 0, rev.held ? 16 : 11, dt);
  const rn0 = (rev.rpm - IDLE) / (RED - IDLE);
  let acc = rev.throttle * (2600 + 5600 * Math.sin(Math.PI * clamp(rn0 * 0.9 + 0.08)));
  acc -= (rev.rpm - IDLE) * (rev.held ? 0.28 : 2.2);
  rev.rpm += acc * dt;
  rev.limiter = Math.max(0, rev.limiter - dt);
  if (rev.rpm >= RED) { rev.rpm = RED - 260 - Math.random() * 180; rev.limiter = 0.12; }
  rev.rpm = Math.max(IDLE * 0.96, rev.rpm);
  // the idle lope
  const idleWob = (Math.sin(t * 7.1) * 0.6 + Math.sin(t * 12.7 + 1.3) * 0.4) * 28 * (1 - rev.throttle);
  rev.shown = rev.rpm + idleWob;
  rev.rn = clamp((rev.rpm - IDLE) / (RED - IDLE));
  rev.heat = damp(rev.heat, rev.rn, rev.rn > rev.heat ? 0.9 : 0.25, dt);
  // overrun crackle after letting go from high revs
  if (!rev.held && rev.rpm > 3200 && t - rev.lastHeld < 1.6) {
    const rate = 11 * clamp((rev.rpm - 3200) / 4500) * (1 - (t - rev.lastHeld) / 1.6);
    if (Math.random() < rate * dt) popFlash(0.6 + rev.rn * 0.6);
  }
  // high beam drops back to low a while after the last blip
  if (rev.held) rev.highUntil = t + 3;
  if (rev.beam === 2 && t > rev.highUntil) { rev.beam = 1; audio.click(); }
}

// ─── Fluorescent tube: steady 100 Hz shimmer, and a tired starter every so often ─
let tubeNext = 7, tubeEnd = 0;
function tubeLevel(t) {
  if (t > tubeNext) { tubeEnd = t + 0.5 + Math.random() * 0.7; tubeNext = t + 9 + Math.random() * 12; }
  let v = 0.97 + Math.sin(t * 628) * 0.03;
  if (t < tubeEnd) { const k = Math.sin(t * 47) * Math.sin(t * 13.3); v *= k > 0.15 ? 1 : k > -0.3 ? 0.35 : 0.05; }
  return v;
}

// ─── Neon behaviour ───────────────────────────────────────────────────────────
let nextStutter = 4, stutterEnd = 0, stutterSeed = 0, nextBlink = 18;
function updateNeon(dt, t) {
  let lv = neon.target;
  let letter = 1;
  if (t > nextStutter) { stutterEnd = t + 0.35 + Math.random() * 0.5; nextStutter = t + 4 + Math.random() * 6; stutterSeed = Math.random() * 100; }
  if (t < stutterEnd) letter = Math.sin(t * 90 + stutterSeed) > 0.1 ? 1 : 0.06;
  if (t > nextBlink) { nextBlink = t + 16 + Math.random() * 14; gsap.timeline().to(neon, { blink: 0.25, duration: 0.03 }).to(neon, { blink: 1, duration: 0.05, delay: 0.06 }).to(neon, { blink: 0.4, duration: 0.03, delay: 0.1 }).to(neon, { blink: 1, duration: 0.2 }); }
  lv *= neon.blink ?? 1;
  // revving sags the supply, then the transformer sings
  const sag = rev.rn > 0.2 && Math.random() < rev.rn * 0.08 ? 0.55 : 1;
  const boost = 1 + rev.rn * 0.45 + Math.sin(t * 120) * 0.02 * rev.rn;
  neon.level = damp(neon.level, lv * sag * boost, 30, dt) * neon.power;
  neon.letter = neon.level * letter;
  neon.crackle = (sag < 1 ? 1 : 0) + (letter < 1 ? 0.6 : 0);
}
neon.power = 0; neon.blink = 1;

// ─── Scroll → camera stations ─────────────────────────────────────────────────
let anchors = [];
function measure() {
  const max = document.documentElement.scrollHeight - innerHeight;
  anchors = [...document.querySelectorAll('[data-station]')].map(el => {
    const r = el.getBoundingClientRect();
    const key = el.dataset.station;
    let y = r.top + scrollY + r.height / 2 - innerHeight / 2;
    if (key === 'hero') y = 0;
    if (key === 'foot') y = max;
    return { y: clamp(y, 0, max), key, st: STATIONS[key] };
  }).sort((a, b) => a.y - b.y);
}
addEventListener('resize', () => requestAnimationFrame(measure));
const cur = { poi: new THREE.Vector3(), az: 0, el: 0, dist: 5, fov: 30, sx: 0, sy: 0, bokeh: 1, range: 2, vol: 1, mag: 1, sat: 0, fill: 1 };
const va = new THREE.Vector3(), vb = new THREE.Vector3();
function stationAt(sy) {
  let i = 0;
  while (i < anchors.length - 2 && sy >= anchors[i + 1].y) i++;
  const a = anchors[i], b = anchors[i + 1] ?? a;
  const f = b.y > a.y ? clamp((sy - a.y) / (b.y - a.y)) : 0;
  const e = smooth(0.1, 0.9, f);
  const A = a.st, B = b.st;
  cur.poi.set(...A.poi).lerp(vb.set(...B.poi), e);
  cur.az = lerp(A.az, B.az, e); cur.el = lerp(A.el, B.el, e);
  // pull back a little mid-transition so macro-to-macro moves feel like a dolly, not a cut
  cur.dist = lerp(A.dist, B.dist, e) + Math.sin(e * Math.PI) * Math.min(A.dist, B.dist) * 0.35;
  cur.fov = lerp(A.fov, B.fov, e);
  cur.sx = lerp(A.shift[0], B.shift[0], e); cur.sy = lerp(A.shift[1], B.shift[1], e);
  cur.bokeh = lerp(A.bokeh, B.bokeh, e); cur.range = lerp(A.range, B.range, e); cur.vol = lerp(A.vol ?? 0.6, B.vol ?? 0.6, e);
  cur.mag = lerp(A.mag ?? 0.8, B.mag ?? 0.8, e); cur.sat = lerp(A.sat ?? -0.1, B.sat ?? -0.1, e); cur.fill = lerp(A.fill ?? 1, B.fill ?? 1, e);
  return { i, f, key: f < 0.5 ? a.key : b.key };
}
const cam = { poi: new THREE.Vector3(0.1, 0.6, 0), az: 44, el: 3, dist: 5, fov: 30, sx: 0.2, sy: 0, bokeh: 1.5, range: 1.8, vol: 1, mag: 1, sat: 0, fill: 1 };
if (MOBILE) for (const s of Object.values(STATIONS)) { s.shift = [0, s.shift[1] + 0.2]; s.dist *= 1.35; s.fov += 6; }
if (MOBILE) { STATIONS.hero.dist *= 1.3; STATIONS.hero.poi = [0.15, 0.55, 0]; }

// ─── Frame loop ────────────────────────────────────────────────────────────────
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();
const SIGN_P = new THREE.Vector3(SIGN.x, SIGN.y, WALL_Z + 0.2);
const headW = new THREE.Vector3(), tipW = new THREE.Vector3(), headsW = new THREE.Vector3();
const hazeU = () => haze.uniforms;
const toUv = (v, out) => { tmp3.copy(v).project(camera); out.set((tmp3.x + 1) / 2, (tmp3.y + 1) / 2); return tmp3.z < 1; };
const heroEl = document.querySelector('.hero');
const revEl = document.querySelector('.rev');
let lastCursor = '', stationKey = 'hero';
let cursorApi, ready = false;

function frame(dt, t) {
  pointer.update(dt);
  shared.uTime.value = t;
  updateRev(dt, t);
  updateNeon(dt, t);
  const rn = rev.rn;

  // Camera
  const st = stationAt(scrollY);
  stationKey = st.key;
  const k = 1 - Math.exp(-4.5 * dt);
  cam.poi.lerp(cur.poi, k);
  for (const p of ['az', 'el', 'dist', 'fov', 'sx', 'sy', 'bokeh', 'range', 'vol', 'mag', 'sat', 'fill']) cam[p] += (cur[p] - cam[p]) * k;
  hueSat.saturation = cam.sat;
  vol.uniforms.get('uDensity').value = 0.028 * cam.vol;
  const az = (cam.az + pointer.sx * 3 + Math.sin(t * 0.13) * 1.2) * D;
  const el = (cam.el + pointer.sy * 1.6 + Math.sin(t * 0.21) * 0.4) * D;
  const dist = cam.dist * (1 - rn * 0.035);
  camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(cam.poi);
  // engine shake reaches the camera at high revs
  const shake = (0.0006 + rn * rn * 0.004) * Math.min(dist, 5);
  camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake;
  camera.position.y = Math.max(0.12, camera.position.y);
  camera.lookAt(cam.poi);
  camera.fov = cam.fov - rn * 1.2;
  camera.updateProjectionMatrix();
  camera.projectionMatrix.elements[8] -= cam.sx;
  camera.projectionMatrix.elements[9] -= cam.sy;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.updateMatrixWorld();

  // Depth of field on the point of interest.
  const fd = camera.position.distanceTo(cam.poi);
  dof.cocMaterial.focusDistance = fd;
  dof.cocMaterial.focusRange = cam.range;
  dof.bokehScale = cam.bokeh * (MOBILE ? 0.7 : 1);

  // Bike vibration: a lope at idle, a buzz at revs.
  const lope = Math.sin(t * 2 * Math.PI * 4.6) * (Math.sin(t * 2 * Math.PI * 9.2 + 0.7) > 0 ? 1 : 0.4);
  const amp = 0.0005 * (1 - rn) + rn * 0.0024;
  bike.position.set((Math.random() - 0.5) * amp * 0.6, lope * amp * 0.5 + (Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp * 0.5);
  bike.rotation.x = (Math.random() - 0.5) * amp * 1.6 + lope * 0.0004;
  bike.rotation.z = rev.throttle * 0.006 + (Math.random() - 0.5) * amp * 0.8;
  bikeRoot.updateMatrixWorld(true);
  headW.copy(HEAD_L).applyMatrix4(bike.matrixWorld);
  tipW.copy(TIP_L).applyMatrix4(bike.matrixWorld);
  headsW.copy(HEADS_L).applyMatrix4(bike.matrixWorld);

  // Headlight: alternator-fed, so it brightens with the revs.
  const baseBeam = rev.beam === 2 ? 1 : 0.75;
  beamPower = damp(beamPower, rev.beam ? baseBeam : 0, 30, dt);
  const volt = 0.72 + rn * 0.38 + Math.sin(t * 4.6 * 2 * Math.PI) * 0.03 * (1 - rn);
  const hb = beamPower * volt * beam.k;
  head.position.copy(headW);
  head.target.position.copy(headW).add(tmp.set(8, rev.beam === 2 ? -0.15 : -0.6, 0).applyQuaternion(bikeRoot.quaternion));
  head.angle = rev.beam === 2 ? 0.3 : 0.38;
  head.intensity = 150 * hb;
  headLens.material.color.setScalar(9 * hb);
  // flare: only when we can see into the lens
  const toCam = tmp.copy(camera.position).sub(headW).normalize();
  const facing = Math.pow(clamp(toCam.dot(tmp2.set(1, 0, 0).applyQuaternion(bikeRoot.quaternion))), 3);
  flare.position.copy(headW).add(tmp2.set(0.02, 0, 0).applyQuaternion(bikeRoot.quaternion));
  flare.scale.setScalar(0.16 + hb * 0.22);
  flare.material.color.setRGB(1, 0.93, 0.85).multiplyScalar(hb * facing * 4);
  streak.position.copy(flare.position);
  streak.scale.set(2.6 * hb, 0.022, 1);
  streak.material.color.setRGB(0.55, 0.7, 1).multiplyScalar(hb * facing * 1.1);

  // Exhaust: backfire flame, glow, heat haze.
  flame.position.copy(tipW).addScaledVector(TIP_DIR, 0.06 + fx.flame * 0.08);
  flame.scale.setScalar(0.08 + fx.flame * 0.34);
  flame.material.rotation = fx.flameRot;
  flame.material.color.setRGB(1, 0.75, 0.55).multiplyScalar(fx.flame * 6);
  popLight.position.copy(tipW).addScaledVector(TIP_DIR, 0.2).add(tmp.set(0, 0, 0.12));
  popLight.intensity = fx.flame * 26;
  tipGlow.position.copy(tipW);
  tipGlow.scale.setScalar(0.12);
  tipGlow.material.color.setRGB(1, 0.25, 0.08).multiplyScalar(rev.heat * rev.heat * 0.5);
  const hu = hazeU();
  const onA = toUv(tipW, hu.get('uA0').value);
  toUv(tmp.copy(tipW).addScaledVector(TIP_DIR, 0.35).add(tmp2.set(0, 0.45, 0)), hu.get('uB0').value);
  const tipD = camera.position.distanceTo(tipW);
  hu.get('uW0').value = 0.11 / tipD;
  hu.get('uS0').value = onA ? (0.18 + rev.heat * 1.1 + rev.throttle * 0.4) : 0;
  toUv(headsW, hu.get('uA1').value);
  toUv(tmp.copy(headsW).add(tmp2.set(-0.05, 0.6, 0)), hu.get('uB1').value);
  hu.get('uW1').value = 0.16 / camera.position.distanceTo(headsW);
  hu.get('uS1').value = 0.12 + rev.heat * 0.7;

  // Neon.
  const nl = neon.level;
  neonMats.main?.color.setRGB(3.2, 1.0, 1.3).multiplyScalar(nl);
  neonMats.flick?.color.setRGB(3.2, 1.0, 1.3).multiplyScalar(neon.letter);
  if (lights.neon) {
    lights.neon.intensity = 7 * nl * cam.mag;
    lights.neonSpot.intensity = 18 * nl * cam.mag;
    lights.fill.intensity = 2.2 * cam.fill;
    const tb = neon.lamp * tubeLevel(t);
    lights.tube.rect.intensity = 16 * tb;
    lights.tube.spot.intensity = 16 * tb;
    lights.tube.mesh.color.setRGB(5, 7, 8).multiplyScalar(0.08 + tb * 0.92);
    washLevel.value = 2.4 * nl;
  }
  if (lights.lamp) {
    // the bulkhead has a tired starter: it hums along, then occasionally hiccups
    const hic = (t % 23) > 22.6 ? (Math.sin(t * 70) > 0 ? 0.3 : 1) : 1;
    lights.lamp.intensity = 70 * neon.lamp * hic;
    lights.lampLens.color.setRGB(9, 10, 12).multiplyScalar(neon.lamp * hic);
  }

  // Rain: follows the camera, bends in the hot air, lit by what is actually shining.
  if (rain) {
    const u = rain.uniforms;
    u.uTime.value = t;
    camera.getWorldDirection(tmp);
    u.uCenter.value.copy(camera.position).addScaledVector(tmp, 6);
    u.uRev.value = damp(u.uRev.value, rn * rev.throttle + rev.heat * 0.2, 4, dt);
    const wind = u.uWind.value;
    wind.set(0.5 + Math.sin(t * 0.3) * 0.25, 0, 0.22);
    u.uWindOff.value.addScaledVector(wind, dt);
    u.uBike.value.copy(headsW);
    const L = [
      [head, head.color, head.intensity * 0.06, true],
      [lights.lamp, lights.lamp.color, lights.lamp.intensity * 0.02, true],
      [lights.neonSpot, lights.neonSpot.color, 0.5 * nl, false, SIGN_P],
      [lights.tube.spot, lights.tube.spot.color, lights.tube.spot.intensity * 0.03, true],
      [popLight, popLight.color, popLight.intensity * 0.05, false],
      [lights.fill, lights.fill.color, 0.02, false],
    ];
    for (let i = 0; i < MAX_RAIN_LIGHTS; i++) {
      const [l, c, s, spot, at] = L[i];
      const p = u.uLPos.value[i];
      if (at) p.copy(at); else l.getWorldPosition(p);
      u.uLCol.value[i].set(c.r * s, c.g * s, c.b * s);
      if (spot) {
        const d = tmp.copy(l.target.position).sub(p).normalize();
        u.uLDir.value[i].set(d.x, d.y, d.z, Math.cos(l.angle));
      } else u.uLDir.value[i].set(0, -1, 0, -2);
    }
    splashes.uniforms.uCenter.value.copy(cam.poi);
    steam.uniforms.uBikeMat.value.copy(bike.matrixWorld);
    steam.uniforms.uHeat.value = damp(steam.uniforms.uHeat.value, 0.15 + rev.heat * rev.heat * 1.4, 2, dt);
  }

  // UI state
  root.style.setProperty('--rev', rn.toFixed(3));
  const rr = revEl.getBoundingClientRect();
  const inRev = rr.top < innerHeight * 0.45 && rr.bottom > innerHeight * 0.75;
  tachoEl.classList.toggle('big', inRev);
  body.classList.toggle('in-rev', inRev);
  tachoEl.classList.toggle('mini', !inRev && (rev.held || rev.rpm > 1500));
  tacho.update(rev.shown, dt, rev.limiter > 0);
  flashEl.style.opacity = (rev.limiter > 0 ? 0.9 : 0) + rn * rn * 0.25;
  heroEl.style.opacity = 1 - smooth(0.05, 0.5, scrollY / innerHeight);
  body.classList.toggle('past-hero', scrollY > innerHeight * 0.3);
  if (cursorApi && ready) {
    const label = rev.held ? rev.shown.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : 'Hold';
    const over = document.elementFromPoint(pointer.px, pointer.py);
    const want = over && !interactive(over) && !TOUCH ? label : '';
    if (want !== lastCursor) { lastCursor = want; cursorApi.set(want ? 'label' : '', want); }
  }

  audio.update(rev.rpm, rev.throttle, nl, neon.crackle);
  if (floor) reflection.update(scene, camera);
}

// ─── Sound toggle, waitlist, reveals ──────────────────────────────────────────
const soundBtn = document.querySelector('.sound');
soundBtn.addEventListener('click', async () => {
  const on = soundBtn.getAttribute('aria-pressed') !== 'true';
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.querySelector('.sound-label').textContent = on ? 'Sound on' : 'Sound off';
  if (on) await audio.enable(); else audio.disable();
});
const form = document.querySelector('.wl-form');
const slotSel = form.querySelector('select');
document.querySelectorAll('.slots li.open').forEach(li => li.addEventListener('click', () => {
  document.querySelectorAll('.slots li').forEach(x => x.classList.remove('sel'));
  li.classList.add('sel');
  slotSel.value = li.dataset.slot;
}));
slotSel.addEventListener('change', () => {
  document.querySelectorAll('.slots li').forEach(x => x.classList.toggle('sel', x.dataset.slot === slotSel.value));
});
form.addEventListener('submit', e => {
  e.preventDefault();
  const name = form.elements.name, email = form.elements.email;
  let ok = true;
  for (const [el, good] of [[name, name.value.trim().length > 1], [email, /.+@.+\..+/.test(email.value)]]) { el.classList.toggle('bad', !good); ok &&= good; }
  if (!ok) return;
  const done = document.querySelector('.wl-done');
  done.querySelector('b').textContent = `No. ${slotSel.value}`;
  done.hidden = false;
  form.hidden = true;
  gsap.from(done, { opacity: 0, y: 12, duration: 0.8, ease: 'power3.out' });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
worldNav('racer', { theme: 'dark', corner: 'bl' });
cursorApi = cursor({ color: '#ffd7df', blend: 'normal', size: 34 });
magnetic();
smoothScroll({ lerp: 0.08 });
reveal('section h2, .foot-title', { type: 'lines', stagger: 0.08 });
reveal('.lede, .part h3', { type: 'lines', stagger: 0.06, y: '100%' });
if (Q.has('notext')) document.body.classList.add('dbg-notext');
if (TOUCH) document.querySelector('.hold-hint span:last-child').innerHTML = '<b>Hold</b> the rev button <em>bottom right</em>';

await Promise.all([buildWorld(), buildBike()]);
// Macro stations are authored in the bike's own frame.
bikeRoot.updateMatrixWorld(true);
for (const st of Object.values(STATIONS)) if (st.local) {
  st.poi = tmp.set(...st.poi).applyMatrix4(bikeRoot.matrixWorld).toArray();
  st.az += BIKE_YAW / D;
}
measure();
setTimeout(measure, 1500);
stationAt(0);
cam.poi.copy(cur.poi);
Object.assign(cam, { az: cur.az + 14, el: cur.el + 3, dist: cur.dist * 1.25, fov: cur.fov, sx: cur.sx, sy: cur.sy, mag: cur.mag, sat: cur.sat, fill: cur.fill });
engine.onTick(frame);
// Warm every program with every light on before the reveal.
neon.power = 1; neon.lamp = 1; rev.beam = 1;
frame(1 / 60, 0);
renderer.compile(scene, camera);
neon.power = 0; neon.lamp = 0; rev.beam = 0;
engine.start();
await loader.finish();
ready = true;

// Ignition: the lamp stutters, the sign buzzes on, then the headlight.
neon.lamp = 0;
gsap.timeline({ delay: 0.15 })
  .to(neon, { lamp: 0.7, duration: 0.04 }).to(neon, { lamp: 0.05, duration: 0.05, delay: 0.08 })
  .to(neon, { lamp: 1, duration: 0.05, delay: 0.22 }).to(neon, { lamp: 0.2, duration: 0.03, delay: 0.05 }).to(neon, { lamp: 1, duration: 0.3 })
  .to(neon, { power: 1, duration: 0.03 }, 0.7).to(neon, { power: 0.1, duration: 0.04, delay: 0.05 })
  .to(neon, { power: 1, duration: 0.03, delay: 0.12 }).to(neon, { power: 0.3, duration: 0.03, delay: 0.06 }).to(neon, { power: 1, duration: 0.4 })
  .call(() => { rev.beam = 1; snapBeam(); }, null, 1.75)
  .call(() => { window.__racerIntro = true; }, null, 2.6);
gsap.from('.h-line > span', { yPercent: 110, duration: 1.6, ease: 'expo.out', stagger: 0.1, delay: 0.9 });
gsap.set('.hero .script', { opacity: 0 });
gsap.timeline({ delay: 1.9 }).to('.hero .script', { opacity: 1, duration: 0.04 }).to('.hero .script', { opacity: 0.1, duration: 0.04, delay: 0.06 })
  .to('.hero .script', { opacity: 1, duration: 0.04, delay: 0.14 }).to('.hero .script', { opacity: 0.3, duration: 0.03, delay: 0.05 }).to('.hero .script', { opacity: 1, duration: 0.3 });
gsap.from('.eyebrow, .hero-row, .nav', { opacity: 0, y: 14, duration: 1.2, ease: 'power3.out', stagger: 0.08, delay: 1.3 });

window.__racer = { rev, setHeld, cam, STATIONS, bike, bikeRoot, neon, audio, popFlash, reflection, rain, splashes, vol, dof, haze, bloom, engine, lights, head, scene, renderer, floor };
