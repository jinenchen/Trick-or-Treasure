// Fragile cursed loot (REPO-style): value drops when it hits walls,
// heavy items need both interns, deposit everything at the lift.
import * as THREE from 'three';
import { NOISE } from './config.js';
import { instance } from './assets.js';
import { glowTexture } from './textures.js';

export const LOOT_TYPES = [
  { id: 'bowl', name: 'Offering Bowl', model: 'detail-bowl', size: 0.42, value: [35, 60], fragility: 1.0, weight: 3 },
  { id: 'plate', name: 'Silver Plate', model: 'detail-plate', size: 0.5, value: [45, 75], fragility: 1.3, weight: 3 },
  { id: 'chalice', name: 'Cursed Chalice', model: 'detail-chalice', size: 0.45, value: [70, 110], fragility: 1.2, weight: 3 },
  { id: 'candles', name: 'Black Candelabra', model: 'candle-multiple', size: 0.6, value: [60, 95], fragility: 1.0, weight: 2 },
  { id: 'pumpkin', name: 'Grinning Pumpkin', model: 'pumpkin-carved', size: 0.6, value: [85, 135], fragility: 0.8, weight: 3 },
  { id: 'jack', name: "Jack's Head", model: 'pumpkin-tall-carved', size: 0.72, value: [110, 165], fragility: 0.9, weight: 2 },
  { id: 'lantern', name: 'Spirit Lantern', model: 'lantern-candle', size: 0.62, value: [120, 180], fragility: 1.6, weight: 2 },
  { id: 'urn', name: 'Ash Urn', model: 'urn-round', size: 0.75, value: [150, 230], fragility: 1.9, weight: 2 },
  { id: 'urn2', name: 'Ancestral Urn', model: 'urn-square', size: 0.8, value: [170, 250], fragility: 1.7, weight: 1 },
  { id: 'coffin', name: "The Count's Coffin", model: 'coffin', size: 2.0, value: [420, 600], fragility: 0.7, weight: 1, heavy: true },
  { id: 'sarcophagus', name: 'Rotten Sarcophagus', model: 'coffin-old', size: 2.0, value: [340, 500], fragility: 0.8, weight: 1, heavy: true },
];

export const SOUL_TYPE = { id: 'soul', name: 'Soul Jar', model: 'lantern-glass', size: 0.55, value: [0, 0], fragility: 0, soul: true };

const GRAVITY = 20;
let glintMat = null;

export class Item {
  constructor(world, type, pos, rng) {
    this.world = world;
    this.type = type;
    this.baseValue = type.soul ? 0 : Math.round(rng.range(type.value[0], type.value[1]) / 5) * 5;
    this.hp = 100;
    this.pos = pos.clone();
    this.pos.y = 0;
    this.vel = new THREE.Vector3();
    this.lastVel = new THREE.Vector3();
    this.yaw = rng.range(0, Math.PI * 2);
    this.holders = [];
    this.hitCooldown = 0;
    this.inLiftTime = 0;
    this.depositing = 0;
    this.gone = false;
    this.owner = null;          // soul jars: whose soul this is
    this.stolenBy = null;

    this.group = new THREE.Group();
    const { object } = instance(type.model, { maxDim: type.size });
    this.group.add(object);
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    this.radius = type.heavy ? 0.55 : Math.min(0.45, Math.max(0.18, Math.max(size.x, size.z) / 2));
    this.height = size.y;

    if (!glintMat) {
      glintMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffe6a8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    }
    this.glint = new THREE.Sprite(glintMat.clone());
    this.glint.position.y = Math.min(1.2, this.height + 0.15);
    this.glint.scale.setScalar(0.4);
    this.glintPhase = rng.range(0, 10);
    this.group.add(this.glint);

    if (type.soul) {
      this.soulLight = new THREE.PointLight(0x9fffe0, 2.5, 5, 2);
      this.soulLight.position.y = 0.4;
      this.group.add(this.soulLight);
      this.glint.material.color.set(0x9fffe0);
    }

    world.scene.add(this.group);
    this.sync();
  }

  get value() {
    if (this.hp <= 0) return 0;
    return Math.round(this.baseValue * (this.hp / 100));
  }

  get heavy() {
    return !!this.type.heavy;
  }

  // Speed multiplier for whoever carries this; a lone intern drags heavy things at a crawl.
  get carrySpeed() {
    if (!this.heavy) return 0.92;
    return this.holders.length > 1 ? 0.72 : 0.4;
  }

  // Where the item wants to be while carried.
  holdTarget(out) {
    const hs = this.holders;
    if (this.heavy) {
      out.set(0, 0, 0);
      for (const h of hs) {
        const f = h.forwardVec(new THREE.Vector3());
        out.x += h.pos.x + f.x * 1.1;
        out.z += h.pos.z + f.z * 1.1;
      }
      out.x /= hs.length;
      out.z /= hs.length;
      out.y = hs.length > 1 ? 0.55 : 0.18;   // a lone intern can only drag it
      return out;
    }
    const h = hs[0];
    const f = h.forwardVec(new THREE.Vector3());
    // Held out in front, low, so it sits at the bottom of the first-person view
    // and mostly outside the flashlight's hot spot.
    const reach = h.avatar?.carryDistance ?? 1.15;
    return out.set(h.pos.x + f.x * reach, 0.72 - this.height * 0.3, h.pos.z + f.z * reach);
  }

  update(dt) {
    const world = this.world;
    if (this.gone) return;
    if (this.stolenBy) {
      this.stolenBy.lootAnchor(this.pos);
      this.vel.set(0, 0, 0);
      this.glint.material.opacity = 0.5;
      this.sync();
      return;
    }
    if (this.depositing > 0) {
      this.depositing -= dt;
      const k = Math.max(0, this.depositing / 0.7);
      this.group.scale.setScalar(k);
      this.group.position.y = -0.4 * (1 - k);
      if (this.depositing <= 0) world.finishDeposit(this);
      return;
    }
    this.hitCooldown -= dt;
    const startX = this.pos.x, startZ = this.pos.z;

    if (this.holders.length) {
      const target = this.holdTarget(new THREE.Vector3());
      const desired = target.sub(this.pos).multiplyScalar(14);
      if (desired.length() > 14) desired.setLength(14);
      this.vel.lerp(desired, 1 - Math.exp(-18 * dt));
      this.pos.addScaledVector(this.vel, dt);
      // Turn with the carrier.
      const lead = this.holders[0];
      this.yaw += Math.atan2(Math.sin(lead.yaw - this.yaw), Math.cos(lead.yaw - this.yaw)) * (1 - Math.exp(-8 * dt));
      // Too far from a carrier (stuck behind a wall, or heavy carriers split up) -> drop.
      for (const h of [...this.holders]) {
        const d = Math.hypot(h.pos.x - this.pos.x, h.pos.z - this.pos.z);
        if (d > (this.heavy ? 2.6 : 2.0)) {
          world.release(h);
          this.damage(12, 'yanked');
        }
      }
    } else {
      this.vel.y -= GRAVITY * dt;
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y <= 0) {
        // Setting something down from carry height is safe; real falls are not.
        if (this.vel.y < -3) {
          world.sound.thud(Math.min(1, -this.vel.y / 8));
          world.emitNoise(this.pos.x, this.pos.z, NOISE.drop, 'drop');
        }
        if (this.vel.y < -6.5) this.damage((-this.vel.y - 6) * 7, 'dropped');
        this.pos.y = 0;
        this.vel.y = 0;
        const fr = Math.exp(-7 * dt);
        this.vel.x *= fr;
        this.vel.z *= fr;
      }
    }

    // Walls are the enemy of fragile loot. Impact speed is how fast the item
    // actually moved last frame, so resting against a wall is free but
    // walking or swinging it into one is not.
    const n = world.level.collideCircle(this.pos, this.radius, false);
    if (n) {
      const impact = Math.min(8, -(this.lastVel.x * n.x + this.lastVel.z * n.z));
      if (impact > 2.2 && this.hitCooldown <= 0) {
        this.damage((impact - 1.4) * 7, 'wall');
        this.hitCooldown = 0.4;
      }
      const into = -(this.vel.x * n.x + this.vel.z * n.z);
      if (into > 0) {
        this.vel.x += n.x * into;
        this.vel.z += n.z * into;
      }
    }

    if (dt > 0) this.lastVel.set((this.pos.x - startX) / dt, 0, (this.pos.z - startZ) / dt);

    // Glint so loot is findable in the dark.
    const t = world.time + this.glintPhase;
    const pulse = Math.max(0, Math.sin(t * 1.7)) ** 6;
    this.glint.material.opacity = this.holders.length ? 0 : (this.type.soul ? 0.8 : 0.15 + 0.85 * pulse);
    this.glint.scale.setScalar((this.type.soul ? 0.6 : 0.25) + 0.35 * pulse);
    if (this.soulLight) this.soulLight.intensity = 2 + Math.sin(world.time * 4) * 0.8;
    this.sync();
  }

  damage(amount, cause) {
    if (this.type.soul || this.hp <= 0 || amount <= 0) return;
    const grip = 1 - 0.2 * this.world.upgrades.grip;
    const lone = this.heavy && this.holders.length === 1 ? 1.5 : 1;
    const before = this.value;
    this.hp -= amount * this.type.fragility * grip * lone;
    const lost = before - this.value;
    if (this.hp <= 0) {
      this.hp = 0;
      this.world.shatterItem(this, before);
      return;
    }
    if (lost > 0) this.world.itemDamaged(this, lost, cause);
  }

  sync() {
    if (this.depositing > 0) return;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }

  dispose() {
    this.stolenBy?.dropTreasure();
    this.gone = true;
    this.world.scene.remove(this.group);
    this.glint.material.dispose();
  }
}

// Spread loot over the floor so the total is comfortably above quota.
export function spawnLoot(world, rng, quota) {
  const items = [];
  // Small loot alone covers the quota with room for breakage; coffins are a bonus.
  const target = quota * 1.9;
  let total = 0;
  const bag = [];
  for (const t of LOOT_TYPES) for (let i = 0; i < t.weight; i++) bag.push(t);
  const heavyCount = 1 + Math.min(2, Math.floor(world.floor / 2));
  for (let i = 0; i < heavyCount; i++) {
    const t = rng.pick(LOOT_TYPES.filter((l) => l.heavy));
    const p = world.level.takeSpot(rng, { minLiftDist: 18, farthest: i === 0, interior: true });
    if (!p) break;
    items.push(new Item(world, t, p, rng));
  }
  let guard = 0;
  while (total < target && guard++ < 80) {
    const t = rng.pick(bag.filter((l) => !l.heavy));
    const p = world.level.takeSpot(rng, { minLiftDist: 6 });
    if (!p) break;
    const it = new Item(world, t, p, rng);
    items.push(it);
    total += it.baseValue;
  }
  return items;
}
