import * as THREE from 'three';
import { CONFIG, levelParams } from './config.js';
import { events, EVT } from './events.js';
import { Input } from './Input.js';
import { Maze } from '../world/Maze.js';
import { Level } from '../world/Level.js';
import { getTheme, HUB_THEME, pickPlaces } from '../world/themes.js';
import { Player } from '../player/Player.js';
import { Stalker } from '../entities/Stalker.js';
import { Flashlight } from '../systems/flashlight.js';
import { Stamina } from '../systems/stamina.js';
import { Sanity } from '../systems/sanity.js';
import { Objectives } from '../systems/objectives.js';
import { AudioSystem } from '../systems/audio.js';
import { Quality } from '../systems/quality.js';
import { HUD } from '../ui/HUD.js';
import { Screens } from '../ui/Screens.js';

const FIXED = 1 / 60;

export class Game {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this.state = 'boot';
    this.day = 1;
    this.params = levelParams(1);
    this.acc = 0;
    this._last = performance.now();
    this._tmpForward = new THREE.Vector3();

    this._initRenderer();
    this._initScene();

    this.input = new Input(app, canvas);
    this.quality = new Quality(this);
    this.audio = new AudioSystem(this);
    this.hud = new HUD(this);
    this.screens = new Screens(this);

    // Systems that exist for the whole run (rebuilt content lives in level objects).
    this.flashlight = new Flashlight(this);
    this.stamina = new Stamina(this);
    this.sanity = new Sanity(this);
    this.objectives = new Objectives(this);
    this.theme = getTheme(HUB_THEME); // current place's theme
    this.stalkers = [];
    this._scareT = this._rollScareTimer();

    this._bindEvents();
    this._bindResize();

    this.setState('menu');
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  // --- setup ---------------------------------------------------------------
  _initRenderer() {
    // Input doesn't exist yet, so detect touch directly for the AA decision.
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: !coarse,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.pixelRatioCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false; // enabled selectively by quality
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.userData.game = this; // let Level read quality settings
    this.scene.background = new THREE.Color(CONFIG.fogColor).multiplyScalar(0.12);
    this.scene.fog = new THREE.FogExp2(CONFIG.fogColor, CONFIG.fogDensityBase);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.05,
      120
    );
    this.camera.position.set(0, CONFIG.player.eyeHeight, 0);
  }

  _bindResize() {
    const onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (!w || !h) {
        // Rotation/viewport changes can transiently report 0 — retry shortly.
        setTimeout(onResize, 200);
        return;
      }
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.pixelRatioCap));
      this.renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 120));
  }

  _bindEvents() {
    events.on(EVT.PLAYER_CAUGHT, () => {
      if (this.state === 'playing') this.setState('dead');
    });
    events.on(EVT.PLAYER_ESCAPED, () => {
      if (this.state === 'playing') this.setState('won');
    });
    // The Stalker slams the locker if it tracked you into it.
    events.on(EVT.HIDE_ENTER, () => {
      const st = this.stalker;
      if (!st) return;
      const wasHunting = st.state === 'CHASE' || st.state === 'SEARCH';
      const close = st.distanceToPlayer < 14 && st.zone === this.player.zone;
      if (wasHunting && close && Math.random() < CONFIG.scares.lockerSlamChance) {
        setTimeout(() => {
          if (this.state !== 'playing' || !this.player.isHiding) return;
          this.audio.lockerBang();
          this.screens.shake(1.4);
          events.emit(EVT.SUBTITLE, { text: 'It knows you are in here.', ms: 2600 });
        }, 1800 + Math.random() * 2200);
      }
    });
  }

  // The "primary" creature for audio/heartbeat/sanity: the one actively
  // hunting, else the nearest on the player's zone.
  get stalker() {
    const list = this.stalkers;
    if (!list || !list.length) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const s of list) {
      let score = -(s.distanceToPlayer === Infinity ? 9999 : s.distanceToPlayer);
      if (s.zone === this.player.zone) score += 100;
      if (s.state === 'CHASE') score += 1000;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  _rollScareTimer() {
    const s = CONFIG.scares;
    return s.minInterval + Math.random() * (s.maxInterval - s.minInterval);
  }

  // Random ambient scares, independent of the Stalker. Rarer than before, and
  // the intrusive face-flash is only a minority of them (per player feedback).
  _updateScares(dt) {
    if (this.player.isHiding) return;
    this._scareT -= dt;
    if (this._scareT > 0) return;
    this._scareT = this._rollScareTimer();
    const roll = Math.random();
    if (roll < CONFIG.scares.faceChance) {
      this.screens.miniScare();
      events.emit(EVT.SCARE, { kind: 'face' });
    } else if (roll < 0.7) {
      this.screens.noclipBlink();
      this.audio.noclip();
      events.emit(EVT.SCARE, { kind: 'lights' });
    } else {
      this.sanity.flashPhantom();
      events.emit(EVT.SCARE, { kind: 'phantom' });
    }
  }

  // Swap the global fog/sky/ambience to a zone's theme.
  applyTheme(zoneIndex) {
    const key = this.world.zones[zoneIndex].theme;
    const theme = getTheme(key);
    this.theme = theme;
    this.scene.fog.color.setHex(theme.fog);
    this.scene.fog.density = this.params.fogDensity * theme.fogMul;
    this.scene.background = new THREE.Color(theme.background);
    this.audio.setEnvironment(key);
  }

  // --- state machine -------------------------------------------------------
  setState(next) {
    const prev = this.state;
    this.state = next;
    this.input.setEnabled(next === 'playing');

    if (next !== 'playing' && document.pointerLockElement) {
      document.exitPointerLock();
    }

    this.hud.setVisible(next === 'playing');
    this.screens.onStateChange(next, prev);
    events.emit(EVT.STATE_CHANGE, { state: next, prev });

    if (next === 'dead') this.audio.jumpscare();
    if (next === 'won') this.audio.chime('door');
  }

  // Fresh run from day 1 (called by Start / full restart).
  startRun() {
    this.day = 1;
    this.startLevel(1);
  }

  // Build (or rebuild) a level for the given day.
  startLevel(day) {
    this.day = day;
    this.params = levelParams(day);
    // Bumped every rebuild so delayed callbacks (portal fake-outs) from a
    // previous world can detect they're stale and bail.
    this.levelGen = (this.levelGen || 0) + 1;

    // Dispose previous world.
    if (this.level) this.level.dispose(this.scene);
    for (const s of this.stalkers) s.dispose(this.scene);
    this.stalkers = [];
    this.objectives.dispose(this.scene);

    // World: a backrooms hub + a few RARE themed places, spread far apart in X
    // and joined by portals (no floors/stairs anymore).
    const hub = new Maze(this.params.gridSize);
    const zones = [{ maze: hub, theme: HUB_THEME }];
    const placeKeys = pickPlaces(this.params.portals);
    for (let i = 0; i < placeKeys.length; i++) {
      const theme = getTheme(placeKeys[i]);
      const maze = new Maze(CONFIG.zones.themedGrid, {
        originX: (i + 1) * CONFIG.zoneSpacingX,
        openness: theme.openness,
      });
      zones.push({ maze, theme: placeKeys[i] });
    }

    // One portal per themed zone, linking a hub cell to a themed cell.
    const portals = [];
    for (let zi = 1; zi < zones.length; zi++) {
      const hubCell = hub.randomReachableCell();
      hub.carveOpen(hubCell.cx, hubCell.cz);
      const otherMaze = zones[zi].maze;
      const otherCell = otherMaze.randomReachableCell();
      otherMaze.carveOpen(otherCell.cx, otherCell.cz);
      portals.push({
        a: { zone: 0, cx: hubCell.cx, cz: hubCell.cz },
        b: { zone: zi, cx: otherCell.cx, cz: otherCell.cz },
      });
    }

    this.world = { zones, portals };
    this.level = new Level(this.scene, this.world, this.params);

    // Player spawns in the hub.
    const spawn = hub.randomReachableCell();
    if (!this.player) this.player = new Player(this.camera, this);
    this.player.reset(spawn, 0);
    this.applyTheme(0);

    // Several creatures, each a different disturbing form, spread across zones.
    for (let i = 0; i < this.params.creatures; i++) {
      const sZone = (Math.random() * zones.length) | 0;
      const sCell =
        sZone === 0
          ? hub.randomReachableCellFar(spawn, CONFIG.stalker.spawnMinCellsFromPlayer)
          : zones[sZone].maze.randomReachableCell();
      const s = new Stalker(this.scene, this, i);
      s.reset(sCell, sZone);
      s.setParams(this.params);
      this.stalkers.push(s);
    }

    // Systems reset / content spawn.
    this.flashlight.reset();
    this.stamina.reset();
    this.sanity.reset();
    this.objectives.build(); // scatter fuses + batteries, place exit

    this._shiftTimer = this.params.shiftInterval;
    this._scareT = this._rollScareTimer();

    this.setState('playing');
    this.input.requestPointerLock();
    events.emit(EVT.LEVEL_START, { day });
    events.emit(EVT.SUBTITLE, { text: `Day ${day}. ${this.objectives.taskBriefing()}`, ms: 4200 });
  }

  nextLevel() {
    this.startLevel(this.day + 1);
  }

  retry() {
    this.startLevel(this.day);
  }

  togglePause() {
    if (this.state === 'playing') this.setState('paused');
    else if (this.state === 'paused') {
      this.setState('playing');
      this.input.requestPointerLock();
    }
  }

  // --- loop ----------------------------------------------------------------
  _loop() {
    requestAnimationFrame(this._loop);
    const now = performance.now();
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.1) dt = 0.1; // clamp to avoid tunneling after tab-out

    this.quality.frameTick(dt);

    // Pause works from BOTH playing and paused states — handled here because
    // step() only runs while playing, which used to strand Esc-while-paused.
    if (this.input.pressed.pause) {
      this.input.pressed.pause = false;
      if (this.state === 'playing' || this.state === 'paused') this.togglePause();
    }

    if (this.state === 'playing') {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= FIXED && steps < 5) {
        this.step(FIXED);
        this.acc -= FIXED;
        steps++;
      }
      const alpha = this.acc / FIXED;
      this.player.applyToCamera(this.camera, alpha);
    }

    if (this.level) this.level.update(dt, this.camera);
    this.renderer.render(this.scene, this.camera);
  }

  // One fixed logic step.
  step(dt) {
    const input = this.input;

    this.player.update(dt, input);
    for (const s of this.stalkers) s.update(dt, this.player);

    this.flashlight.update(dt);
    this.stamina.update(dt);
    this.sanity.update(dt);
    this.objectives.update(dt);
    this._updateShift(dt);
    this._updateScares(dt);
    this.audio.update(dt);

    this._handleInteraction();

    if (input.pressed.flashlight) this.flashlight.toggle();

    this.hud.update(dt);
    input.lateUpdate();
  }

  _handleInteraction() {
    // Ask the world what (if anything) is interactable in front of the player.
    const target = this.player.isHiding
      ? { kind: 'hide-exit' }
      : this._findInteractable();

    this.hud.setPromptForTarget(target);

    // Walking away from the exit closes an open keypad.
    if (this.objectives.keypadOpen && (!target || target.kind !== 'exit')) {
      this.objectives.setKeypadOpen(false);
    }

    const input = this.input;
    if (!target) return;

    switch (target.kind) {
      case 'hide-exit':
        // Interact steadies breathing (handled by Player); moving slips out.
        return;
      case 'locker':
        if (input.pressed.interact) this.player.enterHiding(target.obj);
        return;
      case 'fuse':
        if (input.interactHeld) {
          target.obj.progress = (target.obj.progress || 0) + this._grabDt;
          if (target.obj.progress >= 1) this.objectives.collectFuse(target.obj);
        } else {
          target.obj.progress = 0;
        }
        return;
      case 'switch':
        if (input.interactHeld) {
          target.obj.progress =
            (target.obj.progress || 0) + this._grabDt / CONFIG.objectives.switchHoldTime;
          if (target.obj.progress >= 1) this.objectives.flipSwitch(target.obj);
        } else {
          target.obj.progress = 0;
        }
        return;
      case 'note':
        if (input.pressed.interact) this.objectives.collectNote(target.obj);
        return;
      case 'battery':
        if (input.pressed.interact) this.objectives.collectBattery(target.obj);
        return;
      case 'portal':
        if (input.pressed.interact) this._usePortal(target.obj);
        return;
      case 'exit':
        if (input.pressed.interact) this.objectives.interactExit();
        return;
    }
  }

  _usePortal(portal) {
    const fromA = portal.a.zone === this.player.zone;
    const other = fromA ? portal.b : portal.a;
    const gen = this.levelGen;
    const doTeleport = () => {
      // Bail if the world was rebuilt (death/retry) while the fake-out played.
      if (this.state !== 'playing' || gen !== this.levelGen) return;
      const maze = this.world.zones[other.zone].maze;
      const wc = maze.cellToWorld(other.cx, other.cz);
      this.player.setZone(other.zone);
      this.player.position.x = wc.x;
      this.player.position.z = wc.z;
      this.player.prevPosition.copy(this.player.position);
      this.player.vel.x = this.player.vel.z = 0;
      this.applyTheme(other.zone);
      this.screens.noclipBlink();
      events.emit(EVT.ZONE_CHANGE, { zone: other.zone });
      const name = getTheme(this.world.zones[other.zone].theme).name;
      events.emit(EVT.SUBTITLE, { text: `You step into ${name}.`, ms: 3200 });
    };
    // Sometimes something is on the other side of the door first.
    if (Math.random() < CONFIG.scares.doorFakeoutChance) {
      this.screens.miniScare();
      events.emit(EVT.SCARE, { kind: 'door' });
      setTimeout(doTeleport, 420);
    } else {
      doTeleport();
    }
  }

  _findInteractable() {
    const p = this.player.position;
    const zone = this.player.zone;
    const fwd = this.player.getForward(this._tmpForward);
    const range = CONFIG.player.interactRange;
    let best = null;
    let bestScore = -Infinity;

    const consider = (obj, kind, worldPos, r = range, extra = null) => {
      const dx = worldPos.x - p.x;
      const dz = worldPos.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > r) return;
      const nx = dx / (dist || 1);
      const nz = dz / (dist || 1);
      const facing = nx * fwd.x + nz * fwd.z;
      if (facing < 0.2 && dist > 1.1) return;
      const score = facing - dist * 0.15;
      if (score > bestScore) {
        bestScore = score;
        best = { kind, obj, dist, ...(extra || {}) };
      }
    };

    this._grabDt = 1 / 60 / 1.0;

    const o = this.objectives;
    for (const f of o.fuses) if (!f.collected && f.zone === zone) consider(f, 'fuse', f.mesh.position);
    for (const n of o.notes) if (!n.found && n.zone === zone) consider(n, 'note', n.mesh.position);
    for (const s of o.switches) if (!s.flipped && s.zone === zone) consider(s, 'switch', s.mesh.position);
    for (const b of o.batteries) if (!b.taken && b.zone === zone) consider(b, 'battery', b.mesh.position);
    for (const l of this.level.lockers) if (l.zone === zone) consider(l, 'locker', l.position, range + 0.4);
    for (const portal of this.level.portals) {
      if (portal.a.zone === zone) consider(portal, 'portal', portal.a.position, range + 0.8);
      if (portal.b.zone === zone) consider(portal, 'portal', portal.b.position, range + 0.8);
    }
    if (this.level.exitDoor && this.level.exitDoor.zone === zone)
      consider(this.level.exitDoor, 'exit', this.level.exitDoor.position, range + 0.6);

    return best;
  }

  // --- shift mechanic ------------------------------------------------------
  _updateShift(dt) {
    this._shiftTimer -= dt;
    if (this._shiftTimer > 0) return;
    this._shiftTimer = this.params.shiftInterval + (Math.random() * 2 - 1) * CONFIG.shift.intervalJitter;
    this.doShift();
  }

  doShift() {
    for (let zi = 0; zi < this.world.zones.length; zi++) {
      const maze = this.world.zones[zi].maze;
      const protectedCells = this.objectives.getProtectedCells(zi);
      const onThisZone = this.player.zone === zi;
      const playerCell = onThisZone ? this.player.cell() : null;
      const changed = maze.shift(playerCell, protectedCells, onThisZone ? this.camera : null);
      // Rebuild only the zones whose grids actually changed.
      if (changed && changed.length) this.level.rebuildZoneWalls(zi);
    }
    const noclip = Math.random() < CONFIG.shift.noclipChance;
    events.emit(EVT.SHIFT, { blackout: noclip });
    if (noclip) {
      this.screens.noclipBlink();
      this.audio.noclip();
      events.emit(EVT.SUBTITLE, { text: 'The walls remember differently now.', ms: 2600 });
    }
  }
}
