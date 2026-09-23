// Central tunables. The difficulty profile is "brutal" per the build spec,
// with the player's requested rebalance: the flashlight is a real tool, battery
// and stamina last longer, ambient scares are rarer, and the world is a hub
// maze linked by RARE portals to many themed "places" (no floors).

export const CONFIG = {
  // --- World geometry ---
  cellSize: 4, // world units per maze cell
  wallHeight: 3.2,

  // Zones (the hub + themed places) are spread far apart along X so each has
  // its own fog/sky without the others bleeding in.
  zoneSpacingX: 800,

  // --- Renderer / atmosphere ---
  pixelRatioCap: 2,
  fogColor: 0xb9a938, // sickly yellow haze (hub default; themes override)
  fogDensityBase: 0.05,

  // --- Player ---
  player: {
    eyeHeight: 1.62,
    radius: 0.34, // collision radius against walls
    walkSpeed: 3.0,
    sprintSpeed: 5.4,
    accel: 22,
    decel: 16,
    lookSensitivity: 0.0022, // mouse
    touchLookSensitivity: 0.0038, // per px drag
    keyLookSpeed: 2.1, // rad/s for numpad look
    pitchClamp: 1.45, // radians (~83°)
    headBobAmp: 0.055,
    headBobFreq: 9.5,
    interactRange: 2.6,
  },

  // --- Stalker (BRUTAL) ---
  stalker: {
    height: 2.75, // taller, wrong
    patrolSpeed: 1.7,
    chaseSpeed: 4.5, // > player walk (3.0), < sprint (5.4)
    investigateSpeed: 2.6,
    searchSpeed: 2.2,
    hearingRadius: 16,
    losRange: 26,
    losFov: Math.PI * 0.72,
    catchRadius: 1.25,
    repathInterval: 0.55,
    searchDuration: 9,
    loseSightGrace: 1.4,
    spawnMinCellsFromPlayer: 9,
    // Flashlight is now a DEFENSIVE tool: a centered beam staggers it.
    staggerSlow: 0.32, // speed multiplier while blinded by the beam
    staggerLingerAfterHide: 7.5, // sec it waits near a hide spot before leaving
  },

  // --- Flashlight (powerful primary tool) ---
  flashlight: {
    batteryMax: 160, // big reservoir
    drainPerSec: 0.6, // very slow drain — lasts a long time
    spareRefill: 80,
    intensity: 22, // strong beam (works even in open, dark places)
    decay: 0.7, // low falloff so it carries across open ground (graveyard/field)
    angle: Math.PI / 5.0, // wide cone
    distance: 60, // reaches far
    penumbra: 0.5,
    // A soft "carried lantern" glow around the player so immediate surroundings
    // are always visible when the light is on — essential in the open dark zones.
    fillIntensity: 6,
    fillDistance: 13,
    beamHitRange: 26, // range at which a centered beam staggers a creature
    beamHitDot: 0.9,
  },

  // --- Stamina (falls slowly now) ---
  stamina: {
    max: 100,
    sprintDrain: 9, // was 24 — drops slowly
    recover: 15,
    recoverDelay: 0.6,
    exhaustedThreshold: 5,
    exhaustedRecoverTo: 28,
  },

  // --- Sanity ---
  sanity: {
    max: 100,
    darkDrain: 4.0,
    stalkerNearDrain: 9,
    stalkerVisibleBonus: 6,
    lightRecover: 3.2,
    lowThreshold: 45,
    criticalThreshold: 20,
    phantomChanceLow: 0.005,
    phantomChanceCritical: 0.018,
  },

  // --- Objectives / progression ---
  objectives: {
    baseFuses: 3,
    fusesPerLevel: 1,
    codeLength: 3,
    switchCount: 3,
    switchHoldTime: 1.1,
    switchNoiseRadius: 18,
  },

  // --- Random scare director (rarer, per player request) ---
  scares: {
    minInterval: 55, // was 20
    maxInterval: 120, // was 48
    faceChance: 0.28, // lower share are the intrusive face-flash
    lockerSlamChance: 0.6,
    doorFakeoutChance: 0.28,
  },

  // --- Zones / themed places ---
  zones: {
    portalsPerLevel: 2, // RARE doors out of the hub
    portalsPerLevelExtra: 0.5, // +1 roughly every other day
    themedGrid: 15, // themed places are smaller
    // (The place roster lives in world/themes.js — every place has NO humans.)
  },

  // --- Music (softened: no bright saws, low-passed) ---
  music: {
    padVolume: 0.05,
    pingVolume: 0.035,
    chaseVolume: 0.14,
    toneCutoff: 900, // master musical low-pass — kills the sharpness
  },

  // --- Shift mechanic ---
  shift: {
    intervalBase: 26,
    intervalJitter: 10,
    noclipChance: 0.5,
    reshapeFraction: 0.16,
    minCellsFromPlayerToReshape: 3,
  },

  // --- Audio ---
  audio: {
    masterVolume: 0.9,
  },

  debug: false,
};

// Per-level scaling — each escaped level ramps difficulty.
export function levelParams(day) {
  const d = Math.max(1, day);
  const grid = Math.min(24 + (d - 1) * 4, 44);
  const fuses = CONFIG.objectives.baseFuses + (d - 1) * CONFIG.objectives.fusesPerLevel;
  return {
    day: d,
    gridSize: grid,
    fuses,
    portals: CONFIG.zones.portalsPerLevel + Math.floor((d - 1) * CONFIG.zones.portalsPerLevelExtra),
    creatures: Math.min(2 + Math.floor((d - 1) / 2), 4), // 2 hunters day 1, up to 4
    switches: CONFIG.objectives.switchCount + Math.floor((d - 1) / 2),
    stalkerChaseSpeed: CONFIG.stalker.chaseSpeed + (d - 1) * 0.28,
    stalkerHearingRadius: CONFIG.stalker.hearingRadius + (d - 1) * 1.5,
    stalkerLosRange: CONFIG.stalker.losRange + (d - 1) * 1.5,
    fogDensity: Math.min(CONFIG.fogDensityBase + (d - 1) * 0.004, 0.09),
    lightIntensityScale: Math.max(1 - (d - 1) * 0.08, 0.45),
    shiftInterval: Math.max(CONFIG.shift.intervalBase - (d - 1) * 2, 12),
  };
}
