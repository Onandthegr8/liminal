import { Game } from './core/Game.js';

// Entry point: wire the canvas + app container into the Game and start it.
const canvas = document.getElementById('game-canvas');
const app = document.getElementById('app');

const game = new Game(canvas, app);

// Expose for debugging in the console.
window.__LIMINAL__ = game;
