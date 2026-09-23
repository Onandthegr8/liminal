import { defineConfig } from 'vite';

// base: './' keeps asset paths relative so the production build can be hosted
// from any subdirectory (itch.io, GitHub Pages project sites, etc.).
export default defineConfig({
  base: './',
  server: {
    host: true, // allow `npm run dev` to be reached from a phone on the same LAN
    port: Number(process.env.PORT) || 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
