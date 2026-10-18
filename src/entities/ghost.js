// Specimen 03 "THE WATCHER": drifts through walls toward flashlights.
import { Monster } from './base.js';

export class Ghost extends Monster {
  static id = 'ghost';
  static notice = {
    code: 'SPECIMEN 03',
    name: '"THE WATCHER"',
    rule: 'Passes through walls and is drawn to light. When you hear whispers, turn your flashlight OFF.',
    tip: 'Your flashlight flickers when it is close.',
  };

  constructor(world) {
    super(world, ['bacteria-pill'], { height: 2.65, radius: 0.45, passWalls: true });
    this.mats = [];
    if (!this.custom) {
      // A solid-looking, lightless shape that slips in and out of the haze.
      const materials = new Set();
      this.model.traverse((o) => {
        if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      });
      for (const m of materials) {
        m.transparent = true;
        m.opacity = 0.84;
        m.depthWrite = false;
        this.mats.push(m);
      }
    }
    this.wanderTarget = null;
  }

  update(dt) {
    if (this.updateStatus(dt)) return;
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
    this.group.position.y = 0.12 + Math.sin(t * 1.3) * 0.06;
    for (const m of this.mats) m.opacity = 0.80 + 0.09 * Math.sin(t * 2.1);
    this.anim.update(dt);
    this.group.position.x = this.pos.x;
    this.group.position.z = this.pos.z;
    this.group.rotation.y = this.yaw;
  }
}
