// Original, offline facility specimens. Every texture/material belongs to its
// returned object, so the shared disposeCreatureRig() can release the entire rig.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeChestVisual, chestTimberTexture } from '../encounters.js';
import { rustTexture, textTexture } from '../textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const ease = (a, b, value) => { const t = clamp((value - a) / (b - a)); return t * t * (3 - 2 * t); };
const HEIGHTS = { 'wall-spider': 0.68, 'blind-seeker': 1.2, 'thief-bug': 0.78, mimic: 1.2 };

function hideTexture(seed) {
  const size = 96, pixels = new Uint8Array(size * size * 4);
  let state = seed;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const mottling = Math.sin(x * 0.19 + Math.sin(y * 0.12) * 2) * Math.cos(y * 0.16);
    const seam = Math.pow(Math.max(0, Math.sin(x * 0.56 + Math.sin(y * 0.18))), 18);
    const value = Math.max(36, Math.min(245, 162 + mottling * 41 - seam * 47 + (random() - 0.5) * 52));
    const offset = (y * size + x) * 4;
    pixels[offset] = value; pixels[offset + 1] = value * 0.95; pixels[offset + 2] = value * 0.83; pixels[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makeMaterials(kind) {
  const texture = hideTexture(kind === 'blind-seeker' ? 879 : kind === 'thief-bug' ? 413 : 227);
  const material = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({
    color, roughness, metalness, map: texture, bumpMap: texture, bumpScale: 0.012,
  });
  const m = {
    skin: material(kind === 'blind-seeker' ? 0x767879 : 0x3b3d2f, 0.84),
    shell: material(kind === 'thief-bug' ? 0x363d2a : 0x242720, 0.48, 0.12),
    tendon: material(0x302b22, 0.63),
    bone: material(0xaca58a, 0.82),
    wet: new THREE.MeshStandardMaterial({ color: 0x10130e, roughness: 0.19, metalness: 0.12 }),
    cavity: new THREE.MeshStandardMaterial({ color: 0x050605, roughness: 1 }),
  };
  if (kind === 'blind-seeker') m.gum = material(0x51342f, 0.68);
  if (kind === 'mimic') Object.assign(m, {
    wood: new THREE.MeshStandardMaterial({ map: chestTimberTexture(), color: 0x6f624a, roughness: 0.93 }),
    metal: new THREE.MeshStandardMaterial({ map: rustTexture(), color: 0x999b87, roughness: 0.72, metalness: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x252b22, roughness: 0.88, metalness: 0.45 }),
    lining: new THREE.MeshStandardMaterial({ color: 0x393e2d, roughness: 1 }),
    label: new THREE.MeshStandardMaterial({
      map: textTexture('SEALED', { color: '#bcb69a', font: 'bold 45px monospace' }),
      transparent: true, depthWrite: false, roughness: 1,
    }),
  });
  return m;
}

function mesh(parent, geometry, material, position, scale) {
  const result = new THREE.Mesh(geometry, material);
  if (position) result.position.set(...position);
  if (scale) result.scale.set(...scale);
  result.castShadow = result.receiveShadow = true;
  parent.add(result);
  return result;
}
function pivot(parent, position = [0, 0, 0]) {
  const result = new THREE.Group();
  result.position.set(...position); parent.add(result);
  return result;
}
function lump(parent, material, position, scale, detail = 1) {
  return mesh(parent, new THREE.IcosahedronGeometry(1, detail), material, position, scale);
}
function bone(parent, from, to, radius, material, tip = radius * 0.65) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta = b.clone().sub(a);
  const result = mesh(parent, new THREE.CylinderGeometry(tip, radius, delta.length(), 7), material);
  result.position.copy(a).add(b).multiplyScalar(0.5);
  result.quaternion.setFromUnitVectors(UP, delta.normalize());
  return result;
}
function fibre(parent, points, radius, material, taper = 0.18) {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)));
  const segments = Math.max(6, points.length * 3), sides = 5;
  const geometry = new THREE.TubeGeometry(curve, segments, radius, sides, false);
  const positions = geometry.attributes.position;
  for (let i = 0; i <= segments; i++) {
    const center = curve.getPointAt(i / segments);
    const scale = 1 - (1 - taper) * Math.pow(i / segments, 1.3);
    for (let j = 0; j <= sides; j++) {
      const k = i * (sides + 1) + j;
      positions.setXYZ(k, center.x + (positions.getX(k) - center.x) * scale,
        center.y + (positions.getY(k) - center.y) * scale, center.z + (positions.getZ(k) - center.z) * scale);
    }
  }
  geometry.computeVertexNormals();
  return mesh(parent, geometry, material);
}
function focus(rig, parent, position) {
  rig.focus = new THREE.Object3D();
  rig.focus.name = 'specimen-face-focus'; rig.focus.position.set(...position); parent.add(rig.focus);
}

// Keep articulation, merge all static meshes of one material within each part.
function batch(group) {
  for (const child of [...group.children]) if (child.isGroup) batch(child);
  const buckets = new Map();
  for (const child of group.children) if (child.isMesh) {
    if (!buckets.has(child.material)) buckets.set(child.material, []);
    buckets.get(child.material).push(child);
  }
  for (const [material, children] of buckets) {
    if (children.length < 2) continue;
    const geometries = children.map((child) => {
      child.updateMatrix();
      const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
      geometry.applyMatrix4(child.matrix);
      return geometry;
    });
    const combined = mergeGeometries(geometries, false);
    if (combined) {
      for (const child of children) { group.remove(child); child.geometry.dispose(); }
      mesh(group, combined, material);
    }
    for (const geometry of geometries) geometry.dispose();
  }
}

function jointedLeg(rig, side, index, position, upperEnd, lowerEnd, material, radius, claws = 1, clawMaterial = material, fingerLength = 0.13) {
  const upper = pivot(rig.body, position), knee = pivot(upper, upperEnd);
  bone(upper, [0, 0, 0], upperEnd, radius, material, radius * 0.65);
  lump(upper, material, upperEnd, [radius * 1.2, radius * 1.05, radius * 1.2]);
  bone(knee, [0, 0, 0], lowerEnd, radius * 0.62, material, radius * 0.25);
  const foot = pivot(knee, lowerEnd);
  for (let i = 0; i < claws; i++) {
    const x = (i - (claws - 1) / 2) * radius * 0.7;
    fibre(foot, [[x, 0, 0], [x * 1.5, -fingerLength * 0.12, fingerLength * 0.45], [x * 1.8, -fingerLength * 0.27, fingerLength]], radius * (claws > 1 ? 0.26 : 0.43), clawMaterial, 0.03);
  }
  rig.legs.push({ upper, knee, foot, side, index, front: position[2] > 0 });
  return upper;
}

function spider(rig, m) {
  rig.body = pivot(rig.root, [0, 0.37, 0]);
  lump(rig.body, m.shell, [0, 0.065, -0.29], [0.34, 0.245, 0.43], 2);
  lump(rig.body, m.shell, [0, 0.015, 0.18], [0.24, 0.18, 0.28], 2);
  lump(rig.body, m.tendon, [0, -0.09, -0.26], [0.27, 0.10, 0.34]);
  // A ridged dorsal seam and scarred abdominal plates catch the flashlight.
  for (let i = 0; i < 5; i++) {
    const z = -0.53 + i * 0.115;
    fibre(rig.body, [[-0.25, 0.12, z], [0, 0.29 - Math.abs(z + 0.28) * 0.3, z - 0.025], [0.25, 0.12, z]], 0.012, m.skin, 0.8);
  }
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
    const z = 0.36 - i * 0.18, spread = (1.5 - i) * 0.17;
    const upper = jointedLeg(rig, side, i, [side * 0.17, -0.015, z],
      [side * (0.34 + Math.sin(i + 0.4) * 0.055), 0.17, spread],
      [side * 0.30, -0.50, spread * 1.05], m.shell, 0.041);
    bone(upper, [side * 0.16, 0.085, spread * 0.4], [side * 0.17, 0.18, spread * 0.35], 0.013, m.shell, 0.001);
  }
  rig.head = pivot(rig.body, [0, -0.015, 0.43]);
  lump(rig.head, m.shell, [0, 0, 0.035], [0.18, 0.13, 0.17], 2);
  lump(rig.head, m.cavity, [0, -0.065, 0.15], [0.105, 0.055, 0.018]);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      lump(rig.head, m.wet, [side * (0.045 + i * 0.043), 0.054 - i * 0.013, 0.166 - i * 0.025], [0.022 - i * 0.003, 0.023 - i * 0.003, 0.014]);
    }
    const mandible = pivot(rig.head, [side * 0.09, -0.045, 0.13]);
    fibre(mandible, [[0, 0, 0], [side * 0.065, -0.035, 0.075], [side * 0.055, -0.12, 0.17], [-side * 0.015, -0.13, 0.20]], 0.045, m.shell, 0.03);
    bone(mandible, [side * 0.05, -0.07, 0.11], [-side * 0.025, -0.09, 0.14], 0.012, m.bone, 0.001);
    rig.mandibles.push({ group: mandible, side });
    fibre(rig.head, [[side * 0.14, -0.035, 0.055], [side * 0.23, -0.06, 0.17], [side * 0.17, -0.085, 0.29]], 0.018, m.skin, 0.08);
  }
  focus(rig, rig.head, [0, -0.025, 0.19]);
}

function beetle(rig, m) {
  rig.body = pivot(rig.root, [0, 0.35, 0]);
  lump(rig.body, m.tendon, [0, -0.015, -0.065], [0.30, 0.17, 0.39], 2);
  for (const side of [-1, 1]) {
    const shell = pivot(rig.body, [side * 0.025, 0.045, -0.08]);
    lump(shell, m.shell, [side * 0.13, 0.04, -0.035], [0.18, 0.24, 0.39], 2);
    for (let i = 0; i < 4; i++) fibre(shell,
      [[side * (0.06 + i * 0.039), 0.245 - i * 0.035, 0.24], [side * (0.08 + i * 0.046), 0.24 - i * 0.035, -0.03], [side * (0.06 + i * 0.04), 0.19 - i * 0.027, -0.31]],
      0.007, m.skin, 0.8);
    rig.shells.push({ group: shell, side });
    for (let i = 0; i < 3; i++) {
      jointedLeg(rig, side, i, [side * 0.21, -0.045, 0.20 - i * 0.22],
        [side * 0.24, 0.025, (1 - i) * 0.17], [side * 0.15, -0.30, (1 - i) * 0.12], m.shell, 0.032);
    }
  }
  rig.head = pivot(rig.body, [0, -0.035, 0.35]);
  lump(rig.head, m.shell, [0, 0.035, 0.03], [0.19, 0.15, 0.18], 2);
  lump(rig.head, m.cavity, [0, -0.04, 0.155], [0.11, 0.06, 0.022]);
  for (const side of [-1, 1]) {
    lump(rig.head, m.wet, [side * 0.145, 0.07, 0.12], [0.046, 0.052, 0.031], 2);
    const mandible = pivot(rig.head, [side * 0.10, -0.035, 0.14]);
    fibre(mandible, [[0, 0, 0], [side * 0.12, -0.015, 0.12], [side * 0.08, 0.005, 0.29], [-side * 0.035, 0.025, 0.31]], 0.04, m.shell, 0.035);
    for (let i = 0; i < 3; i++) bone(mandible, [side * 0.09, 0, 0.10 + i * 0.055], [side * 0.025, 0.01, 0.13 + i * 0.055], 0.01, m.bone, 0.001);
    rig.mandibles.push({ group: mandible, side });
    const antenna = pivot(rig.head, [side * 0.10, 0.11, 0.10]);
    fibre(antenna, [[0, 0, 0], [side * 0.09, 0.17, 0.10], [side * 0.15, 0.24, 0.25], [side * 0.18, 0.20, 0.32]], 0.014, m.shell, 0.18);
    lump(antenna, m.shell, [side * 0.18, 0.20, 0.32], [0.027, 0.021, 0.038]);
    rig.antennae.push({ group: antenna, side });
  }
  focus(rig, rig.head, [0, 0.015, 0.20]);
}

function seeker(rig, m) {
  // The reference silhouette is a crouched, eyeless ghoul: its elbows and
  // knees rise above a low trunk, and its mouth hangs almost to the ground.
  rig.body = pivot(rig.root, [0, 0.45, 0]);
  lump(rig.body, m.skin, [0, 0.005, -0.045], [0.26, 0.19, 0.54], 2);
  lump(rig.body, m.skin, [0, -0.035, -0.43], [0.29, 0.20, 0.25], 2);
  lump(rig.body, m.skin, [0, 0.055, 0.31], [0.31, 0.22, 0.27], 2);
  fibre(rig.body, [[0, 0.16, -0.57], [0, 0.205, -0.21], [0, 0.235, 0.19], [0, 0.18, 0.47]], 0.022, m.skin, 0.7);
  for (let i = 0; i < 7; i++) {
    const z = -0.44 + i * 0.13;
    lump(rig.body, m.skin, [0, 0.205, z], [0.026, 0.022, 0.034]);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const z = -0.28 + i * 0.13;
      fibre(rig.body, [[side * 0.035, 0.19, z], [side * 0.24, 0.08, z + 0.04], [side * 0.235, -0.07, z], [side * 0.12, -0.15, z - 0.04]], 0.012, m.skin, 0.65);
    }
    const arm = jointedLeg(rig, side, 0, [side * 0.23, 0.06, 0.33],
      [side * 0.29, 0.51, 0.12], [side * 0.035, -0.91, 0.27], m.skin, 0.078, 4, m.wet, 0.32);
    lump(arm, m.skin, [side * 0.13, 0.24, 0.055], [0.10, 0.27, 0.10]);
    lump(arm, m.bone, [side * 0.29, 0.55, 0.12], [0.055, 0.10, 0.055]);
    const haunch = jointedLeg(rig, side, 1, [side * 0.24, 0.035, -0.35],
      [side * 0.34, 0.53, -0.36], [side * 0.095, -0.91, 0.19], m.skin, 0.092, 4, m.wet, 0.29);
    fibre(haunch, [[0, 0, 0], [side * 0.18, 0.29, -0.18], [side * 0.34, 0.53, -0.36]], 0.102, m.skin, 0.56);
  }
  rig.head = pivot(rig.body, [0, 0.055, 0.46]);
  // There is no eye socket or muzzle: a smooth, heavy brow caps a vertical maw.
  lump(rig.head, m.skin, [0, -0.025, -0.035], [0.275, 0.365, 0.21], 2);
  lump(rig.head, m.skin, [0, 0.205, 0.025], [0.27, 0.16, 0.20], 2);
  lump(rig.head, m.cavity, [0, -0.07, 0.176], [0.205, 0.29, 0.053], 2);
  lump(rig.head, m.gum, [0, -0.075, 0.216], [0.09, 0.15, 0.014], 2);
  for (const side of [-1, 1]) {
    fibre(rig.head, [[side * 0.105, 0.185, 0.17], [side * 0.218, 0.07, 0.19],
      [side * 0.23, -0.16, 0.17], [side * 0.15, -0.315, 0.14]], 0.039, m.skin, 0.76);
    fibre(rig.head, [[side * 0.08, 0.145, 0.205], [side * 0.18, 0.015, 0.21],
      [side * 0.19, -0.16, 0.20], [side * 0.12, -0.28, 0.17]], 0.016, m.gum, 0.7);
    // Uneven folds across the sealed upper face emphasize the absent eyes.
    fibre(rig.head, [[side * 0.03, 0.22, 0.19], [side * 0.14, 0.21, 0.17], [side * 0.23, 0.17, 0.10]], 0.009, m.tendon, 0.4);
  }
  rig.jaw = pivot(rig.head, [0, -0.225, 0.025]);
  lump(rig.jaw, m.skin, [0, -0.105, 0.09], [0.21, 0.13, 0.15], 2);
  lump(rig.jaw, m.gum, [0, -0.022, 0.16], [0.165, 0.035, 0.035], 2);
  for (let i = 0; i < 9; i++) {
    const x = (i - 4) * 0.038, arch = 0.125 - Math.abs(x) * 0.37;
    const length = 0.035 + (i % 3) * 0.016;
    bone(rig.head, [x, arch, 0.213], [x * 0.93, arch - length, 0.225], 0.010, m.bone, 0.001);
    bone(rig.jaw, [x, -0.01, 0.18], [x * 0.94, -0.01 + length * 0.8, 0.185], 0.009, m.bone, 0.001);
  }
  fibre(rig.jaw, [[0, -0.035, 0.065], [0.015, -0.006, 0.16], [-0.01, -0.02, 0.23]], 0.031, m.gum, 0.42);
  let tailParent = pivot(rig.body, [0, -0.035, -0.55]);
  const lengths = [0.24, 0.23, 0.22, 0.20, 0.17, 0.14];
  for (let i = 0; i < lengths.length; i++) {
    const radius = 0.067 * (1 - i / 6.5), length = lengths[i];
    bone(tailParent, [0, 0, 0], [0, -0.015, -length], radius, m.skin, radius * 0.72);
    rig.tail.push(tailParent);
    tailParent = pivot(tailParent, [0, -0.015, -length]);
  }
  focus(rig, rig.head, [0, -0.08, 0.22]);
}

function mimic(rig, m) {
  rig.body = pivot(rig.root);
  const chest = makeChestVisual(m, (geometry, material, parent, x = 0, y = 0, z = 0) => mesh(parent, geometry, material, [x, y, z]));
  rig.body.add(chest.group);
  rig.head = chest.group;
  rig.lid = chest.lid;
  rig.latch = chest.latch;
  rig.contents = chest.contents;
  rig.mouth = pivot(rig.body);
  rig.upperTeeth = pivot(rig.lid);
  lump(rig.mouth, m.cavity, [0, 0.39, 0], [0.44, 0.13, 0.27], 2);
  for (let i = 0; i < 11; i++) {
    const x = (i - 5) * 0.084, length = 0.075 + (i % 3) * 0.025;
    bone(rig.mouth, [x, 0.52, 0.29], [x * 0.92, 0.52 + length, 0.265], 0.022, m.bone, 0.002);
    bone(rig.upperTeeth, [x, 0.015, 0.62], [x * 0.92, -length, 0.59], 0.024, m.bone, 0.002);
  }
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
    const z = -0.18 + i * 0.12;
    bone(rig.mouth, [side * 0.44, 0.52, z], [side * 0.405, 0.61, z], 0.022, m.bone, 0.002);
  }
  fibre(rig.mouth, [[0, 0.34, -0.1], [-0.025, 0.44, 0.15], [0.02, 0.49, 0.35], [-0.055, 0.43, 0.52]], 0.058, m.tendon, 0.28);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) jointedLeg(rig, side, i, [side * 0.44, 0.13, i === 0 ? 0.23 : -0.23],
      [side * 0.22, -0.08, i === 0 ? 0.15 : -0.15], [side * 0.10, -0.22, i === 0 ? 0.08 : -0.08], m.tendon, 0.046, 3, m.bone);
    fibre(rig.mouth, [[side * 0.39, 0.34, -0.23], [side * 0.43, 0.46, -0.12], [side * 0.38, 0.58, 0.14]], 0.027, m.tendon, 0.5);
  }
  focus(rig, rig.body, [0, 0.63, 0.33]);
}

class FacilityAnimator {
  constructor(rig, kind) {
    this.rig = rig; this.kind = kind;
    this.mixer = { timeScale: 1 };
    this.currentName = 'idle'; this.timeScale = 1;
    this.clock = 0; this.motion = 0; this.attack = 0;
    this.awakened = kind === 'mimic' ? 0 : 1;
    this.restBody = rig.body.position.clone();
    this.restHead = rig.head.position.clone();
    this.applyPose(0, 0, 0, 0, false);
  }

  has(name) { return ['idle', 'walk', 'sprint', 'attack-melee-right', 'carry'].includes(name); }

  play(name, { timeScale = 1, once = false } = {}) {
    if (!this.has(name)) return;
    if (once && name === 'attack-melee-right') this.attack = 0.75;
    this.currentName = name; this.timeScale = timeScale;
  }

  setAwakened(progress) {
    this.awakened = clamp(progress);
    if (this.kind === 'mimic') this.applyPose(this.clock, this.motion, 0, 0, false);
  }

  update(dt) {
    const step = Math.max(0, Number.isFinite(dt) ? dt : 0) * Math.max(0, this.mixer.timeScale);
    if (!step) return;
    this.clock += step * Math.max(0, this.timeScale);
    this.attack = Math.max(0, this.attack - step);
    const walking = ['walk', 'sprint', 'carry'].includes(this.currentName);
    this.motion += ((walking ? 1 : 0) - this.motion) * (1 - Math.exp(-10 * step));
    this.applyPose(this.clock, this.motion, Math.sin(this.attack / 0.75 * Math.PI) * 0.65, 0, false);
  }

  poseJumpscare(elapsed) {
    const t = Math.max(0, Math.min(1.9, Number.isFinite(elapsed) ? elapsed : 0));
    const lunge = ease(0.19, 0.43, t);
    const bite = ease(1.23, 1.37, t) * (1 - ease(1.44, 1.60, t));
    this.applyPose(t, 0, lunge, bite, true);
  }

  applyPose(t, movement, lunge, bite, shot) {
    const r = this.rig, seeker = this.kind === 'blind-seeker', chest = this.kind === 'mimic';
    const beetle = this.kind === 'thief-bug', awake = chest ? (shot ? 1 : this.awakened) : 1;
    const pace = this.currentName === 'sprint' ? 13 : seeker ? 5.8 : beetle ? 12 : 9.5;
    const cycle = t * pace;
    r.body.position.copy(this.restBody);
    r.body.position.y += chest ? awake * 0.18 : Math.sin(cycle * 2) * 0.012 * movement;
    r.body.position.y += awake * Math.sin(t * 2.1) * (seeker ? 0.009 : 0.003);
    r.body.position.z += lunge * (seeker ? 0.23 : 0.14) + bite * 0.055;
    r.body.rotation.set(lunge * (seeker ? 0.06 : -0.06), 0, Math.sin(cycle) * 0.018 * movement);
    if (!chest) {
      r.head.position.copy(this.restHead);
      r.head.rotation.set((seeker ? 0.025 : 0) - lunge * 0.12 + bite * 0.14,
        Math.sin(t * (shot ? 12 : 1.7)) * (shot ? 0.045 * lunge : seeker ? 0.13 : 0.035),
        Math.sin(t * 2.3) * (seeker ? 0.035 : 0.018) + Math.sin(t * 23) * 0.025 * lunge);
    }
    for (const leg of r.legs) {
      const phase = cycle + leg.index * (seeker ? Math.PI : 1.8) + (leg.side > 0 ? Math.PI : 0);
      const stride = Math.sin(phase), lift = Math.max(0, Math.cos(phase));
      leg.upper.visible = awake > 0.025;
      leg.upper.scale.setScalar(chest ? Math.max(0.015, awake) : 1);
      leg.upper.rotation.set((seeker ? stride * 0.29 * movement : 0) - lunge * (leg.front ? 0.40 : -0.13),
        stride * (seeker ? 0.08 : 0.24) * movement + leg.side * lunge * (leg.front ? -0.24 : 0.10),
        leg.side * (lift * 0.12 * movement - (chest ? (1 - awake) * 0.8 : 0)));
      leg.knee.rotation.set(-lift * 0.20 * movement - lunge * (leg.front ? 0.12 : 0),
        0, -leg.side * lift * 0.09 * movement);
      leg.foot.rotation.set(0, 0, 0);
    }
    for (const { group, side } of r.mandibles) {
      group.rotation.set(Math.sin(t * 11 + side) * 0.025,
        side * (0.06 + lunge * 0.39 - bite * 0.38 + Math.sin(t * 7) * 0.025), 0);
    }
    for (const { group, side } of r.antennae) group.rotation.set(Math.sin(t * 5 + side) * 0.09 - lunge * 0.20, side * Math.sin(t * 3.5) * 0.12, 0);
    for (const { group, side } of r.shells) group.rotation.set(0, 0, side * (0.025 * movement + lunge * 0.12));
    for (let i = 0; i < r.tail.length; i++) r.tail[i].rotation.set(Math.sin(t * 1.4 + i * 0.6) * 0.035,
      Math.sin(t * 2.0 + i * 0.55) * (0.065 + movement * 0.055), 0);
    if (r.jaw) r.jaw.rotation.set(0.16 + Math.sin(t * 2.3) * 0.025 + lunge * 0.61 - bite * 0.60, 0, 0);
    if (chest) {
      r.lid.rotation.set(-awake * (0.75 + Math.sin(t * 7) * 0.018) - lunge * 0.31 + bite * 0.60, 0, 0);
      r.latch.rotation.set(awake * 0.38, 0, Math.sin(t * 11) * 0.035 * awake);
      r.mouth.visible = r.upperTeeth.visible = awake > 0.045;
      r.contents.visible = awake < 0.08;
      r.mouth.scale.set(1, Math.max(0.01, awake), 1);
    }
  }
}

export function createFacilityRig(kind, { height = HEIGHTS[kind] || 1.2 } = {}) {
  const object = new THREE.Group(); object.name = 'facility-specimen-' + kind;
  const root = pivot(object);
  const rig = { root, legs: [], mandibles: [], antennae: [], shells: [], tail: [] };
  const materials = makeMaterials(kind);
  if (kind === 'wall-spider') spider(rig, materials);
  else if (kind === 'blind-seeker') seeker(rig, materials);
  else if (kind === 'thief-bug') beetle(rig, materials);
  else if (kind === 'mimic') mimic(rig, materials);
  else throw new Error('Unknown facility specimen: ' + kind);
  batch(root);
  const requestedHeight = Number.isFinite(height) && height > 0 ? height : HEIGHTS[kind];
  if (kind === 'mimic') {
    // Its dormant shell must exactly match an ordinary reward chest at height 1.2.
    object.scale.setScalar(requestedHeight / 1.2);
  } else {
    const bounds = new THREE.Box3().setFromObject(root);
    root.position.y = -bounds.min.y;
    object.scale.setScalar(requestedHeight / Math.max(0.01, bounds.max.y - bounds.min.y));
  }
  const animator = new FacilityAnimator(rig, kind);
  const scale = object.scale.x;
  const design = {
    kind, jumpscareDuration: 1.9,
    frontClearance: (kind === 'mimic' ? 0.27 : kind === 'thief-bug' ? 0.34 : 0.28) * scale,
    recommendedCameraDistance: (kind === 'mimic' ? 0.90 : kind === 'blind-seeker' ? 0.82 : 0.78) * scale,
  };
  object.userData.facilitySpecimen = kind;
  return { object, inner: root, animations: [], animator, focus: rig.focus, design };
}
