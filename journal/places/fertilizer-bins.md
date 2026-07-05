---
type: place
name: fertilizer_bins
coords: [-274, 64, 568]
confirmed: true
---

# Fertilizer Bins

Modded fertilizer bins placed **on the walking line between the house door pad
and the [[jukebox]]** — observed 2026-07-04 at (-274, 64, 568) and
(-274, 64, 569), block type **3995** (empty name), with a companion machine
block type **1458** at (-273, 64, 569). All report empty names in mineflayer's
registry.

**Bots must never walk into these.** They have partial server-side collision
with raised walls (like a cauldron): an entity that walks in gets rubber-banded
into a wedge it cannot escape by walking, and forcing movement is lethal —
Roz got stuck inside one on 2026-07-04, survived a reconnect still wedged, and
**suffocated during a jump+push escape attempt** (death #1 that session;
inventory kept by server rules).

## Handling (bot.js, 2026-07-04)

- `FERTILIZER_BIN_TYPES = new Set([3995, 1458])` — these type ids get a **full
  solid collision box client-side** (getBlock override, same mechanism as the
  lily-pad patch) so physics bumps off them like a wall instead of entering
  the mismatched space.
- The pathfinder already routes around **all** empty-name blocks via the
  Infinity `exclusionAreasStep` penalty — the bins were dangerous because
  `walk_until` and manual control bypass the pathfinder.
- If a bot gets wedged in one anyway: **do not force movement** — jump/push
  attempts can suffocate. Ask the operator to push the bot out in-game, or
  accept the death (inventory is kept).

## Related

- [[../chests/house-kitchen-chest]] — the walk to the jukebox passes this spot
- [[yaw-convention]]
