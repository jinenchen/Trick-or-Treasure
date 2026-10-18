// A retrieval intern: movement, flashlight, stamina, first-person camera.
import * as THREE from 'three';
import { PLAYER, FLASH, NOISE, WALL_H } from './config.js';

const EYE_H = 1.42;
const PITCH_MIN = -1.2, PITCH_MAX = 1.0;
import { instance, uniqueMaterials, pickModel, isCustomModel } from './assets.js';
import { PlayerAvatar } from './player-avatar.js';
import { labelTexture } from './textures.js';

export const PLAYER_COLORS = ['#c0aa83', '#99b3ad'];

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
    this.tools = { stun: 0, lure: 0 };
    this.webbedBy = null;
    this.staggerTime = 0;
    this.trapGrace = 0;
    this.carryMul = 1;
    this.stepTimer = 0;
    this.lowBatteryBeep = 0;
    this.hidingSpot = null;
    this.hidingRevealed = false;
    this.mapOpen = false;
    this.eyeHeight = EYE_H;

    this.group = new THREE.Group();
    // The supplied Sketchfab businessman, with the Kenney intern as a fallback.
    const modelName = pickModel('business-man', 'character-keeper');
    const custom = isCustomModel(modelName);
    this.modelName = modelName;
    this.standingEyeHeight = custom ? 1.62 : EYE_H;
    this.eyeHeight = this.standingEyeHeight;
    const { object, inner, animations } = instance(modelName, custom ? { height: 1.75 } : {});
    this.materials = uniqueMaterials(object);
    for (const m of this.materials) {
      if (!custom) {
        m.color?.multiply(new THREE.Color(index ? 0.60 : 0.78, 0.72, index ? 0.72 : 0.55));
        if ('roughness' in m) m.roughness = 0.94;
      }
    }
    // Each camera hides its own live body; visible teammates cast real shadows.
    object.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.body = new THREE.Group();
    this.body.add(object);
    this.rig = object;
    this.group.add(this.body);

    // Name tag that only your partner's camera can see (through walls).
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(this.name, this.color), depthTest: false, transparent: true }));
    this.marker.scale.set(0.5, 0.25, 1);
    this.marker.position.y = 2.0;
    this.marker.renderOrder = 10;
    this.marker.layers.set(10 + index);
    this.group.add(this.marker);

    this.flash = new THREE.SpotLight(FLASH.color, FLASH.intensity, FLASH.range, FLASH.angle, 0.38, 1.25);
    this.flash.map = flashlightTexture();
    // Beam starts just past the torch in your hand, so the torch isn't lit by its own beam.
    this.flash.position.set(-0.15, this.eyeHeight - 0.15, 0.75);
    this.flash.target.position.set(-0.15, this.eyeHeight - 0.15, 8);
    this.flash.castShadow = true;
    this.flash.shadow.mapSize.set(1024, 1024);
    this.flash.shadow.camera.near = 0.2;
    this.flash.shadow.camera.far = FLASH.range;
    this.flash.shadow.bias = -0.002;
    this.flash.shadow.normalBias = 0.025;
    this.group.add(this.flash, this.flash.target);

    // Faint glow around each intern so your partner is visible in the dark.
    this.fill = new THREE.PointLight(0xb7bea3, 0.32, 2.8, 2);
    this.fill.position.set(0, 2.2, -0.4);
    this.group.add(this.fill);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 90);
    this.camera.layers.enable(0);
    for (let j = 0; j < 2; j++) if (j !== index) this.camera.layers.enable(10 + j);
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.camShake = 0;

    // Flashlight in your hand, on a layer only your own camera renders.
    const metal = new THREE.MeshStandardMaterial({ color: 0x45493c, metalness: 0.62, roughness: 0.6 });
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
    const rubber = new THREE.MeshStandardMaterial({ color: 0x1d211c, roughness: 0.96 });
    for (let i = 0; i < 8; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.023, 0.003, 5, 16), rubber);
      rib.position.z = -0.09 + i * 0.025;
      this.viewModel.add(rib);
    }
    // Lower right, angled in toward the center so you see it side-on.
    this.viewModel.position.set(0.26, -0.22, -0.5);
    this.viewModel.rotation.set(0.12, 0.5, 0);
    this.viewModel.traverse((o) => o.layers.set(20 + index));
    this.camera.layers.enable(20 + index);
    this.camera.add(this.viewModel);
    world.scene.add(this.camera);

    this.avatar = new PlayerAvatar(this, { object, inner, animations, custom });
    this.anim = this.avatar.anim;
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

  get isHidden() {
    return this.alive && !!this.hidingSpot && !this.flashOn && !this.lightOn && !this.hidingRevealed;
  }

  enterHiding(spot, revealed = false) {
    if (!this.alive || this.holding || this.hidingSpot || this.webbedBy || this.staggerTime > 0 || spot.occupant) return false;
    this.hidingSpot = spot;
    spot.occupant = this;
    this.hidingRevealed = revealed;
    this.pos.copy(spot.pos);
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.bob = 0;
    this.yaw = spot.yaw;
    this.pitch = 0;
    this.eyeHeight = spot.eyeHeight;
    this.flashOn = this.lightOn = false;
    this.flash.intensity = 0;
    this.fill.visible = false;
    this.sync();
    this.snapCamera();
    return true;
  }

  leaveHiding({ force = false, relocate = true } = {}) {
    const spot = this.hidingSpot;
    if (!spot) return true;
    if (relocate) {
      const f = new THREE.Vector3(Math.sin(spot.yaw), 0, Math.cos(spot.yaw));
      const right = new THREE.Vector3(f.z, 0, -f.x);
      let exit = null;
      // Try the designated entrance, then nearby clear positions if a partner
      // is standing in the doorway. Never eject a player through a wall.
      for (const [side, forward] of [[0, 0], [-0.75, 0.3], [0.75, 0.3], [0, 0.9]]) {
        const candidate = spot.entry.clone().addScaledVector(right, side).addScaledVector(f, forward);
        const checked = candidate.clone();
        this.world.level.collideCircle(checked, PLAYER.radius);
        if (checked.distanceTo(candidate) > 0.02 || this.world.level.isWallAt(candidate.x, candidate.z)) continue;
        if (!this.world.level.lineOfSight(spot.entry.x, spot.entry.z, candidate.x, candidate.z)) continue;
        if (!force && this.world.players.some(p => p !== this && p.alive && !p.hidingSpot && p.pos.distanceTo(candidate) < PLAYER.radius * 2)) continue;
        exit = candidate;
        break;
      }
      if (!exit && !force) return false;
      this.pos.copy(exit || spot.entry);
    }
    if (spot.occupant === this) spot.occupant = null;
    this.hidingSpot = null;
    this.hidingRevealed = false;
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.eyeHeight = this.standingEyeHeight;
    this.body.scale.y = 1;
    this.marker.visible = true;
    this.sync();
    this.snapCamera();
    return true;
  }

  spawn(x, z, yaw) {
    this.webbedBy?.releaseVictim();
    this.staggerTime = this.trapGrace = 0;
    this.leaveHiding({ force: true, relocate: false });
    this.mapOpen = false;
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.bob = 0;
    this.yaw = yaw;
    this.pitch = -0.08;
    this.alive = true;
    this.stamina = this.staminaMax;
    this.battery = Math.max(this.battery, this.batteryMax * 0.6);
    this.holding = null;
    this.group.visible = true;
    this.sync();
    this.avatar.reset();
    this.avatar.update(0);
    this.snapCamera();
  }

  update(dt, intent) {
    const world = this.world;
    this.staggerTime = Math.max(0, this.staggerTime - dt);
    if (!this.alive) {
      this.lightOn = false;
      this.flash.visible = false;
      this.fill.visible = false;
      this.sync();
      this.avatar.update(dt);
      return;
    }

    this.yaw -= intent.turn * PLAYER.turnSpeed * dt;
    this.yaw -= intent.mouseTurn * PLAYER.mouseSens;
    this.pitch -= (intent.mouseLook || 0) * PLAYER.mouseSens + (intent.look || 0) * 1.8 * dt;
    this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, this.pitch));
    if (this.hidingSpot?.kind === 'locker') {
      const base = this.hidingSpot.yaw;
      const relative = Math.atan2(Math.sin(this.yaw - base), Math.cos(this.yaw - base));
      this.yaw = base + Math.max(-0.65, Math.min(0.65, relative));
      this.pitch = Math.max(-0.45, Math.min(0.45, this.pitch));
    }

    const f = this.forwardVec(new THREE.Vector3());
    const right = new THREE.Vector3(-f.z, 0, f.x);
    const move = new THREE.Vector3()
      .addScaledVector(f, intent.forward * (intent.forward < 0 ? PLAYER.backMul : 1))
      .addScaledVector(right, intent.strafe);
    if (move.lengthSq() > 1) move.normalize();
    if (this.hidingSpot || this.webbedBy || this.staggerTime > 0) move.set(0, 0, 0);
    const moving = move.lengthSq() > 0.01;

    const sprinting = intent.sprint && moving && !this.mapOpen && !this.hidingSpot && intent.forward >= 0 && !this.exhausted && this.stamina > 0;
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
    const mul = (1 + 0.06 * world.upgrades.cardio) * this.carryMul * (this.mapOpen ? 0.45 : 1);
    const desired = move.multiplyScalar(base * mul);
    if (this.webbedBy || this.staggerTime > 0) this.vel.set(0, 0, 0);
    this.vel.lerp(desired, 1 - Math.exp(-12 * dt));
    const px = this.pos.x, pz = this.pos.z;
    this.pos.addScaledVector(this.vel, dt);
    if (this.hidingSpot) {
      this.pos.copy(this.hidingSpot.pos);
      this.vel.set(0, 0, 0);
    } else if (world.level.collideCircle(this.pos, PLAYER.radius) && dt > 0) {
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
      if (this.hidingSpot) world.emitNoise(this.pos.x, this.pos.z, 2.5, 'flash');
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
    this.flash.position.y = this.eyeHeight - 0.15;
    this.flash.target.position.y = this.flash.position.y + Math.tan(this.pitch) * 8;
    const vmY = this.mapOpen ? -0.6 : this.flashOn ? -0.22 : -0.33;
    this.viewModel.position.y += (vmY - this.viewModel.position.y) * Math.min(1, dt * 10);
    this.lens.material.color.setHex(on ? 0xfff4d8 : 0x2a2820);
    this.fill.visible = !this.hidingSpot;
    this.marker.visible = !this.hidingSpot;
    this.body.scale.setScalar(1);
    this.sync();
    this.avatar.update(dt);
  }

  sync() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }

  kill() {
    this.webbedBy?.releaseVictim();
    this.leaveHiding({ force: true });
    this.mapOpen = false;
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
    outPos.set(this.pos.x + f.x * 0.12 - f.z * bobX, this.eyeHeight + bobY, this.pos.z + f.z * 0.12 + f.x * bobX);
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
    this.webbedBy?.releaseVictim();
    this.leaveHiding({ force: true, relocate: false });
    this.world.scene.remove(this.group);
    this.world.scene.remove(this.camera);
    this.avatar.dispose();
    const skeletons = new Set();
    this.rig.traverse((node) => { if (node.isSkinnedMesh) skeletons.add(node.skeleton); });
    for (const skeleton of skeletons) skeleton.dispose();
    this.flash.map.dispose();
    this.flash.dispose();
    this.marker.material.map.dispose();
    this.marker.material.dispose();
    for (const m of this.materials) m.dispose();
    const materials = new Set();
    this.viewModel.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      materials.add(o.material);
    });
    for (const m of materials) m.dispose();
  }
}

// Uneven reflector rings and a soft hotspot, projected into the real geometry.
function flashlightTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const pixels = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const dx = (x - 127.5) / 128, dy = (y - 127.5) / 128;
    const radius = Math.hypot(dx, dy);
    const rings = Math.sin(radius * 65) * 0.025 + Math.sin(radius * 117) * 0.012;
    const hotspot = 0.65 + 0.35 * Math.exp(-radius * radius * 9);
    const edge = 1 - Math.min(1, Math.max(0, (radius - 0.68) / 0.32));
    const v = Math.round(255 * Math.max(0, Math.min(1, (hotspot + rings) * edge)));
    const i = (y * 256 + x) * 4;
    pixels.data[i] = v; pixels.data[i + 1] = v; pixels.data[i + 2] = v; pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return new THREE.CanvasTexture(canvas);
}
