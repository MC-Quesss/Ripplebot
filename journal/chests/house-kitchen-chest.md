---
type: chest
name: house_kitchen_chest
coords: [-266, 67, 569]
approach_from: [-267, 65, 570]
approach_range: 1
purpose: bake_ingredients_and_food
container_size: 27
double_chest: false
confirmed: true
---

# House Kitchen Chest

Right of [[house-bed]]. Holds the [[../recipes/bread|bread]]-baking ingredients and
tools (a Pam's HarvestCraft two-stage recipe), plus iron and finished bread. The bot
drives it by **fixed slot index** because every ingredient/tool reports as `unknown`
in mineflayer's registry — see [[../items/wheat]] context and the bake procedure.

- **Block coords:** (-266, 67, 569)
- **Approach:** pathfind to (-267, 65, 570) range=1 — still reaches the new block (~2.4 blocks, verified 2026-05-30).
- **Capacity:** **27 slots (single chest).**

## Slot layout (re-mapped 2026-05-30)

Mirrors `CHEST_SLOTS` in `bot.js`. A single 27-slot chest is a 3-row × 9-column grid
(row 0 = 0–8, row 1 = 9–17, row 2 = 18–26).

| Slot | Item | Notes |
|---|---|---|
| 0 | **pot** | salt-making station, user-managed. **DO NOT TOUCH** — not in `CHEST_SLOTS`. |
| 7 | salt | user keeps topped up (`unknown`) |
| 8 | bakeware | reusable, returns here after craft (`unknown`) |
| 16 | water | fresh water, user keeps topped up (`unknown`) |
| 17 | mixing bowl | reusable, returns here after craft (`unknown`) |
| 18 | iron | iron ingots (vanilla `iron_ingot`) |
| 24 | bread | finished-loaf storage (vanilla `bread`) |
| 25 | dough | intermediate storage (`unknown`) |
| 26 | flour | wheat flour, user keeps topped up (`unknown`) |

Only **iron (18)** and **bread (24)** are bot-visible by name; the rest are identified
purely by slot index.

## Update 2026-05-30 — double → single, re-mapped

The chest **was a 54-slot double** at (-267, 67, 569) + (-266, 67, 569). The user removed
the **left half** (-267), leaving a single 27-slot chest at **(-266, 67, 569)**. This
renumbered every slot, so the whole layout was re-mapped using a **white bed as a visible
cursor**: the user placed the bed in a target slot, the bot read back its index (the bed
is vanilla and visible), then the modded item was swapped in. Verified slot-by-slot.

`bot.js` changes (same session):
- `KITCHEN_CHEST` and `HARVEST_WAYPOINTS.kitchen_chest`: (-267,67,569) → (-266,67,569).
- `CHEST_SLOTS`: `{bread:15,dough:21,water:22,salt:23,flour:24,bowl:25,bakeware:26,iron:45}`
  → `{bread:24,dough:25,water:16,salt:7,flour:26,bowl:17,bakeware:8,iron:18}`.
- Approach coords left at (-267,65,570) — still in reach.

### Prior history (pre-2026-05-30, double chest)
Was upgraded single→double on 2026-05-14 (27→54). All deposit code is vanilla-deposit-API
based (`win.deposit`) or computes the chest portion as `win.slots.length - 36`, so it
adapts to the slot count automatically; only the fixed `CHEST_SLOTS` indices and the
block coords needed manual re-mapping.

## Used by
- [[../procedures/bake-potatoes]] / bread bake routine — fixed-slot ingredient staging
- [[../procedures/stash-wheat]], [[../procedures/deposit-named]] — dynamic deposits (slot-agnostic)
- [[../procedures/right-click-harvest]] — harvest deposit tail (now keeps wheat on hand instead; see log)
- `runStashUnknown` — stashes modded `unknown` items here

## Related
- [[house-crafting-chest]] — separate chest above the [[../places/house-crafting-table]]
- [[../recipes/bread]]
