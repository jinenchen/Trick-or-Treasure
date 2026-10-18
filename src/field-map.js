// The intern's folded evacuation plan. Each viewport owns its own live sheet.
import { CELL } from './config.js';

const SIZE = 600, MARGIN = 27;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// Follow the same distance field as the wayfinding arrow, retaining the turns
// through corridors. Drawing a straight line would lead players into walls.
export function elevatorRoute(level, pos) {
  let [x, y] = level.worldToCell(pos.x, pos.z);
  const route = [{ x: pos.x, z: pos.z }];
  let distance = level.liftField[y * level.W + x];
  if (distance == null || distance < 0) return route;
  for (let steps = 0; distance > 0 && steps < level.W * level.H; steps++) {
    const next = DIRS.find(([dx, dy]) => !level.isWallCell(x + dx, y + dy)
      && level.liftField[(y + dy) * level.W + x + dx] === distance - 1);
    if (!next) break;
    x += next[0]; y += next[1]; distance--;
    route.push({ x: (x + 0.5) * CELL, z: (y + 0.5) * CELL });
  }
  route.push(level.liftPos);
  return route;
}

function coverPosition(spot) {
  return spot.pos || spot.position || spot;
}

function coverIcon(ctx, x, y, kind, occupied = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = occupied ? '#8e4936' : '#4e5841';
  ctx.fillStyle = '#d6cfb1';
  ctx.lineWidth = 2.3;
  if (kind === 'locker') {
    ctx.fillRect(-5, -8, 10, 16);
    ctx.strokeRect(-5, -8, 10, 16);
    ctx.beginPath();
    for (const yy of [-4, -1]) { ctx.moveTo(-2.5, yy); ctx.lineTo(2.5, yy); }
    ctx.moveTo(2, 3); ctx.lineTo(2, 5); ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-8, -5); ctx.lineTo(8, -5);
    ctx.moveTo(-6, -5); ctx.lineTo(-6, 6);
    ctx.moveTo(6, -5); ctx.lineTo(6, 6); ctx.stroke();
  }
  ctx.restore();
}

export class FieldMap {
  constructor(parent, keys) {
    this.el = document.createElement('section');
    this.el.className = 'field-map';
    this.el.setAttribute('aria-label', 'Facility evacuation map');
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML = `
      <div class="map-eyebrow"><span>GRIMCO / FACILITIES DIV.</span><span class="map-floor"></span></div>
      <div class="map-title">EMERGENCY FLOOR PLAN</div>
      <div class="map-subtitle">RETURN TO THE ELEVATOR BEFORE MIDNIGHT</div>
      <canvas class="map-canvas" width="${SIZE}" height="${SIZE}" role="img" aria-label="Floor plan showing your location, hiding places and the route to the elevator"></canvas>
      <div class="map-legend"><span><b class="map-you">▲</b> you / facing</span><span><b class="map-elevator">E</b> elevator</span><span><b>▯</b> locker</span><span><b>⊓</b> table</span></div>
      <div class="map-footer"><span>[${keys.map}] / [Y] put away</span><span class="map-warning">STAY ALERT.</span></div>`;
    parent.appendChild(this.el);
    this.floorEl = this.el.querySelector('.map-floor');
    this.canvas = this.el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = SIZE; this.base.height = SIZE;
    this.level = null;
    this.open = false;
    this.drawTimer = 0;
  }

  prepare(level) {
    this.level = level;
    this.scale = (SIZE - MARGIN * 2) / Math.max(level.W, level.H);
    this.offsetX = (SIZE - level.W * this.scale) / 2;
    this.offsetY = (SIZE - level.H * this.scale) / 2;
    const ctx = this.base.getContext('2d'), s = this.scale;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = '#544d3b16';
    ctx.fillRect(this.offsetX, this.offsetY, level.W * s, level.H * s);
    ctx.strokeStyle = '#6b624329';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let x = 0; x <= level.W; x++) {
      const xx = this.offsetX + x * s;
      ctx.moveTo(xx, this.offsetY); ctx.lineTo(xx, this.offsetY + level.H * s);
    }
    for (let y = 0; y <= level.H; y++) {
      const yy = this.offsetY + y * s;
      ctx.moveTo(this.offsetX, yy); ctx.lineTo(this.offsetX + level.W * s, yy);
    }
    ctx.stroke();
    for (let y = 0; y < level.H; y++) for (let x = 0; x < level.W; x++) {
      if (level.isWallCell(x, y)) continue;
      const xx = this.offsetX + x * s, yy = this.offsetY + y * s;
      ctx.fillStyle = '#e1d9bb';
      ctx.fillRect(xx, yy, s + 0.2, s + 0.2);
    }
    ctx.strokeStyle = '#514c3a'; ctx.lineWidth = 2.1;
    ctx.beginPath();
    for (let y = 0; y < level.H; y++) for (let x = 0; x < level.W; x++) {
      if (level.isWallCell(x, y)) continue;
      const xx = this.offsetX + x * s, yy = this.offsetY + y * s;
      if (level.isWallCell(x, y - 1)) { ctx.moveTo(xx, yy); ctx.lineTo(xx + s, yy); }
      if (level.isWallCell(x, y + 1)) { ctx.moveTo(xx, yy + s); ctx.lineTo(xx + s, yy + s); }
      if (level.isWallCell(x - 1, y)) { ctx.moveTo(xx, yy); ctx.lineTo(xx, yy + s); }
      if (level.isWallCell(x + 1, y)) { ctx.moveTo(xx + s, yy); ctx.lineTo(xx + s, yy + s); }
    }
    ctx.stroke();
    ctx.fillStyle = '#756b4e8c'; ctx.font = '13px monospace'; ctx.textAlign = 'left';
    for (const room of level.rooms) {
      ctx.fillText(String(room.index + 1).padStart(2, '0'), this.offsetX + room.x * s + 5, this.offsetY + room.y * s + 15);
    }
    ctx.fillStyle = '#514c3a'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
    ctx.fillText('N ↑', SIZE - 44, 17);
    ctx.font = '11px monospace'; ctx.textAlign = 'left';
    ctx.fillText('--- ELEVATOR ROUTE', MARGIN, SIZE - 10);
    this.floorEl.textContent = `BASEMENT ${String(level.floor).padStart(2, '0')}`;
  }

  point(pos) {
    return [this.offsetX + pos.x / CELL * this.scale, this.offsetY + pos.z / CELL * this.scale];
  }

  update(level, player, players, dt) {
    const open = !!player.mapOpen && player.alive;
    if (open !== this.open) {
      this.open = open;
      this.el.classList.toggle('open', open);
      this.el.setAttribute('aria-hidden', String(!open));
      this.drawTimer = 0;
    }
    if (!open) return;
    this.drawTimer -= dt;
    if (this.drawTimer > 0 && this.level === level) return;
    this.drawTimer = 1 / 15;
    if (this.level !== level) this.prepare(level);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(this.base, 0, 0);

    // A pencilled route stays on walkable cells and updates as you move.
    const route = elevatorRoute(level, player.pos);
    ctx.strokeStyle = '#8b503b'; ctx.lineWidth = 2.5; ctx.setLineDash([5, 5]);
    ctx.beginPath();
    route.forEach((pos, i) => {
      const [x, y] = this.point(pos);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke(); ctx.setLineDash([]);
    for (const spot of level.hidingSpots || []) {
      const pos = coverPosition(spot);
      if (Number.isFinite(pos.x) && Number.isFinite(pos.z)) {
        const [x, y] = this.point(pos);
        coverIcon(ctx, x, y, spot.kind, !!spot.occupant);
      }
    }
    const [ex, ey] = this.point(level.liftPos);
    ctx.fillStyle = '#3b513a'; ctx.fillRect(ex - 10, ey - 10, 20, 20);
    ctx.strokeStyle = '#e1d9bb'; ctx.lineWidth = 2; ctx.strokeRect(ex - 10, ey - 10, 20, 20);
    ctx.fillStyle = '#eee5c7'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
    ctx.fillText('E', ex, ey + 5.5);

    for (const other of players) {
      if (other === player || !other.alive) continue;
      const [x, y] = this.point(other.pos);
      ctx.fillStyle = '#38635d'; ctx.strokeStyle = '#e1d9bb'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = 'bold 12px monospace'; ctx.fillText(other.name, x, y - 12);
    }
    const [px, py] = this.point(player.pos);
    ctx.save(); ctx.translate(px, py); ctx.rotate(Math.PI - player.yaw);
    ctx.fillStyle = '#a73d2e28';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 28, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#a1392d'; ctx.strokeStyle = '#f4eacd'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7.5, 8); ctx.lineTo(0, 4); ctx.lineTo(-7.5, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
