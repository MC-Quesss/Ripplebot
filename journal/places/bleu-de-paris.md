---
type: place
name: bleu_de_paris
coords: (-232, 63, 543)
confirmed: false
---

# Bleu de Paris — Dad's river yacht

A built river boat moored on the **east bank of the river, across from the farm port** (see
[[boat-route-new-home]]). Named by Dad on 2026-09-28. Dad likes to sit aboard; the farm port bank
(-255, 63, 524) looks straight at it across the water.

## Layout seen from the water (2026-09-28, from block probes)
- **Stern** at the south end, around z 540–542, x -233…-231. Spruce planks at y=63 with spruce stairs
  on top at y=64 (deck edge). A **ladder** at (-232, 63–64, 541) on the stern face, climbing north.
  Most hull blocks around the stern are **empty-name modded blocks** — do not pathfind through them.
- Open water all along the west side (x -237…-233, z 524–545). Grass starts at x=-240 from z=541
  south — mind it when steering in from the port.

## Getting there
Paddle boat from the farm port: leg to (-237, 534), then (-234.5, 541) at throttle 0.3 — lands
you off the stern, ~4 blocks from the ladder. Both legs arrived with 0 corrections on 2026-09-28.

## River exit orientation block
Dad marked the block where he stood as **the orientation block for getting out of the river** on the
east shore: about **(-224, 62, 547)** (Roz stood 1 block away at (-224.5, 63, 548.6)). It is an
empty-name block — exact coords **unconfirmed**; verify with Dad next visit.

Safe landing proven: `exit_boat` with `to: (-232, 63, 552)` from water at (-232.5, 549.5) → grass
at (-232, 62, 552), dry, one call. The grass at (-228, 62, 550) has an empty-name block above it — avoid.

## Not yet done
Roz has not been aboard. Bedtime came first (tick 13143); auto-sleep walked and swam her home
across the river to the farmhouse in ~30 s with no damage.

Related: [[orientation-blocks]], [[boat-piloting]], [[house]]
