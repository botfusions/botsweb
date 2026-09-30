// The room: walnut (solid procedural grain), linen cloth, plaster, a live window-light cookie, substrate layers.
import { THREE } from '../../src/core/engine.js';
import { bakeTexture, NOISE_GLSL } from '../../src/core/textures.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const N3 = /* glsl */`
  float h13(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fb3(vec3 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a * n3(p); p *= 2.03; a *= .5; } return s; }
`;

/** Oiled English walnut, grain computed in object space so a turned piece shows real flat-sawn figure. */
export function walnutMaterial({ scale = 1, seed = 0, tone = 1 } = {}) {
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.48, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.32,
    sheen: 0.3, sheenColor: new THREE.Color(0x6b4a33), sheenRoughness: 0.6, envMapIntensity: 0.9 });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uSeed = { value: seed }; sh.uniforms.uScale = { value: scale }; sh.uniforms.uTone = { value: tone };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vObj; uniform float uSeed, uScale, uTone;\n${N3}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 wp = vObj * uScale + uSeed;
        float warp = fb3(wp * vec3(0.9, 3.2, 3.2)) * .55 + fb3(wp * 14.) * .05;
        float ring = length(vec2(wp.y * 1.0 + 2.1, wp.z * .85 + .4)) * 11. + warp * 5.5;
        float rr = fract(ring);
        float late = smoothstep(.0, .18, rr) * (1. - smoothstep(.42, .9, rr));
        float streak = fb3(wp * vec3(1.5, 22., 22.));
        float pores = smoothstep(.62, .8, n3(wp * vec3(18., 260., 260.)));
        vec3 dark = vec3(.030, .0135, .0062), mid = vec3(.078, .036, .016), light = vec3(.15, .074, .034);
        vec3 wc = mix(mid, dark, late * .85);
        wc = mix(wc, light, smoothstep(.45, .8, streak) * .55);
        wc = mix(wc, vec3(.06, .04, .035), smoothstep(.55, .75, fb3(wp * 2.2 + 7.)) * .25); // a little purple-grey figure
        wc *= 1. - pores * .35;
        diffuseColor.rgb *= wc * uTone * 1.35;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + pores * .25 - late * .06, .05, 1.);`);
  };
  mat.customProgramCacheKey = () => 'walnut-1';
  return mat;
}

/** Plain-weave linen: albedo + normal + roughness baked on the GPU. */
export function linenTextures(renderer, { threads = 150, size = 1024, color = [0.86, 0.8, 0.7] } = {}) {
  const H = `
    float thread(float f){ return sqrt(max(0., sin(f * 3.14159))); }
    float slubX(float id){ return .75 + .5 * fract(sin(id * 12.9898) * 43758.5453); }
    float slubY(float id){ return .75 + .5 * fract(sin(id * 78.233) * 43758.5453); }
    float H(vec2 uv){
      vec2 p = uv * ${threads.toFixed(1)};
      vec2 id = floor(p), f = fract(p);
      float over = mod(id.x + id.y, 2.);
      float wx = thread(f.x) * slubX(id.x) * (.85 + .3 * pnoise(vec2(id.x * .7, uv.y * 40.), 1000.));
      float wy = thread(f.y) * slubY(id.y) * (.85 + .3 * pnoise(vec2(uv.x * 40., id.y * .7), 1000.));
      float bendX = sin((f.y + over) * 3.14159) * .25, bendY = sin((f.x + 1. - over) * 3.14159) * .25;
      return over > .5 ? max(wx * .9 + bendX, wy * .6) : max(wy * .9 + bendY, wx * .6);
    }`;
  const albedo = bakeTexture(renderer, size, `${H}
    void main(){
      float h = H(vUv);
      float blot = fbm(vUv * 6., 6., 5, .55);
      vec2 p = vUv * ${threads.toFixed(1)};
      float slub = fract(sin(floor(p.x) * 3.1) * 9173.1) * .08 + fract(sin(floor(p.y) * 5.7) * 7211.3) * .08;
      vec3 c = vec3(${color.map(v => v.toFixed(3)).join(',')});
      c *= .8 + h * .24 + blot * .1 - slub;
      gl_FragColor = vec4(c, 1.);
    }`);
  albedo.colorSpace = THREE.SRGBColorSpace;
  const normal = bakeTexture(renderer, size, `${H}
    void main(){
      float e = 1. / ${size.toFixed(1)};
      float hx = H(vUv + vec2(e, 0.)) - H(vUv - vec2(e, 0.));
      float hy = H(vUv + vec2(0., e)) - H(vUv - vec2(0., e));
      gl_FragColor = vec4(normalize(vec3(-hx * 1.6, -hy * 1.6, 1.)) * .5 + .5, 1.);
    }`);
  return { albedo, normal };
}

/** Warm plaster wall with a soft mottle. */
export function plasterTextures(renderer) {
  const albedo = bakeTexture(renderer, 1024, `
    void main(){
      float m = fbm(vUv * 3., 3., 6, .55), f = fbm(vUv * 28., 28., 4, .5);
      vec3 c = vec3(.905, .87, .8) * (.93 + m * .12 + f * .03);
      gl_FragColor = vec4(c, 1.);
    }`);
  albedo.colorSpace = THREE.SRGBColorSpace;
  const normal = bakeTexture(renderer, 1024, `
    float H(vec2 p){ return fbm(p * 9., 9., 6, .55) + fbm(p * 40., 40., 3, .5) * .3; }
    void main(){ float e = 1. / 1024.; float hx = H(vUv + vec2(e,0.)) - H(vUv - vec2(e,0.)); float hy = H(vUv + vec2(0.,e)) - H(vUv - vec2(0.,e));
      gl_FragColor = vec4(normalize(vec3(-hx * 6., -hy * 6., 1.)) * .5 + .5, 1.); }`);
  return { albedo, normal };
}

/** A four-pane sash window with a tree outside, rendered live so the leaves move in the breeze. */
export class WindowCookie {
  constructor(renderer, size = 512) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, generateMipmaps: false, minFilter: THREE.LinearFilter, depthBuffer: false });
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLeaf: { value: 1 }, uWarm: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: `precision highp float; varying vec2 vUv; uniform float uTime, uLeaf, uWarm; ${NOISE_GLSL}
        float box(vec2 p, vec2 lo, vec2 hi, float s){ return smoothstep(lo.x - s, lo.x + s, p.x) * smoothstep(hi.x + s, hi.x - s, p.x) * smoothstep(lo.y - s, lo.y + s, p.y) * smoothstep(hi.y + s, hi.y - s, p.y); }
        void main(){
          vec2 p = vUv;
          float win = box(p, vec2(.2, .1), vec2(.8, .9), .045);
          float mv = smoothstep(.004, .03, abs(p.x - .5));
          float mh = smoothstep(.004, .028, abs(p.y - .52));
          float mh2 = 1. - (1. - smoothstep(.002, .016, abs(p.y - .255))) * .75;
          float mh3 = 1. - (1. - smoothstep(.002, .016, abs(p.y - .745))) * .75;
          float frame = win * mv * mh * mh2 * mh3;
          vec2 sway = vec2(sin(uTime * .31) * .018 + sin(uTime * .83) * .006, cos(uTime * .27) * .012);
          vec2 q = p * vec2(2.3, 2.0) + sway;
          float lf = fbm(q * 2.0 + vec2(0., uTime * .004), 64., 5, .55) + .5 * fbm(q * 5.5 + sway * 3., 128., 3, .5);
          float leaf = smoothstep(.16, .4, lf) * smoothstep(.95, .35, p.y) * uLeaf;
          float branch = smoothstep(.03, .0, abs(p.y - .78 - sin(p.x * 5. + 1.) * .06 - sway.y)) * smoothstep(.1, .5, p.x) * uLeaf;
          float light = frame * (1. - leaf * .6) * (1. - branch * .6);
          vec3 col = mix(vec3(1., .96, .88), vec3(1., .72, .46), uWarm) * light;
          gl_FragColor = vec4(col, 1.);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.scene = new THREE.Scene();
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat); q.frustumCulled = false;
    this.scene.add(q);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.texture = this.rt.texture;
    this._acc = 1;
  }
  update(dt, t) {
    this._acc += dt;
    if (this._acc < 1 / 30) return;
    this._acc = 0;
    this.mat.uniforms.uTime.value = t;
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(this.rt); r.render(this.scene, this.cam); r.setRenderTarget(prev);
  }
}

/** Walnut plinth: a turned lathe piece with a groove the glass sits in. Returns { mesh, top }. */
export function walnutBase(material) {
  const P = [[0, 0.16], [0.6, 0.16], [0.628, 0.158], [0.64, 0.146], [0.688, 0.146], [0.7, 0.158], [0.735, 0.16], [0.76, 0.152],
    [0.775, 0.132], [0.772, 0.105], [0.752, 0.085], [0.742, 0.06], [0.75, 0.03], [0.762, 0.012], [0.758, 0.0], [0, 0.0]];
  // round the corners a little with a spline, but keep the flat top and bottom exact
  const pts = [];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const n = i === 0 || i === P.length - 2 ? 1 : 4;
    for (let k = 0; k < n; k++) pts.push(new THREE.Vector2(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n));
  }
  pts.push(new THREE.Vector2(0, 0));
  const smooth = pts.map((p, i) => {
    if (i < 2 || i > pts.length - 3) return p;
    return new THREE.Vector2((pts[i - 1].x + p.x * 2 + pts[i + 1].x) / 4, (pts[i - 1].y + p.y * 2 + pts[i + 1].y) / 4);
  });
  const geo = new THREE.LatheGeometry(smooth.reverse(), 160);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = mesh.receiveShadow = true;
  return { mesh, top: 0.16, grooveY: 0.146 };
}

// ─── Substrate layers for the exploded view ──────────────────────────────────────
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function scatterDisk(count, R, rand, minD) {
  const out = [];
  let tries = 0;
  while (out.length < count && tries++ < count * 60) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * R;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (out.some(p => (p[0] - x) ** 2 + (p[1] - z) ** 2 < minD * minD)) continue;
    out.push([x, z]);
  }
  return out;
}

export function substrateLayers(renderer, clip) {
  const rand = rng(7);
  const R = 0.5;
  const layers = [];

  // 05 drainage stones — rounded river pebbles and lava rock
  {
    const g = new THREE.Group();
    let geo = new THREE.IcosahedronGeometry(1, 3);
    geo.deleteAttribute('normal'); geo.deleteAttribute('uv');
    geo = mergeVertices(geo);
    const pos = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = Math.sin(v.x * 3.1 + 1.3) * Math.sin(v.y * 2.7) * Math.sin(v.z * 3.3 + 0.4);
      v.multiplyScalar(1 + n * 0.12);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const pts = [...scatterDisk(95, R - 0.035, rand, 0.062), ...scatterDisk(70, R - 0.05, rand, 0.07)];
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0, envMapIntensity: 0.8 });
    const im = new THREE.InstancedMesh(geo, mat, pts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
    const tones = [0xd9d4ca, 0xbfb8aa, 0xe8e3d9, 0x9c948a, 0xcbb9a0, 0x6d6760];
    pts.forEach(([x, z], i) => {
      const sz = 0.024 + rand() * 0.02;
      s.set(sz * (1 + rand() * 0.35), sz * (0.55 + rand() * 0.25), sz * (0.85 + rand() * 0.3));
      p.set(x, i < 95 ? sz * 0.6 : 0.045 + sz * 0.5, z);
      q.setFromEuler(e.set((rand() - 0.5) * 0.5, rand() * 6.28, (rand() - 0.5) * 0.5));
      im.setMatrixAt(i, m.compose(p, q, s));
      im.setColorAt(i, c.set(tones[Math.floor(rand() * tones.length)]).offsetHSL(0, 0, (rand() - 0.5) * 0.08));
    });
    im.castShadow = im.receiveShadow = true;
    g.add(im);
    layers.push({ key: 'stones', group: g, h: 0.085, mats: [mat] });
  }

  // 04 activated charcoal — sharp black chunks
  {
    const g = new THREE.Group();
    let geo = new THREE.IcosahedronGeometry(1, 0);
    geo.deleteAttribute('normal'); geo.deleteAttribute('uv');
    geo = mergeVertices(geo);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (0.7 + rand() * 0.6), pos.getY(i) * (0.7 + rand() * 0.6), pos.getZ(i) * (0.7 + rand() * 0.6));
    geo = geo.toNonIndexed(); geo.computeVertexNormals();
    const pts = [...scatterDisk(230, R - 0.02, rand, 0.03), ...scatterDisk(150, R - 0.03, rand, 0.034)];
    const mat = new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.52, metalness: 0.25, envMapIntensity: 1.2, flatShading: true });
    const im = new THREE.InstancedMesh(geo, mat, pts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
    pts.forEach(([x, z], i) => {
      const sz = 0.011 + rand() * 0.012;
      s.set(sz * (0.8 + rand() * 0.6), sz * (0.6 + rand() * 0.4), sz * (0.8 + rand() * 0.6));
      p.set(x, i < 230 ? sz * 0.6 : 0.022 + sz * 0.5, z);
      q.setFromEuler(e.set(rand() * 6.28, rand() * 6.28, rand() * 6.28));
      im.setMatrixAt(i, m.compose(p, q, s));
      im.setColorAt(i, c.setRGB(1, 1, 1).multiplyScalar(0.7 + rand() * 0.5));
    });
    im.castShadow = im.receiveShadow = true;
    g.add(im);
    layers.push({ key: 'charcoal', group: g, h: 0.045, mats: [mat] });
  }

  // 03 mesh — a fine woven sheet with a little sag
  {
    const g = new THREE.Group();
    const grid = bakeTexture(renderer, 512, `
      void main(){ vec2 p = fract(vUv * 26.); float l = max(smoothstep(.3, .36, abs(p.x - .5)), smoothstep(.3, .36, abs(p.y - .5)));
        gl_FragColor = vec4(vec3(l), 1.); }`);
    grid.generateMipmaps = false; grid.minFilter = THREE.LinearFilter;
    const geo = new THREE.CircleGeometry(R + 0.01, 128, 0, Math.PI * 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i); pos.setZ(i, -0.014 * (1 - (x * x + y * y) / (R * R))); }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x4f5c47, roughness: 0.62, alphaMap: grid, alphaTest: 0.5, side: THREE.DoubleSide });
    grid.repeat.set(1, 1);
    const sheet = new THREE.Mesh(geo, mat);
    sheet.rotation.x = -Math.PI / 2; sheet.position.y = 0.016;
    sheet.castShadow = sheet.receiveShadow = true;
    g.add(sheet);
    const hem = new THREE.Mesh(new THREE.TorusGeometry(R + 0.01, 0.0035, 6, 160), new THREE.MeshStandardMaterial({ color: 0x4d5846, roughness: 0.6 }));
    hem.rotation.x = Math.PI / 2; hem.position.y = 0.016;
    g.add(hem);
    layers.push({ key: 'mesh', group: g, h: 0.02, mats: [mat, hem.material] });
  }

  // 02 living soil — a puck of loam, bark and perlite
  {
    const g = new THREE.Group();
    const soilMap = bakeTexture(renderer, 1024, `
      void main(){
        float n = fbm(vUv * 10., 10., 6, .55), m = fbm(vUv * 40., 40., 4, .5);
        vec3 c = mix(vec3(.07, .045, .028), vec3(.16, .1, .06), n + .3);
        vec2 g = vUv * 90.; vec2 id = floor(g), f = fract(g);
        float h = fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);
        float perl = step(.93, h) * smoothstep(.42, .2, length(f - .5));
        float h2 = fract(sin(dot(id, vec2(39.3, 11.7))) * 24634.63);
        float bark = step(.86, h2) * smoothstep(.5, .3, abs(f.x - .5) + abs(f.y - .5) * .6);
        c = mix(c, vec3(.35, .19, .09), bark * .8);
        c = mix(c, vec3(.9, .88, .84), perl);
        c *= .75 + m * .5;
        gl_FragColor = vec4(c, 1.);
      }`);
    soilMap.colorSpace = THREE.SRGBColorSpace;
    const soilN = bakeTexture(renderer, 512, `
      float H(vec2 p){ return fbm(p * 14., 14., 6, .6) + ridge(p * 30., 30., 3) * .3; }
      void main(){ float e = 1. / 512.; float hx = H(vUv + vec2(e,0.)) - H(vUv - vec2(e,0.)); float hy = H(vUv + vec2(0.,e)) - H(vUv - vec2(0.,e));
        gl_FragColor = vec4(normalize(vec3(-hx * 5., -hy * 5., 1.)) * .5 + .5, 1.); }`);
    const mat = new THREE.MeshStandardMaterial({ map: soilMap, normalMap: soilN, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 1, envMapIntensity: 0.5 });
    const top = new THREE.RingGeometry(0.0001, R, 160, 40);
    const pos = top.attributes.position;
    const bumps = Array.from({ length: 70 }, () => [(rand() - 0.5) * 2 * R, (rand() - 0.5) * 2 * R, 0.02 + rand() * 0.05, 0.004 + rand() * 0.012]);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), r = Math.hypot(x, y);
      let n = Math.sin(x * 23 + 1) * Math.sin(y * 19) * 0.008 + Math.sin(x * 61) * Math.sin(y * 57 + 2) * 0.004;
      for (const [bx, by, br, bh] of bumps) { const d = Math.hypot(x - bx, y - by); if (d < br) n += bh * (1 - (d / br) ** 2) ** 2; }
      pos.setZ(i, (n + 0.012 * (1 - (r / R) ** 4)) * Math.min(1, (R - r) * 40 + 0.15));
    }
    top.computeVertexNormals();
    const topM = new THREE.Mesh(top, mat); topM.rotation.x = -Math.PI / 2; topM.position.y = 0.1;
    const sideGeo = new THREE.CylinderGeometry(R, R * 0.995, 0.1, 160, 8, true);
    { const sp = sideGeo.attributes.position; for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), z = sp.getZ(i), yy = sp.getY(i), a = Math.atan2(z, x);
        const k = 1 + (Math.sin(a * 37 + yy * 40) * 0.006 + Math.sin(a * 91 - yy * 70) * 0.004); sp.setX(i, x * k); sp.setZ(i, z * k); } sideGeo.computeVertexNormals(); }
    const side = new THREE.Mesh(sideGeo, mat);
    side.position.y = 0.05;
    const bot = new THREE.Mesh(new THREE.CircleGeometry(R, 64), mat); bot.rotation.x = Math.PI / 2;
    for (const o of [topM, side, bot]) { o.castShadow = o.receiveShadow = true; g.add(o); }
    layers.push({ key: 'soil', group: g, h: 0.11, mats: [mat] });
  }

  for (const L of layers) {
    for (const m of L.mats) { m.clippingPlanes = [clip]; m.clipShadows = true; }
    L.group.visible = false;
  }
  return layers;
}
