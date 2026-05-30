---
type: place
name: house_bed
confirmed: true
---

# House Beds

A row of **three beds** along the north side of the house interior, all at y=65 with their
head block at z=569 and approached from z=570 (one tile south). Auto-sleep
([[../procedures/exit-house]] sibling logic in `tryAutoSleep`) tries them **in order** and
takes the first one it can actually enter, so an occupied bed falls through to the next.

| Order | Label | Bed block | Approach | Code constants |
|---|---|---|---|---|
| 1 | primary | (-268, 65, 569) | (-268, 65, 570) | `BED_POS` / `BED_APPROACH` |
| 2 | left | (-269, 65, 569) | (-269, 65, 570) | `BED_POS_LEFT` / `BED_APPROACH_LEFT` |
| 3 | right | (-267, 65, 569) | (-267, 65, 570) | `BED_POS_RIGHT` / `BED_APPROACH_RIGHT` |

"Left" and "right" are relative to Roz approaching from z=570 facing north (-z).

## Fallback order (auto-sleep)

The `BEDS` array is iterated top-to-bottom; the bot pathfinds to each approach, right-clicks
the bed, and waits ~1s to confirm `isSleeping`. If a bed is occupied (another player) it
moves to the next. Wired identically in two places: `tryAutoSleep` and the bake-time
"bedtime during furnace wait" handler.

## Update 2026-05-30 — third bed added

User placed a **third bed to the right** of the original two, at (-267, 65, 569). Added as
the third fallback (`BED_POS_RIGHT` / `BED_APPROACH_RIGHT`) in both `BEDS` arrays. Its
approach tile (-267, 65, 570) is the same standing tile as the kitchen-chest approach
([[../chests/house-kitchen-chest]]) — no conflict, just a shared spot.

## Related
- [[../chests/house-kitchen-chest]] — immediately east of the right bed
- [[house-center]] / [[orientation-blocks]]
