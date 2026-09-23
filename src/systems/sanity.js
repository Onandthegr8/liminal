import { CONFIG } from '../core/config.js';
import { events, EVT } from '../core/events.js';

// Sanity drains in darkness and near/at the sight of the Stalker; recovers slowly
// under the fluorescents. Low sanity warps the screen (vignette + desaturation),
// triggers whispers and fake "phantom" Stalker glimpses. Atmosphere, not death.
export class Sanity {
  constructor(game) {
    this.game = game;
    this.cfg = CONFIG.sanity;
    this.value = this.cfg.max;
    this._reduced =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._buildOverlays();
    this._phantomTimer = 0;
    this._lastFilter = -1;
  }

  _buildOverlays() {
    const app = this.game.app;
    const vig = document.createElement('div');
    vig.style.cssText =
      'position:fixed;inset:0;z-index:12;pointer-events:none;opacity:0;transition:opacity .5s;' +
      'background:radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, rgba(0,0,0,0.85) 100%);';
    app.appendChild(vig);
    this.vignette = vig;

    const ph = document.createElement('div');
    ph.style.cssText =
      'position:fixed;z-index:13;pointer-events:none;opacity:0;width:130px;height:320px;' +
      'background:radial-gradient(ellipse at 50% 30%, rgba(5,5,8,.95), rgba(5,5,8,0) 70%);' +
      'filter:blur(3px);transition:opacity .12s;';
    app.appendChild(ph);
    this.phantom = ph;
  }

  reset() {
    this.value = this.cfg.max;
    this.vignette.style.opacity = '0';
    this.phantom.style.opacity = '0';
    this.game.renderer.domElement.style.filter = '';
  }

  _nearLight() {
    const theme = this.game.theme;
    if (theme && theme.lit) return true; // bright places (garden, field) count
    // NOTE: the flashlight does NOT count as "light" for recovery — with its
    // long battery that would make sanity unloseable. It only slows the drain.
    const panels = this.game.level?.panels;
    if (!panels || !panels.length) return false;
    const p = this.game.player.position;
    const zone = this.game.player.zone;
    const thr = CONFIG.cellSize * 2.2;
    for (const pan of panels) {
      if (pan.zone !== zone) continue;
      const d = Math.hypot(pan.pos.x - p.x, pan.pos.z - p.z);
      if (d < thr) return true;
    }
    return false;
  }

  update(dt) {
    const st = this.game.stalker;
    const lit = this._nearLight();
    const stalkerVisible = st?.isVisibleToPlayer;
    const stalkerNear = st && st.distanceToPlayer < 9 && st.zone === this.game.player.zone;

    let delta = 0;
    if (!lit) delta -= this.cfg.darkDrain * (this.game.flashlight.on ? 0.35 : 1);
    if (stalkerVisible) delta -= this.cfg.stalkerNearDrain + this.cfg.stalkerVisibleBonus;
    else if (stalkerNear) delta -= this.cfg.stalkerNearDrain;
    if (lit && !stalkerNear && !stalkerVisible) delta += this.cfg.lightRecover;

    // Each place bends the mind its own way (garden soothes, hotel gnaws).
    delta += this.game.theme?.sanityMod || 0;

    this.value = Math.max(0, Math.min(this.cfg.max, this.value + delta * dt));

    this._applyEffects(dt);
  }

  _applyEffects(dt) {
    const v = this.value;
    const max = this.cfg.max;
    const low = this.cfg.lowThreshold;

    // Vignette: subtle baseline, ramps hard below the low threshold.
    let vig = 0.12;
    if (v < low) vig = 0.12 + (1 - v / low) * 0.72;
    this.vignette.style.opacity = vig.toFixed(3);

    // Desaturation + contrast on the canvas.
    const sat = 0.35 + (v / max) * 0.65;
    const con = 1 + (1 - v / max) * 0.25;
    const filterKey = Math.round(sat * 100);
    if (filterKey !== this._lastFilter) {
      this.game.renderer.domElement.style.filter = `saturate(${sat.toFixed(2)}) contrast(${con.toFixed(2)})`;
      this._lastFilter = filterKey;
    }

    // Phantom glimpses + whispers when low.
    this._phantomTimer -= dt;
    if (v < low && this._phantomTimer <= 0) {
      const chance = v < this.cfg.criticalThreshold ? this.cfg.phantomChanceCritical : this.cfg.phantomChanceLow;
      const scale = this._reduced ? 0.4 : 1;
      if (Math.random() < chance * scale) this.flashPhantom();
    }
  }

  // Public: also invoked by the scare director in Game.
  flashPhantom() {
    this._phantomTimer = 1.2; // debounce
    const edge = Math.random() < 0.5 ? 'left' : 'right';
    const y = 30 + Math.random() * 30;
    this.phantom.style.top = `${y}%`;
    this.phantom.style[edge] = `${2 + Math.random() * 8}%`;
    this.phantom.style[edge === 'left' ? 'right' : 'left'] = 'auto';
    this.phantom.style.opacity = this._reduced ? '0.5' : '0.9';
    this.game.audio.whisper();
    setTimeout(() => {
      this.phantom.style.opacity = '0';
    }, this._reduced ? 120 : 180);
  }
}
