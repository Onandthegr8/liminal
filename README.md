# LIMINAL

### ▶ [**Play it now — liminal-tau.vercel.app**](https://liminal-tau.vercel.app/)

No install, no download. Works in any modern desktop or mobile browser.

A first-person survival-horror web game — the Backrooms crossed with Granny.
Complete a different task each day (fuses, a hidden keypad code, loud breaker
switches), power the exit, and escape a **multi-floor** maze that rearranges
itself behind your back — while something tall and relentless hunts you by
sight and sound across the floors. Strange violet doors lead **somewhere
else**: a flooded pool hall, a desert with no sun, a corridor that eats your
mind. One build, runs on desktop **and** mobile browsers.

Built with Vite + Three.js (vanilla JS). All textures, all music and all
sound effects are procedural — there are no asset files.

## Run locally

```bash
npm install
npm run dev
```

Open the printed `http://localhost:5173` URL. Click the canvas to lock the
mouse.

**Desktop controls:** WASD move · mouse look · SPACE (or SHIFT) sprint ·
E interact (hold E to grab fuses / flip breakers) · F flashlight · ESC pause.

**Numpad controls:** 8 forward · 2 back · 4/6 (or 7/9) turn to look ·
Enter interact · + flashlight · − pause. Top-row number keys (or the on-screen
pad) type the code into the exit keypad on code days.

The **flashlight is your best weapon** — shine it in a creature's face to
stagger it and buy time to escape. Its battery lasts a long time; green
batteries top it up.

## Play on your phone

The dev server already listens on your LAN (`host: true`):

```bash
npm run dev
```

Look for the **Network** URL Vite prints (e.g. `http://192.168.1.5:5173`) and
open it in your phone's browser — phone and PC must be on the same Wi-Fi.
If your network blocks device-to-device traffic, tunnel it instead:

```bash
npx ngrok http 5173
```

**Touch controls:** left thumb — movement joystick (appears where you touch)
· right thumb — drag to look · on-screen buttons for sprint / interact /
flashlight. Tap PLAY to enable audio (browser requirement).

## Build for production

```bash
npm run build
```

The static site lands in `dist/` — host it anywhere (Vercel, GitHub Pages,
itch.io, Netlify…). Paths are relative (`base: './'`), so subdirectories work.
Preview the production build locally with `npm run preview`.

## Deploy

Live at **<https://liminal-tau.vercel.app/>**.

The game is a pure static bundle: no server, no database, no API calls, no
environment variables. Whatever `npm run build` emits is the whole site.

Vercel builds straight from this repo — `vercel.json` pins the Vite preset,
`npm run build`, and `dist/` as the output, and fingerprinted files under
`/assets/` get a one-year immutable cache. Every push to `main` redeploys;
pull requests get their own preview URL.

One hosting caveat: the game uses **Pointer Lock** for mouse look, which
browsers only grant to a top-level document in a secure context. Served
directly over HTTPS (as on Vercel) it works. If you embed the game in an
`<iframe>`, that frame needs `allow="pointer-lock; fullscreen"` or mouse
look will fail.

## How to survive (briefly)

The full guide is in-game under **ⓘ HOW TO SURVIVE**.

- **One task per day**, chosen at random: pull fuses, find the code digits
  and punch them into the exit keypad (a wrong code screams your location),
  or flip every breaker — each flip is loud on purpose.
- **Sprinting is loud.** It hears you from far away — even through the floor.
  Glowing shafts are stairs; the exit may be on another floor.
- **The flashlight beam provokes it.** And the battery drains fast — pick up
  the green spare batteries.
- **Hide in lockers** to break a chase; hold interact to steady your
  breathing. If it saw you go in, it may slam the door.
- **Darkness eats your mind.** Low sanity brings whispers and things that
  aren't there. Stand under the fluorescents (or swim) to recover.
- **Don't trust your map memory.** Sections you aren't looking at rearrange.
  If the lights cut out for a moment, the maze just changed. The violet
  doors go somewhere else entirely — and never bring you back to where you
  left.
- Each escape descends to a bigger, dimmer, faster day with more floors. It
  does not stop hunting.

## Project layout

```
src/
  core/      game loop & state machine, unified input, event bus, tunables
  world/     maze generation + shift mechanic, level geometry, canvas textures
  player/    first-person controller, collision, hiding
  entities/  the Stalker (A* + PATROL/INVESTIGATE/CHASE/SEARCH)
  systems/   flashlight, stamina, sanity, objectives, Web-Audio synth, quality
  ui/        HUD and menu/pause/death/win screens
```

Difficulty tunables live in `src/core/config.js` (currently set to the
"brutal" profile). Per-level scaling is `levelParams()` in the same file.
