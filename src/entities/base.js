// Shared monster behaviour: pathfinding toward a point, catching interns,
// staying out of the lift (consecrated ground).
import * as THREE from 'three';
import { LIFT_HALF } from '../config.js';
import { instance, Animator, pickModel, isCustomModel } from '../assets.js';
import { createCreatureRig, disposeCreatureRig } from './creature-rigs.js';

export class Monster {
  // Supplied GLBs take precedence; original articulated rigs are always available.
  constructor(world, models, { height = 2.7, radius = 0.4, passWalls = false, rigFactory = createCreatureRig } = {}) {
    const model = Array.isArray(models) ? pickModel(...models) : models;
    this.custom = isCustomModel(model);
    const design = Array.isArray(models) ? models[0] : models;
    this.modelName = this.custom ? model : design;
    this.height = height;
    this.rigFactory = rigFactory;
    this.world = world;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.radius = radius;
    this.passWalls = passWalls;
    this.cooldown = 0;
    this.moving = false;
    this.waypoint = new THREE.Vector3();
    this.stunnedFor = 0;
    this.distractedFor = 0;
    this.distractionTarget = new THREE.Vector3();

    this.group = new THREE.Group();
    const { object, inner, animations, animator } = this.custom
      ? instance(model, { height })
      : rigFactory(design, { height });
    this.model = object;
    this.group.add(object);
    this.anim = animator || new Animator(inner, animations);
    this.anim.play('idle');
    world.scene.add(this.group);
  }

  // Rescale to a new height in meters (custom models get their own sizes).
  resize(height) {
    this.model.scale.multiplyScalar(height / this.height);
    this.height = height;
  }

  place(p) {
    this.pos.set(p.x, 0, p.z);
    this.sync();
  }

  livingPlayers() {
    return this.world.players.filter((p) => p.alive);
  }

  get isStunned() { return this.stunnedFor > 0; }

  stun(seconds = 4) {
    this.stunnedFor = Math.max(this.stunnedFor, seconds);
    this.distractedFor = 0;
    this.moving = false;
  }

  distract(pos, seconds = 6) {
    this.distractionTarget.copy(pos);
    this.distractedFor = Math.max(this.distractedFor, seconds);
  }

  // Every specimen shares the same counterplay, including the wall walker.
  updateStatus(dt) {
    if (this.stunnedFor > 0) {
      this.stunnedFor = Math.max(0, this.stunnedFor - dt);
      this.cooldown = Math.max(this.cooldown, 0.15);
      this.moving = false;
      this.anim.play('idle');
      this.anim.mixer.timeScale = 1;
      this.anim.update(dt * 0.2);
      this.sync();
      return true;
    }
    if (this.distractedFor > 0) {
      this.distractedFor = Math.max(0, this.distractedFor - dt);
      // Rattles still obeys its flashlight-freeze rule while distracted.
      if (this.constructor.id !== 'skeleton' || !this.isLit()) {
        this.moveToward(this.distractionTarget.x, this.distractionTarget.z, 1.65, dt);
        this.anim.play(this.moving ? 'walk' : 'idle');
        this.anim.mixer.timeScale = 1;
        this.anim.update(dt);
      }
      this.sync();
      return true;
    }
    return false;
  }

  nearestPlayer(filter = () => true) {
    let best = null, bestD = Infinity;
    for (const p of this.world.players) {
      if (!p.alive || p.isHidden || !filter(p)) continue;
      const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      if (d < bestD) { best = p; bestD = d; }
    }
    return { player: best, dist: bestD };
  }

  // Getting into cover does not fool a specimen that watched you do it.
  // Check this before moving the player into the furniture's hiding position.
  canWitnessHiding(player) {
    if (!player.alive || this.world.level.inLift(player.pos.x, player.pos.z)) return false;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 7 || !this.world.level.lineOfSight(this.pos.x, this.pos.z, player.pos.x, player.pos.z)) return false;
    if (distance < 1.8) return true;
    return (Math.sin(this.yaw) * dx + Math.cos(this.yaw) * dz) / distance >= Math.cos(Math.PI * 75 / 180);
  }

  // Step toward (tx,tz). Uses a straight line when it can see the goal,
  // otherwise follows the level's BFS flow field. Returns remaining distance.
  moveToward(tx, tz, speed, dt) {
    const level = this.world.level;
    let gx = tx, gz = tz;
    const direct = Math.hypot(tx - this.pos.x, tz - this.pos.z);
    if (!this.passWalls && (direct > 10 || !level.lineOfSight(this.pos.x, this.pos.z, tx, tz))) {
      const field = level.fieldTo(...level.worldToCell(tx, tz));
      const wp = level.nextWaypoint(this.pos.x, this.pos.z, field, this.waypoint);
      if (wp) { gx = wp.x; gz = wp.z; }
    }
    const dx = gx - this.pos.x, dz = gz - this.pos.z;
    const len = Math.hypot(dx, dz);
    this.moving = len > 0.05;
    if (!this.moving) return direct;
    const step = Math.min(len, speed * dt);
    this.pos.x += (dx / len) * step;
    this.pos.z += (dz / len) * step;
    if (!this.passWalls) level.collideCircle(this.pos, this.radius);
    this.keepOutOfLift();
    const want = Math.atan2(dx, dz);
    this.yaw += Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw)) * (1 - Math.exp(-8 * dt));
    return direct;
  }

  keepOutOfLift() {
    const lp = this.world.level.liftPos;
    const m = LIFT_HALF + 0.6;
    const dx = this.pos.x - lp.x, dz = this.pos.z - lp.z;
    if (Math.abs(dx) < m && Math.abs(dz) < m) {
      if (m - Math.abs(dx) < m - Math.abs(dz)) this.pos.x = lp.x + Math.sign(dx || 1) * m;
      else this.pos.z = lp.z + Math.sign(dz || 1) * m;
    }
  }

  // Concealed interns stay safe until light or an investigation exposes them.
  tryCatch() {
    if (this.cooldown > 0 || this.stunnedFor > 0 || this.distractedFor > 0) return false;
    for (const p of this.world.players) {
      if (!p.alive || p.isHidden || p.trapGrace > 0 || this.world.level.inLift(p.pos.x, p.pos.z)) continue;
      // Reach into an exposed hideout without needing to enter its solid shell.
      const reach = p.hidingSpot ? Math.max(1.35, (p.hidingSpot.halfWidth || 0.5) + this.radius + 0.08) : this.radius + 0.5;
      const clear = this.passWalls && !p.hidingSpot || this.world.level.lineOfSight(this.pos.x, this.pos.z, p.pos.x, p.pos.z);
      if (clear && Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < reach) {
        this.cooldown = 3.5;
        this.anim.play(this.anim.has('attack-melee-right') ? 'attack-melee-right' : 'idle', { once: true });
        this.world.killPlayer(p, this);
        return true;
      }
    }
    return false;
  }

  // Is this point inside any intern's lit flashlight cone (with line of sight)?
  isLit() {
    return this.world.players.some((p) => this.world.isLitBy(p, this.pos));
  }

  sync() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }

  dispose() {
    this.world.scene.remove(this.group);
    if (!this.custom) disposeCreatureRig(this.model);
  }
}
