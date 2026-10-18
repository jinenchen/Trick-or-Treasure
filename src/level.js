// Procedural catacomb floors: grid of rooms + corridors, collision, line of
// sight and BFS flow fields for monster pathfinding.
import * as THREE from 'three';
import { CELL, WALL_H, LIFT_HALF } from './config.js';
import { makeRng } from './rng.js';
import { planHideouts, buildHideouts, updateHideouts, collideHideouts } from './hideouts.js';
import { buildHorrorGraffiti } from './graffiti.js';
import { buildPipeLeaks } from './pipe-leaks.js';
import { stoneWallTexture, floorTexture, ceilingTexture, grateTexture, rustTexture, hazardTexture, surfaceMaps, employmentNoticeTexture, textTexture } from './textures.js';

let tex = null;
function sharedTextures() {
  if (!tex) {
    tex = { wall: stoneWallTexture(), floor: floorTexture(), ceil: ceilingTexture(), grate: grateTexture(), rust: rustTexture(), hazard: hazardTexture() };
    for (const name of ['wall', 'floor', 'ceil', 'rust']) {
      const maps = surfaceMaps(tex[name], { wet: name === 'floor' });
      tex[`${name}Bump`] = maps.bumpMap;
      tex[`${name}Rough`] = maps.roughnessMap;
    }
  }
  return tex;
}

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Level {
  constructor(floor, seed) {
    this.floor = floor;
    this.seed = seed;
    this.rng = makeRng(seed);
    const size = 21 + Math.min(floor - 1, 4) * 2;
    this.W = size;
    this.H = size;
    this.grid = new Uint8Array(size * size);
    this.rooms = [];
    this.obstacles = [];
    this.hidingSpots = [];
    this.lights = [];
    this.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.occupied = new Set();
    this.fieldCache = new Map();
    this.group = new THREE.Group();
    this.generate();
  }

  // ---------- generation ----------

  generate() {
    const { W, H, rng } = this;
    const want = 8 + Math.min(this.floor, 5);
    // The lift room comes first.
    const lw = 4, lh = 4;
    this.addRoom(rng.int(2, W - lw - 2), rng.int(2, H - lh - 2), lw, lh);
    for (let t = 0; t < 400 && this.rooms.length < want; t++) {
      const w = rng.int(3, 6), h = rng.int(3, 6);
      const x = rng.int(1, W - w - 1), y = rng.int(1, H - h - 1);
      const overlaps = this.rooms.some((r) => x - 1 < r.x + r.w && x + w + 1 > r.x && y - 1 < r.y + r.h && y + h + 1 > r.y);
      if (!overlaps) this.addRoom(x, y, w, h);
    }
    for (const r of this.rooms) {
      for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) this.set(xx, yy, 1);
    }
    // Minimum spanning tree over room centers, plus a few loops so you can circle around monsters.
    const n = this.rooms.length;
    const inTree = [0];
    const edges = [];
    const dist = (a, b) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
    while (inTree.length < n) {
      let best = null;
      for (const i of inTree) {
        for (let j = 0; j < n; j++) {
          if (inTree.includes(j)) continue;
          const d = dist(this.rooms[i], this.rooms[j]);
          if (!best || d < best.d) best = { i, j, d };
        }
      }
      inTree.push(best.j);
      edges.push([best.i, best.j]);
    }
    let loops = 0;
    for (let i = 0; i < n && loops < 3; i++) {
      for (let j = i + 1; j < n && loops < 3; j++) {
        if (edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) continue;
        if (dist(this.rooms[i], this.rooms[j]) < 14 && rng.chance(0.35)) {
          edges.push([i, j]);
          loops++;
        }
      }
    }
    for (const [i, j] of edges) this.carveCorridor(this.rooms[i], this.rooms[j]);

    this.floorCells = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (this.grid[y * W + x]) this.floorCells.push([x, y]);

    this.liftRoom = this.rooms[0];
    this.liftPos = new THREE.Vector3((this.liftRoom.x + lw / 2) * CELL, 0, (this.liftRoom.y + lh / 2) * CELL);
    this.liftField = this.fieldTo(...this.worldToCell(this.liftPos.x, this.liftPos.z));
    // Reserve the lift platform so nothing spawns on it.
    for (let yy = this.liftRoom.y + 1; yy < this.liftRoom.y + 3; yy++) {
      for (let xx = this.liftRoom.x + 1; xx < this.liftRoom.x + 3; xx++) this.occupied.add(yy * W + xx);
    }
    planHideouts(this);
  }

  addRoom(x, y, w, h) {
    this.rooms.push({ x, y, w, h, cx: Math.floor(x + w / 2), cy: Math.floor(y + h / 2), index: this.rooms.length });
  }

  carveCorridor(a, b) {
    const hFirst = this.rng.chance(0.5);
    const carveH = (x0, x1, y) => { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, 1); };
    const carveV = (y0, y1, x) => { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, 1); };
    if (hFirst) { carveH(a.cx, b.cx, a.cy); carveV(a.cy, b.cy, b.cx); } else { carveV(a.cy, b.cy, a.cx); carveH(a.cx, b.cx, b.cy); }
  }

  set(x, y, v) {
    if (x > 0 && y > 0 && x < this.W - 1 && y < this.H - 1) this.grid[y * this.W + x] = v;
  }

  // ---------- queries ----------

  isWallCell(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H) return true;
    return this.grid[cy * this.W + cx] === 0;
  }

  worldToCell(x, z) {
    return [Math.floor(x / CELL), Math.floor(z / CELL)];
  }

  cellCenter(cx, cy, out = new THREE.Vector3()) {
    return out.set((cx + 0.5) * CELL, 0, (cy + 0.5) * CELL);
  }

  isWallAt(x, z) {
    return this.isWallCell(Math.floor(x / CELL), Math.floor(z / CELL));
  }

  inLift(x, z) {
    return Math.abs(x - this.liftPos.x) < LIFT_HALF && Math.abs(z - this.liftPos.z) < LIFT_HALF;
  }

  roomAt(x, z) {
    const [cx, cy] = this.worldToCell(x, z);
    return this.rooms.find((r) => cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) || null;
  }

  // Use the approach point, so interacting cannot pull someone through a wall
  // or into a cabinet they are passing behind. Both players share occupancy.
  hidingCandidate(player) {
    let closest = null, best = 1.65;
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    for (const spot of this.hidingSpots) {
      if (spot.occupant !== null) continue;
      const distance = Math.hypot(player.pos.x - spot.entry.x, player.pos.z - spot.entry.z);
      if (distance > best) continue;
      const dx = spot.pos.x - player.pos.x, dz = spot.pos.z - player.pos.z;
      const range = Math.hypot(dx, dz);
      if (range > 0.15 && (dx * fx + dz * fz) / range < 0.3) continue;
      const outward = (player.pos.x - spot.pos.x) * Math.sin(spot.yaw) + (player.pos.z - spot.pos.z) * Math.cos(spot.yaw);
      if (outward < 0.38 || !this.lineOfSight(player.pos.x, player.pos.z, spot.entry.x, spot.entry.z)) continue;
      closest = spot;
      best = distance;
    }
    return closest;
  }

  // Push a circle (pos.x/pos.z, radius r) out of walls and props.
  // Returns the push normal if anything was hit, else null.
  collideCircle(pos, r, withObstacles = true) {
    let nx = 0, nz = 0, hit = false;
    for (let pass = 0; pass < 2; pass++) {
      const x0 = Math.floor((pos.x - r) / CELL), x1 = Math.floor((pos.x + r) / CELL);
      const z0 = Math.floor((pos.z - r) / CELL), z1 = Math.floor((pos.z + r) / CELL);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          if (!this.isWallCell(cx, cz)) continue;
          const qx = Math.max(cx * CELL, Math.min(pos.x, (cx + 1) * CELL));
          const qz = Math.max(cz * CELL, Math.min(pos.z, (cz + 1) * CELL));
          let dx = pos.x - qx, dz = pos.z - qz;
          let d = Math.hypot(dx, dz);
          if (d >= r) continue;
          if (d < 1e-6) {
            // Center is inside the wall: pop out through the nearest open face.
            const x0 = cx * CELL, z0 = cz * CELL;
            const faces = [
              [pos.x - x0, -1, 0], [x0 + CELL - pos.x, 1, 0],
              [pos.z - z0, 0, -1], [z0 + CELL - pos.z, 0, 1],
            ];
            const open = faces.filter(([, fx, fz]) => !this.isWallCell(cx + fx, cz + fz));
            const [depth, fx, fz] = (open.length ? open : faces).sort((a, b) => a[0] - b[0])[0];
            pos.x += fx * (depth + r);
            pos.z += fz * (depth + r);
            dx = fx; dz = fz; d = 1;
          } else {
            pos.x += (dx / d) * (r - d);
            pos.z += (dz / d) * (r - d);
          }
          nx += dx / d; nz += dz / d;
          hit = true;
        }
      }
    }
    if (withObstacles) {
      for (const o of this.obstacles) {
        const dx = pos.x - o.x, dz = pos.z - o.z;
        const rr = r + o.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 1e-4;
        pos.x = o.x + (dx / d) * rr;
        pos.z = o.z + (dz / d) * rr;
        nx += dx / d; nz += dz / d;
        hit = true;
      }
      const normal = collideHideouts(this.hidingSpots, pos, r);
      if (normal) { nx += normal.x; nz += normal.z; hit = true; }
    }
    if (!hit) return null;
    const l = Math.hypot(nx, nz) || 1;
    return { x: nx / l, z: nz / l };
  }

  lineOfSight(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / 0.3);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isWallAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  // BFS distance field toward a target cell (cached).
  fieldTo(cx, cy) {
    const key = cy * this.W + cx;
    let field = this.fieldCache.get(key);
    if (field) return field;
    const { W, H } = this;
    field = new Int16Array(W * H).fill(-1);
    if (!this.isWallCell(cx, cy)) {
      const queue = [key];
      field[key] = 0;
      for (let qi = 0; qi < queue.length; qi++) {
        const c = queue[qi];
        const x = c % W, y = (c - x) / W;
        for (const [dx, dy] of DIRS4) {
          const nx = x + dx, ny = y + dy;
          if (this.isWallCell(nx, ny)) continue;
          const ni = ny * W + nx;
          if (field[ni] !== -1) continue;
          field[ni] = field[c] + 1;
          queue.push(ni);
        }
      }
    }
    if (this.fieldCache.size > 48) this.fieldCache.delete(this.fieldCache.keys().next().value);
    this.fieldCache.set(key, field);
    return field;
  }

  // Next cell center to walk toward along a flow field, or null if already there.
  nextWaypoint(x, z, field, out = new THREE.Vector3()) {
    const [cx, cy] = this.worldToCell(x, z);
    const W = this.W;
    let best = field[cy * W + cx];
    if (best <= 0) return best === 0 ? null : this.escapeWall(cx, cy, out);
    let bx = -1, by = -1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (this.isWallCell(nx, ny)) continue;
        if (dx && dy && (this.isWallCell(cx + dx, cy) || this.isWallCell(cx, cy + dy))) continue;
        const v = field[ny * W + nx];
        if (v >= 0 && v < best) { best = v; bx = nx; by = ny; }
      }
    }
    if (bx < 0) return null;
    return this.cellCenter(bx, by, out);
  }

  escapeWall(cx, cy, out) {
    for (const [dx, dy] of DIRS4) {
      if (!this.isWallCell(cx + dx, cy + dy)) return this.cellCenter(cx + dx, cy + dy, out);
    }
    return null;
  }

  pathDistance(field, x, z) {
    const [cx, cy] = this.worldToCell(x, z);
    if (this.isWallCell(cx, cy)) return 9999;
    const v = field[cy * this.W + cx];
    return v < 0 ? 9999 : v * CELL;
  }

  // A free spot inside a room (not the lift room unless allowed), for loot/monsters.
  takeSpot(rng, { minLiftDist = 0, farthest = false, allowLift = false, interior = true } = {}) {
    const W = this.W;
    let candidates = [];
    for (const r of this.rooms) {
      if (r.index === 0 && !allowLift) continue;
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const k = y * W + x;
          if (this.occupied.has(k)) continue;
          if (interior && DIRS4.some(([dx, dy]) => this.isWallCell(x + dx, y + dy)) && r.w > 3 && r.h > 3 && rng.chance(0.6)) continue;
          const d = this.liftField[k] * CELL;
          if (d < minLiftDist) continue;
          candidates.push({ x, y, d });
        }
      }
    }
    if (!candidates.length) return null;
    if (farthest) {
      candidates.sort((a, b) => b.d - a.d);
      candidates = candidates.slice(0, Math.max(3, Math.floor(candidates.length * 0.3)));
    }
    const c = rng.pick(candidates);
    this.occupied.add(c.y * W + c.x);
    const p = this.cellCenter(c.x, c.y);
    p.x += rng.range(-0.5, 0.5);
    p.z += rng.range(-0.5, 0.5);
    return p;
  }

  randomFloorPoint(rng) {
    const [x, y] = rng.pick(this.floorCells);
    return this.cellCenter(x, y);
  }

  // ---------- meshes ----------

  build(scene) {
    const t = sharedTextures();
    const { W, H } = this;
    // Cosmetic changes must not perturb map generation, loot or AI RNG streams.
    const rng = makeRng(this.seed ^ 0x19780513);

    const tiled = (source) => {
      const texture = source.clone();
      texture.repeat.set(W, H);
      texture.needsUpdate = true;
      return texture;
    };

    const floorTex = t.floor.clone();
    floorTex.repeat.set(W, H);
    floorTex.needsUpdate = true;
    const floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(W * CELL, H * CELL),
      new THREE.MeshStandardMaterial({ map: floorTex, bumpMap: tiled(t.floorBump), bumpScale: 0.022, roughnessMap: tiled(t.floorRough), roughness: 0.84, metalness: 0.08 }),
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set((W * CELL) / 2, 0, (H * CELL) / 2);
    floorMesh.receiveShadow = true;
    floorMesh.userData.own = true;
    this.group.add(floorMesh);

    const ceilTex = t.ceil.clone();
    ceilTex.repeat.set(W, H);
    ceilTex.needsUpdate = true;
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(W * CELL, H * CELL),
      new THREE.MeshStandardMaterial({ map: ceilTex, bumpMap: tiled(t.ceilBump), bumpScale: 0.018, roughness: 1 }),
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set((W * CELL) / 2, WALL_H, (H * CELL) / 2);
    ceil.userData.own = true;
    this.group.add(ceil);

    // Only walls that touch a floor cell are drawn.
    const wallCells = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!this.isWallCell(x, y)) continue;
        let touches = false;
        for (let dy = -1; dy <= 1 && !touches; dy++) for (let dx = -1; dx <= 1; dx++) if (!this.isWallCell(x + dx, y + dy)) { touches = true; break; }
        if (touches) wallCells.push([x, y]);
      }
    }
    const walls = new THREE.InstancedMesh(
      new THREE.BoxGeometry(CELL, WALL_H, CELL),
      new THREE.MeshStandardMaterial({ map: t.wall, bumpMap: t.wallBump, bumpScale: 0.035, roughnessMap: t.wallRough, roughness: 0.95 }),
      wallCells.length,
    );
    const m = new THREE.Matrix4();
    wallCells.forEach(([x, y], i) => {
      m.makeTranslation((x + 0.5) * CELL, WALL_H / 2, (y + 0.5) * CELL);
      walls.setMatrixAt(i, m);
      walls.setColorAt(i, new THREE.Color().setScalar(rng.range(0.77, 1)));
    });
    walls.castShadow = true;
    walls.receiveShadow = true;
    walls.userData.own = true;
    this.group.add(walls);

    this.buildLift();
    this.buildInfrastructure(rng);
    buildHideouts(this);
    this.buildDecor(rng);
    this.graffiti = buildHorrorGraffiti(this);
    this.pipeLeaks = buildPipeLeaks(this);
    this.buildNotices();
    scene.add(this.group);
  }

  // Meshes created here own their geometry/materials; shared texture atlases live
  // across floors. Repeated infrastructure is instanced to keep draw calls low.
  mesh(geometry, material, x, y, z, parent = this.group) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.userData.own = true;
    parent.add(mesh);
    return mesh;
  }

  batch(geometry, material, entries) {
    if (!entries.length) { geometry.dispose(); return; }
    const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
    const transform = new THREE.Object3D();
    for (let i = 0; i < entries.length; i++) {
      const [x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0] = entries[i];
      transform.position.set(x, y, z);
      transform.scale.set(sx, sy, sz);
      transform.rotation.set(rx, ry, rz);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
    }
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.userData.own = true;
    this.group.add(mesh);
    return mesh;
  }

  metalMaterial(color = 0x777b6b) {
    const t = sharedTextures();
    return new THREE.MeshStandardMaterial({ color, map: t.rust, bumpMap: t.rustBump, bumpScale: 0.015, roughnessMap: t.rustRough, roughness: 0.77, metalness: 0.55 });
  }

  buildLift() {
    const t = sharedTextures(), p = this.liftPos;
    const steel = this.metalMaterial(0x959987);
    const dark = new THREE.MeshStandardMaterial({ color: 0x222820, roughness: 0.72, metalness: 0.55 });
    this.mesh(new THREE.BoxGeometry(LIFT_HALF * 2, 0.08, LIFT_HALF * 2),
      new THREE.MeshStandardMaterial({ map: t.grate, roughness: 0.65, metalness: 0.65 }), p.x, 0.04, p.z);
    const posts = [], rails = [], bolts = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      posts.push([p.x + sx * LIFT_HALF, 1.42, p.z + sz * LIFT_HALF, 0.085, 2.84, 0.085]);
      bolts.push([p.x + sx * LIFT_HALF, 0.1, p.z + sz * LIFT_HALF, 0.22, 0.05, 0.22]);
    }
    for (const [sx, sz, rot] of [[0, -1, 0], [0, 1, 0], [-1, 0, 1], [1, 0, 1]]) {
      rails.push([p.x + sx * LIFT_HALF, 2.84, p.z + sz * LIFT_HALF, LIFT_HALF * 2, 0.14, 0.12, 0, rot * Math.PI / 2]);
      const threshold = this.mesh(new THREE.BoxGeometry(LIFT_HALF * 2, 0.016, 0.16),
        new THREE.MeshStandardMaterial({ map: t.hazard, roughness: 0.95 }), p.x + sx * (LIFT_HALF - 0.08), 0.087, p.z + sz * (LIFT_HALF - 0.08));
      threshold.rotation.y = rot * Math.PI / 2;
    }
    this.batch(new THREE.BoxGeometry(1, 1, 1), steel, posts.concat(rails, bolts));
    // A restrained work light and worn steel cage mark the safe deposit zone.
    this.mesh(new THREE.BoxGeometry(1.65, 0.11, 0.3), dark, p.x, 2.91, p.z);
    this.mesh(new THREE.BoxGeometry(1.42, 0.035, 0.19),
      new THREE.MeshBasicMaterial({ color: 0xc0c5a0, toneMapped: false }), p.x, 2.845, p.z);
    const lamp = new THREE.PointLight(0xc4c59d, 14, 12, 1.75);
    lamp.position.set(p.x, 2.65, p.z);
    this.group.add(lamp);
    this.liftLamp = lamp;
    // Keep the deposit marker visible from every approach without a neon beam.
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({
      map: textTexture('LIFT  /  SAFE ZONE\nDEPOSIT RECOVERED ITEMS', { color: '#b7baa0', font: 'bold 30px monospace' }),
      transparent: true, depthWrite: false, opacity: 0.78,
    }));
    sign.name = 'lift-wayfinding';
    sign.scale.set(2.25, 0.56, 1);
    sign.position.set(p.x, 2.49, p.z);
    sign.userData.own = true;
    this.group.add(sign);
    // Suspension cables disappear into the ceiling instead of a glowing column.
    for (const sx of [-1, 1]) {
      this.mesh(new THREE.CylinderGeometry(0.025, 0.025, WALL_H - 2.9, 8), dark,
        p.x + sx * 1.05, (WALL_H + 2.9) / 2, p.z);
    }
  }

  buildInfrastructure(rng) {
    const steel = this.metalMaterial(), pipes = [], collars = [], trim = [], beams = [];
    const dark = new THREE.MeshStandardMaterial({ color: 0x292d24, roughness: 0.9, metalness: 0.3 });
    for (const [cx, cy] of this.floorCells) {
      const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
      for (const [dx, dz] of DIRS4) {
        if (!this.isWallCell(cx + dx, cy + dz)) continue;
        const px = x + dx * (CELL / 2 - 0.13), pz = z + dz * (CELL / 2 - 0.13);
        // Upper perimeter pipe and bolted flange. All are above head height.
        const rx = dx ? Math.PI / 2 : 0, rz = dz ? Math.PI / 2 : 0;
        pipes.push([px, 2.88, pz, 0.065, CELL, 0.065, rx, 0, rz]);
        collars.push([px, 2.88, pz, 0.105, 0.055, 0.105, rx, 0, rz]);
        trim.push([x + dx * (CELL / 2 - 0.025), 0.11, z + dz * (CELL / 2 - 0.025), dx ? 0.05 : CELL, 0.22, dz ? 0.05 : CELL]);
        if ((cx + cy) % 4 === 0) {
          trim.push([px, 2.88, pz, dx ? 0.28 : 0.08, 0.36, dz ? 0.28 : 0.08]);
        }
      }
      // Bundled conduits along narrow corridors give the eye a path to follow.
      const corridorX = this.isWallCell(cx, cy - 1) && this.isWallCell(cx, cy + 1);
      const corridorZ = this.isWallCell(cx - 1, cy) && this.isWallCell(cx + 1, cy);
      if (corridorX || corridorZ) {
        for (const offset of [-0.2, 0, 0.2]) {
          pipes.push([x + (corridorZ ? offset : 0), WALL_H - 0.22, z + (corridorX ? offset : 0), 0.045, CELL, 0.045, corridorZ ? Math.PI / 2 : 0, 0, corridorX ? Math.PI / 2 : 0]);
        }
        if ((cx + cy) % 3 === 0) {
          beams.push([x, WALL_H - 0.35, z, corridorZ ? CELL : 0.09, 0.06, corridorX ? CELL : 0.09]);
        }
      }
    }
    for (const room of this.rooms) {
      const x = (room.x + room.w / 2) * CELL, z = (room.y + room.h / 2) * CELL;
      beams.push([x, WALL_H - 0.13, z, room.w * CELL, 0.26, 0.16]);
      if (room.h > 4) beams.push([x, WALL_H - 0.13, z - CELL * 1.4, room.w * CELL, 0.26, 0.16]);
      // Slack electrical cable crossing the ceiling, safely above player height.
      if (room.index && rng.chance(0.8)) {
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(room.x * CELL + 0.1, WALL_H - 0.14, z + 0.4),
          new THREE.Vector3(x, WALL_H - 0.95, z + 0.2),
          new THREE.Vector3((room.x + room.w) * CELL - 0.1, WALL_H - 0.14, z - 0.35),
        );
        this.mesh(new THREE.TubeGeometry(curve, 16, 0.017, 5, false), dark, 0, 0, 0);
      }
    }
    this.batch(new THREE.CylinderGeometry(1, 1, 1, 8), steel, pipes);
    this.batch(new THREE.CylinderGeometry(1, 1, 1, 10), steel, collars);
    this.batch(new THREE.BoxGeometry(1, 1, 1), dark, trim.concat(beams));
  }

  buildDecor(rng) {
    const steel = this.metalMaterial(0x969384), dark = this.metalMaterial(0x525b4a);
    const concrete = new THREE.MeshStandardMaterial({ map: sharedTextures().wall, color: 0x777b6c, roughness: 0.97 });
    const rubble = [], drainBars = [];
    let lightBudget = 6;
    for (const r of this.rooms) {
      r.theme = ['maintenance', 'storage', 'containment'][r.index % 3];
      if (!r.index) continue;
      const edges = [];
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        const wallDirs = DIRS4.filter(([dx, dy]) => this.isWallCell(x + dx, y + dy));
        const nearDoor = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => {
          const nx = x + dx, ny = y + dy;
          return (nx < r.x || ny < r.y || nx >= r.x + r.w || ny >= r.y + r.h) && !this.isWallCell(nx, ny);
        });
        if (wallDirs.length && !nearDoor) edges.push({ x, y, wallDirs });
      }
      rng.shuffle(edges);
      const count = Math.min(edges.length, rng.int(2, 4));
      for (let i = 0; i < count; i++) {
        const e = edges[i], key = e.y * this.W + e.x;
        if (this.occupied.has(key)) continue;
        const [dx, dz] = e.wallDirs[0];
        const x = (e.x + 0.5) * CELL + dx * CELL * 0.31;
        const z = (e.y + 0.5) * CELL + dz * CELL * 0.31;
        const prop = new THREE.Group();
        prop.position.set(x, 0, z);
        prop.rotation.y = Math.atan2(-dx, -dz);
        this.group.add(prop);
        if (rng.chance(0.5)) {
          // Abandoned electrical cabinets with recessed vents and a broken gauge.
          const cabinet = this.mesh(new THREE.BoxGeometry(0.74, 1.65, 0.48), dark, 0, 0.825, 0, prop);
          cabinet.castShadow = true;
          this.mesh(new THREE.BoxGeometry(0.65, 1.49, 0.018), steel, 0, 0.84, 0.25, prop);
          const black = new THREE.MeshStandardMaterial({ color: 0x111610, roughness: 0.9 });
          for (let j = 0; j < 6; j++) this.mesh(new THREE.BoxGeometry(0.42, 0.022, 0.012), black, 0, 0.32 + j * 0.065, 0.265, prop);
          this.mesh(new THREE.BoxGeometry(0.024, 0.16, 0.035), black, 0.23, 0.93, 0.28, prop);
          this.mesh(new THREE.BoxGeometry(0.16, 0.12, 0.014), black, -0.1, 1.34, 0.27, prop);
          const label = this.mesh(new THREE.PlaneGeometry(0.33, 0.11), new THREE.MeshStandardMaterial({ map: textTexture('HIGH VOLTAGE', { color: '#b2a57a', font: 'bold 38px monospace' }), transparent: true, depthWrite: false }), 0, 1.1, 0.263, prop);
          label.material.polygonOffset = true;
          label.material.polygonOffsetFactor = -1;
          this.obstacles.push({ x, z, r: 0.43 });
        } else {
          const drum = this.mesh(new THREE.CylinderGeometry(0.29, 0.3, 0.87, 16), steel, 0, 0.435, 0, prop);
          drum.castShadow = true;
          for (const y of [0.08, 0.3, 0.62, 0.83]) this.mesh(new THREE.TorusGeometry(0.296, 0.014, 5, 16), dark, 0, y, 0, prop).rotation.x = Math.PI / 2;
          this.mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.014, 8), dark, 0.13, 0.88, 0.1, prop);
          this.obstacles.push({ x, z, r: 0.32 });
        }
        this.occupied.add(key);
        // Low broken plaster hugs the wall; it never adds invisible obstacles.
        for (let j = 0; j < 5; j++) rubble.push([x + rng.range(-0.48, 0.48), 0.025, z + rng.range(-0.42, 0.42), rng.range(0.035, 0.13), rng.range(0.02, 0.045), rng.range(0.05, 0.16), 0, rng.range(0, Math.PI), 0]);
      }
      // A flush drainage grate and a fluorescent pool of light make each room
      // readable while leaving its corners and connecting halls in darkness.
      const cx = (r.x + r.w / 2) * CELL, cz = (r.y + r.h / 2) * CELL;
      this.mesh(new THREE.BoxGeometry(0.95, 0.018, 0.4), new THREE.MeshStandardMaterial({ color: 0x10160f, roughness: 1 }), cx, 0.009, cz + 0.8);
      for (let i = 0; i < 12; i++) drainBars.push([cx - 0.44 + i * 0.08, 0.022, cz + 0.8, 0.025, 0.023, 0.4]);
      const lit = lightBudget > 0 && (r.index <= 3 || rng.chance(0.75));
      this.addFixture(cx, cz, rng, lit, steel);
      if (lit) lightBudget--;
    }
    this.batch(new THREE.BoxGeometry(1, 1, 1), concrete, rubble);
    this.batch(new THREE.BoxGeometry(1, 1, 1), steel, drainBars);
  }

  addFixture(x, z, rng, lit, steel) {
    const y = WALL_H - 0.28;
    this.mesh(new THREE.BoxGeometry(1.32, 0.12, 0.29), steel, x, y, z);
    const color = rng.chance(0.28) ? 0xb3a17b : 0xa3b196;
    const bulbMaterial = new THREE.MeshBasicMaterial({ color: lit ? color : 0x292d24, toneMapped: false });
    const secondBulb = bulbMaterial.clone();
    const endMaterial = new THREE.MeshBasicMaterial({ color: 0x130b04, toneMapped: false });
    for (const [index, offset] of [-0.075, 0.075].entries()) {
      const tube = this.mesh(new THREE.CylinderGeometry(0.026, 0.026, 1.12, 8), index ? secondBulb : bulbMaterial, x, y - 0.085, z + offset);
      tube.rotation.z = Math.PI / 2;
      for (const side of [-1, 1]) {
        this.mesh(new THREE.BoxGeometry(0.065, 0.07, 0.062), steel, x + side * 0.59, y - 0.075, z + offset);
        const electrode = this.mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.038, 6), endMaterial, x + side * 0.535, y - 0.085, z + offset);
        electrode.rotation.z = Math.PI / 2;
      }
    }
    if (!lit) return;
    const light = new THREE.PointLight(color, 5.8, 11.5, 1.8);
    light.position.set(x, y - 0.18, z);
    this.group.add(light);
    const phase = rng.range(0, 30), failingRoll = rng.chance(0.4);
    const faultRng = makeRng(this.seed ^ Math.round(x * 131 + z * 997));
    this.lights.push({
      light, bulbMaterial, secondBulb, endMaterial, color: new THREE.Color(color), base: light.intensity,
      phase, failing: failingRoll || this.lights.length < 2,
      period: faultRng.range(13, 23), outage: faultRng.range(1.3, 2.8),
      wasFailing: false, lastFaultSound: -100,
    });
  }

  buildNotices() {
    const paper = new THREE.MeshStandardMaterial({ map: employmentNoticeTexture(), transparent: true, alphaTest: 0.2, roughness: 1, side: THREE.DoubleSide });
    for (const r of this.rooms.filter((room) => room.index === 0 || room.index === 3)) {
      let placed = false;
      for (let y = r.y; y < r.y + r.h && !placed; y++) for (let x = r.x; x < r.x + r.w && !placed; x++) {
        const dir = DIRS4.find(([dx, dz]) => this.isWallCell(x + dx, y + dz));
        if (!dir) continue;
        const [dx, dz] = dir;
        const notice = this.mesh(new THREE.PlaneGeometry(0.42, 0.56), paper,
          (x + 0.5) * CELL + dx * (CELL / 2 - 0.012), 1.55, (y + 0.5) * CELL + dz * (CELL / 2 - 0.012));
        notice.rotation.y = Math.atan2(-dx, -dz);
        notice.rotation.z = -0.035;
        placed = true;
      }
    }
  }

  update(time, world = null) {
    updateHideouts(this.hidingSpots, time);
    this.pipeLeaks?.update(time, world ? (pos) => {
      world.soundAt(pos, (volume) => world.sound.pipeDrip(volume), 10);
    } : null);
    for (const l of this.lights) {
      // Ballast failures are staggered per fitting: a sag, a real blackout,
      // then two slow attempts to restart. The elevator has a separate supply.
      const cycle = (time + l.phase) % l.period;
      const failing = l.failing && cycle < l.outage + 1.65;
      let strength = 0.93 + Math.sin(time * 7.1 + l.phase) * 0.035;
      let second = strength;
      if (failing) {
        if (cycle < 0.35) strength = 0.3;
        else if (cycle < l.outage + 0.35) strength = 0.008;
        else if (cycle < l.outage + 0.7) strength = 0.48;
        else if (cycle < l.outage + 1.05) strength = 0.025;
        else strength = 0.25 + (cycle - l.outage - 1.05) * 1.1;
        second = cycle > l.outage + 1.3 ? strength * 0.72 : strength * 0.11;
      }
      if (this.reducedMotion) {
        strength = l.failing ? 0.58 + Math.sin(time * 0.65 + l.phase) * 0.17 : 0.93;
        second = strength * (l.failing ? 0.65 : 1);
      }
      l.light.intensity = l.base * (strength + second) * 0.5;
      l.bulbMaterial.color.copy(l.color).multiplyScalar(strength);
      l.secondBulb.color.copy(l.color).multiplyScalar(second);
      l.endMaterial.color.setRGB(failing ? 0.34 : 0.065, failing ? 0.075 : 0.038, 0.009);
      if (world && failing && !l.wasFailing && time - l.lastFaultSound > 7) {
        world.soundAt(l.light.position, (volume) => world.sound.lightFault(volume), 12);
        l.lastFaultSound = time;
      }
      l.wasFailing = failing;
    }
  }

  dispose(scene) {
    scene.remove(this.group);
    // Instanced fittings share resources. Dispose each only once, retaining
    // texture atlases reused by future floors and freeing per-floor clones.
    const geometries = new Set(), materials = new Set(), textures = new Set();
    const shared = new Set(Object.values(sharedTextures()));
    this.group.traverse((o) => {
      if (!o.userData.own) return;
      if (o.geometry) geometries.add(o.geometry);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const material of mats) if (material) materials.add(material);
    });
    for (const material of materials) {
      for (const value of Object.values(material)) if (value?.isTexture && !shared.has(value)) textures.add(value);
      material.dispose();
    }
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
  }
}
