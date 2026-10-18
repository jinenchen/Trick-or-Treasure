// Specimen 03 "THE WATCHER": drifts through walls toward flashlights.
import * as THREE from 'three';
import { Monster } from './base.js';
import { uniqueMaterials } from '../assets.js';

export class Ghost extends Monster {
  static id = 'ghost';
  static notice = {
    code: 'SPECIMEN 03',
    name: '"THE WATCHER"',
    rule: 'Passes through walls and is drawn to light. When you hear whispers, turn your flashlight OFF.',
    tip: 'Your flashlight flickers when it is close.',
  };

  constructor(world) {
    super(world, 'character-ghost', { height: 1.8, radius: 0.45, passWalls: true, eyeColor: 0xd8ffff });
    for (const m of uniqueMaterials(this.model)) {
      m.transparent = true;
      m.opacity = 0.55;
      m.depthWrite = false;
      m.emissive = new THREE.Color(0x4fb8c8);
      m.emissiveIntensity = 0.5;
    }
    this.mats = [];
    this.model.traverse((o) => o.isMesh && this.mats.push(o.material));
    this.wanderTarget = null;
  }

  update(dt) {
    const world = this.world;
    this.cooldown -= dt;

    // Whispers and flicker for everyone nearby.
    for (const p of world.players) {
      const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
      p.flicker = Math.max(p.flicker, Math.max(0, 1 - d / 9));
      world.ghostNear = Math.max(world.ghostNear, Math.max(0, 1 - d / 15));
    }

    const { player } = this.nearestPlayer((p) => p.lightOn && !world.level.inLift(p.pos.x, p.pos.z) &&
      Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < 28);
    if (player && this.cooldown <= 0) {
      this.moveToward(player.pos.x, player.pos.z, 1.75 + 0.1 * (world.floor - 1), dt);
      this.anim.play('walk', { timeScale: 0.7 });
    } else {
      if (!this.wanderTarget || Math.hypot(this.wanderTarget.x - this.pos.x, this.wanderTarget.z - this.pos.z) < 1) {
        this.wanderTarget = world.level.randomFloorPoint(world.rng);
      }
      this.moveToward(this.wanderTarget.x, this.wanderTarget.z, 0.8, dt);
      this.anim.play('idle');
    }
    if (this.cooldown <= 0) this.tryCatch();

    const t = world.time;
    this.group.position.y = 0.25 + Math.sin(t * 2) * 0.12;
    for (const m of this.mats) m.opacity = 0.4 + 0.18 * Math.sin(t * 3.1);
    this.anim.update(dt);
    this.group.position.x = this.pos.x;
    this.group.position.z = this.pos.z;
    this.group.rotation.y = this.yaw;
  }
}
