// The smithy: soot-black brick room, a coal forge with a hood, a brine trough, tools on the wall, a moonlit window.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { bakeTexture, fbmNormal } from '../../src/core/textures.js';
import { NOISE, BLACKBODY } from './glsl.js';

export const ROOM = { x0: -3.3, x1: 3.9, z0: -2.9, z1: 4.6, h: 3.6 };
export const FORGE = new THREE.Vector3(1.45, 0, -2.3);   // hearth centre on the floor
export const FIRE = new THREE.Vector3(1.45, 0.86, -2.22); // top of the coal bed
export const TROUGH = new THREE.Vector3(1.2, 0, 0.45);
export const WATER_Y = 0.55;
export const PRES_Y = 2.32;                               // presentation blade above the tool rack
export const PEGS = [-1.58, -1.02];
export const BLOCK = new THREE.Vector3(2.05, 0, 1.75);     // oak sword block, in front of the moonlit window
export const BLOCK_H = 0.68;

const rnd = (a, b) => a + Math.random() * (b - a);

export function buildSmithy({ scene, renderer, tex }) {
  const out = { uniforms: [] };
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const T = (t, rx, ry) => { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(rx, ry); c.anisotropy = aniso; c.needsUpdate = true; return c; };

  // ─── Soot gradient patch for walls (darker toward the ceiling, warmer near the hearth) ───
  const soot = (mat, { top = 3.2, amount = 0.72 } = {}) => {
    mat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSootW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvSootW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSootW;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          diffuseColor.rgb *= mix(1.0, 1.0 - ${amount.toFixed(2)}, smoothstep(0.6, ${top.toFixed(2)}, vSootW.y));
          diffuseColor.rgb *= 1.0 - 0.45 * exp(-length(vSootW.xz - vec2(${FORGE.x.toFixed(2)}, ${FORGE.z.toFixed(2)})) * 1.1) * smoothstep(1.2, 2.4, vSootW.y);`);
    };
    mat.customProgramCacheKey = () => 'soot' + top + amount;
    return mat;
  };

  // ─── Room ───
  const W = ROOM.x1 - ROOM.x0, D = ROOM.z1 - ROOM.z0;
  const floorMat = new THREE.MeshStandardMaterial({
    map: T(tex.floor, W / 2.2, D / 2.2), normalMap: T(tex.floorN, W / 2.2, D / 2.2), normalScale: new THREE.Vector2(0.9, 0.9),
    color: 0x464341, roughness: 0.72, metalness: 0, envMapIntensity: 0.35,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.set((ROOM.x0 + ROOM.x1) / 2, 0, (ROOM.z0 + ROOM.z1) / 2);
  floor.receiveShadow = true;
  scene.add(floor);
  out.floor = floor;

  const brick = (w, h) => soot(new THREE.MeshStandardMaterial({
    map: T(tex.brick, w / 1.05, h / 1.05), normalMap: T(tex.brickN, w / 1.05, h / 1.05), normalScale: new THREE.Vector2(0.95, 0.95),
    color: 0x5a5856, roughness: 0.88, metalness: 0, envMapIntensity: 0.2,
  }));
  const wall = (w, h, pos, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), brick(w, h));
    m.position.copy(pos); m.rotation.y = ry; m.receiveShadow = true; scene.add(m); return m;
  };
  wall(W, ROOM.h, new THREE.Vector3((ROOM.x0 + ROOM.x1) / 2, ROOM.h / 2, ROOM.z0), 0);
  wall(D, ROOM.h, new THREE.Vector3(ROOM.x0, ROOM.h / 2, (ROOM.z0 + ROOM.z1) / 2), Math.PI / 2);
  wall(D, ROOM.h, new THREE.Vector3(ROOM.x1, ROOM.h / 2, (ROOM.z0 + ROOM.z1) / 2), -Math.PI / 2);
  wall(W, ROOM.h, new THREE.Vector3((ROOM.x0 + ROOM.x1) / 2, ROOM.h / 2, ROOM.z1), Math.PI);

  // Ceiling and heavy oak beams.
  const woodAlb = bakeTexture(renderer, 1024, `
    void main(){
      vec2 p = vUv * vec2(1.0, 8.0);
      float g = fbm(vec2(vUv.x * 3.0, vUv.y * 40.0), 3.0, 5, 0.55);
      float rings = sin((vUv.x * 60.0 + g * 9.0)) * 0.5 + 0.5;
      float n = fbm(vUv * 12.0, 12.0, 5, 0.5) * 0.5 + 0.5;
      vec3 c = mix(vec3(0.075, 0.05, 0.034), vec3(0.16, 0.105, 0.066), rings * 0.55 + n * 0.45);
      c *= 0.75 + 0.5 * fbm(vUv * 5.0 + 3.1, 5.0, 4, 0.5);
      gl_FragColor = vec4(c, 1.0);
    }`);
  const woodN = fbmNormal(renderer, { size: 512, scale: 6, octaves: 5, strength: 1.4 });
  const woodMat = new THREE.MeshStandardMaterial({ map: woodAlb, normalMap: woodN, roughness: 0.82, color: 0xffffff });
  out.woodMat = woodMat;
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x0c0a09, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(floor.position.x, ROOM.h, floor.position.z);
  scene.add(ceil);
  for (const x of [-2.3, -0.7, 0.9, 2.5]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, D), woodMat);
    b.position.set(x, ROOM.h - 0.14, floor.position.z); b.receiveShadow = true; scene.add(b);
  }
  const tie = new THREE.Mesh(new THREE.BoxGeometry(W, 0.24, 0.2), woodMat);
  tie.position.set(floor.position.x, ROOM.h - 0.4, -0.6); tie.receiveShadow = true; scene.add(tie);

  // ─── Forge hearth ───
  const hw = 1.45, hd = 1.15, hh = 0.8;
  const hearth = new THREE.Mesh(new RoundedBoxGeometry(hw, hh, hd, 2, 0.02), brick(hw * 1.2, hh * 1.2));
  hearth.material = new THREE.MeshStandardMaterial({ map: T(tex.brick, 1.4, 0.8), normalMap: T(tex.brickN, 1.4, 0.8), normalScale: new THREE.Vector2(1.3, 1.3), color: 0x9a8a7e, roughness: 0.9 });
  hearth.position.set(FORGE.x, hh / 2, ROOM.z0 + hd / 2);
  hearth.castShadow = hearth.receiveShadow = true;
  scene.add(hearth);
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.75, metalness: 0.25, normalMap: fbmNormal(renderer, { size: 512, scale: 7, octaves: 6, strength: 2.2 }) });
  const slab = new THREE.Mesh(new RoundedBoxGeometry(hw + 0.08, 0.07, hd + 0.06, 2, 0.015), slabMat);
  slab.position.set(FORGE.x, hh + 0.03, ROOM.z0 + hd / 2 + 0.02);
  slab.castShadow = slab.receiveShadow = true;
  scene.add(slab);
  // Iron fire-pot rim.
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x2a2522, roughness: 0.55, metalness: 0.85, normalMap: slabMat.normalMap });
  out.ironMat = ironMat;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.028, 10, 48), ironMat);
  rim.rotation.x = Math.PI / 2; rim.position.set(FIRE.x, hh + 0.075, FIRE.z);
  rim.castShadow = true; scene.add(rim);

  // Coal bed glow + lumps.
  const fireU = { uTime: { value: 0 }, uFire: { value: 1 } };
  out.fire = fireU;
  const bed = new THREE.Mesh(new THREE.CircleGeometry(0.34, 48), new THREE.ShaderMaterial({
    uniforms: fireU,
    vertexShader: 'varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position,1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.); }',
    fragmentShader: `uniform float uTime, uFire; varying vec3 vW; ${NOISE} ${BLACKBODY}
      void main(){
        vec2 d = vW.xz - vec2(${FIRE.x.toFixed(3)}, ${FIRE.z.toFixed(3)});
        float r = length(d) / 0.34;
        float n = fbm3(vec3(vW.xz * 14.0, uTime * 0.4));
        float h = clamp((1.0 - r * r) * 0.85 + n * 0.45, 0.0, 1.0) * (0.75 + uFire * 0.35);
        float K = 900.0 + h * 700.0;
        gl_FragColor = vec4(blackbody(K) * glowPower(K) * 14.0 * smoothstep(1.0, 0.8, r), 1.0);
      }`,
  }));
  bed.rotation.x = -Math.PI / 2; bed.position.set(FIRE.x, hh + 0.072, FIRE.z);
  scene.add(bed);

  const coalMat = new THREE.MeshStandardMaterial({ color: 0x0c0b0a, roughness: 0.92, metalness: 0.0, flatShading: true });
  coalMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, fireU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCW; varying vec3 vCN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vCW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vCN = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);
        #else
          vCW = (modelMatrix * vec4(transformed, 1.0)).xyz; vCN = normalize(mat3(modelMatrix) * objectNormal);
        #endif`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vCW; varying vec3 vCN; uniform float uTime, uFire; ${NOISE} ${BLACKBODY}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 d = vCW.xz - vec2(${FIRE.x.toFixed(3)}, ${FIRE.z.toFixed(3)});
          float r = length(d) / 0.36;
          float n = fbm3(vCW * 16.0 + vec3(0.0, -uTime * 0.45, uTime * 0.1));
          float depth = clamp(1.0 - (vCW.y - ${(0.8 + 0.07).toFixed(3)}) / 0.13, 0.0, 1.0);
          float down = 1.0 - clamp(vCN.y, 0.0, 1.0) * 0.55;
          float h = clamp(n * 0.7 + depth * 0.55 + (1.0 - r) * 0.35 - 0.35, 0.0, 1.0) * down;
          h *= 0.55 + uFire * 0.55;
          float K = 700.0 + h * 1000.0;
          totalEmissiveRadiance += blackbody(K) * glowPower(K) * 18.0;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.115, 0.11), smoothstep(0.55, 0.95, vCN.y) * (1.0 - h) * 0.6);
        }`);
  };
  coalMat.customProgramCacheKey = () => 'coal';
  {
    const variants = [0, 1, 2].map(k => {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, i);
        v.multiplyScalar(0.72 + Math.random() * 0.5).multiply(new THREE.Vector3(1, 0.7 + k * 0.1, 1));
        p.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      return g;
    });
    const N = 110, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), pp = new THREE.Vector3();
    for (const g of variants) {
      const im = new THREE.InstancedMesh(g, coalMat, N);
      for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.36;
        const dome = Math.max(0, 1 - (r / 0.4) ** 2);
        pp.set(FIRE.x + Math.cos(a) * r, hh + 0.08 + dome * 0.1 * Math.random() + dome * 0.03, FIRE.z + Math.sin(a) * r);
        e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); q.setFromEuler(e);
        const sz = rnd(0.028, 0.06); s.set(sz, sz, sz);
        im.setMatrixAt(i, m4.compose(pp, q, s));
      }
      im.castShadow = false; im.receiveShadow = true;
      scene.add(im);
    }
  }
  // Flames: a few crossed sheets of licking fire.
  const flameU = { uTime: fireU.uTime, uFire: fireU.uFire };
  const flameMat = new THREE.ShaderMaterial({
    uniforms: flameU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; varying float vS; attribute float seed; void main(){ vUv = uv; vS = seed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform float uTime, uFire; varying vec2 vUv; varying float vS; ${NOISE} ${BLACKBODY}
      void main(){
        vec2 p = vUv;
        float n = fbm3(vec3(p.x * 3.2 + vS * 7.0, p.y * 2.2 - uTime * (1.3 + uFire * 0.6), uTime * 0.3 + vS));
        float shape = smoothstep(0.5, 0.05, abs(p.x - 0.5 + n * 0.12)) * smoothstep(1.0, 0.0, p.y * (1.25 - uFire * 0.3) + n * 0.35);
        float h = clamp(shape * (1.1 - p.y) * 1.3, 0.0, 1.0);
        float K = 900.0 + h * 700.0;
        gl_FragColor = vec4(blackbody(K) * glowPower(K) * 7.0 * h * (0.4 + uFire * 0.5), 1.0);
      }`,
  });
  for (let i = 0; i < 4; i++) {
    const g = new THREE.PlaneGeometry(0.62, 0.55);
    g.translate(0, 0.27, 0);
    g.setAttribute('seed', new THREE.BufferAttribute(new Float32Array(4).fill(i * 0.37), 1));
    const f = new THREE.Mesh(g, flameMat);
    f.position.set(FIRE.x + rnd(-0.05, 0.05), hh + 0.1, FIRE.z + rnd(-0.05, 0.05));
    f.rotation.y = i * Math.PI / 4;
    f.renderOrder = 3;
    scene.add(f);
  }

  // Hood + chimney (sheet iron).
  const hoodMat = new THREE.MeshStandardMaterial({ color: 0x1b1816, roughness: 0.6, metalness: 0.7, normalMap: slabMat.normalMap, side: THREE.DoubleSide });
  {
    const g = new THREE.CylinderGeometry(0.36, 0.95, 0.85, 4, 1, true);
    g.rotateY(Math.PI / 4);
    g.scale(1, 1, 0.78);
    const hood = new THREE.Mesh(g, hoodMat);
    hood.position.set(FORGE.x, 1.62 + 0.42, ROOM.z0 + 0.6);
    hood.castShadow = hood.receiveShadow = true;
    scene.add(hood);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.05, 1.06), hoodMat);
    lip.position.set(FORGE.x, 1.6, ROOM.z0 + 0.6); lip.receiveShadow = true;
    // Only the front and side lips, as a frame.
    const frame = new THREE.Group();
    for (const [w, d, x, z] of [[1.36, 0.05, 0, 0.5], [0.05, 1.06, -0.66, 0], [0.05, 1.06, 0.66, 0]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), ironMat); b.position.set(x, 0, z); b.castShadow = true; frame.add(b);
    }
    frame.position.set(FORGE.x, 1.6, ROOM.z0 + 0.6); scene.add(frame);
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.52, ROOM.h - 2.45, 0.52), hoodMat);
    chim.position.set(FORGE.x, 2.45 + (ROOM.h - 2.45) / 2, ROOM.z0 + 0.46); chim.receiveShadow = true;
    scene.add(chim);
  }

  // ─── Slack tub: half a wine barrel of brine ───
  {
    const g = new THREE.Group();
    const R = 0.34, H = 0.6, staves = 20;
    const staveAlb = bakeTexture(renderer, 1024, `
      void main(){
        float sx = vUv.x * ${staves}.0;
        float id = floor(sx), f = fract(sx);
        float seam = smoothstep(0.0, 0.035, f) * smoothstep(1.0, 0.965, f);
        float tone = fract(sin(id * 91.7) * 43758.5);
        float grain = fbm(vec2(vUv.x * 60.0 + id * 3.1, vUv.y * 4.0), 4.0, 5, 0.55) * 0.5 + 0.5;
        float streak = fbm(vec2(vUv.x * 240.0, vUv.y * 2.0), 2.0, 4, 0.6) * 0.5 + 0.5;
        vec3 c = mix(vec3(0.08, 0.045, 0.024), vec3(0.24, 0.14, 0.075), tone * 0.55 + grain * 0.45) * (0.7 + streak * 0.5);
        c *= mix(0.45, 1.0, smoothstep(0.0, 0.3, vUv.y));      // water-darkened foot
        c *= mix(1.0, 0.55, smoothstep(0.8, 1.0, vUv.y));       // wet rim
        float drip = smoothstep(0.55, 0.9, fbm(vec2(vUv.x * 90.0, vUv.y * 1.5), 1.5, 4, 0.5) + vUv.y * 0.3);
        c *= 1.0 - drip * 0.35;
        gl_FragColor = vec4(c * mix(0.2, 1.0, seam), 1.0);
      }`);
    staveAlb.repeat.set(1, 1);
    const staveN = bakeTexture(renderer, 1024, `
      void main(){
        float sx = vUv.x * ${staves}.0; float f = fract(sx);
        float seam = smoothstep(0.0, 0.05, f) - smoothstep(0.95, 1.0, f);
        float gr = fbm(vec2(vUv.x * 80.0, vUv.y * 6.0), 6.0, 4, 0.5);
        gl_FragColor = vec4(0.5 + seam * 0.35 + gr * 0.05, 0.5 + gr * 0.12, 1.0, 1.0);
      }`);
    const staveRough = bakeTexture(renderer, 512, `
      void main(){
        float wet = smoothstep(0.75, 1.0, vUv.y) + (1.0 - smoothstep(0.0, 0.2, vUv.y));
        float n = fbm(vec2(vUv.x * 50.0, vUv.y * 5.0), 5.0, 4, 0.5) * 0.5 + 0.5;
        gl_FragColor = vec4(1.0, clamp(0.5 + n * 0.25 - wet * 0.3, 0.12, 1.0), 0.0, 1.0);
      }`);
    const staveMat = new THREE.MeshPhysicalMaterial({ map: staveAlb, normalMap: staveN, normalScale: new THREE.Vector2(2.0, 2.0), roughnessMap: staveRough, roughness: 1, metalness: 0,
      clearcoat: 0.7, clearcoatRoughness: 0.3, side: THREE.DoubleSide, envMapIntensity: 1.0 });
    // Blackened, hammered hoop iron.
    const hoopMat = new THREE.MeshStandardMaterial({ color: 0x100e0d, roughness: 0.48, metalness: 0.7, normalMap: ironMat.normalMap, normalScale: new THREE.Vector2(1.4, 1.4), envMapIntensity: 1.1 });
    out.hoopMat = hoopMat;
    // Bulged barrel profile, cut at the waist.
    const prof = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push(new THREE.Vector2(R * (0.9 + 0.1 * Math.sin(t * Math.PI * 0.95 + 0.2)), t * H)); }
    const shell = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), staveMat);
    shell.castShadow = shell.receiveShadow = true; g.add(shell);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.93, R * 0.86, H - 0.02, 48, 1, true), new THREE.MeshPhysicalMaterial({ color: 0x0a0605, roughness: 0.55, clearcoat: 1, clearcoatRoughness: 0.2, side: THREE.BackSide }));
    inner.position.y = H / 2; g.add(inner);
    const rimTop = new THREE.Mesh(new THREE.TorusGeometry(R * 0.965, 0.018, 8, 64), staveMat);
    rimTop.rotation.x = Math.PI / 2; rimTop.position.y = H; g.add(rimTop);
    for (const [y, r] of [[0.08, 0.93], [0.44, 0.995], [0.57, 0.97]]) {
      const hoop = new THREE.Mesh(new THREE.CylinderGeometry(R * r + 0.007, R * r + 0.007, 0.045, 64, 1, true), hoopMat);
      hoop.position.y = y; hoop.castShadow = true; g.add(hoop);
      for (let k = 0; k < 6; k++) { // rivets
        const a = k / 6 * Math.PI * 2 + y * 9;
        const rv = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), hoopMat);
        rv.position.set(Math.cos(a) * (R * r + 0.008), y, Math.sin(a) * (R * r + 0.008)); g.add(rv);
      }
    }
    const waterU = { uTime: { value: 0 }, uGlow: { value: new THREE.Color(0, 0, 0) }, uBlade: { value: new THREE.Vector2(0, 0) }, uBoil: { value: 0 } };
    out.water = waterU;
    const waterN = fbmNormal(renderer, { size: 512, scale: 5, octaves: 4, strength: 0.8 });
    waterN.wrapS = waterN.wrapT = THREE.RepeatWrapping;
    const wmat = new THREE.MeshStandardMaterial({ color: 0x010101, roughness: 0.04, metalness: 0.0, normalMap: waterN, normalScale: new THREE.Vector2(0.12, 0.12), envMapIntensity: 1.2 });
    waterU.uForgeCol = { value: new THREE.Color(1.0, 0.36, 0.09) };
    wmat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, waterU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
          varying vec3 vWW; uniform float uTime, uBoil; uniform vec3 uGlow, uForgeCol; uniform vec2 uBlade; ${NOISE}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            float dd = length(vWW.xz - uBlade);
            float ripple = sin(dd * 70.0 - uTime * 11.0) * exp(-dd * 14.0) * uBoil * 0.5;
            float boil = snoise(vec3(vWW.xz * 70.0, uTime * 4.0)) * exp(-dd * 16.0) * uBoil;
            vec2 idle = vec2(snoise(vec3(vWW.xz * 18.0, uTime * 0.35)), snoise(vec3(vWW.xz * 18.0 + 7.0, uTime * 0.35))) * 0.05;
            normal = normalize(normal + vec3(ripple * 0.3 + boil * 0.35 + idle.x, 0.0, ripple * 0.2 + boil * 0.3 + idle.y));
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            float dd = length(vWW.xz - uBlade);
            float fz = snoise(vec3(vWW.xz * 90.0, uTime * 5.0));
            totalEmissiveRadiance += uGlow * exp(-dd * 26.0) * (0.6 + 0.4 * fz);
            totalEmissiveRadiance += vec3(0.5, 0.52, 0.55) * smoothstep(0.35, 0.8, fz) * exp(-dd * 18.0) * uBoil * 0.25;
            // The forge, smeared across the dark brine by the ripples.
            vec3 Nw = inverseTransformDirection(normal, viewMatrix);
            vec3 Vw = normalize(vWW - cameraPosition);
            vec3 Rw = reflect(Vw, Nw);
            vec2 Fd = normalize(vec2(${FIRE.x.toFixed(3)}, ${FIRE.z.toFixed(3)}) - vWW.xz);
            float az = max(dot(normalize(Rw.xz), Fd), 0.0);
            float fr = 0.04 + 0.96 * pow(1.0 - clamp(dot(-Vw, Nw), 0.0, 1.0), 5.0);
            float glint = pow(az, 14.0) * smoothstep(-0.05, 0.45, Rw.y);
            totalEmissiveRadiance += uForgeCol * glint * (0.25 + fr * 2.5);
          }`);
    };
    wmat.customProgramCacheKey = () => 'water';
    const water = new THREE.Mesh(new THREE.CircleGeometry(R * 0.93, 64), wmat);
    water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y; water.receiveShadow = true;
    g.add(water);
    out.waterMat = wmat;
    g.position.copy(TROUGH);
    scene.add(g);
    out.trough = g;
    out.waterMesh = water;
  }

  // ─── Wall tools ───
  {
    const rack = new THREE.Mesh(new RoundedBoxGeometry(2.4, 0.12, 0.07, 2, 0.01), woodMat);
    rack.position.set(-1.35, 1.72, ROOM.z0 + 0.04); rack.castShadow = rack.receiveShadow = true; scene.add(rack);
    // Tongs: two long reins with jaws.
    const tongs = (x, jaw, rot) => {
      const grp = new THREE.Group();
      for (const s of [-1, 1]) {
        const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 0.012, -0.35, 0.01), new THREE.Vector3(s * 0.02, -0.62, 0.012), new THREE.Vector3(s * 0.03, -0.7, 0.012),
          new THREE.Vector3(s * (0.02 + jaw), -0.78, 0.015), new THREE.Vector3(s * 0.012, -0.86, 0.02)];
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.009, 6), ironMat);
        tube.castShadow = true; grp.add(tube);
      }
      const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), ironMat); rivet.position.set(0, -0.68, 0.02); grp.add(rivet);
      grp.position.set(x, 1.66, ROOM.z0 + 0.08); grp.rotation.z = rot; scene.add(grp);
    };
    tongs(-2.3, 0.03, 0.03); tongs(-2.12, 0.05, -0.02); tongs(-1.95, 0.02, 0.04);
    // Poker and shovel.
    const rod = (x, len, rot, head) => {
      const grp = new THREE.Group();
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, len, 8), ironMat); r.position.y = -len / 2; r.castShadow = true; grp.add(r);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.006, 6, 20), ironMat); ring.position.y = 0.02; grp.add(ring);
      if (head) { const h = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.012), ironMat); h.position.y = -len - 0.06; h.castShadow = true; grp.add(h); }
      grp.position.set(x, 1.66, ROOM.z0 + 0.07); grp.rotation.z = rot; scene.add(grp);
    };
    rod(-0.25, 1.05, 0.02, true); rod(-0.08, 1.1, -0.03, false);
    // Steel bar stock leaning in the corner.
    for (let i = 0; i < 7; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.3 + Math.random() * 0.3, 0.012), ironMat);
      b.position.set(2.62 + i * 0.045, 0.66, ROOM.z0 + 0.14 + Math.random() * 0.05); b.rotation.z = 0.08 + Math.random() * 0.05; b.rotation.x = -0.1;
      b.castShadow = true; scene.add(b);
    }
  }

  // ─── Window with moonlight on the left wall ───
  {
    const grp = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), new THREE.ShaderMaterial({
      fog: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: `varying vec2 vUv; ${NOISE}
        void main(){
          // Night over the valley: deep blue sky, a smear of cloud, the moon's halo in the upper pane, old uneven glass.
          vec2 p = vUv;
          float wob = snoise(vec3(p * 9.0, 1.0)) * 0.01;
          vec3 sky = mix(vec3(0.004, 0.006, 0.012), vec3(0.02, 0.032, 0.065), smoothstep(0.0, 1.0, p.y + wob));
          float cloud = smoothstep(0.1, 0.7, fbm3(vec3(p.x * 2.2, p.y * 4.0, 3.0)) * 0.5 + 0.5);
          sky = mix(sky, vec3(0.03, 0.036, 0.05), cloud * 0.5);
          vec2 m = p - vec2(0.72, 0.8);
          float halo = exp(-dot(m, m) * 30.0);
          sky += vec3(0.25, 0.3, 0.42) * halo * 0.35 + vec3(0.9, 0.95, 1.0) * smoothstep(0.035, 0.025, length(m)) * 0.8;
          float ridge = step(p.y, 0.12 + 0.05 * sin(p.x * 7.0) + 0.03 * snoise(vec3(p.x * 6.0, 0.0, 2.0)));
          sky = mix(sky, vec3(0.002, 0.003, 0.005), ridge);
          gl_FragColor = vec4(sky, 1.0);
        }`,
    }));
    grp.add(glass);
    const bar = (w, h, x, y) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), woodMat); b.position.set(x, y, 0.02); grp.add(b); };
    bar(0.9, 0.07, 0, 0.52); bar(0.9, 0.07, 0, -0.52); bar(0.07, 1.1, -0.43, 0); bar(0.07, 1.1, 0.43, 0); bar(0.8, 0.035, 0, 0); bar(0.035, 1.0, 0, 0);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.18), woodMat); sill.position.set(0, -0.58, 0.07); grp.add(sill);
    grp.position.set(ROOM.x1 - 0.01, 2.35, 0.55); grp.rotation.y = -Math.PI / 2;
    scene.add(grp);
    out.window = grp;
  }

  // ─── Pegs for the presentation blade above the rack ───
  for (const x of PEGS) {
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.075, 10), ironMat);
    peg.rotation.x = Math.PI / 2; peg.position.set(x, PRES_Y - 0.036, ROOM.z0 + 0.037); peg.castShadow = true; scene.add(peg);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.008, 0.03, 10), ironMat);
    tip.position.set(x, PRES_Y - 0.024, ROOM.z0 + 0.072); scene.add(tip);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.006, 16), ironMat);
    plate.rotation.x = Math.PI / 2; plate.position.set(x, PRES_Y - 0.036, ROOM.z0 + 0.003); scene.add(plate);
  }

  // ─── The sword block: where the finished blade stands ───
  {
    const blockMat = new THREE.MeshPhysicalMaterial({ map: woodAlb, normalMap: woodN, color: 0x6a5a50, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.4, envMapIntensity: 0.8 });
    const g = new THREE.Group();
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.3, BLOCK_H, 0.3, 3, 0.02), blockMat);
    b.position.y = BLOCK_H / 2; b.castShadow = b.receiveShadow = true; g.add(b);
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x100e0d, roughness: 0.45, metalness: 0.75, normalMap: ironMat.normalMap, envMapIntensity: 1.1 });
    for (const y of [0.09, BLOCK_H - 0.09]) {
      const band = new THREE.Mesh(new RoundedBoxGeometry(0.312, 0.04, 0.312, 2, 0.006), bandMat);
      band.position.y = y; band.castShadow = true; g.add(band);
    }
    const cap = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.014, 0.1, 2, 0.004), bandMat);
    cap.position.y = BLOCK_H + 0.006; g.add(cap);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.004, 0.024), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    slot.position.y = BLOCK_H + 0.014; g.add(slot);
    g.position.copy(BLOCK);
    scene.add(g);
    out.block = g;
  }

  // ─── Hanging lantern by the tool wall ───
  {
    const grp = new THREE.Group();
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.2, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0x222, metalness: 0.8, roughness: 0.5, wireframe: true }));
    grp.add(cage);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 4.2, 1.6) }));
    grp.add(glow);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.07, 6), ironMat); cap.position.y = 0.13; grp.add(cap);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.4, 4), ironMat); chain.position.y = 0.86; grp.add(chain);
    grp.position.set(-2.45, 2.2, -2.45);
    scene.add(grp);
    out.lantern = grp;
  }

  return out;
}
