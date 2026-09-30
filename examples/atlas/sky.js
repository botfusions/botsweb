// Sky dome, the shared sky-colour function and the aerial-perspective patch used by every material in the world,
// so islands, clouds and birds all melt into exactly the colour of the sky behind them.
import { THREE } from '../../src/core/engine.js';

export const sky = {
  uZenith: { value: new THREE.Color('#3f8fe0') },
  uMid: { value: new THREE.Color('#7cc4ff') },
  uHorizon: { value: new THREE.Color('#ffe4cc') },
  uBelow: { value: new THREE.Color('#f3e4dc') },
  uSunCol: { value: new THREE.Color('#ffd2a4') },
  uSunDir: { value: new THREE.Vector3(-0.337, 0.174, -0.925).normalize() },
  uFogDensity: { value: 0.0032 },
  uFogLow: { value: new THREE.Vector3(-2, -13, 0.8) }, // start y, full y, max amount
  uTime: { value: 0 },
};

export const SKY_GLSL = /* glsl */`
  uniform vec3 uZenith, uMid, uHorizon, uBelow, uSunCol, uSunDir;
  uniform float uFogDensity; uniform vec3 uFogLow; uniform float uTime;
  vec3 skyColor(vec3 d){
    float y = d.y;
    vec3 c = mix(uMid, uZenith, smoothstep(0.08, 0.75, y));
    c = mix(c, uHorizon, pow(1.0 - clamp(y + 0.02, 0.0, 1.0), 7.0));
    c = mix(c, uBelow, smoothstep(-0.01, -0.22, y));
    float s = max(dot(d, uSunDir), 0.0);
    c += uSunCol * (pow(s, 5.0) * 0.22 + pow(s, 40.0) * 0.5);
    return c;
  }
  vec3 atmosphere(vec3 col, vec3 worldPos){
    vec3 dv = worldPos - cameraPosition; float dist = length(dv); vec3 dir = dv / max(dist, 1e-4);
    float f = 1.0 - exp(-uFogDensity * dist);
    f = max(f, smoothstep(uFogLow.x, uFogLow.y, worldPos.y) * uFogLow.z);
    return mix(col, skyColor(dir), clamp(f, 0.0, 1.0));
  }
`;

export function skyDome() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { ...sky },
    vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz); vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position,1.)).xyz, 1.); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`${SKY_GLSL}
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        float s = max(dot(d, uSunDir), 0.0);
        vec3 warm = mix(uSunCol, vec3(1.0, 0.97, 0.9), 0.7);
        c += warm * smoothstep(0.99972, 0.99988, s) * 8.0;   // the disc (HDR, catches the bloom)
        c += warm * (pow(s, 260.0) * 0.8 + pow(s, 28.0) * 0.22);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  return dome;
}

/**
 * Patch a standard material with sky-matched aerial perspective (distance + low mist),
 * an optional hover rim, and a waterfall flow overlay inside an island-space box.
 */
export function patchAtmosphere(mat, extra = {}) {
  const u = {
    uHover: extra.hover ?? { value: 0 },
    uRimCol: { value: new THREE.Color('#ffd28a') },
    uRel: extra.rel ?? { value: new THREE.Matrix4() },
    uFallA: { value: extra.fallA ?? new THREE.Vector3(9, 9, 9) },
    uFallB: { value: extra.fallB ?? new THREE.Vector3(9, 9, 9) },
    uLit: extra.lit ?? { value: 0 },
  };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, sky, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAtmoW; varying vec3 vIsl; uniform mat4 uRel;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
      vec4 aw = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        aw = instanceMatrix * aw;
      #endif
      vAtmoW = (modelMatrix * aw).xyz; vIsl = (uRel * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vAtmoW; varying vec3 vIsl; uniform float uHover, uLit; uniform vec3 uRimCol, uFallA, uFallB;\n${SKY_GLSL}
        float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
          return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // waterfall flow: bright streaks sliding down inside the sheet
          vec3 q = vIsl;
          float inFall = step(uFallA.x, q.x) * step(q.x, uFallB.x) * step(uFallA.y, q.y) * step(q.y, uFallB.y) * step(uFallA.z, q.z) * step(q.z, uFallB.z);
          if (inFall > 0.5) {
            // dissolve the sculpted sheet where it ends; the particle stream takes over from here
            float cut = smoothstep(uFallA.y + 1.3, uFallA.y + 0.15, q.y);
            if (h21(gl_FragCoord.xy + fract(uTime) * 17.0) < cut) discard;
            float s1 = vn(vec2(q.x * 26.0, q.y * 1.6 + uTime * 2.6));
            float s2 = vn(vec2(q.x * 61.0 + 3.0, q.y * 3.1 + uTime * 4.1));
            float streak = smoothstep(0.55, 0.95, s1 * 0.6 + s2 * 0.5);
            totalEmissiveRadiance += vec3(0.55, 0.68, 0.78) * streak * 0.6;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.9, 1.0), 0.25);
          }
        }`)
      .replace('#include <fog_fragment>', `
        {
          float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float fr = pow(1.0 - ndv, 2.6), frT = pow(1.0 - ndv, 5.0);
          gl_FragColor.rgb += uRimCol * (fr * 0.07 + frT * uHover * 2.2);
          gl_FragColor.rgb *= 1.0 + uHover * 0.1;
          gl_FragColor.rgb = atmosphere(gl_FragColor.rgb, vAtmoW);
        }`);
  };
  mat.customProgramCacheKey = () => 'atlas-atmo';
  mat.userData.atmo = u;
  return u;
}
