import { CONFIG } from '../core/config.js';
import { events, EVT } from '../core/events.js';

// All sound is synthesized with the Web Audio API — no audio files.
// The AudioContext starts on the first user gesture (mobile requirement);
// Screens calls audio.unlock() from its Start button handler.
export class AudioSystem {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this._stepT = 0;
    this._beatT = 0;
    this._growl = null;
    this._chaseActive = false;
    this._chordT = 0;
    this._chordIdx = 0;
    this._pingT = 8;
    this._dripT = 2;
    this._thumpT = 0;
    this._env = null; // active pocket kind or null

    // The stinger fires on any creature's chase start; the sustained chase
    // layer is computed in update() from ALL creatures (any still chasing),
    // so one creature calming down can't silence another's hunt.
    events.on(EVT.STALKER_CHASE_START, () => this.chaseStinger());
    events.on(EVT.PICKUP_CHIME, () => this.chime('pickup'));
    events.on(EVT.DOOR_CHIME, () => this.chime('door'));
    events.on(EVT.SHIFT, ({ blackout }) => {
      if (!blackout) this.shiftRumble();
    });
    events.on(EVT.KEYPAD_FAIL, () => this.keypadBuzz());
    events.on(EVT.SCARE, () => this.scareSting());
  }

  // Must be called from a user gesture (click/tap on Start).
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : CONFIG.audio.masterVolume;
    this.master.connect(this.ctx.destination);
    this._buildAmbient();
    this._buildGrowl();
    this._buildMusic();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      this.master.gain.linearRampToValueAtTime(
        m ? 0 : CONFIG.audio.masterVolume,
        this.ctx.currentTime + 0.1
      );
    }
  }

  _now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // --- persistent layers -----------------------------------------------------

  // Fluorescent hum (mains buzz + harmonic) and faint filtered-noise room tone.
  _buildAmbient() {
    const ctx = this.ctx;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.02;
    humGain.connect(this.master);
    for (const [freq, amp] of [[120, 1], [240, 0.4], [360, 0.15]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = amp;
      o.connect(g);
      g.connect(humGain);
      o.start();
    }
    this._humGain = humGain;

    // Room tone: looped filtered noise.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.value = 0.015;
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start();

    // Sanity drone layer (detuned saws), silent until sanity drops.
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0;
    droneGain.connect(this.master);
    for (const det of [-8, 0, 11]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 55;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = 0.3;
      o.connect(og);
      og.connect(droneGain);
      o.start();
    }
    this._droneGain = droneGain;
  }

  // Stalker proximity growl: filtered noise + low osc, panned, gain by distance.
  _buildGrowl() {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 42;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;
    const trem = ctx.createOscillator();
    trem.frequency.value = 5.3;
    const tremGain = ctx.createGain();
    tremGain.gain.value = 0.5;
    const carrier = ctx.createGain();
    carrier.gain.value = 0.5;
    trem.connect(tremGain);
    tremGain.connect(carrier.gain);
    o.connect(lp);
    lp.connect(carrier);
    carrier.connect(g);
    if (pan) {
      g.connect(pan);
      pan.connect(this.master);
    } else {
      g.connect(this.master);
    }
    o.start();
    trem.start();
    this._growl = { gain: g, pan, osc: o };
  }

  // Background music: a slow detuned pad cycling minor chords, sparse music-box
  // pings through a feedback delay, and a separate chase layer (pulse + tremolo
  // saw) that only sounds while the Stalker is in CHASE.
  _buildMusic() {
    const ctx = this.ctx;
    const M = CONFIG.music;

    // Shared musical low-pass — takes the sharpness off the whole score.
    this._musicBus = ctx.createGain();
    this._musicBus.gain.value = 1;
    const musicLp = ctx.createBiquadFilter();
    musicLp.type = 'lowpass';
    musicLp.frequency.value = M.toneCutoff;
    musicLp.Q.value = 0.4;
    this._musicBus.connect(musicLp);
    musicLp.connect(this.master);

    // Pad: 3 oscillators that glide between chord tones.
    this._padGain = ctx.createGain();
    this._padGain.gain.value = M.padVolume;
    const padLp = ctx.createBiquadFilter();
    padLp.type = 'lowpass';
    padLp.frequency.value = 380;
    this._padGain.connect(padLp);
    padLp.connect(this._musicBus);
    this._padOscs = [];
    // Am → Fmaj7-ish → Dm → E, rooted very low.
    this._chords = [
      [110.0, 130.81, 164.81],
      [87.31, 130.81, 174.61],
      [73.42, 110.0, 146.83],
      [82.41, 103.83, 164.81],
    ];
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = this._chords[0][i];
      o.detune.value = (i - 1) * 6;
      o.connect(this._padGain);
      o.start();
      this._padOscs.push(o);
    }

    // Music-box ping delay chain (shared by _ping()).
    this._delay = ctx.createDelay(1.5);
    this._delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.45;
    this._delay.connect(fb);
    fb.connect(this._delay);
    const wet = ctx.createGain();
    wet.gain.value = 0.4;
    this._delay.connect(wet);
    wet.connect(this._musicBus);

    // Chase layer: soft triangle swell (was a harsh saw), gain 0 until CHASE.
    this._chaseGain = ctx.createGain();
    this._chaseGain.gain.value = 0;
    const saw = ctx.createOscillator();
    saw.type = 'triangle';
    saw.frequency.value = 92.5;
    const saw2 = ctx.createOscillator();
    saw2.type = 'triangle';
    saw2.frequency.value = 92.5 * 1.5; // a fifth, not a grinding beat
    const chLp = ctx.createBiquadFilter();
    chLp.type = 'lowpass';
    chLp.frequency.value = 420;
    const trem = ctx.createOscillator();
    trem.frequency.value = 8.5;
    const tremG = ctx.createGain();
    tremG.gain.value = 0.5;
    const carrier = ctx.createGain();
    carrier.gain.value = 0.5;
    trem.connect(tremG);
    tremG.connect(carrier.gain);
    saw.connect(chLp);
    saw2.connect(chLp);
    chLp.connect(carrier);
    carrier.connect(this._chaseGain);
    this._chaseGain.connect(this._musicBus);
    saw.start();
    saw2.start();
    trem.start();
  }

  _ping() {
    if (!this.ctx) return;
    // Lower, mellower register than before — no piercing octave jumps.
    const scale = [261.63, 311.13, 349.23, 392.0, 466.16];
    const f = scale[(Math.random() * scale.length) | 0];
    const t = this._now();
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(CONFIG.music.pingVolume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(g);
    g.connect(this._musicBus);
    g.connect(this._delay);
    o.start(t);
    o.stop(t + 1.9);
  }

  _thump() {
    // Chase pulse: a muffled kick.
    if (!this.ctx) return;
    const t = this._now();
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
  }

  // Per-place ambience. `kind` is a theme key ('backrooms','sewage',...).
  setEnvironment(kind) {
    this._env = kind;
    if (!this.ctx) return;
    const t = this._now();
    const enclosedHum = kind === 'backrooms' || kind === 'hospital' || kind === 'office' || kind === 'sewage';
    this._humGain?.gain.linearRampToValueAtTime(enclosedHum ? 0.02 : 0.002, t + 0.6);
    // Gardens/fields calm the pad; the hotel/graveyard let the drones creep in.
    const bright = kind === 'garden' || kind === 'field';
    this._padGain?.gain.linearRampToValueAtTime(
      bright ? CONFIG.music.padVolume * 1.3 : CONFIG.music.padVolume,
      t + 1
    );
  }

  _drip() {
    if (!this.ctx) return;
    const t = this._now();
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    const f0 = 900 + Math.random() * 900;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.09);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g);
    g.connect(this.master);
    g.connect(this._delay);
    o.start(t);
    o.stop(t + 0.45);
  }

  // --- one-shots ---------------------------------------------------------------

  _blip(freq, dur, type = 'sine', vol = 0.2, when = 0) {
    if (!this.ctx) return;
    const t = this._now() + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _noiseBurst(dur, freq, vol, when = 0, type = 'bandpass') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this._now() + when;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
  }

  footstep(sprinting) {
    this._noiseBurst(0.07, sprinting ? 900 : 600, sprinting ? 0.4 : 0.18, 0, 'lowpass');
  }

  heartbeat() {
    // lub-dub
    this._blip(52, 0.11, 'sine', 0.5);
    this._blip(44, 0.13, 'sine', 0.4, 0.14);
  }

  whisper() {
    this._noiseBurst(0.7, 2400, 0.12, 0, 'bandpass');
    this._noiseBurst(0.5, 3100, 0.08, 0.18, 'bandpass');
  }

  chime(kind) {
    if (kind === 'pickup') {
      this._blip(880, 0.18, 'triangle', 0.25);
      this._blip(1320, 0.22, 'triangle', 0.2, 0.09);
    } else {
      // door powering: rising hum
      this._blip(220, 0.5, 'sawtooth', 0.18);
      this._blip(330, 0.5, 'sawtooth', 0.16, 0.18);
      this._blip(440, 0.7, 'triangle', 0.2, 0.36);
    }
  }

  chaseStinger() {
    if (!this.ctx) return;
    // dissonant cluster + noise slam
    for (const [f, d] of [[196, 0], [207, 0.02], [415, 0.04], [622, 0.05]]) {
      this._blip(f, 1.1, 'sawtooth', 0.22, d);
    }
    this._noiseBurst(0.5, 500, 0.5, 0, 'lowpass');
  }

  noclip() {
    // lights-cut beat: low hum swell + electrical sputter
    this._blip(38, 1.4, 'sine', 0.5);
    this._noiseBurst(0.25, 3000, 0.2, 0.1);
    this._noiseBurst(0.18, 2400, 0.18, 0.4);
  }

  // Short screech for ambient mini-scares (face flash, phantom, door fake-out).
  scareSting() {
    if (!this.ctx) return;
    const t = this._now();
    for (const det of [0, 33, -41]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(950 + det * 3, t);
      o.frequency.exponentialRampToValueAtTime(300, t + 0.35);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 0.45);
    }
    this._noiseBurst(0.3, 2000, 0.3, 0, 'highpass');
  }

  // The Stalker slams the locker you're hiding in.
  lockerBang() {
    this._noiseBurst(0.4, 220, 0.8, 0, 'lowpass');
    this._blip(60, 0.5, 'square', 0.4);
    this._noiseBurst(0.3, 400, 0.5, 0.5, 'lowpass');
  }

  keypadBeep() {
    this._blip(1240, 0.08, 'square', 0.12);
  }

  keypadBuzz() {
    this._blip(110, 0.8, 'square', 0.3);
    this._blip(104, 0.8, 'square', 0.25, 0.02);
  }

  shiftRumble() {
    this._blip(30, 1.8, 'sine', 0.3);
  }

  jumpscare() {
    if (!this.ctx) return;
    // BRUTAL: full-band scream — detuned saw cluster, pitch drop, noise slam.
    const ctx = this.ctx;
    const t = this._now();
    for (const det of [0, 23, -31, 47, -52]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(700 + det * 4, t);
      o.frequency.exponentialRampToValueAtTime(120, t + 0.9);
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.28, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 1.2);
    }
    this._noiseBurst(0.9, 1200, 0.6, 0, 'highpass');
    this._noiseBurst(0.6, 300, 0.7, 0.05, 'lowpass');
    // Sub drop — the floor falls out.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(90, t);
    sub.frequency.exponentialRampToValueAtTime(24, t + 1.3);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.55, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    sub.connect(sg);
    sg.connect(this.master);
    sub.start(t);
    sub.stop(t + 1.5);
    // Rising screech gliss over the top.
    const scr = ctx.createOscillator();
    scr.type = 'sawtooth';
    scr.frequency.setValueAtTime(400, t);
    scr.frequency.exponentialRampToValueAtTime(2600, t + 0.5);
    const scrG = ctx.createGain();
    scrG.gain.setValueAtTime(0.16, t);
    scrG.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    scr.connect(scrG);
    scrG.connect(this.master);
    scr.start(t);
    scr.stop(t + 0.65);
  }

  // --- per-frame ---------------------------------------------------------------

  update(dt) {
    if (!this.ctx) return;
    if (this.game.state !== 'playing') {
      // Wind the chase layer down instead of freezing it mid-hunt.
      if (this._chaseActive) {
        this._chaseActive = false;
        this._chaseGain?.gain.linearRampToValueAtTime(0, this._now() + 0.4);
      }
      return;
    }
    const p = this.game.player;
    const st = this.game.stalker;

    // Chase layer is on while ANY creature is hunting.
    this._chaseActive = !!this.game.stalkers?.some((s) => s.state === 'CHASE');

    // Footsteps: rate tied to speed.
    if (p.speed > 0.4 && !p.isHiding) {
      this._stepT -= dt * (p.speed / CONFIG.player.walkSpeed);
      if (this._stepT <= 0) {
        this.footstep(p.isSprinting);
        this._stepT = 0.52;
      }
    } else {
      this._stepT = Math.min(this._stepT, 0.2);
    }

    // Heartbeat: fades in with proximity, tempo scales.
    const prox = st ? st.proximity : 0;
    if (prox > 0.15) {
      this._beatT -= dt;
      if (this._beatT <= 0) {
        this.heartbeat();
        this._beatT = 1.15 - prox * 0.75; // closer = faster
      }
    }

    // Growl gain + pan by stalker position.
    if (this._growl && st) {
      const target = Math.min(0.4, prox * 0.5) * (st.state === 'CHASE' ? 1.4 : 1);
      this._growl.gain.gain.linearRampToValueAtTime(target, this._now() + 0.1);
      if (this._growl.pan) {
        // pan by which side the stalker is on relative to player facing
        const fwd = p.getForward();
        const dx = st.position.x - p.position.x;
        const dz = st.position.z - p.position.z;
        const len = Math.hypot(dx, dz) || 1;
        // right vector = (-fz, fx)
        const side = (-fwd.z * dx + fwd.x * dz) / len;
        this._growl.pan.pan.linearRampToValueAtTime(
          Math.max(-1, Math.min(1, side)),
          this._now() + 0.1
        );
      }
    }

    // Sanity drone level.
    if (this._droneGain) {
      const s = this.game.sanity.value / CONFIG.sanity.max;
      const target = s < 0.45 ? (0.45 - s) * 0.25 : 0;
      this._droneGain.gain.linearRampToValueAtTime(target, this._now() + 0.3);
    }

    // Hum reacts slightly to flicker randomness (only in the maze).
    if (this._humGain && !this._env && Math.random() < 0.01) {
      this._humGain.gain.setValueAtTime(0.02 + Math.random() * 0.02, this._now());
    }

    // --- music ---
    // Chord cycling: glide the pad to the next chord every ~9s.
    this._chordT -= dt;
    if (this._padOscs && this._chordT <= 0) {
      this._chordT = 9;
      this._chordIdx = (this._chordIdx + 1) % this._chords.length;
      const chord = this._chords[this._chordIdx];
      const t = this._now();
      for (let i = 0; i < this._padOscs.length; i++) {
        this._padOscs[i].frequency.linearRampToValueAtTime(chord[i], t + 3.5);
      }
    }

    // Sparse music-box pings (never during a chase — the pulse owns that space).
    this._pingT -= dt;
    if (this._pingT <= 0) {
      this._pingT = 7 + Math.random() * 9;
      if (!this._chaseActive && !this._env) this._ping();
    }

    // Chase layer: gain + kick pulse while hunted.
    if (this._chaseGain) {
      const target = this._chaseActive ? CONFIG.music.chaseVolume : 0;
      this._chaseGain.gain.linearRampToValueAtTime(target, this._now() + 0.4);
    }
    if (this._chaseActive) {
      this._thumpT -= dt;
      if (this._thumpT <= 0) {
        this._thumpT = 0.42;
        this._thump();
      }
    }

    // Sewage drips.
    if (this._env === 'sewage') {
      this._dripT -= dt;
      if (this._dripT <= 0) {
        this._dripT = 1.5 + Math.random() * 3.5;
        this._drip();
      }
    }
  }
}
