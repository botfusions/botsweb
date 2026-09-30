// The listening bar: back counter, record wall, neon, valve amp, counter + twelve stools, pendants.
import { THREE } from '../../src/core/engine.js';
import { bakeTexture, fbmNormal } from '../../src/core/textures.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const WALL_Z = -0.42;          // face of the record shelves
export const FLOOR_Y = -0.95;
export const CEIL_Y = 2.45;

function rng(seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ─── Procedural surfaces ──────────────────────────────────────────────────────
function woodTextures(renderer, { dark = 1, size = 1024, stretch = 14 } = {}) {
  const albedo = bakeTexture(renderer, size, `
    void main(){
      vec2 p = vUv;
      float warp = fbm(p * vec2(3.0, 0.6), 3.0, 4, 0.5) * 0.35;
      float rings = fbm(vec2(p.x * 2.0 + warp, p.y * ${stretch.toFixed(1)}), 2.0, 5, 0.55);
      float grain = fbm(vec2(p.x * 60.0, p.y * 1.5 + warp * 4.0), 60.0, 4, 0.5);
      float fig = sin((p.y * 40.0 + rings * 9.0 + warp * 14.0)) * 0.5 + 0.5;
      vec3 a = vec3(0.105, 0.052, 0.030), b = vec3(0.19, 0.098, 0.052);
      vec3 col = mix(a, b, smoothstep(0.1, 0.9, fig * 0.6 + rings * 0.7 + 0.2));
      col *= 0.8 + grain * 0.45;
      gl_FragColor = vec4(col * ${dark.toFixed(2)}, 1.0);
    }`);
  const rough = bakeTexture(renderer, 512, `
    void main(){ float g = fbm(vec2(vUv.x * 50.0, vUv.y * 2.0), 50.0, 4, 0.5); float w = fbm(vUv * 4.0, 4.0, 4, 0.5);
      gl_FragColor = vec4(1.0, clamp(0.2 + g * 0.1 + w * 0.12, 0.05, 1.0), 0.0, 1.0); }`);
  return { albedo, rough };
}

// ─── Spines atlas ─────────────────────────────────────────────────────────────
const SPINE_COLS = ['#141214', '#1b1a1d', '#e9e1d2', '#d8cfbd', '#2a2833', '#7d2c28', '#b98b35', '#20283f', '#233a2d', '#6a4f38', '#3b2f4f', '#a78bfa', '#cf6a2e', '#4d5a64', '#e7d6a9', '#5b1f34', '#0f0f10', '#c9c2b4'];
const WORDS = ['NIGHT', 'COUNTER', 'SOLAR', 'BLUE', 'HOURS', 'KYOTO', 'TRIO', 'QUARTET', 'SESSIONS', 'SIDE B', 'LIVE AT', 'NOCTURNE', 'RAIN', 'MOOD', 'SHIBUYA', 'DAWN', 'VALVE', 'ECHO', 'SLOW', 'ROOM', 'SUITE', 'STEREO', 'MONO', 'AFTER', 'DUSK', 'TIDE', 'PULSE', 'HUSH', 'NEON', 'CRATE'];
function spineAtlas(renderer, R) {
  const cols = 64, W = 2048, H = 1024, sw = W / cols;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  for (let i = 0; i < cols; i++) {
    const x = i * sw;
    const col = SPINE_COLS[Math.floor(R() * SPINE_COLS.length)];
    g.fillStyle = col; g.fillRect(x, 0, sw, H);
    const light = parseInt(col.slice(1, 3), 16) > 150;
    const ink = light ? 'rgba(20,16,20,.85)' : R() < 0.3 ? 'rgba(235,190,110,.85)' : 'rgba(240,232,220,.8)';
    // bands
    if (R() < 0.5) { g.fillStyle = SPINE_COLS[Math.floor(R() * SPINE_COLS.length)]; const y = R() * H; g.fillRect(x, y, sw, 30 + R() * 160); }
    if (R() < 0.35) { g.fillStyle = ink; g.fillRect(x + 3, 40 + R() * 40, sw - 6, 3); }
    // vertical text
    g.save(); g.translate(x + sw / 2, H - 30 - R() * 80); g.rotate(-Math.PI / 2);
    g.fillStyle = ink; g.textBaseline = 'middle';
    g.font = `${R() < 0.5 ? 700 : 400} ${13 + Math.floor(R() * 7)}px "Space Mono", monospace`;
    const t = `${WORDS[Math.floor(R() * WORDS.length)]} ${R() < 0.5 ? WORDS[Math.floor(R() * WORDS.length)] : ''}`;
    g.fillText(t, 0, 0);
    g.font = '400 11px "Space Mono", monospace';
    g.fillText(`${['LF', 'BN', 'TR', 'ECM', 'NS', 'CTI'][Math.floor(R() * 6)]}-${Math.floor(100 + R() * 900)}`, H * 0.55 + R() * 200, 0);
    g.restore();
    // wear
    g.fillStyle = `rgba(255,255,255,${R() * 0.06})`; g.fillRect(x, 0, 1, H);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + sw - 1, 0, 1, H);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return { tex: t, cols };
}

// ─── Neon ─────────────────────────────────────────────────────────────────────
function neonTexture(text, { font = '"M PLUS Rounded 1c", "Zen Kaku Gothic New", sans-serif', vertical = true, size = 300 } = {}) {
  const chars = [...text];
  const W = vertical ? 420 : 1600, H = vertical ? 420 * chars.length + 80 : 420;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `400 ${size}px ${font}`;
  g.fillStyle = '#fff';
  g.shadowColor = '#fff'; g.shadowBlur = 6;
  if (vertical) chars.forEach((ch, i) => g.fillText(ch, W / 2, 40 + 420 * i + 210));
  else g.fillText(text, W / 2, H / 2);
  const t = new THREE.CanvasTexture(c);
  // halo copy
  const h = document.createElement('canvas'); h.width = W / 4; h.height = H / 4;
  const hg = h.getContext('2d'); hg.filter = 'blur(10px)'; hg.drawImage(c, 0, 0, W / 4, H / 4); hg.filter = 'blur(4px)'; hg.drawImage(c, 0, 0, W / 4, H / 4);
  const ht = new THREE.CanvasTexture(h);
  return { tex: t, halo: ht, aspect: W / H };
}

// ─── Build ────────────────────────────────────────────────────────────────────
export function buildRoom(renderer, scene, { covers }) {
  const R = rng(7);
  const out = { tubes: [], pendants: [], animated: [] };
  const aniso = renderer.capabilities.getMaxAnisotropy();

  // Materials
  const wood = woodTextures(renderer, { dark: 1 });
  const woodDark = woodTextures(renderer, { dark: 0.55, stretch: 8 });
  for (const t of [wood.albedo, wood.rough, woodDark.albedo, woodDark.rough]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; }
  const counterTop = new THREE.MeshPhysicalMaterial({ map: wood.albedo, roughnessMap: wood.rough, roughness: 0.55, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.5 });
  counterTop.map.repeat.set(3, 1);
  const counterSide = new THREE.MeshStandardMaterial({ map: woodDark.albedo, roughnessMap: woodDark.rough, roughness: 0.9, envMapIntensity: 0.3 });
  const shelfMat = new THREE.MeshStandardMaterial({ map: woodDark.albedo, roughness: 0.75, envMapIntensity: 0.3, color: 0x9a8a80 });
  const plasterN = fbmNormal(renderer, { size: 512, scale: 6, octaves: 6, strength: 1.2 });
  plasterN.wrapS = plasterN.wrapT = THREE.RepeatWrapping; plasterN.repeat.set(6, 3);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1220, roughness: 0.95, normalMap: plasterN, normalScale: new THREE.Vector2(0.6, 0.6) });
  const floorTex = woodTextures(renderer, { dark: 0.4, stretch: 20 });
  for (const t of [floorTex.albedo, floorTex.rough]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 2); t.anisotropy = aniso; }
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex.albedo, roughnessMap: floorTex.rough, roughness: 1, envMapIntensity: 0.25 });
  const blackMetal = new THREE.MeshStandardMaterial({ color: 0x0c0b0d, roughness: 0.38, metalness: 0.7, envMapIntensity: 1 });
  const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.32, metalness: 1, envMapIntensity: 1.3, side: THREE.DoubleSide });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8d8dc, roughness: 0.14, metalness: 1, envMapIntensity: 1.4 });
  const leather = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, color: 0x2a1426, roughness: 0.5, sheen: 0.6, sheenColor: new THREE.Color(0x6b4a7a), sheenRoughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.4 });

  // ── Back counter (the deck lives here); its top is the reflective plane y = 0
  const backCounter = new THREE.Group(); scene.add(backCounter);
  const bc = new THREE.Mesh(new RoundedBoxGeometry(4.6, 0.95, 0.74, 3, 0.012), counterSide);
  bc.position.set(0, -0.475 - 0.0005, -0.02); bc.receiveShadow = true; backCounter.add(bc);
  const bcTop = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.74), counterTop);
  bcTop.rotation.x = -Math.PI / 2; bcTop.position.set(0, 0, -0.02); bcTop.receiveShadow = true;
  backCounter.add(bcTop);
  out.reflectFloor = bcTop; out.counterTopMat = counterTop;

  // ── Room shell
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, FLOOR_Y, 2); floor.receiveShadow = true; scene.add(floor);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(14, CEIL_Y - FLOOR_Y), wallMat);
  back.position.set(0, (CEIL_Y + FLOOR_Y) / 2, WALL_Z - 0.36); back.receiveShadow = true; scene.add(back);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.MeshStandardMaterial({ color: 0x0b0710, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, CEIL_Y, 2); scene.add(ceil);
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(10, CEIL_Y - FLOOR_Y), wallMat);
    side.rotation.y = -s * Math.PI / 2; side.position.set(s * 3.6, (CEIL_Y + FLOOR_Y) / 2, 2); side.receiveShadow = true; scene.add(side);
  }

  // ── Record wall: two shelving blocks either side of a neon panel
  const cell = 0.36, rows = 6, y0 = 0.03, board = 0.022, depth = 0.34;
  const blocks = [{ x0: -2.9, cols: 7, rows }, { x0: 0.38, cols: 7, rows }, { x0: -0.38, cols: 2, rows: 1, cw: 0.38 }];
  const boards = [];
  const spines = [];
  const faceOut = [];
  for (const blk of blocks) {
    const w = blk.cols * cell;
    // shelves & dividers
    const cw = blk.cw ?? cell, w2 = blk.cols * cw;
    for (let r = 0; r <= blk.rows; r++) boards.push({ p: [blk.x0 + w2 / 2, y0 + r * cell, WALL_Z - depth / 2], s: [w2 + board, board, depth] });
    for (let c = 0; c <= blk.cols; c++) boards.push({ p: [blk.x0 + c * cw, y0 + blk.rows * cell / 2, WALL_Z - depth / 2], s: [board, blk.rows * cell + board, depth] });
    for (let r = 0; r < blk.rows; r++) for (let c = 0; c < blk.cols; c++) {
      const cx0 = blk.x0 + c * cw + board / 2, cy0 = y0 + r * cell + board / 2, inner = cw - board;
      const special = R();
      if (special < 0.12 && covers.length) { faceOut.push({ x: cx0 + inner / 2, y: cy0, cover: covers[faceOut.length % covers.length] }); }
      let x = cx0 + 0.002;
      const fill = special < 0.12 ? 0.9 : 0.5 + R() * 0.5;
      const lean = fill < 0.85;
      let n = 0;
      while (x < cx0 + inner * fill) {
        const th = 0.0032 + R() * R() * 0.007;
        const h = 0.305 + R() * 0.012;
        spines.push({ x: x + th / 2, y: cy0, z: WALL_Z - 0.012 - R() * 0.01, th, h, d: 0.305, rot: 0, strip: Math.floor(R() * 64), tint: 0.7 + R() * 0.45 });
        x += th + 0.0004; n++;
      }
      if (lean) { // the last few records lean into the gap
        const k = Math.min(n, 6 + Math.floor(R() * 8));
        const ang = (0.12 + R() * 0.28);
        for (let j = 0; j < k; j++) {
          const sp = spines[spines.length - k + j];
          const a = ang * (j + 1) / k;
          sp.rot = -a;
          sp.x += Math.sin(a) * sp.h * 0.5 * (j + 1) / k * 0.9;
        }
      }
    }
  }
  const boardGeo = new THREE.BoxGeometry(1, 1, 1);
  const boardsMesh = new THREE.InstancedMesh(boardGeo, shelfMat, boards.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  boards.forEach((b, i) => { m4.compose(v.set(...b.p), q.identity(), sc.set(...b.s)); boardsMesh.setMatrixAt(i, m4); });
  boardsMesh.castShadow = boardsMesh.receiveShadow = true;
  scene.add(boardsMesh);
  // warm LED strips under every shelf lip
  const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc080).multiplyScalar(3.2) });
  out.ledMat = ledMat; out.ledBase = ledMat.color.clone();
  for (const blk of blocks) for (let r = 1; r <= blk.rows; r++) {
    const bw = blk.cols * (blk.cw ?? cell);
    const led = new THREE.Mesh(new THREE.BoxGeometry(bw - 0.01, 0.004, 0.008), ledMat);
    led.position.set(blk.x0 + bw / 2, y0 + r * cell - board / 2 - 0.003, WALL_Z - 0.012);
    scene.add(led);
  }
  const backPanels = new THREE.Mesh(new THREE.PlaneGeometry(6.4, rows * cell), new THREE.MeshStandardMaterial({ color: 0x0d0a0f, roughness: 1 }));
  backPanels.position.set(0, y0 + rows * cell / 2, WALL_Z - depth - 0.001); scene.add(backPanels);

  const atlas = spineAtlas(renderer, R);
  const spineMat = new THREE.MeshStandardMaterial({ map: atlas.tex, roughness: 0.62, metalness: 0, envMapIntensity: 0.35 });
  out.shelfGlow = { value: 1 };
  spineMat.onBeforeCompile = sh => {
    sh.uniforms.uGlow = out.shelfGlow;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vShelfY; uniform float uGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float fy = fract((vShelfY - ${y0.toFixed(3)}) / ${cell.toFixed(3)});
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.78, 0.55) * uGlow * (pow(fy, 3.0) * 0.55 + 0.015); }`);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aStrip; varying float vShelfY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n vShelfY = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_MAP
          vMapUv = vec2((aStrip + uv.x) / ${atlas.cols.toFixed(1)}, uv.y);
        #endif`);
  };
  const spineGeo = new THREE.BoxGeometry(1, 1, 1);
  const strips = new Float32Array(spines.length);
  const spineMesh = new THREE.InstancedMesh(spineGeo, spineMat, spines.length);
  const col = new THREE.Color();
  spines.forEach((s, i) => {
    e.set(0, 0, s.rot); q.setFromEuler(e);
    // pivot leaning records at their bottom-left corner
    const px = s.x - Math.sin(s.rot) * s.h / 2 * -1, py = s.y + Math.cos(s.rot) * s.h / 2;
    m4.compose(v.set(px, py, s.z - s.d / 2), q, sc.set(s.th, s.h, s.d));
    spineMesh.setMatrixAt(i, m4);
    spineMesh.setColorAt(i, col.setScalar(s.tint));
    strips[i] = s.strip;
  });
  spineGeo.setAttribute('aStrip', new THREE.InstancedBufferAttribute(strips, 1));
  spineMesh.castShadow = spineMesh.receiveShadow = true;
  scene.add(spineMesh);
  out.spineCount = spines.length;

  // face-out covers
  const sleeveGeo = new THREE.BoxGeometry(0.315, 0.315, 0.004);
  for (const f of faceOut) {
    const m = new THREE.Mesh(sleeveGeo, [shelfMat, shelfMat, shelfMat, shelfMat,
      new THREE.MeshStandardMaterial({ map: f.cover, roughness: 0.55, envMapIntensity: 0.4, emissiveMap: f.cover, emissive: 0x3a2c22 }), shelfMat]);
    m.position.set(f.x, f.y + 0.158, WALL_Z + 0.004);
    m.rotation.x = -0.09; m.rotation.z = (R() - 0.5) * 0.03;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }

  // ── Neon panel in the middle: 低周波
  const panel = new THREE.Mesh(new RoundedBoxGeometry(0.72, rows * cell - 0.4, 0.04, 2, 0.01), new THREE.MeshStandardMaterial({ map: woodDark.albedo, color: 0x5a4a58, roughness: 0.7, envMapIntensity: 0.3 }));
  panel.position.set(-0.01, y0 + 0.4 + (rows * cell - 0.4) / 2, WALL_Z - depth + 0.03); panel.receiveShadow = true; scene.add(panel);
  const neon = neonTexture('低周波');
  const nh = 1.25, nw = nh * neon.aspect;
  const neonMat = new THREE.MeshBasicMaterial({ map: neon.tex, transparent: true, color: new THREE.Color(0xb49cff).multiplyScalar(5), depthWrite: false, toneMapped: true, fog: false });
  const neonMesh = new THREE.Mesh(new THREE.PlaneGeometry(nw, nh), neonMat);
  neonMesh.position.set(-0.01, 1.2, WALL_Z - depth + 0.06);
  scene.add(neonMesh);
  const haloMat = new THREE.MeshBasicMaterial({ map: neon.halo, transparent: true, color: new THREE.Color(0x9b7cff).multiplyScalar(1.1), blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(nw * 1.5, nh * 1.18), haloMat);
  halo.position.copy(neonMesh.position).add(v.set(0, 0, -0.005)); scene.add(halo);
  const neonLight = new THREE.PointLight(0xa78bfa, 1.4, 3.2, 1.6);
  neonLight.position.set(0, 1.2, WALL_Z - depth + 0.4); scene.add(neonLight);
  out.neon = { mat: neonMat, halo: haloMat, light: neonLight, base: neonMat.color.clone(), on: 1 };

  // ── Patron counter + stools
  const pc = new THREE.Group(); scene.add(pc);
  const pcTopY = 0.14, pcZ = 1.12;
  const pcTop = new THREE.Mesh(new RoundedBoxGeometry(6.2, 0.07, 0.62, 3, 0.02), counterTop);
  pcTop.position.set(0, pcTopY - 0.035, pcZ); pcTop.castShadow = pcTop.receiveShadow = true; pc.add(pcTop);
  const pcBody = new THREE.Mesh(new THREE.BoxGeometry(6.1, pcTopY - FLOOR_Y - 0.07, 0.42), counterSide);
  pcBody.position.set(0, (pcTopY - 0.07 + FLOOR_Y) / 2, pcZ - 0.04); pcBody.receiveShadow = true; pc.add(pcBody);
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 6.1, 16).rotateZ(Math.PI / 2), brass);
  rail.position.set(0, FLOOR_Y + 0.22, pcZ + 0.3); pc.add(rail);
  // stools
  const seatProf = [[0, 0.075], [0.17, 0.075], [0.19, 0.06], [0.195, 0.03], [0.185, 0.0], [0.05, -0.01], [0, -0.01]].map(([x, y]) => new THREE.Vector2(x, y));
  const baseProf = [[0, 0.02], [0.2, 0.012], [0.21, 0.0], [0, 0]].map(([x, y]) => new THREE.Vector2(x, y));
  const seatGeo = new THREE.LatheGeometry(seatProf, 48);
  const postGeo = new THREE.CylinderGeometry(0.022, 0.026, 0.66, 20);
  const ringGeo = new THREE.TorusGeometry(0.16, 0.009, 10, 48).rotateX(Math.PI / 2);
  const baseGeo = new THREE.LatheGeometry(baseProf, 48);
  const N = 12;
  const iSeat = new THREE.InstancedMesh(seatGeo, leather, N), iPost = new THREE.InstancedMesh(postGeo, chrome, N);
  const iRing = new THREE.InstancedMesh(ringGeo, chrome, N), iBase = new THREE.InstancedMesh(baseGeo, chrome, N);
  for (let i = 0; i < N; i++) {
    const x = -2.75 + i * 0.5, z = pcZ + 0.62;
    q.setFromEuler(e.set(0, R() * 6, 0));
    m4.compose(v.set(x, FLOOR_Y + 0.72, z), q, sc.set(1, 1, 1)); iSeat.setMatrixAt(i, m4);
    m4.compose(v.set(x, FLOOR_Y + 0.38, z), q, sc.set(1, 1, 1)); iPost.setMatrixAt(i, m4);
    m4.compose(v.set(x, FLOOR_Y + 0.26, z), q, sc.set(1, 1, 1)); iRing.setMatrixAt(i, m4);
    m4.compose(v.set(x, FLOOR_Y + 0.001, z), q, sc.set(1, 1, 1)); iBase.setMatrixAt(i, m4);
  }
  for (const m of [iSeat, iPost, iRing, iBase]) { m.castShadow = m.receiveShadow = true; scene.add(m); }
  // two glasses and a card on the counter
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, envMapIntensity: 2.2, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide });
  const whisky = new THREE.MeshPhysicalMaterial({ color: 0xc46a1a, roughness: 0.1, transparent: true, opacity: 0.72, emissive: 0x3a1500, envMapIntensity: 1.2, depthWrite: false });
  const glassProf = [[0, 0.0], [0.038, 0.0], [0.04, 0.004], [0.041, 0.085], [0.037, 0.085], [0.036, 0.012], [0, 0.012]].map(([x, y]) => new THREE.Vector2(x, y));
  for (const [x, z] of [[-0.62, pcZ - 0.05], [0.74, pcZ + 0.06]]) {
    const gl = new THREE.Mesh(new THREE.LatheGeometry(glassProf, 40), glassMat); gl.position.set(x, pcTopY, z); gl.renderOrder = 3; pc.add(gl);
    const liq = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 32), whisky); liq.position.set(x, pcTopY + 0.028, z); liq.renderOrder = 2; pc.add(liq);
    const ice = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.04, 0.04, 2, 0.008), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.15, transparent: true, opacity: 0.35, envMapIntensity: 2, depthWrite: false }));
    ice.position.set(x + 0.005, pcTopY + 0.04, z); ice.rotation.set(0.3, 0.6, 0.2); ice.renderOrder = 3; pc.add(ice);
  }

  // ── Pendants: one over the deck (the key light), three over the counter
  const shadeProf = [[0.012, 0.16], [0.03, 0.155], [0.05, 0.1], [0.11, 0.015], [0.115, 0.0], [0.108, 0.0], [0.046, 0.095], [0.026, 0.148], [0.01, 0.152]].map(([x, y]) => new THREE.Vector2(x, y));
  const shadeGeo = new THREE.LatheGeometry(shadeProf, 64);
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc27a).multiplyScalar(8), toneMapped: true });
  const innerGlow = new THREE.MeshBasicMaterial({ map: glowSprite(), color: new THREE.Color(0xffc88a).multiplyScalar(2.2), transparent: true, depthWrite: false });
  const mkPendant = (x, y, z, scale = 1) => {
    const g = new THREE.Group();
    const shade = new THREE.Mesh(shadeGeo, brass); shade.material = brass; shade.scale.setScalar(scale); shade.castShadow = false;
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.104 * scale, 48).rotateX(Math.PI / 2), innerGlow);
    inner.position.y = 0.012 * scale;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.028 * scale, 24, 16), bulbMat); bulb.position.y = 0.04 * scale;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, CEIL_Y - y, 6), blackMetal); cord.position.y = (CEIL_Y - y) / 2 + 0.15 * scale;
    g.add(shade, inner, bulb, cord);
    g.position.set(x, y, z);
    scene.add(g);
    out.pendants.push(g);
    return g;
  };
  out.keyPendant = mkPendant(0.03, 1.02, 0.02, 1.15);
  for (const x of [-1.5, 0, 1.5]) mkPendant(x, 1.05, pcZ, 1);
  out.pcTopY = pcTopY; out.pcZ = pcZ;

  // ── Valve amplifier (right of the deck)
  const amp = new THREE.Group();
  amp.position.set(0.47, 0, -0.06); amp.rotation.y = -0.1;
  scene.add(amp);
  const chassis = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.085, 0.24, 3, 0.006), blackMetal);
  chassis.position.y = 0.0425 + 0.012; chassis.castShadow = chassis.receiveShadow = true; amp.add(chassis);
  for (const [fx, fz] of [[-0.14, -0.1], [0.14, -0.1], [-0.14, 0.1], [0.14, 0.1]]) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.012, 20), chrome); foot.position.set(fx, 0.006, fz); amp.add(foot);
  }
  const face = new THREE.Mesh(new RoundedBoxGeometry(0.33, 0.09, 0.012, 2, 0.003), new THREE.MeshPhysicalMaterial({ color: 0x8f8d92, metalness: 1, roughness: 0.46, envMapIntensity: 0.7 }));
  face.position.set(0, 0.057, 0.124); face.castShadow = true; amp.add(face);
  // VU meter
  const vuC = document.createElement('canvas'); vuC.width = 256; vuC.height = 128;
  { const g = vuC.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#ffd99a'); gr.addColorStop(1, '#f0a850'); g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#2a1608'; g.lineWidth = 2; g.beginPath(); g.arc(128, 150, 110, Math.PI * 1.2, Math.PI * 1.8); g.stroke();
    for (let i = 0; i <= 10; i++) { const a = Math.PI * (1.2 + i * 0.06); g.lineWidth = i > 7 ? 3 : 1.5; g.strokeStyle = i > 7 ? '#a8231a' : '#2a1608'; g.beginPath(); g.moveTo(128 + Math.cos(a) * 110, 150 + Math.sin(a) * 110); g.lineTo(128 + Math.cos(a) * 96, 150 + Math.sin(a) * 96); g.stroke(); }
    g.fillStyle = '#2a1608'; g.font = '700 18px "Space Mono", monospace'; g.textAlign = 'center'; g.fillText('VU', 128, 105); }
  const vuTex = new THREE.CanvasTexture(vuC); vuTex.colorSpace = THREE.SRGBColorSpace;
  const vuMat = new THREE.MeshBasicMaterial({ map: vuTex, color: new THREE.Color(1, 1, 1).multiplyScalar(1.6) });
  const vu = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.0375), vuMat); vu.position.set(-0.06, 0.06, 0.1305); amp.add(vu);
  const needle = new THREE.Mesh(new THREE.PlaneGeometry(0.0012, 0.03).translate(0, 0.015, 0), new THREE.MeshBasicMaterial({ color: 0x1a0c05 }));
  needle.position.set(-0.06, 0.0435, 0.131); amp.add(needle);
  out.vuNeedle = needle;
  const vuLight = new THREE.PointLight(0xffb060, 0.06, 0.4, 2); vuLight.position.set(-0.06, 0.06, 0.2); amp.add(vuLight);
  for (const [kx, ks] of [[0.05, 1], [0.11, 0.8]]) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.014 * ks, 0.015 * ks, 0.016, 32).rotateX(Math.PI / 2), chrome);
    knob.position.set(kx, 0.055, 0.137); amp.add(knob);
  }
  // transformers
  for (const tx of [-0.1, 0.08]) {
    const tr = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.07, 0.07, 2, 0.006), blackMetal); tr.position.set(tx, 0.097 + 0.035, -0.07); tr.castShadow = true; amp.add(tr);
  }
  // valves
  const glassM = new THREE.MeshPhysicalMaterial({ color: 0x8d8272, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.1, envMapIntensity: 1.3, specularIntensity: 1, depthWrite: false, side: THREE.DoubleSide });
  const plateM = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.5, metalness: 0.8 });
  const getterM = new THREE.MeshStandardMaterial({ color: 0x9a9aa6, roughness: 0.08, metalness: 1, envMapIntensity: 2 });
  const tube = (x, z, big) => {
    const r = big ? 0.019 : 0.0115, h = big ? 0.095 : 0.055;
    const prof = big
      ? [[0.001, 0], [r * 0.9, 0], [r, h * 0.12], [r * 1.15, h * 0.45], [r, h * 0.8], [r * 0.55, h * 0.97], [0.001, h]]
      : [[0.001, 0], [r, 0], [r, h * 0.85], [r * 0.8, h * 0.97], [0.001, h]];
    const g = new THREE.Group(); g.position.set(x, 0.097, z);
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.2, r * 1.3, 0.008, 24), blackMetal); socket.position.y = 0.004; g.add(socket);
    const glass = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b + 0.008)), 32), glassM); glass.renderOrder = 4; g.add(glass);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(r * 1.1, h * 0.45, r * 0.55), plateM); plate.position.y = 0.008 + h * 0.4; g.add(plate);
    const filMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff7a2a).multiplyScalar(6) });
    const fil = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.16, h * 0.34, 8), filMat); fil.position.y = 0.008 + h * 0.4; g.add(fil);
    const glowMat = new THREE.SpriteMaterial({ map: glowSprite(), color: 0xff7a2a, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Sprite(glowMat); glow.scale.setScalar(r * 4.2); glow.position.y = 0.008 + h * 0.38; g.add(glow);
    const getter = new THREE.Mesh(new THREE.SphereGeometry(r * 0.72, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), getterM); getter.position.y = 0.008 + h * 0.83; getter.scale.y = 0.5; g.add(getter);
    amp.add(g);
    out.tubes.push({ fil: filMat, glow: glowMat, base: filMat.color.clone(), phase: R() * 10 });
  };
  for (const tx of [-0.12, -0.06, 0.0, 0.06]) tube(tx, 0.045, false);
  for (const tx of [-0.02, 0.15]) tube(tx, -0.06, true);
  const ampLight = new THREE.PointLight(0xff8a3c, 0.25, 1.1, 2); ampLight.position.set(0.47, 0.2, -0.05); scene.add(ampLight);
  out.ampLight = ampLight;

  // ── Now-playing stand (left of the deck)
  if (covers[0]) {
    const stand = new THREE.Group(); stand.position.set(-1.28, 0, -0.16); stand.rotation.y = 0.3; scene.add(stand);
    const ledge = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.018, 0.06, 2, 0.004), shelfMat); ledge.position.y = 0.009; ledge.castShadow = ledge.receiveShadow = true; stand.add(ledge);
    const lip = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.03, 0.008, 2, 0.003), shelfMat); lip.position.set(0, 0.03, 0.025); stand.add(lip);
    const sleeve = new THREE.Mesh(sleeveGeo, [shelfMat, shelfMat, shelfMat, shelfMat, new THREE.MeshStandardMaterial({ map: covers[0], roughness: 0.5, envMapIntensity: 0.5 }), shelfMat]);
    sleeve.position.set(0, 0.018 + 0.155, -0.005); sleeve.rotation.x = -0.2; sleeve.castShadow = sleeve.receiveShadow = true; stand.add(sleeve);
    const sign = document.createElement('canvas'); sign.width = 512; sign.height = 64;
    const sg = sign.getContext('2d'); sg.fillStyle = '#f2e9da'; sg.fillRect(0, 0, 512, 64); sg.fillStyle = '#1a1030'; sg.font = '700 30px "Space Mono", monospace'; sg.textAlign = 'center'; sg.textBaseline = 'middle'; sg.fillText('NOW PLAYING', 256, 34);
    const st = new THREE.CanvasTexture(sign); st.colorSpace = THREE.SRGBColorSpace;
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.02), new THREE.MeshStandardMaterial({ map: st, roughness: 0.8 }));
    card.position.set(0, 0.03, 0.0295); stand.add(card);
  }
  // a crate of records at the far left of the back counter
  out.lights = { neonLight, ampLight };
  return out;
}

let _glow;
function glowSprite() {
  if (_glow) return _glow;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}
