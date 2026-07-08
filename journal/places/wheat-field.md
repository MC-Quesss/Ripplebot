---
type: place
name: wheat_field
bounds_x: -287..-279
bounds_z: 559..565
crop_y: 64
farmland_y: 63
total_squares: 54
confirmed: true
---

# Wheat Field

The work site. Lies west and slightly south of [[house]]. Crop blocks at y=64, farmland at y=63.

## Bounds
- x: -287 to -279
- z: 559 to 565
- 54 farmland squares total

## Halves
- **North half:** z = 559..561 (3 rows, 27 tiles)
- **Lily pad row:** z = 562 (water covered in lily pads, crossable at any x)
- **South half:** z = 563..565 (3 rows, 27 tiles)


## Update 2026-07-07 — worm fertilization layout (user diagram, verified live)

The full field (both fire-duty fields, z=551..565) is built as **four bands of
three farmland rows**, each band fertilized by a row of
[[../creatures/fertilizer-worm|fertilizer worms]] down its middle, with
**lily-pad walking lanes between bands**:

```
z=551..553  band 1 — worm row at z≈552 (worms at x -285.5, -282.5, -279.5)
z=554       LILY LANE
z=555..557  band 2 — worm row at z≈556
z=558       LILY LANE
z=559..561  band 3 — worm row at z≈560
z=562       LILY LANE (the long-known north/south channel)
z=563..565  band 4 — worm row at z≈564
```

Each worm fertilizes the 3×3 centered on its block; worms sit every 3 blocks
along their row, so **every farmland tile is inside exactly one worm's zone** —
full coverage, no overlap. Verified live: wheat histogram shows 12 rows × 9
tiles = 108, with zero wheat at exactly z=554/558/562. This is also why bot.js
patches **lily-pad solidity** in the pathfinder Movements: the lanes are the
service walkways.

## Update 2026-05-14
Previously documented south half as z=562..565 (4 rows). In reality z=562 is a lily pad/water channel separating the two halves — not farmland, not wheat. Both halves are 3×9 = 27 tiles each.

## Waypoints
- [[field-center]] — (-283, 64, 562)
- [[field-east-approach]] — (-278, 64, 567), detour past the [[tree-west-of-door|tree]]

## Sweep — full coverage of harvested half

**Canonical rule (2026-05-14 onward):** sweep **every tile of the half you harvested.** Not 8 sample points — every farmland tile. Drops the bot didn't pick up during activation can be anywhere within the harvested area, and the 8-point sample misses some.

- **South half harvested?** Walk all 27 tiles in z=563..565 × x=-287..-279.
- **North half harvested?** Walk all 27 tiles in z=559..561 × x=-287..-279.
- **Full field?** Walk all 54.
- **Did NOT harvest a half?** Don't sweep it — drops only exist where wheat was broken.

The path is a **continuous boustrophedon** across both halves: north starts east→west, alternates per row, then continues directly into the south half without resetting direction. After the north half's last row ends on the west side (x=-287), the south half begins on the west side too — Roz hops south across the lily pads instead of backtracking east ("carriage return" eliminated 2026-05-14).

## Sweep points — DEPRECATED 8-sample method

Old approach kept here for history. The 8-sample sweep was used pre-2026-05-14; it underperformed full coverage in the right-click-harvest run on 2026-05-14, missing 4 seeds at (-287, 564) that the full sweep recovered. **Use full coverage instead.**

```
(-279, 64, 559)  (-283, 64, 559)  (-287, 64, 559)
(-287, 64, 562)  (-283, 64, 562)  (-279, 64, 562)
(-279, 64, 565)  (-283, 64, 565)  (-287, 64, 565)
```

## Related
- [[wheat-field-north]] — second wheat field directly north, separated by grass at z=558

## Procedures
- [[../procedures/right-click-harvest]]
- [[../procedures/nautilus-sweep-pattern]]
