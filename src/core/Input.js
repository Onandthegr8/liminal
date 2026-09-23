import { CONFIG } from './config.js';
import { events, EVT } from './events.js';

// Unified input: keyboard + mouse (pointer lock) on desktop, and a touch overlay
// (auto-spawning movement joystick, drag-to-look, on-screen buttons) on mobile.
// Runtime-detects which scheme to use and can switch if the user changes device.
export class Input {
  constructor(appEl, canvasEl) {
    this.app = appEl;
    this.canvas = canvasEl;

    // Movement intent, forward(+y)/right(+x), magnitude <= 1.
    this.move = { x: 0, y: 0 };

    // Accumulated look delta in radians (already sensitivity-scaled).
    this._look = { yaw: 0, pitch: 0 };

    // Held states.
    this.sprintHeld = false;
    this.interactHeld = false;
    // Numpad look intent (-1/0/1 yaw). Applied per-frame by the Player.
    this.keyLook = { yaw: 0 };

    // One-frame edges (cleared in lateUpdate()).
    this.pressed = { interact: false, flashlight: false, pause: false };

    this.locked = false; // pointer lock engaged
    this.usingTouch = this._detectTouch();
    this.enabled = false; // only true while in the "playing" state

    this._keys = new Set();
    this._moveTouchId = null;
    this._moveOrigin = { x: 0, y: 0 };
    this._lookTouchId = null;
    this._lookLast = { x: 0, y: 0 };

    this._buildTouchOverlay();
    this._bindKeyboardMouse();
    this._bindTouch();
    this.setTouchVisible(false);
  }

  _detectTouch() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const fine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    return hasTouch && (coarse || !fine);
  }

  // --- lifecycle ------------------------------------------------------------
  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this._keys.clear();
      this.move.x = this.move.y = 0;
      this.keyLook.yaw = 0;
      this.sprintHeld = false;
      this.interactHeld = false;
      // Clear one-frame edges too, or a press made while disabled fires later.
      this.pressed.interact = false;
      this.pressed.flashlight = false;
      this.pressed.pause = false;
    }
    this.setTouchVisible(on && this.usingTouch);
  }

  setTouchVisible(v) {
    this.overlay.style.display = v ? 'block' : 'none';
  }

  requestPointerLock() {
    if (this.usingTouch) return;
    if (this.canvas.requestPointerLock) this.canvas.requestPointerLock();
  }

  // Player calls this once per frame to read then reset accumulated look.
  consumeLook() {
    const out = { yaw: this._look.yaw, pitch: this._look.pitch };
    this._look.yaw = 0;
    this._look.pitch = 0;
    return out;
  }

  // Clear per-frame edges. Call at end of the update step.
  lateUpdate() {
    this.pressed.interact = false;
    this.pressed.flashlight = false;
    this.pressed.pause = false;
  }

  // --- keyboard + mouse -----------------------------------------------------
  _bindKeyboardMouse() {
    window.addEventListener('keydown', (e) => {
      // Top-row digits feed the keypad task. (Numpad is reserved for looking.)
      const dm = e.code.match(/^Digit(\d)$/);
      if (dm && this.enabled) events.emit(EVT.DIGIT, { n: Number(dm[1]) });

      if (!this.enabled && e.code !== 'Escape') return;
      if (e.repeat) return;
      this._keys.add(e.code);
      switch (e.code) {
        case 'KeyE':
        case 'NumpadEnter':
          this.interactHeld = true;
          this.pressed.interact = true;
          break;
        case 'KeyF':
        case 'NumpadAdd':
        case 'NumpadDecimal':
          this.pressed.flashlight = true;
          break;
        case 'Escape':
        case 'NumpadSubtract':
          this.pressed.pause = true;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
        case 'Space':
          e.preventDefault(); // Space must not scroll the page
          this.sprintHeld = true;
          break;
      }
      this._recomputeKeyMove();
      this._recomputeKeyLook();
    });

    window.addEventListener('keyup', (e) => {
      this._keys.delete(e.code);
      if (e.code === 'KeyE' || e.code === 'NumpadEnter') this.interactHeld = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'Space')
        this.sprintHeld = false;
      this._recomputeKeyMove();
      this._recomputeKeyLook();
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) this.usingTouch = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      const s = CONFIG.player.lookSensitivity;
      this._look.yaw += -e.movementX * s;
      this._look.pitch += -e.movementY * s;
    });
  }

  _recomputeKeyMove() {
    if (this._moveTouchId !== null) return; // touch joystick owns movement
    let x = 0;
    let y = 0;
    if (this._keys.has('KeyW') || this._keys.has('ArrowUp') || this._keys.has('Numpad8')) y += 1;
    if (this._keys.has('KeyS') || this._keys.has('ArrowDown') || this._keys.has('Numpad2')) y -= 1;
    if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) x += 1;
    if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) x -= 1;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.move.x = x;
    this.move.y = y;
  }

  // Numpad look: 4/6 (and 7/9) turn left/right. 8/2 are movement (fwd/back).
  _recomputeKeyLook() {
    let yaw = 0;
    if (this._keys.has('Numpad4') || this._keys.has('Numpad7')) yaw += 1; // look left
    if (this._keys.has('Numpad6') || this._keys.has('Numpad9')) yaw -= 1; // look right
    this.keyLook.yaw = yaw;
  }

  // --- touch ----------------------------------------------------------------
  _buildTouchOverlay() {
    const o = document.createElement('div');
    o.id = 'touch-overlay';
    o.style.cssText =
      'position:fixed;inset:0;z-index:20;display:none;touch-action:none;pointer-events:none;';
    // Joystick base + knob (hidden until a thumb lands on the left half).
    const base = document.createElement('div');
    base.style.cssText =
      'position:absolute;width:120px;height:120px;border-radius:50%;border:2px solid rgba(220,210,120,.35);' +
      'background:rgba(30,28,10,.25);transform:translate(-50%,-50%);display:none;pointer-events:none;';
    const knob = document.createElement('div');
    knob.style.cssText =
      'position:absolute;width:54px;height:54px;border-radius:50%;background:rgba(220,210,120,.5);' +
      'transform:translate(-50%,-50%);display:none;pointer-events:none;';
    o.appendChild(base);
    o.appendChild(knob);
    this._joyBase = base;
    this._joyKnob = knob;

    // Buttons container (bottom-right, inside safe area).
    const btnWrap = document.createElement('div');
    btnWrap.style.cssText =
      'position:absolute;right:calc(env(safe-area-inset-right,0px) + 16px);' +
      'bottom:calc(env(safe-area-inset-bottom,0px) + 22px);display:flex;flex-direction:column;gap:14px;' +
      'align-items:flex-end;pointer-events:none;';
    this._btnFlash = this._makeButton('◐', 'flashlight');
    this._btnInteract = this._makeButton('✋', 'interact');
    this._btnSprint = this._makeButton('»', 'sprint');
    btnWrap.appendChild(this._btnFlash);
    btnWrap.appendChild(this._btnInteract);
    btnWrap.appendChild(this._btnSprint);
    o.appendChild(btnWrap);

    this.overlay = o;
    this.app.appendChild(o);
  }

  _makeButton(label, kind) {
    const b = document.createElement('div');
    b.textContent = label;
    b.dataset.kind = kind;
    b.style.cssText =
      'width:70px;height:70px;border-radius:50%;pointer-events:auto;display:flex;align-items:center;' +
      'justify-content:center;font-size:26px;color:#e8dfa0;border:2px solid rgba(220,210,120,.4);' +
      'background:rgba(20,18,8,.45);user-select:none;touch-action:none;';
    const setActive = (on) => {
      b.style.background = on ? 'rgba(120,110,40,.6)' : 'rgba(20,18,8,.45)';
    };
    b.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        setActive(true);
        if (kind === 'sprint') this.sprintHeld = true;
        else if (kind === 'interact') {
          this.interactHeld = true;
          this.pressed.interact = true;
        } else if (kind === 'flashlight') this.pressed.flashlight = true;
      },
      { passive: false }
    );
    const release = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setActive(false);
      if (kind === 'sprint') this.sprintHeld = false;
      else if (kind === 'interact') this.interactHeld = false;
    };
    b.addEventListener('touchend', release, { passive: false });
    b.addEventListener('touchcancel', release, { passive: false });
    return b;
  }

  _bindTouch() {
    const half = () => window.innerWidth * 0.5;

    const onStart = (e) => {
      if (!this.enabled) return;
      this.usingTouch = true;
      this.setTouchVisible(true);
      for (const t of e.changedTouches) {
        const leftSide = t.clientX < half();
        if (leftSide && this._moveTouchId === null) {
          this._moveTouchId = t.identifier;
          this._moveOrigin.x = t.clientX;
          this._moveOrigin.y = t.clientY;
          this._joyBase.style.display = 'block';
          this._joyKnob.style.display = 'block';
          this._joyBase.style.left = `${t.clientX}px`;
          this._joyBase.style.top = `${t.clientY}px`;
          this._joyKnob.style.left = `${t.clientX}px`;
          this._joyKnob.style.top = `${t.clientY}px`;
        } else if (!leftSide && this._lookTouchId === null) {
          this._lookTouchId = t.identifier;
          this._lookLast.x = t.clientX;
          this._lookLast.y = t.clientY;
        }
      }
    };

    const onMove = (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.identifier === this._moveTouchId) {
          const dx = t.clientX - this._moveOrigin.x;
          const dy = t.clientY - this._moveOrigin.y;
          const maxR = 55;
          const len = Math.hypot(dx, dy) || 1;
          const cl = Math.min(len, maxR);
          const nx = (dx / len) * (cl / maxR);
          const ny = (dy / len) * (cl / maxR);
          this.move.x = nx;
          this.move.y = -ny; // screen-down is backward
          this._joyKnob.style.left = `${this._moveOrigin.x + (dx / len) * cl}px`;
          this._joyKnob.style.top = `${this._moveOrigin.y + (dy / len) * cl}px`;
        } else if (t.identifier === this._lookTouchId) {
          const dx = t.clientX - this._lookLast.x;
          const dy = t.clientY - this._lookLast.y;
          this._lookLast.x = t.clientX;
          this._lookLast.y = t.clientY;
          const s = CONFIG.player.touchLookSensitivity;
          this._look.yaw += -dx * s;
          this._look.pitch += -dy * s;
        }
      }
    };

    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._moveTouchId) {
          this._moveTouchId = null;
          this.move.x = 0;
          this.move.y = 0;
          this._joyBase.style.display = 'none';
          this._joyKnob.style.display = 'none';
        } else if (t.identifier === this._lookTouchId) {
          this._lookTouchId = null;
        }
      }
    };

    this.app.addEventListener('touchstart', onStart, { passive: false });
    this.app.addEventListener(
      'touchmove',
      (e) => {
        // Only hijack scrolling while actually playing — menus (e.g. the long
        // info screen) must stay scrollable on phones.
        if (!this.enabled) return;
        e.preventDefault();
        onMove(e);
      },
      { passive: false }
    );
    this.app.addEventListener('touchend', onEnd, { passive: false });
    this.app.addEventListener('touchcancel', onEnd, { passive: false });
  }
}
