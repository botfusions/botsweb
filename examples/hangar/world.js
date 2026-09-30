// Hangar Nine — procedural hangar: wet concrete with painted bay markings, corrugated walls, roof trusses,
// an overhead crane, maintenance gantries, containers, floods, bay lamps, red strobes and the dawn door.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bakeTexture, fbmNormal } from '../../src/core/textures.js';

export const HALL = { x: 31, zBack: -32, zFront: 36, h: 28, doorW: 15, doorH: 20 };
export const BAYS_Z = [-28, -20, -12, -4, 4, 12, 20, 28];

// ─── helpers ──────────────────────────────────────────────────────────────────
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();

/** World-space box projection so every merged piece gets the same texel density (1 uv = 4 m). */
function boxUV(geo, scale = 0.25) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else if (az >= ay) { u = p.getX(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getZ(i); }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

class Batch {
  constructor(mat, { cast = true, receive = true, uv = true } = {}) { this.mat = mat; this.geos = []; this.cast = cast; this.receive = receive; this.uv = uv; }
  put(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z);
    geo.applyMatrix4(_m.compose(_p, _q, _s));
    this.geos.push(geo.index ? geo.toNonIndexed() : geo);
    return this;
  }
  box(w, h, d, x, y, z, rx, ry, rz) { return this.put(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz); }
  cyl(r0, r1, h, x, y, z, rx, ry, rz, seg = 12) { return this.put(new THREE.CylinderGeometry(r0, r1, h, seg), x, y, z, rx, ry, rz); }
  /** Beam between two points. */
  beam(a, b, w, d = w) {
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(w, len, d);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a).normalize();
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.applyMatrix4(_m.compose(mid, _q, _s));
    this.geos.push(g.toNonIndexed());
    return this;
  }
  tube(a, b, r, seg = 10) {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyMatrix4(_m.compose(mid, _q, _s));
    this.geos.push(g.toNonIndexed());
    return this;
  }
  build(parent) {
    if (!this.geos.length) return null;
    for (const g of this.geos) { if (this.uv) boxUV(g); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); }
    const mesh = new THREE.Mesh(mergeGeometries(this.geos, false), this.mat);
    mesh.castShadow = this.cast; mesh.receiveShadow = this.receive;
    parent.add(mesh);
    return mesh;
  }
}

function worldPosChunk(sh, name = 'vW') {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\nvarying vec3 ${name};`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${name} = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 ${name};
    float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
    float vn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f);
      return mix(mix(mix(h13(i), h13(i+vec3(1,0,0)), f.x), mix(h13(i+vec3(0,1,0)), h13(i+vec3(1,1,0)), f.x), f.y),
                 mix(mix(h13(i+vec3(0,0,1)), h13(i+vec3(1,0,1)), f.x), mix(h13(i+vec3(0,1,1)), h13(i+vec3(1,1,1)), f.x), f.y), f.z); }`);
}

/** Painted steel with diagonal hazard stripes in world space, worn at the edges. */
function hazardMaterial({ freq = 1.1, rough = 0.62 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: 0.25 });
  m.onBeforeCompile = sh => {
    worldPosChunk(sh, 'vHz');
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        float s = smoothstep(0.47, 0.53, fract((vHz.x + vHz.z + vHz.y) * ${freq.toFixed(2)}));
        float wear = vn3(vHz * 3.1) * 0.6 + vn3(vHz * 11.0) * 0.4;
        vec3 amber = vec3(0.78, 0.36, 0.0) * (0.75 + wear * 0.35);
        vec3 blk = vec3(0.012);
        vec3 c = mix(blk, amber, s);
        c = mix(c, vec3(0.05, 0.05, 0.05), smoothstep(0.62, 0.8, wear) * 0.8); // scuffed through to steel
        diffuseColor.rgb = c;
      }`);
  };
  m.customProgramCacheKey = () => 'hazard' + freq;
  return m;
}

function canvasTex(w, h, draw, { srgb = true, flipY = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = flipY;
  t.anisotropy = 8;
  return t;
}

// ─── build ────────────────────────────────────────────────────────────────────
export function buildHangar({ scene, renderer, reflection, maxAniso = 8 }) {
  const root = new THREE.Group();
  scene.add(root);
  const out = { root };

  // Materials ------------------------------------------------------------------
  const steelRough = bakeTexture(renderer, 512, `void main(){ float r = 0.42 + fbm(vUv*4., 4., 5, .55)*0.35 + fbm(vUv*32., 32., 3, .5)*0.12; gl_FragColor = vec4(1., clamp(r,.12,1.), 0., 1.); }`);
  const steelN = fbmNormal(renderer, { size: 512, scale: 6, octaves: 5, strength: 0.7 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x3b4046, metalness: 0.78, roughness: 1, roughnessMap: steelRough, normalMap: steelN, normalScale: new THREE.Vector2(0.4, 0.4) });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x1b1e22, metalness: 0.7, roughness: 1, roughnessMap: steelRough });
  const crane = new THREE.MeshStandardMaterial({ color: 0xb87d08, metalness: 0.35, roughness: 1, roughnessMap: steelRough, normalMap: steelN, normalScale: new THREE.Vector2(0.5, 0.5) });
  const hazard = hazardMaterial();
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.85, metalness: 0 });

  // corrugated cladding
  const corrN = bakeTexture(renderer, 1024, `
    float H(vec2 p){ return sin(p.x * 6.2831853 * 20.0) * 0.5 + fbm(p * 6., 6., 5, .55) * 0.9 + fbm(p*40., 40., 3, .5)*0.15; }
    void main(){
      float e = 1.0/1024.0;
      float hx = H(vUv + vec2(e,0.)) - H(vUv - vec2(e,0.));
      float hy = H(vUv + vec2(0.,e)) - H(vUv - vec2(0.,e));
      vec3 n = normalize(vec3(-hx * 5.0, -hy * 5.0, 1.));
      gl_FragColor = vec4(n * 0.5 + 0.5, 1.);
    }`);
  const corrA = bakeTexture(renderer, 1024, `
    void main(){
      vec2 p = vUv;
      float streak = fbm(vec2(p.x * 24., p.y * 1.5), 24., 5, .6);
      float grime = fbm(p * 3., 3., 5, .6);
      float seam = smoothstep(0.0, 0.006, abs(fract(p.x * 1.0) - 0.5) - 0.494);
      vec3 c = vec3(0.034, 0.038, 0.044) * (0.75 + streak * 0.5) * (0.8 + grime * 0.6);
      c = mix(c * 0.4, c, seam);
      // rust weeping from the lower edge of each sheet
      float rust = smoothstep(0.35, 0.0, fract(p.y)) * smoothstep(0.1, 0.5, fbm(vec2(p.x*30., p.y*3.)+1.7, 30., 4, .6)+.3);
      c = mix(c, vec3(0.06, 0.028, 0.012), rust * 0.35);
      gl_FragColor = vec4(c, 1.);
    }`);
  const corrR = bakeTexture(renderer, 512, `void main(){ float r = 0.55 + fbm(vec2(vUv.x*20., vUv.y*2.), 20., 5, .6)*0.35; gl_FragColor = vec4(1., clamp(r,.2,1.), 0., 1.); }`);
  const cladding = new THREE.MeshStandardMaterial({ map: corrA, normalMap: corrN, roughnessMap: corrR, roughness: 1, metalness: 0.55, normalScale: new THREE.Vector2(1, 1) });
  const containerMat = (hex) => new THREE.MeshStandardMaterial({ color: hex, map: corrA, normalMap: corrN, roughnessMap: corrR, roughness: 1, metalness: 0.35 });

  // Floor ------------------------------------------------------------------------
  const floorA = bakeTexture(renderer, 2048, `
    float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 p = vUv;
      vec2 g = p * 3.0; vec2 id = floor(g); vec2 f = fract(g);
      float slab = hh(id);
      float seam = min(min(f.x, 1.-f.x), min(f.y, 1.-f.y));
      float line = smoothstep(0.0015, 0.004, seam);
      float n = fbm(p * 36., 36., 6, .55);
      float big = fbm(p * 4. + slab, 4., 5, .6);
      float oil = smoothstep(0.12, 0.4, fbm(p * 5. + 3.1, 5., 5, .62));
      float tyre = smoothstep(0.1, 0.3, fbm(vec2(p.x * 60., p.y * 2.), 60., 3, .5)) * smoothstep(0.2, 0.5, fbm(p*2.+9., 2., 3, .5)+.3);
      vec3 base = vec3(0.105, 0.106, 0.108) * (0.82 + slab * 0.22) * (0.8 + n * 0.45) * (0.78 + big * 0.5);
      base = mix(base, base * 0.35, oil * 0.55);
      base = mix(base, base * 0.55, tyre * 0.4);
      gl_FragColor = vec4(base * mix(0.25, 1.0, line), 1.0);
    }`);
  const floorR = bakeTexture(renderer, 2048, `
    void main(){
      vec2 p = vUv;
      vec2 f = fract(p * 3.0);
      float seam = min(min(f.x, 1.-f.x), min(f.y, 1.-f.y));
      float wet = smoothstep(0.02, -0.08, fbm(p * 3. + 0.7, 3., 5, .55));   // puddles
      float damp = smoothstep(0.1, -0.05, fbm(p * 1.5 + 4.1, 1.5, 4, .5));
      float r = 0.5 + fbm(p * 18., 18., 4, .5) * 0.25;
      r = mix(r, 0.3, damp * 0.8);
      r = mix(r, 0.035, wet);
      r = mix(0.9, r, smoothstep(0.001, 0.005, seam));
      float wear = fbm(p * 40., 40., 4, .6) * 0.5 + 0.5;
      gl_FragColor = vec4(wear, clamp(r, 0.03, 1.0), 0.0, 1.0);
    }`);
  const floorN = fbmNormal(renderer, { size: 1024, scale: 28, octaves: 5, strength: 0.5 });
  for (const t of [floorA, floorR, floorN]) { t.repeat.set(1 / 12, 1 / 12); t.anisotropy = maxAniso; }
  const floorMat = new THREE.MeshStandardMaterial({ map: floorA, roughnessMap: floorR, normalMap: floorN, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 1, metalness: 0, envMapIntensity: 0.5 });

  // painted markings (world metres drawn straight into the canvas)
  const MK = { x0: -33, z0: -33, size: 72 };
  const marks = canvasTex(2048, 2048, (g, W) => {
    const k = W / MK.size;
    g.setTransform(k, 0, 0, k, -MK.x0 * k, -MK.z0 * k);
    const amber = '#e2a012', white = '#d9d6cc';
    const hazardBand = (x, z, w, h, stripe = 0.9) => {
      g.save(); g.beginPath(); g.rect(x, z, w, h); g.clip();
      g.fillStyle = '#121212'; g.fillRect(x, z, w, h);
      g.fillStyle = amber;
      for (let s = x - h - 40; s < x + w + 40; s += stripe) { g.beginPath(); g.moveTo(s, z); g.lineTo(s + stripe / 2, z); g.lineTo(s + stripe / 2 + h, z + h); g.lineTo(s + h, z + h); g.fill(); }
      g.restore();
    };
    const ring = (x0, z0, x1, z1, bw) => {
      hazardBand(x0, z0, x1 - x0, bw); hazardBand(x0, z1 - bw, x1 - x0, bw);
      hazardBand(x0, z0, bw, z1 - z0); hazardBand(x1 - bw, z0, bw, z1 - z0);
    };
    // Bay 09 pad
    ring(-7.2, -7.5, 7.2, 6.6, 0.55);
    // neighbouring bays, just outlines
    g.strokeStyle = amber; g.lineWidth = 0.22;
    g.strokeRect(-27.5, -14, 14, 20); g.strokeRect(13.5, -14, 14, 20);
    // lane to the door
    g.fillStyle = amber;
    g.fillRect(-9.3, 7.5, 0.24, 29); g.fillRect(9.06, 7.5, 0.24, 29);
    for (let z = 18; z < 35; z += 2.4) g.fillRect(-0.09, z, 0.18, 1.2);
    // chevrons toward the door
    g.lineWidth = 0.5; g.strokeStyle = amber;
    for (let i = 0; i < 3; i++) { const z = 24 + i * 2.2; g.beginPath(); g.moveTo(-3, z); g.lineTo(0, z + 1.6); g.lineTo(3, z); g.stroke(); }
    // walkway lines along the gantries
    g.fillStyle = white;
    for (const x of [-11.6, 11.4]) g.fillRect(x, -30, 0.18, 64);
    // big bay number
    g.save();
    g.fillStyle = amber;
    g.font = '700 7.4px "Chakra Petch", "Arial Black", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('09', 0, 12.4);
    g.font = '600 0.62px "Chakra Petch", Arial, sans-serif';
    g.fillStyle = white;
    g.fillText('BAY 09  ·  MAX STANDING LOAD 45 T  ·  KEEP CLEAR DURING COLD START', 0, 7.35);
    g.font = '700 2.6px "Chakra Petch", Arial, sans-serif';
    g.fillStyle = amber;
    g.fillText('08', -20.5, -9); g.fillText('10', 20.5, -9);
    g.restore();
    // vents
    g.fillStyle = '#0a0a0a';
    for (const [x, z] of [[-4.6, 3.9], [4.6, 3.9], [-4.6, -4.9], [4.6, -4.9]]) g.fillRect(x - 0.8, z - 0.5, 1.6, 1.0);
  }, { srgb: true, flipY: false });
  marks.anisotropy = maxAniso;

  const FLOOR = { x0: -60, x1: 60, z0: HALL.zBack, z1: 125 };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR.x1 - FLOOR.x0, FLOOR.z1 - FLOOR.z0, 1, 1), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((FLOOR.x0 + FLOOR.x1) / 2, 0, (FLOOR.z0 + FLOOR.z1) / 2);
  floor.receiveShadow = true;
  // world-space uv so tiling is in metres
  {
    const p = floor.geometry.attributes.position, uv = floor.geometry.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + floor.position.x), -(p.getY(i)) + floor.position.z);
  }
  root.add(floor);
  reflection.hidden.push(floor);
  reflection.patch(floorMat, { strength: 1.35, distort: 0.018, lodScale: 6.5, lodBias: 0.2, f0: 0.05 });
  const floorU = {
    uMarks: { value: marks }, uMarkBox: { value: new THREE.Vector3(MK.x0, MK.z0, MK.size) },
    uPool: { value: Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, 1, 0)) }, uPoolCol: { value: new THREE.Color(1.0, 0.93, 0.82) },
    uWave: { value: new THREE.Vector2(0, 0) }, uWaveCol: { value: new THREE.Color(0.4, 0.9, 1.0) },
  };
  {
    const prev = floorMat.onBeforeCompile;
    floorMat.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      Object.assign(sh.uniforms, floorU);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uMarks; uniform vec3 uMarkBox; uniform vec4 uPool[16]; uniform vec3 uPoolCol; uniform vec2 uWave; uniform vec3 uWaveCol;
          float gPaint = 0.0;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec2 muv = (vReflW.xz - uMarkBox.xy) / uMarkBox.z;
            vec4 mk = texture2D(uMarks, muv);
            float inside = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
            float wearN = texture2D(roughnessMap, vRoughnessMapUv * 2.7).r;
            gPaint = mk.a * inside * smoothstep(0.28, 0.5, wearN);
            diffuseColor.rgb = mix(diffuseColor.rgb, mk.rgb * 0.8, gPaint);
          }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          {
            float wz = texture2D(roughnessMap, vRoughnessMapUv * 0.37 + 0.13).r;
            float zone = smoothstep(17.0, 6.0, length(vReflW.xz - vec2(0.0, 3.0))) * smoothstep(0.38, 0.62, wz + 0.12);
            roughnessFactor = mix(roughnessFactor, 0.045, zone * 0.9);
          }
          roughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.32), gPaint);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            vec3 pl = vec3(0.);
            for (int i = 0; i < 16; i++) {
              vec4 P = uPool[i];
              if (P.w <= 0.0) continue;
              vec2 d = vReflW.xz - P.xy;
              pl += P.w * exp(-dot(d, d) / (P.z * P.z));
            }
            totalEmissiveRadiance += diffuseColor.rgb * pl * uPoolCol;
            float rd = length(vReflW.xz) - uWave.x;
            totalEmissiveRadiance += uWaveCol * uWave.y * (exp(-rd * rd * 3.0) + 0.25 * exp(-rd*rd*0.15) * step(rd, 0.0));
          }`);
    };
    floorMat.customProgramCacheKey = () => 'hangar-floor';
  }
  out.floor = floor; out.floorU = floorU; out.floorMat = floorMat;

  // Shell: walls, roof ------------------------------------------------------------
  const shell = new Batch(cladding, { cast: false, receive: true });
  const W = HALL.x, zc = (HALL.zBack + HALL.zFront) / 2, len = HALL.zFront - HALL.zBack;
  shell.box(0.3, HALL.h, len, -W - 0.15, HALL.h / 2, zc);
  shell.box(0.3, HALL.h, len, W + 0.15, HALL.h / 2, zc);
  shell.box(W * 2 + 0.6, HALL.h, 0.3, 0, HALL.h / 2, HALL.zBack - 0.15);
  // front wall with the door opening
  const dw = HALL.doorW, dh = HALL.doorH;
  shell.box(W - dw, HALL.h, 0.3, -(dw + (W - dw) / 2), HALL.h / 2, HALL.zFront + 0.15);
  shell.box(W - dw, HALL.h, 0.3, dw + (W - dw) / 2, HALL.h / 2, HALL.zFront + 0.15);
  shell.box(dw * 2, HALL.h - dh, 0.3, 0, dh + (HALL.h - dh) / 2, HALL.zFront + 0.15);
  shell.box(W * 2, 0.3, len, 0, HALL.h + 0.15, zc);
  shell.build(root);

  // skirting / columns on the side walls
  const frame = new Batch(darkSteel);
  for (const z of BAYS_Z) for (const s of [-1, 1]) frame.box(0.9, HALL.h, 0.7, s * (W - 0.45), HALL.h / 2, z);
  for (const s of [-1, 1]) frame.box(0.25, 0.9, len, s * (W - 0.2), 0.45, zc);
  // clerestory mullions
  for (const s of [-1, 1]) for (let z = HALL.zBack + 2; z < HALL.zFront - 1; z += 2) frame.box(0.2, 4.2, 0.12, s * (W - 0.1), 22.2, z);
  // door header + jambs
  frame.box(dw * 2 + 2, 1.4, 1.2, 0, dh + 0.7, HALL.zFront - 0.4);
  for (const s of [-1, 1]) frame.box(1.2, dh, 1.2, s * (dw + 0.6), dh / 2, HALL.zFront - 0.4);
  frame.build(root);
  const doorHaz = new Batch(hazard);
  doorHaz.box(dw * 2, 0.5, 1.25, 0, dh + 0.02, HALL.zFront - 0.4);
  for (const s of [-1, 1]) doorHaz.box(1.25, 2.2, 1.25, s * (dw + 0.6), 1.1, HALL.zFront - 0.4);
  doorHaz.build(root);

  // clerestory glass: faint moonlight, the only cold light in the building before power-up
  const glassMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.07, 0.1), fog: false });
  const glassGeo = [];
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(len - 3, 4);
    g.rotateY(s > 0 ? -Math.PI / 2 : Math.PI / 2);
    g.translate(s * (W - 0.02), 22.2, zc);
    glassGeo.push(g);
  }
  const glass = new THREE.Mesh(mergeGeometries(glassGeo), glassMat);
  root.add(glass);
  out.glassMat = glassMat;

  // Roof trusses -----------------------------------------------------------------
  const truss = new Batch(darkSteel, { cast: false });
  const yB = 22, yT = 26;
  for (const z of BAYS_Z) {
    truss.box(W * 2, 0.45, 0.35, 0, yB, z);
    truss.box(W * 2, 0.45, 0.35, 0, yT, z);
    for (let x = -W + 1; x <= W - 1; x += 3) {
      truss.box(0.18, yT - yB, 0.18, x, (yB + yT) / 2, z);
      truss.beam(new THREE.Vector3(x, yB, z), new THREE.Vector3(x + 3, yT, z), 0.16);
    }
  }
  for (let x = -W + 3; x < W; x += 6) truss.box(0.25, 0.3, len, x, yT + 0.35, zc);
  // longitudinal bracing at the bottom chord
  for (const x of [-15, 15]) truss.box(0.2, 0.2, len, x, yB - 0.1, zc);
  truss.build(root);

  // Overhead crane ------------------------------------------------------------------
  const craneB = new Batch(crane);
  const craneZ = 0.5, craneY = 19.4;
  for (const dz of [-1.3, 1.3]) craneB.box(W * 2 - 1.6, 1.4, 0.6, 0, craneY, craneZ + dz);
  for (const s of [-1, 1]) craneB.box(1.4, 1.0, 4.6, s * (W - 1.2), craneY + 0.2, craneZ);
  // trolley + hoist
  craneB.box(3.2, 1.2, 3.6, 3.2, craneY + 1.2, craneZ);
  craneB.box(1.3, 1.4, 1.6, 3.2, craneY - 1.1, craneZ);
  craneB.build(root);
  const rails = new Batch(darkSteel, { cast: false });
  for (const s of [-1, 1]) rails.box(0.6, 0.8, len, s * (W - 1.2), craneY - 0.6, zc);
  rails.build(root);
  const hook = new Batch(steel);
  for (const dx of [-0.25, 0.25]) hook.tube(new THREE.Vector3(3.2 + dx, craneY - 1.8, craneZ), new THREE.Vector3(3.2 + dx, 15.6, craneZ), 0.03, 6);
  hook.box(1.0, 1.1, 0.6, 3.2, 15.1, craneZ);
  hook.build(root);
  const hookHaz = new Batch(hazard);
  hookHaz.box(1.05, 0.5, 0.65, 3.2, 14.4, craneZ);
  hookHaz.put(new THREE.TorusGeometry(0.34, 0.1, 8, 18, Math.PI * 1.4), 3.2, 13.7, craneZ, 0, 0, -Math.PI * 0.2);
  hookHaz.build(root);

  // Maintenance gantries --------------------------------------------------------------
  const gSteel = new Batch(steel);
  const gHaz = new Batch(hazard);
  const levels = [4.4, 8.4, 12.4];
  const T = { z0: -7.6, z1: -2.8, xin: 6.4, xout: 9.8 };
  for (const s of [-1, 1]) {
    const xi = s * T.xin, xo = s * T.xout, xm = (xi + xo) / 2, wx = Math.abs(xo - xi);
    for (const x of [xi, xo]) for (const z of [T.z0, T.z1]) gSteel.box(0.32, 13.6, 0.32, x, 6.8, z);
    for (const y of levels) {
      gSteel.box(wx + 0.3, 0.14, T.z1 - T.z0 + 0.3, xm, y, (T.z0 + T.z1) / 2);
      gHaz.box(0.06, 0.2, T.z1 - T.z0 + 0.3, xi, y + 0.16, (T.z0 + T.z1) / 2);
      gHaz.box(wx + 0.3, 0.2, 0.06, xm, y + 0.16, T.z1 + 0.14);
      // rails on the outer + front side
      for (const hy of [0.55, 1.1]) {
        gSteel.box(0.05, 0.05, T.z1 - T.z0, xo, y + hy, (T.z0 + T.z1) / 2);
        gSteel.box(wx, 0.05, 0.05, xm, y + hy, T.z1 + 0.1);
      }
      for (let z = T.z0; z <= T.z1 + 0.01; z += 1.2) gSteel.box(0.05, 1.1, 0.05, xo, y + 0.55, z);
      // cantilevered service arm toward the mech
      gSteel.box(1.8, 0.14, 1.6, s * (T.xin - 0.9), y, -3.6);
      gHaz.box(0.06, 0.18, 1.6, s * (T.xin - 1.8), y + 0.15, -3.6);
    }
    // X bracing on the outer face
    for (let i = 0; i < levels.length; i++) {
      const y0 = i === 0 ? 0.2 : levels[i - 1], y1 = levels[i];
      gSteel.beam(new THREE.Vector3(xo, y0, T.z0), new THREE.Vector3(xo, y1, T.z1), 0.12);
      gSteel.beam(new THREE.Vector3(xo, y0, T.z1), new THREE.Vector3(xo, y1, T.z0), 0.12);
      gSteel.beam(new THREE.Vector3(xi, y0, T.z0), new THREE.Vector3(xo, y1, T.z0), 0.12);
    }
    // stair flight on the outer side
    const sx = s * (T.xout + 0.8);
    gSteel.beam(new THREE.Vector3(sx, 0, T.z1 + 3.5), new THREE.Vector3(sx, levels[0], T.z0 + 0.3), 0.12, 1.1);
    for (let k = 0; k < 16; k++) { const f = k / 16; gSteel.box(1.0, 0.05, 0.28, sx, f * levels[0], lerpN(T.z1 + 3.5, T.z0 + 0.3, f)); }
  }
  // top bridge behind the mech
  gSteel.box(T.xin * 2, 0.16, 1.5, 0, levels[2], T.z0 + 0.75);
  for (const hy of [0.55, 1.1]) gSteel.box(T.xin * 2, 0.05, 0.05, 0, levels[2] + hy, T.z0 + 1.5);
  for (let x = -T.xin; x <= T.xin; x += 1.2) gSteel.box(0.05, 1.1, 0.05, x, levels[2] + 0.55, T.z0 + 1.5);
  gHaz.box(T.xin * 2, 0.22, 0.06, 0, levels[2] + 0.17, T.z0 + 1.52);
  gSteel.build(root); gHaz.build(root);

  // Cable bundles drooping from the gantry into the mech's back
  const cables = new Batch(rubber, { uv: false });
  for (const [s, y, r] of [[-1, 10.2, 0.09], [1, 9.6, 0.11], [-1, 7.1, 0.07], [1, 6.2, 0.08]]) {
    const a = new THREE.Vector3(s * T.xin, y, -4.2), b = new THREE.Vector3(s * 1.9, y - 0.4, -3.4);
    const curve = new THREE.QuadraticBezierCurve3(a, new THREE.Vector3(s * 4.2, y - 2.6, -4.4), b);
    const g = new THREE.TubeGeometry(curve, 24, r, 6, false);
    cables.geos.push(g.toNonIndexed());
  }
  cables.build(root);

  // Containers, drums, carts ------------------------------------------------------------
  const cont = [containerMat(0x6a2f16), containerMat(0x1b3d42), containerMat(0x34383d), containerMat(0x5a4a1e)];
  const cb = cont.map(m => new Batch(m));
  const stacks = [
    [-25.5, -22, 3, 0], [-25.5, -8, 2, 1], [-25.5, 18, 2, 2], [25.5, -20, 2, 3], [25.5, -6, 3, 2], [25.5, 16, 1, 0],
    [-20.5, -24, 1, 2], [20.5, 24, 1, 1],
  ];
  for (const [x, z, n, c] of stacks) for (let i = 0; i < n; i++) cb[(c + i) % cont.length].box(2.44, 2.59, 12.2, x + (i % 2 ? 0.12 : 0), 1.3 + i * 2.6, z + (i % 2 ? -0.25 : 0));
  cb.forEach(b => b.build(root));
  const drumMat = new THREE.MeshStandardMaterial({ color: 0x1e3a55, roughness: 0.5, metalness: 0.6, roughnessMap: steelRough });
  const drums = new Batch(drumMat);
  for (const [x, z] of [[11.5, 3.2], [12.2, 3.9], [11.3, 4.4], [-12.4, -1.5], [-11.8, -0.8], [16, 9], [16.7, 9.5]]) drums.cyl(0.3, 0.3, 0.9, x, 0.45, z, 0, 0, 0, 16);
  drums.build(root);
  const carts = new Batch(darkSteel);
  const cartHaz = new Batch(hazard);
  for (const [x, z, r] of [[-12.5, 4.5, 0.3], [13.2, -1, -0.4]]) {
    carts.box(1.8, 0.08, 0.9, x, 0.9, z, 0, r); carts.box(1.8, 0.08, 0.9, x, 0.35, z, 0, r);
    carts.box(1.7, 0.5, 0.85, x, 1.2, z, 0, r);
    for (const [dx, dz] of [[-0.85, -0.4], [0.85, -0.4], [-0.85, 0.4], [0.85, 0.4]]) carts.box(0.05, 0.9, 0.05, x + dx * Math.cos(r) + dz * Math.sin(r), 0.45, z - dx * Math.sin(r) + dz * Math.cos(r));
    cartHaz.box(1.72, 0.12, 0.87, x, 1.5, z, 0, r);
  }
  // bollards along the lane
  for (let z = 10; z <= 34; z += 6) for (const s of [-1, 1]) cartHaz.cyl(0.12, 0.12, 1.1, s * 10.2, 0.55, z, 0, 0, 0, 10);
  carts.build(root); cartHaz.build(root);

  // Floor vents (grates the steam comes out of)
  const vents = [[-4.6, 3.9], [4.6, 3.9], [-4.6, -4.9], [4.6, -4.9]].map(([x, z]) => new THREE.Vector3(x, 0.02, z));
  const grate = new Batch(darkSteel);
  for (const v of vents) for (let i = -3; i <= 3; i++) grate.box(1.5, 0.05, 0.06, v.x, 0.03, v.z + i * 0.13);
  grate.build(root);
  out.vents = vents;

  // Emergency red strips at the pad corners and along the walls (reflected in the wet floor)
  const redStripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.05, 0.02).multiplyScalar(2.2), toneMapped: true });
  const redStrips = new Batch(redStripMat, { cast: false, receive: false, uv: false });
  for (const s of [-1, 1]) {
    for (let z = HALL.zBack + 4; z < HALL.zFront - 2; z += 8) redStrips.box(0.08, 0.08, 2.4, s * (W - 0.35), 0.95, z);
    redStrips.box(1.6, 0.06, 0.06, s * 7.2, 0.05, 6.8); redStrips.box(1.6, 0.06, 0.06, s * 7.2, 0.05, -7.7);
  }
  redStrips.build(root);
  out.redStripMat = redStripMat;
  // exit signs
  const exitTex = canvasTex(256, 96, (g) => {
    g.fillStyle = '#062a12'; g.fillRect(0, 0, 256, 96);
    g.fillStyle = '#58ff96'; g.font = '700 58px "Chakra Petch", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('EXIT', 128, 52);
  });
  const exitMat = new THREE.MeshBasicMaterial({ map: exitTex, color: new THREE.Color(1.6, 1.6, 1.6) });
  for (const [x, z, ry] of [[-W + 0.35, -16, Math.PI / 2], [W - 0.35, 8, -Math.PI / 2], [-W + 0.35, 24, Math.PI / 2]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.45), exitMat);
    m.position.set(x, 3.4, z); m.rotation.y = ry; root.add(m);
  }

  // Back wall stencil
  const stencil = canvasTex(2048, 1024, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.font = '700 760px "Chakra Petch", "Arial Black", sans-serif';
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText('09', 20, 780);
    g.font = '600 118px "Chakra Petch", Arial, sans-serif';
    g.fillText('HANGAR NINE', 40, 960);
    // stencil bridges + wear
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 2600; i++) { g.globalAlpha = Math.random() * 0.6; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, Math.random() * 7, 0, 7); g.fill(); }
    g.globalAlpha = 1;
    g.fillRect(0, 380, w, 26);
  }, { srgb: false });
  const stencilMat = new THREE.MeshStandardMaterial({ color: 0x9a6a08, alphaMap: stencil, transparent: true, roughness: 0.8, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const sten = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), stencilMat);
  sten.position.set(-12.5, 15.5, HALL.zBack + 0.02);
  sten.receiveShadow = true;
  root.add(sten);

  // Door leaves (slide apart for the finale). Inner faces carry a split "09".
  const doorFace = canvasTex(2048, 1400, (g, w, h) => {
    g.fillStyle = '#101215'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#b07808';
    g.font = '700 1150px "Chakra Petch", "Arial Black", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('09', w / 2, h / 2 + 60);
    g.globalCompositeOperation = 'destination-over';
  });
  const leafW = dw + 0.4;
  const doors = [];
  for (const s of [-1, 1]) {
    const face = doorFace.clone(); face.needsUpdate = true;
    // seen from inside (looking +z) the +x leaf is on the left, so it carries the left half of the "09"
    face.repeat.set(0.5, 1); face.offset.set(s > 0 ? 0 : 0.5, 0);
    const faceMat = new THREE.MeshStandardMaterial({ map: face, roughness: 0.7, metalness: 0.4, normalMap: corrN, normalScale: new THREE.Vector2(0.8, 0.8) });
    const geo = new THREE.BoxGeometry(leafW, dh - 0.2, 0.5);
    const mats = [cladding, cladding, cladding, cladding, cladding, faceMat];
    const m = new THREE.Mesh(geo, mats);
    m.position.set(s * leafW / 2, (dh - 0.2) / 2, HALL.zFront - 1.3);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.closedX = s * leafW / 2;
    m.userData.openX = s * (dw + leafW / 2 + 0.6);
    root.add(m);
    doors.push(m);
  }
  out.doors = doors;

  // Outside: dawn plate beyond the apron
  const dawnTex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}img/hangar/dawn.webp`);
  dawnTex.colorSpace = THREE.SRGBColorSpace;
  const dawnMat = new THREE.MeshBasicMaterial({ map: dawnTex, fog: false, color: new THREE.Color(0, 0, 0) });
  const plateW = 190, plateH = plateW * 1536 / 2752;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(plateW, plateH), dawnMat);
  plate.rotation.y = Math.PI;
  plate.position.set(0, 3.0 + (0.515 - 0.5) * plateH, 124);
  root.add(plate);
  out.dawnMat = dawnMat;

  // Lighting fixtures ------------------------------------------------------------------
  // Bay high-bay lamps: two per truss, switched bay by bay during the cold start.
  const lampBody = new Batch(darkSteel, { cast: false });
  const bays = BAYS_Z.map((z, i) => {
    const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) });
    const lens = [];
    for (const x of [-15, 15]) {
      lampBody.put(new THREE.CylinderGeometry(0.35, 0.75, 0.7, 16, 1, true), x, 21.2, z);
      lampBody.tube(new THREE.Vector3(x, 21.55, z), new THREE.Vector3(x, 22, z), 0.04, 6);
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.66, 20), lensMat);
      l.rotation.x = Math.PI / 2; l.position.set(x, 20.86, z);
      root.add(l); lens.push(l);
    }
    return { z, lensMat, on: 0 };
  });
  lampBody.build(root);
  out.bays = bays;

  // Fake light cones under each bay lamp (cheap; the four hero floods get real raymarched beams).
  const coneMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float aOn;
      varying float vOn; varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vW;
      void main(){
        vOn = aOn; vH = uv.y;
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uTime;
      varying float vOn; varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vW;
      float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f);
        return mix(mix(mix(h13(i), h13(i+vec3(1,0,0)), f.x), mix(h13(i+vec3(0,1,0)), h13(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(h13(i+vec3(0,0,1)), h13(i+vec3(1,0,1)), f.x), mix(h13(i+vec3(0,1,1)), h13(i+vec3(1,1,1)), f.x), f.y), f.z); }
      void main(){
        if (vOn <= 0.001) discard;
        float edge = pow(abs(dot(vN, vV)), 2.2);
        float n = vn(vW * 0.35 + vec3(0.0, -uTime * 0.25, uTime * 0.08)) * 0.7 + 0.3;
        float a = edge * pow(vH, 1.6) * n * vOn;
        gl_FragColor = vec4(vec3(1.0, 0.92, 0.8) * a * 0.03, 1.0);
      }`,
  });
  {
    const geos = [];
    for (const b of bays) for (const x of [-15, 15]) {
      const g = new THREE.CylinderGeometry(0.62, 5.5, 20.6, 28, 1, true);
      g.translate(x, 20.6 / 2 + 0.2, b.z);
      const on = new Float32Array(g.attributes.position.count);
      g.setAttribute('aOn', new THREE.BufferAttribute(on, 1));
      b.coneRange = [geos.reduce((a, gg) => a + gg.attributes.position.count, 0), g.attributes.position.count];
      geos.push(g);
    }
    const cg = mergeGeometries(geos);
    const cones = new THREE.Mesh(cg, coneMat);
    cones.frustumCulled = false;
    cones.renderOrder = 5;
    root.add(cones);
    out.cones = cones; out.coneMat = coneMat;
    out.setBay = (i, v) => {
      const b = bays[i]; b.on = v;
      b.lensMat.color.setRGB(1, 0.94, 0.84).multiplyScalar(v * 14);
      const a = cg.attributes.aOn;
      // two cones per bay, stored consecutively
      const per = a.count / (bays.length * 2);
      for (let k = i * 2 * per; k < (i * 2 + 2) * per; k++) a.array[k] = v;
      a.needsUpdate = true;
      floorU.uPool.value[i * 2].set(-15, b.z, 6.5, v * 1.1);
      floorU.uPool.value[i * 2 + 1].set(15, b.z, 6.5, v * 1.1);
    };
  }

  // Hero floods: 4 real spotlights with raymarched beams, crossing over the mech.
  const floodBody = new Batch(darkSteel, { cast: false });
  const floods = [
    { pos: [-15, 21.2, -14], tgt: [2.6, 1.5, 2.5], power: 4200, shadow: true, angle: 0.2 },
    { pos: [15, 21.2, -14], tgt: [-2.6, 1.5, 2.5], power: 3800, shadow: false, angle: 0.2 },
    { pos: [-13, 21, 13], tgt: [2.4, 3.0, -1.2], power: 650, shadow: false, color: 0xffdcb4 },
    { pos: [13, 21, 13], tgt: [-2.4, 3.0, -1.2], power: 900, shadow: true, color: 0xffe2c0 },
  ].map(f => {
    const light = new THREE.SpotLight(f.color ?? 0xe2eaff, 0, 80, f.angle ?? 0.27, 0.45, 2);
    light.position.set(...f.pos);
    light.target.position.set(...f.tgt);
    if (f.shadow) {
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      light.shadow.camera.near = 6; light.shadow.camera.far = 50;
      light.shadow.bias = -0.00012; light.shadow.normalBias = 0.04;
      light.shadow.autoUpdate = false;
      light.shadow.needsUpdate = true;
    }
    root.add(light, light.target);
    const dir = new THREE.Vector3(...f.tgt).sub(new THREE.Vector3(...f.pos)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    const g = new THREE.CylinderGeometry(0.75, 0.9, 1.2, 20, 1, false);
    g.applyQuaternion(q); g.translate(...f.pos);
    floodBody.geos.push(g.toNonIndexed());
    // yoke up to the truss
    floodBody.tube(new THREE.Vector3(...f.pos), new THREE.Vector3(f.pos[0], 22, f.pos[2]), 0.08, 6);
    const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.72, 24), lensMat);
    lens.position.set(...f.pos).addScaledVector(dir, 0.62);
    lens.lookAt(lens.position.clone().add(dir));
    root.add(lens);
    return { ...f, light, lensMat, on: 0 };
  });
  floodBody.build(root);
  out.floods = floods;

  // Red rotating beacons on top of each gantry tower + a strobe behind the mech.
  const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.04, 0.02) });
  const beacons = [-1, 1].map((s, i) => {
    const p = new THREE.Vector3(s * (T.xin + T.xout) / 2, 13.9, (T.z0 + T.z1) / 2);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.42, 16), beaconMat);
    cap.position.copy(p); root.add(cap);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.14, 16), darkSteel);
    base.position.copy(p).y -= 0.27; root.add(base);
    const light = new THREE.SpotLight(0xff1a0a, 0, 60, 0.22, 0.5, 2);
    light.position.copy(p);
    root.add(light, light.target);
    return { light, pos: p, phase: i * Math.PI, cap };
  });
  out.beacons = beacons; out.beaconMat = beaconMat;
  out.T = T; out.levels = levels;
  return out;
}

function lerpN(a, b, t) { return a + (b - a) * t; }
