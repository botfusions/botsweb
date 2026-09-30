// The flacon: a heavy cut-glass block, a gilt stopper, and ~50 ml of amber that behaves like liquid.
//
// Liquid model
//  - The cavity is sampled with a few thousand points in bottle space. Every frame they are pushed through the
//    bottle's world matrix and projected on the (wobbling) surface normal; the fill fraction is then a quantile of
//    that list, so the level is volume-preserving at any tilt, even upside down.
//  - The surface normal is a damped spring driven by the bottle's linear acceleration and angular velocity.
//  - Shader: fragments above the plane are discarded; back faces that survive are shaded as the free surface
//    (classic "liquid in a bottle" trick). The body refracts a half-res render of the scene behind it and absorbs
//    it with Beer–Lambert amber, so the letters and the floor are visible through the perfume.
import { THREE, clamp, lerp } from '../../src/core/engine.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const DIM = {
  W: 1.0, D: 0.64, H: 1.1, chamfer: 0.17, bevel: 0.055,
  neckR: 0.148, neckH: 0.15,
  cav: { W: 0.74, D: 0.40, y0: 0.25, y1: 0.97, r: 0.085 },
  pivot: 0.62,
};
DIM.neckTop = DIM.H + DIM.neckH;

function bodyGeometry() {
  const { W, D, H, chamfer: c, bevel: b } = DIM;
  const a = W / 2 - b, d = D / 2 - b;
  const s = new THREE.Shape();
  s.moveTo(a - c, d); s.lineTo(-a + c, d); s.lineTo(-a, d - c); s.lineTo(-a, -d + c);
  s.lineTo(-a + c, -d); s.lineTo(a - c, -d); s.lineTo(a, -d + c); s.lineTo(a, d - c); s.lineTo(a - c, d);
  const g = new THREE.ExtrudeGeometry(s, { depth: H - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, b, 0);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

function neckGeometry() {
  const { H, neckR: r, neckH: h } = DIM;
  const pts = [
    [r + 0.05, H - 0.0005], [r + 0.012, H + 0.012], [r, H + 0.03], [r - 0.004, H + h - 0.03],
    [r + 0.012, H + h - 0.022], [r + 0.012, H + h - 0.004], [r - 0.006, H + h], [0.001, H + h],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 64);
  g.deleteAttribute('uv');
  return g.toNonIndexed();
}

// Rounded-box SDF (matches RoundedBoxGeometry closely enough for sampling).
function sdRoundBox(x, y, z, bx, by, bz, r) {
  const qx = Math.abs(x) - bx + r, qy = Math.abs(y) - by + r, qz = Math.abs(z) - bz + r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

// Camera-relative softboxes, evaluated analytically on the view-space reflection vector: the long vertical
// highlights of a studio product shot, pinned to the lens like a photographer's rig (a PMREM can't hold them this thin).
export const STRIPS_GLSL = /* glsl */`
  uniform float uStripK;
  float stripBand(float x, float c, float w) { return 1.0 - smoothstep(w * 0.3, w, abs(x - c)); }
  vec3 studioStrips(vec3 n, vec3 v) {
    vec3 r = reflect(-v, n);
    float az = atan(r.x, r.z);
    float el = r.y;
    float vert = smoothstep(-0.8, -0.35, el) * (1.0 - smoothstep(0.5, 0.95, el)) * (0.8 + 0.2 * sin(el * 9.0));
    float s = stripBand(az, -0.04, 0.026) * 1.0 + stripBand(az, 0.075, 0.008) * 0.6
            + stripBand(az, -1.25, 0.10) * 0.6 + stripBand(az, 1.32, 0.07) * 0.45
            + stripBand(az, -2.7, 0.07) * 0.4 + stripBand(az, 2.75, 0.05) * 0.35;
    float top = smoothstep(0.82, 0.97, el) * 0.35;
    float F = 0.043 + 0.957 * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 5.0);
    return vec3(1.0, 0.95, 0.87) * (s * vert + top) * F * uStripK;
  }
`;

const LIQ_PARS = /* glsl */`
  uniform vec4 uPlane; uniform float uTime, uRipple, uGlowK, uAbsorb, uLevelVis;
  uniform vec3 uDeep, uGlow, uSigma;
  uniform sampler2D uBg; uniform mat4 uMainVP; uniform vec3 uKeyDir;
  varying vec3 vWPos;
  float ripH(vec3 p){
    return uRipple * (sin(dot(p.xz, vec2(21.0, 13.0)) + uTime * 3.3) * 0.5 + sin(dot(p.xz, vec2(-15.0, 24.0)) - uTime * 2.7) * 0.35
      + sin(dot(p.xz, vec2(37.0, -9.0)) + uTime * 5.1) * 0.15);
  }
`;

export function createBottle({ renderer, env }) {
  const root = new THREE.Group();      // on the floor; lifted while held
  const pivot = new THREE.Group();     // rotation centre ~ centre of mass
  const body = new THREE.Group();
  pivot.position.y = DIM.pivot;
  body.position.y = -DIM.pivot;
  root.add(pivot); pivot.add(body);

  // ── Glass ──────────────────────────────────────────────────────────────────
  const glassGeo = mergeGeometries([bodyGeometry(), neckGeometry()]);
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.0, transmission: 1, thickness: 0.62, ior: 1.52, dispersion: 2.2,
    attenuationColor: new THREE.Color(0.9, 0.93, 0.9), attenuationDistance: 1.4,
    specularIntensity: 1, envMapIntensity: 1.0, depthWrite: false,
  });
  const GU = { uBaseGlow: { value: new THREE.Color(0, 0, 0) }, uStripK: { value: 30 } };
  glass.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, GU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLocalG;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalG = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLocalG; uniform vec3 uBaseGlow;\n' + STRIPS_GLSL)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectSpecular += studioStrips(normal, normalize(vViewPosition));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // Light trapped in the thick base by the perfume above it (total internal reflection, faked).
          float ndvG = clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
          float inBase = smoothstep(${(DIM.cav.y0 + 0.02).toFixed(3)}, 0.02, vLocalG.y);
          totalEmissiveRadiance += uBaseGlow * inBase * (0.35 + 0.65 * pow(1.0 - ndvG, 1.5));
        }`);
  };
  glass.customProgramCacheKey = () => 'nocturne-glass';
  const glassMesh = new THREE.Mesh(glassGeo, glass);
  glassMesh.renderOrder = 3;
  body.add(glassMesh);

  // Far-side facets: only their reflections (they are what makes thick glass read as thick). Drawn additively into
  // the opaque list so the front glass refracts them.
  const backMat = new THREE.MeshPhysicalMaterial({
    color: 0x000000, metalness: 0, roughness: 0.02, ior: 1.52, specularIntensity: 1,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, envMapIntensity: 0.6,
  });
  const BU = { uStripK: { value: 9 } };
  backMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, BU);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + STRIPS_GLSL)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n reflectedLight.indirectSpecular += studioStrips(normal, normalize(vViewPosition));');
  };
  backMat.customProgramCacheKey = () => 'nocturne-back';
  const backMesh = new THREE.Mesh(glassGeo, backMat);
  backMesh.renderOrder = 2;
  body.add(backMesh);

  // ── Liquid ─────────────────────────────────────────────────────────────────
  const { cav } = DIM;
  const cavH = cav.y1 - cav.y0, cavY = (cav.y0 + cav.y1) / 2;
  const liqGeo = new RoundedBoxGeometry(cav.W, cavH, cav.D, 6, cav.r);
  liqGeo.translate(0, cavY, 0);
  const U = {
    uPlane: { value: new THREE.Vector4(0, 1, 0, 0.5) }, uTime: { value: 0 }, uRipple: { value: 0.002 },
    uDeep: { value: new THREE.Color(0.14, 0.03, 0.003) }, uGlow: { value: new THREE.Color(1.0, 0.40, 0.055) },
    uSigma: { value: new THREE.Vector3(0.9, 2.6, 7.5) }, uGlowK: { value: 1 }, uAbsorb: { value: 0 }, uLevelVis: { value: 1 },
    uBg: { value: null }, uMainVP: { value: new THREE.Matrix4() }, uKeyDir: { value: new THREE.Vector3(-0.4, 0.8, -0.4).normalize() },
  };
  const liquid = new THREE.MeshPhysicalMaterial({
    color: 0x000000, roughness: 0.04, metalness: 0, ior: 1.36, specularIntensity: 1, envMapIntensity: 1.5, side: THREE.DoubleSide,
  });
  liquid.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vLocal;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vLocal = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;\n' + LIQ_PARS)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float hPl = dot(uPlane.xyz, vWPos) - uPlane.w - ripH(vWPos);
        if (hPl > 0.0 || uLevelVis < 0.001) discard;
        float below = -hPl;
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 bodyN = normal;
        if (!gl_FrontFacing) {
          float e = 0.004;
          vec3 pn = normalize(uPlane.xyz - vec3(ripH(vWPos + vec3(e,0.,0.)) - ripH(vWPos - vec3(e,0.,0.)), 0.0, ripH(vWPos + vec3(0.,0.,e)) - ripH(vWPos - vec3(0.,0.,e))) / (2.0 * e) * 0.9);
          normal = normalize((viewMatrix * vec4(pn, 0.0)).xyz);
          nonPerturbedNormal = normal;
        }
      `)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        // The glass/perfume interface barely reflects; only the free surface is a mirror.
        if (gl_FrontFacing) { material.specularColor *= 0.12; material.specularColorBlended *= 0.12; material.specularF90 *= 0.12; }
      `)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 V = normalize(vViewPosition);
          float ndv = clamp(abs(dot(bodyN, V)), 0.0, 1.0);
          vec2 lq = vLocal.xz / vec2(${(cav.W / 2).toFixed(3)}, ${(cav.D / 2).toFixed(3)});
          float hB = (vLocal.y - ${cav.y0.toFixed(3)}) / ${cavH.toFixed(3)};
          // Screen-space refraction of what is behind, through a lens-shaped volume (inverts toward the rim).
          vec4 clip = uMainVP * vec4(vWPos, 1.0);
          vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
          vec2 off = -bodyN.xy * (gl_FrontFacing ? 0.09 : 0.03) * (0.5 + (1.0 - ndv)) - vec2(lq.x * 0.035, 0.0);
          vec3 bg = texture2D(uBg, clamp(suv + off, 0.001, 0.999)).rgb;
          float L = gl_FrontFacing ? mix(0.25, 0.62, ndv) : 0.5;
          vec3 T = exp(-uSigma * L);
          float edge = smoothstep(0.5, 1.0, abs(lq.x));
          float nearTop = smoothstep(0.30, 0.0, below);
          // Light entering through the free surface and the key beam crossing the volume.
          float shaft = exp(-pow((lq.x + 0.35 - hB * 0.7) / 0.42, 2.0));
          // Sun-ray streaks under the surface, bent by the ripples; they shimmer harder when the perfume moves.
          // (world-aligned: they hang from the level surface whatever the bottle does)
          float hx = dot(vWPos.xz, vec2(0.83, 0.55));
          float wv = sin(hx * 9.0 + uTime * 0.35 + vWPos.z * 3.0) * 1.6 + sin(hx * 4.0 - uTime * 0.21) * 2.0;
          float rays = pow(0.5 + 0.5 * sin(hx * 34.0 + wv + below * 4.0), 10.0) * 0.6 + pow(0.5 + 0.5 * sin(hx * 17.0 - wv * 0.7 - below * 2.5), 14.0) * 0.5;
          rays *= smoothstep(0.45, 0.0, below) * (0.35 + uRipple * 90.0);
          // Backlit volume: the middle looks straight through to the dark studio (deep, cognac), while the rounded
          // walls bend the side light into view (glowing rims), the base focuses it (a warm floor of light) and the
          // free surface lets it in from above (a bright band under the meniscus, with a thin lens-dark line).
          float rimX = smoothstep(0.52, 0.98, abs(lq.x));
          float baseBand = smoothstep(0.16, 0.0, hB);
          float amt = clamp(0.08 + 0.55 * rimX + 0.34 * nearTop + 0.34 * baseBand + 0.12 * shaft + 0.08 * rays, 0.0, 1.0);
          vec3 body = mix(uDeep, uGlow, amt) * (0.42 + 0.45 * rimX + 0.32 * nearTop + 0.3 * baseBand + 0.1 * shaft);
          float rim = pow(1.0 - ndv, 5.0);
          float men = smoothstep(0.012, 0.0, below);
          float underMen = smoothstep(0.012, 0.03, below) * smoothstep(0.08, 0.03, below);
          vec3 col = bg * T * 1.6 + body * 0.62 * uGlowK * (1.0 - underMen * 0.4) + uGlow * (rim * 0.5 + men * 1.7 + rays * 0.06);
          if (!gl_FrontFacing) {
            float sp = step(0.992, fract(sin(dot(floor(vWPos.xz * 150.0) + floor(uTime * 9.0), vec2(12.9898, 78.233))) * 43758.5453));
            col = bg * T * 0.9 + mix(uDeep, uGlow, 0.42) * 0.55 * uGlowK + vec3(1.0, 0.8, 0.45) * sp * uAbsorb * 3.0;
          }
          col += uGlow * uAbsorb * 0.22;
          totalEmissiveRadiance += col;
        }
      `);
  };
  liquid.customProgramCacheKey = () => 'nocturne-liquid';
  const liqMesh = new THREE.Mesh(liqGeo, liquid);
  liqMesh.renderOrder = 1;
  body.add(liqMesh);

  // Inner cavity wall: the faint second outline that says "this glass is hollow".
  const cavMat = new THREE.ShaderMaterial({
    uniforms: { uPlane: U.uPlane, uI: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec4 uPlane; uniform float uI; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ float above = smoothstep(-0.005, 0.02, dot(uPlane.xyz, vW) - uPlane.w);
        float f = pow(1.0 - abs(dot(normalize(vN), vV)), 3.0);
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * f * 0.07 * above * uI, 1.0); }`,
  });
  const cavGeo = new RoundedBoxGeometry(cav.W + 0.012, cavH + 0.012, cav.D + 0.012, 6, cav.r + 0.006);
  cavGeo.translate(0, cavY, 0);
  const cavMesh = new THREE.Mesh(cavGeo, cavMat);
  cavMesh.renderOrder = 6;
  body.add(cavMesh);

  // ── Hot-stamped gilding on the front face ─────────────────────────────────
  const label = (() => {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 320;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '400 150px Italiana, "Bodoni Moda", serif';
    if ('letterSpacing' in g) g.letterSpacing = '46px';
    g.fillText('NOCTURNE', 1046, 128);
    if ('letterSpacing' in g) g.letterSpacing = '14px';
    g.font = 'italic 400 64px "Bodoni Moda", serif';
    g.fillText('No 9  ·  Extrait de parfum', 1030, 262);
    const t = new THREE.CanvasTexture(c); t.anisotropy = 16;
    const m = new THREE.MeshStandardMaterial({ color: 0xe6c47c, metalness: 1, roughness: 0.24, alphaMap: t, alphaTest: 0.45, envMapIntensity: 2.4 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62 * 320 / 2048), m);
    mesh.position.set(0, 0.128, DIM.D / 2 + 0.0015);
    return mesh;
  })();
  body.add(label);

  // ── Cavity samples for the volume-preserving level ─────────────────────────
  const N = 2600;
  const pts = new Float32Array(N * 3), vals = new Float32Array(N);
  {
    let i = 0;
    const bx = cav.W / 2, by = cavH / 2, bz = cav.D / 2;
    while (i < N) {
      const x = (Math.random() * 2 - 1) * bx, y = (Math.random() * 2 - 1) * by, z = (Math.random() * 2 - 1) * bz;
      if (sdRoundBox(x, y, z, bx, by, bz, cav.r) > 0) continue;
      pts[i * 3] = x; pts[i * 3 + 1] = y + cavY; pts[i * 3 + 2] = z; i++;
    }
  }
  // Cavity-centre of mass for projecting caustics and aiming particles.
  const tmp = new THREE.Vector3();

  const state = {
    fill: 0, plane: U.uPlane.value, normal: new THREE.Vector3(0, 1, 0),
    wob: new THREE.Vector2(), wobV: new THREE.Vector2(),
    prevC: new THREE.Vector3(), prevV: new THREE.Vector3(), acc: new THREE.Vector3(), prevQ: new THREE.Quaternion(), omega: new THREE.Vector3(),
    surf: new THREE.Vector3(), centroid: new THREE.Vector3(), energy: 0, first: true,
  };
  const qd = new THREE.Quaternion(), vtmp = new THREE.Vector3(), c = new THREE.Vector3();

  function solve(dt) {
    body.updateWorldMatrix(true, false);
    const M = body.matrixWorld;
    // Kinematics of the liquid's centre and the bottle's spin.
    c.set(0, cavY, 0).applyMatrix4(M);
    const q = pivot.getWorldQuaternion(qd.clone());
    if (state.first || dt <= 0) { state.prevC.copy(c); state.prevQ.copy(q); state.first = false; }
    const v = vtmp.copy(c).sub(state.prevC).divideScalar(Math.max(dt, 1e-4));
    state.acc.lerp(v.clone().sub(state.prevV).divideScalar(Math.max(dt, 1e-4)), 1 - Math.exp(-18 * dt));
    state.prevV.copy(v);
    state.prevC.copy(c);
    qd.copy(q).multiply(state.prevQ.clone().invert());
    if (qd.w < 0) { qd.x = -qd.x; qd.y = -qd.y; qd.z = -qd.z; qd.w = -qd.w; }
    const ang = 2 * Math.acos(clamp(qd.w, -1, 1));
    const s = Math.sqrt(Math.max(1 - qd.w * qd.w, 1e-9));
    const om = ang > 1e-5 ? tmp.set(qd.x / s, qd.y / s, qd.z / s).multiplyScalar(ang / Math.max(dt, 1e-4)) : tmp.set(0, 0, 0);
    state.omega.lerp(om, 1 - Math.exp(-20 * dt));
    state.prevQ.copy(q);

    // Slosh: a damped 2D spring on the surface tilt.
    const K = 92, C = 2.3;
    const fx = -state.acc.x * 0.055 - state.omega.z * 0.9;
    const fz = -state.acc.z * 0.055 + state.omega.x * 0.9;
    state.wobV.x += (-K * state.wob.x - C * state.wobV.x + fx * 20) * dt;
    state.wobV.y += (-K * state.wob.y - C * state.wobV.y + fz * 20) * dt;
    state.wob.x += state.wobV.x * dt; state.wob.y += state.wobV.y * dt;
    const L = state.wob.length();
    if (L > 0.5) state.wob.multiplyScalar(0.5 / L);
    state.energy = Math.min(1, state.wob.length() * 2.2 + state.wobV.length() * 0.18);
    state.normal.set(state.wob.x, 1, state.wob.y).normalize();

    // Level as a quantile of the cavity samples along the surface normal.
    const e = M.elements, n = state.normal;
    for (let i = 0; i < N; i++) {
      const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
      vals[i] = n.x * (e[0] * x + e[4] * y + e[8] * z + e[12]) + n.y * (e[1] * x + e[5] * y + e[9] * z + e[13]) + n.z * (e[2] * x + e[6] * y + e[10] * z + e[14]);
    }
    vals.sort();
    const f = clamp(state.fill);
    let d;
    if (f <= 0.0005) d = vals[0] - 0.02;
    else if (f >= 0.9995) d = vals[N - 1] + 0.02;
    else { const k = f * (N - 1), i0 = Math.floor(k); d = lerp(vals[i0], vals[Math.min(i0 + 1, N - 1)], k - i0); }
    state.plane.set(n.x, n.y, n.z, d);
    U.uRipple.value = 0.0012 + state.energy * 0.006;
    U.uLevelVis.value = f > 0.0005 ? 1 : 0;

    // Centre of the free surface: bottle axis ∩ plane.
    const ax = tmp.set(0, 1, 0).transformDirection(M);
    const denom = n.dot(ax);
    const tHit = Math.abs(denom) > 0.2 ? (d - n.dot(c)) / denom : 0;
    state.surf.copy(c).addScaledVector(ax, clamp(tHit, -cavH / 2, cavH / 2));
    // Rough centroid of the liquid (between the cavity centre and the surface, biased downhill).
    state.centroid.copy(c).lerp(state.surf, 0.35);
    state.centroid.y = Math.min(state.centroid.y, d - 0.05);
  }

  return {
    root, pivot, body, glass, GU, backMat, liquid, U, glassMesh, backMesh, liqMesh, cavMesh, label, state, solve,
    setCap(cap) { body.add(cap); },
    cavY, cavH,
  };
}
