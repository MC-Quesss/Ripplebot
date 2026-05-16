---
type: item
name: poisonous_potato
source: dig_potato_crop
drop_chance: ~2%
food_value: 2
side_effect: poison_status_60pct
confirmed: false
---

# Poisonous Potato

A vanilla 1.12.2 drop from breaking a potato crop with `dig` (left-click). 2% chance per harvest. Gives food and a 60% chance of Poison status (food poisoning, drains hunger).

## Status: not yet seen on this server

As of 2026-05-14, no `poisonous_potato` has appeared in inventory. The [[../procedures/harvest-potatoes-right-click|right-click technique]] uses `activate_block` instead of `dig`. The mod that handles the crop on right-click drops only normal potatoes — **no poisonous variant has been observed from right-click harvests.** This is a working hypothesis based on one session; needs more samples to confirm. The brute method (left-click `dig`) that would roll the 2% chance has been removed.

## Where one might still appear

- The [[../chests/house-kitchen-chest]] could hold poisonous potatoes from earlier brute-method potato runs. Worth auditing when the bot is near the chest.
- If we ever fall back to brute potato harvest (e.g. for testing), expect ~1 in 50 dug crops to yield this.

## User rule (2026-05-14): throw them away

**If `poisonous_potato` ever appears in inventory, discard it.** Don't bake (won't smelt anyway), don't deposit in the kitchen chest (cross-contamination with food storage), don't eat. Drop it on the ground at a designated dump spot — TBD; for now anywhere outside the food-storage area.

Implementation note: when wiring this into a routine, use `bot.tossStack(item)` or the `equip_slot` + drop pattern. A `runDiscardPoison()` helper would scan inventory for `poisonous_potato`, walk to a dump tile, and toss the stack.

## Related
- [[potato]]
- [[baked-potato]]
- [[../procedures/harvest-potatoes-right-click]]
