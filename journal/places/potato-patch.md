---
type: place
name: potato_patch
bounds_x: -287..-284
bounds_z: 576..579
crop_y: 63
approach: [-284, 63, 577]
crop_block_name: potatoes
total_observed: 27
confirmed: true
---

# Potato Patch

The potato farm, south-west of the [[wheat-field]], on the east shore of the pond. Crop block name is `potatoes` (plural, vs. `wheat` singular).

## Bounds (per `bot.js` constant `POTATO_BOUNDS`)
- x: -287 to -284
- z: 576 to 579
- y=63 for crops; no separate farmland-y observed yet (crops sit at y=63, farmland likely y=62)

## Layout after shoreline removal (2026-05-14)

User removed the x=-287 row of potato crops to keep the bot a tile away from [[water-hazard-west-of-potatoes|the pond]]. Current crop strip is **3 wide × 11 tall**, x=-286..-284, z=577..587:

```
              -287 -286 -285 -284
                (removed for safety)
z=577           ·    P    ·    ·
z=578           ·    P    P    ·
z=579           ·    P    P    P
z=580           ·    P    P    P
z=581           ·    P    P    P
z=582           ·    P    P    P
z=583           ·    P    P    P
z=584           ·    P    P    P
z=585           ·    P    P    P
z=586           ·    P    P    P
z=587           ·    P    P    P
```

31 potato blocks total. (Plus an outlier `P` at (-292, 63, 579) on the far west bank — likely an island block, not part of this patch's harvest plan.)

## Real extent (surveyed 2026-05-14, day 41330)

`find_blocks names=["potatoes"] maxDistance=12, count=100` returned **43 potato blocks** spanning **x=-292..-284, z=576..587**. After ground-truthing the geometry block-by-block, the picture is:

- **Potatoes are vanilla `potatoes` blocks at y=63**, sitting on **`farmland` at y=62**. Walking surface is the farmland top.
- The patch occupies the **east shore of an oval pond** (see [[water-hazard-west-of-potatoes]]).
- The east shore runs **x=-287..-284** (4 columns wide), **z=576..587** (12 rows tall) = **up to 48 tiles**, of which 43 currently hold mature/growing potatoes.
- Beyond x=-287, the ground drops into water (y=61..62 water, no walkable surface at y=62 or 63).
- South of z=587, the pond ends and becomes regular land again.

```
              -287  -286  -285  -284     (x)
  z=576..587:   P     P     P     P      ← 4-wide strip of potato crops
                ──────────────────────
  west of -287: water (the pond)
  z>=588:       land continues south
```

The `POTATO_BOUNDS` constant in `bot.js` (`xMin=-287, xMax=-284, zMin=576, zMax=579`) only describes the **north quarter** of the actual patch. The full patch is 3× larger.

## Water hazard

The potato patch borders an **oval pond** to the west — see [[water-hazard-west-of-potatoes]] for full bounds. Key fact: water starts at **x ≤ -288** within the relevant z-band; **the entire potato patch at x=-287..-284 is east of the water**, so the whole 48-tile shore is reachable as long as the bot does not route west of x=-287.

**User rule (2026-05-14): "stay out of the water."** Implemented by clipping every harvest+sweep sequence to `x >= -286`. The earlier z<=579 clip was based on an incomplete survey and **has been removed** — the pond is east-bounded at x=-288, not z=580.

## Approach
- Pathfind to (-284, 63, 577), range=1.
- Confirmed safe; no detour needed when arriving from [[outside-orientation]].

## Procedures
- [[../procedures/harvest-potatoes-right-click]] — right-click technique, confirmed 2026-05-14
- (Legacy) `runHarvestPotatoes` in bot.js — left-click + replant + sweep, still wired to chat for now

## Related
- [[../items/potato]]
- [[../items/baked-potato]]
- [[wheat-field]] — companion crop site
