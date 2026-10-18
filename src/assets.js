// Loads the Kenney Graveyard Kit models (CC0) and hands out scaled clones.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export const MODEL_NAMES = [
  'character-keeper', 'character-skeleton', 'character-zombie', 'character-ghost',
  'pumpkin-carved', 'pumpkin-tall-carved', 'detail-chalice', 'detail-bowl', 'detail-plate',
  'candle-multiple', 'lantern-candle', 'lantern-glass', 'urn-round', 'urn-square',
  'coffin', 'coffin-old', 'gravestone-round', 'gravestone-cross', 'gravestone-broken', 'gravestone-debris',
  'pillar-small', 'pillar-square', 'column-large', 'debris', 'debris-wood', 'cross', 'cross-column',
  'altar-stone', 'bench-damaged', 'fire-basket', 'rocks', 'shovel', 'trunk',
];

const cache = new Map();   // name -> { scene, animations, size, center, minY }
let kitScale = 1;

export async function loadAssets(onProgress = () => {}) {
  const loader = new GLTFLoader();
  let done = 0;
  await Promise.all(MODEL_NAMES.map((name) =>
    loader.loadAsync(`assets/models/${name}.glb`)
      .then((gltf) => {
        gltf.scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        const box = new THREE.Box3().setFromObject(gltf.scene);
        cache.set(name, {
          scene: gltf.scene,
          animations: gltf.animations,
          size: box.getSize(new THREE.Vector3()),
          center: box.getCenter(new THREE.Vector3()),
          minY: box.min.y,
        });
      })
      .catch((err) => console.warn(`Model ${name} failed to load, using a placeholder.`, err))
      .finally(() => onProgress(++done / MODEL_NAMES.length)),
  ));
  const keeper = cache.get('character-keeper');
  // Kenney characters are chunky (big heads), so 1.55m reads as human-sized.
  kitScale = keeper ? 1.55 / keeper.size.y : 1;
}

export function modelSize(name) {
  const entry = cache.get(name);
  return entry ? entry.size.clone().multiplyScalar(kitScale) : new THREE.Vector3(0.5, 0.5, 0.5);
}

// Returns { object, inner, animations }. `object` is a wrapper whose origin sits
// at the model's feet (bottom center). Scale options (pick one):
//   height: target height in meters, maxDim: target largest dimension,
//   mul: multiplier on the kit-wide scale (default 1).
export function instance(name, { height, maxDim, mul = 1 } = {}) {
  const entry = cache.get(name);
  const object = new THREE.Group();
  object.name = name;
  if (!entry) {
    const s = maxDim || height || 0.6;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(s * 0.6, s, s * 0.6),
      new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.8 }),
    );
    mesh.position.y = s / 2;
    mesh.castShadow = true;
    object.add(mesh);
    return { object, inner: mesh, animations: [] };
  }
  const inner = entry.animations.length ? cloneSkinned(entry.scene) : entry.scene.clone(true);
  let scale = kitScale * mul;
  if (height) scale = height / entry.size.y;
  if (maxDim) scale = maxDim / Math.max(entry.size.x, entry.size.y, entry.size.z);
  inner.scale.setScalar(scale);
  inner.position.set(-entry.center.x * scale, -entry.minY * scale, -entry.center.z * scale);
  object.add(inner);
  return { object, inner, animations: entry.animations };
}

// Clone every material under `root` so it can be tinted/faded independently.
export function uniqueMaterials(root) {
  const seen = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const swap = (m) => {
      if (!seen.has(m)) seen.set(m, m.clone());
      return seen.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  return [...seen.values()];
}

// Small wrapper around AnimationMixer with cross-fading by clip name.
export class Animator {
  constructor(inner, clips) {
    this.mixer = new THREE.AnimationMixer(inner);
    this.actions = new Map();
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.current = null;
    this.currentName = '';
  }

  has(name) {
    return this.actions.has(name);
  }

  play(name, { fade = 0.2, once = false, timeScale = 1 } = {}) {
    const next = this.actions.get(name);
    if (!next) return;
    next.timeScale = timeScale;
    if (this.currentName === name) return;
    next.reset();
    if (once) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
    }
    next.play();
    if (this.current) this.current.crossFadeTo(next, fade, false);
    this.current = next;
    this.currentName = name;
  }

  update(dt) {
    this.mixer.update(dt);
  }
}
