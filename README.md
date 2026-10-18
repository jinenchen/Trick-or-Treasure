# 🎃 Trick or Treasure

*A GRIMCO Acquisitions retrieval simulator.* Hack the Six Octoberfest, Best Halloween Hack entry.

Co-op 3D horror looting in the browser, inspired by **R.E.P.O.** (haul fragile loot to make quota) and **Threshold** (descend into a creepy facility, survive entities with learnable rules).

You and a friend are underpaid interns sent into the **Hollowmere Catacombs** on Halloween night. Find cursed valuables in the dark, carry them to the **lift**, and hit the quota before **midnight**. Loot cracks when it hits walls, and every crack costs money. Heavy coffins take two interns. Each floor down is worse.

## Play

**Windows:** double-click `start.bat`. It starts a tiny local server and opens `http://localhost:8080`.

Any other static server works too (ES modules don't load from `file://`):
```
python -m http.server 8080      # or: npx serve .
```

### Controls
| | Intern 1 | Intern 2 |
|---|---|---|
| Move / turn | WASD | Arrow keys |
| Sprint | Left Shift | Right Shift |
| Grab / drop | E (or Space) | Enter |
| Flashlight | F | `/` |

- Solo: click the game for mouse look (A/D strafe, left click grab, right click light).
- Gamepads work (one per intern). `M` mutes, `Esc` pauses.

## The specimens
| | Rule |
|---|---|
| **01 "Rattles"** (skeleton) | Only moves in the dark. Keep it in your flashlight. |
| **02 "The Listener"** (zombie) | Blind, hunts noise: sprinting, dropped loot, cracking urns. |
| **03 "The Watcher"** (ghost) | Drifts through walls toward flashlights. Lights off when it whispers. |

The lift is safe ground. When an intern dies, their **soul jar** drops, and their partner can carry it to the lift to revive them.

## Project layout
No build step: plain ES modules + three.js (vendored in `lib/` so it works offline).

| File | What it does | Owner |
|---|---|---|
| `src/main.js` | Game loop, floor flow, grab/deposit, death, lift, split-screen render | Aiden |
| `src/player.js` | Movement, flashlight/battery, stamina, 3rd-person camera | Aiden |
| `src/loot.js` | Loot table, carrying, fragility, heavy co-op carry | Aiden |
| `src/input.js` | Two players on one keyboard, mouse, gamepads | Aiden |
| `src/hud.js` | HUD overlay | Aiden |
| `src/level.js` | Procedural catacombs, collision, pathfinding, decor | Partner |
| `src/entities/*.js` | One file per specimen (`base.js` = shared AI) | Partner |
| `src/audio.js` | Procedural WebAudio sound (no audio files) | Partner |
| `src/textures.js` | Procedural wall/floor textures | Partner |
| `src/boss.js` | GRIMCO HQ radio lines | either |
| `src/config.js` | **Balance knobs** (speeds, battery, quota, which monsters per floor) | either |

**Adding a specimen:** copy `src/entities/skeleton.js`, give it a `static notice`, register it in `SPECIES` in `src/main.js`, add it to `monstersForFloor()` in `src/config.js`.

## Dev tools
- `?debug` shows errors on screen.
- `?auto=1` / `?auto=2` skips the menu straight into a 1P/2P game. Add `&floor=3` to start deeper, `&seed=7` for a fixed layout.
- `?test=all` (or `?test=carry,heavy,...`) runs gameplay tests in the page: carry, wall damage, heavy co-op, skeleton freeze, listener, death + soul jar revive, midnight, descend.

## Optional: live AI boss (Gemma)
The boss radio uses canned lines. To make it live, deploy `tools/gemma-boss-worker.js` as a Cloudflare Worker with a Google AI Studio key (instructions at the top of that file) and paste its URL into `BOSS_AI_URL` in `src/config.js`. If the AI is slow or down, the game falls back to canned lines.

## Deploy
GitHub Pages: repo **Settings → Pages → Deploy from branch → `main` / root**. Everything is static.

## Credits
- 3D models: [Kenney Graveyard Kit](https://kenney.nl/assets/graveyard-kit) (CC0)
- Rendering: [three.js](https://threejs.org) r169 (MIT)
- Fonts: Creepster, Special Elite (Google Fonts, OFL)
