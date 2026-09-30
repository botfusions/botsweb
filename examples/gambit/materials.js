// Marble, walnut and brass for the board, plus the Carrara -> Nero Marquina material transform for the black set.
import { THREE } from '../../src/core/engine.js';
import { bakeTexture, fbmNormal } from '../../src/core/textures.js';

export const BRASS = new THREE.Color('#b89b6a');

/** The playing field: 8x8 inlaid slabs of Botticino (light) and Emperador (dark), each with its own veining. */
export function boardTextures(renderer) {
  const common = `
    float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    // Domain-warped vein field: thin bright lines where the warped fbm crosses zero.
    float veins(vec2 p, float seed, float per){
      vec2 q = vec2(fbm(p + seed, per, 5, 0.55), fbm(p + seed * 1.7 + 4.2, per, 5, 0.55));
      float n = fbm(p * 0.9 + q * 1.8 + seed * 0.3, per, 6, 0.52);
      return n;
    }`;
  const albedo = bakeTexture(renderer, 2048, `${common}
    // thin line where a warped field crosses zero; w = width
    float vline(vec2 p, float seed, float w){
      vec2 q = vec2(fbm(p * 0.7 + seed, 64.0, 4, 0.5), fbm(p * 0.7 + seed + 5.3, 64.0, 4, 0.5));
      float n = fbm(p + q * 1.6, 64.0, 6, 0.55);
      return 1.0 - smoothstep(0.0, w, abs(n));
    }
    void main(){
      vec2 g = vUv * 8.0;
      vec2 id = floor(g); vec2 f = fract(g);
      float dark = mod(id.x + id.y + 1.0, 2.0);    // uv origin is a1, which is dark
      float s = h1(id), s2 = h1(id + 17.0);
      float a = s * 6.2831;                          // each slab cut at its own angle
      mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
      vec2 p = R * (f - 0.5) * vec2(2.4, 1.3) + id * 3.7;
      float cloud = fbm(p * 0.8 + 9.0, 64.0, 5, 0.55);
      float mott = fbm(p * 3.5 + 2.0, 64.0, 4, 0.6);
      vec3 col;
      if (dark > 0.5) {
        // Emperador Dark: chocolate ground, paler patches, and a network of fine calcite veins
        vec3 base = mix(vec3(0.030, 0.017, 0.010), vec3(0.070, 0.042, 0.026), smoothstep(-0.3, 0.45, cloud + mott * 0.35));
        base *= 0.85 + 0.3 * s2;
        float v1 = vline(p * 0.8, s * 13.0, 0.011) * smoothstep(-0.35, 0.2, cloud);
        float v2 = vline(p * 1.6 + 4.0, s * 29.0, 0.006) * smoothstep(0.0, 0.35, cloud);
        float v3 = vline(p * 3.1 + 8.0, s * 7.0, 0.004) * 0.5;
        col = base + v1 * vec3(0.25, 0.215, 0.17) * 0.62 + v2 * vec3(0.2, 0.17, 0.13) * 0.45 + v3 * vec3(0.13, 0.1, 0.07) * 0.4;
      } else {
        // Botticino: warm cream, soft honey clouding, tiny fossil specks and hairline stylolites
        vec3 base = mix(vec3(0.62, 0.54, 0.41), vec3(0.74, 0.67, 0.54), smoothstep(-0.45, 0.35, cloud));
        base *= 0.95 + 0.07 * s2 + mott * 0.05;
        float st = vline(p * 0.8 + 2.0, s * 11.0, 0.007);
        float st2 = vline(p * 1.9, s * 23.0, 0.004) * 0.6;
        float speck = smoothstep(0.62, 0.72, fbm(p * 14.0, 64.0, 3, 0.6)) * 0.5;
        col = base * (1.0 - st * 0.32 - st2 * 0.2 - speck * 0.12);
      }
      gl_FragColor = vec4(sqrt(max(col, 0.0)), 1.0); // gamma-2 encoded, squared back in the material
    }`);
  const rough = bakeTexture(renderer, 1024, `
    float h1(vec2 p){ return fract(sin(dot(p, vec2(41.3, 17.7))) * 43758.5453); }
    void main(){
      vec2 g = vUv * 8.0; vec2 id = floor(g);
      float s = h1(id);
      float wear = fbm(vUv * 6.0, 6.0, 5, 0.5);
      float micro = fbm(vUv * 80.0, 80.0, 3, 0.5);
      float r = 0.07 + s * 0.035 + max(wear, 0.0) * 0.12 + micro * 0.03;
      gl_FragColor = vec4(1.0, clamp(r, 0.03, 1.0), 0.0, 1.0);
    }`);
  return { albedo, rough };
}

/** Black walnut: long straight grain with ray flecks and darker pores. uv.x runs along the grain. */
export function walnutTextures(renderer) {
  const albedo = bakeTexture(renderer, 1024, `
    void main(){
      vec2 p = vUv;
      float warp = fbm(vec2(p.x * 3.0, p.y * 1.0), 3.0, 4, 0.5) * 0.6;
      float grain = sin((p.y * 46.0 + warp * 8.0 + fbm(p * vec2(2.0, 18.0), 18.0, 4, 0.5) * 2.5) * 3.14159);
      float fine = fbm(vec2(p.x * 6.0, p.y * 160.0), 160.0, 3, 0.6);
      float pores = smoothstep(0.35, 0.6, fbm(vec2(p.x * 90.0, p.y * 420.0), 420.0, 2, 0.5));
      vec3 lite = vec3(0.105, 0.058, 0.032), dark = vec3(0.038, 0.020, 0.011);
      vec3 col = mix(dark, lite, 0.5 + 0.5 * grain);
      col *= 0.82 + fine * 0.5;
      col *= 1.0 - pores * 0.35;
      gl_FragColor = vec4(sqrt(max(col, 0.0)), 1.0); // gamma-2 encoded, squared back in the material
    }`);
  const normal = fbmNormal(renderer, { size: 512, scale: 24, octaves: 4, strength: 0.35 });
  return { albedo, normal };
}

/** Table leather: very dark, fine pebble. */
export function leatherTextures(renderer) {
  const normal = fbmNormal(renderer, { size: 512, scale: 48, octaves: 4, strength: 1.4 });
  const rough = bakeTexture(renderer, 512, `void main(){ float r = 0.62 + fbm(vUv * 12.0, 12.0, 5, 0.55) * 0.25; gl_FragColor = vec4(1., clamp(r, .2, 1.), 0., 1.); }`);
  return { normal, rough };
}

/** Board coordinates engraved into the walnut frame (a–h, 1–8) as a brass alpha mask. */
export function coordinateTexture(frameW) {
  const N = 2048, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const total = 8 + frameW * 2, px = N / total;
  g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
  g.fillStyle = '#fff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `italic 500 ${Math.round(px * 0.3)}px "Bodoni Moda", "Didot", serif`;
  const off = frameW * px * 0.5;
  for (let i = 0; i < 8; i++) {
    const cx = (frameW + i + 0.5) * px;
    g.fillText('abcdefgh'[i], cx, N - off);      // near White (bottom of texture = +z)
    g.save(); g.translate(cx, off); g.rotate(Math.PI); g.fillText('abcdefgh'[i], 0, 0); g.restore();
    const cy = (frameW + i + 0.5) * px;
    g.fillText(String(8 - i), off, cy);
    g.save(); g.translate(N - off, cy); g.rotate(Math.PI); g.fillText(String(8 - i), 0, 0); g.restore();
  }
  // fine inner brass line around the playing field is modelled; add a hairline border near the outer edge
  g.strokeStyle = '#fff'; g.lineWidth = Math.max(2, px * 0.012);
  const e = px * frameW * 0.16;
  g.strokeRect(e, e, N - 2 * e, N - 2 * e);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 16;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/**
 * Convert a Meshy (MeshStandard) marble material into a polished physical one.
 * `black` remaps the Carrara base colour into Nero Marquina: near-black ground, veins turned to warm gold and bone.
 */
// Wrapped diffuse for the white stone: light bleeds past the terminator the way it does through marble.
const WRAP = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
  'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );',
  `float wrapNL = saturate( ( dot( geometryNormal, directLight.direction ) + 0.5 ) / 1.5 );
  vec3 wrapIrr = wrapNL * directLight.color * vec3( 1.0, 0.9, 0.78 );
  reflectedLight.directDiffuse += mix( irradiance, max( irradiance, wrapIrr ), 0.6 ) * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );`);

export function marbleMaterial(src, { black = false, envIntensity = 1, veins = [0.1, 0.42] } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    map: src.map, normalMap: src.normalMap, normalScale: src.normalScale?.clone() ?? new THREE.Vector2(1, 1),
    roughnessMap: src.roughnessMap, roughness: black ? 0.9 : 1.0, metalness: 0,
    clearcoat: black ? 1 : 0.45, clearcoatRoughness: black ? 0.1 : 0.16,
    envMapIntensity: envIntensity,
    sheen: 0,
  });
  m.userData.black = black;
  m.onBeforeCompile = sh => {
    sh.uniforms.uVeinLo = { value: veins[0] };
    sh.uniforms.uVeinHi = { value: veins[1] };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uVeinLo, uVeinHi;')
      .replace('#include <map_fragment>', black ? `
        #include <map_fragment>
        {
          // Veins are where the Carrara is darker than its neighbourhood (a low mip is the local average),
          // so baked relief shading on the king does not all turn to gold.
          const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
          float L = dot(textureLod(map, vMapUv, 1.6).rgb, LUM);   // slightly blurred: fine carving noise is not a vein
          float La = dot(textureLod(map, vMapUv, 5.5).rgb, LUM);
          float rel = clamp((La - L) / max(La, 1e-3), 0.0, 1.0);
          float v = smoothstep(uVeinLo, uVeinHi, rel);
          float strong = smoothstep(0.32, 0.75, rel);
          vec3 ground = vec3(0.0105, 0.0098, 0.0092) * (0.75 + 0.5 * L);
          vec3 gold = vec3(0.46, 0.30, 0.12);
          vec3 bone = vec3(0.66, 0.62, 0.55);
          diffuseColor.rgb = ground + mix(gold, bone, strong) * v * 0.62;
        }` : `
        #include <map_fragment>
        {
          // Carrara: an even bone ground with the veins pulled out crisply (relative to the local average).
          const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
          vec3 avg = textureLod(map, vMapUv, 5.5).rgb;
          float L = dot(diffuseColor.rgb, LUM), La = dot(avg, LUM);
          float rel = clamp((La - L) / max(La, 1e-3), 0.0, 1.0);
          vec3 ground = mix(vec3(0.78, 0.75, 0.69), vec3(0.84, 0.81, 0.75), smoothstep(0.4, 0.8, La));
          diffuseColor.rgb = ground * (1.0 - smoothstep(0.04, 0.5, rel) * 0.62) * mix(vec3(1.0), vec3(0.93, 0.93, 0.95), smoothstep(0.1, 0.4, rel));
        }
      `)
      .replace('#include <lights_physical_pars_fragment>', WRAP)
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * ${black ? '0.55' : '1.1'}, ${black ? '0.08' : '0.2'}, 0.6);
      `);
  };
  m.customProgramCacheKey = () => (black ? 'nero' : 'carrara');
  return m;
}
