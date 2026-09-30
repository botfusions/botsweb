// An old momiji limb reaching over the water: tapered bark tubes and a few hundred instanced leaves
// that sway, turn with the seasons and throw their shadows onto the pond floor.
import * as THREE from 'three';
import { bakeTexture, fbmNormal } from '../../src/core/textures.js';
import { patchUnder, underShared } from './water.js';

function taperedTube(curve, r0, r1, seg = 40, radial = 9) {
  const frames = curve.computeFrenetFrames(seg, false);
  const pos = [], nor = [], uv = [], idx = [];
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, p);
    const r = r0 + (r1 - r0) * Math.pow(t, 0.8);
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * Math.PI * 2;
      n.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      // knobbly bark
      const k = 1 + Math.sin(t * 37 + a * 3) * 0.06 + Math.sin(t * 91 + a * 5) * 0.03;
      pos.push(p.x + n.x * r * k, p.y + n.y * r * k, p.z + n.z * r * k);
      nor.push(n.x, n.y, n.z);
      uv.push(j / radial, t * curve.getLength() * 3);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class MapleBranch {
  constructor({ renderer, scene, under, leafTex, leafGeo }) {
    let rs = 77;
    const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const limbs = [];
    const main = new THREE.CatmullRomCurve3([V(4.6, 3.35, -0.2), V(3.4, 3.0, 0.45), V(2.5, 2.72, 0.95), V(1.75, 2.55, 1.2), V(1.05, 2.42, 1.3)]);
    limbs.push([main, 0.075, 0.018]);
    const twigs = [];
    for (let k = 0; k < 26; k++) {
      const t = 0.28 + rnd() * 0.72;
      const o = main.getPointAt(t);
      const side = rnd() < 0.5 ? -1 : 1;
      const dir = V(-0.6 - rnd() * 0.5, -0.12 - rnd() * 0.2, side * (0.4 + rnd() * 0.8)).normalize();
      const len = 0.35 + rnd() * 0.55;
      const mid = o.clone().addScaledVector(dir, len * 0.5).add(V(0, 0.05, 0));
      const end = o.clone().addScaledVector(dir, len).add(V(0, -0.08 - rnd() * 0.1, 0));
      const c = new THREE.CatmullRomCurve3([o, mid, end]);
      limbs.push([c, 0.022 * (1.2 - t * 0.5), 0.005]);
      twigs.push(c);
    }
    twigs.push(new THREE.CatmullRomCurve3([main.getPointAt(0.85), main.getPointAt(0.92), main.getPointAt(1)]));

    const bark = bakeTexture(renderer, 512, /* glsl */`
      void main(){
        float n = fbm(vec2(vUv.x * 3., vUv.y * 0.35), 3., 5, .6);
        float streak = ridge(vec2(vUv.x * 9., vUv.y * 0.6), 9., 4);
        vec3 c = mix(vec3(0.05, 0.04, 0.035), vec3(0.16, 0.13, 0.11), n * .5 + .5);
        c = mix(c, vec3(0.22, 0.2, 0.17), smoothstep(0.55, 0.8, streak) * 0.5);
        c = mix(c, vec3(0.19, 0.22, 0.12), smoothstep(0.3, 0.6, fbm(vUv * vec2(2., .2) + 4., 2., 3, .5)) * 0.35);
        gl_FragColor = vec4(c, 1.);
      }`);
    const barkN = fbmNormal(renderer, { size: 512, scale: 8, octaves: 5, strength: 3, ridged: true });
    const barkMat = patchUnder(new THREE.MeshStandardMaterial({ map: bark, normalMap: barkN, roughness: 0.92, metalness: 0, envMapIntensity: 0.5 }), { key: 'bark' });
    this.group = new THREE.Group();
    for (const [c, r0, r1] of limbs) {
      const m = new THREE.Mesh(taperedTube(c, r0, r1, c === main ? 60 : 14, c === main ? 12 : 6), barkMat);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }
    scene.add(this.group);
    const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.proxy = this.group.clone(true);
    this.proxy.traverse(o => { if (o.isMesh) o.material = proxyMat; });
    under.add(this.proxy);

    // Leaves in loose palmate clusters toward the twig ends.
    const leaves = [];
    for (const c of twigs) {
      const n = 22 + Math.floor(rnd() * 16);
      for (let i = 0; i < n; i++) {
        const t = 0.35 + Math.pow(rnd(), 0.6) * 0.65;
        const p = c.getPointAt(t).add(V((rnd() - 0.5) * 0.18, (rnd() - 0.5) * 0.08 - 0.03, (rnd() - 0.5) * 0.18));
        leaves.push({ p, s: 0.075 + rnd() * 0.05, yaw: rnd() * 6.28, tx: (rnd() - 0.5) * 0.9, tz: (rnd() - 0.5) * 0.9 });
      }
    }
    this.count = leaves.length;
    this.slot = new THREE.InstancedBufferAttribute(new Float32Array(this.count), 1);
    this.phase = new THREE.InstancedBufferAttribute(new Float32Array(this.count).map(() => rnd() * 6.28), 1);
    const geo = leafGeo.clone();
    geo.setAttribute('aSlot', this.slot);
    geo.setAttribute('aPhase', this.phase);
    this.uTime = { value: 0 };
    const mat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.62, metalness: 0, envMapIntensity: 0.7 });
    const sway = sh => {
      sh.uniforms.uTimeB = this.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSlot; attribute float aPhase; uniform float uTimeB;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (vMapUv + vec2(mod(aSlot, 3.), 1. - floor(aSlot / 3.))) / vec2(3., 2.);\n#endif')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float kr = length(position.xz);
          transformed.y += (sin(uTimeB * 1.7 + aPhase) * 0.6 + sin(uTimeB * 3.1 + aPhase * 2.3) * 0.4) * 0.09 * kr;
          transformed.x += sin(uTimeB * 1.3 + aPhase * 1.7) * 0.03 * kr;`);
    };
    mat.onBeforeCompile = sway;
    patchUnder(mat, { key: 'branchleaf' });
    this.leaves = new THREE.InstancedMesh(geo, mat, this.count);
    this.leaves.castShadow = true; this.leaves.receiveShadow = true; this.leaves.frustumCulled = false;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide });
    depth.onBeforeCompile = sway;
    this.leaves.customDepthMaterial = depth;
    this.data = leaves;
    this.setMatrices(1);
    scene.add(this.leaves);
    this.leafProxy = new THREE.InstancedMesh(geo, proxyMat, this.count);
    this.leafProxy.instanceMatrix = this.leaves.instanceMatrix;
    this.leafProxy.customDepthMaterial = depth;
    this.leafProxy.castShadow = true; this.leafProxy.frustumCulled = false;
    under.add(this.leafProxy);
    this.season = -1;
    this.leafScale = 1;
  }

  setMatrices(k) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3();
    this.data.forEach((l, i) => {
      e.set(l.tx, l.yaw, l.tz, 'YXZ'); q.setFromEuler(e);
      this.leaves.setMatrixAt(i, m.compose(l.p, q, s.setScalar(l.s * k)));
    });
    this.leaves.instanceMatrix.needsUpdate = true;
  }

  /** autumn 0..1 turns the leaves; bare 0..1 strips them. */
  update(t, { autumn, bare }) {
    this.uTime.value = t;
    const key = Math.round(autumn * 4) * 10 + Math.round(bare * 4);
    if (key !== this.season) {
      this.season = key;
      let rs = 3;
      const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < this.count; i++) {
        const r = rnd();
        this.slot.setX(i, r < autumn * 0.95 ? [0, 1, 1, 2, 3, 0][Math.floor(rnd() * 6)] : (r < autumn + 0.15 ? 3 : 4));
      }
      this.slot.needsUpdate = true;
    }
    const k = 1 - bare;
    if (Math.abs(k - this.leafScale) > 0.01) { this.leafScale = k; this.setMatrices(Math.max(0.0001, k)); }
  }
}
