// The blade: a per-vertex blade frame (u along the steel from tip to guard, v across edge to edge) and a
// MeshStandardMaterial patch that adds blackbody emission, forge scale, glowing scale flakes and the etched
// damascus pattern revealed after the quench.
import * as THREE from 'three';
import { NOISE, BLACKBODY } from './glsl.js';

/**
 * Analyse the sword geometry. Returns the matrix that maps geometry space -> sword space
 * (metres, tip toward -X, flat of the blade facing +Y, guard start at the origin) and writes a
 * `blade` attribute (u, v) on the geometry.
 */
export function analyseSword(geometry, length = 0.95) {
  const pos = geometry.attributes.position;
  const n = pos.count;
  const P = new Float32Array(n * 3);
  const mean = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    P[i * 3] = pos.getX(i); P[i * 3 + 1] = pos.getY(i); P[i * 3 + 2] = pos.getZ(i);
    mean.x += P[i * 3]; mean.y += P[i * 3 + 1]; mean.z += P[i * 3 + 2];
  }
  mean.divideScalar(n);
  const cov = (sel) => {
    const C = [0, 0, 0, 0, 0, 0, 0, 0, 0]; let c = 0;
    for (let i = 0; i < n; i++) {
      if (sel && !sel(i)) continue;
      const d = [P[i * 3] - mean.x, P[i * 3 + 1] - mean.y, P[i * 3 + 2] - mean.z];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a * 3 + b] += d[a] * d[b];
      c++;
    }
    return C.map(v => v / Math.max(c, 1));
  };
  const power = (C, seed, ortho) => {
    let e = new THREE.Vector3(...seed).normalize();
    for (let it = 0; it < 80; it++) {
      const r = new THREE.Vector3(C[0] * e.x + C[1] * e.y + C[2] * e.z, C[3] * e.x + C[4] * e.y + C[5] * e.z, C[6] * e.x + C[7] * e.y + C[8] * e.z);
      if (ortho) r.addScaledVector(ortho, -r.dot(ortho));
      e = r.normalize();
    }
    return e;
  };
  const axis = power(cov(), [1, 0.2, 0.1]);
  const proj = new Float32Array(n);
  let sMin = Infinity, sMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const s = (P[i * 3] - mean.x) * axis.x + (P[i * 3 + 1] - mean.y) * axis.y + (P[i * 3 + 2] - mean.z) * axis.z;
    proj[i] = s; sMin = Math.min(sMin, s); sMax = Math.max(sMax, s);
  }
  // Width axis: second principal direction of the whole sword (the guard spreads the same way as the edges).
  const width = power(cov(), [0, 0, 1], axis);
  // Find the guard: the slice with the largest spread along the width axis.
  const BINS = 64;
  const wMin = new Float32Array(BINS).fill(Infinity), wMax = new Float32Array(BINS).fill(-Infinity);
  const binOf = s => Math.min(BINS - 1, Math.floor((s - sMin) / (sMax - sMin) * BINS));
  const W = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = (P[i * 3] - mean.x) * width.x + (P[i * 3 + 1] - mean.y) * width.y + (P[i * 3 + 2] - mean.z) * width.z;
    W[i] = w;
    const b = binOf(proj[i]);
    wMin[b] = Math.min(wMin[b], w); wMax[b] = Math.max(wMax[b], w);
  }
  let gb = 0, gw = 0;
  for (let b = 0; b < BINS; b++) { const w = wMax[b] - wMin[b]; if (w > gw && isFinite(w)) { gw = w; gb = b; } }
  // Tip is the end farther from the guard.
  const flip = gb < BINS / 2;
  if (flip) axis.negate();
  const sTipAbs = flip ? -sMax : sMin; // in the (possibly flipped) axis
  const S = i => (flip ? -proj[i] : proj[i]);
  // Guard start: walk from the guard bin toward the tip until the width drops back to blade width.
  const bladeW = [];
  const B2 = i => Math.min(BINS - 1, Math.floor((S(i) - sTipAbs) / (sMax - sMin) * BINS));
  const bMin = new Float32Array(BINS).fill(Infinity), bMax = new Float32Array(BINS).fill(-Infinity);
  for (let i = 0; i < n; i++) { const b = B2(i); bMin[b] = Math.min(bMin[b], W[i]); bMax[b] = Math.max(bMax[b], W[i]); }
  let guardBin = 0, gw2 = 0;
  for (let b = 0; b < BINS; b++) { const w = bMax[b] - bMin[b]; if (w > gw2 && isFinite(w)) { gw2 = w; guardBin = b; } }
  for (let b = 4; b < guardBin; b++) bladeW.push(bMax[b] - bMin[b]);
  const typical = bladeW.sort((a, b) => a - b)[Math.floor(bladeW.length * 0.6)] ?? gw2 * 0.4;
  let gStart = guardBin;
  while (gStart > 0 && (bMax[gStart - 1] - bMin[gStart - 1]) > typical * 1.35) gStart--;
  const sGuard = sTipAbs + gStart / BINS * (sMax - sMin);
  const bladeLen = sGuard - sTipAbs;
  // Blade centre line and half-width per bin, for v in -1..1 edge to edge.
  const cen = new Float32Array(BINS), half = new Float32Array(BINS);
  for (let b = 0; b < BINS; b++) {
    if (isFinite(bMin[b])) { cen[b] = (bMin[b] + bMax[b]) / 2; half[b] = Math.max((bMax[b] - bMin[b]) / 2, 1e-4); }
    else { cen[b] = cen[b - 1] ?? 0; half[b] = half[b - 1] ?? 0.01; }
  }
  const blade = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const s = S(i);
    const u = (s - sTipAbs) / bladeLen;
    const bf = clampN((s - sTipAbs) / (sMax - sMin) * BINS - 0.5, 0, BINS - 1.001);
    const b0 = Math.floor(bf), t = bf - b0;
    const c = cen[b0] * (1 - t) + cen[Math.min(b0 + 1, BINS - 1)] * t;
    const h = half[b0] * (1 - t) + half[Math.min(b0 + 1, BINS - 1)] * t;
    blade[i * 2] = u;
    blade[i * 2 + 1] = u <= 1 ? clampN((W[i] - c) / h, -1, 1) : 0;
  }
  geometry.setAttribute('blade', new THREE.BufferAttribute(blade, 2));

  // Build geometry -> sword-space matrix.
  const thick = new THREE.Vector3().crossVectors(width, axis).normalize(); // right-handed: axis x thick = width
  const scale = length / (sMax - sMin);
  const basis = new THREE.Matrix4().makeBasis(axis, thick, width); // columns: local X,Y,Z in geometry space
  const rot = basis.clone().transpose(); // geometry -> local
  // Origin at the guard start on the blade centre line.
  const guardCentre = mean.clone().addScaledVector(axis, sGuard).addScaledVector(width, cen[Math.max(gStart - 2, 0)]);
  // Centre thickness: average of thickness coordinate over blade vertices.
  let tc = 0, tn = 0;
  for (let i = 0; i < n; i += 7) { if (S(i) < sGuard - 0.05 && S(i) > sTipAbs + 0.1) { tc += (P[i * 3] - mean.x) * thick.x + (P[i * 3 + 1] - mean.y) * thick.y + (P[i * 3 + 2] - mean.z) * thick.z; tn++; } }
  guardCentre.addScaledVector(thick, tn ? tc / tn : 0);
  const m = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(rot).multiply(new THREE.Matrix4().makeTranslation(-guardCentre.x, -guardCentre.y, -guardCentre.z));
  // Blade thickness in metres (for resting on the anvil).
  let tMin = Infinity, tMax = -Infinity;
  for (let i = 0; i < n; i += 3) { if (S(i) < sGuard - 0.03) { const tt = (P[i * 3] - guardCentre.x) * thick.x + (P[i * 3 + 1] - guardCentre.y) * thick.y + (P[i * 3 + 2] - guardCentre.z) * thick.z; tMin = Math.min(tMin, tt); tMax = Math.max(tMax, tt); } }
  return {
    matrix: m,
    bladeLength: bladeLen * scale,
    total: length,
    halfThickness: Math.max(Math.abs(tMin), Math.abs(tMax)) * scale,
    thickMin: tMin * scale,
    guardHalfWidth: gw2 / 2 * scale,
    hiltLength: (sMax - sGuard) * scale,
  };
}
function clampN(v, a, b) { return Math.min(b, Math.max(a, v)); }

/** Patch the sword's glTF material. Returns the uniforms driven by the page. */
export function heatMaterial(material, damascusTex) {
  const u = {
    uFront: { value: 0.3 },     // how far the heat has travelled from the tip (0..1.1 of blade length)
    uPeak: { value: 0.5 },      // peak temperature, 0..1 -> 600..1700 K
    uTime: { value: 0 },
    uForged: { value: 1 },      // black forge scale over the steel
    uDam: { value: 0 },         // etched damascus pattern
    uCool: { value: 0 },        // quench front travelling from the tip
    uStrike: { value: new THREE.Vector3(0.4, 0, 10) }, // u, amplitude, age
    uGlow: { value: 10 },
    uDamTex: { value: damascusTex },
  };
  material.userData.heat = u;
  material.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 blade;\nvarying vec2 vBlade;\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlade = blade;\nvLocal = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vBlade; varying vec3 vLocal;
        uniform float uFront, uPeak, uTime, uForged, uDam, uCool, uGlow;
        uniform vec3 uStrike; uniform sampler2D uDamTex;
        ${NOISE}
        ${BLACKBODY}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float bladeM = 1.0 - smoothstep(0.975, 1.0, vBlade.x);
        float hn = fbm3(vLocal * 9.0 + vec3(0.0, uTime * 0.04, 0.0));
        // the scale falls away from tip to guard, revealing the etched layers
        float damM = uDam >= 1.35 ? 1.0 : 1.0 - smoothstep(uDam - 0.16, uDam, vBlade.x + hn * 0.12 + 0.05);
        float forgedM = uForged * (1.0 - damM);
        float wipe = damM * (1.0 - damM) * 4.0 * step(0.01, uDam) * step(uDam, 1.34);
        float d = vBlade.x + hn * 0.075;
        float prof = 1.0 - smoothstep(uFront - 0.3, uFront + 0.035, d);
        float grad = mix(1.0, 0.64, clamp(d / max(uFront, 0.05), 0.0, 1.0));
        float edge = abs(vBlade.y);
        float heat01 = clamp(uPeak * prof * grad * (1.0 + edge * 0.06) + smoothstep(0.06, 0.0, vBlade.x) * 0.05 * prof, 0.0, 1.2);
        // quench: the cold front runs up from the tip
        float cooled = 1.0 - smoothstep(uCool - 0.14, uCool + 0.01, vBlade.x + hn * 0.05);
        heat01 *= 1.0 - cooled;
        float strikeFlare = uStrike.y * exp(-pow((vBlade.x - uStrike.x) * 7.0, 2.0)) * exp(-uStrike.z * 2.6) * step(0.12, heat01);
        heat01 = clamp(heat01 + strikeFlare * 0.28, 0.0, 1.25);
        heat01 *= bladeM;
        float K = 520.0 + heat01 * 1080.0;
        // forge scale: mottled oxide with irregular glowing cracks; a few flakes flare as they lift
        float scaleAmt = forgedM * bladeM * smoothstep(0.1, 0.45, heat01) * (1.0 - smoothstep(0.82, 1.08, heat01));
        float mot = fbm3(vLocal * vec3(26.0, 26.0, 26.0) + 3.7);
        float crack = 1.0 - smoothstep(0.0, 0.06, abs(snoise(vLocal * 21.0 + 1.3)));
        vec3 cl = cells(vec2(vBlade.x * 70.0, vBlade.y * 2.6 + step(0.0, vLocal.x) * 7.0));
        float pop = pow(max(sin(uTime * (0.6 + cl.z * 1.4) + cl.z * 91.0), 0.0), 40.0) * step(0.7, cl.z) * smoothstep(0.25, 0.0, cl.x);
        float flakeMod = mix(1.0, 0.5 + 0.35 * smoothstep(-0.3, 0.4, -mot), scaleAmt) + crack * scaleAmt * 0.55 + pop * scaleAmt * 1.4;
        vec3 heatEmit = blackbody(K) * glowPower(K) * uGlow * flakeMod;
        // albedo: black scale over the forged blade, etched damascus after the polish
        float mott = fbm3(vLocal * 34.0) * 0.5 + 0.5;
        vec3 scaleCol = vec3(0.034, 0.032, 0.031) * (0.55 + mott * 0.9) * (0.85 + mot * 0.3);
        diffuseColor.rgb = mix(diffuseColor.rgb, scaleCol, forgedM * bladeM);
        vec3 dam = texture2D(uDamTex, vec2(vBlade.x * 1.1 + 0.13, vBlade.y * 0.11 + 0.5)).rgb;
        float dl = smoothstep(0.1, 0.62, dot(dam, vec3(0.3333)));
        float bevel = smoothstep(0.78, 0.97, edge);
        vec3 damCol = mix(vec3(0.05, 0.05, 0.055), vec3(0.8, 0.8, 0.82), dl);
        damCol = mix(damCol, vec3(0.62, 0.62, 0.64), bevel * 0.55);
        diffuseColor.rgb = mix(diffuseColor.rgb, damCol, damM * bladeM);
        heatEmit += blackbody(1100.0) * glowPower(1100.0) * 1.6 * pow(wipe, 6.0) * bladeM;
        float e_rough = mix(0.62 + mott * 0.25, 0.85, scaleAmt);
        float e_damRough = mix(0.55, 0.14, max(dl, bevel));
        float e_damMetal = mix(0.3, 1.0, max(dl, bevel));
        `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, e_rough, forgedM * bladeM);
        roughnessFactor = mix(roughnessFactor, e_damRough, damM * bladeM);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.55 - scaleAmt * 0.3, forgedM * bladeM);
        metalnessFactor = mix(metalnessFactor, e_damMetal, damM * bladeM);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += heatEmit;`);
  };
  material.customProgramCacheKey = () => 'ember-heat';
  material.needsUpdate = true;
  return u;
}
