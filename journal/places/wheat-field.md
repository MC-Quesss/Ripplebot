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

## Procedures
- [[../procedures/right-click-harvest]]
- [[../procedures/nautilus-sweep-pattern]]
