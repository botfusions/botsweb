// The outpost at the end of the traverse: the Meshy lander, a regolith-shielded habitat, a vertical solar mast
// that turns to follow the low sun, and orange trail beacons along the walk.
import { THREE, normalize, prepModel } from '../../src/core/engine.js';
import { fbmNormal } from '../../src/core/textures.js';
import { LAYOUT } from './terrain.js';

export function paintedMetalFix(mat) {
  // Meshy marks the white cabin panels as metal; treat bright, unsaturated texels as painted aluminium.
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      float pLum = dot(diffuseColor.rgb, vec3(0.333));
      float pSat = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
      float paint = smoothstep(0.32, 0.6, pLum) * (1.0 - smoothstep(0.05, 0.14, pSat));
      roughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.55), paint);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      metalnessFactor *= 1.0 - paint * 0.93;`);
  };
  mat.customProgramCacheKey = () => 'painted-metal';
}

export async function buildOutpost({ assets, renderer, H, scene }) {
  const group = new THREE.Group();
  scene.add(group);
  const L = LAYOUT.lander;
  const g = await assets.gltf('models/artemis/lander.glb');
  const lander = g.scene;
  normalize(lander, 6.6, { axis: 'y' });
  prepModel(lander, renderer, { env: 1.0, onMat: m => paintedMetalFix(m) });
  const lg = new THREE.Group();
  lg.add(lander);
  lg.position.set(L.x, H.heightAt(L.x, L.z) - 0.04, L.z);
  lg.rotation.y = L.yaw;
  group.add(lg);

  const white = new THREE.MeshStandardMaterial({ color: 0xd8d6d0, roughness: 0.72, metalness: 0, normalMap: fbmNormal(renderer, { size: 512, scale: 12, octaves: 5, strength: 0.6 }) });
  white.normalMap.repeat.set(4, 2);
  const band = new THREE.MeshStandardMaterial({ color: 0x9a9892, roughness: 0.5, metalness: 0.6 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xff5a14, roughness: 0.45, metalness: 0, emissive: 0xff4a0a, emissiveIntensity: 0.08 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.6, metalness: 0.5 });

  // Habitat: a long pressurised can on low legs, with shielding bands and a suitport end.
  {
    const hb = LAYOUT.hab;
    const hab = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.9, 6.4, 16, 48).rotateZ(Math.PI / 2), white);
    body.position.y = 2.35;
    hab.add(body);
    for (let i = -3; i <= 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1.93, 0.05, 8, 64).rotateY(Math.PI / 2), band);
      r.position.set(i * 1.05, 2.35, 0); hab.add(r);
    }
    for (const s of [-1, 1]) for (const e of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.2, 10), band);
      leg.position.set(e * 2.6, 0.6, s * 1.25); hab.add(leg);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.06, 20), band);
      pad.position.set(e * 2.6, 0.03, s * 1.25); hab.add(pad);
    }
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.35, 32).rotateZ(Math.PI / 2), dark);
    port.position.set(-5.1, 2.2, 0); hab.add(port);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.05, 10, 40).rotateY(Math.PI / 2), orange);
    ring.position.set(-5.28, 2.2, 0); hab.add(ring);
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.28, 32), new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.05, metalness: 0.9 }));
    win.position.set(1.2, 3.1, 1.86); win.rotation.x = -0.35; hab.add(win);
    hab.position.set(hb.x, H.heightAt(hb.x, hb.z), hb.z);
    hab.rotation.y = 0.5;
    hab.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(hab);
  }

  // Vertical solar array mast: truss + two rolled-out wings, yawed to face the sun.
  let wings;
  {
    const ms = LAYOUT.mast;
    const mast = new THREE.Group();
    const h = 15;
    const strut = new THREE.CylinderGeometry(0.035, 0.035, h, 6);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const s = new THREE.Mesh(strut, band); s.position.set(Math.cos(a) * 0.28, h / 2, Math.sin(a) * 0.28); mast.add(s);
    }
    for (let y = 0.5; y < h; y += 0.7) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.018, 4, 3).rotateX(Math.PI / 2), band); r.position.y = y; mast.add(r);
    }
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.5, 6), white); base.position.y = 0.25; mast.add(base);
    const c = document.createElement('canvas'); c.width = 256; c.height = 1024;
    const cx = c.getContext('2d');
    cx.fillStyle = '#0a1226'; cx.fillRect(0, 0, 256, 1024);
    cx.strokeStyle = '#7a8090'; cx.lineWidth = 1.2;
    for (let x = 0; x <= 256; x += 32) { cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x, 1024); cx.stroke(); }
    for (let y = 0; y <= 1024; y += 32) { cx.beginPath(); cx.moveTo(0, y); cx.lineTo(256, y); cx.stroke(); }
    cx.strokeStyle = '#c9a15a'; cx.lineWidth = 6; cx.strokeRect(3, 3, 250, 1018);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const cell = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0, envMapIntensity: 0.12 });
    wings = new THREE.Group();
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(2.6, 8.5, 0.05), cell);
      w.position.set(s * 1.75, h - 5.2, 0); wings.add(w);
    }
    const boom = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.1, 0.1), band); boom.position.y = h - 0.9; wings.add(boom);
    const boom2 = boom.clone(); boom2.position.y = h - 9.5; wings.add(boom2);
    mast.add(wings);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), orange); tip.position.y = h + 0.1; mast.add(tip);
    mast.position.set(ms.x, H.heightAt(ms.x, ms.z), ms.z);
    mast.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(mast);
  }

  // Trail beacons: thin white poles with retro-reflective orange caps, alternating sides of the path.
  {
    const n = 7;
    const poleGeo = new THREE.CylinderGeometry(0.012, 0.016, 1.15, 6).translate(0, 0.575, 0);
    const capGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.11, 12).translate(0, 1.2, 0);
    const poles = new THREE.InstancedMesh(poleGeo, band, n), caps = new THREE.InstancedMesh(capGeo, orange, n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const u = (i + 0.6) / (n + 0.4);
      const p = H.curve.getPointAt(u), t = H.curve.getTangentAt(u);
      const s = i % 2 ? 1 : -1;
      const x = p.x - t.z * 2.9 * s, z = p.z + t.x * 2.9 * s;
      m.makeRotationY(i * 1.3).setPosition(x, H.heightAt(x, z) - 0.05, z);
      poles.setMatrixAt(i, m); caps.setMatrixAt(i, m);
    }
    for (const im of [poles, caps]) { im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); group.add(im); }
  }

  const trackSun = toSun => { wings.rotation.y = Math.atan2(toSun.x, toSun.z); };
  return { group, lander: lg, trackSun, center: new THREE.Vector3(L.x, lg.position.y, L.z) };
}
