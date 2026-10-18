// WebAudio: streamed ambience track + scare sting (Pixabay, assets/audio), and
// procedural footsteps, monster cues and UI sounds.

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.danger = 0;
    this.nextBeat = 0;
    this.nextAmbient = 3;
  }

  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // White noise buffer shared by every noisy sound.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Catacomb reverb.
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.6;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.reverb.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.35;
    this.reverb.connect(this.wet).connect(this.master);

    this.startAmbience();
    this.startWhisper();
    this.loadFiles();
  }

  loadFiles() {
    // The ambience track is long, so stream it instead of decoding it all.
    const el = new Audio('assets/audio/ambience.mp3');
    el.loop = true;
    const src = this.ctx.createMediaElementSource(el);
    this.ambienceGain = this.ctx.createGain();
    this.ambienceGain.gain.value = 0.55;
    src.connect(this.ambienceGain).connect(this.master);
    el.play().then(() => {
      // The recorded ambience takes over from the synth drone.
      this.droneGain.gain.setTargetAtTime(0.015, this.ctx.currentTime, 2);
    }).catch(() => {});
    this.ambienceEl = el;

    fetch('assets/audio/scare.mp3')
      .then((r) => r.arrayBuffer())
      .then((buf) => this.ctx.decodeAudioData(buf))
      .then((decoded) => { this.scareBuffer = decoded; })
      .catch(() => {});
  }

  // Jump-scare sting (falls back to the synth sting until the file loads).
  scare(vol = 1) {
    if (!this.ctx) return;
    if (!this.scareBuffer) {
      this.sting();
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.scareBuffer;
    const g = this.ctx.createGain();
    g.gain.value = 0.9 * vol;
    src.connect(g).connect(this.master);
    src.start();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  out(reverb = true) {
    const g = this.ctx.createGain();
    g.connect(this.master);
    if (reverb) g.connect(this.reverb);
    return g;
  }

  noiseBurst({ dur = 0.1, freq = 1000, type = 'lowpass', q = 1, vol = 0.3, attack = 0.002, delay = 0, reverb = true, rate = 1 }) {
    if (!this.ctx || vol <= 0.001) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out(reverb));
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  tone({ freq = 440, type = 'sine', dur = 0.3, vol = 0.2, attack = 0.005, slideTo = 0, delay = 0, reverb = true }) {
    if (!this.ctx || vol <= 0.001) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out(reverb));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---------- ambience ----------

  startAmbience() {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0.06;
    this.droneGain = g;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 180;
    f.connect(g).connect(this.master);
    for (const [freq, type] of [[49, 'sine'], [73.6, 'triangle'], [98.3, 'sine']]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.1;
      const lg = ctx.createGain();
      lg.gain.value = 1.5;
      lfo.connect(lg).connect(o.frequency);
      o.connect(f);
      o.start();
      lfo.start();
    }
    // Low rumble of wind through the tunnels.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 260;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 0.03;
    lfo.connect(lg).connect(ng.gain);
    src.connect(nf).connect(ng).connect(this.master);
    src.start();
    lfo.start();
  }

  ambientEvent() {
    const r = Math.random();
    if (r < 0.4) {
      // Water drip with echo.
      this.tone({ freq: 1400 + Math.random() * 500, slideTo: 700, dur: 0.12, vol: 0.05 });
    } else if (r < 0.7) {
      // Creaking wood / iron.
      const base = 90 + Math.random() * 80;
      this.tone({ freq: base, slideTo: base * 1.4, type: 'sawtooth', dur: 0.9, vol: 0.018, attack: 0.3 });
    } else if (r < 0.85) {
      // Distant moan.
      this.tone({ freq: 210, slideTo: 140, type: 'triangle', dur: 2.2, vol: 0.025, attack: 0.8 });
    } else {
      // Something skitters.
      for (let i = 0; i < 5; i++) this.noiseBurst({ dur: 0.03, freq: 2500, type: 'bandpass', q: 3, vol: 0.03, delay: i * 0.06 });
    }
  }

  startWhisper() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 7;
    f.frequency.value = 1200;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.7;
    const lg = ctx.createGain();
    lg.gain.value = 700;
    lfo.connect(lg).connect(f.frequency);
    this.whisperGain = ctx.createGain();
    this.whisperGain.gain.value = 0;
    src.connect(f).connect(this.whisperGain).connect(this.out(true));
    src.start();
    lfo.start();
  }

  setWhisper(level) {
    if (!this.ctx) return;
    this.whisperGain.gain.setTargetAtTime(Math.min(1, level) * 0.5, this.ctx.currentTime, 0.2);
  }

  setDanger(level) {
    this.danger = level;
  }

  update(dt, playing) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (playing && this.danger > 0.12 && now >= this.nextBeat) {
      const vol = 0.12 + this.danger * 0.3;
      this.tone({ freq: 62, slideTo: 40, dur: 0.18, vol, reverb: false });
      this.tone({ freq: 55, slideTo: 36, dur: 0.2, vol: vol * 0.8, delay: 0.22, reverb: false });
      this.nextBeat = now + 1.15 - this.danger * 0.65;
    }
    this.nextAmbient -= dt;
    if (playing && this.nextAmbient <= 0) {
      this.ambientEvent();
      this.nextAmbient = 3 + Math.random() * 6;
    }
  }

  // ---------- effects ----------

  footstep(vol, sprint) {
    this.noiseBurst({ dur: sprint ? 0.09 : 0.07, freq: sprint ? 700 : 450, vol: vol * (sprint ? 0.32 : 0.16), rate: 0.6 });
  }

  crack(vol = 1) {
    this.noiseBurst({ dur: 0.12, freq: 2400, type: 'highpass', vol: 0.4 * vol });
    this.tone({ freq: 2600, slideTo: 1800, dur: 0.15, vol: 0.12 * vol, type: 'triangle' });
  }

  shatter(vol = 1) {
    this.noiseBurst({ dur: 0.35, freq: 3000, type: 'highpass', vol: 0.5 * vol });
    for (let i = 0; i < 9; i++) {
      this.tone({ freq: 2000 + Math.random() * 3500, dur: 0.18 + Math.random() * 0.2, vol: 0.07 * vol, delay: Math.random() * 0.35 });
    }
  }

  thud(vol = 1) {
    this.tone({ freq: 120, slideTo: 50, dur: 0.18, vol: 0.3 * vol });
    this.noiseBurst({ dur: 0.08, freq: 400, vol: 0.2 * vol });
  }

  pickup() {
    this.tone({ freq: 330, slideTo: 520, dur: 0.12, vol: 0.08, type: 'triangle', reverb: false });
  }

  cash() {
    [1046, 1318, 1568, 2093].forEach((f, i) => this.tone({ freq: f, dur: 0.35, vol: 0.12, delay: i * 0.07, type: 'triangle' }));
    this.noiseBurst({ dur: 0.25, freq: 6000, type: 'highpass', vol: 0.08, delay: 0.05 });
  }

  rattle(vol = 1) {
    for (let i = 0; i < 6; i++) {
      this.noiseBurst({ dur: 0.025, freq: 2800 + Math.random() * 1500, type: 'bandpass', q: 6, vol: 0.35 * vol, delay: Math.random() * 0.25 });
    }
  }

  groan(vol = 1) {
    if (!this.ctx || vol <= 0.01) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(95, t);
    o.frequency.linearRampToValueAtTime(70, t + 1.4);
    const vib = ctx.createOscillator();
    vib.frequency.value = 6;
    const vg = ctx.createGain();
    vg.gain.value = 6;
    vib.connect(vg).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22 * vol, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    o.connect(f).connect(g).connect(this.out(true));
    o.start(t);
    vib.start(t);
    o.stop(t + 1.6);
    vib.stop(t + 1.6);
  }

  sting() {
    [110, 116.5, 155.6, 233].forEach((f) => this.tone({ freq: f, slideTo: f * 0.7, type: 'sawtooth', dur: 1.6, vol: 0.09, attack: 0.02 }));
    this.noiseBurst({ dur: 1.2, freq: 900, vol: 0.3, attack: 0.05 });
  }

  bell() {
    this.tone({ freq: 880, dur: 1.8, vol: 0.12 });
    this.tone({ freq: 1320, dur: 1.4, vol: 0.06 });
    this.tone({ freq: 660, dur: 2.2, vol: 0.08, delay: 0.4 });
  }

  radio() {
    this.noiseBurst({ dur: 0.25, freq: 1800, type: 'bandpass', q: 2, vol: 0.12, reverb: false });
    this.tone({ freq: 1200, dur: 0.06, vol: 0.05, type: 'square', delay: 0.22, reverb: false });
  }

  click() {
    this.tone({ freq: 900, dur: 0.05, vol: 0.06, type: 'square', reverb: false });
  }

  flashClick() {
    this.noiseBurst({ dur: 0.02, freq: 3000, type: 'bandpass', q: 4, vol: 0.12, reverb: false });
  }

  revive() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone({ freq: f, dur: 0.5, vol: 0.1, delay: i * 0.1 }));
  }

  lowBattery() {
    this.tone({ freq: 440, dur: 0.08, vol: 0.05, type: 'square', reverb: false });
  }
}
