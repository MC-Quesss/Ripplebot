---
type: place
name: charge-pad
coords: (-266, 65, 574)
confirmed: true
---

# Charge Pad (modded block)

A modded charging pad on the floor in the southeast corner of the [[house]], near (-265.7, 64.9, 574.3). Empty-name block with invisible collision geometry that traps the bot.

## Existing mitigations (bot.js)

1. **Pathfinder exclusion** — all empty-name blocks get an `Infinity` step penalty, so the pathfinder never routes through the pad.
2. **Collision zeroed** — `getBlock` override at x=-266, z=574, y=64–65 sets `shapes = []` so physics doesn't trap the bot if it ends up there.
3. **Post-spawn nudge** (added 2026-08-06) — if the bot spawns within 1.5 blocks of the pad, it pathfinds to [[house-center]] after a 2s delay.

## How the bot ends up here

The server places the bot at its last logout position on reconnect. If the bot was near the SE corner when it disconnected (or was kicked), it can land on the pad.

## See also
- [[house]] — bounding box and interior hazards
- [[../observations/_log]]
