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

## Open Questions

- ~~What are crop types 4701, 4727, 4726?~~ — **Identified** (user, 2026-07-07):
  soybeans, bellpeppers, parsnip.
- Can the bot reach the roof? No stairway or ladder path is documented.
- Who planted this garden? (Player-built, not bot-accessible.)
- What do these crops produce when harvested? (Now that we know the names, check
  if any are used in recipes.)

## Related

- [[house]] — the structure this garden sits on
- [[../creatures/fertilizer-worm]] — worm species present
