// Animation/lifecycle adapter for the supplied spider asset. Every caller owns
// its cloned skeleton/mixer; imported geometry, materials and maps stay cached.
import * as THREE from 'three';

const clean = name => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
const finite = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const STATES = { perched: 'idle', feeding: 'feeding', walk: 'walk', stunned: 'stunned' };
const PATTERNS = {
  idle: [/^(idle|rest|perched|breathing)$/, /idle|rest|perch/],
  walk: [/^(walk|crawl|walking)$/, /walk|crawl|locomotion|run/],
  attack: [/^(attack|bite|strike)$/, /attack|bite|strike|melee/],
  capture: [/^(capture|grab|web)$/, /capture|grab|web/],
  feeding: [/^(feeding|feed|chew)$/, /feeding|feed|chew/],
  release: [/^(release|retreat|recover)$/, /release|retreat|recover/],
  stunned: [/^(stun|stunned|hit|hurt)$/, /stun|hurt/],
};

function remember(node) {
  return { position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() };
}

export class SpiderAnimator {
  constructor(inner, clips, { attackImpactTime = 0.28 } = {}) {
    this.inner = inner;
    this.mixer = new THREE.AnimationMixer(inner);
    this.actions = new Map();
    this.clips = new Map();
    this.rest = new Map();
    this.bones = [];
    inner.traverse(node => {
      this.rest.set(node, remember(node));
      if (node.isBone) this.bones.push(node);
    });
    for (const clip of clips) {
      this.clips.set(clip.name, clip);
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    }
    for (const [alias, patterns] of Object.entries(PATTERNS)) {
      let clip;
      for (const pattern of patterns) {
        clip = clips.find(entry => pattern.test(clean(entry.name)));
        if (clip) break;
      }
      if (clip) {
        this.clips.set(alias, clip);
        this.actions.set(alias, this.actions.get(clip.name));
      }
    }
    for (const [alias, source] of [['sprint', 'walk'], ['attack-melee-right', 'attack'], ['capture', 'attack'], ['feeding', 'idle'], ['stunned', 'idle']]) {
      if (!this.actions.has(alias) && this.actions.has(source)) {
        this.actions.set(alias, this.actions.get(source));
        this.clips.set(alias, this.clips.get(source));
      }
    }
    this.legs = [];
    for (const side of ['L', 'R']) for (let index = 1; index <= 4; index++) {
      const prefix = clean(`SpiderLeg${side}${index}`);
      const upper = this.bones.find(node => clean(node.name) === prefix + 'upper');
      const mid = this.bones.find(node => clean(node.name) === prefix + 'mid');
      const foot = this.bones.find(node => clean(node.name) === prefix + 'foot');
      if (upper && mid && foot) this.legs.push({ side, index, upper, mid, foot });
    }
    this.attackImpactTime = attackImpactTime;
    this.current = null; this.currentName = '';
    this.state = 'perched'; this.loopName = 'idle';
    this.transition = null; this.shot = null; this.disposed = false;
    this.diagnostics = {
      clipMap: Object.fromEntries(Object.keys(PATTERNS).map(name => [name, this.clips.get(name)?.name || null])),
      sourceClips: clips.map(clip => clip.name), legCount: this.legs.length, boneCount: this.bones.length,
    };
    this.reset();
  }

  has(name) { return this.actions.has(name); }

  restore() {
    for (const [node, rest] of this.rest) {
      node.position.copy(rest.position); node.quaternion.copy(rest.quaternion); node.scale.copy(rest.scale);
    }
  }

  reset() {
    if (this.disposed) return;
    this.mixer.stopAllAction(); this.mixer.timeScale = 1;
    this.restore();
    this.current = null; this.currentName = '';
    this.transition = this.shot = null;
    this.state = 'perched'; this.loopName = 'idle';
    this.activate('idle', { fade: 0 });
    this.mixer.update(0);
  }

  activate(name, { fade = 0.14, once = false, timeScale = 1, restart = false } = {}) {
    const action = this.actions.get(name);
    if (!action || this.disposed) return false;
    const speed = finite(timeScale);
    const loop = once ? THREE.LoopOnce : THREE.LoopRepeat;
    if (this.current === action && !restart && action.loop === loop && !(action.paused && !once)) {
      this.currentName = name;
      action.setEffectiveTimeScale(speed);
      return true;
    }
    const previous = this.current;
    action.reset(); action.enabled = true;
    action.setEffectiveWeight(1); action.setEffectiveTimeScale(speed);
    action.setLoop(loop, once ? 1 : Infinity);
    action.clampWhenFinished = once;
    action.play();
    if (previous && previous !== action) {
      if (fade > 0) previous.crossFadeTo(action, fade, false);
      else previous.stop();
    }
    this.current = action; this.currentName = name;
    if (once && name !== 'stunned') {
      this.transition = { name, action, remaining: this.clips.get(name).duration / Math.max(0.001, speed) };
    }
    return true;
  }

  setState(state) {
    if (this.disposed || this.shot) return;
    const changed = state !== this.state;
    this.state = state;
    if (state === 'capture' || state === 'release') {
      if (!changed) return;
      this.loopName = state === 'capture' ? 'feeding' : 'idle';
      this.transition = null;
      if (!this.activate(state, { once: true, restart: true })) this.activate(this.loopName);
      return;
    }
    if (state === 'stunned') {
      if (changed) this.transition = null;
      this.loopName = 'stunned';
      this.activate('stunned', { once: true, restart: changed });
      return;
    }
    this.loopName = STATES[state] || 'idle';
    // A frame's normal feeding/perch update must not truncate the capture or
    // release action that began immediately before it.
    if (!this.transition) this.activate(this.loopName);
  }

  play(name, options = {}) {
    if (this.disposed || this.shot) return;
    if (name === 'stunned') { this.setState('stunned'); return; }
    if (name === 'capture' || name === 'release') { this.setState(name); return; }
    if (name === 'attack' || name === 'attack-melee-right') {
      this.transition = null;
      this.activate(name, { ...options, once: true, restart: true });
      return;
    }
    this.loopName = name;
    // A lure can make a released spider crawl away immediately.
    if ((name === 'walk' || name === 'sprint') && this.transition?.name === 'release') this.transition = null;
    if (this.transition) return;
    this.activate(name, options);
  }

  update(dt) {
    if (this.disposed || this.shot) return;
    const step = finite(dt), scaled = step * finite(this.mixer.timeScale);
    this.mixer.update(step);
    if (this.transition) {
      this.transition.remaining -= scaled;
      if (this.transition.remaining <= 0) {
        this.transition = null;
        this.activate(this.loopName, { fade: 0.12 });
      }
    }
  }

  poseJumpscare(elapsed) {
    if (this.disposed) return;
    const t = Math.min(1.9, finite(elapsed));
    if (!this.shot || t < this.shot.elapsed) {
      this.mixer.stopAllAction(); this.restore();
      this.current = null; this.currentName = ''; this.transition = null;
      const name = ['attack', 'capture', 'walk', 'idle'].find(key => this.has(key));
      if (!name) return;
      this.activate(name, { once: true, fade: 0, restart: true });
      this.transition = null;
      this.shot = { elapsed: 0, action: this.current, clip: this.clips.get(name) };
    }
    const { action, clip } = this.shot;
    const impact = Math.min(this.attackImpactTime, clip.duration * 0.65);
    // Align the source bite with the shared .24-second impact sound. The final
    // pose is clamped rather than looping an attack back through its bind pose.
    const sample = Math.min(clip.duration - 0.00001, t <= 0.24 ? t / 0.24 * impact : impact + (t - 0.24));
    action.enabled = true; action.paused = false;
    action.setEffectiveTimeScale(1);
    this.mixer.setTime(Math.max(0, sample));
    this.shot.elapsed = t;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.inner);
    this.transition = this.shot = null;
  }
}

export function adaptSpiderRig(source, { height = 0.68, attackImpactTime = 0.28 } = {}) {
  const { object, inner, animations = [] } = source;
  const animator = new SpiderAnimator(inner, animations, { attackImpactTime });
  let walkSpeed;
  inner.traverse(node => {
    const speed = node.userData?.walkMetersPerSecond;
    if (Number.isFinite(speed) && speed > 0) walkSpeed = speed;
  });
  if (walkSpeed) animator.walkMetersPerSecond = walkSpeed * Math.abs(inner.scale.x);
  object.updateMatrixWorld(true);
  const marker = inner.getObjectByName('SpiderFace');
  const focus = new THREE.Object3D(); focus.name = 'spider-attack-focus';
  if (marker) marker.add(focus);
  else {
    const head = animator.bones.find(node => /spiderhead|cephalothorax|head/i.test(node.name));
    const parent = head || object;
    parent.add(focus);
    if (!head) focus.position.set(0, height * 0.55, height * 0.42);
  }
  const bounds = new THREE.Box3().setFromObject(object, true);
  const face = focus.getWorldPosition(new THREE.Vector3());
  const frontClearance = Math.max(height * 0.12, bounds.max.z - face.z);
  const design = { kind: 'wall-spider', jumpscareDuration: 1.9, frontClearance, recommendedCameraDistance: Math.max(height * 1.05, frontClearance + 0.16),
    walkMetersPerSecond: animator.walkMetersPerSecond,
    // This source's eyes face upward above its long palps. A high front view
    // reveals the original eye cluster while the authored strike remains intact.
    jumpscareFraming: { cameraHeight: 0.75, lookHeight: 0.10, keyHeight: 0.75, distanceOffset: 0.46 } };
  object.userData.spiderAvatar = true;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    animator.dispose(); focus.removeFromParent();
    const skeletons = new Set();
    inner.traverse(node => { if (node.isSkinnedMesh) skeletons.add(node.skeleton); });
    for (const skeleton of skeletons) skeleton.dispose();
  };
  return { ...source, animator, focus, design, dispose };
}
