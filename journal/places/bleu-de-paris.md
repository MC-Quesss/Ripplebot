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

## Update — 2026-09-28 (later): east shore made walkable

- Dad swapped the modded shore blocks for **vanilla grass**. Probes now read `grass`/`air`, and
  `exit_boat` with `to: (-226, 63, 548)` from water at (-229.3, 547.3) landed Roz there in one call.
  **Proven landing: (-226, 63, 548)**, one step from the river-exit marker.
- Inland, Dad's floor is **mud bricks — modded block type 1079** (empty name), on a base of type 1059.
  1079 was not in `SOLID_MODDED_TYPES`, so the pathfinder read the floor as air and could not stand on it.
  Added 1079 to the set (bot.js); after a restart Roz walked straight onto it — stood on type 1079 at
  (-218, 63, 539). Other bots need the same bot.js + restart.
- Pathfinder also swims the river unaided: grass landing → farmhouse and back, no damage.
- **Gangplank pad** (shore side of the gangplank) marked by Dad: stand at **(-222, 64, 537)** on the mud bricks. See [[orientation-blocks]].

## Update — 2026-09-28: first boarding — PROVEN

Gangplank pad (-222, 64, 537) → straight west along z=537 → **on-boat pad (-229, 64, 537)**.
- Gangplank x -224…-227 (2 wide, z 537–538) = **modded plank slabs, type 1744**, bottom half (meta 0);
  open water under x=-226. Added `SLAB_MODDED_TYPES` = {1744} in bot.js (half-block collision, like oak
  slabs — Dad's description). Roz crossed at y=64.5 the whole way, no fall.
- x=-228: vanilla spruce slab. x=-229: spruce planks under a thin modded layer (3855) — the on-boat pad.
- **Avoid x=-230** for now: floor there is a lever (type 69) with modded type 2924 above — unverified footing.
