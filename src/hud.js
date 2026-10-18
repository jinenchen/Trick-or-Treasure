// DOM overlay: shared top bar + one panel per player viewport.
import { FieldMap } from './field-map.js';

const $ = (s) => document.querySelector(s);

const KEYS = [
  { grab: 'E', flash: 'F', hide: 'Q', map: 'Tab', stun: 'R', lure: 'G' },
  { grab: 'Enter', flash: '/', hide: 'Backspace', map: '\\', stun: 'Num4', lure: 'Num5' },
];

export class Hud {
  constructor() {
    this.root = $('#hud');
    this.vps = $('#viewports');
    this.floorEl = $('#hud-floor');
    this.clockEl = $('#hud-clock');
    this.quotaFill = $('#quota-fill');
    this.quotaText = $('#quota-text');
    this.radioEl = $('#radio');
    this.radioText = $('#radio-text');
    this.liftEl = $('#lift-banner');
    this.panels = [];
    this.radioTimer = 0;
    this.typing = null;
  }

  show(on) {
    this.root.classList.toggle('hidden', !on);
  }

  setup(players, pointerHint) {
    this.vps.innerHTML = '';
    this.vps.className = players.length > 1 ? 'two' : 'one';
    this.panels = players.map((p, i) => {
      const el = document.createElement('div');
      el.className = 'vp';
      el.style.setProperty('--pc', p.color);
      const keys = KEYS[i];
      el.innerHTML = `
        <div class="cover-shadow" aria-hidden="true"></div>
        <div class="vp-tag">${p.name}</div>
        <div class="crosshair"></div>
        <div class="compass" aria-label="Direction to the elevator">
          <div class="compass-arrow"><svg viewBox="0 0 32 42" aria-hidden="true"><path d="M16 2 30 19H21V39H11V19H2Z"/></svg></div>
          <div class="compass-copy"><div class="compass-label">ELEVATOR</div><div class="compass-distance"></div></div>
        </div>
        <div class="hiding-status hidden"></div>
        <div class="hazard-status hidden" role="status"><div class="hazard-heading"><strong></strong><span></span></div><div class="hazard-instruction"></div></div>
        <div class="tool-belt" aria-label="Equipment">
          <div class="tool-slot stun-tool"><span class="tool-key">${keys.stun}</span><span>STUN</span><b class="tool-count">0</b></div>
          <div class="tool-slot lure-tool"><span class="tool-key">${keys.lure}</span><span>DECOY</span><b class="tool-count">0</b></div>
        </div>
        <div class="bars">
          <div class="bar battery"><span>LIGHT</span><b><i></i></b></div>
          <div class="bar stamina"><span>STAMINA</span><b><i></i></b></div>
        </div>
        <div class="held hidden"><div class="held-name"></div><div class="held-value"></div><div class="hp"><i></i></div></div>
        <div class="prompt hidden"></div>
        <div class="hide-prompt hidden"></div>
        <div class="keys">${players.length > 1 || !pointerHint ? `[${keys.grab}] use / grab &nbsp; [${keys.flash}] light` : 'Click for mouse look &middot; [E]/LMB use / grab &middot; [F]/RMB light'}<br><span>[${keys.hide}] hide / leave &nbsp; [${keys.map}] map</span><span class="pad-keys">Pad: [B] hide &middot; [Y] map &middot; [LB] stun &middot; [D↓] decoy</span></div>
        <div class="dead hidden"><h2>YOU DIED</h2><p></p></div>
        <div class="popups"></div>
        <div class="vignette"></div>`;
      this.vps.appendChild(el);
      const fieldMap = new FieldMap(el, keys);
      return {
        el,
        fieldMap,
        battery: el.querySelector('.battery i'),
        batteryBar: el.querySelector('.battery'),
        stamina: el.querySelector('.stamina i'),
        held: el.querySelector('.held'),
        heldName: el.querySelector('.held-name'),
        heldValue: el.querySelector('.held-value'),
        hp: el.querySelector('.hp i'),
        prompt: el.querySelector('.prompt'),
        hidePrompt: el.querySelector('.hide-prompt'),
        hidingStatus: el.querySelector('.hiding-status'),
        hazardStatus: el.querySelector('.hazard-status'),
        hazardTitle: el.querySelector('.hazard-heading strong'),
        hazardTime: el.querySelector('.hazard-heading span'),
        hazardInstruction: el.querySelector('.hazard-instruction'),
        toolBelt: el.querySelector('.tool-belt'),
        stunTool: el.querySelector('.stun-tool'),
        lureTool: el.querySelector('.lure-tool'),
        stunCount: el.querySelector('.stun-tool .tool-count'),
        lureCount: el.querySelector('.lure-tool .tool-count'),
        compassRoot: el.querySelector('.compass'),
        compass: el.querySelector('.compass-arrow'),
        compassLabel: el.querySelector('.compass-label'),
        compassDistance: el.querySelector('.compass-distance'),
        crosshair: el.querySelector('.crosshair'),
        dead: el.querySelector('.dead'),
        deadText: el.querySelector('.dead p'),
        popups: el.querySelector('.popups'),
        vignette: el.querySelector('.vignette'),
        keys,
        lastPrompt: '',
      };
    });
  }

  update(world, dt) {
    const { players, level } = world;
    this.root.classList.toggle('jumpscare-solo', players.length === 1 && !!world.jumpscares.get(0));
    this.floorEl.textContent = `FLOOR B${world.floor}`;
    this.clockEl.textContent = world.clockText();
    this.clockEl.classList.toggle('late', world.clock > 0.75);
    const q = Math.min(1, world.cash / world.quota);
    this.quotaFill.style.width = `${q * 100}%`;
    this.quotaFill.classList.toggle('met', world.cash >= world.quota);
    this.quotaText.textContent = `$${world.cash} / $${world.quota}`;

    players.forEach((p, i) => {
      const ui = this.panels[i];
      if (!ui) return;
      const caught = !!world.jumpscares.get(i);
      ui.el.classList.toggle('caught', caught);
      ui.battery.style.width = `${(p.battery / p.batteryMax) * 100}%`;
      ui.batteryBar.classList.toggle('off', !p.flashOn);
      ui.batteryBar.classList.toggle('low', p.battery / p.batteryMax < 0.15);
      ui.stamina.style.width = `${(p.stamina / p.staminaMax) * 100}%`;
      ui.stamina.parentElement.classList.toggle('exhausted', p.exhausted);

      const stunCount = p.tools?.stun ?? 0, lureCount = p.tools?.lure ?? 0;
      ui.toolBelt.classList.toggle('hidden', !p.alive);
      ui.toolBelt.classList.toggle('unavailable', !!p.hidingSpot || !!p.mapOpen || p.staggerTime > 0);
      ui.stunCount.textContent = stunCount;
      ui.lureCount.textContent = lureCount;
      ui.stunTool.classList.toggle('empty', stunCount === 0);
      ui.lureTool.classList.toggle('empty', lureCount === 0);

      const webbed = p.alive && p.webbedBy;
      const freePartner = players.some((other) => other !== p && other.alive && !other.webbedBy && !world.jumpscares.get(other.index));
      const staggered = p.alive && p.staggerTime > 0;
      ui.el.classList.toggle('webbed', !!webbed);
      ui.hazardStatus.classList.toggle('hidden', !webbed && !staggered);
      if (webbed) {
        ui.hazardTitle.textContent = 'WEBBED';
        const spider = p.webbedBy;
        const remaining = spider.captureRemaining ?? (Number.isFinite(spider.captureLimit ?? spider.captureDuration)
          ? (spider.captureLimit ?? spider.captureDuration) - spider.captureTime : null);
        ui.hazardTime.textContent = Number.isFinite(remaining) ? `${Math.max(0, Math.ceil(remaining))}s LEFT` : 'GET FREE';
        ui.hazardInstruction.textContent = freePartner ? 'Partner: approach and press grab to cut the web'
          : `[${ui.keys.grab}] / [A] tap repeatedly to struggle free`;
      } else if (staggered) {
        ui.hazardTitle.textContent = 'STAGGERED';
        ui.hazardTime.textContent = `${Math.max(0, p.staggerTime).toFixed(1)}s`;
        ui.hazardInstruction.textContent = 'Keep moving. Get to cover.';
      }

      const it = p.holding;
      ui.held.classList.toggle('hidden', !it);
      if (it) {
        ui.heldName.textContent = it.type.name + (it.heavy && it.holders.length < 2 && players.length > 1 ? '  (too heavy alone!)' : '');
        ui.heldValue.textContent = it.type.soul ? 'take it to the lift' : `$${it.value}`;
        ui.hp.style.width = `${it.hp}%`;
        ui.hp.style.background = it.hp > 60 ? '#8fd14f' : it.hp > 30 ? '#ffb347' : '#ff4a3a';
      }

      // Context prompt.
      let prompt = '';
      if (webbed) {
        prompt = freePartner ? 'Your partner can cut you free' : `[${ui.keys.grab}] / [A] struggle`;
      } else if (p.alive && !p.hidingSpot) {
        const action = world.interactionCandidate?.(p) ?? world.encounters?.candidate(p);
        const cand = world.grabCandidate(p);
        if (it) prompt = `[${ui.keys.grab}] drop`;
        else if (action) prompt = `[${ui.keys.grab}] / [A] ${action.label}`;
        else if (cand) {
          const what = cand.type.soul ? `${cand.type.name}` : `${cand.type.name}  $${cand.value}`;
          prompt = cand.holders.length ? `[${ui.keys.grab}] help carry ${what}` : `[${ui.keys.grab}] grab ${what}${cand.heavy && players.length > 1 ? ' (2 interns)' : ''}`;
        }
      }
      if (prompt !== ui.lastPrompt) {
        ui.prompt.textContent = prompt;
        ui.prompt.classList.toggle('hidden', !prompt);
        ui.lastPrompt = prompt;
      }

      // Cover gets its own interaction so nearby loot never hides the action.
      let hidePrompt = '';
      const cover = p.alive && !webbed ? p.hidingSpot : null;
      if (cover) {
        hidePrompt = `[${ui.keys.hide}] / [B] leave ${cover.kind === 'locker' ? 'locker' : 'cover'}`;
      } else if (p.alive && !webbed) {
        const candidate = level.hidingCandidate?.(p);
        if (candidate) hidePrompt = it ? `[${ui.keys.grab}] drop item to hide`
          : `[${ui.keys.hide}] / [B] ${candidate.kind === 'locker' ? 'hide inside locker' : 'hide under table'}`;
      }
      ui.hidePrompt.textContent = hidePrompt;
      ui.hidePrompt.classList.toggle('hidden', !hidePrompt);
      ui.hidingStatus.classList.toggle('hidden', !cover);
      ui.hidingStatus.classList.toggle('exposed', !!cover && !p.isHidden);
      if (cover) {
        const place = cover.kind === 'locker' ? 'INSIDE LOCKER' : 'UNDER TABLE';
        const state = p.isHidden ? 'CONCEALED · KEEP QUIET' : p.lightOn || p.flashOn ? 'LIGHT EXPOSES YOU · SWITCH IT OFF' : 'EXPOSED · IT KNOWS YOU ARE HERE';
        ui.hidingStatus.textContent = `${place} / ${state}`;
      }
      ui.el.classList.toggle('in-locker', cover?.kind === 'locker');
      ui.el.classList.toggle('under-table', cover?.kind === 'table');
      ui.el.classList.toggle('map-open', !!p.mapOpen && p.alive);
      ui.fieldMap.update(level, p, players, dt);

      // Follow the next corridor turn when the elevator is behind a wall.
      const inLift = level.inLift(p.pos.x, p.pos.z);
      const direct = level.lineOfSight(p.pos.x, p.pos.z, level.liftPos.x, level.liftPos.z);
      const target = direct ? level.liftPos : level.nextWaypoint(p.pos.x, p.pos.z, level.liftField) || level.liftPos;
      const dx = target.x - p.pos.x, dz = target.z - p.pos.z;
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      const localFwd = dx * fx + dz * fz;
      const localRight = dx * -fz + dz * fx;
      const ang = Math.atan2(localRight, localFwd);
      ui.compass.style.transform = `rotate(${inLift ? 0 : ang}rad)`;
      const dist = Math.round(direct ? Math.hypot(dx, dz) : level.pathDistance(level.liftField, p.pos.x, p.pos.z));
      ui.compassRoot.classList.toggle('at-lift', inLift);
      ui.compassRoot.classList.toggle('hidden', !p.alive);
      ui.compassLabel.textContent = 'ELEVATOR';
      ui.compassDistance.textContent = inLift ? 'SAFE ZONE' : `${dist}m · ${direct ? 'THIS WAY' : 'FOLLOW HALLS'}`;

      ui.dead.classList.toggle('hidden', p.alive || caught);
      ui.crosshair.classList.toggle('hidden', !p.alive || !!cover || !!p.mapOpen || !!webbed);
      ui.crosshair.classList.toggle('active', !!prompt && !it);
      if (!p.alive) ui.deadText.textContent = world.deathMessage(p);
      const danger = world.dangerFor(p);
      ui.vignette.style.opacity = String(Math.min(0.85, danger * 0.9));
    });

    if (this.radioTimer > 0) {
      this.radioTimer -= dt;
      if (this.radioTimer <= 0) this.radioEl.classList.add('hidden');
    }
  }

  radio(text) {
    this.radioEl.classList.remove('hidden');
    this.radioTimer = Math.max(5, text.length * 0.07);
    clearInterval(this.typing);
    let i = 0;
    this.radioText.textContent = '';
    this.typing = setInterval(() => {
      i += 2;
      this.radioText.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(this.typing);
    }, 30);
  }

  popup(index, text, cls = '') {
    const targets = index === null ? this.panels : [this.panels[index]];
    for (const ui of targets) {
      if (!ui) continue;
      const d = document.createElement('div');
      d.className = `popup ${cls}`;
      d.textContent = text;
      ui.popups.appendChild(d);
      setTimeout(() => d.remove(), 1800);
    }
  }

  lift(text) {
    this.liftEl.classList.toggle('hidden', !text);
    if (text) this.liftEl.textContent = text;
  }
}
