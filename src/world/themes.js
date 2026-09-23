import * as THREE from 'three';
import {
  wallpaperTexture,
  carpetTexture,
  ceilingTexture,
  whiteTileTexture,
  grassTexture,
  hedgeTexture,
  concreteTexture,
  brickTexture,
  fabricTexture,
  stoneTexture,
  hotelWallpaperTexture,
  carpetPatternTexture,
  officeCarpetTexture,
  dirtTexture,
} from './textures.js';

export const HUB_THEME = 'backrooms';

// Small helpers for prop building. `ctx.add(mesh)` registers + adds to scene;
// `ctx.spots(n)` returns up to n random open-cell world positions.
function box(w, h, d, color, opts = {}) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0.1 })
  );
}
function cyl(rt, rb, h, color, seg = 10) {
  return new THREE.Mesh(
    new THREE.CylinderGeometry(rt, rb, h, seg),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 })
  );
}

// Each theme: fog + background + lighting model + materials + sparse props.
// lightMode: 'panels' | 'sun' | 'moon' | 'bulbs' | 'candles' | 'sconces'.
export const THEMES = {
  backrooms: {
    name: 'The Backrooms',
    fog: 0xb9a938, fogMul: 1, background: 0x151206,
    hasCeiling: true, openness: 'normal', lightMode: 'panels',
    ambient: { color: 0xffe9a8, intensity: 0.16 },
    sanityMod: 0, lit: false,
    wall: { tex: wallpaperTexture, tints: [0xffffff, 0xf2e7c8, 0xd8c98e, 0xc7b878] },
    floor: { tex: carpetTexture, repeat: 1 },
    ceil: { tex: ceilingTexture, repeat: 1 },
    decorate() {},
  },

  hospital: {
    name: 'The Empty Hospital',
    fog: 0x243033, fogMul: 0.85, background: 0x0a1214,
    hasCeiling: true, openness: 'normal', lightMode: 'panels',
    ambient: { color: 0x9fc4cc, intensity: 0.14 },
    sanityMod: -1.5, lit: false,
    wall: { tex: whiteTileTexture, tints: [0xffffff, 0xdfeceb, 0xc8d6d4] },
    floor: { tex: whiteTileTexture, repeat: 1 },
    ceil: { tex: ceilingTexture, repeat: 1 },
    decorate(ctx) {
      for (const p of ctx.spots(5)) {
        const bed = box(0.9, 0.5, 2.0, 0x9fb0b4, { metal: 0.3 });
        bed.position.set(p.x, 0.5, p.z);
        const mat = box(0.85, 0.14, 1.9, 0xdfe4e2);
        mat.position.set(p.x, 0.82, p.z);
        const iv = cyl(0.03, 0.03, 1.7, 0x8a9497);
        iv.position.set(p.x + 0.7, 0.85, p.z);
        ctx.add(bed); ctx.add(mat); ctx.add(iv);
      }
    },
  },

  garden: {
    name: 'The Beautiful Garden',
    fog: 0x9fbf7a, fogMul: 0.5, background: 0x8fb7d8,
    hasCeiling: false, openness: 'open', lightMode: 'sun',
    ambient: { color: 0xcfe8b0, intensity: 0.7 },
    sanityMod: +5, lit: true,
    wall: { tex: hedgeTexture, tints: [0xffffff, 0xcfe0b0, 0xa8c890], heightMul: 0.7 },
    floor: { tex: grassTexture, repeat: 2 },
    decorate(ctx) {
      for (const p of ctx.spots(4)) {
        const trunk = cyl(0.16, 0.22, 2.2, 0x5a3f22);
        trunk.position.set(p.x, 1.1, p.z);
        const canopy = new THREE.Mesh(
          new THREE.SphereGeometry(1.3, 10, 8),
          new THREE.MeshStandardMaterial({ color: 0x3f7a2e, roughness: 1 })
        );
        canopy.position.set(p.x, 2.8, p.z);
        canopy.scale.y = 0.8;
        ctx.add(trunk); ctx.add(canopy);
      }
      for (const p of ctx.spots(3)) {
        const bed = box(1.2, 0.3, 1.2, 0x5a3f22);
        bed.position.set(p.x, 0.15, p.z);
        const flowers = box(1.0, 0.25, 1.0, [0xdd5599, 0xffcc33, 0xcc55dd][(Math.random() * 3) | 0]);
        flowers.position.set(p.x, 0.4, p.z);
        ctx.add(bed); ctx.add(flowers);
      }
    },
  },

  graveyard: {
    name: 'The Graveyard',
    fog: 0x2a2f38, fogMul: 0.8, background: 0x080a12,
    hasCeiling: false, openness: 'open', lightMode: 'moon',
    ambient: { color: 0x6a7aa0, intensity: 0.34 },
    sanityMod: -3, lit: false,
    wall: { tex: stoneTexture, tints: [0x8a8a8a, 0x6a6a6a, 0x545454], heightMul: 0.55 },
    floor: { tex: dirtTexture, repeat: 2 },
    decorate(ctx) {
      for (const p of ctx.spots(8)) {
        const stone = box(0.7, 1.0 + Math.random() * 0.4, 0.16, 0x777169);
        stone.position.set(p.x, 0.55, p.z);
        stone.rotation.z = (Math.random() - 0.5) * 0.25; // leaning, wrong
        ctx.add(stone);
      }
      for (const p of ctx.spots(3)) {
        const tree = cyl(0.12, 0.2, 3.0, 0x2a2018);
        tree.position.set(p.x, 1.5, p.z);
        tree.rotation.z = (Math.random() - 0.5) * 0.2;
        ctx.add(tree);
      }
    },
  },

  sewage: {
    name: 'The Underground Sewage',
    fog: 0x1c211f, fogMul: 1.1, background: 0x060807,
    hasCeiling: true, openness: 'normal', lightMode: 'bulbs',
    ambient: { color: 0x3c463c, intensity: 0.2 },
    sanityMod: -2, lit: false,
    wall: { tex: brickTexture, tints: [0xffffff, 0xcab0a0, 0x8a7060] },
    floor: { tex: concreteTexture, repeat: 1 },
    ceil: { tex: concreteTexture, repeat: 1 },
    decorate(ctx) {
      for (const p of ctx.spots(6)) {
        const pipe = cyl(0.22, 0.22, 3.0, 0x555a52, 8);
        pipe.rotation.z = Math.PI / 2;
        pipe.position.set(p.x, 2.5, p.z);
        const valve = cyl(0.25, 0.25, 0.1, 0x6a5a3a, 8);
        valve.position.set(p.x, 1.4, p.z);
        ctx.add(pipe); ctx.add(valve);
      }
    },
  },

  office: {
    name: 'The Abandoned Office',
    fog: 0x2a2c26, fogMul: 0.95, background: 0x0c0d0a,
    hasCeiling: true, openness: 'normal', lightMode: 'panels',
    ambient: { color: 0xbfc4b0, intensity: 0.14 },
    sanityMod: -1, lit: false,
    wall: { tex: fabricTexture, tints: [0xffffff, 0xd8d8c8, 0xb8bca8] },
    floor: { tex: officeCarpetTexture, repeat: 1 },
    ceil: { tex: ceilingTexture, repeat: 1 },
    decorate(ctx) {
      for (const p of ctx.spots(6)) {
        const desk = box(1.4, 0.75, 0.8, 0x6a5a44);
        desk.position.set(p.x, 0.75, p.z);
        const monitor = box(0.5, 0.35, 0.08, 0x111111, { metal: 0.4 });
        monitor.position.set(p.x, 1.15, p.z - 0.2);
        const chair = box(0.5, 0.5, 0.5, 0x222222);
        chair.position.set(p.x, 0.4, p.z + 0.7);
        ctx.add(desk); ctx.add(monitor); ctx.add(chair);
      }
    },
  },

  church: {
    name: 'The Abandoned Church',
    fog: 0x24201a, fogMul: 0.8, background: 0x0a0806,
    hasCeiling: true, openness: 'normal', lightMode: 'candles',
    ambient: { color: 0x74582f, intensity: 0.2 },
    sanityMod: -1.5, lit: false,
    wall: { tex: stoneTexture, tints: [0x9a8f7a, 0x7a7060, 0x60584a], heightMul: 1.15 },
    floor: { tex: stoneTexture, repeat: 1 },
    ceil: { tex: stoneTexture, repeat: 1 },
    decorate(ctx) {
      for (const p of ctx.spots(8)) {
        const pew = box(1.6, 0.5, 0.4, 0x4a3620);
        pew.position.set(p.x, 0.45, p.z);
        ctx.add(pew);
      }
      const alt = ctx.spots(1)[0];
      if (alt) {
        const cross = box(0.2, 1.6, 0.2, 0x2a2018);
        cross.position.set(alt.x, 2.2, alt.z);
        const bar = box(0.9, 0.2, 0.2, 0x2a2018);
        bar.position.set(alt.x, 2.5, alt.z);
        ctx.add(cross); ctx.add(bar);
      }
    },
  },

  hotel: {
    name: 'The Terror Hotel',
    fog: 0x2a1414, fogMul: 1, background: 0x0c0505,
    hasCeiling: true, openness: 'normal', lightMode: 'sconces',
    ambient: { color: 0x8a4a3a, intensity: 0.18 },
    sanityMod: -2.5, lit: false,
    wall: { tex: hotelWallpaperTexture, tints: [0xffffff, 0xcc8888, 0x9a5a5a] },
    floor: { tex: carpetPatternTexture, repeat: 1 },
    ceil: { tex: ceilingTexture, repeat: 1 },
    decorate(ctx) {
      for (const p of ctx.spots(6)) {
        // room doors set into the walls
        const door = box(0.05, 2.1, 0.9, 0x3a2018);
        door.position.set(p.x, 1.05, p.z);
        const knob = cyl(0.05, 0.05, 0.05, 0xc0a040, 6);
        knob.rotation.z = Math.PI / 2;
        knob.position.set(p.x + 0.1, 1.0, p.z + 0.3);
        ctx.add(door); ctx.add(knob);
      }
    },
  },

  field: {
    name: 'The Open Field',
    fog: 0x8a94a0, fogMul: 0.45, background: 0x6a7f9a,
    hasCeiling: false, openness: 'open', lightMode: 'moon',
    ambient: { color: 0x8090a8, intensity: 0.4 },
    sanityMod: 0, lit: true,
    wall: { tex: hedgeTexture, tints: [0x6a7a4a, 0x556238], heightMul: 0.35 },
    floor: { tex: grassTexture, repeat: 3 },
    decorate(ctx) {
      for (const p of ctx.spots(10)) {
        // tufts of tall grass
        const tuft = new THREE.Mesh(
          new THREE.ConeGeometry(0.3, 1.0, 5),
          new THREE.MeshStandardMaterial({ color: 0x4a5a2a, roughness: 1 })
        );
        tuft.position.set(p.x, 0.5, p.z);
        ctx.add(tuft);
      }
      const t = ctx.spots(1)[0];
      if (t) {
        const trunk = cyl(0.2, 0.3, 3.5, 0x3a2a1a);
        trunk.position.set(t.x, 1.75, t.z);
        const canopy = new THREE.Mesh(
          new THREE.SphereGeometry(1.8, 10, 8),
          new THREE.MeshStandardMaterial({ color: 0x2f4a22, roughness: 1 })
        );
        canopy.position.set(t.x, 4.0, t.z);
        ctx.add(trunk); ctx.add(canopy);
      }
    },
  },
};

export function getTheme(key) {
  return THEMES[key] || THEMES.backrooms;
}

// Pick N distinct themed place keys for a day's portals.
export function pickPlaces(n) {
  const pool = Object.keys(THEMES).filter((k) => k !== HUB_THEME);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
}
