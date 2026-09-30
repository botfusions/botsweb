// The walker. Scroll sets a target distance along the traverse; the astronaut follows it with a soft speed cap.
// The gait phase is advanced by *distance* (not time), so planted boots never slide at any scroll speed:
// walk → lunar lope (the run clip, slowed, with extra 1/6 g flight) → "time-lapse" when you scroll hard.
// Idle is synthesised (the Meshy idle preset is broken): suit rest pose, arms eased down, breathing.
import { THREE, damp, clamp, smooth, lerp } from '../../src/core/engine.js';

const V = () => new THREE.Vector3();

function analyse(model, mixer, clip, bones) {
  const act = mixer.clipAction(clip);
  mixer.stopAllAction();
  act.reset().play().setEffectiveWeight(1);
  const N = 96, rows = [];
  const a = V(), b = V();
  for (let i = 0; i <= N; i++) {
    act.time = (clip.duration * i) / N; mixer.update(0); model.updateMatrixWorld(true);
    bones.lf.getWorldPosition(a); bones.rf.getWorldPosition(b);
    rows.push({ t: act.time, ly: a.y, lz: a.z, ry: b.y, rz: b.z });
  }
  act.stop();
  const minL = Math.min(...rows.map(r => r.ly)), minR = Math.min(...rows.map(r => r.ry));
  // stance velocity: foot low and moving backwards relative to the hips
  let vs = 0, vn = 0;
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1], q = rows[i], dt = q.t - p.t;
    if (p.ly < minL + 0.012 && q.ly < minL + 0.012) { vs += -(q.lz - p.lz) / dt; vn++; }
    if (p.ry < minR + 0.012 && q.ry < minR + 0.012) { vs += -(q.rz - p.rz) / dt; vn++; }
  }
  const speed = vs / Math.max(1, vn);
  // left heel strike phase
  let contact = 0;
  for (let i = 1; i < rows.length; i++) if (rows[i].ly < minL + 0.014 && rows[i - 1].ly >= minL + 0.014) { contact = i / N; break; }
  // flight: both feet clearly off the ground
  const air = rows.map(r => (r.ly > minL + 0.03 && r.ry > minR + 0.03 ? 1 : 0));
  const lift = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    if (!air[i]) continue;
    let s = i, e = i;
    while (s > 0 && air[s - 1]) s--;
    while (e < N && air[e + 1]) e++;
    lift[i] = Math.sin(Math.PI * (i - s + 0.5) / (e - s + 1));
  }
  return { speed, stride: speed * clip.duration, contact, lift, footY: (minL + minR) / 2 };
}

function idleClip(model, bones) {
  // Rest pose tracks for every animated bone, with the arms lowered and a slow breathing cycle.
  model.updateMatrixWorld(true);
  const rest = new Map();
  model.traverse(o => { if (o.isBone) rest.set(o, { q: o.quaternion.clone(), p: o.position.clone() }); });
  const worldQ = o => o.getWorldQuaternion(new THREE.Quaternion());
  const lowerArm = (arm, fore, down, fwd) => {
    const d = fore.getWorldPosition(V()).sub(arm.getWorldPosition(V())).normalize();
    const axis = V().crossVectors(d, V().set(0, -1, 0)).normalize();
    const qW = new THREE.Quaternion().setFromAxisAngle(axis, down);
    const newW = qW.multiply(worldQ(arm));
    const parentW = worldQ(arm.parent);
    arm.quaternion.copy(parentW.invert().multiply(newW));
    arm.updateMatrixWorld(true);
    // bend the elbow forward a touch
    const d2 = fore.children[0]?.getWorldPosition(V()).sub(fore.getWorldPosition(V())).normalize() ?? V(0, -1, 0);
    const ax2 = V().crossVectors(d2, V().set(0, 0, 1)).normalize();
    const q2 = new THREE.Quaternion().setFromAxisAngle(ax2, fwd).multiply(worldQ(fore));
    fore.quaternion.copy(worldQ(fore.parent).invert().multiply(q2));
    fore.updateMatrixWorld(true);
  };
  lowerArm(bones.la, bones.lfa, 0.36, 0.3);
  lowerArm(bones.ra, bones.rfa, 0.36, 0.3);
  const pose = new Map();
  model.traverse(o => { if (o.isBone) pose.set(o, { q: o.quaternion.clone(), p: o.position.clone() }); });
  // restore rest so the mixer's bindings see the true bind pose
  for (const [o, r] of rest) { o.quaternion.copy(r.q); o.position.copy(r.p); }
  const T = 4.8, times = [0, 1.2, 2.4, 3.6, 4.8];
  const tracks = [];
  const breathe = [0, 1, 0, -1, 0];
  for (const [o, s] of pose) {
    const vals = [];
    for (let k = 0; k < times.length; k++) {
      const q = s.q.clone();
      const b = breathe[k];
      if (o === bones.spine) q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(b * 0.018, 0, 0)));
      if (o === bones.head) q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.03 + b * 0.01, Math.sin(k / 4 * Math.PI * 2) * 0.05, 0)));
      if (o === bones.la || o === bones.ra) q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(b * 0.02, 0, 0)));
      vals.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${o.name}.quaternion`, times, vals));
    if (o === bones.hips) {
      const pv = [];
      for (let k = 0; k < times.length; k++) pv.push(s.p.x, s.p.y + breathe[k] * 0.35 - 0.6, s.p.z);
      tracks.push(new THREE.VectorKeyframeTrack(`${o.name}.position`, times, pv));
    }
  }
  return new THREE.AnimationClip('idle-synth', T, tracks);
}

export class Astronaut {
  constructor(gltf, H, { onStep, onLift } = {}) {
    this.H = H; this.onStep = onStep; this.onLift = onLift;
    this.root = new THREE.Group();
    this.model = gltf.scene;
    this.root.add(this.model);
    const get = n => this.model.getObjectByName(n);
    this.bones = { hips: get('Hips'), lf: get('LeftFoot'), rf: get('RightFoot'), lt: get('LeftToeBase'), rt: get('RightToeBase'),
      spine: get('Spine01'), head: get('Head'), la: get('LeftArm'), ra: get('RightArm'), lfa: get('LeftForeArm'), rfa: get('RightForeArm') };
    this.model.traverse(o => { if (o.isSkinnedMesh) { o.frustumCulled = false; this.mesh = o; } });
    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = n => gltf.animations.find(a => a.name === n);
    this.walkClip = clip('walk'); this.runClip = clip('run');
    this.walkInfo = analyse(this.model, this.mixer, this.walkClip, this.bones);
    this.runInfo = analyse(this.model, this.mixer, this.runClip, this.bones);
    this.idle = idleClip(this.model, this.bones);
    this.mixer.stopAllAction();
    this.aWalk = this.mixer.clipAction(this.walkClip).play();
    this.aRun = this.mixer.clipAction(this.runClip).play();
    this.aIdle = this.mixer.clipAction(this.idle).play();
    this.aWalk.timeScale = 0; this.aRun.timeScale = 0;
    this.runOffset = this.runInfo.contact - this.walkInfo.contact;
    // state
    this.curve = H.curve; this.len = this.curve.getLength();
    this.d = 0; this.v = 0; this.phase = 0.12; this.moveW = 0; this.runW = 0; this.yaw = 0;
    this.stillT = 10; this.steps = 0; this.lift = 0;
    this.feet = [
      { ankle: this.bones.lf, toe: this.bones.lt, down: false, side: 'L' },
      { ankle: this.bones.rf, toe: this.bones.rt, down: false, side: 'R' },
    ];
    this.pos = V(); this.fwd = V(1, 0, 0); this.side = V(0, 0, 1);
    this._a = V(); this._b = V(); this._t = V();
    this.pose(0, 0);
    console.info(`[artemis] walk ${this.walkInfo.speed.toFixed(2)} m/s stride ${this.walkInfo.stride.toFixed(2)} m · run ${this.runInfo.speed.toFixed(2)} m/s stride ${this.runInfo.stride.toFixed(2)} m · offset ${this.runOffset.toFixed(3)}`);
  }

  get stride() { return lerp(this.walkInfo.stride, this.runInfo.stride, this.runW); }

  // Place root on the path at distance d and evaluate the blended pose at the current phase.
  pose(dt, idleDt) {
    const u = clamp(this.d / this.len, 0, 1);
    const p = this.curve.getPointAt(u), tg = this.curve.getTangentAt(u);
    const yaw = Math.atan2(tg.x, tg.z);
    this.yaw = this.yawInit ? yaw : yaw; this.yawInit = true;
    const ph = ((this.phase % 1) + 1) % 1;
    const rph = (((this.phase + this.runOffset) % 1) + 1) % 1;
    const li = this.runInfo.lift, n = li.length - 1, fi = rph * n, i0 = Math.floor(fi);
    const lift = (li[i0] + (li[Math.min(n, i0 + 1)] - li[i0]) * (fi - i0)) * this.runW * this.moveW;
    this.lift = lift;
    this.root.position.set(p.x, this.H.heightAt(p.x, p.z) + lift * 0.3 - 0.004, p.z);
    this.root.rotation.y = this.yaw + (this.yawOffset || 0);
    this.fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.side.set(this.fwd.z, 0, -this.fwd.x).negate();
    this.pos.copy(this.root.position);
    const w = this.moveW;
    this.aWalk.setEffectiveWeight(w * (1 - this.runW));
    this.aRun.setEffectiveWeight(w * this.runW);
    this.aIdle.setEffectiveWeight(1 - w);
    this.aWalk.time = ph * this.walkClip.duration;
    this.aRun.time = rph * this.runClip.duration;
    this.mixer.update(idleDt);
    this.root.updateMatrixWorld(true);
  }

  detect(emit, time) {
    const moving = this.moveW > 0.55 && this.v > 0.04;
    for (const f of this.feet) {
      const a = f.ankle.getWorldPosition(this._a), t = f.toe.getWorldPosition(this._b);
      const h = a.y - this.root.position.y;
      const low = this.walkInfo.footY + 0.016, high = this.walkInfo.footY + 0.05;
      if (!f.down && h < low && (moving || !emit)) {
        f.down = true;
        if (moving && emit) {
          const dir = this._t.copy(t).sub(a); dir.y = 0; dir.normalize();
          const cx = a.x + dir.x * 0.07, cz = a.z + dir.z * 0.07;
          this.steps++;
          this.onStep?.({ x: cx, z: cz, yaw: Math.atan2(dir.x, dir.z), foot: f.side, speed: this.v, lope: this.runW, time, toe: t.clone() });
        }
      } else if (f.down && h > high) {
        f.down = false;
        if (moving && emit) this.onLift?.({ toe: t.clone(), fwd: this.fwd.clone(), speed: this.v, lope: this.runW, time });
      }
    }
  }

  // Jump straight to distance d, stamping every print along the way (reload mid-page, nav links).
  simulateTo(d, stamp) {
    const saveOn = this.onLift; this.onLift = null;
    this.moveW = 1; this.runW = 0; this.v = 1;
    while (this.d < d - 0.05) {
      const s = Math.min(0.08, d - this.d);
      this.d += s; this.phase += s / this.stride;
      this.pose(0, 0);
      this.detect(stamp, 0);
    }
    this.onLift = saveOn;
    this.v = 0; this.moveW = 0;
  }

  update(dt, target, time) {
    target = clamp(target, 0, this.len - 0.4);
    const gap = target - this.d;
    const vmax = 2.5 + Math.max(0, Math.abs(gap) - 5) * 1.4;
    const vDes = clamp(gap * 2.1, -vmax, vmax);
    this.v = damp(this.v, vDes, 3.2, dt);
    if (Math.abs(gap) < 0.004 && Math.abs(this.v) < 0.02) this.v = 0;
    const sp = Math.abs(this.v);
    this.stillT = sp > 0.05 ? 0 : this.stillT + dt;
    this.moveW = damp(this.moveW, this.stillT < 0.18 ? 1 : 0, this.stillT < 0.18 ? 5 : 3, dt);
    this.runW = damp(this.runW, smooth(1.6, 2.8, sp), 2.5, dt);
    // never walk past the ends of the traverse (the damped velocity would otherwise overshoot)
    const dMax = this.len - 0.4;
    if (this.d + this.v * dt > dMax) this.v = Math.max(0, (dMax - this.d) / dt);
    if (this.d + this.v * dt < 0) this.v = Math.min(0, -this.d / dt);
    const ds = this.v * dt;
    const n = Math.min(24, Math.max(1, Math.ceil(Math.abs(ds) / 0.09)));
    for (let k = 1; k <= n; k++) {
      this.d += ds / n;
      this.phase += ds / n / this.stride;
      this.pose(k === n ? dt : 0, k === n ? dt : 0);
      this.detect(true, time - dt * (1 - k / n));
    }
  }
}
