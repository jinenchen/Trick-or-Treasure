// Imported-spider regressions. These inspect live skinned vertices and real
// encounter/render lifecycle; web escape rules are covered by encounter-tests.
import * as THREE from 'three';
import { WALL_H } from './config.js';
import { hasModel } from './assets.js';
import { makeRng } from './rng.js';
import { Spider } from './entities/facility-creatures.js';

const DT = 1 / 60;
const STILL = { forward: 0, strafe: 0, turn: 0, mouseTurn: 0, mouseLook: 0, look: 0, sprint: false,
  grabPressed: false, flashPressed: false, hidePressed: false, mapPressed: false, stunPressed: false, lurePressed: false };
function assert(condition, message) { if (!condition) throw new Error(message); }
function nodes(root, predicate) {
  const result = [];
  root.traverse(node => { if (predicate(node)) result.push(node); });
  return result;
}

function setup(game) {
  assert(hasModel('wall-spider'), 'supplied spider.glb did not load; imported-spider checks require the actual asset');
  game.startRun(2, { skipNotice: true });
  const random = Math.random;
  Math.random = makeRng(417261).next;
  try { game.startFloor(1); }
  finally { Math.random = random; }
  game.jumpscares.dispose();
  for (const monster of game.monsters) monster.dispose();
  game.monsters = [];
  for (const trap of game.encounters.traps) game.encounters.disarm(trap, game.players[0]);
  for (const player of game.players) {
    player.flashOn = player.lightOn = false;
    player.tools.stun = player.tools.lure = 0;
  }
  game.noises = [];
  const location = clearLocation(game);
  const spider = new Spider(game);
  spider.place(location.point); game.monsters.push(spider);
  assert(spider.custom && nodes(spider.model, node => node.isSkinnedMesh).length > 0, 'Spider uses a fallback or unskinned substitute instead of the supplied mesh');
  return { spider, ...location, players: game.players };
}

function clearLocation(game) {
  for (const [x, y] of game.level.floorCells) {
    const point = game.level.cellCenter(x, y);
    if (!game.level.roomAt(point.x, point.z)?.index || game.level.occupied.has(y * game.level.W + x)) continue;
    for (const [dx, dz] of [[1.35, 0], [-1.35, 0], [0, 1.35], [0, -1.35]]) {
      const nearby = point.clone().add(new THREE.Vector3(dx, 0, dz));
      const clear = [point, nearby].every(position => {
        const corrected = position.clone(); game.level.collideCircle(corrected, 0.48);
        return corrected.distanceTo(position) < 0.001 && !game.level.inLift(position.x, position.z)
          && game.encounters.chests.every(chest => chest.pos.distanceTo(position) > 2.1);
      });
      if (clear && game.level.lineOfSight(point.x, point.z, nearby.x, nearby.z)) return { point, nearby };
    }
  }
  throw new Error('No clear real ceiling/capture location outside the lift');
}

function stand(player, position, target) {
  player.pos.copy(position); player.vel.set(0, 0, 0);
  if (target) player.yaw = Math.atan2(target.x - position.x, target.z - position.z);
  player.sync(); player.snapCamera();
}
function tick(game, intents = []) {
  game.testIntents = game.players.map((_, index) => ({ ...STILL, ...intents[index] }));
  try { game.step(DT); }
  finally { game.testIntents = null; }
}
function advance(game, seconds) { for (let i = 0; i < Math.ceil(seconds / DT); i++) tick(game); }

function updateMatrices(root) {
  root.updateWorldMatrix(true, true);
  // Refresh attached SkinnedMesh bind inverses as well as ordinary matrices.
  root.updateMatrixWorld(true);
}
function vertexSamples(root) {
  updateMatrices(root);
  const inverse = root.matrixWorld.clone().invert(), samples = [], point = new THREE.Vector3();
  for (const mesh of nodes(root, node => node.isSkinnedMesh)) {
    const count = mesh.geometry.attributes.position.count, stride = Math.max(1, Math.ceil(count / 256));
    for (let index = 0; index < count; index += stride) {
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
      assert(point.toArray().every(Number.isFinite), 'spider skinning produced a non-finite vertex');
      samples.push(point.clone());
    }
  }
  assert(samples.length > 12, 'too few actual skinned vertices to test articulation');
  return samples;
}
function boundsOf(root) {
  updateMatrices(root);
  const bounds = new THREE.Box3(), point = new THREE.Vector3();
  for (const mesh of nodes(root, node => node.isMesh)) {
    const count = mesh.geometry.attributes.position?.count || 0;
    for (let index = 0; index < count; index++) {
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
      bounds.expandByPoint(point);
    }
  }
  assert(!bounds.isEmpty() && [...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite), 'spider has invalid deformed bounds');
  return bounds;
}
function toeClearances(spider) {
  updateMatrices(spider.model);
  const feet = new Map(spider.anim.legs.map(leg => [leg.foot, `${leg.side}${leg.index}`]));
  const heights = new Map(), point = new THREE.Vector3();
  const components = ['getX', 'getY', 'getZ', 'getW'];
  for (const mesh of nodes(spider.model, node => node.isSkinnedMesh)) {
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    for (let index = 0; index < position.count; index++) {
      const labels = [];
      for (const component of components) {
        if (skinWeight[component](index) < 0.25) continue;
        const label = feet.get(mesh.skeleton.bones[skinIndex[component](index)]);
        if (label) labels.push(label);
      }
      if (!labels.length) continue;
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
      for (const label of labels) heights.set(label, Math.max(heights.get(label) ?? -Infinity, point.y));
    }
  }
  assert(heights.size === 8, `only ${heights.size} legs have actual skinned toe geometry`);
  const gaps = [...heights.values()].map(height => WALL_H - height);
  assert(gaps.every(gap => gap >= -0.035), 'a deformed spider toe penetrates the ceiling');
  assert(gaps.filter(gap => gap <= 0.16).length >= 4, 'fewer than four actual skinned feet reach the ceiling support plane');
  return gaps;
}
function bonePose(root) { return new Map(nodes(root, node => node.isBone).map(node => [node, node.quaternion.clone()])); }
function changedBones(before, threshold = 0.008) {
  // Authored float32 keys can be slightly non-unit; angleTo assumes normalized
  // input and otherwise reports a nonzero angle even against an identical copy.
  return [...before].filter(([node, quaternion]) => node.quaternion.clone().normalize().angleTo(quaternion.clone().normalize()) > threshold).map(([node]) => node);
}
function mutatedBones(before) {
  // Isolation runs no world/partner animation updates, so compare the actual
  // stored components directly. Equal float32 quaternions must report zero.
  return [...before].filter(([node, quaternion]) => ['x', 'y', 'z', 'w'].some(component => Math.abs(node.quaternion[component] - quaternion[component]) > 1e-8)).map(([node]) => node.name || node.uuid);
}
function movedVertices(before, after, threshold = 0.003) {
  assert(before.length === after.length, 'animation changed the supplied mesh topology');
  return before.filter((point, index) => point.distanceTo(after[index]) > threshold).length;
}
function skeletons(root) { return new Set(nodes(root, node => node.isSkinnedMesh).map(mesh => mesh.skeleton)); }
function assertIndependent(roots) {
  for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) {
    const bones = new Set(nodes(roots[i], node => node.isBone)), skins = skeletons(roots[i]);
    assert(nodes(roots[j], node => node.isBone).every(node => !bones.has(node)), 'world/attack spider clones share live bones');
    assert([...skeletons(roots[j])].every(skeleton => !skins.has(skeleton)), 'world/attack spider clones share a Skeleton');
    const geometries = new Set(nodes(roots[i], node => node.isMesh).map(mesh => mesh.geometry));
    assert(nodes(roots[j], node => node.isMesh).every(mesh => geometries.has(mesh.geometry)), 'attack spider substitutes different geometry for the supplied world model');
  }
}
function resources(root) {
  const result = new Set();
  root.traverse(node => {
    if (node.geometry) result.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!material) continue;
      result.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) result.add(value);
    }
  });
  return result;
}
function watch(resourceSet) {
  const counts = new Map(), listeners = new Map();
  for (const resource of resourceSet) {
    counts.set(resource, 0);
    const listener = () => counts.set(resource, counts.get(resource) + 1);
    listeners.set(resource, listener); resource.addEventListener('dispose', listener);
  }
  return { counts, stop() { for (const [resource, listener] of listeners) resource.removeEventListener('dispose', listener); } };
}

export const SPIDER_AVATAR_TESTS = {
  spiderAvatarArticulation(game) {
    const { spider } = setup(game);
    assert(['idle', 'walk', 'attack'].every(name => spider.anim.has(name)), 'imported spider lacks playable idle/walk/attack clips');
    assert(spider.anim.legs.length === 8, 'supplied eight-leg rig was not recognized by its animation adapter');
    spider.anim.reset(); spider.anim.play('walk', { fade: 0, timeScale: 1 }); spider.anim.update(0);
    const before = vertexSamples(spider.model), bones = bonePose(spider.model);
    const movingBones = new Set(); let moved = 0;
    for (let frame = 0; frame < 48; frame++) {
      spider.anim.update(DT);
      if (frame % 6 !== 0) continue;
      for (const bone of changedBones(bones)) movingBones.add(bone);
      moved = Math.max(moved, movedVertices(before, vertexSamples(spider.model)));
    }
    const movingLegs = spider.anim.legs.filter(leg => [leg.upper, leg.mid, leg.foot].some(bone => movingBones.has(bone)));
    assert(movingLegs.length === 8, `walk articulates only ${movingLegs.length}/8 actual leg chains`);
    assert(moved >= Math.min(12, before.length * 0.1), `walk moves only ${moved}/${before.length} actual skinned samples`);
    spider.anim.reset(); spider.anim.play('idle', { fade: 0 }); spider.anim.update(0);
    const resetPose = vertexSamples(spider.model);
    spider.anim.play('attack', { fade: 0, once: true });
    for (let frame = 0; frame < 24; frame++) spider.anim.update(DT);
    assert(movedVertices(resetPose, vertexSamples(spider.model)) >= 4, 'attack clip plays without deforming the imported mesh');
    spider.anim.reset(); spider.anim.play('idle', { fade: 0 }); spider.anim.update(0);
    assert(movedVertices(resetPose, vertexSamples(spider.model), 0.0001) === 0, 'reset retains a limb pose from the previous attack');
    return { ok: true, info: `walk articulates all eight legs (${movingBones.size} joints/${moved} sampled vertices); attack deforms the supplied mesh and reset restores idle` };
  },

  spiderAvatarCeiling(game) {
    const { spider, point, nearby, players: [player, partner] } = setup(game);
    const perch = game.spiderPerch(spider);
    assert(perch && !game.level.inLift(perch.x, perch.z), 'spawn selector found no usable imported-spider wall perch');
    spider.place(perch);
    let spawnBounds;
    for (const elapsed of [0, 0.4]) {
      advance(game, elapsed);
      spawnBounds = boundsOf(spider.model);
      for (const x of [spawnBounds.min.x, spawnBounds.max.x]) for (const z of [spawnBounds.min.z, spawnBounds.max.z]) {
        assert(!game.level.isWallAt(x, z), `spawned imported spider clips a wall at footprint corner (${x.toFixed(3)}, ${z.toFixed(3)}) after ${elapsed}s of idle`);
      }
    }
    const spawnWidth = spawnBounds.max.x - spawnBounds.min.x;
    spider.place(point);
    advance(game, 0.4);
    const orientation = spider.model.quaternion.clone(), rest = boundsOf(spider.model);
    const gap = WALL_H - rest.max.y;
    assert(gap >= -0.035 && gap <= 0.16, `perched spider does not touch the ceiling: actual support gap=${gap.toFixed(3)}m`);
    assert(rest.min.y > WALL_H - 1.05 && rest.max.y - rest.min.y > 0.2, 'ceiling spider is embedded above the ceiling or hanging at floor height');
    const toeGaps = toeClearances(spider);
    stand(player, point); stand(partner, nearby, point); tick(game); advance(game, 0.45);
    assert(player.webbedBy === spider && spider.web.visible, 'actual capture did not start the imported spider feeding pose');
    const feeding = boundsOf(spider.model);
    assert(feeding.max.y <= WALL_H + 0.05 && feeding.min.y > WALL_H - 1.2, 'feeding pose flips/clips the imported spider through the ceiling');
    tick(game, [{}, { grabPressed: true }]); advance(game, 0.8);
    assert(!player.webbedBy && !spider.victim && !spider.web.visible && player.alive, 'release did not clear the captured player and silk');
    const released = boundsOf(spider.model), releaseGap = WALL_H - released.max.y;
    assert(releaseGap >= -0.035 && releaseGap <= 0.16, `release leaves spider floating away from ceiling: support gap=${releaseGap.toFixed(3)}m`);
    toeClearances(spider);
    assert(spider.model.quaternion.angleTo(orientation) < 0.001, 'capture/release accumulates a second ceiling inversion');
    return { ok: true, info: `actual ${spawnWidth.toFixed(3)}m-wide spawned mesh clears wall corners; eight skinned toe gaps ${Math.min(...toeGaps).toFixed(3)}..${Math.max(...toeGaps).toFixed(3)}m; feeding bounds ${feeding.min.y.toFixed(3)}..${feeding.max.y.toFixed(3)}m; released gap ${releaseGap.toFixed(3)}m` };
  },

  spiderAvatarAttackIsolation(game) {
    const { spider, point, nearby, players: [player, partner] } = setup(game);
    game.jumpscares.prepare([spider], game.players);
    const partnerStage = game.jumpscares.stages.get(game.jumpscares.key(partner, spider));
    stand(player, point); stand(partner, nearby, point); tick(game);
    assert(spider.victim === player && player.alive, 'spider failed to begin its real web countdown');
    advance(game, 9.05);
    const attack = game.jumpscares.get(player.index);
    assert(!player.alive && attack?.monster === spider && attack.kind === 'wall-spider', 'web timeout did not select the matching imported spider attack');
    assert(partner.alive && !game.jumpscares.get(partner.index) && !player.webbedBy && !spider.web.visible, 'fatal capture leaked silk or interrupted the partner');
    assertIndependent([spider.model, attack.actor, partnerStage.actor]);
    const worldBones = bonePose(spider.model), partnerBones = bonePose(partnerStage.actor);
    const before = vertexSamples(attack.actor), attackBones = bonePose(attack.actor);
    const movingBones = new Set(); let moved = 0;
    for (let frame = 0; frame < 30; frame++) {
      game.jumpscares.update(DT);
      for (const bone of changedBones(attackBones)) movingBones.add(bone);
      if (frame % 6 === 0) moved = Math.max(moved, movedVertices(before, vertexSamples(attack.actor)));
    }
    assert(movingBones.size >= 2 && moved >= 4, 'attack camera moves but the supplied spider skeleton remains frozen');
    const worldChanges = mutatedBones(worldBones), partnerChanges = mutatedBones(partnerBones);
    assert(!worldChanges.length && !partnerChanges.length, `victim attack changed other skeletons: world=[${worldChanges.join(', ')}], partner=[${partnerChanges.join(', ')}]`);
    game.respawn(player);
    assert(player.alive && !game.jumpscares.get(player.index), 'revival retained the spider attack camera');
    return { ok: true, info: `real nine-second web timeout, matching mesh in three independent skeletons, ${movingBones.size} attack joints/${moved} deformed samples, isolated partner and revival` };
  },

  spiderAvatarLifecycle(game) {
    const { spider, point, nearby, players: [player, partner] } = setup(game);
    game.jumpscares.prepare([spider], game.players);
    const stages = game.players.map(p => game.jumpscares.stages.get(game.jumpscares.key(p, spider)));
    const roots = [spider.model, ...stages.map(stage => stage.actor)];
    assertIndependent(roots);
    const cached = new Set(roots.flatMap(root => [...resources(root)])), owned = new Set([spider.web.geometry, spider.web.material]);
    for (const root of roots) for (const skeleton of skeletons(root)) {
      if (!skeleton.boneTexture) skeleton.computeBoneTexture();
      owned.add(skeleton.boneTexture);
    }
    const cachedWatch = watch(cached), ownedWatch = watch(owned);
    try {
      stand(player, point); stand(partner, nearby, point); tick(game);
      assert(player.webbedBy === spider, 'stun lifecycle has no real captured victim');
      player.tools.stun = 1; tick(game, [{ stunPressed: true }]); advance(game, 0.25);
      assert(player.alive && !player.webbedBy && !spider.victim && !spider.web.visible && spider.isStunned && player.tools.stun === 0, 'actual R stun did not interrupt imported capture and release its victim');
      const stunned = boundsOf(spider.model);
      assert(stunned.max.y <= WALL_H + 0.05 && stunned.min.y > WALL_H - 1.2, 'stun resets the ceiling spider onto the ground or through the ceiling');
      stand(player, game.level.liftPos); advance(game, 5.2);
      assert(!spider.isStunned && !spider.victim && spider.anim.has('idle'), 'spider did not recover its usable animation after stun');
      const skinCount = owned.size - 2;
      game.startFloor(2);
      assert(!spider.group.parent && !spider.web.parent && game.players.every(p => !p.webbedBy), 'floor reset retains old spider, silk or capture ownership');
      assert([...cachedWatch.counts.values()].every(count => count === 0), 'spider disposal destroyed shared imported geometry/materials/textures');
      assert([...ownedWatch.counts.values()].every(count => count === 1), 'spider clone skeleton textures or silk leaked/double-disposed');
      for (const animator of [spider.anim, ...stages.map(stage => stage.animator)]) {
        assert([...animator.actions.values()].every(action => !action.isRunning()), 'disposed spider animation mixer still runs its imported clips');
      }
      const next = new Spider(game); next.place(game.level.liftPos); game.monsters.push(next);
      assert(next.custom && nodes(next.model, node => node.isSkinnedMesh).every(mesh => cached.has(mesh.geometry)), 'shared spider asset cannot instantiate after floor cleanup');
      next.anim.play('walk', { fade: 0 }); next.anim.update(0.2); vertexSamples(next.model);
      return { ok: true, info: `captured R stun and recovery; floor reset disposes ${skinCount} independent skin textures plus silk once, preserves ${cached.size} cached resources and reuses the exact mesh` };
    } finally { cachedWatch.stop(); ownedWatch.stop(); }
  },
};
