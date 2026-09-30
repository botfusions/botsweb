// The sun-path diagram drawn in 3D around the diorama: horizon ring, compass, three seasonal arcs,
// hour marks, and the sun itself — the handle the visitor drags.
import * as THREE from 'three';
import { DECS } from './sun.js';

const D = Math.PI / 180;
export const RH = 4.0, RV = 3.1;

function textSprite(text, { size = 0.2, weight = 500, font = '"IBM Plex Mono", ui-monospace, monospace', track = 1 } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const px = 64;
  g.font = `${weight} ${px}px ${font}`;
  const w = Math.ceil(g.measureText(text).width + text.length * track * 4 + 16);
  c.width = w; c.height = px + 20;
  g.font = `${weight} ${px}px ${font}`;
  g.fillStyle = '#fff'; g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = `${track * 4}px`;
  g.fillText(text, 8, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false });
  const s = new THREE.Sprite(m);
  s.scale.set(size * c.width / c.height, size, 1);
  s.userData.baseOpacity = 1;
  return s;
}

function radial(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function ringTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.lineWidth = 5;
  g.beginPath(); g.arc(128, 128, 118, 0, Math.PI * 2); g.stroke();
  // four grip ticks
  g.lineWidth = 7;
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.beginPath(); g.moveTo(128 + Math.cos(a) * 96, 128 + Math.sin(a) * 96); g.lineTo(128 + Math.cos(a) * 110, 128 + Math.sin(a) * 110); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildDiagram({ scene, center, sunAngles, compassDir, T0, T1 }) {
  const group = new THREE.Group();
  group.position.copy(center);
  scene.add(group);
  const lineMats = [], hiddenMats = [], sprites = [], accentMats = [];
  const tmp = new THREE.Vector3();

  const mkLine = (pts, { opacity = 0.5, dashed = false, hidden = 0.22, accent = false, loop = false } = {}) => {
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const P = dashed ? THREE.LineDashedMaterial : THREE.LineBasicMaterial;
    const opts = { color: 0x111111, transparent: true, opacity, depthWrite: false, fog: false, ...(dashed ? { dashSize: 0.07, gapSize: 0.09 } : {}) };
    const m = new P(opts); m.userData.base = opacity;
    const L = loop ? THREE.LineLoop : THREE.Line;
    const line = new L(geo, m);
    if (dashed) line.computeLineDistances();
    line.renderOrder = 5;
    group.add(line);
    (accent ? accentMats : lineMats).push(m);
    if (hidden > 0) {
      const hm = new P({ ...opts, depthTest: false, opacity: opacity * hidden }); hm.userData.base = opacity * hidden;
      const hl = new L(geo, hm); if (dashed) hl.computeLineDistances(); hl.renderOrder = 4;
      group.add(hl);
      (accent ? accentMats : hiddenMats).push(hm);
    }
    return line;
  };
  const pos = (t, dec, out = new THREE.Vector3()) => {
    const { alt, az } = sunAngles(t, dec);
    compassDir(az, alt, out);
    return out.set(out.x * RH, out.y * RV, out.z * RH);
  };

  // Horizon ring and compass.
  const ring = [];
  for (let i = 0; i < 256; i++) { const a = i / 256 * Math.PI * 2; ring.push(new THREE.Vector3(Math.cos(a) * RH, 0, Math.sin(a) * RH)); }
  mkLine(ring, { opacity: 0.42, loop: true, hidden: 0.3 });
  const tick = [];
  for (let d = 0; d < 360; d += 5) {
    const len = d % 90 === 0 ? 0.36 : d % 30 === 0 ? 0.2 : 0.08;
    const a = compassDir(d * D, 0, new THREE.Vector3());
    tick.push(a.clone().multiplyScalar(RH), a.clone().multiplyScalar(RH + len));
  }
  {
    const geo = new THREE.BufferGeometry().setFromPoints(tick);
    const m = new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.5, depthWrite: false, fog: false }); m.userData.base = 0.5;
    const l = new THREE.LineSegments(geo, m); l.renderOrder = 5; group.add(l); lineMats.push(m);
  }
  for (const [d, s] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
    const sp = textSprite(s, { size: 0.34, weight: 500, font: '"Inter Tight", Arial, sans-serif', track: 0 });
    sp.position.copy(compassDir(d * D, 0, new THREE.Vector3()).multiplyScalar(RH - 0.42)).add(new THREE.Vector3(0, 0.02, 0));
    group.add(sp); sprites.push(sp);
  }
  // Facade bearing: the pool terrace faces 240°.
  {
    const a = compassDir(240 * D, 0, new THREE.Vector3());
    mkLine([a.clone().multiplyScalar(2.3), a.clone().multiplyScalar(RH + 0.5)], { opacity: 0.9, hidden: 0, accent: true });
    const sp = textSprite('240° FACADE', { size: 0.17 });
    sp.position.copy(a.clone().multiplyScalar(RH + 0.62)).add(new THREE.Vector3(0, 0.16, 0));
    sp.userData.accent = true;
    group.add(sp); sprites.push(sp);
  }

  // Seasonal arcs.
  const arcAbove = (dec, a, b) => { const pts = []; for (let t = a; t <= b + 1e-6; t += 1 / 30) { const p = pos(t, dec); if (p.y >= -1e-4) pts.push(p); } return pts; };
  const arcBelow = (dec, a, b) => { const pts = []; for (let t = a; t <= b + 1e-6; t += 1 / 30) pts.push(pos(t, dec)); return pts; };
  mkLine(arcAbove(DECS.equinox, 4, 23), { opacity: 0.2, hidden: 0.25 });
  mkLine(arcAbove(DECS.dec, 4, 23), { opacity: 0.16, hidden: 0.25 });
  // Solstice: solid above the horizon, dashed below (the handle keeps travelling into the night).
  const sol = arcBelow(DECS.jun, T0, T1);
  mkLine(sol.filter(p => p.y >= 0), { opacity: 0.62, hidden: 0.25 });
  const pre = sol.filter((p, i) => p.y < 0 && i < sol.length / 2), post = sol.filter((p, i) => p.y < 0 && i > sol.length / 2);
  if (pre.length > 1) mkLine(pre, { opacity: 0.38, dashed: true, hidden: 0.2 });
  if (post.length > 1) mkLine(post, { opacity: 0.38, dashed: true, hidden: 0.2 });
  // Date labels sit where each path clears 19° in the east, away from the house.
  for (const [dec, s] of [[DECS.jun, '21 JUN'], [DECS.equinox, '21 MAR · 23 SEP'], [DECS.dec, '21 DEC']]) {
    let t = 4; while (t < 13 && sunAngles(t, dec).alt < 19 * D) t += 1 / 60;
    const sp = textSprite(s, { size: 0.15 });
    const p = pos(t, dec);
    sp.position.copy(p).add(p.clone().setY(0).normalize().multiplyScalar(0.2)).add(new THREE.Vector3(0, 0.16, 0));
    sp.userData.baseOpacity = 0.7;
    group.add(sp); sprites.push(sp);
  }
  // Hour marks along the solstice path.
  const dots = [];
  for (let h = 6; h <= 22; h++) {
    const p = pos(h, DECS.jun);
    dots.push(p.x, p.y, p.z);
    if (h % 3 === 0) {
      const sp = textSprite(String(h).padStart(2, '0'), { size: 0.17 });
      const out = p.clone().setY(0).normalize().multiplyScalar(0.34);
      sp.position.copy(p).add(out).add(new THREE.Vector3(0, 0.12, 0));
      sp.userData.baseOpacity = 0.85;
      group.add(sp); sprites.push(sp);
    }
  }
  const dotGeo = new THREE.BufferGeometry(); dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3));
  const dotMat = new THREE.PointsMaterial({ color: 0x111111, size: 5, sizeAttenuation: false, map: radial([[0, '#fff'], [0.55, '#fff'], [0.7, 'rgba(255,255,255,0)']]), transparent: true, depthWrite: false, fog: false });
  dotMat.userData.base = 0.9;
  const dotPts = new THREE.Points(dotGeo, dotMat); dotPts.renderOrder = 6; group.add(dotPts); lineMats.push(dotMat);

  // Altitude / azimuth construction lines from the sun.
  const dropGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
  const dropMat = new THREE.LineDashedMaterial({ color: 0xe88c2c, transparent: true, opacity: 0.8, depthWrite: false, depthTest: false, fog: false, dashSize: 0.06, gapSize: 0.06 });
  const drop = new THREE.LineSegments(dropGeo, dropMat); drop.renderOrder = 7; group.add(drop);

  // The sun handle.
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial([[0, 'rgba(255,255,255,.9)'], [0.18, 'rgba(255,255,255,.35)'], [0.5, 'rgba(255,255,255,.07)'], [1, 'rgba(255,255,255,0)']]),
    transparent: true, depthWrite: false, depthTest: false, fog: false, blending: THREE.AdditiveBlending }));
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial([[0, '#fff'], [0.62, '#fff'], [0.78, 'rgba(255,255,255,0)']]), transparent: true, depthWrite: false, depthTest: false, fog: false }));
  const grip = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex(), transparent: true, depthWrite: false, depthTest: false, fog: false }));
  glow.renderOrder = 8; core.renderOrder = 10; grip.renderOrder = 9;
  const handle = new THREE.Group();
  handle.add(glow, core, grip);
  group.add(handle);

  const ink = new THREE.Color(), inkDay = new THREE.Color('#161614'), inkNight = new THREE.Color('#e6e6e2'), accent = new THREE.Color('#e88c2c');
  return {
    group,
    handlePos(t, out = new THREE.Vector3()) { return pos(t, DECS.jun, out).add(center); },
    update({ clockT, altDeg, opacity, ink: inkK, sunColor, t, camera, hot = 0 }) {
      group.visible = opacity > 0.01;
      ink.copy(inkDay).lerp(inkNight, inkK);
      for (const m of lineMats) { m.color.copy(ink); m.opacity = m.userData.base * opacity; }
      for (const m of hiddenMats) { m.color.copy(ink); m.opacity = m.userData.base * opacity; }
      for (const m of accentMats) { m.color.copy(accent); m.opacity = m.userData.base * opacity; }
      for (const s of sprites) {
        s.material.color.copy(s.userData.accent ? accent : ink);
        // Labels that would be cropped by the viewport edge fade out instead.
        tmp.copy(s.position).add(group.position).project(camera);
        const edge = (1 - THREE.MathUtils.smoothstep(Math.abs(tmp.x), 0.84, 0.95)) * (1 - THREE.MathUtils.smoothstep(Math.abs(tmp.y), 0.84, 0.96));
        s.material.opacity = s.userData.baseOpacity * opacity * opacity * edge;
      }
      const p = pos(clockT, DECS.jun, tmp);
      handle.position.copy(p);
      const up = THREE.MathUtils.smoothstep(altDeg, -3, 1);
      const pulse = 1 + Math.sin(t * 2.4) * 0.06;
      core.scale.setScalar(0.34 + up * 0.08);
      core.material.color.copy(accent).multiplyScalar(0.55 + up * 0.75).lerp(ink, (1 - up) * 0.6);
      core.material.opacity = Math.max(opacity, 0.35);
      glow.scale.setScalar((1.7 + up * 1.4) * pulse);
      glow.material.color.copy(sunColor).lerp(accent, 0.5).multiplyScalar(0.75 * up);
      glow.material.opacity = Math.max(opacity, 0.35);
      grip.scale.setScalar((0.82 + hot * 0.2) * (1 + Math.sin(t * 2.4 + 1) * 0.04));
      grip.material.color.copy(ink);
      grip.material.opacity = Math.max(opacity, 0.35) * 0.75;
      const a = dropGeo.attributes.position;
      a.setXYZ(0, p.x, p.y, p.z); a.setXYZ(1, p.x, 0, p.z); a.setXYZ(2, 0, 0, 0); a.setXYZ(3, p.x, 0, p.z);
      a.needsUpdate = true; drop.computeLineDistances();
      dropMat.opacity = 0.85 * opacity;
    },
  };
}
