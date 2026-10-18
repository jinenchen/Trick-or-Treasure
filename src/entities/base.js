// Shared monster behaviour: pathfinding toward a point, catching interns,
// staying out of the lift (consecrated ground).
import * as THREE from 'three';
import { LIFT_HALF } from '../config.js';
import { instance, Animator, pickModel, isCustomModel } from '../assets.js';

export class Monster {
  // `models`: preferred model first, Kenney fallback last (see CUSTOM_MODELS).
  constructor(world, models, { height = 1.85, radius = 0.4, passWalls = false, eyeColor = 0xff2a1a } = {}) {
    const model = Array.isArray(models) ? pickModel(...models) : models;
    this.modelName = model;
    this.custom = isCustomModel(model);
    this.height = height;
    this.world = world;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.radius = radius;
    this.passWalls = passWalls;
    this.cooldown = 0;
    this.moving = false;
    this.waypoint = new THREE.Vector3();

    this.group = new THREE.Group();
    const { object, inner, animations } = instance(model, { height });
    this.model = object;
    this.group.add(object);
    this.anim = new Animator(inner, animations);
    this.anim.play('idle');

    // Glowing eyes read well in the dark even when the body doesn't
    // (only on the Kenney models; downloaded ones have their own faces).
    if (!this.custom) {
      const eyeMat = new THREE.MeshBasicMaterial({ color: eyeColor });
      const eyeGeo = new THREE.SphereGeometry(0.035, 8, 6);
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.position.set(s * 0.09, height * 0.86, 0.2);
        this.group.add(eye);
      }
    }
    world.scene.add(this.group);
  }

  // Rescale to a new height in meters (custom models get their own sizes).
  resize(height) {
    this.model.scale.setScalar(height / this.height);
  }

  place(p) {
    this.pos.set(p.x, 0, p.z);
    this.sync();
  }

  livingPlayers() {
    return this.world.players.filter((p) => p.alive);
  }

  nearestPlayer(filter = () => true) {
    let best = null, bestD = Infinity;
    for (const p of this.world.players) {
      if (!p.alive || !filter(p)) continue;
      const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      if (d < bestD) { best = p; bestD = d; }
    }
    return { player: best, dist: bestD };
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

  // Anyone within reach (and not standing in the lift) gets caught.
  tryCatch() {
    if (this.cooldown > 0) return false;
    for (const p of this.world.players) {
      if (!p.alive || this.world.level.inLift(p.pos.x, p.pos.z)) continue;
      if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < this.radius + 0.5) {
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
  }
}
