import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { getTheme } from './themes.js';
import { panelTexture, doorTexture } from './textures.js';

// Builds Three.js geometry for every zone. Each zone is a themed place (the
// backrooms hub + rare portal destinations: hospital, garden, graveyard,
// sewage, office, church, hotel, field). Zones live far apart in X so their
// fog/sky don't mix. Only the player's current zone's lights are enabled.
//
// world = { zones: [{ maze, theme }], portals: [{ a:{zone,cx,cz}, b:{zone,cx,cz}, group,... }] }

function cellHash(x, z, f) {
  let h = Math.imul(x + 17, 374761393) ^ Math.imul(z + 31, 668265263) ^ Math.imul(f + 7, 951274213);
  h = (h ^ (h >>> 13)) >>> 0;
  return h;
}

export class Level {
  constructor(scene, world, params) {
    this.scene = scene;
    this.world = world;
    this.params = params;
    this.objects = [];
    this.lockers = [];
    this.portals = world.portals;
    this.zoneLights = []; // per-zone { ambient, dir, points[], flickerPoints[] }
    this.panels = []; // per-panel { mesh, zone, pos }
    this._wc = { x: 0, z: 0 };

    for (let z = 0; z < world.zones.length; z++) this._buildZone(z);
    this._buildLightPool();
    this._buildLockers();
    this._buildPortals();
    this._buildExit();
  }

  get zoneCount() {
    return this.world.zones.length;
  }
  mazeAt(z) {
    return this.world.zones[z].maze;
  }
  themeAt(z) {
    return getTheme(this.world.zones[z].theme);
  }

  _add(obj) {
    this.scene.add(obj);
    this.objects.push(obj);
    return obj;
  }

  // --- per-zone geometry ---------------------------------------------------
  _buildZone(zi) {
    const maze = this.mazeAt(zi);
    const theme = this.themeAt(zi);
    const n = maze.size;
    const span = n * CONFIG.cellSize;
    const cxCenter = maze.originX + span / 2;
    const czCenter = maze.originZ + span / 2;

    // Floor.
    const floorTex = theme.floor.tex().clone();
    floorTex.needsUpdate = true;
    floorTex.repeat.set(n * (theme.floor.repeat || 1), n * (theme.floor.repeat || 1));
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(span, span),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 1 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cxCenter, 0, czCenter);
    this._add(floor);

    // Ceiling (only enclosed themes).
    if (theme.hasCeiling && theme.ceil) {
      const cTex = theme.ceil.tex().clone();
      cTex.needsUpdate = true;
      cTex.repeat.set(n * (theme.ceil.repeat || 1), n * (theme.ceil.repeat || 1));
      const ceiling = new THREE.Mesh(
        new THREE.PlaneGeometry(span, span),
        new THREE.MeshStandardMaterial({ map: cTex, roughness: 1 })
      );
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.set(cxCenter, CONFIG.wallHeight, czCenter);
      this._add(ceiling);
    }

    // Walls — one InstancedMesh per zone with per-instance color variety.
    const wallH = CONFIG.wallHeight * (theme.wall.heightMul || 1);
    const wallTex = theme.wall.tex();
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 });
    const cap = n * n;
    const boxMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(CONFIG.cellSize, wallH, CONFIG.cellSize),
      wallMat,
      cap
    );
    boxMesh.frustumCulled = false;
    boxMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const pillarMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(CONFIG.cellSize * 0.55, CONFIG.cellSize * 0.62, wallH, 10),
      wallMat,
      cap
    );
    pillarMesh.frustumCulled = false;
    pillarMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._add(boxMesh);
    this._add(pillarMesh);

    const zone = this.world.zones[zi];
    zone._boxMesh = boxMesh;
    zone._pillarMesh = pillarMesh;
    zone._wallH = wallH;
    zone._tints = (theme.wall.tints || [0xffffff]).map((c) => new THREE.Color(c));
    this.rebuildZoneWalls(zi);

    // Themed props (sparse, no humans).
    const usedCells = [];
    const spots = (count) => {
      const out = [];
      let guard = 0;
      while (out.length < count && guard++ < 200) {
        const c = maze.openCells[(Math.random() * maze.openCells.length) | 0];
        if (usedCells.some((u) => u.cx === c.cx && u.cz === c.cz)) continue;
        usedCells.push(c);
        const w = maze.cellToWorld(c.cx, c.cz);
        out.push({ x: w.x, z: w.z, cell: c });
      }
      return out;
    };
    theme.decorate({ add: (m) => this._add(m), maze, spots, THREE });

    // Lighting for this zone.
    this._buildZoneLights(zi);
  }

  rebuildZoneWalls(zi) {
    const maze = this.mazeAt(zi);
    const zone = this.world.zones[zi];
    const wallH = zone._wallH;
    const dummy = new THREE.Object3D();
    const tints = zone._tints;
    let bi = 0;
    let pi = 0;
    for (let z = 0; z < maze.size; z++) {
      for (let x = 0; x < maze.size; x++) {
        if (maze.grid[z][x] !== 1) continue;
        maze.cellToWorld(x, z, this._wc);
        const h = cellHash(x, z, zi);
        const v = h % 100;
        const j1 = ((h >>> 8) % 1000) / 1000 - 0.5;
        const j2 = ((h >>> 16) % 1000) / 1000 - 0.5;
        const tint = tints[h % tints.length];

        dummy.position.set(this._wc.x, wallH / 2, this._wc.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);

        const border = x === 0 || z === 0 || x === maze.size - 1 || z === maze.size - 1;
        if (border || v < 50) {
          dummy.rotation.y = border ? 0 : j1 * 0.06;
        } else if (v < 72) {
          dummy.rotation.y = j1 * 0.45;
          dummy.scale.set(0.85 + Math.abs(j2) * 0.4, 1, 0.85 + Math.abs(j1) * 0.4);
          dummy.position.x += j2 * 0.5;
          dummy.position.z += j1 * 0.5;
        } else if (v < 88) {
          dummy.updateMatrix();
          zone._pillarMesh.setMatrixAt(pi, dummy.matrix);
          zone._pillarMesh.setColorAt(pi, tint);
          pi++;
          continue;
        } else {
          dummy.rotation.z = j1 * 0.14;
          dummy.rotation.x = j2 * 0.1;
          dummy.scale.y = 1.06;
        }
        dummy.updateMatrix();
        zone._boxMesh.setMatrixAt(bi, dummy.matrix);
        zone._boxMesh.setColorAt(bi, tint);
        bi++;
      }
    }
    zone._boxMesh.count = bi;
    zone._boxMesh.instanceMatrix.needsUpdate = true;
    if (zone._boxMesh.instanceColor) zone._boxMesh.instanceColor.needsUpdate = true;
    zone._pillarMesh.count = pi;
    zone._pillarMesh.instanceMatrix.needsUpdate = true;
    if (zone._pillarMesh.instanceColor) zone._pillarMesh.instanceColor.needsUpdate = true;
  }

  rebuildWalls() {
    for (let z = 0; z < this.zoneCount; z++) this.rebuildZoneWalls(z);
  }

  _buildZoneLights(zi) {
    const theme = this.themeAt(zi);
    const maze = this.mazeAt(zi);
    const n = maze.size;
    const span = n * CONFIG.cellSize;
    const cx = maze.originX + span / 2;
    const cz = maze.originZ + span / 2;
    const scale = this.params.lightIntensityScale;
    const lights = { zone: zi, ambient: null, statics: [], flicker: [], panels: [] };

    const amb = new THREE.AmbientLight(theme.ambient.color, theme.ambient.intensity);
    this._add(amb);
    lights.ambient = amb;

    if (theme.lightMode === 'panels') {
      const panelMat = new THREE.MeshStandardMaterial({
        map: panelTexture(),
        emissive: 0xfff3c0,
        emissiveIntensity: 1.1,
        emissiveMap: panelTexture(),
        roughness: 1,
      });
      const panelGeo = new THREE.PlaneGeometry(CONFIG.cellSize * 0.7, CONFIG.cellSize * 0.7);
      for (let z = 2; z < n - 1; z += 3) {
        for (let x = 2; x < n - 1; x += 3) {
          maze.cellToWorld(x, z, this._wc);
          const p = new THREE.Mesh(panelGeo, panelMat.clone());
          p.rotation.x = Math.PI / 2;
          p.position.set(this._wc.x, CONFIG.wallHeight - 0.02, this._wc.z);
          this._add(p);
          const rec = { mesh: p, zone: zi, pos: new THREE.Vector3(this._wc.x, CONFIG.wallHeight - 0.3, this._wc.z) };
          this.panels.push(rec);
          lights.panels.push(rec);
        }
      }
    } else if (theme.lightMode === 'sun' || theme.lightMode === 'moon') {
      const isMoon = theme.lightMode === 'moon';
      const dir = new THREE.DirectionalLight(
        isMoon ? 0x93a6cf : 0xfff2cf,
        (isMoon ? 0.5 : 2.4) * scale
      );
      dir.position.set(cx + 40, 90, cz + 20);
      dir.target.position.set(cx, 0, cz);
      this._add(dir);
      this._add(dir.target);
      lights.statics.push(dir);
    } else {
      // bulbs / candles / sconces — scattered warm point lights, flicker-prone.
      const isCandle = theme.lightMode === 'candles';
      const color = isCandle ? 0xff9a3a : theme.lightMode === 'sconces' ? 0xff7a4a : 0xaac0d0;
      const count = Math.max(4, Math.floor(n / 3));
      for (let i = 0; i < count; i++) {
        const c = maze.openCells[(Math.random() * maze.openCells.length) | 0];
        maze.cellToWorld(c.cx, c.cz, this._wc);
        const l = new THREE.PointLight(color, 4 * scale, CONFIG.cellSize * 3.4, 2);
        l.position.set(this._wc.x, CONFIG.wallHeight - 0.6, this._wc.z);
        l.userData.base = 4 * scale;
        this._add(l);
        lights.statics.push(l);
        lights.flicker.push(l);
      }
    }

    this.zoneLights.push(lights);
  }

  _buildLightPool() {
    // Shared pool of dynamic point lights, assigned to the player-zone's panels.
    this.maxLights = 10;
    this.lightPool = [];
    for (let i = 0; i < 12; i++) {
      const l = new THREE.PointLight(0xffe6a0, 0, CONFIG.cellSize * 4.5, 2);
      l.visible = false;
      this._add(l);
      this.lightPool.push(l);
    }
  }

  _buildLockers() {
    const cell = CONFIG.cellSize;
    const geo = new THREE.BoxGeometry(cell * 0.7, CONFIG.wallHeight * 0.82, cell * 0.5);
    for (let zi = 0; zi < this.zoneCount; zi++) {
      const maze = this.mazeAt(zi);
      const theme = this.themeAt(zi);
      if (theme.openness === 'open') continue; // no lockers in fields/gardens
      const n = maze.size;
      const target = Math.max(3, Math.floor(n / 7));
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5a4a22, roughness: 0.8, metalness: 0.3 });
      let placed = 0;
      let guard = 0;
      const used = new Set();
      while (placed < target && guard++ < 300) {
        const c = maze.openCells[(Math.random() * maze.openCells.length) | 0];
        const key = c.cz * n + c.cx;
        if (used.has(key)) continue;
        const nbWalls = [
          [c.cx - 1, c.cz, -1, 0],
          [c.cx + 1, c.cz, 1, 0],
          [c.cx, c.cz - 1, 0, -1],
          [c.cx, c.cz + 1, 0, 1],
        ].filter(([x, z]) => maze.isWallCell(x, z));
        if (!nbWalls.length) continue;
        used.add(key);
        const [, , wx, wz] = nbWalls[(Math.random() * nbWalls.length) | 0];
        maze.cellToWorld(c.cx, c.cz, this._wc);
        const m = new THREE.Mesh(geo, bodyMat);
        m.position.set(this._wc.x + wx * cell * 0.22, CONFIG.wallHeight * 0.41, this._wc.z + wz * cell * 0.22);
        this._add(m);
        this.lockers.push({
          mesh: m,
          zone: zi,
          cell: { cx: c.cx, cz: c.cz },
          position: new THREE.Vector3(this._wc.x, CONFIG.player.eyeHeight * 0.85, this._wc.z),
          facing: Math.atan2(-wx, -wz),
        });
        placed++;
      }
    }
  }

  _buildPortals() {
    const cell = CONFIG.cellSize;
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x14101e,
      emissive: 0x7a4ae0,
      emissiveIntensity: 0.7,
      roughness: 0.5,
    });
    const mkGate = (maze, c) => {
      maze.cellToWorld(c.cx, c.cz, this._wc);
      // orient toward an adjacent wall if there is one
      const nbWalls = [
        [c.cx - 1, c.cz, -1, 0],
        [c.cx + 1, c.cz, 1, 0],
        [c.cx, c.cz - 1, 0, -1],
        [c.cx, c.cz + 1, 0, 1],
      ].filter(([x, z]) => maze.isWallCell(x, z));
      const [, , wx, wz] = nbWalls.length ? nbWalls[0] : [0, 0, 0, -1];
      const g = new THREE.Group();
      const arch = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.14, 8, 20), frameMat);
      arch.position.y = 1.3;
      const veil = new THREE.Mesh(
        new THREE.CircleGeometry(1.0, 20),
        new THREE.MeshStandardMaterial({
          color: 0x120a24,
          emissive: 0x9a5aff,
          emissiveIntensity: 0.6,
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
        })
      );
      veil.position.y = 1.3;
      g.add(arch, veil);
      g.position.set(this._wc.x + wx * cell * 0.28, 0, this._wc.z + wz * cell * 0.28);
      g.rotation.y = Math.atan2(wx, wz);
      this._add(g);
      return { group: g, veil, position: new THREE.Vector3(this._wc.x, CONFIG.player.eyeHeight, this._wc.z) };
    };

    for (const portal of this.portals) {
      const az = this.mazeAt(portal.a.zone);
      const bz = this.mazeAt(portal.b.zone);
      portal.aGate = mkGate(az, portal.a);
      portal.bGate = mkGate(bz, portal.b);
      portal.a.position = portal.aGate.position;
      portal.b.position = portal.bGate.position;
    }
  }

  _buildExit() {
    // Exit lives in the hub (zone 0) for reliability.
    const zi = 0;
    const maze = this.mazeAt(zi);
    const n = maze.size;
    const cell = CONFIG.cellSize;
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < 120; i++) {
      const c = maze.openCells[(Math.random() * maze.openCells.length) | 0];
      const nbWalls = [
        [c.cx - 1, c.cz, -1, 0],
        [c.cx + 1, c.cz, 1, 0],
        [c.cx, c.cz - 1, 0, -1],
        [c.cx, c.cz + 1, 0, 1],
      ].filter(([x, z]) => maze.isWallCell(x, z));
      if (!nbWalls.length) continue;
      const edgeDist = Math.min(c.cx, c.cz, n - 1 - c.cx, n - 1 - c.cz);
      const score = 20 - edgeDist + Math.random() * 3;
      if (score > bestScore) {
        bestScore = score;
        best = { c, w: nbWalls[0] };
      }
    }
    if (!best) best = { c: maze.randomReachableCell(), w: [0, 0, 0, -1] };

    const [, , wx, wz] = best.w;
    maze.cellToWorld(best.c.cx, best.c.cz, this._wc);
    const group = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(cell * 0.7, CONFIG.wallHeight * 0.92, 0.18),
      new THREE.MeshStandardMaterial({ map: doorTexture(), roughness: 0.9, metalness: 0.4 })
    );
    frame.position.y = CONFIG.wallHeight * 0.46;
    group.add(frame);
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(cell * 0.72, 0.12, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x330808, emissive: 0x660000, emissiveIntensity: 0.6 })
    );
    strip.position.y = CONFIG.wallHeight * 0.92;
    group.add(strip);
    group.position.set(this._wc.x + wx * cell * 0.3, 0, this._wc.z + wz * cell * 0.3);
    group.rotation.y = Math.atan2(wx, wz);
    this._add(group);

    this.exitDoor = {
      group,
      strip,
      powered: false,
      zone: zi,
      cell: { cx: best.c.cx, cz: best.c.cz },
      position: new THREE.Vector3(this._wc.x, CONFIG.player.eyeHeight, this._wc.z),
      power() {
        this.powered = true;
        strip.material.color.setHex(0x0a3a0a);
        strip.material.emissive.setHex(0x22ff44);
        strip.material.emissiveIntensity = 1.4;
      },
    };
  }

  // --- per-frame -----------------------------------------------------------
  update(dt, camera) {
    const game = this.scene.userData.game;
    this.maxLights = game?.quality?.maxLights || this.maxLights;
    const pz = game?.player?.zone ?? 0;

    // Enable only the current zone's static lights.
    for (const zl of this.zoneLights) {
      const on = zl.zone === pz;
      if (zl.ambient) zl.ambient.visible = on;
      for (const s of zl.statics) s.visible = on;
      // flicker candles/bulbs — dips are momentary, always returning to base
      if (on) {
        for (const l of zl.flicker) {
          l.intensity =
            l.userData.base * (Math.random() < 0.06 ? 0.25 + Math.random() * 0.9 : 1);
        }
      }
    }

    // Dynamic pooled lights → nearest panels on the player's zone.
    const cam = camera.position;
    const candidates = (this._candidates ||= []);
    candidates.length = 0;
    for (const p of this.panels) {
      if (p.zone !== pz) continue;
      p._d = p.pos.distanceToSquared(cam);
      candidates.push(p);
    }
    candidates.sort((a, b) => a._d - b._d);
    const scale = this.params.lightIntensityScale;
    for (let i = 0; i < this.lightPool.length; i++) {
      const l = this.lightPool[i];
      if (i < this.maxLights && i < candidates.length) {
        const p = candidates[i];
        l.position.copy(p.pos);
        l.visible = true;
        // MORE flicker: frequent dips, occasional full blackout of a panel.
        let flick = 1;
        const r = Math.random();
        if (r < 0.04) flick = 0; // dead for a frame — stutter darkness
        else if (r < 0.12) flick = 0.25 + Math.random() * 0.5;
        l.intensity = 6.5 * scale * flick;
        p.mesh.material.emissiveIntensity = 0.35 + flick * 0.9;
      } else {
        l.visible = false;
        l.intensity = 0;
      }
    }

    // Portals shimmer.
    for (const portal of this.portals) {
      const e = 0.5 + Math.sin(performance.now() * 0.003 + portal.a.zone) * 0.3;
      if (portal.aGate) portal.aGate.veil.material.emissiveIntensity = e;
      if (portal.bGate) portal.bGate.veil.material.emissiveIntensity = e;
    }
  }

  dispose(scene) {
    for (const o of this.objects) {
      scene.remove(o);
      o.traverse?.((c) => {
        if (c.geometry) c.geometry.dispose?.();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose?.());
          else c.material.dispose?.();
        }
      });
      if (o.geometry) o.geometry.dispose?.();
      if (o.material && o.material.dispose) o.material.dispose();
    }
    this.objects.length = 0;
    this.panels = [];
    this.lightPool = [];
    this.zoneLights = [];
    this.lockers = [];
    this.exitDoor = null;
  }
}
