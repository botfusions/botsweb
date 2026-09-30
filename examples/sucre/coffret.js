// "Coffret de six": a pistachio gift box with six slots. Macarons dropped in snap to a slot;
// when the sixth lands the lid swings shut and a satin ribbon ties itself.
import { THREE, clamp, lerp } from '../../src/core/engine.js';
import { fbmNormal } from '../../src/core/textures.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { gsap } from '../../src/core/scroll.js';
import { RAPIER } from './pastry.js';

const W = 2.24, D = 1.52, H = 0.46, T = 0.045, LID_H = 0.17;
const SLOTS = [];
for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) SLOTS.push(new THREE.Vector3((i - 1) * 0.69, 0, (j - 0.5) * 0.7));
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();

// Ribbon crossing point on the lid (off-centre, so the gold lettering stays readable).
const RX = 0.6, RZ = 0.36;

function lidTexture(aspect) {
  const S = 1024, SH = Math.round(S / aspect);
  const c = document.createElement('canvas'); c.width = S; c.height = SH;
  const g = c.getContext('2d');
  const m = document.createElement('canvas'); m.width = S; m.height = SH;
  const mg = m.getContext('2d');
  g.fillStyle = '#b9c796'; g.fillRect(0, 0, S, SH);
  const n = g.createRadialGradient(S * 0.4, SH * 0.35, 0, S * 0.5, SH * 0.5, S * 0.75);
  n.addColorStop(0, 'rgba(255,255,240,.16)'); n.addColorStop(1, 'rgba(60,70,30,.1)');
  g.fillStyle = n; g.fillRect(0, 0, S, SH);
  mg.fillStyle = 'rgb(0,190,0)'; mg.fillRect(0, 0, S, SH);   // G = roughness, B = metalness
  const cx = S * 0.36;
  const foil = (ctx, isMat) => {
    ctx.strokeStyle = ctx.fillStyle = isMat ? 'rgb(0,70,255)' : '#d9b866';
    ctx.lineWidth = 6; ctx.strokeRect(34, 34, S - 68, SH - 68);
    ctx.lineWidth = 2; ctx.strokeRect(52, 52, S - 104, SH - 104);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = '600 22px "DM Sans", sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '9px';
    ctx.fillText('PÂTISSERIE · PARIS', cx, SH * 0.2);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.font = 'italic 500 132px "Playfair Display", Georgia, serif';
    ctx.fillText('Maison', cx, SH * 0.43);
    ctx.fillText('Sucre', cx + 38, SH * 0.63);
    ctx.font = '600 22px "DM Sans", sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '9px';
    ctx.fillText('DEPUIS 1962', cx, SH * 0.9);
  };
  foil(g, false); foil(mg, true);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const mr = new THREE.CanvasTexture(m); mr.anisotropy = 8;
  return { map, mr };
}

/** A flat satin strip swept along a curve; `up(t)` gives the direction across the ribbon's width. */
function ribbonStrip(curve, width, segs, up) {
  const pos = [], nor = [], uv = [], idx = [];
  const p = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, p); curve.getTangentAt(t, tan);
    side.copy(up(t, p)).normalize();
    n.crossVectors(tan, side).normalize();
    for (const s of [-0.5, 0.5]) {
      pos.push(p.x + side.x * width * s, p.y + side.y * width * s, p.z + side.z * width * s);
      nor.push(n.x, n.y, n.z);
      uv.push(s + 0.5, t);
    }
    if (i < segs) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class Coffret {
  constructor({ scene, renderer, pat, pos, onChange, toast }) {
    this.pat = pat; this.onChange = onChange; this.toast = toast;
    this.pos = pos.clone();
    this.slots = SLOTS.map(() => null);
    this.closed = false;
    this.busy = false;
    this.flying = [];

    const g = this.group = new THREE.Group();
    g.position.copy(pos);
    g.rotation.y = -0.08;
    scene.add(g);
    this.inv = new THREE.Matrix4();

    const paperN = fbmNormal(renderer, { size: 512, scale: 24, octaves: 4, strength: 0.35 });
    paperN.repeat.set(2, 2);
    const outer = new THREE.MeshStandardMaterial({ color: 0xb9c796, roughness: 0.72, normalMap: paperN, normalScale: new THREE.Vector2(0.4, 0.4), envMapIntensity: 0.8 });
    const inner = new THREE.MeshStandardMaterial({ color: 0xf7eee2, roughness: 0.85, normalMap: paperN, normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 0.6 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe0c07a, metalness: 1, roughness: 0.3, envMapIntensity: 1.5 });
    const add = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };

    add(new RoundedBoxGeometry(W, 0.05, D, 2, 0.015), outer, 0, 0.025, 0);
    add(new THREE.BoxGeometry(W - 2 * T, 0.012, D - 2 * T), inner, 0, 0.056, 0);
    for (const s of [-1, 1]) {
      add(new RoundedBoxGeometry(W, H, T, 2, 0.012), outer, 0, H / 2, s * (D / 2 - T / 2));
      add(new RoundedBoxGeometry(T, H, D - 2 * T, 2, 0.012), outer, s * (W / 2 - T / 2), H / 2, 0);
      add(new THREE.BoxGeometry(W - 2 * T - 0.004, H - 0.06, 0.008), inner, 0, H / 2 + 0.02, s * (D / 2 - T - 0.004));
      add(new THREE.BoxGeometry(0.008, H - 0.06, D - 2 * T - 0.004), inner, s * (W / 2 - T - 0.004), H / 2 + 0.02, 0);
      // gold foil band around the outside
      add(new THREE.BoxGeometry(W + 0.006, 0.05, 0.004), gold, 0, H * 0.52, s * (D / 2 + 0.002));
      add(new THREE.BoxGeometry(0.004, 0.05, D + 0.006), gold, s * (W / 2 + 0.002), H * 0.52, 0);
    }
    // cream dividers with gilded top edges
    for (const x of [-0.345, 0.345]) { add(new THREE.BoxGeometry(0.018, 0.2, D - 2 * T - 0.02), inner, x, 0.16, 0); add(new THREE.BoxGeometry(0.02, 0.006, D - 2 * T - 0.02), gold, x, 0.262, 0); }
    add(new THREE.BoxGeometry(W - 2 * T - 0.02, 0.2, 0.018), inner, 0, 0.16, 0);
    add(new THREE.BoxGeometry(W - 2 * T - 0.02, 0.006, 0.02), gold, 0, 0.262, 0);

    // Lid, hinged along the back top edge.
    const { map, mr } = lidTexture((W + 0.05) / (D + 0.05));
    const lidTop = new THREE.MeshStandardMaterial({ map, roughnessMap: mr, metalnessMap: mr, roughness: 1, metalness: 1, envMapIntensity: 2.2, normalMap: paperN, normalScale: new THREE.Vector2(0.25, 0.25),
      emissiveMap: mr, emissive: new THREE.Color(0.0, 0.0, 0.0) });
    // Foil catches a little light from every angle (the mask lives in the blue channel): tint the emissive gold.
    lidTop.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += vec3(0.30, 0.22, 0.09) * texture2D(emissiveMap, vEmissiveMapUv).b;'); };
    const lidMats = [outer, outer, lidTop, outer, outer, outer];
    this.hinge = new THREE.Group();
    this.hinge.position.set(0, H, -D / 2 - 0.02);
    g.add(this.hinge);
    const LW = W + 0.05, LD = D + 0.05;
    const top = new THREE.Mesh(new THREE.BoxGeometry(LW, 0.04, LD), lidMats);
    top.position.set(0, 0.02, LD / 2 - 0.005); top.castShadow = top.receiveShadow = true; this.hinge.add(top);
    add(new RoundedBoxGeometry(LW, LID_H, 0.03, 2, 0.01), outer, 0, -LID_H / 2 + 0.04, LD - 0.02, this.hinge);
    add(new RoundedBoxGeometry(LW, LID_H, 0.03, 2, 0.01), outer, 0, -LID_H / 2 + 0.04, 0.01, this.hinge);
    for (const s of [-1, 1]) add(new RoundedBoxGeometry(0.03, LID_H, LD, 2, 0.01), outer, s * (LW / 2 - 0.015), -LID_H / 2 + 0.04, LD / 2 - 0.005, this.hinge);
    this.lidOpen = -1.98;
    this.hinge.rotation.x = this.lidOpen;

    // Satin ribbon (hidden until the box is full): two bands crossing off-centre and a proper bow.
    const satin = new THREE.MeshPhysicalMaterial({ color: 0xe48ea4, roughness: 0.4, sheen: 1, sheenColor: new THREE.Color(0xffdbe4), sheenRoughness: 0.28, envMapIntensity: 1.1, side: THREE.DoubleSide });
    const bowSatin = satin.clone(); bowSatin.color.set(0xf6a9bc); bowSatin.sheenColor.set(0xffe6ec);
    this.ribbon = new THREE.Group();
    g.add(this.ribbon);
    const RY = H + 0.062, RW = 0.16;
    this.bandX = new THREE.Group(); this.bandZ = new THREE.Group();
    this.bandX.position.z = RZ; this.bandZ.position.x = RX;
    this.ribbon.add(this.bandX, this.bandZ);
    const rb = (geo, x, y, z, parent) => { const m = new THREE.Mesh(geo, satin); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
    rb(new THREE.BoxGeometry(LW + 0.02, 0.012, RW), 0, RY, 0, this.bandX);
    for (const s of [-1, 1]) rb(new THREE.BoxGeometry(0.012, H + 0.06, RW), s * (LW / 2 + 0.007), (H + 0.06) / 2, 0, this.bandX);
    rb(new THREE.BoxGeometry(RW, 0.013, LD + 0.02), 0, RY + 0.002, 0, this.bandZ);
    for (const s of [-1, 1]) rb(new THREE.BoxGeometry(RW, H + 0.06, 0.012), 0, (H + 0.06) / 2, s * (LD / 2 + 0.007), this.bandZ);
    this.bow = new THREE.Group();
    this.bow.position.set(RX, RY + 0.008, RZ);
    this.bow.rotation.y = 0.5;
    this.ribbon.add(this.bow);
    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    for (const s of [-1, 1]) {
      // Loop: a teardrop that leaves the knot, swells outward and comes back underneath.
      const loop = new THREE.CatmullRomCurve3([V3(0, 0.03, 0), V3(s * 0.12, 0.13, 0.02), V3(s * 0.28, 0.17, 0.03), V3(s * 0.36, 0.09, 0.02), V3(s * 0.3, 0.02, 0), V3(s * 0.14, 0.015, -0.01)], true, 'centripetal');
      const l = rb(ribbonStrip(loop, 0.13, 72, () => V3(0.05 * s, 0.25, 1)), 0, 0, 0, this.bow);
      l.rotation.set(0.12 * s, 0, 0);
      // Tail: drops from the knot onto the lid and lies flat.
      const tail = new THREE.CatmullRomCurve3([V3(0, 0.03, 0), V3(s * 0.06, 0.02, 0.1), V3(s * 0.12, 0.004, 0.26), V3(s * 0.2, 0.0, 0.44)]);
      rb(ribbonStrip(tail, 0.12, 30, t => V3(1, 0.3 * (1 - t), -0.25 * s)), 0, 0, 0, this.bow);
    }
    this.bow.traverse(o => { if (o.isMesh) o.material = bowSatin; });
    const knot = rb(new THREE.SphereGeometry(0.07, 20, 14), 0, 0.045, 0, this.bow);
    knot.material = bowSatin;
    knot.scale.set(1.15, 0.8, 1.2);
    this.bandX.scale.set(0.001, 1, 1); this.bandZ.scale.set(1, 1, 0.001); this.bow.scale.setScalar(0.001);
    this.ribbon.visible = false;

    // Physics: the tray is fixed; the lid top becomes solid once closed.
    const world = pat.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation(new THREE.Quaternion().setFromEuler(g.rotation)));
    const cd = (hx, hy, hz, x, y, z) => world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.8).setRestitution(0.2), this.body);
    cd(W / 2, 0.028, D / 2, 0, 0.028, 0);
    cd(W / 2, H / 2, T / 2, 0, H / 2, D / 2 - T / 2); cd(W / 2, H / 2, T / 2, 0, H / 2, -D / 2 + T / 2);
    cd(T / 2, H / 2, D / 2, W / 2 - T / 2, H / 2, 0); cd(T / 2, H / 2, D / 2, -W / 2 + T / 2, H / 2, 0);
    this.lidCollider = null;
    g.updateMatrixWorld(true);
    this.inv.copy(g.matrixWorld).invert();
    this.emit();
  }

  get filled() { return this.slots.filter(Boolean).length; }

  local(p, out = _v) { return out.copy(p).applyMatrix4(this.inv); }
  slotWorld(i, out = new THREE.Vector3()) { return out.copy(SLOTS[i]).applyMatrix4(this.group.matrixWorld); }

  /** Is a world point over the open tray (with a margin)? */
  over(p, margin = 0) {
    const l = this.local(p);
    return Math.abs(l.x) < W / 2 + margin && Math.abs(l.z) < D / 2 + margin;
  }

  freeSlotNear(p) {
    const l = this.local(p);
    let best = -1, bd = 1e9;
    this.slots.forEach((s, i) => { if (s) return; const d = (SLOTS[i].x - l.x) ** 2 + (SLOTS[i].z - l.z) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  }

  /** Fly a macaron into a slot along an arc. */
  capture(e, { apex = 0.9, dur = 0.55, slot = -1 } = {}) {
    if (this.closed || this.busy) return false;
    const pat = this.pat;
    const p0 = pat.pos(e);
    const i = slot >= 0 ? slot : this.freeSlotNear(p0);
    if (i < 0) return false;
    this.slots[i] = e;
    if (pat.held === e) pat.release();
    e.state = 'fly';
    e.rb.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    const r0 = e.rb.rotation();
    const q0 = new THREE.Quaternion(r0.x, r0.y, r0.z, r0.w);
    const q1 = new THREE.Quaternion().setFromEuler(_e.set(0, this.group.rotation.y + (Math.random() - 0.5) * 0.9, 0));
    const p1 = this.slotWorld(i);
    p1.y = this.pos.y + 0.056 + e.T.hy + 0.004;
    const top = Math.max(p0.y, p1.y) + apex;
    this.flying.push({ e, i, p0, p1, q0, q1, top, t: 0, dur });
    this.emit();
    return true;
  }

  update(dt) {
    const pat = this.pat;
    for (const f of this.flying) {
      f.t += dt / f.dur;
      const k = clamp(f.t), u = 1 - k;
      const ease = k < 1 ? 1 - Math.pow(1 - k, 2.2) : 1;
      // quadratic bezier with a lifted control point
      const cx = (f.p0.x + f.p1.x) / 2, cz = (f.p0.z + f.p1.z) / 2, cy = f.top * 2 - (f.p0.y + f.p1.y) / 2;
      const x = u * u * f.p0.x + 2 * u * k * cx + k * k * f.p1.x;
      const y = u * u * f.p0.y + 2 * u * k * cy + k * k * f.p1.y;
      const z = u * u * f.p0.z + 2 * u * k * cz + k * k * f.p1.z;
      f.e.rb.setNextKinematicTranslation({ x, y, z });
      _q.copy(f.q0).slerp(f.q1, ease);
      f.e.rb.setNextKinematicRotation(_q);
      if (f.t >= 1 && !f.done) {
        f.done = true;
        f.e.state = 'boxed';
        f.e.sqv -= 0.35;
        this.onLand?.(f.e, f.p1);
      }
    }
    this.flying = this.flying.filter(f => !f.done);

    if (this.closed || this.busy || pat.time < (this.cooldownUntil ?? 0)) return;
    // Pastries that fall or roll into the open tray.
    for (const e of pat.entries) {
      if (e.state !== 'live') continue;
      const t = e.rb.translation();
      if (t.y > this.pos.y + H + 0.5 || t.y < this.pos.y) continue;
      _v.set(t.x, t.y, t.z);
      if (!this.over(_v, -0.06)) continue;
      const isMac = e.T.def.key === 'macA' || e.T.def.key === 'macB';
      const byHand = pat.time - (e.touchedAt ?? -99) < 4;
      if (isMac && this.filled < 6 && (byHand || this.filled > 0 || pat.time - e.bornAt > 3)) this.capture(e, { apex: 0.35, dur: 0.35 });
      else this.eject(e, !byHand ? null : isMac ? 'This one is full — six is the rule.' : 'Macarons only in the coffret, s’il vous plaît.');
    }
    if (this.filled === 6 && !this.flying.length && !this.closed) this.close();
  }

  eject(e, msg) {
    const t = e.rb.translation();
    const l = this.local(_v.set(t.x, t.y, t.z));
    const dir = new THREE.Vector3(Math.sign(l.x || 1) * 0.6, 0, 1).applyQuaternion(this.group.quaternion).normalize();
    e.rb.setLinvel({ x: dir.x * 5, y: 9, z: dir.z * 5 }, true);
    e.rb.setAngvel({ x: 6, y: 0, z: -4 }, true);
    if (msg && (!this._lastEject || pat_time() - this._lastEject > 2)) { this.toast?.(msg); this._lastEject = pat_time(); }
  }

  releasedOver(e) {
    const p = this.pat.pos(e);
    if (this.closed || this.busy || !this.over(p, 0.35) || p.y > this.pos.y + 4) return false;
    const isMac = e.T.def.key === 'macA' || e.T.def.key === 'macB';
    if (!isMac) return false;
    if (this.filled >= 6) return false;
    return this.capture(e, { apex: 0.4, dur: 0.4 });
  }

  /** Fly the nearest free macarons in, one after another, until the box is full (summoning more if needed). */
  fillForMe() {
    if (this.closed || this.busy || this._filling) return;
    this._filling = true;
    const isMac = e => e.T.def.key === 'macA' || e.T.def.key === 'macB';
    let summoned = 0;
    const step = () => {
      const need = 6 - this.filled;
      if (this.closed || this.busy || need <= 0) { this._filling = false; return; }
      const inBox = new Set(this.slots.filter(Boolean).map(e => e.flavour));
      const c = this.pos, pat = this.pat;
      let best = null, bd = 1e9;
      for (const e of pat.entries) {
        if (e.state !== 'live' || e.queued || !isMac(e) || pat.held === e) continue;
        const d = pat._dist2(e, c.x, c.z) + (inBox.has(e.flavour) ? 40 : 0);   // prefer a flavour the box lacks
        if (d < bd && d < 160 + (inBox.has(e.flavour) ? 40 : 0)) { bd = d; best = e; }
      }
      if (!best) {
        if (summoned++ > 2) { this._filling = false; this.toast?.('The counter is out of macarons — hold the marble to make it rain.'); return; }
        pat.rain({ x: c.x + 1.9, z: c.z + 0.9, rx: 0.9, rz: 0.5, count: need, over: 0.5, pick: isMac, height: [7, 9] });
        setTimeout(step, 1300);
        return;
      }
      this.capture(best, { apex: 2.4, dur: 0.85 });
      setTimeout(step, 240);
    };
    step();
  }

  close() {
    this.closed = true;
    this.busy = true;
    this.emit();
    const tl = gsap.timeline({ delay: 0.35, onComplete: () => { this.busy = false; this.emit(); } });
    tl.to(this.hinge.rotation, { x: 0.03, duration: 0.9, ease: 'power2.in' })
      .to(this.hinge.rotation, { x: 0, duration: 0.35, ease: 'elastic.out(1, 0.5)' })
      .add(() => {
        this.onThud?.();
        const w = this.pat.world;
        const q = new THREE.Quaternion().setFromEuler(this.group.rotation);
        this.lidCollider = w.createCollider(RAPIER.ColliderDesc.cuboid(W / 2 + 0.03, 0.05, D / 2 + 0.03).setTranslation(0, H + 0.05, 0).setFriction(0.8), this.body);
        this.ribbon.visible = true;
      }, '-=0.3')
      .to(this.bandX.scale, { x: 1, duration: 0.55, ease: 'power3.out' })
      .to(this.bandZ.scale, { z: 1, duration: 0.55, ease: 'power3.out' }, '-=0.25')
      .to(this.bow.scale, { x: 1, y: 1, z: 1, duration: 0.8, ease: 'back.out(2.4)', onStart: () => this.onTied?.() }, '-=0.15')
      .to(this.group.position, { y: this.pos.y + 0.35, duration: 0.22, ease: 'power2.out' }, '-=0.5')
      .to(this.group.position, { y: this.pos.y, duration: 0.5, ease: 'bounce.out' });
  }

  reset() {
    if (!this.closed || this.busy) return;
    this.busy = true;
    const tl = gsap.timeline({ onComplete: () => { this.busy = false; this.closed = false; this.emit(); } });
    tl.to(this.bow.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.3, ease: 'power2.in' })
      .to([this.bandX.scale], { x: 0.001, duration: 0.3, ease: 'power2.in' }, '-=0.1')
      .to([this.bandZ.scale], { z: 0.001, duration: 0.3, ease: 'power2.in' }, '-=0.2')
      .add(() => {
        this.ribbon.visible = false;
        if (this.lidCollider) { this.pat.world.removeCollider(this.lidCollider, true); this.lidCollider = null; }
        // Anything that was resting on the lid slides off rather than dropping into the tray.
        for (const e of this.pat.entries) {
          if (e.state !== 'live') continue;
          const p = this.pat.pos(e);
          if (!this.over(p, 0.1) || p.y < this.pos.y + H - 0.2) continue;
          const l = this.local(p.clone());
          const d = new THREE.Vector3(Math.sign(l.x || 1) * 0.7, 0, 1).applyQuaternion(this.group.quaternion).normalize();
          e.rb.setLinvel({ x: d.x * 4.5, y: 6, z: d.z * 4.5 }, true);
        }
        this.cooldownUntil = this.pat.time + 3;
      })
      .to(this.hinge.rotation, { x: this.lidOpen, duration: 0.8, ease: 'power3.inOut' })
      .add(() => {
        // Everyone out: the macarons pop from their slots back onto the marble.
        this.cooldownUntil = this.pat.time + 2.6;
        this.slots.forEach((e, i) => {
          if (!e) return;
          e.rb.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
          e.state = 'live';
          const t0 = e.rb.translation();
          e.rb.setTranslation({ x: t0.x, y: this.pos.y + H + e.T.hy + 0.05, z: t0.z }, true);   // clear of the tray walls
          e.sqv += 0.4;
          // Out and away from the tray: each one leaves in the direction of its own slot, toward the front.
          const d = new THREE.Vector3(SLOTS[i].x * 2.2, 0, SLOTS[i].z + 0.45).applyQuaternion(this.group.quaternion).normalize();
          e.rb.setLinvel({ x: d.x * 2.9, y: 9 + Math.random() * 2, z: d.z * 2.4 }, true);
          e.rb.setAngvel({ x: (Math.random() - 0.5) * 16, y: 0, z: (Math.random() - 0.5) * 16 }, true);
        });
        this.slots = this.slots.map(() => null);
        this.emit();
      }, '-=0.35');
  }

  emit() {
    this.onChange?.({ slots: this.slots.map(e => e?.flavour ?? null), filled: this.filled, closed: this.closed, busy: this.busy });
  }
}

let _clock = 0;
const pat_time = () => (_clock = performance.now() / 1000);
