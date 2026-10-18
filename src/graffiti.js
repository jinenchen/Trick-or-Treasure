// Painted and scratched environmental storytelling. These flat wall decals use
// an independent seed and never reserve cells or affect navigation/collision.
import * as THREE from 'three';
import { CELL } from './config.js';
import { makeRng } from './rng.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const WARNINGS = [
  'IT LEARNED\nOUR VOICES', 'WE COUNTED\nONE TOO MANY', 'DO NOT\nANSWER IT',
  'IT WAITS\nIN THE WALLS', 'KEEP\nVERY QUIET', 'THEY NEVER\nWENT HOME',
  'DO NOT TRUST\nTHE KNOCKING', 'IT KNOWS\nYOUR NAME', 'NO ONE\nIS COMING',
  'CHECK\nTHE CORNERS', 'I HEARD\nMY OWN VOICE', 'STAY IN\nTHE LIGHT',
];

// Deliberately uneven block lettering, drawn as actual brush strokes instead
// of typeset text. Each stroke is perturbed by the texture's seeded RNG.
const LETTERS = {
  A: [[0, 1, 0.48, 0, 1, 1], [0.21, 0.61, 0.78, 0.6]],
  B: [[0, 1, 0, 0, 0.68, 0, 0.95, 0.19, 0.84, 0.43, 0, 0.49], [0.38, 0.48, 0.83, 0.52, 1, 0.76, 0.82, 1, 0, 1]],
  C: [[0.96, 0.13, 0.66, 0, 0.23, 0.03, 0, 0.3, 0.04, 0.8, 0.3, 1, 0.78, 0.97, 1, 0.83]],
  D: [[0, 1, 0, 0, 0.56, 0, 0.94, 0.26, 1, 0.69, 0.72, 0.99, 0, 1]],
  E: [[1, 0.02, 0.02, 0, 0, 1, 0.98, 0.98], [0.04, 0.49, 0.8, 0.47]],
  F: [[0, 1, 0.03, 0, 1, 0.02], [0.02, 0.5, 0.78, 0.47]],
  G: [[0.97, 0.15, 0.67, 0, 0.2, 0.06, 0, 0.35, 0.06, 0.84, 0.35, 1, 0.93, 0.91, 0.94, 0.54, 0.57, 0.53]],
  H: [[0.03, 0, 0, 1], [0.96, 0, 1, 1], [0, 0.53, 0.98, 0.5]],
  I: [[0.09, 0, 0.92, 0.02], [0.52, 0, 0.49, 1], [0.04, 1, 0.95, 0.98]],
  J: [[0.14, 0.02, 1, 0], [0.77, 0, 0.78, 0.78, 0.55, 1, 0.15, 0.91, 0, 0.73]],
  K: [[0.02, 0, 0, 1], [0.95, 0, 0.06, 0.57, 1, 1]],
  L: [[0.05, 0, 0, 0.98, 1, 1]],
  M: [[0, 1, 0.02, 0, 0.5, 0.57, 0.98, 0, 1, 1]],
  N: [[0, 1, 0.02, 0, 0.98, 1, 1, 0]],
  O: [[0.4, 0, 0.08, 0.14, 0, 0.55, 0.21, 0.95, 0.64, 1, 0.96, 0.76, 1, 0.29, 0.76, 0.02, 0.4, 0]],
  P: [[0, 1, 0.02, 0, 0.73, 0, 1, 0.22, 0.86, 0.48, 0.04, 0.52]],
  Q: [[0.4, 0, 0.08, 0.14, 0, 0.55, 0.21, 0.95, 0.64, 1, 0.96, 0.76, 1, 0.29, 0.76, 0.02, 0.4, 0], [0.57, 0.72, 1.08, 1.08]],
  R: [[0, 1, 0.02, 0, 0.73, 0, 0.98, 0.24, 0.78, 0.5, 0.04, 0.53], [0.51, 0.52, 1, 1]],
  S: [[1, 0.13, 0.65, 0, 0.16, 0.09, 0, 0.33, 0.25, 0.48, 0.78, 0.55, 1, 0.77, 0.79, 1, 0.22, 0.95, 0, 0.84]],
  T: [[0, 0.02, 1, 0], [0.5, 0, 0.47, 1]],
  U: [[0.02, 0, 0, 0.77, 0.22, 1, 0.7, 0.98, 0.96, 0.75, 1, 0]],
  V: [[0, 0, 0.48, 1, 1, 0.02]],
  W: [[0, 0, 0.16, 1, 0.49, 0.43, 0.8, 1, 1, 0]],
  X: [[0, 0, 1, 1], [1, 0, 0, 0.97]],
  Y: [[0, 0, 0.49, 0.5, 1, 0], [0.49, 0.5, 0.47, 1]],
  Z: [[0, 0.02, 1, 0, 0, 1, 1, 0.97]],
};

function canvas(width, height) {
  const image = document.createElement('canvas');
  image.width = width;
  image.height = height;
  return [image, image.getContext('2d')];
}

function texture(image) {
  const map = new THREE.CanvasTexture(image);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

function brush(ctx, points, width, rng, color = '#b4b39a') {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  for (let pass = 0; pass < 3; pass++) {
    ctx.lineWidth = width * (pass ? rng.range(0.27, 0.56) : 1);
    ctx.globalAlpha = pass ? 0.38 : 0.76;
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 2) {
      const x = points[i] + rng.range(-width * 0.18, width * 0.18);
      const y = points[i + 1] + rng.range(-width * 0.18, width * 0.18);
      if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function erosion(ctx, width, height, rng, count = 2000) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = rng.range(0.12, 0.7);
    ctx.fillRect(rng.range(0, width), rng.range(0, height), rng.range(0.4, 3.5), rng.range(0.3, 2.4));
  }
  // Long abrasion passes cut through paint without obscuring the message.
  for (let i = 0; i < 13; i++) {
    ctx.globalAlpha = rng.range(0.15, 0.42);
    ctx.fillRect(rng.range(0, width), rng.range(0, height), rng.range(12, 95), rng.range(0.5, 1.5));
  }
  ctx.restore();
}

function lettering(ctx, text, x, y, width, height, rng, color) {
  const lines = text.split('\n');
  const lineHeight = height / lines.length;
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row];
    const pitch = Math.min(width / (line.length + 0.25), lineHeight * 0.66);
    const letterWidth = pitch * 0.66, letterHeight = lineHeight * 0.65;
    const left = x + (width - line.length * pitch) / 2;
    for (let column = 0; column < line.length; column++) {
      const strokes = LETTERS[line[column]];
      if (!strokes) continue;
      ctx.save();
      ctx.translate(left + column * pitch, y + row * lineHeight + lineHeight * 0.13 + rng.range(-2.5, 2.5));
      ctx.rotate(rng.range(-0.045, 0.045));
      for (const stroke of strokes) {
        const points = stroke.map((value, i) => value * (i % 2 ? letterHeight : letterWidth));
        brush(ctx, points, Math.max(2, pitch * rng.range(0.075, 0.115)), rng, color);
      }
      ctx.restore();
    }
  }
}

function warningTexture(text, rng) {
  const [image, ctx] = canvas(768, 320);
  const color = rng.pick(['#c1bea2', '#aaa990', '#999e88', '#b3a47b']);
  lettering(ctx, text, 24, 20, 720, 255, rng, color);
  if (rng.chance(0.7)) brush(ctx, [90, 279, 320, 271, 656, 284], 4, rng, color);
  // Faint paint runs, not blood, beneath the warning.
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.28;
  for (let i = 0; i < 14; i++) {
    const x = rng.range(95, 650), y = rng.range(240, 272);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rng.range(-2, 2), y + rng.range(7, 33)); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  erosion(ctx, 768, 320, rng, 4500);
  return texture(image);
}

function tallyTexture(rng) {
  const [image, ctx] = canvas(384, 256);
  const rows = rng.int(2, 3), groups = rng.int(2, 3);
  for (let row = 0; row < rows; row++) for (let group = 0; group < groups; group++) {
    const ox = 24 + group * 118, oy = 17 + row * 75;
    for (let mark = 0; mark < 4; mark++) {
      const x = ox + mark * 20;
      brush(ctx, [x + rng.range(-2, 4), oy, x - 4, oy + rng.range(39, 56)], rng.range(2.2, 4.2), rng);
    }
    brush(ctx, [ox - 8, oy + 42, ox + 65, oy + 11], 3.3, rng);
  }
  erosion(ctx, 384, 256, rng, 2100);
  return texture(image);
}

function hand(ctx, x, y, scale, rotation, rng, color) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rotation); ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.65;
  ctx.beginPath(); ctx.ellipse(0, 11, 27, 34, -0.07, 0, Math.PI * 2); ctx.fill();
  const fingers = [[-23, -28, 8, 30, -0.14], [-7, -41, 8, 38, -0.03], [10, -39, 7, 36, 0.07], [25, -27, 6, 28, 0.2], [-38, 6, 9, 23, -0.7]];
  for (const [fx, fy, rx, ry, angle] of fingers) {
    ctx.beginPath(); ctx.ellipse(fx, fy, rx, ry, angle, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < 13; i++) {
    const sx = rng.range(-23, 23), length = rng.range(12, 77);
    ctx.lineWidth = rng.range(0.7, 2.5);
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(sx, 30); ctx.lineTo(sx + rng.range(-9, 7), 30 + length); ctx.stroke();
  }
  ctx.restore();
}

function handsTexture(rng) {
  const [image, ctx] = canvas(384, 384);
  hand(ctx, 125, 176, 1.25, -0.16, rng, '#9f9f88');
  hand(ctx, 281, 143, 0.91, 0.27, rng, '#727565');
  erosion(ctx, 384, 384, rng, 6200);
  return texture(image);
}

function scratchTexture(rng) {
  const [image, ctx] = canvas(256, 384);
  for (let i = 0; i < 5; i++) {
    const x = 46 + i * 36, start = rng.range(26, 75), end = rng.range(248, 350);
    const points = [x, start, x - 13, start + 70, x - 9, end - 20, x - 17, end];
    brush(ctx, points, rng.range(4, 7), rng, '#21291e');
    brush(ctx, points.map((v, j) => j % 2 ? v : v - 2), rng.range(0.8, 1.7), rng, '#b3af94');
  }
  erosion(ctx, 256, 384, rng, 1400);
  return texture(image);
}

function decayTexture(rng) {
  const [image, ctx] = canvas(384, 384);
  // Accumulated mildew and ragged areas of plaster loss at floor level.
  for (let i = 0; i < 48; i++) {
    const x = rng.range(28, 356), y = rng.range(140, 330), radius = rng.range(14, 79);
    const gradient = ctx.createRadialGradient(x, y, 1, x, y, radius);
    gradient.addColorStop(0, 'rgba(15,25,16,0.25)');
    gradient.addColorStop(1, 'rgba(15,25,16,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  for (let i = 0; i < 21; i++) {
    const x = rng.range(38, 346), y = rng.range(130, 338), radius = rng.range(4, 28);
    ctx.beginPath();
    for (let point = 0; point < 9; point++) {
      const angle = point / 9 * Math.PI * 2, distance = radius * rng.range(0.5, 1.3);
      const px = x + Math.cos(angle) * distance, py = y + Math.sin(angle) * distance;
      if (!point) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = rng.pick(['rgba(95,91,74,0.65)', 'rgba(38,43,31,0.7)', 'rgba(119,113,94,0.55)']);
    ctx.fill();
    ctx.lineWidth = 0.7; ctx.strokeStyle = 'rgba(172,166,141,0.4)'; ctx.stroke();
  }
  erosion(ctx, 384, 384, rng, 2500);
  return texture(image);
}

function arrowTexture(rng) {
  const [image, ctx] = canvas(512, 256);
  lettering(ctx, 'GO BACK', 42, 8, 428, 117, rng, '#b8b596');
  brush(ctx, [68, 174, 223, 180, 434, 172], 9, rng, '#b8b596');
  brush(ctx, [373, 136, 436, 172, 377, 214], 9, rng, '#b8b596');
  erosion(ctx, 512, 256, rng, 2500);
  return texture(image);
}

export function buildHorrorGraffiti(level) {
  const rng = makeRng(level.seed ^ 0x47524146);
  const faces = [], rooms = new Map(), used = new Set();
  const liftRoom = level.liftRoom;
  for (const [x, y] of level.floorCells) {
    // Keep the entire lift room and its immediate border clean for wayfinding.
    if (x >= liftRoom.x - 1 && x <= liftRoom.x + liftRoom.w && y >= liftRoom.y - 1 && y <= liftRoom.y + liftRoom.h) continue;
    if (level.occupied.has(y * level.W + x)) continue;
    const wx = (x + 0.5) * CELL, wz = (y + 0.5) * CELL;
    if (level.hidingSpots?.some((spot) => Math.hypot(wx - spot.pos.x, wz - spot.pos.z) < 1.8)) continue;
    const room = level.roomAt(wx, wz);
    for (const [dx, dz] of DIRS) {
      if (!level.isWallCell(x + dx, y + dz)) continue;
      const face = { x, y, wx, wz, dx, dz, room, id: `${x},${y},${dx},${dz}` };
      faces.push(face);
      if (room) {
        if (!rooms.has(room.index)) rooms.set(room.index, []);
        rooms.get(room.index).push(face);
      }
    }
  }
  if (!faces.length) return { warnings: 0, marks: 0, directions: 0 };

  // Per-floor caches deliberately live only in this build. Level.dispose sees
  // each owned mesh and releases every shared material, map and geometry once.
  const materials = new Map(), geometry = new THREE.PlaneGeometry(1, 1);
  const materialFor = (key, createMap) => {
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({
      map: createMap(), transparent: true, depthWrite: false, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    return materials.get(key);
  };
  const place = (face, material, width, height, elevation, kind) => {
    const mesh = level.mesh(geometry, material,
      face.wx + face.dx * (CELL / 2 - 0.016), elevation,
      face.wz + face.dz * (CELL / 2 - 0.016));
    mesh.rotation.y = Math.atan2(-face.dx, -face.dz);
    mesh.rotation.z = kind === 'decay' ? 0 : rng.range(-0.035, 0.035);
    mesh.scale.set(width, height, 1);
    mesh.name = `horror-graffiti-${kind}`;
    mesh.userData.graffiti = true;
    mesh.renderOrder = 1;
    used.add(face.id);
    return mesh;
  };
  const result = { warnings: 0, marks: 0, directions: 0 };
  const messages = rng.shuffle([...WARNINGS]);
  const kinds = ['tallies', 'hands', 'scratches', 'decay'];
  const generators = { tallies: tallyTexture, hands: handsTexture, scratches: scratchTexture, decay: decayTexture };
  const sizes = { tallies: [1.0, 0.67, 1.38], hands: [0.95, 0.95, 1.31], scratches: [0.64, 1.05, 1.49], decay: [1.4, 1.3, 0.72] };
  const addMark = (face, kind) => {
    const variant = rng.int(0, 1), key = `${kind}-${variant}`;
    const material = materialFor(key, () => generators[kind](rng));
    const [width, height, y] = sizes[kind];
    place(face, material, width, height, y + rng.range(-0.12, 0.12), kind);
    result.marks++;
  };

  for (const roomFaces of rooms.values()) {
    const candidates = rng.shuffle([...roomFaces]);
    const face = candidates.shift();
    const text = messages[result.warnings % messages.length];
    place(face, materialFor(`warning-${text}`, () => warningTexture(text, rng)), 2.12, 0.88, rng.range(1.45, 1.85), 'warning');
    result.warnings++;
    const number = Math.min(4, candidates.length);
    for (let i = 0; i < number; i++) {
      const next = candidates[i];
      if (used.has(next.id)) continue;
      addMark(next, kinds[(i + result.warnings) % kinds.length]);
    }
  }

  // Sparse marks in connecting halls continue the story without adding props
  // to their narrow walking surface. Arrows follow the real lift flow field.
  const corridors = rng.shuffle(faces.filter((face) => !face.room));
  let corridorMarks = 0;
  for (const face of corridors) {
    if (corridorMarks >= 14) break;
    if (used.has(face.id)) continue;
    const waypoint = level.nextWaypoint(face.wx, face.wz, level.liftField);
    const alongWall = waypoint ? -face.dz * (waypoint.x - face.wx) + face.dx * (waypoint.z - face.wz) : 0;
    if (result.directions < 3 && Math.abs(alongWall) > CELL * 0.4) {
      // Flip the arrow artwork only: keep the painted words readable.
      const key = alongWall < 0 ? 'arrow-left' : 'arrow-right';
      const material = materialFor(key, () => {
        const map = arrowTexture(rng);
        if (alongWall < 0) {
          const [copy, ctx] = canvas(512, 256);
          ctx.drawImage(map.image, 0, 0, 512, 125, 0, 0, 512, 125);
          ctx.save(); ctx.translate(512, 0); ctx.scale(-1, 1);
          ctx.drawImage(map.image, 0, 125, 512, 131, 0, 125, 512, 131);
          ctx.restore();
          map.dispose();
          return texture(copy);
        }
        return map;
      });
      place(face, material, 1.52, 0.76, 1.42, 'direction');
      result.directions++;
    } else addMark(face, rng.pick(kinds));
    corridorMarks++;
    // Avoid decorating both sides of a single narrow corridor cell.
    for (const other of DIRS) used.add(`${face.x},${face.y},${other[0]},${other[1]}`);
  }
  return result;
}
