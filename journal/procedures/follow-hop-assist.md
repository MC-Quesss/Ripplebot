---
type: procedure
name: follow-hop-assist
trigger: automatic
confirmed: false
added: 2026-07-13
reviewed: 2026-07-27
---

# Follow Hop Assist (bot "auto-jump")

Keeps Roz from getting pinned against 1-block obstacles while following a player.
The vanilla client has an auto-jump setting; pathfinder has no equivalent that
survives this server's modded blocks.

`confirmed: false` — added 2026-07-13, code-reviewed 2026-07-27, **not yet
observed working live**.

## Why it exists

Modded 1-block obstacles (beehives, modded-tree leaves) report **empty names**, so
pathfinder scores them at `Infinity`, refuses to route over them, and ends up
walking into them instead of hopping. Block data is untrustworthy there — so the
assist **detects the stall by motion, not by geometry**. That is the whole design
idea: don't ask what the block is, ask whether the bot is still moving.

## Rule

On every `physicsTick`, when following and outside the house:

1. Bot is further than the follow distance from its target (2 blocks when
   following a player directly, 3 when following another bot in the caravan chain)
2. Horizontal position has not changed by >0.2 blocks for **1200 ms**
3. At least 2500 ms since the last pulse
4. The block underfoot is **not farmland** (the crop guard must keep winning)

→ pulse `jump` for **400 ms**, re-asserting it every tick of the pulse. The
re-assert is necessary because pathfinder's own `physicsTick` listener is
registered first and clears `jump` on flat path segments.

Logs as `[follow] hop assist: stalled N.Ns at (x, y, z) — pulsing jump`.

Follow ending mid-pulse clears the jump state, so the bot never walks away holding
the key down.

## Known issue (review 2026-07-27, unfixed)

Reads `bot.entity.position` directly. This server is known to strand mineflayer's
entity at (0, 0, 0) — the `pos` ctl action carries an explicit `rawState` fallback
for exactly that case (`source: "raw"`). If it happens mid-follow, the stall
detector sees a position that never changes and a target that is always far away,
and degenerates into **a jump every 2.5 s for the rest of the follow**.

Severity is low in practice: in that state pathfinder is broken too, so the follow
has already failed and the assist only adds visible noise on top. A one-line guard
(skip when `x === 0 && y === 0`) would close it. Not urgent, but write it down
rather than rediscover it.

## Related

- [[../observations/_log]] · [[claude-brain-mode]] · [[keep-the-fire-going]]
