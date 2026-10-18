// Loads the Kenney Graveyard Kit props/interns (CC0) and optional creature GLBs,
// then hands out scaled clones. Offline enemy rigs live in entities/creature-rigs.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// Optional monster models. Drop the GLB in place and the specimen uses it;
// if the file is missing the original articulated specimen rig is used instead.
//   yaw: turn the model so it faces +Z (forward), in radians.
//   shadows: false for very heavy meshes (shadow passes redraw them).
export const CUSTOM_MODELS = {
  'blind-seeker': { file: 'assets/models/sketchfab/blind-seeker.glb', yaw: 0, shadows: true },
  bacteria: { file: 'assets/models/sketchfab/bacteria.glb', yaw: 0, shadows: false },
  'accurate-bacteria': { file: 'assets/models/sketchfab/accurate-bacteria.glb', yaw: 0, shadows: false },
  'human-deer': { file: 'assets/models/sketchfab/human-deer.glb', yaw: 0, shadows: true },
  'bacteria-pill': { file: 'assets/models/sketchfab/bacteria-pill.glb', yaw: 0, shadows: true },
  // Player model; falls back to the Kenney intern when absent.
  'business-man': { file: 'assets/models/sketchfab/business-man.glb', yaw: 0, shadows: false },
};

export const MODEL_NAMES = [
  'character-keeper',
  'pumpkin-carved', 'pumpkin-tall-carved', 'detail-chalice', 'detail-bowl', 'detail-plate',
  'candle-multiple', 'lantern-candle', 'lantern-glass', 'urn-round', 'urn-square',
  'coffin', 'coffin-old', 'gravestone-round', 'gravestone-cross', 'gravestone-broken', 'gravestone-debris',
  'pillar-small', 'pillar-square', 'column-large', 'debris', 'debris-wood', 'cross', 'cross-column',
  'altar-stone', 'bench-damaged', 'fire-basket', 'rocks', 'shovel', 'trunk',
];

const cache = new Map();   // name -> { scene, animations, size, center, minY }
let kitScale = 1;

function store(name, gltf, { yaw = 0, shadows = true, custom = false } = {}) {
  gltf.scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = shadows;
      o.receiveShadow = true;
      o.frustumCulled = !o.isSkinnedMesh;   // skinned bounds don't follow the animation
    }
  });
  const box = new THREE.Box3().setFromObject(gltf.scene);
  cache.set(name, {
    scene: gltf.scene,
    animations: gltf.animations,
    size: box.getSize(new THREE.Vector3()),
    center: box.getCenter(new THREE.Vector3()),
    minY: box.min.y,
    yaw,
    custom,
  });
}

export async function loadAssets(onProgress = () => {}) {
  const loader = new GLTFLoader();
  const jobs = [
    ...MODEL_NAMES.map((name) => ({ name, file: `assets/models/${name}.glb`, opts: {} })),
    ...Object.entries(CUSTOM_MODELS).map(([name, c]) => ({ name, file: c.file, opts: { ...c, custom: true }, optional: true })),
  ];
  let done = 0;
  await Promise.all(jobs.map((job) =>
    loader.loadAsync(job.file)
      .then((gltf) => store(job.name, gltf, job.opts))
      .catch((err) => {
        if (job.optional) console.info(`Optional model ${job.name} unavailable; the procedural specimen remains available.`);
        else console.warn(`Model ${job.name} failed to load, using a placeholder.`, err);
      })
      .finally(() => onProgress(++done / jobs.length)),
  ));
  const keeper = cache.get('character-keeper');
  // Kenney characters are chunky (big heads), so 1.55m reads as human-sized.
  kitScale = keeper ? 1.55 / keeper.size.y : 1;
}

export function hasModel(name) {
  return cache.has(name);
}

export function isCustomModel(name) {
  return !!cache.get(name)?.custom;
}

// First model in the list that actually loaded (falls back to the last one).
export function pickModel(...names) {
  return names.find(hasModel) || names[names.length - 1];
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
  // Static skinned GLBs still need independent bones for each player/attack shot.
  const inner = entry.animations.length || entry.scene.getObjectByProperty('isSkinnedMesh', true)
    ? cloneSkinned(entry.scene) : entry.scene.clone(true);
  let scale = kitScale * mul;
  if (height) scale = height / entry.size.y;
  if (maxDim) scale = maxDim / Math.max(entry.size.x, entry.size.y, entry.size.z);
  inner.scale.setScalar(scale);
  inner.position.set(-entry.center.x * scale, -entry.minY * scale, -entry.center.z * scale);
  if (entry.yaw) {
    // Turn models that weren't authored facing +Z.
    const pivot = new THREE.Group();
    pivot.rotation.y = entry.yaw;
    pivot.add(inner);
    object.add(pivot);
  } else {
    object.add(inner);
  }
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
    // Downloaded models often have one unnamed clip: use it for idle/walk/sprint.
    const standard = ['idle', 'walk', 'sprint'].some((n) => this.actions.has(n));
    this.fallback = !standard && clips.length ? clips[0].name : null;
  }

  has(name) {
    return this.actions.has(name);
  }

  play(name, { fade = 0.2, once = false, timeScale = 1 } = {}) {
    if (!this.actions.has(name) && this.fallback && !once) {
      if (name === 'idle') timeScale = 0.15;   // a slow sway reads as idling
      name = this.fallback;
    }
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
