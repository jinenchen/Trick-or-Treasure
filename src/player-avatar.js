// Visual-only humanoid posing. Collision, camera, held-item physics and lights
// remain controlled by Player/Game. Imported geometry/materials stay cache-owned.
import * as THREE from 'three';
import { Animator } from './assets.js';

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0));
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const normalizeName = (name) => name.toLowerCase().split('|').pop()
  .replace(/mixamorig\d*|armature|skeleton/g, '').replace(/[^a-z0-9]/g, '').replace(/^bip\d*/, '');

const ALIASES = {
  hips: ['hips', 'pelvis', 'hip', 'rootpelvis'],
  spine: ['spine', 'spine0', 'spine01', 'torso'],
  chest: ['spine2', 'spine02', 'chest', 'upperchest', 'spine1', 'spine01'],
  neck: ['neck', 'neck1', 'neck01'], head: ['head', 'head1'],
};
for (const [side, letter] of [['left', 'l'], ['right', 'r']]) {
  ALIASES[side + 'UpperArm'] = [side + 'arm', side + 'upperarm', 'upperarm' + letter, 'upperarm' + side, letter + 'upperarm', 'arm' + side, letter + 'arm'];
  ALIASES[side + 'ForeArm'] = [side + 'forearm', side + 'lowerarm', 'lowerarm' + letter, 'forearm' + letter, letter + 'forearm', side + 'elbow'];
  ALIASES[side + 'Hand'] = [side + 'hand', 'hand' + letter, letter + 'hand', side + 'wrist'];
  ALIASES[side + 'UpperLeg'] = [side + 'upleg', side + 'upperleg', side + 'thigh', 'thigh' + letter, letter + 'thigh', 'upperleg' + letter];
  ALIASES[side + 'LowerLeg'] = [side + 'leg', side + 'lowerleg', side + 'calf', side + 'shin', 'calf' + letter, letter + 'calf', 'lowerleg' + letter];
  ALIASES[side + 'Foot'] = [side + 'foot', 'foot' + letter, letter + 'foot', side + 'ankle'];
}

function clipAliases(clips) {
  const result = [...clips], used = new Set(result.map(clip => clip.name));
  const patterns = {
    idle: /^(idle|standingidle|breathingidle)$/,
    walk: /^(walk|walking|walkcycle|walkforward)$/,
    sprint: /^(sprint|sprinting|run|running|runforward)$/,
    crouch: /^(crouch|crouching|crouchidle)$/,
    die: /^(die|death|dying|deathbackward)$/,
    'holding-both': /^(holdingboth|carryidle|carryingidle)$/,
  };
  for (const [alias, pattern] of Object.entries(patterns)) {
    if (used.has(alias)) continue;
    const original = clips.find(clip => pattern.test(normalizeName(clip.name)));
    if (original) { const copy = original.clone(); copy.name = alias; result.push(copy); used.add(alias); }
  }
  return result;
}

function save(node) {
  return { position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() };
}
function restore(node, state) {
  node.position.copy(state.position); node.quaternion.copy(state.quaternion); node.scale.copy(state.scale);
}
function ancestor(a, b) {
  const parents = new Set();
  for (let n = a?.parent; n; n = n.parent) parents.add(n);
  for (let n = b?.parent; n; n = n.parent) if (parents.has(n)) return n;
  return null;
}
function isDescendant(node, parent) {
  for (let n = node; n; n = n.parent) if (n === parent) return true;
  return false;
}

export class PlayerAvatar {
  constructor(player, { object, inner, animations = [], custom = false }) {
    this.player = player; this.object = object; this.inner = inner; this.custom = custom;
    this.frame = player.group || object.parent || object;
    this.rest = new Map();
    inner.traverse(node => this.rest.set(node, save(node)));
    this.corpseMeshes = [...this.rest.keys()].filter(node => node.isMesh && node.geometry?.attributes?.position);
    this.corpseGroundedPosition = null;
    this.objectRest = save(object);
    this.overlayBase = null;
    this.clock = 0; this.phase = 0; this.motion = 0; this.deathTime = 0;
    this.wasAlive = player.alive !== false; this.disposed = false;
    this.geometries = new Set(); this.materials = new Set(); this.textures = new Set();
    this.joints = {};
    const nodes = [];
    inner.traverse(node => { if (node.name) nodes.push(node); });
    for (const [role, aliases] of Object.entries(ALIASES)) {
      this.joints[role] = nodes.find(node => aliases.includes(normalizeName(node.name)) && node.isBone)
        || nodes.find(node => aliases.includes(normalizeName(node.name))) || null;
    }
    if (!this.joints.hips) {
      this.joints.hips = ancestor(this.joints.leftUpperLeg, this.joints.rightUpperLeg)
        || nodes.find(node => normalizeName(node.name) === 'root') || null;
    }
    const j = this.joints;
    this.arms = {}; this.legs = {};
    for (const side of ['left', 'right']) {
      const upper = j[side + 'UpperArm'], lower = j[side + 'ForeArm'], hand = j[side + 'Hand'];
      const thigh = j[side + 'UpperLeg'], shin = j[side + 'LowerLeg'], foot = j[side + 'Foot'];
      if (upper && lower && hand && isDescendant(lower, upper) && isDescendant(hand, lower)) this.arms[side] = [upper, lower, hand];
      if (thigh && shin && foot && isDescendant(shin, thigh) && isDescendant(foot, shin)) this.legs[side] = [thigh, shin, foot];
    }
    this.supportsHumanoid = !!(j.hips && j.head && this.arms.left && this.arms.right && this.legs.left && this.legs.right);
    this.anim = new Animator(inner, clipAliases(animations));
    this.hasLocomotionClips = this.anim.has('walk') || this.anim.has('sprint');
    // A random unnamed animation is not a valid idle/walk/death replacement.
    this.anim.fallback = null;
    this.supportsCrouch = this.supportsHumanoid || this.anim.has('crouch');
    this.frame.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(object);
    this.height = Math.max(0.5, bounds.max.y - bounds.min.y);
    this.restPoints = {};
    for (const [role, node] of Object.entries(j)) if (node) this.restPoints[role] = this.toLocal(node.getWorldPosition(new THREE.Vector3()));
    if (this.supportsHumanoid) {
      const reach = ['left', 'right'].map(side => this.restPoints[side + 'UpperArm'].distanceTo(this.restPoints[side + 'ForeArm'])
        + this.restPoints[side + 'ForeArm'].distanceTo(this.restPoints[side + 'Hand']));
      this.carryDistance = clamp((reach[0] + reach[1]) * 0.45 + 0.14, 0.60, 0.85);
    }
    this.headMargin = Math.max(0.08, this.height - (this.restPoints.head?.y || this.height * 0.88));
    this.sideSign = {
      left: Math.sign(this.restPoints.leftHand?.x || this.restPoints.leftUpperArm?.x || 1),
      right: Math.sign(this.restPoints.rightHand?.x || this.restPoints.rightUpperArm?.x || -1),
    };
    this.footOrientation = {};
    const frameInverse = this.frame.getWorldQuaternion(new THREE.Quaternion()).invert();
    for (const side of ['left', 'right']) if (this.legs[side]) {
      this.footOrientation[side] = frameInverse.clone().multiply(this.legs[side][2].getWorldQuaternion(new THREE.Quaternion()));
    }
    this.rigidEndpoints = {};
    this.rigidLegs = nodes.filter(node => node.isMesh && /^leg(left|right)$/.test(normalizeName(node.name)));
    this.handGrips = {};
    for (const side of ['left', 'right']) {
      const arm = j[side + 'UpperArm'];
      if (arm && !this.arms[side]) this.rigidEndpoints[side] = this.measureEndpoint(arm);
      const hand = j[side + 'Hand'];
      if (hand) {
        const child = hand.children.find(node => node.isBone && /palm|grip/i.test(node.name))
          || hand.children.find(node => node.isBone && /middle1|handend/i.test(node.name));
        if (child) this.handGrips[side] = child.position.clone().multiplyScalar(/palm|grip/i.test(child.name) ? 1 : 0.6);
        else {
          const wrist = hand.getWorldPosition(new THREE.Vector3());
          const elbow = j[side + 'ForeArm']?.getWorldPosition(new THREE.Vector3());
          this.handGrips[side] = elbow ? hand.worldToLocal(wrist.clone().addScaledVector(wrist.clone().sub(elbow).normalize(), this.height * 0.032)) : new THREE.Vector3();
        }
      }
    }
    this.torch = this.makeTorch();
    this.map = this.makeMap();
    this.torch.name = 'third-person-flashlight'; this.map.name = 'third-person-map';
    this.mount(this.torch, 'right');
    this.mount(this.map, 'left');
    this.diagnostics = {
      mode: this.supportsHumanoid ? (this.hasLocomotionClips ? 'authored-humanoid' : 'procedural-humanoid') : animations.length ? 'authored-articulated' : 'unrecognized-static',
      mapped: Object.fromEntries(Object.entries(j).map(([role, node]) => [role, node?.name || null])),
      reason: this.supportsHumanoid ? 'Independent recognized arm/leg chains; world-space IK preserves authored joint axes.'
        : animations.length ? 'Authored animation preserved; available arm nodes receive visual interaction overlays.'
          : 'No verified humanoid skeleton or animation clips; mesh is preserved without automatic re-skinning.',
    };
    this.reset();
  }

  toLocal(point) { return this.frame.worldToLocal(point); }
  toWorld(point) { return this.frame.localToWorld(point.clone()); }

  measureEndpoint(arm) {
    // For articulated rigid meshes (Kenney), measure the actual limb end rather
    // than guessing a hand bone that does not exist.
    arm.updateWorldMatrix(true, true);
    const inverse = arm.matrixWorld.clone().invert(), box = new THREE.Box3();
    arm.traverse(node => {
      if (!node.isMesh || node.isSkinnedMesh) return;
      node.geometry.computeBoundingBox();
      const local = node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld).applyMatrix4(inverse);
      box.union(local);
    });
    if (box.isEmpty()) return new THREE.Vector3(0, -0.2, 0);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const axis = size.x > size.y && size.x > size.z ? 'x' : size.z > size.y ? 'z' : 'y';
    center[axis] = Math.abs(box.min[axis]) > Math.abs(box.max[axis]) ? box.min[axis] : box.max[axis];
    return center;
  }

  ownMesh(parent, geometry, material) {
    this.geometries.add(geometry); this.materials.add(material);
    const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = false; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }

  makeTorch() {
    const group = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x40483d, metalness: 0.65, roughness: 0.5 });
    const grip = this.ownMesh(group, new THREE.CylinderGeometry(0.022, 0.021, 0.20, 10), metal);
    grip.rotation.x = Math.PI / 2;
    const bezel = this.ownMesh(group, new THREE.CylinderGeometry(0.034, 0.025, 0.055, 12), metal);
    bezel.rotation.x = Math.PI / 2; bezel.position.z = 0.115;
    const lensMaterial = new THREE.MeshStandardMaterial({ color: 0xbfc6a9, emissive: 0xc5d3aa, emissiveIntensity: 0.75, roughness: 0.2 });
    this.torchLens = this.ownMesh(group, new THREE.CircleGeometry(0.026, 12), lensMaterial);
    this.torchLens.position.z = 0.144;
    return group;
  }

  makeMap() {
    const group = new THREE.Group(), canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 192;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#99967d'; ctx.fillRect(0, 0, 256, 192);
    ctx.strokeStyle = '#40483a'; ctx.lineWidth = 3;
    for (const [x, y, w, h] of [[20, 35, 62, 47], [115, 24, 108, 55], [38, 116, 74, 48], [158, 112, 59, 53]]) ctx.strokeRect(x, y, w, h);
    ctx.beginPath(); ctx.moveTo(82, 61); ctx.lineTo(129, 61); ctx.lineTo(129, 137); ctx.lineTo(158, 137);
    ctx.moveTo(76, 116); ctx.lineTo(76, 96); ctx.lineTo(182, 96); ctx.lineTo(182, 79); ctx.stroke();
    ctx.fillStyle = '#343b2d'; ctx.font = 'bold 12px monospace'; ctx.fillText('GRIMCO / FACILITY', 16, 17);
    ctx.strokeStyle = 'rgba(40,45,32,.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(128, 0); ctx.lineTo(128, 192); ctx.moveTo(0, 96); ctx.lineTo(256, 96); ctx.stroke();
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.add(texture);
    const material = new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide, roughness: 0.98 });
    const paper = this.ownMesh(group, new THREE.PlaneGeometry(0.34, 0.25, 2, 1), material);
    paper.position.x = -this.sideSign.left * 0.16;
    return group;
  }

  mount(prop, side) {
    const joint = this.joints[side + 'Hand'] || this.joints[side + 'UpperArm'] || this.object;
    joint.add(prop);
    prop.userData.side = side;
    prop.visible = false;
  }

  reset() {
    if (this.disposed) return;
    this.anim.mixer.stopAllAction();
    this.anim.current = null; this.anim.currentName = '';
    for (const [node, state] of this.rest) restore(node, state);
    restore(this.object, this.objectRest);
    this.overlayBase = null;
    this.corpseGroundedPosition = null;
    this.clock = this.phase = this.motion = this.deathTime = 0;
    this.wasAlive = this.player.alive !== false;
    this.anim.play('idle', { fade: 0 });
    this.frame.updateWorldMatrix(true, true);
    this.updateProps();
  }

  // Rotate a joint toward its child using current world directions. The
  // imported bone's local axis, roll and nonidentity bind rotation are retained.
  aim(node, childWorld, targetWorld) {
    const origin = node.getWorldPosition(new THREE.Vector3());
    const from = childWorld.clone().sub(origin), to = targetWorld.clone().sub(origin);
    if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return;
    const delta = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
    const world = delta.multiply(node.getWorldQuaternion(new THREE.Quaternion()));
    const parent = node.parent?.getWorldQuaternion(new THREE.Quaternion()) || new THREE.Quaternion();
    node.quaternion.copy(parent.invert().multiply(world));
    node.updateWorldMatrix(false, true);
  }

  solve(chain, targetLocal, poleLocal) {
    const [upper, lower, end] = chain;
    const a = upper.getWorldPosition(new THREE.Vector3()), b = lower.getWorldPosition(new THREE.Vector3()), c = end.getWorldPosition(new THREE.Vector3());
    const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
    if (l1 < 1e-5 || l2 < 1e-5) return;
    const requested = this.toWorld(targetLocal), direction = requested.clone().sub(a);
    const distance = clamp(direction.length(), Math.abs(l1 - l2) + 0.002, l1 + l2 - 0.004);
    if (direction.lengthSq() < 1e-8) direction.set(0, -1, 0); else direction.normalize();
    const bend = this.toWorld(poleLocal).sub(a);
    bend.addScaledVector(direction, -bend.dot(direction));
    if (bend.lengthSq() < 1e-8) bend.copy(b).sub(a).addScaledVector(direction, -b.clone().sub(a).dot(direction));
    if (bend.lengthSq() < 1e-8) bend.crossVectors(direction, Math.abs(direction.y) < 0.9 ? Y : X);
    bend.normalize();
    const along = (l1 * l1 + distance * distance - l2 * l2) / (2 * distance);
    const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const middle = a.clone().addScaledVector(direction, along).addScaledVector(bend, height);
    const target = a.clone().addScaledVector(direction, distance);
    this.aim(upper, b, middle);
    this.aim(lower, end.getWorldPosition(new THREE.Vector3()), target);
  }

  rotate(node, axis, angle) {
    if (!node || Math.abs(angle) < 1e-6) return;
    const worldAxis = axis.clone().applyQuaternion(this.frame.getWorldQuaternion(new THREE.Quaternion()));
    const world = new THREE.Quaternion().setFromAxisAngle(worldAxis, angle).multiply(node.getWorldQuaternion(new THREE.Quaternion()));
    const parent = node.parent?.getWorldQuaternion(new THREE.Quaternion()) || new THREE.Quaternion();
    node.quaternion.copy(parent.invert().multiply(world)); node.updateWorldMatrix(false, true);
  }

  shiftHips(amount) {
    const hips = this.joints.hips;
    if (!hips || !amount) return;
    const position = this.toLocal(hips.getWorldPosition(new THREE.Vector3())); position.y += amount;
    hips.position.copy(hips.parent.worldToLocal(this.toWorld(position)));
    hips.updateWorldMatrix(false, true);
  }

  chooseClip(speed) {
    const p = this.player;
    if (!p.alive) { this.anim.play('die', { once: true, fade: 0.1 }); return; }
    if (p.hidingSpot?.kind === 'table' && this.anim.has('crouch')) { this.anim.play('crouch', { fade: 0.12 }); return; }
    if (p.webbedBy && this.anim.has('holding-both')) { this.anim.play('holding-both'); return; }
    if (speed > 3.6 && this.anim.has('sprint')) this.anim.play('sprint', { timeScale: Math.max(0.5, speed / 5) });
    else if (speed > 0.12 && this.anim.has('walk')) this.anim.play('walk', { timeScale: Math.max(0.15, speed / 2.6) });
    else this.anim.play((p.holding || p.mapOpen) && this.anim.has('holding-both') ? 'holding-both' : 'idle');
  }

  update(dt) {
    if (this.disposed) return;
    const p = this.player, step = clamp(dt, 0, 0.1), speed = p.alive && !p.hidingSpot && !p.webbedBy ? Math.hypot(p.vel?.x || 0, p.vel?.z || 0) : 0;
    if (p.alive && !this.wasAlive) this.reset();
    if (!p.alive && this.wasAlive) { this.deathTime = 0; this.corpseGroundedPosition = null; }
    this.wasAlive = p.alive;
    this.clock += step;
    this.deathTime = p.alive ? 0 : this.deathTime + step;
    this.phase += speed * step * Math.PI * 2 / (speed > 3.6 ? 2.3 : 1.6);
    this.motion += (clamp(speed / 1.2) - this.motion) * (1 - Math.exp(-12 * step));
    if (this.overlayBase) for (const [node, state] of this.overlayBase) restore(node, state);
    if (this.supportsHumanoid && !this.hasLocomotionClips) for (const [node, state] of this.rest) restore(node, state);
    restore(this.object, this.objectRest);
    this.chooseClip(speed);
    this.anim.update(step);
    this.overlayBase = new Map([...this.rest.keys()].map(node => [node, save(node)]));
    this.frame.updateWorldMatrix(true, true);
    if (this.supportsHumanoid) this.poseHumanoid(speed);
    else this.poseArticulated();
    if (!p.alive && !this.anim.has('die')) {
      const t = clamp(this.deathTime / 0.8), fall = 1 - Math.pow(1 - t, 3);
      this.object.quaternion.copy(this.objectRest.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(X, -Math.PI / 2 * fall));
      this.object.position.y = this.objectRest.position.y + 0.13 * fall;
      this.groundCorpse(t >= 1);
    }
    this.frame.updateWorldMatrix(true, true);
    this.updateProps();
  }

  groundCorpse(settled) {
    if (settled && this.corpseGroundedPosition) {
      this.object.position.copy(this.corpseGroundedPosition);
      return;
    }
    this.frame.updateWorldMatrix(true, false);
    // SkinnedMesh.updateMatrixWorld also refreshes its attached bind inverse;
    // updateWorldMatrix alone would apply the fallen root twice to CPU vertices.
    this.frame.updateMatrixWorld(true);
    const point = new THREE.Vector3();
    let bottom = Infinity;
    // Bound the cost during the brief fall; resolve every deformed vertex once
    // when it settles. The cached support excludes owned hand props.
    for (const mesh of this.corpseMeshes) {
      const count = mesh.geometry.attributes.position.count;
      const stride = settled ? 1 : Math.max(1, Math.ceil(count / 512));
      for (let i = 0; i < count; i += stride) {
        mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
        bottom = Math.min(bottom, point.y);
      }
    }
    if (!Number.isFinite(bottom)) return;
    const floor = this.frame.getWorldPosition(point).y;
    this.object.getWorldPosition(point); point.y += floor + 0.01 - bottom;
    this.object.position.copy(this.object.parent.worldToLocal(point));
    if (settled) this.corpseGroundedPosition = this.object.position.clone();
  }

  armTarget(side) {
    const p = this.player, sign = this.sideSign[side], crouch = p.hidingSpot?.kind === 'table';
    if (!p.alive) return new THREE.Vector3(sign * 0.23, this.height * 0.40, 0.03);
    if (p.webbedBy) return new THREE.Vector3(sign * 0.28, this.height * 0.70 + Math.sin(this.clock * 6 + sign) * 0.015, 0.28);
    if (p.holding && (side === 'left' || p.holding.heavy)) {
      const item = p.holding, target = item.pos.clone();
      target.y += (item.height || 0.4) * 0.68;
      const toward = new THREE.Vector3(p.pos.x - target.x, 0, p.pos.z - target.z).normalize();
      target.addScaledVector(toward, (item.radius || 0.2) * 0.8);
      const local = this.toLocal(target);
      local.x += sign * (item.heavy ? 0.16 : 0.06);
      return local;
    }
    if (p.mapOpen && !p.holding) return new THREE.Vector3(sign * 0.18, crouch ? 0.46 : this.height * 0.65, 0.37);
    if (crouch) return new THREE.Vector3(sign * 0.23, 0.41, 0.30);
    if (side === 'right' && p.flashOn) return new THREE.Vector3(sign * 0.22, (p.eyeHeight || 1.42) - 0.20 + Math.sin(p.pitch || 0) * 0.13, 0.43);
    return new THREE.Vector3(sign * 0.23, this.height * 0.45 + Math.abs(Math.sin(this.phase)) * 0.018 * this.motion,
      0.04 + Math.sin(this.phase + (side === 'left' ? Math.PI : 0)) * this.motion * (this.player.speed > 3.6 ? 0.28 : 0.17));
  }

  poseHumanoid(speed) {
    const p = this.player, j = this.joints, crouch = p.alive && p.hidingSpot?.kind === 'table';
    if (!p.alive && this.anim.has('die')) return;
    const lean = !p.alive ? 0 : crouch ? 0.64 : p.holding ? 0.10 : speed > 3.6 ? 0.14 : 0;
    const bodyPitch = p.alive ? -(p.pitch || 0) * 0.13 : 0;
    if (!p.alive) {
      this.shiftHips(-0.10 * clamp(this.deathTime / 0.3));
    } else if (crouch) {
      this.shiftHips(-Math.min((this.restPoints.hips?.y || 0.9) * 0.66, this.height * 0.36));
    } else if (!this.hasLocomotionClips) {
      this.shiftHips(Math.sin(this.clock * 1.8) * 0.004 + Math.cos(this.phase * 2) * 0.012 * this.motion);
    }
    this.rotate(j.spine || j.chest, X, lean * 0.62 + bodyPitch);
    if (j.chest && j.chest !== j.spine) this.rotate(j.chest, X, lean * 0.38);
    if (p.alive) {
      this.rotate(j.neck, X, -(p.pitch || 0) * 0.22 - (crouch ? 0.14 : 0));
      this.rotate(j.head, X, -(p.pitch || 0) * 0.60 - (crouch ? 0.18 : 0) + Math.sin(this.clock * 1.4) * 0.008);
    }
    if (crouch) {
      const top = this.toLocal(j.head.getWorldPosition(new THREE.Vector3())).y + this.headMargin;
      if (top > 0.98) this.shiftHips(-Math.min(0.18, top - 0.98));
    }
    const velocity = new THREE.Vector3(p.vel?.x || 0, 0, p.vel?.z || 0)
      .applyQuaternion(this.frame.getWorldQuaternion(new THREE.Quaternion()).invert());
    const backwardOrStrafe = velocity.z < -0.05 || Math.abs(velocity.x) > Math.abs(velocity.z) * 0.3;
    if (velocity.lengthSq()) velocity.normalize();
    if (!this.hasLocomotionClips || crouch || backwardOrStrafe || !p.alive) {
      for (const side of ['left', 'right']) {
        const rest = this.restPoints[side + 'Foot'], phase = this.phase + (side === 'left' ? 0 : Math.PI);
        const target = rest.clone();
        if (p.alive && !crouch && !p.webbedBy) {
          target.addScaledVector(velocity, Math.sin(phase) * this.motion * (speed > 3.6 ? 0.36 : 0.24));
          target.y += Math.max(0, Math.cos(phase)) * this.motion * (speed > 3.6 ? 0.12 : 0.075);
        } else if (crouch) { target.z += 0.11; target.x += this.sideSign[side] * 0.025; }
        this.solve(this.legs[side], target, new THREE.Vector3(this.sideSign[side] * 0.15, 0.45, 0.85));
        const foot = this.legs[side][2], parent = foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
        foot.quaternion.copy(parent.multiply(this.frame.getWorldQuaternion(new THREE.Quaternion())).multiply(this.footOrientation[side]));
        foot.updateWorldMatrix(false, true);
      }
    }
    for (const side of ['left', 'right']) {
      const target = this.armTarget(side), pole = new THREE.Vector3(this.sideSign[side] * 0.55, crouch ? 0.40 : this.height * 0.55, 0.05);
      this.solve(this.arms[side], target, pole);
      if (p.alive && (p.holding && (side === 'left' || p.holding.heavy) || p.mapOpen || side === 'right' && p.flashOn)) {
        // Interaction targets describe a grip point, not the wrist joint.
        const hand = this.joints[side + 'Hand'];
        const palm = this.toLocal(hand.localToWorld(this.handGrips[side].clone()));
        const wrist = this.toLocal(hand.getWorldPosition(new THREE.Vector3()));
        target.sub(palm.sub(wrist));
        this.solve(this.arms[side], target, pole);
      }
    }
  }

  poseArticulated() {
    const p = this.player;
    if (!p.alive) return; // Respect the authored corpse animation.
    const crouch = p.hidingSpot?.kind === 'table';
    if (crouch && this.anim.has('crouch') && this.rigidLegs.length === 2) {
      // The kit's authored crouch is a kneel with an upright, oversized helmet.
      // Fold the actual torso/head joints under cover; keep rigid shoes planted.
      this.rotate(this.joints.spine, X, 0.72);
      this.rotate(this.joints.head, X, 0.42 - clamp(p.pitch || 0, -0.15, 0.15) * 0.2);
      for (const leg of this.rigidLegs) {
        leg.geometry.computeBoundingBox();
        const bottom = leg.geometry.boundingBox.clone().applyMatrix4(leg.matrixWorld).min.y;
        const floor = this.frame.getWorldPosition(new THREE.Vector3()).y;
        if (bottom < floor) {
          const position = leg.getWorldPosition(new THREE.Vector3()); position.y += floor - bottom;
          leg.position.copy(leg.parent.worldToLocal(position)); leg.updateWorldMatrix(false, true);
        }
      }
    } else this.rotate(this.joints.head, X, -(p.pitch || 0) * 0.65);
    for (const side of ['left', 'right']) {
      const arm = this.joints[side + 'UpperArm'], endpoint = this.rigidEndpoints[side];
      if (!arm || !endpoint) continue;
      const interacting = p.holding || p.mapOpen || p.webbedBy || side === 'right' && p.flashOn;
      if (!interacting || crouch) continue;
      this.aim(arm, arm.localToWorld(endpoint.clone()), this.toWorld(this.armTarget(side)));
    }
  }

  updateProps() {
    const p = this.player;
    this.torch.visible = !!p.alive && !p.mapOpen && !p.holding?.heavy && !p.webbedBy;
    this.map.visible = !!p.alive && !!p.mapOpen && !p.holding && !p.webbedBy;
    this.torchLens.material.emissiveIntensity = p.lightOn ? 0.8 : 0;
    this.torchLens.material.color.setHex(p.lightOn ? 0xd4dcc2 : 0x42493c);
    const frameQ = this.frame.getWorldQuaternion(new THREE.Quaternion());
    for (const prop of [this.torch, this.map]) {
      const parent = prop.parent, side = prop.userData.side;
      const endpoint = parent === this.joints[side + 'Hand'] ? this.handGrips[side].clone()
        : this.rigidEndpoints[side]?.clone() || new THREE.Vector3(this.sideSign[side] * 0.2, this.height * 0.65, 0.25);
      prop.position.copy(endpoint);
      const desired = frameQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(X, prop === this.map ? -2.35 : -(p.pitch || 0)));
      prop.quaternion.copy(parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired));
      const scale = parent.getWorldScale(new THREE.Vector3());
      prop.scale.set(1 / Math.max(1e-5, Math.abs(scale.x)), 1 / Math.max(1e-5, Math.abs(scale.y)), 1 / Math.max(1e-5, Math.abs(scale.z)));
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.anim.mixer.stopAllAction(); this.anim.mixer.uncacheRoot(this.inner);
    this.torch.removeFromParent(); this.map.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.geometries.clear(); this.materials.clear(); this.textures.clear();
  }
}
