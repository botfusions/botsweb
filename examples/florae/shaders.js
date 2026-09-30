// GLSL for the petal simulation and its rendering.
// HOME = where a particle wants to be: its place on specimen A → B, carried through a vortex while in transit,
// wings flapping if the specimen is the morpho. The simulation springs particles toward HOME and lets
// wind (curl flow), the cursor's breeze and gusts push them around it.

export const COMMON = /* glsl */`
  uniform sampler2D tA, tB, tNA, tNB;
  uniform float uF, uFlapA, uFlapB, uBloom, uTime, uStagger;

  vec3 hash32(vec2 p){
    vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yzz) * p3.zyx);
  }
  float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

  // per-particle progress through the current morph: staggered by seed so the flower leaves in waves
  float stageQ(float s){ return clamp((uF - s * uStagger) / (1.0 - uStagger), 0.0, 1.0); }

  // morpho wings hinge about the body axis (y): 0 at the body, 1 at the tips (wingspan ±1.3)
  float hingeOf(float x){ float ax = abs(x) / 1.3; return smoothstep(0.02, 0.14, ax) * (0.7 + 0.3 * ax); }
  vec3 flapP(vec3 p, float ang){
    if (ang <= 0.0) return p;
    float a = ang * hingeOf(p.x);
    float sd = p.x < 0.0 ? -1.0 : 1.0;
    float ax = abs(p.x), c = cos(a), s = sin(a);
    return vec3(sd * (ax * c - p.z * s), p.y - (ang - 0.45) * 0.07, ax * s + p.z * c);
  }
  vec3 flapN(vec3 n, float px, float ang){
    if (ang <= 0.0) return n;
    float a = ang * hingeOf(px); float sd = px < 0.0 ? -1.0 : 1.0; float nx = sd * n.x; float c = cos(a), s = sin(a);
    return vec3(sd * (nx * c - n.z * s), n.y, nx * s + n.z * c);
  }

  // the wind between specimens: particles lift out of the old form into a whirl of petals — a thin,
  // three-armed spiral turning about the specimen, tilted toward the viewer (uDisc) so its arms read in
  // any still frame — then fall out of it into the new form. Rotation lives on the whirl target, weighted
  // by w, so scrubbing the scroll back and forth never makes particles jump.
  uniform mat3 uDisc;
  vec3 vortex(vec3 m, float w, vec3 s){
    if (w < 1e-4) return m;
    float arm = floor(fract(s.y * 91.7 + s.z * 47.3) * 3.0);
    float u = s.y;
    float rad = 0.26 + 0.8 * u + (s.z - 0.5) * 0.1;
    float ang = arm * 2.0944 + log(rad) * 3.0 + (s.z - 0.5) * (0.16 + 0.3 * u) + uTime * (0.75 - 0.35 * u) + w * 1.3;
    float y = (fract(s.z * 13.7) - 0.5) * (0.05 + 0.12 * u) + 0.05 * sin(ang * 3.0 + uTime);
    vec3 g = uDisc * vec3(cos(ang) * rad, y, sin(ang) * rad) + vec3(0.0, 0.12, 0.0);
    return mix(m, g, smoothstep(0.0, 1.0, w));
  }
  vec3 sway(vec3 p){
    float h = p.y + 1.25;
    return vec3(sin(uTime * 0.77 + p.y * 1.3) * 0.009, sin(uTime * 1.3 + p.x * 3.0) * 0.003, cos(uTime * 0.61 + p.y * 1.1) * 0.007) * h;
  }
`;

const CURL = /* glsl */`
  // analytic curl of a trigonometric vector potential, three rotated octaves
  vec3 curlTrig(vec3 p, vec3 ph){
    float s1 = sin(1.1 * p.y + ph.x), c1 = cos(1.1 * p.y + ph.x);
    float s2 = sin(0.9 * p.z + ph.y), c2 = cos(0.9 * p.z + ph.y);
    float s3 = sin(1.4 * p.x + ph.z), c3 = cos(1.4 * p.x + ph.z);
    float cbz = cos(1.3 * p.z), sbz = sin(1.3 * p.z);
    float cdx = cos(1.2 * p.x), sdx = sin(1.2 * p.x);
    float cfy = cos(0.8 * p.y), sfy = sin(0.8 * p.y);
    return vec3(-0.8 * s3 * sfy - 0.9 * c2 * cdx, -1.3 * s1 * sbz - 1.4 * c3 * cfy, -1.2 * s2 * sdx - 1.1 * c1 * cbz);
  }
  const mat3 ROT = mat3(0.8, 0.6, 0.0, -0.48, 0.64, 0.6, 0.36, -0.48, 0.8);
  vec3 curl(vec3 p, float t){
    vec3 v = curlTrig(p, vec3(t * 0.31, t * 0.23, t * 0.27));
    p = ROT * p * 2.03 + 1.7;
    v += 0.55 * curlTrig(p, vec3(t * 0.41, t * 0.37, t * 0.29));
    p = ROT * p * 2.01 + 3.1;
    v += 0.3 * curlTrig(p, vec3(t * 0.53, t * 0.47, t * 0.43));
    return v * 0.5;
  }
`;

export const VELOCITY = /* glsl */`
  ${COMMON}
  ${CURL}
  uniform float uDt, uStiff, uBreeze, uBreezeR, uCharge, uScrollV;
  uniform vec3 uRayO, uRayD, uRayV, uGustD;
  uniform vec4 uGust;
  void main(){
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 P = texture2D(texturePosition, uv).xyz;
    vec3 V = texture2D(textureVelocity, uv).xyz;
    vec3 s = hash32(gl_FragCoord.xy);
    float q = stageQ(s.x), e = q * q * (3.0 - 2.0 * q), w = sin(3.14159265 * q);
    vec4 a = texture2D(tA, uv), b = texture2D(tB, uv);
    vec3 H = vortex(mix(flapP(a.xyz, uFlapA), flapP(b.xyz, uFlapB), e), w, s);
    H += sway(H) * (1.0 - w);
    float ord = mix(texture2D(tNA, uv).a, texture2D(tNB, uv).a, e);
    float att = smoothstep(ord * 0.7, ord * 0.7 + 0.3, uBloom);

    float k = uStiff * mix(1.0, 0.4, w) * (0.03 + 0.97 * att * att);
    vec3 acc = (H - P) * k;
    acc -= V * (2.0 * sqrt(k) * 0.62 + (1.0 - att) * 1.1);

    // wind: always a whisper, a gale in transit or after a gust
    float windy = w * 0.5 + (1.0 - att) * 1.2 + 0.02 + uCharge * 0.25;
    acc += curl(P * 0.75 + vec3(0.0, -uTime * 0.16, uTime * 0.07), uTime) * windy * 2.6;
    acc.y += (1.0 - att) * 0.1;

    // the cursor is a breeze: push away from the pointer ray, and along the way it moves
    vec3 rp = P - uRayO;
    vec3 d = rp - uRayD * dot(rp, uRayD);
    float dl = length(d) + 1e-4;
    float fall = exp(-dl * dl / (uBreezeR * uBreezeR));
    acc += (d / dl * 24.0 + uRayV * 13.0 + curl(P * 2.0, uTime) * 8.0) * fall * uBreeze * (0.55 + 0.9 * s.z);

    // a gust: radial blast from the click, carried away from the viewer and upward
    vec3 g = P - uGust.xyz; float gl = length(g) + 1e-4;
    vec3 gd = normalize(g / gl * 1.2 + uGustD * 0.7 + vec3(0.0, 0.12, 0.0) + (s - 0.5) * 1.1);
    acc += gd * uGust.w * exp(-gl * 0.55) * (0.35 + 1.2 * s.y);

    // holding: the flower draws in its breath and trembles
    acc += vec3(-P.x, (0.25 - P.y) * 0.45, -P.z) * uCharge * 9.0 * (0.4 + s.z);
    acc += (hash32(gl_FragCoord.xy + fract(uTime * 7.31) * 413.0) - 0.5) * uCharge * uCharge * 90.0;

    // scrolling drags the petals a little
    acc.y += uScrollV * (1.0 + w * 2.0 + (1.0 - att) * 2.0) * (0.6 + s.y) * 3.0;

    V += acc * uDt;
    float sp = length(V);
    if (sp > 14.0) V *= 14.0 / sp;
    gl_FragColor = vec4(V, 1.0);
  }
`;

export const POSITION = /* glsl */`
  uniform float uDt;
  void main(){
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 P = texture2D(texturePosition, uv);
    P.xyz += texture2D(textureVelocity, uv).xyz * uDt;
    gl_FragColor = P;
  }
`;

// ─── Rendering ──────────────────────────────────────────────────────────────
const PART_VERT = (glow) => /* glsl */`
  ${COMMON}
  attribute vec2 ref;
  uniform sampler2D tPos, tCA, tCB;
  uniform float uDot, uScale, uFocus, uAperture, uCoreCut, uCharge, uGlowFrac, uGlowA, uIrid, uPetal, uLift, uSize;
  uniform vec3 uL, uKey, uAmb;
  varying vec4 vCol;
  varying vec4 vPet;
  void main(){
    vec3 P = texture2D(tPos, ref).xyz;
    vec2 id = ref * uSize;
    vec3 s = hash32(id);
    float s4 = hash12(id + 17.0);
    float q = stageQ(s.x), e = q * q * (3.0 - 2.0 * q), w = sin(3.14159265 * q);
    vec4 a = texture2D(tA, ref), b = texture2D(tB, ref);
    vec4 na = texture2D(tNA, ref), nb = texture2D(tNB, ref);
    vec3 n = normalize(mix(flapN(na.xyz * 2.0 - 1.0, a.x, uFlapA), flapN(nb.xyz * 2.0 - 1.0, b.x, uFlapB), e) + 1e-4);
    float ord = mix(na.a, nb.a, e);
    float att = smoothstep(ord * 0.7, ord * 0.7 + 0.3, uBloom);
    float windS = max(w, 1.0 - att);

    vec4 ca = texture2D(tCA, ref), cb = texture2D(tCB, ref);
    vec3 base = pow(mix(ca.rgb, cb.rgb, smoothstep(0.3, 0.7, q)), vec3(2.2));
    float ao = mix(mix(ca.a, cb.a, e), 0.9, windS * 0.75);

    vec4 mv = modelViewMatrix * vec4(P, 1.0);
    vec3 nv = normalize(normalMatrix * n);
    vec3 vd = normalize(-mv.xyz);
    float fc = dot(nv, vd);
    if (fc < 0.0) { nv = -nv; fc = -fc; }
    float ndl = dot(nv, uL);
    float wrap = clamp((ndl + 0.45) / 1.45, 0.0, 1.0);
    float trans = clamp(-ndl, 0.0, 1.0);
    float aoF = mix(0.2, 1.0, ao);
    vec3 lit = base * (uAmb * aoF + uKey * (wrap * mix(0.45, 1.0, aoF) + trans * 0.45 * aoF));
    lit += (base * 0.8 + 0.03) * pow(1.0 - fc, 3.0) * 0.22 * aoF;
    // structural colour: morpho scales flash as the wing turns through the light
    float blue = clamp((base.b - max(base.r, base.g)) * 5.0, 0.0, 1.0);
    vec3 hv = normalize(uL + vd);
    lit += vec3(0.25, 0.6, 1.0) * pow(max(dot(nv, hv), 0.0), 12.0) * blue * uIrid;
    lit = lit * (1.0 + uLift) + base * uLift * 0.25;
    lit *= 1.0 + uCharge * 0.4 * s.y;

    float depth = -mv.z;
    float dotPx = uDot * uScale / depth * (0.7 + 0.6 * s.z) * mix(a.w, b.w, e);
    float coc = uAperture * abs(depth - uFocus) / (depth * uFocus) * uScale;
    float cut = uCoreCut * (0.55 + 0.9 * s.y);
    float petal = step(1.0 - uPetal, s4) * smoothstep(0.25, 0.7, windS);
    gl_Position = projectionMatrix * mv;
  ${glow ? `
    bool defoc = coc > cut;
    if (!defoc && s.z > uGlowFrac) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    float g = dotPx * 2.3;
    float size = sqrt(g * g + 4.0 * coc * coc);
    gl_PointSize = size;
    float alpha = defoc ? clamp(3.2 * dotPx * dotPx / (size * size), 0.03, 0.8) : uGlowA;
    vCol = vec4(lit, alpha);
    vPet = vec4(defoc ? 1.0 : 0.0, 0.0, 0.0, 0.0);
  ` : `
    if (coc > cut && petal < 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    gl_PointSize = min(dotPx * (1.0 + petal * 3.4), max(dotPx, uScale * 0.012)) + coc * 0.3;
    vCol = vec4(lit, 1.0);
    vPet = vec4(petal, s.x * 6.2831 + uTime * (0.6 + s.y * 1.4) * petal, cos(uTime * (1.3 + s.z * 2.0) + s.y * 9.0), 0.0);
  `}
  }
`;

export const CORE_VERT = PART_VERT(false);
export const GLOW_VERT = PART_VERT(true);

export const CORE_FRAG = /* glsl */`
  varying vec4 vCol;
  varying vec4 vPet;
  void main(){
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float d = length(c);
    float shade = 1.0;
    if (vPet.x > 0.01) {
      float ca = cos(vPet.y), sa = sin(vPet.y);
      vec2 p = mat2(ca, -sa, sa, ca) * c;
      p.x /= max(abs(vPet.z), 0.22);
      float wdt = 0.5 + 0.34 * p.y;
      float dp = length(vec2(p.x / max(wdt, 0.05), p.y * 1.02));
      d = mix(d * (1.0 + 5.0 * vPet.x), dp, vPet.x);
      shade = mix(1.0, 0.78 + 0.34 * (p.y * 0.5 + 0.5) - abs(p.x) * 0.2, vPet.x);
    }
    if (d > 1.0) discard;
    gl_FragColor = vec4(vCol.rgb * shade, 1.0);
  }
`;

export const GLOW_FRAG = /* glsl */`
  varying vec4 vCol;
  varying vec4 vPet;
  void main(){
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float d = dot(c, c);
    if (d > 1.0) discard;
    float a = vPet.x > 0.5 ? smoothstep(1.0, 0.7, d) * (0.78 + 0.3 * d) : exp(-d * 4.0) * (1.0 - d);
    gl_FragColor = vec4(vCol.rgb, vCol.a * a);
  }
`;

// Pollen and seed-fluff drifting through the plate: depth of field only, no simulation.
export const MOTE_VERT = /* glsl */`
  attribute vec4 seed;
  uniform float uTime, uScale, uFocus, uAperture, uGustE;
  uniform vec3 uGustC;
  varying vec4 vCol;
  void main(){
    vec3 p = position;
    float t = uTime * (0.05 + seed.x * 0.08);
    p += vec3(sin(t * 3.1 + seed.y * 40.0), sin(t * 2.3 + seed.z * 13.0) * 0.7 + t * 0.6, cos(t * 2.7 + seed.w * 27.0)) * 0.6;
    p.y = mod(p.y + 6.0, 12.0) - 6.0;
    vec3 gd = p - uGustC;
    p += normalize(gd + 1e-3) * uGustE * (1.6 + seed.y * 2.0) * exp(-length(gd) * 0.25);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = -mv.z;
    gl_Position = projectionMatrix * mv;
    float dotPx = (0.006 + seed.x * 0.012) * uScale / depth;
    float coc = uAperture * 1.6 * abs(depth - uFocus) / (depth * uFocus) * uScale;
    float size = sqrt(dotPx * dotPx + 4.0 * coc * coc);
    gl_PointSize = clamp(size, 1.0, 90.0);
    vec3 col = mix(vec3(1.0, 0.88, 0.66), vec3(1.0, 0.8, 0.74), seed.z);
    col = mix(col, vec3(1.0, 0.97, 0.92), seed.w * 0.6);
    vCol = vec4(col, clamp(2.4 * dotPx * dotPx / (size * size), 0.015, 0.6) * smoothstep(1.2, 4.0, depth) * (0.3 + 0.45 * seed.y));
  }
`;

export const MOTE_FRAG = /* glsl */`
  varying vec4 vCol;
  void main(){
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float d = dot(c, c);
    if (d > 1.0) discard;
    gl_FragColor = vec4(vCol.rgb, vCol.a * smoothstep(1.0, 0.55, d));
  }
`;

// The paper: warm stock, a pool of light behind the specimen, fibre grain, a toned edge.
export const PAPER_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;
export const PAPER_FRAG = /* glsl */`
  uniform vec3 uPaper, uEdge, uGlowC;
  uniform vec2 uGlowP;
  uniform float uAspect, uGlow;
  uniform sampler2D tGrain, tShadow;
  uniform float uShadow;
  uniform vec2 uShadowOff, uTexel;
  varying vec2 vUv;
  // soft drop shadow: 16-tap golden-angle disc over the low-res silhouette
  float shadowAt(vec2 p){
    float s = 0.0;
    for (int i = 0; i < 16; i++) {
      float fi = float(i) + 0.5;
      float r = sqrt(fi / 16.0) * 4.2;
      float a = fi * 2.39996;
      s += texture2D(tShadow, p + vec2(cos(a), sin(a)) * r * uTexel).a;
    }
    return s / 16.0;
  }
  // exact inverse of the Khronos PBR Neutral tone mapper, so the paper lands on the brand cream
  vec3 invNeutral(vec3 o){
    const float sc = 0.76, ds = 0.15, d = 0.24;
    float np = min(max(o.r, max(o.g, o.b)), 0.995);
    vec3 c = o;
    if (np >= sc) {
      float peak = d * d / (1.0 - np) - d + sc;
      float g = 1.0 - 1.0 / (ds * (peak - np) + 1.0);
      c = (o - g * np) / (1.0 - g) * (peak / np);
    }
    return c + 0.04;
  }
  void main(){
    vec2 p = vUv;
    vec2 q = (p - uGlowP) * vec2(uAspect, 1.0);
    float g = exp(-dot(q, q) * 2.4);
    vec2 e = (p - 0.5) * vec2(uAspect, 1.0);
    vec3 c = mix(uPaper, uEdge, smoothstep(0.35, 1.25, length(e)));
    c = mix(c, uGlowC, g * uGlow);
    float fib = texture2D(tGrain, p * vec2(uAspect, 1.0) * 1.3).r;
    float fib2 = texture2D(tGrain, p * vec2(uAspect, 1.0) * 5.1 + 0.37).g;
    c *= 0.982 + fib * 0.026 + fib2 * 0.012;
    if (uShadow > 0.0) {
      float sh = shadowAt(p - uShadowOff);
      c *= 1.0 - sh * 0.13 * uShadow * vec3(0.9, 1.0, 1.08);
    }
    gl_FragColor = vec4(invNeutral(c), 1.0);
  }
`;
