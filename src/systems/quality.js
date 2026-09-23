import { CONFIG } from '../core/config.js';

// Quality auto-detect: starts from a device guess, then adjusts by measured fps.
// Levels tune pixel ratio, active light count, and fog density. Manual override
// available from the menu (Screens).
const LEVELS = {
  high: { pixelRatio: 2, maxLights: 12, fogScale: 1.0 },
  medium: { pixelRatio: 1.5, maxLights: 8, fogScale: 1.1 },
  low: { pixelRatio: 1, maxLights: 4, fogScale: 1.25 },
};

export class Quality {
  constructor(game) {
    this.game = game;
    this.manual = null; // 'high' | 'medium' | 'low' | null (auto)
    this.level = this._guess();
    this._fpsAcc = 0;
    this._fpsN = 0;
    this._checkT = 3; // settle time before first adjustment
    this.apply();
  }

  _guess() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const mem = navigator.deviceMemory || 8;
    if (coarse && mem <= 4) return 'low';
    if (coarse) return 'medium';
    return 'high';
  }

  get maxLights() {
    return LEVELS[this.level].maxLights;
  }

  setManual(level) {
    this.manual = level; // null = back to auto
    if (level) {
      this.level = level;
      this.apply();
    }
  }

  apply() {
    const q = LEVELS[this.level];
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w && h) {
      // (0×0 can be reported transiently during rotation — never size to it.)
      const pr = Math.min(window.devicePixelRatio, q.pixelRatio, CONFIG.pixelRatioCap);
      this.game.renderer.setPixelRatio(pr);
      this.game.renderer.setSize(w, h);
    }
    // Respect the current place's fog multiplier.
    if (this.game.scene?.fog && this.game.params) {
      const themeMul = this.game.theme?.fogMul ?? 1;
      this.game.scene.fog.density = this.game.params.fogDensity * q.fogScale * themeMul;
    }
  }

  // Called every rendered frame with real dt.
  frameTick(dt) {
    if (this.manual) return;
    this._fpsAcc += dt;
    this._fpsN++;
    this._checkT -= dt;
    if (this._checkT > 0) return;
    this._checkT = 4;
    const avgFps = this._fpsN / (this._fpsAcc || 1);
    this._fpsAcc = 0;
    this._fpsN = 0;
    if (this.game.state !== 'playing') return;

    if (avgFps < 26 && this.level !== 'low') {
      this.level = this.level === 'high' ? 'medium' : 'low';
      this.apply();
    } else if (avgFps > 55 && this.level === 'low') {
      this.level = 'medium';
      this.apply();
    }
  }
}
