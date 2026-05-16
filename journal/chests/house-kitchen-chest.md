---
type: chest
name: house_kitchen_chest
coords: [-267, 67, 569]
approach_from: [-267, 65, 570]
approach_range: 1
purpose: food_and_wheat_deposit
container_size: 54
double_chest: true
confirmed: true
---

# House Kitchen Chest

Upper chest, right of [[house-bed]]. The canonical [[../items/wheat|wheat]] deposit and food storage.

- **Block coords:** (-267, 67, 569)
- **Approach:** pathfind to (-267, 65, 570) range=1 — reach works from y=65 up to the y=67 chest.
- **Capacity:** **54 slots (double chest)**, upgraded from 27 on 2026-05-14.

## Double-chest upgrade (2026-05-14)

User upgraded the kitchen chest from single (27 slots) to double (54 slots). Container behavior:
- `open_container` returns `containerSize: 54`, `block: chest`.
- All existing code paths continue to work because they use either `win.deposit(type, meta, count)` (vanilla API, slot-count agnostic) or compute `containerSlotCount = win.slots.length - 36` dynamically. **No bot.js changes were required.**
- Existing items kept their slot positions (0..26); new room is at slots 27..53.

## Contents (audit 2026-05-14, day 41330)

| Slot | Item | Count |
|---|---|---|
| 0 | wheat | 58 |
| 4, 5 | `unknown` | 64, 1 |
| 6 | bread | 64 |
| 7, 8 | string | 18, 64 |
| 13, 14 | `unknown` | 64, 64 |
| 15 | bread | 64 |
| 16 | `unknown` | 33 |
| 17 | dye | 12 |
| 24, 25, 26 | `unknown` | 64, 1, 1 |
| 27..53 | empty | — |

**No `poisonous_potato`** in the chest as of this audit (per the user rule in [[../items/poisonous-potato]] — they should never end up here anyway, but worth confirming the historical record is clean).

## Used by
- [[../procedures/stash-wheat]] — single-item wheat deposit
- [[../procedures/deposit-named]] — multi-item bread/wheat/seeds deposit
- [[../procedures/right-click-harvest]] — harvest deposit tail
- `runBakePotatoes` post-bake stash
- `runStashUnknown` — stashes any modded `unknown`-named items here

## Code-path safety summary

All deposit code is **vanilla-deposit-API based** (`win.deposit(type, meta, count)`). The double-chest upgrade is fully backward compatible.

`runStashUnknown` uses raw slot indices but computes them from `win.slots.length - 36`, which auto-adapts:
- Single chest: `54 - 36 = 18` ❌ (wait, single chest window is 27 + 36 = 63, so 63 - 36 = 27, correct)
- Double chest: `90 - 36 = 54` ✅

Mid-air correction: the formula is `(window total) - (player inventory size 36)`, not a constant. So it always returns the chest portion correctly.
