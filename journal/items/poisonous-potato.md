---
type: item
name: poisonous_potato
source: dig_potato_crop
drop_chance: ~2%
food_value: 2
side_effect: poison_status_60pct
confirmed: true
---

# Poisonous Potato

A vanilla 1.12.2 drop from breaking a potato crop with `dig` (left-click). 2% chance per harvest. Gives food and a 60% chance of Poison status (food poisoning, drains hunger).

## Update — 2026-06-05: first sighting

One `poisonous_potato` found in inventory on session start. Only right-click harvesting has been used for weeks, so the hypothesis that right-click doesn't produce poisonous potatoes is **disproven** — or the bot picked it up off the ground from a prior toss. Origin unclear. Discarded via the new `toss_trash` ctl command + the existing `tossTrash()` function (which pathfinds to the dump spot at the far end of the potato patch).

## Previous status (2026-05-14, superseded)

As of 2026-05-14, no `poisonous_potato` had appeared in inventory. The [[../procedures/harvest-potatoes-right-click|right-click technique]] uses `activate_block` instead of `dig`. The mod that handles the crop on right-click drops only normal potatoes — **no poisonous variant had been observed from right-click harvests.** This hypothesis is now uncertain given the 2026-06-05 sighting.

## Where one might still appear

- The [[../chests/house-kitchen-chest]] could hold poisonous potatoes from earlier brute-method potato runs. Worth auditing when the bot is near the chest.
- If we ever fall back to brute potato harvest (e.g. for testing), expect ~1 in 50 dug crops to yield this.

## User rule (2026-05-14): throw them away

**If `poisonous_potato` ever appears in inventory, discard it.** Don't bake (won't smelt anyway), don't deposit in the kitchen chest (cross-contamination with food storage), don't eat. Drop it on the ground at a designated dump spot — TBD; for now anywhere outside the food-storage area.

Implementation: `tossTrash()` in bot.js scans for items in `TRASH_ITEMS` (includes `poisonous_potato`), pathfinds to the dump spot (-287, 63, 579), and tosses. Runs automatically during wheat and potato harvests. Also exposed as `toss_trash` ctl command (added 2026-06-05).

## Related
- [[potato]]
- [[baked-potato]]
- [[../procedures/harvest-potatoes-right-click]]
