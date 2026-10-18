# Audio credits

The two supplied recordings are used locally by the game:

| File | Recording | Creator | Source |
| --- | --- | --- | --- |
| `ambience.mp3` | Creepy Industrial Sounds Ambience (6:56) | DRAGON-STUDIO | [Pixabay, 482892](https://pixabay.com/sound-effects/musical-creepy-industrial-sounds-ambience-482892/) |
| `scare.mp3` | Scary Sound Effect (0:08) | DRAGON-STUDIO | [Pixabay, 359877](https://pixabay.com/sound-effects/horror-scary-sound-effect-359877/) |

Source pages identify both recordings as available under the [Pixabay Content License](https://pixabay.com/service/license-summary/). Source and creator details checked October 18, 2026. The existing MP3 files were retained during the horror atmosphere update.

The long ambience streams through two alternating audio elements with a short overlap at the loop boundary. A low mechanical room tone remains underneath, and also serves as a fallback if playback or loading fails. Proximity scares use a volume envelope and cooldown.

Jumpscares decode `scare.mp3`, locate its strongest impact section and play a 1.35-second excerpt on the visible lunge. Species-specific synthesized sounds add bacteria rattles, seeker/deer growls, spider clicks, mimic creaks and Watcher breath. Each attack has its own cancellable sound handle; simultaneous co-op attacks remain independent, and clearing an attack stops its sounds and reverb. Synthesized attack sounds remain available if the recording fails to load.

Footsteps, wet drips, pipe movement, creature breath, joint cracks, heartbeat, radio noise, gadgets and mechanical UI sounds are synthesized by `src/audio.js`. Threat proximity changes the room mix. Browser audio unlock, mute, pause and background-tab suspension apply to recordings and synthesized layers. A pending jumpscare retries sound initialization if audio unlock completes asynchronously during the shot.
