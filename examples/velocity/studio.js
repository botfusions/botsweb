// The lab: a white cyclorama, a measured floor mat with soft planar reflection, and drei-style contact shadows.
import { THREE } from '../../src/core/engine.js';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export const MM = 142.5; // millimetres per scene unit (the shoe is 2 units = 285 mm long)

/** Floor mat texture: 1 cm minor grid, 5 cm major, millimetre ruler along the front edge, fading out radially. */
export function matTexture(size = 2048, span = 7) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#f3f4f6'; g.fillRect(0, 0, size, size);
  const ppu = size / span, cm = ppu * 10 / MM;
  const cx = size / 2, cy = size / 2;
  const fade = (x, y) => { const d = Math.hypot(x - cx, y - cy) / (size / 2); return Math.max(0, 1 - Math.pow(d / 0.92, 2.2)); };
  // grid lines drawn as short segments so each can fade with radius
  const seg = 16;
  for (let i = -60; i <= 60; i++) {
    const p = cx + i * cm; if (p < 0 || p > size) continue;
    const major = i % 5 === 0;
    for (let s = 0; s < size; s += seg) {
      for (const vertical of [true, false]) {
        const x = vertical ? p : s + seg / 2, y = vertical ? s + seg / 2 : p;
        const a = fade(x, y) * (major ? 0.16 : 0.075);
        if (a < 0.004) continue;
        g.fillStyle = `rgba(28,32,40,${a})`;
        if (vertical) g.fillRect(p - (major ? 1 : 0.6), s, major ? 2 : 1.2, seg); else g.fillRect(s, p - (major ? 1 : 0.6), seg, major ? 2 : 1.2);
      }
    }
  }
  // millimetre ruler along the front (towards +z = bottom of the texture)
  const ry = cy + 4.2 * cm * 2.2;
  g.fillStyle = 'rgba(20,22,28,.5)';
  for (let mm = -150; mm <= 150; mm++) {
    const x = cx + mm * cm / 10; const len = mm % 10 === 0 ? 26 : mm % 5 === 0 ? 16 : 8;
    const a = fade(x, ry) * 0.9; if (a < 0.02) continue;
    g.globalAlpha = a; g.fillRect(x - 0.6, ry, 1.2, len);
  }
  g.globalAlpha = 1;
  g.font = '500 17px "JetBrains Mono", monospace'; g.textAlign = 'center';
  for (let mm = -140; mm <= 140; mm += 20) {
    const x = cx + mm * cm / 10; const a = fade(x, ry) * 0.6; if (a < 0.05) continue;
    g.fillStyle = `rgba(20,22,28,${a})`; g.fillText(String(mm + 140).padStart(3, '0'), x, ry + 50);
  }
  // crosshair registration marks at the mat corners
  g.strokeStyle = 'rgba(20,22,28,.28)'; g.lineWidth = 2;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = cx + sx * 12.5 * cm, y = cy + sy * 7.5 * cm;
    g.beginPath(); g.moveTo(x - 22, y); g.lineTo(x + 22, y); g.moveTo(x, y - 22); g.lineTo(x, y + 22); g.stroke();
    g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  return t;
}

/** Cyclorama: floor sweep curving up into a back wall. Returns { floor, sweep }. */
export function buildCyc({ z0 = -3.2, R = 4.2, width = 70, top = 26, floorColor = 0xf2f3f5, wallColor = 0xeceef1 }) {
  const group = new THREE.Group();
  // Floor (flat, reflective) — separate so the planar reflection stays exact.
  const floorGeo = new THREE.PlaneGeometry(width, 40, 1, 1);
  floorGeo.rotateX(-Math.PI / 2);
  floorGeo.translate(0, 0, z0 + 20);
  const floorMat = new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.42, metalness: 0, envMapIntensity: 0.5 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.receiveShadow = true;
  group.add(floor);
  // Sweep + wall
  const prof = [];
  const N = 40;
  for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI / 2; prof.push([z0 - Math.sin(a) * R, R - Math.cos(a) * R]); }
  prof.push([z0 - R, top]);
  const cols = 2, rows = prof.length;
  const pos = [], idx = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) pos.push((c ? 1 : -1) * width / 2, prof[r][1], prof[r][0]);
  for (let r = 0; r < rows - 1; r++) { const a = r * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sg.setIndex(idx); sg.computeVertexNormals();
  const sweepMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 1, metalness: 0, envMapIntensity: 0.45 });
  // A soft light pool on the sweep behind the subject (a spotlight edge would show as a dome).
  sweepMat.userData.halo = { uHalo: { value: new THREE.Vector3(0.5, 1.6, 0.34) }, uHaloI: { value: 0.3 } };
  sweepMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, sweepMat.userData.halo);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; uniform vec3 uHalo; uniform float uHaloI;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec2 hd = (vWp.xy - uHalo.xy) * vec2(0.16, 0.24);
        totalEmissiveRadiance += vec3(uHaloI) * exp(-dot(hd, hd) * 1.6) + vec3(uHaloI * 0.35) * smoothstep(8.0, 0.0, vWp.y);`);
  };
  const sweep = new THREE.Mesh(sg, sweepMat);
  sweep.receiveShadow = true;
  group.add(sweep);
  return { group, floor, floorMat, sweep, sweepMat };
}

/** Soft contact shadow: depth from below, blurred, laid on the floor. */
export class ContactShadow {
  constructor(renderer, { size = 512, width = 4.2, height = 4.2, far = 1.0, blur = 2.6, opacity = 0.8, darkness = 1.4, layer = 3 } = {}) {
    this.renderer = renderer; this.blur = blur; this.layer = layer;
    const opts = { type: THREE.HalfFloatType };
    this.rt = new THREE.WebGLRenderTarget(size, size, opts);
    this.rtB = new THREE.WebGLRenderTarget(size, size, opts);
    this.cam = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0, far);
    this.cam.rotation.x = Math.PI / 2;
    this.cam.layers.set(layer);
    this.depthMat = new THREE.ShaderMaterial({
      uniforms: { uDark: { value: darkness } },
      vertexShader: 'varying float vZ; void main(){ vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); vZ = p.z / p.w * 0.5 + 0.5; gl_Position = p; }',
      fragmentShader: 'uniform float uDark; varying float vZ; void main(){ float a = pow(clamp(1.0 - vZ, 0.0, 1.0), 1.6) * uDark; gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(a, 0.0, 1.0)); }',
      side: THREE.DoubleSide,
    });
    this.hq = new FullScreenQuad(new THREE.ShaderMaterial(HorizontalBlurShader));
    this.vq = new FullScreenQuad(new THREE.ShaderMaterial(VerticalBlurShader));
    this.hq.material.depthTest = this.vq.material.depthTest = false;
    const mat = new THREE.MeshBasicMaterial({ map: this.rt.texture, transparent: true, opacity, depthWrite: false, color: 0x0c0e12 });
    mat.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', 'vec4 sampledDiffuseColor = texture2D(map, vMapUv); diffuseColor.a *= sampledDiffuseColor.a;');
    };
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height).rotateX(-Math.PI / 2), mat);
    this.plane.scale.z = -1; // the camera looks up, so flip to match
    this.plane.position.y = 0.0015;
    this.plane.renderOrder = 1;
    this.group = new THREE.Group();
    this.group.add(this.plane, this.cam);
    this._c = new THREE.Color();
  }

  update(scene) {
    const r = this.renderer;
    const prevBg = scene.background, prevOv = scene.overrideMaterial, prevRT = r.getRenderTarget();
    r.getClearColor(this._c); const prevA = r.getClearAlpha();
    const prevAuto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    scene.background = null; scene.overrideMaterial = this.depthMat;
    this.plane.visible = false;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rt); r.clear(); r.render(scene, this.cam);
    scene.overrideMaterial = prevOv;
    this._blurPass(this.blur / 256);
    this._blurPass(this.blur * 0.45 / 256);
    this.plane.visible = true;
    r.setRenderTarget(prevRT);
    r.setClearColor(this._c, prevA);
    scene.background = prevBg;
    r.shadowMap.autoUpdate = prevAuto;
  }

  _blurPass(amount) {
    const r = this.renderer;
    this.hq.material.uniforms.tDiffuse.value = this.rt.texture; this.hq.material.uniforms.h.value = amount;
    r.setRenderTarget(this.rtB); this.hq.render(r);
    this.vq.material.uniforms.tDiffuse.value = this.rtB.texture; this.vq.material.uniforms.v.value = amount;
    r.setRenderTarget(this.rt); this.vq.render(r);
  }
}
