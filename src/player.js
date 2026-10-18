// A retrieval intern: movement, flashlight, stamina, first-person camera.
import * as THREE from 'three';
import { PLAYER, FLASH, NOISE, WALL_H } from './config.js';

const EYE_H = 1.42;
const PITCH_MIN = -1.2, PITCH_MAX = 1.0;
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
    this.pitch = -0.08;
    this.bob = 0;
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
    // Your own body is hidden in your own view (see Game.render) and casts no
    // shadow, so it never blocks your flashlight.
    object.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    this.body = object;
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
    // Beam starts just past the torch in your hand, so the torch isn't lit by its own beam.
    this.flash.position.set(-0.15, EYE_H - 0.15, 0.75);
    this.flash.target.position.set(-0.15, EYE_H - 0.15, 8);
    this.flash.castShadow = true;
    this.flash.shadow.mapSize.set(512, 512);
    this.flash.shadow.camera.near = 0.2;
    this.flash.shadow.camera.far = FLASH.range;
    this.flash.shadow.bias = -0.002;
    this.group.add(this.flash, this.flash.target);

    // Faint glow around each intern so your partner is visible in the dark.
    this.fill = new THREE.PointLight(index ? 0x7f9cff : 0xffa060, 0.7, 3.5, 2);
    this.fill.position.set(0, 2.2, -0.4);
    this.group.add(this.fill);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 90);
    this.camera.layers.enable(0);
    for (let j = 0; j < 2; j++) if (j !== index) this.camera.layers.enable(10 + j);
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.camShake = 0;

    // Flashlight in your hand, on a layer only your own camera renders.
    const metal = new THREE.MeshStandardMaterial({ color: 0x4a4852, metalness: 0.5, roughness: 0.45 });
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.28, 14), metal);
    grip.rotation.x = Math.PI / 2;
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.025, 0.06, 16), metal);
    bezel.rotation.x = Math.PI / 2;
    bezel.position.z = -0.17;
    // Glowing rim at the front: tells you the light is on.
    this.lens = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.007, 6, 20), new THREE.MeshBasicMaterial({ color: 0xfff4d8 }));
    this.lens.position.z = -0.2;
    this.viewModel = new THREE.Group();
    this.viewModel.add(grip, bezel, this.lens);
    // Lower right, angled in toward the center so you see it side-on.
    this.viewModel.position.set(0.26, -0.22, -0.5);
    this.viewModel.rotation.set(0.12, 0.5, 0);
    this.viewModel.traverse((o) => o.layers.set(20 + index));
    this.camera.layers.enable(20 + index);
    this.camera.add(this.viewModel);
    world.scene.add(this.camera);

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
    this.pitch = -0.08;
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
    this.pitch -= (intent.mouseLook || 0) * PLAYER.mouseSens + (intent.look || 0) * 1.8 * dt;
    this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, this.pitch));

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
    this.bob = this.speed > 0.3 ? this.bob + dt * this.speed * 2.6 : this.bob * (1 - Math.min(1, dt * 6));

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
    // Keep the beam's origin out of walls you are standing right up against.
    let reach = 0.75;
    for (let t = 0.1; t <= 0.75; t += 0.05) {
      if (world.level.isWallAt(this.pos.x + f.x * t, this.pos.z + f.z * t)) {
        reach = Math.max(0.05, t - 0.12);
        break;
      }
    }
    this.flash.position.z = reach;
    this.flash.target.position.y = this.flash.position.y + Math.tan(this.pitch) * 8;
    const vmY = this.flashOn ? -0.22 : -0.33;
    this.viewModel.position.y += (vmY - this.viewModel.position.y) * Math.min(1, dt * 10);
    this.lens.material.color.setHex(on ? 0xfff4d8 : 0x2a2820);
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
    // Eyes, slightly forward of the body's center, with a little walking bob.
    const f = this.forwardVec(new THREE.Vector3());
    const amt = Math.min(1, this.speed / 3);
    const bobY = Math.sin(this.bob * 2) * 0.035 * amt;
    const bobX = Math.cos(this.bob) * 0.025 * amt;
    outPos.set(this.pos.x + f.x * 0.12 - f.z * bobX, EYE_H + bobY, this.pos.z + f.z * 0.12 + f.x * bobX);
    const cp = Math.cos(this.pitch);
    outLook.set(outPos.x + f.x * cp, outPos.y + Math.sin(this.pitch), outPos.z + f.z * cp);
  }

  snapCamera() {
    this.desiredCamera(this.camPos, this.camLook);
  }

  updateCamera(dt) {
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    this.desiredCamera(pos, look);
    if (this.alive) {
      // First person must be instant; only the death camera drifts.
      this.camPos.copy(pos);
      this.camLook.copy(look);
    } else {
      const k = 1 - Math.exp(-3 * dt);
      this.camPos.lerp(pos, k);
      this.camLook.lerp(look, k);
    }
    this.camera.position.copy(this.camPos);
    this.viewModel.visible = this.alive;
    if (this.camShake > 0) {
      this.camShake = Math.max(0, this.camShake - dt * 1.5);
      const s = this.camShake * 0.12;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.camLook);
  }

  dispose() {
    this.world.scene.remove(this.group);
    this.world.scene.remove(this.camera);
  }
}
