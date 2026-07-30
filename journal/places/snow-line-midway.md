---
type: place
name: snow_line_midway
coords: (-281, 68, 750)
confirmed: true
---

# Snow Line — Midway Point (farm → igloo)

The biome boundary about halfway along the walk from the [[house|farm]] to the
[[igloo]], and the most useful landmark on the route because the bot can
*detect* it rather than dead-reckon to it.

First reached 2026-07-29, following [[../bots/operator|Quesss]] south from the
[[rooftop-garden|house roof]].

## Signature

- Standing position: (-280.7, 68, 750.5)
- **`snow_layer` at y=68 in every direction probed out to 24 blocks**, sitting
  on `grass` at y=67.
- No water, sand, gravel, ice, or packed ice within 24 blocks — so at this point
  the [[ice-castle]] is not yet in scan range.

Because the snow is continuous here, `find_blocks` for `snow_layer` is a
reliable "am I in the cold biome yet?" test — worth more than a coordinate
check, since it survives small navigational drift.

## Position on the route

- ~180 blocks of straight-line travel from the roof trailhead, ~233 blocks
  walked (wander ratio 1.30x).
- The route to here is an **L, not a diagonal**: a due-south run holding
  x ≈ -254..-270 while z climbs 575 → 750, and only then a westward hook.
- At this point the [[ice-castle]] (-381, 66, 760) is nearly at the same
  latitude but still ~100 blocks west.

## Related

- [[house]] — origin
- [[rooftop-garden]] — the trailhead; the route begins on the roof
- [[ice-castle]] — ~100 blocks west of here
- [[igloo]] — destination, near the ice castle but not the ice castle
- [[../procedures/farm-to-igloo]] — the route procedure being built from
  repeated traced walks
