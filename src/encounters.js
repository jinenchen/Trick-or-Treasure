// Optional rewards and readable, nonfatal mechanical hazards. Placement uses a
// separate seed, reserves spawn cells, and keeps doorways and hideouts clear.
import * as THREE from 'three';
import { CELL } from './config.js';
import { makeRng } from './rng.js';
import { Item, LOOT_TYPES } from './loot.js';
import { rustTexture, hazardTexture, textTexture } from './textures.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const TELEGRAPH = 0.55;
const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));

export function chestTimberTexture() {
  const rng = makeRng(0x574f4f44);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#655d46'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1300; i++) {
    ctx.strokeStyle = rng.chance(0.6) ? `rgba(20,24,16,${rng.range(0.04, 0.22)})` : 'rgba(171,154,110,0.12)';
    ctx.lineWidth = rng.range(0.5, 2);
    const y = rng.range(0, 256), x = rng.range(-20, 200);
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + 30, y + rng.range(-4, 4), x + 70, y + rng.range(-4, 4), x + rng.range(70, 250), y);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(12,19,11,0.45)';
  for (let y = 0; y < 256; y += 64) ctx.fillRect(0, y, 256, 2);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return map;
}

// Reusable visual for the awakened mimic rig. Supply the same material names
// and a meshFactory(geometry, material, parent, x, y, z) with your own ownership.
export function makeChestVisual(materials, meshFactory) {
  const group = new THREE.Group();
  const { wood, metal, dark, lining, label } = materials;
  const box = (w, h, d, material, x, y, z, parent = group) => meshFactory(new THREE.BoxGeometry(w, h, d), material, parent, x, y, z);
  box(1.06, 0.075, 0.68, dark, 0, 0.07, 0);
  box(0.96, 0.04, 0.58, lining, 0, 0.12, 0);
  for (const sx of [-1, 1]) box(0.06, 0.43, 0.68, wood, sx * 0.5, 0.325, 0);
  for (const sz of [-1, 1]) {
    for (let row = 0; row < 3; row++) box(0.99, 0.135, 0.055, wood, 0, 0.185 + row * 0.14, sz * 0.315);
    for (const sx of [-1, 1]) {
      box(0.075, 0.45, 0.026, metal, sx * 0.34, 0.32, sz * 0.35);
      box(0.09, 0.43, 0.03, dark, sx * 0.49, 0.32, sz * 0.35);
      for (const y of [0.16, 0.42]) {
        const bolt = meshFactory(new THREE.SphereGeometry(0.019, 6, 5), metal, group, sx * 0.34, y, sz * 0.368);
        bolt.scale.z = 0.45;
      }
    }
  }
  for (const sx of [-1, 1]) {
    const handle = meshFactory(new THREE.TorusGeometry(0.07, 0.013, 5, 10, Math.PI), metal, group, sx * 0.54, 0.34, 0);
    handle.rotation.y = Math.PI / 2;
  }
  const lid = new THREE.Group();
  lid.position.set(0, 0.54, -0.34);
  group.add(lid);
  for (let i = 0; i < 7; i++) {
    const t = (i + 0.5) / 7;
    const y = 0.04 + Math.sin(t * Math.PI) * 0.15, z = t * 0.68;
    const angle = -Math.atan(Math.cos(t * Math.PI) * 0.15 * Math.PI / 0.68);
    box(1.06, 0.045, 0.115, wood, 0, y, z, lid).rotation.x = angle;
    for (const sx of [-1, 1]) box(0.075, 0.028, 0.115, metal, sx * 0.34, y + 0.032, z, lid).rotation.x = angle;
  }
  // End panels keep the curved cover solid when viewed from the side.
  const cheekShape = new THREE.Shape();
  cheekShape.moveTo(0, 0);
  for (let i = 0; i <= 12; i++) cheekShape.lineTo(i / 12 * 0.68, 0.04 + Math.sin(i / 12 * Math.PI) * 0.15);
  cheekShape.lineTo(0.68, 0); cheekShape.closePath();
  for (const sx of [-1, 1]) {
    const cheek = meshFactory(new THREE.ShapeGeometry(cheekShape), wood, lid, sx * 0.52, 0, 0);
    cheek.rotation.y = -Math.PI / 2;
    cheek.material.side = THREE.DoubleSide;
  }
  for (const x of [-0.34, 0.34]) {
    box(0.11, 0.08, 0.06, metal, x, 0.54, -0.35);
    const hinge = meshFactory(new THREE.CylinderGeometry(0.023, 0.023, 0.14, 7), dark, group, x, 0.55, -0.38);
    hinge.rotation.z = Math.PI / 2;
  }
  const latch = new THREE.Group(); latch.position.set(0, 0.48, 0.365); group.add(latch);
  box(0.075, 0.19, 0.025, metal, 0, 0, 0, latch);
  const shackle = meshFactory(new THREE.TorusGeometry(0.035, 0.009, 5, 10, Math.PI), dark, latch, 0, -0.03, 0.025);
  shackle.rotation.z = 0;
  box(0.085, 0.065, 0.045, metal, 0, -0.08, 0.025, latch);
  if (label) meshFactory(new THREE.PlaneGeometry(0.31, 0.075), label, group, 0, 0.21, 0.348);
  const contents = new THREE.Group(); group.add(contents);
  box(0.34, 0.18, 0.3, lining, -0.2, 0.23, 0, contents);
  box(0.27, 0.22, 0.26, lining, 0.19, 0.25, -0.04, contents);
  return { group, lid, latch, contents };
}

export class Encounters {
  constructor(world) {
    this.world = world;
    this.level = world.level;
    this.rng = makeRng(this.level.seed ^ 0x454e4354);
    this.chests = [];
    this.traps = [];
    this.group = new THREE.Group(); this.group.name = 'floor-encounters';
    this.geometries = new Set(); this.materials = new Set(); this.textures = new Set();
    this.colliders = new Set(); this.reserved = new Set();
    this.immunity = new Map();
    this.generated = false;
    this.disposed = false;
    world.scene.add(this.group);
  }

  material(options) {
    const material = new THREE.MeshStandardMaterial(options);
    this.materials.add(material);
    for (const value of Object.values(options)) if (value?.isTexture) this.textures.add(value);
    return material;
  }

  mesh(geometry, material, parent, x = 0, y = 0, z = 0) {
    this.geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  box(w, h, d, material, parent, x = 0, y = 0, z = 0) {
    return this.mesh(new THREE.BoxGeometry(w, h, d), material, parent, x, y, z);
  }

  reserve(cell) {
    const key = cell.y * this.level.W + cell.x;
    this.level.occupied.add(key); this.reserved.add(key);
  }

  generate() {
    if (this.generated || this.disposed) return;
    this.generated = true;
    this.surfaces = {
      wood: this.material({ map: chestTimberTexture(), color: 0x6f624a, roughness: 0.93 }),
      metal: this.material({ map: rustTexture(), color: 0x999b87, roughness: 0.72, metalness: 0.6 }),
      dark: this.material({ color: 0x252b22, roughness: 0.88, metalness: 0.45 }),
      lining: this.material({ color: 0x393e2d, roughness: 1 }),
      label: this.material({ map: textTexture('SEALED', { color: '#bcb69a', font: 'bold 45px monospace' }), transparent: true, depthWrite: false, roughness: 1 }),
      hazard: this.material({ map: hazardTexture(), color: 0xb4af8c, roughness: 0.95 }),
    };
    const perimeter = [], interior = [];
    for (const room of this.level.rooms) {
      if (!room.index) continue;
      for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) {
        const key = y * this.level.W + x;
        if (this.level.occupied.has(key) || this.level.liftField[key] * CELL < 9) continue;
        const pos = this.level.cellCenter(x, y);
        if (this.level.hidingSpots.some((spot) => pos.distanceTo(spot.pos) < 3.1 || pos.distanceTo(spot.entry) < 2.1)) continue;
        const walls = DIRS.filter(([dx, dz]) => this.level.isWallCell(x + dx, y + dz));
        let nearDoor = false;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dz;
          const outside = xx < room.x || xx >= room.x + room.w || yy < room.y || yy >= room.y + room.h;
          if (outside && !this.level.isWallCell(xx, yy)) nearDoor = true;
        }
        if (nearDoor) continue;
        const cell = { x, y, pos, room, distance: this.level.liftField[key] * CELL };
        if (walls.length) perimeter.push({ ...cell, wall: walls[0], corner: walls.length > 1 });
        if (!walls.length) interior.push(cell);
      }
    }
    this.rng.shuffle(perimeter);
    // The closest supply chest teaches both gadgets before riskier caches.
    perimeter.sort((a, b) => a.distance - b.distance || Number(a.corner) - Number(b.corner));
    const kinds = ['supply', 'valuable', 'cache', 'mimic'];
    for (const kind of kinds) {
      let pool = perimeter.filter((cell) => !this.level.occupied.has(cell.y * this.level.W + cell.x)
        && this.chests.every((chest) => chest.pos.distanceTo(cell.pos) > 3.5));
      // Compact seeds still get all four chests. Neighboring perimeter cells
      // remain safe: the 1.06m shell is narrower than their 2.5m spacing.
      if (!pool.length) pool = perimeter.filter((cell) => !this.level.occupied.has(cell.y * this.level.W + cell.x)
        && this.chests.every((chest) => chest.pos.distanceTo(cell.pos) > 2.1));
      const chosen = kind === 'supply' ? pool[0] : this.rng.pick(pool);
      if (!chosen) continue;
      this.reserve(chosen);
      this.chests.push(this.buildChest(chosen, kind));
    }
    this.rng.shuffle(interior);
    for (const kind of ['arrow', 'spikes', 'snare']) {
      const cell = interior.find((candidate) => !this.level.occupied.has(candidate.y * this.level.W + candidate.x)
        && this.chests.every((chest) => chest.pos.distanceTo(candidate.pos) > 3)
        && this.traps.every((trap) => trap.pos.distanceTo(candidate.pos) > 3.6));
      if (!cell) continue;
      this.reserve(cell);
      this.traps.push(this.buildTrap(cell, kind));
    }
  }

  buildChest(cell, kind) {
    const visual = makeChestVisual(this.surfaces, this.mesh.bind(this));
    const [dx, dz] = cell.wall;
    const pos = cell.pos.clone().add(new THREE.Vector3(dx * 0.88, 0, dz * 0.88));
    const yaw = Math.atan2(-dx, -dz);
    visual.group.position.copy(pos); visual.group.rotation.y = yaw;
    visual.group.name = 'sealed-chest'; this.group.add(visual.group);
    const collider = { x: pos.x, z: pos.z, r: 0.50 };
    this.level.obstacles.push(collider); this.colliders.add(collider);
    return { ...visual, pos, yaw, kind, opened: false, age: 0, collider, roomIndex: cell.room.index, reward: kind === 'cache' ? this.rng.pick(['valuable', 'stun', 'lure']) : kind };
  }

  buildTrap(cell, kind) {
    const group = new THREE.Group(); group.name = `trap-${kind}`; group.position.copy(cell.pos);
    this.group.add(group);
    const { metal, dark, hazard } = this.surfaces;
    const indicator = this.material({ color: 0x746649, emissive: 0x9b4516, emissiveIntensity: 0.11, roughness: 0.65, metalness: 0.35 });
    const trap = { kind, pos: cell.pos.clone(), group, yaw: 0, state: 'armed', disarmed: false, timer: 0, age: 0, radius: kind === 'snare' ? 0.66 : 0.78, indicator, spikes: null, jaws: [], bolts: [], launcherDistance: 0 };
    this.box(1.0, 0.045, 0.95, dark, group, 0, 0.025, 0);
    const plate = new THREE.Group(); plate.position.y = 0.055; group.add(plate); trap.plate = plate;
    this.box(0.82, 0.025, 0.77, metal, plate);
    for (const x of [-0.44, 0.44]) this.box(0.055, 0.012, 0.87, hazard, group, x, 0.055, 0);
    for (const x of [-0.38, 0.38]) for (const z of [-0.34, 0.34]) this.mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.012, 6), dark, plate, x, 0.022, z);
    this.box(0.15, 0.035, 0.12, indicator, group, 0.31, 0.075, -0.30);
    const mechanism = new THREE.Group(); mechanism.position.set(0.40, 0.06, 0.3); group.add(mechanism);
    this.box(0.18, 0.10, 0.18, dark, mechanism);
    const pin = this.mesh(new THREE.TorusGeometry(0.045, 0.01, 5, 10), metal, mechanism, 0, 0.105, 0);
    pin.rotation.x = Math.PI / 2;
    trap.pin = pin;
    if (kind === 'spikes') {
      const spikes = new THREE.Group(); spikes.position.y = -0.8; group.add(spikes); trap.spikes = spikes;
      for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
        this.mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.42, 7), metal, spikes, x * 0.24, 0.25, z * 0.24);
        this.mesh(new THREE.ConeGeometry(0.061, 0.37, 7), metal, spikes, x * 0.24, 0.64, z * 0.24);
        // Black sockets make the untriggered hazard identifiable at a distance.
        const socket = this.mesh(new THREE.CircleGeometry(0.069, 10), dark, plate, x * 0.24, 0.015, z * 0.24);
        socket.rotation.x = -Math.PI / 2;
      }
    } else if (kind === 'snare') {
      for (const side of [-1, 1]) {
        const jaw = new THREE.Group(); jaw.position.set(0, 0.1, side * 0.04); group.add(jaw);
        const arch = this.mesh(new THREE.TorusGeometry(0.36, 0.035, 6, 14, Math.PI), metal, jaw);
        arch.rotation.x = side * Math.PI / 2;
        for (let i = 0; i < 7; i++) {
          const a = (i + 0.5) / 7 * Math.PI;
          const tooth = this.mesh(new THREE.ConeGeometry(0.028, 0.11, 5), metal, jaw, Math.cos(a) * 0.34, 0.03, side * Math.sin(a) * 0.34);
          tooth.rotation.x = -side * 0.38;
        }
        trap.jaws.push({ mesh: jaw, side });
      }
      for (let i = 0; i < 6; i++) {
        const link = this.mesh(new THREE.TorusGeometry(0.035, 0.009, 5, 8), dark, group, -0.48 - i * 0.065, 0.035, 0.18);
        link.rotation.x = i % 2 ? 0 : Math.PI / 2;
      }
    } else {
      // Find a real wall for the launcher; bolts travel from its visible ports.
      let wall = null;
      for (const [dx, dz] of DIRS) for (let distance = 1; distance <= 6; distance++) {
        if (!this.level.isWallCell(cell.x + dx * distance, cell.y + dz * distance)) continue;
        if (!wall || distance < wall.distance) wall = { dx, dz, distance };
        break;
      }
      if (wall) {
        trap.yaw = Math.atan2(-wall.dx, -wall.dz); group.rotation.y = trap.yaw;
        trap.launcherDistance = (wall.distance - 0.5) * CELL - 0.08;
      } else trap.launcherDistance = CELL;
      this.box(0.47, 0.38, 0.19, metal, group, 0, 0.69, -trap.launcherDistance);
      this.box(0.39, 0.29, 0.035, dark, group, 0, 0.69, -trap.launcherDistance + 0.11);
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * 0.12;
        const port = this.mesh(new THREE.TorusGeometry(0.033, 0.009, 5, 8), metal, group, x, 0.69, -trap.launcherDistance + 0.135);
        const bolt = new THREE.Group(); bolt.position.set(x, 0.69, -trap.launcherDistance + 0.18); group.add(bolt);
        const shaft = this.mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6), metal, bolt);
        shaft.rotation.x = Math.PI / 2;
        const head = this.mesh(new THREE.ConeGeometry(0.033, 0.11, 5), dark, bolt, 0, 0, 0.25);
        head.rotation.x = Math.PI / 2;
        bolt.visible = false; trap.bolts.push(bolt);
        port.castShadow = false;
      }
      // Thin service cable visually links the plate to its wall mechanism.
      const cable = this.mesh(new THREE.CylinderGeometry(0.011, 0.011, trap.launcherDistance, 5), dark, group, 0.44, 0.028, -trap.launcherDistance / 2);
      cable.rotation.x = Math.PI / 2;
    }
    return trap;
  }

  candidate(player) {
    if (this.disposed || !player.alive || player.hidingSpot || player.isHidden || player.holding || player.mapOpen) return null;
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    let best = null, closest = Infinity;
    const consider = (target, label, kind, action) => {
      const dx = target.pos.x - player.pos.x, dz = target.pos.z - player.pos.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 2 || distance >= closest) return;
      const facing = distance > 0.01 ? (dx * fx + dz * fz) / distance : 1;
      if (distance > 0.6 && facing < 0.3) return;
      if (!this.level.lineOfSight(player.pos.x, player.pos.z, target.pos.x, target.pos.z)) return;
      closest = distance;
      best = { pos: target.pos, label, kind, action, target };
    };
    for (const chest of this.chests) if (!chest.opened) consider(chest, 'sealed chest', 'chest', 'Open');
    for (const trap of this.traps) if (!trap.disarmed && trap.state !== 'firing') {
      consider(trap, trap.kind === 'arrow' ? 'arrow plate' : trap.kind === 'spikes' ? 'spike plate' : 'jaw trap', 'trap', 'Disarm');
    }
    return best;
  }

  interact(player) {
    const candidate = this.candidate(player);
    if (!candidate) return false;
    if (candidate.kind === 'trap') this.disarm(candidate.target, player);
    else this.openChest(candidate.target, player);
    return true;
  }

  localSound(pos, callback, range = 16) {
    this.world.soundAt(pos, callback, range);
  }

  removeCollider(chest) {
    if (!chest.collider) return;
    const index = this.level.obstacles.indexOf(chest.collider);
    if (index >= 0) this.level.obstacles.splice(index, 1);
    this.colliders.delete(chest.collider); chest.collider = null;
  }

  openChest(chest, player) {
    if (chest.opened) return;
    chest.opened = true; chest.age = 0;
    chest.latch.rotation.x = 0.55;
    this.localSound(chest.pos, (volume) => this.world.sound.rattle(volume * 0.7));
    this.world.emitNoise(chest.pos.x, chest.pos.z, 7, 'chest');
    if (chest.kind === 'mimic') {
      this.removeCollider(chest);
      chest.group.visible = false;
      this.world.awakenMimic(chest);
      return;
    }
    player.tools ||= { stun: 0, lure: 0 };
    if (chest.reward === 'supply') {
      player.tools.stun++; player.tools.lure++;
      this.world.hud.popup(player.index, '+1 STUN / +1 LURE', 'cash');
    } else if (chest.reward === 'stun' || chest.reward === 'lure') {
      player.tools[chest.reward] += 2;
      this.world.hud.popup(player.index, `+2 ${chest.reward.toUpperCase()}`, 'cash');
    } else {
      const type = this.rng.pick(LOOT_TYPES.filter((entry) => !entry.heavy && ['chalice', 'lantern', 'urn'].includes(entry.id)));
      const drop = chest.pos.clone().add(new THREE.Vector3(Math.sin(chest.yaw) * 0.95, 0, Math.cos(chest.yaw) * 0.95));
      this.level.collideCircle(drop, 0.3, false);
      const item = new Item(this.world, type, drop, this.rng);
      // A chest contains bonus value beyond the quota's ordinary floor loot.
      item.baseValue = Math.round(item.baseValue * 1.4 / 5) * 5;
      this.world.items.push(item);
      this.world.hud.popup(player.index, `${type.name.toUpperCase()}  $${item.value}`, 'cash');
      this.world.fx.sparkle(drop, 0xc9bb82);
    }
  }

  disarm(trap, player) {
    if (trap.disarmed) return;
    trap.disarmed = true; trap.state = 'disarmed'; trap.timer = 0;
    trap.indicator.color.set(0x6a8370);
    trap.indicator.emissive.set(0x234a2c); trap.indicator.emissiveIntensity = 0.45;
    trap.pin.rotation.x = 0; trap.pin.position.y = 0.16;
    this.localSound(trap.pos, (volume) => this.world.sound.click(volume));
    this.world.hud.popup(player.index, 'TRAP DISARMED', 'cash');
  }

  canTrigger(player, trap) {
    return player.alive && !player.hidingSpot && !player.isHidden
      && Math.hypot(player.pos.x - trap.pos.x, player.pos.z - trap.pos.z) < trap.radius
      && this.level.lineOfSight(player.pos.x, player.pos.z, trap.pos.x, trap.pos.z);
  }

  hit(player, trap) {
    if ((this.immunity.get(player) || 0) > 0) return;
    this.immunity.set(player, 2.4);
    player.trapGrace = Math.max(player.trapGrace || 0, 1.6);
    player.staggerTime = Math.max(player.staggerTime || 0, trap.kind === 'snare' ? 1.05 : 0.8);
    player.camShake = Math.max(player.camShake || 0, 0.24);
    player.stamina = Math.max(0, player.stamina - 18);
    const hadLoot = !!player.holding;
    if (player.holding) {
      const item = player.holding;
      this.world.release(player);
      item.damage(trap.kind === 'snare' ? 9 : 14, 'trap');
    }
    this.world.hud.popup(player.index, trap.kind === 'snare' ? 'CAUGHT YOUR BOOT — MOVE!' : hadLoot ? 'TRAP! LOOT DROPPED' : 'TRAP! STAGGERED', 'loss');
  }

  fire(trap) {
    trap.state = 'firing'; trap.timer = 0.85; trap.age = 0;
    for (const player of this.world.players) if (this.canTrigger(player, trap)) this.hit(player, trap);
    this.localSound(trap.pos, (volume) => {
      this.world.sound.thud(volume * 0.7);
      this.world.sound.noiseBurst({ dur: 0.18, freq: trap.kind === 'arrow' ? 2100 : 950, vol: volume * 0.13, type: 'bandpass' });
    }, 23);
    this.world.emitNoise(trap.pos.x, trap.pos.z, 15, 'trap');
  }

  update(dt) {
    if (this.disposed) return;
    for (const player of this.world.players) player.trapGrace = Math.max(0, (player.trapGrace || 0) - dt);
    for (const [player, remaining] of this.immunity) {
      if (remaining <= dt) this.immunity.delete(player); else this.immunity.set(player, remaining - dt);
    }
    for (const chest of this.chests) {
      if (!chest.opened || chest.kind === 'mimic') continue;
      chest.age += dt;
      chest.lid.rotation.x += (-1.35 - chest.lid.rotation.x) * (1 - Math.exp(-5 * dt));
      if (chest.age > 0.65) chest.contents.visible = false;
    }
    for (const trap of this.traps) {
      trap.age += dt;
      if (trap.state === 'armed' && this.world.players.some((player) => this.canTrigger(player, trap))) {
        trap.state = 'primed'; trap.timer = TELEGRAPH;
        this.localSound(trap.pos, (volume) => this.world.sound.rattle(volume * 0.33), 9);
        for (const player of this.world.players) if (this.canTrigger(player, trap)) this.world.hud.popup(player.index, 'CLICK — GET OFF THE PLATE!', 'hint');
      } else if (trap.state === 'primed') {
        trap.timer -= dt;
        if (trap.timer <= 0) this.fire(trap);
      } else if (trap.state === 'firing' || trap.state === 'cooldown') {
        trap.timer -= dt;
        if (trap.timer <= 0) {
          trap.state = trap.state === 'firing' ? 'cooldown' : 'armed';
          trap.timer = trap.state === 'cooldown' ? 2.8 : 0;
        }
      }
      const primed = trap.state === 'primed', firing = trap.state === 'firing';
      trap.plate.position.y += ((primed || firing ? 0.032 : 0.055) - trap.plate.position.y) * (1 - Math.exp(-16 * dt));
      if (!trap.disarmed) trap.indicator.emissiveIntensity = primed ? 1.6 + Math.sin(trap.age * 24) * 0.5 : firing ? 0.9 : 0.11;
      if (trap.spikes) {
        const target = firing ? 0.02 : -0.8;
        trap.spikes.position.y += (target - trap.spikes.position.y) * (1 - Math.exp(-(firing ? 38 : 8) * dt));
      }
      for (const { mesh, side } of trap.jaws) {
        const target = firing ? -side * 1.16 : 0;
        mesh.rotation.x += (target - mesh.rotation.x) * (1 - Math.exp(-(firing ? 35 : 5) * dt));
      }
      for (const bolt of trap.bolts) {
        bolt.visible = firing && trap.age < 0.32;
        if (bolt.visible) bolt.position.z = -trap.launcherDistance + 0.18 + (trap.launcherDistance + 1.6) * clamp(trap.age / 0.3);
      }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.world.scene.remove(this.group);
    for (const collider of this.colliders) {
      const index = this.level.obstacles.indexOf(collider);
      if (index >= 0) this.level.obstacles.splice(index, 1);
    }
    for (const key of this.reserved) this.level.occupied.delete(key);
    for (const material of this.materials) material.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const map of this.textures) map.dispose();
    this.colliders.clear(); this.reserved.clear(); this.immunity.clear();
  }
}
