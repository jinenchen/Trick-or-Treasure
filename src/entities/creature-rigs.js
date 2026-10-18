// Original articulated creatures, inspired by the supplied Lifeform / Human Deer
// references. These remain available offline when optional Sketchfab GLBs are absent.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const easeBetween = (start, end, time) => {
  const u = clamp01((time - start) / (end - start));
  return u * u * (3 - 2 * u);
};

// Mottled pores and long, fibrous scars survive a close flashlight inspection.
// A DataTexture keeps the creatures independent of external images / DOM canvases.
function tissueTexture(seed) {
  const size = 128, data = new Uint8Array(size * size * 4);
  let state = seed;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cloud = Math.sin(x * 0.16 + Math.sin(y * 0.09) * 2) * Math.sin(y * 0.11 + x * 0.04);
      const vein = Math.pow(Math.max(0, Math.sin(x * 0.34 + Math.sin(y * 0.11) * 2)), 20);
      const v = Math.max(25, Math.min(255, 158 + cloud * 45 - vein * 66 + (random() - 0.5) * 64));
      const k = (y * size + x) * 4;
      data[k] = v;
      data[k + 1] = v * 0.91;
      data[k + 2] = v * 0.80;
      data[k + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function materials(kind) {
  const deer = kind === 'human-deer', watcher = kind === 'bacteria-pill';
  const texture = tissueTexture(deer ? 713 : watcher ? 319 : 89);
  const material = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({
    color, roughness, metalness, map: texture, bumpMap: texture, bumpScale: 0.018,
  });
  return {
    skin: material(deer ? 0x85796b : watcher ? 0x504d42 : 0x373830, 0.88),
    tendon: material(deer ? 0x403a30 : 0x191c19, 0.64),
    bone: material(deer ? 0xb0a78b : 0x7d7562, 0.91),
    wet: material(0x12120f, 0.24, 0.12),
    cavity: new THREE.MeshStandardMaterial({ color: 0x030403, roughness: 1 }),
  };
}

function mesh(parent, geometry, material, position, scale) {
  const object = new THREE.Mesh(geometry, material);
  if (position) object.position.set(...position);
  if (scale) object.scale.set(...scale);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function lump(parent, mat, position, scale, detail = 1) {
  return mesh(parent, new THREE.IcosahedronGeometry(1, detail), mat, position, scale);
}

function bone(parent, a, b, radius, mat, endRadius = radius * 0.72) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
  const delta = to.clone().sub(from);
  const object = mesh(parent, new THREE.CylinderGeometry(endRadius, radius, delta.length(), 7, 1), mat);
  object.position.copy(from).add(to).multiplyScalar(0.5);
  object.quaternion.setFromUnitVectors(UP, delta.normalize());
  return object;
}

function fibre(parent, points, radius, mat, taper = 0.24) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const segments = Math.max(6, points.length * 4);
  const geometry = new THREE.TubeGeometry(curve, segments, radius, 5, false);
  const positions = geometry.attributes.position;
  for (let i = 0; i <= segments; i++) {
    const center = curve.getPointAt(i / segments);
    const scale = 1 - (1 - taper) * Math.pow(i / segments, 1.8);
    for (let j = 0; j <= 5; j++) {
      const k = i * 6 + j;
      positions.setXYZ(k,
        center.x + (positions.getX(k) - center.x) * scale,
        center.y + (positions.getY(k) - center.y) * scale,
        center.z + (positions.getZ(k) - center.z) * scale,
      );
    }
  }
  geometry.computeVertexNormals();
  return mesh(parent, geometry, mat);
}

function pivot(parent, position) {
  const group = new THREE.Group();
  group.position.set(...position);
  parent.add(group);
  return group;
}

function faceFocus(rig, position) {
  const focus = rig.focus = new THREE.Object3D();
  focus.name = 'specimen-face-focus';
  focus.position.set(...position);
  rig.head.add(focus);
}

// Fuse static detail within each articulated part, keeping the silhouettes rich
// without charging a separate draw call for every rib, claw and loose filament.
function batchParts(group) {
  for (const child of [...group.children]) if (child.isGroup) batchParts(child);
  const batches = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh) continue;
    child.updateMatrix();
    const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    geometry.applyMatrix4(child.matrix);
    if (!batches.has(child.material)) batches.set(child.material, []);
    batches.get(child.material).push(geometry);
    child.geometry.dispose();
    group.remove(child);
  }
  for (const [material, geometries] of batches) {
    const combined = mergeGeometries(geometries, false);
    mesh(group, combined, material);
    for (const geometry of geometries) geometry.dispose();
  }
}

function arm(body, side, m, deer = false) {
  const upperLength = deer ? 0.54 : 0.69, lowerLength = deer ? 0.65 : 0.83;
  const upper = pivot(body, [side * (deer ? 0.24 : 0.29), 0.60, 0.01]);
  upper.rotation.z = side * 0.12;
  const elbow = pivot(upper, [side * 0.035, -upperLength, 0]);
  elbow.rotation.x = -0.23;
  bone(upper, [0, 0, 0], [side * 0.035, -upperLength, 0], deer ? 0.055 : 0.035, m.skin);
  lump(upper, m.skin, [0, -0.15, -0.012], [deer ? 0.066 : 0.044, 0.22, 0.048]);
  lump(elbow, m.bone, [0, 0, 0], [0.048, 0.058, 0.045]);
  bone(elbow, [-0.022, 0, 0], [-0.025, -lowerLength, 0.025], 0.025, m.skin, 0.012);
  bone(elbow, [0.025, -0.05, 0.015], [0.018, -lowerLength, 0.02], 0.019, m.tendon, 0.011);
  fibre(upper, [[0.012, 0, -0.025], [side * 0.07, -upperLength * 0.4, -0.04], [side * 0.02, -upperLength, 0]], 0.015, m.tendon);
  const hand = pivot(elbow, [0, -lowerLength, 0.025]);
  lump(hand, m.skin, [0, -0.048, 0], [0.042, 0.085, 0.022]);
  const fingers = [];
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.023;
    const length = 0.14 + Math.sin(i + 0.4) * 0.045;
    const finger = pivot(hand, [x, -0.09, 0]);
    fibre(finger, [[0, 0, 0], [x * 0.6, -length * 0.5, 0.025], [x * 0.9, -length, 0.065]], 0.011, m.skin);
    bone(finger, [x * 0.9, -length, 0.065], [x, -0.04 - length, 0.10], 0.007, m.bone, 0.001);
    lump(finger, m.skin, [x * 0.6, -length * 0.5, 0.025], [0.013, 0.016, 0.014]);
    fingers.push(finger);
  }
  fibre(hand, [[side * 0.03, -0.02, 0], [side * 0.085, -0.07, 0.01], [side * 0.09, -0.13, 0.065]], 0.014, m.skin);
  return { upper, elbow, hand, fingers, side };
}

function leg(body, side, m, deer = false) {
  const thighLength = deer ? 0.64 : 0.73, shinLength = deer ? 0.66 : 0.76;
  const hip = pivot(body, [side * 0.12, -0.05, 0]);
  const knee = pivot(hip, [side * 0.03, -thighLength, 0]);
  bone(hip, [0, 0, 0], [side * 0.03, -thighLength, 0], deer ? 0.075 : 0.05, m.skin, 0.027);
  lump(hip, m.skin, [0, -0.20, -0.015], [deer ? 0.075 : 0.049, 0.24, 0.055]);
  lump(knee, m.bone, [0, 0, 0.018], [0.045, 0.048, 0.041]);
  bone(knee, [0, 0, 0], [side * 0.025, -shinLength, -0.065], 0.031, m.skin, 0.014);
  fibre(knee, [[side * 0.022, -0.03, -0.02], [side * 0.045, -shinLength * 0.55, -0.07], [side * 0.025, -shinLength, -0.065]], 0.015, m.tendon);
  const foot = pivot(knee, [side * 0.025, -shinLength, -0.065]);
  lump(foot, deer ? m.wet : m.skin, [0, -0.02, 0.045], [0.055, 0.05, 0.13]);
  for (const offset of [-0.027, 0.027]) {
    bone(foot, [offset, -0.01, 0.08], [offset * 1.45, -0.032, 0.18], deer ? 0.027 : 0.014, deer ? m.wet : m.bone, 0.007);
  }
  return { hip, knee, foot, side };
}

function bacteria(rig, m, watcher = false) {
  const body = rig.body = pivot(rig.root, [0, 1.59, 0]);
  lump(body, m.skin, [0, 0.03, -0.02], [0.17, 0.14, 0.11]);
  lump(body, m.skin, [0.015, 0.48, -0.065], [0.23, 0.32, 0.13]);
  fibre(body, [[0, -0.03, -0.02], [-0.035, 0.24, -0.12], [0.02, 0.55, -0.12], [-0.035, 0.82, 0]], 0.071, m.skin, 0.7);
  for (const side of [-1, 1]) {
    bone(body, [0, 0.64, -0.03], [side * 0.29, 0.60, 0.01], 0.038, m.skin);
    // Irregular cages of connective tissue, rather than a smooth humanoid suit.
    for (let i = 0; i < 7; i++) {
      const y = 0.12 + i * 0.071, width = 0.13 + i * 0.013;
      fibre(body, [[0, y + 0.06, -0.11], [side * width, y + 0.02, -0.07], [side * width * 0.88, y - 0.02, 0.08], [side * 0.025, y - 0.07, 0.095]], 0.016, i % 3 === 0 ? m.wet : m.tendon, 0.55);
    }
  }
  for (let i = 0; i < 18; i++) {
    const angle = i * 2.399, radius = 0.09 + (i % 3) * 0.028;
    fibre(body, [
      [Math.sin(angle) * 0.13, -0.06, Math.cos(angle) * 0.07],
      [Math.sin(angle + 0.5) * radius, 0.24, Math.cos(angle + 0.5) * radius],
      [Math.sin(angle + 1.1) * 0.20, 0.53, Math.cos(angle + 1.1) * 0.14],
      [Math.sin(angle + 1.9) * 0.13, 0.76 + (i % 4) * 0.027, Math.cos(angle + 1.9) * 0.11],
    ], 0.012 + (i % 3) * 0.004, i % 4 ? m.skin : m.wet, 0.4);
  }
  const head = rig.head = pivot(body, [-0.025, 0.86, 0.025]);
  head.rotation.z = -0.20;
  const skull = lump(head, m.skin, [-0.019, 0.075, -0.019], [0.122, 0.202, 0.12], 2);
  skull.rotation.z = 0.16;
  lump(head, m.tendon, [0.062, 0.023, 0.018], [0.052, 0.126, 0.086], 2);
  // A narrow uneven cleft, partly hidden by crossing tissue; no oval face decal.
  const maw = rig.maw = pivot(head, [0.015, -0.022, 0.123]);
  const cleft = new THREE.Shape();
  cleft.moveTo(-0.013, 0.068);
  for (const [x, y] of [[0.004, 0.049], [-0.004, 0.024], [0.019, 0.010], [0.005, -0.014], [0.022, -0.043], [0.009, -0.087], [-0.011, -0.064], [-0.024, -0.030], [-0.020, -0.007], [-0.037, 0.016], [-0.024, 0.043]]) cleft.lineTo(x, y);
  cleft.closePath();
  mesh(maw, new THREE.ShapeGeometry(cleft), m.cavity);
  const jaw = rig.jaw = pivot(head, [0.006, -0.071, 0.035]);
  lump(jaw, m.skin, [-0.029, -0.055, 0.055], [0.034, 0.055, 0.065], 2);
  lump(jaw, m.tendon, [0.023, -0.075, 0.063], [0.027, 0.038, 0.062], 2);
  fibre(jaw, [[-0.049, -0.01, 0.03], [-0.034, -0.09, 0.075], [0.008, -0.113, 0.094], [0.047, -0.061, 0.063]], 0.018, m.skin, 0.45);
  const teeth = [
    [[-0.014, 0.023, 0.130], [-0.002, 0.006, 0.137]],
    [[0.032, -0.010, 0.126], [0.013, -0.026, 0.140]],
    [[-0.011, -0.040, 0.129], [0.005, -0.054, 0.140]],
  ];
  for (let i = 0; i < teeth.length; i++) {
    bone(head, teeth[i][0], teeth[i][1], 0.006 - i * 0.0007, m.bone, 0.0015);
    bone(jaw, [-0.022 + i * 0.019, -0.073 + i * 0.012, 0.105], [-0.016 + i * 0.014, -0.051 + i * 0.013, 0.115], 0.005, m.bone, 0.0015);
  }
  // Occluded, differently placed slits avoid a readable pair of round eyeballs.
  const leftSlit = lump(head, m.cavity, [-0.057, 0.128, 0.092], [0.025, 0.005, 0.003]);
  leftSlit.rotation.z = -0.22;
  const rightSlit = lump(head, m.cavity, [0.038, 0.092, 0.113], [0.016, 0.004, 0.003]);
  rightSlit.rotation.z = 0.31;
  lump(head, m.wet, [-0.057, 0.127, 0.095], [0.004, 0.0015, 0.001]);
  fibre(head, [[-0.087, 0.14, 0.085], [-0.056, 0.133, 0.100], [-0.028, 0.118, 0.111]], 0.009, m.tendon, 0.6);
  fibre(head, [[0.018, 0.101, 0.117], [0.038, 0.099, 0.119], [0.061, 0.081, 0.108]], 0.008, m.skin, 0.5);
  faceFocus(rig, [0.008, 0.045, 0.159]);
  for (let i = 0; i < 17; i++) {
    const angle = i * 2.399, side = i % 2 ? -1 : 1;
    fibre(head, [
      [Math.sin(angle) * 0.074, -0.137, Math.cos(angle) * 0.035],
      [side * (0.077 + i % 3 * 0.018), -0.035 + Math.sin(angle) * 0.035, 0.056],
      [Math.sin(angle + 1.8) * 0.108, 0.112 + Math.cos(angle) * 0.052, 0.09 - Math.abs(Math.sin(angle)) * 0.023],
      [Math.sin(angle + 3) * 0.080, 0.218, 0.034],
      [Math.sin(angle + 4) * 0.051, 0.251 + Math.cos(angle) * 0.026, -0.019],
    ], 0.007 + i % 3 * 0.002, i % 4 ? m.tendon : m.skin, 0.30);
  }
  fibre(head, [[-0.084, 0.02, 0.081], [-0.027, 0.071, 0.123], [0.019, 0.053, 0.13], [0.067, -0.024, 0.102]], 0.009, m.skin, 0.45);
  // Strands break up the outline into the familiar knotted Lifeform silhouette.
  for (let i = 0; i < 9; i++) {
    const side = i % 2 ? -1 : 1, y = 0.22 + i * 0.065;
    fibre(body, [[side * 0.14, y, -0.08], [side * (0.24 + (i % 3) * 0.035), y + 0.16, -0.16], [side * 0.34, y + 0.12, -0.12], [side * 0.37, y - 0.05, -0.06]], 0.012, m.tendon, 0.07);
  }
  rig.arms = [-1, 1].map((side) => arm(body, side, m));
  rig.legs = [-1, 1].map((side) => leg(body, side, m));
  rig.tendrils = [];
  if (watcher) {
    // An uneven hanging hide and trailing nerves distinguish the wall walker.
    lump(body, m.skin, [0, 0.46, -0.03], [0.30, 0.38, 0.16], 2);
    for (let i = 0; i < 12; i++) {
      const angle = i * 2.399;
      const strand = pivot(body, [Math.sin(angle) * 0.2, 0.20 + (i % 3) * 0.07, Math.cos(angle) * 0.13]);
      const length = 0.54 + (i % 5) * 0.16;
      fibre(strand, [[0, 0, 0], [Math.sin(i) * 0.055, -length * 0.4, -0.04], [Math.cos(i) * 0.08, -length * 0.8, 0.025], [Math.sin(i) * 0.12, -length, 0.11]], 0.022, i % 3 ? m.tendon : m.skin, 0.05);
      rig.tendrils.push(strand);
    }
    // A single occluded pale fleck catches light behind the Watcher's slit.
    lump(head, m.bone, [0.041, 0.091, 0.115], [0.0025, 0.001, 0.001]);
  }
}

function humanDeer(rig, m) {
  const body = rig.body = pivot(rig.root, [0, 1.4, 0]);
  lump(body, m.skin, [0, 0.02, 0], [0.19, 0.19, 0.125], 2);
  lump(body, m.skin, [0, 0.40, -0.035], [0.22, 0.33, 0.15], 2);
  lump(body, m.cavity, [0, 0.36, 0.105], [0.16, 0.23, 0.035]);
  fibre(body, [[0, -0.03, -0.09], [0, 0.3, -0.16], [0, 0.61, -0.14], [0, 0.83, 0.01]], 0.048, m.bone, 0.85);
  for (let i = 0; i < 8; i++) lump(body, m.bone, [0, 0.09 + i * 0.079, -0.15], [0.033, 0.027, 0.029]);
  for (const side of [-1, 1]) {
    bone(body, [0, 0.62, 0.065], [side * 0.245, 0.61, -0.01], 0.034, m.bone);
    for (let i = 0; i < 6; i++) {
      const y = 0.22 + i * 0.061, width = 0.16 + Math.sin(i / 5 * Math.PI) * 0.045;
      fibre(body, [[side * 0.025, y + 0.04, -0.15], [side * width, y + 0.02, -0.03], [side * width * 0.85, y - 0.018, 0.128], [side * 0.018, y - 0.04, 0.145]], 0.018, m.bone, 0.7);
    }
  }
  bone(body, [0, 0.59, -0.025], [0, 0.91, 0.15], 0.085, m.skin, 0.045);
  const head = rig.head = pivot(body, [0, 0.92, 0.16]);
  head.rotation.x = 0.14;
  lump(head, m.skin, [0, 0.075, 0.002], [0.115, 0.174, 0.119], 2);
  // A tapered bony muzzle, with a flat damaged nasal end rather than a wet ball.
  bone(head, [0, 0.025, 0.035], [0, -0.055, 0.335], 0.074, m.bone, 0.047);
  fibre(head, [[0, 0.089, 0.057], [-0.007, 0.033, 0.20], [0, -0.025, 0.32]], 0.019, m.bone, 0.45);
  const maw = rig.maw = pivot(head, [0, -0.145, 0.10]);
  lump(maw, m.cavity, [0, 0, 0], [0.054, 0.045, 0.10]);
  const jaw = rig.jaw = pivot(head, [0, -0.105, 0.012]);
  lump(jaw, m.skin, [0, -0.099, 0.138], [0.075, 0.035, 0.22], 2);
  lump(jaw, m.cavity, [0, -0.077, 0.155], [0.058, 0.015, 0.18]);
  const nose = lump(head, m.tendon, [0, -0.061, 0.338], [0.049, 0.030, 0.012]);
  nose.rotation.z = -0.09;
  for (const side of [-1, 1]) {
    const nostril = lump(head, m.cavity, [side * 0.025, -0.061 - side * 0.002, 0.348], [0.012, 0.006, 0.002]);
    nostril.rotation.z = side * 0.29;
  }
  faceFocus(rig, [0, -0.015, 0.25]);
  for (const side of [-1, 1]) {
    // Recessed empty sockets and stretched eyelids make the blindness readable.
    const socket = lump(head, m.cavity, [side * 0.086, 0.061 + side * 0.006, 0.096], [0.025, 0.009, 0.003]);
    socket.rotation.z = side * 0.18;
    fibre(head, [[side * 0.058, 0.092, 0.112], [side * 0.087, 0.079, 0.111], [side * 0.11, 0.064, 0.085]], 0.014, m.bone, 0.55);
    fibre(head, [[side * 0.109, 0.073, 0.025], [side * 0.103, 0.012, 0.075], [side * 0.075, -0.065, 0.106]], 0.018, m.skin, 0.7);
    const ear = lump(head, m.skin, [side * 0.19, 0.12, -0.005], [0.13, 0.045, 0.055]);
    ear.rotation.z = side * 0.28;
    for (let i = 0; i < 6; i++) {
      const z = 0.045 + i * 0.045 + Math.sin(i * 2.2) * 0.006;
      const length = 0.024 + (Math.sin(i * 8.3 + side) + 1) * 0.011;
      bone(head, [side * 0.055, -0.10, z], [side * (0.047 + Math.sin(i) * 0.006), -0.10 - length, z + 0.009], 0.009, m.bone, 0.002);
      bone(jaw, [side * 0.052, -0.078, z], [side * 0.048, -0.078 + length * 0.73, z + 0.006], 0.008, m.bone, 0.002);
    }
    fibre(jaw, [[side * 0.064, 0.022, -0.025], [side * 0.078, -0.051, 0.07], [side * 0.056, -0.104, 0.30]], 0.014, m.tendon, 0.55);
    const antler = pivot(head, [side * 0.075, 0.20, -0.06]);
    const s = side;
    fibre(antler, [[0, 0, 0], [s * 0.09, 0.19, -0.045], [s * 0.24, 0.36, -0.065], [s * 0.36, 0.50, 0], [s * 0.39, 0.67, 0.065]], 0.036, m.bone, 0.025);
    fibre(antler, [[s * 0.09, 0.19, -0.045], [s * 0.04, 0.37, 0.03], [s * 0.09, 0.54, 0.07]], 0.026, m.bone, 0.025);
    fibre(antler, [[s * 0.24, 0.36, -0.065], [s * 0.32, 0.48, -0.20], [s * 0.29, 0.63, -0.24]], 0.024, m.bone, 0.025);
    fibre(antler, [[s * 0.34, 0.47, -0.015], [s * 0.49, 0.53, -0.04], [s * 0.55, 0.63, 0]], 0.021, m.bone, 0.025);
    if (side === -1) fibre(antler, [[s * 0.17, 0.28, -0.06], [s * 0.31, 0.29, 0.04], [s * 0.42, 0.38, 0.09]], 0.022, m.bone, 0.025);
  }
  rig.arms = [-1, 1].map((side) => arm(body, side, m, true));
  rig.legs = [-1, 1].map((side) => leg(body, side, m, true));
  rig.tendrils = [];
}

class CreatureAnimator {
  constructor(rig, kind) {
    this.rig = rig;
    this.kind = kind;
    this.mixer = { timeScale: 1 };
    this.currentName = 'idle';
    this.clock = 0;
    this.timeScale = 1;
    this.motion = 0;
    this.attack = 0;
    this.restY = rig.body.position.y;
    this.restBody = rig.body.position.clone();
    this.restHead = rig.head.position.clone();
  }

  has(name) { return ['idle', 'walk', 'sprint', 'attack-melee-right'].includes(name); }

  play(name, { timeScale = 1, once = false } = {}) {
    if (!this.has(name)) return;
    if (once && name === 'attack-melee-right') this.attack = 0.8;
    this.currentName = name;
    this.timeScale = timeScale;
  }

  // A separate close-up scene can sample any time directly, including scrubbing
  // backwards. No mixer clock, random state, previous pose or frame rate is used.
  // +Z is forward: negative X rotation lifts the hanging (-Y) arms toward camera.
  poseJumpscare(elapsed) {
    const t = Math.max(0, Math.min(1.9, Number.isFinite(elapsed) ? elapsed : 0));
    const deer = this.kind === 'human-deer', watcher = this.kind === 'bacteria-pill';
    const anticipation = Math.sin(Math.PI * clamp01(t / 0.20));
    const reach = easeBetween(0.20, 0.46, t);
    const lunge = easeBetween(0.20, 0.48, t);
    const loom = easeBetween(0.48, 0.67, t);
    const bite = easeBetween(1.32, 1.40, t) * (1 - easeBetween(1.45, 1.57, t));
    const grasp = easeBetween(0.40, 0.71, t);
    const twitchTime = deer || watcher ? t : Math.floor(t * 24) / 24;
    const twitch = Math.sin(twitchTime * (watcher ? 9 : 23)) * loom;
    const { body, head, jaw, maw, arms, legs, tendrils } = this.rig;

    body.position.set(
      this.restBody.x + Math.sin(t * (deer ? 8 : 15)) * 0.018 * loom,
      this.restY + (watcher ? 0.09 : -0.045) * lunge - bite * 0.055 - anticipation * 0.025,
      this.restBody.z - anticipation * 0.11 + (deer ? 0.32 : 0.40) * lunge + bite * 0.10,
    );
    body.rotation.set(
      0.06 + lunge * (deer ? 0.16 : 0.12) + bite * 0.055,
      Math.sin(t * 7) * 0.025 * loom,
      Math.sin(t * (watcher ? 4.8 : 11)) * (watcher ? 0.065 : 0.025) * loom,
    );
    head.position.copy(this.restHead);
    head.position.z += lunge * 0.023 + bite * 0.018;
    head.scale.set(1, 1 + (watcher ? 0.07 : 0.025) * lunge, 1);

    if (deer) {
      // The blind Listener first cocks an ear, then drives its muzzle forward.
      head.rotation.set(
        0.10 - anticipation * 0.15 + lunge * 0.04 + bite * 0.19,
        Math.cos(t * 10) * 0.23 * (1 - lunge) + Math.sin(t * 6.5) * 0.08 * loom,
        0.09 + anticipation * 0.22 - lunge * 0.18 + Math.sin(t * 12) * 0.045 * loom + bite * 0.13,
      );
      jaw.rotation.set(0.025 + lunge * 0.70 + Math.sin(t * 18) * 0.035 * loom - bite * 0.66, 0, 0);
      maw.scale.set(1, 1 + lunge * 0.65 - bite * 0.48, 1);
    } else if (watcher) {
      // Suspended posture: a floating roll, overly loose jaw and trailing nerves.
      head.rotation.set(-0.04 - lunge * 0.13 + bite * 0.22, Math.sin(t * 4.8) * 0.11 * loom,
        -0.16 + Math.sin(t * 5.2) * 0.20 * loom - bite * 0.18);
      jaw.rotation.set(0.05 + lunge * 0.92 + twitch * 0.06 - bite * 0.82, 0, Math.sin(t * 7) * 0.035 * loom);
      maw.scale.set(1 + lunge * 0.14, 1 + lunge * 0.50 - bite * 0.32, 1);
    } else {
      // Lifeform locks on in discontinuous little head movements, then snaps shut.
      head.rotation.set(-0.04 - anticipation * 0.08 + twitch * 0.035 + bite * 0.17,
        Math.sin(twitchTime * 17) * 0.075 * loom, -0.20 + anticipation * 0.20 + twitch * 0.12 - bite * 0.17);
      jaw.rotation.set(0.025 + lunge * 0.77 + Math.sin(twitchTime * 29) * 0.055 * loom - bite * 0.70, 0, 0);
      maw.scale.set(1 + lunge * 0.12, 1 + lunge * 0.32 - bite * 0.23, 1);
    }

    for (const { upper, elbow, hand, fingers, side } of arms) {
      const unequal = Math.sin(t * 11 + side * 0.8) * 0.045 * loom;
      upper.rotation.set(
        -0.04 + anticipation * 0.19 - reach * (watcher ? 1.87 : deer ? 1.72 : 1.78) + unequal - bite * 0.045,
        side * (0.02 + reach * (watcher ? 0.34 : 0.25)),
        side * (0.12 + reach * 0.44 - grasp * 0.16 + unequal),
      );
      elbow.rotation.set(-0.23 + reach * 0.09 + Math.sin(t * 9 + side) * 0.055 * loom - bite * 0.075, 0, side * 0.025 * grasp);
      hand.rotation.set(0.13 * reach + twitch * 0.045, side * reach * 0.18,
        side * (0.11 + reach * (watcher ? 0.33 : 0.18) + Math.sin(t * 8 + side) * 0.09 * loom));
      for (let i = 0; i < fingers.length; i++) {
        // Splay on the reach; clutch around the camera during the lingering hold.
        const curl = anticipation * 0.35 - reach * 0.15 + grasp * 0.86 + bite * 0.20 + Math.sin(t * 10 + i + side) * 0.09 * loom;
        fingers[i].rotation.set(curl, 0, (i - 1.5) * (0.055 + reach * 0.045 - grasp * 0.03));
      }
    }
    for (const { hip, knee, foot, side } of legs) {
      hip.rotation.set(-0.05 + side * lunge * 0.16, 0, side * (0.035 + lunge * 0.035));
      knee.rotation.set(-0.12 - lunge * (side > 0 ? 0.20 : 0.06), 0, 0);
      foot.rotation.set(0.10 + lunge * 0.08, 0, 0);
    }
    for (let i = 0; i < tendrils.length; i++) {
      tendrils[i].rotation.set(-lunge * 0.38 + Math.sin(t * 10 + i * 0.7) * 0.17 * loom,
        0, Math.sin(t * 6 + i) * 0.18 * loom);
    }
    return this;
  }

  update(dt) {
    const scaledDt = Math.max(0, dt) * this.mixer.timeScale;
    if (!scaledDt) return; // flashlight freeze preserves the entire articulated pose
    this.clock += scaledDt * Math.max(0.2, this.timeScale);
    this.attack = Math.max(0, this.attack - scaledDt);
    const walking = this.currentName === 'walk' || this.currentName === 'sprint';
    this.motion += ((walking ? 1 : 0) - this.motion) * (1 - Math.exp(-8 * scaledDt));
    const deer = this.kind === 'human-deer', watcher = this.kind === 'bacteria-pill';
    // Bacteria move in an irregular twelve-frame cadence; the Listener's head
    // listens independently while its limbs drag underneath it.
    const t = deer ? this.clock : Math.floor(this.clock * 12) / 12;
    const pace = this.currentName === 'sprint' ? 7.2 : deer ? 4.2 : 4.8;
    const cycle = t * pace;
    const movement = this.motion * (watcher ? 0.27 : 1);
    const lunge = Math.sin(this.attack / 0.8 * Math.PI);
    const { body, head, jaw, maw, arms, legs, tendrils } = this.rig;
    body.position.x = this.restBody.x;
    body.position.z = this.restBody.z;
    body.position.y = this.restY + Math.sin(cycle * 2) * 0.025 * movement + Math.sin(t * 1.3) * 0.009;
    body.rotation.y = 0;
    body.rotation.x = (deer ? 0.13 : 0.075) + movement * 0.07 + lunge * 0.30;
    body.rotation.z = Math.sin(cycle) * 0.035 * movement + Math.sin(t * 0.73) * 0.025;
    head.rotation.y = Math.sin(t * (deer ? 1.4 : 0.7)) * (deer ? 0.24 : 0.09);
    head.rotation.z = (deer ? 0.07 : -0.20) + Math.sin(t * 0.9) * 0.09;
    head.rotation.x = (deer ? 0.14 : -0.04) + Math.sin(t * 1.7) * 0.04 - lunge * 0.2;
    head.position.copy(this.restHead);
    head.scale.setScalar(1);
    jaw.rotation.set(0.025 + lunge * 0.38, 0, 0);
    maw.scale.set(1, 1 + lunge * 0.30, 1);
    for (const { hip, knee, foot, side } of legs) {
      const stride = Math.sin(cycle + (side > 0 ? Math.PI : 0));
      hip.rotation.x = stride * 0.46 * movement - (watcher ? 0.13 : 0.04);
      hip.rotation.y = 0;
      hip.rotation.z = side * 0.035 + Math.cos(cycle) * 0.018 * movement;
      knee.rotation.x = -0.12 - Math.max(0, -stride) * 0.48 * movement;
      knee.rotation.y = knee.rotation.z = 0;
      foot.rotation.x = 0.10 + Math.max(0, stride) * 0.12 * movement;
      foot.rotation.y = foot.rotation.z = 0;
    }
    for (const { upper, elbow, hand, fingers, side } of arms) {
      const stride = Math.sin(cycle + (side > 0 ? 0 : Math.PI));
      upper.rotation.x = stride * 0.38 * movement - 0.05 - lunge * 1.1;
      upper.rotation.y = 0;
      upper.rotation.z = side * (0.12 + Math.sin(t * 1.1 + side) * 0.025 + lunge * 0.18);
      elbow.rotation.x = -0.23 + Math.sin(cycle + side * 0.5) * 0.13 * movement;
      elbow.rotation.y = elbow.rotation.z = 0;
      hand.rotation.x = hand.rotation.y = 0;
      hand.rotation.z = side * (0.11 + Math.sin(t * 2.1 + side) * 0.10);
      for (const finger of fingers) finger.rotation.set(lunge * 0.35, 0, 0);
    }
    for (let i = 0; i < tendrils.length; i++) {
      tendrils[i].rotation.x = Math.sin(t * 1.5 + i * 0.7) * 0.10;
      tendrils[i].rotation.y = 0;
      tendrils[i].rotation.z = Math.sin(t * 0.9 + i) * 0.08;
    }
  }
}

export function createCreatureRig(kind, { height = 2.7 } = {}) {
  const object = new THREE.Group();
  object.name = `specimen-${kind}`;
  const root = new THREE.Group();
  object.add(root);
  const rig = { root };
  const m = materials(kind);
  if (kind === 'human-deer') humanDeer(rig, m);
  else bacteria(rig, m, kind === 'bacteria-pill');
  batchParts(root);
  const bounds = new THREE.Box3().setFromObject(root);
  root.position.y = -bounds.min.y;
  object.scale.setScalar(height / (bounds.max.y - bounds.min.y));
  const animator = new CreatureAnimator(rig, kind);
  animator.update(1 / 60);
  const scale = object.scale.x;
  const design = {
    kind, jumpscareDuration: 1.9,
    // Metres at the requested height, measured forward from the face focus.
    faceRadius: (kind === 'human-deer' ? 0.28 : 0.23) * scale,
    frontClearance: (kind === 'human-deer' ? 0.40 : 0.12) * scale,
    recommendedCameraDistance: (kind === 'human-deer' ? 0.83 : 0.70) * scale,
    handReach: 1.65 * scale,
  };
  return { object, inner: root, animations: [], animator, focus: rig.focus, design };
}

export function disposeCreatureRig(object) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  object.traverse((child) => {
    if (!child.isMesh) return;
    geometries.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}
