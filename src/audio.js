// Recorded ambience/proximity scare: DRAGON-STUDIO / Pixabay.
// The attack uses the user's supplied jumpscare recording. See assets/audio/README.md.

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : 0));

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.paused = false;
    this.hidden = false;
    this.danger = 0;
    this.whisper = 0;
    this.nextBeat = 0;
    this.nextAmbient = 4;
    this.nextScare = 0;
    this.encounterScare = null;
    this.cuePan = 0;
    this.decks = [];
    this.activeDeck = 0;
    this.jumpscares = new Set();
    this.jumpscareBuffer = null;
    // This exact recording's opening hit begins at .193 s; skip only its silence.
    this.jumpscareOffset = 0.185;
    this.jumpscareLoadState = 'idle';
    this.jumpscareReady = null;
    this.ambienceLevel = 0.4;
  }

  init() {
    this.paused = false;
    if (this.ctx) {
      this.syncPause();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.74;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -15;
    comp.knee.value = 18;
    comp.ratio.value = 6;
    comp.attack.value = 0.006;
    comp.release.value = 0.3;
    this.master.connect(comp).connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Dark, irregular early reflections and a long concrete-room tail.
    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const channel = ir.getChannelData(c);
      let smooth = 0;
      for (let i = 0; i < len; i++) {
        smooth = smooth * 0.68 + (Math.random() * 2 - 1) * 0.32;
        channel[i] = smooth * Math.pow(1 - i / len, 3.5) * Math.min(1, i / (ctx.sampleRate * 0.028));
      }
    }
    this.reverb.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.28;
    this.reverb.connect(this.wet).connect(this.master);

    this.startAmbience();
    this.startWhisper();
    this.loadFiles();
    this.hidden = document.hidden;
    // Auto-start and browser policies can leave AudioContext suspended. Retry
    // from real gestures without unhandled play()/resume() rejections.
    const unlock = () => this.unlock();
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock, { passive: true });
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      this.syncPause();
    });
    this.syncPause();
  }

  loadFiles() {
    // Overlap two streams at the seam instead of decoding a six-minute buffer.
    this.ambienceGain = this.ctx.createGain();
    this.ambienceGain.gain.value = 0.4;
    this.ambienceGain.connect(this.master);
    this.decks = [0, 1].map((index) => {
      const el = new Audio('assets/audio/ambience.mp3');
      el.preload = index === 0 ? 'auto' : 'metadata';
      const gain = this.ctx.createGain();
      gain.gain.value = index === 0 ? 1 : 0;
      this.ctx.createMediaElementSource(el).connect(gain).connect(this.ambienceGain);
      const deck = { el, gain, fadingUntil: 0, pending: false };
      el.addEventListener('error', () => {
        this.droneGain.gain.setTargetAtTime(0.065, this.ctx.currentTime, 1.4);
      });
      el.addEventListener('ended', () => {
        if (this.decks[this.activeDeck] !== deck || this.paused || this.hidden) return;
        el.currentTime = 0;
        this.playDeck(deck);
      });
      return deck;
    });
    this.ambienceEl = this.decks[0].el;
    fetch('assets/audio/scare.mp3')
      .then((response) => {
        if (!response.ok) throw new Error('Scare audio unavailable');
        return response.arrayBuffer();
      })
      .then((buffer) => this.ctx.decodeAudioData(buffer))
      .then((buffer) => {
        this.scareBuffer = buffer;
      })
      .catch(() => { /* Synthesized sting remains available on loading failure. */ });

    // Load independently: a proximity recording failure must not affect attacks.
    this.jumpscareLoadState = 'loading';
    this.jumpscareReady = fetch('assets/audio/jumpscare.mp3')
      .then((response) => {
        if (!response.ok) throw new Error('Jumpscare audio unavailable');
        return response.arrayBuffer();
      })
      .then((buffer) => this.ctx.decodeAudioData(buffer))
      .then((buffer) => {
        this.jumpscareBuffer = buffer;
        this.jumpscareLoadState = 'ready';
        return buffer;
      })
      .catch(() => {
        this.jumpscareLoadState = 'failed';
        return null; // The cancellable synthesized attack remains available.
      });
  }

  playDeck(deck) {
    if (!deck || deck.pending || !deck.el.paused || this.paused || this.hidden) return;
    deck.pending = true;
    deck.el.play().then(() => {
      deck.pending = false;
      if (this.paused || this.hidden) {
        deck.el.pause();
        return;
      }
      this.droneGain.gain.setTargetAtTime(0.018, this.ctx.currentTime, 2);
    }).catch(() => { deck.pending = false; });
  }

  unlock() {
    if (!this.ctx || this.paused || this.hidden) return;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    this.playDeck(this.decks[this.activeDeck]);
    for (const deck of this.decks) if (deck.fadingUntil) this.playDeck(deck);
  }

  setPaused(on) {
    this.paused = Boolean(on);
    this.syncPause();
  }

  syncPause() {
    if (!this.ctx) return;
    if (this.paused || this.hidden) {
      for (const deck of this.decks) deck.el.pause();
      if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
    } else this.unlock();
  }

  updateAmbience(now) {
    for (const deck of this.decks) {
      if (deck.fadingUntil && now >= deck.fadingUntil) {
        deck.el.pause();
        deck.el.currentTime = 0;
        deck.fadingUntil = 0;
      }
    }
    const current = this.decks[this.activeDeck];
    if (!current || current.el.paused || !Number.isFinite(current.el.duration)) return;
    const remaining = current.el.duration - current.el.currentTime;
    const nextIndex = 1 - this.activeDeck;
    const next = this.decks[nextIndex];
    if (remaining > 4 || next.pending || next.fadingUntil) return;
    next.pending = true;
    next.el.currentTime = 0;
    next.el.play().then(() => {
      next.pending = false;
      if (this.paused || this.hidden) {
        next.el.pause();
        return;
      }
      const start = this.ctx.currentTime;
      const duration = Math.max(0.08, Math.min(3.8, current.el.duration - current.el.currentTime));
      current.gain.gain.cancelScheduledValues(start);
      current.gain.gain.setValueAtTime(1, start);
      current.gain.gain.linearRampToValueAtTime(0, start + duration);
      next.gain.gain.cancelScheduledValues(start);
      next.gain.gain.setValueAtTime(0, start);
      next.gain.gain.linearRampToValueAtTime(1, start + duration);
      current.fadingUntil = start + duration;
      this.activeDeck = nextIndex;
      this.ambienceEl = next.el;
    }).catch(() => { next.pending = false; });
  }

  scare(vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running' || this.jumpscares.size || this.ctx.currentTime < this.nextScare) return;
    this.nextScare = this.ctx.currentTime + 3.2;
    if (!this.scareBuffer) {
      this.sting(vol);
      return;
    }
    this.stopEncounterScare();
    const src = this.ctx.createBufferSource();
    src.buffer = this.scareBuffer;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    const duration = Math.min(6, this.scareBuffer.duration);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.42 * clamp(vol), t + 0.018);
    g.gain.setTargetAtTime(0.0001, t + Math.max(0.04, duration - 1.4), 0.3);
    src.connect(g).connect(this.master);
    let cleaned = false;
    const release = () => {
      if (cleaned) return;
      cleaned = true;
      src.onended = null;
      src.disconnect();
      g.disconnect();
      if (this.encounterScare === voice) this.encounterScare = null;
    };
    const voice = {
      stop: () => {
        if (cleaned) return;
        try { src.stop(this.ctx.currentTime); } catch { /* Already stopped. */ }
        release();
      },
    };
    this.encounterScare = voice;
    src.onended = release;
    src.start();
    src.stop(t + duration);
  }

  stopEncounterScare() {
    if (this.encounterScare) this.encounterScare.stop();
  }

  beginJumpscare(kind = 'bacteria') {
    const silent = { impact() {}, stop() {}, finish() {} };
    this.stopEncounterScare();
    if (!this.ctx || this.ctx.state !== 'running' || this.paused || this.hidden) return silent;
    const ctx = this.ctx;
    const voices = [];
    const gain = ctx.createGain();
    gain.gain.value = 0.76;
    const output = this.out(false);
    gain.connect(output);
    const body = ctx.createGain();
    body.connect(gain);
    // A private reverb prevents a cancelled attack leaving sound in the shared room tail.
    const tail = ctx.createConvolver();
    tail.buffer = this.reverb.buffer;
    const wet = ctx.createGain();
    wet.gain.value = 0.13;
    body.connect(tail).connect(wet).connect(gain);
    let stopped = false;
    let impacted = false;
    const play = (method, options, dry = false) => {
      if (stopped) return;
      const cancel = this[method]({ ...options, bus: dry ? gain : body });
      if (cancel) voices.push(cancel);
    };
    const noise = (options, dry = false) => play('noiseBurst', options, dry);
    const tone = (options, dry = false) => play('tone', options, dry);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      for (const cancel of voices) cancel();
      voices.length = 0;
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      for (const node of [body, tail, wet, gain, output]) node.disconnect();
      if (output.panner) output.panner.disconnect();
      this.jumpscares.delete(handle);
      this.mixJumpscares();
    };
    const handle = {
      _gain: gain,
      _expiresAt: ctx.currentTime + 2.4,
      impact: () => {
        if (stopped || impacted || ctx.state !== 'running' || this.paused || this.hidden) return;
        impacted = true;
        handle._expiresAt = ctx.currentTime + 1.8;
        if (this.jumpscareBuffer) {
          // If decoding finished during the windup, cancel its fallback prelude.
          for (const cancel of voices) cancel();
          voices.length = 0;
          const source = ctx.createBufferSource();
          source.buffer = this.jumpscareBuffer;
          source.playbackRate.value = 1;
          source.detune.value = 0;
          const envelope = ctx.createGain();
          const t = ctx.currentTime;
          // Preserve the original opening hit, skipping only its leading silence.
          // .24 s windup + 1.62 s recording leaves a little visual-end margin.
          const offset = this.jumpscareOffset;
          const duration = Math.min(1.62, this.jumpscareBuffer.duration - offset);
          const fade = Math.min(0.16, duration * 0.25);
          envelope.gain.setValueAtTime(0.68, t);
          envelope.gain.setValueAtTime(0.68, t + duration - fade);
          envelope.gain.linearRampToValueAtTime(0, t + duration);
          // Preserve the recording's own texture without a synthesized roar or reverb.
          const recordedOutput = this.out(false, 0, gain);
          source.connect(envelope).connect(recordedOutput);
          voices.push(this.cleanup(source, [envelope], recordedOutput));
          source.start(t, offset);
          source.stop(t + duration);
          return;
        }
        // This transient starts on the visual lunge, independently of scare() cooldown.
        tone({ freq: 91, slideTo: 34, dur: 0.23, vol: 0.18, attack: 0.009 }, true);
        noise({ freq: 1050, slideTo: 240, dur: 0.19, vol: 0.115, attack: 0.008 }, true);
        if (kind === 'human-deer' || kind === 'blind-seeker') {
          tone({ freq: 66, slideTo: 38, type: 'sawtooth', cutoff: 680, dur: 1.2, vol: 0.085, attack: 0.06 });
          tone({ freq: 97.3, slideTo: 61, type: 'sawtooth', cutoff: 1100, dur: 0.92, vol: 0.036, attack: 0.035 });
          noise({ freq: 490, slideTo: 180, type: 'bandpass', q: 2.4, dur: 1.25, vol: 0.14, attack: 0.1, rate: 0.55 });
          for (const delay of [0.12, 0.27]) {
            noise({ freq: 1500, type: 'bandpass', q: 1.8, dur: 0.035, vol: 0.044, delay });
          }
        } else if (kind === 'wall-spider') {
          for (let i = 0; i < 10; i++) {
            noise({ freq: 2100 - i * 90, type: 'bandpass', q: 3, dur: 0.065, vol: 0.075, delay: i * 0.065 });
          }
          noise({ freq: 3200, slideTo: 750, type: 'bandpass', q: 1.5, dur: 1.1, vol: 0.14, attack: 0.035 });
          tone({ freq: 186, slideTo: 55, type: 'sawtooth', cutoff: 700, dur: 0.85, vol: 0.07 });
        } else if (kind === 'mimic') {
          for (const delay of [0, 0.09, 0.23, 0.46]) {
            noise({ freq: 650, slideTo: 180, type: 'bandpass', q: 1.8, dur: 0.12, vol: 0.12, delay });
          }
          tone({ freq: 72, slideTo: 28, type: 'sawtooth', cutoff: 650, dur: 1.25, vol: 0.12, attack: 0.025 });
          noise({ freq: 850, slideTo: 300, type: 'bandpass', q: 2, dur: 0.9, vol: 0.12, attack: 0.08 });
        } else if (kind === 'bacteria-pill') {
          noise({ freq: 1450, slideTo: 420, type: 'bandpass', q: 1.2, dur: 1.35, vol: 0.18, attack: 0.13, rate: 0.7 });
          noise({ freq: 3600, slideTo: 1900, type: 'bandpass', q: 0.8, dur: 0.57, vol: 0.055, attack: 0.07 });
          tone({ freq: 760, slideTo: 410, dur: 0.78, vol: 0.028, attack: 0.08, cutoff: 950 });
          tone({ freq: 123, slideTo: 47, type: 'sawtooth', cutoff: 360, dur: 1.2, vol: 0.032, attack: 0.09 });
        } else {
          // Bacteria and accurate-bacteria share a dry, irregular joint rattle.
          for (let i = 0; i < 8; i++) {
            noise({ freq: 700 + Math.random() * 1550, type: 'bandpass', q: 2.8, dur: 0.055 + Math.random() * 0.035, vol: 0.07 - i * 0.004, delay: i * 0.071 });
          }
          tone({ freq: 83, slideTo: 31, type: 'sawtooth', cutoff: 550, dur: 1.05, vol: 0.072, attack: 0.045 });
          tone({ freq: 334, slideTo: 243, type: 'triangle', cutoff: 900, dur: 0.83, vol: 0.034, attack: 0.03 });
          tone({ freq: 503, slideTo: 427, dur: 0.65, vol: 0.018, attack: 0.035 });
          noise({ freq: 1040, slideTo: 380, type: 'bandpass', q: 1.6, dur: 0.9, vol: 0.085, attack: 0.1 });
        }
      },
      stop,
      finish: stop,
    };
    this.jumpscares.add(handle);
    this.mixJumpscares();
    if (!this.jumpscareBuffer) {
      // The synthesized windup is only a fallback while the recording is unavailable.
      noise({ freq: kind === 'bacteria-pill' ? 1700 : 850, slideTo: 1350, type: 'bandpass', q: 1.3, dur: 0.23, vol: 0.075, attack: 0.11 }, true);
      noise({ freq: kind === 'human-deer' ? 1250 : 2100, type: 'bandpass', q: 1.5, dur: 0.026, vol: 0.038, delay: 0.15 }, true);
      tone({ freq: 210, slideTo: 91, dur: 0.075, vol: 0.027, delay: 0.15 }, true);
    }
    return handle;
  }

  mixJumpscares() {
    if (!this.ctx) return;
    const count = this.jumpscares.size;
    const now = this.ctx.currentTime;
    if (this.ambienceGain) {
      this.ambienceGain.gain.setTargetAtTime(this.ambienceLevel * (count ? 0.62 : 1), now, count ? 0.14 : 0.65);
    }
    // Shared compression plus per-handle attenuation bounds simultaneous attacks.
    for (const handle of this.jumpscares) {
      handle._gain.gain.setTargetAtTime(0.76 / Math.sqrt(count), now, 0.025);
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.74, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  // Scoped panning preserves all existing effect signatures.
  withPan(pan, play) {
    const previous = this.cuePan;
    this.cuePan = clamp(pan, -1, 1);
    try { return play(); } finally { this.cuePan = previous; }
  }

  out(reverb = true, pan = this.cuePan, bus = null) {
    const g = this.ctx.createGain();
    // An owned effect bus supplies its own panning and cancellable reverb.
    if (bus) {
      g.connect(bus);
      return g;
    }
    if (this.ctx.createStereoPanner && Math.abs(pan) > 0.001) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      g.connect(panner).connect(this.master);
      if (reverb) panner.connect(this.reverb);
      g.panner = panner;
    } else {
      g.connect(this.master);
      if (reverb) g.connect(this.reverb);
    }
    return g;
  }

  cleanup(source, nodes, output) {
    let cleaned = false;
    const disconnect = () => {
      if (cleaned) return;
      cleaned = true;
      source.onended = null;
      source.disconnect();
      for (const node of nodes) node.disconnect();
      output.disconnect();
      if (output.panner) output.panner.disconnect();
    };
    source.onended = disconnect;
    return () => {
      if (cleaned) return;
      try { source.stop(this.ctx.currentTime); } catch { /* Already stopped. */ }
      disconnect();
    };
  }

  noiseBurst({ dur = 0.1, freq = 1000, type = 'lowpass', q = 1, vol = 0.3, attack = 0.002, delay = 0, reverb = true, rate = 1, pan = this.cuePan, slideTo = 0, bus = null }) {
    if (!this.ctx || this.ctx.state !== 'running' || vol <= 0.001) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = rate;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(attack, dur * 0.8));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const output = this.out(reverb, pan, bus);
    src.connect(f).connect(g).connect(output);
    const cancel = this.cleanup(src, [f, g], output);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.05);
    return cancel;
  }

  tone({ freq = 440, type = 'sine', dur = 0.3, vol = 0.2, attack = 0.005, slideTo = 0, delay = 0, reverb = true, pan = this.cuePan, cutoff = 1600, bus = null }) {
    if (!this.ctx || this.ctx.state !== 'running' || vol <= 0.001) return;
    const t = this.ctx.currentTime + delay;
    const oscillator = this.ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, t);
    if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(attack, dur * 0.8));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const output = this.out(reverb, pan, bus);
    oscillator.connect(filter).connect(g).connect(output);
    const cancel = this.cleanup(oscillator, [filter, g], output);
    oscillator.start(t);
    oscillator.stop(t + dur + 0.05);
    return cancel;
  }

  // ---------- room tone and threat ----------

  startAmbience() {
    const ctx = this.ctx;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.065;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 160;
    filter.connect(this.droneGain).connect(this.master);
    for (const [freq, type] of [[41.3, 'sine'], [60.1, 'triangle'], [83.1, 'sine']]) {
      const oscillator = ctx.createOscillator();
      oscillator.type = type;
      oscillator.frequency.value = freq;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.04 + Math.random() * 0.07;
      const modulation = ctx.createGain();
      modulation.gain.value = 0.8;
      lfo.connect(modulation).connect(oscillator.frequency);
      oscillator.connect(filter);
      oscillator.start();
      lfo.start();
    }
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'lowpass';
    rumble.frequency.value = 220;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.065;
    source.connect(rumble).connect(rumbleGain).connect(this.master);
    source.start();

    // A slowly opening pressure layer follows nearby threats.
    this.pressureFilter = ctx.createBiquadFilter();
    this.pressureFilter.type = 'bandpass';
    this.pressureFilter.frequency.value = 340;
    this.pressureFilter.Q.value = 1.7;
    this.pressureGain = ctx.createGain();
    this.pressureGain.gain.value = 0;
    source.connect(this.pressureFilter).connect(this.pressureGain).connect(this.out(true));
  }

  ambientEvent() {
    const r = Math.random();
    const pan = (Math.random() * 2 - 1) * 0.82;
    if (r < 0.28) {
      // Water in a shallow puddle: click, rounded cavity, softer reflection.
      const frequency = 700 + Math.random() * 900;
      this.noiseBurst({ dur: 0.025, freq: 3200, type: 'bandpass', q: 1.8, vol: 0.045, pan });
      this.tone({ freq: frequency, slideTo: frequency * 0.62, dur: 0.085, vol: 0.025, pan });
      this.tone({ freq: frequency * 0.7, dur: 0.08, vol: 0.012, delay: 0.17, pan: -pan * 0.4 });
    } else if (r < 0.58) {
      // Flexing pipes have inharmonic resonances.
      const base = 75 + Math.random() * 55;
      for (const [ratio, level] of [[1, 0.045], [2.73, 0.018], [5.19, 0.009]]) {
        this.tone({ freq: base * ratio, slideTo: base * ratio * 0.87, dur: 1.8, vol: level, attack: 0.3, pan, cutoff: 900 });
      }
      this.noiseBurst({ dur: 1.1, freq: 380, slideTo: 160, type: 'bandpass', q: 4, vol: 0.06, attack: 0.15, pan });
    } else if (r < 0.8) {
      this.noiseBurst({ dur: 1.6, freq: 780, slideTo: 220, type: 'bandpass', q: 2.7, vol: 0.05, attack: 0.7, rate: 0.53, pan });
      this.tone({ freq: 77, slideTo: 42, dur: 0.25, vol: 0.045, delay: 1.3, pan });
    } else {
      for (let i = 0; i < 3; i++) {
        const delay = i * 0.38 + Math.random() * 0.1;
        this.noiseBurst({ dur: 0.05, freq: 600, vol: 0.045, delay, pan });
        this.tone({ freq: 137 + Math.random() * 35, dur: 0.17, vol: 0.022, delay, pan });
      }
    }
  }

  startWhisper() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 4;
    f.frequency.value = 1100;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.43;
    const modulation = ctx.createGain();
    modulation.gain.value = 430;
    lfo.connect(modulation).connect(f.frequency);
    this.whisperGain = ctx.createGain();
    this.whisperGain.gain.value = 0;
    src.connect(f).connect(this.whisperGain).connect(this.out(true, -0.24));
    src.start();
    lfo.start();
  }

  setWhisper(level) { this.whisper = clamp(level); }
  setDanger(level) { this.danger = clamp(level); }

  update(dt, playing) {
    if (!this.ctx || this.ctx.state !== 'running' || this.paused || this.hidden) return;
    const now = this.ctx.currentTime;
    this.updateAmbience(now);
    const danger = playing ? this.danger : 0;
    const breath = 0.62 + Math.sin(now * 2.3) * 0.19 + Math.sin(now * 5.7) * 0.1;
    this.whisperGain.gain.setTargetAtTime(playing ? this.whisper * 0.19 * breath : 0, now, 0.24);
    this.pressureGain.gain.setTargetAtTime(danger * danger * 0.11, now, 1.1);
    this.pressureFilter.frequency.setTargetAtTime(280 + danger * 540, now, 1.2);
    this.ambienceLevel = (playing ? 0.4 : 0.28) - danger * 0.1;
    for (const handle of this.jumpscares) if (now >= handle._expiresAt) handle.stop();
    this.mixJumpscares();
    if (playing && danger > 0.18 && now >= this.nextBeat) {
      const vol = 0.045 + danger * 0.15;
      this.tone({ freq: 56, slideTo: 34, dur: 0.17, vol, reverb: false });
      this.tone({ freq: 49, slideTo: 31, dur: 0.19, vol: vol * 0.68, delay: 0.18, reverb: false });
      this.noiseBurst({ dur: 0.065, freq: 100, vol: vol * 0.2, reverb: false });
      this.nextBeat = now + 1.12 - danger * 0.57;
    }
    if (playing) this.nextAmbient -= dt;
    if (playing && this.nextAmbient <= 0) {
      this.ambientEvent();
      this.nextAmbient = 5 + Math.random() * 9;
    }
  }

  // ---------- physical effects ----------

  pipeDrip(vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const level = clamp(vol);
    if (level <= 0.01) return;
    const frequency = 820 + Math.random() * 320;
    // A soft surface tick, rounded water cavity, and a small reflected splash.
    this.noiseBurst({ dur: 0.026, freq: 2300, type: 'bandpass', q: 1.2, vol: 0.024 * level });
    this.tone({ freq: frequency, slideTo: frequency * 0.56, dur: 0.105, vol: 0.032 * level, cutoff: 1800 });
    this.noiseBurst({ dur: 0.13, freq: 1150, slideTo: 650, type: 'bandpass', q: 0.8, vol: 0.026 * level, attack: 0.018, delay: 0.02 });
    this.tone({ freq: frequency * 0.58, slideTo: frequency * 0.45, dur: 0.15, vol: 0.009 * level, attack: 0.012, delay: 0.15 });
  }

  lightFault(vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const level = clamp(vol);
    if (level <= 0.01) return;
    // Brief ballast collapse followed by a weak restrike; never a sustained loop.
    this.tone({ freq: 118, slideTo: 48, type: 'sawtooth', cutoff: 600, dur: 0.16, vol: 0.017 * level });
    for (const delay of [0, 0.065, 0.145]) {
      this.noiseBurst({ dur: 0.022 + Math.random() * 0.018, freq: 1700 + Math.random() * 700, type: 'bandpass', q: 1.4, vol: 0.032 * level, delay });
    }
    this.tone({ freq: 121, slideTo: 117, type: 'sawtooth', cutoff: 720, dur: 0.24, vol: 0.022 * level, attack: 0.035, delay: 0.15 });
  }

  footstep(vol, sprint) {
    const pitch = 0.85 + Math.random() * 0.3;
    this.noiseBurst({ dur: sprint ? 0.14 : 0.1, freq: (sprint ? 650 : 430) * pitch, vol: vol * (sprint ? 0.22 : 0.11), rate: 0.6 });
    this.tone({ freq: (sprint ? 86 : 72) * pitch, slideTo: 38, dur: 0.11, vol: vol * (sprint ? 0.07 : 0.035) });
    this.noiseBurst({ dur: 0.055, freq: 1500, type: 'bandpass', q: 0.8, vol: vol * 0.035, delay: 0.055, rate: 0.7 });
  }

  crack(vol = 1) {
    this.noiseBurst({ dur: 0.1, freq: 1900, type: 'highpass', vol: 0.22 * vol });
    this.tone({ freq: 1780, slideTo: 1520, dur: 0.075, vol: 0.04 * vol, cutoff: 3000 });
  }

  shatter(vol = 1) {
    this.noiseBurst({ dur: 0.33, freq: 2400, type: 'highpass', vol: 0.3 * vol });
    for (let i = 0; i < 8; i++) {
      const delay = 0.06 + Math.random() * 0.45;
      this.tone({ freq: 1800 + Math.random() * 3700, dur: 0.055 + Math.random() * 0.12, vol: 0.028 * vol, delay, cutoff: 6500 });
      this.noiseBurst({ dur: 0.025, freq: 3200, type: 'bandpass', vol: 0.035 * vol, delay });
    }
  }

  thud(vol = 1) {
    this.tone({ freq: 105, slideTo: 39, dur: 0.22, vol: 0.2 * vol });
    this.noiseBurst({ dur: 0.13, freq: 420, vol: 0.17 * vol });
  }

  pickup() {
    this.noiseBurst({ dur: 0.13, freq: 900, type: 'bandpass', q: 0.8, vol: 0.055, reverb: false });
    this.tone({ freq: 136, slideTo: 96, dur: 0.075, vol: 0.035, reverb: false });
  }

  cash() {
    // A deposit hatch latches and a coin settles.
    this.thud(0.32);
    this.noiseBurst({ dur: 0.09, freq: 1800, type: 'bandpass', q: 2, vol: 0.08, delay: 0.12 });
    for (const [frequency, delay] of [[1703, 0.15], [2411, 0.21], [1703, 0.32]]) {
      this.tone({ freq: frequency, dur: 0.08, vol: 0.02, delay, cutoff: 2800 });
    }
  }

  rattle(vol = 1) {
    for (let i = 0; i < 5; i++) {
      const delay = i * 0.07 + Math.random() * 0.04;
      this.noiseBurst({ dur: 0.045, freq: 700 + Math.random() * 1800, type: 'bandpass', q: 3.5, vol: 0.13 * vol, delay, rate: 0.7 });
      this.tone({ freq: 230 + Math.random() * 160, dur: 0.06, vol: 0.022 * vol, delay });
    }
    this.noiseBurst({ dur: 0.42, freq: 420, type: 'bandpass', q: 2.8, vol: 0.06 * vol, attack: 0.1 });
  }

  groan(vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running' || vol <= 0.01) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(58 + Math.random() * 12, t);
    oscillator.frequency.exponentialRampToValueAtTime(39, t + 1.7);
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 4.6;
    const modulation = ctx.createGain();
    modulation.gain.value = 3.4;
    vibrato.connect(modulation).connect(oscillator.frequency);
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.Q.value = 2.6;
    formant.frequency.setValueAtTime(490, t);
    formant.frequency.exponentialRampToValueAtTime(190, t + 1.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.15 * vol, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
    const output = this.out(true);
    oscillator.connect(formant).connect(g).connect(output);
    this.cleanup(oscillator, [vibrato, modulation, formant, g], output);
    oscillator.start(t);
    vibrato.start(t);
    oscillator.stop(t + 2);
    vibrato.stop(t + 2);
    this.noiseBurst({ dur: 1.7, freq: 700, slideTo: 240, type: 'bandpass', q: 1.5, vol: 0.1 * vol, attack: 0.35, rate: 0.6 });
  }

  sting(vol = 1) {
    for (const frequency of [43, 61.8, 92.6, 137.3]) {
      this.tone({ freq: frequency, slideTo: frequency * 0.61, type: 'sawtooth', dur: 1.7, vol: 0.045 * clamp(vol), attack: 0.025, cutoff: 680 });
    }
    this.noiseBurst({ dur: 1.2, freq: 1200, slideTo: 160, vol: 0.16 * clamp(vol), attack: 0.025 });
  }

  bell() {
    for (const [frequency, volume, duration] of [[391, 0.085, 2.5], [1049, 0.035, 1.6], [1941, 0.012, 0.7]]) {
      this.tone({ freq: frequency, dur: duration, vol: volume, cutoff: 2700 });
    }
    this.noiseBurst({ dur: 0.03, freq: 2300, type: 'bandpass', vol: 0.06 });
  }

  radio() {
    this.noiseBurst({ dur: 0.28, freq: 1600, type: 'bandpass', q: 2, vol: 0.1, reverb: false });
    this.noiseBurst({ dur: 0.04, freq: 700, type: 'bandpass', q: 4, vol: 0.08, delay: 0.23, reverb: false });
  }

  click() {
    this.noiseBurst({ dur: 0.025, freq: 1300, type: 'bandpass', q: 1.7, vol: 0.055, reverb: false });
    this.tone({ freq: 187, dur: 0.025, vol: 0.02, reverb: false });
  }

  flashClick() {
    this.noiseBurst({ dur: 0.025, freq: 2600, type: 'bandpass', q: 2.5, vol: 0.09, reverb: false });
    this.noiseBurst({ dur: 0.018, freq: 920, type: 'bandpass', q: 3, vol: 0.045, delay: 0.035, reverb: false });
  }

  revive() {
    this.noiseBurst({ dur: 1.2, freq: 480, slideTo: 1600, type: 'bandpass', q: 1.4, vol: 0.09, attack: 0.3 });
    this.tone({ freq: 54, slideTo: 87, dur: 1.5, vol: 0.08, attack: 0.4 });
    this.bell();
  }

  lowBattery() {
    this.noiseBurst({ dur: 0.075, freq: 2400, type: 'bandpass', q: 8, vol: 0.04, reverb: false });
    this.tone({ freq: 720, slideTo: 520, dur: 0.06, vol: 0.023, type: 'triangle', reverb: false });
  }
}
