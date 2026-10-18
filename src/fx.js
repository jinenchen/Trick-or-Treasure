// Short-lived 3D effects: shards, noise rings, deposit sparkles.
import * as THREE from 'three';
import { glowTexture } from './textures.js';

const shardGeo = new THREE.TetrahedronGeometry(0.06);
const ringGeo = new THREE.RingGeometry(0.94, 1, 56);
let glowTex = null;

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.parts = [];
  }

  shards(pos, color = 0xc9b48a, count = 16) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(shardGeo, mat);
      m.position.set(pos.x, pos.y + 0.4, pos.z);
      m.castShadow = true;
      this.scene.add(m);
      this.parts.push({
        obj: m, life: 1.6 + Math.random(), kind: 'shard', mat,
        vel: new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5),
        spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
      });
    }
  }

  ring(x, z, radius, color = 0xffffff, opacity = 0.35) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(ringGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.04, z);
    m.scale.setScalar(0.2);
    this.scene.add(m);
    this.parts.push({ obj: m, life: 0.9, max: 0.9, kind: 'ring', radius, mat, opacity });
  }

  sparkle(pos, color = 0xffd36b, count = 14) {
    if (!glowTex) glowTex = glowTexture();
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.position.set(pos.x + (Math.random() - 0.5) * 1.2, 0.2 + Math.random() * 0.5, pos.z + (Math.random() - 0.5) * 1.2);
      s.scale.setScalar(0.25 + Math.random() * 0.25);
      this.scene.add(s);
      this.parts.push({ obj: s, life: 1 + Math.random() * 0.6, max: 1.6, kind: 'sparkle', mat, vel: new THREE.Vector3(0, 1.5 + Math.random() * 1.5, 0) });
    }
  }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.kind === 'shard') {
        p.vel.y -= 18 * dt;
        p.obj.position.addScaledVector(p.vel, dt);
        if (p.obj.position.y < 0.03) {
          p.obj.position.y = 0.03;
          p.vel.multiplyScalar(0.4);
          p.vel.y = Math.abs(p.vel.y) * 0.3;
        }
        p.obj.rotation.x += p.spin.x * dt;
        p.obj.rotation.y += p.spin.y * dt;
      } else if (p.kind === 'ring') {
        const k = 1 - p.life / p.max;
        p.obj.scale.setScalar(0.2 + (p.radius - 0.2) * Math.sqrt(k));
        p.mat.opacity = p.opacity * (1 - k);
      } else if (p.kind === 'sparkle') {
        p.obj.position.addScaledVector(p.vel, dt);
        p.mat.opacity = Math.max(0, p.life / p.max);
      }
      if (p.life <= 0) {
        this.scene.remove(p.obj);
        if (p.kind !== 'shard') p.mat.dispose();
        this.parts.splice(i, 1);
      }
    }
  }

  clear() {
    for (const p of this.parts) this.scene.remove(p.obj);
    this.parts = [];
  }
}
