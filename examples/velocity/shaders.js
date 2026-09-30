// GLSL chunks shared by the lens modes, the dissolve and the studio.

export const NOISE = /* glsl */`
  float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec3 p){
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
  // F1/F2 cellular distance for foam cells.
  vec2 voro3(vec3 p){
    vec3 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
    for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 o = vec3(hash13(i + g), hash13(i + g + 17.1), hash13(i + g + 41.7));
      vec3 r = g + o - f; float d = dot(r, r);
      if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return vec2(sqrt(d1), sqrt(d2));
  }
`;

// Shoe profile lookup: a 64x1 texture of the measured sole (R bottom y, G centre z, B half width, A midsole top).
export const PROFILE = /* glsl */`
  uniform sampler2D uProfile; uniform vec2 uProfX; // x range (min, max) in shoe space
  vec4 prof(float x){
    float f = clamp((x - uProfX.x) / (uProfX.y - uProfX.x), 0.0, 1.0) * 64.0 - 0.5;
    float i = floor(f), t = f - i;
    vec4 a = texture2D(uProfile, vec2((clamp(i, 0.0, 63.0) + 0.5) / 64.0, 0.5));
    vec4 b = texture2D(uProfile, vec2((clamp(i + 1.0, 0.0, 63.0) + 0.5) / 64.0, 0.5));
    return mix(a, b, t * t * (3.0 - 2.0 * t));
  }
`;

// Gait: a footstrike rolling heel -> toe. Phase 0..1 (stance 0..0.68, swing after).
export const GAIT = /* glsl */`
  uniform float uGait;
  float gaitX(){ float s = clamp(uGait / 0.68, 0.0, 1.0); s = s * s * (3.0 - 2.0 * s); return mix(-0.86, 0.9, s); }
  float gaitAmp(){ return smoothstep(0.0, 0.05, uGait) * (1.0 - smoothstep(0.62, 0.78, uGait)); }
  // Pressure at shoe-space x (sole level). Heel strike is sharp, forefoot load is broad, toe-off is a narrow spike.
  float pressure(float x){
    float gx = gaitX(); float a = gaitAmp();
    float heel = exp(-pow((x + 0.72) / 0.2, 2.0)) * (1.0 - smoothstep(0.1, 0.4, uGait / 0.68));
    float roll = exp(-pow((x - gx) / 0.24, 2.0));
    float trail = smoothstep(gx + 0.1, gx - 0.25, x) * exp(-max(gx - x, 0.0) * 1.6) * 0.45;
    return a * clamp(heel * 1.1 + roll + trail, 0.0, 1.4);
  }
  // Heat left behind by recent strides (slow decay, always a bit warm under the heel and forefoot).
  float residual(float x){ return 0.32 * exp(-pow((x + 0.68) / 0.26, 2.0)) + 0.36 * exp(-pow((x - 0.5) / 0.3, 2.0)); }
`;

// FLIR-style ironbow palette, returned in linear space.
export const PALETTE = /* glsl */`
  vec3 ironbow(float t){
    t = clamp(t, 0.0, 1.0);
    vec3 c0 = vec3(0.02, 0.01, 0.06), c1 = vec3(0.16, 0.03, 0.42), c2 = vec3(0.58, 0.05, 0.52),
         c3 = vec3(0.93, 0.25, 0.14), c4 = vec3(1.0, 0.64, 0.06), c5 = vec3(1.0, 0.97, 0.78);
    vec3 c = t < 0.2 ? mix(c0, c1, t / 0.2) : t < 0.4 ? mix(c1, c2, (t - 0.2) / 0.2) : t < 0.6 ? mix(c2, c3, (t - 0.4) / 0.2)
           : t < 0.8 ? mix(c3, c4, (t - 0.6) / 0.2) : mix(c4, c5, (t - 0.8) / 0.2);
    return pow(c, vec3(2.2));
  }
`;

// Normal-map perturbation without tangents (cotangent frame).
export const PERTURB = /* glsl */`
  vec3 perturbN(vec3 n, vec3 pos, vec2 uv, vec3 mapN){
    vec3 dp1 = dFdx(pos), dp2 = dFdy(pos); vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
    vec3 dp2perp = cross(dp2, n), dp1perp = cross(n, dp1);
    vec3 T = dp2perp * duv1.x + dp1perp * duv2.x; vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
    float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
    return normalize(mat3(T * im, B * im, n) * mapN);
  }
`;

// Colourway dissolve field in shoe space: sweeps heel -> toe with a noisy front.
export const DISSOLVE = /* glsl */`
  float disField(vec3 sp){ return (sp.x + 1.0) * 0.36 + fbm3(sp * 5.5) * 0.36 + vnoise(sp * 23.0) * 0.07; }
`;
