// The salon: eleven more tables under eleven lamps, every one replaying the Immortal Game at a different move.
// Everything here is instanced and shaded with a cheap lamp-pool model, and lives on layer 1 so the
// planar reflection and the shadow map never pay for it.
import { THREE } from '../../src/core/engine.js';

export const SPACING = 34;
export const LAMP = new THREE.Vector3(-3.0, 15, 8.0);      // lamp offset from each table centre (same as our key light)
export const TABLES = [];
for (const x of [-1, 0, 1, 2]) for (const z of [-1, 0, 1]) if (x || z) TABLES.push(new THREE.Vector3(x * SPACING, 0, z * SPACING));
export const ALL_TABLES = [new THREE.Vector3(0, 0, 0), ...TABLES];

const NL = ALL_TABLES.length;
const lampUniform = ALL_TABLES.map(t => t.clone().add(LAMP));

const FAR_VERT = /* glsl */`
  varying vec3 vN; varying vec3 vW; varying vec3 vL;
  #include <fog_pars_vertex>
  void main(){
    vec4 p = vec4(position, 1.0);
    vec3 n = normal;
    vL = position;
    #ifdef USE_INSTANCING
      p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
    #endif
    vec4 w = modelMatrix * p;
    vW = w.xyz; vN = normalize(mat3(modelMatrix) * n);
    vec4 mvPosition = viewMatrix * w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const LAMP_GLSL = /* glsl */`
  uniform vec3 uLamps[${NL}]; uniform float uPower; uniform vec3 uCam;
  // the lamp over the nearest table
  vec3 nearestLamp(vec3 w){
    vec3 best = uLamps[0]; float bd = 1e9;
    for (int i = 0; i < ${NL}; i++) { vec3 d = w - uLamps[i]; float q = d.x * d.x + d.z * d.z; if (q < bd) { bd = q; best = uLamps[i]; } }
    return best;
  }
  vec3 shade(vec3 albedo, vec3 n, vec3 w, float gloss){
    vec3 lp = nearestLamp(w);
    vec3 dl = lp - w; float d = length(dl); vec3 l = dl / d;
    vec3 aim = normalize(vec3(lp.x + 3.4, -0.34, lp.z - 8.2) - lp);   // the shade points at its table
    float cone = smoothstep(0.87, 0.97, dot(-l, aim));
    float ndl = max(dot(n, l), 0.0);
    vec3 v = normalize(uCam - w); vec3 h = normalize(l + v);
    float spec = pow(max(dot(n, h), 0.0), 70.0) * gloss;
    float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
    vec3 lampC = vec3(1.0, 0.86, 0.68) * uPower / (d * d) * 0.42;
    return (albedo * (ndl * cone + 0.018) + spec * cone) * lampC * 1.0 + albedo * 0.004 + fres * gloss * 0.012;
  }`;

function farMaterial(frag, extra = {}) {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uLamps: { value: lampUniform }, uPower: { value: 1500 }, uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color() }, uGloss: { value: 0 },
      ...extra,
    }]),
    vertexShader: FAR_VERT,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uGloss;
      varying vec3 vN; varying vec3 vW; varying vec3 vL;
      ${LAMP_GLSL}
      #include <fog_pars_fragment>
      ${frag}`,
  });
}
const pieceFrag = /* glsl */`
  void main(){
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    gl_FragColor = vec4(shade(uColor, n, vW, uGloss), 1.0);
    #include <fog_fragment>
  }`;

/**
 * Build the room. `pieceTypes` maps type -> BufferGeometry (already normalised to the main set's scale),
 * `placements` is a list of { type, color, matrix } for every far piece, `boardTex` the board albedo.
 */
export function buildSalon({ scene, camera, tableY, edge, pieceTypes, placements, boardTex }) {
  const group = new THREE.Group();
  group.name = 'salon';
  const mats = [];
  const track = m => { mats.push(m); return m; };

  // Far pieces: one instanced mesh per type and colour.
  const white = new THREE.Color(0.72, 0.68, 0.6), black = new THREE.Color(0.012, 0.011, 0.01);
  for (const [type, geo] of Object.entries(pieceTypes)) for (const color of ['w', 'b']) {
    const list = placements.filter(p => p.type === type && p.color === color);
    if (!list.length) continue;
    const mat = track(farMaterial(pieceFrag));
    mat.uniforms.uColor.value.copy(color === 'w' ? white : black);
    mat.uniforms.uGloss.value = color === 'w' ? 0.25 : 0.9;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => im.setMatrixAt(i, p.matrix));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  }

  // Far boards: squares, brass fillet and walnut frame in one plane.
  const boardMat = track(farMaterial(/* glsl */`
    uniform sampler2D uBoard; uniform float uEdge;
    void main(){
      vec2 q = vL.xy;                          // plane local, -edge..edge
      vec3 alb;
      if (abs(q.x) < 4.0 && abs(q.y) < 4.0) { vec3 t = texture2D(uBoard, (q + 4.0) / 8.0).rgb; alb = t * t; }
      else if (abs(q.x) < 4.05 && abs(q.y) < 4.05) alb = vec3(0.5, 0.36, 0.17);
      else alb = vec3(0.05, 0.028, 0.016);
      gl_FragColor = vec4(shade(alb, vec3(0.0, 1.0, 0.0), vW, 0.5), 1.0);
      #include <fog_fragment>
    }`, { uBoard: { value: null }, uEdge: { value: edge } }));
  boardMat.uniforms.uBoard.value = boardTex;   // render-target textures do not survive UniformsUtils.merge
  const boards = new THREE.InstancedMesh(new THREE.PlaneGeometry(edge * 2, edge * 2), boardMat, TABLES.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1);
  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  TABLES.forEach((t, i) => {
    q.copy(flat).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i % 3 - 1) * 0.12));
    boards.setMatrixAt(i, m4.compose(t.clone().setY(0.001), q, s1));
  });
  boards.computeBoundingSphere();
  group.add(boards);

  // Table tops (leather with a walnut rim), pedestals and feet for the other tables.
  const topMat = track(farMaterial(/* glsl */`
    void main(){
      float r = length(vL.xz);
      vec3 alb = (vN.y > 0.5 && r < 8.85) ? vec3(0.02, 0.016, 0.013) : vec3(0.06, 0.032, 0.018);
      gl_FragColor = vec4(shade(alb, normalize(vN), vW, 0.25), 1.0);
      #include <fog_fragment>
    }`));
  const tops = new THREE.InstancedMesh(new THREE.CylinderGeometry(9.4, 9.2, 0.36, 72), topMat, TABLES.length);
  TABLES.forEach((t, i) => tops.setMatrixAt(i, m4.compose(t.clone().setY(tableY - 0.18), q.identity(), s1)));
  tops.computeBoundingSphere();
  group.add(tops);

  const woodMat = track(farMaterial(pieceFrag));
  woodMat.uniforms.uColor.value.setRGB(0.05, 0.028, 0.016);
  woodMat.uniforms.uGloss.value = 0.3;
  const floorY = tableY - 13;
  const colGeo = new THREE.CylinderGeometry(0.9, 1.25, 12.6, 24).translate(0, tableY - 0.36 - 6.3, 0);
  const footGeo = new THREE.CylinderGeometry(3.6, 4.0, 0.5, 40).translate(0, floorY + 0.25, 0);
  for (const geo of [colGeo, footGeo]) {
    const im = new THREE.InstancedMesh(geo, woodMat, ALL_TABLES.length);
    ALL_TABLES.forEach((t, i) => im.setMatrixAt(i, m4.compose(t, q.identity(), s1)));
    im.computeBoundingSphere();
    group.add(im);
  }

  // Pendant lamps: a brass shade, a bulb and a cord over every table, including ours.
  const shadeMat = track(farMaterial(/* glsl */`
    void main(){
      vec3 n = normalize(vN);
      float inner = gl_FrontFacing ? 0.0 : 1.0;
      float fr = pow(1.0 - abs(dot(n, normalize(uCam - vW))), 2.0);
      vec3 c = mix(vec3(0.03, 0.022, 0.012) + fr * vec3(0.55, 0.4, 0.2) * 0.5 + max(n.y, 0.0) * vec3(0.4, 0.3, 0.15) * 0.06,
                   vec3(1.0, 0.78, 0.5) * 2.2, inner);
      gl_FragColor = vec4(c, 1.0);
      #include <fog_fragment>
    }`));
  shadeMat.side = THREE.DoubleSide;
  const shadeGeo = new THREE.CylinderGeometry(0.55, 2.3, 1.7, 48, 1, true).translate(0, 0.2, 0);
  const bulbGeo = new THREE.SphereGeometry(0.42, 20, 12);
  const cordGeo = new THREE.CylinderGeometry(0.035, 0.035, 60, 6).translate(0, 31, 0);
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.55).multiplyScalar(14), fog: false });
  const cordMat = track(farMaterial(pieceFrag));
  cordMat.uniforms.uColor.value.setRGB(0.02, 0.02, 0.02);
  const lipGeo = new THREE.TorusGeometry(2.3, 0.07, 8, 64).rotateX(Math.PI / 2).translate(0, -0.65, 0);
  const lipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.74, 0.44).multiplyScalar(3.2), fog: false });
  const aimQ = new THREE.Quaternion();
  for (const [geo, mat] of [[shadeGeo, shadeMat], [bulbGeo, bulbMat], [cordGeo, cordMat], [lipGeo, lipMat]]) {
    const im = new THREE.InstancedMesh(geo, mat, ALL_TABLES.length);
    ALL_TABLES.forEach((t, i) => {
      const p = t.clone().add(LAMP);
      // shades tilt toward their board; cords hang straight
      if (geo === cordGeo) aimQ.identity();
      else aimQ.setFromUnitVectors(new THREE.Vector3(0, -1, 0), t.clone().add(new THREE.Vector3(0.4, 0, -0.2)).sub(p).normalize());
      im.setMatrixAt(i, m4.compose(p, aimQ, s1));
    });
    im.computeBoundingSphere();
    group.add(im);
  }

  // Parquet floor: long walnut boards, each lamp's light spilling round its table's shadow.
  const floorMat = track(farMaterial(/* glsl */`
    float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 g = vW.xz / vec2(14.0, 2.4);
      float row = floor(g.y);
      g.x += hh(vec2(row, 3.0)) * 7.0;
      vec2 id = vec2(floor(g.x), row), f = fract(g);
      float seam = smoothstep(0.0, 0.02, f.y) * smoothstep(1.0, 0.98, f.y) * smoothstep(0.0, 0.004, f.x) * smoothstep(1.0, 0.996, f.x);
      vec3 alb = mix(vec3(0.035, 0.019, 0.011), vec3(0.07, 0.04, 0.022), hh(id)) * (0.5 + 0.5 * seam);
      vec3 lp = nearestLamp(vW);
      float r = length(vW.xz - (lp.xz - vec2(-3.0, 8.0)));
      float under = smoothstep(7.0, 12.5, r);                    // the table's own shadow
      vec3 c = shade(alb, vec3(0.0, 1.0, 0.0), vW, 0.35) * mix(0.12, 1.0, under);
      gl_FragColor = vec4(c, 1.0);
      #include <fog_fragment>
    }`));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.y = floorY;
  group.add(floor);

  group.traverse(o => { o.layers.set(1); o.castShadow = false; o.receiveShadow = false; });
  scene.add(group);
  camera.layers.enable(1);

  return {
    group,
    update(cam, power) { for (const m of mats) { m.uniforms.uCam.value.copy(cam.position); m.uniforms.uPower.value = power; } },
  };
}
