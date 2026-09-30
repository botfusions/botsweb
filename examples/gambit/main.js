import { Engine, THREE, damp, clamp, smooth, lerp, studioEnvironment } from '../../src/core/engine.js';
import { Assets, firstMesh } from '../../src/core/assets.js';
import { Pointer } from '../../src/core/input.js';
import { smoothScroll, gsap, reveal, elementProgress } from '../../src/core/scroll.js';
import { preloader, cursor, magnetic, worldNav } from '../../src/core/ui.js';
import { PlanarReflection } from '../../src/core/reflector.js';
import { VolumetricSpotEffect } from '../../src/core/volumetric.js';
import { DepthOfFieldEffect } from 'postprocessing';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PLIES, PLY_COUNT, EPILOGUE, initialPieces, replay, squareXZ, xzSquare, FILES } from './game.js';
import { boardTextures, walnutTextures, leatherTextures, coordinateTexture, marbleMaterial, BRASS } from './materials.js';
import { buildTour, sound } from './extras.js';
import { buildSalon, TABLES } from './salon.js';

const D = Math.PI / 180;
const DBG = new URLSearchParams(location.search);
const MOBILE = matchMedia('(max-width: 760px)').matches;
const UP = new THREE.Vector3(0, 1, 0);
const TH = 0.34;              // board thickness; the table sits at -TH
const TABLE_Y = -TH;
const INLAY = 0.05;           // brass fillet
const FRAME = 0.74;           // walnut border
const EDGE = 4 + INLAY + FRAME;
const HEIGHTS = { king: 1.62, queen: 1.44, bishop: 1.2, knight: 1.1, rook: 0.98, pawn: 0.84 };
const MAX_BASE = { king: 0.8, queen: 0.78, bishop: 0.72, knight: 0.74, rook: 0.74, pawn: 0.64 };
const FILES_GLB = { king: 'king', queen: 'queen', bishop: 'bishop', knight: 'knight', rook: 'rook', pawn: 'pawn-lo' };
const END_P = PLY_COUNT + 1; // 46: the epilogue (the king lies down) is the last step

// ─── Engine ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gl');
let vol, dof;
const engine = new Engine({
  canvas, fov: 30, near: 0.3, far: 420, dpr: 1.6, background: 0x050404,
  post: {
    ao: DBG.has('noao') ? false : { aoRadius: 0.55, intensity: 2.2, distanceFalloff: 0.55 },
    bloom: { intensity: 0.6, luminanceThreshold: 0.95, luminanceSmoothing: 0.25, radius: 0.7 },
    pre: cam => {
      const fx = [];
      vol = new VolumetricSpotEffect(cam, { density: 0.011, noise: 0.9, noiseScale: 0.55, maxDist: 34, floorY: TABLE_Y });
      fx.push(vol);
      if (!DBG.has('nodof')) { dof = new DepthOfFieldEffect(cam, { focusDistance: 10, focusRange: 5, bokehScale: 2.4, resolutionScale: 0.5 }); fx.push(dof); }
      return fx;
    },
    tone: DBG.get('tone') ?? 'agx',
    vignette: { offset: 0.2, darkness: 0.74 },
    noise: 0.055,
    ca: 0.0007,
  },
});
const { scene, camera, renderer } = engine;
scene.fog = new THREE.FogExp2(0x040303, 0.012);
scene.environment = studioEnvironment(renderer, {
  top: 0x14110d, bottom: 0x030302, blur: 0.03,
  panels: [
    { pos: [-2, 10, 3], size: [6, 3], intensity: 5.5, color: 0xfff0dc },    // the lamp's diffuser, overhead
    { pos: [-9, 3.2, 3], size: [1.3, 6.5], intensity: 5, color: 0xffe6c6 },   // tall warm strip, left
    { pos: [9, 3.5, -2.5], size: [1.1, 6.5], intensity: 3.6, color: 0xdfe6ff }, // cool strip, right
    { pos: [0, 1.6, -10], size: [9, 1.1], intensity: 1.6, color: 0xffffff },  // low kicker behind Black
    { pos: [2, 1.2, 10], size: [6, 0.8], intensity: 0.9, color: 0xffe0c0 },   // low kicker behind White
  ],
});
scene.environmentIntensity = 0.4;
scene.add(new THREE.HemisphereLight(0x303848, 0x0c0906, 0.03));

const assets = new Assets();
const pointer = new Pointer({ lambda: 5 });

// ─── Loader ────────────────────────────────────────────────────────────────────
const loaderEl = document.querySelector('.loader');
const tour = buildTour(loaderEl.querySelector('.tour'));
const loader = preloader({
  assets, el: loaderEl, minTime: 1600,
  onValue: v => { loaderEl.querySelector('.loader-pct').textContent = Math.round(v * 100) + '%'; tour.set(v); },
  exit: async () => {
    await gsap.to(loaderEl.querySelector('.tour'), { scale: 0.92, opacity: 0, duration: 0.7, ease: 'power2.in' });
    startIntro();
    await gsap.to(loaderEl, { autoAlpha: 0, duration: 1.1, ease: 'power2.inOut' });
  },
});

// ─── Lights ────────────────────────────────────────────────────────────────────
// Key: one lamp above and to White's left, as over a salon table.
const key = new THREE.SpotLight(0xffe0ba, 0, 0, 0.5, 0.62, 2);
key.position.set(-3.0, 15, 8.0);
key.target.position.set(0.4, 0, -0.2);
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
key.shadow.camera.near = 8; key.shadow.camera.far = 30;
key.shadow.bias = -0.00008; key.shadow.normalBias = 0.018; key.shadow.radius = 2.5;
scene.add(key, key.target);
const KEY_ON = 1500;
vol.add(key, { scale: 0.0016, range: 0.004, softness: 0.4 });
// Rims ride with the camera so every silhouette keeps an edge, including black marble against black.
const rimA = new THREE.SpotLight(0xcfdcff, 0, 0, 0.55, 0.85, 2);
const rimB = new THREE.SpotLight(0xffd3a0, 0, 0, 0.55, 0.85, 2);
scene.add(rimA, rimA.target, rimB, rimB.target);
const RIM_A = 230, RIM_B = 150;
const lights = { k: 0 };

// ─── Board ─────────────────────────────────────────────────────────────────────
const reflection = new PlanarReflection(renderer, { resolution: MOBILE ? 0.4 : 0.5 });
engine.onResize((w, h, dpr) => reflection.setSize(w, h, dpr));
function onTopOnly(mat) {
  // Reflection only on the horizontal top face (world y ~ 0), not on the board's sides.
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('outgoingLight += refl * uReflTint', 'outgoingLight += step(-0.004, vReflW.y) * refl * uReflTint');
  };
}
const bt = boardTextures(renderer);
// Physical so the analytic highlight can be tamed (specularIntensity) while the planar mirror stays crisp.
const boardMat = new THREE.MeshPhysicalMaterial({ map: bt.albedo, roughnessMap: bt.rough, roughness: 1, metalness: 0, envMapIntensity: 0.4, specularIntensity: 0.08 });
if (!DBG.has('norefl')) reflection.patch(boardMat, { strength: 1.05, distort: 0.002, lodScale: 5, lodBias: 0.0, f0: 0.05 });
{
  const prev = boardMat.onBeforeCompile;
  boardMat.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    if (!sh.fragmentShader.includes('vReflW')) {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vReflW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvReflW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vReflW;');
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', `
        vec4 sampledDiffuseColor = texture2D(map, vMapUv);
        sampledDiffuseColor.rgb *= sampledDiffuseColor.rgb;
        diffuseColor *= sampledDiffuseColor;
        vec2 gq = abs(fract(vReflW.xz + 4.0) - 0.5);
        float gE = 0.5 - max(gq.x, gq.y);
        float gSeam = 1.0 - smoothstep(0.0, 0.0065, gE);
        diffuseColor.rgb *= 1.0 - gSeam * 0.6;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(max(roughnessFactor, 0.1), 0.55, gSeam);`);
  };
  boardMat.customProgramCacheKey = () => 'gambit-board';
}
const board = new THREE.Group();
scene.add(board);
const field = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), boardMat);
field.rotation.x = -Math.PI / 2;
field.receiveShadow = true;
board.add(field);

const brassMat = new THREE.MeshStandardMaterial({ color: BRASS.clone().convertSRGBToLinear().multiplyScalar(1.15), metalness: 1, roughness: 0.26, envMapIntensity: 1.6 });
// The brass fillet is a ring of four strips (a full plane under the field z-fights from far away).
const fillet = new THREE.Group();
for (const [w, d, x, z] of [[8 + INLAY * 2, INLAY, 0, 4 + INLAY / 2], [8 + INLAY * 2, INLAY, 0, -4 - INLAY / 2], [INLAY, 8, 4 + INLAY / 2, 0], [INLAY, 8, -4 - INLAY / 2, 0]]) {
  const s = new THREE.Mesh(new THREE.PlaneGeometry(w, d), brassMat);
  s.rotation.x = -Math.PI / 2; s.position.set(x, 0, z); s.receiveShadow = true;
  fillet.add(s);
}
board.add(fillet);

const wt = walnutTextures(renderer);
const walnutMat = new THREE.MeshPhysicalMaterial({ map: wt.albedo, normalMap: wt.normal, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.42, metalness: 0,
  clearcoat: 0.8, clearcoatRoughness: 0.14, envMapIntensity: 0.7 });
{
  walnutMat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      vec4 sampledDiffuseColor = texture2D(map, vMapUv);
      sampledDiffuseColor.rgb *= sampledDiffuseColor.rgb;
      diffuseColor *= sampledDiffuseColor;`);
  };
  if (!DBG.has('norefl')) {
    const own = walnutMat.onBeforeCompile;
    reflection.patch(walnutMat, { strength: 0.55, distort: 0.01, lodScale: 6, lodBias: 0.6, f0: 0.04 });
    const refl = walnutMat.onBeforeCompile;
    walnutMat.onBeforeCompile = (sh, r) => { own(sh, r); refl(sh, r); };
    onTopOnly(walnutMat);
  }
  walnutMat.customProgramCacheKey = () => 'gambit-walnut';
}
{
  const L = 8 + INLAY * 2 + FRAME * 2;
  for (const s of [-1, 1]) {
    const a = new THREE.Mesh(new RoundedBoxGeometry(L, TH, FRAME, 2, 0.028), walnutMat);
    a.position.set(0, -TH / 2, s * (4 + INLAY + FRAME / 2));
    const b = new THREE.Mesh(new RoundedBoxGeometry(8 + INLAY * 2, TH, FRAME, 2, 0.028), walnutMat);
    b.rotation.y = Math.PI / 2;
    b.position.set(s * (4 + INLAY + FRAME / 2), -TH / 2, 0);
    for (const m of [a, b]) { m.castShadow = m.receiveShadow = true; board.add(m); reflection.hidden.push(m); }
  }
  const core = new THREE.Mesh(new THREE.BoxGeometry(8 + INLAY * 2, TH - 0.01, 8 + INLAY * 2), walnutMat);
  core.position.y = -TH / 2 - 0.006; core.castShadow = true; reflection.hidden.push(core);
  board.add(core);
}
let coordMesh;
function buildCoordinates() {
  const tex = coordinateTexture(INLAY + FRAME);
  const mat = new THREE.MeshStandardMaterial({ color: BRASS.clone().convertSRGBToLinear().multiplyScalar(1.1), metalness: 1, roughness: 0.3, alphaMap: tex,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, envMapIntensity: 1.5 });
  coordMesh = new THREE.Mesh(new THREE.PlaneGeometry(EDGE * 2, EDGE * 2), mat);
  coordMesh.rotation.x = -Math.PI / 2; coordMesh.position.y = 0.0004;
  coordMesh.receiveShadow = true;
  board.add(coordMesh);
  reflection.hidden.push(coordMesh);
}

// Highlights: last move, check, the mating net, the square under a lifted piece, and landing ripples.
const HN = 12;
const hlMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  uniforms: { uH: { value: Array.from({ length: HN }, () => new THREE.Vector4(0, 0, 0, 0)) }, uRip: { value: new THREE.Vector4(0, 0, 99, 0) }, uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vW = (modelMatrix * vec4(position, 1.)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `
    uniform vec4 uH[${HN}]; uniform vec4 uRip; uniform float uTime; varying vec2 vUv; varying vec3 vW;
    void main(){
      vec2 g = vUv * 8.0; vec2 id = floor(g); vec2 f = fract(g);
      float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
      vec3 col = vec3(0.0);
      for (int i = 0; i < ${HN}; i++) {
        vec4 h = uH[i];
        if (h.z < 0.002) continue;
        if (abs(id.x - h.x) > 0.5 || abs(id.y - h.y) > 0.5) continue;
        float line = smoothstep(0.052, 0.042, edge) * smoothstep(0.026, 0.034, edge);
        float glow = exp(-edge * 9.0);
        float fill = 1.0;
        vec3 c; float a;
        if (h.w < 1.5)      { c = vec3(0.62, 0.47, 0.25); a = fill * 0.045 + line * 0.35; }                 // from
        else if (h.w < 2.5) { c = vec3(0.80, 0.62, 0.33); a = fill * 0.08 + line * 0.9 + glow * 0.12; }     // to
        else if (h.w < 3.5) { c = vec3(0.85, 0.22, 0.14); float r = length(f - 0.5); a = exp(-r * r * 7.0) * 0.55 + line * 0.5; } // check
        else if (h.w < 4.5) { c = vec3(0.85, 0.66, 0.36); a = line * 1.1 + glow * 0.2; }                   // attacker
        else if (h.w < 5.5) { c = vec3(0.7, 0.55, 0.32);  a = line * 0.45 + fill * 0.03; }                 // covered
        else if (h.w < 6.5) { c = vec3(0.86, 0.70, 0.42); a = line * 1.0 + fill * 0.07 + glow * 0.15; }    // hover
        else                { c = vec3(0.9, 0.3, 0.2);    a = line * 1.0 + fill * 0.08; }                   // capture target
        col += c * a * h.z;
      }
      float age = uRip.z;
      if (age < 2.0) {
        float r = length(vW.xz - uRip.xy);
        float rx = (r - 0.18 - age * 1.9) / 0.035;  // (no pow() on a negative base: NaN on D3D)
        float ring = exp(-rx * rx) * exp(-age * 2.6) * uRip.w;
        col += vec3(0.85, 0.66, 0.38) * ring * 0.55;
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const hl = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), hlMat);
hl.rotation.x = -Math.PI / 2; hl.position.y = 0.0012; hl.renderOrder = 2;
board.add(hl);
reflection.hidden.push(hl, field, ...fillet.children);

// Our table: a round leather top with a walnut rim, one of twelve in the salon.
const lt = leatherTextures(renderer);
lt.normal.repeat.set(14, 14); lt.rough.repeat.set(2, 2);
const TABLE_R = 8.85;
const table = new THREE.Mesh(new THREE.CircleGeometry(TABLE_R, 128), new THREE.MeshStandardMaterial({ color: 0x0d0b0a, roughness: 1, roughnessMap: lt.rough, normalMap: lt.normal, normalScale: new THREE.Vector2(0.14, 0.14), envMapIntensity: 0.2 }));
table.rotation.x = -Math.PI / 2; table.position.y = TABLE_Y; table.receiveShadow = true;
scene.add(table);
{
  const ring = new THREE.Mesh(new THREE.RingGeometry(TABLE_R, 9.4, 128, 1), walnutMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = TABLE_Y; ring.receiveShadow = true;
  const side = new THREE.Mesh(new THREE.CylinderGeometry(9.4, 9.2, 0.36, 128, 1, true), walnutMat);
  side.position.y = TABLE_Y - 0.18; side.receiveShadow = true;
  scene.add(ring, side);
  reflection.hidden.push(ring, side);
}

// The salon beyond: warm lamps far away that turn into bokeh in the low shots and sparkle in the board.
const orbs = [];
{
  const g = new THREE.SphereGeometry(0.11, 12, 8);
  const rnd = mulberry(7);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, r = 40 + rnd() * 38;
    const k = 5 + rnd() * 9;
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.66, 0.36).multiplyScalar(k), fog: false }));
    m.userData.k = k;
    m.position.set(Math.cos(a) * r, 2.2 + rnd() * 9, Math.sin(a) * r);
    m.scale.setScalar((0.7 + rnd() * 0.9) * r / 24);
    scene.add(m);
    orbs.push(m);
  }
}

// Dust that only exists inside the lamp's cone.
const dust = (() => {
  const N = MOBILE ? 900 : 2200;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  const rnd = mulberry(99);
  for (let i = 0; i < N; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 8;
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = rnd() * 7; pos[i * 3 + 2] = Math.sin(a) * r;
    seed[i] = rnd();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uLPos: { value: key.position }, uLDir: { value: new THREE.Vector3() }, uPower: { value: 0 }, uDpr: { value: 1 } },
    vertexShader: `
      attribute float seed; uniform float uTime, uPower, uDpr; uniform vec3 uLPos, uLDir; varying float vA;
      void main(){
        vec3 p = position;
        float t = uTime * (0.03 + seed * 0.05);
        p += vec3(sin(t * 3.1 + seed * 40.0), sin(t * 2.3 + seed * 13.0) * 0.5 + t * 0.2, cos(t * 2.7 + seed * 27.0)) * 0.6;
        p.y = mod(p.y, 7.0) + 0.05;
        vec3 d = p - uLPos; float dist = length(d);
        float cone = smoothstep(0.93, 0.985, dot(d / dist, uLDir));
        vA = cone * uPower * (0.35 + 0.65 * fract(seed * 91.7)) * smoothstep(0.0, 0.6, p.y);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.0 + seed * 2.2) * uDpr * (6.0 / -mv.z);
      }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(1.0, 0.85, 0.62) * a * vA * 0.45, 1.0); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  reflection.hidden.push(pts);
  engine.onResize((w, h, dpr) => { mat.uniforms.uDpr.value = dpr; });
  return mat;
})();

// ─── Pieces ────────────────────────────────────────────────────────────────────
const PIECES = initialPieces();
const { states, plies } = replay(PIECES);
const byId = {};
const TYPES = {};
const typeLoads = Object.entries(FILES_GLB).map(([type, file]) => assets.gltf(`models/gambit/${file}.glb`).then(g => { TYPES[type] = prepType(type, g.scene); }));
const FAR = {};
const farLoads = Object.keys(FILES_GLB).map(type => assets.gltf(`models/gambit/far-${type}.glb`).then(g => { FAR[type] = g.scene; }));

function toFloatGeometry(src, matrix) {
  const geo = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = src.getAttribute(name);
    if (!a) continue;
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) arr[i * a.itemSize + j] = a.getComponent(i, j);
    geo.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  geo.setIndex(src.index ? new THREE.BufferAttribute(src.index.array.slice(), 1) : null);
  geo.applyMatrix4(matrix);
  return geo;
}

function prepType(type, root) {
  root.updateMatrixWorld(true);
  const mesh = firstMesh(root);
  const geo = toFloatGeometry(mesh.geometry, mesh.matrixWorld);
  geo.computeBoundingBox();
  const bb = geo.boundingBox, h0 = bb.max.y - bb.min.y;
  const pos = geo.attributes.position;
  // Base centre from the bottom ring of vertices (the knight's head would skew a bounding-box centre).
  let cx = 0, cz = 0, n = 0;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < bb.min.y + h0 * 0.03) { cx += pos.getX(i); cz += pos.getZ(i); n++; }
  cx /= n; cz /= n;
  let rB = 0;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < bb.min.y + h0 * 0.03) rB = Math.max(rB, Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz));
  let s = HEIGHTS[type] / h0;
  s = Math.min(s, MAX_BASE[type] / (rB * 2));
  geo.translate(-cx, -bb.min.y, -cz);
  geo.scale(s, s, s);
  geo.computeBoundingSphere();
  const h = h0 * s;
  rB *= s;
  // Resting angle when it lies down: rotate about the base rim until another point touches the floor.
  const rest = restAngle(geo, rB);
  const src = mesh.material;
  const aniso = renderer.capabilities.getMaxAnisotropy();
  for (const k of ['map', 'normalMap', 'roughnessMap']) if (src[k]) src[k].anisotropy = aniso;
  const mats = { w: marbleMaterial(src, { envIntensity: 0.9 }), b: marbleMaterial(src, { black: true, envIntensity: 1.25, veins: type === 'king' || type === 'queen' ? [0.26, 0.6] : [0.1, 0.42] }) };
  return { type, geo, h, rB, rest, mats, xf: { cx, cz, y0: bb.min.y, s } };
}

function restAngle(geo, rB) {
  const p = geo.attributes.position;
  const step = Math.max(1, Math.floor(p.count / 5000));
  const xs = [], ys = [];
  for (let i = 0; i < p.count; i += step) {
    const rx = p.getX(i) - rB, ry = p.getY(i);
    if (rx * rx + ry * ry < 0.0025) continue;
    xs.push(rx); ys.push(ry);
  }
  let prev = 0;
  for (let a = 0.5 * D; a < 140 * D; a += 0.25 * D) {
    const c = Math.cos(a), sn = Math.sin(a);
    let lo = Infinity;
    for (let i = 0; i < xs.length; i++) { const y = -sn * xs[i] + c * ys[i]; if (y < lo) lo = y; }
    if (lo < -0.002) return prev;
    prev = a;
  }
  return Math.PI / 2;
}

function makePieces() {
  const rnd = mulberry(1851);
  for (const p of PIECES) {
    const T = TYPES[p.type];
    const mesh = new THREE.Mesh(T.geo, T.mats[p.color]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    // Everything faces the opponent (models face +Z). Round pieces get a random turn so the veining differs.
    const face = p.color === 'w' ? Math.PI : 0;
    const round = p.type === 'pawn' || p.type === 'rook';
    const yaw = round ? rnd() * Math.PI * 2 : face + (rnd() - 0.5) * (p.type === 'knight' ? 0.12 : 0.3);
    Object.assign(p, { T, mesh, yaw, jit: rnd() - 0.5, pos: new THREE.Vector3(), quat: new THREE.Quaternion(),
      fp: new THREE.Vector3(), fq: new THREE.Quaternion(), drop: 0 });
    byId[p.id] = p;
  }
}

// ─── Poses ─────────────────────────────────────────────────────────────────────
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _axis = new THREE.Vector3();
const sqPos = (sq, out) => { const [x, z] = squareXZ(sq); return out.set(x, 0, z); };
const ease = {
  io3: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  io2: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  sine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  fall: t => { if (t < 0.8) { const a = t / 0.8; return a * a; } const b = (t - 0.8) / 0.2; return 1 - Math.sin(b * Math.PI) * 0.04 * (1 - b); },
};
function upright(p, pos, oP, oQ) { oP.copy(pos); oQ.setFromAxisAngle(UP, p.yaw); }
/** Tip a piece whose base centre sits at `anchor` toward horizontal `dir` by `angle`, around its base rim. */
function tipPose(p, anchor, dir, angle, yaw, oP, oQ) {
  _axis.set(dir.z, 0, -dir.x).normalize();
  _q1.setFromAxisAngle(_axis, angle);
  oQ.copy(_q1).multiply(_q2.setFromAxisAngle(UP, yaw));
  _v1.copy(dir).multiplyScalar(p.T.rB);
  oP.copy(anchor).add(_v1).sub(_v1.applyQuaternion(_q1));
}
/** Where captured pieces settle: lying on the table beside the board, White's losses on the kingside. */
function gravePose(p, i, oP, oQ) {
  const side = p.color === 'w' ? 1 : -1;
  const row = Math.floor(i / 8), col = i % 8;
  const dir = _v3.set(side, 0, p.jit * 0.5).normalize();
  const z = side * (3.15 - col * 0.9) + p.jit * 0.1;
  _v4.set(side * (EDGE + 0.42 + row * 2.05), TABLE_Y, z);
  const yaw = Math.atan2(-dir.z, dir.x) + (p.type === 'knight' ? 0 : p.jit * 2);
  tipPose(p, _v4, dir, p.T.rest, yaw, oP, oQ);
}
function restPose(p, st, oP, oQ) {
  const sq = st.sq[p.id];
  if (sq) upright(p, sqPos(sq, _v2), oP, oQ);
  else gravePose(p, st.grave[p.id], oP, oQ);
}
/** Rotate a pose about a point at height `ph` above its base by quaternion q (lean, pitch). */
function lean(oP, oQ, axis, angle, ph) {
  _q3.setFromAxisAngle(axis, angle);
  oQ.premultiply(_q3);
  _v1.set(0, ph, 0);
  oP.add(_v1).sub(_v1.applyQuaternion(_q3));
}
// Tempo per ply; the great moments play slower (the leap into g7 is nearly slow motion).
const SLOW = { 34: 1.35, 40: 2.2, 42: 1.6, 44: 1.7 };
const DUR = plies.map((p, k) => SLOW[k] ?? (p.victim ? 1.45 : p.knight ? 1.2 : 1));
const EPI_DIR = new THREE.Vector3(1, 0, 0.14).normalize();
const toppleTmp = { p: new THREE.Vector3(), q: new THREE.Quaternion() };

function moverPose(p, ply, u, oP, oQ) {
  const from = sqPos(ply.from, _v2), to = sqPos(ply.to, _v3);
  const dist = from.distanceTo(to);
  const dir = _v4.subVectors(to, from).normalize();
  _axis.set(dir.z, 0, -dir.x);
  const axis = _axis.clone();
  if (ply.knight) {
    const e = ease.io2(u);
    oP.lerpVectors(from, to, e);
    oP.y = (1.05 + dist * 0.14) * Math.pow(Math.sin(Math.PI * e), 0.92);
    oQ.setFromAxisAngle(UP, p.yaw);
    lean(oP, oQ, axis, -0.46 * Math.sin(2 * Math.PI * e), p.T.h * 0.45);
  } else {
    const e = ease.io3(u);
    oP.lerpVectors(from, to, e);
    oP.y = 0.03 * Math.sin(Math.PI * e);
    oQ.setFromAxisAngle(UP, p.yaw);
    lean(oP, oQ, axis, -0.075 * Math.sin(2 * Math.PI * e) * Math.min(1, dist / 1.6), 0);
  }
}

function victimPose(p, ply, u, oP, oQ, slot) {
  const at = sqPos(ply.to, _v2).clone();
  const dir = _v3.subVectors(at, sqPos(ply.from, _v4)).setY(0).normalize().clone();
  const tU = clamp((u - 0.46) / 0.2), gU = clamp((u - 0.64) / 0.36);
  tipPose(p, at, dir, p.T.rest * ease.fall(tU), p.yaw, oP, oQ);
  if (gU <= 0) return;
  toppleTmp.p.copy(oP); toppleTmp.q.copy(oQ);
  gravePose(p, slot, oP, oQ);
  const g = ease.io3(gU);
  const d = toppleTmp.p.distanceTo(oP);
  oP.lerpVectors(toppleTmp.p, oP, g);
  oP.y += Math.sin(Math.PI * g) * (0.85 + d * 0.07);
  oQ.slerpQuaternions(toppleTmp.q, oQ.clone(), g);
}

function replayPose(p, P, oP, oQ) {
  const Pc = clamp(P, 0, END_P);
  const k = Math.min(Math.floor(Pc), PLY_COUNT);
  if (k === PLY_COUNT) {
    restPose(p, states[PLY_COUNT], oP, oQ);
    if (p.id === 'be8') tipPose(p, sqPos('d8', _v2).clone(), EPI_DIR, p.T.rest * ease.fall(clamp((Pc - k) / 0.9)), p.yaw, oP, oQ);
    return;
  }
  const u = Pc - k, ply = plies[k];
  if (p.id === ply.mover) moverPose(p, ply, ply.victim ? clamp(u / 0.62) : u, oP, oQ);
  else if (p.id === ply.victim) victimPose(p, ply, u, oP, oQ, states[k + 1].grave[p.id]);
  else restPose(p, states[k], oP, oQ);
}

// ─── Knight trail ─────────────────────────────────────────────────────────────
class Arc extends THREE.Curve {
  constructor(a, b, h) { super(); this.a = a; this.b = b; this.h = h; }
  getPoint(t, out = new THREE.Vector3()) {
    out.lerpVectors(this.a, this.b, t);
    out.y = this.h * Math.pow(Math.sin(Math.PI * t), 0.92) + 0.02;
    return out;
  }
}
const trailMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  uniforms: { uHead: { value: 0 }, uAlpha: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `uniform float uHead, uAlpha; varying vec2 vUv;
    void main(){
      float s = vUv.x;
      float a = smoothstep(uHead - 0.7, uHead, s) * (1.0 - smoothstep(uHead, uHead + 0.01, s));
      a = max(a * 1.0, (1.0 - smoothstep(0.0, 1.0, abs(s - uHead) * 60.0)) * 1.5 * step(0.001, uHead) * step(uHead, 0.999));
      a *= smoothstep(0.0, 0.05, s) * smoothstep(1.0, 0.95, s);
      gl_FragColor = vec4(vec3(1.0, 0.76, 0.42) * a * uAlpha * 2.2, 1.0);
    }`,
});
const trail = new THREE.Mesh(new THREE.BufferGeometry(), trailMat);
trail.frustumCulled = false;
scene.add(trail);
reflection.hidden.push(trail);
let trailPly = -1;
function updateTrail(P) {
  const k = Math.floor(P), u = P - k;
  const ply = plies[k];
  if (!ply?.knight || u <= 0) { trailMat.uniforms.uAlpha.value = damp(trailMat.uniforms.uAlpha.value, 0, 5, 1 / 60); return; }
  if (trailPly !== k) {
    trailPly = k;
    const a = sqPos(ply.from, new THREE.Vector3()), b = sqPos(ply.to, new THREE.Vector3());
    trail.geometry.dispose();
    trail.geometry = new THREE.TubeGeometry(new Arc(a, b, (1.05 + a.distanceTo(b) * 0.14) + byId[ply.mover].T.h * 0.02), 90, 0.007, 6, false);
  }
  const mu = ply.victim ? clamp(u / 0.62) : u;
  trailMat.uniforms.uHead.value = ease.io2(mu);
  trailMat.uniforms.uAlpha.value = smooth(0, 0.08, mu) * (1 - smooth(0.9, 1, mu) * 0.6);
}

// ─── Camera ────────────────────────────────────────────────────────────────────
// Shots for the replay, keyed by the ply they frame (0 = 1.e4). [az, el, dist, tx, tz]
const SHOTS = [
  [0, [20, 17, 11, 0.4, 0.5]],
  [2, [30, 19, 9.4, 1.0, 0.8]],
  [4, [36, 22, 8.8, 0.8, 1.5]],
  [5, [66, 10, 7.6, 2.2, 1.4]],     // Qh4+ — down the diagonal at the king
  [6, [42, 17, 7.0, 1.3, 2.6]],
  [7, [-40, 16, 7.4, -2.0, -0.4]],  // the queenside skirmish
  [9, [-12, 24, 8.6, 0.4, -1.0]],
  [10, [40, 22, 8.8, 1.9, 1.2]],
  [12, [72, 18, 8.2, 2.0, 0.6]],    // knights on the rim
  [16, [56, 14, 7.4, 1.4, -0.4]],
  [18, [78, 13, 7.0, 2.4, 0.2]],
  [20, [18, 30, 10.8, 0.0, 0.8]],   // Rg1 — the bishop is left to die
  [21, [-52, 14, 6.4, -2.4, -0.6]],
  [22, [86, 12, 7.6, 2.6, 0.0]],    // the h-pawn hunts the queen
  [26, [30, 21, 8.2, 1.2, 1.2]],
  [28, [50, 15, 7.0, 1.4, 0.4]],
  [30, [-26, 26, 9.4, -1.0, 0.6]],
  [32, [-14, 30, 9.2, -1.0, 0.0]],
  [33, [-30, 44, 10.8, -1.2, 0.8]],
  [34, [0, 57, 12.6, 0.0, 1.1]],    // Bd6!! — from above White's back rank: both rooks en prise
  [35, [16, 54, 12.2, 0.6, 1.3]],
  [36, [-8, 52, 12.2, -0.3, 1.0]],
  [37, [-30, 50, 11.4, -1.2, 1.8]],
  [38, [30, 26, 8.4, 1.0, 1.8]],
  [39, [-36, 22, 8.4, -1.6, -1.4]],
  [40, [72, 7, 7.3, 2.0, -1.5]], // Nxg7+ — the leap, low across the board
  [41, [160, 18, 7.0, 0.2, -2.8]],
  [42, [66, 21, 7.4, 1.2, -1.1]],   // Qf6+!! — the queen goes
  [43, [76, 13, 6.6, 1.3, -1.8]],
  [44, [198, 40, 7.8, 0.3, -2.3]],  // Be7# — the net, from behind the black king
  [45, [214, 36, 8.4, 0.4, -2.5]],  // the king lies down
];
const shotAt = [];
for (let k = 0, j = 0; k <= END_P; k++) { while (j + 1 < SHOTS.length && SHOTS[j + 1][0] <= k) j++; shotAt[k] = SHOTS[j][1]; }
const rig = () => ({ az: 0, el: 20, d: 10, tx: 0, ty: 0, tz: 0, shift: 0, fov: 30, bokeh: 2, range: 0.5 });
function lerpRig(a, b, f, o = rig()) {
  let daz = b.az - a.az; daz = ((daz + 540) % 360) - 180;
  o.az = a.az + daz * f;
  for (const k of ['el', 'd', 'tx', 'ty', 'tz', 'shift', 'fov', 'bokeh', 'range']) o[k] = lerp(a[k], b[k], f);
  return o;
}
function fromShot(s, o) { Object.assign(o, { az: s[0], el: s[1], d: s[2], tx: s[3], tz: s[4], ty: 0.25 }); return o; }
const shiftReplay = () => (MOBILE ? 0 : 0.09);
// Pieces low and to the right; the copy owns the dark room above-left. On phones the board sits in the lower third.
const heroRig = MOBILE
  ? Object.assign(rig(), { az: 28, el: -1, d: 5.2, tx: 0.8, ty: 2.0, tz: 3.1, shift: 0, bokeh: 3.6, range: 0.32 })
  : Object.assign(rig(), { az: 56, el: 5, d: 8.4, tx: 2.4, ty: 1.6, tz: 1.3, shift: -0.37, bokeh: 4, range: 0.3 });
const introRig = Object.assign(rig(), { az: -28, el: 46, d: 19, tx: 0, ty: 0, tz: 0.2, shift: 0, bokeh: 1, range: 0.6 });
const freeRig = Object.assign(rig(), { az: 0, el: MOBILE ? 66 : 54, d: MOBILE ? 29 : 16.4, tx: MOBILE ? 0 : 0.2, ty: 0, tz: MOBILE ? -1.4 : 0.7, shift: MOBILE ? 0 : -0.15, bokeh: 1.2, range: 0.7 });
const setRig = Object.assign(rig(), { az: 36, el: 12, d: 9.4, tx: 1.4, ty: 0.3, tz: 1.3, shift: MOBILE ? 0 : -0.2, bokeh: 3.6, range: 0.3 });
const salonRig = Object.assign(rig(), { az: -30, el: 33, d: 58, tx: 9, ty: 0, tz: 2, shift: MOBILE ? 0 : 0.2, bokeh: 1.4, range: 0.9 });
const footRig = Object.assign(rig(), { az: 22, el: 20, d: 44, tx: 4, ty: 0, tz: 0, shift: 0, bokeh: 2.4, range: 0.4 });
const _ra = rig(), _rb = rig(), _rc = rig();
function replayRig(P, action, o) {
  const k = clamp(Math.floor(P), 0, END_P), u = P - k;
  fromShot(shotAt[Math.max(0, k - 1)], _ra);
  fromShot(shotAt[k], _rb);
  lerpRig(_ra, _rb, smooth(0, 0.5, u), o);
  const close = clamp((12 - o.d) / 6);
  o.shift = shiftReplay() * (0.6 + 0.4 * (1 - close));
  o.bokeh = lerp(1.2, 3.4, close);
  o.range = lerp(0.6, 0.32, close);
  o.fov = 30;
  if (action) { o.tx = lerp(o.tx, action.x, 0.22); o.tz = lerp(o.tz, action.z, 0.22); o.ty = lerp(o.ty, action.y * 0.5 + 0.2, 0.3); }
  return o;
}
const cam = rig();
const camT = new THREE.Vector3();
let camInit = false;

// ─── Scroll structure ──────────────────────────────────────────────────────────
const secEls = ['.hero', '.replay', '.free', '.set', '.salon', '.foot'].map(s => document.querySelector(s));
let tops = [];
function measure() { tops = secEls.map(el => el.getBoundingClientRect().top + scrollY); }
addEventListener('resize', measure);
const replayEl = secEls[1];
const GRADES = [
  { gl: 0.78, gr: 0, gb: 0.5 },   // hero
  { gl: 0.3, gr: 0.45, gb: 0.62 },// replay
  { gl: 0.72, gr: 0, gb: 0.25 },  // free
  { gl: 0.86, gr: 0, gb: 0.3 },   // set
  { gl: 0.1, gr: 0.85, gb: 0.3 }, // salon
  { gl: 0.3, gr: 0.3, gb: 0.9 },  // foot
];
function sectionCoord() {
  const y = scrollY, vh = innerHeight;
  let s = 0;
  for (let b = 1; b < tops.length; b++) s += smooth(tops[b] - vh * 0.85, tops[b] - vh * 0.08, y);
  return s;
}
// Replay progress -> target ply. The epilogue and a short hold close the section.
function targetPly() {
  const q = elementProgress(replayEl);
  return clamp(Math.round(q * (END_P + 1) - 0.25), 0, END_P);
}
function scrollForPly(t) {
  const r = replayEl.getBoundingClientRect();
  const top = r.top + scrollY, span = r.height - innerHeight;
  return top + span * clamp((t + 0.5) / (END_P + 1));
}

// ─── UI: score, caption, tag ───────────────────────────────────────────────────
const listEl = document.querySelector('.score-list');
const plyBtns = [];
for (let m = 0; m < Math.ceil(PLY_COUNT / 2); m++) {
  const li = document.createElement('li');
  li.innerHTML = `<span class="n">${m + 1}.</span>`;
  for (const k of [2 * m, 2 * m + 1]) {
    if (k >= PLY_COUNT) { li.appendChild(document.createElement('span')); continue; }
    const b = document.createElement('button');
    b.type = 'button';
    const san = PLIES[k][2];
    const mark = san.match(/[!?]+$/)?.[0];
    b.textContent = mark ? san.slice(0, -mark.length) : san;
    if (mark) { b.classList.add('big'); b.dataset.mark = mark; }
    b.setAttribute('aria-label', `Move ${m + 1}${k % 2 ? ', Black' : ', White'}: ${san}`);
    b.addEventListener('click', () => window.__lenis?.scrollTo(scrollForPly(k + 1), { duration: 1.4 }));
    li.appendChild(b);
    plyBtns[k] = b;
  }
  listEl.appendChild(li);
}
const scoreWin = document.querySelector('.score-window');
const barEl = document.querySelector('.score-bar i');
const moveEl = document.querySelector('.score-move'), countEl = document.querySelector('.score-count');
const capNum = document.querySelector('.caption-num'), capText = document.querySelector('.caption-text'), capNote = document.querySelector('.caption-note');
const tagEl = document.querySelector('.tag'), tagSan = document.querySelector('.tag-san');
let shownPly = -2, listY = 0;
function setCaption(kc) {
  if (kc === shownPly) return;
  const dirUp = kc > shownPly;
  shownPly = kc;
  let num, text, note;
  if (kc < 0) { num = 'White to move'; text = '1.'; note = 'The pieces are set. London, a June afternoon, 1851. Scroll to play each move.'; }
  else if (kc >= PLY_COUNT) { num = '1–0'; text = 'Immortal.'; note = EPILOGUE; }
  else { const m = Math.floor(kc / 2) + 1; num = `${m}${kc % 2 ? '…' : '.'} ${kc % 2 ? 'Black' : 'White'}`; text = PLIES[kc][2]; note = PLIES[kc][3]; }
  const els = [capNum.parentElement, capNote];
  gsap.killTweensOf(els);
  gsap.to(els, { y: dirUp ? -14 : 14, opacity: 0, duration: 0.18, ease: 'power2.in', stagger: 0.03, onComplete: () => {
    capNum.textContent = num; capText.textContent = text; capNote.textContent = note;
    gsap.fromTo(els, { y: dirUp ? 18 : -18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'expo.out', stagger: 0.05 });
  } });
  plyBtns.forEach((b, i) => { b.classList.toggle('on', i === kc); b.classList.toggle('done', i < kc); });
  if (kc < 0) { moveEl.textContent = 'Before the first move'; countEl.textContent = '0 / 23'; }
  else if (kc >= PLY_COUNT) { moveEl.textContent = 'Checkmate · 1–0'; countEl.textContent = '23 / 23'; }
  else { moveEl.textContent = kc % 2 ? 'Black moves' : 'White moves'; countEl.textContent = `${Math.floor(kc / 2) + 1} / 23`; }
}

// Set section: two cards anchored to the nearest white and black pieces.
const noteCards = [...document.querySelectorAll('.note-card')];

// ─── Free play ────────────────────────────────────────────────────────────────
const free = { inited: false, W: 0, active: false, board: {}, drag: null, hover: null, hoverType: 6, dragged: false };
function freeTarget(p, st, oP, oQ) {
  if (st.lying) tipPose(p, sqPos(st.sq, _v2).clone(), st.dir ?? EPI_DIR, p.T.rest, p.yaw, oP, oQ);
  else if (st.sq) upright(p, sqPos(st.sq, _v2), oP, oQ);
  else gravePose(p, st.slot, oP, oQ);
}
function finalFreeStates() {
  const out = {};
  for (const p of PIECES) {
    const sq = states[PLY_COUNT].sq[p.id];
    out[p.id] = sq ? { sq, lying: p.id === 'be8', dir: EPI_DIR } : { sq: null, slot: states[PLY_COUNT].grave[p.id] };
  }
  return out;
}
function startFreeStates() {
  const out = {};
  for (const p of PIECES) out[p.id] = { sq: p.start };
  return out;
}
function rebuildFreeBoard() {
  free.board = {};
  for (const p of PIECES) if (p.fs.sq) free.board[p.fs.sq] = p.id;
}
function initFree() {
  free.inited = true;
  const fs = finalFreeStates();
  for (const p of PIECES) { p.fs = fs[p.id]; replayPose(p, END_P, p.fp, p.fq); }
  rebuildFreeBoard();
}
function nextSlot(color) {
  const used = new Set(PIECES.filter(p => p.color === color && p.fs && !p.fs.sq && p !== free.drag?.p).map(p => p.fs.slot));
  let i = 0; while (used.has(i)) i++;
  return i;
}
function flyTo(p, st, { dur = 0.9, arc = 0.6, delay = 0, ease: e = 'power2.inOut', land = true } = {}) {
  p.fs = st;
  const fromP = p.fp.clone(), fromQ = p.fq.clone();
  const toP = new THREE.Vector3(), toQ = new THREE.Quaternion();
  freeTarget(p, st, toP, toQ);
  p.tween?.kill();
  const o = { t: 0 };
  p.tween = gsap.to(o, { t: 1, duration: dur, delay, ease: e, onUpdate: () => {
    p.fp.lerpVectors(fromP, toP, o.t);
    p.fp.y += arc * Math.sin(Math.PI * o.t);
    p.fq.slerpQuaternions(fromQ, toQ, o.t);
  }, onComplete: () => { p.tween = null; if (land && st.sq) { sound.clack(0.8); ripple(toP.x, toP.z, 0.7); } } });
}
const arrP = new THREE.Vector3(), arrQ = new THREE.Quaternion();
function arrange(which) {
  const target = which === 'start' ? startFreeStates() : finalFreeStates();
  free.drag = null;
  const order = [...PIECES].sort((a, b) => (target[a.id].sq ? 1 : 0) - (target[b.id].sq ? 1 : 0) || a.id.localeCompare(b.id));
  order.forEach((p, i) => {
    freeTarget(p, target[p.id], arrP, arrQ);
    const d = p.fp.distanceTo(arrP);
    flyTo(p, target[p.id], { dur: 0.9 + Math.min(d, 8) * 0.06, arc: d < 0.05 ? 0 : 0.35 + Math.min(d, 8) * 0.12, delay: i * 0.028, land: false });
  });
  gsap.delayedCall(1.3, () => sound.clack(0.5));
  rebuildFreeBoardFrom(target);
}
function rebuildFreeBoardFrom(target) { free.board = {}; for (const [id, st] of Object.entries(target)) if (st.sq) free.board[st.sq] = id; }
document.querySelectorAll('[data-arrange]').forEach(b => b.addEventListener('click', () => {
  if (!free.inited) { P = END_P; initFree(); }
  arrange(b.dataset.arrange);
}));

// Picking: ray against a capsule around each piece's axis (fast, no triangle raycast needed).
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPt = new THREE.Vector3();
function pick(px, py) {
  ndc.set(px / innerWidth * 2 - 1, -(py / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  let best = null, bestT = Infinity;
  for (const p of PIECES) {
    const a = p.pos, b = _v1.set(0, p.T.h * 0.92, 0).applyQuaternion(p.quat).add(p.pos);
    const t = rayCapsule(o, d, a, b, Math.max(0.3, p.T.rB * 0.95));
    if (t < bestT) { bestT = t; best = p; }
  }
  return best;
}
function rayCapsule(o, d, a, b, r) {
  const ab = _v2.subVectors(b, a), ao = _v3.subVectors(o, a);
  const dd = d.dot(d), ee = ab.dot(ab), de = d.dot(ab), dao = d.dot(ao), eao = ab.dot(ao);
  const den = dd * ee - de * de;
  let t = den > 1e-6 ? (de * eao - ee * dao) / den : 0;
  t = Math.max(0, t);
  let s = clamp((eao + t * de) / ee);
  t = Math.max(0, (s * de - dao) / dd);
  const pc = _v4.copy(o).addScaledVector(d, t), qc = _v1.copy(a).addScaledVector(ab, s);
  return pc.distanceTo(qc) < r ? t : Infinity;
}
function rayBoard(px, py, y = 0) {
  ndc.set(px / innerWidth * 2 - 1, -(py / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  plane.constant = -y;
  return ray.ray.intersectPlane(plane, hitPt);
}
let cur;
addEventListener('pointerdown', e => {
  if (!free.active || e.button > 0 || e.target !== canvas) return;
  const p = pick(e.clientX, e.clientY);
  if (!p) return;
  p.tween?.kill(); p.tween = null;
  const from = { ...p.fs };
  if (p.fs.sq && free.board[p.fs.sq] === p.id) delete free.board[p.fs.sq];
  free.drag = { p, from, x: p.fp.x, z: p.fp.z, vx: 0, vz: 0 };
  free.dragged = true;
  p.fs = { sq: null, slot: -1, held: true };
  window.__lenis?.stop();
  document.body.classList.add('dragging', 'has-dragged');
  cur?.set('drag', 'Place');
  sound.lift();
  e.preventDefault();
});
addEventListener('pointermove', e => {
  if (free.drag) {
    const h = rayBoard(e.clientX, e.clientY, 0.0);
    if (h) { free.drag.x = clamp(h.x, -EDGE - 3, EDGE + 3); free.drag.z = clamp(h.z, -EDGE - 1, EDGE + 1); }
    return;
  }
  if (!free.active || e.target !== canvas) { if (free.hoverPiece) { free.hoverPiece = null; cur?.set(''); } return; }
  const p = pick(e.clientX, e.clientY);
  if (p !== free.hoverPiece) { free.hoverPiece = p; cur?.set(p ? 'drag' : '', p ? 'Lift' : ''); }
}, { passive: true });
addEventListener('touchmove', e => { if (free.drag) e.preventDefault(); }, { passive: false });
function endDrag() {
  const dr = free.drag;
  if (!dr) return;
  free.drag = null;
  const p = dr.p;
  window.__lenis?.start();
  document.body.classList.remove('dragging');
  cur?.set(free.hoverPiece ? 'drag' : '', free.hoverPiece ? 'Lift' : '');
  const sq = xzSquare(p.fp.x, p.fp.z);
  const occ = sq ? free.board[sq] : null;
  const back = () => {
    if (dr.from.sq) { free.board[dr.from.sq] = p.id; flyTo(p, { sq: dr.from.sq }, { dur: 0.6, arc: 0.3 }); }
    else flyTo(p, { sq: null, slot: nextSlot(p.color) }, { dur: 0.7, arc: 0.4, land: false });
  };
  if (!sq) { back(); return; }
  if (occ && byId[occ].color === p.color) { back(); return; }
  if (occ) capture(byId[occ], p);
  free.board[sq] = p.id;
  flyTo(p, { sq }, { dur: 0.32, arc: 0, ease: 'power2.in' });
}
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);
function capture(v, by) {
  const at = sqPos(v.fs.sq, new THREE.Vector3());
  const dir = new THREE.Vector3(at.x - by.fp.x, 0, at.z - by.fp.z);
  if (dir.lengthSq() < 1e-4) dir.set(v.color === 'w' ? 1 : -1, 0, 0);
  dir.normalize();
  delete free.board[v.fs.sq];
  const wasLying = v.fs.lying;
  const slot = nextSlot(v.color);
  v.fs = { sq: null, slot };
  v.tween?.kill();
  const fromP = v.fp.clone(), fromQ = v.fq.clone();
  const tp = new THREE.Vector3(), tq = new THREE.Quaternion(), gp = new THREE.Vector3(), gq = new THREE.Quaternion();
  if (wasLying) { tp.copy(fromP); tq.copy(fromQ); } else tipPose(v, at, dir, v.T.rest, v.yaw, tp, tq);
  gravePose(v, slot, gp, gq);
  const o = { t: 0 };
  sound.topple();
  v.tween = gsap.to(o, { t: 1, duration: 1.5, ease: 'none', delay: 0.18, onUpdate: () => {
    const a = clamp(o.t / 0.3), g = ease.io3(clamp((o.t - 0.28) / 0.72));
    if (!wasLying) tipPose(v, at, dir, v.T.rest * ease.fall(a), v.yaw, v.fp, v.fq);
    else { v.fp.copy(fromP); v.fq.copy(fromQ); }
    if (g > 0) {
      const d = tp.distanceTo(gp);
      v.fp.lerpVectors(tp, gp, g); v.fp.y += Math.sin(Math.PI * g) * (0.85 + d * 0.07);
      v.fq.slerpQuaternions(tq, gq, g);
    }
  }, onComplete: () => { v.tween = null; } });
}
function updateDrag(dt) {
  const dr = free.drag;
  if (!dr) return;
  const p = dr.p;
  const px = p.fp.x, pz = p.fp.z;
  p.fp.x = damp(p.fp.x, dr.x, 16, dt);
  p.fp.z = damp(p.fp.z, dr.z, 16, dt);
  p.fp.y = damp(p.fp.y, 0.78, 10, dt);
  dr.vx = damp(dr.vx, (p.fp.x - px) / Math.max(dt, 1e-3), 8, dt);
  dr.vz = damp(dr.vz, (p.fp.z - pz) / Math.max(dt, 1e-3), 8, dt);
  // Held from the crown: the base swings behind the motion.
  _q1.setFromAxisAngle(UP, p.yaw);
  _axis.set(dr.vz, 0, -dr.vx);
  const sp = _axis.length();
  if (sp > 1e-4) { _axis.divideScalar(sp); _q2.setFromAxisAngle(_axis, clamp(sp * 0.05, 0, 0.32)); _q1.premultiply(_q2); }
  p.fq.slerp(_q1, 1 - Math.exp(-12 * dt));
}

// ─── Effects: ripple and sound hooks ───────────────────────────────────────────
function ripple(x, z, s = 1) { hlMat.uniforms.uRip.value.set(x, z, 0, s); }

// ─── Frame loop ────────────────────────────────────────────────────────────────
let P = +(DBG.get('ply') ?? 0), T = 0;
let frozen = DBG.has('ply');
let lastP = P;
const action = new THREE.Vector3();
const hlList = [];
const sqIdx = sq => [FILES.indexOf(sq[0]), +sq[1] - 1];
function setHighlights(t) {
  hlList.length = 0;
  const kc = Math.ceil(P - 1e-4) - 1;
  const inFree = free.W > 0.5;
  if (!inFree && kc >= 0 && kc < PLY_COUNT) {
    const ply = plies[kc];
    const uIn = kc === Math.floor(P) ? P - kc : 1;
    hlList.push([ply.from, smooth(0, 0.3, uIn), 1], [ply.to, smooth(0.5, 0.95, uIn), 2]);
    if (ply.check && !ply.mate) {
      const ks = states[kc + 1].sq[ply.side === 'w' ? 'be8' : 'we1'];
      hlList.push([ks, smooth(0.7, 1, uIn), 3]);
    }
  }
  const net = inFree ? 0 : smooth(PLY_COUNT - 0.35, PLY_COUNT, P);
  if (net > 0) {
    const pulse = 0.78 + 0.22 * Math.sin(t * 2.2);
    hlList.push(['d8', net, 3], ['e7', net * pulse, 4], ['d5', net * pulse, 4], ['g7', net * pulse, 4], ['c7', net, 5], ['e8', net, 5]);
  }
  // Until the first lift, the white king's square breathes: "start here".
  if (free.active && !free.dragged && !free.drag && byId.we1?.fs?.sq) hlList.push([byId.we1.fs.sq, 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 3.2)), 6]);
  if (free.drag) {
    const sq = xzSquare(free.drag.p.fp.x, free.drag.p.fp.z);
    if (sq) { const occ = free.board[sq]; hlList.push([sq, 1, occ ? (byId[occ].color === free.drag.p.color ? 5 : 7) : 6]); }
  }
  const u = hlMat.uniforms.uH.value;
  for (let i = 0; i < HN; i++) {
    const h = hlList[i];
    if (!h) { u[i].z = 0; continue; }
    const [f, r] = sqIdx(h[0]);
    u[i].set(f, r, h[1], h[2]);
  }
}

const gradeEl = document.querySelector('.grade');
const root = document.documentElement.style;
const body = document.body;
const heroInner = document.querySelector('.hero-inner');
const navLinks = [...document.querySelectorAll('.links a')];
let introK = DBG.has('ply') || DBG.has('nointro') ? 1 : 0;
const tmpRig = rig();

engine.onTick((dt, t) => {
  pointer.update(dt);
  hlMat.uniforms.uTime.value = t;
  hlMat.uniforms.uRip.value.z += dt;

  // Replay clock: the displayed ply chases the scroll target at a tempo that always finishes a move.
  T = frozen ? P : targetPly();
  const sNow = sectionCoord();
  // Off-screen, the game jumps straight to where the scroll says it is; on screen it is always played.
  if (!frozen && (sNow < 0.3 || sNow > 1.7)) P = T;
  if (!frozen) {
    const kNow = clamp(Math.floor(P), 0, PLY_COUNT);
    const base = 1.05 / (DUR[kNow] ?? 1);
    const gap = T - P;
    const speed = Math.min(16, Math.max(base, Math.abs(gap) * 1.6));
    P = Math.abs(gap) < speed * dt ? T : P + Math.sign(gap) * speed * dt;
  }
  // Sounds and ripples on landing (forward only).
  if (P > lastP) {
    for (let k = Math.floor(lastP); k <= Math.floor(P) && k < PLY_COUNT; k++) {
      const ply = plies[k];
      const land = ply.victim ? 0.6 : 0.97, hit = 0.5;
      if (lastP < k + land && P >= k + land) { const [x, z] = squareXZ(ply.to); ripple(x, z, ply.knight ? 1.2 : 0.8); sound.clack(ply.knight ? 1 : 0.7); }
      if (ply.victim && lastP < k + hit && P >= k + hit) sound.topple();
    }
    if (lastP < PLY_COUNT + 0.72 && P >= PLY_COUNT + 0.72) sound.topple(0.7);
  }
  lastP = P;

  // Section blend & free-play weight.
  const s = sNow;
  const si = Math.min(Math.floor(s), secEls.length - 2), sf = s - si;
  const pastReplay = s > 1.5;
  if (pastReplay && !free.inited && P >= END_P - 0.01) initFree();
  free.W = damp(free.W, pastReplay && free.inited ? 1 : 0, 4.5, dt);
  free.active = free.inited && s > 1.75 && s < 2.4;
  if (!free.active && free.drag) endDrag();
  if (!free.active && free.hoverPiece) { free.hoverPiece = null; cur?.set(''); }
  body.classList.toggle('in-replay', s > 0.6 && s < 1.55);
  body.classList.toggle('show-intro', s > 0.6 && s < 1.5 && P < 1.5);
  body.classList.toggle('in-free', s > 1.7 && s < 2.45);
  body.classList.toggle('at-top', scrollY < 40);
  const gA = GRADES[si], gB = GRADES[si + 1];
  const gm = MOBILE ? 1.45 : 1;
  root.setProperty('--gl', Math.min(0.92, lerp(gA.gl, gB.gl, sf) * gm).toFixed(3));
  root.setProperty('--gr', Math.min(0.92, lerp(gA.gr, gB.gr, sf) * gm).toFixed(3));
  root.setProperty('--gb', Math.min(0.92, lerp(gA.gb, gB.gb, sf) * gm).toFixed(3));
  navLinks.forEach((a, i) => a.classList.toggle('on', Math.round(s) === [1, 3, 4][i]));
  heroInner.style.opacity = (1 - smooth(0.05, 0.55, s)).toFixed(3);

  // Pieces.
  updateDrag(dt);
  let mover = null;
  const kA = Math.floor(P);
  if (P > kA && kA < PLY_COUNT) mover = byId[plies[kA].mover];
  for (const p of PIECES) {
    replayPose(p, P, p.pos, p.quat);
    if (free.inited && free.W > 0.001) { p.pos.lerp(p.fp, free.W); p.quat.slerp(p.fq, free.W); }
    p.mesh.position.copy(p.pos);
    p.mesh.quaternion.copy(p.quat);
    if (p.drop > 0) p.mesh.position.y += p.drop;
  }
  updateTrail(P);
  setHighlights(t);

  // Camera.
  if (mover) action.copy(mover.pos);
  else if (kA > 0 && kA <= PLY_COUNT) sqPos(plies[Math.min(kA, PLY_COUNT) - 1].to, action);
  else action.set(0.4, 0, 0.5);
  const rigs = [heroRig, replayRig(P, s > 0.5 && s < 1.6 ? action : null, _rc), freeRig, setRig, salonRig, footRig];
  const target = lerpRig(rigs[si], rigs[si + 1], sf, tmpRig);
  if (introK < 1) lerpRig(introRig, target, ease.io3(introK), target);
  if (DBG.has('cam')) { const c = DBG.get('cam').split(',').map(Number); Object.assign(target, { az: c[0], el: c[1], d: c[2], tx: c[3], tz: c[4], ty: c[5] ?? 0.3, shift: c[6] ?? 0 }); }
  if (MOBILE) { target.d *= 1.5; target.el = Math.min(88, target.el + 8); }
  if (!camInit) { Object.assign(cam, target); camInit = true; }
  const lam = introK < 1 ? 30 : 2.8;
  let daz = target.az - cam.az; daz = ((daz + 540) % 360) - 180;
  cam.az += daz * (1 - Math.exp(-lam * dt));
  for (const k of ['el', 'd', 'tx', 'ty', 'tz', 'shift', 'fov', 'bokeh', 'range']) cam[k] = damp(cam[k], target[k], lam, dt);
  const drag = free.drag ? 0.2 : 1;
  const az = (cam.az + pointer.sx * 3.2 * drag + Math.sin(t * 0.11) * 1.1) * D;
  const el = clamp(cam.el + pointer.sy * 1.8 * drag + Math.sin(t * 0.17) * 0.5, 3, 89) * D;
  camT.set(cam.tx, cam.ty, cam.tz);
  camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(cam.d).add(camT);
  camera.lookAt(camT);
  if (Math.abs(camera.fov - cam.fov) > 0.01) camera.fov = cam.fov;
  const { w, h } = engine.size;
  camera.setViewOffset(w, h, cam.shift * w, 0, w, h);
  camera.updateProjectionMatrix();
  if (dof) {
    dof.cocMaterial.focusDistance = camera.position.distanceTo(_v1.copy(camT).lerp(action, 0.4));
    dof.cocMaterial.focusRange = cam.d * cam.range;
    dof.bokehScale = cam.bokeh;
  }

  // Lights: rims follow the camera around the board.
  const fwd = _v1.set(camT.x - camera.position.x, 0, camT.z - camera.position.z).normalize();
  const side = _v2.set(-fwd.z, 0, fwd.x);
  rimA.position.copy(camT).addScaledVector(fwd, 9).addScaledVector(side, 5).setY(5.6);
  rimB.position.copy(camT).addScaledVector(fwd, 8).addScaledVector(side, -6).setY(4.6);
  rimA.target.position.copy(camT); rimB.target.position.copy(camT);
  vol.uniforms.get('uDensity').value = 0.011 * (1 - smooth(22, 48, cam.el));
  key.intensity = KEY_ON * lights.k;
  dust.uniforms.uTime.value = t;
  dust.uniforms.uLDir.value.subVectors(key.target.position, key.position).normalize();
  dust.uniforms.uPower.value = lights.k * (1 - smooth(30, 60, cam.el)) * (1 - smooth(20, 40, cam.d));
  rimA.intensity = RIM_A * lights.k; rimB.intensity = RIM_B * lights.k;

  // HTML that follows the 3D.
  if (body.classList.contains('in-replay')) {
    const kc = Math.ceil(P - 1e-4) - 1;
    setCaption(kc);
    barEl.style.transform = `scaleX(${clamp(P / END_P).toFixed(4)})`;
    const cur = Math.max(0, Math.min(kc, PLY_COUNT - 1));
    const rowH = 30, wantY = Math.floor(cur / 2) * rowH - scoreWin.clientHeight * 0.42 + 30;
    listY = damp(listY, Math.max(0, wantY), 6, dt);
    listEl.style.transform = `translate3d(0, ${(-listY).toFixed(1)}px, 0)`;
    const showTag = kc >= 0 && kc < PLY_COUNT && (Math.floor(P) !== kc || P - kc > 0.9) && !MOBILE;
    tagEl.classList.toggle('on', showTag);
    if (showTag) {
      const p = byId[plies[kc].mover];
      _v1.copy(p.pos).setY(p.pos.y + p.T.h + 0.1).project(camera);
      tagSan.textContent = plies[kc].san;
      tagEl.style.transform = `translate3d(calc(${((_v1.x + 1) / 2 * innerWidth).toFixed(1)}px - 50%), calc(${((1 - _v1.y) / 2 * innerHeight).toFixed(1)}px - 100%), 0)`;
    }
  } else tagEl.classList.remove('on');
  updateNoteCards(s);

  salon?.update(camera, KEY_ON * lights.k);
  scene.fog.density = lerp(0.012, 0.0035, smooth(12, 60, cam.d));
  const orbK = 1 - smooth(24, 38, cam.el);
  for (const o of orbs) { o.visible = orbK > 0.01; o.material.color.setRGB(1, 0.66, 0.36).multiplyScalar(o.userData.k * orbK); }
  if (!DBG.has('norefl')) reflection.update(scene, camera);
});

const cardPos = [{ x: 0, y: 0, init: false }, { x: 0, y: 0, init: false }];
function updateNoteCards(s) {
  const on = !MOBILE && s > 2.7 && s < 3.35;
  const aims = [[0.12, 0.3], [0.5, -0.28]];
  let taken = null;
  noteCards.forEach((el, i) => {
    el.classList.toggle('on', on);
    if (!on) { cardPos[i].init = false; return; }
    // an upright piece of that colour near the card's preferred spot, and never next to the other card's piece
    let best = null, bestS = Infinity;
    for (const p of PIECES) {
      if (p.color !== (i ? 'b' : 'w') || !p.fs?.sq || p.fs.lying || free.drag?.p === p) continue;
      _v1.copy(p.pos).setY(p.T.h * 0.8).project(camera);
      if (Math.abs(_v1.x) > 0.8 || Math.abs(_v1.y) > 0.75) continue;
      let score = Math.hypot(_v1.x - aims[i][0], _v1.y - aims[i][1]) + p.pos.distanceTo(camera.position) * 0.03;
      if (taken && Math.hypot(_v1.x - taken.x, (_v1.y - taken.y) * 1.6) < 0.45) score += 3;
      if (score < bestS) { bestS = score; best = { x: _v1.x, y: _v1.y }; }
    }
    if (!best) { el.classList.remove('on'); return; }
    taken = best;
    const x = Math.min((best.x + 1) / 2 * innerWidth + 60, innerWidth - el.offsetWidth - 24);
    const y = clamp((1 - best.y) / 2 * innerHeight - el.offsetHeight / 2, 90, innerHeight - el.offsetHeight - 40);
    const c = cardPos[i];
    if (!c.init) { c.x = x; c.y = y; c.init = true; }
    c.x += (x - c.x) * 0.12; c.y += (y - c.y) * 0.12;
    el.style.transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0)`;
  });
}

// ─── The salon ────────────────────────────────────────────────────────────────
let salon = null;
function makeSalon() {
  const pieceTypes = {};
  for (const [type, root] of Object.entries(FAR)) {
    root.updateMatrixWorld(true);
    const mesh = firstMesh(root);
    const geo = toFloatGeometry(mesh.geometry, mesh.matrixWorld);
    const { cx, cz, y0, s } = TYPES[type].xf;
    geo.translate(-cx, -y0, -cz); geo.scale(s, s, s);
    geo.computeVertexNormals();
    pieceTypes[type] = geo;
  }
  // Every other table is somewhere in the same game.
  const at = [3, 9, 13, 17, 21, 24, 29, 33, 36, 39, 43];
  const placements = [];
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), rq = new THREE.Quaternion();
  TABLES.forEach((t, i) => {
    const st = states[at[i % at.length]];
    rq.setFromAxisAngle(UP, (i % 3 - 1) * 0.12);
    for (const p of PIECES) {
      restPose(p, st, pos, quat);
      pos.applyQuaternion(rq).add(t);
      quat.premultiply(rq);
      placements.push({ type: p.type, color: p.color, matrix: new THREE.Matrix4().compose(pos, quat, one) });
    }
  });
  return buildSalon({ scene, camera, tableY: TABLE_Y, edge: EDGE, pieceTypes, placements, boardTex: bt.albedo });
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ─── Boot ─────────────────────────────────────────────────────────────────────
worldNav('gambit', { theme: 'dark', corner: 'bl' });
cur = cursor({ color: '#dcc08a', blend: 'normal', size: 30 });
magnetic();
smoothScroll({ lerp: 0.08 });
// In-page links glide when the target is near and cut when it is far (no whip-pan through forty-five shots).
document.addEventListener('click', e => {
  const a = e.target.closest?.('a[href^="#"]');
  if (!a) return;
  const el = document.querySelector(a.getAttribute('href'));
  if (!el) return;
  e.preventDefault();
  const y = el.getBoundingClientRect().top + scrollY + (el.id === 'game' ? innerHeight * 0.6 : 0);
  const far = Math.abs(y - scrollY) > innerHeight * 3;
  window.__lenis?.scrollTo(y, far ? { immediate: true } : { duration: 1.6 });
});
const soundBtn = document.querySelector('.sound');
soundBtn.addEventListener('click', () => { const on = sound.toggle(); soundBtn.setAttribute('aria-pressed', String(on)); if (on) sound.clack(0.8); });
reveal('.panel h2', { type: 'lines', stagger: 0.1 });
reveal('.lede', { type: 'lines', stagger: 0.05, y: '100%' });
measure();
const fontsReady = Promise.race([Promise.all([document.fonts.load('italic 500 60px "Bodoni Moda"'), document.fonts.ready]), new Promise(r => setTimeout(r, 2500))])
  .then(() => { measure(); buildCoordinates(); });

await Promise.all([...typeLoads, ...farLoads, fontsReady]);
makePieces();
salon = makeSalon();
if (DBG.has('free')) { P = END_P; }
// Warm every program with the lights on and every piece in view.
lights.k = 1;
for (const p of PIECES) { replayPose(p, 0, p.pos, p.quat); p.mesh.position.copy(p.pos); p.mesh.quaternion.copy(p.quat); }
camera.position.set(0, 14, 14); camera.lookAt(0, 0, 0);
renderer.compile(scene, camera);
lights.k = 0;
measure();
engine.start();
window.__gambit = { get P() { return P; }, setP(v) { P = v; }, freeze(v) { frozen = v !== null; if (frozen) P = v; }, byId, free, arrange, scrollForPly };
window.__gambit.screenOf = (id, sq) => {
  const v = sq ? sqPos(sq, new THREE.Vector3()) : byId[id].pos.clone().setY(byId[id].pos.y + byId[id].T.h * 0.55);
  v.project(camera);
  return [(v.x + 1) / 2, (1 - v.y) / 2];
};
window.__gotoPly = v => window.__lenis?.scrollTo(scrollForPly(v), { immediate: true });
// Everything the intro reveals starts hidden before the loader lifts.
const introEls = '.hero .eyebrow, .hero-sub, .hero-cta, .nav, .scroll-cue';
gsap.set('.hero-title .ln > span', { yPercent: 105 });
gsap.set(introEls, { opacity: 0, y: 16 });
if (introK < 1) for (const p of PIECES) p.drop = 2.4;
await loader.finish();

// Intro: the lamp comes up, the pieces are set down in a wave, the camera settles low across the board.
function startIntro() {
  if (introK < 1) {
    for (const p of PIECES) {
      const [x, z] = squareXZ(p.start);
      gsap.to(p, { drop: 0, duration: 1.25, ease: 'power3.out', delay: 0.3 + (Math.hypot(x - 0.5, z - 0.5) * 0.085) + (p.color === 'b' ? 0.1 : 0) });
    }
    gsap.to(lights, { k: 1, duration: 2.6, ease: 'power2.inOut', delay: 0.2 });
    gsap.to({ v: 0 }, { v: 1, duration: 4, ease: 'none', onUpdate() { introK = this.targets()[0].v; } });
  } else lights.k = 1;
  gsap.to('.hero-title .ln > span', { yPercent: 0, duration: 1.8, ease: 'expo.out', stagger: 0.12, delay: 1.9 });
  gsap.to(introEls, { opacity: 1, y: 0, duration: 1.4, ease: 'power3.out', stagger: 0.08, delay: 2.3 });
}
