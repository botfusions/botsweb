// Lithos materials: velvet, amethyst glints + crack glow, rock crystal, mirror pyrite, thin-film ammonite.
// All patches are onBeforeCompile injections on three's physical/standard shaders, so the Meshy PBR maps stay in charge.
import { THREE } from '../../src/core/engine.js';

const HASH = /* glsl */`
  float lh13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  vec3 lh33(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
  float vn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
    return mix(mix(mix(lh13(i), lh13(i + vec3(1,0,0)), f.x), mix(lh13(i + vec3(0,1,0)), lh13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(lh13(i + vec3(0,0,1)), lh13(i + vec3(1,0,1)), f.x), mix(lh13(i + vec3(0,1,1)), lh13(i + vec3(1,1,1)), f.x), f.y), f.z); }
`;

const chunk = n => THREE.ShaderChunk[n];

/**
 * Amethyst geode half. `u` holds shared uniforms (both halves use one material):
 * uToHalf (mesh-local -> half space: cut plane at y=0, +y out of the cavity), uCrack, uGlint, uInner, uTime,
 * uL1Pos/uL1Col, uL2Pos/uL2Col (view-space glint lights), uCrackColor, uGlintScale.
 */
export function patchGeode(mat, u) {
  mat.metalness = 0;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uToHalf;\nvarying vec3 vHalf;\nvarying vec3 vHalfN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHalf = (uToHalf * vec4(transformed, 1.0)).xyz;\nvHalfN = normalize(mat3(uToHalf) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uCrack, uGlint, uInner, uTime, uGlintScale, uSeal, uSide, uSeamY;
        uniform vec3 uL1Pos, uL1Col, uL2Pos, uL2Col, uCrackColor;
        varying vec3 vHalf; varying vec3 vHalfN;
        ${HASH}
        float crackNet(vec3 p){
          vec3 i = floor(p), f = fract(p); float d1 = 8., d2 = 8.;
          for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec3 g = vec3(float(x), float(y), float(z)); vec3 r = g + lh33(i + g) - f; float d = dot(r, r);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
          return sqrt(d2) - sqrt(d1);
        }
        // Botryoidal crust: rounded, grape-like lumps (inverted Worley F1), finer lumps, grain and pits.
        float botry(vec3 p){
          vec3 i = floor(p), f = fract(p); float d1 = 8.;
          for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec3 g = vec3(float(x), float(y), float(z)); vec3 r = g + lh33(i + g) * 0.85 - f; d1 = min(d1, dot(r, r));
          }
          return 1.0 - d1;
        }
        float crustH(vec3 p){
          float b = botry(p * 15.0);
          float b2 = botry(p * 38.0 + 5.3);
          float n = vn3(p * 95.0) * 0.5 + vn3(p * 210.0) * 0.25;
          float pit = smoothstep(0.64, 0.86, vn3(p * 58.0 + 9.1)) + smoothstep(0.7, 0.9, vn3(p * 130.0 + 2.7)) * 0.6;
          return b * 0.85 + b2 * 0.3 + n * 0.3 - pit * 0.5;
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 gN = normalize(vHalfN);
        // Cavity: surface whose normal faces the sphere centre (the exterior faces away from it), below the cut plane.
        float gCav = smoothstep(0.0, 0.3, -dot(gN, normalize(vHalf + vec3(0.0, 0.06, 0.0)))) * (1.0 - smoothstep(-0.016, -0.002, vHalf.y));
        vec3 gBase = diffuseColor.rgb;
        float gPurple = smoothstep(0.004, 0.045, gBase.b - gBase.g);
        float gLum = dot(gBase, vec3(0.2126, 0.7152, 0.0722));
        float gRim = smoothstep(0.86, 0.96, gN.y) * (1.0 - smoothstep(0.006, 0.02, abs(vHalf.y)));
        // Deeper, more saturated amethyst; the agate band stays milky.
        diffuseColor.rgb = mix(diffuseColor.rgb, pow(max(gBase, 0.0), vec3(1.22)) * vec3(1.12, 0.86, 1.3), gCav * gPurple);
        // Weathered crust: dark brown-grey basalt skin, rusty iron staining, crevices darker than the lumps.
        // Exterior = outward-facing and out at the shell radius; crystals inside never qualify.
        float gExt = (1.0 - gCav) * (1.0 - gRim) * (1.0 - gPurple) * smoothstep(0.05, 0.35, dot(gN, normalize(vHalf))) * smoothstep(0.39, 0.44, length(vHalf));
        float gAy = abs(vHalf.y);
        vec3 cp = vHalf + uSide * vec3(3.17, 0.0, 1.71);
        float cH = crustH(cp);
        float cStain = smoothstep(0.5, 0.8, vn3(cp * 5.5) * 0.65 + vn3(cp * 16.0) * 0.35);
        float cGrime = vn3(cp * 8.0) * 0.7 + vn3(cp * 31.0) * 0.3;
        vec3 crust = mix(vec3(0.055, 0.048, 0.042), vec3(0.17, 0.15, 0.13), cGrime);
        crust = mix(crust, gBase * 0.42, 0.3);
        crust = mix(crust, vec3(0.2, 0.085, 0.03), cStain * 0.62);
        crust *= 0.45 + 0.75 * clamp(cH, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, crust, gExt);
        // Sealed: the white agate rind shows as a thin chipped line either side of the dark join.
        float cRind = (1.0 - smoothstep(0.022, 0.03, gAy + (vn3(cp * 90.0) - 0.5) * 0.016 + (vn3(cp * 23.0) - 0.5) * 0.008)) * gExt;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.44, 0.42, 0.47), cRind * uSeal * 0.85);
        float gCrust = gExt * (1.0 - cRind * uSeal * 0.7);
        `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, mix(0.24, 0.08, gPurple), gCav);
        roughnessFactor = mix(roughnessFactor, 0.2, gRim);
        roughnessFactor = mix(roughnessFactor, 0.62 + 0.3 * (1.0 - clamp(cH, 0.0, 1.0)) + cStain * 0.1, gCrust);
        roughnessFactor = mix(roughnessFactor, 0.32, cRind * uSeal);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Triplanar-free bump: the crust height is a 3D field, differentiated in screen space (Mikkelsen).
          vec2 dH = vec2(dFdx(cH), dFdy(cH)) * 0.015 * gCrust;
          vec3 sp = -vViewPosition;
          vec3 sx = dFdx(sp), sy = dFdy(sp);
          vec3 R1 = cross(sy, normal), R2 = cross(normal, sx);
          float det = dot(sx, R1) * faceDirection;
          vec3 grad = sign(det) * (dH.x * R1 + dH.y * R2);
          normal = normalize(abs(det) * normal - grad);
        }`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = 0.0;')
      .replace('#include <opaque_fragment>', `
        {
          vec3 V = normalize(vViewPosition);
          vec3 fp = -vViewPosition;
          if (uGlint > 0.001 && gCav > 0.01) {
            vec3 gp = vHalf * uGlintScale;
            vec3 id = floor(gp); vec3 fc = fract(gp) - 0.5;
            vec3 rnd = lh33(id);
            float star = (1.0 - smoothstep(0.0, 0.45, length(fc))) * step(0.35, rnd.z);
            vec3 nf = normalize(normal + (rnd - 0.5) * 1.35);
            vec3 L1 = normalize(uL1Pos - fp), L2 = normalize(uL2Pos - fp);
            float s1 = pow(max(dot(nf, normalize(L1 + V)), 0.0), 260.0);
            float s2 = pow(max(dot(nf, normalize(L2 + V)), 0.0), 260.0);
            float tw = 0.5 + 0.5 * sin(uTime * (1.3 + rnd.x * 3.5) + rnd.y * 40.0);
            vec3 gcol = mix(vec3(1.0, 0.97, 1.0), vec3(0.78, 0.62, 1.0), rnd.x);
            outgoingLight += gcol * (s1 * uL1Col + s2 * uL2Col) * star * (0.3 + 0.7 * tw) * gCav * (0.5 + gPurple + gLum * 2.0) * uGlint * 12.0;
          }
          if (uCrack > 0.001) {
            float ay = abs(vHalf.y);
            vec3 cq = vHalf + uSide * vec3(3.17, 0.0, 1.71);
            float e = crackNet(cq * vec3(6.5, 8.5, 6.5) + vn3(cq * 19.0) * 0.55);
            float w = mix(0.01, 0.034, clamp(uCrack, 0.0, 1.0));
            // Only some cell walls fracture: the crack is a few branching lines, not a turtle shell.
            float keep = smoothstep(0.42, 0.62, vn3(cq * 5.0 + 11.0) + (1.0 - smoothstep(0.0, 0.12, abs(vHalf.y))) * 0.35);
            float line = (1.0 - smoothstep(0.0, w, e)) * keep;
            float cr = clamp(uCrack, 0.0, 1.0);
            float reach = 1.0 - smoothstep(cr * 0.24, cr * 0.24 + 0.07, ay);
            float seam = exp(-abs(ay - uSeamY) * 190.0) * smoothstep(0.0, 0.18, uCrack);
            float fl = 0.78 + 0.22 * sin(uTime * 31.0 + vHalf.x * 60.0) * sin(uTime * 7.3 + vHalf.z * 20.0);
            outgoingLight += uCrackColor * max(seam * 7.0 + line * reach * max(1.0 - ay * 3.2, 0.0) * 4.0, 0.0) * (1.0 - gCav) * uCrack * fl;
          }
          outgoingLight += diffuseColor.rgb * uCrackColor * gCav * uInner * (0.4 + gPurple);
        }
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'lithos-geode';
  mat.needsUpdate = true;
  return mat;
}

/** Rock crystal: transmission + dispersion + a whisper of thin-film, masked to the crystal (the matrix rock stays opaque). */
export function crystalMaterial(src, { envIntensity = 1.6, envMap = null } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    map: src.map, normalMap: src.normalMap, roughnessMap: src.roughnessMap, normalScale: new THREE.Vector2(0.7, 0.7),
    metalness: 0, roughness: 1, transmission: 1, thickness: 0.55, ior: 1.544, dispersion: 2.2,
    iridescence: 0.2, iridescenceIOR: 1.3, iridescenceThicknessRange: [300, 700],
    specularIntensity: 1, envMapIntensity: envIntensity, envMap,
  });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = transformed;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;\n' + HASH)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float qLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        float qCry = smoothstep(0.16, 0.36, qLum);
        // Rock crystal is milky where it grew from the matrix and water-clear towards the terminations.
        float qMilk = (1.0 - smoothstep(-0.9, -0.2, vObj.y + (vn3(vObj * 6.0) - 0.5) * 0.5)) * qCry;
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.96, 0.955, 0.97), diffuseColor.rgb * 1.5, 0.12), qCry);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.02 + roughnessFactor * 0.05, qCry);
        roughnessFactor = mix(roughnessFactor, 0.3, qMilk * 0.6);`)
      .replace('#include <lights_physical_fragment>', chunk('lights_physical_fragment') + `
        #ifdef USE_IRIDESCENCE
          material.iridescence *= qCry;
        #endif`)
      .replace('#include <transmission_fragment>', chunk('transmission_fragment').replace('material.transmission = transmission;', 'material.transmission = transmission * qCry * (1.0 - qMilk * 0.7);'))
      .replace('#include <opaque_fragment>', `
        #ifdef USE_ENVMAP
        {
          // Fake total internal reflection with a per-channel IOR: light bouncing inside the crystal, split into fire.
          vec3 V = normalize(vViewPosition);
          vec3 N = normal;
          vec3 dR = refract(-V, N, 1.0 / 1.52);
          vec3 dG = refract(-V, N, 1.0 / 1.545);
          vec3 dB = refract(-V, N, 1.0 / 1.575);
          vec3 inner = vec3(getIBLRadiance(dR, dR, 0.03).r, getIBLRadiance(dG, dG, 0.03).g, getIBLRadiance(dB, dB, 0.03).b);
          float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
          outgoingLight += inner * qCry * (1.0 - qMilk * 0.55) * (0.3 + fres * 0.8) * uTir;
        }
        #endif
        #include <opaque_fragment>`);
    sh.uniforms.uTir = m.userData.uTir;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTir;');
  };
  m.userData.uTir = { value: 0.6 };
  m.customProgramCacheKey = () => 'lithos-quartz';
  return m;
}

/** Pyrite: the brassy cubes become mirror metal with the striations from the normal map; the matrix stays dull. */
export function patchPyrite(mat, envMap = null) {
  mat.envMapIntensity = 0.85;
  if (envMap) mat.envMap = envMap;
  mat.normalScale = new THREE.Vector2(1.1, 1.1);
  mat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 pBase = diffuseColor.rgb;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        float pMet = smoothstep(0.35, 0.75, metalnessFactor);
        metalnessFactor = pMet;
        roughnessFactor = mix(max(roughnessFactor, 0.55), 0.09 + roughnessFactor * 0.25, pMet);
        diffuseColor.rgb = mix(pBase * 0.8, pow(max(pBase, 0.0), vec3(0.95)) * vec3(1.08, 1.02, 0.82), pMet);`);
  };
  mat.customProgramCacheKey = () => 'lithos-pyrite';
  mat.needsUpdate = true;
  return mat;
}

/** Ammonite: physical nacre — clearcoat + thin-film interference whose thickness drifts over the shell. */
export function nacreMaterial(src, envMap = null) {
  const m = new THREE.MeshPhysicalMaterial({
    map: src.map, normalMap: src.normalMap, roughnessMap: src.roughnessMap, envMap,
    metalness: 0, roughness: 1, envMapIntensity: 0.75,
    iridescence: 0.7, iridescenceIOR: 1.62, iridescenceThicknessRange: [180, 640],
    clearcoat: 0.5, clearcoatRoughness: 0.14, specularIntensity: 1, sheen: 0,
  });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = transformed;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vObj;\n${HASH}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float aShell = smoothstep(-0.58, -0.4, vObj.y / 0.95) * (1.0 - smoothstep(0.62, 0.78, roughnessFactor));
        roughnessFactor = mix(roughnessFactor, 0.16 + roughnessFactor * 0.2, aShell);
        // Warmer, deeper nacre: the Meshy albedo is washed out under a hard key.
        diffuseColor.rgb = mix(diffuseColor.rgb, pow(max(diffuseColor.rgb, 0.0), vec3(1.35)) * vec3(1.02, 0.9, 0.8), aShell);`)
      .replace('#include <lights_physical_fragment>', chunk('lights_physical_fragment') + `
        #ifdef USE_IRIDESCENCE
          material.iridescence *= aShell;
          float aN = vn3(vObj * 3.2) * 0.65 + vn3(vObj * 9.0 + 3.1) * 0.35;
          material.iridescenceThickness = mix(iridescenceThicknessMinimum, iridescenceThicknessMaximum, aN);
        #endif
        #ifdef USE_CLEARCOAT
          material.clearcoat *= aShell;
        #endif`);
  };
  m.customProgramCacheKey = () => 'lithos-nacre';
  return m;
}

/** Black crushed velvet: sheen lobe, fibre-scale normal noise and patchy "crush" in the sheen colour. */
export function velvetMaterial(renderer, bake) {
  const crush = bake(renderer, 1024, `
    void main(){
      float a = fbm(vUv * 5.0, 5.0, 6, 0.55);
      float b = fbm(vUv * 13.0 + a * 1.4, 13.0, 4, 0.5);
      float v = smoothstep(-0.35, 0.45, a * 0.8 + b * 0.5);
      gl_FragColor = vec4(vec3(0.42 + v * 0.58), 1.0);
    }`);
  const nrm = bake(renderer, 1024, `
    float H(vec2 p){ return fbm(p * 90.0, 90.0, 3, 0.5) * 0.35 + fbm(p * 7.0, 7.0, 5, 0.55) * 1.0; }
    void main(){
      float e = 1.0 / 1024.0;
      float hx = H(vUv + vec2(e, 0.)) - H(vUv - vec2(e, 0.));
      float hy = H(vUv + vec2(0., e)) - H(vUv - vec2(0., e));
      vec3 n = normalize(vec3(-hx * 14.0, -hy * 14.0, 1.0));
      gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
    }`);
  for (const t of [crush, nrm]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1); }
  crush.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x0a0810, roughness: 0.9, metalness: 0,
    sheen: 1, sheenRoughness: 0.32, sheenColor: new THREE.Color(0x6a6480), sheenColorMap: crush,
    normalMap: nrm, normalScale: new THREE.Vector2(0.26, 0.26), envMapIntensity: 0.22, specularIntensity: 0.25,
  });
  return m;
}
