# Creature references and optional models

No Sketchfab GLBs are bundled. The game ships original articulated creatures in `src/entities/creature-rigs.js` and `src/entities/facility-rigs.js`: a knotted Lifeform, a gaunt humanoid deer, a drifting fibrous Watcher, a ceiling spider, an eyeless crawler, a thief bug and an unfolding chest mimic. Their geometry, surfaces, locomotion and close-up attack poses are generated locally, so they work offline.

The supplied visual references are:

| Reference | Optional filename | Use |
| --- | --- | --- |
| [Lifeform (Bacteria)](https://sketchfab.com/3d-models/lifeform-bacteria-1a05d5790d3c413fbfe86d9492bc2209), wffefefefesfrte4t4 | `bacteria.glb` | Specimen 01, Rattles |
| [Accurate Bacteria/Lifeform v1](https://sketchfab.com/3d-models/accurate-bacterialifeform-v1-aef5178aa1224605927179f306fafc5a) | `accurate-bacteria.glb` | Alternative for Specimen 01 |
| [The Human Deer](https://sketchfab.com/3d-models/the-human-deer-7644694337404bb18eb68e6b637740a1), ceeleste | `human-deer.glb` | Specimen 02, The Listener |
| [GMOD - Bacteria Pill (Backrooms)](https://sketchfab.com/3d-models/gmod-bacteria-pill-backrooms-d73cd637ecb349b4938dfa52e1924285), dedwerd_ | `bacteria-pill.glb` | Specimen 03, The Watcher |
| [The Blind Seeker (w/animation)](https://sketchfab.com/3d-models/the-blind-seeker-wanimation-528b0b6501f54cdaa058344514a4f3e8), solkatten | `blind-seeker.glb` | Optional replacement for Specimen 05; the shipped crawler is an original reference-inspired rig |
| [Job Application](https://sketchfab.com/3d-models/job-application-9fb1bad45f2b44499608db25329904b5) | — | Original GRIMCO recruitment forms on facility walls; no downloaded plane |
| [Business man](https://sketchfab.com/3d-models/business-man-3cff4eb8fe204564aea0c1d1ebef92b6), PropShop™ (syedabbas0815), CC BY 4.0 | `business-man.glb` | Player model for both interns (falls back to the Kenney intern) |

The Blind Seeker listing's Sketchfab API reported `isDownloadable: false` on October 18, 2026. Its exact model has not been imported. The optional filename supports a GLB supplied with the creator's permission if one becomes available.

To use an available source model, obtain its GLB through Sketchfab and save it in this directory with the matching filename. Follow that listing's license and attribution requirements. Model availability and download permissions depend on the source; the game does not download Sketchfab models itself.

`bacteria.glb` takes precedence over `accurate-bacteria.glb` when both exist. Missing or invalid optional files leave the procedural rigs available. Orientation and shadow settings live in `CUSTOM_MODELS` in `src/assets.js`; specimen heights live in `src/entities/`. The AI rules remain the same with either visual.
