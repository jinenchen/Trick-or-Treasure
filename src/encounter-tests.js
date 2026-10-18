// Browser integration checks using the real floor, players, loot and AI. Run
// through debug.js so E/R/G use the same input path as the playable game.
import * as THREE from 'three';
import { CELL } from './config.js';
import { makeRng } from './rng.js';
import { Spider, Lizard, ThiefBug, Mimic } from './entities/facility-creatures.js';
import { Zombie } from './entities/zombie.js';

const DT = 1 / 60;
const STILL = { forward: 0, strafe: 0, turn: 0, mouseTurn: 0, mouseLook: 0, look: 0, sprint: false,
  grabPressed: false, flashPressed: false, hidePressed: false, mapPressed: false, stunPressed: false, lurePressed: false };
function assert(condition, message) { if (!condition) throw new Error(message); }

function setup(game, players = 1, { armedTraps = false } = {}) {
  game.startRun(players, { skipNotice: true });
  // Seed only synchronous floor startup, after audio initialization. A supplied
  // ?seed= still takes precedence, making failed layouts easy to reproduce.
  const originalRandom = Math.random;
  Math.random = makeRng(417261).next;
  try { game.startFloor(1); }
  finally { Math.random = originalRandom; }
  // Remove unrelated specimens instead of mocking the actor under test.
  for (const monster of game.monsters) monster.dispose();
  game.monsters = [];
  game.jumpscares.clear();
  for (const player of game.players) {
    player.flashOn = player.lightOn = false;
    player.tools.stun = player.tools.lure = 0;
  }
  if (!armedTraps) for (const trap of game.encounters.traps) game.encounters.disarm(trap, game.players[0]);
  game.noises = [];
  return game.players;
}

function tick(game, intents = []) {
  game.testIntents = game.players.map((_, index) => ({ ...STILL, ...intents[index] }));
  try { game.step(DT); }
  finally { game.testIntents = null; }
}

function advance(game, seconds, intents = []) {
  for (let frame = 0; frame < Math.ceil(seconds / DT); frame++) tick(game, intents);
}

function stand(player, position, target = null) {
  player.pos.copy(position); player.vel.set(0, 0, 0);
  if (target) player.yaw = Math.atan2(target.x - player.pos.x, target.z - player.pos.z);
  player.sync(); player.snapCamera();
}

function approach(game, player, target, distance = 1.4) {
  const yaw = target.yaw || 0;
  for (let i = 0; i < 16; i++) {
    const angle = yaw + i * Math.PI / 8;
    const position = target.pos.clone().add(new THREE.Vector3(Math.sin(angle) * distance, 0, Math.cos(angle) * distance));
    const corrected = position.clone();
    game.level.collideCircle(corrected, 0.35);
    if (corrected.distanceTo(position) > 0.01 || !game.level.lineOfSight(position.x, position.z, target.pos.x, target.pos.z)) continue;
    stand(player, position, target.pos);
    return;
  }
  throw new Error(`No navigable approach to ${target.kind || target.constructor.name}`);
}

function arena(game) {
  const rooms = game.level.rooms.filter(room => room.index).sort((a, b) => b.w * b.h - a.w * a.h);
  for (const room of rooms) for (const axis of ['x', 'z']) {
    const middle = new THREE.Vector3((room.x + room.w / 2) * CELL, 0, (room.y + room.h / 2) * CELL);
    const a = middle.clone(), b = middle.clone(); a[axis] -= 1.7; b[axis] += 1.7;
    const valid = [a, b].every(position => {
      const corrected = position.clone(); game.level.collideCircle(corrected, 0.48);
      return corrected.distanceTo(position) < 0.01 && !game.level.inLift(position.x, position.z)
        && game.encounters.chests.every(chest => chest.pos.distanceTo(position) > 2.1);
    });
    if (valid && game.level.lineOfSight(a.x, a.z, b.x, b.z)) return { a, b, middle };
  }
  throw new Error('No clear real room for encounter checks');
}

function addCreature(game, Species, position) {
  const creature = new Species(game);
  creature.place(position); game.monsters.push(creature);
  return creature;
}

function aim(player, creature) {
  player.yaw = Math.atan2(creature.pos.x - player.pos.x, creature.pos.z - player.pos.z);
  const height = creature instanceof Spider ? 2.65 : Math.max(0.35, creature.height * 0.65);
  player.pitch = Math.atan2(height - player.eyeHeight, Math.hypot(creature.pos.x - player.pos.x, creature.pos.z - player.pos.z));
}

function signature(game) {
  return JSON.stringify([...game.encounters.chests, ...game.encounters.traps].map(object => [object.kind, object.pos.toArray(), object.yaw]));
}

export const ENCOUNTER_TESTS = {
  encounterPlacement(game) {
    setup(game, 2);
    assert(game.encounters.chests.length === 4 && game.encounters.traps.length === 3, 'missing chests or trap types');
    const level = game.level;
    for (const object of [...game.encounters.chests, ...game.encounters.traps]) {
      const [x, y] = level.worldToCell(object.pos.x, object.pos.z);
      const room = level.roomAt(object.pos.x, object.pos.z);
      assert(room?.index > 0 && level.occupied.has(y * level.W + x), 'encounter is in lift or its spawn cell is unreserved');
      assert(level.liftField[y * level.W + x] >= 0, 'encounter cannot be reached from lift');
      for (const spot of level.hidingSpots) assert(object.pos.distanceTo(spot.entry) > 1.5, 'encounter blocks a hideout approach');
    }
    for (const chest of game.encounters.chests) {
      const cell = level.worldToCell(chest.pos.x, chest.pos.z), center = level.cellCenter(...cell), checked = center.clone();
      level.collideCircle(checked, 0.35);
      assert(checked.distanceTo(center) < 0.01, 'chest blocks a navigation cell center');
    }
    const before = signature(game), old = game.encounters, oldGroup = old.group;
    setup(game, 2);
    assert(signature(game) === before, 'same seeded real floor produced different encounters');
    assert(old.disposed && !oldGroup.parent && old.colliders.size === 0 && old.reserved.size === 0, 'floor reset leaked encounter objects or collision');
    return { ok: true, info: 'four reachable chests, three traps, reserved cells, clear cover/routes, reproducible floor and cleanup' };
  },

  encounterChestRewards(game) {
    const [player] = setup(game);
    const supply = game.encounters.chests.find(chest => chest.kind === 'supply');
    approach(game, player, supply);
    assert(game.interactionCandidate(player)?.target === supply, 'E prompt does not select real supply chest');
    tick(game, [{ grabPressed: true }]);
    assert(supply.opened && player.tools.stun === 1 && player.tools.lure === 1, 'supply did not grant both gadgets');
    tick(game, [{ grabPressed: true }]);
    assert(player.tools.stun === 1 && player.tools.lure === 1, 'supply reward can be duplicated');
    if (player.holding) game.release(player);
    advance(game, 0.8);
    assert(supply.lid.rotation.x < -1 && !supply.contents.visible, 'opened chest lid/content did not animate');

    const valuable = game.encounters.chests.find(chest => chest.kind === 'valuable');
    const existing = new Set(game.items);
    approach(game, player, valuable);
    tick(game, [{ grabPressed: true }]);
    const added = game.items.filter(item => !existing.has(item));
    assert(valuable.opened && added.length === 1 && added[0].value > 0 && !added[0].gone, 'valuable chest did not spawn one usable Item');
    assert(game.items.filter(item => item === added[0]).length === 1 && added[0].group.parent === game.scene, 'reward is missing from real scene or duplicated');
    tick(game, [{ grabPressed: true }]);
    assert(game.items.filter(item => !existing.has(item)).length === 1, 'opened valuable chest generated another reward');
    return { ok: true, info: 'actual E prompt, both tools, one-use rewards, animated lid, real valuable Item' };
  },

  encounterMimic(game) {
    const [player] = setup(game);
    const chest = game.encounters.chests.find(candidate => candidate.kind === 'mimic');
    approach(game, player, chest);
    assert(game.interactionCandidate(player)?.label === 'open sealed chest', 'dormant mimic is exposed by its interaction prompt');
    const count = game.monsters.length;
    tick(game, [{ grabPressed: true }]);
    const mimic = game.monsters.find(monster => monster instanceof Mimic);
    assert(mimic && game.monsters.length === count + 1 && !chest.group.visible && !chest.collider, 'mimic did not replace the dormant chest exactly once');
    // Standing in reach throughout unfolding must remain harmless.
    stand(player, mimic.pos.clone().add(new THREE.Vector3(Math.sin(chest.yaw) * 0.6, 0, Math.cos(chest.yaw) * 0.6)), mimic.pos);
    for (let i = 0; i < 40; i++) {
      tick(game);
      assert(player.alive && !mimic.tryCatch(), 'mimic caught a player during its awakening warning');
    }
    assert(mimic.awakening > 0 && mimic.awakening < 1, 'mimic has no unfolding interval');
    stand(player, game.level.liftPos);
    advance(game, 0.4);
    assert(mimic.state === 'hunt' && mimic.awakening === 1 && player.alive, 'mimic failed to become active after the safe interval');
    game.encounters.openChest(chest, player);
    assert(game.monsters.filter(monster => monster instanceof Mimic).length === 1, 'opening spent mimic spawned duplicates');
    return { ok: true, info: 'identical sealed prompt, real creature replacement, harmless unfolding, hunting transition, once only' };
  },

  encounterTraps(game) {
    const [player] = setup(game, 1, { armedTraps: true });
    const spike = game.encounters.traps.find(trap => trap.kind === 'spikes');
    approach(game, player, spike, 1.35);
    assert(player.pos.distanceTo(spike.pos) > spike.radius && game.interactionCandidate(player)?.target === spike, 'spike cannot be disarmed from outside its trigger area');
    tick(game, [{ grabPressed: true }]);
    stand(player, spike.pos); advance(game, 0.8);
    assert(spike.disarmed && spike.state === 'disarmed' && player.staggerTime === 0 && player.alive, 'disarmed spikes fired');

    const arrow = game.encounters.traps.find(trap => trap.kind === 'arrow');
    stand(player, arrow.pos); tick(game);
    assert(arrow.state === 'primed' && player.staggerTime === 0, 'pressure plate did not telegraph');
    advance(game, 0.25);
    assert(player.staggerTime === 0, 'arrow trap hit before its warning finished');
    approach(game, player, arrow, 1.6); advance(game, 0.4);
    assert(player.alive && player.staggerTime === 0, 'stepping off the plate did not avoid damage');
    assert(arrow.bolts.some(bolt => bolt.visible), 'arrow trap has no visible projectile phase');
    advance(game, 3.7);
    assert(arrow.state === 'armed', 'arrow mechanism did not reset');

    const snare = game.encounters.traps.find(trap => trap.kind === 'snare');
    const item = game.items.find(candidate => !candidate.heavy && !candidate.type.soul);
    // Pick up in the clear lift area before staging the walk onto the plate;
    // trying E on an armed plate would correctly prioritize disarming it.
    stand(player, game.level.liftPos); player.yaw = 0;
    item.pos.copy(player.pos); item.pos.z += 0.1; item.vel.set(0, 0, 0); item.sync();
    game.toggleGrab(player);
    assert(player.holding === item, 'could not pick up trap-test valuable');
    stand(player, snare.pos); item.pos.copy(item.holdTarget(new THREE.Vector3())); item.vel.set(0, 0, 0); item.sync();
    const hp = item.hp;
    advance(game, 0.65);
    assert(player.alive && player.staggerTime > 0 && player.trapGrace > 0, 'trap did not leave a recoverable nonfatal stumble');
    assert(!player.holding && item.hp < hp && !item.gone, 'snare did not drop and damage the carried item');
    assert(snare.jaws.some(jaw => Math.abs(jaw.mesh.rotation.x) > 0.5), 'jaw trap did not visibly close');
    const health = item.hp, stamina = player.stamina;
    game.encounters.hit(player, snare);
    assert(item.hp === health && player.stamina === stamina, 'trap immunity allowed a stacked hit');
    const hunter = addCreature(game, Zombie, player.pos);
    assert(!hunter.tryCatch() && player.alive, 'trap grace permits an immediate creature kill');
    return { ok: true, info: 'safe E disarm, telegraph and escape, bolt/reset animation, jaw impact, loot drop/damage, stun and catch immunity' };
  },

  encounterGadgets(game) {
    const [player] = setup(game), { a, b } = arena(game);
    stand(player, a, b); player.tools.stun = 1;
    tick(game, [{ stunPressed: true }]);
    assert(player.tools.stun === 1, 'a stun miss consumed ammunition');
    const hunter = addCreature(game, Zombie, b);
    aim(player, hunter); tick(game, [{ stunPressed: true }]);
    assert(player.tools.stun === 0 && hunter.isStunned, 'R did not spend one charge and stun the aimed creature');
    const frozen = hunter.pos.clone();
    advance(game, 0.7);
    assert(hunter.pos.distanceTo(frozen) < 0.001 && !hunter.tryCatch(), 'stunned creature can move or attack');
    tick(game, [{ stunPressed: true }]);
    assert(player.tools.stun === 0, 'empty stun ammunition became negative');

    const lizard = addCreature(game, Lizard, b.clone().add(new THREE.Vector3(0, 0, 1)));
    stand(player, a, b); player.pitch = 0; player.tools.lure = 1;
    tick(game, [{ lurePressed: true }]);
    assert(player.tools.lure === 0 && game.gadgets.decoys.length === 1, 'G did not throw exactly one charged lure');
    const decoy = game.gadgets.decoys[0];
    assert(!game.level.isWallAt(decoy.pos.x, decoy.pos.z), 'thrown lure landed inside a wall');
    advance(game, 0.75);
    assert(lizard.distractedFor > 0 && lizard.distractionTarget.distanceTo(decoy.pos) < 0.01, 'audible lure failed to redirect an unstunned creature');
    assert(game.noises.some(noise => noise.kind === 'decoy'), 'lure emitted no real world noise');
    tick(game, [{ lurePressed: true }]);
    assert(player.tools.lure === 0 && game.gadgets.decoys.length === 1, 'empty lure ammunition created a second decoy');
    stand(player, game.level.liftPos); advance(game, 7.2);
    assert(!game.gadgets.decoys.length && !decoy.group.parent && !game.gadgets.effects.length, 'expired gadget visuals remain in the world');
    return { ok: true, info: 'R miss and hit ammo, actual movement/attack suppression, G throw, wall stop, noise distraction and effect cleanup' };
  },

  encounterSpider(game) {
    let [player, partner] = setup(game, 2);
    let { a, b } = arena(game);
    stand(player, a); stand(partner, b, a);
    let spider = addCreature(game, Spider, a);
    tick(game);
    assert(player.alive && player.webbedBy === spider && spider.web.visible && spider.captureRemaining > 8, 'ceiling spider failed to capture without instantly killing');
    const caught = player.pos.clone();
    advance(game, 0.4, [{ forward: 1, sprint: true }]);
    assert(player.pos.distanceTo(caught) < 0.001 && spider.group.position.y > 2.7, 'web does not hold player below a ceiling-perched spider');
    tick(game, [{}, { grabPressed: true }]);
    assert(player.webbedBy === spider, 'distant partner rescued through range limit');
    approach(game, partner, { pos: player.pos }, 1.4);
    assert(game.interactionCandidate(partner)?.kind === 'rescue', 'nearby partner has no silk-cut prompt');
    tick(game, [{}, { grabPressed: true }]);
    assert(player.alive && !player.webbedBy && !spider.victim && !spider.web.visible, 'partner E did not release both web references');

    [player] = setup(game); ({ a, b } = arena(game));
    stand(player, a); spider = addCreature(game, Spider, a); tick(game);
    for (let press = 0; press < 3; press++) {
      tick(game, [{ grabPressed: true }]);
      if (press < 2) { assert(player.webbedBy === spider, 'solo web released before three struggles'); advance(game, 0.5); }
    }
    assert(player.alive && !player.webbedBy && !spider.web.visible && spider.cooldown > 0, 'solo E struggle has no viable recovery');
    return { ok: true, info: 'real ceiling capture, rooted player, rescue range/prompt, teammate E and timed solo three-press escape' };
  },

  encounterLizard(game) {
    const [player] = setup(game), { a, b } = arena(game);
    stand(player, a, b);
    const lizard = addCreature(game, Lizard, b);
    advance(game, 0.5);
    assert(lizard.state === 'wander' && !lizard.tryCatch() && player.alive, 'unprovoked lizard attacks a quiet distant player');
    player.flashOn = true;
    for (let i = 0; i < 78; i++) { aim(player, lizard); tick(game); }
    assert(lizard.state === 'agitated' && lizard.provokedBy === player, 'sustained flashlight failed to provoke the lizard');
    player.flashOn = player.lightOn = false; stand(player, game.level.liftPos);
    advance(game, 8.4);
    assert(lizard.state === 'wander' && lizard.anger === 0 && player.alive, 'lizard did not calm after losing the player');
    lizard.place(b);
    const close = b.clone().lerp(a, 0.5); stand(player, close, b); tick(game);
    assert(lizard.state === 'agitated' && player.alive, 'close approach failed to provoke with a survivable warning');
    lizard.calm(); lizard.place(b); stand(player, a, b);
    game.emitNoise(player.pos.x, player.pos.z, 13, 'sprint', player); tick(game);
    assert(lizard.state === 'agitated' && lizard.provokedBy === player, 'loud attributed noise failed to provoke');
    return { ok: true, info: 'quiet passive state, sustained light, loss-of-contact calming, proximity and attributed noise provocation' };
  },

  encounterThief(game) {
    const [player] = setup(game), { a, b } = arena(game);
    stand(player, a, b);
    const item = game.items.find(candidate => !candidate.heavy && !candidate.type.soul);
    item.pos.copy(a).add(player.forwardVec(new THREE.Vector3()).multiplyScalar(0.15));
    item.vel.set(0, 0, 0); item.sync();
    tick(game, [{ grabPressed: true }]);
    assert(player.holding === item, 'could not pick up the theft-test valuable through E');
    const originalValue = item.value, originalHP = item.hp, originalCount = game.items.length;
    const total = game.items.reduce((sum, entry) => sum + entry.value, game.cash);
    const thief = addCreature(game, ThiefBug, player.pos.clone().add(player.forwardVec(new THREE.Vector3()).multiplyScalar(0.75)));
    tick(game);
    assert(!player.holding && thief.treasure === item && item.stolenBy === thief && player.alive, 'thief did not transfer the actual held item nonfatally');
    advance(game, 0.6);
    assert(game.items.length === originalCount && game.items.filter(entry => entry === item).length === 1, 'theft duplicated or removed valuable ownership');
    assert(item.value === originalValue && item.hp === originalHP && game.grabCandidate(player) !== item, 'carried stolen loot is damaged or independently pickable');
    approach(game, player, thief);
    assert(game.interactionCandidate(player)?.kind === 'recover', 'stolen item has no recovery prompt');
    tick(game, [{ grabPressed: true }]);
    assert(!thief.treasure && !item.stolenBy && !item.gone && item.value === originalValue && player.alive, 'E recovery lost loot or value');
    assert(game.items.reduce((sum, entry) => sum + entry.value, game.cash) === total, 'world value changed during theft/recovery');
    // Deposit that same recovered object via the actual lift lifecycle.
    item.pos.copy(game.level.liftPos); item.vel.set(0, 0, 0); item.sync();
    stand(player, game.level.liftPos); advance(game, 1.25);
    assert(item.gone && !game.items.includes(item) && game.cash === originalValue, 'recovered valuable cannot be deposited exactly once');
    assert(game.items.reduce((sum, entry) => sum + entry.value, game.cash) === total, 'deposit failed to conserve recovered value');
    return { ok: true, info: 'E pickup, live snatch/flee, exclusive item ownership, intact E recovery, conserved value and real lift deposit' };
  },
};
