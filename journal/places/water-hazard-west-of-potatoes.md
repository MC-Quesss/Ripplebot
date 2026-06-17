---
type: place
name: pond_west_of_potatoes
shape: oval
bounds_x: -292..-288
bounds_z: 580..587
y_water: 61..62
adjacent_to: potato_patch
confirmed: true
hazard: drowning_disorientation
---

# Pond — West of the Potato Patch

An **oval/circular pond** immediately west of [[potato-patch]]. **Not a wall** — land continues south past it (z ≥ 588 is walkable terrain again). The potato patch lines the entire **east shore**.

## Bounds (block-level survey, 2026-05-14)

Full y=62 map (`F` = farmland, `~` = water, `□` = dirt/grass, blank = air):

```
     -294 -293 -292 -291 -290 -289 -288 -287 -286 -285 -284 -283
z=575  □    □    □    □    □    □    □    □    □    □    □    □
z=576  F    F    F    F    F    F    F    F    □    □    □    □
z=577  F    F    F    F    F    F    F    F    F    □    □    □
z=578  F    F    F    F    F    F    F    F    F    F    □    □
z=579  F    F    F    F    F    F    F    F    F    F    F    □
z=580  F    ~    ~    ~    F    F    F    F    F    F    F    □
z=581  F    ~         ~    ~    F    F    F    F    F    F    □   ← (-291, 62, 581) is air over -291,61,581 water
z=582  F    ~    ~    ~    ~    ~    F    F    F    F    F    □
z=583  F    ~    ~    ~    ~    ~    ~    F    F    F    F    □
z=584  F    ~    ~    ~    ~    ~    ~    F    F    F    F    □
z=585  F    ~    ~    ~    ~    ~    ~    F    F    F    F    □
z=586  F    ~    ~    ~    ~    ~    ~    F    F    F    F    □
z=587  F    F    ~    ~    ~    ~    ~    F    F    F    F    □
z=588  F    F    F    F    F    ~    ~    F    F    F    F    □
z=589  F    F    F    F    F    F    F    F    F    F    F    □
z=590 grv   F    F    F    F    F    F    F    F    F    F    □
z=591 grv  grv   F    F    F    F    F    F    F    F    F    □
```

(`grv` = gravel; appears on the western edge starting at z=590.)

Pond water occupies a **lopsided oval**:
- North tip: z=580, narrow (3 columns: x=-291..-289)
- Widest at z=583..586: **6 columns wide** (x=-292..-287)
- South tip: z=588, 2 columns (x=-289..-288)
- y: 61..62 (surface is y=62)

The pond is **fully encircled by farmland** at y=62 — meaning safe walking surface surrounds it on all sides if needed in the future. The bot does not need to enter water to reach any potato tile.

## Why it matters

- Pathfinder may take shortcuts through water if it judges them faster — water is technically "walkable" but not safe (food drains, HP risk if unable to surface, drift away from intended path).
- The east shore was previously crops at x=-287 directly bordering water. **The user removed those tiles 2026-05-14** to de-risk the bot falling in. Current potato strip is x=-286..-284 (3 columns), giving a one-tile farmland buffer between the bot and the water.

## Driving rule (user-set, 2026-05-14)

**Stay out of the water.** All potato-patch routines clip the active set to:
- `x >= -286` (one tile east of the new shoreline-buffer)

The user-removed shoreline row (x=-287) means the bot never needs to stand at x=-287 to harvest — it can stand at x=-286 (one of the new edge crops) or at x=-285/-284 and still reach all targets within range=1.

## Related
- [[potato-patch]] — the work site this hazard borders
- [[../observations/_log]]
