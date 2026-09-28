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

## Update — 2026-09-28: walked onto it, and how she got off

A misaligned door exit (go-outside started from x=-266.52 and z=572.81; the snag strafes drove her south-east) put Roz on the pad by walking, not by spawning, so the post-spawn nudge never ran. Once on it she was fully pinned: `walk_until`, a jump, `pathfind`, and a player's knockback hits (−5 HP) all left her x/z unchanged. Auto-sleep cycled the beds all night without reaching them, and fire duty failed every ~40 s until it was stopped.

**What freed her:** a player (Dad) removed one floor tile next to her, and the bot was restarted. She reconnected on open floor at (-266.5, 65, 570.6). The tile went into her inventory as 1 wool.

The pad's collision override clearly does not cover this case. The real fix is keeping the door exit from ever drifting into this corner (see the session log).
