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

## Update — 2026-09-29 (replanted)

From inside the house, Roz saw the two stationary unnamed entities again and
didn't recognise them. They are still the fertilizer worms at the same two spots,
so check this note before calling something a new mystery. A butterfly in the
room was the unnamed entity that moved; the worms never moved in 10 s of sampling.

The garden has been **replanted**. A `block_at` survey of y=70 over the 3×6
farmland found none of the July crop types (4701/4727/4726):

```
              -269  -268  -267   (x)
  z=570:      1535   .    1535
  z=571:       .     .     .
  z=572:      1535   .    1535
  z=573:       .     .     .
  z=574:       .    1540   .
  z=575:       .    1540   .
```

All six are metadata=3 and have no name. Quesss says the roof now holds
**wooden stakes, tomatoes and grapes**, all modded farm blocks. The type→crop
mapping is unconfirmed: the four 1535s in a square could be stakes or grapes,
and the two 1540s could be tomatoes. Also untested: whether the blocks at y=71
(stakes grow tall) show more.

## Solar panels (2026-09-29)

A 2×2 of **type 253, metadata 1**, set flush into the roof surface at **y=69**,
**x=-265..-264 × z=574..575**, just east of the grape trellis. Quesss identified
them from standing on top. They are the **power source for the [[house]]** (the
"hobbit home"). They mainly run the **macerator**, which turns potatoes and
wheat into chaff for the bio-diesel engine in Oceanside. That connects the
farm's harvests, fed in through the [[house-hopper]], to the [[biodiesel-pipe-north|bio-diesel]] chain: the crops are
fuel as well as food.

Scattered **type 3855** (metadata 0) blocks sit singly around the roof at
(-269,70,576), (-266,70,573), (-265,70,578), (-263,69,571), (-262,69,576),
(-261,71,573). **Probably clover** (Quesss, 2026-09-29): low clover patches you can walk straight through, and more of them dot the hillside south of the house at (-274,66,577), (-274,66,583), (-270,67,579), (-266,67,582) and (-276,68,579). Not pinned down: the block under Quesss's feet on a clover read grass/air, not 3855, and two 3855s read air beneath them. So either the probe missed or 3855 isn't the clover. Walk-through fits the global zero-collision rule for empty-name blocks.

## Open Questions

- ~~Which of types 1535 / 1540 is tomato, grape or stake?~~ **Type 1535 = tomato**
  (Quesss stood next to the northmost one, 2026-09-29). Every tomato is **two blocks
  tall**: 1535 at both y=70 and y=71, which fits a staked plant. Quesss confirmed the z=572 row
  as tomatoes too, so all four 1535s are tomato. **Type 1540 = grape**
  (confirmed: Quesss stood at the z=574–575 pair). The grapes are planted as two
  adjacent rows, while the tomatoes are spaced a row apart. Grape is also two tall,
  but its top is a *different* block: **type 1541** (metadata 0) at y=71. A tomato
  is one type all the way up. What 1541 is exactly (trellis? vine top?) is still open.

  **Grape trellis, mapped (2026-09-29).** Quesss: 6 stakes, with 4 grapes hanging
  between them. The first survey only covered x=-269..-267, which missed the outer
  stakes. The wider survey (z=574–575 rows, identical):

  ```
        x:  -270      -269       -268      -267       -266
  y=71:     1539    1541 m10   1541 m0   1541 m10    1539
  y=70:     1534      air      1540 m3     air       1534
  ```

  - **Stakes** = 6, at x=-270, -268 and -266 on both rows. The outer ones are
    1534 (base) + 1539 (top). The middle stakes are 1540, the grape plant/root,
    which is metadata 3 like every crop here.
  - **1541** is the vine along the top. The **metadata-10** blocks at x=-269/-267
    are the 4 hanging grapes, and the metadata-0 one sits over the root stake.
    **Growth stage verified (2026-09-29):** Quesss picked the four ripe grapes while a watcher polled the blocks. Each went **metadata 10 → 2** at the moment it was picked; the type stayed 1541 and the root-stake vine blocks stayed at 0. So **10 = ripe**, **2 = picked (fruit stalk regrowing)**, and 0 = vine with no fruit position. Quesss expects a few growth stages before ripe again, like wheat, so watch for 2 → … → 10 over the next days. **Regrowth check (day 53903, Roz walked up herself):** all four read **10 (ripe) again**, 5 game days after the picking on day 53898 (most nights were skipped). The intermediate stages weren't observed; a daily check would catch them.
  - Tomatoes are **three** tall (1535 at y=70–72), not two. The y=72 check came later.
  - Type 3855 at (-269,70,576) and (-266,70,573) is unidentified.

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
