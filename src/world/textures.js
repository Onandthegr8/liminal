import * as THREE from 'three';

// All textures are drawn procedurally onto <canvas> — no external image files.
// Cached so every wall/floor/ceiling shares one GPU texture.

function makeCanvas(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// Cheap value-noise splatter used to grime things up.
function splatterNoise(ctx, size, count, alpha, colorFn) {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 2 + 0.4;
    ctx.fillStyle = colorFn();
    ctx.globalAlpha = Math.random() * alpha;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

let _wall, _carpet, _ceiling, _panel, _door;

// Generic cached texture factory: draw once, wrap, sRGB.
const _cache = {};
function cachedTexture(key, draw, { size = 256, repeatWrap = true } = {}) {
  if (_cache[key]) return _cache[key];
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  if (repeatWrap) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _cache[key] = tex;
  return tex;
}

function fill(ctx, size, color) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
}

// --- themed textures (hospital, garden, graveyard, sewage, office, church, hotel, field) ---

export const whiteTileTexture = () =>
  cachedTexture('whiteTile', (ctx, s) => {
    fill(ctx, s, '#dfe4e2');
    ctx.strokeStyle = 'rgba(120,140,138,0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= s; i += s / 4) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke();
    }
    splatterNoise(ctx, s, 300, 0.12, () => '#9aa8a4');
  });

export const grassTexture = () =>
  cachedTexture('grass', (ctx, s) => {
    fill(ctx, s, '#3f5a26');
    for (let i = 0; i < 6000; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      ctx.strokeStyle = `rgba(${40 + Math.random() * 50},${70 + Math.random() * 70},${20 + Math.random() * 30},0.5)`;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.random() * 2 - 1, y - 1 - Math.random() * 2); ctx.stroke();
    }
  });

export const hedgeTexture = () =>
  cachedTexture('hedge', (ctx, s) => {
    fill(ctx, s, '#22401c');
    splatterNoise(ctx, s, 5000, 0.5, () => (Math.random() > 0.5 ? '#2f5a26' : '#16300f'));
  });

export const concreteTexture = () =>
  cachedTexture('concrete', (ctx, s) => {
    fill(ctx, s, '#4a4d4a');
    splatterNoise(ctx, s, 1200, 0.2, () => (Math.random() > 0.5 ? '#3a3d3a' : '#585b58'));
    ctx.strokeStyle = 'rgba(20,22,20,0.4)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * s, 0);
      ctx.lineTo(Math.random() * s, s);
      ctx.stroke();
    }
  });

export const brickTexture = () =>
  cachedTexture('brick', (ctx, s) => {
    fill(ctx, s, '#5a3a2a');
    const bh = s / 8;
    ctx.strokeStyle = 'rgba(20,14,10,0.6)';
    ctx.lineWidth = 2;
    for (let r = 0; r < 8; r++) {
      const y = r * bh;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke();
      const off = (r % 2) * (s / 8);
      for (let x = off; x < s; x += s / 4) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + bh); ctx.stroke();
      }
    }
    splatterNoise(ctx, s, 500, 0.15, () => '#3a251a');
  });

export const fabricTexture = () =>
  cachedTexture('fabric', (ctx, s) => {
    fill(ctx, s, '#6d6f66');
    for (let y = 0; y < s; y += 2) {
      ctx.fillStyle = `rgba(0,0,0,${0.03 + (y % 4 === 0 ? 0.03 : 0)})`;
      ctx.fillRect(0, y, s, 1);
    }
    splatterNoise(ctx, s, 400, 0.1, () => '#565850');
  });

export const stoneTexture = () =>
  cachedTexture('stone', (ctx, s) => {
    fill(ctx, s, '#6b6459');
    ctx.strokeStyle = 'rgba(30,26,20,0.5)';
    ctx.lineWidth = 2;
    for (let r = 0; r < 5; r++) {
      const y = (r * s) / 5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke();
      const off = (r % 2) * (s / 6);
      for (let x = off; x < s; x += s / 3) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (Math.random() * 6 - 3), y + s / 5); ctx.stroke();
      }
    }
    splatterNoise(ctx, s, 700, 0.18, () => (Math.random() > 0.5 ? '#5a5348' : '#7d766a'));
  });

export const hotelWallpaperTexture = () =>
  cachedTexture('hotelWall', (ctx, s) => {
    fill(ctx, s, '#5a2222');
    // damask-ish vertical stripes + faded motifs
    for (let x = 0; x < s; x += s / 8) {
      ctx.fillStyle = 'rgba(120,80,40,0.25)';
      ctx.fillRect(x, 0, s / 16, s);
    }
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = 'rgba(150,110,60,0.2)';
      ctx.beginPath();
      ctx.arc(Math.random() * s, Math.random() * s, 5 + Math.random() * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    splatterNoise(ctx, s, 500, 0.25, () => '#3a1414');
  });

export const carpetPatternTexture = () =>
  cachedTexture('hotelCarpet', (ctx, s) => {
    fill(ctx, s, '#6a1f1f');
    ctx.strokeStyle = 'rgba(180,140,60,0.35)';
    ctx.lineWidth = 3;
    for (let i = -s; i < s; i += s / 6) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + s, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i + s, 0); ctx.lineTo(i, s); ctx.stroke();
    }
    splatterNoise(ctx, s, 800, 0.2, () => '#4a1414');
  });

export const officeCarpetTexture = () =>
  cachedTexture('officeCarpet', (ctx, s) => {
    fill(ctx, s, '#4b5560');
    splatterNoise(ctx, s, 6000, 0.15, () => (Math.random() > 0.5 ? '#3e4750' : '#586470'));
  });

export const dirtTexture = () =>
  cachedTexture('dirt', (ctx, s) => {
    fill(ctx, s, '#4a3a28');
    splatterNoise(ctx, s, 3000, 0.25, () => (Math.random() > 0.5 ? '#3a2c1c' : '#5a4632'));
  });

// The iconic mono-yellow wallpaper: vertical seams + faint grime.
export function wallpaperTexture() {
  if (_wall) return _wall;
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c9b83f';
  ctx.fillRect(0, 0, size, size);

  // subtle vertical tonal banding
  for (let x = 0; x < size; x += 4) {
    const t = Math.sin(x * 0.14) * 0.5 + 0.5;
    ctx.fillStyle = `rgba(120,105,30,${0.05 + t * 0.05})`;
    ctx.fillRect(x, 0, 2, size);
  }
  // seams every ~64px
  for (let x = 0; x <= size; x += 64) {
    ctx.fillStyle = 'rgba(90,78,20,0.35)';
    ctx.fillRect(x - 1, 0, 2, size);
  }
  // grime near the floor
  const grad = ctx.createLinearGradient(0, size * 0.65, 0, size);
  grad.addColorStop(0, 'rgba(60,50,15,0)');
  grad.addColorStop(1, 'rgba(40,32,8,0.45)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  splatterNoise(ctx, size, 500, 0.25, () => '#6e5c1a');

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _wall = tex;
  return tex;
}

// Damp mustard low-pile carpet.
export function carpetTexture() {
  if (_carpet) return _carpet;
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8a7a2a';
  ctx.fillRect(0, 0, size, size);
  // low-pile fiber noise
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const l = Math.random() * 0.25;
    ctx.strokeStyle = `rgba(${40 + Math.random() * 60},${35 + Math.random() * 50},${10 + Math.random() * 20},${0.25})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.random() * 2 - 1, y + Math.random() * 2 - 1);
    ctx.stroke();
    void l;
  }
  // damp patches
  splatterNoise(ctx, size, 40, 0.3, () => '#3c3410');
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _carpet = tex;
  return tex;
}

// White acoustic ceiling tiles with a grid.
export function ceilingTexture() {
  if (_ceiling) return _ceiling;
  const size = 256;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c8c6ba';
  ctx.fillRect(0, 0, size, size);
  splatterNoise(ctx, size, 1200, 0.12, () => '#8f8d80');
  // tile grid
  ctx.strokeStyle = 'rgba(70,68,60,0.5)';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, size - 4, size - 4);
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  _ceiling = tex;
  return tex;
}

// Emissive fluorescent panel face.
export function panelTexture() {
  if (_panel) return _panel;
  const size = 128;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fffdf0';
  ctx.fillRect(0, 0, size, size);
  const grad = ctx.createLinearGradient(0, 0, size, 0);
  grad.addColorStop(0, 'rgba(220,210,170,0.6)');
  grad.addColorStop(0.5, 'rgba(255,255,240,0)');
  grad.addColorStop(1, 'rgba(220,210,170,0.6)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _panel = tex;
  return tex;
}

// Rusty metal exit-door face.
export function doorTexture() {
  if (_door) return _door;
  const size = 128;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a3320';
  ctx.fillRect(0, 0, size, size);
  splatterNoise(ctx, size, 400, 0.4, () => (Math.random() > 0.5 ? '#5a4a20' : '#241d0e'));
  ctx.strokeStyle = 'rgba(20,16,8,0.6)';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, size - 12, size - 12);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _door = tex;
  return tex;
}
