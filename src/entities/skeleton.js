// Specimen 01 "RATTLES": only moves while no flashlight is on it.
import { Monster } from './base.js';

export class Skeleton extends Monster {
  static id = 'skeleton';
  static notice = {
    code: 'SPECIMEN 01',
    name: '"RATTLES"',
    rule: 'It only moves in the dark. Keep it in your flashlight and it cannot take a single step.',
    tip: 'Flashlights drain. Recharge them in the lift.',
  };

  constructor(world) {
    super(world, ['bacteria', 'character-skeleton'], { height: 1.9, radius: 0.4, eyeColor: 0x8fe8ff });
    if (this.custom) this.resize(2.6);   // the Bacteria is tall and spindly
    this.dormant = 18;
    this.freeze = 0;
    this.rattleTimer = 0;
    this.lastLit = false;
  }

  update(dt) {
    const world = this.world;
    this.cooldown -= dt;
    const lit = this.isLit();
    if (lit) {
      // Frozen mid-pose. A rattle when you first catch it moving is the scare.
      if (!this.lastLit && this.moving) world.soundAt(this.pos, (v) => world.sound.rattle(v), 18);
      this.lastLit = true;
      this.freeze = 0.25;
      this.moving = false;
      this.anim.mixer.timeScale = 0;
      this.sync();
      return;
    }
    this.lastLit = false;
    if (this.freeze > 0) {
      this.freeze -= dt;
      return;
    }
    this.anim.mixer.timeScale = 1;

    const { player, dist } = this.nearestPlayer((p) => !world.level.inLift(p.pos.x, p.pos.z));
    if (this.dormant > 0) {
      this.dormant -= dt;
      if (player && dist < 11) this.dormant = 0;
      this.anim.play('idle');
    } else if (player && this.cooldown <= 0) {
      // Just under walking speed on B1, so it is relentless but beatable.
      const speed = 2.7 + 0.2 * (world.floor - 1);
      this.moveToward(player.pos.x, player.pos.z, speed, dt);
      this.anim.play('sprint', { timeScale: 0.9 });
      // Bones clatter as it runs, so you can hear it coming in the dark.
      this.rattleTimer -= dt;
      if (this.rattleTimer <= 0 && dist < 16) {
        world.soundAt(this.pos, (v) => world.sound.rattle(v * 0.6), 16);
        this.rattleTimer = 0.45;
      }
      this.tryCatch();
    } else {
      this.moving = false;
      this.anim.play('idle');
    }
    this.anim.update(dt);
    this.sync();
  }
}
