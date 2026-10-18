// Additional facility specimens. Capture, theft and provocation are deliberately
// separate: an idle animal or stolen valuable must not silently kill / disappear.
import * as THREE from 'three';
import { WALL_H } from '../config.js';
import { Monster } from './base.js';
import { createFacilityRig } from './facility-rigs.js';

const LOUD_NOISES = new Set(['sprint', 'crack', 'shatter', 'drop', 'shot', 'gunshot', 'stun', 'explosion']);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function exposed(world, player) {
  return player?.alive && !player.isHidden && !world.level.inLift(player.pos.x, player.pos.z);
}

function visible(world, from, to) {
  return world.level.lineOfSight(from.x, from.z, to.x, to.z);
}

function popup(world, player, text) {
  world.hud?.popup?.(player.index, text, 'hint');
}

function idle(monster, dt) {
  monster.moving = false;
  monster.anim.play('idle');
  monster.anim.update(dt);
  monster.sync();
}

function wander(monster, dt, speed) {
  if (!monster.wanderTarget || distance(monster.pos, monster.wanderTarget) < 0.75) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const point = monster.world.level.randomFloorPoint(monster.world.rng);
      if (!monster.world.level.inLift(point.x, point.z)) {
        monster.wanderTarget = point;
        break;
      }
    }
  }
  if (monster.wanderTarget) {
    monster.moveToward(monster.wanderTarget.x, monster.wanderTarget.z, speed, dt);
    if (!monster.moving) monster.wanderTarget = null;
  }
  monster.anim.play(monster.moving ? 'walk' : 'idle', { timeScale: Math.max(0.5, speed / 1.5) });
  monster.anim.update(dt);
  monster.sync();
}

function cocoon() {
  const points = [];
  // The first segment is the moving ceiling tether. All remaining silk is static.
  points.push(0, WALL_H - 0.3, 0, 0, 1.3, 0);
  for (let row = 0; row < 5; row++) {
    const radius = 0.34 - row * 0.022, y = 0.25 + row * 0.265;
    for (let i = 0; i < 20; i++) {
      const a = i * Math.PI / 10, b = (i + 1) * Math.PI / 10;
      points.push(Math.sin(a) * radius, y, Math.cos(a) * radius,
        Math.sin(b) * radius, y + Math.sin(i * 1.7 + row) * 0.018, Math.cos(b) * radius);
    }
  }
  for (let i = 0; i < 14; i++) {
    const a = i * Math.PI / 7, b = a + 0.50;
    points.push(Math.sin(a) * 0.32, 0.28, Math.cos(a) * 0.32,
      Math.sin(b) * 0.24, 1.34, Math.cos(b) * 0.24);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const material = new THREE.LineBasicMaterial({ color: 0x999c84, transparent: true, opacity: 0.56, depthWrite: false });
  const object = new THREE.LineSegments(geometry, material);
  object.name = 'spider-cocoon';
  object.visible = false;
  object.frustumCulled = false;
  return object;
}

export class Spider extends Monster {
  static id = 'spider';
  static notice = {
    code: 'SPECIMEN 04', name: '"THE WEAVER"',
    rule: 'Waits above you. Walking underneath lets it wrap you in silk. Your partner has nine seconds to cut you free with E.',
    tip: 'Stun it to release the web. Alone, press E three times to struggle free.',
  };

  constructor(world) {
    super(world, 'wall-spider', { height: 0.68, radius: 0.42, rigFactory: createFacilityRig });
    this.state = 'perched';
    this.perchY = WALL_H - 0.08;
    this.model.rotation.z = Math.PI;
    this.victim = null;
    this.webTime = 0;
    this.struggleCount = 0;
    this.lastStruggle = -Infinity;
    this.web = cocoon();
    world.scene.add(this.web);
  }

  get captureRemaining() { return this.victim ? Math.max(0, 9 - this.webTime) : 0; }

  sync() {
    super.sync();
    this.group.position.y = (this.perchY ?? WALL_H - 0.08) - (this.victim ? Math.min(0.18, this.webTime * 0.02) : 0);
  }

  capture(player) {
    if (this.victim || this.cooldown > 0 || this.isStunned || this.distractedFor > 0 ||
        !exposed(this.world, player) || player.trapGrace > 0 || player.webbedBy || distance(this.pos, player.pos) > 0.85 ||
        !visible(this.world, this.pos, player.pos)) return false;
    this.victim = player;
    this.state = 'feeding';
    this.webTime = 0;
    this.struggleCount = 0;
    this.lastStruggle = -Infinity;
    player.webbedBy = this;
    player.mapOpen = false;
    player.vel.set(0, 0, 0);
    if (player.holding) {
      const item = player.holding;
      this.world.release(player);
      if (!item.holders.length) {
        item.vel.set(0, 0, 0);
        item.lastVel.set(0, 0, 0);
      }
    }
    this.web.visible = true;
    this.web.position.copy(player.pos);
    popup(this.world, player, 'WEBBED! Partner: E nearby to cut silk. Alone: E three times.');
    this.world.soundAt(this.pos, (v) => this.world.sound.rattle(v * 0.65), 16);
    return true;
  }

  tryCatch() {
    for (const player of this.world.players) if (this.capture(player)) return true;
    return false;
  }

  rescue(rescuer) {
    const victim = this.victim;
    if (!victim || !rescuer?.alive) return false;
    if (rescuer === victim) {
      const hasPartner = this.world.players.some((p) => p !== victim && p.alive && !p.webbedBy);
      if (hasPartner) {
        popup(this.world, victim, 'Your partner must cut the silk: E within 2m.');
        return true; // consume the attempt instead of picking up loot while trapped
      }
      const now = this.world.time;
      if (now - this.lastStruggle < 0.45) return true;
      this.lastStruggle = now;
      this.struggleCount++;
      if (this.struggleCount >= 3) this.releaseVictim('You tore free of the web.');
      else popup(this.world, victim, `STRUGGLE ${this.struggleCount}/3 — press E again after a moment.`);
      return true;
    }
    if (rescuer.isHidden || rescuer.webbedBy || distance(rescuer.pos, victim.pos) > 2 ||
        !visible(this.world, rescuer.pos, victim.pos)) return false;
    this.releaseVictim('Your partner cut you free.');
    popup(this.world, rescuer, 'Silk cut. Your partner is free.');
    return true;
  }

  releaseVictim(reason = null) {
    const victim = this.victim;
    if (!victim) return null;
    if (victim.webbedBy === this) victim.webbedBy = null;
    this.victim = null;
    this.state = 'perched';
    this.web.visible = false;
    this.cooldown = Math.max(this.cooldown, 5);
    if (reason && victim.alive) popup(this.world, victim, reason);
    return victim;
  }

  stun(seconds) {
    this.releaseVictim('The spider lost its grip. You are free.');
    return super.stun(seconds);
  }

  distract(position, seconds) {
    this.releaseVictim('The spider abandoned its web. You are free.');
    return super.distract(position, seconds);
  }

  update(dt) {
    if (this.updateStatus(dt)) {
      this.releaseVictim();
      return;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    const victim = this.victim;
    if (victim) {
      if (!exposed(this.world, victim) || victim.webbedBy !== this || distance(this.pos, victim.pos) > 2 ||
          !visible(this.world, this.pos, victim.pos)) {
        this.releaseVictim();
      } else {
        this.webTime += dt;
        this.web.position.copy(victim.pos);
        const p = this.web.geometry.attributes.position;
        p.setXYZ(0, this.pos.x - victim.pos.x, this.perchY - 0.3 - Math.min(0.18, this.webTime * 0.02), this.pos.z - victim.pos.z);
        p.needsUpdate = true;
        if (this.webTime >= 9) {
          this.releaseVictim();
          this.cooldown = 6;
          this.world.killPlayer(victim, this);
        }
      }
    } else {
      this.tryCatch();
    }
    this.anim.play(this.victim ? 'walk' : 'idle', { timeScale: this.victim ? 0.55 : 0.35 });
    this.anim.update(dt);
    this.sync();
  }

  dispose() {
    this.releaseVictim();
    this.world.scene.remove(this.web);
    this.web.geometry.dispose();
    this.web.material.dispose();
    super.dispose();
  }
}

export class Lizard extends Monster {
  static id = 'lizard';
  static notice = {
    code: 'SPECIMEN 05', name: '"THE BLIND SEEKER"',
    rule: 'Normally passive. Getting within two metres, holding a light on it, or making a loud noise provokes a chase.',
    tip: 'Leave it room. Break contact for eight seconds, or lure it away with a distraction.',
  };

  constructor(world) {
    super(world, 'blind-seeker', { height: 1.2, radius: 0.46, rigFactory: createFacilityRig });
    this.state = 'wander';
    this.anger = 0;
    this.provokedBy = null;
    this.lastKnown = new THREE.Vector3();
    this.lastNoise = world.noiseId || 0;
    this.lightExposure = new Map();
    this.provocationGrace = 0;
    this.wanderTarget = null;
  }

  calm() {
    this.state = 'wander';
    this.anger = 0;
    this.provokedBy = null;
    this.lightExposure.clear();
  }

  provoke(player = null) {
    if (this.isStunned || this.distractedFor > 0 || (player && !exposed(this.world, player))) return false;
    const first = this.state !== 'agitated';
    this.state = 'agitated';
    this.anger = 8;
    this.provokedBy = player;
    if (player) this.lastKnown.copy(player.pos);
    if (first) this.world.soundAt(this.pos, (v) => this.world.sound.groan(v * 0.9), 22);
    return true;
  }

  distract(position, seconds) {
    this.calm();
    this.provocationGrace = 0.9;
    return super.distract(position, seconds);
  }

  canWitnessHiding(player) {
    return this.state === 'agitated' && super.canWitnessHiding(player);
  }

  tryCatch() {
    if (this.state !== 'agitated' || this.isStunned || this.distractedFor > 0) return false;
    return super.tryCatch();
  }

  update(dt) {
    if (this.updateStatus(dt)) {
      this.calm();
      this.lastNoise = this.world.noiseId || this.lastNoise;
      this.provocationGrace = 0.9;
      return;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.provocationGrace = Math.max(0, this.provocationGrace - dt);
    const world = this.world;
    if (!this.provocationGrace) {
      for (const player of world.players) {
        const d = distance(this.pos, player.pos);
        const eligible = exposed(world, player);
        const lit = eligible && d < 5 && world.isLitBy(player, this.pos);
        const exposure = lit ? (this.lightExposure.get(player) || 0) + dt : 0;
        this.lightExposure.set(player, exposure);
        if (eligible && ((d < 2 && visible(world, this.pos, player.pos)) || exposure >= 1.2)) this.provoke(player);
      }
      for (const noise of world.noises) {
        if (noise.id <= this.lastNoise) continue;
        this.lastNoise = noise.id;
        if (!LOUD_NOISES.has(noise.kind) || noise.r < 8 || Math.hypot(noise.x - this.pos.x, noise.z - this.pos.z) > Math.min(noise.r, 11)) continue;
        const maker = exposed(world, noise.source) ? noise.source :
          this.nearestPlayer((p) => exposed(world, p) && Math.hypot(p.pos.x - noise.x, p.pos.z - noise.z) < 5).player;
        if (this.provoke(maker)) this.lastKnown.set(noise.x, 0, noise.z);
      }
    } else {
      this.lastNoise = world.noiseId || this.lastNoise;
    }

    if (this.state === 'agitated') {
      let target = this.provokedBy;
      if (!exposed(world, target)) target = null;
      if (!target) target = this.nearestPlayer((p) => exposed(world, p) && distance(this.pos, p.pos) < 11 && visible(world, this.pos, p.pos)).player;
      if (target && distance(this.pos, target.pos) < 12 && visible(world, this.pos, target.pos)) {
        this.provokedBy = target;
        this.lastKnown.copy(target.pos);
        this.anger = 8;
      } else {
        this.anger -= dt;
      }
      if (this.anger <= 0) this.calm();
      else if (this.cooldown <= 0) {
        this.moveToward(this.lastKnown.x, this.lastKnown.z, 3.35 + Math.min(0.5, (world.floor - 1) * 0.1), dt);
        this.anim.play('sprint', { timeScale: 1.15 });
        this.tryCatch();
        this.anim.update(dt);
        this.sync();
        return;
      } else {
        idle(this, dt);
        return;
      }
    }
    wander(this, dt, 0.68);
  }
}

export class ThiefBug extends Monster {
  static id = 'thief';
  static notice = {
    code: 'SPECIMEN 06', name: '"THE COLLECTOR"',
    rule: 'Snatches small valuables out of your hands. It cannot steal soul jars or heavy objects.',
    tip: 'Get close and press E, or stun it, to make it drop the item intact.',
  };

  constructor(world) {
    super(world, 'thief-bug', { height: 0.78, radius: 0.34, rigFactory: createFacilityRig });
    this.state = 'wander';
    this.treasure = null;
    this.lastVictim = null;
    this.wanderTarget = null;
    this.fleeTarget = null;
  }

  tryCatch() { return false; }

  canSteal(player) {
    const item = player?.holding;
    return exposed(this.world, player) && !(player.trapGrace > 0) && !player.webbedBy && item && !item.gone &&
      !item.heavy && !item.type.soul && item.depositing <= 0 && !item.stolenBy &&
      item.holders.length === 1 && !this.world.level.inLift(item.pos.x, item.pos.z);
  }

  lootAnchor(out) {
    return out.set(this.pos.x + Math.sin(this.yaw) * 0.34, 0.37,
      this.pos.z + Math.cos(this.yaw) * 0.34);
  }

  steal(player) {
    if (this.treasure || this.cooldown > 0 || this.isStunned || this.distractedFor > 0 || !this.canSteal(player) ||
        distance(this.pos, player.pos) > 1.08 || !visible(this.world, this.pos, player.pos)) return false;
    const item = player.holding;
    this.world.release(player);
    item.stolenBy = this;
    this.treasure = item;
    item.vel.set(0, 0, 0);
    item.lastVel.set(0, 0, 0);
    item.inLiftTime = 0;
    item.hitCooldown = Math.max(1, item.hitCooldown);
    this.lootAnchor(item.pos);
    item.sync();
    this.state = 'flee';
    this.lastVictim = player;
    this.fleeTarget = null;
    this.cooldown = 6;
    popup(this.world, player, `The Collector took your ${item.type.name}! Get close and press E.`);
    this.world.soundAt(this.pos, (v) => this.world.sound.rattle(v * 0.45), 12);
    return true;
  }

  dropTreasure() {
    const item = this.treasure;
    this.treasure = null;
    this.state = 'wander';
    this.fleeTarget = null;
    this.cooldown = Math.max(this.cooldown, 5);
    if (!item) return null;
    if (item.stolenBy === this) item.stolenBy = null;
    if (item.gone) return null;
    item.pos.copy(this.pos);
    item.pos.y = 0;
    this.world.level.collideCircle(item.pos, item.radius);
    item.vel.set(0, 0, 0);
    item.lastVel.set(0, 0, 0);
    item.hitCooldown = 1;
    item.inLiftTime = 0;
    item.sync();
    return item;
  }

  recover(player) {
    if (!this.treasure || !player?.alive || player.isHidden || player.webbedBy ||
        distance(player.pos, this.pos) > 2 || !visible(this.world, player.pos, this.pos)) return false;
    const item = this.dropTreasure();
    if (item) popup(this.world, player, `${item.type.name} recovered. Pick it up from the floor.`);
    return !!item;
  }

  stun(seconds) {
    this.dropTreasure();
    return super.stun(seconds);
  }

  update(dt) {
    if (this.updateStatus(dt)) {
      if (this.isStunned && this.treasure) this.dropTreasure();
      return;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.treasure?.gone || (this.treasure && this.treasure.stolenBy !== this)) this.dropTreasure();
    if (this.treasure) {
      const avoid = this.lastVictim?.alive ? this.lastVictim.pos : this.nearestPlayer().player?.pos || this.pos;
      if (!this.fleeTarget || distance(this.pos, this.fleeTarget) < 0.9) {
        let best = null, bestScore = -Infinity;
        for (let i = 0; i < 7; i++) {
          const point = this.world.level.randomFloorPoint(this.world.rng);
          if (this.world.level.inLift(point.x, point.z)) continue;
          const score = distance(point, avoid) - distance(point, this.pos) * 0.24;
          if (score > bestScore) { best = point; bestScore = score; }
        }
        this.fleeTarget = best;
      }
      if (this.fleeTarget) this.moveToward(this.fleeTarget.x, this.fleeTarget.z, 2.4, dt);
      this.anim.play('walk', { timeScale: 1.5 });
      this.anim.update(dt);
      this.sync();
      return;
    }
    const { player, dist } = this.nearestPlayer((p) => this.canSteal(p) && visible(this.world, this.pos, p.pos));
    if (player && dist < 13 && this.cooldown <= 0) {
      this.state = 'stalk';
      this.moveToward(player.pos.x, player.pos.z, 1.9, dt);
      this.anim.play('walk', { timeScale: 1.2 });
      this.steal(player);
      this.anim.update(dt);
      this.sync();
    } else {
      this.state = 'wander';
      wander(this, dt, 0.95);
    }
  }

  dispose() {
    this.dropTreasure();
    super.dispose();
  }
}

export class Mimic extends Monster {
  static id = 'mimic';
  static notice = {
    code: 'SPECIMEN 07', name: '"THE FALSE CHEST"',
    rule: 'Some containers are alive. Opening one gives it a moment to unfold before it begins to chase.',
    tip: 'Back away from a chest that grows teeth. It can be stunned or distracted.',
  };

  constructor(world) {
    super(world, 'mimic', { height: 1.2, radius: 0.48, rigFactory: createFacilityRig });
    this.state = 'dormant';
    this.awakening = 0;
    this.awakeningTime = 0;
    this.anim.setAwakened?.(0);
  }

  activate(position = this.pos, yaw = this.yaw) {
    if (this.state !== 'dormant') return this;
    this.place(position);
    this.yaw = yaw;
    this.state = 'awakening';
    this.awakening = 0;
    this.awakeningTime = 0;
    this.anim.setAwakened?.(0);
    this.world.soundAt(this.pos, (v) => this.world.sound.groan(v * 0.7), 16);
    this.sync();
    return this;
  }

  distract(position, seconds) {
    if (this.state === 'dormant') return false;
    return super.distract(position, seconds);
  }

  canWitnessHiding(player) {
    return this.state === 'hunt' && super.canWitnessHiding(player);
  }

  tryCatch() {
    if (this.state !== 'hunt' || this.awakeningTime < 0.9 || this.isStunned || this.distractedFor > 0) return false;
    return super.tryCatch();
  }

  update(dt) {
    if (this.updateStatus(dt)) return;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.state === 'dormant') {
      this.anim.setAwakened?.(0);
      idle(this, dt);
      return;
    }
    if (this.state === 'awakening') {
      this.awakeningTime += dt;
      this.awakening = Math.min(1, this.awakeningTime / 0.9);
      this.anim.setAwakened?.(this.awakening);
      idle(this, dt);
      if (this.awakening >= 1) this.state = 'hunt';
      return; // the entire transformation is harmless, including its final frame
    }
    this.anim.setAwakened?.(1);
    const { player } = this.nearestPlayer((p) => exposed(this.world, p) && distance(this.pos, p.pos) < 24);
    if (player && this.cooldown <= 0) {
      this.moveToward(player.pos.x, player.pos.z, 2.15 + Math.min(0.45, (this.world.floor - 1) * 0.08), dt);
      this.anim.play('walk', { timeScale: 1.2 });
      this.tryCatch();
      this.anim.update(dt);
      this.sync();
    } else idle(this, dt);
  }
}
