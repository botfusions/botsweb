// Pastries with real physics (Rapier): instanced meshes per type, simplified colliders, a kinematic fingertip,
// spring pick-up and toss, knock waves, hops, rain, and texture-less proxies for the shadow pass.
import RAPIER from '@dimforge/rapier3d-compat';
import { THREE, clamp, lerp } from '../../src/core/engine.js';
import { firstMesh } from '../../src/core/assets.js';
import { COUNTER } from './set.js';

export { RAPIER };
export const GRAVITY = 40;

// Macaron flavours. Everything except pistachio is the rose shell, hue-shifted per instance in the shader.
export const FLAVOURS = {
  rose:     { model: 'macA', tint: [0.0, 1.0, 1.0], name: 'Rose & Litchi', css: '#e7aab4' },
  citron:   { model: 'macA', tint: [0.15, 1.45, 1.14], name: 'Citron', css: '#efd98c' },
  violette: { model: 'macA', tint: [-0.16, 0.72, 0.93], name: 'Violette-Cassis', css: '#b6a2c9' },
  chocolat: { model: 'macA', tint: [0.075, 1.25, 0.46], name: 'Chocolat', css: '#7a4b3a' },
  vanille:  { model: 'macA', tint: [0.13, 0.38, 1.16], name: 'Vanille', css: '#f1e6cf' },
  pistache: { model: 'macB', tint: [0.0, 1.0, 1.0], name: 'Pistache', css: '#bfc79a' },
};
const MAC_A_MIX = ['rose', 'rose', 'rose', 'citron', 'violette', 'chocolat', 'vanille', 'rose', 'citron', 'vanille'];

export const TYPES = [
  { key: 'macA', file: 'models/sucre/macaron-lo.glb', shadow: 'models/sucre/macaron-shadow.glb', size: 0.54, count: 48, shape: 'macaron', rest: 0.16, fric: 1.0, dens: 1.0, adamp: 0.7 },
  { key: 'macB', file: 'models/sucre/macaron2-lo.glb', shadow: 'models/sucre/macaron2-shadow.glb', size: 0.54, count: 16, shape: 'macaron', rest: 0.16, fric: 1.0, dens: 1.0, adamp: 0.7 },
  { key: 'berry', file: 'models/sucre/strawberry-lo.glb', shadow: 'models/sucre/strawberry-shadow.glb', size: 0.46, count: 26, shape: 'ball', rest: 0.26, fric: 0.9, dens: 1.1, adamp: 1.6 },
  { key: 'croissant', file: 'models/sucre/croissant-lo.glb', shadow: 'models/sucre/croissant-shadow.glb', size: 1.3, count: 7, shape: 'capsule', rest: 0.08, fric: 1.0, dens: 0.35, adamp: 1.2, upright: true },
  { key: 'tart', file: 'models/sucre/tart-lo.glb', shadow: 'models/sucre/tart-shadow.glb', size: 0.98, count: 5, shape: 'cylinder', rest: 0.04, fric: 1.0, dens: 0.9, adamp: 2.5, upright: true },
];

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Copy a (possibly quantised) glTF mesh into a float geometry in the model's own space. */
function bakeGeometry(root) {
  const mesh = firstMesh(root);
  root.updateMatrixWorld(true);
  const src = mesh.geometry, geo = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = src.getAttribute(name);
    if (!a) continue;
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
    geo.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (src.index) geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1));
  geo.applyMatrix4(mesh.matrixWorld);
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  return { geo, material: mesh.material };
}

// Hue/saturation/value shift per instance (done in sRGB space so the shifts read as a pastry chef would name them).
function patchFlavour(material) {
  material.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aTint; varying vec3 vTint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTint = aTint;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTint;
        vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0., -1./3., 2./3., -1.); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
          vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1.0e-10;
          return vec3(abs(q.z + (q.w - q.y) / (6. * d + e)), d / (q.x + e), q.x); }
        vec3 hsv2rgb(vec3 c){ vec3 p = abs(fract(c.xxx + vec3(1., 2./3., 1./3.)) * 6. - 3.); return c.z * mix(vec3(1.), clamp(p - 1., 0., 1.), c.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 s = pow(max(diffuseColor.rgb, 0.0), vec3(1.0 / 2.2));
          vec3 h = rgb2hsv(s);
          h.x = fract(h.x + vTint.x + 1.0);
          h.y = clamp(h.y * vTint.y, 0.0, 1.0);
          h.z = clamp(h.z * vTint.z, 0.0, 1.0);
          diffuseColor.rgb = pow(hsv2rgb(h), vec3(2.2));
        }`);
  };
  material.customProgramCacheKey = () => 'sucre-flavour';
  material.needsUpdate = true;
}

export class Patisserie {
  constructor(scene) {
    this.scene = scene;
    this.types = {};
    this.entries = [];
    this.byCollider = new Map();
    this.queue = [];
    this.time = 0;
    this.held = null;
    this.holdTarget = new THREE.Vector3();
    this.cursor = { target: new THREE.Vector3(0, -30, 0), prev: new THREE.Vector3(0, -30, 0), active: false };
    this.onImpact = null;
    this.onLost = null;
    this.impulses = [];
  }

  async init() {
    await RAPIER.init();
    const world = this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    world.integrationParameters.numSolverIterations = 6;
    // Counter slab, back wall, and a low invisible lip at the back so nothing wedges behind the cake.
    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const W = COUNTER.x1 - COUNTER.x0, D = COUNTER.z1 - COUNTER.z0;
    world.createCollider(RAPIER.ColliderDesc.cuboid(W / 2, 1, D / 2).setTranslation((COUNTER.x0 + COUNTER.x1) / 2, -1, (COUNTER.z0 + COUNTER.z1) / 2).setFriction(0.9).setRestitution(0.35), fixed);
    world.createCollider(RAPIER.ColliderDesc.cuboid(W / 2, 20, 0.5).setTranslation((COUNTER.x0 + COUNTER.x1) / 2, 20, COUNTER.z0 - 0.5).setFriction(0.4).setRestitution(0.3), fixed);
    // Kinematic fingertip that follows the pointer across the marble.
    this.cursorBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -30, 0));
    this.cursorCol = world.createCollider(RAPIER.ColliderDesc.ball(0.34).setFriction(0.3).setRestitution(0.1), this.cursorBody);
  }

  /** Build instanced meshes + bodies for one type from its loaded glTFs. */
  addType(def, gltf, shadowGltf) {
    const { geo, material } = bakeGeometry(gltf.scene);
    const sgeo = shadowGltf ? bakeGeometry(shadowGltf.scene).geo : geo;
    geo.computeBoundingBox();
    const bb = geo.boundingBox, dim = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
    const s = def.size / Math.max(dim.x, dim.y, dim.z);
    const norm = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    geo.applyMatrix4(norm);
    if (sgeo !== geo) sgeo.applyMatrix4(norm);
    dim.multiplyScalar(s);
    geo.computeBoundingSphere();

    const mat = material;
    mat.envMapIntensity = def.env ?? 1;
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (mat[k]) mat[k].anisotropy = 8;
    if (def.key === 'macA' || def.key === 'macB') { mat.roughness = 1; patchFlavour(mat); }
    if (def.key === 'berry') { mat.roughness = 0.55; mat.envMapIntensity = 1.5; }
    if (def.key === 'tart') { mat.roughness = 0.8; mat.envMapIntensity = 1.2; }
    const n = def.count;
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
    im.castShadow = false; im.receiveShadow = true;
    const tint = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { tint[i * 3 + 1] = 1; tint[i * 3 + 2] = 1; im.setMatrixAt(i, ZERO); }
    const tintAttr = new THREE.InstancedBufferAttribute(tint, 3);
    geo.setAttribute('aTint', tintAttr);
    this.scene.add(im);
    // Shadow proxy (≈1.5k tris) shares the instance matrices. It draws nothing in colour passes; only its shadow counts.
    const sm = new THREE.InstancedMesh(sgeo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), n);
    sm.instanceMatrix = im.instanceMatrix;
    sm.frustumCulled = false;
    sm.castShadow = true;
    sm.renderOrder = -10;
    this.scene.add(sm);

    const T = { def, im, sm, tintAttr, dim, entries: [] };
    this.types[def.key] = T;

    // Colliders fitted to the normalised bounds.
    const mk = () => {
      let cd;
      if (def.shape === 'macaron') {
        const r = Math.max(dim.x, dim.z) / 2 * 0.97, hh = dim.y / 2 * 0.96, br = Math.min(0.07, hh * 0.45);
        cd = RAPIER.ColliderDesc.roundCylinder(hh - br, r - br, br);
        T.hy = hh;
      } else if (def.shape === 'ball') {
        const r = (dim.x + dim.y + dim.z) / 6 * 0.86;
        cd = RAPIER.ColliderDesc.ball(r); T.hy = r;
      } else if (def.shape === 'capsule') {
        const axis = dim.x >= dim.y && dim.x >= dim.z ? 'x' : dim.z >= dim.y ? 'z' : 'y';
        const L = dim[axis], others = ['x', 'y', 'z'].filter(a => a !== axis).map(a => dim[a]);
        const r = Math.min(...others) / 2 * 0.95;
        cd = RAPIER.ColliderDesc.capsule(Math.max(0.01, L / 2 - r), r);
        if (axis === 'x') cd.setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)));
        if (axis === 'z') cd.setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
        T.hy = r;
      } else {
        cd = RAPIER.ColliderDesc.cylinder(dim.y / 2, Math.max(dim.x, dim.z) / 2 * 0.98); T.hy = dim.y / 2;
      }
      return cd.setFriction(def.fric).setRestitution(def.rest).setDensity(def.dens);
    };
    for (let i = 0; i < n; i++) {
      const rb = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -40 - i, 0)
        .setLinearDamping(0.12).setAngularDamping(def.adamp).setCcdEnabled(true));
      const col = this.world.createCollider(mk(), rb);
      rb.setEnabled(false);
      let flavour = def.key === 'macB' ? 'pistache' : def.key === 'macA' ? MAC_A_MIX[i % MAC_A_MIX.length] : null;
      const e = { id: this.entries.length, T, i, rb, col, state: 'parked', flavour, vy: 0, sq: 0, sqv: 0, bornAt: -10, lastImpact: -10 };
      if (flavour) { const t = FLAVOURS[flavour].tint; tint.set(t, i * 3); }
      T.entries.push(e);
      this.entries.push(e);
      this.byCollider.set(col.handle, e);
    }
    tintAttr.needsUpdate = true;
    return T;
  }

  /** Static cake on a slowly turning stand: a velocity-driven kinematic body with stacked cylinders. */
  addCake(pos, tiers, spin = 0.14) {
    const rb = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicVelocityBased().setTranslation(pos.x, pos.y, pos.z));
    for (const t of tiers) this.world.createCollider(RAPIER.ColliderDesc.cylinder(t.h / 2, t.r).setTranslation(0, t.y + t.h / 2, 0).setFriction(0.9).setRestitution(0.25), rb);
    rb.setAngvel({ x: 0, y: spin, z: 0 }, true);
    this.cake = rb;
    return rb;
  }

  isPastry(col) { return this.byCollider.has(col.handle); }

  // ── spawning ────────────────────────────────────────────────────────────────
  spawn(e, x, y, z, { vx = 0, vy = -2, vz = 0, spin = 6 } = {}) {
    const rb = e.rb;
    rb.setEnabled(true);
    rb.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    rb.setTranslation({ x, y, z }, true);
    const up = e.T.def.upright;
    const tilt = up ? 0.25 : e.T.def.shape === 'macaron' ? 1.6 : 3;
    _e.set((Math.random() - 0.5) * tilt, Math.random() * Math.PI * 2, (Math.random() - 0.5) * tilt);
    _q.setFromEuler(_e);
    rb.setRotation(_q, true);
    rb.setLinvel({ x: vx, y: vy, z: vz }, true);
    const sp = up ? 0.8 : spin;
    rb.setAngvel({ x: (Math.random() - 0.5) * sp, y: (Math.random() - 0.5) * spin * 0.5, z: (Math.random() - 0.5) * sp }, true);
    e.state = 'live'; e.vy = vy; e.bornAt = this.time; e.sq = 0; e.sqv = 0;
  }

  park(e) {
    e.rb.setEnabled(false);
    e.rb.setTranslation({ x: 0, y: -40 - e.id, z: 0 }, false);
    e.state = 'parked';
    e.T.im.setMatrixAt(e.i, ZERO);
  }

  /**
   * Rain pastries into a zone. `pick(e)` filters candidates; parked bodies are used first, then live ones
   * the camera cannot see (farthest from the zone), so the body count never grows.
   */
  rain({ x, z, rx = 2, rz = 1.4, count = 20, over = 2, height = [7, 11], pick = () => true, avoid = null, delay = 0, vy = -3, prefer = null } = {}) {
    const cand = this.entries.filter(e => (e.state === 'parked' || e.state === 'live') && !e.queued && this.held !== e && pick(e));
    // Parked bodies first, then ones the camera cannot see, then the farthest away; never the one just landed.
    const score = e => e.state === 'parked' ? -1e7 + Math.random() : (prefer && prefer(e) ? -1e6 : 0) - this._dist2(e, x, z) + (this.time - e.bornAt < 1.5 ? 1e5 : 0);
    const sc = new Map(cand.map(e => [e, score(e)]));
    cand.sort((a, b) => sc.get(a) - sc.get(b));
    const chosen = cand.slice(0, count);
    chosen.forEach((e, k) => {
      let px, pz, tries = 0;
      do {
        // Gaussian-ish heap: most land near the centre, some roll away.
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(-2 * Math.log(1 - Math.random() * 0.98)) * 0.55;
        px = x + Math.cos(a) * r * rx; pz = z + Math.sin(a) * r * rz;
        tries++;
      } while (avoid && avoid(px, pz) && tries < 12);
      pz = clamp(pz, COUNTER.z0 + 0.5, COUNTER.z1 - 0.4);
      e.queued = true;
      this.queue.push({ at: this.time + delay + (k / Math.max(1, chosen.length - 1)) ** 1.15 * over + Math.random() * 0.08, e, x: px, z: pz, y: lerp(height[0], height[1], Math.random()), vy });
    });
    this.queue.sort((a, b) => a.at - b.at);
    return chosen.length;
  }

  _dist2(e, x, z) { const t = e.rb.translation(); return (t.x - x) ** 2 + (t.z - z) ** 2; }

  // ── gestures ────────────────────────────────────────────────────────────────
  pick(origin, dir) {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRay(ray, 200, true, undefined, undefined, this.cursorCol, undefined, c => this.byCollider.has(c.handle));
    if (!hit) return null;
    const e = this.byCollider.get(hit.collider.handle);
    if (!e || (e.state !== 'live')) return null;
    return { e, toi: hit.timeOfImpact ?? hit.toi };
  }

  grab(e) {
    this.held = e;
    e.state = 'held';
    e.rb.wakeUp();
    e.rb.setAngularDamping(5);
    e.rb.setLinearDamping(0.5);
  }

  release() {
    const e = this.held;
    if (!e) return null;
    this.held = null;
    e.touchedAt = this.time;
    if (e.state === 'held') e.state = 'live';
    e.rb.setAngularDamping(e.T.def.adamp);
    e.rb.setLinearDamping(0.12);
    const v = e.rb.linvel();
    e.rb.setLinvel({ x: v.x * 1.15, y: v.y * 1.1, z: v.z * 1.15 }, true);
    return e;
  }

  /** Make every live pastry of a kind jump and flip, a few at a time. */
  hop(pick, { strength = 1, spread = 0.35 } = {}) {
    let n = 0;
    for (const e of this.entries) {
      if (e.state !== 'live' || !pick(e)) continue;
      this.impulses.push({ at: this.time + Math.random() * spread, e, kind: 'hop', s: strength * (0.85 + Math.random() * 0.3) });
      n++;
    }
    return n;
  }

  /** A knuckle on the marble: a ring of impulses travelling outward from the point. */
  knock(p, { radius = 4.6, speed = 8, strength = 1 } = {}) {
    for (const e of this.entries) {
      if (e.state !== 'live') continue;
      const t = e.rb.translation();
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d > radius) continue;
      this.impulses.push({ at: this.time + d / speed, e, kind: 'knock', s: strength * (1 - d / radius) ** 0.7, ox: (t.x - p.x) / (d + 1e-3), oz: (t.z - p.z) / (d + 1e-3) });
    }
  }

  _applyImpulse(it) {
    const e = it.e;
    if (e.state !== 'live') return;
    const rb = e.rb, m = rb.mass();
    rb.wakeUp();
    const lv = rb.linvel();
    if (it.kind === 'hop') {
      rb.setLinvel({ x: lv.x * 0.3 + (Math.random() - 0.5) * 1.2, y: 10.5 * it.s, z: lv.z * 0.3 + (Math.random() - 0.5) * 1.2 }, true);
      const a = Math.random() * Math.PI * 2, flip = e.T.def.upright ? 0.15 : 1;
      rb.setAngvel({ x: Math.cos(a) * 11 * it.s * flip, y: (Math.random() - 0.5) * 3, z: Math.sin(a) * 11 * it.s * flip }, true);
    } else {
      rb.applyImpulse({ x: it.ox * m * 2.2 * it.s, y: m * (3 + 8.5 * it.s), z: it.oz * m * 2.2 * it.s }, true);
      const flip = e.T.def.upright ? 0.15 : 1;
      rb.setAngvel({ x: (Math.random() - 0.5) * 12 * it.s * flip, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 12 * it.s * flip }, true);
    }
  }

  // ── simulation ──────────────────────────────────────────────────────────────
  setCursor(p, active) {
    this.cursor.active = active && !this.held;
    if (this.cursor.active) this.cursor.target.copy(p); else this.cursor.target.set(0, -30, 0);
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    while (this.queue.length && this.queue[0].at <= t) {
      const q = this.queue.shift();
      q.e.queued = false;
      if (q.e.state === 'held' || q.e.state === 'boxed' || q.e.state === 'fly') continue;
      this.spawn(q.e, q.x, q.y, q.z, { vy: q.vy, vx: (Math.random() - 0.5) * 1.5, vz: (Math.random() - 0.5) * 1.5 });
    }
    if (this.impulses.length) {
      this.impulses = this.impulses.filter(it => { if (it.at <= t) { this._applyImpulse(it); return false; } return true; });
    }

    // Held pastry: critically damped spring toward the target.
    if (this.held && this.holdActive !== false) {
      const rb = this.held.rb, p = rb.translation();
      const k = 16;
      let vx = (this.holdTarget.x - p.x) * k, vy = (this.holdTarget.y - p.y) * k, vz = (this.holdTarget.z - p.z) * k;
      const sp = Math.hypot(vx, vy, vz), max = 38;
      if (sp > max) { vx *= max / sp; vy *= max / sp; vz *= max / sp; }
      rb.setLinvel({ x: vx, y: vy, z: vz }, true);
    }

    // Sub-stepped world with the kinematic fingertip swept across each sub-step.
    const n = Math.max(1, Math.ceil(dt / (1 / 100)));
    const h = dt / n;
    this.world.timestep = h;
    const c = this.cursor, from = _p.copy(c.prev);
    const jump = from.distanceTo(c.target);
    if (jump > 2.5) { this.cursorBody.setTranslation(c.target, true); from.copy(c.target); }
    for (let s = 1; s <= n; s++) {
      const f = s / n;
      this.cursorBody.setNextKinematicTranslation({ x: lerp(from.x, c.target.x, f), y: lerp(from.y, c.target.y, f), z: lerp(from.z, c.target.z, f) });
      this.world.step();
    }
    c.prev.copy(c.target);

    // Sync instances, detect landings for sugar puffs and squash.
    for (const key in this.types) {
      const T = this.types[key];
      let dirty = false;
      for (const e of T.entries) {
        if (e.state === 'parked') continue;
        const rb = e.rb;
        const tr = rb.translation(), ro = rb.rotation(), lv = rb.linvel();
        if (tr.y < -4 || tr.x < COUNTER.x0 - 1 || tr.x > COUNTER.x1 + 1) {
          if (e.state === 'held') this.held = null;
          this.park(e); this.onLost?.(e); dirty = true; continue;
        }
        // Landing: downward speed collapses in one step.
        if (e.state === 'live' && e.vy < -6 && lv.y > e.vy * 0.45 && t - e.lastImpact > 0.12) {
          const sp = -e.vy;
          e.lastImpact = t;
          e.sqv -= Math.min(sp * 0.018, 0.5);
          this.onImpact?.(e, tr, sp);
        }
        e.vy = lv.y;
        // Tarts and croissants right themselves (a weeble's instinct: they are bottom-heavy).
        if (e.T.def.upright && e.state === 'live') {
          _p.set(0, 1, 0).applyQuaternion(_q.set(ro.x, ro.y, ro.z, ro.w));
          if (_p.y < 0.97) {
            // Even at rest on an edge (asleep), a tilted tart is nudged back flat.
            const m = rb.mass() * (e.T.def.key === 'tart' ? 7 : 3.5) * dt * (_p.y < 0 ? 2 : 1);
            rb.applyTorqueImpulse({ x: -_p.z * m, y: 0, z: _p.x * m }, true);
            if (e.T.def.key === 'tart') { const w = rb.angvel(); rb.setAngvel({ x: w.x * 0.94, y: w.y, z: w.z * 0.94 }, true); }
          }
        }
        // Squash & stretch spring (tiny: pastries are soft, not rubber).
        e.sqv += (-e.sq * 260 - e.sqv * 16) * dt;
        e.sq += e.sqv * dt;
        e.sq = clamp(e.sq, -0.12, 0.08);
        _q.set(ro.x, ro.y, ro.z, ro.w);
        _m.makeRotationFromQuaternion(_q);
        if (Math.abs(e.sq) > 0.002) {
          const el = _m.elements, sy = 1 + e.sq, sxz = 1 - e.sq * 0.5;
          el[0] *= sxz; el[4] *= sxz; el[8] *= sxz;
          el[1] *= sy; el[5] *= sy; el[9] *= sy;
          el[2] *= sxz; el[6] *= sxz; el[10] *= sxz;
        }
        _m.setPosition(tr.x, tr.y + (e.sq < 0 ? e.sq * T.hy : 0), tr.z);
        T.im.setMatrixAt(e.i, _m);
        dirty = true;
      }
      if (dirty) T.im.instanceMatrix.needsUpdate = true;
    }
  }

  /** Current world position of an entry (for UI / box logic). */
  pos(e, out = new THREE.Vector3()) { const t = e.rb.translation(); return out.set(t.x, t.y, t.z); }
  liveCount() { return this.entries.filter(e => e.state === 'live').length; }
}
