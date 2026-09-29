---
type: concept
name: orientation_blocks
confirmed: true
---

# Orientation Blocks

A door traversal always starts on one orientation block and ends on the other. They are calibrated pads — the bot must be standing on one before setting heading or activating a door. Drift of half a block matters: a wrong yaw plus forward-push has planted the bot in [[house-furnace]] more than once.

## The two pads
- [[house-center]] — inside, (-268, 65, 572). Pressure plate auto-opens the door.
- [[outside-orientation]] — outside, (-275, 64, 572). No pressure plate.

## Pre-flight checklist (every door crossing)
1. Pathfind to the pad with `range=0`.
2. Verify arrival (xz within 1.5; y within 0.6 of expected).
3. Set required yaw and **wait for `rawState.yaw` to converge** within 0.25 rad.
4. Refuse to push forward on yaw-convergence failure.
5. Drive with `walk_until` (axis-target stopping) — never duration-based control.
6. Land on the opposite pad.

## Why this exists

The bot's forward-push velocity varies on this server. Without an axis target, it overshoots or undershoots. Without a verified yaw, "forward" might be "into the furnace." Two failure modes; two pads; one rule per pad.

## Update — 2026-09-28: east-bank pad (Bleu de Paris)

Dad marked a third pad across the river, on the mud-brick floor by [[bleu-de-paris]]:
- **East-bank pad** — stand at **(-222, 64, 537)**, on mud brick (-222, 63, 537) (modded type 1079 —
  in `SOLID_MODDED_TYPES`, so the pathfinder treats it as floor). Reached by `pathfind` range 0.
  Approach from the proven grass landing (-226, 63, 548), or 5 blocks west along z=537 from (-217, 64, 537).
  **Shore side of the gangplank** (Dad) — the start point for boarding the yacht.
- **On-boat pad** — stand at **(-229, 64, 537)**, the deck end of the gangplank, aboard [[bleu-de-paris]]
  (Dad marked it 2026-09-28). Deck floor: spruce planks at y=63 under a thin modded layer (type 3855).
  From the gangplank pad: `pathfind` range 0 to (-228, 64, 537), then (-229, 64, 537) — straight west.
