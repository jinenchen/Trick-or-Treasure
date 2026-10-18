// Player/viewport integration plus a real skinned Mixamo fixture for the optional
// unanimated GLB path. The fixture is test geometry, never a replacement asset.
import * as THREE from 'three';
import { PlayerAvatar } from './player-avatar.js';

const DT = 1 / 60;
const STILL = { forward: 0, strafe: 0, turn: 0, mouseTurn: 0, mouseLook: 0, look: 0, sprint: false,
  grabPressed: false, flashPressed: false, hidePressed: false, mapPressed: false, stunPressed: false, lurePressed: false };
function assert(condition, message) { if (!condition) throw new Error(message); }

function setup(game) {
  game.startRun(2, { skipNotice: true });
  for (const monster of game.monsters) monster.dispose();
  game.monsters = [];
  game.jumpscares.clear();
  for (const trap of game.encounters?.traps || []) game.encounters.disarm(trap, game.players[0]);
  assert(game.players.every(player => player.avatar instanceof PlayerAvatar), 'Player is not wired to PlayerAvatar');
  return game.players;
}

function tick(game, intents = []) {
  game.testIntents = game.players.map((_, index) => ({ ...STILL, ...intents[index] }));
  try { game.step(DT); }
  finally { game.testIntents = null; }
  for (const player of game.players) player.updateCamera(DT);
}

function advance(game, seconds, intents = []) {
  for (let i = 0; i < Math.ceil(seconds / DT); i++) tick(game, intents);
}

function descendants(root, predicate) {
  const result = [];
  root.traverse(node => { if (predicate(node)) result.push(node); });
  return result;
}

function pose(root) {
  return descendants(root, () => true).map(node => [...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()].join(',')).join('|');
}

function resources(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root?.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  return { geometries, materials, textures };
}

function watch(resourcesToWatch) {
  const events = new Map(), listeners = new Map();
  for (const resource of resourcesToWatch) {
    events.set(resource, 0);
    const listener = () => events.set(resource, events.get(resource) + 1);
    listeners.set(resource, listener); resource.addEventListener('dispose', listener);
  }
  return {
    events,
    stop() { for (const [resource, listener] of listeners) resource.removeEventListener('dispose', listener); },
  };
}

function attachedTo(node, ancestor) {
  for (let parent = node; parent; parent = parent.parent) if (parent === ancestor) return true;
  return false;
}

function characterBounds(player) {
  // Read deformed vertices, not cached rest-pose geometry bounds. Traverse each
  // imported mesh directly so map/torch descendants cannot inflate the result.
  player.group.updateMatrixWorld(true);
  const bounds = new THREE.Box3(), point = new THREE.Vector3();
  player.rig.traverse(node => {
    if (!node.isMesh || attachedTo(node, player.avatar.torch) || attachedTo(node, player.avatar.map)) return;
    const vertices = node.geometry?.attributes?.position;
    if (!vertices) return;
    for (let index = 0; index < vertices.count; index++) {
      node.getVertexPosition(index, point);
      bounds.expandByPoint(point.applyMatrix4(node.matrixWorld));
    }
  });
  assert(!bounds.isEmpty(), 'character has no actual vertices for cover bounds');
  return bounds;
}

function inspectViews(game) {
  const views = [], original = game.film.render;
  game.film.render = (scene, camera, options) => views.push({
    scene, camera, index: options.index,
    bodies: game.players.map(player => player.body.visible),
    torches: game.players.map(player => player.viewModel.layers.test(camera.layers)),
  });
  try { game.render(); }
  finally { game.film.render = original; }
  return views;
}

function safeWorkPoint(game) {
  for (const [x, y] of game.level.floorCells) {
    const point = game.level.cellCenter(x, y);
    if (!game.level.roomAt(point.x, point.z)?.index || game.level.occupied.has(y * game.level.W + x)) continue;
    if (game.encounters.chests.some(chest => chest.pos.distanceTo(point) < 2.6)) continue;
    if (game.level.hidingSpots.some(spot => spot.pos.distanceTo(point) < 2)) continue;
    const checked = point.clone(); game.level.collideCircle(checked, 0.45);
    if (checked.distanceTo(point) < 0.001) return point;
  }
  throw new Error('No free real floor point for carried-state check');
}

export const PLAYER_AVATAR_TESTS = {
  playerAvatarIndependence(game) {
    const [a, b] = setup(game);
    const aNodes = new Set(descendants(a.body, () => true));
    assert(descendants(b.body, () => true).every(node => !aNodes.has(node)), 'players share model or bone nodes');
    const aMaterials = new Set(a.materials);
    assert(b.materials.every(material => !aMaterials.has(material)), 'players share mutable character materials');
    const aMeshes = descendants(a.body, node => node.isSkinnedMesh);
    const bMeshes = descendants(b.body, node => node.isSkinnedMesh);
    for (const mesh of aMeshes) for (const other of bMeshes) {
      assert(mesh.skeleton !== other.skeleton, 'players share a Skeleton instance');
      assert(mesh.skeleton.bones.every(bone => !other.skeleton.bones.includes(bone)), 'players share a live skinning bone');
    }
    const bones = descendants(a.body, node => node.isBone);
    const partnerPose = pose(b.body);
    if (bones.length) {
      const bone = bones.find(node => /arm/i.test(node.name)) || bones[0], before = bone.quaternion.clone();
      bone.rotateX(0.42); a.body.updateMatrixWorld(true);
      assert(pose(b.body) === partnerPose, 'moving one skeleton changed the partner');
      bone.quaternion.copy(before);
    }
    const material = a.materials.find(entry => entry.color), partnerColors = b.materials.map(entry => entry.color?.getHex());
    assert(material, 'character has no material to verify tint isolation');
    const color = material.color.clone(); material.color.setHex(0xa21e89);
    assert(b.materials.every((entry, index) => entry.color?.getHex() === partnerColors[index]), 'tinting one player changed the partner');
    material.color.copy(color);
    assert(a.avatar.torch !== b.avatar.torch && a.avatar.map !== b.avatar.map, 'partners share animated hand props');
    return { ok: true, info: `${aMeshes.length}/${bMeshes.length} independently skinned meshes, ${bones.length} tested bones, private tints and hand props` };
  },

  playerAvatarViews(game) {
    const [a, b] = setup(game);
    let views = inspectViews(game);
    assert(views.length === 2 && views[0].camera === a.camera && views[1].camera === b.camera, 'split-screen uses the wrong player cameras');
    assert(!views[0].bodies[0] && views[0].bodies[1] && views[1].bodies[0] && !views[1].bodies[1], 'own live body or partner visibility is incorrect');
    assert(views[0].torches[0] && !views[0].torches[1] && !views[1].torches[0] && views[1].torches[1], 'first-person torch leaks into partner camera layers');
    game.killPlayer(a); advance(game, 0.35);
    views = inspectViews(game);
    assert(views[0].bodies[0] && views[1].bodies[0] && !a.viewModel.visible && b.viewModel.visible, 'corpse visibility or surviving partner torch is wrong');
    return { ok: true, info: 'actual render passes hide own live body, show partner/corpse, isolate camera torch layers' };
  },

  playerAvatarRecovery(game) {
    const [player] = setup(game);
    const point = safeWorkPoint(game), measured = [];
    for (const pitch of [-1.2, 1.0]) {
      // Die away from the lift so the real soul jar cannot automatically
      // deposit and revive its owner while the terminal fall is settling.
      player.pos.copy(point); player.vel.set(0, 0, 0); player.pitch = pitch;
      player.sync(); player.snapCamera(); advance(game, 0.1);
      const alivePose = pose(player.rig), rootPosition = player.rig.position.clone();
      const scales = new Map([player.body, player.rig, ...descendants(player.rig, node => node.isBone)].map(node => [node, node.scale.clone()]));
      game.killPlayer(player); advance(game, 1.15);
      assert(!player.alive && pose(player.rig) !== alivePose && !player.viewModel.visible, `death at pitch ${pitch} has no pose change or leaves the first-person torch visible`);
      const bounds = characterBounds(player);
      const bottom = bounds.min.y - player.pos.y, top = bounds.max.y - player.pos.y;
      assert(bottom >= -0.001 && bottom <= 0.025, `corpse at pitch ${pitch} does not rest on the floor: actual bottom=${bottom.toFixed(3)}m`);
      assert(top < 0.55, `corpse at pitch ${pitch} remains upright or curled above the floor: actual top=${top.toFixed(3)}m`);
      measured.push(`${pitch}: ${bottom.toFixed(3)}..${top.toFixed(3)}m`);
      game.respawn(player); advance(game, 0.25);
      assert(player.alive && player.viewModel.visible && !player.mapOpen && !player.hidingSpot, 'revival leaked dead/hidden/map state');
      for (const [node, scale] of scales) assert(node.scale.distanceTo(scale) < 0.001, `revival retained changed proportions on ${node.name || 'model root'}`);
      assert(player.rig.position.distanceTo(rootPosition) < 0.005, 'revival retained the corpse floor offset');
      assert(Math.abs(player.rig.rotation.x) < 0.08 && Math.abs(player.rig.rotation.z) < 0.08, 'revival retained the fallen root rotation');
      for (const node of descendants(player.rig, () => true)) assert([...node.position.toArray(), ...node.quaternion.toArray()].every(Number.isFinite), 'revival produced an invalid pose');
      assert(!game.jumpscares.get(player.index) && player.flash.intensity > 0, 'revival did not restore normal view/flashlight');
    }
    return { ok: true, info: `real terminal corpse bounds at initial look pitches ${measured.join('; ')}; revival restores root, proportions, view and torch` };
  },

  playerAvatarCover(game) {
    const [player, partner] = setup(game);
    const table = game.level.hidingSpots.find(spot => spot.kind === 'table');
    assert(table, 'floor has no table');
    partner.pos.copy(game.level.liftPos);
    player.pos.copy(table.entry); player.yaw = table.yaw + Math.PI; player.vel.set(0, 0, 0);
    const scales = new Map([player.body, player.rig, ...descendants(player.rig, node => node.isBone)].map(node => [node, node.scale.clone()]));
    tick(game, [{ hidePressed: true }]); advance(game, 1.2);
    assert(player.hidingSpot === table && player.isHidden && Math.abs(player.camera.position.y - table.eyeHeight) < 0.01, 'table cover did not lower/conceal the actual player camera');
    for (const [node, scale] of scales) assert(node.scale.distanceTo(scale) < 0.001, `table pose squashes ${node.name || 'model root'} instead of bending/positioning it`);
    const bounds = characterBounds(player);
    assert(bounds.max.y <= 1.04, `crouched character clips table underside: actual top=${bounds.max.y.toFixed(3)}m, underside=1.025m`);
    assert(bounds.min.y >= -0.05, `crouched character is buried below the floor: actual bottom=${bounds.min.y.toFixed(3)}m`);
    const views = inspectViews(game);
    assert(!views[0].bodies[0] && views[1].bodies[0], 'table cover hides the crouched partner from both cameras');
    tick(game, [{ hidePressed: true }]); advance(game, 0.35);
    assert(!player.hidingSpot && !table.occupant && player.eyeHeight > 1.3, 'standing up failed to restore the player or release the table');
    for (const [node, scale] of scales) assert(node.scale.distanceTo(scale) < 0.001, 'standing up retained compressed body proportions');
    return { ok: true, info: `table camera and partner render, unchanged scales, deformed mesh bounds ${bounds.min.y.toFixed(3)}..${bounds.max.y.toFixed(3)}m, clean exit; articulated crouch=${player.avatar.supportsCrouch}` };
  },

  playerAvatarAttachments(game) {
    const [player, partner] = setup(game);
    const point = safeWorkPoint(game); player.pos.copy(point); player.yaw = 0; player.vel.set(0, 0, 0);
    partner.pos.copy(game.level.liftPos);
    advance(game, 0.1);
    assert(player.avatar.torch && player.avatar.map && attachedTo(player.avatar.torch, player.body) && attachedTo(player.avatar.map, player.body), 'third-person props are not attached to this character hierarchy');
    assert(!player.avatar.map.visible, 'closed map remains visible in the partner body');
    const item = game.items.find(entry => !entry.heavy && !entry.type.soul);
    item.pos.copy(point); item.pos.z += 0.1; item.vel.set(0, 0, 0); item.sync();
    tick(game, [{ grabPressed: true }]); advance(game, 0.3);
    assert(player.holding === item && item.holders.includes(player) && item.group.parent === game.scene, 'carry state lost the actual held item');
    assert(!partner.holding && !partner.avatar.map.visible, 'carry/hand pose changed the other player');
    tick(game, [{ grabPressed: true }]);
    tick(game, [{ mapPressed: true }]); advance(game, 0.35);
    assert(player.mapOpen && player.avatar.map.visible && !partner.avatar.map.visible, 'map prop does not follow only its owner map state');
    assert(player.viewModel.position.y < -0.45, 'map leaves first-person torch raised over the paper');
    tick(game, [{ mapPressed: true, flashPressed: true }]); advance(game, 0.25);
    assert(!player.avatar.map.visible && !player.flashOn && player.flash.intensity === 0, 'closing map or switching off torch left stale attachment/light state');
    tick(game, [{ flashPressed: true }]);
    assert(player.flash.intensity > 0 && attachedTo(player.avatar.torch, player.body), 'switching torch back on lost its hand attachment');
    return { ok: true, info: 'per-player hand hierarchy, actual carry/drop, visible map state, camera torch lowering and light toggles' };
  },

  playerAvatarDisposal(game) {
    const players = setup(game);
    const importedGeometry = new Set(), importedTextures = new Set(), owned = new Set();
    for (const player of players) {
      const props = [resources(player.avatar.torch), resources(player.avatar.map)];
      const propGeometry = new Set(props.flatMap(set => [...set.geometries]));
      const propTextures = new Set(props.flatMap(set => [...set.textures]));
      const model = resources(player.rig);
      for (const geometry of model.geometries) if (!propGeometry.has(geometry)) importedGeometry.add(geometry);
      for (const map of model.textures) if (!propTextures.has(map)) importedTextures.add(map);
      for (const prop of props) for (const resource of [...prop.geometries, ...prop.materials, ...prop.textures]) owned.add(resource);
      for (const material of player.materials) owned.add(material);
    }
    assert(owned.size > 0 && importedGeometry.size > 0, 'resource ownership check has no real mesh/prop resources');
    const importedWatch = watch([...importedGeometry, ...importedTextures]), ownedWatch = watch(owned);
    try {
      game.startRun(2, { skipNotice: true });
      assert([...importedWatch.events.values()].every(count => count === 0), 'disposing a player damaged cached imported geometry/textures');
      assert([...ownedWatch.events.values()].every(count => count === 1), 'owned player materials or hand props leaked/double-disposed');
      assert(players.every(player => !player.group.parent && !player.camera.parent), 'old player hierarchy remains in the scene');
      assert(game.players.every(player => player.body.parent === player.group && descendants(player.rig, node => node.isMesh).length > 0), 'cached model cannot instantiate after disposal');
    } finally { importedWatch.stop(); ownedWatch.stop(); }
    return { ok: true, info: `${owned.size} owned resources disposed once; ${importedGeometry.size} cached geometries/${importedTextures.size} textures preserved and reused` };
  },

  playerAvatarHumanoidAdapter(game) {
    const [player] = setup(game);
    return exerciseHumanoidFixture(player);
  },
};

function humanoidFixture() {
  const object = new THREE.Group(), inner = new THREE.Group();
  object.name = 'axis-transformed-humanoid-fixture';
  object.rotation.y = 0.61; object.scale.setScalar(0.92);
  inner.rotation.x = -Math.PI / 2; object.add(inner);
  const bones = [];
  const bone = (name, parent, x, y, z) => {
    const node = new THREE.Bone(); node.name = `mixamorig:${name}`; node.position.set(x, y, z);
    parent.add(node); bones.push(node); return node;
  };
  // Import axis conversion is deliberately retained above the skeleton.
  const hips = bone('Hips', inner, 0, 0, 0.86); hips.rotation.x = Math.PI / 2;
  const spine = bone('Spine', hips, 0, 0.16, 0);
  const chest = bone('Spine2', spine, 0, 0.2, 0);
  const neck = bone('Neck', chest, 0, 0.2, 0);
  const head = bone('Head', neck, 0, 0.15, 0);
  bone('HeadTop_End', head, 0, 0.18, 0);
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    const upperArm = bone(`${side}Arm`, chest, sign * 0.17, 0.14, 0);
    const foreArm = bone(`${side}ForeArm`, upperArm, sign * 0.30, 0, 0);
    const hand = bone(`${side}Hand`, foreArm, sign * 0.27, 0, 0);
    bone(`${side}HandMiddle1`, hand, sign * 0.07, 0, 0);
    const thigh = bone(`${side}UpLeg`, hips, sign * 0.095, -0.08, 0);
    const shin = bone(`${side}Leg`, thigh, 0, -0.40, 0);
    const foot = bone(`${side}Foot`, shin, 0, -0.35, 0);
    bone(`${side}ToeBase`, foot, 0, -0.025, 0.13);
  }
  // Reorient individual local axes while preserving the complete world bind
  // pose. An Euler-only arm/leg adapter cannot pass this physical-pose check.
  for (const node of bones.filter(entry => /Arm$|ForeArm$|UpLeg$|Leg$/.test(entry.name))) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.37, -0.29, 0.48));
    const inverse = q.clone().invert(); node.quaternion.multiply(q);
    for (const child of node.children) {
      child.position.applyQuaternion(inverse); child.quaternion.premultiply(inverse);
    }
  }
  const geometry = new THREE.BoxGeometry(0.40, 1.70, 0.22);
  geometry.translate(0, 0.85, 0); geometry.rotateX(Math.PI / 2);
  const count = geometry.attributes.position.count;
  const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const map = new THREE.DataTexture(new Uint8Array([180, 175, 158, 255]), 1, 1); map.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ map });
  const mesh = new THREE.SkinnedMesh(geometry, material); inner.add(mesh);
  object.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones); mesh.bind(skeleton);
  return { object, inner, bones, geometry, material, map, skeleton };
}

function exerciseHumanoidFixture(realPlayer) {
  const fixture = humanoidFixture();
  const player = Object.create(realPlayer);
  Object.assign(player, { group: new THREE.Group(), body: new THREE.Group(), pos: new THREE.Vector3(), vel: new THREE.Vector3(), rig: fixture.object, speed: 0, alive: true, mapOpen: false,
    holding: null, hidingSpot: null, flashOn: true, lightOn: true, pitch: 0, yaw: 0, deathTime: 0 });
  player.group.add(player.body);
  player.body.add(fixture.object);
  const avatar = new PlayerAvatar(player, { object: fixture.object, inner: fixture.inner, animations: [], custom: true });
  const bindScales = new Map(fixture.bones.map(node => [node, node.scale.clone()]));
  const rootPosition = fixture.object.position.clone(), rootQuaternion = fixture.object.quaternion.clone(), rootScale = fixture.object.scale.clone();
  const importedWatch = watch([fixture.geometry, fixture.material, fixture.map]);
  let detail;
  try {
    assert(avatar.supportsHumanoid && avatar.supportsCrouch, `Mixamo humanoid not recognized: ${JSON.stringify(avatar.diagnostics)}`);
    const joints = avatar.joints;
    assert(joints.leftUpperArm?.isBone && joints.rightFoot?.isBone && joints.hips?.isBone, 'semantic joints did not map to real bones');
    for (let i = 0; i < 30; i++) avatar.update(DT);
    player.body.updateMatrixWorld(true);
    const leftShoulder = joints.leftUpperArm.getWorldPosition(new THREE.Vector3());
    const leftHand = joints.leftHand.getWorldPosition(new THREE.Vector3());
    assert(leftHand.y < leftShoulder.y - 0.10, 'idle left arm remains in T-pose under transformed import axes');
    assert(attachedTo(avatar.torch, joints.rightHand) && attachedTo(avatar.map, joints.leftHand), 'hand props are not bound to semantic hand joints');
    const standingHead = joints.head.getWorldPosition(new THREE.Vector3()).y;
    const limbLengths = [[joints.leftUpperArm, joints.leftForeArm], [joints.leftForeArm, joints.leftHand], [joints.leftUpperLeg, joints.leftLowerLeg]]
      .map(([a, b]) => [a, b, a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3()))]);
    // Exercise actual locomotion, not a UI speed scalar or idle breathing.
    // Measure each ankle along world-space velocity relative to the actor's
    // origin, so arbitrary imported yaw and root motion cannot fake a stride.
    player.speed = 3.1; player.vel.set(0, 0, 3.1);
    const direction = player.vel.clone().normalize(), origin = new THREE.Vector3();
    const footProjection = (foot) => foot.getWorldPosition(new THREE.Vector3())
      .sub(player.group.getWorldPosition(origin)).dot(direction);
    const restLeft = footProjection(joints.leftFoot), restRight = footProjection(joints.rightFoot);
    const strides = [];
    for (let i = 0; i < 32; i++) {
      avatar.update(DT); player.group.updateMatrixWorld(true);
      strides.push([footProjection(joints.leftFoot) - restLeft, footProjection(joints.rightFoot) - restRight]);
    }
    const ranges = [0, 1].map(side => {
      const values = strides.map(pair => pair[side]);
      return Math.max(...values) - Math.min(...values);
    });
    assert(ranges.every(range => range > 0.12), `walking ankles have no physical stride: ranges=${ranges.map(value => value.toFixed(3)).join('/')}m`);
    assert(strides.some(([left, right]) => left * right < -0.002), 'walking feet do not alternate forward/back relative to the actor');
    player.speed = 0; player.vel.set(0, 0, 0); player.hidingSpot = { kind: 'table' }; player.eyeHeight = 0.55;
    for (let i = 0; i < 50; i++) avatar.update(DT);
    player.body.updateMatrixWorld(true);
    const crouchedHead = joints.head.getWorldPosition(new THREE.Vector3()).y;
    assert(crouchedHead < standingHead - 0.3, 'humanoid did not lower into a bent table pose');
    for (const [node, scale] of bindScales) assert(node.scale.distanceTo(scale) < 0.001, `adapter squashes bone ${node.name}`);
    assert(fixture.object.scale.distanceTo(rootScale) < 0.001, 'adapter squashes imported root');
    for (const [a, b, length] of limbLengths) assert(Math.abs(a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3())) - length) < 0.002, 'crouch changes anatomical limb length');
    player.hidingSpot = null; player.alive = false;
    for (let i = 0; i < 50; i++) avatar.update(DT);
    player.alive = true; avatar.reset();
    assert(fixture.object.position.distanceTo(rootPosition) < 0.001 && fixture.object.quaternion.angleTo(rootQuaternion) < 0.001 && fixture.object.scale.distanceTo(rootScale) < 0.001, 'reset discarded import transform or retained death transform');
    avatar.dispose();
    assert([...importedWatch.events.values()].every(count => count === 0), 'adapter disposed borrowed mesh/material/texture');
    detail = 'real Mixamo Skeleton: rotated import/local axes, lowered T-pose arm, hand props, gait, bent crouch, rigid limb lengths, death/reset, borrowed-resource safety';
  } finally {
    importedWatch.stop();
    // dispose must be harmless after a previous explicit disposal or failure.
    avatar.dispose();
    fixture.geometry.dispose(); fixture.material.dispose(); fixture.map.dispose(); fixture.skeleton.dispose();
  }
  return { ok: true, info: detail };
}
