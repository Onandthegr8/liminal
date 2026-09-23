import { CONFIG } from '../core/config.js';
import { events, EVT } from '../core/events.js';

// Sprinting drains stamina; walking/standing recovers it after a short delay.
// Empty = forced walk (exhausted) until it refills past a threshold. Sprint is
// also what makes the loud noise the Stalker hears.
export class Stamina {
  constructor(game) {
    this.game = game;
    this.cfg = CONFIG.stamina;
    this.value = this.cfg.max;
    this.exhausted = false;
    this._recoverDelay = 0;
  }

  reset() {
    this.value = this.cfg.max;
    this.exhausted = false;
    this._recoverDelay = 0;
  }

  canSprint() {
    return !this.exhausted && this.value > 0.5;
  }

  update(dt) {
    const p = this.game.player;
    const sprinting = p.isSprinting && p.speed > 0.5;

    if (sprinting) {
      this.value -= this.cfg.sprintDrain * dt;
      this._recoverDelay = this.cfg.recoverDelay;
      if (this.value <= this.cfg.exhaustedThreshold) {
        this.value = Math.max(0, this.value);
        if (!this.exhausted) {
          this.exhausted = true;
          events.emit(EVT.SUBTITLE, { text: 'You are out of breath.', ms: 1800 });
        }
      }
    } else {
      if (this._recoverDelay > 0) this._recoverDelay -= dt;
      else this.value = Math.min(this.cfg.max, this.value + this.cfg.recover * dt);
      if (this.exhausted && this.value >= this.cfg.exhaustedRecoverTo) this.exhausted = false;
    }
  }
}
