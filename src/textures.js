// Procedural canvas textures, so walls/floors need no downloads.
import * as THREE from 'three';
import { makeRng } from './rng.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function speckle(ctx, w, h, rng, count, alpha) {
  for (let i = 0; i < count; i++) {
    const v = rng.int(0, 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * rng.next()})`;
    ctx.fillRect(rng.int(0, w), rng.int(0, h), rng.int(1, 3), rng.int(1, 3));
  }
}

export function stoneWallTexture() {
  const rng = makeRng(7);
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#1c1916';
  ctx.fillRect(0, 0, 256, 256);
  const rowH = 32;
  for (let row = 0; row < 8; row++) {
    const offset = row % 2 ? 32 : 0;
    for (let col = -1; col < 5; col++) {
      const x = col * 64 + offset + 2;
      const y = row * rowH + 2;
      const l = rng.int(42, 66);
      ctx.fillStyle = `rgb(${l + 6},${l},${l - 6})`;
      ctx.fillRect(x, y, 60, rowH - 4);
      // Darker bottom edge for a bit of depth.
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x, y + rowH - 9, 60, 5);
    }
  }
  // Moss and damp stains.
  for (let i = 0; i < 14; i++) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rng.range(10, 40));
    const green = rng.chance(0.5);
    g.addColorStop(0, green ? 'rgba(40,60,20,0.35)' : 'rgba(10,8,6,0.4)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(rng.int(0, 256), rng.int(0, 256));
    ctx.fillStyle = g;
    ctx.fillRect(-40, -40, 80, 80);
    ctx.restore();
  }
  // Cracks.
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    let x = rng.int(0, 256), y = rng.int(0, 256);
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += rng.range(-14, 14);
      y += rng.range(-4, 14);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  speckle(ctx, 256, 256, rng, 2500, 0.12);
  return toTexture(c);
}

export function floorTexture() {
  const rng = makeRng(11);
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#0f0d0c';
  ctx.fillRect(0, 0, 256, 256);
  // Four irregular flagstones per tile.
  const cells = [[0, 0], [128, 0], [0, 128], [128, 128]];
  for (const [ox, oy] of cells) {
    const l = rng.int(34, 52);
    ctx.fillStyle = `rgb(${l},${l - 2},${l - 5})`;
    ctx.beginPath();
    ctx.moveTo(ox + rng.int(3, 8), oy + rng.int(3, 8));
    ctx.lineTo(ox + 128 - rng.int(3, 8), oy + rng.int(3, 8));
    ctx.lineTo(ox + 128 - rng.int(3, 8), oy + 128 - rng.int(3, 8));
    ctx.lineTo(ox + rng.int(3, 8), oy + 128 - rng.int(3, 8));
    ctx.closePath();
    ctx.fill();
  }
  for (let i = 0; i < 10; i++) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rng.range(15, 50));
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(rng.int(0, 256), rng.int(0, 256));
    ctx.fillStyle = g;
    ctx.fillRect(-50, -50, 100, 100);
    ctx.restore();
  }
  speckle(ctx, 256, 256, rng, 3000, 0.15);
  return toTexture(c);
}

export function ceilingTexture() {
  const rng = makeRng(13);
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#100e0d';
  ctx.fillRect(0, 0, 128, 128);
  speckle(ctx, 128, 128, rng, 1500, 0.15);
  return toTexture(c);
}

export function grateTexture() {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#6b6252';
  ctx.lineWidth = 5;
  for (let i = 0; i <= 128; i += 16) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke();
  }
  ctx.strokeStyle = '#d9a21b';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 118, 118);
  return toTexture(c);
}

// Soft round sprite used for glints, particles and noise rings.
export function glowTexture() {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,240,200,0.6)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  // Four-point star.
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(31, 4, 2, 56);
  ctx.fillRect(4, 31, 56, 2);
  return toTexture(c, false);
}

export function ringTexture() {
  const [c, ctx] = canvas(128, 128);
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.stroke();
  return toTexture(c, false);
}

// Text painted onto a transparent canvas: wall graffiti and signs.
export function textTexture(text, { color = '#c21d1d', font = '48px "Creepster", "Chiller", fantasy', w = 512, h = 128, glow = false } = {}) {
  const [c, ctx] = canvas(w, h);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
  }
  ctx.fillStyle = color;
  const lines = text.split('\n');
  const lh = h / lines.length;
  lines.forEach((line, i) => ctx.fillText(line, w / 2, lh * (i + 0.5)));
  return toTexture(c, false);
}

export function labelTexture(text, color) {
  const [c, ctx] = canvas(128, 64);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(14, 8, 100, 48, 14);
  ctx.fill();
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 33);
  return toTexture(c, false);
}
