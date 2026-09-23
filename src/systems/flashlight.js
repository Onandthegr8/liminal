import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { events, EVT } from '../core/events.js';

// Camera-mounted light rig with a draining battery. A focused SpotLight is the
// beam (and staggers creatures via game.flashlight.on), plus a soft PointLight
// "fill" so the immediate area is lit even in wide-open dark places like the
// graveyard, where the beam would otherwise sail off into nothing.
export class Flashlight {
  constructor(game) {
    this.game = game;
    this.cfg = CONFIG.flashlight;
    this.on = false;
    this.battery = this.cfg.batteryMax;

    const cam = game.camera;
    if (!cam.parent) game.scene.add(cam); // lights parented to camera need it in-scene

    this.spot = new THREE.SpotLight(
      0xfff4d8,
      0,
      this.cfg.distance,
      this.cfg.angle,
      this.cfg.penumbra,
      this.cfg.decay
    );
    this.spot.position.set(0, 0, 0.1);
    this.target = new THREE.Object3D();
    this.target.position.set(0, -0.08, -1); // aim a hair down so the ground lights
    cam.add(this.spot);
    cam.add(this.target);
    this.spot.target = this.target;

    // Soft carried glow around the player.
    this.fill = new THREE.PointLight(0xffe9c4, 0, this.cfg.fillDistance, 1);
    this.fill.position.set(0, 0, 0);
    cam.add(this.fill);
  }

  _apply(factor) {
    this.spot.intensity = this.on ? this.cfg.intensity * factor : 0;
    this.fill.intensity = this.on ? this.cfg.fillIntensity * factor : 0;
  }

  reset() {
    this.battery = this.cfg.batteryMax;
    this.on = false;
    this._apply(1);
  }

  toggle() {
    if (!this.on && this.battery <= 0) {
      events.emit(EVT.SUBTITLE, { text: 'The flashlight is dead.', ms: 1600 });
      return;
    }
    this.on = !this.on;
    this._apply(1);
    events.emit(EVT.FLASHLIGHT_TOGGLE, { on: this.on });
  }

  addBattery() {
    this.battery = Math.min(this.cfg.batteryMax, this.battery + this.cfg.spareRefill);
  }

  update(dt) {
    if (!this.on) return;
    this.battery -= this.cfg.drainPerSec * dt;
    if (this.battery <= 0) {
      this.battery = 0;
      this.on = false;
      this._apply(1);
      events.emit(EVT.SUBTITLE, { text: 'The flashlight dies.', ms: 1600 });
      return;
    }
    // subtle instability at low battery
    const factor = this.battery < 20 ? 0.55 + Math.random() * 0.45 : 1;
    this._apply(factor);
  }
}
