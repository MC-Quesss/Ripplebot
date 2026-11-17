---
type: item
name: note-block
confirmed: true
---

# Note block

A vanilla note block plays **only when the block directly above it is air**. Any block above silences it, including furniture like a shelf, which is easy to miss. Solved 2026-11-17 for a player whose note block sat under a shelf. Moving the shelf fixed it.

Not the cause, checked the same day:
- Our server resource pack. It has no `sounds.json` and only swaps disc songs (see [[music-records]]).

Other things that silence a note block, if this comes up again:
- The client's **Note Blocks** volume slider (Music & Sounds).
- A **Computronics iron note block** looks similar but plays only when a computer drives it.

## Instruments (1.12.2): set by the block underneath

| Block below | Instrument |
|---|---|
| Wood material (planks, logs, most wooden furniture) | Bass |
| Rock material (stone, cobble, bricks, ores, netherrack) | Bass drum |
| Sand material (sand, gravel, concrete powder) | Snare drum |
| Glass material (glass, glowstone, sea lantern) | Clicks / sticks |
| Block of gold | Bells |
| Clay block | Flute |
| Packed ice | Chime |
| Wool | Guitar |
| Bone block | Xylophone |
| Anything else | Harp |

Wood, rock, sand and glass are chosen by *material*, so modded blocks follow their mod's material. Gold, clay, packed ice, wool and bone are matched by block name. Two octaves (F♯ to F♯), one step per right-click. The 1.14 instruments (iron xylophone, cow bell, didgeridoo, bit, banjo, pling) don't exist in 1.12. From general game knowledge, not yet tested in this world (`confirmed` above covers the air-above rule only).

See [[../observations/_log|session log]] 2026-11-17.
