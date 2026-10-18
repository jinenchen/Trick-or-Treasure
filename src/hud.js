// DOM overlay: shared top bar + one panel per player viewport.
const $ = (s) => document.querySelector(s);

const KEYS = [
  { grab: 'E', flash: 'F' },
  { grab: 'Enter', flash: '/' },
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
        <div class="vp-tag">${p.name}</div>
        <div class="compass"><div class="compass-arrow">&#9650;</div><div class="compass-label">LIFT</div></div>
        <div class="bars">
          <div class="bar battery"><span>LIGHT</span><b><i></i></b></div>
          <div class="bar stamina"><span>STAMINA</span><b><i></i></b></div>
        </div>
        <div class="held hidden"><div class="held-name"></div><div class="held-value"></div><div class="hp"><i></i></div></div>
        <div class="prompt hidden"></div>
        <div class="keys">${players.length > 1 || !pointerHint ? `[${keys.grab}] grab &nbsp; [${keys.flash}] light` : 'Click to use mouse &middot; [E]/LMB grab &middot; [F]/RMB light'}</div>
        <div class="dead hidden"><h2>YOU DIED</h2><p></p></div>
        <div class="popups"></div>
        <div class="vignette"></div>`;
      this.vps.appendChild(el);
      return {
        el,
        battery: el.querySelector('.battery i'),
        batteryBar: el.querySelector('.battery'),
        stamina: el.querySelector('.stamina i'),
        held: el.querySelector('.held'),
        heldName: el.querySelector('.held-name'),
        heldValue: el.querySelector('.held-value'),
        hp: el.querySelector('.hp i'),
        prompt: el.querySelector('.prompt'),
        compass: el.querySelector('.compass-arrow'),
        compassLabel: el.querySelector('.compass-label'),
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
      ui.battery.style.width = `${(p.battery / p.batteryMax) * 100}%`;
      ui.batteryBar.classList.toggle('off', !p.flashOn);
      ui.batteryBar.classList.toggle('low', p.battery / p.batteryMax < 0.15);
      ui.stamina.style.width = `${(p.stamina / p.staminaMax) * 100}%`;
      ui.stamina.parentElement.classList.toggle('exhausted', p.exhausted);

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
      if (p.alive) {
        const cand = world.grabCandidate(p);
        if (it) prompt = `[${ui.keys.grab}] drop`;
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

      // Compass toward the lift, relative to where you are facing.
      const dx = level.liftPos.x - p.pos.x, dz = level.liftPos.z - p.pos.z;
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      const localFwd = dx * fx + dz * fz;
      const localRight = dx * -fz + dz * fx;
      const ang = Math.atan2(localRight, localFwd);
      ui.compass.style.transform = `rotate(${ang}rad)`;
      const dist = Math.round(Math.hypot(dx, dz));
      ui.compassLabel.textContent = level.inLift(p.pos.x, p.pos.z) ? 'IN LIFT' : `LIFT ${dist}m`;

      ui.dead.classList.toggle('hidden', p.alive);
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
