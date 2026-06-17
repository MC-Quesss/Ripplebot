---
type: place
name: south_fenced_area
bounds_x: -282..-274
bounds_z: 574..578
y: 64
fence_block: spruce_fence
adjacent_to: outside_orientation
confirmed: true
---

# South Fenced Area

A spruce-fenced enclosure directly south of [[outside-orientation]]. Houses 28 sheep for [[../procedures/shear-sheep]].

## Layout (verified 2026-05-14)

Block-level survey of the fence + interior:

```
       -282  -281  -280  -279  -278  -277  -276  -275  -274
z=574   F     F     F     F    [D]    F     F     F     ·    ← door at -278; gap at -274 corner
z=575   F     ·     ·     ·     ·     ·     ·     F     F    ← interior z (note: -275 is fence!)
z=576   F     ·     ·     ·     ·     ·     ·     ·     ·    ← interior z (full 7-wide)
z=577   F     ·     ·     ·     ·     ·     ·     ·     ·    ← interior z (full 7-wide)
z=578   F     F     F     F     F     F     F     F     F    ← solid south wall
```

- **North edge:** z=574 with a **wooden door** at (-278, 64, 574) — bot's canonical entrance. See [[../procedures/pen-door-traversal]].
- **East edge:** mostly fence at x=-274 z=575 and x=-275 z=575; the (-274, 64, 574) corner is open but doesn't lead anywhere walkable from outside.
- **South edge:** solid fence at z=578.
- **West edge:** solid fence at x=-282.
- Fences sit at y=64 on dirt at y=63. Walking surface inside is y=64 same as outside.

**Interior walkable area (7×3 = 21 tiles):**
- z=575: x=-281..-276 (6 tiles, since x=-275 is fence on this row)
- z=576: x=-281..-275 (7 tiles)
- z=577: x=-281..-275 (7 tiles)

## Adjacent stairs

Two sets of `spruce_stairs` flank the enclosure:

| Set | Coords | Function |
|---|---|---|
| **East stairs** | (-274, 64, 571), (-274, 64, 572), (-274, 64, 573) | Just east of [[outside-orientation]]. Three steps at y=64 — likely a lip up to the door area. |
| **West stairs** | (-284, 63, 572), (-285, 63, 572) | Two steps at y=63, **descending** from the y=64 ground level. End of the fence's north-west corner walking line — user described this as "following the fence west, you'll end up near the stairs." |

## Approach the west stairs

From [[outside-orientation]] at (-275, 64, 572):
1. Pathfind to (-282, 64, 573) range=1 — lands the bot just inside the NW fence corner area, on solid ground at y=64.
2. The west stairs at (-284..-285, 63, 572) are two tiles further west and one block down.

Confirmed safe to walk: bot reached (-282.35, 64, 573.5) without snags or damage on first attempt, HP 19→19, deaths 0.

## Why it's here — sheep pen, confirmed 2026-05-14

The pen holds **28 sheep** for [[../procedures/shear-sheep]]. Sheep stay penned by the fence and door; the bot enters via the door to shear from inside.

## Bot entry: the door at (-278, 64, 574)

A wooden door replaced the original fence gap. Same traversal pattern as the house front door — pressure-plate pads on each side, state-verified open/close. See [[../procedures/pen-door-traversal]] for the full procedure.

## Related
- [[outside-orientation]] — adjacent pad, north of the fence
- [[../items/shears]] — tool for shearing
- [[house-door]] — the fence enclosure is south of the door
