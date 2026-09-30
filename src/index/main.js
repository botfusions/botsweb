// Twenty Worlds — the gallery. A curved wall of twenty lit windows over black glass.
import { Engine, THREE, damp, clamp } from '../core/engine.js';
import { Pointer } from '../core/input.js';
import { smoothScroll, gsap, elementProgress } from '../core/scroll.js';
import { cursor } from '../core/ui.js';
import { PlanarReflection } from '../core/reflector.js';
import { WORLDS } from '../core/worlds.js';

const BASE = import.meta.env.BASE_URL;
const N = WORLDS.length;
const R = 12.2;                 // ring radius
const STEP = (Math.PI * 2) / N; // angle between windows
const CARD = { w: 3.36, h: 2.1 };

const engine = new Engine({
  canvas: document.getElementById('gl'), fov: 36, near: 0.1, far: 60, dpr: 1.75, background: 0x060607, shadows: false,
  post: { ao: false, tone: 'linear', bloom: { intensity: 0.55, luminanceThreshold: 0.72, luminanceSmoothing: 0.25, radius: 0.8 }, vignette: { offset: 0.28, darkness: 0.7 }, noise: 0.05 },
});
const { scene, camera, renderer } = engine;
scene.fog = new THREE.Fog(0x060607, 6, 22);
camera.position.set(0, 0.55, -2.8);

// ─── Windows ─────────────────────────────────────────────────────────────────
const loader = new THREE.TextureLoader();
const cardGeo = (() => {
  const g = new THREE.PlaneGeometry(CARD.w, CARD.h, 32, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = p.getX(i) / R;
    p.setXYZ(i, Math.sin(a) * R, p.getY(i), R - Math.cos(a) * R);
  }
  g.computeVertexNormals();
  return g;
})();
const cardMat = (tex, hue) => new THREE.ShaderMaterial({
  transparent: true, fog: true,
  uniforms: {
    map: { value: tex }, uActive: { value: 0 }, uHover: { value: 0 }, uHue: { value: new THREE.Color(hue) }, uTime: { value: 0 },
    uReveal: { value: 0 }, fogColor: { value: scene.fog.color }, fogNear: { value: scene.fog.near }, fogFar: { value: scene.fog.far },
  },
  vertexShader: `
    varying vec2 vUv; varying vec3 vView;
    #include <fog_pars_vertex>
    void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.); vView = -mvPosition.xyz; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `
    uniform sampler2D map; uniform float uActive, uHover, uTime, uReveal; uniform vec3 uHue; varying vec2 vUv; varying vec3 vView;
    #include <fog_pars_fragment>
    float rbox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
    void main(){
      vec2 p = (vUv - .5) * vec2(${CARD.w.toFixed(2)}, ${CARD.h.toFixed(2)});
      float d = rbox(p, vec2(${(CARD.w / 2).toFixed(3)}, ${(CARD.h / 2).toFixed(3)}), 0.08);
      float a = smoothstep(0.012, 0.0, d);
      // Gentle zoom-in when active: the world "opens" a little.
      vec2 uv = (vUv - .5) * (1. - uActive * 0.05 - uHover * 0.02) + .5;
      vec3 c = texture2D(map, uv).rgb;
      float l = dot(c, vec3(.299, .587, .114));
      c = mix(vec3(l) * 0.55, c, 0.35 + 0.65 * max(uActive, uHover * .7));
      c *= 0.34 + 0.66 * max(uActive, uHover * 0.8);
      float rim = smoothstep(0.014, 0.0, abs(d + 0.006)) * (0.12 + uActive * 0.9);
      c += uHue * rim * 1.2;
      c *= uReveal;
      gl_FragColor = vec4(c, a * uReveal);
      #include <fog_fragment>
    }`,
});

const cards = WORLDS.map((w, i) => {
  const tex = loader.load(`${BASE}img/index/${w.slug}.webp`);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh(cardGeo, cardMat(tex, w.hue));
  mesh.position.set(0, 0.05, -R);
  mesh.userData.i = i;
  pivot.add(mesh);
  scene.add(pivot);
  return { w, i, pivot, mesh, active: 0, hover: 0 };
});

// Black glass floor.
const floorMat = new THREE.MeshStandardMaterial({ color: 0x020203, roughness: 0.14, metalness: 0 });
const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), floorMat);
floor.rotation.x = -Math.PI / 2; floor.position.y = -1.05;
scene.add(floor);
const refl = new PlanarReflection(renderer, { resolution: 0.5, point: new THREE.Vector3(0, -1.05, 0) });
refl.hidden.push(floor);
refl.patch(floorMat, { strength: 1.6, distort: 0, lodScale: 3, lodBias: 0.8, f0: 0.18 });
engine.onResize((w, h, d) => refl.setSize(w, h, d));

// Drifting motes for depth.
{
  const n = 900, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 10; pos.set([Math.sin(a) * r, -1 + Math.random() * 4, -Math.cos(a) * r], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ size: 0.022, color: 0xbfb8a8, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(g, m); scene.add(pts);
  engine.onTick((dt, t) => { pts.rotation.y = t * 0.01; });
}

// ─── State ───────────────────────────────────────────────────────────────────
const pointer = new Pointer({ lambda: 5 });
const ringEl = document.querySelector('.ring-section');
const ui = {
  num: document.querySelector('.active-num .n'), name: document.querySelector('.active-name'),
  line: document.querySelector('.active-line'), enter: document.querySelector('.enter'),
  bar: document.querySelector('.progress i'), root: document.documentElement,
};
let rot = 0, drag = 0, dragV = 0, dragging = false, lastX = 0, activeIdx = -1, hoverIdx = -1, clickStart = null;
const ray = new THREE.Raycaster();

function setActive(i) {
  if (i === activeIdx) return;
  activeIdx = i;
  const w = WORLDS[i];
  ui.root.style.setProperty('--hue', w.hue);
  gsap.to([ui.name, ui.line], { opacity: 0, y: -8, duration: 0.18, onComplete: () => {
    ui.num.textContent = String(i + 1).padStart(2, '0');
    ui.name.textContent = w.name; ui.line.textContent = w.line;
    ui.enter.href = `${BASE}examples/${w.slug}/`;
    gsap.fromTo([ui.name, ui.line], { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: 0.05 });
  } });
}

function go(slug) {
  gsap.to('.wipe', { opacity: 1, duration: 0.55, ease: 'power2.in', onComplete: () => { location.href = `${BASE}examples/${slug}/`; } });
}
ui.enter.addEventListener('click', e => { e.preventDefault(); go(WORLDS[activeIdx].slug); });

addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('a,button,.list,.about')) return;
  dragging = true; lastX = e.clientX; clickStart = { x: e.clientX, y: e.clientY, t: performance.now() };
});
addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - lastX; lastX = e.clientX;
  drag -= dx / innerWidth * 5.5; dragV = -dx / innerWidth * 5.5;
});
addEventListener('pointerup', e => {
  if (!dragging) return;
  dragging = false;
  const moved = clickStart && Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y) > 6;
  if (!moved && hoverIdx >= 0) {
    if (hoverIdx === activeIdx) go(WORLDS[hoverIdx].slug);
    else scrollToIndex(hoverIdx);
  } else {
    drag += dragV * 4; // throw
  }
});
function scrollToIndex(i) {
  const span = ringEl.offsetHeight - innerHeight;
  const cur = (target() % N + N) % N;
  let delta = i - cur; if (delta > N / 2) delta -= N; if (delta < -N / 2) delta += N;
  drag += delta;
  void span;
}
addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') drag += 1;
  if (e.key === 'ArrowLeft') drag -= 1;
  if (e.key === 'Enter' && activeIdx >= 0) go(WORLDS[activeIdx].slug);
});
const target = () => elementProgress(ringEl) * (N - 1) + drag;

engine.onTick((dt, t) => {
  pointer.update(dt);
  if (!dragging) { const snap = Math.round(target()) - target(); drag += snap * (1 - Math.exp(-4 * dt)); }
  rot = damp(rot, target(), 6, dt);
  const idx = ((Math.round(rot) % N) + N) % N;
  setActive(idx);
  ui.bar.style.width = `${((idx + 1) / N) * 100}%`;

  // Hover pick.
  ray.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), camera);
  const hit = ray.intersectObjects(cards.map(c => c.mesh), false)[0];
  hoverIdx = hit && pointer.active ? hit.object.userData.i : -1;
  document.body.style.cursor = hoverIdx >= 0 ? 'pointer' : '';

  for (const c of cards) {
    let a = c.i * STEP - rot * STEP;
    c.pivot.rotation.y = -a;
    const d = Math.abs(((c.i - rot) % N + N + N / 2) % N - N / 2);
    c.active = damp(c.active, d < 0.5 ? 1 : 0, 6, dt);
    c.hover = damp(c.hover, hoverIdx === c.i ? 1 : 0, 8, dt);
    const u = c.mesh.material.uniforms;
    u.uActive.value = c.active; u.uHover.value = c.hover; u.uTime.value = t;
    c.mesh.position.z = -R + c.active * 0.9 + c.hover * 0.25;
    c.mesh.position.y = 0.05 + Math.sin(t * 0.6 + c.i) * 0.03;
  }
  camera.position.x = pointer.sx * 0.3;
  camera.position.y = 0.5 + pointer.sy * 0.12;
  camera.lookAt(pointer.sx * 0.4, 0.12, -R);
  refl.update(scene, camera);
  engine.paused = document.querySelector('.list').getBoundingClientRect().top < 0;
});

// ─── The list ────────────────────────────────────────────────────────────────
const rows = document.querySelector('.rows');
const preview = document.querySelector('.preview');
const pimg = preview.querySelector('img');
rows.innerHTML = WORLDS.map((w, i) => `<li><a href="${BASE}examples/${w.slug}/" data-i="${i}">
  <span class="num">${String(i + 1).padStart(2, '0')}</span><span class="name">${w.name}</span><span class="line">${w.line}</span><span class="dot" style="color:${w.hue};background:${w.hue}"></span></a></li>`).join('');
let px = 0, py = 0, tx = 0, ty = 0;
rows.addEventListener('pointerover', e => { const a = e.target.closest('a'); if (!a) return; pimg.src = `${BASE}img/index/${WORLDS[+a.dataset.i].slug}.webp`; preview.classList.add('on'); });
rows.addEventListener('pointerleave', () => preview.classList.remove('on'));
addEventListener('pointermove', e => { tx = e.clientX + 24; ty = e.clientY - 110; });
(function loop() { px += (tx - px) * 0.15; py += (ty - py) * 0.15; preview.style.transform = `translate3d(${px}px,${py}px,0) rotate(${(tx - px) * 0.02}deg)`; requestAnimationFrame(loop); })();

// ─── Boot ────────────────────────────────────────────────────────────────────
smoothScroll({ lerp: 0.09 });
cursor({ color: '#f1efe9', blend: 'difference', size: 30 });
renderer.compile(scene, camera);
engine.start();
cards.forEach((c, i) => gsap.to(c.mesh.material.uniforms.uReveal, { value: 1, duration: 1.6, delay: 0.2 + Math.abs(i < N / 2 ? i : N - i) * 0.07, ease: 'power2.out' }));
gsap.from('.intro h1, .intro .kicker, .active', { opacity: 0, y: 24, duration: 1.4, ease: 'expo.out', stagger: 0.08, delay: 0.2 });
