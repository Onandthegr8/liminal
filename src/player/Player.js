import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { events, EVT } from '../core/events.js';

// First-person controller: look, accel/decel movement, grid collision with
// wall-sliding, head-bob, and hiding in lockers.
export class Player {
  constructor(camera, game) {
    this.camera = camera;
    this.game = game;
    this.cfg = CONFIG.player;

    this.position = new THREE.Vector3();
    this.prevPosition = new THREE.Vector3();
    this.vel = { x: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
    this.zone = 0; // which themed place we're in (0 = hub)
    this._baseY = 0; // kept for pocket/hiding vertical offsets (usually 0)
    this.speed = 0;
    this.isSprinting = false;
    this.isHiding = false;
    this.hideSteady = false;
    this.bobPhase = 0;
    this.breathPhase = 0;
    this._eyeY = this.cfg.eyeHeight;
    this._hideYaw = 0;

    this._fwd = new THREE.Vector3();
  }

  // Maze of the zone we're standing in.
  get maze() {
    return this.game.world.zones[this.zone].maze;
  }

  setZone(z) {
    this.zone = z;
    this._baseY = 0;
    if (!this.isHiding) this._eyeY = this.cfg.eyeHeight;
    this.position.y = this._eyeY;
  }

  setBaseY(y) {
    this._baseY = y;
    if (!this.isHiding) this._eyeY = y + this.cfg.eyeHeight;
    this.position.y = this._eyeY;
  }

  reset(spawnCell, zone = 0) {
    this.zone = zone;
    this._baseY = 0;
    const wc = this.maze.cellToWorld(spawnCell.cx, spawnCell.cz);
    this.position.set(wc.x, this.cfg.eyeHeight, wc.z);
    this.prevPosition.copy(this.position);
    this.vel.x = this.vel.z = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.pitch = 0;
    this.speed = 0;
    this.isSprinting = false;
    this.isHiding = false;
    this._eyeY = this.cfg.eyeHeight;
    this.applyToCamera(this.camera, 1);
  }

  getForward(out = this._fwd) {
    out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    return out;
  }

  cell() {
    return this.maze.worldToCell(this.position.x, this.position.z);
  }

  // --- update --------------------------------------------------------------
  update(dt, input) {
    this.prevPosition.copy(this.position);
    const look = input.consumeLook();
    this.yaw += look.yaw;
    this.pitch += look.pitch;
    // Numpad look controller (yaw only — 8/2 are movement).
    this.yaw += input.keyLook.yaw * this.cfg.keyLookSpeed * dt;
    const c = this.cfg.pitchClamp;
    if (this.pitch > c) this.pitch = c;
    if (this.pitch < -c) this.pitch = -c;

    if (this.isHiding) {
      this._updateHiding(dt, input);
      return;
    }

    // Movement basis.
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let dx = fx * input.move.y + rx * input.move.x;
    let dz = fz * input.move.y + rz * input.move.x;
    const inLen = Math.hypot(dx, dz);
    if (inLen > 1) {
      dx /= inLen;
      dz /= inLen;
    }

    const wantsSprint = input.sprintHeld && inLen > 0.1 && this.game.stamina.canSprint();
    this.isSprinting = wantsSprint;
    const targetSpeed = inLen > 0.05 ? (wantsSprint ? this.cfg.sprintSpeed : this.cfg.walkSpeed) : 0;

    const targetVx = dx * targetSpeed;
    const targetVz = dz * targetSpeed;
    const rate = targetSpeed > 0 ? this.cfg.accel : this.cfg.decel;
    this.vel.x += (targetVx - this.vel.x) * Math.min(1, rate * dt);
    this.vel.z += (targetVz - this.vel.z) * Math.min(1, rate * dt);

    // Grid collision with axis separation (wall-sliding).
    const nx = this.position.x + this.vel.x * dt;
    if (!this._blocked(nx, this.position.z)) this.position.x = nx;
    else this.vel.x = 0;
    const nz = this.position.z + this.vel.z * dt;
    if (!this._blocked(this.position.x, nz)) this.position.z = nz;
    else this.vel.z = 0;

    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // Head-bob + idle breathing.
    if (this.speed > 0.2) {
      this.bobPhase += dt * this.cfg.headBobFreq * (this.speed / this.cfg.walkSpeed);
    }
    this.breathPhase += dt * (this.isSprinting ? 6 : 2.2);
  }

  _blocked(x, z) {
    const m = this.maze;
    const r = this.cfg.radius;
    return (
      m.isWall(x, z) ||
      m.isWall(x + r, z) ||
      m.isWall(x - r, z) ||
      m.isWall(x, z + r) ||
      m.isWall(x, z - r)
    );
  }

  // --- hiding --------------------------------------------------------------
  enterHiding(locker) {
    this.isHiding = true;
    this._hideT = 0;
    this.position.set(locker.position.x, locker.position.y, locker.position.z);
    this.prevPosition.copy(this.position);
    this.vel.x = this.vel.z = 0;
    this.speed = 0;
    this.isSprinting = false;
    this.yaw = locker.facing;
    this._hideYaw = locker.facing;
    this._eyeY = locker.position.y;
    events.emit(EVT.HIDE_ENTER, { cell: locker.cell });
    events.emit(EVT.SUBTITLE, {
      text: 'Hold Interact to steady your breathing. Move to slip out.',
      ms: 3200,
    });
  }

  _updateHiding(dt, input) {
    this._hideT += dt;
    // Moving slips you out (after a short grace so entering with W held is safe).
    if (this._hideT > 0.5 && Math.abs(input.move.x) + Math.abs(input.move.y) > 0.5) {
      this.exitHiding();
      return;
    }

    // Limit look to a small range around the locker facing.
    const maxYaw = 0.6;
    let d = this.yaw - this._hideYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (d > maxYaw) this.yaw = this._hideYaw + maxYaw;
    if (d < -maxYaw) this.yaw = this._hideYaw - maxYaw;
    if (this.pitch > 0.5) this.pitch = 0.5;
    if (this.pitch < -0.5) this.pitch = -0.5;

    this.hideSteady = input.interactHeld;
    this.breathPhase += dt * (this.hideSteady ? 1.4 : 4.5);
  }

  exitHiding() {
    this.isHiding = false;
    this._eyeY = this._baseY + this.cfg.eyeHeight;
    events.emit(EVT.HIDE_EXIT, {});
  }

  // Noise loudness the Stalker can hear from (world units). Sprinting is loud.
  get noiseRadius() {
    // Hidden: barely any breath noise (and the Stalker gives up on it — see
    // its hide-cooldown), so hiding actually works.
    if (this.isHiding) return this.hideSteady ? 0 : 1.2;
    if (this.isSprinting && this.speed > 0.6) return this.game.stalker?.params?.hearingRadius ?? 14;
    if (this.speed > 0.6) return 4.5; // quiet footsteps
    return 0;
  }

  // --- render --------------------------------------------------------------
  applyToCamera(camera, alpha) {
    const ix = this.prevPosition.x + (this.position.x - this.prevPosition.x) * alpha;
    const iz = this.prevPosition.z + (this.position.z - this.prevPosition.z) * alpha;

    const bobY = Math.sin(this.bobPhase) * this.cfg.headBobAmp * Math.min(1, this.speed / this.cfg.walkSpeed);
    const swayX = Math.cos(this.bobPhase * 0.5) * this.cfg.headBobAmp * 0.4 * Math.min(1, this.speed / this.cfg.walkSpeed);
    const breath = Math.sin(this.breathPhase) * 0.012;

    camera.position.set(ix + swayX, this._eyeY + bobY + breath, iz);
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
