import { events, EVT } from '../core/events.js';
import { CONFIG } from '../core/config.js';

// Minimal diegetic-ish HUD: crosshair, three meters, fuse counter, day counter,
// contextual interact prompt and a subtitle line. Safe-area aware for phones.
export class HUD {
  constructor(game) {
    this.game = game;
    this._subTimer = null;
    this._build();
    this._bind();
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'hud';
    root.style.cssText =
      'position:fixed;inset:0;z-index:15;pointer-events:none;display:none;color:#e8dfa0;' +
      "font-family:'Courier New',ui-monospace,monospace;";
    this.game.app.appendChild(root);
    this.root = root;

    // Crosshair.
    const ch = document.createElement('div');
    ch.style.cssText =
      'position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;' +
      'border-radius:50%;background:rgba(232,223,160,.55);box-shadow:0 0 6px rgba(0,0,0,.8);';
    root.appendChild(ch);

    // Meters (top-left, inside safe area).
    const meters = document.createElement('div');
    meters.style.cssText =
      'position:absolute;left:calc(env(safe-area-inset-left,0px) + 14px);' +
      'top:calc(env(safe-area-inset-top,0px) + 14px);display:flex;flex-direction:column;gap:7px;width:150px;';
    root.appendChild(meters);
    this.batteryBar = this._makeMeter(meters, 'BATT', '#e8c860');
    this.staminaBar = this._makeMeter(meters, 'STAM', '#8fce6a');
    this.sanityBar = this._makeMeter(meters, 'MIND', '#b98fd6');

    // Fuses + day (top-right).
    const status = document.createElement('div');
    status.style.cssText =
      'position:absolute;right:calc(env(safe-area-inset-right,0px) + 14px);' +
      'top:calc(env(safe-area-inset-top,0px) + 14px);text-align:right;font-size:15px;' +
      'text-shadow:0 0 6px #000;line-height:1.6;';
    root.appendChild(status);
    this.statusEl = status;

    // Interact prompt (center-low).
    const prompt = document.createElement('div');
    prompt.style.cssText =
      'position:absolute;left:50%;top:62%;transform:translateX(-50%);font-size:16px;' +
      'background:rgba(10,9,4,.65);padding:8px 16px;border:1px solid rgba(232,223,160,.35);' +
      'border-radius:4px;display:none;text-shadow:0 0 4px #000;white-space:nowrap;';
    root.appendChild(prompt);
    this.promptEl = prompt;

    // Hold progress bar under the prompt.
    const holdWrap = document.createElement('div');
    holdWrap.style.cssText =
      'position:absolute;left:50%;top:68%;transform:translateX(-50%);width:140px;height:5px;' +
      'background:rgba(232,223,160,.15);display:none;border-radius:3px;overflow:hidden;';
    const holdFill = document.createElement('div');
    holdFill.style.cssText = 'height:100%;width:0%;background:#e8c860;';
    holdWrap.appendChild(holdFill);
    root.appendChild(holdWrap);
    this.holdWrap = holdWrap;
    this.holdFill = holdFill;

    // Keypad (for the code task): display + digit grid, clickable for mobile.
    const kp = document.createElement('div');
    kp.style.cssText =
      'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:none;' +
      'flex-direction:column;align-items:center;gap:10px;background:rgba(8,7,3,.88);' +
      'border:1px solid rgba(232,223,160,.4);border-radius:6px;padding:16px 20px;pointer-events:auto;';
    const kpDisplay = document.createElement('div');
    kpDisplay.style.cssText =
      'font-size:30px;letter-spacing:12px;min-height:38px;color:#ffd76a;text-shadow:0 0 8px rgba(255,200,80,.5);';
    kp.appendChild(kpDisplay);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,64px);gap:8px;';
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
      const b = document.createElement('button');
      b.textContent = n;
      b.style.cssText =
        "font-family:inherit;font-size:22px;color:#e8dfa0;background:rgba(30,26,10,.7);" +
        'border:1px solid rgba(232,223,160,.35);border-radius:4px;padding:12px 0;cursor:pointer;';
      if (n === 0) b.style.gridColumn = '2';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        events.emit(EVT.DIGIT, { n });
        this.game.audio.keypadBeep();
      });
      grid.appendChild(b);
    }
    kp.appendChild(grid);
    const kpHint = document.createElement('div');
    kpHint.textContent = 'type the code · walk away to close';
    kpHint.style.cssText = 'font-size:11px;opacity:.55;';
    kp.appendChild(kpHint);
    root.appendChild(kp);
    this.keypadEl = kp;
    this.keypadDisplay = kpDisplay;

    // Subtitles (bottom-center, above touch buttons).
    const sub = document.createElement('div');
    sub.style.cssText =
      'position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 96px);' +
      'transform:translateX(-50%);font-size:16px;font-style:italic;max-width:82vw;text-align:center;' +
      'text-shadow:0 0 6px #000,0 0 12px #000;opacity:0;transition:opacity .35s;';
    root.appendChild(sub);
    this.subEl = sub;
  }

  _makeMeter(parent, label, color) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:7px;';
    const lab = document.createElement('span');
    lab.textContent = label;
    lab.style.cssText = 'font-size:10px;letter-spacing:1px;width:36px;text-shadow:0 0 4px #000;';
    const track = document.createElement('div');
    track.style.cssText =
      'flex:1;height:7px;background:rgba(10,9,4,.6);border:1px solid rgba(232,223,160,.25);border-radius:3px;overflow:hidden;';
    const fill = document.createElement('div');
    fill.style.cssText = `height:100%;width:100%;background:${color};transition:width .15s;`;
    track.appendChild(fill);
    row.appendChild(lab);
    row.appendChild(track);
    parent.appendChild(row);
    return fill;
  }

  _bind() {
    events.on(EVT.SUBTITLE, ({ text, ms }) => this.subtitle(text, ms));
    events.on(EVT.TASK_PROGRESS, () => this._renderStatus());
    events.on(EVT.LEVEL_START, () => this._renderStatus());
    events.on(EVT.ZONE_CHANGE, () => this._renderStatus());
    events.on(EVT.KEYPAD_OPEN, ({ open, entry, length }) => {
      this.keypadEl.style.display = open ? 'flex' : 'none';
      if (open) {
        let s = entry;
        while (s.length < length) s += '·';
        this.keypadDisplay.textContent = s;
      }
    });
  }

  setVisible(v) {
    this.root.style.display = v ? 'block' : 'none';
  }

  subtitle(text, ms = 2500) {
    this.subEl.textContent = text;
    this.subEl.style.opacity = '1';
    if (this._subTimer) clearTimeout(this._subTimer);
    this._subTimer = setTimeout(() => {
      this.subEl.style.opacity = '0';
    }, ms);
  }

  _renderStatus() {
    const o = this.game.objectives;
    const place = this.game.theme?.name || 'The Backrooms';
    this.statusEl.innerHTML = `DAY ${this.game.day}<br>${place}<br>${o.statusText()}`;
  }

  // Called by Game._handleInteraction with the current target (or null).
  setPromptForTarget(target) {
    if (!target) {
      this.promptEl.style.display = 'none';
      this.holdWrap.style.display = 'none';
      return;
    }
    const touch = this.game.input.usingTouch;
    const key = touch ? 'Tap ✋' : 'E';
    let text = null;
    let hold = 0;
    switch (target.kind) {
      case 'fuse':
        text = touch ? 'Hold ✋ to grab fuse' : 'Hold E to grab fuse';
        hold = target.obj.progress || 0;
        break;
      case 'note':
        text = `${key} — read the number`;
        break;
      case 'switch':
        text = touch ? 'Hold ✋ to flip breaker' : 'Hold E to flip breaker';
        hold = target.obj.progress || 0;
        break;
      case 'battery':
        text = `${key} — take battery`;
        break;
      case 'locker':
        text = `${key} — hide`;
        break;
      case 'hide-exit':
        text = touch ? 'hold ✋ — steady breath · move to leave' : 'hold E — steady breath · move to leave';
        break;
      case 'portal':
        text = `${key} — step through`;
        break;
      case 'exit': {
        const o = this.game.objectives;
        text = this.game.level.exitDoor?.powered
          ? `${key} — ESCAPE`
          : o.task === 'keypad'
            ? `${key} — use keypad`
            : `The exit is dead. ${o.statusText()}`;
        break;
      }
    }
    if (text) {
      this.promptEl.textContent = text;
      this.promptEl.style.display = 'block';
    } else {
      this.promptEl.style.display = 'none';
    }
    if (hold > 0) {
      this.holdWrap.style.display = 'block';
      this.holdFill.style.width = `${Math.min(100, hold * 100)}%`;
    } else {
      this.holdWrap.style.display = 'none';
    }
  }

  update() {
    const g = this.game;
    this.batteryBar.style.width = `${(g.flashlight.battery / CONFIG.flashlight.batteryMax) * 100}%`;
    this.staminaBar.style.width = `${(g.stamina.value / CONFIG.stamina.max) * 100}%`;
    this.sanityBar.style.width = `${(g.sanity.value / CONFIG.sanity.max) * 100}%`;
  }
}
