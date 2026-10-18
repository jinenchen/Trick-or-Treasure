# Audio credits

The supplied recordings are used locally by the game:

| File | Recording | Creator | Source |
| --- | --- | --- | --- |
| `ambience.mp3` | Creepy Industrial Sounds Ambience (6:56) | DRAGON-STUDIO | [Pixabay, 482892](https://pixabay.com/sound-effects/musical-creepy-industrial-sounds-ambience-482892/) |
| `scare.mp3` | Scary Sound Effect (0:08) | DRAGON-STUDIO | [Pixabay, 359877](https://pixabay.com/sound-effects/horror-scary-sound-effect-359877/) |
| `jumpscare.mp3` | Jump Scare D | Fesliyan Studios, as identified by the supplied filename | User-provided `2021-09-24_-_Jump_Scare_D_-_www.FesliyanStudios.com.mp3` |

Source pages identify the two DRAGON-STUDIO recordings as available under the [Pixabay Content License](https://pixabay.com/service/license-summary/). Source and creator details checked October 18, 2026. The Fesliyan Studios MP3 was supplied by the user on October 18, 2026 and copied without changing its bytes; the Pixabay license statement does not apply to that file.

The long ambience streams through two alternating audio elements with a short overlap at the loop boundary. A low mechanical room tone remains underneath, and also serves as a fallback if playback or loading fails. Proximity scares use a volume envelope and cooldown.

Every monster's jumpscare uses `jumpscare.mp3` at its original pitch and speed, skipping only the leading silence so its opening hit matches the visible lunge. Its playback envelope fits the attack shot. The older `scare.mp3` remains a proximity cue. Each attack has its own cancellable sound handle; simultaneous co-op attacks remain independent, and clearing an attack stops its sound. Synthesized attack sounds are used only as a fallback when the new recording is unavailable.

Footsteps, wet drips, pipe movement, creature breath, joint cracks, heartbeat, radio noise, gadgets and mechanical UI sounds are synthesized by `src/audio.js`. Threat proximity changes the room mix. Browser audio unlock, mute, pause and background-tab suspension apply to recordings and synthesized layers. A pending jumpscare retries sound initialization if audio unlock completes asynchronously during the shot.
