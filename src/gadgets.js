// Limited chest-found tools: a directed stun discharge and a thrown sound lure.
import * as THREE from 'three';

export class Gadgets {
  constructor(world) { this.world = world; this.decoys = []; this.effects = []; this.nextUse = new Map(); }

  available(player, kind) {
    if (!player.alive || player.hidingSpot || player.mapOpen || player.staggerTime > 0) return false;
    if ((this.nextUse.get(player.index) || 0) > this.world.time) return false;
    if (!player.tools[kind]) {
      this.world.hud.popup(player.index, `No ${kind === 'stun' ? 'stun charges' : 'decoys'} · search chests`, 'hint');
      this.world.sound.click();
      return false;
    }
    return true;
  }

  useStun(player) {
    if (!this.available(player, 'stun')) return false;
    const world = this.world;
    const origin = new THREE.Vector3(player.pos.x, player.eyeHeight, player.pos.z);
    const direction = new THREE.Vector3(Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), Math.cos(player.yaw) * Math.cos(player.pitch));
    let chosen = player.webbedBy || null, score = Infinity, impact = null;
    for (const monster of world.monsters) {
      if (player.webbedBy && monster !== player.webbedBy) continue;
      const point = new THREE.Vector3(monster.pos.x, monster.constructor.id === 'spider' ? 2.65 : Math.max(0.35, monster.height * 0.65), monster.pos.z);
      const delta = point.clone().sub(origin), distance = delta.length();
      const aim = distance > 0.01 ? delta.dot(direction) / distance : 1;
      if (monster !== player.webbedBy && (distance > 8 || aim < 0.80)) continue;
      if (!world.level.lineOfSight(origin.x, origin.z, point.x, point.z)) continue;
      const value = distance - aim * 2;
      if (monster === player.webbedBy || value < score) { chosen = monster; impact = point; score = value; }
    }
    if (!chosen) {
      world.hud.popup(player.index, 'Aim at a creature within 8 metres', 'hint');
      return false;
    }
    impact ||= new THREE.Vector3(chosen.pos.x, 2.65, chosen.pos.z);
    player.tools.stun--;
    this.nextUse.set(player.index, world.time + 0.65);
    chosen.stun(4.5);
    const geometry = new THREE.BufferGeometry().setFromPoints([origin, origin.clone().lerp(impact, 0.5).add(new THREE.Vector3(0.07, 0.04, 0)), impact]);
    const material = new THREE.LineBasicMaterial({ color: 0xc5e8df, transparent: true, opacity: 0.95, depthWrite: false });
    const beam = new THREE.Line(geometry, material);
    world.scene.add(beam);
    this.effects.push({ mesh: beam, life: 0.18 });
    world.fx.ring(impact.x, impact.z, 0.8, 0xb0dbd0, 0.5);
    world.sound.noiseBurst({ dur: 0.16, freq: 2400, slideTo: 500, type: 'bandpass', q: 2, vol: 0.15 });
    world.sound.tone({ freq: 145, slideTo: 43, type: 'sawtooth', dur: 0.18, vol: 0.10, cutoff: 1400 });
    world.emitNoise(player.pos.x, player.pos.z, 10, 'stun', player);
    world.hud.popup(player.index, 'STUNNED · 4.5 seconds', 'cash');
    return true;
  }

  useLure(player) {
    if (!this.available(player, 'lure') || player.webbedBy) return false;
    const world = this.world, level = world.level;
    const start = new THREE.Vector3(player.pos.x, player.eyeHeight - 0.15, player.pos.z);
    const target = new THREE.Vector3(player.pos.x, 0.11, player.pos.z);
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    // Stop the throw before the first wall; noise must originate in real space.
    for (let distance = 0.3; distance <= 6; distance += 0.2) {
      const x = player.pos.x + fx * distance, z = player.pos.z + fz * distance;
      if (level.isWallAt(x, z)) break;
      target.set(x, 0.11, z);
    }
    if (level.inLift(target.x, target.z) || start.distanceTo(target) < 1.4) {
      world.hud.popup(player.index, 'Throw into an open hallway', 'hint');
      return false;
    }
    player.tools.lure--;
    this.nextUse.set(player.index, world.time + 0.65);
    const group = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 8), new THREE.MeshStandardMaterial({ color: 0x747966, metalness: 0.65, roughness: 0.55 }));
    shell.rotation.z = Math.PI / 2;
    const diode = new THREE.Mesh(new THREE.SphereGeometry(0.023, 6, 4), new THREE.MeshBasicMaterial({ color: 0xc2d78f }));
    diode.position.set(0, 0.055, 0.055);
    group.add(shell, diode);
    group.position.copy(start);
    world.scene.add(group);
    this.decoys.push({ group, diode, start, pos: target, age: 0, duration: 7, pulse: 0 });
    world.sound.click();
    world.hud.popup(player.index, 'Decoy thrown · keep moving', 'hint');
    return true;
  }

  update(dt) {
    const world = this.world;
    for (const item of [...this.effects]) {
      item.life -= dt;
      item.mesh.material.opacity = Math.max(0, item.life / 0.18);
      if (item.life <= 0) { this.disposeMesh(item.mesh); this.effects.splice(this.effects.indexOf(item), 1); }
    }
    for (const decoy of [...this.decoys]) {
      decoy.age += dt;
      const flight = Math.min(1, decoy.age / 0.65);
      decoy.group.position.copy(decoy.start).lerp(decoy.pos, flight);
      decoy.group.position.y += Math.sin(flight * Math.PI) * 0.7;
      decoy.group.rotation.z = flight * 7;
      decoy.diode.visible = Math.sin(decoy.age * 14) > 0;
      if (flight === 1) {
        decoy.pulse -= dt;
        if (decoy.pulse <= 0) {
          decoy.pulse = 0.85;
          world.emitNoise(decoy.pos.x, decoy.pos.z, 18, 'decoy');
          world.soundAt(decoy.pos, volume => {
            world.sound.tone({ freq: 980, slideTo: 740, dur: 0.16, vol: volume * 0.12, type: 'triangle' });
            world.sound.noiseBurst({ dur: 0.05, freq: 1600, vol: volume * 0.07 });
          }, 18);
          for (const monster of world.monsters) {
            const distance = Math.hypot(monster.pos.x - decoy.pos.x, monster.pos.z - decoy.pos.z);
            if (distance < 15 && !monster.isStunned) monster.distract(decoy.pos, 1.3);
          }
        }
      }
      if (decoy.age >= decoy.duration) {
        this.disposeMesh(decoy.group);
        this.decoys.splice(this.decoys.indexOf(decoy), 1);
      }
    }
  }

  disposeMesh(mesh) {
    this.world.scene.remove(mesh);
    mesh.traverse(node => { node.geometry?.dispose(); node.material?.dispose(); });
  }

  clear() {
    for (const effect of this.effects) this.disposeMesh(effect.mesh);
    for (const decoy of this.decoys) this.disposeMesh(decoy.group);
    this.effects = []; this.decoys = []; this.nextUse.clear();
  }
}
