# Player model and creature references

`business-man.glb` and `spider.glb` are bundled from the user-supplied ZIP files. Other creature GLBs are optional. The game also ships original articulated creatures in `src/entities/creature-rigs.js` and `src/entities/facility-rigs.js`: a knotted Lifeform, a gaunt humanoid deer, a drifting fibrous Watcher, a fallback ceiling spider, an eyeless crawler, a thief bug and an unfolding chest mimic. Their geometry, surfaces, locomotion and close-up attack poses are generated locally, so they work offline.

The supplied visual references are:

| Reference | Filename | Use |
| --- | --- | --- |
| User-supplied `spider.zip` (`source/Spider.rar/Spider_lp.blend`) | `spider.glb` | Specimen 04, The Weaver; imported model with an original animation rig |
| [Lifeform (Bacteria)](https://sketchfab.com/3d-models/lifeform-bacteria-1a05d5790d3c413fbfe86d9492bc2209), wffefefefesfrte4t4 | `bacteria.glb` | Specimen 01, Rattles |
| [Accurate Bacteria/Lifeform v1](https://sketchfab.com/3d-models/accurate-bacterialifeform-v1-aef5178aa1224605927179f306fafc5a) | `accurate-bacteria.glb` | Alternative for Specimen 01 |
| [The Human Deer](https://sketchfab.com/3d-models/the-human-deer-7644694337404bb18eb68e6b637740a1), ceeleste | `human-deer.glb` | Specimen 02, The Listener |
| [GMOD - Bacteria Pill (Backrooms)](https://sketchfab.com/3d-models/gmod-bacteria-pill-backrooms-d73cd637ecb349b4938dfa52e1924285), dedwerd_ | `bacteria-pill.glb` | Specimen 03, The Watcher |
| [The Blind Seeker (w/animation)](https://sketchfab.com/3d-models/the-blind-seeker-wanimation-528b0b6501f54cdaa058344514a4f3e8), solkatten | `blind-seeker.glb` | Optional replacement for Specimen 05; the shipped crawler is an original reference-inspired rig |
| [Job Application](https://sketchfab.com/3d-models/job-application-9fb1bad45f2b44499608db25329904b5) | — | Original GRIMCO recruitment forms on facility walls; no downloaded plane |
| [Business man](https://sketchfab.com/3d-models/business-man-3cff4eb8fe204564aea0c1d1ebef92b6), PropShop™ (syedabbas0815), CC BY 4.0 | `business-man.glb` | Player model for both interns (falls back to the Kenney intern) |

The Blind Seeker listing's Sketchfab API reported `isDownloadable: false` on October 18, 2026. Its exact model has not been imported. The optional filename supports a GLB supplied with the creator's permission if one becomes available.

The Business man is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), credited to [PropShop / syedabbas0815](https://sketchfab.com/syedabbas0815). The user supplied its FBX and four 1024px textures on October 18, 2026. Although the listing has a rigged tag, the actual file was a static T-pose with no skeleton, weights or animation clips.

The bundled GLB preserves the original 17,308 triangles, UVs and four diffuse textures. Conversion bakes the FBX axis correction, turns off the source's white emission, and adds an original 24-bone humanoid skeleton with smooth skin weights and palm anchors. It faces +Z, with +Y up. The loader normalizes height to 1.75m and clones each player's skeleton and materials independently. `src/player-avatar.js` supplies the live skeletal poses, hand equipment and physical joint bending; animation clips are not baked into the GLB. The existing Kenney intern remains a fallback if the player asset fails to load.

The original rig and conversion are reproducible with [`tools/build-business-man.mjs`](../../../tools/build-business-man.mjs). In a browser module using Three.js r169, load the supplied FBX with `FBXLoader`, then pass that root and `GLTFExporter` to `buildBusinessManGLB`. Save the returned `binary` as `business-man.glb`; the included report checks bind-pose preservation and normalized skin weights. The game uses the bundled GLB directly and does not need the conversion tools at runtime.

An alternate glTF package can be loaded at `business-man/scene.gltf` with its relative buffer and texture paths intact. Rotation is configured by the `business-man` entry in `CUSTOM_MODELS`.

The spider comes from the user-supplied `spider.zip`, containing `source/Spider.rar` and the static `Spider_lp.blend`. The original mesh had no armature, weights or animation actions. Conversion retains its authored viewport subdivision, UVs and 1024px diffuse, roughness, normal and gloss/specular maps. The bundled mesh has 14,120 triangles and a new 33-bone skeleton: eight three-joint legs, body/head/abdomen, articulated mouthparts and a face marker. It is 0.68m tall, with +Y up and +Z forward.

Seven original clips are embedded: `idle`, `walk`, `capture`, `feeding`, `release`, `attack` and `stun`. The walk has a 0.50m/s nominal pace; playback follows actual lure movement speed. Capture and release finish before returning to their loops, and stun interrupts feeding immediately. Gameplay and each jumpscare receive independent skeletons and mixers while sharing the immutable imported geometry and textures. If the asset fails to load, the original procedural spider remains available.

[`tools/build-spider.py`](../../../tools/build-spider.py) reproduces the asset using Blender 3.6.23. Extract the inner archive and run `blender --background --factory-startup --disable-autoexec Spider_lp.blend --python tools/build-spider.py -- <inner-texture-directory> <output.glb>`. The helper creates the rig, skin weights and clips and writes a numerical audit beside the output. The game needs only the bundled GLB.

To use an available source model, obtain its GLB through Sketchfab and save it in this directory with the matching filename. Follow that listing's license and attribution requirements. Model availability and download permissions depend on the source; the game does not download Sketchfab models itself.

`bacteria.glb` takes precedence over `accurate-bacteria.glb` when both exist. Missing or invalid optional files leave the procedural rigs available. Orientation and shadow settings live in `CUSTOM_MODELS` in `src/assets.js`; specimen heights live in `src/entities/`. The AI rules remain the same with either visual.
