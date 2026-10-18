// A retrieval intern: movement, flashlight, stamina, third-person camera.
import * as THREE from 'three';
import { PLAYER, FLASH, NOISE, WALL_H } from './config.js';
import { instance, uniqueMaterials, Animator } from './assets.js';
import { labelTexture } from './textures.js';

export const PLAYER_COLORS = ['#ff9a3c', '#8fc7ff'];

const tmp = new THREE.Vector3();

export class Player {
  constructor(index, world) {
    this.index = index;
    this.world = world;
    this.name = `P${index + 1}`;
    this.color = PLAYER_COLORS[index];
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.alive = true;
    this.stamina = PLAYER.staminaMax;
    this.battery = PLAYER.batteryMax;
    this.flashOn = true;
    this.lightOn = true;        // flashlight actually emitting this frame
    this.flicker = 0;           // 0..1, set by nearby ghosts
    this.exhausted = false;
    this.holding = null;
    this.carryMul = 1;
    this.stepTimer = 0;
    this.lowBatteryBeep = 0;

    this.group = new THREE.Group();
    const { object, inner, animations } = instance('character-keeper');
    this.materials = uniqueMaterials(object);
    if (index === 1) {
      for (const m of this.materials) m.color.multiply(new THREE.Color(0.7, 0.85, 1.4));
    }
    this.opacity = 1;
    this.camDist = 3;
    this.group.add(object);
    this.anim = new Animator(inner, animations);
    this.anim.play('idle');

    // Name tag that only your partner's camera can see (through walls).
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(this.name, this.color), depthTest: false, transparent: true }));
    this.marker.scale.set(0.5, 0.25, 1);
    this.marker.position.y = 2.0;
    this.marker.renderOrder = 10;
    this.marker.layers.set(10 + index);
    this.group.add(this.marker);

    this.flash = new THREE.SpotLight(FLASH.color, FLASH.intensity, FLASH.range, FLASH.angle, 0.45, 1.25);
    this.flash.position.set(0.15, 1.3, 0.3);
    this.flash.target.position.set(0.15, 0.55, 7);
    this.flash.castShadow = true;
    this.flash.shadow.mapSize.set(512, 512);
    this.flash.shadow.camera.near = 0.2;
    this.flash.shadow.camera.far = FLASH.range;
    this.flash.shadow.bias = -0.002;
    this.group.add(this.flash, this.flash.target);

    // Dim fill light so you can always see your own intern.
    this.fill = new THREE.PointLight(index ? 0x7f9cff : 0xffa060, 1.2, 4.5, 2);
    this.fill.position.set(0, 2.4, -0.8);
    this.group.add(this.fill);

    this.camera = new THREE.PerspectiveCamera(68, 1, 0.08, 90);
    this.camera.layers.enable(0);
    for (let j = 0; j < 2; j++) if (j !== index) this.camera.layers.enable(10 + j);
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.camShake = 0;

    world.scene.add(this.group);
  }

  get forward() {
    return tmp.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  forwardVec(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  get batteryMax() {
    return PLAYER.batteryMax * (1 + 0.4 * this.world.upgrades.battery);
  }

  get staminaMax() {
    return PLAYER.staminaMax * (1 + 0.35 * this.world.upgrades.cardio);
  }

  spawn(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.alive = true;
    this.stamina = this.staminaMax;
    this.battery = Math.max(this.battery, this.batteryMax * 0.6);
    this.holding = null;
    this.group.visible = true;
    this.anim.play('idle', { fade: 0 });
    this.sync();
    this.snapCamera();
  }

  update(dt, intent) {
    const world = this.world;
    if (!this.alive) {
      this.lightOn = false;
      this.flash.visible = false;
      this.fill.visible = false;
      this.anim.update(dt);
      this.sync();
      return;
    }

    this.yaw -= intent.turn * PLAYER.turnSpeed * dt;
    this.yaw -= intent.mouseTurn * PLAYER.mouseSens;

    const f = this.forwardVec(new THREE.Vector3());
    const right = new THREE.Vector3(-f.z, 0, f.x);
    const move = new THREE.Vector3()
      .addScaledVector(f, intent.forward * (intent.forward < 0 ? PLAYER.backMul : 1))
      .addScaledVector(right, intent.strafe);
    if (move.lengthSq() > 1) move.normalize();
    const moving = move.lengthSq() > 0.01;

    const sprinting = intent.sprint && moving && intent.forward >= 0 && !this.exhausted && this.stamina > 0;
    if (sprinting) {
      this.stamina -= PLAYER.staminaDrain * dt;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.exhausted = true;
      }
    } else {
      this.stamina = Math.min(this.staminaMax, this.stamina + PLAYER.staminaRegen * dt);
      if (this.exhausted && this.stamina > this.staminaMax * 0.35) this.exhausted = false;
    }

    const base = sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    const mul = (1 + 0.06 * world.upgrades.cardio) * this.carryMul;
    const desired = move.multiplyScalar(base * mul);
    this.vel.lerp(desired, 1 - Math.exp(-12 * dt));
    const px = this.pos.x, pz = this.pos.z;
    this.pos.addScaledVector(this.vel, dt);
    if (world.level.collideCircle(this.pos, PLAYER.radius) && dt > 0) {
      // Pressing into a wall is not moving: keep only the velocity that happened.
      this.vel.x = (this.pos.x - px) / dt;
      this.vel.z = (this.pos.z - pz) / dt;
    }
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // Footsteps make noise; sprinting makes a lot.
    if (this.speed > 0.4) {
      this.stepTimer -= dt * this.speed;
      if (this.stepTimer <= 0) {
        this.stepTimer = 1.25;
        const loud = this.speed > PLAYER.walkSpeed * 1.15;
        world.emitNoise(this.pos.x, this.pos.z, loud ? NOISE.sprint : NOISE.walk, loud ? 'sprint' : 'walk', this);
        world.sound.footstep(1, loud);
      }
    }

    // Flashlight.
    if (intent.flashPressed) {
      this.flashOn = !this.flashOn;
      world.sound.flashClick();
    }
    if (world.level.inLift(this.pos.x, this.pos.z)) {
      this.battery = Math.min(this.batteryMax, this.battery + PLAYER.batteryRecharge * dt);
    } else if (this.flashOn) {
      this.battery = Math.max(0, this.battery - PLAYER.batteryDrain * dt);
    }
    const frac = this.battery / this.batteryMax;
    let on = this.flashOn && this.battery > 0;
    let intensity = FLASH.intensity * (0.55 + 0.45 * Math.min(1, frac * 3));
    const flickerChance = Math.max(this.flicker * 0.5, frac < 0.12 ? 0.25 : 0);
    if (on && Math.random() < flickerChance * dt * 30) on = false;
    if (on && frac < 0.12) {
      this.lowBatteryBeep -= dt;
      if (this.lowBatteryBeep <= 0) {
        world.sound.lowBattery();
        this.lowBatteryBeep = 2.5;
      }
    }
    this.lightOn = on;
    this.flash.visible = true;
    this.flash.intensity = on ? intensity : 0;
    this.fill.visible = true;

    // Animation.
    const holding = !!this.holding;
    if (this.speed > PLAYER.walkSpeed * 1.2) this.anim.play('sprint', { timeScale: this.speed / 5 });
    else if (this.speed > 0.3) this.anim.play('walk', { timeScale: Math.max(0.6, this.speed / 2.6) });
    else this.anim.play(holding && this.anim.has('holding-both') ? 'holding-both' : 'idle');
    this.anim.update(dt);
    this.sync();
  }

  sync() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }

  kill() {
    this.alive = false;
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.lightOn = false;
    this.camShake = 1;
    this.anim.play('die', { once: true, fade: 0.1 });
  }

  // ---------- camera ----------

  desiredCamera(outPos, outLook) {
    const level = this.world.level;
    if (!this.alive) {
      const focus = this.world.deathFocus(this);
      outLook.set(focus.x, 0.4, focus.z);
      let cz = focus.z + 1.4;
      if (level.isWallAt(focus.x, cz)) cz = focus.z + 0.3;
      outPos.set(focus.x, WALL_H - 0.35, cz);
      return;
    }
    const f = this.forwardVec(new THREE.Vector3());
    const head = new THREE.Vector3(this.pos.x, 1.45, this.pos.z);
    const want = 3.7;
    let dist = want;
    for (let t = 0.3; t <= want; t += 0.1) {
      const x = head.x - f.x * t, z = head.z - f.z * t;
      if (level.isWallAt(x + 0.22, z + 0.22) || level.isWallAt(x - 0.22, z - 0.22) ||
          level.isWallAt(x + 0.22, z - 0.22) || level.isWallAt(x - 0.22, z + 0.22)) {
        dist = Math.max(0.35, t - 0.15);
        break;
      }
    }
    // Pushed in close by a wall: rise up and look over the intern's head.
    const close = 1 - dist / want;
    const height = Math.min(WALL_H - 0.25, 2.3 + 0.8 * close);
    outPos.set(head.x - f.x * dist, height, head.z - f.z * dist);
    outLook.set(head.x + f.x * 3.5, 1.0 - 0.3 * close, head.z + f.z * 3.5);
    this.camDist = dist;
  }

  snapCamera() {
    this.desiredCamera(this.camPos, this.camLook);
  }

  updateCamera(dt) {
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    this.desiredCamera(pos, look);
    const k = 1 - Math.exp(-(this.alive ? 16 : 3) * dt);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    if (this.camShake > 0) {
      this.camShake = Math.max(0, this.camShake - dt * 1.5);
      const s = this.camShake * 0.12;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.camLook);
  }

  // Fade the model when your own camera is jammed up behind it.
  setOpacity(a) {
    if (Math.abs(a - this.opacity) < 0.01) return;
    const wasOpaque = this.opacity >= 1;
    this.opacity = a;
    for (const m of this.materials) {
      m.opacity = a;
      if (wasOpaque !== a >= 1) {
        m.transparent = a < 1;
        m.depthWrite = a >= 1;
        m.needsUpdate = true;
      }
    }
  }

  ownViewOpacity() {
    return this.alive ? Math.min(1, Math.max(0.2, (this.camDist - 0.8) / 1.2)) : 1;
  }

  dispose() {
    this.world.scene.remove(this.group);
  }
}
