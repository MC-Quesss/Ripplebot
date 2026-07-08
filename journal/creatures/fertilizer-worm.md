---
type: creature
name: fertilizer_worm
hostile: false
confirmed: false
---

# Fertilizer Worm

Identified by the user (2026-07-07) after the wheat-field "lattice" observation:
the 12 immobile empty-name entities gridded through the wheat field are **worms,
placed by players, that fertilize a 3×3 patch of farmland each**. The worm walks
slow circles around its center block and stands about **0.5 blocks high** —
matching the observed y≈63.5 on farmland at y=63.

## Observed placement (wheat field, day 46399) — layout confirmed by user

Centers at x ∈ {-285.5, -282.5, -279.5}, z ∈ {552.5, 556.5, 560.5, 564.5} —
x-spacing 3 (3×3 zones tile edge-to-edge). The z-spacing of 4 is **three
farmland rows + one lily-pad walking lane** (user diagram, 2026-07-07):

```
xxxxxxxxx   x = fertilized farmland
xwxxwxxwx   w = fertilized block with worm
xxxxxxxxx
LLLLLLLLL   L = lily-pad lane (walkway, no crops)
```

Verified live: wheat histogram = 12 rows × 9 tiles, zero wheat at exactly
z=554/558/562. **Every farmland tile is inside exactly one worm's 3×3 — full
coverage, no overlap.** Full field map in [[../places/wheat-field]].

## Why the bot misclassified them

`classifyUnknownEntity` (bot.js) requires ≥1.5 blocks of movement between
watcher samples to count as wildlife; a worm circling its center block never
nets that in a 7s window, so the classifier files worms as "decoration/not
alive." **They are alive — at a timescale the sampling can't see.** Lesson for
observation procedures: transience thresholds embed assumptions about speed.

## Update 2026-07-07 — potato field AND rooftop garden confirmed (operator survey)

**The potato field DOES have its own worm grid.** At least 14 worms at y=62.5
(farmland at y=62), covering a much larger area than the documented
`POTATO_BOUNDS`. The grid has two clusters:

- **Western cluster**: x ∈ {-285.5, -283.5}, z ∈ {580.5, 583.5, 586.5, 589.5}
  (x-spacing 2, z-spacing 3). First row at z=577.5 shifted west to
  x ∈ {-286.5, -284.5}.
- **Eastern column**: x = -280.5, z ∈ {581.5, 584.5, 586.5, 588.5} (spacing
  varies: 3, 2, 2 — possibly incomplete scan).

Unlike the wheat field's perfect 3×4 grid, the potato worm layout is
**asymmetric** — possibly because the patch is irregularly shaped along the
pond shoreline, or because the farmland extends further east (to x=-280) than
previously documented.

**Rooftop garden**: 2 worms at (-267.5, 69.5, 571.5) and (-267.5, 69.5, 574.5)
fertilize a 2×6 farmland strip on top of the [[../places/house|house]] at y=69.
Three unknown modded crop types (block IDs 4701, 4727, 4726) grow there.
See [[../places/rooftop-garden]].

## Open questions

- ~~Growth-stripe prediction (rows z=554/558/562 under-fertilized)~~ —
  **RETRACTED same day**: those rows are lily-pad walkways, not farmland; there
  is no wheat there to lag. Coverage is complete by design.
- ~~Does the potato field have its own worm grid?~~ — **YES**, confirmed
  2026-07-07. At least 14 worms; layout above.
- Can slow circling be detected at all from entity packets (finer than the
  0.5-precision positions `nearby_entities` reports), e.g. 60s multi-sample
  variance?
- Are these the same mod family as the fertilizer bins (block 3995 /
  companion 1458) from the [[../observations/_log|fertilizer bins incident]]?
- What are rooftop crop types 4701/4727/4726? Mod identity unknown.
- Are there more potato worms further south (z>589) or at x=-288.5 (west
  edge)?

## Related

- [[../observations/_log]] — 2026-07-07 lattice observation + identification
- [[../places/wheat-field]] — wheat worm grid coordinates
- [[../places/rooftop-garden]] — rooftop garden worm pair + unknown crops
- [[../places/potato-patch]] — potato field (farmland extends beyond documented bounds)
