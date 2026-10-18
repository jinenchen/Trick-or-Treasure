// Keyboard (two players on one keyboard), mouse (player 1) and gamepads.

const BINDINGS = [
  { // Player 1
    forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    sprint: ['ShiftLeft'], grab: ['KeyE', 'Space'], flash: ['KeyF'],
    hide: ['KeyQ'], map: ['Tab'], stun: ['KeyR'], lure: ['KeyG'],
  },
  { // Player 2
    forward: ['ArrowUp'], back: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    sprint: ['ShiftRight'], grab: ['Enter', 'NumpadEnter', 'Numpad0'], flash: ['Slash', 'ControlRight', 'NumpadDecimal'],
    hide: ['Backspace', 'Numpad1'], map: ['Backslash', 'Numpad2'], stun: ['Numpad4'], lure: ['Numpad5'],
  },
];

const BLOCK_DEFAULT = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash', 'Tab', 'Enter', 'Backspace',
]);

export class Input {
  constructor(canvas) {
    this.down = new Set();
    this.pressed = new Set();      // edge-triggered, cleared each frame
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseButtons = new Set();
    this.mousePressed = new Set();
    this.pointerLocked = false;
    this.prevPad = [{}, {}];
    this.canvas = canvas;

    addEventListener('keydown', (e) => {
      // Tab is the map during play; retain native focus/slider keys in menus.
      const inMenu = !!document.querySelector('.screen:not(.hidden)');
      if (BLOCK_DEFAULT.has(e.code) && !inMenu) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      this.mouseButtons.add(e.button);
      this.mousePressed.add(e.button);
    });
    addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.onUnlock = null;
    document.addEventListener('pointerlockchange', () => {
      const was = this.pointerLocked;
      this.pointerLocked = document.pointerLockElement === canvas;
      // Esc while mouse-locked only releases the mouse; treat it as a pause.
      if (was && !this.pointerLocked && this.onUnlock) this.onUnlock();
    });
  }

  requestPointerLock() {
    if (!this.pointerLocked && this.canvas.requestPointerLock) {
      try {
        const p = this.canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch { /* not allowed right now */ }
    }
  }

  releasePointerLock() {
    if (this.pointerLocked) document.exitPointerLock();
  }

  any(codes) {
    return codes.some((c) => this.down.has(c));
  }

  anyPressed(codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  // Per-player intent for this frame.
  intent(index) {
    const b = BINDINGS[index];
    const it = {
      forward: (this.any(b.forward) ? 1 : 0) - (this.any(b.back) ? 1 : 0),
      strafe: 0,
      turn: (this.any(b.right) ? 1 : 0) - (this.any(b.left) ? 1 : 0),  // +1 = turn right
      mouseTurn: 0,
      mouseLook: 0,                 // mouse Y, + = look down
      look: 0,                      // gamepad right stick Y, + = look down
      sprint: this.any(b.sprint),
      grabPressed: this.anyPressed(b.grab),
      flashPressed: this.anyPressed(b.flash),
      hidePressed: this.anyPressed(b.hide),
      mapPressed: this.anyPressed(b.map),
      stunPressed: this.anyPressed(b.stun),
      lurePressed: this.anyPressed(b.lure),
    };

    // Player 1 with a locked mouse: mouse turns, A/D strafe, LMB grab, RMB light.
    if (index === 0 && this.pointerLocked) {
      it.strafe = it.turn;
      it.turn = 0;
      it.mouseTurn = this.mouseDX;
      it.mouseLook = this.mouseDY;
      if (this.mousePressed.has(0)) it.grabPressed = true;
      if (this.mousePressed.has(2)) it.flashPressed = true;
    }

    // Gamepad i drives player i.
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].filter(Boolean)[index];
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
      const prev = this.prevPad[index];
      const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
      const edge = (i) => btn(i) && !prev[i];
      const fwd = -dz(pad.axes[1] || 0);
      const str = dz(pad.axes[0] || 0);
      const trn = dz(pad.axes[2] || 0);
      const lk = dz(pad.axes[3] || 0);
      if (fwd) it.forward = fwd;
      if (str) it.strafe = str;
      if (trn) it.turn = trn;
      if (lk) it.look = lk;
      if (btn(7) || btn(10) || btn(6)) it.sprint = true;
      if (edge(0)) it.grabPressed = true;
      if (edge(2) || edge(5)) it.flashPressed = true;
      if (edge(1)) it.hidePressed = true;
      if (edge(3)) it.mapPressed = true;
      if (edge(4)) it.stunPressed = true;
      if (edge(13)) it.lurePressed = true;
      for (let i = 0; i < pad.buttons.length; i++) prev[i] = btn(i);
    }
    return it;
  }

  endFrame() {
    this.pressed.clear();
    this.mousePressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}
