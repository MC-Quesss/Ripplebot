---
type: place
name: rooftop_garden
bounds_x: -268..-267
bounds_z: 570..575
crop_y: 70
farmland_y: 69
confirmed: true
---

# Rooftop Garden

A 2×6 farmland strip on the roof of the [[house]], at y=69 (farmland) / y=70
(crops). Discovered 2026-07-07 by the operator while investigating unnamed
entities seen from inside the house.

## Layout

```
              -268  -267     (x)
  z=570:       F     F       Crop type 4701
  z=571:       F     F       Crop type 4701
  z=572:       F     F       Crop type 4727
  z=573:       F     F       Crop type 4727
  z=574:       F     F       Crop type 4726
  z=575:       F     F       Crop type 4726
  z=576:      grass  grass   (edge)

F = farmland (metadata=7, fully hydrated)
```

- Bordered by `grass` on x=-266 (east) and z=576 (south).
- Three modded crop types planted in 2-row bands (all metadata=3):
  - **Type 4701** (z=570–571): **soybeans**
  - **Type 4727** (z=572–573): **bellpeppers**
  - **Type 4726** (z=574–575): **parsnip**
- Below the farmland (y=68): unnamed modded blocks (types 406, 383) — probably
  the roof structure or a planter box.

## Fertilizer Worms

Two [[../creatures/fertilizer-worm|fertilizer worms]] at:
- (-267.5, 69.5, 571.5) — covers z=570–573
- (-267.5, 69.5, 574.5) — covers z=573–576

Together they provide full 3×3 coverage of the 2×6 garden (with some overlap
at z=573). Same pattern as the wheat and potato fields.

## Update — 2026-07-29 (bot stood on the roof)

Roz reached the roof for the first time, following [[../bots/operator|Quesss]] up
in follow mode. Two earlier claims are wrong:

- **The garden is 3×6, not 2×6.** `find_blocks` from the roof returned 18
  farmland tiles, all metadata=7: **x = -269, -268, -267** × **z = 570–575**.
  The x=-269 column was missed on the 2026-07-07 survey from inside the house.
  Crop-band z-ranges are unchanged; whether the x=-269 column carries the same
  three species is untested.
- **The roof grass surface extends at least to x = -264**, not just to the
  x=-266 border. Roz stood on `grass` at (-264, 69, 573) — so the walkable roof
  is wider than the garden strip, and the east edge is still unmeasured.

**The roof is bot-reachable**, and it needs no stairway, ladder, or door — there
is a **terrain ramp east of the wheat field**, climbing y 64 → 70 at
x ≈ -262..-265, z ≈ 562–572. This answers the open question below and is the
first confirmed bot visit to y=70.

**Correction, same day:** the first write-up of this credited the climb to
follow mode's [[../procedures/follow-hop-assist|hop assist]]. It did not.
Auditing every hop-assist event in that session put all of them in the western
approach to the [[igloo]], none at the ramp — and the bot later walked the same
climb **unaided** under `walk_route`, six legs in 7.6 seconds with the assist
armed and silent. The ramp is just walkable ground. Route:
[[../procedures/farm-to-igloo]].

## Open Questions

- ~~What are crop types 4701, 4727, 4726?~~ — **Identified** (user, 2026-07-07):
  soybeans, bellpeppers, parsnip.
- ~~Can the bot reach the roof?~~ — **Yes** (2026-07-29): follow mode, see Update
  above. A standalone pathfind route to the roof is still undocumented.
- How far east/north does the roof surface actually run? Confirmed walkable to
  x=-264 at z=573; edges unmeasured.
- Does the x=-269 farmland column carry the same soybean/bellpepper/parsnip bands?
- Who planted this garden? (Player-built, not bot-accessible.)
- What do these crops produce when harvested? (Now that we know the names, check
  if any are used in recipes.)

## Related

- [[house]] — the structure this garden sits on
- [[../creatures/fertilizer-worm]] — worm species present
