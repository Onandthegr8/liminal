import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { events, EVT } from '../core/events.js';

const STATE = { PATROL: 'PATROL', INVESTIGATE: 'INVESTIGATE', CHASE: 'CHASE', SEARCH: 'SEARCH' };

// The Stalker: a tall, wrong, relentless thing built from primitives. A* on the
// current zone's maze grid + a perception-driven state machine. The flashlight
// is now a DEFENSIVE tool — a centered beam staggers it and prevents the catch.
// When it saw you hide, it lingers a while, then gives up and wanders off.
export class Stalker {
  constructor(scene, game, variant = 0) {
    this.scene = scene;
    this.game = game;
    this.variant = variant % 4;
    this.cfg = CONFIG.stalker;
    this.params = {
      chaseSpeed: this.cfg.chaseSpeed,
      hearingRadius: this.cfg.hearingRadius,
      losRange: this.cfg.losRange,
    };

    this.position = new THREE.Vector3();
    this.facing = 0;
    this.zone = 0;
    this.state = STATE.PATROL;
    this.path = null;
    this.pathIndex = 0;
    this.repathTimer = 0;
    this.searchTimer = 0;
    this.loseSightTimer = 0;
    this.lastKnown = new THREE.Vector3();
    this.lastKnownZone = 0;
    this.distanceToPlayer = Infinity;
    this.isVisibleToPlayer = false;
    this.proximity = 0;
    this.staggered = false;
    this._speedScale = 1;
    this._lingerT = 0;
    this._hideCooldown = 0;
    this._twitch = 0;
    this._caught = false;
    this._tmp = new THREE.Vector3();

    this._buildModel();

    this._offNoise = events.on(EVT.NOISE, ({ position, zone, radius }) => {
      if (this._caught) return;
      const nz = zone ?? this.zone;
      const d = Math.hypot(position.x - this.position.x, position.z - this.position.z);
      const sameZone = nz === this.zone;
      if (d <= (sameZone ? radius : radius * 0.5)) {
        this.lastKnown.set(position.x, 0, position.z);
        this.lastKnownZone = nz;
        if (this.state !== STATE.CHASE) this._setState(STATE.INVESTIGATE);
      }
    });
  }

  get maze() {
    return this.game.world.zones[this.zone].maze;
  }

  // Shared helpers ---------------------------------------------------------
  _eye(g, x, y, z, r, color) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 3.5 });
    const e = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 6), mat);
    e.position.set(x, y, z);
    e.userData.phase = Math.random() * Math.PI * 2;
    g.add(e);
    this._eyes.push(e);
    return e;
  }

  _addShell(g, r1, r2, hh, y) {
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(r1, r2, hh, 8),
      new THREE.MeshStandardMaterial({ color: 0x101014, transparent: true, opacity: 0.12, emissive: 0x223044, emissiveIntensity: 0.4 })
    );
    shell.position.y = y;
    g.add(shell);
    this._shell = shell;
  }

  _buildModel() {
    this._eyes = [];
    const g = new THREE.Group();
    switch (this.variant) {
      case 1: this._buildCrawler(g); break;
      case 2: this._buildStick(g); break;
      case 3: this._buildSwarm(g); break;
      default: this._buildLongOne(g);
    }
    g.traverse((c) => (c.frustumCulled = false));
    this.group = g;
    this.scene.add(g);
  }

  // Variant 0 — THE LONG ONE: tall, hunched, a cluster of pale eyes.
  _buildLongOne(g) {
    const dark = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.95 });
    const pale = new THREE.MeshStandardMaterial({ color: 0x1a1815, roughness: 1 });
    const h = this.cfg.height;
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, h * 0.5, 8), dark);
    torso.position.y = h * 0.52;
    torso.rotation.x = 0.06;
    g.add(torso);
    this._torso = torso;
    const armGeo = new THREE.CylinderGeometry(0.06, 0.05, h * 0.62, 6);
    for (const s of [-1, 1]) {
      const a = new THREE.Mesh(armGeo, dark);
      a.position.set(0.34 * s, h * 0.5, 0.02 * -s);
      a.rotation.z = -0.14 * s;
      g.add(a);
    }
    const legGeo = new THREE.CylinderGeometry(0.09, 0.07, h * 0.5, 6);
    for (const s of [-1, 1]) {
      const l = new THREE.Mesh(legGeo, dark);
      l.position.set(0.12 * s, h * 0.24, 0);
      g.add(l);
    }
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.5, 7), pale);
    head.position.y = h * 0.88;
    head.rotation.z = 0.14;
    g.add(head);
    this._head = head;
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.02), new THREE.MeshStandardMaterial({ color: 0x000000 }));
    mouth.position.set(0, h * 0.88, -0.15);
    g.add(mouth);
    for (const [ex, ey, ez] of [[-0.08, 0.9, -0.15], [0.09, 0.905, -0.14], [-0.02, 0.86, -0.17], [0.11, 0.84, -0.13], [-0.11, 0.82, -0.12], [0.03, 0.93, -0.13], [-0.05, 0.8, -0.15]])
      this._eye(g, ex, h * ey, ez, 0.035, 0xf6ffd0);
    this._addShell(g, 0.3, 0.42, h * 0.9, h * 0.5);
  }

  // Variant 1 — THE CRAWLER: low, wide, hunched over long dragging arms, with
  // one huge lidless eye set in a flat splayed head.
  _buildCrawler(g) {
    const flesh = new THREE.MeshStandardMaterial({ color: 0x14100e, roughness: 1 });
    const h = this.cfg.height * 0.6;
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), flesh);
    back.position.set(0, h * 0.7, 0.15);
    back.scale.set(1.1, 0.7, 1.3);
    g.add(back);
    this._torso = back;
    // long arms planted forward like a beast about to lunge
    const armGeo = new THREE.CylinderGeometry(0.09, 0.07, h * 1.15, 6);
    for (const s of [-1, 1]) {
      const a = new THREE.Mesh(armGeo, flesh);
      a.position.set(0.4 * s, h * 0.45, -0.35);
      a.rotation.x = 0.7;
      a.rotation.z = -0.2 * s;
      g.add(a);
    }
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, h * 0.7, 6), flesh);
      leg.position.set(0.28 * s, h * 0.32, 0.4);
      leg.rotation.x = -0.4;
      g.add(leg);
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), flesh);
    head.position.set(0, h * 0.55, -0.5);
    head.scale.set(1.4, 0.6, 1);
    g.add(head);
    this._head = head;
    // one huge eye
    this._eye(g, 0, h * 0.58, -0.72, 0.13, 0xff4a3a);
    this._addShell(g, 0.5, 0.7, h * 0.9, h * 0.55);
  }

  // Variant 2 — THE STICK: impossibly thin and tall, tiny head, no eyes — only
  // a long vertical mouth-slit that glows sickly.
  _buildStick(g) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x090909, roughness: 1 });
    const h = this.cfg.height * 1.2;
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, h * 0.6, 6), mat);
    torso.position.y = h * 0.5;
    g.add(torso);
    this._torso = torso;
    const limbGeo = new THREE.CylinderGeometry(0.035, 0.03, h * 0.55, 5);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(limbGeo, mat);
      arm.position.set(0.12 * s, h * 0.55, 0);
      arm.rotation.z = 0.25 * s;
      g.add(arm);
      const leg = new THREE.Mesh(limbGeo, mat);
      leg.position.set(0.06 * s, h * 0.2, 0);
      g.add(leg);
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), mat);
    head.position.y = h * 0.86;
    head.scale.set(0.8, 1.3, 0.8);
    g.add(head);
    this._head = head;
    // glowing vertical mouth-slit (treated as an "eye" so it flickers)
    const slit = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.55, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xbfe0a0, emissiveIntensity: 3 })
    );
    slit.position.set(0, h * 0.6, -0.08);
    slit.userData.phase = Math.random() * Math.PI * 2;
    g.add(slit);
    this._eyes.push(slit);
    this._addShell(g, 0.14, 0.16, h * 0.95, h * 0.5);
  }

  // Variant 3 — THE SWARM: a bulbous sagging mass studded with eyes all over,
  // shuffling on many short legs.
  _buildSwarm(g) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x120c10, roughness: 1 });
    const h = this.cfg.height * 0.75;
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), mat);
    body.position.y = h * 0.55;
    body.scale.set(1, 1.15, 1);
    g.add(body);
    this._torso = body;
    this._head = body; // twitch the whole mass
    // many short legs
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, h * 0.5, 5), mat);
      leg.position.set(Math.cos(a) * 0.45, h * 0.2, Math.sin(a) * 0.45);
      leg.rotation.z = Math.cos(a) * 0.5;
      leg.rotation.x = -Math.sin(a) * 0.5;
      g.add(leg);
    }
    // eyes scattered over the whole body
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI - Math.PI / 2;
      const r = 0.56;
      this._eye(
        g,
        Math.cos(b) * Math.cos(a) * r,
        h * 0.55 + Math.sin(b) * r * 1.15,
        Math.cos(b) * Math.sin(a) * r,
        0.04,
        0xffe0f0
      );
    }
    this._addShell(g, 0.6, 0.6, h * 0.9, h * 0.55);
  }

  setParams(params) {
    this.params.chaseSpeed = params.stalkerChaseSpeed;
    this.params.hearingRadius = params.stalkerHearingRadius;
    this.params.losRange = params.stalkerLosRange;
  }

  reset(spawnCell, zone = 0) {
    this.zone = zone;
    const wc = this.game.world.zones[zone].maze.cellToWorld(spawnCell.cx, spawnCell.cz);
    this.position.set(wc.x, 0, wc.z);
    this.group.position.copy(this.position);
    this.state = STATE.PATROL;
    this.path = null;
    this.pathIndex = 0;
    this.repathTimer = 0;
    this._caught = false;
    this._lingerT = 0;
    this._hideCooldown = 0;
    this.loseSightTimer = 0;
  }

  cell() {
    return this.maze.worldToCell(this.position.x, this.position.z);
  }

  // --- perception ----------------------------------------------------------
  _updateSenses() {
    const p = this.game.player;
    const sameZone = this.zone === p.zone;
    const dx = p.position.x - this.position.x;
    const dz = p.position.z - this.position.z;
    this.distanceToPlayer = sameZone ? Math.hypot(dx, dz) : Infinity;
    const proxRaw = Math.max(0, 1 - this.distanceToPlayer / 18);
    this.proximity = sameZone ? proxRaw : proxRaw * 0.25;

    this.canSeePlayer = false;
    if (sameZone && !p.isHiding && this.distanceToPlayer <= this.params.losRange) {
      const d = this.distanceToPlayer || 1;
      const fx = -Math.sin(this.facing);
      const fz = -Math.cos(this.facing);
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot > Math.cos(this.cfg.losFov / 2)) {
        if (this.maze.lineOfSightClear(this.position.x, this.position.z, p.position.x, p.position.z)) {
          this.canSeePlayer = true;
        }
      }
    }

    this.isVisibleToPlayer = false;
    if (sameZone && this.distanceToPlayer < 30) {
      const pf = p.getForward(this._tmp);
      const d = this.distanceToPlayer || 1;
      const dot = (-dx / d) * pf.x + (-dz / d) * pf.z;
      if (dot > 0.1 && this.maze.lineOfSightClear(p.position.x, p.position.z, this.position.x, this.position.z)) {
        this.isVisibleToPlayer = true;
      }
    }

    // Hearing (ignore the player's breathing while it's cooling off a hide).
    const noiseR = p.noiseRadius;
    const hideIgnore = p.isHiding && this._hideCooldown > 0;
    this.hearsPlayer = sameZone && !hideIgnore && noiseR > 0 && this.distanceToPlayer <= noiseR;

    // Flashlight beam — DEFENSE. A centered beam staggers it.
    this.beamHit = false;
    if (sameZone && this.game.flashlight.on && this.distanceToPlayer < CONFIG.flashlight.beamHitRange) {
      const pf = p.getForward(this._tmp);
      const d = this.distanceToPlayer || 1;
      // Direction from the player TO the stalker is (-dx,-dz).
      const dot = (-dx / d) * pf.x + (-dz / d) * pf.z;
      if (dot > CONFIG.flashlight.beamHitDot &&
          this.maze.lineOfSightClear(p.position.x, p.position.z, this.position.x, this.position.z)) {
        this.beamHit = true;
      }
    }
    this.staggered = this.beamHit;
    this._speedScale = this.beamHit ? this.cfg.staggerSlow : 1;
    this._sameZone = sameZone;
  }

  _setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.path = null;
    this.repathTimer = 0;
    if (s === STATE.CHASE) events.emit(EVT.STALKER_CHASE_START, {});
    if (s === STATE.SEARCH) this.searchTimer = this.cfg.searchDuration;
    events.emit(EVT.STALKER_STATE, { state: s, distance: this.distanceToPlayer });
  }

  // Travel toward a target zone via the portal network (hub-and-spoke).
  _transitTowardZone(targetZone, dt, speed) {
    if (targetZone === this.zone) return false;
    const world = this.game.world;
    const hopTo = this.zone !== 0 ? 0 : targetZone; // spoke -> hub -> spoke
    const portal = world.portals.find(
      (pt) =>
        (pt.a.zone === this.zone && pt.b.zone === hopTo) ||
        (pt.b.zone === this.zone && pt.a.zone === hopTo)
    );
    if (!portal) return false;
    const side = portal.a.zone === this.zone ? portal.a : portal.b;
    const other = portal.a.zone === this.zone ? portal.b : portal.a;
    const cellTarget = { cx: side.cx, cz: side.cz };
    if (this._atCell(cellTarget)) {
      this.zone = other.zone;
      const wc = this.maze.cellToWorld(other.cx, other.cz);
      this.position.set(wc.x, 0, wc.z);
      this.path = null;
      return true;
    }
    this.repathTimer -= dt;
    if (!this._hasPath() || this.repathTimer <= 0) {
      this._repath(cellTarget);
      this.repathTimer = this.cfg.repathInterval * 2;
    }
    this._follow(dt, speed);
    return true;
  }

  // --- update --------------------------------------------------------------
  update(dt, player) {
    if (this._caught) return;
    this._updateSenses();
    if (this._hideCooldown > 0) this._hideCooldown -= dt;

    // Sight can't find a hidden player (canSeePlayer is already false then),
    // but HEARING can — unsteady breathing in a locker is a real noise.
    if (this.canSeePlayer) {
      this.lastKnown.copy(player.position);
      this.lastKnownZone = player.zone;
      this.loseSightTimer = this.cfg.loseSightGrace;
      this._setState(STATE.CHASE);
    } else if (this.hearsPlayer && this.state !== STATE.CHASE) {
      this.lastKnown.copy(player.position);
      this.lastKnownZone = player.zone;
      this._setState(STATE.INVESTIGATE);
    }

    // Hide-linger: if it's hunting near your hidden spot, it waits then leaves.
    if (player.isHiding && (this.state === STATE.SEARCH || this.state === STATE.INVESTIGATE)) {
      if (this.distanceToPlayer < 12) this._lingerT += dt;
      if (this._lingerT > this.cfg.staggerLingerAfterHide) {
        this._lingerT = 0;
        this._hideCooldown = 8; // stop re-hearing the breathing for a while
        const far = this.maze.randomReachableCellFar(this.cell(), 8);
        this._repath(far);
        this._setState(STATE.PATROL);
        events.emit(EVT.SUBTITLE, { text: 'It loses interest, and drifts away.', ms: 2600 });
      }
    } else {
      this._lingerT = 0;
    }

    switch (this.state) {
      case STATE.PATROL: this._runPatrol(dt); break;
      case STATE.INVESTIGATE: this._runInvestigate(dt); break;
      case STATE.CHASE: this._runChase(dt, player); break;
      case STATE.SEARCH: this._runSearch(dt); break;
    }

    this._animate(dt);
    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;

    // Catch — but never while the beam is holding it.
    if (
      !player.isHiding &&
      this._sameZone &&
      !this.beamHit &&
      this.distanceToPlayer < this.cfg.catchRadius &&
      this.state === STATE.CHASE
    ) {
      this._caught = true;
      events.emit(EVT.PLAYER_CAUGHT, {});
    }
  }

  _animate(dt) {
    this._twitch += dt;
    // Independent eye flicker.
    for (const e of this._eyes) {
      const f = 2.5 + Math.sin(this._twitch * 7 + e.userData.phase) * 1.2 + this.proximity * 2.5;
      e.material.emissiveIntensity = Math.max(0, f) * (Math.random() < 0.03 ? 0.1 : 1);
    }
    // Head twitch + jitter that spikes when close or staggered.
    const jit = (this.staggered ? 0.14 : 0.02) + this.proximity * 0.05;
    this._head.position.x = Math.sin(this._twitch * 13) * jit;
    this._head.rotation.z = 0.14 + Math.sin(this._twitch * 9) * jit;
    // The double-shell strobes.
    this._shell.material.opacity = 0.06 + (Math.random() < 0.08 ? 0.22 : 0.06);
    // Recoil pose when the light holds it.
    this._torso.rotation.x = this.staggered ? -0.25 : 0.06;
  }

  _runPatrol(dt) {
    const p = this.game.player;
    if (p.zone !== this.zone) {
      if (this._driftToPlayer || Math.random() < 0.0009) {
        this._driftToPlayer = true;
        if (this._transitTowardZone(p.zone, dt, this.cfg.patrolSpeed)) return;
        this._driftToPlayer = false;
      }
    } else {
      this._driftToPlayer = false;
    }
    if (!this._hasPath()) this._repath(this.maze.randomReachableCell());
    this._follow(dt, this.cfg.patrolSpeed);
  }

  _runInvestigate(dt) {
    if (this._transitTowardZone(this.lastKnownZone, dt, this.cfg.investigateSpeed)) return;
    this.repathTimer -= dt;
    if (!this._hasPath() || this.repathTimer <= 0) {
      this._repath(this.maze.worldToCell(this.lastKnown.x, this.lastKnown.z));
      this.repathTimer = this.cfg.repathInterval;
    }
    this._follow(dt, this.cfg.investigateSpeed);
    if (this._atCell(this.maze.worldToCell(this.lastKnown.x, this.lastKnown.z))) this._setState(STATE.SEARCH);
  }

  _runChase(dt, player) {
    this.loseSightTimer -= dt;
    if (this.canSeePlayer) {
      this.lastKnown.copy(player.position);
      this.lastKnownZone = player.zone;
      this.loseSightTimer = this.cfg.loseSightGrace;
    }
    if (this._transitTowardZone(this.lastKnownZone, dt, this.params.chaseSpeed)) return;
    this.repathTimer -= dt;
    if (!this._hasPath() || this.repathTimer <= 0) {
      this._repath(this.maze.worldToCell(this.lastKnown.x, this.lastKnown.z));
      this.repathTimer = this.cfg.repathInterval;
    }
    this._follow(dt, this.params.chaseSpeed);
    if (this.loseSightTimer <= 0 && !this.canSeePlayer) this._setState(STATE.SEARCH);
  }

  _runSearch(dt) {
    this.searchTimer -= dt;
    if (!this._hasPath()) {
      const base = this.maze.worldToCell(this.lastKnown.x, this.lastKnown.z);
      const target = {
        cx: base.cx + (Math.floor(Math.random() * 7) - 3),
        cz: base.cz + (Math.floor(Math.random() * 7) - 3),
      };
      if (!this.maze.isWallCell(target.cx, target.cz)) this._repath(target);
      else this._repath(this.maze.randomReachableCell());
    }
    this._follow(dt, this.cfg.searchSpeed);
    if (this.searchTimer <= 0) this._setState(STATE.PATROL);
  }

  // --- movement helpers ----------------------------------------------------
  _hasPath() {
    return this.path && this.pathIndex < this.path.length;
  }

  _repath(goalCell) {
    const path = this.maze.findPath(this.cell(), goalCell);
    if (path && path.length > 1) {
      this.path = path;
      this.pathIndex = 1;
    } else {
      this.path = null;
    }
  }

  _atCell(c) {
    const me = this.cell();
    return me.cx === c.cx && me.cz === c.cz;
  }

  _follow(dt, speed) {
    if (!this._hasPath()) return;
    const wp = this.maze.cellToWorld(this.path[this.pathIndex].cx, this.path[this.pathIndex].cz);
    let dx = wp.x - this.position.x;
    let dz = wp.z - this.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    if (dist < 0.35) {
      this.pathIndex++;
      return;
    }
    dx /= dist;
    dz /= dist;
    const s = speed * this._speedScale;
    this.position.x += dx * s * dt;
    this.position.z += dz * s * dt;
    const desired = Math.atan2(-dx, -dz);
    let d = desired - this.facing;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.facing += d * Math.min(1, 8 * dt);
  }

  dispose(scene) {
    this._offNoise?.();
    scene.remove(this.group);
    this.group.traverse((c) => {
      if (c.geometry) c.geometry.dispose?.();
      if (c.material) c.material.dispose?.();
    });
  }
}
