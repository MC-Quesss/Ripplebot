---
type: procedure
name: food_safety_loop
aliases: [auto_food, baked_potato_floor]
status: confirmed
confirmed: true
first_tested: 2026-05-30
---

# Food Safety Loop (auto-restock baked potatoes)

A background safety net: the bot keeps itself stocked with baked potatoes. If the supply drops
below the floor (**16**) and the bot is idle, safe, and it's daytime, it autonomously harvests
the potato patch and bakes the crop — keeping the baked output on hand (food, never stashed).

## Control

- **On by default.** Toggle / tune via ctl `auto_food`:
  `{"action":"auto_food","args":{"enabled":false}}` to disable,
  `{"action":"auto_food","args":{"min":20}}` to change the floor.
  Status: `{"action":"auto_food"}` → `{enabled, busy, min, baked}`.
- No chat phrase yet — it runs on its own.

## How it works (`bot.js`)

- Runs off the **same 5s timer as auto-sleep** (`startAutoSleep` interval → `tryFoodSafety()`).
- State: `foodSafetyEnabled` (default true), `foodSafetyBusy`, `foodSafetyMin` (default 16).
- Gate (all must hold to fire): enabled, not already busy, **no active task**, not
  `goInsideBusy`/`autoSleepBusy`, **not sleeping and not bedtime** (won't start a long run at
  night), `baked_potato < foodSafetyMin`, no hostiles within 16.
- **Emergency bread protocol (2026-06-03):** if HP < 10 when food-safety fires, the bot goes
  inside, withdraws up to 16 bread from [[../chests/house-kitchen-chest]] slot 24, eats to
  recover, then proceeds with the harvest. Breaks the HP-too-low-to-harvest / no-food-to-heal
  deadlock. If no bread is available, the bot announces it needs help and aborts.
- Action: `runHarvestPotatoesRightClick({ then: 'bake', maxTiles: 42 })` then
  `runBakePotatoes()` — both the usual one-at-a-time, bedtime-aware tasks. The harvest is
  **capped at 42 tiles** (of ~60 total) to keep the food run short.
- The `then: 'bake'` flag makes the harvest **skip its "bake or stash?" prompt** (no 60s wait)
  and keep the raw potatoes on hand; the loop's separate `runBakePotatoes()` call does the bake.
  (Baking can't run inside the harvest — the harvest still holds the `harvest_potatoes_rc` task,
  and `bake_potatoes` is a separate task. So the two-call structure is required, not optional.)
- Baked potatoes stay on hand (the bake routine never stashes them).

## Composition with "keep the fire going"

Mutual yielding through the task system:
- The food run yields to an active wheat harvest (`taskBusy()` gate).
- The [[keep-the-fire-going|sustain loop]] pauses while a food run is in progress (it checks
  `!foodSafetyBusy` before starting a wheat cycle).
So both can be active at once; they interleave rather than fight for the pathfinder.

## Tested 2026-05-30 (day 42935)

With `baked=16`, bumped the floor to 17 to force a trigger → `[food-safety] baked=16 < 17 —
harvesting + baking potatoes` → `[harvest-potato-rc] start` → exited house to the patch. During
the run `task_status` showed `harvest_potatoes_rc` and the sustain loop stayed paused
(`foodSafetyBusy`). Floor reset to 16. (Full harvest→bake reuses the already-proven potato
routines.)

## Resolved: the 60s prompt (2026-05-30)

Originally the autonomous run ate a 60s timeout: `runHarvestPotatoesRightClick` asked "bake or
stash?" and waited for a chat reply no one gave. Fixed by adding the `then: 'bake'` flag (above),
which skips the prompt entirely on the automatic path. The interactive chat path (no `then`) is
unchanged — it still asks.

## Related
- [[harvest-potatoes-right-click]] — the harvest step
- [[bake-potatoes]] — the bake step (keeps baked on hand)
- [[keep-the-fire-going]] — the sibling autonomous loop (wheat → bio-fuel)
- [[../observations/_log]]
