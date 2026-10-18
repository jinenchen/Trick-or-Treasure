// Seeded, distressed industrial surfaces. Everything is generated locally so
// lighting and material detail remain available without external asset hosts.
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

function mottles(ctx, size, rng, count, color, opacity = 0.24) {
  for (let i = 0; i < count; i++) {
    const radius = rng.range(size * 0.02, size * 0.23);
    const x = rng.range(0, size), y = rng.range(0, size);
    // Wrap marks across the boundary so the material tiles without clean edges.
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, radius);
      g.addColorStop(0, `rgba(${color},${opacity})`);
      g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - radius, y + oy - radius, radius * 2, radius * 2);
    }
  }
}

function cracks(ctx, size, rng, count) {
  ctx.lineWidth = 0.8;
  for (let i = 0; i < count; i++) {
    let x = rng.range(0, size), y = rng.range(0, size);
    ctx.strokeStyle = `rgba(15,18,15,${rng.range(0.25, 0.62)})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < rng.int(5, 15); k++) {
      x += rng.range(-15, 17);
      y += rng.range(3, 20);
      ctx.lineTo(x, y);
      if (rng.chance(0.3)) {
        ctx.lineTo(x + rng.range(-15, 15), y + rng.range(8, 23));
        ctx.moveTo(x, y);
      }
    }
    ctx.stroke();
  }
}

// Scalar maps are deliberately linear, unlike the sRGB color maps. Small relief
// catches a moving flashlight; dark damp patches have a lower roughness.
export function surfaceMaps(map, { wet = false } = {}) {
  const { width, height } = map.image;
  const [heightCanvas, heightCtx] = canvas(width, height);
  const [roughCanvas, roughCtx] = canvas(width, height);
  const source = map.image.getContext('2d').getImageData(0, 0, width, height);
  const relief = heightCtx.createImageData(width, height);
  const rough = roughCtx.createImageData(width, height);
  for (let i = 0; i < source.data.length; i += 4) {
    const l = source.data[i] * 0.25 + source.data[i + 1] * 0.6 + source.data[i + 2] * 0.15;
    const h = Math.min(255, l * 1.4 + 35);
    const r = wet ? Math.min(242, 75 + l * 1.8) : Math.min(255, 170 + l * 0.65);
    relief.data[i] = relief.data[i + 1] = relief.data[i + 2] = h;
    rough.data[i] = rough.data[i + 1] = rough.data[i + 2] = r;
    relief.data[i + 3] = rough.data[i + 3] = 255;
  }
  heightCtx.putImageData(relief, 0, 0);
  roughCtx.putImageData(rough, 0, 0);
  const bumpMap = toTexture(heightCanvas), roughnessMap = toTexture(roughCanvas);
  bumpMap.colorSpace = roughnessMap.colorSpace = THREE.NoColorSpace;
  return { bumpMap, roughnessMap };
}

export function stoneWallTexture() {
  const rng = makeRng(7);
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#838277';
  ctx.fillRect(0, 0, 512, 512);
  mottles(ctx, 512, rng, 65, '24,25,18', 0.22);
  // The lower half has failing institutional paint, with a ragged edge.
  ctx.fillStyle = '#4c5348';
  ctx.beginPath();
  ctx.moveTo(0, 512);
  ctx.lineTo(0, 236);
  for (let x = 0; x <= 512; x += 4) ctx.lineTo(x, 236 + rng.range(-3, 3));
  ctx.lineTo(512, 512); ctx.fill();
  for (let i = 0; i < 700; i++) {
    const x = rng.range(0, 512), y = rng.range(230, 512);
    ctx.fillStyle = rng.chance(0.6) ? 'rgba(151,145,125,0.45)' : 'rgba(24,30,24,0.3)';
    ctx.fillRect(x, y, rng.range(1, 10), rng.range(1, 4));
  }
  mottles(ctx, 512, rng, 35, '12,16,12', 0.3);
  for (let i = 0; i < 100; i++) {
    const x = rng.range(0, 512), y = rng.range(0, 390), h = rng.range(12, 220);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, `rgba(41,30,19,${rng.range(0.08, 0.32)})`);
    g.addColorStop(1, 'rgba(23,25,19,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, rng.range(1, 7), h);
  }
  cracks(ctx, 512, rng, 13);
  ctx.fillStyle = 'rgba(15,19,15,0.5)';
  ctx.fillRect(0, 0, 2, 512);
  ctx.fillRect(0, 0, 512, 2);
  // Recesses left by concrete formwork.
  for (const x of [36, 476]) for (const y of [56, 440]) {
    ctx.fillStyle = 'rgba(22,23,18,0.6)';
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(175,169,148,0.35)';
    ctx.fillRect(x - 2, y + 3, 5, 1);
  }
  speckle(ctx, 512, 512, rng, 18000, 0.2);
  return toTexture(c);
}

export function floorTexture() {
  const rng = makeRng(11);
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#272a25';
  ctx.fillRect(0, 0, 512, 512);
  const cells = [[0, 0], [256, 0], [0, 256], [256, 256]];
  for (const [ox, oy] of cells) {
    const l = rng.int(76, 90);
    ctx.fillStyle = `rgb(${l},${l + 1},${l - 7})`;
    ctx.fillRect(ox + 1, oy + 1, 254, 254);
  }
  mottles(ctx, 512, rng, 70, '8,15,11', 0.3);
  mottles(ctx, 512, rng, 20, '68,43,24', 0.18);
  cracks(ctx, 512, rng, 15);
  for (let i = 0; i < 180; i++) {
    ctx.strokeStyle = `rgba(159,154,128,${rng.range(0.04, 0.18)})`;
    const x = rng.range(0, 512), y = rng.range(0, 512);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rng.range(4, 55), y + rng.range(-2, 2)); ctx.stroke();
  }
  speckle(ctx, 512, 512, rng, 22000, 0.18);
  return toTexture(c);
}

export function ceilingTexture() {
  const rng = makeRng(13);
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#45483f';
  ctx.fillRect(0, 0, 256, 256);
  mottles(ctx, 256, rng, 35, '4,10,5', 0.3);
  cracks(ctx, 256, rng, 8);
  ctx.fillStyle = '#242821';
  ctx.fillRect(0, 0, 256, 3);
  ctx.fillRect(0, 0, 3, 256);
  speckle(ctx, 256, 256, rng, 6500, 0.17);
  return toTexture(c);
}

export function grateTexture() {
  const rng = makeRng(23);
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#101510';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#6a6958';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 128; i += 8) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke();
    if (i % 16 === 0) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke(); }
  }
  mottles(ctx, 128, rng, 20, '83,39,15', 0.45);
  speckle(ctx, 128, 128, rng, 1600, 0.15);
  return toTexture(c);
}

export function rustTexture() {
  const rng = makeRng(59);
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#56594e';
  ctx.fillRect(0, 0, 256, 256);
  mottles(ctx, 256, rng, 95, '89,39,14', 0.4);
  mottles(ctx, 256, rng, 40, '13,21,17', 0.35);
  for (let i = 0; i < 180; i++) {
    ctx.fillStyle = rng.chance(0.7) ? 'rgba(120,66,30,0.4)' : 'rgba(175,178,154,0.15)';
    ctx.fillRect(rng.range(0, 256), rng.range(0, 256), rng.range(1, 3), rng.range(2, 70));
  }
  speckle(ctx, 256, 256, rng, 6500, 0.24);
  return toTexture(c);
}

export function hazardTexture() {
  const rng = makeRng(91);
  const [c, ctx] = canvas(256, 64);
  ctx.fillStyle = '#93825a';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#242823';
  for (let x = -64; x < 320; x += 64) {
    ctx.beginPath(); ctx.moveTo(x, 64); ctx.lineTo(x + 64, 0);
    ctx.lineTo(x + 96, 0); ctx.lineTo(x + 32, 64); ctx.fill();
  }
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = 'rgba(89,87,73,0.7)';
    ctx.fillRect(rng.range(0, 256), rng.range(0, 64), rng.range(1, 8), rng.range(1, 3));
  }
  speckle(ctx, 256, 64, rng, 1800, 0.25);
  return toTexture(c);
}

export function employmentNoticeTexture() {
  const rng = makeRng(731);
  const [c, ctx] = canvas(384, 512);
  // An abandoned application form: the paper is scenery, never an interaction.
  ctx.fillStyle = '#b1ad93';
  ctx.beginPath();
  ctx.moveTo(8, 4); ctx.lineTo(376, 7); ctx.lineTo(379, 501);
  for (let x = 379; x > 5; x -= 9) ctx.lineTo(x, 502 - rng.range(0, 10));
  ctx.lineTo(5, 10); ctx.fill();
  mottles(ctx, 384, rng, 20, '63,51,29', 0.12);
  ctx.fillStyle = '#353c32';
  ctx.font = 'bold 43px monospace';
  ctx.fillText('GRIMCO', 30, 64);
  ctx.font = 'bold 16px monospace';
  ctx.fillText('APPLICATION FOR EMPLOYMENT', 30, 101);
  ctx.fillRect(30, 114, 324, 2);
  ctx.font = '14px monospace';
  const lines = [
    'POSITION: NIGHT RECOVERY', '',
    'NAME ______________________', '',
    'NEXT OF KIN _______________', '',
    'PREVIOUS EMPLOYER _________', '',
    'I CONSENT TO THE DESCENT.', '',
    'SIGNATURE _________________',
  ];
  lines.forEach((line, i) => ctx.fillText(line, 30, 146 + i * 23));
  ctx.save();
  ctx.translate(197, 433); ctx.rotate(-0.13);
  ctx.strokeStyle = '#6b3e30'; ctx.lineWidth = 3;
  ctx.strokeRect(-123, -24, 246, 45);
  ctx.fillStyle = '#6b3e30'; ctx.font = 'bold 25px monospace';
  ctx.textAlign = 'center'; ctx.fillText('POSITION VACANT', 0, 7);
  ctx.restore();
  ctx.fillStyle = 'rgba(241,230,198,0.3)';
  ctx.fillRect(188, 8, 2, 483);
  ctx.fillStyle = 'rgba(43,41,26,0.15)';
  ctx.fillRect(190, 8, 2, 483);
  speckle(ctx, 384, 512, rng, 6000, 0.12);
  return toTexture(c, false);
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
export function textTexture(text, { color = '#786253', font = 'bold 40px monospace', w = 512, h = 128, glow = false } = {}) {
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
