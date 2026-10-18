// Procedural catacomb floors: grid of rooms + corridors, collision, line of
// sight and BFS flow fields for monster pathfinding.
import * as THREE from 'three';
import { CELL, WALL_H, LIFT_HALF } from './config.js';
import { makeRng } from './rng.js';
import { stoneWallTexture, floorTexture, ceilingTexture, grateTexture, textTexture } from './textures.js';
import { instance } from './assets.js';

let tex = null;
function sharedTextures() {
  if (!tex) {
    tex = { wall: stoneWallTexture(), floor: floorTexture(), ceil: ceilingTexture(), grate: grateTexture() };
  }
  return tex;
}

const DECOR = {
  crypt: [
    { model: 'gravestone-round', r: 0.35 }, { model: 'gravestone-cross', r: 0.35 },
    { model: 'gravestone-broken', r: 0.35 }, { model: 'gravestone-debris', r: 0.3 },
    { model: 'cross', r: 0.25 }, { model: 'debris', r: 0.4 },
  ],
  chapel: [
    { model: 'altar-stone', r: 0.7 }, { model: 'cross-column', r: 0.4 },
    { model: 'bench-damaged', r: 0.6 }, { model: 'pillar-small', r: 0.3 }, { model: 'candle-multiple', r: 0 },
  ],
  storage: [
    { model: 'trunk', r: 0.5 }, { model: 'debris-wood', r: 0.5 }, { model: 'shovel', r: 0 },
    { model: 'rocks', r: 0.5 }, { model: 'pillar-square', r: 0.4 },
  ],
};

const GRAFFITI = [
  'IT ONLY MOVES\nIN THE DARK', 'KEEP IT IN\nYOUR LIGHT', 'SHHH...\nIT HEARS YOU',
  'DONT RUN', 'LIGHTS OFF WHEN\nIT WHISPERS', 'GRIMCO OWNS\nYOUR SOUL', 'MEET QUOTA\nOR ELSE',
  'TURN BACK', 'IT FOLLOWS\nTHE LIGHT', 'HOW DEEP\nDOES IT GO?', 'DONT DROP\nTHE URNS',
  'INTERN #41\nWAS HERE', 'NO OVERTIME\nPAY', 'HAPPY\nHALLOWEEN',
];

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
    this.lights = [];
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
    const { W, H, rng } = this;

    const floorTex = t.floor.clone();
    floorTex.repeat.set(W, H);
    floorTex.needsUpdate = true;
    const floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(W * CELL, H * CELL),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92, metalness: 0 }),
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
      new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1 }),
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
      new THREE.MeshStandardMaterial({ map: t.wall, roughness: 0.95 }),
      wallCells.length,
    );
    const m = new THREE.Matrix4();
    wallCells.forEach(([x, y], i) => {
      m.makeTranslation((x + 0.5) * CELL, WALL_H / 2, (y + 0.5) * CELL);
      walls.setMatrixAt(i, m);
    });
    walls.castShadow = true;
    walls.receiveShadow = true;
    walls.userData.own = true;
    this.group.add(walls);

    this.buildLift();
    this.buildDecor(rng);
    this.buildGraffiti(rng);
    scene.add(this.group);
  }

  buildLift() {
    const t = sharedTextures();
    const p = this.liftPos;
    const plat = new THREE.Mesh(
      new THREE.BoxGeometry(LIFT_HALF * 2, 0.08, LIFT_HALF * 2),
      new THREE.MeshStandardMaterial({ map: t.grate, roughness: 0.6, metalness: 0.5, emissive: 0x3a2a05, emissiveIntensity: 0.6 }),
    );
    plat.position.set(p.x, 0.04, p.z);
    plat.receiveShadow = true;
    plat.userData.own = true;
    this.group.add(plat);
    // Brass cage: four posts and a top frame.
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.8, roughness: 0.35 });
    const postGeo = new THREE.CylinderGeometry(0.05, 0.06, 2.7, 10);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const post = new THREE.Mesh(postGeo, brass);
      post.position.set(p.x + sx * LIFT_HALF, 1.35, p.z + sz * LIFT_HALF);
      post.castShadow = true;
      post.userData.own = true;
      this.group.add(post);
    }
    for (const [sx, sz, rot] of [[0, -1, 0], [0, 1, 0], [-1, 0, 1], [1, 0, 1]]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(LIFT_HALF * 2, 0.08, 0.08), brass);
      rail.position.set(p.x + sx * LIFT_HALF, 2.7, p.z + sz * LIFT_HALF);
      rail.rotation.y = rot * Math.PI / 2;
      rail.userData.own = true;
      this.group.add(rail);
    }
    // A soft beam of light so the lift is findable in the dark.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(LIFT_HALF * 0.9, LIFT_HALF * 1.3, WALL_H, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    beam.position.set(p.x, WALL_H / 2, p.z);
    beam.userData.own = true;
    this.group.add(beam);
    this.liftBeam = beam;
    const lamp = new THREE.PointLight(0xffb347, 14, 14, 1.4);
    lamp.position.set(p.x, WALL_H - 0.4, p.z);
    this.group.add(lamp);
    this.liftLamp = lamp;
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({
      map: textTexture('▼ LIFT ▼\nDEPOSIT LOOT', { color: '#ffb347', font: 'bold 40px "Special Elite", monospace', glow: true }),
      transparent: true, depthWrite: false,
    }));
    sign.scale.set(2.6, 0.65, 1);
    sign.position.set(p.x, 2.7, p.z);
    sign.userData.own = true;
    this.group.add(sign);
  }

  buildDecor(rng) {
    const W = this.W;
    let lightBudget = 6;
    const themes = Object.keys(DECOR);
    for (const r of this.rooms) {
      if (r.index === 0) {
        this.addCandle(r.x + 0.15, r.y + 0.15, 'fire-basket');
        continue;
      }
      const theme = rng.pick(themes);
      r.theme = theme;
      // Edge cells that are not a doorway (a doorway has a floor neighbor outside the room).
      const edges = [];
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const wallDirs = DIRS4.filter(([dx, dy]) => this.isWallCell(x + dx, y + dy));
          if (!wallDirs.length) continue;
          const nearDoor = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => {
            const nx = x + dx, ny = y + dy;
            const outside = nx < r.x || ny < r.y || nx >= r.x + r.w || ny >= r.y + r.h;
            return outside && !this.isWallCell(nx, ny);
          });
          if (!nearDoor) edges.push({ x, y, wallDirs });
        }
      }
      rng.shuffle(edges);
      const count = Math.min(edges.length, rng.int(2, 3 + Math.floor((r.w * r.h) / 10)));
      for (let i = 0; i < count; i++) {
        const e = edges[i];
        const k = e.y * W + e.x;
        if (this.occupied.has(k)) continue;
        const [dx, dy] = e.wallDirs[0];
        const d = rng.pick(DECOR[theme]);
        const obj = instance(d.model, { mul: 1.6 }).object;
        const c = this.cellCenter(e.x, e.y);
        obj.position.set(c.x + dx * CELL * 0.28, 0, c.z + dy * CELL * 0.28);
        obj.rotation.y = Math.atan2(-dx, -dy) + rng.range(-0.25, 0.25);
        this.group.add(obj);
        if (d.r > 0) this.obstacles.push({ x: obj.position.x, z: obj.position.z, r: d.r });
        this.occupied.add(k);
      }
      // Big rooms get columns.
      if (r.w >= 5 && r.h >= 5 && rng.chance(0.6)) {
        for (const [cx, cy] of [[r.x + 1, r.y + 1], [r.x + r.w - 2, r.y + 1], [r.x + 1, r.y + r.h - 2], [r.x + r.w - 2, r.y + r.h - 2]]) {
          const col = instance('column-large', { height: WALL_H }).object;
          const c = this.cellCenter(cx, cy);
          col.position.copy(c);
          this.group.add(col);
          this.obstacles.push({ x: c.x, z: c.z, r: 0.55 });
          this.occupied.add(cy * W + cx);
        }
      }
      // Some rooms are candle-lit.
      if (lightBudget > 0 && rng.chance(0.55)) {
        const e = edges.find((ed) => !this.occupied.has(ed.y * W + ed.x));
        if (e) {
          this.occupied.add(e.y * W + e.x);
          const [dx, dy] = e.wallDirs[0];
          this.addCandle(e.x + 0.5 + dx * 0.3, e.y + 0.5 + dy * 0.3, rng.chance(0.5) ? 'candle-multiple' : 'fire-basket');
          lightBudget--;
        }
      }
    }
  }

  addCandle(cellX, cellY, model) {
    const x = cellX * CELL, z = cellY * CELL;
    const obj = instance(model, { mul: model === 'fire-basket' ? 1.3 : 1.8 }).object;
    obj.position.set(x, 0, z);
    this.group.add(obj);
    const light = new THREE.PointLight(0xff8a2a, 5, 9, 1.5);
    light.position.set(x, 1.1, z);
    this.group.add(light);
    this.lights.push({ light, base: light.intensity, phase: Math.random() * 10 });
    this.obstacles.push({ x, z, r: 0.35 });
  }

  buildGraffiti(rng) {
    const msgs = rng.shuffle([...GRAFFITI]);
    let placed = 0;
    for (const r of rng.shuffle([...this.rooms])) {
      if (placed >= 6) break;
      if (r.index === 0) continue;
      // Find a wall face on this room's edge.
      for (let t = 0; t < 10; t++) {
        const x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1);
        const dir = DIRS4.find(([dx, dy]) => this.isWallCell(x + dx, y + dy));
        if (!dir) continue;
        const [dx, dy] = dir;
        const c = this.cellCenter(x, y);
        const color = rng.pick(['#b3121b', '#d9d2c3', '#8fd14f']);
        const mat = new THREE.MeshStandardMaterial({
          map: textTexture(msgs[placed % msgs.length], { color }),
          transparent: true, depthWrite: false, roughness: 1,
          polygonOffset: true, polygonOffsetFactor: -2,
        });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), mat);
        plane.position.set(c.x + dx * (CELL / 2 - 0.02), rng.range(1.3, 2.1), c.z + dy * (CELL / 2 - 0.02));
        plane.rotation.y = Math.atan2(-dx, -dy);
        plane.rotation.z = rng.range(-0.08, 0.08);
        plane.userData.own = true;
        this.group.add(plane);
        placed++;
        break;
      }
    }
  }

  update(time) {
    for (const l of this.lights) {
      const f = Math.sin(time * 13 + l.phase) * 0.5 + Math.sin(time * 31 + l.phase * 2) * 0.3 + Math.sin(time * 7.3 + l.phase) * 0.2;
      l.light.intensity = l.base * (0.8 + 0.2 * f);
    }
    if (this.liftBeam) this.liftBeam.material.opacity = 0.06 + 0.025 * Math.sin(time * 2);
  }

  dispose(scene) {
    scene.remove(this.group);
    // Model clones share geometry/materials with the asset cache, so only
    // free what the level created itself (tagged with userData.own).
    this.group.traverse((o) => {
      if (!o.userData.own) return;
      o.geometry?.dispose();
      if (o.material) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }
}
