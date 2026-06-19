---
type: procedure
name: food_safety_loop
aliases: [auto_food, baked_potato_floor]
status: confirmed
confirmed: true
first_tested: 2026-05-30
---

# Food Safety Loop

A background safety net with three tiers: eat from inventory, withdraw from chest, or
harvest from the field. Runs on the 5s timer alongside auto-sleep.

## Overview (updated 2026-06-19)

- **`tryFoodSafety()`** — fires as soon as `food < 20` (hunger not full). Three steps:
  1. **Eat from inventory** — tries all `EDIBLE_FOODS` in priority order (baked_potato first,
     raw potato last).
  2. **Withdraw from kitchen chest** — scans all container slots by name. Priority: baked_potato
     (up to 32), then bread (up to 16, only if health < 20). No fixed-slot lookup — vanilla items
     can be in any slot.
  3. **Field harvest** (`tryFoodSafetyFieldHarvest`) — if chest is empty: harvest raw potatoes,
     eat raw until full, bake the remainder in the furnace (non-blocking, walks away). Only during
     daytime.
- **`tryRestockSupplies()`** — fires whenever baked potatoes < `RESTOCK_MIN` (32) or > 128
  (overflow). Cooldown: 10 minutes between runs. Checks chest first, then harvests + bakes if
  still low.
- **`tryCollectBake()`** — collects baked potatoes from the furnace when `pendingBake.doneAt` is
  reached. Also collected opportunistically by idle wander furnace visits.

## Food priority

1. **Baked potatoes** — primary food source. Bot keeps ≥32 on hand via restock.
2. **Bread** — emergency only: no baked potatoes available AND health not full.
3. **Raw potatoes** — last resort: harvested and eaten in the field when chest is empty.

## Control

- **On by default.** Toggle / tune via ctl `auto_food`:
  `{"action":"auto_food","args":{"enabled":false}}` to disable,
  `{"action":"auto_food","args":{"min":20}}` to change the floor.
  Status: `{"action":"auto_food"}` → `{enabled, busy, min, baked}`.

## Furnace memory

After baking, `pendingBake.active` is set and `tryCollectBake` picks up the output on the 5s
timer. Idle wander also checks the furnace (~10-20% chance per wander, boosted when a bake is
pending). On bot restart, `pendingBake.active` defaults to `true` so stale furnace contents are
always collected.

## Composition with "keep the fire going"

Mutual yielding through the task system:
- The food run yields to an active wheat harvest (`taskBusy()` gate).
- The [[keep-the-fire-going|sustain loop]] pauses while a food run is in progress (it checks
  `!foodSafetyBusy` before starting a wheat cycle).
So both can be active at once; they interleave rather than fight for the pathfinder.

## Related
- [[harvest-potatoes-right-click]] — the harvest step
- [[bake-potatoes]] — the bake step (keeps baked on hand)
- [[keep-the-fire-going]] — the sibling autonomous loop (wheat → bio-fuel)
- [[../chests/house-kitchen-chest]] — vanilla items found by name scan, not fixed slot
