// Cosmetic pipe failures: shared instanced geometry, no collision or spawn edits.
import * as THREE from 'three';
import { CELL } from './config.js';
import { makeRng } from './rng.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const MAX_LEAKS = 10;
const DROPS_PER_LEAK = 6;
const SPLASHES_PER_LEAK = 4;
const PIPE_Y = 2.88;
const IMPACT_Y = 0.027;
const GRAVITY = 9.8;
const TAU = Math.PI * 2;

function decalTexture(streak) {
  const width = 96, height = streak ? 192 : 96;
  const data = new Uint8Array(width * height * 4);
  const rng = makeRng(streak ? 0x5354524b : 0x50554444);
  const trails = Array.from({ length: 12 }, () => ({
    x: rng.range(-0.58, 0.58), width: rng.range(0.014, 0.11), length: rng.range(0.3, 1.0),
  }));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / (width - 1) * 2 - 1, v = y / (height - 1);
    let alpha;
    if (streak) {
      // UV v=1 is the top of the wall plane: stains descend from the broken seal.
      const down = 1 - v;
      alpha = Math.exp(-u * u * 9) * Math.pow(1 - down, 0.7) * 0.23;
      for (const trail of trails) {
        const offset = u - trail.x - Math.sin(down * 11 + trail.x * 4) * 0.012;
        const tail = Math.max(0, Math.min(1, (trail.length - down) * 9));
        alpha += Math.exp(-offset * offset / (trail.width * trail.width)) * tail * 0.55;
      }
      alpha *= Math.min(1, v * 18) * Math.min(1, (1 - v) * 30);
    } else {
      const z = v * 2 - 1, angle = Math.atan2(z, u);
      const radius = Math.hypot(u, z);
      const edge = 0.79 + Math.sin(angle * 5 + 0.8) * 0.065 + Math.cos(angle * 9) * 0.035;
      alpha = Math.max(0, Math.min(1, (edge - radius) * 16));
    }
    const k = (y * width + x) * 4;
    const grain = 0.81 + rng.next() * 0.19;
    data[k] = data[k + 1] = data[k + 2] = Math.round(210 * grain);
    data[k + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function pickSources(level) {
  // This stream never advances level.rng or changes occupied cells / obstacles.
  const rng = makeRng(level.seed ^ 0x4c45414b);
  const leaks = [];
  const rooms = rng.shuffle(level.rooms.filter((room) => room.index !== 0));
  for (const room of rooms) {
    if (leaks.length >= MAX_LEAKS) break;
    const candidates = [];
    for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) {
      if (level.occupied.has(y * level.W + x)) continue;
      const walls = DIRS.filter(([dx, dz]) => level.isWallCell(x + dx, y + dz));
      if (walls.length !== 1) continue;
      const [dx, dz] = walls[0];
      candidates.push({ x, y, dx, dz });
    }
    if (!candidates.length) continue;
    const { x, y, dx, dz } = rng.pick(candidates);
    const along = rng.range(-0.55, 0.55);
    const cx = (x + 0.5) * CELL + dz * along;
    const cz = (y + 0.5) * CELL - dx * along;
    const source = new THREE.Vector3(cx + dx * (CELL / 2 - 0.13), PIPE_Y - 0.071, cz + dz * (CELL / 2 - 0.13));
    const impact = new THREE.Vector3(source.x - dx * 0.075, IMPACT_Y, source.z - dz * 0.075);
    const period = rng.range(0.95, 1.45);
    leaks.push({
      source, pos: source, impact, roomIndex: room.index,
      dx, dz, cx, cz, yaw: Math.atan2(-dx, -dz),
      period, phase: rng.range(0, period),
      flight: Math.sqrt(2 * (source.y - IMPACT_Y) / GRAVITY),
      pressurePhase: rng.range(0, TAU), streamLength: rng.range(0.55, 1.7),
      puddleSize: rng.range(0.9, 1.3), lastAudible: -Infinity,
    });
  }
  return leaks;
}

function instances(level, name, geometry, material, count, dynamic = false) {
  const object = new THREE.InstancedMesh(geometry, material, count);
  object.name = name;
  object.userData.own = true;
  object.receiveShadow = true;
  object.castShadow = false;
  if (dynamic) {
    object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The small animated batch spans several rooms; do not cache its initial pose.
    object.frustumCulled = false;
  }
  level.group.add(object);
  return object;
}

export function buildPipeLeaks(level) {
  const leaks = pickSources(level);
  if (!leaks.length) return { leaks, update() {} };

  const wet = new THREE.MeshStandardMaterial({
    color: 0x33443a, map: decalTexture(false), transparent: true, opacity: 0.78,
    roughness: 0.08, metalness: 0.32, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1,
  });
  const stain = new THREE.MeshStandardMaterial({
    color: 0x202c1d, map: decalTexture(true), transparent: true, opacity: 0.73,
    roughness: 0.29, metalness: 0.08, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1,
  });
  const water = new THREE.MeshStandardMaterial({
    color: 0xb5c7ba, roughness: 0.11, metalness: 0.12,
    transparent: true, opacity: 0.62, depthWrite: false,
  });
  const rippleMaterial = new THREE.MeshStandardMaterial({
    color: 0x9eafa0, roughness: 0.15, metalness: 0.18,
    transparent: true, opacity: 0.34, depthWrite: false,
  });
  const crust = new THREE.MeshStandardMaterial({ color: 0x302a1e, roughness: 0.72, metalness: 0.28 });
  const puddles = instances(level, 'pipe-leak-puddles', new THREE.PlaneGeometry(1, 1), wet, leaks.length);
  const stains = instances(level, 'pipe-leak-wall-streaks', new THREE.PlaneGeometry(1, 1), stain, leaks.length);
  const seals = instances(level, 'pipe-leak-broken-seals', new THREE.IcosahedronGeometry(1, 1), crust, leaks.length);
  const streams = instances(level, 'pipe-leak-streams', new THREE.CylinderGeometry(1, 1, 1, 5), water, leaks.length, true);
  const dropGeometry = new THREE.IcosahedronGeometry(1, 0);
  const drops = instances(level, 'pipe-leak-drops', dropGeometry, water, leaks.length * DROPS_PER_LEAK, true);
  const splashes = instances(level, 'pipe-leak-splashes', dropGeometry, water, leaks.length * SPLASHES_PER_LEAK, true);
  const ripples = instances(level, 'pipe-leak-ripples', new THREE.RingGeometry(0.88, 1, 20), rippleMaterial, leaks.length * 2, true);
  const transform = new THREE.Object3D();

  for (let i = 0; i < leaks.length; i++) {
    const leak = leaks[i];
    transform.rotation.set(-Math.PI / 2, 0, 0);
    transform.rotateZ(leak.yaw);
    transform.position.set(leak.impact.x - leak.dx * 0.20, 0.018, leak.impact.z - leak.dz * 0.20);
    transform.scale.set(leak.puddleSize, leak.puddleSize * 1.18, 1);
    transform.updateMatrix();
    puddles.setMatrixAt(i, transform.matrix);

    transform.rotation.set(0, leak.yaw, 0);
    transform.position.set(leak.cx + leak.dx * (CELL / 2 - 0.009), 1.43, leak.cz + leak.dz * (CELL / 2 - 0.009));
    transform.scale.set(0.66, 2.76, 1);
    transform.updateMatrix();
    stains.setMatrixAt(i, transform.matrix);

    transform.position.copy(leak.source);
    transform.position.y += 0.014;
    transform.scale.set(0.046, 0.026, 0.046);
    transform.updateMatrix();
    seals.setMatrixAt(i, transform.matrix);
  }
  puddles.instanceMatrix.needsUpdate = stains.instanceMatrix.needsUpdate = seals.instanceMatrix.needsUpdate = true;
  let lastTime = null;

  // Mutates existing matrices only. No particle objects, random values or geometry
  // are allocated during updates. Positions are analytic, so pause/resume is safe.
  function update(time, onDrip = null) {
    if (!Number.isFinite(time)) return;
    const continuous = lastTime !== null && time > lastTime && time - lastTime <= 0.25;
    for (let i = 0; i < leaks.length; i++) {
      const leak = leaks[i];
      const clock = time + leak.phase;
      const age = ((clock % leak.period) + leak.period) % leak.period;
      const sinceImpact = ((clock - leak.flight) % leak.period + leak.period) % leak.period;
      const pressure = Math.sin(time * 0.83 + leak.pressurePhase);
      const flow = Math.max(0, Math.min(1, (pressure - 0.34) * 3));
      const length = leak.streamLength * (0.68 + Math.sin(time * 13 + i) * 0.10 + flow * 0.22);
      transform.rotation.set(0, 0, 0);
      transform.position.set(leak.source.x, leak.source.y - length * flow / 2, leak.source.z);
      transform.scale.set(0.007 * flow, length * flow, 0.007 * flow);
      transform.updateMatrix();
      streams.setMatrixAt(i, transform.matrix);

      for (let j = 0; j < DROPS_PER_LEAK; j++) {
        const t = (age + j * leak.period / DROPS_PER_LEAK) % leak.period;
        const falling = t < leak.flight;
        const progress = Math.min(1, t / leak.flight);
        const side = j ? Math.sin(j * 8.9 + i) * 0.014 * progress : 0;
        transform.position.set(
          leak.source.x - leak.dx * 0.075 * progress + leak.dz * side,
          Math.max(IMPACT_Y, leak.source.y - GRAVITY * t * t / 2),
          leak.source.z - leak.dz * 0.075 * progress - leak.dx * side,
        );
        const radius = falling ? 0.012 + (j % 3) * 0.002 : 0;
        transform.scale.set(radius, radius * (1.8 + progress * 3), radius);
        transform.updateMatrix();
        drops.setMatrixAt(i * DROPS_PER_LEAK + j, transform.matrix);
      }

      for (let j = 0; j < SPLASHES_PER_LEAK; j++) {
        const splashTime = sinceImpact - j * 0.012;
        const visible = splashTime >= 0 && splashTime < 0.26;
        const t = Math.max(0, splashTime);
        // The splash fans away from the wall, into the wet patch.
        const angle = leak.yaw + (j - 1.5) * 0.58;
        const distance = t * (0.34 + j * 0.065);
        transform.position.set(
          leak.impact.x + Math.sin(angle) * distance,
          IMPACT_Y + Math.max(0, t * 1.15 - 4.5 * t * t),
          leak.impact.z + Math.cos(angle) * distance,
        );
        const scale = visible ? 0.009 * (1 - t / 0.29) : 0;
        transform.scale.set(scale, scale * 1.8, scale);
        transform.updateMatrix();
        splashes.setMatrixAt(i * SPLASHES_PER_LEAK + j, transform.matrix);
      }

      transform.rotation.set(-Math.PI / 2, 0, 0);
      for (let j = 0; j < 2; j++) {
        const t = sinceImpact - j * 0.10;
        const visible = t >= 0 && t < 0.53;
        const radius = visible ? 0.025 + t * 0.37 : 0;
        transform.position.set(leak.impact.x, IMPACT_Y + 0.004 + j * 0.001, leak.impact.z);
        transform.scale.set(radius, radius * 0.87, 1);
        transform.updateMatrix();
        ripples.setMatrixAt(i * 2 + j, transform.matrix);
      }

      if (continuous && onDrip && time - leak.lastAudible >= 0.6) {
        const previousImpact = Math.floor((lastTime + leak.phase - leak.flight) / leak.period);
        const currentImpact = Math.floor((clock - leak.flight) / leak.period);
        if (currentImpact > previousImpact) {
          leak.lastAudible = time;
          onDrip(leak.impact, leak);
        }
      } else if (lastTime === null || time < lastTime || time - lastTime > 0.25) {
        // Never replay missed drips after a floor change, pause or tab suspension.
        leak.lastAudible = time;
      }
    }
    streams.instanceMatrix.needsUpdate = drops.instanceMatrix.needsUpdate = true;
    splashes.instanceMatrix.needsUpdate = ripples.instanceMatrix.needsUpdate = true;
    lastTime = time;
  }

  update(0);
  return { leaks, update };
}
