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
tools (a Pam's HarvestCraft two-stage recipe), plus iron, bread, and baked potatoes.

**Slot rule:** Only modded items that report as `unknown` in mineflayer's registry get
fixed slot indices. Vanilla items (bread, baked_potato, iron_ingot, etc.) can land in
any slot and must be found by **scanning all container slots by item name**, never by
hardcoded index. The fixed indices are only needed because the bot literally cannot
tell modded items apart except by position.

- **Block coords:** (-266, 67, 569)
- **Approach:** pathfind to (-267, 65, 570) range=1 — still reaches the new block (~2.4 blocks, verified 2026-05-30).
- **Capacity:** **27 slots (single chest).**

## Cooperative handoff surface (user, 2026-05-30)

This chest is the **shared handoff point between the user and the bot** — neither side can reach
into the other's inventory directly, so the chest is how items pass between them. This shapes how
to treat it:

- **Bot → user:** the bot deposits here what the user can't pull from its "pockets." Surplus
  [[../procedures/deposit-seeds|seeds]] land here (they can't go in the [[../places/house-hopper|hopper]]
  — only wheat feeds the bio-fuel machine). Commands like **"stash everything"** / **"stash
  unknown"** exist precisely so the user can recover something the bot picked up
  (`runStashAll` / `runStashUnknown`).
- **User → bot:** the user **prepares the bread ingredients** (flour/salt/water/bowl/bakeware)
  and **keeps iron stocked** so the bot can craft new shears when needed. So the bot should
  *expect* to find these staged here and not be surprised by them appearing/refilling.
- **Reserved slots** (below) exist so both parties agree on what each modded `unknown` item is —
  the fixed indices are the shared contract, not just a bot convenience.

It is **cooperative and dynamic**: contents change from both sides between sessions. Always read
live state before relying on a count; the slot *roles* are stable, the *amounts* are not.

## Slot layout (re-mapped 2026-05-30)

Mirrors `CHEST_SLOTS` in `bot.js`. A single 27-slot chest is a 3-row × 9-column grid
(row 0 = 0–8, row 1 = 9–17, row 2 = 18–26).

### Fixed-slot items (modded `unknown` — identified by position only)

| Slot | Item | Notes |
|---|---|---|
| 6 | **pot** | salt-making station, user-managed. **DO NOT TOUCH** — not in `CHEST_SLOTS`. |
| 7 | salt | user keeps topped up (`unknown`) |
| 8 | bakeware | reusable, returns here after craft (`unknown`) |
| 16 | water | fresh water, user keeps topped up (`unknown`) |
| 17 | mixing bowl | reusable, returns here after craft (`unknown`) |
| 25 | dough | intermediate storage (`unknown`) |
| 26 | flour | wheat flour, user keeps topped up (`unknown`) |

### Vanilla items (no fixed slot — scan by name)

Bread, baked potatoes, iron ingots, and any other vanilla item can be in **any slot**.
The bot finds them by scanning all container slots for matching `item.name`. Never
hardcode a slot index for a vanilla item.

Iron is in `CHEST_SLOTS` as a legacy convenience for shear crafting (the user stages it
at slot 18 by convention) but this is a soft expectation, not a hard contract.

## Update 2026-05-30 — double → single, re-mapped

The chest **was a 54-slot double** at (-267, 67, 569) + (-266, 67, 569). The user removed
the **left half** (-267), leaving a single 27-slot chest at **(-266, 67, 569)**. This
renumbered every slot, so the whole layout was re-mapped using a **white bed as a visible
cursor**: the user placed the bed in a target slot, the bot read back its index (the bed
is vanilla and visible), then the modded item was swapped in. Verified slot-by-slot.

`bot.js` changes (same session):
- `KITCHEN_CHEST` and `HARVEST_WAYPOINTS.kitchen_chest`: (-267,67,569) → (-266,67,569).
- `CHEST_SLOTS`: `{bread:15,dough:21,water:22,salt:23,flour:24,bowl:25,bakeware:26,iron:45}`
  → `{dough:25,water:16,salt:7,flour:26,bowl:17,bakeware:8,iron:18}` (bread removed 2026-06-19 — vanilla items found by name scan, not fixed slot).
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
