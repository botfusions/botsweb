// The deck: Meshy turntable with its tonearm cut free (so it can cue), a procedural vinyl record with
// anisotropic grooves cut from the actual audio, a printed label, and a spectrum halo around the platter.
import { THREE } from '../../src/core/engine.js';
import { bakeTexture } from '../../src/core/textures.js';

// Measured in the turntable mesh's local (quantised) space.
export const L = {
  cx: -0.205, cz: 0, R: 0.703, top: 0.1755, bottom: 0.1585, label: 0.232, hole: 0.0165,
  pivot: new THREE.Vector3(0.655, 0.285, -0.458),
  stylus: new THREE.Vector2(0.214, 0.287),
  armDir: new THREE.Vector2(-0.5143, 0.8576),
  plinthTop: 0.022,
};
// Groove bands (radius in local units, outer → inner), proportional to the track lengths.
const SECS = [252, 303, 228, 380];
const G_OUT = 0.688, G_IN = 0.292, GAP = 0.0075;
export const BANDS = (() => {
  const span = G_OUT - G_IN - GAP * (SECS.length - 1), tot = SECS.reduce((a, b) => a + b, 0);
  let r = G_OUT;
  return SECS.map(s => { const w = span * s / tot; const b = { outer: r, inner: r - w }; r -= w + GAP; return b; });
})();

// ─── Tonearm split ─────────────────────────────────────────────────────────────
function splitArm(mesh) {
  const g = mesh.geometry, pos = g.attributes.position, idx = g.index.array;
  const P = L.pivot, d = L.armDir;
  // per vertex: inside the arm's corridor (xz) and above the plinth; "up" = above that zone's cut height
  const corr = new Uint8Array(pos.count), up = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const rx = x - P.x, rz = z - P.z;
    const s = rx * d.x + rz * d.y;               // along the arm, + toward the headshell
    const q = Math.abs(rx * d.y - rz * d.x);     // off-axis distance
    let c = false, cut = 1;
    if (s > 0.7) { c = q < 0.13 && s < 1.03 && y > 0.14; cut = 0.1762; }          // headshell + cartridge
    else if (s > 0.1) { c = q < 0.045 && y > 0.19; cut = 0.2; }                  // arm tube
    else if (s > -0.13) { c = q < 0.105 && y > 0.2; cut = 0.222; }              // bearing housing (tower stays)
    else { c = s > -0.42 && q < 0.11 && y > 0.19; cut = 0.205; }                // counterweight stub
    corr[i] = c ? 1 : 0; up[i] = y > cut ? 1 : 0;
  }
  const a = [], b = [];
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
    const inArm = corr[i0] && corr[i1] && corr[i2] && (up[i0] || up[i1] || up[i2]);
    (inArm ? a : b).push(i0, i1, i2);
  }
  const make = list => {
    const ng = new THREE.BufferGeometry();
    for (const k in g.attributes) ng.setAttribute(k, g.attributes[k]);
    ng.setIndex(list);
    ng.computeBoundingBox(); ng.computeBoundingSphere();
    return ng;
  };
  return { base: make(b), arm: make(a), armTris: a.length / 3 };
}

// ─── Textures ─────────────────────────────────────────────────────────────────
export function labelTexture(renderer, { title = 'AUBERGINE HOURS', artist = 'KAZU NOMURA & THE LATE ROOM', cat = 'LF-011', side = 'A', tracks = [] } = {}) {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2, r = S / 2;
  // paper: lavender with a faint print grain
  const grd = g.createRadialGradient(cx, cx, 0, cx, cx, r);
  grd.addColorStop(0, '#9d93ff'); grd.addColorStop(1, '#8676f0');
  g.fillStyle = grd; g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.fill();
  const img = g.getImageData(0, 0, S, S), px = img.data;
  for (let i = 0; i < px.length; i += 4) { const n = (Math.random() - 0.5) * 14; px[i] += n; px[i + 1] += n; px[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const ink = '#1a1030', cream = '#f6efe2';
  g.strokeStyle = ink; g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cx, r - 30, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cx, r - 42, 0, Math.PI * 2); g.stroke();
  // circular rim text
  const rim = `LOW FREQUENCY RECORDS · 低周波 · SHIMOKITAZAWA · TOKYO · ${cat} · ALL RIGHTS OF THE PRODUCER AND OF THE OWNER OF THE RECORDED WORK RESERVED · `;
  g.fillStyle = ink; g.font = '600 19px "Space Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const chars = [...rim]; const step = (Math.PI * 2) / chars.length;
  chars.forEach((ch, i) => { g.save(); g.translate(cx, cx); g.rotate(i * step); g.translate(0, -(r - 62)); g.fillText(ch, 0, 0); g.restore(); });
  // logo block
  g.fillStyle = ink;
  g.font = '800 88px "Syne", sans-serif'; g.fillText('LOW', cx, cx - 250);
  g.font = '800 58px "Syne", sans-serif'; g.fillText('FREQUENCY', cx, cx - 180);
  // wave mark
  g.strokeStyle = ink; g.lineWidth = 5; g.beginPath();
  for (let x = -150; x <= 150; x += 3) { const y = Math.sin(x / 150 * Math.PI * 2.5) * 16 * Math.cos(x / 150 * Math.PI / 2); x === -150 ? g.moveTo(cx + x, cx - 118 + y) : g.lineTo(cx + x, cx - 118 + y); }
  g.stroke();
  // side / speed around the hole
  g.font = '700 54px "Syne", sans-serif'; g.fillText(side, cx - 190, cx + 4);
  g.font = '600 20px "Space Mono", monospace'; g.fillText('SIDE', cx - 190, cx - 46);
  g.font = '700 44px "Syne", sans-serif'; g.fillText('33⅓', cx + 190, cx + 4);
  g.font = '600 20px "Space Mono", monospace'; g.fillText('RPM', cx + 190, cx - 46); g.fillText(cat, cx + 190, cx + 52); g.fillText('STEREO', cx - 190, cx + 52);
  // centre ring
  g.lineWidth = 2; g.beginPath(); g.arc(cx, cx, 92, 0, Math.PI * 2); g.stroke();
  // title + tracks
  g.fillStyle = cream; g.font = '800 44px "Syne", sans-serif'; g.fillText(title, cx, cx + 150);
  g.fillStyle = ink; g.font = '700 19px "Space Mono", monospace'; g.fillText(artist, cx, cx + 196);
  g.font = '400 17px "Space Mono", monospace';
  tracks.forEach((t, i) => g.fillText(`${t.id}  ${t.title.toUpperCase()}  ${t.time}`, cx, cx + 240 + i * 25));
  // spindle hole
  g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(cx, cx, S / 2 * (L.hole / L.label) * 1.05, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

/** Dust specks (R) and hairline scratches + dead-wax etching (G), planar over the record. */
function dustTexture(renderer) {
  const S = 2048, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  const cx = S / 2, k = S / 2 / L.R;
  for (let i = 0; i < 700; i++) {
    const a = Math.random() * Math.PI * 2, rr = (0.25 + Math.random() * 0.45) * k;
    const s = Math.random() < 0.9 ? 0.8 + Math.random() * 1.2 : 2 + Math.random() * 2.5;
    g.fillStyle = `rgba(255,0,0,${0.35 + Math.random() * 0.65})`;
    g.beginPath(); g.arc(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr, s, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, rr = (0.27 + Math.random() * 0.42) * k, len = 0.05 + Math.random() * 0.5;
    g.strokeStyle = `rgba(0,255,0,${0.15 + Math.random() * 0.4})`; g.lineWidth = 0.6 + Math.random() * 1.2;
    g.beginPath();
    if (Math.random() < 0.75) g.arc(cx, cx, rr, a, a + len); // tangential scuffs follow the grooves
    else { const l = 20 + Math.random() * 120; g.moveTo(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr); g.lineTo(cx + Math.cos(a) * (rr + l), cx + Math.sin(a) * (rr + l) + (Math.random() - 0.5) * 30); }
    g.stroke();
  }
  // matrix etching in the dead wax
  g.fillStyle = 'rgba(0,255,0,0.7)'; g.font = '500 17px "Space Mono", monospace'; g.textAlign = 'center';
  const etch = [...'LF-011-A1  ·  CUT AT THE COUNTER  ·  ☾'];
  const re = 0.268 * k;
  etch.forEach((ch, i) => { g.save(); g.translate(cx, cx); g.rotate(1.2 + i * 0.034); g.translate(0, -re); g.fillText(ch, 0, 0); g.restore(); });
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

/** Radial groove map: R = loudness, G = fine ring noise, B = grooved (1) vs smooth land (0). */
export function grooveTexture() {
  const W = 2048;
  const data = new Uint8Array(W * 4);
  const tex = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.userData.fill = (envs) => {
    for (let i = 0; i < W; i++) {
      const r = (i + 0.5) / W * L.R;
      let amp = 0, grooved = 0;
      const hash = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const fine = Math.abs(hash);
      if (r > G_OUT && r < L.R - 0.007) { grooved = 1; amp = 0.08; }          // lead-in
      else if (r < 0.285 && r > 0.252) { grooved = 0.55; amp = 0.03; }       // lead-out
      else {
        BANDS.forEach((b, k) => {
          if (r <= b.outer && r >= b.inner) {
            grooved = 1;
            const p = (b.outer - r) / (b.outer - b.inner);
            const env = envs?.[k];
            const loops = SECS[k] / 16;
            if (env) { const e = (p * loops) % 1; amp = env[Math.floor(e * env.length)]; }
            else amp = 0.5 + 0.35 * Math.sin(p * loops * Math.PI * 2 + k) * Math.sin(p * 31.0 + k * 2);
            // soft fade in/out at band edges (the cutter ramps)
            amp *= Math.min(1, p * 30, (1 - p) * 30);
          }
        });
      }
      data[i * 4] = Math.round(Math.min(1, amp) * 255);
      data[i * 4 + 1] = Math.round(fine * 255);
      data[i * 4 + 2] = Math.round(grooved * 255);
      data[i * 4 + 3] = 255;
    }
    tex.needsUpdate = true;
  };
  tex.userData.fill(null);
  return tex;
}

// ─── Vinyl material ───────────────────────────────────────────────────────────
function vinylMaterial(grooves, dust) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x070608, roughness: 0.25, metalness: 0, anisotropy: 0.8, clearcoat: 0.0, envMapIntensity: 1.2,
    specularIntensity: 1, ior: 1.52,
  });
  m.userData.u = { uGroove: { value: grooves }, uDust: { value: dust }, uRecR: { value: L.R }, uAniso: { value: 0.88 }, uWarp: { value: 0 } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, m.userData.u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRecP; varying vec3 vRadV; uniform float uWarp;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRecP = position;
        vec3 radO = normalize(vec3(position.x, 0.0, position.z) + vec3(1e-5, 0.0, 0.0));
        vRadV = normalize((modelViewMatrix * vec4(radO, 0.0)).xyz);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRecP; varying vec3 vRadV;
        uniform sampler2D uGroove, uDust; uniform float uRecR, uAniso;
        float lfGroove, lfAmp, lfScr;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          float rr = length(vRecP.xz) / uRecR;
          vec4 gv = texture2D(uGroove, vec2(rr, 0.5));
          vec4 ds = texture2D(uDust, vRecP.xz / (2.0 * uRecR) + 0.5);
          lfGroove = gv.b; lfAmp = gv.r; lfScr = ds.g;
          roughnessFactor = mix(0.07, 0.17 + lfAmp * 0.22 + gv.g * 0.07, lfGroove);
          roughnessFactor = mix(roughnessFactor, 0.55, lfScr * 0.8);
          diffuseColor.rgb += ds.r * vec3(0.16, 0.15, 0.14);
          diffuseColor.rgb *= 0.85 + gv.g * 0.3 * lfGroove;
        }`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_ANISOTROPY
        {
          vec3 radV = normalize(vRadV - normal * dot(vRadV, normal));
          material.anisotropy = clamp(uAniso * lfGroove * (0.75 + lfAmp * 0.25) * (1.0 - lfScr), 0.0, 0.97);
          material.alphaT = mix(pow2(material.roughness), 1.0, pow2(material.anisotropy));
          material.anisotropyT = radV;
          material.anisotropyB = normalize(cross(normal, radV));
        }
        #endif`);
  };
  m.customProgramCacheKey = () => 'lf-vinyl';
  return m;
}

// ─── Spectrum halo ────────────────────────────────────────────────────────────
export function spectrumRing(N = 144) {
  const amp = new Float32Array(N);
  const tex = new THREE.DataTexture(amp, N, 1, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  const base = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
  const geo = new THREE.InstancedBufferGeometry().copy(base);
  geo.instanceCount = N;
  const ids = new Float32Array(N); for (let i = 0; i < N; i++) ids[i] = i;
  geo.setAttribute('aId', new THREE.InstancedBufferAttribute(ids, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: {
      uAmp: { value: tex }, uN: { value: N }, uR0: { value: 0.742 }, uLen: { value: 0.34 }, uW: { value: 0.015 },
      uA: { value: new THREE.Color(0xa78bfa) }, uB: { value: new THREE.Color(0xffb45c) }, uI: { value: 1 },
      uMaskA: { value: 0.47 }, uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      attribute float aId; uniform sampler2D uAmp; uniform float uN, uR0, uLen, uW, uMaskA;
      varying float vU, vAmp, vV;
      void main(){
        float a = aId / uN * 6.28318530718;
        float amp = texture2D(uAmp, vec2((aId + 0.5) / uN, 0.5)).r;
        float d = abs(atan(sin(a - uMaskA), cos(a - uMaskA)));
        amp *= smoothstep(0.2, 0.42, d);
        float len = 0.012 + amp * uLen;
        vec3 p = vec3(uR0 + position.x * len, 0.0, position.z * uW * (0.6 + amp));
        float c = cos(a), s = sin(a);
        p = vec3(p.x * c + p.z * s, 0.0, -p.x * s + p.z * c);
        vU = position.x; vAmp = amp; vV = position.z;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uA, uB; uniform float uI; varying float vU, vAmp, vV;
      void main(){
        float edge = 1.0 - smoothstep(0.1, 0.5, abs(vV));
        vec3 col = mix(uA, uB, smoothstep(0.25, 1.0, vU * (0.4 + vAmp)));
        float a = edge * (0.5 + vAmp * 2.6) * (1.0 - vU * 0.5) * uI;
        gl_FragColor = vec4(col * a, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  // a hairline base circle
  const circ = new THREE.Mesh(new THREE.RingGeometry(0.736, 0.7395, 256, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xa78bfa).multiplyScalar(1.4), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  mesh.add(circ);
  return { mesh, amp, tex, mat, circ, N };
}

// ─── Assemble ─────────────────────────────────────────────────────────────────
export function buildDeck(renderer, root, { tracks }) {
  let mesh = null;
  root.traverse(o => { if (!mesh && o.isMesh) mesh = o; });
  const { base, arm } = splitArm(mesh);
  mesh.geometry = base;
  const armMesh = new THREE.Mesh(arm, mesh.material);
  armMesh.castShadow = armMesh.receiveShadow = true;
  const yaw = new THREE.Group(), lift = new THREE.Group();
  yaw.position.copy(L.pivot);
  armMesh.position.copy(L.pivot).negate();
  yaw.add(lift); lift.add(armMesh);
  mesh.add(yaw);
  const liftAxis = new THREE.Vector3(L.armDir.y, 0, -L.armDir.x).normalize(); // (0.865, 0, 0.502)

  // Record
  const grooves = grooveTexture();
  const dust = dustTexture(renderer);
  const record = new THREE.Group();
  record.position.set(L.cx, 0, L.cz);
  mesh.add(record);
  const vinyl = vinylMaterial(grooves, dust);
  const top = new THREE.Mesh(new THREE.RingGeometry(L.label - 0.004, 0.6925, 256, 24).rotateX(-Math.PI / 2).translate(0, L.top, 0), vinyl);
  top.receiveShadow = true; top.castShadow = true;
  record.add(top);
  // raised edge bead + rim + underside, as a lathe (normals are fine here, it's all curves)
  const T = L.top, B = L.bottom;
  const prof = [[0.6925, T], [0.6965, T + 0.0021], [0.7008, T + 0.0014], [0.7032, T - 0.002], [0.7034, B + 0.003], [0.701, B + 0.0002], [0.62, B]].map(([x, y]) => new THREE.Vector2(x, y));
  const edgeMat = new THREE.MeshPhysicalMaterial({ color: 0x08070a, roughness: 0.2, metalness: 0, envMapIntensity: 1.2, side: THREE.DoubleSide });
  const edge = new THREE.Mesh(new THREE.LatheGeometry(prof, 256), edgeMat);
  edge.castShadow = true; edge.receiveShadow = true;
  record.add(edge);
  const labelTex = labelTexture(renderer, { tracks });
  const labelMat = new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.62, metalness: 0, envMapIntensity: 0.5, transparent: false, alphaTest: 0.5 });
  const labelGeo = new THREE.CircleGeometry(L.label, 128).rotateX(-Math.PI / 2).translate(0, T + 0.0016, 0);
  const label = new THREE.Mesh(labelGeo, labelMat);
  label.receiveShadow = true;
  record.add(label);
  // label step (the thicker pressing around the label)
  const step = new THREE.Mesh(new THREE.CylinderGeometry(L.label + 0.004, L.label + 0.006, 0.0016, 128, 1, true).translate(0, T + 0.0008, 0), edgeMat);
  record.add(step);

  // Brushed aluminium platter skirt over the model's grungy one.
  const skirtRough = bakeTexture(renderer, 512, `void main(){ float l = fbm(vec2(vUv.y * 180.0, vUv.x * 2.0), 180.0, 4, 0.55); float r = 0.22 + l * 0.1 + fbm(vUv * vec2(3.0, 60.0), 60.0, 3, 0.5) * 0.06; gl_FragColor = vec4(1.0, clamp(r, 0.08, 1.0), 0.0, 1.0); }`);
  const skirtMat = new THREE.MeshPhysicalMaterial({ color: 0x8a898f, metalness: 1, roughness: 0.42, roughnessMap: skirtRough, envMapIntensity: 0.7 });
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.7165, 0.7165, B - L.plinthTop - 0.001, 256, 1, true).translate(0, (B + L.plinthTop) / 2, 0), skirtMat);
  skirt.castShadow = true; skirt.receiveShadow = true;
  skirt.position.set(L.cx, 0, L.cz);
  mesh.add(skirt);
  const skirtLip = new THREE.Mesh(new THREE.RingGeometry(0.703, 0.7166, 256, 1).rotateX(-Math.PI / 2).translate(0, B - 0.0004, 0), skirtMat);
  skirtLip.position.copy(skirt.position);
  mesh.add(skirtLip);

  // Spectrum halo (stationary, around the platter, just above the record plane)
  const ring = spectrumRing();
  ring.mesh.position.set(L.cx, T + 0.02, L.cz);
  mesh.add(ring.mesh);

  // ─ helpers
  const stylusAt = (yawA, out = new THREE.Vector2()) => {
    const vx = L.stylus.x - L.pivot.x, vz = L.stylus.y - L.pivot.z;
    const c = Math.cos(yawA), s = Math.sin(yawA);
    return out.set(L.pivot.x + vx * c + vz * s, L.pivot.z - vx * s + vz * c);
  };
  const radiusAt = y => { const p = stylusAt(y); return Math.hypot(p.x - L.cx, p.y - L.cz); };
  function yawFor(r) {
    // the arm sweeps monotonically near yaw 0; pick the root closest to 0
    let best = 0, bestErr = 1e9;
    for (let y = -0.9; y <= 0.9; y += 0.0015) { const e = Math.abs(radiusAt(y) - r); if (e < bestErr - 1e-9 || (Math.abs(e - bestErr) < 1e-6 && Math.abs(y) < Math.abs(best))) { bestErr = e; best = y; } }
    return best;
  }
  const restYaw = (() => { // off the record, toward the front-right
    let best = 0; for (let y = -0.9; y <= 0.9; y += 0.002) { const p = stylusAt(y); if (radiusAt(y) > 0.845 && p.x > L.cx && Math.abs(y) < Math.abs(best || 9)) best = y; }
    return best;
  })();
  const bandYaw = BANDS.map(b => yawFor(b.outer - 0.006));

  function setArm(yawA, liftA) {
    yaw.rotation.y = yawA;
    lift.quaternion.setFromAxisAngle(liftAxis, -liftA);
  }
  setArm(restYaw, 0.02);

  const _v = new THREE.Vector3();
  return {
    mesh, record, vinyl, label, labelMat, grooves, ring, arm: { yaw, lift, mesh: armMesh }, setArm, restYaw, bandYaw, yawFor, radiusAt,
    /** world-space centre of the record's top surface */
    center: (out = new THREE.Vector3()) => mesh.localToWorld(out.set(L.cx, T, L.cz)),
    toWorld: (x, y, z, out = new THREE.Vector3()) => mesh.localToWorld(out.set(x, y, z)),
    stylusWorld: (out = new THREE.Vector3()) => { armMesh.updateWorldMatrix(true, false); return armMesh.localToWorld(out.set(L.stylus.x, 0.18, L.stylus.y)); },
    radiusWorld: () => mesh.localToWorld(_v.set(L.cx + L.R, T, L.cz)).distanceTo(mesh.localToWorld(new THREE.Vector3(L.cx, T, L.cz))),
  };
}
