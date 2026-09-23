import * as THREE from 'three';
import { CONFIG } from '../core/config.js';

// Procedural grid maze with a "backrooms" feel: mostly open rooms joined by
// openings, scattered pillars and irregular wall stubs — NOT tight corridors.
// Full connectivity is guaranteed. Exposes helpers for AI/collision and the
// signature `shift()` that rearranges only cells the player isn't looking at.
//
// grid[z][x] : 1 = wall, 0 = open. Border is always wall.
export class Maze {
  constructor(size, opts = {}) {
    this.size = size;
    this.cellSize = CONFIG.cellSize;
    // World-space origin so multiple mazes (zones) can live far apart in X/Z.
    this.originX = opts.originX || 0;
    this.originZ = opts.originZ || 0;
    // "open" mazes (fields, gardens) have far fewer interior walls.
    this.openness = opts.openness || 'normal';
    this._tmpDir = new THREE.Vector3();
    this._generate();
  }

  // --- generation ----------------------------------------------------------
  _generate() {
    const n = this.size;
    const g = [];
    for (let z = 0; z < n; z++) {
      g[z] = new Array(n).fill(0);
      for (let x = 0; x < n; x++) {
        if (x === 0 || z === 0 || x === n - 1 || z === n - 1) g[z][x] = 1;
      }
    }
    this.grid = g;

    const open = this.openness === 'open';
    const pillarChance = open ? 0.02 : 0.055;
    const stubMul = open ? 0.5 : 1.4;

    // Scatter single-cell pillars.
    for (let z = 2; z < n - 2; z++) {
      for (let x = 2; x < n - 2; x++) {
        if (Math.random() < pillarChance) g[z][x] = 1;
      }
    }

    // Irregular wall stubs (with a random gap so rooms stay connected-ish).
    const stubs = Math.floor(n * stubMul);
    for (let i = 0; i < stubs; i++) {
      const horiz = Math.random() < 0.5;
      let x = 1 + Math.floor(Math.random() * (n - 2));
      let z = 1 + Math.floor(Math.random() * (n - 2));
      const len = 2 + Math.floor(Math.random() * 4);
      const gap = Math.floor(Math.random() * len);
      for (let k = 0; k < len; k++) {
        if (k === gap) continue; // leave a doorway
        const cx = horiz ? Math.min(x + k, n - 2) : x;
        const cz = horiz ? z : Math.min(z + k, n - 2);
        if (cx > 0 && cz > 0 && cx < n - 1 && cz < n - 1) g[cz][cx] = 1;
      }
    }

    this._connectAll();
    this._rebuildOpenList();
  }

  _rebuildOpenList() {
    const n = this.size;
    const open = [];
    for (let z = 1; z < n - 1; z++) {
      for (let x = 1; x < n - 1; x++) {
        if (this.grid[z][x] === 0) open.push({ cx: x, cz: z });
      }
    }
    this.openCells = open;
  }

  // Flood-fill label of open-cell connected components (4-connectivity).
  _label() {
    const n = this.size;
    const labels = [];
    for (let z = 0; z < n; z++) labels[z] = new Array(n).fill(-1);
    let count = 0;
    const stack = [];
    for (let z = 1; z < n - 1; z++) {
      for (let x = 1; x < n - 1; x++) {
        if (this.grid[z][x] !== 0 || labels[z][x] !== -1) continue;
        const id = count++;
        stack.length = 0;
        stack.push([x, z]);
        labels[z][x] = id;
        while (stack.length) {
          const [cx, cz] = stack.pop();
          const nb = [[cx - 1, cz], [cx + 1, cz], [cx, cz - 1], [cx, cz + 1]];
          for (const [nx, nz] of nb) {
            if (nx < 1 || nz < 1 || nx >= n - 1 || nz >= n - 1) continue;
            if (this.grid[nz][nx] === 0 && labels[nz][nx] === -1) {
              labels[nz][nx] = id;
              stack.push([nx, nz]);
            }
          }
        }
      }
    }
    return { labels, count };
  }

  // Open interior walls that bridge distinct components until everything is one.
  _connectAll() {
    const n = this.size;
    let guard = 0;
    while (guard++ < 4000) {
      const { labels, count } = this._label();
      if (count <= 1) break;
      let opened = false;
      for (let z = 1; z < n - 1 && !opened; z++) {
        for (let x = 1; x < n - 1 && !opened; x++) {
          if (this.grid[z][x] !== 1) continue;
          const nb = [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]];
          const seen = new Set();
          for (const [nx, nz] of nb) {
            const l = labels[nz]?.[nx];
            if (l !== undefined && l >= 0) seen.add(l);
          }
          if (seen.size >= 2) {
            this.grid[z][x] = 0;
            opened = true;
          }
        }
      }
      if (!opened) break;
    }
  }

  // --- queries -------------------------------------------------------------
  inBounds(cx, cz) {
    return cx >= 0 && cz >= 0 && cx < this.size && cz < this.size;
  }

  isWallCell(cx, cz) {
    if (!this.inBounds(cx, cz)) return true;
    return this.grid[cz][cx] === 1;
  }

  cellToWorld(cx, cz, out = { x: 0, z: 0 }) {
    out.x = this.originX + (cx + 0.5) * this.cellSize;
    out.z = this.originZ + (cz + 0.5) * this.cellSize;
    return out;
  }

  worldToCell(x, z) {
    return {
      cx: Math.floor((x - this.originX) / this.cellSize),
      cz: Math.floor((z - this.originZ) / this.cellSize),
    };
  }

  isWall(worldX, worldZ) {
    const cx = Math.floor((worldX - this.originX) / this.cellSize);
    const cz = Math.floor((worldZ - this.originZ) / this.cellSize);
    return this.isWallCell(cx, cz);
  }

  // Force a cell open (used to align portals / clear spawn areas).
  carveOpen(cx, cz) {
    if (cx <= 0 || cz <= 0 || cx >= this.size - 1 || cz >= this.size - 1) return;
    this.grid[cz][cx] = 0;
    this._connectAll();
    this._rebuildOpenList();
  }

  randomReachableCell() {
    const list = this.openCells;
    return { ...list[(Math.random() * list.length) | 0] };
  }

  randomReachableCellFar(from, minCells) {
    let best = null;
    let bestD = -1;
    // Sample a bunch; keep the farthest that clears the threshold.
    for (let i = 0; i < 60; i++) {
      const c = this.openCells[(Math.random() * this.openCells.length) | 0];
      const d = Math.abs(c.cx - from.cx) + Math.abs(c.cz - from.cz);
      if (d >= minCells) return { ...c };
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
    return { ...(best || this.randomReachableCell()) };
  }

  // World-space line-of-sight (used by AI + sanity). Samples the segment.
  lineOfSightClear(ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.hypot(dx, dz);
    const step = this.cellSize * 0.3;
    const steps = Math.ceil(dist / step);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isWall(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  neighbors(cx, cz) {
    const out = [];
    const cand = [[cx - 1, cz], [cx + 1, cz], [cx, cz - 1], [cx, cz + 1]];
    for (const [nx, nz] of cand) {
      if (!this.isWallCell(nx, nz)) out.push({ cx: nx, cz: nz });
    }
    return out;
  }

  // --- A* pathfinding (cell -> cell) ---------------------------------------
  findPath(start, goal) {
    if (this.isWallCell(goal.cx, goal.cz)) return null;
    const n = this.size;
    const key = (c) => c.cz * n + c.cx;
    const goalK = key(goal);
    const came = new Map();
    const gScore = new Map();
    const h = (c) => Math.abs(c.cx - goal.cx) + Math.abs(c.cz - goal.cz);

    // Binary min-heap on f — this is the hottest AI path (several creatures
    // repathing on short timers), so no linear scans.
    const heap = [];
    const push = (node) => {
      heap.push(node);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p].f <= heap[i].f) break;
        const t = heap[p];
        heap[p] = heap[i];
        heap[i] = t;
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let s = i;
          if (l < heap.length && heap[l].f < heap[s].f) s = l;
          if (r < heap.length && heap[r].f < heap[s].f) s = r;
          if (s === i) break;
          const t = heap[s];
          heap[s] = heap[i];
          heap[i] = t;
          i = s;
        }
      }
      return top;
    };

    const startK = key(start);
    gScore.set(startK, 0);
    push({ cx: start.cx, cz: start.cz, k: startK, g: 0, f: h(start) });

    let guard = 0;
    const maxNodes = n * n * 4;
    while (heap.length && guard++ < maxNodes) {
      const current = pop();
      // Stale heap entry (a better g was found after this was pushed) — skip.
      if (current.g > (gScore.get(current.k) ?? Infinity)) continue;
      if (current.k === goalK) {
        const path = [{ cx: goal.cx, cz: goal.cz }];
        let ck = goalK;
        while (came.has(ck)) {
          ck = came.get(ck);
          path.push({ cx: ck % n, cz: Math.floor(ck / n) });
        }
        path.reverse();
        return path;
      }
      for (const nb of this.neighbors(current.cx, current.cz)) {
        const nk = key(nb);
        const tentative = current.g + 1;
        if (tentative < (gScore.get(nk) ?? Infinity)) {
          came.set(nk, current.k);
          gScore.set(nk, tentative);
          push({ cx: nb.cx, cz: nb.cz, k: nk, g: tentative, f: tentative + h(nb) });
        }
      }
    }
    return null;
  }

  // --- the SHIFT mechanic --------------------------------------------------
  // Rearrange interior cells the player is NOT looking at (and not near),
  // never sealing protected cells or the player, keeping full connectivity.
  // `camera` may be null (a floor the player isn't on — everything is unseen)
  // and `playerCell` may be null (player isn't on this floor).
  shift(playerCell, protectedCells, camera) {
    const n = this.size;
    let viewer = null;
    if (camera) {
      camera.getWorldDirection(this._tmpDir);
      viewer = {
        x: camera.position.x,
        z: camera.position.z,
        fx: this._tmpDir.x,
        fz: this._tmpDir.z,
      };
      const flen = Math.hypot(viewer.fx, viewer.fz) || 1;
      viewer.fx /= flen;
      viewer.fz /= flen;
    }

    const protectedSet = new Set(protectedCells.map((c) => c.cz * n + c.cx));
    const minAway = CONFIG.shift.minCellsFromPlayerToReshape;
    const wc = { x: 0, z: 0 };

    const isVisible = (cx, cz) => {
      if (!viewer) return false;
      this.cellToWorld(cx, cz, wc);
      const dx = wc.x - viewer.x;
      const dz = wc.z - viewer.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d > 24) return false;
      const dot = (dx / d) * viewer.fx + (dz / d) * viewer.fz;
      if (dot < 0.35) return false; // behind / to the side => not "looked at"
      return this.lineOfSightClear(viewer.x, viewer.z, wc.x, wc.z);
    };

    const eligible = [];
    for (let z = 2; z < n - 2; z++) {
      for (let x = 2; x < n - 2; x++) {
        const k = z * n + x;
        if (protectedSet.has(k)) continue;
        if (playerCell && Math.abs(x - playerCell.cx) + Math.abs(z - playerCell.cz) < minAway)
          continue;
        if (isVisible(x, z)) continue;
        eligible.push({ cx: x, cz: z });
      }
    }

    const count = Math.floor(eligible.length * CONFIG.shift.reshapeFraction);
    const changed = [];
    for (let i = 0; i < count; i++) {
      const e = eligible[(Math.random() * eligible.length) | 0];
      const before = this.grid[e.cz][e.cx];
      // Toggle toward walls ~45% of the time, else open (keeps rooms breathable).
      const next = Math.random() < 0.45 ? 1 : 0;
      if (next !== before) {
        this.grid[e.cz][e.cx] = next;
        changed.push(e);
      }
    }

    // Never seal the player or protected cells.
    if (playerCell && this.inBounds(playerCell.cx, playerCell.cz)) {
      this.grid[playerCell.cz][playerCell.cx] = 0;
    }
    for (const c of protectedCells) if (this.inBounds(c.cx, c.cz)) this.grid[c.cz][c.cx] = 0;

    this._connectAll();
    this._rebuildOpenList();
    return changed;
  }
}
