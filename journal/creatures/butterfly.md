---
type: creature
name: butterfly
hostile: false
confirmed: true
---

# Butterfly

Modded ambient insect, **empty entity name** over protocol like all modded mobs.

## Behavior observed (2026-06-12, entity id 110269009 near the house)

- Drifts slowly: ~1–1.5 blocks horizontal per 7s sample (vs a [[squirrel]]'s
  13+ block darts).
- Flutters vertically: y wandered 65 → 66.4 → 65.3 → 65 across samples.
- Flies 1–2 blocks above ground — air directly under feet.
- May rest motionless for long stretches (several of the stationary empty-name
  entities around the house at block-centered coords are probably resting
  butterflies).

## Detection

`classifyUnknownEntity` (bot.js ~1540) labels a moving unknown a butterfly when
any of: y > bot+2, vertical wobble ≥0.5 between samples, or air under feet.
Gets its own expressive kind (`butterfly`, 300s cooldown) — the bot remarks on
them distinctly from squirrels since 2026-06-11. First confirmed in-game
butterfly comment: 2026-06-12T01:30Z.
