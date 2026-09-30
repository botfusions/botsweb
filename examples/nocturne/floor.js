// Polished Nero Marquina floor: baked veined albedo + roughness, planar reflection, and the flacon's footprint:
// a contact shadow, a bright rim where the thick base focuses light, and an amber caustic pool that follows the liquid.
import { THREE } from '../../src/core/engine.js';
import { bakeTexture } from '../../src/core/textures.js';

export function createFloor(renderer, reflection) {
  const albedo = bakeTexture(renderer, 2048, `
    void main(){
      float w = fbm(vUv * 2.0, 2.0, 5, 0.55);
      float w2 = fbm(vUv * 4.0 + 3.1, 4.0, 5, 0.5);
      // Main calcite veins: a warped diagonal field, only where it crosses zero.
      float fld = fbm(vec2(vUv.x * 2.0 + vUv.y * 2.0, vUv.y * 1.0) + vec2(w, w2) * 0.9, 2.0, 7, 0.55);
      float vein = (1.0 - smoothstep(0.0, 0.0045, abs(fld))) * smoothstep(0.1, 0.5, fbm(vUv * 3.0 + 7.0, 3.0, 4, 0.5) + 0.35);
      float halo = (1.0 - smoothstep(0.0, 0.035, abs(fld))) * 0.12;
      float f2 = fbm(vec2(vUv.x * 5.0 - vUv.y * 5.0, vUv.y * 5.0) + w * 1.6, 5.0, 6, 0.5);
      float vein2 = (1.0 - smoothstep(0.0, 0.006, abs(f2))) * 0.22 * smoothstep(0.0, 0.4, w2 + 0.2);
      float cloud = fbm(vUv * 3.0, 3.0, 6, 0.6) * 0.5 + 0.5;
      vec3 base = vec3(0.013, 0.012, 0.011) * (0.6 + cloud * 0.8);
      vec3 col = base + vec3(0.34, 0.30, 0.25) * vein + vec3(0.10, 0.088, 0.072) * (halo + vein2);
      gl_FragColor = vec4(col, 1.0);
    }`);
  const rough = bakeTexture(renderer, 1024, `
    void main(){
      float c = fbm(vUv * 6.0, 6.0, 5, 0.5) * 0.5 + 0.5;
      float m = fbm(vUv * 40.0, 40.0, 3, 0.5) * 0.5 + 0.5;
      float r = 0.05 + c * 0.07 + m * 0.03;
      gl_FragColor = vec4(1.0, clamp(r, 0.03, 1.0), 0.0, 1.0);
    }`);
  const REP = 2;
  albedo.repeat.set(REP, REP); rough.repeat.set(REP * 2, REP * 2);
  const mat = new THREE.MeshStandardMaterial({ map: albedo, roughnessMap: rough, roughness: 1, metalness: 0, envMapIntensity: 0.0 });
  const U = {
    uBase: { value: new THREE.Vector3() }, uYaw: { value: new THREE.Vector2(1, 0) }, uContact: { value: 1 },
    uCauC: { value: new THREE.Vector3(0.5, 0, 0.6) }, uCauDir: { value: new THREE.Vector2(0.6, 0.8) }, uCauI: { value: 0 },
    uCauLen: { value: 0.9 }, uTime: { value: 0 }, uWob: { value: 0 }, uFade: { value: new THREE.Vector2(3.5, 13) },
    uPool: { value: new THREE.Vector3(0, 0, 0) }, uPoolI: { value: 1 },
  };
  reflection.patch(mat, { strength: 1.15, distort: 0.004, lodScale: 6, lodBias: 0.2, f0: 0.045 });
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uBase, uCauC, uPool; uniform vec2 uYaw, uCauDir, uFade; uniform float uContact, uCauI, uCauLen, uTime, uWob, uPoolI;
        // Tileable water caustic (after Dave Hoskins): thin bright filaments.
        float caus(vec2 uv, float t){
          vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
          vec2 i = p; float c = 1.0; float inten = 0.005;
          for (int n = 0; n < 5; n++) {
            float tt = t * (1.0 - (3.5 / float(n + 1)));
            i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
            c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
          }
          c /= 5.0; c = 1.17 - pow(clamp(c, 0.0, 8.0), 1.4);
          return pow(clamp(abs(c), 0.0, 1.0), 8.0);
        }`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n reflectedLight.directSpecular *= 0.0; reflectedLight.indirectSpecular *= 0.0;')
      .replace(/#include <opaque_fragment>(?![\s\S]*#include <opaque_fragment>)/, `
        {
          vec2 fp = vReflW.xz - uBase.xz;
          vec2 lp = vec2(uYaw.x * fp.x - uYaw.y * fp.y, uYaw.y * fp.x + uYaw.x * fp.y);
          vec2 q = abs(lp) - vec2(0.44, 0.26);
          float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.06;
          float lift = clamp(uBase.y * 6.0, 0.0, 1.0);
          float contact = (1.0 - smoothstep(-0.02, mix(0.09, 0.45, lift), sd)) * uContact * (1.0 - lift * 0.7);
          outgoingLight *= 1.0 - contact * 0.8;
          float rim = exp(-pow(sd / 0.006, 2.0)) * (1.0 - lift) * uContact;
          outgoingLight += vec3(1.0, 0.72, 0.38) * rim * 0.08 * uCauI;
          // Light through the perfume: the bottle's shadow swept along the key light, filled with amber caustics
          // and one focused streak where the liquid block acts as a lens.
          vec2 cp = vReflW.xz - uCauC.xz;
          vec2 cl = vec2(dot(cp, uCauDir), dot(cp, vec2(-uCauDir.y, uCauDir.x)));
          vec2 bq = abs(cl - vec2(uCauLen * 0.5, 0.0)) - vec2(uCauLen * 0.5, 0.34);
          float bsd = length(max(bq, 0.0)) + min(max(bq.x, bq.y), 0.0) - 0.1;
          float mask = smoothstep(0.1, -0.16, bsd) * smoothstep(-0.25, 0.08, cl.x);
          float along = clamp(cl.x / max(uCauLen, 0.01), 0.0, 1.0);
          vec2 cuv = vec2(cl.x * 0.55, cl.y * 0.9);
          float tt = uTime * (0.32 + uWob * 1.8);
          float c = caus(cuv, tt) + caus(cuv * 1.37 + 3.7, tt * 0.8 + 5.0) * 0.6;
          float focus = exp(-pow((along - 0.62) / 0.1, 2.0)) * exp(-pow(cl.y / 0.22, 2.0));
          vec3 amber = vec3(1.0, 0.42, 0.07);
          float fall = mix(1.0, 0.45, along);
          outgoingLight *= 1.0 - mask * 0.35;
          outgoingLight += amber * uCauI * mask * (0.025 + c * 1.1 * fall + focus * (0.35 + c * 1.2));
          // Soft pool of the key light around the bottle.
          float pool = exp(-dot(vReflW.xz - uPool.xz, vReflW.xz - uPool.xz) / 5.5);
          outgoingLight *= mix(0.55, 1.0, pool * uPoolI);
          outgoingLight *= smoothstep(uFade.y, uFade.x, length(vReflW.xz - uPool.xz));
        }
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'nocturne-floor';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.renderOrder = -20;
  reflection.hidden.push(mesh);
  return { mesh, mat, U };
}
