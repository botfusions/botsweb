// The garden around the water: one terrain (pond floor below y=0, moss banks above), shoreline rocks.
import * as THREE from 'three';
import { bakeTexture, fbmNormal, fbmTexture } from '../../src/core/textures.js';
import { patchUnder } from './water.js';
import { terrainH, pondSDF, noise, fbm, LANTERN } from './shape.js';

export const gardenShared = {
  uFloorTex: { value: null }, uMossTex: { value: null }, uNoiseTex: { value: null }, uGranite: { value: null },
  uSnow: { value: 0 }, uMossTint: { value: new THREE.Color(1, 1, 1) }, uSilt: { value: new THREE.Color(0.10, 0.11, 0.06) },
};

const TERRAIN_HEAD = /* glsl */`
  uniform sampler2D uFloorTex, uMossTex, uNoiseTex; uniform float uSnow; uniform vec3 uMossTint, uSilt;
  varying vec3 vWN;
  vec3 terrainAlbedo(vec3 wp, out float rough){
    vec2 q = wp.xz;
    vec2 q2 = mat2(0.8, -0.6, 0.6, 0.8) * q;
    float h = wp.y;
    float nb = texture2D(uNoiseTex, q * 0.045).r;
    float nb2 = texture2D(uNoiseTex, q * 0.13 + 0.5).r;
    vec3 f1 = texture2D(uFloorTex, q / 3.1, 1.2).rgb;
    vec3 f2 = texture2D(uFloorTex, q2 / 4.3 + 0.31, 2.0).rgb;
    vec3 fl = mix(f1, f2, smoothstep(0.42, 0.58, nb));
    // broad variation: sand fans, darker algae beds
    float big = texture2D(uNoiseTex, q * 0.021 + 0.3).r;
    fl *= 0.55 + big * 0.9;
    fl = mix(fl, vec3(0.34, 0.30, 0.22) * (0.8 + nb2 * 0.4), smoothstep(0.62, 0.8, big) * 0.45 * smoothstep(-1.1, -0.3, h));
    // fine silt and algae settle in the deep water
    float silt = smoothstep(-0.2, -0.9, h) * smoothstep(0.15, 0.6, nb2 + 0.25);
    fl = mix(fl * 0.75, uSilt * (0.6 + nb * 0.7), silt * 0.85);
    fl *= mix(vec3(1.), vec3(0.62, 0.72, 0.5), smoothstep(-0.1, -0.9, h));
    vec3 m1 = texture2D(uMossTex, q / 2.1).rgb;
    vec3 m2 = texture2D(uMossTex, q2 / 2.9 + 0.5).rgb;
    vec3 moss = mix(m1, m2, smoothstep(0.4, 0.6, nb2)) * uMossTint;
    moss = mix(moss, moss * vec3(0.72, 0.62, 0.42), smoothstep(0.55, 0.8, nb) * 0.6);
    float mossW = smoothstep(0.035, 0.13, h + (nb - 0.5) * 0.1);
    float wet = smoothstep(0.09, 0.0, h);
    vec3 shore = fl * mix(1.0, 0.55, wet);
    vec3 col = mix(shore, moss, mossW);
    float up = smoothstep(0.55, 0.9, vWN.y);
    col = mix(col, vec3(0.92, 0.94, 0.97), uSnow * mossW * up * smoothstep(0.3, 0.55, nb2 + uSnow * 0.4));
    rough = mix(mix(0.8, 0.28, wet), 0.96, mossW);
    return col;
  }
`;

export function terrainTextures(renderer, assets) {
  gardenShared.uNoiseTex.value = fbmTexture(renderer, { size: 512, scale: 4, octaves: 5, contrast: 1.4 });
  return Promise.all([
    assets.texture('img/koi/floor.webp', { repeat: [1, 1] }).then(t => { t.anisotropy = 16; gardenShared.uFloorTex.value = t; }),
    assets.texture('img/koi/moss.webp', { repeat: [1, 1] }).then(t => { t.anisotropy = 16; gardenShared.uMossTex.value = t; }),
  ]);
}

export function buildTerrain(renderer) {
  const S = 38, N = 300;
  const geo = new THREE.PlaneGeometry(S, S, N, N);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, terrainH(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const nrm = fbmNormal(renderer, { size: 1024, scale: 16, octaves: 6, strength: 2.2 });
  nrm.repeat.set(S / 1.6, S / 1.6);
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, normalMap: nrm, normalScale: new THREE.Vector2(0.9, 0.9), envMapIntensity: 0.7 });
  patchUnder(mat, {
    key: 'terrain',
    extraVertexHead: 'varying vec3 vWN;',
    extraFragHead: TERRAIN_HEAD,
    mapFragment: 'float kRough; diffuseColor.rgb *= terrainAlbedo(vWP, kRough);',
    roughFragment: 'float roughnessFactor = kRough;',
    custom: {
      uniforms: gardenShared,
      patch: sh => { sh.vertexShader = sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal);'); },
    },
  });
  // the patch above inserted vWN after worldpos; make sure it comes after patchUnder's own worldpos replacement
  const under = new THREE.Mesh(geo, mat);
  under.receiveShadow = true; under.castShadow = false;
  const above = new THREE.Mesh(geo, mat);
  above.receiveShadow = true; above.castShadow = true;
  return { under, above, geo, mat };
}

// ─── Rocks ─────────────────────────────────────────────────────────────────────
function rockGeometry(seed, detail = 5) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position, v = new THREE.Vector3(), d = new THREE.Vector3();
  const sx = seed * 7.13, sz = seed * 3.71;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    d.copy(v);
    // weathered boulder: broad lumps, a few ridges, a flattened top and a buried base
    const broad = fbm(d.x * 0.9 + sx, d.y * 0.9 + d.z * 0.7 + sz, 3) * 0.5;
    const ridg = (1 - Math.abs(noise(d.x * 2.2 + sz, d.z * 2.2 + d.y * 1.6 - sx))) * 0.05;
    const fine = noise(d.x * 7 - sx, d.y * 7 + d.z * 4) * 0.01;
    v.multiplyScalar(1 + broad + ridg + fine);
    if (v.y > 0.6) v.y = 0.6 + (v.y - 0.6) * 0.7;
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function rockMaterial(renderer) {
  const granite = bakeTexture(renderer, 1024, /* glsl */`
    void main(){
      float n = fbm(vUv * 6., 6., 6, .55);
      float sp = pnoise(vUv * 180., 180.); float sp2 = pnoise(vUv * 90. + 3., 90.);
      vec3 base = mix(vec3(0.11, 0.105, 0.10), vec3(0.27, 0.26, 0.24), n * .5 + .5);
      base = mix(base, vec3(0.05, 0.05, 0.045), smoothstep(0.2, 0.45, sp) * 0.75);
      base = mix(base, vec3(0.42, 0.41, 0.37), smoothstep(0.3, 0.5, sp2) * 0.4);
      float lich = smoothstep(0.12, 0.32, fbm(vUv * 7. + 2., 7., 5, .55));
      base = mix(base, vec3(0.52, 0.55, 0.46), lich * 0.45);
      float dark = smoothstep(0.05, 0.3, fbm(vUv * 4. + 7., 4., 4, .5));
      base *= 1.0 - dark * 0.35;
      gl_FragColor = vec4(base, 1.);
    }`);
  gardenShared.uGranite.value = granite;
  const nrm = fbmNormal(renderer, { size: 1024, scale: 10, octaves: 7, strength: 3.2, ridged: true });
  nrm.repeat.set(3, 3);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, normalMap: nrm, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 0.55 });
  patchUnder(mat, {
    key: 'rock',
    extraVertexHead: 'varying vec3 vWN; varying vec3 vOP;',
    extraFragHead: /* glsl */`
      uniform sampler2D uGranite, uMossTex, uNoiseTex; uniform float uSnow; uniform vec3 uMossTint;
      varying vec3 vWN; varying vec3 vOP;`,
    mapFragment: /* glsl */`
      vec3 an = abs(normalize(vWN));
      vec3 gx = texture2D(uGranite, vWP.zy * 0.8).rgb, gy = texture2D(uGranite, vWP.xz * 0.8).rgb, gz = texture2D(uGranite, vWP.xy * 0.8).rgb;
      vec3 gr = (gx * an.x + gy * an.y + gz * an.z) / (an.x + an.y + an.z);
      float nb = texture2D(uNoiseTex, vWP.xz * 0.6).r;
      float nb2 = texture2D(uNoiseTex, vWP.xz * 1.7 + vWP.y * 0.8 + 0.3).r;
      float up = smoothstep(0.62, 0.95, vWN.y + (nb - 0.5) * 0.7) * smoothstep(0.42, 0.62, nb2);
      vec3 moss = texture2D(uMossTex, vWP.xz / 1.4).rgb * uMossTint * 0.85;
      gr *= (0.8 + nb2 * 0.4) * 0.72;
      float wet = smoothstep(0.05, -0.01, vWP.y);
      vec3 col = mix(gr, moss, up * smoothstep(0.02, 0.12, vWP.y));
      col *= mix(1.0, 0.62, wet);
      col = mix(col, vec3(0.93, 0.95, 0.98), uSnow * smoothstep(0.6, 0.9, vWN.y) * smoothstep(0.35, 0.6, nb + uSnow * 0.3));
      diffuseColor.rgb *= col;
      float kRough = mix(mix(0.9, 0.5, wet), 0.97, up);`,
    roughFragment: 'float roughnessFactor = kRough;',
    custom: {
      uniforms: gardenShared,
      patch: sh => {
        sh.vertexShader = sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          mat3 kIM = mat3(modelMatrix);
          #ifdef USE_INSTANCING
            kIM = kIM * mat3(instanceMatrix);
          #endif
          vWN = normalize(kIM * objectNormal); vOP = position;`);
      },
    },
  });
  return mat;
}

/** Rocks placed along the shoreline plus hand-placed feature stones. Returns two instanced meshes (under + above). */
export function buildRocks(mat) {
  const geos = [1, 2, 3, 4].map(s => rockGeometry(s));
  const placements = [[], [], [], []];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), po = new THREE.Vector3();
  let rs = 11;
  const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  const add = (x, z, size, squash = 0.55, sink = 0.35, kind = null) => {
    const k = kind ?? Math.floor(rnd() * 4);
    e.set((rnd() - 0.5) * 0.3, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.3);
    q.setFromEuler(e);
    sc.set(size * (0.85 + rnd() * 0.4), size * squash * (0.8 + rnd() * 0.4), size * (0.85 + rnd() * 0.4));
    po.set(x, terrainH(x, z) - size * squash * sink + 0.02, z);
    m.compose(po, q, sc);
    placements[k].push(m.clone());
  };
  // walk the shoreline
  const pts = [];
  for (let a = 0; a < Math.PI * 2; a += 0.0025) {
    // march outward from the pond centre until we cross the shore
    let lo = 0, hi = 14;
    const cx = 0.2, cz = 2.2, dx = Math.cos(a), dz = Math.sin(a);
    for (let it = 0; it < 24; it++) { const mid = (lo + hi) / 2; (pondSDF(cx + dx * mid, cz + dz * mid) < 0 ? (lo = mid) : (hi = mid)); }
    pts.push([cx + dx * lo, cz + dz * lo]);
  }
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const gap = 0.55 + noise(i * 0.013, 3.3) * 1.4;
    if (acc < gap) continue;
    acc = 0;
    const [x, z] = pts[i];
    const cluster = noise(x * 0.4, z * 0.4) > -0.05;
    if (!cluster || Math.hypot(x - LANTERN.x, z - LANTERN.z) < 1.5) continue;
    const s = 0.22 + rnd() * 0.36;
    // set rocks straddling the waterline, a little outboard
    const out = 0.05 + rnd() * 0.25;
    const nx = x - 0.2, nz = z - 2.2, nl = Math.hypot(nx, nz);
    add(x + nx / nl * out, z + nz / nl * out, s);
    if (rnd() < 0.55) add(x + nx / nl * (out + s * 1.2) + (rnd() - 0.5) * 0.3, z + nz / nl * (out + s * 1.2) + (rnd() - 0.5) * 0.3, s * (0.6 + rnd() * 0.6));
    if (rnd() < 0.5) add(x - nx / nl * 0.08 + (rnd() - 0.5) * 0.4, z - nz / nl * 0.08 + (rnd() - 0.5) * 0.4, 0.07 + rnd() * 0.08, 0.6, 0.3);
  }
  // the lantern's rock and a few stepping stones across the south-west lobe
  add(LANTERN.x + 0.85, LANTERN.z - 0.55, 0.62, 0.55, 0.45, 0);
  add(LANTERN.x - 0.95, LANTERN.z - 0.35, 0.4, 0.5, 0.45, 2);
  add(LANTERN.x + 0.55, LANTERN.z + 0.42, 0.2, 0.55, 0.35, 1);
  const steps = [[-3.1, 4.9], [-3.75, 5.55], [-4.35, 6.25], [-4.85, 7.05]];
  const avoid = [{ x: LANTERN.x, z: LANTERN.z, r: 0.5 }];
  for (const [x, z] of steps) {
    e.set(0, rnd() * 3, 0); q.setFromEuler(e); sc.set(0.34, 0.16, 0.28);
    po.set(x, 0.035, z); m.compose(po, q, sc); placements[3].push(m.clone());
    avoid.push({ x, z, r: 0.32 });
  }
  const make = () => geos.map((g, k) => {
    const im = new THREE.InstancedMesh(g, mat, placements[k].length);
    placements[k].forEach((mm, i) => im.setMatrixAt(i, mm));
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    return im;
  });
  return { under: make(), above: make(), avoid };
}

// ─── Enclosure: a clipped hedge around the garden and a sky above it ───────────
export function buildEnclosure(W) {
  const hedgeU = { uKeyDir: { value: new THREE.Vector3(0, 1, 0) }, uKeyCol: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.2, 0.25, 0.2) }, uTime: { value: 0 } };
  const hedge = new THREE.Mesh(
    new THREE.CylinderGeometry(11.5, 11.5, 6, 160, 1, true),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, uniforms: hedgeU,
      vertexShader: 'varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */`
        uniform vec3 uKeyDir, uKeyCol, uAmb; varying vec3 vW; varying vec2 vUv;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        float fb(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += a * vn(p); p *= 2.07; a *= .5; } return s; }
        void main(){
          float u = vUv.x * 180.;
          float y = vW.y;
          float top = 2.3 + fb(vec2(u * 0.08, 1.3)) * 1.6 + pow(fb(vec2(u * 0.025, 7.1)), 3.) * 5.5;
          if (y > top) discard;
          float leaf = fb(vec2(u * 0.9, y * 2.2));
          float clump = fb(vec2(u * 0.22, y * 0.6 + 3.));
          vec3 c = mix(vec3(0.018, 0.034, 0.016), vec3(0.07, 0.11, 0.04), leaf);
          c = mix(c, c * vec3(1.5, 1.2, 0.7), smoothstep(0.55, 0.8, clump) * 0.5);
          vec3 n = normalize(vec3(-vW.x, 0., -(vW.z - 2.)));
          float lit = max(dot(n, uKeyDir), 0.) * smoothstep(0.35, 0.8, leaf) * smoothstep(0.0, 1.5, y);
          vec3 col = c * (uAmb * 1.4 + uKeyCol * lit * 1.3);
          col *= mix(0.35, 1.0, smoothstep(0.0, 1.6, y)) * (0.75 + 0.25 * smoothstep(top - 0.6, top, y));
          gl_FragColor = vec4(col, 1.);
        }`,
    }),
  );
  hedge.position.set(0.3, 2.9, 2);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(45, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: { uZen: W.uZenith, uHor: W.uHorizon },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform vec3 uZen, uHor; varying vec3 vD; void main(){ gl_FragColor = vec4(mix(uHor, uZen, pow(clamp(vD.y, 0., 1.), 0.55)) * 0.9, 1.); }',
  }));
  sky.renderOrder = -2;
  return { hedge, sky, uniforms: hedgeU };
}
