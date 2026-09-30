// The Zephyrine: a procedural storybook airship — striped lathe envelope, tail fins, a timber gondola with
// lit windows, rigging, twin propellers and a pennant. Forward is +Z.
import { THREE } from '../../src/core/engine.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { patchAtmosphere } from './sky.js';

function envelopeTexture({ a = '#f7eedf', b = '#f2a484', name: title = 'ZEPHYRINE' } = {}) {
  const W = 2048, H = 1024;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const gores = 16;
  for (let i = 0; i < gores; i++) {
    g.fillStyle = i % 2 ? b : a;
    g.fillRect((i / gores) * W, 0, W / gores + 1, H);
  }
  // seams
  g.globalAlpha = 0.35; g.fillStyle = '#9a6a52';
  for (let i = 0; i <= gores; i++) g.fillRect((i / gores) * W - 1.5, 0, 3, H);
  // hoops along the length
  g.globalAlpha = 0.18;
  for (let j = 1; j < 14; j++) g.fillRect(0, (j / 14) * H - 1, W, 2);
  g.globalAlpha = 1;
  // navy belly band, nose and tail caps
  g.fillStyle = '#28365a';
  g.fillRect(0, H * 0.965, W, H * 0.04);
  g.fillRect(0, 0, W, H * 0.03);
  g.fillStyle = '#e9c07a';
  g.fillRect(0, H * 0.955, W, H * 0.01);
  g.fillRect(0, H * 0.03, W, H * 0.008);
  // name on both flanks
  const name = (u, flip) => {
    g.save();
    g.translate(u * W, H * 0.52);
    g.rotate(flip ? Math.PI / 2 : -Math.PI / 2);
    g.fillStyle = 'rgba(247,238,223,.96)';
    g.beginPath(); g.roundRect(-300, -62, 600, 124, 62); g.fill();
    g.strokeStyle = '#28365a'; g.lineWidth = 5; g.stroke();
    g.fillStyle = '#28365a';
    g.font = '64px "Young Serif", Georgia, serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(title, 0, 4);
    g.restore();
  };
  name(0.25, true); name(0.75, false);
  // painterly grain
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function woodTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#8a5a36'; g.fillRect(0, 0, 512, 256);
  for (let j = 0; j < 8; j++) {
    g.fillStyle = `hsl(${24 + Math.random() * 6}, ${38 + Math.random() * 10}%, ${30 + Math.random() * 10}%)`;
    g.fillRect(0, j * 32 + 1, 512, 30);
    g.fillStyle = 'rgba(40,22,10,.55)'; g.fillRect(0, j * 32, 512, 2);
    for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(255,220,180,${Math.random() * 0.06})`; g.fillRect(Math.random() * 512, j * 32 + Math.random() * 30, 40 + Math.random() * 120, 1); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildAirship(pal = {}) {
  const ship = new THREE.Group();
  const body = new THREE.Group(); // bobs and pitches inside the ship frame
  ship.add(body);
  const L = 6.4, R = 1.15;
  const std = (o) => { const m = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0, envMapIntensity: 0.5, ...o }); patchAtmosphere(m); return m; };

  // Envelope
  const pts = [];
  const N = 72;
  for (let j = 0; j <= N; j++) {
    const t = j / N;
    const r = R * Math.pow(Math.sin(Math.PI * Math.pow(t, 1.35)), 0.62);
    pts.push(new THREE.Vector2(Math.max(r, 0.0001), (t - 0.5) * L));
  }
  const envGeo = new THREE.LatheGeometry(pts, 64);
  envGeo.rotateX(Math.PI / 2);
  const envMat = std({ map: envelopeTexture(pal), roughness: 0.62 });
  const envelope = new THREE.Mesh(envGeo, envMat);
  envelope.castShadow = envelope.receiveShadow = true;
  body.add(envelope);

  // Tail fins (cross)
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0); finShape.lineTo(1.35, 0); finShape.quadraticCurveTo(1.25, 0.6, 1.05, 1.05); finShape.lineTo(0.45, 1.0); finShape.quadraticCurveTo(0.2, 0.5, 0, 0);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 10 });
  finGeo.translate(0, 0, -0.025);
  const finMat = std({ color: pal.fin ?? '#e9866a', roughness: 0.6 });
  const trimMat = std({ color: '#28365a', roughness: 0.55 });
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Mesh(finGeo, k % 2 ? finMat : trimMat);
    const holder = new THREE.Group();
    holder.rotation.z = k * Math.PI / 2;
    fin.rotation.y = Math.PI / 2;           // shape x → -z (backwards along the hull)
    fin.position.set(0, R * 0.34, -L * 0.36);
    fin.scale.setScalar(1.05);
    fin.castShadow = true;
    holder.add(fin);
    body.add(holder);
  }

  // Gondola
  const wood = woodTexture();
  const gondY = -R - 0.62;
  const hull = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.52, 2.3, 4, 0.16), std({ map: wood, roughness: 0.8 }));
  hull.position.set(0, gondY, 0.15);
  hull.castShadow = hull.receiveShadow = true;
  body.add(hull);
  const keel = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.22, 2.0, 3, 0.1), std({ map: wood, color: '#b98a66' }));
  keel.position.set(0, gondY - 0.3, 0.15);
  body.add(keel);
  const roof = new THREE.Mesh(new RoundedBoxGeometry(1.08, 0.08, 2.44, 2, 0.035), trimMat);
  roof.position.set(0, gondY + 0.3, 0.15);
  roof.castShadow = true;
  body.add(roof);
  const brass = std({ color: '#e0b36a', metalness: 0.85, roughness: 0.35, envMapIntensity: 1.2 });
  const winMat = new THREE.MeshStandardMaterial({ color: '#2c1e10', emissive: '#ffc27a', emissiveIntensity: 2.2, roughness: 0.3 });
  patchAtmosphere(winMat);
  const winGeo = new THREE.BoxGeometry(0.02, 0.17, 0.2);
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) {
    const w = new THREE.Mesh(winGeo, winMat);
    w.position.set(s * 0.482, gondY + 0.06, -0.72 + i * 0.3);
    body.add(w);
  }
  const bowLamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd49a').multiplyScalar(6) }));
  bowLamp.position.set(0, gondY + 0.05, 1.36);
  body.add(bowLamp);

  // Rigging
  const rigMat = std({ color: '#3b2f28', roughness: 0.9 });
  const rigGeo = new THREE.CylinderGeometry(0.01, 0.01, 1, 4, 1, true);
  const up = new THREE.Vector3(0, 1, 0);
  const addRig = (a, b) => {
    const m = new THREE.Mesh(rigGeo, rigMat);
    const d = new THREE.Vector3().subVectors(b, a);
    m.scale.y = d.length();
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(up, d.normalize());
    body.add(m);
  };
  for (const s of [-1, 1]) for (const z of [-0.9, 0.2, 1.2]) {
    addRig(new THREE.Vector3(s * 0.46, gondY + 0.32, z), new THREE.Vector3(s * R * 0.55, -R * 0.83, z * 1.35));
    addRig(new THREE.Vector3(s * 0.46, gondY + 0.32, z), new THREE.Vector3(s * R * 0.2, -R * 0.97, z * 1.35 + 0.5));
  }

  // Propellers on outrigger struts
  const props = [];
  const bladeGeo = new RoundedBoxGeometry(0.1, 0.62, 0.025, 2, 0.012);
  bladeGeo.translate(0, 0.3, 0);
  for (const s of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), brass);
    strut.rotation.z = Math.PI / 2;
    strut.position.set(s * 0.9, gondY + 0.05, -0.85);
    body.add(strut);
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.3, 4, 10), trimMat);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(s * 1.35, gondY + 0.05, -0.85);
    body.add(pod);
    const hub = new THREE.Group();
    hub.position.set(s * 1.35, gondY + 0.05, -1.12);
    for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(bladeGeo, brass); b.rotation.z = k * Math.PI * 2 / 3; hub.add(b); }
    body.add(hub);
    props.push(hub);
  }

  // Pennant flying from the top fin
  const flagGeo = new THREE.PlaneGeometry(1.1, 0.26, 16, 1);
  flagGeo.translate(-0.55, 0, 0);
  const flagBase = flagGeo.attributes.position.array.slice();
  const flag = new THREE.Mesh(flagGeo, std({ color: '#f07f5f', side: THREE.DoubleSide, roughness: 0.8 }));
  flag.rotation.y = Math.PI / 2;
  flag.position.set(0, R * 0.34 + 1.12, -L * 0.36 - 1.1);
  body.add(flag);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 5), brass);
  mast.position.set(0, R * 0.34 + 1.0, -L * 0.36 - 1.1);
  body.add(mast);

  ship.traverse(o => { if (o.isMesh) { o.layers.enable(1); } });

  ship.userData.update = (dt, t) => {
    for (const p of props) p.rotation.z += dt * 14;
    body.position.y = Math.sin(t * 0.7) * 0.12;
    body.rotation.x = Math.sin(t * 0.5) * 0.02;
    const a = flag.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const x = flagBase[i * 3];
      a.array[i * 3 + 2] = Math.sin(x * 5 + t * 7) * 0.08 * (-x);
      a.array[i * 3 + 1] = flagBase[i * 3 + 1] * (1 + x * 0.35);
    }
    a.needsUpdate = true;
  };
  ship.userData.length = L;
  ship.userData.refreshName = () => { const old = envMat.map; envMat.map = envelopeTexture(pal); envMat.needsUpdate = true; old.dispose(); };
  return ship;
}
