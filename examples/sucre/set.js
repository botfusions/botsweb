// The set: a pale pink marble counter against a panelled (boiserie) wall, lit through a tall shop window.
import { THREE } from '../../src/core/engine.js';
import { bakeTexture, fbmNormal } from '../../src/core/textures.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Units: 1 = 10 cm. Counter top is y = 0.
export const COUNTER = { x0: -16, x1: 24, z0: -3.6, z1: 4.6, thick: 0.62 };
export const WALL_Z = COUNTER.z0;

// Shared marble look (Rosa Portogallo-ish): long warped streaks of varying width, sparse hairlines, soft clouds.
// Written in linear space. Everything is periodic in uv so the slab tiles seamlessly.
const MARBLE_BODY = `
  vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
  // returns (cloud, vein, hairline)
  vec3 marble(vec2 p){
    vec2 w = vec2(fbm(p * 2.0, 2.0, 5, 0.5), fbm(p * 2.0 + vec2(5.2, 1.3), 2.0, 5, 0.5));
    vec2 q = p + w * 0.2;
    float s = fbm(q * 4.0, 4.0, 6, 0.55);
    float t = (q.x * 2.0 + q.y) * 2.0 + s * 1.3;
    float d = abs(fract(t) - 0.5);
    float width = 0.012 + 0.05 * smoothstep(0.0, 0.5, fbm(q * 3.0 + 9.1, 3.0, 4, 0.5) + 0.2);
    float amp = smoothstep(-0.25, 0.35, fbm(q * 2.0 + vec2(mod(floor(t), 2.0) * 0.5), 2.0, 4, 0.5));
    float vein = exp(-pow(d / width, 2.0)) * amp;
    vein += exp(-pow(d / (width * 5.0), 2.0)) * amp * 0.25;   // soft halo around each streak
    float f2 = fbm((q + vec2(s) * 0.1) * 6.0, 6.0, 5, 0.55);
    float hair = pow(1.0 - clamp(abs(f2) * 10.0, 0.0, 1.0), 22.0) * smoothstep(0.05, 0.4, fbm(q * 2.0 + 3.3, 2.0, 3, 0.5));
    float cloud = fbm(p * 2.0 + w * 0.6, 2.0, 5, 0.5);
    return vec3(cloud, clamp(vein, 0.0, 1.0), hair);
  }
`;

export function marbleTextures(renderer, size = 2048) {
  const map = bakeTexture(renderer, size, `${MARBLE_BODY}
    void main(){
      vec3 m = marble(vUv);
      vec3 base = mix(vec3(0.935, 0.895, 0.893), vec3(0.975, 0.955, 0.945), smoothstep(-0.3, 0.3, m.x));
      base = mix(base, vec3(0.95, 0.875, 0.88), smoothstep(0.05, 0.45, m.x) * 0.4);
      vec3 c = mix(base, vec3(0.74, 0.62, 0.64), m.y * 0.62);
      c = mix(c, vec3(0.66, 0.56, 0.58), m.z * 0.28);
      c *= 0.988 + fbm(vUv * 90.0, 90.0, 3, 0.5) * 0.025;
      gl_FragColor = vec4(lin(c), 1.0);
    }`);
  const rough = bakeTexture(renderer, 1024, `${MARBLE_BODY}
    void main(){
      vec3 m = marble(vUv);
      float smudge = fbm(vUv * 7.0, 7.0, 5, 0.5);
      float r = 0.1 + smoothstep(0.05, 0.45, smudge) * 0.12 + m.y * 0.08 + fbm(vUv * 60.0, 60.0, 3, 0.5) * 0.03;
      gl_FragColor = vec4(1.0, clamp(r, 0.05, 1.0), 0.0, 1.0);
    }`);
  return { map, rough };
}

/** Soft window cookie for the key light: six tall panes, fine mullions, a hint of foliage outside. */
export function windowCookie() {
  const S = 1024;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.filter = 'blur(10px)';
  const x0 = S * 0.1, x1 = S * 0.9, y0 = S * 0.04, y1 = S * 0.96;
  const cols = 4, rows = 5, mull = 12;
  const pw = (x1 - x0 - mull * (cols - 1)) / cols, ph = (y1 - y0 - mull * (rows - 1)) / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = x0 + i * (pw + mull), y = y0 + j * (ph + mull);
    const grd = g.createLinearGradient(x, y, x + pw, y + ph);
    grd.addColorStop(0, '#fff'); grd.addColorStop(1, '#f2ece4');
    g.fillStyle = grd;
    g.fillRect(x, y, pw, ph);
  }
  // Vignette the cookie so the pool of light falls off gently.
  g.filter = 'none';
  g.globalCompositeOperation = 'multiply';
  const v = g.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S * 0.62);
  v.addColorStop(0, '#fff'); v.addColorStop(1, '#222');
  g.fillStyle = v; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildSet(renderer, scene) {
  const group = new THREE.Group();
  scene.add(group);
  const W = COUNTER.x1 - COUNTER.x0, D = COUNTER.z1 - COUNTER.z0, cx = (COUNTER.x0 + COUNTER.x1) / 2, cz = (COUNTER.z0 + COUNTER.z1) / 2;

  // Marble counter top (a plane so it can carry the planar reflection) + slab edge with a bullnose.
  const { map, rough } = marbleTextures(renderer);
  const tile = 13;
  map.repeat.set(W / tile, D / tile); rough.repeat.set(W / tile, D / tile);
  const marble = new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 1, metalness: 0, envMapIntensity: 0.5 });
  const top = new THREE.Mesh(new THREE.PlaneGeometry(W, D), marble);
  top.rotation.x = -Math.PI / 2;
  top.position.set(cx, 0, cz);
  top.receiveShadow = true;
  group.add(top);

  const edgeMap = map.clone(); edgeMap.repeat.set(W / tile, 0.06); edgeMap.needsUpdate = true;
  const edgeMat = new THREE.MeshStandardMaterial({ map: edgeMap, roughness: 0.2, metalness: 0, envMapIntensity: 0.9, emissive: new THREE.Color(0xf3e4e2), emissiveIntensity: 0.34 });
  // Half cylinder (theta −90°..90° is the +z half), laid along x: the rounded front of the slab.
  const bull = new THREE.Mesh(new THREE.CylinderGeometry(COUNTER.thick / 2, COUNTER.thick / 2, W, 48, 1, true, -Math.PI / 2, Math.PI), edgeMat);
  bull.rotation.z = Math.PI / 2;
  bull.position.set(cx, -COUNTER.thick / 2, COUNTER.z1);
  bull.receiveShadow = true;
  group.add(bull);

  // Gold-leaf strip under the slab and a pistachio lacquered cabinet front.
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9b56e, metalness: 1, roughness: 0.28, envMapIntensity: 1.4 });
  const stripGold = new THREE.MeshStandardMaterial({ color: 0xe6c98c, metalness: 0.85, roughness: 0.35, envMapIntensity: 1.6, emissive: new THREE.Color(0xc9a664), emissiveIntensity: 0.35 });
  const strip = new THREE.Mesh(new RoundedBoxGeometry(W, 0.12, 0.14, 2, 0.03), stripGold);
  strip.position.set(cx, -COUNTER.thick - 0.07, COUNTER.z1 - 0.12);
  group.add(strip);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(W, 9, 0.3), new THREE.MeshStandardMaterial({ color: 0xf4ebe2, roughness: 0.5, envMapIntensity: 1.0, emissive: new THREE.Color(0xf1e2dc), emissiveIntensity: 0.5 }));
  cab.position.set(cx, -COUNTER.thick - 0.13 - 4.5, COUNTER.z1 - 0.2);
  cab.receiveShadow = true;
  group.add(cab);

  // Plaster wall with tone-on-tone boiserie.
  const plasterN = fbmNormal(renderer, { size: 512, scale: 6, octaves: 6, strength: 0.7 });
  plasterN.repeat.set(8, 4);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe6bcc4, roughness: 0.86, normalMap: plasterN, normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 0.55, vertexColors: true });
  // Light falls off toward the ceiling: bake a vertical gradient into vertex colours.
  const wallGeo = new THREE.PlaneGeometry(W + 20, 40, 1, 16);
  const wc = [], wp = wallGeo.getAttribute('position');
  for (let i = 0; i < wp.count; i++) { const y = wp.getY(i) + 18; const k = 1 - Math.min(1, Math.max(0, (y - 1) / 16)) ** 1.4 * 0.38; wc.push(k, k * 0.985, k * 0.985); }
  wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3));
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.set(cx, 18, WALL_Z);
  wall.receiveShadow = true;
  group.add(wall);

  const mould = new THREE.MeshStandardMaterial({ color: 0xecc6cd, roughness: 0.62, envMapIntensity: 0.7 });
  const mouldGold = new THREE.MeshStandardMaterial({ color: 0xe3c07a, metalness: 1, roughness: 0.32, envMapIntensity: 1.2 });
  const addFrame = (x, y, w, h, prof = 0.13, depth = 0.08) => {
    const geoH = new RoundedBoxGeometry(w, prof, depth, 2, 0.03), geoV = new RoundedBoxGeometry(prof, h, depth, 2, 0.03);
    for (const [gx, gy, geo] of [[x, y + h / 2, geoH], [x, y - h / 2, geoH], [x - w / 2, y, geoV], [x + w / 2, y, geoV]]) {
      const m = new THREE.Mesh(geo, mould);
      m.position.set(gx, gy, WALL_Z + depth / 2);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    }
    // Hairline of gold leaf inside the frame.
    const lh = new THREE.BoxGeometry(w - 0.34, 0.018, 0.012), lv = new THREE.BoxGeometry(0.018, h - 0.34, 0.012);
    for (const [gx, gy, geo] of [[x, y + h / 2 - 0.17, lh], [x, y - h / 2 + 0.17, lh], [x - w / 2 + 0.17, y, lv], [x + w / 2 - 0.17, y, lv]]) {
      const m = new THREE.Mesh(geo, mouldGold);
      m.position.set(gx, gy, WALL_Z + 0.01);
      group.add(m);
    }
  };
  const panelW = 5.2, gap = 0.9;
  for (let x = -14.6; x < 26; x += panelW + gap) {
    addFrame(x, 5.2, panelW, 7.6);
    addFrame(x, 12.4, panelW, 4.4);
  }
  // Dado rail just above the counter and a cornice line.
  for (const [y, h, d] of [[0.55, 0.22, 0.12], [15.4, 0.34, 0.2]]) {
    const r = new THREE.Mesh(new RoundedBoxGeometry(W + 20, h, d, 2, 0.04), mould);
    r.position.set(cx, y, WALL_Z + d / 2);
    r.castShadow = true; r.receiveShadow = true;
    group.add(r);
  }

  return { group, top, marble, wallMat, gold };
}
