// TRICK OR TREASURE: game bootstrap, world state, floor flow, rendering.
import * as THREE from 'three';
import { loadAssets } from './assets.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { Hud } from './hud.js';
import { Fx } from './fx.js';
import { Film } from './film.js';
import { Jumpscares } from './jumpscare.js';
import { Encounters } from './encounters.js';
import { Gadgets } from './gadgets.js';
import { Level } from './level.js';
import { Player } from './player.js';
import { Item, spawnLoot, SOUL_TYPE } from './loot.js';
import { Skeleton } from './entities/skeleton.js';
import { Zombie } from './entities/zombie.js';
import { Ghost } from './entities/ghost.js';
import { Spider, Lizard, ThiefBug, Mimic } from './entities/facility-creatures.js';
import { bossLine } from './boss.js';
import { makeRng } from './rng.js';
import { CELL, FLASH, NIGHT, NOISE, quotaForFloor, monstersForFloor } from './config.js';

const SPECIES = { skeleton: Skeleton, zombie: Zombie, ghost: Ghost, spider: Spider, lizard: Lizard, thief: ThiefBug, mimic: Mimic };
const params = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);

const UPGRADES = [
  { id: 'battery', name: 'Lithium Batteries', desc: '+40% flashlight battery', cost: (l) => 80 + 60 * l, max: 3 },
  { id: 'grip', name: 'Grippy Gloves', desc: 'Loot takes 20% less damage', cost: (l) => 90 + 70 * l, max: 3 },
  { id: 'cardio', name: 'Cardio Program', desc: '+35% stamina, +6% speed', cost: (l) => 70 + 50 * l, max: 3 },
  { id: 'insurance', name: 'Life Insurance', desc: 'Respawn at the lift once', cost: () => 150, max: 3 },
];

class Game {
  constructor() {
    this.canvas = $('#game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.film = new Film(this.renderer);
    this.picture = { brightness: 1, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
    try {
      const saved = JSON.parse(localStorage.getItem('grimco-picture'));
      if (saved) {
        this.picture.brightness = Math.max(0.7, Math.min(1.6, Number(saved.brightness) || 1));
        this.picture.reduced = this.picture.reduced || !!saved.reduced;
      }
    } catch { /* Storage is optional in private browsing. */ }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050706);
    this.scene.fog = new THREE.FogExp2(0x090c0a, 0.045);
    this.scene.add(new THREE.AmbientLight(0x8c9580, 0.16));

    this.input = new Input(this.canvas);
    this.sound = new Sound();
    this.jumpscares = new Jumpscares(this);
    this.gadgets = new Gadgets(this);
    this.encounters = null;
    this.hud = new Hud();
    this.fx = new Fx(this.scene);
    this.clockRaf = new THREE.Clock();

    this.state = 'loading';
    this.players = [];
    this.items = [];
    this.monsters = [];
    this.noises = [];
    this.noiseId = 0;
    this.timers = [];
    this.time = 0;
    this.floor = 1;
    this.cash = 0;
    this.quota = 0;
    this.clockTime = 0;
    this.ghostNear = 0;
    this.upgrades = { battery: 0, grip: 0, cardio: 0 };
    this.seen = new Set();
    this.rng = makeRng(1);
    this.radioCooldown = 0;
    this.titleCam = new THREE.PerspectiveCamera(60, 1, 0.1, 80);

    addEventListener('resize', () => this.resize());
    this.resize();
    this.bindUi();
  }

  async init() {
    const bar = $('#load-fill');
    await loadAssets((p) => { bar.style.width = `${Math.round(p * 100)}%`; });
    // Graffiti and signs are painted with web fonts, so wait for them briefly.
    if (!params.has('test')) {
      await Promise.race([
        Promise.all([document.fonts.load('48px "Creepster"'), document.fonts.load('40px "Special Elite"')]),
        new Promise((r) => setTimeout(r, 2500)),
      ]).catch(() => {});
    }
    $('#loading').classList.add('hidden');
    $('#title-buttons').classList.remove('hidden');
    this.buildTitleScene();
    this.state = 'title';
    this.loop();
    const auto = parseInt(params.get('auto'), 10);
    if (auto === 1 || auto === 2) this.startRun(auto, { skipNotice: true });
  }

  // ---------- UI wiring ----------

  bindUi() {
    const savePicture = () => {
      try { localStorage.setItem('grimco-picture', JSON.stringify(this.picture)); } catch { /* Optional. */ }
      for (const el of document.querySelectorAll('[data-brightness]')) el.value = this.picture.brightness;
      for (const el of document.querySelectorAll('[data-reduced]')) el.checked = this.picture.reduced;
    };
    for (const el of document.querySelectorAll('[data-brightness]')) {
      el.value = this.picture.brightness;
      el.addEventListener('input', () => { this.picture.brightness = Number(el.value); savePicture(); });
    }
    for (const el of document.querySelectorAll('[data-reduced]')) {
      el.checked = this.picture.reduced;
      el.addEventListener('change', () => { this.picture.reduced = el.checked; savePicture(); });
    }
    $('#btn-1p').addEventListener('click', () => this.startRun(1));
    $('#btn-2p').addEventListener('click', () => this.startRun(2));
    $('#btn-notice').addEventListener('click', () => this.closeNotice());
    $('#btn-resume').addEventListener('click', () => this.setPaused(false));
    $('#btn-quit').addEventListener('click', () => this.toTitle());
    $('#btn-retry').addEventListener('click', () => this.startRun(this.numPlayers));
    $('#btn-title').addEventListener('click', () => this.toTitle());
    $('#btn-descend').addEventListener('click', () => this.leaveShop());
    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing') this.input.requestPointerLock();
    });
    this.input.onUnlock = () => {
      if (this.state === 'playing') this.setPaused(true);
    };
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') {
        const muted = this.sound.toggleMute();
        $('#mute-indicator').classList.toggle('hidden', !muted);
      }
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.state === 'playing') this.setPaused(true);
        // The same Esc may also have released the mouse lock and paused us already.
        else if (this.state === 'paused' && performance.now() - this.pausedAt > 300) this.setPaused(false);
      }
      const confirm = e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter';
      if (confirm && this.state === 'notice') this.closeNotice();
      else if (confirm && this.state === 'shop') this.leaveShop();
      else if (confirm && this.state === 'gameover' && this.gameoverReady) this.startRun(this.numPlayers);
      if (this.state === 'shop' && /^Digit[1-4]$/.test(e.code)) this.buy(UPGRADES[+e.code.slice(5) - 1].id);
    });
  }

  screen(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  }

  fade(on) {
    $('#fade').classList.toggle('on', on);
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.canvas.style.width = `${innerWidth}px`;
    this.canvas.style.height = `${innerHeight}px`;
  }

  // ---------- title backdrop ----------

  buildTitleScene() {
    this.clearFloor();
    this.level = new Level(1, 4242);
    this.level.build(this.scene);
    this.level.group.getObjectByName('lift-wayfinding').visible = false;
    const lp = this.level.liftPos;
    const sk = new Skeleton(this);
    sk.place({ x: lp.x + 2.2, z: lp.z + 1.2 });
    sk.yaw = -2.2;
    sk.sync();
    const zb = new Zombie(this);
    zb.place({ x: lp.x - 2.4, z: lp.z - 1.4 });
    zb.yaw = 0.9;
    zb.anim.play('walk', { timeScale: 0.4 });
    zb.sync();
    this.titleMonsters = [sk, zb];
    this.monsters = [];
  }

  updateTitle(dt) {
    const lp = this.level.liftPos;
    const t = this.time * 0.12;
    this.titleCam.position.set(lp.x + Math.sin(t) * 3.6, 2.1, lp.z + Math.cos(t) * 3.6);
    this.titleCam.lookAt(lp.x, 1.1, lp.z);
    for (const m of this.titleMonsters || []) m.anim.update(dt);
    this.level.update(this.time);
  }

  // ---------- run / floor flow ----------

  startRun(numPlayers, { skipNotice = false } = {}) {
    this.sound.init();
    this.sound.click();
    this.numPlayers = numPlayers;
    this.run = { delivered: 0, broken: 0, deaths: 0, wallet: 0, insurance: numPlayers === 1 ? 1 : 0, floorsCleared: 0 };
    this.upgrades = { battery: 0, grip: 0, cardio: 0 };
    this.seen = new Set();
    for (const p of this.players) p.dispose();
    this.players = [];
    this.skipNotice = skipNotice;
    this.startFloor(parseInt(params.get('floor'), 10) || 1);
  }

  clearFloor() {
    this.gadgets.clear();
    this.encounters?.dispose();
    this.encounters = null;
    this.jumpscares.dispose();
    for (const it of this.items) it.dispose();
    for (const m of this.monsters) m.dispose();
    for (const m of this.titleMonsters || []) m.dispose();
    this.titleMonsters = null;
    this.items = [];
    this.monsters = [];
    this.noises = [];
    this.timers = [];
    this.fx.clear();
    if (this.level) this.level.dispose(this.scene);
    this.level = null;
  }

  startFloor(floor) {
    this.clearFloor();
    this.floor = floor;
    const seedParam = parseInt(params.get('seed'), 10);
    const seed = Number.isFinite(seedParam) ? seedParam * 977 + floor : (Math.random() * 1e9) | 0;
    this.rng = makeRng(seed ^ 0x5bd1e995);
    this.level = new Level(floor, seed);
    this.level.build(this.scene);
    this.quota = quotaForFloor(floor);
    this.cash = 0;
    this.clockTime = 0;
    this.lowTimeWarned = false;
    this.quotaAnnounced = false;
    this.departTimer = 3;
    this.firstCrack = true;
    this.encounterScared = false;

    if (!this.players.length) {
      for (let i = 0; i < this.numPlayers; i++) this.players.push(new Player(i, this));
    }
    const lp = this.level.liftPos;
    const yaw = this.facingOutOfLift();
    this.players.forEach((p, i) => {
      p.battery = p.batteryMax;
      p.soulJar = null;
      p.spawn(lp.x + (this.players.length > 1 ? (i ? 0.6 : -0.6) : 0), lp.z, yaw);
    });

    this.encounters = new Encounters(this);
    this.encounters.generate();
    this.items = spawnLoot(this, this.rng, this.quota);
    for (const id of monstersForFloor(floor)) {
      const m = new SPECIES[id](this);
      const spot = (id === 'spider' ? this.spiderPerch() : null)
        || this.level.takeSpot(this.rng, { minLiftDist: 20, farthest: true }) || this.level.randomFloorPoint(this.rng);
      m.place(spot);
      this.monsters.push(m);
    }

    this.jumpscares.prepare(this.monsters, this.players);

    this.hud.setup(this.players, this.numPlayers === 1);
    this.hud.show(true);
    this.hud.lift(null);
    this.hud.update(this, 0);
    this.fade(false);

    const fresh = monstersForFloor(floor).filter((id, i, a) => a.indexOf(id) === i && !this.seen.has(id));
    fresh.forEach((id) => this.seen.add(id));
    if (fresh.length && !this.skipNotice) this.showNotice(fresh);
    else this.beginFloor();
  }

  spiderPerch() {
    const level = this.level;
    const candidates = [];
    for (const [x, z] of level.floorCells) {
      if (level.occupied.has(z * level.W + x) || level.liftField[z * level.W + x] * CELL < 18) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (level.isWallCell(x + dx, z + dz)) candidates.push({ x, z, dx, dz });
      }
    }
    if (!candidates.length) return null;
    const perch = this.rng.pick(candidates);
    level.occupied.add(perch.z * level.W + perch.x);
    const pos = level.cellCenter(perch.x, perch.z);
    pos.x += perch.dx * (CELL * 0.5 - 0.7);
    pos.z += perch.dz * (CELL * 0.5 - 0.7);
    return pos;
  }

  facingOutOfLift() {
    // Face the direction with the most open floor.
    const lp = this.level.liftPos;
    let best = 0, bestLen = -1;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      let len = 0;
      while (len < 30 && !this.level.isWallAt(lp.x + Math.sin(a) * len, lp.z + Math.cos(a) * len)) len += 0.5;
      if (len > bestLen) { bestLen = len; best = a; }
    }
    return best;
  }

  showNotice(ids) {
    this.state = 'notice';
    this.input.releasePointerLock();
    const cards = ids.map((id) => {
      const n = SPECIES[id].notice;
      return `<div class="specimen"><div class="code">${n.code}</div><h3>${n.name}</h3><p>${n.rule}</p><p class="tip">${n.tip}</p></div>`;
    }).join('');
    const orientation = this.floor === 1 ? `
      <div class="orientation">
        <p><b>Your job:</b> find cursed valuables in the dark, carry them to the <b>LIFT</b> and hit the
        quota before <b>midnight</b>. Loot cracks when it hits walls, and every crack costs you.</p>
        <p>Coffins are heavy: ${this.numPlayers > 1 ? 'grab one together to carry it properly.' : 'you can drag one, slowly.'}
        The lift is safe ground. Nothing follows you onto it.</p>
        <p><b>Hide:</b> ${this.numPlayers > 1 ? 'Q / Backspace' : 'Q'} at lockers or worktables. Set down loot first;
        keep your light off and get out of sight before entering. <b>Map:</b> ${this.numPlayers > 1 ? 'Tab / &#92;' : 'Tab'}.
        Follow the elevator arrow home. Reading the map does not stop the clock.</p>
      </div>` : '';
    $('#notice-floor').textContent = `HOLLOWMERE CATACOMBS · LEVEL B${this.floor}`;
    $('#notice-body').innerHTML = orientation + cards;
    this.screen('notice');
  }

  closeNotice() {
    if (this.state !== 'notice') return;
    this.sound.click();
    this.screen(null);
    this.beginFloor();
  }

  beginFloor() {
    this.screen(null);
    this.state = 'playing';
    this.say('floorStart', { floor: this.floor, quota: this.quota }, true);
  }

  descend() {
    if (this.state !== 'playing') return;
    this.state = 'descending';
    this.hud.lift(null);
    this.sound.bell();
    this.input.releasePointerLock();
    this.fade(true);
    const bonus = Math.max(0, this.cash - this.quota);
    const pay = 40 * this.floor;
    this.run.wallet += bonus + pay;
    this.run.floorsCleared++;
    for (const p of this.players) if (p.holding) this.release(p);
    setTimeout(() => this.openShop(bonus, pay), 1300);
  }

  openShop(bonus, pay) {
    this.state = 'shop';
    this.hud.show(false);
    $('#shop-title').textContent = `LEVEL B${this.floor} CLEARED`;
    $('#shop-summary').innerHTML = `
      <div><span>Delivered</span><b>$${this.cash}</b></div>
      <div><span>Quota</span><b>$${this.quota}</b></div>
      <div><span>Over-quota bonus</span><b>+$${bonus}</b></div>
      <div><span>Hazard pay</span><b>+$${pay}</b></div>`;
    bossLine('floorDone', { cash: this.cash, broken: this.run.broken }).then((l) => { $('#shop-boss').textContent = `"${l}"`; });
    this.renderShop();
    this.screen('shop');
    this.fade(false);
  }

  renderShop() {
    $('#shop-wallet').textContent = `$${this.run.wallet}`;
    $('#shop-items').innerHTML = UPGRADES.map((u, i) => {
      const lvl = u.id === 'insurance' ? this.run.insurance : this.upgrades[u.id];
      const cost = u.cost(lvl);
      const maxed = lvl >= u.max;
      const afford = this.run.wallet >= cost;
      return `<button class="shop-item ${maxed ? 'maxed' : afford ? '' : 'poor'}" data-id="${u.id}">
        <span class="key">${i + 1}</span><b>${u.name}</b><small>${u.desc}</small>
        <span class="lvl">${'■'.repeat(lvl)}${'□'.repeat(Math.max(0, u.max - lvl))}</span>
        <span class="cost">${maxed ? 'MAXED' : `$${cost}`}</span></button>`;
    }).join('');
    for (const b of document.querySelectorAll('.shop-item')) b.addEventListener('click', () => this.buy(b.dataset.id));
    $('#btn-descend').textContent = `Descend to B${this.floor + 1}  ▼`;
  }

  buy(id) {
    const u = UPGRADES.find((x) => x.id === id);
    const lvl = id === 'insurance' ? this.run.insurance : this.upgrades[id];
    const cost = u.cost(lvl);
    if (lvl >= u.max || this.run.wallet < cost) return;
    this.run.wallet -= cost;
    if (id === 'insurance') this.run.insurance++;
    else this.upgrades[id]++;
    this.sound.cash();
    this.renderShop();
  }

  leaveShop() {
    if (this.state !== 'shop') return;
    this.sound.click();
    this.screen(null);
    this.startFloor(this.floor + 1);
  }

  fired(reason) {
    if (this.state === 'gameover') return;
    this.jumpscares.clear();
    this.state = 'gameover';
    this.gameoverReady = false;
    setTimeout(() => { this.gameoverReady = true; }, 1200);
    this.input.releasePointerLock();
    this.sound.sting();
    this.sound.setDanger(0);
    this.sound.setWhisper(0);
    this.hud.show(false);
    $('#gameover-reason').textContent = reason === 'midnight' ? 'Midnight struck before you made quota.' : 'The whole crew is dead.';
    $('#gameover-stats').innerHTML = `
      <div><span>Deepest level</span><b>B${this.floor}</b></div>
      <div><span>Levels cleared</span><b>${this.run.floorsCleared}</b></div>
      <div><span>Total delivered</span><b>$${this.run.delivered}</b></div>
      <div><span>Loot shattered</span><b>${this.run.broken}</b></div>
      <div><span>Deaths</span><b>${this.run.deaths}</b></div>`;
    $('#gameover-boss').textContent = '';
    bossLine('fired', {}).then((l) => { $('#gameover-boss').textContent = `"${l}"`; });
    this.screen('gameover');
  }

  toTitle() {
    this.sound.setPaused(false);
    this.input.releasePointerLock();
    this.hud.show(false);
    for (const p of this.players) p.dispose();
    this.players = [];
    this.sound.setDanger(0);
    this.sound.setWhisper(0);
    this.buildTitleScene();
    this.state = 'title';
    this.screen('title');
  }

  setPaused(on) {
    this.sound.setPaused(on);
    if (on) {
      this.state = 'paused';
      this.pausedAt = performance.now();
      this.input.releasePointerLock();
      this.screen('pause');
    } else {
      this.state = 'playing';
      this.screen(null);
    }
  }

  // ---------- world API used by players / loot / monsters ----------

  emitNoise(x, z, r, kind, source = null) {
    this.noises.push({ id: ++this.noiseId, x, z, r, t: this.time, kind, source });
    const listener = this.monsters.some((m) => m instanceof Zombie);
    if (listener && kind !== 'walk') {
      const color = kind === 'sprint' ? 0x8fd14f : kind === 'shatter' || kind === 'crack' ? 0xff5a3a : 0xffffff;
      this.fx.ring(x, z, r, color, kind === 'sprint' ? 0.18 : 0.4);
    }
  }

  soundAt(pos, play, maxDist) {
    let d = Infinity, listener = null;
    for (const p of this.players) {
      if (!p.alive) continue;
      const distance = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (distance < d) { d = distance; listener = p; }
    }
    const v = 1 - d / maxDist;
    if (v > 0.03) {
      const pan = this.players.length === 1 && d > 0.01
        ? (-(pos.x - listener.pos.x) * Math.cos(listener.yaw) + (pos.z - listener.pos.z) * Math.sin(listener.yaw)) / d : 0;
      this.sound.withPan(pan, () => play(v));
    }
  }

  isLitBy(player, point) {
    if (!player.alive || !player.lightOn) return false;
    const dx = point.x - player.pos.x, dz = point.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.9) return true;
    if (d > FLASH.range * 0.85) return false;
    const cos = (dx * Math.sin(player.yaw) + dz * Math.cos(player.yaw)) / d;
    if (cos < Math.cos(FLASH.angle * 1.05)) return false;
    return this.level.lineOfSight(player.pos.x, player.pos.z, point.x, point.z);
  }

  interactionCandidate(p) {
    if (!p.alive || p.hidingSpot || p.mapOpen || p.holding || p.webbedBy) return null;
    const reachable = (pos) => {
      const dx = pos.x - p.pos.x, dz = pos.z - p.pos.z, distance = Math.hypot(dx, dz);
      return distance <= 2 && (distance < 0.65 || (dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw)) / distance > 0.30)
        && this.level.lineOfSight(p.pos.x, p.pos.z, pos.x, pos.z);
    };
    for (const partner of this.players) {
      if (partner !== p && partner.alive && partner.webbedBy && reachable(partner.pos)) {
        return { pos: partner.pos, label: `cut ${partner.name} free`, kind: 'rescue', target: partner.webbedBy };
      }
    }
    for (const monster of this.monsters) {
      if (monster instanceof ThiefBug && monster.treasure && reachable(monster.pos)) {
        return { pos: monster.pos, label: 'recover stolen treasure', kind: 'recover', target: monster };
      }
    }
    const candidate = this.encounters?.candidate(p);
    return candidate ? { ...candidate, label: `${candidate.action.toLowerCase()} ${candidate.label.toLowerCase()}` } : null;
  }

  awakenMimic(chest) {
    const mimic = new Mimic(this);
    mimic.activate(chest.pos, chest.yaw);
    this.monsters.push(mimic);
    // Build its attack shot before it can finish unfolding and catch a player.
    this.jumpscares.prepare([mimic], this.players);
    this.soundAt(chest.pos, volume => this.sound.rattle(volume), 18);
    this.emitNoise(chest.pos.x, chest.pos.z, 15, 'mimic');
    return mimic;
  }

  grabCandidate(p) {
    if (!p.alive || p.holding || p.hidingSpot || p.webbedBy) return null;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    let best = null, bestScore = Infinity;
    for (const it of this.items) {
      if (it.gone || it.depositing > 0 || it.stolenBy) continue;
      if (it.holders.length && !(it.heavy && it.holders.length < 2)) continue;
      const dx = it.pos.x - p.pos.x, dz = it.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.5 + it.radius) continue;
      const cos = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      if (d > 0.9 && cos < 0.35) continue;
      const score = d - cos * 0.6;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    return best;
  }

  toggleGrab(p) {
    if (!p.alive || p.hidingSpot) return;
    if (p.webbedBy) { p.webbedBy.rescue(p); return; }
    if (p.holding) {
      this.release(p);
      return;
    }
    const interaction = this.interactionCandidate(p);
    if (interaction) {
      if (interaction.kind === 'rescue') interaction.target.rescue(p);
      else if (interaction.kind === 'recover') interaction.target.recover(p);
      else this.encounters.interact(p);
      return;
    }
    const it = this.grabCandidate(p);
    if (!it) return;
    it.holders.push(p);
    p.holding = it;
    this.sound.pickup();
    if (it.heavy && this.numPlayers > 1 && it.holders.length === 1) {
      this.hud.popup(p.index, 'HEAVY! Get your partner to grab it too', 'hint');
    }
  }

  release(p) {
    const it = p.holding;
    if (!it) return;
    it.holders = it.holders.filter((h) => h !== p);
    p.holding = null;
    if (!it.holders.length) {
      it.vel.x = p.vel.x * 0.6;
      it.vel.z = p.vel.z * 0.6;
    }
  }

  toggleHide(p) {
    if (!p.alive || p.webbedBy || p.staggerTime > 0) return false;
    if (p.hidingSpot) {
      if (!p.leaveHiding()) {
        this.hud.popup(p.index, 'The exit is blocked', 'hint');
        return false;
      }
      this.sound.thud(0.12);
      this.emitNoise(p.pos.x, p.pos.z, 3, 'hide');
      return true;
    }
    const spot = this.level.hidingCandidate(p);
    if (!spot) return false;
    if (p.holding) {
      this.hud.popup(p.index, 'Set down your loot before hiding', 'hint');
      return false;
    }
    const witnessed = this.monsters.some(m => m.canWitnessHiding(p));
    if (!p.enterHiding(spot, witnessed)) return false;
    this.sound.thud(0.12);
    this.emitNoise(p.pos.x, p.pos.z, 3, 'hide');
    if (witnessed) this.hud.popup(p.index, 'It saw you enter', 'loss');
    return true;
  }

  toggleMap(p) {
    if (!p.alive || p.webbedBy) return;
    p.mapOpen = !p.mapOpen;
    this.sound.noiseBurst({ dur: 0.16, freq: 1400, type: 'highpass', vol: 0.035, reverb: false });
  }

  startDeposit(it) {
    if (it.stolenBy) return;
    for (const h of [...it.holders]) this.release(h);
    it.depositing = 0.7;
    this.fx.sparkle(it.pos, it.type.soul ? 0x9fffe0 : 0xffd36b);
    this.emitNoise(it.pos.x, it.pos.z, NOISE.deposit, 'deposit');
  }

  finishDeposit(it) {
    this.removeItem(it);
    if (it.type.soul) {
      const owner = it.owner;
      if (owner && !owner.alive) this.respawn(owner);
      return;
    }
    const v = it.value;
    const wasMet = this.cash >= this.quota;
    this.cash += v;
    this.run.delivered += v;
    this.sound.cash();
    this.hud.popup(null, `+$${v}`, 'cash');
    if (!wasMet && this.cash >= this.quota) {
      this.sound.bell();
      this.say('quotaMet', {}, true);
    }
  }

  removeItem(it) {
    it.dispose();
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
  }

  itemDamaged(it, lost, cause) {
    this.soundAt(it.pos, (v) => this.sound.crack(v), 25);
    this.emitNoise(it.pos.x, it.pos.z, NOISE.crack, 'crack');
    const h = it.holders[0];
    this.hud.popup(h ? h.index : null, `-$${lost}`, 'loss');
    if (this.firstCrack || Math.random() < 0.25) {
      this.firstCrack = false;
      this.say('crack', { item: it.type.name });
    }
  }

  shatterItem(it, valueBefore) {
    const h = it.holders[0];
    for (const p of [...it.holders]) this.release(p);
    this.fx.shards(it.pos, it.type.id.startsWith('pumpkin') || it.type.id === 'jack' ? 0xe0761a : 0xc9b48a);
    this.soundAt(it.pos, (v) => this.sound.shatter(v), 30);
    this.emitNoise(it.pos.x, it.pos.z, NOISE.shatter, 'shatter');
    this.run.broken++;
    this.hud.popup(h ? h.index : null, `SHATTERED -$${valueBefore}`, 'loss big');
    this.say('shatter', { item: it.type.name, value: valueBefore });
    this.removeItem(it);
  }

  killPlayer(p, monster = null) {
    if (!p.alive) return;
    if (p.holding) {
      const it = p.holding;
      this.release(p);
      it.damage(25, 'dropped');
    }
    p.kill();
    if (monster) this.jumpscares.start(p, monster);
    else this.sound.scare();
    this.run.deaths++;
    const others = this.players.filter((o) => o.alive);
    if (this.run.insurance > 0) {
      this.run.insurance--;
      p.deathNote = 'Life insurance claimed. Respawning at the lift...';
      this.after(3, () => this.respawn(p));
      this.say(this.numPlayers > 1 ? 'death' : 'deathSolo', { name: p.name }, true);
    } else if (others.length) {
      const jar = new Item(this, SOUL_TYPE, p.pos, this.rng);
      jar.owner = p;
      this.items.push(jar);
      p.soulJar = jar;
      p.deathNote = 'Your partner must carry your soul jar to the lift.';
      this.say('death', { name: p.name }, true);
    } else {
      p.deathNote = 'Nobody is left to save you.';
      this.after(2.2, () => this.fired('dead'));
    }
  }

  respawn(p) {
    if (p.alive || this.state !== 'playing') return;
    this.jumpscares.clear(p.index);
    const lp = this.level.liftPos;
    p.spawn(lp.x, lp.z, this.facingOutOfLift());
    p.soulJar = null;
    this.sound.revive();
    this.fx.sparkle(lp, 0x9fffe0, 24);
    this.hud.popup(p.index, 'REVIVED', 'cash');
  }

  deathFocus(p) {
    if (p.soulJar && !p.soulJar.gone) return p.soulJar.pos;
    return p.pos;
  }

  deathMessage(p) {
    return p.deathNote || '';
  }

  dangerFor(p) {
    if (!p.alive) return 0;
    let d = Infinity;
    for (const m of this.monsters) {
      if (m instanceof ThiefBug || m.isStunned || m instanceof Lizard && m.state === 'wander') continue;
      d = Math.min(d, Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z));
    }
    return Math.max(0, 1 - d / 10);
  }

  clockText() {
    const minutes = Math.min(120, (this.clockTime / NIGHT.seconds) * 120);
    const total = NIGHT.startHour * 60 + minutes;
    let h = Math.floor(total / 60) % 24;
    const m = Math.floor(total % 60);
    const ampm = h >= 12 && h < 24 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  get clock() {
    return this.clockTime / NIGHT.seconds;
  }

  say(kind, data, force = false) {
    if (!force && this.radioCooldown > 0) return;
    this.radioCooldown = 8;
    bossLine(kind, data).then((line) => {
      this.hud.radio(line);
      this.sound.radio();
    });
  }

  after(seconds, fn) {
    this.timers.push({ t: seconds, fn });
  }

  // ---------- simulation ----------

  step(dt, attackDt = dt) {
    this.time += dt;
    this.clockTime += dt;
    this.radioCooldown -= dt;
    const level = this.level;

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) {
        this.timers.splice(i, 1);
        tm.fn();
      }
    }
    if (this.state !== 'playing') return;

    // Input -> players. Solo play accepts both key sets.
    this.players.forEach((p, i) => {
      let it = this.input.intent(i);
      if (this.numPlayers === 1) {
        const alt = this.input.intent(1);
        it = {
          forward: it.forward || alt.forward, strafe: it.strafe || alt.strafe, turn: it.turn || alt.turn,
          mouseTurn: it.mouseTurn, mouseLook: it.mouseLook, look: it.look || alt.look, sprint: it.sprint || alt.sprint,
          grabPressed: it.grabPressed || alt.grabPressed, flashPressed: it.flashPressed || alt.flashPressed,
          hidePressed: it.hidePressed || alt.hidePressed, mapPressed: it.mapPressed || alt.mapPressed,
          stunPressed: it.stunPressed || alt.stunPressed, lurePressed: it.lurePressed || alt.lurePressed,
        };
      }
      if (this.testIntents) it = { ...it, ...this.testIntents[i] };
      if (it.mapPressed) this.toggleMap(p);
      if (it.hidePressed) this.toggleHide(p);
      if (it.grabPressed) this.toggleGrab(p);
      if (it.stunPressed) this.gadgets.useStun(p);
      if (it.lurePressed) this.gadgets.useLure(p);
      p.carryMul = p.holding ? p.holding.carrySpeed : 1;
      p.update(dt, it);
    });

    // Interns don't overlap.
    if (this.players.length === 2 && this.players.every(p => p.alive && !p.hidingSpot && !p.webbedBy)) {
      const [a, b] = this.players;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.7 && d > 1e-4) {
        const push = (0.7 - d) / 2;
        a.pos.x -= (dx / d) * push; a.pos.z -= (dz / d) * push;
        b.pos.x += (dx / d) * push; b.pos.z += (dz / d) * push;
      }
    }

    for (const it of [...this.items]) {
      it.update(dt);
      if (it.gone || it.depositing > 0 || it.stolenBy) continue;
      if (level.inLift(it.pos.x, it.pos.z)) {
        it.inLiftTime += dt;
        if (it.inLiftTime > 0.35) this.startDeposit(it);
      } else {
        it.inLiftTime = 0;
      }
    }

    for (const p of this.players) p.flicker = 0;
    this.encounters?.update(dt);
    this.gadgets.update(dt);
    this.ghostNear = 0;
    for (const m of this.monsters) m.update(dt);
    this.jumpscares.update(attackDt);
    this.noises = this.noises.filter((n) => this.time - n.t < 1.5);

    this.fx.update(dt);
    level.update(this.time, this);

    // Heartbeat + whispers.
    const danger = Math.max(0, ...this.players.map((p) => this.dangerFor(p)));
    this.sound.setDanger(danger);
    // First close encounter on each floor gets the jump-scare sting.
    if (!this.encounterScared && danger > 0.65) {
      this.encounterScared = true;
      this.sound.scare(0.7);
    }
    this.sound.setWhisper(this.ghostNear);

    // Lift departure.
    const alive = this.players.filter((p) => p.alive);
    const met = this.cash >= this.quota;
    if (met && alive.length) {
      const allIn = alive.every((p) => level.inLift(p.pos.x, p.pos.z));
      if (allIn) {
        this.departTimer -= dt;
        this.hud.lift(`LIFT DEPARTING IN ${Math.max(1, Math.ceil(this.departTimer))}...  (step out to keep looting)`);
        if (this.departTimer <= 0) this.descend();
      } else {
        this.departTimer = 3;
        this.hud.lift(alive.length > 1 ? 'QUOTA MET: everyone into the lift to descend' : 'QUOTA MET: step into the lift to descend');
      }
    } else {
      this.departTimer = 3;
      const inLift = alive.some((p) => level.inLift(p.pos.x, p.pos.z));
      this.hud.lift(inLift ? `Need $${this.quota - this.cash} more to descend` : null);
    }

    // Midnight.
    if (!this.lowTimeWarned && this.clock > 0.75) {
      this.lowTimeWarned = true;
      this.say('lowTime', {}, true);
    }
    if (this.clockTime >= NIGHT.seconds) {
      if (met) this.descend();
      else this.fired('midnight');
    }
  }

  render() {
    const r = this.renderer;
    const w = innerWidth, h = innerHeight;
    r.shadowMap.needsUpdate = true;
    if (this.state === 'title' || !this.players.length) {
      r.setScissorTest(false);
      r.setViewport(0, 0, w, h);
      this.titleCam.aspect = w / h;
      this.titleCam.updateProjectionMatrix();
      this.film.render(this.scene, this.titleCam, { width: w, height: h, time: this.time, ...this.picture });
      return;
    }
    const n = this.players.length;
    r.setScissorTest(n > 1);
    this.players.forEach((p, i) => {
      const vw = w / n;
      r.setViewport(i * vw, 0, vw, h);
      r.setScissor(i * vw, 0, vw, h);
      const attack = this.jumpscares.get(i);
      // Attack and facility lights belong to different scenes. Refresh each
      // scene's shadows so a surviving partner can still move their torch.
      if (this.jumpscares.active.size) r.shadowMap.needsUpdate = true;
      if (attack) {
        attack.camera.aspect = vw / h;
        attack.camera.updateProjectionMatrix();
        this.film.render(attack.scene, attack.camera, {
          index: i, x: i * vw, width: vw, height: h, time: this.time,
          danger: 1, shock: attack.shock, blackout: attack.blackout, ...this.picture,
        });
        return;
      }
      p.camera.aspect = vw / h;
      p.camera.updateProjectionMatrix();
      // First person: hide your own body (but show your corpse once you're dead).
      for (const q of this.players) q.body.visible = (!q.hidingSpot || q.hidingSpot.kind === 'table') && (q !== p || !q.alive);
      this.film.render(this.scene, p.camera, {
        index: i, x: i * vw, width: vw, height: h, time: this.time,
        danger: this.dangerFor(p), ...this.picture,
      });
    });
  }

  loop() {
    requestAnimationFrame(() => this.loop());
    const frameDt = this.clockRaf.getDelta();
    const dt = Math.min(0.05, frameDt);
    if (this.state === 'title') {
      this.time += dt;
      this.updateTitle(dt);
    } else if (this.players.length) {
      const live = this.state === 'playing' || this.state === 'descending';
      // Keep the attack cue in real time even when simulation steps are capped.
      // A long background-tab gap is a suspension, not an unseen attack.
      if (live) this.step(dt, frameDt > 1 ? dt : frameDt);
      for (const p of this.players) p.updateCamera(live ? dt : 0);
      if (live) this.hud.update(this, dt);
    }
    this.sound.update(dt, this.state === 'playing');
    this.render();
    this.input.endFrame();
  }
}

// Surface errors on screen when debugging (?debug).
if (params.has('debug') || params.has('test')) {
  const log = $('#debug-log');
  log.classList.remove('hidden');
  const write = (msg) => { log.textContent += `${msg}\n`; };
  addEventListener('error', (e) => write(`ERROR: ${e.message} @ ${e.filename}:${e.lineno}`));
  addEventListener('unhandledrejection', (e) => write(`REJECTION: ${e.reason && (e.reason.stack || e.reason)}`));
  window.debugWrite = write;
}

const game = new Game();
window.game = game;
game.init().then(() => {
  if (params.has('test')) import('./debug.js').then((m) => m.runTests(game, params.get('test')));
}).catch((e) => {
  console.error(e);
  $('#loading').textContent = `Failed to load: ${e.message}`;
});
