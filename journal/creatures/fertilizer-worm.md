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

## Open questions

- ~~Growth-stripe prediction (rows z=554/558/562 under-fertilized)~~ —
  **RETRACTED same day**: those rows are lily-pad walkways, not farmland; there
  is no wheat there to lag. Coverage is complete by design.
- Does the potato field have its own worm grid? (Unchecked.)
- Can slow circling be detected at all from entity packets (finer than the
  0.5-precision positions `nearby_entities` reports), e.g. 60s multi-sample
  variance?
- Are these the same mod family as the fertilizer bins (block 3995 /
  companion 1458) from the [[../observations/_log|fertilizer bins incident]]?

## Related

- [[../observations/_log]] — 2026-07-07 lattice observation + identification
- [[../places/wheat-field]] (if/when noted) — worm grid coordinates above
