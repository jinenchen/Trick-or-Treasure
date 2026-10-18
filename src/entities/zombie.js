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
    super(world, ['human-deer'], { height: 2.95, radius: 0.42 });
    this.state = 'wander';
    this.target = this.pos.clone();
    this.searchTime = 0;
    this.lastNoise = world.noiseId;
    this.groanTimer = 4;
    this.wanderTarget = null;
  }

  // The Listener is blind; only a noise can lead it to occupied cover.
  canWitnessHiding() {
    return false;
  }

  investigateHiding() {
    if (this.state !== 'hunt' && this.state !== 'search') return;
    for (const p of this.world.players) {
      if (!p.alive || !p.isHidden || this.world.level.inLift(p.pos.x, p.pos.z)) continue;
      const nearNoise = Math.hypot(p.pos.x - this.target.x, p.pos.z - this.target.z) <= 1.6;
      const reach = Math.max(1.35, (p.hidingSpot?.halfWidth || 0.5) + this.radius + 0.08);
      const inReach = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < reach;
      if (nearNoise && inReach && this.world.level.lineOfSight(this.pos.x, this.pos.z, p.pos.x, p.pos.z)) {
        p.hidingRevealed = true;
        // Discovery gives it one exact location, not ongoing player tracking.
        this.target.copy(p.pos);
        this.state = 'hunt';
      }
    }
  }

  update(dt) {
    if (this.updateStatus(dt)) return;
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

    this.investigateHiding();
    this.tryCatch();
    this.anim.update(dt);
    this.sync();
  }
}
