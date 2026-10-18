// Hiding furniture stays at the room perimeter. Its grid cell is reserved for
// spawns, but the cell center and the room's doorways remain navigable.
import * as THREE from 'three';
import { CELL } from './config.js';
import { makeRng } from './rng.js';
import { textTexture } from './textures.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function planHideouts(level) {
  const rng = makeRng(level.seed ^ 0x48494445);
  for (const room of level.rooms) {
    if (!room.index) continue;
    const candidates = [];
    for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) {
      if (level.occupied.has(y * level.W + x)) continue;
      const walls = DIRS.filter(([dx, dz]) => level.isWallCell(x + dx, y + dz));
      if (!walls.length) continue;
      // Keep the adjacent cells outside a room closed, including diagonals:
      // these furniture pieces must never straddle a corridor mouth.
      let nearDoor = false;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dz;
        const outside = xx < room.x || yy < room.y || xx >= room.x + room.w || yy >= room.y + room.h;
        if (outside && !level.isWallCell(xx, yy)) nearDoor = true;
      }
      if (nearDoor) continue;
      for (const [dx, dz] of walls) {
        if (level.isWallCell(x - dx, y - dz)) continue;
        candidates.push({ x, y, dx, dz, corner: walls.length > 1 });
      }
    }
    if (!candidates.length) continue;
    rng.shuffle(candidates);
    candidates.sort((a, b) => Number(a.corner) - Number(b.corner));
    const chosen = candidates[0];
    const { x, y, dx, dz } = chosen;
    const kind = room.index % 2 ? 'table' : 'locker';
    // A shallow industrial workbench/locker fits against the wall while leaving
    // >0.4m from its front to the pathfinding cell center.
    const pos = level.cellCenter(x, y);
    pos.x += dx * 0.85;
    pos.z += dz * 0.85;
    const entry = pos.clone().add(new THREE.Vector3(-dx * 1.25, 0, -dz * 1.25));
    const spot = {
      id: `hide-${level.floor}-${room.index}`,
      kind,
      name: kind === 'table' ? 'Worktable' : 'Locker',
      pos,
      entry,
      yaw: Math.atan2(-dx, -dz),
      eyeHeight: kind === 'table' ? 0.55 : 1.35,
      occupant: null,
      halfWidth: kind === 'table' ? 0.94 : 0.54,
      halfDepth: 0.38,
      roomIndex: room.index,
      door: null,
      lastUpdate: null,
    };
    level.hidingSpots.push(spot);
    level.occupied.add(y * level.W + x);
  }
}

export function buildHideouts(level) {
  const steel = level.metalMaterial(0x7b8270);
  const dark = level.metalMaterial(0x4a5244);
  const black = new THREE.MeshStandardMaterial({ color: 0x171d16, roughness: 0.92, metalness: 0.3 });
  const label = new THREE.MeshStandardMaterial({
    map: textTexture('HIDE', { color: '#c1bda1', font: 'bold 54px monospace' }),
    transparent: true, depthWrite: false, roughness: 1,
  });
  for (const spot of level.hidingSpots) {
    const group = new THREE.Group();
    group.name = `hideout-${spot.kind}`;
    group.position.copy(spot.pos);
    group.rotation.y = spot.yaw;
    spot.group = group;
    level.group.add(group);
    const box = (w, h, d, x, y, z, material = steel, parent = group) => {
      const mesh = level.mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z, parent);
      mesh.castShadow = true;
      return mesh;
    };
    if (spot.kind === 'table') {
      // A proper cavity: four legs, a rear brace, and a solid rusted top. At the
      // hidden eye height you see between its legs and below the apron.
      box(1.88, 0.12, 0.76, 0, 1.10, 0);
      box(1.82, 0.05, 0.72, 0, 1.025, 0, dark);
      for (const x of [-0.84, 0.84]) for (const z of [-0.29, 0.29]) {
        box(0.075, 1.02, 0.075, x, 0.51, z, dark);
        box(0.13, 0.035, 0.13, x, 0.018, z, black);
      }
      box(1.78, 0.32, 0.04, 0, 0.84, -0.33, dark);
      box(0.04, 0.17, 0.60, -0.86, 0.93, 0, dark);
      box(0.04, 0.17, 0.60, 0.86, 0.93, 0, dark);
      box(1.76, 0.055, 0.045, 0, 0.19, -0.29, dark);
      // Maintenance junk is above the table, leaving the hiding cavity empty.
      box(0.32, 0.12, 0.20, -0.58, 1.22, -0.12, dark);
      box(0.16, 0.055, 0.11, -0.58, 1.305, -0.12, black);
      box(0.31, 0.018, 0.20, 0.48, 1.17, -0.11, black).rotation.y = 0.21;
      level.mesh(new THREE.PlaneGeometry(0.32, 0.10), label, 0, 1.10, 0.386, group);
    } else {
      // Thin individual panels, never a solid box: the player really sits in
      // the hollow cabinet and peers through the gaps in its vented door.
      box(1.08, 0.08, 0.76, 0, 0.04, 0, dark);
      box(1.08, 0.055, 0.76, 0, 2.16, 0);
      box(0.055, 2.08, 0.76, -0.5125, 1.12, 0);
      box(0.055, 2.08, 0.76, 0.5125, 1.12, 0);
      box(0.97, 2.08, 0.045, 0, 1.12, -0.3575, dark);
      box(0.96, 0.035, 0.68, 0, 1.94, 0, dark);
      const door = new THREE.Group();
      door.position.set(-0.48, 0, 0.393);
      door.rotation.y = -0.48;
      group.add(door);
      spot.door = door;
      box(0.96, 1.02, 0.035, 0.48, 0.60, 0, steel, door);
      box(0.96, 0.47, 0.035, 0.48, 1.875, 0, steel, door);
      box(0.075, 0.55, 0.035, 0.0375, 1.375, 0, steel, door);
      box(0.075, 0.55, 0.035, 0.9225, 1.375, 0, steel, door);
      for (let i = 0; i < 6; i++) {
        box(0.81, 0.025, 0.055, 0.48, 1.145 + i * 0.09, 0, dark, door);
      }
      box(0.035, 0.19, 0.065, 0.84, 1.00, 0.045, black, door);
      for (const y of [0.36, 1.86]) box(0.085, 0.13, 0.06, 0.006, y, 0.018, dark, door);
      level.mesh(new THREE.PlaneGeometry(0.33, 0.11), label, 0.47, 1.89, 0.020, door);
      const number = level.mesh(new THREE.PlaneGeometry(0.23, 0.10), new THREE.MeshStandardMaterial({
        map: textTexture(String(spot.roomIndex + 10).padStart(2, '0'), { color: '#9a9e89', font: 'bold 56px monospace' }),
        transparent: true, depthWrite: false, roughness: 1,
      }), 0.47, 1.03, 0.020, door);
      number.name = 'locker-number';
    }
  }
}

export function updateHideouts(spots, time) {
  for (const spot of spots) {
    if (!spot.door) continue;
    const dt = spot.lastUpdate === null ? 1 / 60 : Math.max(0, Math.min(0.1, time - spot.lastUpdate));
    spot.lastUpdate = time;
    const target = spot.occupant !== null ? 0 : -0.48;
    spot.door.rotation.y += (target - spot.door.rotation.y) * (1 - Math.exp(-12 * dt));
  }
}

// Standing actors collide with each small footprint. Hidden players are pinned
// directly to spot.pos by Player and skip normal locomotion/collision entirely.
// Rectangles, instead of bounding circles, keep grid-cell centers unobstructed.
export function collideHideouts(spots, pos, radius) {
  let nx = 0, nz = 0, hit = false;
  for (const spot of spots) {
    const sin = Math.sin(spot.yaw), cos = Math.cos(spot.yaw);
    const dx = pos.x - spot.pos.x, dz = pos.z - spot.pos.z;
    let x = cos * dx - sin * dz, z = sin * dx + cos * dz;
    const qx = Math.max(-spot.halfWidth, Math.min(spot.halfWidth, x));
    const qz = Math.max(-spot.halfDepth, Math.min(spot.halfDepth, z));
    let px = x - qx, pz = z - qz;
    const distance = Math.hypot(px, pz);
    if (distance >= radius) continue;
    if (distance < 1e-6) {
      // Exit through the clear front when a spawn/teleport starts in a shell.
      pz = spot.halfDepth + radius - z;
      px = 0;
    } else {
      px *= (radius - distance) / distance;
      pz *= (radius - distance) / distance;
    }
    const wx = cos * px + sin * pz, wz = -sin * px + cos * pz;
    pos.x += wx;
    pos.z += wz;
    nx += wx; nz += wz; hit = true;
  }
  if (!hit) return null;
  const length = Math.hypot(nx, nz) || 1;
  return { x: nx / length, z: nz / length };
}
