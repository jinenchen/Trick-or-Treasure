// Per-victim 3D attack shots use the very same creature asset as the pursuer.
// A separate camera/scene keeps furniture from occluding a grab and keeps the
// surviving co-op player's view live. Actors are prepared during floor loading.
import * as THREE from 'three';
import { Animator } from './assets.js';
import { disposeCreatureRig } from './entities/creature-rigs.js';

const DURATION = 1.9;
const clamp = (n) => Math.max(0, Math.min(1, n));
const ease = (n) => { const t = clamp(n); return t * t * (3 - 2 * t); };

function stageFor(monster) {
  const kind = monster.modelName;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020302);
  const camera = new THREE.PerspectiveCamera(68, 1, 0.025, 12);
  const source = monster.createVisual();
  const actor = source.object;
  actor.rotation.y = Math.PI;
  scene.add(actor);
  const animator = source.animator || new Animator(source.inner, source.animations);
  let focus = source.focus;
  if (!focus) {
    // Optional GLBs keep their own skeleton and attack clips. Use a head bone
    // when it is named; a normalized face anchor also supports static models.
    actor.traverse((node) => { if (!focus && node.isBone && /head|skull/i.test(node.name)) focus = node; });
    if (!focus) {
      focus = new THREE.Object3D();
      focus.position.set(0, monster.height * (kind === 'human-deer' ? 0.72 : 0.88), 0.12);
      actor.add(focus);
    }
  }
  scene.add(new THREE.HemisphereLight(0xaab5a2, 0x151710, 0.65));
  const key = new THREE.SpotLight(0xc7ccb1, 15, 9, 0.9, 0.85, 1.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.08;
  key.shadow.camera.far = 9;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.008;
  key.position.set(-0.65, monster.height * 0.83 - 0.35, -0.3);
  key.target = new THREE.Object3D();
  scene.add(key, key.target);
  const rim = new THREE.PointLight(0x899f91, 5, 6, 1.5);
  rim.position.set(0.8, monster.height * 0.95, 2.2);
  scene.add(rim);
  const point = new THREE.Vector3();
  const stage = { scene, camera, actor, animator, focus, key, rim, point, custom: monster.custom, inner: source.inner,
    disposeVisual: source.dispose, framing: source.design?.jumpscareFraming || {} };
  poseStage(stage, 0, false);
  return stage;
}

function poseStage(stage, elapsed, reduced) {
  const { actor, animator, focus, point, camera, key, rim, framing } = stage;
  const lunge = ease((elapsed - 0.19) / 0.23);
  const finalGrab = ease((elapsed - 1.28) / 0.19);
  const recoil = Math.exp(-Math.max(0, elapsed - 0.38) * 9) * (elapsed >= 0.38 ? 1 : 0);
  if (animator.poseJumpscare) animator.poseJumpscare(elapsed);
  else {
    // Sample the GLB's authored animation, then add the physical camera grab.
    animator.mixer.setTime(elapsed);
  }
  actor.position.set(0, 0, 0);
  actor.rotation.set(0, Math.PI, 0);
  actor.updateMatrixWorld(true);
  focus.getWorldPosition(point);
  // Frame the moving face instead of guessing from antler/body height. The
  // initial view reveals the same silhouette before it rushes into the lens.
  const faceDistance = 1.6 - lunge * 0.96 - finalGrab * 0.20 + (framing.distanceOffset || 0);
  actor.position.z = faceDistance - point.z;
  actor.position.x = -point.x * 0.7;
  actor.updateMatrixWorld(true);
  focus.getWorldPosition(point);
  const tremor = reduced ? 0 : lunge * (0.004 + recoil * 0.021);
  camera.position.set(Math.sin(elapsed * 47) * tremor, point.y + (framing.cameraHeight ?? -0.055) - (1 - lunge) * 0.27 + Math.sin(elapsed * 39) * tremor, -recoil * 0.10);
  camera.up.set(reduced ? 0 : Math.sin(elapsed * 27) * recoil * 0.055 + finalGrab * 0.075, 1, 0).normalize();
  camera.lookAt(point.x * 0.45, point.y + (framing.lookHeight ?? -0.015), point.z);
  camera.fov = 68 - lunge * 12 + recoil * (reduced ? 0 : 5);
  camera.updateProjectionMatrix();
  key.position.y = point.y + (framing.keyHeight ?? -0.25);
  key.target.position.copy(point);
  // A dying torch reveals skin and wet facial detail without a white flash.
  key.intensity = 10 + lunge * 3 - finalGrab * 6;
  rim.position.y = point.y + 0.35;
  rim.position.z = actor.position.z + 0.8;
}

export class Jumpscares {
  constructor(world) {
    this.world = world;
    this.active = new Map();
    this.stages = new Map();
  }

  key(player, monster) { return `${player.index}:${monster.modelName}:${monster.height}`; }

  prepare(monsters, players) {
    for (const player of players) for (const monster of monsters) {
      const key = this.key(player, monster);
      if (!this.stages.has(key)) {
        const stage = stageFor(monster);
        this.stages.set(key, stage);
        this.world.renderer.compile(stage.scene, stage.camera);
      }
    }
  }

  get(index) { return this.active.get(index); }

  start(player, monster) {
    if (!monster?.model || this.active.has(player.index)) return;
    const key = this.key(player, monster);
    if (!this.stages.has(key)) this.stages.set(key, stageFor(monster));
    const stage = this.stages.get(key);
    stage.animator.reset?.();
    if (stage.custom && !stage.animator.poseJumpscare) {
      const { animator } = stage;
      animator.mixer.stopAllAction();
      animator.current = null;
      animator.currentName = '';
      const attack = [...animator.actions.keys()].find(name => /attack|bite|grab|lunge|kill/i.test(name));
      animator.play(attack || 'idle', { once: !!attack, fade: 0, timeScale: 1 });
    }
    this.world.sound.init();
    this.world.sound.unlock();
    const event = {
      ...stage, player, monster, kind: monster.modelName, elapsed: 0,
      duration: DURATION, impacted: false, shock: 0, blackout: 0,
      sound: this.world.sound.ctx?.state === 'running' ? this.world.sound.beginJumpscare(monster.modelName) : null,
    };
    this.active.set(player.index, event);
    poseStage(event, 0, this.world.picture.reduced);
    return event;
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const [index, event] of this.active) {
      if (event.player.alive) { this.clear(index); continue; }
      event.elapsed += dt;
      if (event.elapsed >= event.duration) { this.clear(index); continue; }
      // A real key/click can resume Web Audio asynchronously after the catch.
      // Retry during the shot instead of permanently returning a silent handle.
      if (!event.sound && this.world.sound.ctx?.state === 'running') {
        event.sound = this.world.sound.beginJumpscare(event.kind);
        if (event.impacted) event.sound.impact();
      }
      if (!event.impacted && event.elapsed >= 0.24) {
        event.impacted = true;
        event.sound?.impact();
      }
      poseStage(event, event.elapsed, this.world.picture.reduced);
      event.shock = event.elapsed < 0.24 ? 0 : Math.exp(-(event.elapsed - 0.24) * 5);
      event.blackout = ease((event.elapsed - 1.53) / 0.28);
    }
  }

  clear(index) {
    for (const [id, event] of this.active) {
      if (index !== undefined && id !== index) continue;
      event.sound?.stop();
      this.active.delete(id);
    }
  }

  dispose() {
    this.clear();
    for (const stage of this.stages.values()) {
      if (stage.disposeVisual) stage.disposeVisual();
      else if (stage.custom) {
        stage.animator.mixer.stopAllAction();
        stage.animator.mixer.uncacheRoot(stage.inner);
        // GLB geometry, materials and textures belong to the shared asset cache.
        const skeletons = new Set();
        stage.actor.traverse(node => { if (node.isSkinnedMesh) skeletons.add(node.skeleton); });
        for (const skeleton of skeletons) skeleton.dispose();
      } else disposeCreatureRig(stage.actor);
      stage.key.dispose();
      stage.scene.clear();
    }
    this.stages.clear();
  }
}
