// Specimen 02 "THE LISTENER": blind, hunts whatever it hears.
import { Monster } from './base.js';

export class Zombie extends Monster {
  static id = 'zombie';
  static notice = {
    code: 'SPECIMEN 02',
    name: '"THE LISTENER"',
    rule: 'Blind, but it hears everything: sprinting, dropped loot, cracking urns. Walk. Quietly.',
    tip: 'Sound rings on the floor show how far a noise carried.',
  };

  constructor(world) {
    super(world, ['human-deer', 'character-zombie'], { height: 1.85, radius: 0.42, eyeColor: 0x9cff3a });
    if (this.custom) this.resize(2.2);
    this.state = 'wander';
    this.target = this.pos.clone();
    this.searchTime = 0;
    this.lastNoise = world.noiseId;
    this.groanTimer = 4;
    this.wanderTarget = null;
  }

  update(dt) {
    const world = this.world;
    this.cooldown -= dt;

    // Listen: the latest noise it can hear becomes the target.
    for (const n of world.noises) {
      if (n.id <= this.lastNoise) continue;
      this.lastNoise = n.id;
      if (Math.hypot(n.x - this.pos.x, n.z - this.pos.z) <= n.r) {
        if (this.state !== 'hunt') world.soundAt(this.pos, (v) => world.sound.groan(v), 22);
        this.state = 'hunt';
        this.target.set(n.x, 0, n.z);
      }
    }

    if (this.cooldown > 0) {
      this.anim.update(dt);
      this.sync();
      return;
    }

    if (this.state === 'hunt') {
      const speed = 3.2 + 0.15 * (world.floor - 1);
      const d = this.moveToward(this.target.x, this.target.z, speed, dt);
      this.anim.play('walk', { timeScale: 1.5 });
      if (d < 0.8 || !this.moving) {
        this.state = 'search';
        this.searchTime = 2.5;
      }
    } else if (this.state === 'search') {
      this.searchTime -= dt;
      this.yaw += dt * 1.2;
      this.anim.play('idle');
      if (this.searchTime <= 0) this.state = 'wander';
    } else {
      if (!this.wanderTarget || Math.hypot(this.wanderTarget.x - this.pos.x, this.wanderTarget.z - this.pos.z) < 1) {
        this.wanderTarget = world.level.randomFloorPoint(world.rng);
      }
      const before = this.pos.clone();
      this.moveToward(this.wanderTarget.x, this.wanderTarget.z, 1.0, dt);
      if (before.distanceTo(this.pos) < 0.0001) this.wanderTarget = null;
      this.anim.play('walk', { timeScale: 0.6 });
    }

    // Occasional groan so you know roughly where it is.
    this.groanTimer -= dt;
    if (this.groanTimer <= 0) {
      world.soundAt(this.pos, (v) => world.sound.groan(v * 0.7), 20);
      this.groanTimer = 6 + Math.random() * 6;
    }

    this.tryCatch();
    this.anim.update(dt);
    this.sync();
  }
}
