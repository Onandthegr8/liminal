import { events, EVT } from '../core/events.js';

// Full-screen UI states: start menu, pause, death (jumpscare), win, plus the
// noclip blackout blink. Styled to the liminal-yellow mood; safe-area aware;
// respects prefers-reduced-motion by softening the death cut.
export class Screens {
  constructor(game) {
    this.game = game;
    this._reduced =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._build();
  }

  // --- construction ----------------------------------------------------------
  _build() {
    const root = document.createElement('div');
    root.id = 'screens';
    root.style.cssText =
      "position:fixed;inset:0;z-index:30;pointer-events:none;color:#e8dfa0;font-family:'Courier New',ui-monospace,monospace;";
    this.game.app.appendChild(root);
    this.root = root;

    this.menu = this._panel();
    this.pause = this._panel();
    this.death = this._panel('#000');
    this.win = this._panel('#050503');
    this.info = this._panel();

    // Blackout layer for noclip shifts.
    const black = document.createElement('div');
    black.style.cssText =
      'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:29;transition:opacity .08s;';
    this.game.app.appendChild(black);
    this.blackout = black;

    // Dedicated mini-scare face overlay — independent of the death panel so a
    // death during a scare can never hide the death screen.
    this._buildScareFace();

    this._buildMenu();
    this._buildPause();
    this._buildDeath();
    this._buildWin();
    this._buildInfo();
  }

  _panel(bg = 'rgba(6,5,2,0.92)') {
    const p = document.createElement('div');
    p.style.cssText =
      `position:absolute;inset:0;background:${bg};display:none;flex-direction:column;` +
      'align-items:center;justify-content:center;gap:18px;pointer-events:auto;text-align:center;' +
      'padding:calc(env(safe-area-inset-top,0px) + 20px) 20px calc(env(safe-area-inset-bottom,0px) + 20px);';
    this.root.appendChild(p);
    return p;
  }

  _btn(label, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      "font-family:inherit;font-size:18px;letter-spacing:2px;color:#e8dfa0;background:rgba(30,26,10,.6);" +
      'border:1px solid rgba(232,223,160,.5);padding:14px 42px;cursor:pointer;border-radius:3px;' +
      'min-width:220px;';
    b.onmouseenter = () => (b.style.background = 'rgba(90,80,30,.7)');
    b.onmouseleave = () => (b.style.background = 'rgba(30,26,10,.6)');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  _title(text, size = 54) {
    const t = document.createElement('div');
    t.textContent = text;
    t.style.cssText = `font-size:${size}px;letter-spacing:12px;text-shadow:0 0 24px rgba(201,184,63,.5);`;
    return t;
  }

  _buildMenu() {
    const m = this.menu;
    m.appendChild(this._title('LIMINAL'));
    const sub = document.createElement('div');
    sub.textContent = 'the walls remember differently';
    sub.style.cssText = 'font-size:14px;font-style:italic;opacity:.7;margin-top:-8px;';
    m.appendChild(sub);

    m.appendChild(
      this._btn('▶ PLAY', () => {
        this.game.audio.unlock();
        this.game.startRun();
      })
    );
    m.appendChild(this._btn('ⓘ HOW TO SURVIVE', () => this._showInfo()));

    // Controls hint adapts to device.
    const hint = document.createElement('div');
    const touch = this.game.input.usingTouch;
    hint.innerHTML = touch
      ? 'left thumb — move &nbsp;·&nbsp; right thumb — look<br>buttons: » sprint · ✋ interact · ◐ flashlight'
      : 'WASD — move · mouse OR numpad (8/2/4/6) — look<br>' +
        'SHIFT — sprint · E — interact · F — flashlight · ESC — pause';
    hint.style.cssText = 'font-size:13px;opacity:.65;line-height:1.9;';
    m.appendChild(hint);

    // Row: mute, quality, fullscreen.
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center;';
    const muteBtn = this._btn('SOUND: ON', () => {
      const next = !this.game.audio.muted;
      this.game.audio.setMuted(next);
      muteBtn.textContent = next ? 'SOUND: OFF' : 'SOUND: ON';
    });
    muteBtn.style.minWidth = '150px';
    muteBtn.style.fontSize = '13px';
    muteBtn.style.padding = '10px 18px';

    const qBtn = this._btn('QUALITY: AUTO', () => {
      const order = [null, 'high', 'medium', 'low'];
      const cur = order.indexOf(this.game.quality.manual);
      const next = order[(cur + 1) % order.length];
      this.game.quality.setManual(next);
      qBtn.textContent = `QUALITY: ${next ? next.toUpperCase() : 'AUTO'}`;
    });
    qBtn.style.minWidth = '150px';
    qBtn.style.fontSize = '13px';
    qBtn.style.padding = '10px 18px';

    const fsBtn = this._btn('FULLSCREEN', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    });
    fsBtn.style.minWidth = '150px';
    fsBtn.style.fontSize = '13px';
    fsBtn.style.padding = '10px 18px';

    row.appendChild(muteBtn);
    row.appendChild(qBtn);
    row.appendChild(fsBtn);
    m.appendChild(row);

    const warn = document.createElement('div');
    warn.textContent = '⚠ loud sounds · flashing lights · it does not stop hunting';
    warn.style.cssText = 'font-size:11px;opacity:.5;margin-top:6px;';
    m.appendChild(warn);
  }

  _buildInfo() {
    const p = this.info;
    p.style.justifyContent = 'flex-start';
    p.style.overflowY = 'auto';
    p.appendChild(this._title('HOW TO SURVIVE', 26));
    const body = document.createElement('div');
    body.style.cssText =
      'font-size:14px;line-height:2;max-width:640px;text-align:left;opacity:.85;padding:0 8px;';
    body.innerHTML = `
<b>THE SITUATION</b><br>
You are in the maze. Something tall lives here too. Each "day" you complete one task
to power the exit, then escape — into a deeper, worse floor of reality.<br><br>
<b>THE TASKS (one per day, it varies)</b><br>
· <b>Fuses</b> — find the glowing fuses, hold interact to pull them.<br>
· <b>The code</b> — find numbered notes (#1, #2, #3…), then type the code on the exit
keypad — number keys, numpad, or the on-screen pad. A wrong code is <i>very</i> loud.<br>
· <b>Breakers</b> — hold interact to flip every breaker box. Every flip is loud. Plan your route.<br><br>
<b>THE THING</b><br>
It patrols and it follows — through the portals, from place to place. It hears sprinting,
breakers and wrong codes, and it sees you in the open. When it screams, run — you are barely
faster. <b>Shine your flashlight in its face</b> to stagger it and buy a few seconds. Break its
line of sight, then <b>hide in a locker</b> — hold interact to steady your breathing (it can
hear ragged breaths up close) and move to slip back out. If it saw you hide it will wait a
while — but it does give up and wander off.<br><br>
<b>THE WORLD LIES</b><br>
Sections you are not watching <b>rearrange themselves</b>. If the lights die for a moment,
the layout just changed. Rare <b>violet portals</b> lead <i>elsewhere</i> — an empty hospital,
a beautiful garden, a graveyard, the sewers, an abandoned office, a church, a terror hotel,
an open field. Your task continues in those places, and stepping back never puts you where
you left.<br><br>
<b>YOUR BODY</b><br>
· <b>Battery</b> — the flashlight is your best tool; green batteries refill it.<br>
· <b>Stamina</b> — sprint burns it, but slowly; empty means limping and wheezing.<br>
· <b>Mind</b> — darkness and the Thing erode it. Low mind = whispers, phantoms, worse.
Stand under working lights, or rest somewhere bright and green, to recover.`;
    p.appendChild(body);
    p.appendChild(this._btn('BACK', () => this._showInfo(false)));
  }

  _showInfo(show = true) {
    this.info.style.display = show ? 'flex' : 'none';
    this.menu.style.display = show ? 'none' : 'flex';
  }

  _buildPause() {
    const p = this.pause;
    p.appendChild(this._title('PAUSED', 36));
    p.appendChild(this._btn('RESUME', () => this.game.togglePause()));
    p.appendChild(
      this._btn('QUIT TO MENU', () => {
        this.game.setState('menu');
      })
    );
  }

  _buildDeath() {
    const d = this.death;

    // The jumpscare face: procedural, drawn with divs (two glowing eyes on black).
    const face = document.createElement('div');
    face.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:11vw;' +
      'background:radial-gradient(ellipse at 50% 42%, #16130a 0%, #000 68%);';
    for (const side of [0, 1]) {
      const eye = document.createElement('div');
      eye.style.cssText =
        'width:9vmin;height:13vmin;border-radius:50%;background:radial-gradient(circle,#fff7d0 0%,#e8c860 45%,rgba(232,200,96,0) 75%);' +
        'box-shadow:0 0 60px 24px rgba(232,200,96,.65);';
      face.appendChild(eye);
      void side;
    }
    const mouth = document.createElement('div');
    mouth.style.cssText =
      'position:absolute;left:50%;top:60%;transform:translateX(-50%);width:26vmin;height:9vmin;' +
      'border-radius:0 0 50% 50%/0 0 100% 100%;background:#000;border:2px solid rgba(120,100,40,.5);' +
      'box-shadow:inset 0 -18px 34px rgba(90,70,20,.5);';
    face.appendChild(mouth);
    d.appendChild(face);
    this._jumpFace = face;

    const card = document.createElement('div');
    card.style.cssText =
      'position:relative;z-index:2;display:none;flex-direction:column;align-items:center;gap:16px;';
    card.appendChild(this._title('IT FOUND YOU', 34));
    const dayLine = document.createElement('div');
    dayLine.style.cssText = 'font-size:16px;opacity:.75;';
    card.appendChild(dayLine);
    card.appendChild(this._btn('RETRY', () => this.game.retry()));
    card.appendChild(this._btn('MENU', () => this.game.setState('menu')));
    d.appendChild(card);
    this._deathCard = card;
    this._deathDayLine = dayLine;
  }

  _buildWin() {
    const w = this.win;
    w.appendChild(this._title('YOU ESCAPED', 34));
    const line = document.createElement('div');
    line.textContent = '…for now.';
    line.style.cssText = 'font-size:18px;font-style:italic;opacity:.8;';
    w.appendChild(line);
    this._winDayLine = document.createElement('div');
    this._winDayLine.style.cssText = 'font-size:14px;opacity:.6;';
    w.appendChild(this._winDayLine);
    w.appendChild(this._btn('DESCEND DEEPER', () => this.game.nextLevel()));
  }

  // --- state handling ----------------------------------------------------------
  onStateChange(next) {
    this.menu.style.display = next === 'menu' ? 'flex' : 'none';
    this.pause.style.display = next === 'paused' ? 'flex' : 'none';
    this.win.style.display = next === 'won' ? 'flex' : 'none';
    if (next !== 'menu') this.info.style.display = 'none';

    if (next === 'won') {
      this._winDayLine.textContent = `Day ${this.game.day} survived. The next maze is worse.`;
    }

    if (next === 'dead') {
      this._showDeath();
    } else {
      this.death.style.display = 'none';
    }

    // Click-to-relock: when playing on desktop, clicking the canvas re-locks.
    if (next === 'playing' && !this._relockBound) {
      this._relockBound = true;
      this.game.canvas.addEventListener('click', () => {
        if (this.game.state === 'playing') this.game.input.requestPointerLock();
      });
    }
  }

  _showDeath() {
    const d = this.death;
    d.style.display = 'flex';
    this._deathDayLine.textContent = `You reached Day ${this.game.day}.`;
    if (this._reduced) {
      // Softened: skip the violent flash, show card immediately with dim face.
      this._jumpFace.style.opacity = '0.35';
      this._deathCard.style.display = 'flex';
      return;
    }
    // BRUTAL: hard cut — face fills screen with a shake, then the card fades in.
    this._jumpFace.style.opacity = '1';
    this._deathCard.style.display = 'none';
    this._jumpFace.animate(
      [
        { transform: 'scale(1.65) translate(0,0)' },
        { transform: 'scale(1.6) translate(-12px,8px)' },
        { transform: 'scale(1.7) translate(10px,-6px)' },
        { transform: 'scale(1.55) translate(-6px,-10px)' },
        { transform: 'scale(1.0) translate(0,0)' },
      ],
      { duration: 700, easing: 'ease-out' }
    );
    setTimeout(() => {
      this._deathCard.style.display = 'flex';
      this._jumpFace.style.opacity = '0.25';
    }, 1400);
  }

  // Its own overlay (z below the screens root), so it can never interfere
  // with the death panel no matter how the timing overlaps.
  _buildScareFace() {
    const f = document.createElement('div');
    f.style.cssText =
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;gap:11vw;' +
      'opacity:0;pointer-events:none;z-index:28;';
    for (let i = 0; i < 2; i++) {
      const eye = document.createElement('div');
      eye.style.cssText =
        'width:9vmin;height:13vmin;border-radius:50%;background:radial-gradient(circle,#fff7d0 0%,#e8c860 45%,rgba(232,200,96,0) 75%);' +
        'box-shadow:0 0 60px 24px rgba(232,200,96,.65);';
      f.appendChild(eye);
    }
    const mouth = document.createElement('div');
    mouth.style.cssText =
      'position:absolute;left:50%;top:60%;transform:translateX(-50%);width:26vmin;height:9vmin;' +
      'border-radius:0 0 50% 50%/0 0 100% 100%;background:#000;border:2px solid rgba(120,100,40,.5);' +
      'box-shadow:inset 0 -18px 34px rgba(90,70,20,.5);';
    f.appendChild(mouth);
    this.game.app.appendChild(f);
    this._scareFace = f;
  }

  // Ambient mini-jumpscare: the face flashes somewhere on screen for a beat.
  miniScare() {
    if (this._reduced) return;
    const f = this._scareFace;
    f.style.opacity = '0.85';
    f.animate(
      [
        { transform: `scale(${2.2 + Math.random()}) translate(${Math.random() * 30 - 15}%, ${Math.random() * 20 - 10}%)` },
        { transform: 'scale(2.6) translate(0,0)' },
      ],
      { duration: 240, easing: 'ease-in' }
    );
    setTimeout(() => {
      f.style.opacity = '0';
    }, 260);
  }

  // Physical shake (locker slam, close calls).
  shake(strength = 1) {
    if (this._reduced) return;
    const c = this.game.canvas;
    const s = 8 * strength;
    c.animate(
      [
        { transform: 'translate(0,0)' },
        { transform: `translate(${s}px,${-s * 0.6}px)` },
        { transform: `translate(${-s * 0.8}px,${s * 0.5}px)` },
        { transform: `translate(${s * 0.5}px,${s * 0.3}px)` },
        { transform: 'translate(0,0)' },
      ],
      { duration: 320, easing: 'ease-out' }
    );
  }

  // Rare shift "noclip" beat: stutter blackout.
  noclipBlink() {
    if (this._reduced) return;
    const b = this.blackout;
    b.style.opacity = '1';
    setTimeout(() => (b.style.opacity = '0'), 120);
    setTimeout(() => (b.style.opacity = '1'), 260);
    setTimeout(() => (b.style.opacity = '0'), 700);
  }
}
