import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { events, EVT } from '../core/events.js';

// Rotating task types so no two days feel the same:
//   FUSES    — collect N fuses, exit powers when all are in.
//   KEYPAD   — find N glowing digit-notes, then punch the code into the exit
//              keypad (number row / on-screen pad). Wrong code = LOUD.
//   SWITCHES — hold-flip every breaker box; each flip is a noise the Stalker hears.
// Also owns spare-battery pickups. Task items spread across ALL zones (hub +
// themed places), so escaping means venturing through the portals.

const TASK_TYPES = ['fuses', 'keypad', 'switches'];
let lastTask = null;

export class Objectives {
  constructor(game) {
    this.game = game;
    this.task = 'fuses';
    this.fuses = [];
    this.notes = [];
    this.switches = [];
    this.batteries = [];
    this.code = '';
    this.digitsFound = 0;
    this.keypadEntry = '';
    this.keypadOpen = false;
    this.collectedCount = 0;
    this.total = 0;
    this._t = 0;
    this._objs = [];

    events.on(EVT.DIGIT, ({ n }) => this._onDigit(n));
  }

  // --- spawn helpers ---------------------------------------------------------
  _spawnSpotsAcrossZones(count, minSep, avoidCell, avoidZone) {
    const zones = this.game.world.zones;
    const chosen = [];
    let guard = 0;
    while (chosen.length < count && guard++ < 800) {
      const zi = (Math.random() * zones.length) | 0;
      const c = zones[zi].maze.randomReachableCell();
      const okAvoid =
        zi !== avoidZone || Math.abs(c.cx - avoidCell.cx) + Math.abs(c.cz - avoidCell.cz) > 5;
      const okSep = chosen.every(
        (o) => o.zone !== zi || Math.abs(o.cx - c.cx) + Math.abs(o.cz - c.cz) >= minSep
      );
      if (okAvoid && okSep) chosen.push({ ...c, zone: zi });
    }
    while (chosen.length < count) {
      const zi = (Math.random() * zones.length) | 0;
      chosen.push({ ...zones[zi].maze.randomReachableCell(), zone: zi });
    }
    return chosen;
  }

  _worldPos(spot, y) {
    const wc = this.game.world.zones[spot.zone].maze.cellToWorld(spot.cx, spot.cz);
    return new THREE.Vector3(wc.x, y, wc.z);
  }

  // --- build -------------------------------------------------------------------
  build() {
    this.dispose(this.game.scene);

    // Pick a task different from yesterday's.
    const pool = TASK_TYPES.filter((t) => t !== lastTask);
    this.task = pool[(Math.random() * pool.length) | 0];
    lastTask = this.task;

    const playerCell = this.game.player.cell();
    const playerZone = this.game.player.zone;

    if (this.task === 'fuses') this._buildFuses(playerCell, playerZone);
    else if (this.task === 'keypad') this._buildKeypad(playerCell, playerZone);
    else this._buildSwitches(playerCell, playerZone);

    // Batteries always spawn.
    const batCount = Math.max(2, Math.ceil(this.total / 2) + 1);
    for (const spot of this._spawnSpotsAcrossZones(batCount, 3, playerCell, playerZone)) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.28, 0.16),
        new THREE.MeshStandardMaterial({ color: 0x0a1a0a, emissive: 0x33dd55, emissiveIntensity: 1.4 })
      );
      m.position.copy(this._worldPos(spot, 0.7));
      this.game.scene.add(m);
      this._objs.push(m);
      this.batteries.push({ mesh: m, cell: spot, zone: spot.zone, taken: false });
    }

    events.emit(EVT.TASK_PROGRESS, { text: this.statusText() });
  }

  _buildFuses(playerCell, playerZone) {
    this.total = this.game.params.fuses;
    this.collectedCount = 0;
    for (const spot of this._spawnSpotsAcrossZones(this.total, 4, playerCell, playerZone)) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.34, 10),
        new THREE.MeshStandardMaterial({ color: 0x201a08, emissive: 0xffc24a, emissiveIntensity: 2.2 })
      );
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.06, 10),
        new THREE.MeshStandardMaterial({ color: 0xb0902a, metalness: 0.7, roughness: 0.3 })
      );
      cap.position.y = 0.2;
      g.add(body, cap);
      const light = new THREE.PointLight(0xffc24a, 1.4, CONFIG.cellSize * 1.6, 2);
      light.position.y = 0.2;
      g.add(light);
      g.position.copy(this._worldPos(spot, 1.0));
      this.game.scene.add(g);
      this._objs.push(g);
      this.fuses.push({ mesh: g, light, cell: spot, zone: spot.zone, collected: false, progress: 0 });
    }
  }

  _buildKeypad(playerCell, playerZone) {
    const len = CONFIG.objectives.codeLength;
    this.total = len;
    this.digitsFound = 0;
    this.code = '';
    this.keypadEntry = '';
    for (let i = 0; i < len; i++) this.code += ((Math.random() * 10) | 0).toString();

    const spots = this._spawnSpotsAcrossZones(len, 5, playerCell, playerZone);
    for (let i = 0; i < len; i++) {
      // A glowing note showing "position: digit" — drawn on a small canvas.
      const cnv = document.createElement('canvas');
      cnv.width = cnv.height = 128;
      const ctx = cnv.getContext('2d');
      ctx.fillStyle = '#f5ecc8';
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#3a2f10';
      ctx.font = 'bold 30px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`#${i + 1}`, 64, 46);
      ctx.font = 'bold 62px monospace';
      ctx.fillText(this.code[i], 64, 108);
      const tex = new THREE.CanvasTexture(cnv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.42),
        new THREE.MeshStandardMaterial({
          map: tex,
          emissive: 0xf5ecc8,
          emissiveIntensity: 0.35,
          emissiveMap: tex,
          side: THREE.DoubleSide,
        })
      );
      m.position.copy(this._worldPos(spots[i], 1.35));
      this.game.scene.add(m);
      this._objs.push(m);
      this.notes.push({
        mesh: m,
        cell: spots[i],
        zone: spots[i].zone,
        index: i,
        digit: this.code[i],
        found: false,
      });
    }
  }

  _buildSwitches(playerCell, playerZone) {
    this.total = this.game.params.switches;
    this.collectedCount = 0;
    for (const spot of this._spawnSpotsAcrossZones(this.total, 5, playerCell, playerZone)) {
      const g = new THREE.Group();
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.7, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x3a3326, metalness: 0.5, roughness: 0.5 })
      );
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x200505, emissive: 0xff2222, emissiveIntensity: 2 })
      );
      lamp.position.set(0, 0.28, 0.12);
      g.add(box, lamp);
      g.position.copy(this._worldPos(spot, 1.3));
      this.game.scene.add(g);
      this._objs.push(g);
      this.switches.push({
        mesh: g,
        lamp,
        cell: spot,
        zone: spot.zone,
        flipped: false,
        progress: 0,
      });
    }
  }

  // --- task state ----------------------------------------------------------------
  statusText() {
    if (this.task === 'fuses') return `FUSES ${this.collectedCount}/${this.total}`;
    if (this.task === 'keypad') {
      let s = '';
      for (let i = 0; i < this.total; i++) s += this.notes[i]?.found ? this.code[i] : '·';
      return `CODE ${s}`;
    }
    return `POWER ${this.collectedCount}/${this.total}`;
  }

  taskBriefing() {
    if (this.task === 'fuses') return `Find ${this.total} fuses. Power the exit.`;
    if (this.task === 'keypad') return `Find ${this.total} numbers. The exit wants a code.`;
    return `Flip all ${this.total} breakers. Every flip is loud.`;
  }

  get done() {
    if (this.task === 'fuses') return this.collectedCount >= this.total;
    if (this.task === 'keypad') return this.game.level.exitDoor?.powered;
    return this.collectedCount >= this.total;
  }

  update(dt) {
    this._t += dt;
    const playerZone = this.game.player.zone;
    for (const f of this.fuses) {
      if (f.collected) continue;
      // A fuse's glow only costs shader work in the zone you're actually in.
      f.light.visible = f.zone === playerZone;
      f.mesh.rotation.y += dt * 1.5;
      f.mesh.position.y = 1.0 + Math.sin(this._t * 2 + f.cell.cx) * 0.08;
    }
    for (const n of this.notes) {
      if (n.found) continue;
      n.mesh.rotation.y += dt * 0.8;
    }
    for (const b of this.batteries) {
      if (b.taken) continue;
      b.mesh.rotation.y += dt * 1.2;
    }
  }

  // --- interactions ---------------------------------------------------------------
  collectFuse(fuse) {
    if (fuse.collected) return;
    fuse.collected = true;
    this.game.scene.remove(fuse.mesh);
    this.collectedCount++;
    events.emit(EVT.PICKUP_CHIME, {});
    events.emit(EVT.TASK_PROGRESS, { text: this.statusText() });
    if (this.collectedCount >= this.total) this._powerExit();
    else events.emit(EVT.SUBTITLE, { text: `Fuse ${this.collectedCount} of ${this.total}.`, ms: 2000 });
  }

  collectNote(note) {
    if (note.found) return;
    note.found = true;
    this.digitsFound++;
    this.game.scene.remove(note.mesh);
    events.emit(EVT.PICKUP_CHIME, {});
    events.emit(EVT.TASK_PROGRESS, { text: this.statusText() });
    events.emit(EVT.SUBTITLE, {
      text: `Position ${note.index + 1} is ${note.digit}. (${this.digitsFound}/${this.total})`,
      ms: 3000,
    });
  }

  flipSwitch(sw) {
    if (sw.flipped) return;
    sw.flipped = true;
    sw.lamp.material.emissive.setHex(0x22ff44);
    sw.lamp.material.color.setHex(0x052005);
    this.collectedCount++;
    events.emit(EVT.PICKUP_CHIME, {});
    events.emit(EVT.TASK_PROGRESS, { text: this.statusText() });
    // Breakers are LOUD — the Stalker hears every one.
    const pos = sw.mesh.position;
    events.emit(EVT.NOISE, {
      position: { x: pos.x, z: pos.z },
      zone: sw.zone,
      radius: CONFIG.objectives.switchNoiseRadius,
    });
    if (this.collectedCount >= this.total) this._powerExit();
    else
      events.emit(EVT.SUBTITLE, {
        text: `Breaker ${this.collectedCount} of ${this.total}. It heard that.`,
        ms: 2400,
      });
  }

  collectBattery(bat) {
    if (bat.taken) return;
    bat.taken = true;
    this.game.scene.remove(bat.mesh);
    this.game.flashlight.addBattery();
    events.emit(EVT.BATTERY_PICKUP, {});
    events.emit(EVT.PICKUP_CHIME, {});
    events.emit(EVT.SUBTITLE, { text: 'Spare battery.', ms: 1500 });
  }

  _powerExit() {
    this.game.level.exitDoor.power();
    events.emit(EVT.EXIT_POWERED, {});
    events.emit(EVT.DOOR_CHIME, {});
    events.emit(EVT.SUBTITLE, { text: 'The exit hums to life. Get out.', ms: 4000 });
  }

  // Interacting with the exit depends on the task.
  interactExit() {
    if (this.game.level.exitDoor?.powered) {
      events.emit(EVT.PLAYER_ESCAPED, {});
      return;
    }
    if (this.task === 'keypad') {
      this.setKeypadOpen(!this.keypadOpen);
      return;
    }
    events.emit(EVT.SUBTITLE, { text: `The exit is dead. ${this.statusText()}`, ms: 2200 });
  }

  setKeypadOpen(open) {
    this.keypadOpen = open;
    if (open) this.keypadEntry = '';
    events.emit(EVT.KEYPAD_OPEN, { open, entry: this.keypadEntry, length: this.total });
  }

  _onDigit(n) {
    if (!this.keypadOpen || this.task !== 'keypad') return;
    if (this.game.level.exitDoor?.powered) return;
    this.keypadEntry += n.toString();
    events.emit(EVT.KEYPAD_OPEN, { open: true, entry: this.keypadEntry, length: this.total });
    if (this.keypadEntry.length >= this.total) {
      if (this.keypadEntry === this.code) {
        this.setKeypadOpen(false);
        this._powerExit();
      } else {
        this.keypadEntry = '';
        events.emit(EVT.KEYPAD_FAIL, {});
        events.emit(EVT.KEYPAD_OPEN, { open: true, entry: '', length: this.total });
        events.emit(EVT.SUBTITLE, { text: 'WRONG. The buzzer echoes through the maze.', ms: 2600 });
        // A wrong code screams your position to the Stalker.
        const pos = this.game.level.exitDoor.position;
        events.emit(EVT.NOISE, {
          position: { x: pos.x, z: pos.z },
          zone: this.game.level.exitDoor.zone,
          radius: 30,
        });
      }
    }
  }

  // Cells the shift must never seal, per zone.
  getProtectedCells(zone) {
    const cells = [];
    for (const f of this.fuses) if (!f.collected && f.zone === zone) cells.push(f.cell);
    for (const n of this.notes) if (!n.found && n.zone === zone) cells.push(n.cell);
    for (const s of this.switches) if (s.zone === zone) cells.push(s.cell);
    for (const b of this.batteries) if (!b.taken && b.zone === zone) cells.push(b.cell);
    const level = this.game.level;
    if (level) {
      if (level.exitDoor?.zone === zone) cells.push(level.exitDoor.cell);
      for (const l of level.lockers) if (l.zone === zone) cells.push(l.cell);
      for (const p of level.portals) {
        if (p.a.zone === zone) cells.push({ cx: p.a.cx, cz: p.a.cz });
        if (p.b.zone === zone) cells.push({ cx: p.b.cx, cz: p.b.cz });
      }
    }
    if (this.game.player.zone === zone) cells.push(this.game.player.cell());
    return cells;
  }

  dispose(scene) {
    for (const o of this._objs) {
      scene.remove(o);
      o.traverse?.((c) => {
        if (c.geometry) c.geometry.dispose?.();
        if (c.material) c.material.dispose?.();
      });
    }
    this._objs = [];
    this.fuses = [];
    this.notes = [];
    this.switches = [];
    this.batteries = [];
    this.collectedCount = 0;
    this.digitsFound = 0;
    this.keypadOpen = false;
    this.keypadEntry = '';
  }
}
