# Trick or Treasure

*A GRIMCO Acquisitions retrieval simulator.* 

Co-op first-person horror looting in the browser, inspired by **R.E.P.O.** and **Threshold**, with a grimy, desaturated presentation inspired by **Buckshot Roulette**. Underpaid interns descend into Hollowmere's abandoned industrial catacombs, recover cursed valuables and make quota before midnight. Fragile loot loses value when it strikes a wall; heavy coffins need two interns.

The facility has leaking pipe joints, falling droplets, puddle ripples, wet wall streaks, corroded fittings and overhead cable runs. Fluorescents sag, cut out and struggle to restart independently, while the elevator keeps a steady light. Distressed hand-painted warnings, tally marks, handprints, scratches and crumbling walls tell the story of previous crews. A low-resolution camera pass adds grain, dithering, vignette and restrained lens distortion. Exposure and reduced grain/lens effects are adjustable from the title and pause screens; the system's reduced-motion preference softens the light failures.

## Play

**Windows:** double-click `start.bat`. It opens `http://localhost:8080` using the included PowerShell server.

Any static server also works; ES modules cannot load from `file://`:

```sh
python -m http.server 8080
```

### Controls

| Action | Intern 1 | Intern 2 |
| --- | --- | --- |
| Move / turn | WASD | Arrow keys |
| Sprint | Left Shift | Right Shift |
| Use / grab / drop | E or Space | Enter |
| Flashlight | F | `/` |
| Hide / leave cover | Q | Backspace or Numpad 1 |
| Pull out / put away map | Tab | `\` or Numpad 2 |
| Stun charge | R | Numpad 4 |
| Throw decoy | G | Numpad 5 |

- Click the game for mouse look: A/D strafe, left click grabs, right click toggles the flashlight.
- Gamepads work, one per intern: B enters/leaves cover, Y opens/closes the map, LB fires a stun charge and D-pad Down throws a decoy. `M` mutes; `Esc` pauses.

With empty hands, face a nearby target and press E (Intern 2: Enter) to open a chest, disarm a trap, cut a partner out of a spider web or recover stolen loot. Chests contain valuables or limited stun charges and noise decoys; some are mimics. Stun charges stop a targeted creature for 4.5 seconds. Thrown decoys draw nearby creatures away. Tool counts appear beside each intern's controls.

Arrow plates, rising spikes and jaw traps give a click before firing. Step away or disarm them from a safe distance. A hit staggers the intern and can drop and damage carried loot; traps do not directly kill.

Rusted lockers and worktables offer hiding places on each floor. Approach the opening, set down carried loot, then use the hide key to climb inside or duck underneath. The flashlight switches off on entry. Keep it off: creatures can spot a lit occupant, remember seeing you enter, or investigate noise near your hiding place. Each spot holds one intern. Use the same key to leave.

The elevator arrow follows the available corridors back to the safe lift. Pull out the paper map to see the current floor plan, elevator route, your position and facing, your partner, and hiding spots. Each intern has their own map. Reading slows movement and prevents sprinting; the world and midnight clock keep running.

## Specimens

| Specimen | Appearance | Rule |
| --- | --- | --- |
| **01, Rattles** | Towering, tangled Lifeform | Moves only in the dark. Keep it in the flashlight. |
| **02, The Listener** | Blind humanoid deer with branching antlers | Hunts noise: sprinting, dropped loot and cracking urns. |
| **03, The Watcher** | Drifting fibrous body with hanging tendrils | Passes through walls toward flashlights. Lights off when it whispers. |
| **04, The Weaver** | Supplied textured spider with eight articulated legs | Walking underneath can web you. A partner must cut you free within nine seconds; a stun also releases you. When no free partner is alive, press the use key three times, with a short pause between presses, to struggle out. |
| **05, The Blind Seeker** | Eyeless, crawling creature with long fingers and a split maw | Wanders peacefully until crowded, lit for too long or disturbed by loud noise. Break contact for eight seconds to calm it. |
| **06, The Collector** | Scuttling thief bug | Steals small carried valuables, then flees. Get close and use E, or stun it, to recover the item intact. It cannot kill, and never steals soul jars, heavy loot or items inside the lift. |
| **07, The False Chest** | A reward chest unfolding into teeth and legs | Opening it triggers a brief transformation before it can attack. Back away, stun it or distract it. |

All seven have original procedural rigs with articulated limbs and textured surfaces. The Blind Seeker is an original rig inspired by the supplied reference; the exact Sketchfab model is not included. Optional user-supplied GLBs can replace supported specimens. See [design references and model setup](assets/models/sketchfab/README.md).

Getting caught triggers a 3D attack by that specific specimen: a short intake of breath, an articulated grab and jaw lunge, then a close struggle as the camera recoils and the torch dies. The attack uses the creature's actual model, including an optional GLB's attack clip when available. In co-op, only the caught intern's viewport changes; their partner can keep playing. Attacks follow pause/mute, end before the death screen, and clear on revival or floor changes. Reduced effects soften camera movement.

The lift is safe ground. A dead intern drops a **soul jar**; their partner can bring it to the lift to revive them.

Both interns use the supplied [Business man by PropShop](https://sketchfab.com/3d-models/business-man-3cff4eb8fe204564aea0c1d1ebef92b6), bundled as a textured 1.75m character. The supplied FBX had no skeleton or animation clips, so it now has an original 24-bone rig and smooth skin weights. Teammates see walking/running, backward and sideways movement, torch aiming, carried loot, map reading, crouching and death/revival poses. Equipment follows the hands; each player has an independent skeleton and materials. See the [model setup notes](assets/models/sketchfab/README.md) for conversion details and attribution.

The Weaver uses the actual model from the supplied `spider.zip`. Its static Blender mesh now has an articulated rig and animations for ceiling movement, web capture, feeding, release, stun and its close-up attack. The world spider and each player's jumpscare use separate skeletons, so a scare cannot change the creature visible to a teammate.

## Sound

The supplied Pixabay industrial ambience and proximity scare recordings play locally, layered with synthesized room tone, pipe movement, drips, creature breath, joint cracks and heartbeat. Visible water impacts and failing fixtures have positional drip and ballast sounds. Nearby threats change the mix, and the ambience crossfades at its loop boundary. Every jumpscare now plays the user-supplied Fesliyan Studios **Jump Scare D** recording on the creature's lunge, at its original pitch and speed. Audio starts after user interaction, retries a pending attack after asynchronous audio unlock, follows mute/pause/background suspension, and cancels when the attack clears. See [recording credits](assets/audio/README.md).

## Project layout

No build step: plain ES modules and vendored three.js, with local models, recordings and procedural textures.

| File | Purpose |
| --- | --- |
| `src/main.js` | Game loop, floor progression, death/revival, lift and split-screen rendering |
| `src/film.js` | Per-player low-resolution render targets, grading, grain and lens effects |
| `src/jumpscare.js` | Matching creature attack shots, per-player cameras and cancellable sound cues |
| `src/player.js`, `src/input.js` | Movement, flashlights, cameras and controls |
| `src/player-avatar.js` | Teammate-view humanoid poses, authored animation support and held equipment |
| `src/entities/spider-avatar.js` | Imported spider animation transitions, attack sampling and independent skeleton lifecycle |
| `src/loot.js`, `src/hud.js` | Loot handling, fragility and interface |
| `src/encounters.js`, `src/gadgets.js` | Reward/mimic chests, disarmable traps, stun charges and thrown decoys |
| `src/level.js`, `src/textures.js` | Facility generation, pathfinding, industrial details and distressed materials |
| `src/pipe-leaks.js`, `src/graffiti.js` | Animated leaks, puddles, wet decay and hand-painted wall storytelling |
| `src/hideouts.js`, `src/field-map.js` | Hiding furniture, entrances/collision, paper floor plans and elevator routes |
| `src/entities/*.js` | Specimen AI and shared behavior; `facility-creatures.js` adds spider, seeker, thief and mimic rules |
| `src/entities/creature-rigs.js`, `src/entities/facility-rigs.js` | Original animated creature geometry and matching close-up attack poses |
| `src/assets.js` | Local model loading and optional creature GLBs |
| `src/audio.js` | Recorded ambience/scares and synthesized effects |
| `src/boss.js` | GRIMCO radio lines |
| `src/config.js` | Speeds, battery, quota and floor/specimen balance |
| `src/debug.js`, `src/*-tests.js` | Browser gameplay regression checks |

To add a specimen, follow `src/entities/skeleton.js`, provide its notice, register it in `SPECIES` in `src/main.js`, and include it in `monstersForFloor()` in `src/config.js`.

## Dev tools

- `?debug` shows errors on screen.
- `?auto=1` / `?auto=2` skips the menu into a one- or two-player game. Add `&floor=3` for a deeper start and `&seed=7` for a fixed layout.
- `?test=all` runs gameplay checks; `?test=carry,heavy` selects tests. Coverage includes carrying, wall damage, heavy co-op, flashlight freeze, hearing, revival, midnight, descent, hiding/detection, independent maps, elevator navigation and per-creature jumpscares with co-op/pause/reset checks.
- Encounter checks cover chest rewards, mimic activation, trap disarming, gadgets, spider rescue, seeker provocation, recoverable theft and safe placement. Select them with `?test=encounterChestRewards,encounterMimic,encounterTraps,encounterGadgets,encounterSpider,encounterLizard,encounterThief,encounterPlacement`.
- Player checks cover independent skeletons/materials, teammate visibility, equipment, death/revival, table clearance without squashing, gait and resource cleanup. Select them with `?test=playerAvatarIndependence,playerAvatarViews,playerAvatarRecovery,playerAvatarCover,playerAvatarAttachments,playerAvatarDisposal,playerAvatarHumanoidAdapter`.
- Imported spider checks cover eight-leg skin deformation, ceiling contact, capture and attack isolation, stun recovery and shared-asset cleanup. Select them with `?test=spiderAvatarArticulation,spiderAvatarCeiling,spiderAvatarAttackIsolation,spiderAvatarLifecycle`.
- `?test=scene` stages a specimen encounter for visual inspection.

## Optional live AI boss

The radio uses local canned lines. For live Gemma responses, deploy `tools/gemma-boss-worker.js` with a Google AI Studio key and set `BOSS_AI_URL` in `src/config.js`. Failed or slow requests fall back to local lines.

## Deploy

GitHub Pages: repository **Settings > Pages > Deploy from branch > `main` / root**. Everything is static.

## Credits

- Player: [Business man](https://sketchfab.com/3d-models/business-man-3cff4eb8fe204564aea0c1d1ebef92b6) by [PropShop / syedabbas0815](https://sketchfab.com/syedabbas0815), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Converted from the supplied FBX, corrected material emission, and added an original skeleton, skin weights and gameplay poses.
- Props and fallback intern: [Kenney Graveyard Kit](https://kenney.nl/assets/graveyard-kit), CC0.
- Creature and recruitment-form references: [Sketchfab reference list](assets/models/sketchfab/README.md). The included creature geometry and recruitment-form artwork are original procedural work.
- Recordings: DRAGON-STUDIO's [Creepy Industrial Sounds Ambience](https://pixabay.com/sound-effects/musical-creepy-industrial-sounds-ambience-482892/) and [Scary Sound Effect](https://pixabay.com/sound-effects/horror-scary-sound-effect-359877/), Pixabay Content License; [local credits](assets/audio/README.md).
- Jumpscare: user-supplied **Jump Scare D**, Fesliyan Studios; [local credits](assets/audio/README.md).
- Rendering: [three.js](https://threejs.org), r169, MIT.
- Optional web fonts: Creepster and Special Elite, Google Fonts, OFL; local font fallbacks remain available.
